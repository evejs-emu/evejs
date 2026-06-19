const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildDict,
  buildKeyVal,
  buildList,
  extractList,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  assignProfileToStructuresForCorporation,
  createProfileForCorporation,
  deleteProfileForCorporation,
  duplicateProfileForCorporation,
  ensureCorporationDefaultProfile,
  getCorporationIDForSession,
  getProfileForCorporation,
  listProfilesForCorporation,
  saveProfileSettingsForCorporation,
  setDefaultProfileForCorporation,
  updateProfileForCorporation,
} = require(path.join(__dirname, "./structureProfilesState"));

function normalizeArgs(args) {
  return Array.isArray(args)
    ? args.map((entry) => unwrapMarshalValue(entry))
    : [];
}

function buildProfilePayload(profile) {
  return buildKeyVal([
    ["profileID", Number(profile && profile.profileID || 0)],
    ["name", String(profile && profile.name || "")],
    ["description", String(profile && profile.description || "")],
    ["isDefault", profile && profile.isDefault === true],
  ]);
}

function buildProfileSettingsPayload(profile) {
  const settingsBySettingID =
    profile && profile.settingsBySettingID && typeof profile.settingsBySettingID === "object"
      ? profile.settingsBySettingID
      : {};
  return buildDict(
    Object.entries(settingsBySettingID)
      .map(([rawSettingID, groups]) => {
        const settingID = Number(rawSettingID) || 0;
        if (settingID <= 0) {
          return null;
        }
        return [
          settingID,
          buildList(
            (Array.isArray(groups) ? groups : []).map((group) => buildKeyVal([
              ["groupID", Number(group && group.groupID || 0)],
              ["value", group && Object.prototype.hasOwnProperty.call(group, "value")
                ? group.value
                : 0],
            ])),
          ),
        ];
      })
      .filter(Boolean)
      .sort((left, right) => left[0] - right[0]),
  );
}

class StructureProfilesService extends BaseService {
  constructor() {
    super("structureProfiles");
  }

  Handle_GetProfiles(args, session) {
    const corporationID = getCorporationIDForSession(session);
    if (corporationID <= 0) {
      return buildList([]);
    }

    ensureCorporationDefaultProfile(corporationID);
    return buildList(
      listProfilesForCorporation(corporationID).map((profile) => buildProfilePayload(profile)),
    );
  }

  Handle_CreateProfile(args, session) {
    const corporationID = getCorporationIDForSession(session);
    const normalizedArgs = normalizeArgs(args);
    const createdProfile = createProfileForCorporation(
      corporationID,
      normalizedArgs[0],
      normalizedArgs[1],
    );
    return Number(createdProfile && createdProfile.profileID || 0) || null;
  }

  Handle_UpdateProfile(args, session) {
    const corporationID = getCorporationIDForSession(session);
    const normalizedArgs = normalizeArgs(args);
    updateProfileForCorporation(corporationID, normalizedArgs[0], {
      name: normalizedArgs[1],
      description: normalizedArgs[2],
    });
    return null;
  }

  Handle_GetProfileSettings(args, session) {
    const corporationID = getCorporationIDForSession(session);
    const normalizedArgs = normalizeArgs(args);
    const profile = getProfileForCorporation(corporationID, normalizedArgs[0]);
    return buildProfileSettingsPayload(profile);
  }

  Handle_SaveProfileSettings(args, session) {
    const corporationID = getCorporationIDForSession(session);
    const normalizedArgs = normalizeArgs(args);
    saveProfileSettingsForCorporation(
      corporationID,
      normalizedArgs[0],
      extractList(normalizedArgs[1]),
    );
    return null;
  }

  Handle_SetDefaultProfile(args, session) {
    const corporationID = getCorporationIDForSession(session);
    const normalizedArgs = normalizeArgs(args);
    setDefaultProfileForCorporation(corporationID, normalizedArgs[0]);
    return null;
  }

  Handle_ChangeProfiles(args, session) {
    const corporationID = getCorporationIDForSession(session);
    const normalizedArgs = normalizeArgs(args);
    assignProfileToStructuresForCorporation(
      corporationID,
      normalizedArgs[1],
      extractList(normalizedArgs[0]),
    );
    return null;
  }

  Handle_DeleteProfile(args, session) {
    const corporationID = getCorporationIDForSession(session);
    const normalizedArgs = normalizeArgs(args);
    deleteProfileForCorporation(corporationID, normalizedArgs[0]);
    return null;
  }

  Handle_DuplicateProfile(args, session) {
    const corporationID = getCorporationIDForSession(session);
    const normalizedArgs = normalizeArgs(args);
    const duplicatedProfile = duplicateProfileForCorporation(
      corporationID,
      normalizedArgs[0],
    );
    return Number(duplicatedProfile && duplicatedProfile.profileID || 0) || null;
  }
}

module.exports = StructureProfilesService;
