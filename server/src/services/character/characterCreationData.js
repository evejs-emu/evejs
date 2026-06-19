const path = require("path");

const {
  TABLE,
  clearReferenceCache,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));

const DEFAULT_CHARACTER_TYPE_ID = 1373;
// The client still expects these legacy character typeIDs for paperdoll payloads.
const BLOODLINE_CHARACTER_TYPE_ID = Object.freeze({
  1: 1373,
  2: 1374,
  3: 1375,
  4: 1376,
  5: 1377,
  6: 1378,
  7: 1379,
  8: 1380,
  11: 1383,
  12: 1384,
  13: 1385,
  14: 1386,
});

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeStarterSkillEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const typeID = toNumber(entry.typeID, 0);
  if (typeID <= 0) {
    return null;
  }

  return {
    typeID,
    level: Math.max(0, Math.min(5, toNumber(entry.level, 0))),
  };
}

function normalizeCharacterCreationRace(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const raceID = toNumber(entry.raceID, 0);
  if (raceID <= 0) {
    return null;
  }

  return {
    raceID,
    name: typeof entry.name === "string" ? entry.name : "",
    shipTypeID: toNumber(entry.shipTypeID, 0) || null,
    shipName: typeof entry.shipName === "string" ? entry.shipName : "",
    skills: (Array.isArray(entry.skills) ? entry.skills : [])
      .map((skillEntry) => normalizeStarterSkillEntry(skillEntry))
      .filter(Boolean),
  };
}

function normalizeCharacterCreationBloodline(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const bloodlineID = toNumber(entry.bloodlineID, 0);
  if (bloodlineID <= 0) {
    return null;
  }

  return {
    bloodlineID,
    name: typeof entry.name === "string" ? entry.name : "",
    raceID: toNumber(entry.raceID, 0) || null,
    corporationID: toNumber(entry.corporationID, 0) || null,
  };
}

function normalizeCharacterCreationSchool(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const schoolID = toNumber(entry.schoolID || entry._key, 0);
  if (schoolID <= 0) {
    return null;
  }

  return {
    schoolID,
    raceID: toNumber(entry.raceID, 0) || null,
    corporationID: toNumber(entry.corporationID, 0) || null,
    careerID: toNumber(entry.careerID, 0) || null,
    startingStations: (Array.isArray(entry.startingStations)
      ? entry.startingStations
      : []
    )
      .map((stationID) => toNumber(stationID, 0))
      .filter((stationID) => stationID > 0),
    isStarterSpaceSchool:
      entry.isStarterSpaceSchool === true ||
      entry.is_starter_space_school === true ||
      entry.is_starter_space_school === 1,
    solarSystemID: toNumber(entry.solarSystemID, 0) || null,
    schoolMapSource:
      typeof entry.schoolMapSource === "string"
        ? entry.schoolMapSource
        : null,
    careerAgents: (Array.isArray(entry.careerAgents)
      ? entry.careerAgents
      : []
    )
      .map((agentID) => toNumber(agentID, 0))
      .filter((agentID) => agentID > 0),
  };
}

function getCharacterCreationRaces(options = {}) {
  if (options && options.refresh) {
    clearReferenceCache(TABLE.CHARACTER_CREATION_RACES);
  }

  return readStaticRows(TABLE.CHARACTER_CREATION_RACES)
    .map((entry) => normalizeCharacterCreationRace(entry))
    .filter(Boolean)
    .map((entry) => cloneValue(entry));
}

function getCharacterCreationRace(raceID, options = {}) {
  const numericRaceID = toNumber(raceID, 0);
  return (
    getCharacterCreationRaces(options).find((entry) => entry.raceID === numericRaceID) ||
    null
  );
}

function getCharacterCreationBloodlines(options = {}) {
  if (options && options.refresh) {
    clearReferenceCache(TABLE.CHARACTER_CREATION_BLOODLINES);
  }

  return readStaticRows(TABLE.CHARACTER_CREATION_BLOODLINES)
    .map((entry) => normalizeCharacterCreationBloodline(entry))
    .filter(Boolean)
    .map((entry) => cloneValue(entry));
}

function getCharacterCreationBloodline(bloodlineID, options = {}) {
  const numericBloodlineID = toNumber(bloodlineID, 0);
  return (
    getCharacterCreationBloodlines(options).find(
      (entry) => entry.bloodlineID === numericBloodlineID,
    ) || null
  );
}

function getCharacterCreationSchools(options = {}) {
  if (options && options.refresh) {
    clearReferenceCache(TABLE.CHARACTER_CREATION_SCHOOLS);
  }

  return readStaticRows(TABLE.CHARACTER_CREATION_SCHOOLS)
    .map((entry) => normalizeCharacterCreationSchool(entry))
    .filter(Boolean)
    .map((entry) => cloneValue(entry));
}

function getCharacterCreationSchool(schoolID, options = {}) {
  const numericSchoolID = toNumber(schoolID, 0);
  return (
    getCharacterCreationSchools(options).find(
      (entry) => entry.schoolID === numericSchoolID,
    ) || null
  );
}

function getCharacterCreationSchoolStartingSolarSystemID(schoolID, options = {}) {
  const school = getCharacterCreationSchool(schoolID, options);
  return toNumber(school && school.solarSystemID, 0) || null;
}

function getCharacterCreationQAStarterSystemIDs(options = {}) {
  return [...new Set(
    getCharacterCreationSchools(options)
      .map((school) => toNumber(school && school.solarSystemID, 0))
      .filter((solarSystemID) => solarSystemID > 0),
  )].sort((left, right) => left - right);
}

function resolveCharacterCreationSchoolProfile(schoolID, fallback = {}) {
  const numericSchoolID = toNumber(schoolID, 0);
  const school = getCharacterCreationSchool(numericSchoolID);
  return {
    schoolID: (school && school.schoolID) || toNumber(fallback.schoolID, 11) || 11,
    raceID:
      (school && school.raceID) ||
      toNumber(fallback.raceID, 1) ||
      1,
    corporationID:
      (school && school.corporationID) ||
      toNumber(fallback.corporationID, null),
    careerID:
      (school && school.careerID) ||
      toNumber(fallback.careerID, null),
    startingStations:
      school && Array.isArray(school.startingStations)
        ? cloneValue(school.startingStations)
        : [],
    isStarterSpaceSchool: Boolean(school && school.isStarterSpaceSchool),
    solarSystemID:
      (school && school.solarSystemID) ||
      toNumber(fallback.solarSystemID, null),
    schoolMapSource:
      (school && school.schoolMapSource) ||
      (typeof fallback.schoolMapSource === "string"
        ? fallback.schoolMapSource
        : null),
    careerAgents:
      school && Array.isArray(school.careerAgents)
        ? cloneValue(school.careerAgents)
        : [],
  };
}

function resolveCharacterCreationSchoolIDForRace(schoolID, raceID, fallback = 11) {
  const numericSchoolID = toNumber(schoolID, 0);
  const numericRaceID = toNumber(raceID, 0);
  const schools = getCharacterCreationSchools();
  const requestedSchool = schools.find(
    (school) => school.schoolID === numericSchoolID,
  );
  if (
    requestedSchool &&
    (
      numericRaceID <= 0 ||
      !requestedSchool.raceID ||
      requestedSchool.raceID === numericRaceID
    )
  ) {
    return requestedSchool.schoolID;
  }

  const legacyCorporationSchool = schools
    .filter(
      (school) =>
        school.corporationID === numericSchoolID &&
        (!numericRaceID || school.raceID === numericRaceID),
    )
    .sort((left, right) =>
      Number(right.isStarterSpaceSchool) - Number(left.isStarterSpaceSchool) ||
      left.schoolID - right.schoolID,
    )[0];
  if (legacyCorporationSchool) {
    return legacyCorporationSchool.schoolID;
  }

  const raceSchool = schools
    .filter((school) => !numericRaceID || school.raceID === numericRaceID)
    .sort((left, right) =>
      Number(right.isStarterSpaceSchool) - Number(left.isStarterSpaceSchool) ||
      left.schoolID - right.schoolID,
    )[0];
  if (raceSchool) {
    return raceSchool.schoolID;
  }

  return toNumber(fallback, 11) || 11;
}

function resolveCharacterCreationBloodlineProfile(bloodlineID, fallback = {}) {
  const numericBloodlineID = toNumber(bloodlineID, 0);
  const bloodline = getCharacterCreationBloodline(numericBloodlineID);
  return {
    bloodlineID: numericBloodlineID || toNumber(fallback.bloodlineID, 1) || 1,
    name: (bloodline && bloodline.name) || "",
    raceID:
      (bloodline && bloodline.raceID) ||
      toNumber(fallback.raceID, 1) ||
      1,
    corporationID:
      (bloodline && bloodline.corporationID) ||
      toNumber(fallback.corporationID, 1000009) ||
      1000009,
    typeID:
      BLOODLINE_CHARACTER_TYPE_ID[numericBloodlineID] ||
      toNumber(fallback.typeID, DEFAULT_CHARACTER_TYPE_ID) ||
      DEFAULT_CHARACTER_TYPE_ID,
  };
}

module.exports = {
  getCharacterCreationBloodline,
  getCharacterCreationBloodlines,
  getCharacterCreationRace,
  getCharacterCreationRaces,
  getCharacterCreationSchool,
  getCharacterCreationQAStarterSystemIDs,
  getCharacterCreationSchools,
  getCharacterCreationSchoolStartingSolarSystemID,
  resolveCharacterCreationBloodlineProfile,
  resolveCharacterCreationSchoolIDForRace,
  resolveCharacterCreationSchoolProfile,
};
