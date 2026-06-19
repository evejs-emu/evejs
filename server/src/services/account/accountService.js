const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  ACCOUNT_KEY,
  ACCOUNT_KEY_NAME,
  JOURNAL_ENTRY_TYPE,
  adjustCharacterBalance,
  getCharacterWallet,
  getCharacterWalletJournal,
  getCharacterWalletTransactions,
  transferCharacterBalance,
} = require(path.join(__dirname, "./walletState"));
const {
  getCorporationWalletBalance,
  getCorporationWalletDivisionsInfo,
  getCorporationWalletJournal,
  getCorporationWalletTransactions,
  getCorporationWalletKeyName,
  normalizeCorporationWalletKey,
  adjustCorporationWalletDivisionBalance,
} = require(path.join(__dirname, "../corporation/corpWalletState"));
const {
  getCorporationRecord,
} = require(path.join(__dirname, "../corporation/corporationState"));

const JOURNAL_HEADERS = [
  "transactionID",
  "transactionDate",
  "referenceID",
  "entryTypeID",
  "ownerID1",
  "ownerID2",
  "accountKey",
  "amount",
  "balance",
  "description",
  "currency",
  "sortValue",
];
const ENTRY_TYPE_NAME_BY_ID = new Map([
  [JOURNAL_ENTRY_TYPE.PLAYER_TRADING, "PlayerTrading"],
  [JOURNAL_ENTRY_TYPE.MARKET_TRANSACTION, "MarketTransaction"],
  [JOURNAL_ENTRY_TYPE.GM_CASH_TRANSFER, "GMCashTransfer"],
  [JOURNAL_ENTRY_TYPE.ADMIN_ADJUSTMENT, "GMCashTransfer"],
  [JOURNAL_ENTRY_TYPE.PLAYER_DONATION, "PlayerDonation"],
  [JOURNAL_ENTRY_TYPE.MARKET_ESCROW, "MarketEscrow"],
  [JOURNAL_ENTRY_TYPE.BROKERS_FEE, "BrokersFee"],
  [JOURNAL_ENTRY_TYPE.TRANSACTION_TAX, "TransactionTax"],
  [JOURNAL_ENTRY_TYPE.PLANETARY_IMPORT_TAX, "PlanetaryImportTax"],
  [JOURNAL_ENTRY_TYPE.PLANETARY_EXPORT_TAX, "PlanetaryExportTax"],
  [JOURNAL_ENTRY_TYPE.PLANETARY_CONSTRUCTION, "PlanetaryConstruction"],
  [JOURNAL_ENTRY_TYPE.SKILL_PURCHASE, "SkillPurchase"],
  [JOURNAL_ENTRY_TYPE.MARKET_PROVIDER_TAX, "MarketProviderTax"],
]);

function buildList(items) {
  return { type: "list", items };
}

function buildKeyVal(entries) {
  return {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries,
    },
  };
}

function buildRowset(header, rows) {
  return {
    type: "object",
    name: "util.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", buildList(header)],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", buildList(rows)],
      ],
    },
  };
}

function normalizeNumber(value, fallback = 0) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (Buffer.isBuffer(value)) {
    return normalizeNumber(value.toString("utf8"), fallback);
  }

  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  if (typeof value === "object") {
    if (value.type === "wstring" || value.type === "token") {
      return normalizeNumber(value.value, fallback);
    }

    if (value.type === "long" || value.type === "int") {
      return normalizeNumber(value.value, fallback);
    }
  }

  return fallback;
}

function normalizeText(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    if (value.type === "wstring" || value.type === "token") {
      return normalizeText(value.value, fallback);
    }
  }

  return String(value);
}

function extractKwarg(kwargs, key) {
  if (!kwargs || kwargs.type !== "dict" || !Array.isArray(kwargs.entries)) {
    return undefined;
  }

  const match = kwargs.entries.find((entry) => entry[0] === key);
  return match ? match[1] : undefined;
}

function resolveAccountKey(rawValue) {
  const numericValue = normalizeNumber(rawValue, ACCOUNT_KEY.CASH);
  const textValue = normalizeText(rawValue, "").trim().toLowerCase();

  if (numericValue >= 1000 && numericValue <= 1006) {
    return {
      id: normalizeCorporationWalletKey(numericValue),
      name: getCorporationWalletKeyName(numericValue),
      field: "balance",
    };
  }

  if (textValue === "cash" || /^cash([2-7])$/.test(textValue)) {
    return {
      id: normalizeCorporationWalletKey(textValue),
      name: getCorporationWalletKeyName(textValue),
      field: "balance",
    };
  }

  if (numericValue === ACCOUNT_KEY.AURUM || textValue === "aurum" || textValue === "aur") {
    return {
      id: ACCOUNT_KEY.AURUM,
      name: ACCOUNT_KEY_NAME.AURUM,
      field: "aurBalance",
    };
  }

  return {
    id: ACCOUNT_KEY.CASH,
    name: ACCOUNT_KEY_NAME.CASH,
    field: "balance",
  };
}

function transferCharacterBalanceToCorporation(
  fromCharId,
  toCorporationID,
  toAccountKey,
  amount,
  options = {},
) {
  const normalizedAmount = normalizeNumber(amount, 0);
  if (!(normalizedAmount > 0)) {
    return {
      success: false,
      errorMsg: "AMOUNT_REQUIRED",
    };
  }

  const sourceWallet = getCharacterWallet(fromCharId);
  const destinationCorporation = getCorporationRecord(toCorporationID);
  if (!sourceWallet) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }
  if (!destinationCorporation) {
    return {
      success: false,
      errorMsg: "CORPORATION_NOT_FOUND",
    };
  }
  if (sourceWallet.balance < normalizedAmount) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_FUNDS",
    };
  }

  const normalizedAccountKey = normalizeCorporationWalletKey(toAccountKey);
  const description =
    options.description ||
    `Transfer to corporation ${Number(toCorporationID || 0)}`;
  const debitResult = adjustCharacterBalance(fromCharId, -normalizedAmount, {
    description,
    ownerID1: fromCharId,
    ownerID2: toCorporationID,
    referenceID: toCorporationID,
    entryTypeID: JOURNAL_ENTRY_TYPE.PLAYER_DONATION,
  });
  if (!debitResult.success) {
    return debitResult;
  }

  const creditResult = adjustCorporationWalletDivisionBalance(
    toCorporationID,
    normalizedAccountKey,
    normalizedAmount,
    {
      description,
      ownerID1: fromCharId,
      ownerID2: toCorporationID,
      referenceID: fromCharId,
      entryTypeID: JOURNAL_ENTRY_TYPE.PLAYER_DONATION,
    },
  );
  if (!creditResult.success) {
    adjustCharacterBalance(fromCharId, normalizedAmount, {
      description: `Rollback: ${description}`,
      ownerID1: toCorporationID,
      ownerID2: fromCharId,
      referenceID: fromCharId,
      entryTypeID: JOURNAL_ENTRY_TYPE.PLAYER_DONATION,
    });
    return creditResult;
  }

  return {
    success: true,
    from: debitResult.data,
    to: creditResult.data,
    amount: normalizedAmount,
    accountKey: normalizedAccountKey,
  };
}

function buildJournalRowset(entries) {
  const rows = entries.map((entry) =>
    buildList([
      normalizeNumber(entry.transactionID, 0),
      { type: "long", value: BigInt(String(entry.transactionDate || 0)) },
      normalizeNumber(entry.referenceID, 0),
      normalizeNumber(entry.entryTypeID, JOURNAL_ENTRY_TYPE.ADMIN_ADJUSTMENT),
      normalizeNumber(entry.ownerID1, 0),
      normalizeNumber(entry.ownerID2, 0),
      normalizeNumber(entry.accountKey, ACCOUNT_KEY.CASH),
      normalizeNumber(entry.amount, 0),
      normalizeNumber(entry.balance, 0),
      normalizeText(entry.description, ""),
      normalizeNumber(entry.currency, 1),
      normalizeNumber(entry.sortValue, 1),
    ]),
  );

  return buildRowset(JOURNAL_HEADERS, rows);
}

function buildTransactionEntry(entry) {
  return buildKeyVal([
    ["transactionID", normalizeNumber(entry.transactionID, 0)],
    ["transactionDate", { type: "long", value: BigInt(String(entry.transactionDate || 0)) }],
    ["referenceID", normalizeNumber(entry.referenceID, 0)],
    ["entryTypeID", normalizeNumber(entry.entryTypeID, JOURNAL_ENTRY_TYPE.ADMIN_ADJUSTMENT)],
    ["ownerID1", normalizeNumber(entry.ownerID1, 0)],
    ["ownerID2", normalizeNumber(entry.ownerID2, 0)],
    ["accountKey", normalizeNumber(entry.accountKey, ACCOUNT_KEY.CASH)],
    ["amount", normalizeNumber(entry.amount, 0)],
    ["balance", normalizeNumber(entry.balance, 0)],
    ["description", normalizeText(entry.description, "")],
    ["currency", normalizeNumber(entry.currency, 1)],
    ["sortValue", normalizeNumber(entry.sortValue, 1)],
  ]);
}

function buildTransactionList(entries) {
  return buildList(entries.map((entry) => buildTransactionEntry(entry)));
}

class AccountService extends BaseService {
  constructor() {
    super("account");
  }

  Handle_GetCashBalance(args, session, kwargs) {
    const isCorpWallet =
      normalizeNumber(extractKwarg(kwargs, "isCorpWallet"), NaN) ||
      normalizeNumber(args && args[0], 0);
    const walletKey = resolveAccountKey(
      extractKwarg(kwargs, "accountKey") ?? (args && args[1]),
    );
    if (isCorpWallet) {
      return getCorporationWalletBalance(
        session && (session.corporationID || session.corpid),
        walletKey.id,
      );
    }

    const wallet = getCharacterWallet(session && session.characterID);
    if (!wallet) {
      return 0.0;
    }

    return wallet[walletKey.field] ?? 0.0;
  }

  Handle_GetKeyMap() {
    return buildList([
      buildKeyVal([
        ["key", ACCOUNT_KEY.CASH],
        ["keyName", ACCOUNT_KEY_NAME.CASH],
        ["name", ACCOUNT_KEY_NAME.CASH],
      ]),
      buildKeyVal([
        ["key", ACCOUNT_KEY.AURUM],
        ["keyName", ACCOUNT_KEY_NAME.AURUM],
        ["name", ACCOUNT_KEY_NAME.AURUM],
      ]),
    ]);
  }

  Handle_GetEntryTypes() {
    return buildList(
      [...ENTRY_TYPE_NAME_BY_ID.entries()].map(([entryTypeID, entryTypeName]) =>
        buildKeyVal([
          ["entryTypeID", entryTypeID],
          ["entryTypeName", entryTypeName],
        ]),
      ),
    );
  }

  Handle_GetWalletDivisionsInfo(args, session) {
    const corporationID = session && (session.corporationID || session.corpid);
    if (corporationID) {
      return buildList(
        getCorporationWalletDivisionsInfo(corporationID).map((division) =>
          buildKeyVal([
            ["key", normalizeNumber(division.key, ACCOUNT_KEY.CASH)],
            ["balance", normalizeNumber(division.balance, 0)],
          ]),
        ),
      );
    }

    const wallet = getCharacterWallet(session && session.characterID);
    return buildList([
      buildKeyVal([
        ["key", ACCOUNT_KEY.CASH],
        ["balance", wallet ? wallet.balance : 0.0],
      ]),
      buildKeyVal([
        ["key", ACCOUNT_KEY.AURUM],
        ["balance", wallet ? wallet.aurBalance : 0.0],
      ]),
    ]);
  }

  Handle_GetAurumBalance(args, session) {
    const wallet = getCharacterWallet(session && session.characterID);
    return wallet ? wallet.aurBalance : 0.0;
  }

  Handle_GetDefaultWalletDivision() {
    return ACCOUNT_KEY.CASH;
  }

  Handle_GetDefaultContactCost() {
    return null;
  }

  Handle_SetContactCost() {
    return null;
  }

  Handle_GetJournal(args, session) {
    const isCorpWallet = normalizeNumber(args && args[3], 0);
    if (isCorpWallet) {
      return buildJournalRowset(
        getCorporationWalletJournal(session && (session.corporationID || session.corpid), {
          accountKey: args && args[0],
          year: args && args[1],
          month: args && args[2],
        }),
      );
    }
    return buildJournalRowset(
      getCharacterWalletJournal(session && session.characterID),
    );
  }

  Handle_GetJournalForAccounts(args, session) {
    const accountKey = args && args.length > 0 ? args[0] : ACCOUNT_KEY.CASH;
    if (session && (session.corporationID || session.corpid)) {
      return buildJournalRowset(
        getCorporationWalletJournal(session.corporationID || session.corpid, {
          accountKey,
        }),
      );
    }
    return buildJournalRowset(
      getCharacterWalletJournal(session && session.characterID),
    );
  }

  Handle_GetTransactions(args, session, kwargs) {
    const isCorpWallet =
      normalizeNumber(extractKwarg(kwargs, "isCorpWallet"), NaN) ||
      normalizeNumber(args && args[3], 0);
    const walletKey = resolveAccountKey(
      extractKwarg(kwargs, "accountKey") ?? (args && args[0]),
    );
    const year = normalizeNumber(args && args[1], NaN);
    const month = normalizeNumber(args && args[2], NaN);
    if (isCorpWallet) {
      return buildTransactionList(
        getCorporationWalletTransactions(
          session && (session.corporationID || session.corpid),
          {
            accountKey: walletKey.id,
            year,
            month,
          },
        ),
      );
    }

    return buildTransactionList(
      getCharacterWalletTransactions(session && session.characterID, {
        accountKey: walletKey.id,
        year,
        month,
      }),
    );
  }

  Handle_GiveCash(args, session, kwargs) {
    const toID = normalizeNumber(args && args[0], 0);
    const amount = normalizeNumber(args && args[1], 0);
    const reason = normalizeText(
      extractKwarg(kwargs, "reason") ?? (args && args[2]),
      `Player donation to ${toID}`,
    );

    if (!session || !session.characterID || !(toID > 0) || !(amount > 0)) {
      return null;
    }

    const destinationCorporation = getCorporationRecord(toID);
    const result = destinationCorporation
      ? transferCharacterBalanceToCorporation(
          session.characterID,
          toID,
          extractKwarg(kwargs, "toAccountKey"),
          amount,
          {
            description: reason,
          },
        )
      : transferCharacterBalance(session.characterID, toID, amount, {
          description: reason,
        });
    if (!result.success) {
      log.warn(
        `[AccountService] GiveCash failed: ${result.errorMsg} from=${session.characterID} to=${toID} amount=${amount}`,
      );
    }

    return null;
  }
}

module.exports = AccountService;
