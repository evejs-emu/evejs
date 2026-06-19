const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const fleetRuntime = require(path.join(__dirname, "./fleetRuntime"));

class FleetMgrService extends BaseService {
  constructor() {
    super("fleetMgr");
  }

  Handle_ForceLeaveFleet(args, session) {
    return fleetRuntime.forceLeaveFleet(session);
  }

  Handle_AddToWatchlist(args, session) {
    return fleetRuntime.addToWatchlist(
      session,
      args && args[0],
      args && args[1],
    );
  }

  Handle_RemoveFromWatchlist(args, session) {
    return fleetRuntime.removeFromWatchlist(
      session,
      args && args[0],
      args && args[1],
    );
  }

  Handle_RegisterForDamageUpdates(args, session) {
    return fleetRuntime.registerForDamageUpdates(
      session,
      args && args[0],
    );
  }

  Handle_BroadcastToBubble(args, session) {
    return fleetRuntime.sendBroadcast(
      session,
      session && session.fleetid,
      args && args[0],
      args && args[1],
      args && args[2],
      args && args[3],
      fleetRuntime.FLEET.BROADCAST_BUBBLE,
    );
  }

  Handle_BroadcastToSystem(args, session) {
    return fleetRuntime.sendBroadcast(
      session,
      session && session.fleetid,
      args && args[0],
      args && args[1],
      args && args[2],
      args && args[3],
      fleetRuntime.FLEET.BROADCAST_SYSTEM,
    );
  }
}

module.exports = FleetMgrService;
