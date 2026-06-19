const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  extractList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const structureState = require(path.join(__dirname, "./structureState"));
const {
  TYPE_ANSIBLEX_JUMP_BRIDGE,
} = require(path.join(__dirname, "../sovereignty/sovUpgradeSupport"));
const {
  buildIDList,
  buildStructureInfoDict,
  buildStructureInfoPayload,
  buildStructureMapList,
} = require(path.join(__dirname, "./structurePayloads"));
const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
} = require(path.join(__dirname, "./structureConstants"));

function normalizePositiveInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function getCurrentSolarSystemID(session) {
  return normalizePositiveInt(
    session &&
      (
        (session._space && session._space.systemID) ||
        session.solarsystemid2 ||
        session.solarsystemid
      ),
    0,
  );
}

function listRequestedStructures(args, options = {}) {
  const ids = extractList(Array.isArray(args) && args.length > 0 ? args[0] : []);
  if (ids.length === 0) {
    return [];
  }

  return ids
    .map((structureID) => structureState.getStructureByID(structureID, {
      refresh: options.refresh !== false,
    }))
    .filter(Boolean);
}

function buildKeyVal(entries = []) {
  return {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries,
    },
  };
}

class StructureDirectoryService extends BaseService {
  constructor() {
    super("structureDirectory");
  }

  callMethod(method, args, session, kwargs) {
    const handlerName = `Handle_${method}`;
    if (
      typeof this[handlerName] === "function" ||
      typeof this[method] === "function"
    ) {
      return super.callMethod(method, args, session, kwargs);
    }

    // The modern client probes several structure-directory reads while
    // building station/system UI. Returning null here bubbles into
    // client-side `structures = None` errors in map/surroundings code.
    if (typeof method === "string" && method.startsWith("Get")) {
      log.debug(
        `[StructureDirectoryService] Fallback empty result for ${method}`,
      );
      return { type: "list", items: [] };
    }

    return super.callMethod(method, args, session, kwargs);
  }

  Handle_GetStructureInfo(args, session, kwargs) {
    const structureID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const structure = structureState.getStructureByID(structureID);
    log.debug(`[StructureDirectoryService] GetStructureInfo structure=${String(structureID)}`);
    return structure ? buildStructureInfoPayload(structure, session) : null;
  }

  Handle_GetStructureInfo_(args, session, kwargs) {
    return this.Handle_GetStructureInfo(args, session, kwargs);
  }

  Handle_GetMyCharacterStructures(args, session, kwargs) {
    const structures = structureState.listDockableStructuresForCharacter(session);
    log.debug(`[StructureDirectoryService] GetMyCharacterStructures count=${structures.length}`);
    return buildStructureInfoDict(structures, session);
  }

  Handle_GetMyCorporationStructures(args, session, kwargs) {
    const corpID = normalizePositiveInt(
      session && (session.corporationID || session.corpid),
      0,
    );
    const structures = corpID > 0 ? structureState.listOwnedStructures(corpID) : [];
    log.debug(`[StructureDirectoryService] GetMyCorporationStructures count=${structures.length}`);
    return buildStructureInfoDict(structures, session, {
      includeAccessibleServices: false,
    });
  }

  Handle_GetCorporationStructures(args, session, kwargs) {
    return this.Handle_GetMyCorporationStructures(args, session, kwargs);
  }

  Handle_GetMyDockableStructures(args, session, kwargs) {
    const solarSystemID = normalizePositiveInt(
      Array.isArray(args) && args.length > 0 ? args[0] : getCurrentSolarSystemID(session),
      getCurrentSolarSystemID(session),
    );
    const structures = structureState.listDockableStructuresForCharacter(session, {
      solarSystemID,
    });
    log.debug(`[StructureDirectoryService] GetMyDockableStructures count=${structures.length} system=${solarSystemID}`);
    return buildIDList(structures.map((structure) => structure.structureID));
  }

  Handle_GetStructures(args, session, kwargs) {
    const structures = listRequestedStructures(args);
    log.debug(`[StructureDirectoryService] GetStructures count=${structures.length}`);
    return buildStructureInfoDict(structures, session);
  }

  Handle_GetStructuresInSystem(args, session, kwargs) {
    const solarSystemID = normalizePositiveInt(
      Array.isArray(args) && args.length > 0 ? args[0] : getCurrentSolarSystemID(session),
      getCurrentSolarSystemID(session),
    );
    const structures = structureState.listStructuresForSystem(solarSystemID);
    log.debug(`[StructureDirectoryService] GetStructuresInSystem count=${structures.length} system=${solarSystemID}`);
    return buildStructureInfoDict(structures, session);
  }

  Handle_GetSolarsystemStructures(args, session, kwargs) {
    return this.Handle_GetStructuresInSystem(args, session, kwargs);
  }

  Handle_GetStructureMapData(args, session, kwargs) {
    const solarSystemID = normalizePositiveInt(
      Array.isArray(args) && args.length > 0 ? args[0] : getCurrentSolarSystemID(session),
      getCurrentSolarSystemID(session),
    );
    const structures = structureState.listStructuresForSystem(solarSystemID);
    log.debug(`[StructureDirectoryService] GetStructureMapData count=${structures.length} system=${solarSystemID}`);
    return buildStructureMapList(structures);
  }

  Handle_CheckMyDockingAccessToStructures(args, session, kwargs) {
    const requested = listRequestedStructures(args);
    const allowed = requested
      .filter((structure) => structureState.canCharacterDockAtStructure(session, structure).success)
      .map((structure) => structure.structureID);
    log.debug(`[StructureDirectoryService] CheckMyDockingAccessToStructures requested=${requested.length} allowed=${allowed.length}`);
    return buildIDList(allowed);
  }

  Handle_GetMyAccessibleOnlineCynoBeaconStructures(args, session, kwargs) {
    const structures = structureState.listStructures()
      .filter((structure) => (
        Number(
          structure.serviceStates &&
          structure.serviceStates[String(STRUCTURE_SERVICE_ID.CYNO_BEACON)],
        ) === STRUCTURE_SERVICE_STATE.ONLINE &&
        structureState.canCharacterDockAtStructure(session, structure, {
          ignoreRestrictions: structureState.hasStructureGmBypass(session),
        }).success
      ));
    log.debug(`[StructureDirectoryService] GetMyAccessibleOnlineCynoBeaconStructures count=${structures.length}`);
    return buildIDList(structures.map((structure) => structure.structureID));
  }

  Handle_GetSolarSystemsWithBeacons(args, session, kwargs) {
    const systemIDs = structureState.listStructures()
      .filter((structure) => (
        Number(
          structure.serviceStates &&
          structure.serviceStates[String(STRUCTURE_SERVICE_ID.CYNO_BEACON)],
        ) === STRUCTURE_SERVICE_STATE.ONLINE
      ))
      .map((structure) => structure.solarSystemID);
    log.debug(`[StructureDirectoryService] GetSolarSystemsWithBeacons count=${systemIDs.length}`);
    return buildIDList(systemIDs);
  }

  Handle_GetValidWarHQs(args, session, kwargs) {
    const ownerID = normalizePositiveInt(Array.isArray(args) && args.length > 0 ? args[0] : null, 0);
    const structures = structureState.listStructures()
      .filter((structure) => (
        normalizePositiveInt(structure.ownerCorpID || structure.ownerID, 0) === ownerID &&
        !structure.destroyedAt
      ));
    log.debug(`[StructureDirectoryService] GetValidWarHQs owner=${ownerID} count=${structures.length}`);
    return buildIDList(structures.map((structure) => structure.structureID));
  }

  Handle_GetJumpBridgesWithMyAccess(args, session, kwargs) {
    log.debug("[StructureDirectoryService] GetJumpBridgesWithMyAccess called");

    // Decompiled V23.02 mapView.py uses:
    //   jumpBridgesGates, hasAccessTo, hasNoAccessTo =
    //       sm.GetService('map').GetJumpBridgesWithMyAccess()
    //
    // The empty-state contract therefore needs three top-level values:
    //   1. jumpBridgesGates -> iterable of (structureA, structureB) pairs
    //   2. hasAccessTo      -> iterable of structure IDs with access
    //   3. hasNoAccessTo    -> iterable of structure IDs without access
    //
    // Returning a plain empty list triggers:
    //   ValueError: need more than 0 values to unpack
    // Returning only two values triggers:
    //   ValueError: need more than 2 values to unpack
    //
    // The client only performs iterable membership checks against the access
    // collections, so empty lists are sufficient for the no-data case here.
    return [
      { type: "list", items: [] },
      { type: "list", items: [] },
      { type: "list", items: [] },
    ];
  }

  Handle_GetNearbyJumpBridges(args, session, kwargs) {
    const currentSolarSystemID = getCurrentSolarSystemID(session);
    const structures = structureState.listStructures({
      includeDestroyed: false,
      refresh: false,
    }).filter((structure) => (
      Number(structure && structure.typeID) === TYPE_ANSIBLEX_JUMP_BRIDGE &&
      !structure.destroyedAt
    ));

    return {
      type: "list",
      items: structures.map((structure) => {
        const devFlags =
          structure && structure.devFlags && typeof structure.devFlags === "object"
            ? structure.devFlags
            : {};
        const destinationSolarsystemID = normalizePositiveInt(
          devFlags.destinationSolarsystemID ||
          devFlags.sovereigntyJumpBridgeDestinationSolarsystemID,
          0,
        );
        return buildKeyVal([
          ["structureID", Number(structure.structureID || 0)],
          ["solarSystemID", Number(structure.solarSystemID || 0)],
          ["ownerID", Number(structure.ownerCorpID || structure.ownerID || 0)],
          ["structureName", String(structure.itemName || structure.name || "Ansiblex Jump Bridge")],
          ["destinationSolarsystemID", destinationSolarsystemID || null],
          ["alignedToCurrentSystem", destinationSolarsystemID > 0 && destinationSolarsystemID === currentSolarSystemID],
        ]);
      }),
    };
  }
}

module.exports = StructureDirectoryService;
