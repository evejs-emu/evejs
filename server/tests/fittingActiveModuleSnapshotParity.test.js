const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..");

const {
  buildFittingSnapshot,
} = require(path.join(
  repoRoot,
  "server/src/_secondary/fitting/fittingSnapshotBuilder",
));
const {
  getShipFittingSnapshot,
  resetFittingRuntimeForTests,
} = require(path.join(
  repoRoot,
  "server/src/_secondary/fitting/fittingRuntime",
));
const {
  buildShipResourceState,
  getAttributeIDByNames,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  buildInventoryItem,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));

const ATTRIBUTE_MAX_TARGET_RANGE = getAttributeIDByNames("maxTargetRange") || 76;
const ATTRIBUTE_SCAN_RESOLUTION = getAttributeIDByNames("scanResolution") || 564;
const ATTRIBUTE_MASS = getAttributeIDByNames("mass") || 4;
const ATTRIBUTE_CAPACITOR_CAPACITY =
  getAttributeIDByNames("capacitorCapacity") || 482;
const ATTRIBUTE_MAX_VELOCITY = getAttributeIDByNames("maxVelocity") || 37;

function resolveExactItem(name) {
  const result = resolveItemByName(name);
  if (result && result.success === true && result.match) {
    return result.match;
  }
  if (
    result &&
    result.errorMsg === "AMBIGUOUS_ITEM_NAME" &&
    Array.isArray(result.suggestions)
  ) {
    const publishedExactMatch = result.suggestions.find((entry) => (
      typeof entry === "string" &&
      !entry.includes("unpublished") &&
      entry.startsWith(`${name} (`)
    ));
    if (publishedExactMatch) {
      const typeIDMatch = publishedExactMatch.match(/\((\d+)\)$/);
      const typeID = Number(typeIDMatch && typeIDMatch[1]);
      const resolvedByTypeID = resolveItemByTypeID(typeID);
      if (resolvedByTypeID && resolvedByTypeID.typeID) {
        return resolvedByTypeID;
      }
    }
  }
  assert.equal(result && result.success, true, `Expected item '${name}' to exist`);
  return result.match;
}

function buildShipItem(typeName, itemID = 981000001) {
  const type = resolveExactItem(typeName);
  return buildInventoryItem({
    itemID,
    typeID: type.typeID,
    ownerID: 9000001,
    locationID: 60003760,
    singleton: 1,
  });
}

function buildFittedModule(typeName, itemID, shipID, flagID, options = {}) {
  const type = resolveExactItem(typeName);
  return buildInventoryItem({
    itemID,
    typeID: type.typeID,
    ownerID: 9000001,
    locationID: shipID,
    flagID,
    singleton: 1,
    moduleState: {
      online: options.online !== false,
    },
  });
}

function buildLoadedCharge(typeName, itemID, shipID, flagID, quantity = 100) {
  const type = resolveExactItem(typeName);
  return buildInventoryItem({
    itemID,
    typeID: type.typeID,
    ownerID: 9000001,
    locationID: shipID,
    flagID,
    singleton: 0,
    quantity,
    stacksize: quantity,
  });
}

test.afterEach(() => {
  resetFittingRuntimeForTests();
});

test("docked fitting snapshots include active self-buff module ship stats", () => {
  const shipItem = buildShipItem("Rokh", 981100001);
  const sensorBooster = buildFittedModule(
    "Sensor Booster II",
    981100002,
    shipItem.itemID,
    19,
  );
  const fittedItems = [sensorBooster];

  const passiveState = buildShipResourceState(0, shipItem, {
    fittedItems,
    assumeActiveShipModules: false,
  });
  const fittingSnapshot = buildFittingSnapshot(0, shipItem.itemID, {
    shipItem,
    fittedItems,
  });

  assert.ok(fittingSnapshot, "Expected fitting snapshot");
  assert.ok(
    (Number(fittingSnapshot.shipAttributes[ATTRIBUTE_MAX_TARGET_RANGE]) || 0) >
      (Number(passiveState.attributes[ATTRIBUTE_MAX_TARGET_RANGE]) || 0),
    "Expected active sensor booster to increase docked fitting maxTargetRange",
  );
  assert.ok(
    (Number(fittingSnapshot.shipAttributes[ATTRIBUTE_SCAN_RESOLUTION]) || 0) >
      (Number(passiveState.attributes[ATTRIBUTE_SCAN_RESOLUTION]) || 0),
    "Expected active sensor booster to increase docked fitting scanResolution",
  );
});

test("docked fitting snapshots include active industrial core ship modifiers", () => {
  const shipItem = buildShipItem("Orca", 981200001);
  const industrialCore = buildFittedModule(
    "Large Industrial Core II",
    981200002,
    shipItem.itemID,
    27,
  );
  const fittedItems = [industrialCore];

  const passiveState = buildShipResourceState(0, shipItem, {
    fittedItems,
    assumeActiveShipModules: false,
  });
  const fittingSnapshot = buildFittingSnapshot(0, shipItem.itemID, {
    shipItem,
    fittedItems,
  });

  assert.ok(fittingSnapshot, "Expected industrial core fitting snapshot");
  assert.ok(
    (Number(fittingSnapshot.shipAttributes[ATTRIBUTE_MASS]) || 0) >
      (Number(passiveState.attributes[ATTRIBUTE_MASS]) || 0),
    "Expected active industrial core to increase docked fitting ship mass",
  );
  assert.equal(
    Array.isArray(fittingSnapshot.assumedActiveModuleContexts),
    true,
    "Expected fitting snapshot to record assumed-active module contexts",
  );
  assert.ok(
    fittingSnapshot.assumedActiveModuleContexts.length > 0,
    "Expected industrial core to participate in the assumed-active fitting context",
  );
});

test("passive online module effects still land in the shared snapshot before active propulsion math", () => {
  const shipItem = buildShipItem("Drake", 981250001);
  const microwarpdrive = buildFittedModule(
    "50MN Microwarpdrive II",
    981250002,
    shipItem.itemID,
    19,
  );
  const fittedItems = [microwarpdrive];

  const baseState = buildShipResourceState(0, shipItem, {
    fittedItems: [],
    assumeActiveShipModules: false,
  });
  const passiveState = buildShipResourceState(0, shipItem, {
    fittedItems,
    assumeActiveShipModules: false,
  });
  const fittingSnapshot = buildFittingSnapshot(0, shipItem.itemID, {
    shipItem,
    fittedItems,
  });

  assert.ok(fittingSnapshot, "Expected microwarpdrive fitting snapshot");
  assert.ok(
    (Number(passiveState.attributes[ATTRIBUTE_CAPACITOR_CAPACITY]) || 0) <
      (Number(baseState.attributes[ATTRIBUTE_CAPACITOR_CAPACITY]) || 0),
    "Expected the online MWD capacitor penalty to apply even before assumed-active propulsion math",
  );
  assert.equal(
    Number(fittingSnapshot.shipAttributes[ATTRIBUTE_CAPACITOR_CAPACITY]) || 0,
    Number(passiveState.attributes[ATTRIBUTE_CAPACITOR_CAPACITY]) || 0,
    "Expected active fitting snapshots to preserve the same passive MWD capacitor penalty",
  );
  assert.ok(
    (Number(fittingSnapshot.shipAttributes[ATTRIBUTE_MAX_VELOCITY]) || 0) >
      (Number(passiveState.attributes[ATTRIBUTE_MAX_VELOCITY]) || 0),
    "Expected the active propulsion effect to stay separate from the passive capacitor penalty",
  );
});

test("docked fitting snapshots include active command burst self-buffs", () => {
  const shipItem = buildShipItem("Claymore", 981300001);
  const burstModule = buildFittedModule(
    "Information Command Burst II",
    981300002,
    shipItem.itemID,
    27,
  );
  const burstCharge = buildLoadedCharge(
    "Sensor Optimization Charge",
    981300003,
    shipItem.itemID,
    burstModule.flagID,
    100,
  );
  const fittedItems = [burstModule, burstCharge];

  const passiveState = buildShipResourceState(0, shipItem, {
    fittedItems,
    assumeActiveShipModules: false,
  });
  const fittingSnapshot = buildFittingSnapshot(0, shipItem.itemID, {
    shipItem,
    fittedItems,
  });

  assert.ok(fittingSnapshot, "Expected command burst fitting snapshot");
  assert.ok(
    (Number(fittingSnapshot.shipAttributes[ATTRIBUTE_MAX_TARGET_RANGE]) || 0) >
      (Number(passiveState.attributes[ATTRIBUTE_MAX_TARGET_RANGE]) || 0) ||
      (Number(fittingSnapshot.shipAttributes[ATTRIBUTE_SCAN_RESOLUTION]) || 0) >
      (Number(passiveState.attributes[ATTRIBUTE_SCAN_RESOLUTION]) || 0),
    "Expected active information burst to improve docked fitting targeting stats",
  );
});

test("fitting snapshot cache keeps passive and active variants separate", () => {
  const shipItem = buildShipItem("Claymore", 981400001);
  const burstModule = buildFittedModule(
    "Information Command Burst II",
    981400002,
    shipItem.itemID,
    27,
  );
  const burstCharge = buildLoadedCharge(
    "Sensor Optimization Charge",
    981400003,
    shipItem.itemID,
    burstModule.flagID,
    100,
  );
  const fittedItems = [burstModule, burstCharge];

  const passiveSnapshot = getShipFittingSnapshot(0, shipItem.itemID, {
    shipItem,
    fittedItems,
    assumeActiveShipModules: false,
    reason: "passive-first",
  });
  const activeSnapshot = getShipFittingSnapshot(0, shipItem.itemID, {
    shipItem,
    fittedItems,
    reason: "active-second",
  });

  assert.notEqual(
    passiveSnapshot,
    activeSnapshot,
    "Expected passive and active fitting snapshots to use separate cache records",
  );
  assert.ok(
    (Number(activeSnapshot.shipAttributes[ATTRIBUTE_MAX_TARGET_RANGE]) || 0) >
      (Number(passiveSnapshot.shipAttributes[ATTRIBUTE_MAX_TARGET_RANGE]) || 0),
    "Expected active cached fitting snapshot to preserve burst-improved maxTargetRange",
  );
  assert.ok(
    (Number(activeSnapshot.shipAttributes[ATTRIBUTE_SCAN_RESOLUTION]) || 0) >
      (Number(passiveSnapshot.shipAttributes[ATTRIBUTE_SCAN_RESOLUTION]) || 0),
    "Expected active cached fitting snapshot to preserve burst-improved scanResolution",
  );
});
