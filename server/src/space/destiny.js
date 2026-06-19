const path = require("path");

const {
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  buildRowset,
  currentFileTime,
} = require(path.join(__dirname, "../services/_shared/serviceHelpers"));
const {
  buildDamageState,
  hasDamageableHealth,
} = require(path.join(__dirname, "./combat/damage"));
const {
  STRUCTURE_STATE,
} = require(path.join(__dirname, "../services/structure/structureConstants"));
const {
  buildDroneStateRows,
} = require(path.join(__dirname, "../services/drone/droneRuntime"));
const {
  getShipDirtTimestamp,
  normalizeFiletime,
} = require(path.join(__dirname, "../services/ship/shipDirtState"));
const {
  getItemKillCountPlayer,
} = require(path.join(__dirname, "../services/ship/shipKillCounterState"));
const {
  getEntityStandingsForType,
} = require(path.join(__dirname, "../services/_shared/clientEntityStandings"));

const BALL_MODE = Object.freeze({
  GOTO: 0,
  FOLLOW: 1,
  STOP: 2,
  WARP: 3,
  ORBIT: 4,
  RIGID: 11,
});

const BALL_FLAG = Object.freeze({
  IS_FREE: 0x01,
  IS_GLOBAL: 0x02,
  IS_MASSIVE: 0x04,
  IS_INTERACTIVE: 0x08,
});

const SOL_ITEM_COLUMNS = [
  ["itemID", 0x14],
  ["typeID", 0x03],
  ["ownerID", 0x03],
  ["locationID", 0x14],
  ["flagID", 0x02],
  ["contraband", 0x0b],
  ["singleton", 0x02],
  ["quantity", 0x03],
  ["groupID", 0x03],
  ["categoryID", 0x03],
  ["customInfo", 0x81],
];

const DRONE_STATE_HEADERS = [
  "droneID",
  "ownerID",
  "controllerID",
  "activityState",
  "typeID",
  "controllerOwnerID",
  "targetID",
];
const STARGATE_JUMP_HEADERS = ["toCelestialID", "locationID"];
const CLIENT_ROWSET_NAME = "eve.common.script.sys.rowset.Rowset";
const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const FILETIME_TICKS_PER_MS = 10000n;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt32(value, fallback = 0) {
  return Math.trunc(toFiniteNumber(value, fallback));
}

function buildVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(source && source.x, fallback.x),
    y: toFiniteNumber(source && source.y, fallback.y),
    z: toFiniteNumber(source && source.z, fallback.z),
  };
}

function buildWallclockFiletimeFromMs(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }
  return buildFiletimeLong(
    BigInt(Math.trunc(numericValue)) * FILETIME_TICKS_PER_MS + FILETIME_EPOCH_OFFSET,
  );
}

function buildStructureSlimTimer(entity) {
  const timerStart = buildWallclockFiletimeFromMs(entity && entity.stateStartedAt);
  const timerEnd = buildWallclockFiletimeFromMs(entity && entity.stateEndsAt);
  const timerPaused = buildWallclockFiletimeFromMs(entity && entity.timerPausedAt);
  if (!timerStart || !timerEnd) {
    return null;
  }
  return buildList([timerStart, timerEnd, timerPaused]);
}

function buildStructureSlimDeployTimes(entity) {
  const timerStart = buildWallclockFiletimeFromMs(entity && entity.stateStartedAt);
  const timerEnd = buildWallclockFiletimeFromMs(entity && entity.stateEndsAt);
  if (!timerStart || !timerEnd) {
    return null;
  }
  return buildList([timerStart, timerEnd]);
}

function getEntityBallRadius(entity) {
  return toFiniteNumber(entity && entity.radius, 1);
}

function buildMarshalReal(value, fallback = 0) {
  return { type: "real", value: toFiniteNumber(value, fallback) };
}

function buildMarshalRealVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  const vector = buildVector(source, fallback);
  return {
    x: buildMarshalReal(vector.x, fallback.x),
    y: buildMarshalReal(vector.y, fallback.y),
    z: buildMarshalReal(vector.z, fallback.z),
  };
}

function normalizeVector(source = null, fallback = { x: 1, y: 0, z: 0 }) {
  const vector = buildVector(source, fallback);
  const length = Math.sqrt(
    (vector.x ** 2) + (vector.y ** 2) + (vector.z ** 2),
  );
  if (!Number.isFinite(length) || length <= 0) {
    return buildVector(fallback);
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function buildRowDescriptor(columns) {
  return {
    type: "objectex1",
    header: [
      { type: "token", value: "blue.DBRowDescriptor" },
      [columns],
    ],
    list: [],
    dict: [],
  };
}

function buildPackedRow(columns, fields) {
  return {
    type: "packedrow",
    header: buildRowDescriptor(columns),
    columns,
    fields,
  };
}

function pushBigInt64(chunks, value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(
    typeof value === "bigint" ? value : BigInt(Math.trunc(toFiniteNumber(value, 0))),
    0,
  );
  chunks.push(buffer);
}

function pushInt32(chunks, value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(toInt32(value, 0), 0);
  chunks.push(buffer);
}

function pushUInt8(chunks, value) {
  chunks.push(Buffer.from([toInt32(value, 0) & 0xff]));
}

function pushFloat(chunks, value) {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatLE(toFiniteNumber(value, 0), 0);
  chunks.push(buffer);
}

function pushDouble(chunks, value) {
  const buffer = Buffer.alloc(8);
  buffer.writeDoubleLE(toFiniteNumber(value, 0), 0);
  chunks.push(buffer);
}

function encodeHeader(packetType, stamp) {
  const buffer = Buffer.alloc(5);
  buffer.writeUInt8(packetType, 0);
  buffer.writeUInt32LE(toInt32(stamp, 0) >>> 0, 1);
  return buffer;
}

function encodeRigidBall(entity) {
  const position = buildVector(entity.position);
  const flags =
    entity.kind === "station" || entity.kind === "stargate"
      ? BALL_FLAG.IS_GLOBAL | BALL_FLAG.IS_MASSIVE
      : entity.kind === "orbital"
        ? BALL_FLAG.IS_GLOBAL | BALL_FLAG.IS_INTERACTIVE
      : entity.kind === "container" || entity.kind === "wreck"
        ? BALL_FLAG.IS_INTERACTIVE
        : BALL_FLAG.IS_GLOBAL;
  const chunks = [];
  pushBigInt64(chunks, entity.itemID);
  pushUInt8(chunks, BALL_MODE.RIGID);
  pushFloat(chunks, getEntityBallRadius(entity));
  pushDouble(chunks, position.x);
  pushDouble(chunks, position.y);
  pushDouble(chunks, position.z);
  pushUInt8(chunks, flags);
  pushUInt8(chunks, 0xff);
  return Buffer.concat(chunks);
}

function getFreeBallMode(entity) {
  switch (entity && entity.mode) {
    case "GOTO":
      return BALL_MODE.GOTO;
    case "FOLLOW":
      return BALL_MODE.FOLLOW;
    case "WARP":
      return BALL_MODE.WARP;
    case "ORBIT":
      return BALL_MODE.ORBIT;
    default:
      return BALL_MODE.STOP;
  }
}

function isFreeBallEntity(entity) {
  return Boolean(
    entity &&
    (
      entity.kind === "ship" ||
      entity.kind === "missile" ||
      entity.kind === "drone" ||
      entity.kind === "fighter" ||
      entity.kind === "container" ||
      entity.kind === "wreck"
    )
  );
}

function isFreeBallInteractive(entity) {
  if (!isFreeBallEntity(entity)) {
    return false;
  }

  if (entity.kind === "container" || entity.kind === "wreck") {
    return true;
  }

  if (entity.kind === "missile") {
    return false;
  }

  if (entity.kind === "drone" || entity.kind === "fighter") {
    return Boolean(
      (Number(entity.controllerID) || 0) > 0 ||
      (Number(entity.ownerID) || 0) > 0,
    );
  }

  const npcEntityType = String(entity.npcEntityType || "").trim().toLowerCase();
  if (npcEntityType === "npc" || npcEntityType === "concord") {
    return true;
  }

  return Boolean(
    entity.session ||
      ((Number(entity.pilotCharacterID ?? entity.characterID) || 0) > 0),
  );
}

function getShipTargetPoint(entity) {
  if (entity && entity.targetPoint) {
    return buildVector(entity.targetPoint);
  }

  const direction = normalizeVector(entity && entity.direction, { x: 1, y: 0, z: 0 });
  const position = buildVector(entity && entity.position);
  return {
    x: position.x + (direction.x * 1.0e16),
    y: position.y + (direction.y * 1.0e16),
    z: position.z + (direction.z * 1.0e16),
  };
}

function getShipDirection(entity) {
  if (entity && entity.direction) {
    return normalizeVector(entity.direction, { x: 1, y: 0, z: 0 });
  }

  if (entity && entity.targetPoint && entity.position) {
    return normalizeVector({
      x: entity.targetPoint.x - entity.position.x,
      y: entity.targetPoint.y - entity.position.y,
      z: entity.targetPoint.z - entity.position.z,
    }, { x: 1, y: 0, z: 0 });
  }

  return { x: 1, y: 0, z: 0 };
}

function getShipWarpFactor(entity) {
  const warpState = entity && entity.warpState;
  // DLL solver: tau0 = ball98 * 0.001, so ball98 = warpSpeedAU * 1000
  return toInt32(
    (warpState && warpState.warpSpeed) ||
      (toFiniteNumber(entity && entity.warpSpeedAU, 0) > 0
        ? Math.round(entity.warpSpeedAU * 1000)
        : 3000),
    3000,
  );
}

function shouldUseSessionlessNpcWarpAddBallsBootstrap(entity, options = {}) {
  if (
    !options.forAddBalls ||
    !entity ||
    entity.kind !== "ship" ||
    getFreeBallMode(entity) !== BALL_MODE.WARP
  ) {
    return false;
  }

  if (entity.session) {
    return false;
  }

  const npcEntityType = String(entity.npcEntityType || "").trim().toLowerCase();
  return (
    entity.sessionlessWarpIngress &&
    (entity.nativeNpc === true || npcEntityType === "npc" || npcEntityType === "concord")
  );
}

function buildAddBallsBootstrapEntity(entity, options = {}) {
  if (!shouldUseSessionlessNpcWarpAddBallsBootstrap(entity, options)) {
    return entity;
  }

  // Sessionless NPC/Concord arrivals stay on the older CCP-style ingress
  // contract: AddBalls2 seeds a neutral ball and EntityWarpIn establishes the
  // visible warp. Serializing these responders as full mode-3 warp balls inside
  // AddBalls2 misaligns the client decode stream and leaves invisible attackers.
  return {
    ...entity,
    mode: "STOP",
    velocity: { x: 0, y: 0, z: 0 },
    speedFraction: 0,
  };
}

function encodeFreeBall(entity, options = {}) {
  const encodedEntity = buildAddBallsBootstrapEntity(entity, options);
  const position = buildVector(encodedEntity.position);
  const velocity = buildVector(encodedEntity.velocity);
  const mode = getFreeBallMode(encodedEntity);
  const flags =
    BALL_FLAG.IS_FREE |
    (isFreeBallInteractive(encodedEntity) ? BALL_FLAG.IS_INTERACTIVE : 0);
  const chunks = [];
  pushBigInt64(chunks, encodedEntity.itemID);
  pushUInt8(chunks, mode);
  pushFloat(chunks, getEntityBallRadius(encodedEntity));
  pushDouble(chunks, position.x);
  pushDouble(chunks, position.y);
  pushDouble(chunks, position.z);
  pushUInt8(chunks, flags);

  const fallbackMass =
    encodedEntity.kind === "container" || encodedEntity.kind === "wreck"
      ? 10_000
      : 1_000_000;
  pushDouble(chunks, toFiniteNumber(encodedEntity.mass, fallbackMass));
  pushUInt8(chunks, 0);
  pushBigInt64(chunks, encodedEntity.allianceID || -1);
  pushInt32(chunks, encodedEntity.corporationID || 0);
  pushInt32(chunks, 0);

  pushFloat(chunks, toFiniteNumber(encodedEntity.maxVelocity, 0));
  pushDouble(chunks, velocity.x);
  pushDouble(chunks, velocity.y);
  pushDouble(chunks, velocity.z);
  pushFloat(chunks, toFiniteNumber(encodedEntity.inertia, 1));
  pushFloat(chunks, toFiniteNumber(encodedEntity.speedFraction, 0));

  pushUInt8(chunks, 0xff);
  switch (mode) {
    case BALL_MODE.GOTO: {
      const targetPoint = getShipTargetPoint(encodedEntity);
      pushDouble(chunks, targetPoint.x);
      pushDouble(chunks, targetPoint.y);
      pushDouble(chunks, targetPoint.z);
      break;
    }
    case BALL_MODE.FOLLOW:
      pushBigInt64(chunks, encodedEntity.targetEntityID || 0);
      pushFloat(chunks, toFiniteNumber(encodedEntity.followRange, 0));
      break;
    case BALL_MODE.WARP: {
      const targetPoint = getShipTargetPoint(encodedEntity);
      const warpState = encodedEntity && encodedEntity.warpState;
      pushDouble(chunks, targetPoint.x);
      pushDouble(chunks, targetPoint.y);
      pushDouble(chunks, targetPoint.z);
      // Fresh AddBalls2 acquisition needs the same native warp tail the known
      // good runtime used, otherwise Michelle treats the ball like a parked
      // stop/teleport instead of an active arrival and the visible warp-in
      // never really materializes.
      pushInt32(chunks, toInt32(warpState && warpState.effectStamp, 0));
      pushDouble(chunks, toFiniteNumber(warpState && warpState.totalDistance, 0));
      pushDouble(chunks, toFiniteNumber(warpState && warpState.stopDistance, 0));
      pushInt32(chunks, getShipWarpFactor(encodedEntity));
      break;
    }
    case BALL_MODE.ORBIT:
      // Bootstrap orbit state uses the same wide target-ID contract as follow:
      // int64 target ball ID + float radius. Using int32+double here made the
      // client decode garbage follow targets for already-orbiting NPCs.
      pushBigInt64(chunks, encodedEntity.targetEntityID || 0);
      pushFloat(chunks, toFiniteNumber(encodedEntity.orbitDistance, 0));
      break;
    default:
      break;
  }
  return Buffer.concat(chunks);
}

function encodeEntityBall(entity, options = {}) {
  if (isFreeBallEntity(entity)) {
    return encodeFreeBall(entity, options);
  }

  return encodeRigidBall(entity);
}

function describeBallMode(mode) {
  switch (mode) {
    case BALL_MODE.GOTO:
      return "GOTO";
    case BALL_MODE.FOLLOW:
      return "FOLLOW";
    case BALL_MODE.STOP:
      return "STOP";
    case BALL_MODE.WARP:
      return "WARP";
    case BALL_MODE.ORBIT:
      return "ORBIT";
    case BALL_MODE.RIGID:
      return "RIGID";
    default:
      return `UNKNOWN_${mode}`;
  }
}

function describeBallFlags(flags) {
  return {
    byte: flags,
    isFree: (flags & BALL_FLAG.IS_FREE) !== 0,
    isGlobal: (flags & BALL_FLAG.IS_GLOBAL) !== 0,
    isMassive: (flags & BALL_FLAG.IS_MASSIVE) !== 0,
    isInteractive: (flags & BALL_FLAG.IS_INTERACTIVE) !== 0,
  };
}

function debugDescribeEntityBall(entity, options = {}) {
  const debugEntity = buildAddBallsBootstrapEntity(entity, options);
  const encoded = encodeEntityBall(entity, options);
  if (isFreeBallEntity(debugEntity)) {
    const mode = getFreeBallMode(debugEntity);
    const flags =
      BALL_FLAG.IS_FREE |
      (isFreeBallInteractive(debugEntity) ? BALL_FLAG.IS_INTERACTIVE : 0);
    const summary = {
      kind: debugEntity.kind,
      itemID: debugEntity.itemID,
      mode: describeBallMode(mode),
      modeCode: mode,
      flags: describeBallFlags(flags),
      radius: getEntityBallRadius(debugEntity),
      position: buildVector(debugEntity.position),
      mass: toFiniteNumber(
        debugEntity.mass,
        debugEntity.kind === "container" || debugEntity.kind === "wreck"
          ? 10_000
          : 1_000_000,
      ),
      allianceID: debugEntity.allianceID || -1,
      corporationID: debugEntity.corporationID || 0,
      maxVelocity: toFiniteNumber(debugEntity.maxVelocity, 0),
      velocity: buildVector(debugEntity.velocity),
      inertia: toFiniteNumber(debugEntity.inertia, 1),
      speedFraction: toFiniteNumber(debugEntity.speedFraction, 0),
      modeData: null,
    };
    if (mode === BALL_MODE.GOTO) {
      summary.modeData = {
        targetPoint: getShipTargetPoint(debugEntity),
      };
    } else if (mode === BALL_MODE.FOLLOW) {
      summary.modeData = {
        targetEntityID: debugEntity.targetEntityID || 0,
        followRange: toFiniteNumber(debugEntity.followRange, 0),
      };
    } else if (mode === BALL_MODE.WARP) {
      summary.modeData = {
        targetPoint: getShipTargetPoint(debugEntity),
        effectStamp: toInt32(
          debugEntity &&
            debugEntity.warpState &&
            debugEntity.warpState.effectStamp,
          0,
        ),
        totalDistance: toFiniteNumber(
          debugEntity &&
            debugEntity.warpState &&
            debugEntity.warpState.totalDistance,
          0,
        ),
        stopDistance: toFiniteNumber(
          debugEntity &&
            debugEntity.warpState &&
            debugEntity.warpState.stopDistance,
          0,
        ),
        warpFactor: getShipWarpFactor(debugEntity),
      };
    } else if (mode === BALL_MODE.ORBIT) {
      summary.modeData = {
        targetEntityID: debugEntity.targetEntityID || 0,
        orbitDistance: toFiniteNumber(debugEntity.orbitDistance, 0),
      };
    }
    return {
      encodedLength: encoded.length,
      encodedHex: encoded.toString("hex"),
      summary,
    };
  }

  const flags =
    entity.kind === "station" || entity.kind === "stargate"
      ? BALL_FLAG.IS_GLOBAL | BALL_FLAG.IS_MASSIVE
      : BALL_FLAG.IS_GLOBAL;
  return {
    encodedLength: encoded.length,
    encodedHex: encoded.toString("hex"),
    summary: {
      kind: entity.kind,
      itemID: entity.itemID,
      mode: "RIGID",
      modeCode: BALL_MODE.RIGID,
      flags: describeBallFlags(flags),
      radius: getEntityBallRadius(entity),
      position: buildVector(entity.position),
    },
  };
}

function appendEntityStandings(entries, entity, slimTypeID) {
  const authoredStandings = getEntityStandingsForType(slimTypeID);
  const hostileResponseThreshold = Number.isFinite(
    Number(entity && entity.hostileResponseThreshold),
  )
    ? Number(entity.hostileResponseThreshold)
    : authoredStandings && authoredStandings.hostileResponseThreshold;
  const friendlyResponseThreshold = Number.isFinite(
    Number(entity && entity.friendlyResponseThreshold),
  )
    ? Number(entity.friendlyResponseThreshold)
    : authoredStandings && authoredStandings.friendlyResponseThreshold;

  if (Number.isFinite(hostileResponseThreshold)) {
    entries.push([
      "hostile_response_threshold",
      toFiniteNumber(hostileResponseThreshold, -11),
    ]);
  }
  if (Number.isFinite(friendlyResponseThreshold)) {
    entries.push([
      "friendly_response_threshold",
      toFiniteNumber(friendlyResponseThreshold, 11),
    ]);
  }
}

function hasOwnProperty(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function resolveShipSlimDirtTime(entity) {
  if (hasOwnProperty(entity, "dirtTime")) {
    return {
      explicit: true,
      dirtTime: normalizeFiletime(entity.dirtTime, 0n) || 0n,
    };
  }

  return {
    explicit: false,
    dirtTime: getShipDirtTimestamp(entity.itemID, {
      createIfMissing: false,
      reason: "slim",
    }),
  };
}

function buildSlimItemDict(entity) {
  const slimTypeID = toInt32(
    entity && entity.slimTypeID,
    toInt32(entity && entity.typeID, 0),
  );
  const slimGroupID = toInt32(
    entity && entity.slimGroupID,
    toInt32(entity && entity.groupID, 0),
  );
  const slimCategoryID = toInt32(
    entity && entity.slimCategoryID,
    toInt32(entity && entity.categoryID, 0),
  );
  const slimName = String(
    entity && (
      entity.slimName ||
      entity.itemName
    ) || "",
  );
  const entries = [
    ["itemID", entity.itemID],
    ["typeID", slimTypeID],
    ["ownerID", entity.ownerID || 0],
  ];

  if (slimName) {
    entries.push(["name", slimName]);
  }
  if (slimGroupID > 0) {
    entries.push(["groupID", slimGroupID]);
  }
  if (slimCategoryID > 0) {
    entries.push(["categoryID", slimCategoryID]);
  }
  const slimGraphicID = toInt32(
    entity && entity.slimGraphicID,
    toInt32(entity && entity.graphicID, 0),
  );
  if (slimGraphicID > 0) {
    entries.push(["graphicID", slimGraphicID]);
  }

  if (entity.kind === "ship") {
    entries.push(["corpID", entity.corporationID || 0]);
    entries.push(["allianceID", entity.allianceID || 0]);
    entries.push(["warFactionID", entity.warFactionID || 0]);
    entries.push(["charID", entity.characterID || 0]);
    const dirtState = resolveShipSlimDirtTime(entity);
    if (dirtState.explicit || dirtState.dirtTime > 0n) {
      entries.push(["dirtTime", buildFiletimeLong(dirtState.dirtTime)]);
    }
    entries.push(["kills", getItemKillCountPlayer(entity.itemID)]);
    if (Array.isArray(entity.cosmeticsItems) && entity.cosmeticsItems.length > 0) {
      entries.push(["cosmeticsItems", buildList(entity.cosmeticsItems)]);
    }
    entries.push(["skinMaterialSetID", entity.skinMaterialSetID ?? null]);
    entries.push([
      "modules",
      buildList(Array.isArray(entity.modules) ? entity.modules : []),
    ]);
    entries.push([
      "securityStatus",
      toFiniteNumber(entity.securityStatus, 0.0),
    ]);
    entries.push(["bounty", toFiniteNumber(entity.bounty, 0.0)]);
    if (
      Array.isArray(entity.compressionFacilityTypelists) &&
      entity.compressionFacilityTypelists.length > 0
    ) {
      entries.push([
        "compression_facility_typelists",
        buildDict(
          entity.compressionFacilityTypelists
            .map((entry) => ([
              toInt32(entry && entry[0], 0),
              Math.max(1, toInt32(entry && entry[1], 0)),
            ]))
            .filter((entry) => entry[0] > 0 && entry[1] > 0),
        ),
      ]);
    }
  } else if (entity.kind === "station") {
    entries.push(["corpID", entity.corporationID || 0]);
    entries.push(["allianceID", entity.allianceID || 0]);
    entries.push(["warFactionID", entity.warFactionID || 0]);
    entries.push(["online", 1]);
    entries.push(["incapacitated", 0]);
    entries.push(["activityLevel", entity.activityLevel ?? null]);
    entries.push(["skinMaterialSetID", entity.skinMaterialSetID ?? null]);
    if (entity.celestialEffect !== undefined && entity.celestialEffect !== null) {
      entries.push(["celestialEffect", entity.celestialEffect]);
    }
    if (Array.isArray(entity.dunRotation) && entity.dunRotation.length === 3) {
      entries.push(["dunRotation", entity.dunRotation]);
    }
  } else if (entity.kind === "structure") {
    entries.push(["corpID", entity.corporationID || 0]);
    entries.push(["allianceID", entity.allianceID || 0]);
    entries.push(["warFactionID", entity.warFactionID || 0]);
    entries.push(["state", entity.state ?? null]);
    entries.push(["upkeepState", entity.upkeepState ?? null]);
    entries.push(["deedState", entity.deedState ?? null]);
    entries.push(["unanchoring", buildWallclockFiletimeFromMs(entity.unanchoring)]);
    entries.push([
      "repairing",
      entity.repairing === undefined || entity.repairing === null
        ? null
        : entity.repairing === true
          ? 1
          : 0,
    ]);
    entries.push(["docked", entity.docked === true ? 1 : 0]);
    entries.push([
      "timer",
      buildStructureSlimTimer(entity),
    ]);
    entries.push([
      "deployTimes",
      entity.state === STRUCTURE_STATE.DEPLOY_VULNERABLE
        ? buildStructureSlimDeployTimes(entity)
        : null,
    ]);
    entries.push(["online", 1]);
    entries.push(["incapacitated", 0]);
    entries.push([
      "modules",
      buildList(Array.isArray(entity.modules) ? entity.modules : []),
    ]);
    if (Array.isArray(entity.dunRotation) && entity.dunRotation.length === 3) {
      entries.push(["dunRotation", entity.dunRotation]);
    }
  } else if (entity.kind === "orbital") {
    entries.push(["locationID", entity.locationID || entity.systemID || 0]);
    entries.push(["corpID", entity.corporationID || entity.ownerID || 0]);
    entries.push(["allianceID", entity.allianceID || 0]);
    entries.push(["warFactionID", entity.warFactionID || 0]);
    entries.push(["planetID", entity.planetID || 0]);
    entries.push(["level", entity.level ?? 1]);
    entries.push(["orbitalState", entity.orbitalState ?? null]);
    entries.push(["orbitalTimestamp", buildWallclockFiletimeFromMs(entity.orbitalTimestampMs)]);
    entries.push(["orbitalHackerID", entity.orbitalHackerID ?? null]);
    entries.push(["orbitalHackerProgress", entity.orbitalHackerProgress ?? null]);
    entries.push(["online", 1]);
    entries.push(["incapacitated", 0]);
    if (Array.isArray(entity.dunRotation) && entity.dunRotation.length === 3) {
      entries.push(["dunRotation", entity.dunRotation]);
    }
  } else if (entity.kind === "stargate") {
    entries.push(["nameID", null]);
    entries.push(["activationState", entity.activationState ?? 2]);
    entries.push(["poseID", entity.poseID ?? 0]);
    entries.push([
      "localCorruptionStageAndMaximum",
      buildList(entity.localCorruptionStageAndMaximum || [0, 1]),
    ]);
    entries.push([
      "destinationCorruptionStageAndMaximum",
      buildList(entity.destinationCorruptionStageAndMaximum || [0, 1]),
    ]);
    entries.push([
      "localSuppressionStageAndMaximum",
      buildList(entity.localSuppressionStageAndMaximum || [0, 1]),
    ]);
    entries.push([
      "destinationSuppressionStageAndMaximum",
      buildList(entity.destinationSuppressionStageAndMaximum || [0, 1]),
    ]);
    entries.push([
      "hasVolumetricDrifterCloud",
      entity.hasVolumetricDrifterCloud ? 1 : 0,
    ]);
    entries.push(["originSystemOwnerID", entity.originSystemOwnerID ?? null]);
    entries.push([
      "destinationSystemOwnerID",
      entity.destinationSystemOwnerID ?? null,
    ]);
    entries.push([
      "destinationSystemStatusIcons",
      buildList(entity.destinationSystemStatusIcons || []),
    ]);
    entries.push([
      "destinationSystemWarning",
      entity.destinationSystemWarning ?? null,
    ]);
    entries.push([
      "destinationSystemWarningIcon",
      entity.destinationSystemWarningIcon ?? null,
    ]);
    if (Array.isArray(entity.dunRotation) && entity.dunRotation.length === 3) {
      entries.push(["dunRotation", entity.dunRotation]);
    }
    entries.push(["jumps", buildStargateJumps(entity)]);
  } else if (entity.kind === "wormhole") {
    entries.push(["nebulaType", entity.nebulaType ?? null]);
    entries.push(["wormholeSize", toFiniteNumber(entity.wormholeSize, 1)]);
    entries.push(["wormholeAge", toInt32(entity.wormholeAge, 0)]);
    entries.push(["maxShipJumpMass", toInt32(entity.maxShipJumpMass, 0)]);
    entries.push(["isDestTriglavian", entity.isDestTriglavian ? 1 : 0]);
    entries.push([
      "otherSolarSystemClass",
      toInt32(entity.otherSolarSystemClass, 0),
    ]);
  } else if (entity.kind === "container" || entity.kind === "wreck") {
    entries.push(["isEmpty", entity.isEmpty ? 1 : 0]);
    if (entity.kind === "wreck") {
      entries.push(["launcherID", entity.launcherID ?? null]);
    }
    if (Array.isArray(entity.dunRotation) && entity.dunRotation.length === 3) {
      entries.push(["dunRotation", entity.dunRotation]);
    }
  } else if (entity.kind === "missile") {
    entries.push(["sourceShipID", entity.sourceShipID || 0]);
    entries.push([
      "launchModules",
      buildList(
        Array.isArray(entity.launchModules)
          ? entity.launchModules.map((value) => Number(value) || 0)
          : [],
      ),
    ]);
  } else if (entity.kind === "fighter") {
    entries.push([
      "fighter.squadronSize",
      Math.max(0, toInt32(entity.squadronSize, 0)),
    ]);
  }

  if (entity && entity.activityState !== undefined && entity.activityState !== null) {
    entries.push(["activityState", toInt32(entity.activityState, 0)]);
  }
  if (entity && entity.component_activate !== undefined && entity.component_activate !== null) {
    const componentActivate = Array.isArray(entity.component_activate)
      ? entity.component_activate
      : [Boolean(entity.component_activate), null];
    entries.push(["component_activate", buildList(componentActivate)]);
  }
  if (entity && entity.component_turboshield !== undefined && entity.component_turboshield !== null) {
    entries.push(["component_turboshield", toInt32(entity.component_turboshield, 0)]);
  }
  appendEntityStandings(entries, entity, slimTypeID);

  return buildDict(entries);
}

function buildSlimItemObject(entity) {
  return {
    type: "object",
    name: "foo.SlimItem",
    args: buildSlimItemDict(entity),
  };
}

function buildDroneState(entities = []) {
  // V23.02 rejects util.Rowset here during remote SetState unmarshal.
  return buildRowset(
    DRONE_STATE_HEADERS,
    buildDroneStateRows(entities),
    CLIENT_ROWSET_NAME,
  );
}

function buildStargateJumps(entity) {
  const rows =
    entity && entity.destinationID && entity.destinationSolarSystemID
      ? [[entity.destinationID, entity.destinationSolarSystemID]]
      : [];

  return buildRowset(STARGATE_JUMP_HEADERS, rows, CLIENT_ROWSET_NAME);
}

function buildSolItem(system) {
  return buildPackedRow(SOL_ITEM_COLUMNS, {
    itemID: system.solarSystemID,
    typeID: 5,
    ownerID: 1,
    locationID: system.constellationID,
    flagID: 0,
    contraband: false,
    singleton: 1,
    quantity: -1,
    groupID: 5,
    categoryID: 2,
    customInfo: "",
  });
}

function buildAddBallsStateBuffer(stamp, entities) {
  const chunks = [encodeHeader(1, stamp)];
  for (const entity of entities) {
    chunks.push(encodeEntityBall(entity, { forAddBalls: true }));
  }
  return Buffer.concat(chunks);
}

function buildSetStateBuffer(stamp, entities) {
  const chunks = [encodeHeader(0, stamp)];
  for (const entity of entities) {
    chunks.push(encodeEntityBall(entity));
  }
  return Buffer.concat(chunks);
}

function buildAddBalls2Payload(
  stateStamp,
  entities,
  simFileTime = currentFileTime(),
) {
  const extraBallData = entities.map((entity) => {
    if (entity.kind === "station" || hasDamageableHealth(entity)) {
      return [buildSlimItemDict(entity), buildDamageState(entity, simFileTime)];
    }
    return buildSlimItemDict(entity);
  });

  return [
    "AddBalls2",
    [
      [
        buildAddBallsStateBuffer(stateStamp, entities),
        buildList(extraBallData),
      ],
    ],
  ];
}

function buildSetStatePayload(
  stateStamp,
  system,
  egoEntityID,
  entities,
  simFileTime = currentFileTime(),
  dbuffStateEntries = [],
) {
  const damageEntries = entities
    .filter((entity) => entity.kind === "station" || hasDamageableHealth(entity))
    .map((entity) => [entity.itemID, buildDamageState(entity, simFileTime)]);

  const state = buildKeyVal([
    ["stamp", stateStamp],
    ["state", buildSetStateBuffer(stateStamp, entities)],
    ["ego", egoEntityID],
    ["industryLevel", 0],
    ["researchLevel", 0],
    ["damageState", buildDict(damageEntries)],
    ["dbuffState", buildList(Array.isArray(dbuffStateEntries) ? dbuffStateEntries : [])],
    ["aggressors", buildDict([])],
    ["droneState", buildDroneState(entities)],
    ["slims", buildList(entities.map((entity) => buildSlimItemObject(entity)))],
    ["solItem", buildSolItem(system)],
    ["effectStates", buildList([])],
    ["allianceBridges", buildList([])],
  ]);

  return ["SetState", [state]];
}

function restampEncodedStateBuffer(buffer, stamp) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) {
    return buffer;
  }

  const nextBuffer = Buffer.from(buffer);
  nextBuffer.writeUInt32LE(toInt32(stamp, 0) >>> 0, 1);
  return nextBuffer;
}

function restampAddBalls2Payload(payload, stamp) {
  if (
    !Array.isArray(payload) ||
    payload[0] !== "AddBalls2" ||
    !Array.isArray(payload[1])
  ) {
    return payload;
  }

  const normalizedStamp = toInt32(stamp, 0) >>> 0;
  return [
    payload[0],
    payload[1].map((entry) => {
      if (!Array.isArray(entry) || !Buffer.isBuffer(entry[0])) {
        return entry;
      }
      return [restampEncodedStateBuffer(entry[0], normalizedStamp), ...entry.slice(1)];
    }),
  ];
}

function restampSetStatePayload(payload, stamp) {
  if (
    !Array.isArray(payload) ||
    payload[0] !== "SetState" ||
    !Array.isArray(payload[1]) ||
    payload[1].length === 0
  ) {
    return payload;
  }

  const stateObject = payload[1][0];
  const stateArgs = stateObject && stateObject.args;
  if (
    !stateObject ||
    !stateArgs ||
    stateArgs.type !== "dict" ||
    !Array.isArray(stateArgs.entries)
  ) {
    return payload;
  }

  const normalizedStamp = toInt32(stamp, 0) >>> 0;
  return [
    payload[0],
    [
      {
        ...stateObject,
        args: {
          ...stateArgs,
          entries: stateArgs.entries.map((entry) => {
            if (!Array.isArray(entry) || entry.length < 2) {
              return entry;
            }
            if (entry[0] === "stamp") {
              return [entry[0], normalizedStamp];
            }
            if (entry[0] === "state") {
              return [entry[0], restampEncodedStateBuffer(entry[1], normalizedStamp)];
            }
            return entry;
          }),
        },
      },
    ],
  ];
}

function restampPayloadState(payload, stamp) {
  if (!Array.isArray(payload) || typeof payload[0] !== "string") {
    return payload;
  }

  switch (payload[0]) {
    case "AddBalls2":
      return restampAddBalls2Payload(payload, stamp);
    case "SetState":
      return restampSetStatePayload(payload, stamp);
    default:
      return payload;
  }
}

function buildDestinyUpdatePayload(updates, waitForBubble = false) {
  return [buildList(updates.map((update) => [update.stamp, update.payload])), waitForBubble];
}

function buildGotoDirectionPayload(entityID, direction) {
  const vector = buildMarshalRealVector(direction);
  return ["GotoDirection", [entityID, vector.x, vector.y, vector.z]];
}

function buildGotoPointPayload(entityID, point) {
  const vector = buildMarshalRealVector(point);
  return ["GotoPoint", [entityID, vector.x, vector.y, vector.z]];
}

function buildFollowBallPayload(entityID, targetID, range) {
  return ["FollowBall", [entityID, targetID, toInt32(range, 0)]];
}

function buildWarpToPayload(entityID, destination, distance, warpSpeed) {
  const vector = buildMarshalRealVector(destination);
  return [
    "WarpTo",
    [
      entityID,
      vector.x,
      vector.y,
      vector.z,
      buildMarshalReal(distance, 0),
      toInt32(warpSpeed, 3000),
    ],
  ];
}

function buildAddBallPayload(
  entityID,
  {
    mass = 0,
    radius = 0,
    maxSpeed = 0,
    isFree = true,
    isGlobal = false,
    isMassive = false,
    isInteractive = true,
    isMoribund = false,
    position = null,
    velocity = null,
    inertia = 1,
    speedFraction = 0,
  } = {},
) {
  const positionVector = buildMarshalRealVector(position);
  const velocityVector = buildMarshalRealVector(velocity);
  return [
    "AddBall",
    [
      entityID,
      buildMarshalReal(mass, 0),
      buildMarshalReal(radius, 0),
      buildMarshalReal(maxSpeed, 0),
      isFree ? 1 : 0,
      isGlobal ? 1 : 0,
      isMassive ? 1 : 0,
      isInteractive ? 1 : 0,
      isMoribund ? 1 : 0,
      positionVector.x,
      positionVector.y,
      positionVector.z,
      velocityVector.x,
      velocityVector.y,
      velocityVector.z,
      buildMarshalReal(inertia, 1),
      buildMarshalReal(speedFraction, 0),
    ],
  ];
}

function buildEntityWarpInPayload(entityID, destination, warpFactor) {
  const vector = buildMarshalRealVector(destination);
  return [
    "EntityWarpIn",
    [
      entityID,
      vector.x,
      vector.y,
      vector.z,
      toInt32(warpFactor, 0),
    ],
  ];
}

function buildOrbitPayload(entityID, orbitEntityID, distance) {
  return ["Orbit", [entityID, orbitEntityID, toInt32(distance, 0)]];
}

function buildSetSpeedFractionPayload(entityID, fraction) {
  return ["SetSpeedFraction", [entityID, buildMarshalReal(fraction, 0)]];
}

function buildStopPayload(entityID) {
  return ["Stop", [entityID]];
}

function buildSetBallVelocityPayload(entityID, velocity) {
  const vector = buildMarshalRealVector(velocity);
  return ["SetBallVelocity", [entityID, vector.x, vector.y, vector.z]];
}

function buildSetBallPositionPayload(entityID, position) {
  const vector = buildMarshalRealVector(position);
  return ["SetBallPosition", [entityID, vector.x, vector.y, vector.z]];
}

function buildOnDockingAcceptedPayload(shipPosition, stationPosition, stationID) {
  return [toInt32(stationID, 0)];
}

function buildSetBallAgilityPayload(entityID, agility) {
  return ["SetBallAgility", [entityID, buildMarshalReal(agility, 0)]];
}

function buildSetBallMassPayload(entityID, mass) {
  return ["SetBallMass", [entityID, buildMarshalReal(mass, 0)]];
}

function buildSetMaxSpeedPayload(entityID, speed) {
  return [
    "SetMaxSpeed",
    [entityID, buildMarshalReal(speed, 0)],
  ];
}

function buildSetBallMassivePayload(entityID, isMassive) {
  return ["SetBallMassive", [entityID, isMassive ? 1 : 0]];
}

function buildGraphicInfoDict(entries = []) {
  return buildDict(entries);
}

function normalizeGraphicInfo(graphicInfo) {
  if (graphicInfo === undefined) {
    return undefined;
  }
  if (
    graphicInfo === null ||
    (graphicInfo && typeof graphicInfo === "object" && graphicInfo.type)
  ) {
    return graphicInfo;
  }
  if (Array.isArray(graphicInfo)) {
    return buildList(graphicInfo);
  }
  if (graphicInfo && typeof graphicInfo === "object" && !Array.isArray(graphicInfo)) {
    // Client FX code mixes `graphicInfo.foo`, `graphicInfo.get("foo")`, and
    // `graphicInfo["foo"]` access. Marshal plain JS objects as util.KeyVal so
    // one payload shape satisfies all three lookup styles.
    return buildKeyVal(Object.entries(graphicInfo));
  }
  return graphicInfo;
}

function buildOnSpecialFXPayload(
  entityID,
  guid,
  {
    moduleID = null,
    moduleTypeID = null,
    targetID = null,
    chargeTypeID = null,
    isOffensive = false,
    start = true,
    active = true,
    duration,
    repeat,
    startTime,
    timeFromStart,
    graphicInfo,
  } = {},
) {
  const args = [
    entityID,
    moduleID,
    moduleTypeID,
    targetID,
    chargeTypeID,
    String(guid || ""),
    isOffensive ? 1 : 0,
    start ? 1 : 0,
    active ? 1 : 0,
  ];
  // Michelle's live signature always reserves the full optional tail:
  // duration, repeat, startTime, timeFromStart, graphicInfo.
  args.push(
    duration === undefined ? -1 : toFiniteNumber(duration, -1),
    repeat === undefined ? null : repeat,
    startTime === undefined ? null : startTime,
    timeFromStart === undefined ? 0 : toFiniteNumber(timeFromStart, 0),
    graphicInfo === undefined ? null : normalizeGraphicInfo(graphicInfo),
  );
  return ["OnSpecialFX", args];
}

function buildOnDamageStateChangePayload(entityID, damageState = null) {
  return [
    "OnDamageStateChange",
    [
      toInt32(entityID, 0),
      damageState,
    ],
  ];
}

function buildOnSlimItemChangePayload(entityID, slimItem = null) {
  return [
    "OnSlimItemChange",
    [
      toInt32(entityID, 0),
      slimItem || null,
    ],
  ];
}

function buildOnDbuffUpdatedPayload(entityID, dbuffState = []) {
  return [
    "OnDbuffUpdated",
    [
      toInt32(entityID, 0),
      Array.isArray(dbuffState) ? buildList(dbuffState) : dbuffState,
    ],
  ];
}

function buildTerminalPlayDestructionEffectPayload(entityID, destructionEffectID) {
  return [
    "TerminalPlayDestructionEffect",
    [
      toInt32(entityID, 0),
      toInt32(destructionEffectID, 0),
    ],
  ];
}

function buildRemoveBallPayload(entityID) {
  return ["RemoveBall", [entityID]];
}

function buildRemoveBallsPayload(entityIDs) {
  return ["RemoveBalls", [{ type: "list", items: entityIDs }]];
}

module.exports = {
  buildDamageState,
  buildSlimItemDict,
  buildSlimItemObject,
  buildAddBalls2Payload,
  buildSetStatePayload,
  restampPayloadState,
  buildDestinyUpdatePayload,
  buildGotoDirectionPayload,
  buildGotoPointPayload,
  buildFollowBallPayload,
  buildAddBallPayload,
  buildWarpToPayload,
  buildEntityWarpInPayload,
  buildOrbitPayload,
  buildSetSpeedFractionPayload,
  buildStopPayload,
  buildSetBallVelocityPayload,
  buildSetBallPositionPayload,
  buildOnDockingAcceptedPayload,
  buildSetBallAgilityPayload,
  buildSetBallMassPayload,
  buildSetMaxSpeedPayload,
  buildSetBallMassivePayload,
  buildGraphicInfoDict,
  buildOnSpecialFXPayload,
  buildOnDamageStateChangePayload,
  buildOnSlimItemChangePayload,
  buildOnDbuffUpdatedPayload,
  buildTerminalPlayDestructionEffectPayload,
  buildRemoveBallPayload,
  buildRemoveBallsPayload,
  debugDescribeEntityBall,
};
