const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { throwWrappedUserError, isMachoWrappedException } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const {
  buildDict,
  buildKeyVal,
  buildList,
  buildRowset,
  buildFiletimeLong,
  normalizeBigInt,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const { marketDaemonClient } = require(path.join(
  __dirname,
  "./marketDaemonClient",
));
const { buildCachedMethodCallResult } = require(path.join(
  __dirname,
  "../cache/objectCacheRuntime",
));
const {
  ACCOUNT_KEY,
  JOURNAL_ENTRY_TYPE,
  adjustCharacterBalance,
  appendCharacterMarketTransaction,
  getCharacterMarketTransactions,
  getCharacterWallet,
} = require(path.join(__dirname, "../account/walletState"));
const {
  ITEM_FLAGS,
  findItemById,
  grantItemToCharacterLocation,
  listContainerItems,
  moveItemToLocation,
  removeInventoryItem,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const { notifyInventoryChangesToCharacter } = require(path.join(
  __dirname,
  "../raffles/raffleInventory",
));
const sessionRegistry = require(path.join(
  __dirname,
  "../chat/sessionRegistry",
));
const {
  getEscrowRecord,
  listEscrowRecords,
  putEscrowRecord,
  removeEscrowRecord,
} = require(path.join(__dirname, "./marketEscrowState"));
const {
  RANGE_STATION,
  RANGE_REGION,
  getOrderJumpDistance,
  getStationConstellationID,
  getStationSolarSystemID,
  isBidOrderInRange,
  isSellOrderInRange,
} = require(path.join(__dirname, "./marketTopology"));
const {
  MARKET_MAX_ORDER_PRICE,
  computeBrokerFeeInfo,
  computeSccSurchargeInfo,
  computeSalesTaxAmount,
  getMarketContext,
  getStationDistanceFromSession,
  isAllowedBuyRange,
  isAllowedDuration,
} = require(path.join(__dirname, "./marketRules"));
const {
  getMarketRuntimeState,
  updateMarketRuntimeState,
} = require(path.join(__dirname, "./marketRuntimeState"));
const { getStationRecord } = require(path.join(
  __dirname,
  "../_shared/stationStaticData",
));

const ROWSET_NAME = "eve.common.script.sys.rowset.Rowset";

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
  "constellationID",
  "jumps",
];

const ORDER_ROW_DESCRIPTOR_COLUMNS = [
  ["price", 5],
  ["volRemaining", 3],
  ["typeID", 3],
  ["range", 3],
  ["orderID", 20],
  ["volEntered", 3],
  ["minVolume", 3],
  ["bid", 3],
  ["issueDate", 64],
  ["duration", 3],
  ["stationID", 3],
  ["regionID", 3],
  ["solarSystemID", 3],
  ["constellationID", 3],
  ["jumps", 3],
];

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
  "constellationID",
  "keyID",
  "orderState",
  "lastStateChange",
];

let EMPTY_ORDER_ROWSET = null;
const EMPTY_OWNER_ORDER_ROWSET = buildRowset(OWNER_ORDER_HEADER, [], ROWSET_NAME);

const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const PLEX_TYPE_ID = 44992;
const ORDER_REASON_CREATED = "Created";
const ORDER_REASON_MODIFIED = "Modified";
const ORDER_REASON_CANCELLED = "Cancelled";
const ORDER_REASON_FILLED = "Filled";
const ORDER_REASON_PARTIAL = "PartialFill";
const ORDER_REASON_EXPIRED = "Expired";
const MARKET_ESCROW_LOCATION_BASE = 9_200_000_000;
const MARKET_EXPIRY_POLL_INTERVAL_MS = 2_000;
const MARKET_EXPIRY_SWEEP_THROTTLE_MS = 1_000;
const BROKER_RATE_EPSILON = 0.000001;
const HISTORY_ROW_DESCRIPTOR_COLUMNS = [
  ["historyDate", 64],
  ["lowPrice", 5],
  ["highPrice", 5],
  ["avgPrice", 5],
  ["volume", 20],
  ["orders", 3],
];
let marketExpiryPollTimer = null;
let marketExpiryPollPromise = null;
let lastForcedExpirySweepAt = 0;

function buildRowDescriptor(columns) {
  return {
    type: "objectex1",
    header: [
      { type: "token", value: "blue.DBRowDescriptor" },
      [columns],
    ],
    list: [],
    dict: [],
  };
}

function roundIsk(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.round(numericValue * 100) / 100;
}

function floatCloseEnough(left, right, epsilon = BROKER_RATE_EPSILON) {
  return Math.abs((Number(left) || 0) - (Number(right) || 0)) <= epsilon;
}

function getNumericSessionValue(session, keys = [], fallback = 0) {
  for (const key of keys) {
    const numericValue = normalizePositiveInteger(session && session[key], 0);
    if (numericValue > 0) {
      return numericValue;
    }
  }
  return fallback;
}

function buildSignedLong(value, fallback = 0n) {
  return {
    type: "long",
    value: normalizeBigInt(value, fallback),
  };
}

function isoTimestampToFileTimeBigInt(rawValue = null) {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return null;
  }

  const timestampMs = Date.parse(String(rawValue));
  if (!Number.isFinite(timestampMs)) {
    return null;
  }

  return BigInt(Math.trunc(timestampMs)) * 10000n + FILETIME_EPOCH_OFFSET;
}

function buildBestByTuple(price, quantity, typeID, stationID) {
  return [
    roundIsk(price),
    Number(quantity) || 0,
    Number(typeID) || 0,
    Number(stationID) || 0,
  ];
}

function buildBestByOrder(price, quantity, typeID, stationID) {
  return buildKeyVal([
    ["price", roundIsk(price)],
    ["volRemaining", Number(quantity) || 0],
    ["typeID", Number(typeID) || 0],
    ["stationID", Number(stationID) || 0],
  ]);
}

function buildSummaryDict(summaryRows = [], valueKind = "tuple") {
  const entries = [];

  for (const row of Array.isArray(summaryRows) ? summaryRows : []) {
    const bestAskPrice = Number(row && row.best_ask_price);
    const totalAskQuantity = Number(row && row.total_ask_quantity);
    const stationID = Number(row && row.best_ask_station_id);
    const typeID = Number(row && row.type_id);

    if (
      !Number.isFinite(typeID) ||
      typeID <= 0 ||
      !Number.isFinite(bestAskPrice) ||
      bestAskPrice <= 0 ||
      !Number.isFinite(totalAskQuantity) ||
      totalAskQuantity <= 0 ||
      !Number.isFinite(stationID) ||
      stationID <= 0
    ) {
      continue;
    }

    entries.push([
      typeID,
      valueKind === "bestByOrder"
        ? buildBestByOrder(bestAskPrice, totalAskQuantity, typeID, stationID)
        : buildBestByTuple(bestAskPrice, totalAskQuantity, typeID, stationID),
    ]);
  }

  return buildDict(entries);
}

function buildOrderRowset(rows = [], options = {}) {
  const currentStationID = normalizePositiveInteger(options.currentStationID, 0);
  const currentSolarSystemID = normalizePositiveInteger(options.currentSolarSystemID, 0);
  const rowDescriptor = buildRowDescriptor(ORDER_ROW_DESCRIPTOR_COLUMNS);
  const lines = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const issuedAt = isoTimestampToFileTimeBigInt(row && row.issued_at);
    const stationID = Number(row && row.station_id) || 0;
    const solarSystemID = Number(row && row.solar_system_id) || 0;
    const jumpDistance = getOrderJumpDistance({
      currentStationID,
      currentSolarSystemID,
      orderStationID: stationID,
      orderSolarSystemID: solarSystemID,
    });
    lines.push([
      roundIsk(row && row.price),
      Number(row && row.vol_remaining) || 0,
      Number(row && row.type_id) || 0,
      Number(row && row.range_value) || 0,
      buildSignedLong(row && row.order_id),
      Number(row && row.vol_entered) || 0,
      Number(row && row.min_volume) || 0,
      row && row.bid ? 1 : 0,
      buildFiletimeLong(issuedAt),
      Number(row && row.duration_days) || 0,
      stationID,
      Number(row && row.region_id) || 0,
      solarSystemID,
      Number(row && row.constellation_id) || 0,
      Math.max(0, jumpDistance),
    ]);
  }

  return {
    type: "object",
    name: ROWSET_NAME,
    args: buildDict([
      ["header", rowDescriptor],
      ["columns", buildList(ORDER_HEADER)],
      ["RowClass", { type: "token", value: "blue.DBRow" }],
      ["lines", buildList(lines)],
    ]),
  };
}

EMPTY_ORDER_ROWSET = buildOrderRowset([]);

function buildHistoryRowset(historyRows = []) {
  const rowDescriptor = buildRowDescriptor(HISTORY_ROW_DESCRIPTOR_COLUMNS);
  const lines = [];

  for (const row of Array.isArray(historyRows) ? historyRows : []) {
    lines.push([
      normalizeBigInt(isoTimestampToFileTimeBigInt(row && row.day), 0n),
      roundIsk(row && row.low_price),
      roundIsk(row && row.high_price),
      roundIsk(row && row.avg_price),
      Number(row && row.volume) || 0,
      Number(row && row.order_count) || 0,
    ]);
  }

  return {
    type: "object",
    name: ROWSET_NAME,
    args: buildDict([
      ["header", rowDescriptor],
      ["RowClass", { type: "token", value: "blue.DBRow" }],
      ["lines", buildList(lines)],
    ]),
  };
}

function buildEmptyHistoryRowset() {
  return buildHistoryRowset([]);
}

function splitHistoryRows(historyRows = []) {
  const rows = Array.isArray(historyRows) ? historyRows : [];
  if (rows.length === 0) {
    return {
      oldRows: [],
      newRows: [],
    };
  }

  return {
    oldRows: rows.slice(0, Math.max(0, rows.length - 1)),
    newRows: rows.slice(-1),
  };
}

function buildHistoryPair(historyRows = []) {
  const { oldRows, newRows } = splitHistoryRows(historyRows);
  return [buildHistoryRowset(oldRows), buildHistoryRowset(newRows)];
}

function mapOwnerOrderStateCode(state) {
  switch (String(state || "").trim().toLowerCase()) {
    case "filled":
      return 1;
    case "expired":
      return 2;
    case "cancelled":
      return 3;
    default:
      return 0;
  }
}

function mapOwnerOrderRow(ownerOrder) {
  const nestedRow = ownerOrder && ownerOrder.row ? ownerOrder.row : {};
  const state = String(ownerOrder && ownerOrder.state ? ownerOrder.state : "open");
  const issueDate = isoTimestampToFileTimeBigInt(nestedRow.issued_at);
  const lastStateChangeDate = isoTimestampToFileTimeBigInt(
    ownerOrder && ownerOrder.last_state_change_at,
  );
  const stateCode = mapOwnerOrderStateCode(state);
  const isCorp = Boolean(ownerOrder && ownerOrder.is_corp);
  const ownerID = Number(ownerOrder && ownerOrder.owner_id) || 0;
  const charID = isCorp ? 0 : ownerID;
  const escrow = nestedRow.bid
    ? roundIsk((Number(nestedRow.price) || 0) * (Number(nestedRow.vol_remaining) || 0))
    : 0;

  return [
    buildSignedLong(nestedRow.order_id || ownerOrder.order_id),
    Number(nestedRow.type_id) || 0,
    charID,
    Number(nestedRow.region_id) || 0,
    Number(nestedRow.station_id) || 0,
    Number(nestedRow.range_value) || 0,
    nestedRow.bid ? 1 : 0,
    roundIsk(nestedRow.price),
    Number(nestedRow.vol_entered) || 0,
    Number(nestedRow.vol_remaining) || 0,
    buildFiletimeLong(issueDate),
    Number(nestedRow.min_volume) || 0,
    0,
    Number(nestedRow.duration_days) || 0,
    isCorp ? 1 : 0,
    Number(nestedRow.solar_system_id) || 0,
    escrow,
    Number(nestedRow.constellation_id) || 0,
    1000,
    stateCode,
    stateCode === 0 ? null : buildFiletimeLong(lastStateChangeDate || issueDate),
  ];
}

function buildOwnerOrdersRowset(ownerOrders = []) {
  const lines = [];
  for (const ownerOrder of Array.isArray(ownerOrders) ? ownerOrders : []) {
    lines.push(mapOwnerOrderRow(ownerOrder));
  }
  return {
    type: "object",
    name: ROWSET_NAME,
    args: buildDict([
      ["header", buildList(OWNER_ORDER_HEADER)],
      ["columns", buildList(OWNER_ORDER_HEADER)],
      ["RowClass", { type: "token", value: "util.Row" }],
      ["lines", buildList(lines.map((line) => buildList(line)))],
    ]),
  };
}

function buildMarketTransactionEntry(entry = {}) {
  return buildKeyVal([
    ["transactionID", normalizeInteger(entry && entry.transactionID, 0)],
    [
      "transactionDate",
      buildFiletimeLong(normalizeBigInt(entry && entry.transactionDate, 0n)),
    ],
    ["typeID", normalizePositiveInteger(entry && entry.typeID, 0)],
    ["quantity", normalizePositiveInteger(entry && entry.quantity, 0)],
    ["price", roundIsk(entry && entry.price)],
    ["stationID", normalizePositiveInteger(entry && entry.stationID, 0)],
    ["locationID", normalizePositiveInteger(entry && entry.locationID, 0)],
    ["buyerID", normalizePositiveInteger(entry && entry.buyerID, 0)],
    ["sellerID", normalizePositiveInteger(entry && entry.sellerID, 0)],
    ["clientID", normalizePositiveInteger(entry && entry.clientID, 0)],
    ["accountID", normalizePositiveInteger(entry && entry.accountID, ACCOUNT_KEY.CASH)],
    ["buyerAccountID", normalizePositiveInteger(entry && entry.buyerAccountID, ACCOUNT_KEY.CASH)],
    ["sellerAccountID", normalizePositiveInteger(entry && entry.sellerAccountID, ACCOUNT_KEY.CASH)],
    ["journalRefID", normalizeInteger(entry && entry.journalRefID, -1)],
  ]);
}

function buildMarketTransactionList(entries = []) {
  return buildList(
    ensureArray(entries).map((entry) => buildMarketTransactionEntry(entry)),
  );
}

function filterMarketTransactionsFromDate(entries = [], fromDate = null) {
  const threshold = normalizeBigInt(fromDate, 0n);
  if (threshold <= 0n) {
    return ensureArray(entries);
  }

  return ensureArray(entries).filter(
    (entry) => normalizeBigInt(entry && entry.transactionDate, 0n) >= threshold,
  );
}

function collectRequestedTypeIds(rawValue, out, depth = 0) {
  if (depth > 8 || rawValue === null || rawValue === undefined) {
    return;
  }

  if (typeof rawValue === "number" || typeof rawValue === "bigint") {
    const numericValue = Number(rawValue);
    if (Number.isInteger(numericValue) && numericValue > 0) {
      out.push(numericValue);
    }
    return;
  }

  if (typeof rawValue === "string" && rawValue.trim() !== "") {
    const numericValue = Number(rawValue);
    if (Number.isInteger(numericValue) && numericValue > 0) {
      out.push(numericValue);
    }
    return;
  }

  if (Array.isArray(rawValue)) {
    for (const value of rawValue) {
      collectRequestedTypeIds(value, out, depth + 1);
    }
    return;
  }

  if (rawValue instanceof Set) {
    for (const value of rawValue) {
      collectRequestedTypeIds(value, out, depth + 1);
    }
    return;
  }

  if (rawValue && typeof rawValue === "object") {
    if (
      (rawValue.type === "objectex1" || rawValue.type === "objectex2")
    ) {
      if (Array.isArray(rawValue.header)) {
        for (const entry of rawValue.header) {
          collectRequestedTypeIds(entry, out, depth + 1);
        }
      }
      if (Array.isArray(rawValue.list)) {
        for (const entry of rawValue.list) {
          collectRequestedTypeIds(entry, out, depth + 1);
        }
      }
      if (Array.isArray(rawValue.dict)) {
        for (const entry of rawValue.dict) {
          collectRequestedTypeIds(entry, out, depth + 1);
        }
      }
      return;
    }

    if (
      (rawValue.type === "list" || rawValue.type === "set") &&
      Array.isArray(rawValue.items)
    ) {
      for (const item of rawValue.items) {
        collectRequestedTypeIds(item, out, depth + 1);
      }
      return;
    }

    if (
      rawValue.type === "dict" &&
      Array.isArray(rawValue.entries)
    ) {
      for (const [, value] of rawValue.entries) {
        collectRequestedTypeIds(value, out, depth + 1);
      }
      return;
    }

    if (Object.prototype.hasOwnProperty.call(rawValue, "value")) {
      collectRequestedTypeIds(rawValue.value, out, depth + 1);
    }
  }
}

function extractRequestedTypeIds(rawValue) {
  const requestedTypeIds = [];
  collectRequestedTypeIds(rawValue, requestedTypeIds, 0);
  return Array.from(
    new Set(
      requestedTypeIds.filter(
        (typeID) => Number.isInteger(typeID) && Number.isFinite(typeID) && typeID > 0,
      ),
    ),
  );
}

function normalizeOrderId(value) {
  if (value && typeof value === "object" && value.type === "long") {
    return normalizeBigInt(value.value, 0n).toString();
  }
  return normalizeBigInt(value, 0n).toString();
}

function normalizeNumericValue(value, fallback = Number.NaN) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    const trimmedValue = value.trim();
    if (trimmedValue === "") {
      return fallback;
    }
    const pythonLongValue = trimmedValue.match(/^(-?\d+)[lL]$/);
    const normalizedText = pythonLongValue ? pythonLongValue[1] : trimmedValue;
    const numericValue = Number(normalizedText);
    return Number.isFinite(numericValue) ? numericValue : fallback;
  }

  if (typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return normalizeNumericValue(value.value, fallback);
    }
  }

  return fallback;
}

function normalizeInteger(value, fallback = 0) {
  const numericValue = normalizeNumericValue(value, Number.NaN);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function normalizePositiveInteger(value, fallback = 0) {
  const numericValue = normalizeNumericValue(value, Number.NaN);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return Math.trunc(numericValue);
  }
  return fallback;
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return Boolean(value);
}

function unwrapMarshalValue(rawValue, depth = 0) {
  if (depth > 12 || rawValue === null || rawValue === undefined) {
    return rawValue;
  }

  if (Buffer.isBuffer(rawValue)) {
    return rawValue.toString("utf8");
  }

  if (
    typeof rawValue === "string" ||
    typeof rawValue === "number" ||
    typeof rawValue === "boolean"
  ) {
    return rawValue;
  }

  if (typeof rawValue === "bigint") {
    return rawValue.toString();
  }

  if (Array.isArray(rawValue)) {
    return rawValue.map((entry) => unwrapMarshalValue(entry, depth + 1));
  }

  if (rawValue && typeof rawValue === "object") {
    switch (rawValue.type) {
      case "int":
      case "real":
      case "token":
      case "wstring":
      case "string":
        return unwrapMarshalValue(rawValue.value, depth + 1);
      case "long":
        return normalizeBigInt(rawValue.value, 0n).toString();
      case "list":
      case "tuple":
      case "set":
        return Array.isArray(rawValue.items)
          ? rawValue.items.map((entry) => unwrapMarshalValue(entry, depth + 1))
          : [];
      case "dict":
        return new Map(
          (Array.isArray(rawValue.entries) ? rawValue.entries : []).map(
            ([key, value]) => [
              unwrapMarshalValue(key, depth + 1),
              unwrapMarshalValue(value, depth + 1),
            ],
          ),
        );
      case "object":
        if (isMarshalKeyValObjectName(rawValue.name, depth + 1)) {
          const entries =
            rawValue.args &&
            rawValue.args.type === "dict" &&
            Array.isArray(rawValue.args.entries)
              ? rawValue.args.entries
              : [];
        return Object.fromEntries(
          entries.map(([key, value]) => [
            unwrapMarshalValue(key, depth + 1),
            unwrapMarshalValue(value, depth + 1),
          ]),
        );
        }
        return rawValue;
      case "objectex1":
      case "objectex2":
        if (
          Array.isArray(rawValue.header) &&
          rawValue.header.length > 0 &&
          rawValue.header[0] &&
          rawValue.header[0].type === "token" &&
          rawValue.header[0].value === "blue.DBRowDescriptor"
        ) {
          return rawValue;
        }
        return {
          header: unwrapMarshalValue(rawValue.header, depth + 1),
          list: unwrapMarshalValue(rawValue.list, depth + 1),
          dict: unwrapMarshalValue(rawValue.dict, depth + 1),
        };
      default:
        if (Object.prototype.hasOwnProperty.call(rawValue, "value")) {
          return unwrapMarshalValue(rawValue.value, depth + 1);
        }
    }

    return Object.fromEntries(
      Object.entries(rawValue).map(([key, value]) => [
        key,
        unwrapMarshalValue(value, depth + 1),
      ]),
    );
  }

  return rawValue;
}

function isMarshalKeyValObjectName(rawName, depth = 0) {
  const normalizedName = unwrapMarshalValue(rawName, depth);
  return (
    normalizedName === "util.KeyVal" ||
    normalizedName === "utillib.KeyVal" ||
    normalizedName === "KeyVal"
  );
}

function marshalListToPlainArray(rawValue) {
  const unwrapped = unwrapMarshalValue(rawValue);
  if (Array.isArray(unwrapped)) {
    return unwrapped;
  }
  return [];
}

function marshalObjectToPlainObject(rawValue) {
  if (rawValue instanceof Map) {
    return Object.fromEntries(rawValue.entries());
  }

  if (
    rawValue &&
    typeof rawValue === "object" &&
    (rawValue.type === "objectex1" || rawValue.type === "objectex2") &&
    Array.isArray(rawValue.header) &&
    rawValue.header.length >= 3 &&
    rawValue.header[2] &&
    rawValue.header[2].type === "dict" &&
    Array.isArray(rawValue.header[2].entries)
  ) {
    return Object.fromEntries(
      rawValue.header[2].entries.map(([key, value]) => [
        unwrapMarshalValue(key),
        unwrapMarshalValue(value),
      ]),
    );
  }

  const unwrapped = unwrapMarshalValue(rawValue);
  if (unwrapped instanceof Map) {
    return Object.fromEntries(unwrapped.entries());
  }

  if (unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)) {
    if (
      Array.isArray(unwrapped.header) &&
      unwrapped.header.length >= 3 &&
      unwrapped.header[2] instanceof Map
    ) {
      return Object.fromEntries(unwrapped.header[2].entries());
    }
    if (unwrapped.dict instanceof Map) {
      return Object.fromEntries(unwrapped.dict.entries());
    }
    return unwrapped;
  }
  return {};
}

function buildCreatedPreviousState(item, fallbackFlagID = ITEM_FLAGS.HANGAR) {
  return {
    locationID: 0,
    flagID: normalizeInteger(item && item.flagID, fallbackFlagID),
    quantity: 0,
    stacksize: 0,
    singleton: normalizeInteger(item && item.singleton, 0),
  };
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function getCharacterSessions(characterID) {
  return sessionRegistry
    .getSessions()
    .filter(
      (session) =>
        normalizePositiveInteger(session && session.characterID, 0) ===
        normalizePositiveInteger(characterID, 0),
    );
}

function buildOrderNotificationEntry(orderLike, overrides = {}) {
  const issueDate = isoTimestampToFileTimeBigInt(
    overrides.issued_at ??
      overrides.issuedAt ??
      (orderLike && orderLike.issued_at) ??
      (orderLike && orderLike.issuedAt),
  );
  const orderID =
    overrides.order_id ??
    overrides.orderId ??
    (orderLike && orderLike.order_id) ??
    (orderLike && orderLike.orderId);
  const row = orderLike && orderLike.row ? orderLike.row : orderLike || {};

  return buildKeyVal([
    ["orderID", buildSignedLong(orderID)],
    ["typeID", normalizePositiveInteger(overrides.type_id ?? row.type_id ?? row.typeID, 0)],
    ["charID", normalizePositiveInteger(
      overrides.char_id ??
        overrides.charID ??
        orderLike.owner_id ??
        orderLike.ownerId ??
        0,
      0,
    )],
    ["regionID", normalizePositiveInteger(overrides.region_id ?? row.region_id ?? row.regionID, 0)],
    ["stationID", normalizePositiveInteger(overrides.station_id ?? row.station_id ?? row.stationID, 0)],
    ["range", normalizeInteger(overrides.range_value ?? row.range_value ?? row.range ?? row.rangeValue, 0)],
    ["bid", normalizeBoolean(overrides.bid ?? row.bid) ? 1 : 0],
    ["price", roundIsk(overrides.price ?? row.price)],
    ["volEntered", normalizePositiveInteger(overrides.vol_entered ?? row.vol_entered ?? row.volEntered, 0)],
    ["volRemaining", normalizePositiveInteger(overrides.vol_remaining ?? row.vol_remaining ?? row.volRemaining, 0)],
    ["issueDate", buildFiletimeLong(issueDate)],
    ["minVolume", normalizePositiveInteger(overrides.min_volume ?? row.min_volume ?? row.minVolume, 1)],
    ["contraband", 0],
    ["duration", normalizeInteger(overrides.duration_days ?? row.duration_days ?? row.duration ?? 0, 0)],
    ["isCorp", normalizeBoolean(overrides.is_corp ?? orderLike.is_corp ?? orderLike.isCorp) ? 1 : 0],
    ["solarSystemID", normalizePositiveInteger(overrides.solar_system_id ?? row.solar_system_id ?? row.solarSystemID, 0)],
    ["escrow", roundIsk((Number(overrides.price ?? row.price) || 0) * (Number(overrides.vol_remaining ?? row.vol_remaining ?? row.volRemaining) || 0))],
  ]);
}

function notifyOwnOrdersChanged(characterID, orders = [], reason = ORDER_REASON_PARTIAL, isCorp = false) {
  const payload = buildList(
    ensureArray(orders).map((order) => buildOrderNotificationEntry(order)),
  );
  for (const session of getCharacterSessions(characterID)) {
    session.sendNotification("OnOwnOrdersChanged", "charid", [
      payload,
      String(reason || ORDER_REASON_PARTIAL),
      isCorp ? 1 : 0,
    ]);
  }
}

function buildImmediateMarketRefreshOrder({
  characterID,
  stationID,
  regionID,
  solarSystemID,
  constellationID,
  typeID,
  price,
  quantity,
  bid = false,
} = {}) {
  const normalizedQuantity = normalizePositiveInteger(quantity, 0);
  const normalizedTypeID = normalizePositiveInteger(typeID, 0);

  return {
    order_id: 0,
    owner_id: normalizePositiveInteger(characterID, 0),
    is_corp: false,
    state: "filled",
    row: {
      order_id: 0,
      type_id: normalizedTypeID,
      price: roundIsk(price),
      vol_entered: normalizedQuantity,
      vol_remaining: 0,
      min_volume: 1,
      bid: normalizeBoolean(bid),
      issued_at: new Date().toISOString(),
      duration_days: 0,
      range_value: normalizeBoolean(bid) ? RANGE_STATION : 32767,
      station_id: normalizePositiveInteger(stationID, 0),
      region_id: normalizePositiveInteger(regionID, 0),
      solar_system_id: normalizePositiveInteger(solarSystemID, 0),
      constellation_id: normalizePositiveInteger(constellationID, 0),
    },
  };
}

function notifyMarketItemReceived(characterID, item) {
  if (!item) {
    return;
  }

  for (const session of getCharacterSessions(characterID)) {
    session.sendNotification("OnMarketItemReceived", "charid", [
      normalizePositiveInteger(item.itemID, 0),
      normalizePositiveInteger(item.typeID, 0),
      normalizeInteger(item.flagID, ITEM_FLAGS.HANGAR),
      normalizePositiveInteger(item.locationID, 0),
    ]);
  }
}

function transformVisibleBuyerChanges(changes = [], ownerID) {
  return ensureArray(changes)
    .filter((change) => change && change.item)
    .map((change) => ({
      item: change.item,
      previousData: buildCreatedPreviousState(change.item),
      ownerID: normalizePositiveInteger(ownerID, 0),
    }));
}

function computeOrderValue(price, quantity) {
  return roundIsk((Number(price) || 0) * (Number(quantity) || 0));
}

function getMarketTypeLabel(typeID) {
  const itemType = resolveItemByTypeID(typeID);
  if (itemType && itemType.name) {
    return `${itemType.name} (${normalizePositiveInteger(typeID, 0)})`;
  }

  return `type ${normalizePositiveInteger(typeID, 0)}`;
}

function getMarketCounterpartyOwnerID(stationID) {
  const stationRecord = getStationRecord(null, stationID);
  return normalizePositiveInteger(
    stationRecord && (stationRecord.corporationID || stationRecord.ownerID),
    0,
  );
}

function recordCharacterMarketTransaction(characterID, entry = {}) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  if (!normalizedCharacterID) {
    return null;
  }

  return appendCharacterMarketTransaction(normalizedCharacterID, {
    accountID: ACCOUNT_KEY.CASH,
    buyerAccountID: ACCOUNT_KEY.CASH,
    sellerAccountID: ACCOUNT_KEY.CASH,
    ...entry,
  });
}

function buildCharacterMarketContext(session, characterID, stationID) {
  return getMarketContext({
    characterID,
    stationID,
    session,
  });
}

function getEscrowType(record) {
  return String(record && record.escrowType ? record.escrowType : "")
    .trim()
    .toLowerCase();
}

function upsertBuyEscrowRecord(orderLike, overrides = {}) {
  const orderRow = getOwnerOrderResponseOrder(orderLike);
  const orderID = normalizeOrderId(overrides.order_id ?? orderRow.order_id ?? orderLike.order_id);
  const ownerId = normalizePositiveInteger(
    overrides.owner_id ?? orderLike.owner_id ?? orderLike.ownerId,
    0,
  );
  const stationId = normalizePositiveInteger(
    overrides.station_id ?? orderRow.station_id ?? orderRow.stationID,
    0,
  );
  const typeId = normalizePositiveInteger(
    overrides.type_id ?? orderRow.type_id ?? orderRow.typeID,
    0,
  );
  const price = roundIsk(overrides.price ?? orderRow.price);
  const remainingQuantity = normalizePositiveInteger(
    overrides.vol_remaining ?? orderRow.vol_remaining ?? orderRow.volRemaining,
    0,
  );
  const existingRecord = getEscrowRecord(orderID);

  if (!ownerId || !stationId || !typeId || remainingQuantity <= 0) {
    return removeEscrowRecord(orderID);
  }

  return putEscrowRecord({
    orderId: orderID,
    ownerId,
    isCorp: false,
    escrowType: "buy",
    typeId,
    stationId,
    price,
    remainingQuantity,
    escrowAmount: computeOrderValue(price, remainingQuantity),
    createdAt:
      (existingRecord && existingRecord.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

function upsertSellEscrowRecord(record = {}) {
  return putEscrowRecord({
    ...record,
    escrowType: "sell",
  });
}

function ensureValidDuration(durationDays) {
  if (!isAllowedDuration(durationDays)) {
    throwWrappedUserError("CustomInfo", {
      info: `Market order duration ${durationDays} days is not supported.`,
    });
  }
}

function ensureValidBuyRange(rangeValue, limits) {
  const normalizedRange = normalizeInteger(rangeValue, RANGE_STATION);
  if (!isAllowedBuyRange(normalizedRange)) {
    throwWrappedUserError("CustomInfo", {
      info: `Market order range ${normalizedRange} is not supported.`,
    });
  }

  if (
    normalizedRange === RANGE_REGION &&
    normalizeInteger(limits && limits.vis, RANGE_STATION) !== RANGE_REGION
  ) {
    throwWrappedUserError("CustomInfo", {
      info: "The current Visibility skill level does not allow region-wide buy orders.",
    });
  }

  if (
    normalizedRange !== RANGE_REGION &&
    normalizedRange > normalizeInteger(limits && limits.vis, RANGE_STATION)
  ) {
    throwWrappedUserError("CustomInfo", {
      info: "The current Visibility skill level does not allow that buy-order range.",
    });
  }
}

function ensureValidMinVolume(quantity, minVolume) {
  const normalizedQuantity = normalizePositiveInteger(quantity, 0);
  const normalizedMinVolume = normalizePositiveInteger(minVolume, 1);
  if (normalizedMinVolume > normalizedQuantity) {
    throwWrappedUserError("MktInvalidMinVolumeCannotExceedQuantity");
  }
}

function ensureValidPrice(price) {
  const normalizedPrice = roundIsk(price);
  if (!(normalizedPrice > 0)) {
    throwWrappedUserError("CustomInfo", {
      info: "The market order price must be greater than zero.",
    });
  }
  if (normalizedPrice > MARKET_MAX_ORDER_PRICE) {
    throwWrappedUserError("CustomInfo", {
      info: `The market order price cannot exceed ${MARKET_MAX_ORDER_PRICE.toFixed(2)} ISK.`,
    });
  }
}

function ensureOpenOrderLimit(context, openOrders = []) {
  const openOrderCount = ensureArray(openOrders).filter((order) => {
    const state = String(order && order.state ? order.state : "open").toLowerCase();
    return state === "open";
  }).length;
  const maxOrderCount = normalizePositiveInteger(
    context && context.limits && context.limits.cnt,
    0,
  );
  if (maxOrderCount > 0 && openOrderCount >= maxOrderCount) {
    throwWrappedUserError("CustomInfo", {
      info: `The character already has ${openOrderCount} active market orders, which meets the current market-order skill limit of ${maxOrderCount}.`,
    });
  }
}

function ensureRemoteBuyOrderPlacementAllowed(session, stationID, context) {
  const jumps = getStationDistanceFromSession(session, stationID);
  if (jumps > normalizeInteger(context && context.limits && context.limits.bid, RANGE_STATION)) {
    throwWrappedUserError("CustomInfo", {
      info: "The current Procurement skill level does not allow placing a buy order at that location.",
    });
  }
}

function ensureRemoteSellOrderPlacementAllowed(session, stationID, context) {
  const jumps = getStationDistanceFromSession(session, stationID);
  if (jumps > normalizeInteger(context && context.limits && context.limits.ask, RANGE_STATION)) {
    throwWrappedUserError("CustomInfo", {
      info: "The current Marketing skill level does not allow selling from that location.",
    });
  }
}

function ensureRemoteOrderModificationAllowed(session, stationID, context) {
  const jumps = getStationDistanceFromSession(session, stationID);
  if (jumps > normalizeInteger(context && context.limits && context.limits.mod, RANGE_STATION)) {
    throwWrappedUserError("CustomInfo", {
      info: "The current Daytrading skill level does not allow modifying that order from the current location.",
    });
  }
}

function validateExpectedBrokerFeePercentage(expectedBrokerFee, marketContext) {
  if (
    expectedBrokerFee === null ||
    expectedBrokerFee === undefined ||
    expectedBrokerFee === ""
  ) {
    return;
  }

  const actualBrokerFee = Number(
    marketContext && marketContext.brokerCommissionRate,
  );
  if (!Number.isFinite(actualBrokerFee)) {
    return;
  }

  const normalizedExpected = Number(expectedBrokerFee);
  if (!Number.isFinite(normalizedExpected)) {
    return;
  }

  if (floatCloseEnough(actualBrokerFee, normalizedExpected)) {
    return;
  }

  throwWrappedUserError("MktBrokersFeeUnexpected2", {
    actualBrokerFeePerc: roundIsk(actualBrokerFee * 100),
    expectedBrokerFeePercentage: normalizedExpected,
    originalBrokersFeePerc: normalizedExpected,
  });
}

function getLastProcessedExpiryEventId() {
  const runtimeState = getMarketRuntimeState();
  return normalizeBigInt(runtimeState && runtimeState.lastProcessedExpiryEventId, 0n);
}

function setLastProcessedExpiryEventId(eventId) {
  return updateMarketRuntimeState({
    lastProcessedExpiryEventId: normalizeBigInt(eventId, 0n).toString(),
  });
}

function ensureCharacterHasFunds(characterID, amount, description) {
  const wallet = getCharacterWallet(characterID);
  if (!wallet) {
    throwWrappedUserError("CustomInfo", {
      info: "Character wallet is unavailable.",
    });
  }

  const normalizedAmount = roundIsk(amount);
  if (wallet.balance + 0.0001 < normalizedAmount) {
    throwWrappedUserError("CustomInfo", {
      info: `${description} requires ${normalizedAmount.toFixed(2)} ISK, but the character wallet does not have enough funds.`,
    });
  }
}

function debitCharacterWallet(
  characterID,
  amount,
  description,
  ownerID2 = 0,
  options = {},
) {
  const normalizedAmount = roundIsk(Math.abs(amount));
  if (!(normalizedAmount > 0)) {
    return null;
  }

  ensureCharacterHasFunds(characterID, normalizedAmount, description);
  const result = adjustCharacterBalance(characterID, -normalizedAmount, {
    description,
    ownerID1: options.ownerID1 ?? characterID,
    ownerID2: options.ownerID2 ?? ownerID2,
    referenceID: options.referenceID ?? ownerID2,
    entryTypeID: options.entryTypeID ?? JOURNAL_ENTRY_TYPE.ADMIN_ADJUSTMENT,
  });
  if (!result.success) {
    throwWrappedUserError("CustomInfo", {
      info: `${description} failed: ${result.errorMsg || "wallet write error"}.`,
    });
  }

  return result;
}

function creditCharacterWallet(
  characterID,
  amount,
  description,
  ownerID2 = 0,
  options = {},
) {
  const normalizedAmount = roundIsk(Math.abs(amount));
  if (!(normalizedAmount > 0)) {
    return null;
  }

  const result = adjustCharacterBalance(characterID, normalizedAmount, {
    description,
    ownerID1: options.ownerID1 ?? ownerID2,
    ownerID2: options.ownerID2 ?? characterID,
    referenceID: options.referenceID ?? ownerID2,
    entryTypeID: options.entryTypeID ?? JOURNAL_ENTRY_TYPE.ADMIN_ADJUSTMENT,
  });
  if (!result.success) {
    throwWrappedUserError("CustomInfo", {
      info: `${description} failed: ${result.errorMsg || "wallet write error"}.`,
    });
  }

  return result;
}

function applySignedCharacterWalletDelta(
  characterID,
  amount,
  description,
  ownerID2 = 0,
  options = {},
) {
  const normalizedAmount = roundIsk(amount);
  if (Math.abs(normalizedAmount) <= 0) {
    return null;
  }

  if (normalizedAmount > 0) {
    return creditCharacterWallet(
      characterID,
      normalizedAmount,
      description,
      ownerID2,
      options,
    );
  }

  return debitCharacterWallet(
    characterID,
    Math.abs(normalizedAmount),
    description,
    ownerID2,
    options,
  );
}

function assertPersonalMarketOnly(useCorp = false) {
  if (normalizeBoolean(useCorp)) {
    throwWrappedUserError("CustomInfo", {
      info: "Corporation market orders are not wired into corporation wallets and hangars yet.",
    });
  }
}

function getOwnerOrderResponseOrder(orderResponse) {
  return orderResponse && orderResponse.row ? orderResponse.row : orderResponse || {};
}

function listEscrowItemsForOrder(orderId, ownerId) {
  const escrowRecord = getEscrowRecord(orderId);
  if (!escrowRecord || getEscrowType(escrowRecord) !== "sell") {
    return [];
  }

  return listContainerItems(
    normalizePositiveInteger(ownerId, 0),
    normalizePositiveInteger(escrowRecord.escrowLocationID, 0),
    ITEM_FLAGS.HANGAR,
  );
}

function throwMarketUnavailable(method, error) {
  throwWrappedUserError("CustomInfo", {
    info: "Market is currently offline, elysian says sorry!",
  });
}

async function requestExpirySweepIfDue(force = false) {
  const now = Date.now();
  if (!force && now - lastForcedExpirySweepAt < MARKET_EXPIRY_SWEEP_THROTTLE_MS) {
    return null;
  }

  lastForcedExpirySweepAt = now;
  return marketDaemonClient.call("SweepExpiredOrders", {});
}

async function applyExpiredOrderEvent(event) {
  const order = event && event.order ? event.order : null;
  if (!order) {
    return;
  }

  const orderID = normalizeOrderId(order && order.order_id);
  const orderRow = getOwnerOrderResponseOrder(order);
  const ownerID = normalizePositiveInteger(order && order.owner_id, 0);
  if (!ownerID || normalizeBoolean(order && order.is_corp)) {
    return;
  }

  if (normalizeBoolean(orderRow && orderRow.bid)) {
    const escrowRecord = getEscrowRecord(orderID);
    if (escrowRecord && getEscrowType(escrowRecord) === "buy") {
      const stationID = normalizePositiveInteger(orderRow && orderRow.station_id, 0);
      creditCharacterWallet(
        ownerID,
        roundIsk(escrowRecord.escrowAmount),
        `Market escrow refund for expired buy order ${orderID}`,
        stationID,
        {
          entryTypeID: JOURNAL_ENTRY_TYPE.MARKET_ESCROW,
          ownerID1: getMarketCounterpartyOwnerID(stationID) || stationID,
          ownerID2: ownerID,
          referenceID: stationID,
        },
      );
      removeEscrowRecord(orderID);
    }
  } else {
    const escrowRecord = getEscrowRecord(orderID);
    if (escrowRecord && getEscrowType(escrowRecord) === "sell") {
      moveEscrowItemsBackToSeller(
        orderID,
        ownerID,
        normalizePositiveInteger(orderRow && orderRow.station_id, 0),
      );
      removeEscrowRecord(orderID);
    }
  }

  notifyOwnOrdersChanged(ownerID, [{
    ...order,
    state: "expired",
  }], ORDER_REASON_EXPIRED);
}

async function processPendingExpiryEvents({ forceSweep = false } = {}) {
  if (marketExpiryPollPromise) {
    return marketExpiryPollPromise;
  }

  marketExpiryPollPromise = (async () => {
    await requestExpirySweepIfDue(forceSweep);

    let afterEventId = getLastProcessedExpiryEventId();
    while (true) {
      const events = await marketDaemonClient.call("GetOrderEvents", {
        after_event_id: afterEventId.toString(),
        event_type: "expired",
        limit: 100,
      });
      if (!Array.isArray(events) || events.length === 0) {
        break;
      }

      for (const event of events) {
        await applyExpiredOrderEvent(event);
        afterEventId = normalizeBigInt(event && event.event_id, afterEventId);
        setLastProcessedExpiryEventId(afterEventId);
      }

      if (events.length < 100) {
        break;
      }
    }
  })().finally(() => {
    marketExpiryPollPromise = null;
  });

  return marketExpiryPollPromise;
}

function ensureMarketExpiryPollerStarted() {
  if (marketExpiryPollTimer) {
    return;
  }

  marketExpiryPollTimer = setInterval(() => {
    processPendingExpiryEvents().catch((error) => {
      log.debug(`[MarketProxy] Expiry poll skipped: ${error.message}`);
    });
  }, MARKET_EXPIRY_POLL_INTERVAL_MS);
  if (typeof marketExpiryPollTimer.unref === "function") {
    marketExpiryPollTimer.unref();
  }

  processPendingExpiryEvents().catch((error) => {
    log.debug(`[MarketProxy] Initial expiry sync skipped: ${error.message}`);
  });
}

async function fetchOrderById(orderID) {
  return marketDaemonClient.call("GetOrder", {
    order_id: normalizeOrderId(orderID),
  });
}

async function loadCharacterOrderOrThrow(session, orderID) {
  const order = await fetchOrderById(orderID);
  const ownerID = normalizePositiveInteger(order && order.owner_id, 0);
  const isCorp = normalizeBoolean(order && order.is_corp);
  const characterID = getNumericSessionValue(session, ["charid", "characterID"]);

  if (!ownerID || ownerID !== characterID || isCorp) {
    throwWrappedUserError("CustomInfo", {
      info: `Order ${normalizeOrderId(orderID)} is not owned by the active character.`,
    });
  }

  return order;
}

async function recordTrade(typeID, price, quantity) {
  if (!(normalizePositiveInteger(typeID, 0) > 0) || !(normalizePositiveInteger(quantity, 0) > 0)) {
    return null;
  }

  return marketDaemonClient.call("RecordTrade", {
    type_id: normalizePositiveInteger(typeID, 0),
    price: roundIsk(price),
    quantity: normalizePositiveInteger(quantity, 0),
  });
}

async function fetchCharacterOrders(characterID) {
  if (!normalizePositiveInteger(characterID, 0)) {
    return [];
  }

  const result = await marketDaemonClient.call("GetCharOrders", {
    owner_id: normalizePositiveInteger(characterID, 0),
    is_corp: false,
  });
  return Array.isArray(result) ? result : [];
}

function syncOpenBuyEscrowRecords(ownerOrders = []) {
  for (const ownerOrder of ensureArray(ownerOrders)) {
    const state = String(ownerOrder && ownerOrder.state ? ownerOrder.state : "open").toLowerCase();
    const orderRow = getOwnerOrderResponseOrder(ownerOrder);
    if (state !== "open" || !normalizeBoolean(orderRow && orderRow.bid)) {
      continue;
    }
    upsertBuyEscrowRecord(ownerOrder);
  }
}

function updateMovedItemsOwner(changes = [], ownerID) {
  const updatedItems = [];
  for (const change of ensureArray(changes)) {
    if (!change || !change.item) {
      continue;
    }

    const itemID = normalizePositiveInteger(change.item.itemID, 0);
    if (!itemID) {
      continue;
    }

    const updateResult = updateInventoryItem(itemID, (currentItem) => ({
      ...currentItem,
      ownerID: normalizePositiveInteger(ownerID, currentItem.ownerID),
    }));
    if (!updateResult.success) {
      throwWrappedUserError("CustomInfo", {
        info: `Failed to transfer delivered item ${itemID} to the target owner.`,
      });
    }

    change.item = updateResult.data;
    updatedItems.push(updateResult.data);
  }

  return updatedItems;
}

function notifyBuyerDelivery(characterID, changes = []) {
  const visibleChanges = transformVisibleBuyerChanges(changes, characterID);
  if (visibleChanges.length === 0) {
    return;
  }

  notifyInventoryChangesToCharacter(characterID, visibleChanges);
  for (const change of visibleChanges) {
    notifyMarketItemReceived(characterID, change.item);
  }
}

function consumeInventoryItemQuantity(itemID, quantity) {
  const numericItemID = normalizePositiveInteger(itemID, 0);
  const requestedQuantity = normalizePositiveInteger(quantity, 0);
  const currentItem = findItemById(numericItemID);

  if (!numericItemID || !requestedQuantity || !currentItem) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const availableQuantity =
    normalizeInteger(currentItem.singleton, 0) === 1
      ? 1
      : normalizePositiveInteger(currentItem.stacksize ?? currentItem.quantity, 0);

  if (availableQuantity <= 0 || requestedQuantity > availableQuantity) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_QUANTITY",
    };
  }

  if (normalizeInteger(currentItem.singleton, 0) === 1 || requestedQuantity === availableQuantity) {
    return removeInventoryItem(numericItemID, { removeContents: true });
  }

  const nextQuantity = availableQuantity - requestedQuantity;
  const updateResult = updateInventoryItem(numericItemID, (item) => ({
    ...item,
    quantity: nextQuantity,
    stacksize: nextQuantity,
    singleton: 0,
  }));

  if (!updateResult.success) {
    return updateResult;
  }

  return {
    success: true,
    data: {
      changes: [
        {
          item: updateResult.data,
          previousData: updateResult.previousData,
        },
      ],
    },
  };
}

function moveEscrowItemsBackToSeller(orderId, ownerId, stationId) {
  const escrowItems = listEscrowItemsForOrder(orderId, ownerId);
  const returnedChanges = [];

  for (const escrowItem of escrowItems) {
    const returnResult = moveItemToLocation(
      escrowItem.itemID,
      stationId,
      ITEM_FLAGS.HANGAR,
    );
    if (!returnResult.success) {
      throwWrappedUserError("CustomInfo", {
        info: `Failed to return escrowed items for order ${normalizeOrderId(orderId)}.`,
      });
    }

    for (const change of ensureArray(returnResult.data && returnResult.data.changes)) {
      if (change && change.item) {
        returnedChanges.push({
          item: change.item,
          previousData: buildCreatedPreviousState(change.item),
        });
      }
    }
  }

  if (returnedChanges.length > 0) {
    notifyInventoryChangesToCharacter(ownerId, returnedChanges);
  }
}

function deliverSeedItemToCharacter(characterID, stationID, typeID, quantity) {
  const grantResult = grantItemToCharacterLocation(
    characterID,
    stationID,
    ITEM_FLAGS.HANGAR,
    { typeID: normalizePositiveInteger(typeID, 0) },
    normalizePositiveInteger(quantity, 0),
  );

  if (!grantResult.success) {
    throwWrappedUserError("CustomInfo", {
      info: `Failed to deliver purchased item type ${typeID} to the destination hangar.`,
    });
  }

  const deliveredChanges = ensureArray(grantResult.data && grantResult.data.changes).map(
    (change) => ({
      item: change.item,
      previousData: buildCreatedPreviousState(change.item),
    }),
  );
  notifyInventoryChangesToCharacter(characterID, deliveredChanges);
  for (const change of deliveredChanges) {
    notifyMarketItemReceived(characterID, change.item);
  }
}

async function matchSellOrdersForBuyer({
  buyerCharacterID,
  regionID,
  typeID,
  maxPrice,
  requestedQuantity,
  orderRange,
  currentStationID,
  currentSolarSystemID,
  chargeBuyerWallet = true,
} = {}) {
  const book = await marketDaemonClient.call("GetOrders", {
    region_id: regionID,
    type_id: typeID,
  });
  const typeLabel = getMarketTypeLabel(typeID);

  let remainingQuantity = normalizePositiveInteger(requestedQuantity, 0);
  let totalSpent = 0;
  let totalBought = 0;

  for (const sellOrder of ensureArray(book && book.sells)) {
    if (remainingQuantity <= 0) {
      break;
    }

    const orderPrice = Number(sellOrder && sellOrder.price) || 0;
    if (!(orderPrice > 0) || orderPrice - 0.0001 > Number(maxPrice || 0)) {
      continue;
    }

    const availableQuantity = normalizePositiveInteger(
      sellOrder && sellOrder.vol_remaining,
      0,
    );
    if (availableQuantity <= 0) {
      continue;
    }

    if (
      !isSellOrderInRange(
        sellOrder,
        currentStationID,
        currentSolarSystemID,
        orderRange,
      )
    ) {
      continue;
    }

    const tradedQuantity = Math.min(remainingQuantity, availableQuantity);
    const destinationStationID = normalizePositiveInteger(
      sellOrder && sellOrder.station_id,
      currentStationID,
    );
    const grossCost = roundIsk(orderPrice * tradedQuantity);
    const stationMarketOwnerID = getMarketCounterpartyOwnerID(
      destinationStationID,
    );
    const marketCounterpartyOwnerID =
      String(sellOrder && sellOrder.source || "").toLowerCase() === "seed"
        ? stationMarketOwnerID
        : 0;
    let buyerWalletResult = null;
    if (chargeBuyerWallet) {
      buyerWalletResult = debitCharacterWallet(
        buyerCharacterID,
        grossCost,
        `Market purchase of ${typeLabel}`,
        destinationStationID,
        {
          entryTypeID: JOURNAL_ENTRY_TYPE.MARKET_TRANSACTION,
          ownerID1: marketCounterpartyOwnerID || destinationStationID,
          ownerID2: buyerCharacterID,
          referenceID: destinationStationID,
        },
      );
    }

    try {
      if (String(sellOrder && sellOrder.source || "").toLowerCase() === "seed") {
        await marketDaemonClient.call("AdjustSeedStock", {
          station_id: destinationStationID,
          type_id: typeID,
          delta_quantity: -tradedQuantity,
          reason: "market_buy_fill",
        });
        deliverSeedItemToCharacter(
          buyerCharacterID,
          destinationStationID,
          typeID,
          tradedQuantity,
        );
      } else {
        const playerSellOrder = await fetchOrderById(sellOrder && sellOrder.order_id);
        const sellerCharacterID = normalizePositiveInteger(
          playerSellOrder && playerSellOrder.owner_id,
          0,
        );
        const escrowRecord = getEscrowRecord(sellOrder && sellOrder.order_id);
        if (!sellerCharacterID || !escrowRecord) {
          throwWrappedUserError("CustomInfo", {
            info: `Market sell order ${normalizeOrderId(sellOrder && sellOrder.order_id)} is missing escrow state.`,
          });
        }

        const escrowItems = listEscrowItemsForOrder(
          sellOrder && sellOrder.order_id,
          sellerCharacterID,
        );
        let escrowRemaining = tradedQuantity;
        const buyerChanges = [];

        for (const escrowItem of escrowItems) {
          if (escrowRemaining <= 0) {
            break;
          }

          const itemQuantity =
            normalizeInteger(escrowItem && escrowItem.singleton, 0) === 1
              ? 1
              : normalizePositiveInteger(escrowItem && escrowItem.stacksize, 0);
          const moveQuantity = Math.min(escrowRemaining, itemQuantity);
          const moveResult = moveItemToLocation(
            escrowItem.itemID,
            destinationStationID,
            ITEM_FLAGS.HANGAR,
            moveQuantity,
          );
          if (!moveResult.success) {
            throwWrappedUserError("CustomInfo", {
              info: `Failed to move escrowed market item ${escrowItem.itemID} to the buyer.`,
            });
          }

          const destinationChanges = ensureArray(moveResult.data && moveResult.data.changes).filter(
            (change) =>
              change &&
              change.item &&
              normalizePositiveInteger(change.item.locationID, 0) === destinationStationID &&
              normalizePositiveInteger(change.item.typeID, 0) === typeID,
          );
          updateMovedItemsOwner(destinationChanges, buyerCharacterID);
          buyerChanges.push(...destinationChanges);
          escrowRemaining -= moveQuantity;
        }

        if (escrowRemaining > 0) {
          throwWrappedUserError("CustomInfo", {
            info: `Escrow for sell order ${normalizeOrderId(sellOrder && sellOrder.order_id)} did not contain enough items.`,
          });
        }

        notifyBuyerDelivery(buyerCharacterID, buyerChanges);
        const fillResponse = await marketDaemonClient.call("FillOrder", {
          order_id: normalizeOrderId(sellOrder && sellOrder.order_id),
          fill_quantity: tradedQuantity,
        });
        const grossAmount = roundIsk(orderPrice * tradedQuantity);
        const sellerMarketContext = buildCharacterMarketContext(
          null,
          sellerCharacterID,
          destinationStationID,
        );
        const salesTax = computeSalesTaxAmount(sellerMarketContext, grossAmount);
        const sellerWalletResult = creditCharacterWallet(
          sellerCharacterID,
          grossAmount,
          `Market sale proceeds for ${typeLabel}`,
          buyerCharacterID,
          {
            entryTypeID: JOURNAL_ENTRY_TYPE.MARKET_TRANSACTION,
            ownerID1: buyerCharacterID,
            ownerID2: sellerCharacterID,
            referenceID: destinationStationID,
          },
        );
        if (salesTax > 0) {
          debitCharacterWallet(
            sellerCharacterID,
            salesTax,
            `Transaction tax for sale of ${typeLabel}`,
            destinationStationID,
            {
              entryTypeID: JOURNAL_ENTRY_TYPE.TRANSACTION_TAX,
              ownerID1: stationMarketOwnerID || destinationStationID,
              ownerID2: sellerCharacterID,
              referenceID: destinationStationID,
            },
          );
        }
        await recordTrade(typeID, orderPrice, tradedQuantity);
        recordCharacterMarketTransaction(buyerCharacterID, {
          transactionDate: buyerWalletResult && buyerWalletResult.journalEntry
            ? buyerWalletResult.journalEntry.transactionDate
            : null,
          typeID,
          quantity: tradedQuantity,
          price: orderPrice,
          stationID: destinationStationID,
          buyerID: buyerCharacterID,
          sellerID: sellerCharacterID,
          clientID: sellerCharacterID,
          journalRefID:
            buyerWalletResult && buyerWalletResult.journalEntry
              ? buyerWalletResult.journalEntry.transactionID
              : -1,
        });
        recordCharacterMarketTransaction(sellerCharacterID, {
          transactionDate: sellerWalletResult && sellerWalletResult.journalEntry
            ? sellerWalletResult.journalEntry.transactionDate
            : null,
          typeID,
          quantity: tradedQuantity,
          price: orderPrice,
          stationID: destinationStationID,
          buyerID: buyerCharacterID,
          sellerID: sellerCharacterID,
          clientID: buyerCharacterID,
          journalRefID:
            sellerWalletResult && sellerWalletResult.journalEntry
              ? sellerWalletResult.journalEntry.transactionID
              : -1,
        });

        notifyOwnOrdersChanged(
          sellerCharacterID,
          [{
            ...playerSellOrder,
            row: {
              ...getOwnerOrderResponseOrder(playerSellOrder),
              vol_remaining: fillResponse.vol_remaining,
              price: fillResponse.price,
            },
            state: fillResponse.state,
          }],
          fillResponse.state === "filled" ? ORDER_REASON_FILLED : ORDER_REASON_PARTIAL,
        );

        if (fillResponse.state === "filled") {
          removeEscrowRecord(sellOrder && sellOrder.order_id);
        } else if (escrowRecord) {
          upsertSellEscrowRecord({
            ...escrowRecord,
            remainingQuantity: fillResponse.vol_remaining,
            updatedAt: new Date().toISOString(),
          });
        }
      }
      if (String(sellOrder && sellOrder.source || "").toLowerCase() === "seed") {
        recordCharacterMarketTransaction(buyerCharacterID, {
          transactionDate: buyerWalletResult && buyerWalletResult.journalEntry
            ? buyerWalletResult.journalEntry.transactionDate
            : null,
          typeID,
          quantity: tradedQuantity,
          price: orderPrice,
          stationID: destinationStationID,
          buyerID: buyerCharacterID,
          sellerID: marketCounterpartyOwnerID,
          clientID: marketCounterpartyOwnerID,
          journalRefID:
            buyerWalletResult && buyerWalletResult.journalEntry
              ? buyerWalletResult.journalEntry.transactionID
              : -1,
        });
      }
    } catch (error) {
      if (chargeBuyerWallet) {
        creditCharacterWallet(
          buyerCharacterID,
          grossCost,
          `Market purchase refund for ${typeLabel}`,
          destinationStationID,
          {
            entryTypeID: JOURNAL_ENTRY_TYPE.MARKET_TRANSACTION,
            referenceID: destinationStationID,
          },
        );
      }
      throw error;
    }

    totalSpent = roundIsk(totalSpent + grossCost);
    totalBought += tradedQuantity;
    remainingQuantity -= tradedQuantity;
  }

  return {
    boughtQuantity: totalBought,
    remainingQuantity,
    totalSpent: roundIsk(totalSpent),
  };
}

async function matchBuyOrdersForSeller({
  sellerCharacterID,
  regionID,
  stationID,
  solarSystemID,
  typeID,
  minimumPrice,
  requestedQuantity,
  sourceItemID,
  sourceOrderId,
} = {}) {
  const book = await marketDaemonClient.call("GetOrders", {
    region_id: regionID,
    type_id: typeID,
  });

  let remainingQuantity = normalizePositiveInteger(requestedQuantity, 0);
  let totalSold = 0;
  let totalGross = 0;
  const sellerMarketContext = buildCharacterMarketContext(
    null,
    sellerCharacterID,
    stationID,
  );
  const typeLabel = getMarketTypeLabel(typeID);

  for (const buyOrder of ensureArray(book && book.buys)) {
    if (remainingQuantity <= 0) {
      break;
    }

    const isSeedBuyOrder = String(buyOrder && buyOrder.source ? buyOrder.source : "")
      .trim()
      .toLowerCase() === "seed";
    const orderPrice = Number(buyOrder && buyOrder.price) || 0;
    if (!(orderPrice > 0) || orderPrice + 0.0001 < Number(minimumPrice || 0)) {
      continue;
    }

    const availableQuantity = normalizePositiveInteger(
      buyOrder && buyOrder.vol_remaining,
      0,
    );
    if (availableQuantity <= 0) {
      continue;
    }

    if (!isBidOrderInRange(buyOrder, stationID, solarSystemID)) {
      continue;
    }

    const minVolume = normalizePositiveInteger(buyOrder && buyOrder.min_volume, 1);
    const fillableQuantity = Math.min(remainingQuantity, availableQuantity);
    const meetsMinVolume =
      fillableQuantity >= minVolume ||
      (availableQuantity < minVolume && fillableQuantity >= availableQuantity);
    if (!meetsMinVolume) {
      continue;
    }

    let playerBuyOrder = null;
    let buyerCharacterID = 0;
    if (!isSeedBuyOrder) {
      playerBuyOrder = await fetchOrderById(buyOrder && buyOrder.order_id);
      buyerCharacterID = normalizePositiveInteger(
        playerBuyOrder && playerBuyOrder.owner_id,
        0,
      );
      if (!buyerCharacterID) {
        continue;
      }
    }

    const destinationStationID = normalizePositiveInteger(
      buyOrder && buyOrder.station_id,
      stationID,
    );
    const sellerInventoryChanges = [];
    let destinationChanges = [];

    if (normalizePositiveInteger(sourceOrderId, 0) > 0) {
      const escrowItems = listEscrowItemsForOrder(sourceOrderId, sellerCharacterID);
      let escrowRemaining = fillableQuantity;
      for (const escrowItem of escrowItems) {
        if (escrowRemaining <= 0) {
          break;
        }

        const itemQuantity =
          normalizeInteger(escrowItem && escrowItem.singleton, 0) === 1
            ? 1
            : normalizePositiveInteger(escrowItem && escrowItem.stacksize, 0);
        const moveQuantity = Math.min(escrowRemaining, itemQuantity);
        const transferResult = isSeedBuyOrder
          ? consumeInventoryItemQuantity(escrowItem.itemID, moveQuantity)
          : moveItemToLocation(
              escrowItem.itemID,
              destinationStationID,
              ITEM_FLAGS.HANGAR,
              moveQuantity,
            );
        if (!transferResult.success) {
          throwWrappedUserError("CustomInfo", {
            info: isSeedBuyOrder
              ? `Failed to consume escrowed sell-order item ${escrowItem.itemID} for seeded market demand.`
              : `Failed to transfer escrowed sell-order item ${escrowItem.itemID} into buyer delivery.`,
          });
        }

        const changeSet = ensureArray(transferResult.data && transferResult.data.changes);
        sellerInventoryChanges.push(...changeSet);
        if (!isSeedBuyOrder) {
          destinationChanges.push(
            ...changeSet.filter(
              (change) =>
                change &&
                change.item &&
                normalizePositiveInteger(change.item.typeID, 0) === typeID &&
                normalizePositiveInteger(change.item.locationID, 0) === destinationStationID,
            ),
          );
        }
        escrowRemaining -= moveQuantity;
      }

      if (escrowRemaining > 0) {
        throwWrappedUserError("CustomInfo", {
          info: `Escrow for sell order ${normalizeOrderId(sourceOrderId)} did not contain enough items.`,
        });
      }
    } else {
      const transferResult = isSeedBuyOrder
        ? consumeInventoryItemQuantity(sourceItemID, fillableQuantity)
        : moveItemToLocation(
            sourceItemID,
            destinationStationID,
            ITEM_FLAGS.HANGAR,
            fillableQuantity,
          );
      if (!transferResult.success) {
        throwWrappedUserError("CustomInfo", {
          info: isSeedBuyOrder
            ? `Failed to consume sold item ${sourceItemID} for seeded market demand.`
            : `Failed to transfer sold item ${sourceItemID} into buyer escrow.`,
        });
      }

      const changeSet = ensureArray(transferResult.data && transferResult.data.changes);
      sellerInventoryChanges.push(...changeSet);
      if (!isSeedBuyOrder) {
        destinationChanges = changeSet.filter(
          (change) =>
            change &&
            change.item &&
            normalizePositiveInteger(change.item.typeID, 0) === typeID &&
            normalizePositiveInteger(change.item.locationID, 0) === destinationStationID,
        );
      }
    }

    if (sellerInventoryChanges.length > 0) {
      notifyInventoryChangesToCharacter(
        sellerCharacterID,
        sellerInventoryChanges,
      );
    }

    if (!isSeedBuyOrder) {
      updateMovedItemsOwner(destinationChanges, buyerCharacterID);
      notifyBuyerDelivery(buyerCharacterID, destinationChanges);
    }

    const fillResponse = await marketDaemonClient.call("FillOrder", {
      order_id: normalizeOrderId(buyOrder && buyOrder.order_id),
      fill_quantity: fillableQuantity,
    });
    const grossAmount = roundIsk(orderPrice * fillableQuantity);
    const stationMarketOwnerID = getMarketCounterpartyOwnerID(
      destinationStationID,
    );
    const salesTax = computeSalesTaxAmount(sellerMarketContext, grossAmount);
    const sellerWalletResult = creditCharacterWallet(
      sellerCharacterID,
      grossAmount,
      `Market sale proceeds for ${typeLabel}`,
      isSeedBuyOrder ? destinationStationID : buyerCharacterID,
      {
        entryTypeID: JOURNAL_ENTRY_TYPE.MARKET_TRANSACTION,
        ownerID1: isSeedBuyOrder
          ? getMarketCounterpartyOwnerID(destinationStationID)
          : buyerCharacterID,
        ownerID2: sellerCharacterID,
        referenceID: destinationStationID,
      },
    );
    if (salesTax > 0) {
      debitCharacterWallet(
        sellerCharacterID,
        salesTax,
        `Transaction tax for sale of ${typeLabel}`,
        destinationStationID,
        {
          entryTypeID: JOURNAL_ENTRY_TYPE.TRANSACTION_TAX,
          ownerID1: stationMarketOwnerID || destinationStationID,
          ownerID2: sellerCharacterID,
          referenceID: destinationStationID,
        },
      );
    }
    await recordTrade(typeID, orderPrice, fillableQuantity);
    recordCharacterMarketTransaction(sellerCharacterID, {
      transactionDate: sellerWalletResult && sellerWalletResult.journalEntry
        ? sellerWalletResult.journalEntry.transactionDate
        : null,
      typeID,
      quantity: fillableQuantity,
      price: orderPrice,
      stationID: destinationStationID,
      buyerID: isSeedBuyOrder
        ? getMarketCounterpartyOwnerID(destinationStationID)
        : buyerCharacterID,
      sellerID: sellerCharacterID,
      clientID: isSeedBuyOrder
        ? getMarketCounterpartyOwnerID(destinationStationID)
        : buyerCharacterID,
      journalRefID:
        sellerWalletResult && sellerWalletResult.journalEntry
          ? sellerWalletResult.journalEntry.transactionID
          : -1,
    });

    if (!isSeedBuyOrder) {
      recordCharacterMarketTransaction(buyerCharacterID, {
        typeID,
        quantity: fillableQuantity,
        price: orderPrice,
        stationID: destinationStationID,
        buyerID: buyerCharacterID,
        sellerID: sellerCharacterID,
        clientID: sellerCharacterID,
        journalRefID: -1,
      });
      notifyOwnOrdersChanged(
        buyerCharacterID,
        [{
          ...playerBuyOrder,
          row: {
            ...getOwnerOrderResponseOrder(playerBuyOrder),
            vol_remaining: fillResponse.vol_remaining,
            price: fillResponse.price,
          },
          state: fillResponse.state,
        }],
        fillResponse.state === "filled" ? ORDER_REASON_FILLED : ORDER_REASON_PARTIAL,
      );

      if (fillResponse.state === "filled") {
        removeEscrowRecord(buyOrder && buyOrder.order_id);
      } else {
        upsertBuyEscrowRecord({
          ...playerBuyOrder,
          row: {
            ...getOwnerOrderResponseOrder(playerBuyOrder),
            price: fillResponse.price,
            vol_remaining: fillResponse.vol_remaining,
          },
        });
      }
    }

    totalSold += fillableQuantity;
    totalGross = roundIsk(totalGross + grossAmount);
    remainingQuantity -= fillableQuantity;
  }

  return {
    soldQuantity: totalSold,
    remainingQuantity,
    totalGross,
  };
}

async function executeBuyRequest({
  session,
  characterID,
  stationID,
  regionID,
  typeID,
  maxPrice,
  requestedQuantity,
  orderRange,
  minVolume,
  durationDays,
  expectedBrokerFee,
} = {}) {
  const normalizedQuantity = normalizePositiveInteger(requestedQuantity, 0);
  const normalizedPrice = roundIsk(maxPrice);
  const normalizedDuration = normalizeInteger(durationDays, 0);
  const normalizedMinVolume = Math.max(
    1,
    normalizePositiveInteger(minVolume, 1),
  );
  const typeLabel = getMarketTypeLabel(typeID);
  ensureValidPrice(normalizedPrice);
  ensureValidDuration(normalizedDuration);
  ensureValidMinVolume(normalizedQuantity, normalizedMinVolume);
  const marketContext = buildCharacterMarketContext(session, characterID, stationID);

  if (normalizedDuration > 0) {
    validateExpectedBrokerFeePercentage(expectedBrokerFee, marketContext);
    ensureValidBuyRange(orderRange, marketContext.limits);
    ensureRemoteBuyOrderPlacementAllowed(session, stationID, marketContext);
  }

  const openOrders = normalizedDuration > 0
    ? await fetchCharacterOrders(characterID)
    : [];
  if (normalizedDuration > 0) {
    syncOpenBuyEscrowRecords(openOrders);
    ensureOpenOrderLimit(marketContext, openOrders);
  }

  const reserveUpperBound = roundIsk(normalizedPrice * normalizedQuantity);
  const brokerFeeUpperBound = normalizedDuration > 0
    ? computeBrokerFeeInfo(marketContext, null, reserveUpperBound).amount
    : 0;
  const sccSurchargeUpperBound = normalizedDuration > 0
    ? computeSccSurchargeInfo(marketContext, null, reserveUpperBound).amount
    : 0;

  ensureCharacterHasFunds(
    characterID,
    reserveUpperBound + brokerFeeUpperBound + sccSurchargeUpperBound,
    `Placing a buy order for ${typeLabel}`,
  );

  const matchResult = await matchSellOrdersForBuyer({
    buyerCharacterID: characterID,
    regionID,
    typeID,
    maxPrice: normalizedPrice,
    requestedQuantity: normalizedQuantity,
    orderRange: normalizeInteger(orderRange, RANGE_STATION),
    currentStationID: stationID,
    currentSolarSystemID: getStationSolarSystemID(stationID),
  });

  let createdOrder = null;
  if (normalizedDuration > 0 && matchResult.remainingQuantity > 0) {
    const remainingReserve = roundIsk(normalizedPrice * matchResult.remainingQuantity);
    const brokerFeeInfo = computeBrokerFeeInfo(
      marketContext,
      null,
      remainingReserve,
    );
    const sccSurchargeInfo = computeSccSurchargeInfo(
      marketContext,
      null,
      remainingReserve,
    );
    const stationMarketOwnerID = getMarketCounterpartyOwnerID(stationID);
    debitCharacterWallet(
      characterID,
      remainingReserve,
      `Market escrow for buy order ${typeLabel}`,
      stationID,
      {
        entryTypeID: JOURNAL_ENTRY_TYPE.MARKET_ESCROW,
        ownerID1: stationMarketOwnerID || stationID,
        ownerID2: characterID,
        referenceID: stationID,
      },
    );
    debitCharacterWallet(
      characterID,
      brokerFeeInfo.amount,
      `Broker fee for buy order ${typeLabel}`,
      stationID,
      {
        entryTypeID: JOURNAL_ENTRY_TYPE.BROKERS_FEE,
        ownerID1: stationMarketOwnerID || stationID,
        ownerID2: characterID,
        referenceID: stationID,
      },
    );
    debitCharacterWallet(
      characterID,
      sccSurchargeInfo.amount,
      `SCC surcharge for buy order ${typeLabel}`,
      stationID,
      {
        entryTypeID: JOURNAL_ENTRY_TYPE.MARKET_PROVIDER_TAX,
        ownerID1: stationMarketOwnerID || stationID,
        ownerID2: characterID,
        referenceID: stationID,
      },
    );

    try {
      const placedOrder = await marketDaemonClient.call("PlaceOrder", {
        owner_id: characterID,
        is_corp: false,
        station_id: stationID,
        type_id: typeID,
        price: normalizedPrice,
        quantity: matchResult.remainingQuantity,
        min_volume: normalizedMinVolume,
        duration_days: normalizedDuration,
        range_value: normalizeInteger(orderRange, RANGE_STATION),
        bid: true,
        source: "player",
      });

      createdOrder = {
        order_id: placedOrder.order_id,
        owner_id: characterID,
        is_corp: false,
        state: "open",
        row: {
          order_id: placedOrder.order_id,
          price: normalizedPrice,
          vol_remaining: matchResult.remainingQuantity,
          type_id: typeID,
          range_value: normalizeInteger(orderRange, RANGE_STATION),
          vol_entered: matchResult.remainingQuantity,
          min_volume: normalizedMinVolume,
          bid: true,
          issued_at: new Date().toISOString(),
          duration_days: normalizedDuration,
          station_id: stationID,
          region_id: regionID,
          solar_system_id: getStationSolarSystemID(stationID),
          constellation_id: getStationConstellationID(stationID),
        },
      };
      upsertBuyEscrowRecord(createdOrder);
      notifyOwnOrdersChanged(characterID, [createdOrder], ORDER_REASON_CREATED);
    } catch (error) {
      creditCharacterWallet(
        characterID,
        remainingReserve,
        `Market escrow refund for failed buy order ${typeLabel}`,
        stationID,
        {
          entryTypeID: JOURNAL_ENTRY_TYPE.MARKET_ESCROW,
          ownerID1: stationMarketOwnerID || stationID,
          ownerID2: characterID,
          referenceID: stationID,
        },
      );
      creditCharacterWallet(
        characterID,
        brokerFeeInfo.amount,
        `Broker fee refund for failed buy order ${typeLabel}`,
        stationID,
        {
          entryTypeID: JOURNAL_ENTRY_TYPE.BROKERS_FEE,
          ownerID1: stationMarketOwnerID || stationID,
          ownerID2: characterID,
          referenceID: stationID,
        },
      );
      creditCharacterWallet(
        characterID,
        sccSurchargeInfo.amount,
        `SCC surcharge refund for failed buy order ${typeLabel}`,
        stationID,
        {
          entryTypeID: JOURNAL_ENTRY_TYPE.MARKET_PROVIDER_TAX,
          ownerID1: stationMarketOwnerID || stationID,
          ownerID2: characterID,
          referenceID: stationID,
        },
      );
      throw error;
    }
  }

  if (matchResult.boughtQuantity > 0 && !createdOrder) {
    notifyOwnOrdersChanged(
      characterID,
      [buildImmediateMarketRefreshOrder({
        characterID,
        stationID,
        regionID,
        solarSystemID: getStationSolarSystemID(stationID),
        constellationID: getStationConstellationID(stationID),
        typeID,
        price: normalizedPrice,
        quantity: matchResult.boughtQuantity,
        bid: false,
      })],
      ORDER_REASON_FILLED,
    );
  }

  return {
    boughtQuantity: matchResult.boughtQuantity,
    totalSpent: matchResult.totalSpent,
    createdOrder,
    remainingQuantity: matchResult.remainingQuantity,
  };
}

async function executeSellEntry({
  session,
  entry,
  durationDays,
  expectedBrokerFee,
} = {}) {
  const characterID = getNumericSessionValue(session, ["charid", "characterID"]);
  const regionID = getNumericSessionValue(session, ["regionid", "regionID"]);
  const typeID = normalizePositiveInteger(entry && entry.typeID, 0);
  const typeLabel = getMarketTypeLabel(typeID);
  const stationID = normalizePositiveInteger(entry && entry.stationID, 0);
  const price = roundIsk(entry && entry.price);
  const requestedQuantity = normalizePositiveInteger(entry && entry.quantity, 0);
  const itemID = normalizePositiveInteger(entry && entry.itemID, 0);
  const item = findItemById(itemID);

  if (!characterID || !regionID || !typeID || !stationID || !itemID || !requestedQuantity) {
    throwWrappedUserError("CustomInfo", {
      info: "Sell order request is missing required item details.",
    });
  }
  if (!item) {
    throwWrappedUserError("CustomInfo", {
      info: `Inventory item ${itemID} is no longer available.`,
    });
  }
  if (normalizePositiveInteger(item.ownerID, 0) !== characterID) {
    throwWrappedUserError("CustomInfo", {
      info: `Inventory item ${itemID} is not owned by the active character.`,
    });
  }
  if (
    normalizePositiveInteger(item.locationID, 0) !== stationID ||
    normalizeInteger(item.flagID, 0) !== ITEM_FLAGS.HANGAR
  ) {
    throwWrappedUserError("CustomInfo", {
      info: `Inventory item ${itemID} must be in the station hangar to sell it on the market.`,
    });
  }

  const normalizedDuration = normalizeInteger(durationDays, 0);
  ensureValidPrice(price);
  ensureValidDuration(normalizedDuration);
  const marketContext = buildCharacterMarketContext(session, characterID, stationID);
  if (normalizedDuration > 0) {
    validateExpectedBrokerFeePercentage(expectedBrokerFee, marketContext);
  }
  ensureRemoteSellOrderPlacementAllowed(session, stationID, marketContext);

  if (normalizedDuration > 0) {
    const openOrders = await fetchCharacterOrders(characterID);
    syncOpenBuyEscrowRecords(openOrders);
    ensureOpenOrderLimit(marketContext, openOrders);
  }

  const sellResult = await matchBuyOrdersForSeller({
    sellerCharacterID: characterID,
    regionID,
    stationID,
    solarSystemID: getStationSolarSystemID(stationID),
    typeID,
    minimumPrice: price,
    requestedQuantity,
    sourceItemID: itemID,
  });

  let createdOrder = null;
  if (normalizedDuration > 0 && sellResult.remainingQuantity > 0) {
    const openOrderValue = computeOrderValue(price, sellResult.remainingQuantity);
    const brokerFeeInfo = computeBrokerFeeInfo(
      marketContext,
      null,
      openOrderValue,
    );
    const sccSurchargeInfo = computeSccSurchargeInfo(
      marketContext,
      null,
      openOrderValue,
    );
    const stationMarketOwnerID = getMarketCounterpartyOwnerID(stationID);
    debitCharacterWallet(
      characterID,
      brokerFeeInfo.amount,
      `Broker fee for sell order ${typeLabel}`,
      stationID,
      {
        entryTypeID: JOURNAL_ENTRY_TYPE.BROKERS_FEE,
        ownerID1: stationMarketOwnerID || stationID,
        ownerID2: characterID,
        referenceID: stationID,
      },
    );
    debitCharacterWallet(
      characterID,
      sccSurchargeInfo.amount,
      `SCC surcharge for sell order ${typeLabel}`,
      stationID,
      {
        entryTypeID: JOURNAL_ENTRY_TYPE.MARKET_PROVIDER_TAX,
        ownerID1: stationMarketOwnerID || stationID,
        ownerID2: characterID,
        referenceID: stationID,
      },
    );

    const placedOrder = await marketDaemonClient.call("PlaceOrder", {
      owner_id: characterID,
      is_corp: false,
      station_id: stationID,
      type_id: typeID,
      price,
      quantity: sellResult.remainingQuantity,
      min_volume: 1,
      duration_days: normalizedDuration,
      range_value: RANGE_STATION,
      bid: false,
      source: "player",
    });

    const escrowLocationID =
      MARKET_ESCROW_LOCATION_BASE + normalizePositiveInteger(placedOrder.order_id, 0);

    try {
      const moveResult = moveItemToLocation(
        itemID,
        escrowLocationID,
        ITEM_FLAGS.HANGAR,
        sellResult.remainingQuantity,
      );
      if (!moveResult.success) {
        throwWrappedUserError("CustomInfo", {
          info: `Failed to escrow inventory item ${itemID} for market order ${normalizeOrderId(placedOrder.order_id)}.`,
        });
      }

      notifyInventoryChangesToCharacter(
        characterID,
        ensureArray(moveResult.data && moveResult.data.changes),
      );

      const putResult = upsertSellEscrowRecord({
        orderId: normalizeOrderId(placedOrder.order_id),
        ownerId: characterID,
        isCorp: false,
        typeId: typeID,
        stationId: stationID,
        escrowLocationID,
        remainingQuantity: sellResult.remainingQuantity,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      if (!putResult.success) {
        throwWrappedUserError("CustomInfo", {
          info: `Failed to persist escrow state for market order ${normalizeOrderId(placedOrder.order_id)}.`,
        });
      }

      createdOrder = {
        order_id: placedOrder.order_id,
        owner_id: characterID,
        is_corp: false,
        state: "open",
        row: {
          order_id: placedOrder.order_id,
          price,
          vol_remaining: sellResult.remainingQuantity,
          type_id: typeID,
          range_value: RANGE_STATION,
          vol_entered: sellResult.remainingQuantity,
          min_volume: 1,
          bid: false,
          issued_at: new Date().toISOString(),
          duration_days: normalizedDuration,
          station_id: stationID,
          region_id: regionID,
          solar_system_id: getStationSolarSystemID(stationID),
          constellation_id: getStationConstellationID(stationID),
        },
      };
      notifyOwnOrdersChanged(characterID, [createdOrder], ORDER_REASON_CREATED);
    } catch (error) {
      await marketDaemonClient.call("CancelOrder", {
        order_id: normalizeOrderId(placedOrder.order_id),
      });
      const strandedEscrowItems = listContainerItems(
        characterID,
        escrowLocationID,
        ITEM_FLAGS.HANGAR,
      );
      for (const strandedItem of strandedEscrowItems) {
        moveItemToLocation(strandedItem.itemID, stationID, ITEM_FLAGS.HANGAR);
      }
      creditCharacterWallet(
        characterID,
        brokerFeeInfo.amount,
        `Broker fee refund for failed sell order ${typeLabel}`,
        stationID,
        {
          entryTypeID: JOURNAL_ENTRY_TYPE.BROKERS_FEE,
          ownerID1: stationMarketOwnerID || stationID,
          ownerID2: characterID,
          referenceID: stationID,
        },
      );
      creditCharacterWallet(
        characterID,
        sccSurchargeInfo.amount,
        `SCC surcharge refund for failed sell order ${typeLabel}`,
        stationID,
        {
          entryTypeID: JOURNAL_ENTRY_TYPE.MARKET_PROVIDER_TAX,
          ownerID1: stationMarketOwnerID || stationID,
          ownerID2: characterID,
          referenceID: stationID,
        },
      );
      throw error;
    }
  }

  if (sellResult.soldQuantity > 0 && !createdOrder) {
    notifyOwnOrdersChanged(
      characterID,
      [buildImmediateMarketRefreshOrder({
        characterID,
        stationID,
        regionID,
        solarSystemID: getStationSolarSystemID(stationID),
        constellationID: getStationConstellationID(stationID),
        typeID,
        price,
        quantity: sellResult.soldQuantity,
        bid: false,
      })],
      ORDER_REASON_FILLED,
    );
  }

  return {
    soldQuantity: sellResult.soldQuantity,
    remainingQuantity: sellResult.remainingQuantity,
    createdOrder,
  };
}

async function applyBuyOrderCrossingAfterModify(session, order, newPrice) {
  const orderRow = getOwnerOrderResponseOrder(order);
  const remainingVolume = normalizePositiveInteger(orderRow && orderRow.vol_remaining, 0);
  const ownerID = normalizePositiveInteger(order && order.owner_id, 0);
  const stationID = normalizePositiveInteger(orderRow && orderRow.station_id, 0);
  const typeLabel = getMarketTypeLabel(orderRow && orderRow.type_id);
  if (remainingVolume <= 0) {
    removeEscrowRecord(order && order.order_id);
    return {
      state: String(order && order.state ? order.state : "open"),
      vol_remaining: remainingVolume,
      price: roundIsk(newPrice),
    };
  }

  const matchResult = await matchSellOrdersForBuyer({
    buyerCharacterID: normalizePositiveInteger(order && order.owner_id, 0),
    regionID: normalizePositiveInteger(orderRow && orderRow.region_id, 0),
    typeID: normalizePositiveInteger(orderRow && orderRow.type_id, 0),
    maxPrice: roundIsk(newPrice),
    requestedQuantity: remainingVolume,
    orderRange: normalizeInteger(orderRow && orderRow.range_value, RANGE_STATION),
    currentStationID: normalizePositiveInteger(orderRow && orderRow.station_id, 0),
    currentSolarSystemID: normalizePositiveInteger(orderRow && orderRow.solar_system_id, 0),
    chargeBuyerWallet: false,
  });

  if (matchResult.boughtQuantity <= 0) {
    upsertBuyEscrowRecord({
      ...order,
      row: {
        ...orderRow,
        price: roundIsk(newPrice),
        vol_remaining: remainingVolume,
      },
    });
    return {
      state: "open",
      vol_remaining: remainingVolume,
      price: roundIsk(newPrice),
    };
  }

  const reservedForMatchedVolume = computeOrderValue(
    roundIsk(newPrice),
    matchResult.boughtQuantity,
  );
  const priceImprovementRefund = roundIsk(
    reservedForMatchedVolume - roundIsk(matchResult.totalSpent),
  );
  if (priceImprovementRefund > 0) {
    creditCharacterWallet(
      ownerID,
      priceImprovementRefund,
      `Market price improvement refund for ${typeLabel} order ${normalizeOrderId(order && order.order_id)}`,
      stationID,
      {
        entryTypeID: JOURNAL_ENTRY_TYPE.MARKET_ESCROW,
        ownerID1: getMarketCounterpartyOwnerID(stationID) || stationID,
        ownerID2: ownerID,
        referenceID: stationID,
      },
    );
  }

  const fillResponse = await marketDaemonClient.call("FillOrder", {
    order_id: normalizeOrderId(order && order.order_id),
    fill_quantity: matchResult.boughtQuantity,
  });
  if (fillResponse.state === "filled") {
    removeEscrowRecord(order && order.order_id);
  } else {
    upsertBuyEscrowRecord({
      ...order,
      row: {
        ...orderRow,
        price: fillResponse.price,
        vol_remaining: fillResponse.vol_remaining,
      },
    });
  }

  return fillResponse;
}

async function applySellOrderCrossingAfterModify(session, order, newPrice) {
  const orderRow = getOwnerOrderResponseOrder(order);
  const remainingVolume = normalizePositiveInteger(orderRow && orderRow.vol_remaining, 0);
  if (remainingVolume <= 0) {
    removeEscrowRecord(order && order.order_id);
    return {
      state: String(order && order.state ? order.state : "open"),
      vol_remaining: remainingVolume,
      price: roundIsk(newPrice),
    };
  }

  const matchResult = await matchBuyOrdersForSeller({
    sellerCharacterID: normalizePositiveInteger(order && order.owner_id, 0),
    regionID: normalizePositiveInteger(orderRow && orderRow.region_id, 0),
    stationID: normalizePositiveInteger(orderRow && orderRow.station_id, 0),
    solarSystemID: normalizePositiveInteger(orderRow && orderRow.solar_system_id, 0),
    typeID: normalizePositiveInteger(orderRow && orderRow.type_id, 0),
    minimumPrice: roundIsk(newPrice),
    requestedQuantity: remainingVolume,
    sourceOrderId: normalizeOrderId(order && order.order_id),
  });

  if (matchResult.soldQuantity <= 0) {
    return {
      state: "open",
      vol_remaining: remainingVolume,
      price: roundIsk(newPrice),
    };
  }

  const fillResponse = await marketDaemonClient.call("FillOrder", {
    order_id: normalizeOrderId(order && order.order_id),
    fill_quantity: matchResult.soldQuantity,
  });
  const escrowRecord = getEscrowRecord(order && order.order_id);
  if (fillResponse.state === "filled") {
    removeEscrowRecord(order && order.order_id);
  } else if (escrowRecord) {
    upsertSellEscrowRecord({
      ...escrowRecord,
      remainingQuantity: fillResponse.vol_remaining,
      updatedAt: new Date().toISOString(),
    });
  }

  return fillResponse;
}

class MarketProxyService extends BaseService {
  constructor() {
    super("marketProxy");
    marketDaemonClient.startBackgroundConnect();
    ensureMarketExpiryPollerStarted();
  }

  async Handle_StartupCheck() {
    log.debug("[MarketProxy] StartupCheck");
    try {
      await marketDaemonClient.startupCheck();
      return null;
    } catch (error) {
      throwMarketUnavailable("StartupCheck", error);
    }
  }

  Handle_GetMarketGroups() {
    log.debug("[MarketProxy] GetMarketGroups");
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
      ROWSET_NAME,
    );
  }

  async Handle_GetStationAsks(args, session) {
    const stationID = getNumericSessionValue(session, [
      "stationid",
      "stationID",
      "locationid",
    ]);
    if (!stationID) {
      throwWrappedUserError("CustomInfo", {
        info: "Station market data is only available while docked in a station.",
      });
    }

    log.debug(`[MarketProxy] GetStationAsks station=${stationID}`);
    try {
      const result = await marketDaemonClient.call("GetStationAsks", {
        station_id: stationID,
      });
      return buildCachedMethodCallResult(
        buildSummaryDict(result, "tuple"),
        {
          method: "GetStationAsks",
          sessionInfo: "stationid",
          sessionInfoValue: stationID,
        },
      );
    } catch (error) {
      throwMarketUnavailable("GetStationAsks", error);
    }
  }

  async Handle_GetSystemAsks(args, session) {
    const solarSystemID = getNumericSessionValue(session, [
      "solarsystemid2",
      "solarsystemid",
      "solarSystemID",
    ]);
    if (!solarSystemID) {
      throwWrappedUserError("CustomInfo", {
        info: "System market data is only available while your session is in a solar system.",
      });
    }

    log.debug(`[MarketProxy] GetSystemAsks system=${solarSystemID}`);
    try {
      const result = await marketDaemonClient.call("GetSystemAsks", {
        solar_system_id: solarSystemID,
      });
      return buildCachedMethodCallResult(
        buildSummaryDict(result, "tuple"),
        {
          method: "GetSystemAsks",
          sessionInfo: "solarsystemid2",
          sessionInfoValue: solarSystemID,
        },
      );
    } catch (error) {
      throwMarketUnavailable("GetSystemAsks", error);
    }
  }

  async Handle_GetRegionBest(args, session) {
    const regionID = getNumericSessionValue(session, ["regionid", "regionID"]);
    if (!regionID) {
      throwWrappedUserError("CustomInfo", {
        info: "Region market data is unavailable because your session has no active region.",
      });
    }

    log.debug(`[MarketProxy] GetRegionBest region=${regionID}`);
    try {
      const result = await marketDaemonClient.call("GetRegionBest", {
        region_id: regionID,
      });
      return buildSummaryDict(result, "bestByOrder");
    } catch (error) {
      throwMarketUnavailable("GetRegionBest", error);
    }
  }

  async Handle_GetOrders(args, session) {
    const typeID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    const regionID = getNumericSessionValue(session, ["regionid", "regionID"]);
    const currentStationID = getNumericSessionValue(session, [
      "stationid",
      "stationID",
      "locationid",
    ]);
    const currentSolarSystemID = getNumericSessionValue(session, [
      "solarsystemid2",
      "solarsystemid",
      "solarSystemID",
    ]);
    log.debug(`[MarketProxy] GetOrders type=${typeID} region=${regionID}`);

    if (!typeID || !regionID) {
      return buildCachedMethodCallResult(
        [EMPTY_ORDER_ROWSET, EMPTY_ORDER_ROWSET],
        {
          method: "GetOrders",
          args: [typeID],
        },
      );
    }

    try {
      const result = await marketDaemonClient.call("GetOrders", {
        region_id: regionID,
        type_id: typeID,
      });
      return buildCachedMethodCallResult(
        [
          buildOrderRowset(result && result.sells, {
            currentStationID,
            currentSolarSystemID,
          }),
          buildOrderRowset(result && result.buys, {
            currentStationID,
            currentSolarSystemID,
          }),
        ],
        {
          method: "GetOrders",
          args: [typeID],
        },
      );
    } catch (error) {
      throwMarketUnavailable("GetOrders", error);
    }
  }

  async Handle_GetOldPriceHistory(args) {
    const typeID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    log.debug(`[MarketProxy] GetOldPriceHistory type=${typeID}`);
    if (!typeID) {
      return buildEmptyHistoryRowset();
    }

    try {
      const result = await marketDaemonClient.call("GetOldPriceHistory", {
        type_id: typeID,
      });
      return buildHistoryPair(result && result.rows)[0];
    } catch (error) {
      throwMarketUnavailable("GetOldPriceHistory", error);
    }
  }

  async Handle_GetNewPriceHistory(args) {
    const typeID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    log.debug(`[MarketProxy] GetNewPriceHistory type=${typeID}`);
    if (!typeID) {
      return buildEmptyHistoryRowset();
    }

    try {
      const result = await marketDaemonClient.call("GetNewPriceHistory", {
        type_id: typeID,
      });
      return buildHistoryPair(result && result.rows)[1];
    } catch (error) {
      throwMarketUnavailable("GetNewPriceHistory", error);
    }
  }

  async Handle_GetHistoryForManyTypeIDs(args) {
    const typeIDs = extractRequestedTypeIds(args && args.length > 0 ? args[0] : []);
    log.debug(`[MarketProxy] GetHistoryForManyTypeIDs count=${typeIDs.length}`);
    if (typeIDs.length === 0) {
      return buildDict([]);
    }

    try {
      let historyResponses = [];
      try {
        historyResponses = await marketDaemonClient.call("GetHistories", {
          type_ids: typeIDs,
        });
      } catch (batchError) {
        if (!String(batchError && batchError.message).includes("GetHistories")) {
          throw batchError;
        }
        historyResponses = await Promise.all(
          typeIDs.map((typeID) =>
            marketDaemonClient.call("GetHistory", {
              type_id: typeID,
            })),
        );
      }

      const historyEntries = (Array.isArray(historyResponses) ? historyResponses : [])
        .map((historyResponse) => {
          const typeID = Number(historyResponse && historyResponse.type_id) || 0;
          if (!typeID) {
            return null;
          }

          return [
            typeID,
            buildHistoryPair(historyResponse && historyResponse.rows),
          ];
        })
        .filter(Boolean);

      return buildDict(historyEntries);
    } catch (error) {
      throwMarketUnavailable("GetHistoryForManyTypeIDs", error);
    }
  }

  async Handle_GetCharOrders(args, session) {
    const characterID = getNumericSessionValue(session, ["charid", "characterID"]);
    log.debug(`[MarketProxy] GetCharOrders char=${characterID}`);
    if (!characterID) {
      return EMPTY_OWNER_ORDER_ROWSET;
    }

    try {
      await processPendingExpiryEvents();
      const result = await marketDaemonClient.call("GetCharOrders", {
        owner_id: characterID,
        is_corp: false,
      });
      const openOrders = (Array.isArray(result) ? result : []).filter(
        (order) => String(order && order.state ? order.state : "open").toLowerCase() === "open",
      );
      syncOpenBuyEscrowRecords(openOrders);
      return buildCachedMethodCallResult(
        buildOwnerOrdersRowset(openOrders),
        {
          method: "GetCharOrders",
          sessionInfo: "charid",
          sessionInfoValue: characterID,
        },
      );
    } catch (error) {
      throwMarketUnavailable("GetCharOrders", error);
    }
  }

  async Handle_GetCorporationOrders(args, session) {
    const corporationID = getNumericSessionValue(session, [
      "corpid",
      "corporationID",
    ]);
    log.debug(`[MarketProxy] GetCorporationOrders corp=${corporationID}`);
    if (!corporationID) {
      return EMPTY_OWNER_ORDER_ROWSET;
    }

    try {
      const result = await marketDaemonClient.call("GetCorporationOrders", {
        owner_id: corporationID,
        is_corp: true,
      });
      const openOrders = (Array.isArray(result) ? result : []).filter(
        (order) => String(order && order.state ? order.state : "open").toLowerCase() === "open",
      );
      return buildCachedMethodCallResult(
        buildOwnerOrdersRowset(openOrders),
        {
          method: "GetCorporationOrders",
          sessionInfo: "corpid",
          sessionInfoValue: corporationID,
        },
      );
    } catch (error) {
      throwMarketUnavailable("GetCorporationOrders", error);
    }
  }

  async Handle_GetMarketOrderHistory(args, session) {
    const characterID = getNumericSessionValue(session, ["charid", "characterID"]);
    const corporationID = getNumericSessionValue(session, [
      "corpid",
      "corporationID",
    ]);
    log.debug(
      `[MarketProxy] GetMarketOrderHistory char=${characterID} corp=${corporationID}`,
    );

    if (!characterID && !corporationID) {
      return EMPTY_OWNER_ORDER_ROWSET;
    }

    try {
      await processPendingExpiryEvents();
      const [charOrders, corpOrders] = await Promise.all([
        characterID
          ? marketDaemonClient.call("GetCharOrders", {
              owner_id: characterID,
              is_corp: false,
            })
          : Promise.resolve([]),
        corporationID
          ? marketDaemonClient.call("GetCorporationOrders", {
              owner_id: corporationID,
              is_corp: true,
            })
          : Promise.resolve([]),
      ]);

      const historyOrders = [...(Array.isArray(charOrders) ? charOrders : []), ...(Array.isArray(corpOrders) ? corpOrders : [])]
        .filter(
          (order) => String(order && order.state ? order.state : "open").toLowerCase() !== "open",
        );

      return buildCachedMethodCallResult(
        buildOwnerOrdersRowset(historyOrders),
        {
          method: "GetMarketOrderHistory",
          sessionInfo: "charid",
          sessionInfoValue: characterID,
        },
      );
    } catch (error) {
      throwMarketUnavailable("GetMarketOrderHistory", error);
    }
  }

  Handle_CharGetTransactions(args, session) {
    const characterID = getNumericSessionValue(session, ["charid", "characterID"]);
    const fromDate = args && args.length > 0 ? args[0] : null;
    log.debug(
      `[MarketProxy] CharGetTransactions char=${characterID} fromDate=${normalizeBigInt(fromDate, 0n).toString()}`,
    );

    if (!characterID) {
      return buildList([]);
    }

    return buildMarketTransactionList(
      filterMarketTransactionsFromDate(
        getCharacterMarketTransactions(characterID),
        fromDate,
      ),
    );
  }

  Handle_CorpGetTransactions(args, session) {
    const corporationID = getNumericSessionValue(session, [
      "corpid",
      "corporationID",
    ]);
    const fromDate = args && args.length > 0 ? args[0] : null;
    const accountKey = normalizePositiveInteger(args && args[1], ACCOUNT_KEY.CASH);
    log.debug(
      `[MarketProxy] CorpGetTransactions corp=${corporationID} accountKey=${accountKey} fromDate=${normalizeBigInt(fromDate, 0n).toString()}`,
    );
    return buildList([]);
  }

  async Handle_GetCharEscrow(args, session) {
    const characterID = getNumericSessionValue(session, ["charid", "characterID"]);
    log.debug(`[MarketProxy] GetCharEscrow char=${characterID}`);
    if (!characterID) {
      return buildKeyVal([
        ["iskEscrow", 0],
        ["itemsEscrow", 0],
      ]);
    }

    try {
      await processPendingExpiryEvents();
      const ownerOrders = await fetchCharacterOrders(characterID);
      syncOpenBuyEscrowRecords(ownerOrders);
      const escrowRecords = listEscrowRecords()
        .filter(
          (record) =>
            normalizePositiveInteger(record && record.ownerId, 0) === characterID &&
            !normalizeBoolean(record && record.isCorp),
        );

      const iskEscrow = escrowRecords
        .filter((record) => getEscrowType(record) === "buy")
        .reduce(
          (total, record) => total + roundIsk(record && record.escrowAmount),
          0,
        );
      const itemsEscrow = escrowRecords
        .filter((record) => getEscrowType(record) === "sell")
        .reduce(
          (total, record) =>
            total + normalizePositiveInteger(record && record.remainingQuantity, 0),
          0,
        );

      return buildKeyVal([
        ["iskEscrow", roundIsk(iskEscrow)],
        ["itemsEscrow", itemsEscrow],
      ]);
    } catch (error) {
      throwMarketUnavailable("GetCharEscrow", error);
    }
  }

  async Handle_GetPlexBest(args, session) {
    log.debug("[MarketProxy] GetPlexBest");
    const regionID = getNumericSessionValue(session, ["regionid", "regionID"]);
    if (!regionID) {
      return buildCachedMethodCallResult(
        buildDict([]),
        {
          method: "GetPlexBest",
          sessionInfo: "regionid",
          sessionInfoValue: regionID,
        },
      );
    }

    try {
      const result = await marketDaemonClient.call("GetRegionBest", {
        region_id: regionID,
      });
      const plexRows = (Array.isArray(result) ? result : []).filter(
        (row) => Number(row && row.type_id) === PLEX_TYPE_ID,
      );
      return buildCachedMethodCallResult(
        buildSummaryDict(plexRows, "bestByOrder"),
        {
          method: "GetPlexBest",
          sessionInfo: "regionid",
          sessionInfoValue: regionID,
        },
      );
    } catch (error) {
      throwMarketUnavailable("GetPlexBest", error);
    }
  }

  async Handle_GetPlexOrders(args, session) {
    log.debug("[MarketProxy] GetPlexOrders");
    const regionID = getNumericSessionValue(session, ["regionid", "regionID"]);
    if (!regionID) {
      return buildCachedMethodCallResult(
        [EMPTY_ORDER_ROWSET, EMPTY_ORDER_ROWSET],
        {
          method: "GetPlexOrders",
          sessionInfo: "regionid",
          sessionInfoValue: regionID,
        },
      );
    }

    try {
      const result = await marketDaemonClient.call("GetOrders", {
        region_id: regionID,
        type_id: PLEX_TYPE_ID,
      });
      return buildCachedMethodCallResult(
        [
          buildOrderRowset(result && result.sells),
          buildOrderRowset(result && result.buys),
        ],
        {
          method: "GetPlexOrders",
          sessionInfo: "regionid",
          sessionInfoValue: regionID,
        },
      );
    } catch (error) {
      throwMarketUnavailable("GetPlexOrders", error);
    }
  }

  async Handle_GetPlexHistory() {
    log.debug("[MarketProxy] GetPlexHistory");
    try {
      const result = await marketDaemonClient.call("GetHistory", {
        type_id: PLEX_TYPE_ID,
      });
      return buildDict([
        [PLEX_TYPE_ID, buildHistoryPair(result && result.rows)],
      ]);
    } catch (error) {
      throwMarketUnavailable("GetPlexHistory", error);
    }
  }

  async Handle_GetPlexOldPriceHistory() {
    log.debug("[MarketProxy] GetPlexOldPriceHistory");
    try {
      const result = await marketDaemonClient.call("GetOldPriceHistory", {
        type_id: PLEX_TYPE_ID,
      });
      return buildHistoryPair(result && result.rows)[0];
    } catch (error) {
      throwMarketUnavailable("GetPlexOldPriceHistory", error);
    }
  }

  async Handle_GetPlexNewPriceHistory() {
    log.debug("[MarketProxy] GetPlexNewPriceHistory");
    try {
      const result = await marketDaemonClient.call("GetNewPriceHistory", {
        type_id: PLEX_TYPE_ID,
      });
      return buildHistoryPair(result && result.rows)[1];
    } catch (error) {
      throwMarketUnavailable("GetPlexNewPriceHistory", error);
    }
  }

  async Handle_CancelCharOrder(args, session) {
    const orderID = normalizeOrderId(args && args.length > 0 ? args[0] : 0);
    log.debug(`[MarketProxy] CancelCharOrder order=${orderID}`);

    try {
      await processPendingExpiryEvents({ forceSweep: true });
      const order = await loadCharacterOrderOrThrow(session, orderID);
      const orderRow = getOwnerOrderResponseOrder(order);
      if (String(order && order.state ? order.state : "open").toLowerCase() !== "open") {
        return null;
      }
      const cancelResponse = await marketDaemonClient.call("CancelOrder", {
        order_id: orderID,
      });

      if (normalizeBoolean(orderRow && orderRow.bid) && cancelResponse && cancelResponse.invalidated) {
        const escrowRecord = getEscrowRecord(orderID);
        const refundAmount = escrowRecord && getEscrowType(escrowRecord) === "buy"
          ? roundIsk(escrowRecord.escrowAmount)
          : computeOrderValue(orderRow && orderRow.price, orderRow && orderRow.vol_remaining);
        const stationID = normalizePositiveInteger(orderRow && orderRow.station_id, 0);
        creditCharacterWallet(
          normalizePositiveInteger(order && order.owner_id, 0),
          refundAmount,
          `Market escrow refund for cancelled buy order ${orderID}`,
          stationID,
          {
            entryTypeID: JOURNAL_ENTRY_TYPE.MARKET_ESCROW,
            ownerID1: getMarketCounterpartyOwnerID(stationID) || stationID,
            ownerID2: normalizePositiveInteger(order && order.owner_id, 0),
            referenceID: stationID,
          },
        );
        removeEscrowRecord(orderID);
      }

      if (!normalizeBoolean(orderRow && orderRow.bid)) {
        moveEscrowItemsBackToSeller(
          orderID,
          normalizePositiveInteger(order && order.owner_id, 0),
          normalizePositiveInteger(orderRow && orderRow.station_id, 0),
        );
        removeEscrowRecord(orderID);
      }

      notifyOwnOrdersChanged(
        normalizePositiveInteger(order && order.owner_id, 0),
        [{
          ...order,
          state: String(cancelResponse && cancelResponse.state || "cancelled"),
        }],
        ORDER_REASON_CANCELLED,
      );
      return null;
    } catch (error) {
      if (isMachoWrappedException(error)) {
        throw error;
      }
      throwMarketUnavailable("CancelCharOrder", error);
    }
  }

  async Handle_PlaceBuyOrder(args, session) {
    const stationID = normalizePositiveInteger(args && args[0], 0);
    const typeID = normalizePositiveInteger(args && args[1], 0);
    const price = roundIsk(args && args[2]);
    const quantity = normalizePositiveInteger(args && args[3], 0);
    const orderRange = normalizeInteger(args && args[4], RANGE_STATION);
    const minVolume = normalizePositiveInteger(args && args[5], 1);
    const durationDays = normalizeInteger(args && args[6], 0);
    const useCorp = normalizeBoolean(args && args[7]);
    const expectedBrokerFee = args && args.length > 8 ? args[8] : null;
    const characterID = getNumericSessionValue(session, ["charid", "characterID"]);
    const regionID = getNumericSessionValue(session, ["regionid", "regionID"]);

    log.debug(
      `[MarketProxy] PlaceBuyOrder char=${characterID} station=${stationID} type=${typeID} quantity=${quantity} duration=${durationDays}`,
    );

    assertPersonalMarketOnly(useCorp);
    if (!characterID || !regionID || !stationID || !typeID || !quantity) {
      throwWrappedUserError("CustomInfo", {
        info: "Buy order request is missing required market details.",
      });
    }
    ensureValidPrice(price);

    try {
      await processPendingExpiryEvents({ forceSweep: true });
      const result = await executeBuyRequest({
        session,
        characterID,
        stationID,
        regionID,
        typeID,
        maxPrice: price,
        requestedQuantity: quantity,
        orderRange,
        minVolume,
        durationDays,
        expectedBrokerFee,
      });

      if (!result.createdOrder && result.boughtQuantity <= 0) {
        throwWrappedUserError("CustomInfo", {
          info: "No matching sell orders were available at the requested price.",
        });
      }

      return null;
    } catch (error) {
      if (isMachoWrappedException(error)) {
        throw error;
      }
      throwMarketUnavailable("PlaceBuyOrder", error);
    }
  }

  async Handle_BuyMultipleItems(args, session) {
    const stationID = normalizePositiveInteger(args && args[0], 0);
    const itemList = marshalListToPlainArray(args && args[1]);
    const useCorp = normalizeBoolean(args && args[2]);
    const characterID = getNumericSessionValue(session, ["charid", "characterID"]);
    const regionID = getNumericSessionValue(session, ["regionid", "regionID"]);

    log.debug(
      `[MarketProxy] BuyMultipleItems char=${characterID} station=${stationID} count=${itemList.length}`,
    );

    assertPersonalMarketOnly(useCorp);
    if (!characterID || !regionID || !stationID) {
      return [];
    }

    try {
      await processPendingExpiryEvents({ forceSweep: true });
      for (const rawEntry of itemList) {
        const entry = marshalObjectToPlainObject(rawEntry);
        const typeID = normalizePositiveInteger(entry && entry.typeID, 0);
        const quantity = normalizePositiveInteger(entry && entry.quantity, 0);
        const price = roundIsk(entry && entry.price);
        if (!typeID || !quantity) {
          continue;
        }
        ensureValidPrice(price);

        await executeBuyRequest({
          session,
          characterID,
          stationID,
          regionID,
          typeID,
          maxPrice: price,
          requestedQuantity: quantity,
          orderRange: RANGE_STATION,
          minVolume: normalizePositiveInteger(entry && entry.minVolume, 1),
          durationDays: 0,
        });
      }

      return [];
    } catch (error) {
      if (isMachoWrappedException(error)) {
        throw error;
      }
      throwMarketUnavailable("BuyMultipleItems", error);
    }
  }

  async Handle_PlaceMultiSellOrder(args, session) {
    const itemList = marshalListToPlainArray(args && args[0]);
    const useCorp = normalizeBoolean(args && args[1]);
    const durationDays = normalizeInteger(args && args[2], 0);
    const expectedBrokerFee = args && args.length > 3 ? args[3] : null;
    const characterID = getNumericSessionValue(session, ["charid", "characterID"]);

    log.debug(
      `[MarketProxy] PlaceMultiSellOrder char=${characterID} count=${itemList.length} duration=${durationDays}`,
    );

    assertPersonalMarketOnly(useCorp);
    if (!characterID || itemList.length === 0) {
      return false;
    }

    let hadTradeOrOrder = false;
    try {
      await processPendingExpiryEvents({ forceSweep: true });
      for (const rawEntry of itemList) {
        const entry = marshalObjectToPlainObject(rawEntry);
        const result = await executeSellEntry({
          session,
          entry,
          durationDays,
          expectedBrokerFee,
        });
        if ((result && result.soldQuantity > 0) || (result && result.createdOrder)) {
          hadTradeOrOrder = true;
        }
      }

      return hadTradeOrOrder;
    } catch (error) {
      if (isMachoWrappedException(error)) {
        throw error;
      }
      throwMarketUnavailable("PlaceMultiSellOrder", error);
    }
  }

  async Handle_PlacePlexSellOrder(args, session) {
    const entry = marshalObjectToPlainObject(args && args[0]);
    const useCorp = normalizeBoolean(args && args[1]);
    const durationDays = normalizeInteger(args && args[2], 0);
    const expectedBrokerFee = args && args.length > 3 ? args[3] : null;

    log.debug(
      `[MarketProxy] PlacePlexSellOrder item=${normalizePositiveInteger(entry && entry.itemID, 0)} duration=${durationDays}`,
    );

    assertPersonalMarketOnly(useCorp);
    if (normalizePositiveInteger(entry && entry.typeID, 0) !== PLEX_TYPE_ID) {
      throwWrappedUserError("CustomInfo", {
        info: "PLEX sell orders must use a PLEX inventory item.",
      });
    }

    try {
      await processPendingExpiryEvents({ forceSweep: true });
      const result = await executeSellEntry({
        session,
        entry,
        durationDays,
        expectedBrokerFee,
      });
      return Boolean((result && result.soldQuantity > 0) || (result && result.createdOrder));
    } catch (error) {
      if (isMachoWrappedException(error)) {
        throw error;
      }
      throwMarketUnavailable("PlacePlexSellOrder", error);
    }
  }

  async Handle_ModifyCharOrder(args, session) {
    const orderID = normalizeOrderId(args && args[0]);
    const newPrice = roundIsk(args && args[1]);

    log.debug(`[MarketProxy] ModifyCharOrder order=${orderID} price=${newPrice}`);

    ensureValidPrice(newPrice);

    try {
      await processPendingExpiryEvents({ forceSweep: true });
      const order = await loadCharacterOrderOrThrow(session, orderID);
      const orderRow = getOwnerOrderResponseOrder(order);
      if (String(order && order.state ? order.state : "open").toLowerCase() !== "open") {
        return null;
      }
      const oldPrice = Number(orderRow && orderRow.price) || 0;
      const remainingVolume = normalizePositiveInteger(orderRow && orderRow.vol_remaining, 0);
      const ownerID = normalizePositiveInteger(order && order.owner_id, 0);
      const stationID = normalizePositiveInteger(orderRow && orderRow.station_id, 0);
      const typeLabel = getMarketTypeLabel(orderRow && orderRow.type_id);
      const marketContext = buildCharacterMarketContext(session, ownerID, stationID);
      ensureRemoteOrderModificationAllowed(session, stationID, marketContext);
      if (!(remainingVolume > 0) || Math.abs(newPrice - oldPrice) < 0.0001) {
        return null;
      }

      const oldOrderValue = computeOrderValue(oldPrice, remainingVolume);
      const newOrderValue = computeOrderValue(newPrice, remainingVolume);
      const brokerFeeInfo = computeBrokerFeeInfo(
        marketContext,
        oldOrderValue,
        newOrderValue,
      );
      const sccSurchargeInfo = computeSccSurchargeInfo(
        marketContext,
        oldOrderValue,
        newOrderValue,
      );
      const reserveDelta = normalizeBoolean(orderRow && orderRow.bid)
        ? roundIsk(newOrderValue - oldOrderValue)
        : 0;
      const stationMarketOwnerID = getMarketCounterpartyOwnerID(stationID);
      applySignedCharacterWalletDelta(
        ownerID,
        -reserveDelta,
        reserveDelta > 0
          ? `Market escrow increase for modified ${typeLabel} order ${orderID}`
          : `Market escrow refund for modified ${typeLabel} order ${orderID}`,
        stationID,
        {
          entryTypeID: JOURNAL_ENTRY_TYPE.MARKET_ESCROW,
          ownerID1: stationMarketOwnerID || stationID,
          ownerID2: ownerID,
          referenceID: stationID,
        },
      );
      applySignedCharacterWalletDelta(
        ownerID,
        -brokerFeeInfo.amount,
        brokerFeeInfo.amount > 0
          ? `Broker fee for modified ${typeLabel} order ${orderID}`
          : `Broker fee refund for modified ${typeLabel} order ${orderID}`,
        stationID,
        {
          entryTypeID: JOURNAL_ENTRY_TYPE.BROKERS_FEE,
          ownerID1: stationMarketOwnerID || stationID,
          ownerID2: ownerID,
          referenceID: stationID,
        },
      );
      applySignedCharacterWalletDelta(
        ownerID,
        -sccSurchargeInfo.amount,
        sccSurchargeInfo.amount > 0
          ? `SCC surcharge for modified ${typeLabel} order ${orderID}`
          : `SCC surcharge refund for modified ${typeLabel} order ${orderID}`,
        stationID,
        {
          entryTypeID: JOURNAL_ENTRY_TYPE.MARKET_PROVIDER_TAX,
          ownerID1: stationMarketOwnerID || stationID,
          ownerID2: ownerID,
          referenceID: stationID,
        },
      );

      let finalState = String(order && order.state ? order.state : "open");
      let finalRemainingVolume = remainingVolume;
      try {
        const modifyResponse = await marketDaemonClient.call("ModifyOrder", {
          order_id: orderID,
          new_price: newPrice,
        });
        finalState = String(modifyResponse && modifyResponse.state ? modifyResponse.state : "open");
        finalRemainingVolume = normalizePositiveInteger(
          modifyResponse && modifyResponse.vol_remaining,
          remainingVolume,
        );

        if (normalizeBoolean(orderRow && orderRow.bid)) {
          const fillResponse = await applyBuyOrderCrossingAfterModify(session, order, newPrice);
          finalState = String(fillResponse && fillResponse.state ? fillResponse.state : finalState);
          finalRemainingVolume = normalizePositiveInteger(
            fillResponse && fillResponse.vol_remaining,
            finalRemainingVolume,
          );
        } else {
          const fillResponse = await applySellOrderCrossingAfterModify(session, order, newPrice);
          finalState = String(fillResponse && fillResponse.state ? fillResponse.state : finalState);
          finalRemainingVolume = normalizePositiveInteger(
            fillResponse && fillResponse.vol_remaining,
            finalRemainingVolume,
          );
        }
      } catch (error) {
        applySignedCharacterWalletDelta(
          ownerID,
          reserveDelta,
          reserveDelta > 0
            ? `Market escrow refund for failed modified ${typeLabel} order ${orderID}`
            : `Market escrow reversal for failed modified ${typeLabel} order ${orderID}`,
          stationID,
          {
            entryTypeID: JOURNAL_ENTRY_TYPE.MARKET_ESCROW,
            ownerID1: stationMarketOwnerID || stationID,
            ownerID2: ownerID,
            referenceID: stationID,
          },
        );
        applySignedCharacterWalletDelta(
          ownerID,
          brokerFeeInfo.amount,
          brokerFeeInfo.amount > 0
            ? `Broker fee refund for failed modified ${typeLabel} order ${orderID}`
            : `Broker fee reversal for failed modified ${typeLabel} order ${orderID}`,
          stationID,
          {
            entryTypeID: JOURNAL_ENTRY_TYPE.BROKERS_FEE,
            ownerID1: stationMarketOwnerID || stationID,
            ownerID2: ownerID,
            referenceID: stationID,
          },
        );
        applySignedCharacterWalletDelta(
          ownerID,
          sccSurchargeInfo.amount,
          sccSurchargeInfo.amount > 0
            ? `SCC surcharge refund for failed modified ${typeLabel} order ${orderID}`
            : `SCC surcharge reversal for failed modified ${typeLabel} order ${orderID}`,
          stationID,
          {
            entryTypeID: JOURNAL_ENTRY_TYPE.MARKET_PROVIDER_TAX,
            ownerID1: stationMarketOwnerID || stationID,
            ownerID2: ownerID,
            referenceID: stationID,
          },
        );
        throw error;
      }

      if (normalizeBoolean(orderRow && orderRow.bid)) {
        if (finalState === "filled") {
          removeEscrowRecord(orderID);
        } else {
          upsertBuyEscrowRecord({
            ...order,
            row: {
              ...orderRow,
              price: newPrice,
              vol_remaining: finalRemainingVolume,
            },
          });
        }
      }

      notifyOwnOrdersChanged(
        ownerID,
        [{
          ...order,
          row: {
            ...orderRow,
            price: newPrice,
            vol_remaining: finalRemainingVolume,
          },
          state: finalState,
        }],
        finalState === "filled"
          ? ORDER_REASON_FILLED
          : finalRemainingVolume < remainingVolume
            ? ORDER_REASON_PARTIAL
            : ORDER_REASON_MODIFIED,
      );
      return null;
    } catch (error) {
      if (isMachoWrappedException(error)) {
        throw error;
      }
      throwMarketUnavailable("ModifyCharOrder", error);
    }
  }

  async Handle_ModifyPlexCharOrder(args, session) {
    return this.Handle_ModifyCharOrder(args, session);
  }
}

module.exports = MarketProxyService;
module.exports.__testHooks = {
  buildOrderRowset,
  consumeInventoryItemQuantity,
  marshalObjectToPlainObject,
  normalizeInteger,
  normalizeNumericValue,
  normalizePositiveInteger,
};
