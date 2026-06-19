/**
 * Inventory Broker Service (invbroker)
 *
 * Handles inventory/item queries from the client.
 * Called after character selection to load inventory data.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const rotatingLog = require(path.join(__dirname, "../../utils/rotatingLog"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const { resolveShipByTypeID } = require(path.join(
  __dirname,
  "../chat/shipTypeRegistry",
));
const {
  getCharacterShips,
  findCharacterShip,
  getActiveShipRecord,
  shouldFlushDeferredDockedShipSessionChange,
  flushDeferredDockedShipSessionChange,
  completeDockedFittingBootstrap,
  syncInventoryItemForSession,
  syncShipFittingStateForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  ITEM_FLAGS,
  FIGHTER_TUBE_FLAGS,
  listContainerItems,
  findItemById,
  findShipItemById,
  getItemMetadata,
  grantItemToCharacterLocation,
  moveItemToLocation,
  removeInventoryItem,
  takeItemTypeFromCharacterLocation,
  transferItemToOwnerLocation,
  mergeItemStacks,
} = require(path.join(__dirname, "./itemStore"));
const {
  getCorporationOfficeByInventoryID,
} = require(path.join(__dirname, "../corporation/corporationRuntimeState"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "./itemTypeRegistry"));
const {
  isShipFittingFlag,
  listFittedItems,
  selectAutoFitFlagForType,
  validateFitForShip,
  getShipBaseAttributeValue,
  getLoadedChargeItems,
  buildChargeTupleItemID,
  SLOT_FAMILY_FLAGS,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  getShipFittingSnapshot,
} = require(path.join(__dirname, "../../_secondary/fitting/fittingRuntime"));
const {
  clearModuleFromBanksAndNotify,
  getMasterModuleID: getWeaponBankMasterModuleID,
  notifyWeaponBanksChanged,
  getShipWeaponBanks,
} = require(path.join(__dirname, "../moduleGrouping/moduleGroupingRuntime"));
const {
  MINING_SHIP_BAY_FLAGS,
  isItemTypeAllowedInHoldFlag,
  getShipHoldCapacityByFlag,
} = require(path.join(__dirname, "../mining/miningInventory"));
const {
  isFuelBayFlag,
  isStructureFuelBayFlag,
  isFuelBayCompatibleItem,
  getFuelBayCapacity,
  STRUCTURE_FUEL_BAY_FLAG,
} = require(path.join(__dirname, "./fuelBayInventory"));
const {
  isDroneItemRecord,
  isFighterItemRecord,
  isFighterTubeFlag,
} = require(path.join(__dirname, "../fighter/fighterInventory"));
const runtime = require(path.join(__dirname, "../../space/runtime"));
const nativeNpcStore = require(path.join(__dirname, "../../space/npc/nativeNpcStore"));
const nativeNpcWreckService = require(path.join(__dirname, "../../space/npc/nativeNpcWreckService"));
const {
  maybeExpireEmptySpaceContainer,
} = require(path.join(__dirname, "../ship/jettisonRuntime"));
const {
  DEFAULT_STATION,
  getStationRecord,
} = require(path.join(__dirname, "../_shared/stationStaticData"));
const structureState = require(path.join(
  __dirname,
  "../structure/structureState",
));
const {
  isStructureServiceSlotFlag,
  syncStructureServiceModuleState,
} = require(path.join(__dirname, "../structure/structureServiceModules"));
const {
  getCharacterSkills,
  SKILL_FLAG_ID,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  describeSessionHydrationState,
} = require(path.join(__dirname, "../chat/commandSessionEffects"));
const {
  getDockedLocationID,
  isDockedSession,
} = require(path.join(__dirname, "../structure/structureLocation"));
const {
  buildList,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  JOURNAL_ENTRY_TYPE,
  adjustCharacterBalance,
  buildNotEnoughMoneyUserErrorValues,
  getCharacterWallet,
} = require(path.join(__dirname, "../account/walletState"));
const planetCostCalculator = require(path.join(
  __dirname,
  "../planet/planetCostCalculator",
));
const planetRuntimeStore = require(path.join(
  __dirname,
  "../planet/planetRuntimeStore",
));
const planetOrbitalState = require(path.join(
  __dirname,
  "../planet/planetOrbitalState",
));
const fleetRuntime = require(path.join(__dirname, "../fleets/fleetRuntime"));

const inventoryDebugPath = path.join(
  __dirname,
  "../../../logs/inventory-debug.log",
);
const CANNOT_TRASH_ERROR = "CannotTrashItem";
const CONTAINER_HANGAR_ID = 10004;
const CONTAINER_CORP_MARKET_ID = 10012;
const CONTAINER_STRUCTURE_ID = 10014;
const CONTAINER_CAPSULEER_DELIVERIES_ID = 10015;
const CHARACTER_TYPE_ID = 1373;
const CHARACTER_GROUP_ID = 1;
const CHARACTER_CATEGORY_ID = 3;
const STATION_TYPE_ID = DEFAULT_STATION.stationTypeID;
const STATION_GROUP_ID = 15;
const STATION_CATEGORY_ID = 3;
const STATION_OWNER_ID = DEFAULT_STATION.ownerID;
const INVENTORY_ROW_HEADER = {
  type: "list",
  items: [
    "itemID",
    "typeID",
    "ownerID",
    "locationID",
    "flagID",
    "quantity",
    "groupID",
    "categoryID",
    "customInfo",
    "stacksize",
    "singleton",
  ],
};
const INVENTORY_ROW_DESCRIPTOR_COLUMNS = [
  ["itemID", 20],
  ["typeID", 3],
  ["ownerID", 3],
  ["locationID", 20],
  ["flagID", 2],
  ["quantity", 3],
  ["groupID", 3],
  ["categoryID", 3],
  ["customInfo", 129],
];
const INVENTORY_ROW_DESCRIPTOR_VIRTUAL_COLUMNS = [
  ["stacksize", { type: "token", value: "eve.common.script.sys.eveCfg.StackSize" }],
  ["singleton", { type: "token", value: "eve.common.script.sys.eveCfg.Singleton" }],
];
const CHARGE_SUBLOCATION_ROW_DESCRIPTOR_COLUMNS = [
  ["itemID", 129],
  ["typeID", 3],
  ["ownerID", 3],
  ["locationID", 20],
  ["flagID", 2],
  ["quantity", 3],
  ["groupID", 3],
  ["categoryID", 3],
  ["customInfo", 129],
];
const SHIP_BAY_FLAGS = new Set([
  ITEM_FLAGS.HANGAR,
  ITEM_FLAGS.CARGO_HOLD,
  ITEM_FLAGS.FUEL_BAY,
  ITEM_FLAGS.DRONE_BAY,
  ITEM_FLAGS.FIGHTER_BAY,
  ITEM_FLAGS.SHIP_HANGAR,
  ITEM_FLAGS.SPECIALIZED_COMMAND_CENTER_HOLD,
  ITEM_FLAGS.COLONY_RESOURCES_HOLD,
  ...FIGHTER_TUBE_FLAGS,
  ...MINING_SHIP_BAY_FLAGS,
]);
const CORP_HANGAR_FLAGS = new Set([115, 116, 117, 118, 119, 120, 121, 184]);
const STRUCTURE_DEED_GROUP_ID = 4086;
const STRUCTURE_OWNER_BAY_FLAGS = new Set([
  ITEM_FLAGS.CARGO_HOLD,
  ITEM_FLAGS.FIGHTER_BAY,
  ITEM_FLAGS.STRUCTURE_DEED,
  STRUCTURE_FUEL_BAY_FLAG,
]);

function appendInventoryDebug(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    rotatingLog.append(inventoryDebugPath, `[${new Date().toISOString()}] ${entry}\n`);
  } catch (error) {
    log.warn(`[InvBroker] Failed to write inventory debug log: ${error.message}`);
  }
}

class InvBrokerService extends BaseService {
  constructor() {
    super("invbroker");
    this._boundContexts = new Map();
  }

  _getStationId(session) {
    return getDockedLocationID(session) || 0;
  }

  _getCharacterId(session) {
    return (
      (session && (session.characterID || session.charid || session.userid)) ||
      140000001
    );
  }

  _getCorporationId(session) {
    return (
      (session && (session.corporationID || session.corpid)) ||
      0
    );
  }

  _getCorporationOffice(session, inventoryID = null) {
    const corporationID = this._getCorporationId(session);
    const numericInventoryID = this._normalizeInventoryId(inventoryID, 0);
    if (corporationID <= 0 || numericInventoryID <= 0) {
      return null;
    }

    return getCorporationOfficeByInventoryID(corporationID, numericInventoryID);
  }

  _isCorporationHangarFlag(flagID) {
    return CORP_HANGAR_FLAGS.has(this._normalizeInventoryId(flagID, 0));
  }

  _getShipId(session) {
    const charId = this._getCharacterId(session);
    const activeShip = getActiveShipRecord(charId);
    return (
      (activeShip && activeShip.shipID) ||
      (session && (session.activeShipID || session.shipID || session.shipid)) ||
      140000101
    );
  }

  _getShipTypeId(session) {
    const charId = this._getCharacterId(session);
    const activeShip = getActiveShipRecord(charId);
    const shipTypeID = activeShip ? activeShip.shipTypeID : (
      session && Number.isInteger(session.shipTypeID) ? session.shipTypeID : null
    );
    return shipTypeID && shipTypeID > 0 ? shipTypeID : 606;
  }

  _getStoredShips(session) {
    const charId = this._getCharacterId(session);
    return getCharacterShips(charId);
  }

  _describeValue(value, depth = 0) {
    if (depth > 4) {
      return "<max-depth>";
    }

    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    if (Buffer.isBuffer(value)) {
      return `<Buffer:${value.toString("utf8")}>`;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this._describeValue(entry, depth + 1));
    }

    if (typeof value === "object") {
      const summary = {};
      for (const [key, entryValue] of Object.entries(value)) {
        summary[key] = this._describeValue(entryValue, depth + 1);
      }
      return summary;
    }

    return String(value);
  }

  _traceInventory(method, session, payload = {}) {
    const entry = {
      method,
      charId: this._getCharacterId(session),
      stationId: this._getStationId(session),
      activeShipId: this._getShipId(session),
      boundContext: this._getBoundContext(session),
      spaceHydrationState: session && session._space
        ? describeSessionHydrationState(session)
        : null,
      ...payload,
    };
    appendInventoryDebug(JSON.stringify(this._describeValue(entry)));
  }

  _summarizeInventoryRowsForLog(items, limit = 12) {
    const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
    const summary = {
      total: safeItems.length,
      cargo: 0,
      modules: 0,
      charges: 0,
      drones: 0,
      others: 0,
      preview: [],
    };

    for (const item of safeItems) {
      const itemID = this._normalizeInventoryId(item && item.itemID, 0);
      const flagID = this._normalizeInventoryId(item && item.flagID, 0);
      const typeID = this._normalizeInventoryId(item && item.typeID, 0);
      const groupID = this._normalizeInventoryId(item && item.groupID, 0);
      const categoryID = this._normalizeInventoryId(item && item.categoryID, 0);
      const quantity = Number(item && (item.stacksize ?? item.quantity) || 0);

      if (flagID === ITEM_FLAGS.CARGO_HOLD) {
        summary.cargo += 1;
      }
      if (categoryID === 7) {
        summary.modules += 1;
      } else if (categoryID === 8) {
        summary.charges += 1;
      } else if (categoryID === 18) {
        summary.drones += 1;
      } else if (categoryID !== 0) {
        summary.others += 1;
      }

      if (summary.preview.length < limit) {
        summary.preview.push(
          `${itemID}:${flagID}:${typeID}:${groupID}:${categoryID}:${quantity}`,
        );
      }
    }

    return summary;
  }

  _rememberBoundContext(oidString, context) {
    if (!oidString) {
      return;
    }

    this._boundContexts.set(oidString, {
      inventoryID: context.inventoryID ?? null,
      locationID: context.locationID ?? null,
      flagID: context.flagID ?? null,
      kind: context.kind || "inventory",
    });
  }

  _getBoundContext(session) {
    if (!session || !session.currentBoundObjectID) {
      return null;
    }

    return this._boundContexts.get(session.currentBoundObjectID) || null;
  }

  _extractBoundObjectId(value) {
    if (!value) {
      return null;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        const boundId = this._extractBoundObjectId(entry);
        if (boundId) {
          return boundId;
        }
      }
      return null;
    }

    if (
      value &&
      value.type === "substruct" &&
      value.value &&
      value.value.type === "substream" &&
      Array.isArray(value.value.value) &&
      value.value.value.length > 0
    ) {
      return value.value.value[0] || null;
    }

    return null;
  }

  _hasLoginInventoryBootstrapPending(session) {
    if (!session) {
      return false;
    }

    return (
      session._loginInventoryBootstrapPending === true ||
      (session._space &&
        session._space.loginInventoryBootstrapPending === true)
    );
  }

  _clearLoginInventoryBootstrapPending(session) {
    if (!session) {
      return;
    }

    session._loginInventoryBootstrapPending = false;
    if (session._space) {
      session._space.loginInventoryBootstrapPending = false;
    }
  }

  _markLoginShipInventoryListed(session) {
    if (!session || !session._space) {
      return;
    }

    session._space.loginShipInventoryListed = true;
  }

  _buildBayDogmaBootstrapKey(items = []) {
    const normalizedItems = Array.isArray(items) ? items : [];
    if (normalizedItems.length <= 0) {
      return "";
    }

    return normalizedItems
      .map((item) => {
        const itemID = this._normalizeInventoryId(item && item.itemID, 0);
        const stacksize = Math.max(0, Number(item && item.stacksize) || 0);
        return `${itemID}:${stacksize}`;
      })
      .sort()
      .join("|");
  }

  _primeInSpaceBayDogmaItems(session, boundContext, flagID, items = []) {
    if (
      !session ||
      !session._space ||
      typeof session.sendNotification !== "function" ||
      !this._isActiveInSpaceShipInventory(session, boundContext)
    ) {
      return false;
    }

    const numericFlagID = this._normalizeInventoryId(flagID, 0);
    if (numericFlagID !== ITEM_FLAGS.DRONE_BAY) {
      return false;
    }

    const normalizedItems = (Array.isArray(items) ? items : []).filter(
      (item) =>
        item &&
        this._normalizeInventoryId(item.locationID, 0) ===
          this._normalizeInventoryId(boundContext && boundContext.inventoryID, 0) &&
        this._normalizeInventoryId(item.flagID, 0) === numericFlagID,
    );

    if (!session._space.inventoryBayDogmaBootstrapKeys) {
      session._space.inventoryBayDogmaBootstrapKeys = Object.create(null);
    }

    const nextBootstrapKey = this._buildBayDogmaBootstrapKey(normalizedItems);
    const previousBootstrapKey =
      session._space.inventoryBayDogmaBootstrapKeys[numericFlagID] || "";
    if (previousBootstrapKey === nextBootstrapKey) {
      return false;
    }

    for (const item of normalizedItems) {
      syncInventoryItemForSession(
        session,
        item,
        {
          locationID: item.locationID,
          flagID: item.flagID,
          quantity: item.quantity,
          singleton: item.singleton,
          stacksize: item.stacksize,
        },
        {
          emitCfgLocation: false,
        },
      );
    }

    session._space.inventoryBayDogmaBootstrapKeys[numericFlagID] =
      nextBootstrapKey;
    return normalizedItems.length > 0;
  }

  _isChargeTupleItemID(value) {
    return (
      Array.isArray(value) &&
      value.length === 3 &&
      value.every((entry) => this._normalizeInventoryId(entry, 0) > 0)
    );
  }

  _buildActiveShipLoadedChargeTupleRows(session, boundContext, requestedFlag) {
    if (
      !this._isActiveInSpaceShipInventory(session, boundContext) ||
      requestedFlag !== null
    ) {
      return [];
    }

    const shipID = this._normalizeInventoryId(
      boundContext && boundContext.inventoryID,
      0,
    );
    const charID = this._getCharacterId(session);
    if (shipID <= 0 || charID <= 0) {
      return [];
    }

    return getLoadedChargeItems(charID, shipID)
      .filter((item) => (
        item &&
        this._normalizeInventoryId(item.locationID, 0) === shipID &&
        isShipFittingFlag(item.flagID) &&
        this._normalizeInventoryId(item.categoryID, 0) === 8
      ))
      .sort((left, right) => (
        this._normalizeInventoryId(left && left.flagID, 0) -
          this._normalizeInventoryId(right && right.flagID, 0) ||
        this._normalizeInventoryId(left && left.typeID, 0) -
          this._normalizeInventoryId(right && right.typeID, 0) ||
        this._normalizeInventoryId(left && left.itemID, 0) -
          this._normalizeInventoryId(right && right.itemID, 0)
      ))
      .map((item) => {
        const quantity = Math.max(
          0,
          Number(item.stacksize ?? item.quantity ?? 0) || 0,
        );
        return {
          itemID: buildChargeTupleItemID(shipID, item.flagID, item.typeID),
          typeID: this._normalizeInventoryId(item.typeID, 0),
          ownerID: this._normalizeInventoryId(item.ownerID, charID),
          locationID: shipID,
          flagID: this._normalizeInventoryId(item.flagID, 0),
          quantity,
          groupID: this._normalizeInventoryId(item.groupID, 0),
          categoryID: 8,
          customInfo: item.customInfo || "",
          singleton: Number(item.singleton) === 1 ? 1 : 0,
          stacksize: quantity,
        };
      })
      .filter((item) => (
        this._isChargeTupleItemID(item.itemID) &&
        item.typeID > 0 &&
        item.flagID > 0
      ));
  }

  _mergeActiveShipLoadedChargeTupleRows(
    session,
    boundContext,
    requestedFlag,
    items = [],
  ) {
    const activeShipID = this._normalizeInventoryId(
      boundContext && boundContext.inventoryID,
      0,
    );
    const baseItems = (Array.isArray(items) ? items : []).filter((item) => !(
      activeShipID > 0 &&
      item &&
      this._normalizeInventoryId(item.locationID, 0) === activeShipID &&
      this._normalizeInventoryId(item.categoryID, 0) === 8 &&
      isShipFittingFlag(item.flagID)
    ));
    const tupleRows = this._buildActiveShipLoadedChargeTupleRows(
      session,
      boundContext,
      requestedFlag,
    );
    if (tupleRows.length === 0) {
      return baseItems;
    }

    const seenTupleKeys = new Set(
      baseItems
        .map((item) => item && item.itemID)
        .filter((itemID) => this._isChargeTupleItemID(itemID))
        .map((itemID) => itemID
          .map((entry) => this._normalizeInventoryId(entry, 0))
          .join(":")),
    );
    const mergedRows = [...baseItems];
    for (const tupleRow of tupleRows) {
      const tupleKey = tupleRow.itemID.join(":");
      if (seenTupleKeys.has(tupleKey)) {
        continue;
      }
      seenTupleKeys.add(tupleKey);
      mergedRows.push(tupleRow);
    }
    return mergedRows;
  }

  _isActiveShipInventory(session, boundContext) {
    if (
      !session ||
      !boundContext ||
      boundContext.kind !== "shipInventory"
    ) {
      return false;
    }

    const activeShipID = this._normalizeInventoryId(
      (session._space && session._space.shipID) ||
        session.activeShipID ||
        session.shipID ||
        session.shipid ||
        this._getShipId(session),
      0,
    );
    const boundInventoryID = this._normalizeInventoryId(
      boundContext.inventoryID,
      0,
    );

    return activeShipID > 0 && boundInventoryID === activeShipID;
  }

  _isActiveInSpaceShipInventory(session, boundContext) {
    if (
      !this._isActiveShipInventory(session, boundContext) ||
      !session ||
      isDockedSession(session)
    ) {
      return false;
    }

    return true;
  }

  _shouldPrimeLoginShipInventoryBootstrap(session, boundContext, options = {}) {
    void session;
    void boundContext;
    void options;
    return false;
  }

  _primeDeferredSpaceBallparkVisuals(
    session,
    boundContext = null,
    options = {},
  ) {
    if (
      !this._isActiveInSpaceShipInventory(session, boundContext) ||
      !session ||
      !session._space
    ) {
      return false;
    }

    if (
      session._space.initialBallparkVisualsSent === true ||
      session._space.initialStateSent === true
    ) {
      return false;
    }

    // Direct login keeps restore-time attach as "no bootstrap yet" so the
    // packaged client can finish spinning up Michelle/GameUI first. Once the
    // active ship inventory is already being bound, it is safe to seed just
    // the AddBalls2 visual half early, while still leaving the authoritative
    // SetState for the later beyonce bind.
    if (session._space.beyonceBound !== true) {
      session._space.deferInitialBallparkStateUntilBind = true;
    }

    const startedAtMs = Date.now();
    const primed = runtime.ensureInitialBallpark(session, {
      allowDeferredJumpBootstrapVisuals: true,
    });
    const elapsedMs = Date.now() - startedAtMs;
    if (
      runtime &&
      typeof runtime.recordSessionJumpTimingTrace === "function"
    ) {
      runtime.recordSessionJumpTimingTrace(
        session,
        "invbroker-prime-deferred-ballpark",
        {
          primed: primed === true,
          elapsedMs,
          reason:
            typeof options.reason === "string" && options.reason.trim().length > 0
              ? options.reason.trim()
              : "unknown",
          beyonceBound: session._space.beyonceBound === true,
        },
      );
    }
    if (primed) {
      log.debug(
        `[InvBroker] Primed deferred ballpark visuals source=${
          typeof options.reason === "string" && options.reason.trim().length > 0
            ? options.reason.trim()
            : "unknown"
        } ${describeSessionHydrationState(session)}`,
      );
    }
    if (elapsedMs >= 100) {
      log.info(
        `[InvBroker] Deferred ballpark prime source=${
          typeof options.reason === "string" && options.reason.trim().length > 0
            ? options.reason.trim()
            : "unknown"
        } took ${elapsedMs}ms primed=${primed ? 1 : 0}`,
      );
    }
    return primed;
  }

  _primePendingSpaceShipInventoryBootstrap(
    session,
    boundContext = null,
    options = {},
  ) {
    if (!session || !session._space) {
      return;
    }

    session._space.loginShipInventoryPrimed = true;
    this._primeDeferredSpaceBallparkVisuals(session, boundContext, {
      reason:
        typeof options.reason === "string" && options.reason.trim().length > 0
          ? options.reason.trim()
          : "shipInventoryPrime",
    });
  }

  _isInitialLoginSpaceShipInventoryList(session, boundContext) {
    if (
      !session ||
      !this._hasLoginInventoryBootstrapPending(session) ||
      !this._isActiveShipInventory(session, boundContext) ||
      isDockedSession(session)
    ) {
      return false;
    }

    return true;
  }

  _makeBoundSubstruct(context) {
    const config = require(path.join(__dirname, "../../config"));
    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;

    this._rememberBoundContext(idString, context);

    return {
      type: "substruct",
      value: {
        type: "substream",
        value: [idString, now],
      },
    };
  }

  _getShipMetadata(session, shipTypeID = null, shipName = null) {
    const resolvedShipTypeID = shipTypeID || this._getShipTypeId(session);
    return (
      resolveShipByTypeID(resolvedShipTypeID) || {
        typeID: resolvedShipTypeID,
        name: shipName || (session && session.shipName) || "Ship",
        groupID: 25,
        categoryID: 6,
      }
    );
  }

  _extractKwarg(kwargs, key) {
    if (!kwargs || typeof kwargs !== "object") return undefined;

    if (Object.prototype.hasOwnProperty.call(kwargs, key)) {
      return kwargs[key];
    }

    if (kwargs.type === "dict" && Array.isArray(kwargs.entries)) {
      for (const [k, v] of kwargs.entries) {
        const dictKey = Buffer.isBuffer(k) ? k.toString("utf8") : k;
        if (dictKey === key) {
          return v;
        }
      }
    }

    return undefined;
  }

  _normalizeInventoryId(value, fallback = 0) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
  }

  _normalizeFlagList(value) {
    if (Array.isArray(value)) {
      return value
        .map((entry) => this._normalizeInventoryId(entry, NaN))
        .filter(Number.isFinite);
    }

    if (value && value.type === "list" && Array.isArray(value.items)) {
      return value.items
        .map((entry) => this._normalizeInventoryId(entry, NaN))
        .filter(Number.isFinite);
    }

    return [];
  }

  _normalizeItemIdList(value) {
    if (Array.isArray(value)) {
      return value
        .map((entry) => this._normalizeInventoryId(entry, NaN))
        .filter(Number.isFinite)
        .filter((entry) => entry > 0);
    }

    if (value && value.type === "list" && Array.isArray(value.items)) {
      return value.items
        .map((entry) => this._normalizeInventoryId(entry, NaN))
        .filter(Number.isFinite)
        .filter((entry) => entry > 0);
    }

    const numericValue = this._normalizeInventoryId(value, 0);
    return numericValue > 0 ? [numericValue] : [];
  }

  _normalizeMergeOps(value) {
    const rawOps =
      Array.isArray(value)
        ? value
        : value && value.type === "list" && Array.isArray(value.items)
          ? value.items
          : [];

    return rawOps
      .map((entry) => {
        const tuple = Array.isArray(entry)
          ? entry
          : entry && entry.type === "tuple" && Array.isArray(entry.items)
            ? entry.items
            : [];
        if (tuple.length < 2) {
          return null;
        }

        const sourceItemID = this._normalizeInventoryId(tuple[0], 0);
        const destinationItemID = this._normalizeInventoryId(tuple[1], 0);
        const quantity = this._normalizeQuantityArg(tuple[2]);
        if (sourceItemID <= 0 || destinationItemID <= 0) {
          return null;
        }

        return {
          sourceItemID,
          destinationItemID,
          quantity,
        };
      })
      .filter(Boolean);
  }

  _normalizeQuantityArg(value) {
    if (value === undefined || value === null) {
      return null;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return null;
    }

    const normalizedValue = Math.trunc(numericValue);
    return normalizedValue > 0 ? normalizedValue : null;
  }

  _normalizeCommodityDict(value) {
    const rawValue = unwrapMarshalValue(value);
    if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
      return {};
    }

    const commodities = {};
    for (const [rawKey, rawQuantity] of Object.entries(rawValue)) {
      const key = this._normalizeInventoryId(rawKey, 0);
      const quantity = this._normalizeQuantityArg(rawQuantity);
      if (key > 0 && quantity > 0) {
        commodities[String(key)] = (commodities[String(key)] || 0) + quantity;
      }
    }
    return commodities;
  }

  _buildPIImportCommoditiesFromItems(importData, customsOfficeID, characterID) {
    const importItemQuantities = this._normalizeCommodityDict(importData);
    const commodities = {};
    const items = [];
    for (const [rawItemID, quantity] of Object.entries(importItemQuantities)) {
      const itemID = this._normalizeInventoryId(rawItemID, 0);
      const item = findItemById(itemID);
      if (
        !item ||
        this._normalizeInventoryId(item.ownerID, 0) !== characterID ||
        this._normalizeInventoryId(item.locationID, 0) !== customsOfficeID ||
        this._normalizeInventoryId(item.flagID, 0) !== ITEM_FLAGS.HANGAR
      ) {
        throwWrappedUserError("CannotImportCommoditiesNotFound");
      }

      const availableQuantity = this._normalizeInventoryId(
        item.singleton === 1 ? 1 : item.stacksize ?? item.quantity,
        0,
      );
      if (availableQuantity < quantity) {
        throwWrappedUserError("CannotImportCommoditiesNotFound");
      }

      const typeID = this._normalizeInventoryId(item.typeID, 0);
      commodities[String(typeID)] = (commodities[String(typeID)] || 0) + quantity;
      items.push({ itemID, typeID, quantity });
    }
    return { commodities, items };
  }

  _throwNotEnoughMoney(requiredAmount, currentBalance) {
    throwWrappedUserError(
      "NotEnoughMoney",
      buildNotEnoughMoneyUserErrorValues(requiredAmount, currentBalance),
    );
  }

  _ensurePIWalletCanCover(characterID, amount) {
    const normalizedAmount = Number(amount) || 0;
    if (!(normalizedAmount > 0)) {
      return;
    }

    const wallet = getCharacterWallet(characterID);
    if (!wallet) {
      throwWrappedUserError("CustomNotify", {
        notify: "Cannot charge PI wallet: character wallet not found.",
      });
    }
    if (wallet.balance < normalizedAmount) {
      this._throwNotEnoughMoney(normalizedAmount, wallet.balance);
    }
  }

  _debitPIWallet(characterID, amount, entryTypeID, referenceID, description) {
    const normalizedAmount = Number(amount) || 0;
    if (!(normalizedAmount > 0)) {
      return null;
    }

    const wallet = getCharacterWallet(characterID);
    if (!wallet) {
      throwWrappedUserError("CustomNotify", {
        notify: "Cannot charge PI wallet: character wallet not found.",
      });
    }

    const debitResult = adjustCharacterBalance(characterID, -normalizedAmount, {
      entryTypeID,
      referenceID,
      ownerID1: characterID,
      ownerID2: referenceID,
      description,
    });
    if (!debitResult.success) {
      if (debitResult.errorMsg === "INSUFFICIENT_FUNDS") {
        this._throwNotEnoughMoney(normalizedAmount, wallet.balance);
      }
      throwWrappedUserError("CustomNotify", {
        notify: `Cannot charge PI wallet: ${debitResult.errorMsg || "wallet debit failed"}.`,
      });
    }
    return debitResult;
  }

  _refundPIWalletDebits(characterID, debitResults = [], description = "PI tax refund") {
    for (const debitResult of debitResults.filter(Boolean)) {
      const amount = Math.abs(Number(debitResult.delta) || 0);
      if (!(amount > 0)) {
        continue;
      }
      adjustCharacterBalance(characterID, amount, {
        entryTypeID: debitResult.journalEntry && debitResult.journalEntry.entryTypeID,
        referenceID: debitResult.journalEntry && debitResult.journalEntry.referenceID,
        ownerID1: characterID,
        ownerID2: debitResult.journalEntry && debitResult.journalEntry.ownerID2,
        description,
      });
    }
  }

  _extractFitFittingEntryPairs(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    if (value instanceof Map) {
      return [...value.entries()];
    }

    if (value.type === "dict" && Array.isArray(value.entries)) {
      return value.entries;
    }

    if (
      (value.type === "objectex1" || value.type === "objectex2") &&
      Array.isArray(value.dict)
    ) {
      return value.dict;
    }

    if (
      value.type === "object" &&
      value.args &&
      value.args.type === "dict" &&
      Array.isArray(value.args.entries)
    ) {
      return value.args.entries;
    }

    return null;
  }

  _appendFitFittingItemsByType(byType, rawTypeID, rawItemIDs) {
    const typeID = this._normalizeInventoryId(unwrapMarshalValue(rawTypeID), 0);
    if (typeID <= 0) {
      return;
    }

    const unwrappedItemIDs = unwrapMarshalValue(rawItemIDs);
    const itemIDs = (Array.isArray(unwrappedItemIDs) ? unwrappedItemIDs : [unwrappedItemIDs])
      .map((entry) => this._normalizeInventoryId(unwrapMarshalValue(entry), 0))
      .filter((entry) => entry > 0);
    if (itemIDs.length <= 0) {
      return;
    }

    const existingItemIDs = byType.get(typeID) || [];
    existingItemIDs.push(...itemIDs);
    byType.set(typeID, existingItemIDs);
  }

  _normalizeFitFittingItemsByType(value) {
    const byType = new Map();
    const rawEntryPairs = this._extractFitFittingEntryPairs(value);
    if (Array.isArray(rawEntryPairs)) {
      for (const [rawTypeID, rawItemIDs] of rawEntryPairs) {
        this._appendFitFittingItemsByType(byType, rawTypeID, rawItemIDs);
      }

      return byType;
    }

    const unwrapped = unwrapMarshalValue(value);
    const unwrappedEntryPairs =
      unwrapped && typeof unwrapped === "object" && Array.isArray(unwrapped.dict)
        ? unwrapped.dict
        : null;
    if (Array.isArray(unwrappedEntryPairs)) {
      for (const [rawTypeID, rawItemIDs] of unwrappedEntryPairs) {
        this._appendFitFittingItemsByType(byType, rawTypeID, rawItemIDs);
      }

      return byType;
    }

    const source =
      unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)
        ? unwrapped
        : {};

    for (const [rawTypeID, rawItemIDs] of Object.entries(source)) {
      this._appendFitFittingItemsByType(byType, rawTypeID, rawItemIDs);
    }

    return byType;
  }

  _normalizeFitFittingModulesByFlag(value) {
    const unwrapped = unwrapMarshalValue(value);
    const payload =
      unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)
        ? unwrapped
        : {};
    const source =
      payload.modulesByFlag &&
      typeof payload.modulesByFlag === "object" &&
      !Array.isArray(payload.modulesByFlag)
        ? payload.modulesByFlag
        : payload;

    return Object.entries(source)
      .map(([rawFlagID, rawTypeID]) => ({
        flagID: this._normalizeInventoryId(rawFlagID, 0),
        typeID: this._normalizeInventoryId(rawTypeID, 0),
      }))
      .filter((entry) => entry.flagID > 0 && entry.typeID > 0)
      .sort((left, right) => left.flagID - right.flagID);
  }

  _resolveMoveQuantity(item, destination, requestedQuantity = null) {
    if (this._isStructureCoreInstallMove(item, destination)) {
      return 1;
    }

    if (requestedQuantity !== null && requestedQuantity !== undefined) {
      return requestedQuantity;
    }

    // CCP's "Fit to Active Ship" path sends Add/MultiAdd with flagAutoFit and
    // no explicit qty. For a stackable source item, fitting should split off a
    // single unit into the ship slot and leave the remainder of the stack in
    // the source container.
    if (
      item &&
      Number(item.singleton) !== 1 &&
      destination &&
      isShipFittingFlag(destination.flagID)
    ) {
      return 1;
    }

    return requestedQuantity;
  }

  _resolveAppliedMoveQuantity(item, destination, requestedQuantity = null) {
    const resolvedQuantity = this._resolveMoveQuantity(
      item,
      destination,
      requestedQuantity,
    );
    if (resolvedQuantity !== null && resolvedQuantity !== undefined) {
      return Math.max(1, Number(resolvedQuantity) || 1);
    }

    if (!item) {
      return 0;
    }

    return Number(item.singleton) === 1
      ? 1
      : Math.max(1, Number(item.stacksize ?? item.quantity ?? 1) || 1);
  }

  _isStructureDeedDestination(destination) {
    return (
      this._normalizeInventoryId(destination && destination.flagID, 0) ===
      ITEM_FLAGS.STRUCTURE_DEED
    );
  }

  _isStructureOwnerBayFlag(flagID) {
    return STRUCTURE_OWNER_BAY_FLAGS.has(this._normalizeInventoryId(flagID, 0));
  }

  _getStructureInventoryOwnerID(structure) {
    return this._normalizeInventoryId(
      structure && (structure.ownerCorpID || structure.ownerID),
      0,
    );
  }

  _getStructureForInventoryID(inventoryID) {
    const structureID = this._normalizeInventoryId(inventoryID, 0);
    return structureID > 0
      ? structureState.getStructureByID(structureID, { refresh: false })
      : null;
  }

  _isControlledStructureInventoryID(session, inventoryID) {
    const structureID = this._normalizeInventoryId(inventoryID, 0);
    if (structureID <= 0) {
      return false;
    }

    const sessionStructureID = this._normalizeInventoryId(
      session && (session.structureID || session.structureid),
      0,
    );
    const sessionShipID = this._normalizeInventoryId(
      session && (session.shipID || session.shipid),
      0,
    );
    return (
      sessionStructureID === structureID &&
      sessionShipID === structureID &&
      Boolean(this._getStructureForInventoryID(structureID))
    );
  }

  _getStructureForDeedDestination(destination) {
    if (!this._isStructureDeedDestination(destination)) {
      return null;
    }

    return this._getStructureForInventoryID(destination.locationID);
  }

  _getStructureForOwnerBayDestination(destination) {
    if (!destination || !this._isStructureOwnerBayFlag(destination.flagID)) {
      return null;
    }
    return this._getStructureForInventoryID(destination.locationID);
  }

  _getRequiredStructureCoreTypeID(structure) {
    if (!structure) {
      return 0;
    }

    const explicitCoreTypeID = this._normalizeInventoryId(
      structure.quantumCoreItemTypeID,
      0,
    );
    if (explicitCoreTypeID > 0) {
      return explicitCoreTypeID;
    }

    const typeRecord =
      typeof structureState.getStructureTypeByID === "function"
        ? structureState.getStructureTypeByID(structure.typeID)
        : null;
    return this._normalizeInventoryId(
      typeRecord && typeRecord.defaultQuantumCoreTypeID,
      0,
    );
  }

  _isStructureCoreInstallMove(item, destination) {
    return Boolean(
      item &&
      this._isStructureDeedDestination(destination) &&
      this._normalizeInventoryId(item.groupID, 0) === STRUCTURE_DEED_GROUP_ID
    );
  }

  _validateStructureCoreInstallMove(item, destination) {
    if (!this._isStructureDeedDestination(destination)) {
      return { success: true };
    }

    const structure = this._getStructureForDeedDestination(destination);
    if (!structure || !this._isStructureCoreInstallMove(item, destination)) {
      return { success: false, errorMsg: "NoSpaceForThat" };
    }

    const expectedCoreTypeID = this._getRequiredStructureCoreTypeID(structure);
    const itemTypeID = this._normalizeInventoryId(item && item.typeID, 0);
    if (expectedCoreTypeID > 0 && itemTypeID !== expectedCoreTypeID) {
      return {
        success: false,
        errorMsg: "CustomNotify",
        values: {
          notify: `This structure requires core type ${expectedCoreTypeID}.`,
        },
      };
    }

    const existingDeedItems = listContainerItems(
      null,
      structure.structureID,
      ITEM_FLAGS.STRUCTURE_DEED,
    ).filter(
      (existingItem) =>
        this._normalizeInventoryId(existingItem && existingItem.itemID, 0) !==
        this._normalizeInventoryId(item && item.itemID, 0),
    );
    if (structure.hasQuantumCore === true || existingDeedItems.length > 0) {
      return {
        success: false,
        errorMsg: "CustomNotify",
        values: {
          notify: "This structure already has a Quantum Core installed.",
        },
      };
    }

    return { success: true, structure, expectedCoreTypeID };
  }

  _syncStructureCoreInstall(_session, item, destination) {
    if (!this._isStructureCoreInstallMove(item, destination)) {
      return null;
    }

    const structure = this._getStructureForDeedDestination(destination);
    if (!structure) {
      return null;
    }

    const result = structureState.setStructureQuantumCoreInstalled(
      structure.structureID,
      true,
    );
    if (!result.success) {
      log.warn(
        `[InvBroker] structure core install state update failed structure=${structure.structureID} error=${result.errorMsg || "UNKNOWN"}`,
      );
      return result;
    }

    const updatedStructure = result.data || structure;
    const solarSystemID = this._normalizeInventoryId(
      updatedStructure.solarSystemID || structure.solarSystemID,
      0,
    );
    if (solarSystemID > 0) {
      runtime.syncStructureSceneState(solarSystemID, {
        reason: "structureCoreInstall",
      });
    }
    return result;
  }

  _syncStructureServiceModuleMove(session, sourceItem, destination) {
    const touchedStructureIDs = new Set();
    const sourceFlagID = this._normalizeInventoryId(sourceItem && sourceItem.flagID, 0);
    const sourceLocationID = this._normalizeInventoryId(sourceItem && sourceItem.locationID, 0);
    const destinationFlagID = this._normalizeInventoryId(destination && destination.flagID, 0);
    const destinationLocationID = this._normalizeInventoryId(destination && destination.locationID, 0);

    if (isStructureServiceSlotFlag(sourceFlagID) && sourceLocationID > 0) {
      touchedStructureIDs.add(sourceLocationID);
    }
    if (isStructureServiceSlotFlag(destinationFlagID) && destinationLocationID > 0) {
      touchedStructureIDs.add(destinationLocationID);
    }

    for (const structureID of touchedStructureIDs) {
      const result = syncStructureServiceModuleState(structureID);
      if (!result || result.success !== true) {
        log.warn(
          `[InvBroker] structure service module sync failed structure=${structureID} error=${result && result.errorMsg || "UNKNOWN"}`,
        );
        continue;
      }
      if (Array.isArray(result.fuelCycleChanges) && result.fuelCycleChanges.length > 0) {
        this._emitInventoryMoveChanges(session, result.fuelCycleChanges);
      }
      if (result.data && result.data.solarSystemID) {
        runtime.syncStructureSceneState(result.data.solarSystemID, {
          reason: "structureServiceModuleMove",
        });
      }
    }
  }

  _isLootContainerEntity(session, entityID) {
    const numericEntityID = this._normalizeInventoryId(entityID, 0);
    if (numericEntityID <= 0) {
      return false;
    }

    const scene = runtime.getSceneForSession(session);
    const entity = scene && scene.getEntityByID(numericEntityID);
    return Boolean(
      entity && (entity.kind === "container" || entity.kind === "wreck")
    );
  }

  _isFleetLootSource(session, sourceItemDescriptor, sourceLocationID = 0) {
    if (!sourceItemDescriptor || !sourceItemDescriptor.item) {
      return false;
    }

    if (sourceItemDescriptor.sourceKind === "nativeWreck") {
      return true;
    }

    const itemLocationID = this._normalizeInventoryId(
      sourceItemDescriptor.item.locationID,
      0,
    );
    if (this._isLootContainerEntity(session, itemLocationID)) {
      return true;
    }

    const explicitSourceLocationID = this._normalizeInventoryId(
      sourceLocationID,
      0,
    );
    return explicitSourceLocationID > 0
      ? this._isLootContainerEntity(session, explicitSourceLocationID)
      : false;
  }

  _appendFleetLootEntry(
    session,
    fleetLootEntries,
    sourceItemDescriptor,
    sourceLocationID,
    destination,
    requestedQuantity,
  ) {
    if (
      !Array.isArray(fleetLootEntries) ||
      !this._isFleetLootSource(session, sourceItemDescriptor, sourceLocationID)
    ) {
      return;
    }

    const item =
      sourceItemDescriptor && sourceItemDescriptor.item
        ? sourceItemDescriptor.item
        : null;
    const typeID = this._normalizeInventoryId(item && item.typeID, 0);
    const quantity = this._resolveAppliedMoveQuantity(
      item,
      destination,
      requestedQuantity,
    );
    if (typeID <= 0 || quantity <= 0) {
      return;
    }

    fleetLootEntries.push({
      typeID,
      quantity,
    });
  }

  _emitFleetLootEvents(session, fleetLootEntries = []) {
    if (!Array.isArray(fleetLootEntries) || fleetLootEntries.length <= 0) {
      return;
    }

    fleetRuntime.recordLootEventsForSession(session, fleetLootEntries);
  }

  _destinationUsesCapacity(boundContext, destination) {
    if (!boundContext || !destination) {
      return false;
    }

    if (
      boundContext.kind === "shipInventory" &&
      isShipFittingFlag(destination.flagID)
    ) {
      return false;
    }

    return (
      boundContext.kind === "shipInventory" ||
      boundContext.kind === "container"
    );
  }

  _getMoveCapacityError(boundContext, destination, item) {
    if (
      boundContext &&
      boundContext.kind === "shipInventory" &&
      Number(destination && destination.flagID) === ITEM_FLAGS.DRONE_BAY
    ) {
      return "NotEnoughDroneBaySpace";
    }

    if (
      boundContext &&
      boundContext.kind === "shipInventory" &&
      Number(destination && destination.flagID) === ITEM_FLAGS.FIGHTER_BAY
    ) {
      return "NotEnoughFighterBaySpace";
    }

    if (
      boundContext &&
      boundContext.kind === "shipInventory" &&
      isShipFittingFlag(Number(destination && destination.flagID)) &&
      Number(item && item.categoryID) === 8
    ) {
      return "NotEnoughChargeSpace";
    }

    if (boundContext && boundContext.kind === "container") {
      return "NoSpaceForThat";
    }

    return "NotEnoughCargoSpace";
  }

  _getItemMoveVolume(item, quantity) {
    const numericQuantity = Math.max(1, Number(quantity) || 0);
    const metadata = getItemMetadata(item && item.typeID) || null;
    const unitVolume = Math.max(
      0,
      Number(item && item.volume) ||
      Number(metadata && metadata.volume) ||
      0,
    );
    return unitVolume * numericQuantity;
  }

  _checkCapacityForMove(
    session,
    boundContext,
    destination,
    item,
    requestedQuantity = null,
  ) {
    if (
      !item ||
      !boundContext ||
      !destination ||
      !this._destinationUsesCapacity(boundContext, destination)
    ) {
      return { success: true };
    }

    const currentLocationID = this._normalizeInventoryId(item.locationID, 0);
    const currentFlagID = this._normalizeInventoryId(item.flagID, 0);
    if (
      currentLocationID === this._normalizeInventoryId(destination.locationID, 0) &&
      currentFlagID === this._normalizeInventoryId(destination.flagID, 0)
    ) {
      return { success: true };
    }

    const availableQuantity =
      Number(item.singleton) === 1
        ? 1
        : Math.max(1, Number(item.stacksize ?? item.quantity ?? 1) || 1);
    const resolvedQuantity = this._resolveMoveQuantity(
      item,
      destination,
      requestedQuantity,
    );
    const moveQuantity =
      resolvedQuantity === null || resolvedQuantity === undefined
        ? availableQuantity
        : Math.max(1, Number(resolvedQuantity) || 1);
    const requiredVolume = this._getItemMoveVolume(item, moveQuantity);
    if (requiredVolume <= 0) {
      return { success: true };
    }

    const capacityInfo = this._calculateCapacity(
      session,
      boundContext,
      destination.flagID,
    );
    const capacity = Number(
      capacityInfo &&
      capacityInfo.args &&
      capacityInfo.args.type === "dict" &&
      Array.isArray(capacityInfo.args.entries)
        ? (
            capacityInfo.args.entries.find(([key]) => key === "capacity") || []
          )[1]
        : 0,
    ) || 0;
    const used = Number(
      capacityInfo &&
      capacityInfo.args &&
      capacityInfo.args.type === "dict" &&
      Array.isArray(capacityInfo.args.entries)
        ? (
            capacityInfo.args.entries.find(([key]) => key === "used") || []
          )[1]
        : 0,
    ) || 0;
    const free = Math.max(0, capacity - used);

    if (requiredVolume <= free + 1e-7) {
      return { success: true };
    }

    return {
      success: false,
      errorMsg: this._getMoveCapacityError(boundContext, destination, item),
      free,
      requiredVolume,
    };
  }

  _getShipInventoryRecord(session, boundContext) {
    const inventoryID = this._normalizeInventoryId(
      boundContext && boundContext.inventoryID,
      0,
    );
    if (inventoryID <= 0) {
      return null;
    }

    const charId = this._getCharacterId(session);
    return (
      findCharacterShip(charId, inventoryID) ||
      findShipItemById(inventoryID) ||
      null
    );
  }

  _getStructureFitHostRecord(session, structureID) {
    const numericStructureID = this._normalizeInventoryId(structureID, 0);
    return numericStructureID > 0
      ? this._buildStructureItemOverrides(session, numericStructureID)
      : null;
  }

  _isAutoFitRequested(explicitFlagValue, explicitFlagProvided) {
    if (!explicitFlagProvided) {
      return false;
    }

    const numericFlag = this._normalizeInventoryId(explicitFlagValue, 0);
    if (
      isShipFittingFlag(numericFlag) ||
      SHIP_BAY_FLAGS.has(numericFlag) ||
      this._isStructureOwnerBayFlag(numericFlag) ||
      numericFlag === ITEM_FLAGS.STRUCTURE_DEED
    ) {
      return false;
    }

    return true;
  }

  _resolveDestinationForMove(
    session,
    boundContext,
    item,
    requestedFlag,
    explicitFlagProvided,
    fittedItemsOverride = null,
  ) {
    const shipRecord = this._getShipInventoryRecord(session, boundContext);
    const fitHostRecord = shipRecord || this._getStructureFitHostRecord(
      session,
      boundContext && boundContext.inventoryID,
    );
    const numericRequestedFlag =
      requestedFlag === undefined || requestedFlag === null
        ? null
        : this._normalizeInventoryId(requestedFlag, 0);
    const isExplicitFitMove =
      numericRequestedFlag !== null && isShipFittingFlag(numericRequestedFlag);
    const isAutoFitMove = this._isAutoFitRequested(
      requestedFlag,
      explicitFlagProvided,
    );

    if (!shipRecord && (!fitHostRecord || (!isExplicitFitMove && !isAutoFitMove))) {
      return {
        locationID: this._normalizeInventoryId(
          boundContext && boundContext.inventoryID,
          this._getStationId(session),
        ),
        flagID: requestedFlag ?? ITEM_FLAGS.HANGAR,
      };
    }

    const charId = this._getCharacterId(session);
    const currentFittedItems =
      Array.isArray(fittedItemsOverride) && fittedItemsOverride.length >= 0
        ? fittedItemsOverride
        : listFittedItems(charId, fitHostRecord.itemID);

    if (isExplicitFitMove) {
      return {
        locationID: fitHostRecord.itemID,
        flagID: numericRequestedFlag,
      };
    }

    if (isAutoFitMove) {
      const autoFitFlag = selectAutoFitFlagForType(
        fitHostRecord,
        currentFittedItems,
        item && item.typeID,
      );
      if (autoFitFlag) {
        return {
          locationID: fitHostRecord.itemID,
          flagID: autoFitFlag,
        };
      }

      return null;
    }

    return {
      locationID: shipRecord.itemID,
      flagID:
        numericRequestedFlag ??
        this._normalizeInventoryId(
          boundContext && boundContext.flagID,
          ITEM_FLAGS.CARGO_HOLD,
        ),
    };
  }

  _emitInventoryMoveChanges(session, changes = []) {
    const normalizedChanges = Array.isArray(changes) ? changes : [];

    for (const change of normalizedChanges) {
      if (!change || !change.item) {
        continue;
      }

      syncInventoryItemForSession(
        session,
        change.item,
        change.previousData || {},
        {
          emitCfgLocation: true,
        },
      );
    }

    this._refreshDockedFittingState(session, normalizedChanges);
  }

  _refreshDockedFittingState(session, changes = []) {
    if (
      !session ||
      !isDockedSession(session) ||
      !Array.isArray(changes) ||
      changes.length === 0
    ) {
      return;
    }

    const activeShipID = this._normalizeInventoryId(
      session.activeShipID || session.shipID || session.shipid,
      0,
    );
    if (activeShipID <= 0) {
      return;
    }

    const touchesFittingState = changes.some((change) => {
      if (!change || !change.item) {
        return false;
      }

      const previousState = change.previousData || change.previousState || {};
      const previousLocationID = this._normalizeInventoryId(
        previousState.locationID,
        0,
      );
      const previousFlagID = this._normalizeInventoryId(
        previousState.flagID,
        0,
      );
      const nextLocationID = this._normalizeInventoryId(
        change.item.locationID,
        0,
      );
      const nextFlagID = this._normalizeInventoryId(
        change.item.flagID,
        0,
      );

      if (
        previousLocationID !== activeShipID &&
        nextLocationID !== activeShipID
      ) {
        return false;
      }

      return (
        isShipFittingFlag(previousFlagID) ||
        isShipFittingFlag(nextFlagID)
      );
    });

    if (!touchesFittingState) {
      return;
    }

    syncShipFittingStateForSession(session, activeShipID, {
      includeOfflineModules: true,
      includeCharges: true,
      emitChargeInventoryRows: false,
    });
  }

  _refreshBallparkShipPresentation(session, changes = []) {
    if (!session || !session._space) {
      return;
    }

    const activeShipID = this._normalizeInventoryId(
      session._space.shipID || this._getShipId(session),
      0,
    );
    if (activeShipID <= 0) {
      return;
    }

    const touchesFittingState = (change) => {
      if (!change) {
        return false;
      }

      const previousLocationID = this._normalizeInventoryId(
        change.previousData && change.previousData.locationID,
        0,
      );
      const previousFlagID = this._normalizeInventoryId(
        change.previousData && change.previousData.flagID,
        0,
      );
      const nextLocationID = this._normalizeInventoryId(
        change.item && change.item.locationID,
        0,
      );
      const nextFlagID = this._normalizeInventoryId(
        change.item && change.item.flagID,
        0,
      );

      if (
        previousLocationID !== activeShipID &&
        nextLocationID !== activeShipID
      ) {
        return false;
      }

      return (
        isShipFittingFlag(previousFlagID) ||
        isShipFittingFlag(nextFlagID)
      );
    };

    if (!changes.some((change) => touchesFittingState(change))) {
      return;
    }

    const scene = runtime.getSceneForSession(session);
    if (!scene) {
      return;
    }

    runtime.refreshShipDerivedState(session, {
      broadcast: true,
    });

    const shipEntity = scene.getEntityByID(activeShipID);
    if (!shipEntity) {
      return;
    }

    scene.broadcastSlimItemChanges([shipEntity]);
  }

  _refreshBallparkInventoryPresentation(session, changes = []) {
    if (!session || !session._space || !Array.isArray(changes) || changes.length === 0) {
      return;
    }

    const scene = runtime.getSceneForSession(session);
    if (!scene) {
      return;
    }

    const affectedEntityIDs = new Set();
    const collectEntityID = (value) => {
      const numericID = this._normalizeInventoryId(value, 0);
      if (numericID <= 0) {
        return;
      }
      const entity = scene.getEntityByID(numericID);
      if (entity && (entity.kind === "container" || entity.kind === "wreck")) {
        affectedEntityIDs.add(numericID);
      }
    };

    for (const change of changes) {
      if (!change) {
        continue;
      }
      collectEntityID(change.item && change.item.itemID);
      collectEntityID(change.item && change.item.locationID);
      collectEntityID(change.previousData && change.previousData.locationID);
    }

    for (const entityID of affectedEntityIDs) {
      const entity = scene.getEntityByID(entityID);
      if (entity && entity.nativeNpcWreck === true) {
        nativeNpcWreckService.refreshNativeWreckRuntimeEntity(
          session._space.systemID,
          entityID,
          { broadcast: true },
        );
      } else {
        runtime.refreshInventoryBackedEntityPresentation(
          session._space.systemID,
          entityID,
          { broadcast: true },
        );
      }
    }
  }

  _validateFittingMove(session, shipRecord, item, destination, fittedItemsSnapshot = null) {
    if (
      !shipRecord ||
      !item ||
      !destination ||
      destination.locationID !== shipRecord.itemID ||
      !isShipFittingFlag(destination.flagID)
    ) {
      return { success: true };
    }

    return validateFitForShip(
      this._getCharacterId(session),
      shipRecord,
      item,
      destination.flagID,
      fittedItemsSnapshot,
    );
  }

  _validateShipBayMove(session, shipRecord, item, destination) {
    if (
      !shipRecord ||
      !item ||
      !destination ||
      destination.locationID !== shipRecord.itemID
    ) {
      return { success: true };
    }

    const destinationFlagID = this._normalizeInventoryId(destination.flagID, 0);
    if (isFuelBayFlag(destinationFlagID)) {
      return isFuelBayCompatibleItem(item)
        ? { success: true }
        : {
            success: false,
            errorMsg: "NotEnoughCargoSpace",
          };
    }

    if (destinationFlagID === ITEM_FLAGS.DRONE_BAY) {
      return isDroneItemRecord(item)
        ? { success: true }
        : {
            success: false,
            errorMsg: "NotEnoughCargoSpace",
          };
    }

    if (destinationFlagID === ITEM_FLAGS.FIGHTER_BAY) {
      return isFighterItemRecord(item)
        ? { success: true }
        : {
            success: false,
            errorMsg: "NotEnoughCargoSpace",
          };
    }

    if (isFighterTubeFlag(destinationFlagID)) {
      if (!isFighterItemRecord(item)) {
        return {
          success: false,
          errorMsg: "NotEnoughCargoSpace",
        };
      }

      const destinationOccupants = listContainerItems(
        this._getCharacterId(session),
        shipRecord.itemID,
        destinationFlagID,
      ).filter(
        (existingItem) =>
          Number(existingItem && existingItem.itemID) !== Number(item.itemID),
      );
      if (destinationOccupants.length > 0) {
        return {
          success: false,
          errorMsg: "NotEnoughCargoSpace",
        };
      }

      return { success: true };
    }

    if (!MINING_SHIP_BAY_FLAGS.includes(destinationFlagID)) {
      return { success: true };
    }

    return isItemTypeAllowedInHoldFlag(item, destinationFlagID)
      ? { success: true }
      : {
          success: false,
          errorMsg: "NotEnoughCargoSpace",
        };
  }

  _validateStructureOwnerBayMove(item, destination) {
    const structure = this._getStructureForOwnerBayDestination(destination);
    if (!structure) {
      return { success: true };
    }

    if (isStructureFuelBayFlag(destination.flagID)) {
      return isFuelBayCompatibleItem(item)
        ? { success: true }
        : {
            success: false,
            errorMsg: "NotEnoughCargoSpace",
          };
    }

    return { success: true };
  }

  _resolveMovedItemID(moveResult, originalItemID, destination) {
    const destinationLocationID = this._normalizeInventoryId(
      destination && destination.locationID,
      0,
    );
    const destinationFlagID = this._normalizeInventoryId(
      destination && destination.flagID,
      0,
    );

    for (const change of (moveResult && moveResult.data && moveResult.data.changes) || []) {
      if (
        !change ||
        !change.item ||
        Number(change.item.itemID) === Number(originalItemID)
      ) {
        continue;
      }

      if (
        this._normalizeInventoryId(change.item.locationID, 0) === destinationLocationID &&
        this._normalizeInventoryId(change.item.flagID, 0) === destinationFlagID
      ) {
        return Number(change.item.itemID) || null;
      }
    }

    return null;
  }

  _getNativeWreckRecord(inventoryID) {
    const numericInventoryID = this._normalizeInventoryId(inventoryID, 0);
    if (numericInventoryID <= 0) {
      return null;
    }

    return nativeNpcStore.getNativeWreck(numericInventoryID) || null;
  }

  _buildNativeWreckItemOverrides(_session, inventoryID) {
    return nativeNpcStore.buildNativeWreckInventoryItem(
      this._normalizeInventoryId(inventoryID, 0),
    );
  }

  _findTransferSourceItem(itemID, sourceLocationID = 0) {
    const numericItemID = this._normalizeInventoryId(itemID, 0);
    if (numericItemID <= 0) {
      return null;
    }

    const inventoryItem = findItemById(numericItemID);
    if (inventoryItem) {
      return {
        sourceKind: "inventory",
        item: inventoryItem,
      };
    }

    const wreckItem = nativeNpcStore.getNativeWreckItem(numericItemID);
    if (!wreckItem) {
      return null;
    }

    const normalizedSourceLocationID = this._normalizeInventoryId(sourceLocationID, 0);
    if (
      normalizedSourceLocationID > 0 &&
      this._normalizeInventoryId(wreckItem.wreckID, 0) !== normalizedSourceLocationID
    ) {
      return null;
    }

    const wreckItemOverrides = nativeNpcStore.buildNativeWreckContents(wreckItem.wreckID)
      .find((entry) => this._normalizeInventoryId(entry && entry.itemID, 0) === numericItemID) || null;
    return {
      sourceKind: "nativeWreck",
      item: wreckItemOverrides,
      wreckItem,
    };
  }

  _resolveInventoryRootLocationID(itemOrItemID) {
    let currentItem =
      itemOrItemID && typeof itemOrItemID === "object"
        ? itemOrItemID
        : findItemById(this._normalizeInventoryId(itemOrItemID, 0));
    const seen = new Set();

    while (currentItem) {
      const currentItemID = this._normalizeInventoryId(currentItem.itemID, 0);
      const locationID = this._normalizeInventoryId(currentItem.locationID, 0);
      if (locationID <= 0) {
        return 0;
      }

      if (seen.has(currentItemID)) {
        return locationID;
      }
      seen.add(currentItemID);

      const parentItem = findItemById(locationID);
      if (!parentItem) {
        return locationID;
      }
      currentItem = parentItem;
    }

    return 0;
  }

  _isInventoryItemTrashable(session, item, requestedLocationID = 0) {
    if (!item || typeof item !== "object") {
      return false;
    }

    const characterID = this._getCharacterId(session);
    const itemID = this._normalizeInventoryId(item.itemID, 0);
    const ownerID = this._normalizeInventoryId(item.ownerID, 0);
    const activeShipID = this._getShipId(session);
    if (itemID <= 0 || ownerID !== characterID) {
      return false;
    }

    if (itemID === activeShipID) {
      return false;
    }

    if (isShipFittingFlag(item.flagID)) {
      return false;
    }

    const normalizedRequestedLocationID = this._normalizeInventoryId(
      requestedLocationID,
      0,
    );
    if (normalizedRequestedLocationID <= 0) {
      return true;
    }

    return (
      this._resolveInventoryRootLocationID(item) === normalizedRequestedLocationID
    );
  }

  _filterTopLevelTrashItemIDs(itemIDs = []) {
    const normalizedItemIDs = this._normalizeItemIdList(itemIDs);
    const selected = new Set(normalizedItemIDs);
    const topLevelIDs = [];

    for (const itemID of normalizedItemIDs) {
      let currentItem = findItemById(itemID);
      let coveredByAncestor = false;
      const seen = new Set([itemID]);

      while (currentItem) {
        const parentID = this._normalizeInventoryId(currentItem.locationID, 0);
        if (parentID <= 0) {
          break;
        }
        if (selected.has(parentID)) {
          coveredByAncestor = true;
          break;
        }
        if (seen.has(parentID)) {
          break;
        }
        seen.add(parentID);
        currentItem = findItemById(parentID);
      }

      if (!coveredByAncestor) {
        topLevelIDs.push(itemID);
      }
    }

    return topLevelIDs;
  }

  _moveSourceItemToDestination(session, sourceItemDescriptor, destination, quantity = null) {
    if (!sourceItemDescriptor || !sourceItemDescriptor.item || !destination) {
      return {
        success: false,
        errorMsg: "ITEM_NOT_FOUND",
      };
    }

    const sourceItem = sourceItemDescriptor.item;
    const groupingContext = {
      shipID: this._normalizeInventoryId(sourceItem.locationID, 0),
      moduleID: this._normalizeInventoryId(sourceItem.itemID, 0),
      wasGrouped:
        Number(sourceItem.categoryID) === 7 &&
        isShipFittingFlag(sourceItem.flagID) &&
        getWeaponBankMasterModuleID(
          this._normalizeInventoryId(sourceItem.locationID, 0),
          this._normalizeInventoryId(sourceItem.itemID, 0),
        ) > 0,
    };

    if (sourceItemDescriptor.sourceKind === "nativeWreck") {
      return nativeNpcWreckService.transferNativeWreckItemToCharacterLocation({
        characterID: this._getCharacterId(session),
        wreckID: this._normalizeInventoryId(
          sourceItemDescriptor.wreckItem && sourceItemDescriptor.wreckItem.wreckID,
          0,
        ),
        wreckItemID: this._normalizeInventoryId(
          sourceItemDescriptor.wreckItem && sourceItemDescriptor.wreckItem.wreckItemID,
          0,
        ),
        destinationLocationID: this._normalizeInventoryId(destination.locationID, 0),
        destinationFlagID: this._normalizeInventoryId(destination.flagID, ITEM_FLAGS.HANGAR),
        quantity,
      });
    }

    const destinationOffice = this._getCorporationOffice(
      session,
      destination.locationID,
    );
    if (
      destinationOffice &&
      this._isCorporationHangarFlag(destination.flagID)
    ) {
      const transferResult = transferItemToOwnerLocation(
        this._normalizeInventoryId(sourceItemDescriptor.item.itemID, 0),
        this._getCorporationId(session),
        this._normalizeInventoryId(destinationOffice.officeID, 0),
        destination.flagID,
        quantity,
      );
      return this._applyModuleGroupingMoveCleanup(
        session,
        sourceItemDescriptor,
        destination,
        transferResult,
        groupingContext,
      );
    }

    const structureDestination = this._getStructureForOwnerBayDestination(destination);
    const structureOwnerID = this._getStructureInventoryOwnerID(structureDestination);
    if (structureDestination && structureOwnerID > 0) {
      const transferResult = transferItemToOwnerLocation(
        this._normalizeInventoryId(sourceItemDescriptor.item.itemID, 0),
        structureOwnerID,
        this._normalizeInventoryId(structureDestination.structureID, 0),
        destination.flagID,
        quantity,
      );
      return this._applyModuleGroupingMoveCleanup(
        session,
        sourceItemDescriptor,
        destination,
        transferResult,
        groupingContext,
      );
    }

    const moveResult = moveItemToLocation(
      this._normalizeInventoryId(sourceItemDescriptor.item.itemID, 0),
      destination.locationID,
      destination.flagID,
      quantity,
    );
    return this._applyModuleGroupingMoveCleanup(
      session,
      sourceItemDescriptor,
      destination,
      moveResult,
      groupingContext,
    );
  }

  _applyModuleGroupingMoveCleanup(
    session,
    sourceItemDescriptor,
    destination,
    moveResult,
    groupingContext = null,
  ) {
    if (
      !moveResult ||
      !moveResult.success ||
      !sourceItemDescriptor ||
      !sourceItemDescriptor.item
    ) {
      return moveResult;
    }

    const sourceItem = sourceItemDescriptor.item;
    const sourceShipID = this._normalizeInventoryId(sourceItem.locationID, 0);
    const sourceFlagID = this._normalizeInventoryId(sourceItem.flagID, 0);
    const destinationLocationID = this._normalizeInventoryId(destination.locationID, 0);
    const destinationFlagID = this._normalizeInventoryId(destination.flagID, 0);
    const movedOutOfShipFitting =
      Number(sourceItem.categoryID) === 7 &&
      isShipFittingFlag(sourceFlagID) &&
      (
        destinationLocationID !== sourceShipID ||
        !isShipFittingFlag(destinationFlagID)
      );
    if (!movedOutOfShipFitting) {
      return moveResult;
    }

    clearModuleFromBanksAndNotify(
      session,
      sourceShipID,
      [sourceItem.itemID],
      {
        characterID: this._getCharacterId(session),
      },
    );
    if (groupingContext && groupingContext.wasGrouped) {
      notifyWeaponBanksChanged(
        session,
        groupingContext.shipID,
        getShipWeaponBanks(groupingContext.shipID, {
          characterID: this._getCharacterId(session),
        }),
      );
    }
    return moveResult;
  }

  _buildCharacterItemOverrides(session) {
    const charId = this._getCharacterId(session);
    return {
      itemID: charId,
      typeID: CHARACTER_TYPE_ID,
      ownerID: charId,
      locationID: this._getShipId(session) || this._getStationId(session),
      flagID: 0,
      quantity: -1,
      groupID: CHARACTER_GROUP_ID,
      categoryID: CHARACTER_CATEGORY_ID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  _findCharacterSkillRecord(session, itemID) {
    const charId = this._getCharacterId(session);
    const numericItemId = this._normalizeInventoryId(itemID, 0);
    if (numericItemId <= 0) {
      return null;
    }

    return (
      getCharacterSkills(charId).find((skill) => skill.itemID === numericItemId) ||
      null
    );
  }

  _buildSkillItemOverrides(skillRecord) {
    if (!skillRecord) {
      return null;
    }

    return {
      itemID: skillRecord.itemID,
      typeID: skillRecord.typeID,
      ownerID: skillRecord.ownerID,
      locationID: skillRecord.locationID,
      flagID: skillRecord.flagID ?? SKILL_FLAG_ID,
      quantity: -1,
      groupID: skillRecord.groupID,
      categoryID: skillRecord.categoryID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  _buildInventoryItemOverrides(session, itemRecord) {
    if (!itemRecord || typeof itemRecord !== "object") {
      return null;
    }

    if (Number(itemRecord.categoryID) === 16) {
      return this._buildSkillItemOverrides(itemRecord);
    }

    const rawItemID = itemRecord.itemID ?? itemRecord.shipID;
    const itemID = this._isChargeTupleItemID(rawItemID)
      ? rawItemID.map((entry) => this._normalizeInventoryId(entry, 0))
      : this._normalizeInventoryId(rawItemID, 0);
    const typeID = this._normalizeInventoryId(
      itemRecord.typeID ?? itemRecord.shipTypeID,
      0,
    );
    if (
      (
        Array.isArray(itemID)
          ? !this._isChargeTupleItemID(itemID)
          : itemID <= 0
      ) ||
      typeID <= 0
    ) {
      return null;
    }

    const singleton =
      itemRecord.singleton === null || itemRecord.singleton === undefined
        ? Number(itemRecord.categoryID) === 6
          ? 1
          : 0
        : itemRecord.singleton;
    const quantity =
      itemRecord.quantity === null || itemRecord.quantity === undefined
        ? Number(singleton) === 1
            ? -1
            : 1
        : itemRecord.quantity;
    const stacksize =
      itemRecord.stacksize === null || itemRecord.stacksize === undefined
        ? Number(singleton) === 1
          ? 1
          : quantity
        : itemRecord.stacksize;

    return {
      itemID,
      typeID,
      shipName: itemRecord.shipName || itemRecord.itemName || null,
      ownerID: this._normalizeInventoryId(
        itemRecord.ownerID,
        this._getCharacterId(session),
      ),
      locationID: this._normalizeInventoryId(
        itemRecord.locationID,
        this._getStationId(session),
      ),
      flagID: this._normalizeInventoryId(itemRecord.flagID, 0),
      quantity,
      groupID: this._normalizeInventoryId(itemRecord.groupID, 0),
      categoryID: this._normalizeInventoryId(itemRecord.categoryID, 0),
      customInfo: itemRecord.customInfo || "",
      singleton,
      stacksize,
    };
  }

  _buildStationItemOverrides(session, overrideStationID = null) {
    const station = getStationRecord(session, overrideStationID);
    const stationID = this._normalizeInventoryId(station.stationID, this._getStationId(session));
    return {
      itemID: stationID,
      typeID: this._normalizeInventoryId(station.stationTypeID, STATION_TYPE_ID),
      ownerID: this._normalizeInventoryId(
        station.ownerID || station.corporationID,
        STATION_OWNER_ID,
      ),
      locationID: stationID,
      flagID: 0,
      quantity: 1,
      groupID: STATION_GROUP_ID,
      categoryID: STATION_CATEGORY_ID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  _buildStructureItemOverrides(session, overrideStructureID = null) {
    const structureID = this._normalizeInventoryId(
      overrideStructureID ?? this._getStationId(session),
      0,
    );
    if (structureID <= 0) {
      return null;
    }

    const structure = structureState.getStructureByID(structureID, {
      refresh: false,
    });
    if (!structure) {
      return null;
    }

    const structureTypeID = this._normalizeInventoryId(structure.typeID, 0);
    const structureType = resolveItemByTypeID(structureTypeID) || {};
    return {
      itemID: this._normalizeInventoryId(structure.structureID, structureID),
      typeID: structureTypeID,
      ownerID: this._normalizeInventoryId(
        structure.ownerCorpID || structure.ownerID,
        this._getCharacterId(session),
      ),
      // Upwell hangar/bootstrap paths expect the structure inventory item to
      // represent the docked structure itself, not a station-style shim row.
      locationID: this._normalizeInventoryId(
        structure.structureID,
        structureID,
      ),
      flagID: 0,
      quantity: -1,
      groupID: this._normalizeInventoryId(structureType.groupID, 0),
      categoryID: this._normalizeInventoryId(structureType.categoryID, 0),
      customInfo: String(structure.itemName || structure.name || ""),
      singleton: 1,
      stacksize: 1,
    };
  }

  _getCharacterContainerItems(session, requestedFlag = null) {
    const numericFlag =
      requestedFlag === null || requestedFlag === undefined
        ? null
        : this._normalizeInventoryId(requestedFlag, 0);

    return getCharacterSkills(this._getCharacterId(session)).filter((skill) => {
      if (numericFlag === null || numericFlag === 0) {
        return true;
      }

      return this._normalizeInventoryId(skill.flagID, 0) === numericFlag;
    });
  }

  _listCorporationOfficeItems(session, office, requestedFlag = null) {
    if (!office) {
      return [];
    }

    const corporationID = this._getCorporationId(session);
    const numericFlag =
      requestedFlag === null || requestedFlag === undefined
        ? null
        : this._normalizeInventoryId(requestedFlag, 0);
    const locationIDs = new Set(
      [
        this._normalizeInventoryId(office.officeID, 0),
        this._normalizeInventoryId(office.officeFolderID, 0),
        this._normalizeInventoryId(office.itemID, 0),
      ].filter((locationID) => locationID > 0),
    );
    const seenItemIDs = new Set();
    const items = [];

    for (const locationID of locationIDs) {
      for (const item of listContainerItems(corporationID, locationID, numericFlag)) {
        const itemID = this._normalizeInventoryId(item && item.itemID, 0);
        if (itemID <= 0 || seenItemIDs.has(itemID)) {
          continue;
        }
        seenItemIDs.add(itemID);
        items.push(item);
      }
    }

    return items.sort(
      (left, right) =>
        this._normalizeInventoryId(left && left.flagID, 0) -
          this._normalizeInventoryId(right && right.flagID, 0) ||
        this._normalizeInventoryId(left && left.typeID, 0) -
          this._normalizeInventoryId(right && right.typeID, 0) ||
        this._normalizeInventoryId(left && left.itemID, 0) -
          this._normalizeInventoryId(right && right.itemID, 0),
    );
  }

  _buildCorporationOfficeItemOverrides(session, office) {
    if (!office) {
      return null;
    }

    const stationItem = this._buildStationItemOverrides(
      session,
      this._normalizeInventoryId(office.stationID, this._getStationId(session)),
    );
    return {
      itemID: this._normalizeInventoryId(office.officeID, 0),
      typeID: stationItem.typeID,
      ownerID: this._getCorporationId(session),
      locationID: this._normalizeInventoryId(
        office.stationID,
        this._getStationId(session),
      ),
      flagID: 0,
      quantity: 1,
      groupID: STATION_GROUP_ID,
      categoryID: STATION_CATEGORY_ID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  _buildContainerItemOverrides(session, inventoryID) {
    const numericInventoryID = this._normalizeInventoryId(inventoryID);
    const charId = this._getCharacterId(session);
    const stationId = this._getStationId(session);
    const shipRecord =
      findCharacterShip(charId, numericInventoryID) ||
      findShipItemById(numericInventoryID);
    const genericItemRecord =
      shipRecord || findItemById(numericInventoryID);

    if (genericItemRecord) {
      return this._buildInventoryItemOverrides(session, genericItemRecord);
    }

    const corporationOffice = this._getCorporationOffice(
      session,
      numericInventoryID,
    );
    if (corporationOffice) {
      return this._buildCorporationOfficeItemOverrides(session, corporationOffice);
    }

    const nativeWreckRecord = this._getNativeWreckRecord(numericInventoryID);
    if (nativeWreckRecord) {
      return this._buildNativeWreckItemOverrides(session, numericInventoryID);
    }

    if (numericInventoryID === charId) {
      return this._buildCharacterItemOverrides(session);
    }

    if (numericInventoryID === stationId || numericInventoryID === 0) {
      if (
        Number(session && (session.structureID || session.structureid)) > 0
      ) {
        return (
          this._buildStructureItemOverrides(session, stationId) ||
          this._buildStationItemOverrides(session, stationId)
        );
      }
      return this._buildStationItemOverrides(session, stationId);
    }

    const stationItem = this._buildStationItemOverrides(session, stationId);
    return {
      itemID: numericInventoryID,
      typeID: stationItem.typeID,
      ownerID: this._getCharacterId(session),
      locationID: stationId,
      flagID: 0,
      quantity: 1,
      groupID: STATION_GROUP_ID,
      categoryID: STATION_CATEGORY_ID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  _resolveContainerItems(session, requestedFlag, boundContext) {
    const stationId = this._getStationId(session);
    const charId = this._getCharacterId(session);
    const numericFlag =
      requestedFlag === null || requestedFlag === undefined
        ? null
        : this._normalizeInventoryId(requestedFlag, 0);
    const containerID = boundContext && Number(boundContext.inventoryID)
      ? Number(boundContext.inventoryID)
      : stationId;

    if (containerID === charId) {
      return this._getCharacterContainerItems(session, numericFlag);
    }

    const corporationOffice = this._getCorporationOffice(session, containerID);
    if (corporationOffice) {
      return this._listCorporationOfficeItems(
        session,
        corporationOffice,
        numericFlag,
      );
    }

    if (containerID === stationId) {
      const structureContainer = this._getStructureForInventoryID(containerID);
      const structureOwnerID = this._getStructureInventoryOwnerID(structureContainer);
      if (
        structureContainer &&
        structureOwnerID > 0 &&
        boundContext &&
        boundContext.kind === "controlledStructureInventory"
      ) {
        if (numericFlag === null || isShipFittingFlag(numericFlag)) {
          return listContainerItems(null, containerID, numericFlag);
        }
        if (this._isStructureOwnerBayFlag(numericFlag)) {
          return listContainerItems(structureOwnerID, containerID, numericFlag);
        }
        return listContainerItems(null, containerID, numericFlag);
      }
      if (
        structureContainer &&
        structureOwnerID > 0 &&
        this._isStructureOwnerBayFlag(numericFlag)
      ) {
        return listContainerItems(structureOwnerID, containerID, numericFlag);
      }

      return listContainerItems(
        charId,
        stationId,
        numericFlag === null || numericFlag === 0
          ? ITEM_FLAGS.HANGAR
          : numericFlag,
      );
    }

    const structureContainer = this._getStructureForInventoryID(containerID);
    const structureOwnerID = this._getStructureInventoryOwnerID(structureContainer);
    if (
      structureContainer &&
      structureOwnerID > 0 &&
      boundContext &&
      boundContext.kind === "controlledStructureInventory"
    ) {
      if (numericFlag === null || isShipFittingFlag(numericFlag)) {
        return listContainerItems(null, containerID, numericFlag);
      }
      if (this._isStructureOwnerBayFlag(numericFlag)) {
        return listContainerItems(structureOwnerID, containerID, numericFlag);
      }
      return listContainerItems(null, containerID, numericFlag);
    }
    if (
      structureContainer &&
      structureOwnerID > 0 &&
      this._isStructureOwnerBayFlag(numericFlag)
    ) {
      return listContainerItems(structureOwnerID, containerID, numericFlag);
    }

    const genericContainerRecord = findItemById(containerID);
    if (genericContainerRecord && !findShipItemById(containerID)) {
      return listContainerItems(
        null,
        containerID,
        numericFlag,
      );
    }

    const nativeWreckRecord = this._getNativeWreckRecord(containerID);
    if (nativeWreckRecord) {
      return nativeNpcStore.buildNativeWreckContents(containerID);
    }

    return listContainerItems(
      this._getCharacterId(session),
      containerID,
      numericFlag,
    );
  }

  _buildCapacityInfo(capacity, used) {
    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["capacity", Number(capacity)],
          ["used", Number(used)],
        ],
      },
    };
  }

  _buildInventoryRowDescriptor(
    columns = INVENTORY_ROW_DESCRIPTOR_COLUMNS,
    virtualColumns = INVENTORY_ROW_DESCRIPTOR_VIRTUAL_COLUMNS,
  ) {
    const header = [
      { type: "token", value: "blue.DBRowDescriptor" },
      [columns],
    ];
    if (Array.isArray(virtualColumns) && virtualColumns.length > 0) {
      header.push(buildList(virtualColumns));
    }
    return {
      type: "objectex1",
      header,
      list: [],
      dict: [],
    };
  }

  _calculateCapacity(session, boundContext, requestedFlag = null) {
    const items = this._resolveContainerItems(session, requestedFlag, boundContext);
    const used = items.reduce((sum, item) => {
      if (!item) {
        return sum;
      }
      const units =
        Number(item.singleton) === 1
          ? 1
          : Math.max(0, Number(item.stacksize ?? item.quantity ?? 0) || 0);
      const volume = Math.max(0, Number(item.volume) || 0);
      return sum + (volume * units);
    }, 0);
    const numericFlag =
      requestedFlag === null || requestedFlag === undefined
        ? boundContext && boundContext.flagID !== null && boundContext.flagID !== undefined
          ? Number(boundContext.flagID)
          : null
        : Number(requestedFlag);

    let capacity = 1000000.0;
    const shipRecord = this._getShipInventoryRecord(session, boundContext);
    if (shipRecord) {
      const requiresDerivedShipState =
        numericFlag === ITEM_FLAGS.CARGO_HOLD ||
        isFuelBayFlag(numericFlag) ||
        MINING_SHIP_BAY_FLAGS.includes(numericFlag);
      const fittingSnapshot = requiresDerivedShipState
        ? getShipFittingSnapshot(this._getCharacterId(session), shipRecord.itemID, {
            shipItem: shipRecord,
            reason: "invbroker.capacity",
          })
        : null;
      const resourceState = fittingSnapshot && fittingSnapshot.resourceState
        ? fittingSnapshot.resourceState
        : {};

      if (numericFlag === ITEM_FLAGS.CARGO_HOLD) {
        capacity = Number(resourceState.cargoCapacity) || 0;
      } else if (isFuelBayFlag(numericFlag)) {
        capacity = Number(getFuelBayCapacity(resourceState)) || 0;
      } else if (MINING_SHIP_BAY_FLAGS.includes(numericFlag)) {
        capacity = Number(getShipHoldCapacityByFlag(resourceState, numericFlag)) || 0;
      } else if (numericFlag === ITEM_FLAGS.DRONE_BAY) {
        capacity = Number(
          getShipBaseAttributeValue(shipRecord.typeID, "droneCapacity"),
        ) || 0;
      } else if (numericFlag === ITEM_FLAGS.FIGHTER_BAY) {
        capacity = Number(
          getShipBaseAttributeValue(shipRecord.typeID, "fighterCapacity"),
        ) || 0;
      } else if (numericFlag === ITEM_FLAGS.SHIP_HANGAR) {
        capacity = Number(
          getShipBaseAttributeValue(shipRecord.typeID, "shipMaintenanceBayCapacity"),
        ) || 0;
      }
    } else if (boundContext && boundContext.kind === "container") {
      const containerRecord = findItemById(
        this._normalizeInventoryId(boundContext.inventoryID, 0),
      );
      const nativeWreckRecord =
        containerRecord ? null : this._getNativeWreckRecord(boundContext.inventoryID);
      const containerMetadata = getItemMetadata(
        (containerRecord && containerRecord.typeID) ||
          (nativeWreckRecord && nativeWreckRecord.typeID),
        (containerRecord && containerRecord.itemName) ||
          (nativeWreckRecord && nativeWreckRecord.itemName),
      );
      capacity =
        Number(containerRecord && containerRecord.capacity) ||
        Number(nativeWreckRecord && nativeWreckRecord.capacity) ||
        Number(containerMetadata && containerMetadata.capacity) ||
        capacity;
    } else if (numericFlag === ITEM_FLAGS.CARGO_HOLD) {
      capacity = 5000.0;
    } else if (isFuelBayFlag(numericFlag)) {
      capacity = 0.0;
    } else if (MINING_SHIP_BAY_FLAGS.includes(numericFlag)) {
      capacity = 0.0;
    } else if (numericFlag === ITEM_FLAGS.DRONE_BAY) {
      capacity = 0.0;
    } else if (numericFlag === ITEM_FLAGS.FIGHTER_BAY) {
      capacity = 0.0;
    } else if (numericFlag === ITEM_FLAGS.SHIP_HANGAR) {
      capacity = 1000000.0;
    }

    return this._buildCapacityInfo(capacity, used);
  }

  _buildInvRow(session, overrides = {}) {
    const shipMetadata = this._getShipMetadata(
      session,
      overrides.typeID ?? null,
      overrides.shipName ?? null,
    );
    const itemID = overrides.itemID ?? this._getShipId(session);
    const typeID = overrides.typeID ?? shipMetadata.typeID;
    const ownerID = overrides.ownerID ?? this._getCharacterId(session);
    const locationID = overrides.locationID ?? this._getStationId(session);
    const flagID = overrides.flagID ?? 4; // station hangar
    const singleton = overrides.singleton ?? 1;
    const quantity = overrides.quantity ?? (singleton === 2 ? -2 : singleton === 1 ? -1 : 1);
    const stacksize =
      overrides.stacksize ?? (singleton > 0 ? 1 : quantity);
    const groupID = overrides.groupID ?? shipMetadata.groupID;
    const categoryID = overrides.categoryID ?? shipMetadata.categoryID;
    const customInfo = overrides.customInfo ?? "";

    // Keep DBRowDescriptor-compatible order first, then convenience attrs.
    return [
      itemID,
      typeID,
      ownerID,
      locationID,
      flagID,
      quantity,
      groupID,
      categoryID,
      customInfo,
      stacksize,
      singleton,
    ];
  }

  _buildInvItem(session, overrides = {}) {
    const row = this._buildInvRow(session, overrides);
    const header = [
      "itemID",
      "typeID",
      "ownerID",
      "locationID",
      "flagID",
      "quantity",
      "groupID",
      "categoryID",
      "customInfo",
      "stacksize",
      "singleton",
    ];

    return {
      type: "object",
      name: "util.Row",
      args: {
        type: "dict",
        entries: [
          ["header", header],
          ["line", row],
        ],
      },
    };
  }

  _itemOverridesFromId(session, itemID) {
    const id = Number.isInteger(itemID) ? itemID : Number(itemID);
    const charId = this._getCharacterId(session);
    const skillRecord = this._findCharacterSkillRecord(session, id);
    if (skillRecord) {
      return this._buildSkillItemOverrides(skillRecord);
    }

    const shipRecord =
      findCharacterShip(charId, id) ||
      findShipItemById(id);
    if (shipRecord) {
      return {
        itemID: shipRecord.itemID,
        typeID: shipRecord.typeID,
        shipName: shipRecord.itemName,
        ownerID: shipRecord.ownerID,
        locationID: shipRecord.locationID,
        flagID: shipRecord.flagID,
        quantity: shipRecord.quantity,
        groupID: shipRecord.groupID,
        categoryID: shipRecord.categoryID,
        customInfo: shipRecord.customInfo || "",
        singleton: shipRecord.singleton,
        stacksize: shipRecord.stacksize,
      };
    }

    const genericItem = findItemById(id);
    if (genericItem) {
      return {
        itemID: genericItem.itemID,
        typeID: genericItem.typeID,
        ownerID: genericItem.ownerID,
        locationID: genericItem.locationID,
        flagID: genericItem.flagID,
        quantity: genericItem.quantity,
        groupID: genericItem.groupID,
        categoryID: genericItem.categoryID,
        customInfo: genericItem.customInfo || "",
        singleton: genericItem.singleton,
        stacksize: genericItem.stacksize,
      };
    }

    const shipID = this._getShipId(session);
    const shipMetadata = this._getShipMetadata(session);
    return {
      itemID: Number.isInteger(id) ? id : shipID,
      typeID: shipMetadata.typeID,
      ownerID: this._getCharacterId(session),
      locationID: this._getStationId(session),
      flagID: 4,
      quantity: -1,
      groupID: shipMetadata.groupID,
      categoryID: shipMetadata.categoryID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  Handle_GetInventory(args, session) {
    const containerID = args && args.length > 0 ? args[0] : null;
    const numericContainerID =
      containerID === null || containerID === undefined
        ? this._getStationId(session)
        : this._normalizeInventoryId(containerID);
    const stationId = this._getStationId(session);
    const isStructureDocked =
      Number(session && (session.structureID || session.structureid)) > 0;
    const isStationHangar =
      numericContainerID === stationId ||
      numericContainerID === CONTAINER_HANGAR_ID ||
      (isStructureDocked &&
        (
          numericContainerID === CONTAINER_STRUCTURE_ID ||
          numericContainerID === CONTAINER_CORP_MARKET_ID ||
          numericContainerID === CONTAINER_CAPSULEER_DELIVERIES_ID
        )) ||
      numericContainerID === ITEM_FLAGS.HANGAR;
    this._traceInventory("GetInventory", session, { args });
    log.debug("[InvBroker] GetInventory");
    return this._makeBoundSubstruct({
      inventoryID: isStationHangar ? stationId : numericContainerID,
      locationID: isStationHangar ? stationId : numericContainerID,
      flagID: isStationHangar ? ITEM_FLAGS.HANGAR : null,
      kind: isStationHangar ? "stationHangar" : "inventory",
    });
  }

  _buildInventoryRowset(lines) {
    return {
      type: "object",
      name: "eve.common.script.sys.rowset.Rowset",
      args: {
        type: "dict",
        entries: [
          ["header", INVENTORY_ROW_HEADER],
          ["RowClass", { type: "token", value: "util.Row" }],
          [
            "lines",
            {
              type: "list",
              items: lines,
            },
          ],
        ],
      },
    };
  }

  _buildInventoryRemoteList(itemOverrides = []) {
    return {
      type: "list",
      items: itemOverrides.map((overrides) =>
        this._buildInventoryPackedRow(overrides)),
    };
  }

  _buildInventoryPackedRow(overrides = {}) {
    const columns = this._isChargeTupleItemID(overrides.itemID)
      ? CHARGE_SUBLOCATION_ROW_DESCRIPTOR_COLUMNS
      : INVENTORY_ROW_DESCRIPTOR_COLUMNS;
    return {
      type: "packedrow",
      header: this._buildInventoryRowDescriptor(columns),
      columns,
      fields: {
        itemID: overrides.itemID,
        typeID: overrides.typeID,
        ownerID: overrides.ownerID,
        locationID: overrides.locationID,
        flagID: overrides.flagID,
        quantity: overrides.quantity,
        groupID: overrides.groupID,
        categoryID: overrides.categoryID,
        customInfo: overrides.customInfo || "",
        stacksize: overrides.stacksize,
        singleton: overrides.singleton,
      },
    };
  }

  _buildInvKeyVal(session, overrides = {}) {
    const row = this._buildInvRow(session, overrides);
    const [
      itemID,
      typeID,
      ownerID,
      locationID,
      flagID,
      quantity,
      groupID,
      categoryID,
      customInfo,
      stacksize,
      singleton,
    ] = row;

    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["itemID", itemID],
          ["typeID", typeID],
          ["ownerID", ownerID],
          ["locationID", locationID],
          ["flagID", flagID],
          ["quantity", quantity],
          ["groupID", groupID],
          ["categoryID", categoryID],
          ["customInfo", customInfo],
          ["stacksize", stacksize],
          ["singleton", singleton],
        ],
      },
    };
  }

  Handle_GetInventoryFromId(args, session, kwargs) {
    const itemid = args && args.length > 0 ? args[0] : 0;
    const numericItemId = this._normalizeInventoryId(itemid);
    const charId = this._getCharacterId(session);
    const stationId = this._getStationId(session);
    const boundContext = this._getBoundContext(session);
    const corporationOffice = this._getCorporationOffice(session, numericItemId);
    const boundShip =
      findCharacterShip(charId, numericItemId) ||
      findShipItemById(numericItemId);
    const isControlledStructureInventory =
      this._isControlledStructureInventoryID(session, numericItemId);
    const explicitLocationID =
      this._extractKwarg(kwargs, "locationID") ??
      (args && args.length > 2 ? args[2] : undefined);
    const normalizedExplicitLocationID =
      explicitLocationID === undefined || explicitLocationID === null
        ? 0
        : this._normalizeInventoryId(explicitLocationID);
    const inheritedLocationID =
      boundContext &&
      boundContext.locationID !== null &&
      boundContext.locationID !== undefined
        ? this._normalizeInventoryId(boundContext.locationID)
        : 0;
    const shipLocationID = boundShip
      ? this._normalizeInventoryId(boundShip.locationID)
      : 0;
    const resolvedLocationID =
      corporationOffice
        ? this._normalizeInventoryId(corporationOffice.officeID, numericItemId)
        :
      normalizedExplicitLocationID > 0
        ? normalizedExplicitLocationID
        : boundShip && inheritedLocationID > 0
          ? inheritedLocationID
          : shipLocationID > 0
            ? shipLocationID
            : numericItemId === stationId
              ? stationId
              : itemid;
    this._traceInventory("GetInventoryFromId", session, { args });
    log.debug(
      `[InvBroker] GetInventoryFromId(itemid=${itemid}, locationID=${resolvedLocationID})`,
    );
    const result = this._makeBoundSubstruct({
      inventoryID: corporationOffice
        ? this._normalizeInventoryId(corporationOffice.officeID, numericItemId)
        : itemid,
      locationID: resolvedLocationID,
      flagID:
        isControlledStructureInventory
          ? null
          :
        numericItemId === charId
          ? null
          :
        corporationOffice
          ? null
          :
        numericItemId === stationId
          ? ITEM_FLAGS.HANGAR
          : boundShip
            ? ITEM_FLAGS.CARGO_HOLD
            : null,
      kind:
        isControlledStructureInventory
          ? "controlledStructureInventory"
          :
        numericItemId === charId
          ? "characterInventory"
          :
        corporationOffice
          ? "corpOffice"
          :
        numericItemId === stationId
          ? "stationHangar"
          : boundShip
            ? "shipInventory"
            : "container",
    });
    if (boundShip) {
      log.debug(
        `[InvBroker] shipInventory bind shipID=${numericItemId} ` +
        `activeShip=${Number(this._getShipId(session)) === numericItemId} ` +
        `stationID=${stationId} locationID=${resolvedLocationID} ` +
        `${describeSessionHydrationState(session, numericItemId)}`,
      );
    }
    return result;
  }

  Handle_SetLabel(args, session) {
    this._traceInventory("SetLabel", session, { args });
    log.debug("[InvBroker] SetLabel");
    return null;
  }

  Handle_List(args, session, kwargs) {
    const argFlag = args && args.length > 0 ? args[0] : null;
    const kwFlag = this._extractKwarg(kwargs, "flag");
    const boundContext = this._getBoundContext(session);
    const hasArgFlag = Boolean(args && args.length > 0);
    const hasKwFlag = kwFlag !== undefined;
    const explicitFlagProvided = hasKwFlag || hasArgFlag;
    const explicitNullFlag =
      (hasKwFlag && kwFlag === null) ||
      (hasArgFlag && argFlag === null);
    const initialLoginSpaceShipInventoryList =
      this._isInitialLoginSpaceShipInventoryList(session, boundContext);
    if (initialLoginSpaceShipInventoryList) {
      this._clearLoginInventoryBootstrapPending(session);
      this._primePendingSpaceShipInventoryBootstrap(session, boundContext, {
        reason: "invbroker.List.initialPrime",
      });
    }
    const suppressInitialLoginShipList = false;
    if (suppressInitialLoginShipList) {
      this._traceInventory("ListLoginBootstrapSuppressed", session, {
        args,
        kwargs,
        boundContext,
      });
      log.debug(
        `[InvBroker] Suppressing initial login-in-space ship List(flag=None) for ship=${boundContext && boundContext.inventoryID}`,
      );
      return this._buildInventoryRowset([]);
    }
    const inSpaceShipInventory =
      boundContext?.kind === "shipInventory" &&
      !this._getStationId(session);
    const requestedFlag =
      boundContext?.kind === "shipInventory" &&
      (
        explicitNullFlag ||
        (!explicitFlagProvided && !inSpaceShipInventory)
      )
        ? null
        : hasKwFlag
          ? kwFlag
          : hasArgFlag
            ? argFlag
            : boundContext?.flagID ?? null;
    this._traceInventory("List", session, {
      args,
      kwargs,
      requestedFlag,
    });
    log.debug(
      `[InvBroker] List (inventory contents) flag=${requestedFlag} bound=${JSON.stringify(boundContext)}`,
    );

    const itemsForContainer = this._mergeActiveShipLoadedChargeTupleRows(
      session,
      boundContext,
      requestedFlag,
      this._resolveContainerItems(
        session,
        requestedFlag,
        boundContext,
      ),
    );
    const itemOverrides = itemsForContainer
      .map((item) => this._buildInventoryItemOverrides(session, item))
      .filter(Boolean);

    log.debug(`[InvBroker] List ships=${itemOverrides.length}`);
    if (boundContext && boundContext.kind === "shipInventory") {
      const listSummary = this._summarizeInventoryRowsForLog(itemsForContainer);
      log.debug(
        `[InvBroker] shipInventory List summary shipID=${Number(boundContext.inventoryID) || 0} ` +
        `requestedFlag=${requestedFlag === null ? "None" : requestedFlag} ` +
        `initialLogin=${initialLoginSpaceShipInventoryList} ` +
        `total=${listSummary.total} cargo=${listSummary.cargo} modules=${listSummary.modules} ` +
        `charges=${listSummary.charges} drones=${listSummary.drones} others=${listSummary.others} ` +
        `preview=${listSummary.preview.join("|")} ` +
        `${describeSessionHydrationState(session, boundContext.inventoryID)}`,
      );
    }
    this._traceInventory("ListResult", session, {
      requestedFlag,
      count: itemOverrides.length,
      firstLine: itemOverrides[0] || null,
    });
    const result = this._buildInventoryRemoteList(itemOverrides);
    if (
      this._shouldPrimeLoginShipInventoryBootstrap(session, boundContext, {
        initialLoginSpaceShipInventoryList,
        requestedFlag,
      })
    ) {
      this._primePendingSpaceShipInventoryBootstrap(session, boundContext, {
        requestedFlag,
        reason: "invbroker.List.postResult",
      });
    }
    return result;
  }

  Handle_ListByFlags(args, session, kwargs) {
    const boundContext = this._getBoundContext(session);
    const rawFlags =
      (args && args.length > 0 ? args[0] : null) ??
      this._extractKwarg(kwargs, "flags") ??
      [];
    const requestedFlags = this._normalizeFlagList(rawFlags);
    const seenItemIds = new Set();
    const itemOverrides = [];

    this._traceInventory("ListByFlags", session, {
      args,
      kwargs,
      requestedFlags,
    });
    log.debug(
      `[InvBroker] ListByFlags(flags=${requestedFlags.join(",")}) bound=${JSON.stringify(boundContext)}`,
    );

    for (const requestedFlag of requestedFlags) {
      const itemsForFlag = this._resolveContainerItems(
        session,
        requestedFlag,
        boundContext,
      );
      for (const item of itemsForFlag) {
        const itemID = item.itemID || item.shipID;
      if (seenItemIds.has(itemID)) {
        continue;
      }

      seenItemIds.add(itemID);
      const itemOverridesForRecord = this._buildInventoryItemOverrides(
        session,
        item,
      );
      if (itemOverridesForRecord) {
        itemOverrides.push(itemOverridesForRecord);
      }
    }
    }

    this._traceInventory("ListByFlagsResult", session, {
      requestedFlags,
      count: itemOverrides.length,
      firstLine: itemOverrides[0] || null,
    });
    const result = this._buildInventoryRemoteList(itemOverrides);
    if (
      this._shouldPrimeLoginShipInventoryBootstrap(session, boundContext, {
        requestedFlags,
      })
    ) {
      this._primePendingSpaceShipInventoryBootstrap(session, boundContext, {
        requestedFlags,
        reason: "invbroker.ListByFlags.postResult",
      });
    }
    return result;
  }

  Handle_ImportExportWithPlanet(args, session) {
    const boundContext = this._getBoundContext(session);
    const customsOfficeID = this._normalizeInventoryId(
      boundContext && (boundContext.inventoryID ?? boundContext.locationID),
      0,
    );
    const characterID = this._getCharacterId(session);
    const spaceportPinID = this._normalizeInventoryId(
      unwrapMarshalValue(args && args.length > 0 ? args[0] : 0),
      0,
    );
    const importData = args && args.length > 1 ? args[1] : {};
    const exportData = args && args.length > 2 ? args[2] : {};
    const clientTaxRate = Number(unwrapMarshalValue(args && args.length > 3 ? args[3] : null));
    const currentTaxRate = planetOrbitalState.getTaxRate(customsOfficeID);

    this._traceInventory("ImportExportWithPlanet", session, {
      customsOfficeID,
      spaceportPinID,
      clientTaxRate,
    });

    if (customsOfficeID <= 0 || spaceportPinID <= 0) {
      throwWrappedUserError("CannotImportEndpointNotFound");
    }

    if (
      !Number.isFinite(clientTaxRate) ||
      Math.abs(clientTaxRate - currentTaxRate) > 0.000001
    ) {
      throwWrappedUserError("TaxChanged");
    }

    const colony = planetRuntimeStore.getColonyByPin(characterID, spaceportPinID);
    if (!colony) {
      throwWrappedUserError("CannotImportEndpointNotFound");
    }

    const importInfo = this._buildPIImportCommoditiesFromItems(
      importData,
      customsOfficeID,
      characterID,
    );
    const exportCommodities = this._normalizeCommodityDict(exportData);
    const preview = planetRuntimeStore.previewSpaceportImportExport({
      planetID: colony.planetID,
      ownerID: characterID,
      spaceportPinID,
      importCommodities: importInfo.commodities,
      exportCommodities,
    });
    if (!preview.success) {
      throwWrappedUserError(preview.errorMsg || "CannotImportEndpointNotFound");
    }

    const importTax = planetCostCalculator.calculateImportTax(
      preview.spaceportPin && preview.spaceportPin.typeID,
      preview.importCommodities,
      currentTaxRate,
    );
    const exportTax = planetCostCalculator.calculateExportTax(
      preview.spaceportPin && preview.spaceportPin.typeID,
      preview.exportCommodities,
      currentTaxRate,
    );
    this._ensurePIWalletCanCover(characterID, importTax + exportTax);

    const debits = [];
    debits.push(this._debitPIWallet(
      characterID,
      importTax,
      JOURNAL_ENTRY_TYPE.PLANETARY_IMPORT_TAX,
      colony.planetID,
      "Planetary import tax",
    ));
    debits.push(this._debitPIWallet(
      characterID,
      exportTax,
      JOURNAL_ENTRY_TYPE.PLANETARY_EXPORT_TAX,
      colony.planetID,
      "Planetary export tax",
    ));

    try {
      const result = planetRuntimeStore.applySpaceportImportExport({
        planetID: colony.planetID,
        ownerID: characterID,
        spaceportPinID,
        importCommodities: importInfo.commodities,
        exportCommodities,
      });
      if (!result.success) {
        throwWrappedUserError(result.errorMsg || "CannotImportEndpointNotFound");
      }

      const inventoryChanges = [];
      for (const [typeID, quantity] of Object.entries(preview.importCommodities)) {
        const takeResult = takeItemTypeFromCharacterLocation(
          characterID,
          customsOfficeID,
          ITEM_FLAGS.HANGAR,
          typeID,
          quantity,
        );
        if (!takeResult.success) {
          throwWrappedUserError("CannotImportCommoditiesNotFound");
        }
        inventoryChanges.push(...((takeResult.data && takeResult.data.changes) || []));
      }

      for (const [typeID, quantity] of Object.entries(preview.exportCommodities)) {
        const grantResult = grantItemToCharacterLocation(
          characterID,
          customsOfficeID,
          ITEM_FLAGS.HANGAR,
          typeID,
          quantity,
          { singleton: 0 },
        );
        if (!grantResult.success) {
          throwWrappedUserError("CannotExportCommodities");
        }
        inventoryChanges.push(...((grantResult.data && grantResult.data.changes) || []));
      }

      this._emitInventoryMoveChanges(session, inventoryChanges);
      if (session && typeof session.sendNotification === "function") {
        session.sendNotification("OnRefreshPins", "clientID", [[spaceportPinID]]);
        session.sendNotification("OnMajorPlanetStateUpdate", "clientID", [colony.planetID, false]);
      }
      return null;
    } catch (error) {
      this._refundPIWalletDebits(
        characterID,
        debits,
        "Planetary import/export tax refund",
      );
      throw error;
    }
  }

  Handle_GetItem(args, session) {
    const boundContext = this._getBoundContext(session);
    const itemID =
      args && args.length > 0
        ? args[0]
        : boundContext && boundContext.inventoryID
          ? boundContext.inventoryID
          : this._getShipId(session);
    this._traceInventory("GetItem", session, {
      args,
      resolvedItemID: itemID,
    });
    log.debug(`[InvBroker] GetItem(itemID=${itemID})`);

    const numericItemID = this._normalizeInventoryId(itemID);
    const isCharacterItem = numericItemID === this._getCharacterId(session);
    const skillRecord = this._findCharacterSkillRecord(session, numericItemID);
    const shipRecord = findCharacterShip(
      this._getCharacterId(session),
      numericItemID,
    );
    const overrides = isCharacterItem
      ? this._buildCharacterItemOverrides(session)
      : shipRecord || skillRecord
        ? this._itemOverridesFromId(session, numericItemID)
        : this._buildContainerItemOverrides(session, numericItemID);

    return this._buildInvItem(session, overrides);
  }

  Handle_GetItemByID(args, session) {
    return this.Handle_GetItem(args, session);
  }

  Handle_GetItems(args, session) {
    const ids = args && args.length > 0 && Array.isArray(args[0]) ? args[0] : [];
    this._traceInventory("GetItems", session, { args });
    log.debug(`[InvBroker] GetItems(count=${ids.length})`);

    const items = ids.map((id) =>
      this._buildInvItem(session, this._itemOverridesFromId(session, id)),
    );
    return { type: "list", items };
  }

  Handle_GetSelfInvItem(args, session) {
    const boundContext = this._getBoundContext(session);
    const inventoryID =
      boundContext && boundContext.inventoryID !== null && boundContext.inventoryID !== undefined
        ? boundContext.inventoryID
        : this._getShipId(session);
    const overrides = this._buildContainerItemOverrides(session, inventoryID);
    this._traceInventory("GetSelfInvItem", session, { args });
    log.debug("[InvBroker] GetSelfInvItem");
    this._traceInventory("GetSelfInvItemResult", session, {
      inventoryID,
      overrides,
    });
    if (
      this._shouldPrimeLoginShipInventoryBootstrap(session, boundContext, {
        requestedFlag: null,
      })
    ) {
      this._primePendingSpaceShipInventoryBootstrap(session, boundContext, {
        requestedFlag: null,
        reason: "invbroker.GetSelfInvItem",
      });
    }
    return this._buildInvKeyVal(session, overrides);
  }

  Handle_StripFitting(args, session) {
    this._traceInventory("StripFitting", session, { args });
    const boundContext = this._getBoundContext(session);
    const shipRecord = this._getShipInventoryRecord(session, boundContext);

    if (!shipRecord) {
      log.warn(`[InvBroker] StripFitting failed: could not resolve ship record from bound context`);
      return null;
    }

    const charID = this._getCharacterId(session);
    const fittedItems = listFittedItems(charID, shipRecord.itemID);
    log.debug(`[InvBroker] StripFitting shipID=${shipRecord.itemID} locationID=${shipRecord.locationID} fittedCount=${fittedItems.length}`);

    if (fittedItems.length === 0) {
      return null;
    }

    const allChanges = [];
    let movedCount = 0;

    for (const fittedItem of fittedItems) {
      if (SLOT_FAMILY_FLAGS.rig.includes(fittedItem.flagID)) {
        continue;
      }

      //log.debug(`[InvBroker] StripFitting moving itemID=${fittedItem.itemID} typeID=${fittedItem.typeID} flagID=${fittedItem.flagID} categoryID=${fittedItem.categoryID}`);
      const moveResult = moveItemToLocation(fittedItem.itemID, shipRecord.locationID, ITEM_FLAGS.HANGAR);
      if (!moveResult.success) {
        log.warn(`[InvBroker] StripFitting failed to move itemID=${fittedItem.itemID} typeID=${fittedItem.typeID} flagID=${fittedItem.flagID} error=${moveResult.errorMsg}`);
        continue;
      }

      movedCount += 1;
      allChanges.push(...((moveResult.data && moveResult.data.changes) || []));
    }

    if (movedCount <= 0) {
      return null;
    }

    this._emitInventoryMoveChanges(session, allChanges);
    this._refreshBallparkShipPresentation(session, allChanges);
    this._refreshBallparkInventoryPresentation(session, allChanges);

    // After all moves, getLoadedChargeItems returns empty. Syncing with
    // emitChargeInventoryRows:true sends the client an explicit "no charges"
    // state for this ship, clearing any stale ammo displayed in the fitting window.
    syncShipFittingStateForSession(session, shipRecord.itemID, {
      includeOfflineModules: true,
      includeCharges: true,
      emitChargeInventoryRows: true,
    });

    return null;
  }

  Handle_DestroyFitting(args, session) {
    this._traceInventory("DestroyFitting", session, { args });
    const itemID = this._normalizeInventoryId(args && args.length > 0 ? args[0] : 0, 0);
    if (itemID <= 0) {
      log.warn(`[InvBroker] DestroyFitting failed: invalid itemID`);
      return null;
    }

    const item = findItemById(itemID);
    if (!item) {
      log.warn(`[InvBroker] DestroyFitting failed: itemID=${itemID} not found`);
      return null;
    }

    if (!SLOT_FAMILY_FLAGS.rig.includes(item.flagID)) {
      log.warn(`[InvBroker] DestroyFitting rejected: itemID=${itemID} flagID=${item.flagID} is not a rig slot`);
      return null;
    }

    log.debug(`[InvBroker] DestroyFitting itemID=${itemID} flagID=${item.flagID}`);
    const removeResult = removeInventoryItem(itemID, { removeContents: false });
    if (!removeResult.success) {
      log.warn(`[InvBroker] DestroyFitting failed to remove itemID=${itemID} error=${removeResult.errorMsg}`);
      return null;
    }

    const changes = (removeResult.data && removeResult.data.changes) || [];
    this._emitInventoryMoveChanges(session, changes);
    this._refreshBallparkShipPresentation(session, changes);
    this._refreshBallparkInventoryPresentation(session, changes);
    return null;
  }

  Handle_TrashItems(args, session) {
    this._traceInventory("TrashItems", session, { args });
    log.debug("[InvBroker] TrashItems");
    const itemIDs = this._normalizeItemIdList(args && args.length > 0 ? args[0] : []);
    const requestedLocationID = this._normalizeInventoryId(
      args && args.length > 1 ? args[1] : this._getStationId(session),
      this._getStationId(session),
    );

    if (itemIDs.length === 0) {
      return null;
    }

    const inventoryItems = itemIDs.map((itemID) => findItemById(itemID));
    const hasInvalidItem = inventoryItems.some(
      (item) => !this._isInventoryItemTrashable(session, item, requestedLocationID),
    );
    if (hasInvalidItem) {
      return [CANNOT_TRASH_ERROR];
    }

    const allChanges = [];
    for (const itemID of this._filterTopLevelTrashItemIDs(itemIDs)) {
      const removeResult = removeInventoryItem(itemID, { removeContents: true });
      if (!removeResult.success) {
        return [CANNOT_TRASH_ERROR];
      }
      allChanges.push(...((removeResult.data && removeResult.data.changes) || []));
    }

    this._emitInventoryMoveChanges(session, allChanges);
    this._refreshBallparkShipPresentation(session, allChanges);
    this._refreshBallparkInventoryPresentation(session, allChanges);
    return null;
  }

  Handle_GetContainerContents(args, session) {
    const containerID =
      args && args.length > 0 ? args[0] : this._getStationId(session);
    const locationID = args && args.length > 1 ? args[1] : containerID;
    const numericContainerID = this._normalizeInventoryId(containerID);
    const stationId = this._getStationId(session);
    const corporationOffice = this._getCorporationOffice(session, numericContainerID);
    this._traceInventory("GetContainerContents", session, { args });
    log.debug(
      `[InvBroker] GetContainerContents(containerID=${numericContainerID}, locationID=${locationID})`,
    );

    const nativeWreckRecord = this._getNativeWreckRecord(numericContainerID);
    const items =
      numericContainerID === this._getCharacterId(session)
        ? this._getCharacterContainerItems(session, null)
        :
      corporationOffice
        ? this._listCorporationOfficeItems(session, corporationOffice, null)
        :
      numericContainerID === stationId
        ? listContainerItems(
            this._getCharacterId(session),
            stationId,
            ITEM_FLAGS.HANGAR,
          )
        : nativeWreckRecord
          ? nativeNpcStore.buildNativeWreckContents(numericContainerID)
        : listContainerItems(
            this._getCharacterId(session),
            numericContainerID,
            null,
          );

    this._traceInventory("GetContainerContentsResult", session, {
      containerID: numericContainerID,
      count: items.length,
      firstItem: items[0] || null,
    });
    return this._buildInventoryRowset(
      items
        .map((item) => this._buildInventoryItemOverrides(session, item))
        .filter(Boolean)
        .map((overrides) => this._buildInvRow(session, overrides)),
    );
  }

  Handle_GetCapacity(args, session, kwargs) {
    const boundContext = this._getBoundContext(session);
    const requestedFlag =
      (args && args.length > 0 ? args[0] : null) ??
      this._extractKwarg(kwargs, "flag") ??
      (boundContext ? boundContext.flagID : null);
    this._traceInventory("GetCapacity", session, {
      args,
      kwargs,
      requestedFlag,
    });
    log.debug(
      `[InvBroker] GetCapacity(flag=${String(requestedFlag)}) bound=${JSON.stringify(boundContext)}`,
    );
    return this._calculateCapacity(session, boundContext, requestedFlag);
  }

  Handle_StackAll(args, session, kwargs) {
    this._traceInventory("StackAll", session, { args, kwargs });
    const boundContext = this._getBoundContext(session);
    const requestedFlag =
      (args && args.length > 0 ? args[0] : null) ??
      this._extractKwarg(kwargs, "flag") ??
      (boundContext ? boundContext.flagID : null);
    const containerID = this._normalizeInventoryId(
      boundContext && boundContext.inventoryID,
      this._getStationId(session),
    );
    const flagID =
      requestedFlag === null || requestedFlag === undefined
        ? boundContext && boundContext.flagID !== null && boundContext.flagID !== undefined
          ? this._normalizeInventoryId(boundContext.flagID, ITEM_FLAGS.HANGAR)
          : ITEM_FLAGS.HANGAR
        : this._normalizeInventoryId(requestedFlag, ITEM_FLAGS.HANGAR);
    const items = this._resolveContainerItems(session, flagID, {
      ...(boundContext || {}),
      inventoryID: containerID,
    })
      .filter((item) => item && Number(item.singleton) !== 1)
      .sort((left, right) => (Number(left.itemID) || 0) - (Number(right.itemID) || 0));
    const stacksByType = new Map();
    const allChanges = [];
    let mergedCount = 0;

    log.debug(
      `[InvBroker] StackAll container=${containerID} flag=${flagID} count=${items.length}`,
    );

    for (const item of items) {
      if (!stacksByType.has(item.typeID)) {
        stacksByType.set(item.typeID, item.itemID);
        continue;
      }

      const destinationItemID = stacksByType.get(item.typeID);
      const mergeResult = mergeItemStacks(item.itemID, destinationItemID);
      if (!mergeResult.success) {
        continue;
      }

      mergedCount += 1;
      allChanges.push(...((mergeResult.data && mergeResult.data.changes) || []));
    }

    if (mergedCount <= 0) {
      return null;
    }

    this._emitInventoryMoveChanges(session, allChanges);
    this._refreshBallparkShipPresentation(session, allChanges);
    this._refreshBallparkInventoryPresentation(session, allChanges);
    return true;
  }

  Handle_MultiMerge(args, session, kwargs) {
    this._traceInventory("MultiMerge", session, { args, kwargs });
    const ops = this._normalizeMergeOps(args && args.length > 0 ? args[0] : []);
    const sourceContainerID = this._normalizeInventoryId(
      args && args.length > 1 ? args[1] : 0,
      0,
    );
    const allChanges = [];
    let mergedCount = 0;

    log.debug(
      `[InvBroker] MultiMerge opCount=${ops.length} sourceContainerID=${sourceContainerID}`,
    );

    for (const op of ops) {
      const sourceItem = findItemById(op.sourceItemID);
      const destinationItem = findItemById(op.destinationItemID);
      if (!sourceItem || !destinationItem) {
        continue;
      }

      const mergeResult = mergeItemStacks(
        op.sourceItemID,
        op.destinationItemID,
        op.quantity,
      );
      if (!mergeResult.success) {
        continue;
      }

      mergedCount += 1;
      allChanges.push(...((mergeResult.data && mergeResult.data.changes) || []));
    }

    if (mergedCount <= 0) {
      return null;
    }

    this._emitInventoryMoveChanges(session, allChanges);
    this._refreshBallparkShipPresentation(session, allChanges);
    this._refreshBallparkInventoryPresentation(session, allChanges);
    return null;
  }

  Handle_Add(args, session, kwargs) {
    this._traceInventory("Add", session, { args, kwargs });
    const boundContext = this._getBoundContext(session);
    const itemID = this._normalizeInventoryId(args && args.length > 0 ? args[0] : 0, 0);
    const sourceLocationID = this._normalizeInventoryId(
      args && args.length > 1 ? args[1] : 0,
      0,
    );
    const explicitFlagValue = this._extractKwarg(kwargs, "flag");
    const explicitFlagProvided = explicitFlagValue !== undefined;
    const requestedFlag =
      explicitFlagProvided
        ? this._normalizeInventoryId(explicitFlagValue, 0)
        : boundContext && boundContext.flagID !== null && boundContext.flagID !== undefined
          ? this._normalizeInventoryId(boundContext.flagID, 0)
          : null;
    const quantity = this._normalizeQuantityArg(
      this._extractKwarg(kwargs, "qty") ?? this._extractKwarg(kwargs, "quantity"),
    );
    const sourceItemDescriptor = this._findTransferSourceItem(itemID, sourceLocationID);
    const item = sourceItemDescriptor && sourceItemDescriptor.item
      ? sourceItemDescriptor.item
      : null;
    const fleetLootEntries = [];

    log.debug(
      `[InvBroker] Add itemID=${itemID} source=${sourceLocationID} requestedFlag=${String(requestedFlag)} bound=${JSON.stringify(boundContext)}`,
    );

    if (!boundContext || !item || !sourceItemDescriptor) {
      return null;
    }

    // Rigs cannot be removed from a ship and returned to inventory — they must be destroyed.
    // If the item is currently in a rig slot, block the move silently.
    if (SLOT_FAMILY_FLAGS.rig.includes(Number(item.flagID))) {
      log.warn(
        `[InvBroker] Add rejected itemID=${itemID} — item is a rig in slot flagID=${item.flagID} and cannot be unfit to inventory`,
      );
      return null;
    }

    const destination = this._resolveDestinationForMove(
      session,
      boundContext,
      item,
      requestedFlag,
      explicitFlagProvided,
    );
    if (!destination) {
      log.warn(
        `[InvBroker] Add rejected itemID=${itemID} source=${sourceLocationID} requestedFlag=${String(requestedFlag)} error=NO_SUITABLE_FIT_SLOT`,
      );
      throwWrappedUserError("ModuleFitFailed", {
        moduleName: Number(item.typeID) || 0,
        reason: "No suitable slot available",
      });
    }
    const shipRecord = this._getShipInventoryRecord(session, boundContext);
    const fitHostRecord = shipRecord || this._getStructureFitHostRecord(
      session,
      boundContext && boundContext.inventoryID,
    );
    const fitValidation = this._validateFittingMove(
      session,
      fitHostRecord,
      item,
      destination,
      fitHostRecord
        ? listFittedItems(this._getCharacterId(session), fitHostRecord.itemID)
        : null,
    );
    if (!fitValidation.success) {
      log.warn(
        `[InvBroker] Add rejected itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${fitValidation.errorMsg}`,
      );
      return null;
    }
    const structureCoreValidation = this._validateStructureCoreInstallMove(
      item,
      destination,
    );
    if (!structureCoreValidation.success) {
      throwWrappedUserError(
        structureCoreValidation.errorMsg,
        structureCoreValidation.values || {
          type: Number(item.typeID) || 0,
        },
      );
    }
    const shipBayValidation = this._validateShipBayMove(
      session,
      shipRecord,
      item,
      destination,
    );
    if (!shipBayValidation.success) {
      log.warn(
        `[InvBroker] Add rejected itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${shipBayValidation.errorMsg}`,
      );
      throwWrappedUserError(shipBayValidation.errorMsg, {
        type: Number(item.typeID) || 0,
      });
    }
    const structureOwnerBayValidation = this._validateStructureOwnerBayMove(
      item,
      destination,
    );
    if (!structureOwnerBayValidation.success) {
      throwWrappedUserError(structureOwnerBayValidation.errorMsg, {
        type: Number(item.typeID) || 0,
      });
    }
    const appliedQuantity = this._resolveAppliedMoveQuantity(
      item,
      destination,
      quantity,
    );
    const capacityCheck = this._checkCapacityForMove(
      session,
      boundContext,
      destination,
      item,
      appliedQuantity,
    );
    if (!capacityCheck.success) {
      log.warn(
        `[InvBroker] Add rejected itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${capacityCheck.errorMsg}`,
      );
      throwWrappedUserError(capacityCheck.errorMsg, {
        type: Number(item.typeID) || 0,
        free: Number(capacityCheck.free.toFixed(6)),
        required: Number(capacityCheck.requiredVolume.toFixed(6)),
      });
    }
    const moveResult = this._moveSourceItemToDestination(
      session,
      sourceItemDescriptor,
      destination,
      appliedQuantity,
    );
    if (!moveResult.success) {
      log.warn(
        `[InvBroker] Add failed itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${moveResult.errorMsg}`,
      );
      return null;
    }

    this._appendFleetLootEntry(
      session,
      fleetLootEntries,
      sourceItemDescriptor,
      sourceLocationID,
      destination,
      quantity,
    );
    this._emitInventoryMoveChanges(session, moveResult.data.changes);
    this._refreshBallparkShipPresentation(session, moveResult.data.changes);
    this._refreshBallparkInventoryPresentation(session, moveResult.data.changes);
    this._syncStructureCoreInstall(session, item, destination);
    this._syncStructureServiceModuleMove(session, item, destination);
    this._emitFleetLootEvents(session, fleetLootEntries);
    // If the source was a temporary space container, despawn it when empty.
    if (item) {
      maybeExpireEmptySpaceContainer(session, item.locationID);
    }
    return this._resolveMovedItemID(moveResult, itemID, destination);
  }

  Handle_MultiAdd(args, session, kwargs) {
    this._traceInventory("MultiAdd", session, { args, kwargs });
    const boundContext = this._getBoundContext(session);
    const itemIDs = this._normalizeItemIdList(args && args.length > 0 ? args[0] : []);
    const sourceLocationID = this._normalizeInventoryId(
      args && args.length > 1 ? args[1] : 0,
      0,
    );
    const explicitFlagValue = this._extractKwarg(kwargs, "flag");
    const explicitFlagProvided = explicitFlagValue !== undefined;
    const requestedFlag =
      explicitFlagProvided
        ? this._normalizeInventoryId(explicitFlagValue, 0)
        : boundContext && boundContext.flagID !== null && boundContext.flagID !== undefined
          ? this._normalizeInventoryId(boundContext.flagID, 0)
          : null;
    const quantity = this._normalizeQuantityArg(
      this._extractKwarg(kwargs, "qty") ?? this._extractKwarg(kwargs, "quantity"),
    );
    const shipRecord = this._getShipInventoryRecord(session, boundContext);
    const fitHostRecord = shipRecord || this._getStructureFitHostRecord(
      session,
      boundContext && boundContext.inventoryID,
    );
    const charId = this._getCharacterId(session);
    const fittedItemsSnapshot = fitHostRecord
      ? listFittedItems(charId, fitHostRecord.itemID).map((item) => ({ ...item }))
      : [];
    const allChanges = [];
    const fleetLootEntries = [];
    let movedCount = 0;

    log.debug(
      `[InvBroker] MultiAdd itemCount=${itemIDs.length} source=${sourceLocationID} requestedFlag=${String(requestedFlag)} bound=${JSON.stringify(boundContext)}`,
    );

    if (!boundContext || itemIDs.length === 0) {
      return null;
    }

    for (const itemID of itemIDs) {
      const sourceItemDescriptor = this._findTransferSourceItem(itemID, sourceLocationID);
      const item = sourceItemDescriptor && sourceItemDescriptor.item
        ? sourceItemDescriptor.item
        : null;
      if (!item || !sourceItemDescriptor) {
        continue;
      }

      const destination = this._resolveDestinationForMove(
        session,
        boundContext,
        item,
        requestedFlag,
        explicitFlagProvided,
        fittedItemsSnapshot,
      );
      if (!destination) {
        continue;
      }
      const fitValidation = this._validateFittingMove(
        session,
        fitHostRecord,
        item,
        destination,
        fittedItemsSnapshot,
      );
      if (!fitValidation.success) {
        continue;
      }
      const structureCoreValidation = this._validateStructureCoreInstallMove(
        item,
        destination,
      );
      if (!structureCoreValidation.success) {
        if (movedCount > 0) {
          continue;
        }
        throwWrappedUserError(
          structureCoreValidation.errorMsg,
          structureCoreValidation.values || {
            type: Number(item.typeID) || 0,
          },
        );
      }
      const shipBayValidation = this._validateShipBayMove(
        session,
        shipRecord,
        item,
        destination,
      );
      if (!shipBayValidation.success) {
        continue;
      }
      const structureOwnerBayValidation = this._validateStructureOwnerBayMove(
        item,
        destination,
      );
      if (!structureOwnerBayValidation.success) {
        continue;
      }
      const appliedQuantity = this._resolveAppliedMoveQuantity(
        item,
        destination,
        quantity,
      );
      const capacityCheck = this._checkCapacityForMove(
        session,
        boundContext,
        destination,
        item,
        appliedQuantity,
      );
      if (!capacityCheck.success) {
        log.warn(
          `[InvBroker] MultiAdd rejected itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${capacityCheck.errorMsg}`,
        );
        throwWrappedUserError(capacityCheck.errorMsg, {
          type: Number(item.typeID) || 0,
          free: Number(capacityCheck.free.toFixed(6)),
          required: Number(capacityCheck.requiredVolume.toFixed(6)),
        });
      }
      const moveResult = this._moveSourceItemToDestination(
        session,
        sourceItemDescriptor,
        destination,
        appliedQuantity,
      );
      if (!moveResult.success) {
        continue;
      }

      this._appendFleetLootEntry(
        session,
        fleetLootEntries,
        sourceItemDescriptor,
        sourceLocationID,
        destination,
        quantity,
      );
      movedCount += 1;
      allChanges.push(...(moveResult.data.changes || []));
      this._syncStructureCoreInstall(session, item, destination);
      this._syncStructureServiceModuleMove(session, item, destination);
      if (
        fitHostRecord &&
        destination.locationID === fitHostRecord.itemID &&
        isShipFittingFlag(destination.flagID)
      ) {
        const movedItemID =
          this._resolveMovedItemID(moveResult, itemID, destination) || itemID;
        const movedItem = findItemById(movedItemID) || item;
        fittedItemsSnapshot.push({
          itemID: movedItemID,
          typeID: movedItem.typeID,
          flagID: destination.flagID,
          locationID: fitHostRecord.itemID,
          categoryID: movedItem.categoryID,
          groupID: movedItem.groupID,
        });
      }
    }

    if (movedCount <= 0) {
      return null;
    }

    this._emitInventoryMoveChanges(session, allChanges);
    this._refreshBallparkShipPresentation(session, allChanges);
    this._refreshBallparkInventoryPresentation(session, allChanges);
    this._emitFleetLootEvents(session, fleetLootEntries);
    // If any source was a temporary space container, despawn it when now empty.
    const sourceContainerIDs = new Set(
      allChanges
        .filter((c) => c && c.previousData && Number(c.previousData.locationID) > 0)
        .map((c) => Number(c.previousData.locationID)),
    );
    for (const cid of sourceContainerIDs) {
      maybeExpireEmptySpaceContainer(session, cid);
    }
    return true;
  }

  Handle_FitFitting(args, session, kwargs) {
    this._traceInventory("FitFitting", session, { args, kwargs });
    const shipID = this._normalizeInventoryId(args && args.length > 0 ? args[0] : 0, 0);
    const sourceLocationID = this._normalizeInventoryId(
      args && args.length > 3 ? args[3] : this._getStationId(session),
      this._getStationId(session),
    );
    const itemsByType = this._normalizeFitFittingItemsByType(
      args && args.length > 2 ? args[2] : {},
    );
    const modulesByFlag = this._normalizeFitFittingModulesByFlag(
      args && args.length > 4 ? args[4] : {},
    );
    const shipRecord =
      findCharacterShip(this._getCharacterId(session), shipID) ||
      findShipItemById(shipID) ||
      this._getStructureFitHostRecord(session, shipID);
    const fittedItemsSnapshot = shipRecord
      ? listFittedItems(this._getCharacterId(session), shipRecord.itemID).map((item) => ({ ...item }))
      : [];
    const missingByType = new Map();
    const allChanges = [];
    let fittedCount = 0;

    log.debug(
      `[InvBroker] FitFitting shipID=${shipID} source=${sourceLocationID} moduleSlots=${modulesByFlag.length}`,
    );

    if (!shipRecord || modulesByFlag.length <= 0) {
      return buildList([]);
    }

    for (const entry of modulesByFlag) {
      const candidateItemIDs = itemsByType.get(entry.typeID) || [];
      let fitted = false;

      while (candidateItemIDs.length > 0) {
        const itemID = candidateItemIDs.shift();
        const sourceItemDescriptor = this._findTransferSourceItem(itemID, sourceLocationID);
        const item = sourceItemDescriptor && sourceItemDescriptor.item
          ? sourceItemDescriptor.item
          : null;
        if (!item || Number(item.typeID) !== entry.typeID) {
          continue;
        }

        const destination = {
          locationID: shipRecord.itemID,
          flagID: entry.flagID,
        };
        const fitValidation = this._validateFittingMove(
          session,
          shipRecord,
          item,
          destination,
          fittedItemsSnapshot,
        );
        if (!fitValidation.success) {
          continue;
        }
        const shipBayValidation = this._validateShipBayMove(
          session,
          shipRecord,
          item,
          destination,
        );
        if (!shipBayValidation.success) {
          continue;
        }
        const capacityCheck = this._checkCapacityForMove(
          session,
          { kind: "shipInventory", inventoryID: shipRecord.itemID, flagID: entry.flagID },
          destination,
          item,
          1,
        );
        if (!capacityCheck.success) {
          continue;
        }

        const moveResult = this._moveSourceItemToDestination(
          session,
          sourceItemDescriptor,
          destination,
          this._resolveAppliedMoveQuantity(item, destination, 1),
        );
        if (!moveResult.success) {
          continue;
        }

        const movedItemID =
          this._resolveMovedItemID(moveResult, itemID, destination) || itemID;
        const movedItem = findItemById(movedItemID) || item;
        fittedItemsSnapshot.push({
          itemID: movedItemID,
          typeID: movedItem.typeID,
          flagID: entry.flagID,
          locationID: shipRecord.itemID,
          categoryID: movedItem.categoryID,
          groupID: movedItem.groupID,
        });
        allChanges.push(...((moveResult.data && moveResult.data.changes) || []));
        this._syncStructureServiceModuleMove(session, item, destination);
        fittedCount += 1;
        fitted = true;
        break;
      }

      if (!fitted) {
        missingByType.set(entry.typeID, (missingByType.get(entry.typeID) || 0) + 1);
      }
    }

    if (fittedCount > 0) {
      this._emitInventoryMoveChanges(session, allChanges);
      this._refreshBallparkShipPresentation(session, allChanges);
      this._refreshBallparkInventoryPresentation(session, allChanges);
    }

    return buildList(
      [...missingByType.entries()]
        .sort(([leftTypeID], [rightTypeID]) => leftTypeID - rightTypeID)
        .map(([typeID, quantity]) => [typeID, quantity]),
    );
  }

  _listShipInventoryFlagContents(session, flagID) {
    const boundContext = this._getBoundContext(session);
    const shipInventoryID =
      boundContext && boundContext.kind === "shipInventory"
        ? this._normalizeInventoryId(boundContext.inventoryID, this._getShipId(session))
        : this._getShipId(session);

    if (shipInventoryID <= 0) {
      return this._buildInventoryRemoteList([]);
    }

    const shipContext = {
      ...(boundContext || {}),
      kind: "shipInventory",
      inventoryID: shipInventoryID,
      flagID,
    };
    const itemsForFlag = this._resolveContainerItems(
      session,
      flagID,
      shipContext,
    );
    this._primeInSpaceBayDogmaItems(
      session,
      shipContext,
      flagID,
      itemsForFlag,
    );
    const itemOverrides = itemsForFlag
      .map((item) => this._buildInventoryItemOverrides(session, item))
      .filter(Boolean);

    return this._buildInventoryRemoteList(itemOverrides);
  }

  Handle_ListDroneBay(args, session, kwargs) {
    this._traceInventory("ListDroneBay", session, { args, kwargs });
    log.debug("[InvBroker] ListDroneBay");
    return this._listShipInventoryFlagContents(session, ITEM_FLAGS.DRONE_BAY);
  }

  Handle_ListFighterBay(args, session, kwargs) {
    this._traceInventory("ListFighterBay", session, { args, kwargs });
    log.debug("[InvBroker] ListFighterBay");
    return this._listShipInventoryFlagContents(session, ITEM_FLAGS.FIGHTER_BAY);
  }

  Handle_ListFuelBay(args, session, kwargs) {
    this._traceInventory("ListFuelBay", session, { args, kwargs });
    log.debug("[InvBroker] ListFuelBay");
    return this._listShipInventoryFlagContents(session, ITEM_FLAGS.FUEL_BAY);
  }

  Handle_TakeOutTrash(args, session, kwargs) {
    this._traceInventory("TakeOutTrash", session, { args, kwargs });
    log.debug("[InvBroker] TakeOutTrash");
    return null;
  }

  Handle_AssembleCargoContainer(args, session, kwargs) {
    this._traceInventory("AssembleCargoContainer", session, { args, kwargs });
    log.debug("[InvBroker] AssembleCargoContainer");
    return null;
  }

  Handle_BreakPlasticWrap(args, session, kwargs) {
    this._traceInventory("BreakPlasticWrap", session, { args, kwargs });
    log.debug("[InvBroker] BreakPlasticWrap");
    return null;
  }

  Handle_DeliverToCorpHangar(args, session, kwargs) {
    this._traceInventory("DeliverToCorpHangar", session, { args, kwargs });
    const boundContext = this._getBoundContext(session);
    const itemIDs = this._normalizeItemIdList(
      args && args.length > 0 ? args[0] : args,
    );
    const officeID =
      this._extractKwarg(kwargs, "officeID") ??
      this._extractKwarg(kwargs, "locationID") ??
      (args && args.length > 1 ? args[1] : null) ??
      (boundContext && boundContext.inventoryID);
    const corporationOffice = this._getCorporationOffice(session, officeID);
    const explicitFlag =
      this._extractKwarg(kwargs, "flag") ??
      this._extractKwarg(kwargs, "divisionFlag") ??
      (args && args.length > 2 ? args[2] : null) ??
      (boundContext && boundContext.flagID);
    const destinationFlag = this._isCorporationHangarFlag(explicitFlag)
      ? this._normalizeInventoryId(explicitFlag, 0)
      : 115;
    let sourceLocationID = this._normalizeInventoryId(
      this._extractKwarg(kwargs, "sourceLocationID") ??
        this._extractKwarg(kwargs, "fromLocationID") ??
        this._extractKwarg(kwargs, "stationID") ??
        (args && args.length > 1 ? args[1] : null) ??
        this._getStationId(session),
      this._getStationId(session),
    );
    const allChanges = [];
    let movedCount = 0;

    log.debug(
      `[InvBroker] DeliverToCorpHangar itemCount=${itemIDs.length} officeID=${String(officeID)} flag=${destinationFlag}`,
    );

    if (!corporationOffice || itemIDs.length === 0) {
      return null;
    }
    if (
      sourceLocationID ===
      this._normalizeInventoryId(corporationOffice.officeID, 0)
    ) {
      sourceLocationID = this._getStationId(session);
    }

    for (const itemID of itemIDs) {
      const sourceItemDescriptor = this._findTransferSourceItem(
        itemID,
        sourceLocationID,
      );
      if (!sourceItemDescriptor || !sourceItemDescriptor.item) {
        continue;
      }

      const moveResult = this._moveSourceItemToDestination(
        session,
        sourceItemDescriptor,
        {
          locationID: this._normalizeInventoryId(corporationOffice.officeID, 0),
          flagID: destinationFlag,
        },
      );
      if (!moveResult.success) {
        continue;
      }

      movedCount += 1;
      allChanges.push(...((moveResult.data && moveResult.data.changes) || []));
    }

    if (movedCount <= 0) {
      return null;
    }

    this._emitInventoryMoveChanges(session, allChanges);
    this._refreshBallparkShipPresentation(session, allChanges);
    this._refreshBallparkInventoryPresentation(session, allChanges);
    return true;
  }

  Handle_DeliverToCorpMember(args, session, kwargs) {
    this._traceInventory("DeliverToCorpMember", session, { args, kwargs });
    log.debug("[InvBroker] DeliverToCorpMember");
    return null;
  }

  Handle_GetItemDescriptor(args, session) {
    this._traceInventory("GetItemDescriptor", session, { args });
    log.debug("[InvBroker] GetItemDescriptor");
    return this._buildInventoryRowDescriptor();
  }

  Handle_GetAvailableTurretSlots(args, session) {
    this._traceInventory("GetAvailableTurretSlots", session, { args });
    log.debug(
      `[InvBroker] GetAvailableTurretSlots ${describeSessionHydrationState(session)}`,
    );
    this._primeDeferredSpaceBallparkVisuals(
      session,
      this._getBoundContext(session),
      {
        reason: "GetAvailableTurretSlots",
      },
    );
    const charId = Number(
      session && (session.characterID || session.charid || session.userid),
    ) || 0;
    const shipID = Number(
      session && (session.shipID || session.shipid || session.activeShipID),
    ) || 0;
    const shipRecord =
      (charId > 0 && shipID > 0 ? findCharacterShip(charId, shipID) : null) ||
      (charId > 0 ? getActiveShipRecord(charId) : null) ||
      (shipID > 0 ? findShipItemById(shipID) : null);
    if (!shipRecord) {
      return 0;
    }

    const fittingSnapshot = getShipFittingSnapshot(charId, shipRecord.itemID, {
      shipItem: shipRecord,
      reason: "invbroker.turret-slots",
    });
    const resourceState = fittingSnapshot && fittingSnapshot.resourceState
      ? fittingSnapshot.resourceState
      : {};
    return Math.max(0, Number(resourceState && resourceState.turretSlotsLeft) || 0);
  }

  Handle_MachoResolveObject(args, session, kwargs) {
    this._traceInventory("MachoResolveObject", session, { args, kwargs });
    log.debug("[InvBroker] MachoResolveObject called");
    const config = require(path.join(__dirname, "../../config"));
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    const config = require(path.join(__dirname, "../../config"));
    const bindParams = args && args.length > 0 ? args[0] : null;
    const nestedCall = args && args.length > 1 ? args[1] : null;

    log.debug(
      `[InvBroker] MachoBindObject args.length=${args ? args.length : 0} bindParams=${JSON.stringify(bindParams, (k, v) => (typeof v === "bigint" ? v.toString() : v))} nestedCall=${JSON.stringify(nestedCall, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))} kwargs=${JSON.stringify(kwargs, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))}`,
    );
    this._traceInventory("MachoBindObject", session, {
      args,
      kwargs,
      bindParams,
      nestedCall,
    });

    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
    const oid = [idString, now];

    this._rememberBoundContext(idString, {
      inventoryID:
        Array.isArray(bindParams) && bindParams.length > 0
          ? bindParams[0]
          : bindParams,
      locationID:
        Array.isArray(bindParams) && bindParams.length > 0
          ? bindParams[0]
          : bindParams,
      flagID: null,
      kind: "boundInventory",
    });

    let callResult = null;
    if (nestedCall && Array.isArray(nestedCall) && nestedCall.length >= 1) {
      const methodName =
        typeof nestedCall[0] === "string"
          ? nestedCall[0]
          : Buffer.isBuffer(nestedCall[0])
            ? nestedCall[0].toString("utf8")
            : String(nestedCall[0]);
      const callArgs = nestedCall.length > 1 ? nestedCall[1] : [];
      const callKwargs = nestedCall.length > 2 ? nestedCall[2] : null;

      log.debug(`[InvBroker] MachoBindObject nested call: ${methodName}`);
      const previousBoundObjectID = session
        ? session.currentBoundObjectID
        : null;
      try {
        if (session) {
          session.currentBoundObjectID = idString;
        }
        callResult = this.callMethod(
          methodName,
          Array.isArray(callArgs) ? callArgs : [callArgs],
          session,
          callKwargs,
        );
        const nestedBoundId = this._extractBoundObjectId(callResult);
        const nestedBoundContext = nestedBoundId
          ? this._boundContexts.get(nestedBoundId) || null
          : null;
        if (nestedBoundContext) {
          this._rememberBoundContext(idString, nestedBoundContext);
        }
      } finally {
        if (session) {
          session.currentBoundObjectID = previousBoundObjectID || null;
        }
      }
    }

    return [
      {
        type: "substruct",
        value: { type: "substream", value: oid },
      },
      callResult != null ? callResult : null,
    ];
  }

  afterCallResponse(method, session) {
    if (!session) {
      return;
    }

    if (method === "GetAvailableTurretSlots") {
      return;
    }

    if (
      method === "GetInventoryFromId" ||
      method === "List" ||
      method === "GetSelfInvItem"
    ) {
      completeDockedFittingBootstrap(session, {
        trigger: `invbroker.${method}`,
      });
    }

    if (
      method !== "List" &&
      method !== "GetSelfInvItem"
    ) {
      return;
    }
    const boundContext = this._getBoundContext(session);
    if (!boundContext || boundContext.kind !== "stationHangar") {
      return;
    }

    if (!shouldFlushDeferredDockedShipSessionChange(session, method)) {
      return;
    }

    flushDeferredDockedShipSessionChange(session, {
      trigger: `invbroker.${method}`,
    });
  }
}

module.exports = InvBrokerService;
