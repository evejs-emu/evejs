const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const database = require(path.join(repoRoot, "server/src/newDatabase"));
const config = require(path.join(repoRoot, "server/src/config"));
const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  resolveAggressorStandingProfile,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningNpcStandings",
));

function pickCharacterID() {
  const result = database.read("characters", "/");
  const characters = result && result.success && result.data ? result.data : {};
  const firstKey = Object.keys(characters)[0];
  assert.ok(firstKey, "expected at least one character in the test database");
  return Number(firstKey);
}

test("mining NPC standing resolution falls back to config thresholds and classifies hostile/friendly standings", (t) => {
  const characterID = pickCharacterID();
  const originalRecord = getCharacterRecord(characterID);
  assert.ok(originalRecord, "expected a source character record");
  const originalHostileThreshold = config.miningNpcHostileStandingThreshold;
  const originalFriendlyThreshold = config.miningNpcFriendlyStandingThreshold;

  t.after(() => {
    updateCharacterRecord(characterID, () => originalRecord);
    config.miningNpcHostileStandingThreshold = originalHostileThreshold;
    config.miningNpcFriendlyStandingThreshold = originalFriendlyThreshold;
  });

  config.miningNpcHostileStandingThreshold = -5;
  config.miningNpcFriendlyStandingThreshold = 5;

  updateCharacterRecord(characterID, (record) => ({
    ...record,
    standingData: {
      char: [
        { fromID: characterID, toID: 1000129, standing: -8.5 },
        { fromID: characterID, toID: 1000128, standing: 8.25 },
      ],
      corp: [],
      npc: [],
    },
  }));

  const aggressorEntity = {
    kind: "ship",
    itemID: 910000001,
    session: {
      characterID,
    },
  };

  const hostileProfile = resolveAggressorStandingProfile(aggressorEntity, {
    kind: "ship",
    itemID: 910000002,
    corporationID: 1000129,
    hostileResponseThreshold: 11,
    friendlyResponseThreshold: 11,
  });
  assert.equal(hostileProfile.standingClass, "hostile");
  assert.equal(hostileProfile.matchedOwnerID, 1000129);
  assert.equal(hostileProfile.thresholds.source, "config");

  const friendlyProfile = resolveAggressorStandingProfile(aggressorEntity, {
    kind: "ship",
    itemID: 910000003,
    corporationID: 1000128,
    hostileResponseThreshold: 11,
    friendlyResponseThreshold: 11,
  });
  assert.equal(friendlyProfile.standingClass, "friendly");
  assert.equal(friendlyProfile.matchedOwnerID, 1000128);
  assert.equal(friendlyProfile.thresholds.source, "config");
});
