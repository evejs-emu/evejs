const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..");
const dataRoot =
  process.env.EVEJS_NEWDB_DATA_DIR ||
  path.join(repoRoot, "server", "src", "newDatabase", "data");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const CharMgrService = require(path.join(
  repoRoot,
  "server/src/services/character/charMgrService",
));
const TutorialSvcService = require(path.join(
  repoRoot,
  "server/src/services/account/tutorialSvcService",
));
const {
  applyCharacterToSession,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  getCharacterCreationQAStarterSystemIDs,
  getCharacterCreationSchools,
  resolveCharacterCreationSchoolIDForRace,
  resolveCharacterCreationSchoolProfile,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterCreationData",
));

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDictEntry(value, key) {
  const entries = value && value.args && Array.isArray(value.args.entries)
    ? value.args.entries
    : value && Array.isArray(value.entries)
      ? value.entries
      : [];
  const entry = entries.find(([entryKey]) => entryKey === key);
  return entry ? entry[1] : undefined;
}

function sortedUniqueNumbers(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0),
  )].sort((left, right) => left - right);
}

test("client and setup metadata target EVE 24.01 build 3396210", () => {
  const configText = fs.readFileSync(
    path.join(repoRoot, "server", "src", "config", "index.js"),
    "utf8",
  );
  const setupText = fs.readFileSync(
    path.join(repoRoot, "tools", "ClientSETUP", "ClientSetup.ps1"),
    "utf8",
  );
  const bluePatchRecipe = readJson(
    path.join(repoRoot, "tools", "ClientSETUP", "blue_patch_recipe.json"),
  );

  assert.match(configText, /key:\s*"clientVersion"[\s\S]*?defaultValue:\s*24\.01/);
  assert.match(configText, /key:\s*"clientBuild"[\s\S]*?defaultValue:\s*3396210/);
  assert.match(configText, /key:\s*"projectVersion"[\s\S]*?defaultValue:\s*"V24\.01@ccp"/);
  assert.match(configText, /key:\s*"eveBirthday"[\s\S]*?defaultValue:\s*170472/);
  assert.match(configText, /key:\s*"machoVersion"[\s\S]*?defaultValue:\s*496/);
  assert.match(setupText, /\$REQUIRED_BUILD\s*=\s*"3396210"/);
  assert.equal(bluePatchRecipe.supportedBuild, 3396210);
  assert.equal(bluePatchRecipe.source.size, 12078736);
  assert.equal(
    bluePatchRecipe.source.sha256,
    "24e8368262e565bbf98001488007a78202657031cd8515f89029a36c89052886",
  );
  assert.equal(bluePatchRecipe.target, undefined);
  assert.equal(JSON.stringify(bluePatchRecipe).includes("data" + "Base64"), false);
  assert.equal(bluePatchRecipe.patches[0].offset, 2051561);
  assert.equal(bluePatchRecipe.peRules.stripAuthenticodeSecurityDirectory, true);
});

test("every refreshed file matches the build-3396210 checksum manifest", (t) => {
  const manifestPath = path.join(repoRoot, "doc", "client-build-3396210-static-data-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    t.skip("static data checksum manifest is not committed in the GitHub-ready source tree");
    return;
  }
  const manifest = readJson(manifestPath);
  assert.equal(manifest.clientVersion, "24.01");
  assert.equal(manifest.clientBuild, 3396210);
  assert.equal(manifest.compatibilityDate, "2026-06-16");
  assert.equal(manifest.entries.length, 41);

  for (const entry of manifest.entries) {
    assert.equal(entry.clientBuild, 3396210);
    const filePath = path.join(repoRoot, entry.file);
    const raw = fs.readFileSync(filePath);
    const payload = JSON.parse(raw);
    const hash = crypto.createHash("sha256").update(raw).digest("hex").toUpperCase();
    assert.equal(hash, entry.sha256, entry.file);
    assert.equal(raw.length, entry.bytes, entry.file);
    assert.deepEqual(Object.keys(payload), entry.rootKeys, entry.file);
    if (entry.rowKey) {
      assert.ok(Array.isArray(payload[entry.rowKey]), entry.file);
      assert.equal(payload[entry.rowKey].length, entry.rowCount, entry.file);
    }
  }
});

test("refreshed universe, type, industry, and reprocessing references are coherent", () => {
  const itemTypes = readJson(path.join(dataRoot, "itemTypes", "data.json")).types;
  const ships = readJson(path.join(dataRoot, "shipTypes", "data.json")).ships;
  const skills = readJson(path.join(dataRoot, "skillTypes", "data.json")).skills;
  const systems = readJson(path.join(dataRoot, "solarSystems", "data.json")).solarSystems;
  const stations = readJson(path.join(dataRoot, "stations", "data.json")).stations;
  const stargates = readJson(path.join(dataRoot, "stargates", "data.json")).stargates;
  const blueprints = readJson(
    path.join(dataRoot, "industryBlueprints", "data.json"),
  ).blueprintDefinitions;
  const reprocessing = readJson(
    path.join(dataRoot, "reprocessingStatic", "data.json"),
  ).reprocessingTypes;

  const typeIDs = new Set(itemTypes.map((row) => row.typeID));
  const systemIDs = new Set(systems.map((row) => row.solarSystemID));
  assert.equal(itemTypes.length, 52590);
  assert.equal(ships.length, 569);
  assert.equal(skills.length, 588);
  assert.equal(systems.length, 8490);
  assert.equal(stations.length, 5210);
  assert.equal(stargates.length, 13978);
  assert.ok(itemTypes.every((row) => row.typeID > 0 && row.name.length > 0));
  assert.ok(ships.every((row) => typeIDs.has(row.typeID)));
  assert.ok(skills.every((row) => typeIDs.has(row.typeID)));
  assert.ok(stations.every((row) => systemIDs.has(row.solarSystemID)));
  assert.ok(stargates.every((row) =>
    systemIDs.has(row.solarSystemID) &&
    systemIDs.has(row.destinationSolarSystemID),
  ));
  assert.ok(blueprints.every((row) =>
    row.blueprintTypeID > 0 && row.activities && typeof row.activities === "object",
  ));
  assert.ok(reprocessing.every((row) =>
    row.typeID > 0 && Array.isArray(row.materials),
  ));
});

test("school authority, QA systems, and tutorial career agents stay cross-linked", () => {
  const schools = getCharacterCreationSchools();
  const agents = readJson(path.join(dataRoot, "agentAuthority", "data.json")).agentsByID;
  const stationIDs = new Set(
    readJson(path.join(dataRoot, "stations", "data.json")).stations
      .map((station) => station.stationID),
  );
  const systemIDs = new Set(
    readJson(path.join(dataRoot, "solarSystems", "data.json")).solarSystems
      .map((system) => system.solarSystemID),
  );

  assert.equal(schools.length, 23);
  assert.deepEqual(
    schools.filter((school) => school.isStarterSpaceSchool).map((school) => school.schoolID),
    [31, 32, 33, 34, 35, 36, 37, 38],
  );
  assert.equal(
    schools.reduce((count, school) => count + school.careerAgents.length, 0),
    10940,
  );
  for (const school of schools) {
    if (school.solarSystemID) {
      assert.ok(systemIDs.has(school.solarSystemID), `school ${school.schoolID}`);
    }
    assert.ok(
      school.startingStations.every((stationID) => stationIDs.has(stationID)),
      `school ${school.schoolID}`,
    );
    assert.ok(
      school.careerAgents.every((agentID) => agents[String(agentID)]),
      `school ${school.schoolID}`,
    );
  }

  const qaSystems = new CharService().Handle_GetQAStarterSystemIDs([]);
  assert.deepEqual(qaSystems, getCharacterCreationQAStarterSystemIDs());
  assert.ok(qaSystems.length > 0);

  const tutorial = new TutorialSvcService();
  const careerAgents = tutorial.Handle_GetCareerAgents();
  const careerEntries = new Map(careerAgents.entries);
  assert.equal(careerEntries.size, schools.length);
  const agentIDsBySchoolID = new Map();
  const schoolTaggedAgentIDs = [];
  for (const agent of Object.values(agents)) {
    const schoolID = Number(agent && agent.schoolID) || 0;
    const agentID = Number(agent && agent.agentID) || 0;
    if (schoolID <= 0 || agentID <= 0) {
      continue;
    }
    schoolTaggedAgentIDs.push(agentID);
    if (!agentIDsBySchoolID.has(schoolID)) {
      agentIDsBySchoolID.set(schoolID, []);
    }
    agentIDsBySchoolID.get(schoolID).push(agentID);
  }
  const expectedTutorialAgentIDs = new Set(sortedUniqueNumbers(schoolTaggedAgentIDs));
  assert.equal(expectedTutorialAgentIDs.size, 10940);
  for (const school of schools) {
    const agentList = careerEntries.get(school.schoolID);
    assert.ok(agentList && agentList.type === "list");
    assert.deepEqual(
      agentList.items,
      sortedUniqueNumbers([
        ...(agentIDsBySchoolID.get(school.schoolID) || []),
        ...school.careerAgents,
      ]),
    );
  }

  const tutorialAgents = tutorial.Handle_GetTutorialAgents();
  const tutorialLines = getDictEntry(tutorialAgents, "lines");
  assert.ok(tutorialLines && tutorialLines.type === "list");
  assert.equal(tutorialLines.items.length, expectedTutorialAgentIDs.size);
  assert.deepEqual(
    new Set(tutorialLines.items.map((row) => row[0])),
    expectedTutorialAgentIDs,
  );
});

test("legacy corporation-style schools normalize without replacing corporation identity", (t) => {
  const mutableTables = [
    "characters",
    "skills",
    "items",
    "identityState",
    "corporationRuntime",
  ];
  const originals = Object.fromEntries(
    mutableTables.map((table) => [table, cloneValue(database.read(table, "/").data)]),
  );
  const characterID = 140099997;
  const legacySchoolCorporationID = 1000045;

  t.after(() => {
    for (const table of mutableTables) {
      database.write(table, "/", originals[table]);
    }
    database.flushAllSync();
  });

  database.write("characters", `/${characterID}`, {
    accountId: 920001,
    characterName: "Legacy School Contract",
    gender: 1,
    bloodlineID: 1,
    ancestryID: 1,
    raceID: 1,
    typeID: 1373,
    corporationID: 98000000,
    schoolID: legacySchoolCorporationID,
    stationID: 60015159,
    homeStationID: 60015159,
    cloneStationID: 60015159,
    solarSystemID: 30001392,
    constellationID: 20000199,
    regionID: 10000016,
    createDateTime: "134247000000000000",
    startDateTime: "134247000000000000",
    employmentHistory: [],
  });

  const expectedSchoolID = resolveCharacterCreationSchoolIDForRace(
    legacySchoolCorporationID,
    1,
  );
  const schoolProfile = resolveCharacterCreationSchoolProfile(expectedSchoolID);
  const record = getCharacterRecord(characterID);
  assert.equal(record.schoolID, expectedSchoolID);
  assert.equal(record.corporationID, 98000000);
  assert.equal(record.employmentHistory[0].corporationID, schoolProfile.corporationID);

  const publicInfo = new CharMgrService().Handle_GetPublicInfo([characterID], {});
  assert.equal(getDictEntry(publicInfo, "schoolID"), expectedSchoolID);
  assert.equal(getDictEntry(publicInfo, "corporationID"), 98000000);

  const session = {
    userid: 920001,
    role: 0,
    corprole: 0,
    rolesAtAll: 0,
    rolesAtBase: 0,
    rolesAtHQ: 0,
    rolesAtOther: 0,
  };
  const result = applyCharacterToSession(session, characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(result.success, true);
  assert.equal(session.schoolID, expectedSchoolID);
  assert.equal(session.corporationID, 98000000);
});
