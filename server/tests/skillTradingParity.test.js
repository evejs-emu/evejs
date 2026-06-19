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
const SkillMgrService = require(path.join(
  repoRoot,
  "server/src/services/skills/skillMgrService",
));
const AlphaInjectorMgrService = require(path.join(
  repoRoot,
  "server/src/services/_other/alphaInjectorMgrService",
));
const NonDiminishingInjectionMgrService = require(path.join(
  repoRoot,
  "server/src/services/_other/nonDiminishingInjectionMgrService",
));
const {
  buildSkillRecord,
  getCharacterSkills,
  getSkillTypeByID,
  getSkillTypes,
  replaceCharacterSkillRecords,
} = require(path.join(repoRoot, "server/src/services/skills/skillState"));
const {
  getDiminishedSpFromInjectors,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/trading/skillTradingRuntime",
));
const {
  TYPE_LARGE_SKILL_INJECTOR,
  TYPE_SMALL_SKILL_INJECTOR,
  TYPE_DAILY_ALPHA_INJECTOR,
  TYPE_MINI_SKILL_INJECTOR,
  TYPE_AIR_SKILL_INJECTOR,
  TYPE_QA_SKILL_INJECTOR,
  TYPE_ASI_2018_11,
  TYPE_OSI_2018_11,
  TYPE_SKILL_EXTRACTOR,
  resolveNextDowntimeFileTime,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/trading/skillTradingAuthority",
));
const {
  getCharacterSkillTradingState,
  updateCharacterSkillTradingState,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/trading/skillTradingState",
));
const {
  setCharacterQueueState,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/training/skillQueueState",
));
const {
  getNowFileTime,
  resetNowFileTimeOverride,
  setNowFileTimeOverride,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/training/skillTrainingMath",
));
const {
  findItemById,
  grantItemToCharacterLocation,
  listOwnedItems,
  resetInventoryStoreForTests,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  getCharacterRecord,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));
const {
  resetStoreCaches,
} = require(path.join(repoRoot, "server/src/services/newEdenStore/storeState"));

const TEST_CHARACTER_ID = 140000001;
const AMARR_TITAN = 3347;
const OUTPOST_CONSTRUCTION = 3400;
const ADVANCED_DOOMSDAY_OPERATION = 88377;
const SKILL_TRADING_TYPE_IDS = new Set([
  TYPE_LARGE_SKILL_INJECTOR,
  TYPE_SMALL_SKILL_INJECTOR,
  TYPE_DAILY_ALPHA_INJECTOR,
  TYPE_MINI_SKILL_INJECTOR,
  TYPE_AIR_SKILL_INJECTOR,
  TYPE_QA_SKILL_INJECTOR,
  TYPE_ASI_2018_11,
  TYPE_OSI_2018_11,
  TYPE_SKILL_EXTRACTOR,
]);

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

function captureThrownError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("Expected function to throw");
}

function setCharacterFreeSkillPoints(characterID, freeSkillPoints = 0) {
  const characters = cloneValue(database.read("characters", "/").data || {});
  characters[String(characterID)] = {
    ...(characters[String(characterID)] || {}),
    freeSkillPoints,
    finishedSkills: [],
    skillQueueEndTime: 0,
  };
  database.write("characters", "/", characters);
}

function forceSkillState(characterID, skillRecords = [], freeSkillPoints = 0) {
  replaceCharacterSkillRecords(characterID, skillRecords);
  setCharacterFreeSkillPoints(characterID, freeSkillPoints);
  database.write("skillQueues", "/", {});
}

function buildSkillRecordsUntilTotalPoints(characterID, minimumTotalPoints) {
  const skillTypes = getSkillTypes()
    .filter((skillType) => skillType && skillType.published !== false)
    .sort((left, right) => Number(right.skillRank || 0) - Number(left.skillRank || 0));
  const records = [];
  let totalPoints = 0;
  for (const skillType of skillTypes) {
    const record = buildSkillRecord(characterID, skillType, 5);
    records.push(record);
    totalPoints += Number(record.trainedSkillPoints || 0);
    if (totalPoints >= minimumTotalPoints) {
      break;
    }
  }
  assert.ok(
    totalPoints >= minimumTotalPoints,
    `expected to reach ${minimumTotalPoints} SP, only built ${totalPoints}`,
  );
  return records;
}

function buildSpecificSkillRecords(characterID, entries) {
  return entries.map(({ typeID, level }) => {
    const skillType = getSkillTypeByID(typeID);
    assert.ok(skillType, `missing skill type ${typeID}`);
    return buildSkillRecord(characterID, skillType, level);
  });
}

function buildSession(characterID, overrides = {}) {
  const characterRecord = getCharacterRecord(characterID);
  assert.ok(characterRecord, `missing character ${characterID}`);
  const notifications = [];
  const stationID = Number(characterRecord.stationID || 0);
  const baseShipTypeID =
    overrides.shipTypeID !== undefined ? overrides.shipTypeID : characterRecord.shipTypeID;
  const baseShipID =
    overrides.shipID !== undefined ? overrides.shipID : characterRecord.shipID;
  const session = {
    userid: Number(characterRecord.accountId || 1),
    characterID,
    charid: characterID,
    stationID,
    stationid: stationID,
    shipID: baseShipID,
    shipid: baseShipID,
    shipTypeID: baseShipTypeID,
    shiptypeid: baseShipTypeID,
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

function sumOwnedTypeQuantity(characterID, typeID) {
  return listOwnedItems(characterID)
    .filter((item) => Number(item.typeID) === Number(typeID))
    .reduce((sum, item) => {
      const quantity = Number(item.stacksize ?? item.quantity ?? (item.singleton === 1 ? 1 : 0));
      return sum + Math.max(0, quantity);
    }, 0);
}

function clearExistingSkillTradingItems(characterID) {
  const items = cloneValue(database.read("items", "/").data || {});
  for (const [itemID, item] of Object.entries(items)) {
    if (
      Number(item && item.ownerID) === Number(characterID) &&
      SKILL_TRADING_TYPE_IDS.has(Number(item && item.typeID))
    ) {
      delete items[itemID];
    }
  }
  database.write("items", "/", items);
  resetInventoryStoreForTests();
}

test("skill injectors follow CCP diminishing bands and non-diminishing overrides", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalQueues = cloneValue(database.read("skillQueues", "/").data);

  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    database.write("skillQueues", "/", originalQueues);
  });

  const cases = [
    {
      minimumTotalPoints: 4000000,
      assertBand(totalPoints) {
        assert.ok(totalPoints < 5000000);
      },
      largePoints: 500000,
      smallPoints: 100000,
    },
    {
      minimumTotalPoints: 40000000,
      assertBand(totalPoints) {
        assert.ok(totalPoints >= 5000000 && totalPoints < 50000000);
      },
      largePoints: 400000,
      smallPoints: 80000,
    },
    {
      minimumTotalPoints: 75000000,
      assertBand(totalPoints) {
        assert.ok(totalPoints >= 50000000 && totalPoints < 80000000);
      },
      largePoints: 300000,
      smallPoints: 60000,
    },
    {
      minimumTotalPoints: 81000000,
      assertBand(totalPoints) {
        assert.ok(totalPoints >= 80000000);
      },
      largePoints: 150000,
      smallPoints: 30000,
    },
  ];

  for (const testCase of cases) {
    const records = buildSkillRecordsUntilTotalPoints(
      TEST_CHARACTER_ID,
      testCase.minimumTotalPoints,
    );
    forceSkillState(TEST_CHARACTER_ID, records, 0);
    const totalPoints = getCharacterSkills(TEST_CHARACTER_ID).reduce(
      (sum, record) => sum + Number(record.trainedSkillPoints || 0),
      0,
    );
    testCase.assertBand(totalPoints);
    assert.equal(
      getDiminishedSpFromInjectors(TEST_CHARACTER_ID, TYPE_LARGE_SKILL_INJECTOR, 1, 0),
      testCase.largePoints,
    );
    assert.equal(
      getDiminishedSpFromInjectors(TEST_CHARACTER_ID, TYPE_SMALL_SKILL_INJECTOR, 1, 0),
      testCase.smallPoints,
    );
  }

  const overEightyMillion = buildSkillRecordsUntilTotalPoints(TEST_CHARACTER_ID, 81000000);
  forceSkillState(TEST_CHARACTER_ID, overEightyMillion, 0);
  assert.equal(
    getDiminishedSpFromInjectors(TEST_CHARACTER_ID, TYPE_LARGE_SKILL_INJECTOR, 2, 1),
    650000,
  );
});

test("large injector use consumes items, adds free SP, and emits non-diminishing usage parity events", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const originalTradingState = getCharacterSkillTradingState(TEST_CHARACTER_ID);

  t.after(() => {
    sessionRegistry.getSessions().forEach((session) => sessionRegistry.unregister(session));
    updateCharacterSkillTradingState(TEST_CHARACTER_ID, originalTradingState);
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    database.write("items", "/", originalItems);
    resetInventoryStoreForTests();
  });

  forceSkillState(
    TEST_CHARACTER_ID,
    buildSkillRecordsUntilTotalPoints(TEST_CHARACTER_ID, 81000000),
    0,
  );
  clearExistingSkillTradingItems(TEST_CHARACTER_ID);
  updateCharacterSkillTradingState(TEST_CHARACTER_ID, {
    nextAlphaInjectionAt: "0",
    nonDiminishingInjectionsRemaining: 1,
  });

  const session = buildSession(TEST_CHARACTER_ID);
  sessionRegistry.register(session);
  const skillMgr = new SkillMgrService();
  const nonDiminishingMgr = new NonDiminishingInjectionMgrService();
  const itemID = grantHangarItem(TEST_CHARACTER_ID, TYPE_LARGE_SKILL_INJECTOR, 2, session);

  const injectedPoints = skillMgr.Handle_InjectSkillpoints([itemID, 2], session);
  assert.equal(injectedPoints, 650000);
  assert.equal(getCharacterRecord(TEST_CHARACTER_ID).freeSkillPoints, 650000);
  assert.equal(findItemById(itemID), null);
  assert.equal(
    getCharacterSkillTradingState(TEST_CHARACTER_ID).nonDiminishingInjectionsRemaining,
    0,
  );
  assert.equal(
    nonDiminishingMgr.Handle_GetAvailableNonDiminishingInjections([], session),
    0,
  );
  assert.ok(
    session._notifications.some((entry) =>
      entry.name === "OnNonDiminishingInjectionsUsed" &&
      Array.isArray(entry.args) &&
      entry.args[0] === 1
    ),
  );
});

test("daily alpha injectors enforce clone-state and downtime cooldown parity", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const originalStoreRuntime = cloneValue(database.read("newEdenStoreRuntime", "/").data);
  const originalOmegaLicenseEnabled = config.omegaLicenseEnabled;
  const originalTradingState = getCharacterSkillTradingState(TEST_CHARACTER_ID);

  t.after(() => {
    updateCharacterSkillTradingState(TEST_CHARACTER_ID, originalTradingState);
    config.omegaLicenseEnabled = originalOmegaLicenseEnabled;
    resetStoreCaches();
    resetNowFileTimeOverride();
    database.write("newEdenStoreRuntime", "/", originalStoreRuntime);
    resetStoreCaches();
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    database.write("items", "/", originalItems);
    resetInventoryStoreForTests();
  });

  config.omegaLicenseEnabled = false;
  database.write("newEdenStoreRuntime", "/", { accounts: {} });
  resetStoreCaches();
  setNowFileTimeOverride(() => 133713371337000000n);
  forceSkillState(TEST_CHARACTER_ID, [], 0);
  clearExistingSkillTradingItems(TEST_CHARACTER_ID);
  updateCharacterSkillTradingState(TEST_CHARACTER_ID, {
    nextAlphaInjectionAt: "0",
    nonDiminishingInjectionsRemaining: 0,
  });

  const session = buildSession(TEST_CHARACTER_ID);
  const skillMgr = new SkillMgrService();
  const alphaInjectorMgr = new AlphaInjectorMgrService();
  const itemID = grantHangarItem(TEST_CHARACTER_ID, TYPE_DAILY_ALPHA_INJECTOR, 1, session);

  const initialNext = alphaInjectorMgr.Handle_GetNextAvailableInjection([], session);
  assert.equal(initialNext.type, "long");
  assert.equal(initialNext.value, 0n);

  const injectedPoints = skillMgr.Handle_InjectSkillpoints([itemID, 1], session);
  assert.equal(injectedPoints, 50000);
  assert.equal(getCharacterRecord(TEST_CHARACTER_ID).freeSkillPoints, 50000);

  const nextAvailable = alphaInjectorMgr.Handle_GetNextAvailableInjection([], session);
  const expectedNext = resolveNextDowntimeFileTime(getNowFileTime());
  assert.equal(nextAvailable.value, expectedNext);

  const secondItemID = grantHangarItem(
    TEST_CHARACTER_ID,
    TYPE_DAILY_ALPHA_INJECTOR,
    1,
    session,
  );
  const secondUseError = captureThrownError(() =>
    skillMgr.Handle_InjectSkillpoints([secondItemID, 1], session),
  );
  assert.equal(getUserErrorMessage(secondUseError), "AlreadyInjectedToday");
});

test("fixed-cap skill injectors respect their hard SP ceiling and preview only usable quantity", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);

  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    database.write("items", "/", originalItems);
    resetInventoryStoreForTests();
  });

  const lowRankSkillTypes = getSkillTypes()
    .filter((skillType) => Number(skillType && skillType.skillRank) === 1)
    .slice(0, 2);
  assert.equal(lowRankSkillTypes.length, 2);
  forceSkillState(
    TEST_CHARACTER_ID,
    [
      buildSkillRecord(TEST_CHARACTER_ID, getSkillTypeByID(AMARR_TITAN), 4),
      buildSkillRecord(TEST_CHARACTER_ID, getSkillTypeByID(ADVANCED_DOOMSDAY_OPERATION), 4),
      buildSkillRecord(TEST_CHARACTER_ID, lowRankSkillTypes[0], 4),
      buildSkillRecord(TEST_CHARACTER_ID, lowRankSkillTypes[1], 3),
    ],
    80000,
  );
  clearExistingSkillTradingItems(TEST_CHARACTER_ID);

  const session = buildSession(TEST_CHARACTER_ID);
  const skillMgr = new SkillMgrService();
  const previewPoints = skillMgr.Handle_GetDiminishedSpFromInjectors(
    [TYPE_MINI_SKILL_INJECTOR, 2, 0],
    session,
  );
  assert.equal(previewPoints, 25000);

  const itemID = grantHangarItem(TEST_CHARACTER_ID, TYPE_MINI_SKILL_INJECTOR, 2, session);
  const overLimitError = captureThrownError(() =>
    skillMgr.Handle_InjectSkillpoints([itemID, 2], session),
  );
  assert.equal(getUserErrorMessage(overLimitError), "InjectorSkillPointLimitReached");

  const singleUseResult = skillMgr.Handle_InjectSkillpoints([itemID, 1], session);
  assert.equal(singleUseResult, 25000);
  const secondUseError = captureThrownError(() =>
    skillMgr.Handle_InjectSkillpoints([itemID, 1], session),
  );
  assert.equal(getUserErrorMessage(secondUseError), "InjectorSkillPointLimitReached");
});

test("skill extraction enforces docked-capsule and queued-skill restrictions", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const originalQueues = cloneValue(database.read("skillQueues", "/").data);
  const originalOmegaLicenseEnabled = config.omegaLicenseEnabled;

  t.after(() => {
    config.omegaLicenseEnabled = originalOmegaLicenseEnabled;
    resetStoreCaches();
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    database.write("items", "/", originalItems);
    database.write("skillQueues", "/", originalQueues);
    resetInventoryStoreForTests();
  });

  config.omegaLicenseEnabled = true;
  resetStoreCaches();
  forceSkillState(
    TEST_CHARACTER_ID,
    buildSpecificSkillRecords(TEST_CHARACTER_ID, [
      { typeID: AMARR_TITAN, level: 4 },
      { typeID: OUTPOST_CONSTRUCTION, level: 5 },
      { typeID: ADVANCED_DOOMSDAY_OPERATION, level: 5 },
    ]),
    0,
  );
  clearExistingSkillTradingItems(TEST_CHARACTER_ID);
  setCharacterQueueState(TEST_CHARACTER_ID, {
    queue: [{ typeID: AMARR_TITAN, toLevel: 5 }],
    active: false,
    activeStartTime: null,
  });

  const skillMgr = new SkillMgrService();
  const extractorItemID = grantHangarItem(TEST_CHARACTER_ID, TYPE_SKILL_EXTRACTOR, 2);

  const shipSession = buildSession(TEST_CHARACTER_ID, { shipTypeID: 23911 });
  const notInCapsuleError = captureThrownError(() =>
    skillMgr.Handle_ExtractSkills(
      [{ [AMARR_TITAN]: 500000 }, extractorItemID],
      shipSession,
    ),
  );
  assert.equal(getUserErrorMessage(notInCapsuleError), "SkillExtractorNotInCapsule");

  const capsuleSession = buildSession(TEST_CHARACTER_ID, { shipTypeID: 670 });
  const queuedSkillError = captureThrownError(() =>
    skillMgr.Handle_ExtractSkills(
      [{ [AMARR_TITAN]: 500000 }, extractorItemID],
      capsuleSession,
    ),
  );
  assert.equal(getUserErrorMessage(queuedSkillError), "SkillExtractionQueuedSkill");
});

test("successful extraction consumes the extractor, reduces trained SP, and grants a large injector", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const originalQueues = cloneValue(database.read("skillQueues", "/").data);
  const originalOmegaLicenseEnabled = config.omegaLicenseEnabled;

  t.after(() => {
    config.omegaLicenseEnabled = originalOmegaLicenseEnabled;
    resetStoreCaches();
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    database.write("items", "/", originalItems);
    database.write("skillQueues", "/", originalQueues);
    resetInventoryStoreForTests();
  });

  config.omegaLicenseEnabled = true;
  resetStoreCaches();
  forceSkillState(
    TEST_CHARACTER_ID,
    buildSpecificSkillRecords(TEST_CHARACTER_ID, [
      { typeID: AMARR_TITAN, level: 4 },
      { typeID: OUTPOST_CONSTRUCTION, level: 5 },
      { typeID: ADVANCED_DOOMSDAY_OPERATION, level: 5 },
    ]),
    0,
  );
  clearExistingSkillTradingItems(TEST_CHARACTER_ID);

  const beforeRecord = getCharacterSkills(TEST_CHARACTER_ID)
    .find((record) => record.typeID === AMARR_TITAN);
  assert.ok(beforeRecord);

  const session = buildSession(TEST_CHARACTER_ID, { shipTypeID: 670 });
  const skillMgr = new SkillMgrService();
  const extractorItemID = grantHangarItem(TEST_CHARACTER_ID, TYPE_SKILL_EXTRACTOR, 1, session);

  const result = skillMgr.Handle_ExtractSkills(
    [{ [AMARR_TITAN]: 500000 }, extractorItemID],
    session,
  );
  assert.equal(result, null);
  assert.equal(sumOwnedTypeQuantity(TEST_CHARACTER_ID, TYPE_LARGE_SKILL_INJECTOR), 1);
  assert.equal(sumOwnedTypeQuantity(TEST_CHARACTER_ID, TYPE_SKILL_EXTRACTOR), 0);

  const afterRecord = getCharacterSkills(TEST_CHARACTER_ID)
    .find((record) => record.typeID === AMARR_TITAN);
  assert.ok(afterRecord);
  assert.equal(
    Number(afterRecord.trainedSkillPoints || 0),
    Number(beforeRecord.trainedSkillPoints || 0) - 500000,
  );
  assert.ok(Number(afterRecord.trainedSkillLevel || 0) < Number(beforeRecord.trainedSkillLevel || 0));
});

test("large and small injector stacks split and combine on parity with client actions", async (t) => {
  const originalItems = cloneValue(database.read("items", "/").data);

  t.after(() => {
    database.write("items", "/", originalItems);
    resetInventoryStoreForTests();
  });

  clearExistingSkillTradingItems(TEST_CHARACTER_ID);
  const session = buildSession(TEST_CHARACTER_ID);
  const skillMgr = new SkillMgrService();
  const largeInjectorItemID = grantHangarItem(
    TEST_CHARACTER_ID,
    TYPE_LARGE_SKILL_INJECTOR,
    2,
    session,
  );

  const splitCount = skillMgr.Handle_SplitSkillInjector([largeInjectorItemID, 2], session);
  assert.equal(splitCount, 2);
  assert.equal(sumOwnedTypeQuantity(TEST_CHARACTER_ID, TYPE_LARGE_SKILL_INJECTOR), 0);
  assert.equal(sumOwnedTypeQuantity(TEST_CHARACTER_ID, TYPE_SMALL_SKILL_INJECTOR), 10);

  const smallInjectorStack = listOwnedItems(TEST_CHARACTER_ID)
    .find((item) => Number(item.typeID) === TYPE_SMALL_SKILL_INJECTOR);
  assert.ok(smallInjectorStack, "expected a small injector stack after split");
  const combineCount = skillMgr.Handle_CombineSkillInjector(
    [smallInjectorStack.itemID, 10],
    session,
  );
  assert.equal(combineCount, 2);
  assert.equal(sumOwnedTypeQuantity(TEST_CHARACTER_ID, TYPE_SMALL_SKILL_INJECTOR), 0);
  assert.equal(sumOwnedTypeQuantity(TEST_CHARACTER_ID, TYPE_LARGE_SKILL_INJECTOR), 2);
});
