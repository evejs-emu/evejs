const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));
const {
  grantItemsToCharacterLocation,
  findItemById,
  listOwnedItems,
  ITEM_FLAGS,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  buildIndustryErrorTuple,
  parseIndustryRequest,
} = require(path.join(repoRoot, "server/src/services/industry/industryPayloads"));
const {
  currentFileTime,
} = require(path.join(repoRoot, "server/src/services/_shared/serviceHelpers"));
const {
  adjustCharacterBalance,
  getCharacterWallet,
} = require(path.join(repoRoot, "server/src/services/account/walletState"));
const {
  buildManufacturingMaterials,
  connectMonitor,
  cancelIndustryJob,
  deliverManufacturingJob,
  getBlueprintByItemID,
  installManufacturingJob,
  listBlueprintInstancesByOwner,
  listJobsByOwner,
  markIndustryJobReady,
  quoteManufacturingJob,
  seedBlueprintForOwner,
} = require(path.join(repoRoot, "server/src/services/industry/industryRuntimeState"));
const {
  searchBlueprintDefinitions,
  getFacilityPayloadByID,
} = require(path.join(repoRoot, "server/src/services/industry/industryStaticData"));
const {
  executeBlueprintAutoCommand,
} = require(path.join(repoRoot, "server/src/services/industry/industryChatCommands"));
const {
  clearCharacterSkills,
  grantCharacterSkillTypes,
} = require(path.join(repoRoot, "server/src/services/skills/skillState"));
const {
  createStructure,
} = require(path.join(repoRoot, "server/src/services/structure/structureState"));
const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
  STRUCTURE_STATE,
} = require(path.join(repoRoot, "server/src/services/structure/structureConstants"));
const {
  INDUSTRY_ACTIVITY,
  INDUSTRY_INSTALLED_LOCATION_ID,
} = require(path.join(repoRoot, "server/src/services/industry/industryConstants"));
const {
  resolveBlueprintActivityPrice,
} = require(path.join(repoRoot, "server/src/services/industry/industryPricing"));
const {
  TRIGLAVIAN_FACTION_ID,
  TRIGLAVIAN_FACTORY_STANDING_REQUIREMENT,
  resolveIndustrySlotLimit,
} = require(path.join(repoRoot, "server/src/services/industry/industryRestrictions"));

const SNAPSHOT_TABLES = [
  "characters",
  "corporationRuntime",
  "industryFacilityState",
  "items",
  "industryBlueprintState",
  "industryJobs",
  "industryRuntime",
  "structures",
];

function readTable(tableName) {
  const result = database.read(tableName, "/");
  return result && result.success ? JSON.parse(JSON.stringify(result.data)) : {};
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to restore ${tableName}`);
}

function resetIndustryTestState() {
  const blueprintState = readTable("industryBlueprintState");
  writeTable("industryBlueprintState", {
    ...blueprintState,
    records: {},
  });

  const jobs = readTable("industryJobs");
  writeTable("industryJobs", {
    ...jobs,
    jobs: {},
  });

  const runtime = readTable("industryRuntime");
  writeTable("industryRuntime", {
    ...runtime,
    monitors: {},
  });
}

function withSnapshots(fn) {
  return async () => {
    const snapshots = Object.fromEntries(
      SNAPSHOT_TABLES.map((tableName) => [tableName, readTable(tableName)]),
    );
    try {
      resetIndustryTestState();
      await fn();
    } finally {
      for (const [tableName, payload] of Object.entries(snapshots)) {
        writeTable(tableName, payload);
      }
    }
  };
}

function findDockedCharacterID() {
  const characters = readTable("characters");
  const candidateIDs = Object.keys(characters || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);
  for (const characterID of candidateIDs) {
    const record = getCharacterRecord(characterID);
    if (!record) {
      continue;
    }
    if (Number(record.stationID || record.stationid || record.structureID || 0) > 0) {
      return characterID;
    }
  }
  assert.fail("Expected at least one docked character in the characters table");
}

function buildSession(characterID) {
  const record = getCharacterRecord(characterID);
  const stationID = Number(record.stationID || record.stationid || 0) || null;
  const structureID = Number(record.structureID || record.structureid || 0) || null;
  const solarSystemID = Number(record.solarSystemID || record.solarsystemid2 || record.solarsystemid || 0) || 30000142;
  const notifications = [];
  return {
    characterID,
    charid: characterID,
    corporationID: Number(record.corporationID || record.corpid || 0),
    corpid: Number(record.corporationID || record.corpid || 0),
    corprole: String(record.corprole || "0"),
    corpAccountKey: Number(record.corpAccountKey || 1000) || 1000,
    stationid: stationID,
    stationID,
    structureid: structureID,
    structureID,
    solarsystemid: solarSystemID,
    solarsystemid2: solarSystemID,
    regionid: Number(record.regionID || record.regionid || 10000002),
    rolesAtAll: String(record.rolesAtAll || record.corprole || "0"),
    rolesAtBase: String(record.rolesAtBase || "0"),
    rolesAtHQ: String(record.rolesAtHQ || "0"),
    rolesAtOther: String(record.rolesAtOther || record.corprole || "0"),
    hqID: Number(record.hqID || 0),
    baseID: Number(record.baseID || 0),
    characterName: record.characterName || record.name || `Char ${characterID}`,
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
}

function enableCorporationIndustryAccess(session) {
  const roleMask =
    1024n +
    8192n +
    1048576n +
    134217728n +
    1125899906842624n;
  const asText = roleMask.toString();
  session.corprole = asText;
  session.rolesAtAll = asText;
  session.rolesAtOther = asText;
  session.corpAccountKey = 1000;
  return session;
}

function seedBlueprintAndMaterials(
  session,
  query = "rifter",
  runs = 1,
  locationID = session.stationID || session.structureID,
) {
  const definition = searchBlueprintDefinitions(query, 1)[0];
  assert.ok(definition, `Expected a blueprint definition for ${query}`);
  adjustCharacterBalance(session.characterID, 1_000_000_000, {
    description: "Industry parity test wallet top-up",
    ownerID1: session.characterID,
    ownerID2: session.characterID,
    referenceID: session.characterID,
  });
  const seedResult = seedBlueprintForOwner(session.characterID, locationID, {
    blueprintTypeID: definition.blueprintTypeID,
    itemName: definition.blueprintName,
    original: false,
    runsRemaining: runs,
    materialEfficiency: 0,
    timeEfficiency: 0,
  });
  assert.equal(seedResult.success, true);
  const materials = buildManufacturingMaterials(definition, runs, 0);
  const grantResult = grantItemsToCharacterLocation(
    session.characterID,
    locationID,
    ITEM_FLAGS.HANGAR,
    materials.map((material) => ({
      itemType: material.typeID,
      quantity: material.quantity,
    })),
  );
  assert.equal(grantResult.success, true);
  const blueprint = listBlueprintInstancesByOwner(session.characterID, null).blueprints
    .filter((entry) => entry.typeID === definition.blueprintTypeID)
    .filter((entry) => Number(entry.locationID) === Number(locationID))
    .sort((left, right) => right.itemID - left.itemID)[0];
  assert.ok(blueprint, "Expected the seeded blueprint instance to be visible");
  return { definition, blueprint };
}

function seedOriginalBlueprint(
  session,
  query = "rifter",
  locationID = session.stationID || session.structureID,
) {
  const definition = searchBlueprintDefinitions(query, 1)[0];
  assert.ok(definition, `Expected a blueprint definition for ${query}`);
  adjustCharacterBalance(session.characterID, 1_000_000_000, {
    description: "Industry parity test wallet top-up",
    ownerID1: session.characterID,
    ownerID2: session.characterID,
    referenceID: session.characterID,
  });
  const seedResult = seedBlueprintForOwner(session.characterID, locationID, {
    blueprintTypeID: definition.blueprintTypeID,
    itemName: definition.blueprintName,
    original: true,
    materialEfficiency: 0,
    timeEfficiency: 0,
  });
  assert.equal(seedResult.success, true);
  const blueprint = listBlueprintInstancesByOwner(session.characterID, null).blueprints
    .filter((entry) => entry.typeID === definition.blueprintTypeID)
    .filter((entry) => Number(entry.locationID) === Number(locationID))
    .sort((left, right) => right.itemID - left.itemID)[0];
  assert.ok(blueprint, "Expected the seeded original blueprint instance to be visible");
  return { definition, blueprint };
}

function buildRequest(session, definition, blueprint, runs, overrides = {}) {
  const facilityID = Number(overrides.facilityID || session.stationID || session.structureID);
  const solarSystemID = Number(overrides.solarSystemID || session.solarsystemid2);
  const ownerID =
    overrides.ownerID !== undefined
      ? Number(overrides.ownerID || 0)
      : session.characterID;
  const flagID = Number(overrides.flagID || ITEM_FLAGS.HANGAR);
  return {
    blueprintID: blueprint.itemID,
    blueprintTypeID: blueprint.typeID,
    activityID: 1,
    facilityID,
    solarSystemID,
    characterID: session.characterID,
    corporationID: session.corporationID,
    account: [session.characterID, 1000],
    runs,
    cost: 0,
    tax: 0,
    time: 0,
    materials: {},
    inputLocation: {
      itemID: facilityID,
      typeID: 0,
      ownerID,
      flagID,
    },
    outputLocation: {
      itemID: facilityID,
      typeID: 0,
      ownerID,
      flagID,
    },
    licensedRuns: 1,
    productTypeID: definition.productTypeID,
    ...overrides,
  };
}

function applyQuoteToRequest(request, quote) {
  return {
    ...request,
    cost: Number(quote && quote.cost) || 0,
    tax: Number(quote && quote.tax) || 0,
    time: Number(quote && quote.timeInSeconds) || 0,
    materials: Object.fromEntries(
      Array.isArray(quote && quote.materials)
        ? quote.materials.map((material) => [String(material.typeID), Number(material.quantity) || 0])
        : [],
    ),
    inputLocation: quote && quote.inputLocation ? quote.inputLocation : request.inputLocation,
    outputLocation: quote && quote.outputLocation ? quote.outputLocation : request.outputLocation,
  };
}

function setCharacterWalletBalance(characterID, targetBalance) {
  const currentBalance = Number(getCharacterWallet(characterID)?.balance || 0);
  const desiredBalance = Number(targetBalance) || 0;
  const delta = desiredBalance - currentBalance;
  if (delta !== 0) {
    adjustCharacterBalance(characterID, delta, {
      description: "Industry parity test wallet set",
      ownerID1: characterID,
      ownerID2: characterID,
      referenceID: characterID,
    });
  }
}

function getFacilityTimeFactor(facility, activityID = INDUSTRY_ACTIVITY.MANUFACTURING) {
  const activityEntry =
    facility &&
    facility.activities &&
    facility.activities[activityID];
  const timeModifiers = Array.isArray(activityEntry && activityEntry[0]) ? activityEntry[0] : [];
  return timeModifiers.reduce((factor, entry) => {
    const amount = Number(Array.isArray(entry) ? entry[0] : 1);
    return factor * (Number.isFinite(amount) && amount > 0 ? amount : 1);
  }, 1);
}

function setStandingForOwner(session, subjectOwnerID, targetOwnerID, standingValue) {
  const characterID = session.characterID;
  const corporationID = session.corporationID;
  const numericSubjectOwnerID = Number(subjectOwnerID || 0);
  const numericTargetOwnerID = Number(targetOwnerID || 0);
  const numericStandingValue = Number(standingValue || 0);

  const result = updateCharacterRecord(characterID, (record) => {
    const source =
      record && record.standingData && typeof record.standingData === "object"
        ? record.standingData
        : {};
    const cloneRows = (rows) => (Array.isArray(rows) ? rows.map((entry) => ({ ...entry })) : []);
    const nextStandingData = {
      char: cloneRows(source.char),
      corp: cloneRows(source.corp),
      npc: cloneRows(source.npc),
    };
    const bucketName =
      numericSubjectOwnerID === corporationID
        ? "corp"
        : numericSubjectOwnerID === characterID
          ? "char"
          : "npc";
    nextStandingData[bucketName] = nextStandingData[bucketName].filter((entry) => !(
      Number(entry && entry.fromID) === numericSubjectOwnerID &&
      Number(entry && entry.toID) === numericTargetOwnerID
    ));
    nextStandingData[bucketName].push({
      fromID: numericSubjectOwnerID,
      toID: numericTargetOwnerID,
      standing: numericStandingValue,
    });
    return {
      ...record,
      standingData: nextStandingData,
    };
  });
  assert.equal(result.success, true);
}

function createTestStructure(session, options = {}) {
  const structureResult = createStructure({
    typeID: Number(options.typeID || 35825),
    ownerCorpID: session.corporationID,
    solarSystemID: Number(options.solarSystemID || session.solarsystemid2),
    regionID: Number(options.regionID || session.regionid),
    state:
      options.state !== undefined
        ? Number(options.state)
        : STRUCTURE_STATE.SHIELD_VULNERABLE,
    hasQuantumCore:
      options.hasQuantumCore !== undefined
        ? Boolean(options.hasQuantumCore)
        : true,
    serviceStates:
      options.serviceStates ||
      {
        [STRUCTURE_SERVICE_ID.MANUFACTURING_BASIC]: STRUCTURE_SERVICE_STATE.ONLINE,
      },
    name: options.name || "Industry Parity Test Structure",
    itemName: options.itemName || "Industry Parity Test Structure",
  });
  assert.equal(structureResult.success, true);
  return structureResult.data;
}

test("seeded blueprint instances expose manufacturing quote data", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const { definition, blueprint } = seedBlueprintAndMaterials(session, "rifter", 1);
  const request = buildRequest(session, definition, blueprint, 1);
  const quote = quoteManufacturingJob(session, request);

  assert.equal(quote.success, true);
  assert.equal(blueprint.quantity, -2);
  assert.ok(quote.quote.materials.length > 0);
  assert.ok(quote.quote.timeInSeconds > 0);
  assert.ok(quote.quote.totalCost >= 0);
}));

test("Oracle and capital compressor quotes use CCP-shaped blueprint activity pricing instead of blueprint base price", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());

  for (const query of ["Oracle", "Capital Asteroid Ore Compressor I"]) {
    const { definition, blueprint } = seedBlueprintAndMaterials(session, query, 1);
    const request = buildRequest(session, definition, blueprint, 1);
    const quote = quoteManufacturingJob(session, request);

    assert.equal(quote.success, true, `Expected ${query} quote to succeed`);
    const expectedCost = Math.round(
      resolveBlueprintActivityPrice(definition.blueprintTypeID, INDUSTRY_ACTIVITY.MANUFACTURING),
    );
    assert.equal(
      quote.quote.cost,
      expectedCost,
      `Expected ${query} quote cost to come from estimated item value pricing`,
    );

    setCharacterWalletBalance(session.characterID, quote.quote.totalCost);
    const requote = quoteManufacturingJob(session, request);
    assert.equal(
      requote.success,
      true,
      `Expected ${query} quote not to fail with false ACCOUNT_FUNDS once wallet matches the retail-shaped total`,
    );
    assert.equal(
      requote.errors.some((entry) => Number(entry && entry.code) === 19),
      false,
      `Expected ${query} quote to stop producing false ACCOUNT_FUNDS`,
    );
  }
}));

test("Curse manufacturing quote uses blueprint activity pricing instead of finished-ship estimated value", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const { definition, blueprint } = seedBlueprintAndMaterials(session, "Curse", 1);
  const request = buildRequest(session, definition, blueprint, 1);
  const quote = quoteManufacturingJob(session, request);

  assert.equal(quote.success, true, "Expected Curse quote to succeed");
  const expectedCost = Math.round(
    resolveBlueprintActivityPrice(definition.blueprintTypeID, INDUSTRY_ACTIVITY.MANUFACTURING),
  );
  assert.equal(
    quote.quote.cost,
    expectedCost,
    "Expected Curse cost to match the packaged-client blueprint pricing lane",
  );
  assert.equal(expectedCost, 12008908);
}));

test("multi-run Curse manufacturing installs without false mismatch cost, time, or run-length errors", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  grantCharacterSkillTypes(session.characterID, [3380, 3388, 3397, 11444, 11453], 5);
  const { definition, blueprint } = seedOriginalBlueprint(session, "Curse");
  const materials = buildManufacturingMaterials(definition, 20, 0);
  const grantResult = grantItemsToCharacterLocation(
    session.characterID,
    session.stationID || session.structureID,
    ITEM_FLAGS.HANGAR,
    materials.map((material) => ({
      itemType: material.typeID,
      quantity: material.quantity,
    })),
  );
  assert.equal(grantResult.success, true);
  const request = buildRequest(session, definition, blueprint, 20);
  const quoteResult = quoteManufacturingJob(session, request);

  assert.equal(quoteResult.success, true, "Expected multi-run Curse quote to succeed");
  assert.equal(quoteResult.errors.length, 0);
  assert.equal(quoteResult.quote.cost, 240178160);
  assert.equal(quoteResult.quote.timeInSeconds, 2658548);

  const installRequest = applyQuoteToRequest(request, quoteResult.quote);
  setCharacterWalletBalance(session.characterID, quoteResult.quote.totalCost);

  const installResult = installManufacturingJob(session, installRequest);
  assert.equal(installResult.success, true, "Expected multi-run Curse install to succeed without false mismatches");
}));

test("Scourge Precision Heavy Missile quote time includes character and required-skill modifiers", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  clearCharacterSkills(session.characterID);
  setCharacterWalletBalance(session.characterID, 1_000_000_000);

  const { definition, blueprint } = seedBlueprintAndMaterials(
    session,
    "Scourge Precision Heavy Missile",
    1,
  );
  const request = buildRequest(session, definition, blueprint, 1);

  const noSkillsQuote = quoteManufacturingJob(session, request);
  assert.equal(noSkillsQuote.success, true);
  const facilityFactor = getFacilityTimeFactor(noSkillsQuote.quote.facility);
  assert.equal(
    noSkillsQuote.quote.timeInSeconds,
    Math.round(definition.activities.manufacturing.time * facilityFactor),
  );

  grantCharacterSkillTypes(session.characterID, [3380, 3388, 11446, 11449], 5);
  const skilledQuote = quoteManufacturingJob(session, request);
  assert.equal(skilledQuote.success, true);
  const expectedSkillFactor = 0.8 * 0.85 * 0.95 * 0.95;
  assert.equal(
    skilledQuote.quote.timeInSeconds,
    Math.round(definition.activities.manufacturing.time * facilityFactor * expectedSkillFactor),
  );
  assert.ok(skilledQuote.quote.timeInSeconds < noSkillsQuote.quote.timeInSeconds);

  const stalePreviewQuote = quoteManufacturingJob(session, {
    ...request,
    time: noSkillsQuote.quote.timeInSeconds,
  });
  assert.equal(stalePreviewQuote.success, false);
  assert.equal(
    stalePreviewQuote.errors.some((entry) => Number(entry && entry.code) === 27),
    true,
  );

  const synchronizedQuote = quoteManufacturingJob(session, {
    ...request,
    time: skilledQuote.quote.timeInSeconds,
  });
  assert.equal(synchronizedQuote.success, true);
}));

test("Inferno Cruise Missile and Corax manufacturing share the same rounded industry multiplier parity", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  clearCharacterSkills(session.characterID);
  setCharacterWalletBalance(session.characterID, 1_000_000_000);
  grantCharacterSkillTypes(session.characterID, [3380], 4);

  const inferno = seedBlueprintAndMaterials(session, "Inferno Cruise Missile", 1);
  const corax = seedBlueprintAndMaterials(session, "Corax", 1);
  const infernoRequest = buildRequest(session, inferno.definition, inferno.blueprint, 1);
  const coraxRequest = buildRequest(session, corax.definition, corax.blueprint, 1);

  const infernoQuote = quoteManufacturingJob(session, infernoRequest);
  const coraxQuote = quoteManufacturingJob(session, coraxRequest);

  assert.equal(infernoQuote.success, true);
  assert.equal(coraxQuote.success, true);

  const facilityFactor = getFacilityTimeFactor(infernoQuote.quote.facility);
  const characterFactor = 0.84;
  assert.equal(
    infernoQuote.quote.timeInSeconds,
    Math.round(inferno.definition.activities.manufacturing.time * facilityFactor * characterFactor),
  );
  assert.equal(
    coraxQuote.quote.timeInSeconds,
    Math.round(corax.definition.activities.manufacturing.time * facilityFactor * characterFactor),
  );
  assert.equal(infernoQuote.quote.timeInSeconds, 718);
  assert.equal(coraxQuote.quote.timeInSeconds, 7182);

  const synchronizedInfernoQuote = quoteManufacturingJob(session, {
    ...infernoRequest,
    time: 718,
  });
  assert.equal(synchronizedInfernoQuote.success, true);
}));

test("industry monitor uses the selected research activity instead of manufacturing-only quote logic", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const { definition, blueprint } = seedBlueprintAndMaterials(
    session,
    "Scourge Precision Heavy Missile",
    1,
  );
  const facilityID = session.stationID || session.structureID;

  const researchMaterials = definition.activities.research_time.materials.map((material) => ({
    itemType: material.typeID,
    quantity: material.quantity,
  }));
  const grantResult = grantItemsToCharacterLocation(
    session.characterID,
    facilityID,
    ITEM_FLAGS.HANGAR,
    researchMaterials,
  );
  assert.equal(grantResult.success, true);

  const monitorResult = connectMonitor(session, {
    blueprintID: blueprint.itemID,
    blueprintTypeID: blueprint.typeID,
    activityID: INDUSTRY_ACTIVITY.RESEARCH_TIME,
    facilityID,
    solarSystemID: session.solarsystemid2,
    characterID: session.characterID,
    corporationID: session.corporationID,
    account: [session.characterID, 1000],
    runs: 1,
    inputLocation: {
      itemID: facilityID,
      typeID: 0,
      ownerID: session.characterID,
      flagID: ITEM_FLAGS.HANGAR,
    },
    outputLocation: {
      itemID: facilityID,
      typeID: 0,
      ownerID: session.characterID,
      flagID: ITEM_FLAGS.HANGAR,
    },
  });

  assert.equal(monitorResult.success, true);
  for (const material of definition.activities.research_time.materials) {
    assert.ok(
      Number(monitorResult.data.availableMaterials[String(material.typeID)] || monitorResult.data.availableMaterials[material.typeID] || 0) >= material.quantity,
      `Expected research monitor to surface material ${material.typeID} for the selected science activity`,
    );
  }
}));

test("industry slot limits use CCP skill groupings for manufacturing, science, and reactions", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  clearCharacterSkills(session.characterID);

  assert.equal(resolveIndustrySlotLimit(INDUSTRY_ACTIVITY.MANUFACTURING, session.characterID), 1);
  assert.equal(resolveIndustrySlotLimit(INDUSTRY_ACTIVITY.RESEARCH_TIME, session.characterID), 1);
  assert.equal(resolveIndustrySlotLimit(INDUSTRY_ACTIVITY.REACTION, session.characterID), 1);

  grantCharacterSkillTypes(session.characterID, [3387, 24625, 3406, 24624, 45748, 45749], 5);

  assert.equal(resolveIndustrySlotLimit(INDUSTRY_ACTIVITY.MANUFACTURING, session.characterID), 11);
  assert.equal(resolveIndustrySlotLimit(INDUSTRY_ACTIVITY.RESEARCH_TIME, session.characterID), 11);
  assert.equal(resolveIndustrySlotLimit(INDUSTRY_ACTIVITY.REACTION, session.characterID), 11);
}));

test("manufacturing quote enforces retail slot limits instead of allowing unlimited installs", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  clearCharacterSkills(session.characterID);

  const firstJob = seedBlueprintAndMaterials(session, "module", 1);
  const secondJob = seedBlueprintAndMaterials(session, "frigate", 1);

  const firstInstall = installManufacturingJob(
    session,
    buildRequest(session, firstJob.definition, firstJob.blueprint, 1),
  );
  assert.equal(firstInstall.success, true);

  let secondQuote = quoteManufacturingJob(
    session,
    buildRequest(session, secondJob.definition, secondJob.blueprint, 1),
  );
  assert.equal(secondQuote.success, false);
  assert.equal(
    secondQuote.errors.some((entry) => Number(entry && entry.code) === 31),
    true,
  );

  grantCharacterSkillTypes(session.characterID, [3387], 1);
  secondQuote = quoteManufacturingJob(
    session,
    buildRequest(session, secondJob.definition, secondJob.blueprint, 1),
  );
  assert.equal(secondQuote.success, true);
}));

test("Triglavian station manufacturing requires the retail standing threshold", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const pochvenStationID = 60000355;
  const pochvenSolarSystemID = 30001372;
  const { definition, blueprint } = seedBlueprintAndMaterials(
    session,
    "module",
    1,
    pochvenStationID,
  );
  const request = buildRequest(session, definition, blueprint, 1, {
    facilityID: pochvenStationID,
    solarSystemID: pochvenSolarSystemID,
  });

  setStandingForOwner(
    session,
    session.characterID,
    TRIGLAVIAN_FACTION_ID,
    TRIGLAVIAN_FACTORY_STANDING_REQUIREMENT - 0.25,
  );
  let quote = quoteManufacturingJob(session, request);
  assert.equal(quote.success, false);
  const standingError = quote.errors.find((entry) => Number(entry && entry.code) === 48);
  assert.ok(standingError, "Expected STANDINGS_RESTRICTION for low Triglavian station access");
  assert.deepEqual(standingError.args[0], {
    from_id: TRIGLAVIAN_FACTION_ID,
    to_id: session.characterID,
    required_standing: TRIGLAVIAN_FACTORY_STANDING_REQUIREMENT,
    current_standing: TRIGLAVIAN_FACTORY_STANDING_REQUIREMENT - 0.25,
  });

  setStandingForOwner(
    session,
    session.characterID,
    TRIGLAVIAN_FACTION_ID,
    TRIGLAVIAN_FACTORY_STANDING_REQUIREMENT,
  );
  quote = quoteManufacturingJob(session, request);
  assert.equal(
    quote.errors.some((entry) => Number(entry && entry.code) === 48),
    false,
  );
}));

test("capital manufacturing requires the correct structure service instead of any generic manufacturing service", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const structure = createTestStructure(session, {
    serviceStates: {
      [STRUCTURE_SERVICE_ID.MANUFACTURING_BASIC]: STRUCTURE_SERVICE_STATE.ONLINE,
    },
  });
  const { definition, blueprint } = seedBlueprintAndMaterials(
    session,
    "Rorqual",
    1,
    structure.structureID,
  );
  const request = buildRequest(session, definition, blueprint, 1, {
    facilityID: structure.structureID,
    solarSystemID: structure.solarSystemID,
  });

  const quote = quoteManufacturingJob(session, request);
  assert.equal(quote.success, false);
  assert.equal(
    quote.errors.some((entry) => Number(entry && entry.code) === 33),
    true,
  );
}));

test("Triglavian structures reject capital manufacturing with FACILITY_TYPE like retail", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const structure = createTestStructure(session, {
    solarSystemID: 30001372,
    regionID: 10000070,
    serviceStates: {
      [STRUCTURE_SERVICE_ID.MANUFACTURING_CAPITAL]: STRUCTURE_SERVICE_STATE.ONLINE,
    },
    name: "Pochven Capital Yard",
    itemName: "Pochven Capital Yard",
  });
  const { definition, blueprint } = seedBlueprintAndMaterials(
    session,
    "Rorqual",
    1,
    structure.structureID,
  );
  const request = buildRequest(session, definition, blueprint, 1, {
    facilityID: structure.structureID,
    solarSystemID: structure.solarSystemID,
  });

  const quote = quoteManufacturingJob(session, request);
  assert.equal(quote.success, false);
  const facilityTypeError = quote.errors.find((entry) => Number(entry && entry.code) === 34);
  assert.ok(facilityTypeError, "Expected FACILITY_TYPE for Pochven capital structure manufacturing");
  assert.deepEqual(facilityTypeError.args, [definition.blueprintTypeID]);
}));

test("manufacturing install and delivery produce outputs and job notifications", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const { definition, blueprint } = seedBlueprintAndMaterials(session, "rifter", 1);
  const request = buildRequest(session, definition, blueprint, 1);
  const installResult = installManufacturingJob(session, request);

  assert.equal(installResult.success, true);
  const installedJob = installResult.data.job;
  const startFiletime = BigInt(String(installedJob.startDate));
  const endFiletime = BigInt(String(installedJob.endDate));
  assert.ok(startFiletime > 1000000000000000n, "Expected startDate to be stored as a blue/filetime timestamp");
  assert.equal(endFiletime - startFiletime, BigInt(installedJob.timeInSeconds) * 10000000n);

  const jobsTable = readTable("industryJobs");
  jobsTable.jobs[String(installResult.data.jobID)].endDate = (currentFileTime() - 1n).toString();
  writeTable("industryJobs", jobsTable);

  const deliverResult = deliverManufacturingJob(session, installResult.data.jobID);
  assert.equal(deliverResult.success, true);
  assert.equal(deliverResult.data.status, 101);

  const outputs = listOwnedItems(session.characterID, {
    locationID: session.stationID || session.structureID,
    flagID: ITEM_FLAGS.HANGAR,
    typeID: definition.productTypeID,
  });
  assert.ok(outputs.length > 0, "Expected delivered manufactured output items");
}));

test("installed manufacturing jobs move blueprint items to RAM installed items while keeping Industry visibility", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const { definition, blueprint } = seedBlueprintAndMaterials(session, "rifter", 2);
  const request = buildRequest(session, definition, blueprint, 1);

  const installResult = installManufacturingJob(session, request);
  assert.equal(installResult.success, true);

  const storedBlueprintItem = findItemById(blueprint.itemID);
  assert.equal(
    Number(storedBlueprintItem && storedBlueprintItem.locationID),
    INDUSTRY_INSTALLED_LOCATION_ID,
    "Expected installed blueprint item to move into locationRAMInstalledItems",
  );
  assert.equal(
    Number(storedBlueprintItem && storedBlueprintItem.flagID),
    ITEM_FLAGS.HANGAR,
    "Expected installed blueprint item to retain its hangar-style flag metadata",
  );

  const hangarBlueprints = listOwnedItems(session.characterID, {
    locationID: session.stationID || session.structureID,
    flagID: ITEM_FLAGS.HANGAR,
    typeID: blueprint.typeID,
  }).filter((entry) => Number(entry.itemID) === Number(blueprint.itemID));
  assert.equal(
    hangarBlueprints.length,
    0,
    "Expected installed blueprint to disappear from the normal station hangar inventory",
  );

  const industryBlueprint = getBlueprintByItemID(blueprint.itemID, session);
  assert.ok(industryBlueprint, "Expected Industry to still resolve the installed blueprint");
  assert.equal(Number(industryBlueprint.jobID), Number(installResult.data.jobID));
  assert.equal(
    Number(industryBlueprint.locationID),
    Number(session.stationID || session.structureID),
    "Expected Industry payload to keep the original blueprint location for display/access",
  );
  assert.equal(
    Number(industryBlueprint.flagID),
    ITEM_FLAGS.HANGAR,
    "Expected Industry payload to keep the original blueprint flag for display/access",
  );

  const jobsTable = readTable("industryJobs");
  jobsTable.jobs[String(installResult.data.jobID)].endDate = (currentFileTime() - 1n).toString();
  writeTable("industryJobs", jobsTable);

  const deliverResult = deliverManufacturingJob(session, installResult.data.jobID);
  assert.equal(deliverResult.success, true);

  const deliveredBlueprintItem = findItemById(blueprint.itemID);
  assert.equal(
    Number(deliveredBlueprintItem && deliveredBlueprintItem.locationID),
    Number(session.stationID || session.structureID),
    "Expected delivered blueprint to return to its original inventory location",
  );
  assert.equal(
    Number(deliveredBlueprintItem && deliveredBlueprintItem.flagID),
    ITEM_FLAGS.HANGAR,
    "Expected delivered blueprint to return to its original flag",
  );
}));

test("cancelled manufacturing jobs return blueprint items from RAM installed items", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const { definition, blueprint } = seedBlueprintAndMaterials(session, "module", 1);
  const request = buildRequest(session, definition, blueprint, 1);

  const installResult = installManufacturingJob(session, request);
  assert.equal(installResult.success, true);
  assert.equal(
    Number(findItemById(blueprint.itemID)?.locationID),
    INDUSTRY_INSTALLED_LOCATION_ID,
  );

  const cancelResult = cancelIndustryJob(session, installResult.data.jobID);
  assert.equal(cancelResult.success, true);

  const restoredBlueprintItem = findItemById(blueprint.itemID);
  assert.equal(
    Number(restoredBlueprintItem && restoredBlueprintItem.locationID),
    Number(session.stationID || session.structureID),
    "Expected cancelled blueprint to return to its original inventory location",
  );
  assert.equal(
    Number(restoredBlueprintItem && restoredBlueprintItem.flagID),
    ITEM_FLAGS.HANGAR,
    "Expected cancelled blueprint to return to its original flag",
  );
}));

test("bpauto seed/build/deliver flow is user-friendly and functional", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const seedResult = executeBlueprintAutoCommand(session, "seed module 1 copy");
  assert.equal(seedResult.success, true);
  const buildResult = executeBlueprintAutoCommand(session, "build module 1");
  assert.equal(buildResult.success, true);

  const jobsTable = readTable("industryJobs");
  for (const job of Object.values(jobsTable.jobs || {})) {
    job.endDate = (currentFileTime() - 1n).toString();
  }
  writeTable("industryJobs", jobsTable);

  const deliverResult = executeBlueprintAutoCommand(session, "deliver ready");
  assert.equal(deliverResult.success, true);
}));

test("bpauto demo creates an immediately deliverable GM-ready job", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const demoResult = executeBlueprintAutoCommand(session, "demo module");
  assert.equal(demoResult.success, true);
  assert.match(demoResult.message, /ready to deliver/i);

  const jobsTable = readTable("industryJobs");
  const demoJob = Object.values(jobsTable.jobs || {}).find((job) => Number(job.jobID) === Number(demoResult.jobID));
  assert.equal(Number(demoJob && demoJob.status), 3, "Expected /bpauto demo to persist READY status for GUI delivery");

  const readyJobs = listJobsByOwner(session.characterID, true)
    .filter((job) => Number(job.status) === 3);
  assert.ok(readyJobs.length > 0, "Expected /bpauto demo to leave at least one ready job");

  const deliverResult = executeBlueprintAutoCommand(session, "deliver ready");
  assert.equal(deliverResult.success, true);
}));

test("markIndustryJobReady persists ready status and blue/filetime endDate", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const { definition, blueprint } = seedBlueprintAndMaterials(session, "module", 1);
  const request = buildRequest(session, definition, blueprint, 1);
  const installResult = installManufacturingJob(session, request);

  const readyResult = markIndustryJobReady(installResult.data.jobID);
  assert.equal(readyResult.success, true);
  assert.equal(Number(readyResult.data.status), 3);

  const jobsTable = readTable("industryJobs");
  const persisted = jobsTable.jobs[String(installResult.data.jobID)];
  assert.equal(Number(persisted && persisted.status), 3);
  assert.ok(BigInt(String(persisted && persisted.endDate)) > 1000000000000000n);
}));

test("blueprintManager GetBlueprintDataByOwner returns facility-count keys for the browser", withSnapshots(async () => {
  const BlueprintManagerService = require(path.join(
    repoRoot,
    "server/src/services/industry/blueprintManagerService",
  ));
  const session = buildSession(findDockedCharacterID());
  const service = new BlueprintManagerService();
  const baselinePayload = service.Handle_GetBlueprintDataByOwner([session.characterID, null], session);
  const baselineRows = Array.isArray(baselinePayload && baselinePayload[0] && baselinePayload[0].items)
    ? baselinePayload[0].items.length
    : 0;
  const baselineFacilityCounts = new Map(
    Array.isArray(baselinePayload && baselinePayload[1] && baselinePayload[1].entries)
      ? baselinePayload[1].entries.map(([key, value]) => [key, value])
      : [],
  );
  seedBlueprintAndMaterials(session, "module", 1);
  seedBlueprintAndMaterials(session, "frigate", 1);

  const payload = service.Handle_GetBlueprintDataByOwner([session.characterID, null], session);

  assert.equal(Array.isArray(payload), true);
  assert.equal(payload.length, 2);
  assert.equal(payload[0].type, "list");
  assert.equal(payload[1].type, "dict");
  assert.equal(payload[0].items.length, baselineRows + 2);

  const facilityCounts = new Map(payload[1].entries.map(([key, value]) => [key, value]));
  assert.equal(
    facilityCounts.get(session.stationID || session.structureID),
    (baselineFacilityCounts.get(session.stationID || session.structureID) || 0) + 2,
  );
  assert.equal(facilityCounts.has(8), false, "Product category IDs must not leak into facility counts");
}));

test("facilityManager GetFacilities marshals into a real iterable payload for the client", withSnapshots(async () => {
  const { marshalEncode } = require(path.join(
    repoRoot,
    "server/src/network/tcp/utils/marshal",
  ));
  const FacilityManagerService = require(path.join(
    repoRoot,
    "server/src/services/industry/facilityManagerService",
  ));
  const session = buildSession(findDockedCharacterID());
  const service = new FacilityManagerService();
  const payload = service.Handle_GetFacilities([], session);

  assert.equal(payload.type, "list");
  assert.ok(Array.isArray(payload.items));
  assert.doesNotThrow(() => marshalEncode(payload));
  if (payload.items.length > 0) {
    const firstFacility = payload.items[0];
    const args = firstFacility && firstFacility.args;
    assert.equal(args.type, "dict");
    const rigModifiersEntry = args.entries.find(([key]) => key === "rigModifiers");
    assert.ok(rigModifiersEntry, "Expected facility payload to include rigModifiers");
    assert.equal(rigModifiersEntry[1].type, "dict");
  }
}));

test("facilityManager GetFacilityLocations returns object-state industry.Location payloads and installs round-trip", withSnapshots(async () => {
  const FacilityManagerService = require(path.join(
    repoRoot,
    "server/src/services/industry/facilityManagerService",
  ));
  const { marshalEncode } = require(path.join(
    repoRoot,
    "server/src/network/tcp/utils/marshal",
  ));
  const session = buildSession(findDockedCharacterID());
  const { definition, blueprint } = seedBlueprintAndMaterials(session, "module", 1);
  const service = new FacilityManagerService();
  const locationsPayload = service.Handle_GetFacilityLocations(
    [session.stationID || session.structureID, session.characterID],
    session,
  );

  const facilityID = session.stationID || session.structureID;
  assert.equal(locationsPayload.type, "list");
  assert.ok(Array.isArray(locationsPayload.items));
  assert.ok(locationsPayload.items.length > 0, "Expected at least one install location");
  assert.equal(locationsPayload.items[0].type, "objectex1");
  assert.equal(locationsPayload.items[0].header[0].value, "industry.Location");
  assert.equal(locationsPayload.items[0].header.length, 3);
  assert.equal(locationsPayload.items[0].header[2].type, "dict");
  assert.ok(
    locationsPayload.items[0].header[2].entries.some(([key, value]) => key === "itemID" && value === facilityID),
    "Expected industry.Location object state to include the active facility itemID",
  );
  assert.doesNotThrow(() => marshalEncode(locationsPayload));

  const parsedRequest = parseIndustryRequest({
    blueprintID: blueprint.itemID,
    blueprintTypeID: blueprint.typeID,
    activityID: 1,
    facilityID,
    solarSystemID: session.solarsystemid2,
    characterID: session.characterID,
    corporationID: session.corporationID,
    account: [session.characterID, 1000],
    runs: 1,
    cost: 0,
    tax: 0,
    time: 0,
    materials: {},
    inputLocation: locationsPayload.items[0],
    outputLocation: locationsPayload.items[0],
    licensedRuns: 1,
    productTypeID: definition.productTypeID,
  });
  const quote = quoteManufacturingJob(session, parsedRequest);

  assert.equal(quote.success, true);
  assert.equal(quote.quote.inputLocation.itemID, facilityID);
  assert.equal(quote.quote.inputLocation.flagID, 4);
}));

test("station facility payloads advertise research and copying activities for the industry window", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const structure = createTestStructure(session, {
    serviceStates: {
      [STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_TIME]: STRUCTURE_SERVICE_STATE.ONLINE,
      [STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_MATERIAL]: STRUCTURE_SERVICE_STATE.ONLINE,
      [STRUCTURE_SERVICE_ID.LABORATORY_COPYING]: STRUCTURE_SERVICE_STATE.ONLINE,
    },
  });
  const facility = getFacilityPayloadByID(structure.structureID);

  assert.ok(facility, "Expected a live industry facility payload for the docked location");
  assert.ok(facility.activities[INDUSTRY_ACTIVITY.RESEARCH_TIME]);
  assert.ok(facility.activities[INDUSTRY_ACTIVITY.RESEARCH_MATERIAL]);
  assert.ok(facility.activities[INDUSTRY_ACTIVITY.COPYING]);
}));

test("research material jobs mutate the installed original blueprint on delivery", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const structure = createTestStructure(session, {
    serviceStates: {
      [STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_MATERIAL]: STRUCTURE_SERVICE_STATE.ONLINE,
    },
  });
  const { definition, blueprint } = seedOriginalBlueprint(session, "Rifter");
  const request = buildRequest(session, definition, blueprint, 2, {
    activityID: INDUSTRY_ACTIVITY.RESEARCH_MATERIAL,
    facilityID: structure.structureID,
    solarSystemID: structure.solarSystemID,
    licensedRuns: 1,
    productTypeID: blueprint.typeID,
  });

  const quote = quoteManufacturingJob(session, request);
  assert.equal(quote.success, true);
  assert.ok(quote.quote.timeInSeconds > 0);

  const installResult = installManufacturingJob(session, request);
  assert.equal(installResult.success, true);

  const installedBlueprintItem = findItemById(blueprint.itemID);
  assert.equal(
    Number(installedBlueprintItem && installedBlueprintItem.locationID),
    INDUSTRY_INSTALLED_LOCATION_ID,
  );

  markIndustryJobReady(installResult.data.jobID);
  const deliverResult = deliverManufacturingJob(session, installResult.data.jobID);
  assert.equal(deliverResult.success, true);

  const updatedBlueprint = getBlueprintByItemID(blueprint.itemID, session);
  assert.ok(updatedBlueprint, "Expected researched blueprint to remain visible after delivery");
  assert.equal(updatedBlueprint.materialEfficiency, 2);
  assert.equal(updatedBlueprint.timeEfficiency, 0);
  assert.equal(updatedBlueprint.jobID, null);
}));

test("research time jobs mutate the installed original blueprint on delivery", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const structure = createTestStructure(session, {
    serviceStates: {
      [STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_TIME]: STRUCTURE_SERVICE_STATE.ONLINE,
    },
  });
  const { definition, blueprint } = seedOriginalBlueprint(session, "Rifter");
  const request = buildRequest(session, definition, blueprint, 3, {
    activityID: INDUSTRY_ACTIVITY.RESEARCH_TIME,
    facilityID: structure.structureID,
    solarSystemID: structure.solarSystemID,
    licensedRuns: 1,
    productTypeID: blueprint.typeID,
  });

  const quote = quoteManufacturingJob(session, request);
  assert.equal(quote.success, true);
  assert.ok(quote.quote.timeInSeconds > 0);

  const installResult = installManufacturingJob(session, request);
  assert.equal(installResult.success, true);

  const installedBlueprintItem = findItemById(blueprint.itemID);
  assert.equal(
    Number(installedBlueprintItem && installedBlueprintItem.locationID),
    INDUSTRY_INSTALLED_LOCATION_ID,
  );

  markIndustryJobReady(installResult.data.jobID);
  const deliverResult = deliverManufacturingJob(session, installResult.data.jobID);
  assert.equal(deliverResult.success, true);

  const updatedBlueprint = getBlueprintByItemID(blueprint.itemID, session);
  assert.ok(updatedBlueprint, "Expected time-researched blueprint to remain visible after delivery");
  assert.equal(updatedBlueprint.materialEfficiency, 0);
  assert.equal(updatedBlueprint.timeEfficiency, 6);
  assert.equal(updatedBlueprint.jobID, null);
}));

test("copying jobs deliver real blueprint copies with licensed runs and restore the source original", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const structure = createTestStructure(session, {
    serviceStates: {
      [STRUCTURE_SERVICE_ID.LABORATORY_COPYING]: STRUCTURE_SERVICE_STATE.ONLINE,
    },
  });
  const { definition, blueprint } = seedOriginalBlueprint(session, "Rifter");
  const request = buildRequest(session, definition, blueprint, 2, {
    activityID: INDUSTRY_ACTIVITY.COPYING,
    facilityID: structure.structureID,
    solarSystemID: structure.solarSystemID,
    licensedRuns: 7,
    productTypeID: blueprint.typeID,
  });

  const quote = quoteManufacturingJob(session, request);
  assert.equal(quote.success, true);
  assert.ok(quote.quote.timeInSeconds > 0);
  assert.ok(quote.quote.cost > 0);

  const installResult = installManufacturingJob(session, request);
  assert.equal(installResult.success, true);

  markIndustryJobReady(installResult.data.jobID);
  const deliverResult = deliverManufacturingJob(session, installResult.data.jobID);
  assert.equal(deliverResult.success, true);

  const sourceBlueprint = getBlueprintByItemID(blueprint.itemID, session);
  assert.ok(sourceBlueprint, "Expected the original blueprint to be restored after copying");
  assert.equal(sourceBlueprint.jobID, null);

  const outputBlueprintRows = listOwnedItems(session.characterID, {
    typeID: blueprint.typeID,
  });

  const copyBlueprintStates = outputBlueprintRows
    .map((item) => getBlueprintByItemID(item.itemID, session))
    .filter((entry) => entry && entry.itemID !== blueprint.itemID && entry.quantity === -2 && entry.runs === 7)
    .sort((left, right) => left.itemID - right.itemID);

  assert.equal(copyBlueprintStates.length, 2);
  for (const copyBlueprint of copyBlueprintStates) {
    assert.equal(copyBlueprint.quantity, -2);
    assert.equal(copyBlueprint.runs, 7);
    assert.equal(copyBlueprint.materialEfficiency, 0);
    assert.equal(copyBlueprint.timeEfficiency, 0);
  }
}));

test("cancelled copying jobs restore the installed original and do not create copy outputs", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const structure = createTestStructure(session, {
    serviceStates: {
      [STRUCTURE_SERVICE_ID.LABORATORY_COPYING]: STRUCTURE_SERVICE_STATE.ONLINE,
    },
  });
  const { definition, blueprint } = seedOriginalBlueprint(session, "Rifter");
  const request = buildRequest(session, definition, blueprint, 2, {
    activityID: INDUSTRY_ACTIVITY.COPYING,
    facilityID: structure.structureID,
    solarSystemID: structure.solarSystemID,
    licensedRuns: 5,
    productTypeID: blueprint.typeID,
  });
  const baselineBlueprintRows = listOwnedItems(session.characterID, {
    typeID: blueprint.typeID,
  }).length;

  const installResult = installManufacturingJob(session, request);
  assert.equal(installResult.success, true);
  assert.equal(
    Number(findItemById(blueprint.itemID)?.locationID),
    INDUSTRY_INSTALLED_LOCATION_ID,
  );

  const cancelResult = cancelIndustryJob(session, installResult.data.jobID);
  assert.equal(cancelResult.success, true);

  const restoredBlueprint = getBlueprintByItemID(blueprint.itemID, session);
  assert.ok(restoredBlueprint, "Expected the original blueprint to be restored after copy cancel");
  assert.equal(restoredBlueprint.jobID, null);
  assert.equal(
    Number(findItemById(blueprint.itemID)?.locationID),
    Number(session.stationID || session.structureID),
    "Expected cancelled copy jobs to restore the blueprint to its original owner inventory",
  );

  const postCancelBlueprintRows = listOwnedItems(session.characterID, {
    typeID: blueprint.typeID,
  }).length;
  assert.equal(
    postCancelBlueprintRows,
    baselineBlueprintRows,
    "Expected copy cancellation not to create any new blueprint outputs",
  );
}));

test("manufacturing quote hot path stays fast enough for repeated GM usage", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const { definition, blueprint } = seedBlueprintAndMaterials(session, "module", 1);
  const request = buildRequest(session, definition, blueprint, 1);
  const startedAt = Date.now();
  for (let index = 0; index < 100; index += 1) {
    const quote = quoteManufacturingJob(session, request);
    assert.equal(quote.success, true);
  }
  const elapsedMs = Date.now() - startedAt;
  assert.ok(
    elapsedMs < 3000,
    `Expected 100 manufacturing quotes to finish quickly, got ${elapsedMs}ms`,
  );
}));

test("industry validation errors expose CCP-style enum names in payloads", () => {
  const errorTuple = buildIndustryErrorTuple(16, [34, 10, 0, 10]);
  assert.equal(errorTuple.type, "tuple");
  assert.equal(
    errorTuple.items[0].args.entries.find(([key]) => key === "name")[1],
    "MISSING_MATERIAL",
  );
});

test("bpauto corp flow seeds, builds, and delivers to corp output locations", withSnapshots(async () => {
  const session = enableCorporationIndustryAccess(buildSession(findDockedCharacterID()));
  const ownerResult = executeBlueprintAutoCommand(session, "owner corp");
  assert.equal(ownerResult.success, true);

  const seedResult = executeBlueprintAutoCommand(session, "seed module 1 copy");
  assert.equal(seedResult.success, true);

  const buildResult = executeBlueprintAutoCommand(session, "build module 1");
  assert.equal(buildResult.success, true);

  const jobsTable = readTable("industryJobs");
  for (const job of Object.values(jobsTable.jobs || {})) {
    if (Number(job.ownerID) === session.corpid) {
      job.endDate = Date.now() - 1000;
    }
  }
  writeTable("industryJobs", jobsTable);

  const deliverResult = executeBlueprintAutoCommand(session, "deliver ready");
  assert.equal(deliverResult.success, true);

  const definition = searchBlueprintDefinitions("200mm AutoCannon I", 1)[0];
  const outputs = listOwnedItems(session.corpid, {
    locationID: session.stationID || session.structureID,
    flagID: 62,
    typeID: definition.productTypeID,
  });
  assert.ok(outputs.length > 0, "Expected delivered corp-manufactured output items");
}));
