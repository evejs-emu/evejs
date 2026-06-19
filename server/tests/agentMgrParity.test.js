const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const AgentMgrService = require(path.join(
  repoRoot,
  "server/src/services/agent/agentMgrService",
));
const database = require(path.join(
  repoRoot,
  "server/src/newDatabase",
));
const spaceRuntime = require(path.join(
  repoRoot,
  "server/src/space/runtime",
));
const agentMissionRuntime = require(path.join(
  repoRoot,
  "server/src/services/agent/agentMissionRuntime",
));
const bookmarkRuntime = require(path.join(
  repoRoot,
  "server/src/services/bookmark/bookmarkRuntimeState",
));
const {
  resetCharacterState,
} = require(path.join(
  repoRoot,
  "server/src/services/agent/missionRuntimeState",
));
const { marshalEncode } = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));
const { marshalDecode } = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));
const ConfigService = require(path.join(
  repoRoot,
  "server/src/services/config/configService",
));
const {
  getAgentByID,
  listAgents,
} = require(path.join(
  repoRoot,
  "server/src/services/agent/agentAuthority",
));
const {
  pickMissionForAgent,
} = require(path.join(
  repoRoot,
  "server/src/services/agent/missionAuthority",
));

function extractListItems(value) {
  return value && value.type === "list" && Array.isArray(value.items)
    ? value.items
    : [];
}

function extractRowLine(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && value.type === "list" && Array.isArray(value.items)) {
    return value.items;
  }
  return [];
}

function extractDictEntries(value) {
  return value && value.type === "dict" && Array.isArray(value.entries)
    ? value.entries
    : [];
}

function normalizeMarshalKey(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (value && value.type === "rawstr") {
    return String(value.value || "");
  }
  return value;
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

function unwrapCachedMethodResult(value) {
  if (
    !value ||
    value.type !== "object" ||
    !value.name ||
    value.name.type !== "rawstr" ||
    value.name.value !== "carbon.common.script.net.objectCaching.CachedMethodCallResult" ||
    !Array.isArray(value.args) ||
    !value.args[1] ||
    value.args[1].type !== "bytes"
  ) {
    return value;
  }
  return marshalDecode(value.args[1].value);
}

function findTwoStationAgentsSharingPool() {
  const agentsByPool = new Map();
  for (const agentRecord of listAgents()) {
    const poolKey = String(agentRecord && agentRecord.missionPoolKey || "");
    if (!poolKey || Number(agentRecord && agentRecord.stationID) <= 0) {
      continue;
    }
    if (!agentsByPool.has(poolKey)) {
      agentsByPool.set(poolKey, []);
    }
    agentsByPool.get(poolKey).push(agentRecord);
  }

  for (const agents of agentsByPool.values()) {
    if (agents.length < 2) {
      continue;
    }
    const sortedAgents = [...agents].sort(
      (left, right) => Number(left && left.agentID) - Number(right && right.agentID),
    );
    return sortedAgents.slice(0, 2);
  }
  return [];
}

function findTwoStationAgentsWithDistinctOpeningMissions() {
  const agentsByPool = new Map();
  for (const agentRecord of listAgents()) {
    const poolKey = String(agentRecord && agentRecord.missionPoolKey || "");
    if (!poolKey || Number(agentRecord && agentRecord.stationID) <= 0) {
      continue;
    }
    if (!agentsByPool.has(poolKey)) {
      agentsByPool.set(poolKey, []);
    }
    agentsByPool.get(poolKey).push(agentRecord);
  }

  for (const agents of agentsByPool.values()) {
    const sortedAgents = [...agents].sort(
      (left, right) => Number(left && left.agentID) - Number(right && right.agentID),
    );
    for (let index = 0; index < sortedAgents.length - 1; index += 1) {
      const firstAgent = sortedAgents[index];
      const secondAgent = sortedAgents[index + 1];
      const firstMission = pickMissionForAgent(firstAgent, 0);
      const secondMission = pickMissionForAgent(secondAgent, 0);
      if (
        firstMission &&
        secondMission &&
        String(firstMission.missionID) !== String(secondMission.missionID)
      ) {
        return [firstAgent, secondAgent];
      }
    }
  }
  return [];
}

test("agentMgr GetAgents returns the client-safe header and live authority rows", () => {
  const service = new AgentMgrService();
  const response = service.Handle_GetAgents();
  const headerEntries = extractListItems(
    response &&
      response.args &&
      response.args.type === "dict" &&
      Array.isArray(response.args.entries)
      ? response.args.entries.find(([key]) => key === "header")?.[1]
      : null,
  );
  const rowEntries = extractListItems(
    response &&
      response.args &&
      response.args.type === "dict" &&
      Array.isArray(response.args.entries)
      ? response.args.entries.find(([key]) => key === "lines")?.[1]
      : null,
  );

  assert.equal(response && response.name, "eve.common.script.sys.rowset.Rowset");
  assert.deepEqual(headerEntries, [
    "agentID",
    "agentTypeID",
    "divisionID",
    "level",
    "stationID",
    "corporationID",
    "isLocatorAgent",
    "isInSpace",
    "careerID",
    "importantMission",
    "missionKind",
    "missionTypeLabel",
    "specialityID",
    "stationTypeID",
    "bloodlineID",
  ]);
  assert.ok(rowEntries.length > 1000, "expected a populated live agent rowset");

  const sampleAgent = listAgents().find(
    (agentRecord) =>
      Number(agentRecord && agentRecord.agentID) > 0 &&
      Number(agentRecord && agentRecord.stationID) > 0,
  );
  assert.ok(sampleAgent, "expected at least one station-based agent");

  const matchingRow = rowEntries.find(
    (line) =>
      Number(extractRowLine(line)[0] || 0) === Number(sampleAgent.agentID),
  );
  assert.deepEqual(extractRowLine(matchingRow), [
    Number(sampleAgent.agentID),
    Number(sampleAgent.agentTypeID),
    Number(sampleAgent.divisionID),
    Number(sampleAgent.level),
    Number(sampleAgent.stationID),
    Number(sampleAgent.corporationID),
    sampleAgent.isLocator === true,
    sampleAgent.isInSpace === true,
    Number(sampleAgent.careerID || 0) || null,
    sampleAgent.importantMission === true,
    sampleAgent.missionKind || "",
    sampleAgent.missionTypeLabel || "",
    Number(sampleAgent.specialityID || 0) || null,
    Number(sampleAgent.stationTypeID || 0) || null,
    Number(sampleAgent.bloodlineID || 0) || null,
  ]);
  assert.equal(
    service.Handle_GetSolarSystemOfAgent([sampleAgent.agentID]),
    Number(sampleAgent.solarSystemID),
  );
});

test("agentMgr GetAgents includes bloodline data needed for agent show-info windows", () => {
  const service = new AgentMgrService();
  const response = service.Handle_GetAgents();
  const rowEntries = extractListItems(
    response &&
      response.args &&
      response.args.type === "dict" &&
      Array.isArray(response.args.entries)
      ? response.args.entries.find(([key]) => key === "lines")?.[1]
      : null,
  );

  const sampleAgent = getAgentByID(3011745);
  assert.ok(sampleAgent, "expected known authority-backed agent");

  const matchingRow = rowEntries.find(
    (line) =>
      Number(extractRowLine(line)[0] || 0) === Number(sampleAgent.agentID),
  );
  assert.ok(matchingRow, "expected sample agent row to be present");
  assert.equal(
    Number(extractRowLine(matchingRow)[14] || 0),
    Number(sampleAgent.bloodlineID || 0),
  );
});

test("config owner priming resolves NPC agents as proper character owners", () => {
  const service = new ConfigService();
  const sampleAgent = listAgents().find(
    (agentRecord) =>
      Number(agentRecord && agentRecord.agentID) > 0 &&
      typeof agentRecord.ownerName === "string" &&
      agentRecord.ownerName.trim().length > 0,
  );
  assert.ok(sampleAgent, "expected at least one authority-backed agent owner");

  const response = service.Handle_GetMultiOwnersEx([[sampleAgent.agentID]], {});
  assert.ok(Array.isArray(response), "expected tuple-set response");
  assert.deepEqual(response[0], [
    "ownerID",
    "ownerName",
    "typeID",
    "gender",
    "ownerNameID",
  ]);
  assert.equal(response[1].length, 1);
  assert.deepEqual(response[1][0], [
    Number(sampleAgent.agentID),
    sampleAgent.ownerName,
    Number(sampleAgent.ownerTypeID || 1373),
    Number(sampleAgent.gender || 0),
    null,
  ]);

  const staticInfo = getAgentByID(sampleAgent.agentID);
  assert.equal(Number(staticInfo.agentID), Number(sampleAgent.agentID));
  assert.equal(staticInfo.ownerName, sampleAgent.ownerName);
});

test("bound agent mission payloads are marshal-safe for direct DoAction and mission dictionaries", () => {
  const service = new AgentMgrService();
  const sampleAgent = listAgents().find(
    (agentRecord) =>
      Number(agentRecord && agentRecord.agentID) > 0 &&
      Number(agentRecord && agentRecord.stationID) > 0 &&
      Number(agentRecord && agentRecord.level) === 1,
  );
  assert.ok(sampleAgent, "expected at least one usable station agent");

  const session = {
    characterID: 140000005,
    currentBoundObjectID: null,
    _boundObjectIDs: {},
  };

  const bindResult = service.Handle_MachoBindObject([sampleAgent.agentID, null], session);
  const boundObjectID =
    bindResult &&
    Array.isArray(bindResult) &&
    bindResult[0] &&
    bindResult[0].type === "substruct" &&
    bindResult[0].value &&
    bindResult[0].value.type === "substream" &&
    Array.isArray(bindResult[0].value.value)
      ? bindResult[0].value.value[0]
      : null;

  assert.ok(boundObjectID, "expected a bound agent object ID");
  session.currentBoundObjectID = boundObjectID;

  assert.doesNotThrow(() => marshalEncode(service.Handle_DoAction([], session)));
  assert.doesNotThrow(() =>
    marshalEncode(service.Handle_GetCompletedCareerAgentIDs([[sampleAgent.agentID]], session)),
  );

  const actionPayload = service.Handle_DoAction([], session);
  assert.equal(actionPayload && actionPayload.type, "tuple");
  assert.equal(actionPayload.items[0] && actionPayload.items[0].type, "tuple");
  assert.equal(actionPayload.items[0].items[0] && actionPayload.items[0].items[0].type, "tuple");
  const agentSaysTuple = actionPayload.items[0].items[0];
  assert.ok(
    typeof agentSaysTuple.items[0] === "number" ||
      typeof agentSaysTuple.items[0] === "string",
    "expected old agent window message payload to expose a direct message ID or text",
  );

  const offeredPayload = service.Handle_DoAction(
    [agentMissionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION],
    session,
  );
  const offeredAgentSaysTuple = offeredPayload.items[0].items[0];
  assert.ok(
    typeof offeredAgentSaysTuple.items[0] === "number" ||
      typeof offeredAgentSaysTuple.items[0] === "string",
    "expected offered mission payload to expose a direct message ID or text",
  );
});

test("bound agent mission standings previews preserve numeric owner keys for mission UI", (t) => {
  const service = new AgentMgrService();
  const sampleAgent = listAgents().find(
    (agentRecord) =>
      Number(agentRecord && agentRecord.agentID) > 0 &&
      Number(agentRecord && agentRecord.stationID) > 0 &&
      Number(agentRecord && agentRecord.level) === 1,
  );
  assert.ok(sampleAgent, "expected at least one usable station agent");

  const session = {
    characterID: 140000005,
    currentBoundObjectID: null,
    _boundObjectIDs: {},
  };

  t.after(() => {
    resetCharacterState(session.characterID);
  });

  resetCharacterState(session.characterID);

  const bindResult = service.Handle_MachoBindObject([sampleAgent.agentID, null], session);
  const boundObjectID =
    bindResult &&
    Array.isArray(bindResult) &&
    bindResult[0] &&
    bindResult[0].type === "substruct" &&
    bindResult[0].value &&
    bindResult[0].value.type === "substream" &&
    Array.isArray(bindResult[0].value.value)
      ? bindResult[0].value.value[0]
      : null;
  assert.ok(boundObjectID, "expected a bound agent object ID");
  session.currentBoundObjectID = boundObjectID;

  service.Handle_DoAction([agentMissionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION], session);
  service.Handle_DoAction([agentMissionRuntime.AGENT_DIALOGUE_BUTTON_ACCEPT], session);

  const acceptedMission = agentMissionRuntime.getMissionRecord(
    session.characterID,
    sampleAgent.agentID,
  );
  assert.ok(acceptedMission, "expected accepted mission state");

  const response = service.Handle_GetStandingGainsForMission(
    [acceptedMission.contentID],
    session,
  );
  const entries = extractDictEntries(response);
  const keys = entries.map(([key]) => key);

  assert.ok(keys.includes(Number(sampleAgent.corporationID)));
  assert.ok(keys.includes(Number(sampleAgent.agentID)));
  assert.ok(keys.every((key) => typeof key === "number"));
});

test("bound GetMyJournalDetails only returns rows for the currently bound agent", (t) => {
  const service = new AgentMgrService();
  const [firstAgent, secondAgent] = findTwoStationAgentsSharingPool();
  assert.ok(firstAgent && secondAgent, "expected a pair of station agents sharing a mission pool");

  const characterID = 140000005;
  t.after(() => {
    resetCharacterState(characterID);
  });

  resetCharacterState(characterID);
  agentMissionRuntime.doAgentAction(
    characterID,
    firstAgent.agentID,
    agentMissionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
  );
  agentMissionRuntime.doAgentAction(
    characterID,
    firstAgent.agentID,
    agentMissionRuntime.AGENT_DIALOGUE_BUTTON_ACCEPT,
  );
  agentMissionRuntime.doAgentAction(
    characterID,
    secondAgent.agentID,
    agentMissionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
  );
  agentMissionRuntime.doAgentAction(
    characterID,
    secondAgent.agentID,
    agentMissionRuntime.AGENT_DIALOGUE_BUTTON_ACCEPT,
  );

  const session = {
    characterID,
    currentBoundObjectID: null,
    _boundObjectIDs: {},
  };
  const bindResult = service.Handle_MachoBindObject([firstAgent.agentID, null], session);
  const boundObjectID =
    bindResult &&
    Array.isArray(bindResult) &&
    bindResult[0] &&
    bindResult[0].type === "substruct" &&
    bindResult[0].value &&
    bindResult[0].value.type === "substream" &&
    Array.isArray(bindResult[0].value.value)
      ? bindResult[0].value.value[0]
      : null;
  assert.ok(boundObjectID, "expected bound object id");
  session.currentBoundObjectID = boundObjectID;

  const filteredBuckets = extractListItems(service.Handle_GetMyJournalDetails([], session));
  const filteredRows = extractListItems(filteredBuckets[0]);
  assert.equal(filteredRows.length, 1, "expected only the bound agent mission row");
  assert.equal(Number(extractRowLine(filteredRows[0])[4] || 0), Number(firstAgent.agentID));
});

test("agents sharing the same mission pool do not all offer the same first mission", () => {
  const [firstAgent, secondAgent] = findTwoStationAgentsWithDistinctOpeningMissions();
  assert.ok(firstAgent && secondAgent, "expected a pair of station agents sharing a mission pool");

  const firstMission = pickMissionForAgent(firstAgent, 0);
  const secondMission = pickMissionForAgent(secondAgent, 0);

  assert.ok(firstMission, "expected first pooled agent mission");
  assert.ok(secondMission, "expected second pooled agent mission");
  assert.notEqual(
    String(firstMission.missionID),
    String(secondMission.missionID),
    "expected pooled agents to start at different mission offers",
  );
});

test("agent info service reports level 1 mission agents as available without a false standings denial", () => {
  const service = new AgentMgrService();
  const sampleAgent = listAgents().find(
    (agentRecord) =>
      Number(agentRecord && agentRecord.agentID) > 0 &&
      Number(agentRecord && agentRecord.stationID) > 0 &&
      Number(agentRecord && agentRecord.level) === 1 &&
      Number(agentRecord && agentRecord.agentTypeID) !== 4,
  );
  assert.ok(sampleAgent, "expected at least one usable level 1 non-research agent");

  const session = {
    characterID: 140000005,
    currentBoundObjectID: null,
    _boundObjectIDs: {},
  };

  const bindResult = service.Handle_MachoBindObject([sampleAgent.agentID, null], session);
  const boundObjectID =
    bindResult &&
    Array.isArray(bindResult) &&
    bindResult[0] &&
    bindResult[0].type === "substruct" &&
    bindResult[0].value &&
    bindResult[0].value.type === "substream" &&
    Array.isArray(bindResult[0].value.value)
      ? bindResult[0].value.value[0]
      : null;
  assert.ok(boundObjectID, "expected a bound agent object ID");
  session.currentBoundObjectID = boundObjectID;

  const info = service.Handle_GetInfoServiceDetails([], session);
  const entries = keyValEntriesToMap(info);
  const services = entries.get("services");
  assert.ok(Array.isArray(services), "expected mission services array");
  const missionService = services.find(
    (entry) => keyValEntriesToMap(entry).get("agentServiceType") === "mission",
  );
  assert.ok(missionService, "expected mission service details");
  assert.equal(keyValEntriesToMap(missionService).get("available"), true);
});

test("mission service details stop advertising an agent as available while that agent already has an active mission", (t) => {
  const service = new AgentMgrService();
  const sampleAgent = listAgents().find(
    (agentRecord) =>
      Number(agentRecord && agentRecord.agentID) > 0 &&
      Number(agentRecord && agentRecord.stationID) > 0 &&
      Number(agentRecord && agentRecord.level) === 1,
  );
  assert.ok(sampleAgent, "expected a usable station agent");

  const characterID = 140000005;
  t.after(() => {
    resetCharacterState(characterID);
  });

  resetCharacterState(characterID);
  agentMissionRuntime.doAgentAction(
    characterID,
    sampleAgent.agentID,
    agentMissionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
  );
  agentMissionRuntime.doAgentAction(
    characterID,
    sampleAgent.agentID,
    agentMissionRuntime.AGENT_DIALOGUE_BUTTON_ACCEPT,
  );

  const session = {
    characterID,
    currentBoundObjectID: null,
    _boundObjectIDs: {},
  };
  const bindResult = service.Handle_MachoBindObject([sampleAgent.agentID, null], session);
  const boundObjectID =
    bindResult &&
    Array.isArray(bindResult) &&
    bindResult[0] &&
    bindResult[0].type === "substruct" &&
    bindResult[0].value &&
    bindResult[0].value.type === "substream" &&
    Array.isArray(bindResult[0].value.value)
      ? bindResult[0].value.value[0]
      : null;
  assert.ok(boundObjectID, "expected a bound mission agent object");
  session.currentBoundObjectID = boundObjectID;

  const info = service.Handle_GetInfoServiceDetails([], session);
  const entries = keyValEntriesToMap(info);
  const services = entries.get("services");
  const missionService = services.find(
    (entry) => keyValEntriesToMap(entry).get("agentServiceType") === "mission",
  );
  assert.ok(missionService, "expected mission service details");
  assert.equal(keyValEntriesToMap(missionService).get("available"), false);
});

test("bound mission-agent WarpToLocation resolves accepted dungeon objectives into a real warp target", (t) => {
  const service = new AgentMgrService();
  const sampleAgent = listAgents().find(
    (agentRecord) =>
      Number(agentRecord && agentRecord.agentID) > 0 &&
      Number(agentRecord && agentRecord.stationID) > 0 &&
      Number(agentRecord && agentRecord.level) === 1 &&
      Boolean(
        (() => {
          const openingMission = pickMissionForAgent(agentRecord, 0);
          return (
            openingMission &&
            openingMission.killMission &&
            Object.keys(openingMission.killMission).length > 0
          );
        })(),
      ),
  );
  assert.ok(sampleAgent, "expected a usable station agent");

  const characterID = 140000005;
  t.after(() => {
    resetCharacterState(characterID);
  });

  resetCharacterState(characterID);
  agentMissionRuntime.doAgentAction(
    characterID,
    sampleAgent.agentID,
    agentMissionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
  );
  agentMissionRuntime.doAgentAction(
    characterID,
    sampleAgent.agentID,
    agentMissionRuntime.AGENT_DIALOGUE_BUTTON_ACCEPT,
  );

  const acceptedMission = agentMissionRuntime.getMissionRecord(
    characterID,
    sampleAgent.agentID,
  );
  assert.ok(acceptedMission, "expected accepted mission state");
  assert.ok(
    acceptedMission.missionPosition &&
      typeof acceptedMission.missionPosition === "object",
    "expected accepted mission to carry missionPosition",
  );

  const session = {
    characterID,
    currentBoundObjectID: null,
    _boundObjectIDs: {},
  };
  const bindResult = service.Handle_MachoBindObject([sampleAgent.agentID, null], session);
  const boundObjectID =
    bindResult &&
    Array.isArray(bindResult) &&
    bindResult[0] &&
    bindResult[0].type === "substruct" &&
    bindResult[0].value &&
    bindResult[0].value.type === "substream" &&
    Array.isArray(bindResult[0].value.value)
      ? bindResult[0].value.value[0]
      : null;
  assert.ok(boundObjectID, "expected bound object id");
  session.currentBoundObjectID = boundObjectID;

  const originalWarpToPoint = spaceRuntime.warpToPoint;
  const warpCalls = [];
  spaceRuntime.warpToPoint = (boundSession, point, options = {}) => {
    warpCalls.push({ boundSession, point, options });
    return { success: true };
  };

  t.after(() => {
    spaceRuntime.warpToPoint = originalWarpToPoint;
  });

  service.Handle_WarpToLocation(["dungeon", 0, 0, false, null, null], session);

  assert.equal(warpCalls.length, 1, "expected one warp-to-point dispatch");
  assert.equal(warpCalls[0].boundSession, session);
  assert.deepEqual(
    warpCalls[0].point,
    {
      x: Number(acceptedMission.missionPosition.x),
      y: Number(acceptedMission.missionPosition.y),
      z: Number(acceptedMission.missionPosition.z),
    },
    "expected bound WarpToLocation to use the accepted mission bookmark position",
  );
});

test("bound mission-agent WarpToLocation ignores stale dungeon bookmarks and falls back to the live mission position", (t) => {
  const service = new AgentMgrService();
  const sampleAgent = listAgents().find(
    (agentRecord) =>
      Number(agentRecord && agentRecord.agentID) > 0 &&
      Number(agentRecord && agentRecord.stationID) > 0 &&
      Number(agentRecord && agentRecord.level) === 1 &&
      Boolean(
        (() => {
          const openingMission = pickMissionForAgent(agentRecord, 0);
          return (
            openingMission &&
            openingMission.killMission &&
            Object.keys(openingMission.killMission).length > 0
          );
        })(),
      ),
  );
  assert.ok(sampleAgent, "expected a usable station agent");

  const characterID = 140000005;
  t.after(() => {
    resetCharacterState(characterID);
  });

  resetCharacterState(characterID);
  agentMissionRuntime.doAgentAction(
    characterID,
    sampleAgent.agentID,
    agentMissionRuntime.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
  );
  agentMissionRuntime.doAgentAction(
    characterID,
    sampleAgent.agentID,
    agentMissionRuntime.AGENT_DIALOGUE_BUTTON_ACCEPT,
  );

  const acceptedMission = agentMissionRuntime.getMissionRecord(
    characterID,
    sampleAgent.agentID,
  );
  assert.ok(acceptedMission, "expected accepted mission state");

  const visibleFolder = bookmarkRuntime.ensureDefaultPersonalFolder(characterID);
  const staleBookmark = bookmarkRuntime.createBookmark(characterID, {
    folderID: visibleFolder.folderID,
    memo: `${acceptedMission.missionTitle} (stale)`,
    note: "",
    itemID: acceptedMission.missionSystemID,
    typeID: 5,
    locationID: acceptedMission.missionSystemID,
    x: Number(acceptedMission.missionPosition.x) + 1000000,
    y: Number(acceptedMission.missionPosition.y) + 1000000,
    z: Number(acceptedMission.missionPosition.z) + 1000000,
    metadata: {
      role: "dungeon",
      locationType: "dungeon",
      agentID: sampleAgent.agentID,
      referringAgentID: sampleAgent.agentID,
      missionInstanceID: Number(acceptedMission.dungeonInstanceID || 0) + 777,
      missionSiteID: Number(acceptedMission.missionSiteID || 0) + 777,
    },
  });
  assert.ok(staleBookmark && staleBookmark.bookmark, "expected stale bookmark");

  const runtimeState = database.read("missionRuntimeState", "/");
  assert.equal(runtimeState.success, true, "expected mission runtime state");
  runtimeState.data.charactersByID[String(characterID)].missionsByAgentID[String(sampleAgent.agentID)].bookmarkIDsByRole.dungeon =
    staleBookmark.bookmark.bookmarkID;
  database.write("missionRuntimeState", "/", runtimeState.data);

  const session = {
    characterID,
    currentBoundObjectID: null,
    _boundObjectIDs: {},
  };
  const bindResult = service.Handle_MachoBindObject([sampleAgent.agentID, null], session);
  const boundObjectID =
    bindResult &&
    Array.isArray(bindResult) &&
    bindResult[0] &&
    bindResult[0].type === "substruct" &&
    bindResult[0].value &&
    bindResult[0].value.type === "substream" &&
    Array.isArray(bindResult[0].value.value)
      ? bindResult[0].value.value[0]
      : null;
  assert.ok(boundObjectID, "expected bound object id");
  session.currentBoundObjectID = boundObjectID;

  const originalWarpToPoint = spaceRuntime.warpToPoint;
  const warpCalls = [];
  spaceRuntime.warpToPoint = (boundSession, point, options = {}) => {
    warpCalls.push({ boundSession, point, options });
    return { success: true };
  };

  t.after(() => {
    spaceRuntime.warpToPoint = originalWarpToPoint;
  });

  service.Handle_WarpToLocation(["dungeon", 0, 0, false, null, null], session);

  assert.equal(warpCalls.length, 1, "expected one warp-to-point dispatch");
  assert.deepEqual(
    warpCalls[0].point,
    {
      x: Number(acceptedMission.missionPosition.x),
      y: Number(acceptedMission.missionPosition.y),
      z: Number(acceptedMission.missionPosition.z),
    },
    "expected stale mission bookmark to be ignored in favor of the live mission position",
  );
  assert.equal(
    bookmarkRuntime.getBookmark(staleBookmark.bookmark.bookmarkID),
    null,
    "expected stale mission bookmark to be removed once rejected",
  );
});

test("career-agent completion payloads preserve requested numeric agent IDs", () => {
  const service = new AgentMgrService();
  const careerAgentIDs = listAgents()
    .filter((agentRecord) => Number(agentRecord && agentRecord.careerID) > 0)
    .slice(0, 3)
    .map((agentRecord) => Number(agentRecord.agentID));

  assert.equal(careerAgentIDs.length, 3, "expected several career agents in authority");

  const response = service.Handle_GetCompletedCareerAgentIDs([careerAgentIDs], {
    characterID: 140000005,
  });
  const entries = extractDictEntries(response);

  assert.equal(entries.length, careerAgentIDs.length);
  assert.deepEqual(
    entries.map(([agentID]) => Number(agentID)).sort((left, right) => left - right),
    [...careerAgentIDs].sort((left, right) => left - right),
  );
});

test("epic-arc message payloads expose numeric mission-key maps from mission authority", () => {
  const service = new AgentMgrService();
  const response = service.Handle_GetMessagesForEpicArcMissions();
  const secondResponse = service.Handle_GetMessagesForEpicArcMissions();
  const decodedResponse = unwrapCachedMethodResult(response);
  const decodedSecondResponse = unwrapCachedMethodResult(secondResponse);
  const entries = new Map(
    extractDictEntries(decodedResponse).map(([key, value]) => [normalizeMarshalKey(key), value]),
  );
  const chapterMessages = extractDictEntries(entries.get("messages.epicMission.journalText.chapterTitle"));
  const inProgressMessages = extractDictEntries(entries.get("messages.epicMission.journalText.inProgressMessage"));
  const completedMessages = extractDictEntries(entries.get("messages.epicMission.journalText.completedMessage"));

  assert.equal(response && response.type, "object");
  assert.equal(response && response.name && response.name.value, "carbon.common.script.net.objectCaching.CachedMethodCallResult");
  assert.ok(chapterMessages.length > 0, "expected epic-arc chapter message IDs");
  assert.ok(inProgressMessages.length > 0, "expected epic-arc in-progress message IDs");
  assert.ok(completedMessages.length > 0, "expected epic-arc completed message IDs");
  assert.equal(typeof chapterMessages[0][0], "number");
  assert.equal(typeof chapterMessages[0][1], "number");
  assert.deepEqual(decodedResponse, decodedSecondResponse);
});

test("agent location wrap resolves a real station solar system for station agents", () => {
  const location = agentMissionRuntime.getAgentLocationWrap(3008683);

  assert.equal(Number(location && location.locationID), 60008179);
  assert.equal(Number(location && location.typeID), 1927);
  assert.equal(Number(location && location.solarsystemID), 30005261);
  assert.equal(location && location.locationType, "station");
});
