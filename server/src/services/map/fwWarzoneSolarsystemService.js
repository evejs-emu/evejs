const BaseService = require("../baseService");
const log = require("../../utils/logger");

class FwWarzoneSolarsystemService extends BaseService {
  constructor() {
    super("fwWarzoneSolarsystem");
  }

  Handle_GetAllWarzonesOccupationStates(args, session) {
    log.debug("[fwWarzoneSvc] GetAllWarzonesOccupationStates called");

    // Decompiled V23.02 fwWarzoneSvc.py does:
    //   occupationStatesBySolarsystemByWarzone =
    //       sm.RemoteSvc('fwWarzoneSolarsystem').GetAllWarzonesOccupationStates()
    //   for occupationStatesBySolarsystem in
    //       occupationStatesBySolarsystemByWarzone.itervalues():
    //
    // The no-warzone-data case therefore needs to be an empty dict, not None
    // or an empty list.
    return { type: "dict", entries: [] };
  }

  Handle_GetAllWarzonesOccupationStatesUncached(args, session) {
    log.debug("[fwWarzoneSvc] GetAllWarzonesOccupationStatesUncached called");
    return { type: "dict", entries: [] };
  }

  Handle_GetLocalOccupationState(args, session) {
    log.debug("[fwWarzoneSvc] GetLocalOccupationState called");
    const solarSystemID =
      Number(
        args && args.length > 0
          ? args[0]
          : session && (session.solarsystemid2 || session.solarsystemid),
      ) || 0;

    // V23.02 expects a 2-tuple of:
    //   (solarSystemID, occupationState)
    // For non-warzone systems, the second slot must be None. Returning a
    // populated util.KeyVal here makes the client treat the current system as
    // faction warfare even when owner/occupier are null.
    return [solarSystemID, null];
  }
}

module.exports = FwWarzoneSolarsystemService;
