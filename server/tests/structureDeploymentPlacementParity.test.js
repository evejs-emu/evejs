const assert = require("node:assert/strict");
const path = require("path");
const test = require("node:test");

const {
  DEPLOYMENT_POINT_TYPE,
  DEPLOY_DIST_MAX,
  findDeploymentConflict,
  validateDeploymentPlacement,
} = require(path.join(
  __dirname,
  "../src/services/structure/structureDeploymentPlacement",
));

const KEEPSTAR_TYPE_ID = 35834;
const ASTRAHUS_TYPE_ID = 35832;
const ANSIBLEX_TYPE_ID = 35841;
const STARGATE_TYPE_ID = 29625;
const VELATOR_TYPE_ID = 606;

function ball(itemID, typeID, x, radius = 0) {
  return {
    itemID,
    typeID,
    position: { x, y: 0, z: 0 },
    radius,
    pointType: DEPLOYMENT_POINT_TYPE.REAL_BALL,
  };
}

test("deployment placement matches CCP client distance clamp", () => {
  const result = validateDeploymentPlacement({
    solarSystemID: 30000142,
    typeID: ASTRAHUS_TYPE_ID,
    position: { x: DEPLOY_DIST_MAX + 1, y: 0, z: 0 },
    offset: { x: DEPLOY_DIST_MAX + 1, y: 0, z: 0 },
    scene: {
      staticEntities: [],
      dynamicEntities: new Map(),
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "DEPLOYMENT_DISTANCE_EXCEEDED");
  assert.equal(result.data.maximumDistance, DEPLOY_DIST_MAX);
});

test("deployment conflict includes deployed and blocker radii like structures.deployment.py", () => {
  const closeConflict = findDeploymentConflict(
    30000142,
    KEEPSTAR_TYPE_ID,
    { x: 100000, y: 0, z: 0 },
    [ball(990000001, VELATOR_TYPE_ID, 0, 50)],
  );

  assert.ok(closeConflict, "Expected own ship proximity to block a Keepstar");
  assert.equal(closeConflict.minimumDistance, 5000);
  assert.equal(closeConflict.ballTypeID, VELATOR_TYPE_ID);

  const legal = findDeploymentConflict(
    30000142,
    KEEPSTAR_TYPE_ID,
    { x: 160000, y: 0, z: 0 },
    [ball(990000001, VELATOR_TYPE_ID, 0, 50)],
  );

  assert.equal(legal, null);
});

test("Ansiblex deployment enforces the CCP 100,000km stargate restriction", () => {
  const conflict = findDeploymentConflict(
    30000142,
    ANSIBLEX_TYPE_ID,
    { x: 1000, y: 0, z: 0 },
    [ball(500000001, STARGATE_TYPE_ID, 0, 13054)],
  );

  assert.ok(conflict, "Expected Ansiblex near stargate to be blocked");
  assert.equal(conflict.minimumDistance, 100000000);
  assert.equal(conflict.ballTypeID, STARGATE_TYPE_ID);
});

test("validator consumes a live scene-style ballpark without loading systems", () => {
  const result = validateDeploymentPlacement({
    solarSystemID: 30000142,
    typeID: KEEPSTAR_TYPE_ID,
    position: { x: 160000, y: 0, z: 0 },
    offset: { x: 160000, y: 0, z: 0 },
    scene: {
      staticEntities: [],
      dynamicEntities: new Map([
        [990000001, {
          itemID: 990000001,
          typeID: VELATOR_TYPE_ID,
          position: { x: 0, y: 0, z: 0 },
          radius: 50,
        }],
      ]),
    },
  });

  assert.equal(result.success, true);
  assert.ok(result.data.checkedBalls >= 1);
});
