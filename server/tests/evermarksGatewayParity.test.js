const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const publicGatewayLocal = require(path.join(
  repoRoot,
  "server/src/_secondary/express/publicGatewayLocal",
));
const {
  buildEvermarksGatewayProtoRoot,
} = require(path.join(
  repoRoot,
  "server/src/services/evermarks/evermarksGatewayProto",
));
const {
  _testing: catalogTesting,
} = require(path.join(
  repoRoot,
  "server/src/services/evermarks/evermarksCatalog",
));
const {
  _testing: entitlementTesting,
} = require(path.join(
  repoRoot,
  "server/src/services/evermarks/evermarksEntitlements",
));

const ADMIN_CHARACTER_ID = 140000003;
const TARGET_CHARACTER_ID = 140000001;
const TEST_SHIP_TYPE_ID = 12753;
const TEST_ALLIANCE_SHIP_TYPE_ID = 20183;
const TEST_CORP_LICENSE_TYPE_ID = 75146;
const TEST_ALLIANCE_LICENSE_TYPE_ID = 75147;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

function resetEvermarksCaches() {
  catalogTesting.resetCache();
  entitlementTesting.resetCache();
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
      [String(TEST_CORP_LICENSE_TYPE_ID)]: {
        licenseID: TEST_CORP_LICENSE_TYPE_ID,
        fsdTypeID: TEST_CORP_LICENSE_TYPE_ID,
        shipTypeID: TEST_SHIP_TYPE_ID,
        cosmeticType: 1,
        slotGroup: 1,
        name: "Impel Corporation Emblem",
        published: true,
      },
      [String(TEST_ALLIANCE_LICENSE_TYPE_ID)]: {
        licenseID: TEST_ALLIANCE_LICENSE_TYPE_ID,
        fsdTypeID: TEST_ALLIANCE_LICENSE_TYPE_ID,
        shipTypeID: TEST_ALLIANCE_SHIP_TYPE_ID,
        cosmeticType: 2,
        slotGroup: 1,
        name: "Providence Alliance Emblem",
        published: true,
      },
    },
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

function decodeGrpcFramePayload(frame) {
  assert.equal(frame[0], 0);
  const payloadLength = frame.readUInt32BE(1);
  assert.equal(frame.length, payloadLength + 5);
  return frame.subarray(5);
}

class FakeGatewayNoticeStream extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.closed = false;
    this.frames = [];
  }

  respond() {}

  sendTrailers() {}

  write(buffer) {
    this.frames.push(Buffer.from(buffer));
    return true;
  }

  end() {
    this.closed = true;
  }
}

function decodeGatewayNotices(stream) {
  const NoticeEnvelope = publicGatewayLocal._testing.PROTO_ROOT.lookupType(
    "eve_public.Notice",
  );
  return stream.frames.map((frame) =>
    NoticeEnvelope.decode(decodeGrpcFramePayload(frame)),
  );
}

function encodeMessage(messageType, payload = {}) {
  return Buffer.from(messageType.encode(messageType.create(payload)).finish());
}

test("EverMarks entitlement gateway returns owned heraldry and publishes grant/revoke notices", (t) => {
  const evermarksCatalogBackup = cloneValue(
    database.read("evermarksCatalog", "/").data || {},
  );
  const entitlementsBackup = cloneValue(
    database.read("evermarkEntitlements", "/").data || {},
  );

  t.after(() => {
    writeTable("evermarksCatalog", evermarksCatalogBackup);
    writeTable("evermarkEntitlements", entitlementsBackup);
    resetEvermarksCaches();
    database.flushAllSync();
  });

  seedCatalogFixture();
  seedEmptyEntitlements();
  resetEvermarksCaches();

  const protoRoot = buildEvermarksGatewayProtoRoot();
  const CorpGrantRequest = protoRoot.lookupType(
    "eve_public.entitlement.character.ship.admin.corplogo.GrantRequest",
  );
  const AllianceGrantRequest = protoRoot.lookupType(
    "eve_public.entitlement.character.ship.admin.alliancelogo.GrantRequest",
  );
  const CorpRevokeRequest = protoRoot.lookupType(
    "eve_public.entitlement.character.ship.admin.corplogo.RevokeRequest",
  );
  const GetAllResponse = protoRoot.lookupType(
    "eve_public.entitlement.character.GetAllResponse",
  );
  const CorpGrantedNotice = protoRoot.lookupType(
    "eve_public.entitlement.character.ship.corplogo.GrantedNotice",
  );
  const AllianceGrantedNotice = protoRoot.lookupType(
    "eve_public.entitlement.character.ship.alliancelogo.GrantedNotice",
  );
  const CorpRevokedNotice = protoRoot.lookupType(
    "eve_public.entitlement.character.ship.corplogo.RevokedNotice",
  );

  const stream = new FakeGatewayNoticeStream();
  assert.equal(
    publicGatewayLocal.handleGatewayStream(stream, {
      ":path": "/eve_public.gateway.Notices/Consume",
    }),
    true,
  );
  t.after(() => {
    stream.emit("close");
  });

  const corpGrantResponse = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.entitlement.character.ship.admin.corplogo.GrantRequest",
        encodeMessage(CorpGrantRequest, {
          entitlement: {
            character: { sequential: TARGET_CHARACTER_ID },
            ship_type: { sequential: TEST_SHIP_TYPE_ID },
          },
        }),
        ADMIN_CHARACTER_ID,
      ),
    ),
  );
  assert.equal(corpGrantResponse.status_code, 200);

  const allianceGrantResponse = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.entitlement.character.ship.admin.alliancelogo.GrantRequest",
        encodeMessage(AllianceGrantRequest, {
          entitlement: {
            character: { sequential: TARGET_CHARACTER_ID },
            ship_type: { sequential: TEST_ALLIANCE_SHIP_TYPE_ID },
          },
        }),
        ADMIN_CHARACTER_ID,
      ),
    ),
  );
  assert.equal(allianceGrantResponse.status_code, 200);

  const getAllResponse = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.entitlement.character.GetAllRequest",
        Buffer.alloc(0),
        TARGET_CHARACTER_ID,
      ),
    ),
  );
  assert.equal(getAllResponse.status_code, 200);
  const getAllPayload = GetAllResponse.decode(getAllResponse.payload.value);
  assert.equal(getAllPayload.entitlements.length, 2);
  assert.equal(
    getAllPayload.entitlements.some(
      (entry) =>
        entry.corporation_logo &&
        Number(entry.corporation_logo.ship_type.sequential) === TEST_SHIP_TYPE_ID,
    ),
    true,
  );
  assert.equal(
    getAllPayload.entitlements.some(
      (entry) =>
        entry.alliance_logo &&
        Number(entry.alliance_logo.ship_type.sequential) === TEST_ALLIANCE_SHIP_TYPE_ID,
    ),
    true,
  );

  const noticesAfterGrant = decodeGatewayNotices(stream);
  const corpGranted = noticesAfterGrant.find(
    (notice) =>
      notice.payload.type_url ===
      "type.googleapis.com/eve_public.entitlement.character.ship.corplogo.GrantedNotice",
  );
  const allianceGranted = noticesAfterGrant.find(
    (notice) =>
      notice.payload.type_url ===
      "type.googleapis.com/eve_public.entitlement.character.ship.alliancelogo.GrantedNotice",
  );
  assert.ok(corpGranted);
  assert.ok(allianceGranted);
  assert.equal(Number(corpGranted.target_group.character), TARGET_CHARACTER_ID);
  assert.equal(Number(allianceGranted.target_group.character), TARGET_CHARACTER_ID);
  assert.equal(
    Number(
      CorpGrantedNotice.decode(corpGranted.payload.value).entitlement.ship_type.sequential,
    ),
    TEST_SHIP_TYPE_ID,
  );
  assert.equal(
    Number(
      AllianceGrantedNotice.decode(allianceGranted.payload.value).entitlement.ship_type.sequential,
    ),
    TEST_ALLIANCE_SHIP_TYPE_ID,
  );

  stream.frames = [];
  const corpRevokeResponse = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.entitlement.character.ship.admin.corplogo.RevokeRequest",
        encodeMessage(CorpRevokeRequest, {
          entitlement: {
            character: { sequential: TARGET_CHARACTER_ID },
            ship_type: { sequential: TEST_SHIP_TYPE_ID },
          },
        }),
        ADMIN_CHARACTER_ID,
      ),
    ),
  );
  assert.equal(corpRevokeResponse.status_code, 200);

  const revokeNotices = decodeGatewayNotices(stream);
  const revokedNotice = revokeNotices.find(
    (notice) =>
      notice.payload.type_url ===
      "type.googleapis.com/eve_public.entitlement.character.ship.corplogo.RevokedNotice",
  );
  assert.ok(revokedNotice);
  assert.equal(Number(revokedNotice.target_group.character), TARGET_CHARACTER_ID);
  assert.equal(
    Number(CorpRevokedNotice.decode(revokedNotice.payload.value).revoker.sequential),
    ADMIN_CHARACTER_ID,
  );

  const getAllAfterRevokeResponse = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.entitlement.character.GetAllRequest",
        Buffer.alloc(0),
        TARGET_CHARACTER_ID,
      ),
    ),
  );
  const getAllAfterRevokePayload = GetAllResponse.decode(
    getAllAfterRevokeResponse.payload.value,
  );
  assert.equal(getAllAfterRevokePayload.entitlements.length, 1);
  assert.equal(
    getAllAfterRevokePayload.entitlements[0].alliance_logo &&
      Number(getAllAfterRevokePayload.entitlements[0].alliance_logo.ship_type.sequential),
    TEST_ALLIANCE_SHIP_TYPE_ID,
  );
});
