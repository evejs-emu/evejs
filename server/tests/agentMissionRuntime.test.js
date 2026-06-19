const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const { executeChatCommand } = require(path.join(
  repoRoot,
  "server/src/services/chat/chatCommands",
));
const {
  listAgents,
} = require(path.join(
  repoRoot,
  "server/src/services/agent/agentAuthority",
));
const missionRuntime = require(path.join(
  repoRoot,
  "server/src/services/agent/agentMissionRuntime",
));
const missionAuthority = require(path.join(
  repoRoot,
  "server/src/services/agent/missionAuthority",
));
const dungeonRuntime = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonRuntime",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const bookmarkRuntime = require(path.join(
  repoRoot,
  "server/src/services/bookmark/bookmarkRuntimeState",
));
const {
  ITEM_FLAGS,
  listContainerItems,
  updateInventoryItem,
  getActiveShipItem,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  currentFileTimeString,
  futureFileTimeString,
  resetCharacterState,
} = require(path.join(
  repoRoot,
  "server/src/services/agent/missionRuntimeState",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function extractDictEntries(value) {
  return value && value.type === "dict" && Array.isArray(value.entries)
    ? value.entries
    : [];
}

function keyValEntriesToMap(value) {
  return new Map(
    extractDictEntries(
      value &&
        value.type === "object" &&
        value.name === "util.KeyVal"
        ? value.args
        : null,
    ),
  );
}

function extractFirstCharacterID() {
  const result = database.read("characters", "/");
  assert.equal(result.success, true, "failed to read characters table");

  const characterID = Object.keys(result.data || {})
    .map((entry) => Number(entry) || 0)
    .filter((entry) => entry > 0)
    .sort((left, right) => left - right)[0];

  assert.ok(characterID, "expected at least one character");
  return characterID;
}

function findUsableLevelOneAgent() {
  const agentRecord = listAgents().find(
    (entry) =>
      Number(entry && entry.agentID) > 0 &&
      Number(entry && entry.stationID) > 0 &&
      Number(entry && entry.level) === 1,
  );
  assert.ok(agentRecord, "expected at least one level 1 station agent");
  return agentRecord;
}

function findUsableLevelOneCourierAgent() {
  const agentRecord = listAgents().find(
    (entry) => {
      if (
        !(Number(entry && entry.agentID) > 0 &&
        Number(entry && entry.stationID) > 0 &&
        Number(entry && entry.level) === 1)
      ) {
        return false;
      }
      const plausibleMissionID = missionRuntime.getPlausibleMissionIDs(entry.agentID)[0];
      const plausibleMission = missionAuthority.getMissionByID(plausibleMissionID);
      return Boolean(
        plausibleMission &&
        plausibleMission.courierMission &&
        Object.keys(plausibleMission.courierMission).length > 0,
      );
    },
  );
  assert.ok(agentRecord, "expected at least one level 1 courier station agent");
  return agentRecord;
}

function findUsableLevelOneEncounterAgent() {
  const agentRecord = listAgents().find(
    (entry) => {
      if (
        !(Number(entry && entry.agentID) > 0 &&
        Number(entry && entry.stationID) > 0 &&
        Number(entry && entry.level) === 1)
      ) {
        return false;
      }
      const plausibleMissionID = missionRuntime.getPlausibleMissionIDs(entry.agentID)[0];
      const plausibleMission = missionAuthority.getMissionByID(plausibleMissionID);
      return Boolean(
        plausibleMission &&
        plausibleMission.killMission &&
        Object.keys(plausibleMission.killMission).length > 0,
      );
    },
  );
  assert.ok(agentRecord, "expected at least one level 1 encounter station agent");
  return agentRecord;
}

function findAgentByID(agentID) {
  const agentRecord = listAgents().find(
    (entry) => Number(entry && entry.agentID) === Number(agentID),
  );
  assert.ok(agentRecord, `expected agent ${agentID} to exist`);
  return agentRecord;
}

const originalMissionRuntimeState = cloneValue(
  database.read("missionRuntimeState", "/").data || {
    version: 1,
    nextMissionSequence: 1,
    charactersByID: {},
  },
);
const originalDungeonRuntimeState = cloneValue(
  database.read("dungeonRuntimeState", "/").data || {
    version: 1,
    nextInstanceSequence: 1,
    instancesByID: {},
  },
);
const BOOKMARK_TABLES = [
  "bookmarkRuntimeState",
  "bookmarks",
  "bookmarkFolders",
  "bookmarkSubfolders",
  "bookmarkKnownFolders",
  "bookmarkGroups",
];
const originalBookmarkTables = Object.fromEntries(
  BOOKMARK_TABLES.map((tableName) => [
    tableName,
    cloneValue(database.read(tableName, "/").data || {}),
  ]),
);

function restoreMissionTestState() {
  database.write("missionRuntimeState", "/", cloneValue(originalMissionRuntimeState));
  database.write("dungeonRuntimeState", "/", cloneValue(originalDungeonRuntimeState));
  for (const [tableName, payload] of Object.entries(originalBookmarkTables)) {
    database.write(tableName, "/", cloneValue(payload));
  }
}

function buildStationLocationWrap(agentRecord) {
  return {
    locationID: Number(agentRecord && agentRecord.stationID) || 0,
    typeID: Number(agentRecord && agentRecord.stationTypeID) || 1531,
    solarsystemID: Number(agentRecord && agentRecord.solarSystemID) || 0,
    locationType: "station",
  };
}

function seedAcceptedMissionRecord(characterID, missionRecord) {
  resetCharacterState(characterID);
  const state = cloneValue(database.read("missionRuntimeState", "/").data || {
    version: 1,
    nextMissionSequence: 1,
    charactersByID: {},
  });
  const characterKey = String(characterID);
  if (!state.charactersByID[characterKey]) {
    state.charactersByID[characterKey] = {
      characterID,
      lastUpdatedAtMs: Date.now(),
      missionSelectionCursorByAgentID: {},
      missionsByAgentID: {},
      declineTimersByAgentID: {},
      completedCareerAgentIDs: {},
      history: [],
    };
  }
  state.charactersByID[characterKey].missionsByAgentID[String(missionRecord.agentID)] =
    cloneValue(missionRecord);
  database.write("missionRuntimeState", "/", state);
}

function getTupleKey(tupleValue) {
  if (tupleValue && tupleValue.type === "tuple" && Array.isArray(tupleValue.items)) {
    return String(tupleValue.items[0] || "");
  }
  if (Array.isArray(tupleValue)) {
    return String(tupleValue[0] || "");
  }
  return "";
}

function buildLiveMissionSession(characterID, overrides = {}) {
  return {
    clientID: 900000 + Number(characterID || 0),
    characterID,
    charid: characterID,
    userid: Number(characterID || 0),
    stationid: 0,
    solarsystemid: 0,
    solarsystemid2: 0,
    locationid: 0,
    socket: { destroyed: false },
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
    ...overrides,
  };
}

test("placeholder agent missions can be offered, accepted, completed by GM, and preview standings", (t) => {
  const characterID = extractFirstCharacterID();
  const agentRecord = findUsableLevelOneAgent();

  t.after(() => {
    restoreMissionTestState();
  });

  resetCharacterState(characterID);

  const offerResult = missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
  );
  assert.equal(offerResult.success, true);
  assert.ok(offerResult.data.agentSays[1], "expected offered conversation content ID");
  assert.deepEqual(
    Object.keys(offerResult.data.lastActionInfo || {}).sort(),
    [
      "missionCantReplay",
      "missionCompleted",
      "missionDeclined",
      "missionQuit",
    ],
  );
  assert.doesNotMatch(
    String(offerResult.data.agentSays[0] || ""),
    /(repo-owned|placeholder qa|\/missioncomplete|runtime mission template|client mission id)/i,
  );

  const offeredMission = missionRuntime.getMissionRecord(
    characterID,
    agentRecord.agentID,
  );
  assert.ok(offeredMission, "expected an offered mission record");
  assert.equal(offeredMission.runtimeStatus, "offered");

  const acceptResult = missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_ACCEPT,
  );
  assert.equal(acceptResult.success, true);
  assert.deepEqual(
    Object.keys(acceptResult.data.lastActionInfo || {}).sort(),
    [
      "missionCantReplay",
      "missionCompleted",
      "missionDeclined",
      "missionQuit",
    ],
  );
  assert.doesNotMatch(
    String(acceptResult.data.agentSays[0] || ""),
    /(repo-owned|placeholder qa|\/missioncomplete|runtime mission template|client mission id)/i,
  );

  const acceptedMission = missionRuntime.getMissionRecord(
    characterID,
    agentRecord.agentID,
  );
  assert.ok(acceptedMission, "expected an accepted mission record");
  assert.equal(acceptedMission.runtimeStatus, "accepted");
  assert.equal(typeof acceptedMission.contentID, "number");
  assert.match(
    String(acceptedMission.missionTemplateID || ""),
    /^(client-dungeon:|client-mission:|eve-survival:)/,
  );
  assert.ok(
    missionAuthority.getMissionByID(acceptedMission.contentID),
    "expected accepted mission contentID to resolve via mission authority",
  );
  assert.ok(
    Object.keys(acceptedMission.bookmarkIDsByRole || {}).length > 0,
    "expected accepted mission to create journal bookmarks",
  );
  if (acceptedMission.objectiveMode === "dungeon") {
    assert.ok(
      Number(acceptedMission.dungeonInstanceID) > 0,
      "expected combat mission acceptance to spawn a dungeon instance",
    );
  }

  const standingPreview = missionRuntime.getStandingGainsForMission(
    characterID,
    agentRecord.agentID,
    acceptedMission.contentID,
  );
  assert.ok(
    Number(standingPreview[agentRecord.corporationID] || 0) > 0,
    "expected a positive corporation standing preview delta",
  );
  assert.ok(
    Number(standingPreview[agentRecord.agentID] || 0) > 0,
    "expected a positive agent standing preview delta",
  );

  const gmResult = missionRuntime.markMissionObjectiveComplete(characterID, {
    agentID: agentRecord.agentID,
  });
  assert.equal(gmResult.success, true);
  assert.deepEqual(gmResult.data.markedAgentIDs, [agentRecord.agentID]);

  const objectiveInfo = missionRuntime.getMissionObjectiveInfo(
    characterID,
    agentRecord.agentID,
  );
  assert.equal(
    objectiveInfo.missionState,
    missionRuntime.AGENT_MISSION_STATE_ACCEPTED,
  );
  assert.equal(objectiveInfo.completionStatus, 2);
  assert.equal(
    objectiveInfo.normalRewards[0][0],
    29,
    "expected ISK rewards to use the credits type ID",
  );
  const bonusRewardTypeID = Array.isArray(objectiveInfo.bonusRewards) && objectiveInfo.bonusRewards[0]
    ? objectiveInfo.bonusRewards[0][1]
    : (
        Array.isArray(objectiveInfo.normalRewards)
          ? (objectiveInfo.normalRewards.find((entry, index) => index > 0 && Array.isArray(entry) && Number(entry[0]) === 29) || [null])[0]
          : null
      );
  assert.equal(
    bonusRewardTypeID,
    29,
    "expected bonus ISK rewards to use the credits type ID",
  );

  const journalInfo = missionRuntime.getMissionJournalInfo(
    characterID,
    agentRecord.agentID,
  );
  assert.equal(journalInfo.contentID, acceptedMission.contentID);

  const journalRows = missionRuntime.getJournalDetails(characterID);
  assert.ok(Array.isArray(journalRows[0]) && journalRows[0].length >= 1);
});

test("idle agent conversations use the real character ID for standings gating", (t) => {
  const characterID = extractFirstCharacterID();
  const agentRecord = findUsableLevelOneAgent();

  t.after(() => {
    restoreMissionTestState();
  });

  resetCharacterState(characterID);

  const idleResult = missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    null,
  );
  assert.equal(idleResult.success, true);
  assert.equal(
    String(idleResult.data.agentSays[0] || ""),
    "I have work available. Request a mission when you're ready.",
  );
  assert.deepEqual(idleResult.data.actions, [
    [
      missionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
      missionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
    ],
  ]);
});

test("plausible mission IDs resolve to packaged-client mission authority records", () => {
  const agentRecord = findUsableLevelOneAgent();
  const plausibleMissionIDs = missionRuntime.getPlausibleMissionIDs(agentRecord.agentID);
  assert.ok(plausibleMissionIDs.length > 0, "expected plausible mission IDs");
  assert.equal(typeof plausibleMissionIDs[0], "number");
  assert.ok(
    missionAuthority.getMissionByID(plausibleMissionIDs[0]),
    "expected plausible mission ID to resolve via mission authority",
  );
});

test("legacy mission runtime rows repair client-facing mission IDs for journal and opportunities payloads", (t) => {
  const characterID = extractFirstCharacterID();
  const agentRecord = findUsableLevelOneAgent();

  t.after(() => {
    restoreMissionTestState();
  });

  resetCharacterState(characterID);

  const offerResult = missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
  );
  assert.equal(offerResult.success, true);

  const acceptResult = missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_ACCEPT,
  );
  assert.equal(acceptResult.success, true);

  const acceptedMission = missionRuntime.getMissionRecord(
    characterID,
    agentRecord.agentID,
  );
  assert.ok(acceptedMission, "expected an accepted mission");
  assert.equal(typeof acceptedMission.contentID, "number");

  const state = cloneValue(database.read("missionRuntimeState", "/").data || {});
  const storedMission =
    state.charactersByID[String(characterID)].missionsByAgentID[String(agentRecord.agentID)];
  storedMission.contentID = `eve-survival:legacy:${acceptedMission.contentID}`;
  storedMission.missionTemplateID = `eve-survival:legacy:${acceptedMission.contentID}`;
  storedMission.missionContentTemplateID = "";
  storedMission.missionNameID = 0;
  database.write("missionRuntimeState", "/", state);

  const journalInfo = missionRuntime.getMissionJournalInfo(
    characterID,
    agentRecord.agentID,
  );
  assert.equal(typeof journalInfo.contentID, "number");
  assert.ok(
    missionAuthority.getMissionByID(journalInfo.contentID),
    "expected repaired mission journal info content ID to resolve via mission authority",
  );

  const journalRows = missionRuntime.getJournalDetails(characterID)[0];
  const journalRow = journalRows.find(
    (row) => Number(row[4]) === Number(agentRecord.agentID),
  );
  assert.ok(journalRow, "expected repaired journal row");
  assert.equal(typeof journalRow[9], "number");
  assert.ok(
    missionAuthority.getMissionByID(journalRow[9]),
    "expected repaired journal row content ID to resolve via mission authority",
  );

  const repairedMission = missionRuntime.getMissionRecord(
    characterID,
    agentRecord.agentID,
  );
  assert.equal(typeof repairedMission.contentID, "number");
  assert.ok(
    missionAuthority.getMissionByID(repairedMission.contentID),
    "expected repaired mission runtime content ID to resolve via mission authority",
  );
  assert.ok(
    String(repairedMission.missionContentTemplateID || "").length > 0,
    "expected repaired mission runtime row to recover a mission content template ID",
  );
  assert.ok(
    Number(repairedMission.missionNameID) > 0,
    "expected repaired mission runtime row to recover a mission name ID",
  );
});

test("/missioncomplete marks accepted placeholder objectives complete for hand-in", (t) => {
  const characterID = extractFirstCharacterID();
  const agentRecord = findUsableLevelOneAgent();

  t.after(() => {
    restoreMissionTestState();
  });

  resetCharacterState(characterID);
  missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
  );
  missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_ACCEPT,
  );

  const result = executeChatCommand(
    {
      characterID,
      charid: characterID,
    },
    "/missioncomplete",
    null,
    {
      emitChatFeedback: false,
    },
  );
  assert.equal(result.handled, true);
  assert.match(String(result.message || ""), /Talk to the agent/i);

  const objectiveInfo = missionRuntime.getMissionObjectiveInfo(
    characterID,
    agentRecord.agentID,
  );
  assert.equal(objectiveInfo.completionStatus, 2);
});

test("encounter mission acceptance creates a private mission dungeon instance", (t) => {
  const characterID = extractFirstCharacterID();
  const agentRecord = findUsableLevelOneEncounterAgent();

  t.after(() => {
    restoreMissionTestState();
  });

  resetCharacterState(characterID);

  const offerResult = missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
  );
  assert.equal(offerResult.success, true);

  const acceptResult = missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_ACCEPT,
  );
  assert.equal(acceptResult.success, true);

  const acceptedMission = missionRuntime.getMissionRecord(
    characterID,
    agentRecord.agentID,
  );
  assert.ok(acceptedMission, "expected an accepted encounter mission");
  assert.equal(acceptedMission.runtimeStatus, "accepted");
  assert.equal(acceptedMission.objectiveMode, "dungeon");
  assert.ok(
    Number(acceptedMission.dungeonInstanceID) > 0,
    "expected accepted encounter mission to create a dungeon instance",
  );
  assert.ok(
    Number(acceptedMission.missionSiteID) > 0,
    "expected accepted encounter mission to have a mission site ID",
  );
  assert.ok(
    Object.keys(acceptedMission.bookmarkIDsByRole || {}).includes("dungeon"),
    "expected accepted encounter mission to create a dungeon bookmark",
  );

  const instance = dungeonRuntime.getInstance(acceptedMission.dungeonInstanceID);
  assert.ok(instance, "expected accepted encounter mission dungeon instance");
  assert.equal(instance.runtimeFlags && instance.runtimeFlags.missionRuntime, true);
  assert.equal(instance.ownership && instance.ownership.missionOwnerCharacterID, characterID);
  assert.equal(
    instance.metadata && instance.metadata.siteID,
    acceptedMission.missionSiteID,
  );
});

test("mission objective lists expose the expected courier and encounter progression steps", (t) => {
  const characterID = extractFirstCharacterID();
  const courierAgent = findUsableLevelOneCourierAgent();
  const encounterAgent = findUsableLevelOneEncounterAgent();

  t.after(() => {
    restoreMissionTestState();
  });

  resetCharacterState(characterID);

  missionRuntime.doAgentAction(
    characterID,
    courierAgent.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
  );
  missionRuntime.doAgentAction(
    characterID,
    courierAgent.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_ACCEPT,
  );

  const initialCourierObjectives = missionRuntime.getAllMissionObjectives(
    characterID,
    courierAgent.agentID,
  );
  assert.deepEqual(
    initialCourierObjectives.map(getTupleKey),
    ["TransportItemsMissing"],
  );

  missionRuntime.markMissionObjectiveComplete(characterID, {
    agentID: courierAgent.agentID,
  });
  const completedCourierObjectives = missionRuntime.getAllMissionObjectives(
    characterID,
    courierAgent.agentID,
  );
  assert.deepEqual(
    completedCourierObjectives.map(getTupleKey),
    [
      "TransportItemsMissing",
      "TransportItemsPresent",
      "MissionTransport",
      "AllObjectivesComplete",
    ],
  );

  missionRuntime.doAgentAction(
    characterID,
    encounterAgent.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
  );
  missionRuntime.doAgentAction(
    characterID,
    encounterAgent.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_ACCEPT,
  );

  const encounterTravelObjectives = missionRuntime.getAllMissionObjectives(
    characterID,
    encounterAgent.agentID,
  );
  assert.deepEqual(
    encounterTravelObjectives.map(getTupleKey),
    ["TravelTo"],
  );

  const encounterCombatObjectives = missionRuntime.getAllMissionObjectives(
    characterID,
    encounterAgent.agentID,
    {
      inActiveDungeon: true,
    },
  );
  assert.deepEqual(
    encounterCombatObjectives.map(getTupleKey),
    ["TravelTo", "KillAllTrigger"],
  );
});

test("accepted courier missions immediately sync the granted cargo to a live docked station session", (t) => {
  const characterID = extractFirstCharacterID();
  const agentRecord = findUsableLevelOneCourierAgent();
  const liveSession = buildLiveMissionSession(characterID, {
    stationid: Number(agentRecord.stationID) || 0,
    locationid: Number(agentRecord.solarSystemID) || 0,
    solarsystemid: Number(agentRecord.solarSystemID) || 0,
    solarsystemid2: Number(agentRecord.solarSystemID) || 0,
  });

  t.after(() => {
    sessionRegistry.unregister(liveSession);
    restoreMissionTestState();
  });

  resetCharacterState(characterID);
  sessionRegistry.register(liveSession);

  missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
  );
  const acceptResult = missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_ACCEPT,
  );

  assert.equal(acceptResult.success, true);
  assert.equal(
    liveSession.notifications.some((entry) => entry && entry.name === "OnItemChange"),
    true,
    "expected accepting a courier mission to sync the granted cargo to the live station session",
  );
});

test("courier missions complete while docked at the dropoff station even if the cargo is still in the ship hold", (t) => {
  const characterID = extractFirstCharacterID();
  const agentRecord = findUsableLevelOneCourierAgent();
  const liveSession = buildLiveMissionSession(characterID, {
    stationid: Number(agentRecord.stationID) || 0,
    locationid: Number(agentRecord.solarSystemID) || 0,
    solarsystemid: Number(agentRecord.solarSystemID) || 0,
    solarsystemid2: Number(agentRecord.solarSystemID) || 0,
  });

  t.after(() => {
    sessionRegistry.unregister(liveSession);
    restoreMissionTestState();
  });

  resetCharacterState(characterID);
  sessionRegistry.register(liveSession);

  missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
  );
  missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_ACCEPT,
  );

  const acceptedMission = missionRuntime.getMissionRecord(
    characterID,
    agentRecord.agentID,
  );
  assert.ok(acceptedMission && acceptedMission.cargo, "expected accepted courier mission cargo");

  const cargoItem = listContainerItems(
    characterID,
    Number(acceptedMission.pickupLocation && acceptedMission.pickupLocation.locationID) || 0,
    ITEM_FLAGS.HANGAR,
  ).find((item) => Number(item && item.typeID) === Number(acceptedMission.cargo.typeID));
  assert.ok(cargoItem, "expected granted courier cargo in the pickup hangar");

  const activeShip = getActiveShipItem(characterID);
  assert.ok(activeShip && Number(activeShip.itemID) > 0, "expected an active ship for courier delivery");

  const moveResult = updateInventoryItem(cargoItem.itemID, (currentItem) => ({
    ...currentItem,
    locationID: Number(activeShip.itemID),
    flagID: ITEM_FLAGS.CARGO_HOLD,
  }));
  assert.equal(moveResult.success, true);
  liveSession.notifications.length = 0;

  liveSession.stationid = Number(
    acceptedMission.dropoffLocation && acceptedMission.dropoffLocation.locationID,
  ) || 0;
  liveSession.locationid = Number(
    acceptedMission.dropoffLocation && acceptedMission.dropoffLocation.solarsystemID,
  ) || 0;
  liveSession.solarsystemid = liveSession.locationid;
  liveSession.solarsystemid2 = liveSession.locationid;

  const objectiveInfo = missionRuntime.getMissionObjectiveInfo(
    characterID,
    agentRecord.agentID,
  );
  assert.equal(
    objectiveInfo && objectiveInfo.completionStatus,
    1,
    "expected the courier mission to count complete while docked at the dropoff station with cargo in ship cargo",
  );

  const completeResult = missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_COMPLETE,
  );
  assert.equal(completeResult.success, true);
  const removedCargoNotification = liveSession.notifications.find((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    entry.payload &&
    entry.payload[0] &&
    entry.payload[0].fields &&
    Number(entry.payload[0].fields.itemID) === Number(cargoItem.itemID)
  ));
  assert.ok(
    removedCargoNotification,
    "expected completing the courier mission to immediately sync removal of the ship cargo stack",
  );
  assert.equal(
    Array.isArray(
      removedCargoNotification.payload &&
      removedCargoNotification.payload[1] &&
      removedCargoNotification.payload[1].entries,
    ),
    true,
    "expected the removal sync payload to include inventory delta entries",
  );
  assert.equal(
    missionRuntime.getMissionRecord(characterID, agentRecord.agentID),
    null,
  );
});

test("encounter mission completion follows dungeon runtime progress and hand-in purges the instance", (t) => {
  const characterID = extractFirstCharacterID();
  const agentRecord = findUsableLevelOneEncounterAgent();

  t.after(() => {
    restoreMissionTestState();
  });

  resetCharacterState(characterID);

  missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
  );
  missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_ACCEPT,
  );

  const acceptedMission = missionRuntime.getMissionRecord(
    characterID,
    agentRecord.agentID,
  );
  assert.ok(
    Number(acceptedMission && acceptedMission.dungeonInstanceID) > 0,
    "expected an encounter mission dungeon instance",
  );

  dungeonRuntime.advanceObjective(
    acceptedMission.dungeonInstanceID,
    {
      state: "completed",
      completedAtMs: Date.now(),
    },
    {
      nowMs: Date.now(),
    },
  );

  const objectiveInfo = missionRuntime.getMissionObjectiveInfo(
    characterID,
    agentRecord.agentID,
  );
  assert.equal(objectiveInfo.completionStatus, 1);

  const completionResult = missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_COMPLETE,
  );
  assert.equal(completionResult.success, true);
  assert.equal(
    missionRuntime.getMissionRecord(characterID, agentRecord.agentID),
    null,
  );
  assert.equal(
    dungeonRuntime.getInstance(acceptedMission.dungeonInstanceID),
    null,
  );
});

test("completed non-agent missions expose remote hand-in parity and accept remote-complete actions", (t) => {
  const characterID = extractFirstCharacterID();
  const agentRecord = findUsableLevelOneEncounterAgent();

  t.after(() => {
    restoreMissionTestState();
  });

  resetCharacterState(characterID);

  missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
  );
  missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_ACCEPT,
  );

  const acceptedMission = missionRuntime.getMissionRecord(
    characterID,
    agentRecord.agentID,
  );
  assert.ok(
    Number(acceptedMission && acceptedMission.dungeonInstanceID) > 0,
    "expected an encounter mission dungeon instance",
  );

  dungeonRuntime.advanceObjective(
    acceptedMission.dungeonInstanceID,
    {
      state: "completed",
      completedAtMs: Date.now(),
    },
    {
      nowMs: Date.now(),
    },
  );

  const journalRows = missionRuntime.getJournalDetails(characterID)[0];
  const missionRow = journalRows.find((row) => Number(row[4]) === Number(agentRecord.agentID));
  assert.ok(missionRow, "expected accepted mission journal row");
  assert.equal(
    missionRow[8],
    true,
    "expected journal row to advertise remote completion",
  );

  const remoteConversation = missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_VIEW_MISSION,
  );
  assert.equal(remoteConversation.success, true);
  assert.ok(
    remoteConversation.data.actions.some(
      (actionTuple) =>
        Number(actionTuple[0]) === missionRuntime.AGENT_DIALOGUE_BUTTON_COMPLETE_REMOTELY,
    ),
    "expected accepted remote conversation to expose complete-remotely",
  );

  const remoteCompletion = missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_COMPLETE_REMOTELY,
  );
  assert.equal(remoteCompletion.success, true);
  assert.equal(
    missionRuntime.getMissionRecord(characterID, agentRecord.agentID),
    null,
  );
});

test("encounter missions keep a stable client dungeon runtime while exposing richer mission intel", (t) => {
  const characterID = extractFirstCharacterID();
  const agentRecord = findUsableLevelOneEncounterAgent();

  t.after(() => {
    restoreMissionTestState();
  });

  resetCharacterState(characterID);

  missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
  );
  missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_ACCEPT,
  );

  const acceptedMission = missionRuntime.getMissionRecord(
    characterID,
    agentRecord.agentID,
  );
  assert.ok(acceptedMission, "expected an accepted encounter mission");
  const runtimeInstance = dungeonRuntime.getInstance(
    acceptedMission.dungeonInstanceID,
  );
  assert.ok(runtimeInstance, "expected an accepted encounter mission instance");
  assert.equal(
    String(runtimeInstance && runtimeInstance.templateID),
    String(acceptedMission.dungeonTemplateID || acceptedMission.missionTemplateID || ""),
    "expected accepted encounter runtime to instance from the healed dungeon runtime template",
  );

  const objectiveInfo = missionRuntime.getMissionObjectiveInfo(
    characterID,
    agentRecord.agentID,
  );
  assert.ok(
    objectiveInfo &&
      Array.isArray(objectiveInfo.dungeons) &&
      objectiveInfo.dungeons.length > 0,
    "expected encounter objective payload dungeon data",
  );
  const briefingMessage = objectiveInfo.dungeons[0].briefingMessage;
  assert.ok(briefingMessage, "expected encounter objective briefing payload");
  assert.equal(
    Object.prototype.hasOwnProperty.call(objectiveInfo.dungeons[0], "objectiveCompleted"),
    true,
    "expected encounter dungeon payloads to always carry objectiveCompleted for stock agent windows",
  );
  assert.equal(
    objectiveInfo.dungeons[0].objectiveCompleted,
    null,
    "expected incomplete encounter dungeon objectives to advertise objectiveCompleted as null",
  );
  if (briefingMessage && briefingMessage.type === "tuple") {
    assert.ok(
      Number(briefingMessage.items[0]) > 0,
      "expected authored encounter briefing tuples to carry a real message ID",
    );
    assert.equal(
      Number(briefingMessage.items[1]),
      Number(acceptedMission.contentID),
      "expected authored encounter briefing tuples to preserve the client mission contentID for ProcessMessage",
    );
  } else if (typeof briefingMessage === "number") {
    assert.ok(
      Number(briefingMessage) > 0,
      "expected authored client briefing message ID",
    );
  } else {
    assert.match(
      String(briefingMessage || ""),
      /(Review the following operational briefing|Operational Intel|Objective Intel|Acceleration Gates|Trigger Notes)/i,
    );
    assert.doesNotMatch(
      String(briefingMessage || ""),
      /(repo-owned|placeholder qa|\/missioncomplete|runtime mission template|client mission id)/i,
    );
  }
  assert.equal(
    Object.prototype.hasOwnProperty.call(objectiveInfo.dungeons[0], "completionStatus"),
    false,
    "expected incomplete encounter objectives to omit dungeon completionStatus so the stock client does not render them as failed",
  );

  const journalInfo = missionRuntime.getMissionJournalInfo(
    characterID,
    agentRecord.agentID,
  );
  const dungeonBookmark = (Array.isArray(journalInfo && journalInfo.bookmarks)
    ? journalInfo.bookmarks
    : []
  ).find((bookmark) => keyValEntriesToMap(bookmark).get("locationType") === "dungeon");
  assert.ok(dungeonBookmark, "expected encounter mission journal to include a dungeon bookmark");
  const dungeonBookmarkEntries = keyValEntriesToMap(dungeonBookmark);
  assert.equal(
    dungeonBookmarkEntries.get("x") && dungeonBookmarkEntries.get("x").type,
    "real",
    "expected mission dungeon bookmark x to stay marshal-real for bookmark distance math parity",
  );
  assert.equal(
    dungeonBookmarkEntries.get("y") && dungeonBookmarkEntries.get("y").type,
    "real",
    "expected mission dungeon bookmark y to stay marshal-real for bookmark distance math parity",
  );
  assert.equal(
    dungeonBookmarkEntries.get("z") && dungeonBookmarkEntries.get("z").type,
    "real",
    "expected mission dungeon bookmark z to stay marshal-real for bookmark distance math parity",
  );
});

test("accepted encounter missions keep system-managed bookmarks out of active Personal Locations", (t) => {
  const characterID = extractFirstCharacterID();
  const agentRecord = findUsableLevelOneEncounterAgent();

  t.after(() => {
    restoreMissionTestState();
  });

  resetCharacterState(characterID);

  missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
  );
  missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_ACCEPT,
  );

  const acceptedMission = missionRuntime.getMissionRecord(characterID, agentRecord.agentID);
  assert.ok(acceptedMission, "expected accepted encounter mission");
  const dungeonBookmarkID = Number(acceptedMission.bookmarkIDsByRole.dungeon || 0);
  assert.ok(dungeonBookmarkID > 0, "expected accepted mission to create a dungeon bookmark");

  const dungeonBookmarkInfo = bookmarkRuntime.getBookmarkForCharacter(characterID, dungeonBookmarkID);
  assert.ok(dungeonBookmarkInfo, "expected dungeon bookmark to be accessible");
  assert.equal(
    String(dungeonBookmarkInfo.folder.folderName),
    "Agent Missions",
    "expected mission bookmarks to live in the dedicated Agent Missions folder",
  );

  const missionFolderView = bookmarkRuntime.listFolderViews(characterID).find(
    (view) => String(view && view.folder && view.folder.folderName) === "Agent Missions",
  );
  assert.ok(missionFolderView, "expected Agent Missions folder view");
  assert.equal(
    missionFolderView.isActive,
    false,
    "expected Agent Missions folder to stay hidden from active Personal Locations",
  );

  const activeBookmarks = bookmarkRuntime.getMyActiveBookmarks(characterID);
  assert.equal(
    (activeBookmarks.bookmarks || []).some(
      (bookmark) => Number(bookmark && bookmark.bookmarkID) === dungeonBookmarkID,
    ),
    false,
    "expected mission dungeon bookmark to stay out of active bookmark listings",
  );

  const journalInfo = missionRuntime.getMissionJournalInfo(
    characterID,
    agentRecord.agentID,
  );
  const journalDungeonBookmark = (Array.isArray(journalInfo && journalInfo.bookmarks)
    ? journalInfo.bookmarks
    : []
  ).find((bookmark) => keyValEntriesToMap(bookmark).get("locationType") === "dungeon");
  assert.ok(journalDungeonBookmark, "expected journal info to continue exposing the dungeon bookmark");
});

test("Silence The Informant aligns the selected client mission with the authored mission runtime template", (t) => {
  const characterID = extractFirstCharacterID();
  const agentRecord = findAgentByID(3013350);

  t.after(() => {
    restoreMissionTestState();
  });

  resetCharacterState(characterID);

  missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
  );

  const offeredMission = missionRuntime.getMissionRecord(
    characterID,
    agentRecord.agentID,
  );
  assert.ok(offeredMission, "expected Silence The Informant to be offered");
  assert.equal(Number(offeredMission.contentID), 1081);
  assert.equal(
    String(offeredMission.missionTemplateID),
    "eve-survival:SilencetheInformant4",
  );
  assert.equal(
    String(offeredMission.dungeonTemplateID),
    "eve-survival:SilencetheInformant4",
  );

  missionRuntime.doAgentAction(
    characterID,
    agentRecord.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_ACCEPT,
  );

  const acceptedMission = missionRuntime.getMissionRecord(
    characterID,
    agentRecord.agentID,
  );
  assert.ok(acceptedMission, "expected Silence The Informant to be accepted");
  const runtimeInstance = dungeonRuntime.getInstance(
    acceptedMission.dungeonInstanceID,
  );
  assert.ok(runtimeInstance, "expected Silence The Informant private dungeon instance");
  assert.equal(
    String(runtimeInstance && runtimeInstance.templateID),
    "eve-survival:SilencetheInformant4",
  );
});

test("mission authority preserves authored CCP objective chain metadata", () => {
  assert.equal(
    missionAuthority.getMissionByID(3096).clientObjectives.objectiveChainID,
    27,
  );
  assert.equal(
    missionAuthority.getMissionByID(3107).clientObjectives.objectiveChainID,
    28,
  );
  assert.equal(
    missionAuthority.getMissionByID(17130).clientObjectives.objectiveChainID,
    119,
  );
});

test("mission authority normalizes hidden mission reward blobs into repo-owned reward records", () => {
  assert.deepEqual(
    missionAuthority.getMissionByID(1460).missionRewards,
    {
      reward: {
        rewardTypeID: 19696,
        rewardQuantity: 1,
      },
      bonusReward: {
        rewardTypeID: 20562,
        rewardQuantity: 2,
      },
      bonusTimeInterval: 180,
    },
  );
  assert.deepEqual(
    missionAuthority.getMissionByID(17013).missionRewards,
    {
      reward: null,
      bonusReward: null,
      bonusTimeInterval: null,
    },
  );
});

test("mission authority preserves repo-owned exact client mission text templates", () => {
  const missionRecord = missionAuthority.getMissionByID(909);
  assert.ok(missionRecord, "expected mission 909 to exist");
  assert.equal(missionRecord.localizedName.text, "The Seven's Brothel");
  assert.match(
    String(
      missionRecord.localizedMessages["messages.mission.briefing"] &&
        missionRecord.localizedMessages["messages.mission.briefing"].text,
    ),
    /The Seven have showed their ugly faces again/i,
  );
  assert.equal(
    missionRecord.localizedMessages["messages.mission.briefing"].tokens["{[location]dungeonLocationID.name}"].variableName,
    "dungeonLocationID",
  );
});

test("encounter objective payload prefers authored client briefing messages when available", (t) => {
  const characterID = extractFirstCharacterID();
  const agentRecord = findUsableLevelOneEncounterAgent();
  const authoredMission = missionAuthority.getMissionByID(909);

  t.after(() => {
    restoreMissionTestState();
  });

  seedAcceptedMissionRecord(characterID, {
    missionSequence: 3,
    agentID: agentRecord.agentID,
    contentID: 909,
    missionTemplateID: "eve-survival:AfterTheSeven1",
    missionContentTemplateID: "agent.missionTemplatizedContent_BasicKillMission",
    missionNameID: authoredMission.nameID,
    missionPoolKey: "test:authored-briefing",
    missionKind: "encounter",
    missionTypeLabel: "UI/Agents/MissionTypes/KillMission",
    missionTitle: authoredMission.localizedName.text,
    importantMission: false,
    runtimeStatus: "accepted",
    placeholder: false,
    objectiveMode: "dungeon",
    objectiveCompleted: false,
    gmCompleted: false,
    offeredAtFileTime: currentFileTimeString(),
    acceptedAtFileTime: currentFileTimeString(),
    expiresAtFileTime: futureFileTimeString(),
    lastUpdatedAtMs: Date.now(),
    dungeonTemplateID: "client-dungeon:1138",
    dungeonID: 1138,
    dungeonInstanceID: null,
    missionSiteID: 9700000000003,
    missionSystemID: agentRecord.solarSystemID,
    missionPosition: { x: 0, y: 0, z: 0 },
    bookmarkIDsByRole: {},
    cargo: null,
    pickupLocation: null,
    dropoffLocation: buildStationLocationWrap(agentRecord),
    rewards: {
      isk: 0,
      bonusIsk: 0,
      loyaltyPoints: 0,
      researchPoints: 0,
      rawStandings: {
        corporation: 0,
        faction: 0,
        agent: 0,
      },
      standingEvents: {},
    },
  });

  const objectiveInfo = missionRuntime.getMissionObjectiveInfo(
    characterID,
    agentRecord.agentID,
  );
  assert.ok(
    objectiveInfo &&
      Array.isArray(objectiveInfo.dungeons) &&
      objectiveInfo.dungeons.length > 0,
    "expected dungeon objective data",
  );
  const briefingMessage = objectiveInfo.dungeons[0].briefingMessage;
  assert.ok(briefingMessage && briefingMessage.type === "tuple");
  assert.equal(
    Number(briefingMessage.items[0]),
    Number(authoredMission.messages["messages.mission.briefing"]),
  );
  assert.equal(
    Number(briefingMessage.items[1]),
    909,
  );
});

test("storyline courier missions use authored objective-chain tracker tuples when CCP data exposes them", (t) => {
  const characterID = extractFirstCharacterID();
  const agentRecord = findUsableLevelOneAgent();

  t.after(() => {
    restoreMissionTestState();
  });

  seedAcceptedMissionRecord(characterID, {
    missionSequence: 1,
    agentID: agentRecord.agentID,
    contentID: 3096,
    missionTemplateID: "client-mission:3096",
    missionContentTemplateID: "agent.missionTemplatizedContent_StorylineCourierMission",
    missionNameID: 0,
    missionPoolKey: "test:storyline-courier",
    missionKind: "courier",
    missionTypeLabel: "UI/Agents/MissionTypes/Courier",
    missionTitle: "Storyline Courier Test",
    importantMission: true,
    runtimeStatus: "accepted",
    placeholder: false,
    objectiveMode: "transport",
    objectiveCompleted: false,
    gmCompleted: false,
    offeredAtFileTime: currentFileTimeString(),
    acceptedAtFileTime: currentFileTimeString(),
    expiresAtFileTime: futureFileTimeString(),
    lastUpdatedAtMs: Date.now(),
    dungeonTemplateID: "",
    dungeonID: null,
    dungeonInstanceID: null,
    missionSiteID: null,
    missionSystemID: agentRecord.solarSystemID,
    missionPosition: null,
    bookmarkIDsByRole: {},
    cargo: {
      typeID: 2595,
      quantity: 1,
      volume: 1,
      hasCargo: false,
      granted: false,
    },
    pickupLocation: buildStationLocationWrap(agentRecord),
    dropoffLocation: buildStationLocationWrap(agentRecord),
    rewards: {
      isk: 0,
      bonusIsk: 0,
      loyaltyPoints: 0,
      researchPoints: 0,
      rawStandings: {
        corporation: 0,
        faction: 0,
        agent: 0,
      },
      standingEvents: {},
    },
  });

  const objectives = missionRuntime.getAllMissionObjectives(
    characterID,
    agentRecord.agentID,
  );
  assert.deepEqual(
    objectives.map(getTupleKey),
    ["MissionFetch"],
  );
});

test("mining-family missions no longer fall back to combat-only tracker tuples", (t) => {
  const characterID = extractFirstCharacterID();
  const agentRecord = findUsableLevelOneAgent();

  t.after(() => {
    restoreMissionTestState();
  });

  seedAcceptedMissionRecord(characterID, {
    missionSequence: 2,
    agentID: agentRecord.agentID,
    contentID: 4800,
    missionTemplateID: "client-dungeon:2457",
    missionContentTemplateID: "agent.missionTemplatizedContent_BasicMiningMission",
    missionNameID: 0,
    missionPoolKey: "test:mining",
    missionKind: "mining",
    missionTypeLabel: "UI/Agents/MissionTypes/Mining",
    missionTitle: "Basic Mining Mission",
    importantMission: false,
    runtimeStatus: "accepted",
    placeholder: false,
    objectiveMode: "dungeon",
    objectiveCompleted: false,
    gmCompleted: false,
    offeredAtFileTime: currentFileTimeString(),
    acceptedAtFileTime: currentFileTimeString(),
    expiresAtFileTime: futureFileTimeString(),
    lastUpdatedAtMs: Date.now(),
    dungeonTemplateID: "client-dungeon:2457",
    dungeonID: 2457,
    dungeonInstanceID: null,
    missionSiteID: 9700000000002,
    missionSystemID: agentRecord.solarSystemID,
    missionPosition: { x: 0, y: 0, z: 0 },
    bookmarkIDsByRole: {},
    cargo: null,
    pickupLocation: {
      locationID: agentRecord.solarSystemID,
      typeID: 5,
      solarsystemID: agentRecord.solarSystemID,
      locationType: "dungeon",
    },
    dropoffLocation: buildStationLocationWrap(agentRecord),
    rewards: {
      isk: 0,
      bonusIsk: 0,
      loyaltyPoints: 0,
      researchPoints: 0,
      rawStandings: {
        corporation: 0,
        faction: 0,
        agent: 0,
      },
      standingEvents: {},
    },
  });

  const objectives = missionRuntime.getAllMissionObjectives(
    characterID,
    agentRecord.agentID,
    {
      inActiveDungeon: true,
    },
  );
  assert.deepEqual(
    objectives.map(getTupleKey),
    ["TravelTo", "MissionFetchMine"],
  );
});

test("epic-arc talk-to-agent missions hand off to the referred agent using mission authority graph data", (t) => {
  const characterID = extractFirstCharacterID();
  const sourceAgent = findAgentByID(3019356);
  const targetAgent = findAgentByID(3019369);

  t.after(() => {
    restoreMissionTestState();
  });

  seedAcceptedMissionRecord(characterID, {
    missionSequence: 3,
    agentID: sourceAgent.agentID,
    contentID: 14118,
    missionTemplateID: "client-mission:14118",
    missionContentTemplateID: "agent.missionTemplatizedContent_EpicArcTalkToAgentMission",
    missionNameID: 0,
    missionPoolKey: "test:talk-to-agent",
    missionKind: "talkToAgent",
    missionTypeLabel: "UI/Agents/MissionTypes/Encounter",
    missionTitle: "Talk To Agent Mission",
    importantMission: true,
    runtimeStatus: "accepted",
    placeholder: false,
    objectiveMode: "agent",
    objectiveCompleted: false,
    gmCompleted: false,
    offeredAtFileTime: currentFileTimeString(),
    acceptedAtFileTime: currentFileTimeString(),
    expiresAtFileTime: futureFileTimeString(),
    lastUpdatedAtMs: Date.now(),
    dungeonTemplateID: "",
    dungeonID: null,
    dungeonInstanceID: null,
    missionSiteID: null,
    missionSystemID: targetAgent.solarSystemID,
    missionPosition: null,
    bookmarkIDsByRole: {},
    cargo: null,
    pickupLocation: buildStationLocationWrap(sourceAgent),
    dropoffLocation: buildStationLocationWrap(targetAgent),
    rewards: {
      isk: 0,
      bonusIsk: 0,
      itemRewards: [],
      bonusItemRewards: [],
      bonusTimeIntervalMinutes: 0,
      loyaltyPoints: 0,
      researchPoints: 0,
      rawStandings: {
        corporation: 0,
        faction: 0,
        agent: 0,
      },
      standingEvents: {},
    },
  });

  const objectiveInfo = missionRuntime.getMissionObjectiveInfo(
    characterID,
    sourceAgent.agentID,
  );
  assert.equal(objectiveInfo.objectives[0][0], "agent");
  assert.equal(objectiveInfo.objectives[0][1][0], targetAgent.agentID);

  const handoffResult = missionRuntime.doAgentAction(
    characterID,
    targetAgent.agentID,
    null,
  );
  assert.equal(handoffResult.success, true);

  const progressedMission = missionRuntime.getMissionRecord(
    characterID,
    targetAgent.agentID,
  );
  assert.ok(progressedMission, "expected referred agent to receive the next mission offer");
  assert.equal(progressedMission.runtimeStatus, "offered");
  assert.equal(progressedMission.contentID, 14119);
  assert.equal(
    missionRuntime.getMissionRecord(characterID, sourceAgent.agentID),
    null,
  );
});

test("epic-arc agent-interaction missions expose branch actions and advance to the selected next mission", (t) => {
  const characterID = extractFirstCharacterID();
  const sourceAgent = findAgentByID(3019356);

  t.after(() => {
    restoreMissionTestState();
  });

  seedAcceptedMissionRecord(characterID, {
    missionSequence: 4,
    agentID: sourceAgent.agentID,
    contentID: 14141,
    missionTemplateID: "client-mission:14141",
    missionContentTemplateID: "agent.missionTemplatizedContent_EpicArcAgentInteractionMission",
    missionNameID: 0,
    missionPoolKey: "test:agent-interaction",
    missionKind: "agentInteraction",
    missionTypeLabel: "UI/Agents/MissionTypes/Encounter",
    missionTitle: "Agent Interaction Mission",
    importantMission: true,
    runtimeStatus: "accepted",
    placeholder: false,
    objectiveMode: "agent",
    objectiveCompleted: false,
    gmCompleted: false,
    offeredAtFileTime: currentFileTimeString(),
    acceptedAtFileTime: currentFileTimeString(),
    expiresAtFileTime: futureFileTimeString(),
    lastUpdatedAtMs: Date.now(),
    dungeonTemplateID: "",
    dungeonID: null,
    dungeonInstanceID: null,
    missionSiteID: null,
    missionSystemID: sourceAgent.solarSystemID,
    missionPosition: null,
    bookmarkIDsByRole: {},
    cargo: null,
    pickupLocation: buildStationLocationWrap(sourceAgent),
    dropoffLocation: buildStationLocationWrap(sourceAgent),
    rewards: {
      isk: 0,
      bonusIsk: 0,
      itemRewards: [],
      bonusItemRewards: [],
      bonusTimeIntervalMinutes: 0,
      loyaltyPoints: 0,
      researchPoints: 0,
      rawStandings: {
        corporation: 0,
        faction: 0,
        agent: 0,
      },
      standingEvents: {},
    },
  });

  const conversation = missionRuntime.doAgentAction(
    characterID,
    sourceAgent.agentID,
    missionRuntime.AGENT_DIALOGUE_BUTTON_VIEW_MISSION,
  );
  assert.equal(conversation.success, true);
  const branchActions = conversation.data.actions.filter(([, actionData]) => (
    actionData && typeof actionData === "object"
  ));
  assert.ok(branchActions.length >= 2, "expected special interaction actions");

  const branchResult = missionRuntime.doAgentAction(
    characterID,
    sourceAgent.agentID,
    branchActions[0][0],
  );
  assert.equal(branchResult.success, true);

  const progressedMission = missionRuntime.getMissionRecord(
    characterID,
    sourceAgent.agentID,
  );
  assert.ok(progressedMission, "expected the next branch mission to be offered");
  assert.equal(progressedMission.runtimeStatus, "offered");
  assert.equal(progressedMission.contentID, 14139);
});

test("fetch-family mission payloads use fetch objectives, mission extra, and non-remote journal flags", (t) => {
  const characterID = extractFirstCharacterID();
  const agentRecord = findUsableLevelOneAgent();

  t.after(() => {
    restoreMissionTestState();
  });

  seedAcceptedMissionRecord(characterID, {
    missionSequence: 5,
    agentID: agentRecord.agentID,
    contentID: 1420,
    missionTemplateID: "client-mission:1420",
    missionContentTemplateID: "agent.missionTemplatizedContent_StorylineTradeMission",
    missionNameID: 0,
    missionPoolKey: "test:fetch",
    missionKind: "trade",
    missionTypeLabel: "UI/Agents/MissionTypes/Courier",
    missionTitle: "Fetch Mission",
    importantMission: true,
    runtimeStatus: "accepted",
    placeholder: false,
    objectiveMode: "fetch",
    objectiveCompleted: false,
    gmCompleted: false,
    offeredAtFileTime: currentFileTimeString(),
    acceptedAtFileTime: currentFileTimeString(),
    expiresAtFileTime: futureFileTimeString(),
    lastUpdatedAtMs: Date.now(),
    dungeonTemplateID: "",
    dungeonID: null,
    dungeonInstanceID: null,
    missionSiteID: null,
    missionSystemID: agentRecord.solarSystemID,
    missionPosition: null,
    bookmarkIDsByRole: {},
    cargo: {
      typeID: 20548,
      quantity: 1,
      volume: 1,
      hasCargo: false,
      granted: false,
    },
    pickupLocation: null,
    dropoffLocation: buildStationLocationWrap(agentRecord),
    rewards: {
      isk: 150000,
      bonusIsk: 0,
      itemRewards: [{ typeID: 15410, quantity: 1, extra: null }],
      bonusItemRewards: [{ typeID: 9956, quantity: 1, extra: null }],
      bonusTimeIntervalMinutes: 180,
      loyaltyPoints: 0,
      researchPoints: 0,
      rawStandings: {
        corporation: 0,
        faction: 0,
        agent: 0,
      },
      standingEvents: {},
    },
  });

  const objectiveInfo = missionRuntime.getMissionObjectiveInfo(
    characterID,
    agentRecord.agentID,
  );
  assert.equal(objectiveInfo.objectives[0][0], "fetch");
  assert.equal(objectiveInfo.normalRewards.length, 2);
  assert.equal(objectiveInfo.bonusRewards.length, 1);
  assert.ok(Array.isArray(objectiveInfo.missionExtra));

  const journalRows = missionRuntime.getJournalDetails(characterID)[0];
  assert.equal(journalRows.length, 1);
  assert.equal(journalRows[0][7], false);
  assert.equal(journalRows[0][8], false);
});
