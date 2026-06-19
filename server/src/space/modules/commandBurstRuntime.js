const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  getAttributeIDByNames,
  getRequiredSkillRequirements,
  isChargeCompatibleWithModule,
  applyOtherItemModifiersToAttributes,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  buildLocationModifiedAttributeMap,
  collectShipModifierAttributes,
} = require(path.join(__dirname, "../combat/weaponDogma"));
const {
  buildNpcEffectiveModuleItem,
} = require(path.join(__dirname, "../npc/npcCapabilityResolver"));
function isInSameFleet(leftCharacterID, rightCharacterID) {
  const fleetHelpers = require(path.join(
    __dirname,
    "../../services/fleets/fleetHelpers",
  ));
  return fleetHelpers && typeof fleetHelpers.isInSameFleet === "function"
    ? fleetHelpers.isInSameFleet(leftCharacterID, rightCharacterID)
    : false;
}

const DBUFF_COLLECTIONS_TABLE = "dbuffCollections";

const ATTRIBUTE_CAPACITOR_NEED = getAttributeIDByNames("capacitorNeed") || 6;
const ATTRIBUTE_DURATION = getAttributeIDByNames("duration") || 73;
const ATTRIBUTE_MAX_RANGE = getAttributeIDByNames("maxRange") || 54;
const ATTRIBUTE_MAX_GROUP_ACTIVE = getAttributeIDByNames("maxGroupActive") || 763;
const ATTRIBUTE_REACTIVATION_DELAY =
  getAttributeIDByNames("moduleReactivationDelay", "reactivationDelay") || 669;
const ATTRIBUTE_RELOAD_TIME = getAttributeIDByNames("reloadTime") || 1795;
const ATTRIBUTE_BUFF_DURATION = getAttributeIDByNames("buffDuration") || 2535;
const ATTRIBUTE_WARFARE_BUFF_1_ID = getAttributeIDByNames("warfareBuff1ID") || 2468;
const ATTRIBUTE_WARFARE_BUFF_1_VALUE = getAttributeIDByNames("warfareBuff1Value") || 2469;
const ATTRIBUTE_WARFARE_BUFF_2_ID = getAttributeIDByNames("warfareBuff2ID") || 2470;
const ATTRIBUTE_WARFARE_BUFF_2_VALUE = getAttributeIDByNames("warfareBuff2Value") || 2471;
const ATTRIBUTE_WARFARE_BUFF_3_ID = getAttributeIDByNames("warfareBuff3ID") || 2472;
const ATTRIBUTE_WARFARE_BUFF_3_VALUE = getAttributeIDByNames("warfareBuff3Value") || 2473;

const DOGMA_OP_PRE_MUL = 0;
const DOGMA_OP_MOD_ADD = 2;
const DOGMA_OP_POST_MUL = 4;
const DOGMA_OP_POST_PERCENT = 6;
const DOGMA_OP_PRE_ASSIGNMENT = 7;
const DOGMA_OP_POST_ASSIGNMENT = 8;

const COMMAND_BURST_DEFINITIONS = Object.freeze({
  moduleBonusWarfareLinkArmor: Object.freeze({
    family: "armor",
    sourceFxGuid: "effects.WarfareLinkSphereArmor",
    targetFxGuid: "effects.WarfareLinkArmor",
  }),
  moduleBonusWarfareLinkInfo: Object.freeze({
    family: "information",
    sourceFxGuid: "effects.WarfareLinkSphereInformation",
    targetFxGuid: "effects.WarfareLinkInformation",
  }),
  moduleBonusWarfareLinkMining: Object.freeze({
    family: "mining",
    sourceFxGuid: "effects.WarfareLinkSphereMining",
    targetFxGuid: "effects.WarfareLinkMining",
  }),
  moduleBonusWarfareLinkShield: Object.freeze({
    family: "shield",
    sourceFxGuid: "effects.WarfareLinkSphereShield",
    targetFxGuid: "effects.WarfareLinkShield",
  }),
  moduleBonusWarfareLinkSkirmish: Object.freeze({
    family: "skirmish",
    sourceFxGuid: "effects.WarfareLinkSphereSkirmish",
    targetFxGuid: "effects.WarfareLinkSkirmish",
  }),
});

const OPERATION_NAME_TO_CODE = Object.freeze({
  ModAdd: DOGMA_OP_MOD_ADD,
  PostMul: DOGMA_OP_POST_MUL,
  PostPercent: DOGMA_OP_POST_PERCENT,
  PreAssignment: DOGMA_OP_PRE_ASSIGNMENT,
  PostAssignment: DOGMA_OP_POST_ASSIGNMENT,
});

let cachedDbuffCollectionsByID = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round6(value) {
  return Number(toFiniteNumber(value, 0).toFixed(6));
}

function cloneVector(source = null) {
  return {
    x: toFiniteNumber(source && source.x, 0),
    y: toFiniteNumber(source && source.y, 0),
    z: toFiniteNumber(source && source.z, 0),
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
    (toFiniteNumber(vector && vector.z, 0) ** 2),
  );
}

function distance(left, right) {
  return magnitude(subtractVectors(left, right));
}

function getSurfaceDistance(left, right) {
  return Math.max(
    0,
    distance(left && left.position, right && right.position) -
      Math.max(0, toFiniteNumber(left && left.radius, 0)) -
      Math.max(0, toFiniteNumber(right && right.radius, 0)),
  );
}

function normalizeEffectName(effectRecord) {
  return String(effectRecord && effectRecord.name || "").trim();
}

function resolveCommandBurstDefinition(effectRecord) {
  return COMMAND_BURST_DEFINITIONS[normalizeEffectName(effectRecord)] || null;
}

function isCommandBurstEffectRecord(effectRecord) {
  return Boolean(resolveCommandBurstDefinition(effectRecord));
}

function freezePlainEntries(entries = [], extraPredicate = null) {
  const normalizedEntries = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const nextEntry = {
      dogmaAttributeID: toInt(entry && entry.dogmaAttributeID, 0),
      groupID: toInt(entry && entry.groupID, 0),
      categoryID: toInt(entry && entry.categoryID, 0),
      skillID: toInt(entry && entry.skillID, 0),
    };
    if (nextEntry.dogmaAttributeID <= 0) {
      continue;
    }
    if (typeof extraPredicate === "function" && extraPredicate(nextEntry) !== true) {
      continue;
    }
    normalizedEntries.push(Object.freeze(nextEntry));
  }
  return Object.freeze(normalizedEntries);
}

function normalizeDbuffCollectionEntry(entry, fallbackCollectionID = 0) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const collectionID = toInt(
    entry.collectionID,
    fallbackCollectionID,
  );
  const operation =
    toInt(entry.operation, 0) > 0
      ? toInt(entry.operation, 0)
      : OPERATION_NAME_TO_CODE[String(entry.operationName || "")];
  if (collectionID <= 0 || operation === undefined) {
    return null;
  }

  return Object.freeze({
    collectionID,
    aggregateMode: String(entry.aggregateMode || "Maximum"),
    operation,
    operationName: String(entry.operationName || ""),
    developerDescription: String(entry.developerDescription || ""),
    itemModifiers: freezePlainEntries(entry.itemModifiers),
    locationModifiers: freezePlainEntries(entry.locationModifiers),
    locationGroupModifiers: freezePlainEntries(
      entry.locationGroupModifiers,
      (candidate) => candidate.groupID > 0,
    ),
    locationCategoryModifiers: freezePlainEntries(
      entry.locationCategoryModifiers,
      (candidate) => candidate.categoryID > 0,
    ),
    locationRequiredSkillModifiers: freezePlainEntries(
      entry.locationRequiredSkillModifiers,
      (candidate) => candidate.skillID > 0,
    ),
  });
}

function buildDbuffCollectionsByID() {
  const collectionsByID = new Map();
  const result = database.read(DBUFF_COLLECTIONS_TABLE, "/");
  const rawRoot =
    result && result.success && result.data && typeof result.data === "object"
      ? result.data
      : null;
  const rawCollections =
    rawRoot &&
    typeof rawRoot === "object" &&
    rawRoot.collectionsByID &&
    typeof rawRoot.collectionsByID === "object"
      ? rawRoot.collectionsByID
      : rawRoot &&
          typeof rawRoot === "object" &&
          rawRoot.records &&
          typeof rawRoot.records === "object"
        ? rawRoot.records
        : rawRoot;
  if (!rawCollections) {
    return collectionsByID;
  }

  for (const [collectionID, entry] of Object.entries(rawCollections)) {
    const normalizedEntry = normalizeDbuffCollectionEntry(entry, collectionID);
    if (!normalizedEntry) {
      continue;
    }
    collectionsByID.set(normalizedEntry.collectionID, normalizedEntry);
  }

  return collectionsByID;
}

function getDbuffCollectionsByID() {
  if (!cachedDbuffCollectionsByID) {
    cachedDbuffCollectionsByID = buildDbuffCollectionsByID();
  }
  return cachedDbuffCollectionsByID;
}

class Aggregator {
  constructor(expiryTime, outputValue) {
    if (expiryTime === undefined || expiryTime === null) {
      this._continuousInput = outputValue;
      this._sortedInputs = [];
    } else {
      this._continuousInput = null;
      this._sortedInputs = [[expiryTime, outputValue]];
    }
  }

  hasInputs() {
    return this._sortedInputs.length > 0 || this._continuousInput !== null;
  }

  getNextExpiryTime() {
    if (this._sortedInputs.length > 0) {
      return this._sortedInputs[0][0];
    }
    if (this._continuousInput === null) {
      return 0;
    }
    return null;
  }

  getFinalExpiryTime() {
    if (this._continuousInput !== null) {
      return null;
    }
    if (this._sortedInputs.length > 0) {
      return this._sortedInputs[this._sortedInputs.length - 1][0];
    }
    return null;
  }

  getCurrentOutputValue() {
    if (this._sortedInputs.length > 0 && this._continuousInput !== null) {
      return this._pickValue(this._continuousInput, this._sortedInputs[0][1]);
    }
    if (this._continuousInput !== null) {
      return this._continuousInput;
    }
    if (this._sortedInputs.length > 0) {
      return this._sortedInputs[0][1];
    }
    return null;
  }

  setContinuousInput(newValue) {
    if (this._continuousInput === null) {
      this._continuousInput = newValue;
      return;
    }
    this._continuousInput = this._pickValue(this._continuousInput, newValue);
  }

  clearContinuousInput() {
    this._continuousInput = null;
  }

  discardExpiredTimedInputs(now) {
    while (this._sortedInputs.length > 0 && this._sortedInputs[0][0] < now) {
      this._sortedInputs.shift();
    }
  }
}

class AggregatorMinimum extends Aggregator {
  mergeNewTimedInput(newExpiryTime, newValue) {
    for (const [expiryTime, value] of this._sortedInputs) {
      if (expiryTime >= newExpiryTime && value <= newValue) {
        return;
      }
    }

    const result = [];
    for (const [expiryTime, value] of this._sortedInputs) {
      if (expiryTime < newExpiryTime && value < newValue) {
        result.push([expiryTime, value]);
      }
    }
    result.push([newExpiryTime, newValue]);
    for (const [expiryTime, value] of this._sortedInputs) {
      if (expiryTime > newExpiryTime && value > newValue) {
        result.push([expiryTime, value]);
      }
    }
    this._sortedInputs = result;
  }

  _pickValue(...values) {
    return Math.min(...values);
  }
}

class AggregatorMaximum extends Aggregator {
  mergeNewTimedInput(newExpiryTime, newValue) {
    for (const [expiryTime, value] of this._sortedInputs) {
      if (expiryTime >= newExpiryTime && value >= newValue) {
        return;
      }
    }

    const result = [];
    for (const [expiryTime, value] of this._sortedInputs) {
      if (expiryTime < newExpiryTime && value > newValue) {
        result.push([expiryTime, value]);
      }
    }
    result.push([newExpiryTime, newValue]);
    for (const [expiryTime, value] of this._sortedInputs) {
      if (expiryTime > newExpiryTime && value < newValue) {
        result.push([expiryTime, value]);
      }
    }
    this._sortedInputs = result;
  }

  _pickValue(...values) {
    return Math.max(...values);
  }
}

function createAggregator(collectionDefinition, expiryTime, outputValue) {
  if (collectionDefinition && collectionDefinition.aggregateMode === "Minimum") {
    return new AggregatorMinimum(expiryTime, outputValue);
  }
  return new AggregatorMaximum(expiryTime, outputValue);
}

function getCommandBurstBucketMap(entity, create = true) {
  if (!entity || typeof entity !== "object") {
    return null;
  }
  if (!(entity.commandBurstDynamicBuffs instanceof Map) && create) {
    entity.commandBurstDynamicBuffs = new Map();
  }
  return entity.commandBurstDynamicBuffs instanceof Map
    ? entity.commandBurstDynamicBuffs
    : null;
}

function buildCollectionValuesFromAttributes(attributes = {}) {
  const entries = [
    [
      toInt(attributes[ATTRIBUTE_WARFARE_BUFF_1_ID], 0),
      toFiniteNumber(attributes[ATTRIBUTE_WARFARE_BUFF_1_VALUE], NaN),
    ],
    [
      toInt(attributes[ATTRIBUTE_WARFARE_BUFF_2_ID], 0),
      toFiniteNumber(attributes[ATTRIBUTE_WARFARE_BUFF_2_VALUE], NaN),
    ],
    [
      toInt(attributes[ATTRIBUTE_WARFARE_BUFF_3_ID], 0),
      toFiniteNumber(attributes[ATTRIBUTE_WARFARE_BUFF_3_VALUE], NaN),
    ],
  ];

  const collectionValues = new Map();
  for (const [collectionID, rawValue] of entries) {
    if (collectionID <= 0 || !Number.isFinite(rawValue)) {
      continue;
    }
    collectionValues.set(collectionID, round6(rawValue));
  }
  return collectionValues;
}

function moduleRequiresSkillType(moduleItem, skillTypeID) {
  return getRequiredSkillRequirements(toInt(moduleItem && moduleItem.typeID, 0))
    .some((entry) => toInt(entry && entry.skillTypeID, 0) === toInt(skillTypeID, 0));
}

function collectDefinitionModifierEntries(destination, collectionDefinition, targetItem, outputValue) {
  if (!collectionDefinition || !targetItem || !Number.isFinite(outputValue)) {
    return destination;
  }

  for (const modifier of collectionDefinition.itemModifiers) {
    destination.push({
      modifiedAttributeID: modifier.dogmaAttributeID,
      operation: collectionDefinition.operation,
      value: round6(outputValue),
      stackingPenalized: false,
      dbuffCollectionID: collectionDefinition.collectionID,
    });
  }

  for (const modifier of collectionDefinition.locationModifiers) {
    destination.push({
      modifiedAttributeID: modifier.dogmaAttributeID,
      operation: collectionDefinition.operation,
      value: round6(outputValue),
      stackingPenalized: false,
      dbuffCollectionID: collectionDefinition.collectionID,
    });
  }

  const matchedGroupAttributes = new Set();
  for (const modifier of collectionDefinition.locationGroupModifiers) {
    if (
      toInt(targetItem && targetItem.groupID, 0) !== modifier.groupID ||
      matchedGroupAttributes.has(modifier.dogmaAttributeID)
    ) {
      continue;
    }
    matchedGroupAttributes.add(modifier.dogmaAttributeID);
    destination.push({
      modifiedAttributeID: modifier.dogmaAttributeID,
      operation: collectionDefinition.operation,
      value: round6(outputValue),
      stackingPenalized: false,
      dbuffCollectionID: collectionDefinition.collectionID,
    });
  }

  const matchedCategoryAttributes = new Set();
  for (const modifier of collectionDefinition.locationCategoryModifiers) {
    if (
      toInt(targetItem && targetItem.categoryID, 0) !== modifier.categoryID ||
      matchedCategoryAttributes.has(modifier.dogmaAttributeID)
    ) {
      continue;
    }
    matchedCategoryAttributes.add(modifier.dogmaAttributeID);
    destination.push({
      modifiedAttributeID: modifier.dogmaAttributeID,
      operation: collectionDefinition.operation,
      value: round6(outputValue),
      stackingPenalized: false,
      dbuffCollectionID: collectionDefinition.collectionID,
    });
  }

  const matchedSkillAttributes = new Set();
  for (const modifier of collectionDefinition.locationRequiredSkillModifiers) {
    if (
      matchedSkillAttributes.has(modifier.dogmaAttributeID) ||
      !moduleRequiresSkillType(targetItem, modifier.skillID)
    ) {
      continue;
    }
    matchedSkillAttributes.add(modifier.dogmaAttributeID);
    destination.push({
      modifiedAttributeID: modifier.dogmaAttributeID,
      operation: collectionDefinition.operation,
      value: round6(outputValue),
      stackingPenalized: false,
      dbuffCollectionID: collectionDefinition.collectionID,
    });
  }

  return destination;
}

function buildCommandBurstStateSignature(entity) {
  const buckets = getCommandBurstBucketMap(entity, false);
  if (!(buckets instanceof Map) || buckets.size <= 0) {
    return "[]";
  }

  return JSON.stringify(
    [...buckets.entries()]
      .map(([collectionID, aggregator]) => ({
        collectionID,
        currentValue: round6(aggregator.getCurrentOutputValue()),
        finalExpiryTime: aggregator.getFinalExpiryTime(),
        timedInputs: aggregator._sortedInputs.map(([expiryTime, value]) => [
          expiryTime,
          round6(value),
        ]),
      }))
      .sort((left, right) => left.collectionID - right.collectionID),
  );
}

function buildClientDbuffStateEntriesInternal(entity, buildExpiry) {
  const buckets = getCommandBurstBucketMap(entity, false);
  if (!(buckets instanceof Map) || buckets.size <= 0) {
    return [];
  }

  return [...buckets.entries()]
    .map(([collectionID, aggregator]) => {
      const outputValue = aggregator.getCurrentOutputValue();
      if (!Number.isFinite(outputValue)) {
        return null;
      }
      const finalExpiryTime = aggregator.getFinalExpiryTime();
      return [
        toInt(collectionID, 0),
        [
          round6(outputValue),
          finalExpiryTime === null || finalExpiryTime === undefined
            ? null
            : buildExpiry(finalExpiryTime),
        ],
      ];
    })
    .filter(Boolean)
    .sort((left, right) => left[0] - right[0]);
}

function pruneExpiredCommandBursts(entity, nowMs) {
  const buckets = getCommandBurstBucketMap(entity, false);
  if (!(buckets instanceof Map) || buckets.size <= 0) {
    return {
      changed: false,
      clientState: [],
    };
  }

  const beforeSignature = buildCommandBurstStateSignature(entity);
  for (const [collectionID, aggregator] of [...buckets.entries()]) {
    aggregator.discardExpiredTimedInputs(nowMs);
    if (!aggregator.hasInputs()) {
      buckets.delete(collectionID);
    }
  }
  const afterSignature = buildCommandBurstStateSignature(entity);
  return {
    changed: beforeSignature !== afterSignature,
    clientState: buildClientDbuffStateEntriesInternal(entity, (expiryTime) => expiryTime),
  };
}

function buildClientDbuffStateEntries(entity, options = {}) {
  const nowMs = Math.max(0, toFiniteNumber(options.nowMs, Date.now()));
  pruneExpiredCommandBursts(entity, nowMs);
  const buckets = getCommandBurstBucketMap(entity, false);
  if (!(buckets instanceof Map) || buckets.size <= 0) {
    return [];
  }

  const buildExpiry =
    typeof options.buildExpiry === "function"
      ? options.buildExpiry
      : (expiryTime) => expiryTime;

  return buildClientDbuffStateEntriesInternal(entity, buildExpiry);
}

function applyTimedCommandBurstToEntity(entity, collectionValues, durationMs, nowMs) {
  if (!entity || !(collectionValues instanceof Map) || collectionValues.size <= 0) {
    return {
      changed: false,
      clientState: buildClientDbuffStateEntries(entity, { nowMs }),
    };
  }

  const clampedDurationMs = Math.max(0, toFiniteNumber(durationMs, 0));
  if (clampedDurationMs <= 0) {
    return {
      changed: false,
      clientState: buildClientDbuffStateEntries(entity, { nowMs }),
    };
  }

  const buckets = getCommandBurstBucketMap(entity, true);
  const beforeSignature = buildCommandBurstStateSignature(entity);
  for (const [collectionID, value] of collectionValues.entries()) {
    const collectionDefinition = getDbuffCollectionsByID().get(toInt(collectionID, 0)) || null;
    if (!collectionDefinition || !Number.isFinite(value)) {
      continue;
    }

    const expiryTime = nowMs + clampedDurationMs;
    const existing = buckets.get(collectionID) || null;
    if (!existing) {
      buckets.set(
        collectionID,
        createAggregator(collectionDefinition, expiryTime, round6(value)),
      );
      continue;
    }

    existing.discardExpiredTimedInputs(nowMs);
    existing.mergeNewTimedInput(expiryTime, round6(value));
  }

  const afterSignature = buildCommandBurstStateSignature(entity);
  return {
    changed: beforeSignature !== afterSignature,
    clientState: buildClientDbuffStateEntries(entity, { nowMs }),
  };
}

function resolveEntityCharacterID(entity) {
  if (!entity || entity.kind !== "ship") {
    return 0;
  }
  return toInt(
    entity.session && entity.session.characterID
      ? entity.session.characterID
      : entity.characterID ?? entity.pilotCharacterID,
    0,
  );
}

function resolveBurstAffinityGroupID(entity) {
  if (!entity || entity.kind !== "ship") {
    return 0;
  }
  return toInt(
    entity.remoteRepairBurstAffinityGroupID ??
      entity.commandBurstAffinityGroupID,
    0,
  );
}

function isBurstRecipient(sourceEntity, targetEntity, rangeMeters) {
  if (!sourceEntity || !targetEntity || targetEntity.kind !== "ship") {
    return false;
  }
  if (toInt(sourceEntity.itemID, 0) === toInt(targetEntity.itemID, 0)) {
    return true;
  }

  const sourceAffinityGroupID = resolveBurstAffinityGroupID(sourceEntity);
  const targetAffinityGroupID = resolveBurstAffinityGroupID(targetEntity);
  if (
    sourceAffinityGroupID > 0 &&
    sourceAffinityGroupID === targetAffinityGroupID
  ) {
    return getSurfaceDistance(sourceEntity, targetEntity) <= Math.max(0, toFiniteNumber(rangeMeters, 0)) + 1;
  }

  const sourceCharacterID = resolveEntityCharacterID(sourceEntity);
  const targetCharacterID = resolveEntityCharacterID(targetEntity);
  if (
    sourceCharacterID <= 0 ||
    targetCharacterID <= 0 ||
    !isInSameFleet(sourceCharacterID, targetCharacterID)
  ) {
    return false;
  }

  return getSurfaceDistance(sourceEntity, targetEntity) <= Math.max(0, toFiniteNumber(rangeMeters, 0)) + 1;
}

function resolveCommandBurstRecipients(scene, sourceEntity, effectState, nowMs = null) {
  if (!scene || !sourceEntity || !effectState) {
    return [];
  }

  const rangeMeters = Math.max(0, toFiniteNumber(effectState.commandBurstRangeMeters, 0));
  const recipients = [];
  for (const entity of scene.dynamicEntities.values()) {
    if (!isBurstRecipient(sourceEntity, entity, rangeMeters)) {
      continue;
    }
    recipients.push(entity);
  }

  recipients.sort((left, right) => (
    toInt(left && left.itemID, 0) - toInt(right && right.itemID, 0)
  ));
  return recipients;
}

function collectModifierEntriesForItem(entity, targetItem, nowMs = null) {
  if (!entity || !targetItem) {
    return [];
  }

  const now = Math.max(0, toFiniteNumber(nowMs, Date.now()));
  pruneExpiredCommandBursts(entity, now);
  const buckets = getCommandBurstBucketMap(entity, false);
  if (!(buckets instanceof Map) || buckets.size <= 0) {
    return [];
  }

  const modifierEntries = [];
  for (const [collectionID, aggregator] of buckets.entries()) {
    const collectionDefinition = getDbuffCollectionsByID().get(toInt(collectionID, 0)) || null;
    const outputValue = aggregator.getCurrentOutputValue();
    if (!collectionDefinition || !Number.isFinite(outputValue)) {
      continue;
    }
    collectDefinitionModifierEntries(
      modifierEntries,
      collectionDefinition,
      targetItem,
      outputValue,
    );
  }
  return modifierEntries;
}

function resolveCommandBurstActivation({
  effectRecord,
  moduleItem,
  chargeItem = null,
  shipItem,
  skillMap = null,
  fittedItems = null,
  activeModuleContexts = null,
} = {}) {
  const definition = resolveCommandBurstDefinition(effectRecord);
  if (!definition) {
    return { matched: false };
  }
  if (!shipItem || !moduleItem) {
    return { matched: true, success: false, errorMsg: "UNSUPPORTED_MODULE" };
  }
  if (!chargeItem) {
    return { matched: true, success: false, errorMsg: "NO_AMMO" };
  }
  if (!isChargeCompatibleWithModule(moduleItem.typeID, chargeItem.typeID)) {
    return { matched: true, success: false, errorMsg: "CHARGE_NOT_COMPATIBLE" };
  }

  const effectiveModuleItem = buildNpcEffectiveModuleItem(moduleItem);
  const resolvedFittedItems = Array.isArray(fittedItems) ? fittedItems : [];
  const resolvedSkillMap = skillMap instanceof Map ? skillMap : new Map();
  const resolvedActiveModuleContexts = Array.isArray(activeModuleContexts)
    ? activeModuleContexts
    : [];
  const shipModifierAttributes = collectShipModifierAttributes(
    shipItem,
    resolvedSkillMap,
  );
  const moduleAttributes = buildLocationModifiedAttributeMap(
    effectiveModuleItem,
    shipItem,
    resolvedSkillMap,
    shipModifierAttributes,
    resolvedFittedItems,
    resolvedActiveModuleContexts,
    {
      excludeItemID: toInt(moduleItem && moduleItem.itemID, 0),
    },
  );
  applyOtherItemModifiersToAttributes(moduleAttributes, chargeItem);

  const collectionValues = buildCollectionValuesFromAttributes(moduleAttributes);
  if (collectionValues.size <= 0) {
    return { matched: true, success: false, errorMsg: "CHARGE_NOT_COMPATIBLE" };
  }

  return {
    matched: true,
    success: true,
    data: {
      runtimeAttrs: {
        capNeed: Math.max(0, round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_CAPACITOR_NEED], 0))),
        durationMs: Math.max(1, round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_DURATION], 0))),
        durationAttributeID: ATTRIBUTE_DURATION,
        reactivationDelayMs: Math.max(
          0,
          round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_REACTIVATION_DELAY], 0)),
        ),
        maxGroupActive: Math.max(0, toInt(moduleAttributes[ATTRIBUTE_MAX_GROUP_ACTIVE], 0)),
        weaponFamily: null,
        attributeOverrides: {
          ...moduleAttributes,
        },
        commandBurstSnapshot: {
          family: definition.family,
          sourceFxGuid: definition.sourceFxGuid,
          targetFxGuid: definition.targetFxGuid,
          rangeMeters: Math.max(0, round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_MAX_RANGE], 0))),
          durationMs: Math.max(1, round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_DURATION], 0))),
          buffDurationMs: Math.max(
            1,
            round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_BUFF_DURATION], 0)),
          ),
          reloadTimeMs: Math.max(0, round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_RELOAD_TIME], 0))),
          collectionValues,
          moduleAttributes,
        },
      },
      effectStatePatch: {
        commandBurstEffect: true,
        commandBurstFamily: definition.family,
        commandBurstSourceFxGuid: definition.sourceFxGuid,
        commandBurstTargetFxGuid: definition.targetFxGuid,
        commandBurstRangeMeters: Math.max(
          0,
          round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_MAX_RANGE], 0)),
        ),
        commandBurstBuffDurationMs: Math.max(
          1,
          round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_BUFF_DURATION], 0)),
        ),
        commandBurstReloadTimeMs: Math.max(
          0,
          round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_RELOAD_TIME], 0)),
        ),
        commandBurstDbuffValues: collectionValues,
        suppressStartSpecialFx: true,
        suppressStopSpecialFx: true,
      },
    },
  };
}

function refreshCommandBurstStaticData() {
  cachedStaticDirectoryPath = null;
  cachedDbuffCollectionsByID = null;
  return getDbuffCollectionsByID();
}

module.exports = {
  isCommandBurstEffectRecord,
  resolveCommandBurstDefinition,
  resolveCommandBurstActivation,
  resolveCommandBurstRecipients,
  applyTimedCommandBurstToEntity,
  pruneExpiredCommandBursts,
  buildClientDbuffStateEntries,
  collectModifierEntriesForItem,
  refreshCommandBurstStaticData,
  _testing: {
    createAggregator,
    getDbuffCollectionsByID,
    buildCollectionValuesFromAttributes,
    buildCommandBurstStateSignature,
    moduleRequiresSkillType,
    getSurfaceDistance,
    resolveEntityCharacterID,
    resolveBurstAffinityGroupID,
    cloneVector,
  },
};
