const fs = require("fs");
const path = require("path");

const {
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  buildRowset,
  currentFileTime,
} = require(path.join(__dirname, "../../_shared/serviceHelpers"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../../_shared/referenceData"));
const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(__dirname, "../../character/characterState"));
const {
  getCharacterSkills,
} = require(path.join(__dirname, "../skillState"));

const CERTIFICATE_JSONL_PATH = path.join(
  __dirname,
  "../../../../../data/eve-online-static-data-3284752-jsonl/certificates.jsonl",
);

let certificateAuthorityCache = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeFileTimeString(value) {
  const normalized = String(value || "").trim();
  return /^\d+$/.test(normalized) ? normalized : currentFileTime().toString();
}

function normalizeCertificateState(rawState) {
  const source = rawState && typeof rawState === "object" ? rawState : {};
  const normalized = {};
  for (const [certificateID, entry] of Object.entries(source)) {
    const numericCertificateID = toInt(certificateID, 0);
    if (numericCertificateID <= 0 || !entry || typeof entry !== "object") {
      continue;
    }
    normalized[String(numericCertificateID)] = {
      grantDate: normalizeFileTimeString(entry.grantDate),
      visibilityFlags: Math.max(0, toInt(entry.visibilityFlags, 0)),
      forcedGranted: Boolean(entry.forcedGranted),
    };
  }
  return normalized;
}

function buildGroupNameByID() {
  const groupNameByID = new Map();
  for (const skillType of readStaticRows(TABLE.SKILL_TYPES)) {
    const groupID = toInt(skillType && skillType.groupID, 0);
    if (groupID <= 0 || groupNameByID.has(groupID)) {
      continue;
    }
    const groupName = String(skillType && skillType.groupName ? skillType.groupName : "").trim();
    if (groupName) {
      groupNameByID.set(groupID, groupName);
    }
  }
  return groupNameByID;
}

function parseCertificateJsonlLine(line) {
  if (!line || !line.trim()) {
    return null;
  }

  const parsed = JSON.parse(line);
  const certificateID = toInt(parsed && parsed._key, 0);
  if (certificateID <= 0) {
    return null;
  }

  const requirementsBySkillTypeID = {};
  for (const requirement of Array.isArray(parsed.skillTypes) ? parsed.skillTypes : []) {
    const skillTypeID = toInt(requirement && requirement._key, 0);
    if (skillTypeID <= 0) {
      continue;
    }
    requirementsBySkillTypeID[String(skillTypeID)] = {
      1: Math.max(0, toInt(requirement.basic, 0)),
      2: Math.max(0, toInt(requirement.standard, 0)),
      3: Math.max(0, toInt(requirement.improved, 0)),
      4: Math.max(0, toInt(requirement.advanced, 0)),
      5: Math.max(0, toInt(requirement.elite, 0)),
    };
  }

  return {
    certificateID,
    groupID: Math.max(0, toInt(parsed.groupID, 0)),
    name: String(parsed && parsed.name && parsed.name.en ? parsed.name.en : ""),
    description: String(
      parsed && parsed.description && parsed.description.en ? parsed.description.en : "",
    ),
    recommendedFor: [...new Set(
      (Array.isArray(parsed.recommendedFor) ? parsed.recommendedFor : [])
        .map((typeID) => toInt(typeID, 0))
        .filter((typeID) => typeID > 0),
    )].sort((left, right) => left - right),
    requirementsBySkillTypeID,
  };
}

function loadCertificateAuthority() {
  if (certificateAuthorityCache) {
    return certificateAuthorityCache;
  }

  const groupNameByID = buildGroupNameByID();
  const certificates = [];
  const certificatesByID = new Map();
  const certificateIDsByGroupID = new Map();
  const certificateIDsByShipTypeID = new Map();

  const rawJsonl = fs.readFileSync(CERTIFICATE_JSONL_PATH, "utf8");
  for (const line of rawJsonl.split(/\r?\n/)) {
    const certificate = parseCertificateJsonlLine(line);
    if (!certificate) {
      continue;
    }

    const certificateGroupName = groupNameByID.get(certificate.groupID) || `Group ${certificate.groupID}`;
    const normalizedCertificate = {
      ...certificate,
      groupName: certificateGroupName,
    };
    certificates.push(normalizedCertificate);
    certificatesByID.set(normalizedCertificate.certificateID, normalizedCertificate);

    if (!certificateIDsByGroupID.has(normalizedCertificate.groupID)) {
      certificateIDsByGroupID.set(normalizedCertificate.groupID, []);
    }
    certificateIDsByGroupID.get(normalizedCertificate.groupID).push(
      normalizedCertificate.certificateID,
    );

    for (const shipTypeID of normalizedCertificate.recommendedFor) {
      if (!certificateIDsByShipTypeID.has(shipTypeID)) {
        certificateIDsByShipTypeID.set(shipTypeID, []);
      }
      certificateIDsByShipTypeID.get(shipTypeID).push(normalizedCertificate.certificateID);
    }
  }

  certificates.sort((left, right) =>
    left.name.localeCompare(right.name) || left.certificateID - right.certificateID,
  );
  for (const certificateIDs of certificateIDsByGroupID.values()) {
    certificateIDs.sort((left, right) => left - right);
  }
  for (const certificateIDs of certificateIDsByShipTypeID.values()) {
    certificateIDs.sort((left, right) => left - right);
  }

  certificateAuthorityCache = {
    certificates,
    certificatesByID,
    certificateIDsByGroupID,
    certificateIDsByShipTypeID,
    groupNameByID,
  };
  return certificateAuthorityCache;
}

function getCertificateDefinition(certificateID) {
  const numericCertificateID = toInt(certificateID, 0);
  if (numericCertificateID <= 0) {
    return null;
  }
  return cloneValue(loadCertificateAuthority().certificatesByID.get(numericCertificateID) || null);
}

function listCertificateDefinitions() {
  return loadCertificateAuthority().certificates.map((certificate) => cloneValue(certificate));
}

function listCertificateGroupSummaries() {
  const authority = loadCertificateAuthority();
  return [...authority.certificateIDsByGroupID.keys()]
    .sort((left, right) => left - right)
    .map((groupID) => ({
      groupID,
      groupName: authority.groupNameByID.get(groupID) || `Group ${groupID}`,
      certificateIDs: cloneValue(authority.certificateIDsByGroupID.get(groupID) || []),
    }));
}

function listCertificatesForGroup(groupID) {
  const numericGroupID = toInt(groupID, 0);
  if (numericGroupID <= 0) {
    return [];
  }
  const authority = loadCertificateAuthority();
  return (authority.certificateIDsByGroupID.get(numericGroupID) || [])
    .map((certificateID) => getCertificateDefinition(certificateID))
    .filter(Boolean);
}

function listCertificateRecommendationsForShipType(shipTypeID) {
  const numericShipTypeID = toInt(shipTypeID, 0);
  if (numericShipTypeID <= 0) {
    return [];
  }
  const authority = loadCertificateAuthority();
  return cloneValue(authority.certificateIDsByShipTypeID.get(numericShipTypeID) || []);
}

function listAllShipCertificateRecommendations() {
  const authority = loadCertificateAuthority();
  return [...authority.certificateIDsByShipTypeID.entries()]
    .sort(([leftTypeID], [rightTypeID]) => leftTypeID - rightTypeID)
    .map(([shipTypeID, certificateIDs]) => ({
      shipTypeID,
      certificateIDs: cloneValue(certificateIDs),
    }));
}

function getCharacterSkillMap(characterID) {
  const skillMap = new Map();
  for (const skillRecord of getCharacterSkills(characterID)) {
    const typeID = toInt(skillRecord && skillRecord.typeID, 0);
    if (typeID <= 0) {
      continue;
    }
    skillMap.set(typeID, skillRecord);
  }
  return skillMap;
}

function getCertificateLevelForSkillMap(skillMap, certificate) {
  if (!certificate || !skillMap || typeof skillMap.get !== "function") {
    return 0;
  }

  for (let certificateLevel = 5; certificateLevel >= 1; certificateLevel -= 1) {
    let metAllRequirements = true;
    for (const [skillTypeID, levelsByGrade] of Object.entries(
      certificate.requirementsBySkillTypeID || {},
    )) {
      const requiredLevel = Math.max(0, toInt(levelsByGrade && levelsByGrade[certificateLevel], 0));
      if (requiredLevel <= 0) {
        continue;
      }
      const skillRecord = skillMap.get(toInt(skillTypeID, 0));
      const effectiveSkillLevel = Math.max(
        0,
        toInt(
          skillRecord &&
            (skillRecord.effectiveSkillLevel ??
              skillRecord.virtualSkillLevel ??
              skillRecord.trainedSkillLevel ??
              skillRecord.skillLevel),
          0,
        ),
      );
      if (effectiveSkillLevel < requiredLevel) {
        metAllRequirements = false;
        break;
      }
    }
    if (metAllRequirements) {
      return certificateLevel;
    }
  }

  return 0;
}

function getCharacterCertificateLevel(characterID, certificateID) {
  const certificate = getCertificateDefinition(certificateID);
  if (!certificate) {
    return 0;
  }
  return getCertificateLevelForSkillMap(getCharacterSkillMap(characterID), certificate);
}

function getCharacterCertificateState(characterID) {
  const characterRecord = getCharacterRecord(characterID) || {};
  return normalizeCertificateState(characterRecord.certificateState);
}

function updateCharacterCertificateState(characterID, mutate) {
  return updateCharacterRecord(characterID, (record) => {
    const currentState = normalizeCertificateState(record.certificateState);
    const nextState = normalizeCertificateState(mutate(cloneValue(currentState)) || currentState);
    return {
      ...record,
      certificateState: nextState,
    };
  });
}

function buildMaterializedCertificateStateForSkillMap(skillMap, currentState = {}) {
  const authority = loadCertificateAuthority();
  const nextState = {};
  const currentFileTimeString = currentFileTime().toString();

  for (const certificate of authority.certificates) {
    const currentLevel = getCertificateLevelForSkillMap(skillMap, certificate);
    const previousState = currentState[String(certificate.certificateID)] || null;
    if (currentLevel <= 0 && !(previousState && previousState.forcedGranted)) {
      continue;
    }
    nextState[String(certificate.certificateID)] = {
      grantDate: previousState ? previousState.grantDate : currentFileTimeString,
      visibilityFlags: previousState ? previousState.visibilityFlags : 0,
      forcedGranted: Boolean(previousState && previousState.forcedGranted),
    };
  }

  return nextState;
}

function materializeCurrentCertificates(characterID) {
  const skillMap = getCharacterSkillMap(characterID);
  const authority = loadCertificateAuthority();
  const currentState = getCharacterCertificateState(characterID);
  const nextState = buildMaterializedCertificateStateForSkillMap(skillMap, currentState);
  const currentStateJson = JSON.stringify(currentState);
  const nextStateJson = JSON.stringify(nextState);
  if (currentStateJson !== nextStateJson) {
    updateCharacterCertificateState(characterID, () => nextState);
  }

  const materializedState = normalizeCertificateState(nextState);
  const rows = [];
  for (const certificate of authority.certificates) {
    const stateEntry = materializedState[String(certificate.certificateID)];
    if (!stateEntry) {
      continue;
    }
    rows.push({
      certificateID: certificate.certificateID,
      grantDate: stateEntry.grantDate,
      visibilityFlags: stateEntry.visibilityFlags,
      groupID: certificate.groupID,
      groupName: certificate.groupName,
      name: certificate.name,
      description: certificate.description,
      currentLevel: getCertificateLevelForSkillMap(skillMap, certificate),
    });
  }
  return rows;
}

function buildMyCertificatesRowsetForCharacter(characterID) {
  return buildRowset(
    ["certificateID", "grantDate", "visibilityFlags"],
    materializeCurrentCertificates(characterID).map((row) => [
      row.certificateID,
      buildFiletimeLong(row.grantDate),
      row.visibilityFlags,
    ]),
  );
}

function buildCharacterCertificatesRowsetForCharacter(characterID) {
  return buildRowset(
    ["grantDate", "certificateID", "visibilityFlags"],
    materializeCurrentCertificates(characterID).map((row) => [
      buildFiletimeLong(row.grantDate),
      row.certificateID,
      row.visibilityFlags,
    ]),
  );
}

function buildCertificateCategoriesPayload() {
  return buildList(
    listCertificateGroupSummaries().map((group) =>
      buildKeyVal([
        ["groupID", group.groupID],
        ["groupName", group.groupName],
        ["certificateCount", group.certificateIDs.length],
      ]),
    ),
  );
}

function buildCertificateClassesPayload() {
  return buildList(
    listCertificateDefinitions().map((certificate) =>
      buildKeyVal([
        ["certificateID", certificate.certificateID],
        ["groupID", certificate.groupID],
        ["groupName", certificate.groupName],
        ["name", certificate.name],
        ["recommendedFor", buildList(certificate.recommendedFor)],
      ]),
    ),
  );
}

function buildAllShipCertificateRecommendationsPayload() {
  return {
    type: "dict",
    entries: listAllShipCertificateRecommendations().map((entry) => [
      entry.shipTypeID,
      buildList(entry.certificateIDs),
    ]),
  };
}

function grantCertificates(characterID, certificateIDs = []) {
  const normalizedCertificateIDs = [...new Set(
    (Array.isArray(certificateIDs) ? certificateIDs : [certificateIDs])
      .map((certificateID) => toInt(certificateID, 0))
      .filter((certificateID) => getCertificateDefinition(certificateID)),
  )];
  if (normalizedCertificateIDs.length === 0) {
    return [];
  }

  const grantDate = currentFileTime().toString();
  updateCharacterCertificateState(characterID, (state) => {
    const nextState = { ...state };
    for (const certificateID of normalizedCertificateIDs) {
      const previous = nextState[String(certificateID)] || null;
      nextState[String(certificateID)] = {
        grantDate: previous ? previous.grantDate : grantDate,
        visibilityFlags: previous ? previous.visibilityFlags : 0,
        forcedGranted: true,
      };
    }
    return nextState;
  });
  return normalizedCertificateIDs;
}

function updateCertificateVisibilityFlags(characterID, certificateID, visibilityFlags) {
  const numericCertificateID = toInt(certificateID, 0);
  if (!getCertificateDefinition(numericCertificateID)) {
    return false;
  }

  updateCharacterCertificateState(characterID, (state) => {
    const previous = state[String(numericCertificateID)] || {
      grantDate: currentFileTime().toString(),
      visibilityFlags: 0,
      forcedGranted: false,
    };
    return {
      ...state,
      [String(numericCertificateID)]: {
        ...previous,
        visibilityFlags: Math.max(0, toInt(visibilityFlags, 0)),
      },
    };
  });
  return true;
}

module.exports = {
  buildAllShipCertificateRecommendationsPayload,
  buildCertificateCategoriesPayload,
  buildCertificateClassesPayload,
  buildCharacterCertificatesRowsetForCharacter,
  buildMyCertificatesRowsetForCharacter,
  getCharacterCertificateLevel,
  getCertificateDefinition,
  grantCertificates,
  listAllShipCertificateRecommendations,
  listCertificateDefinitions,
  listCertificateRecommendationsForShipType,
  materializeCurrentCertificates,
  updateCertificateVisibilityFlags,
};
