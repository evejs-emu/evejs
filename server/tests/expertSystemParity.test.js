const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const config = require(path.join(repoRoot, "server/src/config"));
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const chatCommands = require(path.join(
  repoRoot,
  "server/src/services/chat/chatCommands",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const ExpertSystemMgrService = require(path.join(
  repoRoot,
  "server/src/services/character/expertSystemMgrService",
));
const SkillMgrService = require(path.join(
  repoRoot,
  "server/src/services/skills/skillMgrService",
));
const {
  getCharacterRecord,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));
const {
  ITEM_FLAGS,
  findItemById,
  grantItemToCharacterLocation,
  resetInventoryStoreForTests,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(repoRoot, "server/src/services/inventory/itemTypeRegistry"));
const {
  buildGlobalConfigEntries,
} = require(path.join(repoRoot, "server/src/services/machoNet/globalConfig"));
const {
  buildSkillRecord,
  getCharacterBaseSkillMap,
  getCharacterSkillMap,
  getSkillTypeByID,
  replaceCharacterSkillRecords,
} = require(path.join(repoRoot, "server/src/services/skills/skillState"));
const {
  getExpertSystemByTypeID,
  isExpertSystemType,
  listExpertSystems,
  resolveExpertSystemQuery,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/expertSystems/expertSystemCatalog",
));
const {
  clearExpertSystemsForCharacter,
  consumeExpertSystemItem,
  getExpertSystemStatus,
  installExpertSystemForCharacter,
  removeExpertSystemFromCharacter,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/expertSystems/expertSystemRuntime",
));
const {
  clearExpertSystemProjectionCache,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/expertSystems/expertSystemProjection",
));
const {
  resetExpertSystemStateForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/expertSystems/expertSystemState",
));
const {
  clearExpertSystemExpiryScheduler,
  expireDueExpertSystems,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/expertSystems/expertSystemExpiryScheduler",
));
const {
  saveQueue,
} = require(path.join(repoRoot, "server/src/services/skills/training/skillQueueRuntime"));

const TEST_CHARACTER_ID = 140000004;
const INDUSTRY = 3380;
const MINING_BARGE = 17940;
const MINING_BARGE_OPERATIONS_ES = 57207;
const KIKIMORA_PILOT = 88856;
const PRECURSOR_DESTROYER = 49742;
const AMARR_EXPLORATION_ES = 57203;
const CALDARI_EXPLORATION_ES = 57204;
const AFTERBURNER = 3450;
const HIDDEN_QA_ES = 57190;
const OODA_LOOP_EXPERT_SYSTEM_PACKAGE = 54811;
const UNRELEASED_EXPERT_SYSTEM = 85684;

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

function buildLiveSession(characterID) {
  const characterRecord = getCharacterRecord(characterID);
  assert.ok(characterRecord, `missing character ${characterID}`);
  const notifications = [];
  return {
    userid: Number(characterRecord.accountId || 1),
    characterID,
    charid: characterID,
    stationID: Number(characterRecord.stationID || 60003760),
    stationid: Number(characterRecord.stationID || 60003760),
    socket: { destroyed: false },
    _notifications: notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function restoreExpertSystemTestState(t, extraRestore = () => {}) {
  const originalCharacters = cloneValue(database.read("characters", "/").data || {});
  const originalSkills = cloneValue(database.read("skills", "/").data || {});
  const originalQueues = cloneValue(database.read("skillQueues", "/").data || {});
  const originalItems = cloneValue(database.read("items", "/").data || {});
  const originalExpertSystems = cloneValue(database.read("characterExpertSystems", "/").data || {});
  const originalExpertSystemsEnabled = config.expertSystemsEnabled;

  t.after(() => {
    sessionRegistry.getSessions().forEach((session) => sessionRegistry.unregister(session));
    config.expertSystemsEnabled = originalExpertSystemsEnabled;
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    database.write("skillQueues", "/", originalQueues);
    database.write("items", "/", originalItems);
    database.write("characterExpertSystems", "/", originalExpertSystems);
    resetInventoryStoreForTests();
    resetExpertSystemStateForTests();
    clearExpertSystemExpiryScheduler();
    clearExpertSystemProjectionCache();
    extraRestore();
  });
}

function forceSingleTrainedSkill(characterID, skillTypeID = INDUSTRY, level = 1) {
  const skillType = getSkillTypeByID(skillTypeID);
  assert.ok(skillType, `missing skill type ${skillTypeID}`);
  replaceCharacterSkillRecords(characterID, [
    buildSkillRecord(characterID, skillType, level),
  ]);
  database.write("skillQueues", "/", {});
  database.write("characterExpertSystems", "/", {});
  resetExpertSystemStateForTests();
  clearExpertSystemProjectionCache();
}

function notificationNames(session) {
  return session._notifications.map((entry) => entry && entry.name);
}

function notificationTypeIDs(session, name) {
  return session._notifications
    .filter((entry) => entry && entry.name === name)
    .flatMap((entry) => {
      const dict = Array.isArray(entry.payload) ? entry.payload[0] : null;
      return Array.isArray(dict && dict.entries)
        ? dict.entries.map(([typeID]) => Number(typeID)).filter(Boolean)
        : [];
    });
}

function getDictEntryValue(payload, key) {
  if (!payload || payload.type !== "dict" || !Array.isArray(payload.entries)) {
    return null;
  }

  for (const [entryKey, entryValue] of payload.entries) {
    if (Number(entryKey) === Number(key)) {
      return entryValue;
    }
  }

  return null;
}

function getObjectStateEntry(payload, key) {
  const stateDict = payload && Array.isArray(payload.header) ? payload.header[2] : null;
  if (!stateDict || stateDict.type !== "dict" || !Array.isArray(stateDict.entries)) {
    return null;
  }

  for (const [entryKey, entryValue] of stateDict.entries) {
    if (entryKey === key) {
      return entryValue;
    }
  }

  return null;
}

function resolveExpertSystem(typeID) {
  const result = resolveExpertSystemQuery(String(typeID), {
    includeHidden: true,
    includeRetired: true,
  });
  assert.equal(result.success, true);
  return result.data;
}

function grantExpertSystemItem(characterID, typeID, quantity = 1) {
  const itemType = resolveItemByTypeID(typeID);
  assert.ok(itemType, `missing item type ${typeID}`);
  const characterRecord = getCharacterRecord(characterID);
  const grantResult = grantItemToCharacterLocation(
    characterID,
    Number(characterRecord.stationID || 60003760),
    ITEM_FLAGS.HANGAR,
    itemType,
    quantity,
  );
  assert.equal(grantResult.success, true);
  const createdItems = (grantResult.data && grantResult.data.items) || [];
  assert.ok(createdItems.length > 0, `expected an Expert System item ${typeID}`);
  return createdItems[0].itemID;
}

test("Expert System catalog and global feature flag expose the client parity authority", (t) => {
  restoreExpertSystemTestState(t);

  const expertSystems = listExpertSystems({ includeHidden: true, includeRetired: true });
  assert.ok(expertSystems.length >= 40, "expected a full local Expert System authority table");

  const kikimora = resolveExpertSystem(KIKIMORA_PILOT);
  assert.equal(kikimora.name, "Kikimora Pilot");
  assert.ok(kikimora.skillsGranted.some((grant) => grant.typeID === PRECURSOR_DESTROYER));

  config.expertSystemsEnabled = true;
  assert.ok(
    buildGlobalConfigEntries().some(
      ([key, value]) => key === "expert_system_feature_enabled" && value === 1,
    ),
  );

  config.expertSystemsEnabled = false;
  assert.ok(
    buildGlobalConfigEntries().some(
      ([key, value]) => key === "expert_system_feature_enabled" && value === 0,
    ),
  );
});

test("Expert System install projects virtual skills without turning them into trained SP", (t) => {
  restoreExpertSystemTestState(t);
  config.expertSystemsEnabled = true;
  forceSingleTrainedSkill(TEST_CHARACTER_ID);

  const session = buildLiveSession(TEST_CHARACTER_ID);
  sessionRegistry.register(session);

  const beforeBaseMap = getCharacterBaseSkillMap(TEST_CHARACTER_ID);
  assert.equal(beforeBaseMap.has(PRECURSOR_DESTROYER), false);

  const installResult = installExpertSystemForCharacter(
    TEST_CHARACTER_ID,
    KIKIMORA_PILOT,
    {
      session,
      force: true,
      grantReason: "test",
    },
  );
  assert.equal(installResult.success, true);

  const projectedMap = getCharacterSkillMap(TEST_CHARACTER_ID);
  const virtualDestroyer = projectedMap.get(PRECURSOR_DESTROYER);
  assert.ok(virtualDestroyer, "expected an Expert System virtual Precursor Destroyer skill");
  assert.equal(virtualDestroyer.trainedSkillLevel, null);
  assert.equal(virtualDestroyer.virtualSkillLevel, 1);
  assert.equal(virtualDestroyer.effectiveSkillLevel, 1);
  assert.equal(virtualDestroyer.trainedSkillPoints, null);

  const afterBaseMap = getCharacterBaseSkillMap(TEST_CHARACTER_ID);
  assert.equal(
    afterBaseMap.has(PRECURSOR_DESTROYER),
    false,
    "Expert Systems must not persist virtual grants as real trained skills",
  );

  assert.equal(
    getUserErrorMessage(
      captureThrownError(() =>
        saveQueue(TEST_CHARACTER_ID, [{ typeID: PRECURSOR_DESTROYER, toLevel: 2 }], {
          activate: true,
        }),
      ),
    ),
    "QueueSkillNotUploaded",
  );

  const names = notificationNames(session);
  assert.ok(names.includes("OnExpertSystemsUpdated"));
  assert.ok(names.includes("OnServerSkillsChanged"));
});

test("Mining Barge Operations emits real CharacterSkillEntry payloads for live expert-skill projection", (t) => {
  restoreExpertSystemTestState(t);
  config.expertSystemsEnabled = true;
  forceSingleTrainedSkill(TEST_CHARACTER_ID);

  const session = buildLiveSession(TEST_CHARACTER_ID);
  sessionRegistry.register(session);

  const installResult = installExpertSystemForCharacter(
    TEST_CHARACTER_ID,
    MINING_BARGE_OPERATIONS_ES,
    {
      session,
      force: true,
      grantReason: "test",
    },
  );
  assert.equal(installResult.success, true);

  const liveSkillUpdate = session._notifications.find(
    (entry) => entry && entry.name === "OnServerSkillsChanged",
  );
  assert.ok(liveSkillUpdate, "expected a live skill update after Expert System activation");
  const liveMiningBargeEntry = getDictEntryValue(liveSkillUpdate.payload[0], MINING_BARGE);
  assert.ok(liveMiningBargeEntry, "expected Mining Barge in the live skill update payload");
  const miningBargeType = getSkillTypeByID(MINING_BARGE);
  assert.ok(miningBargeType, "expected Mining Barge reference data");
  assert.equal(liveMiningBargeEntry.type, "objectex1");
  assert.equal(
    liveMiningBargeEntry.header[0].value,
    "characterskills.common.character_skill_entry.CharacterSkillEntry",
  );
  assert.deepEqual(
    liveMiningBargeEntry.header[1].slice(0, 5),
    [MINING_BARGE, null, null, Number(miningBargeType.skillRank || 1), 3],
  );
  assert.equal(
    getObjectStateEntry(liveMiningBargeEntry, "itemID"),
    TEST_CHARACTER_ID * 100000 + MINING_BARGE,
  );
  assert.equal(getObjectStateEntry(liveMiningBargeEntry, "flagID"), 7);

  const skillMgrService = new SkillMgrService();
  const skillsSnapshot = skillMgrService.Handle_GetSkills([], session);
  const snapshotMiningBargeEntry = getDictEntryValue(skillsSnapshot, MINING_BARGE);
  assert.ok(snapshotMiningBargeEntry, "expected Mining Barge in the skill handler snapshot");
  assert.equal(snapshotMiningBargeEntry.type, "objectex1");
  assert.equal(
    snapshotMiningBargeEntry.header[0].value,
    "characterskills.common.character_skill_entry.CharacterSkillEntry",
  );
  assert.deepEqual(
    snapshotMiningBargeEntry.header[1].slice(0, 5),
    [MINING_BARGE, null, null, Number(miningBargeType.skillRank || 1), 3],
  );
});

test("Mining Barge Operations matches the CCP parity grant list and associated barges", () => {
  const expertSystem = getExpertSystemByTypeID(MINING_BARGE_OPERATIONS_ES);
  assert.ok(expertSystem, "expected Mining Barge Operations in the Expert System catalog");

  assert.deepEqual(expertSystem.associatedTypeIDs, [17476, 17478, 17480]);

  const grantedSkills = expertSystem.skillsGranted.map((grant) => ({
    name: getSkillTypeByID(grant.typeID)?.name || `Skill ${grant.typeID}`,
    level: grant.level,
  }));

  assert.deepEqual(grantedSkills, [
    { name: "Spaceship Command", level: 3 },
    { name: "Mining", level: 4 },
    { name: "Astrogeology", level: 3 },
    { name: "Power Grid Management", level: 4 },
    { name: "Shield Operation", level: 3 },
    { name: "Capacitor Systems Operation", level: 3 },
    { name: "Capacitor Management", level: 3 },
    { name: "Shield Management", level: 3 },
    { name: "Tactical Shield Manipulation", level: 3 },
    { name: "Energy Grid Upgrades", level: 3 },
    { name: "Shield Upgrades", level: 3 },
    { name: "CPU Management", level: 4 },
    { name: "Long Range Targeting", level: 3 },
    { name: "Target Management", level: 3 },
    { name: "Signature Analysis", level: 3 },
    { name: "Drones", level: 3 },
    { name: "Drone Avionics", level: 3 },
    { name: "Mining Drone Operation", level: 3 },
    { name: "Drone Interfacing", level: 3 },
    { name: "Navigation", level: 3 },
    { name: "Afterburner", level: 3 },
    { name: "Evasive Maneuvering", level: 3 },
    { name: "Warp Drive Operation", level: 3 },
    { name: "Drone Navigation", level: 3 },
    { name: "Ice Harvesting", level: 3 },
    { name: "Mining Barge", level: 3 },
    { name: "Mining Upgrades", level: 3 },
    { name: "Advanced Drone Avionics", level: 3 },
    { name: "Drone Sharpshooting", level: 3 },
    { name: "Magnetometric Sensor Compensation", level: 3 },
  ]);
});

test("expertSystemMgr consumes item instances, updates inventory, and returns client timing payloads", (t) => {
  restoreExpertSystemTestState(t);
  config.expertSystemsEnabled = true;
  forceSingleTrainedSkill(TEST_CHARACTER_ID);

  const session = buildLiveSession(TEST_CHARACTER_ID);
  sessionRegistry.register(session);
  const service = new ExpertSystemMgrService();
  const itemID = grantExpertSystemItem(TEST_CHARACTER_ID, KIKIMORA_PILOT, 1);
  assert.ok(findItemById(itemID), "expected Expert System item before consumption");

  const consumeResult = service.Handle_ConsumeExpertSystem([itemID], session);
  assert.equal(consumeResult, null);
  assert.equal(findItemById(itemID), null);

  const payload = service.Handle_GetMyExpertSystems([], session);
  assert.equal(payload.type, "dict");
  assert.equal(payload.entries.length, 1);
  assert.equal(payload.entries[0][0], KIKIMORA_PILOT);
  assert.equal(payload.entries[0][1].type, "list");
  assert.equal(payload.entries[0][1].items.length, 2);

  const names = notificationNames(session);
  assert.ok(names.includes("OnItemChange"));
  assert.ok(names.includes("OnExpertSystemsUpdated"));
  assert.ok(names.includes("OnServerSkillsChanged"));
});

test("Expert System item activation rejects disabled and hidden systems without consuming items", (t) => {
  restoreExpertSystemTestState(t);
  forceSingleTrainedSkill(TEST_CHARACTER_ID);

  const session = buildLiveSession(TEST_CHARACTER_ID);
  const service = new ExpertSystemMgrService();

  config.expertSystemsEnabled = false;
  let itemID = grantExpertSystemItem(TEST_CHARACTER_ID, KIKIMORA_PILOT, 1);
  let error = captureThrownError(() =>
    service.Handle_ConsumeExpertSystem([itemID], session),
  );
  assert.equal(getUserErrorMessage(error), "CustomNotify");
  assert.ok(findItemById(itemID), "disabled Expert System activation must not consume the item");
  assert.equal(getExpertSystemStatus(TEST_CHARACTER_ID).activeEntries.length, 0);

  config.expertSystemsEnabled = true;
  itemID = grantExpertSystemItem(TEST_CHARACTER_ID, HIDDEN_QA_ES, 1);
  error = captureThrownError(() =>
    service.Handle_ConsumeExpertSystem([itemID], session),
  );
  assert.equal(getUserErrorMessage(error), "CustomNotify");
  assert.ok(findItemById(itemID), "hidden Expert System activation must not consume the item");
  assert.equal(getExpertSystemStatus(TEST_CHARACTER_ID).activeEntries.length, 0);
});

test("Expert System catalog covers all true Expert System items and rejects package-like non-catalog items", (t) => {
  restoreExpertSystemTestState(t);
  config.expertSystemsEnabled = true;
  forceSingleTrainedSkill(TEST_CHARACTER_ID);

  const rawItemTypes = database.read("itemTypes", "/").data || {};
  const itemTypes = Object.values(rawItemTypes.types || rawItemTypes)
    .filter((entry) => entry && typeof entry === "object");
  const expertSystemItemTypes = itemTypes.filter(
    (entry) => Number(entry.categoryID) === 2100,
  );
  const catalogTypeIDs = new Set(
    listExpertSystems({ includeHidden: true, includeRetired: true })
      .map((entry) => Number(entry.typeID))
      .filter(Boolean),
  );

  assert.ok(expertSystemItemTypes.length >= 48);
  for (const itemType of expertSystemItemTypes) {
    assert.equal(
      catalogTypeIDs.has(Number(itemType.typeID)),
      true,
      `missing Expert System catalog row for type ${itemType.typeID} ${itemType.name}`,
    );
  }

  assert.equal(isExpertSystemType(OODA_LOOP_EXPERT_SYSTEM_PACKAGE), false);
  assert.equal(isExpertSystemType(UNRELEASED_EXPERT_SYSTEM), false);

  const packageItemID = grantExpertSystemItem(
    TEST_CHARACTER_ID,
    OODA_LOOP_EXPERT_SYSTEM_PACKAGE,
    1,
  );
  const consumePackage = consumeExpertSystemItem(
    TEST_CHARACTER_ID,
    packageItemID,
    buildLiveSession(TEST_CHARACTER_ID),
  );

  assert.equal(consumePackage.success, false);
  assert.equal(consumePackage.errorMsg, "EXPERT_SYSTEM_ITEM_TYPE_MISMATCH");
  assert.ok(findItemById(packageItemID), "non-catalog package item must not be consumed");
  assert.equal(getExpertSystemStatus(TEST_CHARACTER_ID).activeEntries.length, 0);
});

test("Expert System item top-up consumes one item, extends expiry, and does not fanfare as a new install", (t) => {
  restoreExpertSystemTestState(t);
  config.expertSystemsEnabled = true;
  forceSingleTrainedSkill(TEST_CHARACTER_ID);

  const session = buildLiveSession(TEST_CHARACTER_ID);
  sessionRegistry.register(session);
  const nowMs = 1_900_000_000_000;
  const installResult = installExpertSystemForCharacter(
    TEST_CHARACTER_ID,
    KIKIMORA_PILOT,
    {
      nowMs,
      durationDays: 1,
      session,
      force: true,
    },
  );
  assert.equal(installResult.success, true);
  const originalExpiry = installResult.data.installEntry.expiresAtMs;
  const itemID = grantExpertSystemItem(TEST_CHARACTER_ID, KIKIMORA_PILOT, 1);

  session._notifications.length = 0;
  const topUpResult = consumeExpertSystemItem(TEST_CHARACTER_ID, itemID, session, {
    nowMs: nowMs + 60_000,
  });

  assert.equal(topUpResult.success, true);
  assert.equal(topUpResult.data.isTopUp, true);
  assert.equal(findItemById(itemID), null);
  const [activeEntry] = getExpertSystemStatus(TEST_CHARACTER_ID, {
    nowMs,
  }).activeEntries;
  assert.ok(activeEntry.expiresAtMs > originalExpiry);
  const updateNotification = session._notifications.find((entry) =>
    entry.name === "OnExpertSystemsUpdated"
  );
  assert.ok(updateNotification);
  assert.equal(updateNotification.payload[1], false);
});

test("overlapping Expert Systems only revoke a virtual skill after the last provider is removed", (t) => {
  restoreExpertSystemTestState(t);
  config.expertSystemsEnabled = true;
  forceSingleTrainedSkill(TEST_CHARACTER_ID);

  const amarrExpertSystem = listExpertSystems().find(
    (entry) => entry.typeID === AMARR_EXPLORATION_ES,
  );
  const caldariExpertSystem = listExpertSystems().find(
    (entry) => entry.typeID === CALDARI_EXPLORATION_ES,
  );
  const amarrAfterburnerLevel = amarrExpertSystem.skillsGranted.find(
    (entry) => entry.typeID === AFTERBURNER,
  ).level;
  const caldariAfterburnerLevel = caldariExpertSystem.skillsGranted.find(
    (entry) => entry.typeID === AFTERBURNER,
  ).level;

  const session = buildLiveSession(TEST_CHARACTER_ID);
  sessionRegistry.register(session);
  assert.equal(getCharacterSkillMap(TEST_CHARACTER_ID).has(AFTERBURNER), false);

  assert.equal(installExpertSystemForCharacter(
    TEST_CHARACTER_ID,
    AMARR_EXPLORATION_ES,
    { session, force: true },
  ).success, true);
  assert.equal(installExpertSystemForCharacter(
    TEST_CHARACTER_ID,
    CALDARI_EXPLORATION_ES,
    { session, force: true },
  ).success, true);
  assert.equal(
    getCharacterSkillMap(TEST_CHARACTER_ID).get(AFTERBURNER).virtualSkillLevel,
    Math.max(amarrAfterburnerLevel, caldariAfterburnerLevel),
  );

  session._notifications.length = 0;
  const removeFirst = removeExpertSystemFromCharacter(
    TEST_CHARACTER_ID,
    AMARR_EXPLORATION_ES,
    { session },
  );
  assert.equal(removeFirst.success, true);
  assert.equal(
    getCharacterSkillMap(TEST_CHARACTER_ID).get(AFTERBURNER).virtualSkillLevel,
    caldariAfterburnerLevel,
  );
  assert.equal(
    notificationTypeIDs(session, "OnServerSkillsRemoved").includes(AFTERBURNER),
    false,
  );

  const removeSecond = removeExpertSystemFromCharacter(
    TEST_CHARACTER_ID,
    CALDARI_EXPLORATION_ES,
    { session },
  );
  assert.equal(removeSecond.success, true);
  assert.equal(getCharacterSkillMap(TEST_CHARACTER_ID).has(AFTERBURNER), false);
  assert.equal(notificationNames(session).includes("OnServerSkillsRemoved"), true);
});

test("Expert System install limits and top-up window match client constants", (t) => {
  restoreExpertSystemTestState(t);
  config.expertSystemsEnabled = true;
  forceSingleTrainedSkill(TEST_CHARACTER_ID);

  const candidates = listExpertSystems()
    .filter((entry) => !entry.hidden && !entry.retired && entry.skillsGranted.length > 0)
    .slice(0, 4);
  assert.equal(candidates.length, 4);

  const nowMs = 1_900_000_000_000;
  for (const expertSystem of candidates.slice(0, 3)) {
    const installResult = installExpertSystemForCharacter(
      TEST_CHARACTER_ID,
      expertSystem.typeID,
      {
        nowMs,
        emitNotifications: false,
      },
    );
    assert.equal(installResult.success, true);
  }

  const limitResult = installExpertSystemForCharacter(
    TEST_CHARACTER_ID,
    candidates[3].typeID,
    {
      nowMs,
      emitNotifications: false,
    },
  );
  assert.equal(limitResult.success, false);
  assert.equal(limitResult.errorMsg, "EXPERT_SYSTEM_INSTALLATION_LIMIT");

  clearExpertSystemsForCharacter(TEST_CHARACTER_ID, { emitNotifications: false });
  const freshInstall = installExpertSystemForCharacter(
    TEST_CHARACTER_ID,
    KIKIMORA_PILOT,
    {
      nowMs,
      durationDays: 60,
      emitNotifications: false,
      force: true,
    },
  );
  assert.equal(freshInstall.success, true);

  const earlyTopUp = installExpertSystemForCharacter(
    TEST_CHARACTER_ID,
    KIKIMORA_PILOT,
    {
      nowMs: nowMs + 60_000,
      emitNotifications: false,
    },
  );
  assert.equal(earlyTopUp.success, false);
  assert.equal(earlyTopUp.errorMsg, "EXPERT_SYSTEM_TOP_UP_TOO_EARLY");

  const forcedTopUp = installExpertSystemForCharacter(
    TEST_CHARACTER_ID,
    KIKIMORA_PILOT,
    {
      nowMs: nowMs + 60_000,
      emitNotifications: false,
      force: true,
    },
  );
  assert.equal(forcedTopUp.success, true);
  assert.equal(forcedTopUp.data.isTopUp, true);
});

test("all visible skill-granting Expert System items can activate through the item consume path", (t) => {
  restoreExpertSystemTestState(t);
  config.expertSystemsEnabled = true;
  forceSingleTrainedSkill(TEST_CHARACTER_ID);

  const session = buildLiveSession(TEST_CHARACTER_ID);
  sessionRegistry.register(session);
  const activatableSystems = listExpertSystems()
    .filter((entry) => !entry.hidden && !entry.retired && entry.skillsGranted.length > 0);
  assert.ok(activatableSystems.length >= 25, "expected broad visible Expert System item coverage");

  for (const expertSystem of activatableSystems) {
    clearExpertSystemsForCharacter(TEST_CHARACTER_ID, {
      session,
      emitNotifications: false,
    });
    const itemID = grantExpertSystemItem(TEST_CHARACTER_ID, expertSystem.typeID, 1);
    const consumeResult = consumeExpertSystemItem(TEST_CHARACTER_ID, itemID, session, {
      nowMs: 1_900_000_000_000,
    });
    assert.equal(
      consumeResult.success,
      true,
      `failed to activate ${expertSystem.name}(${expertSystem.typeID})`,
    );
    assert.equal(findItemById(itemID), null);
    assert.equal(
      getExpertSystemStatus(TEST_CHARACTER_ID, {
        nowMs: 1_900_000_000_000,
      }).activeEntries.some((entry) => entry.typeID === expertSystem.typeID),
      true,
      `missing active install for ${expertSystem.name}(${expertSystem.typeID})`,
    );
  }
});

test("Expert System expiry revokes virtual skills and emits live refresh notifications", (t) => {
  restoreExpertSystemTestState(t);
  config.expertSystemsEnabled = true;
  forceSingleTrainedSkill(TEST_CHARACTER_ID);

  const session = buildLiveSession(TEST_CHARACTER_ID);
  sessionRegistry.register(session);
  const nowMs = 1_900_000_000_000;
  const installResult = installExpertSystemForCharacter(
    TEST_CHARACTER_ID,
    KIKIMORA_PILOT,
    {
      nowMs,
      durationDays: 1,
      session,
      force: true,
    },
  );
  assert.equal(installResult.success, true);
  assert.ok(getCharacterSkillMap(TEST_CHARACTER_ID).has(PRECURSOR_DESTROYER));

  session._notifications.length = 0;
  const expiryResult = expireDueExpertSystems(TEST_CHARACTER_ID, {
    nowMs: nowMs + 24 * 60 * 60 * 1000 + 1000,
    session,
  });
  assert.equal(expiryResult.expired.length, 1);
  assert.equal(getCharacterSkillMap(TEST_CHARACTER_ID).has(PRECURSOR_DESTROYER), false);
  assert.equal(getExpertSystemStatus(TEST_CHARACTER_ID).activeEntries.length, 0);

  const names = notificationNames(session);
  assert.ok(names.includes("OnExpertSystemsUpdated"));
  assert.ok(names.includes("OnExpertSystemExpired"));
  assert.ok(names.includes("OnServerSkillsRemoved"));
});

test("/expertsystem GM command family installs, reports, removes, and grants items", (t) => {
  restoreExpertSystemTestState(t);
  config.expertSystemsEnabled = true;
  forceSingleTrainedSkill(TEST_CHARACTER_ID);

  const session = buildLiveSession(TEST_CHARACTER_ID);
  sessionRegistry.register(session);

  const addResult = chatCommands.executeChatCommand(
    session,
    '/expertsystem add "Kikimora Pilot"',
    null,
    { emitChatFeedback: false },
  );
  assert.equal(addResult.handled, true);
  assert.match(addResult.message, /Installed Kikimora Pilot/);
  assert.equal(getExpertSystemStatus(TEST_CHARACTER_ID).activeEntries.length, 1);

  const statusResult = chatCommands.executeChatCommand(
    session,
    "/expertsystem status",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(statusResult.handled, true);
  assert.match(statusResult.message, /Kikimora Pilot/);

  const removeResult = chatCommands.executeChatCommand(
    session,
    '/expertsystem remove "Kikimora Pilot"',
    null,
    { emitChatFeedback: false },
  );
  assert.equal(removeResult.handled, true);
  assert.match(removeResult.message, /Removed Kikimora Pilot/);
  assert.equal(getExpertSystemStatus(TEST_CHARACTER_ID).activeEntries.length, 0);

  session.stationID = 60003760;
  session.stationid = 60003760;
  session.stationid2 = 60003760;
  const giveItemResult = chatCommands.executeChatCommand(
    session,
    '/expertsystem giveitem "Kikimora Pilot" 2',
    null,
    { emitChatFeedback: false },
  );
  assert.equal(giveItemResult.handled, true);
  assert.match(giveItemResult.message, /2x Kikimora Pilot/);
});
