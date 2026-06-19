const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const config = require(path.join(__dirname, "../../config"));
const log = require(path.join(__dirname, "../../utils/logger"));
const DogmaService = require(path.join(__dirname, "../dogma/dogmaService"));
const explorationAuthority = require(path.join(
  __dirname,
  "./explorationAuthority",
));
const {
  buildBoundObjectResponse,
  buildKeyVal,
  buildDict,
  buildPythonSet,
  currentFileTime,
  extractList,
  marshalObjectToObject,
  normalizeNumber,
  resolveBoundNodeId,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getAttributeIDByNames,
  getTypeAttributeValue,
  getTypeDogmaAttributes,
  getFittedModuleItems,
  getLoadedChargeByFlag,
  getFittedModuleByFlag,
  getModuleChargeCapacity,
  isModuleOnline,
  isChargeCompatibleWithModule,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  getCharacterSkillMap,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  ITEM_FLAGS,
  findItemById,
  grantItemToCharacterLocation,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const wormholeRuntime = require(path.join(__dirname, "./wormholes/wormholeRuntime"));
const signatureRuntime = require(path.join(__dirname, "./signatures/signatureRuntime"));
const probeScanRuntime = require(path.join(__dirname, "./probes/probeScanRuntime"));
const probeRuntimeState = require(path.join(__dirname, "./probes/probeRuntimeState"));
const probeSceneRuntime = require(path.join(__dirname, "./probes/probeSceneRuntime"));
const structureState = require(path.join(__dirname, "../structure/structureState"));

const SCAN_CONTRACTS = explorationAuthority.getScanContracts();
const SIGNATURE_TYPE_WORMHOLE =
  explorationAuthority.getSignatureTypeDefinition("wormhole") || {};
const ANOMALY_SCAN_GROUP =
  SCAN_CONTRACTS.probeScanGroups && SCAN_CONTRACTS.probeScanGroups.anomalies;
const AU_METERS = Number(SCAN_CONTRACTS.auMeters) || 149_597_870_700;
const DSCAN_MIN_RANGE_METERS = 10_000;
const DSCAN_FALLBACK_MAX_RANGE_METERS = 14.3 * AU_METERS;
const DSCAN_FULL_SWEEP_RADIANS = Math.PI * 2;
const DSCAN_COSMIC_SIGNATURE_GROUP_ID =
  Number(SIGNATURE_TYPE_WORMHOLE.inventoryGroupID) || 502;
const DSCAN_COSMIC_ANOMALY_GROUP_ID =
  Number(
    ANOMALY_SCAN_GROUP &&
      Array.isArray(ANOMALY_SCAN_GROUP.inventoryGroupIDs) &&
      ANOMALY_SCAN_GROUP.inventoryGroupIDs[0],
  ) || 885;
const GROUP_SCAN_PROBE_LAUNCHER = 481;
const GROUP_SCANNER_PROBE = 479;
const ATTRIBUTE_DSCAN_IMMUNE =
  getAttributeIDByNames("dscanImmune") || 1958;
const ATTRIBUTE_MAX_DIRECTIONAL_SCAN_RANGE =
  getAttributeIDByNames("maxDirectionalScanRange") || 5796;
const ATTRIBUTE_SCAN_DURATION =
  getAttributeIDByNames("scanDuration") || 73;
const ATTRIBUTE_SCAN_DURATION_ALTERNATE = 66;
const ATTRIBUTE_IMPLANT_SET_SISTERS = 1284;
const ATTRIBUTE_BASE_SCAN_RANGE =
  getAttributeIDByNames("baseScanRange") || 1372;
const ATTRIBUTE_RANGE_FACTOR =
  getAttributeIDByNames("rangeFactor") || 1371;
const SCAN_PROBE_NUMBER_OF_RANGE_STEPS =
  Math.max(1, Number(SCAN_CONTRACTS.rangeStepCount) || 8);
const DEFAULT_PROBE_MOVE_DURATION_MS = 1_250;
const SCANNING_SKILL_TYPE_IDS = Object.freeze([
  25739, // Astrometric Rangefinding
  25811, // Astrometric Acquisition
  25810, // Astrometric Pinpointing
  3412,  // Astrometrics
]);
const signalTrackerRegistrationsByCharacterID = new Map();
const anomalySnapshotBySystemID = new Map();
const signatureSnapshotBySystemID = new Map();
const staticSiteSnapshotBySystemID = new Map();
const structureSnapshotBySystemID = new Map();
let wormholeSignatureListenerRegistered = false;
let structureOverlayListenerRegistered = false;
let dogmaNotificationHelper = null;
let characterStateHelper = null;

function getDogmaNotificationHelper() {
  if (!dogmaNotificationHelper) {
    dogmaNotificationHelper = new DogmaService();
  }
  return dogmaNotificationHelper;
}

function getCharacterStateHelper() {
  if (!characterStateHelper) {
    characterStateHelper = require(path.join(__dirname, "../character/characterState"));
  }
  return characterStateHelper;
}

function getSpaceRuntime() {
  return require(path.join(__dirname, "../../space/runtime"));
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(vector = null) {
  return {
    x: toFiniteNumber(vector && vector.x, 0),
    y: toFiniteNumber(vector && vector.y, 0),
    z: toFiniteNumber(vector && vector.z, 0),
  };
}

function subtractVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0),
  };
}

function magnitude(vector) {
  return Math.sqrt(
    (toFiniteNumber(vector && vector.x, 0) ** 2) +
    (toFiniteNumber(vector && vector.y, 0) ** 2) +
    (toFiniteNumber(vector && vector.z, 0) ** 2)
  );
}

function normalizeVector(vector) {
  const length = magnitude(vector);
  if (!Number.isFinite(length) || length <= 0) {
    return null;
  }
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function dotProduct(left, right) {
  return (
    (toFiniteNumber(left && left.x, 0) * toFiniteNumber(right && right.x, 0)) +
    (toFiniteNumber(left && left.y, 0) * toFiniteNumber(right && right.y, 0)) +
    (toFiniteNumber(left && left.z, 0) * toFiniteNumber(right && right.z, 0))
  );
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function extractProbeIDsFromValue(value) {
  const unwrapped = unwrapMarshalValue(value);
  if (Array.isArray(unwrapped)) {
    return unwrapped.flatMap((entry) => extractProbeIDsFromValue(entry));
  }

  if (unwrapped && typeof unwrapped === "object") {
    return Object.values(unwrapped)
      .flatMap((entry) => extractProbeIDsFromValue(entry));
  }

  const numericProbeID = normalizeNumber(unwrapped, 0);
  return numericProbeID > 0 ? [numericProbeID] : [];
}

function extractProbeIDList(args) {
  const rawArgs = Array.isArray(args) ? args : [args];
  const candidateValues = rawArgs.flatMap((entry) => {
    const extracted = extractList(entry);
    return extracted.length > 0 ? extracted : [entry];
  });
  return [...new Set(
    candidateValues
      .flatMap((entry) => extractProbeIDsFromValue(entry))
      .map((probeID) => normalizeNumber(probeID, 0))
      .filter((probeID) => probeID > 0),
  )];
}

function collectSceneEntities(scene) {
  if (!scene) {
    return [];
  }

  const dynamicEntities =
    scene.dynamicEntities instanceof Map
      ? [...scene.dynamicEntities.values()]
      : Array.isArray(scene.dynamicEntities)
        ? scene.dynamicEntities
        : [];
  const staticEntities = Array.isArray(scene.staticEntities)
    ? scene.staticEntities
    : [];
  return [...staticEntities, ...dynamicEntities];
}

function resolveEntityRangeCapMeters(entity) {
  const explicitRange = Math.max(
    0,
    toFiniteNumber(entity && entity.maxDirectionalScanRange, 0),
  );
  if (explicitRange > 0) {
    return explicitRange;
  }

  const typedRange = Math.max(
    0,
    toFiniteNumber(
      getTypeAttributeValue(
        entity && entity.typeID,
        "maxDirectionalScanRange",
      ),
      toFiniteNumber(
        getTypeAttributeValueByID(
          entity && entity.typeID,
          ATTRIBUTE_MAX_DIRECTIONAL_SCAN_RANGE,
        ),
        0,
      ),
    ),
  );
  return typedRange > 0 ? typedRange : DSCAN_FALLBACK_MAX_RANGE_METERS;
}

function getTypeAttributeValueByID(typeID, attributeID) {
  const numericAttributeID = normalizeNumber(attributeID, 0);
  if (numericAttributeID <= 0) {
    return null;
  }

  const attributes = getTypeDogmaAttributes(typeID);
  const numericValue = Number(attributes[String(numericAttributeID)]);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function isEntityDirectionalScanImmune(entity) {
  const attributeValue = toFiniteNumber(
    getTypeAttributeValue(entity && entity.typeID, "dscanImmune"),
    toFiniteNumber(
      getTypeAttributeValueByID(entity && entity.typeID, ATTRIBUTE_DSCAN_IMMUNE),
      0,
    ),
  );
  return attributeValue > 0;
}

function isEntityDirectionalScanCandidate(entity, egoEntity) {
  const itemID = normalizeNumber(entity && entity.itemID, 0);
  if (itemID <= 0 || itemID === normalizeNumber(egoEntity && egoEntity.itemID, 0)) {
    return false;
  }

  const typeID = normalizeNumber(entity && entity.typeID, 0);
  const groupID = normalizeNumber(entity && entity.groupID, 0);
  if (typeID <= 0 || groupID <= 0) {
    return false;
  }

  if (
    groupID === DSCAN_COSMIC_SIGNATURE_GROUP_ID ||
    groupID === DSCAN_COSMIC_ANOMALY_GROUP_ID
  ) {
    return false;
  }

  if (String(entity && entity.kind || "").trim().toLowerCase() === "missile") {
    return false;
  }

  if (
    String(entity && entity.mode || "").trim().toUpperCase() === "WARP" ||
    entity.pendingWarp ||
    entity.warpState
  ) {
    return false;
  }

  if (isEntityDirectionalScanImmune(entity)) {
    return false;
  }

  return true;
}

function buildDirectionalScanResult(entity) {
  return buildKeyVal([
    ["id", normalizeNumber(entity && entity.itemID, 0)],
    ["typeID", normalizeNumber(entity && entity.typeID, 0)],
    ["groupID", normalizeNumber(entity && entity.groupID, 0)],
  ]);
}

function buildSignatureEntryMap(systemID, options = {}) {
  return new Map(
    signatureRuntime.buildSignalTrackerSignatureEntries(systemID, options)
      .map(([siteID, siteInfo]) => [normalizeNumber(siteID, 0), siteInfo])
      .filter(([siteID]) => siteID > 0),
  );
}

function buildAnomalyEntryMap(systemID, options = {}) {
  return new Map(
    signatureRuntime.buildSignalTrackerAnomalyEntries(systemID, options)
      .map(([siteID, siteInfo]) => [normalizeNumber(siteID, 0), siteInfo])
      .filter(([siteID]) => siteID > 0),
  );
}

function ensureAnomalySnapshot(systemID, options = {}) {
  const numericSystemID = normalizeNumber(systemID, 0);
  if (numericSystemID <= 0) {
    return new Map();
  }
  const snapshot = buildAnomalyEntryMap(numericSystemID, options);
  anomalySnapshotBySystemID.set(numericSystemID, snapshot);
  return snapshot;
}

function ensureSignatureSnapshot(systemID, options = {}) {
  const numericSystemID = normalizeNumber(systemID, 0);
  if (numericSystemID <= 0) {
    return new Map();
  }
  const snapshot = buildSignatureEntryMap(numericSystemID, options);
  signatureSnapshotBySystemID.set(numericSystemID, snapshot);
  return snapshot;
}

function buildStructureEntryMap(systemID, options = {}) {
  return new Map(
    signatureRuntime.buildSignalTrackerStructureEntries(systemID, options)
      .map(([siteID, siteInfo]) => [normalizeNumber(siteID, 0), siteInfo])
      .filter(([siteID]) => siteID > 0),
  );
}

function buildStaticSiteEntryMap(systemID, options = {}) {
  return new Map(
    signatureRuntime.buildSignalTrackerStaticSiteEntries(systemID, options)
      .map(([siteID, siteInfo]) => [normalizeNumber(siteID, 0), siteInfo])
      .filter(([siteID]) => siteID > 0),
  );
}

function ensureStructureSnapshot(systemID, options = {}) {
  const numericSystemID = normalizeNumber(systemID, 0);
  if (numericSystemID <= 0) {
    return new Map();
  }
  const snapshot = buildStructureEntryMap(numericSystemID, options);
  structureSnapshotBySystemID.set(numericSystemID, snapshot);
  return snapshot;
}

function ensureStaticSiteSnapshot(systemID, options = {}) {
  const numericSystemID = normalizeNumber(systemID, 0);
  if (numericSystemID <= 0) {
    return new Map();
  }
  const snapshot = buildStaticSiteEntryMap(numericSystemID, options);
  staticSiteSnapshotBySystemID.set(numericSystemID, snapshot);
  return snapshot;
}

function refreshSignalTrackerSnapshots(systemID, options = {}) {
  const numericSystemID = normalizeNumber(systemID, 0);
  if (numericSystemID <= 0) {
    return null;
  }
  return {
    anomalies: ensureAnomalySnapshot(numericSystemID, options),
    signatures: ensureSignatureSnapshot(numericSystemID, options),
    staticSites: ensureStaticSiteSnapshot(numericSystemID, options),
    structures: ensureStructureSnapshot(numericSystemID, options),
  };
}

function getRegisteredSessionsForSystem(systemID) {
  const numericSystemID = normalizeNumber(systemID, 0);
  if (numericSystemID <= 0) {
    return [];
  }
  return [...signalTrackerRegistrationsByCharacterID.values()]
    .filter((entry) => normalizeNumber(entry && entry.systemID, 0) === numericSystemID)
    .map((entry) => entry && entry.session)
    .filter((session) => session && typeof session.sendNotification === "function");
}

function notifySignatureDeltaForSystem(systemID, options = {}) {
  const numericSystemID = normalizeNumber(systemID, 0);
  if (numericSystemID <= 0) {
    return;
  }

  const sessions = getRegisteredSessionsForSystem(numericSystemID);
  if (sessions.length <= 0) {
    ensureSignatureSnapshot(numericSystemID, options);
    return;
  }

  const previousEntries = signatureSnapshotBySystemID.get(numericSystemID) || new Map();
  const currentEntries = buildSignatureEntryMap(numericSystemID, options);
  signatureSnapshotBySystemID.set(numericSystemID, currentEntries);

  const addedEntries = [];
  const removedSiteIDs = new Set();
  for (const [siteID, siteInfo] of currentEntries.entries()) {
    const previousInfo = previousEntries.get(siteID);
    if (!previousInfo) {
      addedEntries.push([siteID, siteInfo]);
      continue;
    }
    if (!areTrackerEntriesEqual(previousInfo, siteInfo)) {
      removedSiteIDs.add(siteID);
      addedEntries.push([siteID, siteInfo]);
    }
  }
  for (const siteID of previousEntries.keys()) {
    if (!currentEntries.has(siteID)) {
      removedSiteIDs.add(siteID);
    }
  }

  if (addedEntries.length <= 0 && removedSiteIDs.size <= 0) {
    return;
  }

  const payload = [
    numericSystemID,
    buildDict(addedEntries),
    buildPythonSet([...removedSiteIDs]),
  ];
  for (const session of sessions) {
    session.sendNotification(
      "OnSignalTrackerSignatureUpdate",
      "solarsystemid2",
      payload,
    );
  }
}

function notifyAnomalyDeltaForSystem(systemID, options = {}) {
  const numericSystemID = normalizeNumber(systemID, 0);
  if (numericSystemID <= 0) {
    return;
  }

  const sessions = getRegisteredSessionsForSystem(numericSystemID);
  if (sessions.length <= 0) {
    ensureAnomalySnapshot(numericSystemID, options);
    return;
  }

  const previousEntries = anomalySnapshotBySystemID.get(numericSystemID) || new Map();
  const currentEntries = buildAnomalyEntryMap(numericSystemID, options);
  anomalySnapshotBySystemID.set(numericSystemID, currentEntries);

  const addedEntries = [];
  const removedSiteIDs = new Set();
  for (const [siteID, siteInfo] of currentEntries.entries()) {
    const previousInfo = previousEntries.get(siteID);
    if (!previousInfo) {
      addedEntries.push([siteID, siteInfo]);
      continue;
    }
    if (!areTrackerEntriesEqual(previousInfo, siteInfo)) {
      removedSiteIDs.add(siteID);
      addedEntries.push([siteID, siteInfo]);
    }
  }
  for (const siteID of previousEntries.keys()) {
    if (!currentEntries.has(siteID)) {
      removedSiteIDs.add(siteID);
    }
  }

  if (addedEntries.length <= 0 && removedSiteIDs.size <= 0) {
    return;
  }

  const payload = [
    numericSystemID,
    buildDict(addedEntries),
    buildPythonSet([...removedSiteIDs]),
  ];
  for (const session of sessions) {
    session.sendNotification(
      "OnSignalTrackerAnomalyUpdate",
      "solarsystemid2",
      payload,
    );
  }
}

function areTrackerEntriesEqual(left, right) {
  if (left === right) {
    return true;
  }
  return JSON.stringify(marshalObjectToObject(left)) === JSON.stringify(marshalObjectToObject(right));
}

function notifyStructureDeltaForSystem(systemID, options = {}) {
  const numericSystemID = normalizeNumber(systemID, 0);
  if (numericSystemID <= 0) {
    return;
  }

  const sessions = getRegisteredSessionsForSystem(numericSystemID);
  if (sessions.length <= 0) {
    ensureStructureSnapshot(numericSystemID, options);
    return;
  }

  const previousEntries = structureSnapshotBySystemID.get(numericSystemID) || new Map();
  const currentEntries = buildStructureEntryMap(numericSystemID, options);
  structureSnapshotBySystemID.set(numericSystemID, currentEntries);

  const addedEntries = [];
  const removedSiteIDs = new Set();
  for (const [siteID, siteInfo] of currentEntries.entries()) {
    const previousInfo = previousEntries.get(siteID);
    if (!previousInfo) {
      addedEntries.push([siteID, siteInfo]);
      continue;
    }
    if (!areTrackerEntriesEqual(previousInfo, siteInfo)) {
      removedSiteIDs.add(siteID);
      addedEntries.push([siteID, siteInfo]);
    }
  }
  for (const siteID of previousEntries.keys()) {
    if (!currentEntries.has(siteID)) {
      removedSiteIDs.add(siteID);
    }
  }

  if (addedEntries.length <= 0 && removedSiteIDs.size <= 0) {
    return;
  }

  const payload = [
    numericSystemID,
    buildDict(addedEntries),
    buildPythonSet([...removedSiteIDs]),
  ];
  for (const session of sessions) {
    session.sendNotification(
      "OnSignalTrackerStructureUpdate",
      "solarsystemid2",
      payload,
    );
  }
}

function notifyFullStateRefreshForSystem(systemID, options = {}) {
  const numericSystemID = normalizeNumber(systemID, 0);
  if (numericSystemID <= 0) {
    return {
      success: false,
      errorMsg: "SYSTEM_NOT_FOUND",
    };
  }

  const fullState = signatureRuntime.buildSignalTrackerFullState(
    numericSystemID,
    options,
  );
  refreshSignalTrackerSnapshots(numericSystemID, options);
  const sessions = getRegisteredSessionsForSystem(numericSystemID);
  if (sessions.length <= 0) {
    return {
      success: true,
      data: {
        systemID: numericSystemID,
        sessionCount: 0,
      },
    };
  }

  const shouldRemoveOldSites = options.shouldRemoveOldSites === true;
  const payload = [
    numericSystemID,
    fullState,
    shouldRemoveOldSites,
  ];
  for (const session of sessions) {
    session.sendNotification(
      "OnSignalTrackerFullState",
      "solarsystemid2",
      payload,
    );
  }

  return {
    success: true,
    data: {
      systemID: numericSystemID,
      sessionCount: sessions.length,
    },
  };
}

function scheduleNotification(session, name, payload = []) {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  setImmediate(() => {
    session.sendNotification(name, "clientID", payload);
  });
}

function scheduleProbeRemovalNotifications(session, probeIDs = []) {
  probeSceneRuntime.removeProbeEntitiesForSession(session, probeIDs);
  for (const probeID of Array.isArray(probeIDs) ? probeIDs : [probeIDs]) {
    const numericProbeID = normalizeNumber(probeID, 0);
    if (numericProbeID <= 0) {
      continue;
    }
    scheduleNotification(session, "OnRemoveProbe", [numericProbeID]);
  }
}

function scheduleProbeReplayNotifications(session, probes = []) {
  const normalizedProbes = (Array.isArray(probes) ? probes : [])
    .filter((probe) => normalizeNumber(probe && probe.probeID, 0) > 0);
  if (normalizedProbes.length <= 0) {
    return;
  }

  probeSceneRuntime.ensureProbeEntitiesForSession(session, normalizedProbes);
  setImmediate(() => {
    for (const probe of normalizedProbes) {
      session.sendNotification("OnNewProbe", "clientID", [
        probeScanRuntime.buildProbeKeyVal(probe),
      ]);
    }
    session.sendNotification("OnProbesIdle", "clientID", [
      normalizedProbes.map((probe) => probeScanRuntime.buildProbeKeyVal(probe)),
    ]);
  });
}

function restoreRecoveredProbeCharges(session, characterID, removedProbes = [], options = {}) {
  const numericCharacterID = normalizeNumber(characterID, 0);
  const fallbackShipID = normalizeNumber(options.shipID, 0);
  if (numericCharacterID <= 0 || !Array.isArray(removedProbes) || removedProbes.length <= 0) {
    return 0;
  }

  const groupedRestores = new Map();
  for (const probe of removedProbes) {
    const typeID = normalizeNumber(probe && probe.typeID, 0);
    const persistedShipID = normalizeNumber(probe && probe.launchShipID, 0);
    const launcherFlagID = normalizeNumber(probe && probe.launcherFlagID, 0);
    const launcherItemID = normalizeNumber(probe && probe.launcherItemID, 0);
    const shipID =
      (persistedShipID > 0 && findItemById(persistedShipID))
        ? persistedShipID
        : fallbackShipID;
    if (typeID <= 0 || shipID <= 0) {
      continue;
    }

    const key = `${shipID}:${launcherFlagID}:${typeID}`;
    if (!groupedRestores.has(key)) {
      groupedRestores.set(key, {
        shipID,
        launcherFlagID,
        launcherItemID,
        typeID,
        quantity: 0,
      });
    }
    groupedRestores.get(key).quantity += 1;
  }

  let restoredCharges = 0;
  const dogmaHelper = getDogmaNotificationHelper();
  for (const entry of groupedRestores.values()) {
    if (entry.quantity <= 0) {
      continue;
    }

    const moduleItem = entry.launcherFlagID > 0
      ? getFittedModuleByFlag(numericCharacterID, entry.shipID, entry.launcherFlagID)
      : null;
    const canRestoreToLauncher =
      moduleItem &&
      normalizeNumber(moduleItem.itemID, 0) > 0 &&
      isChargeCompatibleWithModule(moduleItem.typeID, entry.typeID);
    const moduleCapacity = canRestoreToLauncher
      ? Math.max(0, normalizeNumber(
          getModuleChargeCapacity(moduleItem.typeID, entry.typeID),
          0,
        ))
      : 0;
    const currentLoadedCharge = canRestoreToLauncher
      ? getLoadedChargeByFlag(numericCharacterID, entry.shipID, entry.launcherFlagID)
      : null;
    const currentLoadedQuantity = Math.max(
      0,
      normalizeNumber(
        currentLoadedCharge &&
          (currentLoadedCharge.stacksize ?? currentLoadedCharge.quantity),
        0,
      ),
    );
    const launcherFreeSpace = canRestoreToLauncher
      ? Math.max(0, moduleCapacity - currentLoadedQuantity)
      : 0;
    const launcherQuantity = Math.min(entry.quantity, launcherFreeSpace);
    const cargoQuantity = Math.max(0, entry.quantity - launcherQuantity);
    const previousChargeState = launcherQuantity > 0
      ? dogmaHelper._captureChargeStateSnapshot(
          numericCharacterID,
          entry.shipID,
          entry.launcherFlagID,
        )
      : null;
    const previousChargeItem = launcherQuantity > 0
      ? dogmaHelper._captureChargeItemSnapshot(
          numericCharacterID,
          entry.shipID,
          entry.launcherFlagID,
        )
      : null;
    const itemType = resolveItemByTypeID(entry.typeID) || entry.typeID;
    const restoreTargets = [];
    if (launcherQuantity > 0) {
      restoreTargets.push({
        quantity: launcherQuantity,
        flagID: entry.launcherFlagID,
      });
    }
    if (cargoQuantity > 0) {
      restoreTargets.push({
        quantity: cargoQuantity,
        flagID: ITEM_FLAGS.CARGO_HOLD,
      });
    }

    let restoreFailed = false;
    for (const target of restoreTargets) {
      if (target.quantity <= 0) {
        continue;
      }
      const grantResult = grantItemToCharacterLocation(
        numericCharacterID,
        entry.shipID,
        target.flagID,
        itemType,
        target.quantity,
        { singleton: 0 },
      );
      if (!grantResult || grantResult.success !== true) {
        log.warn(
          `[ScanMgr] Failed to restore ${target.quantity} recovered probe charge(s) ` +
          `typeID=${entry.typeID} shipID=${entry.shipID} flagID=${target.flagID}: ` +
          `${grantResult && grantResult.errorMsg ? grantResult.errorMsg : "WRITE_ERROR"}`,
        );
        restoreFailed = true;
        break;
      }
      dogmaHelper._syncInventoryChanges(
        session,
        (grantResult.data && grantResult.data.changes) || [],
      );
      restoredCharges += target.quantity;
    }
    if (restoreFailed) {
      continue;
    }

    if (launcherQuantity > 0) {
      const nextChargeState = dogmaHelper._captureChargeStateSnapshot(
        numericCharacterID,
        entry.shipID,
        entry.launcherFlagID,
      );
      dogmaHelper._notifyChargeQuantityTransition(
        session,
        numericCharacterID,
        entry.shipID,
        entry.launcherFlagID,
        previousChargeState,
        nextChargeState,
      );
      dogmaHelper._notifyWeaponModuleAttributeTransition(
        session,
        moduleItem,
        previousChargeItem,
        dogmaHelper._captureChargeItemSnapshot(
          numericCharacterID,
          entry.shipID,
          entry.launcherFlagID,
        ),
      );
    }
  }

  return restoredCharges;
}

function handleWormholeSignatureStateChange(systemIDs = []) {
  for (const systemID of Array.isArray(systemIDs) ? systemIDs : [systemIDs]) {
    notifySignatureDeltaForSystem(systemID);
  }
}

function emitProbeScanLifecycleNotifications(session, scanResult, options = {}) {
  if (!session || typeof session.sendNotification !== "function" || !scanResult) {
    return;
  }

  const durationMs = Math.max(
    1,
    normalizeNumber(
      options.durationMs,
      normalizeNumber(scanResult.durationMs, probeScanRuntime.DEFAULT_PROBE_SCAN_DURATION_MS),
    ),
  );
  const startTime = options.startedAtFileTime || currentFileTime();
  session.sendNotification("OnSystemScanStarted", "solarsystemid2", [
    startTime,
    durationMs,
    probeScanRuntime.buildProbeDict(scanResult.probes instanceof Map ? scanResult.probes : new Map()),
  ]);
  scheduleProbeScanStopNotification(session, scanResult, {
    durationMs,
    immediateStop: options.immediateStop === true,
    scheduleFn: options.scheduleFn,
    clearFn: options.clearFn,
  });
}

function emitProbeScanStoppedNotification(session, scanResult) {
  if (!session || typeof session.sendNotification !== "function" || !scanResult) {
    return;
  }

  session.sendNotification("OnSystemScanStopped", "solarsystemid2", [
    Array.isArray(scanResult.probeIDs) ? scanResult.probeIDs : [],
    Array.isArray(scanResult.results) ? scanResult.results : [],
    Array.isArray(scanResult.absentTargets) ? scanResult.absentTargets : [],
  ]);
}

function clearPendingProbeScanStop(session) {
  if (!session || !session._pendingProbeScanStop) {
    return;
  }

  const pending = session._pendingProbeScanStop;
  session._pendingProbeScanStop = null;
  if (typeof pending.clearFn === "function" && pending.handle !== undefined) {
    pending.clearFn(pending.handle);
  }
}

function clearPendingProbeMovement(session) {
  if (!session || !session._pendingProbeMovement) {
    return;
  }

  const pending = session._pendingProbeMovement;
  session._pendingProbeMovement = null;
  if (typeof pending.clearFn === "function" && pending.handle !== undefined) {
    pending.clearFn(pending.handle);
  }
}

function scheduleProbeScanStopNotification(session, scanResult, options = {}) {
  if (!session || typeof session.sendNotification !== "function" || !scanResult) {
    return;
  }

  const durationMs = Math.max(
    1,
    normalizeNumber(
      options.durationMs,
      normalizeNumber(scanResult.durationMs, probeScanRuntime.DEFAULT_PROBE_SCAN_DURATION_MS),
    ),
  );
  if (options.immediateStop === true) {
    clearPendingProbeScanStop(session);
    emitProbeScanStoppedNotification(session, scanResult);
    return;
  }

  const scheduleFn = typeof options.scheduleFn === "function"
    ? options.scheduleFn
    : setTimeout;
  const clearFn = typeof options.clearFn === "function"
    ? options.clearFn
    : clearTimeout;
  clearPendingProbeScanStop(session);
  const token = Symbol("probeScanStop");
  const handle = scheduleFn(() => {
    if (!session || !session._pendingProbeScanStop) {
      return;
    }
    if (session._pendingProbeScanStop.token !== token) {
      return;
    }
    session._pendingProbeScanStop = null;
    emitProbeScanStoppedNotification(session, scanResult);
  }, durationMs);
  session._pendingProbeScanStop = {
    token,
    handle,
    clearFn,
  };
}

function areProbePositionsEqual(left, right) {
  const leftPosition = Array.isArray(left) ? left : [0, 0, 0];
  const rightPosition = Array.isArray(right) ? right : [0, 0, 0];
  return (
    Math.abs(toFiniteNumber(leftPosition[0], 0) - toFiniteNumber(rightPosition[0], 0)) < 0.001 &&
    Math.abs(toFiniteNumber(leftPosition[1], 0) - toFiniteNumber(rightPosition[1], 0)) < 0.001 &&
    Math.abs(toFiniteNumber(leftPosition[2], 0) - toFiniteNumber(rightPosition[2], 0)) < 0.001
  );
}

function scheduleProbeMovementThenScan(session, probes = [], scanStarter, options = {}) {
  const movingProbes = (Array.isArray(probes) ? probes : [])
    .filter((probe) => normalizeNumber(probe && probe.probeID, 0) > 0)
    .filter((probe) => !areProbePositionsEqual(probe && probe.pos, probe && probe.destination));
  if (movingProbes.length <= 0) {
    if (typeof scanStarter === "function") {
      scanStarter();
    }
    return;
  }

  const durationMs = Math.max(
    1,
    normalizeNumber(options.moveDurationMs, DEFAULT_PROBE_MOVE_DURATION_MS),
  );
  const scheduleFn = typeof options.scheduleFn === "function"
    ? options.scheduleFn
    : setTimeout;
  const clearFn = typeof options.clearFn === "function"
    ? options.clearFn
    : clearTimeout;
  const startTime = currentFileTime();

  clearPendingProbeMovement(session);
  for (const probe of movingProbes) {
    session.sendNotification("OnProbeWarpStart", "clientID", [
      normalizeNumber(probe && probe.probeID, 0),
      Array.isArray(probe && probe.pos) ? probe.pos : [0, 0, 0],
      Array.isArray(probe && probe.destination) ? probe.destination : [0, 0, 0],
      startTime,
      durationMs,
    ]);
  }

  const token = Symbol("probeMovement");
  const handle = scheduleFn(() => {
    if (!session || !session._pendingProbeMovement || session._pendingProbeMovement.token !== token) {
      return;
    }
    session._pendingProbeMovement = null;
    if (typeof options.onArrive === "function") {
      options.onArrive();
    }
    for (const probe of movingProbes) {
      session.sendNotification("OnProbeWarpEnd", "clientID", [
        normalizeNumber(probe && probe.probeID, 0),
      ]);
    }
    if (typeof scanStarter === "function") {
      scanStarter();
    }
  }, durationMs);
  session._pendingProbeMovement = {
    token,
    handle,
    clearFn,
  };
}

function getSessionShipID(session) {
  return normalizeNumber(
    session && (
      session.shipID ||
      session.shipid ||
      session.activeShipID ||
      (session._space && session._space.shipID)
    ),
    0,
  );
}

function resolveActiveProbeLauncherForSession(session) {
  const charID = normalizeNumber(
    session && (session.characterID || session.charid || session.userid),
    0,
  );
  const shipID = getSessionShipID(session);
  if (charID <= 0 || shipID <= 0) {
    return null;
  }

  const onlineLaunchers = getFittedModuleItems(charID, shipID)
    .filter((item) => normalizeNumber(item && item.groupID, 0) === GROUP_SCAN_PROBE_LAUNCHER)
    .filter((item) => isModuleOnline(item));
  if (onlineLaunchers.length <= 0) {
    return null;
  }

  const loadedLauncher = onlineLaunchers.find((moduleItem) => {
    const loadedCharge = getLoadedChargeByFlag(charID, shipID, moduleItem.flagID);
    return normalizeNumber(loadedCharge && loadedCharge.groupID, 0) === GROUP_SCANNER_PROBE;
  });
  return loadedLauncher || onlineLaunchers[0] || null;
}

function resolveCharacterScanDurationBonusMultiplier(characterID) {
  const numericCharacterID = normalizeNumber(characterID, 0);
  if (numericCharacterID <= 0) {
    return 1;
  }

  let multiplier = 1;
  const skillMap = getCharacterSkillMap(numericCharacterID, {
    includeExpertSystems: false,
  });
  for (const skillTypeID of SCANNING_SKILL_TYPE_IDS) {
    const skillRecord = skillMap.get(skillTypeID) || null;
    const skillLevel = normalizeNumber(
      skillRecord && (
        skillRecord.effectiveSkillLevel ??
        skillRecord.trainedSkillLevel ??
        skillRecord.skillLevel
      ),
      0,
    );
    if (skillLevel <= 0) {
      continue;
    }
    const attributes = getTypeDogmaAttributes(skillTypeID);
    const perLevelBonus = Number(attributes[String(ATTRIBUTE_SCAN_DURATION_ALTERNATE)]);
    if (!Number.isFinite(perLevelBonus) || perLevelBonus === 0) {
      continue;
    }
    multiplier *= (1 + ((skillLevel * perLevelBonus) / 100));
  }

  const characterRecord = getCharacterStateHelper().getCharacterRecord(numericCharacterID);
  const implants = Array.isArray(characterRecord && characterRecord.implants)
    ? characterRecord.implants
    : [];
  let implantMultiplier = 1;
  const sistersSetBonuses = [];
  for (const implant of implants) {
    const implantTypeID = normalizeNumber(implant && implant.typeID, 0);
    if (implantTypeID <= 0) {
      continue;
    }
    const attributes = getTypeDogmaAttributes(implantTypeID);
    const bonus = Number(attributes[String(ATTRIBUTE_SCAN_DURATION_ALTERNATE)]);
    if (Number.isFinite(bonus) && bonus !== 0) {
      implantMultiplier *= (1 + (bonus / 100));
    }
    const setBonus = Number(attributes[String(ATTRIBUTE_IMPLANT_SET_SISTERS)]);
    if (Number.isFinite(setBonus) && setBonus > 0) {
      sistersSetBonuses.push(setBonus);
    }
  }
  if (sistersSetBonuses.length > 1) {
    implantMultiplier *= sistersSetBonuses.reduce((product, bonus) => product * bonus, 1);
  }

  return multiplier * implantMultiplier;
}

function resolveProbeScanDurationMs(session, options = {}) {
  const explicitDurationMs = normalizeNumber(options.durationMs, 0);
  if (explicitDurationMs > 0) {
    return Math.max(1, Math.round(explicitDurationMs));
  }

  const probeLauncher = resolveActiveProbeLauncherForSession(session);
  const baseDurationMs = Math.max(
    1,
    normalizeNumber(
      getTypeAttributeValueByID(probeLauncher && probeLauncher.typeID, ATTRIBUTE_SCAN_DURATION),
      probeScanRuntime.DEFAULT_PROBE_SCAN_DURATION_MS,
    ),
  );
  const durationMultiplier = resolveCharacterScanDurationBonusMultiplier(
    session && (session.characterID || session.charid || session.userid),
  );
  const resolvedDurationMs = baseDurationMs * (
    Number.isFinite(durationMultiplier) && durationMultiplier > 0
      ? durationMultiplier
      : 1
  );
  return Math.max(1, Math.round(resolvedDurationMs));
}

function resolveProbeRangeStepsByTypeID(typeID) {
  const numericTypeID = normalizeNumber(typeID, 0);
  if (numericTypeID <= 0) {
    return [];
  }

  const baseScanRange = toFiniteNumber(
    getTypeAttributeValueByID(numericTypeID, ATTRIBUTE_BASE_SCAN_RANGE),
    toFiniteNumber(getTypeAttributeValue(numericTypeID, "baseScanRange"), 0),
  );
  const rangeFactor = toFiniteNumber(
    getTypeAttributeValueByID(numericTypeID, ATTRIBUTE_RANGE_FACTOR),
    toFiniteNumber(getTypeAttributeValue(numericTypeID, "rangeFactor"), 0),
  );
  if (baseScanRange <= 0 || rangeFactor <= 0) {
    return [];
  }

  const steps = [];
  for (let index = 0; index < SCAN_PROBE_NUMBER_OF_RANGE_STEPS; index += 1) {
    steps.push(baseScanRange * (rangeFactor ** index) * AU_METERS);
  }
  return steps;
}

function ensureWormholeSignatureListenerRegistered() {
  if (wormholeSignatureListenerRegistered) {
    return;
  }
  wormholeRuntime.registerSignatureStateChangeListener(handleWormholeSignatureStateChange);
  wormholeSignatureListenerRegistered = true;
}

function handleStructureOverlayStateChange(change = {}) {
  const systemIDs = new Set();
  for (const systemID of Array.isArray(change && change.systemIDs) ? change.systemIDs : []) {
    const numericSystemID = normalizeNumber(systemID, 0);
    if (numericSystemID > 0) {
      systemIDs.add(numericSystemID);
    }
  }
  for (const systemID of systemIDs) {
    notifyStructureDeltaForSystem(systemID, { refresh: false });
  }
}

function ensureStructureOverlayListenerRegistered() {
  if (structureOverlayListenerRegistered) {
    return;
  }
  if (
    structureState &&
    typeof structureState.registerStructureChangeListener === "function"
  ) {
    structureState.registerStructureChangeListener(handleStructureOverlayStateChange);
  }
  structureOverlayListenerRegistered = true;
}

function getKwargValue(kwargs, key) {
  if (!kwargs) {
    return undefined;
  }

  if (kwargs.type === "dict" && Array.isArray(kwargs.entries)) {
    const match = kwargs.entries.find(([entryKey]) => String(entryKey) === String(key));
    return match ? match[1] : undefined;
  }

  if (typeof kwargs === "object" && Object.prototype.hasOwnProperty.call(kwargs, key)) {
    return kwargs[key];
  }

  return undefined;
}

function buildBoundObjectSubstruct(serviceName, session) {
  const normalizedServiceName = String(serviceName || "").trim() || "scanMgr";
  if (!session._boundObjectIDs || typeof session._boundObjectIDs !== "object") {
    session._boundObjectIDs = {};
  }
  if (!session._boundObjectState || typeof session._boundObjectState !== "object") {
    session._boundObjectState = {};
  }

  const existingObjectState = session._boundObjectState[normalizedServiceName] || null;
  const objectID =
    existingObjectState && typeof existingObjectState.objectID === "string"
      ? existingObjectState.objectID
      : `N=${config.proxyNodeId}:${config.getNextBoundId()}`;
  const boundAtFileTime =
    existingObjectState && existingObjectState.boundAtFileTime
      ? existingObjectState.boundAtFileTime
      : currentFileTime();

  session._boundObjectIDs[normalizedServiceName] = objectID;
  session._boundObjectState[normalizedServiceName] = {
    objectID,
    boundAtFileTime,
  };
  session.lastBoundObjectID = objectID;

  return {
    type: "substruct",
    value: {
      type: "substream",
      value: [objectID, boundAtFileTime],
    },
  };
}

class ScanMgrService extends BaseService {
  constructor() {
    super("scanMgr");
    this.reuseBoundObjectForSession = true;
    ensureWormholeSignatureListenerRegistered();
    ensureStructureOverlayListenerRegistered();
  }

  _getCharacterID(session) {
    return normalizeNumber(
      session && (session.characterID || session.charid || session.userid),
      0,
    );
  }

  _getSystemID(session) {
    return normalizeNumber(
      session &&
        (
          (session._space && session._space.systemID) ||
          session.solarsystemid2 ||
          session.solarsystemid
        ),
      0,
    );
  }

  _ensureSystemParity(session, nowMs = Date.now()) {
    const systemID = this._getSystemID(session);
    if (systemID <= 0 || config.wormholesEnabled !== true) {
      return systemID;
    }

    wormholeRuntime.ensureSystemStatics(systemID, nowMs);
    return systemID;
  }

  _buildFullState(session, options = {}) {
    const systemID = this._ensureSystemParity(
      session,
      normalizeNumber(options.nowMs, Date.now()),
    );
    if (systemID <= 0) {
      return [buildDict([]), buildDict([]), buildDict([]), buildDict([])];
    }

    return signatureRuntime.buildSignalTrackerFullState(systemID, options);
  }

  _rememberSignalTrackerRegistration(session) {
    const characterID = this._getCharacterID(session);
    const systemID = this._getSystemID(session);
    if (characterID <= 0 || systemID <= 0) {
      return;
    }

    if (!anomalySnapshotBySystemID.has(systemID)) {
      ensureAnomalySnapshot(systemID);
    }
    if (!signatureSnapshotBySystemID.has(systemID)) {
      ensureSignatureSnapshot(systemID);
    }
    if (!staticSiteSnapshotBySystemID.has(systemID)) {
      ensureStaticSiteSnapshot(systemID);
    }
    if (!structureSnapshotBySystemID.has(systemID)) {
      ensureStructureSnapshot(systemID);
    }
    signalTrackerRegistrationsByCharacterID.set(characterID, {
      characterID,
      systemID,
      registeredAtMs: Date.now(),
      session,
    });
  }

  Handle_MachoResolveObject() {
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    log.debug("[ScanMgr] MachoBindObject");
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetSystemScanMgr(args, session) {
    log.debug("[ScanMgr] GetSystemScanMgr");
    this._ensureSystemParity(session);
    return buildBoundObjectSubstruct(this.name, session);
  }

  Handle_SignalTrackerRegister(args, session) {
    log.debug("[ScanMgr] SignalTrackerRegister");
    const systemID = this._ensureSystemParity(session);
    if (systemID <= 0) {
      return null;
    }

    this._rememberSignalTrackerRegistration(session);
    if (session && typeof session.sendNotification === "function") {
      session.sendNotification("OnSignalTrackerFullState", "solarsystemid2", [
        systemID,
        this._buildFullState(session),
        false,
      ]);
    }
    return null;
  }

  Handle_GetFullState(args, session) {
    log.debug("[ScanMgr] GetFullState");
    return this._buildFullState(session);
  }

  refreshSignalTrackerForSession(session, options = {}) {
    const systemID = this._ensureSystemParity(
      session,
      normalizeNumber(options.nowMs, Date.now()),
    );
    if (systemID <= 0) {
      return {
        success: false,
        errorMsg: "SYSTEM_NOT_AVAILABLE",
      };
    }
    this._rememberSignalTrackerRegistration(session);
    return notifyFullStateRefreshForSystem(systemID, {
      ...options,
      shouldRemoveOldSites: options.shouldRemoveOldSites === true,
    });
  }

  Handle_SetProbeDestination(args, session) {
    log.debug("[ScanMgr] SetProbeDestination");
    const characterID = this._getCharacterID(session);
    const systemID = this._getSystemID(session);
    const probeID = normalizeNumber(args && args[0], 0);
    const destination = args && args.length > 1 ? args[1] : null;
    if (characterID <= 0 || systemID <= 0 || probeID <= 0 || !destination) {
      return null;
    }

    const updated = probeRuntimeState.synchronizeCharacterProbeGeometry(
      characterID,
      systemID,
      new Map([
        [probeID, { destination }],
      ]),
      { nowMs: Date.now() },
    );
    if (updated.length > 0) {
      probeSceneRuntime.ensureProbeEntitiesForSession(session, updated, {
        systemID,
        ownerID: characterID,
      });
    }
    return null;
  }

  Handle_SetProbeRangeStep(args, session) {
    log.debug("[ScanMgr] SetProbeRangeStep");
    const characterID = this._getCharacterID(session);
    const systemID = this._getSystemID(session);
    const probeID = normalizeNumber(args && args[0], 0);
    const requestedRangeStep = normalizeNumber(args && args[1], 0);
    if (characterID <= 0 || systemID <= 0 || probeID <= 0 || requestedRangeStep <= 0) {
      return null;
    }

    const persistedProbe = probeRuntimeState.getCharacterSystemProbes(characterID, systemID)
      .find((probe) => normalizeNumber(probe && probe.probeID, 0) === probeID);
    if (!persistedProbe) {
      return null;
    }

    const rangeSteps = resolveProbeRangeStepsByTypeID(persistedProbe.typeID);
    const clampedRangeStep = clamp(
      requestedRangeStep,
      1,
      Math.max(1, rangeSteps.length || SCAN_PROBE_NUMBER_OF_RANGE_STEPS),
    );
    const scanRange = toFiniteNumber(
      rangeSteps[clampedRangeStep - 1],
      toFiniteNumber(persistedProbe.scanRange, 0),
    );

    probeRuntimeState.synchronizeCharacterProbeGeometry(
      characterID,
      systemID,
      new Map([
        [probeID, {
          rangeStep: clampedRangeStep,
          scanRange,
        }],
      ]),
      { nowMs: Date.now() },
    );
    return null;
  }

  Handle_GetScanTargetID(args, session, kwargs) {
    const siteID = normalizeNumber(args && args[0], 0);
    const targetSeedID = normalizeNumber(
      getKwargValue(kwargs, "targetSeedID"),
      siteID,
    );
    return signatureRuntime.getScanTargetID(this._getSystemID(session), siteID, {
      targetSeedID,
    });
  }

  Handle_ConeScan(args, session) {
    log.debug("[ScanMgr] ConeScan");
    const runtime = getSpaceRuntime();
    const scene =
      runtime && typeof runtime.getSceneForSession === "function"
        ? runtime.getSceneForSession(session)
        : null;
    if (!scene) {
      return [];
    }

    const egoEntity =
      scene && typeof scene.getShipEntityForSession === "function"
        ? scene.getShipEntityForSession(session)
        : null;
    if (!egoEntity) {
      return [];
    }

    const requestedAngle = toFiniteNumber(args && args[0], DSCAN_FULL_SWEEP_RADIANS);
    const requestedRange = toFiniteNumber(
      args && args[1],
      DSCAN_FALLBACK_MAX_RANGE_METERS,
    );
    const coneDirection = normalizeVector({
      x: toFiniteNumber(args && args[2], 0),
      y: toFiniteNumber(args && args[3], 0),
      z: toFiniteNumber(args && args[4], 0),
    });
    if (!coneDirection) {
      return [];
    }

    const effectiveAngle = clamp(requestedAngle, 0, DSCAN_FULL_SWEEP_RADIANS);
    const maxRangeMeters = Math.max(
      DSCAN_MIN_RANGE_METERS,
      resolveEntityRangeCapMeters(egoEntity),
    );
    const effectiveRangeMeters = clamp(
      requestedRange,
      DSCAN_MIN_RANGE_METERS,
      maxRangeMeters,
    );
    const egoPosition = cloneVector(egoEntity.position);
    const egoRadius = Math.max(0, toFiniteNumber(egoEntity.radius, 0));
    const fullSweep =
      effectiveAngle >= (DSCAN_FULL_SWEEP_RADIANS - 0.0001);
    const halfAngleCosine = fullSweep
      ? -1
      : Math.cos(Math.max(0, effectiveAngle) / 2);

    return collectSceneEntities(scene)
      .filter((entity) => isEntityDirectionalScanCandidate(entity, egoEntity))
      .map((entity) => {
        const vectorToTarget = subtractVectors(entity.position, egoPosition);
        const centerDistance = magnitude(vectorToTarget);
        const targetRadius = Math.max(0, toFiniteNumber(entity.radius, 0));
        const surfaceDistance = Math.max(
          0,
          centerDistance - egoRadius - targetRadius,
        );
        const directionToTarget = normalizeVector(vectorToTarget);
        return {
          entity,
          centerDistance,
          surfaceDistance,
          directionToTarget,
        };
      })
      .filter((entry) => entry.surfaceDistance <= effectiveRangeMeters)
      .filter((entry) => {
        if (fullSweep) {
          return true;
        }

        if (!entry.directionToTarget) {
          return entry.surfaceDistance <= 0;
        }

        return dotProduct(entry.directionToTarget, coneDirection) >= halfAngleCosine;
      })
      .sort((left, right) => {
        if (left.surfaceDistance !== right.surfaceDistance) {
          return left.surfaceDistance - right.surfaceDistance;
        }
        return normalizeNumber(left.entity && left.entity.itemID, 0) -
          normalizeNumber(right.entity && right.entity.itemID, 0);
      })
      .map((entry) => buildDirectionalScanResult(entry.entity));
  }

  Handle_RequestScans(args, session, kwargs) {
    log.debug("[ScanMgr] RequestScans");
    const systemID = this._ensureSystemParity(session);
    const characterID = this._getCharacterID(session);
    if (
      systemID <= 0 ||
      characterID <= 0 ||
      !session ||
      typeof session.sendNotification !== "function"
    ) {
      return null;
    }

    const nowMs = Date.now();
    probeRuntimeState.removeInvalidCharacterProbes(characterID, {
      systemID,
      nowMs,
    });
    probeRuntimeState.removeExpiredCharacterProbes(characterID, {
      systemID,
      nowMs,
    });

    const probePatchMap = probeScanRuntime.normalizeProbePatchMap(args && args[0]);
    const synchronizedProbes = probeRuntimeState.synchronizeCharacterProbeGeometry(
      characterID,
      systemID,
      probePatchMap,
      { nowMs },
    );
    const synchronizedProbeIDs = new Set(
      synchronizedProbes.map((probe) => normalizeNumber(probe && probe.probeID, 0)),
    );
    const normalizedProbeMap = probeScanRuntime.normalizeProbeMap(args && args[0]);
    const effectiveProbeMap = new Map(
      [...normalizedProbeMap.entries()].filter(([probeID]) => synchronizedProbeIDs.has(
        normalizeNumber(probeID, 0),
      )),
    );
    if (synchronizedProbes.length > 0) {
      probeSceneRuntime.ensureProbeEntitiesForSession(session, synchronizedProbes, {
        systemID,
        ownerID: characterID,
      });
    }

    const resolvedDurationMs = resolveProbeScanDurationMs(session, {
      durationMs: getKwargValue(kwargs, "_testingDurationMs"),
    });
    const startResolvedScan = () => {
      const scanResult = probeScanRuntime.buildSignatureScanResults(
        systemID,
        effectiveProbeMap,
        {
          durationMs: resolvedDurationMs,
        },
      );
      emitProbeScanLifecycleNotifications(session, scanResult, {
        startedAtFileTime: currentFileTime(),
        durationMs: scanResult.durationMs,
        immediateStop: resolvedDurationMs <= 1,
        scheduleFn: getKwargValue(kwargs, "_testingSetTimeout"),
        clearFn: getKwargValue(kwargs, "_testingClearTimeout"),
      });
    };

    scheduleProbeMovementThenScan(
      session,
      synchronizedProbes,
      startResolvedScan,
      {
        moveDurationMs: getKwargValue(kwargs, "_testingMoveDurationMs"),
        scheduleFn: getKwargValue(kwargs, "_testingSetTimeout"),
        clearFn: getKwargValue(kwargs, "_testingClearTimeout"),
        onArrive: () => {
          const arrivedProbes = probeRuntimeState.synchronizeCharacterProbeGeometry(
            characterID,
            systemID,
            new Map(
              synchronizedProbes.map((probe) => [
                normalizeNumber(probe && probe.probeID, 0),
                {
                  pos: Array.isArray(probe && probe.destination) ? probe.destination : probe.pos,
                  destination: Array.isArray(probe && probe.destination) ? probe.destination : probe.pos,
                },
              ]),
            ),
            { nowMs: Date.now() },
          );
          if (arrivedProbes.length > 0) {
            probeSceneRuntime.ensureProbeEntitiesForSession(session, arrivedProbes, {
              systemID,
              ownerID: characterID,
            });
          }
        },
      },
    );
    return null;
  }

  Handle_ReconnectToLostProbes(args, session) {
    log.debug("[ScanMgr] ReconnectToLostProbes");
    const characterID = this._getCharacterID(session);
    const systemID = this._getSystemID(session);
    if (characterID <= 0 || systemID <= 0) {
      return null;
    }

    probeRuntimeState.removeInvalidCharacterProbes(characterID, {
      systemID,
      nowMs: Date.now(),
    });
    probeRuntimeState.removeExpiredCharacterProbes(characterID, {
      systemID,
      nowMs: Date.now(),
    });

    const probes = probeRuntimeState.getReconnectableCharacterProbes(
      characterID,
      systemID,
    );
    scheduleProbeReplayNotifications(session, probes);
    return null;
  }

  Handle_DestroyProbe(args, session) {
    log.debug("[ScanMgr] DestroyProbe");
    const characterID = this._getCharacterID(session);
    const probeID = normalizeNumber(args && args[0], 0);
    if (characterID <= 0 || probeID <= 0) {
      return null;
    }

    probeRuntimeState.removeCharacterProbes(characterID, [probeID], {
      nowMs: Date.now(),
    });
    probeSceneRuntime.removeProbeEntitiesForSession(session, [probeID]);
    return null;
  }

  Handle_RecoverProbes(args, session) {
    log.debug("[ScanMgr] RecoverProbes");
    const characterID = this._getCharacterID(session);
    const shipID = normalizeNumber(
      (session && (session.shipID || session.shipid || session.activeShipID)) ||
      (session && session._space && session._space.shipID) ||
      0,
      0,
    );
    const probeIDs = extractProbeIDList(args);
    if (characterID <= 0 || probeIDs.length <= 0) {
      return [];
    }

    const removedProbes = probeRuntimeState.removeCharacterProbes(
      characterID,
      probeIDs,
      { nowMs: Date.now() },
    );
    restoreRecoveredProbeCharges(session, characterID, removedProbes, {
      shipID,
    });
    const removedProbeIDs = removedProbes.map((probe) => normalizeNumber(probe.probeID, 0));
    scheduleProbeRemovalNotifications(session, removedProbeIDs);
    return removedProbeIDs;
  }

  Handle_SetActivityState(args, session) {
    log.debug("[ScanMgr] SetActivityState");
    const characterID = this._getCharacterID(session);
    const probeIDs = extractProbeIDList(args && args[0]);
    const active = args && args.length > 1 ? args[1] === true : false;
    if (characterID <= 0 || probeIDs.length <= 0) {
      return null;
    }

    probeRuntimeState.setCharacterProbeActivity(characterID, probeIDs, active, {
      nowMs: Date.now(),
    });
    return null;
  }

  Handle_QAOverrideProbeExpiry(args, session) {
    log.debug("[ScanMgr] QAOverrideProbeExpiry");
    const characterID = this._getCharacterID(session);
    const systemID = this._getSystemID(session);
    const duration = normalizeNumber(args && args[0], 0);
    if (characterID <= 0 || systemID <= 0 || duration < 0) {
      return null;
    }
    probeRuntimeState.overrideCharacterProbeExpiry(characterID, duration / 1000, {
      systemID,
    });
    return null;
  }

  Handle_QAScanSites(args, session) {
    log.debug("[ScanMgr] QAScanSites");
    const systemID = this._ensureSystemParity(session);
    if (systemID <= 0) {
      return [];
    }

    const requestedSiteKeys = new Set(
      (Array.isArray(args) ? args : [])
        .flatMap((value) => Array.isArray(value) ? value : [value])
        .map((value) => unwrapMarshalValue(value))
        .flatMap((value) => {
          const numericValue = normalizeNumber(value, 0);
          const stringValue = String(value || "").trim().toUpperCase();
          const keys = [];
          if (numericValue > 0) {
            keys.push(String(numericValue));
          }
          if (stringValue) {
            keys.push(stringValue);
          }
          return keys;
        }),
    );
    const scanResult = probeScanRuntime.buildResolvedSignatureScanResults(systemID, {
      nowMs: Date.now(),
      durationMs: 1,
    });
    const results = Array.isArray(scanResult.results) ? scanResult.results : [];
    if (requestedSiteKeys.size <= 0) {
      return results;
    }
    const signatureSitesByResultID = new Map(
      signatureRuntime.listSystemSignatureSites(systemID).map((site) => [
        String(probeScanRuntime.resolveResultID(site)).trim().toUpperCase(),
        String(normalizeNumber(site && site.siteID, 0)),
      ]),
    );
    return results.filter((entry) => {
      const resolved = marshalObjectToObject(entry);
      const resultID = String(resolved && resolved.id || "").trim().toUpperCase();
      const numericSiteID = signatureSitesByResultID.get(resultID) || "";
      return requestedSiteKeys.has(resultID) || (numericSiteID && requestedSiteKeys.has(numericSiteID));
    });
  }

  resolveAllSystemSignaturesForSession(session, options = {}) {
    const systemID = this._ensureSystemParity(
      session,
      normalizeNumber(options.nowMs, Date.now()),
    );
    if (
      systemID <= 0 ||
      !session ||
      typeof session.sendNotification !== "function"
    ) {
      return {
        success: false,
        errorMsg: "SYSTEM_NOT_AVAILABLE",
      };
    }

    const refreshResult = this.refreshSignalTrackerForSession(session, {
      ...options,
      shouldRemoveOldSites: options.shouldRemoveOldSites !== false,
    });
    if (!refreshResult.success) {
      return refreshResult;
    }

    const scanResult = probeScanRuntime.buildResolvedSignatureScanResults(
      systemID,
      {
        nowMs: normalizeNumber(options.nowMs, Date.now()),
        durationMs: normalizeNumber(options.durationMs, 1),
      },
    );
    emitProbeScanLifecycleNotifications(session, scanResult, {
      startedAtFileTime: currentFileTime(),
      durationMs: scanResult.durationMs,
      immediateStop: true,
    });

    return {
      success: true,
      data: {
        systemID,
        signatureCount: scanResult.results.length,
      },
    };
  }
}

ScanMgrService._testing = {
  clearSignalTrackerState() {
    signalTrackerRegistrationsByCharacterID.clear();
    anomalySnapshotBySystemID.clear();
    signatureSnapshotBySystemID.clear();
    staticSiteSnapshotBySystemID.clear();
    structureSnapshotBySystemID.clear();
    probeRuntimeState.clearRuntimeCache();
  },
  notifyAnomalyDeltaForSystem,
  notifyFullStateRefreshForSystem,
  notifySignatureDeltaForSystem,
  ensureStaticSiteSnapshot,
  notifyStructureDeltaForSystem,
  clearPendingProbeScanStop,
  resolveProbeScanDurationMs,
};

ScanMgrService.notifyAnomalyDeltaForSystem = notifyAnomalyDeltaForSystem;
ScanMgrService.notifyStructureDeltaForSystem = notifyStructureDeltaForSystem;

module.exports = ScanMgrService;
