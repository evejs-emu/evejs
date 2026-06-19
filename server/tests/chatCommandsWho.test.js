const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const chatCommands = require(path.join(
  repoRoot,
  "server/src/services/chat/chatCommands",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));

const originalGetSessions = sessionRegistry.getSessions;

test.after(() => {
  sessionRegistry.getSessions = originalGetSessions;
});

test("/who shows one connected character per line with system and docked station", () => {
  sessionRegistry.getSessions = () => [
    {
      characterID: 140000002,
      characterName: "Bob",
      solarsystemid2: 30000144,
      lastActivity: 10,
      connectTime: 10,
      clientID: 10,
    },
    {
      characterID: 140000001,
      characterName: "Alice",
      solarsystemid2: 30000144,
      lastActivity: 30,
      connectTime: 30,
      clientID: 30,
    },
    {
      characterID: 140000002,
      characterName: "Bob",
      stationid: 60003760,
      solarsystemid2: 30000142,
      lastActivity: 40,
      connectTime: 40,
      clientID: 40,
    },
  ];

  const result = chatCommands.executeChatCommand(
    null,
    "/who",
    null,
    { emitChatFeedback: false },
  );

  assert.equal(result.handled, true);
  assert.equal(
    result.message,
    [
      "Connected characters (2):",
      "Alice(140000001) - Perimeter",
      "Bob(140000002) - Jita | Docked: Jita IV - Moon 4 - Caldari Navy Assembly Plant",
    ].join("\n"),
  );
});
