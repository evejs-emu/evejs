const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const accountsPath = path.join(
  repoRoot,
  "server/src/newDatabase/data/accounts/data.json",
);
const chatCommands = require(path.join(
  repoRoot,
  "server/src/services/chat/chatCommands",
));
const {
  CHAT_ROLE_PROFILES,
  MAX_ACCOUNT_ROLE,
  roleToString,
} = require(path.join(
  repoRoot,
  "server/src/services/account/accountRoleProfiles",
));

function buildSession() {
  const sentChanges = [];
  return {
    userid: 1,
    userName: "test",
    characterID: 140000001,
    role: roleToString(CHAT_ROLE_PROFILES.red),
    chatRole: roleToString(CHAT_ROLE_PROFILES.red),
    sendSessionChange(changes) {
      sentChanges.push(changes);
    },
    getSentChanges() {
      return sentChanges;
    },
  };
}

test("chat color commands persist the chosen chat role while keeping max account access", async (t) => {
  const originalAccounts = fs.readFileSync(accountsPath, "utf8");
  t.after(() => {
    fs.writeFileSync(accountsPath, originalAccounts, "utf8");
  });

  const session = buildSession();

  const blueResult = chatCommands.executeChatCommand(
    session,
    "/blue",
    null,
    { emitChatFeedback: false },
  );

  assert.equal(blueResult.handled, true);
  assert.equal(blueResult.refreshChatRolePresence, true);
  assert.match(blueResult.message, /chat color set to blue/i);
  assert.equal(session.role, roleToString(CHAT_ROLE_PROFILES.blue));
  assert.equal(session.chatRole, roleToString(CHAT_ROLE_PROFILES.blue));
  assert.deepEqual(Object.keys(session.getSentChanges()[0]), ["role"]);

  let persistedAccounts = JSON.parse(fs.readFileSync(accountsPath, "utf8"));
  assert.equal(persistedAccounts.test.role, roleToString(MAX_ACCOUNT_ROLE));
  assert.equal(
    persistedAccounts.test.chatRole,
    roleToString(CHAT_ROLE_PROFILES.blue),
  );

  const tealResult = chatCommands.executeChatCommand(
    session,
    "/teal",
    null,
    { emitChatFeedback: false },
  );

  assert.equal(tealResult.handled, true);
  assert.equal(tealResult.refreshChatRolePresence, true);
  assert.match(tealResult.message, /chat color set to teal/i);
  assert.equal(session.role, roleToString(CHAT_ROLE_PROFILES.teal));
  assert.equal(session.chatRole, roleToString(CHAT_ROLE_PROFILES.teal));

  persistedAccounts = JSON.parse(fs.readFileSync(accountsPath, "utf8"));
  assert.equal(persistedAccounts.test.role, roleToString(MAX_ACCOUNT_ROLE));
  assert.equal(
    persistedAccounts.test.chatRole,
    roleToString(CHAT_ROLE_PROFILES.teal),
  );
});
