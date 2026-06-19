const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const { executeChatCommand } = require(path.join(
  repoRoot,
  "server/src/services/chat/chatCommands",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const spaceRuntime = require(path.join(
  repoRoot,
  "server/src/space/runtime",
));
const {
  getActiveShipRecord,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  ITEM_FLAGS,
  findCharacterShipByType,
  listContainerItems,
  moveShipToSpace,
  setActiveShipForCharacter,
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
  listFittedItems,
  getLoadedChargeByFlag,
  getModuleChargeCapacity,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));

const TEST_SYSTEM_ID = 30000142;
const registeredSessions = [];

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDockedCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "failed to read characters table");

  for (const [characterID, record] of Object.entries(charactersResult.data || {})) {
    const numericCharacterID = Number(characterID) || 0;
    const stationID = Number(record && (record.stationID || record.stationid || 0)) || 0;
    if (numericCharacterID > 0 && stationID > 0) {
      return {
        characterID: numericCharacterID,
        stationID,
      };
    }
  }

  assert.fail("expected at least one docked character");
}

function buildDockedSession(characterID, stationID) {
  return {
    clientID: characterID + 810000,
    userid: characterID,
    characterID,
    charid: characterID,
    stationid: stationID,
    stationID: stationID,
    locationid: stationID,
    sendNotification() {},
    sendSessionChange() {},
  };
}

function assertModuleHasFullLoadedCharge(characterID, shipID, moduleItem, expectedChargeName) {
  const loadedCharge = getLoadedChargeByFlag(
    characterID,
    shipID,
    Number(moduleItem && moduleItem.flagID) || 0,
  );
  assert.ok(
    loadedCharge,
    `expected ${expectedChargeName} to be loaded into ${moduleItem && moduleItem.itemName}`,
  );
  assert.equal(
    String(loadedCharge.itemName || ""),
    expectedChargeName,
    `expected ${moduleItem && moduleItem.itemName} to preload ${expectedChargeName}`,
  );
  assert.equal(
    Number(loadedCharge.stacksize || 0),
    Number(getModuleChargeCapacity(
      Number(moduleItem && moduleItem.typeID) || 0,
      Number(loadedCharge.typeID) || 0,
    )) || 0,
    `expected ${moduleItem && moduleItem.itemName} to preload a full clip`,
  );
}

function assertCburstLoadout(characterID, shipItemID) {
  const fitted = listFittedItems(characterID, shipItemID);
  const fittedNames = fitted.map((item) => String(item && item.itemName || ""));
  const expectedModuleNames = [
    "Armor Command Burst II",
    "Information Command Burst II",
    "Mining Foreman Burst II",
    "Shield Command Burst II",
    "Skirmish Command Burst II",
  ];
  for (const moduleName of expectedModuleNames) {
    assert.ok(fittedNames.includes(moduleName), `expected ${moduleName} to be fitted`);
  }

  const expectedPreloads = [
    ["Armor Command Burst II", "Armor Reinforcement Charge"],
    ["Information Command Burst II", "Sensor Optimization Charge"],
    ["Mining Foreman Burst II", "Mining Laser Optimization Charge"],
    ["Shield Command Burst II", "Shield Extension Charge"],
    ["Skirmish Command Burst II", "Rapid Deployment Charge"],
  ];
  for (const [moduleName, chargeName] of expectedPreloads) {
    const moduleItem = fitted.find((item) => String(item && item.itemName || "") === moduleName);
    assert.ok(moduleItem, `expected ${moduleName} module item`);
    assertModuleHasFullLoadedCharge(characterID, shipItemID, moduleItem, chargeName);
  }

  const cargo = listContainerItems(
    characterID,
    shipItemID,
    ITEM_FLAGS.CARGO_HOLD,
  );
  const cargoNames = new Set(cargo.map((item) => String(item && item.itemName || "")));
  const expectedCargoNames = [
    "Armor Energizing Charge",
    "Armor Reinforcement Charge",
    "Rapid Repair Charge",
    "Electronic Superiority Charge",
    "Electronic Hardening Charge",
    "Sensor Optimization Charge",
    "Mining Laser Field Enhancement Charge",
    "Mining Laser Optimization Charge",
    "Mining Equipment Preservation Charge",
    "Shield Harmonizing Charge",
    "Shield Extension Charge",
    "Active Shielding Charge",
    "Evasive Maneuvers Charge",
    "Interdiction Maneuvers Charge",
    "Rapid Deployment Charge",
  ];
  for (const chargeName of expectedCargoNames) {
    assert.ok(cargoNames.has(chargeName), `expected ${chargeName} in /cburst cargo`);
  }
}

function assertOrcaLoadout(characterID, shipItemID) {
  const fitted = listFittedItems(characterID, shipItemID);
  const fittedNames = fitted.map((item) => String(item && item.itemName || ""));
  const expectedModuleCounts = new Map([
    ["Large Asteroid Ore Compressor I", 1],
    ["Mining Foreman Burst II", 1],
    ["Small Tractor Beam II", 2],
    ["Drone Link Augmentor II", 2],
    ["Large Shield Extender II", 5],
    ["Damage Control II", 1],
    ["Reinforced Bulkheads II", 1],
  ]);
  for (const [moduleName, expectedCount] of expectedModuleCounts.entries()) {
    assert.equal(
      fittedNames.filter((name) => name === moduleName).length,
      expectedCount,
      `expected ${expectedCount}x ${moduleName} to be fitted`,
    );
  }

  const expectedPreloads = [
    ["Mining Foreman Burst II", "Mining Laser Optimization Charge"],
  ];
  for (const [moduleName, chargeName] of expectedPreloads) {
    const moduleItem = fitted.find((item) => String(item && item.itemName || "") === moduleName);
    assert.ok(moduleItem, `expected ${moduleName} module item`);
    assertModuleHasFullLoadedCharge(characterID, shipItemID, moduleItem, chargeName);
  }

  const cargo = listContainerItems(
    characterID,
    shipItemID,
    ITEM_FLAGS.CARGO_HOLD,
  );
  const cargoNames = new Set(cargo.map((item) => String(item && item.itemName || "")));
  const expectedCargoNames = [
    "Mining Laser Field Enhancement Charge",
    "Mining Laser Optimization Charge",
    "Mining Equipment Preservation Charge",
  ];
  for (const chargeName of expectedCargoNames) {
    assert.ok(cargoNames.has(chargeName), `expected ${chargeName} in /orca cargo`);
  }
  assert.equal(cargo.length, expectedCargoNames.length, "expected /orca to carry only mining burst charges");
}

function assertEwarLoadout(characterID, shipItemID) {
  const fitted = listFittedItems(characterID, shipItemID);
  const fittedNames = fitted.map((item) => String(item && item.itemName || ""));
  const expectedModuleCounts = new Map([
    ["500MN Y-T8 Compact Microwarpdrive", 1],
    ["Gotan's Modified Stasis Webifier", 1],
    ["Tisiphone's Modified Target Painter", 1],
    ["Gotan's Modified Heavy Warp Scrambler", 1],
    ["Gotan's Modified Heavy Warp Disruptor", 1],
    ["Dread Guristas Multispectral ECM", 1],
    ["Draclira's Modified Heavy Energy Neutralizer", 3],
    ["Draclira's Modified Heavy Energy Nosferatu", 3],
  ]);
  for (const [moduleName, expectedCount] of expectedModuleCounts.entries()) {
    assert.equal(
      fittedNames.filter((name) => name === moduleName).length,
      expectedCount,
      `expected ${expectedCount}x ${moduleName} to be fitted`,
    );
  }
}

function assertProbeLoadout(characterID, shipItemID) {
  const fitted = listFittedItems(characterID, shipItemID);
  const fittedNames = fitted.map((item) => String(item && item.itemName || ""));
  const expectedModuleNames = [
    "500MN Y-T8 Compact Microwarpdrive",
    "Zeugma Integrated Analyzer",
    "Scan Rangefinding Array II",
    "Moreau’s Modified Expanded Scan Probe Launcher",
  ];
  for (const moduleName of expectedModuleNames) {
    assert.ok(fittedNames.includes(moduleName), `expected ${moduleName} to be fitted`);
  }
  assert.equal(
    fittedNames.filter((name) => name === "Scan Rangefinding Array II").length,
    4,
    "expected four Scan Rangefinding Array II modules",
  );

  const cargo = listContainerItems(
    characterID,
    shipItemID,
    ITEM_FLAGS.CARGO_HOLD,
  );
  const probeStack = cargo.find(
    (item) => String(item && item.itemName || "") === "Satori-Horigu Combat Scanner Probe",
  );
  assert.ok(probeStack, "expected Satori-Horigu Combat Scanner Probe in /probe cargo");
  assert.equal(
    Number(probeStack.stacksize || probeStack.quantity || 0),
    200,
    "expected /probe to seed a large combat probe stack",
  );

  const probeLauncher = fitted.find(
    (item) => Number(item && item.groupID) === 481,
  );
  assert.ok(probeLauncher, "expected /probe to fit a scan probe launcher");
  assertModuleHasFullLoadedCharge(
    characterID,
    shipItemID,
    probeLauncher,
    "Satori-Horigu Combat Scanner Probe",
  );
}

function assertProbe2Loadout(characterID, shipItemID) {
  const fitted = listFittedItems(characterID, shipItemID);
  const fittedNames = fitted.map((item) => String(item && item.itemName || ""));
  const expectedModuleCounts = new Map([
    ["Damage Control II", 1],
    ["Multispectrum Energized Membrane II", 2],
    ["Co-Processor II", 2],
    ["Relic Analyzer II", 1],
    ["Data Analyzer II", 1],
    ["10MN Y-S8 Compact Afterburner", 1],
    ["Cargo Scanner II", 1],
    ["Scan Rangefinding Array II", 1],
    ["250mm 'Scout' Accelerator Cannon", 3],
    ["Sisters Expanded Probe Launcher", 1],
    ["Covert Ops Cloaking Device II", 1],
  ]);
  for (const [moduleName, expectedCount] of expectedModuleCounts.entries()) {
    assert.equal(
      fittedNames.filter((name) => name === moduleName).length,
      expectedCount,
      `expected ${expectedCount}x ${moduleName} to be fitted`,
    );
  }

  const cargo = listContainerItems(
    characterID,
    shipItemID,
    ITEM_FLAGS.CARGO_HOLD,
  );
  const expectedCargoCounts = new Map([
    ["Sisters Core Scanner Probe", 72],
    ["Federation Navy Uranium Charge M", 845],
    ["Sisters Combat Scanner Probe", 16],
    ["Small Tractor Beam I", 2],
  ]);
  for (const [itemName, expectedQuantity] of expectedCargoCounts.entries()) {
    const itemStack = cargo.find(
      (item) => String(item && item.itemName || "") === itemName,
    );
    assert.ok(itemStack, `expected ${itemName} in /probe2 cargo`);
    assert.equal(
      Number(itemStack.stacksize || itemStack.quantity || 0),
      expectedQuantity,
      `expected /probe2 to seed ${expectedQuantity}x ${itemName}`,
    );
  }

  const droneBay = listContainerItems(
    characterID,
    shipItemID,
    ITEM_FLAGS.DRONE_BAY,
  );
  const expectedDroneCounts = new Map([
    ["Hobgoblin II", 5],
    ["Hammerhead II", 5],
  ]);
  for (const [droneName, expectedQuantity] of expectedDroneCounts.entries()) {
    const droneStack = droneBay.find(
      (item) => String(item && item.itemName || "") === droneName,
    );
    assert.ok(droneStack, `expected ${droneName} in /probe2 drone bay`);
    assert.equal(
      Number(droneStack.stacksize || droneStack.quantity || 0),
      expectedQuantity,
      `expected /probe2 to seed ${expectedQuantity}x ${droneName} in the drone bay`,
    );
  }

  const probeLauncher = fitted.find(
    (item) => String(item && item.itemName || "") === "Sisters Expanded Probe Launcher",
  );
  assert.ok(probeLauncher, "expected /probe2 to fit a Sisters Expanded Probe Launcher");
  assertModuleHasFullLoadedCharge(
    characterID,
    shipItemID,
    probeLauncher,
    "Sisters Core Scanner Probe",
  );
}

function buildSession(characterID, shipItem, position) {
  const character = getCharacterRecord(characterID);
  const notifications = [];
  return {
    clientID: Number(characterID) + 880000,
    characterID,
    charID: characterID,
    characterName: character && character.characterName,
    corporationID: character && character.corporationID || 0,
    allianceID: character && character.allianceID || 0,
    warFactionID: character && character.warFactionID || 0,
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
    shipName: shipItem.itemName || shipItem.shipName || `ship-${shipItem.itemID}`,
    socket: { destroyed: false },
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange(changes, options = {}) {
      notifications.push({ name: "SessionChange", changes, options });
    },
    shipItem: {
      ...shipItem,
      spaceState: {
        systemID: TEST_SYSTEM_ID,
        position,
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        targetPoint: position,
        mode: "STOP",
        speedFraction: 0,
      },
    },
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
        name: payload[0],
        args: Array.isArray(payload[1]) ? payload[1] : [],
      });
    }
  }
  return updates;
}

function extractAddBallsEntityIDs(entry) {
  if (!entry || entry.name !== "AddBalls2" || !Array.isArray(entry.args)) {
    return [];
  }

  const addBallsState = Array.isArray(entry.args[0]) ? entry.args[0] : null;
  const ballList =
    addBallsState &&
    typeof addBallsState[1] === "object" &&
    Array.isArray(addBallsState[1].items)
      ? addBallsState[1].items
      : [];

  const extractDictValue = (dictLike, key) => {
    if (
      !dictLike ||
      dictLike.type !== "dict" ||
      !Array.isArray(dictLike.entries)
    ) {
      return undefined;
    }
    const dictEntry = dictLike.entries.find(
      (pair) => Array.isArray(pair) && pair[0] === key,
    );
    return dictEntry ? dictEntry[1] : undefined;
  };
  const extractNumericValue = (value) => {
    if (value && typeof value === "object" && "value" in value) {
      return Number(value.value);
    }
    return Number(value);
  };

  return ballList
    .map((ballEntry) => (Array.isArray(ballEntry) ? ballEntry[0] : ballEntry))
    .map((slimItem) => extractNumericValue(extractDictValue(slimItem, "itemID")))
    .filter((itemID) => Number.isInteger(itemID) && itemID > 0);
}


function registerAttachedSession(session) {
  registeredSessions.push(session);
  sessionRegistry.register(session);
  const attachResult = spaceRuntime.attachSession(session, session.shipItem, {
    systemID: TEST_SYSTEM_ID,
    broadcast: false,
    spawnStopped: true,
  });
  assert.ok(attachResult, "expected session attach to succeed");
  assert.equal(
    spaceRuntime.ensureInitialBallpark(session),
    true,
    "expected initial ballpark bootstrap to succeed",
  );
  session.notifications.length = 0;
  return session;
}

function prepareLiveSpaceSession(characterID, position) {
  const activeShip = getActiveShipRecord(characterID);
  assert.ok(activeShip, `expected active ship for character ${characterID}`);
  const moveResult = moveShipToSpace(activeShip.itemID, TEST_SYSTEM_ID, {
    systemID: TEST_SYSTEM_ID,
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    targetPoint: position,
    mode: "STOP",
    speedFraction: 0,
  });
  assert.equal(moveResult.success, true, "expected active ship to move to test system");
  const activeResult = setActiveShipForCharacter(characterID, activeShip.itemID);
  assert.equal(activeResult.success, true, "expected active ship selection to succeed");
  return registerAttachedSession(
    buildSession(
      characterID,
      moveResult.data,
      position,
    ),
  );
}

test.afterEach(() => {
  for (const session of registeredSessions.splice(0)) {
    sessionRegistry.unregister(session);
  }
  spaceRuntime._testing.clearScenes();
});

test("/orca spawns, fits, and boards a mining support Orca in station", () => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const candidate = getDockedCandidate();
  const session = buildDockedSession(candidate.characterID, candidate.stationID);
  const commandResult = executeChatCommand(session, "/orca", null, {
    emitChatFeedback: false,
  });

  try {
    assert.equal(commandResult.handled, true);
    assert.match(commandResult.message, /Spawned Orca/i);
    assert.match(commandResult.message, /Large Asteroid Ore Compressor I/i);
    assert.equal(/\bforced\b/i.test(commandResult.message), false, "expected /orca station fit to avoid forced modules");

    const activeShip = getActiveShipRecord(candidate.characterID);
    assert.ok(activeShip, "expected active ship after /orca");
    assert.equal(Number(activeShip.typeID), 28606, "expected /orca to board an Orca");
    assertOrcaLoadout(candidate.characterID, activeShip.itemID);
  } finally {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  }
});

test("/probe spawns, fits, and boards a probing Nestor in station", () => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const candidate = getDockedCandidate();
  const session = buildDockedSession(candidate.characterID, candidate.stationID);
  const commandResult = executeChatCommand(session, "/probe", null, {
    emitChatFeedback: false,
  });

  try {
    assert.equal(commandResult.handled, true);
    assert.match(commandResult.message, /Spawned Nestor/i);
    assert.match(commandResult.message, /Zeugma Integrated Analyzer/i);
    assert.match(commandResult.message, /Moreau/i);

    const activeShip = getActiveShipRecord(candidate.characterID);
    assert.ok(activeShip, "expected active ship after /probe");
    assert.equal(
      Number(activeShip.typeID),
      Number(resolveItemByName("Nestor").match.typeID),
      "expected /probe to board a Nestor",
    );
    assertProbeLoadout(candidate.characterID, activeShip.itemID);
  } finally {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  }
});

test("/probe2 spawns, fits, and boards a probing Stratios in station", () => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const candidate = getDockedCandidate();
  const session = buildDockedSession(candidate.characterID, candidate.stationID);
  const commandResult = executeChatCommand(session, "/probe2", null, {
    emitChatFeedback: false,
  });

  try {
    assert.equal(commandResult.handled, true);
    assert.match(commandResult.message, /Spawned Stratios/i);
    assert.match(commandResult.message, /Sisters Expanded Probe Launcher/i);
    assert.match(commandResult.message, /Covert Ops Cloaking Device II/i);

    const activeShip = getActiveShipRecord(candidate.characterID);
    assert.ok(activeShip, "expected active ship after /probe2");
    assert.equal(
      Number(activeShip.typeID),
      Number(resolveItemByName("Stratios").match.typeID),
      "expected /probe2 to board a Stratios",
    );
    assertProbe2Loadout(candidate.characterID, activeShip.itemID);
  } finally {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  }
});

test("/guardian spawns, fits, and boards a logistics Guardian in station", () => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const candidate = getDockedCandidate();
  const session = buildDockedSession(candidate.characterID, candidate.stationID);
  const commandResult = executeChatCommand(session, "/guardian", null, {
    emitChatFeedback: false,
  });

  try {
    assert.equal(commandResult.handled, true);
    assert.match(commandResult.message, /Spawned Guardian/i);

    const activeShip = getActiveShipRecord(candidate.characterID);
    assert.ok(activeShip, "expected active ship after /guardian");
    assert.equal(Number(activeShip.typeID), 11987, "expected /guardian to board a Guardian");

    const fitted = listFittedItems(candidate.characterID, activeShip.itemID);
    const fittedNames = fitted.map((item) => String(item && item.itemName || ""));
    assert.equal(
      fittedNames.filter((name) => name === "Medium Remote Armor Repairer II").length,
      4,
      "expected four armor reps",
    );
    assert.equal(
      fittedNames.filter((name) => name === "Medium Remote Shield Booster II").length,
      0,
      "expected no shield reps on Guardian",
    );
    assert.equal(
      fittedNames.filter((name) => name === "Medium Remote Capacitor Transmitter II").length,
      2,
      "expected two cap reps",
    );
  } finally {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  }
});

test("/basilisk spawns, fits, and boards a logistics Basilisk in station", () => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const candidate = getDockedCandidate();
  const session = buildDockedSession(candidate.characterID, candidate.stationID);
  const commandResult = executeChatCommand(session, "/basilisk", null, {
    emitChatFeedback: false,
  });

  try {
    assert.equal(commandResult.handled, true);
    assert.match(commandResult.message, /Spawned Basilisk/i);

    const activeShip = getActiveShipRecord(candidate.characterID);
    assert.ok(activeShip, "expected active ship after /basilisk");
    assert.equal(Number(activeShip.typeID), 11985, "expected /basilisk to board a Basilisk");

    const fitted = listFittedItems(candidate.characterID, activeShip.itemID);
    const fittedNames = fitted.map((item) => String(item && item.itemName || ""));
    assert.equal(
      fittedNames.filter((name) => name === "Medium Remote Shield Booster II").length,
      4,
      "expected four shield reps",
    );
    assert.equal(
      fittedNames.filter((name) => name === "Medium Remote Armor Repairer II").length,
      0,
      "expected no armor reps on Basilisk",
    );
    assert.equal(
      fittedNames.filter((name) => name === "Medium Remote Capacitor Transmitter II").length,
      2,
      "expected two cap reps",
    );
  } finally {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  }
});

test("/ewar spawns, fits, and boards a hostile utility Gnosis in station", () => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const candidate = getDockedCandidate();
  const session = buildDockedSession(candidate.characterID, candidate.stationID);
  const commandResult = executeChatCommand(session, "/ewar", null, {
    emitChatFeedback: false,
  });

  try {
    assert.equal(commandResult.handled, true);
    assert.match(commandResult.message, /Spawned Gnosis/i);
    assert.match(commandResult.message, /Gotan's Modified Stasis Webifier/i);
    assert.match(commandResult.message, /Draclira's Modified Heavy Energy Neutralizer/i);

    const activeShip = getActiveShipRecord(candidate.characterID);
    assert.ok(activeShip, "expected active ship after /ewar");
    assert.equal(
      Number(activeShip.typeID),
      Number(resolveItemByName("Gnosis").match.typeID),
      "expected /ewar to board a Gnosis",
    );

    assertEwarLoadout(candidate.characterID, activeShip.itemID);
  } finally {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  }
});

test("/cburst spawns, fits, and boards a Claymore with all five T2 burst families in station", () => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const candidate = getDockedCandidate();
  const session = buildDockedSession(candidate.characterID, candidate.stationID);
  const commandResult = executeChatCommand(session, "/cburst", null, {
    emitChatFeedback: false,
  });

  try {
    assert.equal(commandResult.handled, true);
    assert.match(commandResult.message, /Spawned Claymore/i);
    assert.match(commandResult.message, /Armor Command Burst II/i);
    assert.match(commandResult.message, /Skirmish Command Burst II/i);

    const activeShip = getActiveShipRecord(candidate.characterID);
    assert.ok(activeShip, "expected active ship after /cburst");
    assert.equal(Number(activeShip.typeID), 22468, "expected /cburst to board a Claymore");

    assertCburstLoadout(candidate.characterID, activeShip.itemID);
  } finally {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  }
});

test("/miner boards a Hulk with a fitted micro jump drive", () => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const candidate = getDockedCandidate();
  const session = buildDockedSession(candidate.characterID, candidate.stationID);
  const commandResult = executeChatCommand(session, "/miner", null, {
    emitChatFeedback: false,
  });

  try {
    assert.equal(commandResult.handled, true);
    assert.match(commandResult.message, /Medium Micro Jump Drive/i);

    const activeShip = getActiveShipRecord(candidate.characterID);
    assert.ok(activeShip, "expected active ship after /miner");
    assert.equal(Number(activeShip.typeID), 22544, "expected /miner to board a Hulk");

    const fitted = listFittedItems(candidate.characterID, activeShip.itemID);
    const fittedNames = fitted.map((item) => String(item && item.itemName || ""));
    assert.ok(
      fittedNames.includes("Medium Micro Jump Drive"),
      "expected /miner to fit a medium MJD",
    );
  } finally {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  }
});

test("/orca destroys the current ship and boards the prepared Orca in space", () => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const candidate = getDockedCandidate();
  const pilotSession = prepareLiveSpaceSession(
    candidate.characterID,
    { x: 0, y: 0, z: 0 },
  );
  const originalShipID = Number(pilotSession._space.shipID) || 0;
  const commandResult = executeChatCommand(
    pilotSession,
    "/orca",
    null,
    { emitChatFeedback: false },
  );

  try {
    assert.equal(commandResult.handled, true);
    assert.match(commandResult.message, /Destroyed ship/i);
    assert.match(commandResult.message, /Orca/i);

    const activeShip = getActiveShipRecord(candidate.characterID);
    assert.ok(activeShip, "expected active ship after in-space /orca");
    assert.equal(Number(activeShip.typeID), 28606, "expected the replacement hull to be an Orca");
    assert.notEqual(
      Number(activeShip.itemID),
      originalShipID,
      "expected /orca to board a new hull",
    );
    assert.equal(
      Number(pilotSession._space.shipID),
      Number(activeShip.itemID),
      "expected the space session to board the new Orca",
    );
    assert.equal(
      findCharacterShipByType(candidate.characterID, 670),
      null,
      "expected the transitional capsule to be consumed after boarding the in-space Orca",
    );

    const fitted = listFittedItems(candidate.characterID, activeShip.itemID);
    const fittedNames = fitted.map((item) => String(item && item.itemName || ""));
    assert.ok(fittedNames.includes("Large Asteroid Ore Compressor I"));
    assert.ok(fittedNames.includes("Mining Foreman Burst II"));
    assert.ok(fittedNames.includes("Drone Link Augmentor II"));
    assert.ok(fittedNames.includes("Large Shield Extender II"));
    assert.equal(/\bforced\b/i.test(commandResult.message), false, "expected /orca space fit to avoid forced modules");
    assertOrcaLoadout(candidate.characterID, activeShip.itemID);
  } finally {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  }
});


test("/probe destroys the current ship and boards the prepared Nestor in space", () => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const candidate = getDockedCandidate();
  const pilotSession = prepareLiveSpaceSession(
    candidate.characterID,
    { x: 0, y: 0, z: 0 },
  );
  const originalShipID = Number(pilotSession._space.shipID) || 0;
  const commandResult = executeChatCommand(
    pilotSession,
    "/probe",
    null,
    { emitChatFeedback: false },
  );

  try {
    assert.equal(commandResult.handled, true);
    assert.match(commandResult.message, /Destroyed ship/i);
    assert.match(commandResult.message, /Nestor/i);

    const activeShip = getActiveShipRecord(candidate.characterID);
    assert.ok(activeShip, "expected active ship after in-space /probe");
    assert.equal(
      Number(activeShip.typeID),
      Number(resolveItemByName("Nestor").match.typeID),
      "expected the replacement hull to be a Nestor",
    );
    assert.notEqual(
      Number(activeShip.itemID),
      originalShipID,
      "expected /probe to board a new hull",
    );
    assert.equal(
      Number(pilotSession._space.shipID),
      Number(activeShip.itemID),
      "expected the space session to board the new Nestor",
    );
    assert.equal(
      findCharacterShipByType(candidate.characterID, 670),
      null,
      "expected /probe to skip creating a transitional capsule during the in-space swap",
    );
    assertProbeLoadout(candidate.characterID, activeShip.itemID);
  } finally {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  }
});

test("/orca in space pre-acquires the replacement hull before the shipid swap", () => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const candidate = getDockedCandidate();
  const pilotSession = prepareLiveSpaceSession(
    candidate.characterID,
    { x: 0, y: 0, z: 0 },
  );

  try {
    const commandResult = executeChatCommand(
      pilotSession,
      "/orca",
      null,
      { emitChatFeedback: false },
    );
    assert.equal(commandResult.handled, true);

    const activeShip = getActiveShipRecord(candidate.characterID);
    assert.ok(activeShip, "expected active ship after /orca");

    const destinyUpdates = flattenDestinyUpdates(pilotSession.notifications);
    const addBallsIndex = destinyUpdates.findIndex((entry) => (
      entry &&
      entry.name === "AddBalls2" &&
      extractAddBallsEntityIDs(entry).includes(Number(activeShip.itemID))
    ));

    assert.notEqual(
      addBallsIndex,
      -1,
      "expected /orca to materialize the replacement hull in Michelle before boarding it",
    );

    const notificationAddBallsIndex = pilotSession.notifications.findIndex((notification) => (
      notification &&
      notification.name === "DoDestinyUpdate" &&
      flattenDestinyUpdates([notification]).some((entry) => (
        entry &&
        entry.name === "AddBalls2" &&
        extractAddBallsEntityIDs(entry).includes(Number(activeShip.itemID))
      ))
    ));
    const firstOldShipRemovalIndex = pilotSession.notifications.findIndex((notification) => (
      notification &&
      notification.name === "DoDestinyUpdate" &&
      flattenDestinyUpdates([notification]).some((entry) => (
        entry &&
        entry.name === "RemoveBalls" &&
        Array.isArray(entry.args) &&
        Array.isArray(entry.args[0] && entry.args[0].items) &&
        entry.args[0].items.some((value) => Number(value) === Number(activeShip.itemID))
      ))
    ));
    assert.ok(
      notificationAddBallsIndex !== -1,
      "expected /orca to emit a DoDestinyUpdate AddBalls2 for the replacement hull",
    );
    if (firstOldShipRemovalIndex !== -1) {
      assert.ok(
        notificationAddBallsIndex < firstOldShipRemovalIndex,
        "expected the replacement hull to materialize before any removal on the same swap lane",
      );
    }
  } finally {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  }
});

test("/probe2 destroys the current ship and boards the prepared Stratios in space", () => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const candidate = getDockedCandidate();
  const pilotSession = prepareLiveSpaceSession(
    candidate.characterID,
    { x: 0, y: 0, z: 0 },
  );
  const originalShipID = Number(pilotSession._space.shipID) || 0;
  const commandResult = executeChatCommand(
    pilotSession,
    "/probe2",
    null,
    { emitChatFeedback: false },
  );

  try {
    assert.equal(commandResult.handled, true);
    assert.match(commandResult.message, /Destroyed ship/i);
    assert.match(commandResult.message, /Stratios/i);

    const activeShip = getActiveShipRecord(candidate.characterID);
    assert.ok(activeShip, "expected active ship after in-space /probe2");
    assert.equal(
      Number(activeShip.typeID),
      Number(resolveItemByName("Stratios").match.typeID),
      "expected the replacement hull to be a Stratios",
    );
    assert.notEqual(
      Number(activeShip.itemID),
      originalShipID,
      "expected /probe2 to board a new hull",
    );
    assert.equal(
      Number(pilotSession._space.shipID),
      Number(activeShip.itemID),
      "expected the space session to board the new Stratios",
    );
    assert.equal(
      findCharacterShipByType(candidate.characterID, 670),
      null,
      "expected /probe2 to skip creating a transitional capsule during the in-space swap",
    );
    assertProbe2Loadout(candidate.characterID, activeShip.itemID);
  } finally {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  }
});

test("/cburst destroys the current ship and boards the prepared Claymore in space", () => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const candidate = getDockedCandidate();
  const pilotSession = prepareLiveSpaceSession(
    candidate.characterID,
    { x: 0, y: 0, z: 0 },
  );
  const originalShipID = Number(pilotSession._space.shipID) || 0;
  const commandResult = executeChatCommand(
    pilotSession,
    "/cburst",
    null,
    { emitChatFeedback: false },
  );

  try {
    assert.equal(commandResult.handled, true);
    assert.match(commandResult.message, /Destroyed ship/i);
    assert.match(commandResult.message, /Claymore/i);

    const activeShip = getActiveShipRecord(candidate.characterID);
    assert.ok(activeShip, "expected active ship after in-space /cburst");
    assert.equal(Number(activeShip.typeID), 22468, "expected the replacement hull to be a Claymore");
    assert.notEqual(
      Number(activeShip.itemID),
      originalShipID,
      "expected /cburst to board a new hull",
    );
    assert.equal(
      Number(pilotSession._space.shipID),
      Number(activeShip.itemID),
      "expected the space session to board the new Claymore",
    );

    assertCburstLoadout(candidate.characterID, activeShip.itemID);
  } finally {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  }
});

test("/ewar destroys the current ship and boards the prepared Gnosis in space", () => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const candidate = getDockedCandidate();
  const pilotSession = prepareLiveSpaceSession(
    candidate.characterID,
    { x: 0, y: 0, z: 0 },
  );
  const originalShipID = Number(pilotSession._space.shipID) || 0;
  const commandResult = executeChatCommand(
    pilotSession,
    "/ewar",
    null,
    { emitChatFeedback: false },
  );

  try {
    assert.equal(commandResult.handled, true);
    assert.match(commandResult.message, /Destroyed ship/i);
    assert.match(commandResult.message, /Gnosis/i);

    const activeShip = getActiveShipRecord(candidate.characterID);
    assert.ok(activeShip, "expected active ship after in-space /ewar");
    assert.equal(
      Number(activeShip.typeID),
      Number(resolveItemByName("Gnosis").match.typeID),
      "expected the replacement hull to be a Gnosis",
    );
    assert.notEqual(
      Number(activeShip.itemID),
      originalShipID,
      "expected /ewar to board a new hull",
    );
    assert.equal(
      Number(pilotSession._space.shipID),
      Number(activeShip.itemID),
      "expected the space session to board the new Gnosis",
    );

    assertEwarLoadout(candidate.characterID, activeShip.itemID);
  } finally {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  }
});

test("/orca burst activation in space consumes one preloaded charge and stays active", () => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const candidate = getDockedCandidate();
  const session = buildDockedSession(candidate.characterID, candidate.stationID);
  executeChatCommand(session, "/orca", null, {
    emitChatFeedback: false,
  });

  const pilotSession = prepareLiveSpaceSession(
    candidate.characterID,
    { x: 0, y: 0, z: 0 },
  );

  try {
    const activeShip = getActiveShipRecord(candidate.characterID);
    assert.ok(activeShip, "expected active ship after /orca");

    const burstModule = listFittedItems(candidate.characterID, activeShip.itemID)
      .find((item) => String(item && item.itemName || "") === "Mining Foreman Burst II");
    assert.ok(burstModule, "expected fitted mining burst module");

    const beforeCharge = getLoadedChargeByFlag(
      candidate.characterID,
      activeShip.itemID,
      Number(burstModule.flagID) || 0,
    );
    const fullClipSize = Number(getModuleChargeCapacity(
      Number(burstModule && burstModule.typeID) || 0,
      Number(beforeCharge && beforeCharge.typeID) || 0,
    )) || 0;
    assert.equal(Number(beforeCharge && beforeCharge.stacksize), fullClipSize);

    const activationResult = spaceRuntime.activateGenericModule(
      pilotSession,
      burstModule,
      "moduleBonusWarfareLinkMining",
      {},
    );
    assert.equal(activationResult.success, true, "expected first burst activation to succeed");

    const afterCharge = getLoadedChargeByFlag(
      candidate.characterID,
      activeShip.itemID,
      Number(burstModule.flagID) || 0,
    );
    assert.equal(
      Number(afterCharge && afterCharge.stacksize),
      fullClipSize - 1,
      "expected first burst activation to consume one loaded charge without forcing reload",
    );

    const scene = spaceRuntime.getSceneForSession(pilotSession);
    const shipEntity = scene && scene.getEntityByID(activeShip.itemID);
    assert.ok(shipEntity, "expected ship entity in scene");
    assert.ok(
      shipEntity.activeModuleEffects instanceof Map &&
      shipEntity.activeModuleEffects.has(Number(burstModule.itemID)),
      "expected burst module to remain active after the first pulse",
    );
  } finally {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  }
});
