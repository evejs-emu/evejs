const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const database = require(path.join(repoRoot, "server/src/newDatabase"));
const {
  currentFileTime,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/serviceHelpers",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const AllianceRegistryRuntimeService = require(path.join(
  repoRoot,
  "server/src/services/corporation/allianceRegistryRuntime",
));
const DevIndexManagerService = require(path.join(
  repoRoot,
  "server/src/services/map/devIndexManagerService",
));
const MapService = require(path.join(
  repoRoot,
  "server/src/services/map/mapService",
));
const SovMgrService = require(path.join(
  repoRoot,
  "server/src/services/map/sovMgrService",
));
const worldData = require(path.join(repoRoot, "server/src/space/worldData"));
const {
  StationSvcAlias,
} = require(path.join(
  repoRoot,
  "server/src/services/station/stationService",
));
const {
  STRUCTURE_SCORE_UPDATED,
} = require(path.join(
  repoRoot,
  "server/src/services/sovereignty/sovConstants",
));
const {
  cancelAllianceCapitalTransition,
  getAllianceSovereigntyRows,
  getAllianceCapitalInfo,
  getAlliancePrimeInfo,
  getSovereigntyDebugSnapshot,
  listSovStructuresForSystem,
  resetSovereigntyStateForTests,
  setStructureCampaignScores,
  setAllianceCapitalSystem,
  setAlliancePrimeHour,
  upsertAllianceState,
  upsertSystemState,
} = require(path.join(
  repoRoot,
  "server/src/services/sovereignty/sovState",
));

const ALLIANCE_ID = 99000000;
const CORPORATION_ID = 98000000;
const SOLAR_SYSTEM_ID = 30000142;
const TCU_ID = 440000001;
const IHUB_ID = 440000002;
const FUEL_ACCESS_GROUP_ID = 778899;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function dictEntriesToMap(dictPayload) {
  assert.equal(dictPayload && dictPayload.type, "dict");
  return new Map(dictPayload.entries);
}

function keyValEntriesToMap(keyValPayload) {
  assert.equal(keyValPayload && keyValPayload.name, "util.KeyVal");
  return dictEntriesToMap(keyValPayload.args);
}

function assertApproxEqual(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= epsilon);
}

function pythonSetPayloadToValues(payload) {
  assert.equal(payload && payload.type, "objectex1");
  assert.equal(payload.header[0].value, "__builtin__.set");
  return payload.header[1][0].items;
}

function rowsetToObjects(rowsetPayload) {
  assert.equal(
    rowsetPayload && rowsetPayload.name,
    "eve.common.script.sys.rowset.Rowset",
  );
  const rowsetState = dictEntriesToMap(rowsetPayload.args);
  const header = rowsetState.get("header").items;
  const lines = rowsetState.get("lines").items;
  return lines.map((line) =>
    new Map(
      header.map((columnName, index) => [
        columnName,
        Array.isArray(line) ? line[index] : line.items[index],
      ]),
    ),
  );
}

function rowsetHeader(rowsetPayload) {
  assert.equal(
    rowsetPayload && rowsetPayload.name,
    "eve.common.script.sys.rowset.Rowset",
  );
  const rowsetState = dictEntriesToMap(rowsetPayload.args);
  return rowsetState.get("header").items;
}

function writeCleanSovereigntyTable(snapshot = {}) {
  database.write("sovereignty", "/", {
    ...(snapshot || {}),
    alliances: {},
    systems: {},
    hubs: {},
    skyhooks: {},
    mercenaryDens: {},
  });
}

test("seeded sovereignty state drives classic alliance, station, dev index, and sovMgr payloads", (t) => {
  const tableSnapshot = cloneValue(database.read("sovereignty", "/").data || {});
  t.after(() => {
    database.write("sovereignty", "/", cloneValue(tableSnapshot));
    resetSovereigntyStateForTests();
  });

  writeCleanSovereigntyTable(tableSnapshot);
  resetSovereigntyStateForTests();

  upsertAllianceState(ALLIANCE_ID, {
    allianceID: ALLIANCE_ID,
    primeInfo: {
      currentPrimeHour: 21,
      newPrimeHour: 21,
      newPrimeHourValidAfter: "0",
    },
    capitalInfo: {
      currentCapitalSystem: SOLAR_SYSTEM_ID,
      newCapitalSystem: null,
      newCapitalSystemValidAfter: "0",
    },
  });
  upsertSystemState(SOLAR_SYSTEM_ID, {
    allianceID: ALLIANCE_ID,
    corporationID: CORPORATION_ID,
    claimStructureID: TCU_ID,
    infrastructureHubID: IHUB_ID,
    claimTime: currentFileTime().toString(),
    fuelAccessGroupID: FUEL_ACCESS_GROUP_ID,
    recentActivity: [],
    devIndices: {
      militaryPoints: 1500,
      industrialPoints: 900,
      claimedForDays: 7,
      militaryIncreasing: true,
      industrialIncreasing: false,
    },
    structures: [
      {
        itemID: TCU_ID,
        typeID: 32226,
        ownerID: CORPORATION_ID,
        corporationID: CORPORATION_ID,
        allianceID: ALLIANCE_ID,
        vulnerableStartTime: currentFileTime().toString(),
        vulnerableEndTime: (currentFileTime() + 36000000000n).toString(),
        vulnerabilityOccupancyLevel: 2.7,
      },
      {
        itemID: IHUB_ID,
        typeID: 32458,
        ownerID: CORPORATION_ID,
        corporationID: CORPORATION_ID,
        allianceID: ALLIANCE_ID,
        campaignEventType: 7,
        campaignStartTime: currentFileTime().toString(),
        campaignOccupancyLevel: 3.5,
        campaignScoresByTeam: {
          1: 23,
          2: 14,
        },
      },
    ],
  });

  const session = {
    allianceID: ALLIANCE_ID,
    allianceid: ALLIANCE_ID,
    corporationID: CORPORATION_ID,
    corpid: CORPORATION_ID,
    solarsystemid2: SOLAR_SYSTEM_ID,
    solarsystemid: SOLAR_SYSTEM_ID,
  };

  const allianceRegistry = new AllianceRegistryRuntimeService();
  const stationSvc = new StationSvcAlias();
  const devIndexManager = new DevIndexManagerService();
  const mapService = new MapService();
  const sovMgr = new SovMgrService();
  const staticSystem = worldData.getSolarSystemByID(SOLAR_SYSTEM_ID);
  assert.ok(staticSystem, "expected seeded sovereignty system to exist in static map data");
  const constellationPeer = worldData
    .getSolarSystems()
    .find(
      (system) =>
        Number(system.constellationID) === Number(staticSystem.constellationID) &&
        Number(system.solarSystemID) !== SOLAR_SYSTEM_ID,
    );
  assert.ok(constellationPeer, "expected a peer solar system in the same constellation");

  const primeInfo = keyValEntriesToMap(
    allianceRegistry.Handle_GetPrimeTimeInfo([], session),
  );
  assert.equal(primeInfo.get("currentPrimeHour"), 21);
  assert.equal(primeInfo.get("newPrimeHour"), 21);

  const capitalInfo = keyValEntriesToMap(
    allianceRegistry.Handle_GetCapitalSystemInfo([], session),
  );
  assert.equal(capitalInfo.get("currentCapitalSystem"), SOLAR_SYSTEM_ID);
  assert.equal(capitalInfo.get("newCapitalSystem"), null);

  const allianceStructures = allianceRegistry.Handle_GetAllianceSovereigntyStructuresInfo(
    [],
    session,
  );
  assert.equal(allianceStructures.length, 3);
  assert.equal(allianceStructures[0].items.length, 1);
  assert.equal(allianceStructures[1].items.length, 1);
  assert.equal(allianceStructures[2].items.length, 2);
  const tcuRow = keyValEntriesToMap(allianceStructures[0].items[0]);
  const ihubRow = keyValEntriesToMap(allianceStructures[1].items[0]);
  assert.equal(tcuRow.get("structureID"), IHUB_ID);
  assert.equal(ihubRow.get("structureID"), IHUB_ID);
  assertApproxEqual(tcuRow.get("vulnerabilityOccupancyLevel"), 1.4);
  assertApproxEqual(ihubRow.get("campaignOccupancyLevel"), 3.4);
  const cachedAllianceRows = getAllianceSovereigntyRows(ALLIANCE_ID);
  assert.equal(cachedAllianceRows.tcuRows[0].structureID, IHUB_ID);
  assert.equal(cachedAllianceRows.iHubRows[0].structureID, IHUB_ID);

  const allAllianceSystems = stationSvc.Handle_GetAllianceSystems([], session);
  assert.equal(allAllianceSystems.type, "list");
  assert.equal(allAllianceSystems.items.length, 1);
  const firstAllianceSystem = keyValEntriesToMap(allAllianceSystems.items[0]);
  assert.equal(firstAllianceSystem.get("solarSystemID"), SOLAR_SYSTEM_ID);
  assert.equal(firstAllianceSystem.get("allianceID"), ALLIANCE_ID);

  const allianceOnlySystems = stationSvc.Handle_GetSystemsForAlliance(
    [ALLIANCE_ID],
    session,
  );
  assert.equal(allianceOnlySystems.items.length, 1);

  const devIndices = dictEntriesToMap(
    devIndexManager.Handle_GetDevelopmentIndicesForSystem([SOLAR_SYSTEM_ID], session),
  );
  const militaryIndex = keyValEntriesToMap(devIndices.get(1583));
  const industrialIndex = keyValEntriesToMap(devIndices.get(1584));
  assert.equal(militaryIndex.get("points"), 1500);
  assert.equal(militaryIndex.get("increasing"), true);
  assert.equal(industrialIndex.get("points"), 900);
  assert.equal(industrialIndex.get("increasing"), false);

  const allDevIndices = devIndexManager.Handle_GetAllDevelopmentIndices([], session);
  assert.equal(allDevIndices.type, "list");
  assert.equal(allDevIndices.items.length, 1);
  const allDevIndexRow = keyValEntriesToMap(allDevIndices.items[0]);
  assert.equal(allDevIndexRow.get("solarSystemID"), SOLAR_SYSTEM_ID);
  assert.equal(allDevIndexRow.get("claimedFor"), 7);

  const systemCurrentSovPayload = mapService.Handle_GetCurrentSovData(
    [SOLAR_SYSTEM_ID],
    session,
  );
  assert.deepEqual(rowsetHeader(systemCurrentSovPayload), [
    "locationID",
    "solarSystemID",
    "constellationID",
    "regionID",
    "ownerID",
    "allianceID",
    "corporationID",
    "claimStructureID",
    "infrastructureHubID",
    "stationID",
    "claimTime",
  ]);
  const systemCurrentSovData = rowsetToObjects(systemCurrentSovPayload);
  assert.equal(systemCurrentSovData.length, 1);
  assert.equal(systemCurrentSovData[0].get("locationID"), SOLAR_SYSTEM_ID);
  assert.equal(systemCurrentSovData[0].get("ownerID"), ALLIANCE_ID);
  assert.equal(systemCurrentSovData[0].get("claimStructureID"), TCU_ID);

  const constellationCurrentSovData = rowsetToObjects(
    mapService.Handle_GetCurrentSovData([staticSystem.constellationID], session),
  );
  const constellationRowsByLocationID = new Map(
    constellationCurrentSovData.map((row) => [Number(row.get("locationID")), row]),
  );
  assert.ok(constellationRowsByLocationID.has(SOLAR_SYSTEM_ID));
  assert.ok(constellationRowsByLocationID.has(Number(constellationPeer.solarSystemID)));
  assert.equal(
    constellationRowsByLocationID.get(SOLAR_SYSTEM_ID).get("constellationID"),
    Number(staticSystem.constellationID),
  );
  assert.equal(
    constellationRowsByLocationID.get(Number(constellationPeer.solarSystemID)).get("ownerID"),
    null,
  );

  const recentSovActivityPayload = mapService.Handle_GetRecentSovActivity([], session);
  assert.deepEqual(rowsetHeader(recentSovActivityPayload), [
    "solarSystemID",
    "ownerID",
    "oldOwnerID",
    "stationID",
    "changeTime",
  ]);
  const recentSovActivity = rowsetToObjects(recentSovActivityPayload);
  assert.equal(recentSovActivity.length, 0);

  const sovClaimInfo = sovMgr.Handle_GetSystemSovereigntyInfo([SOLAR_SYSTEM_ID], session);
  assert.equal(sovClaimInfo && sovClaimInfo.type, "objectex1");
  assert.equal(sovClaimInfo.header[0].value, "sovereignty.data_types.SovClaimInfo");

  const sovHubInfo = sovMgr.Handle_GetInfrastructureHubInfo([SOLAR_SYSTEM_ID], session);
  assert.equal(sovHubInfo && sovHubInfo.type, "objectex1");
  assert.equal(sovHubInfo.header[0].value, "sovereignty.data_types.SovHubInfo");

  const remoteStructures = sovMgr.Handle_GetSovStructuresInfoForSolarSystem(
    [SOLAR_SYSTEM_ID],
    session,
  );
  assert.equal(remoteStructures.type, "list");
  assert.equal(remoteStructures.items.length, 2);
  const firstStructure = keyValEntriesToMap(remoteStructures.items[0]);
  const secondStructure = keyValEntriesToMap(remoteStructures.items[1]);
  assert.equal(firstStructure.get("solarSystemID"), SOLAR_SYSTEM_ID);
  assertApproxEqual(firstStructure.get("defenseMultiplier"), 1.4);
  assertApproxEqual(secondStructure.get("defenseMultiplier"), 3.4);
  assert.equal(secondStructure.get("isCapital"), true);

  const localStructures = sovMgr.Handle_GetSovStructuresInfoForLocalSolarSystem([], session);
  assert.equal(localStructures.items.length, 2);

  assert.equal(
    sovMgr.Handle_GetSovHubFuelAccessGroup([SOLAR_SYSTEM_ID], session),
    FUEL_ACCESS_GROUP_ID,
  );
});

test("seeded recent sovereignty activity is returned as a sorted classic rowset", (t) => {
  const tableSnapshot = cloneValue(database.read("sovereignty", "/").data || {});
  t.after(() => {
    database.write("sovereignty", "/", cloneValue(tableSnapshot));
    resetSovereigntyStateForTests();
  });

  writeCleanSovereigntyTable(tableSnapshot);
  resetSovereigntyStateForTests();

  const olderChangeTime = (currentFileTime() - 7200000000n).toString();
  const newerChangeTime = currentFileTime().toString();

  upsertSystemState(SOLAR_SYSTEM_ID, {
    allianceID: ALLIANCE_ID,
    corporationID: CORPORATION_ID,
    recentActivity: [
      {
        solarSystemID: SOLAR_SYSTEM_ID,
        ownerID: ALLIANCE_ID,
        oldOwnerID: null,
        stationID: null,
        changeTime: olderChangeTime,
      },
      {
        solarSystemID: SOLAR_SYSTEM_ID,
        ownerID: null,
        oldOwnerID: ALLIANCE_ID,
        stationID: null,
        changeTime: newerChangeTime,
      },
    ],
  });

  const mapService = new MapService();
  const recentActivityPayload = mapService.Handle_GetRecentSovActivity([], {});
  assert.deepEqual(rowsetHeader(recentActivityPayload), [
    "solarSystemID",
    "ownerID",
    "oldOwnerID",
    "stationID",
    "changeTime",
  ]);
  const rows = rowsetToObjects(recentActivityPayload);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].get("oldOwnerID"), ALLIANCE_ID);
  assert.equal(rows[0].get("ownerID"), null);
  assert.equal(rows[1].get("ownerID"), ALLIANCE_ID);
  assert.equal(rows[1].get("stationID"), null);
});

test("prime time changes stay pending and roll into the current hour after the cutoff", (t) => {
  const tableSnapshot = cloneValue(database.read("sovereignty", "/").data || {});
  t.after(() => {
    database.write("sovereignty", "/", cloneValue(tableSnapshot));
    resetSovereigntyStateForTests();
  });

  writeCleanSovereigntyTable(tableSnapshot);
  resetSovereigntyStateForTests();

  upsertAllianceState(ALLIANCE_ID, {
    primeInfo: {
      currentPrimeHour: 6,
      newPrimeHour: 6,
      newPrimeHourValidAfter: "0",
    },
  });

  const pendingPrimeInfo = setAlliancePrimeHour(ALLIANCE_ID, 11);
  assert.equal(pendingPrimeInfo.currentPrimeHour, 6);
  assert.equal(pendingPrimeInfo.newPrimeHour, 11);
  assert.ok(BigInt(pendingPrimeInfo.newPrimeHourValidAfter) > currentFileTime());

  upsertAllianceState(ALLIANCE_ID, {
    primeInfo: {
      currentPrimeHour: 6,
      newPrimeHour: 11,
      newPrimeHourValidAfter: (currentFileTime() - 10000n).toString(),
    },
  });

  const appliedPrimeInfo = getAlliancePrimeInfo(ALLIANCE_ID);
  assert.equal(appliedPrimeInfo.currentPrimeHour, 11);
  assert.equal(appliedPrimeInfo.newPrimeHour, 11);
  assert.equal(appliedPrimeInfo.newPrimeHourValidAfter, "0");
});

test("capital system changes stay pending until the cutoff and can be cancelled", (t) => {
  const tableSnapshot = cloneValue(database.read("sovereignty", "/").data || {});
  t.after(() => {
    database.write("sovereignty", "/", cloneValue(tableSnapshot));
    resetSovereigntyStateForTests();
  });

  writeCleanSovereigntyTable(tableSnapshot);
  resetSovereigntyStateForTests();

  const targetCapitalSystemID = Number(
    worldData
      .getSolarSystems()
      .find((system) => Number(system.solarSystemID) !== SOLAR_SYSTEM_ID)
      .solarSystemID,
  );

  upsertAllianceState(ALLIANCE_ID, {
    capitalInfo: {
      currentCapitalSystem: SOLAR_SYSTEM_ID,
      newCapitalSystem: null,
      newCapitalSystemValidAfter: "0",
    },
  });

  const pendingCapitalInfo = setAllianceCapitalSystem(
    ALLIANCE_ID,
    targetCapitalSystemID,
  );
  assert.equal(pendingCapitalInfo.currentCapitalSystem, SOLAR_SYSTEM_ID);
  assert.equal(pendingCapitalInfo.newCapitalSystem, targetCapitalSystemID);
  assert.ok(BigInt(pendingCapitalInfo.newCapitalSystemValidAfter) > currentFileTime());

  const cancelledCapitalInfo = cancelAllianceCapitalTransition(ALLIANCE_ID);
  assert.equal(cancelledCapitalInfo.currentCapitalSystem, SOLAR_SYSTEM_ID);
  assert.equal(cancelledCapitalInfo.newCapitalSystem, null);
  assert.equal(cancelledCapitalInfo.newCapitalSystemValidAfter, "0");

  upsertAllianceState(ALLIANCE_ID, {
    capitalInfo: {
      currentCapitalSystem: SOLAR_SYSTEM_ID,
      newCapitalSystem: targetCapitalSystemID,
      newCapitalSystemValidAfter: (currentFileTime() - 10000n).toString(),
    },
  });

  const appliedCapitalInfo = getAllianceCapitalInfo(ALLIANCE_ID);
  assert.equal(appliedCapitalInfo.currentCapitalSystem, targetCapitalSystemID);
  assert.equal(appliedCapitalInfo.newCapitalSystem, null);
  assert.equal(appliedCapitalInfo.newCapitalSystemValidAfter, "0");
});

test("classic structure snapshots derive vulnerability windows from prime time and expose cached indexes", (t) => {
  const tableSnapshot = cloneValue(database.read("sovereignty", "/").data || {});
  t.after(() => {
    database.write("sovereignty", "/", cloneValue(tableSnapshot));
    resetSovereigntyStateForTests();
  });

  writeCleanSovereigntyTable(tableSnapshot);
  resetSovereigntyStateForTests();

  setAlliancePrimeHour(ALLIANCE_ID, 19);
  upsertSystemState(
    SOLAR_SYSTEM_ID,
    {
      allianceID: ALLIANCE_ID,
      corporationID: CORPORATION_ID,
      claimStructureID: TCU_ID,
      infrastructureHubID: IHUB_ID,
      structures: [
        {
          itemID: TCU_ID,
          typeID: 32226,
          ownerID: CORPORATION_ID,
          corporationID: CORPORATION_ID,
          allianceID: ALLIANCE_ID,
        },
      ],
    },
    { suppressNotifications: true },
  );

  const structures = listSovStructuresForSystem(SOLAR_SYSTEM_ID);
  assert.equal(structures.length, 1);
  assert.equal(structures[0].vulnerableStartTime !== "0", true);
  assert.equal(structures[0].vulnerableEndTime !== "0", true);
  assert.equal(
    BigInt(structures[0].vulnerableEndTime) > BigInt(structures[0].vulnerableStartTime),
    true,
  );

  const allianceRows = getAllianceSovereigntyRows(ALLIANCE_ID);
  assert.equal(allianceRows.tcuRows.length, 1);
  assert.equal(allianceRows.tcuRows[0].structureID, TCU_ID);
  assert.equal(allianceRows.tcuRows[0].vulnerableStartTime !== "0", true);
  assert.equal(allianceRows.tcuRows[0].vulnerableEndTime !== "0", true);

  const debugSnapshot = getSovereigntyDebugSnapshot();
  assert.equal(debugSnapshot.cachedStructureSystemCount, 1);
  assert.equal(debugSnapshot.cachedClaimCount, 1);
  assert.equal(debugSnapshot.cachedAllianceRowCount >= 1, true);
  assert.equal(Number(debugSnapshot.nextInvalidationAtMs) > Date.now(), true);
});

test("campaign score updates emit client-shaped structure change notifications instead of broad refreshes", (t) => {
  const tableSnapshot = cloneValue(database.read("sovereignty", "/").data || {});
  const liveSession = {
    characterID: 140000099,
    allianceID: ALLIANCE_ID,
    allianceid: ALLIANCE_ID,
    corporationID: CORPORATION_ID,
    corpid: CORPORATION_ID,
    solarsystemid2: SOLAR_SYSTEM_ID,
    solarsystemid: SOLAR_SYSTEM_ID,
    socket: { destroyed: false },
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
  };
  sessionRegistry.register(liveSession);

  t.after(() => {
    sessionRegistry.unregister(liveSession);
    database.write("sovereignty", "/", cloneValue(tableSnapshot));
    resetSovereigntyStateForTests();
  });

  writeCleanSovereigntyTable(tableSnapshot);
  resetSovereigntyStateForTests();

  upsertSystemState(
    SOLAR_SYSTEM_ID,
    {
      allianceID: ALLIANCE_ID,
      corporationID: CORPORATION_ID,
      structures: [
        {
          itemID: IHUB_ID,
          typeID: 32458,
          ownerID: CORPORATION_ID,
          corporationID: CORPORATION_ID,
          allianceID: ALLIANCE_ID,
          campaignEventType: 7,
          campaignStartTime: currentFileTime().toString(),
          campaignScoresByTeam: {
            1: 10,
          },
        },
      ],
    },
    { suppressNotifications: true },
  );

  setStructureCampaignScores(SOLAR_SYSTEM_ID, IHUB_ID, { 1: 77, 2: 21 });

  const updateNotification = liveSession.notifications.find(
    (entry) => entry.name === "OnSolarSystemSovStructuresUpdated",
  );
  assert.ok(updateNotification);
  assert.equal(updateNotification.idType, "solarsystemid2");
  assert.equal(updateNotification.payload[0], SOLAR_SYSTEM_ID);
  assert.equal(updateNotification.payload.length, 3);

  const changesByStructure = dictEntriesToMap(updateNotification.payload[2]);
  const changeSet = pythonSetPayloadToValues(changesByStructure.get(IHUB_ID));
  assert.deepEqual(changeSet, [STRUCTURE_SCORE_UPDATED]);

  const updatedStructure = listSovStructuresForSystem(SOLAR_SYSTEM_ID).find(
    (entry) => entry.itemID === IHUB_ID,
  );
  assert.deepEqual(updatedStructure.campaignScoresByTeam, {
    1: 77,
    2: 21,
  });
});
