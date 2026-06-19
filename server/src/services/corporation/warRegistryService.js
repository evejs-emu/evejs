const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildBoundObjectResponse,
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const config = require(path.join(__dirname, "../../config"));
const {
  listWarsForOwner,
  getWarRecord,
  updateWarRecord,
} = require(path.join(__dirname, "./warRuntimeState"));
const {
  WAR_NEGOTIATION_STATE_DECLINED,
  WAR_NEGOTIATION_STATE_RETRACTED,
  WAR_NEGOTIATION_TYPE_ALLY_OFFER,
  WAR_NEGOTIATION_TYPE_SURRENDER_OFFER,
  acceptAllyNegotiation,
  acceptSurrender,
  createWarNegotiation,
  getNegotiationRecord,
  listNegotiationsForOwner,
  updateWarNegotiation,
} = require(path.join(__dirname, "./warNegotiationRuntimeState"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

function resolveOwnerID(args, session) {
  return (
    (args && args.length > 0 && Number(args[0])) ||
    (session &&
      (session.allianceID ||
        session.allianceid ||
        session.corporationID ||
        session.corpid)) ||
    0
  );
}

function resolveWarEntityID(session) {
  return (
    (session &&
      ((session.allianceID || session.allianceid) ||
        (session.corporationID || session.corpid))) ||
    0
  );
}

function buildAllyPayload(ally) {
  return buildKeyVal([
    ["allyID", Number(ally && ally.allyID ? ally.allyID : 0)],
    ["timeStarted", buildFiletimeLong(ally && ally.timeStarted ? ally.timeStarted : 0)],
    [
      "timeFinished",
      ally && ally.timeFinished ? buildFiletimeLong(ally.timeFinished) : null,
    ],
  ]);
}

function buildWarPayload(war) {
  return buildKeyVal([
    ["warID", Number(war.warID || 0)],
    ["declaredByID", Number(war.declaredByID || 0)],
    ["againstID", Number(war.againstID || 0)],
    ["warHQID", war.warHQID || null],
    ["timeDeclared", buildFiletimeLong(war.timeDeclared || 0)],
    ["timeStarted", buildFiletimeLong(war.timeStarted || 0)],
    ["timeFinished", war.timeFinished ? buildFiletimeLong(war.timeFinished) : null],
    ["retracted", war.retracted ? buildFiletimeLong(war.retracted) : null],
    ["retractedBy", war.retractedBy || null],
    ["billID", war.billID || null],
    ["mutual", Number(war.mutual || 0)],
    ["openForAllies", Number(war.openForAllies || 0)],
    ["createdFromWarID", war.createdFromWarID || null],
    ["reward", Number(war.reward || 0)],
    [
      "allies",
      buildDict(
        Object.entries(war.allies || {}).map(([allyID, ally]) => [
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

function buildWarNegotiationPayload(negotiation) {
  return buildKeyVal([
    ["warNegotiationID", Number(negotiation && negotiation.warNegotiationID ? negotiation.warNegotiationID : 0)],
    ["warID", Number(negotiation && negotiation.warID ? negotiation.warID : 0)],
    [
      "warNegotiationTypeID",
      Number(negotiation && negotiation.warNegotiationTypeID ? negotiation.warNegotiationTypeID : 0),
    ],
    ["ownerID1", Number(negotiation && negotiation.ownerID1 ? negotiation.ownerID1 : 0)],
    ["ownerID2", Number(negotiation && negotiation.ownerID2 ? negotiation.ownerID2 : 0)],
    ["declaredByID", Number(negotiation && negotiation.declaredByID ? negotiation.declaredByID : 0)],
    ["againstID", Number(negotiation && negotiation.againstID ? negotiation.againstID : 0)],
    ["iskValue", Number(negotiation && negotiation.iskValue ? negotiation.iskValue : 0)],
    ["description", negotiation && negotiation.description ? negotiation.description : ""],
    [
      "negotiationState",
      Number(negotiation && negotiation.negotiationState ? negotiation.negotiationState : 0),
    ],
    [
      "createdDateTime",
      buildFiletimeLong(
        negotiation && negotiation.createdDateTime ? negotiation.createdDateTime : 0,
      ),
    ],
    [
      "timeAccepted",
      negotiation && negotiation.timeAccepted
        ? buildFiletimeLong(negotiation.timeAccepted)
        : null,
    ],
    [
      "timeDeclined",
      negotiation && negotiation.timeDeclined
        ? buildFiletimeLong(negotiation.timeDeclined)
        : null,
    ],
    [
      "timeRetracted",
      negotiation && negotiation.timeRetracted
        ? buildFiletimeLong(negotiation.timeRetracted)
        : null,
    ],
  ]);
}

class WarRegistryService extends BaseService {
  constructor() {
    super("warRegistry");
  }

  Handle_IsAllianceOrCorpLocal() {
    return 1;
  }

  Handle_MachoResolveObject() {
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetWars(args, session) {
    const ownerID = resolveOwnerID(args, session);
    return buildDict(
      listWarsForOwner(ownerID).map((war) => [Number(war.warID), buildWarPayload(war)]),
    );
  }

  Handle_GetNegotiations(args, session) {
    return buildList(
      listNegotiationsForOwner(resolveWarEntityID(session)).map((negotiation) =>
        buildWarNegotiationPayload(negotiation),
      ),
    );
  }

  Handle_CreateWarAllyOffer(args, session) {
    const warID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const iskValue = args && args.length > 1 ? Number(args[1]) || 0 : 0;
    const defenderID = args && args.length > 2 ? Number(args[2]) || 0 : 0;
    const description = args && args.length > 3 ? String(args[3] || "") : "";
    const war = getWarRecord(warID);
    const ownerID = resolveWarEntityID(session);
    if (!war || !ownerID) {
      return null;
    }
    createWarNegotiation({
      warID,
      warNegotiationTypeID: WAR_NEGOTIATION_TYPE_ALLY_OFFER,
      ownerID1: ownerID,
      ownerID2: defenderID || Number(war.againstID || 0),
      declaredByID: Number(war.declaredByID || 0),
      againstID: Number(war.againstID || 0),
      iskValue,
      description,
    });
    return null;
  }

  Handle_RetractWarAllyOffer(args) {
    const warNegotiationID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    updateWarNegotiation(warNegotiationID, (record) => ({
      ...record,
      negotiationState: WAR_NEGOTIATION_STATE_RETRACTED,
      timeRetracted: currentFileTime().toString(),
    }));
    return null;
  }

  Handle_CreateSurrenderNegotiation(args, session) {
    const warID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const iskValue = args && args.length > 1 ? Number(args[1]) || 0 : 0;
    const description = args && args.length > 2 ? String(args[2] || "") : "";
    const war = getWarRecord(warID);
    const ownerID = resolveWarEntityID(session);
    if (!war || !ownerID) {
      return null;
    }
    const counterpartyID =
      ownerID === Number(war.declaredByID || 0)
        ? Number(war.againstID || 0)
        : Number(war.declaredByID || 0);
    createWarNegotiation({
      warID,
      warNegotiationTypeID: WAR_NEGOTIATION_TYPE_SURRENDER_OFFER,
      ownerID1: ownerID,
      ownerID2: counterpartyID,
      declaredByID: Number(war.declaredByID || 0),
      againstID: Number(war.againstID || 0),
      iskValue,
      description,
      ownerID1AccountKey:
        (session && (session.corpAccountKey || session.corpaccountkey)) || 1000,
    });
    return null;
  }

  Handle_GetWarNegotiation(args) {
    const warNegotiationID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const negotiation = getNegotiationRecord(warNegotiationID);
    return negotiation ? buildWarNegotiationPayload(negotiation) : null;
  }

  Handle_AcceptAllyNegotiation(args, session) {
    const warNegotiationID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    acceptAllyNegotiation(warNegotiationID, session);
    return null;
  }

  Handle_DeclineAllyOffer(args) {
    const warNegotiationID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    updateWarNegotiation(warNegotiationID, (record) => ({
      ...record,
      negotiationState: WAR_NEGOTIATION_STATE_DECLINED,
      timeDeclined: currentFileTime().toString(),
    }));
    return null;
  }

  Handle_RetractMutualWar(args) {
    const warID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    updateWarRecord(warID, (war) => {
      const filetime = String(Date.now() * 10000 + 116444736000000000);
      war.retracted = filetime;
      war.timeFinished = filetime;
      return war;
    });
    return null;
  }

  Handle_AcceptSurrender(args) {
    const warNegotiationID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    acceptSurrender(warNegotiationID);
    return null;
  }

  Handle_DeclineSurrender(args) {
    const warNegotiationID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    updateWarNegotiation(warNegotiationID, (record) => ({
      ...record,
      negotiationState: WAR_NEGOTIATION_STATE_DECLINED,
      timeDeclined: currentFileTime().toString(),
    }));
    return null;
  }

  Handle_SetOpenForAllies(args) {
    const warID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const state = args && args.length > 1 ? args[1] : false;
    updateWarRecord(warID, (war) => {
      war.openForAllies = state ? 1 : 0;
      return war;
    });
    return null;
  }
}

module.exports = WarRegistryService;
