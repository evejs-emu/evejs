const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharMgrService = require(path.join(
  repoRoot,
  "server/src/services/character/charMgrService",
));
const {
  applyCharacterToSession,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  grantItemsToCharacterLocation,
  ITEM_FLAGS,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  adjustCharacterBalance,
} = require(path.join(repoRoot, "server/src/services/account/walletState"));
const {
  buildManufacturingMaterials,
  cancelIndustryJob,
  deliverManufacturingJob,
  getBlueprintByItemID,
  installManufacturingJob,
  listBlueprintInstancesByOwner,
  markIndustryJobReady,
  quoteManufacturingJob,
  seedBlueprintForOwner,
} = require(path.join(repoRoot, "server/src/services/industry/industryRuntimeState"));
const {
  searchBlueprintDefinitions,
} = require(path.join(repoRoot, "server/src/services/industry/industryStaticData"));
const {
  INDUSTRY_ACTIVITY,
} = require(path.join(repoRoot, "server/src/services/industry/industryConstants"));
const {
  createStructure,
} = require(path.join(repoRoot, "server/src/services/structure/structureState"));
const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
  STRUCTURE_STATE,
} = require(path.join(repoRoot, "server/src/services/structure/structureConstants"));
const {
  CONTAINER_GLOBAL_ID,
} = require(path.join(
  repoRoot,
  "server/src/services/character/charMgrGlobalAssets",
));

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
  const solarSystemID =
    Number(record.solarSystemID || record.solarsystemid2 || record.solarsystemid || 0) ||
    30000142;
  const notifications = [];
  return {
    clientID: characterID + 99000,
    userid: characterID,
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
    socket: { destroyed: false },
    currentBoundObjectID: null,
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function extractBoundID(value) {
  return value &&
    Array.isArray(value) &&
    value[0] &&
    value[0].type === "substruct" &&
    value[0].value &&
    value[0].value.type === "substream" &&
    Array.isArray(value[0].value.value)
    ? value[0].value.value[0]
    : null;
}

function extractPackedRows(value) {
  if (!(value && value.type === "list" && Array.isArray(value.items))) {
    return [];
  }

  return value.items
    .map((entry) => (entry && entry.type === "packedrow" ? entry.fields : entry))
    .filter(Boolean);
}

async function bindGlobalAssets(session) {
  const service = new CharMgrService();
  const applyResult = applyCharacterToSession(session, session.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const bindResult = await service.Handle_MachoBindObject(
    [[session.characterID, CONTAINER_GLOBAL_ID], null],
    session,
    null,
  );
  const boundID = extractBoundID(bindResult);
  assert.ok(boundID, "Expected global asset bind to return a bound object id");
  session.currentBoundObjectID = boundID;
  return service;
}

function getAssetRows(service, session, locationID) {
  return {
    topLevel: extractPackedRows(service.Handle_List([], session, null)),
    recursive: extractPackedRows(service.Handle_ListIncludingContainers([], session, null)),
    rootItems: extractPackedRows(service.Handle_ListStationItems([locationID], session, null)),
  };
}

function assertAssetVisible(service, session, locationID, itemID, messagePrefix) {
  const rows = getAssetRows(service, session, locationID);
  assert.ok(
    rows.topLevel.some((row) => Number(row.itemID || 0) === Number(itemID || 0)),
    `${messagePrefix}: expected top-level assets to contain item ${itemID}`,
  );
  assert.ok(
    rows.recursive.some((row) => Number(row.itemID || 0) === Number(itemID || 0)),
    `${messagePrefix}: expected recursive assets to contain item ${itemID}`,
  );
  assert.ok(
    rows.rootItems.some((row) => Number(row.itemID || 0) === Number(itemID || 0)),
    `${messagePrefix}: expected root asset listing ${locationID} to contain item ${itemID}`,
  );
}

function assertAssetHidden(service, session, locationID, itemID, messagePrefix) {
  const rows = getAssetRows(service, session, locationID);
  assert.ok(
    !rows.topLevel.some((row) => Number(row.itemID || 0) === Number(itemID || 0)),
    `${messagePrefix}: expected top-level assets to hide item ${itemID}`,
  );
  assert.ok(
    !rows.recursive.some((row) => Number(row.itemID || 0) === Number(itemID || 0)),
    `${messagePrefix}: expected recursive assets to hide item ${itemID}`,
  );
  assert.ok(
    !rows.rootItems.some((row) => Number(row.itemID || 0) === Number(itemID || 0)),
    `${messagePrefix}: expected root asset listing ${locationID} to hide item ${itemID}`,
  );
}

function topUpCharacterWallet(characterID) {
  adjustCharacterBalance(characterID, 1_000_000_000, {
    description: "Industry asset-visibility parity test wallet top-up",
    ownerID1: characterID,
    ownerID2: characterID,
    referenceID: characterID,
  });
}

function seedOriginalBlueprint(
  session,
  query = "rifter",
  locationID = session.stationID || session.structureID,
) {
  const definition = searchBlueprintDefinitions(query, 1)[0];
  assert.ok(definition, `Expected a blueprint definition for ${query}`);
  topUpCharacterWallet(session.characterID);
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

function seedOriginalBlueprintAndMaterials(
  session,
  query = "rifter",
  runs = 1,
  locationID = session.stationID || session.structureID,
) {
  const seeded = seedOriginalBlueprint(session, query, locationID);
  const materials = buildManufacturingMaterials(seeded.definition, runs, 0);
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
  return seeded;
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
    activityID: INDUSTRY_ACTIVITY.MANUFACTURING,
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

function createIndustryStructure(session, serviceStates) {
  const result = createStructure({
    typeID: 35825,
    ownerCorpID: session.corporationID,
    solarSystemID: Number(session.solarsystemid2 || 0),
    regionID: Number(session.regionid || 0),
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    hasQuantumCore: true,
    serviceStates,
    name: "Industry Asset Visibility Structure",
    itemName: "Industry Asset Visibility Structure",
  });
  assert.equal(result.success, true);
  return result.data;
}

test("manufacturing install hides the source blueprint from personal assets and cancel restores it", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const service = await bindGlobalAssets(session);
  const { definition, blueprint } = seedOriginalBlueprintAndMaterials(session, "rifter", 1);
  const sourceLocationID = Number(blueprint.locationID || 0);

  assertAssetVisible(service, session, sourceLocationID, blueprint.itemID, "before manufacturing install");

  let request = buildRequest(session, definition, blueprint, 1);
  const quote = quoteManufacturingJob(session, request);
  assert.equal(quote.success, true);
  request = applyQuoteToRequest(request, quote.quote);

  const installResult = installManufacturingJob(session, request);
  assert.equal(installResult.success, true);
  assertAssetHidden(service, session, sourceLocationID, blueprint.itemID, "during manufacturing install");

  const cancelResult = cancelIndustryJob(session, installResult.data.jobID);
  assert.equal(cancelResult.success, true);
  assertAssetVisible(service, session, sourceLocationID, blueprint.itemID, "after manufacturing cancel");
}));

test("manufacturing delivery restores the source blueprint to personal assets", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const service = await bindGlobalAssets(session);
  const { definition, blueprint } = seedOriginalBlueprintAndMaterials(session, "rifter", 1);
  const sourceLocationID = Number(blueprint.locationID || 0);

  let request = buildRequest(session, definition, blueprint, 1);
  const quote = quoteManufacturingJob(session, request);
  assert.equal(quote.success, true);
  request = applyQuoteToRequest(request, quote.quote);

  const installResult = installManufacturingJob(session, request);
  assert.equal(installResult.success, true);
  assertAssetHidden(service, session, sourceLocationID, blueprint.itemID, "during manufacturing install");

  assert.equal(markIndustryJobReady(installResult.data.jobID).success, true);
  const deliverResult = deliverManufacturingJob(session, installResult.data.jobID);
  assert.equal(deliverResult.success, true);

  const restoredBlueprint = getBlueprintByItemID(blueprint.itemID, session);
  assert.ok(restoredBlueprint, "Expected the original manufacturing blueprint to remain after delivery");
  assertAssetVisible(
    service,
    session,
    sourceLocationID,
    blueprint.itemID,
    "after manufacturing delivery",
  );
}));

test("copying delivery hides the source blueprint while installed and restores it plus copy outputs", withSnapshots(async () => {
  const session = buildSession(findDockedCharacterID());
  const service = await bindGlobalAssets(session);
  const structure = createIndustryStructure(session, {
    [STRUCTURE_SERVICE_ID.LABORATORY_COPYING]: STRUCTURE_SERVICE_STATE.ONLINE,
  });
  const { definition, blueprint } = seedOriginalBlueprint(session, "rifter");
  const sourceLocationID = Number(blueprint.locationID || 0);

  let request = buildRequest(session, definition, blueprint, 2, {
    activityID: INDUSTRY_ACTIVITY.COPYING,
    facilityID: structure.structureID,
    solarSystemID: structure.solarSystemID,
    licensedRuns: 7,
    productTypeID: blueprint.typeID,
  });
  const quote = quoteManufacturingJob(session, request);
  assert.equal(quote.success, true);
  request = applyQuoteToRequest(request, quote.quote);

  const beforeCopyIDs = new Set(
    listBlueprintInstancesByOwner(session.characterID, null).blueprints.map((entry) => Number(entry.itemID || 0)),
  );
  const installResult = installManufacturingJob(session, request);
  assert.equal(installResult.success, true);
  assertAssetHidden(service, session, sourceLocationID, blueprint.itemID, "during copying install");

  assert.equal(markIndustryJobReady(installResult.data.jobID).success, true);
  const deliverResult = deliverManufacturingJob(session, installResult.data.jobID);
  assert.equal(deliverResult.success, true);

  assertAssetVisible(service, session, sourceLocationID, blueprint.itemID, "after copying delivery");

  const afterCopies = listBlueprintInstancesByOwner(session.characterID, null).blueprints
    .filter((entry) => !beforeCopyIDs.has(Number(entry.itemID || 0)))
    .filter((entry) => Number(entry.original ? 1 : 0) === 0);
  assert.ok(afterCopies.length > 0, "Expected copying delivery to create visible blueprint copy outputs");
  for (const copy of afterCopies) {
    assertAssetVisible(
      service,
      session,
      Number(copy.locationID || sourceLocationID),
      copy.itemID,
      "after copying delivery copy output",
    );
  }
}));

for (const [label, activityID, serviceID] of [
  ["material research", INDUSTRY_ACTIVITY.RESEARCH_MATERIAL, STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_MATERIAL],
  ["time research", INDUSTRY_ACTIVITY.RESEARCH_TIME, STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_TIME],
]) {
  test(`${label} hides the source blueprint while installed and restores it on delivery`, withSnapshots(async () => {
    const session = buildSession(findDockedCharacterID());
    const service = await bindGlobalAssets(session);
    const structure = createIndustryStructure(session, {
      [serviceID]: STRUCTURE_SERVICE_STATE.ONLINE,
    });
    const { definition, blueprint } = seedOriginalBlueprint(session, "rifter");
    const sourceLocationID = Number(blueprint.locationID || 0);

    let request = buildRequest(session, definition, blueprint, 1, {
      activityID,
      facilityID: structure.structureID,
      solarSystemID: structure.solarSystemID,
      licensedRuns: 1,
      productTypeID: blueprint.typeID,
    });
    const quote = quoteManufacturingJob(session, request);
    assert.equal(quote.success, true);
    request = applyQuoteToRequest(request, quote.quote);

    const installResult = installManufacturingJob(session, request);
    assert.equal(installResult.success, true);
    assertAssetHidden(service, session, sourceLocationID, blueprint.itemID, `during ${label} install`);

    assert.equal(markIndustryJobReady(installResult.data.jobID).success, true);
    const deliverResult = deliverManufacturingJob(session, installResult.data.jobID);
    assert.equal(deliverResult.success, true);
    assertAssetVisible(service, session, sourceLocationID, blueprint.itemID, `after ${label} delivery`);
  }));
}
