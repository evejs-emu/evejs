const path = require("path");

const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));

function getOwnerSessions(ownerID) {
  const numericOwnerID = Number(ownerID) || 0;
  return sessionRegistry.getSessions().filter((session) => (
    Number(session && session.characterID) === numericOwnerID ||
    Number(session && (session.corporationID || session.corpid)) === numericOwnerID
  ));
}

function notifyBlueprintsUpdated(ownerID) {
  for (const session of getOwnerSessions(ownerID)) {
    if (typeof session.sendNotification !== "function") {
      continue;
    }
    session.sendNotification("OnBlueprintsUpdated", "clientID", [Number(ownerID) || 0]);
  }
}

function notifyIndustryJob(job) {
  const payload = [
    Number(job && job.jobID) || 0,
    Number(job && job.ownerID) || 0,
    Number(job && job.blueprintID) || 0,
    Number(job && job.installerID) || 0,
    Number(job && job.status) || 0,
    Number(job && job.successfulRuns) || 0,
  ];
  for (const session of getOwnerSessions(job && job.ownerID)) {
    if (typeof session.sendNotification !== "function") {
      continue;
    }
    session.sendNotification("OnIndustryJob", "clientID", payload);
  }
}

function notifyFacilitiesUpdated(facilityIDs = []) {
  const payload = Array.isArray(facilityIDs)
    ? facilityIDs.map((facilityID) => Number(facilityID) || 0).filter((facilityID) => facilityID > 0)
    : [];
  if (payload.length === 0) {
    return;
  }
  for (const session of sessionRegistry.getSessions()) {
    if (typeof session.sendNotification !== "function") {
      continue;
    }
    session.sendNotification("OnFacilitiesUpdated", "clientID", [payload]);
  }
}

module.exports = {
  notifyBlueprintsUpdated,
  notifyFacilitiesUpdated,
  notifyIndustryJob,
};
