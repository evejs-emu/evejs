const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..");
const chatDataRoot = path.join(
  repoRoot,
  "_local",
  "tmp",
  "chat-tests",
  "fleetChatParity",
);

process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_CHAT_DATA_ROOT = chatDataRoot;
process.env.EVEJS_CHAT_ALLOW_TEST_RESET = "1";

fs.rmSync(chatDataRoot, {
  recursive: true,
  force: true,
});

const fleetRuntime = require(path.join(
  repoRoot,
  "server/src/services/fleets/fleetRuntime",
));
const chatRuntime = require(path.join(
  repoRoot,
  "server/src/_secondary/chat/chatRuntime",
));
const chatStore = require(path.join(
  repoRoot,
  "server/src/_secondary/chat/chatStore",
));

function buildSession(characterID, overrides = {}) {
  return {
    characterID,
    corporationID: 1000044,
    solarsystemid2: 30000142,
    shipTypeID: 603,
    socket: { destroyed: false },
    sendNotification() {},
    sendSessionChange() {},
    ...overrides,
  };
}

function resetFleetRuntimeState() {
  fleetRuntime.runtimeState.nextFleetSerial = 1;
  fleetRuntime.runtimeState.fleets.clear();
  fleetRuntime.runtimeState.characterToFleet.clear();
  fleetRuntime.runtimeState.invitesByCharacter.clear();
}

test.afterEach(() => {
  chatRuntime._testing.resetRuntimeState({
    removeFiles: true,
  });
  resetFleetRuntimeState();
});

test("fleet chat lifecycle keeps fleet_<fleetID> parity and mirrors MOTD updates", () => {
  const leaderSession = buildSession(140000001);
  const memberSession = buildSession(140000002);

  const fleet = fleetRuntime.createFleetRecord(leaderSession);
  const roomName = `fleet_${fleet.fleetID}`;

  let roomRecord = chatStore.getChannelRecord(roomName);
  assert.ok(roomRecord);
  assert.equal(roomRecord.type, "fleet");
  assert.equal(roomRecord.destroyWhenEmpty, true);

  fleetRuntime.initFleet(leaderSession, fleet.fleetID);
  roomRecord = chatStore.getChannelRecord(roomName);
  assert.equal(roomRecord.metadata.fleetID, fleet.fleetID);
  assert.equal(roomRecord.metadata.creatorCharID, 140000001);

  assert.equal(
    fleetRuntime.inviteCharacter(
      leaderSession,
      fleet.fleetID,
      memberSession.characterID,
      null,
      null,
      fleetRuntime.FLEET.FLEET_ROLE_MEMBER,
    ),
    true,
  );
  assert.equal(
    fleetRuntime.acceptInvite(memberSession, fleet.fleetID),
    true,
  );

  fleetRuntime.setMotd(leaderSession, fleet.fleetID, "Fleet parity MOTD");
  roomRecord = chatStore.getChannelRecord(roomName);
  assert.equal(roomRecord.motd, "Fleet parity MOTD");

  fleetRuntime.disbandFleet(leaderSession, fleet.fleetID);
  assert.equal(chatStore.getChannelRecord(roomName), null);
});

test("fleet chat access tracks live fleet membership and rejects non-members immediately", () => {
  const leaderSession = buildSession(140000011);
  const memberSession = buildSession(140000012);
  const outsiderSession = buildSession(140000013);

  const fleet = fleetRuntime.createFleetRecord(leaderSession);
  fleetRuntime.initFleet(leaderSession, fleet.fleetID);

  assert.equal(
    fleetRuntime.inviteCharacter(
      leaderSession,
      fleet.fleetID,
      memberSession.characterID,
      null,
      null,
      fleetRuntime.FLEET.FLEET_ROLE_MEMBER,
    ),
    true,
  );
  assert.equal(fleetRuntime.acceptInvite(memberSession, fleet.fleetID), true);

  assert.equal(
    chatRuntime.joinChannel(leaderSession, `fleet_${fleet.fleetID}`).record.roomName,
    `fleet_${fleet.fleetID}`,
  );
  assert.equal(
    chatRuntime.joinChannel(memberSession, `fleet_${fleet.fleetID}`).record.roomName,
    `fleet_${fleet.fleetID}`,
  );
  assert.throws(
    () => chatRuntime.joinChannel(outsiderSession, `fleet_${fleet.fleetID}`),
    /fleet_mismatch/,
  );

  assert.equal(fleetRuntime.leaveFleet(memberSession, fleet.fleetID), true);
  assert.throws(
    () => chatRuntime.joinChannel(memberSession, `fleet_${fleet.fleetID}`),
    /fleet_mismatch/,
  );
});
