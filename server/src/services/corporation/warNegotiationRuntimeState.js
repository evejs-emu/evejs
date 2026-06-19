const path = require("path");

const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  cloneValue,
  ensureRuntimeInitialized,
  normalizeBoolean,
  normalizeInteger,
  normalizePositiveInteger,
  normalizeText,
  updateRuntimeState,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  getWarRecord,
  updateWarRecord,
} = require(path.join(__dirname, "./warRuntimeState"));
const {
  getCharacterAllyBaseCost,
  payConcordAllyFee,
  resolveWarEntityWalletOwner,
  settleWarEntityTransfer,
} = require(path.join(__dirname, "./warCostState"));
const {
  getCorporationWalletBalance,
} = require(path.join(__dirname, "./corpWalletState"));

const FILETIME_TICKS_PER_HOUR = 36000000000n;
const FILETIME_TICKS_PER_DAY = 864000000000n;
const FILETIME_TICKS_PER_WEEK = FILETIME_TICKS_PER_DAY * 7n;

const WAR_NEGOTIATION_TYPE_ALLY_OFFER = 0;
const WAR_NEGOTIATION_TYPE_SURRENDER_OFFER = 2;

const WAR_NEGOTIATION_STATE_NEW = 0;
const WAR_NEGOTIATION_STATE_ACCEPTED = 1;
const WAR_NEGOTIATION_STATE_DECLINED = 2;
const WAR_NEGOTIATION_STATE_RETRACTED = 3;

const PEACE_REASON_UNDEFINED = 0;
const PEACE_REASON_WAR_SURRENDER = 4;

function ensureRuntimeRoots(runtimeTable) {
  runtimeTable.warNegotiations =
    runtimeTable.warNegotiations &&
    typeof runtimeTable.warNegotiations === "object"
      ? runtimeTable.warNegotiations
      : {};
  runtimeTable.mutualWarInviteBlocks =
    runtimeTable.mutualWarInviteBlocks &&
    typeof runtimeTable.mutualWarInviteBlocks === "object"
      ? runtimeTable.mutualWarInviteBlocks
      : {};
  runtimeTable.peaceTreaties =
    runtimeTable.peaceTreaties && typeof runtimeTable.peaceTreaties === "object"
      ? runtimeTable.peaceTreaties
      : {};
  runtimeTable._meta.nextNegotiationID =
    normalizePositiveInteger(runtimeTable._meta && runtimeTable._meta.nextNegotiationID, 1) ||
    1;
  runtimeTable._meta.nextTreatyID =
    normalizePositiveInteger(runtimeTable._meta && runtimeTable._meta.nextTreatyID, 1) || 1;
  return runtimeTable;
}

function getNegotiationRecord(warNegotiationID) {
  const runtimeTable = ensureRuntimeRoots(ensureRuntimeInitialized());
  const record =
    runtimeTable.warNegotiations &&
    runtimeTable.warNegotiations[String(warNegotiationID)];
  return record ? cloneValue(record) : null;
}

function listNegotiationsForOwner(ownerID) {
  const numericOwnerID = normalizePositiveInteger(ownerID, null);
  if (!numericOwnerID) {
    return [];
  }
  const runtimeTable = ensureRuntimeRoots(ensureRuntimeInitialized());
  return Object.values(runtimeTable.warNegotiations || {})
    .filter(
      (entry) =>
        Number(entry && entry.ownerID1) === numericOwnerID ||
        Number(entry && entry.ownerID2) === numericOwnerID ||
        Number(entry && entry.declaredByID) === numericOwnerID ||
        Number(entry && entry.againstID) === numericOwnerID,
    )
    .map((entry) => cloneValue(entry))
    .sort((left, right) => Number(right.warNegotiationID) - Number(left.warNegotiationID));
}

function createPeaceTreaty({ warID, ownerID, otherOwnerID, peaceReason = PEACE_REASON_UNDEFINED } = {}) {
  const numericOwnerID = normalizePositiveInteger(ownerID, null);
  const numericOtherOwnerID = normalizePositiveInteger(otherOwnerID, null);
  const numericWarID = normalizePositiveInteger(warID, null);
  if (!numericOwnerID || !numericOtherOwnerID || !numericWarID) {
    return null;
  }

  let nextTreatyID = null;
  updateRuntimeState((runtimeTable) => {
    ensureRuntimeRoots(runtimeTable);
    nextTreatyID = runtimeTable._meta.nextTreatyID;
    runtimeTable._meta.nextTreatyID += 1;
    const now = currentFileTime();
    runtimeTable.peaceTreaties[String(nextTreatyID)] = {
      treatyID: nextTreatyID,
      warID: numericWarID,
      ownerID: numericOwnerID,
      otherOwnerID: numericOtherOwnerID,
      peaceReason: normalizeInteger(peaceReason, PEACE_REASON_UNDEFINED),
      createdDate: now.toString(),
      expiryDate: (now + FILETIME_TICKS_PER_WEEK * 2n).toString(),
    };
    return runtimeTable;
  });
  return nextTreatyID;
}

function createWarNegotiation({
  warID,
  warNegotiationTypeID,
  ownerID1,
  ownerID2,
  declaredByID,
  againstID,
  iskValue = 0,
  description = "",
  ownerID1AccountKey = 1000,
} = {}) {
  const numericWarID = normalizePositiveInteger(warID, null);
  const numericOwnerID1 = normalizePositiveInteger(ownerID1, null);
  const numericOwnerID2 = normalizePositiveInteger(ownerID2, null);
  if (!numericWarID || !numericOwnerID1 || !numericOwnerID2) {
    return null;
  }

  let nextNegotiationID = null;
  updateRuntimeState((runtimeTable) => {
    ensureRuntimeRoots(runtimeTable);
    nextNegotiationID = runtimeTable._meta.nextNegotiationID;
    runtimeTable._meta.nextNegotiationID += 1;
    runtimeTable.warNegotiations[String(nextNegotiationID)] = {
      warNegotiationID: nextNegotiationID,
      warID: numericWarID,
      warNegotiationTypeID: normalizeInteger(
        warNegotiationTypeID,
        WAR_NEGOTIATION_TYPE_ALLY_OFFER,
      ),
      ownerID1: numericOwnerID1,
      ownerID2: numericOwnerID2,
      declaredByID: normalizePositiveInteger(declaredByID, 0) || 0,
      againstID: normalizePositiveInteger(againstID, 0) || 0,
      iskValue: Number(iskValue || 0),
      ownerID1AccountKey: normalizeInteger(ownerID1AccountKey, 1000),
      description: normalizeText(description, ""),
      negotiationState: WAR_NEGOTIATION_STATE_NEW,
      createdDateTime: currentFileTime().toString(),
      timeAccepted: null,
      timeDeclined: null,
      timeRetracted: null,
    };
    return runtimeTable;
  });

  return getNegotiationRecord(nextNegotiationID);
}

function updateWarNegotiation(warNegotiationID, updater) {
  const numericNegotiationID = normalizePositiveInteger(warNegotiationID, null);
  if (!numericNegotiationID) {
    return null;
  }
  updateRuntimeState((runtimeTable) => {
    ensureRuntimeRoots(runtimeTable);
    const currentRecord = runtimeTable.warNegotiations[String(numericNegotiationID)];
    if (!currentRecord) {
      return runtimeTable;
    }
    runtimeTable.warNegotiations[String(numericNegotiationID)] =
      typeof updater === "function"
        ? updater(cloneValue(currentRecord)) || currentRecord
        : currentRecord;
    return runtimeTable;
  });
  return getNegotiationRecord(numericNegotiationID);
}

function resolveSessionCharacterID(session) {
  const numeric = Number(session && (session.characterID || session.charid));
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function resolveSessionAccountKey(session) {
  const numeric = Number(
    session && (session.corpAccountKey || session.corpaccountkey),
  );
  if (Number.isInteger(numeric) && numeric >= 1000 && numeric <= 1006) {
    return numeric;
  }
  return 1000;
}

function countExistingAllyContracts(war, currentTime) {
  return Object.values((war && war.allies) || {}).filter((ally) => {
    try {
      return BigInt(String(ally && ally.timeFinished ? ally.timeFinished : "0")) > currentTime;
    } catch (error) {
      return false;
    }
  }).length;
}

function acceptAllyNegotiation(warNegotiationID, session = null) {
  const negotiation = getNegotiationRecord(warNegotiationID);
  if (
    !negotiation ||
    normalizeInteger(negotiation.warNegotiationTypeID, -1) !==
      WAR_NEGOTIATION_TYPE_ALLY_OFFER
  ) {
    return null;
  }

  const war = getWarRecord(negotiation.warID);
  if (!war) {
    return null;
  }

  const now = currentFileTime();
  const payerOwnerID =
    normalizePositiveInteger(negotiation.ownerID2, null) ||
    normalizePositiveInteger(negotiation.againstID, null);
  const acceptingCharacterID = resolveSessionCharacterID(session);
  const accountKey = resolveSessionAccountKey(session);
  const existingAllyCount = countExistingAllyContracts(war, now);
  const allyBaseCost = getCharacterAllyBaseCost(acceptingCharacterID);
  const concordFee =
    existingAllyCount > 0
      ? allyBaseCost * 2 ** Math.min(existingAllyCount - 1, 20)
      : 0;
  const payerWallet = resolveWarEntityWalletOwner(payerOwnerID);
  const allyWallet = resolveWarEntityWalletOwner(negotiation.ownerID1);
  if (!payerWallet || !allyWallet) {
    return null;
  }
  const totalRequired = Number(negotiation.iskValue || 0) + concordFee;
  if (
    getCorporationWalletBalance(payerWallet.walletCorporationID, accountKey) + 0.0001 <
    totalRequired
  ) {
    return null;
  }
  if (concordFee > 0) {
    const concordFeeResult = payConcordAllyFee({
      ownerID: payerOwnerID,
      amount: concordFee,
      accountKey,
      description: `CONCORD ally registration fee for war ${negotiation.warID}`,
    });
    if (!concordFeeResult.success) {
      return null;
    }
  }
  if (Number(negotiation.iskValue || 0) > 0) {
    const allyPaymentResult = settleWarEntityTransfer({
      fromOwnerID: payerOwnerID,
      toOwnerID: negotiation.ownerID1,
      amount: Number(negotiation.iskValue || 0),
      fromAccountKey: accountKey,
      description: `War ally fee for war ${negotiation.warID}`,
    });
    if (!allyPaymentResult.success) {
      return null;
    }
  }

  updateWarNegotiation(warNegotiationID, (record) => ({
    ...record,
    negotiationState: WAR_NEGOTIATION_STATE_ACCEPTED,
    timeAccepted: now.toString(),
  }));
  updateWarRecord(negotiation.warID, (war) => {
    war.allies =
      war.allies && typeof war.allies === "object" ? war.allies : {};
    const timeStarted = (now + 4n * FILETIME_TICKS_PER_HOUR).toString();
    const warFinish = war.timeFinished ? BigInt(String(war.timeFinished)) : null;
    const naturalEnd = now + FILETIME_TICKS_PER_WEEK * 2n;
    const timeFinished =
      warFinish && warFinish < naturalEnd ? warFinish.toString() : naturalEnd.toString();
    war.allies[String(negotiation.ownerID1)] = {
      allyID: normalizePositiveInteger(negotiation.ownerID1, 0) || 0,
      timeStarted,
      timeFinished,
    };
    return war;
  });
  return getNegotiationRecord(warNegotiationID);
}

function acceptSurrender(warNegotiationID) {
  const negotiation = getNegotiationRecord(warNegotiationID);
  if (
    !negotiation ||
    normalizeInteger(negotiation.warNegotiationTypeID, -1) !==
      WAR_NEGOTIATION_TYPE_SURRENDER_OFFER
  ) {
    return null;
  }

  if (Number(negotiation.iskValue || 0) > 0) {
    const payerWallet = resolveWarEntityWalletOwner(negotiation.ownerID1);
    const receiverWallet = resolveWarEntityWalletOwner(negotiation.ownerID2);
    const payerAccountKey = normalizeInteger(negotiation.ownerID1AccountKey, 1000);
    if (!payerWallet || !receiverWallet) {
      return null;
    }
    if (
      getCorporationWalletBalance(payerWallet.walletCorporationID, payerAccountKey) + 0.0001 <
      Number(negotiation.iskValue || 0)
    ) {
      return null;
    }
    const surrenderPaymentResult = settleWarEntityTransfer({
      fromOwnerID: negotiation.ownerID1,
      toOwnerID: negotiation.ownerID2,
      amount: Number(negotiation.iskValue || 0),
      fromAccountKey: payerAccountKey,
      description: `War surrender fee for war ${negotiation.warID}`,
    });
    if (!surrenderPaymentResult.success) {
      return null;
    }
  }

  const now = currentFileTime();
  updateWarNegotiation(warNegotiationID, (record) => ({
    ...record,
    negotiationState: WAR_NEGOTIATION_STATE_ACCEPTED,
    timeAccepted: now.toString(),
  }));
  updateWarRecord(negotiation.warID, (war) => ({
    ...war,
    timeFinished: now.toString(),
  }));
  createPeaceTreaty({
    warID: negotiation.warID,
    ownerID: negotiation.declaredByID,
    otherOwnerID: negotiation.againstID,
    peaceReason: PEACE_REASON_WAR_SURRENDER,
  });
  createPeaceTreaty({
    warID: negotiation.warID,
    ownerID: negotiation.againstID,
    otherOwnerID: negotiation.declaredByID,
    peaceReason: PEACE_REASON_WAR_SURRENDER,
  });
  return getNegotiationRecord(warNegotiationID);
}

function setMutualWarInviteBlocked(ownerID, blocked) {
  const numericOwnerID = normalizePositiveInteger(ownerID, null);
  if (!numericOwnerID) {
    return;
  }
  updateRuntimeState((runtimeTable) => {
    ensureRuntimeRoots(runtimeTable);
    runtimeTable.mutualWarInviteBlocks[String(numericOwnerID)] = normalizeBoolean(blocked, false)
      ? 1
      : 0;
    return runtimeTable;
  });
}

function isMutualWarInviteBlocked(ownerID) {
  const numericOwnerID = normalizePositiveInteger(ownerID, null);
  if (!numericOwnerID) {
    return false;
  }
  const runtimeTable = ensureRuntimeRoots(ensureRuntimeInitialized());
  return Boolean(runtimeTable.mutualWarInviteBlocks[String(numericOwnerID)]);
}

function listPeaceTreatiesForOwner(ownerID) {
  const numericOwnerID = normalizePositiveInteger(ownerID, null);
  if (!numericOwnerID) {
    return { outgoing: [], incoming: [] };
  }
  const runtimeTable = ensureRuntimeRoots(ensureRuntimeInitialized());
  const allTreaties = Object.values(runtimeTable.peaceTreaties || {}).map((entry) =>
    cloneValue(entry),
  );
  return {
    outgoing: allTreaties
      .filter((entry) => Number(entry.ownerID) === numericOwnerID)
      .sort((left, right) => Number(right.treatyID) - Number(left.treatyID)),
    incoming: allTreaties
      .filter((entry) => Number(entry.otherOwnerID) === numericOwnerID)
      .sort((left, right) => Number(right.treatyID) - Number(left.treatyID)),
  };
}

module.exports = {
  WAR_NEGOTIATION_TYPE_ALLY_OFFER,
  WAR_NEGOTIATION_TYPE_SURRENDER_OFFER,
  WAR_NEGOTIATION_STATE_NEW,
  WAR_NEGOTIATION_STATE_ACCEPTED,
  WAR_NEGOTIATION_STATE_DECLINED,
  WAR_NEGOTIATION_STATE_RETRACTED,
  PEACE_REASON_UNDEFINED,
  PEACE_REASON_WAR_SURRENDER,
  acceptAllyNegotiation,
  acceptSurrender,
  createPeaceTreaty,
  createWarNegotiation,
  ensureRuntimeRoots,
  getNegotiationRecord,
  isMutualWarInviteBlocked,
  listNegotiationsForOwner,
  listPeaceTreatiesForOwner,
  setMutualWarInviteBlocked,
  updateWarNegotiation,
};
