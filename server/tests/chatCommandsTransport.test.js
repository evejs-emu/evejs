const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const { executeChatCommand } = require(path.join(
  repoRoot,
  "server/src/services/chat/chatCommands",
));
const database = require(path.join(
  repoRoot,
  "server/src/newDatabase",
));
const chatHubModule = require(path.join(
  repoRoot,
  "server/src/services/chat/chatHub",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const {
  applyCharacterToSession,
  getCharacterRecord,
  getActiveShipRecord,
  updateCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  updateShipItem,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const spaceRuntime = require(path.join(
  repoRoot,
  "server/src/space/runtime",
));
const worldData = require(path.join(
  repoRoot,
  "server/src/space/worldData",
));

const TEST_SYSTEM_ID = 30000142;
const registeredSessions = [];

function createFakeSession(clientID, characterID, position, direction = { x: 1, y: 0, z: 0 }) {
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
        direction,
        mode: "STOP",
        speedFraction: 0,
      },
    },
  };
}

function registerAttachedSession(session) {
  registeredSessions.push(session);
  sessionRegistry.register(session);
  spaceRuntime.attachSession(session, session.shipItem, {
    systemID: TEST_SYSTEM_ID,
    broadcast: false,
    spawnStopped: true,
  });
  assert.equal(
    spaceRuntime.ensureInitialBallpark(session),
    true,
    "expected test session to finish initial ballpark bootstrap",
  );
  session.notifications.length = 0;
  return session;
}

function registerLiveSession(session) {
  registeredSessions.push(session);
  sessionRegistry.register(session);
  return session;
}

function readShipEntity(session) {
  const entity = spaceRuntime.getEntity(
    session,
    session && session._space ? session._space.shipID : null,
  );
  assert(entity, "expected attached ship entity");
  return entity;
}

function readPosition(entity) {
  return {
    x: Number(entity && entity.position && entity.position.x || 0),
    y: Number(entity && entity.position && entity.position.y || 0),
    z: Number(entity && entity.position && entity.position.z || 0),
  };
}

function buildDbBackedSession(characterID) {
  const notifications = [];
  const sessionChanges = [];
  return {
    clientID: characterID + 9300,
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
    sendSessionChange(change) {
      sessionChanges.push(change);
    },
  };
}

function getDockedTransportCandidate(excludedCharacterIDs = []) {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "failed to read characters table");
  const excluded = new Set(
    (Array.isArray(excludedCharacterIDs) ? excludedCharacterIDs : [excludedCharacterIDs])
      .map((value) => Number(value) || 0)
      .filter((value) => value > 0),
  );

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((value) => Number(value) || 0)
    .filter((value) => value > 0)
    .sort((left, right) => left - right);

  for (const characterID of characterIDs) {
    if (excluded.has(characterID)) {
      continue;
    }
    const characterRecord = getCharacterRecord(characterID);
    const activeShip = getActiveShipRecord(characterID);
    const stationID = Number(
      characterRecord &&
        (characterRecord.stationID || characterRecord.stationid || 0),
    ) || 0;
    if (!characterRecord || !activeShip || stationID <= 0) {
      continue;
    }
    const station = worldData.getStationByID(stationID);
    if (!station) {
      continue;
    }
    return {
      characterID,
      stationID,
      solarSystemID: Number(station.solarSystemID) || 0,
      activeShipID: Number(activeShip.itemID) || 0,
      characterRecord: structuredClone(characterRecord),
      activeShipRecord: structuredClone(activeShip),
    };
  }

  assert.fail("expected a docked character with an active ship for /tr session-change verification");
}

function getOtherSolarSystemID(sourceSystemID) {
  const match = worldData.getSolarSystems().find(
    (solarSystem) => Number(solarSystem && solarSystem.solarSystemID) !== Number(sourceSystemID),
  );
  assert(match, "expected a different solar system for /tr jump verification");
  return Number(match.solarSystemID) || 0;
}

test.afterEach(() => {
  for (const session of registeredSessions.splice(0)) {
    sessionRegistry.unregister(session);
  }
  spaceRuntime._testing.clearScenes();
});

test("tr supports native pos=, offset=, and me me offset= forms", () => {
  const session = registerAttachedSession(
    createFakeSession(
      981001,
      991001,
      { x: 10, y: 20, z: 30 },
    ),
  );

  const posResult = executeChatCommand(
    session,
    "/tr me pos=100,200,300",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(posResult.handled, true);
  assert.match(posResult.message, /Transported me/i);
  assert.deepEqual(
    readPosition(readShipEntity(session)),
    { x: 100, y: 200, z: 300 },
  );

  const directOffsetResult = executeChatCommand(
    session,
    "/tr me offset=1,2,3",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(directOffsetResult.handled, true);
  assert.deepEqual(
    readPosition(readShipEntity(session)),
    { x: 101, y: 202, z: 303 },
  );

  const offsetResult = executeChatCommand(
    session,
    "/tr me me offset=4,-12,12",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(offsetResult.handled, true);
  assert.deepEqual(
    readPosition(readShipEntity(session)),
    { x: 105, y: 190, z: 315 },
  );
});

test("tr resolves me <entityID> against current scene anchors", () => {
  const session = registerAttachedSession(
    createFakeSession(
      981002,
      991002,
      { x: 0, y: 0, z: 0 },
    ),
  );
  const gate = worldData.getStargatesForSystem(TEST_SYSTEM_ID)[0];
  assert(gate, "expected a stargate in the test system");

  const result = executeChatCommand(
    session,
    `/tr me ${gate.itemID}`,
    null,
    { emitChatFeedback: false },
  );
  assert.equal(result.handled, true);
  assert.deepEqual(
    readPosition(readShipEntity(session)),
    readPosition({ position: gate.position }),
  );
});

test("tr supports live character transport with noblock", () => {
  const invoker = registerAttachedSession(
    createFakeSession(
      981003,
      991003,
      { x: 500, y: 0, z: 0 },
    ),
  );
  const target = registerAttachedSession(
    createFakeSession(
      981004,
      991004,
      { x: 9000, y: 0, z: 0 },
    ),
  );

  const result = executeChatCommand(
    invoker,
    `/tr ${target.characterID} me noblock`,
    null,
    { emitChatFeedback: false },
  );
  assert.equal(result.handled, true);
  assert.deepEqual(
    readPosition(readShipEntity(target)),
    readPosition(readShipEntity(invoker)),
  );
});

test("tele follows a live connected character in space", () => {
  const targetCandidate = getDockedTransportCandidate();
  const invokerCandidate = getDockedTransportCandidate([targetCandidate.characterID]);
  const otherSolarSystemID = getOtherSolarSystemID(targetCandidate.solarSystemID);

  const targetSession = registerLiveSession(buildDbBackedSession(targetCandidate.characterID));
  const invokerSession = registerLiveSession(buildDbBackedSession(invokerCandidate.characterID));
  const restoreEntries = [
    targetCandidate,
    invokerCandidate,
  ];

  const applyTarget = applyCharacterToSession(targetSession, targetCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
    selectionEvent: false,
  });
  assert.equal(applyTarget.success, true, "expected target session to hydrate");

  const applyInvoker = applyCharacterToSession(invokerSession, invokerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
    selectionEvent: false,
  });
  assert.equal(applyInvoker.success, true, "expected invoker session to hydrate");

  try {
    const preMoveResult = executeChatCommand(
      targetSession,
      `/tr me ${otherSolarSystemID}`,
      null,
      { emitChatFeedback: false },
    );
    assert.equal(preMoveResult.handled, true);
    assert(targetSession._space, "expected target to be in space before /tele");

    const result = executeChatCommand(
      invokerSession,
      `/tele ${targetCandidate.characterRecord.characterName}`,
      null,
      { emitChatFeedback: false },
    );
    assert.equal(result.handled, true);
    assert.match(result.message, /Transported me to /i);
    assert(invokerSession._space, "expected /tele to move the invoker into space");
    assert.equal(
      Number(invokerSession._space.systemID || 0),
      Number(targetSession._space.systemID || 0),
    );
    assert.deepEqual(
      readPosition(readShipEntity(invokerSession)),
      readPosition(readShipEntity(targetSession)),
    );
  } finally {
    if (targetSession._space) {
      spaceRuntime.detachSession(targetSession, { broadcast: false });
    }
    if (invokerSession._space) {
      spaceRuntime.detachSession(invokerSession, { broadcast: false });
    }
    for (const candidate of restoreEntries) {
      const restoreCharacter = updateCharacterRecord(
        candidate.characterID,
        () => candidate.characterRecord,
      );
      assert.equal(restoreCharacter.success, true, "expected character restore to succeed");
      const restoreShip = updateShipItem(
        candidate.activeShipID,
        () => candidate.activeShipRecord,
      );
      assert.equal(restoreShip.success, true, "expected ship restore to succeed");
    }
  }
});

test("tr self system and station targets use full session-change flows", () => {
  const candidate = getDockedTransportCandidate();
  const targetSolarSystemID = getOtherSolarSystemID(candidate.solarSystemID);
  const session = buildDbBackedSession(candidate.characterID);
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
    selectionEvent: false,
  });
  assert.equal(applyResult.success, true, "expected candidate session to hydrate");

  const sentMessages = [];
  const moveCalls = [];
  const originalMoveLocalSession = chatHubModule.moveLocalSession;
  const recordMove = (source) => (targetSession, previousChannelID = 0) => {
    moveCalls.push({
      source,
      targetSession,
      previousChannelID: Number(previousChannelID) || 0,
    });
    return originalMoveLocalSession(targetSession, previousChannelID);
  };
  chatHubModule.moveLocalSession = recordMove("module");
  const chatHub = {
    sendSystemMessage(targetSession, message, targetChannel) {
      sentMessages.push({ targetSession, message, targetChannel });
    },
    moveLocalSession: recordMove("explicit"),
  };

  try {
    session._sessionChanges.length = 0;
    const solarResult = executeChatCommand(
      session,
      `/tr me ${targetSolarSystemID}`,
      chatHub,
      {
        emitChatFeedback: true,
        feedbackChannel: `local_${candidate.solarSystemID}`,
      },
    );
    assert.equal(solarResult.handled, true);
    assert.equal(
      Number(session._space && session._space.systemID),
      targetSolarSystemID,
      "expected /tr me <systemID> to perform a real solar-system jump",
    );
    assert.equal(
      Number(session.stationID || session.stationid || 0),
      0,
      "expected solar /tr target to leave the character undocked in space",
    );
    assert(
      moveCalls.some((call) => call.previousChannelID === candidate.solarSystemID),
      "expected solar /tr target to move the Local session like /solar",
    );
    assert.equal(
      sentMessages[sentMessages.length - 1].targetChannel,
      null,
      "expected solar /tr feedback to clear the old Local channel target like /solar",
    );
    assert(
      session._sessionChanges.length > 0,
      "expected solar /tr target to emit session-change updates",
    );

    moveCalls.length = 0;
    sentMessages.length = 0;
    session._sessionChanges.length = 0;

    const dockResult = executeChatCommand(
      session,
      `/tr me ${candidate.stationID}`,
      chatHub,
      {
        emitChatFeedback: true,
        feedbackChannel: `local_${targetSolarSystemID}`,
      },
    );
    assert.equal(dockResult.handled, true);
    assert.equal(
      Number(session.stationID || session.stationid || 0),
      candidate.stationID,
      "expected /tr me <stationID> to perform a real station dock jump",
    );
    assert.equal(
      session._space,
      null,
      "expected station /tr target to end docked with no live space attachment",
    );
    assert.equal(
      Number(session.locationid || 0),
      candidate.stationID,
      "expected station /tr target to keep locationid on the destination station like /dock",
    );
    assert.equal(
      session.solarsystemid,
      null,
      "expected station /tr target to leave solarsystemid unset while docked like /dock",
    );
    assert.equal(
      Number(session.solarsystemid2 || 0),
      candidate.solarSystemID,
      "expected station /tr target to preserve solarsystemid2 for the destination station's system",
    );
    assert(
      moveCalls.some((call) => call.previousChannelID === targetSolarSystemID),
      "expected station /tr target to move the Local session like /dock",
    );
    assert.equal(
      sentMessages[sentMessages.length - 1].targetChannel,
      null,
      "expected station /tr feedback to clear the old Local channel target like /dock",
    );
    assert(
      session._sessionChanges.length > 0,
      "expected station /tr target to emit session-change updates",
    );
    assert.equal(
      session._sessionChanges.some(
        (change) =>
          change &&
          change.solarsystemid &&
          Number(change.solarsystemid[1] || 0) === candidate.solarSystemID,
      ),
      false,
      "expected station /tr target not to re-enter a live solarsystemid after docking",
    );
    assert.equal(
      session._sessionChanges.some(
        (change) =>
          change &&
          change.locationid &&
          Number(change.locationid[1] || 0) === candidate.solarSystemID,
      ),
      false,
      "expected station /tr target not to move locationid back to the solar system after docking",
    );
  } finally {
    chatHubModule.moveLocalSession = originalMoveLocalSession;
    if (session._space) {
      spaceRuntime.detachSession(session, { broadcast: false });
    }
    const restoreCharacter = updateCharacterRecord(
      candidate.characterID,
      () => candidate.characterRecord,
    );
    assert.equal(restoreCharacter.success, true, "expected character restore to succeed");
    const restoreShip = updateShipItem(
      candidate.activeShipID,
      () => candidate.activeShipRecord,
    );
    assert.equal(restoreShip.success, true, "expected ship restore to succeed");
  }
});

test("tele docks you when the target character is docked", () => {
  const targetCandidate = getDockedTransportCandidate();
  const invokerCandidate = getDockedTransportCandidate([targetCandidate.characterID]);
  const otherSolarSystemID = getOtherSolarSystemID(targetCandidate.solarSystemID);

  const targetSession = registerLiveSession(buildDbBackedSession(targetCandidate.characterID));
  const invokerSession = registerLiveSession(buildDbBackedSession(invokerCandidate.characterID));
  const restoreEntries = [
    targetCandidate,
    invokerCandidate,
  ];

  const applyTarget = applyCharacterToSession(targetSession, targetCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
    selectionEvent: false,
  });
  assert.equal(applyTarget.success, true, "expected docked target session to hydrate");

  const applyInvoker = applyCharacterToSession(invokerSession, invokerCandidate.characterID, {
    emitNotifications: false,
    logSelection: false,
    selectionEvent: false,
  });
  assert.equal(applyInvoker.success, true, "expected invoker session to hydrate");

  try {
    const preMoveResult = executeChatCommand(
      invokerSession,
      `/tr me ${otherSolarSystemID}`,
      null,
      { emitChatFeedback: false },
    );
    assert.equal(preMoveResult.handled, true);
    assert.equal(
      Number(invokerSession.stationID || invokerSession.stationid || 0),
      0,
      "expected invoker to start the /tele check in space",
    );

    const teleResult = executeChatCommand(
      invokerSession,
      `/tele ${targetCandidate.characterRecord.characterName}`,
      null,
      { emitChatFeedback: false },
    );
    assert.equal(teleResult.handled, true);
    assert.equal(
      Number(invokerSession.stationID || invokerSession.stationid || 0),
      targetCandidate.stationID,
      "expected /tele to dock the invoker at the target station",
    );
    assert.equal(
      invokerSession._space,
      null,
      "expected /tele to leave the invoker docked when the target is docked",
    );
    assert.equal(
      Number(invokerSession.solarsystemid2 || 0),
      targetCandidate.solarSystemID,
    );
    assert.match(
      teleResult.message,
      /Transported me to Jita IV - Moon 4 - Caldari Navy Assembly Plant\./,
    );
  } finally {
    if (targetSession._space) {
      spaceRuntime.detachSession(targetSession, { broadcast: false });
    }
    if (invokerSession._space) {
      spaceRuntime.detachSession(invokerSession, { broadcast: false });
    }
    for (const candidate of restoreEntries) {
      const restoreCharacter = updateCharacterRecord(
        candidate.characterID,
        () => candidate.characterRecord,
      );
      assert.equal(restoreCharacter.success, true, "expected character restore to succeed");
      const restoreShip = updateShipItem(
        candidate.activeShipID,
        () => candidate.activeShipRecord,
      );
      assert.equal(restoreShip.success, true, "expected ship restore to succeed");
    }
  }
});

test("tr supports raw x y z coordinates for runtime entity targets", () => {
  const session = registerAttachedSession(
    createFakeSession(
      981005,
      991005,
      { x: 0, y: 0, z: 0 },
    ),
  );

  const spawnResult = spaceRuntime.spawnDynamicShip(TEST_SYSTEM_ID, {
    itemID: 980001,
    typeID: 606,
    ownerID: 500010,
    corporationID: 500010,
    itemName: "Transport Test Ship",
    position: { x: 500, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    mode: "STOP",
    speedFraction: 0,
  }, {
    broadcast: false,
  });
  assert.equal(spawnResult.success, true);

  const result = executeChatCommand(
    session,
    `/tr ${spawnResult.data.entity.itemID} 777 888 999`,
    null,
    { emitChatFeedback: false },
  );
  assert.equal(result.handled, true);

  const scene = spaceRuntime.getSceneForSession(session);
  const entity = scene && scene.getEntityByID(spawnResult.data.entity.itemID);
  assert(entity, "expected spawned runtime entity to remain in scene");
  assert.deepEqual(
    readPosition(entity),
    { x: 777, y: 888, z: 999 },
  );
});
