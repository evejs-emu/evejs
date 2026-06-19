const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const ConfigService = require(path.join(
  repoRoot,
  "server/src/services/config/configService",
));
const DevIndexManagerService = require(path.join(
  repoRoot,
  "server/src/services/map/devIndexManagerService",
));
const {
  executeChatCommand,
} = require(path.join(repoRoot, "server/src/services/chat/chatCommands"));
const BeyonceService = require(path.join(
  repoRoot,
  "server/src/services/ship/beyonceService",
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
const sovAutoState = require(path.join(
  repoRoot,
  "server/src/services/sovereignty/sovAutoState",
));
const {
  getHubIDForSolarSystem,
  getHubFuel,
  getHubUpgrades,
} = require(path.join(
  repoRoot,
  "server/src/services/sovereignty/sovModernState",
));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureConstants",
));
const {
  TYPE_TERRITORIAL_CLAIM_UNIT,
  getAllianceCapitalInfo,
  getAlliancePrimeInfo,
  getSystemState,
  listSovStructuresForSystem,
  resetSovereigntyStateForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/sovereignty/sovState",
));
const {
  MAX_OPERATIONAL_INDEX_POINTS,
  MAX_STRATEGIC_CLAIM_DAYS,
  SHOWCASE_SOV_FLEX_REQUIRED_UPGRADE_TYPE_IDS,
  TYPE_ADVANCED_LOGISTICS_NETWORK_UPGRADE,
  TYPE_ANSIBLEX_JUMP_BRIDGE,
  TYPE_CYNO_NAVIGATION_UPGRADE,
  TYPE_CYNO_SUPPRESSION_UPGRADE,
  TYPE_PHAROLUX_CYNO_BEACON,
  TYPE_TENEBREX_CYNO_JAMMER,
  canSolarSystemSupportUpgrade,
} = require(path.join(
  repoRoot,
  "server/src/services/sovereignty/sovUpgradeSupport",
));
const {
  isSovereigntyAuxiliaryStructure,
} = require(path.join(
  repoRoot,
  "server/src/services/sovereignty/sovSpaceInterop",
));
const {
  isSovereigntyClaimableSolarSystem,
} = require(path.join(
  repoRoot,
  "server/src/services/sovereignty/sovSystemRules",
));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const worldData = require(path.join(repoRoot, "server/src/space/worldData"));

const SOLAR_SYSTEM_ID = 30000142;
const OTHER_SOLAR_SYSTEM_ID = 30000144;
const DEFENDER_ALLIANCE_ID = 99000101;
const DEFENDER_CORPORATION_ID = 98000101;
const ATTACKER_ALLIANCE_ID = 99000102;
const ATTACKER_CORPORATION_ID = 98000102;
const NON_CLAIMABLE_REGION_IDS = new Set([10000004, 10000017, 10000019, 10000070]);

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `Failed to read ${tableName}`);
  return result.data;
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

function buildSession() {
  return {
    clientID: 882001,
    characterID: 140000401,
    charid: 140000401,
    userid: 140000401,
    corporationID: DEFENDER_CORPORATION_ID,
    corpid: DEFENDER_CORPORATION_ID,
    allianceID: DEFENDER_ALLIANCE_ID,
    allianceid: DEFENDER_ALLIANCE_ID,
    shipTypeID: 606,
    solarsystemid2: SOLAR_SYSTEM_ID,
    solarsystemid: SOLAR_SYSTEM_ID,
  };
}

function buildChatHub() {
  return {
    messages: [],
    sendSystemMessage(targetSession, message, channelID) {
      this.messages.push({ targetSession, message, channelID });
    },
  };
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

function dictEntriesToMap(dictPayload) {
  assert.equal(dictPayload && dictPayload.type, "dict");
  return new Map(dictPayload.entries);
}

function keyValEntriesToMap(keyValPayload) {
  assert.equal(keyValPayload && keyValPayload.name, "util.KeyVal");
  return dictEntriesToMap(keyValPayload.args);
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

function getDockedTransportCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "failed to read characters table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((value) => Number(value) || 0)
    .filter((value) => value > 0)
    .sort((left, right) => left - right);

  for (const characterID of characterIDs) {
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

  assert.fail("expected a docked character with an active ship for sovereignty auto-flow tests");
}

function getOtherSolarSystemID(sourceSystemID, predicate = null) {
  const match = worldData.getSolarSystems().find(
    (solarSystem) => (
      Number(solarSystem && solarSystem.solarSystemID) !== Number(sourceSystemID) &&
      (typeof predicate !== "function" || predicate(solarSystem))
    ),
  );
  assert(match, "expected a different solar system for sovereignty automation travel verification");
  return Number(match.solarSystemID) || 0;
}

function runAllSovJobs(maxSteps = 40) {
  for (let step = 0; step < maxSteps; step += 1) {
    const activeJob = sovAutoState._testing.getJobs()[0];
    if (!activeJob) {
      return;
    }
    sovAutoState._testing.runJobNow(activeJob.jobID);
  }
  const remainingJob = sovAutoState._testing.getJobs()[0];
  assert.equal(
    remainingJob,
    undefined,
    `Expected sovereignty automation to finish within ${maxSteps} manual ticks`,
  );
}

function listAutomationStructuresForSystem(solarSystemID) {
  return structureState.listStructuresForSystem(solarSystemID, {
    includeDestroyed: true,
    refresh: false,
  }).filter((structure) => Boolean(structure && structure.devFlags && structure.devFlags.sovAutomation === true));
}

function listSovereigntyAuxiliaryStructuresForSystem(solarSystemID) {
  return structureState.listStructuresForSystem(solarSystemID, {
    includeDestroyed: true,
    refresh: false,
  }).filter((structure) => isSovereigntyAuxiliaryStructure(structure));
}

function assertMaxedSovereigntyIndices(system, messagePrefix) {
  assert.equal(
    Number(system && system.devIndices && system.devIndices.militaryPoints) || 0,
    MAX_OPERATIONAL_INDEX_POINTS,
    `${messagePrefix}: expected military index points to be capped`,
  );
  assert.equal(
    Number(system && system.devIndices && system.devIndices.industrialPoints) || 0,
    MAX_OPERATIONAL_INDEX_POINTS,
    `${messagePrefix}: expected industrial index points to be capped`,
  );
  assert.equal(
    Number(system && system.devIndices && system.devIndices.claimedForDays) || 0,
    MAX_STRATEGIC_CLAIM_DAYS,
    `${messagePrefix}: expected claimed days to be capped for strategic V`,
  );
}

function assertCynoSuppressionOnline(solarSystemID) {
  const hubID = Number(getHubIDForSolarSystem(solarSystemID)) || 0;
  assert.ok(hubID > 0, "expected a Sov Hub to exist for the solar system");
  const upgradeSnapshot = getHubUpgrades(hubID);
  assert.ok(upgradeSnapshot, "expected to read Sov Hub upgrades");
  const cynoSuppression = Array.isArray(upgradeSnapshot.upgrades)
    ? upgradeSnapshot.upgrades.find(
      (upgrade) => Number(upgrade && upgrade.typeID) === TYPE_CYNO_SUPPRESSION_UPGRADE,
    )
    : null;
  assert.ok(cynoSuppression, "expected Cynosural Suppression to be installed");
  assert.equal(
    Number(cynoSuppression && cynoSuppression.powerState) || 0,
    2,
    "expected Cynosural Suppression to be online",
  );
}

function assertHubFuelSeeded(solarSystemID, requiredUpgradeTypeID, messagePrefix) {
  const hubID = Number(getHubIDForSolarSystem(solarSystemID)) || 0;
  assert.ok(hubID > 0, `${messagePrefix}: expected a Sov Hub to exist`);
  const hubFuel = getHubFuel(hubID);
  assert.ok(hubFuel && Array.isArray(hubFuel.fuels), `${messagePrefix}: expected hub fuel payload`);
  const upgradeSnapshot = getHubUpgrades(hubID);
  const requiredUpgrade = Array.isArray(upgradeSnapshot && upgradeSnapshot.upgrades)
    ? upgradeSnapshot.upgrades.find(
      (upgrade) => Number(upgrade && upgrade.typeID) === Number(requiredUpgradeTypeID),
    )
    : null;
  assert.ok(requiredUpgrade, `${messagePrefix}: expected required Sov Hub upgrade to exist`);
  const fuelTypeID = Number(requiredUpgrade && requiredUpgrade.definition && requiredUpgrade.definition.fuelTypeID) || 0;
  const fuelRow = hubFuel.fuels.find(
    (entry) => Number(entry && entry.fuelTypeID) === fuelTypeID,
  );
  assert.ok(fuelRow, `${messagePrefix}: expected a hub fuel row for type ${fuelTypeID}`);
  assert.equal(
    Number(fuelRow && fuelRow.amount) > 0,
    true,
    `${messagePrefix}: expected hub fuel to be seeded`,
  );
  assert.equal(
    Number(fuelRow && fuelRow.burnedPerHour) > 0,
    true,
    `${messagePrefix}: expected hub fuel burn to be non-zero`,
  );
}

function assertTenebrexOnline(solarSystemID) {
  const jammer = listAutomationStructuresForSystem(solarSystemID).find(
    (structure) => Number(structure && structure.typeID) === TYPE_TENEBREX_CYNO_JAMMER,
  );
  assert.ok(jammer, "expected a sovereignty automation Tenebrex to be present");
  assert.equal(jammer.hasQuantumCore, true, "expected Tenebrex automation to install a quantum core");
  assert.equal(
    Number(jammer && jammer.serviceStates && jammer.serviceStates[String(STRUCTURE_SERVICE_ID.CYNO_JAMMER)]) || 0,
    STRUCTURE_SERVICE_STATE.ONLINE,
    "expected the Tenebrex cyno jammer service to be online",
  );
  assert.equal(
    Number(jammer && jammer.liquidOzoneQty) > 0,
    true,
    "expected the Tenebrex automation to seed liquid ozone",
  );
  assert.equal(
    Number(jammer && jammer.fuelExpiresAt) > Date.now(),
    true,
    "expected the Tenebrex automation to seed a future fuel expiry",
  );
  return jammer;
}

function assertFlexStructureOnline(solarSystemID, typeID, serviceID, messagePrefix) {
  const structure = structureState.listStructuresForSystem(solarSystemID, {
    includeDestroyed: true,
    refresh: false,
  }).find((entry) => Number(entry && entry.typeID) === Number(typeID));
  assert.ok(structure, `${messagePrefix}: expected flex structure ${typeID}`);
  assert.equal(
    Number(structure && structure.serviceStates && structure.serviceStates[String(serviceID)]) || 0,
    STRUCTURE_SERVICE_STATE.ONLINE,
    `${messagePrefix}: expected service ${serviceID} to be online`,
  );
  assert.equal(
    Number(structure && structure.liquidOzoneQty) > 0,
    true,
    `${messagePrefix}: expected liquid ozone to be seeded`,
  );
  assert.equal(
    Number(structure && structure.fuelExpiresAt) > Date.now(),
    true,
    `${messagePrefix}: expected fuel expiry to be in the future`,
  );
  return structure;
}

function assertShowcaseFlexSet(solarSystemID, messagePrefix) {
  const flexStructures = listSovereigntyAuxiliaryStructuresForSystem(solarSystemID);
  const countsByTypeID = new Map();
  for (const structure of flexStructures) {
    const typeID = Number(structure && structure.typeID) || 0;
    countsByTypeID.set(typeID, (countsByTypeID.get(typeID) || 0) + 1);
  }
  assert.equal(
    countsByTypeID.get(TYPE_PHAROLUX_CYNO_BEACON) || 0,
    1,
    `${messagePrefix}: expected exactly one Pharolux`,
  );
  assert.equal(
    countsByTypeID.get(TYPE_ANSIBLEX_JUMP_BRIDGE) || 0,
    1,
    `${messagePrefix}: expected exactly one Ansiblex`,
  );
  assert.equal(
    countsByTypeID.get(TYPE_TENEBREX_CYNO_JAMMER) || 0,
    1,
    `${messagePrefix}: expected exactly one Tenebrex`,
  );
}

function attachSpaceSession(session, systemID = SOLAR_SYSTEM_ID) {
  session.socket = { destroyed: false };
  session.notifications = [];
  session.sendNotification = session.sendNotification || (() => {});
  session.shipItem = {
    itemID: 991000100 + (Number(session.clientID) || 0),
    typeID: 606,
    ownerID: Number(session.characterID || session.charid || session.userid || 0) || 140000401,
    groupID: 25,
    categoryID: 6,
    radius: 50,
    spaceState: {
      position: { x: -110000, y: 0, z: 125000 },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "STOP",
      speedFraction: 0,
    },
  };
  const entity = spaceRuntime.attachSession(session, session.shipItem, {
    systemID,
    broadcast: false,
    spawnStopped: true,
  });
  assert.ok(entity, "expected the sovereignty session to attach to the space runtime");
  assert.equal(
    spaceRuntime.ensureInitialBallpark(session),
    true,
    "expected the sovereignty session to finish ballpark bootstrap",
  );
  session.notifications.length = 0;
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("/sov GM commands cover anchoring, timer control, capture, loss, and cleanup", () => {
  const sovereigntyBackup = readTable("sovereignty");

  try {
    writeTable("sovereignty", {
      ...(sovereigntyBackup || {}),
      alliances: {},
      systems: {},
      hubs: {},
      skyhooks: {},
      mercenaryDens: {},
    });
    resetSovereigntyStateForTests();
    sovAutoState._testing.clearAllJobs();

    const session = buildSession();
    const chatHub = buildChatHub();

    const anchorResult = executeChatCommand(session, "/sov anchor both here", chatHub, {});
    assert.equal(anchorResult.handled, true);
    assert.match(String(anchorResult.message || ""), /Anchored both sovereignty structures/i);

    const statusResult = executeChatCommand(session, "/sov status here", chatHub, {});
    assert.match(String(statusResult.message || ""), /claim=/i);
    assert.match(String(statusResult.message || ""), /structure=tcu/i);
    assert.match(String(statusResult.message || ""), /structure=ihub/i);

    const anchoredSystem = getSystemState(SOLAR_SYSTEM_ID);
    assert.equal(Number(anchoredSystem && anchoredSystem.allianceID) || 0, DEFENDER_ALLIANCE_ID);
    assert.equal(Number(anchoredSystem && anchoredSystem.corporationID) || 0, DEFENDER_CORPORATION_ID);
    assert.equal(listSovStructuresForSystem(SOLAR_SYSTEM_ID).length, 2);

    executeChatCommand(session, "/sov prime 19", chatHub, {});
    const pendingPrimeInfo = getAlliancePrimeInfo(DEFENDER_ALLIANCE_ID);
    assert.equal(pendingPrimeInfo.currentPrimeHour, 0);
    assert.equal(pendingPrimeInfo.newPrimeHour, 19);

    executeChatCommand(session, `/sov capital ${OTHER_SOLAR_SYSTEM_ID}`, chatHub, {});
    const pendingCapitalInfo = getAllianceCapitalInfo(DEFENDER_ALLIANCE_ID);
    assert.equal(pendingCapitalInfo.newCapitalSystem, OTHER_SOLAR_SYSTEM_ID);

    const cancelCapitalResult = executeChatCommand(session, "/sov capital clear", chatHub, {});
    assert.match(String(cancelCapitalResult.message || ""), /Cleared the pending capital transition/i);
    assert.equal(getAllianceCapitalInfo(DEFENDER_ALLIANCE_ID).newCapitalSystem, null);

    executeChatCommand(session, `/sov capital ${SOLAR_SYSTEM_ID}`, chatHub, {});
    executeChatCommand(session, "/sov vuln both 900", chatHub, {});
    const campaignResult = executeChatCommand(session, "/sov campaign ihub 7 300", chatHub, {});
    assert.match(String(campaignResult.message || ""), /Started ihub campaign event 7/i);

    const scoreResult = executeChatCommand(session, "/sov score ihub 1=10 2=90", chatHub, {});
    assert.match(String(scoreResult.message || ""), /Updated ihub campaign scores/i);

    const fastForwardResult = executeChatCommand(session, "/sov ff 604801", chatHub, {});
    assert.match(String(fastForwardResult.message || ""), /Fast-forwarded sovereignty timers/i);

    const appliedPrimeInfo = getAlliancePrimeInfo(DEFENDER_ALLIANCE_ID);
    const appliedCapitalInfo = getAllianceCapitalInfo(DEFENDER_ALLIANCE_ID);
    assert.equal(appliedPrimeInfo.currentPrimeHour, 19);
    assert.equal(appliedCapitalInfo.currentCapitalSystem, SOLAR_SYSTEM_ID);

    const clearCampaignResult = executeChatCommand(session, "/sov campaign ihub clear", chatHub, {});
    assert.match(String(clearCampaignResult.message || ""), /Cleared ihub campaign state/i);

    const clearVulnResult = executeChatCommand(session, "/sov vuln both clear", chatHub, {});
    assert.match(String(clearVulnResult.message || ""), /Cleared both vulnerability windows/i);

    const captureResult = executeChatCommand(
      session,
      `/sov capture ${ATTACKER_ALLIANCE_ID} ${ATTACKER_CORPORATION_ID}`,
      chatHub,
      {},
    );
    assert.match(String(captureResult.message || ""), /Captured solar system/i);
    const capturedSystem = getSystemState(SOLAR_SYSTEM_ID);
    assert.equal(Number(capturedSystem && capturedSystem.allianceID) || 0, ATTACKER_ALLIANCE_ID);
    assert.equal(Number(capturedSystem && capturedSystem.corporationID) || 0, ATTACKER_CORPORATION_ID);

    const loseResult = executeChatCommand(session, "/sov lose", chatHub, {});
    assert.match(String(loseResult.message || ""), /Cleared sovereignty ownership/i);
    const lostSystem = getSystemState(SOLAR_SYSTEM_ID);
    assert.equal(lostSystem && lostSystem.allianceID, null);
    assert.equal(lostSystem && lostSystem.corporationID, null);
    assert.equal(Array.isArray(lostSystem && lostSystem.structures) ? lostSystem.structures.length : 0, 0);

    executeChatCommand(session, "/sov anchor both here", chatHub, {});
    const clearResult = executeChatCommand(session, "/sov clear", chatHub, {});
    assert.match(String(clearResult.message || ""), /Cleared sovereignty state/i);
    const clearedSystem = getSystemState(SOLAR_SYSTEM_ID);
    assert.equal(clearedSystem && clearedSystem.allianceID, null);
    assert.equal(Array.isArray(clearedSystem && clearedSystem.structures) ? clearedSystem.structures.length : 0, 0);
  } finally {
    sovAutoState._testing.clearAllJobs();
    writeTable("sovereignty", sovereigntyBackup);
    resetSovereigntyStateForTests();
  }
});

test("/sov index can set strategic and operational development indices for GM validation", () => {
  const sovereigntyBackup = readTable("sovereignty");

  try {
    writeTable("sovereignty", {
      ...(sovereigntyBackup || {}),
      alliances: {},
      systems: {},
      hubs: {},
      skyhooks: {},
      mercenaryDens: {},
    });
    resetSovereigntyStateForTests();
    sovAutoState._testing.clearAllJobs();

    const session = buildSession();
    const chatHub = buildChatHub();

    executeChatCommand(session, "/sov anchor both here", chatHub, {});

    const strategicResult = executeChatCommand(
      session,
      "/sov index strategic 3",
      chatHub,
      {},
    );
    assert.equal(strategicResult.handled, true);
    assert.match(String(strategicResult.message || ""), /strategic=3/i);

    executeChatCommand(session, "/sov index military 9600000", chatHub, {});
    executeChatCommand(session, "/sov index industrial 19200000", chatHub, {});

    const indexedSystem = getSystemState(SOLAR_SYSTEM_ID);
    assert.equal(
      Number(indexedSystem && indexedSystem.devIndices && indexedSystem.devIndices.claimedForDays) || 0,
      35,
    );
    assert.equal(
      Number(indexedSystem && indexedSystem.devIndices && indexedSystem.devIndices.militaryPoints) || 0,
      9600000,
    );
    assert.equal(
      Number(indexedSystem && indexedSystem.devIndices && indexedSystem.devIndices.industrialPoints) || 0,
      19200000,
    );
  } finally {
    sovAutoState._testing.clearAllJobs();
    writeTable("sovereignty", sovereigntyBackup);
    resetSovereigntyStateForTests();
  }
});

test("/sov anchor creates real scene and config-backed sovereignty structures", () => {
  const sovereigntyBackup = readTable("sovereignty");
  const session = buildSession();
  const chatHub = buildChatHub();
  const configService = new ConfigService();

  try {
    writeTable("sovereignty", {
      ...(sovereigntyBackup || {}),
      alliances: {},
      systems: {},
      hubs: {},
      skyhooks: {},
      mercenaryDens: {},
    });
    resetSovereigntyStateForTests();
    sovAutoState._testing.clearAllJobs();
    attachSpaceSession(session, SOLAR_SYSTEM_ID);

    const anchorResult = executeChatCommand(session, "/sov anchor both here", chatHub, {});
    assert.equal(anchorResult.handled, true);
    assert.match(String(anchorResult.message || ""), /Anchored both sovereignty structures/i);

    const anchoredSystem = getSystemState(SOLAR_SYSTEM_ID);
    const tcu = anchoredSystem.structures.find((structure) => Number(structure && structure.typeID) === 32226);
    const ihub = anchoredSystem.structures.find((structure) => Number(structure && structure.typeID) === 32458);
    assert.ok(tcu, "expected a TCU sovereignty structure in state");
    assert.ok(ihub, "expected an iHub sovereignty structure in state");

    const tcuMirror = structureState.getStructureByID(tcu.itemID, { refresh: false });
    const ihubMirror = structureState.getStructureByID(ihub.itemID, { refresh: false });
    assert.ok(tcuMirror, "expected the TCU to be mirrored into structure state");
    assert.ok(ihubMirror, "expected the iHub to be mirrored into structure state");
    assert.equal(Number(tcuMirror.typeID) || 0, 32226);
    assert.equal(Number(ihubMirror.typeID) || 0, 32458);

    const scene = spaceRuntime.ensureScene(SOLAR_SYSTEM_ID);
    assert.equal(scene.staticEntitiesByID.has(tcu.itemID), true);
    assert.equal(scene.staticEntitiesByID.has(ihub.itemID), true);

    const locationResponse = configService.Handle_GetMultiLocationsEx([[tcu.itemID]], session);
    assert.ok(Array.isArray(locationResponse), "expected a config rowset response");
    const rows = Array.isArray(locationResponse[1]) ? locationResponse[1] : [];
    assert.equal(rows.length, 1, "expected a single location row for the TCU");
    assert.equal(Number(rows[0][0]) || 0, tcu.itemID);
    assert.equal(String(rows[0][1] || "").length > 0, true);
    assert.equal(Number(rows[0][2]) || 0, SOLAR_SYSTEM_ID);
    assert.equal(Number(rows[0][3]) !== 0 || Number(rows[0][4]) !== 0 || Number(rows[0][5]) !== 0, true);
  } finally {
    if (session._space) {
      spaceRuntime.detachSession(session, { broadcast: false });
    }
    sovAutoState._testing.clearAllJobs();
    writeTable("sovereignty", sovereigntyBackup);
    resetSovereigntyStateForTests();
  }
});

test("/sov anchor in another system uses a deadwarp-style empty-space fallback", () => {
  const sovereigntyBackup = readTable("sovereignty");
  const session = buildSession();
  const chatHub = buildChatHub();
  const targetSystemID = OTHER_SOLAR_SYSTEM_ID;

  try {
    writeTable("sovereignty", {
      ...(sovereigntyBackup || {}),
      alliances: {},
      systems: {},
      hubs: {},
      skyhooks: {},
      mercenaryDens: {},
    });
    resetSovereigntyStateForTests();
    sovAutoState._testing.clearAllJobs();

    const anchorResult = executeChatCommand(
      session,
      `/sov anchor both ${targetSystemID}`,
      chatHub,
      {},
    );
    assert.equal(anchorResult.handled, true);
    assert.match(String(anchorResult.message || ""), /Anchored both sovereignty structures/i);

    const anchoredSystem = getSystemState(targetSystemID);
    const tcu = anchoredSystem.structures.find((structure) => Number(structure && structure.typeID) === 32226);
    const ihub = anchoredSystem.structures.find((structure) => Number(structure && structure.typeID) === 32458);
    assert.ok(tcu && tcu.position, "expected a TCU position");
    assert.ok(ihub && ihub.position, "expected an iHub position");

    const tcuDistanceFromOrigin = Math.sqrt(
      (Number(tcu.position.x) ** 2) +
      (Number(tcu.position.y) ** 2) +
      (Number(tcu.position.z) ** 2),
    );
    assert.equal(
      tcuDistanceFromOrigin > 1_000_000,
      true,
      "expected off-system anchoring to use empty-space fallback coordinates, not near-origin placeholders",
    );
  } finally {
    sovAutoState._testing.clearAllJobs();
    writeTable("sovereignty", sovereigntyBackup);
    resetSovereigntyStateForTests();
  }
});

test("/sov deploy all onlines and fuels Pharolux, Ansiblex, and Tenebrex with their hub upgrades", () => {
  const sovereigntyBackup = readTable("sovereignty");
  const session = buildSession();
  const chatHub = buildChatHub();
  const targetSystemID = getOtherSolarSystemID(
    SOLAR_SYSTEM_ID,
    (solarSystem) => {
      const solarSystemID = Number(solarSystem && solarSystem.solarSystemID) || 0;
      return (
        canSolarSystemSupportUpgrade(solarSystemID, TYPE_CYNO_NAVIGATION_UPGRADE) &&
        canSolarSystemSupportUpgrade(solarSystemID, TYPE_ADVANCED_LOGISTICS_NETWORK_UPGRADE) &&
        canSolarSystemSupportUpgrade(solarSystemID, TYPE_CYNO_SUPPRESSION_UPGRADE)
      );
    },
  );

  try {
    writeTable("sovereignty", {
      ...(sovereigntyBackup || {}),
      alliances: {},
      systems: {},
      hubs: {},
      skyhooks: {},
      mercenaryDens: {},
    });
    resetSovereigntyStateForTests();
    sovAutoState._testing.clearAllJobs();

    executeChatCommand(
      session,
      `/sov anchor both ${targetSystemID} ${DEFENDER_ALLIANCE_ID} ${DEFENDER_CORPORATION_ID}`,
      chatHub,
      {},
    );

    const deployResult = executeChatCommand(
      session,
      `/sov deploy all ${targetSystemID} ${DEFENDER_ALLIANCE_ID} ${DEFENDER_CORPORATION_ID}`,
      chatHub,
      {},
    );
    assert.equal(deployResult.handled, true);
    assert.match(String(deployResult.message || ""), /Pharolux Cyno Beacon/i);
    assert.match(String(deployResult.message || ""), /Ansiblex Jump Bridge/i);
    assert.match(String(deployResult.message || ""), /Tenebrex Cyno Jammer/i);
    assert.match(String(deployResult.message || ""), /hubUpgrades=/i);
    assert.match(String(deployResult.message || ""), /hubFuel=/i);
    assert.match(String(deployResult.message || ""), /flex=pharolux/i);
    assert.match(String(deployResult.message || ""), /flex=ansiblex/i);
    assert.match(String(deployResult.message || ""), /flex=tenebrex/i);

    assertHubFuelSeeded(targetSystemID, TYPE_CYNO_NAVIGATION_UPGRADE, "pharolux deploy");
    assertHubFuelSeeded(targetSystemID, TYPE_ADVANCED_LOGISTICS_NETWORK_UPGRADE, "ansiblex deploy");
    assertHubFuelSeeded(targetSystemID, TYPE_CYNO_SUPPRESSION_UPGRADE, "tenebrex deploy");
    assertFlexStructureOnline(
      targetSystemID,
      TYPE_PHAROLUX_CYNO_BEACON,
      STRUCTURE_SERVICE_ID.CYNO_BEACON,
      "pharolux deploy",
    );
    assertFlexStructureOnline(
      targetSystemID,
      TYPE_ANSIBLEX_JUMP_BRIDGE,
      STRUCTURE_SERVICE_ID.JUMP_BRIDGE,
      "ansiblex deploy",
    );
    assertFlexStructureOnline(
      targetSystemID,
      TYPE_TENEBREX_CYNO_JAMMER,
      STRUCTURE_SERVICE_ID.CYNO_JAMMER,
      "tenebrex deploy",
    );
  } finally {
    sovAutoState._testing.clearAllJobs();
    writeTable("sovereignty", sovereigntyBackup);
    resetSovereigntyStateForTests();
  }
});

test("/sovauto can walk a claimed system through takeover and loss flows", () => {
  const sovereigntyBackup = readTable("sovereignty");
  const candidate = getDockedTransportCandidate();
  const session = buildDbBackedSession(candidate.characterID);

  try {
    writeTable("sovereignty", {
      ...(sovereigntyBackup || {}),
      alliances: {},
      systems: {},
      hubs: {},
      skyhooks: {},
      mercenaryDens: {},
    });
    resetSovereigntyStateForTests();
    sovAutoState._testing.clearAllJobs();

    const applyResult = applyCharacterToSession(session, candidate.characterID, {
      emitNotifications: false,
      logSelection: false,
      selectionEvent: false,
    });
    assert.equal(applyResult.success, true, "expected sovereignty auto-flow session to hydrate");

    const sourceSystemID = Number(session.solarsystemid2 || session.solarsystemid || 0);
    const targetSystemID = getOtherSolarSystemID(
      sourceSystemID,
      (solarSystem) => canSolarSystemSupportUpgrade(
        Number(solarSystem && solarSystem.solarSystemID) || 0,
        TYPE_CYNO_SUPPRESSION_UPGRADE,
      ),
    );
    const chatHub = buildChatHub();

    executeChatCommand(
      session,
      `/sov anchor both ${targetSystemID} ${DEFENDER_ALLIANCE_ID} ${DEFENDER_CORPORATION_ID}`,
      chatHub,
      {},
    );

    const takeoverResult = executeChatCommand(
      session,
      `/sovauto takeover ${targetSystemID} ${ATTACKER_ALLIANCE_ID} ${ATTACKER_CORPORATION_ID}`,
      chatHub,
      {},
    );
    assert.equal(takeoverResult.handled, true);
    assert.match(String(takeoverResult.message || ""), /Started sovereignty takeover automation/i);
    assert.match(String(takeoverResult.message || ""), /every 10 seconds/i);

    runAllSovJobs();

    const takenSystem = getSystemState(targetSystemID);
    assert.equal(Number(takenSystem && takenSystem.allianceID) || 0, ATTACKER_ALLIANCE_ID);
    assert.equal(Number(takenSystem && takenSystem.corporationID) || 0, ATTACKER_CORPORATION_ID);
    assertMaxedSovereigntyIndices(takenSystem, "takeover");
    assertCynoSuppressionOnline(targetSystemID);
    assertHubFuelSeeded(targetSystemID, TYPE_CYNO_SUPPRESSION_UPGRADE, "takeover");
    const takeoverJammer = assertTenebrexOnline(targetSystemID);
    assert.equal(
      Number(session._space && session._space.systemID) || 0,
      targetSystemID,
      "Expected takeover automation to jump the session into the target solar system",
    );
    const takeoverStructures = listSovStructuresForSystem(targetSystemID);
    assert.equal(takeoverStructures.length, 2);
    assert.equal(
      takeoverStructures.every((structure) => structure && structure.position),
      true,
      "Expected takeover automation to backfill sovereignty anchor positions",
    );
    const takeoverTcu = takeoverStructures.find(
      (structure) => Number(structure && structure.typeID) === TYPE_TERRITORIAL_CLAIM_UNIT,
    );
    assert.ok(takeoverTcu && takeoverTcu.position, "expected takeover TCU position");
    const takeoverShipPosition = readPosition(readShipEntity(session));
    assert.deepEqual(
      takeoverShipPosition,
      readPosition({ position: takeoverJammer && takeoverJammer.position }),
      "Expected takeover automation to finish on the live Tenebrex cyno jammer grid",
    );
    assert.equal(
      sovAutoState._testing.getJobBySolarSystemID(targetSystemID),
      null,
      "Expected takeover automation to stop after capture",
    );
    assert.equal(
      chatHub.messages.some((entry) => /Landing on the current sovereignty anchor/i.test(String(entry.message || ""))),
      true,
      "Expected takeover automation to stream progress into local chat",
    );
    assert.equal(
      chatHub.messages.some((entry) => /Tenebrex is now .*cyno jammer service online/i.test(String(entry.message || ""))),
      true,
      "Expected takeover automation to announce Tenebrex online in local chat",
    );
    assert.equal(
      chatHub.messages.some((entry) => /Done\./i.test(String(entry.message || ""))),
      true,
      "Expected takeover automation to send a completion message into local chat",
    );

    const lossResult = executeChatCommand(session, `/sovauto loss ${targetSystemID}`, chatHub, {});
    assert.equal(lossResult.handled, true);
    assert.match(String(lossResult.message || ""), /Started sovereignty loss automation/i);

    runAllSovJobs();

    const lostSystem = getSystemState(targetSystemID);
    assert.equal(lostSystem && lostSystem.allianceID, null);
    assert.equal(
      listAutomationStructuresForSystem(targetSystemID).length,
      0,
      "Expected loss automation to remove sovereignty automation auxiliaries",
    );
    assert.equal(
      Number(session._space && session._space.systemID) || 0,
      targetSystemID,
      "Expected loss automation to keep the session in the target solar system while it runs",
    );
    assert.equal(
      sovAutoState._testing.getJobBySolarSystemID(targetSystemID),
      null,
      "Expected loss automation to stop after clearing sovereignty",
    );
  } finally {
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
    sovAutoState._testing.clearAllJobs();
    writeTable("sovereignty", sovereigntyBackup);
    resetSovereigntyStateForTests();
  }
});

test("/sovauto claim can jump to an unclaimed system, anchor sovereignty, and land on the anchor", () => {
  const sovereigntyBackup = readTable("sovereignty");
  const candidate = getDockedTransportCandidate();
  const session = buildDbBackedSession(candidate.characterID);

  try {
    writeTable("sovereignty", {
      ...(sovereigntyBackup || {}),
      alliances: {},
      systems: {},
      hubs: {},
      skyhooks: {},
      mercenaryDens: {},
    });
    resetSovereigntyStateForTests();
    sovAutoState._testing.clearAllJobs();

    const applyResult = applyCharacterToSession(session, candidate.characterID, {
      emitNotifications: false,
      logSelection: false,
      selectionEvent: false,
    });
    assert.equal(applyResult.success, true, "expected sovereignty claim session to hydrate");

    const sourceSystemID = Number(session.solarsystemid2 || session.solarsystemid || 0);
    const chatHub = buildChatHub();
    const claimResult = executeChatCommand(
      session,
      `/sovauto claim unclaimed ${ATTACKER_ALLIANCE_ID} ${ATTACKER_CORPORATION_ID}`,
      chatHub,
      {},
    );
    assert.equal(claimResult.handled, true);
    assert.match(String(claimResult.message || ""), /Started sovereignty claim automation/i);
    assert.match(String(claimResult.message || ""), /Selected unclaimed system/i);

    runAllSovJobs();

    assert.equal(
      sovAutoState._testing.getJobs().length,
      0,
      "Expected claim automation to finish cleanly",
    );
    const claimedSystemID = Number(session._space && session._space.systemID) || 0;
    assert.notEqual(
      claimedSystemID,
      sourceSystemID,
      "Expected unclaimed sovereignty claim automation to move to a different solar system",
    );
    const claimedStaticSystem = worldData.getSolarSystemByID(claimedSystemID);
    assert.equal(
      Number(claimedStaticSystem && claimedStaticSystem.security) <= 0,
      true,
      "Expected claim automation to pick a nullsec system",
    );
    assert.equal(
      NON_CLAIMABLE_REGION_IDS.has(
        Number(claimedStaticSystem && claimedStaticSystem.regionID) || 0,
      ),
      false,
      "Expected claim automation to avoid non-conquerable special-space regions",
    );
    assert.equal(
      Boolean(claimedStaticSystem && claimedStaticSystem.factionID),
      false,
      "Expected claim automation to avoid faction-owned NPC systems",
    );
    assert.equal(
      SHOWCASE_SOV_FLEX_REQUIRED_UPGRADE_TYPE_IDS.every((upgradeTypeID) => (
        canSolarSystemSupportUpgrade(claimedSystemID, upgradeTypeID)
      )),
      true,
      "Expected claim automation to pick a nullsec system that can showcase all Sov flex structures",
    );
    const claimedSystem = getSystemState(claimedSystemID);
    assert.equal(Number(claimedSystem && claimedSystem.allianceID) || 0, ATTACKER_ALLIANCE_ID);
    assert.equal(Number(claimedSystem && claimedSystem.corporationID) || 0, ATTACKER_CORPORATION_ID);
    assertMaxedSovereigntyIndices(claimedSystem, "claim");
    const devIndexManager = new DevIndexManagerService();
    const devIndicesForSystem = devIndexManager.Handle_GetDevelopmentIndicesForSystem(
      [claimedSystemID],
      session,
    );
    const devIndicesByAttributeID = dictEntriesToMap(devIndicesForSystem);
    const militaryIndex = keyValEntriesToMap(devIndicesByAttributeID.get(1583));
    assert.equal(
      Number(militaryIndex.get("points")) || 0,
      MAX_OPERATIONAL_INDEX_POINTS,
      "Expected client development-index payloads to report military V after auto claim",
    );
    const allDevelopmentIndices = devIndexManager.Handle_GetAllDevelopmentIndices([], session);
    const claimedRow = Array.isArray(allDevelopmentIndices && allDevelopmentIndices.items)
      ? allDevelopmentIndices.items.find((row) => (
        Number(keyValEntriesToMap(row).get("solarSystemID")) === claimedSystemID
      ))
      : null;
    assert.ok(claimedRow, "Expected auto-claimed system to appear in GetAllDevelopmentIndices");
    assert.equal(
      Number(keyValEntriesToMap(claimedRow).get("militaryPoints")) || 0,
      MAX_OPERATIONAL_INDEX_POINTS,
      "Expected all-development-indices row to report military V after auto claim",
    );
    assertCynoSuppressionOnline(claimedSystemID);
    assertHubFuelSeeded(claimedSystemID, TYPE_CYNO_NAVIGATION_UPGRADE, "claim pharolux");
    assertHubFuelSeeded(claimedSystemID, TYPE_ADVANCED_LOGISTICS_NETWORK_UPGRADE, "claim ansiblex");
    assertHubFuelSeeded(claimedSystemID, TYPE_CYNO_SUPPRESSION_UPGRADE, "claim");
    assertShowcaseFlexSet(claimedSystemID, "claim showcase");
    assertFlexStructureOnline(
      claimedSystemID,
      TYPE_PHAROLUX_CYNO_BEACON,
      STRUCTURE_SERVICE_ID.CYNO_BEACON,
      "claim pharolux",
    );
    assertFlexStructureOnline(
      claimedSystemID,
      TYPE_ANSIBLEX_JUMP_BRIDGE,
      STRUCTURE_SERVICE_ID.JUMP_BRIDGE,
      "claim ansiblex",
    );

    const structures = listSovStructuresForSystem(claimedSystemID);
    assert.equal(structures.length, 2);
    assert.equal(
      structures.every((structure) => structure && structure.position),
      true,
      "Expected claim automation to anchor both sovereignty structures with positions",
    );
    const tcu = structures.find(
      (structure) => Number(structure && structure.typeID) === TYPE_TERRITORIAL_CLAIM_UNIT,
    );
    assert.ok(tcu && tcu.position, "expected claim TCU position");
    const jammer = assertTenebrexOnline(claimedSystemID);
    const beyonce = new BeyonceService();
    assert.equal(
      beyonce.Handle_GetCynoJammerState([], session),
      0,
      "Expected beyonce.GetCynoJammerState to report an active cyno jammed system",
    );
    assert.deepEqual(
      readPosition(readShipEntity(session)),
      readPosition({ position: jammer && jammer.position }),
      "Expected claim automation to finish on the live Tenebrex cyno jammer grid",
    );
    assert.equal(
      chatHub.messages.some((entry) => /Deploying the Territorial Claim Unit/i.test(String(entry.message || ""))),
      true,
      "Expected claim automation to announce TCU deployment in local chat",
    );
    assert.equal(
      chatHub.messages.some((entry) => /Deploying the Sov Hub/i.test(String(entry.message || ""))),
      true,
      "Expected claim automation to announce Sov Hub deployment in local chat",
    );
    assert.equal(
      chatHub.messages.some((entry) => /Maxing military, industrial, and strategic indices/i.test(String(entry.message || ""))),
      true,
      "Expected claim automation to announce index capping in local chat",
    );
    assert.equal(
      chatHub.messages.some((entry) => /Pharolux Cyno Beacon/i.test(String(entry.message || ""))),
      true,
      "Expected claim automation to announce Pharolux deployment in local chat",
    );
    assert.equal(
      chatHub.messages.some((entry) => /Ansiblex Jump Bridge/i.test(String(entry.message || ""))),
      true,
      "Expected claim automation to announce Ansiblex deployment in local chat",
    );
    assert.equal(
      chatHub.messages.some((entry) => /Done\./i.test(String(entry.message || ""))),
      true,
      "Expected claim automation to send a completion message into local chat",
    );
  } finally {
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
    sovAutoState._testing.clearAllJobs();
    writeTable("sovereignty", sovereigntyBackup);
    resetSovereigntyStateForTests();
  }
});

test("/sovauto claim rejects non-conquerable systems", () => {
  const session = buildSession();
  const highsecResult = executeChatCommand(
    session,
    "/sovauto claim 30000142",
    buildChatHub(),
    {},
  );
  assert.equal(highsecResult.handled, true);
  assert.match(
    String(highsecResult.message || ""),
    /only supports conquerable nullsec systems with no faction owner/i,
  );

  const trigResult = executeChatCommand(
    session,
    "/sovauto claim 30000021",
    buildChatHub(),
    {},
  );
  assert.equal(trigResult.handled, true);
  assert.match(
    String(trigResult.message || ""),
    /only supports conquerable nullsec systems with no faction owner/i,
  );

  const joveResult = executeChatCommand(
    session,
    "/sovauto claim 30000326",
    buildChatHub(),
    {},
  );
  assert.equal(joveResult.handled, true);
  assert.match(
    String(joveResult.message || ""),
    /only supports conquerable nullsec systems with no faction owner/i,
  );
});

test("/sovauto status and stop can inspect and cancel active sovereignty jobs", () => {
  const sovereigntyBackup = readTable("sovereignty");
  const candidate = getDockedTransportCandidate();
  const session = buildDbBackedSession(candidate.characterID);

  try {
    writeTable("sovereignty", {
      ...(sovereigntyBackup || {}),
      alliances: {},
      systems: {},
      hubs: {},
      skyhooks: {},
      mercenaryDens: {},
    });
    resetSovereigntyStateForTests();
    sovAutoState._testing.clearAllJobs();

    const applyResult = applyCharacterToSession(session, candidate.characterID, {
      emitNotifications: false,
      logSelection: false,
      selectionEvent: false,
    });
    assert.equal(applyResult.success, true, "expected sovereignty stop-session to hydrate");
    const sourceSystemID = Number(session.solarsystemid2 || session.solarsystemid || 0);
    const targetSystemID = getOtherSolarSystemID(sourceSystemID);
    const chatHub = buildChatHub();

    executeChatCommand(
      session,
      `/sov anchor both ${targetSystemID} ${DEFENDER_ALLIANCE_ID} ${DEFENDER_CORPORATION_ID}`,
      chatHub,
      {},
    );
    executeChatCommand(
      session,
      `/sovauto takeover ${targetSystemID} ${ATTACKER_ALLIANCE_ID} ${ATTACKER_CORPORATION_ID}`,
      chatHub,
      {},
    );

    const statusResult = executeChatCommand(session, "/sovauto status", chatHub, {});
    assert.match(String(statusResult.message || ""), /mode=takeover/i);
    assert.match(String(statusResult.message || ""), new RegExp(`system=${targetSystemID}`));

    const stopResult = executeChatCommand(session, `/sovauto stop ${targetSystemID}`, chatHub, {});
    assert.match(String(stopResult.message || ""), /Stopped sovereignty automation/i);
    assert.equal(
      sovAutoState._testing.getJobBySolarSystemID(targetSystemID),
      null,
      "Expected /sovauto stop to cancel the active sovereignty job",
    );
  } finally {
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
    sovAutoState._testing.clearAllJobs();
    writeTable("sovereignty", sovereigntyBackup);
    resetSovereigntyStateForTests();
  }
});

test("/sovauto reset clears dynamic sovereignty data, automation structures, and active jobs", () => {
  const sovereigntyBackup = readTable("sovereignty");
  const session = buildSession();
  const chatHub = buildChatHub();

  try {
    writeTable("sovereignty", {
      ...(sovereigntyBackup || {}),
      alliances: {},
      systems: {},
      hubs: {},
      skyhooks: {},
      mercenaryDens: {},
    });
    resetSovereigntyStateForTests();
    sovAutoState._testing.clearAllJobs();
    attachSpaceSession(session);
    const targetSystemID = getOtherSolarSystemID(
      SOLAR_SYSTEM_ID,
      (solarSystem) => (
        isSovereigntyClaimableSolarSystem(solarSystem) &&
        SHOWCASE_SOV_FLEX_REQUIRED_UPGRADE_TYPE_IDS.every((upgradeTypeID) => (
          canSolarSystemSupportUpgrade(
            Number(solarSystem && solarSystem.solarSystemID) || 0,
            upgradeTypeID,
          )
        ))
      ),
    );

    executeChatCommand(
      session,
      `/sov anchor both ${targetSystemID}`,
      chatHub,
      {},
    );
    executeChatCommand(
      session,
      `/sov deploy all ${targetSystemID}`,
      chatHub,
      {},
    );
    executeChatCommand(
      session,
      "/sov anchor both here",
      chatHub,
      {},
    );
    const startResult = executeChatCommand(
      session,
      `/sovauto takeover here ${ATTACKER_ALLIANCE_ID} ${ATTACKER_CORPORATION_ID}`,
      chatHub,
      {},
    );
    assert.equal(startResult.handled, true);
    assert.equal(
      sovAutoState._testing.getJobs().length > 0,
      true,
      "expected sovereignty automation job to exist before reset",
    );

    const resetResult = executeChatCommand(session, "/sovauto reset", chatHub, {});
    assert.equal(resetResult.handled, true);
    assert.match(String(resetResult.message || ""), /Cleared all dynamic sovereignty runtime state/i);

    const cleanedTable = readTable("sovereignty");
    assert.deepEqual(cleanedTable.systems || {}, {});
    assert.deepEqual(cleanedTable.hubs || {}, {});
    assert.deepEqual(cleanedTable.skyhooks || {}, {});
    assert.deepEqual(cleanedTable.mercenaryDens || {}, {});
    assert.equal(sovAutoState._testing.getJobs().length, 0, "expected reset to stop active jobs");
    assert.equal(
      listSovStructuresForSystem(targetSystemID).length,
      0,
      "expected reset to remove sovereignty mirror structures",
    );
    assert.equal(
      listSovereigntyAuxiliaryStructuresForSystem(targetSystemID).length,
      0,
      "expected reset to remove sovereignty flex and automation structures",
    );
  } finally {
    if (session._space) {
      spaceRuntime.detachSession(session, { broadcast: false });
    }
    sovAutoState._testing.clearAllJobs();
    writeTable("sovereignty", sovereigntyBackup);
    resetSovereigntyStateForTests();
  }
});
