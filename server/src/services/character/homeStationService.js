const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const { throwWrappedObject } = require(path.join(__dirname, "../../common/machoErrors"));
const {
  getCharacterRecord,
  resolveHomeStationInfo,
  updateCharacterRecord,
} = require(path.join(__dirname, "./characterState"));
const {
  getStationRecord,
} = require(path.join(__dirname, "../_shared/stationStaticData"));
const { buildKeyVal } = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getCorporationRecord,
} = require(path.join(__dirname, "../corporation/corporationState"));
const {
  getCorporationOffices,
} = require(path.join(__dirname, "../corporation/corporationRuntimeState"));
const {
  resolveCharacterCreationSchoolProfile,
} = require(path.join(__dirname, "./characterCreationData"));

const CHANGE_HOME_STATION_ERROR = "homestation.validation.ChangeHomeStationValidationError";
const REMOTE_CHANGE_NOT_EXPECTED_ERROR = "homestation.error.RemoteChangeNotExpectedError";
const CHANGE_HOME_STATION_VALIDATION = Object.freeze({
  UNHANDLED_EXCEPTION: 0,
  STATION_IN_WORMHOLE: 1,
  ALREADY_SET_AS_HOME_STATION: 2,
  REMOTE_COOLDOWN: 3,
  FAC_WAR_ENEMY_STATION: 4,
  INVALID_CANDIDATE: 5,
  TRIGLAVIAN_SYSTEM: 6,
});

function resolveStation(session, args) {
  const charID =
    args && args.length > 0 ? Number(args[0] || 0) : Number(session && session.characterID);
  const charData = charID ? getCharacterRecord(charID) || {} : {};
  const homeStationInfo = resolveHomeStationInfo(charData, session);

  return {
    station: getStationRecord(session, homeStationInfo.homeStationID),
    homeStationInfo,
  };
}

function buildHomeStationPayload(station, homeStationInfo = {}) {
  return buildKeyVal([
    ["id", station.stationID],
    ["station_id", station.stationID],
    ["stationID", station.stationID],
    ["home_station_id", station.stationID],
    ["type_id", station.stationTypeID],
    ["typeID", station.stationTypeID],
    ["station_type_id", station.stationTypeID],
    ["name", station.stationName],
    ["station_name", station.stationName],
    ["stationName", station.stationName],
    ["solar_system_id", station.solarSystemID],
    ["solarSystemID", station.solarSystemID],
    ["constellation_id", station.constellationID],
    ["constellationID", station.constellationID],
    ["region_id", station.regionID],
    ["regionID", station.regionID],
    ["owner_id", station.ownerID],
    ["ownerID", station.ownerID],
    ["clone_station_id", homeStationInfo.cloneStationID || station.stationID],
    ["cloneStationID", homeStationInfo.cloneStationID || station.stationID],
    ["is_fallback", Boolean(homeStationInfo.isFallback)],
    ["isFallback", Boolean(homeStationInfo.isFallback)],
    ["stationTypeID", station.stationTypeID],
  ]);
}

function resolveCharacterID(session) {
  return Number(session && (session.characterID || session.charid) || 0) || 0;
}

function resolveDockedStationID(session, charData = {}) {
  return Number(
    (session && (session.stationID || session.stationid)) ||
      charData.stationID ||
      0,
  ) || 0;
}

function resolveSchoolHQStationID(charData = {}, session = null) {
  const schoolID = Number(
    charData.schoolID ||
      (session && (session.schoolID || session.schoolid)) ||
      0,
  ) || 0;
  const schoolProfile = resolveCharacterCreationSchoolProfile(schoolID, {
    raceID: charData.raceID || (session && (session.raceID || session.raceid)),
    corporationID: charData.corporationID,
  });
  const startingStationID = Number(
    schoolProfile.startingStations && schoolProfile.startingStations[0],
  ) || 0;
  if (startingStationID && getStationRecord(session, startingStationID)) {
    return startingStationID;
  }
  const schoolCorporationID = Number(schoolProfile.corporationID) || 0;
  if (!schoolCorporationID) {
    return 0;
  }
  const schoolCorporation = getCorporationRecord(schoolCorporationID);
  return Number(schoolCorporation && schoolCorporation.stationID || 0) || 0;
}

function buildStationCandidatePayload(station, options = {}) {
  return buildKeyVal([
    ["id", station.stationID],
    ["station_id", station.stationID],
    ["stationID", station.stationID],
    ["type_id", station.stationTypeID],
    ["typeID", station.stationTypeID],
    ["solar_system_id", station.solarSystemID],
    ["solarSystemID", station.solarSystemID],
    ["is_current_station", options.isCurrentStation === true],
    ["isCurrentStation", options.isCurrentStation === true],
    ["is_school_hq", options.isSchoolHQ === true],
    ["isSchoolHQ", options.isSchoolHQ === true],
    ["errors", Array.isArray(options.errors) ? options.errors : []],
  ]);
}

function collectHomeStationCandidates(session) {
  const charID = resolveCharacterID(session);
  const charData = charID ? getCharacterRecord(charID) || {} : {};
  const homeStationInfo = resolveHomeStationInfo(charData, session);
  const currentStationID = resolveDockedStationID(session, charData);
  const schoolHQStationID = resolveSchoolHQStationID(charData, session);
  const corporationID = Number(
    charData.corporationID ||
      (session && (session.corporationID || session.corpid)) ||
      0,
  ) || 0;
  const officeStationIDs = getCorporationOffices(corporationID)
    .map((office) => Number(office && office.stationID || 0) || 0)
    .filter((stationID) => stationID > 0);

  const orderedStationIDs = [
    currentStationID,
    schoolHQStationID,
    ...officeStationIDs,
  ].filter((stationID, index, array) => (
    stationID > 0 && array.indexOf(stationID) === index
  ));

  return orderedStationIDs
    .map((stationID) => getStationRecord(session, stationID))
    .filter(Boolean)
    .map((station) => {
      const errors = [];
      if (Number(station.stationID) === Number(homeStationInfo.homeStationID || 0)) {
        errors.push(CHANGE_HOME_STATION_VALIDATION.ALREADY_SET_AS_HOME_STATION);
      }
      return {
        station,
        isCurrentStation: Number(station.stationID) === currentStationID,
        isSchoolHQ: Number(station.stationID) === schoolHQStationID,
        errors,
      };
    });
}

function buildHomeStationCandidatePayloads(session) {
  return collectHomeStationCandidates(session).map((candidate) => (
    buildStationCandidatePayload(candidate.station, {
      isCurrentStation: candidate.isCurrentStation,
      isSchoolHQ: candidate.isSchoolHQ,
      errors: candidate.errors,
    })
  ));
}

function resolveAllowedHomeStationIDs(session) {
  return new Set(collectHomeStationCandidates(session).map((candidate) => (
    Number(candidate && candidate.station && candidate.station.stationID || 0) || 0
  )).filter((stationID) => stationID > 0));
}

function isRemoteHomeStationChange(stationID, session, charData = {}) {
  const currentStationID = resolveDockedStationID(session, charData);
  const schoolHQStationID = resolveSchoolHQStationID(charData, session);
  return Number(stationID || 0) > 0 &&
    Number(stationID || 0) !== Number(currentStationID || 0) &&
    Number(stationID || 0) !== Number(schoolHQStationID || 0);
}

function throwHomeStationValidation(errors = []) {
  throwWrappedObject(
    CHANGE_HOME_STATION_ERROR,
    [Array.isArray(errors) ? errors : []],
    {
      errors: Array.isArray(errors) ? errors : [],
    },
  );
}

function setSessionHomeStation(session, stationID) {
  if (!session || typeof session !== "object") {
    return;
  }
  const oldHomeStationID = Number(session.homeStationID || session.homestationid || 0) || null;
  const oldCloneStationID = Number(session.cloneStationID || session.clonestationid || 0) || null;
  const numericStationID = Number(stationID || 0) || 0;
  session.homeStationID = numericStationID;
  session.homestationid = numericStationID;
  session.cloneStationID = numericStationID;
  session.clonestationid = numericStationID;
  if (typeof session.sendSessionChange === "function") {
    const changes = {};
    if (oldHomeStationID !== numericStationID) {
      changes.homestationid = [oldHomeStationID, numericStationID];
    }
    if (oldCloneStationID !== numericStationID) {
      changes.clonestationid = [oldCloneStationID, numericStationID];
    }
    if (Object.keys(changes).length > 0) {
      session.sendSessionChange(changes);
    }
  }
  if (typeof session.sendNotification === "function") {
    session.sendNotification("OnHomeStationChanged", "clientID", [numericStationID]);
  }
}

function setHomeStation(session, stationID, allowRemote = false) {
  const charID = resolveCharacterID(session);
  const charData = charID ? getCharacterRecord(charID) || {} : {};
  if (!charID || !charData || !Object.keys(charData).length) {
    throwHomeStationValidation([CHANGE_HOME_STATION_VALIDATION.INVALID_CANDIDATE]);
  }

  const numericStationID = Number(stationID || 0) || 0;
  const station = getStationRecord(session, numericStationID);
  if (!numericStationID || !station) {
    throwHomeStationValidation([CHANGE_HOME_STATION_VALIDATION.INVALID_CANDIDATE]);
  }

  const allowedStationIDs = resolveAllowedHomeStationIDs(session);
  if (!allowedStationIDs.has(numericStationID)) {
    throwHomeStationValidation([CHANGE_HOME_STATION_VALIDATION.INVALID_CANDIDATE]);
  }

  const currentHomeStationID = Number(charData.homeStationID || charData.cloneStationID || 0) || 0;
  if (numericStationID === currentHomeStationID) {
    throwHomeStationValidation([CHANGE_HOME_STATION_VALIDATION.ALREADY_SET_AS_HOME_STATION]);
  }

  if (isRemoteHomeStationChange(numericStationID, session, charData) && allowRemote !== true) {
    throwWrappedObject(REMOTE_CHANGE_NOT_EXPECTED_ERROR, [], { msg: "RemoteChangeNotExpectedError" });
  }

  const updateResult = updateCharacterRecord(charID, (record) => ({
    ...record,
    homeStationID: numericStationID,
    cloneStationID: numericStationID,
  }));
  if (!updateResult || updateResult.success !== true) {
    throwHomeStationValidation([CHANGE_HOME_STATION_VALIDATION.UNHANDLED_EXCEPTION]);
  }

  setSessionHomeStation(session, numericStationID);
  return null;
}

class HomeStationService extends BaseService {
  constructor() {
    super("home_station");
  }

  Handle_get_home_station(args, session) {
    const { station, homeStationInfo } = resolveStation(session, args);
    return buildHomeStationPayload(station, homeStationInfo);
  }

  Handle_GetHomeStation(args, session) {
    return this.Handle_get_home_station(args, session);
  }

  Handle_getHomeStation(args, session) {
    return this.Handle_get_home_station(args, session);
  }

  Handle_get_home_station_candidates(args, session) {
    return buildHomeStationCandidatePayloads(session);
  }

  Handle_getHomeStationCandidates(args, session) {
    return this.Handle_get_home_station_candidates(args, session);
  }

  Handle_get_next_remote_change_time() {
    return null;
  }

  Handle_getNextRemoteChangeTime(args, session) {
    return this.Handle_get_next_remote_change_time(args, session);
  }

  Handle_set_home_station(args, session) {
    return setHomeStation(
      session,
      args && args.length > 0 ? args[0] : null,
      args && args.length > 1 ? args[1] === true : false,
    );
  }

  Handle_setHomeStation(args, session) {
    return this.Handle_set_home_station(args, session);
  }
}

class HomestationService extends BaseService {
  constructor() {
    super("homestation");
  }

  Handle_get_home_station(args, session) {
    const { station, homeStationInfo } = resolveStation(session, args);
    return buildHomeStationPayload(station, homeStationInfo);
  }

  Handle_GetHomeStation(args, session) {
    return this.Handle_get_home_station(args, session);
  }

  Handle_getHomeStation(args, session) {
    return this.Handle_get_home_station(args, session);
  }

  Handle_get_home_station_candidates(args, session) {
    return buildHomeStationCandidatePayloads(session);
  }

  Handle_getHomeStationCandidates(args, session) {
    return this.Handle_get_home_station_candidates(args, session);
  }

  Handle_get_next_remote_change_time() {
    return null;
  }

  Handle_getNextRemoteChangeTime(args, session) {
    return this.Handle_get_next_remote_change_time(args, session);
  }

  Handle_set_home_station(args, session) {
    return setHomeStation(
      session,
      args && args.length > 0 ? args[0] : null,
      args && args.length > 1 ? args[1] === true : false,
    );
  }

  Handle_setHomeStation(args, session) {
    return this.Handle_set_home_station(args, session);
  }
}

class HomeStationCamelService extends BaseService {
  constructor() {
    super("homeStation");
  }

  Handle_get_home_station(args, session) {
    const { station, homeStationInfo } = resolveStation(session, args);
    return buildHomeStationPayload(station, homeStationInfo);
  }

  Handle_GetHomeStation(args, session) {
    return this.Handle_get_home_station(args, session);
  }

  Handle_getHomeStation(args, session) {
    return this.Handle_get_home_station(args, session);
  }

  Handle_get_home_station_candidates(args, session) {
    return buildHomeStationCandidatePayloads(session);
  }

  Handle_getHomeStationCandidates(args, session) {
    return this.Handle_get_home_station_candidates(args, session);
  }

  Handle_get_next_remote_change_time() {
    return null;
  }

  Handle_getNextRemoteChangeTime(args, session) {
    return this.Handle_get_next_remote_change_time(args, session);
  }

  Handle_set_home_station(args, session) {
    return setHomeStation(
      session,
      args && args.length > 0 ? args[0] : null,
      args && args.length > 1 ? args[1] === true : false,
    );
  }

  Handle_setHomeStation(args, session) {
    return this.Handle_set_home_station(args, session);
  }
}

module.exports = {
  HomeStationService,
  HomestationService,
  HomeStationCamelService,
};
