const path = require("path");

const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const MAX_PLEX_TRANSACTION_ENTRIES = 2000;

const PLEX_LOG_CATEGORY = Object.freeze({
  PURCHASE: 1021274,
  NES: 1021275,
  SKINR: 1021276,
  REWARD: 1021277,
  INVENTORY: 1021278,
  TRADING: 1021780,
  OMEGA: 1021281,
  CCP: 1021282,
  UNCATEGORIZED: 1022601,
});

function getCharacterStateService() {
  return require(path.join(__dirname, "../character/characterState"));
}

function getCharacterRecord(characterID) {
  const characterState = getCharacterStateService();
  return characterState && typeof characterState.getCharacterRecord === "function"
    ? characterState.getCharacterRecord(characterID)
    : null;
}

function updateCharacterRecord(characterID, updater) {
  const characterState = getCharacterStateService();
  return characterState && typeof characterState.updateCharacterRecord === "function"
    ? characterState.updateCharacterRecord(characterID, updater)
    : { success: false, errorMsg: "CHARACTER_STATE_UNAVAILABLE" };
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function normalizePlex(value, fallback = 0) {
  return Math.max(0, normalizeInteger(value, fallback));
}

function normalizeText(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value);
}

function getFileTimeNowString() {
  return (BigInt(Date.now()) * 10000n + FILETIME_EPOCH_OFFSET).toString();
}

function getTransactionID() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function normalizeFileTimeString(value, fallback = null) {
  if (typeof value === "string" && value.trim() !== "") {
    try {
      BigInt(value);
      return value;
    } catch (error) {
      return fallback || getFileTimeNowString();
    }
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value)).toString();
  }

  return fallback || getFileTimeNowString();
}

function fileTimeStringToDate(value) {
  try {
    const fileTime = BigInt(String(value || "0"));
    if (fileTime <= FILETIME_EPOCH_OFFSET) {
      return new Date(0);
    }
    const unixMs = Number((fileTime - FILETIME_EPOCH_OFFSET) / 10000n);
    return Number.isFinite(unixMs) ? new Date(unixMs) : new Date(0);
  } catch (error) {
    return new Date(0);
  }
}

function dateToTimestamp(date) {
  const normalizedDate = date instanceof Date && !Number.isNaN(date.valueOf())
    ? date
    : new Date(0);
  const timeMs = normalizedDate.getTime();
  return {
    seconds: Math.floor(timeMs / 1000),
    nanos: (timeMs % 1000) * 1000000,
  };
}

function normalizeCategoryMessageID(
  value,
  fallback = PLEX_LOG_CATEGORY.UNCATEGORIZED,
) {
  const categoryId = normalizeInteger(value, fallback);
  return Object.values(PLEX_LOG_CATEGORY).includes(categoryId)
    ? categoryId
    : fallback;
}

function normalizePlexTransactionEntry(entry = {}) {
  const categoryMessageID = normalizeCategoryMessageID(
    entry.categoryMessageID,
    PLEX_LOG_CATEGORY.UNCATEGORIZED,
  );
  const reason = normalizeText(entry.reason, "");
  const summaryText = normalizeText(entry.summaryText, reason);
  const rawSummaryMessageID = normalizeInteger(entry.summaryMessageID, 0);

  return {
    transactionID: normalizeInteger(entry.transactionID, getTransactionID()),
    transactionDate: normalizeFileTimeString(entry.transactionDate),
    amount: normalizeInteger(entry.amount, 0),
    balance: normalizePlex(entry.balance, 0),
    categoryMessageID,
    // The client expects every invoice to carry a renderable summary message.
    summaryMessageID:
      rawSummaryMessageID > 0 ? rawSummaryMessageID : categoryMessageID,
    summaryText,
    reason,
  };
}

function sortTransactionsNewestFirst(entries = []) {
  return [...entries].sort(
    (left, right) =>
      normalizeInteger(right && right.transactionID, 0) -
      normalizeInteger(left && left.transactionID, 0),
  );
}

function getCharacterPlexTransactions(charId) {
  const record = getCharacterRecord(charId);
  if (!record || !Array.isArray(record.plexVaultTransactions)) {
    return [];
  }

  return sortTransactionsNewestFirst(
    record.plexVaultTransactions.map((entry) =>
      normalizePlexTransactionEntry(cloneValue(entry)),
    ),
  );
}

function appendCharacterPlexTransaction(charId, entry) {
  const normalizedEntry = normalizePlexTransactionEntry(entry);

  const writeResult = updateCharacterRecord(charId, (record) => {
    const nextEntries = Array.isArray(record.plexVaultTransactions)
      ? record.plexVaultTransactions.map((candidate) =>
          normalizePlexTransactionEntry(cloneValue(candidate)),
        )
      : [];
    nextEntries.unshift(normalizedEntry);
    record.plexVaultTransactions = sortTransactionsNewestFirst(
      nextEntries,
    ).slice(0, MAX_PLEX_TRANSACTION_ENTRIES);
    return record;
  });

  return {
    ...writeResult,
    entry: normalizedEntry,
  };
}

function getCharacterPlexTransaction(charId, transactionId) {
  const targetId = normalizeInteger(transactionId, 0);
  if (!targetId) {
    return null;
  }

  return (
    getCharacterPlexTransactions(charId).find(
      (entry) => normalizeInteger(entry && entry.transactionID, 0) === targetId,
    ) || null
  );
}

function getCharacterPlexTransactionStatistics(charId) {
  const transactions = getCharacterPlexTransactions(charId).slice(
    0,
    MAX_PLEX_TRANSACTION_ENTRIES,
  );
  const groupedEntries = new Map();

  for (const transaction of transactions) {
    const categoryMessageID = normalizeCategoryMessageID(
      transaction && transaction.categoryMessageID,
      PLEX_LOG_CATEGORY.UNCATEGORIZED,
    );
    if (!groupedEntries.has(categoryMessageID)) {
      groupedEntries.set(categoryMessageID, {
        categoryMessageID,
        incomesInCents: 0,
        expensesInCents: 0,
        transactionsCount: 0,
      });
    }

    const statsEntry = groupedEntries.get(categoryMessageID);
    const amount = normalizeInteger(transaction && transaction.amount, 0);
    if (amount >= 0) {
      statsEntry.incomesInCents += amount * 100;
    } else {
      statsEntry.expensesInCents += Math.abs(amount) * 100;
    }
    statsEntry.transactionsCount += 1;
  }

  const oldestTransaction = transactions.length
    ? transactions[transactions.length - 1]
    : null;

  return {
    entries: [...groupedEntries.values()],
    earliestTimestamp: oldestTransaction
      ? dateToTimestamp(fileTimeStringToDate(oldestTransaction.transactionDate))
      : null,
    totalCount: transactions.length,
  };
}

module.exports = {
  MAX_PLEX_TRANSACTION_ENTRIES,
  PLEX_LOG_CATEGORY,
  getFileTimeNowString,
  getTransactionID,
  normalizePlexTransactionEntry,
  getCharacterPlexTransactions,
  appendCharacterPlexTransaction,
  getCharacterPlexTransaction,
  getCharacterPlexTransactionStatistics,
  fileTimeStringToDate,
  dateToTimestamp,
};
