const path = require("path");

const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  getCharacterSkills,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  adjustCorporationWalletDivisionBalance,
  normalizeCorporationWalletKey,
} = require(path.join(__dirname, "./corpWalletState"));
const {
  getAllianceRecord,
  getCorporationRecord,
} = require(path.join(__dirname, "./corporationState"));

const DIPLOMATIC_RELATIONS_TYPE_ID = 3368;
const ATTRIBUTE_BASE_DEFENDER_ALLY_COST = 1820;
const ATTRIBUTE_SKILL_ALLY_COST_MODIFIER_BONUS = 1821;
const DEFAULT_ALLY_BASE_COST = 10000000;
const DEFAULT_RECEIVING_ACCOUNT_KEY = 1000;
const CONCORD_CORPORATION_ID = 1000125;

function normalizeOwnerID(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeMoney(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.round(numeric * 100) / 100;
}

function getDiplomaticRelationsDogmaAttributes() {
  const typeDogma = readStaticTable(TABLE.TYPE_DOGMA);
  const byTypeID =
    typeDogma && typeof typeDogma === "object" && typeDogma.typesByTypeID
      ? typeDogma.typesByTypeID
      : {};
  const record = byTypeID[String(DIPLOMATIC_RELATIONS_TYPE_ID)];
  return record && typeof record.attributes === "object" ? record.attributes : {};
}

function getCharacterSkillLevel(characterID, skillTypeID) {
  const numericCharacterID = normalizeOwnerID(characterID);
  const numericSkillTypeID = Number(skillTypeID) || 0;
  if (!numericCharacterID || !numericSkillTypeID) {
    return 0;
  }

  const skillRecord = getCharacterSkills(numericCharacterID).find(
    (record) => Number(record && record.typeID) === numericSkillTypeID,
  );
  if (!skillRecord) {
    return 0;
  }

  return Math.max(
    0,
    Number(
      skillRecord.effectiveSkillLevel ??
        skillRecord.trainedSkillLevel ??
        skillRecord.skillLevel ??
        0,
    ) || 0,
  );
}

function getCharacterAllyBaseCost(characterID) {
  const attributes = getDiplomaticRelationsDogmaAttributes();
  const baseCost = normalizeMoney(
    attributes[String(ATTRIBUTE_BASE_DEFENDER_ALLY_COST)],
    DEFAULT_ALLY_BASE_COST,
  );
  const modifierPercentPerLevel = normalizeMoney(
    attributes[String(ATTRIBUTE_SKILL_ALLY_COST_MODIFIER_BONUS)],
    0,
  );
  const skillLevel = getCharacterSkillLevel(
    characterID,
    DIPLOMATIC_RELATIONS_TYPE_ID,
  );
  const modifierMultiplier = Math.max(
    0,
    1 + (modifierPercentPerLevel * skillLevel) / 100,
  );
  return Math.max(0, Math.round(baseCost * modifierMultiplier));
}

function resolveWarEntityWalletOwner(ownerID) {
  const numericOwnerID = normalizeOwnerID(ownerID);
  if (!numericOwnerID) {
    return null;
  }

  const corporation = getCorporationRecord(numericOwnerID);
  if (corporation) {
    return {
      kind: "corporation",
      ownerID: numericOwnerID,
      walletCorporationID: numericOwnerID,
    };
  }

  const alliance = getAllianceRecord(numericOwnerID);
  if (!alliance) {
    return null;
  }

  const executorCorporationID = normalizeOwnerID(alliance.executorCorporationID);
  if (!executorCorporationID || !getCorporationRecord(executorCorporationID)) {
    return null;
  }

  return {
    kind: "alliance",
    ownerID: numericOwnerID,
    walletCorporationID: executorCorporationID,
  };
}

function debitWarEntityWallet({
  ownerID,
  amount,
  accountKey = DEFAULT_RECEIVING_ACCOUNT_KEY,
  ownerID2 = 0,
  description = "War wallet transfer",
} = {}) {
  const walletOwner = resolveWarEntityWalletOwner(ownerID);
  if (!walletOwner) {
    return {
      success: false,
      errorMsg: "WAR_ENTITY_NOT_FOUND",
    };
  }

  return adjustCorporationWalletDivisionBalance(
    walletOwner.walletCorporationID,
    normalizeCorporationWalletKey(accountKey),
    -Math.abs(normalizeMoney(amount, 0)),
    {
      entryTypeID: 10,
      ownerID1: walletOwner.ownerID,
      ownerID2: normalizeOwnerID(ownerID2),
      description,
    },
  );
}

function creditWarEntityWallet({
  ownerID,
  amount,
  ownerID1 = 0,
  description = "War wallet transfer",
} = {}) {
  const walletOwner = resolveWarEntityWalletOwner(ownerID);
  if (!walletOwner) {
    return {
      success: false,
      errorMsg: "WAR_ENTITY_NOT_FOUND",
    };
  }

  return adjustCorporationWalletDivisionBalance(
    walletOwner.walletCorporationID,
    DEFAULT_RECEIVING_ACCOUNT_KEY,
    Math.abs(normalizeMoney(amount, 0)),
    {
      entryTypeID: 10,
      ownerID1: normalizeOwnerID(ownerID1),
      ownerID2: walletOwner.ownerID,
      description,
    },
  );
}

function settleWarEntityTransfer({
  fromOwnerID,
  toOwnerID,
  amount,
  fromAccountKey = DEFAULT_RECEIVING_ACCOUNT_KEY,
  description = "War wallet transfer",
} = {}) {
  const normalizedAmount = Math.abs(normalizeMoney(amount, 0));
  if (!(normalizedAmount > 0)) {
    return {
      success: true,
      data: {
        amount: 0,
      },
    };
  }

  const sourceWallet = resolveWarEntityWalletOwner(fromOwnerID);
  const targetWallet = resolveWarEntityWalletOwner(toOwnerID);
  if (!sourceWallet || !targetWallet) {
    return {
      success: false,
      errorMsg: "WAR_ENTITY_NOT_FOUND",
    };
  }

  const debitResult = debitWarEntityWallet({
    ownerID: sourceWallet.ownerID,
    amount: normalizedAmount,
    accountKey: fromAccountKey,
    ownerID2: targetWallet.ownerID,
    description,
  });
  if (!debitResult.success) {
    return debitResult;
  }

  const creditResult = creditWarEntityWallet({
    ownerID: targetWallet.ownerID,
    amount: normalizedAmount,
    ownerID1: sourceWallet.ownerID,
    description,
  });
  if (!creditResult.success) {
    return creditResult;
  }

  return {
    success: true,
    data: {
      amount: normalizedAmount,
      fromOwnerID: sourceWallet.ownerID,
      toOwnerID: targetWallet.ownerID,
      fromWalletCorporationID: sourceWallet.walletCorporationID,
      toWalletCorporationID: targetWallet.walletCorporationID,
    },
  };
}

function payConcordAllyFee({
  ownerID,
  amount,
  accountKey = DEFAULT_RECEIVING_ACCOUNT_KEY,
  description = "CONCORD ally registration fee",
} = {}) {
  return debitWarEntityWallet({
    ownerID,
    amount,
    accountKey,
    ownerID2: CONCORD_CORPORATION_ID,
    description,
  });
}

module.exports = {
  CONCORD_CORPORATION_ID,
  DEFAULT_ALLY_BASE_COST,
  getCharacterAllyBaseCost,
  payConcordAllyFee,
  resolveWarEntityWalletOwner,
  settleWarEntityTransfer,
};
