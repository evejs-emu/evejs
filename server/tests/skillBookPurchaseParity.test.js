const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const config = require(path.join(repoRoot, "server/src/config"));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const SkillHandlerService = require(path.join(
  repoRoot,
  "server/src/services/skills/skillHandlerService",
));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const {
  buildSkillRecord,
  getCharacterBaseSkillMap,
  getSkillTypeByID,
  getSkillTypes,
  replaceCharacterSkillRecords,
} = require(path.join(repoRoot, "server/src/services/skills/skillState"));
const {
  getQueueSnapshot,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/training/skillQueueRuntime",
));
const {
  REF_SKILL_PURCHASE,
  getDirectPurchasePrice,
  isSkillAvailableForDirectPurchase,
  resetSkillbookRuntimeCacheForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/skillbooks/skillbookRuntime",
));
const {
  findItemById,
  grantItemToCharacterLocation,
  resetInventoryStoreForTests,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  getCharacterRecord,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));
const {
  getCharacterWallet,
  setCharacterBalance,
} = require(path.join(repoRoot, "server/src/services/account/walletState"));
const {
  buildGlobalConfigEntries,
} = require(path.join(repoRoot, "server/src/services/machoNet/globalConfig"));

const TEST_CHARACTER_ID = 140000001;
const DIRECT_PURCHASE_SKILL = 3449; // Navigation: published, no direct-purchase edge case.
const SKILLBOOK_ITEM_SKILL = 3411; // Cybernetics: published and stackable as a skillbook item.
const UNAVAILABLE_PURCHASE_SKILL = 23087; // Published but no direct skillbook base price in local data.
const BASELINE_KNOWN_SKILL = 3402; // Science keeps test characters non-empty without knowing the tested books.

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getUserErrorMessage(error) {
  return (
    error &&
    error.machoErrorResponse &&
    error.machoErrorResponse.payload &&
    Array.isArray(error.machoErrorResponse.payload.header) &&
    Array.isArray(error.machoErrorResponse.payload.header[1]) &&
    error.machoErrorResponse.payload.header[1][0]
  ) || null;
}

function getUserErrorDict(error) {
  const dictHeader =
    error &&
    error.machoErrorResponse &&
    error.machoErrorResponse.payload &&
    Array.isArray(error.machoErrorResponse.payload.header) &&
    Array.isArray(error.machoErrorResponse.payload.header[1]) &&
    error.machoErrorResponse.payload.header[1][1];
  return dictHeader && Array.isArray(dictHeader.entries)
    ? Object.fromEntries(dictHeader.entries)
    : {};
}

function captureThrownError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("Expected function to throw");
}

function forceSkillState(characterID, skillRecords = []) {
  replaceCharacterSkillRecords(characterID, skillRecords);
  database.write("skillQueues", "/", {});
}

function buildBaselineSkillRecords(characterID) {
  return [
    buildSkillRecord(
      characterID,
      getSkillTypeByID(BASELINE_KNOWN_SKILL),
      0,
    ),
  ];
}

function buildSession(characterID, overrides = {}) {
  const characterRecord = getCharacterRecord(characterID);
  assert.ok(characterRecord, `missing character ${characterID}`);
  const notifications = [];
  const stationID = Number(characterRecord.stationID || 0);
  const session = {
    userid: Number(characterRecord.accountId || 1),
    characterID,
    charid: characterID,
    stationID,
    stationid: stationID,
    shipID: Number(characterRecord.shipID || 0),
    shipid: Number(characterRecord.shipID || 0),
    shipTypeID: Number(characterRecord.shipTypeID || 0),
    shiptypeid: Number(characterRecord.shipTypeID || 0),
    lastActivity: Date.now(),
    connectTime: Date.now(),
    clientID: 1,
    socket: { destroyed: false },
    sendNotification(name, scope, args) {
      notifications.push({ name, scope, args });
    },
    sendSessionChange() {},
    ...overrides,
  };
  session._notifications = notifications;
  return session;
}

function grantHangarItem(characterID, typeID, quantity, session) {
  const characterRecord = getCharacterRecord(characterID);
  const grantResult = grantItemToCharacterLocation(
    characterID,
    Number(characterRecord.stationID || session.stationID || session.stationid || 0),
    4,
    typeID,
    quantity,
  );
  assert.equal(grantResult.success, true);
  const createdItems = (grantResult.data && grantResult.data.items) || [];
  assert.ok(createdItems.length > 0, `expected ${typeID} item grant`);
  return createdItems[0].itemID;
}

function hasNotification(session, name) {
  return session._notifications.some((notification) => notification.name === name);
}

function setupIsolatedSkillbookTest(t) {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalQueues = cloneValue(database.read("skillQueues", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const originalSkillPurchaseEnabled = config.skillPurchaseEnabled;

  t.after(() => {
    sessionRegistry.getSessions().forEach((session) => sessionRegistry.unregister(session));
    config.skillPurchaseEnabled = originalSkillPurchaseEnabled;
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    database.write("skillQueues", "/", originalQueues);
    database.write("items", "/", originalItems);
    resetInventoryStoreForTests();
    resetSkillbookRuntimeCacheForTests();
  });
}

test("direct skill purchase follows CCP price, wallet, injection, and live UI notification parity", (t) => {
  setupIsolatedSkillbookTest(t);
  config.skillPurchaseEnabled = true;
  forceSkillState(TEST_CHARACTER_ID, buildBaselineSkillRecords(TEST_CHARACTER_ID));
  setCharacterBalance(TEST_CHARACTER_ID, 1_000_000, {
    description: "Skillbook purchase test setup",
  });

  const session = buildSession(TEST_CHARACTER_ID);
  sessionRegistry.register(session);
  const skillHandler = new SkillHandlerService();
  const expectedCost = getDirectPurchasePrice(DIRECT_PURCHASE_SKILL);

  const purchased = skillHandler.Handle_PurchaseSkills([[DIRECT_PURCHASE_SKILL]], session);

  assert.deepEqual(purchased, [DIRECT_PURCHASE_SKILL]);
  const injectedSkill = getCharacterBaseSkillMap(TEST_CHARACTER_ID, {
    includeExpertSystems: false,
  }).get(DIRECT_PURCHASE_SKILL);
  assert.ok(injectedSkill);
  assert.equal(injectedSkill.trainedSkillLevel, 0);
  assert.equal(injectedSkill.trainedSkillPoints, 0);
  assert.equal(getCharacterWallet(TEST_CHARACTER_ID).balance, 1_000_000 - expectedCost);
  assert.equal(
    getCharacterRecord(TEST_CHARACTER_ID).walletJournal[0].entryTypeID,
    REF_SKILL_PURCHASE,
  );
  assert.equal(hasNotification(session, "OnAccountChange"), true);
  assert.equal(hasNotification(session, "OnServerSkillsChanged"), true);
  assert.equal(hasNotification(session, "OnSkillsChanged"), true);
  assert.equal(hasNotification(session, "OnSkillLevelsTrained"), false);
});

test("direct skill purchase rejects unavailable, known, disabled, duplicate, and underfunded requests", (t) => {
  setupIsolatedSkillbookTest(t);
  forceSkillState(TEST_CHARACTER_ID, buildBaselineSkillRecords(TEST_CHARACTER_ID));
  setCharacterBalance(TEST_CHARACTER_ID, 1_000_000, {
    description: "Skillbook purchase test setup",
  });

  const session = buildSession(TEST_CHARACTER_ID);
  const skillHandler = new SkillHandlerService();

  let error = captureThrownError(() =>
    skillHandler.Handle_PurchaseSkills([[UNAVAILABLE_PURCHASE_SKILL]], session),
  );
  assert.equal(getUserErrorMessage(error), "SkillUnavailableForPurchase");

  error = captureThrownError(() =>
    skillHandler.Handle_PurchaseSkills([[DIRECT_PURCHASE_SKILL, DIRECT_PURCHASE_SKILL]], session),
  );
  assert.equal(getUserErrorMessage(error), "SkillPurchaseUnknownError");

  config.skillPurchaseEnabled = false;
  error = captureThrownError(() =>
    skillHandler.Handle_PurchaseSkills([[DIRECT_PURCHASE_SKILL]], session),
  );
  assert.equal(getUserErrorMessage(error), "SkillPurchaseDisabled");

  config.skillPurchaseEnabled = true;
  forceSkillState(TEST_CHARACTER_ID, [
    buildSkillRecord(
      TEST_CHARACTER_ID,
      getSkillTypeByID(DIRECT_PURCHASE_SKILL),
      0,
    ),
  ]);
  error = captureThrownError(() =>
    skillHandler.Handle_PurchaseSkills([[DIRECT_PURCHASE_SKILL]], session),
  );
  assert.equal(getUserErrorMessage(error), "CharacterAlreadyKnowsSkill");

  forceSkillState(TEST_CHARACTER_ID, buildBaselineSkillRecords(TEST_CHARACTER_ID));
  setCharacterBalance(TEST_CHARACTER_ID, 1, {
    description: "Skillbook purchase underfund test setup",
  });
  error = captureThrownError(() =>
    skillHandler.Handle_PurchaseSkills([[DIRECT_PURCHASE_SKILL]], session),
  );
  assert.equal(getUserErrorMessage(error), "NotEnoughMoney");
  assert.equal(
    Number(getUserErrorDict(error).balance || 0),
    1,
    "Expected the retail NotEnoughMoney payload to include the current wallet balance",
  );
  assert.equal(
    Number(getUserErrorDict(error).amount || 0),
    Number(getDirectPurchasePrice(DIRECT_PURCHASE_SKILL) || 0),
    "Expected the retail NotEnoughMoney payload to include the required purchase amount",
  );
});

test("dogma skillbook injection consumes the exact stack, injects level zero, and refreshes the UI", (t) => {
  setupIsolatedSkillbookTest(t);
  forceSkillState(TEST_CHARACTER_ID, buildBaselineSkillRecords(TEST_CHARACTER_ID));

  const session = buildSession(TEST_CHARACTER_ID);
  sessionRegistry.register(session);
  const dogma = new DogmaService();
  const itemID = grantHangarItem(TEST_CHARACTER_ID, SKILLBOOK_ITEM_SKILL, 2, session);

  const injected = dogma.Handle_InjectSkillIntoBrain([[itemID]], session);

  assert.deepEqual(injected, [SKILLBOOK_ITEM_SKILL]);
  const remainingItem = findItemById(itemID);
  assert.ok(remainingItem);
  assert.equal(Number(remainingItem.stacksize || remainingItem.quantity), 1);
  const injectedSkill = getCharacterBaseSkillMap(TEST_CHARACTER_ID, {
    includeExpertSystems: false,
  }).get(SKILLBOOK_ITEM_SKILL);
  assert.ok(injectedSkill);
  assert.equal(injectedSkill.trainedSkillLevel, 0);
  assert.equal(injectedSkill.trainedSkillPoints, 0);
  assert.equal(hasNotification(session, "OnServerSkillsChanged"), true);
  assert.equal(hasNotification(session, "OnSkillsChanged"), true);
  assert.equal(hasNotification(session, "OnSkillLevelsTrained"), false);
});

test("skill plan buy-and-train flow can purchase then queue the same skill immediately", (t) => {
  setupIsolatedSkillbookTest(t);
  config.skillPurchaseEnabled = true;
  forceSkillState(TEST_CHARACTER_ID, buildBaselineSkillRecords(TEST_CHARACTER_ID));
  setCharacterBalance(TEST_CHARACTER_ID, 1_000_000, {
    description: "Skill plan buy-and-train test setup",
  });

  const session = buildSession(TEST_CHARACTER_ID);
  sessionRegistry.register(session);
  const skillHandler = new SkillHandlerService();

  assert.deepEqual(
    skillHandler.Handle_PurchaseSkills([[DIRECT_PURCHASE_SKILL]], session),
    [DIRECT_PURCHASE_SKILL],
  );
  skillHandler.Handle_CharStartTrainingSkillByTypeID([DIRECT_PURCHASE_SKILL, 1], session);

  const snapshot = getQueueSnapshot(TEST_CHARACTER_ID);
  assert.equal(snapshot.queueEntries.length, 1);
  assert.equal(Number(snapshot.queueEntries[0].trainingTypeID), DIRECT_PURCHASE_SKILL);
  assert.equal(Number(snapshot.queueEntries[0].trainingToLevel), 1);
  assert.equal(hasNotification(session, "OnNewSkillQueueSaved"), true);
});

test("direct-purchase authority covers every published skillbook with CCP-style base-price availability", () => {
  const originalSkillPurchaseEnabled = config.skillPurchaseEnabled;
  config.skillPurchaseEnabled = true;
  try {
    const publishedSkills = getSkillTypes()
      .filter((skillType) => skillType && skillType.published !== false);
    const purchasable = publishedSkills.filter(
      (skillType) => Number.isFinite(Number(skillType.basePrice)) && Number(skillType.basePrice) > 0,
    );
    const unavailable = publishedSkills.filter(
      (skillType) => !(Number.isFinite(Number(skillType.basePrice)) && Number(skillType.basePrice) > 0),
    );

    assert.equal(purchasable.length > 400, true);
    for (const skillType of purchasable) {
      assert.equal(isSkillAvailableForDirectPurchase(skillType.typeID), true, skillType.name);
    }
    for (const skillType of unavailable) {
      assert.equal(isSkillAvailableForDirectPurchase(skillType.typeID), false, skillType.name);
    }
    assert.ok(buildGlobalConfigEntries().some(([key, value]) =>
      key === "SkillPurchaseEnabled" && value === 1
    ));
  } finally {
    config.skillPurchaseEnabled = originalSkillPurchaseEnabled;
  }
});
