const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildPositionFromClientRequest,
  cancelStructureUnanchorByID,
  deployStructureFromInventoryItem,
  normalizeExtraConfig,
  unanchorStructureByID,
} = require(path.join(__dirname, "../sovereignty/sovPlayerDeployment"));

class StructureDeploymentService extends BaseService {
  constructor() {
    super("structureDeployment");
  }

  Handle_Anchor(args, session) {
    const itemID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const x = Array.isArray(args) && args.length > 1 ? args[1] : null;
    const z = Array.isArray(args) && args.length > 2 ? args[2] : null;
    const rotationYaw = Array.isArray(args) && args.length > 3 ? args[3] : null;
    const profileID = Array.isArray(args) && args.length > 4 ? args[4] : null;
    const structureName = Array.isArray(args) && args.length > 5 ? args[5] : "";
    const reinforceWeekday = Array.isArray(args) && args.length > 7 ? args[7] : null;
    const reinforceHour = Array.isArray(args) && args.length > 8 ? args[8] : null;
    const extraConfig = Array.isArray(args) && args.length > 9 ? args[9] : null;

    deployStructureFromInventoryItem(session, itemID, {
      position: buildPositionFromClientRequest(session, x, z),
      clientPositionOffset: {
        x: Number.isFinite(Number(x)) ? Number(x) : 0,
        y: 0,
        z: Number.isFinite(Number(z)) ? Number(z) : 0,
      },
      rotationYaw,
      profileID,
      structureName,
      reinforceWeekday,
      reinforceHour,
      ...normalizeExtraConfig(extraConfig),
    });
    return null;
  }

  Handle_Unanchor(args, session) {
    const structureID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    unanchorStructureByID(session, structureID);
    return null;
  }

  Handle_CancelUnanchor(args, session) {
    const structureID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    cancelStructureUnanchorByID(session, structureID);
    return null;
  }
}

module.exports = StructureDeploymentService;
