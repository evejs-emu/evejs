const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const {
  clearDeferredDockedShipSessionChange,
  clearDockedFittingBootstrap,
} = require(path.join(__dirname, "../character/characterState"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const structureState = require(path.join(__dirname, "./structureState"));
const {
  STRUCTURE_SETTING_ID,
  characterHasStructureSetting,
} = require(path.join(__dirname, "./structurePayloads"));
const {
  normalizePositiveInt,
  getSessionStructureID,
  getStructurePilotCharacterID,
  relinquishStructureControl,
  assumeStructureControl,
} = require(path.join(__dirname, "./structureControlState"));

function throwControlDenied(errorMsg = "") {
  switch (String(errorMsg || "").trim()) {
    case "NOT_DOCKED_IN_STRUCTURE":
      throwWrappedUserError("CustomNotify", {
        notify: "You must be docked in this structure to take control.",
      });
      break;
    case "STRUCTURE_CONTROL_DENIED":
      throwWrappedUserError("StructureDefenseDenied");
      break;
    case "STRUCTURE_NOT_FOUND":
      throwWrappedUserError("TargetingAttemptCancelled");
      break;
    default:
      throwWrappedUserError("CustomNotify", {
        notify: "Unable to assume structure control.",
      });
      break;
  }
}

function clearStructureControlDockedBootstrapState(session) {
  if (!session) {
    return;
  }

  clearDeferredDockedShipSessionChange(session);
  clearDockedFittingBootstrap(session);
}

class StructureControlService extends BaseService {
  constructor() {
    super("structureControl");
  }

  Handle_GetStructurePilot(args, session) {
    const structureID = normalizePositiveInt(args && args[0], 0);
    return getStructurePilotCharacterID(structureID) || null;
  }

  Handle_TakeControl(args, session) {
    const structureID = normalizePositiveInt(
      args && args[0],
      getSessionStructureID(session),
    );
    const structure = structureState.getStructureByID(structureID, {
      refresh: false,
    });
    if (!structure) {
      throwControlDenied("STRUCTURE_NOT_FOUND");
    }

    if (getSessionStructureID(session) !== structureID) {
      throwControlDenied("NOT_DOCKED_IN_STRUCTURE");
    }

    if (!characterHasStructureSetting(
      session,
      structure,
      STRUCTURE_SETTING_ID.DEFENSE_CAN_CONTROL_STRUCTURE,
    )) {
      throwControlDenied("STRUCTURE_CONTROL_DENIED");
    }

    const result = assumeStructureControl(session, structureID, {
      solarSystemID: structure.solarSystemID,
    });
    if (!result.success) {
      throwControlDenied(result.errorMsg);
    }

    clearStructureControlDockedBootstrapState(session);
    return null;
  }

  Handle_ReleaseControl(args, session) {
    relinquishStructureControl(session, {
      reason: "release",
    });
    clearStructureControlDockedBootstrapState(session);
    spaceRuntime.clearDockedStructureView(session);
    return null;
  }
}

module.exports = StructureControlService;
