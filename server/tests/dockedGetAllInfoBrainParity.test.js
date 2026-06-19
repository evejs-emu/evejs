const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const {
  ITEM_FLAGS,
  grantItemToCharacterLocation,
  removeInventoryItem,
  resetInventoryStoreForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  getCharacterSkills,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/skillState",
));
const {
  buildIndustryAttributeChangePayloads,
} = require(path.join(
  repoRoot,
  "server/src/services/dogma/brain/providers/industryBrainProvider",
));
const {
  buildCharacterBrainUpdatePayload,
} = require(path.join(
  repoRoot,
  "server/src/services/dogma/brain/characterBrainRuntime",
));
const {
  marshalDecode,
} = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));
const {
  resolveItemByName,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));
const {
  normalizeText,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/serviceHelpers",
));

const transientItemIDs = [];

function findDockedCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    const activeShip = getActiveShipRecord(characterID);
    const stationID = Number(
      characterRecord && (characterRecord.stationID || characterRecord.stationid || 0),
    ) || 0;
    if (!characterRecord || !activeShip || stationID <= 0) {
      continue;
    }

    return {
      characterID,
      stationID,
      shipID: Number(activeShip.itemID) || 0,
    };
  }

  assert.fail("Expected at least one docked character with an active ship");
}

function buildDockedSession(candidate) {
  return {
    clientID: candidate.characterID + 92000,
    userid: candidate.characterID,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    stationid: candidate.stationID,
    stationID: candidate.stationID,
    locationid: candidate.stationID,
    shipID: candidate.shipID,
    shipid: candidate.shipID,
    activeShipID: candidate.shipID,
    sendNotification() {},
  };
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

function getDictEntryMap(value) {
  if (!value || value.type !== "dict" || !Array.isArray(value.entries)) {
    return new Map();
  }
  return new Map(
    value.entries.map(([entryKey, entryValue]) => [
      Buffer.isBuffer(entryKey) ||
      (entryKey &&
        typeof entryKey === "object" &&
        (entryKey.type === "token" ||
          entryKey.type === "wstring" ||
          entryKey.type === "rawstr"))
        ? normalizeText(entryKey, "")
        : entryKey,
      entryValue,
    ]),
  );
}

function getObjectStateMap(value) {
  if (
    !value ||
    (value.type !== "objectex1" && value.type !== "objectex2") ||
    !Array.isArray(value.header)
  ) {
    return new Map();
  }

  const stateDict =
    value.header.length >= 3 &&
    value.header[2] &&
    value.header[2].type === "dict" &&
    Array.isArray(value.header[2].entries)
      ? value.header[2]
      : null;
  return getDictEntryMap(stateDict);
}

function getBrainEffectSummaries(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const state = getObjectStateMap(entry);
      const extras = state.get("extras");
      const skills = state.get("skills");
      return {
        entry,
        state,
        toItemID: Number(state.get("toItemID")) || 0,
        modifierType: normalizeText(state.get("modifierType"), ""),
        targetAttributeID: Number(state.get("toAttribID")) || 0,
        operation: Number(state.get("operation")) || 0,
        value: Number(state.get("value")) || 0,
        extras:
          extras && extras.type === "list" && Array.isArray(extras.items)
            ? extras.items.map((value) => Number(value) || 0)
            : [],
        skills:
          skills && skills.type === "list" && Array.isArray(skills.items)
            ? skills.items.map((value) => Number(value) || 0)
            : [],
      };
    });
}

function resolveExpectedIndustryAttributes(characterID) {
  const skillLevels = new Map(
    getCharacterSkills(characterID).map((skill) => [
      Number(skill && skill.typeID) || 0,
      Math.max(
        0,
        Math.min(
          5,
          Number(
            skill &&
              (skill.effectiveSkillLevel ??
                skill.trainedSkillLevel ??
                skill.skillLevel),
          ) || 0,
        ),
      ),
    ]),
  );
  const getLevel = (typeID) => skillLevels.get(typeID) || 0;
  const applyPercentPerLevel = (baseValue, percentPerLevel, level) =>
    Number((baseValue * Math.max(0, 1 + (percentPerLevel * level) / 100)).toFixed(6));
  return {
    manufactureSlotLimit: 1 + getLevel(3387) + getLevel(24625),
    manufactureTimeMultiplier: applyPercentPerLevel(
      applyPercentPerLevel(1, -4, getLevel(3380)),
      -3,
      getLevel(3388),
    ),
    researchTimeMultiplier: applyPercentPerLevel(
      applyPercentPerLevel(1, -5, getLevel(3403)),
      -3,
      getLevel(3388),
    ),
    copySpeedPercent: applyPercentPerLevel(
      applyPercentPerLevel(1, -5, getLevel(3402)),
      -3,
      getLevel(3388),
    ),
    mineralNeedResearchSpeed: applyPercentPerLevel(
      applyPercentPerLevel(1, -5, getLevel(3409)),
      -3,
      getLevel(3388),
    ),
    maxLaborotorySlots: 1 + getLevel(3406) + getLevel(24624),
    inventionReverseEngineeringResearchSpeed: applyPercentPerLevel(
      1,
      -3,
      getLevel(3388),
    ),
    reactionTimeMultiplier: applyPercentPerLevel(1, -4, getLevel(45746)),
    reactionSlotLimit: 1 + getLevel(45748) + getLevel(45749),
  };
}

test.afterEach(() => {
  for (const itemID of transientItemIDs.splice(0)) {
    if (itemID > 0) {
      removeInventoryItem(itemID, { removeContents: true });
    }
  }
  resetInventoryStoreForTests();
});

test("docked ship-info GetAllInfo carries real bootstrap brain effects for station ship switching", () => {
  const candidate = findDockedCandidate();
  const session = buildDockedSession(candidate);
  const dogma = new DogmaService();

  const allInfo = dogma.Handle_GetAllInfo([false, true, null], session);
  const charInfo = getKeyValEntry(allInfo, "charInfo");

  assert.ok(
    Array.isArray(charInfo),
    "Expected docked ship-info GetAllInfo to include charInfo for client brain bootstrap",
  );
  assert.equal(charInfo.length, 2, "Expected charInfo to carry [characterInfo, charBrain]");
  assert.ok(
    charInfo[0] && charInfo[0].type === "dict",
    "Expected charInfo[0] to remain a packed character info dict",
  );
  assert.ok(
    Array.isArray(charInfo[1]) && charInfo[1].length === 4,
    "Expected docked char brain payload to stay on the four-slot V23.02 contract",
  );
  assert.ok(
    Array.isArray(charInfo[1][1]),
    "Expected docked char brain payload to keep character effects in slot 1",
  );
  assert.ok(
    Array.isArray(charInfo[1][2]),
    "Expected docked char brain payload to keep ship effects in slot 2",
  );
  assert.ok(
    charInfo[1][1].length > 0,
    "Expected docked char brain login bootstrap to include real character BrainEffects",
  );
  assert.ok(
    charInfo[1][2].length > 0,
    "Expected docked char brain login bootstrap to include real ship BrainEffects",
  );

  const shipEffects = getBrainEffectSummaries(charInfo[1][2]);
  assert.ok(
    shipEffects.some(
      (effect) =>
        effect.toItemID === candidate.shipID &&
        effect.modifierType === "M" &&
        effect.targetAttributeID === 11 &&
        effect.operation === 6 &&
        effect.value > 0 &&
        effect.skills.includes(3413),
    ),
    "Expected docked char brain bootstrap to include Power Grid Management ship modifiers",
  );
  assert.ok(
    shipEffects.some(
      (effect) =>
        effect.toItemID === candidate.shipID &&
        effect.modifierType === "M" &&
        effect.targetAttributeID === 48 &&
        effect.operation === 6 &&
        effect.value > 0 &&
        effect.skills.includes(3426),
    ),
    "Expected docked char brain bootstrap to include CPU Management ship modifiers",
  );
  assert.ok(
    shipEffects.some(
      (effect) =>
        effect.toItemID === candidate.shipID &&
        effect.modifierType === "M" &&
        effect.targetAttributeID === 482 &&
        effect.operation === 6 &&
        effect.value > 0 &&
        effect.skills.includes(3418),
    ),
    "Expected docked char brain bootstrap to target capacitor ship modifiers at the active ship item",
  );
});

test("docked ship-info GetAllInfo primes ship-modified character industry attributes for client quote parity", () => {
  const candidate = findDockedCandidate();
  const session = buildDockedSession(candidate);
  const dogma = new DogmaService();
  const expected = resolveExpectedIndustryAttributes(candidate.characterID);

  const allInfo = dogma.Handle_GetAllInfo([false, true, null], session);
  const shipModifiedCharAttribs = getKeyValEntry(allInfo, "shipModifiedCharAttribs");

  assert.ok(
    shipModifiedCharAttribs,
    "Expected GetAllInfo to include shipModifiedCharAttribs when ship dogma bootstrap is requested",
  );

  const attributeEntries = getDictEntryMap(
    getKeyValEntry(shipModifiedCharAttribs, "attributes"),
  );
  assert.equal(
    Number(attributeEntries.get(212)),
    1,
    "Expected shipModifiedCharAttribs to include base missileDamageMultiplier-style owner attributes instead of the old skinny payload",
  );
  assert.equal(
    Number(attributeEntries.get(196)),
    expected.manufactureSlotLimit,
    "Expected shipModifiedCharAttribs to prime manufactureSlotLimit from live character skills",
  );
  assert.equal(
    Number(attributeEntries.get(219)),
    expected.manufactureTimeMultiplier,
    "Expected shipModifiedCharAttribs to prime manufactureTimeMultiplier for client industry quote parity",
  );
  assert.equal(
    Number(attributeEntries.get(385)),
    expected.researchTimeMultiplier,
    "Expected shipModifiedCharAttribs to prime research time modifiers for client science quote parity",
  );
  assert.equal(
    Number(attributeEntries.get(467)),
    expected.maxLaborotorySlots,
    "Expected shipModifiedCharAttribs to prime maxLaborotorySlots from live character skills",
  );
});

test("CharGetInfo primes industry time and slot attributes for client industry preview parity", () => {
  const candidate = findDockedCandidate();
  const session = buildDockedSession(candidate);
  const dogma = new DogmaService();
  const charInfo = dogma.Handle_CharGetInfo([], session);
  const charEntry = getDictEntryMap(charInfo).get(candidate.characterID);

  assert.ok(charEntry, "Expected CharGetInfo to include the current character");

  const charFields = new Map(charEntry.args.entries);
  const attributes = getDictEntryMap(charFields.get("attributes"));
  const expected = resolveExpectedIndustryAttributes(candidate.characterID);

  assert.equal(
    Number(attributes.get(196)),
    expected.manufactureSlotLimit,
    "Expected CharGetInfo to prime manufactureSlotLimit from the live character skills",
  );
  assert.equal(
    Number(attributes.get(219)),
    expected.manufactureTimeMultiplier,
    "Expected CharGetInfo to prime manufactureTimeMultiplier for industry preview parity",
  );
  assert.equal(
    Number(attributes.get(385)),
    expected.researchTimeMultiplier,
    "Expected CharGetInfo to prime research time modifiers for science preview parity",
  );
  assert.equal(
    Number(attributes.get(387)),
    expected.copySpeedPercent,
    "Expected CharGetInfo to prime copy speed modifiers for industry preview parity",
  );
  assert.equal(
    Number(attributes.get(398)),
    expected.mineralNeedResearchSpeed,
    "Expected CharGetInfo to prime material research speed modifiers for science preview parity",
  );
  assert.equal(
    Number(attributes.get(467)),
    expected.maxLaborotorySlots,
    "Expected CharGetInfo to prime maxLaborotorySlots from the live character skills",
  );
  assert.equal(
    Number(attributes.get(1959)),
    expected.inventionReverseEngineeringResearchSpeed,
    "Expected CharGetInfo to prime invention speed modifiers for industry preview parity",
  );
  assert.equal(
    Number(attributes.get(2662)),
    expected.reactionTimeMultiplier,
    "Expected CharGetInfo to prime reaction time modifiers for industry preview parity",
  );
  assert.equal(
    Number(attributes.get(2664)),
    expected.reactionSlotLimit,
    "Expected CharGetInfo to prime reactionSlotLimit from the live character skills",
  );
});

test("industry modifier sync keeps the normal character attribute delta lane alive alongside real brain updates", () => {
  const candidate = findDockedCandidate();
  const session = buildDockedSession(candidate);
  const expected = resolveExpectedIndustryAttributes(candidate.characterID);
  const changes = buildIndustryAttributeChangePayloads(session, candidate.characterID);

  assert.equal(
    changes.length,
    9,
    "Expected the industry modifier sync to cover all character-level industry attributes",
  );

  const changesByAttributeID = new Map(
    changes.map((change) => [Number(change[3]) || 0, change]),
  );
  assert.equal(
    changes.every((change) => change[0] === "OnModuleAttributeChanges"),
    true,
    "Expected industry modifier sync to use the normal OnModuleAttributeChanges lane",
  );
  assert.equal(
    changes.every((change) => Number(change[1]) === candidate.characterID),
    true,
    "Expected industry modifier sync to publish the pilot as the owner of the attribute delta",
  );
  assert.equal(
    changes.every((change) => Number(change[2]) === candidate.characterID),
    true,
    "Expected industry modifier sync to target the live character dogma item",
  );
  assert.equal(Number(changesByAttributeID.get(196)[5]), expected.manufactureSlotLimit);
  assert.equal(Number(changesByAttributeID.get(219)[5]), expected.manufactureTimeMultiplier);
  assert.equal(Number(changesByAttributeID.get(385)[5]), expected.researchTimeMultiplier);
  assert.equal(Number(changesByAttributeID.get(387)[5]), expected.copySpeedPercent);
  assert.equal(Number(changesByAttributeID.get(398)[5]), expected.mineralNeedResearchSpeed);
  assert.equal(Number(changesByAttributeID.get(467)[5]), expected.maxLaborotorySlots);
  assert.equal(Number(changesByAttributeID.get(1959)[5]), expected.inventionReverseEngineeringResearchSpeed);
  assert.equal(Number(changesByAttributeID.get(2662)[5]), expected.reactionTimeMultiplier);
  assert.equal(Number(changesByAttributeID.get(2664)[5]), expected.reactionSlotLimit);
});

test("brain update payload carries real character and ship BrainEffects for clientDogmaIM", () => {
  const candidate = findDockedCandidate();
  const payload = buildCharacterBrainUpdatePayload(candidate.characterID, 7);

  assert.ok(Array.isArray(payload), "Expected an OnServerBrainUpdated payload tuple");
  assert.equal(payload[0], 7, "Expected explicit brain versions to be preserved");
  assert.ok(Buffer.isBuffer(payload[1]), "Expected grayMatter to stay marshaled");

  const decodedBrain = marshalDecode(payload[1]);
  assert.equal(Array.isArray(decodedBrain), true);
  assert.equal(decodedBrain.length, 3);
  assert.equal(decodedBrain[0] && decodedBrain[0].type, "list");
  assert.equal(decodedBrain[1] && decodedBrain[1].type, "list");
  assert.equal(decodedBrain[2] && decodedBrain[2].type, "list");
  assert.ok(
    Array.isArray(decodedBrain[0].items) && decodedBrain[0].items.length > 0,
    "Expected character grayMatter to include BrainEffect entries",
  );
  assert.ok(
    Array.isArray(decodedBrain[1].items) && decodedBrain[1].items.length > 0,
    "Expected ship grayMatter to include BrainEffect entries",
  );
  assert.equal(
    Array.isArray(decodedBrain[2].items),
    true,
    "Expected structure grayMatter slot to stay list-shaped even when no structure effects apply",
  );

  for (const entry of decodedBrain[0].items) {
    assert.equal(
      entry && entry.type,
      "objectex1",
      "Expected industry character effects to marshal as BrainEffect objectex entries",
    );
    assert.ok(
      Array.isArray(entry.header) && entry.header.length >= 2,
      "Expected BrainEffect objectex headers to carry constructor metadata",
    );
    assert.equal(
      entry.header[0] && entry.header[0].value,
      "eve.common.script.dogma.effect.BrainEffect",
      "Expected BrainEffect entries to use the CCP dogma BrainEffect class token",
    );
    assert.ok(
      Array.isArray(entry.header[1]) && entry.header[1].length >= 5,
      "Expected BrainEffect objectex entries to carry constructor arguments",
    );

    const state = getObjectStateMap(entry);
    assert.ok(state.has("value"), "Expected BrainEffect state to include the resolved literal value");
    assert.ok(state.has("toAttribID"), "Expected BrainEffect state to include the target attribute");
    const skills = state.get("skills");
    assert.equal(
      skills && skills.type,
      "list",
      "Expected BrainEffect state to include the merged skill list",
    );
    assert.ok(
      Array.isArray(skills.items) && skills.items.length > 0,
      "Expected BrainEffect state to include at least one contributing skill typeID",
    );
  }

  const shipEffects = getBrainEffectSummaries(decodedBrain[1].items);
  assert.ok(
    shipEffects.some(
      (effect) =>
        effect.toItemID === candidate.shipID &&
        effect.modifierType === "M" &&
        effect.targetAttributeID === 11 &&
        effect.operation === 6 &&
        effect.value > 0 &&
        effect.skills.includes(3413),
    ),
    "Expected ship grayMatter to include Power Grid Management ship effects",
  );
  assert.ok(
    shipEffects.some(
      (effect) =>
        effect.toItemID === candidate.shipID &&
        effect.modifierType === "M" &&
        effect.targetAttributeID === 48 &&
        effect.operation === 6 &&
        effect.value > 0 &&
        effect.skills.includes(3426),
    ),
    "Expected ship grayMatter to include CPU Management ship effects",
  );
  assert.ok(
    shipEffects.some(
      (effect) =>
        effect.toItemID === candidate.shipID &&
        effect.modifierType === "M" &&
        effect.targetAttributeID === 482 &&
        effect.operation === 6 &&
        effect.value > 0 &&
        effect.skills.includes(3418),
    ),
    "Expected ship grayMatter to target capacitor skill effects at the active ship item",
  );
});

test("docked ship-info GetAllInfo keeps dogma invItem rows on the CCP customInfo-stacksize-singleton order", () => {
  const candidate = findDockedCandidate();
  const session = buildDockedSession(candidate);
  const dogma = new DogmaService();

  const allInfo = dogma.Handle_GetAllInfo([false, true, null], session);
  const shipInfo = getKeyValEntry(allInfo, "shipInfo");
  const shipEntry = getDictEntryMap(shipInfo).get(candidate.shipID);
  assert.ok(shipEntry, "Expected GetAllInfo shipInfo to include the active docked ship");

  const shipFields = new Map(shipEntry.args.entries);
  const invItem = shipFields.get("invItem");
  assert.ok(invItem, "Expected shipInfo entry to include invItem");

  const invEntries = new Map(invItem.args.entries);
  const header = invEntries.get("header");
  const line = invEntries.get("line");

  assert.deepEqual(
    header,
    [
      "itemID",
      "typeID",
      "ownerID",
      "locationID",
      "flagID",
      "quantity",
      "groupID",
      "categoryID",
      "customInfo",
      "stacksize",
      "singleton",
    ],
    "Expected dogma invItem header order to match the live client inventory row contract",
  );
  assert.equal(
    line.length,
    header.length,
    "Expected dogma invItem row length to match the row header",
  );
  assert.equal(
    line[8],
    String(line[8] ?? ""),
    "Expected customInfo to remain in the ninth slot of the dogma invItem row",
  );
  assert.equal(
    Number(line[9]) >= 0,
    true,
    "Expected stacksize to occupy the tenth slot of the dogma invItem row",
  );
  assert.ok(
    Number.isInteger(Number(line[10])),
    "Expected singleton to occupy the final slot of the dogma invItem row",
  );
});

test("dogma ItemGetInfo keeps stackable invItem rows on the CCP customInfo-stacksize-singleton order", () => {
  resetInventoryStoreForTests();
  const candidate = findDockedCandidate();
  const session = buildDockedSession(candidate);
  const dogma = new DogmaService();
  const droneType = resolveItemByName("Acolyte II");
  assert.equal(droneType && droneType.success, true, "Expected Acolyte II metadata");

  const grantResult = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.shipID,
    ITEM_FLAGS.DRONE_BAY,
    droneType.match,
    5,
    { transient: true },
  );
  assert.equal(grantResult.success, true, "Expected a transient stacked drone item");
  const stackedDroneItem = grantResult.data && grantResult.data.items && grantResult.data.items[0];
  assert.ok(stackedDroneItem && stackedDroneItem.itemID, "Expected the transient stack to have an itemID");
  transientItemIDs.push(Number(stackedDroneItem.itemID) || 0);

  const itemInfo = dogma.Handle_ItemGetInfo([stackedDroneItem.itemID], session);
  const itemFields = new Map(itemInfo.args.entries);
  const invItem = itemFields.get("invItem");
  assert.ok(invItem, "Expected ItemGetInfo to expose invItem");

  const invEntries = new Map(invItem.args.entries);
  const header = invEntries.get("header");
  const line = invEntries.get("line");
  assert.deepEqual(
    header,
    [
      "itemID",
      "typeID",
      "ownerID",
      "locationID",
      "flagID",
      "quantity",
      "groupID",
      "categoryID",
      "customInfo",
      "stacksize",
      "singleton",
    ],
    "Expected ItemGetInfo invItem header order to match CCP dogma rows",
  );
  assert.equal(
    Number(line[9]),
    5,
    "Expected stacksize to remain in the tenth slot for stacked dogma invItem rows",
  );
  assert.equal(
    Number(line[10]),
    0,
    "Expected singleton to remain in the final slot for stacked dogma invItem rows",
  );
});
