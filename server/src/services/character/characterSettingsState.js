const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));

function toCharacterID(value) {
  const numeric = Number(value) || 0;
  return numeric > 0 ? Math.trunc(numeric) : 0;
}

function normalizeSettingKey(settingKey) {
  return String(settingKey || "").trim();
}

function getSettingsPath(characterID) {
  return `/${toCharacterID(characterID)}/characterSettings`;
}

function getSettingPath(characterID, settingKey) {
  return `${getSettingsPath(characterID)}/${normalizeSettingKey(settingKey)}`;
}

function isSerializedBuffer(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.type === "Buffer" &&
    Array.isArray(value.data),
  );
}

function decodeBufferLike(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (isSerializedBuffer(value)) {
    return Buffer.from(value.data).toString("utf8");
  }

  return value;
}

function normalizeCharacterSettingValue(value) {
  return decodeBufferLike(value);
}

function normalizeSettingsRecord(settings) {
  const source = settings && typeof settings === "object" ? settings : {};
  const normalized = {};
  let mutated = false;

  for (const [settingKey, settingValue] of Object.entries(source)) {
    const normalizedValue = normalizeCharacterSettingValue(settingValue);
    normalized[settingKey] = normalizedValue;
    if (
      Buffer.isBuffer(settingValue) ||
      isSerializedBuffer(settingValue) ||
      normalizedValue !== settingValue
    ) {
      mutated = true;
    }
  }

  return {
    normalized,
    mutated,
  };
}

function cloneSettings(settings) {
  return { ...(settings && typeof settings === "object" ? settings : {}) };
}

function getCharacterSettings(characterID) {
  const numericCharacterID = toCharacterID(characterID);
  if (!numericCharacterID) {
    return {};
  }

  const readResult = database.read("characters", getSettingsPath(numericCharacterID));
  if (!readResult.success || !readResult.data || typeof readResult.data !== "object") {
    return {};
  }

  const { normalized, mutated } = normalizeSettingsRecord(readResult.data);
  if (mutated) {
    database.write("characters", getSettingsPath(numericCharacterID), normalized);
  }

  return cloneSettings(normalized);
}

function getCharacterSetting(characterID, settingKey, fallback = null) {
  const normalizedKey = normalizeSettingKey(settingKey);
  if (!normalizedKey) {
    return fallback;
  }

  const settings = getCharacterSettings(characterID);
  return Object.prototype.hasOwnProperty.call(settings, normalizedKey)
    ? settings[normalizedKey]
    : fallback;
}

function setCharacterSetting(characterID, settingKey, value) {
  const numericCharacterID = toCharacterID(characterID);
  const normalizedKey = normalizeSettingKey(settingKey);
  if (!numericCharacterID || !normalizedKey) {
    return false;
  }

  const normalizedValue = normalizeCharacterSettingValue(value);

  const writeResult = database.write(
    "characters",
    getSettingPath(numericCharacterID, normalizedKey),
    normalizedValue,
  );
  return Boolean(writeResult && writeResult.success);
}

function deleteCharacterSetting(characterID, settingKey) {
  const numericCharacterID = toCharacterID(characterID);
  const normalizedKey = normalizeSettingKey(settingKey);
  if (!numericCharacterID || !normalizedKey) {
    return false;
  }

  const removeResult = database.remove(
    "characters",
    getSettingPath(numericCharacterID, normalizedKey),
  );
  return Boolean(
    removeResult &&
    (removeResult.success || removeResult.errorMsg === "ENTRY_NOT_FOUND"),
  );
}

module.exports = {
  getCharacterSettings,
  getCharacterSetting,
  setCharacterSetting,
  deleteCharacterSetting,
  normalizeCharacterSettingValue,
};
