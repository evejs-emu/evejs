const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const ConfigService = require(path.join(
  repoRoot,
  "server/src/services/config/configService",
));
const CorpService = require(path.join(
  repoRoot,
  "server/src/services/corporation/corpService",
));
const {
  getCorporationStationSolarSystems,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/corporationState",
));
const {
  extractList,
  extractDictEntries,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/serviceHelpers",
));

const NPC_CORPORATION_ID = 1000044;

function buildExpectedStationSystems(ownerID) {
  const stationsResult = database.read("stations", "/");
  assert.equal(stationsResult.success, true, "Expected stations table to load");

  const stations = Array.isArray(stationsResult.data && stationsResult.data.stations)
    ? stationsResult.data.stations
    : [];
  const stationCountBySystemID = new Map();

  for (const stationRecord of stations) {
    const stationOwnerID = Number(
      stationRecord && (stationRecord.corporationID || stationRecord.ownerID),
    ) || 0;
    if (stationOwnerID !== ownerID) {
      continue;
    }

    const solarSystemID = Number(stationRecord && stationRecord.solarSystemID) || 0;
    if (!solarSystemID) {
      continue;
    }

    stationCountBySystemID.set(
      solarSystemID,
      (stationCountBySystemID.get(solarSystemID) || 0) + 1,
    );
  }

  return [...stationCountBySystemID.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([solarSystemID, stationCount]) => ({
      ownerID,
      solarSystemID,
      stationCount,
    }));
}

function unmarshalKeyValRecord(entry) {
  assert.equal(entry && entry.type, "object");
  assert.equal(entry && entry.name, "util.KeyVal");
  return Object.fromEntries(extractDictEntries(entry.args));
}

test("NPC corporation station solar systems retain per-system counts", () => {
  const expected = buildExpectedStationSystems(NPC_CORPORATION_ID);
  assert.ok(
    expected.length > 0,
    `Expected NPC corporation ${NPC_CORPORATION_ID} to own at least one station`,
  );

  assert.deepEqual(
    getCorporationStationSolarSystems(NPC_CORPORATION_ID),
    expected,
  );
});

test("config service returns CCP-style station system records for corporation info windows", () => {
  const expected = buildExpectedStationSystems(NPC_CORPORATION_ID);
  const service = new ConfigService();
  const payload = service.Handle_GetStationSolarSystemsByOwner([NPC_CORPORATION_ID]);

  assert.equal(payload && payload.type, "list");
  assert.deepEqual(
    extractList(payload).map(unmarshalKeyValRecord),
    expected,
  );
});

test("corporation service returns market-activity rows for NPC corp info windows", () => {
  const service = new CorpService();
  const payload = service.Handle_GetCorpInfo([NPC_CORPORATION_ID]);

  assert.equal(payload && payload.type, "list");
  assert.deepEqual(extractList(payload), []);
});
