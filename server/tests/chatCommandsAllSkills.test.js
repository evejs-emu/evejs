const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const chatCommands = require(path.join(
  repoRoot,
  "server/src/services/chat/chatCommands",
));
const {
  getPublishedSkillTypes,
  getUnpublishedSkillTypes,
} = require(path.join(repoRoot, "server/src/services/skills/skillState"));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

test("/allskills restores published skills to V without granting unpublished skills", async (t) => {
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

  assert.ok(publishedSkill, "expected a published skill type for /allskills coverage");
  assert.ok(unpublishedSkill, "expected an unpublished skill type for /allskills coverage");

  database.remove("skills", `/${session.characterID}/${publishedSkill.typeID}`);
  database.remove("skills", `/${session.characterID}/${unpublishedSkill.typeID}`);

  const result = chatCommands.executeChatCommand(
    session,
    "/allskills",
    null,
    { emitChatFeedback: false },
  );

  assert.equal(result.handled, true);
  assert.match(result.message, /published skills/i);

  const updatedSkillsResult = database.read("skills", `/${session.characterID}`);
  assert.equal(updatedSkillsResult.success, true);

  const updatedPublishedSkill = updatedSkillsResult.data[String(publishedSkill.typeID)];
  assert.ok(updatedPublishedSkill, "expected /allskills to restore the published skill");
  assert.equal(updatedPublishedSkill.published, true);
  assert.equal(updatedPublishedSkill.skillLevel, 5);
  assert.equal(updatedPublishedSkill.trainedSkillLevel, 5);
  assert.equal(updatedPublishedSkill.effectiveSkillLevel, 5);

  assert.equal(
    Object.prototype.hasOwnProperty.call(
      updatedSkillsResult.data,
      String(unpublishedSkill.typeID),
    ),
    false,
    "expected /allskills to leave unpublished skills alone",
  );
});
