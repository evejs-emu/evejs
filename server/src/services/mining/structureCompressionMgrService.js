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
  decompressGasInStructure,
  getGasDecompressionCharacterEfficiency,
  getStructureGasDecompressionEfficiency,
} = require("./miningIndustry");
const {
  resolveReprocessingContext,
} = require(path.join(__dirname, "../reprocessing"));

function syncInventoryChangesToSession(session, changes = []) {
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }
    syncInventoryItemForSession(
      session,
      change.item,
      change.previousData || change.previousState || {},
      {
        emitCfgLocation: true,
      },
    );
  }
}

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

class StructureCompressionMgrService extends BaseService {
  constructor() {
    super("structureCompressionMgr");
  }

  Handle_CompressItemInStructure(args, session) {
    const itemID = Number(args && args[0]) || 0;
    const contextResult = resolveReprocessingContext(session);
    if (!contextResult.success || !contextResult.data || contextResult.data.dockedKind !== "structure") {
      return null;
    }

    const item = findItemById(itemID);
    if (
      !item ||
      Number(item.ownerID || 0) !== Number(contextResult.data.characterID || 0)
    ) {
      return null;
    }

    const compressResult = compressInventoryItem(itemID);
    if (!compressResult.success || !compressResult.data) {
      return null;
    }
    syncInventoryChangesToSession(session, [compressResult.data.change]);
    return buildCompressionTuple(compressResult.data);
  }

  Handle_DecompressGasInStructure(args, session) {
    const itemID = Number(args && args[0]) || 0;
    const decompressResult = decompressGasInStructure(session, itemID);
    if (!decompressResult.success || !decompressResult.data) {
      return null;
    }
    syncInventoryChangesToSession(session, decompressResult.data.changes);
    return buildCompressionTuple(decompressResult.data);
  }

  Handle_GetMyGasDecompressionEfficiency(args, session) {
    const contextResult = resolveReprocessingContext(session);
    if (!contextResult.success || !contextResult.data) {
      return [0, 0];
    }
    return [
      getStructureGasDecompressionEfficiency(contextResult.data),
      getGasDecompressionCharacterEfficiency(contextResult.data.skillMap),
    ];
  }
}

module.exports = StructureCompressionMgrService;
