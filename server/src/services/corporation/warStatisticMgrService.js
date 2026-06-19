const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildBoundObjectResponse,
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  normalizeNumber,
  normalizeText,
  resolveBoundNodeId,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getWarRecord,
} = require(path.join(__dirname, "./warRuntimeState"));
const {
  buildKillmailPayload,
  buildWarDestructionStatistics,
  getKillmailHashValue,
  getKillmailRecord,
  listKillmailsForWar,
} = require(path.join(__dirname, "../killmail/killmailState"));

function normalizeWarID(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function buildAllyPayload(ally) {
  return buildKeyVal([
    ["allyID", Number(ally && ally.allyID ? ally.allyID : 0)],
    [
      "timeStarted",
      buildFiletimeLong(ally && ally.timeStarted ? ally.timeStarted : "0"),
    ],
    [
      "timeFinished",
      ally && ally.timeFinished ? buildFiletimeLong(ally.timeFinished) : null,
    ],
  ]);
}

function buildWarPayload(war) {
  return buildKeyVal([
    ["warID", Number(war && war.warID ? war.warID : 0)],
    ["declaredByID", Number(war && war.declaredByID ? war.declaredByID : 0)],
    ["againstID", Number(war && war.againstID ? war.againstID : 0)],
    ["warHQID", war && war.warHQID ? war.warHQID : null],
    [
      "timeDeclared",
      buildFiletimeLong(war && war.timeDeclared ? war.timeDeclared : "0"),
    ],
    [
      "timeStarted",
      buildFiletimeLong(war && war.timeStarted ? war.timeStarted : "0"),
    ],
    [
      "timeFinished",
      war && war.timeFinished ? buildFiletimeLong(war.timeFinished) : null,
    ],
    ["retracted", war && war.retracted ? buildFiletimeLong(war.retracted) : null],
    ["retractedBy", war && war.retractedBy ? war.retractedBy : null],
    ["billID", war && war.billID ? war.billID : null],
    ["mutual", Number(war && war.mutual ? war.mutual : 0)],
    ["openForAllies", Number(war && war.openForAllies ? war.openForAllies : 0)],
    [
      "createdFromWarID",
      war && war.createdFromWarID ? war.createdFromWarID : null,
    ],
    ["reward", Number(war && war.reward ? war.reward : 0)],
    [
      "allies",
      buildDict(
        Object.entries((war && war.allies) || {}).map(([allyID, ally]) => [
          Number(allyID),
          buildAllyPayload({
            allyID: Number(allyID),
            ...(ally || {}),
          }),
        ]),
      ),
    ],
  ]);
}

function resolveBoundWarID(args, session) {
  return normalizeWarID(
    (args && args[0]) || (session && session._boundWarStatisticID),
  );
}

function normalizeKillmailIDArg(value) {
  const numeric = normalizeNumber(value, 0);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

class WarStatisticMgrService extends BaseService {
  constructor() {
    super("warStatisticMgr");
  }

  Handle_MachoResolveObject() {
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    if (session) {
      session._boundWarStatisticID = normalizeWarID(args && args[0]);
    }
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetBaseInfo(args, session) {
    const war = getWarRecord(resolveBoundWarID(args, session));
    if (!war) {
      return null;
    }
    const stats = buildWarDestructionStatistics(war.warID);

    return [
      buildWarPayload(war),
      buildDict(
        Object.entries(stats.shipsKilled || {}).map(([ownerID, count]) => [
          Number(ownerID),
          Number(count || 0),
        ]),
      ),
      buildDict(
        Object.entries(stats.iskKilled || {}).map(([ownerID, amount]) => [
          Number(ownerID),
          Number(amount || 0),
        ]),
      ),
      buildDict(
        Object.entries(war.allies || {}).map(([allyID, ally]) => [
          Number(allyID),
          buildAllyPayload({
            allyID: Number(allyID),
            ...(ally || {}),
          }),
        ]),
      ),
    ];
  }

  Handle_GetKills(args, session) {
    const warID = resolveBoundWarID(args, session);
    const entityID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const groupID = args && args.length > 1 && args[1] !== null && args[1] !== undefined
      ? Number(args[1])
      : null;
    return buildList(
      listKillmailsForWar(warID, {
        entityID,
        groupID,
      }).map((record) => buildKillmailPayload(record)),
    );
  }

  Handle_GetKillsByGroup(args, session) {
    const warID = resolveBoundWarID(args, session);
    const stats = buildWarDestructionStatistics(warID);
    return buildDict(
      Object.entries(stats.killsByGroup || {}).map(([groupID, groupStats]) => [
        Number(groupID),
        buildDict([
          ["attackerShipLoss", Number(groupStats && groupStats.attackerShipLoss ? groupStats.attackerShipLoss : 0)],
          ["attackerIskLoss", Number(groupStats && groupStats.attackerIskLoss ? groupStats.attackerIskLoss : 0)],
          ["defenderShipLoss", Number(groupStats && groupStats.defenderShipLoss ? groupStats.defenderShipLoss : 0)],
          ["defenderIskLoss", Number(groupStats && groupStats.defenderIskLoss ? groupStats.defenderIskLoss : 0)],
        ]),
      ]),
    );
  }

  Handle_GetKillMail(args) {
    const killID = Array.isArray(args) ? normalizeKillmailIDArg(args[0]) : 0;
    const hashValue = Array.isArray(args)
      ? normalizeText(args[1], "").trim()
      : "";
    const killmail = getKillmailRecord(killID);
    if (!killmail) {
      return null;
    }
    if (hashValue && getKillmailHashValue(killmail) !== hashValue) {
      return null;
    }
    return buildKillmailPayload(killmail);
  }
}

module.exports = WarStatisticMgrService;
