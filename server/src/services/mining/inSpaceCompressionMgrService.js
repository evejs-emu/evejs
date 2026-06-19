const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  findItemById,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  compressInventoryItem,
  resolveInSpaceCompressionContext,
} = require("./miningIndustry");

function buildCompressionTuple(resultData) {
  if (!resultData) {
    return null;
  }
  return [
    resultData.sourceItemID,
    resultData.sourceTypeID,
    resultData.sourceQuantity,
    resultData.outputItemID,
    resultData.outputTypeID,
    resultData.outputQuantity,
  ];
}

class InSpaceCompressionMgrService extends BaseService {
  constructor() {
    super("inSpaceCompressionMgr");
  }

  Handle_CompressItemInSpace(args, session) {
    const itemID = Number(args && args[0]) || 0;
    const facilityBallID = Number(args && args[1]) || 0;
    const contextResult = resolveInSpaceCompressionContext(
      session,
      facilityBallID,
    );
    if (!contextResult.success || !contextResult.data) {
      return null;
    }

    const item = findItemById(itemID);
    if (
      !item ||
      Number(item.ownerID || 0) !== Number(session && session.characterID || 0) ||
      Number(item.locationID || 0) !== Number(session && session._space && session._space.shipID || 0)
    ) {
      return null;
    }

    const compressResult = compressInventoryItem(itemID);
    if (!compressResult.success || !compressResult.data) {
      return null;
    }
    syncInventoryItemForSession(
      session,
      compressResult.data.change.item,
      compressResult.data.change.previousData || {},
      {
        emitCfgLocation: true,
      },
    );
    return buildCompressionTuple(compressResult.data);
  }
}

module.exports = InSpaceCompressionMgrService;
