const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const publicGatewayLocal = require(path.join(
  repoRoot,
  "server/src/_secondary/express/publicGatewayLocal",
));
const destiny = require(path.join(repoRoot, "server/src/space/destiny"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const ShipCosmeticsMgrService = require(path.join(
  repoRoot,
  "server/src/services/ship/shipCosmeticsMgrService",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const {
  getActiveShipRecord,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));
const {
  COSMETIC_TYPE_ALLIANCE_LOGO,
  COSMETIC_TYPE_CORPORATION_LOGO,
  SHIP_LOGO_ENTITLEMENT_ALLIANCE,
  SHIP_LOGO_ENTITLEMENT_CORPORATION,
} = require(path.join(
  repoRoot,
  "server/src/services/evermarks/evermarksConstants",
));
const {
  grantShipLogoEntitlement,
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
  buildShipLogoGatewayProtoRoot,
} = require(path.join(
  repoRoot,
  "server/src/services/ship/shipLogoGatewayProto",
));
const {
  _testing: shipLogoFittingTesting,
} = require(path.join(
  repoRoot,
  "server/src/services/ship/shipLogoFittingState",
));

const ACTIVE_CHARACTER_ID = 140000001;
const CORP_BACKEND_SLOT = 64;
const ALLIANCE_BACKEND_SLOT = 65;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

function resetCaches() {
  catalogTesting.resetCache();
  entitlementTesting.resetCache();
  shipLogoFittingTesting.resetCache();
}

function buildGatewayEnvelope(
  typeName,
  payloadBuffer = Buffer.alloc(0),
  activeCharacterID = 0,
) {
  const envelope = publicGatewayLocal._testing.RequestEnvelope.create({
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

function buildSession(characterID) {
  return {
    characterID,
    _space: {
      systemID: 30000142,
    },
    socket: {
      destroyed: false,
    },
    notifications: [],
    sendNotification(notifyType, idType, payloadTuple = []) {
      this.notifications.push({
        notifyType,
        idType,
        payloadTuple,
      });
    },
  };
}

test("ship emblem gateway equips and clears corp/alliance logos with live client notifications", (t) => {
  const evermarksCatalogBackup = cloneValue(
    database.read("evermarksCatalog", "/").data || {},
  );
  const entitlementsBackup = cloneValue(
    database.read("evermarkEntitlements", "/").data || {},
  );
  const shipLogoFittingsBackup = cloneValue(
    database.read("shipLogoFittings", "/").data || {},
  );

  t.after(() => {
    writeTable("evermarksCatalog", evermarksCatalogBackup);
    writeTable("evermarkEntitlements", entitlementsBackup);
    writeTable("shipLogoFittings", shipLogoFittingsBackup);
    resetCaches();
    database.flushAllSync();
  });

  const activeShip = getActiveShipRecord(ACTIVE_CHARACTER_ID);
  assert.ok(activeShip && activeShip.itemID && activeShip.typeID);

  writeTable("evermarksCatalog", {
    meta: {
      version: 1,
      description: "Cached EverMarks heraldry emblem offers and ship-logo metadata.",
      generatedAt: null,
      sourceAuthority: "test",
    },
    licensesByTypeID: {
      "99146001": {
        licenseID: 99146001,
        fsdTypeID: 99146001,
        shipTypeID: activeShip.typeID,
        cosmeticType: COSMETIC_TYPE_CORPORATION_LOGO,
        slotGroup: 1,
        name: "Parity Test Corporation Emblem",
        published: true,
      },
      "99146002": {
        licenseID: 99146002,
        fsdTypeID: 99146002,
        shipTypeID: activeShip.typeID,
        cosmeticType: COSMETIC_TYPE_ALLIANCE_LOGO,
        slotGroup: 1,
        name: "Parity Test Alliance Emblem",
        published: true,
      },
    },
    offersByOfferID: {},
    offerIDsByTypeID: {},
  });
  writeTable("evermarkEntitlements", {
    meta: {
      version: 1,
      description: "DB-backed EverMarks ship-logo entitlements.",
      updatedAt: null,
    },
    characters: {},
  });
  writeTable("shipLogoFittings", {
    meta: {
      version: 1,
      description: "DB-backed ship emblem fitting state keyed by ship and backend slot.",
      updatedAt: null,
    },
    ships: {},
  });
  resetCaches();

  assert.equal(
    grantShipLogoEntitlement(
      ACTIVE_CHARACTER_ID,
      activeShip.typeID,
      SHIP_LOGO_ENTITLEMENT_CORPORATION,
      { source: "test_seed" },
    ).success,
    true,
  );
  assert.equal(
    grantShipLogoEntitlement(
      ACTIVE_CHARACTER_ID,
      activeShip.typeID,
      SHIP_LOGO_ENTITLEMENT_ALLIANCE,
      { source: "test_seed" },
    ).success,
    true,
  );

  const protoRoot = buildShipLogoGatewayProtoRoot();
  const DisplayRequest = protoRoot.lookupType(
    "eve_public.cosmetic.ship.logo.DisplayRequest",
  );
  const ClearRequest = protoRoot.lookupType(
    "eve_public.cosmetic.ship.logo.ClearRequest",
  );
  const session = buildSession(ACTIVE_CHARACTER_ID);
  const slimRefreshCalls = [];
  const fakeScene = {
    systemID: 30000142,
    dynamicEntities: new Map([
      [activeShip.itemID, { itemID: activeShip.itemID, kind: "ship" }],
    ]),
    broadcastSlimItemChanges(entities) {
      slimRefreshCalls.push(entities.map((entity) => entity.itemID));
    },
  };
  spaceRuntime.scenes.set(30000142, fakeScene);
  sessionRegistry.register(session);
  t.after(() => {
    spaceRuntime.scenes.delete(30000142);
    sessionRegistry.unregister(session);
  });

  const corpDisplayResponse = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.ship.logo.DisplayRequest",
        Buffer.from(
          DisplayRequest.encode(
            DisplayRequest.create({
              id: {
                ship: { sequential: activeShip.itemID },
                index: CORP_BACKEND_SLOT,
              },
              attr: {
                corporation: {},
              },
            }),
          ).finish(),
        ),
        ACTIVE_CHARACTER_ID,
      ),
    ),
  );
  assert.equal(corpDisplayResponse.status_code, 200);

  const mgrService = new ShipCosmeticsMgrService();
  assert.deepEqual(
    mgrService.Handle_GetEnabledCosmetics([activeShip.itemID], {
      characterID: ACTIVE_CHARACTER_ID,
    }),
    {
      type: "dict",
      entries: [[CORP_BACKEND_SLOT, COSMETIC_TYPE_CORPORATION_LOGO]],
    },
  );

  const allianceDisplayResponse = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.ship.logo.DisplayRequest",
        Buffer.from(
          DisplayRequest.encode(
            DisplayRequest.create({
              id: {
                ship: { sequential: activeShip.itemID },
                index: ALLIANCE_BACKEND_SLOT,
              },
              attr: {
                alliance: {},
              },
            }),
          ).finish(),
        ),
        ACTIVE_CHARACTER_ID,
      ),
    ),
  );
  assert.equal(allianceDisplayResponse.status_code, 200);

  assert.deepEqual(
    mgrService.Handle_GetEnabledCosmetics([activeShip.itemID], {
      characterID: ACTIVE_CHARACTER_ID,
    }),
    {
      type: "dict",
      entries: [
        [CORP_BACKEND_SLOT, COSMETIC_TYPE_CORPORATION_LOGO],
        [ALLIANCE_BACKEND_SLOT, COSMETIC_TYPE_ALLIANCE_LOGO],
      ],
    },
  );

  const clearResponse = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.ship.logo.ClearRequest",
        Buffer.from(
          ClearRequest.encode(
            ClearRequest.create({
              logo: {
                ship: { sequential: activeShip.itemID },
                index: CORP_BACKEND_SLOT,
              },
            }),
          ).finish(),
        ),
        ACTIVE_CHARACTER_ID,
      ),
    ),
  );
  assert.equal(clearResponse.status_code, 200);
  assert.deepEqual(
    mgrService.Handle_GetEnabledCosmetics([activeShip.itemID], {
      characterID: ACTIVE_CHARACTER_ID,
    }),
    {
      type: "dict",
      entries: [[ALLIANCE_BACKEND_SLOT, COSMETIC_TYPE_ALLIANCE_LOGO]],
    },
  );

  const cosmeticChangedNotifications = session.notifications.filter(
    (entry) => entry.notifyType === "OnShipCosmeticChanged",
  );
  const cosmeticsChangedNotifications = session.notifications.filter(
    (entry) => entry.notifyType === "OnShipCosmeticsChanged",
  );
  assert.deepEqual(
    cosmeticChangedNotifications.map((entry) => entry.payloadTuple),
    [
      [activeShip.itemID, CORP_BACKEND_SLOT, COSMETIC_TYPE_CORPORATION_LOGO],
      [activeShip.itemID, ALLIANCE_BACKEND_SLOT, COSMETIC_TYPE_ALLIANCE_LOGO],
      [activeShip.itemID, CORP_BACKEND_SLOT, null],
    ],
  );
  assert.equal(cosmeticsChangedNotifications.length, 3);
  assert.deepEqual(cosmeticsChangedNotifications[0].payloadTuple[1], {
    type: "dict",
    entries: [[CORP_BACKEND_SLOT, COSMETIC_TYPE_CORPORATION_LOGO]],
  });
  assert.deepEqual(cosmeticsChangedNotifications[1].payloadTuple[1], {
    type: "dict",
    entries: [
      [CORP_BACKEND_SLOT, COSMETIC_TYPE_CORPORATION_LOGO],
      [ALLIANCE_BACKEND_SLOT, COSMETIC_TYPE_ALLIANCE_LOGO],
    ],
  });
  assert.deepEqual(cosmeticsChangedNotifications[2].payloadTuple[1], {
    type: "dict",
    entries: [[ALLIANCE_BACKEND_SLOT, COSMETIC_TYPE_ALLIANCE_LOGO]],
  });
  assert.deepEqual(slimRefreshCalls, [
    [activeShip.itemID],
    [activeShip.itemID],
    [activeShip.itemID],
  ]);
});

test("ship emblem gateway rejects display requests when the character lacks the ship logo entitlement", (t) => {
  const evermarksCatalogBackup = cloneValue(
    database.read("evermarksCatalog", "/").data || {},
  );
  const entitlementsBackup = cloneValue(
    database.read("evermarkEntitlements", "/").data || {},
  );
  const shipLogoFittingsBackup = cloneValue(
    database.read("shipLogoFittings", "/").data || {},
  );

  t.after(() => {
    writeTable("evermarksCatalog", evermarksCatalogBackup);
    writeTable("evermarkEntitlements", entitlementsBackup);
    writeTable("shipLogoFittings", shipLogoFittingsBackup);
    resetCaches();
    database.flushAllSync();
  });

  const activeShip = getActiveShipRecord(ACTIVE_CHARACTER_ID);
  assert.ok(activeShip && activeShip.itemID && activeShip.typeID);

  writeTable("evermarksCatalog", {
    meta: {
      version: 1,
      description: "Cached EverMarks heraldry emblem offers and ship-logo metadata.",
      generatedAt: null,
      sourceAuthority: "test",
    },
    licensesByTypeID: {
      "99146001": {
        licenseID: 99146001,
        fsdTypeID: 99146001,
        shipTypeID: activeShip.typeID,
        cosmeticType: COSMETIC_TYPE_CORPORATION_LOGO,
        slotGroup: 1,
        name: "Parity Test Corporation Emblem",
        published: true,
      },
    },
    offersByOfferID: {},
    offerIDsByTypeID: {},
  });
  writeTable("evermarkEntitlements", {
    meta: {
      version: 1,
      description: "DB-backed EverMarks ship-logo entitlements.",
      updatedAt: null,
    },
    characters: {},
  });
  writeTable("shipLogoFittings", {
    meta: {
      version: 1,
      description: "DB-backed ship emblem fitting state keyed by ship and backend slot.",
      updatedAt: null,
    },
    ships: {},
  });
  resetCaches();

  const protoRoot = buildShipLogoGatewayProtoRoot();
  const DisplayRequest = protoRoot.lookupType(
    "eve_public.cosmetic.ship.logo.DisplayRequest",
  );

  const response = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.ship.logo.DisplayRequest",
        Buffer.from(
          DisplayRequest.encode(
            DisplayRequest.create({
              id: {
                ship: { sequential: activeShip.itemID },
                index: CORP_BACKEND_SLOT,
              },
              attr: {
                corporation: {},
              },
            }),
          ).finish(),
        ),
        ACTIVE_CHARACTER_ID,
      ),
    ),
  );
  assert.equal(response.status_code, 403);
});

test("ship slim items expose cosmeticsItems so undock and space refresh use the emblem list", (t) => {
  const shipLogoFittingsBackup = cloneValue(
    database.read("shipLogoFittings", "/").data || {},
  );

  t.after(() => {
    writeTable("shipLogoFittings", shipLogoFittingsBackup);
    resetCaches();
    database.flushAllSync();
  });

  const activeShip = getActiveShipRecord(ACTIVE_CHARACTER_ID);
  assert.ok(activeShip && activeShip.itemID && activeShip.typeID);

  writeTable("shipLogoFittings", {
    meta: {
      version: 1,
      description: "DB-backed ship emblem fitting state keyed by ship and backend slot.",
      updatedAt: null,
    },
    ships: {
      [String(activeShip.itemID)]: {
        enabledByBackendSlot: {
          [String(CORP_BACKEND_SLOT)]: {
            shipID: activeShip.itemID,
            backendSlot: CORP_BACKEND_SLOT,
            cosmeticType: COSMETIC_TYPE_CORPORATION_LOGO,
          },
          [String(ALLIANCE_BACKEND_SLOT)]: {
            shipID: activeShip.itemID,
            backendSlot: ALLIANCE_BACKEND_SLOT,
            cosmeticType: COSMETIC_TYPE_ALLIANCE_LOGO,
          },
        },
      },
    },
  });
  resetCaches();

  const entity = spaceRuntime._testing.buildRuntimeShipEntityForTesting({
    itemID: activeShip.itemID,
    typeID: activeShip.typeID,
    groupID: activeShip.groupID,
    categoryID: activeShip.categoryID,
    itemName: activeShip.itemName || "Ship",
    ownerID: activeShip.ownerID || ACTIVE_CHARACTER_ID,
    characterID: ACTIVE_CHARACTER_ID,
    pilotCharacterID: ACTIVE_CHARACTER_ID,
    corporationID: 98000002,
    allianceID: 99000001,
    conditionState: activeShip.conditionState || {},
  }, 30000142);
  spaceRuntime._testing.refreshShipPresentationFieldsForTesting(entity);

  const slimItem = destiny.buildSlimItemObject(entity);
  const slimEntries = new Map(slimItem.args.entries);
  assert.deepEqual(slimEntries.get("cosmeticsItems"), {
    type: "list",
    items: [
      COSMETIC_TYPE_CORPORATION_LOGO,
      COSMETIC_TYPE_ALLIANCE_LOGO,
    ],
  });
});
