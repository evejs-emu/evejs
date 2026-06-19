const path = require("path");

const {
  bufferFromBytes,
  encodePayload,
  getActiveCharacterID,
} = require("./gatewayServiceHelpers");
const {
  buildNewEdenStoreGatewayProtoRoot,
} = require(path.join(
  __dirname,
  "../../../services/newEdenStore/storeGatewayProto",
));
const {
  findPublicOffer,
  getFastCheckoutOffers,
  findQuickPayToken,
  getQuickPayTokens,
  getStoreConfig,
  resolveStoreCharacterID,
} = require(path.join(
  __dirname,
  "../../../services/newEdenStore/storeState",
));
const sessionRegistry = require(path.join(
  __dirname,
  "../../../services/chat/sessionRegistry",
));

const HANDLED_REQUEST_TYPES = Object.freeze([
  "eve_public.payment.token.api.GetQuickPayRequest",
  "eve_public.payment.token.api.GetRequest",
  "eve_public.payment.token.api.DisableAllRequest",
  "eve_public.payment.purchase.api.CostRequest",
  "eve_public.payment.purchase.api.TokenRequest",
  "eve_public.plex.vault.api.PurchaseRequest",
]);

function toPositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
}

function decodePayload(messageType, requestEnvelope) {
  return messageType.decode(
    bufferFromBytes(
      requestEnvelope &&
        requestEnvelope.payload &&
        requestEnvelope.payload.value,
    ),
  );
}

function getCorrelationSuffix(requestEnvelope) {
  const correlationBytes = bufferFromBytes(
    requestEnvelope && requestEnvelope.correlation_uuid,
  );
  if (correlationBytes.length === 0) {
    return "none";
  }
  return correlationBytes.toString("hex");
}

function resolveStoreOfferID(order) {
  return String(
    order &&
      order.offer &&
      order.offer.store_offer
      ? order.offer.store_offer
      : "",
  ).trim();
}

function resolveCashOfferForTokenPurchase(order) {
  const explicitStoreOfferID = resolveStoreOfferID(order);
  if (explicitStoreOfferID) {
    const explicitOffer =
      findPublicOffer(explicitStoreOfferID) ||
      findPublicOffer(String(explicitStoreOfferID).trim().toLowerCase()) ||
      null;
    if (explicitOffer) {
      return explicitOffer;
    }

    const fastCheckoutMatch = getFastCheckoutOffers().find((offer) => {
      const offerID = String(
        Math.trunc(Number(offer && (offer.id || offer.offerID) || 0)),
      );
      return (
        offerID === explicitStoreOfferID ||
        String(offer && offer.storeOfferID || "").trim() === explicitStoreOfferID
      );
    });
    if (fastCheckoutMatch && fastCheckoutMatch.storeOfferID) {
      const mappedOffer = findPublicOffer(fastCheckoutMatch.storeOfferID);
      if (mappedOffer) {
        return mappedOffer;
      }
    }
  }

  const normalizedQuantity = Math.max(
    1,
    Math.trunc(Number(order && order.quantity) || 1),
  );
  const normalizedCostInCents = Math.max(
    0,
    Math.trunc(
      Number(
        order &&
          order.cost &&
          order.cost.catalog_amount_in_cents,
      ) || 0,
    ),
  );
  const normalizedCurrency = String(
    order && order.cost && order.cost.currency
      ? order.cost.currency
      : "USD",
  )
    .trim()
    .toUpperCase();

  if (!normalizedCostInCents) {
    return null;
  }

  const fastCheckoutMatch = getFastCheckoutOffers().find((offer) => {
    const priceInCents = Math.max(
      0,
      Math.trunc(Number(offer && offer.price) * 100 || 0),
    );
    const offerCurrency = String(offer && offer.currency ? offer.currency : "USD")
      .trim()
      .toUpperCase();
    return (
      priceInCents === normalizedCostInCents &&
      offerCurrency === normalizedCurrency &&
      Math.max(1, Math.trunc(Number(offer && offer.quantity) || 1)) >= normalizedQuantity
    );
  });
  if (fastCheckoutMatch && fastCheckoutMatch.storeOfferID) {
    return findPublicOffer(fastCheckoutMatch.storeOfferID);
  }

  return null;
}

function computeCostPayload(catalogAmountInCents, currencyCode) {
  const storeConfig = getStoreConfig();
  const catalogAmount = Math.max(0, Math.trunc(Number(catalogAmountInCents || 0)));
  const taxRatePoints = Math.max(
    0,
    Math.trunc(Number(storeConfig.defaultCashTaxRatePoints || 0)),
  );
  const taxAmount = Math.trunc(catalogAmount * taxRatePoints / 10000);
  return {
    catalog_amount_in_cents: catalogAmount,
    tax_amount_in_cents: taxAmount,
    total_amount_in_cents: catalogAmount + taxAmount,
    tax_rate_points: taxRatePoints,
    currency: String(currencyCode || "USD"),
  };
}

function resolvePlexVaultTargetCharacterID(activeCharacterID, decodedRequest) {
  const giftCharacterID = toPositiveInteger(
    decodedRequest &&
      decodedRequest.gift &&
      decodedRequest.gift.character &&
      decodedRequest.gift.character.sequential,
    0,
  );
  return giftCharacterID || activeCharacterID;
}

function resolveLiveGatewayUserID() {
  const liveUserIDs = [...new Set(
    sessionRegistry
      .getSessions()
      .map((session) => toPositiveInteger(session && (session.userid || session.userID), 0))
      .filter((userID) => userID > 0),
  )];
  return liveUserIDs.length === 1 ? liveUserIDs[0] : 0;
}

function resolveGatewayCashCharacterID(requestEnvelope) {
  const activeCharacterID = getActiveCharacterID(requestEnvelope);
  if (activeCharacterID > 0) {
    return activeCharacterID;
  }

  const liveCharacterIDs = [...new Set(
    sessionRegistry
      .getSessions()
      .map((session) =>
        toPositiveInteger(
          session &&
            (session.characterID ||
              session.charid ||
              session.charID ||
              session.characterId),
          0,
        ),
      )
      .filter((characterID) => characterID > 0),
  )];
  if (liveCharacterIDs.length === 1) {
    return liveCharacterIDs[0];
  }

  const liveUserID = resolveLiveGatewayUserID();
  return liveUserID ? resolveStoreCharacterID(0, liveUserID) : 0;
}

function getStoreFulfillment() {
  return require(path.join(
    __dirname,
    "../../../services/newEdenStore/storeFulfillment",
  ));
}

function createNewEdenStoreGatewayService() {
  const protoRoot = buildNewEdenStoreGatewayProtoRoot();
  const types = {
    tokenGetRequest: protoRoot.lookupType("eve_public.payment.token.api.GetRequest"),
    tokenGetResponse: protoRoot.lookupType("eve_public.payment.token.api.GetResponse"),
    tokenGetQuickPayResponse: protoRoot.lookupType(
      "eve_public.payment.token.api.GetQuickPayResponse",
    ),
    tokenDisableAllResponse: protoRoot.lookupType(
      "eve_public.payment.token.api.DisableAllResponse",
    ),
    purchaseCostRequest: protoRoot.lookupType(
      "eve_public.payment.purchase.api.CostRequest",
    ),
    purchaseCostResponse: protoRoot.lookupType(
      "eve_public.payment.purchase.api.CostResponse",
    ),
    purchaseTokenRequest: protoRoot.lookupType(
      "eve_public.payment.purchase.api.TokenRequest",
    ),
    purchaseTokenResponse: protoRoot.lookupType(
      "eve_public.payment.purchase.api.TokenResponse",
    ),
    plexVaultPurchaseRequest: protoRoot.lookupType(
      "eve_public.plex.vault.api.PurchaseRequest",
    ),
    plexVaultPurchaseResponse: protoRoot.lookupType(
      "eve_public.plex.vault.api.PurchaseResponse",
    ),
  };

  return {
    name: "new-eden-store",
    handledRequestTypes: HANDLED_REQUEST_TYPES,
    handleRequest(requestTypeName, requestEnvelope) {
      if (!HANDLED_REQUEST_TYPES.includes(requestTypeName)) {
        return null;
      }

      if (requestTypeName === "eve_public.payment.token.api.GetQuickPayRequest") {
        const tokens = Object.values(getQuickPayTokens())
          .map((token) => ({
            sequential: toPositiveInteger(token && token.tokenID, 0),
          }))
          .filter((token) => token.sequential > 0);
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.payment.token.api.GetQuickPayResponse",
          responsePayloadBuffer: encodePayload(types.tokenGetQuickPayResponse, {
            tokens,
          }),
        };
      }

      if (requestTypeName === "eve_public.payment.token.api.GetRequest") {
        const decoded = decodePayload(types.tokenGetRequest, requestEnvelope);
        const tokenID = toPositiveInteger(
          decoded && decoded.token && decoded.token.sequential,
          0,
        );
        const token = findQuickPayToken(tokenID);
        if (!token) {
          return {
            statusCode: 404,
            statusMessage: "",
            responseTypeName: "eve_public.payment.token.api.GetResponse",
            responsePayloadBuffer: Buffer.alloc(0),
          };
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.payment.token.api.GetResponse",
          responsePayloadBuffer: encodePayload(types.tokenGetResponse, {
            token: {
              credit_card:
                token.creditCard && typeof token.creditCard === "object"
                  ? {
                      alias: String(token.creditCard.alias || ""),
                      expiry: String(token.creditCard.expiry || ""),
                    }
                  : undefined,
              paypal:
                token.payPal && typeof token.payPal === "object"
                  ? {
                      agreement_id: String(token.payPal.agreementID || ""),
                    }
                  : undefined,
            },
          }),
        };
      }

      if (requestTypeName === "eve_public.payment.token.api.DisableAllRequest") {
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.payment.token.api.DisableAllResponse",
          responsePayloadBuffer: encodePayload(types.tokenDisableAllResponse, {}),
        };
      }

      if (requestTypeName === "eve_public.payment.purchase.api.CostRequest") {
        const decoded = decodePayload(types.purchaseCostRequest, requestEnvelope);
        const cost = computeCostPayload(
          decoded && decoded.catalog_amount_in_cents,
          decoded && decoded.currency,
        );
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.payment.purchase.api.CostResponse",
          responsePayloadBuffer: encodePayload(types.purchaseCostResponse, {
            cost,
          }),
        };
      }

      if (requestTypeName === "eve_public.payment.purchase.api.TokenRequest") {
        const decoded = decodePayload(types.purchaseTokenRequest, requestEnvelope);
        const activeCharacterID = resolveGatewayCashCharacterID(requestEnvelope);
        const quantity = Math.max(
          1,
          Math.trunc(Number(decoded && decoded.order && decoded.order.quantity) || 1),
        );
        const tokenID = toPositiveInteger(
          decoded && decoded.token && decoded.token.sequential,
          0,
        );
        const publicOffer = resolveCashOfferForTokenPurchase(decoded && decoded.order);
        if (!publicOffer) {
          return {
            statusCode: 404,
            statusMessage: "",
            responseTypeName: "eve_public.payment.purchase.api.TokenResponse",
            responsePayloadBuffer: Buffer.alloc(0),
          };
        }
        const resolvedTokenID =
          tokenID && findQuickPayToken(tokenID) ? tokenID : 0;

        const result = getStoreFulfillment().purchasePublicCashOffer({
          storeOfferID: publicOffer.storeOfferID,
          characterID: activeCharacterID,
          quantity,
          paymentMethod: resolvedTokenID ? 11 : 1,
          purchaseKeySuffix: getCorrelationSuffix(requestEnvelope),
        });
        if (!result.success) {
          return {
            statusCode: 403,
            statusMessage: "",
            responseTypeName: "eve_public.payment.purchase.api.TokenResponse",
            responsePayloadBuffer: Buffer.alloc(0),
          };
        }

        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.payment.purchase.api.TokenResponse",
          responsePayloadBuffer: encodePayload(types.purchaseTokenResponse, {
            receipt: result.data.receipt,
          }),
        };
      }

      const decoded = decodePayload(types.plexVaultPurchaseRequest, requestEnvelope);
      const activeCharacterID = getActiveCharacterID(requestEnvelope);
      const targetCharacterID = resolvePlexVaultTargetCharacterID(
        activeCharacterID,
        decoded,
      );
      const storeOfferID = resolveStoreOfferID(decoded);
      const quantity = Math.max(
        1,
        Math.trunc(Number(decoded && decoded.quantity) || 1),
      );
      const result = getStoreFulfillment().purchasePlexVaultOffer({
        storeOfferID,
        characterID: targetCharacterID,
        quantity,
        purchaseKeySuffix: getCorrelationSuffix(requestEnvelope),
      });
      if (!result.success) {
        return {
          statusCode: result.errorMsg === "INSUFFICIENT_FUNDS" ? 402 : 404,
          statusMessage: "",
          responseTypeName: "eve_public.plex.vault.api.PurchaseResponse",
          responsePayloadBuffer: Buffer.alloc(0),
        };
      }

      return {
        statusCode: 200,
        statusMessage: "",
        responseTypeName: "eve_public.plex.vault.api.PurchaseResponse",
        responsePayloadBuffer: encodePayload(types.plexVaultPurchaseResponse, {}),
      };
    },
  };
}

module.exports = {
  createNewEdenStoreGatewayService,
};
