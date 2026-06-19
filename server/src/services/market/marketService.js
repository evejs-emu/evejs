const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildRowset,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const ORDER_HEADER = [
  "price",
  "volRemaining",
  "typeID",
  "range",
  "orderID",
  "volEntered",
  "minVolume",
  "bid",
  "issueDate",
  "duration",
  "stationID",
  "regionID",
  "solarSystemID",
  "jumps",
];
const SUMMARY_HEADER = ["typeID", "price", "volRemaining", "stationID"];
const HISTORY_HEADER = [
  "historyDate",
  "lowPrice",
  "highPrice",
  "avgPrice",
  "volume",
  "orders",
];
const OWNER_ORDER_HEADER = [
  "orderID",
  "typeID",
  "charID",
  "regionID",
  "stationID",
  "range",
  "bid",
  "price",
  "volEntered",
  "volRemaining",
  "issueDate",
  "minVolume",
  "contraband",
  "duration",
  "isCorp",
  "solarSystemID",
  "escrow",
];

class MarketService extends BaseService {
  constructor() {
    super("market");
  }

  Handle_StartupCheck() {
    log.debug("[Market] StartupCheck");
    return null;
  }

  Handle_GetMarketGroups() {
    log.debug("[Market] GetMarketGroups");
    return buildRowset(
      [
        "parentGroupID",
        "marketGroupID",
        "marketGroupName",
        "description",
        "graphicID",
        "hasTypes",
        "iconID",
        "dataID",
        "marketGroupNameID",
        "descriptionID",
      ],
      [],
      "eve.common.script.sys.rowset.Rowset",
    );
  }

  Handle_GetStationAsks(args, session) {
    log.debug("[Market] GetStationAsks");
    return buildRowset(SUMMARY_HEADER, [], "eve.common.script.sys.rowset.Rowset");
  }

  Handle_GetSystemAsks(args, session) {
    log.debug("[Market] GetSystemAsks");
    return buildRowset(SUMMARY_HEADER, [], "eve.common.script.sys.rowset.Rowset");
  }

  Handle_GetRegionBest(args, session) {
    log.debug("[Market] GetRegionBest");
    return buildRowset(SUMMARY_HEADER, [], "eve.common.script.sys.rowset.Rowset");
  }

  Handle_GetOrders(args, session) {
    const typeID = args && args.length > 0 ? args[0] : 0;
    log.debug(`[Market] GetOrders(${typeID})`);
    return [
      buildRowset(ORDER_HEADER, [], "eve.common.script.sys.rowset.Rowset"),
      buildRowset(ORDER_HEADER, [], "eve.common.script.sys.rowset.Rowset"),
    ];
  }

  Handle_GetOldPriceHistory(args) {
    const typeID = args && args.length > 0 ? args[0] : 0;
    log.debug(`[Market] GetOldPriceHistory(${typeID})`);
    return buildRowset(HISTORY_HEADER, [], "eve.common.script.sys.rowset.Rowset");
  }

  Handle_GetNewPriceHistory(args) {
    const typeID = args && args.length > 0 ? args[0] : 0;
    log.debug(`[Market] GetNewPriceHistory(${typeID})`);
    return buildRowset(HISTORY_HEADER, [], "eve.common.script.sys.rowset.Rowset");
  }

  Handle_GetCharOrders() {
    log.debug("[Market] GetCharOrders");
    return buildRowset(OWNER_ORDER_HEADER, [], "eve.common.script.sys.rowset.Rowset");
  }

  Handle_GetCorporationOrders() {
    log.debug("[Market] GetCorporationOrders");
    return buildRowset(OWNER_ORDER_HEADER, [], "eve.common.script.sys.rowset.Rowset");
  }
}

module.exports = MarketService;
