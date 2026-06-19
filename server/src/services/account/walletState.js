const path = require("path");

const sessionRegistry = require(path.join(
  __dirname,
  "../chat/sessionRegistry",
));
const {
  PLEX_LOG_CATEGORY,
  getFileTimeNowString,
  getTransactionID,
  appendCharacterPlexTransaction,
  fileTimeStringToDate,
} = require(path.join(__dirname, "./plexVaultLogState"));

const ACCOUNT_KEY = {
  CASH: 1000,
  AURUM: 1200,
};
const ACCOUNT_KEY_NAME = {
  CASH: "cash",
  AURUM: "AURUM",
};
const JOURNAL_ENTRY_TYPE = {
  PLAYER_TRADING: 1,
  MARKET_TRANSACTION: 2,
  GM_CASH_TRANSFER: 3,
  PLAYER_DONATION: 10,
  NPC_BOUNTY_PRIZE: 17,
  INSURANCE: 19,
  MARKET_ESCROW: 42,
  BROKERS_FEE: 46,
  TRANSACTION_TAX: 54,
  NPC_BOUNTY_PRIZES: 85,
  PLANETARY_IMPORT_TAX: 96,
  PLANETARY_EXPORT_TAX: 97,
  PLANETARY_CONSTRUCTION: 98,
  JUMP_CLONE_INSTALLATION: 55,
  JUMP_CLONE_ACTIVATION: 128,
  SKILL_PURCHASE: 141,
  MARKET_PROVIDER_TAX: 149,
};
JOURNAL_ENTRY_TYPE.ADMIN_ADJUSTMENT = JOURNAL_ENTRY_TYPE.GM_CASH_TRANSFER;
const JOURNAL_CURRENCY = {
  ISK: 1,
  AURUM: 2,
};
const DEFAULT_WALLET = {
  balance: 100000.0,
  aurBalance: 0.0,
  plexBalance: 2222,
  balanceChange: 0.0,
};
const MAX_JOURNAL_ENTRIES = 100;
const MAX_MARKET_TRANSACTION_ENTRIES = 2000;

function getCharacterState() {
  return require(path.join(__dirname, "../character/characterState"));
}

function publishPlexBalanceChangedNotice(characterID, balanceInCents, deltaInCents) {
  const gateway = require(path.join(
    __dirname,
    "../../_secondary/express/publicGatewayLocal",
  ));
  return gateway && typeof gateway.publishPlexBalanceChangedNotice === "function"
    ? gateway.publishPlexBalanceChangedNotice(
        characterID,
        balanceInCents,
        deltaInCents,
      )
    : null;
}

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

function buildNotEnoughMoneyUserErrorValues(requiredAmount, currentBalance) {
  return {
    balance: normalizeMoney(currentBalance, 0),
    amount: normalizeMoney(requiredAmount, 0),
  };
}

function normalizePlex(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.trunc(numeric));
}

function normalizePlexDelta(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.trunc(numeric);
}

function resolveLedgerReason(options = {}, fallback = "No details given") {
  const explicitReason = [options.reason, options.description].find(
    (value) => typeof value === "string" && value.trim() !== "",
  );
  return explicitReason || fallback;
}

function getCharacterWallet(charId) {
  const record = getCharacterState().getCharacterRecord(charId);
  if (!record) {
    return null;
  }

  return {
    characterID: Number(charId),
    balance: normalizeMoney(record.balance, DEFAULT_WALLET.balance),
    aurBalance: normalizeMoney(record.aurBalance, DEFAULT_WALLET.aurBalance),
    plexBalance: normalizePlex(record.plexBalance, DEFAULT_WALLET.plexBalance),
    balanceChange: normalizeMoney(
      record.balanceChange,
      DEFAULT_WALLET.balanceChange,
    ),
  };
}

function getCharacterWalletJournal(charId) {
  const record = getCharacterState().getCharacterRecord(charId);
  if (!record || !Array.isArray(record.walletJournal)) {
    return [];
  }

  return record.walletJournal.map((entry) => cloneValue(entry));
}

function appendLimitedRecordEntry(record, fieldName, entry, maxEntries) {
  const nextEntries = Array.isArray(record && record[fieldName])
    ? record[fieldName].map((candidate) => cloneValue(candidate))
    : [];
  nextEntries.unshift(cloneValue(entry));
  record[fieldName] = nextEntries.slice(0, maxEntries);
}

function appendWalletJournalEntry(record, entry) {
  appendLimitedRecordEntry(record, "walletJournal", entry, MAX_JOURNAL_ENTRIES);
}

function normalizeFileTimeString(value, fallback = null) {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return fallback || getFileTimeNowString();
}

function normalizeMarketTransactionEntry(entry = {}) {
  const transactionID = Number(entry.transactionID);
  return {
    transactionID: Number.isFinite(transactionID) ? Math.trunc(transactionID) : getTransactionID(),
    transactionDate: normalizeFileTimeString(entry.transactionDate),
    typeID: Math.max(0, Math.trunc(Number(entry.typeID) || 0)),
    quantity: Math.max(0, Math.trunc(Number(entry.quantity) || 0)),
    price: normalizeMoney(entry.price, 0),
    stationID: Math.max(0, Math.trunc(Number(entry.stationID) || 0)),
    locationID: Math.max(
      0,
      Math.trunc(Number(entry.locationID ?? entry.stationID) || 0),
    ),
    buyerID: Math.max(0, Math.trunc(Number(entry.buyerID) || 0)),
    sellerID: Math.max(0, Math.trunc(Number(entry.sellerID) || 0)),
    clientID: Math.max(0, Math.trunc(Number(entry.clientID) || 0)),
    accountID: Math.max(
      0,
      Math.trunc(Number(entry.accountID || ACCOUNT_KEY.CASH) || ACCOUNT_KEY.CASH),
    ),
    buyerAccountID: Math.max(
      0,
      Math.trunc(
        Number(entry.buyerAccountID || ACCOUNT_KEY.CASH) || ACCOUNT_KEY.CASH,
      ),
    ),
    sellerAccountID: Math.max(
      0,
      Math.trunc(
        Number(entry.sellerAccountID || ACCOUNT_KEY.CASH) || ACCOUNT_KEY.CASH,
      ),
    ),
    journalRefID: Math.trunc(Number(entry.journalRefID ?? entry.journal_ref_id) || -1),
  };
}

function getCharacterMarketTransactions(charId) {
  const record = getCharacterState().getCharacterRecord(charId);
  if (!record || !Array.isArray(record.marketTransactions)) {
    return [];
  }

  return [...record.marketTransactions]
    .map((entry) => normalizeMarketTransactionEntry(cloneValue(entry)))
    .sort((left, right) => right.transactionID - left.transactionID);
}

function appendCharacterMarketTransaction(charId, entry) {
  const normalizedEntry = normalizeMarketTransactionEntry(entry);
  const writeResult = getCharacterState().updateCharacterRecord(charId, (record) => {
    appendLimitedRecordEntry(
      record,
      "marketTransactions",
      normalizedEntry,
      MAX_MARKET_TRANSACTION_ENTRIES,
    );
    return record;
  });

  return {
    ...writeResult,
    entry: normalizedEntry,
  };
}

function normalizeTransactionDateParts(entry) {
  const date = fileTimeStringToDate(entry && entry.transactionDate);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
  };
}

function isEntryWithinLast30Days(entry) {
  const entryDate = fileTimeStringToDate(entry && entry.transactionDate);
  if (Number.isNaN(entryDate.valueOf())) {
    return false;
  }
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return entryDate.getTime() >= thirtyDaysAgo;
}

function getCharacterWalletTransactions(charId, options = {}) {
  const accountKey = Number(options.accountKey || ACCOUNT_KEY.CASH) || ACCOUNT_KEY.CASH;
  const year = Number(options.year);
  const month = Number(options.month);
  const hasMonthFilter = Number.isFinite(year) && Number.isFinite(month);

  return getCharacterWalletJournal(charId).filter((entry) => {
    if (
      (Number(entry && entry.accountKey) || ACCOUNT_KEY.CASH) !== accountKey
    ) {
      return false;
    }

    if (hasMonthFilter) {
      const dateParts = normalizeTransactionDateParts(entry);
      return dateParts.year === year && dateParts.month === month;
    }

    return isEntryWithinLast30Days(entry);
  });
}

function syncWalletToSession(session, wallet) {
  if (!session || !wallet) {
    return;
  }

  session.balance = wallet.balance;
  session.aurBalance = wallet.aurBalance;
  session.plexBalance = wallet.plexBalance;
  session.balanceChange = wallet.balanceChange;
}

function emitAccountChangeToSession(session, options = {}) {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }

  const accountKey = options.accountKey || ACCOUNT_KEY_NAME.CASH;
  const ownerID =
    Number(options.ownerID || session.characterID || session.userid || 0) || 0;
  const balance = normalizeMoney(options.balance, 0);

  session.sendNotification("OnAccountChange", "cash", [
    accountKey,
    ownerID,
    balance,
  ]);
}

function notifyCharacterWalletChange(charId, wallet, options = {}) {
  const sessions = sessionRegistry
    .getSessions()
    .filter(
      (session) => Number(session.characterID || 0) === Number(charId || 0),
    );

  for (const session of sessions) {
    syncWalletToSession(session, wallet);
    emitAccountChangeToSession(session, {
      accountKey: options.accountKey || ACCOUNT_KEY_NAME.CASH,
      ownerID: charId,
      balance:
        options.balance !== undefined && options.balance !== null
          ? options.balance
          : wallet.balance,
    });
  }
}

function emitPlexBalanceChangeToSession(session, balance, delta = 0) {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }

  const normalizedBalance = normalizePlex(balance, 0);
  const normalizedDelta = normalizePlexDelta(delta, 0);
  session.sendNotification("OnPLEXBalanceChanged", "clientID", [
    normalizedBalance,
    normalizedDelta,
  ]);
}

function notifyCharacterPlexBalanceChange(charId, wallet, delta = 0) {
  const sessions = sessionRegistry
    .getSessions()
    .filter(
      (session) => Number(session.characterID || 0) === Number(charId || 0),
    );

  for (const session of sessions) {
    syncWalletToSession(session, wallet);
    emitPlexBalanceChangeToSession(session, wallet.plexBalance, delta);
  }
}

function setCharacterBalance(charId, nextBalance, options = {}) {
  const currentWallet = getCharacterWallet(charId);
  if (!currentWallet) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const normalizedBalance = normalizeMoney(nextBalance, currentWallet.balance);
  if (normalizedBalance < 0) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_FUNDS",
    };
  }

  const delta = normalizeMoney(normalizedBalance - currentWallet.balance, 0);
  const journalEntry = {
    transactionID: getTransactionID(),
    transactionDate: getFileTimeNowString(),
    referenceID: Number(options.referenceID || options.ownerID2 || 0) || 0,
    entryTypeID:
      Number(options.entryTypeID || JOURNAL_ENTRY_TYPE.ADMIN_ADJUSTMENT) || 0,
    ownerID1: Number(options.ownerID1 || charId || 0) || 0,
    ownerID2: Number(options.ownerID2 || 0) || 0,
    accountKey: Number(options.accountKey || ACCOUNT_KEY.CASH) || ACCOUNT_KEY.CASH,
    amount: delta,
    balance: normalizedBalance,
    description: resolveLedgerReason(options, "Wallet balance change"),
    currency:
      Number(options.currency || JOURNAL_CURRENCY.ISK) || JOURNAL_CURRENCY.ISK,
    sortValue: 1,
  };

  const writeResult = getCharacterState().updateCharacterRecord(charId, (record) => {
    record.balance = normalizedBalance;
    record.balanceChange = delta;
    appendWalletJournalEntry(record, journalEntry);
    return record;
  });

  if (!writeResult.success) {
    return writeResult;
  }

  const updatedWallet = {
    ...currentWallet,
    balance: normalizedBalance,
    balanceChange: delta,
  };
  notifyCharacterWalletChange(charId, updatedWallet, {
    accountKey: options.accountKeyName || ACCOUNT_KEY_NAME.CASH,
    balance: normalizedBalance,
  });

  return {
    success: true,
    data: updatedWallet,
    previousBalance: currentWallet.balance,
    delta,
    journalEntry,
  };
}

function adjustCharacterBalance(charId, amount, options = {}) {
  const currentWallet = getCharacterWallet(charId);
  if (!currentWallet) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const delta = normalizeMoney(amount, 0);
  return setCharacterBalance(charId, currentWallet.balance + delta, {
    ...options,
    description: resolveLedgerReason(
      options,
      delta >= 0 ? "Wallet credit" : "Wallet debit",
    ),
  });
}

function transferCharacterBalance(fromCharId, toCharId, amount, options = {}) {
  const normalizedAmount = normalizeMoney(amount, 0);
  if (!(normalizedAmount > 0)) {
    return {
      success: false,
      errorMsg: "AMOUNT_REQUIRED",
    };
  }

  const sourceWallet = getCharacterWallet(fromCharId);
  const targetWallet = getCharacterWallet(toCharId);
  if (!sourceWallet || !targetWallet) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  if (sourceWallet.balance < normalizedAmount) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_FUNDS",
    };
  }

  const description =
    options.description || `Transfer to ${Number(toCharId || 0)}`;
  const debitResult = adjustCharacterBalance(fromCharId, -normalizedAmount, {
    description,
    ownerID1: fromCharId,
    ownerID2: toCharId,
    referenceID: toCharId,
    entryTypeID: JOURNAL_ENTRY_TYPE.PLAYER_DONATION,
  });
  if (!debitResult.success) {
    return debitResult;
  }

  const creditResult = adjustCharacterBalance(toCharId, normalizedAmount, {
    description,
    ownerID1: fromCharId,
    ownerID2: toCharId,
    referenceID: fromCharId,
    entryTypeID: JOURNAL_ENTRY_TYPE.PLAYER_DONATION,
  });
  if (!creditResult.success) {
    return creditResult;
  }

  return {
    success: true,
    from: debitResult.data,
    to: creditResult.data,
    amount: normalizedAmount,
  };
}

function setCharacterPlexBalance(charId, nextBalance, options = {}) {
  const currentWallet = getCharacterWallet(charId);
  if (!currentWallet) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const normalizedBalance = normalizePlex(
    nextBalance,
    currentWallet.plexBalance,
  );
  const writeResult = getCharacterState().updateCharacterRecord(charId, (record) => {
    record.plexBalance = normalizedBalance;
    return record;
  });
  if (!writeResult.success) {
    return writeResult;
  }

  const updatedWallet = {
    ...currentWallet,
    plexBalance: normalizedBalance,
  };
  const delta = normalizedBalance - currentWallet.plexBalance;
  let plexTransaction = null;
  if (delta !== 0 && options.recordTransaction !== false) {
    const reason = resolveLedgerReason(options, "No details given");
    const categoryMessageID =
      Number(options.categoryMessageID || 0) || PLEX_LOG_CATEGORY.CCP;
    const logResult = appendCharacterPlexTransaction(charId, {
      transactionID: Number(options.transactionID || 0) || getTransactionID(),
      transactionDate: normalizeFileTimeString(options.transactionDate),
      amount: delta,
      balance: normalizedBalance,
      categoryMessageID,
      summaryMessageID:
        Number(options.summaryMessageID || 0) || categoryMessageID,
      summaryText: options.summaryText || reason,
      reason,
    });
    if (logResult && logResult.success) {
      plexTransaction = logResult.entry;
    }
  }
  notifyCharacterPlexBalanceChange(charId, updatedWallet, delta);
  publishPlexBalanceChangedNotice(
    charId,
    updatedWallet.plexBalance,
    delta,
  );

  return {
    success: true,
    data: updatedWallet,
    previousBalance: currentWallet.plexBalance,
    delta,
    transaction: plexTransaction,
  };
}

function adjustCharacterPlexBalance(charId, amount, options = {}) {
  const currentWallet = getCharacterWallet(charId);
  if (!currentWallet) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  return setCharacterPlexBalance(
    charId,
    currentWallet.plexBalance + normalizePlexDelta(amount, 0),
    options,
  );
}

module.exports = {
  ACCOUNT_KEY,
  ACCOUNT_KEY_NAME,
  JOURNAL_ENTRY_TYPE,
  JOURNAL_CURRENCY,
  buildNotEnoughMoneyUserErrorValues,
  getCharacterWallet,
  getCharacterWalletJournal,
  getCharacterWalletTransactions,
  getCharacterMarketTransactions,
  appendCharacterMarketTransaction,
  syncWalletToSession,
  emitAccountChangeToSession,
  emitPlexBalanceChangeToSession,
  notifyCharacterWalletChange,
  notifyCharacterPlexBalanceChange,
  setCharacterBalance,
  adjustCharacterBalance,
  setCharacterPlexBalance,
  adjustCharacterPlexBalance,
  transferCharacterBalance,
};
