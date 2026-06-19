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
  "xmppStubServerParity",
);

process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_CHAT_DATA_ROOT = chatDataRoot;
process.env.EVEJS_CHAT_ALLOW_TEST_RESET = "1";

fs.rmSync(chatDataRoot, {
  recursive: true,
  force: true,
});

const xmppStubServer = require(path.join(
  repoRoot,
  "server/src/services/chat/xmppStubServer",
));
const ClientSession = require(path.join(
  repoRoot,
  "server/src/network/clientSession",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const chatStore = require(path.join(
  repoRoot,
  "server/src/_secondary/chat/chatStore",
));
const chatRuntime = require(path.join(
  repoRoot,
  "server/src/_secondary/chat/chatRuntime",
));

const originalGetSessions = sessionRegistry.getSessions;
const CORP_ROLE_CHAT_MANAGER = 36028797018963968n;

function buildClient(charId) {
  const sent = [];
  return {
    userName: String(charId),
    boundJid: `${charId}@localhost/evejs`,
    nick: String(charId),
    lastRoomJid: "",
    localWelcomeSent: false,
    roomBacklogCursorMs: new Map(),
    rooms: new Set(),
    socket: {
      destroyed: false,
      write(xml) {
        sent.push(xml);
      },
    },
    getSent() {
      return sent.slice();
    },
    clearSent() {
      sent.length = 0;
    },
  };
}

function buildSession(characterID, overrides = {}) {
  return {
    characterID,
    corporationID: 1000044,
    solarsystemid2: 30000142,
    socket: { destroyed: false },
    ...overrides,
  };
}

test.afterEach(() => {
  sessionRegistry.getSessions = originalGetSessions;
  xmppStubServer.__test__.resetState();
});

test("regular local chat exchanges occupant presence on join and leave", { concurrency: false }, () => {
  sessionRegistry.getSessions = () => [
    buildSession(140000001),
    buildSession(140000002),
  ];

  const clientA = buildClient(140000001);
  const clientB = buildClient(140000002);
  xmppStubServer.__test__.registerClient(clientA);
  xmppStubServer.__test__.registerClient(clientB);

  xmppStubServer.__test__.handleJoinPresence(
    clientA,
    "<presence to='local@conference.localhost/140000001' id='join-a'/>",
  );
  clientA.clearSent();

  xmppStubServer.__test__.handleJoinPresence(
    clientB,
    "<presence to='local@conference.localhost/140000002' id='join-b'/>",
  );

  assert.equal(
    clientB.getSent().some((xml) =>
      xml.includes("from='local_30000142@conference.localhost/140000001'"),
    ),
    true,
  );
  assert.equal(
    clientA.getSent().some((xml) =>
      xml.includes("from='local_30000142@conference.localhost/140000002'"),
    ),
    true,
  );

  clientA.clearSent();
  xmppStubServer.__test__.handleJoinPresence(
    clientB,
    "<presence to='local@conference.localhost/140000002' id='leave-b' type='unavailable'/>",
  );
  assert.equal(
    clientA.getSent().some((xml) =>
      xml.includes("from='local_30000142@conference.localhost/140000002'") &&
      xml.includes("type='unavailable'"),
    ),
    true,
  );
});

test("highsec local joins advertise same-system connected pilots even if their local xmpp room state was not established yet", { concurrency: false }, () => {
  sessionRegistry.getSessions = () => [
    buildSession(140000001),
    buildSession(140000002),
  ];

  const clientA = buildClient(140000001);
  const clientB = buildClient(140000002);
  xmppStubServer.__test__.registerClient(clientA);
  xmppStubServer.__test__.registerClient(clientB);

  xmppStubServer.__test__.handleJoinPresence(
    clientB,
    "<presence to='local@conference.localhost/140000002' id='join-b'/>",
  );

  assert.equal(
    clientB.getSent().some((xml) =>
      xml.includes("from='local_30000142@conference.localhost/140000001'"),
    ),
    true,
  );
  assert.equal(
    clientA.getSent().some((xml) =>
      xml.includes("from='local_30000142@conference.localhost/140000002'"),
    ),
    true,
  );
  assert.equal(
    clientA.rooms.has("local_30000142@conference.localhost"),
    true,
  );
});

test("wormhole local suppresses occupant presence and normalizes bare local joins", { concurrency: false }, () => {
  sessionRegistry.getSessions = () => [
    buildSession(140000001, {
      solarsystemid2: 31000005,
    }),
    buildSession(140000002, {
      solarsystemid2: 31000005,
    }),
  ];

  const clientA = buildClient(140000001);
  const clientB = buildClient(140000002);
  xmppStubServer.__test__.registerClient(clientA);
  xmppStubServer.__test__.registerClient(clientB);

  assert.equal(
    xmppStubServer.__test__.normalizeRoomJid(
      "local@conference.localhost",
      clientA,
    ),
    "wormhole_31000005@conference.localhost",
  );

  xmppStubServer.__test__.handleJoinPresence(
    clientA,
    "<presence to='local@conference.localhost/140000001' id='join-a'/>",
  );
  clientA.clearSent();

  xmppStubServer.__test__.handleJoinPresence(
    clientB,
    "<presence to='local@conference.localhost/140000002' id='join-b'/>",
  );

  assert.equal(
    clientB.getSent().some((xml) =>
      xml.includes("from='wormhole_31000005@conference.localhost/140000001'"),
    ),
    false,
  );
  assert.equal(
    clientA.getSent().some((xml) =>
      xml.includes("from='wormhole_31000005@conference.localhost/140000002'"),
    ),
    false,
  );
});

test("global session changes move highsec Local occupants between solar systems without requiring anyone to speak", { concurrency: false }, () => {
  const moverSession = new ClientSession(
    {
      userId: 424,
      userName: "140000024",
      clientId: 140000024,
      sessionId: 140000024,
      role: 0,
    },
    {
      destroyed: false,
      remoteAddress: "127.0.0.1",
      write() {},
    },
  );
  moverSession.sendPacket = () => {};
  moverSession.characterID = 140000024;
  moverSession.characterName = "Local Jumper";
  moverSession.corporationID = 1000044;
  moverSession.corpid = 1000044;
  moverSession.solarsystemid2 = 30000142;
  moverSession.locationid = 30000142;

  const oldLocalSession = buildSession(140000025, {
    solarsystemid2: 30000142,
  });
  const newLocalSession = buildSession(140000026, {
    solarsystemid2: 30000144,
  });

  sessionRegistry.getSessions = () => [
    moverSession,
    oldLocalSession,
    newLocalSession,
  ];

  const moverClient = buildClient(140000024);
  const oldLocalClient = buildClient(140000025);
  const newLocalClient = buildClient(140000026);
  xmppStubServer.__test__.registerClient(moverClient);
  xmppStubServer.__test__.registerClient(oldLocalClient);
  xmppStubServer.__test__.registerClient(newLocalClient);

  xmppStubServer.__test__.handleJoinPresence(
    oldLocalClient,
    "<presence to='local@conference.localhost/140000025' id='old-local-join'/>",
  );
  xmppStubServer.__test__.handleJoinPresence(
    newLocalClient,
    "<presence to='local@conference.localhost/140000026' id='new-local-join'/>",
  );
  xmppStubServer.__test__.handleJoinPresence(
    moverClient,
    "<presence to='local@conference.localhost/140000024' id='mover-local-join'/>",
  );

  assert.equal(moverClient.rooms.has("local_30000142@conference.localhost"), true);
  assert.equal(moverClient.rooms.has("local_30000144@conference.localhost"), false);

  moverClient.clearSent();
  oldLocalClient.clearSent();
  newLocalClient.clearSent();

  moverSession.solarsystemid2 = 30000144;
  moverSession.locationid = 30000144;
  moverSession.sendSessionChange({
    solarsystemid2: [30000142, 30000144],
    locationid: [30000142, 30000144],
  });

  assert.equal(moverClient.rooms.has("local_30000142@conference.localhost"), false);
  assert.equal(moverClient.rooms.has("local_30000144@conference.localhost"), true);
  assert.equal(
    oldLocalClient.getSent().some((xml) =>
      xml.includes("from='local_30000142@conference.localhost/140000024'") &&
      xml.includes("type='unavailable'"),
    ),
    true,
  );
  assert.equal(
    newLocalClient.getSent().some((xml) =>
      xml.includes("from='local_30000144@conference.localhost/140000024'") &&
      xml.includes("<item affiliation='member' role='participant'"),
    ),
    true,
  );
  assert.equal(
    moverClient.getSent().some((xml) =>
      xml.includes("from='local_30000144@conference.localhost/140000026'") &&
      xml.includes("<item affiliation='member' role='participant'"),
    ),
    true,
  );
});

test("corp channels publish accurate occupant counts through disco info", { concurrency: false }, () => {
  sessionRegistry.getSessions = () => [
    buildSession(140000001),
    buildSession(140000002),
  ];

  const clientA = buildClient(140000001);
  const clientB = buildClient(140000002);
  xmppStubServer.__test__.registerClient(clientA);
  xmppStubServer.__test__.registerClient(clientB);

  xmppStubServer.__test__.handleJoinPresence(
    clientA,
    "<presence to='corp@conference.localhost/140000001' id='corp-a'/>",
  );
  xmppStubServer.__test__.handleJoinPresence(
    clientB,
    "<presence to='corp@conference.localhost/140000002' id='corp-b'/>",
  );

  clientA.clearSent();
  xmppStubServer.__test__.handleReadyIq(
    clientA,
    "<iq id='disco-1' type='get' to='corp@conference.localhost'><query xmlns='http://jabber.org/protocol/disco#info'/></iq>",
  );

  assert.equal(
    clientA.getSent().some((xml) => xml.includes("<value>2</value>")),
    true,
  );
});

test("local chat answers muc#admin affiliation queries instead of timing out", { concurrency: false }, () => {
  sessionRegistry.getSessions = () => [
    buildSession(140000001),
  ];

  const clientA = buildClient(140000001);
  xmppStubServer.__test__.registerClient(clientA);

  xmppStubServer.__test__.handleJoinPresence(
    clientA,
    "<presence to='local@conference.localhost/140000001' id='join-a'/>",
  );

  clientA.clearSent();
  xmppStubServer.__test__.handleReadyIq(
    clientA,
    "<iq id='admin-1' type='get' to='local_30000142@conference.localhost'><query xmlns='http://jabber.org/protocol/muc#admin'><item affiliation='owner'/></query></iq>",
  );

  assert.equal(
    clientA.getSent().some((xml) =>
      xml.includes("type='result'") &&
      xml.includes("xmlns='http://jabber.org/protocol/muc#admin'"),
    ),
    true,
  );
});

test("conference disco items exposes static rooms with EveJS Elysian first and custom player channels through forme and byname lookups", { concurrency: false }, () => {
  sessionRegistry.getSessions = () => [
    buildSession(140000001),
  ];

  const client = buildClient(140000001);
  xmppStubServer.__test__.registerClient(client);

  xmppStubServer.__test__.handleReadyIq(
    client,
    "<iq id='forme-empty' type='get' to='conference.localhost'><query xmlns='http://jabber.org/protocol/disco#items' node='forme'/></iq>",
  );

  const formeEmptyXml = client.getSent().find((xml) => xml.includes("id='forme-empty'")) || "";
  assert.equal(
    formeEmptyXml.includes("type='result'") &&
      formeEmptyXml.includes("from='conference.localhost'") &&
      formeEmptyXml.includes("node='forme'") &&
      formeEmptyXml.includes("jid='player_900001@conference.localhost'") &&
      formeEmptyXml.includes("name='EveJS Elysian chat'") &&
      formeEmptyXml.includes("jid='system_263238_263262@conference.localhost'") &&
      formeEmptyXml.includes("name='English Help'") &&
      formeEmptyXml.includes("jid='system_263328_530248@conference.localhost'") &&
      formeEmptyXml.includes("name='Resource Wars'"),
    true,
  );
  assert.ok(
    formeEmptyXml.indexOf("jid='player_900001@conference.localhost'") <
      formeEmptyXml.indexOf("jid='system_263238_263262@conference.localhost'"),
  );

  client.clearSent();
  xmppStubServer.__test__.handleReadyIq(
    client,
    "<iq id='byname-empty' type='get' to='conference.localhost'><query xmlns='http://jabber.org/protocol/disco#items' node='byname/testr'/></iq>",
  );

  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("type='result'") &&
      xml.includes("node='byname/testr'") &&
      !xml.includes("<item "),
    ),
    true,
  );

  client.clearSent();
  xmppStubServer.__test__.handleReadyIq(
    client,
    "<iq id='byname-static' type='get' to='conference.localhost'><query xmlns='http://jabber.org/protocol/disco#items' node='byname/English Help'/></iq>",
  );

  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("type='result'") &&
      xml.includes("node='byname/English Help'") &&
      xml.includes("jid='system_263238_263262@conference.localhost'") &&
      xml.includes("name='English Help'"),
    ),
    true,
  );

  xmppStubServer.__test__.handleJoinPresence(
    client,
    "<presence to='testr@conference.localhost/140000001' id='testr-join'/>",
  );

  client.clearSent();
  xmppStubServer.__test__.handleReadyIq(
    client,
    "<iq id='byname-hit' type='get' to='conference.localhost'><query xmlns='http://jabber.org/protocol/disco#items' node='byname/testr'/></iq>",
  );

  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("type='result'") &&
      xml.includes("node='byname/testr'") &&
      xml.includes("jid='testr@conference.localhost'") &&
      xml.includes("name='testr'"),
    ),
    true,
  );

  client.clearSent();
  xmppStubServer.__test__.handleReadyIq(
    client,
    "<iq id='forme-hit' type='get' to='conference.localhost'><query xmlns='http://jabber.org/protocol/disco#items' node='forme'/></iq>",
  );

  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("type='result'") &&
      xml.includes("node='forme'") &&
      xml.includes("jid='player_900001@conference.localhost'") &&
      xml.includes("jid='system_263238_263262@conference.localhost'") &&
      xml.includes("jid='testr@conference.localhost'") &&
      xml.includes("name='testr'"),
    ),
    true,
  );
});

test("conference node disco info returns player room metadata without inventing a conference.localhost room", { concurrency: false }, () => {
  sessionRegistry.getSessions = () => [
    buildSession(140000002),
  ];

  const client = buildClient(140000002);
  xmppStubServer.__test__.registerClient(client);
  chatRuntime.ensurePlayerChannel(1000002, {
    displayName: "Parity Name",
  });

  xmppStubServer.__test__.handleJoinPresence(
    client,
    "<presence to='player_1000002@conference.localhost/140000002' id='player-join'/>",
  );

  client.clearSent();
  xmppStubServer.__test__.handleReadyIq(
    client,
    "<iq id='node-info-1' type='get' to='conference.localhost'><query xmlns='http://jabber.org/protocol/disco#info' node='player_1000002'/></iq>",
  );

  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("type='result'") &&
      xml.includes("from='conference.localhost'") &&
      xml.includes("node='player_1000002'") &&
      xml.includes("type='player'") &&
      xml.includes("name='Parity Name'") &&
      !xml.includes("conference.localhost@conference.localhost"),
    ),
    true,
  );
  assert.equal(chatStore.getChannelRecord("conference.localhost"), null);
});

test("verified help channels stay static and are not promoted into player-owned rooms", { concurrency: false }, () => {
  sessionRegistry.getSessions = () => [
    buildSession(140000004),
  ];

  const client = buildClient(140000004);
  xmppStubServer.__test__.registerClient(client);

  xmppStubServer.__test__.handleJoinPresence(
    client,
    "<presence to='system_263238_263262@conference.localhost/140000004' id='help-join'/>",
  );

  const helpRecord = chatStore.getChannelRecord("system_263238_263262");
  assert.equal(helpRecord.type, "help");
  assert.equal(helpRecord.ownerCharacterID, 0);
  assert.equal(helpRecord.static, true);
  assert.equal(helpRecord.displayName, "English Help");
});

test("EveJS Elysian custom room behaves like a durable player channel and sends its MOTD on join", { concurrency: false }, () => {
  sessionRegistry.getSessions = () => [
    buildSession(140000040),
  ];

  const client = buildClient(140000040);
  xmppStubServer.__test__.registerClient(client);

  xmppStubServer.__test__.handleReadyIq(
    client,
    "<iq id='elysian-info' type='get' to='conference.localhost'><query xmlns='http://jabber.org/protocol/disco#info' node='player_900001'/></iq>",
  );

  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("id='elysian-info'") &&
      xml.includes("from='conference.localhost'") &&
      xml.includes("node='player_900001'") &&
      xml.includes("type='player'") &&
      xml.includes("name='EveJS Elysian chat'"),
    ),
    true,
  );

  client.clearSent();
  xmppStubServer.__test__.handleJoinPresence(
    client,
    "<presence to='player_900001@conference.localhost/140000040' id='elysian-join'/>",
  );

  assert.equal(
    client.rooms.has("player_900001@conference.localhost"),
    true,
  );
  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("from='player_900001@conference.localhost/140000040'") &&
      xml.includes("<status code='110'/>"),
    ),
    true,
  );
  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("<subject>Welcome to EveJS Elysian.") &&
      xml.includes("forge full chat parity together."),
    ),
    true,
  );
});

test("normal room joins do not replay persisted offline speakers unless history was requested", { concurrency: false }, () => {
  sessionRegistry.getSessions = () => [
    buildSession(140000008),
  ];

  chatRuntime.ensurePlayerChannel(1000099, {
    displayName: "Replay Guard",
    motd: "Replay Guard MOTD",
  });
  chatStore.appendBacklogEntry(
    "player_1000099",
    {
      roomName: "player_1000099",
      characterID: 140000003,
      characterName: "Offline Speaker",
      message: "I should not be replayed on a normal join.",
      createdAtMs: Date.now() - 30_000,
    },
    {
      limit: 100,
    },
  );

  const client = buildClient(140000008);
  xmppStubServer.__test__.registerClient(client);

  xmppStubServer.__test__.handleJoinPresence(
    client,
    "<presence to='player_1000099@conference.localhost/140000008' id='replay-guard-join'><x xmlns='http://jabber.org/protocol/muc'></x></presence>",
  );

  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("I should not be replayed on a normal join."),
    ),
    false,
  );

  client.clearSent();
  xmppStubServer.__test__.handleJoinPresence(
    client,
    "<presence to='player_1000099@conference.localhost/140000008' id='replay-guard-history'><x xmlns='http://jabber.org/protocol/muc'><history seconds='60'/></x></presence>",
  );

  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("I should not be replayed on a normal join."),
    ),
    true,
  );
});

test("corp channels keep MOTD parity and only replay requested backlog once", { concurrency: false }, () => {
  sessionRegistry.getSessions = () => [
    buildSession(140000001, {
      corprole: CORP_ROLE_CHAT_MANAGER,
    }),
    buildSession(140000002),
  ];

  const clientA = buildClient(140000001);
  const clientB = buildClient(140000002);
  xmppStubServer.__test__.registerClient(clientA);
  xmppStubServer.__test__.registerClient(clientB);

  xmppStubServer.__test__.handleJoinPresence(
    clientA,
    "<presence to='corp@conference.localhost/140000001' id='corp-a'/>",
  );

  xmppStubServer.__test__.handleGroupMessage(
    clientA,
    "<message to='corp@conference.localhost' type='groupchat'><subject>Corp MOTD parity</subject></message>",
  );
  xmppStubServer.__test__.handleGroupMessage(
    clientA,
    "<message to='corp@conference.localhost' type='groupchat'><body>Backlog survives and replays.</body></message>",
  );

  const corpRecord = chatStore.getChannelRecord("corp_1000044");
  assert.equal(corpRecord.motd, "Corp MOTD parity");

  clientB.clearSent();
  xmppStubServer.__test__.handleJoinPresence(
    clientB,
    "<presence to='corp@conference.localhost/140000002' id='corp-b'/>",
  );

  assert.equal(
    clientB.getSent().some((xml) => xml.includes("<subject>Corp MOTD parity</subject>")),
    true,
  );
  assert.equal(
    clientB.getSent().some((xml) => xml.includes("Backlog survives and replays.")),
    false,
  );

  clientB.clearSent();
  xmppStubServer.__test__.handleJoinPresence(
    clientB,
    "<presence to='corp@conference.localhost/140000002' id='corp-b-history'><x xmlns='http://jabber.org/protocol/muc'><history seconds='600'/></x></presence>",
  );

  assert.equal(
    clientB.getSent().some((xml) => xml.includes("Backlog survives and replays.")),
    true,
  );

  clientB.clearSent();
  xmppStubServer.__test__.handleJoinPresence(
    clientB,
    "<presence to='corp@conference.localhost/140000002' id='corp-b-history-again'><x xmlns='http://jabber.org/protocol/muc'><history seconds='600'/></x></presence>",
  );

  assert.equal(
    clientB.getSent().some((xml) => xml.includes("Backlog survives and replays.")),
    false,
  );
});

test("groupchat echoes preserve the sender stanza id so pending sends clear as delivered", { concurrency: false }, () => {
  sessionRegistry.getSessions = () => [
    buildSession(140000001, {
      corprole: CORP_ROLE_CHAT_MANAGER,
    }),
    buildSession(140000002),
  ];

  const senderClient = buildClient(140000001);
  const recipientClient = buildClient(140000002);
  xmppStubServer.__test__.registerClient(senderClient);
  xmppStubServer.__test__.registerClient(recipientClient);

  xmppStubServer.__test__.handleJoinPresence(
    senderClient,
    "<presence to='corp@conference.localhost/140000001' id='corp-sender'/>",
  );
  xmppStubServer.__test__.handleJoinPresence(
    recipientClient,
    "<presence to='corp@conference.localhost/140000002' id='corp-recipient'/>",
  );

  senderClient.clearSent();
  recipientClient.clearSent();
  xmppStubServer.__test__.handleGroupMessage(
    senderClient,
    "<message to='corp@conference.localhost' type='groupchat' id='msg-parity-1'><body>Echo contract parity.</body></message>",
  );

  assert.equal(
    senderClient.getSent().some((xml) =>
      xml.includes("from='corp_1000044@conference.localhost/140000001'") &&
      xml.includes("id='msg-parity-1'") &&
      xml.includes("<body>Echo contract parity.</body>"),
    ),
    true,
  );
  assert.equal(
    recipientClient.getSent().some((xml) =>
      xml.includes("from='corp_1000044@conference.localhost/140000001'") &&
      xml.includes("id='msg-parity-1'") &&
      xml.includes("<body>Echo contract parity.</body>"),
    ),
    true,
  );
});

test("player-created rooms support owner config, passwords, invites, and bans", { concurrency: false }, () => {
  sessionRegistry.getSessions = () => [
    buildSession(140000001),
    buildSession(140000002),
    buildSession(140000003),
  ];

  const ownerClient = buildClient(140000001);
  const invitedClient = buildClient(140000002);
  const bannedClient = buildClient(140000003);
  xmppStubServer.__test__.registerClient(ownerClient);
  xmppStubServer.__test__.registerClient(invitedClient);
  xmppStubServer.__test__.registerClient(bannedClient);

  xmppStubServer.__test__.handleJoinPresence(
    ownerClient,
    "<presence to='parity-room@conference.localhost/140000001' id='owner-join'/>",
  );

  let roomRecord = chatStore.getChannelRecord("parity-room");
  assert.equal(roomRecord.type, "player");
  assert.equal(roomRecord.ownerCharacterID, 140000001);
  assert.equal(roomRecord.metadata.joinLink, "joinChannel:parity-room");

  ownerClient.clearSent();
  xmppStubServer.__test__.handleReadyIq(
    ownerClient,
    "<iq id='owner-set' type='set' to='parity-room@conference.localhost'><query xmlns='http://jabber.org/protocol/muc#owner'><x xmlns='jabber:x:data' type='submit'><field var='muc#roomconfig_roomname'><value>Parity Ops</value></field><field var='muc#roomconfig_roomdesc'><value>Locked Test Room</value></field><field var='muc#roomconfig_passwordprotectedroom'><value>1</value></field><field var='muc#roomconfig_roomsecret'><value>swordfish</value></field><field var='muc#roomconfig_membersonly'><value>1</value></field><field var='muc#roomconfig_persistentroom'><value>1</value></field></x></query></iq>",
  );

  roomRecord = chatStore.getChannelRecord("parity-room");
  assert.equal(roomRecord.displayName, "Parity Ops");
  assert.equal(roomRecord.topic, "Locked Test Room");
  assert.equal(roomRecord.passwordRequired, true);
  assert.equal(roomRecord.password, "swordfish");
  assert.equal(roomRecord.inviteOnly, true);

  invitedClient.clearSent();
  xmppStubServer.__test__.handleJoinPresence(
    invitedClient,
    "<presence to='parity-room@conference.localhost/140000002' id='invitee-no-password'/>",
  );
  assert.equal(
    invitedClient.getSent().some((xml) => xml.includes("Invite required.")),
    true,
  );

  invitedClient.clearSent();
  xmppStubServer.__test__.handleGroupMessage(
    ownerClient,
    "<message to='parity-room@conference.localhost' type='groupchat'><x xmlns='http://jabber.org/protocol/muc#user'><invite to='140000002@localhost'><reason>Join parity room</reason></invite></x></message>",
  );

  roomRecord = chatStore.getChannelRecord("parity-room");
  assert.equal(roomRecord.invitedCharacters.includes(140000002), true);
  assert.equal(
    invitedClient.getSent().some((xml) =>
      xml.includes("parity-room@conference.localhost") &&
      xml.includes("<invite from='140000001@localhost'>"),
    ),
    true,
  );

  invitedClient.clearSent();
  xmppStubServer.__test__.handleJoinPresence(
    invitedClient,
    "<presence to='parity-room@conference.localhost/140000002' id='invitee-no-password-after-invite'/>",
  );
  assert.equal(
    invitedClient.getSent().some((xml) => xml.includes("Password required.")),
    true,
  );

  invitedClient.clearSent();
  xmppStubServer.__test__.handleJoinPresence(
    invitedClient,
    "<presence to='parity-room@conference.localhost/140000002' id='invitee-join'><x xmlns='http://jabber.org/protocol/muc'><password>swordfish</password></x></presence>",
  );
  assert.equal(
    invitedClient.rooms.has("parity-room@conference.localhost"),
    true,
  );

  ownerClient.clearSent();
  xmppStubServer.__test__.handleReadyIq(
    ownerClient,
    "<iq id='ban-1' type='set' to='parity-room@conference.localhost'><query xmlns='http://jabber.org/protocol/muc#admin'><item jid='140000003@localhost' affiliation='outcast'><reason>Access revoked</reason></item></query></iq>",
  );

  roomRecord = chatStore.getChannelRecord("parity-room");
  assert.equal(roomRecord.bannedCharacters["140000003"].reason, "Access revoked");

  bannedClient.clearSent();
  xmppStubServer.__test__.handleJoinPresence(
    bannedClient,
    "<presence to='parity-room@conference.localhost/140000003' id='banned-join'><x xmlns='http://jabber.org/protocol/muc'><password>swordfish</password></x></presence>",
  );
  assert.equal(
    bannedClient.getSent().some((xml) =>
      xml.includes("You are banned from this channel."),
    ),
    true,
  );
});

test("player-created room admin affiliation queries stay filtered so owner is not echoed into member or outcast lists", { concurrency: false }, () => {
  const session = buildSession(140000021);
  sessionRegistry.getSessions = () => [session];

  const ownerClient = buildClient(140000021);
  xmppStubServer.__test__.registerClient(ownerClient);

  const created = chatRuntime.createPlayerChannel(session, {
    displayName: "ACL Parity",
  });

  xmppStubServer.__test__.handleJoinPresence(
    ownerClient,
    `<presence to='${created.roomName}@conference.localhost/140000021' id='owner-join'/>`,
  );

  ownerClient.clearSent();
  xmppStubServer.__test__.handleReadyIq(
    ownerClient,
    `<iq id='acl-owner' type='get' to='${created.roomName}@conference.localhost'><query xmlns='http://jabber.org/protocol/muc#admin'><item affiliation='owner'/></query></iq>`,
  );
  xmppStubServer.__test__.handleReadyIq(
    ownerClient,
    `<iq id='acl-admin' type='get' to='${created.roomName}@conference.localhost'><query xmlns='http://jabber.org/protocol/muc#admin'><item affiliation='admin'/></query></iq>`,
  );
  xmppStubServer.__test__.handleReadyIq(
    ownerClient,
    `<iq id='acl-member' type='get' to='${created.roomName}@conference.localhost'><query xmlns='http://jabber.org/protocol/muc#admin'><item affiliation='member'/></query></iq>`,
  );
  xmppStubServer.__test__.handleReadyIq(
    ownerClient,
    `<iq id='acl-outcast' type='get' to='${created.roomName}@conference.localhost'><query xmlns='http://jabber.org/protocol/muc#admin'><item affiliation='outcast'/></query></iq>`,
  );

  const ownerXml = ownerClient.getSent().find((xml) => xml.includes("id='acl-owner'")) || "";
  const adminXml = ownerClient.getSent().find((xml) => xml.includes("id='acl-admin'")) || "";
  const memberXml = ownerClient.getSent().find((xml) => xml.includes("id='acl-member'")) || "";
  const outcastXml = ownerClient.getSent().find((xml) => xml.includes("id='acl-outcast'")) || "";

  assert.equal(
    ownerXml.includes("affiliation='owner'") &&
      ownerXml.includes("jid='140000021@localhost'"),
    true,
  );
  assert.equal(
    adminXml.includes("affiliation='admin'") &&
      adminXml.includes("jid='140000021@localhost'"),
    true,
  );
  assert.equal(memberXml.includes("<item "), false);
  assert.equal(outcastXml.includes("<item "), false);
});

test("channel settings expiring-record searches return mute and ban entries instead of timing out", { concurrency: false }, () => {
  sessionRegistry.getSessions = () => [
    buildSession(140000001),
  ];

  const ownerClient = buildClient(140000001);
  xmppStubServer.__test__.registerClient(ownerClient);

  xmppStubServer.__test__.handleJoinPresence(
    ownerClient,
    "<presence to='player_1000003@conference.localhost/140000001' id='owner-join'/>",
  );

  chatRuntime.muteChannelCharacter(
    "player_1000003",
    140000002,
    60000,
    "Muted for parity test",
    140000001,
  );
  chatRuntime.banChannelCharacter(
    "player_1000003",
    140000003,
    120000,
    "Banned for parity test",
    140000001,
  );

  ownerClient.clearSent();
  xmppStubServer.__test__.handleReadyIq(
    ownerClient,
    "<iq id='mute-search' type='get' to='localhost'><query xmlns='urn:xmpp:expiring_record#search' room='player_1000003@conference.localhost' category='mute'/></iq>",
  );

  assert.equal(
    ownerClient.getSent().some((xml) =>
      xml.includes("type='result'") &&
      xml.includes("xmlns='urn:xmpp:expiring_record#search'") &&
      xml.includes("category='mute'") &&
      xml.includes("jid='140000002@localhost'") &&
      xml.includes("reason='Muted for parity test'"),
    ),
    true,
  );

  ownerClient.clearSent();
  xmppStubServer.__test__.handleReadyIq(
    ownerClient,
    "<iq id='ban-search' type='get' to='localhost'><query xmlns='urn:xmpp:expiring_record#search' room='player_1000003@conference.localhost' category='ban'/></iq>",
  );

  assert.equal(
    ownerClient.getSent().some((xml) =>
      xml.includes("type='result'") &&
      xml.includes("category='ban'") &&
      xml.includes("jid='140000003@localhost'") &&
      xml.includes("reason='Banned for parity test'"),
    ),
    true,
  );
});

test("destroying a player-owned channel removes it from members and future conference discovery", { concurrency: false }, () => {
  sessionRegistry.getSessions = () => [
    buildSession(140000001),
    buildSession(140000002),
  ];

  const ownerClient = buildClient(140000001);
  const guestClient = buildClient(140000002);
  xmppStubServer.__test__.registerClient(ownerClient);
  xmppStubServer.__test__.registerClient(guestClient);

  xmppStubServer.__test__.handleJoinPresence(
    ownerClient,
    "<presence to='player_1000003@conference.localhost/140000001' id='owner-join'/>",
  );
  xmppStubServer.__test__.handleJoinPresence(
    guestClient,
    "<presence to='player_1000003@conference.localhost/140000002' id='guest-join'/>",
  );

  ownerClient.clearSent();
  guestClient.clearSent();
  xmppStubServer.__test__.handleReadyIq(
    ownerClient,
    "<iq id='destroy-1' type='set' to='player_1000003@conference.localhost'><query xmlns='http://jabber.org/protocol/muc#owner'><destroy/></query></iq>",
  );

  assert.equal(chatStore.getChannelRecord("player_1000003"), null);
  assert.equal(ownerClient.rooms.has("player_1000003@conference.localhost"), false);
  assert.equal(guestClient.rooms.has("player_1000003@conference.localhost"), false);
  assert.equal(
    ownerClient.getSent().some((xml) =>
      xml.includes("type='result'") &&
      xml.includes("id='destroy-1'"),
    ),
    true,
  );
  assert.equal(
    ownerClient.getSent().some((xml) =>
      xml.includes("from='player_1000003@conference.localhost/140000001'") &&
      xml.includes("type='unavailable'"),
    ),
    true,
  );
  assert.equal(
    guestClient.getSent().some((xml) =>
      xml.includes("from='player_1000003@conference.localhost/140000002'") &&
      xml.includes("type='unavailable'"),
    ),
    true,
  );

  ownerClient.clearSent();
  xmppStubServer.__test__.handleReadyIq(
    ownerClient,
    "<iq id='forme-after-destroy' type='get' to='conference.localhost'><query xmlns='http://jabber.org/protocol/disco#items' node='forme'/></iq>",
  );

  assert.equal(
    ownerClient.getSent().some((xml) =>
      xml.includes("id='forme-after-destroy'") &&
      !xml.includes("jid='player_1000003@conference.localhost'"),
    ),
    true,
  );
});

test("fleet room membership is pruned as soon as session fleet membership is lost", { concurrency: false }, () => {
  const fleetSession = buildSession(140000010, {
    fleetid: 880001,
  });
  sessionRegistry.getSessions = () => [fleetSession];

  const client = buildClient(140000010);
  xmppStubServer.__test__.registerClient(client);

  xmppStubServer.__test__.handleJoinPresence(
    client,
    "<presence to='fleet@conference.localhost/140000010' id='fleet-join'/>",
  );
  assert.equal(client.rooms.has("fleet_880001@conference.localhost"), true);

  fleetSession.fleetid = null;
  xmppStubServer.__test__.syncSessionScopedRoomMembership(fleetSession);

  assert.equal(client.rooms.has("fleet_880001@conference.localhost"), false);
  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("from='fleet_880001@conference.localhost/140000010'") &&
      xml.includes("type='unavailable'"),
    ),
    true,
  );
});

test("global session changes auto-open the current fleet chat when fleet membership is gained", { concurrency: false }, () => {
  const session = new ClientSession(
    {
      userId: 421,
      userName: "140000022",
      clientId: 140000022,
      sessionId: 140000022,
      role: 0,
    },
    {
      destroyed: false,
      remoteAddress: "127.0.0.1",
      write() {},
    },
  );
  session.sendPacket = () => {};
  session.characterID = 140000022;
  session.characterName = "Fleet Parity";
  session.corporationID = 1000044;
  session.corpid = 1000044;
  session.fleetid = null;

  sessionRegistry.getSessions = () => [session];

  const client = buildClient(140000022);
  xmppStubServer.__test__.registerClient(client);

  session.fleetid = 880002;
  client.clearSent();
  session.sendSessionChange({
    fleetid: [null, 880002],
    fleetrole: [null, 1],
  });

  assert.equal(client.rooms.has("fleet_880002@conference.localhost"), true);
  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("from='fleet_880002@conference.localhost/140000022'") &&
      xml.includes("<status code='110'/>"),
    ),
    true,
  );
});

test("global session changes auto-open corp alliance and militia chats when those memberships are gained", { concurrency: false }, () => {
  const session = new ClientSession(
    {
      userId: 422,
      userName: "140000023",
      clientId: 140000023,
      sessionId: 140000023,
      role: 0,
    },
    {
      destroyed: false,
      remoteAddress: "127.0.0.1",
      write() {},
    },
  );
  session.sendPacket = () => {};
  session.characterID = 140000023;
  session.characterName = "Scoped Parity";
  session.corporationID = null;
  session.corpid = null;
  session.allianceID = null;
  session.allianceid = null;
  session.warFactionID = null;
  session.warfactionid = null;

  sessionRegistry.getSessions = () => [session];

  const client = buildClient(140000023);
  xmppStubServer.__test__.registerClient(client);

  session.corporationID = 1000045;
  session.corpid = 1000045;
  session.allianceID = 990003;
  session.allianceid = 990003;
  session.warFactionID = 500003;
  session.warfactionid = 500003;
  client.clearSent();
  session.sendSessionChange({
    corpid: [null, 1000045],
    allianceid: [null, 990003],
    warfactionid: [null, 500003],
  });

  assert.equal(client.rooms.has("corp_1000045@conference.localhost"), true);
  assert.equal(client.rooms.has("alliance_990003@conference.localhost"), true);
  assert.equal(client.rooms.has("faction_500003@conference.localhost"), true);
  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("from='corp_1000045@conference.localhost/140000023'") &&
      xml.includes("<status code='110'/>"),
    ),
    true,
  );
  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("from='alliance_990003@conference.localhost/140000023'") &&
      xml.includes("<status code='110'/>"),
    ),
    true,
  );
  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("from='faction_500003@conference.localhost/140000023'") &&
      xml.includes("<status code='110'/>"),
    ),
    true,
  );
});

test("global session changes move scoped corp alliance and militia rooms onto the new membership", { concurrency: false }, () => {
  const session = new ClientSession(
    {
      userId: 420,
      userName: "140000020",
      clientId: 140000020,
      sessionId: 140000020,
      role: 0,
    },
    {
      destroyed: false,
      remoteAddress: "127.0.0.1",
      write() {},
    },
  );
  session.sendPacket = () => {};
  session.characterID = 140000020;
  session.characterName = "Parity Pilot";
  session.corporationID = 1000044;
  session.corpid = 1000044;
  session.allianceID = 990001;
  session.allianceid = 990001;
  session.warFactionID = 500001;
  session.warfactionid = 500001;

  sessionRegistry.getSessions = () => [session];

  const client = buildClient(140000020);
  xmppStubServer.__test__.registerClient(client);

  xmppStubServer.__test__.handleJoinPresence(
    client,
    "<presence to='corp@conference.localhost/140000020' id='corp-join'/>",
  );
  xmppStubServer.__test__.handleJoinPresence(
    client,
    "<presence to='alliance@conference.localhost/140000020' id='alliance-join'/>",
  );
  xmppStubServer.__test__.handleJoinPresence(
    client,
    "<presence to='militia@conference.localhost/140000020' id='militia-join'/>",
  );

  assert.equal(client.rooms.has("corp_1000044@conference.localhost"), true);
  assert.equal(client.rooms.has("alliance_990001@conference.localhost"), true);
  assert.equal(client.rooms.has("faction_500001@conference.localhost"), true);

  client.clearSent();
  session.corporationID = 1000099;
  session.corpid = 1000099;
  session.allianceID = 990002;
  session.allianceid = 990002;
  session.warFactionID = 500002;
  session.warfactionid = 500002;

  session.sendSessionChange({
    corpid: [1000044, 1000099],
    allianceid: [990001, 990002],
    warfactionid: [500001, 500002],
  });

  assert.equal(client.rooms.has("corp_1000044@conference.localhost"), false);
  assert.equal(client.rooms.has("alliance_990001@conference.localhost"), false);
  assert.equal(client.rooms.has("faction_500001@conference.localhost"), false);
  assert.equal(client.rooms.has("corp_1000099@conference.localhost"), true);
  assert.equal(client.rooms.has("alliance_990002@conference.localhost"), true);
  assert.equal(client.rooms.has("faction_500002@conference.localhost"), true);
  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("from='corp_1000044@conference.localhost/140000020'") &&
      xml.includes("type='unavailable'"),
    ),
    true,
  );
  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("from='alliance_990001@conference.localhost/140000020'") &&
      xml.includes("type='unavailable'"),
    ),
    true,
  );
  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("from='faction_500001@conference.localhost/140000020'") &&
      xml.includes("type='unavailable'"),
    ),
    true,
  );
  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("from='corp_1000099@conference.localhost/140000020'") &&
      xml.includes("<status code='110'/>"),
    ),
    true,
  );
  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("from='alliance_990002@conference.localhost/140000020'") &&
      xml.includes("<status code='110'/>"),
    ),
    true,
  );
  assert.equal(
    client.getSent().some((xml) =>
      xml.includes("from='faction_500002@conference.localhost/140000020'") &&
      xml.includes("<status code='110'/>"),
    ),
    true,
  );
});

test("direct private-chat invites create a deterministic private room and allow follow-up messages", { concurrency: false }, () => {
  sessionRegistry.getSessions = () => [
    buildSession(140000001),
    buildSession(140000002),
  ];

  const senderClient = buildClient(140000001);
  const recipientClient = buildClient(140000002);
  xmppStubServer.__test__.registerClient(senderClient);
  xmppStubServer.__test__.registerClient(recipientClient);

  xmppStubServer.__test__.handleGroupMessage(
    senderClient,
    "<message to='140000002@localhost' type='chat'><body>Start private chat</body></message>",
  );

  const privateRecord = chatStore.getChannelRecord("private_140000001_140000002");
  assert.equal(privateRecord.type, "private");
  assert.deepEqual(privateRecord.allowedParticipantCharacterIDs, [
    140000001,
    140000002,
  ]);
  assert.equal(privateRecord.metadata.joinLink, "joinChannel:private_140000001_140000002");
  assert.equal(privateRecord.metadata.inviteToken, "private_1");
  assert.equal(privateRecord.metadata.privateConversationID, 1);
  assert.equal(
    chatStore.getPrivateChannelByPair(140000001, 140000002),
    "private_140000001_140000002",
  );
  assert.equal(
    senderClient.lastRoomJid,
    "private_140000001_140000002@conference.localhost",
  );
  assert.equal(
    recipientClient.getSent().some((xml) =>
      xml.includes("private_140000001_140000002@conference.localhost") &&
      xml.includes("<invite from='140000001@localhost'>"),
    ),
    true,
  );

  recipientClient.clearSent();
  xmppStubServer.__test__.handleJoinPresence(
    recipientClient,
    "<presence to='private_140000001_140000002@conference.localhost/140000002' id='private-join'/>",
  );
  assert.equal(
    recipientClient.rooms.has("private_140000001_140000002@conference.localhost"),
    true,
  );

  recipientClient.clearSent();
  xmppStubServer.__test__.handleGroupMessage(
    senderClient,
    "<message to='private_140000001_140000002@conference.localhost' type='groupchat'><body>Private room works.</body></message>",
  );
  assert.equal(
    recipientClient.getSent().some((xml) => xml.includes("Private room works.")),
    true,
  );
});
