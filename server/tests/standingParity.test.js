const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const standingRuntime = require(path.join(
  repoRoot,
  "server/src/services/character/standingRuntime",
));
const {
  StandingMgrService,
} = require(path.join(
  repoRoot,
  "server/src/services/character/standingMgrService",
));
const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  grantCharacterSkillLevels,
} = require(path.join(repoRoot, "server/src/services/skills/skillState"));
const {
  executeChatCommand,
} = require(path.join(repoRoot, "server/src/services/chat/chatCommands"));
const {
  getOwnerLookupRecord,
  setCharacterAffiliation,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/corporationState",
));
const {
  listAgents,
} = require(path.join(
  repoRoot,
  "server/src/services/agent/agentAuthority",
));

const TEST_CHARACTER_ID = 140000003;
const TEST_CORP_MEMBER_ID = 140000002;
const TEST_CORP_ID = 98000000;
const TEMP_CORP_ID = 98123456;
const POSITIVE_FACTION_ID = 500001;
const NEGATIVE_FACTION_ID = 500002;
const PIRATE_FACTION_ID = 500010;
const TEST_CORP_STANDING_OWNER_ID = 1000125;

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

function rowsetToObjects(rowsetPayload) {
  assert.equal(
    rowsetPayload && rowsetPayload.name,
    "eve.common.script.sys.rowset.Rowset",
  );
  const rowsetState = dictEntriesToMap(rowsetPayload.args);
  const header = rowsetState.get("header").items;
  const lines = rowsetState.get("lines").items;
  return lines.map((line) => new Map(
    header.map((columnName, index) => [columnName, line.items[index]]),
  ));
}

function snapshotSkillsTable() {
  return cloneValue(database.read("skills", "/").data || {});
}

function restoreCharacter(characterID, snapshot) {
  updateCharacterRecord(characterID, () => cloneValue(snapshot));
}

test("effective standings apply diplomacy, connections, and criminal connections bonuses", (t) => {
  const characterSnapshot = cloneValue(getCharacterRecord(TEST_CHARACTER_ID) || {});
  const skillsSnapshot = snapshotSkillsTable();

  t.after(() => {
    restoreCharacter(TEST_CHARACTER_ID, characterSnapshot);
    database.write("skills", "/", cloneValue(skillsSnapshot));
  });

  grantCharacterSkillLevels(TEST_CHARACTER_ID, [
    { typeID: standingRuntime.TYPE_CONNECTIONS, level: 4 },
    { typeID: standingRuntime.TYPE_DIPLOMACY, level: 4 },
    { typeID: standingRuntime.TYPE_CRIMINAL_CONNECTIONS, level: 4 },
  ]);

  updateCharacterRecord(TEST_CHARACTER_ID, (record) => ({
    ...record,
    standingData: {
      char: [
        { fromID: POSITIVE_FACTION_ID, toID: TEST_CHARACTER_ID, standing: 5 },
        { fromID: NEGATIVE_FACTION_ID, toID: TEST_CHARACTER_ID, standing: -5 },
        { fromID: PIRATE_FACTION_ID, toID: TEST_CHARACTER_ID, standing: 5 },
      ],
      corp: [],
      npc: [],
    },
  }));

  const positive = standingRuntime.getCharacterEffectiveStanding(
    TEST_CHARACTER_ID,
    POSITIVE_FACTION_ID,
  );
  const negative = standingRuntime.getCharacterEffectiveStanding(
    TEST_CHARACTER_ID,
    NEGATIVE_FACTION_ID,
  );
  const pirate = standingRuntime.getCharacterEffectiveStanding(
    TEST_CHARACTER_ID,
    PIRATE_FACTION_ID,
  );

  assert.equal(positive.skillTypeID, standingRuntime.TYPE_CONNECTIONS);
  assert.equal(negative.skillTypeID, standingRuntime.TYPE_DIPLOMACY);
  assert.equal(pirate.skillTypeID, standingRuntime.TYPE_CRIMINAL_CONNECTIONS);
  assert.ok(Math.abs(Number(positive.standing) - 5.8) < 1e-9);
  assert.ok(Math.abs(Number(negative.standing) - (-2.6)) < 1e-9);
  assert.ok(Math.abs(Number(pirate.standing) - 5.8) < 1e-9);
});

test("corporation standing composition rows are built from contributing members", (t) => {
  const firstSnapshot = cloneValue(getCharacterRecord(TEST_CORP_MEMBER_ID) || {});
  const secondSnapshot = cloneValue(getCharacterRecord(TEST_CHARACTER_ID) || {});
  const corporationsSnapshot = cloneValue(database.read("corporations", "/").data || {});

  t.after(() => {
    restoreCharacter(TEST_CORP_MEMBER_ID, firstSnapshot);
    restoreCharacter(TEST_CHARACTER_ID, secondSnapshot);
    database.write("corporations", "/", cloneValue(corporationsSnapshot));
  });

  const corporationsTable = cloneValue(corporationsSnapshot);
  const records =
    corporationsTable && corporationsTable.records && typeof corporationsTable.records === "object"
      ? corporationsTable.records
      : {};
  const templateRecord = cloneValue(records[String(TEST_CORP_ID)] || {});
  records[String(TEMP_CORP_ID)] = {
    ...templateRecord,
    corporationID: TEMP_CORP_ID,
    corporationName: "Standings Temp Corp",
    tickerName: "STAND",
    isNPC: false,
    allianceID: null,
    memberCount: 2,
  };
  corporationsTable.records = records;
  database.write("corporations", "/", corporationsTable);
  setCharacterAffiliation(TEST_CORP_MEMBER_ID, TEMP_CORP_ID, null);
  setCharacterAffiliation(TEST_CHARACTER_ID, TEMP_CORP_ID, null);

  updateCharacterRecord(TEST_CORP_MEMBER_ID, (record) => ({
    ...record,
    standingData: {
      char: [
        { fromID: TEST_CORP_STANDING_OWNER_ID, toID: TEST_CORP_MEMBER_ID, standing: 4 },
      ],
      corp: [],
      npc: [],
    },
  }));
  updateCharacterRecord(TEST_CHARACTER_ID, (record) => ({
    ...record,
    standingData: {
      char: [
        { fromID: TEST_CORP_STANDING_OWNER_ID, toID: TEST_CHARACTER_ID, standing: 8 },
      ],
      corp: [],
      npc: [],
    },
  }));

  const service = new StandingMgrService();
  const compositionPayload = service.Handle_GetStandingCompositions([
    TEST_CORP_STANDING_OWNER_ID,
    TEMP_CORP_ID,
  ]);
  assert.equal(compositionPayload && compositionPayload.type, "list");
  const compositionRows = compositionPayload.items.map((entry) => keyValEntriesToMap(entry));
  assert.deepEqual(
    compositionRows.map((row) => [
      Number(row.get("ownerID")),
      Number(row.get("standing")),
    ]),
    [
      [TEST_CHARACTER_ID, 8],
      [TEST_CORP_MEMBER_ID, 4],
    ],
  );
});

test("standing transactions persist and are exposed through standingMgr", (t) => {
  const characterSnapshot = cloneValue(getCharacterRecord(TEST_CHARACTER_ID) || {});

  t.after(() => {
    restoreCharacter(TEST_CHARACTER_ID, characterSnapshot);
  });

  const writeResult = standingRuntime.setCharacterStanding(
    TEST_CHARACTER_ID,
    POSITIVE_FACTION_ID,
    7.25,
    {
      eventTypeID: standingRuntime.EVENT_STANDING_SLASH_SET,
      message: "standing parity test",
    },
  );
  assert.equal(writeResult.success, true);

  const service = new StandingMgrService();
  const transactionPayload = service.Handle_GetStandingTransactions([
    POSITIVE_FACTION_ID,
    TEST_CHARACTER_ID,
  ]);
  assert.equal(transactionPayload && transactionPayload.type, "list");
  assert.equal(transactionPayload.items.length > 0, true);
  const firstTransaction = keyValEntriesToMap(transactionPayload.items[0]);
  assert.equal(Number(firstTransaction.get("eventTypeID")), standingRuntime.EVENT_STANDING_SLASH_SET);
  assert.equal(Number(firstTransaction.get("fromID")), POSITIVE_FACTION_ID);
  assert.equal(Number(firstTransaction.get("toID")), TEST_CHARACTER_ID);
  assert.ok(Math.abs(Number(firstTransaction.get("modification")) - 0.725) < 1e-9);
  assert.equal(firstTransaction.get("msg"), "standing parity test");
});

test("/setstanding resolves named owners and /fullstandings unlocks all agent corps and factions", (t) => {
  const characterSnapshot = cloneValue(getCharacterRecord(TEST_CHARACTER_ID) || {});

  t.after(() => {
    restoreCharacter(TEST_CHARACTER_ID, characterSnapshot);
  });

  const standingOwners = standingRuntime.getAllAgentStandingOwners();
  const sampleCorporationID = Number(standingOwners.corporationIDs[0]) || 0;
  const sampleOwnerRecord = getOwnerLookupRecord(sampleCorporationID);
  assert.ok(sampleCorporationID > 0, "expected at least one agent corporation");
  assert.ok(sampleOwnerRecord && sampleOwnerRecord.ownerName, "expected agent corporation owner lookup");

  const setResult = executeChatCommand(
    {
      characterID: TEST_CHARACTER_ID,
      charid: TEST_CHARACTER_ID,
    },
    `/setstanding 6.5 "${sampleOwnerRecord.ownerName}"`,
    null,
    { emitChatFeedback: false },
  );
  assert.equal(setResult.handled, true);
  assert.match(String(setResult.message || ""), /Set standing with/i);
  assert.ok(
    Math.abs(
      standingRuntime.getCharacterRawStanding(TEST_CHARACTER_ID, sampleCorporationID) - 6.5,
    ) < 1e-9,
  );

  const fullResult = executeChatCommand(
    {
      characterID: TEST_CHARACTER_ID,
      charid: TEST_CHARACTER_ID,
    },
    "/fullstandings",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(fullResult.handled, true);
  assert.match(String(fullResult.message || ""), /agent corporation standings/i);

  for (const corporationID of standingOwners.corporationIDs) {
    assert.ok(
      Math.abs(
        standingRuntime.getCharacterRawStanding(TEST_CHARACTER_ID, corporationID) - 10,
      ) < 1e-9,
      `expected corporation ${corporationID} to be set to 10`,
    );
  }
  for (const factionID of standingOwners.factionIDs) {
    assert.ok(
      Math.abs(
        standingRuntime.getCharacterRawStanding(TEST_CHARACTER_ID, factionID) - 10,
      ) < 1e-9,
      `expected faction ${factionID} to be set to 10`,
    );
  }
});

test("level 1 basic agents bypass standings while level 1 research agents still honor corp-floor checks", (t) => {
  const characterSnapshot = cloneValue(getCharacterRecord(TEST_CHARACTER_ID) || {});

  t.after(() => {
    restoreCharacter(TEST_CHARACTER_ID, characterSnapshot);
  });

  const levelOneBasicAgent = listAgents().find(
    (agentRecord) =>
      Number(agentRecord && agentRecord.agentTypeID) === 2 &&
      Number(agentRecord && agentRecord.level) === 1 &&
      Number(agentRecord && agentRecord.stationID) > 0,
  );
  const levelOneResearchAgent = listAgents().find(
    (agentRecord) =>
      Number(agentRecord && agentRecord.agentTypeID) === 4 &&
      Number(agentRecord && agentRecord.level) === 1 &&
      Number(agentRecord && agentRecord.stationID) > 0,
  );

  assert.ok(levelOneBasicAgent, "expected a level 1 basic agent");
  assert.ok(levelOneResearchAgent, "expected a level 1 research agent");

  updateCharacterRecord(TEST_CHARACTER_ID, (record) => ({
    ...record,
    standingData: {
      char: [
        {
          fromID: Number(levelOneBasicAgent.corporationID),
          toID: TEST_CHARACTER_ID,
          standing: -9,
        },
        {
          fromID: Number(levelOneResearchAgent.corporationID),
          toID: TEST_CHARACTER_ID,
          standing: -9,
        },
      ],
      corp: [],
      npc: [],
    },
  }));

  assert.equal(
    standingRuntime.canCharacterUseAgent(TEST_CHARACTER_ID, levelOneBasicAgent),
    true,
  );
  assert.equal(
    standingRuntime.canCharacterUseAgent(TEST_CHARACTER_ID, levelOneResearchAgent),
    false,
  );
});
