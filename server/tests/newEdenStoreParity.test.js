const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const config = require(path.join(repoRoot, "server/src/config"));
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const publicGatewayLocal = require(path.join(
  repoRoot,
  "server/src/_secondary/express/publicGatewayLocal",
));
const StoreManagerService = require(path.join(
  repoRoot,
  "server/src/services/account/storeManagerService",
));
const FastCheckoutService = require(path.join(
  repoRoot,
  "server/src/services/newEdenStore/FastCheckoutService",
));
const KiringMgrService = require(path.join(
  repoRoot,
  "server/src/services/newEdenStore/kiringMgrService",
));
const MachoNetService = require(path.join(
  repoRoot,
  "server/src/services/machoNet/machoNetService",
));
const SubscriptionMgrService = require(path.join(
  repoRoot,
  "server/src/services/subscription/subscriptionMgrService",
));
const UserService = require(path.join(
  repoRoot,
  "server/src/services/user/userService",
));
const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));
const {
  resetInventoryStoreForTests,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  buildNewEdenStoreGatewayProtoRoot,
} = require(path.join(
  repoRoot,
  "server/src/services/newEdenStore/storeGatewayProto",
));
const {
  marshalValueToJs,
} = require(path.join(
  repoRoot,
  "server/src/services/newEdenStore/storeMarshal",
));
const {
  getEditorSnapshot,
  getTrainingSlotsForAccount,
  resetStoreCaches,
  resolveOmegaLicenseState,
  saveEditorAuthority,
} = require(path.join(repoRoot, "server/src/services/newEdenStore/storeState"));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));

const ACTIVE_CHARACTER_ID = 140000001;
const ACTIVE_ACCOUNT_ID = 1;
const TEST_STATION_ID = 60003760;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildSession(overrides = {}) {
  return {
    characterID: ACTIVE_CHARACTER_ID,
    userid: ACTIVE_ACCOUNT_ID,
    corporationID: 1000044,
    corpid: 1000044,
    stationID: TEST_STATION_ID,
    stationid: TEST_STATION_ID,
    solarsystemid2: 30000142,
    socket: {
      destroyed: false,
    },
    sendNotification() {},
    ...overrides,
  };
}

function buildMarshalKwargs(entries = []) {
  return {
    type: "dict",
    entries,
  };
}

function buildGatewayEnvelope(typeName, payloadBuffer = Buffer.alloc(0), activeCharacterID = ACTIVE_CHARACTER_ID) {
  const envelope = publicGatewayLocal._testing.RequestEnvelope.create({
    correlation_uuid: Buffer.from(
      crypto.randomUUID().replace(/-/g, ""),
      "hex",
    ),
    payload: {
      type_url: `type.googleapis.com/${typeName}`,
      value: Buffer.from(payloadBuffer),
    },
    authoritative_context: activeCharacterID
      ? {
          active_character: { sequential: activeCharacterID },
          identity: {
            character: { sequential: activeCharacterID },
          },
        }
      : undefined,
  });
  return Buffer.from(
    publicGatewayLocal._testing.RequestEnvelope.encode(envelope).finish(),
  );
}

function decodeGatewayResponse(buffer) {
  return publicGatewayLocal._testing.ResponseEnvelope.decode(buffer);
}

function countOwnedItemsByType(typeID) {
  const items = database.read("items", "/").data || {};
  return Object.values(items).filter(
    (item) =>
      Number(item && item.ownerID) === ACTIVE_CHARACTER_ID &&
      Number(item && item.typeID) === Number(typeID),
  ).length;
}

test("storeManager serves cache-backed offers and buying an item offer spends PLEX and grants the hull", (t) => {
  const originalCharacter = cloneValue(getCharacterRecord(ACTIVE_CHARACTER_ID));
  const itemsBackup = cloneValue(database.read("items", "/").data || {});
  const runtimeBackup = cloneValue(database.read("newEdenStoreRuntime", "/").data || {});
  t.after(() => {
    updateCharacterRecord(ACTIVE_CHARACTER_ID, originalCharacter);
    database.write("items", "/", itemsBackup);
    database.write("newEdenStoreRuntime", "/", runtimeBackup);
    resetInventoryStoreForTests();
    resetStoreCaches();
    database.flushAllSync();
  });

  updateCharacterRecord(ACTIVE_CHARACTER_ID, (record) => ({
    ...record,
    stationID: TEST_STATION_ID,
    structureID: null,
    solarSystemID: 30000142,
    plexBalance: 5000,
  }));
  resetInventoryStoreForTests();
  resetStoreCaches();

  const storeManager = new StoreManagerService();
  const offers = marshalValueToJs(storeManager.Handle_get_offers([4]));
  assert.equal(Array.isArray(offers), true);
  assert.equal(offers.length >= 15, true);
  const drakeOffer = offers.find((offer) => offer.storeOfferID === "drake_hull");
  assert.ok(drakeOffer);

  const drakeCountBefore = countOwnedItemsByType(24698);
  const buyResult = marshalValueToJs(
    storeManager.Handle_buy_offer(
      [drakeOffer.id, "PLX", 1],
      buildSession(),
      buildMarshalKwargs([["store_id", 4], ["from_character_id", ACTIVE_CHARACTER_ID]]),
    ),
  );

  assert.equal(buyResult.success, true);
  assert.equal(buyResult.store_offer_id, "drake_hull");
  assert.equal(buyResult.spent, 1200);
  assert.equal(getCharacterRecord(ACTIVE_CHARACTER_ID).plexBalance, 3800);
  assert.equal(countOwnedItemsByType(24698), drakeCountBefore + 1);
});

test("storeManager resolves a fallback account character for character-select Omega purchases", (t) => {
  const originalCharacter = cloneValue(getCharacterRecord(ACTIVE_CHARACTER_ID));
  const runtimeBackup = cloneValue(database.read("newEdenStoreRuntime", "/").data || {});
  const previousOmegaLicenseEnabled = config.omegaLicenseEnabled;
  t.after(() => {
    updateCharacterRecord(ACTIVE_CHARACTER_ID, originalCharacter);
    database.write("newEdenStoreRuntime", "/", runtimeBackup);
    config.omegaLicenseEnabled = previousOmegaLicenseEnabled;
    resetStoreCaches();
    database.flushAllSync();
  });

  updateCharacterRecord(ACTIVE_CHARACTER_ID, (record) => ({
    ...record,
    plexBalance: 5000,
  }));
  config.omegaLicenseEnabled = false;
  resetStoreCaches();

  const storeManager = new StoreManagerService();
  const buyResult = marshalValueToJs(
    storeManager.Handle_buy_offer(
      [9200001, "PLX", 1],
      buildSession({ characterID: 0, charid: 0 }),
      buildMarshalKwargs([
        ["store_id", 4],
        ["from_character_id", null],
        ["to_character_id", null],
        ["is_game_time", true],
      ]),
    ),
  );

  assert.equal(Boolean(buyResult), true);
  assert.equal(buyResult.success, true);
  assert.equal(buyResult.store_offer_id, "omega_30_days");
  assert.equal(buyResult.payer_character_id, ACTIVE_CHARACTER_ID);
  assert.equal(buyResult.character_id, ACTIVE_CHARACTER_ID);
  assert.equal(getCharacterRecord(ACTIVE_CHARACTER_ID).plexBalance, 4500);
  assert.equal(resolveOmegaLicenseState(ACTIVE_ACCOUNT_ID).hasLicense, true);
  assert.equal(resolveOmegaLicenseState(ACTIVE_ACCOUNT_ID).source, "runtime");
});

test("seeded store authority fills storefront image urls for legacy, public, and fast checkout offers", () => {
  resetStoreCaches();
  const snapshot = getEditorSnapshot();
  const legacyOffers =
    (((snapshot.authority || {}).stores || {})["4"] || {}).offers || [];
  const publicOffers = Object.values(
    ((snapshot.authority || {}).publicOffers || {}),
  );
  const fastOffers =
    (((snapshot.authority || {}).fastCheckout || {}).offers) || [];

  assert.equal(legacyOffers.length >= 15, true);
  assert.equal(publicOffers.length >= 40, true);
  assert.equal(fastOffers.length >= 9, true);
  assert.equal(
    legacyOffers.every(
      (offer) => typeof offer.imageUrl === "string" && offer.imageUrl.trim() !== "",
    ),
    true,
  );
  assert.equal(
    legacyOffers.every(
      (offer) =>
        Array.isArray(offer.products) &&
        offer.products.every(
          (product) =>
            typeof product.imageUrl === "string" &&
            product.imageUrl.trim() !== "",
        ),
    ),
    true,
  );
  assert.equal(
    publicOffers.every(
      (offer) => typeof offer.imageUrl === "string" && offer.imageUrl.trim() !== "",
    ),
    true,
  );
  assert.equal(
    fastOffers.every(
      (offer) => typeof offer.imageUrl === "string" && offer.imageUrl.trim() !== "",
    ),
    true,
  );
});

test("FastCheckoutService returns the client tuple shape and fake cash checkout grants PLEX", (t) => {
  const originalCharacter = cloneValue(getCharacterRecord(ACTIVE_CHARACTER_ID));
  const runtimeBackup = cloneValue(database.read("newEdenStoreRuntime", "/").data || {});
  t.after(() => {
    updateCharacterRecord(ACTIVE_CHARACTER_ID, originalCharacter);
    database.write("newEdenStoreRuntime", "/", runtimeBackup);
    resetStoreCaches();
    database.flushAllSync();
  });

  updateCharacterRecord(ACTIVE_CHARACTER_ID, (record) => ({
    ...record,
    plexBalance: 0,
  }));
  resetStoreCaches();

  const service = new FastCheckoutService();
  const testingConfiguration = service.Handle_GetTestingConfiguration();
  assert.deepEqual(testingConfiguration, [false, "", true]);

  const rawOffersPayload = service.Handle_GetOffersForUser([], buildSession());
  assert.equal(rawOffersPayload.type, "dict");
  const rawOfferList = rawOffersPayload.entries.find(
    ([key]) => String(key) === "plex",
  )[1];
  assert.equal(rawOfferList.type, "list");
  assert.equal(rawOfferList.items[0].type, "object");
  assert.equal(rawOfferList.items[0].name, "util.KeyVal");

  const offersPayload = marshalValueToJs(rawOffersPayload);
  assert.equal(Array.isArray(offersPayload.plex), true);
  assert.equal(offersPayload.plex.length, 9);
  const normalizedOffers = offersPayload.plex.map((offer) => offer.args || offer);
  const offer500 = normalizedOffers.find(
    (offer) => String(offer.storeOfferID) === "cash_plex_500_usd",
  );
  assert.ok(offer500);

  const buyResult = marshalValueToJs(
    service.Handle_BuyOffer(
      [],
      buildSession(),
      buildMarshalKwargs([
        [
          "offer",
          {
            type: "object",
            name: "util.KeyVal",
            args: buildMarshalKwargs([["id", offer500.id]]),
          },
        ],
        ["purchaseTraceID", "trace-fast-1"],
        ["journeyID", "journey-fast-1"],
      ]),
    ),
  );

  assert.equal(buyResult.Message, "OK");
  assert.equal(getCharacterRecord(ACTIVE_CHARACTER_ID).plexBalance, 500);
});

test("kiringMgr serves the config dictionary shape the NES detail view expects", () => {
  const service = new KiringMgrService();
  const payload = marshalValueToJs(service.Handle_GetKiringConfiguration());

  assert.equal(payload.mode, 1);
  assert.equal(typeof payload.client_id, "string");
  assert.equal(typeof payload.endpoints, "object");
  assert.equal(typeof payload.channels, "object");
  assert.equal(typeof payload.endpoints.mpay, "string");
  assert.equal(typeof payload.endpoints.billing, "string");
  assert.equal(typeof payload.endpoints.redirect_uri, "string");
  assert.equal(typeof payload.channels.login, "string");
  assert.equal(typeof payload.channels.pay, "string");
  assert.equal(typeof payload.channels.app, "string");

  const machoNetService = new MachoNetService();
  const serviceInfo = machoNetService.getServiceInfoDict();
  assert.equal(
    serviceInfo.entries.some(([serviceName]) => String(serviceName) === "kiringMgr"),
    true,
  );
});

test("public gateway payment and PLEX-vault purchase requests return client payloads and fulfill locally", (t) => {
  const protoRoot = buildNewEdenStoreGatewayProtoRoot();
  const tokenGetResponseType = protoRoot.lookupType(
    "eve_public.payment.token.api.GetResponse",
  );
  const tokenQuickPayResponseType = protoRoot.lookupType(
    "eve_public.payment.token.api.GetQuickPayResponse",
  );
  const costRequestType = protoRoot.lookupType(
    "eve_public.payment.purchase.api.CostRequest",
  );
  const costResponseType = protoRoot.lookupType(
    "eve_public.payment.purchase.api.CostResponse",
  );
  const tokenRequestType = protoRoot.lookupType(
    "eve_public.payment.purchase.api.TokenRequest",
  );
  const tokenResponseType = protoRoot.lookupType(
    "eve_public.payment.purchase.api.TokenResponse",
  );
  const plexVaultPurchaseRequestType = protoRoot.lookupType(
    "eve_public.plex.vault.api.PurchaseRequest",
  );

  const originalCharacter = cloneValue(getCharacterRecord(ACTIVE_CHARACTER_ID));
  const itemsBackup = cloneValue(database.read("items", "/").data || {});
  const runtimeBackup = cloneValue(database.read("newEdenStoreRuntime", "/").data || {});
  t.after(() => {
    updateCharacterRecord(ACTIVE_CHARACTER_ID, originalCharacter);
    database.write("items", "/", itemsBackup);
    database.write("newEdenStoreRuntime", "/", runtimeBackup);
    resetInventoryStoreForTests();
    resetStoreCaches();
    database.flushAllSync();
  });

  updateCharacterRecord(ACTIVE_CHARACTER_ID, (record) => ({
    ...record,
    stationID: TEST_STATION_ID,
    structureID: null,
    plexBalance: 5000,
  }));
  resetInventoryStoreForTests();
  resetStoreCaches();

  const quickPayEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope("eve_public.payment.token.api.GetQuickPayRequest"),
    ),
  );
  assert.equal(quickPayEnvelope.status_code, 200);
  const quickPayPayload = tokenQuickPayResponseType.decode(
    quickPayEnvelope.payload.value,
  );
  assert.equal(quickPayPayload.tokens.length, 1);
  assert.equal(Number(quickPayPayload.tokens[0].sequential), 9000001);

  const tokenEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.payment.token.api.GetRequest",
        Buffer.from(
          protoRoot
            .lookupType("eve_public.payment.token.api.GetRequest")
            .encode({ token: { sequential: 9000001 } })
            .finish(),
        ),
      ),
    ),
  );
  assert.equal(tokenEnvelope.status_code, 200);
  const tokenPayload = tokenGetResponseType.decode(tokenEnvelope.payload.value);
  assert.equal(tokenPayload.token.credit_card.alias, "************4242");

  const costEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.payment.purchase.api.CostRequest",
        Buffer.from(
          costRequestType.encode({
            catalog_amount_in_cents: 499,
            currency: "GBP",
          }).finish(),
        ),
      ),
    ),
  );
  assert.equal(costEnvelope.status_code, 200);
  const costPayload = costResponseType.decode(costEnvelope.payload.value);
  assert.equal(Number(costPayload.cost.total_amount_in_cents), 499);

  const plexBeforeCash = getCharacterRecord(ACTIVE_CHARACTER_ID).plexBalance;
  const cashPurchaseEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.payment.purchase.api.TokenRequest",
        Buffer.from(
          tokenRequestType.encode({
            order: {
              offer: { store_offer: "cash_plex_100_usd" },
              quantity: 1,
            },
            token: { sequential: 9000001 },
          }).finish(),
        ),
      ),
    ),
  );
  assert.equal(cashPurchaseEnvelope.status_code, 200);
  const cashPurchasePayload = tokenResponseType.decode(
    cashPurchaseEnvelope.payload.value,
  );
  assert.equal(cashPurchasePayload.receipt.description, "100 PLEX");
  assert.equal(getCharacterRecord(ACTIVE_CHARACTER_ID).plexBalance, plexBeforeCash + 100);

  const plexBeforeLooseTokenPurchase = getCharacterRecord(ACTIVE_CHARACTER_ID).plexBalance;
  const looseTokenPurchaseEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.payment.purchase.api.TokenRequest",
        Buffer.from(
          tokenRequestType.encode({
            order: {
              offer: {},
              quantity: 1,
              cost: {
                catalog_amount_in_cents: 1000,
                currency: "USD",
              },
            },
            token: { sequential: 9999999 },
          }).finish(),
        ),
      ),
    ),
  );
  assert.equal(looseTokenPurchaseEnvelope.status_code, 200);
  const looseTokenPurchasePayload = tokenResponseType.decode(
    looseTokenPurchaseEnvelope.payload.value,
  );
  assert.equal(looseTokenPurchasePayload.receipt.description, "200 PLEX");
  assert.equal(
    getCharacterRecord(ACTIVE_CHARACTER_ID).plexBalance,
    plexBeforeLooseTokenPurchase + 200,
  );

  const drakeCountBefore = countOwnedItemsByType(24698);
  const plexBeforeVault = getCharacterRecord(ACTIVE_CHARACTER_ID).plexBalance;
  const plexVaultEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.plex.vault.api.PurchaseRequest",
        Buffer.from(
          plexVaultPurchaseRequestType.encode({
            offer: { store_offer: "drake_hull" },
            quantity: 1,
            not_gift: true,
          }).finish(),
        ),
      ),
    ),
  );
  assert.equal(plexVaultEnvelope.status_code, 200);
  assert.equal(getCharacterRecord(ACTIVE_CHARACTER_ID).plexBalance, plexBeforeVault - 1200);
  assert.equal(countOwnedItemsByType(24698), drakeCountBefore + 1);
});

test("public gateway token purchases resolve the account default character when the header flow has no active character", (t) => {
  const protoRoot = buildNewEdenStoreGatewayProtoRoot();
  const tokenRequestType = protoRoot.lookupType(
    "eve_public.payment.purchase.api.TokenRequest",
  );

  const originalCharacter = cloneValue(getCharacterRecord(ACTIVE_CHARACTER_ID));
  const runtimeBackup = cloneValue(database.read("newEdenStoreRuntime", "/").data || {});
  const fallbackSession = buildSession({
    characterID: 0,
    charid: 0,
    userid: ACTIVE_ACCOUNT_ID,
  });

  t.after(() => {
    sessionRegistry.unregister(fallbackSession);
    updateCharacterRecord(ACTIVE_CHARACTER_ID, originalCharacter);
    database.write("newEdenStoreRuntime", "/", runtimeBackup);
    resetStoreCaches();
    database.flushAllSync();
  });

  updateCharacterRecord(ACTIVE_CHARACTER_ID, (record) => ({
    ...record,
    plexBalance: 0,
  }));
  resetStoreCaches();
  sessionRegistry.register(fallbackSession);

  const purchaseEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.payment.purchase.api.TokenRequest",
        Buffer.from(
          tokenRequestType.encode({
            order: {
              offer: { store_offer: "400300" },
              quantity: 1,
              cost: {
                catalog_amount_in_cents: 2500,
                currency: "USD",
              },
            },
            token: { sequential: 9999999 },
          }).finish(),
        ),
        0,
      ),
    ),
  );

  assert.equal(purchaseEnvelope.status_code, 200);
  assert.equal(getCharacterRecord(ACTIVE_CHARACTER_ID).plexBalance, 500);
});

test("bundle cash offers grant mixed fulfillment including skill points and bundled items", (t) => {
  const originalCharacter = cloneValue(getCharacterRecord(ACTIVE_CHARACTER_ID));
  const itemsBackup = cloneValue(database.read("items", "/").data || {});
  const runtimeBackup = cloneValue(database.read("newEdenStoreRuntime", "/").data || {});
  t.after(() => {
    updateCharacterRecord(ACTIVE_CHARACTER_ID, originalCharacter);
    database.write("items", "/", itemsBackup);
    database.write("newEdenStoreRuntime", "/", runtimeBackup);
    resetInventoryStoreForTests();
    resetStoreCaches();
    database.flushAllSync();
  });

  updateCharacterRecord(ACTIVE_CHARACTER_ID, (record) => ({
    ...record,
    stationID: TEST_STATION_ID,
    structureID: null,
    plexBalance: 0,
    freeSkillPoints: 0,
  }));
  resetInventoryStoreForTests();
  resetStoreCaches();

  const tokenRequestType = buildNewEdenStoreGatewayProtoRoot().lookupType(
    "eve_public.payment.purchase.api.TokenRequest",
  );
  const beforeBoostCount = countOwnedItemsByType(77919);
  const bundleEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.payment.purchase.api.TokenRequest",
        Buffer.from(
          tokenRequestType.encode({
            order: {
              offer: { store_offer: "cash_level_2_mastery_pack" },
              quantity: 1,
            },
            token: { sequential: 9000001 },
          }).finish(),
        ),
      ),
    ),
  );

  assert.equal(bundleEnvelope.status_code, 200);
  const updatedCharacter = getCharacterRecord(ACTIVE_CHARACTER_ID);
  assert.equal(updatedCharacter.plexBalance, 100);
  assert.equal(updatedCharacter.freeSkillPoints, 250000);
  assert.equal(countOwnedItemsByType(77919), beforeBoostCount + 1);
  assert.equal(resolveOmegaLicenseState(ACTIVE_ACCOUNT_ID).hasLicense, true);
});

test("runtime omega and MCT purchases feed subscriptionMgr and userSvc from cache-backed state", (t) => {
  const originalCharacter = cloneValue(getCharacterRecord(ACTIVE_CHARACTER_ID));
  const accountsBackup = cloneValue(database.read("accounts", "/").data || {});
  const runtimeBackup = cloneValue(database.read("newEdenStoreRuntime", "/").data || {});
  const previousOmegaLicenseEnabled = config.omegaLicenseEnabled;
  t.after(() => {
    updateCharacterRecord(ACTIVE_CHARACTER_ID, originalCharacter);
    database.write("accounts", "/", accountsBackup);
    database.write("newEdenStoreRuntime", "/", runtimeBackup);
    config.omegaLicenseEnabled = previousOmegaLicenseEnabled;
    resetStoreCaches();
    database.flushAllSync();
  });

  updateCharacterRecord(ACTIVE_CHARACTER_ID, (record) => ({
    ...record,
    plexBalance: 5000,
  }));
  const nextAccounts = cloneValue(accountsBackup);
  nextAccounts.test.multiCharacterTrainingSlots = {
    "2": "0",
    "3": "0",
  };
  database.write("accounts", "/", nextAccounts);
  config.omegaLicenseEnabled = false;
  resetStoreCaches();

  const storeManager = new StoreManagerService();
  assert.ok(
    marshalValueToJs(
      storeManager.Handle_buy_offer(
        [9200001, "PLX", 1],
        buildSession(),
        buildMarshalKwargs([["store_id", 4], ["from_character_id", ACTIVE_CHARACTER_ID]]),
      ),
    ),
  );
  assert.ok(
    marshalValueToJs(
      storeManager.Handle_buy_offer(
        [9200002, "PLX", 1],
        buildSession(),
        buildMarshalKwargs([["store_id", 4], ["from_character_id", ACTIVE_CHARACTER_ID]]),
      ),
    ),
  );

  const omegaState = resolveOmegaLicenseState(ACTIVE_ACCOUNT_ID);
  assert.equal(omegaState.hasLicense, true);
  assert.equal(omegaState.source, "runtime");

  const trainingSlots = getTrainingSlotsForAccount(ACTIVE_ACCOUNT_ID);
  assert.equal(BigInt(trainingSlots["2"]) > 0n || BigInt(trainingSlots["3"]) > 0n, true);

  const subscriptionMgr = new SubscriptionMgrService();
  const userSvc = new UserService();
  assert.equal(subscriptionMgr.Handle_GetCloneGrade([], buildSession()), 1);

  const slotPayload = userSvc.Handle_GetMultiCharactersTrainingSlots([], buildSession());
  const slotEntries = Object.fromEntries(
    slotPayload.entries.map(([key, value]) => [String(key), String(value.value)]),
  );
  assert.equal(BigInt(slotEntries["2"]) > 0n || BigInt(slotEntries["3"]) > 0n, true);
});

test("store editor persistence writes authority and runtime snapshots back into the cache tables", (t) => {
  const authorityBackup = cloneValue(database.read("newEdenStore", "/").data || {});
  const runtimeBackup = cloneValue(database.read("newEdenStoreRuntime", "/").data || {});
  t.after(() => {
    database.write("newEdenStore", "/", authorityBackup);
    database.write("newEdenStoreRuntime", "/", runtimeBackup);
    resetStoreCaches();
    database.flushAllSync();
  });

  const snapshot = getEditorSnapshot();
  const nextAuthority = cloneValue(snapshot.authority);
  const nextRuntime = cloneValue(snapshot.runtime);
  nextAuthority.meta.updatedAt = "editor-test";
  nextRuntime.completedPurchases["editor-test"] = {
    completedAt: "editor-test",
  };

  const savedSnapshot = saveEditorAuthority(nextAuthority, { runtime: nextRuntime });
  assert.equal(savedSnapshot.authority.meta.updatedAt, "editor-test");
  assert.equal(
    savedSnapshot.runtime.completedPurchases["editor-test"].completedAt,
    "editor-test",
  );
});
