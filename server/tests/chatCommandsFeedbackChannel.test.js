const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  COMMANDS_HELP_TEXT,
  DEFAULT_MOTD_MESSAGE,
  executeChatCommand,
} = require(path.join(
  repoRoot,
  "server/src/services/chat/chatCommands",
));

test("chat command feedback respects the explicit feedback channel", () => {
  const sentMessages = [];
  const session = {
    characterID: 140000001,
  };
  const chatHub = {
    sendSystemMessage(targetSession, message, targetChannel) {
      sentMessages.push({ targetSession, message, targetChannel });
    },
  };

  const result = executeChatCommand(session, "/motd", chatHub, {
    feedbackChannel: "corp_98000001",
  });

  assert.equal(result.handled, true);
  assert.equal(result.message, DEFAULT_MOTD_MESSAGE);
  assert.deepEqual(sentMessages, [
    {
      targetSession: session,
      message: DEFAULT_MOTD_MESSAGE,
      targetChannel: "corp_98000001",
    },
  ]);
});

test("help command returns slash commands on separate lines", () => {
  const result = executeChatCommand(null, "/help", null, {
    emitChatFeedback: false,
  });

  assert.equal(result.handled, true);
  assert.equal(result.message, COMMANDS_HELP_TEXT);
  assert.match(result.message, /^Commands:\n\/help\n\/motd/m);
  assert.doesNotMatch(result.message, /\/help, ?\/motd/);
});
