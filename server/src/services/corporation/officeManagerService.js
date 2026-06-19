const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildBoundObjectResponse,
  buildRowset,
  buildList,
  currentFileTime,
  resolveBoundNodeId,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getCorporationOffices,
  getOfficesAtStation,
  normalizePositiveInteger,
  updateRuntimeState,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  notifyOfficeRentalChange,
} = require(path.join(__dirname, "./corporationNotifications"));
const {
  getStationRecord,
} = require(path.join(__dirname, "../_shared/stationStaticData"));

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

function buildOfficeRowset(offices) {
  return buildRowset(
    [
      "corporationID",
      "stationID",
      "officeID",
      "officeFolderID",
      "itemID",
      "solarsystemID",
      "typeID",
      "stationTypeID",
    ],
    offices.map((office) =>
      buildList([
        office.corporationID,
        office.stationID,
        office.officeID,
        office.officeFolderID,
        office.itemID,
        office.solarSystemID,
        office.typeID ?? office.stationTypeID ?? null,
        office.stationTypeID ?? office.typeID ?? null,
      ]),
    ),
    "eve.common.script.sys.rowset.Rowset",
  );
}

function listStationOffices(stationID) {
  return getOfficesAtStation(stationID);
}

function createOfficeRecord(runtimeTable, corporationID, stationID) {
  const station = getStationRecord(null, stationID);
  const stationTypeID = normalizePositiveInteger(station && station.stationTypeID, null);
  const nextOfficeID = normalizePositiveInteger(runtimeTable._meta.nextOfficeID, 1) || 1;
  const nextOfficeFolderID =
    normalizePositiveInteger(runtimeTable._meta.nextOfficeFolderID, 1) || 1;
  const nextOfficeItemID =
    normalizePositiveInteger(runtimeTable._meta.nextOfficeItemID, 1) || 1;
  runtimeTable._meta.nextOfficeID = nextOfficeID + 1;
  runtimeTable._meta.nextOfficeFolderID = nextOfficeFolderID + 1;
  runtimeTable._meta.nextOfficeItemID = nextOfficeItemID + 1;
  return {
    corporationID,
    stationID,
    officeID: nextOfficeID,
    officeFolderID: nextOfficeFolderID,
    itemID: nextOfficeItemID,
    solarSystemID: normalizePositiveInteger(station && station.solarSystemID, null),
    typeID: stationTypeID,
    stationTypeID,
    rentalCost: Number((station && station.officeRentalCost) || 0),
    expiryDate: String(currentFileTime()),
    impounded: false,
  };
}

class OfficeManagerService extends BaseService {
  constructor() {
    super("officeManager");
  }

  Handle_MachoResolveObject() {
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetMyCorporationsOffices(args, session) {
    const corporationID = resolveCorporationID(session);
    const offices = getCorporationOffices(corporationID);
    log.debug(`[OfficeManager] GetMyCorporationsOffices(${corporationID}) -> ${offices.length}`);
    return buildOfficeRowset(offices);
  }

  Handle_GetCorporationsWithOffices(args, session) {
    const stationID = resolveStationID(args, session);
    return listStationOffices(stationID).map((office) => office.corporationID);
  }

  Handle_PrimeOfficeItem(args, session) {
    return null;
  }

  Handle_GetPriceQuote(args, session) {
    const station = getStationRecord(session, resolveStationID(args, session));
    return Number((station && station.officeRentalCost) || 0);
  }

  Handle_RentOffice(args, session) {
    const corporationID = resolveCorporationID(session);
    const stationID = resolveStationID(args, session);
    if (!corporationID || !stationID) {
      return null;
    }
    let changedOfficeID = null;
    updateRuntimeState((runtimeTable) => {
      const corporationRuntime = runtimeTable.corporations[String(corporationID)];
      if (!corporationRuntime) {
        return runtimeTable;
      }
      const existingOffice = Object.values(corporationRuntime.offices || {}).find(
        (office) => Number(office.stationID) === Number(stationID),
      );
      if (!existingOffice) {
        const office = createOfficeRecord(runtimeTable, corporationID, stationID);
        corporationRuntime.offices[String(office.officeID)] = office;
        changedOfficeID = office.officeID;
      }
      return runtimeTable;
    });
    if (changedOfficeID) {
      notifyOfficeRentalChange(corporationID, changedOfficeID);
    }
    return null;
  }

  Handle_UnrentOffice(args, session) {
    const corporationID = resolveCorporationID(session);
    const stationID = resolveStationID(args, session);
    const removedOfficeIDs = [];
    updateRuntimeState((runtimeTable) => {
      const corporationRuntime = runtimeTable.corporations[String(corporationID)];
      if (!corporationRuntime || !corporationRuntime.offices) {
        return runtimeTable;
      }
      for (const [officeID, office] of Object.entries(corporationRuntime.offices)) {
        if (Number(office.stationID) === Number(stationID)) {
          removedOfficeIDs.push(Number(officeID));
          delete corporationRuntime.offices[officeID];
        }
      }
      return runtimeTable;
    });
    for (const officeID of removedOfficeIDs) {
      notifyOfficeRentalChange(corporationID, officeID);
    }
    return null;
  }

  Handle_GetEmptyOfficeCount(args, session) {
    const stationID = resolveStationID(args, session);
    return Math.max(0, 24 - listStationOffices(stationID).length);
  }

  Handle_HasCorpImpoundedItems(args, session) {
    const corporationID = resolveCorporationID(session);
    const stationID = resolveStationID(args, session);
    return getCorporationOffices(corporationID).some(
      (office) =>
        Number(office.stationID) === Number(stationID) && Boolean(office.impounded),
    )
      ? 1
      : 0;
  }

  Handle_GetImpoundReleasePrice(args, session) {
    const corporationID = resolveCorporationID(session);
    const stationID = resolveStationID(args, session);
    const office = getCorporationOffices(corporationID).find(
      (entry) =>
        Number(entry.stationID) === Number(stationID) && Boolean(entry.impounded),
    );
    return office ? Number(office.rentalCost || 0) : 0;
  }

  Handle_GetItemsFromImpound(args, session) {
    const corporationID = resolveCorporationID(session);
    const stationID = resolveStationID(args, session);
    updateRuntimeState((runtimeTable) => {
      const corporationRuntime = runtimeTable.corporations[String(corporationID)];
      if (!corporationRuntime || !corporationRuntime.offices) {
        return runtimeTable;
      }
      for (const office of Object.values(corporationRuntime.offices)) {
        if (Number(office.stationID) === Number(stationID) && office.impounded) {
          office.impounded = false;
        }
      }
      return runtimeTable;
    });
    return null;
  }

  Handle_TrashImpoundedOffice(args, session) {
    const corporationID = resolveCorporationID(session);
    const stationID = resolveStationID(args, session);
    const removedOfficeIDs = [];
    updateRuntimeState((runtimeTable) => {
      const corporationRuntime = runtimeTable.corporations[String(corporationID)];
      if (!corporationRuntime || !corporationRuntime.offices) {
        return runtimeTable;
      }
      for (const [officeID, office] of Object.entries(corporationRuntime.offices)) {
        if (Number(office.stationID) === Number(stationID) && office.impounded) {
          removedOfficeIDs.push(Number(officeID));
          delete corporationRuntime.offices[officeID];
        }
      }
      return runtimeTable;
    });
    for (const officeID of removedOfficeIDs) {
      notifyOfficeRentalChange(corporationID, officeID);
    }
    return null;
  }
}

module.exports = OfficeManagerService;
