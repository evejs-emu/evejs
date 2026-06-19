const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const ShipService = require(path.join(
  repoRoot,
  "server/src/services/ship/shipService",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildSpaceState(systemID) {
  return {
    systemID,
    position: { x: 1250, y: -500, z: 250 },
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: 1 },
    speedFraction: 0,
    mode: "STOP",
  };
}

function promoteActiveShipToSpace(originalItems, activeShip, solarSystemID) {
  const updatedItems = cloneValue(originalItems);
  updatedItems[String(activeShip.itemID)] = {
    ...updatedItems[String(activeShip.itemID)],
    locationID: solarSystemID,
    flagID: 0,
    spaceState: buildSpaceState(solarSystemID),
  };
  database.write("items", "/", updatedItems);
}

function buildSpaceSession(characterID, characterRecord, activeShip) {
  const solarSystemID =
    Number(
      characterRecord.solarSystemID ||
        (activeShip.spaceState && activeShip.spaceState.systemID) ||
        30000142,
    ) || 30000142;
  const notifications = [];

  return {
    session: {
      userid: 1,
      characterID,
      charid: characterID,
      characterName: characterRecord.characterName || `char-${characterID}`,
      corporationID: Number(characterRecord.corporationID || 0),
      corpid: Number(characterRecord.corporationID || 0),
      allianceID: Number(characterRecord.allianceID || 0) || null,
      allianceid: Number(characterRecord.allianceID || 0) || null,
      shipID: activeShip.itemID,
      shipid: activeShip.itemID,
      activeShipID: activeShip.itemID,
      stationID: null,
      stationid: null,
      stationid2: null,
      structureID: null,
      structureid: null,
      solarsystemid: solarSystemID,
      solarsystemid2: solarSystemID,
      constellationID: Number(characterRecord.constellationID || 20000020),
      constellationid: Number(characterRecord.constellationID || 20000020),
      regionID: Number(characterRecord.regionID || 10000002),
      regionid: Number(characterRecord.regionID || 10000002),
      locationid: solarSystemID,
      worldspaceid: null,
      clientID: 91001,
      socket: {
        destroyed: false,
      },
      _space: {
        systemID: solarSystemID,
        shipID: activeShip.itemID,
        simTimeMs: Date.now(),
        simFileTime: 0n,
        timeDilation: 1,
      },
      sendSessionChange() {},
      sendNotification(name, idType, payload) {
        notifications.push({ name, idType, payload });
      },
    },
    notifications,
    solarSystemID,
  };
}

test("ship SafeLogoff returns an empty failure list and clears the in-space session after the response flushes", (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);

  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  });

  const characterID = Object.keys(originalCharacters || {})
    .map((value) => Number(value))
    .find((value) => Number.isInteger(value) && value > 0 && getActiveShipRecord(value));
  assert.ok(characterID, "expected a seeded character with an active ship");

  const characterRecord = getCharacterRecord(characterID);
  const activeShip = getActiveShipRecord(characterID);
  assert.ok(characterRecord, "expected character record to exist");
  assert.ok(activeShip, "expected active ship record to exist");

  const solarSystemID =
    Number(
      characterRecord.solarSystemID ||
        (activeShip.spaceState && activeShip.spaceState.systemID) ||
        30000142,
    ) || 30000142;
  promoteActiveShipToSpace(originalItems, activeShip, solarSystemID);
  const spaceActiveShip = getActiveShipRecord(characterID);
  const { session, notifications } = buildSpaceSession(
    characterID,
    characterRecord,
    spaceActiveShip,
  );

  const service = new ShipService();
  const response = service.Handle_SafeLogoff([], session);
  assert.deepEqual(response, []);

  service.afterCallResponse("SafeLogoff", session, {
    args: [],
    kwargs: null,
    result: response,
  });

  assert.equal(notifications.length, 2);
  assert.equal(notifications[0].name, "OnSafeLogoffTimerStarted");
  assert.equal(notifications[0].idType, "clientID");
  assert.equal(notifications[0].payload.length, 1);
  assert.equal(typeof notifications[0].payload[0], "bigint");
  assert.equal(notifications[1].name, "OnSafeLogoffActivated");
  assert.equal(notifications[1].idType, "clientID");
  assert.deepEqual(notifications[1].payload, []);
  assert.equal(session.characterID, 0);
  assert.equal(session.charid, null);
  assert.equal(session.shipID, null);
  assert.equal(session.shipid, null);
  assert.equal(session._space, null);
  const persistedCharacter = getCharacterRecord(characterID);
  assert.ok(persistedCharacter, "expected character record to remain persisted");
  assert.equal(persistedCharacter.stationID, null);
  assert.equal(Number(persistedCharacter.solarSystemID), solarSystemID);
});

test("ship MachoBindObject SafeLogoff returns an empty failure list for the stock client precheck path", (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);

  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  });

  const characterID = Object.keys(originalCharacters || {})
    .map((value) => Number(value))
    .find((value) => Number.isInteger(value) && value > 0 && getActiveShipRecord(value));
  assert.ok(characterID, "expected a seeded character with an active ship");

  const characterRecord = getCharacterRecord(characterID);
  const activeShip = getActiveShipRecord(characterID);
  assert.ok(characterRecord, "expected character record to exist");
  assert.ok(activeShip, "expected active ship record to exist");

  const solarSystemID =
    Number(
      characterRecord.solarSystemID ||
        (activeShip.spaceState && activeShip.spaceState.systemID) ||
        30000142,
    ) || 30000142;
  promoteActiveShipToSpace(originalItems, activeShip, solarSystemID);
  const spaceActiveShip = getActiveShipRecord(characterID);
  const { session, notifications } = buildSpaceSession(
    characterID,
    characterRecord,
    spaceActiveShip,
  );

  const service = new ShipService();
  const bindResult = service.Handle_MachoBindObject([
    [session.solarsystemid, 5],
    ["SafeLogoff", [], {}],
  ], session);
  assert.ok(Array.isArray(bindResult), "expected MachoBindObject to return a tuple");
  assert.deepEqual(bindResult[1], []);

  service.afterCallResponse("MachoBindObject", session, {
    args: [[session.solarsystemid, 5], ["SafeLogoff", [], {}]],
    kwargs: null,
    result: bindResult,
  });

  assert.equal(notifications.length, 2);
  assert.equal(notifications[0].name, "OnSafeLogoffTimerStarted");
  assert.equal(notifications[1].name, "OnSafeLogoffActivated");
  assert.equal(session.characterID, 0);
  assert.equal(session._space, null);
});
