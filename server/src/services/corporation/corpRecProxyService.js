const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildBoundObjectResponse,
  buildList,
  buildRow,
  currentFileTime,
  resolveBoundNodeId,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  ensureRuntimeInitialized,
  getCorporationRuntime,
  listCorporationMembers,
  normalizeInteger,
  normalizeText,
  updateCorporationRuntime,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  getCorporationRecord,
} = require(path.join(__dirname, "./corporationState"));
const {
  resolveFriendlyFireLegalAtTime,
} = require(path.join(__dirname, "./aggressionSettingsState"));
const {
  notifyCorporationRecruitmentAdChanged,
} = require(path.join(__dirname, "./corporationNotifications"));

const AD_HEADER = [
  "adID",
  "corporationID",
  "allianceID",
  "channelID",
  "typeMask",
  "langMask",
  "description",
  "title",
  "createDateTime",
  "expiryDateTime",
  "hourMask1",
  "minSP",
  "otherMask",
  "memberCount",
];

function resolveCorporationID(session) {
  return (session && (session.corporationID || session.corpid)) || 0;
}

function normalizeAdvertRecord(advert, corporationRecord) {
  const corporationID = Number(
    (advert && advert.corporationID) ||
      (corporationRecord && corporationRecord.corporationID) ||
      0,
  );
  return {
    ...(advert || {}),
    corporationID,
    allianceID:
      (corporationRecord && corporationRecord.allianceID) ||
      (advert && advert.allianceID) ||
      null,
    typeMask: normalizeInteger(advert && advert.typeMask, 0),
    langMask: normalizeInteger(advert && advert.langMask, 0),
    description: normalizeText(advert && advert.description, ""),
    title: normalizeText(advert && advert.title, ""),
    createDateTime: String(
      (advert && advert.createDateTime) || currentFileTime().toString(),
    ),
    expiryDateTime: String(
      (advert && advert.expiryDateTime) || currentFileTime().toString(),
    ),
    hourMask1: normalizeInteger(advert && advert.hourMask1, 0),
    minSP: normalizeInteger(advert && advert.minSP, 0),
    otherMask: normalizeInteger(advert && advert.otherMask, 0),
    recruiters: Array.isArray(advert && advert.recruiters)
      ? advert.recruiters
      : [],
    memberCount: listCorporationMembers(corporationID).length,
  };
}

function buildAdvertRow(advert, corporationRecord = null) {
  const normalized = normalizeAdvertRecord(advert, corporationRecord);
  return buildRow(AD_HEADER, [
    normalized.adID,
    normalized.corporationID,
    normalized.allianceID,
    normalized.channelID || 0,
    normalized.typeMask,
    normalized.langMask,
    normalized.description,
    normalized.title,
    { type: "long", value: BigInt(String(normalized.createDateTime || 0)) },
    { type: "long", value: BigInt(String(normalized.expiryDateTime || 0)) },
    normalized.hourMask1,
    normalized.minSP,
    normalized.otherMask,
    normalized.memberCount,
  ]);
}

function matchesSearchCriteria(
  advert,
  corporationRecord,
  filters = {},
  corporationRuntime = null,
) {
  const normalized = normalizeAdvertRecord(advert, corporationRecord);
  const nowFiletime = currentFileTime();
  if (BigInt(String(normalized.expiryDateTime || "0")) <= nowFiletime) {
    return false;
  }

  const typeMask = normalizeInteger(filters.typeMask, 0);
  if (typeMask > 0 && (normalized.typeMask & typeMask) === 0) {
    return false;
  }

  const langMask = normalizeInteger(filters.langMask, 0);
  if (langMask > 0 && (normalized.langMask & langMask) === 0) {
    return false;
  }

  if (filters.excludeAlliances && normalized.allianceID) {
    return false;
  }

  if (
    filters.excludeFriendlyFire &&
    resolveFriendlyFireLegalAtTime(
      corporationRuntime && corporationRuntime.aggressionSettings,
      {
        isNpcCorporation: Boolean(corporationRecord && corporationRecord.isNPC),
      },
    )
  ) {
    return false;
  }

  const spRestriction = Number(filters.spRestriction || 0);
  if (spRestriction > 0 && normalized.minSP > spRestriction) {
    return false;
  }

  const minMembers = Number(filters.minMembers || 0);
  if (minMembers > 0 && normalized.memberCount < minMembers) {
    return false;
  }

  const maxMembers = Number(filters.maxMembers || 0);
  if (maxMembers > 0 && normalized.memberCount > maxMembers) {
    return false;
  }

  const maxISKTaxRate = Number(filters.maxISKTaxRate);
  if (
    Number.isFinite(maxISKTaxRate) &&
    maxISKTaxRate >= 0 &&
    Number(corporationRecord && corporationRecord.taxRate) > maxISKTaxRate
  ) {
    return false;
  }

  const maxLPTaxRate = Number(filters.maxLPTaxRate);
  if (
    Number.isFinite(maxLPTaxRate) &&
    maxLPTaxRate >= 0 &&
    Number(corporationRecord && corporationRecord.loyaltyPointTaxRate) > maxLPTaxRate
  ) {
    return false;
  }

  const searchTimeMask = normalizeInteger(filters.searchTimeMask, 0);
  if (
    searchTimeMask > 0 &&
    normalized.hourMask1 > 0 &&
    (normalized.hourMask1 & searchTimeMask) === 0
  ) {
    return false;
  }

  const otherMask = normalizeInteger(filters.otherMask, 0);
  if (otherMask > 0 && (normalized.otherMask & otherMask) === 0) {
    return false;
  }

  return true;
}

class CorpRecruitmentProxyService extends BaseService {
  constructor() {
    super("corpRecProxy");
  }

  Handle_MachoResolveObject() {
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetRecruitmentAdsForCorporation(args, session) {
    const corporationID = resolveCorporationID(session);
    const runtime = getCorporationRuntime(corporationID) || {};
    const corporationRecord = getCorporationRecord(corporationID) || {};
    return buildList(
      Object.values(runtime.recruitmentAds || {}).map((advert) =>
        buildAdvertRow(advert, corporationRecord),
      ),
    );
  }

  Handle_GetRecruitmentAdsByCorpID(args) {
    const corporationID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const runtime = getCorporationRuntime(corporationID) || {};
    const corporationRecord = getCorporationRecord(corporationID) || {};
    return buildList(
      Object.values(runtime.recruitmentAds || {}).map((advert) =>
        buildAdvertRow(advert, corporationRecord),
      ),
    );
  }

  Handle_GetRecruiters(args, session) {
    const corporationID = resolveCorporationID(session);
    const runtime = getCorporationRuntime(corporationID) || {};
    const adID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const advert = runtime.recruitmentAds && runtime.recruitmentAds[String(adID)];
    return buildList(Array.isArray(advert && advert.recruiters) ? advert.recruiters : []);
  }

  Handle_GetRecruitmentAd(args) {
    const corporationID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const adID = args && args.length > 1 ? Number(args[1]) || 0 : 0;
    const runtime = getCorporationRuntime(corporationID) || {};
    const advert = runtime.recruitmentAds && runtime.recruitmentAds[String(adID)];
    return advert ? buildAdvertRow(advert, getCorporationRecord(corporationID) || {}) : null;
  }

  Handle_SearchCorpAds(args) {
    const filters = {
      typeMask: args && args[0],
      langMask: args && args[1],
      excludeAlliances: args && args[2],
      excludeFriendlyFire: args && args[3],
      spRestriction: args && args[4],
      minMembers: args && args[5],
      maxMembers: args && args[6],
      maxISKTaxRate: args && args[7],
      maxLPTaxRate: args && args[8],
      searchTimeMask: args && args[9],
      otherMask: args && args[10],
    };
    const runtimeTable = ensureRuntimeInitialized();
    const rows = [];
    for (const [corporationID, runtime] of Object.entries(runtimeTable.corporations || {})) {
      const corporationRecord = getCorporationRecord(corporationID) || {};
      for (const advert of Object.values(runtime.recruitmentAds || {})) {
        if (!matchesSearchCriteria(advert, corporationRecord, filters, runtime)) {
          continue;
        }
        rows.push(buildAdvertRow(advert, corporationRecord));
      }
    }
    return buildList(rows);
  }

  Handle_CreateRecruitmentAd(args, session) {
    const corporationID = resolveCorporationID(session);
    let adID = null;
    updateCorporationRuntime(corporationID, (runtime, corporationRecord, table) => {
      adID = table._meta.nextRecruitmentAdID++;
      runtime.recruitmentAds[String(adID)] = {
        adID,
        corporationID,
        allianceID: corporationRecord.allianceID || null,
        channelID: 0,
        typeMask: normalizeInteger(args && args[1], 0),
        langMask: normalizeInteger(args && args[2], 0),
        description: normalizeText(args && args[3], ""),
        recruiters: Array.isArray(args && args[4]) ? args[4] : [],
        title: normalizeText(args && args[5], ""),
        createDateTime: String(Date.now() * 10000 + 116444736000000000),
        expiryDateTime: String((Date.now() + (normalizeInteger(args && args[0], 1) * 86400000)) * 10000 + 116444736000000000),
        hourMask1: normalizeInteger(args && args[6], 0),
        minSP: normalizeInteger(args && args[7], 0),
        otherMask: normalizeInteger(args && args[8], 0),
        memberCount: listCorporationMembers(corporationID).length,
      };
      return runtime;
    });
    notifyCorporationRecruitmentAdChanged();
    return adID;
  }

  Handle_UpdateRecruitmentAd(args, session) {
    const corporationID = resolveCorporationID(session);
    const adID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    updateCorporationRuntime(corporationID, (runtime) => {
      if (!runtime.recruitmentAds[String(adID)]) {
        return runtime;
      }
      const advert = runtime.recruitmentAds[String(adID)];
      advert.typeMask = normalizeInteger(args && args[1], advert.typeMask || 0);
      advert.langMask = normalizeInteger(args && args[2], advert.langMask || 0);
      advert.description = normalizeText(args && args[3], advert.description || "");
      advert.recruiters = Array.isArray(args && args[4]) ? args[4] : advert.recruiters || [];
      advert.title = normalizeText(args && args[5], advert.title || "");
      advert.hourMask1 = normalizeInteger(args && args[7], advert.hourMask1 || 0);
      advert.minSP = normalizeInteger(args && args[8], advert.minSP || 0);
      advert.otherMask = normalizeInteger(args && args[9], advert.otherMask || 0);
      return runtime;
    });
    notifyCorporationRecruitmentAdChanged();
    return null;
  }

  Handle_DeleteRecruitmentAd(args, session) {
    const corporationID = resolveCorporationID(session);
    const adID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    updateCorporationRuntime(corporationID, (runtime) => {
      delete runtime.recruitmentAds[String(adID)];
      return runtime;
    });
    notifyCorporationRecruitmentAdChanged();
    return null;
  }
}

module.exports = CorpRecruitmentProxyService;
