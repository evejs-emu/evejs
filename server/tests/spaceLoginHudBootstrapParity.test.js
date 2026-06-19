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
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const { restoreSpaceSession } = require(path.join(
  repoRoot,
  "server/src/space/transitions",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
  applyCharacterToSession,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  getFittedModuleItems,
  buildChargeTupleItemID,
  getLoadedChargeItems,
  isModuleOnline,
  hasLoadedScanProbeLauncherCharge,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const { ITEM_FLAGS } = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const ATTRIBUTE_QUANTITY = 805;
const ATTRIBUTE_SPEED = 51;
const ATTRIBUTE_DURATION = 73;
const EFFECT_ONLINE = 16;

function buildLoginStyleSession(candidate) {
  const notifications = [];
  const sessionChanges = [];
  return {
    clientID: candidate.characterID + 9100,
    userid: candidate.characterID,
    characterID: null,
    charid: null,
    corporationID: 0,
    allianceID: null,
    warFactionID: null,
    stationid: null,
    stationID: null,
    stationid2: null,
    locationid: null,
    solarsystemid: null,
    solarsystemid2: null,
    shipID: null,
    shipid: null,
    activeShipID: null,
    socket: { destroyed: false },
    notifications,
    sessionChanges,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange(change) {
      sessionChanges.push(change);
    },
  };
}

function findSpaceLoginCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  let fallbackCandidate = null;
  let probeFallbackCandidate = null;
  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    const ship = getActiveShipRecord(characterID);
    if (!characterRecord || !ship || !ship.spaceState) {
      continue;
    }
    if (Number(characterRecord.stationID || characterRecord.stationid || 0) > 0) {
      continue;
    }

    const fittedModules = getFittedModuleItems(characterID, ship.itemID);
    if (fittedModules.length === 0) {
      continue;
    }

    const onlineModules = fittedModules.filter((item) => isModuleOnline(item));
    if (onlineModules.length === 0) {
      continue;
    }

    const candidate = {
      characterID,
      ship,
      fittedModules,
      onlineModules,
      loadedCharges: getLoadedChargeItems(characterID, ship.itemID),
    };
    if (candidate.loadedCharges.length > 0) {
      if (!hasLoadedScanProbeLauncherCharge(characterID, ship.itemID)) {
        return candidate;
      }
      if (!probeFallbackCandidate) {
        probeFallbackCandidate = candidate;
      }
      continue;
    }
    if (!fallbackCandidate) {
      fallbackCandidate = candidate;
    }
  }

  if (probeFallbackCandidate) {
    return probeFallbackCandidate;
  }

  if (fallbackCandidate) {
    return fallbackCandidate;
  }

  assert.fail("Expected an in-space character with online fitted modules");
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

function extractInventoryRemoteListItemIDs(value) {
  if (!value || value.type !== "list" || !Array.isArray(value.items)) {
    return [];
  }

  return value.items
    .map((item) =>
      item &&
      item.type === "packedrow" &&
      item.fields &&
      typeof item.fields === "object"
        ? Number(item.fields.itemID) || 0
        : 0)
    .filter((itemID) => itemID > 0)
    .sort((left, right) => left - right);
}

function extractInventoryRemoteListRawItemIDs(value) {
  if (!value || value.type !== "list" || !Array.isArray(value.items)) {
    return [];
  }

  return value.items
    .map((item) =>
      item &&
      item.type === "packedrow" &&
      item.fields &&
      typeof item.fields === "object"
        ? item.fields.itemID
        : null)
    .filter((itemID) => itemID !== null && itemID !== undefined);
}

function hasTupleItemID(itemIDs, shipID, flagID, typeID) {
  const tupleKey = [Number(shipID) || 0, Number(flagID) || 0, Number(typeID) || 0];
  return itemIDs.some((itemID) => (
    Array.isArray(itemID) &&
    Number(itemID[0]) === tupleKey[0] &&
    Number(itemID[1]) === tupleKey[1] &&
    Number(itemID[2]) === tupleKey[2]
  ));
}

function getKeyValEntry(value, key) {
  return extractKeyValEntries(value).find((entry) => entry[0] === key)?.[1] ?? null;
}

function extractOnItemChangeItemIDs(notifications) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification.name === "OnItemChange")
    .map((notification) => {
      const payload = Array.isArray(notification.payload) ? notification.payload[0] : null;
      const itemRow =
        payload &&
        payload.type === "packedrow" &&
        payload.fields &&
        typeof payload.fields === "object"
          ? payload.fields
          : null;
      return Number(itemRow && itemRow.itemID) || 0;
    })
    .filter((itemID) => itemID > 0)
    .sort((left, right) => left - right);
}

function extractOnItemChangeRawItemIDs(notifications) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification.name === "OnItemChange")
    .map((notification) => {
      const payload = Array.isArray(notification.payload) ? notification.payload[0] : null;
      const itemRow =
        payload &&
        payload.type === "packedrow" &&
        payload.fields &&
        typeof payload.fields === "object"
          ? payload.fields
          : null;
      return itemRow ? itemRow.itemID : null;
    })
    .filter((itemID) => itemID !== null && itemID !== undefined);
}

function extractModuleAttributeChanges(notifications) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification.name === "OnModuleAttributeChanges")
    .flatMap((notification) => {
      const payload = Array.isArray(notification.payload)
        ? notification.payload[0]
        : null;
      return payload && payload.type === "list" && Array.isArray(payload.items)
        ? payload.items
        : [];
    });
}

function extractOnGodmaShipEffects(notifications) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification && notification.name === "OnGodmaShipEffect")
    .map((notification) => Array.isArray(notification.payload) ? notification.payload : [])
    .filter((payload) => payload.length >= 5);
}

function countActiveOnlineEffectsByModuleID(notifications, moduleID) {
  const numericModuleID = Number(moduleID) || 0;
  return extractOnGodmaShipEffects(notifications)
    .filter((payload) => Number(payload[0]) === numericModuleID)
    .filter((payload) => Number(payload[1]) === EFFECT_ONLINE)
    .filter((payload) => Number(payload[4]) === 1)
    .length;
}

function countOnGodmaPrimeItemsByTupleKey(
  notifications,
  shipID,
  flagID,
  typeID,
) {
  const numericShipID = Number(shipID) || 0;
  const numericFlagID = Number(flagID) || 0;
  const numericTypeID = Number(typeID) || 0;
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification && notification.name === "OnGodmaPrimeItem")
    .filter((notification) => {
      const payload = Array.isArray(notification.payload) ? notification.payload[1] : null;
      const itemIDEntry =
        payload &&
        payload.name === "util.KeyVal" &&
        payload.args &&
        payload.args.type === "dict" &&
        Array.isArray(payload.args.entries)
          ? payload.args.entries.find(
              (entry) => Array.isArray(entry) && entry[0] === "itemID",
            )
          : null;
      const itemID = itemIDEntry ? itemIDEntry[1] : null;
      return (
        Array.isArray(itemID) &&
        Number(itemID[0]) === numericShipID &&
        Number(itemID[1]) === numericFlagID &&
        Number(itemID[2]) === numericTypeID
      );
    }).length;
}

function extractOnItemChangeKeysByItemID(notifications) {
  const byItemID = new Map();
  for (const notification of Array.isArray(notifications) ? notifications : []) {
    if (notification.name !== "OnItemChange") {
      continue;
    }
    const payload = Array.isArray(notification.payload) ? notification.payload : [];
    const itemRow =
      payload[0] &&
      payload[0].type === "packedrow" &&
      payload[0].fields &&
      typeof payload[0].fields === "object"
        ? payload[0].fields
        : null;
    const itemID = Number(itemRow && itemRow.itemID) || 0;
    if (!itemID) {
      continue;
    }
    const changeEntries =
      payload[1] && payload[1].type === "dict" && Array.isArray(payload[1].entries)
        ? payload[1].entries
        : [];
    byItemID.set(
      itemID,
      changeEntries
        .map((entry) => Number(Array.isArray(entry) ? entry[0] : 0) || 0)
        .filter((key) => key > 0)
        .sort((left, right) => left - right),
    );
  }
  return byItemID;
}

function getLatestOnItemChangeKeysByTupleKey(
  notifications,
  shipID,
  flagID,
  typeID,
) {
  const numericShipID = Number(shipID) || 0;
  const numericFlagID = Number(flagID) || 0;
  const numericTypeID = Number(typeID) || 0;
  let latestKeys = [];

  for (const notification of Array.isArray(notifications) ? notifications : []) {
    if (notification.name !== "OnItemChange") {
      continue;
    }
    const payload = Array.isArray(notification.payload) ? notification.payload : [];
    const itemRow =
      payload[0] &&
      payload[0].type === "packedrow" &&
      payload[0].fields &&
      typeof payload[0].fields === "object"
        ? payload[0].fields
        : null;
    const itemID = itemRow && itemRow.itemID;
    if (
      !Array.isArray(itemID) ||
      Number(itemID[0]) !== numericShipID ||
      Number(itemID[1]) !== numericFlagID ||
      Number(itemID[2]) !== numericTypeID
    ) {
      continue;
    }
    const changeEntries =
      payload[1] && payload[1].type === "dict" && Array.isArray(payload[1].entries)
        ? payload[1].entries
        : [];
    latestKeys = changeEntries
      .map((entry) => Number(Array.isArray(entry) ? entry[0] : 0) || 0)
      .filter((key) => key > 0)
      .sort((left, right) => left - right);
  }

  return latestKeys;
}

function countRawOnItemChangesByItemID(notifications, expectedItemID) {
  const numericExpectedItemID = Number(expectedItemID) || 0;
  return extractOnItemChangeRawItemIDs(notifications).filter(
    (itemID) => Number(itemID) === numericExpectedItemID,
  ).length;
}

function countRawOnItemChangesByTupleKey(
  notifications,
  shipID,
  flagID,
  typeID,
) {
  const numericShipID = Number(shipID) || 0;
  const numericFlagID = Number(flagID) || 0;
  const numericTypeID = Number(typeID) || 0;
  return extractOnItemChangeRawItemIDs(notifications).filter(
    (itemID) =>
      Array.isArray(itemID) &&
      Number(itemID[0]) === numericShipID &&
      Number(itemID[1]) === numericFlagID &&
      Number(itemID[2]) === numericTypeID,
  ).length;
}

function countChargeQuantityChangesByTupleKey(
  notifications,
  shipID,
  flagID,
  typeID,
) {
  const numericShipID = Number(shipID) || 0;
  const numericFlagID = Number(flagID) || 0;
  const numericTypeID = Number(typeID) || 0;
  return extractModuleAttributeChanges(notifications).filter((change) => {
    const itemID = Array.isArray(change) ? change[2] : null;
    return (
      Array.isArray(itemID) &&
      Number(itemID[0]) === numericShipID &&
      Number(itemID[1]) === numericFlagID &&
      Number(itemID[2]) === numericTypeID &&
      Number(Array.isArray(change) ? change[3] : 0) === ATTRIBUTE_QUANTITY
    );
  }).length;
}

function findTupleOnItemChangeNotificationIndices(
  notifications,
  shipID,
  flagID,
  typeID,
) {
  const numericShipID = Number(shipID) || 0;
  const numericFlagID = Number(flagID) || 0;
  const numericTypeID = Number(typeID) || 0;
  const indices = [];
  for (const [index, notification] of (Array.isArray(notifications)
    ? notifications
    : []
  ).entries()) {
    const itemID = extractOnItemChangeRawItemIDs([notification])[0] ?? null;
    if (
      Array.isArray(itemID) &&
      Number(itemID[0]) === numericShipID &&
      Number(itemID[1]) === numericFlagID &&
      Number(itemID[2]) === numericTypeID
    ) {
      indices.push(index);
    }
  }
  return indices;
}

function findTupleQuantityChangeNotificationIndices(
  notifications,
  shipID,
  flagID,
  typeID,
) {
  const numericShipID = Number(shipID) || 0;
  const numericFlagID = Number(flagID) || 0;
  const numericTypeID = Number(typeID) || 0;
  const indices = [];
  for (const [index, notification] of (Array.isArray(notifications)
    ? notifications
    : []
  ).entries()) {
    if (
      notification &&
      notification.name === "OnModuleAttributeChanges" &&
      extractModuleAttributeChanges([notification]).some((change) => {
        const itemID = Array.isArray(change) ? change[2] : null;
        return (
          Array.isArray(itemID) &&
          Number(itemID[0]) === numericShipID &&
          Number(itemID[1]) === numericFlagID &&
          Number(itemID[2]) === numericTypeID &&
          Number(Array.isArray(change) ? change[3] : 0) === ATTRIBUTE_QUANTITY
        );
      })
    ) {
      indices.push(index);
    }
  }
  return indices;
}

function bindShipInventory(service, session, shipID) {
  const bound = service.Handle_GetInventoryFromId([shipID], session);
  const boundID =
    bound &&
    bound.type === "substruct" &&
    bound.value &&
    bound.value.type === "substream" &&
    Array.isArray(bound.value.value)
      ? bound.value.value[0]
      : null;
  assert.ok(boundID, "Expected GetInventoryFromId to return a bound inventory substruct");
  session.currentBoundObjectID = boundID;
}

async function waitForNotifications(predicate, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

function yieldEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("space login restore uses the stock GetAllInfo + MakeShipActive + ship inventory path", async () => {
  const candidate = findSpaceLoginCandidate();
  const session = buildLoginStyleSession(candidate);
  const dogma = new DogmaService();

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  assert.equal(session.notifications.length, 0);

  session._deferredDockedShipSessionChange = {
    shipID: candidate.ship.itemID,
    oldShipID: candidate.ship.itemID,
    stationHangarSelfSeen: false,
    stationHangarListCount: 0,
    selfFlushTimer: null,
  };
  session._pendingDockedFittingBootstrap = {
    shipID: candidate.ship.itemID,
  };

  const restored = restoreSpaceSession(session);

  assert.equal(restored, true);
  assert.ok(session._space, "expected restoreSpaceSession to attach the space session");
  assert.equal(session._space.loginShipInventoryPrimed, true);
  assert.equal(session._deferredDockedShipSessionChange, null);
  assert.equal(session._pendingDockedFittingBootstrap, null);
  assert.deepEqual(
    extractOnItemChangeItemIDs(session.notifications),
    [],
    "expected restoreSpaceSession to avoid re-sending fitted modules or loaded charge rows in space",
  );
  assert.equal(
    session.notifications.some(
      (notification) => notification.name === "OnGodmaShipEffect",
    ),
    false,
    "expected restoreSpaceSession to avoid synthetic fitting effect notifications",
  );

  const initialDogmaInfo = dogma.Handle_GetAllInfo([true, true, null], session);
  const initialShipInfo = getKeyValEntry(initialDogmaInfo, "shipInfo");
  const initialShipState = getKeyValEntry(initialDogmaInfo, "shipState");
  const initialShipInfoEntries = extractDictEntries(initialShipInfo);
  const initialShipStateEntries = extractDictEntries(initialShipState && initialShipState[0]);
  const initialChargeStateEntries = extractDictEntries(initialShipState && initialShipState[1]);
  const initialChargeFlags =
    initialChargeStateEntries.length > 0
      ? extractDictEntries(initialChargeStateEntries[0][1])
          .map((entry) => Number(entry[0]) || 0)
          .filter((flagID) => flagID > 0)
          .sort((left, right) => left - right)
      : [];
  const expectedChargeFlags = candidate.loadedCharges
    .map((item) => Number(item.flagID) || 0)
    .filter((flagID) => flagID > 0)
    .sort((left, right) => left - right);

  assert.equal(
    initialShipInfoEntries.length,
    1 + candidate.fittedModules.length + candidate.loadedCharges.length,
    "expected login dogma bootstrap shipInfo to carry ship, fitted modules, and tuple-backed loaded charges",
  );
  for (const loadedCharge of candidate.loadedCharges) {
    const tupleItemID = buildChargeTupleItemID(
      candidate.ship.itemID,
      loadedCharge.flagID,
      loadedCharge.typeID,
    );
    assert.equal(
      initialShipInfoEntries.some(
        (entry) => Number(Array.isArray(entry) ? entry[0] : 0) === Number(loadedCharge.itemID),
      ),
      false,
      `expected login dogma bootstrap shipInfo to keep real loaded charge ${loadedCharge.itemID} out of the direct-login HUD path`,
    );
    assert.equal(
      initialShipInfoEntries.some(
        (entry) => JSON.stringify(Array.isArray(entry) ? entry[0] : null) === JSON.stringify(tupleItemID),
      ),
      true,
      `expected login dogma bootstrap shipInfo to include tuple loaded charge ${JSON.stringify(tupleItemID)}`,
    );
  }
  assert.equal(
    initialShipStateEntries.length,
    2 + candidate.fittedModules.length,
    "expected login dogma bootstrap to include fitted module activation state without duplicating loaded charges as fitted rows",
  );
  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      initialShipStateEntries.some(
        (entry) => Number(Array.isArray(entry) ? entry[0] : 0) === Number(loadedCharge.itemID),
      ),
      false,
      `expected login dogma bootstrap shipState to keep loaded charge ${loadedCharge.itemID} on the charge-state path only`,
    );
  }
  assert.deepEqual(
    initialChargeFlags,
    expectedChargeFlags,
    "expected login dogma bootstrap to include loaded charge sublocations",
  );
  dogma.afterCallResponse("GetAllInfo", session);
  assert.deepEqual(
    extractOnItemChangeItemIDs(session.notifications),
    [],
    "expected login dogma bootstrap to avoid flushing any stale docked fitting bootstrap back into space",
  );

  const beyonce = new BeyonceService();
  session.notifications.length = 0;
  const bindResult = beyonce.Handle_MachoBindObject(
    [session.solarsystemid2 || session.solarsystemid, null],
    session,
    null,
  );
  assert.ok(Array.isArray(bindResult));
  beyonce.afterCallResponse("MachoBindObject", session);
  await waitForNotifications(
    () => session._space && session._space.beyonceBound === true,
  );
  assert.deepEqual(
    extractOnItemChangeItemIDs(session.notifications),
    [],
    "expected login bind to avoid synthetic fitted-module churn",
  );
  assert.deepEqual(
    extractOnItemChangeRawItemIDs(session.notifications),
    [],
    "expected login bind to avoid immediate OnItemChange churn before ship inventory list",
  );
  assert.equal(
    session.notifications.some(
      (notification) => notification.name === "OnGodmaShipEffect",
    ),
    false,
    "expected login bind to avoid redundant online-effect notifications",
  );

  const invBroker = new InvBrokerService();
  bindShipInventory(invBroker, session, candidate.ship.itemID);
  const initialShipList = invBroker.Handle_List([null], session, {});
  const initialShipListItemIDs = extractInventoryRemoteListItemIDs(initialShipList);
  const initialShipListRawItemIDs =
    extractInventoryRemoteListRawItemIDs(initialShipList);
  const fittedModuleIDs = candidate.fittedModules
    .map((item) => Number(item.itemID) || 0)
    .filter((itemID) => itemID > 0)
    .sort((left, right) => left - right);
  assert.equal(session._space.loginShipInventoryPrimed, true);
  assert.deepEqual(
    fittedModuleIDs.filter((itemID) => initialShipListItemIDs.includes(itemID)),
    fittedModuleIDs,
    "expected the first login ship inventory list to contain every fitted module so CCP MakeShipActive can load them directly",
  );
  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      initialShipListItemIDs.includes(Number(loadedCharge.itemID) || 0),
      false,
      `expected the first login ship inventory list to keep real loaded charge ${loadedCharge.itemID} out of the live HUD path`,
    );
    assert.equal(
      hasTupleItemID(
        initialShipListRawItemIDs,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      true,
      `expected the first login ship inventory list to include tuple-backed loaded charge slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countRawOnItemChangesByItemID(session.notifications, loadedCharge.itemID),
      0,
      `expected the first login ship inventory list to avoid resending real loaded charge row ${loadedCharge.itemID}`,
    );
    assert.equal(
      countChargeQuantityChangesByTupleKey(
        session.notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected the first login ship inventory list to avoid synthetic tuple quantity send for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countRawOnItemChangesByTupleKey(
        session.notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected the first login ship inventory list to avoid tuple-backed charge slot transitions for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countOnGodmaPrimeItemsByTupleKey(
        session.notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected the first login ship inventory list to avoid tuple godma-prime repair for slot ${loadedCharge.flagID}`,
    );
  }
  for (const fittedModule of candidate.fittedModules) {
    assert.equal(
      countRawOnItemChangesByItemID(session.notifications, fittedModule.itemID),
      0,
      `expected the first login ship inventory list to avoid synthetic fitted-module send for module ${fittedModule.itemID}`,
    );
  }
  invBroker.Handle_GetAvailableTurretSlots([], session);
  invBroker.afterCallResponse("GetAvailableTurretSlots", session);
  await yieldEventLoop();
  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      countOnGodmaPrimeItemsByTupleKey(
        session.notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected login HUD bootstrap to avoid tuple godma-prime for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countRawOnItemChangesByTupleKey(
        session.notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected login HUD bootstrap to avoid resending tuple-backed charge slot ${loadedCharge.flagID}`,
    );
  }
  const onlineBootstrapModuleIDs = new Set(
    extractOnGodmaShipEffects(session.notifications)
      .filter((payload) => (
        Number(payload[1]) === EFFECT_ONLINE &&
        Number(payload[4]) === 1
      ))
      .map((payload) => Number(payload[0]) || 0)
      .filter((itemID) => itemID > 0),
  );
  assert.equal(
    onlineBootstrapModuleIDs.size,
    0,
    "expected login HUD hydration to avoid synthetic online-effect notifications",
  );
  invBroker.Handle_GetAvailableTurretSlots([], session);
  invBroker.afterCallResponse("GetAvailableTurretSlots", session);
  await yieldEventLoop();
  for (const fittedModule of candidate.fittedModules) {
    const numericModuleID = Number(fittedModule.itemID) || 0;
    const syntheticSendCount = countRawOnItemChangesByItemID(
      session.notifications,
      numericModuleID,
    );
    assert.equal(
      syntheticSendCount,
      0,
      `expected login HUD finalize to avoid synthetic OnItemChange churn for fitted module ${fittedModule.itemID}`,
    );
  }
  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      countRawOnItemChangesByItemID(session.notifications, loadedCharge.itemID),
      0,
      `expected login HUD hydration to avoid resending real loaded-charge inventory row ${loadedCharge.itemID}`,
    );
    assert.equal(
      countRawOnItemChangesByTupleKey(
        session.notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected later HUD finalize to avoid restating login charge slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countChargeQuantityChangesByTupleKey(
        session.notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected later HUD polls to avoid extra tuple-quantity churn for login charge slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countOnGodmaPrimeItemsByTupleKey(
        session.notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected later HUD polls to avoid tuple prime churn for login slot ${loadedCharge.flagID}`,
    );
  }
  const syntheticItemChangeIDs = [...new Set(extractOnItemChangeItemIDs(session.notifications))].sort(
    (left, right) => left - right,
  );
  for (const fittedModule of candidate.fittedModules) {
    const numericModuleID = Number(fittedModule.itemID) || 0;
    assert.equal(
      syntheticItemChangeIDs.includes(numericModuleID),
      false,
      `expected login HUD hydration to avoid synthetic fitted-module send for ${fittedModule.itemID}`,
    );
  }
  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      syntheticItemChangeIDs.includes(Number(loadedCharge.itemID) || 0),
      false,
      `expected login HUD hydration to avoid resending real loaded charge row ${loadedCharge.itemID}`,
    );
  }
  const firstDestinyUpdateIndex = session.notifications.findIndex(
    (notification) => notification.name === "DoDestinyUpdate",
  );

  assert.notEqual(
    firstDestinyUpdateIndex,
    -1,
    "expected the beyonce bootstrap to emit DoDestinyUpdate notifications",
  );
});

test("space login can see an early HUD turret-slot bootstrap without flushing delayed charge-row repair", async () => {
  const candidate = findSpaceLoginCandidate();
  const session = buildLoginStyleSession(candidate);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const restored = restoreSpaceSession(session);
  assert.equal(restored, true);

  const beyonce = new BeyonceService();
  const bindResult = beyonce.Handle_MachoBindObject(
    [session.solarsystemid2 || session.solarsystemid, null],
    session,
    null,
  );
  assert.ok(Array.isArray(bindResult));
  beyonce.afterCallResponse("MachoBindObject", session);
  await waitForNotifications(
    () => session._space && session._space.beyonceBound === true,
  );

  const invBroker = new InvBrokerService();
  bindShipInventory(invBroker, session, candidate.ship.itemID);

  invBroker.Handle_GetAvailableTurretSlots([], session);
  invBroker.afterCallResponse("GetAvailableTurretSlots", session);

  invBroker.Handle_List([null], session, {});
  await yieldEventLoop();
  assert.equal(
    session.notifications.some((notification) => notification.name === "OnGodmaPrimeItem"),
    false,
    "expected login inventory prime to avoid tuple godma-prime after an early HUD turret-slot poll",
  );
  const syntheticFittedModuleIDs = new Set(
    extractOnItemChangeRawItemIDs(session.notifications)
      .map((itemID) => Number(itemID) || 0)
      .filter((itemID) =>
        candidate.fittedModules.some(
          (module) => Number(module.itemID) === Number(itemID),
        ),
      ),
  );
  assert.equal(
    syntheticFittedModuleIDs.size,
    0,
    "expected early HUD bootstrap to avoid synthetic fitted-module OnItemChange send",
  );
  assert.equal(
    extractOnItemChangeRawItemIDs(session.notifications).some(
      (itemID) => candidate.loadedCharges.some((charge) => Number(charge.itemID) === Number(itemID)),
    ),
    false,
    "expected login inventory prime to avoid delayed real loaded-charge repair after the early HUD turret-slot poll",
  );
});
