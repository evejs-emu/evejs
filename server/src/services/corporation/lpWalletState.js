const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getCorporationMember,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  getAllianceRecord,
  getCorporationRecord,
} = require(path.join(__dirname, "./corporationState"));
const {
  getDaysInAlliance,
} = require(path.join(__dirname, "./allianceViewState"));

const LP_WALLETS_TABLE = "lpWallets";
const EVERMARK_ISSUER_CORP_ID = 1000419;
// Current V23.02 client flag state allows immediate EM donations.
const EM_DONATION_MIN_MEMBERSHIP_DAYS = 0;
const CORP_ROLE_DIRECTOR = 1n;
const CORP_ROLE_BRAND_MANAGER = 34359738368n;

function getCharacterRecord(characterID) {
  const characterState = require(path.join(
    __dirname,
    "../character/characterState",
  ));
  return characterState && typeof characterState.getCharacterRecord === "function"
    ? characterState.getCharacterRecord(characterID)
    : null;
}

const DEFAULT_LP_WALLET_TABLE = Object.freeze({
  _meta: {
    generatedAt: null,
    lastUpdatedAt: null,
  },
  characterWallets: {},
  corporationWallets: {},
});

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
}

function normalizeLpAmount(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(0, Math.trunc(Number(fallback) || 0));
  }
  return Math.max(0, Math.trunc(numeric));
}

function normalizeRoleMask(value) {
  if (typeof value === "bigint") {
    return value;
  }
  try {
    return BigInt(value || 0);
  } catch (_error) {
    return 0n;
  }
}

function getDaysSinceFiletime(rawValue) {
  try {
    const filetime = BigInt(String(rawValue || "0"));
    if (filetime <= 0n) {
      return 0;
    }
    const diff = currentFileTime() - filetime;
    if (diff <= 0n) {
      return 0;
    }
    return Number(diff / 864000000000n);
  } catch (_error) {
    return 0;
  }
}

function getCharacterCorporationMembershipStartDate(characterID, corporationID, characterRecord = null) {
  const corporationMember = getCorporationMember(corporationID, characterID);
  if (corporationMember && corporationMember.startDate) {
    return corporationMember.startDate;
  }

  return (
    characterRecord &&
    (characterRecord.startDateTime ||
      (Array.isArray(characterRecord.employmentHistory)
        ? characterRecord.employmentHistory.find(
            (entry) =>
              Number(entry && entry.corporationID) === Number(corporationID),
          )?.startDate
        : null) ||
      characterRecord.createDateTime)
  );
}

function validatePlayerCorporationDestination(corporationID) {
  const corporation = getCorporationRecord(corporationID);
  if (!corporation || corporation.isNPC === true) {
    return {
      success: false,
      errorMsg: "DESTINATION_CORPORATION_INVALID",
    };
  }
  if (Number(corporation.memberCount || 0) <= 0) {
    return {
      success: false,
      errorMsg: "DESTINATION_CORPORATION_EMPTY",
    };
  }
  return {
    success: true,
    data: corporation,
  };
}

function buildCharacterEvermarkDestinationSet(characterRecord, session) {
  const characterID = normalizePositiveInteger(
    session && session.characterID,
    normalizePositiveInteger(characterRecord && characterRecord.characterID, 0),
  );
  const sourceCorporationID = normalizePositiveInteger(
    session && (session.corporationID || session.corpid),
    normalizePositiveInteger(characterRecord && characterRecord.corporationID, 0),
  );
  if (!sourceCorporationID) {
    return [];
  }

  const sourceCorporation = getCorporationRecord(sourceCorporationID);
  if (!sourceCorporation || sourceCorporation.isNPC === true) {
    return [];
  }

  const corpMembershipDays = getDaysSinceFiletime(
    getCharacterCorporationMembershipStartDate(
      characterID,
      sourceCorporationID,
      characterRecord,
    ),
  );
  if (corpMembershipDays < EM_DONATION_MIN_MEMBERSHIP_DAYS) {
    return [];
  }

  const allowed = new Set([sourceCorporationID]);
  const allianceID = normalizePositiveInteger(
    session && (session.allianceID || session.allianceid),
    normalizePositiveInteger(sourceCorporation.allianceID, 0),
  );
  if (!allianceID) {
    return [...allowed];
  }

  if (getDaysInAlliance(allianceID, sourceCorporationID) < EM_DONATION_MIN_MEMBERSHIP_DAYS) {
    return [...allowed];
  }

  const alliance = getAllianceRecord(allianceID);
  const executorCorpID = normalizePositiveInteger(
    alliance && (alliance.executorCorpID || alliance.executorCorporationID),
    0,
  );
  if (
    executorCorpID &&
    executorCorpID !== sourceCorporationID &&
    getDaysInAlliance(allianceID, executorCorpID) >= EM_DONATION_MIN_MEMBERSHIP_DAYS
  ) {
    allowed.add(executorCorpID);
  }
  return [...allowed];
}

function buildCorporationEvermarkDestinationSet(sourceCorporationID, session) {
  const sourceCorporation = getCorporationRecord(sourceCorporationID);
  if (!sourceCorporation || sourceCorporation.isNPC === true) {
    return [];
  }

  const allianceID = normalizePositiveInteger(
    session && (session.allianceID || session.allianceid),
    normalizePositiveInteger(sourceCorporation.allianceID, 0),
  );
  if (!allianceID) {
    return [];
  }
  if (getDaysInAlliance(allianceID, sourceCorporationID) < EM_DONATION_MIN_MEMBERSHIP_DAYS) {
    return [];
  }

  const alliance = getAllianceRecord(allianceID);
  const executorCorpID = normalizePositiveInteger(
    alliance && (alliance.executorCorpID || alliance.executorCorporationID),
    0,
  );
  if (!executorCorpID) {
    return [];
  }

  const allowed = new Set();
  if (executorCorpID === sourceCorporationID) {
    for (const memberCorporationID of alliance.memberCorporationIDs || []) {
      const normalizedMemberCorporationID = normalizePositiveInteger(memberCorporationID, 0);
      if (
        normalizedMemberCorporationID &&
        normalizedMemberCorporationID !== sourceCorporationID &&
        getDaysInAlliance(allianceID, normalizedMemberCorporationID) >= EM_DONATION_MIN_MEMBERSHIP_DAYS
      ) {
        allowed.add(normalizedMemberCorporationID);
      }
    }
  } else if (getDaysInAlliance(allianceID, executorCorpID) >= EM_DONATION_MIN_MEMBERSHIP_DAYS) {
    allowed.add(executorCorpID);
  }

  return [...allowed];
}

function readLpWalletTable() {
  const result = database.read(LP_WALLETS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return cloneValue(DEFAULT_LP_WALLET_TABLE);
  }

  return {
    _meta:
      result.data._meta && typeof result.data._meta === "object"
        ? {
          generatedAt: result.data._meta.generatedAt || null,
          lastUpdatedAt: result.data._meta.lastUpdatedAt || null,
        }
        : cloneValue(DEFAULT_LP_WALLET_TABLE._meta),
    characterWallets:
      result.data.characterWallets && typeof result.data.characterWallets === "object"
        ? cloneValue(result.data.characterWallets)
        : {},
    corporationWallets:
      result.data.corporationWallets && typeof result.data.corporationWallets === "object"
        ? cloneValue(result.data.corporationWallets)
        : {},
  };
}

function writeLpWalletTable(table) {
  const nextTable = {
    _meta: {
      generatedAt:
        table &&
        table._meta &&
        table._meta.generatedAt
          ? String(table._meta.generatedAt)
          : null,
      lastUpdatedAt: new Date().toISOString(),
    },
    characterWallets:
      table && table.characterWallets && typeof table.characterWallets === "object"
        ? cloneValue(table.characterWallets)
        : {},
    corporationWallets:
      table && table.corporationWallets && typeof table.corporationWallets === "object"
        ? cloneValue(table.corporationWallets)
        : {},
  };
  const result = database.write(LP_WALLETS_TABLE, "/", nextTable);
  if (!result.success) {
    return {
      success: false,
      errorMsg: result.errorMsg || "WRITE_FAILED",
    };
  }
  return {
    success: true,
    data: nextTable,
  };
}

function normalizeWalletRows(source) {
  return Object.entries(source && typeof source === "object" ? source : {})
    .map(([issuerCorpID, amount]) => ({
      issuerCorpID: normalizePositiveInteger(issuerCorpID, 0),
      amount: normalizeLpAmount(amount, 0),
    }))
    .filter((entry) => entry.issuerCorpID > 0 && entry.amount > 0)
    .sort((left, right) => left.issuerCorpID - right.issuerCorpID);
}

function getCharacterWalletLPBalances(characterID) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  if (!normalizedCharacterID) {
    return [];
  }

  const table = readLpWalletTable();
  return normalizeWalletRows(table.characterWallets[String(normalizedCharacterID)]);
}

function getCorporationWalletLPBalances(corporationID) {
  const normalizedCorporationID = normalizePositiveInteger(corporationID, 0);
  if (!normalizedCorporationID) {
    return [];
  }

  const table = readLpWalletTable();
  return normalizeWalletRows(table.corporationWallets[String(normalizedCorporationID)]);
}

function getCharacterWalletLPBalance(characterID, issuerCorpID) {
  const normalizedIssuerCorpID = normalizePositiveInteger(issuerCorpID, 0);
  return getCharacterWalletLPBalances(characterID)
    .find((entry) => entry.issuerCorpID === normalizedIssuerCorpID)
    ?.amount || 0;
}

function getCorporationWalletLPBalance(corporationID, issuerCorpID) {
  const normalizedIssuerCorpID = normalizePositiveInteger(issuerCorpID, 0);
  return getCorporationWalletLPBalances(corporationID)
    .find((entry) => entry.issuerCorpID === normalizedIssuerCorpID)
    ?.amount || 0;
}

function notifyCharacterLpBalanceChange(characterID, issuerCorpID, previousAmount, nextAmount, changeType = "set") {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  const normalizedIssuerCorpID = normalizePositiveInteger(issuerCorpID, 0);
  if (!normalizedCharacterID || !normalizedIssuerCorpID) {
    return;
  }

  for (const session of sessionRegistry.getSessions()) {
    if (
      Number(session && session.characterID) !== normalizedCharacterID ||
      typeof session.sendNotification !== "function"
    ) {
      continue;
    }
    session.sendNotification("OnLPChange", "clientID", [
      String(changeType || "set"),
      normalizedIssuerCorpID,
      normalizeLpAmount(previousAmount, 0),
      normalizeLpAmount(nextAmount, 0),
    ]);
  }
}

function notifyCorporationLpBalanceChange(corporationID, issuerCorpID, reason = "set") {
  const normalizedCorporationID = normalizePositiveInteger(corporationID, 0);
  const normalizedIssuerCorpID = normalizePositiveInteger(issuerCorpID, 0);
  if (!normalizedCorporationID || !normalizedIssuerCorpID) {
    return;
  }

  for (const session of sessionRegistry.getSessions()) {
    if (
      Number(session && (session.corporationID || session.corpid)) !== normalizedCorporationID ||
      typeof session.sendNotification !== "function"
    ) {
      continue;
    }
    session.sendNotification("OnCorpLPChange", "clientID", [
      String(reason || "set"),
      normalizedIssuerCorpID,
    ]);
  }
}

function updateWalletBalance(kind, ownerID, issuerCorpID, updater, options = {}) {
  const normalizedOwnerID = normalizePositiveInteger(ownerID, 0);
  const normalizedIssuerCorpID = normalizePositiveInteger(issuerCorpID, 0);
  if (!normalizedOwnerID || !normalizedIssuerCorpID) {
    return {
      success: false,
      errorMsg: "INVALID_OWNER_OR_ISSUER",
    };
  }

  const table = readLpWalletTable();
  const walletKey = kind === "corporation" ? "corporationWallets" : "characterWallets";
  const ownerKey = String(normalizedOwnerID);
  const issuerKey = String(normalizedIssuerCorpID);
  const wallet = table[walletKey][ownerKey] && typeof table[walletKey][ownerKey] === "object"
    ? cloneValue(table[walletKey][ownerKey])
    : {};
  const previousAmount = normalizeLpAmount(wallet[issuerKey], 0);
  const nextAmount = normalizeLpAmount(updater(previousAmount), previousAmount);

  if (nextAmount > 0) {
    wallet[issuerKey] = nextAmount;
    table[walletKey][ownerKey] = wallet;
  } else if (table[walletKey][ownerKey] && Object.prototype.hasOwnProperty.call(wallet, issuerKey)) {
    delete wallet[issuerKey];
    if (Object.keys(wallet).length > 0) {
      table[walletKey][ownerKey] = wallet;
    } else {
      delete table[walletKey][ownerKey];
    }
  } else if (Object.keys(wallet).length === 0) {
    delete table[walletKey][ownerKey];
  }

  const writeResult = writeLpWalletTable(table);
  if (!writeResult.success) {
    return writeResult;
  }

  if (kind === "corporation") {
    notifyCorporationLpBalanceChange(
      normalizedOwnerID,
      normalizedIssuerCorpID,
      options.reason || "set",
    );
  } else {
    notifyCharacterLpBalanceChange(
      normalizedOwnerID,
      normalizedIssuerCorpID,
      previousAmount,
      nextAmount,
      options.changeType || "set",
    );
  }

  return {
    success: true,
    data: {
      ownerID: normalizedOwnerID,
      issuerCorpID: normalizedIssuerCorpID,
      previousAmount,
      amount: nextAmount,
      delta: nextAmount - previousAmount,
    },
  };
}

function setCharacterWalletLPBalance(characterID, issuerCorpID, amount, options = {}) {
  return updateWalletBalance(
    "character",
    characterID,
    issuerCorpID,
    () => normalizeLpAmount(amount, 0),
    { changeType: options.changeType || "set" },
  );
}

function adjustCharacterWalletLPBalance(characterID, issuerCorpID, delta, options = {}) {
  const normalizedDelta = Math.trunc(Number(delta) || 0);
  return updateWalletBalance(
    "character",
    characterID,
    issuerCorpID,
    (previousAmount) => Math.max(0, previousAmount + normalizedDelta),
    { changeType: options.changeType || "set" },
  );
}

function setCorporationWalletLPBalance(corporationID, issuerCorpID, amount, options = {}) {
  return updateWalletBalance(
    "corporation",
    corporationID,
    issuerCorpID,
    () => normalizeLpAmount(amount, 0),
    { reason: options.reason || "set" },
  );
}

function adjustCorporationWalletLPBalance(corporationID, issuerCorpID, delta, options = {}) {
  const normalizedDelta = Math.trunc(Number(delta) || 0);
  return updateWalletBalance(
    "corporation",
    corporationID,
    issuerCorpID,
    (previousAmount) => Math.max(0, previousAmount + normalizedDelta),
    { reason: options.reason || "set" },
  );
}

function transferCharacterWalletLPToCorporation(session, destinationCorporationID, issuerCorpID, amount) {
  const characterID = normalizePositiveInteger(session && session.characterID, 0);
  const normalizedDestinationCorporationID = normalizePositiveInteger(destinationCorporationID, 0);
  const normalizedIssuerCorpID = normalizePositiveInteger(issuerCorpID, 0);
  const normalizedAmount = normalizeLpAmount(amount, 0);
  if (!characterID || !normalizedDestinationCorporationID || !normalizedIssuerCorpID || normalizedAmount <= 0) {
    return {
      success: false,
      errorMsg: "INVALID_TRANSFER",
    };
  }

  const destinationValidation = validatePlayerCorporationDestination(normalizedDestinationCorporationID);
  if (!destinationValidation.success) {
    return destinationValidation;
  }

  const currentBalance = getCharacterWalletLPBalance(characterID, normalizedIssuerCorpID);
  if (currentBalance < normalizedAmount) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_FUNDS",
    };
  }

  if (normalizedIssuerCorpID === EVERMARK_ISSUER_CORP_ID) {
    const characterRecord = getCharacterRecord(characterID);
    const allowedDestinations = buildCharacterEvermarkDestinationSet(characterRecord, session);
    if (!allowedDestinations.includes(normalizedDestinationCorporationID)) {
      return {
        success: false,
        errorMsg: "DESTINATION_NOT_ALLOWED",
      };
    }
  }

  const debitResult = adjustCharacterWalletLPBalance(
    characterID,
    normalizedIssuerCorpID,
    -normalizedAmount,
    { changeType: "transfer_out" },
  );
  if (!debitResult.success) {
    return debitResult;
  }

  const creditResult = adjustCorporationWalletLPBalance(
    normalizedDestinationCorporationID,
    normalizedIssuerCorpID,
    normalizedAmount,
    { reason: "transfer_in" },
  );
  if (!creditResult.success) {
    adjustCharacterWalletLPBalance(
      characterID,
      normalizedIssuerCorpID,
      normalizedAmount,
      { changeType: "transfer_rollback" },
    );
    return creditResult;
  }

  return {
    success: true,
    data: {
      sourceCharacterID: characterID,
      destinationCorporationID: normalizedDestinationCorporationID,
      issuerCorpID: normalizedIssuerCorpID,
      amount: normalizedAmount,
      sourceNewBalance: debitResult.data.amount,
      destinationNewBalance: creditResult.data.amount,
    },
  };
}

function transferCorporationWalletLPToCorporation(session, destinationCorporationID, issuerCorpID, amount) {
  const sourceCorporationID = normalizePositiveInteger(
    session && (session.corporationID || session.corpid),
    0,
  );
  const normalizedDestinationCorporationID = normalizePositiveInteger(destinationCorporationID, 0);
  const normalizedIssuerCorpID = normalizePositiveInteger(issuerCorpID, 0);
  const normalizedAmount = normalizeLpAmount(amount, 0);
  if (!sourceCorporationID || !normalizedDestinationCorporationID || !normalizedIssuerCorpID || normalizedAmount <= 0) {
    return {
      success: false,
      errorMsg: "INVALID_TRANSFER",
    };
  }

  const roleMask = normalizeRoleMask(session && session.corprole);
  const requiredRoleMask =
    normalizedIssuerCorpID === EVERMARK_ISSUER_CORP_ID
      ? CORP_ROLE_BRAND_MANAGER
      : CORP_ROLE_DIRECTOR;
  if ((roleMask & requiredRoleMask) === 0n) {
    return {
      success: false,
      errorMsg: "ACCESS_DENIED",
    };
  }

  if (normalizedDestinationCorporationID === sourceCorporationID) {
    return {
      success: false,
      errorMsg: "DESTINATION_NOT_ALLOWED",
    };
  }

  const destinationValidation = validatePlayerCorporationDestination(normalizedDestinationCorporationID);
  if (!destinationValidation.success) {
    return destinationValidation;
  }

  const currentBalance = getCorporationWalletLPBalance(sourceCorporationID, normalizedIssuerCorpID);
  if (currentBalance < normalizedAmount) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_FUNDS",
    };
  }

  if (normalizedIssuerCorpID === EVERMARK_ISSUER_CORP_ID) {
    const allowedDestinations = buildCorporationEvermarkDestinationSet(sourceCorporationID, session);
    if (!allowedDestinations.includes(normalizedDestinationCorporationID)) {
      return {
        success: false,
        errorMsg: "DESTINATION_NOT_ALLOWED",
      };
    }
  }

  const debitResult = adjustCorporationWalletLPBalance(
    sourceCorporationID,
    normalizedIssuerCorpID,
    -normalizedAmount,
    { reason: "transfer_out" },
  );
  if (!debitResult.success) {
    return debitResult;
  }

  const creditResult = adjustCorporationWalletLPBalance(
    normalizedDestinationCorporationID,
    normalizedIssuerCorpID,
    normalizedAmount,
    { reason: "transfer_in" },
  );
  if (!creditResult.success) {
    adjustCorporationWalletLPBalance(
      sourceCorporationID,
      normalizedIssuerCorpID,
      normalizedAmount,
      { reason: "transfer_rollback" },
    );
    return creditResult;
  }

  return {
    success: true,
    data: {
      sourceCorporationID,
      destinationCorporationID: normalizedDestinationCorporationID,
      issuerCorpID: normalizedIssuerCorpID,
      amount: normalizedAmount,
      sourceNewBalance: debitResult.data.amount,
      destinationNewBalance: creditResult.data.amount,
    },
  };
}

module.exports = {
  LP_WALLETS_TABLE,
  EVERMARK_ISSUER_CORP_ID,
  getCharacterWalletLPBalances,
  getCorporationWalletLPBalances,
  getCharacterWalletLPBalance,
  getCorporationWalletLPBalance,
  setCharacterWalletLPBalance,
  adjustCharacterWalletLPBalance,
  setCorporationWalletLPBalance,
  adjustCorporationWalletLPBalance,
  transferCharacterWalletLPToCorporation,
  transferCorporationWalletLPToCorporation,
  _testing: {
    readLpWalletTable,
    writeLpWalletTable,
    buildCharacterEvermarkDestinationSet,
    buildCorporationEvermarkDestinationSet,
  },
};
