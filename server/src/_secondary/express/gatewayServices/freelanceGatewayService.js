const protobuf = require("protobufjs");

// Official support references:
// - Freelance Jobs: default active participation cap is 3; corp creation cap is 100;
//   jobs can be broadcast to up to 20 solar systems; max duration is 1 year.
// - CCP client mock values provide the remaining fallback defaults that are not
//   explicitly documented in support copy.
const FREELANCE_LIMITS = Object.freeze({
  maxActiveProjectsPerCorporation: 100,
  maxActiveProjectsBroadcastPerSystem: 20,
  maxCharacterAgeDays: 1000000,
  maxBroadcastingLocationsPerProject: 20,
  maxCommittedParticipantsPerProject: 100000,
  maxContributionMultiplier: 2,
  maxProjectDurationSeconds: 31536000,
  maxActiveProjectsPerParticipant: 3,
});

const FREELANCE_CREATION_PRICES = Object.freeze({
  baseFeePerDay: 75000,
  broadcastingFeePerDayPerLocation: 100000,
});

const EMPTY_SUCCESS_RESPONSE_TYPES = new Map([
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
    "eve_public.freelance.project.api.GetRequest",
    "eve_public.freelance.project.api.GetResponse",
  ],
  [
    "eve_public.freelance.project.api.GetForManagerRequest",
    "eve_public.freelance.project.api.GetForManagerResponse",
  ],
  [
    "eve_public.freelance.project.api.CloseRequest",
    "eve_public.freelance.project.api.CloseResponse",
  ],
  [
    "eve_public.freelance.project.api.KickRequest",
    "eve_public.freelance.project.api.KickResponse",
  ],
  [
    "eve_public.freelance.project.api.ResignRequest",
    "eve_public.freelance.project.api.ResignResponse",
  ],
  [
    "eve_public.freelance.project.api.CommitRequest",
    "eve_public.freelance.project.api.CommitResponse",
  ],
  [
    "eve_public.freelance.project.api.RedeemRewardRequest",
    "eve_public.freelance.project.api.RedeemRewardResponse",
  ],
  [
    "eve_public.freelance.project.api.CreateRequest",
    "eve_public.freelance.project.api.CreateResponse",
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

function buildFreelanceProtoRoot() {
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

function encodePayload(messageType, payload) {
  return Buffer.from(messageType.encode(messageType.create(payload)).finish());
}

function buildCurrency(value) {
  const amount = Number(value || 0);
  const units = Math.trunc(amount);
  const nanos = Math.round((amount - units) * 1000000000);
  return {
    units,
    nanos,
  };
}

function createFreelanceGatewayService({ emptyPayload }) {
  const protoRoot = buildFreelanceProtoRoot();
  const GetCommitLimitsResponse = protoRoot.lookupType(
    "eve_public.freelance.project.api.GetCommitLimitsResponse",
  );
  const GetCreationLimitsResponse = protoRoot.lookupType(
    "eve_public.freelance.project.api.GetCreationLimitsResponse",
  );
  const GetCreationPricesResponse = protoRoot.lookupType(
    "eve_public.freelance.project.api.GetCreationPricesResponse",
  );

  return {
    name: "freelance-projects",
    handledRequestTypes: [
      "eve_public.freelance.project.api.GetCommitLimitsRequest",
      "eve_public.freelance.project.api.GetCreationLimitsRequest",
      "eve_public.freelance.project.api.GetCreationPricesRequest",
      ...EMPTY_SUCCESS_RESPONSE_TYPES.keys(),
    ],
    getEmptySuccessResponseType(requestTypeName) {
      return EMPTY_SUCCESS_RESPONSE_TYPES.get(requestTypeName) || null;
    },
    handleRequest(requestTypeName) {
      if (requestTypeName === "eve_public.freelance.project.api.GetCommitLimitsRequest") {
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.freelance.project.api.GetCommitLimitsResponse",
          responsePayloadBuffer: encodePayload(GetCommitLimitsResponse, {
            max_active_projects_per_participant:
              FREELANCE_LIMITS.maxActiveProjectsPerParticipant,
            max_committed_participants_per_project:
              FREELANCE_LIMITS.maxCommittedParticipantsPerProject,
          }),
        };
      }

      if (requestTypeName === "eve_public.freelance.project.api.GetCreationLimitsRequest") {
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.freelance.project.api.GetCreationLimitsResponse",
          responsePayloadBuffer: encodePayload(GetCreationLimitsResponse, {
            max_active_projects_per_corporation:
              FREELANCE_LIMITS.maxActiveProjectsPerCorporation,
            max_active_projects_broadcast_per_system:
              FREELANCE_LIMITS.maxActiveProjectsBroadcastPerSystem,
            max_character_age_days: FREELANCE_LIMITS.maxCharacterAgeDays,
            max_broadcasting_locations_per_project:
              FREELANCE_LIMITS.maxBroadcastingLocationsPerProject,
            max_committed_participants_per_project:
              FREELANCE_LIMITS.maxCommittedParticipantsPerProject,
            max_contribution_multiplier:
              FREELANCE_LIMITS.maxContributionMultiplier,
            max_project_duration: {
              seconds: FREELANCE_LIMITS.maxProjectDurationSeconds,
            },
          }),
        };
      }

      if (requestTypeName === "eve_public.freelance.project.api.GetCreationPricesRequest") {
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.freelance.project.api.GetCreationPricesResponse",
          responsePayloadBuffer: encodePayload(GetCreationPricesResponse, {
            prices: {
              base_fee_per_day: buildCurrency(
                FREELANCE_CREATION_PRICES.baseFeePerDay,
              ),
              broadcasting_fee_per_day_per_location: buildCurrency(
                FREELANCE_CREATION_PRICES.broadcastingFeePerDayPerLocation,
              ),
            },
          }),
        };
      }

      const responseTypeName = EMPTY_SUCCESS_RESPONSE_TYPES.get(requestTypeName);
      if (!responseTypeName) {
        return null;
      }

      return {
        statusCode: 200,
        statusMessage: "",
        responseTypeName,
        responsePayloadBuffer: emptyPayload,
      };
    },
  };
}

module.exports = {
  FREELANCE_CREATION_PRICES,
  FREELANCE_LIMITS,
  createFreelanceGatewayService,
};
module.exports._testing = {
  EMPTY_SUCCESS_RESPONSE_TYPES,
};
