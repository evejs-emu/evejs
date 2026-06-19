const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildDict,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const structureState = require(path.join(__dirname, "./structureState"));
const {
  buildAccessibleStructureServices,
  characterHasStructureService,
  characterHasStructureSetting,
} = require(path.join(__dirname, "./structurePayloads"));

class StructureSettingsService extends BaseService {
  constructor() {
    super("structureSettings");
  }

  Handle_CharacterGetServices(args, session) {
    const structureID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const structure = structureState.getStructureByID(structureID);
    const services = buildAccessibleStructureServices(structure, session);
    return buildDict(
      Object.entries(services)
        .map(([serviceID, stateID]) => [Number(serviceID) || 0, stateID])
        .filter(([serviceID]) => serviceID > 0)
        .sort((left, right) => left[0] - right[0]),
    );
  }

  Handle_CharacterHasService(args, session) {
    const structureID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const serviceID = Array.isArray(args) && args.length > 1 ? args[1] : null;
    const structure = structureState.getStructureByID(structureID);
    return characterHasStructureService(session, structure, serviceID);
  }

  Handle_CharacterGetService(args, session) {
    return this.Handle_CharacterHasService(args, session);
  }

  Handle_CharacterCheckService(args, session) {
    return this.Handle_CharacterHasService(args, session);
  }

  Handle_CharacterHasSetting(args, session) {
    const structureID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const settingID = Array.isArray(args) && args.length > 1 ? args[1] : null;
    const structure = structureState.getStructureByID(structureID);
    return characterHasStructureSetting(session, structure, settingID);
  }
}

module.exports = StructureSettingsService;
