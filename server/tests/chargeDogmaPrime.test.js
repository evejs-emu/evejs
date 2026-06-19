const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  buildInventoryItem,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  resolveItemByName,
} = require(path.join(repoRoot, "server/src/services/inventory/itemTypeRegistry"));
const {
  buildChargeTupleItemID,
  getAttributeIDByNames,
} = require(path.join(repoRoot, "server/src/services/fitting/liveFittingState"));
const {
  _testing: runtimeTesting,
} = require(path.join(repoRoot, "server/src/space/runtime"));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const {
  syncChargeSublocationForSession,
  syncChargeSublocationTransitionForSession,
  _testing: characterStateTesting,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));

const ATTRIBUTE_QUANTITY = getAttributeIDByNames("quantity") || 805;

function resolveExactItem(name) {
  const result = resolveItemByName(name);
  assert.equal(result && result.success, true, `Expected item '${name}' to exist`);
  return result.match;
}

function buildLoadedCharge(typeName, itemID, shipID, flagID, quantity = 1) {
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

function makeSession(space = false) {
  const notifications = [];
  return {
    characterID: 9000001,
    charid: 9000001,
    shipID: 990114054,
    shipid: 990114054,
    _space: space
      ? {
        }
      : undefined,
    socket: { destroyed: false },
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
}

function dictEntries(value) {
  return value && value.type === "dict" && Array.isArray(value.entries)
    ? value.entries
    : [];
}

function keyValEntries(value) {
  return (
    value &&
    value.name === "util.KeyVal" &&
    value.args &&
    value.args.type === "dict" &&
    Array.isArray(value.args.entries)
  )
    ? value.args.entries
    : [];
}

function readPrimeInvItem(primeEntry) {
  const invItemEntry = keyValEntries(primeEntry).find(
    (entry) => Array.isArray(entry) && entry[0] === "invItem",
  );
  if (invItemEntry && invItemEntry[1] && invItemEntry[1].type === "packedrow") {
    return invItemEntry[1].fields || null;
  }
  const row =
    invItemEntry &&
    invItemEntry[1] &&
    invItemEntry[1].name === "util.Row" &&
    invItemEntry[1].args
      ? invItemEntry[1]
      : null;
  if (!row) {
    return null;
  }
  const entries = dictEntries(row.args);
  const header = entries.find((entry) => entry[0] === "header")?.[1] || [];
  const line = entries.find((entry) => entry[0] === "line")?.[1] || [];
  return Object.fromEntries(header.map((key, index) => [String(key), line[index]]));
}

function readPrimeAttributes(primeEntry) {
  const attributeEntry = keyValEntries(primeEntry).find(
    (entry) => Array.isArray(entry) && entry[0] === "attributes",
  );
  return new Map(
    dictEntries(attributeEntry && attributeEntry[1]).map((entry) => [
      Number(Array.isArray(entry) ? entry[0] : 0) || 0,
      Number(Array.isArray(entry) ? entry[1] : 0) || 0,
    ]),
  );
}

function readOnItemChangeFields(entry) {
  const payload = Array.isArray(entry && entry.payload) ? entry.payload[0] : null;
  return payload && payload.type === "packedrow" ? payload.fields || {} : {};
}

function readOnItemChangeItemID(entry) {
  return readOnItemChangeFields(entry).itemID;
}

function readOnItemChangeKeys(entry) {
  const payload = Array.isArray(entry && entry.payload) ? entry.payload[1] : null;
  return payload && payload.type === "dict"
    ? payload.entries.map(([key]) => Number(key)).sort((left, right) => left - right)
    : [];
}

function notificationItemIDs(notifications, name = "OnItemChange") {
  return notifications
    .filter((entry) => entry && entry.name === name)
    .map(readOnItemChangeItemID);
}

function extractModuleAttributeChanges(notifications) {
  return notifications
    .filter((entry) => entry && entry.name === "OnModuleAttributeChanges")
    .flatMap((entry) => {
      const payload = Array.isArray(entry.payload) ? entry.payload[0] : null;
      return payload && payload.type === "list" && Array.isArray(payload.items)
        ? payload.items
        : [];
    });
}

function sameItemID(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

test("charge dogma prime uses TQ tuple shape with no concrete invItem row", () => {
  const charge = buildLoadedCharge(
    "Scourge Heavy Missile",
    990115000,
    990114054,
    27,
    12,
  );
  const primeEntry = characterStateTesting.buildChargeDogmaPrimeEntry(charge);
  const invItem = readPrimeInvItem(primeEntry);
  const attributes = readPrimeAttributes(primeEntry);

  assert.equal(invItem, null);
  assert.equal(Number(attributes.get(ATTRIBUTE_QUANTITY)), 12);
  assert.equal(attributes.size > 0, true);
});

test("non-space tuple charge rows still use the stable stacksize descriptor", () => {
  const chargeType = resolveExactItem("Mjolnir Heavy Missile");
  const session = makeSession(false);
  const tupleItemID = buildChargeTupleItemID(990114054, 27, chargeType.typeID);

  syncChargeSublocationForSession(
    session,
    {
      itemID: tupleItemID,
      typeID: chargeType.typeID,
      ownerID: 9000001,
      locationID: 990114054,
      flagID: 27,
      quantity: 10,
      stacksize: 10,
      singleton: 0,
      groupID: chargeType.groupID,
      categoryID: chargeType.categoryID,
      customInfo: "",
    },
    {
      locationID: 0,
      flagID: 0,
      stacksize: 0,
      singleton: 0,
    },
  );

  const itemChange = session.notifications.find(
    (entry) => entry && entry.name === "OnItemChange",
  );
  assert.ok(itemChange);
  assert.equal(sameItemID(readOnItemChangeItemID(itemChange), tupleItemID), true);
  assert.deepEqual(readOnItemChangeKeys(itemChange), [3, 4, 10]);
  assert.equal(Number(readOnItemChangeFields(itemChange).stacksize), 10);
});

test("live space charge sublocation transitions are inert", () => {
  const chargeType = resolveExactItem("Scourge Heavy Missile");
  const session = makeSession(true);

  syncChargeSublocationTransitionForSession(session, {
    shipID: 990114054,
    flagID: 27,
    ownerID: 9000001,
    previousState: { typeID: chargeType.typeID, quantity: 12 },
    nextState: { typeID: chargeType.typeID, quantity: 11 },
    primeNextCharge: true,
  });

  assert.deepEqual(session.notifications, []);
  assert.equal(
    Boolean(
      session._space._chargeSublocationSyncTimers &&
        session._space._chargeSublocationSyncTimers.size,
    ),
    false,
  );
});

test("runtime charge transitions update tuple charge quantity like TQ", () => {
  const shipID = 990114999;
  const flagID = 27;
  const previousCharge = buildLoadedCharge(
    "Baryon Exotic Plasma L",
    990115000,
    shipID,
    flagID,
    481,
  );
  const nextCharge = {
    ...previousCharge,
    quantity: 480,
    stacksize: 480,
  };
  const session = makeSession(true);
  session.shipID = shipID;
  session.shipid = shipID;

  const notified = runtimeTesting.notifyRuntimeChargeTransitionToSessionForTesting(
    session,
    shipID,
    flagID,
    {
      typeID: previousCharge.typeID,
      quantity: 481,
    },
    {
      typeID: nextCharge.typeID,
      quantity: 480,
    },
    session.characterID,
    {
      previousChargeItem: previousCharge,
      nextChargeItem: nextCharge,
    },
  );

  assert.equal(notified, true);
  assert.equal(
    session.notifications.some((entry) => entry && entry.name === "OnGodmaPrimeItem"),
    false,
  );
  assert.deepEqual(notificationItemIDs(session.notifications), []);
  const changes = extractModuleAttributeChanges(session.notifications);
  assert.equal(changes.length, 1);
  assert.equal(changes[0][3], ATTRIBUTE_QUANTITY);
  assert.equal(sameItemID(
    changes[0][2],
    buildChargeTupleItemID(shipID, flagID, previousCharge.typeID),
  ), true);
  assert.equal(changes[0][5], 480);
  assert.equal(changes[0][6], 481);
});

test("runtime charge transitions prime new tuple charges before quantity", () => {
  const shipID = 990115050;
  const flagID = 28;
  const nextCharge = buildLoadedCharge(
    "Scourge Light Missile",
    990115051,
    shipID,
    flagID,
    40,
  );
  const session = makeSession(true);
  session.shipID = shipID;
  session.shipid = shipID;

  const notified = runtimeTesting.notifyRuntimeChargeTransitionToSessionForTesting(
    session,
    shipID,
    flagID,
    {
      typeID: 0,
      quantity: 0,
    },
    {
      typeID: nextCharge.typeID,
      quantity: 40,
    },
    session.characterID,
    {
      nextChargeItem: nextCharge,
    },
  );

  assert.equal(notified, true);
  assert.deepEqual(
    session.notifications.map((entry) => entry.name),
    ["OnGodmaPrimeItem", "OnModuleAttributeChanges"],
  );
  const primeEntry = session.notifications[0].payload[1];
  assert.equal(readPrimeInvItem(primeEntry), null);
  assert.equal(Number(readPrimeAttributes(primeEntry).get(ATTRIBUTE_QUANTITY)), 0);
  const changes = extractModuleAttributeChanges(session.notifications);
  assert.equal(changes.length, 1);
  assert.equal(sameItemID(
    changes[0][2],
    buildChargeTupleItemID(shipID, flagID, nextCharge.typeID),
  ), true);
  assert.equal(changes[0][3], ATTRIBUTE_QUANTITY);
  assert.equal(changes[0][5], 40);
  assert.equal(changes[0][6], 0);
});

test("dogma load/reload quantity transition hook emits tuple removals and additions", () => {
  const previousCharge = buildLoadedCharge(
    "Baryon Exotic Plasma L",
    990115101,
    990115100,
    27,
    300,
  );
  const nextCharge = buildLoadedCharge(
    "Meson Exotic Plasma L",
    990115102,
    990115100,
    27,
    500,
  );
  const session = makeSession(true);
  session.shipID = 990115100;
  session.shipid = 990115100;
  const dogma = new DogmaService();

  dogma._notifyChargeQuantityTransition(
    session,
    session.characterID,
    session.shipID,
    27,
    {
      typeID: previousCharge.typeID,
      quantity: 300,
    },
    {
      typeID: nextCharge.typeID,
      quantity: 500,
    },
  );

  const changes = extractModuleAttributeChanges(session.notifications);
  assert.equal(changes.length, 2);
  const primeIndex = session.notifications.findIndex(
    (entry) => entry && entry.name === "OnGodmaPrimeItem",
  );
  assert.equal(primeIndex > 0, true);
  assert.equal(sameItemID(
    changes[0][2],
    buildChargeTupleItemID(session.shipID, 27, previousCharge.typeID),
  ), true);
  assert.equal(changes[0][3], ATTRIBUTE_QUANTITY);
  assert.equal(changes[0][5], 0);
  assert.equal(changes[0][6], 300);
  assert.equal(sameItemID(
    changes[1][2],
    buildChargeTupleItemID(session.shipID, 27, nextCharge.typeID),
  ), true);
  assert.equal(changes[1][3], ATTRIBUTE_QUANTITY);
  assert.equal(changes[1][5], 500);
  assert.equal(changes[1][6], 0);
});

test("dogma reload from an empty weapon primes the tuple before publishing quantity", () => {
  const nextCharge = buildLoadedCharge(
    "Antimatter Charge S",
    990115202,
    990115200,
    27,
    49,
  );
  const session = makeSession(true);
  session.shipID = 990115200;
  session.shipid = 990115200;
  const dogma = new DogmaService();

  dogma._notifyChargeQuantityTransition(
    session,
    session.characterID,
    session.shipID,
    27,
    {
      typeID: 0,
      quantity: 0,
    },
    {
      typeID: nextCharge.typeID,
      quantity: 49,
    },
    {
      nextChargeItem: nextCharge,
    },
  );

  assert.deepEqual(
    session.notifications.map((entry) => entry.name),
    ["OnGodmaPrimeItem", "OnModuleAttributeChanges"],
  );
  const primeEntry = session.notifications[0].payload[1];
  assert.equal(readPrimeInvItem(primeEntry), null);
  assert.equal(Number(readPrimeAttributes(primeEntry).get(ATTRIBUTE_QUANTITY)), 0);
  const changes = extractModuleAttributeChanges(session.notifications);
  assert.equal(changes.length, 1);
  assert.equal(sameItemID(
    changes[0][2],
    buildChargeTupleItemID(session.shipID, 27, nextCharge.typeID),
  ), true);
  assert.equal(changes[0][3], ATTRIBUTE_QUANTITY);
  assert.equal(changes[0][5], 49);
  assert.equal(changes[0][6], 0);
});

test("dogma live-space cargo ammo deltas use TQ OnItemsChanged context", () => {
  const chargeType = resolveExactItem("Scourge Heavy Missile");
  const session = makeSession(true);
  session._space.shipID = session.shipID;
  const dogma = new DogmaService();
  const item = {
    itemID: 990116000,
    typeID: chargeType.typeID,
    ownerID: session.characterID,
    locationID: session.shipID,
    flagID: 5,
    quantity: 39,
    stacksize: 39,
    singleton: 0,
    groupID: chargeType.groupID,
    categoryID: chargeType.categoryID,
    customInfo: "",
  };

  dogma._syncInventoryChanges(session, [{
    item,
    previousData: {
      locationID: session.shipID,
      flagID: 5,
      quantity: 40,
      stacksize: 40,
      singleton: 0,
    },
  }]);

  assert.equal(session.notifications.length, 1);
  assert.equal(session.notifications[0].name, "OnItemsChanged");
  assert.equal(session.notifications[0].idType, "charid");
  assert.deepEqual(session.notifications[0].payload[2], [
    "Ship",
    session.shipID,
    "ShipCargo",
  ]);
});
