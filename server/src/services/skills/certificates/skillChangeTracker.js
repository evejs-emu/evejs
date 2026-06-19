const path = require("path");

const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(__dirname, "../../character/characterState"));

const MAX_FETCH_BUDGET = 4;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizePendingChanges(rawChanges) {
  const source = rawChanges && typeof rawChanges === "object" ? rawChanges : {};
  const normalized = {};
  for (const [typeID, pointChange] of Object.entries(source)) {
    const numericTypeID = toInt(typeID, 0);
    const numericPointChange = Math.max(0, toInt(pointChange, 0));
    if (numericTypeID <= 0 || numericPointChange <= 0) {
      continue;
    }
    normalized[String(numericTypeID)] = numericPointChange;
  }
  return normalized;
}

function recordRecentSkillPointChanges(characterID, changes = []) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return [];
  }

  const normalizedChanges = (Array.isArray(changes) ? changes : [changes])
    .map((entry) => ({
      typeID: toInt(entry && entry.typeID, 0),
      pointChange: Math.max(0, toInt(entry && entry.pointChange, 0)),
    }))
    .filter((entry) => entry.typeID > 0 && entry.pointChange > 0);

  if (normalizedChanges.length === 0) {
    return [];
  }

  updateCharacterRecord(numericCharacterID, (record) => {
    const pendingChanges = normalizePendingChanges(record.isisSkillChanges);
    for (const entry of normalizedChanges) {
      pendingChanges[String(entry.typeID)] =
        Math.max(0, toInt(pendingChanges[String(entry.typeID)], 0)) + entry.pointChange;
    }

    return {
      ...record,
      isisSkillChanges: pendingChanges,
      isisSkillChangesFetchBudget: MAX_FETCH_BUDGET,
    };
  });

  return normalizedChanges;
}

function getPreviousSkillRecord(previousSkillMap, typeID) {
  if (!previousSkillMap) {
    return null;
  }
  if (typeof previousSkillMap.get === "function") {
    return previousSkillMap.get(typeID) || null;
  }
  if (typeof previousSkillMap === "object") {
    return previousSkillMap[String(typeID)] || previousSkillMap[typeID] || null;
  }
  return null;
}

function recordRecentSkillPointChangesFromDiff(
  characterID,
  changedSkillRecords = [],
  previousSkillMap = null,
) {
  if (!previousSkillMap) {
    return [];
  }

  const pendingChanges = [];
  for (const changedSkillRecord of Array.isArray(changedSkillRecords)
    ? changedSkillRecords
    : []) {
    const typeID = toInt(changedSkillRecord && changedSkillRecord.typeID, 0);
    if (typeID <= 0) {
      continue;
    }

    const previousSkillRecord = getPreviousSkillRecord(previousSkillMap, typeID);
    const currentPoints = Math.max(
      0,
      toInt(
        changedSkillRecord &&
          (changedSkillRecord.trainedSkillPoints ?? changedSkillRecord.skillPoints),
        0,
      ),
    );
    const previousPoints = Math.max(
      0,
      toInt(
        previousSkillRecord &&
          (previousSkillRecord.trainedSkillPoints ?? previousSkillRecord.skillPoints),
        0,
      ),
    );
    const pointChange = currentPoints - previousPoints;
    if (pointChange <= 0) {
      continue;
    }
    pendingChanges.push({
      typeID,
      pointChange,
    });
  }

  return recordRecentSkillPointChanges(characterID, pendingChanges);
}

function consumeRecentSkillPointChanges(characterID) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return [];
  }

  const characterRecord = getCharacterRecord(numericCharacterID) || {};
  const pendingChanges = normalizePendingChanges(characterRecord.isisSkillChanges);
  const entries = Object.entries(pendingChanges)
    .map(([typeID, pointChange]) => [toInt(typeID, 0), Math.max(0, toInt(pointChange, 0))])
    .filter(([typeID, pointChange]) => typeID > 0 && pointChange > 0)
    .sort((left, right) => left[0] - right[0]);

  if (entries.length === 0) {
    return [];
  }

  const fetchBudget = Math.max(0, toInt(characterRecord.isisSkillChangesFetchBudget, 0));
  updateCharacterRecord(numericCharacterID, (record) => ({
    ...record,
    isisSkillChanges: fetchBudget <= 1 ? {} : normalizePendingChanges(record.isisSkillChanges),
    isisSkillChangesFetchBudget: fetchBudget <= 1 ? 0 : fetchBudget - 1,
  }));

  return entries;
}

module.exports = {
  consumeRecentSkillPointChanges,
  recordRecentSkillPointChanges,
  recordRecentSkillPointChangesFromDiff,
};
