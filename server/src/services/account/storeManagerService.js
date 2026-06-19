const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getKwarg,
  toMarshalValue,
} = require(path.join(__dirname, "../newEdenStore/storeMarshal"));
const {
  getLegacyCatalog,
} = require(path.join(__dirname, "../newEdenStore/storeState"));
const {
  purchaseLegacyOffer,
} = require(path.join(__dirname, "../newEdenStore/storeFulfillment"));

const STORE_ID_INGAME = 4;

function toPositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
}

class StoreManagerService extends BaseService {
  constructor() {
    super("storeManager");
  }

  Handle_get_offers(args) {
    const storeID = toPositiveInteger(args && args[0], STORE_ID_INGAME);
    const catalog = getLegacyCatalog(storeID);
    log.info(
      `[StoreManager] get_offers store_id=${storeID} count=${catalog.offers.length}`,
    );
    return toMarshalValue(catalog.offers);
  }

  Handle_get_categories(args) {
    const storeID = toPositiveInteger(args && args[0], STORE_ID_INGAME);
    const catalog = getLegacyCatalog(storeID);
    log.info(
      `[StoreManager] get_categories store_id=${storeID} count=${catalog.categories.length}`,
    );
    return toMarshalValue(catalog.categories);
  }

  Handle_get_products(args) {
    const storeID = toPositiveInteger(args && args[0], STORE_ID_INGAME);
    const catalog = getLegacyCatalog(storeID);
    log.info(
      `[StoreManager] get_products store_id=${storeID} count=${catalog.products.length}`,
    );
    return toMarshalValue(catalog.products);
  }

  Handle_buy_offer(args, session, kwargs) {
    const offerID = toPositiveInteger(args && args[0], 0);
    const currency = String(args && args[1] ? args[1] : "PLX").toUpperCase();
    const quantity = Math.max(1, Math.trunc(Number(args && args[2]) || 1));
    const storeID = toPositiveInteger(getKwarg(kwargs, "store_id"), STORE_ID_INGAME);
    const payerCharacterID = toPositiveInteger(
      getKwarg(kwargs, "from_character_id"),
      toPositiveInteger(session && (session.characterID || session.charid), 0),
    );
    const targetCharacterID = toPositiveInteger(getKwarg(kwargs, "to_character_id"), 0);
    const accountID = toPositiveInteger(
      session && (session.userid || session.userID),
      0,
    );

    const result = purchaseLegacyOffer({
      storeID,
      offerID,
      currency,
      quantity,
      characterID: payerCharacterID,
      targetCharacterID,
      accountID,
      session,
    });
    if (!result.success) {
      log.warn(
        `[StoreManager] buy_offer rejected offer_id=${offerID} store_id=${storeID} ` +
          `currency=${currency} quantity=${quantity} payer=${payerCharacterID} ` +
          `target=${targetCharacterID} account=${accountID} error=${result.errorMsg}`,
      );
      return null;
    }

    const responsePayload = {
      success: true,
      offer_id: Number(result.data.offer_id || offerID),
      store_offer_id: result.data.store_offer_id || null,
      quantity: Number(result.data.quantity || quantity),
      currency,
      spent: Number(result.data.spent || 0),
      balance: Number(result.data.balance || 0),
      payer_character_id: Number(result.data.payerCharacterID || 0),
      character_id: Number(result.data.characterID || 0),
    };

    log.info(
      `[StoreManager] buy_offer payer=${responsePayload.payer_character_id} ` +
        `target=${responsePayload.character_id} offer_id=${offerID} ` +
        `store_id=${storeID} quantity=${quantity} currency=${currency}`,
    );
    return toMarshalValue(responsePayload);
  }

  Handle_GetOffers(args, session, kwargs) {
    return this.Handle_get_offers(args, session, kwargs);
  }

  Handle_GetCategories(args, session, kwargs) {
    return this.Handle_get_categories(args, session, kwargs);
  }

  Handle_GetProducts(args, session, kwargs) {
    return this.Handle_get_products(args, session, kwargs);
  }

  Handle_BuyOffer(args, session, kwargs) {
    return this.Handle_buy_offer(args, session, kwargs);
  }
}

module.exports = StoreManagerService;
