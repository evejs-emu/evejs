const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const config = require(path.join(repoRoot, "server/src/config"));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const SkillMgrService = require(path.join(
  repoRoot,
  "server/src/services/skills/skillMgrService",
));
const SkillHandlerService = require(path.join(
  repoRoot,
  "server/src/services/skills/skillHandlerService",
));
const {
  buildSkillRecord,
  getCharacterSkills,
  getSkillTypes,
  getSkillTypeByID,
  replaceCharacterSkillRecords,
} = require(path.join(repoRoot, "server/src/services/skills/skillState"));
const {
  getQueueSnapshot,
  applyFreeSkillPoints,
  saveQueue,
  settleCharacterTraining,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/training/skillQueueRuntime",
));
const {
  getAlphaCapsByTypeID,
  ALPHA_MAX_TRAINING_SP,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/training/skillCloneRestrictions",
));
const {
  resetNowFileTimeOverride,
  setNowFileTimeOverride,
  getBaseSkillPointsPerMinute,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/training/skillTrainingMath",
));
const {
  buildSkillPlanProtoRoot,
} = require(path.join(
  repoRoot,
  "server/src/_secondary/express/gatewayServices/skillPlanProto",
));
const {
  createSkillPlanGatewayService,
} = require(path.join(
  repoRoot,
  "server/src/_secondary/express/gatewayServices/skillPlanGatewayService",
));
const {
  resetStoreCaches,
} = require(path.join(repoRoot, "server/src/services/newEdenStore/storeState"));

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

function buildGatewayRequest(messageType, payload, activeCharacterID) {
  return {
    payload: {
      value: Buffer.from(messageType.encode(messageType.create(payload || {})).finish()),
    },
    authoritative_context: {
      active_character: { sequential: activeCharacterID },
      identity: {
        character: { sequential: activeCharacterID },
      },
    },
  };
}

function chooseSkillTypeID(characterID) {
  const existingSkills = getCharacterSkills(characterID);
  const candidate =
    existingSkills.find((skillRecord) => getSkillTypeByID(skillRecord.typeID)) ||
    existingSkills[0];
  assert.ok(candidate, `expected a seed skill for character ${characterID}`);
  return candidate.typeID;
}

function chooseNoPrerequisiteSkillTypeID(characterID) {
  const existingSkills = getCharacterSkills(characterID);
  const existingCandidate = existingSkills.find((skillRecord) => skillRecord.typeID === 3380);
  if (existingCandidate && getSkillTypeByID(existingCandidate.typeID)) {
    return existingCandidate.typeID;
  }
  assert.ok(getSkillTypeByID(3380), "expected Industry (3380) to exist");
  return 3380;
}

function chooseAlphaRestrictedSkillTypeID() {
  const alphaCaps = [...getAlphaCapsByTypeID().entries()]
    .filter(([, maxLevel]) => maxLevel > 0 && maxLevel < 5)
    .sort((left, right) => left[1] - right[1] || left[0] - right[0]);
  assert.ok(alphaCaps.length > 0, "expected at least one Alpha-restricted skill");
  const [skillTypeID] = alphaCaps[0];
  assert.ok(getSkillTypeByID(skillTypeID), `missing restricted skill type ${skillTypeID}`);
  return skillTypeID;
}

function buildSkillRecordsUntilTotalPoints(characterID, minimumTotalPoints, excludedTypeIDs = new Set()) {
  const skillTypes = getSkillTypes()
    .filter((skillType) => skillType && skillType.published !== false)
    .sort((left, right) => Number(right.skillRank || 0) - Number(left.skillRank || 0));
  const records = [];
  let totalPoints = 0;
  for (const skillType of skillTypes) {
    if (excludedTypeIDs.has(skillType.typeID)) {
      continue;
    }
    const record = buildSkillRecord(characterID, skillType, 5);
    records.push(record);
    totalPoints += Number(record.trainedSkillPoints || 0);
    if (totalPoints >= minimumTotalPoints) {
      break;
    }
  }
  assert.ok(
    totalPoints >= minimumTotalPoints,
    `expected to reach at least ${minimumTotalPoints} SP but only built ${totalPoints}`,
  );
  return records;
}

function forceSingleSkillState(characterID, skillTypeID, level, freeSkillPoints = 0) {
  const skillType = getSkillTypeByID(skillTypeID);
  assert.ok(skillType, `missing skill type ${skillTypeID}`);
  replaceCharacterSkillRecords(characterID, [
    buildSkillRecord(characterID, skillType, level),
  ]);
  const characters = cloneValue(database.read("characters", "/").data || {});
  const character = characters[String(characterID)];
  character.freeSkillPoints = freeSkillPoints;
  character.finishedSkills = [];
  character.skillQueueEndTime = 0;
  characters[String(characterID)] = character;
  database.write("characters", "/", characters);
}

function forceSkillState(characterID, skillRecords = [], freeSkillPoints = 0) {
  replaceCharacterSkillRecords(characterID, skillRecords);
  const characters = cloneValue(database.read("characters", "/").data || {});
  const character = characters[String(characterID)];
  character.freeSkillPoints = freeSkillPoints;
  character.finishedSkills = [];
  character.skillQueueEndTime = 0;
  characters[String(characterID)] = character;
  database.write("characters", "/", characters);
}

test("skill queue handlers expose the same authoritative queue through skillMgr and skillHandler", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalSkillQueues = cloneValue(database.read("skillQueues", "/").data);
  const originalTrainingSpeed = config.skillTrainingSpeed;
  const characterID = 140000001;

  t.after(() => {
    resetNowFileTimeOverride();
    config.skillTrainingSpeed = originalTrainingSpeed;
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    database.write("skillQueues", "/", originalSkillQueues);
  });

  config.skillTrainingSpeed = 1;
  database.write("skillQueues", "/", {});

  const skillTypeID = chooseNoPrerequisiteSkillTypeID(characterID);
  forceSingleSkillState(characterID, skillTypeID, 1, 2500);

  saveQueue(
    characterID,
    [
      { typeID: skillTypeID, toLevel: 2 },
      { typeID: skillTypeID, toLevel: 3 },
    ],
    { activate: true },
  );

  const session = {
    userid: Number(originalCharacters[String(characterID)].accountId || 1),
    characterID,
    charid: characterID,
  };
  const skillMgr = new SkillMgrService();
  const skillHandler = new SkillHandlerService();

  const managerQueue = skillMgr.Handle_GetMySkillQueue([], session);
  const handlerQueue = skillHandler.Handle_GetSkillQueue([], session);
  assert.deepEqual(handlerQueue, managerQueue);
  assert.equal(extractListItems(managerQueue).length, 2);

  const [managerQueuePayload, managerFreePoints] =
    skillMgr.Handle_GetSkillQueueAndFreePoints([], session);
  const [handlerQueuePayload, handlerFreePoints] =
    skillHandler.Handle_GetSkillQueueAndFreePoints([], session);
  assert.deepEqual(managerQueuePayload, handlerQueuePayload);
  assert.equal(managerFreePoints, 2500);
  assert.equal(handlerFreePoints, 2500);

  const queuePreview = skillMgr.Handle_GetFreeSkillPointsAppliedToQueue([], session);
  assert.ok(queuePreview.entries.length > 0);
});

test("active queue state feeds character selection and advances to the next queued level over time", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalSkillQueues = cloneValue(database.read("skillQueues", "/").data);
  const originalTrainingSpeed = config.skillTrainingSpeed;
  const characterID = 140000001;

  t.after(() => {
    resetNowFileTimeOverride();
    config.skillTrainingSpeed = originalTrainingSpeed;
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    database.write("skillQueues", "/", originalSkillQueues);
  });

  config.skillTrainingSpeed = 1;
  database.write("skillQueues", "/", {});

  const skillTypeID = chooseNoPrerequisiteSkillTypeID(characterID);
  forceSingleSkillState(characterID, skillTypeID, 1, 0);

  saveQueue(
    characterID,
    [
      { typeID: skillTypeID, toLevel: 2 },
      { typeID: skillTypeID, toLevel: 3 },
    ],
    { activate: true },
  );

  const charService = new CharService();
  const session = {
    userid: Number(originalCharacters[String(characterID)].accountId || 1),
    characterID,
    charid: characterID,
  };

  const selectionPayload = charService.Handle_GetCharacterSelectionData([], session);
  const characterRow = extractListItems(selectionPayload[2]).find(
    (row) => getDictEntry(row, "characterID") === characterID,
  );
  assert.ok(characterRow);
  assert.equal(getDictEntry(characterRow, "skillTypeID"), skillTypeID);
  assert.equal(getDictEntry(characterRow, "toLevel"), 2);
  assert.ok(getDictEntry(characterRow, "trainingEndTime"));
  assert.ok(getDictEntry(characterRow, "queueEndTime"));

  const snapshot = getQueueSnapshot(characterID);
  const firstEnd = BigInt(String(snapshot.currentEntry.trainingEndTime));
  setNowFileTimeOverride(() => firstEnd + 1n);
  settleCharacterTraining(characterID);

  const advancedPayload = charService.Handle_GetCharacterSelectionData([], session);
  const advancedRow = extractListItems(advancedPayload[2]).find(
    (row) => getDictEntry(row, "characterID") === characterID,
  );
  assert.equal(getDictEntry(advancedRow, "skillTypeID"), skillTypeID);
  assert.equal(getDictEntry(advancedRow, "toLevel"), 3);
  assert.equal(getDictEntry(advancedRow, "finishedSkills"), 1);
});

test("personal skill plan gateway requests create, update, track, and milestone personal plans on parity", async (t) => {
  const originalSkillPlans = cloneValue(database.read("skillPlans", "/").data);
  const characterID = 140000001;
  const skillTypeID = chooseNoPrerequisiteSkillTypeID(characterID);

  t.after(() => {
    database.write("skillPlans", "/", originalSkillPlans);
  });

  database.write("skillPlans", "/", {});

  const protoRoot = buildSkillPlanProtoRoot();
  const gatewayService = createSkillPlanGatewayService();
  const createRequestType = protoRoot.lookupType(
    "eve_public.character.skill.plan.CreateRequest",
  );
  const createResponseType = protoRoot.lookupType(
    "eve_public.character.skill.plan.CreateResponse",
  );
  const getAllResponseType = protoRoot.lookupType(
    "eve_public.character.skill.plan.GetAllResponse",
  );
  const getResponseType = protoRoot.lookupType(
    "eve_public.character.skill.plan.GetResponse",
  );
  const getActiveResponseType = protoRoot.lookupType(
    "eve_public.character.skill.plan.GetActiveResponse",
  );
  const milestoneCreateRequestType = protoRoot.lookupType(
    "eve_public.character.skill.plan.milestone.CreateRequest",
  );
  const milestoneCreateResponseType = protoRoot.lookupType(
    "eve_public.character.skill.plan.milestone.CreateResponse",
  );
  const milestoneGetAllResponseType = protoRoot.lookupType(
    "eve_public.character.skill.plan.milestone.GetAllResponse",
  );

  const createResult = gatewayService.handleRequest(
    "eve_public.character.skill.plan.CreateRequest",
    buildGatewayRequest(
      createRequestType,
      {
        skill_plan: {
          name: "Parity Plan",
          description: "Retail-style personal plan",
          skill_requirements: [
            {
              skill_type: {
                sequential: skillTypeID,
              },
              level: 3,
            },
          ],
        },
      },
      characterID,
    ),
  );
  assert.equal(createResult.statusCode, 200);
  const created = createResponseType.decode(createResult.responsePayloadBuffer);
  const planUuid = Buffer.from(created.skill_plan.uuid).toString("hex");
  assert.equal(planUuid.length, 32);

  const getAllResult = gatewayService.handleRequest(
    "eve_public.character.skill.plan.GetAllRequest",
    buildGatewayRequest(
      protoRoot.lookupType("eve_public.character.skill.plan.GetAllRequest"),
      {},
      characterID,
    ),
  );
  const getAllPayload = getAllResponseType.decode(getAllResult.responsePayloadBuffer);
  assert.equal(getAllPayload.skill_plans.length, 1);

  const getResult = gatewayService.handleRequest(
    "eve_public.character.skill.plan.GetRequest",
    buildGatewayRequest(
      protoRoot.lookupType("eve_public.character.skill.plan.GetRequest"),
      {
        skill_plan: created.skill_plan,
      },
      characterID,
    ),
  );
  const getPayload = getResponseType.decode(getResult.responsePayloadBuffer);
  assert.equal(getPayload.skill_plan.name, "Parity Plan");
  assert.equal(getPayload.skill_plan.skill_requirements.length, 3);
  assert.equal(getPayload.skill_plan.skill_requirements[0].level, 1);
  assert.equal(getPayload.skill_plan.skill_requirements[2].level, 3);

  const setActiveResult = gatewayService.handleRequest(
    "eve_public.character.skill.plan.SetActiveRequest",
    buildGatewayRequest(
      protoRoot.lookupType("eve_public.character.skill.plan.SetActiveRequest"),
      {
        skill_plan: created.skill_plan,
      },
      characterID,
    ),
  );
  assert.equal(setActiveResult.statusCode, 200);

  const getActiveResult = gatewayService.handleRequest(
    "eve_public.character.skill.plan.GetActiveRequest",
    buildGatewayRequest(
      protoRoot.lookupType("eve_public.character.skill.plan.GetActiveRequest"),
      {},
      characterID,
    ),
  );
  const activePayload = getActiveResponseType.decode(
    getActiveResult.responsePayloadBuffer,
  );
  assert.deepEqual(
    Buffer.from(activePayload.skill_plan.uuid),
    Buffer.from(created.skill_plan.uuid),
  );

  const milestoneCreateResult = gatewayService.handleRequest(
    "eve_public.character.skill.plan.milestone.CreateRequest",
    buildGatewayRequest(
      milestoneCreateRequestType,
      {
        milestone: {
          skill_plan: created.skill_plan,
          skill: {
            skill_type: {
              sequential: skillTypeID,
            },
            level: 2,
          },
          description: "Train the second level",
        },
      },
      characterID,
    ),
  );
  assert.equal(milestoneCreateResult.statusCode, 200);
  const createdMilestone = milestoneCreateResponseType.decode(
    milestoneCreateResult.responsePayloadBuffer,
  );
  assert.equal(Buffer.from(createdMilestone.milestone.uuid).length, 16);

  const getMilestonesResult = gatewayService.handleRequest(
    "eve_public.character.skill.plan.milestone.GetAllRequest",
    buildGatewayRequest(
      protoRoot.lookupType("eve_public.character.skill.plan.milestone.GetAllRequest"),
      {
        skill_plan: created.skill_plan,
      },
      characterID,
    ),
  );
  const milestonePayload = milestoneGetAllResponseType.decode(
    getMilestonesResult.responsePayloadBuffer,
  );
  assert.equal(milestonePayload.milestones.length, 1);
  assert.equal(milestonePayload.milestones[0].data.skill.level, 2);
});

test("tracked AIR or certified skill plans can be activated without needing a personal-plan row", (t) => {
  const originalSkillPlans = cloneValue(database.read("skillPlans", "/").data);
  const characterID = 140000001;
  const certifiedPlanID = "11111111-2222-3333-4444-555555555555";

  t.after(() => {
    database.write("skillPlans", "/", originalSkillPlans);
  });

  database.write("skillPlans", "/", {});

  const protoRoot = buildSkillPlanProtoRoot();
  const gatewayService = createSkillPlanGatewayService();
  const getActiveResponseType = protoRoot.lookupType(
    "eve_public.character.skill.plan.GetActiveResponse",
  );

  const setActiveResult = gatewayService.handleRequest(
    "eve_public.character.skill.plan.SetActiveRequest",
    buildGatewayRequest(
      protoRoot.lookupType("eve_public.character.skill.plan.SetActiveRequest"),
      {
        skill_plan: {
          uuid: Buffer.from(certifiedPlanID.replace(/-/g, ""), "hex"),
        },
      },
      characterID,
    ),
  );
  assert.equal(setActiveResult.statusCode, 200);

  const getActiveResult = gatewayService.handleRequest(
    "eve_public.character.skill.plan.GetActiveRequest",
    buildGatewayRequest(
      protoRoot.lookupType("eve_public.character.skill.plan.GetActiveRequest"),
      {},
      characterID,
    ),
  );
  assert.equal(getActiveResult.statusCode, 200);
  const activePayload = getActiveResponseType.decode(
    getActiveResult.responsePayloadBuffer,
  );
  assert.deepEqual(
    Buffer.from(activePayload.skill_plan.uuid),
    Buffer.from(certifiedPlanID.replace(/-/g, ""), "hex"),
  );
  assert.ok(
    !activePayload.skill_plan_info || !activePayload.skill_plan_info.name,
    "certified tracked plans should not require personal skill_plan_info payloads",
  );

  const getResult = gatewayService.handleRequest(
    "eve_public.character.skill.plan.GetRequest",
    buildGatewayRequest(
      protoRoot.lookupType("eve_public.character.skill.plan.GetRequest"),
      {
        skill_plan: {
          uuid: Buffer.from(certifiedPlanID.replace(/-/g, ""), "hex"),
        },
      },
      characterID,
    ),
  );
  assert.equal(getResult.statusCode, 404);
});

test("queue timing honors the global training-speed multiplier without changing CCP SP thresholds", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalSkillQueues = cloneValue(database.read("skillQueues", "/").data);
  const originalTrainingSpeed = config.skillTrainingSpeed;
  const characterID = 140000001;
  const skillTypeID = chooseNoPrerequisiteSkillTypeID(characterID);

  t.after(() => {
    resetNowFileTimeOverride();
    config.skillTrainingSpeed = originalTrainingSpeed;
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    database.write("skillQueues", "/", originalSkillQueues);
  });

  setNowFileTimeOverride(() => 200000000000000000n);
  database.write("skillQueues", "/", {});
  forceSingleSkillState(characterID, skillTypeID, 1, 0);

  config.skillTrainingSpeed = 1;
  saveQueue(characterID, [{ typeID: skillTypeID, toLevel: 2 }], { activate: true });
  const retailSnapshot = getQueueSnapshot(characterID);
  const retailDuration =
    BigInt(String(retailSnapshot.currentEntry.trainingEndTime)) -
    BigInt(String(retailSnapshot.currentEntry.trainingStartTime));

  database.write("skillQueues", "/", {});
  forceSingleSkillState(characterID, skillTypeID, 1, 0);
  config.skillTrainingSpeed = 10;
  saveQueue(characterID, [{ typeID: skillTypeID, toLevel: 2 }], { activate: true });
  const acceleratedSnapshot = getQueueSnapshot(characterID);
  const acceleratedDuration =
    BigInt(String(acceleratedSnapshot.currentEntry.trainingEndTime)) -
    BigInt(String(acceleratedSnapshot.currentEntry.trainingStartTime));

  assert.ok(acceleratedDuration < retailDuration, "expected faster training at 10x speed");
  assert.ok(
    acceleratedDuration * 9n <= retailDuration,
    `expected near-10x speedup but got retail=${retailDuration} accelerated=${acceleratedDuration}`,
  );
  assert.equal(
    retailSnapshot.currentEntry.trainingDestinationSP,
    acceleratedSnapshot.currentEntry.trainingDestinationSP,
    "speed multiplier must not alter CCP SP thresholds",
  );
});

test("Omega training speed stays exactly 2x Alpha at the same attributes on CCP parity", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalRuntime = cloneValue(database.read("newEdenStoreRuntime", "/").data);
  const originalOmegaLicenseEnabled = config.omegaLicenseEnabled;
  const originalTrainingSpeed = config.skillTrainingSpeed;
  const characterID = 140000001;
  const characterRecord = cloneValue(originalCharacters[String(characterID)]);
  const accountID = Number(characterRecord.accountId || 1);
  const skillTypeID = chooseNoPrerequisiteSkillTypeID(characterID);

  t.after(() => {
    config.omegaLicenseEnabled = originalOmegaLicenseEnabled;
    config.skillTrainingSpeed = originalTrainingSpeed;
    database.write("characters", "/", originalCharacters);
    database.write("newEdenStoreRuntime", "/", originalRuntime);
    resetStoreCaches();
  });

  config.skillTrainingSpeed = 1;
  config.omegaLicenseEnabled = false;

  const alphaRuntime = cloneValue(originalRuntime);
  alphaRuntime.accounts[String(accountID)] = {
    ...(alphaRuntime.accounts[String(accountID)] || {}),
    omegaExpiryFileTime: null,
  };
  database.write("newEdenStoreRuntime", "/", alphaRuntime);
  resetStoreCaches();
  const alphaSpm = getBaseSkillPointsPerMinute(characterRecord, skillTypeID, accountID);

  const omegaRuntime = cloneValue(alphaRuntime);
  omegaRuntime.accounts[String(accountID)] = {
    ...(omegaRuntime.accounts[String(accountID)] || {}),
    omegaExpiryFileTime: "999999999999999999",
  };
  database.write("newEdenStoreRuntime", "/", omegaRuntime);
  resetStoreCaches();
  const omegaSpm = getBaseSkillPointsPerMinute(characterRecord, skillTypeID, accountID);

  assert.ok(alphaSpm > 0, "expected Alpha training rate to be positive");
  assert.ok(omegaSpm > alphaSpm, "expected Omega training rate to exceed Alpha");
  assert.equal(
    omegaSpm,
    alphaSpm * 2,
    `expected Omega training speed to be exactly 2x Alpha for skill ${skillTypeID}`,
  );
});

test("queue save rejects uninjected skills, respects alpha level caps, and blocks alpha activation past 5m training SP", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalSkillQueues = cloneValue(database.read("skillQueues", "/").data);
  const originalRuntime = cloneValue(database.read("newEdenStoreRuntime", "/").data);
  const originalTrainingSpeed = config.skillTrainingSpeed;
  const originalOmegaLicenseEnabled = config.omegaLicenseEnabled;
  const characterID = 140000001;
  const accountID = Number(originalCharacters[String(characterID)].accountId || 1);
  const restrictedSkillTypeID = chooseAlphaRestrictedSkillTypeID();
  const restrictedSkillMaxLevel = getAlphaCapsByTypeID().get(restrictedSkillTypeID);

  t.after(() => {
    resetNowFileTimeOverride();
    config.skillTrainingSpeed = originalTrainingSpeed;
    config.omegaLicenseEnabled = originalOmegaLicenseEnabled;
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    database.write("skillQueues", "/", originalSkillQueues);
    database.write("newEdenStoreRuntime", "/", originalRuntime);
    resetStoreCaches();
  });

  setNowFileTimeOverride(() => 200000000000000000n);
  config.skillTrainingSpeed = 1;
  config.omegaLicenseEnabled = false;
  database.write("skillQueues", "/", {});

  const alphaRuntime = cloneValue(originalRuntime);
  alphaRuntime.accounts[String(accountID)] = {
    ...(alphaRuntime.accounts[String(accountID)] || {}),
    omegaExpiryFileTime: null,
    multiCharacterTrainingSlots: {},
  };
  database.write("newEdenStoreRuntime", "/", alphaRuntime);
  resetStoreCaches();

  const seededTypeIDs = new Set(getCharacterSkills(characterID).map((record) => record.typeID));
  const untrainedPublishedSkill = getSkillTypes().find(
    (skillType) => skillType && skillType.published !== false && !seededTypeIDs.has(skillType.typeID),
  );
  assert.ok(untrainedPublishedSkill, "expected a published uninjected skill for parity validation");
  forceSingleSkillState(characterID, chooseNoPrerequisiteSkillTypeID(characterID), 1, 0);

  assert.equal(
    getUserErrorMessage(
      captureThrownError(() =>
        saveQueue(characterID, [{ typeID: untrainedPublishedSkill.typeID, toLevel: 1 }], {
          activate: true,
        }),
      ),
    ),
    "QueueSkillNotUploaded",
  );

  forceSingleSkillState(characterID, restrictedSkillTypeID, 0, 200000);
  assert.equal(
    getUserErrorMessage(
      captureThrownError(() =>
        saveQueue(characterID, [{ typeID: restrictedSkillTypeID, toLevel: restrictedSkillMaxLevel + 1 }], {
          activate: false,
        }),
      ),
    ),
    "QueueCannotTrainOmegaRestrictedSkill",
  );

  const newFreeSkillPoints = applyFreeSkillPoints(characterID, restrictedSkillTypeID, 200000);
  const restrictedSnapshot = getQueueSnapshot(characterID);
  const restrictedSkill = restrictedSnapshot.projectedSkillMap.get(restrictedSkillTypeID);
  assert.equal(restrictedSkill.trainedSkillLevel, restrictedSkillMaxLevel);
  assert.ok(newFreeSkillPoints < 200000, "expected some points to be spent");
  assert.equal(
    newFreeSkillPoints,
    200000 - Number(restrictedSkill.trainedSkillPoints || 0),
  );

  const alphaAllowedTypeID = chooseNoPrerequisiteSkillTypeID(characterID);
  const highPointRecords = buildSkillRecordsUntilTotalPoints(
    characterID,
    ALPHA_MAX_TRAINING_SP + 1000,
    new Set([alphaAllowedTypeID]),
  );
  highPointRecords.push(buildSkillRecord(characterID, getSkillTypeByID(alphaAllowedTypeID), 0));
  forceSkillState(characterID, highPointRecords, 0);

  saveQueue(characterID, [{ typeID: alphaAllowedTypeID, toLevel: 1 }], { activate: false });
  assert.equal(getQueueSnapshot(characterID).active, false);
  assert.equal(
    getUserErrorMessage(
      captureThrownError(() =>
        saveQueue(characterID, [{ typeID: alphaAllowedTypeID, toLevel: 1 }], { activate: true }),
      ),
    ),
    "SkillInQueueOverAlphaSpTrainingSize",
  );
});

test("queue activation respects account training-slot limits across multiple characters", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);
  const originalSkillQueues = cloneValue(database.read("skillQueues", "/").data);
  const originalRuntime = cloneValue(database.read("newEdenStoreRuntime", "/").data);
  const originalAccounts = cloneValue(database.read("accounts", "/").data);
  const originalOmegaLicenseEnabled = config.omegaLicenseEnabled;
  const originalTrainingSpeed = config.skillTrainingSpeed;
  const firstCharacterID = 140000001;
  const secondCharacterID = 140000002;
  const accountID = Number(originalCharacters[String(firstCharacterID)].accountId || 1);

  t.after(() => {
    resetNowFileTimeOverride();
    config.omegaLicenseEnabled = originalOmegaLicenseEnabled;
    config.skillTrainingSpeed = originalTrainingSpeed;
    database.write("characters", "/", originalCharacters);
    database.write("skills", "/", originalSkills);
    database.write("skillQueues", "/", originalSkillQueues);
    database.write("newEdenStoreRuntime", "/", originalRuntime);
    database.write("accounts", "/", originalAccounts);
    resetStoreCaches();
  });

  setNowFileTimeOverride(() => 200000000000000000n);
  config.omegaLicenseEnabled = true;
  config.skillTrainingSpeed = 1;
  database.write("skillQueues", "/", {});

  const nextAccounts = cloneValue(originalAccounts);
  nextAccounts.test.multiCharacterTrainingSlots = {};
  database.write("accounts", "/", nextAccounts);
  const nextRuntime = cloneValue(originalRuntime);
  nextRuntime.accounts[String(accountID)] = {
    ...(nextRuntime.accounts[String(accountID)] || {}),
    multiCharacterTrainingSlots: {},
  };
  database.write("newEdenStoreRuntime", "/", nextRuntime);
  resetStoreCaches();

  const skillTypeID = chooseNoPrerequisiteSkillTypeID(firstCharacterID);
  forceSingleSkillState(firstCharacterID, skillTypeID, 1, 0);
  forceSingleSkillState(secondCharacterID, skillTypeID, 1, 0);
  saveQueue(secondCharacterID, [{ typeID: skillTypeID, toLevel: 2 }], { activate: true });

  assert.equal(
    getUserErrorMessage(
      captureThrownError(() =>
        saveQueue(firstCharacterID, [{ typeID: skillTypeID, toLevel: 2 }], { activate: true }),
      ),
    ),
    "UserAlreadyHasSkillInTraining",
  );
});
