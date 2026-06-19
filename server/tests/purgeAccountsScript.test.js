const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { runPurge } = require("../../scripts/purgeAccounts.js");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}${os.EOL}`, "utf8");
}

function writeTable(root, tableName, value) {
  writeJson(path.join(root, tableName, "data.json"), value);
}

test("purgeAccounts removes deleted accounts and associated chat/backlog/portraits", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-purge-test-"));
  const dataRoot = path.join(tempRoot, "data");
  const chatRoot = path.join(tempRoot, "chat");
  const portraitRoot = path.join(tempRoot, "portraits");
  const backupRoot = path.join(tempRoot, "backups");
  const reportRoot = path.join(tempRoot, "reports");

  writeTable(dataRoot, "accounts", {
    test: { id: 1, banned: false },
    test2: { id: 2, banned: false },
    gone: { id: 3, banned: false },
  });
  writeTable(dataRoot, "characters", {
    "140000001": {
      accountId: 1,
      characterID: 140000001,
      corporationID: 98000000,
      allianceID: 99000000,
      name: "keep-one",
    },
    "140000003": {
      accountId: 2,
      characterID: 140000003,
      corporationID: 98000002,
      allianceID: 99000001,
      name: "keep-two",
    },
    "140000010": {
      accountId: 3,
      characterID: 140000010,
      corporationID: 98000003,
      allianceID: 0,
      name: "delete-me",
    },
  });
  writeTable(dataRoot, "skills", {
    "140000001": { a: 1 },
    "140000003": { a: 1 },
    "140000010": { a: 1 },
  });
  writeTable(dataRoot, "items", {
    "5001": { itemID: 5001, ownerID: 140000001, locationID: 60003760 },
    "5002": { itemID: 5002, ownerID: 140000010, locationID: 60003760 },
    "5003": { itemID: 5003, ownerID: 140000001, locationID: 5002 },
  });
  writeTable(dataRoot, "miningLedger", {
    characters: {
      "140000001": { totalMined: 10 },
      "140000010": { totalMined: 5 },
    },
    entries: [
      { characterID: 140000001, quantity: 10 },
      { characterID: 140000010, quantity: 5 },
    ],
  });
  writeTable(dataRoot, "corporationRuntime", {
    corporations: {
      "98000000": { members: { "140000001": {} } },
      "98000002": { members: { "140000003": {} } },
      "98000003": { members: { "140000010": {} } },
    },
  });
  writeTable(dataRoot, "corporations", {
    _meta: {},
    records: {
      "98000000": {
        corporationID: 98000000,
        corporationName: "Keep Corp A",
        creatorID: 140000001,
        ceoID: 140000001,
        allianceID: 99000000,
        isNPC: false,
        memberCount: 1,
      },
      "98000002": {
        corporationID: 98000002,
        corporationName: "Keep Corp B",
        creatorID: 140000003,
        ceoID: 140000003,
        allianceID: 99000001,
        isNPC: false,
        memberCount: 1,
      },
      "98000003": {
        corporationID: 98000003,
        corporationName: "Delete Corp",
        creatorID: 140000010,
        ceoID: 140000010,
        allianceID: null,
        isNPC: false,
        memberCount: 1,
      },
    },
  });
  writeTable(dataRoot, "alliances", {
    _meta: {},
    records: {
      "99000000": {
        allianceID: 99000000,
        creatorID: 140000001,
        executorCorporationID: 98000000,
        memberCorporationIDs: [98000000],
        memberCount: 1,
        isNPC: false,
      },
      "99000001": {
        allianceID: 99000001,
        creatorID: 140000003,
        executorCorporationID: 98000002,
        memberCorporationIDs: [98000002],
        memberCount: 1,
        isNPC: false,
      },
    },
  });
  writeTable(dataRoot, "shipCosmetics", {
    meta: {},
    characters: {
      "140000001": { skinOverridesBySkinID: {} },
      "140000010": { skinOverridesBySkinID: {} },
    },
    ships: {
      "5001": { shipID: 5001, ownerID: 140000001, skinID: 11 },
      "5002": { shipID: 5002, ownerID: 140000010, skinID: 12 },
    },
  });
  writeTable(dataRoot, "killmails", {
    _meta: {},
    records: {
      "1": { killID: 1, finalCharacterID: 140000001 },
      "2": { killID: 2, finalCharacterID: 140000010 },
    },
  });
  writeTable(dataRoot, "industryJobs", {
    _meta: {},
    jobsByID: {
      "1": { jobID: 1, installerID: 140000001, ownerID: 140000001 },
      "2": { jobID: 2, installerID: 140000010, ownerID: 140000010 },
    },
    jobs: {
      "1": { jobID: 1, installerID: 140000001, ownerID: 140000001 },
      "2": { jobID: 2, installerID: 140000010, ownerID: 140000010 },
    },
  });
  writeTable(dataRoot, "characterNotes", {
    "140000001": { note: "keep" },
    "140000010": { note: "delete" },
  });

  writeJson(path.join(chatRoot, "state.json"), {
    version: 1,
    nextPlayerChannelID: 1000000,
    nextPrivateChannelID: 2000000,
    channels: {
      player_900001: {
        roomName: "player_900001",
        type: "player",
        scope: "player",
        entityID: 900001,
        ownerCharacterID: 140000001,
        adminCharacterIDs: [140000001],
        operatorCharacterIDs: [140000001],
        allowCharacterIDs: [],
        denyCharacterIDs: [],
        allowCorporationIDs: [],
        denyCorporationIDs: [],
        allowAllianceIDs: [],
        denyAllianceIDs: [],
        invitedCharacters: [],
        allowedParticipantCharacterIDs: [],
      },
      corp_98000003: {
        roomName: "corp_98000003",
        type: "corp",
        scope: "corp",
        entityID: 98000003,
        ownerCharacterID: 0,
        adminCharacterIDs: [],
        operatorCharacterIDs: [],
        allowCharacterIDs: [],
        denyCharacterIDs: [],
        allowCorporationIDs: [],
        denyCorporationIDs: [],
        allowAllianceIDs: [],
        denyAllianceIDs: [],
        invitedCharacters: [],
        allowedParticipantCharacterIDs: [],
      },
    },
    privateChannelByPair: {},
  });
  fs.mkdirSync(path.join(chatRoot, "backlog"), { recursive: true });
  fs.writeFileSync(
    path.join(chatRoot, "backlog", "player_900001.jsonl"),
    [
      JSON.stringify({ roomName: "player_900001", characterID: 140000001, message: "keep" }),
      JSON.stringify({ roomName: "player_900001", characterID: 140000010, message: "drop" }),
    ].join(os.EOL) + os.EOL,
    "utf8",
  );
  fs.writeFileSync(
    path.join(chatRoot, "backlog", "corp_98000003.jsonl"),
    `${JSON.stringify({ roomName: "corp_98000003", characterID: 140000010, message: "gone" })}${os.EOL}`,
    "utf8",
  );

  fs.mkdirSync(portraitRoot, { recursive: true });
  fs.writeFileSync(path.join(portraitRoot, "140000001_32.jpg"), "keep", "utf8");
  fs.writeFileSync(path.join(portraitRoot, "140000010_32.jpg"), "drop", "utf8");

  const summary = await runPurge({
    apply: true,
    dryRun: false,
    force: true,
    keepAccounts: ["test", "test2"],
    keepCharacterIds: [140000001, 140000003],
    dataRoot,
    chatRoot,
    portraitRoot,
    backupRoot,
    reportRoot,
  });

  const accounts = JSON.parse(fs.readFileSync(path.join(dataRoot, "accounts", "data.json"), "utf8"));
  const characters = JSON.parse(
    fs.readFileSync(path.join(dataRoot, "characters", "data.json"), "utf8"),
  );
  const corporations = JSON.parse(
    fs.readFileSync(path.join(dataRoot, "corporations", "data.json"), "utf8"),
  );
  const chatState = JSON.parse(fs.readFileSync(path.join(chatRoot, "state.json"), "utf8"));
  const backlog = fs.readFileSync(
    path.join(chatRoot, "backlog", "player_900001.jsonl"),
    "utf8",
  );

  assert.deepEqual(Object.keys(accounts).sort(), ["test", "test2"]);
  assert.deepEqual(Object.keys(characters).sort(), ["140000001", "140000003"]);
  assert.equal(corporations.records["98000003"], undefined);
  assert.equal(chatState.channels.corp_98000003, undefined);
  assert.equal(
    fs.existsSync(path.join(chatRoot, "backlog", "corp_98000003.jsonl")),
    false,
  );
  assert.match(backlog, /140000001/);
  assert.doesNotMatch(backlog, /140000010/);
  assert.equal(fs.existsSync(path.join(portraitRoot, "140000010_32.jpg")), false);
  assert.equal(fs.existsSync(path.join(portraitRoot, "140000001_32.jpg")), true);
  assert.equal(summary.counts.accounts.after, 2);
  assert.equal(summary.counts.characters.after, 2);
  assert.equal(summary.counts.chatChannels.after, 1);

  fs.rmSync(tempRoot, { recursive: true, force: true });
});
