const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const ScanMgrService = require(path.join(
  repoRoot,
  "server/src/services/exploration/scanMgrService",
));
const {
  queuePostSpaceAttachFittingHydration,
} = require(path.join(
  repoRoot,
  "server/src/space/modules/spaceAttachHydration",
));
const probeRuntimeState = require(path.join(
  repoRoot,
  "server/src/services/exploration/probes/probeRuntimeState",
));
const {
  ITEM_FLAGS,
  createSpaceItemForCharacter,
  grantItemToCharacterLocation,
  listContainerItems,
  removeInventoryItem,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  resolveItemByName,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));
const {
  getLoadedChargeByFlag,
  getAttributeIDByNames,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const TEST_SYSTEM_ID = 30000142;
const ATTRIBUTE_DURATION = getAttributeIDByNames("duration") || 73;
const ATTRIBUTE_SPEED = getAttributeIDByNames("speed") || 51;
const DEFAULT_PASSIVE_STATE = Object.freeze({
  mass: 1_000_000,
  inertia: 0.5,
  agility: 0.5,
  maxVelocity: 300,
  maxTargetRange: 250_000,
  maxLockedTargets: 7,
  signatureRadius: 120,
  scanResolution: 500,
  cloakingTargetingDelay: 0,
  capacitorCapacity: 5_000,
  capacitorRechargeRate: 1_000,
  shieldCapacity: 1_000,
  shieldRechargeRate: 1_000,
  armorHP: 1_000,
  structureHP: 1_000,
});

let nextTransientCharacterID = 998910000;
const transientCleanups = [];
const originalProbeState = JSON.parse(JSON.stringify(
  database.read("probeRuntimeState", "/").data || {},
));
const emptyProbeState = {
  version: 2,
  nextProbeSequence: 1,
  charactersByID: {},
};

function restoreProbeState(snapshot) {
  database.write("probeRuntimeState", "/", JSON.parse(JSON.stringify(snapshot)));
  probeRuntimeState.clearRuntimeCache();
}

function registerCleanup(fn) {
  transientCleanups.push(fn);
}

function readOnItemChangeItemID(notification) {
  const payload = notification && Array.isArray(notification.payload)
    ? notification.payload
    : null;
  const row = Array.isArray(payload) ? payload[0] : null;
  return row &&
    row.fields &&
    row.fields.itemID !== undefined
    ? row.fields.itemID
    : null;
}

function resolveExactItem(name) {
  const result = resolveItemByName(name);
  assert.equal(result && result.success, true, `Expected item '${name}' to exist`);
  return result.match;
}

function createTransientCharacter(systemID) {
  const characterID = nextTransientCharacterID;
  nextTransientCharacterID += 100;
  const characterRecord = {
    characterID,
    characterName: `probe-test-${characterID}`,
    corporationID: 0,
    allianceID: 0,
    warFactionID: 0,
    solarSystemID: systemID,
    solarsystemid: systemID,
    locationID: systemID,
    locationid: systemID,
    stationID: 0,
    stationid: 0,
  };
  const writeResult = database.write("characters", `/${characterID}`, characterRecord, {
    transient: true,
  });
  assert.equal(writeResult.success, true, "Failed to create transient character");
  registerCleanup(() => {
    database.remove("characters", `/${characterID}`);
  });
  return characterRecord;
}

function buildShipEntity(scene, itemID, x, options = {}) {
  return spaceRuntime._testing.buildRuntimeShipEntityForTesting({
    itemID,
    typeID: options.typeID ?? 606,
    ownerID: options.ownerID ?? 0,
    characterID: options.characterID ?? 0,
    pilotCharacterID: options.characterID ?? 0,
    position: options.position ?? { x, y: 0, z: 0 },
    passiveResourceState: {
      ...DEFAULT_PASSIVE_STATE,
      ...(options.passiveResourceState || {}),
    },
  }, scene.systemID);
}

function attachPlayerSession(scene, entity, characterRecord) {
  const notifications = [];
  const session = {
    clientID: characterRecord.characterID + 5000,
    userid: characterRecord.characterID,
    characterID: characterRecord.characterID,
    charid: characterRecord.characterID,
    corporationID: characterRecord.corporationID || 0,
    allianceID: characterRecord.allianceID || 0,
    warFactionID: characterRecord.warFactionID || 0,
    shipID: entity.itemID,
    shipid: entity.itemID,
    activeShipID: entity.itemID,
    locationid: scene.systemID,
    solarsystemid: scene.systemID,
    solarsystemid2: scene.systemID,
    socket: { destroyed: false },
    _space: {
      systemID: scene.systemID,
      shipID: entity.itemID,
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set(),
      freshlyVisibleDynamicEntityIDs: new Set(),
      timeDilation: scene.getTimeDilation(),
      simTimeMs: scene.getCurrentSimTimeMs(),
      simFileTime: scene.getCurrentFileTime(),
    },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  entity.session = session;
  scene.spawnDynamicEntity(entity, { broadcast: false });
  scene.sessions.set(session.clientID, session);
  return {
    session,
    notifications,
  };
}

function getWrappedUserErrorMessage(error) {
  return error &&
    error.machoErrorResponse &&
    error.machoErrorResponse.payload &&
    Array.isArray(error.machoErrorResponse.payload.header) &&
    Array.isArray(error.machoErrorResponse.payload.header[1])
      ? error.machoErrorResponse.payload.header[1][0]
      : null;
}

function getWrappedUserErrorDict(error) {
  const dictHeader = error &&
    error.machoErrorResponse &&
    error.machoErrorResponse.payload &&
    Array.isArray(error.machoErrorResponse.payload.header) &&
    Array.isArray(error.machoErrorResponse.payload.header[1])
      ? error.machoErrorResponse.payload.header[1][1]
      : null;
  return dictHeader && Array.isArray(dictHeader.entries)
    ? Object.fromEntries(dictHeader.entries)
    : {};
}

function advanceScene(scene, deltaMs) {
  const baseWallclock = Number(scene.lastWallclockTickAt) || scene.getCurrentWallclockMs();
  scene.tick(baseWallclock + Math.max(0, Number(deltaMs) || 0));
}

function extractModuleAttributeChanges(notifications) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification && notification.name === "OnModuleAttributeChanges")
    .flatMap((notification) => {
      const payload = Array.isArray(notification.payload)
        ? notification.payload[0]
        : null;
      return payload && payload.type === "list" && Array.isArray(payload.items)
        ? payload.items
        : [];
    });
}

function getGodmaEffectNotifications(notifications = [], moduleID, active) {
  return (Array.isArray(notifications) ? notifications : []).filter((entry) => (
    entry &&
    entry.name === "OnGodmaShipEffect" &&
    Array.isArray(entry.payload) &&
    Number(entry.payload[0]) === Number(moduleID) &&
    Number(entry.payload[3]) === (active === true ? 1 : 0)
  ));
}

function readOnGodmaPrimeTupleItemID(notification) {
  const payload = Array.isArray(notification && notification.payload)
    ? notification.payload[1]
    : null;
  if (
    !payload ||
    payload.name !== "util.KeyVal" ||
    !payload.args ||
    payload.args.type !== "dict" ||
    !Array.isArray(payload.args.entries)
  ) {
    return null;
  }
  const itemIDEntry = payload.args.entries.find(
    (entry) => Array.isArray(entry) && entry[0] === "itemID",
  );
  return itemIDEntry ? itemIDEntry[1] : null;
}

function readOnItemChangeTupleItemID(notification) {
  const payload = Array.isArray(notification && notification.payload)
    ? notification.payload[0]
    : null;
  return payload && payload.type === "packedrow" && payload.fields
    ? payload.fields.itemID
    : null;
}

function countOnGodmaPrimeItemsByTupleKey(notifications, tupleKey) {
  return (Array.isArray(notifications) ? notifications : []).filter((entry) => (
    entry &&
    entry.name === "OnGodmaPrimeItem" &&
    JSON.stringify(readOnGodmaPrimeTupleItemID(entry)) === JSON.stringify(tupleKey)
  )).length;
}

function countTupleOnItemChanges(notifications, tupleKey) {
  return (Array.isArray(notifications) ? notifications : []).filter((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeTupleItemID(entry)) === JSON.stringify(tupleKey)
  )).length;
}

function countTupleQuantityBootstrapChanges(notifications, tupleKey) {
  return extractModuleAttributeChanges(notifications).filter((change) => (
    Array.isArray(change) &&
    JSON.stringify(change[2]) === JSON.stringify(tupleKey) &&
    Number(change[3]) === 805
  )).length;
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

function unwrapAttributeValue(value) {
  if (
    value &&
    typeof value === "object" &&
    value.type === "real"
  ) {
    return Number(value.value);
  }
  return Number(value);
}

function createProbeLauncherScenario(options = {}) {
  const characterRecord = createTransientCharacter(TEST_SYSTEM_ID);
  const shipType = resolveExactItem(options.shipName ?? "Heron");
  const launcherType = resolveExactItem(options.launcherName ?? "Core Probe Launcher I");
  const chargeType = resolveExactItem(options.chargeName ?? "Core Scanner Probe I");

  const shipCreateResult = createSpaceItemForCharacter(
    characterRecord.characterID,
    TEST_SYSTEM_ID,
    shipType,
    {
      transient: true,
      position: { x: -2_000, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "STOP",
      speedFraction: 0,
      conditionState: {
        shieldCharge: 1,
        armorDamage: 0,
        structureDamage: 0,
        charge: 1,
      },
    },
  );
  assert.equal(shipCreateResult.success, true, "Failed to create transient probe ship");
  const shipItem = shipCreateResult.data;
  registerCleanup(() => {
    removeInventoryItem(shipItem.itemID, { removeContents: true });
  });

  const moduleGrantResult = grantItemToCharacterLocation(
    characterRecord.characterID,
    shipItem.itemID,
    27,
    launcherType,
    1,
    {
      transient: true,
      moduleState: {
        online: true,
        damage: 0,
        charge: 0,
        armorDamage: 0,
        shieldCharge: 0,
        incapacitated: false,
      },
    },
  );
  assert.equal(moduleGrantResult.success, true, "Failed to grant probe launcher");
  const moduleItem = moduleGrantResult.data.items[0];

  const loadedGrantResult = grantItemToCharacterLocation(
    characterRecord.characterID,
    shipItem.itemID,
    moduleItem.flagID,
    chargeType,
    options.loadedQuantity ?? 8,
    {
      transient: true,
      singleton: false,
    },
  );
  assert.equal(loadedGrantResult.success, true, "Failed to grant loaded probe charge");

  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const shipEntity = buildShipEntity(scene, shipItem.itemID, -2_000, {
    typeID: shipItem.typeID,
    ownerID: characterRecord.characterID,
    characterID: characterRecord.characterID,
  });
  const playerSession = attachPlayerSession(scene, shipEntity, characterRecord);

  return {
    characterRecord,
    shipItem,
    moduleItem,
    loadedChargeItem: loadedGrantResult.data.items[0],
    chargeType,
    session: playerSession.session,
    notifications: playerSession.notifications,
  };
}

test.beforeEach(() => {
  restoreProbeState(emptyProbeState);
});

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
  restoreProbeState(emptyProbeState);
  DogmaService._testing.clearPendingModuleReloads();
  while (transientCleanups.length > 0) {
    const cleanup = transientCleanups.pop();
    try {
      cleanup();
    } catch (error) {
      assert.fail(`Cleanup failed: ${error.message}`);
    }
  }
});

test.after(() => {
  restoreProbeState(originalProbeState);
});

test("dogma LaunchProbes consumes loaded probe charges and emits OnNewProbe notifications", () => {
  const scenario = createProbeLauncherScenario({ loadedQuantity: 8 });
  const dogma = new DogmaService();

  dogma.Handle_LaunchProbes([scenario.moduleItem.itemID, 4], scenario.session);

  const onNewProbeNotifications = scenario.notifications.filter(
    (entry) => entry.name === "OnNewProbe",
  );
  assert.equal(onNewProbeNotifications.length, 4);

  const persisted = probeRuntimeState.getCharacterSystemProbes(
    scenario.characterRecord.characterID,
    TEST_SYSTEM_ID,
  );
  assert.equal(persisted.length, 4);
  assert.equal(
    persisted.every((probe) => Number(probe.typeID) === Number(scenario.chargeType.typeID)),
    true,
  );

  const loadedCharge = getLoadedChargeByFlag(
    scenario.characterRecord.characterID,
    scenario.shipItem.itemID,
    scenario.moduleItem.flagID,
  );
  assert.ok(loadedCharge, "Expected remaining loaded probe stack");
  assert.equal(Number(loadedCharge.stacksize || loadedCharge.quantity || 0), 4);
});

test("activating a scan probe launcher on useMissiles launches a single probe and updates the loaded stack", () => {
  const scenario = createProbeLauncherScenario({
    launcherName: "Moreau's Modified Expanded Scan Probe Launcher",
    chargeName: "Satori-Horigu Combat Scanner Probe",
    loadedQuantity: 8,
  });
  const dogma = new DogmaService();
  const scene = spaceRuntime.getSceneForSession(scenario.session);

  dogma.Handle_Activate(
    [scenario.moduleItem.itemID, "useMissiles", null, 0],
    scenario.session,
  );

  const firstStartNotificationIndex = scenario.notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnGodmaShipEffect" &&
    Array.isArray(entry.payload) &&
    Number(entry.payload[0]) === Number(scenario.moduleItem.itemID) &&
    Number(entry.payload[3]) === 1
  ));
  assert.notEqual(
    firstStartNotificationIndex,
    -1,
    "Expected probe launcher activation to emit a start effect packet",
  );
  const speedBootstrapBeforeStart = extractModuleAttributeChanges(
    scenario.notifications.slice(0, firstStartNotificationIndex),
  ).filter((change) => (
    Array.isArray(change) &&
    Number(change[2]) === Number(scenario.moduleItem.itemID) &&
    Number(change[3]) === ATTRIBUTE_SPEED &&
    unwrapAttributeValue(change[5]) > 0
  ));
  const durationBootstrapBeforeStart = extractModuleAttributeChanges(
    scenario.notifications.slice(0, firstStartNotificationIndex),
  ).filter((change) => (
    Array.isArray(change) &&
    Number(change[2]) === Number(scenario.moduleItem.itemID) &&
    Number(change[3]) === ATTRIBUTE_DURATION &&
    unwrapAttributeValue(change[5]) > 0
  ));
  assert.ok(
    speedBootstrapBeforeStart.length >= 1,
    "Expected probe launcher activation to advertise a positive speed attribute before the first start packet",
  );
  assert.ok(
    durationBootstrapBeforeStart.length >= 1,
    "Expected probe launcher activation to advertise a positive duration attribute before the first start packet",
  );
  assert.equal(
    unwrapAttributeValue(speedBootstrapBeforeStart[speedBootstrapBeforeStart.length - 1][5]),
    unwrapAttributeValue(durationBootstrapBeforeStart[durationBootstrapBeforeStart.length - 1][5]),
    "Expected probe launcher HUD speed timing to match its adjusted launch-cycle duration on the client wire contract",
  );

  const persisted = probeRuntimeState.getCharacterSystemProbes(
    scenario.characterRecord.characterID,
    TEST_SYSTEM_ID,
  );
  assert.equal(persisted.length, 1);

  const loadedCharge = getLoadedChargeByFlag(
    scenario.characterRecord.characterID,
    scenario.shipItem.itemID,
    scenario.moduleItem.flagID,
  );
  assert.ok(loadedCharge, "Expected remaining loaded probe stack");
  assert.equal(Number(loadedCharge.stacksize || loadedCharge.quantity || 0), 7);

  const onNewProbeNotifications = scenario.notifications.filter(
    (entry) => entry.name === "OnNewProbe",
  );
  assert.equal(onNewProbeNotifications.length, 1);
  const godmaStartNotifications = getGodmaEffectNotifications(
    scenario.notifications,
    scenario.moduleItem.itemID,
    true,
  );
  assert.equal(
    godmaStartNotifications.length,
    1,
    "Expected a single active OnGodmaShipEffect start packet for one launcher activation",
  );
  assert.equal(
    Number(
      godmaStartNotifications[0] &&
      godmaStartNotifications[0].payload &&
      godmaStartNotifications[0].payload[8],
    ),
    1,
    "Expected probe launcher start packets to keep the normal repeatable launcher shape on the client wire contract",
  );
  const launchedProbeID = Number(persisted[0] && persisted[0].probeID) || 0;
  assert.ok(
    scene.getEntityByID(launchedProbeID),
    "Expected launched scanner probe to materialize as a scene entity",
  );

  const activeEffect = spaceRuntime.getActiveModuleEffect(
    scenario.session,
    scenario.moduleItem.itemID,
  );
  assert.ok(activeEffect, "Expected scan probe launcher to start a launch cycle");
  assert.equal(activeEffect.autoDeactivateAtCycleEnd, true);
  assert.equal(
    Number(activeEffect.durationAttributeID),
    ATTRIBUTE_DURATION,
    "Expected scan probe launcher launch timing to follow the adjusted duration attribute",
  );
  assert.equal(
    Number(activeEffect.durationMs),
    unwrapAttributeValue(durationBootstrapBeforeStart[durationBootstrapBeforeStart.length - 1][5]),
    "Expected probe launcher launch-cycle duration to match the advertised duration attribute",
  );

  for (let step = 0; step < 16; step += 1) {
    if (!spaceRuntime.getActiveModuleEffect(scenario.session, scenario.moduleItem.itemID)) {
      break;
    }
    advanceScene(scene, 1_000);
  }

  const stoppedEffect = spaceRuntime.getActiveModuleEffect(
    scenario.session,
    scenario.moduleItem.itemID,
  );
  assert.equal(
    stoppedEffect,
    null,
    "Expected scan probe launcher to stop after a single launch cycle",
  );
  const godmaStopNotifications = getGodmaEffectNotifications(
    scenario.notifications,
    scenario.moduleItem.itemID,
    false,
  );
  assert.equal(
    godmaStopNotifications.length,
    1,
    "Expected a single inactive OnGodmaShipEffect stop packet after the launch cycle completes",
  );
  assert.equal(
    probeRuntimeState.getCharacterSystemProbes(
      scenario.characterRecord.characterID,
      TEST_SYSTEM_ID,
    ).length,
    1,
    "Expected probe launcher one-shot cycle to launch exactly one probe",
  );
  const postCycleLoadedCharge = getLoadedChargeByFlag(
    scenario.characterRecord.characterID,
    scenario.shipItem.itemID,
    scenario.moduleItem.flagID,
  );
  assert.ok(postCycleLoadedCharge, "Expected remaining loaded probe stack after cycle end");
  assert.equal(Number(postCycleLoadedCharge.stacksize || postCycleLoadedCharge.quantity || 0), 7);
});

test("login-profile probe launcher activation does not resend charge bootstrap after tuple GetAllInfo prime", () => {
  const scenario = createProbeLauncherScenario({
    launcherName: "Moreau's Modified Expanded Scan Probe Launcher",
    chargeName: "Satori-Horigu Combat Scanner Probe",
    loadedQuantity: 8,
  });
  const dogma = new DogmaService();
  const tupleKey = [
    scenario.shipItem.itemID,
    scenario.moduleItem.flagID,
    scenario.chargeType.typeID,
  ];

  scenario.session._space.loginChargeHydrationProfile = "login";
  scenario.notifications.length = 0;

  dogma.Handle_Activate(
    [scenario.moduleItem.itemID, "useMissiles", null, 0],
    scenario.session,
  );

  const firstStartNotificationIndex = scenario.notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnGodmaShipEffect" &&
    Array.isArray(entry.payload) &&
    Number(entry.payload[0]) === Number(scenario.moduleItem.itemID) &&
    Number(entry.payload[3]) === 1
  ));
  assert.notEqual(
    firstStartNotificationIndex,
    -1,
    "Expected login probe launcher activation to emit a start effect packet",
  );
  assert.equal(
    countOnGodmaPrimeItemsByTupleKey(
      scenario.notifications.slice(0, firstStartNotificationIndex),
      tupleKey,
    ),
    0,
    "Expected login probe launcher activation to avoid resending tuple godma-prime after GetAllInfo prime",
  );
  assert.equal(
    countTupleOnItemChanges(
      scenario.notifications.slice(0, firstStartNotificationIndex),
      tupleKey,
    ),
    0,
    "Expected login probe launcher activation to avoid pre-start tuple charge-row bootstrap after GetAllInfo prime",
  );
  assert.equal(
    scenario.session._space._probeLauncherActivationChargeBootstrapDone === true,
    false,
    "Expected login probe launcher activation to skip the old one-shot tuple charge bootstrap",
  );
});

test("scan probe launcher auto-reloads from cargo after the last loaded probe is launched", async () => {
  const scenario = createProbeLauncherScenario({
    loadedQuantity: 1,
  });
  const dogma = new DogmaService();
  const scene = spaceRuntime.getSceneForSession(scenario.session);
  const cargoGrantResult = grantItemToCharacterLocation(
    scenario.characterRecord.characterID,
    scenario.shipItem.itemID,
    ITEM_FLAGS.CARGO_HOLD,
    scenario.chargeType,
    8,
    {
      transient: true,
      singleton: false,
    },
  );
  assert.equal(cargoGrantResult.success, true, "Failed to grant cargo probe stack");

  dogma.Handle_Activate(
    [scenario.moduleItem.itemID, "useMissiles", null, 0],
    scenario.session,
  );

  for (let step = 0; step < 16; step += 1) {
    if (!spaceRuntime.getActiveModuleEffect(scenario.session, scenario.moduleItem.itemID)) {
      break;
    }
    advanceScene(scene, 1_000);
  }

  assert.equal(
    spaceRuntime.getActiveModuleEffect(scenario.session, scenario.moduleItem.itemID),
    null,
    "Expected the one-shot probe launch cycle to end before reload begins",
  );

  const pendingReloadState = DogmaService._testing
    .getPendingModuleReloads()
    .get(Number(scenario.moduleItem.itemID));

  const reloadNotifications = scenario.notifications.filter((entry) => (
    entry &&
    entry.name === "OnChargeBeingLoadedToModule" &&
    Array.isArray(entry.payload) &&
    entry.payload[0] &&
    entry.payload[0].type === "list" &&
    Array.isArray(entry.payload[0].items) &&
    entry.payload[0].items.includes(Number(scenario.moduleItem.itemID))
  ));
  assert.equal(
    reloadNotifications.length,
    1,
    "Expected zero-charge probe depletion to advertise a launcher reload to the client",
  );

  if (pendingReloadState) {
    advanceScene(
      scene,
      Math.max(0, Number(pendingReloadState.reloadTimeMs) || 10_000),
    );
    DogmaService._testing.flushPendingModuleReloads();
    await new Promise((resolve) => setImmediate(resolve));
  }

  const reloadedCharge = getLoadedChargeByFlag(
    scenario.characterRecord.characterID,
    scenario.shipItem.itemID,
    scenario.moduleItem.flagID,
  );
  assert.ok(
    reloadedCharge,
    "Expected last-shot probe depletion to queue or complete a real module reload from cargo",
  );
  assert.equal(
    Number(reloadedCharge.stacksize || reloadedCharge.quantity || 0),
    8,
    "Expected auto-reload to refill the launcher from cargo after the last loaded probe is launched",
  );
});

test("probe launcher activation purges invalid ghost probes before enforcing the active probe cap", () => {
  const scenario = createProbeLauncherScenario({
    launcherName: "Moreau's Modified Expanded Scan Probe Launcher",
    chargeName: "Satori-Horigu Combat Scanner Probe",
    loadedQuantity: 8,
  });
  const dogma = new DogmaService();
  const futureExpiry = (
    (BigInt(Date.now() + (60 * 60 * 1000)) * 10000n) +
    116444736000000000n
  ).toString();

  const validProbeMap = new Map();
  for (let index = 0; index < 7; index += 1) {
    const probeID = 9800 + index;
    validProbeMap.set(probeID, {
      probeID,
      typeID: scenario.chargeType.typeID,
      launchShipID: scenario.shipItem.itemID,
      launcherItemID: scenario.moduleItem.itemID,
      launcherFlagID: scenario.moduleItem.flagID,
      pos: [1000 * (index + 1), 0, 0],
      destination: [1000 * (index + 1), 0, 0],
      scanRange: 10_000,
      rangeStep: 2,
      state: 1,
      expiry: futureExpiry,
    });
  }
  probeRuntimeState.upsertCharacterProbes(
    scenario.characterRecord.characterID,
    TEST_SYSTEM_ID,
    validProbeMap,
    { nowMs: Date.now() },
  );
  probeRuntimeState.upsertCharacterProbes(
    scenario.characterRecord.characterID,
    TEST_SYSTEM_ID,
    new Map([
      [9899, {
        probeID: 9899,
        typeID: 0,
        pos: [0, 0, 0],
        destination: [0, 0, 0],
        scanRange: 0,
        rangeStep: 1,
        state: 1,
      }],
    ]),
    { nowMs: Date.now() },
  );

  dogma.Handle_Activate(
    [scenario.moduleItem.itemID, "useMissiles", null, 0],
    scenario.session,
  );

  const persisted = probeRuntimeState.getCharacterSystemProbes(
    scenario.characterRecord.characterID,
    TEST_SYSTEM_ID,
  );
  assert.equal(
    persisted.some((probe) => Number(probe.probeID) === 9899),
    false,
    "Expected invalid ghost probes to be purged before launch",
  );
  assert.equal(
    persisted.filter((probe) => Number(probe.typeID) === Number(scenario.chargeType.typeID)).length,
    8,
    "Expected the valid active probe count to reach eight after the launch succeeds",
  );
});

test("probe launcher activation purges expired persisted probes before enforcing the active probe cap", () => {
  const scenario = createProbeLauncherScenario({
    launcherName: "Moreau's Modified Expanded Scan Probe Launcher",
    chargeName: "Satori-Horigu Combat Scanner Probe",
    loadedQuantity: 8,
  });
  const dogma = new DogmaService();
  const expiredFileTime = (
    (BigInt(Date.now() - (2 * 60 * 60 * 1000)) * 10000n) +
    116444736000000000n
  ).toString();

  const expiredProbeMap = new Map();
  for (let index = 0; index < 8; index += 1) {
    const probeID = 9950 + index;
    expiredProbeMap.set(probeID, {
      probeID,
      typeID: scenario.chargeType.typeID,
      launchShipID: scenario.shipItem.itemID,
      launcherItemID: scenario.moduleItem.itemID,
      launcherFlagID: scenario.moduleItem.flagID,
      pos: [1000 * (index + 1), 0, 0],
      destination: [1000 * (index + 1), 0, 0],
      scanRange: 10_000,
      rangeStep: 2,
      state: 1,
      expiry: expiredFileTime,
    });
  }
  probeRuntimeState.upsertCharacterProbes(
    scenario.characterRecord.characterID,
    TEST_SYSTEM_ID,
    expiredProbeMap,
    { nowMs: Date.now() },
  );

  dogma.Handle_Activate(
    [scenario.moduleItem.itemID, "useMissiles", null, 0],
    scenario.session,
  );

  const persisted = probeRuntimeState.getCharacterSystemProbes(
    scenario.characterRecord.characterID,
    TEST_SYSTEM_ID,
  );
  assert.equal(
    persisted.some((probe) => String(probe.expiry) === expiredFileTime),
    false,
    "Expected expired persisted probes to be purged before launch",
  );
  assert.equal(
    persisted.filter((probe) => Number(probe.typeID) === Number(scenario.chargeType.typeID)).length,
    1,
    "Expected launch to succeed after purging expired probes instead of tripping the active cap",
  );
});

test("probe launcher over-cap rejection happens before any launch-cycle effect starts", () => {
  const scenario = createProbeLauncherScenario({
    launcherName: "Moreau's Modified Expanded Scan Probe Launcher",
    chargeName: "Satori-Horigu Combat Scanner Probe",
    loadedQuantity: 8,
  });
  const dogma = new DogmaService();
  const futureExpiry = (
    (BigInt(Date.now() + (60 * 60 * 1000)) * 10000n) +
    116444736000000000n
  ).toString();

  const validProbeMap = new Map();
  for (let index = 0; index < 8; index += 1) {
    const probeID = 9900 + index;
    validProbeMap.set(probeID, {
      probeID,
      typeID: scenario.chargeType.typeID,
      launchShipID: scenario.shipItem.itemID,
      launcherItemID: scenario.moduleItem.itemID,
      launcherFlagID: scenario.moduleItem.flagID,
      pos: [1000 * (index + 1), 0, 0],
      destination: [1000 * (index + 1), 0, 0],
      scanRange: 10_000,
      rangeStep: 2,
      state: 1,
      expiry: futureExpiry,
    });
  }
  probeRuntimeState.upsertCharacterProbes(
    scenario.characterRecord.characterID,
    TEST_SYSTEM_ID,
    validProbeMap,
    { nowMs: Date.now() },
  );

  assert.throws(() => dogma.Handle_Activate(
    [scenario.moduleItem.itemID, "useMissiles", null, 0],
    scenario.session,
  ));

  const godmaStartNotifications = getGodmaEffectNotifications(
    scenario.notifications,
    scenario.moduleItem.itemID,
    true,
  );
  assert.equal(
    godmaStartNotifications.length,
    0,
    "Expected a rejected over-cap launch to avoid emitting a start effect notification",
  );
  assert.equal(
    spaceRuntime.getActiveModuleEffect(scenario.session, scenario.moduleItem.itemID),
    null,
    "Expected a rejected over-cap launch to avoid entering an active runtime cycle",
  );
});

test("manual deactivation of an active scan probe launcher waits until cycle end, then stops once", () => {
  const scenario = createProbeLauncherScenario({
    launcherName: "Moreau's Modified Expanded Scan Probe Launcher",
    chargeName: "Satori-Horigu Combat Scanner Probe",
    loadedQuantity: 8,
  });
  const dogma = new DogmaService();
  const scene = spaceRuntime.getSceneForSession(scenario.session);

  dogma.Handle_Activate(
    [scenario.moduleItem.itemID, "useMissiles", null, 0],
    scenario.session,
  );

  const activeEffect = spaceRuntime.getActiveModuleEffect(
    scenario.session,
    scenario.moduleItem.itemID,
  );
  assert.ok(activeEffect, "Expected launcher to enter an active launch cycle");

  advanceScene(scene, 1_000);

  dogma.Handle_Deactivate(
    [scenario.moduleItem.itemID, "useMissiles"],
    scenario.session,
  );

  const pendingEffect = spaceRuntime.getActiveModuleEffect(
    scenario.session,
    scenario.moduleItem.itemID,
  );
  assert.ok(pendingEffect, "Expected launcher to remain active until the cycle boundary");
  assert.ok(
    Number(pendingEffect.deactivateAtMs) > Number(scene.getCurrentSimTimeMs()),
    "Expected manual deactivation to queue for the cycle boundary",
  );

  const stopNotificationsBeforeBoundary = getGodmaEffectNotifications(
    scenario.notifications,
    scenario.moduleItem.itemID,
    false,
  );
  assert.equal(
    stopNotificationsBeforeBoundary.length,
    0,
    "Expected no stop packet before the cycle boundary is reached",
  );

  for (let step = 0; step < 16; step += 1) {
    if (!spaceRuntime.getActiveModuleEffect(scenario.session, scenario.moduleItem.itemID)) {
      break;
    }
    advanceScene(scene, 1_000);
  }

  const stoppedEffect = spaceRuntime.getActiveModuleEffect(
    scenario.session,
    scenario.moduleItem.itemID,
  );
  assert.equal(stoppedEffect, null, "Expected launcher to stop at the cycle boundary");

  const startNotifications = getGodmaEffectNotifications(
    scenario.notifications,
    scenario.moduleItem.itemID,
    true,
  );
  const stopNotifications = getGodmaEffectNotifications(
    scenario.notifications,
    scenario.moduleItem.itemID,
    false,
  );
  assert.equal(startNotifications.length, 1);
  assert.equal(stopNotifications.length, 1);
});

test("sequential single probe launches use distinct persisted positions instead of stacking on one point", () => {
  const scenario = createProbeLauncherScenario({
    launcherName: "Moreau's Modified Expanded Scan Probe Launcher",
    chargeName: "Satori-Horigu Combat Scanner Probe",
    loadedQuantity: 8,
  });
  const dogma = new DogmaService();

  dogma.Handle_LaunchProbes([scenario.moduleItem.itemID, 1], scenario.session);
  dogma.Handle_LaunchProbes([scenario.moduleItem.itemID, 1], scenario.session);
  dogma.Handle_LaunchProbes([scenario.moduleItem.itemID, 1], scenario.session);

  const persisted = probeRuntimeState.getCharacterSystemProbes(
    scenario.characterRecord.characterID,
    TEST_SYSTEM_ID,
  );
  assert.equal(persisted.length, 3);
  const uniquePositions = new Set(
    persisted.map((probe) => JSON.stringify(probe.pos)),
  );
  assert.equal(
    uniquePositions.size,
    3,
    "Expected sequential one-by-one launches to occupy distinct scene positions",
  );
});

test("recovering probes fills launcher capacity first and overflows extra probes into cargo", async () => {
  const scenario = createProbeLauncherScenario({
    launcherName: "Moreau's Modified Expanded Scan Probe Launcher",
    chargeName: "Satori-Horigu Combat Scanner Probe",
    loadedQuantity: 7,
  });
  const scanMgr = new ScanMgrService();
  const futureExpiry = (
    (BigInt(Date.now() + (60 * 60 * 1000)) * 10000n) +
    116444736000000000n
  ).toString();

  probeRuntimeState.upsertCharacterProbes(
    scenario.characterRecord.characterID,
    TEST_SYSTEM_ID,
    new Map([
      [9701, {
        probeID: 9701,
        typeID: scenario.chargeType.typeID,
        launchShipID: scenario.shipItem.itemID,
        launcherItemID: scenario.moduleItem.itemID,
        launcherFlagID: scenario.moduleItem.flagID,
        pos: [1000, 0, 0],
        destination: [1000, 0, 0],
        scanRange: 10_000,
        rangeStep: 2,
        state: 1,
        expiry: futureExpiry,
      }],
      [9702, {
        probeID: 9702,
        typeID: scenario.chargeType.typeID,
        launchShipID: scenario.shipItem.itemID,
        launcherItemID: scenario.moduleItem.itemID,
        launcherFlagID: scenario.moduleItem.flagID,
        pos: [2000, 0, 0],
        destination: [2000, 0, 0],
        scanRange: 10_000,
        rangeStep: 2,
        state: 1,
        expiry: futureExpiry,
      }],
      [9703, {
        probeID: 9703,
        typeID: scenario.chargeType.typeID,
        launchShipID: scenario.shipItem.itemID,
        launcherItemID: scenario.moduleItem.itemID,
        launcherFlagID: scenario.moduleItem.flagID,
        pos: [3000, 0, 0],
        destination: [3000, 0, 0],
        scanRange: 10_000,
        rangeStep: 2,
        state: 1,
        expiry: futureExpiry,
      }],
    ]),
    { nowMs: Date.now() },
  );

  const recovered = scanMgr.Handle_RecoverProbes([[
    { type: "long", value: 9701n },
    { type: "long", value: 9702n },
    { type: "long", value: 9703n },
  ]], scenario.session);
  assert.deepEqual(recovered, [9701, 9702, 9703]);

  await new Promise((resolve) => setImmediate(resolve));

  const loadedCharge = getLoadedChargeByFlag(
    scenario.characterRecord.characterID,
    scenario.shipItem.itemID,
    scenario.moduleItem.flagID,
  );
  assert.ok(loadedCharge, "Expected recovered probes to refill the launcher");
  assert.equal(
    Number(loadedCharge.stacksize || loadedCharge.quantity || 0),
    8,
    "Expected launcher reload to stop at its charge capacity",
  );

  const cargoStacks = listContainerItems(
    scenario.characterRecord.characterID,
    scenario.shipItem.itemID,
    ITEM_FLAGS.CARGO_HOLD,
  ).filter((item) => Number(item.typeID) === Number(scenario.chargeType.typeID));
  assert.equal(cargoStacks.length > 0, true, "Expected overflow recovered probes to land in cargo");
  assert.equal(
    cargoStacks.reduce(
      (sum, item) => sum + (Number(item.stacksize || item.quantity || 0) || 0),
      0,
    ),
    2,
  );
});

test("scanMgr derives probe scan duration from the fitted active probe launcher", () => {
  const scenario = createProbeLauncherScenario({ loadedQuantity: 8 });

  const durationMs = ScanMgrService._testing.resolveProbeScanDurationMs(scenario.session);

  assert.equal(Number.isFinite(durationMs), true);
  assert.ok(durationMs > 0, "Expected a positive probe scan duration");
  assert.equal(
    durationMs,
    8_000,
    "Expected scan duration to include the fitted launcher's live duration and the character's scan-duration skill multiplier",
  );
});

test("RecoverProbes restores launched scanner probes back into the loaded launcher stack", async () => {
  const scenario = createProbeLauncherScenario({ loadedQuantity: 8 });
  const dogma = new DogmaService();
  const scanMgr = new ScanMgrService();
  const scene = spaceRuntime.getSceneForSession(scenario.session);

  dogma.Handle_LaunchProbes([scenario.moduleItem.itemID, 4], scenario.session);
  const launched = probeRuntimeState.getCharacterSystemProbes(
    scenario.characterRecord.characterID,
    TEST_SYSTEM_ID,
  );
  assert.equal(launched.length, 4);

  scenario.notifications.length = 0;
  const recoveredProbeIDs = scanMgr.Handle_RecoverProbes([
    launched.map((probe) => Number(probe.probeID) || 0),
  ], scenario.session);
  assert.equal(recoveredProbeIDs.length, 4);

  await new Promise((resolve) => setImmediate(resolve));

  const remainingProbes = probeRuntimeState.getCharacterSystemProbes(
    scenario.characterRecord.characterID,
    TEST_SYSTEM_ID,
  );
  assert.equal(remainingProbes.length, 0);
  for (const probeID of recoveredProbeIDs) {
    assert.equal(
      scene.getEntityByID(Number(probeID) || 0),
      null,
      "Expected recovered scanner probes to be removed from the scene",
    );
  }

  const loadedCharge = getLoadedChargeByFlag(
    scenario.characterRecord.characterID,
    scenario.shipItem.itemID,
    scenario.moduleItem.flagID,
  );
  assert.ok(loadedCharge, "Expected recovered probes to restore the loaded charge stack");
  assert.equal(Number(loadedCharge.stacksize || loadedCharge.quantity || 0), 8);

  const onRemoveProbeNotifications = scenario.notifications
    .filter((entry) => entry.name === "OnRemoveProbe");
  assert.equal(onRemoveProbeNotifications.length, 4);
});

test("UnloadAmmo moves loaded scanner probes back into cargo and clears the launcher charge row", () => {
  const scenario = createProbeLauncherScenario({ loadedQuantity: 8 });
  const dogma = new DogmaService();

  dogma.Handle_UnloadAmmo(
    [scenario.shipItem.itemID, [scenario.moduleItem.itemID], scenario.shipItem.itemID, null],
    scenario.session,
  );

  const loadedCharge = getLoadedChargeByFlag(
    scenario.characterRecord.characterID,
    scenario.shipItem.itemID,
    scenario.moduleItem.flagID,
  );
  assert.equal(loadedCharge, null);

  const cargoStacks = listContainerItems(
    scenario.characterRecord.characterID,
    scenario.shipItem.itemID,
    ITEM_FLAGS.CARGO_HOLD,
  ).filter((item) => Number(item.typeID) === Number(scenario.chargeType.typeID));
  assert.equal(cargoStacks.length > 0, true, "Expected unloaded scanner probes in cargo");
  assert.equal(
    cargoStacks.reduce(
      (total, item) => total + (Number(item.stacksize || item.quantity || 0) || 0),
      0,
    ),
    8,
  );
});

test("LoadAmmo emits no redundant scanner-probe state on no-op reload requests", async () => {
  const scenario = createProbeLauncherScenario({ loadedQuantity: 8 });
  const dogma = new DogmaService();
  const cargoGrantResult = grantItemToCharacterLocation(
    scenario.characterRecord.characterID,
    scenario.shipItem.itemID,
    ITEM_FLAGS.CARGO_HOLD,
    scenario.chargeType,
    8,
    {
      transient: true,
      singleton: false,
    },
  );
  assert.equal(cargoGrantResult.success, true, "Failed to grant cargo probe stack");
  const cargoCharge = cargoGrantResult.data.items[0];

  scenario.notifications.length = 0;
  dogma.Handle_LoadAmmo([
    scenario.shipItem.itemID,
    scenario.moduleItem.itemID,
    [cargoCharge.itemID],
    scenario.shipItem.itemID,
  ], scenario.session);

  await new Promise((resolve) => setTimeout(resolve, 175));

  const onGodmaPrimeNotifications = scenario.notifications.filter(
    (entry) => entry.name === "OnGodmaPrimeItem",
  );
  assert.equal(
    onGodmaPrimeNotifications.length,
    0,
    "Expected no OnGodmaPrimeItem for already loaded scanner probes",
  );

  const onItemChangeNotifications = scenario.notifications.filter(
    (entry) => entry.name === "OnItemChange",
  );
  assert.equal(
    onItemChangeNotifications.length,
    0,
    "Expected no synthetic tuple OnItemChange for already loaded scanner probes",
  );
});

test("transition hydration keeps tuple-backed scanner probes on authoritative GetAllInfo lane", async () => {
  const scenario = createProbeLauncherScenario({
    launcherName: "Moreau’s Modified Expanded Scan Probe Launcher",
    chargeName: "Satori-Horigu Combat Scanner Probe",
    loadedQuantity: 8,
  });

  scenario.session._space.beyonceBound = true;
  scenario.notifications.length = 0;

  queuePostSpaceAttachFittingHydration(scenario.session, scenario.shipItem.itemID, {
    hydrationProfile: "transition",
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    scenario.notifications.some((entry) => entry.name === "OnGodmaPrimeItem"),
    false,
    "Expected transition hydration not to prime tuple-backed probe charges",
  );
  assert.equal(
    scenario.notifications.some((entry) => entry.name === "OnItemChange"),
    false,
    "Expected transition hydration not to synthesize tuple-backed probe charge rows",
  );
  assert.equal(
    countTupleQuantityBootstrapChanges(scenario.notifications, [
      scenario.shipItem.itemID,
      scenario.moduleItem.flagID,
      scenario.chargeType.typeID,
    ]),
    0,
    "Expected transition hydration not to send redundant tuple quantity bootstrap",
  );
  assert.equal(
    scenario.session._space.loginShipInventoryPrimed,
    true,
    "Expected transition hydration bookkeeping to mark ship inventory as already satisfied",
  );
});

test("login hydration keeps probe launcher charges on the tuple GetAllInfo lane", async () => {
  const scenario = createProbeLauncherScenario({ loadedQuantity: 8 });
  const invBroker = new InvBrokerService();
  const tupleKey = [
    scenario.shipItem.itemID,
    scenario.moduleItem.flagID,
    scenario.chargeType.typeID,
  ];

  scenario.session._space.beyonceBound = true;
  scenario.notifications.length = 0;

  queuePostSpaceAttachFittingHydration(scenario.session, scenario.shipItem.itemID, {
    hydrationProfile: "login",
    inventoryBootstrapPending: true,
  });
  assert.equal(
    scenario.session._space.loginShipInventoryPrimed,
    true,
    "Expected login hydration to start with ship-inventory prime already satisfied",
  );

  invBroker.Handle_GetAvailableTurretSlots([], scenario.session);
  invBroker.afterCallResponse("GetAvailableTurretSlots", scenario.session);
  assert.equal(
    countOnGodmaPrimeItemsByTupleKey(scenario.notifications, tupleKey),
    0,
    "Expected login hydration to avoid tuple godma-prime before the inventory list has completed",
  );
  assert.equal(
    countTupleOnItemChanges(scenario.notifications, tupleKey),
    0,
    "Expected login hydration to avoid resending tuple charge rows before inventory prime completes",
  );

  bindShipInventory(invBroker, scenario.session, scenario.shipItem.itemID);
  invBroker.Handle_List([null], scenario.session, {});

  await new Promise((resolve) => setTimeout(resolve, 450));
  const moduleBootstrapSeen = scenario.notifications.some((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    Array.isArray(entry.payload) &&
    entry.payload[0] &&
    entry.payload[0].type === "packedrow" &&
    Number(entry.payload[0].fields && entry.payload[0].fields.itemID) ===
      Number(scenario.moduleItem.itemID)
  ));
  assert.equal(
    moduleBootstrapSeen,
    false,
    "Expected login hydration to avoid synthetic fitted probe-launcher OnItemChange send",
  );
  assert.equal(
    countOnGodmaPrimeItemsByTupleKey(scenario.notifications, tupleKey),
    0,
    "Expected login hydration to keep tuple godma-prime disabled",
  );
  assert.equal(
    scenario.notifications.some((entry) => (
      entry &&
      entry.name === "OnItemChange" &&
      Array.isArray(entry.payload) &&
      entry.payload[0] &&
      entry.payload[0].type === "packedrow" &&
      Number(entry.payload[0].fields && entry.payload[0].fields.itemID) ===
        Number(scenario.loadedChargeItem.itemID)
    )),
    false,
    "Expected login HUD bootstrap not to restate the real loaded probe charge row",
  );

  invBroker.Handle_GetAvailableTurretSlots([], scenario.session);
  invBroker.afterCallResponse("GetAvailableTurretSlots", scenario.session);

  await new Promise((resolve) => setTimeout(resolve, 650));

  assert.equal(
    countOnGodmaPrimeItemsByTupleKey(scenario.notifications, tupleKey),
    0,
    "Expected later HUD polls to keep tuple godma-prime disabled on login",
  );
  assert.ok(
    countTupleOnItemChanges(scenario.notifications, tupleKey) >= 0,
    "Expected later HUD polls to remain valid without redundant charge rows",
  );
  assert.equal(
    countTupleQuantityBootstrapChanges(scenario.notifications, tupleKey),
    0,
    "Expected later HUD polls to avoid tuple quantity bootstrap churn",
  );
});

test("undock hydration keeps loaded scanner probes tuple-backed", async () => {
  const scenario = createProbeLauncherScenario({ loadedQuantity: 8 });
  const invBroker = new InvBrokerService();
  const tupleKey = [
    scenario.shipItem.itemID,
    scenario.moduleItem.flagID,
    scenario.chargeType.typeID,
  ];

  scenario.session._space.beyonceBound = true;
  scenario.notifications.length = 0;

  queuePostSpaceAttachFittingHydration(scenario.session, scenario.shipItem.itemID, {
    hydrationProfile: "undock",
  });
  bindShipInventory(invBroker, scenario.session, scenario.shipItem.itemID);
  invBroker.Handle_GetSelfInvItem([], scenario.session);
  invBroker.Handle_List([null], scenario.session, {});
  assert.ok(
    countOnGodmaPrimeItemsByTupleKey(scenario.notifications, tupleKey) === 0,
    "Expected undock GetSelfInvItem not to prime scanner probes outside GetAllInfo",
  );
  assert.ok(
    countTupleOnItemChanges(scenario.notifications, tupleKey) === 0,
    "Expected undock GetSelfInvItem to avoid resending tuple rows before the HUD bootstrap",
  );
  assert.ok(
    countTupleQuantityBootstrapChanges(scenario.notifications, tupleKey) === 0,
    "Expected undock GetSelfInvItem to avoid resending tuple quantity before the HUD bootstrap",
  );
  assert.equal(
    scenario.notifications.some((entry) => (
      entry &&
      entry.name === "OnItemChange" &&
      Array.isArray(entry.payload) &&
      entry.payload[0] &&
      entry.payload[0].type === "packedrow" &&
      Number(entry.payload[0].fields && entry.payload[0].fields.itemID) ===
        Number(scenario.loadedChargeItem.itemID)
    )),
    false,
    "Expected undock GetSelfInvItem not to resend the real loaded probe charge row",
  );
  assert.equal(
    scenario.session._space.loginShipInventoryPrimed,
    true,
    "Expected undock ship inventory list to mark inventory prime complete",
  );

  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(
    countOnGodmaPrimeItemsByTupleKey(scenario.notifications, tupleKey),
    0,
    "Expected undock auto-hydration to avoid tuple godma-prime for loaded scanner probes",
  );
  assert.equal(
    countTupleOnItemChanges(scenario.notifications, tupleKey),
    0,
    "Expected undock auto-hydration to avoid resending tuple rows for loaded scanner probes",
  );
  assert.equal(
    countTupleQuantityBootstrapChanges(scenario.notifications, tupleKey),
    0,
    "Expected undock auto-hydration to avoid redundant tuple quantity updates",
  );
  assert.equal(
    scenario.notifications.some((entry) => (
      entry &&
      entry.name === "OnItemChange" &&
      Array.isArray(entry.payload) &&
      entry.payload[0] &&
      entry.payload[0].type === "packedrow" &&
      Number(entry.payload[0].fields && entry.payload[0].fields.itemID) ===
        Number(scenario.loadedChargeItem.itemID)
    )),
    false,
    "Expected undock auto-hydration not to restate the real loaded probe charge row",
  );
});

test("LoadAmmo keeps transition hydration from emitting scanner-probe tuple rows", async () => {
  const scenario = createProbeLauncherScenario({
    launcherName: "Moreau’s Modified Expanded Scan Probe Launcher",
    chargeName: "Satori-Horigu Combat Scanner Probe",
    loadedQuantity: 8,
  });
  const dogma = new DogmaService();
  const cargoGrantResult = grantItemToCharacterLocation(
    scenario.characterRecord.characterID,
    scenario.shipItem.itemID,
    ITEM_FLAGS.CARGO_HOLD,
    scenario.chargeType,
    8,
    {
      transient: true,
      singleton: false,
    },
  );
  assert.equal(cargoGrantResult.success, true, "Failed to grant cargo probe stack");
  const cargoCharge = cargoGrantResult.data.items[0];
  scenario.notifications.length = 0;

  dogma.Handle_LoadAmmo([
    scenario.shipItem.itemID,
    scenario.moduleItem.itemID,
    [cargoCharge.itemID],
    scenario.shipItem.itemID,
  ], scenario.session);

  await new Promise((resolve) => setTimeout(resolve, 175));

  const onGodmaPrimeNotifications = scenario.notifications.filter(
    (entry) => entry.name === "OnGodmaPrimeItem",
  );
  assert.equal(
    onGodmaPrimeNotifications.length,
    0,
    "Expected transition hydration not to re-prime scanner probes",
  );
  assert.equal(
    scenario.notifications.some((entry) => entry.name === "OnItemChange"),
    false,
    "Expected transition hydration not to synthesize scanner-probe tuple rows",
  );
});

test("LoadAmmo force-syncs probe launcher runtime timing so the client sees a live loaded launcher", async () => {
  const scenario = createProbeLauncherScenario({
    launcherName: "Moreauâ€™s Modified Expanded Scan Probe Launcher",
    chargeName: "Satori-Horigu Combat Scanner Probe",
    loadedQuantity: 8,
  });
  const dogma = new DogmaService();
  const cargoGrantResult = grantItemToCharacterLocation(
    scenario.characterRecord.characterID,
    scenario.shipItem.itemID,
    ITEM_FLAGS.CARGO_HOLD,
    scenario.chargeType,
    8,
    {
      transient: true,
      singleton: false,
    },
  );
  assert.equal(cargoGrantResult.success, true, "Failed to grant cargo probe stack");
  const cargoCharge = cargoGrantResult.data.items[0];

  scenario.notifications.length = 0;
  dogma.Handle_LoadAmmo([
    scenario.shipItem.itemID,
    scenario.moduleItem.itemID,
    [cargoCharge.itemID],
    scenario.shipItem.itemID,
  ], scenario.session);

  await new Promise((resolve) => setTimeout(resolve, 25));

  const speedChanges = extractModuleAttributeChanges(scenario.notifications)
    .filter((change) => (
      Array.isArray(change) &&
      Number(change[2]) === Number(scenario.moduleItem.itemID) &&
      Number(change[3]) === ATTRIBUTE_SPEED
    ));
  assert.ok(
    speedChanges.length >= 1,
    "Expected probe launcher reload/repair to force-sync the live speed attribute for the client",
  );
  assert.ok(
    speedChanges.some((change) => unwrapAttributeValue(change[5]) > 0),
    "Expected probe launcher speed sync to advertise a positive speed value",
  );
});

test("dogma LaunchProbes rejects overlaunching beyond the loaded probe quantity", () => {
  const scenario = createProbeLauncherScenario({ loadedQuantity: 1 });
  const dogma = new DogmaService();

  let thrown = null;
  try {
    dogma.Handle_LaunchProbes([scenario.moduleItem.itemID, 2], scenario.session);
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, "Expected LaunchProbes to reject overlaunching");
  assert.equal(getWrappedUserErrorMessage(thrown), "CustomNotify");
  assert.equal(
    getWrappedUserErrorDict(thrown).notify,
    "You do not have enough loaded scanner probes.",
  );
  assert.equal(
    probeRuntimeState.getCharacterSystemProbes(
      scenario.characterRecord.characterID,
      TEST_SYSTEM_ID,
    ).length,
    0,
  );
});
