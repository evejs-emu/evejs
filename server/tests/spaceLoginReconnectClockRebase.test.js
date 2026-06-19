const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const BeyonceService = require(path.join(
  repoRoot,
  "server/src/services/ship/beyonceService",
));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const { restoreSpaceSession } = require(path.join(
  repoRoot,
  "server/src/space/transitions",
));
const {
  applyCharacterToSession,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const TEST_CHARACTER_ID = 140000004;
const TEST_SYSTEM_ID = 30000142;

function fileTimeToMs(value) {
  return Number((BigInt(value) - FILETIME_EPOCH_OFFSET) / 10000n);
}

function extractKeyValEntries(value) {
  if (
    value &&
    typeof value === "object" &&
    value.type === "object" &&
    value.name === "util.KeyVal" &&
    value.args &&
    value.args.type === "dict" &&
    Array.isArray(value.args.entries)
  ) {
    return value.args.entries;
  }
  return [];
}

function extractDictEntries(value) {
  if (value && value.type === "dict" && Array.isArray(value.entries)) {
    return value.entries;
  }
  return [];
}

function getKeyValEntry(value, key) {
  return extractKeyValEntries(value).find((entry) => entry[0] === key)?.[1] ?? null;
}

function buildSession(clientID) {
  const notifications = [];
  return {
    clientID,
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

test("restoreSpaceSession rebases a fresh login onto a lagged same-system scene before bootstrap", () => {
  withMockedNow(1774200000000, ({ getNow, setNow }) => {
    const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
    scene.setTimeDilation(0.5, {
      syncSessions: false,
      wallclockNowMs: getNow(),
    });
    setNow(getNow() + 4000);

    const session = buildSession(65480);
    const applyResult = applyCharacterToSession(session, TEST_CHARACTER_ID, {
      emitNotifications: false,
      logSelection: false,
    });
    assert.equal(applyResult.success, true);
    assert.equal(restoreSpaceSession(session), true);

    const rebaseNotifications = session._notifications.filter(
      (entry) => entry.name === "DoSimClockRebase",
    );
    assert.equal(
      rebaseNotifications.length,
      0,
      "expected restoreSpaceSession to stay attach-only until Michelle requests beyonce.GetFormations",
    );

    const dogma = new DogmaService();
    const initialDogmaInfo = dogma.Handle_GetAllInfo([true, true, null], session);
    const shipInfo = getKeyValEntry(initialDogmaInfo, "shipInfo");
    const shipInfoEntries = extractDictEntries(shipInfo);
    const activeShipID = Number(session.shipID || session.shipid || 0);
    const shipEntry = shipInfoEntries.find(
      (entry) => Number(Array.isArray(entry) ? entry[0] : 0) === activeShipID,
    );
    assert.ok(shipEntry, "expected reconnect dogma bootstrap to include the active ship");
    const shipValueEntries = extractKeyValEntries(shipEntry[1]);
    const shipValueMap = new Map(shipValueEntries);
    const expectedSessionFileTime = spaceRuntime.getSimulationFileTimeForSession(session);
    const expectedSessionFileTimeCapturedAtMs = getNow();
    assert.equal(
      BigInt(shipValueMap.get("time")),
      expectedSessionFileTime,
      "expected reconnect dogma bootstrap ship time to use the current solar-system sim clock",
    );
    assert.equal(
      BigInt(shipValueMap.get("wallclockTime")),
      expectedSessionFileTime,
      "expected reconnect dogma bootstrap wallclockTime to stay aligned with the current solar-system sim clock",
    );

    setNow(getNow() + 2000);
    const service = new BeyonceService();
    const formations = service.Handle_GetFormations([], session);
    assert.ok(Array.isArray(formations));
    const expectedPreservedPreviousSimTimeMs =
      fileTimeToMs(expectedSessionFileTime) +
      Math.round(
        (getNow() - expectedSessionFileTimeCapturedAtMs) * scene.getTimeDilation(),
      );

    const rebaseNotificationsAfterFormations = session._notifications.filter(
      (entry) => entry.name === "DoSimClockRebase",
    );
    assert.equal(
      rebaseNotificationsAfterFormations.length,
      1,
      "expected lagged same-system login to emit one authoritative sim-clock rebase when Michelle builds its ballpark",
    );
    assert.equal(
      fileTimeToMs(rebaseNotificationsAfterFormations[0].payload[0][0].value),
      expectedPreservedPreviousSimTimeMs,
      "expected reconnect rebase to move the preserved login-session clock onto the current slowed scene timeline",
    );
    assert.equal(
      fileTimeToMs(rebaseNotificationsAfterFormations[0].payload[0][1].value),
      scene.getCurrentSimTimeMs(),
      "expected reconnect rebase to land on the current slowed scene timeline",
    );

    const destinyNotificationCountBeforeBind = session._notifications.filter(
      (entry) => entry.name === "DoDestinyUpdate",
    ).length;
    const bindResult = service.Handle_MachoBindObject([TEST_SYSTEM_ID, null], session, null);
    assert.ok(Array.isArray(bindResult));

    const rebaseNotificationsAfterBind = session._notifications.filter(
      (entry) => entry.name === "DoSimClockRebase",
    );
    assert.equal(
      rebaseNotificationsAfterBind.length,
      1,
      "expected lagged same-system login to issue exactly one attach-time rebase and no second bootstrap rebase",
    );

    const firstRebaseIndex = session._notifications.findIndex(
      (entry) => entry.name === "DoSimClockRebase",
    );
    const firstDestinyUpdateIndex = session._notifications.findIndex(
      (entry) => entry.name === "DoDestinyUpdate",
    );
    assert.ok(firstRebaseIndex >= 0, "expected the reconnect rebase notification");
    assert.ok(firstDestinyUpdateIndex >= 0, "expected reconnect bootstrap destiny updates");
    assert.equal(
      firstRebaseIndex < firstDestinyUpdateIndex,
      true,
      "expected the reconnect rebase to flush before the first AddBalls2 bootstrap packet",
    );
    assert.equal(
      session._notifications.filter((entry) => entry.name === "DoDestinyUpdate").length,
      destinyNotificationCountBeforeBind,
      "expected the later Beyonce bind to reuse the GetFormations-seeded login bootstrap instead of replaying it",
    );

    const addBallsUpdate = flattenDestinyUpdates(session._notifications)
      .find((entry) => entry.name === "AddBalls2");
    assert.ok(addBallsUpdate, "expected reconnect bootstrap to emit AddBalls2");
  });
});


test("restoreSpaceSession keeps the no-rebase login path when the scene clock is already current", () => {
  withMockedNow(1774200100000, ({ getNow, setNow }) => {
    const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
    scene.setTimeDilation(1.0, {
      syncSessions: false,
      wallclockNowMs: getNow(),
    });

    const session = buildSession(65481);
    const applyResult = applyCharacterToSession(session, TEST_CHARACTER_ID, {
      emitNotifications: false,
      logSelection: false,
    });
    assert.equal(applyResult.success, true);
    assert.equal(restoreSpaceSession(session), true);
    assert.equal(
      session._notifications.filter((entry) => entry.name === "DoSimClockRebase").length,
      0,
      "expected current same-system restore to avoid pre-GetFormations rebase traffic",
    );

    setNow(getNow() + 2000);
    const service = new BeyonceService();
    const formations = service.Handle_GetFormations([], session);
    assert.ok(Array.isArray(formations));
    const rebaseCountBeforeBind = session._notifications.filter(
      (entry) => entry.name === "DoSimClockRebase",
    ).length;
    assert.equal(
      rebaseCountBeforeBind,
      1,
      "expected the initial same-system login bootstrap to send a single no-op clock confirmation during GetFormations",
    );
    assert.equal(
      fileTimeToMs(
        session._notifications.find((entry) => entry.name === "DoSimClockRebase").payload[0][0].value,
      ),
      fileTimeToMs(
        session._notifications.find((entry) => entry.name === "DoSimClockRebase").payload[0][1].value,
      ),
      "expected the current same-system GetFormations rebase to be a no-op clock confirmation rather than a timeline jump",
    );
    const bindResult = service.Handle_MachoBindObject([TEST_SYSTEM_ID, null], session, null);
    assert.ok(Array.isArray(bindResult));
    assert.equal(
      session._notifications.filter((entry) => entry.name === "DoSimClockRebase").length,
      rebaseCountBeforeBind,
      "expected the later Beyonce bind not to add a second login rebase after restore already seeded the ballpark",
    );
  });
});
