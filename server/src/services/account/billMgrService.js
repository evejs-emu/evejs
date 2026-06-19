const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  extractDictEntries,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  buildAutomaticPaySettingsSnapshot,
  listBillsForCreditor,
  listBillsForDebtor,
  payBillFromCharacter,
  payBillFromCorporation,
  setAutomaticPaySettingsForOwner,
} = require(path.join(__dirname, "./billRuntimeState"));

function resolveCorporationID(session) {
  return Number(session && (session.corporationID || session.corpid)) || 0;
}

function resolveAllianceID(session) {
  return Number(session && (session.allianceID || session.allianceid)) || 0;
}

function resolveCharacterID(session) {
  return Number(session && (session.characterID || session.charid)) || 0;
}

function extractKwargValue(kwargs, key) {
  for (const [entryKey, entryValue] of extractDictEntries(kwargs)) {
    if (entryKey === key) {
      return entryValue;
    }
  }
  return undefined;
}

function normalizeBoolLike(value) {
  if (
    value &&
    typeof value === "object" &&
    (value.type === "int" || value.type === "long")
  ) {
    return Number(value.value || 0) !== 0;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return Number(value) !== 0;
  }
  return Boolean(value);
}

function buildBillPayload(bill) {
  return buildKeyVal([
    ["billID", Number(bill && bill.billID ? bill.billID : 0)],
    ["billTypeID", Number(bill && bill.billTypeID ? bill.billTypeID : 0)],
    ["amount", Number(bill && bill.amount ? bill.amount : 0)],
    ["interest", Number(bill && bill.interest ? bill.interest : 0)],
    ["debtorID", Number(bill && bill.debtorID ? bill.debtorID : 0)],
    ["creditorID", Number(bill && bill.creditorID ? bill.creditorID : 0)],
    [
      "dueDateTime",
      buildFiletimeLong(bill && bill.dueDateTime ? bill.dueDateTime : "0"),
    ],
    ["paid", bill && bill.paid ? 1 : 0],
    [
      "paidDateTime",
      bill && bill.paidDateTime ? buildFiletimeLong(bill.paidDateTime) : null,
    ],
    ["paidByOwnerID", Number(bill && bill.paidByOwnerID ? bill.paidByOwnerID : 0)],
    [
      "externalID",
      bill && bill.externalID !== undefined && bill.externalID !== null
        ? Number(bill.externalID)
        : -1,
    ],
    [
      "externalID2",
      bill && bill.externalID2 !== undefined && bill.externalID2 !== null
        ? Number(bill.externalID2)
        : -1,
    ],
  ]);
}

function parseAutomaticPaySettings(rawSettings) {
  const parsed = {};
  for (const [ownerID, settingsValue] of extractDictEntries(rawSettings)) {
    const numericOwnerID = Number(ownerID) || 0;
    if (!numericOwnerID) {
      continue;
    }
    parsed[numericOwnerID] = {};
    for (const [key, value] of extractDictEntries(settingsValue)) {
      if (key === "divisionID") {
        parsed[numericOwnerID].divisionID =
          Number(
            value &&
              typeof value === "object" &&
              (value.type === "int" || value.type === "long")
              ? value.value
              : value,
          ) || 1000;
        continue;
      }
      parsed[numericOwnerID][Number(key) || 0] = normalizeBoolLike(value);
    }
  }
  return parsed;
}

class BillManagerService extends BaseService {
  constructor() {
    super("billMgr");
  }

  Handle_GetAutomaticPaySettings(args, session) {
    const ownerIDs = [resolveCorporationID(session)];
    const allianceID = resolveAllianceID(session);
    if (allianceID) {
      ownerIDs.push(allianceID);
    }
    return buildDict(
      Object.entries(buildAutomaticPaySettingsSnapshot(ownerIDs)).map(
        ([ownerID, settings]) => [
          Number(ownerID),
          buildDict(
            Object.entries(settings).map(([key, value]) => [key === "divisionID" ? key : Number(key), value]),
          ),
        ],
      ),
    );
  }

  Handle_SendAutomaticPaySettings(args, session) {
    const parsedSettings = parseAutomaticPaySettings(args && args[0]);
    const allowedOwnerIDs = new Set([
      resolveCorporationID(session),
      resolveAllianceID(session),
    ]);
    for (const [ownerID, settings] of Object.entries(parsedSettings)) {
      if (!allowedOwnerIDs.has(Number(ownerID))) {
        continue;
      }
      setAutomaticPaySettingsForOwner(ownerID, settings);
    }
    return null;
  }

  Handle_GetCorporationBills(args, session) {
    return buildList(
      listBillsForDebtor(resolveCorporationID(session)).map((bill) =>
        buildBillPayload(bill),
      ),
    );
  }

  Handle_GetCorporationBillsReceivable(args, session) {
    return buildList(
      listBillsForCreditor(resolveCorporationID(session)).map((bill) =>
        buildBillPayload(bill),
      ),
    );
  }

  Handle_PayCorporationBill(args, session, kwargs) {
    const billID = Number(args && args[0]) || 0;
    const fromAccountKey =
      Number(
        extractKwargValue(kwargs, "fromAccountKey") ??
          (args && args[1]) ??
          1000,
      ) || 1000;
    payBillFromCorporation(billID, resolveCorporationID(session), fromAccountKey);
    return null;
  }

  Handle_CharPayBill(args, session) {
    const billID = Number(args && args[0]) || 0;
    payBillFromCharacter(billID, resolveCharacterID(session));
    return null;
  }
}

module.exports = BillManagerService;
