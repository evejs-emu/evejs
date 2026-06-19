const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const sourceDataDir = path.join(repoRoot, "server/src/newDatabase/data");
const originalNewDbDataDir = process.env.EVEJS_NEWDB_DATA_DIR;
const testDataDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "evejs-wallet-market-db-"),
);
fs.cpSync(sourceDataDir, testDataDir, { recursive: true });
process.env.EVEJS_NEWDB_DATA_DIR = testDataDir;

const database = require(path.join(repoRoot, "server/src/newDatabase"));
const AccountService = require(path.join(
  repoRoot,
  "server/src/services/account/accountService",
));
const daemonModule = require(path.join(
  repoRoot,
  "server/src/services/market/marketDaemonClient",
));
const MarketProxyService = require(path.join(
  repoRoot,
  "server/src/services/market/marketProxyService",
));
const {
  ACCOUNT_KEY,
  JOURNAL_CURRENCY,
  JOURNAL_ENTRY_TYPE,
  appendCharacterMarketTransaction,
} = require(path.join(repoRoot, "server/src/services/account/walletState"));
const {
  updateCharacterRecord,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));

test.after(() => {
  database.flushAllSync();
  if (originalNewDbDataDir === undefined) {
    delete process.env.EVEJS_NEWDB_DATA_DIR;
  } else {
    process.env.EVEJS_NEWDB_DATA_DIR = originalNewDbDataDir;
  }
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const DAY_MS = 24 * 60 * 60 * 1000;

function toFileTimeString(date) {
  return (
    BigInt(date.getTime()) * 10000n + FILETIME_EPOCH_OFFSET
  ).toString();
}

function unwrapMarshalValue(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => unwrapMarshalValue(entry));
  }

  switch (value.type) {
    case "int":
    case "real":
    case "token":
    case "wstring":
      return unwrapMarshalValue(value.value);
    case "long":
      return BigInt(value.value).toString();
    case "list":
      return (value.items || []).map((entry) => unwrapMarshalValue(entry));
    case "dict":
      return Object.fromEntries(
        (value.entries || []).map(([key, entryValue]) => [
          unwrapMarshalValue(key),
          unwrapMarshalValue(entryValue),
        ]),
      );
    case "object":
      if (value.name === "util.KeyVal") {
        return unwrapMarshalValue(value.args);
      }
      return value;
    default:
      return value;
  }
}

function getFirstCharacterID() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true);
  return Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .find((characterID) => characterID > 0);
}

test("account GetTransactions filters cached wallet journal by account/month and 30-day default", () => {
  const characterID = getFirstCharacterID();
  assert.ok(characterID > 0);

  const recentDate = new Date(Date.now() - 5 * DAY_MS);
  const olderDate = new Date(Date.now() - 40 * DAY_MS);
  updateCharacterRecord(characterID, (record) => {
    record.walletJournal = [
      {
        transactionID: 80000002,
        transactionDate: toFileTimeString(recentDate),
        referenceID: 60003760,
        entryTypeID: JOURNAL_ENTRY_TYPE.MARKET_TRANSACTION,
        ownerID1: 90000002,
        ownerID2: characterID,
        accountKey: ACCOUNT_KEY.CASH,
        amount: -125.55,
        balance: 999874.45,
        description: "Recent market purchase",
        currency: JOURNAL_CURRENCY.ISK,
        sortValue: 1,
      },
      {
        transactionID: 80000001,
        transactionDate: toFileTimeString(olderDate),
        referenceID: 60003760,
        entryTypeID: JOURNAL_ENTRY_TYPE.PLAYER_DONATION,
        ownerID1: characterID,
        ownerID2: 90000003,
        accountKey: ACCOUNT_KEY.CASH,
        amount: -50,
        balance: 1000000,
        description: "Older transfer",
        currency: JOURNAL_CURRENCY.ISK,
        sortValue: 2,
      },
    ];
    return record;
  });

  const accountService = new AccountService();
  const recentResult = accountService.Handle_GetTransactions(
    [ACCOUNT_KEY.CASH],
    { characterID },
  );
  const recentTransactions = recentResult.items.map((entry) =>
    unwrapMarshalValue(entry),
  );
  assert.deepEqual(
    recentTransactions.map((entry) => entry.transactionID),
    [80000002],
  );

  const olderResult = accountService.Handle_GetTransactions(
    [ACCOUNT_KEY.CASH, olderDate.getFullYear(), olderDate.getMonth() + 1, 0],
    { characterID },
  );
  const olderTransactions = olderResult.items.map((entry) =>
    unwrapMarshalValue(entry),
  );
  assert.deepEqual(
    olderTransactions.map((entry) => entry.transactionID),
    [80000001],
  );
});

test("market CharGetTransactions reads persisted character market history from the cached database", () => {
  const characterID = getFirstCharacterID();
  assert.ok(characterID > 0);

  updateCharacterRecord(characterID, (record) => {
    record.marketTransactions = [];
    return record;
  });

  const olderDate = new Date(Date.now() - 20 * DAY_MS);
  const recentDate = new Date(Date.now() - 2 * DAY_MS);
  appendCharacterMarketTransaction(characterID, {
    transactionID: 91000001,
    transactionDate: toFileTimeString(olderDate),
    typeID: 34,
    quantity: 10,
    price: 5.01,
    stationID: 60003760,
    locationID: 60003760,
    buyerID: characterID,
    sellerID: 90000011,
    clientID: 90000011,
    journalRefID: 71000001,
  });
  appendCharacterMarketTransaction(characterID, {
    transactionID: 91000002,
    transactionDate: toFileTimeString(recentDate),
    typeID: 35,
    quantity: 20,
    price: 8.75,
    stationID: 60003760,
    locationID: 60003760,
    buyerID: 90000012,
    sellerID: characterID,
    clientID: 90000012,
    journalRefID: 71000002,
  });

  const persistedResult = database.read(
    "characters",
    `/${characterID}/marketTransactions`,
  );
  assert.equal(persistedResult.success, true);
  assert.equal(Array.isArray(persistedResult.data), true);
  assert.equal(persistedResult.data.length, 2);

  const originalStartBackgroundConnect =
    daemonModule.marketDaemonClient.startBackgroundConnect;
  daemonModule.marketDaemonClient.startBackgroundConnect = () => {};

  try {
    const service = new MarketProxyService();
    const result = service.Handle_CharGetTransactions(
      [toFileTimeString(new Date(Date.now() - 7 * DAY_MS))],
      { characterID, charid: characterID },
    );
    const transactions = result.items.map((entry) => unwrapMarshalValue(entry));

    assert.deepEqual(
      transactions.map((entry) => entry.transactionID),
      [91000002],
    );
    assert.equal(transactions[0].typeID, 35);
    assert.equal(transactions[0].clientID, 90000012);
    assert.equal(transactions[0].journalRefID, 71000002);
  } finally {
    daemonModule.marketDaemonClient.startBackgroundConnect =
      originalStartBackgroundConnect;
  }
});
