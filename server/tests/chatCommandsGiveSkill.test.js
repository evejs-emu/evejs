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
  getPublishedSkillTypes,
  getUnpublishedSkillTypes,
} = require(path.join(repoRoot, "server/src/services/skills/skillState"));

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

function hasSkillInventoryRowChange(session) {
  return session._notifications.some((entry) => {
    if (!entry || entry.name !== "OnItemChange") {
      return false;
    }
    const payload = Array.isArray(entry.payload) ? entry.payload[0] : null;
    const fields = payload && payload.fields && typeof payload.fields === "object"
      ? payload.fields
      : null;
    return Number(fields && fields.categoryID) === 16;
  });
}

test("/giveskill grants a single published skill to the requested level", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    database.flushAllSync();
  });

  const session = {
    characterID: 140000004,
  };
  const publishedSkill = getPublishedSkillTypes({ refresh: true }).find(
    (skillType) => Number(skillType.typeID) === 92397,
  );

  assert.ok(publishedSkill, "expected a published skill type for /giveskill coverage");
  database.remove("skills", `/${session.characterID}/${publishedSkill.typeID}`);

  const result = chatCommands.executeChatCommand(
    session,
    `/giveskill me ${publishedSkill.typeID} 3`,
    null,
    { emitChatFeedback: false },
  );

  assert.equal(result.handled, true);
  assert.match(result.message, new RegExp(String(publishedSkill.typeID)));

  const updatedSkillResult = database.read(
    "skills",
    `/${session.characterID}/${publishedSkill.typeID}`,
  );
  assert.equal(updatedSkillResult.success, true);
  assert.equal(updatedSkillResult.data.skillLevel, 3);
  assert.equal(updatedSkillResult.data.trainedSkillLevel, 3);
  assert.equal(updatedSkillResult.data.effectiveSkillLevel, 3);
});

test("/giveskill can lower an existing skill to level 0 without clamping", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    database.flushAllSync();
  });

  const session = {
    characterID: 140000004,
  };
  const publishedSkill = getPublishedSkillTypes({ refresh: true }).find(
    (skillType) => Number(skillType.typeID) === 43703,
  );

  assert.ok(publishedSkill, "expected Ice Harvesting Drone Specialization test data");

  const seedResult = chatCommands.executeChatCommand(
    session,
    `/giveskill me ${publishedSkill.typeID} 5`,
    null,
    { emitChatFeedback: false },
  );
  assert.equal(seedResult.handled, true);

  const result = chatCommands.executeChatCommand(
    session,
    `/giveskill me ${publishedSkill.typeID} 0`,
    null,
    { emitChatFeedback: false },
  );

  assert.equal(result.handled, true);
  assert.doesNotMatch(result.message, /clamped/i);
  assert.match(result.message, /level 0/i);

  const updatedSkillResult = database.read(
    "skills",
    `/${session.characterID}/${publishedSkill.typeID}`,
  );
  assert.equal(updatedSkillResult.success, true);
  assert.equal(updatedSkillResult.data.skillLevel, 0);
  assert.equal(updatedSkillResult.data.trainedSkillLevel, 0);
  assert.equal(updatedSkillResult.data.effectiveSkillLevel, 0);
  assert.equal(updatedSkillResult.data.skillPoints, 0);
});

test("/giveskill super grants both published and unpublished skill catalogs", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    database.flushAllSync();
  });

  const session = {
    characterID: 140000004,
  };
  const publishedSkill = getPublishedSkillTypes({ refresh: true }).find(
    (skillType) => Number(skillType.typeID) === 92397,
  );
  const unpublishedSkill = getUnpublishedSkillTypes({ refresh: true }).find(
    (skillType) => Number(skillType.typeID) === 9955,
  );

  assert.ok(publishedSkill, "expected a published skill type for /giveskill super");
  assert.ok(unpublishedSkill, "expected an unpublished skill type for /giveskill super");

  database.remove("skills", `/${session.characterID}/${publishedSkill.typeID}`);
  database.remove("skills", `/${session.characterID}/${unpublishedSkill.typeID}`);

  const result = chatCommands.executeChatCommand(
    session,
    "/giveskill me super 5",
    null,
    { emitChatFeedback: false },
  );

  assert.equal(result.handled, true);
  assert.match(result.message, /published and unpublished skills/i);

  const updatedSkillsResult = database.read("skills", `/${session.characterID}`);
  assert.equal(updatedSkillsResult.success, true);
  assert.equal(updatedSkillsResult.data[String(publishedSkill.typeID)].skillLevel, 5);
  assert.equal(updatedSkillsResult.data[String(unpublishedSkill.typeID)].skillLevel, 5);
});

test("/giveskill emits live skill refresh notifications for online sessions", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    sessionRegistry.unregister(liveSession);
    database.flushAllSync();
  });

  const liveSession = buildLiveSession(140000004);
  const publishedSkill = getPublishedSkillTypes({ refresh: true }).find(
    (skillType) => Number(skillType.typeID) === 92397,
  );

  assert.ok(publishedSkill, "expected a published skill type for live refresh coverage");
  database.remove("skills", `/${liveSession.characterID}/${publishedSkill.typeID}`);
  sessionRegistry.register(liveSession);

  const result = chatCommands.executeChatCommand(
    liveSession,
    `/giveskill me ${publishedSkill.typeID} 4`,
    null,
    { emitChatFeedback: false },
  );

  assert.equal(result.handled, true);

  const notificationNames = liveSession._notifications.map(
    (entry) => entry && entry.name,
  );
  assert.ok(
    notificationNames.includes("OnSkillsChanged"),
    "expected /giveskill to notify live clients about skill changes",
  );
  assert.ok(
    notificationNames.includes("OnSkillLevelsTrained"),
    "expected /giveskill to notify live clients about trained skill levels",
  );
  assert.equal(
    hasSkillInventoryRowChange(liveSession),
    false,
    "expected /giveskill to avoid faking skill inventory row changes",
  );
});
