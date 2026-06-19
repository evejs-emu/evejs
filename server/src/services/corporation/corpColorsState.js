const path = require("path");

const {
  CORP_ROLE_BRAND_MANAGER,
  CORP_ROLE_DIRECTOR,
  getCorporationMember,
  getCorporationRuntime,
  normalizeInteger,
  normalizePositiveInteger,
  toRoleMaskBigInt,
  updateCorporationRuntime,
} = require(path.join(__dirname, "./corporationRuntimeState"));

function getCharacterRecord(characterID) {
  const characterState = require(path.join(
    __dirname,
    "../character/characterState",
  ));
  return characterState && typeof characterState.getCharacterRecord === "function"
    ? characterState.getCharacterRecord(characterID)
    : null;
}

function normalizeColorComponent(value, fallback = 0) {
  const numericValue = normalizeInteger(value, fallback);
  return Math.max(0, Math.min(255, numericValue));
}

function normalizeColor(value, required = false) {
  if (!value || typeof value !== "object") {
    return required ? null : null;
  }
  const hasAnyComponent =
    value.red !== undefined || value.green !== undefined || value.blue !== undefined;
  if (!hasAnyComponent) {
    return required ? null : null;
  }
  return {
    red: normalizeColorComponent(value.red, 0),
    green: normalizeColorComponent(value.green, 0),
    blue: normalizeColorComponent(value.blue, 0),
  };
}

function normalizePaletteAttributes(attributes = null) {
  if (!attributes || typeof attributes !== "object") {
    return null;
  }
  const mainColor = normalizeColor(attributes.mainColor || attributes.main_color, true);
  if (!mainColor) {
    return null;
  }
  return {
    mainColor,
    secondaryColor: normalizeColor(
      attributes.secondaryColor || attributes.secondary_color,
      false,
    ),
    tertiaryColor: normalizeColor(
      attributes.tertiaryColor || attributes.tertiary_color,
      false,
    ),
  };
}

function getCorporationColorPalette(corporationID) {
  const runtime = getCorporationRuntime(corporationID) || {};
  if (!runtime.corpColorPalette || typeof runtime.corpColorPalette !== "object") {
    return null;
  }
  return {
    ...runtime.corpColorPalette,
    mainColor: normalizeColor(runtime.corpColorPalette.mainColor, true),
    secondaryColor: normalizeColor(runtime.corpColorPalette.secondaryColor, false),
    tertiaryColor: normalizeColor(runtime.corpColorPalette.tertiaryColor, false),
    lastModifierCharacterID: normalizePositiveInteger(
      runtime.corpColorPalette.lastModifierCharacterID,
      null,
    ),
    lastModified: String(runtime.corpColorPalette.lastModified || "0"),
  };
}

function getCorporationIDForCharacter(characterID) {
  const characterRecord = getCharacterRecord(characterID) || {};
  return normalizePositiveInteger(characterRecord.corporationID, null);
}

function canCharacterEditCorporationColorPalette(characterID, corporationID = null) {
  const numericCharacterID = normalizePositiveInteger(characterID, null);
  const numericCorporationID =
    normalizePositiveInteger(corporationID, null) ||
    getCorporationIDForCharacter(numericCharacterID);
  if (!numericCharacterID || !numericCorporationID) {
    return false;
  }
  const member = getCorporationMember(numericCorporationID, numericCharacterID);
  if (!member) {
    return false;
  }
  if (member.isCEO) {
    return true;
  }
  const roles = toRoleMaskBigInt(member.roles, 0n);
  return (
    (roles & CORP_ROLE_DIRECTOR) === CORP_ROLE_DIRECTOR ||
    (roles & CORP_ROLE_BRAND_MANAGER) === CORP_ROLE_BRAND_MANAGER
  );
}

function setCorporationColorPalette(corporationID, attributes, characterID) {
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  const numericCharacterID = normalizePositiveInteger(characterID, null);
  const normalizedAttributes = normalizePaletteAttributes(attributes);
  if (!numericCorporationID || !numericCharacterID || !normalizedAttributes) {
    return {
      success: false,
      errorMsg: "INVALID_CORPORATION_COLOR_PALETTE",
    };
  }
  let storedPalette = null;
  updateCorporationRuntime(numericCorporationID, (runtime) => {
    storedPalette = {
      ...normalizedAttributes,
      lastModifierCharacterID: numericCharacterID,
      lastModified: String(Date.now() * 10000 + 116444736000000000),
    };
    runtime.corpColorPalette = storedPalette;
    return runtime;
  });
  return {
    success: true,
    data: storedPalette,
  };
}

module.exports = {
  canCharacterEditCorporationColorPalette,
  getCorporationColorPalette,
  getCorporationIDForCharacter,
  normalizePaletteAttributes,
  setCorporationColorPalette,
};
