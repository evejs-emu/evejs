const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const worldData = require(path.join(repoRoot, "server/src/space/worldData"));
const {
  resolveStargatePhysicalRadius,
} = require(path.join(repoRoot, "server/src/space/stargateRadius"));
const {
  getStargateVisualOverrideField,
} = require(path.join(repoRoot, "server/src/space/stargateVisualOverrides"));

function assertFiniteVector(vector) {
  assert.equal(Number.isFinite(vector.x), true);
  assert.equal(Number.isFinite(vector.y), true);
  assert.equal(Number.isFinite(vector.z), true);
}

test("stargate visual overrides feed static gate skin metadata", () => {
  const stargate = worldData.getStargateByID(50001248);
  assert.ok(stargate, "expected test stargate static data");
  assert.equal(getStargateVisualOverrideField(stargate, "skinMaterialSetID"), 3636);

  const entity = spaceRuntime._testing.buildStaticStargateEntityForTesting(stargate);
  assert.equal(entity.skinMaterialSetID, 3636);
  assert.equal(entity.radius, resolveStargatePhysicalRadius(stargate));
  assert.equal(entity.interactionRadius, 2500);
});

test("derived stargate orientation is system-forward and finite", () => {
  const stargate = worldData.getStargateByID(50001248);
  const rotation = spaceRuntime._testing.getStargateDerivedDunRotation(stargate);
  assert.ok(Array.isArray(rotation));
  assert.equal(rotation.length, 3);
  for (const value of rotation) {
    assert.equal(Number.isFinite(value), true);
  }
});

test("stargate warp target lands near the resolved gate envelope", () => {
  const stargate = worldData.getStargateByID(50001248);
  const ship = {
    itemID: 991234567,
    typeID: 587,
    radius: 120,
    position: {
      x: stargate.position.x + 100000,
      y: stargate.position.y,
      z: stargate.position.z,
    },
    direction: { x: -1, y: 0, z: 0 },
  };

  const target = spaceRuntime._testing.resolveStargateWarpTargetForTesting(
    ship,
    stargate,
    0,
  );
  assert.ok(target);
  assertFiniteVector(target.rawDestination);
  assert.ok(target.stopDistance >= 1);
  assert.ok(target.stopDistance <= 2500);
});

test("large client objects get deterministic client parity warp-in points", () => {
  const target = {
    itemID: 40000001,
    kind: "planet",
    categoryID: 2,
    groupID: 7,
    radius: 120000,
    position: { x: 1000, y: 2000, z: 3000 },
  };

  const warpInPoint = spaceRuntime._testing.getClientParityWarpInPointForTesting(target);
  assert.ok(warpInPoint);
  assertFiniteVector(warpInPoint);
  assert.notDeepEqual(warpInPoint, target.position);
});
