const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const {
  applyCharacterToSession,
  getActiveShipRecord,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  ITEM_FLAGS,
  listContainerItems,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));

function getDockedCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters");

  const candidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const characterRecord = getCharacterRecord(characterID);
      const ship = getActiveShipRecord(characterID);
      const stationID = Number(
        characterRecord && (characterRecord.stationID || characterRecord.stationid || 0),
      ) || 0;
      if (!characterRecord || !ship || stationID <= 0) {
        return null;
      }

      const hangarItems = listContainerItems(
        characterID,
        stationID,
        ITEM_FLAGS.HANGAR,
      );
      if (hangarItems.length === 0) {
        return null;
      }

      return {
        characterID,
        characterRecord,
        ship,
        stationID,
        hangarItems,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.hangarItems.length - left.hangarItems.length);

  assert.ok(
    candidates.length > 0,
    "Expected at least one docked character with station hangar contents",
  );
  return candidates[0];
}

function buildSession(candidate) {
  return {
    clientID: candidate.characterID + 81000,
    userid: candidate.characterID,
    socket: { destroyed: false },
    currentBoundObjectID: null,
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function bindStationHangar(service, session) {
  const bound = service.Handle_GetInventory([10004], session);
  const boundID =
    bound &&
    bound.type === "substruct" &&
    bound.value &&
    bound.value.type === "substream" &&
    Array.isArray(bound.value.value)
      ? bound.value.value[0]
      : null;
  assert.ok(boundID, "Expected GetInventory to return a bound station hangar");
  session.currentBoundObjectID = boundID;
}

function getInventoryEntries(value) {
  if (!(value && value.type === "list" && Array.isArray(value.items))) {
    return [];
  }

  return value.items
    .map((item) => (item && item.type === "packedrow" && item.fields ? item.fields : item))
    .filter(Boolean);
}

test("station hangar List(flag=4) returns the docked character's hangar contents without dropping item rows", () => {
  const candidate = getDockedCandidate();
  const session = buildSession(candidate);
  const service = new InvBrokerService();

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  assert.equal(Number(session.stationid || 0), candidate.stationID);

  bindStationHangar(service, session);

  const result = service.Handle_List([ITEM_FLAGS.HANGAR], session, {});
  const rows = getInventoryEntries(result);

  assert.equal(
    rows.length,
    candidate.hangarItems.length,
    "Expected List(flag=4) to return every docked station hangar item",
  );

  const expectedItemIDs = new Set(
    candidate.hangarItems.map((item) => Number(item.itemID) || 0),
  );
  const actualItemIDs = new Set(rows.map((row) => Number(row.itemID) || 0));

  assert.deepEqual(
    [...actualItemIDs].sort((left, right) => left - right),
    [...expectedItemIDs].sort((left, right) => left - right),
    "Expected station hangar List(flag=4) to preserve hangar item IDs",
  );
  assert.equal(
    actualItemIDs.has(Number(candidate.ship.itemID)),
    true,
    "Expected the active docked ship to remain present in the station hangar list",
  );
});
