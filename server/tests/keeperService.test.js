const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const KeeperService = require(path.join(
  repoRoot,
  "server/src/services/dungeon/keeperService",
));
const dungeonAuthority = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonAuthority",
));
const dungeonRuntime = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonRuntime",
));
const dungeonUniverseSiteService = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonUniverseSiteService",
));
const spaceRuntime = require(path.join(
  repoRoot,
  "server/src/space/runtime",
));

function buildSession() {
  return {
    characterID: 140000005,
    charid: 140000005,
    shipID: 2990000754,
    shipid: 2990000754,
    solarsystemid: 30002187,
    solarsystemid2: 30002187,
  };
}

function withRuntimeStubs(fn) {
  return async () => {
    const originals = {
      getSceneForSession: spaceRuntime.getSceneForSession,
      warpDynamicEntityToPoint: spaceRuntime.warpDynamicEntityToPoint,
      forceStartPendingWarp: spaceRuntime.forceStartPendingWarp,
      ensureTemplateRuntimeState: dungeonRuntime.ensureTemplateRuntimeState,
      getInstance: dungeonRuntime.getInstance,
      activateRoom: dungeonRuntime.activateRoom,
      recordGateUse: dungeonRuntime.recordGateUse,
      ensureSiteContentsMaterialized: dungeonUniverseSiteService.ensureSiteContentsMaterialized,
      getTemplateByID: dungeonAuthority.getTemplateByID,
    };
    try {
      await fn();
    } finally {
      spaceRuntime.getSceneForSession = originals.getSceneForSession;
      spaceRuntime.warpDynamicEntityToPoint = originals.warpDynamicEntityToPoint;
      spaceRuntime.forceStartPendingWarp = originals.forceStartPendingWarp;
      dungeonRuntime.ensureTemplateRuntimeState = originals.ensureTemplateRuntimeState;
      dungeonRuntime.getInstance = originals.getInstance;
      dungeonRuntime.activateRoom = originals.activateRoom;
      dungeonRuntime.recordGateUse = originals.recordGateUse;
      dungeonUniverseSiteService.ensureSiteContentsMaterialized =
        originals.ensureSiteContentsMaterialized;
      dungeonAuthority.getTemplateByID = originals.getTemplateByID;
    }
  };
}

test("keeper ActivateAccelerationGate warps the pilot into the destination pocket and records gate use", withRuntimeStubs(() => {
  const service = new KeeperService();
  const session = buildSession();
  const siteID = 5_330_003_700_001;
  const gateID = 539_450_370_000_101;
  const shipEntity = {
    itemID: session.shipID,
    position: { x: 20_000, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    radius: 500,
  };
  const siteEntity = {
    itemID: siteID,
    position: { x: 0, y: 0, z: 0 },
  };
  const gateEntity = {
    itemID: gateID,
    position: { x: 22_000, y: 0, z: 0 },
    radius: 12_000,
    dungeonMaterializedGate: true,
    dungeonSiteID: siteID,
    dungeonSiteInstanceID: 4212,
    dungeonGateKey: "gate:402563",
    dungeonGateDestinationRoomKey: "room:402564",
  };
  const scene = {
    systemID: 30002187,
    staticEntitiesByID: new Map([
      [siteID, siteEntity],
      [gateID, gateEntity],
    ]),
    getEntityByID(entityID) {
      if (Number(entityID) === siteID) {
        return siteEntity;
      }
      if (Number(entityID) === gateID) {
        return gateEntity;
      }
      if (Number(entityID) === shipEntity.itemID) {
        return shipEntity;
      }
      return null;
    },
    getShipEntityForSession() {
      return shipEntity;
    },
    flushDirectDestinyNotificationBatchIfIdle() {},
  };
  const instance = {
    instanceID: 4212,
    templateID: "client-dungeon:gate-test",
    gateStatesByKey: {
      "gate:402563": {
        gateKey: "gate:402563",
        state: "unlocked",
        destinationRoomKey: "room:402564",
      },
    },
    roomStatesByKey: {
      "room:entry": { roomKey: "room:entry", state: "completed" },
      "room:402564": { roomKey: "room:402564", state: "pending" },
    },
  };
  const template = {
    templateID: "client-dungeon:gate-test",
    siteSceneProfile: {
      roomProfiles: [
        { roomKey: "room:entry" },
        { roomKey: "room:402564" },
      ],
    },
  };

  let ensured = null;
  let activated = null;
  let recorded = null;
  let warped = null;
  let forceStarted = null;

  spaceRuntime.getSceneForSession = () => scene;
  spaceRuntime.warpDynamicEntityToPoint = (systemID, entityOrID, point, options = {}) => {
    warped = { systemID, entityOrID, point, options };
    return { success: true, data: {} };
  };
  spaceRuntime.forceStartPendingWarp = (systemID, entityOrID, options = {}) => {
    forceStarted = { systemID, entityOrID, options };
    return { success: true, data: {} };
  };
  dungeonUniverseSiteService.ensureSiteContentsMaterialized = (_scene, siteOrInstance, options = {}) => {
    ensured = { siteOrInstance, options };
    return { success: true, data: {} };
  };
  dungeonAuthority.getTemplateByID = () => template;
  dungeonRuntime.ensureTemplateRuntimeState = () => instance;
  dungeonRuntime.getInstance = () => instance;
  dungeonRuntime.activateRoom = (_instanceID, roomKey, options = {}) => {
    activated = { roomKey, options };
    return {
      ...instance,
      roomStatesByKey: {
        ...instance.roomStatesByKey,
        [roomKey]: {
          ...instance.roomStatesByKey[roomKey],
          state: "active",
        },
      },
    };
  };
  dungeonRuntime.recordGateUse = (_instanceID, gateKey, options = {}) => {
    recorded = { gateKey, options };
    return instance;
  };

  const result = service.Handle_ActivateAccelerationGate([gateID], session);

  assert.equal(result, null);
  assert.ok(ensured, "expected deferred site contents to be materialized");
  assert.equal(Number(ensured.siteOrInstance.instanceID), 4212);
  assert.equal(ensured.options.broadcast, true);
  assert.equal(activated && activated.roomKey, "room:402564");
  assert.equal(recorded && recorded.gateKey, "gate:402563");
  assert.ok(warped, "expected acceleration gate to start a warp");
  assert.ok(forceStarted, "expected acceleration gate to force-start the pending warp");
  assert.equal(Number(warped.systemID), scene.systemID);
  assert.equal(Number(warped.entityOrID.itemID), shipEntity.itemID);
  const pocketDistance = Math.sqrt(
    ((Number(warped.point.x) || 0) - (Number(siteEntity.position.x) || 0)) ** 2 +
    ((Number(warped.point.y) || 0) - (Number(siteEntity.position.y) || 0)) ** 2 +
    ((Number(warped.point.z) || 0) - (Number(siteEntity.position.z) || 0)) ** 2
  );
  assert.equal(pocketDistance >= 1_000_000, true);
  assert.equal(warped.options.forceImmediateStart, true);
  assert.equal(forceStarted.options.clearVisibilitySuppression, true);
}));

test("keeper ActivateAccelerationGate throws a wrapped user error when the gate is still locked", withRuntimeStubs(() => {
  const service = new KeeperService();
  const session = buildSession();
  const siteID = 5_330_003_700_001;
  const gateID = 539_450_370_000_101;
  const shipEntity = {
    itemID: session.shipID,
    position: { x: 20_000, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    radius: 500,
  };
  const siteEntity = {
    itemID: siteID,
    position: { x: 0, y: 0, z: 0 },
  };
  const gateEntity = {
    itemID: gateID,
    position: { x: 22_000, y: 0, z: 0 },
    radius: 12_000,
    dungeonMaterializedGate: true,
    dungeonSiteID: siteID,
    dungeonSiteInstanceID: 4212,
    dungeonGateKey: "gate:402563",
    dungeonGateDestinationRoomKey: "room:402564",
  };
  const scene = {
    systemID: 30002187,
    staticEntitiesByID: new Map([
      [siteID, siteEntity],
      [gateID, gateEntity],
    ]),
    getEntityByID(entityID) {
      if (Number(entityID) === siteID) {
        return siteEntity;
      }
      if (Number(entityID) === gateID) {
        return gateEntity;
      }
      if (Number(entityID) === shipEntity.itemID) {
        return shipEntity;
      }
      return null;
    },
    getShipEntityForSession() {
      return shipEntity;
    },
    flushDirectDestinyNotificationBatchIfIdle() {},
  };

  spaceRuntime.getSceneForSession = () => scene;
  spaceRuntime.warpDynamicEntityToPoint = () => {
    throw new Error("warp should not be reached for locked gates");
  };
  spaceRuntime.forceStartPendingWarp = () => {
    throw new Error("forceStartPendingWarp should not be reached for locked gates");
  };
  dungeonUniverseSiteService.ensureSiteContentsMaterialized = () => ({ success: true, data: {} });
  dungeonAuthority.getTemplateByID = () => ({
    templateID: "client-dungeon:gate-test",
    siteSceneProfile: {
      roomProfiles: [
        { roomKey: "room:entry" },
        { roomKey: "room:402564" },
      ],
    },
  });
  dungeonRuntime.ensureTemplateRuntimeState = () => ({
    instanceID: 4212,
    templateID: "client-dungeon:gate-test",
    gateStatesByKey: {
      "gate:402563": {
        gateKey: "gate:402563",
        state: "locked",
        destinationRoomKey: "room:402564",
      },
    },
    roomStatesByKey: {
      "room:entry": { roomKey: "room:entry", state: "active" },
      "room:402564": { roomKey: "room:402564", state: "pending" },
    },
  });
  dungeonRuntime.getInstance = () => ({
    instanceID: 4212,
    templateID: "client-dungeon:gate-test",
    gateStatesByKey: {
      "gate:402563": {
        gateKey: "gate:402563",
        state: "locked",
        destinationRoomKey: "room:402564",
      },
    },
    roomStatesByKey: {
      "room:entry": { roomKey: "room:entry", state: "active" },
      "room:402564": { roomKey: "room:402564", state: "pending" },
    },
  });
  dungeonRuntime.activateRoom = () => {
    throw new Error("activateRoom should not be reached for locked gates");
  };
  dungeonRuntime.recordGateUse = () => {
    throw new Error("recordGateUse should not be reached for locked gates");
  };

  assert.throws(
    () => service.Handle_ActivateAccelerationGate([gateID], session),
    (error) => Boolean(error && error.machoErrorResponse),
  );
}));

test("keeper ActivateAccelerationGate heals missing seeded gate runtime state before validating the gate", withRuntimeStubs(() => {
  const service = new KeeperService();
  const session = buildSession();
  const siteID = 5_330_003_700_001;
  const gateID = 539_450_370_000_101;
  const shipEntity = {
    itemID: session.shipID,
    position: { x: 20_000, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    radius: 500,
  };
  const siteEntity = {
    itemID: siteID,
    position: { x: 0, y: 0, z: 0 },
  };
  const gateEntity = {
    itemID: gateID,
    position: { x: 22_000, y: 0, z: 0 },
    radius: 12_000,
    dungeonMaterializedGate: true,
    dungeonSiteID: siteID,
    dungeonSiteInstanceID: 4212,
    dungeonGateKey: "gate:402563",
    dungeonGateDestinationRoomKey: "room:402564",
  };
  const scene = {
    systemID: 30002187,
    staticEntitiesByID: new Map([
      [siteID, siteEntity],
      [gateID, gateEntity],
    ]),
    getEntityByID(entityID) {
      if (Number(entityID) === siteID) {
        return siteEntity;
      }
      if (Number(entityID) === gateID) {
        return gateEntity;
      }
      if (Number(entityID) === shipEntity.itemID) {
        return shipEntity;
      }
      return null;
    },
    getShipEntityForSession() {
      return shipEntity;
    },
    flushDirectDestinyNotificationBatchIfIdle() {},
  };
  const healedInstance = {
    instanceID: 4212,
    templateID: "client-dungeon:gate-test",
    gateStatesByKey: {
      "gate:402563": {
        gateKey: "gate:402563",
        state: "unlocked",
        destinationRoomKey: "room:402564",
      },
    },
    roomStatesByKey: {
      "room:entry": { roomKey: "room:entry", state: "completed" },
      "room:402564": { roomKey: "room:402564", state: "pending" },
    },
  };

  let warped = false;
  let forceStarted = false;

  spaceRuntime.getSceneForSession = () => scene;
  dungeonUniverseSiteService.ensureSiteContentsMaterialized = () => ({ success: true, data: {} });
  dungeonRuntime.ensureTemplateRuntimeState = () => healedInstance;
  dungeonAuthority.getTemplateByID = () => ({
    templateID: "client-dungeon:gate-test",
    siteSceneProfile: {
      roomProfiles: [
        { roomKey: "room:entry" },
        { roomKey: "room:402564" },
      ],
    },
  });
  dungeonRuntime.getInstance = () => ({
    instanceID: 4212,
    templateID: "client-dungeon:gate-test",
    gateStatesByKey: {},
    roomStatesByKey: {
      "room:entry": { roomKey: "room:entry", state: "completed" },
      "room:402564": { roomKey: "room:402564", state: "pending" },
    },
  });
  dungeonRuntime.activateRoom = () => healedInstance;
  dungeonRuntime.recordGateUse = () => healedInstance;
  spaceRuntime.warpDynamicEntityToPoint = () => {
    warped = true;
    return { success: true, data: {} };
  };
  spaceRuntime.forceStartPendingWarp = () => {
    forceStarted = true;
    return { success: true, data: {} };
  };

  const result = service.Handle_ActivateAccelerationGate([gateID], session);

  assert.equal(result, null);
  assert.equal(warped, true);
  assert.equal(forceStarted, true);
}));
