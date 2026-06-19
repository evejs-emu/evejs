const path = require("path");

const BaseService = require(path.join(__dirname, "../../baseService"));
const {
  buildShipResourceState,
} = require(path.join(__dirname, "../../fitting/liveFittingState"));
const {
  getActiveShipRecord,
} = require(path.join(__dirname, "../../character/characterState"));
const {
  buildFiletimeLong,
} = require(path.join(__dirname, "../../_shared/serviceHelpers"));
const {
  buildSystemWideEffectsPayloadForSystem,
  buildEmptySystemWideEffectsPayload,
} = require(path.join(__dirname, "./wormholeEnvironmentRuntime"));
const {
  buildBoundResult,
  jumpSessionToSolarSystem,
} = require(path.join(__dirname, "../../../space/transitions"));
const spaceRuntime = require(path.join(__dirname, "../../../space/runtime"));
const wormholeRuntime = require("./wormholeRuntime");

const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const FILETIME_TICKS_PER_MS = 10000n;
const WORMHOLE_ENTER_DISTANCE_METERS = 5000;
const WORMHOLE_JUMP_HANDOFF_DELAY_MS = 1500;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(vector = null, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(vector && vector.x, fallback.x),
    y: toFiniteNumber(vector && vector.y, fallback.y),
    z: toFiniteNumber(vector && vector.z, fallback.z),
  };
}

function subtractVectors(left, right) {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function magnitude(vector) {
  return Math.sqrt((vector.x ** 2) + (vector.y ** 2) + (vector.z ** 2));
}

function notifyWormholeJumpCancel(session) {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  session.sendNotification("OnWormholeJumpCancel", "clientID", []);
}

function scheduleWormholeJumpHandoff(callback, setTimeoutFn = setTimeout) {
  const timer = setTimeoutFn(callback, WORMHOLE_JUMP_HANDOFF_DELAY_MS);
  if (timer && typeof timer.unref === "function") {
    timer.unref();
  }
  return timer;
}

function syncSessionSystemWideEffectsForSystem(session, systemID) {
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }
  const payload =
    buildSystemWideEffectsPayloadForSystem(systemID) ||
    buildEmptySystemWideEffectsPayload();
  session.sendNotification("OnUpdateSystemWideEffectsInfo", "clientID", [
    payload,
  ]);
  return true;
}

function completeWormholeJump({
  session,
  sourceScene,
  sourceEndpointID,
  shipMass,
  prepareResult,
}) {
  if (!session || !prepareResult || !prepareResult.data) {
    return;
  }

  const pendingJump = session._wormholeJumpPending;
  if (
    !pendingJump ||
    Number(pendingJump.endpointID || 0) !== Number(sourceEndpointID || 0)
  ) {
    return;
  }
  session._wormholeJumpPending = null;

  const destinationSystemID = toInt(
    prepareResult.data.destinationSystemID,
    0,
  );
  if (destinationSystemID <= 0) {
    notifyWormholeJumpCancel(session);
    return;
  }

  const jumpResult = jumpSessionToSolarSystem(session, destinationSystemID, {
    spawnStateOverride: wormholeRuntime.buildJumpSpawnState(
      prepareResult.data.pair,
      prepareResult.data.role,
      {
        shipMass,
        nowMs: Date.now(),
        characterID: session.characterID,
      },
    ),
  });
  if (!jumpResult || jumpResult.success !== true) {
    notifyWormholeJumpCancel(session);
    return;
  }

  syncSessionSystemWideEffectsForSystem(session, destinationSystemID);

  const commitNowMs = Date.now();
  wormholeRuntime.commitJump(
    sourceEndpointID,
    session.characterID,
    shipMass,
    commitNowMs,
  );

  if (sourceScene) {
    wormholeRuntime.syncSceneEntities(sourceScene, commitNowMs);
  }

  const destinationScene = spaceRuntime.getSceneForSession(session);
  if (destinationScene) {
    wormholeRuntime.syncSceneEntities(destinationScene, commitNowMs);
    const arrivalShipEntity = destinationScene.getShipEntityForSession(session);
    const destinationEndpointID = toInt(
      prepareResult.data.destinationEndpointID,
      0,
    );
    const destinationWormholeEntity = destinationScene.getEntityByID(destinationEndpointID);
    if (arrivalShipEntity && destinationWormholeEntity) {
      destinationScene.broadcastSpecialFx(
        destinationWormholeEntity.itemID,
        "effects.WormholeActivity",
        {
          excludedSession: session,
        },
        arrivalShipEntity,
      );
    }
  }
}

class WormholeMgrService extends BaseService {
  constructor() {
    super("wormholeMgr");
  }

  Handle_GetWormholePolarization(args, session) {
    const endpointID = toInt(args && args[0], 0);
    if (!session || !session.characterID || endpointID <= 0) {
      return null;
    }
    const polarization = wormholeRuntime.getPolarization(
      endpointID,
      session.characterID,
      Date.now(),
    );
    if (!polarization) {
      return null;
    }
    const endFileTime =
      BigInt(toInt(polarization.endAtMs, 0)) * FILETIME_TICKS_PER_MS +
      FILETIME_EPOCH_OFFSET;
    return [
      buildFiletimeLong(endFileTime),
      Math.max(0, toInt(polarization.durationSeconds, 0)),
    ];
  }

  Handle_WormholeJump(args, session) {
    const endpointID = toInt(args && args[0], 0);
    if (!session || !session.characterID || !session._space || endpointID <= 0) {
      return null;
    }
    if (session._wormholeJumpPending) {
      return null;
    }

    const scene = spaceRuntime.getSceneForSession(session);
    if (!scene) {
      return null;
    }

    const sourceEntity = scene.getEntityByID(endpointID);
    const shipEntity = scene.getShipEntityForSession(session);
    if (!sourceEntity || sourceEntity.kind !== "wormhole" || !shipEntity) {
      return null;
    }

    const surfaceDistance = Math.max(
      0,
      magnitude(subtractVectors(
        cloneVector(shipEntity.position),
        cloneVector(sourceEntity.position),
      )) - Math.max(0, toFiniteNumber(sourceEntity.radius, 0)),
    );
    if (surfaceDistance > WORMHOLE_ENTER_DISTANCE_METERS) {
      return null;
    }

    const activeShip = getActiveShipRecord(session.characterID);
    if (!activeShip) {
      return null;
    }
    const resourceState = buildShipResourceState(session.characterID, activeShip);
    const shipMass = Math.max(0, toInt(resourceState && resourceState.mass, 0));
    const prepareResult = wormholeRuntime.prepareJump(
      endpointID,
      session.characterID,
      shipMass,
      Date.now(),
    );
    if (!prepareResult.success) {
      if (prepareResult.errorMsg === "WORMHOLE_COLLAPSED") {
        notifyWormholeJumpCancel(session);
      }
      return null;
    }

    const destinationSystemID = toInt(
      prepareResult.data && prepareResult.data.destinationSystemID,
      0,
    );
    if (destinationSystemID <= 0) {
      return null;
    }

    scene.broadcastSpecialFx(
      shipEntity.itemID,
      "effects.JumpOutWormhole",
      {
        targetID: sourceEntity.itemID,
        start: true,
        active: false,
        otherTypeID: toInt(prepareResult.data.destinationClassID, 0),
        graphicInfo: [destinationSystemID],
        useCurrentStamp: true,
        useImmediateClientVisibleStamp: true,
        resultSession: session,
      },
      shipEntity,
    );
    scene.broadcastSpecialFx(
      sourceEntity.itemID,
      "effects.WormholeActivity",
      {
        excludedSession: session,
      },
      shipEntity,
    );
    session._wormholeJumpPending = {
      endpointID,
      destinationSystemID,
      queuedAtMs: Date.now(),
    };
    scheduleWormholeJumpHandoff(() => {
      completeWormholeJump({
        session,
        sourceScene: scene,
        sourceEndpointID: endpointID,
        shipMass,
        prepareResult,
      });
    });

    return buildBoundResult(session);
  }
}

module.exports = WormholeMgrService;
module.exports._testing = {
  WORMHOLE_JUMP_HANDOFF_DELAY_MS,
  scheduleWormholeJumpHandoff,
  syncSessionSystemWideEffectsForSystem,
};
