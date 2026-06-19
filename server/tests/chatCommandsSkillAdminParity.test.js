const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const chatCommands = require(path.join(
  repoRoot,
  "server/src/services/chat/chatCommands",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const {
  buildSkillRecord,
  ensureCharacterPublishedSkills,
  ensureCharacterUnpublishedSkills,
  getPublishedSkillTypes,
  getUnpublishedSkillTypes,
} = require(path.join(repoRoot, "server/src/services/skills/skillState"));
const {
  getCharacterCreationRace,
} = require(path.join(repoRoot, "server/src/services/character/characterCreationData"));
const {
  getCharacterRecord,
  syncInventoryItemForSession,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));
const {
  saveQueue,
} = require(path.join(repoRoot, "server/src/services/skills/training/skillQueueRuntime"));

const TEST_CHARACTER_ID = 140000004;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildLiveSession(characterID) {
  const notifications = [];
  return {
    characterID,
    charid: characterID,
    userid: characterID,
    socket: { destroyed: false },
    _notifications: notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function setCharacterFreeSkillPoints(characterID, freeSkillPoints = 0) {
  const characters = cloneValue(database.read("characters", "/").data);
  const nextRecord = {
    ...(characters[String(characterID)] || {}),
    freeSkillPoints,
  };
  characters[String(characterID)] = nextRecord;
  database.write("characters", "/", characters);
}

function getNotificationNames(session) {
  return session._notifications.map((entry) => entry && entry.name);
}

function notificationContainsSkillInventoryRow(notification) {
  if (!notification || notification.name !== "OnItemChange") {
    return false;
  }
  const payload = Array.isArray(notification.payload) ? notification.payload[0] : null;
  const fields = payload && payload.fields && typeof payload.fields === "object"
    ? payload.fields
    : null;
  return Number(fields && fields.categoryID) === 16;
}

function hasSkillInventoryRowChange(session) {
  return session._notifications.some((entry) => notificationContainsSkillInventoryRow(entry));
}

test("/allskills emits server skill refreshes and prunes a now-satisfied live queue", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalQueues = cloneValue(database.read("skillQueues", "/").data);
  const liveSession = buildLiveSession(TEST_CHARACTER_ID);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    database.write("skillQueues", "/", originalQueues);
    sessionRegistry.unregister(liveSession);
    database.flushAllSync();
  });

  const publishedSkill = getPublishedSkillTypes({ refresh: true }).find(
    (skillType) => Number(skillType.typeID) === 92397,
  );
  assert.ok(publishedSkill, "expected a published skill for /allskills live parity");

  database.write(
    "skills",
    `/${TEST_CHARACTER_ID}/${publishedSkill.typeID}`,
    buildSkillRecord(TEST_CHARACTER_ID, publishedSkill, 4),
  );
  saveQueue(
    TEST_CHARACTER_ID,
    [{ typeID: publishedSkill.typeID, toLevel: 5 }],
    {
      activate: true,
      emitNotifications: false,
    },
  );

  sessionRegistry.register(liveSession);
  liveSession._notifications.length = 0;

  const result = chatCommands.executeChatCommand(
    liveSession,
    "/allskills",
    null,
    { emitChatFeedback: false },
  );

  assert.equal(result.handled, true);
  assert.match(result.message, /published skills/i);

  const notificationNames = getNotificationNames(liveSession);
  assert.ok(
    notificationNames.includes("OnServerSkillsChanged"),
    "expected /allskills to refresh the client skill cache",
  );
  assert.ok(
    notificationNames.includes("OnSkillLevelsTrained"),
    "expected /allskills to notify trained levels",
  );
  assert.ok(
    notificationNames.includes("OnNewSkillQueueSaved"),
    "expected /allskills to refresh the live queue",
  );
  assert.ok(
    notificationNames.includes("OnSkillQueuePausedServer"),
    "expected /allskills to pause an emptied queue",
  );

  const updatedQueueResult = database.read("skillQueues", `/${TEST_CHARACTER_ID}`);
  assert.equal(updatedQueueResult.success, true);
  assert.deepEqual(updatedQueueResult.data.queue, []);
  assert.equal(updatedQueueResult.data.active, false);
});

test("/gmskills emits server skill refresh notifications for live sessions", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalQueues = cloneValue(database.read("skillQueues", "/").data);
  const liveSession = buildLiveSession(TEST_CHARACTER_ID);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    database.write("skillQueues", "/", originalQueues);
    sessionRegistry.unregister(liveSession);
    database.flushAllSync();
  });

  const unpublishedSkill = getUnpublishedSkillTypes({ refresh: true }).find(
    (skillType) => Number(skillType.typeID) === 9955,
  );
  assert.ok(unpublishedSkill, "expected an unpublished skill for /gmskills parity");

  database.write(
    "skills",
    `/${TEST_CHARACTER_ID}/${unpublishedSkill.typeID}`,
    buildSkillRecord(TEST_CHARACTER_ID, unpublishedSkill, 4),
  );

  sessionRegistry.register(liveSession);
  liveSession._notifications.length = 0;

  const result = chatCommands.executeChatCommand(
    liveSession,
    "/gmskills",
    null,
    { emitChatFeedback: false },
  );

  assert.equal(result.handled, true);
  assert.match(result.message, /GM\/unpublished skills/i);

  const notificationNames = getNotificationNames(liveSession);
  assert.ok(
    notificationNames.includes("OnServerSkillsChanged"),
    "expected /gmskills to refresh the client skill cache",
  );
  assert.ok(
    notificationNames.includes("OnSkillLevelsTrained"),
    "expected /gmskills to notify trained levels",
  );
  assert.equal(
    hasSkillInventoryRowChange(liveSession),
    false,
    "expected /gmskills to avoid faking live skill inventory rows",
  );
});

test("/backintime restores the racial starter bundle, clears free SP, and refreshes the live client", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalQueues = cloneValue(database.read("skillQueues", "/").data);
  const liveSession = buildLiveSession(TEST_CHARACTER_ID);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    database.write("skillQueues", "/", originalQueues);
    sessionRegistry.unregister(liveSession);
    database.flushAllSync();
  });

  const characterRecord = getCharacterRecord(TEST_CHARACTER_ID);
  const starterRace = getCharacterCreationRace(characterRecord.raceID);
  const publishedSkill = getPublishedSkillTypes({ refresh: true }).find(
    (skillType) => Number(skillType.typeID) === 92397,
  );

  assert.ok(starterRace, "expected a starter race profile for /backintime parity");
  assert.ok(publishedSkill, "expected a published skill for /backintime queue setup");

  ensureCharacterPublishedSkills(TEST_CHARACTER_ID);
  ensureCharacterUnpublishedSkills(TEST_CHARACTER_ID);
  database.write(
    "skills",
    `/${TEST_CHARACTER_ID}/${publishedSkill.typeID}`,
    buildSkillRecord(TEST_CHARACTER_ID, publishedSkill, 4),
  );
  setCharacterFreeSkillPoints(TEST_CHARACTER_ID, 250000);
  saveQueue(
    TEST_CHARACTER_ID,
    [{ typeID: publishedSkill.typeID, toLevel: 5 }],
    {
      activate: true,
      emitNotifications: false,
    },
  );

  sessionRegistry.register(liveSession);
  liveSession._notifications.length = 0;

  const result = chatCommands.executeChatCommand(
    liveSession,
    "/backintime",
    null,
    { emitChatFeedback: false },
  );

  assert.equal(result.handled, true);
  assert.match(result.message, /starter skill bundle/i);

  const updatedCharacter = getCharacterRecord(TEST_CHARACTER_ID);
  assert.equal(updatedCharacter.freeSkillPoints, 0);

  const updatedSkillTable = database.read("skills", `/${TEST_CHARACTER_ID}`);
  assert.equal(updatedSkillTable.success, true);

  const expectedStarterMap = new Map(
    starterRace.skills.map((entry) => [Number(entry.typeID), Number(entry.level)]),
  );
  const actualSkillKeys = Object.keys(updatedSkillTable.data || {}).map((typeID) => Number(typeID));
  assert.equal(
    actualSkillKeys.length,
    expectedStarterMap.size,
    "expected /backintime to leave only the starter skill bundle",
  );

  for (const [typeID, expectedLevel] of expectedStarterMap.entries()) {
    const skillRecord = updatedSkillTable.data[String(typeID)];
    assert.ok(skillRecord, `expected starter skill ${typeID} to exist after /backintime`);
    assert.equal(skillRecord.skillLevel, expectedLevel);
    assert.equal(skillRecord.trainedSkillLevel, expectedLevel);
    assert.equal(skillRecord.effectiveSkillLevel, expectedLevel);
  }

  const updatedQueueResult = database.read("skillQueues", `/${TEST_CHARACTER_ID}`);
  assert.equal(updatedQueueResult.success, true);
  assert.deepEqual(updatedQueueResult.data.queue, []);
  assert.equal(updatedQueueResult.data.active, false);

  const notificationNames = getNotificationNames(liveSession);
  assert.ok(
    notificationNames.includes("OnServerSkillsChanged"),
    "expected /backintime to refresh retained starter skills",
  );
  assert.ok(
    notificationNames.includes("OnServerSkillsRemoved"),
    "expected /backintime to remove non-starter skills from the client cache",
  );
  assert.ok(
    notificationNames.includes("OnFreeSkillPointsChanged"),
    "expected /backintime to refresh free skill points",
  );
  assert.ok(
    notificationNames.includes("OnNewSkillQueueSaved"),
    "expected /backintime to refresh the queue UI",
  );
  assert.ok(
    notificationNames.includes("OnSkillQueuePausedServer"),
    "expected /backintime to pause training after clearing the queue",
  );
  assert.ok(
    notificationNames.includes("OnModuleAttributeChanges"),
    "expected /backintime to refresh live character industry modifiers through dogma attribute deltas",
  );
  assert.equal(
    notificationNames.includes("OnServerBrainUpdated"),
    true,
    "expected /backintime to refresh real character dogma brain state for industry parity",
  );
  assert.equal(
    hasSkillInventoryRowChange(liveSession),
    false,
    "expected /backintime to avoid faking skill inventory rows",
  );
});

test("trained skill rows are never replayed through generic inventory sync", async () => {
  const liveSession = buildLiveSession(TEST_CHARACTER_ID);
  const publishedSkill = getPublishedSkillTypes({ refresh: true }).find(
    (skillType) => Number(skillType.typeID) === 3300,
  );
  assert.ok(publishedSkill, "expected Gunnery to exist in reference data");

  syncInventoryItemForSession(
    liveSession,
    buildSkillRecord(TEST_CHARACTER_ID, publishedSkill, 5),
    {
      locationID: 0,
      flagID: 0,
    },
  );

  assert.equal(
    hasSkillInventoryRowChange(liveSession),
    false,
    "expected trained skill rows to be suppressed from generic OnItemChange transport",
  );
});
