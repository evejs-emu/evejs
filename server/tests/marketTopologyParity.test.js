const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const worldData = require(path.join(repoRoot, "server/src/space/worldData"));
const {
  RANGE_REGION,
  RANGE_SOLAR_SYSTEM,
  RANGE_STATION,
  getStationSolarSystemID,
  isSellOrderInRange,
} = require(path.join(repoRoot, "server/src/services/market/marketTopology"));

function getMarketTopologyFixture() {
  const systems = worldData.getSolarSystems();
  let primarySystem = null;
  let primaryStations = null;

  for (const solarSystem of systems) {
    const stations = worldData.getStationsForSystem(solarSystem.solarSystemID);
    if (stations.length >= 2) {
      primarySystem = solarSystem;
      primaryStations = stations;
      break;
    }
  }

  assert.ok(primarySystem, "expected a system with at least two stations");
  assert.ok(primaryStations && primaryStations.length >= 2);

  const buyerStation = primaryStations[0];
  const sameSystemStation = primaryStations[1];
  const differentSystemStation = systems
    .filter(
      (solarSystem) =>
        solarSystem.solarSystemID !== primarySystem.solarSystemID &&
        solarSystem.regionID === primarySystem.regionID,
    )
    .map((solarSystem) => worldData.getStationsForSystem(solarSystem.solarSystemID)[0])
    .find(Boolean);

  assert.ok(
    differentSystemStation,
    "expected a second station in the same region but a different solar system",
  );

  return {
    buyerStation,
    sameSystemStation,
    differentSystemStation,
  };
}

test("station-range immediate buys only match sells from the selected station", () => {
  const { buyerStation, sameSystemStation, differentSystemStation } = getMarketTopologyFixture();
  const buyerSolarSystemID = getStationSolarSystemID(buyerStation.stationID);

  assert.equal(
    isSellOrderInRange(
      {
        station_id: buyerStation.stationID,
        solar_system_id: buyerSolarSystemID,
      },
      buyerStation.stationID,
      buyerSolarSystemID,
      RANGE_STATION,
    ),
    true,
  );

  assert.equal(
    isSellOrderInRange(
      {
        station_id: sameSystemStation.stationID,
        solar_system_id: getStationSolarSystemID(sameSystemStation.stationID),
      },
      buyerStation.stationID,
      buyerSolarSystemID,
      RANGE_STATION,
    ),
    false,
  );

  assert.equal(
    isSellOrderInRange(
      {
        station_id: differentSystemStation.stationID,
        solar_system_id: getStationSolarSystemID(differentSystemStation.stationID),
      },
      buyerStation.stationID,
      buyerSolarSystemID,
      RANGE_STATION,
    ),
    false,
  );
});

test("system-range immediate buys can match same-system sells but not other systems", () => {
  const { buyerStation, sameSystemStation, differentSystemStation } = getMarketTopologyFixture();
  const buyerSolarSystemID = getStationSolarSystemID(buyerStation.stationID);

  assert.equal(
    isSellOrderInRange(
      {
        station_id: sameSystemStation.stationID,
        solar_system_id: getStationSolarSystemID(sameSystemStation.stationID),
      },
      buyerStation.stationID,
      buyerSolarSystemID,
      RANGE_SOLAR_SYSTEM,
    ),
    true,
  );

  assert.equal(
    isSellOrderInRange(
      {
        station_id: differentSystemStation.stationID,
        solar_system_id: getStationSolarSystemID(differentSystemStation.stationID),
      },
      buyerStation.stationID,
      buyerSolarSystemID,
      RANGE_SOLAR_SYSTEM,
    ),
    false,
  );
});

test("region-range immediate buys still allow regional matching", () => {
  const { buyerStation, differentSystemStation } = getMarketTopologyFixture();
  const buyerSolarSystemID = getStationSolarSystemID(buyerStation.stationID);

  assert.equal(
    isSellOrderInRange(
      {
        station_id: differentSystemStation.stationID,
        solar_system_id: getStationSolarSystemID(differentSystemStation.stationID),
        region_id: differentSystemStation.regionID,
      },
      buyerStation.stationID,
      buyerSolarSystemID,
      RANGE_REGION,
    ),
    true,
  );
});
