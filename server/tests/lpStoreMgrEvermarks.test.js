const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const MachoNetService = require(path.join(
  repoRoot,
  "server/src/services/machoNet/machoNetService",
));
const LPStoreMgrService = require(path.join(
  repoRoot,
  "server/src/services/evermarks/lpStoreMgrService",
));
const {
  EVERMARK_ISSUER_CORP_ID,
  adjustCharacterWalletLPBalance,
  getCharacterWalletLPBalance,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/lpWalletState",
));
const {
  getOwnedShipLogoEntitlementByTypeID,
  _testing: entitlementTesting,
} = require(path.join(
  repoRoot,
  "server/src/services/evermarks/evermarksEntitlements",
));
const {
  _testing: catalogTesting,
} = require(path.join(
  repoRoot,
  "server/src/services/evermarks/evermarksCatalog",
));
const {
  updateCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));

const TEST_CHARACTER_ID = 140000001;
const TEST_CORP_ID = 1000419;
const TEST_SHIP_TYPE_ID = 12753;
const TEST_LICENSE_TYPE_ID = 75146;
const TEST_OFFER_ID = 17283;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

function keyValToObject(value) {
  assert.equal(value && value.type, "object");
  assert.equal(value && value.name, "util.KeyVal");
  const entries =
    value && value.args && value.args.type === "dict" && Array.isArray(value.args.entries)
      ? value.args.entries
      : [];
  return Object.fromEntries(entries);
}

function seedCatalogFixture() {
  writeTable("evermarksCatalog", {
    meta: {
      version: 1,
      description: "Cached EverMarks heraldry emblem offers and ship-logo metadata.",
      generatedAt: null,
      sourceAuthority: "test",
    },
    licensesByTypeID: {
      [String(TEST_LICENSE_TYPE_ID)]: {
        licenseID: TEST_LICENSE_TYPE_ID,
        fsdTypeID: TEST_LICENSE_TYPE_ID,
        shipTypeID: TEST_SHIP_TYPE_ID,
        cosmeticType: 1,
        slotGroup: 1,
        name: "Impel Corporation Emblem",
        published: true,
      },
    },
    offersByOfferID: {
      [String(TEST_OFFER_ID)]: {
        offerID: TEST_OFFER_ID,
        corpID: TEST_CORP_ID,
        typeID: TEST_LICENSE_TYPE_ID,
        qty: 1,
        lpCost: 9000,
        iskCost: 0,
        akCost: 0,
        reqItems: [],
        requiredStandings: null,
      },
    },
    offerIDsByTypeID: {
      [String(TEST_LICENSE_TYPE_ID)]: TEST_OFFER_ID,
    },
  });
}

function seedEmptyEntitlements() {
  writeTable("evermarkEntitlements", {
    meta: {
      version: 1,
      description: "DB-backed EverMarks ship-logo entitlements.",
      updatedAt: null,
    },
    characters: {},
  });
}

function seedEmptyLpWallets() {
  writeTable("lpWallets", {
    _meta: {
      generatedAt: null,
      lastUpdatedAt: null,
    },
    characterWallets: {},
    corporationWallets: {},
  });
}

function resetEvermarksCaches() {
  catalogTesting.resetCache();
  entitlementTesting.resetCache();
}

test("LPStoreMgr returns CCP-shaped Heraldry offers and debits EverMarks on purchase", (t) => {
  const evermarksCatalogBackup = cloneValue(
    database.read("evermarksCatalog", "/").data || {},
  );
  const entitlementsBackup = cloneValue(
    database.read("evermarkEntitlements", "/").data || {},
  );
  const lpWalletsBackup = cloneValue(database.read("lpWallets", "/").data || {});
  const charactersBackup = cloneValue(database.read("characters", "/").data || {});

  t.after(() => {
    writeTable("evermarksCatalog", evermarksCatalogBackup);
    writeTable("evermarkEntitlements", entitlementsBackup);
    writeTable("lpWallets", lpWalletsBackup);
    writeTable("characters", charactersBackup);
    resetEvermarksCaches();
    database.flushAllSync();
  });

  seedCatalogFixture();
  seedEmptyEntitlements();
  seedEmptyLpWallets();
  resetEvermarksCaches();

  updateCharacterRecord(TEST_CHARACTER_ID, (record) => ({
    ...record,
    balance: 1000000,
  }));

  const grantResult = adjustCharacterWalletLPBalance(
    TEST_CHARACTER_ID,
    EVERMARK_ISSUER_CORP_ID,
    9000,
    { changeType: "admin_adjust" },
  );
  assert.equal(grantResult.success, true);

  const service = new LPStoreMgrService();
  const session = {
    characterID: TEST_CHARACTER_ID,
    corporationID: 98000001,
    corpid: 98000001,
  };

  const offers = service.Handle_GetAvailableOffersFromCorp([TEST_CORP_ID], session);
  assert.equal(offers && offers.type, "list");
  assert.equal(offers.items.length, 1);
  const offer = keyValToObject(offers.items[0]);
  assert.equal(offer.offerID, TEST_OFFER_ID);
  assert.equal(offer.corpID, TEST_CORP_ID);
  assert.equal(offer.typeID, TEST_LICENSE_TYPE_ID);
  assert.equal(offer.qty, 1);
  assert.equal(offer.lpCost, 9000);
  assert.equal(offer.iskCost, 0);
  assert.equal(offer.akCost, 0);
  assert.equal(offer.requiredStandings, null);
  assert.equal(offer.reqItems && offer.reqItems.type, "list");
  assert.equal(offer.reqItems.items.length, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(offer, "isOwned"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(offer, "shipTypeID"), false);

  assert.equal(
    service.Handle_TakeOfferForCharacter([TEST_CORP_ID, TEST_OFFER_ID, 1], session),
    true,
  );
  assert.equal(
    getCharacterWalletLPBalance(TEST_CHARACTER_ID, EVERMARK_ISSUER_CORP_ID),
    0,
  );
  const entitlement = getOwnedShipLogoEntitlementByTypeID(
    TEST_CHARACTER_ID,
    TEST_LICENSE_TYPE_ID,
  );
  assert.ok(entitlement);
  assert.equal(entitlement.shipTypeID, TEST_SHIP_TYPE_ID);

  let duplicateError = null;
  try {
    service.Handle_TakeOfferForCharacter([TEST_CORP_ID, TEST_OFFER_ID, 1], session);
  } catch (error) {
    duplicateError = error;
  }
  assert.ok(duplicateError);
  assert.ok(duplicateError.machoErrorResponse);
});

test("machoNet advertises LPStoreMgr on the station binding surface", () => {
  const machoNet = new MachoNetService();
  const serviceInfo = machoNet.getServiceInfoDict();
  assert.equal(serviceInfo && serviceInfo.type, "dict");
  assert.equal(
    serviceInfo.entries.some(
      (entry) => entry[0] === "LPStoreMgr" && entry[1] === "station",
    ),
    true,
  );
});
