#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.EVEJS_LOG_LEVEL = process.env.EVEJS_LOG_LEVEL || "2";
process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = "1";

const runtime = require("../src/space/runtime");
const destiny = require("../src/space/destiny");
const {
  DESTINY_CONTRACTS,
} = require("../src/space/movement/authority/destinyContracts");
const {
  DESTINY_DROP_LOG_PATH,
  DESTINY_ENGINE_LOG_PATH,
} = require("../src/space/movement/authority/destinyJourneyLog");

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric);
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? Math.trunc(fallbackNumeric) : 0;
}

function resetDebugLogs() {
  for (const targetPath of [
    DESTINY_DROP_LOG_PATH,
    DESTINY_ENGINE_LOG_PATH,
  ]) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, "", "utf8");
  }
}

function buildScenePrototype() {
  runtime._testing.clearScenes();
  const scene = runtime.ensureScene(30000142, {
    refreshStargates: false,
  });
  const prototype = Object.getPrototypeOf(scene);
  runtime._testing.clearScenes();
  return prototype;
}

function createScene(proto, config) {
  return Object.assign(Object.create(proto), {
    systemID: 30000142,
    sessions: new Map(),
    dynamicEntities: new Map(),
    staticEntities: new Set(),
    getCurrentSimTimeMs() {
      return config.nowMs;
    },
    getCurrentDestinyStamp() {
      return config.currentSessionStamp;
    },
    getNextDestinyStamp() {
      return (config.currentSessionStamp + 1) >>> 0;
    },
    getCurrentSessionDestinyStamp() {
      return config.currentSessionStamp;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return config.currentVisibleStamp;
    },
    getCurrentPresentedSessionDestinyStamp(_session, _now, maximumLead = 0) {
      const maximumFutureLead = Math.max(0, toInt(maximumLead, 0));
      return Math.min(
        config.currentPresentedStamp,
        (config.currentVisibleStamp + maximumFutureLead) >>> 0,
      ) >>> 0;
    },
    getImmediateDestinyStampForSession() {
      return config.currentImmediateStamp;
    },
    getHistoryFloorDestinyStampForSession() {
      return config.currentVisibleStamp;
    },
    getSessionClockOffsetMs() {
      return 0;
    },
    translateDestinyStampForSession(_session, rawStamp) {
      return toInt(rawStamp, 0) >>> 0;
    },
    refreshSessionClockSnapshot() {},
  });
}

function createSession(spaceOverrides = {}, authorityOverrides = {}) {
  const notifications = [];
  const session = {
    clientID: 1065450 + Math.floor(Math.random() * 1000),
    characterID: 140000008,
    charID: 140000008,
    socket: {
      destroyed: false,
    },
    _space: {
      initialStateSent: true,
      shipID: 991003010,
      simTimeMs: 0,
      simFileTime: "0",
      timeDilation: 1,
      historyFloorDestinyStamp: 1775154000,
      visibleDynamicEntityIDs: new Set([991003010]),
      ...spaceOverrides,
      destinyAuthorityState: {
        lastRawDispatchStamp: 0,
        lastPresentedStamp: 0,
        lastCriticalStamp: 0,
        lastNonCriticalStamp: 0,
        lastSentWasOwnerCritical: false,
        lastSentOnlyStaleProjectedOwnerMissileLane: false,
        lastOwnerCommandStamp: 0,
        lastOwnerCommandAnchorStamp: 0,
        lastOwnerCommandRawDispatchStamp: 0,
        lastOwnerCommandHeadingHash: "",
        lastFreshAcquireLifecycleStamp: 0,
        lastBootstrapStamp: 0,
        lastMissileLifecycleStamp: 0,
        lastOwnerMissileLifecycleStamp: 0,
        lastOwnerMissileLifecycleAnchorStamp: 0,
        lastOwnerMissileLifecycleRawDispatchStamp: 0,
        lastOwnerMissileFreshAcquireStamp: 0,
        lastOwnerMissileFreshAcquireAnchorStamp: 0,
        lastOwnerMissileFreshAcquireRawDispatchStamp: 0,
        lastOwnerNonMissileCriticalStamp: 0,
        lastOwnerNonMissileCriticalRawDispatchStamp: 0,
        lastResetStamp: 0,
        heldQueueState: {
          active: false,
          queuedCount: 0,
          lastQueueStamp: 0,
        },
        lastJourneyId: "",
        ...authorityOverrides,
      },
    },
    sendNotification(name, target, payload) {
      notifications.push({ name, target, payload });
    },
  };
  return {
    session,
    notifications,
  };
}

function extractDestinyUpdates(notification) {
  if (!notification || notification.name !== "DoDestinyUpdate") {
    return [];
  }
  const payloadList =
    Array.isArray(notification.payload) &&
    notification.payload[0] &&
    notification.payload[0].type === "list"
      ? notification.payload[0].items
      : [];
  return Array.isArray(payloadList)
    ? payloadList.map((entry) => ({
      stamp: toInt(entry && entry[0], 0) >>> 0,
      payloadName: Array.isArray(entry && entry[1])
        ? entry[1][0]
        : (
          entry &&
          entry[1] &&
          entry[1].type === "tuple" &&
          Array.isArray(entry[1].items)
            ? entry[1].items[0]
            : null
        ),
    }))
    : [];
}

function readJsonLines(targetPath) {
  const contents = fs.readFileSync(targetPath, "utf8").trim();
  if (!contents) {
    return [];
  }
  return contents
    .split(/\r?\n/)
    .map((line) => {
      const braceIndex = line.indexOf("{");
      if (braceIndex < 0) {
        return null;
      }
      return JSON.parse(line.slice(braceIndex));
    })
    .filter(Boolean);
}

function verifyQueuedPresentationMergesAuthorityFinalStamp(proto) {
  resetDebugLogs();
  const scene = createScene(proto, {
    nowMs: 1775173445000,
    currentSessionStamp: 1775173445,
    currentVisibleStamp: 1775173445,
    currentPresentedStamp: 1775173446,
    currentImmediateStamp: 1775173444,
  });
  const { session, notifications } = createSession({
    lastSentDestinyStamp: 1775173444,
    lastSentDestinyRawDispatchStamp: 1775173444,
    lastSentDestinyWasOwnerCritical: false,
  }, {
    lastRawDispatchStamp: 1775173444,
    lastPresentedStamp: 1775173444,
    lastCriticalStamp: 1775173444,
    lastNonCriticalStamp: 1775173444,
    lastSentWasOwnerCritical: false,
  });

  scene.beginTickDestinyPresentationBatch();
  const legacySignatureGroups = [
    {
      updates: [
        {
          stamp: 1775173445,
          payload: destiny.buildSetBallAgilityPayload(980000000141, 2.5),
        },
      ],
      sendOptions: {
        translateStamps: false,
        destinyAuthorityContract:
          DESTINY_CONTRACTS.CRITICAL_MOVEMENT_OR_SHIPPRIME,
        missileDebugReason: "jolt858-prop",
      },
    },
    {
      updates: [
        {
          stamp: 1775173445,
          payload: [
            "OnDamageStateChange",
            [
              980000000141,
              [
                [1.0, 1.0, 134196446430000000n],
                1.0,
                1.0,
              ],
            ],
          ],
        },
      ],
      sendOptions: {
        translateStamps: false,
        destinyAuthorityContract: DESTINY_CONTRACTS.COMBAT_NONCRITICAL,
        missileDebugReason: "jolt858-damage",
      },
    },
  ];

  for (const group of legacySignatureGroups) {
    scene.queueTickDestinyPresentationUpdates(session, group.updates, {
      sendOptions: group.sendOptions,
    });
  }
  scene.flushTickDestinyPresentationBatch();

  assert.strictEqual(notifications.length, 1);
  const emittedUpdates = extractDestinyUpdates(notifications[0]);
  assert.deepStrictEqual(
    emittedUpdates.map((entry) => entry.stamp),
    [1775173446, 1775173446],
  );
  assert.deepStrictEqual(
    emittedUpdates.map((entry) => entry.payloadName),
    ["SetBallAgility", "OnDamageStateChange"],
  );

  const engineRecords = readJsonLines(DESTINY_ENGINE_LOG_PATH);
  const plannedGroups = engineRecords.filter((record) => (
    record &&
    record.event === "destiny.authority.plan-group" &&
    record.finalStamp === 1775173446
  ));
  assert.ok(
    plannedGroups.length >= 2,
    "expected at least two authority-planned groups on the merged final stamp",
  );

  const dropLog = fs.readFileSync(DESTINY_DROP_LOG_PATH, "utf8");
  assert.strictEqual(dropLog.trim(), "");

  return {
    legacySignatureGroupCount: legacySignatureGroups.length,
    authorityPlannedGroupCount: plannedGroups.length,
    emittedNotificationCount: notifications.length,
    mergedFinalStamp: 1775173446,
    emittedPayloadNames: emittedUpdates.map((entry) => entry.payloadName),
  };
}

function main() {
  const proto = buildScenePrototype();
  const queuedPresentationMerge =
    verifyQueuedPresentationMergesAuthorityFinalStamp(proto);

  console.log(JSON.stringify({
    queuedPresentationMerge,
  }, null, 2));
}

main();
