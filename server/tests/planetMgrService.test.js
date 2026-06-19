const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const newDatabaseDataDir = process.env.EVEJS_NEWDB_DATA_DIR
  ? path.resolve(process.env.EVEJS_NEWDB_DATA_DIR)
  : path.join(repoRoot, "server/src/newDatabase/data");
const planetRuntimeStateFile = path.join(
  newDatabaseDataDir,
  "planetRuntimeState",
  "data.json",
);
const config = require(path.join(repoRoot, "server/src/config"));
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const PlanetMgrService = require(path.join(
  repoRoot,
  "server/src/services/planet/planetMgrService",
));
const PlanetOrbitalRegistryBrokerService = require(path.join(
  repoRoot,
  "server/src/services/planet/planetOrbitalRegistryBrokerService",
));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const planetRuntimeStore = require(path.join(
  repoRoot,
  "server/src/services/planet/planetRuntimeStore",
));
const itemStore = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const characterState = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const walletState = require(path.join(
  repoRoot,
  "server/src/services/account/walletState",
));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const {
  unwrapMarshalValue,
} = require(path.join(repoRoot, "server/src/services/_shared/serviceHelpers"));

const FILETIME_UNIX_EPOCH_OFFSET = 116444736000000000n;
const SECOND_TICKS = 10000000n;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function filetimeFromUnixMs(ms) {
  return (BigInt(ms) * 10000n + FILETIME_UNIX_EPOCH_OFFSET).toString();
}

function readPlanetRuntimeStateFile() {
  return JSON.parse(fs.readFileSync(planetRuntimeStateFile, "utf8"));
}

function keyValEntries(value) {
  assert.equal(value.type, "object");
  assert.equal(value.name, "util.KeyVal");
  return new Map(value.args.entries);
}

function listItems(value) {
  assert.equal(value.type, "list");
  return value.items;
}

function keyValObject(value) {
  return Object.fromEntries(keyValEntries(value));
}

function writePlanetRuntimeStateForTest(value) {
  const result = database.write(
    planetRuntimeStore.TABLE_NAME,
    "/",
    cloneJson(value),
    { force: true },
  );
  assert.equal(result.success, true, `Failed to write ${planetRuntimeStore.TABLE_NAME}`);
  const flushResult = database.flushTableSync(planetRuntimeStore.TABLE_NAME);
  assert.equal(flushResult.success, true, `Failed to flush ${planetRuntimeStore.TABLE_NAME}`);
}

function resetPlanetRuntimeState() {
  writePlanetRuntimeStateForTest({
    schemaVersion: planetRuntimeStore.SCHEMA_VERSION,
    resourcesByPlanetID: {},
    coloniesByKey: {},
    launchesByID: {},
    acceptedNetworkEditsByKey: {},
    nextIDs: cloneJson(planetRuntimeStore.DEFAULT_NEXT_IDS),
  });
}

function withRestoredPlanetRuntimeState(t) {
  const original = cloneJson(
    database.read(planetRuntimeStore.TABLE_NAME, "/").data || {},
  );
  t.after(() => {
    writePlanetRuntimeStateForTest(original);
  });
  resetPlanetRuntimeState();
}

function withRestoredItemsState(t) {
  const original = cloneJson(
    database.read(itemStore.ITEMS_TABLE, "/").data || {},
  );
  t.after(() => {
    database.write(itemStore.ITEMS_TABLE, "/", original, { force: true });
    itemStore.resetInventoryStoreForTests();
  });
  itemStore.resetInventoryStoreForTests();
}

function withRestoredCharacterWallet(t, characterID = 140000238, balance = 10000000) {
  const original = cloneJson(characterState.getCharacterRecord(characterID));
  t.after(() => {
    characterState.writeCharacterRecord(characterID, original);
  });
  characterState.writeCharacterRecord(characterID, {
    ...original,
    balance,
    balanceChange: 0,
    walletJournal: [],
  });
}

function getWrappedUserErrorMessage(error) {
  return error &&
    error.machoErrorResponse &&
    error.machoErrorResponse.payload &&
    error.machoErrorResponse.payload.header &&
    error.machoErrorResponse.payload.header[1] &&
    error.machoErrorResponse.payload.header[1][0];
}

test("planetMgr returns an empty list shape when the character has no colonies", () => {
  const result =
    PlanetMgrService._testing.buildPlanetListForCharacter({});

  assert.deepEqual(result, {
    type: "list",
    items: [],
  });
});

test("planetMgr builds planet rows from colony-style character data", () => {
  const result = PlanetMgrService._testing.buildPlanetListForCharacter({
    colonies: [
      {
        planetID: 40000002,
        commandCenterLevel: 4,
        pinCount: 12,
      },
    ],
  });

  assert.equal(result.type, "list");
  assert.equal(result.items.length, 1);

  const row = result.items[0];
  assert.equal(row.name, "util.KeyVal");
  const entries = new Map(row.args.entries);

  assert.equal(entries.get("planetID"), 40000002);
  assert.equal(entries.get("solarSystemID"), 30000001);
  assert.equal(entries.get("typeID"), 11);
  assert.equal(entries.get("numberOfPins"), 12);
  assert.equal(entries.get("celestialIndex"), 1);
  assert.equal(entries.get("commandCenterLevel"), 4);
});

test("planetMgr resolves and binds planet monikers with nested GetPlanetInfo", () => {
  const service = new PlanetMgrService();
  const session = { characterID: 140000238 };

  assert.equal(service.Handle_MachoResolveObject([40000002], session), config.proxyNodeId);

  const bindResult = service.Handle_MachoBindObject(
    [40000002, ["GetPlanetInfo", [], null]],
    session,
  );

  assert.equal(Array.isArray(bindResult), true);
  assert.equal(bindResult[0].type, "substruct");
  assert.equal(bindResult[0].value.type, "substream");
  assert.equal(typeof bindResult[0].value.value[0], "string");
  assert.equal(bindResult[0].value.value[0].startsWith("N="), true);

  const entries = keyValEntries(bindResult[1]);
  assert.equal(entries.get("planetID"), 40000002);
  assert.equal(entries.get("solarSystemID"), 30000001);
  assert.equal(entries.get("planetTypeID"), 11);
  assert.equal(entries.get("radius"), 5060000);
  assert.equal(entries.get("celestialIndex"), 1);
});

test("planetMgr bound calls use the bound planet and persist resource quality data", (t) => {
  withRestoredPlanetRuntimeState(t);

  const service = new PlanetMgrService();
  const session = { characterID: 140000238 };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  const firstResourceInfo = service.Handle_GetPlanetResourceInfo([], session);
  assert.equal(firstResourceInfo.type, "dict");
  const firstEntries = new Map(firstResourceInfo.entries);

  assert.deepEqual(
    [...firstEntries.keys()].sort((left, right) => left - right),
    [2073, 2268, 2287, 2288, 2305],
  );
  for (const quality of firstEntries.values()) {
    assert.equal(Number.isInteger(quality), true);
    assert.equal(quality > 0, true);
  }

  const state = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  const resourceRecord = state.resourcesByPlanetID["40000002"];
  assert.ok(resourceRecord);
  assert.deepEqual(
    resourceRecord.resourceTypeIDs,
    [2073, 2268, 2287, 2288, 2305],
  );
  assert.equal(resourceRecord.version, 2);
  assert.equal(Object.keys(resourceRecord.layersByTypeID).length, 5);
  assert.equal(resourceRecord.layersByTypeID["2268"].version, 1);
  assert.equal(resourceRecord.layersByTypeID["2268"].hotspots.length >= 6, true);

  const secondResourceInfo = service.Handle_GetPlanetResourceInfo([], session);
  assert.deepEqual(secondResourceInfo, firstResourceInfo);
});

test("planet resource layers are persistent and drive ECU estimates", (t) => {
  withRestoredPlanetRuntimeState(t);
  withRestoredCharacterWallet(t);

  const service = new PlanetMgrService();
  const session = { characterID: 140000238 };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  service.Handle_GetPlanetResourceInfo([], session);
  const state = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  const layer = state.resourcesByPlanetID["40000002"].layersByTypeID["2268"];
  const hotspot = layer.hotspots[0];

  const firstValue = planetRuntimeStore.evaluateResourceValueAt(
    40000002,
    2268,
    hotspot.latitude,
    hotspot.longitude,
  );
  const secondValue = planetRuntimeStore.evaluateResourceValueAt(
    40000002,
    2268,
    hotspot.latitude,
    hotspot.longitude,
  );
  assert.equal(firstValue, secondValue);
  assert.equal(firstValue > 0, true);
  assert.equal(firstValue <= planetRuntimeStore.PLANET_RESOURCE_MAX_VALUE, true);

  const programResult = service.Handle_GetProgramResultInfo([
    [1, 1],
    2268,
    [[0, hotspot.latitude, hotspot.longitude]],
    0.02,
  ], session);
  assert.equal(programResult[0] > 0, true);

  service.Handle_UserUpdateNetwork([
    [
      [1, [9001, 2524, 0.1, 0.2]],
      [1, [[1, 1], 2848, hotspot.latitude, hotspot.longitude]],
      [10, [[1, 1], 0, hotspot.latitude, hotspot.longitude]],
      [13, [[1, 1], 2268, 0.02]],
    ],
  ], session);

  const updatedState = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  const updatedLayer = updatedState.resourcesByPlanetID["40000002"].layersByTypeID["2268"];
  assert.equal(updatedLayer.depletionEvents.length, 1);

  const depletedProgramResult = service.Handle_GetProgramResultInfo([
    [1, 1],
    2268,
    [[0, hotspot.latitude, hotspot.longitude]],
    0.02,
  ], session);
  assert.equal(depletedProgramResult[0] < programResult[0], true);
});

test("planetMgr flushes colony network edits to disk immediately", (t) => {
  withRestoredPlanetRuntimeState(t);
  withRestoredCharacterWallet(t);

  const service = new PlanetMgrService();
  const session = { characterID: 140000238 };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  assert.equal(
    readPlanetRuntimeStateFile().coloniesByKey["40000002:140000238"],
    undefined,
  );

  service.Handle_UserUpdateNetwork([
    [
      [1, [9001, 2524, 0.1, 0.2]],
    ],
  ], session);

  const onDiskState = readPlanetRuntimeStateFile();
  const colony = onDiskState.coloniesByKey["40000002:140000238"];
  assert.ok(colony, "Expected colony edit to be present in data.json before debounce delay");
  assert.equal(colony.planetID, 40000002);
  assert.equal(colony.ownerID, 140000238);
  assert.equal(colony.pins.length, 1);
  assert.equal(colony.pins[0].typeID, 2524);
});

test("planetMgr returns deterministic resource heatmap bytes for bound planets", (t) => {
  withRestoredPlanetRuntimeState(t);

  const service = new PlanetMgrService();
  const session = { characterID: 140000238 };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  const requestInfo = {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: [
        ["resourceTypeID", 2268],
        ["oldBand", 0],
        ["newBand", 3],
        ["proximity", 4],
      ],
    },
  };
  const firstResourceData = service.Handle_GetResourceData([requestInfo], session);
  const firstEntries = keyValEntries(firstResourceData);
  const firstData = firstEntries.get("data");
  assert.equal(firstEntries.get("numBands"), 3);
  assert.equal(firstEntries.get("proximity"), 4);
  assert.equal(firstData.type, "bytes");
  assert.equal(Buffer.isBuffer(firstData.value), true);
  assert.equal(firstData.value.length, 3 * 3 * 4);
  assert.equal(Number.isFinite(firstData.value.readFloatLE(0)), true);

  const secondResourceData = service.Handle_GetResourceData([requestInfo], session);
  const secondData = keyValEntries(secondResourceData).get("data");
  assert.equal(secondData.value.equals(firstData.value), true);

  const higherBandRequestInfo = cloneJson(requestInfo);
  higherBandRequestInfo.args.entries = higherBandRequestInfo.args.entries
    .map(([key, value]) => [key, key === "newBand" ? 5 : value]);
  const higherBandData = keyValEntries(
    service.Handle_GetResourceData([higherBandRequestInfo], session),
  ).get("data");
  assert.equal(higherBandData.value.length, 5 * 5 * 4);
  assert.equal(
    higherBandData.value.subarray(0, firstData.value.length).equals(firstData.value),
    true,
  );
});

test("planetMgr Phase 0 read-only PI calls return stable empty shapes", (t) => {
  withRestoredPlanetRuntimeState(t);

  const service = new PlanetMgrService();
  const session = { characterID: 140000238 };

  assert.deepEqual(service.Handle_GetFullNetworkForOwner([40000002, 140000239], session), [
    { type: "list", items: [] },
    { type: "list", items: [] },
  ]);

  assert.deepEqual(service.Handle_GetCommandPinsForPlanet([40000002], session), {
    type: "dict",
    entries: [],
  });
  assert.deepEqual(service.Handle_GetExtractorsForPlanet([40000002], session), {
    type: "list",
    items: [],
  });
  assert.deepEqual(service.Handle_GetMyLaunchesDetails([], session), {
    type: "list",
    items: [],
  });
  assert.equal(service.Handle_DeleteLaunch([910000000000], session), true);

  const resourceData = service.Handle_GetResourceData([
    {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["resourceTypeID", 2268],
          ["oldBand", 0],
          ["newBand", 3],
          ["proximity", 4],
        ],
      },
    },
  ], session);
  const entries = keyValEntries(resourceData);
  assert.equal(entries.get("data"), null);
  assert.equal(entries.get("numBands"), 0);
  assert.equal(entries.get("proximity"), 4);
});

test("planetMgr persists submitted PI colony edits and remaps temporary IDs", (t) => {
  withRestoredPlanetRuntimeState(t);
  withRestoredItemsState(t);
  withRestoredCharacterWallet(t, 140000238, 5000000);

  const service = new PlanetMgrService();
  const shipID = 990000001;
  const commandCenterGrant = itemStore.grantItemToCharacterLocation(
    140000238,
    shipID,
    itemStore.ITEM_FLAGS.CARGO_HOLD,
    2524,
    1,
    { singleton: 0 },
  );
  assert.equal(commandCenterGrant.success, true);
  const commandCenterID = commandCenterGrant.data.items[0].itemID;
  const notifications = [];
  const session = {
    characterID: 140000238,
    shipID,
    sendNotification: (...args) => notifications.push(args),
  };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  const tempEcuID = [1, 1];
  const tempProcessorID = [1, 2];
  const tempRouteID = [2, 1];
  const colonyResult = service.Handle_UserUpdateNetwork([
    [
      [1, [commandCenterID, 2524, 0.1, 0.2]],
      [9, [commandCenterID, 2]],
      [1, [tempEcuID, 2848, 0.12, 0.22]],
      [10, [tempEcuID, 0, 0.13, 0.23]],
      [12, [tempEcuID, 0, 0.14, 0.24]],
      [13, [tempEcuID, 2268, 0.02]],
      [3, [commandCenterID, tempEcuID, 0]],
      [1, [tempProcessorID, 2473, 0.15, 0.25]],
      [8, [tempProcessorID, 121]],
      [3, [tempEcuID, tempProcessorID, 0]],
      [6, [tempRouteID, [tempEcuID, tempProcessorID], 2268, 100]],
    ],
  ], session);

  const colony = keyValObject(colonyResult);
  assert.equal(colony.ownerID, 140000238);
  assert.equal(colony.level, 2);
  assert.equal(typeof colony.currentSimTime, "bigint");

  const pins = listItems(colony.pins).map(keyValObject);
  assert.equal(pins.length, 3);
  const commandPin = pins.find((pin) => pin.typeID === 2524);
  const ecuPin = pins.find((pin) => pin.typeID === 2848);
  const processorPin = pins.find((pin) => pin.typeID === 2473);

  assert.equal(commandPin.id, commandCenterID);
  assert.equal(commandPin.lastLaunchTime, 0n);
  assert.equal(ecuPin.id >= 900000000000, true);
  assert.equal(ecuPin.programType, 2268);
  assert.equal(ecuPin.cycleTime > 0, true);
  assert.equal(ecuPin.qtyPerCycle > 0, true);
  assert.equal(typeof ecuPin.expiryTime, "bigint");
  assert.equal(typeof ecuPin.installTime, "bigint");
  assert.deepEqual(ecuPin.heads.items[0].items, [0, 0.14, 0.24]);
  assert.equal(processorPin.schematicID, 121);

  const links = listItems(colony.links).map(keyValObject);
  assert.equal(links.length, 2);
  assert.deepEqual(
    links.map((link) => [link.endpoint1, link.endpoint2, link.typeID, link.level]),
    [
      [commandCenterID, ecuPin.id, 2280, 0],
      [ecuPin.id, processorPin.id, 2280, 0],
    ],
  );

  const routes = listItems(colony.routes).map(keyValObject);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].routeID, 1);
  assert.deepEqual(routes[0].path.items, [ecuPin.id, processorPin.id]);
  assert.equal(routes[0].commodityTypeID, 2268);
  assert.equal(routes[0].commodityQuantity, 100);

  const storedState = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  const storedColony = storedState.coloniesByKey["40000002:140000238"];
  assert.equal(storedColony.pins.length, 3);
  assert.equal(storedColony.level, 2);

  const wallet = walletState.getCharacterWallet(140000238);
  assert.equal(wallet.balance, 3370000);
  const journal = walletState.getCharacterWalletJournal(140000238);
  assert.equal(journal[0].entryTypeID, walletState.JOURNAL_ENTRY_TYPE.PLANETARY_CONSTRUCTION);
  assert.equal(journal[0].amount, -1630000);
  assert.equal(journal[0].referenceID, 40000002);

  const characterPlanets = service.Handle_GetPlanetsForChar([], session);
  const planetEntry = keyValObject(listItems(characterPlanets)[0]);
  assert.equal(planetEntry.planetID, 40000002);
  assert.equal(planetEntry.numberOfPins, 3);
  assert.equal(planetEntry.commandCenterLevel, 2);

  assert.equal(itemStore.findItemById(commandCenterID), null);
  assert.equal(
    notifications.some((notification) => (
      notification[0] === "OnItemChange" &&
      Array.isArray(notification[2]) &&
      notification[2][0] &&
      notification[2][0].fields &&
      notification[2][0].fields.itemID === commandCenterID
    )),
    true,
  );
  assert.deepEqual(notifications.find((notification) => notification[0] === "OnPlanetChangesSubmitted"), [
    "OnPlanetChangesSubmitted",
    "clientID",
    [40000002],
  ]);
});

test("planetMgr applies PI removal and update commands across an existing colony", (t) => {
  withRestoredPlanetRuntimeState(t);
  withRestoredCharacterWallet(t);

  const service = new PlanetMgrService();
  const session = { characterID: 140000238 };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  const initial = keyValObject(service.Handle_UserUpdateNetwork([
    [
      [1, [9001, 2524, 0.1, 0.2]],
      [1, [[1, 1], 2848, 0.12, 0.22]],
      [10, [[1, 1], 0, 0.13, 0.23]],
      [3, [9001, [1, 1], 0]],
      [1, [[1, 2], 2473, 0.15, 0.25]],
      [3, [[1, 1], [1, 2], 0]],
      [6, [[2, 1], [[1, 1], [1, 2]], 2268, 100]],
    ],
  ], session));
  const initialPins = listItems(initial.pins).map(keyValObject);
  const ecuID = initialPins.find((pin) => pin.typeID === 2848).id;
  const processorID = initialPins.find((pin) => pin.typeID === 2473).id;

  const updated = keyValObject(service.Handle_UserUpdateNetwork([
    [
      [5, [9001, ecuID, 1]],
      [7, [1]],
      [11, [ecuID, 0]],
      [10, [ecuID, 1, 0.18, 0.28]],
      [4, [9001, ecuID]],
      [2, [processorID]],
    ],
  ], session));

  const pins = listItems(updated.pins).map(keyValObject);
  const ecuPin = pins.find((pin) => pin.typeID === 2848);
  assert.equal(pins.some((pin) => pin.id === processorID), false);
  assert.deepEqual(ecuPin.heads.items[0].items, [1, 0.18, 0.28]);
  assert.deepEqual(
    listItems(updated.links).map(keyValObject).map((link) => [link.endpoint1, link.endpoint2, link.level]),
    [],
  );
  assert.deepEqual(listItems(updated.routes).map(keyValObject), []);
});

test("planetMgr does not double charge replayed PI edit submissions", (t) => {
  withRestoredPlanetRuntimeState(t);
  withRestoredCharacterWallet(t, 140000238, 1000000);

  const service = new PlanetMgrService();
  const session = { characterID: 140000238 };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  const submission = [
    [
      [1, [[1, 1], 2848, 0.12, 0.22]],
    ],
  ];

  const first = keyValObject(service.Handle_UserUpdateNetwork(submission, session));
  const firstPins = listItems(first.pins).map(keyValObject);
  assert.equal(firstPins.length, 1);
  assert.equal(walletState.getCharacterWallet(140000238).balance, 955000);

  const replay = keyValObject(service.Handle_UserUpdateNetwork(submission, session));
  const replayPins = listItems(replay.pins).map(keyValObject);
  assert.equal(replayPins.length, 1);
  assert.equal(replayPins[0].id, firstPins[0].id);
  assert.equal(walletState.getCharacterWallet(140000238).balance, 955000);
  assert.equal(walletState.getCharacterWalletJournal(140000238).length, 1);
});

test("planetMgr rejects PI construction when the wallet cannot cover it", (t) => {
  withRestoredPlanetRuntimeState(t);
  withRestoredCharacterWallet(t, 140000238, 10000);

  const service = new PlanetMgrService();
  const session = { characterID: 140000238 };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  assert.throws(
    () => service.Handle_UserUpdateNetwork([
      [
        [1, [[1, 1], 2848, 0.12, 0.22]],
      ],
    ], session),
    (error) => getWrappedUserErrorMessage(error) === "NotEnoughMoney",
  );

  const state = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  assert.equal(state.coloniesByKey["40000002:140000238"], undefined);
  assert.equal(walletState.getCharacterWallet(140000238).balance, 10000);
  assert.equal(walletState.getCharacterWalletJournal(140000238).length, 0);
});

test("planetMgr lazily simulates ECU and processor output into persisted storage", (t) => {
  withRestoredPlanetRuntimeState(t);
  withRestoredCharacterWallet(t);

  const originalDateNow = Date.now;
  const startMs = Date.UTC(2026, 0, 1, 0, 0, 0);
  Date.now = () => startMs;
  t.after(() => {
    Date.now = originalDateNow;
  });

  const service = new PlanetMgrService();
  const session = { characterID: 140000238 };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  service.Handle_UserUpdateNetwork([
    [
      [1, [9001, 2524, 0.1, 0.2]],
      [1, [[1, 1], 2848, 0.12, 0.22]],
      [10, [[1, 1], 0, 0.12, 0.22]],
      [13, [[1, 1], 2268, 0.02]],
      [1, [[1, 2], 2473, 0.15, 0.25]],
      [8, [[1, 2], 121]],
      [1, [[1, 3], 2541, 0.18, 0.28]],
      [3, [9001, [1, 1], 0]],
      [3, [[1, 1], [1, 2], 0]],
      [3, [[1, 2], [1, 3], 0]],
      [6, [[2, 1], [[1, 1], [1, 2]], 2268, 3000]],
      [6, [[2, 2], [[1, 2], [1, 3]], 3645, 20]],
    ],
  ], session);

  const startFiletime = filetimeFromUnixMs(startMs);
  const state = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  const colony = state.coloniesByKey["40000002:140000238"];
  const ecuPin = colony.pins.find((pin) => pin.typeID === 2848);
  const processorPin = colony.pins.find((pin) => pin.typeID === 2473);
  const storagePin = colony.pins.find((pin) => pin.typeID === 2541);
  assert.ok(ecuPin);
  assert.ok(processorPin);
  assert.ok(storagePin);

  colony.currentSimTime = startFiletime;
  for (const pin of colony.pins) {
    pin.lastRunTime = startFiletime;
    pin.contents = {};
  }
  Object.assign(ecuPin, {
    cycleTime: Number(60n * SECOND_TICKS),
    programType: 2268,
    qtyPerCycle: 3000,
    state: 1,
    installTime: startFiletime,
    expiryTime: (BigInt(startFiletime) + 24n * 60n * 60n * SECOND_TICKS).toString(),
  });
  Object.assign(processorPin, {
    state: 0,
    schematicID: 121,
    hasReceivedInputs: false,
    receivedInputsLastCycle: false,
  });
  database.write(planetRuntimeStore.TABLE_NAME, "/", state, { force: true });

  const targetMs = startMs + 60_000 + (30 * 60_000) + 1_000;
  Date.now = () => targetMs;

  service.Handle_GetPlanetInfo([], session);

  const simulatedState = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  const simulatedColony = simulatedState.coloniesByKey["40000002:140000238"];
  const simulatedStorage = simulatedColony.pins.find((pin) => pin.typeID === 2541);
  const simulatedProcessor = simulatedColony.pins.find((pin) => pin.typeID === 2473);
  assert.equal(simulatedColony.currentSimTime, filetimeFromUnixMs(targetMs));
  assert.equal(simulatedStorage.contents["3645"], 20);
  assert.equal(simulatedProcessor.state, 1);

  service.Handle_GetPlanetInfo([], session);
  const idempotentState = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  const idempotentStorage = idempotentState
    .coloniesByKey["40000002:140000238"]
    .pins
    .find((pin) => pin.typeID === 2541);
  assert.equal(idempotentStorage.contents["3645"], 20);
});

test("planetMgr launches command center commodities and exposes launch details", (t) => {
  withRestoredPlanetRuntimeState(t);
  let physicalContainerID = 0;
  t.after(() => {
    if (physicalContainerID > 0) {
      spaceRuntime.removeDynamicEntity(30000001, physicalContainerID);
    }
  });
  withRestoredItemsState(t);
  withRestoredCharacterWallet(t, 140000238, 1000000);

  const originalDateNow = Date.now;
  const launchMs = Date.UTC(2026, 0, 1, 2, 0, 0);
  Date.now = () => launchMs;
  t.after(() => {
    Date.now = originalDateNow;
  });

  const service = new PlanetMgrService();
  const notifications = [];
  const session = {
    characterID: 140000238,
    sendNotification: (...args) => notifications.push(args),
  };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  service.Handle_UserUpdateNetwork([
    [
      [1, [9001, 2524, 0.1, 0.2]],
    ],
  ], session);

  const state = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  const colony = state.coloniesByKey["40000002:140000238"];
  const commandPin = colony.pins.find((pin) => pin.pinID === 9001);
  commandPin.contents = { "3645": 12 };
  database.write(planetRuntimeStore.TABLE_NAME, "/", state, { force: true });

  const lastLaunchTime = service.Handle_UserLaunchCommodities([
    9001,
    { 3645: 7 },
  ], session);
  assert.equal(lastLaunchTime, BigInt(filetimeFromUnixMs(launchMs)));
  assert.equal(walletState.getCharacterWallet(140000238).balance, 999580);
  const journal = walletState.getCharacterWalletJournal(140000238);
  assert.equal(journal[0].entryTypeID, walletState.JOURNAL_ENTRY_TYPE.PLANETARY_EXPORT_TAX);
  assert.equal(journal[0].amount, -420);
  assert.equal(journal[0].referenceID, 40000002);

  const updatedState = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  const updatedColony = updatedState.coloniesByKey["40000002:140000238"];
  const updatedCommandPin = updatedColony.pins.find((pin) => pin.pinID === 9001);
  assert.equal(updatedCommandPin.contents["3645"], 5);
  assert.equal(updatedCommandPin.lastLaunchTime, filetimeFromUnixMs(launchMs));

  const launches = listItems(service.Handle_GetMyLaunchesDetails([], session)).map(keyValObject);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].launchID, 910000000000);
  assert.notEqual(launches[0].itemID, launches[0].launchID);
  physicalContainerID = launches[0].itemID;
  assert.equal(launches[0].ownerID, 140000238);
  assert.equal(launches[0].planetID, 40000002);
  assert.equal(launches[0].solarSystemID, 30000001);
  assert.equal(launches[0].launchTime, BigInt(filetimeFromUnixMs(launchMs)));
  assert.equal(Number.isFinite(launches[0].x), true);
  assert.equal(Number.isFinite(launches[0].y), true);
  assert.equal(Number.isFinite(launches[0].z), true);

  const launchRecord = updatedState.launchesByID[String(launches[0].launchID)];
  assert.deepEqual(launchRecord.contents, { "3645": 7 });
  assert.equal(launchRecord.itemID, physicalContainerID);

  const physicalContainer = itemStore.findItemById(physicalContainerID);
  assert.ok(physicalContainer);
  assert.equal(physicalContainer.typeID, 2263);
  assert.equal(physicalContainer.locationID, 30000001);
  assert.equal(physicalContainer.flagID, 0);
  assert.equal(physicalContainer.expiresAtMs, launchMs + (5 * 24 * 60 * 60 * 1000));
  const physicalContents = itemStore.listContainerItems(
    140000238,
    physicalContainerID,
    itemStore.ITEM_FLAGS.HANGAR,
  );
  assert.equal(physicalContents.length, 1);
  assert.equal(physicalContents[0].typeID, 3645);
  assert.equal(physicalContents[0].stacksize, 7);
  assert.deepEqual(notifications.at(-2), [
    "OnRefreshPins",
    "clientID",
    [[9001]],
  ]);
  assert.deepEqual(notifications.at(-1), [
    "OnPILaunchesChange",
    "clientID",
    [],
  ]);

  assert.equal(service.Handle_DeleteLaunch([launches[0].launchID], session), true);
  assert.deepEqual(service.Handle_GetMyLaunchesDetails([], session), {
    type: "list",
    items: [],
  });
});

test("planetMgr performs expedited transfers and enforces source cooldown", (t) => {
  withRestoredPlanetRuntimeState(t);
  withRestoredCharacterWallet(t, 140000238, 10000000);

  const originalDateNow = Date.now;
  const startMs = Date.UTC(2026, 0, 1, 3, 0, 0);
  Date.now = () => startMs;
  t.after(() => {
    Date.now = originalDateNow;
  });

  const service = new PlanetMgrService();
  const notifications = [];
  const session = {
    characterID: 140000238,
    sendNotification: (...args) => notifications.push(args),
  };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  const colonyResult = keyValObject(service.Handle_UserUpdateNetwork([
    [
      [1, [9001, 2524, 0.1, 0.2]],
      [1, [[1, 1], 2541, 0.12, 0.22]],
      [3, [9001, [1, 1], 0]],
    ],
  ], session));
  const storageID = listItems(colonyResult.pins)
    .map(keyValObject)
    .find((pin) => pin.typeID === 2541)
    .id;

  const state = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  const colony = state.coloniesByKey["40000002:140000238"];
  const storagePin = colony.pins.find((pin) => pin.pinID === storageID);
  storagePin.contents = { "3645": 10 };
  storagePin.lastRunTime = filetimeFromUnixMs(startMs);
  database.write(planetRuntimeStore.TABLE_NAME, "/", state, { force: true });

  const [simTime, sourceRunTime] = service.Handle_UserTransferCommodities([
    [storageID, 9001],
    { 3645: 4 },
  ], session);
  assert.equal(simTime, BigInt(filetimeFromUnixMs(startMs)));
  assert.equal(
    sourceRunTime - simTime >= 300n * SECOND_TICKS,
    true,
  );

  const updatedState = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  const updatedColony = updatedState.coloniesByKey["40000002:140000238"];
  const updatedStorage = updatedColony.pins.find((pin) => pin.pinID === storageID);
  const updatedCommand = updatedColony.pins.find((pin) => pin.pinID === 9001);
  assert.equal(updatedStorage.contents["3645"], 6);
  assert.equal(updatedStorage.lastRunTime, sourceRunTime.toString());
  assert.equal(updatedCommand.contents["3645"], 4);
  assert.deepEqual(notifications.at(-1), [
    "OnRefreshPins",
    "clientID",
    [[storageID, 9001]],
  ]);

  assert.throws(
    () => service.Handle_UserTransferCommodities([
      [storageID, 9001],
      { 3645: 1 },
    ], session),
    (error) => getWrappedUserErrorMessage(error) === "RouteFailedValidationExpeditedSourceNotReady",
  );
});

test("planetMgr rejects command center launches when export tax cannot be paid", (t) => {
  withRestoredPlanetRuntimeState(t);
  withRestoredCharacterWallet(t, 140000238, 100);

  const service = new PlanetMgrService();
  const session = { characterID: 140000238 };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  service.Handle_UserUpdateNetwork([
    [
      [1, [9001, 2524, 0.1, 0.2]],
    ],
  ], session);

  const state = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  const colony = state.coloniesByKey["40000002:140000238"];
  const commandPin = colony.pins.find((pin) => pin.pinID === 9001);
  commandPin.contents = { "3645": 12 };
  database.write(planetRuntimeStore.TABLE_NAME, "/", state, { force: true });

  assert.throws(
    () => service.Handle_UserLaunchCommodities([
      9001,
      { 3645: 7 },
    ], session),
    (error) => getWrappedUserErrorMessage(error) === "NotEnoughMoney",
  );

  const updatedState = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  const updatedColony = updatedState.coloniesByKey["40000002:140000238"];
  const updatedCommandPin = updatedColony.pins.find((pin) => pin.pinID === 9001);
  assert.equal(updatedCommandPin.contents["3645"], 12);
  assert.deepEqual(updatedState.launchesByID, {});
  assert.equal(walletState.getCharacterWallet(140000238).balance, 100);
  assert.equal(walletState.getCharacterWalletJournal(140000238).length, 0);
});

test("invbroker ImportExportWithPlanet moves launchpad commodities and journals taxes", (t) => {
  withRestoredPlanetRuntimeState(t);
  withRestoredItemsState(t);
  withRestoredCharacterWallet(t, 140000238, 5000000);

  const planetMgr = new PlanetMgrService();
  const planetSession = { characterID: 140000238 };
  const bindResult = planetMgr.Handle_MachoBindObject([40000002, null], planetSession);
  planetSession.currentBoundObjectID = bindResult[0].value.value[0];

  const colonyResult = keyValObject(planetMgr.Handle_UserUpdateNetwork([
    [
      [1, [9001, 2524, 0.1, 0.2]],
      [9, [9001, 2]],
      [1, [[1, 1], 2256, 0.15, 0.25]],
    ],
  ], planetSession));
  const launchpadID = listItems(colonyResult.pins)
    .map(keyValObject)
    .find((pin) => pin.typeID === 2256)
    .id;

  const state = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  const colony = state.coloniesByKey["40000002:140000238"];
  const launchpad = colony.pins.find((pin) => pin.pinID === launchpadID);
  launchpad.contents = { "3645": 12 };
  database.write(planetRuntimeStore.TABLE_NAME, "/", state, { force: true });

  const customsOfficeID = 990900001;
  const customsGrant = itemStore.grantItemToCharacterLocation(
    140000238,
    customsOfficeID,
    itemStore.ITEM_FLAGS.HANGAR,
    3645,
    5,
  );
  assert.equal(customsGrant.success, true);
  const importItemID = customsGrant.data.items[0].itemID;

  const notifications = [];
  const invBroker = new InvBrokerService();
  const invSession = {
    characterID: 140000238,
    sendNotification: (...args) => notifications.push(args),
  };
  const customsInventory = invBroker.Handle_GetInventoryFromId([customsOfficeID], invSession);
  invSession.currentBoundObjectID = customsInventory.value.value[0];

  assert.equal(invBroker.Handle_ImportExportWithPlanet([
    launchpadID,
    { [importItemID]: 5 },
    { 3645: 7 },
    0.05,
  ], invSession), null);

  const updatedState = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  const updatedLaunchpad = updatedState
    .coloniesByKey["40000002:140000238"]
    .pins
    .find((pin) => pin.pinID === launchpadID);
  assert.equal(updatedLaunchpad.contents["3645"], 10);

  const customsItems = itemStore.listContainerItems(
    140000238,
    customsOfficeID,
    itemStore.ITEM_FLAGS.HANGAR,
  );
  const customsWater = customsItems
    .filter((item) => item.typeID === 3645)
    .reduce((sum, item) => sum + item.stacksize, 0);
  assert.equal(customsWater, 7);

  const wallet = walletState.getCharacterWallet(140000238);
  assert.equal(wallet.balance, 2589810);
  const journal = walletState.getCharacterWalletJournal(140000238);
  assert.equal(journal[0].entryTypeID, walletState.JOURNAL_ENTRY_TYPE.PLANETARY_EXPORT_TAX);
  assert.equal(journal[0].amount, -140);
  assert.equal(journal[1].entryTypeID, walletState.JOURNAL_ENTRY_TYPE.PLANETARY_IMPORT_TAX);
  assert.equal(journal[1].amount, -50);
  assert.deepEqual(notifications.at(-1), [
    "OnMajorPlanetStateUpdate",
    "clientID",
    [40000002, false],
  ]);
  assert.deepEqual(notifications.at(-2), [
    "OnRefreshPins",
    "clientID",
    [[launchpadID]],
  ]);
});

test("invbroker ImportExportWithPlanet rejects stale customs tax rates", (t) => {
  withRestoredPlanetRuntimeState(t);
  withRestoredItemsState(t);
  withRestoredCharacterWallet(t, 140000238, 5000000);

  const planetMgr = new PlanetMgrService();
  const planetSession = { characterID: 140000238 };
  const bindResult = planetMgr.Handle_MachoBindObject([40000002, null], planetSession);
  planetSession.currentBoundObjectID = bindResult[0].value.value[0];

  const colonyResult = keyValObject(planetMgr.Handle_UserUpdateNetwork([
    [
      [1, [9001, 2524, 0.1, 0.2]],
      [9, [9001, 2]],
      [1, [[1, 1], 2256, 0.15, 0.25]],
    ],
  ], planetSession));
  const launchpadID = listItems(colonyResult.pins)
    .map(keyValObject)
    .find((pin) => pin.typeID === 2256)
    .id;

  const customsOfficeID = 990900002;
  const invBroker = new InvBrokerService();
  const invSession = { characterID: 140000238 };
  const customsInventory = invBroker.Handle_GetInventoryFromId([customsOfficeID], invSession);
  invSession.currentBoundObjectID = customsInventory.value.value[0];

  assert.throws(
    () => invBroker.Handle_ImportExportWithPlanet([
      launchpadID,
      {},
      { 3645: 1 },
      0.1,
    ], invSession),
    (error) => getWrappedUserErrorMessage(error) === "TaxChanged",
  );

  assert.equal(walletState.getCharacterWallet(140000238).balance, 2590000);
  assert.equal(walletState.getCharacterWalletJournal(140000238).length, 1);
});

test("planetMgr rejects PI edits that exceed command center CPU before wallet debit", (t) => {
  withRestoredPlanetRuntimeState(t);
  withRestoredCharacterWallet(t, 140000238, 5000000);

  const service = new PlanetMgrService();
  const session = { characterID: 140000238 };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  assert.throws(
    () => service.Handle_UserUpdateNetwork([
      [
        [1, [9001, 2524, 0.1, 0.2]],
        [1, [[1, 1], 2481, 0.12, 0.22]],
        [1, [[1, 2], 2481, 0.13, 0.23]],
        [1, [[1, 3], 2481, 0.14, 0.24]],
        [1, [[1, 4], 2481, 0.15, 0.25]],
        [1, [[1, 5], 2481, 0.16, 0.26]],
        [1, [[1, 6], 2481, 0.17, 0.27]],
        [1, [[1, 7], 2481, 0.18, 0.28]],
        [1, [[1, 8], 2481, 0.19, 0.29]],
        [1, [[1, 9], 2481, 0.2, 0.3]],
      ],
    ], session),
    (error) => getWrappedUserErrorMessage(error) === "CannotAddToColonyCPUUsageExceeded",
  );

  const state = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  assert.equal(state.coloniesByKey["40000002:140000238"], undefined);
  assert.equal(walletState.getCharacterWallet(140000238).balance, 5000000);
  assert.equal(walletState.getCharacterWalletJournal(140000238).length, 0);
});

test("planetMgr rejects PI routes with too many waypoints before wallet debit", (t) => {
  withRestoredPlanetRuntimeState(t);
  withRestoredCharacterWallet(t, 140000238, 5000000);

  const service = new PlanetMgrService();
  const session = { characterID: 140000238 };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  assert.throws(
    () => service.Handle_UserUpdateNetwork([
      [
        [1, [9001, 2524, 0.1, 0.2]],
        [1, [[1, 1], 2541, 0.11, 0.21]],
        [1, [[1, 2], 2541, 0.12, 0.22]],
        [1, [[1, 3], 2541, 0.13, 0.23]],
        [1, [[1, 4], 2541, 0.14, 0.24]],
        [1, [[1, 5], 2541, 0.15, 0.25]],
        [1, [[1, 6], 2541, 0.16, 0.26]],
        [1, [[1, 7], 2541, 0.17, 0.27]],
        [6, [[2, 1], [9001, [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7]], 3645, 1]],
      ],
    ], session),
    (error) => getWrappedUserErrorMessage(error) === "CannotRouteTooManyWaypoints",
  );

  const state = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  assert.equal(state.coloniesByKey["40000002:140000238"], undefined);
  assert.equal(walletState.getCharacterWallet(140000238).balance, 5000000);
  assert.equal(walletState.getCharacterWalletJournal(140000238).length, 0);
});

test("planetOrbitalRegistryBroker returns a default accessible tax rate", () => {
  const service = new PlanetOrbitalRegistryBrokerService();

  assert.equal(service.Handle_GetTaxRate([123456789]), 0.05);
  assert.equal(service.Handle_RevertOrbitalsToInterBus([]), null);
});

test("planetMgr Phase 6 diagnostics, GM sync, and launch cleanup stay stable", (t) => {
  withRestoredPlanetRuntimeState(t);
  let physicalContainerID = 0;
  t.after(() => {
    if (physicalContainerID > 0) {
      spaceRuntime.removeDynamicEntity(30000001, physicalContainerID);
    }
  });
  withRestoredItemsState(t);
  withRestoredCharacterWallet(t);

  const originalDateNow = Date.now;
  const launchMs = Date.UTC(2026, 0, 2, 0, 0, 0);
  Date.now = () => launchMs;
  t.after(() => {
    Date.now = originalDateNow;
  });

  const service = new PlanetMgrService();
  const notifications = [];
  const session = {
    characterID: 140000238,
    sendNotification: (...args) => notifications.push(args),
  };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  service.Handle_GetPlanetResourceInfo([], session);
  service.Handle_UserUpdateNetwork([
    [
      [1, [9001, 2524, 0.1, 0.2]],
    ],
  ], session);

  const addResult = unwrapMarshalValue(service.Handle_GMAddCommodity([
    9001,
    3645,
    9,
  ], session));
  assert.equal(addResult.success, true);
  assert.equal(addResult.added, 9);

  service.Handle_UserLaunchCommodities([
    9001,
    { 3645: 4 },
  ], session);
  const launchState = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  physicalContainerID = Object.values(launchState.launchesByID || {})[0].itemID;

  const diagnostics = unwrapMarshalValue(
    service.Handle_GMGetPlanetDiagnostics([40000002], session),
  );
  assert.equal(diagnostics.planetID, 40000002);
  assert.equal(diagnostics.ownerID, 140000238);
  assert.equal(diagnostics.colonyCount, 1);
  assert.equal(diagnostics.colonies[0].pinCount, 1);
  assert.equal(diagnostics.launches.active, 1);
  assert.equal(diagnostics.resources.resourceTypeIDs.includes(2268), true);

  const localReport = unwrapMarshalValue(
    service.Handle_GMGetLocalDistributionReport([40000002, [0.1, 0.2]], session),
  );
  assert.equal(localReport.planetID, 40000002);
  assert.equal(Number(localReport.resources["2268"]) > 0, true);

  const completeResource = keyValEntries(
    service.Handle_GMGetCompleteResource([2268, "base"], session),
  );
  assert.equal(completeResource.get("numBands"), 30);
  assert.equal(completeResource.get("data").value.length, 30 * 30 * 4);

  const [simulationDuration, remoteColonyData] =
    service.Handle_GMGetSynchedServerState([140000238], session);
  assert.equal(typeof simulationDuration, "bigint");
  assert.equal(keyValObject(remoteColonyData).ownerID, 140000238);

  Date.now = () => launchMs + (40 * 24 * 60 * 60 * 1000);
  const cleanup = unwrapMarshalValue(
    service.Handle_GMCleanupExpiredLaunches([35], session),
  );
  assert.equal(cleanup.scanned, 1);
  assert.equal(cleanup.deleted, 1);
  assert.deepEqual(service.Handle_GetMyLaunchesDetails([], session), {
    type: "list",
    items: [],
  });
  assert.deepEqual(notifications.at(-1), [
    "OnPILaunchesChange",
    "clientID",
    [],
  ]);
});

test("planetMgr estimates ECU program results and abandons persistent colonies", (t) => {
  withRestoredPlanetRuntimeState(t);
  withRestoredCharacterWallet(t);

  const service = new PlanetMgrService();
  const notifications = [];
  const session = {
    characterID: 140000238,
    sendNotification: (...args) => notifications.push(args),
  };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  const programResult = service.Handle_GetProgramResultInfo([
    [1, 1],
    2268,
    [[0, 0.1, 0.2], [1, 0.12, 0.22]],
    0.03,
  ], session);
  assert.equal(programResult.length, 3);
  assert.equal(programResult[0] > 0, true);
  assert.equal(programResult[1] > 0, true);
  assert.equal(programResult[2] > 0, true);

  service.Handle_UserUpdateNetwork([
    [
      [1, [9001, 2524, 0.1, 0.2]],
      [9, [9001, 1]],
    ],
  ], session);
  assert.equal(service.Handle_UserAbandonPlanet([], session), true);

  const state = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  assert.equal(state.coloniesByKey["40000002:140000238"], undefined);
  assert.deepEqual(service.Handle_GetPlanetsForChar([], session), {
    type: "list",
    items: [],
  });
  assert.deepEqual(notifications.at(-1), [
    "OnMajorPlanetStateUpdate",
    "clientID",
    [40000002, true],
  ]);
});
