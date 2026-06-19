"use strict";

const fs = require("fs");
const path = require("path");

const geo2 = require(path.join(__dirname, "../common/geo2"));
const spaceRuntime = require(path.join(__dirname, "./runtime"));
const worldData = require(path.join(__dirname, "./worldData"));
const {
  resolveStargatePhysicalRadius,
} = require(path.join(__dirname, "./stargateRadius"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../services/_shared/referenceData"));

const CHAT_FEEDBACK_AQUA = "0xFF80FFFF";
const DEFAULT_UP = Object.freeze({ x: 0, y: 1, z: 0 });
const DEFAULT_FORWARD = Object.freeze({ x: 0, y: 0, z: 1 });
const DEFAULT_RIGHT = Object.freeze({ x: 1, y: 0, z: 0 });
const DEFAULT_STARGATE_RADIUS_METERS = 15_000;
const DEFAULT_STARGATE_INTERACTION_RADIUS_METERS = 2_500;
const GATE_SKIN_COMMAND_ITEM_ID_BASE = 9_120_000_000_000;
const GATE_SKIN_FORWARD_OFFSET_METERS = 90_000;
const GATE_SKIN_LINE_SPACING_METERS = 10_000;
const GATE_SKIN_CYCLE_INTERVAL_MS = 10_000;

const GATE_SKIN_CHAT_COMMANDS = Object.freeze(["gateskin"]);
const GATE_SKIN_HELP_LINES = Object.freeze([
  "/gateskin [start|stop|list]",
]);

const FACTION_GATE_PRESETS = Object.freeze([
  Object.freeze({
    key: "amarr",
    label: "Amarr",
    typeID: 29624,
    raceHint: "amarr",
  }),
  Object.freeze({
    key: "caldari",
    label: "Caldari",
    typeID: 16,
    raceHint: "caldari",
  }),
  Object.freeze({
    key: "minmatar",
    label: "Minmatar",
    typeID: 29633,
    raceHint: "minmatar",
  }),
  Object.freeze({
    key: "gallente",
    label: "Gallente",
    typeID: 3875,
    raceHint: "gallente",
  }),
]);

const SHARED_PREVIEW_MATERIAL_RACE_HINTS = Object.freeze(new Set([
  "concord",
  "generic",
]));
const EXTRA_PREVIEW_MATERIAL_SET_IDS = Object.freeze(new Set([
  327, // SARO 'Black Troop'
  3636, // Concord Base, observed on TQ Yulai/Manifest gates.
  3641, // AIR Structure
]));
const EXTRA_PREVIEW_MATERIAL_ORDER = Object.freeze([3636, 3641, 327]);

let cachedGraphicMaterialSets = null;
let cachedGateTypeRecords = null;
let nextGateSkinPreviewItemID = 0;
const activeGateSkinShowcasesByCharacterID = new Map();

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(value, fallback = { x: 0, y: 0, z: 0 }) {
  return geo2.readVec3(value, fallback);
}

function addVectors(left, right) {
  const a = cloneVector(left);
  const b = cloneVector(right);
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

function subtractVectors(left, right) {
  const a = cloneVector(left);
  const b = cloneVector(right);
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function scaleVector(vector, factor) {
  const source = cloneVector(vector);
  const scale = toFiniteNumber(factor, 0);
  return {
    x: source.x * scale,
    y: source.y * scale,
    z: source.z * scale,
  };
}

function vectorMagnitude(vector) {
  const v = cloneVector(vector);
  return Math.sqrt((v.x * v.x) + (v.y * v.y) + (v.z * v.z));
}

function normalizeVector(vector, fallback = DEFAULT_FORWARD) {
  const source = cloneVector(vector, fallback);
  const length = vectorMagnitude(source);
  if (!Number.isFinite(length) || length <= 0) {
    return cloneVector(fallback);
  }
  return scaleVector(source, 1 / length);
}

function crossVector(left, right) {
  return geo2.Vec3Cross(left, right);
}

function getRepositoryRoot() {
  return path.resolve(__dirname, "../../..");
}

function listFilesByName(rootPath, fileName) {
  if (!fs.existsSync(rootPath)) {
    return [];
  }
  const stack = [rootPath];
  const results = [];
  while (stack.length > 0) {
    const currentPath = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (_error) {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name === fileName) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function findLatestGraphicMaterialSetsPath() {
  const exportRoot = path.join(getRepositoryRoot(), "tools", "ClientSDE", "exports");
  return listFilesByName(exportRoot, "graphicmaterialsets.jsonl")
    .map((filePath) => {
      let modifiedAtMs = 0;
      try {
        modifiedAtMs = fs.statSync(filePath).mtimeMs;
      } catch (_error) {
        modifiedAtMs = 0;
      }
      return { filePath, modifiedAtMs };
    })
    .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)
    .map((entry) => entry.filePath)[0] || null;
}

function normalizeGraphicMaterialSet(row) {
  const materialSetID = toInt(
    row && row._key != null ? row._key : row && row.materialSetID,
    0,
  );
  if (materialSetID <= 0) {
    return null;
  }
  const description = String(
    (row && (row.description || row.name || row.sofFactionName)) ||
      `Material Set ${materialSetID}`,
  ).trim();
  return {
    materialSetID,
    description: description || `Material Set ${materialSetID}`,
    sofFactionName: String((row && row.sofFactionName) || "").trim(),
    sofRaceHint: String((row && row.sofRaceHint) || "").trim().toLowerCase(),
  };
}

function loadGraphicMaterialSets() {
  if (cachedGraphicMaterialSets) {
    return cachedGraphicMaterialSets;
  }
  const filePath = findLatestGraphicMaterialSetsPath();
  if (!filePath) {
    cachedGraphicMaterialSets = [];
    return cachedGraphicMaterialSets;
  }

  const rows = [];
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const normalized = normalizeGraphicMaterialSet(JSON.parse(trimmed));
      if (normalized) {
        rows.push(normalized);
      }
    } catch (_error) {
      continue;
    }
  }
  cachedGraphicMaterialSets = rows.sort(
    (left, right) => left.materialSetID - right.materialSetID,
  );
  return cachedGraphicMaterialSets;
}

function getGateSkinMaterialsForRaceHint(raceHint) {
  const normalizedRaceHint = String(raceHint || "").trim().toLowerCase();
  const byID = new Map();
  for (const material of loadGraphicMaterialSets()) {
    const materialRaceHint = String(material.sofRaceHint || "").toLowerCase();
    if (
      materialRaceHint === normalizedRaceHint ||
      SHARED_PREVIEW_MATERIAL_RACE_HINTS.has(materialRaceHint) ||
      EXTRA_PREVIEW_MATERIAL_SET_IDS.has(material.materialSetID)
    ) {
      byID.set(material.materialSetID, material);
    }
  }
  return [...byID.values()].sort((left, right) => {
    const leftExtraIndex = EXTRA_PREVIEW_MATERIAL_ORDER.indexOf(left.materialSetID);
    const rightExtraIndex = EXTRA_PREVIEW_MATERIAL_ORDER.indexOf(right.materialSetID);
    if (leftExtraIndex !== -1 || rightExtraIndex !== -1) {
      if (leftExtraIndex === -1) {
        return 1;
      }
      if (rightExtraIndex === -1) {
        return -1;
      }
      return leftExtraIndex - rightExtraIndex;
    }
    return left.materialSetID - right.materialSetID;
  });
}

function getGateSkinMaterialCatalogue() {
  const catalogue = {};
  for (const preset of FACTION_GATE_PRESETS) {
    catalogue[preset.key] = getGateSkinMaterialsForRaceHint(preset.raceHint);
  }
  return catalogue;
}

function buildGateSkinListMessage(argumentText = "") {
  const query = String(argumentText || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)[1];
  const catalogue = getGateSkinMaterialCatalogue();
  const selectedPresets = FACTION_GATE_PRESETS.filter((preset) =>
    !query || preset.key.startsWith(query.toLowerCase()),
  );
  const presets = selectedPresets.length > 0
    ? selectedPresets
    : FACTION_GATE_PRESETS;

  return presets
    .map((preset) => {
      const materials = catalogue[preset.key] || [];
      const preview = materials
        .slice(0, 10)
        .map((material) => `${material.materialSetID}:${material.description}`)
        .join(", ");
      const suffix = materials.length > 10 ? ", ..." : "";
      return `${preset.label}: ${materials.length} material sets (${preview}${suffix})`;
    })
    .join(" | ");
}

function buildGateTypeRecords() {
  if (cachedGateTypeRecords) {
    return cachedGateTypeRecords;
  }
  const samplesByTypeID = new Map();
  for (const sample of readStaticRows(TABLE.STARGATES) || []) {
    const typeID = toInt(sample && sample.typeID, 0);
    if (typeID > 0 && !samplesByTypeID.has(typeID)) {
      samplesByTypeID.set(typeID, sample);
    }
  }
  const recordsByTypeID = new Map();
  for (const row of readStaticRows(TABLE.STARGATE_TYPES) || []) {
    const typeID = toInt(row && row.typeID, 0);
    if (typeID <= 0) {
      continue;
    }
    recordsByTypeID.set(typeID, {
      typeID,
      typeName: String((row && row.typeName) || `Stargate ${typeID}`).trim(),
      groupID: toInt(row && row.groupID, 10) || 10,
      categoryID: toInt(row && row.categoryID, 2) || 2,
      groupName: String((row && row.groupName) || "Stargate").trim(),
      raceID: row && row.raceID != null ? toInt(row.raceID, 0) : null,
      graphicID: row && row.graphicID != null ? toInt(row.graphicID, 0) : null,
      sample: samplesByTypeID.get(typeID) || null,
    });
  }
  cachedGateTypeRecords = recordsByTypeID;
  return cachedGateTypeRecords;
}

function getGateTypeRecord(typeID) {
  return buildGateTypeRecords().get(toInt(typeID, 0)) || null;
}

function getTypeRecordPhysicalRadius(typeRecord) {
  return resolveStargatePhysicalRadius(
    {
      typeID: typeRecord && typeRecord.typeID,
      radius: typeRecord && typeRecord.sample && typeRecord.sample.radius,
    },
    {
      fallbackRadius: DEFAULT_STARGATE_RADIUS_METERS,
    },
  );
}

function getTypeRecordInteractionRadius(typeRecord) {
  return (
    toFiniteNumber(
      typeRecord &&
        typeRecord.sample &&
        typeRecord.sample.interactionRadius,
      DEFAULT_STARGATE_INTERACTION_RADIUS_METERS,
    ) || DEFAULT_STARGATE_INTERACTION_RADIUS_METERS
  );
}

function getShipSceneContext(session) {
  if (!session || !session.characterID || !session._space) {
    return { success: false, errorMsg: "NOT_IN_SPACE" };
  }
  const scene = spaceRuntime.getSceneForSession(session);
  if (!scene) {
    return { success: false, errorMsg: "SCENE_NOT_FOUND" };
  }
  const shipEntity =
    (typeof scene.getShipEntityForSession === "function" &&
      scene.getShipEntityForSession(session)) ||
    (typeof scene.getEntityByID === "function" &&
      scene.getEntityByID(toInt(session._space.shipID, 0)));
  if (!shipEntity) {
    return { success: false, errorMsg: "SHIP_NOT_FOUND" };
  }
  const sourceSystem = worldData.getSolarSystemByID(scene.systemID);
  if (!sourceSystem) {
    return { success: false, errorMsg: "SOLAR_SYSTEM_NOT_FOUND" };
  }
  return {
    success: true,
    scene,
    shipEntity,
    sourceSystem,
  };
}

function buildShipOrientationFrame(shipEntity) {
  const shipPosition = cloneVector(shipEntity && shipEntity.position);
  const fallbackForward = vectorMagnitude(shipPosition) > 0
    ? shipPosition
    : DEFAULT_FORWARD;
  const forward = normalizeVector(shipEntity && shipEntity.direction, fallbackForward);
  let right = crossVector(DEFAULT_UP, forward);
  if (vectorMagnitude(right) <= 0.0001) {
    right = cloneVector(DEFAULT_RIGHT);
  }
  right = normalizeVector(right, DEFAULT_RIGHT);
  let up = crossVector(forward, right);
  if (vectorMagnitude(up) <= 0.0001) {
    up = cloneVector(DEFAULT_UP);
  }
  up = normalizeVector(up, DEFAULT_UP);
  return { forward, right, up };
}

function allocateGateSkinPreviewItemID(scene) {
  let candidate =
    GATE_SKIN_COMMAND_ITEM_ID_BASE + nextGateSkinPreviewItemID;
  nextGateSkinPreviewItemID += 1;
  while (
    scene &&
    typeof scene.getEntityByID === "function" &&
    scene.getEntityByID(candidate)
  ) {
    candidate = GATE_SKIN_COMMAND_ITEM_ID_BASE + nextGateSkinPreviewItemID;
    nextGateSkinPreviewItemID += 1;
  }
  return candidate;
}

function getSystemOwnerID(system) {
  const factionID = toInt(system && system.factionID, 0);
  return factionID > 0 ? factionID : 1;
}

function buildPreviewPositions(shipEntity) {
  const shipPosition = cloneVector(shipEntity && shipEntity.position);
  const { forward, right } = buildShipOrientationFrame(shipEntity);
  const center = addVectors(
    shipPosition,
    scaleVector(forward, GATE_SKIN_FORWARD_OFFSET_METERS),
  );
  const startOffset =
    -((FACTION_GATE_PRESETS.length - 1) * GATE_SKIN_LINE_SPACING_METERS) / 2;
  return FACTION_GATE_PRESETS.map((preset, index) => ({
    preset,
    position: addVectors(
      center,
      scaleVector(
        right,
        startOffset + (index * GATE_SKIN_LINE_SPACING_METERS),
      ),
    ),
  }));
}

function buildDunRotationToward(position, lookAtPosition) {
  return (
    geo2.buildDunRotationFromDirection(
      subtractVectors(lookAtPosition, position),
    ) || [0, 0, 0]
  );
}

function buildGateSkinPreviewEntity(options) {
  const scene = options.scene;
  const sourceSystem = options.sourceSystem;
  const shipPosition = cloneVector(options.shipPosition);
  const preset = options.preset;
  const typeRecord = getGateTypeRecord(preset.typeID);
  const material = options.material;
  if (!typeRecord || !material) {
    return null;
  }
  const itemID = allocateGateSkinPreviewItemID(scene);
  const position = cloneVector(options.position);
  const ownerID = getSystemOwnerID(sourceSystem);
  return {
    kind: "stargate",
    itemID,
    typeID: typeRecord.typeID,
    groupID: typeRecord.groupID,
    categoryID: typeRecord.categoryID,
    itemName:
      `Gate Skin Preview (${preset.label}) - ${material.description}`,
    ownerID,
    radius: getTypeRecordPhysicalRadius(typeRecord),
    interactionRadius: getTypeRecordInteractionRadius(typeRecord),
    position,
    velocity: { x: 0, y: 0, z: 0 },
    typeName: typeRecord.typeName,
    groupName: typeRecord.groupName,
    graphicID: typeRecord.graphicID,
    raceID: typeRecord.raceID,
    destinationID: toInt(sourceSystem && sourceSystem.solarSystemID, 0),
    destinationSolarSystemID: toInt(sourceSystem && sourceSystem.solarSystemID, 0),
    activationState:
      spaceRuntime &&
      spaceRuntime._testing &&
      spaceRuntime._testing.STARGATE_ACTIVATION_STATE
        ? spaceRuntime._testing.STARGATE_ACTIVATION_STATE.OPEN
        : 2,
    activationTransitionAtMs: 0,
    poseID: 0,
    localCorruptionStageAndMaximum: [0, 1],
    destinationCorruptionStageAndMaximum: [0, 1],
    localSuppressionStageAndMaximum: [0, 1],
    destinationSuppressionStageAndMaximum: [0, 1],
    hasVolumetricDrifterCloud: false,
    originSystemOwnerID: ownerID,
    destinationSystemOwnerID: ownerID,
    destinationSystemWarning: null,
    destinationSystemWarningIcon: null,
    destinationSystemStatusIcons: [],
    dunRotation: buildDunRotationToward(position, shipPosition),
    skinMaterialSetID: material.materialSetID,
    transientElysianStargate: true,
    gateSkinPreview: true,
  };
}

function buildGateSkinPreviewEntries(context) {
  const catalogue = getGateSkinMaterialCatalogue();
  const shipPosition = cloneVector(context.shipEntity.position);
  return buildPreviewPositions(context.shipEntity)
    .map(({ preset, position }) => {
      const materials = catalogue[preset.key] || [];
      const material = materials[0] || null;
      const entity = buildGateSkinPreviewEntity({
        scene: context.scene,
        sourceSystem: context.sourceSystem,
        shipPosition,
        preset,
        position,
        material,
      });
      if (!entity) {
        return null;
      }
      return {
        preset,
        entity,
        materials,
      };
    })
    .filter(Boolean);
}

function sendGateSkinFeedback(active, message) {
  if (
    active &&
    active.chatHub &&
    active.session &&
    message
  ) {
    active.chatHub.sendSystemMessage(
      active.session,
      `<color=${CHAT_FEEDBACK_AQUA}>${message}</color>`,
      active.feedbackChannel || null,
    );
  }
}

function formatMaterial(material) {
  if (!material) {
    return "none";
  }
  return `${material.materialSetID} ${material.description}`;
}

function scheduleGateSkinPreviewModelRefresh(active, entities) {
  if (
    !active ||
    !active.scene ||
    !Array.isArray(entities) ||
    entities.length <= 0 ||
    typeof active.scene.broadcastRemoveStaticEntity !== "function" ||
    typeof active.scene.broadcastAddBalls !== "function"
  ) {
    return false;
  }

  for (const entity of entities) {
    active.scene.broadcastRemoveStaticEntity(entity.itemID, null, {
      terminalDestructionEffectID: 0,
    });
  }

  const refreshTimer = setTimeout(() => {
    if (active.refreshTimers instanceof Set) {
      active.refreshTimers.delete(refreshTimer);
    }
    const currentActive =
      activeGateSkinShowcasesByCharacterID.get(active.characterID);
    if (currentActive !== active || !active.scene) {
      return;
    }
    const liveEntities = entities
      .map((entity) =>
        typeof active.scene.getEntityByID === "function"
          ? active.scene.getEntityByID(entity.itemID)
          : entity,
      )
      .filter(Boolean);
    if (liveEntities.length > 0) {
      active.scene.broadcastAddBalls(liveEntities, null, {
        freshAcquire: true,
      });
    }
  }, 350);
  if (typeof refreshTimer.unref === "function") {
    refreshTimer.unref();
  }
  if (!(active.refreshTimers instanceof Set)) {
    active.refreshTimers = new Set();
  }
  active.refreshTimers.add(refreshTimer);
  return true;
}

function applyGateSkinCycle(active, options = {}) {
  if (!active || !active.scene) {
    return false;
  }
  if (
    !active.session ||
    !active.session._space ||
    toInt(active.session._space.systemID, 0) !== active.systemID
  ) {
    stopGateSkinShowcaseByCharacterID(active.characterID, {
      broadcast: false,
    });
    return false;
  }

  const changedEntities = [];
  const labels = [];
  for (const gate of active.gates) {
    const entity =
      typeof active.scene.getEntityByID === "function"
        ? active.scene.getEntityByID(gate.itemID)
        : null;
    const materials = gate.materials || [];
    if (!entity || materials.length <= 0) {
      continue;
    }
    const material = materials[active.cycleIndex % materials.length];
    entity.skinMaterialSetID = material.materialSetID;
    entity.itemName =
      `Gate Skin Preview (${gate.label}) - ${material.description}`;
    changedEntities.push(entity);
    labels.push(`${gate.label}: ${formatMaterial(material)}`);
  }

  if (changedEntities.length > 0) {
    const refreshScheduled = scheduleGateSkinPreviewModelRefresh(
      active,
      changedEntities,
    );
    if (!refreshScheduled) {
      active.scene.broadcastSlimItemChanges(changedEntities);
    }
  }
  if (options.announce !== false && labels.length > 0) {
    sendGateSkinFeedback(
      active,
      `Gate skin cycle ${active.cycleIndex + 1}: ${labels.join(" | ")}`,
    );
  }
  return true;
}

function stopGateSkinShowcaseByCharacterID(characterID, options = {}) {
  const normalizedCharacterID = toInt(characterID, 0);
  const active = activeGateSkinShowcasesByCharacterID.get(normalizedCharacterID);
  if (!active) {
    return 0;
  }
  activeGateSkinShowcasesByCharacterID.delete(normalizedCharacterID);
  if (active.timer) {
    clearInterval(active.timer);
  }
  if (active.refreshTimers instanceof Set) {
    for (const timer of active.refreshTimers) {
      clearTimeout(timer);
    }
    active.refreshTimers.clear();
  }

  let removedCount = 0;
  if (active.scene) {
    for (const itemID of active.entityIDs || []) {
      if (typeof active.scene.removeStaticEntity !== "function") {
        continue;
      }
      const result = active.scene.removeStaticEntity(itemID, {
        broadcast: options.broadcast !== false,
      });
      if (result && result.success) {
        removedCount += 1;
      }
    }
  }
  return removedCount;
}

function stopGateSkinShowcase(session) {
  const characterID = toInt(session && session.characterID, 0);
  if (characterID <= 0) {
    return {
      success: false,
      message: "No active character found for /gateskin stop.",
    };
  }
  const removedCount = stopGateSkinShowcaseByCharacterID(characterID);
  return {
    success: true,
    message:
      removedCount > 0
        ? `Stopped /gateskin and removed ${removedCount} preview gates.`
        : "No active /gateskin preview gates were running for this character.",
  };
}

function startGateSkinShowcase(session, context, callbackOptions = {}) {
  stopGateSkinShowcaseByCharacterID(session.characterID);
  const entries = buildGateSkinPreviewEntries(context);
  if (entries.length <= 0) {
    return {
      success: false,
      message: "No gate skin material sets were available to preview.",
    };
  }

  const addedEntities = [];
  for (const entry of entries) {
    if (context.scene.addStaticEntity(entry.entity)) {
      addedEntities.push(entry.entity);
    }
  }
  if (addedEntities.length <= 0) {
    return {
      success: false,
      message: "Could not add /gateskin preview gates to the current scene.",
    };
  }
  context.scene.broadcastAddBalls(addedEntities);

  const active = {
    characterID: toInt(session.characterID, 0),
    systemID: toInt(context.scene.systemID, 0),
    session,
    scene: context.scene,
    chatHub: callbackOptions.chatHub || null,
    feedbackChannel: callbackOptions.feedbackChannel || null,
    cycleIndex: 0,
    entityIDs: addedEntities.map((entity) => entity.itemID),
    gates: entries
      .filter((entry) => addedEntities.includes(entry.entity))
      .map((entry) => ({
        itemID: entry.entity.itemID,
        key: entry.preset.key,
        label: entry.preset.label,
        materials: entry.materials,
      })),
    refreshTimers: new Set(),
    timer: null,
  };
  active.timer = setInterval(() => {
    active.cycleIndex += 1;
    applyGateSkinCycle(active);
  }, GATE_SKIN_CYCLE_INTERVAL_MS);
  if (typeof active.timer.unref === "function") {
    active.timer.unref();
  }
  activeGateSkinShowcasesByCharacterID.set(active.characterID, active);

  const counts = active.gates
    .map((gate) => `${gate.label}=${gate.materials.length}`)
    .join(", ");
  const startingMaterials = active.gates
    .map((gate) => `${gate.label}: ${formatMaterial(gate.materials[0])}`)
    .join(" | ");
  return {
    success: true,
    message:
      `Spawned ${addedEntities.length} gate skin preview gates 10km apart. ` +
      `Starting: ${startingMaterials}. ` +
      `Cycling every 10s. Material counts: ${counts}. Use /gateskin stop to clear.`,
  };
}

function executeGateSkinCommand(session, argumentText, callbackOptions = {}) {
  const action = String(argumentText || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)[0]
    ?.toLowerCase() || "start";

  if (action === "stop" || action === "clear") {
    return stopGateSkinShowcase(session);
  }
  if (action === "list" || action === "materials") {
    return {
      success: true,
      message: buildGateSkinListMessage(argumentText),
    };
  }
  if (action !== "start" && action !== "spawn" && action !== "cycle") {
    return {
      success: false,
      message: "Usage: /gateskin [start|stop|list]",
    };
  }

  const context = getShipSceneContext(session);
  if (!context.success) {
    return {
      success: false,
      message:
        context.errorMsg === "NOT_IN_SPACE"
          ? "You must be in space to use /gateskin."
          : "Current space scene is unavailable for /gateskin.",
    };
  }

  return startGateSkinShowcase(session, context, callbackOptions);
}

module.exports = {
  GATE_SKIN_CHAT_COMMANDS,
  GATE_SKIN_HELP_LINES,
  executeGateSkinCommand,
  _testing: {
    FACTION_GATE_PRESETS,
    buildGateSkinListMessage,
    buildGateSkinPreviewEntries,
    getGateSkinMaterialCatalogue,
    getGateSkinMaterialsForRaceHint,
    loadGraphicMaterialSets,
    stopGateSkinShowcaseByCharacterID,
  },
};
