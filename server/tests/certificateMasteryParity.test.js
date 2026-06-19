const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const SkillHandlerService = require(path.join(
  repoRoot,
  "server/src/services/skills/skillHandlerService",
));
const CertificateMgrService = require(path.join(
  repoRoot,
  "server/src/services/character/certificateMgrService",
));
const {
  buildSkillRecord,
  getSkillTypeByID,
  replaceCharacterSkillRecords,
} = require(path.join(repoRoot, "server/src/services/skills/skillState"));
const {
  getCharacterCertificateLevel,
  listCertificateDefinitions,
  listCertificateRecommendationsForShipType,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/certificates/certificateRuntime",
));
const {
  consumeRecentSkillPointChanges,
  recordRecentSkillPointChanges,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/certificates/skillChangeTracker",
));
const {
  updateCharacterRecord,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));

const TEST_CHARACTER_ID = 140000004;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDictEntry(value, key) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const entries =
    value.args && Array.isArray(value.args.entries)
      ? value.args.entries
      : Array.isArray(value.entries)
        ? value.entries
        : [];
  const entry = entries.find(([entryKey]) => entryKey === key);
  return entry ? entry[1] : undefined;
}

function extractListItems(value) {
  return value && value.type === "list" && Array.isArray(value.items)
    ? value.items
    : [];
}

function extractRowsetLines(rowset) {
  return extractListItems(getDictEntry(rowset, "lines"));
}

function pickRecommendedCertificate() {
  const certificate = listCertificateDefinitions().find((entry) => {
    if (!entry || !Array.isArray(entry.recommendedFor) || entry.recommendedFor.length === 0) {
      return false;
    }
    const requirements = Object.entries(entry.requirementsBySkillTypeID || {}).filter(
      ([skillTypeID, levelsByGrade]) =>
        getSkillTypeByID(Number(skillTypeID)) &&
        Object.values(levelsByGrade || {}).some((level) => Number(level) > 0),
    );
    return requirements.length > 0;
  });

  assert.ok(certificate, "expected at least one certificate with real ship recommendations");
  return certificate;
}

function buildSkillRecordsForCertificateLevel(characterID, certificate, certificateLevel) {
  const records = [];
  for (const [skillTypeID, levelsByGrade] of Object.entries(
    certificate.requirementsBySkillTypeID || {},
  )) {
    const requiredLevel = Number(levelsByGrade && levelsByGrade[certificateLevel]) || 0;
    if (requiredLevel <= 0) {
      continue;
    }
    const skillType = getSkillTypeByID(Number(skillTypeID));
    if (!skillType) {
      continue;
    }
    records.push(buildSkillRecord(characterID, skillType, requiredLevel));
  }

  assert.ok(
    records.length > 0,
    `expected certificate ${certificate.certificateID} to have trainable requirements`,
  );
  return records;
}

function getCertificateRowByID(rowset, certificateID) {
  return extractRowsetLines(rowset).find((line) => Array.isArray(line) && Number(line[0]) === Number(certificateID))
    || extractRowsetLines(rowset).find((line) => Array.isArray(line) && Number(line[1]) === Number(certificateID))
    || null;
}

test("skillHandler.GetSkillChangesForISIS returns a stable iterable recent-change payload for ship tree consumers", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);

  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.flushAllSync();
  });

  updateCharacterRecord(TEST_CHARACTER_ID, (record) => ({
    ...record,
    isisSkillChanges: {},
    isisSkillChangesFetchBudget: 0,
  }));

  const liveChanges = [
    { typeID: 3300, pointChange: 512 },
    { typeID: 3380, pointChange: 256 },
  ];
  recordRecentSkillPointChanges(TEST_CHARACTER_ID, liveChanges);

  const session = {
    characterID: TEST_CHARACTER_ID,
    charid: TEST_CHARACTER_ID,
  };
  const skillHandler = new SkillHandlerService();

  const expectedPayload = [
    [3300, 512],
    [3380, 256],
  ];
  assert.deepEqual(skillHandler.Handle_GetSkillChangesForISIS([], session), expectedPayload);
  assert.deepEqual(skillHandler.Handle_GetSkillChangesForISIS([], session), expectedPayload);
  assert.deepEqual(skillHandler.Handle_GetSkillChangesForISIS([], session), expectedPayload);
  assert.deepEqual(skillHandler.Handle_GetSkillChangesForISIS([], session), expectedPayload);
  assert.deepEqual(skillHandler.Handle_GetSkillChangesForISIS([], session), []);

  assert.deepEqual(
    consumeRecentSkillPointChanges(TEST_CHARACTER_ID),
    [],
    "expected ship-tree recent changes to clear after the fetch replay budget is exhausted",
  );
});

test("certificate authority exposes ship recommendations from the static certificate data set", async () => {
  const certificate = pickRecommendedCertificate();
  const shipTypeID = certificate.recommendedFor[0];
  const certificateIDs = listCertificateRecommendationsForShipType(shipTypeID);

  assert.ok(
    certificateIDs.includes(certificate.certificateID),
    `expected ship ${shipTypeID} to recommend certificate ${certificate.certificateID}`,
  );
});

test("certificateMgr derives current certificates from trained skills and persists visibility flags on parity surfaces", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);

  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    database.flushAllSync();
  });

  const certificate = pickRecommendedCertificate();
  const trainedSkillRecords = buildSkillRecordsForCertificateLevel(
    TEST_CHARACTER_ID,
    certificate,
    1,
  );

  replaceCharacterSkillRecords(TEST_CHARACTER_ID, trainedSkillRecords);
  updateCharacterRecord(TEST_CHARACTER_ID, (record) => ({
    ...record,
    certificateState: {},
  }));

  assert.equal(
    getCharacterCertificateLevel(TEST_CHARACTER_ID, certificate.certificateID),
    1,
    "expected certificate level to derive directly from the trained skill bundle",
  );

  const service = new CertificateMgrService();
  const session = {
    characterID: TEST_CHARACTER_ID,
    charid: TEST_CHARACTER_ID,
  };

  const myCertificates = service.Handle_GetMyCertificates([], session);
  const myCertificateRow = getCertificateRowByID(myCertificates, certificate.certificateID);
  assert.ok(myCertificateRow, "expected GetMyCertificates to include the newly qualified certificate");

  const byCharacter = service.Handle_GetCertificatesByCharacter([TEST_CHARACTER_ID]);
  const byCharacterRow = getCertificateRowByID(byCharacter, certificate.certificateID);
  assert.ok(byCharacterRow, "expected GetCertificatesByCharacter to materialize the same certificate");

  service.Handle_UpdateCertificateFlags([certificate.certificateID, 7], session);
  const updatedCertificates = service.Handle_GetMyCertificates([], session);
  const updatedRow = getCertificateRowByID(updatedCertificates, certificate.certificateID);
  assert.ok(updatedRow, "expected updated certificate row to remain present");
  assert.equal(Number(updatedRow[2]), 7, "expected visibility flags to persist on the certificate row");
});

test("certificateMgr publishes category, class, and ship recommendation payloads with authoritative certificate data", async () => {
  const certificate = pickRecommendedCertificate();
  const shipTypeID = certificate.recommendedFor[0];
  const service = new CertificateMgrService();

  const categories = service.Handle_GetCertificateCategories();
  const categoryItems = extractListItems(categories);
  assert.ok(categoryItems.length > 0, "expected certificate categories to be published");

  const classes = service.Handle_GetCertificateClasses();
  const classItems = extractListItems(classes);
  const classEntry = classItems.find((item) => Number(getDictEntry(item, "certificateID")) === certificate.certificateID);
  assert.ok(classEntry, "expected certificate classes payload to include the chosen certificate");
  assert.equal(Number(getDictEntry(classEntry, "groupID")), Number(certificate.groupID));

  const allShipRecommendations = service.Handle_GetAllShipCertificateRecommendations();
  const recommendationEntry = (allShipRecommendations.entries || []).find(
    ([typeID]) => Number(typeID) === shipTypeID,
  );
  assert.ok(recommendationEntry, "expected ship recommendation payload to include the recommended hull");
  assert.ok(
    extractListItems(recommendationEntry[1]).includes(certificate.certificateID),
    "expected the recommended hull to point back at the authoritative certificate",
  );
});
