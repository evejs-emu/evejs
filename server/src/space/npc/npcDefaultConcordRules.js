const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const worldData = require(path.join(__dirname, "../worldData"));
const {
  EVERMORE_CUSTOMS_SPAWN_GROUP_ID,
  EVERMORE_GATE_STARTUP_RULE_PREFIX,
  isEverMoreGatePresenceSystem,
} = require(path.join(__dirname, "../empireGatePresence/everMoreGatePresence"));

const DEFAULT_GATE_RULE_PREFIX = "default_concord_gate_presence_";
const DEFAULT_STATION_RULE_PREFIX = "default_concord_station_presence_";
const DEFAULT_GATE_RESPAWN_DELAY_MS = 15_000;
const DEFAULT_STATION_RESPAWN_DELAY_MS = 15_000;

let cachedSignature = "";
let cachedRules = [];

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function toDisplayedSecurity(system) {
  const rawSecurity = Math.max(
    0,
    Math.min(1, Number(system && system.security) || 0),
  );
  return Math.round(rawSecurity * 10) / 10;
}

function buildRuleSystemIDs(rule) {
  const systemIDs = Array.isArray(rule && rule.systemIDs)
    ? rule.systemIDs.map((value) => toPositiveInt(value, 0)).filter((value) => value > 0)
    : [];
  const fallbackSystemID = toPositiveInt(rule && rule.systemID, 0);
  if (fallbackSystemID > 0 && !systemIDs.includes(fallbackSystemID)) {
    systemIDs.push(fallbackSystemID);
  }
  return systemIDs;
}

function collectAuthoredCoverage(authoredRules) {
  const gateCoveredSystems = new Set();
  const stationCoveredSystems = new Set();

  if (config.npcAuthoredStartupEnabled !== true) {
    return {
      gateCoveredSystems,
      stationCoveredSystems,
    };
  }

  for (const rule of Array.isArray(authoredRules) ? authoredRules : []) {
    if (!rule || rule.enabled === false) {
      continue;
    }
    if (String(rule && rule.entityType || "").trim().toLowerCase() !== "concord") {
      continue;
    }

    const selectorKind = String(
      rule && rule.anchorSelector && rule.anchorSelector.kind || "",
    ).trim().toLowerCase();
    const systemIDs = buildRuleSystemIDs(rule);
    if (selectorKind === "stargate") {
      for (const systemID of systemIDs) {
        gateCoveredSystems.add(systemID);
      }
    } else if (selectorKind === "station") {
      for (const systemID of systemIDs) {
        stationCoveredSystems.add(systemID);
      }
    }
  }

  return {
    gateCoveredSystems,
    stationCoveredSystems,
  };
}

function getGateGroupsPerAnchor(displayedSecurity) {
  if (displayedSecurity >= 1.0) {
    return 3;
  }
  if (displayedSecurity >= 0.9) {
    return 2;
  }
  if (displayedSecurity >= 0.8) {
    return 2;
  }
  return 1;
}

function getStationGroupsPerAnchor(displayedSecurity) {
  if (displayedSecurity >= 1.0) {
    return 2;
  }
  if (displayedSecurity >= 0.9) {
    return 1;
  }
  return 0;
}

function buildGateBehaviorOverrides() {
  if (config.npcDefaultConcordGateAutoAggroNpcsEnabled === true) {
    return {
      autoAggro: true,
      autoAggroTargetClasses: ["npc"],
      autoActivateWeapons: true,
      allowPodKill: false,
      returnToHomeWhenIdle: true,
      idleAnchorOrbit: true,
    };
  }

  return {
    autoAggro: false,
    targetPreference: "none",
    autoActivateWeapons: false,
    allowPodKill: false,
    returnToHomeWhenIdle: true,
    idleAnchorOrbit: true,
  };
}

function buildEverMoreGateRule(systemID, displayedSecurity) {
  return {
    startupRuleID: `${EVERMORE_GATE_STARTUP_RULE_PREFIX}${systemID}`,
    name: `EverMore Gate Presence ${systemID}`,
    description:
      "Config-generated TQ-style EverMore/Villore Sec Ops gate presence for Jita-style high-security stargates.",
    aliases: ["jita evermore gate presence", "evermore customs"],
    enabled: true,
    systemIDs: [systemID],
    entityType: "concord",
    transient: true,
    operatorKind: "gateConcord",
    spawnGroupID: EVERMORE_CUSTOMS_SPAWN_GROUP_ID,
    exactEverMoreGatePresence: true,
    respawnEnabled: true,
    respawnDelayMs: DEFAULT_GATE_RESPAWN_DELAY_MS,
    behaviorOverrides: {
      autoAggro: false,
      targetPreference: "none",
      autoActivateWeapons: false,
      allowPodKill: false,
      returnToHomeWhenIdle: false,
      idleAnchorOrbit: false,
    },
    anchorSelector: {
      kind: "stargate",
      mode: "each",
    },
    groupsPerAnchor: 1,
    generatedByConfig: true,
    generatedConfigKind: "defaultEverMoreGate",
    displayedSecurity,
  };
}

function buildGateRule(systemID, displayedSecurity) {
  return {
    startupRuleID: `${DEFAULT_GATE_RULE_PREFIX}${systemID}`,
    name: `Default CONCORD Gate Presence ${systemID}`,
    description:
      "Config-generated default CONCORD gate checkpoint coverage for this high-security system.",
    aliases: [],
    enabled: true,
    systemIDs: [systemID],
    entityType: "concord",
    transient: true,
    operatorKind: "gateConcord",
    spawnGroupID: "concord_gate_checkpoint",
    respawnEnabled: true,
    respawnDelayMs: DEFAULT_GATE_RESPAWN_DELAY_MS,
    behaviorOverrides: buildGateBehaviorOverrides(),
    anchorSelector: {
      kind: "stargate",
      mode: "each",
      distanceFromSurfaceMeters: 25_000,
      spreadMeters: 6_000,
      formationSpacingMeters: 2_200,
    },
    groupsPerAnchor: getGateGroupsPerAnchor(displayedSecurity),
    generatedByConfig: true,
    generatedConfigKind: "defaultConcordGate",
    displayedSecurity,
  };
}

function buildStationRule(systemID, displayedSecurity) {
  return {
    startupRuleID: `${DEFAULT_STATION_RULE_PREFIX}${systemID}`,
    name: `Default CONCORD Station Presence ${systemID}`,
    description:
      "Config-generated default CONCORD station police screens for high-visibility high-security systems.",
    aliases: [],
    enabled: true,
    systemIDs: [systemID],
    entityType: "concord",
    transient: true,
    operatorKind: "concordStationPresence",
    spawnGroupID: "concord_police_screen",
    respawnEnabled: true,
    respawnDelayMs: DEFAULT_STATION_RESPAWN_DELAY_MS,
    behaviorOverrides: {
      autoAggro: false,
      targetPreference: "none",
      autoActivateWeapons: false,
      allowPodKill: false,
      returnToHomeWhenIdle: true,
      idleAnchorOrbit: true,
    },
    anchorSelector: {
      kind: "station",
      mode: "each",
      distanceFromSurfaceMeters: 18_000,
      spreadMeters: 4_000,
      formationSpacingMeters: 1_800,
    },
    groupsPerAnchor: getStationGroupsPerAnchor(displayedSecurity),
    generatedByConfig: true,
    generatedConfigKind: "defaultConcordStation",
    displayedSecurity,
  };
}

function buildSignature(authoredRules) {
  const ruleSignature = (Array.isArray(authoredRules) ? authoredRules : [])
    .map((rule) => {
      const systemIDs = buildRuleSystemIDs(rule).join(",");
      const selectorKind = String(
        rule && rule.anchorSelector && rule.anchorSelector.kind || "",
      ).trim().toLowerCase();
      return [
        String(rule && rule.startupRuleID || "").trim(),
        String(rule && rule.entityType || "").trim().toLowerCase(),
        String(rule && rule.operatorKind || "").trim(),
        selectorKind,
        systemIDs,
      ].join(":");
    })
    .sort()
    .join("|");

  return JSON.stringify({
    startupEnabled: config.npcDefaultConcordStartupEnabled === true,
    gateAutoAggroNpcsEnabled:
      config.npcDefaultConcordGateAutoAggroNpcsEnabled === true,
    stationScreensEnabled: config.npcDefaultConcordStationScreensEnabled !== false,
    everMoreGatePresenceEnabled:
      config.npcDefaultEverMoreGatePresenceEnabled === true,
    everMoreGatePresenceSystemIDs:
      String(config.npcDefaultEverMoreGatePresenceSystemIDs || "").trim(),
    rules: ruleSignature,
  });
}

function buildConfiguredConcordStartupRules(authoredRules = []) {
  if (config.npcDefaultConcordStartupEnabled !== true) {
    cachedSignature = "";
    cachedRules = [];
    return [];
  }

  const signature = buildSignature(authoredRules);
  if (signature === cachedSignature) {
    return cachedRules.map((rule) => cloneValue(rule));
  }

  const { gateCoveredSystems, stationCoveredSystems } = collectAuthoredCoverage(
    authoredRules,
  );
  const generatedRules = [];
  for (const system of worldData.getSolarSystems()) {
    const systemID = toPositiveInt(system && system.solarSystemID, 0);
    const displayedSecurity = toDisplayedSecurity(system);
    if (!systemID || displayedSecurity < 0.5) {
      continue;
    }

    const stargates = worldData.getStargatesForSystem(systemID);
    if (stargates.length > 0 && !gateCoveredSystems.has(systemID)) {
      if (isEverMoreGatePresenceSystem(systemID, config)) {
        generatedRules.push(buildEverMoreGateRule(systemID, displayedSecurity));
      } else {
        generatedRules.push(buildGateRule(systemID, displayedSecurity));
      }
    }

    if (config.npcDefaultConcordStationScreensEnabled === false) {
      continue;
    }

    const stationGroupsPerAnchor = getStationGroupsPerAnchor(displayedSecurity);
    const stations = worldData.getStationsForSystem(systemID);
    if (
      stationGroupsPerAnchor > 0 &&
      stations.length > 0 &&
      !stationCoveredSystems.has(systemID)
    ) {
      generatedRules.push(buildStationRule(systemID, displayedSecurity));
    }
  }

  cachedSignature = signature;
  cachedRules = generatedRules.map((rule) => cloneValue(rule));
  return generatedRules;
}

module.exports = {
  DEFAULT_GATE_RULE_PREFIX,
  DEFAULT_STATION_RULE_PREFIX,
  buildConfiguredConcordStartupRules,
};
