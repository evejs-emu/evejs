const path = require("path");

const {
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  buildObjectEx1,
  buildRowset,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const CURRENT_SOV_DATA_HEADER = [
  "locationID",
  "solarSystemID",
  "constellationID",
  "regionID",
  "ownerID",
  "allianceID",
  "corporationID",
  "claimStructureID",
  "infrastructureHubID",
  "stationID",
  "claimTime",
];

const RECENT_SOV_ACTIVITY_HEADER = [
  "solarSystemID",
  "ownerID",
  "oldOwnerID",
  "stationID",
  "changeTime",
];

function buildAlliancePrimeInfoPayload(primeInfo = {}) {
  return buildKeyVal([
    ["currentPrimeHour", Number(primeInfo.currentPrimeHour || 0)],
    ["newPrimeHour", Number(primeInfo.newPrimeHour || 0)],
    ["newPrimeHourValidAfter", buildFiletimeLong(primeInfo.newPrimeHourValidAfter || "0")],
  ]);
}

function buildAllianceCapitalInfoPayload(capitalInfo = {}) {
  return buildKeyVal([
    ["currentCapitalSystem", capitalInfo.currentCapitalSystem || null],
    ["newCapitalSystem", capitalInfo.newCapitalSystem || null],
    [
      "newCapitalSystemValidAfter",
      buildFiletimeLong(capitalInfo.newCapitalSystemValidAfter || "0"),
    ],
  ]);
}

function buildAllianceSystemListPayload(records = []) {
  return buildList(
    records.map((record) =>
      buildKeyVal([
        ["solarSystemID", Number(record.solarSystemID || 0)],
        ["allianceID", Number(record.allianceID || 0)],
      ]),
    ),
  );
}

function buildDevelopmentIndicesForSystemPayload(indicesByAttribute = {}) {
  return buildDict(
    Object.entries(indicesByAttribute).map(([attributeID, value]) => [
      Number(attributeID),
      buildKeyVal([
        ["points", Number(value && value.points ? value.points : 0)],
        ["increasing", Boolean(value && value.increasing)],
      ]),
    ]),
  );
}

function buildAllDevelopmentIndicesPayload(records = []) {
  return buildList(
    records.map((record) =>
      buildKeyVal([
        ["solarSystemID", Number(record.solarSystemID || 0)],
        ["militaryPoints", Number(record.militaryPoints || 0)],
        ["industrialPoints", Number(record.industrialPoints || 0)],
        ["claimedFor", Number(record.claimedFor || 0)],
      ]),
    ),
  );
}

function buildSovClaimInfoPayload(claimInfo = null) {
  if (!claimInfo) {
    return null;
  }
  return buildObjectEx1("sovereignty.data_types.SovClaimInfo", [
    claimInfo.claimStructureID || null,
    claimInfo.corporationID || null,
    claimInfo.allianceID || null,
  ]);
}

function buildSovHubInfoPayload(hubInfo = null) {
  if (!hubInfo) {
    return null;
  }
  return buildObjectEx1("sovereignty.data_types.SovHubInfo", [
    hubInfo.hubID || null,
    hubInfo.corporationID || null,
    hubInfo.allianceID || null,
    buildFiletimeLong(hubInfo.claimTime || "0"),
  ]);
}

function buildCampaignStatePayload(structure = {}) {
  if (!structure.campaignEventType || !structure.campaignStartTime || structure.campaignStartTime === "0") {
    return null;
  }
  return [
    Number(structure.campaignEventType || 0),
    structure.allianceID || null,
    buildFiletimeLong(structure.campaignStartTime || "0"),
    buildDict(
      Object.entries(structure.campaignScoresByTeam || {}).map(([teamID, score]) => [
        Number(teamID),
        Number(score || 0),
      ]),
    ),
  ];
}

function buildVulnerabilityStatePayload(structure = {}) {
  if (!structure.vulnerableStartTime || !structure.vulnerableEndTime) {
    return null;
  }
  if (structure.vulnerableStartTime === "0" || structure.vulnerableEndTime === "0") {
    return null;
  }
  return [
    buildFiletimeLong(structure.vulnerableStartTime),
    buildFiletimeLong(structure.vulnerableEndTime),
  ];
}

function buildSovStructuresPayload(structures = []) {
  return buildList(
    structures.map((structure) =>
      buildKeyVal([
        ["itemID", structure.itemID],
        ["typeID", structure.typeID],
        ["ownerID", structure.ownerID || null],
        ["corporationID", structure.corporationID || null],
        ["allianceID", structure.allianceID || null],
        ["solarSystemID", structure.solarSystemID || null],
        ["campaignState", buildCampaignStatePayload(structure)],
        ["vulnerabilityState", buildVulnerabilityStatePayload(structure)],
        ["defenseMultiplier", Number(structure.defenseMultiplier || 1)],
        ["isCapital", Boolean(structure.isCapital)],
      ]),
    ),
  );
}

function buildAllianceSovereigntyRowsPayload(rows = {}) {
  const buildRowPayload = (row = {}) =>
    buildKeyVal(
      Object.entries(row).map(([key, value]) => [
        key,
        /Time$/i.test(key) && value && value !== "0" ? buildFiletimeLong(value) : value,
      ]),
    );

  return [
    buildList((rows.tcuRows || []).map((row) => buildRowPayload(row))),
    buildList((rows.iHubRows || []).map((row) => buildRowPayload(row))),
    buildList((rows.campaignScoreRows || []).map((row) => buildRowPayload(row))),
  ];
}

function buildCurrentSovDataPayload(rows = []) {
  return buildRowset(
    CURRENT_SOV_DATA_HEADER,
    rows.map((row) => [
      row.locationID || null,
      row.solarSystemID || null,
      row.constellationID || null,
      row.regionID || null,
      row.ownerID || null,
      row.allianceID || null,
      row.corporationID || null,
      row.claimStructureID || null,
      row.infrastructureHubID || null,
      row.stationID || null,
      buildFiletimeLong(row.claimTime || "0"),
    ]),
    "eve.common.script.sys.rowset.Rowset",
  );
}

function buildRecentSovActivityPayload(rows = []) {
  return buildRowset(
    RECENT_SOV_ACTIVITY_HEADER,
    rows.map((row) => [
      row.solarSystemID || null,
      row.ownerID || null,
      row.oldOwnerID || null,
      row.stationID || null,
      buildFiletimeLong(row.changeTime || "0"),
    ]),
    "eve.common.script.sys.rowset.Rowset",
  );
}

module.exports = {
  buildAllianceCapitalInfoPayload,
  buildAlliancePrimeInfoPayload,
  buildAllianceSovereigntyRowsPayload,
  buildAllianceSystemListPayload,
  buildAllDevelopmentIndicesPayload,
  buildCurrentSovDataPayload,
  buildDevelopmentIndicesForSystemPayload,
  buildRecentSovActivityPayload,
  buildSovClaimInfoPayload,
  buildSovHubInfoPayload,
  buildSovStructuresPayload,
};
