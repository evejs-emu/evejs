"use strict";

const REQUEST_RESPONSE_TYPES = Object.freeze({
  "eve_public.campaign.api.GetAllRequest":
    "eve_public.campaign.api.GetAllResponse",
  "eve_public.campaign.api.requests_pb2.GetAllRequest":
    "eve_public.campaign.api.GetAllResponse",
  "eve_public.campaign.api.GetRequest":
    "eve_public.campaign.api.GetResponse",
  "eve_public.campaign.api.requests_pb2.GetRequest":
    "eve_public.campaign.api.GetResponse",
  "eve_public.campaign.api.GetStatsRequest":
    "eve_public.campaign.api.GetStatsResponse",
  "eve_public.campaign.api.requests_pb2.GetStatsRequest":
    "eve_public.campaign.api.GetStatsResponse",
  "eve_public.campaign.api.GetParticipantStatsRequest":
    "eve_public.campaign.api.GetParticipantStatsResponse",
  "eve_public.campaign.api.requests_pb2.GetParticipantStatsRequest":
    "eve_public.campaign.api.GetParticipantStatsResponse",
  "eve_public.campaign.api.GetAllUnredeemedRewardsRequest":
    "eve_public.campaign.api.GetAllUnredeemedRewardsResponse",
  "eve_public.campaign.api.requests_pb2.GetAllUnredeemedRewardsRequest":
    "eve_public.campaign.api.GetAllUnredeemedRewardsResponse",
  "eve_public.campaign.api.GetLimitsRequest":
    "eve_public.campaign.api.GetLimitsResponse",
  "eve_public.campaign.api.requests_pb2.GetLimitsRequest":
    "eve_public.campaign.api.GetLimitsResponse",
  "eve_public.campaign.objective.api.CommitRequest":
    "eve_public.campaign.objective.api.CommitResponse",
  "eve_public.campaign.objective.api.requests_pb2.CommitRequest":
    "eve_public.campaign.objective.api.CommitResponse",
  "eve_public.campaign.objective.api.ResignRequest":
    "eve_public.campaign.objective.api.ResignResponse",
  "eve_public.campaign.objective.api.requests_pb2.ResignRequest":
    "eve_public.campaign.objective.api.ResignResponse",
  "eve_public.campaign.objective.api.RedeemRewardsRequest":
    "eve_public.campaign.objective.api.RedeemRewardsResponse",
  "eve_public.campaign.objective.api.requests_pb2.RedeemRewardsRequest":
    "eve_public.campaign.objective.api.RedeemRewardsResponse",
  "eve_public.campaign.objective.api.GetStatsRequest":
    "eve_public.campaign.objective.api.GetStatsResponse",
  "eve_public.campaign.objective.api.requests_pb2.GetStatsRequest":
    "eve_public.campaign.objective.api.GetStatsResponse",
  "eve_public.campaign.objective.api.GetParticipantStatsRequest":
    "eve_public.campaign.objective.api.GetParticipantStatsResponse",
  "eve_public.campaign.objective.api.requests_pb2.GetParticipantStatsRequest":
    "eve_public.campaign.objective.api.GetParticipantStatsResponse",
  "eve_public.campaign.contributionmethod.definition.api.GetAllRequest":
    "eve_public.campaign.contributionmethod.definition.api.GetAllResponse",
  "eve_public.campaign.contributionmethod.definition.api.requests_pb2.GetAllRequest":
    "eve_public.campaign.contributionmethod.definition.api.GetAllResponse",
});

const HANDLED_REQUEST_TYPES = Object.freeze(Object.keys(REQUEST_RESPONSE_TYPES));

function createCampaignGatewayService(context) {
  const emptyPayload = context.emptyPayload || Buffer.alloc(0);
  return {
    name: "public-campaigns",
    handledRequestTypes: HANDLED_REQUEST_TYPES,
    getEmptySuccessResponseType(requestTypeName) {
      return REQUEST_RESPONSE_TYPES[requestTypeName] || null;
    },
    handleRequest(requestTypeName) {
      const responseTypeName = REQUEST_RESPONSE_TYPES[requestTypeName];
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
  HANDLED_REQUEST_TYPES,
  REQUEST_RESPONSE_TYPES,
  createCampaignGatewayService,
};
