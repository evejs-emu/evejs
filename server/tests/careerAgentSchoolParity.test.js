"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..");
const dataRoot = path.join(repoRoot, "server", "src", "newDatabase", "data");
const TutorialSvcService = require(path.join(
  repoRoot,
  "server/src/services/account/tutorialSvcService",
));
const AgentMgrService = require(path.join(
  repoRoot,
  "server/src/services/agent/agentMgrService",
));
const {
  getCharacterCreationSchools,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterCreationData",
));

const EXPECTED_STARTER_SCHOOLS = new Map([
  [31, { raceID: 4, corporationID: 1000165, solarSystemID: 30000141, stationID: 60015157 }],
  [32, { raceID: 4, corporationID: 1000077, solarSystemID: 30002715, stationID: 60015153 }],
  [33, { raceID: 2, corporationID: 1000171, solarSystemID: 30001672, stationID: 60015156 }],
  [34, { raceID: 2, corporationID: 1000172, solarSystemID: 30003489, stationID: 60015154 }],
  [35, { raceID: 1, corporationID: 1000045, solarSystemID: 30001392, stationID: 60015159 }],
  [36, { raceID: 1, corporationID: 1000044, solarSystemID: 30002505, stationID: 60015164 }],
  [37, { raceID: 8, corporationID: 1000115, solarSystemID: 30004971, stationID: 60015160 }],
  [38, { raceID: 8, corporationID: 1000169, solarSystemID: 30003410, stationID: 60015163 }],
]);

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(dataRoot, relativePath), "utf8"));
}

function sortedUniqueNumbers(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0),
  )].sort((left, right) => left - right);
}

test("build-3396210 starter schools expose latest starter locations", () => {
  const schools = getCharacterCreationSchools();
  const agents = readJson("agentAuthority/data.json").agentsByID;
  const stationIDs = new Set(
    readJson("stations/data.json").stations.map((station) => station.stationID),
  );
  const systemIDs = new Set(
    readJson("solarSystems/data.json").solarSystems
      .map((system) => system.solarSystemID),
  );

  for (const [schoolID, expected] of EXPECTED_STARTER_SCHOOLS) {
    const school = schools.find((entry) => entry.schoolID === schoolID);
    assert.ok(school, `missing starter school ${schoolID}`);
    assert.equal(school.isStarterSpaceSchool, true);
    assert.equal(school.raceID, expected.raceID);
    assert.equal(school.corporationID, expected.corporationID);
    assert.equal(school.solarSystemID, expected.solarSystemID);
    assert.deepEqual(school.startingStations, [expected.stationID]);
    assert.deepEqual(school.careerAgents, []);
    assert.ok(stationIDs.has(expected.stationID), `starter school ${schoolID} station`);
    assert.ok(systemIDs.has(expected.solarSystemID), `starter school ${schoolID} system`);
  }

  assert.ok(Object.values(agents).some((agent) => Number(agent.schoolID) > 0));
});

test("tutorial and agent services expose the same current career-agent set", () => {
  const schools = getCharacterCreationSchools();
  const agents = readJson("agentAuthority/data.json").agentsByID;
  const agentIDsBySchoolID = new Map();
  const schoolTaggedAgentIDs = [];
  for (const agent of Object.values(agents)) {
    const schoolID = Number(agent && agent.schoolID) || 0;
    const agentID = Number(agent && agent.agentID) || 0;
    if (schoolID <= 0 || agentID <= 0) {
      continue;
    }
    schoolTaggedAgentIDs.push(agentID);
    if (!agentIDsBySchoolID.has(schoolID)) {
      agentIDsBySchoolID.set(schoolID, []);
    }
    agentIDsBySchoolID.get(schoolID).push(agentID);
  }
  const expectedAgentIDs = new Set(sortedUniqueNumbers(schoolTaggedAgentIDs));
  assert.equal(expectedAgentIDs.size, 10940);

  const tutorial = new TutorialSvcService();
  const schoolEntries = new Map(tutorial.Handle_GetCareerAgents().entries);
  assert.equal(schoolEntries.size, schools.length);
  for (const school of schools) {
    assert.deepEqual(
      schoolEntries.get(school.schoolID).items,
      sortedUniqueNumbers([
        ...(agentIDsBySchoolID.get(school.schoolID) || []),
        ...school.careerAgents,
      ]),
    );
  }
  for (const schoolID of EXPECTED_STARTER_SCHOOLS.keys()) {
    assert.deepEqual(schoolEntries.get(schoolID).items, []);
  }

  const tutorialRows = tutorial.Handle_GetTutorialAgents().args.entries
    .find(([key]) => key === "lines")[1].items;
  assert.deepEqual(
    new Set(tutorialRows.map((row) => row[0])),
    expectedAgentIDs,
  );

  const agentRows = new AgentMgrService().Handle_GetAgents().args.entries
    .find(([key]) => key === "lines")[1].items;
  const agentMgrIDs = new Set(agentRows.map((row) => row.items[0]));
  for (const agentID of expectedAgentIDs) {
    assert.ok(agentMgrIDs.has(agentID), `agentMgr missing ${agentID}`);
  }
});
