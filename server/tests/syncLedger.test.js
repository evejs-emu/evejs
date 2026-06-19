const test = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const ClientSession = require(path.join(repoRoot, "server/src/network/clientSession"));
const destiny = require(path.join(repoRoot, "server/src/space/destiny"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));

const TEST_SYSTEM_ID = 30000142;

class FakeSocket extends EventEmitter {
  constructor({ writeResult = true } = {}) {
    super();
    this.remoteAddress = "127.0.0.1";
    this.destroyed = false;
    this.writeResult = writeResult;
    this.writes = [];
    this.writableLength = 0;
  }

  write(buffer) {
    this.writes.push(buffer);
    this.writableLength += Buffer.isBuffer(buffer) ? buffer.length : 0;
    return this.writeResult;
  }
}

function createFakeSession(clientID, characterID, position) {
  const notifications = [];
  return {
    clientID,
    characterID,
    charID: characterID,
    characterName: `char-${characterID}`,
    shipName: `ship-${characterID}`,
    corporationID: 1,
    allianceID: 0,
    warFactionID: 0,
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
    socket: { destroyed: false },
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendServiceNotification() {},
    shipItem: {
      itemID: clientID + 100000,
      typeID: 606,
      ownerID: characterID,
      groupID: 25,
      categoryID: 6,
      radius: 50,
      spaceState: {
        position,
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        mode: "STOP",
        speedFraction: 0,
      },
    },
  };
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("client session ledger summarizes DoDestinyUpdate packet writes", () => {
  const socket = new FakeSocket({ writeResult: false });
  const session = new ClientSession({ userId: 7, clientId: 77 }, socket);
  session.characterID = 140000001;
  session.shipID = 990000001;

  session.sendNotification(
    "DoDestinyUpdate",
    "clientID",
    destiny.buildDestinyUpdatePayload([
      {
        stamp: 123,
        payload: destiny.buildStopPayload(990000001),
      },
    ], false),
  );

  assert.equal(socket.writes.length, 1, "expected one framed packet write");
  const sent = session._syncLedgerEvents.find(
    (entry) => entry.event === "packet.sent",
  );
  assert.ok(sent, "expected packet.sent ledger entry");
  assert.equal(sent.details.kind, "notification");
  assert.equal(sent.details.notifyType, "DoDestinyUpdate");
  assert.equal(sent.details.writeAccepted, false);
  assert.deepEqual(sent.details.destiny.uniqueNames, ["Stop"]);
  assert.deepEqual(sent.details.destiny.stamps, [123]);
  assert.deepEqual(sent.details.destiny.entityIDs, [990000001]);
});

test("destiny dispatch ledger records queued and flushed groups", () => {
  const session = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const entity = spaceRuntime.attachSession(session, session.shipItem, {
    systemID: TEST_SYSTEM_ID,
    broadcast: false,
  });
  assert.ok(entity, "expected session to attach");
  assert.equal(spaceRuntime.ensureInitialBallpark(session), true);
  assert.ok(
    session._space.visibilityJournal.some(
      (entry) => entry.event === "bootstrap.visible-set",
    ),
    "expected initial ballpark to seed the visibility journal",
  );
  session.notifications.length = 0;
  session._syncLedgerEvents = [];

  const stamp = spaceRuntime.getCurrentDestinyStamp();
  spaceRuntime.sendDestinyUpdates(session, [
    {
      stamp,
      payload: destiny.buildStopPayload(entity.itemID),
    },
  ]);
  spaceRuntime.flushDirectDestinyNotificationBatchIfIdle();

  const queued = session._syncLedgerEvents.find(
    (entry) => entry.event === "destiny.group.queued",
  );
  const flushed = session._syncLedgerEvents.find(
    (entry) => entry.event === "destiny.group.flushed",
  );

  assert.ok(queued, "expected queued destiny ledger entry");
  assert.ok(flushed, "expected flushed destiny ledger entry");
  assert.deepEqual(queued.details.updates.uniqueNames, ["Stop"]);
  assert.equal(flushed.details.violationCount, 0);
  assert.equal(
    session.notifications.some((notification) => notification.name === "DoDestinyUpdate"),
    true,
  );
});

test("dependent slim updates wait for materialized visibility", () => {
  const observerSession = createFakeSession(
    11,
    140000011,
    { x: 0, y: 0, z: 0 },
  );
  const subjectSession = createFakeSession(
    12,
    140000012,
    { x: 1000, y: 0, z: 0 },
  );
  const observerEntity = spaceRuntime.attachSession(
    observerSession,
    observerSession.shipItem,
    {
      systemID: TEST_SYSTEM_ID,
      broadcast: false,
    },
  );
  const subjectEntity = spaceRuntime.attachSession(
    subjectSession,
    subjectSession.shipItem,
    {
      systemID: TEST_SYSTEM_ID,
      broadcast: false,
    },
  );
  assert.ok(observerEntity, "expected observer session to attach");
  assert.ok(subjectEntity, "expected subject session to attach");
  assert.equal(spaceRuntime.ensureInitialBallpark(observerSession), true);

  const scene = spaceRuntime.getSceneForSession(observerSession);
  assert.ok(scene, "expected observer scene");

  observerSession.notifications.length = 0;
  observerSession._space.visibleDynamicEntityIDs.delete(subjectEntity.itemID);
  scene.sendSlimItemChangesToSession(observerSession, [subjectEntity]);
  scene.flushDirectDestinyNotificationBatchIfIdle();

  assert.equal(observerSession.notifications.length, 0);
  assert.ok(
    observerSession._space.visibilityJournal.some(
      (entry) =>
        entry.event === "dependent.skip" &&
        entry.source === "sendSlimItemChangesToSession" &&
        entry.entityIDs &&
        Array.isArray(entry.entityIDs.ids) &&
        entry.entityIDs.ids.includes(subjectEntity.itemID),
    ),
    "expected dependent skip journal entry",
  );

  observerSession._space.visibleDynamicEntityIDs.add(subjectEntity.itemID);
  scene.sendSlimItemChangesToSession(observerSession, [subjectEntity]);
  scene.flushDirectDestinyNotificationBatchIfIdle();

  assert.equal(
    observerSession.notifications.some((notification) => notification.name === "DoDestinyUpdate"),
    true,
  );
});
