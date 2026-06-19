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
    { _key: 3, name: { en: "Station" } },
    { _key: 6, name: { en: "Ship" } },
    { _key: 9, name: { en: "Blueprint" } },
    { _key: 16, name: { en: "Skill" } },
    { _key: 25, name: { en: "Asteroid" } },
    { _key: 39, name: { en: "Infrastructure Upgrades" } },
    { _key: 65, name: { en: "Structure" } },
    { _key: 66, name: { en: "Structure Module" } },
  ]);
  writeJsonl(dir, "groups.jsonl", [
    { _key: 6, categoryID: 2, name: { en: "Sun" } },
    { _key: 7, categoryID: 2, name: { en: "Planet" } },
    { _key: 8, categoryID: 2, name: { en: "Moon" } },
    { _key: 9, categoryID: 2, name: { en: "Asteroid Belt" } },
    { _key: 10, categoryID: 2, name: { en: "Stargate" } },
    { _key: 15, categoryID: 3, name: { en: "Station" } },
    { _key: 25, categoryID: 6, name: { en: "Frigate" } },
    { _key: 268, categoryID: 16, name: { en: "Spaceship Command" } },
    { _key: 450, categoryID: 25, name: { en: "Veldspar" } },
    { _key: 104, categoryID: 9, name: { en: "Blueprint" } },
    { _key: 4772, categoryID: 39, name: { en: "Infrastructure Upgrade" } },
    { _key: 1404, categoryID: 65, name: { en: "Engineering Complex" } },
    { _key: 1941, categoryID: 66, name: { en: "Structure Resource Rig M - Asteroid Ore Reprocessing" } },
    { _key: 1950, categoryID: 91, name: { en: "Permanent SKIN" }, published: true },
    { _key: 1951, categoryID: 91, name: { en: "Volatile SKIN" }, published: true },
  ]);
  writeJsonl(dir, "types.jsonl", [
    { _key: 0, groupID: 0, name: { en: "#System" }, published: false },
    { _key: 45041, groupID: 6, name: { en: "Sun K3 (Yellow Small)" }, published: false, radius: 10000 },
    { _key: 11, groupID: 7, name: { en: "Planet" }, published: false, radius: 1000000 },
    { _key: 14, groupID: 8, name: { en: "Moon" }, published: false, radius: 10000 },
    { _key: 15, groupID: 9, name: { en: "Asteroid Belt" }, published: false, radius: 1 },
    { _key: 16, groupID: 10, name: { en: "Stargate" }, published: false, radius: 5000 },
    { _key: 588, groupID: 25, name: { en: "Reaper" }, published: true, radius: 39 },
    { _key: 596, groupID: 25, name: { en: "Impairor" }, published: true, radius: 39 },
    { _key: 601, groupID: 25, name: { en: "Ibis" }, published: true, radius: 39 },
    { _key: 606, groupID: 25, name: { en: "Velator" }, published: true, radius: 39 },
    { _key: 670, groupID: 25, name: { en: "Capsule" }, published: true, radius: 20 },
    { _key: 3300, groupID: 268, name: { en: "Gunnery" }, published: true },
    { _key: 1957, groupID: 450, name: { en: "Multispectral ECM I" }, published: true },
    { _key: 3634, groupID: 450, name: { en: "Civilian Gatling Pulse Laser" }, published: true },
    { _key: 3636, groupID: 450, name: { en: "Civilian Gatling Autocannon" }, published: true },
    { _key: 3638, groupID: 450, name: { en: "Civilian Gatling Railgun" }, published: true },
    { _key: 3651, groupID: 450, name: { en: "Civilian Miner" }, published: true },
    {
      _key: 1230,
      groupID: 450,
      marketGroupID: 100,
      name: { en: "Veldspar" },
      published: true,
      portionSize: 100,
    },
    {
      _key: 62516,
      groupID: 450,
      marketGroupID: 100,
      name: { en: "Compressed Veldspar" },
      published: true,
      portionSize: 100,
    },
    { _key: 90041, groupID: 450, name: { en: "Prismaticite" }, published: true, portionSize: 100 },
    { _key: 34, groupID: 450, name: { en: "Tritanium" }, published: true, portionSize: 1 },
    { _key: 681, groupID: 104, name: { en: "Test Blueprint" }, published: true },
    { _key: 1529, groupID: 15, name: { en: "Station" }, published: false, radius: 30000 },
    { _key: 52568, groupID: 450, name: { en: "HyperCore" }, published: true },
    { _key: 21857, groupID: 450, name: { en: "1MN Civilian Afterburner" }, published: true },
    { _key: 30328, groupID: 450, name: { en: "Civilian Stasis Webifier" }, published: true },
    { _key: 58745, groupID: 25, name: { en: "AIR Civilian Astero" }, published: true, radius: 100 },
    { _key: 9854, groupID: 25, name: { en: "Polaris Inspector Frigate" }, published: false, radius: 40 },
    { _key: 40519, groupID: 450, name: { en: "Skill Extractor" }, published: true },
    { _key: 91001, groupID: 1950, name: { en: "Reaper Test Pattern SKIN" }, published: true },
    { _key: 91002, groupID: 1951, name: { en: "Reaper Test Pattern SKIN (Volatile)" }, published: true },
    { _key: 35825, groupID: 1404, name: { en: "Raitaru" }, published: true, radius: 45000 },
    { _key: 46633, groupID: 1941, name: { en: "Standup M-Set Asteroid Ore Grading Processor I" }, published: true },
    { _key: 81615, groupID: 4772, name: { en: "Cynosural Navigation" }, published: true },
  ]);
  writeJsonl(dir, "dogmaAttributes.jsonl", [
    {
      _key: 37,
      attributeCategoryID: 17,
      dataType: 4,
      defaultValue: 0,
      description: "Maximum velocity of ship",
      displayName: { en: "Maximum Velocity" },
      displayWhenZero: false,
      highIsGood: true,
      iconID: 1389,
      name: "maxVelocity",
      published: true,
      stackable: false,
      unitID: 11,
    },
  ]);
  writeJsonl(dir, "dogmaEffects.jsonl", [{ _key: 1, effectName: "online" }]);
  writeJsonl(dir, "typeDogma.jsonl", [
    { _key: 670, dogmaAttributes: [{ attributeID: 37, value: 125 }], dogmaEffects: [] },
    {
      _key: 1230,
      dogmaAttributes: [
        { attributeID: 790, value: 60377 },
        { attributeID: 2711, value: 1230 },
      ],
      dogmaEffects: [],
    },
    {
      _key: 62516,
      dogmaAttributes: [
        { attributeID: 790, value: 60377 },
        { attributeID: 2711, value: 1230 },
      ],
      dogmaEffects: [],
    },
    {
      _key: 46633,
      dogmaAttributes: [
        { attributeID: 717, value: 0.51 },
        { attributeID: 1547, value: 2 },
        { attributeID: 2355, value: 1 },
        { attributeID: 2356, value: 1.06 },
        { attributeID: 2357, value: 1.12 },
      ],
      dogmaEffects: [],
    },
    {
      _key: 81615,
      dogmaAttributes: [
        { attributeID: 1615, value: 2 },
      ],
      dogmaEffects: [],
    },
  ]);
  writeJsonl(dir, "mapRegions.jsonl", [
    { _key: 10000002, name: { en: "The Forge" }, factionID: 500001 },
  ]);
  writeJsonl(dir, "mapConstellations.jsonl", [
    { _key: 20000020, name: { en: "Kimotoro" }, regionID: 10000002 },
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
      starID: 40000001,
      visualEffect: "TRIGLAVIAN_HOME",
    },
  ]);
  writeJsonl(dir, "mapStargates.jsonl", [
    {
      _key: 50000001,
      typeID: 16,
      solarSystemID: 30000142,
      position: { x: 10.1234, y: 20, z: 30 },
      destination: { solarSystemID: 30000142, stargateID: 50000001 },
    },
  ]);
  writeJsonl(dir, "mapStars.jsonl", [
    { _key: 40000001, typeID: 45041, solarSystemID: 30000142, radius: 63350000 },
  ]);
  writeJsonl(dir, "mapPlanets.jsonl", [
    {
      _key: 40000002,
      typeID: 11,
      solarSystemID: 30000142,
      orbitID: 40000001,
      celestialIndex: 4,
      position: { x: 1, y: 0, z: 0 },
      radius: 1000,
    },
  ]);
  writeJsonl(dir, "mapMoons.jsonl", [
    {
      _key: 40000003,
      typeID: 14,
      solarSystemID: 30000142,
      orbitID: 40000002,
      celestialIndex: 4,
      orbitIndex: 2,
      position: { x: 1, y: 1, z: 0 },
      radius: 500,
    },
  ]);
  writeJsonl(dir, "mapAsteroidBelts.jsonl", [
    {
      _key: 40000004,
      typeID: 15,
      solarSystemID: 30000142,
      orbitID: 40000002,
      celestialIndex: 4,
      orbitIndex: 1,
      position: { x: 2, y: 0, z: 0 },
      radius: 1,
    },
  ]);
  writeJsonl(dir, "npcCorporations.jsonl", [
    { _key: 1000044, factionID: 500001, name: { en: "Caldari Navy" } },
  ]);
  writeJsonl(dir, "stationOperations.jsonl", [
    {
      _key: 26,
      operationName: { en: "Storage" },
      services: [15, 14, 7],
      manufacturingFactor: 0.98,
      researchFactor: 0.95,
    },
  ]);
  writeJsonl(dir, "npcStations.jsonl", [
    {
      _key: 60003760,
      typeID: 1529,
      ownerID: 1000044,
      operationID: 26,
      solarSystemID: 30000142,
      orbitID: 40000003,
      position: { x: 0, y: 0, z: 0 },
      useOperationName: true,
    },
  ]);
  writeJsonl(dir, "agentTypes.jsonl", [
    { _key: 2, name: "BasicAgent" },
    { _key: 4, name: "ResearchAgent" },
  ]);
  writeJsonl(dir, "npcCharacters.jsonl", [
    {
      _key: 3008416,
      agent: { agentTypeID: 2, divisionID: 22, isLocator: false, level: 1 },
      bloodlineID: 1,
      careerID: 14,
      ceo: false,
      corporationID: 1000044,
      gender: false,
      locationID: 60003760,
      name: { en: "Antaken Kamola" },
      raceID: 1,
      schoolID: 18,
      specialityID: 15,
      uniqueName: true,
    },
    {
      _key: 3008419,
      agent: { agentTypeID: 4, divisionID: 18, isLocator: true, level: 3 },
      bloodlineID: 1,
      careerID: 17,
      ceo: false,
      corporationID: 1000044,
      gender: true,
      locationID: 60003760,
      name: { en: "Apas Atshatairos" },
      raceID: 1,
      schoolID: 19,
      specialityID: 18,
      uniqueName: true,
    },
  ]);
  writeJsonl(dir, "agentsInSpace.jsonl", [
    { _key: 3008419, dungeonID: 416, solarSystemID: 30000142, spawnPointID: 4239, typeID: 20520 },
  ]);
  writeJsonl(dir, "blueprints.jsonl", [
    { _key: 681, maxProductionLimit: 1, activities: { manufacturing: { products: [{ typeID: 670, quantity: 1 }], materials: [] } } },
  ]);
  writeJsonl(dir, "races.jsonl", [
    { _key: 1, name: { en: "Caldari" }, shipTypeID: 670, skills: [{ _key: 3300, _value: 4 }] },
    { _key: 16, name: { en: "Jove" } },
  ]);
  writeJsonl(dir, "bloodlines.jsonl", [
    { _key: 1, raceID: 1, corporationID: 1000006, name: { en: "Deteis" } },
    { _key: 9, raceID: 16, corporationID: 1000177, name: { en: "Static" } },
  ]);
  writeJsonl(dir, "factions.jsonl", [
    {
      _key: 500001,
      corporationID: 1000035,
      name: { en: "Caldari State" },
      shortDescription: { en: "Short" },
      description: { en: "Long" },
      flatLogo: "caldari_logo",
      flatLogoWithName: "caldari_logo_w_letters",
      iconID: 1439,
      militiaCorporationID: 1000180,
      solarSystemID: 30000145,
      sizeFactor: 5,
      uniqueName: true,
      memberRaces: [1],
    },
  ]);
  writeJsonl(dir, "typeMaterials.jsonl", [
    { _key: 1230, materials: [{ materialTypeID: 34, quantity: 400 }] },
    { _key: 62516, materials: [{ materialTypeID: 34, quantity: 400 }] },
    { _key: 90041, materials: [] },
  ]);
  writeJsonl(dir, "dbuffCollections.jsonl", [
    {
      _key: 1,
      aggregateMode: "Maximum",
      developerDescription: "Test Buff",
      itemModifiers: [{ dogmaAttributeID: 37 }],
      locationModifiers: [{ dogmaAttributeID: 68 }],
      locationGroupModifiers: [{ dogmaAttributeID: 20, groupID: 46 }],
      locationRequiredSkillModifiers: [{ dogmaAttributeID: 6, skillID: 3427 }],
      operationName: "PostMul",
      showOutputValueInUI: "ShowNormal",
    },
  ]);
  writeJsonl(dir, "icons.jsonl", [
    { _key: 15, iconFile: "res:/ui/texture/icons/5_64_11.png" },
  ]);
  writeJsonl(dir, "typeLists.jsonl", [
    { _key: 4, includedTypeIDs: [27674], name: "ShipyardStructureTargets" },
    {
      _key: 6,
      includedGroupIDs: [1327, 1562],
      excludedTypeIDs: [670],
      excludedCategoryIDs: [9],
      displayName: { en: "Ignored Display Name" },
    },
  ]);
  writeJsonl(dir, "planetSchematics.jsonl", [
    {
      _key: 65,
      cycleTime: 3600,
      name: { en: "Superconductors" },
      pins: [2470, 2472],
      types: [
        { _key: 2389, isInput: true, quantity: 40 },
        { _key: 3645, isInput: true, quantity: 40 },
        { _key: 9838, isInput: false, quantity: 5 },
      ],
    },
  ]);
  writeJsonl(dir, "planetResources.jsonl", [
    { _key: 40000001, power: 740 },
    {
      _key: 40000002,
      reagent: {
        amount_per_cycle: 41,
        cycle_period: 3600,
        secured_capacity: 59860,
        type_id: 81144,
        unsecured_capacity: 59860,
      },
    },
  ]);
  writeJsonl(dir, "sovereigntyUpgrades.jsonl", [
    {
      _key: 81615,
      fuel: {
        hourly_upkeep: 205,
        startup_cost: 62000,
        type_id: 81143,
      },
      mutually_exclusive_group: "Infrastructure_5",
      power_allocation: 250,
      workforce_allocation: 1500,
    },
  ]);
  writeJsonl(dir, "skinMaterials.jsonl", [
    { _key: 11, displayName: { en: "Test Pattern" }, materialSetID: 22 },
  ]);
  writeJsonl(dir, "skins.jsonl", [
    {
      _key: 1001,
      allowCCPDevs: false,
      internalName: "Reaper Test Pattern",
      skinDescription: { en: "A public SDE test skin." },
      skinMaterialID: 11,
      types: [588, 596],
      visibleSerenity: false,
      visibleTranquility: true,
    },
  ]);
  writeJsonl(dir, "skinLicenses.jsonl", [
    { _key: 91001, duration: -1, licenseTypeID: 91001, skinID: 1001 },
    { _key: 91002, duration: -1, isSingleUse: true, licenseTypeID: 91002, skinID: 1001 },
    { _key: 91003, duration: -1, isSingleUse: false, licenseTypeID: 91003, skinID: 9999 },
  ]);
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
  const agentAuthority = JSON.parse(fs.readFileSync(path.join(outDir, "agentAuthority", "data.json"), "utf8"));
  const itemTypes = JSON.parse(fs.readFileSync(path.join(outDir, "itemTypes", "data.json"), "utf8"));
  const shipTypes = JSON.parse(fs.readFileSync(path.join(outDir, "shipTypes", "data.json"), "utf8"));
  const skillTypes = JSON.parse(fs.readFileSync(path.join(outDir, "skillTypes", "data.json"), "utf8"));
  const asteroidFieldStyles = JSON.parse(fs.readFileSync(
    path.join(outDir, "asteroidFieldStyles", "data.json"),
    "utf8",
  ));
  const celestials = JSON.parse(fs.readFileSync(path.join(outDir, "celestials", "data.json"), "utf8"));
  const movementAttributes = JSON.parse(fs.readFileSync(path.join(outDir, "movementAttributes", "data.json"), "utf8"));
  const npcCargo = JSON.parse(fs.readFileSync(path.join(outDir, "npcCargo", "data.json"), "utf8"));
  const npcWreckItems = JSON.parse(fs.readFileSync(path.join(outDir, "npcWreckItems", "data.json"), "utf8"));
  const npcWrecks = JSON.parse(fs.readFileSync(path.join(outDir, "npcWrecks", "data.json"), "utf8"));
  const shipDogmaAttributes = JSON.parse(fs.readFileSync(path.join(outDir, "shipDogmaAttributes", "data.json"), "utf8"));
  const solarSystems = JSON.parse(fs.readFileSync(path.join(outDir, "solarSystems", "data.json"), "utf8"));
  const stargates = JSON.parse(fs.readFileSync(path.join(outDir, "stargates", "data.json"), "utf8"));
  const stargateTypes = JSON.parse(fs.readFileSync(path.join(outDir, "stargateTypes", "data.json"), "utf8"));
  const starterShipFittings = JSON.parse(fs.readFileSync(path.join(outDir, "starterShipFittings", "data.json"), "utf8"));
  const shipCosmeticsCatalog = JSON.parse(
    fs.readFileSync(path.join(outDir, "shipCosmeticsCatalog", "data.json"), "utf8"),
  );
  const stations = JSON.parse(fs.readFileSync(path.join(outDir, "stations", "data.json"), "utf8"));
  const stationTypes = JSON.parse(fs.readFileSync(path.join(outDir, "stationTypes", "data.json"), "utf8"));
  const structureTypes = JSON.parse(fs.readFileSync(path.join(outDir, "structureTypes", "data.json"), "utf8"));
  const clientTypeLists = JSON.parse(fs.readFileSync(path.join(outDir, "clientTypeLists", "data.json"), "utf8"));
  const characterCreationRaces = JSON.parse(
    fs.readFileSync(path.join(outDir, "characterCreationRaces", "data.json"), "utf8"),
  );
  const characterCreationBloodlines = JSON.parse(
    fs.readFileSync(path.join(outDir, "characterCreationBloodlines", "data.json"), "utf8"),
  );
  const factions = JSON.parse(fs.readFileSync(path.join(outDir, "factions", "data.json"), "utf8"));
  const dbuffCollections = JSON.parse(fs.readFileSync(path.join(outDir, "dbuffCollections", "data.json"), "utf8"));
  const industryFacilities = JSON.parse(fs.readFileSync(path.join(outDir, "industryFacilities", "data.json"), "utf8"));
  const itemIcons = JSON.parse(fs.readFileSync(path.join(outDir, "itemIcons", "data.json"), "utf8"));
  const mapTagsAuthority = JSON.parse(fs.readFileSync(path.join(outDir, "mapTagsAuthority", "data.json"), "utf8"));
  const planetSchematics = JSON.parse(fs.readFileSync(path.join(outDir, "planetSchematics", "data.json"), "utf8"));
  const reprocessingStatic = JSON.parse(fs.readFileSync(
    path.join(outDir, "reprocessingStatic", "data.json"),
    "utf8",
  ));
  const sovereigntyStatic = JSON.parse(fs.readFileSync(
    path.join(outDir, "sovereigntyStatic", "data.json"),
    "utf8",
  ));

  assert.equal(accounts.test.id, 1);
  assert.equal(accounts.test2.id, 2);
  assert.equal(characters["140000004"].characterName, "GM Elysian");
  assert.equal(characters["140000004"].homeStationID, 60003760);
  assert.ok(Object.values(items).some((item) => item.ownerID === 140000004 && item.typeID === 52568));
  assert.deepEqual(agentAuthority.counts, {
    agentCount: 2,
    stationAgentCount: 2,
    inSpaceAgentCount: 0,
    locatorAgentCount: 1,
    researchAgentCount: 1,
    missionPoolCount: 0,
    missionTemplateCount: 0,
  });
  assert.deepEqual(agentAuthority.agentsByID["3008416"], {
    agentID: 3008416,
    ownerTypeID: 1373,
    ownerName: "Antaken Kamola",
    gender: 0,
    agentTypeID: 2,
    divisionID: 22,
    level: 1,
    isLocator: false,
    corporationID: 1000044,
    factionID: 500001,
    stationID: 60003760,
    stationTypeID: 1529,
    solarSystemID: 30000142,
    isInSpace: false,
    raceID: 1,
    bloodlineID: 1,
    careerID: 14,
    schoolID: 18,
    specialityID: 15,
    missionKind: "courier",
    missionTypeLabel: "UI/Agents/MissionTypes/Courier",
    missionPoolKey: "kind:courier|level:1|agentType:2|division:22|corp:1000044|faction:500001",
    missionTemplateIDs: [],
    importantMission: false,
    conversationMetadata: {
      placeholder: true,
      source: "agentAuthority",
    },
  });
  assert.deepEqual(agentAuthority.agentsByID["3008419"].missionKind, "research");
  assert.deepEqual(agentAuthority.indexes.stationIDToAgentIDs["60003760"], [3008416, 3008419]);
  assert.deepEqual(agentAuthority.indexes.corporationIDToAgentIDs["1000044"], [3008416, 3008419]);
  assert.deepEqual(agentAuthority.indexes.factionIDToAgentIDs["500001"], [3008416, 3008419]);
  assert.deepEqual(agentAuthority.indexes.solarSystemIDToAgentIDs["30000142"], [3008416, 3008419]);
  assert.deepEqual(agentAuthority.indexes.agentTypeIDToAgentIDs["4"], [3008419]);
  assert.deepEqual(agentAuthority.indexes.divisionIDToAgentIDs["18"], [3008419]);
  assert.deepEqual(agentAuthority.indexes.missionPoolKeyToAgentIDs[
    "kind:research|level:3|agentType:4|division:18|corp:1000044|faction:500001"
  ], [3008419]);
  assert.equal(itemTypes.types.some((type) => type.typeID === 670), true);
  assert.equal(itemTypes.types.some((type) => type.typeID === 0), false);
  assert.deepEqual(
    Object.keys(itemTypes.types.find((type) => type.typeID === 670)).sort(),
    [
      "basePrice",
      "capacity",
      "categoryID",
      "graphicID",
      "groupID",
      "groupName",
      "iconID",
      "marketGroupID",
      "mass",
      "name",
      "portionSize",
      "published",
      "raceID",
      "radius",
      "soundID",
      "typeID",
      "volume",
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(shipTypes.ships[0]).sort(),
    Object.keys(itemTypes.types.find((type) => type.typeID === 670)).sort(),
  );
  assert.deepEqual(
    Object.keys(skillTypes.skills[0]).sort(),
    [
      "basePrice",
      "categoryID",
      "graphicID",
      "groupID",
      "groupName",
      "iconID",
      "marketGroupID",
      "name",
      "published",
      "raceID",
      "soundID",
      "typeID",
    ].sort(),
  );

  assert.deepEqual(
    celestials.celestials.map((entry) => [entry.itemID, entry.kind, entry.itemName]),
    [
      [40000001, "sun", "Jita - Star"],
      [40000002, "planet", "Jita IV"],
      [40000003, "moon", "Jita IV - Moon 2"],
      [40000004, "asteroidBelt", "Jita IV - Asteroid Belt 1"],
    ],
  );
  assert.equal(celestials.count, 4);
  assert.deepEqual(celestials.celestials[0].position, { x: 0, y: 0, z: 0 });
  assert.equal(celestials.celestials[1].orbitIndex, null);
  assert.equal(celestials.celestials[3].securityClass, "B");
  assert.deepEqual(asteroidFieldStyles.fieldStyles.map((style) => style.fieldStyleID), [
    "empire_highsec_standard",
    "empire_lowsec_standard",
    "nullsec_standard",
    "wormhole_standard",
  ]);
  assert.equal(asteroidFieldStyles.count, 4);
  assert.deepEqual(
    Object.keys(celestials.celestials[3]).filter((key) => key.endsWith("Meters") || key.endsWith("Count") || key === "fieldStyleID").sort(),
    [
      "asteroidCount",
      "clusterCount",
      "clusterRadiusMeters",
      "fieldRadiusMeters",
      "fieldStyleID",
      "largeAsteroidCount",
      "verticalSpreadMeters",
    ].sort(),
  );
  assert.equal(celestials.celestials[3].fieldStyleID, "empire_highsec_standard");
  assert.equal(celestials.celestials[3].asteroidCount >= 16, true);
  assert.equal(celestials.celestials[3].asteroidCount <= 24, true);
  assert.equal(celestials.celestials[3].clusterCount >= 3, true);
  assert.equal(celestials.celestials[3].clusterCount <= 4, true);
  assert.deepEqual(
    solarSystems.solarSystems,
    [
      {
        regionID: 10000002,
        constellationID: 20000020,
        solarSystemID: 30000142,
        solarSystemName: "Jita",
        position: { x: 1, y: 2, z: 3 },
        security: 0.945,
        factionID: 500001,
        radius: 100,
        sunTypeID: 45041,
        securityClass: "B",
        visualEffect: "TRIGLAVIAN_HOME",
      },
    ],
  );

  assert.deepEqual(
    stargates.stargates,
    [
      {
        itemID: 50000001,
        typeID: 16,
        solarSystemID: 30000142,
        itemName: "Stargate (Jita)",
        position: { x: 10.123, y: 20, z: 30 },
        radius: 15000,
        destinationID: 50000001,
        destinationSolarSystemID: 30000142,
        destinationName: "Stargate (Jita)",
      },
    ],
  );
  assert.deepEqual(
    stargateTypes.stargateTypes,
    [
      {
        typeID: 16,
        typeName: "Stargate",
        groupID: 10,
        categoryID: 2,
        groupName: "Stargate",
        raceID: null,
        graphicID: null,
        published: false,
      },
    ],
  );
  assert.deepEqual(starterShipFittings["588"], {
    shipTypeID: 588,
    shipName: "Reaper",
    modules: [
      { typeID: 21857, name: "1MN Civilian Afterburner" },
      { typeID: 3636, name: "Civilian Gatling Autocannon" },
      { typeID: 3651, name: "Civilian Miner" },
    ],
  });
  assert.deepEqual(starterShipFittings["58745"], {
    shipTypeID: 58745,
    shipName: "AIR Civilian Astero",
    modules: [
      { typeID: 3634, name: "Civilian Gatling Pulse Laser", quantity: 2, slotFamily: "high" },
      { typeID: 21857, name: "1MN Civilian Afterburner", slotFamily: "med" },
      { typeID: 30328, name: "Civilian Stasis Webifier", slotFamily: "med" },
      { typeID: 1957, name: "Multispectral ECM I", slotFamily: "med" },
    ],
  });
  assert.deepEqual(shipCosmeticsCatalog.counts, {
    skins: 1,
    shipTypes: 2,
    materials: 1,
    licenseTypes: 3,
  });
  assert.deepEqual(shipCosmeticsCatalog.skinsBySkinID["1001"], {
    skinID: 1001,
    internalName: "Reaper Test Pattern",
    skinMaterialID: 11,
    material: {
      skinMaterialID: 11,
      displayNameID: null,
      materialSetID: 22,
      displayName: { en: "Test Pattern" },
    },
    shipTypeIDs: [588, 596],
    licenseTypeIDs: [91001, 91002],
    licenseTypes: [
      {
        licenseTypeID: 91001,
        duration: -1,
        isSingleUse: false,
        typeName: "Reaper Test Pattern SKIN",
        published: true,
        groupID: 1950,
        groupName: "Permanent SKIN",
        groupPublished: true,
      },
      {
        licenseTypeID: 91002,
        duration: -1,
        isSingleUse: true,
        typeName: "Reaper Test Pattern SKIN (Volatile)",
        published: true,
        groupID: 1951,
        groupName: "Volatile SKIN",
        groupPublished: true,
      },
    ],
    allowCCPDevs: false,
    skinDescription: { en: "A public SDE test skin." },
    visibleSerenity: false,
    visibleTranquility: true,
  });
  assert.deepEqual(shipCosmeticsCatalog.shipTypesByTypeID["588"], {
    typeID: 588,
    skinIDs: [1001],
    materialIDs: [11],
    licenseTypeIDs: [91001, 91002],
  });
  assert.deepEqual(shipCosmeticsCatalog.materialsByMaterialID["11"], {
    skinMaterialID: 11,
    displayNameID: null,
    materialSetID: 22,
    skinIDs: [1001],
    shipTypeIDs: [588, 596],
    licenseTypeIDs: [91001, 91002],
    displayName: { en: "Test Pattern" },
  });
  assert.deepEqual(shipCosmeticsCatalog.licenseTypesByTypeID["91003"], {
    licenseTypeID: 91003,
    skinID: 9999,
    skinMaterialID: null,
    internalName: "",
    shipTypeIDs: [],
    duration: -1,
    typeName: null,
    published: false,
    groupID: 0,
    groupName: null,
    groupPublished: false,
    isSingleUse: false,
    missingSkinDefinition: true,
  });
  assert.deepEqual(
    stations.stations,
    [
      {
        stationID: 60003760,
        security: 0.945,
        dockingCostPerVolume: 0,
        maxShipVolumeDockable: 50000000,
        officeRentalCost: 10000,
        operationID: 26,
        stationTypeID: 1529,
        corporationID: 1000044,
        solarSystemID: 30000142,
        solarSystemName: "Jita",
        constellationID: 20000020,
        constellationName: "Kimotoro",
        regionID: 10000002,
        regionName: "The Forge",
        stationName: "Jita IV - Moon 2 - Caldari Navy Storage",
        position: { x: 0, y: 0, z: 0 },
        reprocessingEfficiency: 0,
        reprocessingStationsTake: 0,
        reprocessingHangarFlag: 4,
        itemName: "Jita IV - Moon 2 - Caldari Navy Storage",
        itemID: 60003760,
        groupID: 15,
        categoryID: 3,
        orbitID: 40000003,
        orbitName: "Jita IV - Moon 2",
        orbitGroupID: 8,
        orbitTypeID: 14,
        orbitKind: "moon",
        stationTypeName: "Station",
        stationRaceID: null,
        stationGraphicID: null,
        radius: 30000,
        interactionRadius: 30000,
        useOperationName: true,
        dockEntry: null,
        dockPosition: null,
        dockOrientation: null,
        undockDirection: null,
        undockPosition: null,
      },
    ],
  );
  assert.deepEqual(
    stationTypes.stationTypes,
    [
      {
        stationTypeID: 1529,
        typeName: "Station",
        groupID: 15,
        categoryID: 3,
        groupName: "Station",
        raceID: null,
        graphicID: null,
        radius: 30000,
        basePrice: 0,
        volume: 0,
        portionSize: 1,
        published: false,
        dockEntry: null,
        dockOrientation: null,
        graphicLocationID: null,
        directionalLocatorCategories: [],
        undockLocatorCategories: [],
      },
    ],
  );
  assert.deepEqual(structureTypes.structureTypes, [
    {
      typeID: 35825,
      name: "Raitaru",
      groupID: 1404,
      categoryID: 65,
      structureFamily: "engineering",
      structureSize: "STRUCTURE_SIZE_MEDIUM",
      radius: 45000,
      shieldCapacity: 0,
      armorHP: 0,
      hullHP: 0,
      capacitorCapacity: 0,
      maxTargetRange: 0,
      maxLockedTargets: 0,
      tetheringRange: 10000,
      damageCap: 0,
      allowedServices: [1, 2, 3, 6, 8, 9, 20, 21, 22, 23, 24, 30, 31, 32, 33, 34],
      dockable: true,
      defaultQuantumCoreTypeID: 56203,
      excludedDockGroupNames: [],
      oneWayUndockClasses: ["capital", "supercapital"],
      published: true,
    },
  ]);
  assert.deepEqual(Object.keys(structureTypes._meta).sort(), ["generatedAt", "seedVersion"].sort());
  assert.deepEqual(
    clientTypeLists.typeLists,
    [
      {
        excludedTypeIDs: [],
        listID: 4,
        includedCategoryIDs: [],
        includedTypeIDs: [27674],
        excludedGroupIDs: [],
        includedGroupIDs: [],
        excludedCategoryIDs: [],
      },
      {
        excludedTypeIDs: [670],
        listID: 6,
        includedCategoryIDs: [],
        includedTypeIDs: [],
        excludedGroupIDs: [],
        includedGroupIDs: [1327, 1562],
        excludedCategoryIDs: [9],
      },
    ],
  );
  assert.deepEqual(clientTypeLists.counts, {
    includedCategoryReferenceCount: 0,
    includedGroupReferenceCount: 2,
    typeListCount: 2,
    excludedTypeReferenceCount: 1,
    excludedCategoryReferenceCount: 1,
    includedTypeReferenceCount: 1,
    excludedGroupReferenceCount: 0,
  });
  assert.deepEqual(characterCreationRaces.races, [
    {
      raceID: 1,
      name: "Caldari",
      shipTypeID: 670,
      shipName: "Capsule",
      skills: [{ typeID: 3300, level: 4 }],
    },
  ]);
  assert.deepEqual(characterCreationBloodlines.bloodlines, [
    {
      bloodlineID: 1,
      name: "Deteis",
      raceID: 1,
      corporationID: 1000006,
    },
  ]);
  assert.deepEqual(factions.records["500001"], {
    factionID: 500001,
    corporationID: 1000035,
    name: "Caldari State",
    shortDescription: "Short",
    description: "Long",
    flatLogo: "caldari_logo",
    flatLogoWithName: "caldari_logo_w_letters",
    iconID: 1439,
    militiaCorporationID: 1000180,
    solarSystemID: 30000145,
    sizeFactor: 5,
    uniqueName: true,
    memberRaces: [1],
  });
  assert.deepEqual(dbuffCollections.collectionsByID["1"], {
    collectionID: 1,
    aggregateMode: "Maximum",
    operation: 4,
    operationName: "PostMul",
    developerDescription: "Test Buff",
    itemModifiers: [{ dogmaAttributeID: 37 }],
    locationModifiers: [{ dogmaAttributeID: 68 }],
    locationGroupModifiers: [{ dogmaAttributeID: 20, groupID: 46 }],
    locationCategoryModifiers: [],
    locationRequiredSkillModifiers: [{ dogmaAttributeID: 6, skillID: 3427 }],
  });
  assert.deepEqual(dbuffCollections.counts, { collectionCount: 1 });
  assert.deepEqual(industryFacilities.npcFacilityProfiles, [
    {
      facilityID: 60003760,
      solarSystemID: 30000142,
      regionID: 10000002,
      typeID: 1529,
      ownerID: 1000044,
      operationID: 26,
      serviceIDs: [7, 14, 15],
      supportsFactory: true,
      supportsLaboratory: true,
      manufacturingFactor: 0.98,
      researchFactor: 0.95,
    },
  ]);
  assert.deepEqual(industryFacilities.npcFacilityProfilesByFacilityID["60003760"], {
    facilityID: 60003760,
    solarSystemID: 30000142,
    regionID: 10000002,
    typeID: 1529,
    ownerID: 1000044,
    operationID: 26,
    serviceIDs: [7, 14, 15],
    supportsFactory: true,
    supportsLaboratory: true,
    manufacturingFactor: 0.98,
    researchFactor: 0.95,
  });
  assert.deepEqual(itemIcons.iconsByID, {
    15: "res:/ui/texture/icons/5_64_11.png",
  });
  assert.deepEqual(Object.keys(itemIcons.meta).sort(), [
    "description",
    "sourceSnapshot",
    "updatedAt",
    "version",
  ].sort());
  assert.deepEqual(mapTagsAuthority.version, {
    major: 1,
    minor: 0,
    patch: 0,
    prerelease_tags: [],
    build_tags: ["3396210"],
  });
  assert.deepEqual(mapTagsAuthority.systems, []);
  assert.deepEqual(mapTagsAuthority.constellations, []);
  assert.deepEqual(mapTagsAuthority.regions, []);
  assert.deepEqual(mapTagsAuthority.source.usedFiles, []);
  assert.equal(planetSchematics.count, 1);
  assert.deepEqual(planetSchematics.schematics, [
    {
      schematicID: 65,
      name: "Superconductors",
      cycleTime: 3600,
      pinTypeIDs: [2470, 2472],
      inputs: [
        { typeID: 2389, quantity: 40 },
        { typeID: 3645, quantity: 40 },
      ],
      outputs: [
        { typeID: 9838, quantity: 5 },
      ],
    },
  ]);
  assert.deepEqual(
    Object.keys(reprocessingStatic).sort(),
    [
      "compressedTypeBySourceTypeID",
      "reprocessingRigProfiles",
      "reprocessingTypes",
      "source",
      "sourceTypesByCompressedTypeID",
      "structureReprocessingProfiles",
    ].sort(),
  );
  assert.deepEqual(
    reprocessingStatic.reprocessingTypes.map((entry) => entry.typeID),
    [1230, 62516],
  );
  assert.deepEqual(reprocessingStatic.reprocessingTypes[0], {
    typeID: 1230,
    name: "Veldspar",
    groupID: 450,
    categoryID: 25,
    groupName: "Veldspar",
    portionSize: 100,
    basePrice: 0,
    published: true,
    reprocessingSkillType: 60377,
    reprocessingFamily: "ore",
    isRefinable: true,
    isRecyclable: true,
    materials: [{ materialTypeID: 34, quantity: 400 }],
    randomizedMaterials: [],
    averageRandomizedOutputs: [],
  });
  assert.deepEqual(reprocessingStatic.compressedTypeBySourceTypeID, {
    1230: 62516,
  });
  assert.deepEqual(reprocessingStatic.sourceTypesByCompressedTypeID, {
    62516: [1230],
  });
  assert.deepEqual(reprocessingStatic.structureReprocessingProfiles, [
    {
      typeID: 46633,
      name: "Standup M-Set Asteroid Ore Grading Processor I",
      rigSize: 2,
      reprocessingYieldBonusPercent: 0,
      gasDecompressionEfficiencyBase: 0.8,
      gasDecompressionEfficiencyBonusAdd: 0,
    },
  ]);
  assert.deepEqual(reprocessingStatic.reprocessingRigProfiles, [
    {
      typeID: 46633,
      name: "Standup M-Set Asteroid Ore Grading Processor I",
      rigSize: 2,
      refiningYieldMultiplierBase: 0.51,
      securityMultipliers: { high: 1, low: 1.06, null: 1.12 },
      yieldClasses: ["ore"],
      isGeneralMonitor: false,
    },
  ]);
  assert.deepEqual(
    Object.keys(sovereigntyStatic).sort(),
    [
      "claimableSolarSystemIDs",
      "planetDefinitions",
      "planetDefinitionsVersion",
      "planetsBySolarSystemID",
      "source",
      "starConfigurations",
      "upgradeDefinitions",
    ].sort(),
  );
  assert.deepEqual(sovereigntyStatic.planetDefinitionsVersion, {
    major: 24,
    minor: 1,
    patch: 0,
    prerelease_tags: [],
    build_tags: ["elysian-eve", "ccp-equinox-resource-data4"],
  });
  assert.deepEqual(sovereigntyStatic.claimableSolarSystemIDs, [30000142]);
  assert.deepEqual(sovereigntyStatic.starConfigurations, [
    {
      starID: 40000001,
      solarSystemID: 30000142,
      power: 740,
    },
  ]);
  assert.deepEqual(sovereigntyStatic.planetDefinitions, [
    {
      planetID: 40000002,
      solarSystemID: 30000142,
      power: 0,
      workforce: 0,
      reagentDefinitions: [
        {
          reagentTypeID: 81144,
          amountPerCycle: 41,
          cyclePeriodSeconds: 3600,
          securedPercentage: 50,
          securedCapacity: 984,
          unsecuredCapacity: 984,
          securedStock: 0,
          unsecuredStock: 0,
        },
      ],
    },
  ]);
  assert.deepEqual(sovereigntyStatic.planetsBySolarSystemID, {
    30000142: [40000002],
  });
  assert.deepEqual(sovereigntyStatic.upgradeDefinitions, [
    {
      installationTypeID: 81615,
      powerRequired: 250,
      workforceRequired: 1500,
      fuelTypeID: 81143,
      fuelConsumptionPerHour: 205,
      fuelStartupCost: 62000,
      mutuallyExclusiveGroup: "Infrastructure_5",
      powerProduced: 0,
      workforceProduced: 0,
      requiredStrategicIndex: 2,
      typeName: "Cynosural Navigation",
      groupID: 4772,
      published: true,
    },
  ]);
  assert.deepEqual(
    movementAttributes.attributes.map((entry) => entry.typeID),
    [11, 14, 15, 16, 588, 596, 601, 606, 670, 1529, 9854, 45041, 58745],
  );
  assert.deepEqual(
    movementAttributes.attributes.find((entry) => entry.typeID === 16),
    {
      typeID: 16,
      typeName: "Stargate",
      mass: 0,
      maxVelocity: null,
      inertia: null,
      radius: 5000,
      signatureRadius: null,
      warpSpeedMultiplier: null,
      alignTime: null,
      maxAccelerationTime: null,
    },
  );
  assert.equal(
    movementAttributes.attributes.find((entry) => entry.typeID === 670).maxVelocity,
    125,
  );
  assert.deepEqual(npcCargo, {
    nextCargoID: 980200000000,
    cargo: {},
  });
  assert.deepEqual(npcWreckItems, {
    nextWreckItemID: 980400000000,
    items: {},
  });
  assert.deepEqual(npcWrecks, {
    nextWreckID: 980300000000,
    wrecks: {},
  });
  assert.deepEqual(shipDogmaAttributes.counts, {
    shipTypes: 7,
    attributeTypes: 1,
    totalAttributes: 1,
  });
  assert.deepEqual(shipDogmaAttributes.attributeTypesByID["37"], {
    attributeID: 37,
    attributeName: "Maximum Velocity",
    description: "Maximum velocity of ship",
    iconID: 1389,
    defaultValue: 0,
    published: true,
    displayName: "Maximum Velocity",
    unitID: 11,
    stackable: false,
    highIsGood: true,
    categoryID: 17,
    name: "maxVelocity",
    dataType: 4,
    displayWhenZero: false,
  });
  assert.deepEqual(shipDogmaAttributes.shipAttributesByTypeID["670"], {
    typeID: 670,
    typeName: "Capsule",
    attributeCount: 1,
    attributes: { 37: 125 },
  });
  assert.deepEqual(shipDogmaAttributes.shipAttributesByTypeID["9854"], {
    typeID: 9854,
    typeName: "Polaris Inspector Frigate",
    attributeCount: 0,
    attributes: {},
  });
  assert.equal(movementAttributes.attributes.some((entry) => entry.typeID === 3300), false);
  assert.equal(movementAttributes.attributes.some((entry) => entry.typeID === 1230), false);
});
