const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildKeyVal,
  buildList,
  buildRowset,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getCharacterCreationSchools,
} = require(path.join(__dirname, "../character/characterCreationData"));
const {
  listAgents,
} = require(path.join(__dirname, "../agent/agentAuthority"));

function listCareerAgents() {
  return listAgents()
    .filter((agent) => normalizeNumber(agent && agent.schoolID, 0) > 0)
    .sort((left, right) => left.agentID - right.agentID);
}

function listCareerAgentEntriesBySchoolID() {
  const agentIDsBySchoolID = new Map();
  for (const agent of listCareerAgents()) {
    const schoolID = normalizeNumber(agent && agent.schoolID, 0);
    const agentID = normalizeNumber(agent && agent.agentID, 0);
    if (schoolID <= 0 || agentID <= 0) {
      continue;
    }
    if (!agentIDsBySchoolID.has(schoolID)) {
      agentIDsBySchoolID.set(schoolID, []);
    }
    agentIDsBySchoolID.get(schoolID).push(agentID);
  }

  for (const school of getCharacterCreationSchools()) {
    const schoolID = normalizeNumber(school && school.schoolID, 0);
    if (schoolID <= 0) {
      continue;
    }
    if (!agentIDsBySchoolID.has(schoolID)) {
      agentIDsBySchoolID.set(schoolID, []);
    }
    for (const agentID of Array.isArray(school && school.careerAgents)
      ? school.careerAgents
      : []) {
      const numericAgentID = normalizeNumber(agentID, 0);
      if (numericAgentID > 0 && !agentIDsBySchoolID.get(schoolID).includes(numericAgentID)) {
        agentIDsBySchoolID.get(schoolID).push(numericAgentID);
      }
    }
  }

  return [...agentIDsBySchoolID.entries()]
    .sort(([left], [right]) => left - right)
    .map(([schoolID, agentIDs]) => [
      schoolID,
      [...new Set(agentIDs)].sort((left, right) => left - right),
    ]);
}

function buildTutorialInfo(tutorialId) {
  return buildKeyVal([
    [
      "tutorial",
      buildKeyVal([
        ["tutorialID", tutorialId],
        ["categoryID", null],
      ]),
    ],
    ["pages", buildList([])],
    ["pagecriterias", buildList([])],
    ["criterias", buildList([])],
  ]);
}

class TutorialSvcService extends BaseService {
  constructor() {
    super("tutorialSvc");
  }

  Handle_GetTutorials() {
    log.debug("[TutorialSvc] GetTutorials");
    return buildRowset(["tutorialID", "tutorialNameID", "categoryID"], []);
  }

  Handle_GetTutorialInfo(args) {
    const tutorialId = normalizeNumber(args && args[0], 0);
    log.debug(`[TutorialSvc] GetTutorialInfo(${tutorialId})`);
    return buildTutorialInfo(tutorialId);
  }

  Handle_GetTutorialAgents() {
    const rows = listCareerAgents().map((agent) => [
      normalizeNumber(agent.agentID, 0),
      normalizeNumber(agent.agentTypeID, 0),
      normalizeNumber(agent.divisionID, 0),
      normalizeNumber(agent.level, 0),
      normalizeNumber(agent.stationID, 0),
      normalizeNumber(agent.bloodlineID, 0),
      0,
      normalizeNumber(agent.corporationID, 0),
      normalizeNumber(agent.gender, 0),
    ]);
    log.debug(`[TutorialSvc] GetTutorialAgents -> ${rows.length}`);
    return buildRowset(
      [
        "agentID",
        "agentTypeID",
        "divisionID",
        "level",
        "stationID",
        "bloodlineID",
        "quality",
        "corporationID",
        "gender",
      ],
      rows,
    );
  }

  Handle_GetCriterias() {
    log.debug("[TutorialSvc] GetCriterias");
    return buildRowset(
      ["criteriaID", "messageTextID", "criteriaTypeID", "pageCriteriaID"],
      [],
    );
  }

  Handle_GetCategories() {
    log.debug("[TutorialSvc] GetCategories");
    return buildRowset(
      ["categoryID", "categoryNameID", "descriptionID"],
      [],
    );
  }

  Handle_GetActions() {
    log.debug("[TutorialSvc] GetActions");
    return buildRowset(["actionID", "actionTypeID", "actionData"], []);
  }

  Handle_GetCharacterTutorialState() {
    log.debug("[TutorialSvc] GetCharacterTutorialState");
    return 0;
  }

  Handle_GetTutorialsAndConnections() {
    log.debug("[TutorialSvc] GetTutorialsAndConnections");
    return [
      buildRowset(["tutorialID", "tutorialNameID", "categoryID"], []),
      buildRowset(["tutorialID", "raceID", "nextTutorialID"], []),
    ];
  }

  Handle_GetCareerAgents() {
    const schoolEntries = listCareerAgentEntriesBySchoolID()
      .map(([schoolID, agentIDs]) => [schoolID, buildList(agentIDs)]);
    log.debug(`[TutorialSvc] GetCareerAgents -> ${schoolEntries.length} schools`);
    return buildDict(schoolEntries);
  }

  Handle_LogCompleted() {
    return null;
  }

  Handle_LogAborted() {
    return null;
  }

  Handle_LogStarted() {
    return null;
  }

  Handle_LogClosed() {
    return null;
  }

  Handle_LogAppClosed() {
    return null;
  }
}

module.exports = TutorialSvcService;
