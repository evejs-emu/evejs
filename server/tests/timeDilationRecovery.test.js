const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const {
  applyCharacterToSession,
  getCharacterRecord,
  getActiveShipRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  getFittedModuleItems,
  typeHasEffectName,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));

const MWD_EFFECT_NAME = "moduleBonusMicrowarpdrive";
const MWD_GUID = "effects.MicroWarpDrive";

function findPropulsionCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    const ship = getActiveShipRecord(characterID);
    if (!characterRecord || !ship || !ship.spaceState) {
      continue;
    }
    if (Number(characterRecord.stationID || characterRecord.stationid || 0) > 0) {
      continue;
    }

    const propulsionModule = getFittedModuleItems(characterID, ship.itemID).find(
      (item) => typeHasEffectName(item.typeID, MWD_EFFECT_NAME),
    );
    if (propulsionModule) {
      return {
        characterID,
        moduleItem: propulsionModule,
      };
    }
  }

  assert.fail("Expected an in-space character with an active fitted MWD");
}

function buildSession() {
  const notifications = [];
  return {
    clientID: 65454,
    characterID: 0,
    _notifications: notifications,
    socket: {
      destroyed: false,
    },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function attachCharacterToScene(systemID = 30000142) {
  const scene = spaceRuntime.ensureScene(systemID);
  const session = buildSession();
  const candidate = findPropulsionCandidate();

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const shipItem = getActiveShipRecord(session.characterID);
  assert.ok(shipItem);

  const shipEntity = scene.attachSession(session, shipItem, {
    broadcast: false,
    emitSimClockRebase: false,
    spawnStopped: true,
  });
  assert.ok(shipEntity);

  session._space.initialStateSent = true;
  scene.markBeyonceBound(session);

  const moduleItem = getFittedModuleItems(session.characterID, shipItem.itemID).find(
    (item) => Number(item.itemID) === Number(candidate.moduleItem.itemID),
  );
  assert.ok(moduleItem, "expected the fitted test ship to have the MWD module");

  return {
    scene,
    session,
    shipItem,
    shipEntity,
    moduleItem,
  };
}

function getDestinyEvents(session, eventName) {
  return session._notifications
    .filter((entry) => entry.name === "DoDestinyUpdate")
    .flatMap((entry) => {
      const payload = entry && entry.payload && entry.payload[0];
      const items = payload && payload.items;
      return Array.isArray(items) ? items : [];
    })
    .filter((entry) => Array.isArray(entry) && entry[1] && entry[1][0] === eventName);
}

function getSpecialFxEvents(session, guid) {
  return getDestinyEvents(session, "OnSpecialFX").filter(
    (entry) => entry[1][1][5] === guid,
  );
}

function withMockedNow(initialNowMs, callback) {
  const realDateNow = Date.now;
  let currentNowMs = initialNowMs;
  Date.now = () => currentNowMs;
  try {
    return callback({
      getNow() {
        return currentNowMs;
      },
      setNow(value) {
        currentNowMs = Number(value);
      },
    });
  } finally {
    Date.now = realDateNow;
  }
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("returning from TiDi to 1.0 preserves the current sim stamp while immediate module activation uses a one-tick history-safe stamp", () => {
  withMockedNow(1773765000000, ({ getNow, setNow }) => {
    const { scene, session, moduleItem } = attachCharacterToScene();

    scene.setTimeDilation(0.5, {
      syncSessions: true,
      forceRebase: true,
      wallclockNowMs: getNow(),
    });

    setNow(getNow() + 4000);
    scene.tick(getNow());

    const beforeRecoverySimTimeMs = scene.getCurrentSimTimeMs();
    const beforeRecoveryStamp = scene.getCurrentDestinyStamp();

    scene.setTimeDilation(1.0, {
      syncSessions: true,
      forceRebase: true,
      wallclockNowMs: getNow(),
    });

    assert.equal(
      scene.getCurrentSimTimeMs(),
      beforeRecoverySimTimeMs,
      "returning to 1.0 should not jump the scene sim clock away from the current TiDi timeline",
    );
    assert.equal(
      scene.getCurrentDestinyStamp(),
      beforeRecoveryStamp,
      "returning to 1.0 should not jump destiny stamps ahead of the client's current history",
    );

    session._notifications.length = 0;
    const activationResult = spaceRuntime.activatePropulsionModule(
      session,
      moduleItem,
      MWD_EFFECT_NAME,
      { repeat: 1000 },
    );
    assert.equal(activationResult.success, true);

    const activationFxEvents = getSpecialFxEvents(session, MWD_GUID);
    assert.equal(activationFxEvents.length, 1);
    assert.equal(
      activationFxEvents[0][0] > beforeRecoveryStamp,
      true,
      "module FX immediately after TiDi recovery should stay ahead of live history without advancing the recovered scene clock",
    );
    assert.equal(
      scene.getCurrentDestinyStamp(),
      beforeRecoveryStamp,
      "using the history-safe module FX stamp should not mutate the recovered scene's current stamp",
    );
  });
});
