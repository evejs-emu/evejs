const path = require("path");

const {
  NOTIFICATION_GROUP,
  NOTIFICATION_TYPE,
} = require(path.join(__dirname, "../notifications/notificationConstants"));
const {
  createNotification,
} = require(path.join(__dirname, "../notifications/notificationState"));

const PEND_INSURANCE_CORPORATION_ID = 1000113;
const INSURANCE_INVALID_REASON = Object.freeze({
  NOT_OWNED_BY_YOU: 1,
  EXPIRED: 2,
  NO_VALUE: 3,
});

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function createInsuranceNotification(characterID, typeID, data = {}, options = {}) {
  const receiverID = toPositiveInt(characterID, 0);
  if (!receiverID) {
    return { success: false, errorMsg: "INVALID_CHARACTER" };
  }

  return createNotification(receiverID, {
    typeID,
    senderID: PEND_INSURANCE_CORPORATION_ID,
    groupID: NOTIFICATION_GROUP.INSURANCE,
    processed: false,
    data,
    emitLive: options.emitLive !== false,
    excludeSession: options.excludeSession || null,
  });
}

function notifyInsuranceIssued(characterID, contract, options = {}) {
  const itemID = toPositiveInt(
    (contract && (contract.shipID || contract.itemID)) ||
      options.itemID ||
      options.shipID,
    0,
  );
  return createInsuranceNotification(
    characterID,
    NOTIFICATION_TYPE.INSURANCE_ISSUED,
    {
      typeID: toPositiveInt(contract && contract.typeID, 0),
      ...(itemID > 0 ? { itemID } : {}),
    },
    options,
  );
}

function notifyInsurancePayout(characterID, payoutAmount, options = {}) {
  const itemID = toPositiveInt(options.itemID || options.shipID, 0);
  return createInsuranceNotification(
    characterID,
    NOTIFICATION_TYPE.INSURANCE_PAYOUT,
    {
      ...(itemID > 0 ? { itemID } : {}),
      payout: Number(payoutAmount) > 0,
    },
    options,
  );
}

function notifyInsuranceInvalidated(characterID, reason, data = {}, options = {}) {
  return createInsuranceNotification(
    characterID,
    NOTIFICATION_TYPE.INSURANCE_INVALIDATED,
    {
      ...data,
      reason: toPositiveInt(reason, INSURANCE_INVALID_REASON.NOT_OWNED_BY_YOU),
    },
    options,
  );
}

function notifyInsuranceExpiration(characterID, data = {}, options = {}) {
  return createInsuranceNotification(
    characterID,
    NOTIFICATION_TYPE.INSURANCE_EXPIRATION,
    data,
    options,
  );
}

module.exports = {
  PEND_INSURANCE_CORPORATION_ID,
  INSURANCE_INVALID_REASON,
  notifyInsuranceExpiration,
  notifyInsuranceInvalidated,
  notifyInsuranceIssued,
  notifyInsurancePayout,
};
