const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const publicGatewayLocal = require(path.join(
  repoRoot,
  "server/src/_secondary/express/publicGatewayLocal",
));
const {
  buildStructurePaintworkProtoRoot,
} = require(path.join(
  repoRoot,
  "server/src/_secondary/express/gatewayServices/structurePaintworkGatewayService",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const {
  EVERMARK_ISSUER_CORP_ID,
  getCorporationWalletLPBalance,
  setCorporationWalletLPBalance,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/lpWalletState",
));
const {
  createStructure,
  removeStructure,
  setStructureUpkeepState,
  updateStructureRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const {
  STRUCTURE_UPKEEP_STATE,
  STRUCTURE_STATE,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureConstants",
));
const {
  revokeLicense,
  _testing: paintworkTesting,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structurePaintworkState",
));

const ACTIVE_CHARACTER_ID = 140000003;
const CORPORATION_ID = 98000000;
const QA_ROLE = 4503599627370496n;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
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

function buildSession(overrides = {}) {
  return {
    characterID: ACTIVE_CHARACTER_ID,
    corporationID: CORPORATION_ID,
    corpid: CORPORATION_ID,
    solarsystemid2: 30000142,
    solarsystemid: 30000142,
    role: 0n,
    socket: {
      destroyed: false,
    },
    sendNotification() {},
    ...overrides,
  };
}

test("structure paintwork spends corporation EverMarks and hides live paintwork when the structure loses full power", (t) => {
  const lpWalletsBackup = cloneValue(database.read("lpWallets", "/").data || {});
  const paintworkBackup = cloneValue(
    database.read("structurePaintwork", "/").data || {},
  );
  const session = buildSession({
    solarsystemid2: 30000142,
    solarsystemid: 30000142,
  });
  sessionRegistry.register(session);

  t.after(() => {
    sessionRegistry.unregister(session);
    database.write("lpWallets", "/", lpWalletsBackup);
    database.write("structurePaintwork", "/", paintworkBackup);
    paintworkTesting.resetCache();
    database.flushAllSync();
  });

  const protoRoot = buildStructurePaintworkProtoRoot();
  const GetCatalogueResponse = protoRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.license.api.GetCatalogueResponse",
  );
  const IssueRequest = protoRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.license.api.IssueRequest",
  );
  const IssueResponse = protoRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.license.api.IssueResponse",
  );
  const GetAllOwnedByCorporationResponse = protoRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.license.api.GetAllOwnedByCorporationResponse",
  );
  const PaintworkGetRequest = protoRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.api.GetRequest",
  );
  const PaintworkGetResponse = protoRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.api.GetResponse",
  );
  const PaintworkGetAllResponse = protoRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.api.GetAllInSolarSystemResponse",
  );

  setCorporationWalletLPBalance(
    CORPORATION_ID,
    EVERMARK_ISSUER_CORP_ID,
    10000000,
    { reason: "test_seed" },
  );

  const createdStructure = createStructure({
    typeID: 35832,
    name: "StructurePaintworkParityAstrahus",
    itemName: "StructurePaintworkParityAstrahus",
    ownerCorpID: CORPORATION_ID,
    ownerID: CORPORATION_ID,
    solarSystemID: 30000142,
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    position: { x: 0, y: 0, z: 0 },
  });
  assert.equal(createdStructure.success, true);
  const structureID = Number(createdStructure.data.structureID || 0);
  let issuedLicenseID = null;

  t.after(() => {
    if (issuedLicenseID) {
      revokeLicense(ACTIVE_CHARACTER_ID, issuedLicenseID);
    }
    removeStructure(structureID);
  });

  const catalogueEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.structure.paintwork.license.api.GetCatalogueRequest",
        Buffer.alloc(0),
        ACTIVE_CHARACTER_ID,
      ),
    ),
  );
  const cataloguePayload = GetCatalogueResponse.decode(
    catalogueEnvelope.payload.value,
  );
  const astrahusThirtyDay = cataloguePayload.items.find(
    (item) =>
      Number(item.structure_type.sequential) === 35832 &&
      Number(item.duration.seconds) === 2592000,
  );
  assert.ok(astrahusThirtyDay);

  const walletBeforeIssue = getCorporationWalletLPBalance(
    CORPORATION_ID,
    EVERMARK_ISSUER_CORP_ID,
  );
  const issueEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.structure.paintwork.license.api.IssueRequest",
        Buffer.from(
          IssueRequest.encode(
            IssueRequest.create({
              paintwork: {
                primary: { paint: 12 },
                secondary: { empty: true },
                detailing: { paint: 24 },
              },
              duration: { seconds: 2592000 },
              structures: [{ sequential: structureID }],
            }),
          ).finish(),
        ),
        ACTIVE_CHARACTER_ID,
      ),
    ),
  );
  const issuePayload = IssueResponse.decode(issueEnvelope.payload.value);
  assert.equal(issueEnvelope.status_code, 200);
  assert.equal(
    getCorporationWalletLPBalance(CORPORATION_ID, EVERMARK_ISSUER_CORP_ID),
    walletBeforeIssue - Number(astrahusThirtyDay.price.amount),
  );

  {
    const hex = Buffer.from(issuePayload.licenses[0].id.uuid).toString("hex");
    issuedLicenseID = [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join("-");
  }

  const ownedEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.structure.paintwork.license.api.GetAllOwnedByCorporationRequest",
        Buffer.alloc(0),
        ACTIVE_CHARACTER_ID,
      ),
    ),
  );
  const ownedPayload = GetAllOwnedByCorporationResponse.decode(
    ownedEnvelope.payload.value,
  );
  assert.equal(
    ownedPayload.licenses.some(
      (entry) => Number(entry.attributes.structure.sequential) === structureID,
    ),
    true,
  );

  const liveBeforeLowPower = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.structure.paintwork.api.GetRequest",
        Buffer.from(
          PaintworkGetRequest.encode(
            PaintworkGetRequest.create({
              structure: { sequential: structureID },
              solar_system: { sequential: 30000142 },
            }),
          ).finish(),
        ),
        ACTIVE_CHARACTER_ID,
      ),
    ),
  );
  const liveBeforeLowPowerPayload = PaintworkGetResponse.decode(
    liveBeforeLowPower.payload.value,
  );
  assert.equal(liveBeforeLowPower.status_code, 200);
  assert.equal(Number(liveBeforeLowPowerPayload.paintwork.primary.paint), 12);

  const lowPowerResult = setStructureUpkeepState(
    structureID,
    STRUCTURE_UPKEEP_STATE.LOW_POWER,
  );
  assert.equal(lowPowerResult.success, true);

  const ownedWhileLowPowerEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.structure.paintwork.license.api.GetAllOwnedByCorporationRequest",
        Buffer.alloc(0),
        ACTIVE_CHARACTER_ID,
      ),
    ),
  );
  const ownedWhileLowPowerPayload = GetAllOwnedByCorporationResponse.decode(
    ownedWhileLowPowerEnvelope.payload.value,
  );
  assert.equal(
    ownedWhileLowPowerPayload.licenses.some(
      (entry) => Number(entry.attributes.structure.sequential) === structureID,
    ),
    true,
  );

  const liveWhileLowPower = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.structure.paintwork.api.GetRequest",
        Buffer.from(
          PaintworkGetRequest.encode(
            PaintworkGetRequest.create({
              structure: { sequential: structureID },
              solar_system: { sequential: 30000142 },
            }),
          ).finish(),
        ),
        ACTIVE_CHARACTER_ID,
      ),
    ),
  );
  assert.equal(liveWhileLowPower.status_code, 404);

  const liveAllWhileLowPower = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.structure.paintwork.api.GetAllInSolarSystemRequest",
        Buffer.alloc(0),
        ACTIVE_CHARACTER_ID,
      ),
    ),
  );
  const liveAllWhileLowPowerPayload = PaintworkGetAllResponse.decode(
    liveAllWhileLowPower.payload.value,
  );
  assert.equal(
    liveAllWhileLowPowerPayload.paintworks.some(
      (entry) => Number(entry.structure.sequential) === structureID,
    ),
    false,
  );

  const fullPowerResult = setStructureUpkeepState(
    structureID,
    STRUCTURE_UPKEEP_STATE.FULL_POWER,
  );
  assert.equal(fullPowerResult.success, true);

  const liveAfterRestore = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.structure.paintwork.api.GetRequest",
        Buffer.from(
          PaintworkGetRequest.encode(
            PaintworkGetRequest.create({
              structure: { sequential: structureID },
              solar_system: { sequential: 30000142 },
            }),
          ).finish(),
        ),
        ACTIVE_CHARACTER_ID,
      ),
    ),
  );
  assert.equal(liveAfterRestore.status_code, 200);
});

test("structure paintwork licenses are pruned if the structure changes ownership", (t) => {
  const lpWalletsBackup = cloneValue(database.read("lpWallets", "/").data || {});
  const paintworkBackup = cloneValue(
    database.read("structurePaintwork", "/").data || {},
  );
  const session = buildSession();
  sessionRegistry.register(session);

  t.after(() => {
    sessionRegistry.unregister(session);
    database.write("lpWallets", "/", lpWalletsBackup);
    database.write("structurePaintwork", "/", paintworkBackup);
    paintworkTesting.resetCache();
    database.flushAllSync();
  });

  const protoRoot = buildStructurePaintworkProtoRoot();
  const IssueRequest = protoRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.license.api.IssueRequest",
  );
  const IssueResponse = protoRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.license.api.IssueResponse",
  );
  const LicenseGetRequest = protoRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.license.api.GetRequest",
  );
  const GetAllOwnedByCorporationResponse = protoRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.license.api.GetAllOwnedByCorporationResponse",
  );

  setCorporationWalletLPBalance(
    CORPORATION_ID,
    EVERMARK_ISSUER_CORP_ID,
    10000000,
    { reason: "test_seed" },
  );

  const createdStructure = createStructure({
    typeID: 35832,
    name: "StructurePaintworkOwnershipTransfer",
    itemName: "StructurePaintworkOwnershipTransfer",
    ownerCorpID: CORPORATION_ID,
    ownerID: CORPORATION_ID,
    solarSystemID: 30000142,
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    position: { x: 0, y: 0, z: 0 },
  });
  assert.equal(createdStructure.success, true);
  const structureID = Number(createdStructure.data.structureID || 0);
  let issuedLicenseID = null;

  t.after(() => {
    removeStructure(structureID);
  });

  const issueEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.structure.paintwork.license.api.IssueRequest",
        Buffer.from(
          IssueRequest.encode(
            IssueRequest.create({
              paintwork: {
                primary: { paint: 33 },
              },
              duration: { seconds: 2592000 },
              structures: [{ sequential: structureID }],
            }),
          ).finish(),
        ),
        ACTIVE_CHARACTER_ID,
      ),
    ),
  );
  const issuePayload = IssueResponse.decode(issueEnvelope.payload.value);
  assert.equal(issueEnvelope.status_code, 200);
  {
    const hex = Buffer.from(issuePayload.licenses[0].id.uuid).toString("hex");
    issuedLicenseID = [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join("-");
  }

  const transferResult = updateStructureRecord(structureID, (current) => ({
    ...current,
    ownerCorpID: 98000001,
    ownerID: 98000001,
  }));
  assert.equal(transferResult.success, true);

  const ownedAfterTransfer = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.structure.paintwork.license.api.GetAllOwnedByCorporationRequest",
        Buffer.alloc(0),
        ACTIVE_CHARACTER_ID,
      ),
    ),
  );
  const ownedAfterTransferPayload = GetAllOwnedByCorporationResponse.decode(
    ownedAfterTransfer.payload.value,
  );
  assert.equal(
    ownedAfterTransferPayload.licenses.some(
      (entry) => Number(entry.attributes.structure.sequential) === structureID,
    ),
    false,
  );

  const getAfterTransfer = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.structure.paintwork.license.api.GetRequest",
        Buffer.from(
          LicenseGetRequest.encode(
            LicenseGetRequest.create({
              id: {
                uuid: Buffer.from(issuedLicenseID.replace(/-/g, ""), "hex"),
              },
            }),
          ).finish(),
        ),
        ACTIVE_CHARACTER_ID,
      ),
    ),
  );
  assert.equal(getAfterTransfer.status_code, 404);
});

test("structure paintwork admin issue requests allow custom prices and non-catalogue durations for QA sessions", (t) => {
  const lpWalletsBackup = cloneValue(database.read("lpWallets", "/").data || {});
  const paintworkBackup = cloneValue(
    database.read("structurePaintwork", "/").data || {},
  );
  const session = buildSession({
    role: QA_ROLE,
  });
  sessionRegistry.register(session);

  t.after(() => {
    sessionRegistry.unregister(session);
    database.write("lpWallets", "/", lpWalletsBackup);
    database.write("structurePaintwork", "/", paintworkBackup);
    paintworkTesting.resetCache();
    database.flushAllSync();
  });

  const protoRoot = buildStructurePaintworkProtoRoot();
  const AdminIssueRequest = protoRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.license.api.admin.IssueRequest",
  );
  const AdminIssueResponse = protoRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.license.api.admin.IssueResponse",
  );

  setCorporationWalletLPBalance(
    CORPORATION_ID,
    EVERMARK_ISSUER_CORP_ID,
    10000000,
    { reason: "test_seed" },
  );

  const createdStructure = createStructure({
    typeID: 35832,
    name: "StructurePaintworkAdminIssue",
    itemName: "StructurePaintworkAdminIssue",
    ownerCorpID: CORPORATION_ID,
    ownerID: CORPORATION_ID,
    solarSystemID: 30000142,
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    position: { x: 0, y: 0, z: 0 },
  });
  assert.equal(createdStructure.success, true);
  const structureID = Number(createdStructure.data.structureID || 0);
  let issuedLicenseID = null;

  t.after(() => {
    if (issuedLicenseID) {
      revokeLicense(ACTIVE_CHARACTER_ID, issuedLicenseID, { adminRequest: true });
    }
    removeStructure(structureID);
  });

  const walletBeforeIssue = getCorporationWalletLPBalance(
    CORPORATION_ID,
    EVERMARK_ISSUER_CORP_ID,
  );
  const issueEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.structure.paintwork.license.api.admin.IssueRequest",
        Buffer.from(
          AdminIssueRequest.encode(
            AdminIssueRequest.create({
              paintwork: {
                primary: { paint: 88 },
              },
              duration: { seconds: 7200 },
              structures: [{ sequential: structureID }],
              price: {
                amount: 1234,
                associated_corporation: { sequential: EVERMARK_ISSUER_CORP_ID },
              },
            }),
          ).finish(),
        ),
        ACTIVE_CHARACTER_ID,
      ),
    ),
  );
  const issuePayload = AdminIssueResponse.decode(issueEnvelope.payload.value);
  assert.equal(issueEnvelope.status_code, 200);
  assert.equal(issuePayload.licenses.length, 1);
  assert.equal(
    getCorporationWalletLPBalance(CORPORATION_ID, EVERMARK_ISSUER_CORP_ID),
    walletBeforeIssue - 1234,
  );
  {
    const hex = Buffer.from(issuePayload.licenses[0].id.uuid).toString("hex");
    issuedLicenseID = [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join("-");
  }
});
