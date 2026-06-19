const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  createWarRecord,
} = require(path.join(__dirname, "./warRuntimeState"));
const {
  ensureRuntimeInitialized,
  updateRuntimeState,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  isMutualWarInviteBlocked,
  setMutualWarInviteBlocked,
} = require(path.join(__dirname, "./warNegotiationRuntimeState"));

function resolveOwnerID(session) {
  return (
    (session &&
      ((session.allianceID || session.allianceid) ||
        (session.corporationID || session.corpid))) ||
    0
  );
}

function buildInvitePayload(invite) {
  return buildKeyVal([
    ["fromOwnerID", Number(invite && invite.fromOwnerID ? invite.fromOwnerID : 0)],
    ["toOwnerID", Number(invite && invite.toOwnerID ? invite.toOwnerID : 0)],
    [
      "sentDate",
      buildFiletimeLong(invite && invite.sentDate ? invite.sentDate : currentFileTime()),
    ],
  ]);
}

class MutualWarInviteManagerService extends BaseService {
  constructor() {
    super("mutualWarInviteMgr");
  }

  Handle_GetPendingInvitesForSession(args, session) {
    const ownerID = resolveOwnerID(session);
    const runtime = ensureRuntimeInitialized();
    return buildList(
      Object.values(runtime.mutualWarInvites || {})
        .filter(
          (invite) =>
            Number(invite.fromOwnerID) === Number(ownerID) ||
            Number(invite.toOwnerID) === Number(ownerID),
        )
        .sort((left, right) => {
          const leftSentDate = BigInt(String(left && left.sentDate ? left.sentDate : "0"));
          const rightSentDate = BigInt(String(right && right.sentDate ? right.sentDate : "0"));
          if (leftSentDate === rightSentDate) {
            return 0;
          }
          return rightSentDate > leftSentDate ? 1 : -1;
        })
        .map((invite) => buildInvitePayload(invite)),
    );
  }

  Handle_SendInviteByPlayer(args, session) {
    const toOwnerID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const fromOwnerID = resolveOwnerID(session);
    if (!fromOwnerID || !toOwnerID || isMutualWarInviteBlocked(toOwnerID)) {
      return null;
    }
    updateRuntimeState((runtime) => {
      runtime.mutualWarInvites =
        runtime.mutualWarInvites && typeof runtime.mutualWarInvites === "object"
          ? runtime.mutualWarInvites
          : {};
      runtime.mutualWarInvites[`${fromOwnerID}:${toOwnerID}`] = {
        fromOwnerID,
        toOwnerID,
        sentDate: currentFileTime().toString(),
      };
      return runtime;
    });
    return null;
  }

  Handle_WithdrawInviteByPlayer(args, session) {
    const toOwnerID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const fromOwnerID = resolveOwnerID(session);
    updateRuntimeState((runtime) => {
      runtime.mutualWarInvites =
        runtime.mutualWarInvites && typeof runtime.mutualWarInvites === "object"
          ? runtime.mutualWarInvites
          : {};
      delete runtime.mutualWarInvites[`${fromOwnerID}:${toOwnerID}`];
      return runtime;
    });
    return null;
  }

  Handle_RespondToInviteByPlayer(args, session) {
    const fromOwnerID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const accepts = Boolean(args && args.length > 1 ? args[1] : false);
    const toOwnerID = resolveOwnerID(session);
    updateRuntimeState((runtime) => {
      runtime.mutualWarInvites =
        runtime.mutualWarInvites && typeof runtime.mutualWarInvites === "object"
          ? runtime.mutualWarInvites
          : {};
      delete runtime.mutualWarInvites[`${fromOwnerID}:${toOwnerID}`];
      return runtime;
    });
    if (accepts && fromOwnerID && toOwnerID) {
      createWarRecord({
        declaredByID: fromOwnerID,
        againstID: toOwnerID,
        mutual: true,
      });
    }
    return null;
  }

  Handle_SetInvitesBlockedByPlayer(args, session) {
    const blocked = Boolean(args && args.length > 0 ? args[0] : false);
    setMutualWarInviteBlocked(resolveOwnerID(session), blocked);
    return null;
  }

  Handle_IsCorpInvitesBlockedPlayer(args, session) {
    return isMutualWarInviteBlocked(resolveOwnerID(session)) ? 1 : 0;
  }
}

module.exports = MutualWarInviteManagerService;
