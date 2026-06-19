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
  getCharacterSkills,
  getPublishedSkillTypes,
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

test("/removeskill removes a single skill record from the target character", async (t) => {
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

  assert.ok(publishedSkill, "expected a published skill type for /removeskill coverage");
  database.write(
    "skills",
    `/${session.characterID}/${publishedSkill.typeID}`,
    buildSkillRecord(session.characterID, publishedSkill, 5),
  );

  const result = chatCommands.executeChatCommand(
    session,
    `/removeskill me ${publishedSkill.typeID}`,
    null,
    { emitChatFeedback: false },
  );

  assert.equal(result.handled, true);
  assert.match(result.message, new RegExp(String(publishedSkill.typeID)));

  const updatedSkillsResult = database.read("skills", `/${session.characterID}`);
  assert.equal(updatedSkillsResult.success, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      updatedSkillsResult.data || {},
      String(publishedSkill.typeID),
    ),
    false,
  );
});

test("/removeskill all leaves the character with zero skills without rebootstrap", async (t) => {
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

  const grantResult = chatCommands.executeChatCommand(
    session,
    "/giveskill me super 5",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(grantResult.handled, true);
  assert.ok(getCharacterSkills(session.characterID).length > 0);

  const result = chatCommands.executeChatCommand(
    session,
    "/removeskill me all",
    null,
    { emitChatFeedback: false },
  );

  assert.equal(result.handled, true);
  assert.match(result.message, /Removed all skills/i);

  const updatedSkillsResult = database.read("skills", `/${session.characterID}`);
  assert.equal(updatedSkillsResult.success, true);
  assert.deepEqual(Object.keys(updatedSkillsResult.data || {}), []);
  assert.equal(
    getCharacterSkills(session.characterID).length,
    0,
    "expected removed skills to stay removed on the next lazy skill read",
  );
});

test("/removeskill emits removal-style skill refresh notifications for live sessions", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const liveSession = buildLiveSession(140000004);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    sessionRegistry.unregister(liveSession);
    database.flushAllSync();
  });

  const publishedSkill = getPublishedSkillTypes({ refresh: true }).find(
    (skillType) => Number(skillType.typeID) === 92397,
  );

  assert.ok(
    publishedSkill,
    "expected a published skill type for /removeskill live refresh coverage",
  );
  database.write(
    "skills",
    `/${liveSession.characterID}/${publishedSkill.typeID}`,
    buildSkillRecord(liveSession.characterID, publishedSkill, 5),
  );
  sessionRegistry.register(liveSession);

  const result = chatCommands.executeChatCommand(
    liveSession,
    `/removeskill me ${publishedSkill.typeID}`,
    null,
    { emitChatFeedback: false },
  );

  assert.equal(result.handled, true);

  const notificationNames = liveSession._notifications.map(
    (entry) => entry && entry.name,
  );
  assert.ok(
    notificationNames.includes("OnSkillsChanged"),
    "expected /removeskill to notify live clients about skill changes",
  );
  assert.equal(
    hasSkillInventoryRowChange(liveSession),
    false,
    "expected /removeskill to avoid faking skill inventory row removals",
  );
  assert.equal(
    notificationNames.includes("OnSkillLevelsTrained"),
    false,
    "expected /removeskill to avoid trained-level grant notifications",
  );

  const skillsChangedNotification = liveSession._notifications.find(
    (entry) => entry && entry.name === "OnSkillsChanged",
  );
  assert.ok(skillsChangedNotification, "expected an OnSkillsChanged payload");

  const changedEntry = (skillsChangedNotification.payload[0].entries || []).find(
    (entry) => Number(entry && entry[0]) === publishedSkill.typeID,
  );
  assert.ok(changedEntry, "expected removed skill to be included in OnSkillsChanged");

  const changedSkillEntries =
    (changedEntry[1] &&
      changedEntry[1].args &&
      Array.isArray(changedEntry[1].args.entries) &&
      changedEntry[1].args.entries) ||
    [];
  const skillLevelEntry = changedSkillEntries.find((entry) => entry[0] === "skillLevel");
  const trainedSkillLevelEntry = changedSkillEntries.find(
    (entry) => entry[0] === "trainedSkillLevel",
  );
  const skillPointsEntry = changedSkillEntries.find((entry) => entry[0] === "skillPoints");

  assert.deepEqual(skillLevelEntry, ["skillLevel", 0]);
  assert.deepEqual(trainedSkillLevelEntry, ["trainedSkillLevel", 0]);
  assert.deepEqual(skillPointsEntry, ["skillPoints", 0]);
});
