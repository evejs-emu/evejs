const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  registerController,
  getControllerByEntityID,
  unregisterController,
  listControllersBySystem,
  listControllers,
  clearControllers,
} = require(path.join(
  repoRoot,
  "server/src/space/npc/npcRegistry",
));

test.afterEach(() => {
  clearControllers();
});

test("npc registry indexes controllers by system and keeps deterministic ordering", () => {
  registerController({ entityID: 22, systemID: 30000142, runtimeKind: "nativeCombat" });
  registerController({ entityID: 10, systemID: 30000142, runtimeKind: "nativeAmbient" });
  registerController({ entityID: 99, systemID: 30002187, runtimeKind: "nativeCombat" });

  assert.deepEqual(
    listControllersBySystem(30000142).map((controller) => controller.entityID),
    [10, 22],
  );
  assert.deepEqual(
    listControllersBySystem(30002187).map((controller) => controller.entityID),
    [99],
  );
  assert.deepEqual(
    listControllers().map((controller) => [controller.systemID, controller.entityID]),
    [
      [30000142, 10],
      [30000142, 22],
      [30002187, 99],
    ],
  );
});

test("re-registering the same entity moves it between system indexes", () => {
  registerController({ entityID: 55, systemID: 30000142, runtimeKind: "nativeCombat" });
  registerController({ entityID: 55, systemID: 30002187, runtimeKind: "nativeCombat" });

  assert.deepEqual(
    listControllersBySystem(30000142).map((controller) => controller.entityID),
    [],
  );
  assert.deepEqual(
    listControllersBySystem(30002187).map((controller) => controller.entityID),
    [55],
  );
  assert.equal(getControllerByEntityID(55).systemID, 30002187);
});

test("unregistering removes controllers from both the entity and system indexes", () => {
  registerController({ entityID: 71, systemID: 30000142, runtimeKind: "nativeCombat" });
  registerController({ entityID: 72, systemID: 30000142, runtimeKind: "nativeAmbient" });

  const removed = unregisterController(71);
  assert.equal(removed.entityID, 71);
  assert.equal(getControllerByEntityID(71), null);
  assert.deepEqual(
    listControllersBySystem(30000142).map((controller) => controller.entityID),
    [72],
  );
});

test("controller lookups self-heal the system index if controller.systemID is mutated externally", () => {
  const controller = registerController({
    entityID: 88,
    systemID: 30000142,
    runtimeKind: "nativeCombat",
  });

  controller.systemID = 30002187;

  assert.equal(getControllerByEntityID(88).systemID, 30002187);
  assert.deepEqual(
    listControllersBySystem(30000142).map((entry) => entry.entityID),
    [],
  );
  assert.deepEqual(
    listControllersBySystem(30002187).map((entry) => entry.entityID),
    [88],
  );
});
