/**
 * Corporation Service (corporationSvc)
 *
 * Handles corporation-related queries from the client.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { getCharacterRecord } = require(path.join(
  __dirname,
  "../character/characterState",
));
const {
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  buildRow,
  buildRowset,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getCorporationInfoRecord,
} = require(path.join(__dirname, "./corporationState"));
const {
  getCorporationRuntime,
  ensureRuntimeInitialized,
  normalizePositiveInteger,
  updateCorporationRuntime,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  getCorporationWarPermitStatus,
} = require(path.join(__dirname, "./warPermitState"));
let medalCacheVersion = 1;
let cachedMedalRuntimeState = null;
let cachedMedalRuntimeStateVersion = 0;
const medalDetailsCacheByMedalID = new Map();
const receivedMedalsCacheByCharacterID = new Map();

function resolveCharacterInfo(args, session) {
  const charId =
    args && args.length > 0 ? args[0] : session ? session.characterID : 0;

  return {
    charId,
    charData: getCharacterRecord(charId) || {},
  };
}

function buildCorporationInfo(session, charData) {
  const corpId =
    charData.corporationID ||
    (session ? session.corporationID || session.corpid : 1000044);
  const runtime = getCorporationRuntime(corpId) || {};
  const info =
    getCorporationInfoRecord(corpId) || {
      corporationID: corpId,
      corporationName: `Corporation ${corpId}`,
      ticker: "TICKR",
      tickerName: "TICKR",
      ceoID: (session && (session.characterID || session.charid)) || null,
      creatorID: (session && (session.characterID || session.charid)) || null,
      allianceID:
        charData.allianceID || (session ? session.allianceID || session.allianceid : null),
      memberCount: 1,
      shares: 1000,
      deleted: 0,
      stationID: null,
      taxRate: 0.0,
      description: "",
      url: "",
      loyaltyPointTaxRate: 0.0,
      friendlyFire: 0,
      allowWar: getCorporationWarPermitStatus(corpId),
      factionID: null,
    };
  const row = [
    info.corporationID,
    info.corporationName,
    info.ticker,
    info.ceoID,
    1,
  ];

  return buildKeyVal([
    ["corporationID", info.corporationID],
    ["corporationName", info.corporationName],
    ["ticker", info.ticker],
    ["tickerName", info.tickerName || info.ticker],
    ["allianceID", info.allianceID],
    ["factionID", info.factionID ?? null],
    ["ceoID", info.ceoID],
    ["creatorID", info.creatorID],
    ["membership", 1],
    ["shares", info.shares],
    ["deleted", info.deleted],
    ["stationID", info.stationID],
    ["header", ["corporationID", "corporationName", "ticker", "ceoID", "membership"]],
    ["row", row],
    ["line", row],
    ["memberCount", info.memberCount],
    ["taxRate", info.taxRate],
    ["loyaltyPointTaxRate", info.loyaltyPointTaxRate || 0.0],
    ["friendlyFire", info.friendlyFire || 0],
    ["isRecruiting", runtime.applicationsEnabled === 0 ? 0 : 1],
    ["allowWar", info.allowWar ?? getCorporationWarPermitStatus(corpId)],
    ["shape1", info.shape1 ?? null],
    ["shape2", info.shape2 ?? null],
    ["shape3", info.shape3 ?? null],
    ["color1", info.color1 ?? null],
    ["color2", info.color2 ?? null],
    ["color3", info.color3 ?? null],
    ["typeface", info.typeface ?? null],
    ["description", info.description || ""],
    ["url", info.url || ""],
  ]);
}

function buildMedalInfoRowset(medals = []) {
  return buildRowset(
    [
      "medalID",
      "issuerID",
      "ownerID",
      "status",
      "reason",
      "date",
      "isDeleted",
    ],
    medals.map((entry) =>
      buildList([
        Number(entry.medalID || 0),
        Number(entry.issuerID || 0),
        Number(entry.ownerID || 0),
        Number(entry.status ?? 3),
        entry.reason || "",
        buildFiletimeLong(entry.date || entry.issueDate || entry.createdAt || 0n),
        entry.isDeleted ? 1 : 0,
      ]),
    ),
    "eve.common.script.sys.rowset.Rowset",
  );
}

function buildMedalGraphicsRowset(medalGraphics = []) {
  return buildRowset(
    [
      "medalID",
      "part",
      "graphic",
      "color",
    ],
    medalGraphics.map((entry) =>
      buildList([
        Number(entry.medalID || 0),
        Number(entry.part || 0),
        Number(entry.graphic || entry.graphicID || 0),
        Number(entry.color || entry.colorID || 0),
      ]),
    ),
    "eve.common.script.sys.rowset.Rowset",
  );
}

function buildCorpMedalRowset(medals = []) {
  return buildRowset(
    [
      "medalID",
      "ownerID",
      "creatorID",
      "title",
      "description",
      "createDateTime",
    ],
    medals.map((entry) =>
      buildList([
        Number(entry.medalID || 0),
        Number(entry.ownerID || 0),
        Number(entry.creatorID || 0),
        entry.title || "",
        entry.description || "",
        buildFiletimeLong(entry.createDateTime || entry.createdAt || 0n),
      ]),
    ),
    "eve.common.script.sys.rowset.Rowset",
  );
}

function buildMedalRecipientsRowset(recipients = []) {
  return buildRowset(
    ["medalID", "characterID", "issuerID", "reason", "date"],
    recipients.map((entry) =>
      buildList([
        Number(entry.medalID || 0),
        Number(entry.characterID || 0),
        Number(entry.issuerID || 0),
        entry.reason || "",
        buildFiletimeLong(entry.date || entry.createDateTime || 0n),
      ]),
    ),
    "eve.common.script.sys.rowset.Rowset",
  );
}

function invalidateMedalCaches() {
  medalCacheVersion += 1;
  cachedMedalRuntimeState = null;
  cachedMedalRuntimeStateVersion = 0;
  medalDetailsCacheByMedalID.clear();
  receivedMedalsCacheByCharacterID.clear();
}

function collectRuntimeMedalState() {
  if (
    cachedMedalRuntimeState &&
    cachedMedalRuntimeStateVersion === medalCacheVersion
  ) {
    return cachedMedalRuntimeState;
  }

  const runtimeTable = ensureRuntimeInitialized();
  const medalsByID = new Map();
  const recipientsByMedalID = new Map();

  for (const [corporationID, runtime] of Object.entries(runtimeTable.corporations || {})) {
    const medalState = runtime && runtime.medals ? runtime.medals : {};
    for (const medal of Object.values(medalState.medals || {})) {
      medalsByID.set(Number(medal.medalID || 0), {
        ...medal,
        ownerID: Number(medal.ownerID || corporationID) || Number(corporationID) || 0,
      });
    }
    for (const [medalID, recipients] of Object.entries(
      medalState.recipientsByMedalID || {},
    )) {
      recipientsByMedalID.set(
        Number(medalID || 0),
        Array.isArray(recipients) ? recipients : [],
      );
    }
  }

  cachedMedalRuntimeState = {
    medalsByID,
    recipientsByMedalID,
  };
  cachedMedalRuntimeStateVersion = medalCacheVersion;
  return cachedMedalRuntimeState;
}

function buildMedalDetailsPayload(medalID) {
  const numericMedalID = Number(medalID || 0);
  const cachedPayload = medalDetailsCacheByMedalID.get(numericMedalID);
  if (cachedPayload && cachedPayload.version === medalCacheVersion) {
    return cachedPayload.payload;
  }

  const { medalsByID, recipientsByMedalID } = collectRuntimeMedalState();
  const medal = medalsByID.get(numericMedalID);
  if (!medal) {
    const emptyPayload = buildKeyVal([
      ["info", buildList([])],
      ["graphics", buildMedalGraphicsRowset([])],
    ]);
    medalDetailsCacheByMedalID.set(numericMedalID, {
      version: medalCacheVersion,
      payload: emptyPayload,
    });
    return emptyPayload;
  }

  const recipients = recipientsByMedalID.get(numericMedalID) || [];
  const payload = buildKeyVal([
    [
      "info",
      buildList([
        buildKeyVal([
          ["medalID", Number(medal.medalID || 0)],
          ["ownerID", Number(medal.ownerID || 0)],
          ["creatorID", Number(medal.creatorID || 0)],
          ["title", medal.title || ""],
          ["description", medal.description || ""],
          ["createDateTime", buildFiletimeLong(medal.createDateTime || 0)],
          ["numberOfRecipients", recipients.length],
        ]),
      ]),
    ],
    [
      "graphics",
      buildMedalGraphicsRowset(
        (Array.isArray(medal.graphics) ? medal.graphics : []).map((graphic) => ({
          medalID: Number(medal.medalID || 0),
          part: graphic.part || 0,
          graphic: graphic.graphic || graphic.graphicID || 0,
          color: graphic.color || graphic.colorID || 0,
        })),
      ),
    ],
  ]);
  medalDetailsCacheByMedalID.set(numericMedalID, {
    version: medalCacheVersion,
    payload,
  });
  return payload;
}

function getReceivedMedalsForCharacter(characterID) {
  const numericCharacterID = Number(characterID || 0);
  const cachedState = receivedMedalsCacheByCharacterID.get(numericCharacterID);
  if (cachedState && cachedState.version === medalCacheVersion) {
    return cachedState.payload;
  }

  const { medalsByID, recipientsByMedalID } = collectRuntimeMedalState();
  const medalInfo = [];
  const medalGraphics = [];

  for (const [medalID, recipients] of recipientsByMedalID.entries()) {
    const medal = medalsByID.get(medalID);
    if (!medal) {
      continue;
    }
    const matchingRecipients = recipients.filter(
      (recipient) => Number(recipient && recipient.characterID) === numericCharacterID,
    );
    if (matchingRecipients.length === 0) {
      continue;
    }

    for (const recipient of matchingRecipients) {
      medalInfo.push({
        medalID,
        issuerID: Number(recipient.issuerID || 0),
        ownerID: Number(medal.ownerID || 0),
        status: Number(medal.status ?? 3),
        reason: recipient.reason || "",
        date: recipient.date || recipient.createDateTime || medal.createDateTime || 0,
        isDeleted: medal.isDeleted ? 1 : 0,
      });
    }

    for (const graphic of Array.isArray(medal.graphics) ? medal.graphics : []) {
      medalGraphics.push({
        medalID,
        part: graphic.part || 0,
        graphic: graphic.graphic || graphic.graphicID || 0,
        color: graphic.color || graphic.colorID || 0,
      });
    }
  }

  const payload = {
    medalInfo,
    medalGraphics,
  };
  receivedMedalsCacheByCharacterID.set(numericCharacterID, {
    version: medalCacheVersion,
    payload,
  });
  return payload;
}

class CorpService extends BaseService {
  constructor() {
    super("corporationSvc");
  }

  Handle_GetMyCorporationInfo(args, session) {
    log.debug("[CorpSvc] GetMyCorporationInfo");
    const { charData } = resolveCharacterInfo(args, session);
    return buildCorporationInfo(session, charData);
  }

  Handle_GetNPCDivisions() {
    log.debug("[CorpSvc] GetNPCDivisions");
    return { type: "list", items: [] };
  }

  Handle_GetEmploymentRecord(args, session) {
    log.debug("[CorpSvc] GetEmploymentRecord");
    const { charData } = resolveCharacterInfo(args, session);
    const history = Array.isArray(charData.employmentHistory)
      ? charData.employmentHistory
      : [
          {
            corporationID:
              charData.corporationID || (session ? session.corporationID : 1000044),
            startDate: charData.startDateTime || charData.createDateTime,
            deleted: 0,
          },
        ];
    const sortedHistory = history
      .slice()
      .sort((left, right) =>
        String(right && right.startDate ? right.startDate : "").localeCompare(
          String(left && left.startDate ? left.startDate : ""),
        ),
      );
    return buildRowset(
      ["corporationID", "startDate", "deleted"],
      sortedHistory.map((entry) =>
        buildList([
          Number(entry.corporationID) ||
            charData.corporationID ||
            (session ? session.corporationID : 1000044),
          buildFiletimeLong(entry.startDate || charData.startDateTime || charData.createDateTime),
          entry.deleted ? 1 : 0,
        ]),
      ),
      "eve.common.script.sys.rowset.Rowset",
    );
  }

  Handle_GetRecruitmentAdsByCriteria() {
    log.debug("[CorpSvc] GetRecruitmentAdsByCriteria");
    return { type: "list", items: [] };
  }

  Handle_GetCorpInfo(args) {
    const corporationID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    log.debug(`[CorpSvc] GetCorpInfo(${corporationID})`);
    const info = getCorporationInfoRecord(corporationID);
    if (!info) {
      return null;
    }

    // The NPC corporation info window consumes this RPC as an iterable market-activity
    // recordset, not as corporation metadata. Returning an empty list preserves the
    // client contract until we wire real NPC market supply/demand aggregation.
    return buildList([]);
  }

  Handle_GetEmployementRecordAndCharacterTransfers(args, session) {
    log.debug("[CorpSvc] GetEmployementRecordAndCharacterTransfers");
    return [this.Handle_GetEmploymentRecord(args, session), { type: "list", items: [] }];
  }

  Handle_GetMedalsReceived(args, session) {
    log.debug("[CorpSvc] GetMedalsReceived");
    const { charId } = resolveCharacterInfo(args, session);
    const { medalInfo, medalGraphics } = getReceivedMedalsForCharacter(charId);

    return [buildMedalInfoRowset(medalInfo), buildMedalGraphicsRowset(medalGraphics)];
  }

  Handle_GetMedalDetails(args, session) {
    const medalID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    log.debug(`[CorpSvc] GetMedalDetails(${medalID})`);
    return buildMedalDetailsPayload(medalID);
  }

  Handle_GetInfoWindowDataForChar(args, session) {
    log.debug("[CorpSvc] GetInfoWindowDataForChar");
    const { charData } = resolveCharacterInfo(args, session);
    return buildKeyVal([
      ["corpID", charData.corporationID || (session ? session.corporationID : 1000044)],
      ["allianceID", charData.allianceID || (session ? session.allianceID : null)],
      ["title", charData.title || ""],
    ]);
  }

  Handle_CreateMedal(args, session) {
    const corporationID =
      (session && (session.corporationID || session.corpid)) || 0;
    let medalID = null;
    updateCorporationRuntime(corporationID, (runtime, corporationRecord, table) => {
      medalID = table._meta.nextMedalID++;
      const medal = {
        medalID,
        ownerID: corporationID,
        creatorID: (session && (session.characterID || session.charid)) || 0,
        title: args && args[0] ? String(args[0]) : "",
        description: args && args[1] ? String(args[1]) : "",
        graphics: Array.isArray(args && args[2]) ? args[2] : [],
        status: 3,
        createDateTime: String(Date.now() * 10000 + 116444736000000000),
      };
      runtime.medals.medals[String(medalID)] = medal;
      runtime.medals.recipientsByMedalID[String(medalID)] = [];
      return runtime;
    });
    invalidateMedalCaches();
    return medalID;
  }

  Handle_SetMedalStatus(args, session) {
    const corporationID =
      (session && (session.corporationID || session.corpid)) || 0;
    const statusMap =
      args && args[0] && typeof args[0] === "object" ? args[0] : {};
    updateCorporationRuntime(corporationID, (runtime) => {
      for (const [medalID, status] of Object.entries(statusMap)) {
        if (runtime.medals.medals[String(medalID)]) {
          runtime.medals.medals[String(medalID)].status = Number(status || 0);
        }
      }
      return runtime;
    });
    invalidateMedalCaches();
    return null;
  }

  Handle_GetAllCorpMedals(args) {
    const corporationID = normalizePositiveInteger(args && args[0], 0) || 0;
    const runtime = getCorporationRuntime(corporationID) || {};
    const medals = Object.values((runtime.medals && runtime.medals.medals) || {});
    const graphics = [];
    for (const medal of medals) {
      for (const graphic of Array.isArray(medal.graphics) ? medal.graphics : []) {
        graphics.push({
          medalID: medal.medalID,
          part: graphic.part || 0,
          graphic: graphic.graphic || graphic.graphicID || 0,
          color: graphic.color || graphic.colorID || 0,
        });
      }
    }
    return [buildCorpMedalRowset(medals), buildMedalGraphicsRowset(graphics)];
  }

  Handle_GetRecipientsOfMedal(args, session) {
    const corporationID =
      (session && (session.corporationID || session.corpid)) || 0;
    const medalID = normalizePositiveInteger(args && args[0], 0) || 0;
    const runtime = getCorporationRuntime(corporationID) || {};
    return buildMedalRecipientsRowset(
      ((runtime.medals && runtime.medals.recipientsByMedalID) || {})[
        String(medalID)
      ] || [],
    );
  }

  Handle_GiveMedalToCharacters(args, session) {
    const corporationID =
      (session && (session.corporationID || session.corpid)) || 0;
    const medalID = normalizePositiveInteger(args && args[0], 0) || 0;
    const characterIDs = Array.isArray(args && args[1]) ? args[1] : [args && args[1]];
    const reason = args && args[2] ? String(args[2]) : "";
    updateCorporationRuntime(corporationID, (runtime) => {
      if (!runtime.medals.recipientsByMedalID[String(medalID)]) {
        runtime.medals.recipientsByMedalID[String(medalID)] = [];
      }
      for (const characterID of characterIDs) {
        runtime.medals.recipientsByMedalID[String(medalID)].push({
          medalID,
          characterID: Number(characterID || 0),
          issuerID: (session && (session.characterID || session.charid)) || 0,
          reason,
          date: String(Date.now() * 10000 + 116444736000000000),
        });
      }
      return runtime;
    });
    invalidateMedalCaches();
    return null;
  }
}

module.exports = CorpService;
