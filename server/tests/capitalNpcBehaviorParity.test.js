const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveCapitalBehaviorTarget,
} = require("../src/space/npc/capitals/capitalNpcTargeting");
const {
  resolveCapitalEngagementPolicy,
} = require("../src/space/npc/capitals/capitalNpcEngagement");
const {
  getCapitalControllerState,
} = require("../src/space/npc/capitals/capitalNpcState");
const {
  syncCapitalNpcMovement,
  syncCapitalNpcReturnHome,
} = require("../src/space/npc/capitals/capitalNpcMovement");

function buildFakeScene(entities = []) {
  const entityMap = new Map(
    entities.map((entity) => [Number(entity && entity.itemID) || 0, entity]),
  );
  return {
    dynamicEntities: entityMap,
    getEntityByID(entityID) {
      return entityMap.get(Number(entityID) || 0) || null;
    },
    getCurrentSimTimeMs() {
      return 15_000;
    },
  };
}

function buildFakeShip(itemID, positionX = 0) {
  return {
    kind: "ship",
    itemID,
    position: { x: positionX, y: 0, z: 0 },
    radius: 1_000,
    bubbleID: 77,
  };
}

function buildFakeMovementScene() {
  const calls = [];
  return {
    calls,
    followBall(_session, targetID, range) {
      calls.push({
        fn: "followBall",
        targetID: Number(targetID) || 0,
        range: Number(range) || 0,
      });
    },
    gotoDirection(_session, direction) {
      calls.push({
        fn: "gotoDirection",
        direction,
      });
    },
    stop() {
      calls.push({
        fn: "stop",
      });
    },
  };
}

test("capital targeting keeps a valid current target during the retarget stick window", () => {
  const entity = {
    ...buildFakeShip(7000, 0),
    capitalNpc: true,
    capitalClassID: "dreadnought",
  };
  const currentTarget = buildFakeShip(7001, 40_000);
  const alternateTarget = buildFakeShip(7002, 28_000);
  const scene = buildFakeScene([entity, currentTarget, alternateTarget]);
  const controller = {
    currentTargetID: currentTarget.itemID,
    preferredTargetID: alternateTarget.itemID,
    capitalNpcState: {
      launchedTubeFlagIDs: [],
      lastTargetSwapAtMs: 10_000,
    },
  };

  const resolved = resolveCapitalBehaviorTarget(
    scene,
    entity,
    controller,
    { aggressionRangeMeters: 250_000 },
    {
      nowMs: 15_000,
      aggressionRangeMeters: 250_000,
      allowedTargetClasses: ["player"],
      doctrine: {
        classID: "dreadnought",
        preferredCombatRangeMeters: 30_000,
        settleToleranceMeters: 5_000,
      },
      isValidCombatTarget() {
        return true;
      },
      resolveCombatActorClass() {
        return "player";
      },
      getSurfaceDistance(left, right) {
        return Math.abs(Number(left.position.x) - Number(right.position.x));
      },
    },
  );

  assert.equal(resolved, currentTarget);
});

test("capital targeting can retarget once the stick window expires and the new target clearly scores better", () => {
  const entity = {
    ...buildFakeShip(7100, 0),
    capitalNpc: true,
    capitalClassID: "dreadnought",
  };
  const currentTarget = buildFakeShip(7101, 80_000);
  const alternateTarget = buildFakeShip(7102, 30_000);
  const scene = buildFakeScene([entity, currentTarget, alternateTarget]);
  const controller = {
    currentTargetID: currentTarget.itemID,
    preferredTargetID: alternateTarget.itemID,
  };

  const resolved = resolveCapitalBehaviorTarget(
    scene,
    entity,
    controller,
    { aggressionRangeMeters: 60_000 },
    {
      nowMs: 30_000,
      aggressionRangeMeters: 60_000,
      allowedTargetClasses: ["player"],
      doctrine: {
        classID: "dreadnought",
        preferredCombatRangeMeters: 30_000,
        settleToleranceMeters: 5_000,
      },
      isValidCombatTarget() {
        return true;
      },
      resolveCombatActorClass() {
        return "player";
      },
      getSurfaceDistance(left, right) {
        return Math.abs(Number(left.position.x) - Number(right.position.x));
      },
    },
  );

  assert.equal(resolved, alternateTarget);
  const capitalState = getCapitalControllerState(controller);
  assert.equal(capitalState.lastTargetID, alternateTarget.itemID);
  assert.equal(capitalState.lastTargetSwapAtMs, 30_000);
});

test("dread engagement blocks weapons while still outside its preferred range band", () => {
  const entity = {
    ...buildFakeShip(7200, 0),
    capitalNpc: true,
    capitalClassID: "dreadnought",
  };
  const target = buildFakeShip(7201, 140_000);
  const controller = {};

  const result = resolveCapitalEngagementPolicy(
    entity,
    controller,
    {},
    target,
    {
      nowMs: 50_000,
      doctrine: {
        classID: "dreadnought",
        preferredCombatRangeMeters: 70_000,
        settleToleranceMeters: 8_000,
      },
      getSurfaceDistance(left, right) {
        return Math.abs(Number(left.position.x) - Number(right.position.x));
      },
    },
  );

  assert.equal(result.allowWeapons, false);
  assert.equal(result.rangeBand, "tooFar");
  assert.ok(Number(result.nextThinkOverrideMs) > 50_000);
});

test("titan engagement applies a retarget delay before allowing weapons on a new target", () => {
  const entity = {
    ...buildFakeShip(7300, 0),
    capitalNpc: true,
    capitalClassID: "titan",
  };
  const target = buildFakeShip(7301, 50_000);
  const controller = {};

  const firstResult = resolveCapitalEngagementPolicy(
    entity,
    controller,
    {},
    target,
    {
      nowMs: 100_000,
      doctrine: {
        classID: "titan",
        preferredCombatRangeMeters: 55_000,
        settleToleranceMeters: 10_000,
      },
      getSurfaceDistance(left, right) {
        return Math.abs(Number(left.position.x) - Number(right.position.x));
      },
    },
  );
  assert.equal(firstResult.allowWeapons, false);

  const secondResult = resolveCapitalEngagementPolicy(
    entity,
    controller,
    {},
    target,
    {
      nowMs: 101_600,
      doctrine: {
        classID: "titan",
        preferredCombatRangeMeters: 55_000,
        settleToleranceMeters: 10_000,
      },
      getSurfaceDistance(left, right) {
        return Math.abs(Number(left.position.x) - Number(right.position.x));
      },
    },
  );
  assert.equal(secondResult.allowWeapons, true);
  assert.equal(secondResult.rangeBand, "settled");
});

test("dread engagement keeps weapons blocked while the target is still inside the preferred range band", () => {
  const entity = {
    ...buildFakeShip(7400, 0),
    capitalNpc: true,
    capitalClassID: "dreadnought",
  };
  const target = buildFakeShip(7401, 20_000);
  const controller = {};

  const result = resolveCapitalEngagementPolicy(
    entity,
    controller,
    {},
    target,
    {
      nowMs: 60_000,
      doctrine: {
        classID: "dreadnought",
        preferredCombatRangeMeters: 70_000,
        settleToleranceMeters: 8_000,
      },
      getSurfaceDistance(left, right) {
        return Math.abs(Number(left.position.x) - Number(right.position.x));
      },
    },
  );

  assert.equal(result.allowWeapons, false);
  assert.equal(result.rangeBand, "inside");
  assert.ok(Number(result.nextThinkOverrideMs) > 60_000);
});

test("capital movement withdraws from an inside-band target and throttles repeated jolt-prone goto refreshes", () => {
  const entity = {
    ...buildFakeShip(7500, 0),
    capitalNpc: true,
    capitalClassID: "titan",
    direction: { x: 1, y: 0, z: 0 },
    mode: "STOP",
  };
  const target = buildFakeShip(7501, 18_000);
  const controller = {};
  const scene = buildFakeMovementScene();

  const handledFirst = syncCapitalNpcMovement(
    scene,
    entity,
    controller,
    target,
    {
      movementMode: "follow",
      capitalDoctrine: {
        classID: "titan",
        preferredCombatRangeMeters: 55_000,
        settleToleranceMeters: 10_000,
      },
    },
    { nowMs: 1_000 },
  );
  assert.equal(handledFirst, true);
  assert.equal(scene.calls.length, 1);
  assert.equal(scene.calls[0].fn, "gotoDirection");
  assert.ok(Number(scene.calls[0].direction.x) < 0);

  entity.mode = "GOTO";
  const handledSecond = syncCapitalNpcMovement(
    scene,
    entity,
    controller,
    target,
    {
      movementMode: "follow",
      capitalDoctrine: {
        classID: "titan",
        preferredCombatRangeMeters: 55_000,
        settleToleranceMeters: 10_000,
      },
    },
    { nowMs: 1_100 },
  );
  assert.equal(handledSecond, true);
  assert.equal(scene.calls.length, 1);

  const handledThird = syncCapitalNpcMovement(
    scene,
    entity,
    controller,
    target,
    {
      movementMode: "follow",
      capitalDoctrine: {
        classID: "titan",
        preferredCombatRangeMeters: 55_000,
        settleToleranceMeters: 10_000,
      },
    },
    { nowMs: 1_400 },
  );
  assert.equal(handledThird, true);
  assert.equal(scene.calls.length, 2);
  assert.equal(scene.calls[1].fn, "gotoDirection");
});

test("capital return-home uses the capital throttle window and stops cleanly inside the home arrival band", () => {
  const entity = {
    ...buildFakeShip(7600, 90_000),
    capitalNpc: true,
    capitalClassID: "dreadnought",
    direction: { x: 1, y: 0, z: 0 },
    mode: "STOP",
    speedFraction: 1,
  };
  const controller = {
    homePosition: { x: 0, y: 0, z: 0 },
  };
  const scene = buildFakeMovementScene();

  const handledFirst = syncCapitalNpcReturnHome(
    scene,
    entity,
    controller,
    {
      returnToHomeWhenIdle: true,
      homeArrivalMeters: 6_000,
    },
    { nowMs: 2_000 },
  );
  assert.equal(handledFirst, true);
  assert.equal(controller.returningHome, true);
  assert.equal(scene.calls.length, 1);
  assert.equal(scene.calls[0].fn, "gotoDirection");
  assert.ok(Number(scene.calls[0].direction.x) < 0);

  entity.mode = "GOTO";
  const handledSecond = syncCapitalNpcReturnHome(
    scene,
    entity,
    controller,
    {
      returnToHomeWhenIdle: true,
      homeArrivalMeters: 6_000,
    },
    { nowMs: 2_100 },
  );
  assert.equal(handledSecond, true);
  assert.equal(scene.calls.length, 1);

  entity.position = { x: 3_000, y: 0, z: 0 };
  const handledThird = syncCapitalNpcReturnHome(
    scene,
    entity,
    controller,
    {
      returnToHomeWhenIdle: true,
      homeArrivalMeters: 6_000,
    },
    { nowMs: 3_000 },
  );
  assert.equal(handledThird, true);
  assert.equal(controller.returningHome, false);
  assert.equal(scene.calls[1].fn, "stop");
});
