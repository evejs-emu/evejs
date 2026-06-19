const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const BeyonceService = require(path.join(
  repoRoot,
  "server/src/services/ship/beyonceService",
));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const { restoreSpaceSession } = require(path.join(
  repoRoot,
  "server/src/space/transitions",
));
const {
  applyCharacterToSession,
  getActiveShipRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

function flattenDestinyUpdates(notifications = []) {
  const updates = [];
  for (const notification of notifications) {
    if (
      !notification ||
      notification.name !== "DoDestinyUpdate" ||
      !Array.isArray(notification.payload)
    ) {
      continue;
    }

    const payloadList = notification.payload[0];
    const entries = Array.isArray(payloadList && payloadList.items)
      ? payloadList.items
      : [];
    for (const entry of entries) {
      const payload = Array.isArray(entry) ? entry[1] : null;
      if (!Array.isArray(payload) || typeof payload[0] !== "string") {
        continue;
      }
      updates.push({
        stamp: Array.isArray(entry) ? entry[0] : null,
        name: payload[0],
      });
    }
  }
  return updates;
}

function findInSpaceCharacterID() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  for (const characterID of characterIDs) {
    const session = {
      characterID,
      charid: characterID,
    };
    const shipItem = getActiveShipRecord(characterID);
    const characterRecord = charactersResult.data[String(characterID)] || null;
    if (
      shipItem &&
      shipItem.spaceState &&
      !(Number(characterRecord && (characterRecord.stationID || characterRecord.stationid || 0)) > 0)
    ) {
      return characterID;
    }
  }

  assert.fail("Expected at least one in-space character for login bootstrap coverage");
}

test("beyonce MachoBindObject emits the initial space bootstrap before returning", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const notifications = [];
  const session = {
    clientID: 65450,
    characterID: 0,
    socket: {
      destroyed: false,
    },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  const applyResult = applyCharacterToSession(session, 140000004, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const shipItem = getActiveShipRecord(session.characterID);
  assert.ok(shipItem);

  scene.attachSession(session, shipItem, {
    broadcast: false,
    emitSimClockRebase: false,
  });
  assert.equal(session._space.initialStateSent, false);

  const service = new BeyonceService();
  const result = service.Handle_MachoBindObject([30000142, null], session, null);

  assert.ok(Array.isArray(result));
  assert.equal(session._space.beyonceBound, true);
  assert.equal(session._space.initialStateSent, true);
  assert.ok(
    notifications.some((entry) => entry.name === "DoDestinyUpdate"),
    "expected Handle_MachoBindObject to emit the initial space bootstrap",
  );
});

test("beyonce GetFormations emits the initial space bootstrap before MachoBindObject", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const notifications = [];
  const session = {
    clientID: 65451,
    characterID: 0,
    socket: {
      destroyed: false,
    },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  const applyResult = applyCharacterToSession(session, 140000004, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const shipItem = getActiveShipRecord(session.characterID);
  assert.ok(shipItem);

  scene.attachSession(session, shipItem, {
    broadcast: false,
    emitSimClockRebase: false,
  });
  assert.equal(session._space.initialStateSent, false);

  const service = new BeyonceService();
  const formations = service.Handle_GetFormations([], session, null);

  assert.ok(Array.isArray(formations));
  assert.equal(session._space.beyonceBound, true);
  assert.equal(session._space.initialStateSent, true);
  assert.ok(
    notifications.some((entry) => entry.name === "DoDestinyUpdate"),
    "expected Handle_GetFormations to emit the initial space bootstrap",
  );

  const destinyCountAfterFormations = notifications.filter(
    (entry) => entry.name === "DoDestinyUpdate",
  ).length;

  const bindResult = service.Handle_MachoBindObject([30000142, null], session, null);
  assert.ok(Array.isArray(bindResult));
  assert.equal(
    notifications.filter((entry) => entry.name === "DoDestinyUpdate").length,
    destinyCountAfterFormations,
    "expected MachoBindObject to avoid replaying bootstrap once GetFormations already sent it",
  );
});

test("beyonce UpdateStateRequest sends a recovery SetState without replaying AddBalls2", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const notifications = [];
  const session = {
    clientID: 65452,
    characterID: 0,
    socket: {
      destroyed: false,
    },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  const applyResult = applyCharacterToSession(session, 140000004, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const shipItem = getActiveShipRecord(session.characterID);
  assert.ok(shipItem);

  scene.attachSession(session, shipItem, {
    broadcast: false,
    emitSimClockRebase: false,
  });

  const service = new BeyonceService();
  service.Handle_MachoBindObject([30000142, null], session, null);

  notifications.length = 0;
  const result = service.Handle_UpdateStateRequest([], session, null);
  assert.equal(result, null);

  const updates = flattenDestinyUpdates(notifications);
  const updateNames = updates.map((entry) => entry.name);
  assert.equal(
    updateNames.includes("SetState"),
    true,
    "expected UpdateStateRequest to send a recovery SetState",
  );
  assert.equal(
    updateNames.includes("AddBalls2"),
    false,
    "expected UpdateStateRequest recovery to avoid replaying AddBalls2 scene bootstrap",
  );
});

test("initial login ship inventory prime can seed deferred AddBalls2 visuals before beyonce bind", () => {
  const notifications = [];
  const session = {
    clientID: 65453,
    characterID: null,
    charid: null,
    shipID: null,
    shipid: null,
    activeShipID: null,
    stationID: null,
    stationid: null,
    solarsystemid: null,
    solarsystemid2: null,
    socket: {
      destroyed: false,
    },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };

  const characterID = findInSpaceCharacterID();
  const applyResult = applyCharacterToSession(session, characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const restored = restoreSpaceSession(session);
  assert.equal(restored, true);
  assert.equal(session._space.initialBallparkVisualsSent, false);
  assert.equal(session._space.initialStateSent, false);
  assert.equal(session._space.beyonceBound, false);

  const shipItem = getActiveShipRecord(session.characterID);
  assert.ok(shipItem);

  const invBroker = new InvBrokerService();
  const bound = invBroker.Handle_GetInventoryFromId([shipItem.itemID], session, null);
  const boundID =
    bound &&
    bound.type === "substruct" &&
    bound.value &&
    bound.value.type === "substream" &&
    Array.isArray(bound.value.value)
      ? bound.value.value[0]
      : null;
  assert.ok(boundID, "expected ship inventory bind id");
  session.currentBoundObjectID = boundID;

  invBroker.Handle_List([null], session, {});

  assert.equal(session._space.initialBallparkVisualsSent, true);
  assert.equal(session._space.initialStateSent, false);
  assert.equal(session._space.beyonceBound, false);

  const updates = flattenDestinyUpdates(notifications);
  const updateNames = updates.map((entry) => entry.name);
  assert.equal(
    updateNames.includes("AddBalls2"),
    true,
    "expected the first in-space ship inventory prime to seed deferred AddBalls2 visuals",
  );
  assert.equal(
    updateNames.includes("SetState"),
    false,
    "expected the early ship inventory prime to keep SetState deferred until beyonce bind",
  );
});
