const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const {
  buildBoundObjectResponse,
  buildKeyVal,
  buildList,
  buildRowset,
  resolveBoundNodeId,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getStationRecord,
  getStationServiceIdentifiers,
  getStationServiceStates,
  getStationServiceAccessRule,
  getStationManagementServiceCostModifiers,
  getRentableItems,
} = require(path.join(__dirname, "../_shared/stationStaticData"));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));
const {
  getCharacterEffectiveStanding,
} = require(path.join(__dirname, "../character/standingRuntime"));
const {
  getCorporationOffices,
  getOfficesAtStation,
  normalizePositiveInteger,
  updateCorporationRecord,
} = require(path.join(__dirname, "./corporationRuntimeState"));

function resolveCorporationID(session) {
  return (session && (session.corporationID || session.corpid)) || 0;
}

function resolveStationID(args, session) {
  return normalizePositiveInteger(
    (args && args[0]) ||
      (session &&
        (session.stationID ||
          session.stationid ||
          session.structureID ||
          session.structureid)),
    null,
  );
}

function listStationOffices(stationID) {
  return getOfficesAtStation(stationID);
}

class CorpStationMgrService extends BaseService {
  constructor() {
    super("corpStationMgr");
  }

  Handle_MachoResolveObject() {
    log.debug("[CorpStationMgr] MachoResolveObject");
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    log.debug("[CorpStationMgr] MachoBindObject");
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetStationServiceStates(args, session) {
    log.debug("[CorpStationMgr] GetStationServiceStates");
    return {
      type: "dict",
      entries: getStationServiceStates(session).map((row) => [
        row.serviceID,
        buildKeyVal([
          ["solarSystemID", row.solarSystemID],
          ["stationID", row.stationID],
          ["serviceID", row.serviceID],
          ["stationServiceItemID", row.stationServiceItemID],
          ["isEnabled", row.isEnabled],
        ]),
      ]),
    };
  }

  Handle_GetImprovementStaticData() {
    log.debug("[CorpStationMgr] GetImprovementStaticData");
    return buildKeyVal([["improvementTypes", buildRowset([], [], "eve.common.script.sys.rowset.Rowset")]]);
  }

  Handle_GetStationServiceIdentifiers() {
    log.debug("[CorpStationMgr] GetStationServiceIdentifiers");
    return buildRowset(
      ["serviceID", "serviceName", "serviceNameID"],
      getStationServiceIdentifiers().map((service) =>
        buildList([
          service.serviceID,
          service.serviceName,
          service.serviceNameID,
        ]),
      ),
      "eve.common.script.sys.rowset.Rowset",
    );
  }

  Handle_GetStationDetails(args, session) {
    const stationID = args && args.length > 0 ? args[0] : null;
    log.debug(`[CorpStationMgr] GetStationDetails(${stationID})`);
    const station = getStationRecord(session, stationID);
    return buildKeyVal([
      ["stationName", station.stationName],
      ["stationID", station.stationID],
      ["orbitID", station.orbitID],
      ["description", station.description],
      ["security", station.security],
      ["dockingCostPerVolume", station.dockingCostPerVolume],
      ["officeRentalCost", station.officeRentalCost],
      ["reprocessingStationsTake", station.reprocessingStationsTake],
      ["reprocessingHangarFlag", station.reprocessingHangarFlag],
      ["corporationID", station.corporationID],
      ["maxShipVolumeDockable", station.maxShipVolumeDockable],
      ["exitTime", null],
      ["standingOwnerID", station.ownerID],
      ["upgradeLevel", station.upgradeLevel],
    ]);
  }

  Handle_GetStationServiceAccessRule(args, session) {
    const serviceID =
      args && args.length > 1 ? args[1] : args && args.length > 0 ? args[0] : 0;
    log.debug(`[CorpStationMgr] GetStationServiceAccessRule(${serviceID})`);
    const station = getStationRecord(session);
    const rule = getStationServiceAccessRule(serviceID, station && station.ownerID);
    return buildKeyVal([
      ["serviceID", rule.serviceID],
      ["minimumStanding", rule.minimumStanding],
      ["minimumCharSecurity", rule.minimumCharSecurity],
      ["maximumCharSecurity", rule.maximumCharSecurity],
      ["minimumCorpSecurity", rule.minimumCorpSecurity],
      ["maximumCorpSecurity", rule.maximumCorpSecurity],
    ]);
  }

  Handle_GetStationManagementServiceCostModifiers() {
    log.debug("[CorpStationMgr] GetStationManagementServiceCostModifiers");
    return buildRowset(
      [
        "serviceID",
        "discountPerGoodStandingPoint",
        "surchargePerBadStandingPoint",
      ],
      getStationManagementServiceCostModifiers().map((row) =>
        buildList([
          row.serviceID,
          row.discountPerGoodStandingPoint,
          row.surchargePerBadStandingPoint,
        ]),
      ),
      "eve.common.script.sys.rowset.Rowset",
    );
  }

  Handle_GetRentableItems(args, session) {
    log.debug("[CorpStationMgr] GetRentableItems");
    return buildRowset(
      ["stationID", "typeID", "rentedToID", "publiclyAvailable"],
      getRentableItems(session).map((row) =>
        buildList([
          row.stationID,
          row.typeID,
          row.rentedToID,
          Boolean(row.publiclyAvailable),
        ]),
      ),
      "eve.common.script.sys.rowset.Rowset",
    );
  }

  Handle_DoStandingCheckForStationService(args, session) {
    const serviceID = args && args.length > 0 ? args[0] : 0;
    log.debug(`[CorpStationMgr] DoStandingCheckForStationService(${serviceID})`);
    const stationID = resolveStationID(args, session);
    const station = getStationRecord(session, stationID);
    const ownerID = station && station.ownerID ? station.ownerID : null;
    const rule = getStationServiceAccessRule(serviceID, ownerID);
    if (!rule || !ownerID) {
      return null;
    }

    const minimumStanding = Number(rule.minimumStanding) || 0;
    const minimumCharSecurity = Number(rule.minimumCharSecurity) || 0;
    const maximumCharSecurity = Number(rule.maximumCharSecurity) || 0;
    const characterID = normalizePositiveInteger(
      (args && args.length > 1 ? args[1] : null) ||
        (session && (session.characterID || session.charid)),
      0,
    );
    const resolvedCharacterID = characterID || 0;

    if (resolvedCharacterID) {
      const effectiveStanding = getCharacterEffectiveStanding(
        resolvedCharacterID,
        ownerID,
      ).standing;
      if (minimumStanding !== 0 && effectiveStanding < minimumStanding) {
        throwWrappedUserError("CustomNotify", {
          notify: "Your standings are too low to access this service.",
        });
      }

      const character = getCharacterRecord(resolvedCharacterID);
      const securityStatus = Number(
        character && (character.securityStatus ?? character.securityRating ?? 0),
      );
      if (minimumCharSecurity !== 0 && securityStatus < minimumCharSecurity) {
        throwWrappedUserError("CustomNotify", {
          notify: "Your security status is too low to access this service.",
        });
      }
      if (maximumCharSecurity !== 0 && securityStatus > maximumCharSecurity) {
        throwWrappedUserError("CustomNotify", {
          notify: "Your security status is too high to access this service.",
        });
      }
    }

    return null;
  }

  Handle_GetNumberOfUnrentedOffices(args, session) {
    log.debug("[CorpStationMgr] GetNumberOfUnrentedOffices");
    return Math.max(0, 24 - listStationOffices(resolveStationID(args, session)).length);
  }

  Handle_GetQuoteForRentingAnOffice(args, session) {
    log.debug("[CorpStationMgr] GetQuoteForRentingAnOffice");
    return getStationRecord(session).officeRentalCost;
  }

  Handle_GetCorporateStationOffice(args, session) {
    log.debug("[CorpStationMgr] GetCorporateStationOffice");
    const corporationID = resolveCorporationID(session);
    const stationID = resolveStationID(args, session);
    const office = getCorporationOffices(corporationID).find(
      (entry) => Number(entry.stationID) === Number(stationID),
    );
    return buildRowset(
      ["corporationID", "itemID", "officeFolderID"],
      office
        ? [
            buildList([
              office.corporationID,
              office.itemID,
              office.officeFolderID,
            ]),
          ]
        : [],
      "eve.common.script.sys.rowset.Rowset",
    );
  }

  Handle_GetStationOffices(args, session) {
    log.debug("[CorpStationMgr] GetStationOffices");
    return buildRowset(
      ["corporationID", "itemID", "officeFolderID"],
      listStationOffices(resolveStationID(args, session)).map((office) =>
        buildList([office.corporationID, office.itemID, office.officeFolderID]),
      ),
      "eve.common.script.sys.rowset.Rowset",
    );
  }

  Handle_GetPotentialHomeStations(args, session) {
    log.debug("[CorpStationMgr] GetPotentialHomeStations");
    const station = getStationRecord(session);
    return {
      type: "list",
      items: [
        buildKeyVal([
          ["stationID", station.stationID],
          ["typeID", station.stationTypeID],
          ["serviceMask", 0],
        ]),
      ],
    };
  }

  Handle_GetOwnerIDsOfClonesAtStation() {
    log.debug("[CorpStationMgr] GetOwnerIDsOfClonesAtStation");
    return buildRowset(
      ["ownerID", "corporationID"],
      [],
      "eve.common.script.sys.rowset.Rowset",
    );
  }

  Handle_GetStationImprovements() {
    log.debug("[CorpStationMgr] GetStationImprovements");
    return buildKeyVal([
      ["improvementTier2aTypeID", null],
      ["improvementTier3aTypeID", null],
      ["improvementTier1bTypeID", null],
      ["improvementTier1aTypeID", null],
      ["improvementTier2bTypeID", null],
      ["improvementTier1cTypeID", null],
    ]);
  }

  Handle_MoveCorpHQHere(args, session) {
    const stationID = resolveStationID(args, session);
    const corporationID = resolveCorporationID(session);
    if (!stationID || !corporationID) {
      return null;
    }
    updateCorporationRecord(corporationID, {
      stationID,
    });
    return null;
  }
}

module.exports = CorpStationMgrService;
