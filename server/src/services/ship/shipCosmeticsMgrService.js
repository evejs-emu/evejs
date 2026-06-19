const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildKeyVal,
  buildList,
  buildFiletimeLong,
  extractDictEntries,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getAllLicensedSkinRecords,
  getLicensedSkinRecordsForType,
  getEffectiveLicenseRecord,
  giveSkin,
  removeSkin,
  expireSkin,
  applySkinToShip,
} = require(path.join(__dirname, "./shipCosmeticsState"));
const {
  getEnabledCosmeticsEntries,
} = require(path.join(__dirname, "./shipLogoFittingState"));
const {
  publishShipStateSetNotice,
} = require(path.join(__dirname, "../../_secondary/express/publicGatewayLocal"));

function buildLicensedSkinKeyVal(record) {
  return buildKeyVal([
    ["skinID", Number(record.skinID || 0) || 0],
    [
      "expires",
      record.expiresAtFileTime
        ? buildFiletimeLong(record.expiresAtFileTime)
        : null,
    ],
    ["isSingleUse", Boolean(record.isSingleUse)],
    ["licenseTypeID", Number(record.licenseTypeID || 0) || null],
    ["skinMaterialID", Number(record.skinMaterialID || 0) || null],
    ["materialID", Number(record.skinMaterialID || 0) || null],
  ]);
}

function getKwargValue(kwargs, key) {
  const entries = extractDictEntries(kwargs);
  const match = entries.find(([entryKey]) => String(entryKey) === String(key));
  return match ? match[1] : null;
}

class ShipCosmeticsMgrService extends BaseService {
  constructor() {
    super("shipCosmeticsMgr");
  }

  Handle_GetEnabledCosmetics(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    log.debug(`[ShipCosmeticsMgr] GetEnabledCosmetics(shipID=${shipID})`);
    return buildDict(
      getEnabledCosmeticsEntries(shipID).map((entry) => [
        entry.backendSlot,
        entry.cosmeticType,
      ]),
    );
  }

  Handle_GetLicencedSkins(args, session) {
    const charId = Number(session && session.characterID) || 0;
    const licensed = getAllLicensedSkinRecords(charId).map(buildLicensedSkinKeyVal);
    log.debug(
      `[ShipCosmeticsMgr] GetLicencedSkins(charID=${charId}) -> ${licensed.length}`,
    );
    return buildList(licensed);
  }

  Handle_GetLicensedSkins(args, session, kwargs) {
    return this.Handle_GetLicencedSkins(args, session, kwargs);
  }

  Handle_GetLicencedSkinsForShipType(args, session) {
    const charId =
      Number(args && args.length > 0 ? args[0] : session && session.characterID) || 0;
    const shipTypeID = Number(args && args.length > 1 ? args[1] : 0) || 0;
    const licensed = getLicensedSkinRecordsForType(charId, shipTypeID).map(
      buildLicensedSkinKeyVal,
    );
    log.debug(
      `[ShipCosmeticsMgr] GetLicencedSkinsForShipType(charID=${charId}, shipTypeID=${shipTypeID}) -> ${licensed.length}`,
    );
    return buildList(licensed);
  }

  Handle_GetFirstPartySkinData(args) {
    const licenseeID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    const skinID = Number(args && args.length > 1 ? args[1] : 0) || 0;
    const record = getEffectiveLicenseRecord(licenseeID, skinID);
    log.debug(
      `[ShipCosmeticsMgr] GetFirstPartySkinData(licenseeID=${licenseeID}, skinID=${skinID}) -> ${record ? "hit" : "miss"}`,
    );
    return record ? buildLicensedSkinKeyVal(record) : null;
  }

  Handle_ApplySkinToShip(args, session) {
    const shipID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    const skinID =
      args && args.length > 1 && args[1] !== undefined && args[1] !== null
        ? Number(args[1] || 0) || 0
        : null;
    const result = applySkinToShip(shipID, skinID);
    const activeCharacterID =
      Number(
        (session &&
          (session.characterID ||
            session.charid ||
            session.characterId ||
            session.charID)) ||
          0,
      ) || 0;

    if (result.success) {
      publishShipStateSetNotice(
        shipID,
        activeCharacterID ||
          Number(result.data && result.data.ownerID ? result.data.ownerID : 0) ||
          0,
      );
    }

    log.info(
      `[ShipCosmeticsMgr] ApplySkinToShip(shipID=${shipID}, skinID=${skinID || 0}) -> ${result.success ? "ok" : result.errorMsg}`,
    );
    return null;
  }

  Handle_GiveSkin(args, session, kwargs) {
    const skinID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    const durationDays = normalizeNumber(getKwargValue(kwargs, "duration"), 0);
    const isSingleUse = Boolean(getKwargValue(kwargs, "isSingleUse"));
    const charId = Number(session && session.characterID) || 0;
    const result = giveSkin(charId, skinID, {
      durationDays,
      isSingleUse,
      source: "shipCosmeticsMgr.GiveSkin",
    });
    log.info(
      `[ShipCosmeticsMgr] GiveSkin(charID=${charId}, skinID=${skinID}, durationDays=${durationDays}, isSingleUse=${isSingleUse}) -> ${result.success ? "ok" : result.errorMsg}`,
    );
    return null;
  }

  Handle_RemoveSkin(args) {
    const skinID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    const licenseeID = Number(args && args.length > 1 ? args[1] : 0) || 0;
    const result = removeSkin(licenseeID, skinID);
    log.info(
      `[ShipCosmeticsMgr] RemoveSkin(licenseeID=${licenseeID}, skinID=${skinID}) -> ${result.success ? "ok" : result.errorMsg}`,
    );
    return null;
  }

  Handle_GMExpireSkinLicense(args, session) {
    const skinID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    const charId = Number(session && session.characterID) || 0;
    const result = expireSkin(charId, skinID);
    log.info(
      `[ShipCosmeticsMgr] GMExpireSkinLicense(charID=${charId}, skinID=${skinID}) -> ${result.success ? "ok" : result.errorMsg}`,
    );
    return null;
  }

  Handle_ActivateSkinLicense(args) {
    const itemCount = Array.isArray(args && args[0]) ? args[0].length : 0;
    log.info(
      `[ShipCosmeticsMgr] ActivateSkinLicense(itemCount=${itemCount}) -> unlock-all default no-op`,
    );
    return null;
  }
}

module.exports = ShipCosmeticsMgrService;
