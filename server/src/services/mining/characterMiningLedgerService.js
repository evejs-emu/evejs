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
  getCharacterMiningLogs,
} = require("./miningLedgerState");

function buildMiningLedgerEntryKeyVal(entry = {}) {
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

class CharacterMiningLedgerService extends BaseService {
  constructor() {
    super("characterMiningLedger");
  }

  Handle_GetCharacterLogs(args, session) {
    const characterID = normalizeNumber(
      session && (session.characterID || session.charid),
      0,
    );
    log.info(`[CharacterMiningLedger] GetCharacterLogs char=${characterID}`);
    return buildList(
      getCharacterMiningLogs(characterID).map((entry) =>
        buildMiningLedgerEntryKeyVal(entry),
      ),
    );
  }
}

module.exports = CharacterMiningLedgerService;
