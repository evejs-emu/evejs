const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const dungeonAuthority = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonAuthority",
));
const dungeonRuntime = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonRuntime",
));
const DungeonInstanceCacheMgrService = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonInstanceCacheMgrService",
));
const MapService = require(path.join(
  repoRoot,
  "server/src/services/map/mapService",
));

const SNAPSHOT_TABLES = [
  "dungeonRuntimeState",
];

function readTable(tableName) {
  const result = database.read(tableName, "/");
  return result && result.success ? JSON.parse(JSON.stringify(result.data)) : {};
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to restore ${tableName}`);
}

function withSnapshots(fn) {
  return async () => {
    const snapshots = Object.fromEntries(
      SNAPSHOT_TABLES.map((tableName) => [tableName, readTable(tableName)]),
    );
    try {
      dungeonAuthority.clearCache();
      dungeonRuntime.resetRuntimeForTests();
      DungeonInstanceCacheMgrService._testing.invalidateCache();
      await fn();
    } finally {
      for (const [tableName, payload] of Object.entries(snapshots)) {
        writeTable(tableName, payload);
      }
      dungeonRuntime.clearRuntimeCache();
      dungeonAuthority.clearCache();
      DungeonInstanceCacheMgrService._testing.invalidateCache();
    }
  };
}

function findTemplateIDForArchetype(archetypeID) {
  const template = dungeonAuthority
    .listTemplatesByArchetypeID(archetypeID)
    .find(Boolean);
  assert.ok(template, `Expected template for archetype ${archetypeID}`);
  return template.templateID;
}

function dictToMap(dictPayload) {
  return new Map(
    ((dictPayload && dictPayload.entries) || []).map(([key, value]) => [Number(key), value]),
  );
}

function keyValToMap(keyValPayload) {
  return new Map(((keyValPayload && keyValPayload.args && keyValPayload.args.entries) || []));
}

test("dungeonInstanceCacheMgr groups real active anomaly instances by archetype bucket", withSnapshots(() => {
  const combatTemplateID = findTemplateIDForArchetype(24);
  const oreTemplateID = findTemplateIDForArchetype(27);
  const iceTemplateID = findTemplateIDForArchetype(28);
  const homefrontTemplateID = findTemplateIDForArchetype(70);

  dungeonRuntime.createInstance({
    templateID: combatTemplateID,
    solarSystemID: 30000142,
    siteKey: "test:combat:30000142",
    lifecycleState: "active",
    siteKind: "anomaly",
  });
  dungeonRuntime.createInstance({
    templateID: oreTemplateID,
    solarSystemID: 30000144,
    siteKey: "test:ore:30000144",
    lifecycleState: "active",
    siteKind: "anomaly",
  });
  dungeonRuntime.createInstance({
    templateID: iceTemplateID,
    solarSystemID: 30000145,
    siteKey: "test:ice:30000145",
    lifecycleState: "active",
    siteKind: "anomaly",
  });
  dungeonRuntime.createInstance({
    templateID: homefrontTemplateID,
    solarSystemID: 30000146,
    siteKey: "test:homefront:30000146",
    lifecycleState: "active",
    siteKind: "anomaly",
  });

  const service = new DungeonInstanceCacheMgrService();

  const combatSystems = dictToMap(service.callMethod("GetCombatAnomalyInstances", [], null));
  const oreSystems = dictToMap(service.callMethod("GetOreAnomalyInstances", [], null));
  const iceSystems = dictToMap(service.callMethod("GetIceBeltInstances", [], null));
  const homefrontSystems = dictToMap(service.callMethod("GetHomefrontSiteInstances", [], null));
  const combatCounts = dictToMap(service.callMethod("GetCombatAnomaliesCount", [], null));

  assert.ok(combatSystems.has(30000142));
  assert.ok(oreSystems.has(30000144));
  assert.ok(iceSystems.has(30000145));
  assert.ok(homefrontSystems.has(30000146));
  assert.equal(combatCounts.get(30000142), 1);

  const combatEntries = combatSystems.get(30000142);
  assert.equal(combatEntries.type, "list");
  assert.equal(combatEntries.items.length, 1);

  const combatEntry = keyValToMap(combatEntries.items[0]);
  assert.equal(Number(combatEntry.get("solarSystemID")), 30000142);
  assert.equal(Number(combatEntry.get("archetypeID")), 24);
  assert.ok(Number(combatEntry.get("dungeonID")) > 0);
  assert.ok(Number(combatEntry.get("instanceID")) > 0);
  assert.equal(
    Number(combatEntry.get("siteID")),
    Number(combatEntry.get("instanceID")),
  );
  assert.equal(combatEntry.has("position"), false);
}));

test("map incursion APIs return safe empty iterables", () => {
  const service = new MapService();

  assert.deepEqual(service.callMethod("GetIncursionGlobalReport", [], null), []);

  const systems = service.callMethod("GetSystemsInIncursions", [], null);
  assert.equal(systems && systems.type, "object");
  assert.equal(systems && systems.name, "eve.common.script.sys.rowset.Rowset");
});
