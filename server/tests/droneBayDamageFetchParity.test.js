const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const {
  ITEM_FLAGS,
  grantItemToCharacterLocation,
  removeInventoryItem,
  resetInventoryStoreForTests,
  updateInventoryItem,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  resolveItemByName,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));
const {
  buildPythonSet,
  unwrapMarshalValue,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/serviceHelpers",
));
const {
  marshalEncode,
  marshalDecode,
} = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));

const transientItemIDs = [];

function getActiveShipCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters");

  const candidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const characterRecord = getCharacterRecord(characterID);
      const ship = getActiveShipRecord(characterID);
      if (!characterRecord || !ship || Number(ship.itemID) <= 0) {
        return null;
      }
      return {
        characterID,
        characterRecord,
        ship,
      };
    })
    .filter(Boolean);

  assert.ok(candidates.length > 0, "Expected at least one character with an active ship");
  return candidates[0];
}

function buildSession(candidate) {
  return {
    userid: candidate.characterID,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    shipid: Number(candidate.ship && candidate.ship.itemID) || 0,
  };
}

function getDictEntry(value, key) {
  const entries =
    value && value.type === "dict" && Array.isArray(value.entries) ? value.entries : [];
  return entries.find(([entryKey]) => Number(entryKey) === Number(key));
}

function getNotificationItemID(notification) {
  const payload = notification && notification.payload;
  const row = Array.isArray(payload) ? payload[0] : null;
  return Number(
    row &&
      row.fields &&
      row.fields.itemID,
  ) || 0;
}

test.afterEach(() => {
  for (const itemID of transientItemIDs.splice(0)) {
    if (itemID > 0) {
      removeInventoryItem(itemID, { removeContents: true });
    }
  }
  resetInventoryStoreForTests();
});

test("GetLayerDamageValuesByItems returns keyed drone-bay damage payloads for python-set requests", () => {
  resetInventoryStoreForTests();
  const candidate = getActiveShipCandidate();
  const session = buildSession(candidate);
  const dogmaService = new DogmaService();
  const droneType = resolveItemByName("Hobgoblin I");
  assert.equal(droneType && droneType.success, true, "Expected Hobgoblin I metadata");

  const grantResult = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.DRONE_BAY,
    droneType.match,
    1,
    { transient: true, singleton: true },
  );
  assert.equal(grantResult.success, true, "Expected transient drone-bay grant");
  const droneItem = grantResult.data && grantResult.data.items && grantResult.data.items[0];
  assert.ok(droneItem && droneItem.itemID, "Expected a transient drone item");
  transientItemIDs.push(Number(droneItem.itemID) || 0);

  const updateResult = updateInventoryItem(droneItem.itemID, (currentItem) => ({
    ...currentItem,
    conditionState: {
      damage: 0.4,
      armorDamage: 0.25,
      shieldCharge: 0.5,
    },
  }));
  assert.equal(updateResult.success, true, "Expected drone condition-state update");

  const result = dogmaService.Handle_GetLayerDamageValuesByItems([
    buildPythonSet([droneItem.itemID]),
  ], session);

  assert.ok(result && result.type === "dict", "Expected keyed damage payload dict");
  const entry = getDictEntry(result, droneItem.itemID);
  assert.ok(entry, "Expected response to contain the requested drone item");

  const unwrapped = unwrapMarshalValue(entry[1]);
  assert.ok(unwrapped && typeof unwrapped === "object", "Expected marshal damage payload to unwrap to an object");
  assert.ok(Array.isArray(unwrapped.shieldInfo), "Expected shieldInfo tuple payload");
  assert.equal(unwrapped.shieldInfo[0], unwrapped.shieldInfo[1] * 0.5);
  assert.ok(Number(unwrapped.shieldInfo[1]) > 0, "Expected positive max shield value");
  assert.ok(Number(unwrapped.shieldInfo[2]) >= 0, "Expected non-negative shield recharge rate");
  assert.equal(unwrapped.armorInfo, unwrapped.armorMax);
  assert.equal(unwrapped.hullInfo, unwrapped.hullMax);
  assert.equal(unwrapped.armorDamage, unwrapped.armorMax * 0.25);
  assert.equal(unwrapped.hullDamage, unwrapped.hullMax * 0.4);
  assert.equal(unwrapped.armorRatio, 0.75);
  assert.equal(unwrapped.hullRatio, 0.6);
});

test("GetLayerDamageValuesByItems keeps drone bay damage fields marshal-safe on the wire", () => {
  resetInventoryStoreForTests();
  const candidate = getActiveShipCandidate();
  const session = buildSession(candidate);
  const dogmaService = new DogmaService();
  const droneType = resolveItemByName("Hobgoblin I");
  assert.equal(droneType && droneType.success, true, "Expected Hobgoblin I metadata");

  const grantResult = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.DRONE_BAY,
    droneType.match,
    1,
    { transient: true, singleton: true },
  );
  assert.equal(grantResult.success, true, "Expected transient drone-bay grant");
  const droneItem = grantResult.data && grantResult.data.items && grantResult.data.items[0];
  assert.ok(droneItem && droneItem.itemID, "Expected a transient drone item");
  transientItemIDs.push(Number(droneItem.itemID) || 0);

  const updateResult = updateInventoryItem(droneItem.itemID, (currentItem) => ({
    ...currentItem,
    conditionState: {
      damage: 0.1,
      armorDamage: 0.2,
      shieldCharge: 0.75,
    },
  }));
  assert.equal(updateResult.success, true, "Expected drone condition-state update");

  const result = dogmaService.Handle_GetLayerDamageValuesByItems([
    buildPythonSet([droneItem.itemID]),
  ], session);

  const encoded = marshalEncode(result);
  const decoded = marshalDecode(encoded);
  const decodedEntry = getDictEntry(decoded, droneItem.itemID);
  assert.ok(decodedEntry, "Expected marshaled response to preserve the requested drone entry");

  const unwrapped = unwrapMarshalValue(decodedEntry[1]);
  assert.ok(unwrapped && typeof unwrapped === "object", "Expected marshaled drone damage to unwrap to an object");
  assert.ok(Array.isArray(unwrapped.shieldInfo), "Expected shieldInfo to remain list-shaped");
  assert.equal(unwrapped.shieldInfo[0], unwrapped.shieldInfo[1] * 0.75);
  assert.equal(unwrapped.armorInfo, unwrapped.armorMax);
  assert.equal(unwrapped.hullInfo, unwrapped.hullMax);
  assert.equal(unwrapped.armorDamage, unwrapped.armorMax * 0.2);
  assert.equal(unwrapped.hullDamage, unwrapped.hullMax * 0.1);
});

test("ListDroneBay primes in-space drone bay rows into client dogma once per bay state", () => {
  resetInventoryStoreForTests();
  const candidate = getActiveShipCandidate();
  const session = {
    ...buildSession(candidate),
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    _space: {
      shipID: candidate.ship.itemID,
    },
  };
  const notifications = [];
  const invBrokerService = new InvBrokerService();
  const lightDroneType = resolveItemByName("Hobgoblin I");
  const heavyDroneType = resolveItemByName("Praetor II");
  assert.equal(lightDroneType && lightDroneType.success, true, "Expected Hobgoblin I metadata");
  assert.equal(heavyDroneType && heavyDroneType.success, true, "Expected Praetor II metadata");

  const firstGrant = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.DRONE_BAY,
    lightDroneType.match,
    5,
    { transient: true },
  );
  const secondGrant = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.DRONE_BAY,
    heavyDroneType.match,
    2,
    { transient: true },
  );
  assert.equal(firstGrant.success, true, "Expected first drone stack grant");
  assert.equal(secondGrant.success, true, "Expected second drone stack grant");

  const firstDroneItem = firstGrant.data && firstGrant.data.items && firstGrant.data.items[0];
  const secondDroneItem = secondGrant.data && secondGrant.data.items && secondGrant.data.items[0];
  transientItemIDs.push(Number(firstDroneItem && firstDroneItem.itemID) || 0);
  transientItemIDs.push(Number(secondDroneItem && secondDroneItem.itemID) || 0);

  const firstResult = invBrokerService.Handle_ListDroneBay([], session);
  assert.ok(firstResult && firstResult.type === "list", "Expected ListDroneBay remote list");

  const primedIDs = notifications
    .filter((notification) => notification.name === "OnItemChange")
    .map(getNotificationItemID)
    .filter((itemID) => itemID > 0);

  assert.ok(
    primedIDs.includes(Number(firstDroneItem.itemID) || 0),
    "Expected ListDroneBay to prime the first drone stack into client dogma",
  );
  assert.ok(
    primedIDs.includes(Number(secondDroneItem.itemID) || 0),
    "Expected ListDroneBay to prime the second drone stack into client dogma",
  );

  const notificationsAfterFirstList = notifications.length;
  invBrokerService.Handle_ListDroneBay([], session);
  assert.equal(
    notifications.length,
    notificationsAfterFirstList,
    "Expected stable drone bay contents to avoid redundant dogma-prime replays",
  );
});
