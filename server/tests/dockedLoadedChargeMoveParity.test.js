const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
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
  findItemById,
  ITEM_FLAGS,
  moveItemToLocation,
  resetInventoryStoreForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  getLoadedChargeByFlag,
  listFittedItems,
  validateFitForShip,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  resetFittingRuntimeForTests,
} = require(path.join(
  repoRoot,
  "server/src/_secondary/fitting/fittingRuntime",
));
const {
  handleOrcaCommand,
} = require(path.join(
  repoRoot,
  "server/src/services/ship/devCommandShipRuntime",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotMutableTables() {
  return {
    characters: cloneValue(database.read("characters", "/").data || {}),
    identityState: cloneValue(database.read("identityState", "/").data || {}),
    items: cloneValue(database.read("items", "/").data || {}),
    skills: cloneValue(database.read("skills", "/").data || {}),
  };
}

function restoreMutableTables(snapshot) {
  database.write("characters", "/", cloneValue(snapshot.characters));
  database.write("identityState", "/", cloneValue(snapshot.identityState));
  database.write("items", "/", cloneValue(snapshot.items));
  database.write("skills", "/", cloneValue(snapshot.skills));
  database.flushAllSync();
  resetInventoryStoreForTests();
  resetFittingRuntimeForTests();
}

function createCharacter(userID, name) {
  const service = new CharService();
  const characterID = service.Handle_CreateCharacterWithDoll(
    [name, 5, 1, 1, null, null, 11],
    { userid: userID },
  );
  const characterRecord = getCharacterRecord(characterID);
  assert.ok(characterRecord, "Expected created character record");
  return {
    characterID,
    stationID: Number(characterRecord.stationID || characterRecord.stationid || 0),
    shipID: Number(characterRecord.shipID || characterRecord.shipid || 0),
  };
}

function buildDockedSession(characterID, stationID, shipID) {
  return {
    userid: characterID + 910000,
    clientID: characterID + 920000,
    characterID,
    charid: characterID,
    stationid: stationID,
    stationID: stationID,
    locationid: stationID,
    shipID,
    shipid: shipID,
    activeShipID: shipID,
    currentBoundObjectID: null,
    socket: { destroyed: false },
    notifications: [],
    sessionChanges: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange(change) {
      this.sessionChanges.push(change);
    },
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

function bindStationHangar(service, session) {
  const bound = service.Handle_GetInventory([10004], session);
  const boundID = extractBoundID(bound);
  assert.ok(boundID, "Expected station hangar bind to succeed");
  session.currentBoundObjectID = boundID;
}

function bindShipInventory(service, session, shipID) {
  const bound = service.Handle_GetInventoryFromId([shipID], session);
  const boundID = extractBoundID(bound);
  assert.ok(boundID, "Expected ship inventory bind to succeed");
  session.currentBoundObjectID = boundID;
}

function buildOrcaScenario(userID, name) {
  const candidate = createCharacter(userID, name);
  const session = buildDockedSession(
    candidate.characterID,
    candidate.stationID,
    candidate.shipID,
  );
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true, "Expected session application to succeed");

  const commandResult = handleOrcaCommand(session);
  assert.equal(commandResult.success, true, "Expected /orca to succeed");

  const activeShip = getActiveShipRecord(candidate.characterID);
  assert.ok(activeShip, "Expected active Orca after /orca");

  const refreshSessionResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(
    refreshSessionResult.success,
    true,
    "Expected post-/orca session application to succeed",
  );

  const burstModule = listFittedItems(candidate.characterID, activeShip.itemID).find(
    (item) => Number(item && item.typeID) === 43551,
  );
  assert.ok(burstModule, "Expected fitted Mining Foreman Burst II on /orca ship");

  const loadedCharge = getLoadedChargeByFlag(
    candidate.characterID,
    activeShip.itemID,
    Number(burstModule.flagID) || 0,
  );
  assert.ok(loadedCharge, "Expected loaded mining burst charge on /orca ship");

  return {
    characterID: candidate.characterID,
    stationID: candidate.stationID,
    session,
    service: new InvBrokerService(),
    activeShip,
    burstModule,
    loadedCharge,
  };
}

test("validateFitForShip ignores a loaded burst charge occupying the same slot", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  resetFittingRuntimeForTests();

  const scenario = buildOrcaScenario(980301, "LoadedChargeValidateParity");
  const moveResult = moveItemToLocation(
    scenario.burstModule.itemID,
    scenario.stationID,
    ITEM_FLAGS.HANGAR,
    1,
  );
  assert.equal(moveResult.success, true, "Expected direct module unfit to succeed");

  const burstInHangar = findItemById(scenario.burstModule.itemID);
  const lingeringCharge = getLoadedChargeByFlag(
    scenario.characterID,
    scenario.activeShip.itemID,
    Number(scenario.burstModule.flagID) || 0,
  );
  assert.ok(lingeringCharge, "Expected direct unfit to leave the loaded charge behind");

  const validation = validateFitForShip(
    scenario.characterID,
    findItemById(scenario.activeShip.itemID),
    burstInHangar,
    scenario.burstModule.flagID,
  );
  assert.equal(
    validation.success,
    true,
    "Expected a lingering loaded charge row to stop blocking module refits on the same slot",
  );
});

test("docked burst unfit unloads the attached charge into hangar instead of leaving the slot blocked", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  resetFittingRuntimeForTests();

  const scenario = buildOrcaScenario(980302, "LoadedChargeHangarParity");
  bindStationHangar(scenario.service, scenario.session);

  scenario.service.Handle_Add(
    [scenario.burstModule.itemID, scenario.activeShip.itemID],
    scenario.session,
    null,
  );

  const movedModule = findItemById(scenario.burstModule.itemID);
  const movedCharge = findItemById(scenario.loadedCharge.itemID);
  assert.equal(
    Number(movedModule && movedModule.locationID) || 0,
    scenario.stationID,
    "Expected burst module to move to station hangar on unfit",
  );
  assert.equal(
    Number(movedModule && movedModule.flagID) || 0,
    ITEM_FLAGS.HANGAR,
    "Expected burst module to land in hangar after unfit",
  );
  assert.equal(
    Number(movedCharge && movedCharge.locationID) || 0,
    scenario.stationID,
    "Expected loaded burst charge to unload into station hangar with the module",
  );
  assert.equal(
    Number(movedCharge && movedCharge.flagID) || 0,
    ITEM_FLAGS.HANGAR,
    "Expected loaded burst charge to land in hangar after module unfit",
  );
  assert.equal(
    getLoadedChargeByFlag(
      scenario.characterID,
      scenario.activeShip.itemID,
      Number(scenario.burstModule.flagID) || 0,
    ),
    null,
    "Expected module unfit to clear the original rack charge row",
  );

  bindShipInventory(scenario.service, scenario.session, scenario.activeShip.itemID);
  scenario.service.Handle_Add(
    [scenario.burstModule.itemID, scenario.stationID],
    scenario.session,
    { flag: scenario.burstModule.flagID },
  );

  const refittedModule = findItemById(scenario.burstModule.itemID);
  assert.equal(
    Number(refittedModule && refittedModule.locationID) || 0,
    scenario.activeShip.itemID,
    "Expected refitted burst module to return to the active ship",
  );
  assert.equal(
    Number(refittedModule && refittedModule.flagID) || 0,
    Number(scenario.burstModule.flagID) || 0,
    "Expected refitted burst module to return to its original slot",
  );
  assert.equal(
    getLoadedChargeByFlag(
      scenario.characterID,
      scenario.activeShip.itemID,
      Number(scenario.burstModule.flagID) || 0,
    ),
    null,
    "Expected refitting the unloaded burst module alone to leave the charge in hangar until reloaded",
  );
});

test("docked slot-to-slot burst moves carry the loaded charge to the new flag", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  resetFittingRuntimeForTests();

  const scenario = buildOrcaScenario(980303, "LoadedChargeSlotMoveParity");
  const occupiedFlags = new Set(
    listFittedItems(scenario.characterID, scenario.activeShip.itemID)
      .filter((item) => Number(item && item.categoryID) === 7)
      .map((item) => Number(item.flagID) || 0),
  );
  const destinationFlag = [27, 28, 29, 30, 31, 32].find(
    (flagID) => !occupiedFlags.has(flagID),
  );
  assert.ok(destinationFlag, "Expected /orca to have an empty high slot for the move test");

  bindShipInventory(scenario.service, scenario.session, scenario.activeShip.itemID);
  scenario.service.Handle_Add(
    [scenario.burstModule.itemID, scenario.activeShip.itemID],
    scenario.session,
    { flag: destinationFlag },
  );

  const movedModule = findItemById(scenario.burstModule.itemID);
  const movedCharge = findItemById(scenario.loadedCharge.itemID);
  assert.equal(
    Number(movedModule && movedModule.locationID) || 0,
    scenario.activeShip.itemID,
    "Expected burst module to stay on the active ship during slot move",
  );
  assert.equal(
    Number(movedModule && movedModule.flagID) || 0,
    destinationFlag,
    "Expected burst module to move into the requested empty high slot",
  );
  assert.equal(
    Number(movedCharge && movedCharge.locationID) || 0,
    scenario.activeShip.itemID,
    "Expected loaded burst charge to stay on the active ship during slot move",
  );
  assert.equal(
    Number(movedCharge && movedCharge.flagID) || 0,
    destinationFlag,
    "Expected loaded burst charge to follow the module to the new slot",
  );
  assert.equal(
    getLoadedChargeByFlag(
      scenario.characterID,
      scenario.activeShip.itemID,
      Number(scenario.burstModule.flagID) || 0,
    ),
    null,
    "Expected the original burst slot to stop advertising a loaded charge after the move",
  );
  const currentLoadedCharge = getLoadedChargeByFlag(
    scenario.characterID,
    scenario.activeShip.itemID,
    destinationFlag,
  );
  assert.equal(
    Number(currentLoadedCharge && currentLoadedCharge.itemID) || 0,
    Number(scenario.loadedCharge.itemID) || 0,
    "Expected the new slot to advertise the same loaded burst charge after the move",
  );
});
