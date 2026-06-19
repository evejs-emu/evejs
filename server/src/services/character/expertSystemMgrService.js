const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildExpertSystemsPayload,
} = require(path.join(
  __dirname,
  "../skills/expertSystems/expertSystemSerializer",
));
const {
  consumeExpertSystemItem,
  removeExpertSystemFromCharacter,
} = require(path.join(
  __dirname,
  "../skills/expertSystems/expertSystemRuntime",
));

function resolveSessionCharacterID(session) {
  return Number(
    session &&
      (session.characterID || session.charID || session.charid || session.userid),
  ) || 0;
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

function normalizePositiveInteger(value, fallback = 0) {
  const numericValue = Number(unwrapValue(value));
  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : fallback;
}

class ExpertSystemMgrService extends BaseService {
  constructor() {
    super("expertSystemMgr");
  }

  Handle_GetMyExpertSystems(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const payload = buildExpertSystemsPayload(characterID);
    log.debug(
      `[ExpertSystemMgr] GetMyExpertSystems(charID=${characterID}) -> ${
        payload && Array.isArray(payload.entries) ? payload.entries.length : 0
      }`,
    );
    return payload;
  }

  Handle_ConsumeExpertSystem(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const itemID = normalizePositiveInteger(args && args[0]);
    log.debug(
      `[ExpertSystemMgr] ConsumeExpertSystem(charID=${characterID}, itemID=${itemID})`,
    );
    consumeExpertSystemItem(characterID, itemID, session, { throwOnError: true });
    return null;
  }

  Handle_RemoveMyExpertSystem(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const expertSystemTypeID = normalizePositiveInteger(args && args[0]);
    log.debug(
      `[ExpertSystemMgr] RemoveMyExpertSystem(charID=${characterID}, typeID=${expertSystemTypeID})`,
    );
    removeExpertSystemFromCharacter(characterID, expertSystemTypeID, {
      session,
      throwOnError: true,
    });
    return null;
  }
}

module.exports = ExpertSystemMgrService;
