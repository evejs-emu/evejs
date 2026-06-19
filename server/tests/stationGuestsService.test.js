const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const { StationSvcAlias } = require(path.join(
  repoRoot,
  "server/src/services/station/stationService",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));

const originalGetSessions = sessionRegistry.getSessions;

test.afterEach(() => {
  sessionRegistry.getSessions = originalGetSessions;
});

test("station service returns all live guests docked in the current station", () => {
  const service = new StationSvcAlias();
  sessionRegistry.getSessions = () => [
    {
      characterID: 140000001,
      corporationID: 1000044,
      allianceID: 99009999,
      warFactionID: 500001,
      stationid: 60003760,
    },
    {
      characterID: 140000002,
      corporationID: 1000045,
      allianceID: 0,
      warFactionID: 0,
      stationid: 60003760,
    },
    {
      characterID: 140000003,
      corporationID: 1000046,
      allianceID: 0,
      warFactionID: 0,
      stationid: 60008494,
    },
  ];

  const result = service.Handle_GetGuests([], {
    characterID: 140000001,
    stationid: 60003760,
  });

  assert.deepEqual(result, {
    type: "list",
    items: [
      [140000001, 1000044, 99009999, 500001],
      [140000002, 1000045, 0, 0],
    ],
  });
});

test("station service de-duplicates duplicate live sessions for the same character", () => {
  const service = new StationSvcAlias();
  sessionRegistry.getSessions = () => [
    {
      characterID: 140000001,
      corporationID: 1000044,
      allianceID: 99009999,
      warFactionID: 500001,
      stationid: 60003760,
      lastActivity: 1000,
      connectTime: 1000,
      clientID: 700001,
    },
    {
      characterID: 140000001,
      corporationID: 1000044,
      allianceID: 99009999,
      warFactionID: 500001,
      stationid: 60003760,
      lastActivity: 2000,
      connectTime: 2000,
      clientID: 700002,
    },
    {
      characterID: 140000002,
      corporationID: 1000045,
      allianceID: 0,
      warFactionID: 0,
      stationid: 60003760,
      lastActivity: 1500,
      connectTime: 1500,
      clientID: 700003,
    },
  ];

  const result = service.Handle_GetGuests([], {
    characterID: 140000001,
    stationid: 60003760,
  });

  assert.deepEqual(result, {
    type: "list",
    items: [
      [140000001, 1000044, 99009999, 500001],
      [140000002, 1000045, 0, 0],
    ],
  });
});
