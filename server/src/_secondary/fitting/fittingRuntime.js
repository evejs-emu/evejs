const path = require("path");

function getFittingSnapshotBuilder() {
  return require(path.join(__dirname, "./fittingSnapshotBuilder"));
}

let nextSnapshotVersion = 1;
const shipSnapshotCache = new Map();

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeReasonList(reasonOrReasons) {
  const values = Array.isArray(reasonOrReasons)
    ? reasonOrReasons
    : reasonOrReasons === undefined || reasonOrReasons === null
      ? []
      : [reasonOrReasons];
  return [...new Set(
    values
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];
}

function buildShipSnapshotCacheKey(characterID, shipReference, options = {}) {
  const shipID = toInt(
    shipReference && typeof shipReference === "object"
      ? shipReference.itemID
      : shipReference,
    toInt(options.shipID, toInt(options.shipItem && options.shipItem.itemID, 0)),
  );
  if (shipID <= 0) {
    return null;
  }

  const fittingMode =
    options.assumeActiveShipModules !== undefined &&
    options.assumeActiveShipModules !== true
      ? "passive"
      : "active";
  return `${toInt(characterID, 0)}:${shipID}:${fittingMode}`;
}

function normalizeSnapshotAttributes(attributes = {}) {
  return Object.fromEntries(
    Object.entries(attributes || {})
      .map(([attributeID, value]) => [Number(attributeID), Number(value)])
      .filter(
        ([attributeID, value]) =>
          Number.isInteger(attributeID) && Number.isFinite(value),
      ),
  );
}

function buildRuntimeSnapshotRecord(characterID, shipReference, options = {}) {
  const { buildFittingSnapshot } = getFittingSnapshotBuilder();
  const builtSnapshot = buildFittingSnapshot(characterID, shipReference, options);
  if (!builtSnapshot) {
    return null;
  }

  const trackedShipAttributes = normalizeSnapshotAttributes(
    builtSnapshot.shipAttributes,
  );
  const reasons = normalizeReasonList(options.reasons || options.reason);

  return {
    version: nextSnapshotVersion++,
    builtAt: Date.now(),
    reasons,
    characterID: toInt(characterID, 0),
    shipID: toInt(builtSnapshot.shipID, 0),
    shipItem: builtSnapshot.shipItem,
    fittedItems: builtSnapshot.fittedItems,
    skillMap: builtSnapshot.skillMap,
    resourceState: builtSnapshot.resourceState,
    shipAttributes: {
      ...trackedShipAttributes,
    },
    trackedShipAttributes,
    snapshot: builtSnapshot,
    buildResourceStateForItems: builtSnapshot.buildResourceStateForItems,
    getModuleResourceLoad: builtSnapshot.getModuleResourceLoad,
    getModuleAttributeOverrides: builtSnapshot.getModuleAttributeOverrides,
    buildOnlineCandidateResourceState:
      builtSnapshot.buildOnlineCandidateResourceState,
  };
}

function getShipFittingSnapshot(characterID, shipReference, options = {}) {
  const cacheKey = buildShipSnapshotCacheKey(characterID, shipReference, options);
  if (!options.forceRefresh && cacheKey && shipSnapshotCache.has(cacheKey)) {
    return shipSnapshotCache.get(cacheKey);
  }

  const record = buildRuntimeSnapshotRecord(characterID, shipReference, options);
  if (record && cacheKey) {
    shipSnapshotCache.set(cacheKey, record);
  }
  return record;
}

function refreshShipFittingSnapshot(characterID, shipReference, options = {}) {
  return getShipFittingSnapshot(characterID, shipReference, {
    ...options,
    forceRefresh: true,
  });
}

function peekShipFittingSnapshot(characterID, shipReference, options = {}) {
  const cacheKey = buildShipSnapshotCacheKey(characterID, shipReference, options);
  if (!cacheKey) {
    return null;
  }
  return shipSnapshotCache.get(cacheKey) || null;
}

function invalidateShipFittingSnapshot(characterID, shipReference, options = {}) {
  const cacheKey = buildShipSnapshotCacheKey(characterID, shipReference, options);
  if (!cacheKey) {
    return null;
  }
  const previousSnapshot = shipSnapshotCache.get(cacheKey) || null;
  shipSnapshotCache.delete(cacheKey);
  return previousSnapshot;
}

function listShipFittingAttributeChanges(previousSnapshot, nextSnapshot) {
  if (!previousSnapshot || !nextSnapshot) {
    return [];
  }

  const previousAttributes =
    previousSnapshot.trackedShipAttributes || previousSnapshot.shipAttributes || {};
  const nextAttributes =
    nextSnapshot.trackedShipAttributes || nextSnapshot.shipAttributes || {};
  const attributeIDs = new Set([
    ...Object.keys(previousAttributes),
    ...Object.keys(nextAttributes),
  ]);

  return [...attributeIDs]
    .map((attributeID) => toInt(attributeID, 0))
    .filter((attributeID) => attributeID > 0)
    .sort((left, right) => left - right)
    .map((attributeID) => {
      const previousValue = toFiniteNumber(previousAttributes[attributeID], 0);
      const nextValue = toFiniteNumber(nextAttributes[attributeID], 0);
      return {
        attributeID,
        previousValue,
        nextValue,
      };
    })
    .filter(
      (change) => Math.abs(change.nextValue - change.previousValue) > 1e-6,
    );
}

function buildShipFittingSnapshotDiagnostics(snapshot) {
  if (!snapshot) {
    return null;
  }

  return {
    version: toInt(snapshot.version, 0),
    builtAt: toInt(snapshot.builtAt, 0),
    reasons: [...normalizeReasonList(snapshot.reasons)],
    characterID: toInt(snapshot.characterID, 0),
    shipID: toInt(snapshot.shipID, 0),
    fittedItemCount: Array.isArray(snapshot.fittedItems)
      ? snapshot.fittedItems.length
      : 0,
    cpuLoad: toFiniteNumber(snapshot.resourceState && snapshot.resourceState.cpuLoad, 0),
    cpuOutput: toFiniteNumber(snapshot.resourceState && snapshot.resourceState.cpuOutput, 0),
    powerLoad: toFiniteNumber(snapshot.resourceState && snapshot.resourceState.powerLoad, 0),
    powerOutput: toFiniteNumber(
      snapshot.resourceState && snapshot.resourceState.powerOutput,
      0,
    ),
    trackedAttributeCount: Object.keys(
      snapshot.trackedShipAttributes || snapshot.shipAttributes || {},
    ).length,
  };
}

function resetFittingRuntimeForTests() {
  shipSnapshotCache.clear();
  nextSnapshotVersion = 1;
}

module.exports = {
  buildShipSnapshotCacheKey,
  getShipFittingSnapshot,
  refreshShipFittingSnapshot,
  peekShipFittingSnapshot,
  invalidateShipFittingSnapshot,
  listShipFittingAttributeChanges,
  buildShipFittingSnapshotDiagnostics,
  resetFittingRuntimeForTests,
};
