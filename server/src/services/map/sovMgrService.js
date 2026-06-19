const BaseService = require("../baseService");
const log = require("../../utils/logger");
const {
  buildList,
} = require("../_shared/serviceHelpers");
const {
  getInfrastructureHubClaim,
  getSystemSovClaim,
  listSovStructuresForSystem,
} = require("../sovereignty/sovState");
const {
  acquireSkyhooks,
  destroySkyhooks,
  getFuelAccessGroupID,
  isOnLocalFuelAccessGroup,
  setFuelAccessGroupID,
} = require("../sovereignty/sovModernState");
const {
  buildSovClaimInfoPayload,
  buildSovHubInfoPayload,
  buildSovStructuresPayload,
} = require("../sovereignty/sovPayloads");

class SovMgrService extends BaseService {
  constructor() {
    super("sovMgr");
  }

  Handle_GetSovStructuresInfoForLocalSolarSystem(args, session) {
    const solarSystemID =
      Number(session && (session.solarsystemid2 || session.solarsystemid)) || 0;
    log.debug(
      `[SovMgr] GetSovStructuresInfoForLocalSolarSystem called (solarsystemid=${solarSystemID})`,
    );

    // solar4.txt shows the client iterates this result directly in the
    // inflight info panel. Returning None crashes with:
    //   TypeError: 'NoneType' object is not iterable
    // An empty list is the safe no-structures contract.
    return buildSovStructuresPayload(listSovStructuresForSystem(solarSystemID));
  }

  Handle_GetSovStructuresInfoForSolarSystem(args, session) {
    const solarSystemID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    log.debug(
      `[SovMgr] GetSovStructuresInfoForSolarSystem called (solarsystemid=${solarSystemID})`,
    );
    return buildSovStructuresPayload(listSovStructuresForSystem(solarSystemID));
  }

  Handle_GetSystemSovereigntyInfo(args, session) {
    const solarSystemID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    return buildSovClaimInfoPayload(getSystemSovClaim(solarSystemID));
  }

  Handle_GetInfrastructureHubInfo(args, session) {
    const solarSystemID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    return buildSovHubInfoPayload(getInfrastructureHubClaim(solarSystemID));
  }

  Handle_GetSovHubFuelAccessGroup(args, session) {
    const solarSystemID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    return getFuelAccessGroupID(solarSystemID);
  }

  Handle_SetSovHubFuelAccessGroup(args, session) {
    const solarSystemID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    const fuelAccessGroupID = Number(args && args.length > 1 ? args[1] : 0) || null;
    return setFuelAccessGroupID(solarSystemID, fuelAccessGroupID);
  }

  Handle_IsOnLocalSovHubFuelAccessGroup(args, session) {
    return isOnLocalFuelAccessGroup(session);
  }

  Handle_DestroySkyhooks(args, session) {
    return buildList(destroySkyhooks(args && args[0]));
  }

  Handle_AcquireSkyhooks(args, session) {
    return buildList(acquireSkyhooks(args && args[0], args && args[1], session));
  }

  callMethod(method, args, session, kwargs) {
    const response = super.callMethod(method, args, session, kwargs);
    if (response !== null) {
      return response;
    }

    log.warn(`[SovMgr] Unhandled method fallback: ${method}`);
    return { type: "list", items: [] };
  }
}

module.exports = SovMgrService;
