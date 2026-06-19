const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

function clearRuntimeCycle() {
  const modulePaths = [
    path.join(repoRoot, "server/src/services/character/charService"),
    path.join(repoRoot, "server/src/space/transitions"),
    path.join(repoRoot, "server/src/services/chat/commandSessionEffects"),
    path.join(repoRoot, "server/src/services/chat/chatCommands"),
    path.join(repoRoot, "server/src/space/runtime"),
  ];
  for (const modulePath of modulePaths) {
    delete require.cache[require.resolve(modulePath)];
  }
}

function buildSession(userID) {
  return {
    userid: userID,
    clientID: 999,
    clientId: 999,
    sid: 1n,
    socket: { destroyed: false, write() {} },
    sendPacket() {},
    sendNotification() {},
    sendServiceNotification() {},
    sendSessionChange() {},
  };
}

function findSpaceCharacter(database, getActiveShipRecord) {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters table");

  const entry = Object.entries(charactersResult.data || {})
    .map(([characterID, character]) => ({
      characterID: Number(characterID) || 0,
      accountID: Number(character && (character.accountId ?? character.accountID)) || 0,
    }))
    .find((candidate) => {
      const ship = getActiveShipRecord(candidate.characterID);
      return candidate.accountID > 0 && ship && ship.spaceState;
    });

  assert.ok(entry, "Expected an owned in-space character for runtime startup test");
  return entry;
}

test("space runtime export survives runtime-first circular startup order", () => {
  clearRuntimeCycle();

  const runtime = require(path.join(repoRoot, "server/src/space/runtime"));
  const CharService = require(path.join(
    repoRoot,
    "server/src/services/character/charService",
  ));
  const database = require(path.join(repoRoot, "server/src/newDatabase"));
  const {
    getActiveShipRecord,
  } = require(path.join(
    repoRoot,
    "server/src/services/character/characterState",
  ));

  const { characterID, accountID } = findSpaceCharacter(database, getActiveShipRecord);
  const session = buildSession(accountID);
  const service = new CharService();

  runtime._testing.clearScenes();
  try {
    assert.equal(typeof runtime.attachSession, "function");
    assert.doesNotThrow(() => {
      service.Handle_SelectCharacterID([characterID], session, null);
    });
    assert.ok(
      session._space,
      "expected SelectCharacterID to restore the space session after runtime-first startup",
    );
  } finally {
    runtime._testing.clearScenes();
  }
});
