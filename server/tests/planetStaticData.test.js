const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const planetStaticData = require(path.join(
  repoRoot,
  "server/src/services/planet/planetStaticData",
));

test("planet static data exposes the hardcoded planet-type resource map", () => {
  assert.deepEqual(
    planetStaticData.getPlanetResourceTypeIDs(11).sort((left, right) => left - right),
    [2073, 2268, 2287, 2288, 2305],
  );
  assert.deepEqual(
    planetStaticData.getPlanetResourceTypeIDs(2016).sort((left, right) => left - right),
    [2073, 2267, 2268, 2270, 2288],
  );
});

test("planet schematics are available by id, output type, and processor pin", () => {
  const industrialFibers = planetStaticData.getSchematicByID(135);
  assert.equal(industrialFibers.name, "Industrial Fibers");
  assert.equal(industrialFibers.cycleTime, 1800);
  assert.deepEqual(industrialFibers.inputs, [{ typeID: 2305, quantity: 3000 }]);
  assert.deepEqual(industrialFibers.outputs, [{ typeID: 2397, quantity: 20 }]);
  assert.ok(industrialFibers.pinTypeIDs.includes(2481));

  const coolantSchematics = planetStaticData.getSchematicsByOutputTypeID(9832);
  assert.equal(coolantSchematics.length, 1);
  assert.equal(coolantSchematics[0].schematicID, 66);

  const temperateBasicSchematics = planetStaticData.getSchematicsForPinType(2481);
  assert.ok(
    temperateBasicSchematics.some((schematic) => schematic.schematicID === 135),
  );
});

test("planet static data classifies PI structures and commodities", () => {
  const basicProcessor = planetStaticData.getPITypeInfo(2473);
  assert.equal(basicProcessor.pinEntityType, "process");
  assert.equal(basicProcessor.processorTier, "basic");
  assert.equal(basicProcessor.planetRestrictionTypeID, 2016);

  const launchpad = planetStaticData.getPITypeInfo(2256);
  assert.equal(launchpad.pinEntityType, "spaceport");
  assert.equal(launchpad.capacity, 10000);
  assert.equal(
    planetStaticData.getTypeAttribute(2256, planetStaticData.ATTRIBUTE.IMPORT_TAX),
    0.5,
  );

  assert.equal(planetStaticData.getCommodityTier(2268), 0);
  assert.equal(planetStaticData.getCommodityTier(2397), 1);
  assert.equal(planetStaticData.getCommodityTier(9832), 2);
  assert.equal(planetStaticData.getCommodityTier(2344), 3);
  assert.equal(planetStaticData.getCommodityTier(2867), 4);
});

test("planet static data exposes client parity dogma helper values", () => {
  assert.deepEqual(planetStaticData.getCPUAndPowerForPinType(2254), {
    cpuUsage: 0,
    powerUsage: 0,
    cpuOutput: 1675,
    powerOutput: 6000,
  });

  assert.deepEqual(planetStaticData.getUsageParametersForLinkType(2280), {
    basePowerUsage: 10,
    baseCpuUsage: 15,
    powerUsagePerKm: 0.15,
    cpuUsagePerKm: 0.2,
    powerUsageLevelModifier: 1.2,
    cpuUsageLevelModifier: 1.4,
    logisticalCapacity: 1250,
  });

  assert.equal(planetStaticData.getCommandCenterInfo(5).cpuOutput, 25415);
  assert.equal(planetStaticData.getCommandCenterUpgradeCost(0, 1), 580000);
});
