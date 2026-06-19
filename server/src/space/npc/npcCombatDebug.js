const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const rotatingLog = require(path.join(__dirname, "../../utils/rotatingLog"));

const NPC_COMBAT_DEBUG_PATH = path.join(
  __dirname,
  "../../../logs/space-npc-combat-debug.log",
);

function toInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundNumber(value, digits = 6) {
  return Number(toFiniteNumber(value, 0).toFixed(digits));
}

function normalizeTraceValue(value, depth = 0) {
  if (depth >= 6) {
    return "[depth-limit]";
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? roundNumber(value, Number.isInteger(value) ? 0 : 6)
      : String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeTraceValue(entry, depth + 1));
  }
  if (value instanceof Map) {
    return normalizeTraceValue([...value.entries()], depth + 1);
  }
  if (value instanceof Set) {
    return normalizeTraceValue([...value.values()], depth + 1);
  }
  if (typeof value === "object") {
    const normalized = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "function") {
        continue;
      }
      normalized[key] = normalizeTraceValue(entry, depth + 1);
    }
    return normalized;
  }
  return String(value);
}

function appendNpcCombatDebug(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    rotatingLog.append(NPC_COMBAT_DEBUG_PATH, `[${new Date().toISOString()}] ${entry}\n`);
  } catch (error) {
    log.warn(`[NpcCombatDebug] Failed to write npc combat debug log: ${error.message}`);
  }
}

function isNpcCombatDebugEnabled() {
  return log.isVerboseDebugEnabled();
}

function logNpcCombatDebug(event, details = {}) {
  if (!isNpcCombatDebugEnabled()) {
    return;
  }
  const resolvedDetails = typeof details === "function" ? details() : details;
  appendNpcCombatDebug(JSON.stringify(normalizeTraceValue({
    event,
    atMs: Date.now(),
    ...resolvedDetails,
  })));
}

function summarizeNpcCombatEntity(entity) {
  if (!entity || typeof entity !== "object") {
    return null;
  }
  return {
    itemID: toInt(entity.itemID, 0),
    typeID: toInt(entity.typeID, 0),
    groupID: toInt(entity.groupID, 0),
    categoryID: toInt(entity.categoryID, 0),
    itemName: typeof entity.itemName === "string"
      ? entity.itemName
      : (typeof entity.slimName === "string" ? entity.slimName : null),
    kind: typeof entity.kind === "string" ? entity.kind : null,
    nativeNpc: entity.nativeNpc === true,
    npcEntityType: typeof entity.npcEntityType === "string" ? entity.npcEntityType : null,
    mode: typeof entity.mode === "string" ? entity.mode : null,
    targetEntityID: toInt(entity.targetEntityID, 0),
    bubbleID: toInt(entity.bubbleID, 0),
    speedFraction: roundNumber(toFiniteNumber(entity.speedFraction, 0), 6),
    activeModuleIDs:
      entity.activeModuleEffects instanceof Map
        ? [...entity.activeModuleEffects.keys()].map((moduleID) => toInt(moduleID, 0))
        : [],
  };
}

function summarizeNpcCombatModule(moduleItem) {
  if (!moduleItem || typeof moduleItem !== "object") {
    return null;
  }
  return {
    itemID: toInt(moduleItem.itemID, 0),
    typeID: toInt(moduleItem.typeID, 0),
    groupID: toInt(moduleItem.groupID, 0),
    categoryID: toInt(moduleItem.categoryID, 0),
    flagID: toInt(moduleItem.flagID, 0),
    quantity: Math.max(0, toInt(moduleItem.quantity, 0)),
    moduleID: toInt(moduleItem.moduleID, toInt(moduleItem.itemID, 0)),
    itemName: typeof moduleItem.itemName === "string" ? moduleItem.itemName : null,
  };
}

function summarizeNpcCombatCargo(cargoRecord) {
  if (!cargoRecord || typeof cargoRecord !== "object") {
    return null;
  }
  return {
    cargoID: toInt(cargoRecord.cargoID, 0),
    entityID: toInt(cargoRecord.entityID, 0),
    ownerID: toInt(cargoRecord.ownerID, 0),
    moduleID: toInt(cargoRecord.moduleID, 0),
    typeID: toInt(cargoRecord.typeID, 0),
    groupID: toInt(cargoRecord.groupID, 0),
    categoryID: toInt(cargoRecord.categoryID, 0),
    quantity: Math.max(0, toInt(cargoRecord.quantity, 0)),
    singleton: cargoRecord.singleton === true,
    itemName: typeof cargoRecord.itemName === "string" ? cargoRecord.itemName : null,
  };
}

module.exports = {
  NPC_COMBAT_DEBUG_PATH,
  isNpcCombatDebugEnabled,
  normalizeTraceValue,
  logNpcCombatDebug,
  summarizeNpcCombatEntity,
  summarizeNpcCombatModule,
  summarizeNpcCombatCargo,
};
