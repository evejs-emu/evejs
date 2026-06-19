const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(__dirname, "./characterState"));
const {
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  clonePaperDollPayload,
  getStoredAppearanceInfo,
  getStoredPortraitInfo,
} = require(path.join(__dirname, "./paperDollPayloads"));

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "bigint") {
    return value !== 0n;
  }

  if (typeof value === "string") {
    if (value === "true" || value === "1") {
      return true;
    }
    if (value === "false" || value === "0" || value === "") {
      return false;
    }
  }

  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")) {
    return normalizeBoolean(value.value, fallback);
  }

  return fallback;
}

function isOwnedCharacter(charId, session) {
  const characterRecord = getCharacterRecord(charId);
  if (!characterRecord) {
    return false;
  }

  if (!session || !session.userid) {
    return false;
  }

  return Number(characterRecord.accountId || 0) === Number(session.userid || 0);
}

function buildPortraitPayloadTuple(record) {
  const portraitInfo = getStoredPortraitInfo(record);
  return [
    buildList(portraitInfo ? [portraitInfo] : []),
    null,
  ];
}

function persistPaperDollCharacter(charId, appearanceInfo, portraitInfo, dollExists) {
  return updateCharacterRecord(charId, (record) => {
    const nextRecord = {
      ...record,
    };
    const hasAppearanceInput = appearanceInfo !== null && appearanceInfo !== undefined;
    const hasPortraitInput = portraitInfo !== null && portraitInfo !== undefined;

    if (hasAppearanceInput || dollExists === false) {
      nextRecord.appearanceInfo = hasAppearanceInput ? appearanceInfo : null;
    }

    if (hasPortraitInput || dollExists === false) {
      nextRecord.portraitInfo = hasPortraitInput ? portraitInfo : null;
    }

    nextRecord.paperDollState =
      hasAppearanceInput || dollExists ? 0 : 2;

    return nextRecord;
  });
}

class PaperDollServerService extends BaseService {
  constructor() {
    super("paperDollServer");
  }

  Handle_GetPaperDollData(args, session) {
    const charId = normalizeNumber(
      args && args.length > 0 ? args[0] : session ? session.charid : 0,
      0,
    );
    log.debug(`[PaperDollServer] GetPaperDollData(${charId})`);
    const record = getCharacterRecord(charId);
    return getStoredAppearanceInfo(record);
  }

  Handle_GetMyPaperDollData(args, session) {
    const charId = normalizeNumber(session ? session.charid : 0, 0);
    log.debug(`[PaperDollServer] GetMyPaperDollData(${charId})`);
    const record = getCharacterRecord(charId);
    return getStoredAppearanceInfo(record);
  }

  Handle_ConvertAndSavePaperDoll(args, session) {
    log.debug("[PaperDollServer] ConvertAndSavePaperDoll");
    return null;
  }

  Handle_GetPaperDollPortraitDataFor(args, session) {
    const charId = normalizeNumber(
      args && args.length > 0 ? args[0] : session ? session.charid : 0,
      0,
    );
    log.debug(`[PaperDollServer] GetPaperDollPortraitDataFor(${charId})`);
    const record = getCharacterRecord(charId);
    return buildPortraitPayloadTuple(record);
  }

  Handle_UpdateExistingCharacterFull(args, session, kwargs) {
    const charId = normalizeNumber(args && args.length > 0 ? args[0] : 0, 0);
    if (!isOwnedCharacter(charId, session)) {
      log.warn(
        `[PaperDollServer] UpdateExistingCharacterFull rejected for char=${charId}`,
      );
      return null;
    }

    const appearanceInfo = clonePaperDollPayload(args && args.length > 1 ? args[1] : null);
    const portraitInfo = clonePaperDollPayload(args && args.length > 2 ? args[2] : null);
    const dollExists = normalizeBoolean(args && args.length > 3 ? args[3] : true, true);

    log.info(
      `[PaperDollServer] UpdateExistingCharacterFull(${charId}) dollExists=${dollExists}`,
    );
    const updateResult = persistPaperDollCharacter(
      charId,
      appearanceInfo,
      portraitInfo,
      dollExists,
    );
    if (!updateResult.success) {
      log.warn(
        `[PaperDollServer] UpdateExistingCharacterFull failed for ${charId}: ${updateResult.errorMsg}`,
      );
    }

    return null;
  }

  Handle_UpdateExistingCharacterLimited(args, session, kwargs) {
    const charId = normalizeNumber(args && args.length > 0 ? args[0] : 0, 0);
    if (!isOwnedCharacter(charId, session)) {
      log.warn(
        `[PaperDollServer] UpdateExistingCharacterLimited rejected for char=${charId}`,
      );
      return null;
    }

    const appearanceInfo = clonePaperDollPayload(args && args.length > 1 ? args[1] : null);
    const portraitInfo = clonePaperDollPayload(args && args.length > 2 ? args[2] : null);
    const dollExists = normalizeBoolean(args && args.length > 3 ? args[3] : true, true);

    log.info(
      `[PaperDollServer] UpdateExistingCharacterLimited(${charId}) dollExists=${dollExists}`,
    );
    const updateResult = persistPaperDollCharacter(
      charId,
      appearanceInfo,
      portraitInfo,
      dollExists,
    );
    if (!updateResult.success) {
      log.warn(
        `[PaperDollServer] UpdateExistingCharacterLimited failed for ${charId}: ${updateResult.errorMsg}`,
      );
    }

    return null;
  }
}

module.exports = PaperDollServerService;
