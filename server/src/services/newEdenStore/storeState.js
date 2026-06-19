const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const database = require(path.join(__dirname, "../../newDatabase"));
const AUTHORITY_TABLE = "newEdenStore";
const RUNTIME_TABLE = "newEdenStoreRuntime";
const ACCOUNTS_TABLE = "accounts";
const CHARACTERS_TABLE = "characters";
const FILETIME_TICKS_PER_DAY = 864000000000n;
const FILETIME_UNIX_EPOCH_OFFSET = 116444736000000000n;
const DEFAULT_OMEGA_EXPIRY_FILETIME = "157469184000000000";
const DEFAULT_PURCHASE_LOG_LIMIT = 500;

let cachedState = null;

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

function toBooleanString(value, fallback = false) {
  return value ? "1" : fallback ? "1" : "0";
}

function toBigInt(value, fallback = 0n) {
  try {
    if (typeof value === "bigint") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }
    if (typeof value === "string" && value.trim() !== "") {
      return BigInt(value);
    }
  } catch (error) {
    return fallback;
  }
  return fallback;
}

function currentFileTime() {
  return BigInt(Date.now()) * 10000n + FILETIME_UNIX_EPOCH_OFFSET;
}

function ensureObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function readTable(tableName) {
  const result = database.read(tableName, "/");
  if (!result.success) {
    return {};
  }
  return ensureObject(result.data);
}

function normalizeStoreConfig(rawConfig = {}) {
  const source = ensureObject(rawConfig);
  const normalized = {
    enabled:
      config.newEdenStoreEnabled !== undefined
        ? Boolean(config.newEdenStoreEnabled)
        : source.enabled !== false,
    fastCheckoutEnabled:
      config.newEdenStoreFastCheckoutEnabled !== undefined
        ? Boolean(config.newEdenStoreFastCheckoutEnabled)
        : source.fastCheckoutEnabled !== false,
    fakeCashPurchasesEnabled:
      config.newEdenStoreFakeCashPurchasesEnabled !== undefined
        ? Boolean(config.newEdenStoreFakeCashPurchasesEnabled)
        : source.fakeCashPurchasesEnabled !== false,
    fakeFastCheckoutResponse:
      typeof config.newEdenStoreFakeFastCheckoutResponse === "string" &&
      config.newEdenStoreFakeFastCheckoutResponse.trim() !== ""
        ? config.newEdenStoreFakeFastCheckoutResponse.trim()
        : typeof source.fakeFastCheckoutResponse === "string" &&
            source.fakeFastCheckoutResponse.trim() !== ""
          ? source.fakeFastCheckoutResponse.trim()
          : "OK",
    fakeChinaFunnelEnabled:
      config.newEdenStoreFakeChinaFunnelEnabled !== undefined
        ? Boolean(config.newEdenStoreFakeChinaFunnelEnabled)
        : Boolean(source.fakeChinaFunnelEnabled),
    fakeBuyPlexOfferUrl:
      typeof config.newEdenStoreFakeBuyPlexOfferUrl === "string"
        ? config.newEdenStoreFakeBuyPlexOfferUrl
        : typeof source.fakeBuyPlexOfferUrl === "string"
          ? source.fakeBuyPlexOfferUrl
          : "",
    useShellExecuteToBuyPlexOffer:
      config.newEdenStoreUseShellExecuteToBuyPlexOffer !== undefined
        ? Boolean(config.newEdenStoreUseShellExecuteToBuyPlexOffer)
        : source.useShellExecuteToBuyPlexOffer !== false,
    centsPerPlex: Math.max(
      1,
      Math.trunc(
        toNumber(
          config.newEdenStoreCentsPerPlex !== undefined
            ? config.newEdenStoreCentsPerPlex
            : source.centsPerPlex,
          100,
        ),
      ),
    ),
    defaultCashTaxRatePoints: Math.max(
      0,
      Math.trunc(
        toNumber(
          config.newEdenStoreDefaultCashTaxRatePoints !== undefined
            ? config.newEdenStoreDefaultCashTaxRatePoints
            : source.defaultCashTaxRatePoints,
          0,
        ),
      ),
    ),
    editorPort: Math.max(
      1,
      Math.trunc(
        toNumber(
          config.newEdenStoreEditorPort !== undefined
            ? config.newEdenStoreEditorPort
            : source.editorPort,
          26008,
        ),
      ),
    ),
    purchaseLogLimit: Math.max(
      10,
      Math.trunc(
        toNumber(
          config.newEdenStorePurchaseLogLimit !== undefined
            ? config.newEdenStorePurchaseLogLimit
            : source.purchaseLogLimit,
          DEFAULT_PURCHASE_LOG_LIMIT,
        ),
      ),
    ),
  };

  return normalized;
}

function normalizeTrainingSlots(rawValue) {
  const source = ensureObject(rawValue);
  const normalized = {};
  for (const [slotKey, expiryValue] of Object.entries(source)) {
    const slot = toPositiveInteger(slotKey, 0);
    if (!slot) {
      continue;
    }
    const expiryString = String(expiryValue || "").trim();
    if (expiryString === "") {
      continue;
    }
    normalized[String(slot)] = expiryString;
  }
  return normalized;
}

function normalizeRuntimeAccount(rawValue) {
  const source = ensureObject(rawValue);
  return {
    omegaExpiryFileTime:
      typeof source.omegaExpiryFileTime === "string" &&
      source.omegaExpiryFileTime.trim() !== ""
        ? source.omegaExpiryFileTime.trim()
        : null,
    multiCharacterTrainingSlots: normalizeTrainingSlots(
      source.multiCharacterTrainingSlots,
    ),
    updatedAt:
      typeof source.updatedAt === "string" && source.updatedAt.trim() !== ""
        ? source.updatedAt.trim()
        : null,
  };
}

function buildFastCheckoutOffersConfigString(fastCheckoutOffers = []) {
  const tuples = ensureArray(fastCheckoutOffers).map((offer) => [
    Math.max(0, Math.trunc(toNumber(offer && offer.quantity, 0))),
    String(offer && offer.currency ? offer.currency : ""),
    Number(toNumber(offer && offer.price, 0).toFixed(2)),
  ]);
  return JSON.stringify(tuples);
}

function loadStoreState() {
  if (cachedState) {
    return cachedState;
  }

  const authority = readTable(AUTHORITY_TABLE);
  const runtime = readTable(RUNTIME_TABLE);
  const accounts = readTable(ACCOUNTS_TABLE);
  const characters = readTable(CHARACTERS_TABLE);
  const normalizedConfig = normalizeStoreConfig(authority.config);
  const stores = ensureObject(authority.stores);
  const publicOffers = ensureObject(authority.publicOffers);
  const fastCheckout = ensureObject(authority.fastCheckout);
  const fastCheckoutOffers = ensureArray(fastCheckout.offers);
  const quickPayTokens = ensureObject(fastCheckout.tokensByID);
  const runtimeAccounts = ensureObject(runtime.accounts);
  const completedPurchases = ensureObject(runtime.completedPurchases);
  const purchaseLog = ensureArray(runtime.purchaseLog);

  const legacyOffersByStore = new Map();
  const legacyOffersByStoreOfferID = new Map();
  const publicOffersByID = new Map();
  const fastCheckoutOffersByID = new Map();
  const quickPayTokensByID = new Map();
  const characterAccountByID = new Map();
  const accountCharacterIDs = new Map();
  const runtimeAccountsByID = new Map();

  for (const [storeID, rawStore] of Object.entries(stores)) {
    const normalizedStoreID = String(storeID);
    const store = {
      storeID: toPositiveInteger(rawStore && rawStore.storeID, toPositiveInteger(storeID, 4)),
      name: String(rawStore && rawStore.name ? rawStore.name : "New Eden Store"),
      categories: ensureArray(rawStore && rawStore.categories).map((entry) => cloneValue(entry)),
      products: ensureArray(rawStore && rawStore.products).map((entry) => cloneValue(entry)),
      offers: ensureArray(rawStore && rawStore.offers).map((entry) => cloneValue(entry)),
    };
    stores[normalizedStoreID] = store;
    legacyOffersByStore.set(normalizedStoreID, new Map());
    legacyOffersByStoreOfferID.set(normalizedStoreID, new Map());
    for (const offer of store.offers) {
      legacyOffersByStore.get(normalizedStoreID).set(String(offer.id), offer);
      if (offer && offer.storeOfferID) {
        legacyOffersByStoreOfferID
          .get(normalizedStoreID)
          .set(String(offer.storeOfferID), offer);
      }
    }
  }

  for (const [storeOfferID, offer] of Object.entries(publicOffers)) {
    publicOffersByID.set(String(storeOfferID), cloneValue(offer));
  }

  for (const offer of fastCheckoutOffers) {
    const offerID = toPositiveInteger(offer && offer.id, 0);
    if (!offerID) {
      continue;
    }
    fastCheckoutOffersByID.set(String(offerID), cloneValue(offer));
  }

  for (const [tokenID, token] of Object.entries(quickPayTokens)) {
    const normalizedTokenID = toPositiveInteger(tokenID, 0);
    if (!normalizedTokenID) {
      continue;
    }
    quickPayTokensByID.set(String(normalizedTokenID), cloneValue(token));
  }

  for (const [characterID, character] of Object.entries(characters)) {
    const normalizedCharacterID = toPositiveInteger(characterID, 0);
    const accountID = toPositiveInteger(character && character.accountId, 0);
    if (normalizedCharacterID && accountID) {
      characterAccountByID.set(String(normalizedCharacterID), accountID);
      const accountKey = String(accountID);
      if (!accountCharacterIDs.has(accountKey)) {
        accountCharacterIDs.set(accountKey, []);
      }
      accountCharacterIDs.get(accountKey).push(normalizedCharacterID);
    }
  }

  for (const characterIDs of accountCharacterIDs.values()) {
    characterIDs.sort((left, right) => left - right);
  }

  for (const [accountID, runtimeAccount] of Object.entries(runtimeAccounts)) {
    const normalizedAccountID = toPositiveInteger(accountID, 0);
    if (!normalizedAccountID) {
      continue;
    }
    runtimeAccountsByID.set(
      String(normalizedAccountID),
      normalizeRuntimeAccount(runtimeAccount),
    );
  }

  cachedState = {
    authority,
    runtime,
    accounts,
    characters,
    config: normalizedConfig,
    indexes: {
      stores,
      legacyOffersByStore,
      legacyOffersByStoreOfferID,
      publicOffersByID,
      fastCheckoutOffers,
      fastCheckoutOffersByID,
      quickPayTokens,
      quickPayTokensByID,
      characterAccountByID,
      accountCharacterIDs,
      runtimeAccountsByID,
      completedPurchases,
      purchaseLog,
    },
  };

  return cachedState;
}

function resetStoreCaches() {
  cachedState = null;
}

function getStoreConfig() {
  return cloneValue(loadStoreState().config);
}

function getLegacyCatalog(storeID = 4) {
  const state = loadStoreState();
  const normalizedStoreID = String(toPositiveInteger(storeID, 4));
  const store = state.indexes.stores[normalizedStoreID];
  if (!store) {
    return {
      storeID: toPositiveInteger(storeID, 4),
      name: "New Eden Store",
      categories: [],
      products: [],
      offers: [],
    };
  }
  return cloneValue(store);
}

function findLegacyOffer(storeID, offerID) {
  const state = loadStoreState();
  const offersByID = state.indexes.legacyOffersByStore.get(
    String(toPositiveInteger(storeID, 4)),
  );
  if (!offersByID) {
    return null;
  }
  return cloneValue(offersByID.get(String(toPositiveInteger(offerID, 0))) || null);
}

function findLegacyOfferByStoreOfferID(storeID, storeOfferID) {
  const state = loadStoreState();
  const offersByStoreOfferID = state.indexes.legacyOffersByStoreOfferID.get(
    String(toPositiveInteger(storeID, 4)),
  );
  if (!offersByStoreOfferID) {
    return null;
  }
  return cloneValue(
    offersByStoreOfferID.get(String(storeOfferID || "").trim()) || null,
  );
}

function findPublicOffer(storeOfferID) {
  const state = loadStoreState();
  return cloneValue(
    state.indexes.publicOffersByID.get(String(storeOfferID || "").trim()) || null,
  );
}

function findPublicOfferForLegacyOffer(storeID, offerID) {
  const legacyOffer = findLegacyOffer(storeID, offerID);
  if (!legacyOffer || !legacyOffer.storeOfferID) {
    return null;
  }
  return findPublicOffer(legacyOffer.storeOfferID);
}

function getFastCheckoutOffers() {
  return cloneValue(loadStoreState().indexes.fastCheckoutOffers);
}

function findFastCheckoutOffer(offerID) {
  const state = loadStoreState();
  return cloneValue(
    state.indexes.fastCheckoutOffersByID.get(
      String(toPositiveInteger(offerID, 0)),
    ) || null,
  );
}

function getQuickPayTokens() {
  return cloneValue(loadStoreState().indexes.quickPayTokens);
}

function findQuickPayToken(tokenID) {
  const state = loadStoreState();
  return cloneValue(
    state.indexes.quickPayTokensByID.get(String(toPositiveInteger(tokenID, 0))) ||
      null,
  );
}

function buildClientGlobalConfigEntries() {
  const state = loadStoreState();
  return [
    ["fake_fast_checkout_enabled", toBooleanString(state.config.fastCheckoutEnabled)],
    ["fake_fast_checkout_response", state.config.fakeFastCheckoutResponse],
    [
      "fake_fast_checkout_plex_offers",
      buildFastCheckoutOffersConfigString(state.indexes.fastCheckoutOffers),
    ],
    ["fake_vgs_enabled", toBooleanString(state.config.enabled)],
    [
      "fake_china_funnel_enabled",
      toBooleanString(state.config.fakeChinaFunnelEnabled),
    ],
    ["fake_buy_plex_offer_url", state.config.fakeBuyPlexOfferUrl],
    [
      "use_shell_execute_to_buy_plex_offer",
      toBooleanString(state.config.useShellExecuteToBuyPlexOffer, true),
    ],
  ];
}

function resolveCharacterAccountID(characterID) {
  const state = loadStoreState();
  return (
    state.indexes.characterAccountByID.get(String(toPositiveInteger(characterID, 0))) ||
    0
  );
}

function resolveStoreCharacterID(characterID, accountID = 0) {
  const state = loadStoreState();
  const explicitCharacterID = toPositiveInteger(characterID, 0);
  if (
    explicitCharacterID &&
    state.indexes.characterAccountByID.has(String(explicitCharacterID))
  ) {
    return explicitCharacterID;
  }

  const normalizedAccountID = toPositiveInteger(accountID, 0);
  if (!normalizedAccountID) {
    return 0;
  }

  const characterIDs =
    state.indexes.accountCharacterIDs.get(String(normalizedAccountID)) || [];
  return toPositiveInteger(characterIDs[0], 0);
}

function readRuntimeAccount(accountID) {
  const state = loadStoreState();
  return cloneValue(
    state.indexes.runtimeAccountsByID.get(String(toPositiveInteger(accountID, 0))) ||
      normalizeRuntimeAccount({}),
  );
}

function writeRuntimeAccount(accountID, nextRuntimeAccount) {
  const numericAccountID = toPositiveInteger(accountID, 0);
  if (!numericAccountID) {
    return null;
  }
  const state = loadStoreState();
  const normalized = normalizeRuntimeAccount({
    ...ensureObject(nextRuntimeAccount),
    updatedAt: new Date().toISOString(),
  });
  const nextAccounts = {
    ...ensureObject(state.runtime.accounts),
    [String(numericAccountID)]: normalized,
  };
  database.write(RUNTIME_TABLE, "/accounts", nextAccounts);
  resetStoreCaches();
  return normalized;
}

function computeFutureFileTime(durationDays, currentValue) {
  const days = Math.max(0, Math.trunc(toNumber(durationDays, 0)));
  const baseFileTime = toBigInt(currentValue, 0n);
  const now = currentFileTime();
  const start = baseFileTime > now ? baseFileTime : now;
  return (start + BigInt(days) * FILETIME_TICKS_PER_DAY).toString();
}

function resolveOmegaLicenseState(accountID) {
  const numericAccountID = toPositiveInteger(accountID, 0);
  const state = loadStoreState();
  const runtimeAccount = readRuntimeAccount(numericAccountID);
  const runtimeExpiry = toBigInt(runtimeAccount.omegaExpiryFileTime, 0n);
  const now = currentFileTime();

  if (runtimeExpiry > now) {
    return {
      hasLicense: true,
      expiryFileTime: runtimeExpiry.toString(),
      source: "runtime",
    };
  }

  if (config.omegaLicenseEnabled !== false) {
    return {
      hasLicense: true,
      expiryFileTime: DEFAULT_OMEGA_EXPIRY_FILETIME,
      source: "config",
    };
  }

  return {
    hasLicense: false,
    expiryFileTime: null,
    source: "none",
  };
}

function grantOmegaDaysToAccount(accountID, durationDays) {
  const numericAccountID = toPositiveInteger(accountID, 0);
  if (!numericAccountID) {
    return null;
  }
  const runtimeAccount = readRuntimeAccount(numericAccountID);
  const expiryFileTime = computeFutureFileTime(
    durationDays,
    runtimeAccount.omegaExpiryFileTime,
  );
  const nextRuntimeAccount = {
    ...runtimeAccount,
    omegaExpiryFileTime: expiryFileTime,
  };
  writeRuntimeAccount(numericAccountID, nextRuntimeAccount);
  return {
    accountID: numericAccountID,
    expiryFileTime,
  };
}

function getBaseTrainingSlotsForAccount(accountID) {
  const state = loadStoreState();
  const normalizedAccountID = toPositiveInteger(accountID, 0);
  if (!normalizedAccountID) {
    return {};
  }
  for (const account of Object.values(state.accounts)) {
    if (toPositiveInteger(account && account.id, 0) !== normalizedAccountID) {
      continue;
    }
    return normalizeTrainingSlots(account && account.multiCharacterTrainingSlots);
  }
  return {};
}

function getTrainingSlotsForAccount(accountID) {
  const numericAccountID = toPositiveInteger(accountID, 0);
  const baseSlots = getBaseTrainingSlotsForAccount(numericAccountID);
  const runtimeAccount = readRuntimeAccount(numericAccountID);
  const runtimeSlots = normalizeTrainingSlots(
    runtimeAccount && runtimeAccount.multiCharacterTrainingSlots,
  );
  const nextSlots = {
    ...baseSlots,
  };
  for (const [slotKey, expiryValue] of Object.entries(runtimeSlots)) {
    const previous = toBigInt(nextSlots[slotKey], 0n);
    const next = toBigInt(expiryValue, 0n);
    nextSlots[slotKey] = (next > previous ? next : previous).toString();
  }
  return nextSlots;
}

function getNextMctSlotKey(trainingSlots) {
  const slotEntries = Object.entries(trainingSlots)
    .map(([slotKey, expiryValue]) => ({
      slotKey: String(slotKey),
      slot: toPositiveInteger(slotKey, 0),
      expiry: toBigInt(expiryValue, 0n),
    }))
    .filter((entry) => entry.slot >= 2)
    .sort((left, right) => {
      if (left.expiry === right.expiry) {
        return left.slot - right.slot;
      }
      return left.expiry < right.expiry ? -1 : 1;
    });

  if (slotEntries.length === 0) {
    return "2";
  }
  return slotEntries[0].slotKey;
}

function grantMctDaysToAccount(accountID, durationDays, slotCount = 1) {
  const numericAccountID = toPositiveInteger(accountID, 0);
  const slotsToGrant = Math.max(1, Math.trunc(toNumber(slotCount, 1)));
  if (!numericAccountID) {
    return null;
  }
  const runtimeAccount = readRuntimeAccount(numericAccountID);
  const mergedSlots = getTrainingSlotsForAccount(numericAccountID);
  const grantedSlots = [];

  for (let index = 0; index < slotsToGrant; index += 1) {
    const slotKey = getNextMctSlotKey(mergedSlots);
    const expiryFileTime = computeFutureFileTime(durationDays, mergedSlots[slotKey]);
    mergedSlots[slotKey] = expiryFileTime;
    grantedSlots.push({
      slot: Number(slotKey),
      expiryFileTime,
    });
  }

  const nextRuntimeAccount = {
    ...runtimeAccount,
    multiCharacterTrainingSlots: {
      ...normalizeTrainingSlots(runtimeAccount.multiCharacterTrainingSlots),
      ...mergedSlots,
    },
  };
  writeRuntimeAccount(numericAccountID, nextRuntimeAccount);
  return {
    accountID: numericAccountID,
    grantedSlots,
    slots: cloneValue(mergedSlots),
  };
}

function appendPurchaseLog(entry = {}) {
  const state = loadStoreState();
  const configState = state.config;
  const nextEntry = {
    id:
      typeof entry.id === "string" && entry.id.trim() !== ""
        ? entry.id.trim()
        : `purchase-${Date.now()}`,
    completedAt:
      typeof entry.completedAt === "string" && entry.completedAt.trim() !== ""
        ? entry.completedAt.trim()
        : new Date().toISOString(),
    ...cloneValue(entry),
  };
  const nextLog = [
    nextEntry,
    ...ensureArray(state.runtime.purchaseLog),
  ].slice(0, configState.purchaseLogLimit);
  database.write(RUNTIME_TABLE, "/purchaseLog", nextLog);
  resetStoreCaches();
  return nextEntry;
}

function markPurchaseCompleted(purchaseKey, payload = {}) {
  const normalizedKey = String(purchaseKey || "").trim();
  if (!normalizedKey) {
    return null;
  }
  const state = loadStoreState();
  const nextRecord = {
    completedAt: new Date().toISOString(),
    ...cloneValue(payload),
  };
  const nextCompletedPurchases = {
    ...ensureObject(state.runtime.completedPurchases),
    [normalizedKey]: nextRecord,
  };
  database.write(RUNTIME_TABLE, "/completedPurchases", nextCompletedPurchases);
  resetStoreCaches();
  return cloneValue(nextRecord);
}

function getCompletedPurchase(purchaseKey) {
  const state = loadStoreState();
  return cloneValue(
    ensureObject(state.runtime.completedPurchases)[String(purchaseKey || "").trim()] ||
      null,
  );
}

function getEditorSnapshot() {
  const state = loadStoreState();
  return {
    generatedAt: new Date().toISOString(),
    authority: cloneValue(state.authority),
    runtime: cloneValue(state.runtime),
    config: cloneValue(state.config),
  };
}

function saveEditorAuthority(nextAuthority, options = {}) {
  const authorityValue = ensureObject(nextAuthority);
  const runtimeValue = options.runtime ? ensureObject(options.runtime) : null;
  database.write(AUTHORITY_TABLE, "/", authorityValue);
  if (runtimeValue) {
    database.write(RUNTIME_TABLE, "/", runtimeValue);
  }
  resetStoreCaches();
  return getEditorSnapshot();
}

module.exports = {
  appendPurchaseLog,
  buildClientGlobalConfigEntries,
  computeFutureFileTime,
  findFastCheckoutOffer,
  findLegacyOffer,
  findLegacyOfferByStoreOfferID,
  findPublicOffer,
  findPublicOfferForLegacyOffer,
  findQuickPayToken,
  getCompletedPurchase,
  getEditorSnapshot,
  getFastCheckoutOffers,
  getLegacyCatalog,
  getQuickPayTokens,
  getStoreConfig,
  getTrainingSlotsForAccount,
  grantMctDaysToAccount,
  grantOmegaDaysToAccount,
  markPurchaseCompleted,
  readRuntimeAccount,
  resetStoreCaches,
  resolveCharacterAccountID,
  resolveOmegaLicenseState,
  resolveStoreCharacterID,
  saveEditorAuthority,
  writeRuntimeAccount,
};
