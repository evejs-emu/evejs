const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const StructureDirectoryService = require(path.join(
  repoRoot,
  "server/src/services/structure/structureDirectoryService",
));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `Failed to read ${tableName}`);
  return result.data;
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

function extractDictEntries(value) {
  return value && value.type === "dict" && Array.isArray(value.entries)
    ? value.entries
    : [];
}

function extractListItems(value) {
  return value && value.type === "list" && Array.isArray(value.items)
    ? value.items
    : [];
}

function getKeyValEntry(value, key) {
  if (
    !value ||
    value.type !== "object" ||
    value.name !== "util.KeyVal" ||
    !value.args ||
    value.args.type !== "dict" ||
    !Array.isArray(value.args.entries)
  ) {
    return null;
  }

  const entry = value.args.entries.find(
    (candidate) => Array.isArray(candidate) && candidate[0] === key,
  );
  return entry ? entry[1] : null;
}

test("structureDirectory returns populated CCP-shaped structure payloads", (t) => {
  const structuresBackup = readTable("structures");
  t.after(() => {
    writeTable("structures", structuresBackup);
    structureState.clearStructureCaches();
  });

  structureState.clearStructureCaches();

  const session = {
    characterID: 140000001,
    charid: 140000001,
    userid: 140000001,
    corporationID: 1000009,
    corpid: 1000009,
    allianceID: 0,
    allianceid: 0,
    shipTypeID: 606,
    solarsystemid2: 30000142,
    solarsystemid: 30000142,
  };

  const createResult = structureState.createStructure({
    typeID: 35832,
    name: "Directory Test Astrahus",
    itemName: "Directory Test Astrahus",
    ownerCorpID: session.corporationID,
    solarSystemID: 30000142,
    position: { x: 125000, y: 0, z: 175000 },
    state: 110,
    upkeepState: 1,
    hasQuantumCore: true,
    accessProfile: {
      docking: "public",
      tethering: "public",
    },
    serviceStates: {
      "1": 1,
      "2": 1,
      "5": 1,
    },
  });
  assert.equal(createResult.success, true, "Expected structure creation to succeed");

  const structureID = createResult.data.structureID;
  const service = new StructureDirectoryService();

  const structureInfo = service.Handle_GetStructureInfo([structureID], session, null);
  assert.ok(structureInfo, "Expected structure info payload");
  assert.equal(
    Number(getKeyValEntry(structureInfo, "structureID")),
    structureID,
    "Expected structure info to include the persisted structure ID",
  );
  assert.equal(
    Number(getKeyValEntry(structureInfo, "itemID")),
    structureID,
    "Expected structure info to expose the structure itemID for menu consumers",
  );
  assert.equal(
    Boolean(getKeyValEntry(structureInfo, "inSpace")),
    true,
    "Expected structure info to mark seeded structures as in-space objects",
  );
  const services = extractDictEntries(getKeyValEntry(structureInfo, "services"));
  assert.deepEqual(
    services.map(([serviceID]) => Number(serviceID)).sort((left, right) => left - right),
    [1, 2, 3, 5, 8, 9],
    "Expected structure info to expose the online accessible services, including the core default online services",
  );

  const myStructures = service.Handle_GetMyCharacterStructures([], session, null);
  assert.equal(
    extractDictEntries(myStructures).some(([id]) => Number(id) === structureID),
    true,
    "Expected GetMyCharacterStructures to include the public dockable structure",
  );

  const myCorpStructures = service.Handle_GetMyCorporationStructures([], session, null);
  assert.equal(
    extractDictEntries(myCorpStructures).some(([id]) => Number(id) === structureID),
    true,
    "Expected GetMyCorporationStructures to include structures owned by the current corporation",
  );

  const corpStructures = service.Handle_GetCorporationStructures([], session, null);
  assert.equal(
    extractDictEntries(corpStructures).some(([id]) => Number(id) === structureID),
    true,
    "Expected GetCorporationStructures to alias the corporation-owned structure lookup used by the CCP corp SKINR panel",
  );

  const dockable = service.Handle_GetMyDockableStructures([30000142], session, null);
  assert.equal(
    extractListItems(dockable).map((value) => Number(value)).includes(structureID),
    true,
    "Expected GetMyDockableStructures to return the structure ID",
  );

  const dockingAccess = service.Handle_CheckMyDockingAccessToStructures([[structureID]], session, null);
  assert.equal(
    extractListItems(dockingAccess).map((value) => Number(value)).includes(structureID),
    true,
    "Expected CheckMyDockingAccessToStructures to authorize the structure",
  );

  const mapData = service.Handle_GetStructureMapData([30000142], session, null);
  const mapEntries = extractListItems(mapData);
  assert.equal(mapEntries.length > 0, true, "Expected map data rows for the current system");
  const targetRow = mapEntries
    .map((entry) => extractListItems(entry))
    .find((entry) => Number(entry[2]) === structureID);
  assert.ok(targetRow, "Expected structure map data to include the created structure");
  assert.equal(targetRow.length, 12, "Expected CCP-shaped map rows with 12 columns");
  assert.equal(Number(targetRow[2]), structureID, "Expected map row itemID to match the structure");
  assert.equal(Number(targetRow[4]), 30000142, "Expected map row locationID to match the solar system");
  assert.equal(Number(targetRow[7]), 125000, "Expected map row x to match the persisted structure position");
  assert.equal(Number(targetRow[9]), 175000, "Expected map row z to match the persisted structure position");
});

test("structureDirectory hides core-gated fitting and repair services until the quantum core is installed", (t) => {
  const structuresBackup = readTable("structures");
  t.after(() => {
    writeTable("structures", structuresBackup);
    structureState.clearStructureCaches();
  });

  structureState.clearStructureCaches();

  const session = {
    characterID: 140000001,
    charid: 140000001,
    userid: 140000001,
    corporationID: 1000009,
    corpid: 1000009,
    allianceID: 0,
    allianceid: 0,
    shipTypeID: 606,
    solarsystemid2: 30000142,
    solarsystemid: 30000142,
  };

  const createResult = structureState.createStructure({
    typeID: 35832,
    name: "Missing Core Services Astrahus",
    itemName: "Missing Core Services Astrahus",
    ownerCorpID: session.corporationID,
    solarSystemID: 30000142,
    position: { x: 225000, y: 0, z: 275000 },
    state: 110,
    upkeepState: 1,
    hasQuantumCore: false,
    accessProfile: {
      docking: "public",
      tethering: "public",
    },
    serviceStates: {
      "1": 1,
      "2": 1,
      "3": 1,
      "5": 1,
      "8": 1,
      "9": 1,
    },
  });
  assert.equal(createResult.success, true, "Expected structure creation to succeed");

  const service = new StructureDirectoryService();
  const structureInfo = service.Handle_GetStructureInfo(
    [createResult.data.structureID],
    session,
    null,
  );
  const services = extractDictEntries(getKeyValEntry(structureInfo, "services"));

  assert.deepEqual(
    services.map(([serviceID]) => Number(serviceID)).sort((left, right) => left - right),
    [1, 3, 5, 9],
    "Expected no-core structures to hide fitting and repair while keeping non-core-gated services",
  );
});
