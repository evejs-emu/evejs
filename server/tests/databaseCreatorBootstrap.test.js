const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createDatabase,
  REQUIRED_TABLES,
} = require(path.join(
  __dirname,
  "..",
  "..",
  "tools",
  "DatabaseCreator",
  "database-creator.js",
));

function writeJsonl(dir, fileName, rows) {
  fs.writeFileSync(
    path.join(dir, fileName),
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  );
}

function buildMiniSde(dir) {
  writeJsonl(dir, "_sde.jsonl", [
    { _key: "sde", buildNumber: 3396210, releaseDate: "2026-06-16T12:43:42Z" },
  ]);
  writeJsonl(dir, "categories.jsonl", [
    { _key: 2, name: { en: "Celestial" } },
    { _key: 6, name: { en: "Ship" } },
    { _key: 9, name: { en: "Blueprint" } },
    { _key: 16, name: { en: "Skill" } },
    { _key: 25, name: { en: "Asteroid" } },
  ]);
  writeJsonl(dir, "groups.jsonl", [
    { _key: 9, categoryID: 2, name: { en: "Asteroid Belt" } },
    { _key: 10, categoryID: 2, name: { en: "Stargate" } },
    { _key: 15, categoryID: 2, name: { en: "Station" } },
    { _key: 25, categoryID: 6, name: { en: "Frigate" } },
    { _key: 268, categoryID: 16, name: { en: "Spaceship Command" } },
    { _key: 450, categoryID: 25, name: { en: "Veldspar" } },
    { _key: 104, categoryID: 9, name: { en: "Blueprint" } },
    { _key: 18, categoryID: 2, name: { en: "Planet" } },
  ]);
  writeJsonl(dir, "types.jsonl", [
    { _key: 15, groupID: 9, name: { en: "Asteroid Belt" }, published: false, radius: 1 },
    { _key: 16, groupID: 10, name: { en: "Stargate" }, published: false, radius: 5000 },
    { _key: 670, groupID: 25, name: { en: "Capsule" }, published: true, radius: 20 },
    { _key: 3300, groupID: 268, name: { en: "Gunnery" }, published: true },
    { _key: 1230, groupID: 450, name: { en: "Veldspar" }, published: true, portionSize: 100 },
    { _key: 34, groupID: 450, name: { en: "Tritanium" }, published: true, portionSize: 1 },
    { _key: 681, groupID: 104, name: { en: "Test Blueprint" }, published: true },
    { _key: 1529, groupID: 15, name: { en: "Station" }, published: false, radius: 30000 },
    { _key: 11, groupID: 18, name: { en: "Planet" }, published: false, radius: 1000000 },
    { _key: 52568, groupID: 450, name: { en: "HyperCore" }, published: true },
    { _key: 9854, groupID: 25, name: { en: "Polaris Inspector Frigate" }, published: false, radius: 40 },
    { _key: 40519, groupID: 450, name: { en: "Skill Extractor" }, published: true },
  ]);
  writeJsonl(dir, "dogmaAttributes.jsonl", [{ _key: 37, name: "maxVelocity" }]);
  writeJsonl(dir, "dogmaEffects.jsonl", [{ _key: 1, effectName: "online" }]);
  writeJsonl(dir, "typeDogma.jsonl", [
    { _key: 670, dogmaAttributes: [{ attributeID: 37, value: 125 }], dogmaEffects: [] },
  ]);
  writeJsonl(dir, "mapSolarSystems.jsonl", [
    {
      _key: 30000142,
      name: { en: "Jita" },
      constellationID: 20000020,
      regionID: 10000002,
      position: { x: 1, y: 2, z: 3 },
      securityStatus: 0.945,
      securityClass: "B",
      radius: 100,
    },
  ]);
  writeJsonl(dir, "mapStargates.jsonl", [
    {
      _key: 50000001,
      typeID: 16,
      solarSystemID: 30000142,
      position: { x: 10, y: 20, z: 30 },
      destination: { solarSystemID: 30000142, stargateID: 50000001 },
    },
  ]);
  writeJsonl(dir, "mapPlanets.jsonl", [
    { _key: 40000001, typeID: 11, solarSystemID: 30000142, position: { x: 1, y: 0, z: 0 }, radius: 1000 },
  ]);
  writeJsonl(dir, "mapMoons.jsonl", []);
  writeJsonl(dir, "mapAsteroidBelts.jsonl", [
    { _key: 40000002, typeID: 15, solarSystemID: 30000142, position: { x: 2, y: 0, z: 0 }, radius: 1 },
  ]);
  writeJsonl(dir, "npcStations.jsonl", [
    { _key: 60003760, typeID: 1529, ownerID: 1000044, operationID: 1, solarSystemID: 30000142, position: { x: 0, y: 0, z: 0 } },
  ]);
  writeJsonl(dir, "blueprints.jsonl", [
    { _key: 681, maxProductionLimit: 1, activities: { manufacturing: { products: [{ typeID: 670, quantity: 1 }], materials: [] } } },
  ]);
  writeJsonl(dir, "races.jsonl", [{ _key: 1, name: { en: "Caldari" } }]);
  writeJsonl(dir, "bloodlines.jsonl", [{ _key: 1, raceID: 1, name: { en: "Deteis" } }]);
  writeJsonl(dir, "factions.jsonl", [{ _key: 500001, name: { en: "Caldari State" } }]);
  writeJsonl(dir, "typeMaterials.jsonl", [{ _key: 1230, materials: [{ materialTypeID: 34, quantity: 400 }] }]);
  writeJsonl(dir, "dbuffCollections.jsonl", []);
  writeJsonl(dir, "typeLists.jsonl", []);
  writeJsonl(dir, "planetResources.jsonl", []);
  writeJsonl(dir, "sovereigntyUpgrades.jsonl", []);
}

test("DatabaseCreator generates local tables, accounts, GM Elysian, and HyperNet seed support", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-dbcreator-"));
  const sdeDir = path.join(root, "sde");
  const outDir = path.join(root, "_local", "newDatabase", "data");
  fs.mkdirSync(sdeDir, { recursive: true });
  buildMiniSde(sdeDir);

  const manifest = await createDatabase({
    sdeDir,
    outDir,
    build: 3396210,
    sdeUrl: "https://example.invalid/sde.zip",
    force: true,
  });

  assert.equal(manifest.build, 3396210);
  for (const table of REQUIRED_TABLES) {
    const tableDir = path.join(outDir, table);
    assert.equal(fs.existsSync(tableDir), true, table);
  }
  assert.equal(fs.existsSync(path.join(outDir, "authoredSpaceProps", "Manifest.json")), true);

  const accounts = JSON.parse(fs.readFileSync(path.join(outDir, "accounts", "data.json"), "utf8"));
  const characters = JSON.parse(fs.readFileSync(path.join(outDir, "characters", "data.json"), "utf8"));
  const items = JSON.parse(fs.readFileSync(path.join(outDir, "items", "data.json"), "utf8"));
  const itemTypes = JSON.parse(fs.readFileSync(path.join(outDir, "itemTypes", "data.json"), "utf8"));

  assert.equal(accounts.test.id, 1);
  assert.equal(accounts.test2.id, 2);
  assert.equal(characters["140000004"].characterName, "GM Elysian");
  assert.equal(characters["140000004"].homeStationID, 60003760);
  assert.ok(Object.values(items).some((item) => item.ownerID === 140000004 && item.typeID === 52568));
  assert.equal(itemTypes.types.some((type) => type.typeID === 670), true);
});
