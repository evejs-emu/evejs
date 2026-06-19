const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  activateShipForSession,
  findCharacterShip,
  getActiveShipRecord,
  buildInventoryItemRow,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  ensureCapsuleForCharacter,
  ITEM_FLAGS,
  getShipConditionState,
  setShipPackagingState,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  getCharacterSkillPointTotal,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  undockSession,
  ejectSession,
  boardSpaceShip,
} = require(path.join(__dirname, "../../space/transitions"));
const {
  disconnectCharacterSession,
} = require(path.join(__dirname, "../_shared/sessionDisconnect"));
const {
  getDockedLocationID,
  isDockedSession,
} = require(path.join(__dirname, "../structure/structureLocation"));
const {
  listFittedItems,
  getFittedModuleItems,
  getTurretLikeModuleItems,
  buildModuleStatusSnapshot,
  buildChargeSublocationData,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  buildWeaponBankStateDict,
} = require(path.join(__dirname, "../moduleGrouping/moduleGroupingRuntime"));
const {
  launchDronesForSession,
  scoopDrone,
} = require(path.join(__dirname, "../drone/droneRuntime"));
const {
  jettisonItemsForSession,
} = require(path.join(__dirname, "./jettisonRuntime"));
const {
  launchOrbitalsFromShip,
} = require(path.join(__dirname, "./orbitalLaunchRuntime"));
const {
  getShipDirtTimestamp,
  normalizeFiletime,
  resetShipDirtTimestamp,
} = require(path.join(__dirname, "./shipDirtState"));
const {
  getItemKillCountPlayer,
} = require(path.join(__dirname, "./shipKillCounterState"));
const DBTYPE_I4 = 0x03;
const DBTYPE_R8 = 0x05;
const DBTYPE_BOOL = 0x0b;
const DBTYPE_I8 = 0x14;
const FILETIME_TICKS_PER_MS = 10000n;
const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const SAFE_LOGOFF_TIMER_GRACE_TICKS = 10000000n;
const INSTANCE_ROW_DESCRIPTOR_COLUMNS = [
  ["instanceID", DBTYPE_I8],
  ["online", DBTYPE_BOOL],
  ["damage", DBTYPE_R8],
  ["charge", DBTYPE_R8],
  ["skillPoints", DBTYPE_I4],
  ["armorDamage", DBTYPE_R8],
  ["shieldCharge", DBTYPE_R8],
  ["incapacitated", DBTYPE_BOOL],
];

function buildCurrentFileTime() {
  return BigInt(Date.now()) * FILETIME_TICKS_PER_MS + FILETIME_EPOCH_OFFSET;
}

function normalizeMethodName(rawMethodName) {
  if (typeof rawMethodName === "string") {
    return rawMethodName;
  }

  if (Buffer.isBuffer(rawMethodName)) {
    return rawMethodName.toString("utf8");
  }

  if (rawMethodName === null || rawMethodName === undefined) {
    return "";
  }

  return String(rawMethodName);
}

function extractKwarg(kwargs, key) {
  if (!kwargs) {
    return undefined;
  }

  if (kwargs.type === "dict" && Array.isArray(kwargs.entries)) {
    const match = kwargs.entries.find((entry) => entry[0] === key);
    return match ? match[1] : undefined;
  }

  if (typeof kwargs === "object") {
    return kwargs[key];
  }

  return undefined;
}

function collectMachoDictValues(rawValue) {
  if (!rawValue) {
    return [];
  }

  if (rawValue.type === "dict" && Array.isArray(rawValue.entries)) {
    return rawValue.entries.map((entry) => entry[1]);
  }

  if (typeof rawValue === "object") {
    return Object.values(rawValue);
  }

  return [];
}

class ShipService extends BaseService {
  constructor() {
    super("ship");
    this._shipConfiguration = new Map();
  }

  _getShipID(session) {
    const activeShip =
      session && session.characterID
        ? getActiveShipRecord(session.characterID)
        : null;
    return (
      (activeShip && (activeShip.itemID || activeShip.shipID)) ||
      (session && (session.activeShipID || session.shipID || session.shipid)) ||
      140000101
    );
  }

  _extractShipId(rawValue) {
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      return Math.trunc(rawValue);
    }

    if (typeof rawValue === "bigint") {
      return Number(rawValue);
    }

    if (typeof rawValue === "string" && rawValue.trim() !== "") {
      return Number.parseInt(rawValue, 10);
    }

    if (Buffer.isBuffer(rawValue)) {
      return Number.parseInt(rawValue.toString("utf8"), 10);
    }

    return 0;
  }

  _syncRequestedOnlineModulesForUndock(session, shipID, kwargs) {
    const requestedOnlineModules = collectMachoDictValues(
      extractKwarg(kwargs, "onlineModules"),
    )
      .map((value) => this._extractShipId(value))
      .filter((value) => value > 0);

    if (requestedOnlineModules.length === 0) {
      return 0;
    }

    const requestedSet = new Set(requestedOnlineModules);
    const charID = session && session.characterID ? session.characterID : 0;
    const fittedModules = getFittedModuleItems(charID, shipID).filter(
      (item) => requestedSet.has(Number(item && item.itemID)),
    );

    let updatedCount = 0;
    for (const moduleItem of fittedModules) {
      if (moduleItem.moduleState && moduleItem.moduleState.online) {
        continue;
      }

      const updateResult = updateInventoryItem(moduleItem.itemID, (currentItem) => ({
        ...currentItem,
        moduleState: {
          ...(currentItem.moduleState || {}),
          online: true,
        },
      }));

      if (updateResult.success) {
        updatedCount += 1;
      }
    }

    if (updatedCount > 0) {
      log.info(
        `[Ship] Promoted ${updatedCount} requested online module(s) before undock for ship=${shipID}`,
      );
    }

    return updatedCount;
  }

  _extractShipIds(rawValue) {
    if (Array.isArray(rawValue)) {
      return rawValue.map((entry) => this._extractShipId(entry)).filter((entry) => entry > 0);
    }

    if (rawValue && rawValue.type === "list" && Array.isArray(rawValue.items)) {
      return rawValue.items
        .map((entry) => this._extractShipId(entry))
        .filter((entry) => entry > 0);
    }

    const singleShipId = this._extractShipId(rawValue);
    return singleShipId > 0 ? [singleShipId] : [];
  }

  _normalizeFileTime(rawValue) {
    return normalizeFiletime(rawValue, null);
  }

  _getShipDirtTimestamp(shipID, options = {}) {
    const numericShipID = this._extractShipId(shipID);
    if (numericShipID <= 0) {
      return 0n;
    }

    return getShipDirtTimestamp(numericShipID, options);
  }

  _setDirtTimestamp(shipID, rawTimestamp = null, reason = "set") {
    const numericShipID = this._extractShipId(shipID);
    if (numericShipID <= 0) {
      return null;
    }

    const resetResult = resetShipDirtTimestamp(numericShipID, rawTimestamp, {
      reason,
    });
    return resetResult && resetResult.success ? resetResult.dirtTime : null;
  }

  _buildActivationResponse(activeShip, session) {
    // The live 23.02 client build in use here still expects a 4-slot
    // activation tuple during ship boarding/activation. The first three slots
    // are the usual instance/charge/weapon-bank caches; the fourth is kept as
    // an empty reserved payload for compatibility with the running client.
    const charID =
      (session && (session.characterID || session.charid || session.userid)) ||
      140000001;
    const shipID =
      (activeShip && (activeShip.itemID || activeShip.shipID)) ||
      this._getShipID(session);
    const skillPoints = getCharacterSkillPointTotal(charID) || 0;
    const shipCondition = getShipConditionState(activeShip);
    const fittedItems = getFittedModuleItems(charID, shipID);
    const moduleEntries = fittedItems.map((item) => [
      item.itemID,
      this._buildPackedInstanceRow(buildModuleStatusSnapshot(item)),
    ]);

    return [
      {
        type: "dict",
        entries: [
          [
            shipID,
            this._buildPackedInstanceRow({
              itemID: shipID,
              damage: shipCondition.damage,
              charge: shipCondition.charge,
              armorDamage: shipCondition.armorDamage,
              shieldCharge: shipCondition.shieldCharge,
              incapacitated: shipCondition.incapacitated,
            }),
          ],
          [
            charID,
            this._buildPackedInstanceRow({
              itemID: charID,
              online: true,
              skillPoints,
            }),
          ],
          ...moduleEntries,
        ],
      },
      this._buildChargeStateDict(charID, shipID),
      buildWeaponBankStateDict(shipID, { characterID: charID }),
      { type: "dict", entries: [] },
    ];
  }

  _buildStatusRow({
    itemID,
    online = false,
    damage = 0.0,
    charge = 0.0,
    skillPoints = 0,
    armorDamage = 0.0,
    shieldCharge = 0.0,
    incapacitated = false,
  }) {
    return {
      type: "object",
      name: "util.Row",
      args: {
        type: "dict",
        entries: [
          [
            "header",
            [
              "instanceID",
              "online",
              "damage",
              "charge",
              "skillPoints",
              "armorDamage",
              "shieldCharge",
              "incapacitated",
            ],
          ],
          [
            "line",
            [
              itemID,
              online,
              damage,
              charge,
              skillPoints,
              armorDamage,
              shieldCharge,
              incapacitated,
            ],
          ],
        ],
      },
    };
  }

  _buildInstanceRowDescriptor() {
    return {
      type: "objectex1",
      header: [
        { type: "token", value: "blue.DBRowDescriptor" },
        [INSTANCE_ROW_DESCRIPTOR_COLUMNS],
      ],
      list: [],
      dict: [],
    };
  }

  _buildPackedInstanceRow({
    itemID,
    online = false,
    damage = 0.0,
    charge = 0.0,
    skillPoints = 0,
    armorDamage = 0.0,
    shieldCharge = 0.0,
    incapacitated = false,
  }) {
    return {
      type: "packedrow",
      header: this._buildInstanceRowDescriptor(),
      columns: INSTANCE_ROW_DESCRIPTOR_COLUMNS,
      fields: {
        instanceID: itemID,
        online,
        damage,
        charge,
        skillPoints,
        armorDamage,
        shieldCharge,
        incapacitated,
      },
    };
  }

  _buildChargeSublocationRow({
    locationID,
    flagID,
    typeID,
    quantity,
  }) {
    return {
      type: "object",
      name: "util.Row",
      args: {
        type: "dict",
        entries: [
          ["header", ["instanceID", "flagID", "typeID", "quantity"]],
          ["line", [locationID, flagID, typeID, quantity]],
        ],
      },
    };
  }

  _buildChargeStateDict(charID, shipID) {
    const chargesByFlag = buildChargeSublocationData(charID, shipID);
    if (chargesByFlag.length === 0) {
      return { type: "dict", entries: [] };
    }

    return {
      type: "dict",
      entries: [[
        shipID,
        {
          type: "dict",
          entries: chargesByFlag.map((entry) => [
            entry.flagID,
            this._buildChargeSublocationRow({
              locationID: shipID,
              flagID: entry.flagID,
              typeID: entry.typeID,
              quantity: entry.quantity,
            }),
          ]),
        },
      ]],
    };
  }

  _getShipConfiguration(shipID) {
    const numericShipID = this._extractShipId(shipID);
    if (!this._shipConfiguration.has(numericShipID)) {
      this._shipConfiguration.set(numericShipID, {
        allowFleetSMBUsage: false,
        allowCorpSMBUsage: false,
        SMB_AllowFleetAccess: false,
        SMB_AllowCorpAccess: false,
        FleetHangar_AllowFleetAccess: false,
        FleetHangar_AllowCorpAccess: false,
      });
    }

    return this._shipConfiguration.get(numericShipID);
  }

  _activateShipById(shipID, session, sourceLabel) {
    if (!session) {
      log.warn(`[Ship] ${sourceLabel} requested without a session`);
      return null;
    }

    const numericShipID = this._extractShipId(shipID);
    if (!Number.isInteger(numericShipID) || numericShipID <= 0) {
      log.warn(`[Ship] ${sourceLabel} received invalid shipID=${String(shipID)}`);
      return null;
    }

    const currentShip = getActiveShipRecord(session.characterID);
    const requestedShip = findCharacterShip(session.characterID, numericShipID);

    log.info(
      `[Ship] ${sourceLabel} shipID=${numericShipID} current=${currentShip ? (currentShip.itemID || currentShip.shipID) : "none"} requested=${requestedShip ? `${requestedShip.shipName}(${requestedShip.shipTypeID})` : "unknown"}`,
    );

    const activationResult = activateShipForSession(session, numericShipID, {
      emitNotifications: true,
      logSelection: true,
    });
    if (!activationResult.success) {
      log.warn(
        `[Ship] ${sourceLabel} failed for shipID=${numericShipID}: ${activationResult.errorMsg}`,
      );
      return null;
    }

    this._markDockedActiveShipVisualDirty(numericShipID);

    const activeShip = activationResult.activeShip || getActiveShipRecord(session.characterID);
    return this._buildActivationResponse(activeShip, session);
  }

  _markDockedActiveShipVisualDirty(shipID) {
    // Dirt parity is persistent per hull. Boarding/leave-ship should ensure a
    // timestamp exists for hangar presentation, not clean the ship every time.
    this._getShipDirtTimestamp(shipID, { reason: "activated" });
  }

  _leaveShip(session, shipID, sourceLabel) {
    if (!session || !session.characterID) {
      log.warn(`[Ship] ${sourceLabel} requested without a selected character`);
      return null;
    }

    const stationID = getDockedLocationID(session) || 60003760;
    const capsuleResult = ensureCapsuleForCharacter(session.characterID, stationID);
    if (!capsuleResult.success || !capsuleResult.data) {
      log.warn(`[Ship] ${sourceLabel} failed to ensure capsule`);
      return null;
    }

    const capsuleWasCreated = Boolean(
      capsuleResult.created === true ||
      (
        capsuleResult.data &&
        Array.isArray(capsuleResult.data.changes) &&
        capsuleResult.data.changes.some((change) => change && change.created === true)
      ) ||
      (
        Array.isArray(capsuleResult.changes) &&
        capsuleResult.changes.some((change) => change && change.created === true)
      ),
    );

    if (capsuleWasCreated) {
      // Treat a lazily created docked capsule like any other boardable hangar
      // ship: seed the inventory row before the shipid swap so the hangar view
      // can resolve the new active hull during ProcessActiveShipChanged.
      syncInventoryItemForSession(
        session,
        capsuleResult.data,
        {
          locationID: 0,
          flagID: 0,
          quantity: 0,
          singleton: 0,
          stacksize: 0,
        },
        {
          emitCfgLocation: true,
        },
      );
    }

    const activationResult = activateShipForSession(
      session,
      capsuleResult.data.itemID,
      {
        emitNotifications: true,
        logSelection: true,
      },
    );
    if (!activationResult.success) {
      log.warn(
        `[Ship] ${sourceLabel} failed to activate capsule: ${activationResult.errorMsg}`,
      );
      return null;
    }

    this._markDockedActiveShipVisualDirty(capsuleResult.data.itemID);

    return capsuleResult.data.itemID;
  }

  Handle_GetDirtTimestamp(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    const dirtTimestamp = this._getShipDirtTimestamp(shipID, {
      createIfMissing: false,
      reason: "get",
    });
    log.debug(
      `[Ship] GetDirtTimestamp(shipID=${shipID}) -> ${String(dirtTimestamp)}`,
    );
    return dirtTimestamp;
  }

  Handle_SetDirtTimestamp(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    const ts = args && args.length > 1 ? args[1] : null;
    const dirtTimestamp = this._setDirtTimestamp(shipID, ts, "client_set");
    log.debug(
      `[Ship] SetDirtTimestamp(shipID=${shipID}, ts=${String(ts)}, stored=${String(dirtTimestamp)})`,
    );
    return null;
  }

  Handle_GetShipKillCounter(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    const count = getItemKillCountPlayer(this._extractShipId(shipID));
    log.debug(`[Ship] GetShipKillCounter(shipID=${shipID}) -> ${count}`);
    return [count, 1];
  }

  Handle_GetKillCounter(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    const count = getItemKillCountPlayer(this._extractShipId(shipID));
    log.debug(`[Ship] GetKillCounter(shipID=${shipID}) -> ${count}`);
    return count;
  }

  Handle_GetDisplayKillCounterValue(args, session, kwargs) {
    log.debug("[Ship] GetDisplayKillCounterValue");
    return 1;
  }

  Handle_GetFittedItems(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    log.debug(`[Ship] GetFittedItems(shipID=${shipID})`);
    const charID = session && session.characterID ? session.characterID : 0;
    const resolvedShipID = this._extractShipId(shipID) || this._getShipID(session);
    return {
      type: "dict",
      entries: listFittedItems(charID, resolvedShipID).map((item) => [
        item.itemID,
        buildInventoryItemRow(item),
      ]),
    };
  }

  Handle_GetModules(args, session, kwargs) {
    log.debug("[Ship] GetModules");
    const charID = session && session.characterID ? session.characterID : 0;
    const shipID = this._getShipID(session);
    return {
      type: "list",
      items: getFittedModuleItems(charID, shipID).map((item) =>
        buildInventoryItemRow(item),
      ),
    };
  }

  Handle_LaunchDrones(args, session, kwargs) {
    void kwargs;
    const launchResult = launchDronesForSession(
      session,
      args && args.length > 0 ? args[0] : [],
    );
    if (!launchResult || launchResult.success !== true) {
      log.warn(
        `[Ship] LaunchDrones failed for char=${session ? session.characterID : "?"}: ${launchResult ? launchResult.errorMsg : "UNKNOWN_ERROR"}`,
      );
      return { type: "dict", entries: [] };
    }
    return launchResult && launchResult.response && launchResult.response.type === "dict"
      ? launchResult.response
      : { type: "dict", entries: [] };
  }

  Handle_ScoopDrone(args, session, kwargs) {
    void kwargs;
    return scoopDrone(
      session,
      args && args.length > 0 ? args[0] : [],
    );
  }

  Handle_Jettison(args, session, kwargs) {
    void kwargs;
    const itemIDs = this._extractShipIds(args && args.length > 0 ? args[0] : null);
    log.info(`[Ship] Jettison itemIDs=${JSON.stringify(itemIDs)}`);
    const result = jettisonItemsForSession(session, itemIDs);
    if (!result || !result.success) {
      log.warn(
        `[Ship] Jettison failed for char=${session ? session.characterID : "?"}: ${result ? result.errorMsg : "UNKNOWN_ERROR"}`,
      );
      return [[], []];
    }
    return [result.jettisonedToCanIDs, []];
  }

  Handle_LaunchFromShip(args, session, kwargs) {
    void kwargs;
    const rawItemIDs = args && args.length > 0 ? args[0] : [];
    const result = launchOrbitalsFromShip(session, rawItemIDs);
    if (!result || !result.success) {
      log.warn(
        `[Ship] LaunchFromShip failed for char=${session ? session.characterID : "?"}: ${result ? result.errorMsg : "UNKNOWN_ERROR"}`,
      );
      return [[], (result && result.errors) || []];
    }
    return [result.launchedItemIDs || [], result.errors || []];
  }

  Handle_Drop(args, session, kwargs) {
    void kwargs;
    const rawLaunchRequests = args && args.length > 0 ? args[0] : [];
    const whoseBehalfID = args && args.length > 1 ? this._extractShipId(args[1]) : 0;
    const ignoreWarning = Boolean(args && args.length > 2 ? args[2] : false);
    log.info(
      `[Ship] Drop launchRequests=${JSON.stringify(rawLaunchRequests, (k, v) => (typeof v === "bigint" ? v.toString() : v))} whoseBehalfID=${whoseBehalfID || "default"} ignoreWarning=${ignoreWarning}`,
    );

    const result = launchOrbitalsFromShip(session, rawLaunchRequests, {
      ownerID: whoseBehalfID,
      ignoreWarning,
    });
    if (!result || !result.success) {
      log.warn(
        `[Ship] Drop failed for char=${session ? session.characterID : "?"}: ${result ? result.errorMsg : "UNKNOWN_ERROR"}`,
      );
    }
    return result && result.response && result.response.type === "dict"
      ? result.response
      : { type: "dict", entries: [] };
  }

  Handle_ActivateShip(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    const oldShipID = args && args.length > 1 ? args[1] : null;
    log.info(
      `[Ship] ActivateShip(shipID=${String(shipID)}, oldShipID=${String(oldShipID)})`,
    );

    return this._activateShipById(shipID, session, "ActivateShip");
  }

  Handle_AssembleShip(args, session, kwargs) {
    const shipIds = this._extractShipIds(args && args.length > 0 ? args[0] : null);
    const stationID = getDockedLocationID(session) || 0;
    const charID = session && session.characterID ? session.characterID : 0;
    const rows = [];

    log.info(
      `[Ship] AssembleShip station=${stationID} shipIDs=${JSON.stringify(shipIds)}`,
    );

    for (const shipID of shipIds) {
      const shipItem = findCharacterShip(charID, shipID);
      if (!shipItem) {
        continue;
      }

      if (
        shipItem.locationID !== stationID ||
        shipItem.flagID !== ITEM_FLAGS.HANGAR ||
        shipItem.singleton === 1
      ) {
        continue;
      }

      const updateResult = setShipPackagingState(shipItem.itemID, false);
      if (!updateResult.success) {
        log.warn(
          `[Ship] AssembleShip failed for ${shipID}: ${updateResult.errorMsg}`,
        );
        continue;
      }

      syncInventoryItemForSession(
        session,
        updateResult.data,
        {
          locationID: updateResult.previousData.locationID,
          flagID: updateResult.previousData.flagID,
          quantity: updateResult.previousData.quantity,
          singleton: updateResult.previousData.singleton,
          stacksize: updateResult.previousData.stacksize,
        },
        {
          emitCfgLocation: false,
        },
      );

      rows.push(buildInventoryItemRow(updateResult.data));
    }

    return [
      {
        type: "list",
        items: rows,
      },
      {
        type: "dict",
        entries: [[10, 0]],
      },
    ];
  }

  Handle_LeaveShip(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    log.info(`[Ship] LeaveShip(shipID=${String(shipID)})`);
    if (session && !isDockedSession(session)) {
      const transitionResult = ejectSession(session);
      if (!transitionResult.success) {
        log.warn(
          `[Ship] LeaveShip failed in space for char=${session && session.characterID}: ${transitionResult.errorMsg}`,
        );
        return null;
      }
      return transitionResult.data && transitionResult.data.capsule
        ? transitionResult.data.capsule.itemID
        : null;
    }
    return this._leaveShip(session, shipID, "LeaveShip");
  }

  Handle_BoardStoredShip(args, session, kwargs) {
    const structureID = args && args.length > 0 ? args[0] : null;
    const shipID = args && args.length > 1 ? args[1] : null;
    log.info(
      `[Ship] BoardStoredShip(structureID=${String(structureID)}, shipID=${String(shipID)})`,
    );

    return this._activateShipById(shipID, session, "BoardStoredShip");
  }

  Handle_Board(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    const oldShipID = args && args.length > 1 ? args[1] : null;
    log.info(
      `[Ship] Board(shipID=${String(shipID)}, oldShipID=${String(oldShipID)})`,
    );

    if (session && !isDockedSession(session)) {
      const transitionResult = boardSpaceShip(session, shipID);
      if (!transitionResult.success) {
        log.warn(
          `[Ship] Board failed in space for shipID=${String(shipID)}: ${transitionResult.errorMsg}`,
        );
        return null;
      }

      const activeShip =
        (transitionResult.data && transitionResult.data.ship) ||
        getActiveShipRecord(session.characterID);
      return this._buildActivationResponse(activeShip, session);
    }

    return this._activateShipById(shipID, session, "Board");
  }

  Handle_Undock(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : this._getShipID(session);
    const ignoreContraband = args && args.length > 1 ? Boolean(args[1]) : false;

    log.info(
      `[Ship] Undock(shipID=${String(shipID)}, ignoreContraband=${ignoreContraband})`,
    );

    this._syncRequestedOnlineModulesForUndock(session, shipID, kwargs);

    const result = undockSession(session);
    if (!result.success) {
      log.warn(
        `[Ship] Undock failed for char=${session && session.characterID}: ${result.errorMsg}`,
      );
      return null;
    }

    return result.data.boundResult || null;
  }

  Handle_Eject(args, session, kwargs) {
    log.info("[Ship] Eject()");
    if (session && !isDockedSession(session)) {
      const transitionResult = ejectSession(session);
      if (!transitionResult.success) {
        log.warn(
          `[Ship] Eject failed in space for char=${session && session.characterID}: ${transitionResult.errorMsg}`,
        );
        return null;
      }
      return transitionResult.data && transitionResult.data.capsule
        ? transitionResult.data.capsule.itemID
        : null;
    }
    return this._leaveShip(session, null, "Eject");
  }

  Handle_GetTurretModules(args, session, kwargs) {
    log.debug("[Ship] GetTurretModules");
    const charID = session && session.characterID ? session.characterID : 0;
    const shipID = this._getShipID(session);
    return {
      type: "list",
      items: getTurretLikeModuleItems(charID, shipID).map((item) => item.itemID),
    };
  }

  Handle_GetShipConfiguration(args, session, kwargs) {
    const shipID =
      args && args.length > 0 ? args[0] : this._getShipID(session);
    log.debug(`[Ship] GetShipConfiguration(shipID=${String(shipID)})`);
    const configuration = this._getShipConfiguration(shipID);
    const allowFleetAccess = Boolean(
      configuration.SMB_AllowFleetAccess ?? configuration.allowFleetSMBUsage,
    );
    const allowCorpAccess = Boolean(
      configuration.SMB_AllowCorpAccess ?? configuration.allowCorpSMBUsage,
    );
    configuration.allowFleetSMBUsage = allowFleetAccess;
    configuration.SMB_AllowFleetAccess = allowFleetAccess;
    configuration.allowCorpSMBUsage = allowCorpAccess;
    configuration.SMB_AllowCorpAccess = allowCorpAccess;
    configuration.FleetHangar_AllowFleetAccess = allowFleetAccess;
    configuration.FleetHangar_AllowCorpAccess = allowCorpAccess;
    return {
      type: "dict",
      entries: [
        ["allowFleetSMBUsage", allowFleetAccess],
        ["SMB_AllowFleetAccess", allowFleetAccess],
        ["allowCorpSMBUsage", allowCorpAccess],
        ["SMB_AllowCorpAccess", allowCorpAccess],
        ["FleetHangar_AllowFleetAccess", allowFleetAccess],
        ["FleetHangar_AllowCorpAccess", allowCorpAccess],
      ],
    };
  }

  Handle_ConfigureShip(args, session, kwargs) {
    const configPayload =
      args && args.length > 0 && args[0] && typeof args[0] === "object"
        ? args[0]
        : null;
    const shipID = this._getShipID(session);
    const configuration = this._getShipConfiguration(shipID);

    if (configPayload && configPayload.type === "dict" && Array.isArray(configPayload.entries)) {
      for (const [key, value] of configPayload.entries) {
        if (
          key === "allowFleetSMBUsage" ||
          key === "SMB_AllowFleetAccess" ||
          key === "FleetHangar_AllowFleetAccess"
        ) {
          const normalizedValue = Boolean(value);
          configuration.allowFleetSMBUsage = normalizedValue;
          configuration.SMB_AllowFleetAccess = normalizedValue;
          configuration.FleetHangar_AllowFleetAccess = normalizedValue;
        } else if (
          key === "allowCorpSMBUsage" ||
          key === "SMB_AllowCorpAccess" ||
          key === "FleetHangar_AllowCorpAccess"
        ) {
          const normalizedValue = Boolean(value);
          configuration.allowCorpSMBUsage = normalizedValue;
          configuration.SMB_AllowCorpAccess = normalizedValue;
          configuration.FleetHangar_AllowCorpAccess = normalizedValue;
        }
      }
    } else if (configPayload && typeof configPayload === "object") {
      if (
        Object.prototype.hasOwnProperty.call(configPayload, "allowFleetSMBUsage") ||
        Object.prototype.hasOwnProperty.call(configPayload, "SMB_AllowFleetAccess") ||
        Object.prototype.hasOwnProperty.call(configPayload, "FleetHangar_AllowFleetAccess")
      ) {
        const normalizedValue = Boolean(
          Object.prototype.hasOwnProperty.call(configPayload, "FleetHangar_AllowFleetAccess")
            ? configPayload.FleetHangar_AllowFleetAccess
            : Object.prototype.hasOwnProperty.call(configPayload, "SMB_AllowFleetAccess")
            ? configPayload.SMB_AllowFleetAccess
            : configPayload.allowFleetSMBUsage,
        );
        configuration.allowFleetSMBUsage = normalizedValue;
        configuration.SMB_AllowFleetAccess = normalizedValue;
        configuration.FleetHangar_AllowFleetAccess = normalizedValue;
      }
      if (
        Object.prototype.hasOwnProperty.call(configPayload, "allowCorpSMBUsage") ||
        Object.prototype.hasOwnProperty.call(configPayload, "SMB_AllowCorpAccess") ||
        Object.prototype.hasOwnProperty.call(configPayload, "FleetHangar_AllowCorpAccess")
      ) {
        const normalizedValue = Boolean(
          Object.prototype.hasOwnProperty.call(configPayload, "FleetHangar_AllowCorpAccess")
            ? configPayload.FleetHangar_AllowCorpAccess
            : Object.prototype.hasOwnProperty.call(configPayload, "SMB_AllowCorpAccess")
            ? configPayload.SMB_AllowCorpAccess
            : configPayload.allowCorpSMBUsage,
        );
        configuration.allowCorpSMBUsage = normalizedValue;
        configuration.SMB_AllowCorpAccess = normalizedValue;
        configuration.FleetHangar_AllowCorpAccess = normalizedValue;
      }
    }

    log.debug(
      `[Ship] ConfigureShip(shipID=${String(shipID)} allowFleetSMBUsage=${configuration.allowFleetSMBUsage} SMB_AllowFleetAccess=${configuration.SMB_AllowFleetAccess} FleetHangar_AllowFleetAccess=${configuration.FleetHangar_AllowFleetAccess} allowCorpSMBUsage=${configuration.allowCorpSMBUsage} SMB_AllowCorpAccess=${configuration.SMB_AllowCorpAccess} FleetHangar_AllowCorpAccess=${configuration.FleetHangar_AllowCorpAccess})`,
    );
    return null;
  }

  Handle_SafeLogoff(args, session, kwargs) {
    log.info(
      `[Ship] SafeLogoff requested for char=${session ? session.characterID : "?"} ship=${session ? this._getShipID(session) : "?"}`,
    );

    // The live client treats the SafeLogoff response as an iterable of failed
    // condition labels. Returning an empty list means "all checks passed".
    return [];
  }

  Handle_MachoResolveObject(args, session, kwargs) {
    log.debug("[Ship] MachoResolveObject called");
    const config = require(path.join(__dirname, "../../config"));
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    const config = require(path.join(__dirname, "../../config"));
    const bindParams = args && args.length > 0 ? args[0] : null;
    const nestedCall = args && args.length > 1 ? args[1] : null;

    log.debug(
      `[Ship] MachoBindObject args.length=${args ? args.length : 0} bindParams=${JSON.stringify(bindParams, (k, v) => (typeof v === "bigint" ? v.toString() : v))} nestedCall=${JSON.stringify(nestedCall, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))}`,
    );

    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
    const oid = [idString, now];

    if (session) {
      if (!session._boundObjectIDs || typeof session._boundObjectIDs !== "object") {
        session._boundObjectIDs = {};
      }
      session._boundObjectIDs.ship = idString;
      session.lastBoundObjectID = idString;
    }

    let callResult = null;
    if (nestedCall && Array.isArray(nestedCall) && nestedCall.length >= 1) {
      const methodName = normalizeMethodName(nestedCall[0]);
      const callArgs = nestedCall.length > 1 ? nestedCall[1] : [];
      const callKwargs = nestedCall.length > 2 ? nestedCall[2] : null;

      log.debug(`[Ship] MachoBindObject nested call: ${methodName}`);
      callResult = this.callMethod(
        methodName,
        Array.isArray(callArgs) ? callArgs : [callArgs],
        session,
        callKwargs,
      );
    }

    return [
      {
        type: "substruct",
        value: { type: "substream", value: oid },
      },
      callResult != null ? callResult : null,
    ];
  }

  _isSafeLogoffRequest(methodName, context = {}) {
    if (methodName === "SafeLogoff") {
      return true;
    }

    if (methodName !== "MachoBindObject") {
      return false;
    }

    const nestedCall =
      context &&
      Array.isArray(context.args) &&
      context.args.length > 1
        ? context.args[1]
        : null;
    if (!Array.isArray(nestedCall) || nestedCall.length === 0) {
      return false;
    }

    return normalizeMethodName(nestedCall[0]) === "SafeLogoff";
  }

  _extractSafeLogoffFailedConditions(methodName, context = {}) {
    if (methodName === "SafeLogoff") {
      return Array.isArray(context.result) ? context.result : null;
    }

    if (methodName !== "MachoBindObject" || !Array.isArray(context.result)) {
      return null;
    }

    return Array.isArray(context.result[1]) ? context.result[1] : null;
  }

  _emitInstantSafeLogoffNotifications(session) {
    if (!session || typeof session.sendNotification !== "function") {
      return false;
    }

    const safeLogoffTime = buildCurrentFileTime() + SAFE_LOGOFF_TIMER_GRACE_TICKS;
    session.sendNotification("OnSafeLogoffTimerStarted", "clientID", [
      safeLogoffTime,
    ]);
    session.sendNotification("OnSafeLogoffActivated", "clientID", []);
    return true;
  }

  _completeInstantSafeLogoff(session, methodName) {
    const characterID = Number(session && session.characterID) || 0;
    if (characterID <= 0) {
      return;
    }

    const notificationsSent = this._emitInstantSafeLogoffNotifications(session);
    if (!notificationsSent) {
      log.warn(
        `[Ship] SafeLogoff could not notify client for char=${characterID}; continuing with server-side session clear`,
      );
    }

    const disconnectResult = disconnectCharacterSession(session, {
      broadcast: true,
      clearSession: true,
    });
    if (!disconnectResult.success) {
      log.warn(
        `[Ship] SafeLogoff disconnect failed for char=${characterID}: ${disconnectResult.errorMsg}`,
      );
      return;
    }

    log.info(
      `[Ship] SafeLogoff completed for char=${characterID} via ${methodName}`,
    );
  }

  afterCallResponse(methodName, session, context = {}) {
    if (!this._isSafeLogoffRequest(methodName, context)) {
      return;
    }

    const failedConditions = this._extractSafeLogoffFailedConditions(
      methodName,
      context,
    );
    if (!Array.isArray(failedConditions) || failedConditions.length > 0) {
      return;
    }

    this._completeInstantSafeLogoff(session, methodName);
  }

  callMethod(method, args, session, kwargs) {
    const response = super.callMethod(method, args, session, kwargs);
    if (response !== null) {
      return response;
    }

    log.warn(`[Ship] Unhandled method fallback: ${method}`);
    return null;
  }
}

module.exports = ShipService;
