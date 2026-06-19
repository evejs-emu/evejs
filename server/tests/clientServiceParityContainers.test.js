const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const ExpertSystemMgrService = require(path.join(
  repoRoot,
  "server/src/services/character/expertSystemMgrService",
));
const FacWarMgrService = require(path.join(
  repoRoot,
  "server/src/services/faction/facWarMgrService",
));
const CrimewatchService = require(path.join(
  repoRoot,
  "server/src/services/security/crimewatchService",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getKeyValField(payload, fieldName) {
  const entries =
    payload &&
    payload.args &&
    Array.isArray(payload.args.entries)
      ? payload.args.entries
      : [];
  return entries.find(([key]) => key === fieldName)?.[1];
}

test("expertSystemMgr returns an empty dict when the character has no expert systems", () => {
  const service = new ExpertSystemMgrService();
  const payload = service.Handle_GetMyExpertSystems([], {
    characterID: 140000001,
  });

  assert.equal(payload && payload.type, "dict");
  assert.deepEqual(payload.entries, []);
});

test("facWarMgr returns an empty list for rank overview when the character has no militia ranks", () => {
  const service = new FacWarMgrService();
  const payload = service.Handle_GetMyCharacterRankOverview([], {
    characterID: 140000001,
    warFactionID: null,
    warfactionid: null,
  });

  assert.equal(payload && payload.type, "list");
  assert.deepEqual(payload.items, []);
});

test("facWarMgr returns a minimal current-rank KeyVal for enlisted characters", (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data || {});

  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.flushAllSync();
  });

  const updatedCharacters = cloneValue(originalCharacters);
  updatedCharacters["140000001"] = {
    ...updatedCharacters["140000001"],
    warFactionID: 500001,
  };
  database.write("characters", "/", updatedCharacters);
  database.flushAllSync();

  const service = new FacWarMgrService();
  const payload = service.Handle_GetMyCharacterRankInfo([], {
    characterID: 140000001,
    warFactionID: 500001,
    warfactionid: 500001,
  });

  assert.equal(payload && payload.type, "object");
  assert.equal(payload && payload.name, "util.KeyVal");
  assert.equal(getKeyValField(payload, "factionID"), 500001);
  assert.equal(getKeyValField(payload, "warFactionID"), 500001);
  assert.equal(getKeyValField(payload, "currentRank"), 0);
});

test("crimewatch returns an empty list for security status transactions when no history exists yet", () => {
  const service = new CrimewatchService();
  const payload = service.Handle_GetSecurityStatusTransactions([], {
    characterID: 140000001,
  });

  assert.equal(payload && payload.type, "list");
  assert.deepEqual(payload.items, []);
});
