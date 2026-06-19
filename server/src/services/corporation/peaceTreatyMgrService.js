const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildFiletimeLong,
  buildKeyVal,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  listPeaceTreatiesForOwner,
} = require(path.join(__dirname, "./warNegotiationRuntimeState"));

function buildTreatyPayload(treaty) {
  return buildKeyVal([
    ["treatyID", Number(treaty && treaty.treatyID ? treaty.treatyID : 0)],
    ["warID", Number(treaty && treaty.warID ? treaty.warID : 0)],
    ["ownerID", Number(treaty && treaty.ownerID ? treaty.ownerID : 0)],
    ["otherOwnerID", Number(treaty && treaty.otherOwnerID ? treaty.otherOwnerID : 0)],
    ["peaceReason", Number(treaty && treaty.peaceReason ? treaty.peaceReason : 0)],
    [
      "createdDate",
      treaty && treaty.createdDate ? buildFiletimeLong(treaty.createdDate) : null,
    ],
    [
      "expiryDate",
      treaty && treaty.expiryDate ? buildFiletimeLong(treaty.expiryDate) : null,
    ],
  ]);
}

class PeaceTreatyManagerService extends BaseService {
  constructor() {
    super("peaceTreatyMgr");
  }

  Handle_GetPeaceTreatiesForSession(args, session) {
    const ownerID =
      (session &&
        ((session.allianceID || session.allianceid) ||
          (session.corporationID || session.corpid))) ||
      0;
    const { outgoing, incoming } = listPeaceTreatiesForOwner(ownerID);
    return [
      buildList(outgoing.map((treaty) => buildTreatyPayload(treaty))),
      buildList(incoming.map((treaty) => buildTreatyPayload(treaty))),
    ];
  }
}

module.exports = PeaceTreatyManagerService;
