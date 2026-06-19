function normalizeLocationID(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function getSessionStructureID(session) {
  return normalizeLocationID(
    session &&
      (
        session.structureid ??
        session.structureID ??
        session.structureId
      ),
  );
}

function getSessionStationID(session) {
  return normalizeLocationID(
    session &&
      (
        session.stationid ??
        session.stationID ??
        session.stationId
      ),
  );
}

function isStructureDockedSession(session) {
  return getSessionStructureID(session) > 0;
}

function isStationDockedSession(session) {
  return getSessionStationID(session) > 0;
}

function isDockedSession(session) {
  return isStructureDockedSession(session) || isStationDockedSession(session);
}

function getDockedLocationKind(session) {
  if (isStructureDockedSession(session)) {
    return "structure";
  }
  if (isStationDockedSession(session)) {
    return "station";
  }
  return "space";
}

function getDockedLocationID(session) {
  const structureID = getSessionStructureID(session);
  if (structureID > 0) {
    return structureID;
  }
  return getSessionStationID(session);
}

module.exports = {
  normalizeLocationID,
  getSessionStructureID,
  getSessionStationID,
  isStructureDockedSession,
  isStationDockedSession,
  isDockedSession,
  getDockedLocationKind,
  getDockedLocationID,
};
