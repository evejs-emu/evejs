const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { EventEmitter } = require("node:events");

const repoRoot = path.join(__dirname, "..", "..");
const chatDataRoot = path.join(
  repoRoot,
  "_local",
  "tmp",
  "chat-tests",
  "localChatGatewayParity",
);

process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_CHAT_DATA_ROOT = chatDataRoot;
process.env.EVEJS_CHAT_ALLOW_TEST_RESET = "1";

fs.rmSync(chatDataRoot, {
  recursive: true,
  force: true,
});

const publicGatewayLocal = require(path.join(
  repoRoot,
  "server/src/_secondary/express/publicGatewayLocal",
));
const xmppStubServer = require(path.join(
  repoRoot,
  "server/src/services/chat/xmppStubServer",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const chatRuntime = require(path.join(
  repoRoot,
  "server/src/_secondary/chat/chatRuntime",
));
const chatStore = require(path.join(
  repoRoot,
  "server/src/_secondary/chat/chatStore",
));
const {
  LOCAL_CHAT_PROTO_ROOT,
} = require(path.join(
  repoRoot,
  "server/src/_secondary/express/gatewayServices/localChatGatewayService",
));

const NoticeEnvelope = publicGatewayLocal._testing.PROTO_ROOT.lookupType(
  "eve_public.Notice",
);

const GetMembershipListResponse = LOCAL_CHAT_PROTO_ROOT.lookupType(
  "eve_public.chat.local.api.GetMembershipListResponse",
);
const BroadcastMessageRequest = LOCAL_CHAT_PROTO_ROOT.lookupType(
  "eve_public.chat.local.api.BroadcastMessageRequest",
);
const MessageBroadcastNotice = LOCAL_CHAT_PROTO_ROOT.lookupType(
  "eve_public.chat.local.api.MessageBroadcastNotice",
);
const MembershipListNotice = LOCAL_CHAT_PROTO_ROOT.lookupType(
  "eve_public.chat.local.api.MembershipListNotice",
);
const JoinNotice = LOCAL_CHAT_PROTO_ROOT.lookupType(
  "eve_public.chat.local.api.JoinNotice",
);
const LeaveNotice = LOCAL_CHAT_PROTO_ROOT.lookupType(
  "eve_public.chat.local.api.LeaveNotice",
);
const MuteRequest = LOCAL_CHAT_PROTO_ROOT.lookupType(
  "eve_public.chat.local.api.admin.MuteRequest",
);

const registeredSessions = [];

class FakeGatewayStream extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.closed = false;
    this.frames = [];
  }

  respond() {}

  sendTrailers() {}

  write(buffer) {
    this.frames.push(Buffer.from(buffer));
    return true;
  }

  end() {
    this.closed = true;
  }
}

function buildSession(characterID, overrides = {}) {
  return {
    characterID,
    userid: characterID + 900000000,
    corporationID: 1000044,
    solarsystemid2: 30000142,
    socket: { destroyed: false },
    ...overrides,
  };
}

function registerSession(session) {
  registeredSessions.push(session);
  sessionRegistry.register(session);
  return session;
}

function buildGatewayEnvelope(
  typeName,
  payloadBuffer = Buffer.alloc(0),
  activeCharacterID = 0,
  applicationInstanceHex = "",
) {
  const envelope = publicGatewayLocal._testing.RequestEnvelope.create({
    payload: {
      type_url: `type.googleapis.com/${typeName}`,
      value: Buffer.from(payloadBuffer),
    },
    application_instance_uuid: applicationInstanceHex
      ? Buffer.from(applicationInstanceHex, "hex")
      : undefined,
    authoritative_context: activeCharacterID
      ? {
          active_character: { sequential: activeCharacterID },
          identity: {
            character: { sequential: activeCharacterID },
          },
        }
      : undefined,
  });
  return Buffer.from(
    publicGatewayLocal._testing.RequestEnvelope.encode(envelope).finish(),
  );
}

function decodeGatewayResponse(buffer) {
  return publicGatewayLocal._testing.ResponseEnvelope.decode(buffer);
}

function decodeGrpcFramePayload(frame) {
  assert.equal(frame[0], 0);
  const payloadLength = frame.readUInt32BE(1);
  assert.equal(frame.length, payloadLength + 5);
  return frame.subarray(5);
}

function decodeNotices(stream) {
  return stream.frames.map((frame) =>
    NoticeEnvelope.decode(decodeGrpcFramePayload(frame)),
  );
}

function buildXmppClient(charId) {
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
  };
}

test.afterEach(() => {
  while (registeredSessions.length > 0) {
    sessionRegistry.unregister(registeredSessions.pop());
  }
  publicGatewayLocal._testing.resetGatewayState();
  xmppStubServer.__test__.resetState();
  chatRuntime._testing.resetRuntimeState({
    removeFiles: true,
  });
});

test("chat store defaults to _secondary/data/chat and not newDatabase/data", () => {
  const probeScript = `
    const chatStore = require(${JSON.stringify(path.join(
      repoRoot,
      "server/src/_secondary/chat/chatStore",
    ))});
    process.stdout.write(chatStore.getPaths().dataRoot);
  `;
  const defaultRoot = execFileSync(process.execPath, ["-e", probeScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      EVEJS_CHAT_DATA_ROOT: "",
    },
  }).toString();

  assert.equal(
    defaultRoot,
    path.resolve(repoRoot, "server/src/_secondary/data/chat"),
  );
  assert.equal(
    defaultRoot.includes(path.join("newDatabase", "data")),
    false,
  );
});

test("local gateway returns exact membership payloads and targets membership notices to the active character", () => {
  const viewerSession = registerSession(buildSession(140000001));
  registerSession(buildSession(140000002));
  registerSession(buildSession(140000003, {
    solarsystemid2: 30000144,
  }));

  const matchingStream = new FakeGatewayStream();
  const nonMatchingStream = new FakeGatewayStream();

  assert.equal(
    publicGatewayLocal.handleGatewayStream(matchingStream, {
      ":path": "/eve_public.gateway.Notices/Consume",
    }),
    true,
  );
  assert.equal(
    publicGatewayLocal.handleGatewayStream(nonMatchingStream, {
      ":path": "/eve_public.gateway.Notices/Consume",
    }),
    true,
  );

  matchingStream.emit(
    "data",
    publicGatewayLocal.createGrpcFrame(
      buildGatewayEnvelope(
        "eve_public.chat.local.api.GetMembershipListRequest",
        Buffer.alloc(0),
        viewerSession.characterID,
      ),
    ),
  );
  nonMatchingStream.emit(
    "data",
    publicGatewayLocal.createGrpcFrame(
      buildGatewayEnvelope(
        "eve_public.chat.local.api.GetMembershipListRequest",
        Buffer.alloc(0),
        140000003,
      ),
    ),
  );

  const responseEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.chat.local.api.GetMembershipListRequest",
        Buffer.alloc(0),
        viewerSession.characterID,
      ),
    ),
  );
  const responsePayload = GetMembershipListResponse.decode(
    responseEnvelope.payload.value,
  );

  assert.equal(responseEnvelope.status_code, 200);
  assert.equal(
    responseEnvelope.payload.type_url,
    "type.googleapis.com/eve_public.chat.local.api.GetMembershipListResponse",
  );
  assert.equal(Number(responsePayload.solar_system.sequential), 30000142);
  assert.deepEqual(
    responsePayload.members
      .map((member) => Number(member.character.sequential))
      .sort((left, right) => left - right),
    [140000001, 140000002],
  );

  const matchingNotices = decodeNotices(matchingStream);
  const membershipNotice = matchingNotices.find(
    (notice) =>
      notice.payload.type_url ===
      "type.googleapis.com/eve_public.chat.local.api.MembershipListNotice",
  );
  assert.ok(membershipNotice);
  assert.equal(Number(membershipNotice.target_group.character), 140000001);

  const membershipPayload = MembershipListNotice.decode(
    membershipNotice.payload.value,
  );
  assert.deepEqual(
    membershipPayload.members
      .map((member) => Number(member.character.sequential))
      .sort((left, right) => left - right),
    [140000001, 140000002],
  );

  assert.equal(decodeNotices(nonMatchingStream).length, 0);
});

test("local gateway broadcasts chat notices by solar system and enforces muted speakers", () => {
  const speakerSession = registerSession(buildSession(140000001));
  const listenerSession = registerSession(buildSession(140000002));
  registerSession(buildSession(140000003, {
    solarsystemid2: 30000144,
  }));

  const listenerStream = new FakeGatewayStream();
  const foreignStream = new FakeGatewayStream();

  assert.equal(
    publicGatewayLocal.handleGatewayStream(listenerStream, {
      ":path": "/eve_public.gateway.Notices/Consume",
    }),
    true,
  );
  assert.equal(
    publicGatewayLocal.handleGatewayStream(foreignStream, {
      ":path": "/eve_public.gateway.Notices/Consume",
    }),
    true,
  );

  listenerStream.emit(
    "data",
    publicGatewayLocal.createGrpcFrame(
      buildGatewayEnvelope(
        "eve_public.chat.local.api.GetMembershipListRequest",
        Buffer.alloc(0),
        listenerSession.characterID,
      ),
    ),
  );
  foreignStream.emit(
    "data",
    publicGatewayLocal.createGrpcFrame(
      buildGatewayEnvelope(
        "eve_public.chat.local.api.GetMembershipListRequest",
        Buffer.alloc(0),
        140000003,
      ),
    ),
  );

  listenerStream.frames = [];
  foreignStream.frames = [];

  const broadcastResponse = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.chat.local.api.BroadcastMessageRequest",
        Buffer.from(
          BroadcastMessageRequest.encode(
            BroadcastMessageRequest.create({
              message: "Gateway parity ping",
            }),
          ).finish(),
        ),
        speakerSession.characterID,
      ),
    ),
  );

  assert.equal(broadcastResponse.status_code, 200);
  assert.equal(
    broadcastResponse.payload.type_url,
    "type.googleapis.com/eve_public.chat.local.api.BroadcastMessageResponse",
  );

  const listenerNotices = decodeNotices(listenerStream);
  const messageNotice = listenerNotices.find(
    (notice) =>
      notice.payload.type_url ===
      "type.googleapis.com/eve_public.chat.local.api.MessageBroadcastNotice",
  );
  assert.ok(messageNotice);
  assert.equal(Number(messageNotice.target_group.solar_system), 30000142);

  const messagePayload = MessageBroadcastNotice.decode(messageNotice.payload.value);
  assert.equal(Number(messagePayload.author.sequential), 140000001);
  assert.equal(Number(messagePayload.solar_system.sequential), 30000142);
  assert.equal(messagePayload.message, "Gateway parity ping");

  assert.equal(decodeNotices(foreignStream).length, 0);

  const muteResponse = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.chat.local.api.admin.MuteRequest",
        Buffer.from(
          MuteRequest.encode(
            MuteRequest.create({
              character: { sequential: speakerSession.characterID },
              duration: { seconds: 60, nanos: 0 },
              reason: "Slow down",
            }),
          ).finish(),
        ),
        listenerSession.characterID,
      ),
    ),
  );
  assert.equal(muteResponse.status_code, 200);

  const localRecord = chatStore.getChannelRecord("local_30000142");
  assert.equal(localRecord.mutedCharacters["140000001"].reason, "Slow down");

  listenerStream.frames = [];
  const mutedBroadcastResponse = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.chat.local.api.BroadcastMessageRequest",
        Buffer.from(
          BroadcastMessageRequest.encode(
            BroadcastMessageRequest.create({
              message: "This should be blocked",
            }),
          ).finish(),
        ),
        speakerSession.characterID,
      ),
    ),
  );

  assert.equal(mutedBroadcastResponse.status_code, 403);
  assert.equal(mutedBroadcastResponse.status_message, "Muted");
  assert.equal(decodeNotices(listenerStream).length, 0);
});

test("xmpp local joins publish solar-system JoinNotice updates through the public gateway", () => {
  const joiningSession = registerSession(buildSession(140000001));
  const observingSession = registerSession(buildSession(140000002));

  const observingStream = new FakeGatewayStream();
  assert.equal(
    publicGatewayLocal.handleGatewayStream(observingStream, {
      ":path": "/eve_public.gateway.Notices/Consume",
    }),
    true,
  );

  observingStream.emit(
    "data",
    publicGatewayLocal.createGrpcFrame(
      buildGatewayEnvelope(
        "eve_public.chat.local.api.GetMembershipListRequest",
        Buffer.alloc(0),
        observingSession.characterID,
      ),
    ),
  );

  observingStream.frames = [];

  const joiningClient = buildXmppClient(joiningSession.characterID);
  xmppStubServer.__test__.registerClient(joiningClient);
  xmppStubServer.__test__.handleJoinPresence(
    joiningClient,
    "<presence to='local@conference.localhost/140000001' id='gateway-local-join'/>",
  );

  const notices = decodeNotices(observingStream);
  const joinNotice = notices.find(
    (notice) =>
      notice.payload.type_url ===
      "type.googleapis.com/eve_public.chat.local.api.JoinNotice",
  );

  assert.ok(joinNotice);
  assert.equal(Number(joinNotice.target_group.solar_system), 30000142);

  const joinPayload = JoinNotice.decode(joinNotice.payload.value);
  assert.equal(Number(joinPayload.member.character.sequential), 140000001);
  assert.equal(Number(joinPayload.solar_system.sequential), 30000142);
});

test("destroyed sessions are removed from Local immediately even before session registry unregister finishes", () => {
  const observingSession = registerSession(buildSession(140000001));
  const departingSession = registerSession(buildSession(140000002));

  const observingStream = new FakeGatewayStream();
  assert.equal(
    publicGatewayLocal.handleGatewayStream(observingStream, {
      ":path": "/eve_public.gateway.Notices/Consume",
    }),
    true,
  );

  observingStream.emit(
    "data",
    publicGatewayLocal.createGrpcFrame(
      buildGatewayEnvelope(
        "eve_public.chat.local.api.GetMembershipListRequest",
        Buffer.alloc(0),
        observingSession.characterID,
      ),
    ),
  );

  observingStream.frames = [];
  departingSession.socket.destroyed = true;
  chatRuntime.unregisterSession(departingSession);

  const notices = decodeNotices(observingStream);
  const leaveNotice = notices.find(
    (notice) =>
      notice.payload.type_url ===
      "type.googleapis.com/eve_public.chat.local.api.LeaveNotice",
  );
  assert.ok(leaveNotice);

  const leavePayload = LeaveNotice.decode(leaveNotice.payload.value);
  assert.equal(Number(leavePayload.character.sequential), 140000002);
  assert.equal(Number(leavePayload.solar_system.sequential), 30000142);

  const response = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.chat.local.api.GetMembershipListRequest",
        Buffer.alloc(0),
        observingSession.characterID,
      ),
    ),
  );
  assert.equal(response.status_code, 200);

  const membershipPayload = GetMembershipListResponse.decode(
    response.payload.value,
  );
  assert.deepEqual(
    membershipPayload.members.map((member) => Number(member.character.sequential)),
    [140000001],
  );
});
