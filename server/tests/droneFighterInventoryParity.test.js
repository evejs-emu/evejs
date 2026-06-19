const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const FighterMgrService = require(path.join(
  repoRoot,
  "server/src/services/fighter/fighterMgrService",
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
  grantItemToCharacterLocation,
  removeInventoryItem,
  resetInventoryStoreForTests,
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

function getDockedActiveShipCandidate() {
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

      const dockedLocationID =
        Number(characterRecord.structureID || characterRecord.stationID || 0) || 0;
      if (dockedLocationID <= 0) {
        return null;
      }

      return {
        characterID,
        characterRecord,
        ship,
      };
    })
    .filter(Boolean);

  assert.ok(candidates.length > 0, "Expected at least one docked character with an active ship");
  return candidates[0];
}

function buildSession(candidate) {
  return {
    clientID: candidate.characterID + 97000,
    userid: candidate.characterID,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    stationid: Number(candidate.characterRecord && candidate.characterRecord.stationID) || 0,
    stationID: Number(candidate.characterRecord && candidate.characterRecord.stationID) || 0,
    structureid: Number(candidate.characterRecord && candidate.characterRecord.structureID) || 0,
    structureID: Number(candidate.characterRecord && candidate.characterRecord.structureID) || 0,
    socket: { destroyed: false },
    currentBoundObjectID: null,
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function extractBoundID(value) {
  return (
    value &&
    value.type === "substruct" &&
    value.value &&
    value.value.type === "substream" &&
    Array.isArray(value.value.value)
      ? value.value.value[0]
      : null
  );
}

function bindShipInventory(service, session, shipID) {
  const bound = service.Handle_GetInventoryFromId([shipID], session);
  const boundID = extractBoundID(bound);
  assert.ok(boundID, "Expected GetInventoryFromId to return a bound ship inventory");
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

function getTupleListRows(value) {
  if (!(value && value.type === "list" && Array.isArray(value.items))) {
    return [];
  }

  return value.items.map((row) => {
    if (row && row.type === "list" && Array.isArray(row.items)) {
      return row.items;
    }
    return row;
  });
}

function grantTemporaryItem(candidate, flagID, typeMatch, quantity) {
  const grantResult = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.ship.itemID,
    flagID,
    typeMatch,
    quantity,
    { transient: true },
  );
  assert.equal(grantResult.success, true, "Expected transient inventory grant");

  const items = (grantResult.data && grantResult.data.items) || [];
  for (const item of items) {
    transientItemIDs.push(Number(item.itemID) || 0);
  }

  assert.ok(items[0] && items[0].itemID, "Expected transient item data");
  return items[0];
}

function grantTemporaryItemToLocation(candidate, locationID, flagID, typeMatch, quantity) {
  const grantResult = grantItemToCharacterLocation(
    candidate.characterID,
    locationID,
    flagID,
    typeMatch,
    quantity,
    { transient: true },
  );
  assert.equal(grantResult.success, true, "Expected transient inventory grant");

  const items = (grantResult.data && grantResult.data.items) || [];
  for (const item of items) {
    transientItemIDs.push(Number(item.itemID) || 0);
  }

  assert.ok(items[0] && items[0].itemID, "Expected transient item data");
  return items[0];
}

test.afterEach(() => {
  for (const itemID of transientItemIDs.splice(0)) {
    if (itemID > 0) {
      removeInventoryItem(itemID, { removeContents: true });
    }
  }

  resetInventoryStoreForTests();
});

test("ListDroneBay returns the active ship's real drone bay contents", () => {
  resetInventoryStoreForTests();
  const candidate = getActiveShipCandidate();
  const session = buildSession(candidate);
  const service = new InvBrokerService();
  const droneType = resolveItemByName("Hobgoblin I");
  assert.equal(droneType && droneType.success, true, "Expected Hobgoblin I metadata");

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  bindShipInventory(service, session, candidate.ship.itemID);
  const droneItem = grantTemporaryItem(
    candidate,
    ITEM_FLAGS.DRONE_BAY,
    droneType.match,
    5,
  );

  const rows = getInventoryEntries(service.Handle_ListDroneBay([], session, {}));
  const listedDrone = rows.find(
    (row) => Number(row.itemID) === Number(droneItem.itemID),
  );

  assert.ok(listedDrone, "Expected ListDroneBay to include the granted drone stack");
  assert.equal(Number(listedDrone.flagID), ITEM_FLAGS.DRONE_BAY);
  assert.equal(Number(listedDrone.typeID), Number(droneType.match.typeID));
  assert.equal(Number(listedDrone.stacksize), 5);
});

test("ListFighterBay returns the active ship's real fighter bay contents", () => {
  resetInventoryStoreForTests();
  const candidate = getActiveShipCandidate();
  const session = buildSession(candidate);
  const service = new InvBrokerService();
  const fighterType = resolveItemByName("Templar I");
  assert.equal(fighterType && fighterType.success, true, "Expected Templar I metadata");

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  bindShipInventory(service, session, candidate.ship.itemID);
  const fighterItem = grantTemporaryItem(
    candidate,
    ITEM_FLAGS.FIGHTER_BAY,
    fighterType.match,
    9,
  );

  const rows = getInventoryEntries(service.Handle_ListFighterBay([], session, {}));
  const listedFighter = rows.find(
    (row) => Number(row.itemID) === Number(fighterItem.itemID),
  );

  assert.ok(listedFighter, "Expected ListFighterBay to include the granted fighter stack");
  assert.equal(Number(listedFighter.flagID), ITEM_FLAGS.FIGHTER_BAY);
  assert.equal(Number(listedFighter.typeID), Number(fighterType.match.typeID));
  assert.equal(Number(listedFighter.stacksize), 9);
});

test("fighterMgr load and unload updates fighter tube state from ship inventory", () => {
  resetInventoryStoreForTests();
  const candidate = getActiveShipCandidate();
  const session = buildSession(candidate);
  const fighterType = resolveItemByName("Templar I");
  assert.equal(fighterType && fighterType.success, true, "Expected Templar I metadata");

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const service = new FighterMgrService();
  const fighterItem = grantTemporaryItem(
    candidate,
    ITEM_FLAGS.FIGHTER_BAY,
    fighterType.match,
    9,
  );

  session.notifications.length = 0;
  const loaded = service.Handle_LoadFightersToTube(
    [fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0],
    session,
    {},
  );
  assert.equal(loaded, true, "Expected fighter stack to load into tube 0");

  const fightersForShip = service.Handle_GetFightersForShip([], session, {});
  assert.equal(Array.isArray(fightersForShip), true);
  assert.equal(fightersForShip.length, 3);
  assert.equal(fightersForShip[0].type, "list");
  assert.equal(fightersForShip[1].type, "list");
  assert.equal(fightersForShip[2].type, "dict");

  const tubeRows = getTupleListRows(fightersForShip[0]);
  assert.deepEqual(tubeRows, [[
    ITEM_FLAGS.FIGHTER_TUBE_0,
    Number(fighterItem.itemID),
    Number(fighterType.match.typeID),
    9,
  ]]);

  const fighterBayItems = listContainerItems(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.FIGHTER_BAY,
  );
  assert.equal(
    fighterBayItems.some((item) => Number(item.itemID) === Number(fighterItem.itemID)),
    false,
    "Expected the fighter stack to leave fighter bay when loaded into a tube",
  );

  assert.equal(
    session.notifications.some((notification) => notification.name === "OnFighterTubeContentUpdate"),
    true,
    "Expected tube content notification after loading a fighter",
  );
  assert.equal(
    session.notifications.some(
      (notification) =>
        notification.name === "OnFighterTubeTaskStatus" &&
        Array.isArray(notification.payload) &&
        notification.payload[1] === "READY",
    ),
    true,
    "Expected READY tube state notification after loading a fighter",
  );

  session.notifications.length = 0;
  const unloaded = service.Handle_UnloadTubeToFighterBay(
    [ITEM_FLAGS.FIGHTER_TUBE_0],
    session,
    {},
  );
  assert.equal(unloaded, true, "Expected fighter stack to unload back to fighter bay");

  const fighterBayAfterUnload = listContainerItems(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.FIGHTER_BAY,
  );
  assert.equal(
    fighterBayAfterUnload.some((item) => Number(item.itemID) === Number(fighterItem.itemID)),
    true,
    "Expected the fighter stack to return to fighter bay after unload",
  );
  assert.equal(
    session.notifications.some((notification) => notification.name === "OnFighterTubeContentEmpty"),
    true,
    "Expected tube empty notification after unloading a fighter",
  );
  assert.equal(
    session.notifications.some(
      (notification) =>
        notification.name === "OnFighterTubeTaskStatus" &&
        Array.isArray(notification.payload) &&
        notification.payload[1] === "EMPTY",
    ),
    true,
    "Expected EMPTY tube state notification after unloading a fighter",
  );
});

test("fighterMgr loads docked hangar fighters directly into launch tubes for the active ship", () => {
  resetInventoryStoreForTests();
  const candidate = getDockedActiveShipCandidate();
  const session = buildSession(candidate);
  const fighterType = resolveItemByName("Templar II");
  assert.equal(fighterType && fighterType.success, true, "Expected Templar II metadata");

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const dockedLocationID =
    Number(candidate.characterRecord.structureID || candidate.characterRecord.stationID || 0) || 0;
  assert.ok(dockedLocationID > 0, "Expected a docked location for the active ship");

  const service = new FighterMgrService();
  const fighterItem = grantTemporaryItemToLocation(
    candidate,
    dockedLocationID,
    ITEM_FLAGS.HANGAR,
    fighterType.match,
    9,
  );

  session.notifications.length = 0;
  const loaded = service.Handle_LoadFightersToTube(
    [fighterItem.itemID, ITEM_FLAGS.FIGHTER_TUBE_0],
    session,
    {},
  );
  assert.equal(
    loaded,
    true,
    "Expected docked hangar fighter stacks to load straight into the active ship's tube",
  );

  const tubeRows = getTupleListRows(service.Handle_GetFightersForShip([], session, {})[0]);
  assert.deepEqual(tubeRows, [[
    ITEM_FLAGS.FIGHTER_TUBE_0,
    Number(fighterItem.itemID),
    Number(fighterType.match.typeID),
    9,
  ]]);

  const remainingHangarItems = listContainerItems(
    candidate.characterID,
    dockedLocationID,
    ITEM_FLAGS.HANGAR,
  );
  assert.equal(
    remainingHangarItems.some((item) => Number(item.itemID) === Number(fighterItem.itemID)),
    false,
    "Expected the loaded fighter stack to leave the docked hangar",
  );

  const tubeItems = listContainerItems(
    candidate.characterID,
    candidate.ship.itemID,
    ITEM_FLAGS.FIGHTER_TUBE_0,
  );
  assert.equal(
    tubeItems.some((item) => Number(item.itemID) === Number(fighterItem.itemID)),
    true,
    "Expected the loaded fighter stack to land in the launch tube",
  );
});

test("fighterMgr keeps fighter ability RPC return payloads dict-shaped when no live in-space context is available", () => {
  const service = new FighterMgrService();
  const session = {
    characterID: 140000001,
    charid: 140000001,
    userid: 140000001,
    sendNotification() {},
  };

  const launchResult = service.Handle_LaunchFightersFromTubes(
    [[ITEM_FLAGS.FIGHTER_TUBE_0]],
    session,
    {},
  );
  const recallResult = service.Handle_RecallFightersToTubes(
    [[991000436]],
    session,
    {},
  );
  const activateResult = service.Handle_CmdActivateAbilitySlots(
    [[991000436], 0, 60003760],
    session,
    {},
  );
  const deactivateResult = service.Handle_CmdDeactivateAbilitySlots(
    [[991000436], 0],
    session,
    {},
  );

  assert.equal(launchResult && launchResult.type, "dict");
  assert.deepEqual(launchResult.entries, []);
  assert.equal(recallResult && recallResult.type, "dict");
  assert.deepEqual(recallResult.entries, [[991000436, null]]);
  assert.equal(activateResult && activateResult.type, "dict");
  assert.deepEqual(activateResult.entries, [[991000436, null]]);
  assert.equal(deactivateResult && deactivateResult.type, "dict");
  assert.deepEqual(deactivateResult.entries, [[991000436, null]]);
});
