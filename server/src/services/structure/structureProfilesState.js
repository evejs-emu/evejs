const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const structureState = require(path.join(__dirname, "./structureState"));

const TABLE_NAME = "structureProfiles";
const ROOT_VERSION = 1;
const DEFAULT_PROFILE_NAME = "Default Profile";
const DEFAULT_PROFILE_DESCRIPTION = "";

let cachedRoot = null;

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function normalizeText(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value);
}

function normalizeProfileName(value, fallback = DEFAULT_PROFILE_NAME) {
  const text = normalizeText(value, fallback).trim();
  return text.length > 0 ? text.slice(0, 30) : fallback;
}

function normalizeProfileDescription(value, fallback = DEFAULT_PROFILE_DESCRIPTION) {
  return normalizeText(value, fallback).trim().slice(0, 200);
}

function normalizeSettingValue(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed !== "") {
      const numeric = Number(trimmed);
      return Number.isFinite(numeric) ? numeric : trimmed;
    }
    return "";
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function compareProfileSettings(left, right) {
  const leftGroupID = toInt(left && left.groupID, 0);
  const rightGroupID = toInt(right && right.groupID, 0);
  if (leftGroupID !== rightGroupID) {
    return leftGroupID - rightGroupID;
  }
  return String(left && left.value).localeCompare(String(right && right.value));
}

function normalizeProfileSettingsBySettingID(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const normalized = {};
  for (const [rawSettingID, rawEntries] of Object.entries(value)) {
    const settingID = toPositiveInt(rawSettingID, 0);
    if (!settingID) {
      continue;
    }

    const groupsByGroupID = new Map();
    for (const rawEntry of Array.isArray(rawEntries) ? rawEntries : []) {
      if (!rawEntry || typeof rawEntry !== "object") {
        continue;
      }
      const groupID = toInt(rawEntry.groupID, 0);
      groupsByGroupID.set(groupID, {
        groupID,
        value: normalizeSettingValue(rawEntry.value),
      });
    }

    normalized[String(settingID)] = [...groupsByGroupID.values()].sort(compareProfileSettings);
  }
  return normalized;
}

function buildDefaultRoot() {
  return {
    meta: {
      version: ROOT_VERSION,
      description: "DB-backed corporation structure deployment/access profile state.",
      updatedAt: null,
    },
    nextProfileID: 1,
    profilesByID: {},
  };
}

function normalizeProfileRecord(profile = {}) {
  const profileID = toPositiveInt(profile.profileID, 0);
  const corporationID = toPositiveInt(profile.corporationID, 0);
  if (!profileID || !corporationID) {
    return null;
  }

  return {
    profileID,
    corporationID,
    name: normalizeProfileName(profile.name),
    description: normalizeProfileDescription(profile.description),
    isDefault: profile.isDefault === true,
    settingsBySettingID: normalizeProfileSettingsBySettingID(profile.settingsBySettingID),
    createdAt: normalizeText(profile.createdAt, null),
    updatedAt: normalizeText(profile.updatedAt, null),
  };
}

function normalizeRoot(rawValue) {
  const next = buildDefaultRoot();
  const source = rawValue && typeof rawValue === "object" ? rawValue : {};

  if (source.meta && typeof source.meta === "object") {
    next.meta = {
      ...next.meta,
      ...cloneValue(source.meta),
      version: ROOT_VERSION,
    };
  }

  const profilesByID = {};
  let highestProfileID = 0;
  if (source.profilesByID && typeof source.profilesByID === "object") {
    for (const rawProfile of Object.values(source.profilesByID)) {
      const profile = normalizeProfileRecord(rawProfile);
      if (!profile) {
        continue;
      }
      profilesByID[String(profile.profileID)] = profile;
      highestProfileID = Math.max(highestProfileID, profile.profileID);
    }
  }

  next.profilesByID = profilesByID;
  next.nextProfileID = Math.max(
    toPositiveInt(source.nextProfileID, 1),
    highestProfileID + 1,
    1,
  );
  return next;
}

function readRoot() {
  const result = database.read(TABLE_NAME, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return buildDefaultRoot();
  }
  return normalizeRoot(result.data);
}

function writeRoot(root) {
  const next = normalizeRoot(root);
  next.meta.updatedAt = new Date().toISOString();
  const result = database.write(TABLE_NAME, "/", next);
  if (!result.success) {
    return false;
  }
  cachedRoot = next;
  return true;
}

function ensureRoot() {
  if (!cachedRoot) {
    cachedRoot = readRoot();
  }
  return cachedRoot;
}

function getCorporationIDForSession(session) {
  return toPositiveInt(
    session &&
      (
        session.corporationID ||
        session.corpid
      ),
    0,
  );
}

function listProfileRecordsForCorporation(root, corporationID) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  return Object.values(root.profilesByID)
    .filter((profile) => profile && profile.corporationID === numericCorporationID);
}

function compareProfiles(left, right) {
  if ((left && left.isDefault) !== (right && right.isDefault)) {
    return left && left.isDefault ? -1 : 1;
  }
  const nameComparison = String(left && left.name || "").localeCompare(
    String(right && right.name || ""),
    undefined,
    { sensitivity: "base" },
  );
  if (nameComparison !== 0) {
    return nameComparison;
  }
  return toPositiveInt(left && left.profileID, 0) - toPositiveInt(right && right.profileID, 0);
}

function clearDefaultFlagForCorporation(root, corporationID) {
  for (const profile of Object.values(root.profilesByID)) {
    if (!profile || profile.corporationID !== corporationID) {
      continue;
    }
    profile.isDefault = false;
  }
}

function allocateProfileID(root) {
  const profileID = Math.max(toPositiveInt(root.nextProfileID, 1), 1);
  root.nextProfileID = profileID + 1;
  return profileID;
}

function buildUniqueProfileName(root, corporationID, requestedName, ignoreProfileID = 0) {
  const baseName = normalizeProfileName(requestedName);
  const takenNames = new Set(
    listProfileRecordsForCorporation(root, corporationID)
      .filter((profile) => profile.profileID !== ignoreProfileID)
      .map((profile) => String(profile.name || "").trim().toLowerCase()),
  );

  if (!takenNames.has(baseName.toLowerCase())) {
    return baseName;
  }

  let suffix = 2;
  while (suffix < 1000) {
    const candidate = normalizeProfileName(`${baseName} ${suffix}`, baseName);
    if (!takenNames.has(candidate.toLowerCase())) {
      return candidate;
    }
    suffix += 1;
  }

  return baseName;
}

function createProfileRecord(root, corporationID, options = {}) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  if (!numericCorporationID) {
    return null;
  }

  const profileID = allocateProfileID(root);
  const isDefault = options.isDefault === true;
  if (isDefault) {
    clearDefaultFlagForCorporation(root, numericCorporationID);
  }

  const now = new Date().toISOString();
  const profile = {
    profileID,
    corporationID: numericCorporationID,
    name: buildUniqueProfileName(
      root,
      numericCorporationID,
      options.name || DEFAULT_PROFILE_NAME,
    ),
    description: normalizeProfileDescription(options.description),
    isDefault,
    settingsBySettingID: normalizeProfileSettingsBySettingID(options.settingsBySettingID),
    createdAt: now,
    updatedAt: now,
  };
  root.profilesByID[String(profileID)] = profile;
  return profile;
}

function ensureCorporationDefaultProfile(corporationID) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  if (!numericCorporationID) {
    return null;
  }

  const root = ensureRoot();
  const profiles = listProfileRecordsForCorporation(root, numericCorporationID);
  if (profiles.length === 0) {
    const createdProfile = createProfileRecord(root, numericCorporationID, {
      name: DEFAULT_PROFILE_NAME,
      description: DEFAULT_PROFILE_DESCRIPTION,
      isDefault: true,
    });
    writeRoot(root);
    return cloneValue(createdProfile);
  }

  const defaultProfiles = profiles.filter((profile) => profile.isDefault === true);
  if (defaultProfiles.length === 1) {
    return cloneValue(defaultProfiles[0]);
  }

  const nextDefault = [...profiles].sort(compareProfiles)[0];
  clearDefaultFlagForCorporation(root, numericCorporationID);
  nextDefault.isDefault = true;
  nextDefault.updatedAt = new Date().toISOString();
  writeRoot(root);
  return cloneValue(nextDefault);
}

function listProfilesForCorporation(corporationID) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  if (!numericCorporationID) {
    return [];
  }

  ensureCorporationDefaultProfile(numericCorporationID);
  return listProfileRecordsForCorporation(ensureRoot(), numericCorporationID)
    .sort(compareProfiles)
    .map((profile) => cloneValue(profile));
}

function getProfileForCorporation(corporationID, profileID) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  const numericProfileID = toPositiveInt(profileID, 0);
  if (!numericCorporationID || !numericProfileID) {
    return null;
  }

  ensureCorporationDefaultProfile(numericCorporationID);
  const profile = ensureRoot().profilesByID[String(numericProfileID)];
  if (!profile || profile.corporationID !== numericCorporationID) {
    return null;
  }
  return cloneValue(profile);
}

function resolveUsableProfileIDForCorporation(corporationID, requestedProfileID = null) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  if (!numericCorporationID) {
    return 1;
  }

  const numericRequestedProfileID = toPositiveInt(requestedProfileID, 0);
  if (numericRequestedProfileID > 0) {
    const requestedProfile = getProfileForCorporation(
      numericCorporationID,
      numericRequestedProfileID,
    );
    if (requestedProfile) {
      return requestedProfile.profileID;
    }
  }

  const defaultProfile = ensureCorporationDefaultProfile(numericCorporationID);
  return toPositiveInt(defaultProfile && defaultProfile.profileID, 1) || 1;
}

function createProfileForCorporation(corporationID, name, description) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  if (!numericCorporationID) {
    return null;
  }

  ensureCorporationDefaultProfile(numericCorporationID);
  const root = ensureRoot();
  const createdProfile = createProfileRecord(root, numericCorporationID, {
    name,
    description,
    isDefault: false,
  });
  if (!createdProfile) {
    return null;
  }
  writeRoot(root);
  return cloneValue(createdProfile);
}

function updateProfileForCorporation(corporationID, profileID, updates = {}) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  const numericProfileID = toPositiveInt(profileID, 0);
  if (!numericCorporationID || !numericProfileID) {
    return null;
  }

  const root = ensureRoot();
  const profile = root.profilesByID[String(numericProfileID)];
  if (!profile || profile.corporationID !== numericCorporationID) {
    return null;
  }

  profile.name = buildUniqueProfileName(
    root,
    numericCorporationID,
    updates.name || profile.name,
    profile.profileID,
  );
  profile.description = normalizeProfileDescription(
    updates.description,
    profile.description,
  );
  profile.updatedAt = new Date().toISOString();
  writeRoot(root);
  return cloneValue(profile);
}

function duplicateProfileForCorporation(corporationID, profileID) {
  const sourceProfile = getProfileForCorporation(corporationID, profileID);
  if (!sourceProfile) {
    return null;
  }

  const root = ensureRoot();
  const duplicatedProfile = createProfileRecord(root, corporationID, {
    name: `${sourceProfile.name} Copy`,
    description: sourceProfile.description,
    settingsBySettingID: cloneValue(sourceProfile.settingsBySettingID),
    isDefault: false,
  });
  if (!duplicatedProfile) {
    return null;
  }
  writeRoot(root);
  return cloneValue(duplicatedProfile);
}

function setDefaultProfileForCorporation(corporationID, profileID) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  const numericProfileID = toPositiveInt(profileID, 0);
  if (!numericCorporationID || !numericProfileID) {
    return null;
  }

  const root = ensureRoot();
  const targetProfile = root.profilesByID[String(numericProfileID)];
  if (!targetProfile || targetProfile.corporationID !== numericCorporationID) {
    return null;
  }

  clearDefaultFlagForCorporation(root, numericCorporationID);
  targetProfile.isDefault = true;
  targetProfile.updatedAt = new Date().toISOString();
  writeRoot(root);
  return cloneValue(targetProfile);
}

function deleteProfileForCorporation(corporationID, profileID) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  const numericProfileID = toPositiveInt(profileID, 0);
  if (!numericCorporationID || !numericProfileID) {
    return false;
  }

  const root = ensureRoot();
  const targetProfile = root.profilesByID[String(numericProfileID)];
  if (!targetProfile || targetProfile.corporationID !== numericCorporationID) {
    return false;
  }

  delete root.profilesByID[String(numericProfileID)];
  const remainingProfiles = listProfileRecordsForCorporation(root, numericCorporationID)
    .sort(compareProfiles);
  if (remainingProfiles.length === 0) {
    createProfileRecord(root, numericCorporationID, {
      name: DEFAULT_PROFILE_NAME,
      description: DEFAULT_PROFILE_DESCRIPTION,
      isDefault: true,
    });
  } else if (targetProfile.isDefault) {
    clearDefaultFlagForCorporation(root, numericCorporationID);
    remainingProfiles[0].isDefault = true;
    remainingProfiles[0].updatedAt = new Date().toISOString();
  }
  return writeRoot(root);
}

function normalizeSavedProfileSettings(value) {
  const normalized = {};
  for (const rawEntry of Array.isArray(value) ? value : []) {
    const entry = Array.isArray(rawEntry)
      ? rawEntry
      : rawEntry && typeof rawEntry === "object"
        ? [
          rawEntry.settingID,
          rawEntry.value,
          rawEntry.groupID,
        ]
        : [];
    const settingID = toPositiveInt(entry[0], 0);
    if (!settingID) {
      continue;
    }

    const groupID = toInt(entry[2], 0);
    if (!normalized[String(settingID)]) {
      normalized[String(settingID)] = [];
    }
    normalized[String(settingID)].push({
      groupID,
      value: normalizeSettingValue(entry[1]),
    });
  }
  return normalizeProfileSettingsBySettingID(normalized);
}

function saveProfileSettingsForCorporation(corporationID, profileID, settings = []) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  const numericProfileID = toPositiveInt(profileID, 0);
  if (!numericCorporationID || !numericProfileID) {
    return null;
  }

  const root = ensureRoot();
  const profile = root.profilesByID[String(numericProfileID)];
  if (!profile || profile.corporationID !== numericCorporationID) {
    return null;
  }

  profile.settingsBySettingID = normalizeSavedProfileSettings(settings);
  profile.updatedAt = new Date().toISOString();
  writeRoot(root);
  return cloneValue(profile);
}

function assignProfileToStructuresForCorporation(corporationID, profileID, structureIDs = []) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  const resolvedProfileID = resolveUsableProfileIDForCorporation(
    numericCorporationID,
    profileID,
  );
  const normalizedStructureIDs = [...new Set(
    (Array.isArray(structureIDs) ? structureIDs : [])
      .map((structureID) => toPositiveInt(structureID, 0))
      .filter((structureID) => structureID > 0),
  )];

  const updatedStructureIDs = [];
  for (const structureID of normalizedStructureIDs) {
    const structure = structureState.getStructureByID(structureID, {
      refresh: false,
    });
    if (
      !structure ||
      toPositiveInt(structure.ownerCorpID || structure.ownerID, 0) !== numericCorporationID
    ) {
      continue;
    }
    const updateResult = structureState.updateStructureRecord(structureID, (current) => ({
      ...current,
      profileID: resolvedProfileID,
    }));
    if (updateResult && updateResult.success) {
      updatedStructureIDs.push(structureID);
    }
  }

  return {
    profileID: resolvedProfileID,
    structureIDs: updatedStructureIDs,
  };
}

function resetStructureProfilesStateForTests() {
  cachedRoot = null;
}

module.exports = {
  DEFAULT_PROFILE_NAME,
  DEFAULT_PROFILE_DESCRIPTION,
  getCorporationIDForSession,
  listProfilesForCorporation,
  getProfileForCorporation,
  ensureCorporationDefaultProfile,
  resolveUsableProfileIDForCorporation,
  createProfileForCorporation,
  updateProfileForCorporation,
  duplicateProfileForCorporation,
  setDefaultProfileForCorporation,
  deleteProfileForCorporation,
  saveProfileSettingsForCorporation,
  assignProfileToStructuresForCorporation,
  resetStructureProfilesStateForTests,
};
