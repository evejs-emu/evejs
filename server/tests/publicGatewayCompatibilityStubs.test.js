const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("path");
const protobuf = require("protobufjs");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const publicGatewayLocal = require(path.join(
  repoRoot,
  "server/src/_secondary/express/publicGatewayLocal",
));
const {
  ACTIVE_PROJECT_CAPACITY,
} = require(path.join(
  repoRoot,
  "server/src/_secondary/express/gatewayServices/corpGoalsGatewayService",
));
const {
  FREELANCE_CREATION_PRICES,
  FREELANCE_LIMITS,
} = require(path.join(
  repoRoot,
  "server/src/_secondary/express/gatewayServices/freelanceGatewayService",
));
const {
  buildStructurePaintworkProtoRoot,
} = require(path.join(
  repoRoot,
  "server/src/_secondary/express/gatewayServices/structurePaintworkGatewayService",
));
const {
  REQUEST_RESPONSE_TYPES: CAMPAIGN_REQUEST_RESPONSE_TYPES,
} = require(path.join(
  repoRoot,
  "server/src/_secondary/express/gatewayServices/campaignGatewayService",
));
const {
  getCorporationRuntime,
  updateCorporationRuntime,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/corporationRuntimeState",
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
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const {
  STRUCTURE_STATE,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureConstants",
));
const {
  revokeLicense,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structurePaintworkState",
));

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

function buildGatewayDecodeRoot() {
  const root = new protobuf.Root();
  root.define("google.protobuf").add(
    new protobuf.Type("Duration").add(
      new protobuf.Field("seconds", 1, "int64"),
    ),
  );
  root.define("eve_public.isk").add(
    new protobuf.Type("Currency")
      .add(new protobuf.Field("units", 1, "uint64"))
      .add(new protobuf.Field("nanos", 2, "int32")),
  );
  root.define("eve_public.goal.api").add(
    new protobuf.Type("GetCapacityResponse")
      .add(new protobuf.Field("count", 1, "uint32"))
      .add(new protobuf.Field("capacity", 2, "uint32")),
  );
  root.define("eve_public.freelance.project").add(
    new protobuf.Type("CreationPrices")
      .add(
        new protobuf.Field(
          "base_fee_per_day",
          1,
          "eve_public.isk.Currency",
        ),
      )
      .add(
        new protobuf.Field(
          "broadcasting_fee_per_day_per_location",
          2,
          "eve_public.isk.Currency",
        ),
      ),
  );
  root.define("eve_public.freelance.project.api").add(
    new protobuf.Type("GetCommitLimitsResponse")
      .add(
        new protobuf.Field(
          "max_active_projects_per_participant",
          1,
          "uint32",
        ),
      )
      .add(
        new protobuf.Field(
          "max_committed_participants_per_project",
          2,
          "uint32",
        ),
      ),
  );
  root.define("eve_public.freelance.project.api").add(
    new protobuf.Type("GetCreationLimitsResponse")
      .add(
        new protobuf.Field(
          "max_active_projects_per_corporation",
          1,
          "uint32",
        ),
      )
      .add(
        new protobuf.Field(
          "max_active_projects_broadcast_per_system",
          2,
          "uint32",
        ),
      )
      .add(new protobuf.Field("max_character_age_days", 3, "uint32"))
      .add(
        new protobuf.Field(
          "max_broadcasting_locations_per_project",
          4,
          "uint32",
        ),
      )
      .add(
        new protobuf.Field(
          "max_committed_participants_per_project",
          5,
          "uint32",
        ),
      )
      .add(new protobuf.Field("max_contribution_multiplier", 6, "double"))
      .add(
        new protobuf.Field(
          "max_project_duration",
          7,
          "google.protobuf.Duration",
        ),
      ),
  );
  root.define("eve_public.freelance.project.api").add(
    new protobuf.Type("GetCreationPricesResponse").add(
      new protobuf.Field("prices", 1, "eve_public.freelance.project.CreationPrices"),
    ),
  );
  return root;
}

const gatewayDecodeRoot = buildGatewayDecodeRoot();

class FakeGatewayNoticeStream extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.closed = false;
    this.frames = [];
    this.headers = [];
    this.trailers = [];
  }

  respond(headers) {
    this.headers.push(headers);
  }

  sendTrailers(trailers) {
    this.trailers.push(trailers);
  }

  write(buffer) {
    this.frames.push(Buffer.from(buffer));
    return true;
  }

  end() {
    this.closed = true;
  }
}

function decodeGrpcFramePayload(frame) {
  assert.equal(frame[0], 0);
  const payloadLength = frame.readUInt32BE(1);
  assert.equal(frame.length, payloadLength + 5);
  return frame.subarray(5);
}

test("public gateway empty-success mappings cover the missing compatibility requests", () => {
  const expectations = new Map([
    [
      "eve_public.career.goal.api.GetAllRequest",
      "eve_public.career.goal.api.GetAllResponse",
    ],
    [
      "eve_public.dailygoal.api.GetAllCurrentRequest",
      "eve_public.dailygoal.api.GetAllCurrentResponse",
    ],
    [
      "eve_public.dailygoal.api.GetAllWithRewardsRequest",
      "eve_public.dailygoal.api.GetAllWithRewardsResponse",
    ],
    [
      "eve_public.character.skill.plan.GetAllRequest",
      "eve_public.character.skill.plan.GetAllResponse",
    ],
    [
      "eve_public.character.skill.plan.SetActiveRequest",
      "eve_public.character.skill.plan.SetActiveResponse",
    ],
  ]);

  for (const [requestType, responseType] of expectations) {
    assert.equal(
      publicGatewayLocal._testing.getEmptySuccessResponseType(requestType),
      responseType,
    );
  }
});

test("public gateway exposes the corp-project request family expected by the corporation window", () => {
  const expectations = new Map([
    [
      "eve_public.goal.api.GetRequest",
      "eve_public.goal.api.GetResponse",
    ],
    [
      "eve_public.goal.api.GetAllRequest",
      "eve_public.goal.api.GetAllResponse",
    ],
    [
      "eve_public.goal.api.CreateRequest",
      "eve_public.goal.api.CreateResponse",
    ],
    [
      "eve_public.goal.api.CloseRequest",
      "eve_public.goal.api.CloseResponse",
    ],
    [
      "eve_public.goal.api.DeleteRequest",
      "eve_public.goal.api.DeleteResponse",
    ],
    [
      "eve_public.goal.api.SetCurrentProgressRequest",
      "eve_public.goal.api.SetCurrentProgressResponse",
    ],
    [
      "eve_public.corporationgoal.api.GetActiveRequest",
      "eve_public.corporationgoal.api.GetActiveResponse",
    ],
    [
      "eve_public.corporationgoal.api.GetInactiveRequest",
      "eve_public.corporationgoal.api.GetInactiveResponse",
    ],
    [
      "eve_public.corporationgoal.api.GetMineWithRewardsRequest",
      "eve_public.corporationgoal.api.GetMineWithRewardsResponse",
    ],
    [
      "eve_public.corporationgoal.api.GetContributorSummariesForGoalRequest",
      "eve_public.corporationgoal.api.GetContributorSummariesForGoalResponse",
    ],
    [
      "eve_public.corporationgoal.api.GetMyContributorSummaryForGoalRequest",
      "eve_public.corporationgoal.api.GetMyContributorSummaryForGoalResponse",
    ],
    [
      "eve_public.corporationgoal.api.RedeemMyRewardsRequest",
      "eve_public.corporationgoal.api.RedeemMyRewardsResponse",
    ],
  ]);

  for (const [requestType, responseType] of expectations) {
    assert.equal(
      publicGatewayLocal._testing.getEmptySuccessResponseType(requestType),
      responseType,
    );
  }
});

test("public gateway empty-success mappings cover the freelance read requests", () => {
  const expectations = new Map([
    [
      "eve_public.freelance.project.api.GetAllActiveForCorporationRequest",
      "eve_public.freelance.project.api.GetAllActiveForCorporationResponse",
    ],
    [
      "eve_public.freelance.project.api.GetAllCommittedRequest",
      "eve_public.freelance.project.api.GetAllCommittedResponse",
    ],
    [
      "eve_public.freelance.project.api.GetAllUnredeemedRequest",
      "eve_public.freelance.project.api.GetAllUnredeemedResponse",
    ],
    [
      "eve_public.freelance.project.api.GetAllBroadcastedRequest",
      "eve_public.freelance.project.api.GetAllBroadcastedResponse",
    ],
    [
      "eve_public.freelance.project.api.GetAllActiveRequest",
      "eve_public.freelance.project.api.GetAllActiveResponse",
    ],
    [
      "eve_public.freelance.project.api.GetAllInactiveRequest",
      "eve_public.freelance.project.api.GetAllInactiveResponse",
    ],
    [
      "eve_public.freelance.project.api.GetParticipationDetailsRequest",
      "eve_public.freelance.project.api.GetParticipationDetailsResponse",
    ],
    [
      "eve_public.freelance.project.api.GetStatsRequest",
      "eve_public.freelance.project.api.GetStatsResponse",
    ],
    [
      "eve_public.freelance.contributionmethod.definition.api.GetAllLatestRequest",
      "eve_public.freelance.contributionmethod.definition.api.GetAllLatestResponse",
    ],
    [
      "eve_public.freelance.contributionmethod.definition.api.GetAllLatestWithinMajorRequest",
      "eve_public.freelance.contributionmethod.definition.api.GetAllLatestWithinMajorResponse",
    ],
    [
      "eve_public.freelance.contributionmethod.itemdelivery.api.GetStatusRequest",
      "eve_public.freelance.contributionmethod.itemdelivery.api.GetStatusResponse",
    ],
  ]);

  for (const [requestType, responseType] of expectations) {
    assert.equal(
      publicGatewayLocal._testing.getEmptySuccessResponseType(requestType),
      responseType,
    );
  }
});

test("public gateway advertises dedicated gateway service modules", () => {
  assert.deepEqual(
    publicGatewayLocal._testing.gatewayServiceRegistry.services.map(
      (service) => service.name,
    ),
    [
      "corporation-goals",
      "corporation-colors",
      "evermarks",
      "freelance-projects",
      "insurgency",
      "new-eden-store",
      "plex-vault",
      "structure-paintwork",
      "ship-logo",
      "sovereignty",
      "mercenary-den",
      "local-chat",
      "skill-plans",
      "map-tags",
      "public-campaigns",
      "compatibility",
    ],
  );
});

test("public campaign requests return empty successful responses", () => {
  for (const [requestType, responseType] of Object.entries(
    CAMPAIGN_REQUEST_RESPONSE_TYPES,
  )) {
    assert.equal(
      publicGatewayLocal._testing.getEmptySuccessResponseType(requestType),
      responseType,
    );
    const responseEnvelope = decodeGatewayResponse(
      publicGatewayLocal.buildGatewayResponseForRequest(
        buildGatewayEnvelope(requestType),
      ),
    );
    assert.equal(responseEnvelope.status_code, 200);
    assert.equal(responseEnvelope.status_message, "");
    assert.equal(
      responseEnvelope.payload.type_url,
      `type.googleapis.com/${responseType}`,
    );
    assert.equal(Buffer.from(responseEnvelope.payload.value).length, 0);
  }
});

test("public gateway keeps skyhook theft-vulnerability handling out of compatibility fallbacks", () => {
  const compatibilityService = publicGatewayLocal._testing.gatewayServiceRegistry.services.find(
    (service) => service.name === "compatibility",
  );
  assert.ok(compatibilityService);
  assert.equal(
    compatibilityService.getEmptySuccessResponseType(
      "eve_public.entitlement.character.GetAllRequest",
    ),
    null,
  );
  assert.equal(
    compatibilityService.getEmptySuccessResponseType(
      "eve_public.sovereignty.skyhook.api.GetTheftVulnerableSkyhooksInSolarSystemRequest",
    ),
    null,
  );
  assert.equal(
    compatibilityService.getEmptySuccessResponseType(
      "eve_public.sovereignty.mercenaryden.activity.api.GetAllRequest",
    ),
    null,
  );
});

test("public gateway returns placeholder career-goal definitions for each ACP path", () => {
  const responseBuffer = publicGatewayLocal.buildGatewayResponseForRequest(
    buildGatewayEnvelope("eve_public.career.goal.api.GetDefinitionsRequest"),
  );
  const responseEnvelope = decodeGatewayResponse(responseBuffer);
  const responseType = publicGatewayLocal._testing.PROTO_ROOT.lookupType(
    "eve_public.career.goal.api.GetDefinitionsResponse",
  );
  const payload = responseType.decode(responseEnvelope.payload.value);

  assert.equal(responseEnvelope.status_code, 200);
  assert.equal(
    responseEnvelope.payload.type_url,
    "type.googleapis.com/eve_public.career.goal.api.GetDefinitionsResponse",
  );
  assert.deepEqual(
    payload.goals.map((goal) => Number(goal.attributes.career)),
    [1, 2, 3, 4],
  );
  for (const goal of payload.goals) {
    assert.equal(Buffer.from(goal.goal.uuid).length, 16);
    assert.notDeepEqual(Buffer.from(goal.goal.uuid), Buffer.alloc(16));
    assert.equal(Number(goal.attributes.target), 1);
  }
});

test("public gateway returns 200 empty payload envelopes for the missing read-only stubs", () => {
  const requestTypes = [
    "eve_public.career.goal.api.GetAllRequest",
    "eve_public.dailygoal.api.GetAllWithRewardsRequest",
    "eve_public.corporationgoal.api.GetMineWithRewardsRequest",
    "eve_public.corporationgoal.api.GetInactiveRequest",
    "eve_public.corporationgoal.api.GetContributorSummariesForGoalRequest",
  ];

  for (const requestType of requestTypes) {
    const responseBuffer = publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(requestType),
    );
    const responseEnvelope = decodeGatewayResponse(responseBuffer);

    assert.equal(responseEnvelope.status_code, 200);
    assert.equal(responseEnvelope.status_message, "");
    assert.equal(
      responseEnvelope.payload.type_url,
      `type.googleapis.com/${requestType.slice(0, -7)}Response`,
    );
    assert.equal(Buffer.from(responseEnvelope.payload.value).length, 0);
  }
});

test("public gateway returns 200 empty payload envelopes for freelance list requests", () => {
  const requestTypes = [
    "eve_public.freelance.project.api.GetAllActiveForCorporationRequest",
    "eve_public.freelance.project.api.GetAllCommittedRequest",
    "eve_public.freelance.project.api.GetAllUnredeemedRequest",
    "eve_public.freelance.project.api.GetAllBroadcastedRequest",
    "eve_public.freelance.project.api.GetAllActiveRequest",
    "eve_public.freelance.project.api.GetAllInactiveRequest",
    "eve_public.freelance.project.api.GetParticipationDetailsRequest",
    "eve_public.freelance.project.api.GetStatsRequest",
    "eve_public.freelance.contributionmethod.definition.api.GetAllLatestRequest",
    "eve_public.freelance.contributionmethod.definition.api.GetAllLatestWithinMajorRequest",
    "eve_public.freelance.contributionmethod.itemdelivery.api.GetStatusRequest",
  ];

  for (const requestType of requestTypes) {
    const responseBuffer = publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(requestType),
    );
    const responseEnvelope = decodeGatewayResponse(responseBuffer);

    assert.equal(responseEnvelope.status_code, 200);
    assert.equal(responseEnvelope.status_message, "");
    assert.equal(
      responseEnvelope.payload.type_url,
      `type.googleapis.com/${requestType.slice(0, -7)}Response`,
    );
    assert.equal(Buffer.from(responseEnvelope.payload.value).length, 0);
  }
});

test("public gateway returns corporation project capacity using CCP support limits", () => {
  const responseBuffer = publicGatewayLocal.buildGatewayResponseForRequest(
    buildGatewayEnvelope("eve_public.goal.api.GetCapacityRequest"),
  );
  const responseEnvelope = decodeGatewayResponse(responseBuffer);
  const responseType = gatewayDecodeRoot.lookupType(
    "eve_public.goal.api.GetCapacityResponse",
  );
  const payload = responseType.decode(responseEnvelope.payload.value);

  assert.equal(responseEnvelope.status_code, 200);
  assert.equal(
    responseEnvelope.payload.type_url,
    "type.googleapis.com/eve_public.goal.api.GetCapacityResponse",
  );
  assert.equal(Number(payload.count), 0);
  assert.equal(Number(payload.capacity), ACTIVE_PROJECT_CAPACITY);
});

test("public gateway returns freelance creation and participation limits", () => {
  const requests = [
    [
      "eve_public.freelance.project.api.GetCommitLimitsRequest",
      "eve_public.freelance.project.api.GetCommitLimitsResponse",
    ],
    [
      "eve_public.freelance.project.api.GetCreationLimitsRequest",
      "eve_public.freelance.project.api.GetCreationLimitsResponse",
    ],
    [
      "eve_public.freelance.project.api.GetCreationPricesRequest",
      "eve_public.freelance.project.api.GetCreationPricesResponse",
    ],
  ];

  for (const [requestType, responseTypeName] of requests) {
    const responseBuffer = publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(requestType),
    );
    const responseEnvelope = decodeGatewayResponse(responseBuffer);
    assert.equal(responseEnvelope.status_code, 200);
    assert.equal(
      responseEnvelope.payload.type_url,
      `type.googleapis.com/${responseTypeName}`,
    );
  }

  const commitLimitsType = gatewayDecodeRoot.lookupType(
    "eve_public.freelance.project.api.GetCommitLimitsResponse",
  );
  const commitLimitsEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope("eve_public.freelance.project.api.GetCommitLimitsRequest"),
    ),
  );
  const commitLimitsPayload = commitLimitsType.decode(
    commitLimitsEnvelope.payload.value,
  );
  assert.equal(
    Number(commitLimitsPayload.max_active_projects_per_participant),
    FREELANCE_LIMITS.maxActiveProjectsPerParticipant,
  );
  assert.equal(
    Number(commitLimitsPayload.max_committed_participants_per_project),
    FREELANCE_LIMITS.maxCommittedParticipantsPerProject,
  );

  const creationLimitsType = gatewayDecodeRoot.lookupType(
    "eve_public.freelance.project.api.GetCreationLimitsResponse",
  );
  const creationLimitsEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope("eve_public.freelance.project.api.GetCreationLimitsRequest"),
    ),
  );
  const creationLimitsPayload = creationLimitsType.decode(
    creationLimitsEnvelope.payload.value,
  );
  assert.equal(
    Number(creationLimitsPayload.max_active_projects_per_corporation),
    FREELANCE_LIMITS.maxActiveProjectsPerCorporation,
  );
  assert.equal(
    Number(creationLimitsPayload.max_active_projects_broadcast_per_system),
    FREELANCE_LIMITS.maxActiveProjectsBroadcastPerSystem,
  );
  assert.equal(
    Number(creationLimitsPayload.max_broadcasting_locations_per_project),
    FREELANCE_LIMITS.maxBroadcastingLocationsPerProject,
  );
  assert.equal(
    Number(creationLimitsPayload.max_project_duration.seconds),
    FREELANCE_LIMITS.maxProjectDurationSeconds,
  );

  const creationPricesType = gatewayDecodeRoot.lookupType(
    "eve_public.freelance.project.api.GetCreationPricesResponse",
  );
  const creationPricesEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope("eve_public.freelance.project.api.GetCreationPricesRequest"),
    ),
  );
  const creationPricesPayload = creationPricesType.decode(
    creationPricesEnvelope.payload.value,
  );
  assert.equal(
    Number(creationPricesPayload.prices.base_fee_per_day.units),
    FREELANCE_CREATION_PRICES.baseFeePerDay,
  );
  assert.equal(
    Number(
      creationPricesPayload.prices.broadcasting_fee_per_day_per_location.units,
    ),
    FREELANCE_CREATION_PRICES.broadcastingFeePerDayPerLocation,
  );
});

test("public gateway returns CCP-shaped structure paintwork catalogue and runtime license payloads", (t) => {
  const activeCharacterID = 140000003;
  const corporationID = 98000000;
  const activeCharacter =
    database.read("characters", `/${activeCharacterID}`).data || {};
  const solarSystemID = Number(activeCharacter.solarSystemID || 30000140);
  const lpWalletsBackup = JSON.parse(
    JSON.stringify(database.read("lpWallets", "/").data || {}),
  );
  const structurePaintworkRoot = buildStructurePaintworkProtoRoot();
  const IssueRequest = structurePaintworkRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.license.api.IssueRequest",
  );
  const IssueResponse = structurePaintworkRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.license.api.IssueResponse",
  );
  const GetCatalogueResponse = structurePaintworkRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.license.api.GetCatalogueResponse",
  );
  const GetAllOwnedByCorporationResponse = structurePaintworkRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.license.api.GetAllOwnedByCorporationResponse",
  );
  const LicenseGetRequest = structurePaintworkRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.license.api.GetRequest",
  );
  const LicenseGetResponse = structurePaintworkRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.license.api.GetResponse",
  );
  const PaintworkGetRequest = structurePaintworkRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.api.GetRequest",
  );
  const PaintworkGetResponse = structurePaintworkRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.api.GetResponse",
  );
  const PaintworkGetAllResponse = structurePaintworkRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.api.GetAllInSolarSystemResponse",
  );
  const RevokeRequest = structurePaintworkRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.license.api.RevokeRequest",
  );
  setCorporationWalletLPBalance(
    corporationID,
    EVERMARK_ISSUER_CORP_ID,
    10000000,
    { reason: "test_seed" },
  );

  const createdStructure = createStructure({
    typeID: 35832,
    name: "PaintworkParityTestStructure",
    itemName: "PaintworkParityTestStructure",
    ownerCorpID: corporationID,
    ownerID: corporationID,
    solarSystemID,
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    position: { x: 0, y: 0, z: 0 },
  });
  assert.equal(createdStructure.success, true);
  const structureID = Number(createdStructure.data.structureID || 0);
  let issuedLicenseID = null;

  t.after(() => {
    database.write("lpWallets", "/", lpWalletsBackup);
    if (issuedLicenseID) {
      revokeLicense(activeCharacterID, issuedLicenseID);
    }
    removeStructure(structureID);
    database.flushAllSync();
  });

  const catalogueEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.structure.paintwork.license.api.GetCatalogueRequest",
        Buffer.alloc(0),
        activeCharacterID,
      ),
    ),
  );
  const cataloguePayload = GetCatalogueResponse.decode(
    catalogueEnvelope.payload.value,
  );
  assert.equal(catalogueEnvelope.status_code, 200);
  const astrahusCatalogueEntries = cataloguePayload.items.filter(
    (item) => Number(item.structure_type.sequential) === 35832,
  );
  assert.deepEqual(
    astrahusCatalogueEntries.map((item) => Number(item.duration.seconds)).sort((left, right) => left - right),
    [2592000, 7776000, 15552000],
  );
  const thirtyDayCatalogueEntry = astrahusCatalogueEntries.find(
    (item) => Number(item.duration.seconds) === 2592000,
  );
  assert.ok(thirtyDayCatalogueEntry);
  assert.equal(
    Number(thirtyDayCatalogueEntry.price.associated_corporation.sequential),
    1000419,
  );
  const walletBeforeIssue = getCorporationWalletLPBalance(
    corporationID,
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
                primary: { paint: 7 },
                secondary: { empty: true },
                detailing: { paint: 11 },
              },
              duration: { seconds: 2592000 },
              structures: [{ sequential: structureID }],
            }),
          ).finish(),
        ),
        activeCharacterID,
      ),
    ),
  );
  const issuePayload = IssueResponse.decode(issueEnvelope.payload.value);
  assert.equal(issueEnvelope.status_code, 200);
  assert.equal(issuePayload.licenses.length, 1);
  assert.equal(
    getCorporationWalletLPBalance(corporationID, EVERMARK_ISSUER_CORP_ID),
    walletBeforeIssue - Number(thirtyDayCatalogueEntry.price.amount),
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
  assert.equal(
    Number(issuePayload.licenses[0].attributes.structure.sequential),
    structureID,
  );
  assert.equal(
    Number(issuePayload.licenses[0].attributes.corporation.sequential),
    corporationID,
  );

  const ownedEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.structure.paintwork.license.api.GetAllOwnedByCorporationRequest",
        Buffer.alloc(0),
        activeCharacterID,
      ),
    ),
  );
  const ownedPayload = GetAllOwnedByCorporationResponse.decode(
    ownedEnvelope.payload.value,
  );
  assert.equal(ownedEnvelope.status_code, 200);
  assert.equal(
    ownedPayload.licenses.some(
      (entry) =>
        Number(entry.attributes.structure.sequential) === structureID,
    ),
    true,
  );

  const licenseGetEnvelope = decodeGatewayResponse(
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
        activeCharacterID,
      ),
    ),
  );
  const licenseGetPayload = LicenseGetResponse.decode(
    licenseGetEnvelope.payload.value,
  );
  assert.equal(licenseGetEnvelope.status_code, 200);
  assert.equal(
    Number(licenseGetPayload.attributes.activator.sequential),
    activeCharacterID,
  );

  const paintworkGetEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.structure.paintwork.api.GetRequest",
        Buffer.from(
          PaintworkGetRequest.encode(
            PaintworkGetRequest.create({
              structure: { sequential: structureID },
              solar_system: { sequential: solarSystemID },
            }),
          ).finish(),
        ),
        activeCharacterID,
      ),
    ),
  );
  const paintworkGetPayload = PaintworkGetResponse.decode(
    paintworkGetEnvelope.payload.value,
  );
  assert.equal(paintworkGetEnvelope.status_code, 200);
  assert.equal(Number(paintworkGetPayload.paintwork.primary.paint), 7);
  assert.equal(Boolean(paintworkGetPayload.paintwork.secondary.empty), true);

  const paintworkGetAllEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.structure.paintwork.api.GetAllInSolarSystemRequest",
        Buffer.alloc(0),
        activeCharacterID,
      ),
    ),
  );
  const paintworkGetAllPayload = PaintworkGetAllResponse.decode(
    paintworkGetAllEnvelope.payload.value,
  );
  assert.equal(paintworkGetAllEnvelope.status_code, 200);
  assert.equal(
    paintworkGetAllPayload.paintworks.some(
      (entry) => Number(entry.structure.sequential) === structureID,
    ),
    true,
  );

  const revokeEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.structure.paintwork.license.api.RevokeRequest",
        Buffer.from(
          RevokeRequest.encode(
            RevokeRequest.create({
              license: {
                uuid: Buffer.from(issuedLicenseID.replace(/-/g, ""), "hex"),
              },
            }),
          ).finish(),
        ),
        activeCharacterID,
      ),
    ),
  );
  assert.equal(revokeEnvelope.status_code, 200);
  issuedLicenseID = null;

  const missingAfterRevokeEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.structure.paintwork.api.GetRequest",
        Buffer.from(
          PaintworkGetRequest.encode(
            PaintworkGetRequest.create({
              structure: { sequential: structureID },
              solar_system: { sequential: solarSystemID },
            }),
          ).finish(),
        ),
        activeCharacterID,
      ),
    ),
  );
  assert.equal(missingAfterRevokeEnvelope.status_code, 404);
});

test("public gateway returns handled not-found responses for direct structure paintwork lookups", () => {
  const requestTypes = [
    [
      "eve_public.cosmetic.structure.paintwork.license.api.GetRequest",
      "eve_public.cosmetic.structure.paintwork.license.api.GetResponse",
    ],
    [
      "eve_public.cosmetic.structure.paintwork.api.GetRequest",
      "eve_public.cosmetic.structure.paintwork.api.GetResponse",
    ],
  ];

  for (const [requestType, responseType] of requestTypes) {
    const responseBuffer = publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(requestType),
    );
    const responseEnvelope = decodeGatewayResponse(responseBuffer);
    assert.equal(responseEnvelope.status_code, 404);
    assert.equal(
      responseEnvelope.payload.type_url,
      `type.googleapis.com/${responseType}`,
    );
  }
});

test("public gateway publishes live structure paintwork notices targeted to the current solar system", (t) => {
  const activeCharacterID = 140000003;
  const corporationID = 98000000;
  const solarSystemID = 30000141;
  const lpWalletsBackup = JSON.parse(
    JSON.stringify(database.read("lpWallets", "/").data || {}),
  );
  const structurePaintworkRoot = buildStructurePaintworkProtoRoot();
  const IssueRequest = structurePaintworkRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.license.api.IssueRequest",
  );
  const IssueResponse = structurePaintworkRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.license.api.IssueResponse",
  );
  const RevokeRequest = structurePaintworkRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.license.api.RevokeRequest",
  );
  const SetNotice = structurePaintworkRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.api.SetNotice",
  );
  const SetAllInSolarSystemNotice = structurePaintworkRoot.lookupType(
    "eve_public.cosmetic.structure.paintwork.api.SetAllInSolarSystemNotice",
  );
  const NoticeEnvelope = publicGatewayLocal._testing.PROTO_ROOT.lookupType(
    "eve_public.Notice",
  );
  const stream = new FakeGatewayNoticeStream();

  assert.equal(
    publicGatewayLocal.handleGatewayStream(stream, {
      ":path": "/eve_public.gateway.Notices/Consume",
    }),
    true,
  );
  setCorporationWalletLPBalance(
    corporationID,
    EVERMARK_ISSUER_CORP_ID,
    10000000,
    { reason: "test_seed" },
  );

  const createdStructure = createStructure({
    typeID: 35832,
    name: "PaintworkNoticeParityStructure",
    itemName: "PaintworkNoticeParityStructure",
    ownerCorpID: corporationID,
    ownerID: corporationID,
    solarSystemID,
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    position: { x: 0, y: 0, z: 0 },
  });
  assert.equal(createdStructure.success, true);
  const structureID = Number(createdStructure.data.structureID || 0);
  let issuedLicenseID = null;

  t.after(() => {
    stream.emit("close");
    database.write("lpWallets", "/", lpWalletsBackup);
    if (issuedLicenseID) {
      revokeLicense(activeCharacterID, issuedLicenseID);
    }
    removeStructure(structureID);
    database.flushAllSync();
  });

  const issueEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.structure.paintwork.license.api.IssueRequest",
        Buffer.from(
          IssueRequest.encode(
            IssueRequest.create({
              paintwork: {
                primary: { paint: 9 },
                secondary: { empty: true },
              },
              duration: { seconds: 2592000 },
              structures: [{ sequential: structureID }],
            }),
          ).finish(),
        ),
        activeCharacterID,
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

  const issuedNotices = stream.frames.map((frame) =>
    NoticeEnvelope.decode(decodeGrpcFramePayload(frame)),
  );
  const issuedSetNotice = issuedNotices.find(
    (notice) =>
      notice.payload.type_url ===
      "type.googleapis.com/eve_public.cosmetic.structure.paintwork.api.SetNotice",
  );
  const issuedSetAllNotice = issuedNotices.find(
    (notice) =>
      notice.payload.type_url ===
      "type.googleapis.com/eve_public.cosmetic.structure.paintwork.api.SetAllInSolarSystemNotice",
  );

  assert.ok(issuedSetNotice);
  assert.ok(issuedSetAllNotice);
  assert.equal(Number(issuedSetNotice.target_group.solar_system), solarSystemID);
  assert.equal(Number(issuedSetAllNotice.target_group.solar_system), solarSystemID);

  const issuedSetPayload = SetNotice.decode(issuedSetNotice.payload.value);
  assert.equal(Number(issuedSetPayload.structure.sequential), structureID);
  assert.equal(Number(issuedSetPayload.paintwork.primary.paint), 9);

  const issuedSetAllPayload = SetAllInSolarSystemNotice.decode(
    issuedSetAllNotice.payload.value,
  );
  assert.equal(Number(issuedSetAllPayload.solar_system.sequential), solarSystemID);
  assert.equal(
    issuedSetAllPayload.paintworks.some(
      (entry) => Number(entry.structure.sequential) === structureID,
    ),
    true,
  );

  stream.frames = [];
  const revokeEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.structure.paintwork.license.api.RevokeRequest",
        Buffer.from(
          RevokeRequest.encode(
            RevokeRequest.create({
              license: {
                uuid: Buffer.from(issuedLicenseID.replace(/-/g, ""), "hex"),
              },
            }),
          ).finish(),
        ),
        activeCharacterID,
      ),
    ),
  );
  assert.equal(revokeEnvelope.status_code, 200);
  issuedLicenseID = null;

  const revokedNotices = stream.frames.map((frame) =>
    NoticeEnvelope.decode(decodeGrpcFramePayload(frame)),
  );
  const revokedSetNotice = revokedNotices.find(
    (notice) =>
      notice.payload.type_url ===
      "type.googleapis.com/eve_public.cosmetic.structure.paintwork.api.SetNotice",
  );
  const revokedSetAllNotice = revokedNotices.find(
    (notice) =>
      notice.payload.type_url ===
      "type.googleapis.com/eve_public.cosmetic.structure.paintwork.api.SetAllInSolarSystemNotice",
  );

  assert.ok(revokedSetNotice);
  assert.ok(revokedSetAllNotice);
  assert.equal(Number(revokedSetNotice.target_group.solar_system), solarSystemID);

  const revokedSetAllPayload = SetAllInSolarSystemNotice.decode(
    revokedSetAllNotice.payload.value,
  );
  assert.equal(
    revokedSetAllPayload.paintworks.some(
      (entry) => Number(entry.structure.sequential) === structureID,
    ),
    false,
  );
});

test("public gateway returns an all-zero active skill-plan UUID to mean untracked", () => {
  const responseBuffer = publicGatewayLocal.buildGatewayResponseForRequest(
    buildGatewayEnvelope("eve_public.character.skill.plan.GetActiveRequest"),
  );
  const responseEnvelope = decodeGatewayResponse(responseBuffer);
  const responseType = publicGatewayLocal._testing.PROTO_ROOT.lookupType(
    "eve_public.character.skill.plan.GetActiveResponse",
  );
  const payload = responseType.decode(responseEnvelope.payload.value);

  assert.equal(responseEnvelope.status_code, 200);
  assert.equal(
    responseEnvelope.payload.type_url,
    "type.googleapis.com/eve_public.character.skill.plan.GetActiveResponse",
  );
  assert.deepEqual(Buffer.from(payload.skill_plan.uuid), Buffer.alloc(16));
});

test("public gateway corporation palette GetOwn/Set/CanEdit flows match CCP public payloads", (t) => {
  const corporationID = 98000000;
  const authorizedCharacterID = 140000003;
  const unauthorizedCharacterID = 140000002;
  const originalPalette = getCorporationRuntime(corporationID).corpColorPalette
    ? JSON.parse(
        JSON.stringify(getCorporationRuntime(corporationID).corpColorPalette),
      )
    : null;

  t.after(() => {
    updateCorporationRuntime(corporationID, (runtime) => {
      if (originalPalette) {
        runtime.corpColorPalette = originalPalette;
      } else {
        delete runtime.corpColorPalette;
      }
      return runtime;
    });
  });

  const canEditResponseBuffer = publicGatewayLocal.buildGatewayResponseForRequest(
    buildGatewayEnvelope(
      "eve_public.cosmetic.corporation.palette.api.CanEditRequest",
      Buffer.alloc(0),
      authorizedCharacterID,
    ),
  );
  const canEditEnvelope = decodeGatewayResponse(canEditResponseBuffer);
  const CanEditResponse = publicGatewayLocal._testing.PROTO_ROOT.lookupType(
    "eve_public.cosmetic.corporation.palette.api.CanEditResponse",
  );
  const canEditPayload = CanEditResponse.decode(canEditEnvelope.payload.value);
  assert.equal(canEditEnvelope.status_code, 200);
  assert.equal(canEditPayload.can_edit, true);

  const PaletteAttributes = publicGatewayLocal._testing.PROTO_ROOT.lookupType(
    "eve_public.cosmetic.corporation.palette.Attributes",
  );
  const SetRequest = publicGatewayLocal._testing.PROTO_ROOT.lookupType(
    "eve_public.cosmetic.corporation.palette.api.SetRequest",
  );
  const setPayloadBuffer = Buffer.from(
    SetRequest.encode(
      SetRequest.create({
        attributes: PaletteAttributes.create({
          main_color: { red: 12, green: 34, blue: 56 },
          secondary_color: { red: 78, green: 90, blue: 123 },
          no_tertiary_color: true,
        }),
      }),
    ).finish(),
  );

  const setResponseBuffer = publicGatewayLocal.buildGatewayResponseForRequest(
    buildGatewayEnvelope(
      "eve_public.cosmetic.corporation.palette.api.SetRequest",
      setPayloadBuffer,
      authorizedCharacterID,
    ),
  );
  const setEnvelope = decodeGatewayResponse(setResponseBuffer);
  assert.equal(setEnvelope.status_code, 200);
  assert.equal(
    setEnvelope.payload.type_url,
    "type.googleapis.com/eve_public.cosmetic.corporation.palette.api.SetResponse",
  );

  const GetOwnResponse = publicGatewayLocal._testing.PROTO_ROOT.lookupType(
    "eve_public.cosmetic.corporation.palette.api.GetOwnResponse",
  );
  const getOwnResponseBuffer = publicGatewayLocal.buildGatewayResponseForRequest(
    buildGatewayEnvelope(
      "eve_public.cosmetic.corporation.palette.api.GetOwnRequest",
      Buffer.alloc(0),
      authorizedCharacterID,
    ),
  );
  const getOwnEnvelope = decodeGatewayResponse(getOwnResponseBuffer);
  const getOwnPayload = GetOwnResponse.decode(getOwnEnvelope.payload.value);
  assert.equal(getOwnEnvelope.status_code, 200);
  assert.equal(Number(getOwnPayload.attributes.main_color.red), 12);
  assert.equal(Number(getOwnPayload.attributes.secondary_color.green), 90);
  assert.equal(getOwnPayload.attributes.no_tertiary_color, true);
  assert.equal(Number(getOwnPayload.last_modifier.sequential), authorizedCharacterID);
  assert.equal(
    Number(getOwnPayload.last_modified.seconds) > 0,
    true,
  );

  const GetRequest = publicGatewayLocal._testing.PROTO_ROOT.lookupType(
    "eve_public.cosmetic.corporation.palette.api.GetRequest",
  );
  const getRequestPayloadBuffer = Buffer.from(
    GetRequest.encode(
      GetRequest.create({
        identifier: {
          corporation: { sequential: corporationID },
        },
      }),
    ).finish(),
  );
  const GetResponse = publicGatewayLocal._testing.PROTO_ROOT.lookupType(
    "eve_public.cosmetic.corporation.palette.api.GetResponse",
  );
  const getResponseBuffer = publicGatewayLocal.buildGatewayResponseForRequest(
    buildGatewayEnvelope(
      "eve_public.cosmetic.corporation.palette.api.GetRequest",
      getRequestPayloadBuffer,
      authorizedCharacterID,
    ),
  );
  const getEnvelope = decodeGatewayResponse(getResponseBuffer);
  const getPayload = GetResponse.decode(getEnvelope.payload.value);
  assert.equal(getEnvelope.status_code, 200);
  assert.equal(Number(getPayload.attributes.main_color.blue), 56);
  assert.equal(Number(getPayload.attributes.secondary_color.red), 78);

  const forbiddenSetResponseBuffer =
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.corporation.palette.api.SetRequest",
        setPayloadBuffer,
        unauthorizedCharacterID,
      ),
    );
  const forbiddenEnvelope = decodeGatewayResponse(forbiddenSetResponseBuffer);
  assert.equal(forbiddenEnvelope.status_code, 403);
});
