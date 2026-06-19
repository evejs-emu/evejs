const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const chatHub = require(path.join(
  repoRoot,
  "server/src/services/chat/chatHub",
));

function buildSession() {
  const notifications = [];
  return {
    characterID: 140000001,
    socket: {
      destroyed: false,
    },
    sendNotification(name, scope, payload) {
      notifications.push({ name, scope, payload });
    },
    getNotifications() {
      return notifications;
    },
  };
}

test("system messages for non-local chat rooms do not emit Local OnLSC notifications", () => {
  const session = buildSession();

  chatHub.sendSystemMessage(session, "Hello corp", "corp_98000001");

  assert.equal(session.getNotifications().length, 0);
});

test("system messages for Local chat room names still emit Local OnLSC notifications", () => {
  const session = buildSession();

  chatHub.sendSystemMessage(session, "Hello local", "local_30000142");

  assert.equal(session.getNotifications().length, 1);
  assert.equal(session.getNotifications()[0].name, "OnLSC");
});

test("system messages for delayed local room names still route through Local OnLSC", () => {
  const session = buildSession();

  chatHub.sendSystemMessage(session, "Hello wormhole local", "wormhole_31000005");

  assert.equal(session.getNotifications().length, 1);
  assert.equal(session.getNotifications()[0].name, "OnLSC");
});
