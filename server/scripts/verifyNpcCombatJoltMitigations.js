const path = require("path");

const npcBehaviorLoop = require(path.join(__dirname, "../src/space/npc/npcBehaviorLoop"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildSyntheticPropScene() {
  const events = [];
  return {
    events,
    getCurrentSimTimeMs() {
      return 1_775_097_588_000;
    },
    refreshShipEntityDerivedState(entity, options = {}) {
      events.push({
        type: "refresh",
        entityID: entity && entity.itemID,
        options,
      });
      return { success: true };
    },
    broadcastSpecialFx(shipID, guid, options = {}, visibilityEntity = null) {
      events.push({
        type: "fx",
        shipID,
        guid,
        options,
        visibilityEntityID: visibilityEntity && visibilityEntity.itemID,
      });
      return { deliveredCount: 1, stamp: 123 };
    },
    deactivatePropulsionModule() {
      events.push({ type: "real-prop-deactivate" });
      return { success: true };
    },
    activatePropulsionModule() {
      events.push({ type: "real-prop-activate" });
      return { success: true };
    },
  };
}

function buildNativeMissileNpc() {
  return {
    itemID: 980000099001,
    typeID: 602,
    groupID: 25,
    categoryID: 6,
    kind: "ship",
    nativeNpc: true,
    position: { x: 0, y: 0, z: 0 },
    radius: 35,
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    speedFraction: 1,
    activeModuleEffects: new Map(),
    fittedItems: [
      {
        itemID: 980199000001,
        typeID: 13926,
        groupID: 509,
        categoryID: 7,
        flagID: 27,
        quantity: 1,
        itemName: "Dread Guristas Light Missile Launcher",
      },
    ],
    nativeCargoItems: [
      {
        itemID: 980199000101,
        typeID: 27365,
        groupID: 384,
        categoryID: 8,
        moduleID: 980199000001,
        stacksize: 1,
        quantity: 1,
        itemName: "Dread Guristas Scourge Light Missile",
      },
    ],
  };
}

function verifySyntheticPropulsionUsesHeldFutureStamp() {
  const scene = buildSyntheticPropScene();
  const entity = {
    itemID: 980000099100,
    typeID: 602,
    kind: "ship",
    nativeNpc: false,
    position: { x: 0, y: 0, z: 0 },
    radius: 35,
    activeModuleEffects: new Map(),
  };
  const farTarget = {
    itemID: 991002978,
    kind: "ship",
    position: { x: 20_000, y: 0, z: 0 },
    radius: 1000,
  };
  const nearTarget = {
    itemID: 991002978,
    kind: "ship",
    position: { x: 1_000, y: 0, z: 0 },
    radius: 1000,
  };
  const behaviorProfile = {
    useChasePropulsion: true,
    syntheticChasePropulsionTier: "small",
    chasePropulsionActivateDistanceMeters: 16_000,
    chasePropulsionDeactivateDistanceMeters: 11_000,
  };

  npcBehaviorLoop.__testing.syncNpcPropulsion(scene, entity, farTarget, behaviorProfile);
  const activationRefresh = scene.events.find((event) => event.type === "refresh");
  const activationFx = scene.events.find((event) => event.type === "fx");
  assert(
    activationRefresh &&
      activationRefresh.options &&
      activationRefresh.options.broadcastOptions &&
      activationRefresh.options.broadcastOptions.minimumLeadFromCurrentHistory === 1 &&
      activationRefresh.options.broadcastOptions.maximumLeadFromCurrentHistory === 1 &&
      activationRefresh.options.broadcastOptions.historyLeadUsesPresentedSessionStamp === true &&
      activationRefresh.options.broadcastOptions.historyLeadPresentedMaximumFutureLead === 1,
    "synthetic propulsion activation did not clear the presented observer lane safely",
  );
  assert(
    activationFx &&
      activationFx.options &&
      activationFx.options.useCurrentStamp === true &&
      activationFx.options.minimumLeadFromCurrentHistory === 1 &&
      activationFx.options.maximumLeadFromCurrentHistory === 1 &&
      activationFx.options.historyLeadUsesPresentedSessionStamp === true &&
      activationFx.options.historyLeadPresentedMaximumFutureLead === 1 &&
      activationFx.options.start === true,
    "synthetic propulsion activation FX did not clear the presented observer lane safely",
  );

  scene.events.length = 0;
  npcBehaviorLoop.__testing.syncNpcPropulsion(scene, entity, nearTarget, behaviorProfile);
  const deactivationRefresh = scene.events.find((event) => event.type === "refresh");
  const deactivationFx = scene.events.find((event) => event.type === "fx");
  assert(
    deactivationRefresh &&
      deactivationRefresh.options &&
      deactivationRefresh.options.broadcastOptions &&
      deactivationRefresh.options.broadcastOptions.minimumLeadFromCurrentHistory === 1 &&
      deactivationRefresh.options.broadcastOptions.maximumLeadFromCurrentHistory === 1 &&
      deactivationRefresh.options.broadcastOptions.historyLeadUsesPresentedSessionStamp === true &&
      deactivationRefresh.options.broadcastOptions.historyLeadPresentedMaximumFutureLead === 1,
    "synthetic propulsion deactivation did not clear the presented observer lane safely",
  );
  assert(
    deactivationFx &&
      deactivationFx.options &&
      deactivationFx.options.useCurrentStamp === true &&
      deactivationFx.options.minimumLeadFromCurrentHistory === 1 &&
      deactivationFx.options.maximumLeadFromCurrentHistory === 1 &&
      deactivationFx.options.historyLeadUsesPresentedSessionStamp === true &&
      deactivationFx.options.historyLeadPresentedMaximumFutureLead === 1 &&
      deactivationFx.options.start === false,
    "synthetic propulsion deactivation FX did not clear the presented observer lane safely",
  );

  return {
    activationRefreshOptions: activationRefresh.options,
    activationFxOptions: activationFx.options,
    deactivationRefreshOptions: deactivationRefresh.options,
    deactivationFxOptions: deactivationFx.options,
  };
}

function verifyOutOfRangeMissilesDoNotThrashActivation() {
  const entity = buildNativeMissileNpc();
  const target = {
    itemID: 991002978,
    typeID: 11567,
    groupID: 30,
    categoryID: 6,
    kind: "ship",
    position: { x: 60_000, y: 0, z: 0 },
    radius: 3000,
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    speedFraction: 1,
  };
  const activationCalls = [];
  const scene = {
    getCurrentSimTimeMs() {
      return 1_775_097_588_000;
    },
    activateGenericModule(session, moduleItem, effectName, options) {
      activationCalls.push({
        session,
        moduleID: moduleItem && moduleItem.itemID,
        effectName,
        options,
      });
      return { success: true };
    },
    deactivateGenericModule() {
      return { success: true };
    },
    launchMissile() {
      return { success: false, errorMsg: "UNEXPECTED_ENTITY_MISSILE" };
    },
  };

  npcBehaviorLoop.__testing.syncNpcWeapons(scene, entity, target);
  assert(
    activationCalls.length === 0,
    `expected no out-of-range launcher activation attempts, saw ${activationCalls.length}`,
  );

  target.position = { x: 8_000, y: 0, z: 0 };
  npcBehaviorLoop.__testing.syncNpcWeapons(scene, entity, target);
  assert(
    activationCalls.length === 1,
    `expected launcher activation once target entered range, saw ${activationCalls.length}`,
  );

  return {
    activationCalls,
  };
}

function main() {
  const syntheticPropulsion = verifySyntheticPropulsionUsesHeldFutureStamp();
  const weaponRangeGate = verifyOutOfRangeMissilesDoNotThrashActivation();

  console.log(JSON.stringify({
    syntheticPropulsion,
    weaponRangeGate: {
      activationCallCount: weaponRangeGate.activationCalls.length,
      firstActivation: weaponRangeGate.activationCalls[0] || null,
    },
  }, null, 2));
}

main();
