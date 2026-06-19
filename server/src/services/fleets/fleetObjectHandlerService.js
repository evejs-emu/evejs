const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const config = require(path.join(__dirname, "../../config"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildCompositionPayload,
  buildAdvertPayload,
  buildFleetStatePayload,
  buildJoinRequestsPayload,
  buildWingPayload,
} = require(path.join(__dirname, "./fleetPayloads"));
const {
  buildDict,
  currentFileTime,
  normalizeText,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const fleetRuntime = require(path.join(__dirname, "./fleetRuntime"));

class FleetObjectHandlerService extends BaseService {
  constructor() {
    super("fleetObjectHandler");
    this._boundContexts = new Map();
  }

  _rememberBoundContext(oidString, fleetID) {
    if (!oidString || !fleetID) {
      return;
    }
    this._boundContexts.set(oidString, {
      fleetID: fleetRuntime.toInteger(fleetID, 0),
    });
  }

  _resolveFleetIDFromSession(session, fallback = null) {
    if (session && session.currentBoundObjectID) {
      const boundContext = this._boundContexts.get(session.currentBoundObjectID) || null;
      if (boundContext && boundContext.fleetID) {
        return boundContext.fleetID;
      }
    }

    if (fallback != null) {
      return fleetRuntime.toInteger(fallback, 0);
    }

    return fleetRuntime.toInteger(session && session.fleetid, 0);
  }

  _buildBoundResponse(fleetID, session, nestedCall = null) {
    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const oid = [idString, currentFileTime()];
    this._rememberBoundContext(idString, fleetID);

    if (session) {
      if (!session._boundObjectIDs || typeof session._boundObjectIDs !== "object") {
        session._boundObjectIDs = {};
      }
      session._boundObjectIDs[this.name] = idString;
      session.lastBoundObjectID = idString;
    }

    let callResult = null;
    if (Array.isArray(nestedCall) && nestedCall.length > 0) {
      const methodName = normalizeText(nestedCall[0], "");
      const callArgs = nestedCall.length > 1 ? nestedCall[1] : [];
      const callKwargs = nestedCall.length > 2 ? nestedCall[2] : null;
      const previousBoundObjectID = session ? session.currentBoundObjectID : null;
      try {
        if (session) {
          session.currentBoundObjectID = idString;
        }
        callResult = this.callMethod(
          methodName,
          Array.isArray(callArgs) ? callArgs : [callArgs],
          session,
          callKwargs,
        );
      } finally {
        if (session) {
          session.currentBoundObjectID = previousBoundObjectID || null;
        }
      }
    }

    return [
      {
        type: "substruct",
        value: {
          type: "substream",
          value: oid,
        },
      },
      callResult != null ? callResult : null,
    ];
  }

  Handle_MachoResolveObject() {
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session) {
    const bindParams = args && args.length > 0 ? args[0] : null;
    const nestedCall = args && args.length > 1 ? args[1] : null;
    const fleetID = fleetRuntime.toInteger(
      Array.isArray(bindParams) ? bindParams[0] : bindParams,
      session && session.fleetid ? session.fleetid : 0,
    );
    return this._buildBoundResponse(fleetID, session, nestedCall);
  }

  Handle_CreateFleet(args, session) {
    const fleet = fleetRuntime.createFleetRecord(session);
    const boundResponse = this._buildBoundResponse(fleet.fleetID, session, null);
    return Array.isArray(boundResponse) ? boundResponse[0] : boundResponse;
  }

  Handle_Init(args, session, kwargs) {
    const fleetID = this._resolveFleetIDFromSession(session);
    const shipTypeID = args && args.length > 0 ? args[0] : null;
    const setupName = args && args.length > 1 ? args[1] : null;
    const advertData = fleetRuntime.getKwarg(kwargs, "adInfoData", null);
    log.info(
      `[FleetObjectHandler] Init fleet=${fleetID} shipType=${shipTypeID || "?"} setup=${setupName || ""} advert=${advertData ? "yes" : "no"}`,
    );
    const createdAdvert = fleetRuntime.initFleet(session, fleetID, {
      shipTypeID,
      setupName,
      adInfoData: advertData,
    });
    return createdAdvert ? buildAdvertPayload(createdAdvert) : null;
  }

  Handle_GetInitState(args, session) {
    return buildFleetStatePayload(
      fleetRuntime.getFleetState(this._resolveFleetIDFromSession(session)),
    );
  }

  Handle_GetFleetID(args, session) {
    return this._resolveFleetIDFromSession(session);
  }

  Handle_GetFleetMaxSize(args, session) {
    return fleetRuntime.getFleetMaxSize(this._resolveFleetIDFromSession(session));
  }

  Handle_GetWings(args, session) {
    const wings = fleetRuntime.getWings(this._resolveFleetIDFromSession(session));
    return buildDict(
      [...wings.values()].map((wing) => [wing.wingID, buildWingPayload(wing)]),
    );
  }

  Handle_GetMotd(args, session) {
    return fleetRuntime.getMotd(this._resolveFleetIDFromSession(session));
  }

  Handle_GetJoinRequests(args, session) {
    return buildJoinRequestsPayload(
      fleetRuntime.getJoinRequests(this._resolveFleetIDFromSession(session)),
    );
  }

  Handle_GetFleetComposition(args, session) {
    return buildCompositionPayload(
      fleetRuntime.getFleetComposition(this._resolveFleetIDFromSession(session)),
    );
  }

  Handle_CreateWing(args, session) {
    return fleetRuntime.createWing(session, this._resolveFleetIDFromSession(session));
  }

  Handle_DeleteWing(args, session) {
    return fleetRuntime.deleteWing(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0],
    );
  }

  Handle_ChangeWingName(args, session) {
    return fleetRuntime.changeWingName(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0],
      args && args[1],
    );
  }

  Handle_CreateSquad(args, session) {
    return fleetRuntime.createSquad(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0],
    );
  }

  Handle_DeleteSquad(args, session) {
    return fleetRuntime.deleteSquad(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0],
    );
  }

  Handle_ChangeSquadName(args, session) {
    return fleetRuntime.changeSquadName(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0],
      args && args[1],
    );
  }

  Handle_MoveMember(args, session) {
    return fleetRuntime.moveMember(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0],
      args && args[1],
      args && args[2],
      args && args[3],
    );
  }

  Handle_MassMoveMembers(args, session) {
    return fleetRuntime.massMoveMembers(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0],
      args && args[1],
      args && args[2],
      args && args[3],
    );
  }

  Handle_FinishMove(args, session) {
    return fleetRuntime.finishMove(
      session,
      this._resolveFleetIDFromSession(session),
    );
  }

  Handle_KickMember(args, session) {
    return fleetRuntime.kickMember(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0],
    );
  }

  Handle_MakeLeader(args, session) {
    return fleetRuntime.makeLeader(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0],
    );
  }

  Handle_LeaveFleet(args, session) {
    return fleetRuntime.leaveFleet(
      session,
      this._resolveFleetIDFromSession(session),
    );
  }

  Handle_DisbandFleet(args, session) {
    return fleetRuntime.disbandFleet(
      session,
      this._resolveFleetIDFromSession(session),
    );
  }

  Handle_SetOptions(args, session) {
    return fleetRuntime.setOptions(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0] ? args[0] : {},
    );
  }

  Handle_SetAutoJoinSquadID(args, session) {
    return fleetRuntime.setAutoJoinSquadID(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0],
    );
  }

  Handle_SetFleetMaxSize(args, session) {
    return fleetRuntime.setFleetMaxSize(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0],
    );
  }

  Handle_SetMotdEx(args, session) {
    return fleetRuntime.setMotd(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0],
    );
  }

  Handle_SetTakesFleetWarp(args, session) {
    return fleetRuntime.setMemberOptOut(
      session,
      this._resolveFleetIDFromSession(session),
      "acceptsFleetWarp",
      args && args[0],
    );
  }

  Handle_SetAcceptsConduitJumpsValue(args, session) {
    return fleetRuntime.setMemberOptOut(
      session,
      this._resolveFleetIDFromSession(session),
      "acceptsConduitJumps",
      args && args[0],
    );
  }

  Handle_SetAcceptsRegroupValue(args, session) {
    return fleetRuntime.setMemberOptOut(
      session,
      this._resolveFleetIDFromSession(session),
      "acceptsFleetRegroups",
      args && args[0],
    );
  }

  Handle_UpdateMemberInfo(args, session) {
    return fleetRuntime.updateMemberInfo(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0],
    );
  }

  Handle_LoadFleetSetup(args, session) {
    return fleetRuntime.loadFleetSetup(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0],
    );
  }

  Handle_RejectJoinRequest(args, session) {
    return fleetRuntime.rejectJoinRequest(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0],
    );
  }

  Handle_SendBroadcast(args, session) {
    return fleetRuntime.sendBroadcast(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0],
      args && args[1],
      args && args[2],
      args && args[3],
      fleetRuntime.FLEET.BROADCAST_UNIVERSE,
    );
  }

  Handle_AcceptInvite(args, session) {
    return fleetRuntime.acceptInvite(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0],
    );
  }

  Handle_RejectInvite(args, session) {
    return fleetRuntime.rejectInvite(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0],
    );
  }

  Handle_Reconnect(args, session) {
    return fleetRuntime.reconnectCharacter(
      session,
      this._resolveFleetIDFromSession(session),
    );
  }

  Handle_Invite(args, session) {
    return fleetRuntime.inviteCharacter(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0],
      args && args[1],
      args && args[2],
      args && args[3],
    );
  }

  Handle_MassInvite(args, session) {
    return fleetRuntime.massInvite(
      session,
      this._resolveFleetIDFromSession(session),
      args && args[0],
      args && args[1],
      args && args[2],
      args && args[3],
    );
  }
}

module.exports = FleetObjectHandlerService;
