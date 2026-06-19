const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const StructureGuestsService = require(path.join(
  repoRoot,
  "server/src/services/structure/structureGuestsService",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const MachoNetService = require(path.join(
  repoRoot,
  "server/src/services/machoNet/machoNetService",
));

const originalGetSessions = sessionRegistry.getSessions;

test.afterEach(() => {
  sessionRegistry.getSessions = originalGetSessions;
});

test("structureGuests returns all live guests docked in the requested structure", () => {
  const service = new StructureGuestsService();
  sessionRegistry.getSessions = () => [
    {
      characterID: 140000002,
      corporationID: 1000044,
      allianceID: 99009999,
      warFactionID: 500001,
      structureid: 1030000000000,
    },
    {
      characterID: 140000003,
      corporationID: 1000045,
      allianceID: 0,
      warFactionID: 0,
      structureid: 1030000000000,
    },
    {
      characterID: 140000004,
      corporationID: 1000046,
      allianceID: 0,
      warFactionID: 0,
      structureid: 1030000000001,
    },
  ];

  const result = service.Handle_GetGuests([1030000000000], {
    characterID: 140000002,
    structureid: 1030000000000,
  });

  assert.equal(result.type, "dict");
  assert.deepEqual(result.entries, [
    [140000002, [1000044, 99009999, 500001]],
    [140000003, [1000045, 0, 0]],
  ]);
});

test("structureGuests de-duplicates duplicate live sessions for the same character", () => {
  const service = new StructureGuestsService();
  sessionRegistry.getSessions = () => [
    {
      characterID: 140000002,
      corporationID: 1000044,
      allianceID: 99009999,
      warFactionID: 500001,
      structureid: 1030000000000,
      lastActivity: 1000,
      connectTime: 1000,
      clientID: 700001,
    },
    {
      characterID: 140000002,
      corporationID: 1000044,
      allianceID: 99009999,
      warFactionID: 500001,
      structureid: 1030000000000,
      lastActivity: 2000,
      connectTime: 2000,
      clientID: 700002,
    },
    {
      characterID: 140000003,
      corporationID: 1000045,
      allianceID: 0,
      warFactionID: 0,
      structureid: 1030000000000,
      lastActivity: 1500,
      connectTime: 1500,
      clientID: 700003,
    },
  ];

  const result = service.Handle_GetGuests([1030000000000], {
    characterID: 140000002,
    structureid: 1030000000000,
  });

  assert.deepEqual(result.entries, [
    [140000002, [1000044, 99009999, 500001]],
    [140000003, [1000045, 0, 0]],
  ]);
});

test("structureGuests falls back to the caller structure session when no argument is supplied", () => {
  const service = new StructureGuestsService();
  sessionRegistry.getSessions = () => [
    {
      characterID: 140000002,
      corporationID: 1000044,
      allianceID: 0,
      warFactionID: 0,
      structureid: 1030000000000,
    },
  ];

  const result = service.Handle_GetGuests([], {
    characterID: 140000002,
    structureid: 1030000000000,
  });

  assert.deepEqual(result.entries, [[140000002, [1000044, 0, 0]]]);
});

test("machoNet service info advertises structureGuests for client routing", () => {
  const service = new MachoNetService();
  const infoDict = service.getServiceInfoDict();
  const serviceInfo = new Map(infoDict.entries);

  assert.equal(serviceInfo.has("structureGuests"), true);
  assert.equal(serviceInfo.get("structureGuests"), null);
});
