const path = require("path");

const spaceRuntime = require(path.join(__dirname, "../runtime"));

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function cloneVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(vector && vector.x, fallback.x),
    y: toFiniteNumber(vector && vector.y, fallback.y),
    z: toFiniteNumber(vector && vector.z, fallback.z),
  };
}

function addVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
  };
}

function scaleVector(vector, scalar) {
  return {
    x: toFiniteNumber(vector && vector.x, 0) * scalar,
    y: toFiniteNumber(vector && vector.y, 0) * scalar,
    z: toFiniteNumber(vector && vector.z, 0) * scalar,
  };
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = cloneVector(vector, fallback);
  const length = Math.sqrt(
    (resolved.x ** 2) + (resolved.y ** 2) + (resolved.z ** 2),
  );
  if (!Number.isFinite(length) || length <= 0) {
    return { ...fallback };
  }

  return {
    x: resolved.x / length,
    y: resolved.y / length,
    z: resolved.z / length,
  };
}

function buildRandomUnitVector() {
  const theta = Math.random() * Math.PI * 2;
  const u = (Math.random() * 2) - 1;
  const planarScale = Math.sqrt(Math.max(0, 1 - (u * u)));
  return normalizeVector({
    x: Math.cos(theta) * planarScale,
    y: u,
    z: Math.sin(theta) * planarScale,
  });
}

function normalizeQuery(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function normalizeQueryArray(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeQuery(value))
    .filter(Boolean))];
}

function getSceneStaticCandidates(scene, kind) {
  const normalizedKind = String(kind || "").trim().toLowerCase();
  if (!scene) {
    return [];
  }

  if (!normalizedKind) {
    return [...scene.staticEntities];
  }
  if (normalizedKind === "celestial") {
    return scene.staticEntities.filter((entity) => (
      entity &&
      (
        entity.kind === "planet" ||
        entity.kind === "moon" ||
        entity.kind === "sun" ||
        entity.kind === "asteroidBelt"
      )
    ));
  }
  if (normalizedKind === "signaturesite" || normalizedKind === "signature site") {
    return scene.staticEntities.filter((entity) => (
      entity &&
      (
        entity.signalTrackerSignatureSite === true ||
        String(entity.signalTrackerSiteKind || "").trim().toLowerCase() === "signature"
      )
    ));
  }

  return scene.staticEntities.filter(
    (entity) => entity && String(entity.kind || "").trim().toLowerCase() === normalizedKind,
  );
}

function buildVirtualAnchor(descriptor = {}) {
  const position = cloneVector(descriptor.position);
  const direction = normalizeVector(
    descriptor.direction,
    { x: 1, y: 0, z: 0 },
  );
  return {
    kind: String(descriptor.kind || "coordinates"),
    itemID: toPositiveInt(
      descriptor.itemID || descriptor.entityID || descriptor.anchorID,
      0,
    ),
    itemName: String(descriptor.name || descriptor.itemName || "Custom Anchor"),
    position,
    direction,
    radius: Math.max(0, toFiniteNumber(descriptor.radius, 0)),
  };
}

function filterCandidatesByDescriptor(candidates, descriptor = {}) {
  const numericItemID = toPositiveInt(
    descriptor.itemID ||
      descriptor.entityID ||
      descriptor.stationID ||
      descriptor.stargateID ||
      descriptor.anchorID,
    0,
  );
  if (numericItemID > 0) {
    return candidates.filter((candidate) => toPositiveInt(candidate && candidate.itemID, 0) === numericItemID);
  }

  const celestialIndex = toPositiveInt(descriptor.celestialIndex, 0);
  const orbitIndex = toPositiveInt(descriptor.orbitIndex, 0);
  let filtered = [...candidates];
  if (celestialIndex > 0) {
    filtered = filtered.filter(
      (candidate) => toPositiveInt(candidate && candidate.celestialIndex, 0) === celestialIndex,
    );
  }
  if (orbitIndex > 0) {
    filtered = filtered.filter(
      (candidate) => toPositiveInt(candidate && candidate.orbitIndex, 0) === orbitIndex,
    );
  }

  const normalizedNameQuery = normalizeQuery(
    descriptor.nameQuery ||
      descriptor.name ||
      descriptor.itemName ||
      descriptor.stationName ||
      descriptor.stargateName,
  );
  if (normalizedNameQuery) {
    const exactMatches = filtered.filter((candidate) => (
      normalizeQuery(candidate && candidate.itemName).includes(normalizedNameQuery)
    ));
    if (exactMatches.length > 0) {
      filtered = exactMatches;
    }
  }

  const signalTrackerSiteKind = normalizeQuery(
    descriptor.siteKind || descriptor.signalTrackerSiteKind,
  );
  if (signalTrackerSiteKind) {
    filtered = filtered.filter((candidate) => (
      normalizeQuery(candidate && candidate.signalTrackerSiteKind) === signalTrackerSiteKind
    ));
  }

  const signalTrackerSiteFamily = normalizeQuery(
    descriptor.siteFamily || descriptor.signalTrackerSiteFamily,
  );
  if (signalTrackerSiteFamily) {
    filtered = filtered.filter((candidate) => (
      normalizeQuery(
        candidate && (
          candidate.signalTrackerSiteFamily ||
          candidate.signalTrackerSignatureSiteFamily
        ),
      ) === signalTrackerSiteFamily
    ));
  }

  const siteTemplateIDs = [
    String(
      descriptor.siteTemplateID ||
      descriptor.signalTrackerSiteTemplateID ||
      "",
    ).trim(),
    ...(Array.isArray(descriptor.siteTemplateIDs) ? descriptor.siteTemplateIDs : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  ].filter(Boolean);
  if (siteTemplateIDs.length > 0) {
    const allowedTemplateIDs = new Set(siteTemplateIDs);
    filtered = filtered.filter((candidate) => allowedTemplateIDs.has(
      String(candidate && candidate.signalTrackerSiteTemplateID || "").trim(),
    ));
  }

  const entryObjectTypeIDs = [...new Set([
    toPositiveInt(
      descriptor.entryObjectTypeID || descriptor.signalTrackerEntryObjectTypeID,
      0,
    ),
    ...(Array.isArray(descriptor.entryObjectTypeIDs) ? descriptor.entryObjectTypeIDs : [])
      .map((value) => toPositiveInt(value, 0)),
  ].filter((value) => value > 0))];
  if (entryObjectTypeIDs.length > 0) {
    const allowedEntryObjectTypeIDs = new Set(entryObjectTypeIDs);
    filtered = filtered.filter((candidate) => allowedEntryObjectTypeIDs.has(
      toPositiveInt(
        candidate && (
          candidate.signalTrackerEntryObjectTypeID ||
          candidate.entryObjectTypeID
        ),
        0,
      ),
    ));
  }

  const labelIncludesAny = normalizeQueryArray(
    descriptor.siteLabelIncludesAny || descriptor.labelIncludesAny,
  );
  if (labelIncludesAny.length > 0) {
    filtered = filtered.filter((candidate) => {
      const candidateLabel = normalizeQuery(
        candidate && (
          candidate.signalTrackerSiteLabel ||
          candidate.itemName ||
          candidate.slimName
        ),
      );
      return labelIncludesAny.some((query) => candidateLabel.includes(query));
    });
  }

  return filtered;
}

function resolveAnchors(systemID, descriptor = {}) {
  const numericSystemID = toPositiveInt(systemID, 0);
  if (!numericSystemID) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const scene = spaceRuntime.ensureScene(numericSystemID);
  if (!scene) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  const normalizedKind = String(descriptor && descriptor.kind || "")
    .trim()
    .toLowerCase();
  if (
    normalizedKind === "coordinates" ||
    (descriptor && descriptor.position && typeof descriptor.position === "object")
  ) {
    return {
      success: true,
      data: {
        scene,
        anchors: [buildVirtualAnchor(descriptor)],
      },
    };
  }

  const numericEntityID = toPositiveInt(
    descriptor && (
      descriptor.entityID ||
      descriptor.itemID ||
      descriptor.stationID ||
      descriptor.stargateID ||
      descriptor.anchorID
    ),
    0,
  );
  if (
    numericEntityID > 0 &&
    (
      normalizedKind === "entity" ||
      normalizedKind === "ship" ||
      normalizedKind === ""
    )
  ) {
    const entity = scene.getEntityByID(numericEntityID);
    if (entity) {
      return {
        success: true,
        data: {
          scene,
          anchors: [entity],
        },
      };
    }
  }

  const normalizedAsteroidBeltKind =
    normalizedKind === "asteroidbelt" || normalizedKind === "asteroid belt";
  const candidateKind =
    normalizedKind === "station" ||
    normalizedKind === "stargate" ||
    normalizedKind === "planet" ||
    normalizedKind === "moon" ||
    normalizedKind === "sun" ||
    normalizedKind === "signaturesite" ||
    normalizedKind === "signature site" ||
    normalizedAsteroidBeltKind ||
    normalizedKind === "celestial"
      ? (normalizedAsteroidBeltKind ? "asteroidBelt" : normalizedKind)
      : numericEntityID > 0
        ? ""
        : "celestial";
  const candidates = getSceneStaticCandidates(scene, candidateKind);
  const filteredCandidates = filterCandidatesByDescriptor(candidates, descriptor);
  if (filteredCandidates.length === 0) {
    return {
      success: false,
      errorMsg: "ANCHOR_NOT_FOUND",
    };
  }

  return {
    success: true,
    data: {
      scene,
      anchors: [...filteredCandidates],
    },
  };
}

function resolveAnchor(systemID, descriptor = {}) {
  const anchorsResult = resolveAnchors(systemID, descriptor);
  if (!anchorsResult.success || !anchorsResult.data) {
    return anchorsResult;
  }

  return {
    success: true,
    data: {
      scene: anchorsResult.data.scene,
      anchor: anchorsResult.data.anchors[0] || null,
    },
  };
}

function buildOffsetSpawnState(anchorEntity, distanceMeters = 20_000, options = {}) {
  const origin = cloneVector(anchorEntity && anchorEntity.position);
  const offsetDirection = buildRandomUnitVector();
  const offsetPosition = addVectors(
    origin,
    scaleVector(offsetDirection, Math.max(1_000, toFiniteNumber(distanceMeters, 20_000))),
  );
  const direction = normalizeVector(
    buildRandomUnitVector(),
    cloneVector(anchorEntity && anchorEntity.direction, { x: 1, y: 0, z: 0 }),
  );

  return {
    position: offsetPosition,
    velocity: cloneVector(options.velocity, { x: 0, y: 0, z: 0 }),
    direction,
    targetPoint: offsetPosition,
    mode: String(options.mode || "STOP"),
    speedFraction: toFiniteNumber(options.speedFraction, 0),
  };
}

function resolveSpawnDistance(anchorEntity, definition, options = {}) {
  const explicitSpawnDistance = Math.max(
    0,
    toFiniteNumber(options.spawnDistanceMeters, 0),
  );
  if (explicitSpawnDistance > 0) {
    return explicitSpawnDistance;
  }

  const surfaceDistance = Math.max(
    0,
    toFiniteNumber(options.distanceFromSurfaceMeters, 0),
  );
  if (surfaceDistance > 0) {
    return Math.max(1_000, toFiniteNumber(anchorEntity && anchorEntity.radius, 0) + surfaceDistance);
  }

  return Math.max(
    1_000,
    toFiniteNumber(
      definition && definition.profile && definition.profile.spawnDistanceMeters,
      20_000,
    ),
  );
}

function buildSpawnStateForDefinition(anchorEntity, definition, options = {}) {
  const explicitSpawnState = options && options.spawnStateOverride;
  if (
    explicitSpawnState &&
    typeof explicitSpawnState === "object" &&
    explicitSpawnState.position &&
    typeof explicitSpawnState.position === "object"
  ) {
    const position = cloneVector(explicitSpawnState.position);
    return {
      position,
      velocity: cloneVector(explicitSpawnState.velocity, { x: 0, y: 0, z: 0 }),
      direction: normalizeVector(
        explicitSpawnState.direction,
        cloneVector(anchorEntity && anchorEntity.direction, { x: 1, y: 0, z: 0 }),
      ),
      targetPoint: cloneVector(explicitSpawnState.targetPoint || position, position),
      mode: String(explicitSpawnState.mode || "STOP"),
      speedFraction: toFiniteNumber(explicitSpawnState.speedFraction, 0),
      targetEntityID: toPositiveInt(explicitSpawnState.targetEntityID, 0),
      followRange: Math.max(0, toFiniteNumber(explicitSpawnState.followRange, 0)),
      orbitDistance: Math.max(0, toFiniteNumber(explicitSpawnState.orbitDistance, 0)),
      maxVelocity: Math.max(0, toFiniteNumber(explicitSpawnState.maxVelocity, 0)),
    };
  }

  const baseDistanceMeters = resolveSpawnDistance(anchorEntity, definition, options);
  const index = Math.max(0, toPositiveInt(options.batchIndex, 1) - 1);
  const total = Math.max(1, toPositiveInt(options.batchTotal, 1));
  const explicitSpreadMeters = Number(options.spreadMeters);
  const jitterWindowMeters = Number.isFinite(explicitSpreadMeters)
    ? Math.max(0, explicitSpreadMeters)
    : Math.min(6_000, 800 + (total * 600));
  const jitterMeters = ((Math.random() * 2) - 1) * jitterWindowMeters;
  const explicitFormationSpacingMeters = Number(options.formationSpacingMeters);
  const formationSpacingMeters = Number.isFinite(explicitFormationSpacingMeters)
    ? Math.max(0, explicitFormationSpacingMeters)
    : 1_250;
  const spacingMeters = Math.min(12_000, index * formationSpacingMeters);

  return buildOffsetSpawnState(
    anchorEntity,
    Math.max(1_000, baseDistanceMeters + jitterMeters + spacingMeters),
    options,
  );
}

module.exports = {
  toFiniteNumber,
  toPositiveInt,
  cloneVector,
  normalizeVector,
  resolveAnchors,
  resolveAnchor,
  buildOffsetSpawnState,
  buildSpawnStateForDefinition,
};
