const path = require("path");

const {
  buildKeyVal,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getCharacterWallet,
  adjustCharacterBalance,
} = require(path.join(__dirname, "../account/walletState"));
const {
  EVERMARK_ISSUER_CORP_ID,
  getCharacterWalletLPBalance,
  adjustCharacterWalletLPBalance,
} = require(path.join(__dirname, "../corporation/lpWalletState"));
const {
  HERALDRY_CORPORATION_ID,
} = require("./evermarksConstants");
const {
  getHeraldryOfferByID,
  listAllHeraldryOffers,
} = require("./evermarksCatalog");
const {
  getOwnedShipLogoEntitlementByTypeID,
  grantShipLogoEntitlementByTypeID,
} = require("./evermarksEntitlements");
const {
  publishShipLogoGrantedNotice,
} = require("./evermarksNotices");

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(0, Math.trunc(Number(fallback) || 0));
  }
  return Math.max(0, Math.trunc(numeric));
}

function buildRequirementPairs(pairs = []) {
  return buildList(
    (Array.isArray(pairs) ? pairs : []).map((entry) =>
      buildList([
        normalizePositiveInteger(entry && entry[0], 0),
        normalizeNonNegativeInteger(entry && entry[1], 0),
      ]),
    ),
  );
}

function buildOfferKeyVal(offer, characterID = 0) {
  const safeOffer = offer && typeof offer === "object" ? offer : {};
  const typeID = normalizePositiveInteger(safeOffer.typeID, 0);
  void characterID;
  void typeID;

  return buildKeyVal([
    ["offerID", normalizePositiveInteger(safeOffer.offerID, 0)],
    ["corpID", normalizePositiveInteger(safeOffer.corpID, HERALDRY_CORPORATION_ID)],
    ["typeID", normalizePositiveInteger(safeOffer.typeID, 0)],
    ["qty", normalizePositiveInteger(safeOffer.qty, 1)],
    ["lpCost", normalizeNonNegativeInteger(safeOffer.lpCost, 0)],
    ["iskCost", normalizeNonNegativeInteger(safeOffer.iskCost, 0)],
    ["akCost", normalizeNonNegativeInteger(safeOffer.akCost, 0)],
    ["reqItems", buildRequirementPairs(safeOffer.reqItems)],
    ["requiredStandings", safeOffer.requiredStandings || null],
  ]);
}

function listHeraldryOffersForCharacter(characterID, corpID = HERALDRY_CORPORATION_ID) {
  const numericCorpID = normalizePositiveInteger(corpID, HERALDRY_CORPORATION_ID);
  if (numericCorpID !== HERALDRY_CORPORATION_ID) {
    return [];
  }

  const numericCharacterID = normalizePositiveInteger(characterID, 0);
  return listAllHeraldryOffers().map((offer) =>
    buildOfferKeyVal(offer, numericCharacterID),
  );
}

function debitCharacterOfferCosts(characterID, offer, options = {}) {
  const numericCharacterID = normalizePositiveInteger(characterID, 0);
  const safeOffer = offer && typeof offer === "object" ? offer : {};
  const lpCost = normalizeNonNegativeInteger(safeOffer.lpCost, 0);
  const iskCost = normalizeNonNegativeInteger(safeOffer.iskCost, 0);

  if (!numericCharacterID) {
    return {
      success: false,
      errorMsg: "INVALID_CHARACTER",
    };
  }

  const currentEvermarks = getCharacterWalletLPBalance(
    numericCharacterID,
    HERALDRY_CORPORATION_ID,
  );
  if (currentEvermarks < lpCost) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_EVERMARKS",
    };
  }

  const currentWallet = getCharacterWallet(numericCharacterID);
  if (!currentWallet) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }
  if (Number(currentWallet.balance || 0) < iskCost) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_ISK",
    };
  }

  if (lpCost > 0) {
    const lpResult = adjustCharacterWalletLPBalance(
      numericCharacterID,
      HERALDRY_CORPORATION_ID,
      -lpCost,
      {
        changeType: options.lpChangeType || "lp_store_purchase",
      },
    );
    if (!lpResult.success) {
      return lpResult;
    }
  }

  if (iskCost > 0) {
    const iskResult = adjustCharacterBalance(
      numericCharacterID,
      -iskCost,
      {
        description: options.iskDescription || "Heraldry offer purchase",
      },
    );
    if (!iskResult.success) {
      if (lpCost > 0) {
        adjustCharacterWalletLPBalance(
          numericCharacterID,
          HERALDRY_CORPORATION_ID,
          lpCost,
          {
            changeType: "lp_store_purchase_rollback",
          },
        );
      }
      return iskResult;
    }
  }

  return {
    success: true,
    data: {
      lpCost,
      iskCost,
    },
  };
}

function refundCharacterOfferCosts(characterID, offer) {
  const numericCharacterID = normalizePositiveInteger(characterID, 0);
  const safeOffer = offer && typeof offer === "object" ? offer : {};
  const lpCost = normalizeNonNegativeInteger(safeOffer.lpCost, 0);
  const iskCost = normalizeNonNegativeInteger(safeOffer.iskCost, 0);

  if (!numericCharacterID) {
    return false;
  }

  if (lpCost > 0) {
    adjustCharacterWalletLPBalance(
      numericCharacterID,
      HERALDRY_CORPORATION_ID,
      lpCost,
      {
        changeType: "lp_store_purchase_rollback",
      },
    );
  }

  if (iskCost > 0) {
    adjustCharacterBalance(
      numericCharacterID,
      iskCost,
      {
        description: "Heraldry offer purchase rollback",
      },
    );
  }

  return true;
}

function takeHeraldryOfferForCharacter(session, corpID, offerID, numberOfOffers = 1) {
  const numericCharacterID = normalizePositiveInteger(
    session && session.characterID,
    0,
  );
  const numericCorpID = normalizePositiveInteger(corpID, HERALDRY_CORPORATION_ID);
  const numericOfferID = normalizePositiveInteger(offerID, 0);
  const numericNumberOfOffers = normalizePositiveInteger(numberOfOffers, 1);

  if (!numericCharacterID) {
    return {
      success: false,
      errorMsg: "INVALID_CHARACTER",
    };
  }
  if (numericCorpID !== HERALDRY_CORPORATION_ID) {
    return {
      success: false,
      errorMsg: "INVALID_STORE",
    };
  }
  if (numericNumberOfOffers !== 1) {
    return {
      success: false,
      errorMsg: "INVALID_QUANTITY",
    };
  }

  const offer = getHeraldryOfferByID(numericOfferID);
  if (!offer || normalizePositiveInteger(offer.corpID, 0) !== numericCorpID) {
    return {
      success: false,
      errorMsg: "OFFER_NOT_FOUND",
    };
  }
  if (Array.isArray(offer.reqItems) && offer.reqItems.length > 0) {
    return {
      success: false,
      errorMsg: "REQ_ITEMS_UNSUPPORTED",
    };
  }
  if (getOwnedShipLogoEntitlementByTypeID(numericCharacterID, offer.typeID)) {
    return {
      success: false,
      errorMsg: "ALREADY_OWNED",
    };
  }

  const debitResult = debitCharacterOfferCosts(numericCharacterID, offer);
  if (!debitResult.success) {
    return debitResult;
  }

  const grantResult = grantShipLogoEntitlementByTypeID(
    numericCharacterID,
    offer.typeID,
    {
      source: "lp_store_purchase",
      offerID: offer.offerID,
    },
  );
  if (!grantResult.success) {
    refundCharacterOfferCosts(numericCharacterID, offer);
    return grantResult;
  }

  if (!grantResult.alreadyOwned) {
    publishShipLogoGrantedNotice(grantResult.data);
  }

  return {
    success: true,
    data: {
      offer,
      entitlement: grantResult.data,
      costs: debitResult.data,
    },
  };
}

module.exports = {
  EVERMARK_ISSUER_CORP_ID,
  HERALDRY_CORPORATION_ID,
  buildOfferKeyVal,
  listHeraldryOffersForCharacter,
  takeHeraldryOfferForCharacter,
};
