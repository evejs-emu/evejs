const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  normalizeBigInt,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  normalizeInteger,
} = require(path.join(__dirname, "./raffleHelpers"));

const TABLE = "raffles";
const FILETIME_FIELDS = Object.freeze([
  "creationTime",
  "expirationTime",
  "endDate",
]);

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeRaffleKey(raffleId) {
  const numericId = normalizeInteger(raffleId, 0);
  return numericId > 0 ? String(numericId) : "";
}

function encodeFileTime(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return normalizeBigInt(value, 0n).toString();
}

function decodeFileTime(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return normalizeBigInt(value, 0n);
}

function encodeTicket(ticket) {
  if (!ticket || typeof ticket !== "object") {
    return null;
  }

  return {
    runningId: normalizeInteger(ticket.runningId, 0),
    raffleId: normalizeInteger(ticket.raffleId, 0),
    ownerId: normalizeInteger(ticket.ownerId, 0),
    number: normalizeInteger(ticket.number, 0),
  };
}

function decodeTicket(ticket) {
  if (!ticket || typeof ticket !== "object") {
    return null;
  }

  return {
    runningId: normalizeInteger(ticket.runningId, 0),
    raffleId: normalizeInteger(ticket.raffleId, 0),
    ownerId: normalizeInteger(ticket.ownerId, 0),
    number: normalizeInteger(ticket.number, 0),
  };
}

function encodeRaffleState(raffleState) {
  if (!raffleState || typeof raffleState !== "object") {
    return null;
  }

  const encoded = {
    ...raffleState,
    soldTickets: Array.isArray(raffleState.soldTickets)
      ? raffleState.soldTickets.map(encodeTicket).filter(Boolean)
      : [],
    winningTicket: encodeTicket(raffleState.winningTicket),
    metaData:
      raffleState.metaData && typeof raffleState.metaData === "object"
        ? cloneValue(raffleState.metaData)
        : {},
    inventory:
      raffleState.inventory && typeof raffleState.inventory === "object"
        ? cloneValue(raffleState.inventory)
        : {},
    settlement:
      raffleState.settlement && typeof raffleState.settlement === "object"
        ? cloneValue(raffleState.settlement)
        : {},
  };

  for (const fieldName of FILETIME_FIELDS) {
    encoded[fieldName] = encodeFileTime(raffleState[fieldName]);
  }

  return encoded;
}

function decodeRaffleState(raffleState) {
  if (!raffleState || typeof raffleState !== "object") {
    return null;
  }

  const decoded = {
    ...cloneValue(raffleState),
    soldTickets: Array.isArray(raffleState.soldTickets)
      ? raffleState.soldTickets.map(decodeTicket).filter(Boolean)
      : [],
    winningTicket: decodeTicket(raffleState.winningTicket),
    metaData:
      raffleState.metaData && typeof raffleState.metaData === "object"
        ? cloneValue(raffleState.metaData)
        : {},
    inventory:
      raffleState.inventory && typeof raffleState.inventory === "object"
        ? cloneValue(raffleState.inventory)
        : {},
    settlement:
      raffleState.settlement && typeof raffleState.settlement === "object"
        ? cloneValue(raffleState.settlement)
        : {},
  };

  for (const fieldName of FILETIME_FIELDS) {
    decoded[fieldName] = decodeFileTime(raffleState[fieldName]);
  }

  return decoded;
}

function ensureTable() {
  const result = database.read(TABLE, "/");
  if (result.success && result.data && typeof result.data === "object") {
    return result.data;
  }

  database.write(TABLE, "/", {});
  return {};
}

function clearAllRaffles() {
  return database.write(TABLE, "/", {});
}

function loadRafflesMap() {
  const table = ensureTable();
  const raffles = new Map();

  for (const [raffleKey, raffleState] of Object.entries(table)) {
    const decoded = decodeRaffleState(raffleState);
    if (!decoded) {
      continue;
    }

    const numericId = normalizeInteger(raffleKey, decoded.raffleId);
    if (numericId <= 0) {
      continue;
    }

    decoded.raffleId = numericId;
    raffles.set(numericId, decoded);
  }

  return raffles;
}

function writeRaffle(raffleState) {
  const raffleKey = normalizeRaffleKey(raffleState && raffleState.raffleId);
  if (!raffleKey) {
    return {
      success: false,
      errorMsg: "RAFFLE_ID_REQUIRED",
    };
  }

  return database.write(TABLE, `/${raffleKey}`, encodeRaffleState(raffleState));
}

function removeRaffle(raffleId) {
  const raffleKey = normalizeRaffleKey(raffleId);
  if (!raffleKey) {
    return {
      success: false,
      errorMsg: "RAFFLE_ID_REQUIRED",
    };
  }

  return database.remove(TABLE, `/${raffleKey}`);
}

module.exports = {
  TABLE,
  clearAllRaffles,
  loadRafflesMap,
  writeRaffle,
  removeRaffle,
  encodeRaffleState,
  decodeRaffleState,
};
