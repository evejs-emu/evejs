const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));

const NPC_CONTROL_STATE_TABLE = "npcControlState";

const GATE_OPERATOR_KIND = Object.freeze({
  CONCORD: "gateConcord",
  RATS: "gateRats",
});

const DEFAULT_GATE_CONCORD_SPAWN_GROUP_ID = "concord_gate_checkpoint";
const DEFAULT_GATE_RAT_SPAWN_GROUP_ID = "blood_raider_gate_ambush";
const DEFAULT_GATE_CONCORD_RESPAWN_DELAY_MS = 15_000;
const DEFAULT_GATE_RAT_RESPAWN_DELAY_MS = 25_000;
const runtimeSystemGateControls = new Map();

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

function normalizeString(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeTargetClassList(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\s|]+/g)
      : [];
  const allowed = new Set(["player", "npc", "concord"]);
  return [...new Set(
    source
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter((entry) => allowed.has(entry)),
  )];
}

function normalizeStartupRuleOverride(override) {
  if (!override || typeof override !== "object") {
    return {};
  }

  const normalized = {};
  if (override.enabled !== undefined) {
    normalized.enabled = override.enabled === true;
  }
  return normalized;
}

function normalizeCharacterFlags(flags) {
  return {
    invulnerable: Boolean(flags && flags.invulnerable === true),
  };
}

function normalizeSystemGateControl(systemID, control = {}) {
  const source = control && typeof control === "object" ? control : {};
  return {
    systemID: toPositiveInt(systemID, 0),
    gateConcordEnabled: source.gateConcordEnabled === true,
    gateConcordSpawnGroupID: normalizeString(
      source.gateConcordSpawnGroupID,
      DEFAULT_GATE_CONCORD_SPAWN_GROUP_ID,
    ),
    gateConcordRespawnEnabled: source.gateConcordRespawnEnabled !== false,
    gateConcordRespawnDelayMs: Math.max(
      1_000,
      toFiniteNumber(
        source.gateConcordRespawnDelayMs,
        DEFAULT_GATE_CONCORD_RESPAWN_DELAY_MS,
      ),
    ),
    gateRatEnabled: source.gateRatEnabled === true,
    gateRatSpawnGroupID: normalizeString(
      source.gateRatSpawnGroupID,
      DEFAULT_GATE_RAT_SPAWN_GROUP_ID,
    ),
    gateRatRespawnEnabled: source.gateRatRespawnEnabled !== false,
    gateRatRespawnDelayMs: Math.max(
      1_000,
      toFiniteNumber(
        source.gateRatRespawnDelayMs,
        DEFAULT_GATE_RAT_RESPAWN_DELAY_MS,
      ),
    ),
  };
}

function normalizeControlState(state) {
  const source = state && typeof state === "object" ? state : {};
  const startupRuleOverrides = {};
  const characterFlags = {};
  const systemGateControls = {};

  const rawOverrides =
    source.startupRuleOverrides && typeof source.startupRuleOverrides === "object"
      ? source.startupRuleOverrides
      : {};
  for (const [ruleID, rawOverride] of Object.entries(rawOverrides)) {
    const normalizedRuleID = normalizeString(ruleID);
    if (!normalizedRuleID) {
      continue;
    }
    const normalizedOverride = normalizeStartupRuleOverride(rawOverride);
    if (Object.keys(normalizedOverride).length > 0) {
      startupRuleOverrides[normalizedRuleID] = normalizedOverride;
    }
  }

  const rawCharacterFlags =
    source.characterFlags && typeof source.characterFlags === "object"
      ? source.characterFlags
      : {};
  for (const [characterID, rawFlags] of Object.entries(rawCharacterFlags)) {
    const normalizedCharacterID = toPositiveInt(characterID, 0);
    if (!normalizedCharacterID) {
      continue;
    }
    const normalizedFlags = normalizeCharacterFlags(rawFlags);
    if (normalizedFlags.invulnerable) {
      characterFlags[String(normalizedCharacterID)] = normalizedFlags;
    }
  }

  return {
    startupRuleOverrides,
    characterFlags,
    systemGateControls,
  };
}

function readNpcControlState() {
  const result = database.read(NPC_CONTROL_STATE_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return normalizeControlState({});
  }
  return normalizeControlState(result.data);
}

function writeNpcControlState(nextState) {
  return database.write(
    NPC_CONTROL_STATE_TABLE,
    "/",
    normalizeControlState(nextState),
  );
}

function getStartupRuleOverride(startupRuleID) {
  const normalizedStartupRuleID = normalizeString(startupRuleID);
  if (!normalizedStartupRuleID) {
    return {};
  }

  const state = readNpcControlState();
  return cloneValue(state.startupRuleOverrides[normalizedStartupRuleID] || {});
}

function setStartupRuleEnabledOverride(startupRuleID, enabled) {
  const normalizedStartupRuleID = normalizeString(startupRuleID);
  if (!normalizedStartupRuleID) {
    return {
      success: false,
      errorMsg: "STARTUP_RULE_REQUIRED",
    };
  }

  const state = readNpcControlState();
  state.startupRuleOverrides[normalizedStartupRuleID] = {
    ...state.startupRuleOverrides[normalizedStartupRuleID],
    enabled: enabled === true,
  };

  const writeResult = writeNpcControlState(state);
  if (!writeResult || !writeResult.success) {
    return {
      success: false,
      errorMsg: writeResult && writeResult.errorMsg
        ? writeResult.errorMsg
        : "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: cloneValue(state.startupRuleOverrides[normalizedStartupRuleID]),
  };
}

function getCharacterFlags(characterID) {
  const normalizedCharacterID = toPositiveInt(characterID, 0);
  if (!normalizedCharacterID) {
    return normalizeCharacterFlags(null);
  }

  const state = readNpcControlState();
  return normalizeCharacterFlags(
    state.characterFlags[String(normalizedCharacterID)] || null,
  );
}

function isCharacterInvulnerable(characterID) {
  return getCharacterFlags(characterID).invulnerable === true;
}

function setCharacterInvulnerability(characterID, enabled) {
  const normalizedCharacterID = toPositiveInt(characterID, 0);
  if (!normalizedCharacterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const state = readNpcControlState();
  const key = String(normalizedCharacterID);
  const nextEnabled = enabled === true;
  if (nextEnabled) {
    state.characterFlags[key] = {
      ...normalizeCharacterFlags(state.characterFlags[key]),
      invulnerable: true,
    };
  } else {
    delete state.characterFlags[key];
  }

  const writeResult = writeNpcControlState(state);
  if (!writeResult || !writeResult.success) {
    return {
      success: false,
      errorMsg: writeResult && writeResult.errorMsg
        ? writeResult.errorMsg
        : "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: {
      characterID: normalizedCharacterID,
      invulnerable: nextEnabled,
    },
  };
}

function toggleCharacterInvulnerability(characterID) {
  const nextEnabled = !isCharacterInvulnerable(characterID);
  return setCharacterInvulnerability(characterID, nextEnabled);
}

function getSystemGateControl(systemID) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  if (!normalizedSystemID) {
    return normalizeSystemGateControl(0, null);
  }
  return normalizeSystemGateControl(
    normalizedSystemID,
    runtimeSystemGateControls.get(String(normalizedSystemID)) || null,
  );
}

function setSystemGateControl(systemID, updates = {}) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  if (!normalizedSystemID) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const key = String(normalizedSystemID);
  const merged = normalizeSystemGateControl(
    normalizedSystemID,
    {
      ...runtimeSystemGateControls.get(key),
      ...updates,
    },
  );

  if (!merged.gateConcordEnabled && !merged.gateRatEnabled) {
    runtimeSystemGateControls.delete(key);
  } else {
    runtimeSystemGateControls.set(key, merged);
  }

  return {
    success: true,
    data: cloneValue(merged),
  };
}

function clearRuntimeGateControls() {
  runtimeSystemGateControls.clear();
  return {
    success: true,
  };
}

function buildDynamicGateStartupRule(systemID, operatorKind) {
  const control = getSystemGateControl(systemID);
  const normalizedSystemID = toPositiveInt(systemID, 0);
  if (!normalizedSystemID) {
    return null;
  }

  if (operatorKind === GATE_OPERATOR_KIND.CONCORD && control.gateConcordEnabled) {
    return {
      startupRuleID: `dynamic_gate_concord_${normalizedSystemID}`,
      name: `Dynamic Gate CONCORD ${normalizedSystemID}`,
      description: "Operator-enabled CONCORD gate coverage for the current system.",
      aliases: [],
      enabled: true,
      systemIDs: [normalizedSystemID],
      entityType: "concord",
      transient: true,
      operatorKind: GATE_OPERATOR_KIND.CONCORD,
      spawnGroupID: control.gateConcordSpawnGroupID,
      respawnEnabled: control.gateConcordRespawnEnabled !== false,
      respawnDelayMs: control.gateConcordRespawnDelayMs,
      behaviorOverrides: {
        autoAggro: true,
        autoAggroTargetClasses: ["npc"],
        allowPodKill: false,
        returnToHomeWhenIdle: true,
        idleAnchorOrbit: true,
      },
      anchorSelector: {
        kind: "stargate",
        mode: "each",
        distanceFromSurfaceMeters: 25_000,
        spreadMeters: 6_000,
        formationSpacingMeters: 2_200,
      },
      groupsPerAnchor: 1,
      dynamicRule: true,
    };
  }

  if (operatorKind === GATE_OPERATOR_KIND.RATS && control.gateRatEnabled) {
    return {
      startupRuleID: `dynamic_gate_rats_${normalizedSystemID}`,
      name: `Dynamic Gate Rats ${normalizedSystemID}`,
      description: "Operator-enabled pirate gate patrols for the current system.",
      aliases: [],
      enabled: true,
      systemIDs: [normalizedSystemID],
      entityType: "npc",
      operatorKind: GATE_OPERATOR_KIND.RATS,
      spawnGroupID: control.gateRatSpawnGroupID,
      respawnEnabled: control.gateRatRespawnEnabled !== false,
      respawnDelayMs: control.gateRatRespawnDelayMs,
      behaviorOverrides: {
        autoAggro: true,
        autoAggroTargetClasses: ["player"],
        allowPodKill: false,
      },
      anchorSelector: {
        kind: "stargate",
        mode: "each",
        distanceFromSurfaceMeters: 22_000,
        spreadMeters: 7_000,
        formationSpacingMeters: 2_000,
      },
      groupsPerAnchor: 1,
      dynamicRule: true,
    };
  }

  return null;
}

function listDynamicStartupRulesForSystem(systemID) {
  return [
    buildDynamicGateStartupRule(systemID, GATE_OPERATOR_KIND.CONCORD),
    buildDynamicGateStartupRule(systemID, GATE_OPERATOR_KIND.RATS),
  ].filter(Boolean);
}

function getDynamicGateStartupRuleID(systemID, operatorKind) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  if (!normalizedSystemID) {
    return null;
  }

  if (operatorKind === GATE_OPERATOR_KIND.CONCORD) {
    return `dynamic_gate_concord_${normalizedSystemID}`;
  }
  if (operatorKind === GATE_OPERATOR_KIND.RATS) {
    return `dynamic_gate_rats_${normalizedSystemID}`;
  }
  return null;
}

module.exports = {
  NPC_CONTROL_STATE_TABLE,
  GATE_OPERATOR_KIND,
  normalizeTargetClassList,
  readNpcControlState,
  getStartupRuleOverride,
  setStartupRuleEnabledOverride,
  getCharacterFlags,
  isCharacterInvulnerable,
  setCharacterInvulnerability,
  toggleCharacterInvulnerability,
  getSystemGateControl,
  setSystemGateControl,
  clearRuntimeGateControls,
  buildDynamicGateStartupRule,
  listDynamicStartupRulesForSystem,
  getDynamicGateStartupRuleID,
};
