const path = require("path");

const {
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const { RAFFLE_STATUS } = require(path.join(
  __dirname,
  "./raffleConstants",
));
const config = require(path.join(__dirname, "../../config"));
const {
  BROKERS_FEE,
  RAFFLE_TAX_PERCENTAGE,
  DEFAULT_PLEX_PRICE_OVERRIDE,
  TOKEN_PRICE_DIVISOR,
  TICKET_COUNT_POOL,
  MIN_TOTAL_PRICE,
  MAX_TOTAL_PRICE,
  PRIVATE_RESTRICTION_ID,
  BLUEPRINT_TYPE,
  ALLOWED_CATEGORY_IDS,
} = require(path.join(__dirname, "./raffleConstants"));

function extractKwarg(kwargs, key) {
  if (!kwargs) {
    return undefined;
  }

  if (kwargs.type === "dict" && Array.isArray(kwargs.entries)) {
    const match = kwargs.entries.find((entry) => unwrapMarshalValue(entry[0]) === key);
    return match ? match[1] : undefined;
  }

  if (typeof kwargs === "object") {
    return kwargs[key];
  }

  return undefined;
}

function isMarshalKeyValName(value) {
  const normalizedName = unwrapMarshalValue(value);
  return (
    normalizedName === "util.KeyVal" ||
    normalizedName === "utillib.KeyVal" ||
    normalizedName === "KeyVal"
  );
}

function mapEntriesToObject(entries = [], depth = 0) {
  return Object.fromEntries(
    (Array.isArray(entries) ? entries : []).map(([entryKey, entryValue]) => [
      unwrapMarshalValue(entryKey, depth + 1),
      unwrapMarshalValue(entryValue, depth + 1),
    ]),
  );
}

function unwrapMarshalValue(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) {
    return value;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (Array.isArray(value)) {
    return value.map((entry) => unwrapMarshalValue(entry, depth + 1));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  switch (value.type) {
    case "token":
    case "wstring":
    case "rawstr":
      return value.value;
    case "long":
    case "int":
    case "real":
    case "varinteger":
      return unwrapMarshalValue(value.value, depth + 1);
    case "list":
    case "tuple":
    case "set":
      return Array.isArray(value.items)
        ? value.items.map((entry) => unwrapMarshalValue(entry, depth + 1))
        : [];
    case "dict":
      return mapEntriesToObject(value.entries, depth + 1);
    case "object":
      if (isMarshalKeyValName(value.name)) {
        if (
          value.args &&
          value.args.type === "dict" &&
          Array.isArray(value.args.entries)
        ) {
          return mapEntriesToObject(value.args.entries, depth + 1);
        }
        return unwrapMarshalValue(value.args, depth + 1);
      }
      if (Object.prototype.hasOwnProperty.call(value, "args")) {
        return unwrapMarshalValue(value.args, depth + 1);
      }
      break;
    case "objectex1":
    case "objectex2":
      if (
        Array.isArray(value.header) &&
        value.header.length >= 3 &&
        isMarshalKeyValName(value.header[0]) &&
        value.header[2] &&
        value.header[2].type === "dict" &&
        Array.isArray(value.header[2].entries)
      ) {
        return mapEntriesToObject(value.header[2].entries, depth + 1);
      }
      if (Array.isArray(value.header) && value.header.length >= 2) {
        const objectPayload = unwrapMarshalValue(value.header[1], depth + 1);
        if (
          objectPayload &&
          typeof objectPayload === "object" &&
          !Array.isArray(objectPayload)
        ) {
          return objectPayload;
        }
      }
      return {
        header: unwrapMarshalValue(value.header, depth + 1),
        list: unwrapMarshalValue(value.list, depth + 1),
        dict: unwrapMarshalValue(value.dict, depth + 1),
      };
    default:
      if (Object.prototype.hasOwnProperty.call(value, "value")) {
        return unwrapMarshalValue(value.value, depth + 1);
      }
      break;
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      unwrapMarshalValue(entryValue, depth + 1),
    ]),
  );
}

function machoDictToObject(value) {
  if (!value) {
    return {};
  }

  const unwrapped = unwrapMarshalValue(value);
  if (unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)) {
    return { ...unwrapped };
  }

  return {};
}

function machoObjectToObject(value) {
  if (!value) {
    return {};
  }

  const unwrapped = unwrapMarshalValue(value);
  if (unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)) {
    return { ...unwrapped };
  }

  return {};
}

function normalizeInteger(value, fallback = 0) {
  const numericValue = normalizeNumber(value, fallback);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
}

function getSessionCharacterID(session) {
  return normalizeInteger(
    session && (session.characterID || session.charid),
    0,
  );
}

function getSessionClientID(session) {
  return normalizeInteger(
    session && (session.clientID || session.clientId),
    0,
  );
}

function getSessionStationID(session) {
  return normalizeInteger(
    session && (session.stationid || session.stationID),
    0,
  );
}

function ticketMatchesOwner(ticket, ownerId) {
  return normalizeInteger(ticket && ticket.ownerId, 0) === normalizeInteger(ownerId, 0);
}

function ticketMatchesNumber(ticket, ticketNumber) {
  return normalizeInteger(ticket && ticket.number, -1) === normalizeInteger(ticketNumber, -2);
}

function dedupeTicketNumbers(values = []) {
  const uniqueNumbers = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const ticketNumber = normalizeInteger(value, -1);
    if (ticketNumber < 0 || seen.has(ticketNumber)) {
      continue;
    }
    seen.add(ticketNumber);
    uniqueNumbers.push(ticketNumber);
  }
  return uniqueNumbers;
}

function pickSeedPolarisItem(items, preferredTypeIds = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  for (const typeId of preferredTypeIds) {
    const matchingItem = items.find(
      (item) => normalizeInteger(item && item.typeID, 0) === typeId,
    );
    if (matchingItem) {
      return matchingItem;
    }
  }

  return items.find((item) => normalizeInteger(item && item.itemID, 0) > 0) || null;
}

function shuffleArray(values = []) {
  const copy = Array.isArray(values) ? [...values] : [];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function pickRandomEntries(values = [], count = 0) {
  const normalizedCount = Math.max(0, normalizeInteger(count, 0));
  if (normalizedCount === 0) {
    return [];
  }

  return shuffleArray(values).slice(0, normalizedCount);
}

function calculateTotalPrice(ticketPrice, ticketCount) {
  return normalizeInteger(ticketPrice, 0) * normalizeInteger(ticketCount, 0);
}

function calculateSalesTax(totalPrice) {
  return Math.round(normalizeNumber(totalPrice, 0) * RAFFLE_TAX_PERCENTAGE * 100) / 100;
}

function calculateSellerPayout(totalPrice) {
  return Math.max(0, normalizeNumber(totalPrice, 0) - calculateSalesTax(totalPrice));
}

function getPlexPriceOverride() {
  const configuredValue = normalizeInteger(
    config.hyperNetPlexPriceOverride,
    DEFAULT_PLEX_PRICE_OVERRIDE,
  );
  return configuredValue > 0 ? configuredValue : DEFAULT_PLEX_PRICE_OVERRIDE;
}

function tokensRequired(totalPrice) {
  const plexPrice = getPlexPriceOverride();
  const tokenPrice = Math.max(1, Math.trunc(plexPrice / TOKEN_PRICE_DIVISOR));
  return Math.max(
    1,
    Math.trunc((normalizeNumber(totalPrice, 0) / tokenPrice) * BROKERS_FEE),
  );
}

function normalizeRestrictionId(value) {
  return normalizeInteger(value, 0) === PRIVATE_RESTRICTION_ID
    ? PRIVATE_RESTRICTION_ID
    : null;
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  }
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")) {
    return normalizeBoolean(value.value);
  }
  return false;
}

function isAllowedCategoryId(categoryId) {
  return ALLOWED_CATEGORY_IDS.includes(normalizeInteger(categoryId, 0));
}

function isSupportedTicketCount(ticketCount) {
  return TICKET_COUNT_POOL.includes(normalizeInteger(ticketCount, 0));
}

function isValidTotalPrice(totalPrice) {
  const normalizedTotalPrice = normalizeNumber(totalPrice, 0);
  return normalizedTotalPrice >= MIN_TOTAL_PRICE && normalizedTotalPrice <= MAX_TOTAL_PRICE;
}

function matchesBlueprintType(raffleState, blueprintType) {
  const normalizedBlueprintType = normalizeInteger(blueprintType, BLUEPRINT_TYPE.ALL);
  if (normalizedBlueprintType === BLUEPRINT_TYPE.ALL) {
    return true;
  }

  const isCopy = Boolean(
    raffleState &&
      raffleState.metaData &&
      normalizeBoolean(raffleState.metaData.is_copy),
  );
  if (normalizedBlueprintType === BLUEPRINT_TYPE.COPY) {
    return isCopy;
  }
  if (normalizedBlueprintType === BLUEPRINT_TYPE.ORIGINAL) {
    return !isCopy;
  }
  return true;
}

function matchesGrabFilters(raffleState, filters = {}, constraints = {}, viewerCharacterId = 0) {
  const typeId = normalizeInteger(filters.type_id, 0);
  const groupId = normalizeInteger(filters.group_id, 0);
  const categoryId = normalizeInteger(filters.category_id, 0);
  const solarSystemId = normalizeInteger(filters.solar_system_id, 0);
  const metaGroupId = normalizeInteger(filters.meta_group_id, 0);
  const blueprintType = normalizeInteger(filters.blueprint_type, BLUEPRINT_TYPE.ALL);
  const minTicketPrice = normalizeInteger(constraints.min_ticket_price, 0);
  const maxTicketPrice = normalizeInteger(constraints.max_ticket_price, 0);
  const minTicketCount = normalizeInteger(constraints.min_ticket_count, 0);
  const maxTicketCount = normalizeInteger(constraints.max_ticket_count, 0);
  const ownerId = normalizeInteger(raffleState && raffleState.ownerId, 0);
  const normalizedViewerCharacterId = normalizeInteger(viewerCharacterId, 0);
  const isPrivate = normalizeInteger(
    raffleState && raffleState.restrictionId,
    0,
  ) === PRIVATE_RESTRICTION_ID;
  const viewerOwnsTicket = Array.isArray(raffleState && raffleState.soldTickets) &&
    raffleState.soldTickets.some((ticket) => ticketMatchesOwner(ticket, normalizedViewerCharacterId));

  if (isPrivate && normalizedViewerCharacterId > 0) {
    if (normalizedViewerCharacterId !== ownerId && !viewerOwnsTicket) {
      return false;
    }
  } else if (isPrivate) {
    return false;
  }

  if (typeId && normalizeInteger(raffleState && raffleState.typeId, 0) !== typeId) {
    return false;
  }
  if (groupId && normalizeInteger(raffleState && raffleState.groupId, 0) !== groupId) {
    return false;
  }
  if (categoryId && normalizeInteger(raffleState && raffleState.categoryId, 0) !== categoryId) {
    return false;
  }
  if (
    solarSystemId &&
    normalizeInteger(raffleState && raffleState.solarSystemId, 0) !== solarSystemId
  ) {
    return false;
  }
  if (
    metaGroupId &&
    normalizeInteger(raffleState && raffleState.metaGroupId, 0) !== metaGroupId
  ) {
    return false;
  }
  if (!matchesBlueprintType(raffleState, blueprintType)) {
    return false;
  }
  if (
    minTicketPrice &&
    normalizeInteger(raffleState && raffleState.ticketPrice, 0) < minTicketPrice
  ) {
    return false;
  }
  if (
    maxTicketPrice &&
    normalizeInteger(raffleState && raffleState.ticketPrice, 0) > maxTicketPrice
  ) {
    return false;
  }
  if (
    minTicketCount &&
    normalizeInteger(raffleState && raffleState.ticketCount, 0) < minTicketCount
  ) {
    return false;
  }
  if (
    maxTicketCount &&
    normalizeInteger(raffleState && raffleState.ticketCount, 0) > maxTicketCount
  ) {
    return false;
  }
  return true;
}

function isExpired(raffleState, nowFileTime) {
  if (!raffleState) {
    return false;
  }
  const currentTime =
    typeof nowFileTime === "bigint"
      ? nowFileTime
      : BigInt(normalizeInteger(nowFileTime, 0));
  return (
    !isFinishedStatus(raffleState.raffleStatus) &&
    typeof raffleState.expirationTime === "bigint" &&
    raffleState.expirationTime <= currentTime
  );
}

function groupTicketsByOwner(tickets = []) {
  const grouped = new Map();
  for (const ticket of Array.isArray(tickets) ? tickets : []) {
    const ownerId = normalizeInteger(ticket && ticket.ownerId, 0);
    if (ownerId <= 0) {
      continue;
    }
    if (!grouped.has(ownerId)) {
      grouped.set(ownerId, []);
    }
    grouped.get(ownerId).push(ticket);
  }
  return grouped;
}

function pickWinningTicket(tickets = []) {
  if (!Array.isArray(tickets) || tickets.length === 0) {
    return null;
  }
  const winnerIndex = Math.floor(Math.random() * tickets.length);
  return tickets[winnerIndex] || tickets[0] || null;
}

function buildCreationPayload(rawValue) {
  const creationData = machoObjectToObject(rawValue);
  return {
    owner_id: normalizeInteger(creationData.owner_id, 0),
    location_id: normalizeInteger(creationData.location_id, 0),
    solar_system_id: normalizeInteger(creationData.solar_system_id, 0),
    token_id: normalizeInteger(creationData.token_id, 0),
    token_location_id: normalizeInteger(creationData.token_location_id, 0),
    item_id: normalizeInteger(creationData.item_id, 0),
    type_id: normalizeInteger(creationData.type_id, 0),
    ticket_count: normalizeInteger(creationData.ticket_count, 0),
    ticket_price: normalizeInteger(creationData.ticket_price, 0),
    restriction_id: normalizeRestrictionId(creationData.restriction_id),
    owner_location_id: normalizeInteger(creationData.owner_location_id, 0),
    raw: creationData,
  };
}

function isFinishedStatus(raffleStatus) {
  const normalizedStatus = normalizeInteger(raffleStatus, 0);
  return normalizedStatus >= RAFFLE_STATUS.FINISHED_UNDELIVERED;
}

module.exports = {
  extractKwarg,
  machoDictToObject,
  machoObjectToObject,
  normalizeInteger,
  normalizeBoolean,
  getSessionCharacterID,
  getSessionClientID,
  getSessionStationID,
  ticketMatchesOwner,
  ticketMatchesNumber,
  dedupeTicketNumbers,
  pickSeedPolarisItem,
  pickRandomEntries,
  shuffleArray,
  calculateTotalPrice,
  calculateSalesTax,
  calculateSellerPayout,
  tokensRequired,
  normalizeRestrictionId,
  isAllowedCategoryId,
  isSupportedTicketCount,
  isValidTotalPrice,
  matchesBlueprintType,
  matchesGrabFilters,
  isExpired,
  groupTicketsByOwner,
  pickWinningTicket,
  buildCreationPayload,
  isFinishedStatus,
};
