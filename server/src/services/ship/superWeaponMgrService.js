const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  findItemById,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  isModuleOnline,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));

function normalizePoint(point) {
  if (Array.isArray(point) && point.length >= 3) {
    return {
      x: Number(point[0]) || 0,
      y: Number(point[1]) || 0,
      z: Number(point[2]) || 0,
    };
  }
  if (point && typeof point === "object") {
    return {
      x: Number(point.x) || 0,
      y: Number(point.y) || 0,
      z: Number(point.z) || 0,
    };
  }
  return null;
}

class SuperWeaponMgrService extends BaseService {
  constructor() {
    super("superWeaponMgr");
  }

  Handle_ActivateSinglePointTargetedModule(args, session, kwargs) {
    void kwargs;

    const moduleID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    const point = normalizePoint(args && args.length > 2 ? args[2] : null);
    const moduleItem = findItemById(moduleID);
    if (!session || !session._space || !moduleItem || !isModuleOnline(moduleItem) || !point) {
      return null;
    }

    const result = spaceRuntime.activateGenericModule(session, moduleItem, null, {
      targetPoint: point,
      repeat: 1,
    });
    return result && result.success ? 1 : null;
  }

  Handle_ActivateSlashModule() {
    return null;
  }
}

module.exports = SuperWeaponMgrService;
