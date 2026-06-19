const path = require("path");

const sessionRegistry = require(path.join(__dirname, "../../chat/sessionRegistry"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getLiveCharacterSession(characterID) {
  return sessionRegistry.findSessionByCharacterID(characterID);
}

function notifyNonDiminishingInjectionsAdded(characterID, amount) {
  const session = getLiveCharacterSession(characterID);
  const normalizedAmount = Math.max(0, toInt(amount, 0));
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    normalizedAmount <= 0
  ) {
    return;
  }
  session.sendNotification("OnNonDiminishingInjectionsAdded", "clientID", [
    normalizedAmount,
  ]);
}

function notifyNonDiminishingInjectionsUsed(characterID, amount) {
  const session = getLiveCharacterSession(characterID);
  const normalizedAmount = Math.max(0, toInt(amount, 0));
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    normalizedAmount <= 0
  ) {
    return;
  }
  session.sendNotification("OnNonDiminishingInjectionsUsed", "clientID", [
    normalizedAmount,
  ]);
}

function notifyNonDiminishingInjectionsRemoved(characterID) {
  const session = getLiveCharacterSession(characterID);
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  session.sendNotification("OnNonDiminishingInjectionsRemoved", "clientID", []);
}

module.exports = {
  notifyNonDiminishingInjectionsAdded,
  notifyNonDiminishingInjectionsRemoved,
  notifyNonDiminishingInjectionsUsed,
};
