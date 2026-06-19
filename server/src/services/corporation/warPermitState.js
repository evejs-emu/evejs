const path = require("path");

function getCorporationState() {
  return require(path.join(__dirname, "./corporationState"));
}

function normalizeOwnerID(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function getCorporationWarPermitStatus(corporationID) {
  const numericCorporationID = normalizeOwnerID(corporationID);
  if (!numericCorporationID) {
    return 0;
  }

  const { getCorporationRecord } = getCorporationState();
  const corporation = getCorporationRecord(numericCorporationID);
  if (!corporation) {
    return 0;
  }

  if (
    Object.prototype.hasOwnProperty.call(corporation, "allowWar") &&
    corporation.allowWar !== undefined &&
    corporation.allowWar !== null
  ) {
    return corporation.allowWar ? 1 : 0;
  }

  return corporation.isNPC ? 0 : 1;
}

function getWarPermitStatusForOwner(ownerID) {
  const numericOwnerID = normalizeOwnerID(ownerID);
  if (!numericOwnerID) {
    return 0;
  }

  const {
    getAllianceRecord,
    getCorporationRecord,
  } = getCorporationState();
  if (getCorporationRecord(numericOwnerID)) {
    return getCorporationWarPermitStatus(numericOwnerID);
  }

  const alliance = getAllianceRecord(numericOwnerID);
  if (!alliance) {
    return 0;
  }

  return getCorporationWarPermitStatus(alliance.executorCorporationID);
}

module.exports = {
  getCorporationWarPermitStatus,
  getWarPermitStatusForOwner,
};
