const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const guestLists = require(path.join(
  repoRoot,
  "server/src/services/_shared/guestLists",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));

const originalGetSessions = sessionRegistry.getSessions;

function buildSession(overrides = {}) {
  const notifications = [];
  return {
    characterID: 140000001,
    corporationID: 1000044,
    allianceID: 0,
    warFactionID: 0,
    socket: { destroyed: false },
    sendNotification(name, scope, payload) {
      notifications.push({ name, scope, payload });
    },
    getNotifications() {
      return notifications;
    },
    ...overrides,
  };
}

test.afterEach(() => {
  sessionRegistry.getSessions = originalGetSessions;
});

test("station guest broadcasts mirror CCP station panel notifications", () => {
  const joiningSession = buildSession({
    characterID: 140000002,
    corporationID: 1000045,
    allianceID: 99009999,
    warFactionID: 500001,
    stationid: 60003760,
  });
  const witness = buildSession({
    characterID: 140000003,
    stationid: 60003760,
  });
  const outsider = buildSession({
    characterID: 140000004,
    stationid: 60008494,
  });
  sessionRegistry.getSessions = () => [joiningSession, witness, outsider];

  guestLists.broadcastStationGuestJoined(joiningSession, 60003760);
  guestLists.broadcastStationGuestLeft(joiningSession, 60003760);

  assert.deepEqual(witness.getNotifications(), [
    {
      name: "OnCharNowInStation",
      scope: "stationid",
      payload: [[140000002, 1000045, 99009999, 500001]],
    },
    {
      name: "OnCharNoLongerInStation",
      scope: "stationid",
      payload: [[140000002, 1000045, 99009999, 500001]],
    },
  ]);
  assert.deepEqual(outsider.getNotifications(), []);
});

test("structure guest broadcasts mirror CCP structure panel notifications", () => {
  const joiningSession = buildSession({
    characterID: 140000002,
    corporationID: 1000045,
    allianceID: 99009999,
    warFactionID: 500001,
    structureid: 1030000000000,
  });
  const witness = buildSession({
    characterID: 140000003,
    structureid: 1030000000000,
  });
  const outsider = buildSession({
    characterID: 140000004,
    structureid: 1030000000001,
  });
  sessionRegistry.getSessions = () => [joiningSession, witness, outsider];

  guestLists.broadcastStructureGuestJoined(joiningSession, 1030000000000);
  guestLists.broadcastStructureGuestLeft(joiningSession, 1030000000000);

  assert.deepEqual(witness.getNotifications(), [
    {
      name: "OnCharacterEnteredStructure",
      scope: "clientID",
      payload: [140000002, 1000045, 99009999, 500001],
    },
    {
      name: "OnCharacterLeftStructure",
      scope: "clientID",
      payload: [140000002],
    },
  ]);
  assert.deepEqual(outsider.getNotifications(), []);
});
