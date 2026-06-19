const crypto = require("crypto");

function bufferFromBytes(value) {
  if (Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (Array.isArray(value)) {
    return Buffer.from(value);
  }
  if (value && typeof value === "object" && value.type === "Buffer") {
    return Buffer.from(value.data || []);
  }
  return Buffer.alloc(0);
}

function getActiveCharacterID(requestEnvelope) {
  const identityCharacter =
    requestEnvelope &&
    requestEnvelope.authoritative_context &&
    requestEnvelope.authoritative_context.identity &&
    requestEnvelope.authoritative_context.identity.character
      ? Number(
          requestEnvelope.authoritative_context.identity.character.sequential || 0,
        )
      : 0;
  if (identityCharacter > 0) {
    return identityCharacter;
  }
  const activeCharacter =
    requestEnvelope &&
    requestEnvelope.authoritative_context &&
    requestEnvelope.authoritative_context.active_character
      ? Number(
          requestEnvelope.authoritative_context.active_character.sequential || 0,
        )
      : 0;
  return activeCharacter > 0 ? activeCharacter : 0;
}

function currentTimestamp() {
  return timestampFromMs(Date.now());
}

function timestampFromMs(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return {
      seconds: 0,
      nanos: 0,
    };
  }
  const wholeMilliseconds = Math.trunc(numericValue);
  return {
    seconds: Math.floor(wholeMilliseconds / 1000),
    nanos: (wholeMilliseconds % 1000) * 1000000,
  };
}

function timestampToMs(value) {
  if (!value || typeof value !== "object") {
    return 0;
  }
  const seconds = Number(value.seconds || 0);
  const nanos = Number(value.nanos || 0);
  if (!Number.isFinite(seconds) && !Number.isFinite(nanos)) {
    return 0;
  }
  return Math.trunc(seconds * 1000 + nanos / 1000000);
}

function durationToMs(value) {
  if (!value || typeof value !== "object") {
    return 0;
  }
  const seconds = Number(value.seconds || 0);
  const nanos = Number(value.nanos || 0);
  if (!Number.isFinite(seconds) && !Number.isFinite(nanos)) {
    return 0;
  }
  return Math.max(0, Math.trunc(seconds * 1000 + nanos / 1000000));
}

function durationFromMs(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return {
      seconds: 0,
      nanos: 0,
    };
  }
  const wholeMilliseconds = Math.trunc(numericValue);
  return {
    seconds: Math.floor(wholeMilliseconds / 1000),
    nanos: (wholeMilliseconds % 1000) * 1000000,
  };
}

function encodePayload(messageType, payload) {
  return Buffer.from(messageType.encode(messageType.create(payload)).finish());
}

function uuidStringToBuffer(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/.test(normalized)) {
    return Buffer.alloc(16);
  }
  return Buffer.from(normalized, "hex");
}

function uuidBufferToString(value) {
  const buffer = bufferFromBytes(value);
  if (buffer.length !== 16) {
    return null;
  }
  const hex = buffer.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function createUuidString() {
  return crypto.randomUUID().toLowerCase();
}

function buildCurrency(value) {
  const amount = Number(value || 0);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const units = Math.trunc(safeAmount);
  const nanos = Math.round((safeAmount - units) * 1000000000);
  return {
    units,
    nanos,
  };
}

function currencyToNumber(value) {
  if (!value || typeof value !== "object") {
    return 0;
  }
  const units = Number(value.units || 0);
  const nanos = Number(value.nanos || 0);
  if (!Number.isFinite(units) && !Number.isFinite(nanos)) {
    return 0;
  }
  return units + nanos / 1000000000;
}

function normalizePageRequest(page, defaultSize = 25) {
  const rawSize = Number(page && page.size ? page.size : defaultSize);
  const size = Math.max(1, Math.min(100, Number.isFinite(rawSize) ? Math.trunc(rawSize) : defaultSize));
  const token = String(page && page.token ? page.token : "").trim();
  const offset = /^\d+$/.test(token) ? Number(token) : 0;
  return {
    size,
    offset,
    token,
  };
}

function sliceWithPage(items, page) {
  const normalizedPage = normalizePageRequest(page);
  const slicedItems = items.slice(
    normalizedPage.offset,
    normalizedPage.offset + normalizedPage.size,
  );
  const nextOffset = normalizedPage.offset + normalizedPage.size;
  return {
    items: slicedItems,
    nextPage:
      nextOffset < items.length
        ? {
            token: String(nextOffset),
          }
        : null,
  };
}

function compareSemver(left, right) {
  const leftValue = left || {};
  const rightValue = right || {};
  for (const fieldName of ["major", "minor", "patch"]) {
    const delta =
      Number(leftValue[fieldName] || 0) - Number(rightValue[fieldName] || 0);
    if (delta !== 0) {
      return delta;
    }
  }
  const leftPre = Array.isArray(leftValue.prerelease_tags)
    ? leftValue.prerelease_tags
    : [];
  const rightPre = Array.isArray(rightValue.prerelease_tags)
    ? rightValue.prerelease_tags
    : [];
  return leftPre.join(".").localeCompare(rightPre.join("."));
}

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  bufferFromBytes,
  buildCurrency,
  cloneValue,
  compareSemver,
  createUuidString,
  currencyToNumber,
  currentTimestamp,
  durationFromMs,
  durationToMs,
  encodePayload,
  getActiveCharacterID,
  normalizePageRequest,
  sliceWithPage,
  timestampFromMs,
  timestampToMs,
  uuidBufferToString,
  uuidStringToBuffer,
};
