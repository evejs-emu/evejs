const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildRow,
  buildKeyVal,
  extractList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const { getCharacterRecord } = require(path.join(
  __dirname,
  "../character/characterState",
));
const {
  getCorporationPublicInfo,
} = require(path.join(__dirname, "./corporationState"));
const {
  getCorporationDivisionNames,
  getCorporationRuntime,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  buildAggressionSettingsPayload,
  readAggressionSettings,
} = require(path.join(__dirname, "./aggressionSettingsState"));
const {
  buildAssetItemRowset,
  buildLocationList,
  listAssetItemsForLocation,
  listAssetLocations,
  searchAssetLocations,
} = require(path.join(__dirname, "./corpAssetState"));
const {
  getCorporationWarPermitStatus,
} = require(path.join(__dirname, "./warPermitState"));
const CORPORATION_ROW_HEADER = [
  "corporationID",
  "corporationName",
  "ticker",
  "tickerName",
  "ceoID",
  "creatorID",
  "allianceID",
  "factionID",
  "warFactionID",
  "membership",
  "description",
  "url",
  "stationID",
  "deleted",
  "taxRate",
  "loyaltyPointTaxRate",
  "friendlyFire",
  "memberCount",
  "shares",
  "allowWar",
  "applicationsEnabled",
  "division1",
  "division2",
  "division3",
  "division4",
  "division5",
  "division6",
  "division7",
  "walletDivision1",
  "walletDivision2",
  "walletDivision3",
  "walletDivision4",
  "walletDivision5",
  "walletDivision6",
  "walletDivision7",
  "shape1",
  "shape2",
  "shape3",
  "color1",
  "color2",
  "color3",
  "typeface",
  "isRecruiting",
];

function resolveCorporationInfo(corpID, session) {
  const numericCorpID = Number(corpID) || 0;
  const characterID =
    session && (session.characterID || session.charid) ? Number(session.characterID || session.charid) : 0;
  const charData = characterID ? getCharacterRecord(characterID) || {} : {};
  const publicInfo = getCorporationPublicInfo(numericCorpID);
  if (publicInfo) {
    return publicInfo;
  }
  return {
    corporationID: numericCorpID,
    corporationName:
      `Corporation ${numericCorpID}`,
    ticker: "CORP",
    tickerName: "CORP",
    ceoID: numericCorpID === Number(charData.corporationID || 0) ? characterID || null : null,
    creatorID: numericCorpID === Number(charData.corporationID || 0) ? characterID || null : null,
    allianceID:
      numericCorpID === Number(charData.corporationID || 0)
        ? charData.allianceID || (session ? session.allianceID || session.allianceid : null)
        : null,
    description: "",
    stationID: null,
    shares: 1000,
    deleted: 0,
    url: "",
    taxRate: 0.0,
    loyaltyPointTaxRate: 0.0,
    friendlyFire: 0,
    allowWar: getCorporationWarPermitStatus(numericCorpID),
    memberCount: 1,
  };
}

function buildCorporationRowPayload(info) {
  const corporationID = Number(info && info.corporationID) || 0;
  const runtime = getCorporationRuntime(corporationID) || {};
  const divisionNames = getCorporationDivisionNames(corporationID);
  return buildRow(CORPORATION_ROW_HEADER, [
    corporationID,
    info.corporationName || `Corporation ${corporationID}`,
    info.ticker || "CORP",
    info.tickerName || info.ticker || "CORP",
    info.ceoID ?? null,
    info.creatorID ?? null,
    info.allianceID ?? null,
    info.factionID ?? null,
    info.warFactionID ?? null,
    1,
    info.description || "",
    info.url || "",
    info.stationID ?? null,
    Number(info.deleted || 0),
    Number(info.taxRate || 0),
    Number(info.loyaltyPointTaxRate || 0),
    Number(info.friendlyFire || 0),
    Number(info.memberCount || 0),
    Number(info.shares || 0),
    info.allowWar ?? getCorporationWarPermitStatus(corporationID),
    Number(runtime.applicationsEnabled || 0),
    divisionNames[1],
    divisionNames[2],
    divisionNames[3],
    divisionNames[4],
    divisionNames[5],
    divisionNames[6],
    divisionNames[7],
    divisionNames[8],
    divisionNames[9],
    divisionNames[10],
    divisionNames[11],
    divisionNames[12],
    divisionNames[13],
    divisionNames[14],
    info.shape1 ?? null,
    info.shape2 ?? null,
    info.shape3 ?? null,
    info.color1 ?? null,
    info.color2 ?? null,
    info.color3 ?? null,
    info.typeface ?? null,
    Number(runtime.applicationsEnabled === 0 ? 0 : 1),
  ]);
}

class CorpMgrService extends BaseService {
  constructor() {
    super("corpmgr");
  }

  Handle_GetPublicInfo(args, session) {
    const corpID = args && args.length > 0 ? args[0] : 0;
    const info = resolveCorporationInfo(corpID, session);
    const runtime = getCorporationRuntime(info.corporationID) || {};
    log.debug(`[CorpMgr] GetPublicInfo(${info.corporationID})`);
    return buildKeyVal([
      ["corporationID", info.corporationID],
      ["corporationName", info.corporationName],
      ["ticker", info.ticker],
      ["tickerName", info.tickerName || info.ticker],
      ["ceoID", info.ceoID],
      ["creatorID", info.creatorID],
      ["allianceID", info.allianceID],
      ["warFactionID", info.warFactionID ?? info.factionID ?? null],
      ["description", info.description],
      ["stationID", info.stationID],
      ["shares", info.shares],
      ["deleted", info.deleted],
      ["url", info.url],
      ["taxRate", info.taxRate],
      ["loyaltyPointTaxRate", info.loyaltyPointTaxRate || 0.0],
      ["friendlyFire", info.friendlyFire || 0],
      ["allowWar", info.allowWar ?? getCorporationWarPermitStatus(info.corporationID)],
      ["memberCount", info.memberCount],
      ["applicationsEnabled", Number(runtime.applicationsEnabled || 0)],
      ["isRecruiting", Number(runtime.applicationsEnabled === 0 ? 0 : 1)],
      ["shape1", info.shape1 ?? null],
      ["shape2", info.shape2 ?? null],
      ["shape3", info.shape3 ?? null],
      ["color1", info.color1 ?? null],
      ["color2", info.color2 ?? null],
      ["color3", info.color3 ?? null],
      ["typeface", info.typeface ?? null],
    ]);
  }

  Handle_GetCorporationIDForCharacter(args, session) {
    const charID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const charData = charID ? getCharacterRecord(charID) || {} : {};
    return charData.corporationID || (session ? session.corporationID || session.corpid : 1000044);
  }

  Handle_GetCorporations(args, session) {
    const corpID = args && args.length > 0 ? args[0] : 0;
    const info = resolveCorporationInfo(corpID, session);
    return info ? buildCorporationRowPayload(info) : null;
  }

  Handle_GetAggressionSettings(args) {
    const corporationID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const info = getCorporationPublicInfo(corporationID) || {};
    return buildAggressionSettingsPayload(
      readAggressionSettings(corporationID, {
        isNpcCorporation: Boolean(info.isNPC),
      }),
      {
        isNpcCorporation: Boolean(info.isNPC),
      },
    );
  }

  Handle_GetAggressionSettingsForCorps(args) {
    const corporationIDs = extractList(args && args[0]);
    return buildDict(
      corporationIDs.map((corporationID) => [
        corporationID,
        this.Handle_GetAggressionSettings([corporationID]),
      ]),
    );
  }

  Handle_GetAssetInventory(args) {
    const corporationID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const which = args && args.length > 1 ? String(args[1] || "") : "offices";
    return buildLocationList(listAssetLocations(corporationID, which));
  }

  Handle_GetAssetInventoryForLocation(args) {
    const corporationID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const locationID = args && args.length > 1 ? Number(args[1]) || 0 : 0;
    const which = args && args.length > 2 ? String(args[2] || "") : "offices";
    return buildAssetItemRowset(
      listAssetItemsForLocation(corporationID, locationID, which),
    );
  }

  Handle_SearchAssets(args, session) {
    const corporationID = session ? session.corporationID || session.corpid || 0 : 0;
    const which = args && args.length > 0 ? String(args[0] || "") : "offices";
    const categoryID = args && args.length > 1 ? Number(args[1]) || 0 : 0;
    const groupID = args && args.length > 2 ? Number(args[2]) || 0 : 0;
    const typeID = args && args.length > 3 ? Number(args[3]) || 0 : 0;
    const minimumQuantity = args && args.length > 4 ? Number(args[4]) || 0 : 0;
    return buildLocationList(
      searchAssetLocations(corporationID, which, {
        categoryID,
        groupID,
        typeID,
        minimumQuantity,
      }),
    );
  }
}

module.exports = CorpMgrService;
