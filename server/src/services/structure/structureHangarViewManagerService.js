const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const structureState = require(path.join(__dirname, "./structureState"));
const {
  buildStructureHangarViewState,
} = require(path.join(__dirname, "./structureHangarViewState"));

function normalizePositiveInt(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : fallback;
}

class StructureHangarViewManagerService extends BaseService {
  constructor() {
    super("structureHangarViewMgr");
  }

  Handle_GetMyHangarViewState(args, session) {
    spaceRuntime.clearDockedStructureView(session);
    const structureID = normalizePositiveInt(
      session && (session.structureID || session.structureid),
      0,
    );

    if (!structureID) {
      log.warn(
        `[StructureHangarViewMgr] GetMyHangarViewState without structure session for char=${session && session.characterID}`,
      );
      return null;
    }

    const structure = structureState.getStructureByID(structureID, {
      refresh: false,
    });
    if (!structure) {
      log.warn(
        `[StructureHangarViewMgr] Missing structure ${structureID} for char=${session && session.characterID}`,
      );
      return null;
    }

    return buildStructureHangarViewState(structure);
  }
}

module.exports = StructureHangarViewManagerService;
