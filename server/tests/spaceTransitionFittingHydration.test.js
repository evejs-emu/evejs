const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const transitions = require(path.join(repoRoot, "server/src/space/transitions"));
const worldData = require(path.join(repoRoot, "server/src/space/worldData"));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
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
  getLoadedChargeItems,
  buildChargeTupleItemID,
  isModuleOnline,
  hasLoadedScanProbeLauncherCharge,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  seedCombatShipFixture,
} = require(path.join(repoRoot, "server/tests/helpers/testCharacterFixtures"));

const SPACE_COMBAT_FIXTURE_CHARACTER_ID = 998830001;
const DOCKED_COMBAT_FIXTURE_CHARACTER_ID = 998830002;

function buildSession(characterID) {
  const notifications = [];
  const sessionChanges = [];
  return {
    clientID: characterID + 9200,
    userid: characterID,
    characterID: 0,
    charid: 0,
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
    _notifications: notifications,
    _sessionChanges: sessionChanges,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange(change, options = {}) {
      sessionChanges.push({ change, options });
    },
  };
}

function findSpaceCombatCandidate() {
  seedCombatShipFixture({
    characterID: SPACE_COMBAT_FIXTURE_CHARACTER_ID,
    shipID: SPACE_COMBAT_FIXTURE_CHARACTER_ID * 10000 + 1,
    inSpace: true,
  });
  const ship = getActiveShipRecord(SPACE_COMBAT_FIXTURE_CHARACTER_ID);
  const fittedModules = getFittedModuleItems(SPACE_COMBAT_FIXTURE_CHARACTER_ID, ship && ship.itemID);
  const loadedCharges = getLoadedChargeItems(SPACE_COMBAT_FIXTURE_CHARACTER_ID, ship && ship.itemID);
  assert.ok(ship && ship.spaceState, "Expected seeded in-space combat fixture ship");
  assert.ok(fittedModules.some((item) => isModuleOnline(item)), "Expected seeded online modules");
  assert.ok(loadedCharges.length > 0, "Expected seeded loaded charges");
  assert.equal(
    hasLoadedScanProbeLauncherCharge(SPACE_COMBAT_FIXTURE_CHARACTER_ID, ship.itemID),
    false,
    "Expected seeded hydration fixture to avoid scan-probe tuple special cases",
  );
  return {
    characterID: SPACE_COMBAT_FIXTURE_CHARACTER_ID,
    ship,
    fittedModules,
    loadedCharges,
  };
}

function findDockedCombatCandidate() {
  seedCombatShipFixture({
    characterID: DOCKED_COMBAT_FIXTURE_CHARACTER_ID,
    shipID: DOCKED_COMBAT_FIXTURE_CHARACTER_ID * 10000 + 1,
    inSpace: false,
    stationID: 60003760,
    solarSystemID: 30000142,
  });
  const characterRecord = getCharacterRecord(DOCKED_COMBAT_FIXTURE_CHARACTER_ID);
  const ship = getActiveShipRecord(DOCKED_COMBAT_FIXTURE_CHARACTER_ID);
  const stationID = Number(characterRecord && (characterRecord.stationID || characterRecord.stationid || 0));
  const fittedModules = getFittedModuleItems(DOCKED_COMBAT_FIXTURE_CHARACTER_ID, ship && ship.itemID);
  const loadedCharges = getLoadedChargeItems(DOCKED_COMBAT_FIXTURE_CHARACTER_ID, ship && ship.itemID);
  const fallbackStation = worldData.getStationByID(stationID);
  assert.ok(
    fallbackStation,
    `Expected a valid station for docked combat candidate ${stationID}`,
  );
  assert.ok(ship && !ship.spaceState, "Expected seeded docked combat fixture ship");
  assert.ok(fittedModules.some((item) => isModuleOnline(item)), "Expected seeded online modules");
  assert.ok(loadedCharges.length > 0, "Expected seeded loaded charges");
  assert.equal(
    hasLoadedScanProbeLauncherCharge(DOCKED_COMBAT_FIXTURE_CHARACTER_ID, ship.itemID),
    false,
    "Expected seeded hydration fixture to avoid scan-probe tuple special cases",
  );

  return {
    characterID: DOCKED_COMBAT_FIXTURE_CHARACTER_ID,
    ship,
    fittedModules,
    loadedCharges,
    stationID,
  };
}

function getKeyValEntry(value, key) {
  if (
    !value ||
    value.type !== "object" ||
    value.name !== "util.KeyVal" ||
    !value.args ||
    value.args.type !== "dict" ||
    !Array.isArray(value.args.entries)
  ) {
    return null;
  }
  const entry = value.args.entries.find(
    (candidate) => Array.isArray(candidate) && candidate[0] === key,
  );
  return entry ? entry[1] : null;
}

function getDictEntries(value) {
  if (!value || value.type !== "dict" || !Array.isArray(value.entries)) {
    return [];
  }
  return value.entries;
}

function getRowLine(value) {
  if (
    !value ||
    value.type !== "object" ||
    value.name !== "util.Row" ||
    !value.args ||
    value.args.type !== "dict" ||
    !Array.isArray(value.args.entries)
  ) {
    return null;
  }
  const lineEntry = value.args.entries.find(
    (entry) => Array.isArray(entry) && entry[0] === "line",
  );
  return lineEntry ? lineEntry[1] : null;
}

function prepareOpenGate(scene) {
  const stargate = scene.staticEntities.find((entity) => entity.kind === "stargate");
  assert.ok(stargate, "expected at least one stargate in the source scene");
  spaceRuntime.ensureScene(stargate.destinationSolarSystemID);
  spaceRuntime.refreshStargateActivationStates({
    broadcast: false,
    animateOpenTransitions: false,
  });
  scene.settleTransientStargateActivationStates(
    Date.now() + spaceRuntime._testing.STARGATE_ACTIVATION_TRANSITION_MS + 1,
  );
  const openGate = scene.getEntityByID(stargate.itemID);
  assert.ok(openGate, "expected refreshed stargate entity");
  assert.equal(
    openGate.activationState,
    spaceRuntime._testing.STARGATE_ACTIVATION_STATE.OPEN,
  );
  return openGate;
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("stargate jump keeps authoritative attach hydration bookkeeping", () => {
  const candidate = findSpaceCombatCandidate();
  const session = buildSession(candidate.characterID);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
    selectionEvent: false,
  });
  assert.equal(applyResult.success, true);

  const sourceScene = spaceRuntime.ensureScene(candidate.ship.spaceState.systemID);
  const shipEntity = sourceScene.attachSession(session, candidate.ship, {
    broadcast: false,
    emitSimClockRebase: false,
    spawnStopped: true,
  });
  assert.ok(shipEntity);

  const openGate = prepareOpenGate(sourceScene);
  const sourceGate = worldData.getStargateByID(openGate.itemID);
  const destinationGate = worldData.getStargateByID(sourceGate && sourceGate.destinationID);
  assert.ok(sourceGate, "expected a source stargate record");
  assert.ok(destinationGate, "expected a destination stargate record");

  shipEntity.position = { ...openGate.position };
  shipEntity.velocity = { x: 0, y: 0, z: 0 };
  shipEntity.mode = "STOP";
  shipEntity.speedFraction = 0;

  const jumpOutResult = spaceRuntime.startStargateJump(session, sourceGate.itemID);
  assert.equal(jumpOutResult.success, true);

  session._notifications.length = 0;
  session._transitionState = {
    kind: "stargate-jump",
    targetID: sourceGate.itemID,
    startedAt: Date.now(),
  };

  const activeShip = getActiveShipRecord(session.characterID);
  const completionResult = transitions._testing.completeStargateJumpForTesting(
    session,
    sourceGate,
    destinationGate,
    activeShip,
  );
  assert.equal(completionResult.success, true);
  assert.equal(
    session._space && session._space.loginChargeHydrationProfile,
    "stargate",
    "expected stargate jump attach to keep the dedicated stargate hydration profile",
  );
  assert.equal(session._space.loginShipInventoryPrimed, true);
});

test("solar jump keeps authoritative attach hydration bookkeeping", () => {
  const candidate = findSpaceCombatCandidate();
  const session = buildSession(candidate.characterID);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
    selectionEvent: false,
  });
  assert.equal(applyResult.success, true);

  const sourceScene = spaceRuntime.ensureScene(candidate.ship.spaceState.systemID);
  const shipEntity = sourceScene.attachSession(session, candidate.ship, {
    broadcast: false,
    emitSimClockRebase: false,
    spawnStopped: true,
  });
  assert.ok(shipEntity);

  const targetSolarSystemID =
    Number(candidate.ship.spaceState.systemID) === 30000140 ? 30000142 : 30000140;

  session._notifications.length = 0;
  const jumpResult = transitions.jumpSessionToSolarSystem(session, targetSolarSystemID);
  assert.equal(jumpResult.success, true);
  assert.equal(session._space.loginShipInventoryPrimed, true);
});

test("solar jump into an already loaded destination uses the lighter warm hydration profile", () => {
  const candidate = findSpaceCombatCandidate();
  const session = buildSession(candidate.characterID);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
    selectionEvent: false,
  });
  assert.equal(applyResult.success, true);

  const sourceScene = spaceRuntime.ensureScene(candidate.ship.spaceState.systemID);
  const shipEntity = sourceScene.attachSession(session, candidate.ship, {
    broadcast: false,
    emitSimClockRebase: false,
    spawnStopped: true,
  });
  assert.ok(shipEntity);

  const targetSolarSystemID =
    Number(candidate.ship.spaceState.systemID) === 30000140 ? 30000142 : 30000140;

  const warmDestinationScene = spaceRuntime.ensureScene(targetSolarSystemID);
  assert.ok(warmDestinationScene);

  const jumpResult = transitions.jumpSessionToSolarSystem(session, targetSolarSystemID);
  assert.equal(jumpResult.success, true);
  assert.equal(
    session._space && session._space.loginChargeHydrationProfile,
    "solarWarm",
    "expected warm solar jumps to use the lighter hydration profile",
  );
  assert.equal(session._space.loginShipInventoryPrimed, true);
});

test("direct space login GetAllInfo seeds loaded charges as TQ tuple sublocations", () => {
  const candidate = findSpaceCombatCandidate();
  const session = buildSession(candidate.characterID);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
    selectionEvent: false,
  });
  assert.equal(applyResult.success, true);

  const restored = transitions.restoreSpaceSession(session);
  assert.equal(restored, true);
  assert.ok(session._space, "expected direct login to attach the session to space");
  assert.equal(
    session._space.loginChargeHydrationProfile,
    "login",
    "expected direct space login to use the login attach profile",
  );

  const dogma = new DogmaService();
  const dogmaBindArgs = [
    [session.solarsystemid2 || session.solarsystemid, 5],
    ["GetAllInfo", [true, true, null], {}],
  ];
  const dogmaBindResult = dogma.Handle_MachoBindObject(dogmaBindArgs, session);
  assert.ok(Array.isArray(dogmaBindResult), "expected dogma MachoBindObject to bind");
  const allInfo = dogmaBindResult[1];
  const locationInfo = getKeyValEntry(allInfo, "locationInfo");
  const shipModifiedCharAttribs = getKeyValEntry(allInfo, "shipModifiedCharAttribs");
  const shipInfo = getKeyValEntry(allInfo, "shipInfo");
  const shipState = getKeyValEntry(allInfo, "shipState");
  const shipInfoEntries = getDictEntries(shipInfo);
  const shipStateChargeRootEntries = getDictEntries(shipState && shipState[1]);
  const shipStateChargeEntries = getDictEntries(
    (shipStateChargeRootEntries.find(
      (entry) => Array.isArray(entry) && Number(entry[0]) === Number(candidate.ship.itemID),
    ) || [])[1],
  );

  assert.equal(
    locationInfo,
    null,
    "expected direct space login GetAllInfo to match TQ locationInfo=None",
  );
  assert.equal(
    shipModifiedCharAttribs,
    null,
    "expected direct space login GetAllInfo to match TQ shipModifiedCharAttribs=None",
  );
  assert.equal(
    shipStateChargeEntries.length,
    candidate.loadedCharges.length,
    "expected direct space login to include TQ shipState chargeState rows alongside tuple shipInfo charges",
  );

  for (const loadedCharge of candidate.loadedCharges) {
    const loadedQuantity = Math.max(
      0,
      Number(loadedCharge.stacksize ?? loadedCharge.quantity ?? 0) || 0,
    );
    const tupleEntry = shipInfoEntries.find((entry) => (
      Array.isArray(entry) &&
      Array.isArray(entry[0]) &&
      Number(entry[0][0]) === Number(candidate.ship.itemID) &&
      Number(entry[0][1]) === Number(loadedCharge.flagID) &&
      Number(entry[0][2]) === Number(loadedCharge.typeID)
    ));
    assert.ok(
      tupleEntry,
      `expected direct space login GetAllInfo.shipInfo to include tuple charge for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      getKeyValEntry(tupleEntry[1], "invItem"),
      null,
      "expected direct space login tuple charge entry to match TQ invItem=None shape",
    );
    assert.deepEqual(
      getKeyValEntry(tupleEntry[1], "itemID"),
      [Number(candidate.ship.itemID), Number(loadedCharge.flagID), Number(loadedCharge.typeID)],
      "expected direct space login tuple charge itemID to match TQ (shipID, slotFlagID, chargeTypeID)",
    );

    const chargeStateEntry = shipStateChargeEntries.find((entry) => (
      Array.isArray(entry) &&
      Number(entry[0]) === Number(loadedCharge.flagID)
    ));
    assert.ok(
      chargeStateEntry,
      `expected direct space login shipState chargeState to include slot ${loadedCharge.flagID}`,
    );
    assert.deepEqual(
      getRowLine(chargeStateEntry[1]),
      [
        Number(candidate.ship.itemID),
        Number(loadedCharge.flagID),
        Number(loadedCharge.typeID),
        loadedQuantity,
      ],
      "expected direct space login shipState chargeState row to carry TQ quantity for DBLess ammo",
    );
  }

  session._notifications.length = 0;
  dogma.afterCallResponse("MachoBindObject", session, {
    args: dogmaBindArgs,
  });
  const chargeQuantityRefresh = session._notifications.find(
    (entry) => entry.name === "OnModuleAttributeChanges",
  );
  assert.ok(
    chargeQuantityRefresh,
    "expected direct space login after-response to send TQ redundant tuple quantity refresh",
  );
  const quantityRefreshItems =
    chargeQuantityRefresh.payload &&
    chargeQuantityRefresh.payload[0] &&
    chargeQuantityRefresh.payload[0].items;
  assert.equal(Array.isArray(quantityRefreshItems), true);
  for (const loadedCharge of candidate.loadedCharges) {
    const loadedQuantity = Math.max(
      0,
      Number(loadedCharge.stacksize ?? loadedCharge.quantity ?? 0) || 0,
    );
    const tupleItemID = buildChargeTupleItemID(
      candidate.ship.itemID,
      loadedCharge.flagID,
      loadedCharge.typeID,
    );
    const quantityChange = quantityRefreshItems.find((change) => (
      Array.isArray(change) &&
      Array.isArray(change[2]) &&
      change[2].map(Number).join(":") === tupleItemID.map(Number).join(":") &&
      Number(change[3]) === 805
    ));
    assert.ok(
      quantityChange,
      `expected redundant quantity refresh for login tuple charge slot ${loadedCharge.flagID}`,
    );
    assert.equal(Number(quantityChange[5]), loadedQuantity);
    assert.equal(Number(quantityChange[6]), loadedQuantity);
  }
});

test("undock leaves the first ballpark bootstrap free to emit the initial sim-clock rebase", () => {
  const candidate = findDockedCombatCandidate();
  const session = buildSession(candidate.characterID);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
    selectionEvent: false,
    deferDockedShipSessionChange: false,
  });
  assert.equal(applyResult.success, true);

  try {
    session._notifications.length = 0;
    const undockResult = transitions.undockSession(session);
    assert.equal(undockResult.success, true);

    const scene = spaceRuntime.getSceneForSession(session);
    assert.ok(scene, "expected undock to attach the session to a space scene");
    assert.equal(
      session._notifications.filter((entry) => entry.name === "DoSimClockRebase").length,
      0,
      "expected undock attach itself to stay quiet and let the initial ballpark bootstrap own the authoritative rebase",
    );
    assert.equal(
      session._skipNextInitialBallparkRebase === true,
      false,
      "expected undock not to suppress the first bootstrap rebase the CCP/reference path still emits",
    );

    const bootstrapSent = scene.ensureInitialBallpark(session, { force: true });
    assert.equal(bootstrapSent, true);

    const rebaseNotifications = session._notifications.filter(
      (entry) => entry.name === "DoSimClockRebase",
    );
    assert.equal(
      rebaseNotifications.length,
      1,
      "expected the first undock ballpark bootstrap to emit one authoritative sim-clock rebase",
    );
    const firstRebaseIndex = session._notifications.findIndex(
      (entry) => entry.name === "DoSimClockRebase",
    );
    const firstDestinyUpdateIndex = session._notifications.findIndex(
      (entry) => entry.name === "DoDestinyUpdate",
    );
    assert.ok(firstRebaseIndex >= 0, "expected an undock bootstrap rebase notification");
    assert.ok(firstDestinyUpdateIndex >= 0, "expected undock bootstrap destiny updates");
    assert.equal(
      firstRebaseIndex < firstDestinyUpdateIndex,
      true,
      "expected the undock bootstrap rebase to flush before the first AddBalls2/SetState updates",
    );
  } finally {
    if (!session.stationid && !session.stationID) {
      transitions.dockSession(session, candidate.stationID);
    }
  }
});

test("undock GetAllInfo seeds loaded charges as TQ tuple sublocations", () => {
  const candidate = findDockedCombatCandidate();
  const session = buildSession(candidate.characterID);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
    selectionEvent: false,
    deferDockedShipSessionChange: false,
  });
  assert.equal(applyResult.success, true);

  try {
    session._notifications.length = 0;
    const undockResult = transitions.undockSession(session);
    assert.equal(undockResult.success, true);
    const scene = spaceRuntime.getSceneForSession(session);
    assert.ok(scene, "expected undock to attach the session to a space scene");

    const dogma = new DogmaService();
    const dogmaBindArgs = [
      [session.solarsystemid2 || session.solarsystemid, 5],
      ["GetAllInfo", [false, true, null], {}],
    ];
    const dogmaBindResult = dogma.Handle_MachoBindObject(dogmaBindArgs, session);
    assert.ok(Array.isArray(dogmaBindResult), "expected dogma MachoBindObject to bind");
    const allInfo = dogmaBindResult[1];
    const locationInfo = getKeyValEntry(allInfo, "locationInfo");
    const shipModifiedCharAttribs = getKeyValEntry(allInfo, "shipModifiedCharAttribs");
    const systemWideEffectsOnShip = getKeyValEntry(allInfo, "systemWideEffectsOnShip");
    const structureInfo = getKeyValEntry(allInfo, "structureInfo");
    const shipInfo = getKeyValEntry(allInfo, "shipInfo");
    const shipState = getKeyValEntry(allInfo, "shipState");
    const shipInfoEntries = getDictEntries(shipInfo);
    const shipStateChargeRootEntries = getDictEntries(shipState && shipState[1]);
    const shipStateChargeEntries = getDictEntries(
      (shipStateChargeRootEntries.find(
        (entry) => Array.isArray(entry) && Number(entry[0]) === Number(candidate.ship.itemID),
      ) || [])[1],
    );

    assert.equal(
      locationInfo,
      null,
      "expected undock GetAllInfo to match TQ locationInfo=None",
    );
    assert.equal(
      shipModifiedCharAttribs,
      null,
      "expected undock GetAllInfo to skip the large shipModifiedCharAttribs payload like TQ",
    );
    assert.deepEqual(
      getDictEntries(systemWideEffectsOnShip),
      [],
      "expected undock GetAllInfo to send an empty systemWideEffectsOnShip dict outside wormhole effects",
    );
    assert.deepEqual(
      getDictEntries(structureInfo),
      [],
      "expected undock GetAllInfo to send empty structureInfo when no structure is active",
    );
    assert.ok(shipInfoEntries.length > 0, "expected undock GetAllInfo shipInfo entries");
    assert.equal(
      shipStateChargeEntries.length,
      candidate.loadedCharges.length,
      "expected undock to include TQ shipState chargeState rows alongside tuple shipInfo charges",
    );

    for (const loadedCharge of candidate.loadedCharges) {
      const loadedQuantity = Math.max(
        0,
        Number(loadedCharge.stacksize ?? loadedCharge.quantity ?? 0) || 0,
      );
      const tupleEntry = shipInfoEntries.find((entry) => (
        Array.isArray(entry) &&
        Array.isArray(entry[0]) &&
        Number(entry[0][0]) === Number(candidate.ship.itemID) &&
        Number(entry[0][1]) === Number(loadedCharge.flagID) &&
        Number(entry[0][2]) === Number(loadedCharge.typeID)
      ));
      assert.ok(
        tupleEntry,
        `expected undock GetAllInfo.shipInfo to include tuple charge for slot ${loadedCharge.flagID}`,
      );
      assert.equal(
        getKeyValEntry(tupleEntry[1], "invItem"),
        null,
        "expected tuple charge entry to match TQ invItem=None shape",
      );
      assert.deepEqual(
        getKeyValEntry(tupleEntry[1], "itemID"),
        [Number(candidate.ship.itemID), Number(loadedCharge.flagID), Number(loadedCharge.typeID)],
        "expected tuple charge itemID to match TQ (shipID, slotFlagID, chargeTypeID)",
      );
      const chargeStateEntry = shipStateChargeEntries.find((entry) => (
        Array.isArray(entry) &&
        Number(entry[0]) === Number(loadedCharge.flagID)
      ));
      assert.ok(
        chargeStateEntry,
        `expected undock shipState chargeState to include slot ${loadedCharge.flagID}`,
      );
      assert.deepEqual(
        getRowLine(chargeStateEntry[1]),
        [
          Number(candidate.ship.itemID),
          Number(loadedCharge.flagID),
          Number(loadedCharge.typeID),
          loadedQuantity,
        ],
        "expected shipState chargeState row to carry TQ quantity for DBLess ammo",
      );
    }

    session._notifications.length = 0;
    dogma.afterCallResponse("MachoBindObject", session, {
      args: dogmaBindArgs,
    });
    const chargeQuantityRefresh = session._notifications.find(
      (entry) => entry.name === "OnModuleAttributeChanges",
    );
    assert.ok(
      chargeQuantityRefresh,
      "expected undock GetAllInfo after-response to send TQ redundant tuple quantity refresh",
    );
    const quantityRefreshItems =
      chargeQuantityRefresh.payload &&
      chargeQuantityRefresh.payload[0] &&
      chargeQuantityRefresh.payload[0].items;
    assert.equal(
      Array.isArray(quantityRefreshItems),
      true,
      "expected OnModuleAttributeChanges payload to contain a change list",
    );
    for (const loadedCharge of candidate.loadedCharges) {
      const loadedQuantity = Math.max(
        0,
        Number(loadedCharge.stacksize ?? loadedCharge.quantity ?? 0) || 0,
      );
      const tupleItemID = buildChargeTupleItemID(
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      );
      const quantityChange = quantityRefreshItems.find((change) => (
        Array.isArray(change) &&
        Array.isArray(change[2]) &&
        change[2].map(Number).join(":") === tupleItemID.map(Number).join(":") &&
        Number(change[3]) === 805
      ));
      assert.ok(
        quantityChange,
        `expected redundant quantity refresh for tuple charge slot ${loadedCharge.flagID}`,
      );
      assert.equal(Number(quantityChange[5]), loadedQuantity);
      assert.equal(Number(quantityChange[6]), loadedQuantity);
    }
  } finally {
    if (!session.stationid && !session.stationID) {
      transitions.dockSession(session, candidate.stationID);
    }
  }
});
