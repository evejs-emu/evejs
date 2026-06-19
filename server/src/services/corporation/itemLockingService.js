const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildDict,
  buildKeyVal,
  buildPythonSet,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getLockedItemLocations,
  getLockedItemsByLocation,
} = require(path.join(__dirname, "./corporationRuntimeState"));

class ItemLockingService extends BaseService {
  constructor() {
    super("itemLocking");
  }

  Handle_GetItemsByLocation(args, session) {
    const corporationID =
      (session && (session.corporationID || session.corpid)) || 0;
    const locationID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    return buildDict(
      getLockedItemsByLocation(corporationID, locationID).map((item) => [
        Number(item && item.itemID ? item.itemID : 0),
        buildKeyVal([
          ["itemID", Number(item && item.itemID ? item.itemID : 0)],
          ["typeID", Number(item && item.typeID ? item.typeID : 0)],
          ["ownerID", Number(item && item.ownerID ? item.ownerID : 0)],
          ["locationID", Number(item && item.locationID ? item.locationID : 0)],
        ]),
      ]),
    );
  }

  Handle_GetLockedItemLocations(args, session) {
    const corporationID =
      (session && (session.corporationID || session.corpid)) || 0;
    return buildPythonSet(getLockedItemLocations(corporationID));
  }
}

module.exports = ItemLockingService;
