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
  getCharacterRecord,
  getActiveShipRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  getLoadedChargeItems,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  seedCombatShipFixture,
} = require(path.join(repoRoot, "server/tests/helpers/testCharacterFixtures"));

const INV_BROKER_FIXTURE_CHARACTER_ID = 998840001;

function findInSpaceLoadedChargeCandidate() {
  seedCombatShipFixture({
    characterID: INV_BROKER_FIXTURE_CHARACTER_ID,
    shipID: INV_BROKER_FIXTURE_CHARACTER_ID * 10000 + 1,
    inSpace: true,
  });
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "expected to read characters table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    const ship = getActiveShipRecord(characterID);
    if (
      !characterRecord ||
      !ship ||
      !ship.spaceState ||
      Number(characterRecord.stationID || characterRecord.stationid || 0) > 0
    ) {
      continue;
    }

    const loadedCharges = getLoadedChargeItems(characterID, ship.itemID);
    if (loadedCharges.length > 0) {
      return {
        characterID,
        ship,
        loadedCharges,
      };
    }
  }

  assert.fail("expected an in-space active ship with loaded charges");
}

function buildSession(candidate) {
  const notifications = [];
  const systemID = Number(
    candidate.ship.spaceState && candidate.ship.spaceState.systemID,
  ) || 0;
  return {
    clientID: candidate.characterID + 9300,
    userid: candidate.characterID,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    stationid: null,
    stationID: null,
    stationid2: null,
    locationid: systemID,
    solarsystemid: systemID,
    solarsystemid2: systemID,
    shipID: candidate.ship.itemID,
    shipid: candidate.ship.itemID,
    activeShipID: candidate.ship.itemID,
    socket: { destroyed: false },
    _notifications: notifications,
    _space: {
      shipID: candidate.ship.itemID,
      systemID,
      beyonceBound: true,
      initialStateSent: true,
      loginShipInventoryPrimed: true,
    },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
}

function bindShipInventory(service, session, shipID) {
  const bound = service.Handle_GetInventoryFromId([shipID], session);
  const boundID =
    bound &&
    bound.type === "substruct" &&
    bound.value &&
    bound.value.type === "substream" &&
    Array.isArray(bound.value.value)
      ? bound.value.value[0]
      : null;
  assert.ok(boundID, "expected GetInventoryFromId to return a bound inventory substruct");
  session.currentBoundObjectID = boundID;
  return boundID;
}

function readOnItemChangeItemID(notification) {
  const payload = Array.isArray(notification && notification.payload)
    ? notification.payload[0]
    : null;
  return payload &&
    payload.type === "packedrow" &&
    payload.fields &&
    typeof payload.fields === "object"
    ? payload.fields.itemID
    : null;
}

function countRealChargeRows(notifications, itemID) {
  const numericItemID = Number(itemID) || 0;
  return notifications
    .filter((entry) => entry && entry.name === "OnItemChange")
    .filter((entry) => Number(readOnItemChangeItemID(entry)) === numericItemID)
    .length;
}

function countTupleChargeRows(notifications, shipID, flagID, typeID) {
  const tupleKey = [Number(shipID) || 0, Number(flagID) || 0, Number(typeID) || 0];
  return notifications
    .filter((entry) => entry && entry.name === "OnItemChange")
    .filter((entry) => {
      const itemID = readOnItemChangeItemID(entry);
      return Array.isArray(itemID) &&
        Number(itemID[0]) === tupleKey[0] &&
        Number(itemID[1]) === tupleKey[1] &&
        Number(itemID[2]) === tupleKey[2];
    })
    .length;
}

function readRemoteListRawItemIDs(value) {
  if (!value || value.type !== "list" || !Array.isArray(value.items)) {
    return [];
  }

  return value.items
    .map((item) => (
      item &&
      item.type === "packedrow" &&
      item.fields &&
      typeof item.fields === "object"
        ? item.fields.itemID
        : null
    ))
    .filter((itemID) => itemID !== null && itemID !== undefined);
}

function hasTupleItemID(itemIDs, shipID, flagID, typeID) {
  const tupleKey = [Number(shipID) || 0, Number(flagID) || 0, Number(typeID) || 0];
  return itemIDs.some((itemID) => (
    Array.isArray(itemID) &&
    Number(itemID[0]) === tupleKey[0] &&
    Number(itemID[1]) === tupleKey[1] &&
    Number(itemID[2]) === tupleKey[2]
  ));
}

test("active ship full List exposes tuple loaded charges natively without after-response materialization", () => {
  const candidate = findInSpaceLoadedChargeCandidate();
  const session = buildSession(candidate);
  const invBroker = new InvBrokerService();
  bindShipInventory(invBroker, session, candidate.ship.itemID);

  const shipList = invBroker.Handle_List([null], session, {});
  const rawListItemIDs = readRemoteListRawItemIDs(shipList);

  assert.equal(
    session._notifications.length,
    0,
    "expected the native ship List response to avoid charge-row notification churn",
  );

  invBroker.afterCallResponse("GetSelfInvItem", session);

  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      hasTupleItemID(
        rawListItemIDs,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      true,
      `expected tuple loaded charge row for flag ${loadedCharge.flagID} in the native ship List response`,
    );
    assert.equal(
      countRealChargeRows(session._notifications, loadedCharge.itemID),
      0,
      `expected real loaded charge row ${loadedCharge.itemID} not to materialize in live inventory`,
    );
    assert.equal(
      countTupleChargeRows(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected the native list response itself to carry tuple charge flag ${loadedCharge.flagID}`,
    );
  }

  invBroker.afterCallResponse("GetSelfInvItem", session);
  invBroker.afterCallResponse("GetAvailableTurretSlots", session);

  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      countRealChargeRows(session._notifications, loadedCharge.itemID),
      0,
      `expected loaded charge row ${loadedCharge.itemID} to stay out of after-response materialization`,
    );
  }
});
