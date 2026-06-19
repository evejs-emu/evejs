const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const {
  buildInventoryItem,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  resolveItemByName,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));
const {
  getTypeAttributeValue,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const {
  marshalEncode,
  Op,
} = require(path.join(repoRoot, "server/src/network/tcp/utils/marshal"));

const MODULE_ATTRIBUTE_DURATION = 73;
const MODULE_ATTRIBUTE_SPEED = 51;
const ATTRIBUTE_RECHARGE_RATE = 55;
const MWD_EFFECT_ID = 6730;

function expectMarshalReal(value, expected) {
  assert.deepEqual(value, {
    type: "real",
    value: expected,
  });
}

test("dogma duration attribute values stay marshaled as reals", () => {
  expectMarshalReal(
    DogmaService._testing.marshalDogmaAttributeValue(
      MODULE_ATTRIBUTE_DURATION,
      10000,
    ),
    10000,
  );
  assert.equal(
    DogmaService._testing.marshalDogmaAttributeValue(
      MODULE_ATTRIBUTE_DURATION,
      -1,
    ),
    -1,
  );
  expectMarshalReal(
    DogmaService._testing.marshalDogmaAttributeValue(
      MODULE_ATTRIBUTE_SPEED,
      5184,
    ),
    5184,
  );
  expectMarshalReal(
    DogmaService._testing.marshalDogmaAttributeValue(
      ATTRIBUTE_RECHARGE_RATE,
      900000,
    ),
    900000,
  );
});

test("inventory item attributes preserve duration as a marshal real", () => {
  const service = new DogmaService();
  const attributes = service._buildInventoryItemAttributes({
    typeID: 14114,
    quantity: 1,
    stacksize: 1,
  });

  expectMarshalReal(attributes[MODULE_ATTRIBUTE_DURATION], 10000);
});

test("ship recharge rate attributes stay marshaled as reals for fitting consumers", () => {
  const service = new DogmaService();
  const shipType = resolveItemByName("Capsule");
  assert.equal(shipType && shipType.success, true);

  const ship = buildInventoryItem({
    itemID: 990001234,
    typeID: shipType.match.typeID,
    ownerID: 9000001,
    locationID: 9000001,
    flagID: 4,
    singleton: 1,
    quantity: 1,
    stacksize: 1,
  });
  const attributes = service._buildInventoryItemAttributes(ship);
  const expectedRechargeRate = Number(
    getTypeAttributeValue(ship.typeID, "rechargeRate"),
  );

  expectMarshalReal(attributes[ATTRIBUTE_RECHARGE_RATE], expectedRechargeRate);
});

test("active effect entries preserve positive duration as a marshal real", () => {
  const service = new DogmaService();
  const entry = service._buildActiveEffectEntry(
    {
      itemID: 140002489,
      ownerID: 140000004,
      locationID: 140000333,
    },
    MWD_EFFECT_ID,
    {
      startedAt: Date.now(),
      duration: 10000,
      repeat: 1000,
    },
  );

  expectMarshalReal(entry[1][8], 10000);
});

test("module attribute change notifications coerce duration values to marshal reals", () => {
  const service = new DogmaService();
  const notifications = [];
  const session = {
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  service._notifyModuleAttributeChanges(session, [[
    "OnModuleAttributeChanges",
    65450,
    140002489,
    MODULE_ATTRIBUTE_DURATION,
    1n,
    10000,
    5000,
    null,
  ]]);

  assert.equal(notifications.length, 1);
  const change = notifications[0].payload[0].items[0];
  expectMarshalReal(change[5], 10000);
  expectMarshalReal(change[6], 5000);

  notifications.length = 0;
  service._notifyModuleAttributeChanges(session, [[
    "OnModuleAttributeChanges",
    65450,
    140002489,
    MODULE_ATTRIBUTE_SPEED,
    1n,
    5184,
    4374,
    null,
  ]]);

  const speedChange = notifications[0].payload[0].items[0];
  expectMarshalReal(speedChange[5], 5184);
  expectMarshalReal(speedChange[6], 4374);
});

test("runtime attribute changes preserve duration as marshal reals", () => {
  const change = spaceRuntime._testing.buildAttributeChangeForTesting(
    { characterID: 65450 },
    140002489,
    MODULE_ATTRIBUTE_DURATION,
    10000,
    5000,
    1n,
  );

  expectMarshalReal(change[5], 10000);
  expectMarshalReal(change[6], 5000);

  const speedChange = spaceRuntime._testing.buildAttributeChangeForTesting(
    { characterID: 65450 },
    140002489,
    MODULE_ATTRIBUTE_SPEED,
    5184,
    4374,
    1n,
  );

  expectMarshalReal(speedChange[5], 5184);
  expectMarshalReal(speedChange[6], 4374);
});

test("runtime OnGodmaShipEffect notifications preserve duration as marshal reals", () => {
  const notifications = [];
  const session = {
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
  const entity = {
    ownerID: 140000004,
    itemID: 140000333,
  };

  const propulsionEffectState = {
    effectName: "moduleBonusMicrowarpdrive",
    moduleID: 140002489,
    startedAtMs: Date.now(),
    durationMs: 10000,
    repeat: 1000,
  };
  assert.equal(
    spaceRuntime._testing.notifyModuleEffectStateForTesting(
      session,
      entity,
      propulsionEffectState,
      true,
    ),
    true,
  );
  expectMarshalReal(notifications[0].payload[7], 10000);

  notifications.length = 0;
  const genericEffectState = {
    effectID: MWD_EFFECT_ID,
    moduleID: 140002489,
    startedAtMs: Date.now(),
    durationMs: 10000,
    repeat: 1000,
  };
  assert.equal(
    spaceRuntime._testing.notifyGenericModuleEffectStateForTesting(
      session,
      entity,
      genericEffectState,
      true,
    ),
    true,
  );
  expectMarshalReal(notifications[0].payload[7], 10000);
});

test("runtime attribute changes prefer the live session clock over a stale cached simFileTime", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const staleSimFileTime = 123456789n;
  const session = {
    clientID: 65450,
    characterID: 140000004,
    socket: {
      destroyed: false,
    },
    _space: {
      systemID: scene.systemID,
      shipID: 140000333,
      timeDilation: scene.getTimeDilation(),
      simTimeMs: scene.getCurrentSimTimeMs(),
      simFileTime: staleSimFileTime,
      beyonceBound: true,
      initialStateSent: true,
    },
    sendNotification() {},
  };
  scene.sessions.set(session.clientID, session);

  const expectedFileTime = scene.getCurrentSessionFileTime(session);
  const change = spaceRuntime._testing.buildAttributeChangeForTesting(
    session,
    140002489,
    MODULE_ATTRIBUTE_DURATION,
    10000,
    5000,
  );

  assert.equal(
    BigInt(change[4]) >= expectedFileTime - 10000n &&
      BigInt(change[4]) <= expectedFileTime + 10000n,
    true,
    "attribute notifications should stamp against the live session clock so HUD timers stay aligned within 1 ms of the live session clock",
  );
  assert.notEqual(
    change[4],
    staleSimFileTime,
    "attribute notifications should not reuse a stale cached simFileTime snapshot",
  );
});

test("marshal encoder writes duration reals with the real opcode", () => {
  const encoded = marshalEncode({
    type: "real",
    value: 10000,
  });

  assert.equal(encoded[5], Op.PyReal);
});
