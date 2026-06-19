const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const { buildAdvertMapPayload, buildAdvertPayload } = require(path.join(
  __dirname,
  "./fleetPayloads",
));
const fleetRuntime = require(path.join(__dirname, "./fleetRuntime"));

class FleetProxyService extends BaseService {
  constructor() {
    super("fleetProxy");
  }

  Handle_GetAvailableFleetAds(args, session) {
    return buildAdvertMapPayload(
      fleetRuntime.getAvailableFleetAds(session),
    );
  }

  Handle_ApplyToJoinFleet(args, session) {
    return fleetRuntime.applyToJoinFleet(
      session,
      args && args[0],
      args && args[1],
    );
  }

  Handle_AddFleetFinderAdvert(args, session) {
    const advert = fleetRuntime.addFleetFinderAdvert(session, args && args[0]);
    return advert ? buildAdvertPayload(advert) : null;
  }

  Handle_RemoveFleetFinderAdvert(args, session) {
    const advert = fleetRuntime.removeFleetFinderAdvert(session);
    return advert ? buildAdvertPayload(advert) : null;
  }

  Handle_GetMyFleetFinderAdvert(args, session) {
    const advert = fleetRuntime.getMyFleetFinderAdvert(session);
    return advert ? buildAdvertPayload(advert) : null;
  }

  Handle_UpdateAdvertInfo(args, session) {
    const advert = fleetRuntime.updateAdvertInfo(
      session,
      args && args[0],
      args && args[1] ? args[1] : {},
    );
    return advert ? buildAdvertPayload(advert) : null;
  }

  Handle_UpdateAdvertAllowedEntities(args, session) {
    const advert = fleetRuntime.updateAdvertAllowedEntities(
      session,
      args && args[0] ? args[0] : {},
    );
    return advert ? buildAdvertPayload(advert) : null;
  }

  Handle_UpdateFleetAdvertWithNewLeader(args, session) {
    const advert = fleetRuntime.updateFleetAdvertWithNewLeader(
      session,
      args && args[0] ? args[0] : {},
    );
    return advert ? buildAdvertPayload(advert) : null;
  }
}

module.exports = FleetProxyService;
