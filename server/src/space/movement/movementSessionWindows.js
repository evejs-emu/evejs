function toInt(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric);
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? Math.trunc(fallbackNumeric) : 0;
}

function toUInt32(value, fallback = 0) {
  return toInt(value, fallback) >>> 0;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function resolvePresentedSessionDestinyStamp(options = {}) {
  const currentVisibleStamp = toUInt32(options.currentVisibleStamp, 0);
  if (options.hasSessionSpace !== true) {
    return currentVisibleStamp;
  }

  const defaultMaximumFutureLead = Math.max(
    0,
    toInt(options.defaultMaximumFutureLead, 0),
  );
  const maximumTrustedLead = Math.max(
    defaultMaximumFutureLead,
    toInt(options.maximumTrustedLead, defaultMaximumFutureLead),
  );
  const trustedFutureLead = clamp(
    toInt(options.maximumFutureLead, defaultMaximumFutureLead),
    0,
    maximumTrustedLead,
  );
  const lastSentStamp = toUInt32(options.lastSentStamp, currentVisibleStamp);
  const maximumTrustedPresentedStamp = (
    currentVisibleStamp + trustedFutureLead
  ) >>> 0;

  return (
    lastSentStamp > currentVisibleStamp &&
    lastSentStamp <= maximumTrustedPresentedStamp
  )
    ? lastSentStamp
    : currentVisibleStamp;
}

function resolvePendingHistorySafeSessionDestinyStamp(options = {}) {
  const rawStamp = toUInt32(options.rawStamp, 0);
  if (options.hasSessionSpace !== true) {
    return rawStamp;
  }

  const currentSessionStamp = toUInt32(options.currentSessionStamp, 0);
  const lastVisibleSessionStamp = toUInt32(options.lastVisibleSessionStamp, 0);
  const visibleBarrierStamp =
    lastVisibleSessionStamp > currentSessionStamp
      ? lastVisibleSessionStamp
      : currentSessionStamp;
  const minimumLead = clamp(toInt(options.minimumLead, 1), 0, 16);
  const minimumStamp = (currentSessionStamp + minimumLead) >>> 0;

  return Math.max(
    toUInt32(options.translatedStamp, rawStamp),
    visibleBarrierStamp,
    minimumStamp,
  ) >>> 0;
}

module.exports = {
  resolvePresentedSessionDestinyStamp,
  resolvePendingHistorySafeSessionDestinyStamp,
};
