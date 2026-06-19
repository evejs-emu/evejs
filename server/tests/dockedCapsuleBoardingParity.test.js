const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const CharacterState = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const ShipService = require(path.join(
  repoRoot,
  "server/src/services/ship/shipService",
));
const transitions = require(path.join(
  repoRoot,
  "server/src/space/transitions",
));
const {
  ensureCapsuleForCharacter,
  setActiveShipForCharacter,
  findItemById,
  getCharacterShipItems,
  CAPSULE_TYPE_ID,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));

const {
  getCharacterRecord,
  getActiveShipRecord,
  applyCharacterToSession,
  activateShipForSession,
  spawnShipInHangarForSession,
} = CharacterState;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildDockedSession(userID, characterID) {
  return {
    userid: userID,
    clientID: userID + 9000000,
    characterID,
    notifications: [],
    events: [],
    sendNotification(name, idType, payload) {
      const entry = { name, idType, payload };
      this.notifications.push(entry);
      this.events.push({ kind: "notification", ...entry });
    },
    sendSessionChange(changes, options) {
      this.events.push({ kind: "sessionChange", changes, options });
    },
  };
}

function readOnItemChangeFields(notification) {
  const payload = notification && Array.isArray(notification.payload)
    ? notification.payload
    : null;
  const row = Array.isArray(payload) ? payload[0] : null;
  return row && row.fields && typeof row.fields === "object"
    ? row.fields
    : null;
}

function readOnItemChangeEntries(notification) {
  const payload = notification && Array.isArray(notification.payload)
    ? notification.payload
    : null;
  const diff = Array.isArray(payload) ? payload[1] : null;
  return diff && diff.type === "dict" && Array.isArray(diff.entries)
    ? diff.entries
    : [];
}

function snapshotMutableTables(t) {
  const originalAccounts = cloneValue(database.read("accounts", "/").data || {});
  const originalCharacters = cloneValue(database.read("characters", "/").data || {});
  const originalIdentityState = cloneValue(database.read("identityState", "/").data || {});
  const originalItems = cloneValue(database.read("items", "/").data || {});
  const originalSkills = cloneValue(database.read("skills", "/").data || {});

  t.after(() => {
    database.write("accounts", "/", originalAccounts, { force: true });
    database.write("characters", "/", originalCharacters, { force: true });
    database.write("identityState", "/", originalIdentityState, { force: true });
    database.write("items", "/", originalItems, { force: true });
    database.write("skills", "/", originalSkills, { force: true });
    database.flushAllSync();
  });
}

test("boarding a docked ship from a capsule consumes the previous capsule item", async (t) => {
  snapshotMutableTables(t);

  const service = new CharService();
  const charID = service.Handle_CreateCharacterWithDoll(
    ["Daren Voss", 5, 1, 1, null, null, 11],
    { userid: 910001 },
  );
  const characterRecord = getCharacterRecord(charID);
  assert.ok(characterRecord, "expected the new character to exist");

  const capsuleResult = ensureCapsuleForCharacter(charID, characterRecord.stationID);
  assert.equal(capsuleResult.success, true);
  const capsule = capsuleResult.data;
  assert.ok(capsule, "expected a capsule hull");

  const setActiveResult = setActiveShipForCharacter(charID, capsule.itemID);
  assert.equal(setActiveResult.success, true);

  const session = buildDockedSession(910001, charID);
  const applyResult = applyCharacterToSession(session, charID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const spawnResult = spawnShipInHangarForSession(session, 588);
  assert.equal(spawnResult.success, true);
  assert.ok(spawnResult.ship, "expected a boardable ship in hangar");

  const activationResult = activateShipForSession(session, spawnResult.ship.itemID, {
    emitNotifications: true,
    logSelection: false,
  });
  assert.equal(activationResult.success, true);
  assert.equal(
    Number(getActiveShipRecord(charID).itemID),
    Number(spawnResult.ship.itemID),
    "expected the boarded ship to become active",
  );
  assert.equal(
    findItemById(capsule.itemID),
    null,
    "expected the previous docked capsule to be removed",
  );

  const remainingShipIDs = new Set(
    getCharacterShipItems(charID).map((item) => Number(item.itemID) || 0),
  );
  assert.equal(
    remainingShipIDs.has(Number(capsule.itemID)),
    false,
    "expected the removed capsule to stay out of the character ship inventory",
  );
});

test("boarding a docked ship from another ship still keeps the previous hull in hangar", async (t) => {
  snapshotMutableTables(t);

  const service = new CharService();
  const charID = service.Handle_CreateCharacterWithDoll(
    ["Toran Hale", 5, 1, 1, null, null, 11],
    { userid: 910002 },
  );
  const originalActiveShip = getActiveShipRecord(charID);
  assert.ok(originalActiveShip, "expected a starter active ship");

  const session = buildDockedSession(910002, charID);
  const applyResult = applyCharacterToSession(session, charID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const spawnResult = spawnShipInHangarForSession(session, 589);
  assert.equal(spawnResult.success, true);
  assert.ok(spawnResult.ship, "expected a second ship in hangar");

  const activationResult = activateShipForSession(session, spawnResult.ship.itemID, {
    emitNotifications: true,
    logSelection: false,
  });
  assert.equal(activationResult.success, true);
  assert.equal(
    Number(getActiveShipRecord(charID).itemID),
    Number(spawnResult.ship.itemID),
    "expected the newly boarded ship to become active",
  );
  assert.ok(
    findItemById(originalActiveShip.itemID),
    "expected the previous non-capsule hull to remain in hangar",
  );

  const boardedShipInventoryRefreshIndex = session.events.findIndex((entry) => (
    entry &&
    entry.kind === "notification" &&
    entry.name === "OnItemChange" &&
    Number(readOnItemChangeFields(entry) && readOnItemChangeFields(entry).itemID) ===
      Number(spawnResult.ship.itemID) &&
    readOnItemChangeEntries(entry).length > 0
  ));
  assert.ok(
    boardedShipInventoryRefreshIndex >= 0,
    "expected docked boarding to seed the target hull into invCache before the ship swap",
  );

  const shipChangeIndex = session.events.findIndex((entry) => (
    entry &&
    entry.kind === "sessionChange"
  ));
  assert.ok(
    shipChangeIndex >= 0,
    "expected docked boarding to emit a shipid session change",
  );
  assert.ok(
    boardedShipInventoryRefreshIndex < shipChangeIndex,
    "expected the target hull inventory sync to arrive before the docked shipid swap",
  );
});

test("docked leave-ship seeds a new capsule before the ship swap and dirties the active hull for hangar refresh", async (t) => {
  snapshotMutableTables(t);

  const service = new CharService();
  const shipService = new ShipService();
  const charID = service.Handle_CreateCharacterWithDoll(
    ["Marek Soll", 5, 1, 1, null, null, 11],
    { userid: 910003 },
  );
  const originalActiveShip = getActiveShipRecord(charID);
  assert.ok(originalActiveShip, "expected a starter active ship");
  assert.notEqual(
    Number(originalActiveShip.typeID),
    670,
    "expected the starter active ship not to already be a capsule",
  );

  const session = buildDockedSession(910003, charID);
  const applyResult = applyCharacterToSession(session, charID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const capsuleID = shipService.Handle_LeaveShip([originalActiveShip.itemID], session);
  assert.ok(capsuleID, "expected LeaveShip to return the activated capsule");

  const activeShip = getActiveShipRecord(charID);
  assert.ok(activeShip, "expected an active ship after leaving the hull");
  assert.equal(Number(activeShip.itemID), Number(capsuleID));
  assert.equal(Number(activeShip.typeID), 670, "expected the active ship to be a capsule");
  assert.ok(
    findItemById(originalActiveShip.itemID),
    "expected the abandoned docked hull to remain in hangar",
  );
  assert.ok(findItemById(capsuleID), "expected the new docked capsule to exist");

  const capsuleInventoryRefresh = session.notifications.find((entry) => {
    if (entry.name !== "OnItemChange") {
      return false;
    }
    const fields = readOnItemChangeFields(entry);
    const entries = readOnItemChangeEntries(entry);
    return (
      Number(fields && fields.itemID) === Number(capsuleID) &&
      entries.length > 0
    );
  });
  assert.ok(
    capsuleInventoryRefresh,
    "expected leave-ship to emit a non-noop capsule inventory sync so the hangar can materialize the new pod immediately",
  );

  const capsuleInventoryRefreshIndex = session.events.findIndex((entry) => (
    entry &&
    entry.kind === "notification" &&
    entry.name === "OnItemChange" &&
    Number(readOnItemChangeFields(entry) && readOnItemChangeFields(entry).itemID) === Number(capsuleID) &&
    readOnItemChangeEntries(entry).length > 0
  ));
  assert.ok(
    capsuleInventoryRefreshIndex >= 0,
    "expected the capsule inventory sync to be recorded in the session event stream",
  );

  const shipChangeIndex = session.events.findIndex((entry) => (
    entry &&
    entry.kind === "sessionChange"
  ));
  assert.ok(
    shipChangeIndex >= 0,
    "expected leave-ship to emit a shipid session change",
  );
  assert.ok(
    capsuleInventoryRefreshIndex < shipChangeIndex,
    "expected a lazily created docked capsule to be known to the hangar before the shipid swap lands",
  );

  const firstDirtTimestamp = shipService.Handle_GetDirtTimestamp([capsuleID], session);
  assert.ok(firstDirtTimestamp, "expected the capsule to be marked dirty for hangar rematerialization");
  assert.equal(
    shipService.Handle_GetDirtTimestamp([capsuleID], session),
    0n,
    "expected the dirt timestamp to be one-shot once the hangar consumes it",
  );
});

test("pod respawn dock rebuild does not replay a consumed transitional capsule into the hangar", async (t) => {
  snapshotMutableTables(t);

  const service = new CharService();
  const charID = service.Handle_CreateCharacterWithDoll(
    ["Sorin Vale", 5, 1, 1, null, null, 11],
    { userid: 910004 },
  );
  const characterRecord = getCharacterRecord(charID);
  assert.ok(characterRecord, "expected the new character to exist");

  const session = buildDockedSession(910004, charID);
  session.homeStationID = characterRecord.stationID;
  session.homestationid = characterRecord.stationID;
  session.cloneStationID = characterRecord.stationID;
  session.clonestationid = characterRecord.stationID;

  const rebuildResult = transitions.rebuildDockedSessionAtStation(
    session,
    characterRecord.stationID,
    {
      emitNotifications: true,
      logSelection: false,
      boardNewbieShip: true,
      newbieShipLogLabel: "DockedCapsuleParityTest",
    },
  );
  assert.equal(rebuildResult.success, true);
  assert.equal(
    rebuildResult.data && rebuildResult.data.capsule,
    null,
    "expected the transient respawn capsule to be consumed once the corvette boards",
  );

  const activeShip = getActiveShipRecord(charID);
  assert.ok(activeShip, "expected an active ship after dock rebuild");
  assert.notEqual(
    Number(activeShip.typeID),
    CAPSULE_TYPE_ID,
    "expected the dock rebuild to leave the character in a non-capsule rookie ship",
  );

  const remainingCapsules = getCharacterShipItems(charID).filter(
    (item) => Number(item && item.typeID) === CAPSULE_TYPE_ID,
  );
  assert.equal(
    remainingCapsules.length,
    0,
    "expected no docked capsule inventory rows to remain after the auto-board step",
  );

  const staleCapsuleRows = session.notifications
    .filter((entry) => entry && entry.name === "OnItemChange")
    .map((entry) => readOnItemChangeFields(entry))
    .filter((fields) => (
      fields &&
      Number(fields.typeID) === CAPSULE_TYPE_ID &&
      Number(fields.locationID) === Number(characterRecord.stationID)
    ));
  assert.equal(
    staleCapsuleRows.length,
    0,
    "expected the client hangar stream not to replay a consumed capsule row back into station inventory",
  );
});
