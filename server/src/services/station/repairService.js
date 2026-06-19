const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  syncDamageStateAttributesForSession,
} = require(path.join(__dirname, "../character/characterState"));
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
  buildRepairQuotesForSelection,
  buildLegacyDamageReportsForSelection,
  repairItemsInStation,
  repairItemsInStructure,
  resolveRepairContext,
  throwRepairError,
} = require(path.join(__dirname, "./repairRuntime"));
const {
  extractRepackageRequests,
  repackageItemsForSession,
} = require(path.join(__dirname, "./repackagingSupport"));

function syncRepairChangesToSession(session, changes = []) {
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }

    syncDamageStateAttributesForSession(
      session,
      change.item,
      change.previousData || change.previousState || {},
    );
  }
}

function buildRepairQuoteRow(quote = null) {
  if (!quote) {
    return buildKeyVal([]);
  }

  return buildKeyVal([
    ["itemID", normalizeNumber(quote.itemID, 0)],
    ["typeID", normalizeNumber(quote.typeID, 0)],
    ["groupID", normalizeNumber(quote.groupID, 0)],
    ["categoryID", normalizeNumber(quote.categoryID, 0)],
    ["damage", normalizeNumber(quote.damage, 0)],
    ["maxHealth", normalizeNumber(quote.maxHealth, 0)],
    [
      "costToRepairOneUnitOfDamage",
      normalizeNumber(quote.costToRepairOneUnitOfDamage, 0),
    ],
    ["structureTaxRate", normalizeNumber(quote.structureTaxRate, 0)],
    [
      "baseCostToRepairOneUnitOfDamage",
      normalizeNumber(quote.baseCostToRepairOneUnitOfDamage, 0),
    ],
  ]);
}

function buildDamageReport(report = null) {
  const lines = Array.isArray(report && report.lines) ? report.lines : [];
  return buildKeyVal([
    ["discount", String((report && report.discount) || "0%")],
    ["serviceCharge", String((report && report.serviceCharge) || "0%")],
    ["playerStanding", normalizeNumber(report && report.playerStanding, 0)],
    ["lines", buildList(lines.map((quote) => buildRepairQuoteRow(quote)))],
  ]);
}

function extractRepairItemReferences(rawValue) {
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

class RepairService extends BaseService {
  constructor() {
    super("repairSvc");
  }

  Handle_MachoResolveObject() {
    log.debug("[RepairSvc] MachoResolveObject");
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    log.debug("[RepairSvc] MachoBindObject");
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetRepairQuotes(args, session) {
    log.debug("[RepairSvc] GetRepairQuotes");
    const itemReferences = extractRepairItemReferences(args && args[0]);
    const quoteResult = buildRepairQuotesForSelection(session, itemReferences);
    if (!quoteResult.success || !quoteResult.data) {
      if (!quoteResult.success && quoteResult.errorMsg) {
        throwRepairError(quoteResult.errorMsg);
      }
      return buildDict([]);
    }

    return buildDict(
      [...quoteResult.data.groupedQuotes.entries()].map(([itemID, rows]) => [
        normalizeNumber(itemID, 0),
        buildList(rows.map((quote) => buildRepairQuoteRow(quote))),
      ]),
    );
  }

  Handle_GetDamageReports(args, session) {
    log.debug("[RepairSvc] GetDamageReports");
    const itemReferences = extractRepairItemReferences(args && args[0]);
    const reportResult = buildLegacyDamageReportsForSelection(session, itemReferences);
    if (!reportResult.success || !reportResult.data) {
      if (!reportResult.success && reportResult.errorMsg) {
        throwRepairError(reportResult.errorMsg);
      }
      return buildDict([]);
    }

    return buildDict(
      [...reportResult.data.reportsByItemID.entries()].map(([itemID, report]) => [
        normalizeNumber(itemID, 0),
        buildDamageReport(report),
      ]),
    );
  }

  Handle_DamageModules() {
    log.debug("[RepairSvc] DamageModules");
    return null;
  }

  Handle_RepairItemsInStation(args, session) {
    log.debug("[RepairSvc] RepairItemsInStation");
    const itemReferences = extractRepairItemReferences(args && args[0]);
    const payment =
      args && args.length > 1 && args[1] !== null && args[1] !== undefined
        ? normalizeNumber(args[1], 0)
        : null;
    const repairResult = repairItemsInStation(session, itemReferences, payment);
    if (!repairResult.success || !repairResult.data) {
      if (!repairResult.success && repairResult.errorMsg) {
        throwRepairError(
          repairResult.errorMsg,
          repairResult.errorValues || repairResult.values || {},
        );
      }
      return null;
    }

    syncRepairChangesToSession(session, repairResult.data.changes);
    return null;
  }

  Handle_RepairItemsInStructure(args, session) {
    log.debug("[RepairSvc] RepairItemsInStructure");
    const itemReferences = extractRepairItemReferences(args && args[0]);
    const repairResult = repairItemsInStructure(session, itemReferences);
    if (!repairResult.success || !repairResult.data) {
      if (!repairResult.success && repairResult.errorMsg) {
        throwRepairError(
          repairResult.errorMsg,
          repairResult.errorValues || repairResult.values || {},
        );
      }
      return null;
    }

    syncRepairChangesToSession(session, repairResult.data.changes);
    return null;
  }

  Handle_RepairItems(args, session) {
    log.debug("[RepairSvc] RepairItems");
    const contextResult = resolveRepairContext(session);
    if (!contextResult.success || !contextResult.data) {
      if (!contextResult.success && contextResult.errorMsg) {
        throwRepairError(contextResult.errorMsg);
      }
      return null;
    }

    return contextResult.data.dockedKind === "structure"
      ? this.Handle_RepairItemsInStructure(args, session)
      : this.Handle_RepairItemsInStation(args, session);
  }

  Handle_UnasembleItems(args, session) {
    repackageItemsForSession(
      session,
      extractRepackageRequests(args && args[0]),
      "RepairSvc",
    );
    return null;
  }
}

module.exports = RepairService;
