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
  "xmppChatMgrParity",
);

process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_CHAT_DATA_ROOT = chatDataRoot;
process.env.EVEJS_CHAT_ALLOW_TEST_RESET = "1";

fs.rmSync(chatDataRoot, {
  recursive: true,
  force: true,
});

const XmppChatMgrService = require(path.join(
  repoRoot,
  "server/src/services/chat/xmppChatMgrService",
));
const chatRuntime = require(path.join(
  repoRoot,
  "server/src/_secondary/chat/chatRuntime",
));
const chatStore = require(path.join(
  repoRoot,
  "server/src/_secondary/chat/chatStore",
));

test.afterEach(() => {
  chatRuntime._testing.resetRuntimeState({
    removeFiles: true,
  });
});

test("ResyncSystemChannelAccess returns the full scoped system chat set including alliance and militia", () => {
  const service = new XmppChatMgrService();
  const session = {
    characterID: 140000001,
    corporationID: 1000044,
    allianceID: 99000001,
    warFactionID: 500001,
    fleetid: 777001,
    solarsystemid2: 30000142,
  };

  const channels = service.Handle_ResyncSystemChannelAccess([], session);

  assert.deepEqual(channels, [
    "local_30000142",
    "alliance_99000001",
    "corp_1000044",
    "fleet_777001",
    "faction_500001",
  ]);
  assert.ok(chatRuntime.getChannel("alliance_99000001"));
  assert.ok(chatRuntime.getChannel("corp_1000044"));
  assert.ok(chatRuntime.getChannel("fleet_777001"));
  assert.ok(chatRuntime.getChannel("faction_500001"));

  const observations = chatStore.getDiscovery().observations;
  assert.equal(Array.isArray(observations.alliance_99000001), true);
  assert.equal(Array.isArray(observations.faction_500001), true);
  assert.equal(channels.includes("alliance_99000001"), true);
  assert.equal(channels.includes("faction_500001"), true);
});

test("GMMute and GMUnmute apply to migrated local chat rooms through the shared runtime", () => {
  const service = new XmppChatMgrService();
  const gmSession = {
    characterID: 140000099,
    solarsystemid2: 30000142,
  };

  assert.equal(
    service.Handle_GMMute(["local", 140000002, "Local mute parity", 90], gmSession),
    true,
  );

  let localRecord = chatRuntime.getChannel("local_30000142");
  assert.equal(localRecord.mutedCharacters["140000002"].reason, "Local mute parity");

  assert.equal(
    service.Handle_GMUnmute(["local", 140000002], gmSession),
    true,
  );

  localRecord = chatRuntime.getChannel("local_30000142");
  assert.equal(localRecord.mutedCharacters["140000002"], undefined);
});

test("EnsureResourceWarsChannelExists provisions the verified resourcewars_<instanceID> room", () => {
  const service = new XmppChatMgrService();
  const roomName = service.Handle_EnsureResourceWarsChannelExists([424242], {});

  assert.equal(roomName, "resourcewars_424242");

  const record = chatStore.getChannelRecord(roomName);
  assert.equal(record.type, "resourcewars");
  assert.equal(record.scope, "resourcewars");
  assert.equal(record.entityID, 424242);
  assert.equal(record.verifiedContract, true);
  assert.equal(record.destroyWhenEmpty, true);
});

test("CreatePlayerOwnedChannel unwraps marshal strings and returns the player_<id> channel name the client joins", () => {
  const service = new XmppChatMgrService();
  const session = {
    characterID: 140000002,
    corporationID: 1000044,
    solarsystemid2: 30000142,
  };

  const channelName = service.Handle_CreatePlayerOwnedChannel([
    { type: "wstring", value: "asd" },
  ], session);

  assert.equal(typeof channelName, "string");
  assert.match(channelName, /^player_\d+$/);

  const record = chatStore.getChannelRecord(channelName);
  assert.equal(record.displayName, "asd");
  assert.equal(record.ownerCharacterID, 140000002);
  assert.equal(record.type, "player");
  assert.equal(record.passwordRequired, false);
  assert.equal(record.password, "");
  assert.deepEqual(record.operatorCharacterIDs, [140000002]);
  assert.equal(record.metadata.joinLink, `joinChannel:${channelName}`);
});

test("help and rookie channel lookups return the current verified CCP static channel IDs", () => {
  const service = new XmppChatMgrService();

  assert.equal(
    service.Handle_GetHelpChannel([], {
      languageID: "en",
    }),
    "system_263238_263262",
  );
  assert.equal(
    service.Handle_GetHelpChannel([], {
      languageID: "de",
    }),
    "system_263238_263267",
  );
  assert.equal(
    service.Handle_GetRookieChannel([], {
      languageID: "en",
    }),
    "system_263238_263259",
  );

  const helpRecord = chatStore.getChannelRecord("system_263238_263262");
  const rookieRecord = chatStore.getChannelRecord("system_263238_263259");
  assert.equal(helpRecord.displayName, "English Help");
  assert.equal(helpRecord.type, "help");
  assert.equal(rookieRecord.displayName, "Rookie Help");
  assert.equal(rookieRecord.type, "rookiehelp");
});

test("verified CCP public channels resolve to stable static room contracts", () => {
  const verifiedRoomNames = chatRuntime.getVerifiedStaticChannels()
    .map((contract) => contract.roomName);

  assert.equal(verifiedRoomNames.includes("system_263328_530248"), true);
  assert.equal(verifiedRoomNames.includes("system_263328_263289"), true);
  assert.equal(verifiedRoomNames.includes("system_263331_263368"), true);
  assert.equal(verifiedRoomNames.includes("system_263328_263339"), true);
  assert.equal(verifiedRoomNames.includes("system_263328_263308"), true);
  assert.equal(verifiedRoomNames.includes("system_263328_263306"), true);

  assert.equal(chatRuntime.getChannel("system_263328_530248").displayName, "Resource Wars");
  assert.equal(chatRuntime.getChannel("system_263328_263289").displayName, "Incursions");
  assert.equal(chatRuntime.getChannel("system_263331_263368").displayName, "Mining");
  assert.equal(chatRuntime.getChannel("system_263328_263339").displayName, "Scanning");
  assert.equal(chatRuntime.getChannel("system_263328_263308").displayName, "Missions");
  assert.equal(chatRuntime.getChannel("system_263328_263306").displayName, "Events");
});

test("player-created channels survive a durable store reload", () => {
  const session = {
    characterID: 140000003,
    corporationID: 1000044,
    solarsystemid2: 30000142,
  };

  const created = chatRuntime.createPlayerChannel(session, {
    displayName: "Restart Safe",
  });
  chatRuntime.joinChannel(session, created.roomName);
  chatRuntime.sendChannelMessage(session, created.roomName, "Persists to disk.");
  chatStore.flushStateNow();

  chatRuntime._testing.resetRuntimeState({
    resetStore: false,
  });
  chatStore.reloadFromDisk();

  const record = chatStore.getChannelRecord(created.roomName);
  const backlog = chatStore.listBacklogEntries(created.roomName, 10);
  assert.equal(record.displayName, "Restart Safe");
  assert.equal(record.ownerCharacterID, 140000003);
  assert.deepEqual(record.operatorCharacterIDs, [140000003]);
  assert.equal(record.metadata.joinLink, `joinChannel:${created.roomName}`);
  assert.equal(backlog.some((entry) => entry.message === "Persists to disk."), true);
});

test("custom EveJS Elysian static room is discoverable without polluting the verified CCP contract list", () => {
  const session = {
    characterID: 140000010,
    corporationID: 1000044,
    solarsystemid2: 30000142,
  };

  const discoverableRoomNames = chatRuntime.listDiscoverableConferenceChannels(session)
    .map((contract) => contract.roomName);
  const verifiedRoomNames = chatRuntime.getVerifiedStaticChannels()
    .map((contract) => contract.roomName);
  const elysianRecord = chatRuntime.getChannel("player_900001");

  assert.equal(discoverableRoomNames[0], "player_900001");
  assert.equal(verifiedRoomNames.includes("player_900001"), false);
  assert.match(elysianRecord.roomName, /^player_\d+$/);
  assert.equal(elysianRecord.type, "player");
  assert.equal(elysianRecord.static, false);
  assert.equal(elysianRecord.displayName, "EveJS Elysian chat");
  assert.match(elysianRecord.motd, /Welcome to EveJS Elysian/);
  assert.equal(
    elysianRecord.metadata.joinLink,
    "joinChannel:player_900001",
  );
});

test("incursion channels use the exact verified room prefixes from the client", () => {
  const incursionRecord = chatRuntime.ensureIncursionChannel(7001);
  const spreadingRecord = chatRuntime.ensureSpreadingIncursionChannel(7002);

  assert.equal(incursionRecord.roomName, "incursion_7001");
  assert.equal(spreadingRecord.roomName, "spreadingIncursion_7002");
  assert.equal(incursionRecord.verifiedContract, true);
  assert.equal(spreadingRecord.verifiedContract, true);
});
