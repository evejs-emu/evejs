const path = require("path");
const { isDeepStrictEqual } = require("util");

const dungeonAuthority = require(path.join(__dirname, "./dungeonAuthority"));
const runtimeState = require(path.join(__dirname, "./dungeonRuntimeState"));

const instanceChangeListeners = new Set();
let runtimeTicker = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizeText(value, fallback = "") {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || fallback;
}

function cloneObjectiveStateForComparison(value = {}) {
  const objectiveState =
    value && typeof value === "object" && !Array.isArray(value)
      ? cloneValue(value)
      : {};
  if (
    objectiveState.metadata &&
    typeof objectiveState.metadata === "object" &&
    !Array.isArray(objectiveState.metadata)
  ) {
    delete objectiveState.metadata.lastAdvancedAtMs;
    delete objectiveState.metadata.lastProgressionAtMs;
  }
  return objectiveState;
}

function normalizeOwnership(options = {}) {
  const sharedWithCharacterIDs = [...new Set((Array.isArray(options.sharedWithCharacterIDs)
    ? options.sharedWithCharacterIDs
    : [])
    .map((entry) => toInt(entry, 0))
    .filter((entry) => entry > 0))].sort((left, right) => left - right);
  return {
    visibilityScope: normalizeText(options.visibilityScope, "public").toLowerCase(),
    characterID: Math.max(0, toInt(options.characterID, 0)) || null,
    corporationID: Math.max(0, toInt(options.corporationID, 0)) || null,
    fleetID: Math.max(0, toInt(options.fleetID, 0)) || null,
    missionOwnerCharacterID: Math.max(0, toInt(options.missionOwnerCharacterID, 0)) || null,
    sharedWithCharacterIDs,
    metadata:
      options.metadata && typeof options.metadata === "object" && !Array.isArray(options.metadata)
        ? cloneValue(options.metadata)
        : {},
  };
}

function normalizePosition(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (Array.isArray(value) && value.length >= 3) {
    return {
      x: Number(value[0]) || 0,
      y: Number(value[1]) || 0,
      z: Number(value[2]) || 0,
    };
  }
  return {
    x: Number(value.x) || 0,
    y: Number(value.y) || 0,
    z: Number(value.z) || 0,
  };
}

function emitInstanceChange(changeType, beforeInstance, afterInstance, extra = {}) {
  if (instanceChangeListeners.size <= 0) {
    return;
  }

  const before = beforeInstance ? cloneValue(beforeInstance) : null;
  const after = afterInstance ? cloneValue(afterInstance) : null;
  const payload = {
    changeType: normalizeText(changeType, "updated").toLowerCase(),
    instanceID:
      Math.max(0, toInt(after && after.instanceID, 0)) ||
      Math.max(0, toInt(before && before.instanceID, 0)) ||
      null,
    solarSystemID:
      Math.max(0, toInt(after && after.solarSystemID, 0)) ||
      Math.max(0, toInt(before && before.solarSystemID, 0)) ||
      null,
    previousSolarSystemID: Math.max(0, toInt(before && before.solarSystemID, 0)) || null,
    before,
    after,
    metadata:
      extra && typeof extra === "object" && !Array.isArray(extra)
        ? cloneValue(extra)
        : {},
  };

  for (const listener of [...instanceChangeListeners]) {
    try {
      listener(payload);
    } catch (error) {
      // Listener failures should not break the runtime mutation path.
    }
  }
}

function registerInstanceChangeListener(listener) {
  if (typeof listener !== "function") {
    return false;
  }
  instanceChangeListeners.add(listener);
  return true;
}

function unregisterInstanceChangeListener(listener) {
  return instanceChangeListeners.delete(listener);
}

function normalizeConnections(template) {
  if (Array.isArray(template && template.connections)) {
    return template.connections
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => cloneValue(entry));
  }
  if (template && template.connections && typeof template.connections === "object") {
    return Object.entries(template.connections)
      .filter(([, entry]) => entry && typeof entry === "object")
      .map(([connectionKey, entry]) => ({
        connectionKey,
        ...cloneValue(entry),
      }));
  }
  return [];
}

function listOrderedTemplateRoomKeys(template) {
  const roomKeys = ["room:entry"];
  const environmentTemplates =
    template &&
    template.environmentTemplates &&
    typeof template.environmentTemplates === "object"
      ? template.environmentTemplates
      : null;
  const roomTemplates =
    environmentTemplates &&
    environmentTemplates.roomTemplates &&
    typeof environmentTemplates.roomTemplates === "object"
      ? environmentTemplates.roomTemplates
      : {};
  const orderedRoomObjectIDs = Object.keys(roomTemplates)
    .map((entry) => toInt(entry, 0))
    .filter((entry) => entry > 0)
    .sort((left, right) => left - right);
  for (const roomObjectID of orderedRoomObjectIDs) {
    roomKeys.push(`room:${roomObjectID}`);
  }
  return roomKeys;
}

function buildDefaultRoomStates(template, nowMs, options = {}) {
  const explicitRoomStates =
    options.roomStatesByKey && typeof options.roomStatesByKey === "object"
      ? cloneValue(options.roomStatesByKey)
      : null;
  if (explicitRoomStates) {
    return explicitRoomStates;
  }

  const roomStatesByKey = {
    "room:entry": {
      roomKey: "room:entry",
      state: "active",
      stage: "entry",
      pocketID: null,
      nodeGraphID:
        template &&
        template.clientObjectives &&
        Number(template.clientObjectives.nodeGraphID) > 0
          ? Number(template.clientObjectives.nodeGraphID)
          : null,
      activatedAtMs: nowMs,
      completedAtMs: 0,
      lastUpdatedAtMs: nowMs,
      spawnedEntityIDs: [],
      counters: {},
      metadata: {
        seededFromTemplate: true,
      },
    },
  };

  const environmentTemplates =
    template &&
    template.environmentTemplates &&
    typeof template.environmentTemplates === "object"
      ? template.environmentTemplates
      : null;
  const roomTemplates =
    environmentTemplates &&
    environmentTemplates.roomTemplates &&
    typeof environmentTemplates.roomTemplates === "object"
      ? environmentTemplates.roomTemplates
      : {};
  for (const roomObjectID of Object.keys(roomTemplates)) {
    const roomKey = `room:${normalizeText(roomObjectID, "")}`;
    if (roomKey === "room:" || roomStatesByKey[roomKey]) {
      continue;
    }
    roomStatesByKey[roomKey] = {
      roomKey,
      state: "pending",
      stage: "room",
      pocketID: toInt(roomObjectID, 0) || null,
      nodeGraphID: null,
      activatedAtMs: 0,
      completedAtMs: 0,
      lastUpdatedAtMs: nowMs,
      spawnedEntityIDs: [],
      counters: {},
      metadata: {
        seededFromTemplate: true,
      },
    };
  }

  return roomStatesByKey;
}

function buildDefaultGateStates(template, nowMs, options = {}) {
  const explicitGateStates =
    options.gateStatesByKey && typeof options.gateStatesByKey === "object"
      ? cloneValue(options.gateStatesByKey)
      : null;
  if (explicitGateStates) {
    return explicitGateStates;
  }

  const connections = normalizeConnections(template);
  const orderedRoomKeys = listOrderedTemplateRoomKeys(template);
  const gateStatesByKey = {};
  connections.forEach((connection, index) => {
    const fromObjectID = toInt(connection && connection.fromObjectID, 0);
    const toObjectID = toInt(connection && connection.toObjectID, 0);
    const explicitDestinationRoomKey = toObjectID > 0
      ? `room:${toObjectID}`
      : null;
    const inferredDestinationRoomKey =
      explicitDestinationRoomKey && orderedRoomKeys.includes(explicitDestinationRoomKey)
        ? explicitDestinationRoomKey
        : (
          orderedRoomKeys.length > 1
            ? orderedRoomKeys[Math.min(index + 1, orderedRoomKeys.length - 1)]
            : "room:entry"
        );
    const gateKey = `gate:${fromObjectID || (index + 1)}`;
    const defaultState =
      inferredDestinationRoomKey === "room:entry"
        ? "unlocked"
        : "locked";
    gateStatesByKey[gateKey] = {
      gateKey,
      state: defaultState,
      usesCount: 0,
      unlockedAtMs: defaultState === "unlocked" ? nowMs : 0,
      lastUsedAtMs: 0,
      destinationRoomKey: inferredDestinationRoomKey || null,
      allowedShipGroupIDs: [],
      allowedShipTypeIDs: [],
      metadata: {
        seededFromTemplate: true,
        connectionIndex: index,
        connectionKey: connection && connection.connectionKey ? connection.connectionKey : null,
        fromObjectID: fromObjectID || null,
        toObjectID: toObjectID || null,
        inferredDestinationRoomKey: inferredDestinationRoomKey || null,
        allowedShipsList: toInt(connection && connection.allowedShipsList, 0) || null,
        allowedRaces: Array.isArray(connection && connection.allowedRaces)
          ? cloneValue(connection.allowedRaces)
          : [],
        rawConnection: cloneValue(connection),
      },
    };
  });

  return gateStatesByKey;
}

function ensureTemplateRuntimeState(instanceID, options = {}) {
  const existing = requireInstance(instanceID);
  const template = requireTemplate(existing.templateID);
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const existingRoomStates =
    existing.roomStatesByKey && typeof existing.roomStatesByKey === "object"
      ? existing.roomStatesByKey
      : {};
  const existingGateStates =
    existing.gateStatesByKey && typeof existing.gateStatesByKey === "object"
      ? existing.gateStatesByKey
      : {};
  const defaultRoomStates = buildDefaultRoomStates(template, nowMs);
  const defaultGateStates = buildDefaultGateStates(template, nowMs);
  const roomPatch = {};
  const gatePatch = {};

  for (const [roomKey, roomState] of Object.entries(defaultRoomStates)) {
    if (existingRoomStates[roomKey]) {
      continue;
    }
    roomPatch[roomKey] = cloneValue(roomState);
  }

  for (const [gateKey, gateState] of Object.entries(defaultGateStates)) {
    const currentGateState = normalizeObject(existingGateStates[gateKey]);
    if (!existingGateStates[gateKey]) {
      gatePatch[gateKey] = cloneValue(gateState);
      continue;
    }
    const currentDestinationRoomKey = normalizeText(currentGateState.destinationRoomKey, "");
    const defaultDestinationRoomKey = normalizeText(gateState.destinationRoomKey, "");
    const currentState = normalizeText(currentGateState.state, "").toLowerCase();
    const defaultState = normalizeText(gateState.state, "").toLowerCase();
    const needsDestinationRoomKey =
      !currentDestinationRoomKey &&
      !!defaultDestinationRoomKey;
    const needsStateRepair =
      !currentState ||
      (
        needsDestinationRoomKey &&
        currentState === "locked" &&
        defaultState === "unlocked" &&
        Math.max(0, toInt(currentGateState.usesCount, 0)) <= 0
      );
    if (!needsDestinationRoomKey && !needsStateRepair) {
      continue;
    }
    gatePatch[gateKey] = {
      ...cloneValue(gateState),
      ...cloneValue(currentGateState),
      destinationRoomKey: needsDestinationRoomKey
        ? defaultDestinationRoomKey || null
        : currentDestinationRoomKey || null,
      state: needsStateRepair
        ? defaultState || currentState || "locked"
        : currentState || defaultState || "locked",
      unlockedAtMs: needsStateRepair && defaultState === "unlocked"
        ? Math.max(0, toInt(currentGateState.unlockedAtMs, 0)) || nowMs
        : Math.max(0, toInt(currentGateState.unlockedAtMs, 0)),
      metadata: {
        ...normalizeObject(gateState.metadata),
        ...normalizeObject(currentGateState.metadata),
        inferredDestinationRoomKey: needsDestinationRoomKey
          ? defaultDestinationRoomKey || null
          : normalizeText(
            currentGateState.metadata && currentGateState.metadata.inferredDestinationRoomKey,
            "",
          ) || defaultDestinationRoomKey || null,
      },
    };
  }

  if (Object.keys(roomPatch).length <= 0 && Object.keys(gatePatch).length <= 0) {
    return existing;
  }

  runtimeState.mutateState((table) => {
    const target = table.instancesByID[String(existing.instanceID)];
    if (!target) {
      return table;
    }
    target.roomStatesByKey = {
      ...normalizeObject(target.roomStatesByKey),
      ...cloneValue(roomPatch),
    };
    target.gateStatesByKey = {
      ...normalizeObject(target.gateStatesByKey),
      ...cloneValue(gatePatch),
    };
    target.timers = target.timers || {};
    target.timers.lastUpdatedAtMs = nowMs;
    return table;
  });

  const updated = runtimeState.getInstanceSnapshot(existing.instanceID);
  emitInstanceChange("updated", existing, updated, {
    source: "ensureTemplateRuntimeState",
    roomKeys: Object.keys(roomPatch),
    gateKeys: Object.keys(gatePatch),
  });
  return updated;
}

function buildDefaultObjectiveState(template, nowMs, options = {}) {
  const explicitObjectiveState =
    options.objectiveState && typeof options.objectiveState === "object"
      ? cloneValue(options.objectiveState)
      : null;
  if (explicitObjectiveState) {
    return explicitObjectiveState;
  }

  const clientObjectives =
    template &&
    template.clientObjectives &&
    typeof template.clientObjectives === "object"
      ? template.clientObjectives
      : null;
  const objectiveMetadata =
    template &&
    template.objectiveMetadata &&
    typeof template.objectiveMetadata === "object"
      ? template.objectiveMetadata
      : null;
  const objectiveChain =
    objectiveMetadata &&
    objectiveMetadata.objectiveChain &&
    typeof objectiveMetadata.objectiveChain === "object"
      ? objectiveMetadata.objectiveChain
      : null;
  const seededObjectives = Array.isArray(objectiveChain && objectiveChain.objectives)
    ? objectiveChain.objectives
    : [];
  const seededCurrentObjective = seededObjectives.find((objective) => (
    objective && (objective.startActive === 1 || objective.startActive === true)
  )) || seededObjectives[0] || null;
  return {
    state: clientObjectives ? "seeded" : "pending",
    currentNodeID:
      clientObjectives && Number(clientObjectives.nodeGraphID) > 0
        ? Number(clientObjectives.nodeGraphID)
        : null,
    currentObjectiveID:
      clientObjectives && Number(clientObjectives.objectiveChainID) > 0
        ? Number(clientObjectives.objectiveChainID)
        : null,
    currentObjectiveKey:
      seededCurrentObjective && seededCurrentObjective.key
        ? String(seededCurrentObjective.key)
        : null,
    currentObjectiveTypeID:
      seededCurrentObjective && Number(seededCurrentObjective.objectiveType) > 0
        ? Number(seededCurrentObjective.objectiveType)
        : null,
    completedObjectiveIDs: [],
    completedNodeIDs: [],
    counters: {},
    metadata: {
      seededFromTemplate: true,
      objectivesID: toInt(template && template.objectivesID, 0) || null,
      objectiveChainID:
        clientObjectives && Number(clientObjectives.objectiveChainID) > 0
          ? Number(clientObjectives.objectiveChainID)
          : null,
      nodeGraphID:
        clientObjectives && Number(clientObjectives.nodeGraphID) > 0
          ? Number(clientObjectives.nodeGraphID)
          : null,
      blackboardParameters:
        clientObjectives && Array.isArray(clientObjectives.blackboardParameters)
          ? cloneValue(clientObjectives.blackboardParameters)
          : [],
      objectiveSummary: objectiveChain
        ? {
          name: normalizeText(objectiveChain.name, "") || null,
          tags: Array.isArray(objectiveChain.tags) ? cloneValue(objectiveChain.tags) : [],
          objectiveKeys: seededObjectives
            .map((objective) => normalizeText(objective && objective.key, ""))
            .filter(Boolean),
        }
        : null,
      objectiveTypeIDs:
        objectiveMetadata && Array.isArray(objectiveMetadata.objectiveTypeIDs)
          ? cloneValue(objectiveMetadata.objectiveTypeIDs)
          : [],
      nodeTypeIDs:
        objectiveMetadata && Array.isArray(objectiveMetadata.nodeTypeIDs)
          ? cloneValue(objectiveMetadata.nodeTypeIDs)
          : [],
      seededAtMs: nowMs,
    },
  };
}

function buildDefaultEnvironmentState(template, nowMs, options = {}) {
  const explicitEnvironmentState =
    options.environmentState && typeof options.environmentState === "object"
      ? cloneValue(options.environmentState)
      : null;
  if (explicitEnvironmentState) {
    return explicitEnvironmentState;
  }

  const environmentTemplates =
    template &&
    template.environmentTemplates &&
    typeof template.environmentTemplates === "object"
      ? template.environmentTemplates
      : null;
  return {
    seededAtMs: nowMs,
    templates: environmentTemplates ? cloneValue(environmentTemplates) : null,
  };
}

function dungeonError(code, message = code) {
  const error = new Error(String(message || code || "DUNGEON_ERROR"));
  error.dungeonError = String(code || "DUNGEON_ERROR");
  return error;
}

function requireTemplate(templateID) {
  const normalizedTemplateID = normalizeText(templateID, "");
  if (!normalizedTemplateID) {
    throw dungeonError("DUNGEON_TEMPLATE_REQUIRED");
  }
  const template = dungeonAuthority.getTemplateByID(normalizedTemplateID);
  if (!template) {
    throw dungeonError("DUNGEON_TEMPLATE_NOT_FOUND", `Unknown dungeon template: ${normalizedTemplateID}`);
  }
  return template;
}

function requireInstance(instanceID) {
  const instance = runtimeState.getInstanceSnapshot(instanceID);
  if (!instance) {
    throw dungeonError("DUNGEON_INSTANCE_NOT_FOUND", `Unknown dungeon instance: ${instanceID}`);
  }
  return instance;
}

function buildInstanceRecordFromOptions(instanceID, template, options = {}, nowMs = Date.now()) {
  const solarSystemID = Math.max(0, toInt(options.solarSystemID, 0));
  if (solarSystemID <= 0) {
    throw dungeonError("DUNGEON_SOLAR_SYSTEM_REQUIRED");
  }

  const siteKey = normalizeText(options.siteKey, "") || null;
  const ownership = normalizeOwnership(options.ownership || options);
  const lifecycleState = normalizeText(options.lifecycleState, "seeded").toLowerCase();
  const createdAtMs = nowMs;
  const activatedAtMs = Math.max(0, toInt(options.activatedAtMs, createdAtMs));
  const expiresAtMs = Math.max(0, toInt(options.expiresAtMs, 0));
  const despawnAtMs = Math.max(0, toInt(options.despawnAtMs, 0));
  const instanceScope = normalizeText(options.instanceScope, "shared").toLowerCase();
  const position = normalizePosition(options.position);
  const roomStatesByKey = buildDefaultRoomStates(template, nowMs, options);
  const gateStatesByKey = buildDefaultGateStates(template, nowMs, options);
  const objectiveState = buildDefaultObjectiveState(template, nowMs, options);
  const environmentState = buildDefaultEnvironmentState(template, nowMs, options);

  return {
    instanceID,
    templateID: template.templateID,
    solarSystemID,
    siteKey,
    lifecycleState,
    lifecycleReason: normalizeText(options.lifecycleReason, "") || null,
    instanceScope,
    siteFamily: normalizeText(options.siteFamily, template.siteFamily || "unknown").toLowerCase(),
    siteKind: normalizeText(options.siteKind, template.siteKind || "unknown").toLowerCase(),
    siteOrigin: normalizeText(options.siteOrigin, template.siteOrigin || "unknown").toLowerCase(),
    source: normalizeText(template.source, "unknown").toLowerCase(),
    sourceDungeonID: template.sourceDungeonID || null,
    archetypeID: template.archetypeID || null,
    factionID: template.factionID || null,
    difficulty: template.difficulty || null,
    entryObjectTypeID: template.entryObjectTypeID || null,
    dungeonNameID: template.dungeonNameID || null,
    position,
    ownership,
    timers: {
      createdAtMs,
      activatedAtMs,
      expiresAtMs,
      despawnAtMs,
      lastUpdatedAtMs: nowMs,
    },
    roomStatesByKey,
    gateStatesByKey,
    objectiveState,
    hazardState:
      options.hazardState && typeof options.hazardState === "object"
        ? cloneValue(options.hazardState)
        : {},
    environmentState,
    spawnState:
      options.spawnState && typeof options.spawnState === "object"
        ? cloneValue(options.spawnState)
        : {},
    runtimeFlags:
      options.runtimeFlags && typeof options.runtimeFlags === "object"
        ? cloneValue(options.runtimeFlags)
        : {},
    metadata:
      options.metadata && typeof options.metadata === "object"
        ? cloneValue(options.metadata)
        : {},
  };
}

function createInstance(options = {}) {
  const template = requireTemplate(options.templateID);
  const siteKey = normalizeText(options.siteKey, "") || null;
  if (siteKey) {
    const existing = runtimeState.findInstanceSummaryBySiteKey(siteKey);
    if (existing && runtimeState.isActiveLifecycleState(existing.lifecycleState)) {
      throw dungeonError(
        "DUNGEON_SITE_KEY_IN_USE",
        `Active dungeon instance already exists for site key ${siteKey}`,
      );
    }
  }

  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  let createdInstanceID = 0;

  runtimeState.mutateState((table) => {
    const nextInstanceID = Math.max(1, toInt(table.nextInstanceSequence, 1));
    table.nextInstanceSequence = nextInstanceID + 1;
    createdInstanceID = nextInstanceID;
    table.instancesByID[String(nextInstanceID)] = buildInstanceRecordFromOptions(
      nextInstanceID,
      template,
      options,
      nowMs,
    );
    return table;
  });

  const created = runtimeState.getInstanceSnapshot(createdInstanceID);
  emitInstanceChange("created", null, created, {
    source: "createInstance",
  });
  return created;
}

function definitionsMatchActiveUniverseInstance(instance, definition, template) {
  if (!instance || !definition || !template) {
    return false;
  }
  if (!runtimeState.isActiveLifecycleState(instance.lifecycleState)) {
    return false;
  }
  if (normalizeText(instance.templateID, "") !== normalizeText(template.templateID, "")) {
    return false;
  }
  if (normalizeText(instance.siteKey, "") !== normalizeText(definition.siteKey, "")) {
    return false;
  }
  const existingHash = normalizeText(instance.metadata && instance.metadata.definitionHash, "");
  const desiredHash = normalizeText(definition.metadata && definition.metadata.definitionHash, "");
  if (!existingHash || existingHash !== desiredHash) {
    return false;
  }
  return true;
}

function normalizeTextFilterSet(values = []) {
  const entries = Array.isArray(values) ? values : [values];
  const normalized = [...new Set(entries
    .map((entry) => normalizeText(entry, "").toLowerCase())
    .filter(Boolean))];
  return normalized.length > 0 ? new Set(normalized) : null;
}

function reconcileUniverseSeededInstances(definitions = [], options = {}) {
  const normalizedDefinitions = (Array.isArray(definitions) ? definitions : [])
    .filter((definition) => definition && definition.templateID && definition.siteKey)
    .map((definition) => ({
      ...cloneValue(definition),
      solarSystemID: Math.max(0, toInt(definition.solarSystemID, 0)),
      siteKey: normalizeText(definition.siteKey, ""),
      templateID: normalizeText(definition.templateID, ""),
    }))
    .filter((definition) => definition.solarSystemID > 0 && definition.siteKey && definition.templateID);

  const targetedSystemIDs = new Set(
    (Array.isArray(options.systemIDs) ? options.systemIDs : normalizedDefinitions.map((definition) => definition.solarSystemID))
      .map((entry) => Math.max(0, toInt(entry, 0)))
      .filter((entry) => entry > 0),
  );
  const siteFamilyFilter = normalizeTextFilterSet(options.siteFamilyFilter || []);
  const spawnFamilyFilter = normalizeTextFilterSet(options.spawnFamilyFilter || []);
  const siteOriginFilter = normalizeTextFilterSet(options.siteOriginFilter || []);
  const desiredBySiteKey = new Map(
    normalizedDefinitions.map((definition) => [definition.siteKey, definition]),
  );
  const templatesByID = new Map();
  for (const definition of normalizedDefinitions) {
    if (!templatesByID.has(definition.templateID)) {
      templatesByID.set(definition.templateID, requireTemplate(definition.templateID));
    }
  }

  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const removedBefore = [];
  const createdAfter = [];
  const retainedInstanceIDs = [];
  let replacedInstances = 0;

  runtimeState.mutateState((table) => {
    const instancesByID = table.instancesByID || {};
    const existingBySiteKey = new Map();
    for (const [instanceID, rawInstance] of Object.entries(instancesByID)) {
      const instance = runtimeState.normalizeInstanceRecord({
        ...rawInstance,
        instanceID: toInt(rawInstance && rawInstance.instanceID, toInt(instanceID, 0)),
      });
      if (!(instance.runtimeFlags && instance.runtimeFlags.universeSeeded === true)) {
        continue;
      }
      if (
        siteFamilyFilter &&
        !siteFamilyFilter.has(normalizeText(instance.siteFamily, "").toLowerCase())
      ) {
        continue;
      }
      const instanceSpawnFamilyKey = normalizeText(
        instance &&
        instance.metadata &&
        instance.metadata.spawnFamilyKey,
        normalizeText(
          instance &&
          instance.spawnState &&
          instance.spawnState.spawnFamilyKey,
          instance && instance.siteFamily,
        ),
      ).toLowerCase();
      if (
        spawnFamilyFilter &&
        !spawnFamilyFilter.has(instanceSpawnFamilyKey)
      ) {
        continue;
      }
      if (
        siteOriginFilter &&
        !siteOriginFilter.has(normalizeText(instance.siteOrigin, "").toLowerCase())
      ) {
        continue;
      }
      if (
        targetedSystemIDs.size > 0 &&
        !targetedSystemIDs.has(Math.max(0, toInt(instance.solarSystemID, 0)))
      ) {
        continue;
      }
      existingBySiteKey.set(instance.siteKey, instance);
    }

    for (const [siteKey, instance] of existingBySiteKey.entries()) {
      if (!desiredBySiteKey.has(siteKey)) {
        removedBefore.push(cloneValue(instance));
        delete instancesByID[String(instance.instanceID)];
      }
    }

    let nextInstanceSequence = Math.max(1, toInt(table.nextInstanceSequence, 1));
    for (const definition of normalizedDefinitions) {
      const template = templatesByID.get(definition.templateID);
      if (!template) {
        continue;
      }
      const existing = existingBySiteKey.get(definition.siteKey) || null;
      if (existing && definitionsMatchActiveUniverseInstance(existing, definition, template)) {
        retainedInstanceIDs.push(existing.instanceID);
        continue;
      }
      if (existing) {
        removedBefore.push(cloneValue(existing));
        delete instancesByID[String(existing.instanceID)];
        replacedInstances += 1;
      }
      const nextInstanceID = nextInstanceSequence;
      nextInstanceSequence += 1;
      const created = buildInstanceRecordFromOptions(
        nextInstanceID,
        template,
        definition,
        nowMs,
      );
      instancesByID[String(nextInstanceID)] = created;
      createdAfter.push(cloneValue(created));
    }
    table.nextInstanceSequence = nextInstanceSequence;
    return table;
  });

  for (const removed of removedBefore) {
    emitInstanceChange("removed", removed, null, {
      source: "reconcileUniverseSeededInstances",
    });
  }
  for (const created of createdAfter) {
    emitInstanceChange("created", null, created, {
      source: "reconcileUniverseSeededInstances",
    });
  }

  return {
    desiredCount: normalizedDefinitions.length,
    createdCount: createdAfter.length,
    retainedCount: retainedInstanceIDs.length,
    replacedCount: replacedInstances,
    removedCount: Math.max(0, removedBefore.length - replacedInstances),
  };
}

function rotateUniversePersistentInstances(rotations = [], options = {}) {
  const normalizedRotations = (Array.isArray(rotations) ? rotations : [])
    .map((entry) => {
      const existingInstance = entry && entry.existingInstance && typeof entry.existingInstance === "object"
        ? cloneValue(entry.existingInstance)
        : null;
      const nextDefinition = entry && entry.nextDefinition && typeof entry.nextDefinition === "object"
        ? cloneValue(entry.nextDefinition)
        : null;
      return {
        existingInstance,
        nextDefinition,
      };
    })
    .filter((entry) => (
      entry.existingInstance &&
      Math.max(0, toInt(entry.existingInstance.instanceID, 0)) > 0 &&
      entry.nextDefinition &&
      normalizeText(entry.nextDefinition.templateID, "") &&
      normalizeText(entry.nextDefinition.siteKey, "")
    ));

  if (normalizedRotations.length <= 0) {
    return {
      rotatedCount: 0,
      createdCount: 0,
      removedCount: 0,
    };
  }

  const templatesByID = new Map();
  for (const rotation of normalizedRotations) {
    const templateID = normalizeText(rotation.nextDefinition.templateID, "");
    if (!templatesByID.has(templateID)) {
      templatesByID.set(templateID, requireTemplate(templateID));
    }
  }

  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const removedBefore = [];
  const createdAfter = [];

  runtimeState.mutateState((table) => {
    const instancesByID = table.instancesByID || {};
    let nextInstanceSequence = Math.max(1, toInt(table.nextInstanceSequence, 1));
    for (const rotation of normalizedRotations) {
      const existingInstanceID = Math.max(0, toInt(rotation.existingInstance.instanceID, 0));
      const existingRaw = instancesByID[String(existingInstanceID)];
      if (!existingRaw) {
        continue;
      }
      const existing = runtimeState.normalizeInstanceRecord({
        ...existingRaw,
        instanceID: toInt(existingRaw && existingRaw.instanceID, existingInstanceID),
      });
      removedBefore.push(cloneValue(existing));
      delete instancesByID[String(existing.instanceID)];

      const template = templatesByID.get(normalizeText(rotation.nextDefinition.templateID, ""));
      if (!template) {
        continue;
      }
      const nextInstanceID = nextInstanceSequence;
      nextInstanceSequence += 1;
      const created = buildInstanceRecordFromOptions(
        nextInstanceID,
        template,
        rotation.nextDefinition,
        nowMs,
      );
      instancesByID[String(nextInstanceID)] = created;
      createdAfter.push(cloneValue(created));
    }
    table.nextInstanceSequence = nextInstanceSequence;
    return table;
  });

  for (const removed of removedBefore) {
    emitInstanceChange("removed", removed, null, {
      source: "rotateUniversePersistentInstances",
    });
  }
  for (const created of createdAfter) {
    emitInstanceChange("created", null, created, {
      source: "rotateUniversePersistentInstances",
    });
  }

  return {
    rotatedCount: createdAfter.length,
    createdCount: createdAfter.length,
    removedCount: removedBefore.length,
  };
}

function activateRoom(instanceID, roomKey, options = {}) {
  const existing = requireInstance(instanceID);
  const normalizedRoomKey = normalizeText(roomKey, "");
  if (!normalizedRoomKey) {
    throw dungeonError("DUNGEON_ROOM_KEY_REQUIRED");
  }
  const roomState = existing.roomStatesByKey && existing.roomStatesByKey[normalizedRoomKey];
  if (!roomState) {
    throw dungeonError("DUNGEON_ROOM_NOT_FOUND", `Unknown dungeon room ${normalizedRoomKey}`);
  }
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  return upsertRoomState(instanceID, normalizedRoomKey, {
    state: "active",
    activatedAtMs: roomState.activatedAtMs || nowMs,
    stage: normalizeText(options.stage, roomState.stage || "room"),
    pocketID: options.pocketID != null ? toInt(options.pocketID, 0) || null : roomState.pocketID,
  }, { nowMs });
}

function completeRoom(instanceID, roomKey, options = {}) {
  const existing = requireInstance(instanceID);
  const normalizedRoomKey = normalizeText(roomKey, "");
  if (!normalizedRoomKey) {
    throw dungeonError("DUNGEON_ROOM_KEY_REQUIRED");
  }
  const roomState = existing.roomStatesByKey && existing.roomStatesByKey[normalizedRoomKey];
  if (!roomState) {
    throw dungeonError("DUNGEON_ROOM_NOT_FOUND", `Unknown dungeon room ${normalizedRoomKey}`);
  }
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  return upsertRoomState(instanceID, normalizedRoomKey, {
    state: "completed",
    completedAtMs: nowMs,
    stage: normalizeText(options.stage, roomState.stage || "room"),
  }, { nowMs });
}

function unlockGate(instanceID, gateKey, options = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  return upsertGateState(instanceID, gateKey, {
    state: "unlocked",
    unlockedAtMs: nowMs,
    destinationRoomKey:
      options.destinationRoomKey != null
        ? normalizeText(options.destinationRoomKey, "") || null
        : undefined,
  }, { nowMs });
}

function recordGateUse(instanceID, gateKey, options = {}) {
  const existing = requireInstance(instanceID);
  const normalizedGateKey = normalizeText(gateKey, "");
  if (!normalizedGateKey) {
    throw dungeonError("DUNGEON_GATE_KEY_REQUIRED");
  }
  const gateState = existing.gateStatesByKey && existing.gateStatesByKey[normalizedGateKey];
  if (!gateState) {
    throw dungeonError("DUNGEON_GATE_NOT_FOUND", `Unknown dungeon gate ${normalizedGateKey}`);
  }
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  return upsertGateState(instanceID, normalizedGateKey, {
    state: normalizeText(options.state, gateState.state || "used"),
    usesCount: Math.max(0, toInt(gateState.usesCount, 0)) + 1,
    lastUsedAtMs: nowMs,
    destinationRoomKey:
      options.destinationRoomKey != null
        ? normalizeText(options.destinationRoomKey, "") || null
        : gateState.destinationRoomKey || null,
  }, { nowMs });
}

function advanceObjective(instanceID, patch = {}, options = {}) {
  const existing = requireInstance(instanceID);
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const normalizedPatch = patch && typeof patch === "object" ? cloneValue(patch) : {};
  if (normalizedPatch.completedObjectiveID != null) {
    const completedObjectiveID = Math.max(0, toInt(normalizedPatch.completedObjectiveID, 0));
    delete normalizedPatch.completedObjectiveID;
    const currentCompleted = Array.isArray(existing.objectiveState && existing.objectiveState.completedObjectiveIDs)
      ? existing.objectiveState.completedObjectiveIDs
      : [];
    normalizedPatch.completedObjectiveIDs = [...new Set([
      ...currentCompleted.map((entry) => toInt(entry, 0)).filter((entry) => entry > 0),
      ...(completedObjectiveID > 0 ? [completedObjectiveID] : []),
    ])].sort((left, right) => left - right);
  }
  if (normalizedPatch.completedNodeID != null) {
    const completedNodeID = Math.max(0, toInt(normalizedPatch.completedNodeID, 0));
    delete normalizedPatch.completedNodeID;
    const currentCompleted = Array.isArray(existing.objectiveState && existing.objectiveState.completedNodeIDs)
      ? existing.objectiveState.completedNodeIDs
      : [];
    normalizedPatch.completedNodeIDs = [...new Set([
      ...currentCompleted.map((entry) => toInt(entry, 0)).filter((entry) => entry > 0),
      ...(completedNodeID > 0 ? [completedNodeID] : []),
    ])].sort((left, right) => left - right);
  }
  if (!normalizedPatch.state) {
    normalizedPatch.state = "in_progress";
  }
  const nextObjectiveState = {
    ...(existing.objectiveState && typeof existing.objectiveState === "object"
      ? existing.objectiveState
      : {}),
    ...normalizedPatch,
  };
  if (
    isDeepStrictEqual(
      cloneObjectiveStateForComparison(existing.objectiveState),
      cloneObjectiveStateForComparison(nextObjectiveState),
    )
  ) {
    return existing;
  }
  if (!normalizedPatch.metadata || typeof normalizedPatch.metadata !== "object") {
    normalizedPatch.metadata = {};
  }
  normalizedPatch.metadata.lastAdvancedAtMs = nowMs;
  return mergeObjectiveState(instanceID, normalizedPatch, { nowMs });
}

function upsertRoomState(instanceID, roomKey, patch = {}, options = {}) {
  const existing = requireInstance(instanceID);
  const normalizedRoomKey = normalizeText(roomKey, "");
  if (!normalizedRoomKey) {
    throw dungeonError("DUNGEON_ROOM_KEY_REQUIRED");
  }
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));

  runtimeState.mutateState((table) => {
    const target = table.instancesByID[String(existing.instanceID)];
    if (!target) {
      return table;
    }
    target.roomStatesByKey = target.roomStatesByKey || {};
    target.roomStatesByKey[normalizedRoomKey] = {
      ...(target.roomStatesByKey[normalizedRoomKey] || {}),
      ...(patch && typeof patch === "object" ? cloneValue(patch) : {}),
      roomKey: normalizedRoomKey,
      lastUpdatedAtMs: nowMs,
    };
    target.timers = target.timers || {};
    target.timers.lastUpdatedAtMs = nowMs;
    return table;
  });

  const updated = runtimeState.getInstanceSnapshot(existing.instanceID);
  emitInstanceChange("updated", existing, updated, {
    source: "upsertRoomState",
    roomKey: normalizedRoomKey,
  });
  return updated;
}

function upsertGateState(instanceID, gateKey, patch = {}, options = {}) {
  const existing = requireInstance(instanceID);
  const normalizedGateKey = normalizeText(gateKey, "");
  if (!normalizedGateKey) {
    throw dungeonError("DUNGEON_GATE_KEY_REQUIRED");
  }
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));

  runtimeState.mutateState((table) => {
    const target = table.instancesByID[String(existing.instanceID)];
    if (!target) {
      return table;
    }
    target.gateStatesByKey = target.gateStatesByKey || {};
    target.gateStatesByKey[normalizedGateKey] = {
      ...(target.gateStatesByKey[normalizedGateKey] || {}),
      ...(patch && typeof patch === "object" ? cloneValue(patch) : {}),
      gateKey: normalizedGateKey,
      lastUsedAtMs:
        patch && patch.lastUsedAtMs != null
          ? Math.max(0, toInt(patch.lastUsedAtMs, nowMs))
          : (
            target.gateStatesByKey[normalizedGateKey] &&
            target.gateStatesByKey[normalizedGateKey].lastUsedAtMs
          ) || 0,
    };
    target.timers = target.timers || {};
    target.timers.lastUpdatedAtMs = nowMs;
    return table;
  });

  const updated = runtimeState.getInstanceSnapshot(existing.instanceID);
  emitInstanceChange("updated", existing, updated, {
    source: "upsertGateState",
    gateKey: normalizedGateKey,
  });
  return updated;
}

function mergeObjectiveState(instanceID, patch = {}, options = {}) {
  const existing = requireInstance(instanceID);
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));

  runtimeState.mutateState((table) => {
    const target = table.instancesByID[String(existing.instanceID)];
    if (!target) {
      return table;
    }
    target.objectiveState = {
      ...(target.objectiveState || {}),
      ...(patch && typeof patch === "object" ? cloneValue(patch) : {}),
    };
    target.timers = target.timers || {};
    target.timers.lastUpdatedAtMs = nowMs;
    return table;
  });

  const updated = runtimeState.getInstanceSnapshot(existing.instanceID);
  emitInstanceChange("updated", existing, updated, {
    source: "mergeObjectiveState",
  });
  return updated;
}

function setLifecycleState(instanceID, lifecycleState, options = {}) {
  const existing = requireInstance(instanceID);
  const normalizedLifecycleState = normalizeText(lifecycleState, "").toLowerCase();
  if (!normalizedLifecycleState) {
    throw dungeonError("DUNGEON_LIFECYCLE_STATE_REQUIRED");
  }

  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  runtimeState.mutateState((table) => {
    const target = table.instancesByID[String(existing.instanceID)];
    if (!target) {
      return table;
    }
    target.lifecycleState = normalizedLifecycleState;
    target.lifecycleReason = normalizeText(options.lifecycleReason, "") || target.lifecycleReason || null;
    target.timers = target.timers || {};
    target.timers.lastUpdatedAtMs = nowMs;
    if (normalizedLifecycleState === "active" && !target.timers.activatedAtMs) {
      target.timers.activatedAtMs = nowMs;
    }
    if (normalizedLifecycleState === "completed") {
      target.timers.completedAtMs = Math.max(0, toInt(options.completedAtMs, nowMs));
    }
    if (normalizedLifecycleState === "failed") {
      target.timers.failedAtMs = Math.max(0, toInt(options.failedAtMs, nowMs));
    }
    if (normalizedLifecycleState === "despawned") {
      target.timers.despawnAtMs = Math.max(0, toInt(options.despawnAtMs, nowMs));
    }
    if (options.expiresAtMs != null) {
      target.timers.expiresAtMs = Math.max(0, toInt(options.expiresAtMs, 0));
    }
    return table;
  });

  const updated = runtimeState.getInstanceSnapshot(existing.instanceID);
  emitInstanceChange("updated", existing, updated, {
    source: "setLifecycleState",
  });
  return updated;
}

function purgeInstance(instanceID) {
  const existing = requireInstance(instanceID);
  runtimeState.mutateState((table) => {
    delete table.instancesByID[String(existing.instanceID)];
    return table;
  });
  emitInstanceChange("removed", existing, null, {
    source: "purgeInstance",
  });
  return true;
}

function purgeShadowProviderInstances(options = {}) {
  const providerFilter = normalizeText(options.providerID, "").toLowerCase() || null;
  const siteFamilyFilter = normalizeText(options.siteFamily, "").toLowerCase() || null;
  const siteOriginFilter = normalizeText(options.siteOrigin, "").toLowerCase() || null;
  const removed = [];

  runtimeState.mutateState((table) => {
    const instancesByID = table.instancesByID || {};
    for (const [instanceID, rawInstance] of Object.entries(instancesByID)) {
      const instance = runtimeState.normalizeInstanceRecord({
        ...rawInstance,
        instanceID: toInt(rawInstance && rawInstance.instanceID, toInt(instanceID, 0)),
      });
      if (!(instance.runtimeFlags && instance.runtimeFlags.shadowProviderSite === true)) {
        continue;
      }
      if (
        providerFilter &&
        normalizeText(instance && instance.metadata && instance.metadata.providerID, "").toLowerCase() !== providerFilter
      ) {
        continue;
      }
      if (siteFamilyFilter && normalizeText(instance.siteFamily, "").toLowerCase() !== siteFamilyFilter) {
        continue;
      }
      if (siteOriginFilter && normalizeText(instance.siteOrigin, "").toLowerCase() !== siteOriginFilter) {
        continue;
      }
      removed.push(cloneValue(instance));
      delete instancesByID[String(instance.instanceID)];
    }
    return table;
  });

  for (const instance of removed) {
    emitInstanceChange("removed", instance, null, {
      source: "purgeShadowProviderInstances",
    });
  }

  return {
    removedCount: removed.length,
    removedInstanceIDs: removed.map((instance) => instance.instanceID),
  };
}

function getInstance(instanceID) {
  return runtimeState.getInstanceSnapshot(instanceID);
}

function getInstanceSummary(instanceID) {
  return runtimeState.getInstanceSummary(instanceID);
}

function findInstanceBySiteKey(siteKey, options = {}) {
  const summary = runtimeState.findInstanceSummaryBySiteKey(siteKey);
  if (!summary) {
    return null;
  }
  if (
    options.activeOnly === true &&
    !runtimeState.isActiveLifecycleState(summary.lifecycleState)
  ) {
    return null;
  }
  return options.full === true
    ? runtimeState.getInstanceSnapshot(summary.instanceID)
    : summary;
}

function listInstancesBySystem(solarSystemID, options = {}) {
  const summaries = runtimeState.listInstanceSummariesBySystem(solarSystemID, options);
  if (options.full !== true) {
    return summaries;
  }
  return summaries
    .map((summary) => runtimeState.getInstanceSnapshot(summary.instanceID))
    .filter(Boolean);
}

function listActiveInstancesBySystem(solarSystemID, options = {}) {
  return listInstancesBySystem(solarSystemID, {
    ...options,
    activeOnly: true,
  });
}

function listInstancesByTemplate(templateID, options = {}) {
  const summaries = runtimeState.listInstanceSummariesByTemplate(templateID, options);
  if (options.full !== true) {
    return summaries;
  }
  return summaries
    .map((summary) => runtimeState.getInstanceSnapshot(summary.instanceID))
    .filter(Boolean);
}

function listInstancesByFamily(siteFamily, options = {}) {
  const summaries = runtimeState.listInstanceSummariesByFamily(siteFamily, options);
  if (options.full !== true) {
    return summaries;
  }
  return summaries
    .map((summary) => runtimeState.getInstanceSnapshot(summary.instanceID))
    .filter(Boolean);
}

function listInstancesByLifecycle(lifecycleState, options = {}) {
  const summaries = runtimeState.listInstanceSummariesByLifecycle(lifecycleState, options);
  if (options.full !== true) {
    return summaries;
  }
  return summaries
    .map((summary) => runtimeState.getInstanceSnapshot(summary.instanceID))
    .filter(Boolean);
}

function mergeStateField(instanceID, fieldName, patch = {}, options = {}) {
  const existing = requireInstance(instanceID);
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const normalizedPatch = patch && typeof patch === "object" ? cloneValue(patch) : {};

  runtimeState.mutateState((table) => {
    const target = table.instancesByID[String(existing.instanceID)];
    if (!target) {
      return table;
    }
    target[fieldName] = {
      ...(target[fieldName] && typeof target[fieldName] === "object" ? target[fieldName] : {}),
      ...normalizedPatch,
    };
    target.timers = target.timers || {};
    target.timers.lastUpdatedAtMs = nowMs;
    return table;
  });

  const updated = runtimeState.getInstanceSnapshot(existing.instanceID);
  emitInstanceChange("updated", existing, updated, {
    source: `merge:${fieldName}`,
  });
  return updated;
}

function mergeHazardState(instanceID, patch = {}, options = {}) {
  return mergeStateField(instanceID, "hazardState", patch, options);
}

function mergeEnvironmentState(instanceID, patch = {}, options = {}) {
  return mergeStateField(instanceID, "environmentState", patch, options);
}

function mergeSpawnState(instanceID, patch = {}, options = {}) {
  return mergeStateField(instanceID, "spawnState", patch, options);
}

function synchronizeInstancePosition(instanceID, position, options = {}) {
  const existing = requireInstance(instanceID);
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const normalizedPosition = normalizePosition(position);

  runtimeState.mutateState((table) => {
    const target = table.instancesByID[String(existing.instanceID)];
    if (!target) {
      return table;
    }
    target.position = normalizedPosition;
    target.timers = target.timers || {};
    target.timers.lastUpdatedAtMs = nowMs;
    return table;
  });

  const updated = runtimeState.getInstanceSnapshot(existing.instanceID);
  emitInstanceChange("updated", existing, updated, {
    source: "synchronizeInstancePosition",
  });
  return updated;
}

function tickRuntime(options = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const emitChanges = options.emitChanges !== false;
  const nextExpiryAtMs = runtimeState.getNextActiveExpiryAtMs();
  if (nextExpiryAtMs <= 0 || nextExpiryAtMs > nowMs) {
    return {
      expiredCount: 0,
      expiredInstanceIDs: [],
      nextExpiryAtMs,
    };
  }

  const expiredSummaries = runtimeState.listExpiredActiveInstanceSummaries(nowMs);

  if (expiredSummaries.length <= 0) {
    return {
      expiredCount: 0,
      expiredInstanceIDs: [],
      nextExpiryAtMs,
    };
  }

  const beforeByID = emitChanges
    ? new Map(
      expiredSummaries.map((summary) => [summary.instanceID, runtimeState.getInstanceSnapshot(summary.instanceID)]),
    )
    : null;
  const expiredInstanceIDs = [];
  runtimeState.mutateState((table) => {
    for (const summary of expiredSummaries) {
      const target = table.instancesByID[String(summary.instanceID)];
      if (!target) {
        continue;
      }
      target.lifecycleState = "despawned";
      target.lifecycleReason =
        normalizeText(options.lifecycleReason, "") ||
        normalizeText(target.lifecycleReason, "") ||
        "expired";
      target.timers = target.timers || {};
      target.timers.lastUpdatedAtMs = nowMs;
      target.timers.despawnAtMs = Math.max(
        0,
        toInt(target.timers.despawnAtMs, 0),
        nowMs,
      );
      expiredInstanceIDs.push(summary.instanceID);
    }
    return table;
  });

  if (emitChanges) {
    for (const instanceID of expiredInstanceIDs) {
      emitInstanceChange(
        "updated",
        beforeByID.get(instanceID) || null,
        runtimeState.getInstanceSnapshot(instanceID),
        {
          source: "tickRuntime",
          transition: "expired",
        },
      );
    }
  }

  return {
    expiredCount: expiredInstanceIDs.length,
    expiredInstanceIDs,
    nextExpiryAtMs,
  };
}

function listUniversePersistentTerminalInstances(options = {}) {
  const instanceIDs = runtimeState.listUniversePersistentTerminalInstanceIDs();
  const full = options.full === true;
  return instanceIDs
    .map((instanceID) => (full ? getInstance(instanceID) : getInstanceSummary(instanceID)))
    .filter(Boolean);
}

function startTicker(options = {}) {
  if (runtimeTicker) {
    return runtimeTicker;
  }
  const intervalMs = Math.max(250, toInt(options.intervalMs, 1000));
  runtimeTicker = setInterval(() => {
    tickRuntime();
  }, intervalMs);
  if (typeof runtimeTicker.unref === "function") {
    runtimeTicker.unref();
  }
  return runtimeTicker;
}

function stopTicker() {
  if (runtimeTicker) {
    clearInterval(runtimeTicker);
    runtimeTicker = null;
  }
}

function clearRuntimeCache() {
  runtimeState.clearRuntimeCache();
}

function resetRuntimeForTests() {
  stopTicker();
  runtimeState.resetRuntimeStateForTests();
}

module.exports = {
  clearRuntimeCache,
  createInstance,
  activateRoom,
  advanceObjective,
  completeRoom,
  ensureTemplateRuntimeState,
  findInstanceBySiteKey,
  getInstance,
  getInstanceSummary,
  listActiveInstancesBySystem,
  listInstancesByLifecycle,
  listInstancesByFamily,
  listInstancesBySystem,
  listInstancesByTemplate,
  listUniversePersistentTerminalInstances,
  mergeEnvironmentState,
  mergeHazardState,
  mergeObjectiveState,
  mergeSpawnState,
  purgeInstance,
  purgeShadowProviderInstances,
  registerInstanceChangeListener,
  reconcileUniverseSeededInstances,
  rotateUniversePersistentInstances,
  recordGateUse,
  resetRuntimeForTests,
  startTicker,
  setLifecycleState,
  stopTicker,
  synchronizeInstancePosition,
  tickRuntime,
  unlockGate,
  unregisterInstanceChangeListener,
  upsertGateState,
  upsertRoomState,
};
