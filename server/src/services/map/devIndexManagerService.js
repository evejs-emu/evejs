const BaseService = require("../baseService");
const log = require("../../utils/logger");
const {
  getDevelopmentIndicesForSystem,
  listAllDevelopmentIndices,
} = require("../sovereignty/sovState");
const {
  buildAllDevelopmentIndicesPayload,
  buildDevelopmentIndicesForSystemPayload,
} = require("../sovereignty/sovPayloads");

class DevIndexManagerService extends BaseService {
  constructor() {
    super("devIndexManager");
  }

  Handle_GetDevelopmentIndicesForSystem(args, session) {
    const solarSystemID =
      Number(
        args && args.length > 0
          ? args[0]
          : session && (session.solarsystemid2 || session.solarsystemid),
      ) || 0;

    log.debug(
      `[DevIndexManager] GetDevelopmentIndicesForSystem called (solarsystemid=${solarSystemID})`,
    );

    // solar5.txt / solar6.txt show sovSvc.GetIndexInfoForSolarsystem calling
    // .get(...) on the returned object. The no-index-data case must therefore
    // be an empty dict, not None.
    return buildDevelopmentIndicesForSystemPayload(
      getDevelopmentIndicesForSystem(solarSystemID),
    );
  }

  Handle_GetAllDevelopmentIndices(args, session) {
    log.debug("[DevIndexManager] GetAllDevelopmentIndices called");
    return buildAllDevelopmentIndicesPayload(listAllDevelopmentIndices());
  }

  callMethod(method, args, session, kwargs) {
    const response = super.callMethod(method, args, session, kwargs);
    if (response !== null) {
      return response;
    }

    log.warn(`[DevIndexManager] Unhandled method fallback: ${method}`);
    return { type: "dict", entries: [] };
  }
}

module.exports = DevIndexManagerService;
