/**
 * Station Service (stationSvc)
 *
 * Handles station-related queries from the client.
 * Called after character selection to get info about the station
 * the character is docked in.
 * 
 * TODO: replace static return data (e.g. GetGuests) with accurate dynamic data.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  getStationRecord,
  buildStationServiceMask,
} = require(path.join(__dirname, "../_shared/stationStaticData"));
const { buildKeyVal } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const { getStationGuestTuples } = require(path.join(
  __dirname,
  "../_shared/guestLists",
));
const {
  listAllAllianceSystems,
  listAllianceSystems,
} = require(path.join(__dirname, "../sovereignty/sovState"));
const {
  buildAllianceSystemListPayload,
} = require(path.join(__dirname, "../sovereignty/sovPayloads"));

function stringifyForDebug(value) {
  return JSON.stringify(value, (_key, entry) => (
    typeof entry === "bigint" ? entry.toString() : entry
  ));
}

class StationService extends BaseService {
  constructor(name = "station") {
    super(name);
  }

  // the function below is never called! (not needed)
  Handle_GetStation(args, session) {
    if (log.isVerboseDebugEnabled()) {
      log.debug(`[StationSvc] GetStation session=${stringifyForDebug(session)}`);
      log.debug(`[StationSvc] GetStation args=${stringifyForDebug(args)}`);
    }

    const stationID = args && args.length > 0 ? args[0] : 60003760;
    const station = getStationRecord(session, stationID);
    log.info(`[StationSvc] GetStation(${stationID})`);

    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["stationID", station.stationID],
          ["stationName", station.stationName],
          ["stationTypeID", station.stationTypeID],
          ["solarSystemID", station.solarSystemID],
          ["constellationID", station.constellationID],
          ["regionID", station.regionID],
          ["ownerID", station.ownerID],
          ["corporationID", station.corporationID],
          ["dockingCostPerVolume", station.dockingCostPerVolume],
          ["maxShipVolumeDockable", Number(station.maxShipVolumeDockable)],
          ["officeRentalCost", station.officeRentalCost],
          ["operationID", station.operationID],
          ["stationTypeID", station.stationTypeID],
          ["security", station.security],
          ["x", 0.0],
          ["y", 0.0],
          ["z", 0.0],
          ["reprocessingEfficiency", 0.5],
          ["reprocessingStationsTake", station.reprocessingStationsTake],
          ["reprocessingHangarFlag", station.reprocessingHangarFlag],
          ["serviceMask", buildStationServiceMask()],
        ],
      },
    };
  }

  // args is an empty array for this function (at least on first load in the station)
  // for this function, we can send back the session data instead of static data
  Handle_GetStationItemBits(args, session) {
    log.debug(`[StationSvc] GetStationItemBits(${session.stationID})`);

    // The client builds a Row from this tuple:
    // ['ownerID', 'itemID', 'operationID', 'stationTypeID']

    // owner id (which should be a corporation (possibly faction)) is not in session data.
    // TODO: either set up database with all station data, or always return static data (same corp every time)
    const station = getStationRecord(session);
    const ownerID = station.ownerID;
    const stationID = station.stationID;
    const operationID = station.operationID;
    const stationTypeID = station.stationTypeID;

    return [ownerID, stationID, operationID, stationTypeID];
  }

  Handle_GetGuests(args, session) {
    log.debug("[StationSvc] GetGuests");
    const stationID =
      (session && (session.stationid || session.stationID)) || 0;

    return {
      type: "list",
      items: getStationGuestTuples(stationID),
    };
  }

  Handle_GetStationsForOwner(args, session) {
    const ownerID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    log.debug(`[StationSvc] GetStationsForOwner(${ownerID})`);

    if (!ownerID) {
      return {
        type: "list",
        items: [],
      };
    }

    const rows = worldData
      .getStationsForOwner(ownerID)
      .map((station) => getStationRecord(session, station.stationID))
      .map((station) =>
        buildKeyVal([
          ["stationID", Number(station.stationID) || 0],
          ["stationName", station.stationName || ""],
          ["solarSystemID", Number(station.solarSystemID) || 0],
          ["constellationID", Number(station.constellationID) || 0],
          ["regionID", Number(station.regionID) || 0],
          ["stationTypeID", Number(station.stationTypeID) || 0],
          ["ownerID", Number(station.ownerID) || ownerID],
          ["corporationID", Number(station.corporationID) || ownerID],
          ["security", Number(station.security || 0)],
        ])
      );

    return {
      type: "list",
      items: rows,
    };
  }

  Handle_GetAllianceSystems(args, session) {
    log.debug("[StationSvc] GetAllianceSystems");

    // Decompiled V23.02 starMapSvc.py does:
    //   allianceSystemCache = sm.RemoteSvc('stationSvc').GetAllianceSystems()
    //   for x in allianceSystemCache:
    //       allianceSolarSystems[x.solarSystemID] = x.allianceID
    //
    // Returning None crashes the StarMap faction filter path with:
    //   TypeError: 'NoneType' object is not iterable
    //
    // No alliance-held systems is therefore represented safely as an empty
    // iterable. When populated, each entry will need at least:
    //   solarSystemID
    //   allianceID
    return buildAllianceSystemListPayload(listAllAllianceSystems());
  }

  Handle_GetSystemsForAlliance(args, session) {
    const allianceID =
      Number(args && args.length > 0 ? args[0] : session && (session.allianceID || session.allianceid)) ||
      0;
    return buildAllianceSystemListPayload(listAllianceSystems(allianceID));
  }

  // TODO: make this work
  // find out what it wants
  Handle_GetSolarSystem(args, session) {
    log.debug("[StationSvc] GetSolarSystem");
    const station = getStationRecord(session);
    return buildKeyVal([
      ["solarSystemID", station.solarSystemID],
      ["solarSystemName", station.solarSystemName],
      ["constellationID", station.constellationID],
      ["constellationName", station.constellationName || ""],
      ["regionID", station.regionID],
      ["regionName", station.regionName || ""],
      ["security", Number(station.security || 0)],
      ["factionID", station.factionID || null],
      ["factionName", station.factionName || ""],
      ["stationID", station.stationID],
      ["stationName", station.stationName],
      ["ownerID", station.ownerID],
      ["ownerName", station.ownerName || station.corporationName || ""],
      ["corporationID", station.corporationID || station.ownerID],
      ["corporationName", station.corporationName || station.ownerName || ""],
      ["orbitID", station.orbitID || null],
      ["stationTypeID", station.stationTypeID || null],
    ]);
  }
}
class StationSvcAlias extends StationService {
  constructor() {
    super("stationSvc");
  }
}

module.exports = {
  StationService,
  StationSvcAlias,
};
