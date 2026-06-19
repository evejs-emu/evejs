const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  HomeStationService,
} = require(path.join(
  repoRoot,
  "server/src/services/character/homeStationService",
));
const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  isMachoWrappedException,
} = require(path.join(repoRoot, "server/src/common/machoErrors"));

const TEST_CHARACTER_ID = 140000004;
const REMOTE_OFFICE_STATION_ID = 60000610;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readKeyValField(keyVal, key, fallback = undefined) {
  if (
    !keyVal ||
    keyVal.type !== "object" ||
    !keyVal.args ||
    keyVal.args.type !== "dict" ||
    !Array.isArray(keyVal.args.entries)
  ) {
    return fallback;
  }
  const entry = keyVal.args.entries.find((pair) => Array.isArray(pair) && pair[0] === key);
  return entry ? entry[1] : fallback;
}

function buildSession(record, characterID = TEST_CHARACTER_ID) {
  const notifications = [];
  const sessionChanges = [];
  return {
    characterID,
    charid: characterID,
    corporationID: record.corporationID,
    corpid: record.corporationID,
    schoolID: record.schoolID,
    schoolid: record.schoolID,
    stationID: record.stationID,
    stationid: record.stationID,
    homeStationID: record.homeStationID,
    homestationid: record.homeStationID,
    cloneStationID: record.cloneStationID,
    clonestationid: record.cloneStationID,
    notifications,
    sessionChanges,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange(changes, options = {}) {
      sessionChanges.push({ changes, options });
    },
  };
}

test("home_station candidate query returns iterable station rows for the stock page controller", () => {
  const record = getCharacterRecord(TEST_CHARACTER_ID);
  assert.ok(record, "expected the test character to exist");

  const service = new HomeStationService();
  const session = buildSession(record, TEST_CHARACTER_ID);
  const candidates = service.Handle_get_home_station_candidates([], session);

  assert.ok(Array.isArray(candidates), "expected an iterable candidate list");
  assert.ok(candidates.length >= 2, "expected current station plus at least one remote office option");

  const candidateIDs = candidates.map((candidate) => Number(readKeyValField(candidate, "id", 0)) || 0);
  assert.ok(
    candidateIDs.includes(Number(record.stationID || 0)),
    "expected the currently docked station to be offered as a home-station candidate",
  );
  assert.ok(
    candidateIDs.includes(REMOTE_OFFICE_STATION_ID),
    "expected the corporation office station to be offered as a remote home-station candidate",
  );

  const currentHomeCandidate = candidates.find(
    (candidate) => Number(readKeyValField(candidate, "id", 0)) === Number(record.homeStationID || 0),
  );
  assert.ok(currentHomeCandidate, "expected the current home station to remain listed");
  assert.deepEqual(
    readKeyValField(currentHomeCandidate, "errors", []),
    [2],
    "expected the already-home station candidate to be disabled with the stock validation code",
  );
});

test("home_station remote changes require explicit allowRemote and update persisted/session state when approved", () => {
  const originalRecord = cloneValue(getCharacterRecord(TEST_CHARACTER_ID));
  assert.ok(originalRecord, "expected the test character to exist");

  try {
    const service = new HomeStationService();
    const rejectSession = buildSession(getCharacterRecord(TEST_CHARACTER_ID), TEST_CHARACTER_ID);

    assert.throws(() => {
      service.Handle_set_home_station([REMOTE_OFFICE_STATION_ID, false], rejectSession);
    }, (error) => {
      assert.equal(isMachoWrappedException(error), true);
      assert.equal(
        error.machoErrorResponse.payload.header[0].value,
        "homestation.error.RemoteChangeNotExpectedError",
      );
      return true;
    });

    const applySession = buildSession(getCharacterRecord(TEST_CHARACTER_ID), TEST_CHARACTER_ID);
    const result = service.Handle_set_home_station([REMOTE_OFFICE_STATION_ID, true], applySession);
    assert.equal(result, null);

    const updatedRecord = getCharacterRecord(TEST_CHARACTER_ID);
    assert.equal(updatedRecord.homeStationID, REMOTE_OFFICE_STATION_ID);
    assert.equal(updatedRecord.cloneStationID, REMOTE_OFFICE_STATION_ID);
    assert.equal(applySession.homeStationID, REMOTE_OFFICE_STATION_ID);
    assert.equal(applySession.cloneStationID, REMOTE_OFFICE_STATION_ID);
    assert.equal(
      applySession.notifications.some((notification) => (
        notification.name === "OnHomeStationChanged" &&
        Array.isArray(notification.payload) &&
        Number(notification.payload[0]) === REMOTE_OFFICE_STATION_ID
      )),
      true,
      "expected the live session to receive the home-station change notification",
    );
    assert.equal(
      applySession.sessionChanges.some((entry) => (
        entry &&
        entry.changes &&
        entry.changes.homestationid &&
        Number(entry.changes.homestationid[1]) === REMOTE_OFFICE_STATION_ID &&
        entry.changes.clonestationid &&
        Number(entry.changes.clonestationid[1]) === REMOTE_OFFICE_STATION_ID
      )),
      true,
      "expected the live session to receive the updated home/clone station session delta",
    );
    const homeStationSessionChange = applySession.sessionChanges.find((entry) => (
      entry &&
      entry.changes &&
      entry.changes.homestationid &&
      Number(entry.changes.homestationid[1]) === REMOTE_OFFICE_STATION_ID
    ));
    assert.ok(homeStationSessionChange, "expected the home-station session change entry to exist");
    assert.equal(
      Object.prototype.hasOwnProperty.call(homeStationSessionChange.options || {}, "sessionId"),
      false,
      "expected remote home-station changes to use the session's normal sid instead of forcing sid=0",
    );
  } finally {
    const restoreResult = updateCharacterRecord(TEST_CHARACTER_ID, originalRecord);
    assert.equal(
      restoreResult && restoreResult.success,
      true,
      "expected the test character record to restore cleanly",
    );
  }
});
