const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const chatCommands = require(path.join(repoRoot, "server/src/services/chat/chatCommands"));
const {
  getActiveShipRecord,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));
const {
  resolveShipByName,
} = require(path.join(repoRoot, "server/src/services/chat/shipTypeRegistry"));
const {
  SHIP_LOGO_ENTITLEMENT_ALLIANCE,
  SHIP_LOGO_ENTITLEMENT_CORPORATION,
} = require(path.join(repoRoot, "server/src/services/evermarks/evermarksConstants"));
const {
  getOwnedShipLogoEntitlement,
  _testing: entitlementTesting,
} = require(path.join(repoRoot, "server/src/services/evermarks/evermarksEntitlements"));
const {
  _testing: catalogTesting,
} = require(path.join(repoRoot, "server/src/services/evermarks/evermarksCatalog"));

const TEST_CHARACTER_ID = 140000001;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

function seedCatalog(licenses = []) {
  const licensesByTypeID = {};
  for (const license of licenses) {
    licensesByTypeID[String(license.fsdTypeID)] = {
      licenseID: license.fsdTypeID,
      fsdTypeID: license.fsdTypeID,
      shipTypeID: license.shipTypeID,
      cosmeticType: license.cosmeticType,
      slotGroup: 1,
      name: license.name,
      published: true,
    };
  }

  writeTable("evermarksCatalog", {
    meta: {
      version: 1,
      description: "Cached EverMarks heraldry emblem offers and ship-logo metadata.",
      generatedAt: null,
      sourceAuthority: "test",
    },
    licensesByTypeID,
    offersByOfferID: {},
    offerIDsByTypeID: {},
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

function resetEvermarksCaches() {
  catalogTesting.resetCache();
  entitlementTesting.resetCache();
}

test("/grantcorplogo grants the active ship's corporation emblem license", (t) => {
  const catalogBackup = cloneValue(database.read("evermarksCatalog", "/").data || {});
  const entitlementsBackup = cloneValue(database.read("evermarkEntitlements", "/").data || {});
  t.after(() => {
    writeTable("evermarksCatalog", catalogBackup);
    writeTable("evermarkEntitlements", entitlementsBackup);
    resetEvermarksCaches();
    database.flushAllSync();
  });

  const activeShip = getActiveShipRecord(TEST_CHARACTER_ID);
  assert.ok(activeShip && activeShip.typeID, "Expected a seeded active ship for the test character");

  seedCatalog([
    {
      fsdTypeID: 99514601,
      shipTypeID: activeShip.typeID,
      cosmeticType: 1,
      name: "Active Ship Corporation Emblem",
    },
  ]);
  seedEmptyEntitlements();
  resetEvermarksCaches();

  const result = chatCommands.executeChatCommand(
    {
      characterID: TEST_CHARACTER_ID,
      corporationID: 980090001,
      corpid: 980090001,
      allianceID: null,
      allianceid: null,
    },
    "/grantcorplogo",
    null,
    { emitChatFeedback: false },
  );

  assert.equal(result.handled, true);
  assert.match(result.message, /Granted corporation emblem license/i);
  assert.ok(
    getOwnedShipLogoEntitlement(
      TEST_CHARACTER_ID,
      activeShip.typeID,
      SHIP_LOGO_ENTITLEMENT_CORPORATION,
    ),
  );
});

test("/grantshipemblem both grants both heraldry entitlements for a named ship", (t) => {
  const catalogBackup = cloneValue(database.read("evermarksCatalog", "/").data || {});
  const entitlementsBackup = cloneValue(database.read("evermarkEntitlements", "/").data || {});
  t.after(() => {
    writeTable("evermarksCatalog", catalogBackup);
    writeTable("evermarkEntitlements", entitlementsBackup);
    resetEvermarksCaches();
    database.flushAllSync();
  });

  const drakeLookup = resolveShipByName("Drake");
  assert.equal(drakeLookup.success, true, "Expected Drake to resolve from ship static data");

  seedCatalog([
    {
      fsdTypeID: 99514611,
      shipTypeID: drakeLookup.match.typeID,
      cosmeticType: 1,
      name: "Drake Corporation Emblem",
    },
    {
      fsdTypeID: 99514612,
      shipTypeID: drakeLookup.match.typeID,
      cosmeticType: 2,
      name: "Drake Alliance Emblem",
    },
  ]);
  seedEmptyEntitlements();
  resetEvermarksCaches();

  const result = chatCommands.executeChatCommand(
    {
      characterID: TEST_CHARACTER_ID,
      corporationID: 980090001,
      corpid: 980090001,
      allianceID: 990090001,
      allianceid: 990090001,
    },
    '/grantshipemblem both "Drake"',
    null,
    { emitChatFeedback: false },
  );

  assert.equal(result.handled, true);
  assert.match(result.message, /Granted corporation and alliance emblem licenses/i);
  assert.ok(
    getOwnedShipLogoEntitlement(
      TEST_CHARACTER_ID,
      drakeLookup.match.typeID,
      SHIP_LOGO_ENTITLEMENT_CORPORATION,
    ),
  );
  assert.ok(
    getOwnedShipLogoEntitlement(
      TEST_CHARACTER_ID,
      drakeLookup.match.typeID,
      SHIP_LOGO_ENTITLEMENT_ALLIANCE,
    ),
  );
});
