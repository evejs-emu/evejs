const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const worldData = require(path.join(__dirname, "../worldData"));
const spaceRuntime = require(path.join(__dirname, "../runtime"));
const wormholeAuthority = require(path.join(
  __dirname,
  "../../services/exploration/wormholes/wormholeAuthority",
));
const {
  buildNpcDefinition,
  listNpcProfiles,
  listNpcSpawnPools,
  listNpcSpawnGroups,
  listNpcSpawnSites,
  listNpcStartupRules,
  resolveNpcProfile,
  resolveNpcSpawnSite,
} = require(path.join(__dirname, "./npcData"));
const {
  resolveNpcSpawnPlan,
  resolveNpcSpawnGroupPlan,
} = require(path.join(__dirname, "./npcSelection"));
const {
  getControllerByEntityID,
  listControllers,
  listControllersBySystem,
} = require(path.join(__dirname, "./npcRegistry"));
const {
  tickScene: tickBehaviorScene,
  issueManualOrder,
  setBehaviorOverrides,
  normalizeBehaviorOverrides,
  noteIncomingAggression,
} = require(path.join(__dirname, "./npcBehaviorLoop"));
const {
  GATE_OPERATOR_KIND,
  getStartupRuleOverride,
  setStartupRuleEnabledOverride,
  getSystemGateControl,
  setSystemGateControl,
  toggleCharacterInvulnerability,
  setCharacterInvulnerability,
  isCharacterInvulnerable,
  listDynamicStartupRulesForSystem,
  getDynamicGateStartupRuleID,
} = require(path.join(__dirname, "./npcControlState"));
const {
  toFiniteNumber,
  toPositiveInt,
  cloneVector,
  normalizeVector,
  resolveAnchors,
  resolveAnchor,
} = require(path.join(__dirname, "./npcAnchors"));
const nativeNpcService = require(path.join(__dirname, "./nativeNpcService"));
const {
  parseNpcCustomInfo,
  cleanupLegacySyntheticNpcShips,
  destroyLegacySyntheticNpcController,
} = require(path.join(__dirname, "./legacySyntheticNpcCleanup"));
const nativeNpcStore = require(path.join(__dirname, "./nativeNpcStore"));
const {
  isAmbientStartupRuleVirtualizable,
} = require(path.join(__dirname, "./npcAmbientMaterialization"));
const {
  isCombatStartupRuleDormancyEligible,
} = require(path.join(__dirname, "./npcCombatDormancy"));
const {
  getEverMoreGateCustomsExpectedCount,
  getEverMoreGateCustomsLayout,
} = require(path.join(__dirname, "../empireGatePresence/everMoreGatePresence"));

const DRIFTER_FACTION_ID = 500024;

function resolveProfileDefinition(query, fallbackProfileID) {
  const profileResolution = resolveNpcProfile(query, fallbackProfileID);
  if (!profileResolution.success || !profileResolution.data) {
    return {
      success: false,
      errorMsg: profileResolution.errorMsg || "NPC_PROFILE_NOT_FOUND",
      suggestions: profileResolution.suggestions || [],
    };
  }

  const definition = buildNpcDefinition(profileResolution.data.profileID);
  if (!definition) {
    return {
      success: false,
      errorMsg: "NPC_DEFINITION_INCOMPLETE",
      suggestions: [],
    };
  }

  return {
    success: true,
    data: definition,
    suggestions: [],
  };
}

function resolveSpawnContextForSession(session) {
  if (!session || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const systemID = toPositiveInt(session._space.systemID, 0);
  const anchorEntity = spaceRuntime.getEntity(session, session._space.shipID);
  if (!systemID || !anchorEntity) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  return {
    success: true,
    data: {
      systemID,
      scene: spaceRuntime.ensureScene(systemID),
      anchorEntity,
      preferredTargetID: toPositiveInt(session._space.shipID, 0),
      anchorKind: String(anchorEntity.kind || "ship"),
      anchorLabel: String(anchorEntity.itemName || anchorEntity.slimName || "Ship"),
      contextKind: "sessionShip",
    },
  };
}

function resolveSpawnContextForSystem(systemID, options = {}) {
  const numericSystemID = toPositiveInt(systemID, 0);
  if (!numericSystemID) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const anchorEntity = options.anchorEntity || null;
  if (anchorEntity && anchorEntity.position) {
    return {
      success: true,
      data: {
        systemID: numericSystemID,
        scene: spaceRuntime.ensureScene(numericSystemID),
        anchorEntity,
        preferredTargetID: toPositiveInt(options.preferredTargetID, 0),
        anchorKind: String(anchorEntity.kind || "custom"),
        anchorLabel: String(anchorEntity.itemName || anchorEntity.slimName || "Anchor"),
        contextKind: "systemAnchor",
      },
    };
  }

  const anchorDescriptor =
    options.anchorDescriptor ||
    (
      options.position
        ? {
            kind: "coordinates",
            position: options.position,
            direction: options.direction,
            radius: options.radius,
            name: options.anchorName,
          }
        : null
    );
  if (!anchorDescriptor) {
    return {
      success: false,
      errorMsg: "ANCHOR_REQUIRED",
    };
  }

  const anchorResult = resolveAnchor(numericSystemID, anchorDescriptor);
  if (!anchorResult.success || !anchorResult.data) {
    return anchorResult;
  }

  return {
    success: true,
    data: {
      systemID: numericSystemID,
      scene: anchorResult.data.scene,
      anchorEntity: anchorResult.data.anchor,
      preferredTargetID: toPositiveInt(options.preferredTargetID, 0),
      anchorKind: String(anchorResult.data.anchor.kind || anchorDescriptor.kind || "anchor"),
      anchorLabel: String(
        anchorResult.data.anchor.itemName ||
          anchorDescriptor.name ||
          anchorDescriptor.nameQuery ||
          "Anchor"
      ),
      contextKind: "systemAnchor",
    },
  };
}

function resolveBatchSelection(options = {}) {
  return resolveNpcSpawnPlan(options.profileQuery, {
    amount: Math.max(1, toPositiveInt(options.amount, 1)),
    defaultPoolID: String(options.defaultPoolID || "npc_hostiles"),
    fallbackProfileID: String(options.fallbackProfileID || "generic_hostile"),
    entityType: String(options.entityType || "npc"),
    preferPools: options.preferPools !== false,
    requiredWeaponFamily: String(options.requiredWeaponFamily || ""),
  });
}

function shouldUseRuntimeOnlyNpcSpawn(options = {}) {
  if (options.transient === true) {
    return true;
  }
  if (options.transient === false) {
    return false;
  }
  return true;
}

function normalizeNpcSpawnOptions(options = {}) {
  const transient = shouldUseRuntimeOnlyNpcSpawn(options);
  if (options.transient === transient) {
    return options;
  }
  return {
    ...options,
    transient,
  };
}

function spawnNpcBatchForSession(session, options = {}) {
  const spawnOptions = normalizeNpcSpawnOptions(options);
  const contextResult = resolveSpawnContextForSession(session);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const selectionResult = resolveBatchSelection(spawnOptions);
  if (!selectionResult.success || !selectionResult.data) {
    return selectionResult;
  }

  const scene = contextResult.data.scene;
  const batchResult = nativeNpcService.spawnNativeDefinitionsInContext(contextResult.data, selectionResult, {
    ...spawnOptions,
    runtimeKind: String(spawnOptions.runtimeKind || "nativeCombat"),
    skipInitialBehaviorTick:
      spawnOptions.skipInitialBehaviorTick === true
        ? true
        : spawnOptions.skipInitialBehaviorTick === false
          ? false
          : true,
    preferredTargetID: toPositiveInt(
      spawnOptions.preferredTargetID,
      toPositiveInt(session && session._space && session._space.shipID, 0),
    ),
    anchorKind: contextResult.data.anchorKind,
    anchorName: contextResult.data.anchorLabel,
    anchorID: toPositiveInt(contextResult.data.anchorEntity && contextResult.data.anchorEntity.itemID, 0),
  });
  if (
    batchResult &&
    batchResult.success &&
    batchResult.data &&
    Array.isArray(batchResult.data.spawned) &&
    scene &&
    spawnOptions.skipInitialBehaviorTick !== false
  ) {
    const wakeAtMs = scene.getCurrentSimTimeMs() + Math.max(
      1000,
      toFiniteNumber(scene._tickIntervalMs, 1000),
    );
    for (const entry of batchResult.data.spawned) {
      const entityID = toPositiveInt(entry && entry.entity && entry.entity.itemID, 0);
      if (entityID > 0) {
        scheduleNpcController(entityID, wakeAtMs);
      }
    }
  }
  return batchResult;
}

function spawnNpcBatchInSystem(systemID, options = {}) {
  const spawnOptions = normalizeNpcSpawnOptions(options);
  const contextResult = resolveSpawnContextForSystem(systemID, spawnOptions);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const selectionResult = resolveBatchSelection(spawnOptions);
  if (!selectionResult.success || !selectionResult.data) {
    return selectionResult;
  }

  return nativeNpcService.spawnNativeDefinitionsInContext(contextResult.data, selectionResult, {
    ...spawnOptions,
    runtimeKind: String(spawnOptions.runtimeKind || "nativeCombat"),
    anchorKind: contextResult.data.anchorKind,
    anchorName: contextResult.data.anchorLabel,
    anchorID: toPositiveInt(contextResult.data.anchorEntity && contextResult.data.anchorEntity.itemID, 0),
  });
}

function spawnNpcForSession(session, options = {}) {
  const batchResult = spawnNpcBatchForSession(session, {
    ...options,
    amount: 1,
    entityType: "npc",
    defaultPoolID: options.defaultPoolID || "npc_hostiles",
    fallbackProfileID: options.fallbackProfileID || "generic_hostile",
  });
  if (
    !batchResult.success ||
    !batchResult.data ||
    !Array.isArray(batchResult.data.spawned) ||
    batchResult.data.spawned.length === 0
  ) {
    return batchResult;
  }

  return {
    success: true,
    data: {
      ...batchResult.data.spawned[0],
      selectionKind: batchResult.data.selectionKind,
      selectionID: batchResult.data.selectionID,
      selectionName: batchResult.data.selectionName,
      partialFailure: batchResult.data.partialFailure,
    },
    suggestions: batchResult.suggestions || [],
  };
}

function spawnConcordBatchForSession(session, options = {}) {
  return spawnNpcBatchForSession(session, {
    ...options,
    entityType: "concord",
    defaultPoolID: options.defaultPoolID || "concord_response_fleet",
    fallbackProfileID: options.fallbackProfileID || "concord_response",
    preferPools: true,
  });
}

function spawnConcordForSession(session, options = {}) {
  const batchResult = spawnConcordBatchForSession(session, {
    ...options,
    amount: 1,
  });
  if (
    !batchResult.success ||
    !batchResult.data ||
    !Array.isArray(batchResult.data.spawned) ||
    batchResult.data.spawned.length === 0
  ) {
    return batchResult;
  }

  return {
    success: true,
    data: {
      ...batchResult.data.spawned[0],
      selectionKind: batchResult.data.selectionKind,
      selectionID: batchResult.data.selectionID,
      selectionName: batchResult.data.selectionName,
      partialFailure: batchResult.data.partialFailure,
    },
    suggestions: batchResult.suggestions || [],
  };
}

function spawnNpcGroupInSystem(systemID, options = {}) {
  const spawnOptions = normalizeNpcSpawnOptions(options);
  return nativeNpcService.spawnNativeNpcGroupInSystem(systemID, {
    ...spawnOptions,
    runtimeKind: String(spawnOptions.runtimeKind || "nativeCombat"),
  });
}

function spawnNpcSite(siteQuery, options = {}) {
  const spawnOptions = normalizeNpcSpawnOptions(options);
  const siteResolution = resolveNpcSpawnSite(
    siteQuery,
    String(spawnOptions.fallbackSpawnSiteID || ""),
  );
  if (!siteResolution.success || !siteResolution.data) {
    return siteResolution;
  }

  const site = siteResolution.data;
  const preferredTargetID = toPositiveInt(spawnOptions.preferredTargetID, 0);
  const contextResult = resolveSpawnContextForSystem(site.systemID, {
    ...spawnOptions,
    anchorDescriptor: site.anchor,
    preferredTargetID,
  });
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const groupResult = resolveNpcSpawnGroupPlan(site.spawnGroupID, {
    entityType: String(site.entityType || spawnOptions.entityType || ""),
  });
  if (!groupResult.success || !groupResult.data) {
    return groupResult;
  }

  const sharedSiteSpawnOptions = {
    ...spawnOptions,
    selectionKind: "site",
    selectionID: site.spawnSiteID,
    selectionName: site.name || site.spawnSiteID,
    spawnGroupID: site.spawnGroupID,
    spawnSiteID: site.spawnSiteID,
    entityType: String(site.entityType || spawnOptions.entityType || ""),
    spawnDistanceMeters: toFiniteNumber(site.anchor && site.anchor.spawnDistanceMeters, 0),
    distanceFromSurfaceMeters: toFiniteNumber(
      site.anchor && site.anchor.distanceFromSurfaceMeters,
      0,
    ),
    spreadMeters: toFiniteNumber(site.anchor && site.anchor.spreadMeters, 0),
    formationSpacingMeters: toFiniteNumber(
      site.anchor && site.anchor.formationSpacingMeters,
      0,
    ),
    anchorKind: contextResult.data.anchorKind,
    anchorName: contextResult.data.anchorLabel,
    anchorID: toPositiveInt(contextResult.data.anchorEntity && contextResult.data.anchorEntity.itemID, 0),
  };
  const batchResult = nativeNpcService.spawnNativeDefinitionsInContext(contextResult.data, groupResult, {
    ...sharedSiteSpawnOptions,
    runtimeKind: String(sharedSiteSpawnOptions.runtimeKind || "nativeCombat"),
  });
  if (!batchResult.success || !batchResult.data) {
    return batchResult;
  }

  return {
    success: true,
    data: {
      ...batchResult.data,
      site,
      group: groupResult.data.group || null,
    },
    suggestions: batchResult.suggestions || [],
  };
}

function spawnNpcSiteForSession(session, siteQuery, options = {}) {
  if (!session || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const siteResolution = resolveNpcSpawnSite(
    siteQuery,
    String(options.fallbackSpawnSiteID || ""),
  );
  if (!siteResolution.success || !siteResolution.data) {
    return siteResolution;
  }

  const preferredTargetID =
    toPositiveInt(options.preferredTargetID, 0) ||
    (
      toPositiveInt(session._space.systemID, 0) === toPositiveInt(siteResolution.data.systemID, 0)
        ? toPositiveInt(session._space.shipID, 0)
        : 0
    );
  return spawnNpcSite(siteResolution.data.spawnSiteID, {
    ...options,
    preferredTargetID,
  });
}

function ruleAppliesToSystem(rule, systemID) {
  const numericSystemID = toPositiveInt(systemID, 0);
  if (!numericSystemID || !rule) {
    return false;
  }

  const system = worldData.getSolarSystemByID(numericSystemID);
  const regionIDs = Array.isArray(rule.regionIDs)
    ? rule.regionIDs.map((value) => toPositiveInt(value, 0)).filter((value) => value > 0)
    : [];
  const constellationIDs = Array.isArray(rule.constellationIDs)
    ? rule.constellationIDs.map((value) => toPositiveInt(value, 0)).filter((value) => value > 0)
    : [];
  const wormholeClassIDs = Array.isArray(rule.wormholeClassIDs)
    ? rule.wormholeClassIDs.map((value) => toPositiveInt(value, 0)).filter((value) => value > 0)
    : [];
  const systemIDs = Array.isArray(rule.systemIDs)
    ? rule.systemIDs.map((value) => toPositiveInt(value, 0)).filter((value) => value > 0)
    : [];
  const fallbackSystemID = toPositiveInt(rule.systemID, 0);
  const fallbackRegionID = toPositiveInt(rule.regionID, 0);
  const fallbackConstellationID = toPositiveInt(rule.constellationID, 0);
  const fallbackWormholeClassID = toPositiveInt(rule.wormholeClassID, 0);
  if (
    systemIDs.length === 0 &&
    fallbackSystemID <= 0 &&
    regionIDs.length === 0 &&
    fallbackRegionID <= 0 &&
    constellationIDs.length === 0 &&
    fallbackConstellationID <= 0 &&
    wormholeClassIDs.length === 0 &&
    fallbackWormholeClassID <= 0
  ) {
    return false;
  }

  if (systemIDs.includes(numericSystemID) || fallbackSystemID === numericSystemID) {
    return true;
  }

  const regionID = toPositiveInt(system && system.regionID, 0);
  if (
    regionID > 0 &&
    (
      regionIDs.includes(regionID) ||
      fallbackRegionID === regionID
    )
  ) {
    return true;
  }

  const constellationID = toPositiveInt(system && system.constellationID, 0);
  if (
    constellationID > 0 &&
    (
      constellationIDs.includes(constellationID) ||
      fallbackConstellationID === constellationID
    )
  ) {
    return true;
  }

  const wormholeClassID = wormholeAuthority.getSystemClassID(
    numericSystemID,
    Number(system && system.security),
  );
  if (
    wormholeClassID > 0 &&
    (
      wormholeClassIDs.includes(wormholeClassID) ||
      fallbackWormholeClassID === wormholeClassID
    )
  ) {
    return true;
  }

  return false;
}

function isGeneratedStartupRule(rule) {
  return rule && (
    rule.generatedByConfig === true ||
    rule.generatedByAuthority === true
  );
}

function isGateOperatorStartupRule(rule) {
  const operatorKind = String(rule && rule.operatorKind || "").trim();
  return (
    operatorKind === GATE_OPERATOR_KIND.CONCORD ||
    operatorKind === GATE_OPERATOR_KIND.RATS
  );
}

function getStartupRuleSource(rules = []) {
  const hasGenerated = rules.some((rule) => isGeneratedStartupRule(rule));
  const hasAuthored = rules.some((rule) => !isGeneratedStartupRule(rule));

  if (hasGenerated && !hasAuthored) {
    return "generated";
  }
  if (hasAuthored && !hasGenerated) {
    return "authored";
  }
  return "startup";
}

function isStartupRuleEnabled(rule) {
  if (!rule) {
    return false;
  }

  const override = getStartupRuleOverride(rule.startupRuleID);
  if (override && override.enabled !== undefined) {
    if (
      override.enabled === true &&
      config.npcAuthoredStartupEnabled !== true &&
      isGateOperatorStartupRule(rule)
    ) {
      return false;
    }
    return override.enabled === true;
  }

  if (isGeneratedStartupRule(rule)) {
    return rule.enabled !== false;
  }

  if (config.npcAuthoredStartupEnabled !== true) {
    return false;
  }

  return rule.enabled !== false;
}

function listStartupRulesForSystem(systemID) {
  if (process.env.EVEJS_SKIP_NPC_STARTUP === "1") {
    return [];
  }

  const numericSystemID = toPositiveInt(systemID, 0);
  const startupRules = listNpcStartupRules().filter(
    (rule) => ruleAppliesToSystem(rule, numericSystemID) && isStartupRuleEnabled(rule),
  );
  const dynamicRules = listDynamicStartupRulesForSystem(numericSystemID);
  const dynamicOperatorKinds = new Set(
    dynamicRules
      .filter((rule) => isGateOperatorControlEnabled(numericSystemID, rule && rule.operatorKind))
      .map((rule) => String(rule && rule.operatorKind || "").trim())
      .filter(Boolean),
  );
  const filteredStartupRules = startupRules.filter((rule) => (
    !dynamicOperatorKinds.has(String(rule && rule.operatorKind || "").trim())
  ));
  const startupRuleOperatorKinds = new Set(
    filteredStartupRules
      .map((rule) => String(rule && rule.operatorKind || "").trim())
      .filter(Boolean),
  );
  const filteredDynamicRules = dynamicRules.filter((rule) => (
    dynamicOperatorKinds.has(String(rule && rule.operatorKind || "").trim()) ||
    !startupRuleOperatorKinds.has(String(rule && rule.operatorKind || "").trim())
  ));
  return [
    ...filteredStartupRules,
    ...filteredDynamicRules,
  ];
}

function countExistingStartupControllers(scene, startupRuleID, anchorID) {
  const normalizedSystemID = toPositiveInt(scene && scene.systemID, 0);
  const normalizedStartupRuleID = String(startupRuleID || "").trim();
  const normalizedAnchorID = toPositiveInt(anchorID, 0);
  const matchingEntityIDs = new Set();

  for (const controller of listControllers()) {
    if (
      toPositiveInt(controller && controller.systemID, 0) !== normalizedSystemID ||
      String(controller && controller.startupRuleID || "").trim() !== normalizedStartupRuleID ||
      toPositiveInt(controller && controller.anchorID, 0) !== normalizedAnchorID
    ) {
      continue;
    }
    const entityID = toPositiveInt(controller && controller.entityID, 0);
    if (!entityID) {
      continue;
    }
    if (scene && !scene.getEntityByID(entityID)) {
      continue;
    }
    matchingEntityIDs.add(entityID);
  }

  for (const controllerRecord of nativeNpcStore.listNativeControllersForSystem(normalizedSystemID)) {
    if (
      String(controllerRecord && controllerRecord.startupRuleID || "").trim() !== normalizedStartupRuleID ||
      toPositiveInt(controllerRecord && controllerRecord.anchorID, 0) !== normalizedAnchorID
    ) {
      continue;
    }
    const entityID = toPositiveInt(controllerRecord && controllerRecord.entityID, 0);
    if (entityID > 0) {
      matchingEntityIDs.add(entityID);
    }
  }

  return matchingEntityIDs.size;
}

function isExactEverMoreGatePresenceRule(rule) {
  return rule && rule.exactEverMoreGatePresence === true;
}

function addVectors(left = {}, right = {}) {
  return {
    x: toFiniteNumber(left.x, 0) + toFiniteNumber(right.x, 0),
    y: toFiniteNumber(left.y, 0) + toFiniteNumber(right.y, 0),
    z: toFiniteNumber(left.z, 0) + toFiniteNumber(right.z, 0),
  };
}

function subtractVectors(left = {}, right = {}) {
  return {
    x: toFiniteNumber(left.x, 0) - toFiniteNumber(right.x, 0),
    y: toFiniteNumber(left.y, 0) - toFiniteNumber(right.y, 0),
    z: toFiniteNumber(left.z, 0) - toFiniteNumber(right.z, 0),
  };
}

function collectExistingStartupControllerSlots(scene, startupRuleID, anchorID) {
  const normalizedSystemID = toPositiveInt(scene && scene.systemID, 0);
  const normalizedStartupRuleID = String(startupRuleID || "").trim();
  const normalizedAnchorID = toPositiveInt(anchorID, 0);
  const slots = new Map();
  let unindexedCount = 0;

  const visitController = (controller, options = {}) => {
    if (
      toPositiveInt(controller && controller.systemID, 0) !== normalizedSystemID ||
      String(controller && controller.startupRuleID || "").trim() !== normalizedStartupRuleID ||
      toPositiveInt(controller && controller.anchorID, 0) !== normalizedAnchorID
    ) {
      return;
    }

    const entityID = toPositiveInt(controller && controller.entityID, 0);
    const requireLiveEntity = options.requireLiveEntity !== false;
    if (!entityID || (requireLiveEntity && scene && !scene.getEntityByID(entityID))) {
      return;
    }

    if (
      controller &&
      controller.startupSlotIndex !== undefined &&
      controller.startupSlotIndex !== null
    ) {
      slots.set(Math.max(0, Math.trunc(Number(controller.startupSlotIndex) || 0)), entityID);
      return;
    }
    unindexedCount += 1;
  };

  for (const controller of listControllers()) {
    visitController(controller, {
      requireLiveEntity: true,
    });
  }
  for (const controllerRecord of nativeNpcStore.listNativeControllersForSystem(normalizedSystemID)) {
    visitController(controllerRecord, {
      requireLiveEntity: false,
    });
  }

  return {
    slots,
    unindexedCount,
  };
}

function countMissingExactEverMoreSlots(scene, rule, anchor) {
  const anchorID = toPositiveInt(anchor && anchor.itemID, 0);
  const layout = getEverMoreGateCustomsLayout(scene && scene.systemID, anchorID);
  if (layout.length <= 0) {
    return 0;
  }

  const existing = collectExistingStartupControllerSlots(
    scene,
    rule && rule.startupRuleID,
    anchorID,
  );
  if (existing.slots.size <= 0 && existing.unindexedCount > 0) {
    return Math.max(0, layout.length - existing.unindexedCount);
  }

  let missing = 0;
  for (let index = 0; index < layout.length; index += 1) {
    if (!existing.slots.has(index)) {
      missing += 1;
    }
  }
  return missing;
}

function resolveEverMoreOrbitTarget(scene, anchor, existingSlots, spawnedSlots, slot) {
  if (slot && slot.orbitTarget === "anchor") {
    return anchor;
  }

  const targetSlotIndex = Math.max(0, Math.trunc(Number(slot && slot.orbitTarget) || 0));
  const spawnedTarget = spawnedSlots.get(targetSlotIndex);
  if (spawnedTarget) {
    return spawnedTarget;
  }

  const existingTargetID = existingSlots.get(targetSlotIndex);
  return existingTargetID && scene ? scene.getEntityByID(existingTargetID) : null;
}

function spawnExactEverMoreGatePresenceForAnchor(scene, rule, anchor, sharedSpawnOptions) {
  const anchorID = toPositiveInt(anchor && anchor.itemID, 0);
  const layout = getEverMoreGateCustomsLayout(scene && scene.systemID, anchorID);
  if (layout.length <= 0) {
    return {
      success: true,
      data: {
        spawned: [],
      },
    };
  }

  const existing = collectExistingStartupControllerSlots(
    scene,
    rule && rule.startupRuleID,
    anchorID,
  );
  if (existing.slots.size <= 0 && existing.unindexedCount >= layout.length) {
    return {
      success: true,
      data: {
        spawned: [],
      },
    };
  }

  const context = {
    systemID: scene.systemID,
    scene,
    anchorEntity: anchor,
    anchorKind: "stargate",
    anchorLabel: anchor.itemName || anchor.slimName || `Stargate ${anchorID}`,
    preferredTargetID: toPositiveInt(rule && rule.preferredTargetID, 0),
  };
  const spawned = [];
  const spawnedSlots = new Map();
  const skipUnindexedPrefixCount = existing.slots.size <= 0
    ? Math.min(existing.unindexedCount, layout.length)
    : 0;

  for (let index = 0; index < layout.length; index += 1) {
    if (index < skipUnindexedPrefixCount) {
      continue;
    }
    if (existing.slots.has(index)) {
      const existingEntity = scene.getEntityByID(existing.slots.get(index));
      if (existingEntity) {
        spawnedSlots.set(index, existingEntity);
      }
      continue;
    }

    const slot = layout[index];
    const definition = buildNpcDefinition(slot.profileID);
    if (!definition) {
      return {
        success: false,
        errorMsg: "NPC_DEFINITION_INCOMPLETE",
        data: {
          spawned,
        },
      };
    }

    const position = addVectors(
      cloneVector(anchor && anchor.position),
      cloneVector(slot && slot.offset),
    );
    const targetEntity =
      resolveEverMoreOrbitTarget(scene, anchor, existing.slots, spawnedSlots, slot) ||
      anchor;
    const targetEntityID = toPositiveInt(targetEntity && targetEntity.itemID, anchorID);
    const targetPoint = cloneVector(targetEntity && targetEntity.position, anchor && anchor.position);
    const spawnResult = nativeNpcService.spawnNativeNpcEntityInContext(
      context,
      definition,
      {
        ...sharedSpawnOptions,
        broadcast: false,
        deferInitialBehaviorTick: true,
        materializeRuntime: sharedSpawnOptions.materializeRuntime,
        runtimeKind: "nativeAmbient",
        batchIndex: index + 1,
        batchTotal: layout.length,
        startupSlotIndex: index,
        selectionKind: "group",
        selectionID: String(rule && rule.spawnGroupID || "").trim() || null,
        selectionName: String(rule && rule.name || "").trim() || null,
        spawnStateOverride: {
          position,
          velocity: { x: 0, y: 0, z: 0 },
          direction: normalizeVector(
            subtractVectors(targetPoint, position),
            cloneVector(anchor && anchor.direction, { x: 1, y: 0, z: 0 }),
          ),
          targetPoint,
          mode: "ORBIT",
          speedFraction: toFiniteNumber(slot && slot.speedFraction, 0),
          targetEntityID,
          followRange: toFiniteNumber(slot && slot.orbitDistanceMeters, 6_000),
          orbitDistance: toFiniteNumber(slot && slot.orbitDistanceMeters, 6_000),
          maxVelocity: toFiniteNumber(slot && slot.maxVelocity, 0),
        },
      },
    );
    if (!spawnResult.success || !spawnResult.data) {
      return {
        success: false,
        errorMsg: spawnResult.errorMsg || "NPC_STARTUP_SPAWN_FAILED",
        data: {
          spawned,
        },
      };
    }

    const spawnedTarget =
      spawnResult.data.entity ||
      (
        spawnResult.data.entityRecord
          ? {
              itemID: spawnResult.data.entityRecord.entityID,
              position: cloneVector(spawnResult.data.entityRecord.position),
            }
          : null
      );
    if (spawnedTarget) {
      spawnedSlots.set(index, spawnedTarget);
    }
    spawned.push(spawnResult.data);
  }

  if (scene && sharedSpawnOptions.broadcast !== false && sharedSpawnOptions.materializeRuntime !== false) {
    scene.broadcastAddBalls(
      spawned
        .map((entry) => entry && entry.entity)
        .filter(Boolean),
      sharedSpawnOptions.excludedSession || null,
      {
        freshAcquire: true,
        minimumLeadFromCurrentHistory: 2,
      },
    );
  }

  return {
    success: true,
    data: {
      spawned,
    },
  };
}

function spawnStartupRuleInScene(scene, rule) {
  const selector = rule && rule.anchorSelector && typeof rule.anchorSelector === "object"
    ? rule.anchorSelector
    : {};
  const anchorsResult = resolveAnchors(scene.systemID, selector);
  if (!anchorsResult.success || !anchorsResult.data) {
    return {
      success: false,
      errorMsg: anchorsResult.errorMsg || "ANCHOR_NOT_FOUND",
      data: {
        rule,
        anchors: [],
        spawned: [],
      },
    };
  }

  const spawned = [];
  const groupsPerAnchor = Math.max(1, toPositiveInt(rule.groupsPerAnchor, 1));
  const isAmbientStartupRule = nativeNpcService.isNativeAmbientRuleOptions({
    entityType: rule && rule.entityType,
    behaviorOverrides: rule && rule.behaviorOverrides,
    runtimeKind: rule && rule.runtimeKind,
  });
  const shouldVirtualizeAmbientSpawns = isAmbientStartupRuleVirtualizable(scene, rule);
  const shouldVirtualizeCombatSpawns =
    !isAmbientStartupRule &&
    isCombatStartupRuleDormancyEligible(scene, rule);
  for (const anchor of anchorsResult.data.anchors) {
    const anchorID = toPositiveInt(anchor && anchor.itemID, 0);
    const existingCount = anchorID > 0
      ? countExistingStartupControllers(scene, rule.startupRuleID, anchorID)
      : 0;
    if (isExactEverMoreGatePresenceRule(rule)) {
      const sharedSpawnOptions = {
        ...normalizeNpcSpawnOptions({
          transient: rule.transient,
        }),
        entityType: String(rule.entityType || "concord"),
        spawnGroupQuery: rule.spawnGroupID,
        spawnGroupID: String(rule.spawnGroupID || "").trim() || null,
        anchorEntity: anchor,
        preferredTargetID: toPositiveInt(rule.preferredTargetID, 0),
        startupRuleID: String(rule.startupRuleID || "").trim() || null,
        operatorKind: String(rule.operatorKind || "").trim() || null,
        behaviorOverrides: rule.behaviorOverrides,
        runtimeKind: "nativeAmbient",
        anchorKind: "stargate",
        anchorName: anchor.itemName || anchor.slimName || `Stargate ${anchorID}`,
        anchorID,
        ...(shouldVirtualizeAmbientSpawns
          ? {
              materializeRuntime: false,
              broadcast: false,
              skipInitialBehaviorTick: true,
            }
          : {}),
      };
      const spawnResult = spawnExactEverMoreGatePresenceForAnchor(
        scene,
        rule,
        anchor,
        sharedSpawnOptions,
      );
      if (!spawnResult.success || !spawnResult.data) {
        return {
          success: false,
          errorMsg: spawnResult.errorMsg || "NPC_STARTUP_SPAWN_FAILED",
          data: {
            rule,
            anchors: anchorsResult.data.anchors,
            spawned,
          },
        };
      }
      spawned.push(...spawnResult.data.spawned);
      continue;
    }
    for (let groupIndex = existingCount; groupIndex < groupsPerAnchor; groupIndex += 1) {
      const sharedSpawnOptions = {
        ...normalizeNpcSpawnOptions({
          transient: rule.transient,
        }),
        entityType: String(rule.entityType || "npc"),
        spawnGroupQuery: rule.spawnGroupID,
        anchorEntity: anchor,
        preferredTargetID: toPositiveInt(rule.preferredTargetID, 0),
        startupRuleID: String(rule.startupRuleID || "").trim() || null,
        operatorKind: String(rule.operatorKind || "").trim() || null,
        behaviorOverrides: rule.behaviorOverrides,
        spawnDistanceMeters: toFiniteNumber(
          selector.spawnDistanceMeters,
          0,
        ),
        distanceFromSurfaceMeters: toFiniteNumber(
          selector.distanceFromSurfaceMeters,
          0,
        ),
        spreadMeters: toFiniteNumber(selector.spreadMeters, 0),
        formationSpacingMeters: toFiniteNumber(
          selector.formationSpacingMeters,
          0,
        ),
        ...(isAmbientStartupRule
          ? {
              runtimeKind: "nativeAmbient",
            }
          : {}),
        ...(shouldVirtualizeAmbientSpawns
          ? {
              materializeRuntime: false,
              broadcast: false,
              skipInitialBehaviorTick: true,
            }
          : {}),
        ...(shouldVirtualizeCombatSpawns
          ? {
              materializeRuntime: false,
              broadcast: false,
            }
          : {}),
      };
      const spawnResult = spawnNpcGroupInSystem(scene.systemID, sharedSpawnOptions);
      if (!spawnResult.success || !spawnResult.data) {
        return {
          success: false,
          errorMsg: spawnResult.errorMsg || "NPC_STARTUP_SPAWN_FAILED",
          data: {
            rule,
            anchors: anchorsResult.data.anchors,
            spawned,
          },
        };
      }

      spawned.push(...spawnResult.data.spawned);
    }
  }

  return {
    success: true,
    data: {
      rule,
      anchors: anchorsResult.data.anchors,
      spawned,
    },
  };
}

function getStartupRuleMissingCount(scene, rule) {
  const selector = rule && rule.anchorSelector && typeof rule.anchorSelector === "object"
    ? rule.anchorSelector
    : {};
  const anchorsResult = resolveAnchors(scene.systemID, selector);
  if (!anchorsResult.success || !anchorsResult.data) {
    return {
      success: false,
      errorMsg: anchorsResult.errorMsg || "ANCHOR_NOT_FOUND",
      data: {
        anchors: [],
        missingCount: 0,
      },
    };
  }

  const groupsPerAnchor = Math.max(1, toPositiveInt(rule && rule.groupsPerAnchor, 1));
  let missingCount = 0;
  for (const anchor of anchorsResult.data.anchors) {
    const anchorID = toPositiveInt(anchor && anchor.itemID, 0);
    if (isExactEverMoreGatePresenceRule(rule)) {
      const expectedCount = getEverMoreGateCustomsExpectedCount(scene && scene.systemID, anchorID);
      if (expectedCount <= 0) {
        continue;
      }
      missingCount += countMissingExactEverMoreSlots(scene, rule, anchor);
      continue;
    }
    const existingCount = anchorID > 0
      ? countExistingStartupControllers(scene, rule.startupRuleID, anchorID)
      : 0;
    missingCount += Math.max(0, groupsPerAnchor - existingCount);
  }

  return {
    success: true,
    data: {
      anchors: anchorsResult.data.anchors,
      missingCount,
    },
  };
}

function maintainStartupRulesInScene(scene, now) {
  if (!scene) {
    return;
  }

  const maintenanceIntervalMs = 1_000;
  if (toFiniteNumber(scene._npcStartupMaintenanceNextAtMs, 0) > now) {
    return;
  }
  scene._npcStartupMaintenanceNextAtMs = now + maintenanceIntervalMs;

  if (!scene._npcStartupRespawnDeadlines || typeof scene._npcStartupRespawnDeadlines !== "object") {
    scene._npcStartupRespawnDeadlines = Object.create(null);
  }

  const activeRuleIDs = new Set();
  for (const rule of listStartupRulesForSystem(scene.systemID)) {
    if (!rule || rule.respawnEnabled === false) {
      continue;
    }

    const startupRuleID = String(rule.startupRuleID || "").trim();
    if (!startupRuleID) {
      continue;
    }
    activeRuleIDs.add(startupRuleID);

    const missingResult = getStartupRuleMissingCount(scene, rule);
    if (!missingResult.success || !missingResult.data) {
      continue;
    }

    if (missingResult.data.missingCount <= 0) {
      delete scene._npcStartupRespawnDeadlines[startupRuleID];
      continue;
    }

    const respawnDelayMs = Math.max(
      1_000,
      toFiniteNumber(rule.respawnDelayMs, 15_000),
    );
    const existingDeadline = toFiniteNumber(
      scene._npcStartupRespawnDeadlines[startupRuleID],
      0,
    );
    if (existingDeadline <= 0) {
      scene._npcStartupRespawnDeadlines[startupRuleID] = now + respawnDelayMs;
      continue;
    }

    if (now < existingDeadline) {
      continue;
    }

    spawnStartupRuleInScene(scene, rule);
    const postSpawnMissingResult = getStartupRuleMissingCount(scene, rule);
    if (
      postSpawnMissingResult.success &&
      postSpawnMissingResult.data &&
      postSpawnMissingResult.data.missingCount <= 0
    ) {
      delete scene._npcStartupRespawnDeadlines[startupRuleID];
    } else {
      scene._npcStartupRespawnDeadlines[startupRuleID] = now + respawnDelayMs;
    }
  }

  for (const startupRuleID of Object.keys(scene._npcStartupRespawnDeadlines)) {
    if (!activeRuleIDs.has(startupRuleID)) {
      delete scene._npcStartupRespawnDeadlines[startupRuleID];
    }
  }
}

function spawnStartupRulesForSystem(systemID) {
  const scene = spaceRuntime.ensureScene(systemID);
  if (!scene) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  const rules = listStartupRulesForSystem(scene.systemID);
  const applied = [];
  for (const rule of rules) {
    applied.push(spawnStartupRuleInScene(scene, rule));
  }

  return {
    success: true,
    data: {
      systemID: scene.systemID,
      applied,
    },
  };
}

function refreshStartupRulesForScene(scene) {
  if (!scene || toPositiveInt(scene.systemID, 0) <= 0) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }
  return spawnStartupRulesForSystem(scene.systemID);
}

function tickScene(scene, now) {
  tickBehaviorScene(scene, now);
  maintainStartupRulesInScene(scene, now);
}

function handleSceneCreated(scene) {
  if (!scene || scene._npcStartupInitialized === true) {
    return {
      success: true,
      data: {
        rehydrated: [],
        applied: [],
      },
    };
  }

  scene._npcStartupInitialized = true;
  const removedLegacySyntheticNpcs = cleanupLegacySyntheticNpcShips(scene);
  const removedStaleNativeStartupNpcs = nativeNpcService.cleanupStaleNativeStartupControllers(scene);
  const startupResult = spawnStartupRulesForSystem(scene.systemID);
  return {
    success: startupResult.success,
    errorMsg: startupResult.errorMsg || null,
    data: {
      removedLegacySyntheticNpcs,
      removedStaleNativeStartupNpcs,
      rehydrated: [],
      applied:
        startupResult.success && startupResult.data && Array.isArray(startupResult.data.applied)
          ? startupResult.data.applied
          : [],
    },
  };
}

function getOperatorStartupRulesForSystem(systemID, operatorKind) {
  const normalizedOperatorKind = String(operatorKind || "").trim();
  if (!normalizedOperatorKind) {
    return [];
  }

  return listNpcStartupRules().filter((rule) => (
    ruleAppliesToSystem(rule, systemID) &&
    String(rule && rule.operatorKind || "").trim() === normalizedOperatorKind
  ));
}

function isGateOperatorControlEnabled(systemID, operatorKind) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  const normalizedOperatorKind = String(operatorKind || "").trim();
  if (!normalizedSystemID || !normalizedOperatorKind) {
    return false;
  }

  const gateControl = getSystemGateControl(normalizedSystemID);
  if (normalizedOperatorKind === GATE_OPERATOR_KIND.CONCORD) {
    return gateControl.gateConcordEnabled === true;
  }
  if (normalizedOperatorKind === GATE_OPERATOR_KIND.RATS) {
    return gateControl.gateRatEnabled === true;
  }
  return false;
}

function getGateOperatorState(systemID, operatorKind) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  const normalizedOperatorKind = String(operatorKind || "").trim();
  if (!normalizedSystemID || !normalizedOperatorKind) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const gateControl = getSystemGateControl(normalizedSystemID);
  const dynamicRuleID = getDynamicGateStartupRuleID(
    normalizedSystemID,
    normalizedOperatorKind,
  );
  if (isGateOperatorControlEnabled(normalizedSystemID, normalizedOperatorKind)) {
    return {
      success: true,
      data: {
        systemID: normalizedSystemID,
        operatorKind: normalizedOperatorKind,
        source: "dynamic",
        enabled: true,
        startupRuleIDs: dynamicRuleID ? [dynamicRuleID] : [],
        gateControl,
      },
    };
  }

  const startupRules = getOperatorStartupRulesForSystem(
    normalizedSystemID,
    normalizedOperatorKind,
  );
  if (startupRules.length > 0) {
    return {
      success: true,
      data: {
        systemID: normalizedSystemID,
        operatorKind: normalizedOperatorKind,
        source: getStartupRuleSource(startupRules),
        enabled: startupRules.some((rule) => isStartupRuleEnabled(rule)),
        startupRuleIDs: startupRules.map((rule) => String(rule.startupRuleID || "").trim()).filter(Boolean),
        gateControl,
      },
    };
  }

  return {
    success: true,
    data: {
      systemID: normalizedSystemID,
      operatorKind: normalizedOperatorKind,
      source: "dynamic",
      enabled: false,
      startupRuleIDs: dynamicRuleID ? [dynamicRuleID] : [],
      gateControl,
    },
  };
}

function wakeControllersInSystem(systemID) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  if (!normalizedSystemID) {
    return;
  }

  for (const controller of listControllersBySystem(normalizedSystemID)) {
    controller.nextThinkAtMs = 0;
  }
}

function wakeNpcController(entityID, whenMs = 0) {
  const normalizedEntityID = toPositiveInt(entityID, 0);
  let controller = getControllerByEntityID(normalizedEntityID);
  if (!controller) {
    const controllerRecord = nativeNpcStore.getNativeController(normalizedEntityID);
    const systemID = toPositiveInt(controllerRecord && controllerRecord.systemID, 0);
    if (controllerRecord && systemID > 0) {
      const scene = spaceRuntime.ensureScene(systemID);
      const materializeResult = nativeNpcService.materializeStoredNativeController(
        scene,
        normalizedEntityID,
        {
          broadcast: false,
        },
      );
      if (!materializeResult.success) {
        return {
          success: false,
          errorMsg: materializeResult.errorMsg || "NPC_WAKE_MATERIALIZE_FAILED",
        };
      }
      controller =
        getControllerByEntityID(normalizedEntityID) ||
        (
          materializeResult.data &&
          materializeResult.data.controller
        ) ||
        null;
    }
  }
  if (!controller) {
    return {
      success: false,
      errorMsg: "NPC_NOT_FOUND",
    };
  }

  const normalizedWhenMs = Math.max(0, toFiniteNumber(whenMs, 0));
  controller.nextThinkAtMs =
    normalizedWhenMs > 0
      ? Math.min(
          toFiniteNumber(controller.nextThinkAtMs, normalizedWhenMs),
          normalizedWhenMs,
        )
      : 0;
  return {
    success: true,
    data: controller,
  };
}

function scheduleNpcController(entityID, whenMs) {
  const controller = getControllerByEntityID(entityID);
  if (!controller) {
    return {
      success: false,
      errorMsg: "NPC_NOT_FOUND",
    };
  }

  const normalizedWhenMs = Math.max(0, toFiniteNumber(whenMs, 0));
  if (normalizedWhenMs <= 0) {
    controller.nextThinkAtMs = 0;
  } else {
    controller.nextThinkAtMs = normalizedWhenMs;
  }
  return {
    success: true,
    data: controller,
  };
}

function destroyNpcController(controller, options = {}) {
  if (!controller) {
    return {
      success: false,
      errorMsg: "NPC_NOT_FOUND",
    };
  }

  if (String(controller.runtimeKind || "").trim().startsWith("native")) {
    return nativeNpcService.destroyNativeNpcController(controller, options);
  }
  return destroyLegacySyntheticNpcController(controller, options);
}

function destroyNpcControllerByEntityID(entityID, options = {}) {
  const controller = getControllerByEntityID(entityID);
  if (!controller) {
    return {
      success: false,
      errorMsg: "NPC_NOT_FOUND",
    };
  }

  return destroyNpcController(controller, options);
}

function clearNpcControllersInSystem(systemID, options = {}) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  if (!normalizedSystemID) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const entityTypeFilter = String(options.entityType || "all").trim().toLowerCase() || "all";
  const allowedEntityTypes = new Set(
    entityTypeFilter === "all"
      ? ["npc", "concord"]
      : entityTypeFilter === "rat" || entityTypeFilter === "rats"
        ? ["npc"]
        : [entityTypeFilter],
  );
  const startupRuleFilter = Array.isArray(options.startupRuleIDs)
    ? new Set(
        options.startupRuleIDs
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      )
    : null;
  const centerPosition = options.centerPosition && typeof options.centerPosition === "object"
    ? cloneVector(options.centerPosition)
    : null;
  const radiusMeters = Math.max(0, toFiniteNumber(options.radiusMeters, 0));
  const scene = spaceRuntime.ensureScene(normalizedSystemID);
  const destroyed = [];

  for (const controller of listControllersBySystem(normalizedSystemID)) {
    if (!allowedEntityTypes.has(String(controller.entityType || "npc").trim().toLowerCase())) {
      continue;
    }
    if (
      startupRuleFilter &&
      !startupRuleFilter.has(String(controller.startupRuleID || "").trim())
    ) {
      continue;
    }

    if (centerPosition && radiusMeters > 0) {
      const entity = scene && scene.getEntityByID(toPositiveInt(controller.entityID, 0));
      if (!entity || !entity.position) {
        continue;
      }
      const dx = toFiniteNumber(entity.position.x, 0) - toFiniteNumber(centerPosition.x, 0);
      const dy = toFiniteNumber(entity.position.y, 0) - toFiniteNumber(centerPosition.y, 0);
      const dz = toFiniteNumber(entity.position.z, 0) - toFiniteNumber(centerPosition.z, 0);
      const distanceMeters = Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
      if (distanceMeters > radiusMeters) {
        continue;
      }
    }

    destroyNpcController(controller, options);
    destroyed.push({
      entityID: controller.entityID,
      startupRuleID: controller.startupRuleID || null,
      entityType: controller.entityType || "npc",
    });
  }

  return {
    success: true,
    data: {
      systemID: normalizedSystemID,
      destroyed,
      destroyedCount: destroyed.length,
    },
  };
}

function clearNpcControllersForSessionRadius(session, options = {}) {
  if (!session || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const systemID = toPositiveInt(session._space.systemID, 0);
  const shipEntity = spaceRuntime.getEntity(session, session._space.shipID);
  if (!systemID || !shipEntity || !shipEntity.position) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  return clearNpcControllersInSystem(systemID, {
    ...options,
    centerPosition: shipEntity.position,
  });
}

function setGateOperatorEnabled(systemID, operatorKind, enabled) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  const normalizedOperatorKind = String(operatorKind || "").trim();
  if (!normalizedSystemID || !normalizedOperatorKind) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const startupRules = getOperatorStartupRulesForSystem(
    normalizedSystemID,
    normalizedOperatorKind,
  );
  for (const rule of startupRules) {
    const overrideResult = setStartupRuleEnabledOverride(
      rule.startupRuleID,
      false,
    );
    if (!overrideResult.success) {
      return overrideResult;
    }
  }

  const gateControlUpdates = normalizedOperatorKind === GATE_OPERATOR_KIND.CONCORD
    ? { gateConcordEnabled: enabled === true }
    : { gateRatEnabled: enabled === true };
  const gateControlResult = setSystemGateControl(
    normalizedSystemID,
    gateControlUpdates,
  );
  if (!gateControlResult.success) {
    return gateControlResult;
  }

  const startupRuleIDsToClear = [
    ...startupRules.map((rule) => String(rule && rule.startupRuleID || "").trim()).filter(Boolean),
    String(
      getDynamicGateStartupRuleID(normalizedSystemID, normalizedOperatorKind) || "",
    ).trim(),
  ].filter(Boolean);

  if (startupRuleIDsToClear.length > 0) {
    clearNpcControllersInSystem(normalizedSystemID, {
      entityType:
        normalizedOperatorKind === GATE_OPERATOR_KIND.CONCORD
          ? "concord"
          : "npc",
      startupRuleIDs: startupRuleIDsToClear,
      removeContents: true,
    });
  }

  if (enabled === true) {
    const spawnResult = spawnStartupRulesForSystem(normalizedSystemID);
    if (!spawnResult.success) {
      return spawnResult;
    }
  }

  return getGateOperatorState(normalizedSystemID, normalizedOperatorKind);
}

function setCharacterNpcInvulnerability(characterID, enabled) {
  return setCharacterInvulnerability(characterID, enabled);
}

function toggleCharacterNpcInvulnerability(characterID) {
  return toggleCharacterInvulnerability(characterID);
}

function isDrifterController(controller, entity = null) {
  if (!controller || typeof controller !== "object") {
    return false;
  }

  if (
    controller.behaviorOverrides &&
    controller.behaviorOverrides.drifterBehavior === true
  ) {
    return true;
  }
  if (
    controller.behaviorProfile &&
    controller.behaviorProfile.drifterBehavior === true
  ) {
    return true;
  }
  return (
    toPositiveInt(entity && entity.factionID, 0) === DRIFTER_FACTION_ID ||
    toPositiveInt(entity && entity.slimFactionID, 0) === DRIFTER_FACTION_ID
  );
}

function resolveDrifterAggressionGroupKey(controller) {
  const groupedFields = [
    "startupRuleID",
    "spawnSiteID",
    "spawnGroupID",
    "selectionID",
    "operatorKind",
  ];
  for (const field of groupedFields) {
    const normalizedValue = String(controller && controller[field] || "").trim();
    if (normalizedValue) {
      return `${field}:${normalizedValue}`;
    }
  }
  return "";
}

function shouldPropagateDrifterAggression(
  sourceController,
  candidateController,
  sourceEntity,
  candidateEntity,
) {
  if (
    !sourceController ||
    !candidateController ||
    sourceController.entityID === candidateController.entityID
  ) {
    return false;
  }
  if (!isDrifterController(candidateController, candidateEntity)) {
    return false;
  }

  const sourceGroupKey = resolveDrifterAggressionGroupKey(sourceController);
  const candidateGroupKey = resolveDrifterAggressionGroupKey(candidateController);
  if (sourceGroupKey && candidateGroupKey) {
    return sourceGroupKey === candidateGroupKey;
  }
  if (sourceGroupKey || candidateGroupKey) {
    return false;
  }

  const sourceFactionID = toPositiveInt(sourceEntity && sourceEntity.factionID, 0);
  const candidateFactionID = toPositiveInt(candidateEntity && candidateEntity.factionID, 0);
  if (
    sourceFactionID > 0 &&
    candidateFactionID > 0 &&
    sourceFactionID === candidateFactionID
  ) {
    return true;
  }

  const sourceCorporationID = toPositiveInt(
    sourceEntity && sourceEntity.corporationID,
    0,
  );
  const candidateCorporationID = toPositiveInt(
    candidateEntity && candidateEntity.corporationID,
    0,
  );
  return (
    sourceCorporationID > 0 &&
    candidateCorporationID > 0 &&
    sourceCorporationID === candidateCorporationID
  );
}

function propagateDrifterAggressionToPack(targetEntity, attackerEntity, now) {
  const targetEntityID = toPositiveInt(targetEntity && targetEntity.itemID, 0);
  const attackerEntityID = toPositiveInt(attackerEntity && attackerEntity.itemID, 0);
  const attackerOwnerID = toPositiveInt(
    attackerEntity && attackerEntity.ownerID,
    toPositiveInt(
      attackerEntity && attackerEntity.pilotCharacterID,
      toPositiveInt(attackerEntity && attackerEntity.characterID, 0),
    ),
  );
  if (!targetEntityID || !attackerEntityID) {
    return [];
  }

  const sourceController = getControllerByEntityID(targetEntityID);
  if (!sourceController) {
    return [];
  }

  const systemID = toPositiveInt(
    sourceController.systemID,
    toPositiveInt(targetEntity && targetEntity.systemID, 0),
  );
  if (!systemID) {
    return [];
  }

  const scene = spaceRuntime.ensureScene(systemID);
  const sourceEntity = scene.getEntityByID(targetEntityID) || targetEntity;
  if (!isDrifterController(sourceController, sourceEntity)) {
    return [];
  }

  const propagatedEntityIDs = [];
  const normalizedNow = Math.max(0, toFiniteNumber(now, Date.now()));
  for (const candidateController of listControllersBySystem(systemID)) {
    const candidateEntity = scene.getEntityByID(
      toPositiveInt(candidateController && candidateController.entityID, 0),
    );
    if (!shouldPropagateDrifterAggression(
      sourceController,
      candidateController,
      sourceEntity,
      candidateEntity,
    )) {
      continue;
    }

    candidateController.preferredTargetID = attackerEntityID;
    candidateController.preferredTargetOwnerID = attackerOwnerID;
    candidateController.lastAggressorID = attackerEntityID;
    candidateController.lastAggressorOwnerID = attackerOwnerID;
    candidateController.lastAggressedAtMs = normalizedNow;
    if (String(candidateController.runtimeKind || "").trim() === "nativeAmbient") {
      candidateController.runtimeKind = "nativeCombat";
    }
    candidateController.nextThinkAtMs = 0;
    propagatedEntityIDs.push(candidateController.entityID);
  }

  return propagatedEntityIDs;
}

function noteNpcIncomingAggression(targetEntity, attackerEntity, now) {
  const targetEntityID = toPositiveInt(targetEntity && targetEntity.itemID, 0);
  const attackerEntityID = toPositiveInt(attackerEntity && attackerEntity.itemID, 0);
  const attackerOwnerID = toPositiveInt(
    attackerEntity && attackerEntity.ownerID,
    toPositiveInt(
      attackerEntity && attackerEntity.pilotCharacterID,
      toPositiveInt(attackerEntity && attackerEntity.characterID, 0),
    ),
  );
  if (!targetEntityID || !attackerEntityID) {
    return {
      success: false,
      errorMsg: "ENTITY_NOT_FOUND",
    };
  }

  const noteResult = noteIncomingAggression(
    targetEntityID,
    attackerEntityID,
    now,
    {
      attackerOwnerID,
    },
  );
  if (!noteResult.success) {
    return noteResult;
  }

  const propagatedEntityIDs = propagateDrifterAggressionToPack(
    targetEntity,
    attackerEntity,
    now,
  );
  return {
    ...noteResult,
    data: {
      ...(noteResult.data && typeof noteResult.data === "object"
        ? noteResult.data
        : {}),
      propagatedEntityIDs,
    },
  };
}

function getNpcOperatorSummary() {
  return listControllers().map((controller) => ({
    entityID: controller.entityID,
    systemID: controller.systemID,
    profileID: controller.profileID,
    currentTargetID: controller.currentTargetID || 0,
    preferredTargetID: controller.preferredTargetID || 0,
    entityType: controller.entityType || "npc",
    selectionKind: controller.selectionKind || null,
    selectionID: controller.selectionID || null,
    spawnGroupID: controller.spawnGroupID || null,
    spawnSiteID: controller.spawnSiteID || null,
    startupRuleID: controller.startupRuleID || null,
    operatorKind: controller.operatorKind || null,
    anchorKind: controller.anchorKind || null,
    anchorID: controller.anchorID || 0,
    transient: controller.transient === true,
    capitalNpc: controller.capitalNpc === true,
    capitalClassID: controller.capitalClassID || null,
    capitalRarity: controller.capitalRarity || null,
    allowPodKill:
      controller.behaviorOverrides &&
      Object.prototype.hasOwnProperty.call(controller.behaviorOverrides, "allowPodKill")
        ? controller.behaviorOverrides.allowPodKill === true
        : controller.behaviorProfile && controller.behaviorProfile.allowPodKill === true,
    manualOrderType:
      controller.manualOrder && controller.manualOrder.type
        ? String(controller.manualOrder.type)
        : null,
    returningHome: controller.returningHome === true,
  }));
}

module.exports = {
  GATE_OPERATOR_KIND,
  listNpcProfiles,
  listNpcSpawnPools,
  listNpcSpawnGroups,
  listNpcSpawnSites,
  listNpcStartupRules,
  getGateOperatorState,
  resolveProfileDefinition,
  spawnNpcBatchForSession,
  spawnNpcBatchInSystem,
  spawnNpcForSession,
  spawnConcordBatchForSession,
  spawnConcordForSession,
  spawnNpcGroupInSystem,
  spawnNpcSite,
  spawnNpcSiteForSession,
  spawnStartupRulesForSystem,
  refreshStartupRulesForScene,
  handleSceneCreated,
  tickScene,
  issueManualOrder,
  setBehaviorOverrides,
  clearNpcControllersInSystem,
  clearNpcControllersForSessionRadius,
  setGateOperatorEnabled,
  setCharacterNpcInvulnerability,
  toggleCharacterNpcInvulnerability,
  isCharacterInvulnerable,
  noteNpcIncomingAggression,
  getControllerByEntityID,
  destroyNpcControllerByEntityID,
  parseNpcCustomInfo,
  getNpcOperatorSummary,
  wakeNpcController,
  scheduleNpcController,
  _testing: {
    ruleAppliesToSystem,
  },
};
