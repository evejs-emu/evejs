const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const ScanMgrService = require(path.join(
  repoRoot,
  "server/src/services/exploration/scanMgrService",
));
const runtime = require(path.join(repoRoot, "server/src/space/runtime"));
const {
  marshalObjectToObject,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/serviceHelpers",
));

const originalGetSceneForSession = runtime.getSceneForSession;

function buildEntity(overrides = {}) {
  return {
    itemID: 0,
    typeID: 0,
    groupID: 25,
    kind: "ship",
    mode: "STOP",
    radius: 0,
    position: { x: 0, y: 0, z: 0 },
    ...overrides,
  };
}

function buildScene({ egoEntity, dynamicEntities = [], staticEntities = [] }) {
  const dynamicMap = new Map(
    [egoEntity, ...dynamicEntities].map((entity) => [Number(entity.itemID), entity]),
  );
  return {
    dynamicEntities: dynamicMap,
    staticEntities: [...staticEntities],
    getShipEntityForSession() {
      return egoEntity;
    },
    getEntityByID(itemID) {
      return dynamicMap.get(Number(itemID)) || null;
    },
  };
}

function buildSession() {
  return {
    characterID: 140000003,
    charid: 140000003,
    userid: 2,
    shipid: 991006380,
    _space: {
      systemID: 30000142,
      shipID: 991006380,
    },
  };
}

function extractResultIDs(results) {
  return (Array.isArray(results) ? results : []).map((entry) =>
    Number(marshalObjectToObject(entry).id || 0),
  );
}

test.after(() => {
  runtime.getSceneForSession = originalGetSceneForSession;
});

test.afterEach(() => {
  runtime.getSceneForSession = originalGetSceneForSession;
});

test("scanMgr ConeScan uses the live scene, respects cone/range, and filters invalid result families", () => {
  const egoEntity = buildEntity({
    itemID: 991006380,
    typeID: 670,
    radius: 50,
    maxDirectionalScanRange: 50_000,
  });
  const scene = buildScene({
    egoEntity,
    dynamicEntities: [
      buildEntity({
        itemID: 2001,
        typeID: 603,
        position: { x: 20_000, y: 0, z: 0 },
        radius: 100,
      }),
      buildEntity({
        itemID: 2002,
        typeID: 602,
        position: { x: 0, y: 20_000, z: 0 },
      }),
      buildEntity({
        itemID: 2003,
        typeID: 605,
        position: { x: 60_000, y: 0, z: 0 },
      }),
      buildEntity({
        itemID: 2004,
        typeID: 606,
        position: { x: 10_000, y: 0, z: 0 },
        mode: "WARP",
        warpState: { warpSpeed: 3 },
      }),
      buildEntity({
        itemID: 2005,
        typeID: 607,
        groupID: 502,
        position: { x: 10_000, y: 0, z: 0 },
      }),
    ],
    staticEntities: [
      buildEntity({
        itemID: 3001,
        typeID: 14,
        groupID: 6,
        kind: "wormhole",
        position: { x: 15_000, y: 0, z: 0 },
      }),
    ],
  });
  runtime.getSceneForSession = () => scene;

  const service = new ScanMgrService();
  const results = service.Handle_ConeScan(
    [Math.PI / 2, 50_000, 1, 0, 0],
    buildSession(),
  );

  assert.deepEqual(extractResultIDs(results), [3001, 2001]);
  const firstResult = marshalObjectToObject(results[0]);
  assert.equal(firstResult.typeID, 14);
  assert.equal(firstResult.groupID, 6);
});

test("scanMgr ConeScan clamps requested range to the ship cap and supports full 360-degree sweeps", () => {
  const egoEntity = buildEntity({
    itemID: 991006380,
    typeID: 670,
    radius: 50,
    maxDirectionalScanRange: 25_000,
  });
  const scene = buildScene({
    egoEntity,
    dynamicEntities: [
      buildEntity({
        itemID: 4001,
        typeID: 603,
        position: { x: 0, y: 20_000, z: 0 },
      }),
      buildEntity({
        itemID: 4002,
        typeID: 604,
        position: { x: 0, y: 30_000, z: 0 },
      }),
    ],
  });
  runtime.getSceneForSession = () => scene;

  const service = new ScanMgrService();
  const results = service.Handle_ConeScan(
    [Math.PI * 2, 9_999_999, 1, 0, 0],
    buildSession(),
  );

  assert.deepEqual(extractResultIDs(results), [4001]);
});
