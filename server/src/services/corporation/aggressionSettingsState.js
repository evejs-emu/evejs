const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  buildDict,
  buildFiletimeLong,
  currentFileTime,
  normalizeBigInt,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const CORPORATION_RUNTIME_TABLE = "corporationRuntime";
const FRIENDLY_FIRE_CHANGE_DELAY_FILETIME = 864000000000n;
const DEFAULT_ENABLED_FILETIME = "0";

function normalizeOptionalFiletimeString(value, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  try {
    return normalizeBigInt(value, 0n).toString();
  } catch (error) {
    return fallback;
  }
}

function buildDefaultAggressionSettings(isNpcCorporation = false) {
  if (isNpcCorporation) {
    return {
      enableAfter: null,
      disableAfter: DEFAULT_ENABLED_FILETIME,
    };
  }

  return {
    enableAfter: DEFAULT_ENABLED_FILETIME,
    disableAfter: null,
  };
}

function normalizeAggressionSettings(rawSettings = null, options = {}) {
  if (options.isNpcCorporation) {
    return buildDefaultAggressionSettings(true);
  }

  const defaults = buildDefaultAggressionSettings(Boolean(options.isNpcCorporation));
  const source =
    rawSettings && typeof rawSettings === "object" ? rawSettings : {};

  return {
    enableAfter:
      source.enableAfter === undefined
        ? defaults.enableAfter
        : normalizeOptionalFiletimeString(source.enableAfter, defaults.enableAfter),
    disableAfter:
      source.disableAfter === undefined
        ? defaults.disableAfter
        : normalizeOptionalFiletimeString(source.disableAfter, defaults.disableAfter),
  };
}

function readAggressionSettings(corporationID, options = {}) {
  const result = database.read(
    CORPORATION_RUNTIME_TABLE,
    `/corporations/${String(Number(corporationID) || 0)}/aggressionSettings`,
  );
  return normalizeAggressionSettings(
    result.success && result.data && typeof result.data === "object"
      ? result.data
      : null,
    options,
  );
}

function toOptionalBigInt(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  try {
    return normalizeBigInt(value, 0n);
  } catch (error) {
    return null;
  }
}

function isTimeInPast(value, now) {
  return value !== null && value < now;
}

function isTimeInFuture(value, now) {
  return value !== null && value >= now;
}

function resolveFriendlyFireLegalAtTime(rawSettings = null, options = {}) {
  const settings = normalizeAggressionSettings(rawSettings, options);
  const now = normalizeBigInt(options.nowFiletime, currentFileTime());
  const enableAfter = toOptionalBigInt(settings.enableAfter);
  const disableAfter = toOptionalBigInt(settings.disableAfter);
  const disablePast = isTimeInPast(disableAfter, now);
  const enablePast = isTimeInPast(enableAfter, now);

  if (disablePast && enablePast) {
    return disableAfter < enableAfter;
  }
  if (disablePast) {
    return false;
  }
  if (enablePast) {
    return true;
  }
  return true;
}

function hasPendingAggressionChangeAtTime(rawSettings = null, options = {}) {
  const settings = normalizeAggressionSettings(rawSettings, options);
  const now = normalizeBigInt(options.nowFiletime, currentFileTime());
  const enableAfter = toOptionalBigInt(settings.enableAfter);
  const disableAfter = toOptionalBigInt(settings.disableAfter);
  return isTimeInFuture(enableAfter, now) || isTimeInFuture(disableAfter, now);
}

function buildAggressionSettingsPayload(rawSettings = null, options = {}) {
  const settings = normalizeAggressionSettings(rawSettings, options);
  return {
    type: "object",
    name: "crimewatch.corp_aggression.settings.AggressionSettings",
    args: buildDict([
      [
        "_enableAfter",
        settings.enableAfter !== null
          ? buildFiletimeLong(settings.enableAfter)
          : null,
      ],
      [
        "_disableAfter",
        settings.disableAfter !== null
          ? buildFiletimeLong(settings.disableAfter)
          : null,
      ],
    ]),
  };
}

function scheduleAggressionSettingsChange(
  rawSettings = null,
  friendlyFireLegal,
  options = {},
) {
  const isNpcCorporation = Boolean(options.isNpcCorporation);
  const currentSettings = normalizeAggressionSettings(rawSettings, options);
  if (isNpcCorporation) {
    return currentSettings;
  }

  const now = normalizeBigInt(options.nowFiletime, currentFileTime());
  const desiredState = Boolean(friendlyFireLegal);
  if (
    resolveFriendlyFireLegalAtTime(currentSettings, { nowFiletime: now }) === desiredState &&
    !hasPendingAggressionChangeAtTime(currentSettings, { nowFiletime: now })
  ) {
    return currentSettings;
  }

  const dueTime = (now + FRIENDLY_FIRE_CHANGE_DELAY_FILETIME).toString();
  return desiredState
    ? {
        enableAfter: dueTime,
        disableAfter: DEFAULT_ENABLED_FILETIME,
      }
    : {
        enableAfter: DEFAULT_ENABLED_FILETIME,
        disableAfter: dueTime,
      };
}

module.exports = {
  buildAggressionSettingsPayload,
  hasPendingAggressionChangeAtTime,
  normalizeAggressionSettings,
  readAggressionSettings,
  resolveFriendlyFireLegalAtTime,
  scheduleAggressionSettingsChange,
};
