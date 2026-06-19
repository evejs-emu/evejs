const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const {
  buildFiletimeLong,
  buildKeyVal,
  buildRowset,
  currentFileTime,
  normalizeText,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getDockedLocationID,
  getDockedLocationKind,
  isDockedSession,
} = require(path.join(__dirname, "../structure/structureLocation"));
const characterState = require(path.join(__dirname, "../character/characterState"));
const {
  getCharacterRecord,
  updateCharacterRecord,
  writeCharacterRecord,
  getActiveShipRecord,
  applyCharacterToSession,
  flushCharacterSessionNotificationPlan,
  syncInventoryItemForSession,
} = characterState;
const {
  ITEM_FLAGS,
  dockShipToLocation,
  findItemById,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  getFittedModuleItems,
  getTypeAttributeValue,
  isEffectivelyOnlineModule,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  getCharacterWallet,
  adjustCharacterBalance,
  buildNotEnoughMoneyUserErrorValues,
  JOURNAL_ENTRY_TYPE,
} = require(path.join(__dirname, "../account/walletState"));
const {
  createNotification,
} = require(path.join(__dirname, "../notifications/notificationState"));
const {
  NOTIFICATION_GROUP,
} = require(path.join(__dirname, "../notifications/notificationConstants"));
const {
  canCharacterDockAtStructure,
} = require(path.join(__dirname, "../structure/structureState"));
const {
  STRUCTURE_SERVICE_ID,
} = require(path.join(__dirname, "../structure/structureConstants"));
const {
  structureHasOnlineService,
} = require(path.join(__dirname, "../structure/structureServiceAuthority"));
const {
  ATTRIBUTE_MAX_JUMP_CLONES,
  ATTRIBUTE_CLONE_JUMP_COOLDOWN,
  TYPE_CLONE_VAT_BAY_I,
  JUMP_CLONE_INSTALL_COST,
  REF_JUMP_CLONE_INSTALLATION_FEE,
  REF_JUMP_CLONE_ACTIVATION_FEE,
  NOTIFICATION_TYPE_JUMP_CLONE_DELETED_1,
  NOTIFICATION_TYPE_JUMP_CLONE_DELETED_2,
  EVENT_CLONE_JUMP,
  EVENT_CLONE_DESTRUCTION,
  EVENT_CLONE_INSTALLATION,
  EVENT_CLONE_JUMP_TIME_RESET,
  EVENT_CLONE_DESTROYED_WITH_LOCATION,
  EVENT_CLONE_IMPLANT_REMOVAL,
  CLONE_NAME_MAX_LENGTH,
  getCharacterCloneLimit,
  getCharacterCloneJumpCooldownHours,
} = require(path.join(__dirname, "./jumpCloneRules"));

const CLONE_ROW_HEADER = ["jumpCloneID", "locationID", "cloneName"];
const IMPLANT_ROW_HEADER = ["jumpCloneID", "typeID"];
const SHIP_CLONE_ROW_HEADER = ["jumpCloneID", "ownerID", "locationID"];
const CLIENT_ROWSET_NAME = "eve.common.script.sys.rowset.Rowset";
const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const FILETIME_TICKS_PER_MS = 10000n;
const pendingShipCloneOffers = new Map();

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toFileTimeMs(value) {
  try {
    const filetime =
      typeof value === "bigint"
        ? value
        : BigInt(String(value && value.value !== undefined ? value.value : value || 0));
    if (filetime <= FILETIME_EPOCH_OFFSET) {
      return 0;
    }
    return Number((filetime - FILETIME_EPOCH_OFFSET) / FILETIME_TICKS_PER_MS);
  } catch (error) {
    return 0;
  }
}

function getNowFileTimeString() {
  return currentFileTime().toString();
}

function normalizeImplant(entry = {}) {
  const typeID = toPositiveInt(entry && entry.typeID, 0);
  if (!typeID) {
    return null;
  }
  return {
    ...entry,
    typeID,
    slot: Math.max(0, Math.trunc(Number(entry.slot || 0) || 0)),
    name: normalizeText(entry.name, ""),
  };
}

function resolveLocationKind(locationID) {
  const numericLocationID = toPositiveInt(locationID, 0);
  if (!numericLocationID) {
    return "unknown";
  }
  if (worldData.getStationByID(numericLocationID)) {
    return "station";
  }
  if (worldData.getStructureByID(numericLocationID)) {
    return "structure";
  }
  const item = findItemById(numericLocationID);
  if (item && Number(item.categoryID || 0) === 6) {
    return "ship";
  }
  return "unknown";
}

function resolveLocationSolarSystemID(locationID, fallback = 0) {
  const station = worldData.getStationByID(locationID);
  if (station) {
    return toPositiveInt(station.solarSystemID, fallback);
  }
  const structure = worldData.getStructureByID(locationID);
  if (structure) {
    return toPositiveInt(structure.solarSystemID, fallback);
  }
  const item = findItemById(locationID);
  if (item) {
    return toPositiveInt(item.locationID, fallback);
  }
  return fallback;
}

function normalizeClone(entry = {}, fallbackID = 0, ownerID = 0) {
  const jumpCloneID = toPositiveInt(
    entry.jumpCloneID ?? entry.cloneID ?? entry.itemID,
    fallbackID,
  );
  const locationID = toPositiveInt(
    entry.locationID ?? entry.stationID ?? entry.structureID,
    0,
  );
  if (!jumpCloneID || !locationID) {
    return null;
  }
  const locationKind =
    entry.locationKind ||
    (entry.stationID ? "station" : null) ||
    (entry.structureID ? "structure" : null) ||
    resolveLocationKind(locationID);
  return {
    jumpCloneID,
    cloneID: jumpCloneID,
    itemID: jumpCloneID,
    ownerID: toPositiveInt(entry.ownerID, ownerID),
    locationID,
    stationID: locationKind === "station" ? locationID : null,
    structureID: locationKind === "structure" ? locationID : null,
    solarSystemID: toPositiveInt(
      entry.solarSystemID,
      resolveLocationSolarSystemID(locationID, 0),
    ),
    locationKind,
    cloneName: normalizeText(entry.cloneName ?? entry.name, ""),
    name: normalizeText(entry.cloneName ?? entry.name, ""),
    implants: (Array.isArray(entry.implants) ? entry.implants : [])
      .map(normalizeImplant)
      .filter(Boolean),
  };
}

function normalizeActiveImplants(record = {}) {
  return (Array.isArray(record.implants) ? record.implants : [])
    .map(normalizeImplant)
    .filter(Boolean);
}

function normalizeJumpClones(record = {}) {
  const charID = toPositiveInt(record.characterID ?? record.charID ?? record.charid, 0);
  return (Array.isArray(record.jumpClones) ? record.jumpClones : [])
    .map((entry, index) => normalizeClone(entry, charID * 100000 + 90000 + index, charID))
    .filter(Boolean)
    .sort((left, right) => left.jumpCloneID - right.jumpCloneID);
}

function getNextCloneID(record = {}, normalizedClones = []) {
  const charID = toPositiveInt(record.characterID ?? record.charID ?? record.charid, 0);
  const highestExistingID = normalizedClones.reduce(
    (highest, clone) => Math.max(highest, toPositiveInt(clone && clone.jumpCloneID, 0)),
    0,
  );
  return Math.max(
    toPositiveInt(record.nextJumpCloneID, 0),
    highestExistingID + 1,
    charID * 100000 + 90000,
  );
}

function normalizeCloneName(value, fallback = "") {
  return normalizeText(value, fallback).slice(0, CLONE_NAME_MAX_LENGTH);
}

function buildCloneRecord({
  jumpCloneID,
  ownerID,
  locationID,
  cloneName,
  implants = [],
  locationKind = null,
}) {
  const resolvedLocationKind = locationKind || resolveLocationKind(locationID);
  return normalizeClone({
    jumpCloneID,
    ownerID,
    locationID,
    locationKind: resolvedLocationKind,
    cloneName: normalizeCloneName(cloneName, ""),
    implants,
  }, jumpCloneID, ownerID);
}

function buildCloneRows(clones = []) {
  return buildRowset(
    CLONE_ROW_HEADER,
    clones.map((clone) => [
      clone.jumpCloneID,
      clone.locationID,
      clone.cloneName || "",
    ]),
    CLIENT_ROWSET_NAME,
  );
}

function buildImplantRows(clones = []) {
  const rows = [];
  for (const clone of clones) {
    for (const implant of clone.implants || []) {
      rows.push([clone.jumpCloneID, implant.typeID]);
    }
  }
  return buildRowset(IMPLANT_ROW_HEADER, rows, CLIENT_ROWSET_NAME);
}

function buildShipCloneRows(clones = []) {
  return buildRowset(
    SHIP_CLONE_ROW_HEADER,
    clones.map((clone) => [
      clone.jumpCloneID,
      clone.ownerID,
      clone.locationID,
    ]),
    CLIENT_ROWSET_NAME,
  );
}

function getCloneState(charID) {
  const record = getCharacterRecord(charID) || {};
  const clones = normalizeJumpClones(record);
  return {
    record,
    implants: normalizeActiveImplants(record),
    clones,
    timeLastCloneJump: String(record.timeLastCloneJump || "0"),
    nextJumpCloneID: getNextCloneID(record, clones),
  };
}

function buildCloneStatePayload(session) {
  const state = getCloneState(session && session.characterID);
  return buildKeyVal([
    ["clones", buildCloneRows(state.clones)],
    ["implants", buildImplantRows(state.clones)],
    ["timeLastJump", buildFiletimeLong(state.timeLastCloneJump || 0n)],
  ]);
}

function getCurrentDockedLocation(session) {
  if (!session || !isDockedSession(session)) {
    return {
      locationID: 0,
      kind: "space",
    };
  }
  return {
    locationID: getDockedLocationID(session),
    kind: getDockedLocationKind(session),
  };
}

function buildStationCloneStatePayload(session) {
  const locationID = getCurrentDockedLocation(session).locationID;
  const state = getCloneState(session && session.characterID);
  return buildCloneRows(state.clones.filter((clone) => clone.locationID === locationID));
}

function buildShipCloneStatePayload(session) {
  const shipID = toPositiveInt(
    session && (session.shipid ?? session.shipID ?? session.activeShipID),
    0,
  );
  const state = getCloneState(session && session.characterID);
  return buildShipCloneRows(
    state.clones.filter((clone) => (
      clone.locationKind === "ship" &&
      (!shipID || clone.locationID === shipID)
    )),
  );
}

function emitSessionNotification(session, eventName, payload = []) {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  session.sendNotification(eventName, "clientID", payload);
}

function emitCloneInvalidations(session, locationID = 0, ownerID = 0) {
  emitSessionNotification(session, "OnJumpCloneCacheInvalidated", []);
  if (locationID) {
    emitSessionNotification(session, "OnStationJumpCloneCacheInvalidated", [
      locationID,
      ownerID || (session && session.characterID) || 0,
    ]);
    emitSessionNotification(session, "OnShipJumpCloneCacheInvalidated", [
      locationID,
      ownerID || (session && session.characterID) || 0,
    ]);
  }
}

function appendCloneEvent(record, eventTypeID, data = {}) {
  const entries = Array.isArray(record.cloneEventLog)
    ? record.cloneEventLog.map((entry) => cloneValue(entry))
    : [];
  entries.unshift({
    eventTypeID,
    created: getNowFileTimeString(),
    ...data,
  });
  record.cloneEventLog = entries.slice(0, 100);
}

function throwNotEnoughMoney(requiredAmount, currentBalance) {
  throwWrappedUserError(
    "NotEnoughMoney",
    buildNotEnoughMoneyUserErrorValues(requiredAmount, currentBalance),
  );
}

function ensureWalletCanPay(charID, amount) {
  const normalizedAmount = Math.max(0, Number(amount) || 0);
  if (normalizedAmount <= 0) {
    return;
  }
  const wallet = getCharacterWallet(charID);
  if (!wallet || wallet.balance + 0.0001 < normalizedAmount) {
    throwNotEnoughMoney(normalizedAmount, wallet ? wallet.balance : 0);
  }
}

function debitCharacter(charID, amount, options = {}) {
  const normalizedAmount = Math.max(0, Number(amount) || 0);
  if (normalizedAmount <= 0) {
    return null;
  }
  const debitResult = adjustCharacterBalance(charID, -normalizedAmount, options);
  if (!debitResult.success) {
    if (debitResult.errorMsg === "INSUFFICIENT_FUNDS") {
      throwNotEnoughMoney(normalizedAmount, 0);
    }
    throwWrappedUserError("CustomNotify", {
      notify: debitResult.errorMsg || "Wallet transaction failed",
    });
  }
  return debitResult;
}

function isStructureMedicalServiceOnline(structure) {
  if (!structure) {
    return false;
  }
  return (
    structureHasOnlineService(structure, STRUCTURE_SERVICE_ID.MEDICAL) ||
    structureHasOnlineService(structure, STRUCTURE_SERVICE_ID.JUMP_CLONE)
  );
}

function validateInstallJumpClone(session) {
  const errors = [];
  const charID = toPositiveInt(session && session.characterID, 0);
  const current = getCurrentDockedLocation(session);
  if (!charID || !current.locationID) {
    errors.push("UI/CharacterSheet/CharacterSheetWindow/JumpCloneScroll/JumpNotDockedError");
    return errors;
  }

  const state = getCloneState(charID);
  const limit = getCharacterCloneLimit(charID);
  if (limit <= 0) {
    errors.push("UI/Medical/JumpCloneSkillReqNotMet");
  }
  if (state.clones.length >= limit) {
    errors.push([
      "UI/Medical/JumpCloneUsageAndCapacity",
      {
        count: state.clones.length,
        limit,
      },
    ]);
  }
  if (state.clones.some((clone) => clone.locationID === current.locationID)) {
    errors.push([
      "UI/CharacterSheet/CharacterSheetWindow/JumpCloneScroll/InstalledCloneCount",
      {
        clone_count: state.clones.filter((clone) => clone.locationID === current.locationID).length,
      },
    ]);
  }
  if (current.kind === "structure") {
    const structure = worldData.getStructureByID(current.locationID);
    const dockCheck = canCharacterDockAtStructure(session, structure, {
      ignoreRestrictions: false,
    });
    if (!dockCheck.success || !isStructureMedicalServiceOnline(structure)) {
      errors.push("UI/Medical/Errors/UnknownValidationError");
    }
  }

  return errors;
}

function installCloneAtCurrentLocation(session) {
  const charID = toPositiveInt(session && session.characterID, 0);
  const current = getCurrentDockedLocation(session);
  if (!charID || !current.locationID) {
    throwWrappedUserError("NotAtStation");
  }

  const validationErrors = validateInstallJumpClone(session);
  if (validationErrors.length > 0) {
    throwWrappedUserError("CustomNotify", {
      notify: Array.isArray(validationErrors[0])
        ? validationErrors[0][0]
        : validationErrors[0],
    });
  }

  ensureWalletCanPay(charID, JUMP_CLONE_INSTALL_COST);
  const installResult = updateCharacterRecord(charID, (record) => {
    const clones = normalizeJumpClones(record);
    const nextJumpCloneID = getNextCloneID(record, clones);
    const clone = buildCloneRecord({
      jumpCloneID: nextJumpCloneID,
      ownerID: charID,
      locationID: current.locationID,
      locationKind: current.kind,
      cloneName: "",
      implants: [],
    });
    record.jumpClones = [...clones, clone];
    record.nextJumpCloneID = nextJumpCloneID + 1;
    appendCloneEvent(record, EVENT_CLONE_INSTALLATION, {
      jumpCloneID: clone.jumpCloneID,
      locationID: clone.locationID,
    });
    return record;
  });
  if (!installResult.success) {
    throwWrappedUserError("CustomNotify", {
      notify: installResult.errorMsg || "Jump clone install failed",
    });
  }

  debitCharacter(charID, JUMP_CLONE_INSTALL_COST, {
    description: `Jump clone installation at ${current.locationID}`,
    entryTypeID:
      JOURNAL_ENTRY_TYPE.JUMP_CLONE_INSTALLATION || REF_JUMP_CLONE_INSTALLATION_FEE,
    ownerID1: charID,
    referenceID: current.locationID,
  });
  emitCloneInvalidations(session, current.locationID, charID);
  return null;
}

function setJumpCloneName(session, cloneID, newName) {
  const charID = toPositiveInt(session && session.characterID, 0);
  const targetCloneID = toPositiveInt(cloneID, 0);
  if (!charID || !targetCloneID) {
    throwWrappedUserError("CustomNotify", { notify: "Jump clone not found" });
  }
  const name = normalizeCloneName(newName, "");
  let locationID = 0;
  const result = updateCharacterRecord(charID, (record) => {
    const clones = normalizeJumpClones(record);
    const target = clones.find((clone) => clone.jumpCloneID === targetCloneID);
    if (!target) {
      return record;
    }
    target.cloneName = name;
    target.name = name;
    locationID = target.locationID;
    record.jumpClones = clones;
    return record;
  });
  if (!result.success || !locationID) {
    throwWrappedUserError("CustomNotify", { notify: "Jump clone not found" });
  }
  emitCloneInvalidations(session, locationID, charID);
  return null;
}

function createJumpCloneDeletionNotification(charID, typeIDs = [], destroyerID = charID) {
  return createNotification(charID, {
    typeID:
      destroyerID === charID
        ? NOTIFICATION_TYPE_JUMP_CLONE_DELETED_1
        : NOTIFICATION_TYPE_JUMP_CLONE_DELETED_2,
    senderID: destroyerID,
    groupID: NOTIFICATION_GROUP.MISC,
    data: {
      locationOwnerID: charID,
      destroyerID,
      typeIDs,
    },
  });
}

function destroyInstalledClone(session, cloneID, options = {}) {
  const charID = toPositiveInt(session && session.characterID, 0);
  const targetCloneID = toPositiveInt(cloneID, 0);
  if (!charID || !targetCloneID) {
    throwWrappedUserError("CustomNotify", { notify: "Jump clone not found" });
  }

  let removedClone = null;
  const result = updateCharacterRecord(charID, (record) => {
    const clones = normalizeJumpClones(record);
    const remainingClones = [];
    for (const clone of clones) {
      if (clone.jumpCloneID === targetCloneID) {
        removedClone = clone;
      } else {
        remainingClones.push(clone);
      }
    }
    if (!removedClone) {
      return record;
    }
    record.jumpClones = remainingClones;
    appendCloneEvent(record, EVENT_CLONE_DESTRUCTION, {
      jumpCloneID: removedClone.jumpCloneID,
      locationID: removedClone.locationID,
      typeIDs: removedClone.implants.map((implant) => implant.typeID),
    });
    return record;
  });
  if (!result.success || !removedClone) {
    throwWrappedUserError("CustomNotify", { notify: "Jump clone not found" });
  }

  if (options.notify !== false) {
    createJumpCloneDeletionNotification(
      charID,
      removedClone.implants.map((implant) => implant.typeID),
      options.destroyerID || charID,
    );
  }
  emitCloneInvalidations(session, removedClone.locationID, charID);
  return null;
}

function isCloneJumpCooldownActive(charID, timeLastCloneJump) {
  const cooldownHours = getCharacterCloneJumpCooldownHours(charID);
  if (cooldownHours <= 0) {
    return false;
  }
  const lastJumpMs = toFileTimeMs(timeLastCloneJump);
  if (!lastJumpMs) {
    return false;
  }
  return Date.now() < lastJumpMs + cooldownHours * 60 * 60 * 1000;
}

function buildCloneJumpState(session, destLocationID, cloneID, confirmed = false) {
  const charID = toPositiveInt(session && session.characterID, 0);
  const current = getCurrentDockedLocation(session);
  if (!charID || !current.locationID) {
    throwWrappedUserError("NotAtStation");
  }
  const state = getCloneState(charID);
  const targetCloneID = toPositiveInt(cloneID, 0);
  const targetLocationID = toPositiveInt(destLocationID, 0);
  const targetClone = state.clones.find((clone) => (
    clone.jumpCloneID === targetCloneID &&
    (!targetLocationID || clone.locationID === targetLocationID)
  ));
  if (!targetClone) {
    throwWrappedUserError("CustomNotify", { notify: "Jump clone not found" });
  }
  const shouldCheckTimer =
    targetClone.locationID !== current.locationID ||
    targetClone.locationKind === "ship";
  if (shouldCheckTimer && isCloneJumpCooldownActive(charID, state.timeLastCloneJump)) {
    throwWrappedUserError("CustomNotify", {
      notify: "UI/CharacterSheet/CharacterSheetWindow/JumpCloneScroll/JumpCooldownError",
    });
  }

  const originClone = state.clones.find((clone) => (
    clone.locationID === current.locationID &&
    clone.jumpCloneID !== targetClone.jumpCloneID
  ));
  if (originClone && confirmed !== true) {
    throwWrappedUserError("JumpCheckWillLoseExistingClone", {
      locationID: current.locationID,
    });
  }
  if (targetClone.locationKind === "ship" && confirmed !== true) {
    throwWrappedUserError("JumpCheckIntoShip", {
      shipID: targetClone.locationID,
    });
  }
  if (targetClone.locationKind === "structure" && confirmed !== true) {
    throwWrappedUserError("JumpCheckIntoStructure", {
      structureID: targetClone.locationID,
    });
  }

  const replacementCloneID =
    targetClone.locationID === current.locationID
      ? targetClone.jumpCloneID
      : state.nextJumpCloneID;
  const replacementClone = buildCloneRecord({
    jumpCloneID: replacementCloneID,
    ownerID: charID,
    locationID: current.locationID,
    locationKind: current.kind,
    cloneName: originClone ? originClone.cloneName : "",
    implants: state.implants,
  });
  const nextClones = state.clones
    .filter((clone) => (
      clone.jumpCloneID !== targetClone.jumpCloneID &&
      (!originClone || clone.jumpCloneID !== originClone.jumpCloneID)
    ));
  nextClones.push(replacementClone);
  nextClones.sort((left, right) => left.jumpCloneID - right.jumpCloneID);

  return {
    charID,
    originLocationID: current.locationID,
    targetClone,
    originClone,
    nextClones,
    nextImplants: targetClone.implants,
    nextJumpCloneID:
      replacementCloneID >= state.nextJumpCloneID
        ? replacementCloneID + 1
        : state.nextJumpCloneID,
    timeLastCloneJump: getNowFileTimeString(),
  };
}

function applyCloneJumpRecordState(jumpState) {
  const result = updateCharacterRecord(jumpState.charID, (record) => {
    record.implants = jumpState.nextImplants;
    record.jumpClones = jumpState.nextClones;
    record.nextJumpCloneID = jumpState.nextJumpCloneID;
    record.timeLastCloneJump = jumpState.timeLastCloneJump;
    appendCloneEvent(record, EVENT_CLONE_JUMP, {
      fromLocationID: jumpState.originLocationID,
      toLocationID: jumpState.targetClone.locationID,
      targetCloneID: jumpState.targetClone.jumpCloneID,
    });
    return record;
  });
  if (!result.success) {
    throwWrappedUserError("CustomNotify", {
      notify: result.errorMsg || "Clone jump failed",
    });
  }
  return result;
}

function buildLocationIdentityPatch(record, solarSystemID, extra = {}) {
  const targetSolarSystemID =
    toPositiveInt(solarSystemID, toPositiveInt(record.solarSystemID, 30000142));
  const system = worldData.getSolarSystemByID(targetSolarSystemID);
  return {
    ...record,
    ...extra,
    solarSystemID: targetSolarSystemID,
    constellationID:
      toPositiveInt(system && system.constellationID, toPositiveInt(record.constellationID, 20000020)),
    regionID:
      toPositiveInt(system && system.regionID, toPositiveInt(record.regionID, 10000002)),
    worldSpaceID: 0,
  };
}

function jumpSessionToStructure(session, structureID) {
  const structure = worldData.getStructureByID(structureID);
  if (!structure) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }
  const dockCheck = canCharacterDockAtStructure(session, structure, {
    ignoreRestrictions: false,
  });
  if (!dockCheck.success) {
    return dockCheck;
  }
  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const dockResult = dockShipToLocation(activeShip.itemID, structure.structureID);
  if (!dockResult.success) {
    return dockResult;
  }
  const updateResult = updateCharacterRecord(session.characterID, (record) =>
    buildLocationIdentityPatch(record, structure.solarSystemID, {
      stationID: null,
      structureID: structure.structureID,
    }),
  );
  if (!updateResult.success) {
    return updateResult;
  }

  const applyResult = applyCharacterToSession(session, session.characterID, {
    emitNotifications: false,
    logSelection: true,
    selectionEvent: false,
    deferDockedShipSessionChange: false,
  });
  if (!applyResult.success) {
    return applyResult;
  }
  flushCharacterSessionNotificationPlan(session, applyResult.notificationPlan);
  syncInventoryItemForSession(
    session,
    dockResult.data,
    {
      locationID: dockResult.previousData && dockResult.previousData.locationID,
      flagID: dockResult.previousData && dockResult.previousData.flagID,
      quantity: dockResult.previousData && dockResult.previousData.quantity,
      singleton: dockResult.previousData && dockResult.previousData.singleton,
      stacksize: dockResult.previousData && dockResult.previousData.stacksize,
    },
    {
      emitCfgLocation: true,
    },
  );
  return {
    success: true,
    data: {
      structure,
    },
  };
}

function performCloneJump(session, destLocationID, cloneID, cost = null, confirmed = false) {
  const jumpState = buildCloneJumpState(session, destLocationID, cloneID, confirmed === true);
  const activationCost =
    cost === null || cost === undefined
      ? JUMP_CLONE_INSTALL_COST
      : Math.max(0, Number(cost) || 0);
  ensureWalletCanPay(jumpState.charID, activationCost);

  const targetKind = jumpState.targetClone.locationKind;
  const originalRecord = getCharacterRecord(jumpState.charID);
  try {
    if (jumpState.targetClone.locationID !== jumpState.originLocationID) {
      if (targetKind === "ship") {
        const { jumpSessionToShipCloneBay } = require(path.join(
          __dirname,
          "../../space/transitions",
        ));
        const transitionResult = jumpSessionToShipCloneBay(
          session,
          jumpState.targetClone.locationID,
        );
        if (!transitionResult.success) {
          return transitionResult;
        }
      } else if (targetKind === "station") {
        const { jumpSessionToStation } = require(path.join(
          __dirname,
          "../../space/transitions",
        ));
        const transitionResult = jumpSessionToStation(
          session,
          jumpState.targetClone.locationID,
        );
        if (!transitionResult.success) {
          return transitionResult;
        }
      } else if (targetKind === "structure") {
        const transitionResult = jumpSessionToStructure(
          session,
          jumpState.targetClone.locationID,
        );
        if (!transitionResult.success) {
          return transitionResult;
        }
      } else {
        throwWrappedUserError("CustomNotify", {
          notify: "Jump clone destination is unavailable",
        });
      }
    }

    applyCloneJumpRecordState(jumpState);
    debitCharacter(jumpState.charID, activationCost, {
      description: `Jump clone activation to ${jumpState.targetClone.locationID}`,
      entryTypeID:
        JOURNAL_ENTRY_TYPE.JUMP_CLONE_ACTIVATION || REF_JUMP_CLONE_ACTIVATION_FEE,
      ownerID1: jumpState.charID,
      referenceID: jumpState.targetClone.locationID,
    });
    emitCloneInvalidations(session, jumpState.originLocationID, jumpState.charID);
    emitCloneInvalidations(session, jumpState.targetClone.locationID, jumpState.charID);
    return null;
  } catch (error) {
    if (originalRecord) {
      writeCharacterRecord(jumpState.charID, originalRecord);
    }
    throw error;
  }
}

function resetLastCloneJumpTime(session) {
  const charID = toPositiveInt(session && session.characterID, 0);
  if (!charID) {
    return null;
  }
  updateCharacterRecord(charID, (record) => {
    record.timeLastCloneJump = "0";
    appendCloneEvent(record, EVENT_CLONE_JUMP_TIME_RESET, {});
    return record;
  });
  emitCloneInvalidations(session, getCurrentDockedLocation(session).locationID, charID);
  return null;
}

function getShipCloneCapacity(ship) {
  if (!ship) {
    return 0;
  }
  return Math.max(0, Math.trunc(
    Number(getTypeAttributeValue(ship.typeID, "maxJumpClones") || 0) || 0,
  ));
}

function getShipSolarSystemID(ship) {
  return toPositiveInt(
    ship && ship.spaceState && ship.spaceState.systemID,
    toPositiveInt(ship && ship.locationID, 0),
  );
}

function getShipSpacePosition(ship) {
  const position = ship && ship.spaceState && ship.spaceState.position;
  if (!position) {
    return null;
  }
  return {
    x: toFiniteNumber(position.x, 0),
    y: toFiniteNumber(position.y, 0),
    z: toFiniteNumber(position.z, 0),
  };
}

function getShipSpaceRadius(ship) {
  return Math.max(
    0,
    toFiniteNumber(ship && ship.spaceRadius, 0),
    toFiniteNumber(ship && ship.spaceState && ship.spaceState.radius, 0),
  );
}

function calculateSurfaceDistanceMeters(sourceShip, targetShip) {
  const sourcePosition = getShipSpacePosition(sourceShip);
  const targetPosition = getShipSpacePosition(targetShip);
  if (!sourcePosition || !targetPosition) {
    return null;
  }
  const dx = sourcePosition.x - targetPosition.x;
  const dy = sourcePosition.y - targetPosition.y;
  const dz = sourcePosition.z - targetPosition.z;
  const centerDistance = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
  return Math.max(
    0,
    centerDistance - getShipSpaceRadius(sourceShip) - getShipSpaceRadius(targetShip),
  );
}

function validateCloneVatTargetRange(sourceShip, targetShip) {
  const maxOperationalDistance = Math.max(
    0,
    toFiniteNumber(getTypeAttributeValue(sourceShip && sourceShip.typeID, "maxOperationalDistance"), 0),
  );
  if (maxOperationalDistance <= 0) {
    return false;
  }
  if (!sourceShip || !targetShip || !sourceShip.spaceState || !targetShip.spaceState) {
    return false;
  }
  if (getShipSolarSystemID(sourceShip) !== getShipSolarSystemID(targetShip)) {
    return false;
  }
  const surfaceDistance = calculateSurfaceDistanceMeters(sourceShip, targetShip);
  return surfaceDistance !== null && surfaceDistance <= maxOperationalDistance;
}

function hasCloneReceivingBay(session) {
  const charID = toPositiveInt(session && session.characterID, 0);
  const activeShip = getActiveShipRecord(charID);
  if (!activeShip) {
    return false;
  }
  const canReceive =
    Number(getTypeAttributeValue(activeShip.typeID, "canReceiveCloneJumps") || 0) > 0;
  if (!canReceive) {
    return false;
  }
  const fittedModules = getFittedModuleItems(charID, activeShip.itemID);
  return fittedModules.some((module) => (
    Number(module.typeID) === TYPE_CLONE_VAT_BAY_I &&
    isEffectivelyOnlineModule(module)
  ));
}

function getNumClonesInPilotsStructure(session) {
  const locationID = toPositiveInt(session && (session.structureid || session.shipid), 0);
  if (!locationID) {
    return 0;
  }
  const state = getCloneState(session && session.characterID);
  return state.clones.filter((clone) => clone.locationID === locationID).length;
}

function offerShipCloneInstallation(session, targetCharID) {
  const offeringCharID = toPositiveInt(session && session.characterID, 0);
  const targetCharacterID = toPositiveInt(targetCharID, 0);
  const activeShip = getActiveShipRecord(offeringCharID);
  if (!offeringCharID || !targetCharacterID || !activeShip) {
    throwWrappedUserError("CustomNotify", { notify: "Clone install target unavailable" });
  }
  if (!hasCloneReceivingBay(session)) {
    throwWrappedUserError("InviteClone1");
  }
  const targetSession = sessionRegistry.findSessionByCharacterID(targetCharacterID, {
    excludeSession: null,
  });
  if (!targetSession) {
    throwWrappedUserError("CustomNotify", { notify: "Clone install target unavailable" });
  }
  const targetShip = getActiveShipRecord(targetCharacterID);
  if (!validateCloneVatTargetRange(activeShip, targetShip)) {
    throwWrappedUserError("InviteClone2");
  }

  const offer = {
    offeringCharID,
    targetCharID: targetCharacterID,
    shipID: activeShip.itemID,
    offeredAt: Date.now(),
  };
  pendingShipCloneOffers.set(targetCharacterID, offer);
  emitSessionNotification(targetSession, "OnShipJumpCloneInstallationOffered", [
    [offer.offeringCharID, offer.targetCharID, offer.shipID, 0],
  ]);
  return null;
}

function acceptShipCloneInstallation(session) {
  const targetCharID = toPositiveInt(session && session.characterID, 0);
  const offer = pendingShipCloneOffers.get(targetCharID);
  if (!offer) {
    throwWrappedUserError("CustomNotify", { notify: "Clone install offer expired" });
  }
  const ship = findItemById(offer.shipID);
  if (!ship) {
    pendingShipCloneOffers.delete(targetCharID);
    throwWrappedUserError("CustomNotify", { notify: "Clone install ship unavailable" });
  }
  const offeringShip = getActiveShipRecord(offer.offeringCharID);
  const targetShip = getActiveShipRecord(targetCharID);
  if (!offeringShip || offeringShip.itemID !== offer.shipID || !validateCloneVatTargetRange(offeringShip, targetShip)) {
    pendingShipCloneOffers.delete(targetCharID);
    throwWrappedUserError("InviteClone2");
  }
  const targetState = getCloneState(targetCharID);
  const capacity = getShipCloneCapacity(ship);
  const installedInShip = targetState.clones.filter((clone) => clone.locationID === ship.itemID).length;
  if (installedInShip >= capacity) {
    throwWrappedUserError("CustomNotify", { notify: "Clone bay is full" });
  }
  const cloneLimit = getCharacterCloneLimit(targetCharID);
  if (targetState.clones.length >= cloneLimit) {
    throwWrappedUserError("CustomNotify", { notify: "UI/Medical/JumpCloneSkillReqNotMet" });
  }

  ensureWalletCanPay(targetCharID, JUMP_CLONE_INSTALL_COST);
  updateCharacterRecord(targetCharID, (record) => {
    const clones = normalizeJumpClones(record);
    const nextJumpCloneID = getNextCloneID(record, clones);
    clones.push(buildCloneRecord({
      jumpCloneID: nextJumpCloneID,
      ownerID: targetCharID,
      locationID: ship.itemID,
      locationKind: "ship",
      cloneName: "",
      implants: [],
    }));
    record.jumpClones = clones;
    record.nextJumpCloneID = nextJumpCloneID + 1;
    appendCloneEvent(record, EVENT_CLONE_INSTALLATION, {
      jumpCloneID: nextJumpCloneID,
      locationID: ship.itemID,
    });
    return record;
  });
  debitCharacter(targetCharID, JUMP_CLONE_INSTALL_COST, {
    description: `Ship jump clone installation at ${ship.itemID}`,
    entryTypeID:
      JOURNAL_ENTRY_TYPE.JUMP_CLONE_INSTALLATION || REF_JUMP_CLONE_INSTALLATION_FEE,
    ownerID1: targetCharID,
    ownerID2: offer.offeringCharID,
    referenceID: ship.itemID,
  });
  pendingShipCloneOffers.delete(targetCharID);
  const payload = [[offer.offeringCharID, offer.targetCharID, offer.shipID, 0]];
  emitSessionNotification(session, "OnShipJumpCloneInstallationDone", payload);
  const offeringSession = sessionRegistry.findSessionByCharacterID(offer.offeringCharID);
  emitSessionNotification(offeringSession, "OnShipJumpCloneInstallationDone", payload);
  emitCloneInvalidations(session, ship.itemID, targetCharID);
  return null;
}

function cancelShipCloneInstallation(session) {
  const charID = toPositiveInt(session && session.characterID, 0);
  const offer =
    pendingShipCloneOffers.get(charID) ||
    [...pendingShipCloneOffers.values()].find((candidate) => (
      candidate && candidate.offeringCharID === charID
    ));
  if (!offer) {
    return null;
  }
  pendingShipCloneOffers.delete(offer.targetCharID);
  const payload = [[offer.offeringCharID, offer.targetCharID, offer.shipID, 0]];
  emitSessionNotification(session, "OnShipJumpCloneInstallationCanceled", payload);
  const targetSession = sessionRegistry.findSessionByCharacterID(offer.targetCharID);
  emitSessionNotification(targetSession, "OnShipJumpCloneInstallationCanceled", payload);
  return null;
}

function clearActiveImplantsForPodDeath(session, options = {}) {
  const charID = toPositiveInt(
    options.characterID || (session && session.characterID),
    0,
  );
  if (!charID) {
    return {
      success: false,
      errorMsg: "CHARACTER_REQUIRED",
    };
  }
  let removedTypeIDs = [];
  const result = updateCharacterRecord(charID, (record) => {
    const activeImplants = normalizeActiveImplants(record);
    if (activeImplants.length === 0) {
      return record;
    }
    removedTypeIDs = activeImplants.map((implant) => implant.typeID);
    record.implants = [];
    appendCloneEvent(record, EVENT_CLONE_DESTROYED_WITH_LOCATION, {
      locationID: options.locationID || (session && session.solarsystemid2) || 0,
      typeIDs: removedTypeIDs,
    });
    appendCloneEvent(record, EVENT_CLONE_IMPLANT_REMOVAL, {
      typeIDs: removedTypeIDs,
    });
    return record;
  });
  if (!result.success) {
    return result;
  }
  if (removedTypeIDs.length > 0) {
    createJumpCloneDeletionNotification(
      charID,
      removedTypeIDs,
      options.destroyerID || charID,
    );
    emitCloneInvalidations(session, getCurrentDockedLocation(session).locationID, charID);
    log.info(
      `[JumpCloneRuntime] Cleared ${removedTypeIDs.length} active implants for pod death char=${charID}`,
    );
  }
  return {
    success: true,
    removedTypeIDs,
  };
}

module.exports = {
  ATTRIBUTE_MAX_JUMP_CLONES,
  ATTRIBUTE_CLONE_JUMP_COOLDOWN,
  buildCloneStatePayload,
  buildStationCloneStatePayload,
  buildShipCloneStatePayload,
  getPriceForClone() {
    return JUMP_CLONE_INSTALL_COST;
  },
  validateInstallJumpClone,
  installCloneAtCurrentLocation,
  setJumpCloneName,
  destroyInstalledClone,
  performCloneJump,
  resetLastCloneJumpTime,
  getNumClonesInPilotsStructure,
  offerShipCloneInstallation,
  acceptShipCloneInstallation,
  cancelShipCloneInstallation,
  clearActiveImplantsForPodDeath,
  getCharacterCloneLimit,
  getCharacterCloneJumpCooldownHours,
  _testing: {
    normalizeClone,
    normalizeJumpClones,
    normalizeActiveImplants,
    buildCloneRows,
    buildImplantRows,
    buildCloneJumpState,
    pendingShipCloneOffers,
  },
};
