const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  CORP_ROLE_DIRECTOR,
  CORP_ROLE_ACCOUNTANT,
  CORP_ROLE_JUNIOR_ACCOUNTANT,
} = require(path.join(__dirname, "../corporation/corporationRuntimeState"));
const {
  getObserverMiningLedger,
  listObserverHeadersForCorporation,
} = require("./miningLedgerState");

const LEDGER_ACCESS_MASK =
  CORP_ROLE_DIRECTOR +
  CORP_ROLE_ACCOUNTANT +
  CORP_ROLE_JUNIOR_ACCOUNTANT;

function hasCorpLedgerAccess(session) {
  try {
    const roleMask =
      typeof (session && session.corprole) === "bigint"
        ? session.corprole
        : BigInt(session && session.corprole ? session.corprole : 0);
    return (roleMask & LEDGER_ACCESS_MASK) !== 0n;
  } catch (error) {
    return false;
  }
}

function getSessionCorporationID(session) {
  return normalizeNumber(
    session && (session.corporationID || session.corpid),
    0,
  );
}

function buildObserverHeaderKeyVal(entry = {}) {
  const solarSystemID = normalizeNumber(entry.solarSystemID, 0);
  return buildKeyVal([
    ["itemID", normalizeNumber(entry.itemID, 0)],
    ["solarSystemID", solarSystemID],
    ["solarsystemID", solarSystemID],
    ["itemName", String(entry.itemName || "")],
  ]);
}

function buildObserverLedgerEntryKeyVal(entry = {}) {
  const solarSystemID = normalizeNumber(entry.solarSystemID, 0);
  return buildKeyVal([
    ["entryID", normalizeNumber(entry.entryID, 0)],
    ["eventDate", buildFiletimeLong(entry.eventDate)],
    ["characterID", normalizeNumber(entry.characterID, 0)],
    ["corporationID", normalizeNumber(entry.corporationID, 0)],
    ["solarSystemID", solarSystemID],
    ["solarsystemID", solarSystemID],
    ["typeID", normalizeNumber(entry.typeID, 0)],
    ["quantity", normalizeNumber(entry.quantity, 0)],
    ["quantityWasted", normalizeNumber(entry.quantityWasted, 0)],
    ["quantityCritical", normalizeNumber(entry.quantityCritical, 0)],
    ["shipTypeID", normalizeNumber(entry.shipTypeID, 0)],
    ["moduleTypeID", normalizeNumber(entry.moduleTypeID, 0)],
    ["observerItemID", normalizeNumber(entry.observerItemID, 0)],
    ["yieldKind", String(entry.yieldKind || "")],
  ]);
}

class CorpMiningLedgerService extends BaseService {
  constructor() {
    super("corpMiningLedger");
  }

  Handle_GetObserversWithMiningEvents(args, session) {
    const corporationID = getSessionCorporationID(session);
    log.info(
      `[CorpMiningLedger] GetObserversWithMiningEvents corp=${corporationID}`,
    );
    if (!corporationID || !hasCorpLedgerAccess(session)) {
      return buildList([]);
    }
    return buildList(
      listObserverHeadersForCorporation(corporationID).map((entry) =>
        buildObserverHeaderKeyVal(entry),
      ),
    );
  }

  Handle_GetObserverLedger(args, session) {
    const corporationID = getSessionCorporationID(session);
    const observerItemID = normalizeNumber(args && args[0], 0);
    log.info(
      `[CorpMiningLedger] GetObserverLedger corp=${corporationID} observer=${observerItemID}`,
    );
    if (!corporationID || !observerItemID || !hasCorpLedgerAccess(session)) {
      return buildList([]);
    }
    return buildList(
      getObserverMiningLedger(observerItemID, corporationID).map((entry) =>
        buildObserverLedgerEntryKeyVal(entry),
      ),
    );
  }
}

module.exports = CorpMiningLedgerService;
