function cloneJsonSafe(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (Array.isArray(value)) {
    return value.map((entry) => cloneJsonSafe(entry));
  }

  if (typeof value === "object") {
    const cloned = {};
    for (const [key, entryValue] of Object.entries(value)) {
      cloned[key] = cloneJsonSafe(entryValue);
    }
    return cloned;
  }

  return String(value);
}

function normalizeSculptingRowHeader(header = []) {
  const normalized = [...header];
  while (normalized.length < 5) {
    normalized.push(0);
  }

  for (let index = 2; index <= 4; index += 1) {
    if (normalized[index] === null || normalized[index] === undefined) {
      normalized[index] = 0;
    }
  }

  return normalized;
}

function normalizePaperDollPayload(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizePaperDollPayload(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (
    Object.prototype.hasOwnProperty.call(value, "sculptLocationID") &&
    (
      Object.prototype.hasOwnProperty.call(value, "weightUpDown") ||
      Object.prototype.hasOwnProperty.call(value, "weightLeftRight") ||
      Object.prototype.hasOwnProperty.call(value, "weightForwardBack")
    )
  ) {
    return {
      ...value,
      weightUpDown: value.weightUpDown ?? 0,
      weightLeftRight: value.weightLeftRight ?? 0,
      weightForwardBack: value.weightForwardBack ?? 0,
    };
  }

  if (
    value.type === "objectex2" &&
    Array.isArray(value.header) &&
    value.header.length > 0 &&
    Array.isArray(value.header[0]) &&
    value.header[0].length > 0 &&
    value.header[0][0] &&
    typeof value.header[0][0] === "object" &&
    String(value.header[0][0].value || "").endsWith(".SculptingRow")
  ) {
    return {
      ...value,
      header: [
        normalizeSculptingRowHeader(value.header[0]),
        ...value.header.slice(1).map((entry) => normalizePaperDollPayload(entry)),
      ],
      list: normalizePaperDollPayload(value.list || []),
      dict: normalizePaperDollPayload(value.dict || []),
    };
  }

  const normalized = {};
  for (const [key, entryValue] of Object.entries(value)) {
    normalized[key] = normalizePaperDollPayload(entryValue);
  }
  return normalized;
}

function clonePaperDollPayload(value) {
  return normalizePaperDollPayload(cloneJsonSafe(value));
}

function getStoredAppearanceInfo(record = {}) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const appearanceInfo =
    record.appearanceInfo ??
    record.charInfo ??
    record.paperDollData ??
    null;

  return clonePaperDollPayload(appearanceInfo);
}

function getStoredPortraitInfo(record = {}) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const portraitInfo =
    record.portraitInfo ??
    record.paperDollPortraitInfo ??
    null;

  return clonePaperDollPayload(portraitInfo);
}

function hasStoredAppearanceInfo(record = {}) {
  if (!record || typeof record !== "object") {
    return false;
  }

  return (
    record.appearanceInfo !== undefined &&
    record.appearanceInfo !== null
  ) || (
    record.charInfo !== undefined &&
    record.charInfo !== null
  ) || (
    record.paperDollData !== undefined &&
    record.paperDollData !== null
  );
}

function resolvePaperDollState(record = {}, fallback = 0) {
  const numericState = Number(record && record.paperDollState);
  if (Number.isInteger(numericState) && numericState >= 0 && numericState <= 4) {
    return numericState;
  }

  return hasStoredAppearanceInfo(record) ? 0 : fallback;
}

module.exports = {
  clonePaperDollPayload,
  getStoredAppearanceInfo,
  getStoredPortraitInfo,
  hasStoredAppearanceInfo,
  normalizePaperDollPayload,
  resolvePaperDollState,
};
