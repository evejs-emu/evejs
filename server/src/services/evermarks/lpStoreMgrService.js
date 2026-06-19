const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const {
  buildBoundObjectResponse,
  buildList,
  resolveBoundNodeId,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  HERALDRY_CORPORATION_ID,
  listHeraldryOffersForCharacter,
  takeHeraldryOfferForCharacter,
} = require("./evermarksStore");

const ERROR_MESSAGES = Object.freeze({
  ALREADY_OWNED: "You already own that emblem.",
  CHARACTER_NOT_FOUND: "Character data is unavailable for this purchase.",
  INSUFFICIENT_EVERMARKS: "You do not have enough EverMarks.",
  INSUFFICIENT_ISK: "You do not have enough ISK.",
  INVALID_CHARACTER: "Character data is unavailable for this purchase.",
  INVALID_QUANTITY: "Heraldry offers can only be purchased one at a time.",
  INVALID_STORE: "That LP store is not available.",
  LICENSE_NOT_FOUND: "That Heraldry emblem could not be resolved.",
  OFFER_NOT_FOUND: "That offer is no longer available.",
  REQ_ITEMS_UNSUPPORTED: "That offer requires unsupported extra items.",
});

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
}

function throwStoreError(errorMsg) {
  throwWrappedUserError("CustomNotify", {
    notify:
      ERROR_MESSAGES[String(errorMsg || "").toUpperCase()] ||
      "Heraldry purchase failed.",
  });
}

class LPStoreMgrService extends BaseService {
  constructor() {
    super("LPStoreMgr");
  }

  Handle_MachoResolveObject() {
    log.debug("[LPStoreMgr] MachoResolveObject");
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    log.debug("[LPStoreMgr] MachoBindObject");
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetAvailableOffersFromCorp(args, session) {
    log.debug("[LPStoreMgr] GetAvailableOffersFromCorp");
    const corpID = Array.isArray(args) && args.length > 0
      ? normalizePositiveInteger(args[0], HERALDRY_CORPORATION_ID)
      : HERALDRY_CORPORATION_ID;
    const offers = listHeraldryOffersForCharacter(
      session && session.characterID,
      corpID,
    );
    return buildList(offers);
  }

  Handle_TakeOfferForCharacter(args, session) {
    log.debug("[LPStoreMgr] TakeOfferForCharacter");
    const corpID = Array.isArray(args) && args.length > 0 ? args[0] : HERALDRY_CORPORATION_ID;
    const offerID = Array.isArray(args) && args.length > 1 ? args[1] : 0;
    const numberOfOffers = Array.isArray(args) && args.length > 2 ? args[2] : 1;
    const result = takeHeraldryOfferForCharacter(
      session,
      corpID,
      offerID,
      numberOfOffers,
    );
    if (!result.success) {
      throwStoreError(result.errorMsg);
    }
    return true;
  }

  Handle_TakeOfferForCorporation(args) {
    log.debug("[LPStoreMgr] TakeOfferForCorporation");
    const corpID = Array.isArray(args) && args.length > 0
      ? normalizePositiveInteger(args[0], 0)
      : 0;
    if (corpID === HERALDRY_CORPORATION_ID) {
      throwStoreError("INVALID_STORE");
    }
    return null;
  }
}

module.exports = LPStoreMgrService;
