const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(__dirname, "./characterState"));
const {
  storeCharacterPortrait,
} = require(path.join(__dirname, "./portraitImageStore"));

function toNumber(value, fallback = 0) {
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")) {
    return toNumber(value.value, fallback);
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizePhotoBytes(value) {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (typeof value === "string") {
    return Buffer.from(value, "binary");
  }

  return Buffer.alloc(0);
}

function resolveUploadPayload(args = [], session = null) {
  if (args.length >= 2) {
    return {
      charId: toNumber(args[0], 0),
      photoBytes: normalizePhotoBytes(args[1]),
    };
  }

  return {
    charId: toNumber(session ? session.charid || session.characterID : 0, 0),
    photoBytes: normalizePhotoBytes(args[0]),
  };
}

class PhotoUploadService extends BaseService {
  constructor() {
    super("photoUploadSvc");
  }

  Handle_Upload(args, session) {
    const { charId, photoBytes } = resolveUploadPayload(args, session);
    if (charId <= 0 || photoBytes.length === 0) {
      log.warn(
        `[PhotoUploadSvc] Rejected upload with invalid payload char=${charId} bytes=${photoBytes.length}`,
      );
      return false;
    }

    const characterRecord = getCharacterRecord(charId);
    if (!characterRecord) {
      log.warn(`[PhotoUploadSvc] Upload target missing for char=${charId}`);
      return false;
    }

    if (Number(characterRecord.accountId || 0) !== Number(session ? session.userid : 0)) {
      log.warn(
        `[PhotoUploadSvc] Rejected portrait upload for char=${charId} user=${session ? session.userid : 0}`,
      );
      return false;
    }

    const storeResult = storeCharacterPortrait(charId, photoBytes);
    if (!storeResult.success) {
      log.warn(
        `[PhotoUploadSvc] Failed to store portrait for char=${charId}: ${storeResult.errorMsg}`,
      );
      return false;
    }

    updateCharacterRecord(charId, (record) => ({
      ...record,
      portraitUploadedAt: new Date().toISOString(),
      portraitByteLength: photoBytes.length,
      portraitSizes: [...storeResult.data.sizes],
    }));

    log.info(
      `[PhotoUploadSvc] Stored portrait for char=${charId} bytes=${photoBytes.length} sizes=${storeResult.data.sizes.join(",")}`,
    );

    return true;
  }
}

module.exports = PhotoUploadService;
