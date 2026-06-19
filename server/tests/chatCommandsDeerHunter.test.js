const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const {
  DEER_HUNTER_MESSAGE,
  executeChatCommand,
} = require(path.join(
  repoRoot,
  "server/src/services/chat/chatCommands",
));

test("deer_hunter thanks the player and respects the explicit feedback channel", () => {
  const sentMessages = [];
  const session = {
    characterID: 140000001,
  };
  const chatHub = {
    sendSystemMessage(targetSession, message, targetChannel) {
      sentMessages.push({ targetSession, message, targetChannel });
    },
  };

  const result = executeChatCommand(session, "/deer_hunter", chatHub, {
    feedbackChannel: "corp_98000001",
  });

  assert.equal(result.handled, true);
  assert.equal(result.message, DEER_HUNTER_MESSAGE);
  assert.deepEqual(sentMessages, [
    {
      targetSession: session,
      message: DEER_HUNTER_MESSAGE,
      targetChannel: "corp_98000001",
    },
  ]);
});

test("deer_hunter adds a brief microjump flash when the ship FX path succeeds", () => {
  const session = {
    characterID: 140000001,
    _space: {
      shipID: 90000001,
    },
  };
  const originalPlaySpecialFx = spaceRuntime.playSpecialFx;
  const calls = [];
  spaceRuntime.playSpecialFx = (targetSession, guid, options) => {
    calls.push({ targetSession, guid, options });
    return {
      success: true,
      data: {
        guid,
        shipID: 90000001,
        stamp: 1,
      },
    };
  };

  try {
    const result = executeChatCommand(session, "/deer_hunter", null, {
      emitChatFeedback: false,
    });

    assert.equal(result.handled, true);
    assert.match(result.message, /contribution to rising AI development costs/i);
    assert.match(result.message, /micro-jump flash/i);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].targetSession, session);
    assert.equal(calls[0].guid, "effects.MicroJumpDriveEngage");
  } finally {
    spaceRuntime.playSpecialFx = originalPlaySpecialFx;
  }
});
