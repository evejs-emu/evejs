const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..");

const fleetRuntime = require(path.join(
  repoRoot,
  "server/src/services/fleets/fleetRuntime",
));
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
const { marshalEncode } = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));

const registeredSessions = [];

function buildXmppClient(characterID) {
  const sent = [];
  return {
    userName: String(characterID),
    boundJid: `${characterID}@localhost/evejs`,
    nick: String(characterID),
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
  const notifications = [];
  const serviceNotifications = [];
  return {
    characterID,
    charid: characterID,
    corporationID: 1000044,
    solarsystemid2: 30000142,
    shipTypeID: 603,
    clientID: 900000 + characterID,
    socket: { destroyed: false },
    notifications,
    serviceNotifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendServiceNotification(serviceName, methodName, payload) {
      serviceNotifications.push({ serviceName, methodName, payload });
    },
    sendSessionChange() {},
    ...overrides,
  };
}

function registerSession(session) {
  sessionRegistry.register(session);
  registeredSessions.push(session);
  return session;
}

function resetFleetRuntimeState() {
  fleetRuntime.runtimeState.nextFleetSerial = 1;
  fleetRuntime.runtimeState.fleets.clear();
  fleetRuntime.runtimeState.characterToFleet.clear();
  fleetRuntime.runtimeState.invitesByCharacter.clear();
}

test.afterEach(() => {
  while (registeredSessions.length > 0) {
    sessionRegistry.unregister(registeredSessions.pop());
  }
  resetFleetRuntimeState();
  xmppStubServer.__test__.resetState();
});

test("fleet invite reaches the live target session with a usable client popup payload", () => {
  const leaderSession = registerSession(buildSession(140000101));
  const inviteeSession = registerSession(buildSession(140000102, {
    characterID: 0,
    charid: 140000102,
  }));

  const fleet = fleetRuntime.createFleetRecord(leaderSession);
  fleetRuntime.initFleet(leaderSession, fleet.fleetID);

  assert.equal(
    fleetRuntime.inviteCharacter(
      leaderSession,
      fleet.fleetID,
      inviteeSession.charid,
      null,
      null,
      fleetRuntime.FLEET.FLEET_ROLE_MEMBER,
    ),
    true,
  );

  const inviteNotification = inviteeSession.notifications.find(
    (entry) => entry.name === "OnFleetInvite",
  );
  assert.ok(inviteNotification);
  assert.equal(inviteNotification.idType, "clientID");
  assert.equal(inviteNotification.payload[0], fleet.fleetID);
  assert.equal(inviteNotification.payload[1], leaderSession.characterID);
  assert.equal(inviteNotification.payload[2], "CustomQuestion");
  assert.equal(inviteNotification.payload[3].type, "dict");
  const inviteDict = new Map(inviteNotification.payload[3].entries);
  assert.equal(inviteDict.get("autoAccept"), false);
  assert.match(inviteDict.get("header"), /Fleet Invitation/i);
  assert.match(
    inviteDict.get("question"),
    /invited you to join their fleet/i,
  );
  assert.doesNotThrow(() => marshalEncode(inviteNotification.payload));
  assert.equal(inviteeSession.serviceNotifications.length, 0);

  assert.equal(
    fleetRuntime.acceptInvite(inviteeSession, fleet.fleetID),
    true,
  );
});

test("auto-accepted invites also avoid the stale FleetInvite key", () => {
  const bossSession = registerSession(buildSession(140000111));
  const applicantSession = registerSession(buildSession(140000112));

  const fleet = fleetRuntime.createFleetRecord(bossSession);
  fleetRuntime.initFleet(bossSession, fleet.fleetID);

  assert.equal(
    fleetRuntime.inviteCharacter(
      bossSession,
      fleet.fleetID,
      applicantSession.characterID,
      null,
      null,
      fleetRuntime.FLEET.FLEET_ROLE_MEMBER,
      {
        autoAccept: true,
        msgName: "FleetInvite",
      },
    ),
    true,
  );

  const inviteNotification = applicantSession.notifications.find(
    (entry) => entry.name === "OnFleetInvite",
  );
  assert.ok(inviteNotification);
  assert.equal(inviteNotification.idType, "clientID");
  assert.equal(inviteNotification.payload[2], "CustomQuestion");
  const inviteDict = new Map(inviteNotification.payload[3].entries);
  assert.equal(inviteDict.get("autoAccept"), true);
  assert.doesNotThrow(() => marshalEncode(inviteNotification.payload));
  assert.equal(applicantSession.serviceNotifications.length, 0);
});

test("accepting a fleet invite auto-opens the real fleet room without a private-style room invite", () => {
  const leaderSession = registerSession(buildSession(140000131));
  const inviteeSession = registerSession(new ClientSession(
    {
      userId: 140000132,
      userName: "140000132",
      clientId: 140000132,
      sessionId: 140000132,
      role: 0,
    },
    {
      destroyed: false,
      remoteAddress: "127.0.0.1",
      write() {},
    },
  ));
  inviteeSession.sendPacket = () => {};
  inviteeSession.characterID = 140000132;
  inviteeSession.charid = 140000132;
  inviteeSession.corporationID = 1000044;
  inviteeSession.corpid = 1000044;
  inviteeSession.fleetid = null;
  const inviteeClient = buildXmppClient(inviteeSession.characterID);
  xmppStubServer.__test__.registerClient(inviteeClient);

  const fleet = fleetRuntime.createFleetRecord(leaderSession);
  fleetRuntime.initFleet(leaderSession, fleet.fleetID);

  assert.equal(
    fleetRuntime.inviteCharacter(
      leaderSession,
      fleet.fleetID,
      inviteeSession.characterID,
      null,
      null,
      fleetRuntime.FLEET.FLEET_ROLE_MEMBER,
    ),
    true,
  );

  inviteeClient.clearSent();
  assert.equal(
    fleetRuntime.acceptInvite(inviteeSession, fleet.fleetID),
    true,
  );

  assert.equal(
    inviteeClient.rooms.has(`fleet_${fleet.fleetID}@conference.localhost`),
    true,
  );
  assert.equal(
    inviteeClient.getSent().some((xml) =>
      xml.includes(
        `from='fleet_${fleet.fleetID}@conference.localhost/`,
      ) &&
      xml.includes(`/${inviteeSession.characterID}'`) &&
      xml.includes("<status code='110'/>"),
    ),
    true,
  );
  assert.equal(
    inviteeClient.getSent().some((xml) => xml.includes("<invite ")),
    false,
  );
});

test("fleet invites prefer the freshest live session when duplicate character sessions exist", () => {
  const leaderSession = registerSession(buildSession(140000121));
  const staleInviteeSession = registerSession(buildSession(140000122, {
    lastActivity: 1000,
    connectTime: 1000,
    clientID: 800001,
  }));
  const freshInviteeSession = registerSession(buildSession(140000122, {
    lastActivity: 2000,
    connectTime: 2000,
    clientID: 800002,
  }));

  const fleet = fleetRuntime.createFleetRecord(leaderSession);
  fleetRuntime.initFleet(leaderSession, fleet.fleetID);

  assert.equal(
    fleetRuntime.inviteCharacter(
      leaderSession,
      fleet.fleetID,
      140000122,
      null,
      null,
      fleetRuntime.FLEET.FLEET_ROLE_MEMBER,
    ),
    true,
  );

  assert.equal(
    staleInviteeSession.notifications.some((entry) => entry.name === "OnFleetInvite"),
    false,
  );
  assert.equal(
    freshInviteeSession.notifications.some((entry) => entry.name === "OnFleetInvite"),
    true,
  );
});
