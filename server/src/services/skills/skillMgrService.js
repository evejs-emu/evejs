/**
 * Skill Manager Service (skillMgr)
 *
 * Handles skill-related queries from the client.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { findItemById } = require(path.join(
  __dirname,
  "../inventory/itemStore",
));
const { getCharacterRecord } = require(path.join(
  __dirname,
  "../character/characterState",
));
const {
  getCharacterSkills,
  getSkillTypeByID,
} = require(path.join(__dirname, "./skillState"));
const {
  abortTraining,
  applyFreeSkillPoints,
  applyFreeSkillPointsInternal,
  buildPointsDict,
  getCharacterIDFromSession,
  getQueueSnapshot,
  normalizeQueueInput,
  previewFreeSkillPointsApplication,
  readBooleanKwarg,
  saveQueue,
} = require(path.join(__dirname, "./training/skillQueueRuntime"));
const {
  checkInjectionConstraints,
  combineSkillInjector,
  extractSkills,
  getDiminishedSpFromInjectors,
  injectSkillPoints,
  splitSkillInjector,
} = require(path.join(__dirname, "./trading/skillTradingRuntime"));
const {
  getDirectPurchasePrice,
  injectSkillbookItems,
  isSkillAvailableForDirectPurchase,
  isSkillInjected,
  isSkillType,
  purchaseSkills,
} = require(path.join(__dirname, "./skillbooks/skillbookRuntime"));
const {
  consumeRecentSkillPointChanges,
} = require(path.join(__dirname, "./certificates/skillChangeTracker"));
const {
  buildCharacterSkillDict,
  buildCharacterSkillEntry,
} = require(path.join(__dirname, "./skillTransport"));

const ATTRIBUTE_CHARISMA = 164;
const ATTRIBUTE_INTELLIGENCE = 165;
const ATTRIBUTE_MEMORY = 166;
const ATTRIBUTE_PERCEPTION = 167;
const ATTRIBUTE_WILLPOWER = 168;

function buildKeyVal(entries) {
  return {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries,
    },
  };
}

function buildList(items = []) {
  return {
    type: "list",
    items,
  };
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function unwrapValue(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return unwrapValue(value.value);
    }
    if (value.type === "int" || value.type === "long") {
      return unwrapValue(value.value);
    }
  }
  return value;
}

function normalizeSkillRequirements(skillTypeIDsAndLevels) {
  if (!skillTypeIDsAndLevels) {
    return [];
  }

  if (
    skillTypeIDsAndLevels.type === "dict" &&
    Array.isArray(skillTypeIDsAndLevels.entries)
  ) {
    return skillTypeIDsAndLevels.entries
      .map(([typeID, level]) => ({
        typeID: toInt(unwrapValue(typeID), 0),
        toLevel: toInt(unwrapValue(level), 0),
      }))
      .filter((entry) => entry.typeID > 0 && entry.toLevel > 0);
  }

  if (Array.isArray(skillTypeIDsAndLevels)) {
    return skillTypeIDsAndLevels
      .map((entry) =>
        Array.isArray(entry)
          ? {
              typeID: toInt(unwrapValue(entry[0]), 0),
              toLevel: toInt(unwrapValue(entry[1]), 0),
            }
          : {
              typeID: toInt(unwrapValue(entry && (entry.typeID ?? entry.trainingTypeID)), 0),
              toLevel: toInt(unwrapValue(entry && (entry.toLevel ?? entry.trainingToLevel)), 0),
            },
      )
      .filter((entry) => entry.typeID > 0 && entry.toLevel > 0);
  }

  return Object.entries(skillTypeIDsAndLevels)
    .map(([typeID, level]) => ({
      typeID: toInt(unwrapValue(typeID), 0),
      toLevel: toInt(unwrapValue(level), 0),
    }))
    .filter((entry) => entry.typeID > 0 && entry.toLevel > 0);
}

class SkillMgrService extends BaseService {
  constructor() {
    super("skillMgr");
  }

  _getCharacterId(session) {
    return getCharacterIDFromSession(session) || 140000001;
  }

  _getSnapshot(session) {
    return getQueueSnapshot(this._getCharacterId(session));
  }

  _getLiveSkillPointTotal(session) {
    return this._getSnapshot(session).projectedSkills.reduce(
      (sum, skillRecord) => sum + Number(skillRecord.trainedSkillPoints || skillRecord.skillPoints || 0),
      0,
    );
  }

  _buildSkillInfo(skillRecord) {
    return buildCharacterSkillEntry(skillRecord, {
      includeMetadata: true,
    });
  }

  _buildSkillsDict(session) {
    const skills = getCharacterSkills(this._getCharacterId(session));
    return buildCharacterSkillDict(skills, {
      includeMetadata: true,
    });
  }

  _buildSkillQueue(session) {
    return this._getSnapshot(session).queuePayload;
  }

  _buildEmptyDict() {
    return { type: "dict", entries: [] };
  }

  _getCharacterData(session) {
    return getCharacterRecord(this._getCharacterId(session)) || {};
  }

  _buildCharacterAttributes(session) {
    const charData = getCharacterRecord(this._getCharacterId(session)) || {};
    const source = charData.characterAttributes || {};
    return {
      type: "dict",
      entries: [
        [ATTRIBUTE_CHARISMA, Number(source[ATTRIBUTE_CHARISMA] ?? source.charisma ?? 20)],
        [
          ATTRIBUTE_INTELLIGENCE,
          Number(source[ATTRIBUTE_INTELLIGENCE] ?? source.intelligence ?? 20),
        ],
        [ATTRIBUTE_MEMORY, Number(source[ATTRIBUTE_MEMORY] ?? source.memory ?? 20)],
        [
          ATTRIBUTE_PERCEPTION,
          Number(source[ATTRIBUTE_PERCEPTION] ?? source.perception ?? 20),
        ],
        [ATTRIBUTE_WILLPOWER, Number(source[ATTRIBUTE_WILLPOWER] ?? source.willpower ?? 20)],
      ],
    };
  }

  Handle_GetMySkillQueue(args, session) {
    log.debug("[SkillMgr] GetMySkillQueue");
    return this._buildSkillQueue(session);
  }

  Handle_GetMySkillInfo(args, session) {
    log.debug("[SkillMgr] GetMySkillInfo");
    const snapshot = this._getSnapshot(session);
    return buildKeyVal([
      ["skills", this._buildSkillsDict(session)],
      ["skillPoints", this._getLiveSkillPointTotal(session)],
      ["freeSkillPoints", snapshot.freeSkillPoints],
      ["queue", snapshot.queuePayload],
    ]);
  }

  Handle_GetSkillQueue(args, session) {
    log.debug("[SkillMgr] GetSkillQueue");
    return this._buildSkillQueue(session);
  }

  Handle_GetSkillHistory(args, session) {
    log.debug("[SkillMgr] GetSkillHistory");
    const charData = this._getCharacterData(session);
    const history = Array.isArray(charData.skillHistory) ? charData.skillHistory : [];
    return buildList(
      history.map((entry) =>
        buildKeyVal([
          ["logDate", { type: "long", value: BigInt(String(entry.logDate || 0)) }],
          ["eventTypeID", Number(entry.eventTypeID || 0)],
          ["skillTypeID", Number(entry.skillTypeID || 0)],
          ["absolutePoints", Number(entry.absolutePoints || 0)],
          ["level", Number(entry.level || 0)],
        ]),
      ),
    );
  }

  Handle_GetSkillChangesForISIS(args, session) {
    log.debug("[SkillMgr] GetSkillChangesForISIS");
    return consumeRecentSkillPointChanges(this._getCharacterId(session));
  }

  Handle_GetSkillPoints(args, session) {
    log.debug("[SkillMgr] GetSkillPoints");
    return this._getLiveSkillPointTotal(session);
  }

  Handle_GetCharacterAttributeModifiers(args, session) {
    log.debug("[SkillMgr] GetCharacterAttributeModifiers");
    return { type: "list", items: [] };
  }

  Handle_GetAttributes(args, session) {
    log.debug("[SkillMgr] GetAttributes");
    return this._buildCharacterAttributes(session);
  }

  Handle_GetSkills(args, session) {
    log.debug("[SkillMgr] GetSkills");
    return this._buildSkillsDict(session);
  }

  Handle_GetAllSkills(args, session) {
    log.debug("[SkillMgr] GetAllSkills");
    return this._buildSkillsDict(session);
  }

  Handle_IsSkillInjected(args, session) {
    const typeID = toInt(unwrapValue(args && args[0]), 0);
    return isSkillInjected(this._getCharacterId(session), typeID);
  }

  Handle_IsSkillAvailableForPurchase(args) {
    const typeID = toInt(unwrapValue(args && args[0]), 0);
    return isSkillAvailableForDirectPurchase(typeID);
  }

  Handle_IsSkill(args) {
    const typeID = toInt(unwrapValue(args && args[0]), 0);
    return isSkillType(typeID);
  }

  Handle_GetDirectPurchasePrice(args) {
    const typeID = toInt(unwrapValue(args && args[0]), 0);
    return getDirectPurchasePrice(typeID);
  }

  Handle_PurchaseSkills(args, session) {
    log.debug("[SkillMgr] PurchaseSkills");
    const rawSkillTypeIDs = args && args.length === 1 ? args[0] : args;
    return purchaseSkills(this._getCharacterId(session), rawSkillTypeIDs, session);
  }

  Handle_InjectSkillIntoBrain(args, session) {
    log.debug("[SkillMgr] InjectSkillIntoBrain");
    const rawItemIDs = args && args.length === 1 ? args[0] : args;
    return injectSkillbookItems(this._getCharacterId(session), rawItemIDs, session);
  }

  Handle_CharStartTrainingSkillByTypeID(args, session) {
    log.debug("[SkillMgr] CharStartTrainingSkillByTypeID");
    const characterID = this._getCharacterId(session);
    const typeID = toInt(unwrapValue(args && args[0]), 0);
    if (typeID <= 0 || !getSkillTypeByID(typeID)) {
      return null;
    }

    const snapshot = getQueueSnapshot(characterID);
    const existingSkill = snapshot.projectedSkillMap.get(typeID);
    const explicitToLevel = toInt(unwrapValue(args && args[1]), 0);
    const targetLevel =
      explicitToLevel > 0
        ? explicitToLevel
        : Math.max(
            1,
            Math.min(
              5,
              Number(
                existingSkill
                  ? existingSkill.trainedSkillLevel || existingSkill.skillLevel || 0
                  : 0,
              ) + 1,
            ),
          );

    const nextQueue = [
      { typeID, toLevel: targetLevel },
      ...snapshot.queueEntries
        .filter(
          (entry) =>
            Number(entry.trainingTypeID || 0) !== typeID ||
            Number(entry.trainingToLevel || 0) !== targetLevel,
        )
        .map((entry) => ({
          typeID: Number(entry.trainingTypeID || 0),
          toLevel: Number(entry.trainingToLevel || 0),
        })),
    ];
    saveQueue(characterID, nextQueue, { activate: true });
    return null;
  }

  Handle_CharStartTrainingSkill(args, session) {
    log.debug("[SkillMgr] CharStartTrainingSkill");
    const itemID = toInt(unwrapValue(args && args[0]), 0);
    const item = findItemById(itemID);
    if (!item || Number(item.typeID || 0) <= 0) {
      return null;
    }
    return this.Handle_CharStartTrainingSkillByTypeID(
      [item.typeID, args && args.length > 1 ? args[1] : null],
      session,
    );
  }

  Handle_CharStopTrainingSkill(args, session) {
    log.debug("[SkillMgr] CharStopTrainingSkill");
    abortTraining(this._getCharacterId(session));
    return null;
  }

  Handle_GetRespecInfo(args, session) {
    log.debug("[SkillMgr] GetRespecInfo");
    const charData = this._getCharacterData(session);
    const respecInfo =
      charData.respecInfo && typeof charData.respecInfo === "object"
        ? charData.respecInfo
        : {};
    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["freeRespecs", Number(respecInfo.freeRespecs ?? 3)],
          ["lastRespecDate", respecInfo.lastRespecDate || null],
          ["nextTimedRespec", respecInfo.nextTimedRespec || null],
        ],
      },
    };
  }

  Handle_GetSkillQueueAndFreePoints(args, session) {
    log.debug("[SkillMgr] GetSkillQueueAndFreePoints called");
    const snapshot = this._getSnapshot(session);
    return [snapshot.queuePayload, snapshot.freeSkillPoints];
  }

  Handle_GetBoosters(args, session) {
    log.debug("[SkillMgr] GetBoosters called");
    const charData = this._getCharacterData(session);
    const boosters = Array.isArray(charData.boosters) ? charData.boosters : [];
    return {
      type: "dict",
      entries: boosters.map((entry, index) => [
        Number(entry.typeID || entry.itemID || index + 1),
        buildKeyVal(Object.entries(entry || {})),
      ]),
    };
  }

  Handle_GetImplants(args, session) {
    log.debug("[SkillMgr] GetImplants called");
    const charData = this._getCharacterData(session);
    const implants = Array.isArray(charData.implants) ? charData.implants : [];
    return {
      type: "dict",
      entries: implants.map((entry, index) => [
        Number(entry.typeID || entry.itemID || index + 1),
        buildKeyVal(Object.entries(entry || {})),
      ]),
    };
  }

  Handle_GetFreeSkillPoints(args, session) {
    log.debug("[SkillMgr] GetFreeSkillPoints called");
    return this._getSnapshot(session).freeSkillPoints;
  }

  Handle_GetFreeSkillPointsAppliedToQueue(args, session) {
    log.debug("[SkillMgr] GetFreeSkillPointsAppliedToQueue called");
    return buildPointsDict(
      previewFreeSkillPointsApplication(this._getCharacterId(session)),
    );
  }

  Handle_GetFreeSkillPointsAppliedToSkills(args, session) {
    log.debug("[SkillMgr] GetFreeSkillPointsAppliedToSkills called");
    return buildPointsDict(
      previewFreeSkillPointsApplication(
        this._getCharacterId(session),
        normalizeSkillRequirements(args && args[0]),
      ),
    );
  }

  Handle_ApplyFreeSkillPointsToQueue(args, session) {
    log.debug("[SkillMgr] ApplyFreeSkillPointsToQueue called");
    return applyFreeSkillPointsInternal(this._getCharacterId(session)).newFreeSkillPoints;
  }

  Handle_ApplyFreeSkillPointsToSkills(args, session) {
    log.debug("[SkillMgr] ApplyFreeSkillPointsToSkills called");
    return applyFreeSkillPointsInternal(
      this._getCharacterId(session),
      normalizeSkillRequirements(args && args[0]),
    ).newFreeSkillPoints;
  }

  Handle_ApplyFreeSkillPoints(args, session) {
    log.debug("[SkillMgr] ApplyFreeSkillPoints called");
    return applyFreeSkillPoints(
      this._getCharacterId(session),
      unwrapValue(args && args[0]),
      unwrapValue(args && args[1]),
    );
  }

  Handle_SaveNewQueue(args, session, kwargs) {
    log.debug("[SkillMgr] SaveNewQueue called");
    saveQueue(
      this._getCharacterId(session),
      normalizeQueueInput(args && args[0]),
      {
        activate: readBooleanKwarg(kwargs, "activate", true),
      },
    );
    return null;
  }

  Handle_AbortTraining(args, session) {
    log.debug("[SkillMgr] AbortTraining called");
    abortTraining(this._getCharacterId(session));
    return null;
  }

  Handle_InjectSkillpoints(args, session) {
    log.debug("[SkillMgr] InjectSkillpoints called");
    return injectSkillPoints(
      this._getCharacterId(session),
      toInt(unwrapValue(args && args[0]), 0),
      toInt(unwrapValue(args && args[1]), 1),
      session,
    );
  }

  Handle_CheckInjectionConstraints(args, session) {
    log.debug("[SkillMgr] CheckInjectionConstraints called");
    checkInjectionConstraints(
      this._getCharacterId(session),
      toInt(unwrapValue(args && args[0]), 0),
      toInt(unwrapValue(args && args[1]), 1),
      session,
    );
    return null;
  }

  Handle_GetDiminishedSpFromInjectors(args, session) {
    log.debug("[SkillMgr] GetDiminishedSpFromInjectors called");
    return getDiminishedSpFromInjectors(
      this._getCharacterId(session),
      toInt(unwrapValue(args && args[0]), 0),
      toInt(unwrapValue(args && args[1]), 1),
      toInt(unwrapValue(args && args[2]), 0),
    );
  }

  Handle_ExtractSkills(args, session) {
    log.debug("[SkillMgr] ExtractSkills called");
    return extractSkills(
      this._getCharacterId(session),
      args && args[0],
      toInt(unwrapValue(args && args[1]), 0),
      session,
    );
  }

  Handle_SplitSkillInjector(args, session) {
    log.debug("[SkillMgr] SplitSkillInjector called");
    return splitSkillInjector(
      this._getCharacterId(session),
      toInt(unwrapValue(args && args[0]), 0),
      toInt(unwrapValue(args && args[1]), 1),
      session,
    );
  }

  Handle_CombineSkillInjector(args, session) {
    log.debug("[SkillMgr] CombineSkillInjector called");
    return combineSkillInjector(
      this._getCharacterId(session),
      toInt(unwrapValue(args && args[0]), 0),
      toInt(unwrapValue(args && args[1]), 1),
      session,
    );
  }

  Handle_CheckAndSendNotifications(args, session) {
    log.debug("[SkillMgr] CheckAndSendNotifications called");
    return { type: "list", items: [] };
  }

  Handle_MachoResolveObject(args, session, kwargs) {
    log.debug("[SkillMgr] MachoResolveObject called");
    const config = require(path.join(__dirname, "../../config"));
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    const config = require(path.join(__dirname, "../../config"));
    const bindParams = args && args.length > 0 ? args[0] : null;
    const nestedCall = args && args.length > 1 ? args[1] : null;

    log.debug(
      `[SkillMgr] MachoBindObject args.length=${args ? args.length : 0} bindParams=${JSON.stringify(bindParams, (k, v) => (typeof v === "bigint" ? v.toString() : v))} nestedCall=${JSON.stringify(nestedCall, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))}`,
    );

    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
    const oid = [idString, now];

    let callResult = null;
    if (nestedCall && Array.isArray(nestedCall) && nestedCall.length >= 1) {
      const methodName =
        typeof nestedCall[0] === "string"
          ? nestedCall[0]
          : Buffer.isBuffer(nestedCall[0])
            ? nestedCall[0].toString("utf8")
            : String(nestedCall[0]);
      const callArgs = nestedCall.length > 1 ? nestedCall[1] : [];
      const callKwargs = nestedCall.length > 2 ? nestedCall[2] : null;

      log.debug(`[SkillMgr] MachoBindObject nested call: ${methodName}`);
      callResult = this.callMethod(
        methodName,
        Array.isArray(callArgs) ? callArgs : [callArgs],
        session,
        callKwargs,
      );
    }

    return [
      {
        type: "substruct",
        value: { type: "substream", value: oid },
      },
      callResult != null ? callResult : null,
    ];
  }
}

module.exports = SkillMgrService;
