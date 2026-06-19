const path = require("path");

const sessionRegistry = require(path.join(
  __dirname,
  "../chat/sessionRegistry",
));
const {
  adjustCharacterPlexBalance,
  getCharacterWallet,
} = require(path.join(__dirname, "../account/walletState"));
const {
  PLEX_LOG_CATEGORY,
} = require(path.join(__dirname, "../account/plexVaultLogState"));
const {
  getCharacterRecord,
  giveItemToHangarForSession,
  resolveHomeStationInfo,
  updateCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));
const {
  grantItemToCharacterStationHangar,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  findFastCheckoutOffer,
  findLegacyOffer,
  findPublicOffer,
  getCompletedPurchase,
  getStoreConfig,
  grantMctDaysToAccount,
  grantOmegaDaysToAccount,
  markPurchaseCompleted,
  appendPurchaseLog,
  resolveCharacterAccountID,
  resolveStoreCharacterID,
} = require("./storeState");

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInteger(value, fallback = 0) {
  const numeric = toNumber(value, fallback);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
}

function buildPurchaseKey(parts = []) {
  return parts
    .map((part) => String(part === undefined || part === null ? "" : part).trim())
    .join("::");
}

function buildRequestScopedSuffix(value) {
  const normalized = String(value || "").trim();
  return normalized || String(Date.now());
}

function findLiveSession(characterID) {
  return sessionRegistry.findSessionByCharacterID(characterID) || null;
}

function resolveLegacyPurchaseCharacters({
  payerCharacterID = 0,
  targetCharacterID = 0,
  accountID = 0,
  session = null,
} = {}) {
  const normalizedAccountID = toPositiveInteger(
    accountID,
    toPositiveInteger(session && (session.userid || session.userID), 0),
  );
  const sessionCharacterID = toPositiveInteger(
    session && (session.characterID || session.charid),
    0,
  );
  const resolvedPayerCharacterID = resolveStoreCharacterID(
    payerCharacterID || sessionCharacterID,
    normalizedAccountID,
  );
  const resolvedTargetCharacterID = resolveStoreCharacterID(
    targetCharacterID || resolvedPayerCharacterID,
    normalizedAccountID,
  ) || resolvedPayerCharacterID;

  return {
    payerCharacterID: resolvedPayerCharacterID,
    targetCharacterID: resolvedTargetCharacterID,
    accountID: normalizedAccountID,
  };
}

function resolveDeliveryLocationID(characterID) {
  const characterRecord = getCharacterRecord(characterID);
  if (!characterRecord) {
    return 60003760;
  }
  if (characterRecord.structureID) {
    return Number(characterRecord.structureID);
  }
  if (characterRecord.stationID) {
    return Number(characterRecord.stationID);
  }
  const homeStationInfo = resolveHomeStationInfo(characterRecord);
  return Number(homeStationInfo.homeStationID || 60003760) || 60003760;
}

function grantItemFulfillment(characterID, typeID, quantity) {
  const liveSession = findLiveSession(characterID);
  if (liveSession) {
    const liveResult = giveItemToHangarForSession(
      liveSession,
      { typeID: toPositiveInteger(typeID, 0) },
      quantity,
    );
    if (liveResult.success) {
      return liveResult;
    }
  }

  return grantItemToCharacterStationHangar(
    characterID,
    resolveDeliveryLocationID(characterID),
    { typeID: toPositiveInteger(typeID, 0) },
    quantity,
  );
}

function grantSkillPointsFulfillment(characterID, points) {
  const normalizedPoints = Math.max(0, Math.trunc(toNumber(points, 0)));
  if (!normalizedPoints) {
    return {
      success: false,
      errorMsg: "INVALID_SKILL_POINT_AMOUNT",
    };
  }

  const result = updateCharacterRecord(characterID, (record) => ({
    ...record,
    freeSkillPoints: Math.max(
      0,
      Math.trunc(toNumber(record && record.freeSkillPoints, 0) + normalizedPoints),
    ),
  }));
  if (!result.success) {
    return result;
  }

  const liveSession = findLiveSession(characterID);
  if (liveSession) {
    liveSession.skillPoints = Number(result.data.skillPoints || liveSession.skillPoints || 0);
  }

  return {
    success: true,
    data: {
      type: "skill_points",
      points: normalizedPoints,
      freeSkillPoints: Number(result.data.freeSkillPoints || 0),
    },
  };
}

function debitCharacterPlex(characterID, plexAmount, reason) {
  return adjustCharacterPlexBalance(characterID, -Math.abs(plexAmount), {
    categoryMessageID: PLEX_LOG_CATEGORY.NES,
    reason,
  });
}

function creditCharacterPlex(characterID, plexAmount, reason) {
  return adjustCharacterPlexBalance(characterID, Math.abs(plexAmount), {
    categoryMessageID: PLEX_LOG_CATEGORY.PURCHASE,
    reason,
  });
}

function buildReceiptPayload(offer, quantity, paymentMethod, paymentIdentifier) {
  const publicOffer = cloneValue(offer) || {};
  const itemQuantity = Math.max(1, Math.trunc(toNumber(quantity, 1)));
  const itemName = String(publicOffer.name || "Store offer");
  const plexPriceInCents = Math.max(
    0,
    Math.trunc(toNumber(publicOffer.plexPriceInCents, 0) * itemQuantity),
  );
  const currencyAmountInCents = Math.max(
    0,
    Math.trunc(toNumber(publicOffer.currencyAmountInCents, 0) * itemQuantity),
  );
  const catalogAmountInCents = publicOffer.currencyCode
    ? currencyAmountInCents
    : plexPriceInCents;

  return {
    order: {
      offer: {
        store_offer: String(publicOffer.storeOfferID || ""),
      },
      quantity: itemQuantity,
      cost: {
        catalog_amount_in_cents: catalogAmountInCents,
        tax_amount_in_cents: 0,
        total_amount_in_cents: catalogAmountInCents,
        tax_rate_points: 0,
        currency: publicOffer.currencyCode || "PLX",
      },
    },
    payment_identifier: {
      sequential: Math.max(1, Math.trunc(toNumber(paymentIdentifier, Date.now()))),
    },
    payment_method: paymentMethod,
    description: itemName,
    items: [
      {
        name: itemName,
        quantity: itemQuantity,
      },
    ],
  };
}

function grantFulfillmentToCharacter(characterID, fulfillment, quantity, options = {}) {
  const characterRecord = getCharacterRecord(characterID);
  if (!characterRecord) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const fulfillmentSource = fulfillment && typeof fulfillment === "object" ? fulfillment : {};
  const accountID = resolveCharacterAccountID(characterID);
  const multiplier = Math.max(1, Math.trunc(toNumber(quantity, 1)));

  switch (String(fulfillmentSource.kind || "")) {
    case "grant_plex": {
      const plexAmount = Math.max(
        0,
        Math.trunc(toNumber(fulfillmentSource.plexAmount, 0) * multiplier),
      );
      const result = creditCharacterPlex(
        characterID,
        plexAmount,
        options.reason || `Fake cash purchase: ${plexAmount} PLEX`,
      );
      if (!result.success) {
        return result;
      }
      return {
        success: true,
        data: {
          type: "plex",
          plexAmount,
          wallet: result.data,
        },
      };
    }
    case "omega": {
      if (!accountID) {
        return {
          success: false,
          errorMsg: "ACCOUNT_NOT_FOUND",
        };
      }
      const durationDays = Math.max(
        0,
        Math.trunc(toNumber(fulfillmentSource.durationDays, 0) * multiplier),
      );
      const result = grantOmegaDaysToAccount(accountID, durationDays);
      if (!result) {
        return {
          success: false,
          errorMsg: "WRITE_ERROR",
        };
      }
      return {
        success: true,
        data: {
          type: "omega",
          accountID,
          durationDays,
          expiryFileTime: result.expiryFileTime,
        },
      };
    }
    case "mct": {
      if (!accountID) {
        return {
          success: false,
          errorMsg: "ACCOUNT_NOT_FOUND",
        };
      }
      const durationDays = Math.max(
        0,
        Math.trunc(toNumber(fulfillmentSource.durationDays, 0)),
      );
      const slotCount = Math.max(
        1,
        Math.trunc(
          toNumber(fulfillmentSource.slotCount, 1) * multiplier,
        ),
      );
      const result = grantMctDaysToAccount(accountID, durationDays, slotCount);
      if (!result) {
        return {
          success: false,
          errorMsg: "WRITE_ERROR",
        };
      }
      return {
        success: true,
        data: {
          type: "mct",
          accountID,
          durationDays,
          slotCount,
          grantedSlots: result.grantedSlots,
        },
      };
    }
    case "item": {
      const typeID = toPositiveInteger(fulfillmentSource.typeID, 0);
      const itemQuantity = Math.max(
        1,
        Math.trunc(toNumber(fulfillmentSource.quantity, 1) * multiplier),
      );
      if (!typeID) {
        return {
          success: false,
          errorMsg: "INVALID_ITEM_TYPE",
        };
      }
      const result = grantItemFulfillment(characterID, typeID, itemQuantity);
      if (!result.success) {
        return result;
      }
      return {
        success: true,
        data: {
          type: "item",
          typeID,
          quantity: itemQuantity,
          grant: cloneValue(result.data),
        },
      };
    }
    case "skill_points": {
      const points = Math.max(
        0,
        Math.trunc(toNumber(fulfillmentSource.points, 0) * multiplier),
      );
      return grantSkillPointsFulfillment(characterID, points);
    }
    case "bundle": {
      const grants = Array.isArray(fulfillmentSource.grants)
        ? fulfillmentSource.grants
        : [];
      if (grants.length === 0) {
        return {
          success: false,
          errorMsg: "INVALID_BUNDLE",
        };
      }

      const results = [];
      for (const grant of grants) {
        const grantResult = grantFulfillmentToCharacter(
          characterID,
          grant,
          multiplier,
          options,
        );
        if (!grantResult.success) {
          return grantResult;
        }
        results.push(cloneValue(grantResult.data));
      }

      return {
        success: true,
        data: {
          type: "bundle",
          grants: results,
        },
      };
    }
    default:
      return {
        success: false,
        errorMsg: "UNSUPPORTED_FULFILLMENT",
      };
  }
}

function finalizePurchase(purchaseKey, payload = {}) {
  markPurchaseCompleted(purchaseKey, payload);
  appendPurchaseLog({
    id: purchaseKey,
    ...payload,
  });
}

function purchaseLegacyOffer({
  storeID = 4,
  offerID,
  currency = "PLX",
  quantity = 1,
  characterID,
  targetCharacterID = 0,
  accountID = 0,
  session = null,
}) {
  const configState = getStoreConfig();
  if (!configState.enabled) {
    return {
      success: false,
      errorMsg: "STORE_DISABLED",
    };
  }

  const legacyOffer = findLegacyOffer(storeID, offerID);
  if (!legacyOffer) {
    return {
      success: false,
      errorMsg: "OFFER_NOT_FOUND",
    };
  }
  const purchaseCharacters = resolveLegacyPurchaseCharacters({
    payerCharacterID: characterID,
    targetCharacterID,
    accountID,
    session,
  });
  const payerCharacterID = purchaseCharacters.payerCharacterID;
  const fulfillmentCharacterID = purchaseCharacters.targetCharacterID;
  const characterWallet = getCharacterWallet(payerCharacterID);
  if (!characterWallet) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  const normalizedQuantity = Math.max(1, Math.trunc(toNumber(quantity, 1)));
  const pricing = Array.isArray(legacyOffer.offerPricings)
    ? legacyOffer.offerPricings.find(
        (entry) => String(entry && entry.currency || "").trim().toUpperCase() === normalizedCurrency,
      )
    : null;
  if (!pricing || normalizedCurrency !== "PLX") {
    return {
      success: false,
      errorMsg: "UNSUPPORTED_CURRENCY",
    };
  }

  const totalPlexCost = Math.max(
    0,
    Math.trunc(toNumber(pricing.price, 0) * normalizedQuantity),
  );
  if (characterWallet.plexBalance < totalPlexCost) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_FUNDS",
    };
  }

  const debitResult = debitCharacterPlex(
    payerCharacterID,
    totalPlexCost,
    `New Eden Store purchase: ${legacyOffer.name} x${normalizedQuantity}`,
  );
  if (!debitResult.success) {
    return debitResult;
  }

  const grantResult = grantFulfillmentToCharacter(
    fulfillmentCharacterID,
    legacyOffer.fulfillment,
    normalizedQuantity,
    {
      reason: `New Eden Store purchase: ${legacyOffer.name}`,
    },
  );
  if (!grantResult.success) {
    creditCharacterPlex(
      payerCharacterID,
      totalPlexCost,
      `Rollback for failed New Eden Store purchase: ${legacyOffer.name}`,
    );
    return grantResult;
  }

  const result = {
    success: true,
    offer_id: legacyOffer.id,
    store_offer_id: legacyOffer.storeOfferID || null,
    quantity: normalizedQuantity,
    currency: normalizedCurrency,
    spent: totalPlexCost,
    balance: debitResult.data.plexBalance,
    payerCharacterID,
    characterID: fulfillmentCharacterID,
    fulfillment: cloneValue(grantResult.data),
  };
  appendPurchaseLog({
    id: buildPurchaseKey([
      "legacy",
      payerCharacterID,
      legacyOffer.id,
      Date.now(),
    ]),
    channel: "legacy",
    characterID: fulfillmentCharacterID,
    accountID: resolveCharacterAccountID(fulfillmentCharacterID),
    payerCharacterID,
    payerAccountID: resolveCharacterAccountID(payerCharacterID),
    offerID: legacyOffer.id,
    storeOfferID: legacyOffer.storeOfferID || null,
    quantity: normalizedQuantity,
    spentPlex: totalPlexCost,
    result,
  });
  return {
    success: true,
    data: result,
  };
}

function purchaseFastCheckoutOffer({
  offerID,
  characterID,
  purchaseTraceID = "",
  journeyID = "",
}) {
  const configState = getStoreConfig();
  if (!configState.fastCheckoutEnabled) {
    return {
      success: false,
      errorMsg: "FAST_CHECKOUT_DISABLED",
    };
  }

  const offer = findFastCheckoutOffer(offerID);
  if (!offer || !offer.storeOfferID) {
    return {
      success: false,
      errorMsg: "OfferNotAvailable",
    };
  }

  const requestScope =
    String(purchaseTraceID || "").trim() || String(journeyID || "").trim()
      ? `${String(purchaseTraceID || "").trim()}|${String(journeyID || "").trim()}`
      : String(Date.now());
  const purchaseKey = buildPurchaseKey([
    "fast-checkout",
    characterID,
    offerID,
    requestScope,
  ]);
  const completed = getCompletedPurchase(purchaseKey);
  if (completed) {
    return {
      success: true,
      repeated: true,
      data: {
        Message: configState.fakeFastCheckoutResponse,
      },
      receipt: cloneValue(completed.receipt || null),
    };
  }

  const publicOffer = findPublicOffer(offer.storeOfferID);
  if (!publicOffer) {
    return {
      success: false,
      errorMsg: "OfferNotAvailable",
    };
  }

  const grantResult = grantFulfillmentToCharacter(
    characterID,
    publicOffer.fulfillment,
    1,
    {
      reason: `Fast checkout purchase: ${publicOffer.name}`,
    },
  );
  if (!grantResult.success) {
    return {
      success: false,
      errorMsg: "PurchaseFailed",
    };
  }

  const receipt = buildReceiptPayload(publicOffer, 1, 1, Date.now());
  finalizePurchase(purchaseKey, {
    channel: "fast-checkout",
    characterID,
    accountID: resolveCharacterAccountID(characterID),
    offerID,
    storeOfferID: publicOffer.storeOfferID,
    quantity: 1,
    receipt,
    result: {
      Message: configState.fakeFastCheckoutResponse,
    },
  });
  return {
    success: true,
    data: {
      Message: configState.fakeFastCheckoutResponse,
    },
    receipt,
  };
}

function purchasePublicCashOffer({
  storeOfferID,
  characterID,
  quantity = 1,
  paymentMethod = 11,
  purchaseKeySuffix = "",
}) {
  const configState = getStoreConfig();
  if (!configState.fakeCashPurchasesEnabled) {
    return {
      success: false,
      errorMsg: "PURCHASE_DISABLED",
    };
  }

  const publicOffer = findPublicOffer(storeOfferID);
  if (!publicOffer) {
    return {
      success: false,
      errorMsg: "OFFER_NOT_FOUND",
    };
  }

  const normalizedQuantity = Math.max(1, Math.trunc(toNumber(quantity, 1)));
  const purchaseKey = buildPurchaseKey([
    "cash",
    characterID,
    publicOffer.storeOfferID,
    normalizedQuantity,
    buildRequestScopedSuffix(purchaseKeySuffix),
  ]);
  const completed = getCompletedPurchase(purchaseKey);
  if (completed) {
    return {
      success: true,
      repeated: true,
      data: cloneValue(completed.result || completed),
    };
  }

  const grantResult = grantFulfillmentToCharacter(
    characterID,
    publicOffer.fulfillment,
    normalizedQuantity,
    {
      reason: `Fake cash purchase: ${publicOffer.name}`,
    },
  );
  if (!grantResult.success) {
    return grantResult;
  }

  const receipt = buildReceiptPayload(
    publicOffer,
    normalizedQuantity,
    paymentMethod,
    Date.now(),
  );
  const result = {
    receipt,
    fulfillment: cloneValue(grantResult.data),
  };
  finalizePurchase(purchaseKey, {
    channel: "cash",
    characterID,
    accountID: resolveCharacterAccountID(characterID),
    storeOfferID: publicOffer.storeOfferID,
    quantity: normalizedQuantity,
    receipt,
    result,
  });
  return {
    success: true,
    data: result,
  };
}

function purchasePlexVaultOffer({
  storeOfferID,
  characterID,
  quantity = 1,
  purchaseKeySuffix = "",
}) {
  const configState = getStoreConfig();
  if (!configState.enabled) {
    return {
      success: false,
      errorMsg: "STORE_DISABLED",
    };
  }

  const publicOffer = findPublicOffer(storeOfferID);
  if (!publicOffer) {
    return {
      success: false,
      errorMsg: "OFFER_NOT_FOUND",
    };
  }

  const normalizedQuantity = Math.max(1, Math.trunc(toNumber(quantity, 1)));
  const totalPlexCost = Math.max(
    0,
    Math.trunc(
      toNumber(publicOffer.plexPriceInCents, 0) * normalizedQuantity / configState.centsPerPlex,
    ),
  );
  const wallet = getCharacterWallet(characterID);
  if (!wallet) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }
  if (wallet.plexBalance < totalPlexCost) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_FUNDS",
    };
  }

  const purchaseKey = buildPurchaseKey([
    "plex-vault",
    characterID,
    publicOffer.storeOfferID,
    normalizedQuantity,
    buildRequestScopedSuffix(purchaseKeySuffix),
  ]);
  const completed = getCompletedPurchase(purchaseKey);
  if (completed) {
    return {
      success: true,
      repeated: true,
      data: cloneValue(completed.result || completed),
    };
  }

  const debitResult = debitCharacterPlex(
    characterID,
    totalPlexCost,
    `PLEX Vault purchase: ${publicOffer.name} x${normalizedQuantity}`,
  );
  if (!debitResult.success) {
    return debitResult;
  }

  const grantResult = grantFulfillmentToCharacter(
    characterID,
    publicOffer.fulfillment,
    normalizedQuantity,
    {
      reason: `PLEX Vault purchase: ${publicOffer.name}`,
    },
  );
  if (!grantResult.success) {
    creditCharacterPlex(
      characterID,
      totalPlexCost,
      `Rollback for failed PLEX Vault purchase: ${publicOffer.name}`,
    );
    return grantResult;
  }

  const result = {
    balance: debitResult.data.plexBalance,
    spentPlex: totalPlexCost,
    fulfillment: cloneValue(grantResult.data),
  };
  finalizePurchase(purchaseKey, {
    channel: "plex-vault",
    characterID,
    accountID: resolveCharacterAccountID(characterID),
    storeOfferID: publicOffer.storeOfferID,
    quantity: normalizedQuantity,
    spentPlex: totalPlexCost,
    result,
  });
  return {
    success: true,
    data: result,
  };
}

module.exports = {
  buildPurchaseKey,
  buildReceiptPayload,
  grantFulfillmentToCharacter,
  purchaseFastCheckoutOffer,
  purchaseLegacyOffer,
  purchasePlexVaultOffer,
  purchasePublicCashOffer,
};
