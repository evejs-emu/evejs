const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  findItemById,
  moveItemToLocation,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  buildDict,
  buildKeyVal,
  buildList,
  buildBoundObjectResponse,
  extractDictEntries,
  extractList,
  unwrapMarshalValue,
  normalizeNumber,
  resolveBoundNodeId,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  buildReprocessingQuoteForItem,
  buildReprocessingOptionsForTypes,
  getReprocessingProfile,
  getReprocessingYieldForType,
  getStationEfficiencyForTypeID,
  getStationTaxRate,
  reprocessItems,
  resolveAccessibleInventoryItem,
  resolveReprocessingContext,
  throwReprocessingError,
} = require(path.join(__dirname, "../reprocessing"));

const CLIENT_FMTAMT_SHORT_LIMIT = 100_000_000_000_000;

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

function buildRecoverableEntry(recoverable = {}) {
  return buildKeyVal([
    ["typeID", normalizeNumber(recoverable.typeID, 0)],
    ["client", normalizeNumber(recoverable.client, 0)],
    ["unrecoverable", normalizeNumber(recoverable.unrecoverable, 0)],
    ["iskCost", normalizeNumber(recoverable.iskCost, 0)],
  ]);
}

function buildQuoteEntry(quote = null) {
  if (!quote) {
    return buildKeyVal([]);
  }

  return buildKeyVal([
    ["itemID", normalizeNumber(quote.itemID, 0)],
    ["typeID", normalizeNumber(quote.typeID, 0)],
    ["quantityToProcess", normalizeNumber(quote.quantityToProcess, 0)],
    ["leftOvers", normalizeNumber(quote.leftOvers, 0)],
    ["portions", normalizeNumber(quote.portions, 0)],
    ["numPortions", normalizeNumber(quote.numPortions ?? quote.portions, 0)],
    ["efficiency", normalizeNumber(quote.efficiency, 0)],
    ["recoverables", buildList(quote.recoverables.map((entry) => buildRecoverableEntry(entry)))],
    ["totalISKCost", normalizeNumber(quote.totalISKCost, 0)],
  ]);
}

function extractTypeIds(rawValue) {
  return extractDictEntries(rawValue)
    .map((entry) => normalizeNumber(entry[0], 0))
    .filter((value) => value > 0);
}

function extractQuoteItemReferences(rawValue) {
  const directList = extractList(rawValue)
    .map((value) => normalizeNumber(value && (value.itemID ?? value), 0))
    .filter((value) => value > 0);
  if (directList.length > 0) {
    return directList;
  }

  const dictEntries = extractDictEntries(rawValue);
  if (dictEntries.length > 0) {
    return dictEntries
      .map(([entryKey, row]) => {
        const normalizedRow = unwrapMarshalValue(row);
        return {
          itemID: normalizeNumber(
            (row && row.itemID) ??
              (row && row.fields && row.fields.itemID) ??
              (normalizedRow && normalizedRow.itemID) ??
              (normalizedRow && normalizedRow.fields && normalizedRow.fields.itemID),
            normalizeNumber(entryKey, 0),
          ),
        };
      })
      .filter((entry) => entry.itemID > 0);
  }

  const normalized = unwrapMarshalValue(rawValue);
  if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
    return Object.entries(normalized)
      .map(([itemID, row]) => ({
        itemID: normalizeNumber(
          row && (row.itemID ?? (row.fields && row.fields.itemID)),
          normalizeNumber(itemID, 0),
        ),
      }))
      .filter((entry) => entry.itemID > 0);
  }

  return [];
}

function bucketItemIDsByLocation(itemReferences = [], fallbackLocationID = 0) {
  const orderedBuckets = [];
  const bucketByLocationID = new Map();

  for (const itemReference of Array.isArray(itemReferences) ? itemReferences : []) {
    const itemID = normalizeNumber(
      itemReference && (itemReference.itemID ?? itemReference),
      0,
    );
    if (itemID <= 0) {
      continue;
    }

    const item = findItemById(itemID);
    const locationID = normalizeNumber(
      item && item.locationID,
      normalizeNumber(fallbackLocationID, 0),
    );
    const bucketKey = locationID > 0 ? locationID : normalizeNumber(fallbackLocationID, 0);
    let bucket = bucketByLocationID.get(bucketKey);
    if (!bucket) {
      bucket = {
        locationID: bucketKey,
        itemIDs: [],
      };
      bucketByLocationID.set(bucketKey, bucket);
      orderedBuckets.push(bucket);
    }
    bucket.itemIDs.push(itemID);
  }

  return orderedBuckets;
}

function mergeOutputByTypeID(into, outputByTypeID = {}) {
  if (!(into instanceof Map)) {
    return;
  }

  for (const [typeID, quantity] of Object.entries(outputByTypeID || {})) {
    const numericTypeID = normalizeNumber(typeID, 0);
    if (numericTypeID <= 0) {
      continue;
    }
    into.set(
      numericTypeID,
      normalizeNumber(into.get(numericTypeID), 0) + normalizeNumber(quantity, 0),
    );
  }
}

function buildSyntheticQuoteItem(item, quantity) {
  if (!item) {
    return null;
  }
  const normalizedQuantity = Math.max(0, normalizeNumber(quantity, 0));
  if (normalizedQuantity <= 0) {
    return null;
  }
  return {
    ...item,
    singleton: 0,
    quantity: normalizedQuantity,
    stacksize: normalizedQuantity,
  };
}

function getInventoryStackQuantity(item) {
  if (!item) {
    return 0;
  }
  return Math.max(
    0,
    normalizeNumber(item.stacksize, normalizeNumber(item.quantity, 0)),
  );
}

function mergeRecoverablesByType(recoverablesByType, recoverables = []) {
  if (!(recoverablesByType instanceof Map)) {
    return;
  }

  for (const recoverable of Array.isArray(recoverables) ? recoverables : []) {
    const typeID = normalizeNumber(recoverable && recoverable.typeID, 0);
    if (typeID <= 0) {
      continue;
    }
    const current = recoverablesByType.get(typeID) || {
      typeID,
      client: 0,
      unrecoverable: 0,
      iskCost: 0,
    };
    current.client += normalizeNumber(recoverable && recoverable.client, 0);
    current.unrecoverable += normalizeNumber(recoverable && recoverable.unrecoverable, 0);
    current.iskCost += normalizeNumber(recoverable && recoverable.iskCost, 0);
    recoverablesByType.set(typeID, current);
  }
}

function quoteSetExceedsClientOutputDisplayLimit(quotesByItemID) {
  if (!(quotesByItemID instanceof Map) || quotesByItemID.size <= 0) {
    return false;
  }

  const outputByTypeID = new Map();
  for (const quote of quotesByItemID.values()) {
    for (const recoverable of Array.isArray(quote && quote.recoverables) ? quote.recoverables : []) {
      const typeID = normalizeNumber(recoverable && recoverable.typeID, 0);
      if (typeID <= 0) {
        continue;
      }
      const nextQuantity =
        normalizeNumber(outputByTypeID.get(typeID), 0) +
        normalizeNumber(recoverable && recoverable.client, 0);
      if (nextQuantity >= CLIENT_FMTAMT_SHORT_LIMIT) {
        return true;
      }
      outputByTypeID.set(typeID, nextQuantity);
    }
  }

  return false;
}

function findMaximumSafeReprocessingStackQuantity(item, context, quoteOptions) {
  const totalQuantity = getInventoryStackQuantity(item);
  if (!item || !context || totalQuantity <= 0) {
    return 0;
  }

  let low = 1;
  let high = totalQuantity;
  let best = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const syntheticItem = buildSyntheticQuoteItem(item, mid);
    const quote = buildReprocessingQuoteForItem(syntheticItem, context, quoteOptions);
    if (quote && !quote.errorMsg) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

function buildOversizedReprocessingSplitPlan(item, context, quoteOptions = {}) {
  const initialQuote = buildReprocessingQuoteForItem(item, context, quoteOptions);
  if (!initialQuote || !initialQuote.errorMsg) {
    return {
      success: true,
      data: {
        splitRequired: false,
        chunkQuantities: [getInventoryStackQuantity(item)],
        quote: initialQuote,
      },
    };
  }

  if (initialQuote.errorMsg !== "REPROCESSING_SPLIT_REQUIRED") {
    return {
      success: false,
      errorMsg: initialQuote.errorMsg,
    };
  }

  const safeChunkQuantity = findMaximumSafeReprocessingStackQuantity(
    item,
    context,
    quoteOptions,
  );
  if (safeChunkQuantity <= 0) {
    return {
      success: false,
      errorMsg: "REPROCESSING_SPLIT_REQUIRED",
    };
  }

  const profile = getReprocessingProfile(normalizeNumber(item.typeID, 0));
  const portionSize = Math.max(1, normalizeNumber(profile && profile.portionSize, 1));
  const totalQuantity = getInventoryStackQuantity(item);
  const originalLeftovers = totalQuantity % portionSize;
  const alignedSafeRootQuantity =
    originalLeftovers +
    (Math.floor((safeChunkQuantity - originalLeftovers) / portionSize) * portionSize);
  const alignedSplitChunkQuantity =
    Math.floor(safeChunkQuantity / portionSize) * portionSize;
  if (
    alignedSafeRootQuantity <= 0 ||
    alignedSplitChunkQuantity <= 0 ||
    alignedSafeRootQuantity > safeChunkQuantity
  ) {
    return {
      success: false,
      errorMsg: "REPROCESSING_SPLIT_REQUIRED",
    };
  }

  const chunkQuantities = [alignedSafeRootQuantity];
  let remainingOverflow = Math.max(0, totalQuantity - alignedSafeRootQuantity);
  while (remainingOverflow > 0) {
    const splitQuantity = Math.min(remainingOverflow, alignedSplitChunkQuantity);
    if (splitQuantity <= 0) {
      return {
        success: false,
        errorMsg: "REPROCESSING_SPLIT_REQUIRED",
      };
    }
    chunkQuantities.push(splitQuantity);
    remainingOverflow -= splitQuantity;
  }

  return {
    success: true,
    data: {
      splitRequired: true,
      chunkQuantities,
    },
  };
}

function buildSplitAwareQuoteForItem(item, context, quoteOptions = {}) {
  const splitPlanResult = buildOversizedReprocessingSplitPlan(item, context, quoteOptions);
  if (!splitPlanResult.success || !splitPlanResult.data) {
    return splitPlanResult;
  }

  if (!splitPlanResult.data.splitRequired) {
    return {
      success: true,
      data: {
        quote: splitPlanResult.data.quote,
        splitRequired: false,
      },
    };
  }

  const recoverablesByType = new Map();
  const chunkQuotes = [];
  for (const chunkQuantity of splitPlanResult.data.chunkQuantities) {
    const chunkQuote = buildReprocessingQuoteForItem(
      buildSyntheticQuoteItem(item, chunkQuantity),
      context,
      quoteOptions,
    );
    if (!chunkQuote) {
      continue;
    }
    if (chunkQuote.errorMsg) {
      return {
        success: false,
        errorMsg: chunkQuote.errorMsg,
      };
    }
    mergeRecoverablesByType(recoverablesByType, chunkQuote.recoverables);
    chunkQuotes.push(chunkQuote);
  }

  if (chunkQuotes.length <= 0) {
    return {
      success: true,
      data: {
        quote: null,
        splitRequired: true,
      },
    };
  }

  const firstQuote = chunkQuotes[0];
  const aggregatedQuote = {
    ...firstQuote,
    itemID: normalizeNumber(item && item.itemID, 0),
    quantityToProcess: chunkQuotes.reduce(
      (sum, quote) => sum + normalizeNumber(quote && quote.quantityToProcess, 0),
      0,
    ),
    leftOvers: chunkQuotes.reduce(
      (sum, quote) => sum + normalizeNumber(quote && quote.leftOvers, 0),
      0,
    ),
    portions: chunkQuotes.reduce(
      (sum, quote) => sum + normalizeNumber(quote && quote.portions, 0),
      0,
    ),
    numPortions: chunkQuotes.reduce(
      (sum, quote) =>
        sum + normalizeNumber(quote && (quote.numPortions ?? quote.portions), 0),
      0,
    ),
    totalISKCost: normalizeNumber(
      chunkQuotes.reduce(
        (sum, quote) => sum + normalizeNumber(quote && quote.totalISKCost, 0),
        0,
      ).toFixed(2),
      0,
    ),
    recoverables: [...recoverablesByType.values()].sort(
      (left, right) => normalizeNumber(left && left.typeID, 0) - normalizeNumber(right && right.typeID, 0),
    ),
  };

  return {
    success: true,
    data: {
      quote: aggregatedQuote,
      splitRequired: true,
    },
  };
}

function buildSplitAwareReprocessingQuotesForItems(session, itemReferences = [], quoteOptions = {}) {
  const contextResult = resolveReprocessingContext(session);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const quotesByItemID = new Map();
  for (const itemReference of Array.isArray(itemReferences) ? itemReferences : []) {
    const item = resolveAccessibleInventoryItem(session, itemReference);
    const itemID = normalizeNumber(item && item.itemID, 0);
    if (!item || itemID <= 0 || quotesByItemID.has(itemID)) {
      continue;
    }

    const quoteResult = buildSplitAwareQuoteForItem(item, contextResult.data, quoteOptions);
    if (!quoteResult.success) {
      return quoteResult;
    }
    if (quoteResult.data && quoteResult.data.quote) {
      quotesByItemID.set(itemID, quoteResult.data.quote);
    }
  }

  if (quoteSetExceedsClientOutputDisplayLimit(quotesByItemID)) {
    return {
      success: false,
      errorMsg: "REPROCESSING_SPLIT_REQUIRED",
    };
  }

  return {
    success: true,
    data: {
      context: contextResult.data,
      quotesByItemID,
    },
  };
}

function materializeOversizedSelectionsForReprocess(session, itemIDs = [], quoteOptions = {}) {
  const contextResult = resolveReprocessingContext(session);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const expandedItemIDs = [];
  const seen = new Set();
  const splitChanges = [];
  for (const rawItemID of Array.isArray(itemIDs) ? itemIDs : []) {
    const item = resolveAccessibleInventoryItem(session, rawItemID);
    const itemID = normalizeNumber(item && item.itemID, 0);
    if (!item || itemID <= 0 || seen.has(itemID)) {
      continue;
    }
    seen.add(itemID);

    const splitPlanResult = buildOversizedReprocessingSplitPlan(
      item,
      contextResult.data,
      quoteOptions,
    );
    if (!splitPlanResult.success || !splitPlanResult.data) {
      return splitPlanResult;
    }

    expandedItemIDs.push(itemID);
    if (!splitPlanResult.data.splitRequired) {
      continue;
    }

    for (const splitQuantity of splitPlanResult.data.chunkQuantities.slice(1)) {
      const splitResult = moveItemToLocation(
        itemID,
        normalizeNumber(item.locationID, 0),
        normalizeNumber(item.flagID, 0),
        splitQuantity,
      );
      if (!splitResult.success) {
        return splitResult;
      }
      const changes = (splitResult.data && splitResult.data.changes) || [];
      splitChanges.push(...changes);
      for (const change of changes) {
        const createdItemID = normalizeNumber(
          change && change.item && change.item.itemID,
          0,
        );
        if (createdItemID > 0 && createdItemID !== itemID && !seen.has(createdItemID)) {
          seen.add(createdItemID);
          expandedItemIDs.push(createdItemID);
        }
      }
    }
  }

  return {
    success: true,
    data: {
      itemIDs: expandedItemIDs,
      splitChanges,
      context: contextResult.data,
    },
  };
}

class ReprocessingService extends BaseService {
  constructor() {
    super("reprocessingSvc");
  }

  Handle_MachoResolveObject() {
    log.debug("[ReprocessingSvc] MachoResolveObject");
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    log.debug("[ReprocessingSvc] MachoBindObject");
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetOptionsForItemTypes(args) {
    log.debug("[ReprocessingSvc] GetOptionsForItemTypes");
    const typeIds = extractTypeIds(args && args[0]);
    const optionsByTypeID = buildReprocessingOptionsForTypes(typeIds);
    return buildDict(
      [...optionsByTypeID.entries()].map(([typeID, options]) => [
        typeID,
        buildKeyVal([
          ["isRecyclable", options.isRecyclable === true],
          ["isRefinable", options.isRefinable === true],
        ]),
      ]),
    );
  }

  Handle_GetReprocessingInfo(args, session) {
    log.debug("[ReprocessingSvc] GetReprocessingInfo");
    const contextResult = resolveReprocessingContext(session);
    if (!contextResult.success || !contextResult.data) {
      return buildKeyVal([
        ["standing", 0.0],
        ["tax", 0.0],
        ["yield", 0.0],
        ["combinedyield", 0.0],
      ]);
    }

    const commonTypeID = 1230;
    const yieldValue = getReprocessingYieldForType(
      contextResult.data,
      commonTypeID,
    );
    return buildKeyVal([
      ["standing", normalizeNumber(contextResult.data.standing, 0.0)],
      ["tax", getStationTaxRate(contextResult.data)],
      ["yield", getStationEfficiencyForTypeID(contextResult.data, commonTypeID)],
      ["combinedyield", yieldValue],
    ]);
  }

  Handle_GetQuote(args, session) {
    log.debug("[ReprocessingSvc] GetQuote");
    const itemID = normalizeNumber(args && args[0], 0);
    const quoteResult = buildSplitAwareReprocessingQuotesForItems(session, [itemID], {
      includeRecoverablesFromRandomizedOutputs: false,
    });
    if (!quoteResult.success || !quoteResult.data) {
      if (!quoteResult.success && quoteResult.errorMsg) {
        throwReprocessingError(
          quoteResult.errorMsg,
          quoteResult.errorValues || quoteResult.values || {},
        );
      }
      return buildQuoteEntry(null);
    }
    return buildQuoteEntry(quoteResult.data.quotesByItemID.get(itemID) || null);
  }

  Handle_GetQuotes(args, session) {
    log.debug("[ReprocessingSvc] GetQuotes");
    const itemReferences = extractQuoteItemReferences(args && args[0]);
    const quoteResult = buildSplitAwareReprocessingQuotesForItems(session, itemReferences, {
      includeRecoverablesFromRandomizedOutputs: false,
    });
    if (!quoteResult.success || !quoteResult.data) {
      if (!quoteResult.success && quoteResult.errorMsg) {
        throwReprocessingError(
          quoteResult.errorMsg,
          quoteResult.errorValues || quoteResult.values || {},
        );
      }
      return [0.0, buildDict([]), buildDict([])];
    }

    const stationEfficiencyEntries = [];
    const seenTypeIDs = new Set();
    let fallbackStationEfficiency = 0;
    for (const quote of quoteResult.data.quotesByItemID.values()) {
      fallbackStationEfficiency = normalizeNumber(quote.stationEfficiency, fallbackStationEfficiency);
      if (seenTypeIDs.has(quote.typeID)) {
        continue;
      }
      seenTypeIDs.add(quote.typeID);
      stationEfficiencyEntries.push([quote.typeID, normalizeNumber(quote.stationEfficiency, 0)]);
    }

    return [
      getStationTaxRate(quoteResult.data.context),
      buildDict([
        [null, fallbackStationEfficiency],
        ...stationEfficiencyEntries,
      ]),
      buildDict(
        [...quoteResult.data.quotesByItemID.entries()].map(([itemID, quote]) => [
          itemID,
          buildQuoteEntry(quote),
        ]),
      ),
    ];
  }

  Handle_Reprocess(args, session) {
    log.debug("[ReprocessingSvc] Reprocess");
    const requestedItemIDs = extractList(args && args[0]);
    const fromLocationID = normalizeNumber(args && args[1], 0);
    const ownerID = normalizeNumber(args && args[2], 0);
    const outputLocationID =
      args && args.length > 3 && args[3] !== null && args[3] !== undefined
        ? normalizeNumber(args[3], 0)
        : null;
    const outputFlagID =
      args && args.length > 4 && args[4] !== null && args[4] !== undefined
        ? normalizeNumber(args[4], 0)
        : null;
    const splitMaterializationResult = materializeOversizedSelectionsForReprocess(
      session,
      requestedItemIDs,
      {
        includeRecoverablesFromRandomizedOutputs: false,
      },
    );
    if (!splitMaterializationResult.success || !splitMaterializationResult.data) {
      if (!splitMaterializationResult.success && splitMaterializationResult.errorMsg) {
        throwReprocessingError(
          splitMaterializationResult.errorMsg,
          splitMaterializationResult.errorValues || splitMaterializationResult.values || {},
        );
      }
      return [buildList([]), buildDict([])];
    }

    const itemIDs = splitMaterializationResult.data.itemIDs;
    if (Array.isArray(splitMaterializationResult.data.splitChanges) &&
      splitMaterializationResult.data.splitChanges.length > 0) {
      syncInventoryChangesToSession(session, splitMaterializationResult.data.splitChanges);
    }

    const batchRequests =
      fromLocationID > 0
        ? [
            {
              itemIDs,
              fromLocationID,
              ownerID,
              outputLocationID,
              outputFlagID,
            },
          ]
        : bucketItemIDsByLocation(itemIDs, fromLocationID).map((bucket) => ({
            itemIDs: bucket.itemIDs,
            fromLocationID: bucket.locationID,
            // Retail groups by source location and resolves the default output owner
            // from each group's sample item when no explicit output target is selected.
            ownerID:
              outputLocationID === null && outputFlagID === null
                ? 0
                : ownerID,
            outputLocationID,
            outputFlagID,
          }));

    const aggregatedProcessedItemIDs = [];
    const aggregatedOutputByTypeID = new Map();

    for (const batchRequest of batchRequests) {
      const reprocessResult = reprocessItems(session, batchRequest);
      if (!reprocessResult.success || !reprocessResult.data) {
        if (!reprocessResult.success && reprocessResult.errorMsg) {
          throwReprocessingError(
            reprocessResult.errorMsg,
            reprocessResult.errorValues || reprocessResult.values || {},
          );
        }
        continue;
      }

      syncInventoryChangesToSession(session, reprocessResult.data.inputChanges);
      syncInventoryChangesToSession(session, reprocessResult.data.outputChanges);
      aggregatedProcessedItemIDs.push(...(reprocessResult.data.processedItemIDs || []));
      mergeOutputByTypeID(aggregatedOutputByTypeID, reprocessResult.data.outputByTypeID);
    }

    return [
      buildList(aggregatedProcessedItemIDs),
      buildDict(
        [...aggregatedOutputByTypeID.entries()].map(([typeID, quantity]) => [
          normalizeNumber(typeID, 0),
          normalizeNumber(quantity, 0),
        ]),
      ),
    ];
  }
}

ReprocessingService._quoteSetExceedsClientOutputDisplayLimit =
  quoteSetExceedsClientOutputDisplayLimit;

module.exports = ReprocessingService;
