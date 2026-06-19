const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const CharMgrService = require(path.join(
  repoRoot,
  "server/src/services/character/charMgrService",
));
const ConfigService = require(path.join(
  repoRoot,
  "server/src/services/config/configService",
));
const PaperDollServerService = require(path.join(
  repoRoot,
  "server/src/services/character/paperDollServerService",
));
const {
  clonePaperDollPayload,
} = require(path.join(
  repoRoot,
  "server/src/services/character/paperDollPayloads",
));
const {
  applyCharacterToSession,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  getCharacterCreationSchool,
  resolveCharacterCreationSchoolIDForRace,
  resolveCharacterCreationSchoolProfile,
  resolveCharacterCreationBloodlineProfile,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterCreationData",
));

const creationPayload = {
  type: "object",
  name: "util.KeyVal",
  args: { type: "dict", entries: [["modifiers", { type: "list", items: [] }]] },
};
const portraitPayload = {
  type: "object",
  name: "util.KeyVal",
  args: { type: "dict", entries: [["backgroundID", 1001]] },
};

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function extractListItems(value) {
  return value && value.type === "list" && Array.isArray(value.items)
    ? value.items
    : [];
}

function getDictEntry(value, key) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const entries = value.args && Array.isArray(value.args.entries)
    ? value.args.entries
    : Array.isArray(value.entries)
      ? value.entries
      : [];
  const entry = entries.find(([entryKey]) => entryKey === key);
  return entry ? entry[1] : undefined;
}

function getRowValue(row, column) {
  const header = extractListItems(getDictEntry(row, "header"));
  const line = extractListItems(getDictEntry(row, "line"));
  const columnIndex = header.indexOf(column);
  return columnIndex >= 0 ? line[columnIndex] : undefined;
}

test("modern CreateCharacterWithDoll stores identity and paper-doll metadata on parity", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalNotifications = cloneValue(database.read("notifications", "/").data);
  const originalIdentityState = cloneValue(database.read("identityState", "/").data);

  t.after(() => {
    database.write("identityState", "/", originalIdentityState);
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.write("skills", "/", originalSkills);
    database.write("notifications", "/", originalNotifications);
    database.flushAllSync();
  });

  const charService = new CharService();
  const charMgrService = new CharMgrService();
  const paperDollServer = new PaperDollServerService();
  const session = {
    userid: 910001,
    charid: null,
    characterID: null,
  };

  const appearanceInfo = {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: [
        ["sculpts", { type: "list", items: [{ sculptLocationID: 1, weightUpDown: 0.25 }] }],
        ["modifiers", { type: "list", items: [{ modifierLocationID: 10, paperdollResourceID: 20 }] }],
        ["appearance", { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["hairDarkness", 0.75]] } }],
      ],
    },
  };
  const portraitInfo = {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: [
        ["backgroundID", 1003],
        ["lightID", 2002],
        ["lightColorID", 3001],
        ["lightIntensity", 0.9],
        ["cameraFieldOfView", 0.55],
      ],
    },
  };
  const normalizedAppearanceInfo = clonePaperDollPayload(appearanceInfo);
  const normalizedPortraitInfo = clonePaperDollPayload(portraitInfo);

  const existingCharacterCount = charService.Handle_GetNumCharacters([], session);
  const newCharacterId = charService.Handle_CreateCharacterWithDoll(
    [
      "Parity Modern Contract",
      4,
      5,
      0,
      3,
      appearanceInfo,
      portraitInfo,
      11,
    ],
    session,
  );

  const record = getCharacterRecord(newCharacterId);
  assert.ok(record, "expected a created character record");
  assert.equal(record.characterName, "Parity Modern Contract");
  assert.equal(record.raceID, 4);
  assert.equal(record.bloodlineID, 5);
  assert.equal(record.gender, 0);
  assert.equal(record.ancestryID, 3);
  assert.equal(record.schoolID, 11);
  assert.equal(record.paperDollState, 0);
  assert.deepEqual(record.appearanceInfo, normalizedAppearanceInfo);
  assert.deepEqual(record.portraitInfo, normalizedPortraitInfo);

  assert.equal(
    charService.Handle_GetNumCharacters([], session),
    existingCharacterCount + 1,
  );

  const storedAppearance = paperDollServer.Handle_GetPaperDollData([newCharacterId], session);
  assert.deepEqual(storedAppearance, normalizedAppearanceInfo);

  const portraitTuple = paperDollServer.Handle_GetPaperDollPortraitDataFor(
    [newCharacterId],
    session,
  );
  const portraitItems = extractListItems(portraitTuple[0]);
  assert.equal(portraitItems.length, 1);
  assert.deepEqual(portraitItems[0], normalizedPortraitInfo);

  const paperDollState = charMgrService.Handle_GetPaperdollState(
    [newCharacterId],
    { characterID: newCharacterId, charid: newCharacterId },
  );
  assert.equal(paperDollState, 0);

  const creationDate = charMgrService.Handle_GetCharacterCreationDate(
    [newCharacterId],
    { characterID: newCharacterId, charid: newCharacterId },
  );
  assert.equal(creationDate.type, "long");
});

test("current container and legacy CreateCharacterWithDoll orders preserve school contracts", async (t) => {
  const mutableTables = [
    "characters",
    "items",
    "skills",
    "mail",
    "notifications",
    "identityState",
  ];
  const originals = Object.fromEntries(
    mutableTables.map((table) => [table, cloneValue(database.read(table, "/").data)]),
  );

  t.after(() => {
    for (const table of mutableTables) {
      database.write(table, "/", originals[table]);
    }
    database.flushAllSync();
  });

  assert.equal(
    CharService._testing.resolveCreateCharacterSignature(
      ["name", 5, 1, 2, creationPayload, portraitPayload, 31, 4],
    ),
    "latest-container",
  );
  assert.equal(
    CharService._testing.resolveCreateCharacterSignature(
      ["name", 4, 5, 1, 2, creationPayload, portraitPayload, 31],
    ),
    "ccsvc-wrapper",
  );
  assert.equal(
    CharService._testing.resolveCreateCharacterSignature(
      ["name", 1, 1, 2, creationPayload, portraitPayload, 35],
    ),
    "legacy",
  );

  const charService = new CharService();
  const session = { userid: 910010, charid: null, characterID: null };
  const currentID = charService.Handle_CreateCharacterWithDoll(
    [
      "Current Container Contract",
      5,
      1,
      2,
      creationPayload,
      portraitPayload,
      31,
      4,
    ],
    session,
  );
  const legacyID = charService.Handle_CreateCharacterWithDoll(
    [
      "Legacy Contract",
      1,
      1,
      2,
      creationPayload,
      portraitPayload,
      35,
    ],
    session,
  );

  const current = getCharacterRecord(currentID);
  const legacy = getCharacterRecord(legacyID);
  assert.equal(current.raceID, 4);
  assert.equal(current.bloodlineID, 5);
  assert.equal(current.schoolID, 31);
  assert.equal(
    current.corporationID,
    resolveCharacterCreationSchoolProfile(31).corporationID,
  );
  assert.equal(legacy.raceID, 1);
  assert.equal(legacy.bloodlineID, 1);
  assert.equal(legacy.schoolID, 35);
  assert.equal(
    legacy.corporationID,
    resolveCharacterCreationSchoolProfile(35).corporationID,
  );
});

test("starter schools 31 through 38 validate by race and reject cross-race choices", () => {
  const expectedRaces = new Map([
    [31, 4],
    [32, 4],
    [33, 2],
    [34, 2],
    [35, 1],
    [36, 1],
    [37, 8],
    [38, 8],
  ]);

  for (const [schoolID, raceID] of expectedRaces) {
    const school = getCharacterCreationSchool(schoolID);
    assert.ok(school);
    assert.equal(school.isStarterSpaceSchool, true);
    assert.equal(school.raceID, raceID);
    assert.equal(
      resolveCharacterCreationSchoolIDForRace(schoolID, raceID),
      schoolID,
    );
    assert.notEqual(
      resolveCharacterCreationSchoolIDForRace(schoolID, raceID === 1 ? 2 : 1),
      schoolID,
    );
  }
});

test("paperDollServer recustomization updates and char identity updates round-trip cleanly", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalNotifications = cloneValue(database.read("notifications", "/").data);
  const originalIdentityState = cloneValue(database.read("identityState", "/").data);

  t.after(() => {
    database.write("identityState", "/", originalIdentityState);
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.write("skills", "/", originalSkills);
    database.write("notifications", "/", originalNotifications);
    database.flushAllSync();
  });

  const charService = new CharService();
  const paperDollServer = new PaperDollServerService();
  const ownerSession = {
    userid: 910002,
    charid: null,
    characterID: null,
  };

  const charId = charService.Handle_CreateCharacterWithDoll(
    [
      "Recustomization Parity",
      1,
      1,
      1,
      1,
      { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["modifiers", { type: "list", items: [] }]] } },
      { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["backgroundID", 1001]] } },
      11,
    ],
    ownerSession,
  );

  ownerSession.charid = charId;
  ownerSession.characterID = charId;

  const limitedAppearanceInfo = {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: [
        ["sculpts", { type: "list", items: [] }],
        ["modifiers", { type: "list", items: [{ modifierLocationID: 7, paperdollResourceID: 88 }] }],
      ],
    },
  };
  const limitedPortraitInfo = {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: [
        ["backgroundID", 1005],
        ["lightID", 2006],
      ],
    },
  };
  const normalizedLimitedAppearanceInfo = clonePaperDollPayload(limitedAppearanceInfo);
  const normalizedLimitedPortraitInfo = clonePaperDollPayload(limitedPortraitInfo);

  paperDollServer.Handle_UpdateExistingCharacterLimited(
    [charId, limitedAppearanceInfo, limitedPortraitInfo, true],
    ownerSession,
  );

  let record = getCharacterRecord(charId);
  assert.deepEqual(record.appearanceInfo, normalizedLimitedAppearanceInfo);
  assert.deepEqual(record.portraitInfo, normalizedLimitedPortraitInfo);
  assert.equal(record.paperDollState, 0);

  charService.Handle_UpdateCharacterGender([charId, 0], ownerSession);
  record = getCharacterRecord(charId);
  assert.equal(record.gender, 0);
  assert.equal(ownerSession.genderID, 0);

  const updatedBloodlineProfile = resolveCharacterCreationBloodlineProfile(8, {
    raceID: record.raceID || 1,
    typeID: record.typeID || 1373,
    corporationID: record.corporationID || 1000009,
  });
  charService.Handle_UpdateCharacterBloodline([charId, 8], ownerSession);
  record = getCharacterRecord(charId);
  assert.equal(record.bloodlineID, 8);
  assert.equal(record.raceID, updatedBloodlineProfile.raceID);
  assert.equal(record.typeID, updatedBloodlineProfile.typeID);
  assert.equal(ownerSession.bloodlineID, 8);
  assert.equal(ownerSession.raceID, updatedBloodlineProfile.raceID);

  const storedAppearance = paperDollServer.Handle_GetPaperDollData([charId], ownerSession);
  assert.deepEqual(storedAppearance, normalizedLimitedAppearanceInfo);
});

test("female characters stay female across selection, public info, owner prime, and session apply", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalNotifications = cloneValue(database.read("notifications", "/").data);
  const originalIdentityState = cloneValue(database.read("identityState", "/").data);

  t.after(() => {
    database.write("identityState", "/", originalIdentityState);
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.write("skills", "/", originalSkills);
    database.write("notifications", "/", originalNotifications);
    database.flushAllSync();
  });

  const charService = new CharService();
  const charMgrService = new CharMgrService();
  const configService = new ConfigService();
  const ownerSession = {
    userid: 910003,
    charid: null,
    characterID: null,
  };

  const charId = charService.Handle_CreateCharacterWithDoll(
    [
      "Female Paperdoll Parity",
      8,
      7,
      0,
      1,
      { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["modifiers", { type: "list", items: [] }]] } },
      { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["backgroundID", 1001]] } },
      11,
    ],
    ownerSession,
  );

  const selectionPayload = charService.Handle_GetCharacterSelectionData([], ownerSession);
  const selectionCharacters = extractListItems(selectionPayload[2]);
  const selectedCharacter = selectionCharacters.find(
    (entry) => getDictEntry(entry, "characterID") === charId,
  );
  assert.ok(selectedCharacter, "expected created female character in selection payload");
  assert.equal(getDictEntry(selectedCharacter, "gender"), 0);
  assert.equal(getDictEntry(selectedCharacter, "finishedSkills"), 0);

  const selectionInfo = charService.Handle_GetCharacterToSelect([charId], ownerSession);
  assert.equal(getDictEntry(selectionInfo, "gender"), 0);

  const publicInfo = charMgrService.Handle_GetPublicInfo([charId], ownerSession);
  assert.equal(getDictEntry(publicInfo, "gender"), 0);

  const privateInfo = charMgrService.Handle_GetPrivateInfo([charId], ownerSession);
  assert.equal(getRowValue(privateInfo, "gender"), 0);

  const ownerRows = configService.Handle_GetMultiOwnersEx([[charId]], ownerSession);
  assert.equal(ownerRows[1][0][3], 0);

  const liveSession = {
    userid: ownerSession.userid,
    characterID: 0,
    charid: 0,
    role: 0,
    corprole: 0,
    rolesAtAll: 0,
    rolesAtBase: 0,
    rolesAtHQ: 0,
    rolesAtOther: 0,
  };
  const applyResult = applyCharacterToSession(liveSession, charId, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  assert.equal(liveSession.genderID, 0);
  assert.equal(liveSession.genderid, 0);
});
