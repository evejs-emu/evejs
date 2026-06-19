const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildFiletimeLong,
  buildList,
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));
const {
  getCorporationRecord,
} = require(path.join(__dirname, "./corporationState"));
const {
  normalizePositiveInteger,
  updateCorporationRuntime,
  getCorporationRuntime,
} = require(path.join(__dirname, "./corporationRuntimeState"));

const FILETIME_TICKS_PER_DAY = 864000000000n;

function resolveCharacterID(session) {
  return Number(session && (session.characterID || session.charid)) || 0;
}

function resolveCorporationID(session) {
  return Number(session && (session.corporationID || session.corpid)) || 0;
}

function pushWarFactionSessionChange(session, nextWarFactionID) {
  if (!session || typeof session.sendSessionChange !== "function") {
    return;
  }
  const previousWarFactionID = session.warFactionID ?? session.warfactionid ?? null;
  if (previousWarFactionID === nextWarFactionID) {
    return;
  }
  session.warFactionID = nextWarFactionID;
  session.warfactionid = nextWarFactionID;
  session.sendSessionChange({
    warfactionid: [previousWarFactionID, nextWarFactionID],
  });
}

class FwCharacterEnlistmentMgrService extends BaseService {
  constructor() {
    super("fwCharacterEnlistmentMgr");
  }

  Handle_GetMyEnlistment(args, session) {
    const characterID = resolveCharacterID(session);
    const corporationID = resolveCorporationID(session);
    const characterRecord = getCharacterRecord(characterID) || {};
    const corporationRecord = getCorporationRecord(corporationID) || {};
    const directFactionID =
      normalizePositiveInteger(characterRecord.directFactionID, null) || null;
    const corpFactionID =
      normalizePositiveInteger(corporationRecord.factionID, null) || null;
    return [
      directFactionID || corpFactionID || null,
      directFactionID,
      corpFactionID,
    ];
  }

  Handle_GetCorpAllowedEnlistmentFactions(args) {
    const corporationID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const runtime = getCorporationRuntime(corporationID) || {};
    return buildList((runtime.fw && runtime.fw.allowedEnlistmentFactions) || []);
  }

  Handle_SetMyCorpAllowedEnlistmentFactions(args, session) {
    const corporationID =
      (session && (session.corporationID || session.corpid)) || 0;
    const factions = Array.isArray(args && args[0]) ? args[0] : [];
    updateCorporationRuntime(corporationID, (runtime) => {
      runtime.fw.allowedEnlistmentFactions = factions;
      return runtime;
    });
    return buildList(factions);
  }

  Handle_GetMyDirectEnlistmentCooldownTimestamp(args, session) {
    const characterRecord = getCharacterRecord(resolveCharacterID(session)) || {};
    return buildFiletimeLong(characterRecord.directEnlistmentCooldownTimestamp || "0");
  }

  Handle_CreateMyDirectEnlistment(args, session) {
    const factionID = normalizePositiveInteger(args && args[0], null);
    const characterID = resolveCharacterID(session);
    if (!(characterID > 0) || !factionID) {
      return null;
    }
    updateCharacterRecord(characterID, (record) => ({
      ...record,
      warFactionID: factionID,
      directFactionID: factionID,
      directEnlistmentCooldownTimestamp: "0",
    }));
    pushWarFactionSessionChange(session, factionID);
    return null;
  }

  Handle_RemoveMyDirectEnlistment(args, session) {
    const characterID = resolveCharacterID(session);
    const corporationID = resolveCorporationID(session);
    if (!(characterID > 0)) {
      return null;
    }

    const corporationRecord = getCorporationRecord(corporationID) || {};
    const corpFactionID =
      normalizePositiveInteger(corporationRecord.factionID, null) || null;
    const cooldownTimestamp = (currentFileTime() + FILETIME_TICKS_PER_DAY).toString();
    updateCharacterRecord(characterID, (record) => ({
      ...record,
      warFactionID: corpFactionID,
      directFactionID: null,
      directEnlistmentCooldownTimestamp: cooldownTimestamp,
    }));
    pushWarFactionSessionChange(session, corpFactionID);
    return null;
  }
}

module.exports = FwCharacterEnlistmentMgrService;
