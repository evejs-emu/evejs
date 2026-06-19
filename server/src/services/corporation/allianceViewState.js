const path = require("path");

const {
  buildFiletimeLong,
  buildIndexRowset,
  buildList,
  buildRowset,
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getAllianceCorporationIDs,
  getAllianceRecord,
  getCorporationRecord,
} = require(path.join(__dirname, "./corporationState"));
const {
  getAllianceRuntime,
  normalizePositiveInteger,
  updateAllianceRuntime,
} = require(path.join(__dirname, "./corporationRuntimeState"));

const ALLIANCE_MEMBER_HEADER = [
  "corporationID",
  "allianceID",
  "chosenExecutorID",
  "startDate",
  "deleted",
];

const ALLIANCE_APPLICATION_HEADER = [
  "allianceID",
  "corporationID",
  "applicationText",
  "state",
  "applicationDateTime",
];

function getAllianceMembershipStartFiletime(allianceID, corporationID) {
  const runtime = getAllianceRuntime(allianceID) || {};
  const storedValue =
    runtime.memberJoinedAtByCorporation &&
    runtime.memberJoinedAtByCorporation[String(corporationID)];
  if (storedValue) {
    return String(storedValue);
  }
  const allianceRecord = getAllianceRecord(allianceID) || {};
  return String(allianceRecord.createdAt || currentFileTime());
}

function buildAllianceMembersIndexRowset(allianceID) {
  const allianceRecord = getAllianceRecord(allianceID);
  const runtime = getAllianceRuntime(allianceID) || {};
  const keyedRows = (allianceRecord ? getAllianceCorporationIDs(allianceID) : []).map(
    (corporationID) => [
      corporationID,
      [
        corporationID,
        allianceID,
        normalizePositiveInteger(
          runtime.executorSupportByCorporation &&
            runtime.executorSupportByCorporation[String(corporationID)],
          null,
        ),
        buildFiletimeLong(getAllianceMembershipStartFiletime(allianceID, corporationID)),
        0,
      ],
    ],
  );
  return buildIndexRowset(
    ALLIANCE_MEMBER_HEADER,
    keyedRows,
    "corporationID",
  );
}

function buildAllianceMembersRowset(allianceID) {
  const allianceRecord = getAllianceRecord(allianceID);
  const runtime = getAllianceRuntime(allianceID) || {};
  const rows = (allianceRecord ? getAllianceCorporationIDs(allianceID) : []).map(
    (corporationID) =>
      buildList([
        corporationID,
        allianceID,
        normalizePositiveInteger(
          runtime.executorSupportByCorporation &&
            runtime.executorSupportByCorporation[String(corporationID)],
          null,
        ),
        buildFiletimeLong(getAllianceMembershipStartFiletime(allianceID, corporationID)),
        0,
      ]),
  );
  return buildRowset(
    ALLIANCE_MEMBER_HEADER,
    rows,
    "eve.common.script.sys.rowset.Rowset",
  );
}

function buildAllianceApplicationsIndexRowset(allianceID) {
  const runtime = getAllianceRuntime(allianceID) || {};
  return buildIndexRowset(
    ALLIANCE_APPLICATION_HEADER,
    Object.entries(runtime.applications || {}).map(([corporationID, application]) => [
      Number(corporationID),
      [
        Number(application && application.allianceID ? application.allianceID : allianceID),
        Number(corporationID),
        application && application.applicationText ? application.applicationText : "",
        Number(application && application.state ? application.state : 0),
        buildFiletimeLong(
          application && application.applicationDateTime
            ? application.applicationDateTime
            : "0",
        ),
      ],
    ]),
    "corporationID",
  );
}

function buildCorporationAllianceApplicationsIndexRowset(corporationID, applications = {}) {
  return buildIndexRowset(
    ALLIANCE_APPLICATION_HEADER,
    Object.entries(applications || {}).map(([allianceID, application]) => [
      Number(allianceID),
      [
        Number(allianceID),
        Number(
          application && application.corporationID
            ? application.corporationID
            : corporationID,
        ),
        application && application.applicationText ? application.applicationText : "",
        Number(application && application.state ? application.state : 0),
        buildFiletimeLong(
          application && application.applicationDateTime
            ? application.applicationDateTime
            : "0",
        ),
      ],
    ]),
    "allianceID",
  );
}

function setAllianceExecutorSupportChoice(
  allianceID,
  supporterCorporationID,
  chosenExecutorID,
) {
  const numericAllianceID = normalizePositiveInteger(allianceID, null);
  const numericSupporterCorporationID = normalizePositiveInteger(
    supporterCorporationID,
    null,
  );
  const numericChosenExecutorID = normalizePositiveInteger(chosenExecutorID, null);
  if (!numericAllianceID || !numericSupporterCorporationID) {
    return null;
  }

  const memberCorporationIDs = new Set(getAllianceCorporationIDs(numericAllianceID));
  if (!memberCorporationIDs.has(numericSupporterCorporationID)) {
    return null;
  }
  if (numericChosenExecutorID && !memberCorporationIDs.has(numericChosenExecutorID)) {
    return null;
  }

  updateAllianceRuntime(numericAllianceID, (runtime) => {
    runtime.executorSupportByCorporation =
      runtime.executorSupportByCorporation &&
      typeof runtime.executorSupportByCorporation === "object"
        ? runtime.executorSupportByCorporation
        : {};
    runtime.executorSupportByCorporation[String(numericSupporterCorporationID)] =
      numericChosenExecutorID;
    return runtime;
  });
  return numericChosenExecutorID;
}

function removeAllianceCorporationState(allianceID, corporationID) {
  const numericAllianceID = normalizePositiveInteger(allianceID, null);
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  if (!numericAllianceID || !numericCorporationID) {
    return;
  }

  updateAllianceRuntime(numericAllianceID, (runtime) => {
    if (runtime.executorSupportByCorporation) {
      delete runtime.executorSupportByCorporation[String(numericCorporationID)];
    }
    if (runtime.memberJoinedAtByCorporation) {
      delete runtime.memberJoinedAtByCorporation[String(numericCorporationID)];
    }
    if (runtime.applications) {
      delete runtime.applications[String(numericCorporationID)];
    }
    return runtime;
  });
}

function recordAllianceMemberJoin(allianceID, corporationID, startDate = null) {
  const numericAllianceID = normalizePositiveInteger(allianceID, null);
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  if (!numericAllianceID || !numericCorporationID) {
    return;
  }
  updateAllianceRuntime(numericAllianceID, (runtime) => {
    runtime.memberJoinedAtByCorporation =
      runtime.memberJoinedAtByCorporation &&
      typeof runtime.memberJoinedAtByCorporation === "object"
        ? runtime.memberJoinedAtByCorporation
        : {};
    runtime.memberJoinedAtByCorporation[String(numericCorporationID)] = String(
      startDate || currentFileTime(),
    );
    return runtime;
  });
}

function getDaysInAlliance(allianceID, corporationID) {
  const corporationRecord = getCorporationRecord(corporationID);
  if (!corporationRecord || Number(corporationRecord.allianceID || 0) !== Number(allianceID)) {
    return 0;
  }
  const startDate = BigInt(getAllianceMembershipStartFiletime(allianceID, corporationID));
  if (startDate <= 0n) {
    return 0;
  }
  const diff = currentFileTime() - startDate;
  if (diff <= 0n) {
    return 0;
  }
  return Number(diff / 864000000000n);
}

function getAllianceMembersOlderThan(allianceID, minimumDays) {
  const requiredDays = Math.max(0, Number(minimumDays || 0));
  return getAllianceCorporationIDs(allianceID).filter(
    (corporationID) => getDaysInAlliance(allianceID, corporationID) >= requiredDays,
  );
}

module.exports = {
  buildAllianceApplicationsIndexRowset,
  buildAllianceMembersRowset,
  buildAllianceMembersIndexRowset,
  buildCorporationAllianceApplicationsIndexRowset,
  getAllianceMembersOlderThan,
  getDaysInAlliance,
  recordAllianceMemberJoin,
  removeAllianceCorporationState,
  setAllianceExecutorSupportChoice,
};
