const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const {
  buildDict,
  buildKeyVal,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getKwarg,
  marshalValueToJs,
  toMarshalValue,
} = require("./storeMarshal");
const {
  getFastCheckoutOffers,
  getStoreConfig,
} = require("./storeState");
const {
  purchaseFastCheckoutOffer,
} = require("./storeFulfillment");

function getRawKwarg(kwargs, key) {
  if (!kwargs || kwargs.type !== "dict" || !Array.isArray(kwargs.entries)) {
    return undefined;
  }
  const match = kwargs.entries.find((entry) => String(entry && entry[0]) === String(key));
  return match ? match[1] : undefined;
}

function unwrapNamedValue(value) {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (
    value.type === "object" &&
    value.name === "util.KeyVal" &&
    value.args
  ) {
    return marshalValueToJs(value.args);
  }

  if (value.type === "dict" || value.type === "list") {
    return marshalValueToJs(value);
  }

  if (value.args) {
    return marshalValueToJs(value.args);
  }

  return marshalValueToJs(value);
}

function normalizeFastCheckoutOfferID(rawOffer, fallbackOfferID = 0) {
  const candidate = unwrapNamedValue(rawOffer);
  if (candidate && typeof candidate === "object") {
    if (candidate.id !== undefined && candidate.id !== null) {
      return Number(candidate.id) || fallbackOfferID;
    }
    if (candidate.offerID !== undefined && candidate.offerID !== null) {
      return Number(candidate.offerID) || fallbackOfferID;
    }
  }
  return Number(fallbackOfferID) || 0;
}

function toPositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
}

function normalizeText(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value);
}

function buildFastCheckoutOfferKeyVal(rawOffer = {}) {
  const quantity = toPositiveInteger(rawOffer.quantity, 0);
  const baseQuantity = toPositiveInteger(rawOffer.baseQuantity, quantity);
  const entries = [
    ["id", toPositiveInteger(rawOffer.id, 0)],
    ["offerID", toPositiveInteger(rawOffer.id, 0)],
    ["storeOfferID", normalizeText(rawOffer.storeOfferID, "")],
    ["name", normalizeText(rawOffer.name, `Offer ${rawOffer.id || 0}`)],
    ["price", Number(rawOffer.price) || 0],
    ["currency", normalizeText(rawOffer.currency, "USD")],
    ["quantity", quantity],
    ["baseQuantity", baseQuantity],
    [
      "tags",
      buildList(
        Array.isArray(rawOffer.tags)
          ? rawOffer.tags.map((tag) => normalizeText(tag, "")).filter(Boolean)
          : [],
      ),
    ],
    [
      "imageUrl",
      rawOffer.imageUrl === null || rawOffer.imageUrl === undefined
        ? null
        : normalizeText(rawOffer.imageUrl, ""),
    ],
  ];

  if (rawOffer.savings !== undefined && rawOffer.savings !== null) {
    entries.push(["savings", Number(rawOffer.savings) || 0]);
  }
  if (rawOffer.highlight !== undefined && rawOffer.highlight !== null) {
    entries.push(["highlight", Boolean(rawOffer.highlight)]);
  }

  return buildKeyVal(entries);
}

function buildFastCheckoutOffersPayload() {
  return buildDict([
    [
      "plex",
      buildList(getFastCheckoutOffers().map((offer) => buildFastCheckoutOfferKeyVal(offer))),
    ],
  ]);
}

class FastCheckoutService extends BaseService {
  constructor() {
    super("FastCheckoutService");
  }

  Handle_IsFastCheckoutEnabledForUser() {
    return Boolean(getStoreConfig().fastCheckoutEnabled);
  }

  Handle_ClearFastCheckoutCacheForUser() {
    return true;
  }

  Handle_GetTestingConfiguration() {
    const storeConfig = getStoreConfig();
    return [
      Boolean(storeConfig.fakeChinaFunnelEnabled),
      String(storeConfig.fakeBuyPlexOfferUrl || ""),
      Boolean(storeConfig.useShellExecuteToBuyPlexOffer),
    ];
  }

  Handle_GetOffersForUser() {
    return buildFastCheckoutOffersPayload();
  }

  Handle_BuyOffer(args, session, kwargs) {
    const rawOffer = getRawKwarg(kwargs, "offer");
    const fallbackOfferID = getKwarg(kwargs, "offerID");
    const offerID = normalizeFastCheckoutOfferID(rawOffer, fallbackOfferID);
    const purchaseTraceID = String(getKwarg(kwargs, "purchaseTraceID") || "");
    const journeyID = String(getKwarg(kwargs, "journeyID") || "");
    const characterID = Number(session && session.characterID) || 0;

    if (!characterID) {
      throwWrappedUserError("PurchaseFailed", {});
    }
    if (!offerID) {
      throwWrappedUserError("OfferNotAvailable", {});
    }

    const result = purchaseFastCheckoutOffer({
      offerID,
      characterID,
      purchaseTraceID,
      journeyID,
    });
    if (!result.success) {
      throwWrappedUserError(
        result.errorMsg || "PurchaseFailed",
        {},
      );
    }

    return toMarshalValue(result.data);
  }
}

module.exports = FastCheckoutService;
