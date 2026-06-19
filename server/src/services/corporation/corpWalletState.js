const path = require("path");

const sessionRegistry = require(path.join(
  __dirname,
  "../chat/sessionRegistry",
));
const { currentFileTime } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const {
  getCorporationRuntime,
  updateCorporationRuntime,
} = require(path.join(__dirname, "./corporationRuntimeState"));

const CORPORATION_WALLET_KEY_START = 1000;
const CORPORATION_WALLET_KEY_END = 1006;
const MAX_JOURNAL_ENTRIES = 100;
const MAX_TRANSACTION_ENTRIES = 2000;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeMoney(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.round(numeric * 100) / 100;
}

function normalizeCorporationWalletKey(rawValue) {
  const numeric = Number(rawValue);
  if (Number.isInteger(numeric)) {
    if (numeric >= CORPORATION_WALLET_KEY_START && numeric <= CORPORATION_WALLET_KEY_END) {
      return numeric;
    }
  }

  const text = String(rawValue || "").trim().toLowerCase();
  if (text === "cash") {
    return CORPORATION_WALLET_KEY_START;
  }
  const match = /^cash([2-7])$/.exec(text);
  if (match) {
    return CORPORATION_WALLET_KEY_START + Number(match[1]) - 1;
  }

  return CORPORATION_WALLET_KEY_START;
}

function getCorporationWalletKeyName(accountKey) {
  const normalizedKey = normalizeCorporationWalletKey(accountKey);
  const offset = normalizedKey - CORPORATION_WALLET_KEY_START;
  return offset <= 0 ? "cash" : `cash${offset + 1}`;
}

function buildLedgerEntry(corporationID, accountKey, amount, balance, options = {}) {
  const timestamp = currentFileTime().toString();
  const transactionID = Number(Date.now()) * 100 + Math.floor(Math.random() * 100);
  return {
    transactionID,
    transactionDate: timestamp,
    referenceID: Number(options.referenceID || transactionID) || transactionID,
    entryTypeID: Number(options.entryTypeID || 10) || 10,
    ownerID1: Number(options.ownerID1 || corporationID) || corporationID,
    ownerID2: Number(options.ownerID2 || 0) || 0,
    accountKey,
    amount: normalizeMoney(amount, 0),
    balance: normalizeMoney(balance, 0),
    description:
      typeof options.description === "string" && options.description.trim() !== ""
        ? options.description
        : "Corporation wallet balance change",
    currency: Number(options.currency || 1) || 1,
    sortValue: Number(options.sortValue || 1) || 1,
  };
}

function appendLimited(list, entry, maxEntries) {
  list.push(entry);
  if (list.length > maxEntries) {
    list.splice(0, list.length - maxEntries);
  }
}

function filterLedgerEntries(entries = [], options = {}) {
  const year = Number(options.year);
  const month = Number(options.month);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return entries.map((entry) => cloneValue(entry));
  }

  return entries
    .filter((entry) => {
      const filetime = BigInt(String(entry && entry.transactionDate ? entry.transactionDate : "0"));
      if (filetime <= 0n) {
        return false;
      }
      const unixMs = Number((filetime - 116444736000000000n) / 10000n);
      if (!Number.isFinite(unixMs) || unixMs <= 0) {
        return false;
      }
      const date = new Date(unixMs);
      return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month;
    })
    .map((entry) => cloneValue(entry));
}

function getCorporationWallet(corporationID) {
  const runtime = getCorporationRuntime(corporationID);
  if (!runtime || !runtime.wallet) {
    return null;
  }
  return cloneValue(runtime.wallet);
}

function getCorporationWalletDivision(corporationID, accountKey = CORPORATION_WALLET_KEY_START) {
  const wallet = getCorporationWallet(corporationID);
  const normalizedKey = normalizeCorporationWalletKey(accountKey);
  if (!wallet || !wallet.divisions || !wallet.divisions[String(normalizedKey)]) {
    return null;
  }
  return cloneValue(wallet.divisions[String(normalizedKey)]);
}

function getCorporationWalletBalance(corporationID, accountKey = CORPORATION_WALLET_KEY_START) {
  const division = getCorporationWalletDivision(corporationID, accountKey);
  return division ? normalizeMoney(division.balance, 0) : 0;
}

function getCorporationWalletDivisionsInfo(corporationID) {
  const wallet = getCorporationWallet(corporationID);
  if (!wallet || !wallet.divisions) {
    return [];
  }

  return Object.values(wallet.divisions)
    .map((division) => ({
      key: normalizeCorporationWalletKey(division && division.key),
      balance: normalizeMoney(division && division.balance, 0),
    }))
    .sort((left, right) => left.key - right.key);
}

function notifyCorporationWalletChange(corporationID, accountKey, balance) {
  const accountKeyName = getCorporationWalletKeyName(accountKey);
  for (const session of sessionRegistry.getSessions()) {
    if (
      Number(session && (session.corporationID || session.corpid)) !== Number(corporationID) ||
      typeof session.sendNotification !== "function"
    ) {
      continue;
    }
    session.sendNotification("OnAccountChange", "cash", [
      accountKeyName,
      Number(corporationID),
      normalizeMoney(balance, 0),
    ]);
  }
}

function setCorporationWalletDivisionBalance(corporationID, accountKey, nextBalance, options = {}) {
  const normalizedCorporationID = Number(corporationID) || 0;
  const normalizedAccountKey = normalizeCorporationWalletKey(accountKey);
  let result = null;

  updateCorporationRuntime(normalizedCorporationID, (runtime) => {
    runtime.wallet =
      runtime.wallet && typeof runtime.wallet === "object"
        ? runtime.wallet
        : { divisions: {} };
    runtime.wallet.divisions =
      runtime.wallet.divisions && typeof runtime.wallet.divisions === "object"
        ? runtime.wallet.divisions
        : {};

    const divisionKey = String(normalizedAccountKey);
    const currentDivision =
      runtime.wallet.divisions[divisionKey] &&
      typeof runtime.wallet.divisions[divisionKey] === "object"
        ? runtime.wallet.divisions[divisionKey]
        : {
            key: normalizedAccountKey,
            balance: 0,
            journal: [],
            transactions: [],
          };

    const previousBalance = normalizeMoney(currentDivision.balance, 0);
    const balance = normalizeMoney(nextBalance, previousBalance);
    const delta = normalizeMoney(balance - previousBalance, 0);
    let ledgerEntry = null;

    currentDivision.key = normalizedAccountKey;
    currentDivision.balance = balance;
    currentDivision.journal = Array.isArray(currentDivision.journal)
      ? currentDivision.journal
      : [];
    currentDivision.transactions = Array.isArray(currentDivision.transactions)
      ? currentDivision.transactions
      : [];

    if (Math.abs(delta) > 0.0001) {
      ledgerEntry = buildLedgerEntry(
        normalizedCorporationID,
        normalizedAccountKey,
        delta,
        balance,
        options,
      );
      appendLimited(currentDivision.journal, ledgerEntry, MAX_JOURNAL_ENTRIES);
      appendLimited(
        currentDivision.transactions,
        ledgerEntry,
        MAX_TRANSACTION_ENTRIES,
      );
    }

    runtime.wallet.divisions[divisionKey] = currentDivision;
    result = {
      success: true,
      data: {
        corporationID: normalizedCorporationID,
        accountKey: normalizedAccountKey,
        balance,
        delta,
        journalEntry: ledgerEntry ? cloneValue(ledgerEntry) : null,
      },
    };
    return runtime;
  });

  if (!result) {
    return {
      success: false,
      errorMsg: "CORPORATION_NOT_FOUND",
    };
  }

  notifyCorporationWalletChange(
    normalizedCorporationID,
    normalizedAccountKey,
    result.data.balance,
  );
  return result;
}

function adjustCorporationWalletDivisionBalance(corporationID, accountKey, delta, options = {}) {
  const normalizedCorporationID = Number(corporationID) || 0;
  const normalizedAccountKey = normalizeCorporationWalletKey(accountKey);
  const currentBalance = getCorporationWalletBalance(
    normalizedCorporationID,
    normalizedAccountKey,
  );
  const nextBalance = normalizeMoney(currentBalance + normalizeMoney(delta, 0), currentBalance);
  if (nextBalance < -0.0001) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_FUNDS",
      data: {
        corporationID: normalizedCorporationID,
        accountKey: normalizedAccountKey,
        balance: currentBalance,
      },
    };
  }

  return setCorporationWalletDivisionBalance(
    normalizedCorporationID,
    normalizedAccountKey,
    nextBalance,
    options,
  );
}

function getCorporationWalletJournal(corporationID, options = {}) {
  const division = getCorporationWalletDivision(
    corporationID,
    options.accountKey || CORPORATION_WALLET_KEY_START,
  );
  if (!division) {
    return [];
  }
  return filterLedgerEntries(division.journal || [], options);
}

function getCorporationWalletTransactions(corporationID, options = {}) {
  const division = getCorporationWalletDivision(
    corporationID,
    options.accountKey || CORPORATION_WALLET_KEY_START,
  );
  if (!division) {
    return [];
  }
  return filterLedgerEntries(division.transactions || [], options);
}

module.exports = {
  CORPORATION_WALLET_KEY_START,
  CORPORATION_WALLET_KEY_END,
  adjustCorporationWalletDivisionBalance,
  getCorporationWallet,
  getCorporationWalletBalance,
  getCorporationWalletDivision,
  getCorporationWalletDivisionsInfo,
  getCorporationWalletJournal,
  getCorporationWalletKeyName,
  getCorporationWalletTransactions,
  normalizeCorporationWalletKey,
  setCorporationWalletDivisionBalance,
};
