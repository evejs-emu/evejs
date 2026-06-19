const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildDict,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  buildFacilityPayload,
  buildLocationPayload,
  buildFacilityTaxesPayload,
} = require(path.join(__dirname, "./industryPayloads"));
const {
  getFacilityPayloadByID,
  listFacilitiesForSession,
} = require(path.join(__dirname, "./industryStaticData"));
const {
  getFacilityTaxConfig,
  setFacilityTaxConfig,
} = require(path.join(__dirname, "./industryFacilityState"));
const {
  getBlueprintByItemID,
  resolveFacilityLocations,
} = require(path.join(__dirname, "./industryRuntimeState"));
const {
  INDUSTRY_ACTIVITY,
} = require(path.join(__dirname, "./industryConstants"));
const {
  notifyFacilitiesUpdated,
} = require(path.join(__dirname, "./industryNotifications"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

class FacilityManagerService extends BaseService {
  constructor() {
    super("facilityManager");
  }

  Handle_GetFacilities(args, session) {
    return buildList(
      listFacilitiesForSession(session).map((facility) => buildFacilityPayload(facility)),
    );
  }

  Handle_GetFacility(args) {
    const facilityID = args && args.length > 0 ? args[0] : null;
    return buildFacilityPayload(getFacilityPayloadByID(facilityID) || {});
  }

  Handle_GetFacilitiesByID(args) {
    const facilityIDs = Array.isArray(args && args[0]) ? args[0] : [];
    return buildList(
      facilityIDs
        .map((facilityID) => getFacilityPayloadByID(facilityID))
        .filter(Boolean)
        .map((facility) => buildFacilityPayload(facility)),
    );
  }

  Handle_GetMaxActivityModifiers() {
    return buildDict([
      [INDUSTRY_ACTIVITY.MANUFACTURING, 1.0],
    ]);
  }

  Handle_GetFacilityTaxes(args) {
    const facilityID = args && args.length > 0 ? args[0] : null;
    const facility = getFacilityPayloadByID(facilityID);
    return buildFacilityTaxesPayload(getFacilityTaxConfig(facilityID, facility));
  }

  Handle_SetFacilityTaxes(args, session) {
    const facilityID = args && args.length > 0 ? args[0] : null;
    const corporationID = args && args.length > 1 ? args[1] : null;
    const taxRateValues = args && args.length > 2 ? args[2] : null;
    const facility = getFacilityPayloadByID(facilityID);
    setFacilityTaxConfig(session, facility, corporationID, taxRateValues);
    notifyFacilitiesUpdated([toInt(facilityID, 0)]);
    return null;
  }

  Handle_GetFacilityLocations(args, session) {
    const facilityID = args && args.length > 0 ? args[0] : null;
    const ownerID = args && args.length > 1 ? args[1] : null;
    const blueprint = args && args.length > 2 ? getBlueprintByItemID(args[2]) : null;
    return buildList(
      resolveFacilityLocations(
        toInt(facilityID, 0),
        toInt(ownerID, 0),
        blueprint,
        session,
      ).map((location) => buildLocationPayload(location)),
    );
  }
}

module.exports = FacilityManagerService;
