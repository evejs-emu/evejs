const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  commandEngage,
  commandMineRepeatedly,
  commandAbandonDrone,
  commandReconnectToDrones,
  commandReturnBay,
  commandReturnHome,
} = require(path.join(__dirname, "./droneRuntime"));

class EntityService extends BaseService {
  constructor() {
    super("entity");
  }

  Handle_MachoResolveObject() {
    const config = require(path.join(__dirname, "../../config"));
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session) {
    const config = require(path.join(__dirname, "../../config"));
    const nestedCall = args && args.length > 1 ? args[1] : null;
    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
    const oid = [idString, now];

    if (session) {
      if (!session._boundObjectIDs || typeof session._boundObjectIDs !== "object") {
        session._boundObjectIDs = {};
      }
      session._boundObjectIDs.entity = idString;
      session.lastBoundObjectID = idString;
    }

    let callResult = null;
    if (Array.isArray(nestedCall) && nestedCall.length > 0) {
      const methodName =
        typeof nestedCall[0] === "string"
          ? nestedCall[0]
          : Buffer.isBuffer(nestedCall[0])
            ? nestedCall[0].toString("utf8")
            : String(nestedCall[0]);
      const callArgs = nestedCall.length > 1 ? nestedCall[1] : [];
      const callKwargs = nestedCall.length > 2 ? nestedCall[2] : null;
      callResult = this.callMethod(
        methodName,
        Array.isArray(callArgs) ? callArgs : [callArgs],
        session,
        callKwargs,
      );
    }

    return [
      {
        type: "substruct",
        value: { type: "substream", value: oid },
      },
      callResult != null ? callResult : null,
    ];
  }

  Handle_CmdReturnHome(args, session) {
    return commandReturnHome(session, args && args[0]);
  }

  Handle_CmdEngage(args, session) {
    return commandEngage(session, args && args[0], args && args[1]);
  }

  Handle_CmdMineRepeatedly(args, session) {
    return commandMineRepeatedly(session, args && args[0], args && args[1]);
  }

  Handle_CmdReturnBay(args, session) {
    return commandReturnBay(session, args && args[0]);
  }

  Handle_CmdAbandonDrone(args, session) {
    return commandAbandonDrone(session, args && args[0]);
  }

  Handle_CmdReconnectToDrones(args, session) {
    return commandReconnectToDrones(session, args && args[0]);
  }

  callMethod(method, args, session, kwargs) {
    const result = super.callMethod(method, args, session, kwargs);
    if (result !== null) {
      return result;
    }

    log.warn(`[EntityService] Unhandled method fallback: ${method}`);
    return null;
  }
}

module.exports = EntityService;
