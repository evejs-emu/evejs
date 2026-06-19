const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const transitions = require(path.join(__dirname, "../../space/transitions"));
const structureState = require(path.join(__dirname, "./structureState"));

const USER_ERROR_LOCALIZATION_LABEL = 101;
const SHIP_TOO_LARGE_LABEL = "UI/Station/StationManagment/ShipTooLarge";

function normalizePositiveInt(value, fallback = 0) {
  const numericValue = normalizeNumber(value, fallback);
  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : fallback;
}

function getSessionShipID(session) {
  return normalizePositiveInt(
    session &&
      (
        (session._space && session._space.shipID) ||
        session.activeShipID ||
        session.shipID ||
        session.shipid
      ),
    0,
  );
}

function throwDockingDenied(errorMsg = "") {
  switch (String(errorMsg || "").trim()) {
    case "DOCKING_APPROACH_REQUIRED":
      throwWrappedUserError("DockingApproach");
      break;
    case "SHIP_TOO_LARGE_FOR_STRUCTURE":
      throwWrappedUserError("DockingRequestDenied", {
        reason: [USER_ERROR_LOCALIZATION_LABEL, SHIP_TOO_LARGE_LABEL],
      });
      break;
    case "STRUCTURE_DOCKING_DENIED":
      throwWrappedUserError("DockingRequestDenied", {
        reason: "Structure docking access denied.",
      });
      break;
    case "STRUCTURE_DOCKING_UNAVAILABLE":
      throwWrappedUserError("DockingRequestDenied", {
        reason: "Structure docking is unavailable.",
      });
      break;
    case "SHIP_EXCLUDED_FROM_STRUCTURE":
      throwWrappedUserError("DockingRequestDenied", {
        reason: "This ship cannot dock at this structure.",
      });
      break;
    case "CRIMINAL_TIMER_ACTIVE":
      throwWrappedUserError("CustomInfo", {
        info: "Docking is disabled while the criminal timer is active.",
      });
      break;
    case "NOT_IN_SPACE":
    case "SHIP_NOT_FOUND":
    case "SCENE_NOT_FOUND":
      throwWrappedUserError("DeniedShipChanged");
      break;
    case "STRUCTURE_NOT_FOUND":
    case "STATION_NOT_FOUND":
      throwWrappedUserError("TargetingAttemptCancelled");
      break;
    default:
      throwWrappedUserError("DockingRequestDenied", {
        reason: "Docking request denied.",
      });
      break;
  }
}

class StructureDockingService extends BaseService {
  constructor() {
    super("structureDocking");
  }

  Handle_Dock(args, session) {
    const structureID = normalizePositiveInt(args && args[0], 0);
    const requestedShipID = normalizePositiveInt(args && args[1], 0);
    const activeShipID = getSessionShipID(session);

    log.info(
      `[StructureDocking] Dock char=${session && session.characterID} structure=${structureID} ship=${requestedShipID || activeShipID || 0}`,
    );

    if (requestedShipID > 0 && activeShipID > 0 && requestedShipID !== activeShipID) {
      throwWrappedUserError("DeniedShipChanged");
    }

    const structure = structureState.getStructureByID(structureID, {
      refresh: false,
    });
    if (!structure) {
      throwDockingDenied("STRUCTURE_NOT_FOUND");
    }

    const dockCheck = structureState.canCharacterDockAtStructure(session, structure, {
      shipTypeID: session && session.shipTypeID,
    });
    if (!dockCheck.success) {
      throwDockingDenied(dockCheck.errorMsg);
    }

    if (!spaceRuntime.canDockAtStation(session, structureID)) {
      spaceRuntime.followBall(session, structureID, 2500, {
        dockingTargetID: structureID,
      });
      throwDockingDenied("DOCKING_APPROACH_REQUIRED");
    }

    const result = spaceRuntime.acceptDocking(session, structureID);
    if (!result || !result.success) {
      throwDockingDenied(result && result.errorMsg);
    }

    return result.data ? result.data.acceptedAtFileTime || null : null;
  }

  Handle_Undock(args, session) {
    const structureID = normalizePositiveInt(args && args[0], 0);
    const requestedShipID = normalizePositiveInt(args && args[1], 0);
    const activeShipID = getSessionShipID(session);

    log.info(
      `[StructureDocking] Undock char=${session && session.characterID} structure=${structureID} ship=${requestedShipID || activeShipID || 0}`,
    );

    if (
      structureID > 0 &&
      normalizePositiveInt(session && (session.structureID || session.structureid), 0) > 0 &&
      structureID !== normalizePositiveInt(session && (session.structureID || session.structureid), 0)
    ) {
      throwWrappedUserError("DeniedShipChanged");
    }

    if (requestedShipID > 0 && activeShipID > 0 && requestedShipID !== activeShipID) {
      throwWrappedUserError("DeniedShipChanged");
    }

    const result = transitions.undockSession(session);
    if (!result || !result.success) {
      log.warn(
        `[StructureDocking] Undock failed for char=${session && session.characterID}: ${(result && result.errorMsg) || "UNKNOWN_ERROR"}`,
      );
      return null;
    }

    return result.data ? result.data.boundResult || null : null;
  }
}

module.exports = StructureDockingService;
