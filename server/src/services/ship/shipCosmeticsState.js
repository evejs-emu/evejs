const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { findShipItemById } = require(path.join(
  __dirname,
  "../inventory/itemStore",
));

const CATALOG_TABLE = "shipCosmeticsCatalog";
const RUNTIME_TABLE = "shipCosmetics";
const HUNDRED_NS_PER_MS = 10000n;
const FILETIME_EPOCH_OFFSET = 116444736000000000n;
let cachedCatalog = null;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readRoot(tableName) {
  const result = database.read(tableName, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  return result.data;
}

function ensureRuntimeRoot() {
  const current = readRoot(RUNTIME_TABLE);
  const next = {
    meta:
      current.meta && typeof current.meta === "object"
        ? current.meta
        : {
            description:
              "Runtime ship cosmetic ownership and applied-skin state.",
            createdBy: "Codex",
            createdAt: "2026-03-11",
          },
    characters:
      current.characters && typeof current.characters === "object"
        ? current.characters
        : {},
    ships:
      current.ships && typeof current.ships === "object" ? current.ships : {},
  };

  if (
    current.meta !== next.meta ||
    current.characters !== next.characters ||
    current.ships !== next.ships
  ) {
    database.write(RUNTIME_TABLE, "/", next);
  }

  return next;
}

function writeRuntimeRoot(runtimeRoot) {
  const nextRoot = {
    ...runtimeRoot,
    meta:
      runtimeRoot.meta && typeof runtimeRoot.meta === "object"
        ? runtimeRoot.meta
        : {
            description:
              "Runtime ship cosmetic ownership and applied-skin state.",
            createdBy: "Codex",
            createdAt: "2026-03-11",
          },
  };

  const writeResult = database.write(RUNTIME_TABLE, "/", nextRoot);
  return Boolean(writeResult.success);
}

function currentFileTimeString(nowMs = Date.now()) {
  return (BigInt(nowMs) * HUNDRED_NS_PER_MS + FILETIME_EPOCH_OFFSET).toString();
}

function futureFileTimeString(days = 0) {
  const numericDays = Number(days) || 0;
  const nowMs = Date.now();
  return currentFileTimeString(nowMs + numericDays * 24 * 60 * 60 * 1000);
}

function readCatalog() {
  if (cachedCatalog) {
    return cachedCatalog;
  }

  const root = readRoot(CATALOG_TABLE);
  cachedCatalog = {
    meta: root.meta || {},
    counts: root.counts || {},
    skinsBySkinID:
      root.skinsBySkinID && typeof root.skinsBySkinID === "object"
        ? root.skinsBySkinID
        : {},
    shipTypesByTypeID:
      root.shipTypesByTypeID && typeof root.shipTypesByTypeID === "object"
        ? root.shipTypesByTypeID
        : {},
    materialsByMaterialID:
      root.materialsByMaterialID && typeof root.materialsByMaterialID === "object"
        ? root.materialsByMaterialID
        : {},
    licenseTypesByTypeID:
      root.licenseTypesByTypeID && typeof root.licenseTypesByTypeID === "object"
        ? root.licenseTypesByTypeID
        : {},
  };

  return cachedCatalog;
}

function getSkinCatalogEntry(skinID, catalog = readCatalog()) {
  const numericSkinID = Number(skinID || 0);
  if (!numericSkinID) {
    return null;
  }

  return catalog.skinsBySkinID[String(numericSkinID)] || null;
}

function getSkinMaterialSetIDForSkin(skinID, catalog = readCatalog()) {
  const skinEntry = getSkinCatalogEntry(skinID, catalog);
  if (!skinEntry) {
    return null;
  }

  const directMaterialSetID =
    Number(
      (skinEntry.material && skinEntry.material.materialSetID) ||
        skinEntry.materialSetID ||
        0,
    ) || null;
  if (directMaterialSetID) {
    return directMaterialSetID;
  }

  const skinMaterialID = Number(skinEntry.skinMaterialID || 0) || 0;
  if (!skinMaterialID) {
    return null;
  }

  const materialEntry =
    catalog.materialsByMaterialID[String(skinMaterialID)] || null;
  return Number(materialEntry && materialEntry.materialSetID) || null;
}

function getShipTypeCatalogEntry(typeID, catalog = readCatalog()) {
  const numericTypeID = Number(typeID || 0);
  if (!numericTypeID) {
    return null;
  }

  return catalog.shipTypesByTypeID[String(numericTypeID)] || null;
}

function pickDefaultLicenseTypeID(skinEntry) {
  if (!skinEntry || !Array.isArray(skinEntry.licenseTypes)) {
    return null;
  }

  const permanent = skinEntry.licenseTypes.find(
    (entry) => Number(entry.duration) === -1,
  );
  if (permanent) {
    return Number(permanent.licenseTypeID || 0) || null;
  }

  const firstLicense = skinEntry.licenseTypes[0];
  return firstLicense ? Number(firstLicense.licenseTypeID || 0) || null : null;
}

function getCharacterRuntimeEntry(runtimeRoot, charId) {
  const key = String(Number(charId || 0) || 0);
  if (!runtimeRoot.characters[key] || typeof runtimeRoot.characters[key] !== "object") {
    runtimeRoot.characters[key] = {
      skinOverridesBySkinID: {},
    };
  }

  if (
    !runtimeRoot.characters[key].skinOverridesBySkinID ||
    typeof runtimeRoot.characters[key].skinOverridesBySkinID !== "object"
  ) {
    runtimeRoot.characters[key].skinOverridesBySkinID = {};
  }

  return runtimeRoot.characters[key];
}

function getCharacterSkinOverride(charId, skinID, runtimeRoot = ensureRuntimeRoot()) {
  const characterEntry = getCharacterRuntimeEntry(runtimeRoot, charId);
  return characterEntry.skinOverridesBySkinID[String(Number(skinID || 0) || 0)] || null;
}

function setCharacterSkinOverride(charId, skinID, override) {
  const numericCharID = Number(charId || 0) || 0;
  const numericSkinID = Number(skinID || 0) || 0;
  if (!numericCharID || !numericSkinID) {
    return false;
  }

  const runtimeRoot = ensureRuntimeRoot();
  const characterEntry = getCharacterRuntimeEntry(runtimeRoot, numericCharID);
  characterEntry.skinOverridesBySkinID[String(numericSkinID)] = {
    skinID: numericSkinID,
    expiresAtFileTime: override.expiresAtFileTime || null,
    isSingleUse: Boolean(override.isSingleUse),
    revoked: Boolean(override.revoked),
    updatedAt: new Date().toISOString(),
    source: override.source || "manual",
  };
  return writeRuntimeRoot(runtimeRoot);
}

function getEffectiveLicenseRecord(
  charId,
  skinID,
  options = {},
) {
  const catalog = options.catalog || readCatalog();
  const runtimeRoot = options.runtimeRoot || ensureRuntimeRoot();
  const skinEntry = getSkinCatalogEntry(skinID, catalog);
  if (!skinEntry) {
    return null;
  }

  const override = getCharacterSkinOverride(charId, skinID, runtimeRoot);
  if (override && override.revoked) {
    return null;
  }

  return {
    skinID: Number(skinEntry.skinID || 0),
    skinMaterialID: Number(skinEntry.skinMaterialID || 0) || null,
    licenseTypeID: pickDefaultLicenseTypeID(skinEntry),
    expiresAtFileTime: override ? override.expiresAtFileTime || null : null,
    isSingleUse: override ? Boolean(override.isSingleUse) : false,
    shipTypeIDs: Array.isArray(skinEntry.shipTypeIDs) ? [...skinEntry.shipTypeIDs] : [],
    internalName: skinEntry.internalName || "",
  };
}

function getAllLicensedSkinRecords(charId) {
  const catalog = readCatalog();
  const runtimeRoot = ensureRuntimeRoot();
  return Object.keys(catalog.skinsBySkinID)
    .map((skinID) =>
      getEffectiveLicenseRecord(charId, Number(skinID), { catalog, runtimeRoot }),
    )
    .filter(Boolean);
}

function getLicensedSkinRecordsForType(charId, typeID) {
  const catalog = readCatalog();
  const runtimeRoot = ensureRuntimeRoot();
  const shipTypeEntry = getShipTypeCatalogEntry(typeID, catalog);
  if (!shipTypeEntry || !Array.isArray(shipTypeEntry.skinIDs)) {
    return [];
  }

  return shipTypeEntry.skinIDs
    .map((skinID) =>
      getEffectiveLicenseRecord(charId, skinID, { catalog, runtimeRoot }),
    )
    .filter(Boolean);
}

function giveSkin(charId, skinID, options = {}) {
  const skinEntry = getSkinCatalogEntry(skinID, readCatalog());
  if (!skinEntry) {
    return {
      success: false,
      errorMsg: "SKIN_NOT_FOUND",
    };
  }

  const expiresAtFileTime =
    options.durationDays && Number(options.durationDays) > 0
      ? futureFileTimeString(options.durationDays)
      : null;

  const success = setCharacterSkinOverride(charId, skinID, {
    expiresAtFileTime,
    isSingleUse: Boolean(options.isSingleUse),
    revoked: false,
    source: options.source || "GiveSkin",
  });

  return {
    success,
    errorMsg: success ? null : "WRITE_ERROR",
  };
}

function removeSkin(charId, skinID) {
  const skinEntry = getSkinCatalogEntry(skinID, readCatalog());
  if (!skinEntry) {
    return {
      success: false,
      errorMsg: "SKIN_NOT_FOUND",
    };
  }

  const success = setCharacterSkinOverride(charId, skinID, {
    expiresAtFileTime: null,
    isSingleUse: false,
    revoked: true,
    source: "RemoveSkin",
  });

  return {
    success,
    errorMsg: success ? null : "WRITE_ERROR",
  };
}

function expireSkin(charId, skinID) {
  const skinEntry = getSkinCatalogEntry(skinID, readCatalog());
  if (!skinEntry) {
    return {
      success: false,
      errorMsg: "SKIN_NOT_FOUND",
    };
  }

  const success = setCharacterSkinOverride(charId, skinID, {
    expiresAtFileTime: currentFileTimeString(Date.now() - 1000),
    isSingleUse: false,
    revoked: false,
    source: "GMExpireSkinLicense",
  });

  return {
    success,
    errorMsg: success ? null : "WRITE_ERROR",
  };
}

function applySkinToShip(shipID, skinID) {
  const numericShipID = Number(shipID || 0) || 0;
  if (!numericShipID) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const shipItem = findShipItemById(numericShipID);
  if (!shipItem) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const numericSkinID = skinID === null || skinID === undefined ? null : Number(skinID || 0);
  if (numericSkinID) {
    const skinEntry = getSkinCatalogEntry(numericSkinID, readCatalog());
    if (!skinEntry) {
      return {
        success: false,
        errorMsg: "SKIN_NOT_FOUND",
      };
    }

    const shipTypeIDs = Array.isArray(skinEntry.shipTypeIDs) ? skinEntry.shipTypeIDs : [];
    if (!shipTypeIDs.includes(Number(shipItem.typeID || 0))) {
      return {
        success: false,
        errorMsg: "SKIN_NOT_VALID_FOR_TYPE",
      };
    }
  }

  const runtimeRoot = ensureRuntimeRoot();
  runtimeRoot.ships[String(numericShipID)] = {
    shipID: numericShipID,
    ownerID: Number(shipItem.ownerID || 0) || null,
    typeID: Number(shipItem.typeID || 0) || null,
    skinID: numericSkinID,
    updatedAt: new Date().toISOString(),
  };

  const success = writeRuntimeRoot(runtimeRoot);
  if (!success) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  log.info(
    `[ShipCosmeticsState] Applied skin shipID=${numericShipID} typeID=${shipItem.typeID} skinID=${numericSkinID || 0}`,
  );

  return {
    success: true,
    data: cloneValue(runtimeRoot.ships[String(numericShipID)]),
  };
}

function getAppliedSkinRecord(shipID) {
  const runtimeRoot = ensureRuntimeRoot();
  const record = runtimeRoot.ships[String(Number(shipID || 0) || 0)];
  return record ? cloneValue(record) : null;
}

function getAppliedSkinMaterialSetID(shipID) {
  const appliedRecord = getAppliedSkinRecord(shipID);
  if (!appliedRecord) {
    return null;
  }

  return getSkinMaterialSetIDForSkin(appliedRecord.skinID);
}

function getAppliedSkinRecordsForOwner(ownerID) {
  const numericOwnerID = Number(ownerID || 0) || 0;
  if (!numericOwnerID) {
    return [];
  }

  const runtimeRoot = ensureRuntimeRoot();
  return Object.values(runtimeRoot.ships)
    .filter(
      (record) => Number(record && record.ownerID ? record.ownerID : 0) === numericOwnerID,
    )
    .map(cloneValue);
}

module.exports = {
  readCatalog,
  getSkinCatalogEntry,
  getSkinMaterialSetIDForSkin,
  getShipTypeCatalogEntry,
  getAllLicensedSkinRecords,
  getLicensedSkinRecordsForType,
  getEffectiveLicenseRecord,
  giveSkin,
  removeSkin,
  expireSkin,
  applySkinToShip,
  getAppliedSkinRecord,
  getAppliedSkinMaterialSetID,
  getAppliedSkinRecordsForOwner,
};
