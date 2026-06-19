/**
 * CHARACTER SERVICE
 * (skeleton code by AI, updated by Icey)
 *
 * handles character selection, creation, and related operations
 *
 * TODO: update support for new database controller
 */

const BaseService = require("../baseService");
const log = require("../../utils/logger");
const database = require("../../newDatabase");
const sessionRegistry = require("../chat/sessionRegistry");
const { throwWrappedUserError } = require("../../common/machoErrors");
const {
  applyCharacterToSession,
  flushCharacterSessionNotificationPlan,
  getCharacterRecord,
  updateCharacterRecord,
} = require("./characterState");
const {
  getCharacterCreationBloodlines,
  getCharacterCreationQAStarterSystemIDs,
  getCharacterCreationRace,
  getCharacterCreationRaces,
  resolveCharacterCreationBloodlineProfile,
  resolveCharacterCreationSchoolIDForRace,
  resolveCharacterCreationSchoolProfile,
} = require("./characterCreationData");
const { restoreSpaceSession } = require("../../space/transitions");
const {
  getCharacterSkillPointTotal,
} = require("../skills/skillState");
const {
  buildTrainingSelectionInfo,
} = require("../skills/training/skillQueueRuntime");
const {
  buildFiletimeLong,
} = require("../_shared/serviceHelpers");
const {
  ACCOUNT_KEY,
  JOURNAL_CURRENCY,
  JOURNAL_ENTRY_TYPE,
} = require("../account/walletState");
const {
  PLEX_LOG_CATEGORY,
  getTransactionID,
} = require("../account/plexVaultLogState");
const {
  clonePaperDollPayload,
  resolvePaperDollState,
} = require("./paperDollPayloads");
const {
  normalizeCharacterGender,
} = require("./characterIdentity");
const {
  VALIDATION_CODE,
  getValidRandomName,
  normalizeNameString,
  validateCharacterName,
} = require("./characterNameRuntime");
const {
  spawnRookieShipForCharacter,
} = require("../ship/rookieShipRuntime");
const {
  broadcastStationGuestJoined,
  broadcastStructureGuestJoined,
} = require("../_shared/guestLists");
const {
  getUnreadMailCount,
  sendWelcomeMailToCharacter,
} = require("../mail/mailState");
const {
  getCorporationRecord,
} = require("../corporation/corporationState");
const {
  getUnprocessedNotificationCount,
} = require("../notifications/notificationState");
const {
  buildNewCharacterTutorialState,
  consumeCompletedAirNpeRevealOnFirstLogin,
  getCharacterTutorialSnapshot,
  markCharacterTutorialSkipped,
} = require("../npe/tutorialRuntime");
const {
  getStationRecord,
} = require("../_shared/stationStaticData");
const {
  NEW_CHARACTER_START_OVERRIDE,
} = require("../_shared/newCharacterStartOverride");
const {
  cancelCharacterDeletePrepare,
  deleteCharacter,
  getCharacterDeletePrepareDateTime,
  isCharacterQueuedForDeletion,
  prepareCharacterForDelete,
} = require("./characterDeletionRuntime");
const {
  reserveCharacterID,
} = require("../_shared/identityAllocator");

/**
 * Build a util.KeyVal PyObject — the only working PyObject type in V23.02
 */
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

function unwrapCreationArg(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return unwrapCreationArg(value.value);
    }
    if (Object.prototype.hasOwnProperty.call(value, "name")) {
      return unwrapCreationArg(value.name);
    }
  }

  return value;
}

function readCreationIntArg(args, index, fallback, legacyIndex = null) {
  const rawPrimary = args && args.length > index ? unwrapCreationArg(args[index]) : undefined;
  const rawLegacy =
    legacyIndex !== null && args && args.length > legacyIndex
      ? unwrapCreationArg(args[legacyIndex])
      : undefined;
  const candidate =
    rawPrimary !== undefined && rawPrimary !== null && rawPrimary !== ""
      ? rawPrimary
      : rawLegacy;
  const numeric = Number(candidate);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeCreationGender(value, fallback = 1) {
  return value === 0 || value === 1 || value === 2 ? value : fallback;
}

function isCreationPayloadArg(value) {
  if (!value || Buffer.isBuffer(value)) {
    return false;
  }
  if (Array.isArray(value)) {
    return true;
  }
  if (typeof value !== "object") {
    return false;
  }
  if (value.type === "dict" || value.type === "list" || value.type === "object") {
    return true;
  }
  if (value.args && typeof value.args === "object") {
    return true;
  }
  return (
    Object.prototype.hasOwnProperty.call(value, "sculpts") ||
    Object.prototype.hasOwnProperty.call(value, "modifiers") ||
    Object.prototype.hasOwnProperty.call(value, "appearance") ||
    Object.prototype.hasOwnProperty.call(value, "backgroundID")
  );
}

function resolveCreateCharacterSignature(args) {
  if (!Array.isArray(args)) {
    return "legacy";
  }

  if (
    args.length >= 8 &&
    isCreationPayloadArg(args[4]) &&
    isCreationPayloadArg(args[5])
  ) {
    return "latest-container";
  }

  if (
    args.length >= 8 &&
    isCreationPayloadArg(args[5]) &&
    isCreationPayloadArg(args[6])
  ) {
    return "ccsvc-wrapper";
  }

  return "legacy";
}

function readCreationPayloadArg(args, index, legacyIndex = null) {
  const candidate =
    args && args.length > index
      ? args[index]
      : legacyIndex !== null && args && args.length > legacyIndex
        ? args[legacyIndex]
        : null;

  return clonePaperDollPayload(candidate);
}

function readKeywordArg(kwargs, keys = []) {
  if (!kwargs) {
    return undefined;
  }

  if (kwargs.type === "dict" && Array.isArray(kwargs.entries)) {
    for (const key of keys) {
      const entry = kwargs.entries.find((candidate) => candidate[0] === key);
      if (entry) {
        return unwrapCreationArg(entry[1]);
      }
    }
    return undefined;
  }

  if (typeof kwargs === "object") {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(kwargs, key)) {
        return unwrapCreationArg(kwargs[key]);
      }
    }
  }

  return undefined;
}

function readKeywordIntArg(kwargs, keys = [], fallback = 0) {
  const numeric = Number(readKeywordArg(kwargs, keys));
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function resolveCharacterRequestId(args, kwargs, fallback = 0) {
  const directArg =
    args && args.length > 0 ? Number(unwrapCreationArg(args[0])) : NaN;
  if (Number.isFinite(directArg) && Math.trunc(directArg) > 0) {
    return Math.trunc(directArg);
  }

  return readKeywordIntArg(kwargs, ["charID", "characterID"], fallback);
}

function readBooleanLikeArg(value, fallback = false) {
  const normalized = unwrapCreationArg(value);
  if (typeof normalized === "boolean") {
    return normalized;
  }
  if (typeof normalized === "number") {
    return normalized !== 0;
  }
  if (typeof normalized === "string") {
    const trimmed = normalized.trim().toLowerCase();
    if (trimmed === "true" || trimmed === "1" || trimmed === "yes") {
      return true;
    }
    if (
      trimmed === "false" ||
      trimmed === "0" ||
      trimmed === "no" ||
      trimmed === ""
    ) {
      return false;
    }
  }
  return fallback;
}

function resolveSkipTutorial(args, kwargs) {
  if (Array.isArray(args) && args.length > 2) {
    return readBooleanLikeArg(args[2], false);
  }
  return readBooleanLikeArg(readKeywordArg(kwargs, ["skipTutorial"]), false);
}

function summarizeCreationArg(value, depth = 0) {
  if (depth > 3) {
    return "<max-depth>";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return `<Buffer:${value.toString("utf8")}>`;
  }

  if (Array.isArray(value)) {
    const summarized = value
      .slice(0, 8)
      .map((entry) => summarizeCreationArg(entry, depth + 1));
    if (value.length > 8) {
      summarized.push(`<+${value.length - 8} more>`);
    }
    return summarized;
  }

  if (typeof value === "object") {
    const summary = {};
    for (const [key, entryValue] of Object.entries(value).slice(0, 8)) {
      summary[key] = summarizeCreationArg(entryValue, depth + 1);
    }
    if (Object.keys(value).length > 8) {
      summary.__truncated__ = `<+${Object.keys(value).length - 8} more>`;
    }
    return summary;
  }

  return String(value);
}

function getFinishedSkillsCount(finishedSkills = []) {
  if (Array.isArray(finishedSkills)) {
    return finishedSkills.length;
  }

  const numericCount = Number(finishedSkills);
  return Number.isFinite(numericCount) && numericCount > 0
    ? Math.trunc(numericCount)
    : 0;
}

function resolveUnreadMailCount(characterID, fallback = 0) {
  const runtimeCount = getUnreadMailCount(characterID);
  return Number.isFinite(runtimeCount)
    ? runtimeCount
    : Number(fallback) || 0;
}

function resolveUnprocessedNotificationCount(characterID, fallback = 0) {
  const runtimeCount = getUnprocessedNotificationCount(characterID);
  return Number.isFinite(runtimeCount)
    ? runtimeCount
    : Number(fallback) || 0;
}

function resolveDeletePrepareDateTimeValue(characterRecord) {
  const deletePrepareDateTime = getCharacterDeletePrepareDateTime(characterRecord);
  return deletePrepareDateTime ? buildFiletimeLong(deletePrepareDateTime) : null;
}

function resolveStarterCorporationRecord(bloodlineProfile, schoolProfile = {}) {
  const candidateCorporationIDs = [
    Number(schoolProfile && schoolProfile.corporationID) || 0,
    Number(bloodlineProfile && bloodlineProfile.corporationID) || 0,
  ];

  for (const corporationID of candidateCorporationIDs) {
    if (corporationID <= 0) {
      continue;
    }
    const corporationRecord = getCorporationRecord(corporationID);
    if (corporationRecord) {
      return corporationRecord;
    }
  }

  return null;
}

function resolveStarterLocationContext(bloodlineProfile, schoolID) {
  const schoolProfile = resolveCharacterCreationSchoolProfile(schoolID, {
    raceID: bloodlineProfile && bloodlineProfile.raceID,
    corporationID: bloodlineProfile && bloodlineProfile.corporationID,
  });
  const starterCorporation = resolveStarterCorporationRecord(
    bloodlineProfile,
    schoolProfile,
  );
  const schoolStationID =
    schoolProfile.startingStations && schoolProfile.startingStations.length > 0
      ? Number(schoolProfile.startingStations[0]) || null
      : null;
  const starterStation = getStationRecord(
    null,
    NEW_CHARACTER_START_OVERRIDE.stationID ||
      schoolStationID ||
      (starterCorporation && starterCorporation.stationID
        ? starterCorporation.stationID
        : null),
  ) || getStationRecord(
    null,
    schoolStationID ||
      (starterCorporation && starterCorporation.stationID
        ? starterCorporation.stationID
        : null),
  );

  return {
    corporationID:
      Number(starterCorporation && starterCorporation.corporationID) ||
      Number(bloodlineProfile && bloodlineProfile.corporationID) ||
      1000009,
    factionID:
      Number(starterCorporation && starterCorporation.factionID) || null,
    stationID: Number(starterStation && starterStation.stationID) || 60003760,
    homeStationID: Number(starterStation && starterStation.stationID) || 60003760,
    cloneStationID: Number(starterStation && starterStation.stationID) || 60003760,
    solarSystemID: Number(starterStation && starterStation.solarSystemID) || 30000142,
    constellationID:
      Number(starterStation && starterStation.constellationID) || 20000020,
    regionID: Number(starterStation && starterStation.regionID) || 10000002,
  };
}

function normalizeAccountID(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function characterBelongsToAccount(character, accountID) {
  const expectedAccountID = normalizeAccountID(accountID);
  return (
    expectedAccountID > 0 &&
    normalizeAccountID(character && character.accountId) === expectedAccountID
  );
}

function normalizePositiveLocationID(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function resolveCharacterSelectionStationID(character) {
  if (!character) {
    return null;
  }

  const stationID =
    normalizePositiveLocationID(character.stationID) ||
    normalizePositiveLocationID(character.stationid);
  if (stationID) {
    return stationID;
  }

  // charselData.py reads only stationID; non-station location IDs are shown
  // as docked structures by the client, while live sessions keep structureID.
  return (
    normalizePositiveLocationID(character.structureID) ||
    normalizePositiveLocationID(character.structureid)
  );
}

class CharService extends BaseService {
  constructor() {
    super("charUnboundMgr");
  }

  _normalizeAllianceId(value) {
    const numeric = Number(value) || 0;
    return numeric > 0 ? numeric : null;
  }

  /**
   * GetCharactersToSelect — V23.02 client calls this locally, which
   * internally calls GetCharacterSelectionData remotely. This handler
   * may still be called by older clients.
   */
  Handle_GetCharactersToSelect(args, session) {
    log.info("[CharService] GetCharactersToSelect");

    const charactersResult = database.read("characters", "/");
    const characters = charactersResult.success ? charactersResult.data : {};
    const userId = normalizeAccountID(session && session.userid);

    const charList = [];
    for (const [charId, charData] of Object.entries(characters)) {
      if (characterBelongsToAccount(charData, userId)) {
        const character = getCharacterRecord(charId) || charData;
        charList.push(
          buildKeyVal([
            ["characterID", parseInt(charId, 10)],
            ["characterName", character.characterName || "Unknown"],
            [
              "deletePrepareDateTime",
              resolveDeletePrepareDateTimeValue(character),
            ],
            ["gender", normalizeCharacterGender(character.gender, 1)],
            ["typeID", character.typeID || 1373],
          ]),
        );
      }
    }

    log.debug(
      `[CharService] Returning ${charList.length} characters for userId=${userId}`,
    );

    return { type: "list", items: charList };
  }

  /**
   * GetCharacterSelectionData — V23.02 primary entry point.
   *
   * From decompiled charselData.py line 31:
   *   userDetails, trainingDetails, characterDetails, wars = \
   *       self.charRemoteSvc.GetCharacterSelectionData()
   *
   * Returns 4-tuple: (userDetails, trainingDetails, characterDetails, wars)
   */
  Handle_GetCharacterSelectionData(args, session) {
    log.debug("[CharService] GetCharacterSelectionData");

    const accountResult = database.read("accounts", "/");
    const accounts = accountResult.success ? accountResult.data : {};

    const charactersResult = database.read("characters", "/");
    const characters = charactersResult.success ? charactersResult.data : {};

    const userId = normalizeAccountID(session && session.userid);
    let accountUsername = "user";
    if (accounts) {
      for (const [username, acct] of Object.entries(accounts)) {
        if (normalizeAccountID(acct && acct.id) === userId) {
          accountUsername = username;
          break;
        }
      }
    }

    const userDetailsKeyVal = buildKeyVal([
      ["characterSlots", 3],
      ["userName", accountUsername],
      ["creationDate", { type: "long", value: 132000000000000000 }],
      ["subscriptionEndTime", { type: "long", value: 157469184000000000 }],
      ["maxCharacterSlots", 3],
    ]);
    const userDetails = { type: "list", items: [userDetailsKeyVal] };

    const trainingDetails = [null, null];

    const characterDetails = [];
    for (const [charId, rawCharacter] of Object.entries(characters)) {
      if (characterBelongsToAccount(rawCharacter, userId)) {
        const character = getCharacterRecord(charId) || rawCharacter;
        const cid = parseInt(charId, 10);
        const allianceID = this._normalizeAllianceId(character.allianceID);
        const skillPoints = getCharacterSkillPointTotal(cid) || character.skillPoints || 50000;
        const paperDollState = resolvePaperDollState(character, 2);
        const trainingInfo = buildTrainingSelectionInfo(cid);
        const selectionStationID = resolveCharacterSelectionStationID(character);
        characterDetails.push(
          buildKeyVal([
            ["characterID", cid],
            ["characterName", character.characterName || "Unknown"],
            [
              "deletePrepareDateTime",
              resolveDeletePrepareDateTimeValue(character),
            ],
            ["gender", normalizeCharacterGender(character.gender, 1)],
            ["typeID", character.typeID || 1373],
            ["raceID", character.raceID || 1],
            ["bloodlineID", character.bloodlineID || 1],
            ["ancestryID", character.ancestryID || 1],
            ["schoolID", character.schoolID ?? null],
            ["corporationID", character.corporationID || 1000009],
            ["allianceID", allianceID],
            // Keep character-select payload close to upstream.
            // Exposing empire/school/faction state here caused the client to
            // incorrectly surface war/faction UI on the selection screen.
            ["factionID", null],
            ["stationID", selectionStationID],
            ["solarSystemID", character.solarSystemID || 30000142],
            ["constellationID", character.constellationID || 20000020],
            ["regionID", character.regionID || 10000002],
            ["balance", character.balance ?? 100000.0],
            ["plexBalance", character.plexBalance ?? 2222],
            ["balanceChange", 0.0],
            ["skillPoints", skillPoints],
            ["shipTypeID", character.shipTypeID || 606],
            ["shipName", character.shipName || "Velator"],
            ["securityRating", character.securityStatus ?? character.securityRating ?? 0.0],
            ["securityStatus", character.securityStatus ?? character.securityRating ?? 0.0],
            ["title", character.title || ""],
            ["unreadMailCount", resolveUnreadMailCount(cid, character.unreadMailCount || 0)],
            ["paperdollState", paperDollState],
            ["lockTypeID", null],
            [
              "logoffDate",
              { type: "long", value: character.logoffDate || 132000000000000000 },
            ],
            ["skillTypeID", trainingInfo.skillTypeID],
            ["toLevel", trainingInfo.toLevel],
            [
              "trainingStartTime",
              trainingInfo.trainingStartTime
                ? { type: "long", value: BigInt(String(trainingInfo.trainingStartTime)) }
                : null,
            ],
            [
              "trainingEndTime",
              trainingInfo.trainingEndTime
                ? { type: "long", value: BigInt(String(trainingInfo.trainingEndTime)) }
                : null,
            ],
            [
              "queueEndTime",
              trainingInfo.queueEndTime
                ? { type: "long", value: BigInt(String(trainingInfo.queueEndTime)) }
                : null,
            ],
            ["finishSP", trainingInfo.finishSP],
            ["trainedSP", trainingInfo.trainedSP],
            ["finishedSkills", getFinishedSkillsCount(trainingInfo.finishedSkills)],
          ]),
        );
      }
    }

    const wars = { type: "list", items: [] };

    log.debug(
      `[CharService] GetCharacterSelectionData: returning ${characterDetails.length} chars`,
    );

    return [
      userDetails,
      trainingDetails,
      { type: "list", items: characterDetails },
      wars,
    ];
  }

  /**
   * GetCharacterToSelect — returns detailed info for one character
   */
  Handle_GetCharacterToSelect(args, session, kwargs) {
    const charId = resolveCharacterRequestId(args, kwargs, 0);
    log.info(`[CharService] GetCharacterToSelect(${charId})`);

    const characterResult = database.read("characters", "/");
    const characters = characterResult.success ? characterResult.data : {};
    const character = getCharacterRecord(charId) || characters[String(charId)];
    const requestingUserID = normalizeAccountID(session && session.userid);

    if (
      character &&
      !characterBelongsToAccount(character, requestingUserID)
    ) {
      log.warn(
        `[CharService] Rejected GetCharacterToSelect(${charId}) for user=${requestingUserID}; ` +
        `character belongs to account=${normalizeAccountID(character.accountId)}`,
      );
      return null;
    }

    const allianceID = this._normalizeAllianceId(character && character.allianceID);
    const skillPoints =
      getCharacterSkillPointTotal(charId) ||
      (character && character.skillPoints) ||
      50000;
    const paperDollState = resolvePaperDollState(character, 2);
    const trainingInfo = buildTrainingSelectionInfo(charId);

    if (!character) {
      log.warn(`[CharService] Character ${charId} not found`);
      return null;
    }

    const selectionStationID = resolveCharacterSelectionStationID(character);

    return buildKeyVal([
      ["unreadMailCount", resolveUnreadMailCount(charId, character.unreadMailCount || 0)],
      ["upcomingEventCount", character.upcomingEventCount || 0],
      [
        "unprocessedNotifications",
        resolveUnprocessedNotificationCount(
          charId,
          character.unprocessedNotifications || 0,
        ),
      ],
      ["characterID", parseInt(charId, 10)],
      ["petitionMessage", character.petitionMessage || ""],
      ["gender", normalizeCharacterGender(character.gender, 1)],
      ["raceID", character.raceID || 1],
      ["bloodlineID", character.bloodlineID || 1],
      ["ancestryID", character.ancestryID || 1],
      ["schoolID", character.schoolID ?? null],
      [
        "createDateTime",
        { type: "long", value: character.createDateTime || 132000000000000000 },
      ],
      [
        "startDateTime",
        { type: "long", value: character.startDateTime || 132000000000000000 },
      ],
      ["corporationID", character.corporationID || 1000009],
      ["worldSpaceID", character.worldSpaceID || 0],
      ["stationID", selectionStationID],
      ["solarSystemID", character.solarSystemID || 30000142],
      ["constellationID", character.constellationID || 20000020],
      ["regionID", character.regionID || 10000002],
      ["allianceID", allianceID],
      ["allianceMemberStartDate", allianceID ? character.allianceMemberStartDate || 0 : null],
      ["shortName", character.shortName || "none"],
      ["bounty", character.bounty || 0.0],
      [
        "skillQueueEndTime",
        {
          type: "long",
          value: trainingInfo.queueEndTime
            ? BigInt(String(trainingInfo.queueEndTime))
            : BigInt(character.skillQueueEndTime || 0),
        },
      ],
      ["skillPoints", skillPoints],
      ["shipTypeID", character.shipTypeID || 606],
      ["shipName", character.shipName || "Ship"],
      ["securityRating", character.securityStatus ?? character.securityRating ?? 0.0],
      ["securityStatus", character.securityStatus ?? character.securityRating ?? 0.0],
      ["title", character.title || ""],
      ["balance", character.balance ?? 100000.0],
      ["aurBalance", character.aurBalance ?? 0.0],
      ["plexBalance", character.plexBalance ?? 2222],
      ["daysLeft", character.daysLeft || 365],
      ["userType", character.userType || 30],
      ["paperDollState", paperDollState],
      ["paperdollState", paperDollState],
    ]);
  }

  /**
   * Current container:
   *   (name, bloodlineID, genderID, ancestryID, charInfo, portraitInfo, schoolID, raceID)
   * ccSvc wrapper:
   *   (name, raceID, bloodlineID, genderID, ancestryID, charInfo, portraitInfo, schoolID)
   * Legacy EvEJS:
   *   (name, bloodlineID, genderID, ancestryID, charInfo, portraitInfo, schoolID)
   */
  Handle_CreateCharacterWithDoll(args, session) {
    const createSignature = resolveCreateCharacterSignature(args);
    let characterName = args && args.length > 0 ? args[0] : "New Character";
    const raceID =
      createSignature === "latest-container"
        ? readCreationIntArg(args, 7, 1)
        : createSignature === "ccsvc-wrapper"
          ? readCreationIntArg(args, 1, 1)
          : 1;
    const bloodlineID =
      createSignature === "latest-container"
        ? readCreationIntArg(args, 1, 1)
        : createSignature === "ccsvc-wrapper"
          ? readCreationIntArg(args, 2, 1)
          : readCreationIntArg(args, 1, 1);
    const parsedGenderID =
      createSignature === "latest-container"
        ? readCreationIntArg(args, 2, 1)
        : createSignature === "ccsvc-wrapper"
          ? readCreationIntArg(args, 3, 1)
          : readCreationIntArg(args, 2, 1);
    const genderID = normalizeCreationGender(parsedGenderID, 1);
    const ancestryID =
      createSignature === "latest-container"
        ? readCreationIntArg(args, 3, 1)
        : createSignature === "ccsvc-wrapper"
          ? readCreationIntArg(args, 4, 1)
          : readCreationIntArg(args, 3, 1);
    const charInfo =
      createSignature === "latest-container"
        ? readCreationPayloadArg(args, 4)
        : createSignature === "ccsvc-wrapper"
          ? readCreationPayloadArg(args, 5)
          : readCreationPayloadArg(args, 4);
    const portraitInfo =
      createSignature === "latest-container"
        ? readCreationPayloadArg(args, 5)
        : createSignature === "ccsvc-wrapper"
          ? readCreationPayloadArg(args, 6)
          : readCreationPayloadArg(args, 5);
    const schoolID =
      createSignature === "latest-container"
        ? readCreationIntArg(args, 6, 11)
        : createSignature === "ccsvc-wrapper"
          ? readCreationIntArg(args, 7, 11)
          : readCreationIntArg(args, 6, 11, 7);

    if (Buffer.isBuffer(characterName)) {
      characterName = characterName.toString("utf8");
    } else if (characterName && typeof characterName === "object") {
      characterName =
        characterName.value ||
        characterName.name ||
        JSON.stringify(characterName);
    }
    characterName = normalizeNameString(characterName).trim().replace(/\s+/g, " ");

    log.info(
      `[CharService] CreateCharacterWithDoll rawArgs=${JSON.stringify(
        summarizeCreationArg(args),
      )}`,
    );
    if (parsedGenderID !== genderID) {
      log.warn(
        `[CharService] CreateCharacterWithDoll clamped invalid gender=${parsedGenderID} -> ${genderID}`,
      );
    }
    log.info(
      `[CharService] CreateCharacterWithDoll: name="${characterName}" race=${raceID} bloodline=${bloodlineID} gender=${genderID} ancestry=${ancestryID} school=${schoolID} signature=${createSignature}`,
    );

    const accountID = normalizeAccountID(session && session.userid);
    if (accountID <= 0) {
      log.warn(
        `[CharService] Rejecting CreateCharacterWithDoll("${characterName}") without a valid authenticated account session`,
      );
      throwWrappedUserError("CustomInfo", {
        info: "Character creation requires a valid authenticated account.",
      });
    }

    const nameValidationCode = validateCharacterName(characterName);
    if (nameValidationCode !== VALIDATION_CODE.VALID) {
      log.warn(
        `[CharService] Rejecting CreateCharacterWithDoll("${characterName}") invalidNameCode=${nameValidationCode}`,
      );
      throwWrappedUserError("CharNameInvalid");
    }

    const characterResult = database.read("characters", "/");
    const characters = characterResult.success ? characterResult.data : {};
    const newCharId = reserveCharacterID();

    const bloodlineProfile = resolveCharacterCreationBloodlineProfile(
      bloodlineID,
      {
        raceID: raceID || 1,
        typeID: 1373,
        corporationID: 1000009,
      },
    );
    const resolvedSchoolID = resolveCharacterCreationSchoolIDForRace(
      schoolID,
      bloodlineProfile.raceID,
      11,
    );
    const raceProfile = getCharacterCreationRace(bloodlineProfile.raceID) || null;
    const starterShipTypeID = Number((raceProfile && raceProfile.shipTypeID) || 606) || 606;
    const starterShipName =
      (raceProfile && raceProfile.shipName) || "Velator";
    const starterLocation = resolveStarterLocationContext(
      bloodlineProfile,
      resolvedSchoolID,
    );
    const tutorialState = buildNewCharacterTutorialState();
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
    const initialWalletReason = "Initial character creation ISK grant";
    const initialPlexReason = "Initial character creation PLEX grant";
    const initialWalletTransactionID = getTransactionID();
    const initialPlexTransactionID = getTransactionID();

    characters[String(newCharId)] = {
      accountId: accountID,
      characterName:
        typeof characterName === "string" ? characterName : "New Character",
      gender: genderID,
      bloodlineID,
      ancestryID,
      raceID: bloodlineProfile.raceID,
      typeID: bloodlineProfile.typeID,
      corporationID: starterLocation.corporationID,
      schoolID: resolvedSchoolID,
      allianceID: 0,
      factionID: starterLocation.factionID,
      stationID: starterLocation.stationID,
      homeStationID: starterLocation.homeStationID,
      cloneStationID: starterLocation.cloneStationID,
      solarSystemID: starterLocation.solarSystemID,
      constellationID: starterLocation.constellationID,
      regionID: starterLocation.regionID,
      createDateTime: now.toString(),
      startDateTime: now.toString(),
      logoffDate: now.toString(),
      deletePrepareDateTime: null,
      lockTypeID: null,
      securityRating: 0.0,
      title: "",
      description: "Character created via EveJS Elysian",
      balance: 100000.0,
      aurBalance: 0.0,
      plexBalance: 2222,
      balanceChange: 0.0,
      walletJournal: [
        {
          transactionID: initialWalletTransactionID,
          transactionDate: now.toString(),
          referenceID: newCharId,
          entryTypeID: JOURNAL_ENTRY_TYPE.GM_CASH_TRANSFER,
          ownerID1: newCharId,
          ownerID2: newCharId,
          accountKey: ACCOUNT_KEY.CASH,
          amount: 100000.0,
          balance: 100000.0,
          description: initialWalletReason,
          currency: JOURNAL_CURRENCY.ISK,
          sortValue: 1,
        },
      ],
      plexVaultTransactions: [
        {
          transactionID: initialPlexTransactionID,
          transactionDate: now.toString(),
          amount: 2222,
          balance: 2222,
          categoryMessageID: PLEX_LOG_CATEGORY.CCP,
          summaryMessageID: PLEX_LOG_CATEGORY.CCP,
          summaryText: initialPlexReason,
          reason: initialPlexReason,
        },
      ],
      skillPoints: 50000,
      shipTypeID: starterShipTypeID,
      shipName: starterShipName,
      bounty: 0.0,
      skillQueueEndTime: 0,
      daysLeft: 365,
      userType: 30,
      petitionMessage: "",
      worldSpaceID: 0,
      unreadMailCount: 0,
      upcomingEventCount: 0,
      unprocessedNotifications: 0,
      shipID: newCharId + 100,
      shortName: "none",
      employmentHistory: [
        {
          corporationID: starterLocation.corporationID,
          startDate: now.toString(),
          deleted: 0,
        },
      ],
      standingData: {
        char: [],
        corp: [],
        npc: [],
      },
      characterAttributes: {
        charisma: 20,
        intelligence: 20,
        memory: 20,
        perception: 20,
        willpower: 20,
      },
      respecInfo: {
        freeRespecs: 3,
        lastRespecDate: null,
        nextTimedRespec: null,
      },
      freeSkillPoints: 0,
      skillHistory: [],
      boosters: [],
      implants: [],
      jumpClones: [],
      timeLastCloneJump: "0",
      allianceMemberStartDate: 0,
      skillTypeID: null,
      toLevel: null,
      trainingStartTime: null,
      trainingEndTime: null,
      queueEndTime: null,
      finishSP: null,
      trainedSP: null,
      finishedSkills: [],
      appearanceInfo: charInfo,
      portraitInfo,
      paperDollState: charInfo ? 0 : 2,
      ...tutorialState,
    };

    database.write(
      "characters",
      `/${String(newCharId)}`,
      characters[String(newCharId)],
    );
    const rookieShipResult = spawnRookieShipForCharacter(
      newCharId,
      characters[String(newCharId)].stationID,
      {
        characterRecord: characters[String(newCharId)],
        setActiveShip: true,
        logLabel: "CreateCharacterWithDoll",
      },
    );
    if (!rookieShipResult.success) {
      log.warn(
        `[CharService] CreateCharacterWithDoll failed to provision rookie ship for char=${newCharId} typeID=${starterShipTypeID} error=${rookieShipResult.errorMsg}`,
      );
    }
    const welcomeMailResult = sendWelcomeMailToCharacter(newCharId, {
      characterName:
        typeof characterName === "string" ? characterName : "New Character",
    });
    if (!welcomeMailResult.success) {
      log.warn(
        `[CharService] CreateCharacterWithDoll failed to send welcome mail for char=${newCharId}: ${welcomeMailResult.errorMsg}`,
      );
    }
    const createdCharacter = getCharacterRecord(newCharId);
    database.flushTablesSync([
      "characters",
      "items",
      "skills",
      "mail",
      "notifications",
    ]);

    log.success(
      `[CharService] Created character "${characterName}" with ID ${newCharId} ship=${createdCharacter ? createdCharacter.shipID : "unknown"}`,
    );

    return newCharId;
  }

  Handle_GetNumCharacters(args, session) {
    const userId = normalizeAccountID(session && session.userid);
    const charactersResult = database.read("characters", "/");
    const characters = charactersResult.success ? charactersResult.data : {};
    return Object.values(characters).filter(
      (character) => characterBelongsToAccount(character, userId),
    ).length;
  }

  Handle_UpdateCharacterGender(args, session) {
    const charId = readCreationIntArg(args, 0, 0);
    const requestedGenderID = readCreationIntArg(args, 1, 1);
    const genderID = normalizeCreationGender(requestedGenderID, 1);

    log.info(
      `[CharService] UpdateCharacterGender(${charId}) gender=${genderID}`,
    );

    const updateResult = updateCharacterRecord(charId, (record) => ({
      ...record,
      gender: genderID,
    }));
    if (!updateResult.success) {
      log.warn(
        `[CharService] UpdateCharacterGender failed for ${charId}: ${updateResult.errorMsg}`,
      );
      return null;
    }

    if (session && Number(session.charid || session.characterID || 0) === Number(charId)) {
      session.genderID = genderID;
      session.genderid = genderID;
    }

    return null;
  }

  Handle_UpdateCharacterBloodline(args, session) {
    const charId = readCreationIntArg(args, 0, 0);
    const bloodlineID = readCreationIntArg(args, 1, 1);
    const currentRecord = getCharacterRecord(charId);
    if (!currentRecord) {
      log.warn(`[CharService] UpdateCharacterBloodline(${charId}) missing character`);
      return null;
    }

    const bloodlineProfile = resolveCharacterCreationBloodlineProfile(
      bloodlineID,
      {
        raceID: currentRecord.raceID || 1,
        typeID: currentRecord.typeID || 1373,
        corporationID: currentRecord.corporationID || 1000009,
      },
    );

    log.info(
      `[CharService] UpdateCharacterBloodline(${charId}) bloodline=${bloodlineID} race=${bloodlineProfile.raceID}`,
    );

    const updateResult = updateCharacterRecord(charId, (record) => ({
      ...record,
      bloodlineID: bloodlineProfile.bloodlineID,
      raceID: bloodlineProfile.raceID,
      typeID: bloodlineProfile.typeID,
      paperDollState: resolvePaperDollState(record, 2),
    }));
    if (!updateResult.success) {
      log.warn(
        `[CharService] UpdateCharacterBloodline failed for ${charId}: ${updateResult.errorMsg}`,
      );
      return null;
    }

    if (session && Number(session.charid || session.characterID || 0) === Number(charId)) {
      session.bloodlineID = bloodlineProfile.bloodlineID;
      session.bloodlineid = bloodlineProfile.bloodlineID;
      session.raceID = bloodlineProfile.raceID;
      session.raceid = bloodlineProfile.raceID;
      session.characterTypeID = bloodlineProfile.typeID;
    }

    return null;
  }

  Handle_GetCohortsForUser(args, session) {
    log.debug("[CharService] GetCohortsForUser");
    return { type: "list", items: [] };
  }

  Handle_GetTopBounties(args, session) {
    log.debug("[CharService] GetTopBounties");
    return { type: "list", items: [] };
  }

  Handle_GetCharCreationInfo(args, session) {
    log.debug("[CharService] GetCharCreationInfo");
    return {
      type: "dict",
      entries: [
        [
          "races",
          {
            type: "list",
            items: getCharacterCreationRaces().map((race) =>
              buildKeyVal([
                ["raceID", race.raceID],
                ["raceName", race.name],
                ["shipTypeID", race.shipTypeID],
                ["shipName", race.shipName],
              ]),
            ),
          },
        ],
        [
          "bloodlines",
          {
            type: "list",
            items: getCharacterCreationBloodlines().map((bloodline) =>
              buildKeyVal([
                ["bloodlineID", bloodline.bloodlineID],
                ["bloodlineName", bloodline.name],
                ["raceID", bloodline.raceID],
                ["corporationID", bloodline.corporationID],
              ]),
            ),
          },
        ],
      ],
    };
  }

  Handle_GetCharNewExtraCreationInfo(args, session) {
    log.debug("[CharService] GetCharNewExtraCreationInfo");
    return this.Handle_GetCharCreationInfo(args, session);
  }

  Handle_IsUserReceivingCharacter(args, session) {
    log.debug("[CharService] IsUserReceivingCharacter");
    return false;
  }

  Handle_GetCharacterInfo(args, session) {
    log.debug("[CharService] GetCharacterInfo");
    return this.Handle_GetCharacterToSelect(args, session);
  }

  Handle_GetCharOmegaDowngradeStatus(args, session, kwargs) {
    log.debug("[CharService] GetCharOmegaDowngradeStatus");
    return null;
  }

  Handle_SelectCharacterID(args, session, kwargs) {
    const charId = resolveCharacterRequestId(args, kwargs, 0);
    const skipTutorial = resolveSkipTutorial(args, kwargs);
    log.info(`[CharService] SelectCharacterID(${charId})`);

    if (!session) {
      return null;
    }

    const characterRecord = getCharacterRecord(charId);
    const sessionUserID = normalizeAccountID(session.userid);
    if (
      characterRecord &&
      !characterBelongsToAccount(characterRecord, sessionUserID)
    ) {
      log.warn(
        `[CharService] Rejected foreign SelectCharacterID(${charId}) for user=${sessionUserID}; ` +
        `character belongs to account=${normalizeAccountID(characterRecord.accountId)}`,
      );
      throwWrappedUserError("CustomInfo", {
        info: "That character is not available on this account.",
      });
    }
    if (characterRecord && isCharacterQueuedForDeletion(characterRecord)) {
      throwWrappedUserError("CustomInfo", {
        info: "That character is queued for deletion and cannot enter the game.",
      });
    }

    const existingSession = sessionRegistry.findSessionByCharacterID(charId, {
      excludeSession: session,
    });
    if (existingSession) {
      const characterRecord = getCharacterRecord(charId);
      const characterLabel =
        (characterRecord && characterRecord.characterName) ||
        existingSession.characterName ||
        `Character ${charId}`;
      log.warn(
        `[CharService] Rejected duplicate login for ${characterLabel}(${charId}); already active on user=${existingSession.userName || "unknown"} client=${existingSession.clientID || 0}`,
      );
      throwWrappedUserError("CustomInfo", {
        info: `${characterLabel} is already online.`,
      });
    }

    const tutorialSkipResult = skipTutorial
      ? markCharacterTutorialSkipped(charId)
      : null;
    const tutorialSnapshot = getCharacterTutorialSnapshot(charId);
    if (
      skipTutorial !== true &&
      tutorialSnapshot.airNpeState === 2 &&
      tutorialSnapshot.revealCompletedStateOnFirstLogin === true
    ) {
      consumeCompletedAirNpeRevealOnFirstLogin(charId);
    }

    const applyResult = applyCharacterToSession(session, charId, {
      emitNotifications: false,
      logSelection: true,
    });

    if (!applyResult.success) {
      log.warn(
        `[CharService] Failed to select character ${charId}: ${applyResult.errorMsg}`,
      );
    } else {
      const restoreStartedAtMs = Date.now();
      if (!session.stationid && !session.stationID) {
        log.info(
          `[CharService] Restoring space session for ${session.characterName || charId} ` +
          `system=${Number(session.solarsystemid2 || session.solarsystemid || 0) || 0}`,
        );
        const restored = restoreSpaceSession(session);
        log.info(
          `[CharService] Space restore ${restored ? "completed" : "skipped"} for ` +
          `${session.characterName || charId} in ${Date.now() - restoreStartedAtMs}ms`,
        );
      }
      const notificationFlushStartedAtMs = Date.now();
      flushCharacterSessionNotificationPlan(
        session,
        applyResult.notificationPlan,
      );
      const notificationFlushElapsedMs = Date.now() - notificationFlushStartedAtMs;
      if (notificationFlushElapsedMs >= 250) {
        log.info(
          `[CharService] Session-change flush for ${session.characterName || charId} ` +
          `took ${notificationFlushElapsedMs}ms`,
        );
      }
      const stationID = Number(session.stationid || session.stationID || 0);
      const structureID = Number(session.structureid || session.structureID || 0);
      const guestBroadcastStartedAtMs = Date.now();
      if (stationID) {
        broadcastStationGuestJoined(session, stationID);
      } else if (structureID) {
        broadcastStructureGuestJoined(session, structureID);
      }
      if (
        tutorialSkipResult &&
        tutorialSkipResult.success &&
        tutorialSkipResult.changed &&
        typeof session.sendNotification === "function"
      ) {
        session.sendNotification("OnAirNpeStateChanged", "clientID", [
          charId,
          tutorialSkipResult.snapshot.airNpeState,
        ]);
      }
      const guestBroadcastElapsedMs = Date.now() - guestBroadcastStartedAtMs;
      if (guestBroadcastElapsedMs >= 250) {
        log.info(
          `[CharService] Guest-list broadcast for ${session.characterName || charId} ` +
          `took ${guestBroadcastElapsedMs}ms`,
        );
      }
    }

    return null;
  }

  Handle_PrepareCharacterForDelete(args, session, kwargs) {
    const charId = resolveCharacterRequestId(args, kwargs, 0);
    const deletePrepareDateTime = prepareCharacterForDelete(
      charId,
      session && session.userid,
    );
    return buildFiletimeLong(deletePrepareDateTime);
  }

  Handle_CancelCharacterDeletePrepare(args, session, kwargs) {
    const charId = resolveCharacterRequestId(args, kwargs, 0);
    cancelCharacterDeletePrepare(charId, session && session.userid);
    return null;
  }

  Handle_DeleteCharacter(args, session, kwargs) {
    const charId = resolveCharacterRequestId(args, kwargs, 0);
    deleteCharacter(charId, session && session.userid);
    return null;
  }

  Handle_GetValidRandomName(args, session) {
    const raceID = readCreationIntArg(args, 0, 0);
    log.debug(`[CharService] GetValidRandomName raceID=${raceID}`);
    return getValidRandomName(raceID);
  }

  Handle_GetQAStarterSystemIDs() {
    const systemIDs = getCharacterCreationQAStarterSystemIDs();
    log.debug(`[CharService] GetQAStarterSystemIDs count=${systemIDs.length}`);
    return systemIDs;
  }

  Handle_ValidateNameEx(args, session) {
    const candidateName = args && args.length > 0 ? args[0] : "";
    const normalizedName = normalizeNameString(candidateName).trim();
    const validationCode = validateCharacterName(normalizedName);
    log.debug(
      `[CharService] ValidateNameEx("${normalizedName}") -> ${validationCode}`,
    );
    return validationCode;
  }

  Handle_GetCharacterLockType(args, session) {
    log.debug("[CharService] GetCharacterLockType");
    return null;
  }
}

CharService._testing = {
  resolveCharacterRequestId,
  resolveCreateCharacterSignature,
};

module.exports = CharService;
