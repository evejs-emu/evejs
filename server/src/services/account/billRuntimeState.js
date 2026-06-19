const path = require("path");
const fs = require("fs");

const database = require(path.join(__dirname, "../../newDatabase"));
const sessionRegistry = require(path.join(
  __dirname,
  "../chat/sessionRegistry",
));
const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  adjustCharacterBalance,
} = require(path.join(__dirname, "./walletState"));
const {
  adjustCorporationWalletDivisionBalance,
  normalizeCorporationWalletKey,
} = require(path.join(__dirname, "../corporation/corpWalletState"));
const {
  getAllianceRecord,
  getCorporationRecord,
} = require(path.join(__dirname, "../corporation/corporationState"));

const BILLS_TABLE = "corporationBills";
const BILLS_TABLE_FILE = path.join(
  __dirname,
  "../../newDatabase/data",
  BILLS_TABLE,
  "data.json",
);

const BILL_TYPE_MARKET_FINE = 1;
const BILL_TYPE_RENTAL = 2;
const BILL_TYPE_BROKER = 3;
const BILL_TYPE_WAR = 4;
const BILL_TYPE_ALLIANCE_MAINTENANCE = 5;
const DEFAULT_DIVISION_ID = 1000;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readTable() {
  const result = database.read(BILLS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {
      _meta: {
        nextBillID: 1,
      },
      bills: {},
      automaticPaySettingsByOwner: {},
    };
  }
  return cloneValue(result.data);
}

function writeTable(table) {
  return database.write(BILLS_TABLE, "/", table);
}

function ensureTable() {
  if (!fs.existsSync(BILLS_TABLE_FILE)) {
    fs.mkdirSync(path.dirname(BILLS_TABLE_FILE), { recursive: true });
    fs.writeFileSync(
      BILLS_TABLE_FILE,
      JSON.stringify(
        {
          _meta: {
            nextBillID: 1,
          },
          bills: {},
          automaticPaySettingsByOwner: {},
        },
        null,
        2,
      ),
      "utf8",
    );
  }
  const table = readTable();
  table._meta =
    table._meta && typeof table._meta === "object" ? table._meta : {};
  table._meta.nextBillID = Number(table._meta.nextBillID || 1) || 1;
  table.bills = table.bills && typeof table.bills === "object" ? table.bills : {};
  table.automaticPaySettingsByOwner =
    table.automaticPaySettingsByOwner &&
    typeof table.automaticPaySettingsByOwner === "object"
      ? table.automaticPaySettingsByOwner
      : {};
  return table;
}

function updateBillTable(updater) {
  const table = ensureTable();
  const nextTable =
    typeof updater === "function" ? updater(table) || table : table;
  writeTable(nextTable);
  return nextTable;
}

function normalizeOwnerID(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeBillTypeID(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : BILL_TYPE_WAR;
}

function normalizeMoney(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.round(numeric * 100) / 100;
}

function defaultAutomaticPaySettings() {
  return {
    [BILL_TYPE_MARKET_FINE]: false,
    [BILL_TYPE_RENTAL]: false,
    [BILL_TYPE_BROKER]: false,
    [BILL_TYPE_WAR]: false,
    [BILL_TYPE_ALLIANCE_MAINTENANCE]: false,
    divisionID: DEFAULT_DIVISION_ID,
  };
}

function normalizeAutomaticPaySettings(settings = {}) {
  const normalized = defaultAutomaticPaySettings();
  for (const [key, value] of Object.entries(settings || {})) {
    if (key === "divisionID") {
      normalized.divisionID = normalizeCorporationWalletKey(value);
      continue;
    }
    const billTypeID = normalizeBillTypeID(key);
    normalized[billTypeID] = Boolean(value);
  }
  return normalized;
}

function getAutomaticPaySettingsForOwner(ownerID) {
  const table = ensureTable();
  return normalizeAutomaticPaySettings(
    table.automaticPaySettingsByOwner[String(ownerID)] || {},
  );
}

function setAutomaticPaySettingsForOwner(ownerID, settings) {
  const numericOwnerID = normalizeOwnerID(ownerID);
  if (!numericOwnerID) {
    return;
  }
  updateBillTable((table) => {
    table.automaticPaySettingsByOwner[String(numericOwnerID)] =
      normalizeAutomaticPaySettings(settings);
    return table;
  });
}

function buildAutomaticPaySettingsSnapshot(ownerIDs = []) {
  const uniqueOwnerIDs = Array.from(
    new Set(
      ownerIDs
        .map((ownerID) => normalizeOwnerID(ownerID))
        .filter((ownerID) => ownerID > 0),
    ),
  );
  const snapshot = {};
  for (const ownerID of uniqueOwnerIDs) {
    snapshot[ownerID] = getAutomaticPaySettingsForOwner(ownerID);
  }
  return snapshot;
}

function normalizeBillRecord(bill) {
  return {
    billID: Number(bill && bill.billID ? bill.billID : 0) || 0,
    billTypeID: normalizeBillTypeID(bill && bill.billTypeID),
    amount: normalizeMoney(bill && bill.amount, 0),
    interest: normalizeMoney(bill && bill.interest, 0),
    debtorID: normalizeOwnerID(bill && bill.debtorID),
    creditorID: normalizeOwnerID(bill && bill.creditorID),
    dueDateTime: String(
      bill && bill.dueDateTime ? bill.dueDateTime : currentFileTime(),
    ),
    paid: Boolean(bill && bill.paid),
    paidDateTime: bill && bill.paidDateTime ? String(bill.paidDateTime) : null,
    paidByOwnerID: normalizeOwnerID(bill && bill.paidByOwnerID),
    externalID:
      bill && bill.externalID !== undefined && bill.externalID !== null
        ? Number(bill.externalID) || -1
        : -1,
    externalID2:
      bill && bill.externalID2 !== undefined && bill.externalID2 !== null
        ? Number(bill.externalID2) || -1
        : -1,
  };
}

function getBillRecord(billID) {
  const table = ensureTable();
  const bill = table.bills[String(Number(billID) || 0)];
  return bill ? normalizeBillRecord(bill) : null;
}

function listBillsForDebtor(ownerID) {
  const numericOwnerID = normalizeOwnerID(ownerID);
  if (!numericOwnerID) {
    return [];
  }
  const table = ensureTable();
  return Object.values(table.bills || {})
    .map((bill) => normalizeBillRecord(bill))
    .filter((bill) => bill.debtorID === numericOwnerID)
    .sort((left, right) => {
      const paidDelta = Number(left.paid) - Number(right.paid);
      if (paidDelta !== 0) {
        return paidDelta;
      }
      const leftDue = BigInt(left.dueDateTime);
      const rightDue = BigInt(right.dueDateTime);
      if (leftDue === rightDue) {
        return Number(right.billID) - Number(left.billID);
      }
      return rightDue > leftDue ? 1 : -1;
    });
}

function listBillsForCreditor(ownerID) {
  const numericOwnerID = normalizeOwnerID(ownerID);
  if (!numericOwnerID) {
    return [];
  }
  const table = ensureTable();
  return Object.values(table.bills || {})
    .map((bill) => normalizeBillRecord(bill))
    .filter((bill) => bill.creditorID === numericOwnerID)
    .sort((left, right) => {
      const leftDue = BigInt(left.dueDateTime);
      const rightDue = BigInt(right.dueDateTime);
      if (leftDue === rightDue) {
        return Number(right.billID) - Number(left.billID);
      }
      return rightDue > leftDue ? 1 : -1;
    });
}

function notifyBillReceived(ownerID, billID) {
  const numericOwnerID = normalizeOwnerID(ownerID);
  const numericBillID = Number(billID) || 0;
  if (!numericOwnerID || !numericBillID) {
    return;
  }
  for (const session of sessionRegistry.getSessions()) {
    if (
      Number(session && (session.corporationID || session.corpid)) !== numericOwnerID &&
      Number(session && (session.allianceID || session.allianceid)) !== numericOwnerID &&
      Number(session && (session.characterID || session.charid)) !== numericOwnerID
    ) {
      continue;
    }
    if (typeof session.sendNotification === "function") {
      session.sendNotification("OnBillReceived", "billID", [numericBillID]);
    }
  }
}

function createBill({
  billTypeID,
  amount,
  debtorID,
  creditorID,
  interest = 0,
  dueDateTime = null,
  externalID = -1,
  externalID2 = -1,
} = {}) {
  const normalizedDebtorID = normalizeOwnerID(debtorID);
  const normalizedCreditorID = normalizeOwnerID(creditorID);
  if (!normalizedDebtorID || !normalizedCreditorID) {
    return null;
  }

  let createdBillID = null;
  updateBillTable((table) => {
    createdBillID = Number(table._meta.nextBillID || 1) || 1;
    table._meta.nextBillID = createdBillID + 1;
    table.bills[String(createdBillID)] = normalizeBillRecord({
      billID: createdBillID,
      billTypeID,
      amount,
      interest,
      debtorID: normalizedDebtorID,
      creditorID: normalizedCreditorID,
      dueDateTime: dueDateTime || currentFileTime(),
      externalID,
      externalID2,
      paid: false,
    });
    return table;
  });

  const createdBill = getBillRecord(createdBillID);
  if (createdBill) {
    notifyBillReceived(createdBill.debtorID, createdBill.billID);
    tryAutoPayBill(createdBill.billID);
  }
  return createdBill;
}

function markBillPaid(billID, paidByOwnerID) {
  const numericBillID = Number(billID) || 0;
  const numericPaidByOwnerID = normalizeOwnerID(paidByOwnerID);
  if (!numericBillID) {
    return null;
  }
  updateBillTable((table) => {
    if (!table.bills[String(numericBillID)]) {
      return table;
    }
    table.bills[String(numericBillID)] = normalizeBillRecord({
      ...table.bills[String(numericBillID)],
      paid: true,
      paidDateTime: currentFileTime(),
      paidByOwnerID: numericPaidByOwnerID,
    });
    return table;
  });
  return getBillRecord(numericBillID);
}

function payBillFromCharacter(billID, characterID) {
  const bill = getBillRecord(billID);
  const numericCharacterID = normalizeOwnerID(characterID);
  if (!bill || bill.paid || bill.debtorID !== numericCharacterID) {
    return { success: false, errorMsg: "BILL_NOT_PAYABLE" };
  }

  const debitResult = adjustCharacterBalance(numericCharacterID, -bill.amount, {
    entryTypeID: 10,
    ownerID1: numericCharacterID,
    ownerID2: bill.creditorID,
    description: `Bill payment ${bill.billID}`,
  });
  if (!debitResult.success) {
    return debitResult;
  }

  markBillPaid(bill.billID, numericCharacterID);
  return { success: true, data: getBillRecord(bill.billID) };
}

function payBillFromCorporation(billID, corporationID, accountKey) {
  const bill = getBillRecord(billID);
  const numericCorporationID = normalizeOwnerID(corporationID);
  if (!bill || bill.paid || !numericCorporationID) {
    return { success: false, errorMsg: "BILL_NOT_PAYABLE" };
  }

  if (bill.debtorID === numericCorporationID) {
    if (!getCorporationRecord(numericCorporationID)) {
      return { success: false, errorMsg: "CORPORATION_NOT_FOUND" };
    }
  } else {
    const alliance = getAllianceRecord(bill.debtorID);
    if (!alliance) {
      return { success: false, errorMsg: "ALLIANCE_NOT_FOUND" };
    }
    if (Number(alliance.executorCorporationID) !== numericCorporationID) {
      return { success: false, errorMsg: "ONLY_EXECUTOR_CAN_PAY" };
    }
  }

  const debitResult = adjustCorporationWalletDivisionBalance(
    numericCorporationID,
    normalizeCorporationWalletKey(accountKey),
    -bill.amount,
    {
      entryTypeID: 10,
      ownerID1: numericCorporationID,
      ownerID2: bill.creditorID,
      description: `Bill payment ${bill.billID}`,
    },
  );
  if (!debitResult.success) {
    return debitResult;
  }

  markBillPaid(bill.billID, numericCorporationID);
  return { success: true, data: getBillRecord(bill.billID) };
}

function tryAutoPayBill(billID) {
  const bill = getBillRecord(billID);
  if (!bill || bill.paid) {
    return;
  }

  const debtorSettings = getAutomaticPaySettingsForOwner(bill.debtorID);
  if (!debtorSettings[bill.billTypeID]) {
    return;
  }

  if (getCorporationRecord(bill.debtorID)) {
    payBillFromCorporation(
      bill.billID,
      bill.debtorID,
      debtorSettings.divisionID || DEFAULT_DIVISION_ID,
    );
    return;
  }

  const alliance = getAllianceRecord(bill.debtorID);
  if (!alliance) {
    return;
  }
  const executorCorporationID = normalizeOwnerID(alliance.executorCorporationID);
  if (!executorCorporationID) {
    return;
  }
  const executorSettings = getAutomaticPaySettingsForOwner(executorCorporationID);
  payBillFromCorporation(
    bill.billID,
    executorCorporationID,
    executorSettings.divisionID || DEFAULT_DIVISION_ID,
  );
}

module.exports = {
  BILL_TYPE_ALLIANCE_MAINTENANCE,
  BILL_TYPE_BROKER,
  BILL_TYPE_MARKET_FINE,
  BILL_TYPE_RENTAL,
  BILL_TYPE_WAR,
  DEFAULT_DIVISION_ID,
  buildAutomaticPaySettingsSnapshot,
  createBill,
  getAutomaticPaySettingsForOwner,
  getBillRecord,
  listBillsForCreditor,
  listBillsForDebtor,
  markBillPaid,
  payBillFromCharacter,
  payBillFromCorporation,
  setAutomaticPaySettingsForOwner,
};
