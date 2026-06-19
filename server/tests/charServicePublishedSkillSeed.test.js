const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const config = require(path.join(repoRoot, "server/src/config"));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const {
  getCharacterCreationRace,
} = require(path.join(repoRoot, "server/src/services/character/characterCreationData"));
const {
  getPublishedSkillTypes,
  getUnpublishedSkillTypes,
} = require(path.join(repoRoot, "server/src/services/skills/skillState"));
const {
  PLEX_LOG_CATEGORY,
} = require(path.join(repoRoot, "server/src/services/account/plexVaultLogState"));
const {
  getFittedModuleItems,
} = require(path.join(repoRoot, "server/src/services/fitting/liveFittingState"));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

test("CreateCharacterWithDoll gives non-dev Amarr characters the CCP starter skill bundle and rookie ship", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalIdentityState = cloneValue(database.read("identityState", "/").data);
  const originalDevBootstrapPublishedSkills = config.devBootstrapPublishedSkills;
  t.after(() => {
    config.devBootstrapPublishedSkills = originalDevBootstrapPublishedSkills;
    database.write("identityState", "/", originalIdentityState);
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.write("skills", "/", originalSkills);
    database.flushAllSync();
  });

  config.devBootstrapPublishedSkills = false;
  const service = new CharService();
  const expectedRaceProfile = getCharacterCreationRace(4, { refresh: true });
  assert.ok(expectedRaceProfile, "expected an Amarr creation-race profile");

  const newCharacterId = service.Handle_CreateCharacterWithDoll(
    ["Starter Skill Seed Test", 5, 1, 1, null, null, 11],
    { userid: 900001 },
  );

  const characterResult = database.read("characters", `/${newCharacterId}`);
  assert.equal(characterResult.success, true);
  assert.equal(characterResult.data.raceID, 4);
  assert.equal(characterResult.data.shipTypeID, expectedRaceProfile.shipTypeID);
  assert.equal(characterResult.data.shipName, expectedRaceProfile.shipName);
  const starterShipResult = database.read(
    "items",
    `/${String(characterResult.data.shipID)}`,
  );
  assert.equal(starterShipResult.success, true);
  assert.equal(starterShipResult.data.typeID, expectedRaceProfile.shipTypeID);
  const fittedModuleNames = new Set(
    getFittedModuleItems(newCharacterId, characterResult.data.shipID)
      .map((item) => item && item.itemName)
      .filter(Boolean),
  );
  assert.deepEqual(
    fittedModuleNames,
    new Set([
      "1MN Civilian Afterburner",
      "Civilian Gatling Pulse Laser",
      "Civilian Miner",
    ]),
  );

  const skillsResult = database.read("skills", `/${newCharacterId}`);
  assert.equal(skillsResult.success, true);

  const seededSkills = skillsResult.data;
  const expectedSkillLevels = new Map(
    expectedRaceProfile.skills.map((entry) => [String(entry.typeID), entry.level]),
  );
  assert.deepEqual(
    new Set(Object.keys(seededSkills)),
    new Set([...expectedSkillLevels.keys()]),
  );

  for (const [typeID, expectedLevel] of expectedSkillLevels.entries()) {
    const skillRecord = seededSkills[typeID];
    assert.ok(skillRecord, `expected starter skill ${typeID}`);
    assert.equal(skillRecord.skillLevel, expectedLevel);
    assert.equal(skillRecord.trainedSkillLevel, expectedLevel);
    assert.equal(skillRecord.effectiveSkillLevel, expectedLevel);
  }
});

test("CreateCharacterWithDoll seeds all published skills to V when devBootstrapPublishedSkills is enabled and excludes unpublished skills", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalIdentityState = cloneValue(database.read("identityState", "/").data);
  const originalDevBootstrapPublishedSkills = config.devBootstrapPublishedSkills;
  t.after(() => {
    config.devBootstrapPublishedSkills = originalDevBootstrapPublishedSkills;
    database.write("identityState", "/", originalIdentityState);
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.write("skills", "/", originalSkills);
    database.flushAllSync();
  });

  config.devBootstrapPublishedSkills = true;
  const service = new CharService();
  const publishedSkillTypes = getPublishedSkillTypes({ refresh: true });
  const unpublishedSkillTypes = getUnpublishedSkillTypes({ refresh: true });

  const newCharacterId = service.Handle_CreateCharacterWithDoll(
    ["Published Seed Test", 5, 1, 1, null, null, 11],
    { userid: 900001 },
  );

  const skillsResult = database.read("skills", `/${newCharacterId}`);
  assert.equal(skillsResult.success, true);

  const seededSkills = skillsResult.data;
  const seededTypeIDs = new Set(Object.keys(seededSkills));
  const expectedPublishedTypeIDs = new Set(
    publishedSkillTypes.map((skillType) => String(skillType.typeID)),
  );

  assert.deepEqual(seededTypeIDs, expectedPublishedTypeIDs);

  for (const skillRecord of Object.values(seededSkills)) {
    assert.equal(skillRecord.published, true);
    assert.equal(skillRecord.skillLevel, 5);
    assert.equal(skillRecord.trainedSkillLevel, 5);
    assert.equal(skillRecord.effectiveSkillLevel, 5);
  }

  for (const skillType of unpublishedSkillTypes) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(seededSkills, String(skillType.typeID)),
      false,
    );
  }
});

test("CreateCharacterWithDoll seeds initial ISK and PLEX history entries", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalIdentityState = cloneValue(database.read("identityState", "/").data);
  t.after(() => {
    database.write("identityState", "/", originalIdentityState);
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.write("skills", "/", originalSkills);
    database.flushAllSync();
  });

  const service = new CharService();
  const newCharacterId = service.Handle_CreateCharacterWithDoll(
    ["Wallet History Seed Test", 5, 1, 1, null, null, 11],
    { userid: 900001 },
  );

  const characterResult = database.read("characters", `/${newCharacterId}`);
  assert.equal(characterResult.success, true);

  const walletJournal = characterResult.data.walletJournal || [];
  const plexVaultTransactions = characterResult.data.plexVaultTransactions || [];

  assert.equal(walletJournal.length > 0, true);
  assert.equal(plexVaultTransactions.length > 0, true);
  assert.equal(
    walletJournal[0].description,
    "Initial character creation ISK grant",
  );
  assert.equal(walletJournal[0].amount, 100000);
  assert.equal(walletJournal[0].balance, 100000);
  assert.equal(
    plexVaultTransactions[0].reason,
    "Initial character creation PLEX grant",
  );
  assert.equal(plexVaultTransactions[0].summaryMessageID, PLEX_LOG_CATEGORY.CCP);
  assert.equal(plexVaultTransactions[0].summaryText, "Initial character creation PLEX grant");
  assert.equal(plexVaultTransactions[0].amount, 2222);
  assert.equal(plexVaultTransactions[0].balance, 2222);
});
