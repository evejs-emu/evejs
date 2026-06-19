const path = require("path");

const {
  DEFAULT_CHARACTER_PORTRAIT_PATH,
  findCharacterPortraitPath,
} = require("../../services/character/portraitImageStore");
const {
  DEFAULT_FACTION_LOGO_PATH,
  findFactionLogoPath,
} = require("../../services/faction/factionImageStore");
const {
  getFactionIDForCorporation,
  getFactionRecord,
} = require("../../services/faction/factionState");

const IMAGE_ROOT = __dirname;
const DEFAULT_CORPORATION_LOGO_PATH = path.join(
  IMAGE_ROOT,
  "images",
  "evejscorp.png",
);
const DEFAULT_ALLIANCE_LOGO_PATH = path.join(
  IMAGE_ROOT,
  "images",
  "alliance-default.png",
);
const DEFAULT_PNG_PATH = path.join(IMAGE_ROOT, "images", "hi.png");
const DEFAULT_JPG_PATH = path.join(IMAGE_ROOT, "images", "hi.jpg");

function toNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function buildRequestUrl(requestUrl) {
  return new URL(String(requestUrl || "/"), "http://127.0.0.1");
}

function getExtensionContentType(extension) {
  const normalized = String(extension || "").trim().toLowerCase();
  if (normalized === "jpg" || normalized === "jpeg") {
    return "image/jpeg";
  }
  return "image/png";
}

function getDefaultImagePath(extension) {
  const normalized = String(extension || "").trim().toLowerCase();
  if (normalized === "jpg" || normalized === "jpeg") {
    return DEFAULT_JPG_PATH;
  }
  return DEFAULT_PNG_PATH;
}

function getContentTypeForFilePath(filePath, fallbackExtension = "") {
  const fileExtension =
    path.extname(String(filePath || "")).replace(/^\./, "") || fallbackExtension;
  return getExtensionContentType(fileExtension);
}

function resolveCharacterImagePath(characterID, size, extension) {
  const localPath = findCharacterPortraitPath(characterID, size);
  if (localPath) {
    return localPath;
  }

  return String(extension || "").toLowerCase() === "png"
    ? DEFAULT_PNG_PATH
    : DEFAULT_CHARACTER_PORTRAIT_PATH;
}

function resolveCorporationLogoPath(corporationID, size) {
  const directFactionRecord = getFactionRecord(corporationID);
  if (directFactionRecord) {
    return findFactionLogoPath(directFactionRecord.factionID, size) || DEFAULT_FACTION_LOGO_PATH;
  }

  const factionID = getFactionIDForCorporation(corporationID);
  if (factionID) {
    return findFactionLogoPath(factionID, size) || DEFAULT_FACTION_LOGO_PATH;
  }
  return DEFAULT_CORPORATION_LOGO_PATH;
}

function resolveAllianceLogoPath() {
  return DEFAULT_ALLIANCE_LOGO_PATH;
}

function resolveFactionLogoPath(factionID, size) {
  return findFactionLogoPath(factionID, size) || DEFAULT_FACTION_LOGO_PATH;
}

function resolveLegacyImagePath(pathname) {
  const match = String(pathname || "").match(
    /^\/(Character|Corporation|Alliance|Faction)\/(\d+)(?:_(\d+))?\.(png|jpg|jpeg)$/i,
  );
  if (!match) {
    return null;
  }

  const kind = String(match[1] || "").toLowerCase();
  const entityID = toNumber(match[2], 0);
  const size = toNumber(match[3], null);
  const extension = String(match[4] || "png").toLowerCase();

  if (kind === "character") {
    const filePath = resolveCharacterImagePath(entityID, size, extension);
    return {
      filePath,
      contentType: getContentTypeForFilePath(filePath, extension),
    };
  }

  if (kind === "corporation") {
    return {
      filePath: resolveCorporationLogoPath(entityID, size),
      contentType: "image/png",
    };
  }

  if (kind === "alliance") {
    return {
      filePath: resolveAllianceLogoPath(entityID, size),
      contentType: "image/png",
    };
  }

  if (kind === "faction") {
    return {
      filePath: resolveFactionLogoPath(entityID, size),
      contentType: "image/png",
    };
  }

  return null;
}

function resolveRestImagePath(url) {
  const match = String(url.pathname || "").match(
    /^\/(characters|corporations|alliances|factions)\/(\d+)\/(portrait|logo)$/i,
  );
  if (!match) {
    return null;
  }

  const resourceKind = String(match[1] || "").toLowerCase();
  const entityID = toNumber(match[2], 0);
  const requestedAsset = String(match[3] || "").toLowerCase();
  const size = toNumber(url.searchParams.get("size"), null);
  const extension = String(url.searchParams.get("ext") || "png").toLowerCase();

  if (resourceKind === "characters" && requestedAsset === "portrait") {
    const filePath = resolveCharacterImagePath(entityID, size, extension);
    return {
      filePath,
      contentType: getContentTypeForFilePath(filePath, extension),
    };
  }

  if (requestedAsset !== "logo") {
    return null;
  }

  if (resourceKind === "corporations") {
    return {
      filePath: resolveCorporationLogoPath(entityID, size),
      contentType: "image/png",
    };
  }

  if (resourceKind === "alliances") {
    return {
      filePath: resolveAllianceLogoPath(entityID, size),
      contentType: "image/png",
    };
  }

  if (resourceKind === "factions") {
    return {
      filePath: resolveFactionLogoPath(entityID, size),
      contentType: "image/png",
    };
  }

  return null;
}

function resolveImageRequest(requestUrl) {
  const url = buildRequestUrl(requestUrl);

  const legacyResult = resolveLegacyImagePath(url.pathname);
  if (legacyResult) {
    return legacyResult;
  }

  const restResult = resolveRestImagePath(url);
  if (restResult) {
    return restResult;
  }

  const fallbackExtension = path.extname(url.pathname || "").replace(/^\./, "");
  return {
    filePath: getDefaultImagePath(fallbackExtension),
    contentType: getExtensionContentType(fallbackExtension),
  };
}

module.exports = {
  resolveImageRequest,
};
