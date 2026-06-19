const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const config = require(path.join(__dirname, "../../config"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  currentFileTime,
  normalizeText,
  resolveBoundNodeId,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  listAgents,
  getAgentByID,
} = require(path.join(__dirname, "./agentAuthority"));
const {
  getEpicArcMessageMaps,
} = require(path.join(__dirname, "./missionAuthority"));
const {
  buildCachedMethodCallResult,
} = require(path.join(__dirname, "../cache/objectCacheRuntime"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const bookmarkRuntime = require(path.join(
  __dirname,
  "../bookmark/bookmarkRuntimeState",
));
const agentMissionRuntime = require(path.join(
  __dirname,
  "./agentMissionRuntime",
));

function normalizePositiveInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return numericValue;
}

function buildMutableClientRowset(header = [], rows = []) {
  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", { type: "list", items: header }],
        ["RowClass", { type: "token", value: "util.Row" }],
        [
          "lines",
          {
            type: "list",
            items: rows.map((line) => ({
              type: "list",
              items: Array.isArray(line) ? line : [],
            })),
          },
        ],
      ],
    },
  };
}

function buildMarshalTuple(items = []) {
  return {
    type: "tuple",
    items: Array.isArray(items) ? items : [items],
  };
}

function normalizeMarshalTuple(value, fallback = [null, null]) {
  if (value && value.type === "tuple") {
    return value;
  }
  if (Array.isArray(value)) {
    return buildMarshalTuple(value);
  }
  return buildMarshalTuple(fallback);
}

function normalizeArrayLike(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && Array.isArray(value.items)) {
    return value.items;
  }
  if (value && typeof value[Symbol.iterator] === "function") {
    return [...value];
  }
  if (value && typeof value.length === "number") {
    try {
      return Array.from(value);
    } catch (_error) {
      return [];
    }
  }
  return [];
}

function toMarshalSafe(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    Buffer.isBuffer(value)
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return {
      type: "list",
      items: value.map((entry) => toMarshalSafe(entry)),
    };
  }

  if (typeof value === "object" && value.type) {
    return value;
  }

  if (typeof value === "object") {
    return {
      type: "dict",
      entries: Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        toMarshalSafe(entryValue),
      ]),
    };
  }

  return String(value);
}

function buildNumericKeyDict(source = {}) {
  return buildDict(
    Object.entries(source || {})
      .map(([key, value]) => [normalizePositiveInteger(key, 0), toMarshalSafe(value)])
      .filter(([key]) => key > 0),
  );
}

function buildNestedEpicArcMessageDict() {
  if (buildNestedEpicArcMessageDict._cache) {
    return buildNestedEpicArcMessageDict._cache;
  }

  buildNestedEpicArcMessageDict._cache = buildDict(
    Object.entries(getEpicArcMessageMaps() || {}).map(([messageType, missionMap]) => [
      messageType,
      buildNumericKeyDict(missionMap),
    ]),
  );
  return buildNestedEpicArcMessageDict._cache;
}

buildNestedEpicArcMessageDict._cache = null;

function filterMissionJournalToAgent(journalDetails, agentID) {
  const normalizedAgentID = normalizePositiveInteger(agentID, 0);
  if (!normalizedAgentID || !Array.isArray(journalDetails)) {
    return Array.isArray(journalDetails) ? journalDetails : [[], []];
  }
  return journalDetails.map((bucket) => (
    Array.isArray(bucket)
      ? bucket.filter((row) => Array.isArray(row) && normalizePositiveInteger(row[4], 0) === normalizedAgentID)
      : []
  ));
}

function resetNestedEpicArcMessageDictCacheForTests() {
  buildNestedEpicArcMessageDict._cache = null;
}

function buildNestedEpicArcMessageDictUncached() {
  return buildDict(
    Object.entries(getEpicArcMessageMaps() || {}).map(([messageType, missionMap]) => [
      messageType,
      buildNumericKeyDict(missionMap),
    ]),
  );
}

function normalizeMissionLocationRole(locationType) {
  switch (normalizeText(locationType, "").toLowerCase()) {
    case "objective":
    case "dungeon":
      return "dungeon";
    case "objective.source":
      return "source";
    case "objective.destination":
      return "destination";
    case "agenthomebase":
      return "agenthomebase";
    default:
      return "";
  }
}

function buildPointTarget(position, locationID, metadata = {}) {
  if (!position || typeof position !== "object") {
    return null;
  }
  const x = Number(position.x);
  const y = Number(position.y);
  const z = Number(position.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }
  return {
    kind: "point",
    point: { x, y, z },
    locationID: normalizePositiveInteger(locationID, 0),
    metadata: {
      ...(metadata && typeof metadata === "object" ? metadata : {}),
    },
  };
}

function buildTargetFromLocationWrap(locationWrap) {
  if (!locationWrap || typeof locationWrap !== "object") {
    return null;
  }
  const staticTarget = bookmarkRuntime.resolveStaticBookmarkTarget(
    normalizePositiveInteger(locationWrap.locationID, 0),
  );
  if (staticTarget) {
    return {
      kind: "item",
      itemID: normalizePositiveInteger(staticTarget.itemID, 0),
      locationID: normalizePositiveInteger(staticTarget.locationID, 0),
      metadata: {},
    };
  }
  return buildPointTarget(
    locationWrap,
    normalizePositiveInteger(locationWrap.solarsystemID, 0) ||
      normalizePositiveInteger(locationWrap.locationID, 0),
  );
}

function deleteBookmarkForCharacter(characterID, bookmarkID) {
  const bookmarkInfo = bookmarkRuntime.getBookmarkForCharacter(characterID, bookmarkID);
  if (!bookmarkInfo || !bookmarkInfo.folder) {
    return;
  }
  try {
    bookmarkRuntime.deleteBookmarks(characterID, bookmarkInfo.folder.folderID, [bookmarkID]);
  } catch (_error) {
    // Best-effort cleanup only.
  }
}

function isCurrentMissionBookmarkTarget(bookmarkTarget, role, missionRecord, missionAgentID) {
  if (!bookmarkTarget || !bookmarkTarget.bookmark) {
    return false;
  }
  const metadata =
    bookmarkTarget.metadata && typeof bookmarkTarget.metadata === "object"
      ? bookmarkTarget.metadata
      : {};
  if (normalizeText(metadata.role, "") !== role) {
    return false;
  }

  const bookmarkAgentID = normalizePositiveInteger(
    metadata.referringAgentID || metadata.agentID,
    0,
  );
  if (bookmarkAgentID > 0 && bookmarkAgentID !== missionAgentID) {
    return false;
  }

  if (role === "dungeon") {
    const expectedMissionSiteID = normalizePositiveInteger(
      missionRecord && missionRecord.missionSiteID,
      0,
    );
    const expectedMissionInstanceID = normalizePositiveInteger(
      missionRecord && missionRecord.dungeonInstanceID,
      0,
    );
    const bookmarkMissionSiteID = normalizePositiveInteger(metadata.missionSiteID, 0);
    const bookmarkMissionInstanceID = normalizePositiveInteger(
      metadata.missionInstanceID,
      0,
    );
    if (expectedMissionSiteID > 0 && bookmarkMissionSiteID !== expectedMissionSiteID) {
      return false;
    }
    if (
      expectedMissionInstanceID > 0 &&
      bookmarkMissionInstanceID !== expectedMissionInstanceID
    ) {
      return false;
    }
    return normalizePositiveInteger(bookmarkTarget.locationID, 0) ===
      normalizePositiveInteger(missionRecord && missionRecord.missionSystemID, 0);
  }

  if (role === "source") {
    return normalizePositiveInteger(bookmarkTarget.locationID, 0) === normalizePositiveInteger(
      missionRecord &&
        missionRecord.pickupLocation &&
        (missionRecord.pickupLocation.solarsystemID || missionRecord.pickupLocation.locationID),
      0,
    );
  }

  if (role === "destination") {
    return normalizePositiveInteger(bookmarkTarget.locationID, 0) === normalizePositiveInteger(
      missionRecord &&
        missionRecord.dropoffLocation &&
        (missionRecord.dropoffLocation.solarsystemID || missionRecord.dropoffLocation.locationID),
      0,
    );
  }

  if (role === "agenthomebase") {
    return true;
  }

  return false;
}

function resolveMissionLocationTarget(characterID, agentID, locationType, referringAgentID = 0) {
  const role = normalizeMissionLocationRole(locationType);
  const boundAgentID = normalizePositiveInteger(agentID, 0);
  const missionAgentID = normalizePositiveInteger(referringAgentID, 0) || boundAgentID;
  if (!role) {
    return null;
  }

  const missionRecord = missionAgentID > 0
    ? (
      agentMissionRuntime.getMissionRecord(characterID, missionAgentID) ||
      null
    )
    : null;

  if (missionRecord && missionRecord.bookmarkIDsByRole && typeof missionRecord.bookmarkIDsByRole === "object") {
    const bookmarkID = normalizePositiveInteger(missionRecord.bookmarkIDsByRole[role], 0);
    if (bookmarkID > 0) {
      const bookmarkTarget = bookmarkRuntime.resolveBookmarkTarget(bookmarkID);
      if (isCurrentMissionBookmarkTarget(bookmarkTarget, role, missionRecord, missionAgentID)) {
        return bookmarkTarget;
      }
      deleteBookmarkForCharacter(characterID, bookmarkID);
    }
  }

  if (role === "agenthomebase") {
    return buildTargetFromLocationWrap(
      agentMissionRuntime.getAgentLocationWrap(missionAgentID || boundAgentID),
    );
  }

  if (!missionRecord) {
    return null;
  }

  if (role === "source") {
    return buildTargetFromLocationWrap(missionRecord.pickupLocation || null);
  }

  if (role === "destination") {
    return buildTargetFromLocationWrap(missionRecord.dropoffLocation || null);
  }

  if (role === "dungeon") {
    return buildPointTarget(
      missionRecord.missionPosition,
      missionRecord.missionSystemID,
      {
        missionInstanceID: normalizePositiveInteger(missionRecord.dungeonInstanceID, 0) || null,
        missionSiteID: normalizePositiveInteger(missionRecord.missionSiteID, 0) || null,
      },
    );
  }

  return null;
}

class AgentMgrService extends BaseService {
  constructor() {
    super("agentMgr");
    this._boundContexts = new Map();
  }

  _rememberBoundContext(oidString, agentID) {
    if (!oidString || !agentID) {
      return;
    }
    this._boundContexts.set(oidString, {
      agentID: normalizePositiveInteger(agentID, 0),
    });
  }

  _resolveBoundAgentID(session, fallback = 0) {
    if (session && session.currentBoundObjectID) {
      const boundContext =
        this._boundContexts.get(session.currentBoundObjectID) || null;
      if (boundContext && boundContext.agentID) {
        return boundContext.agentID;
      }
    }
    return normalizePositiveInteger(fallback, 0);
  }

  _buildBoundResponse(agentID, session, nestedCall = null) {
    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const oid = [idString, currentFileTime()];
    this._rememberBoundContext(idString, agentID);

    if (session) {
      if (!session._boundObjectIDs || typeof session._boundObjectIDs !== "object") {
        session._boundObjectIDs = {};
      }
      session._boundObjectIDs[this.name] = idString;
      session.lastBoundObjectID = idString;
    }

    let callResult = null;
    if (Array.isArray(nestedCall) && nestedCall.length > 0) {
      const methodName = normalizeText(nestedCall[0], "");
      const callArgs = nestedCall.length > 1 ? nestedCall[1] : [];
      const callKwargs = nestedCall.length > 2 ? nestedCall[2] : null;
      const previousBoundObjectID = session ? session.currentBoundObjectID : null;
      try {
        if (session) {
          session.currentBoundObjectID = idString;
        }
        callResult = this.callMethod(
          methodName,
          Array.isArray(callArgs) ? callArgs : [callArgs],
          session,
          callKwargs,
        );
      } finally {
        if (session) {
          session.currentBoundObjectID = previousBoundObjectID || null;
        }
      }
    }

    return [
      {
        type: "substruct",
        value: {
          type: "substream",
          value: oid,
        },
      },
      callResult != null ? callResult : null,
    ];
  }

  Handle_MachoResolveObject() {
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session) {
    const bindParams = args && args.length > 0 ? args[0] : null;
    const nestedCall = args && args.length > 1 ? args[1] : null;
    const agentID = normalizePositiveInteger(
      Array.isArray(bindParams) ? bindParams[0] : bindParams,
      0,
    );
    return this._buildBoundResponse(agentID, session, nestedCall);
  }

  Handle_GetAgents() {
    log.debug("[AgentMgrService] GetAgents");
    return buildMutableClientRowset(
      [
        "agentID",
        "agentTypeID",
        "divisionID",
        "level",
        "stationID",
        "corporationID",
        "isLocatorAgent",
        "isInSpace",
        "careerID",
        "importantMission",
        "missionKind",
        "missionTypeLabel",
        "specialityID",
        "stationTypeID",
        "bloodlineID",
      ],
      listAgents().map((agentRecord) => [
        normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
        normalizePositiveInteger(agentRecord && agentRecord.agentTypeID, 0),
        normalizePositiveInteger(agentRecord && agentRecord.divisionID, 0),
        normalizePositiveInteger(agentRecord && agentRecord.level, 1),
        normalizePositiveInteger(agentRecord && agentRecord.stationID, 0) || null,
        normalizePositiveInteger(agentRecord && agentRecord.corporationID, 0),
        agentRecord && agentRecord.isLocator === true,
        agentRecord && agentRecord.isInSpace === true,
        normalizePositiveInteger(agentRecord && agentRecord.careerID, 0) || null,
        agentRecord && agentRecord.importantMission === true,
        normalizeText(agentRecord && agentRecord.missionKind, ""),
        normalizeText(agentRecord && agentRecord.missionTypeLabel, ""),
        normalizePositiveInteger(agentRecord && agentRecord.specialityID, 0) || null,
        normalizePositiveInteger(agentRecord && agentRecord.stationTypeID, 0) || null,
        normalizePositiveInteger(agentRecord && agentRecord.bloodlineID, 0) || null,
      ]),
    );
  }

  Handle_GetSolarSystemOfAgent(args) {
    const agentID = normalizePositiveInteger(args && args[0], 0);
    return agentMissionRuntime.getSolarSystemOfAgent(agentID);
  }

  Handle_GetCompletedCareerAgentIDs(args, session) {
    const agentIDs = normalizeArrayLike(args && args[0]);
    return buildNumericKeyDict(
      agentMissionRuntime.getCompletedCareerAgentMap(
        normalizePositiveInteger(session && session.characterID, 0),
        agentIDs,
      ),
    );
  }

  Handle_GetDisabledMissions() {
    return toMarshalSafe([]);
  }

  Handle_GetAgentStaticInfo(args) {
    return toMarshalSafe(
      getAgentByID(normalizePositiveInteger(args && args[0], 0)),
    );
  }

  Handle_GetStaticBlob() {
    return "";
  }

  Handle_GetMyJournalDetails(args, session) {
    const journalDetails = agentMissionRuntime.getJournalDetails(
      normalizePositiveInteger(session && session.characterID, 0),
    );
    const boundAgentID = this._resolveBoundAgentID(session, 0);
    return toMarshalSafe(
      boundAgentID > 0
        ? filterMissionJournalToAgent(journalDetails, boundAgentID)
        : journalDetails,
    );
  }

  Handle_GetPlausibleMissionIDs(args) {
    return toMarshalSafe(
      agentMissionRuntime.getPlausibleMissionIDs(
        normalizePositiveInteger(args && args[0], 0),
      ),
    );
  }

  Handle_GetMyEpicArcStatus() {
    return buildDict([]);
  }

  Handle_GetMessagesForEpicArcMissions() {
    return buildCachedMethodCallResult(
      buildNestedEpicArcMessageDict(),
      {
        serviceName: this.name,
        method: "GetMessagesForEpicArcMissions",
        versionCheck: "never",
      },
    );
  }

  Handle_DoAction(args, session) {
    const agentID = this._resolveBoundAgentID(session);
    const actionID = args && args.length > 0 ? args[0] : null;
    const result = agentMissionRuntime.doAgentAction(
      normalizePositiveInteger(session && session.characterID, 0),
      agentID,
      actionID,
    );
    const payload = result && result.data ? result.data : null;
    const agentSays = normalizeMarshalTuple(payload
      ? payload.agentSays
      : ["This agent is unavailable.", null]);
    return buildMarshalTuple([
      buildMarshalTuple([
        toMarshalSafe(agentSays),
        toMarshalSafe(payload ? payload.actions : []),
      ]),
      toMarshalSafe(payload ? payload.lastActionInfo : {}),
    ]);
  }

  Handle_GetMissionBriefingInfo(args, session) {
    return toMarshalSafe(
      agentMissionRuntime.getMissionBriefingInfo(
        normalizePositiveInteger(session && session.characterID, 0),
        this._resolveBoundAgentID(session),
      ),
    );
  }

  Handle_GetMissionJournalInfo(args, session) {
    return toMarshalSafe(
      agentMissionRuntime.getMissionJournalInfo(
        normalizePositiveInteger(session && session.characterID, 0),
        this._resolveBoundAgentID(session),
      ),
    );
  }

  Handle_GetMissionObjectiveInfo(args, session) {
    return toMarshalSafe(
      agentMissionRuntime.getMissionObjectiveInfo(
        normalizePositiveInteger(session && session.characterID, 0),
        this._resolveBoundAgentID(session),
      ),
    );
  }

  Handle_GetMissionKeywords(args, session) {
    return toMarshalSafe(
      agentMissionRuntime.getMissionKeywords(
        normalizePositiveInteger(session && session.characterID, 0),
        this._resolveBoundAgentID(session),
        args && args.length > 0 ? args[0] : null,
      ),
    );
  }

  Handle_RemoveOfferFromJournal(args, session) {
    return agentMissionRuntime.removeOfferFromJournal(
      normalizePositiveInteger(session && session.characterID, 0),
      this._resolveBoundAgentID(session),
    );
  }

  Handle_GetAgentLocationWrap(args, session) {
    return toMarshalSafe(
      agentMissionRuntime.getAgentLocationWrap(
        this._resolveBoundAgentID(session),
      ),
    );
  }

  Handle_GetInfoServiceDetails(args, session) {
    return toMarshalSafe(
      agentMissionRuntime.getInfoServiceDetails(
        normalizePositiveInteger(session && session.characterID, 0),
        this._resolveBoundAgentID(session),
      ),
    );
  }

  Handle_GetStandingGainsForMission(args, session) {
    const agentID = this._resolveBoundAgentID(session);
    return buildNumericKeyDict(
      agentMissionRuntime.getStandingGainsForMission(
        normalizePositiveInteger(session && session.characterID, 0),
        agentID,
        args && args.length > 0 ? args[0] : null,
      ),
    );
  }

  Handle_GetDungeonShipRestrictions() {
    return null;
  }

  Handle_GetEntryPoint(args, session) {
    const characterID = normalizePositiveInteger(session && session.characterID, 0);
    const agentID = this._resolveBoundAgentID(session);
    const target = resolveMissionLocationTarget(characterID, agentID, "dungeon");
    if (!target || target.kind !== "point") {
      return null;
    }
    return [target.point.x, target.point.y, target.point.z];
  }

  Handle_GotoLocation(args, session) {
    const characterID = normalizePositiveInteger(session && session.characterID, 0);
    const agentID = this._resolveBoundAgentID(session);
    const locationType = args && args.length > 0 ? args[0] : null;
    const referringAgentID = args && args.length > 2 ? args[2] : 0;
    const target = resolveMissionLocationTarget(
      characterID,
      agentID,
      locationType,
      referringAgentID,
    );
    if (!target) {
      return null;
    }
    if (target.kind === "item" && normalizePositiveInteger(target.itemID, 0) > 0) {
      spaceRuntime.followBall(session, normalizePositiveInteger(target.itemID, 0), 0);
      return null;
    }
    if (target.kind === "point" && target.point) {
      spaceRuntime.gotoPoint(session, target.point, {
        commandSource: "AgentGotoLocation",
      });
    }
    return null;
  }

  Handle_WarpToLocation(args, session) {
    const characterID = normalizePositiveInteger(session && session.characterID, 0);
    const agentID = this._resolveBoundAgentID(session);
    const locationType = args && args.length > 0 ? args[0] : null;
    const warpRange = Number(args && args.length > 2 ? args[2] : 0) || 0;
    const referringAgentID = args && args.length > 4 ? args[4] : 0;
    const target = resolveMissionLocationTarget(
      characterID,
      agentID,
      locationType,
      referringAgentID,
    );
    if (!target) {
      return null;
    }
    if (target.kind === "item" && normalizePositiveInteger(target.itemID, 0) > 0) {
      spaceRuntime.warpToEntity(session, normalizePositiveInteger(target.itemID, 0), {
        minimumRange: warpRange,
      });
      return null;
    }
    if (target.kind === "point" && target.point) {
      spaceRuntime.warpToPoint(session, target.point, {
        minimumRange: warpRange,
        stopDistance: warpRange,
      });
    }
    return null;
  }

  Handle_GetReplayTimestamp(args, session) {
    return agentMissionRuntime.getReplayTimestamp(
      normalizePositiveInteger(session && session.characterID, 0),
      this._resolveBoundAgentID(session),
    );
  }

  Handle_IsCheatingWithAgent() {
    return false;
  }

  Handle_ShouldAlwaysAllowReplay() {
    return false;
  }

  Handle_GetAgentByID(args) {
    return toMarshalSafe(
      getAgentByID(normalizePositiveInteger(args && args[0], 0)),
    );
  }
}

module.exports = AgentMgrService;
