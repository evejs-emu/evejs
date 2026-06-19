const path = require("path");

const {
  buildCorpGoalsProtoRoot,
} = require("./corpGoalsProto");
const {
  ACTIVE_PROJECT_CAPACITY,
  GOAL_STATE,
  closeGoal,
  createGoal,
  deleteGoal,
  getCapacityInfo,
  getCharacterCorporationID,
  getContributorSummaryForGoal,
  getGoal,
  getGoalsForCorporation,
  goalToPayload,
  listActiveGoalIDsForCorporation,
  listContributorSummariesForCharacter,
  listContributorSummariesForGoal,
  listGoalIDsForCorporation,
  listInactiveGoalIDsForCorporation,
  listRewardGoalIDsForCharacter,
  redeemRewardsForGoal,
  setGoalCurrentProgress,
} = require(path.join(
  __dirname,
  "../../../services/corporation/corpGoalsState",
));
const {
  encodePayload,
  getActiveCharacterID,
  sliceWithPage,
  uuidStringToBuffer,
} = require("./gatewayServiceHelpers");

const HANDLED_REQUEST_TYPES = Object.freeze([
  "eve_public.goal.api.GetRequest",
  "eve_public.goal.api.GetAllRequest",
  "eve_public.goal.api.CreateRequest",
  "eve_public.goal.api.CloseRequest",
  "eve_public.goal.api.DeleteRequest",
  "eve_public.goal.api.SetCurrentProgressRequest",
  "eve_public.goal.api.GetCapacityRequest",
  "eve_public.corporationgoal.api.GetAllRequest",
  "eve_public.corporationgoal.api.GetActiveRequest",
  "eve_public.corporationgoal.api.GetInactiveRequest",
  "eve_public.corporationgoal.api.GetContributorSummariesForGoalRequest",
  "eve_public.corporationgoal.api.GetMyContributorSummaryForGoalRequest",
  "eve_public.corporationgoal.api.GetMyContributorSummariesRequest",
  "eve_public.corporationgoal.api.RedeemMyRewardsRequest",
  "eve_public.corporationgoal.api.RedeemAllMyRewardsRequest",
  "eve_public.corporationgoal.api.GetMineWithRewardsRequest",
]);

function buildGoalIdentifier(goalID) {
  return {
    uuid: uuidStringToBuffer(goalID),
  };
}

function extractGoalID(identifier) {
  if (!identifier || !identifier.uuid) {
    return null;
  }
  const value = Buffer.from(identifier.uuid);
  if (value.length !== 16) {
    return null;
  }
  const hex = value.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-").toLowerCase();
}

function buildContributorSummaryPayload(goalID, contributor) {
  if (!contributor) {
    return null;
  }
  const earnings =
    Number(contributor.rewardTotal || 0) > 0
      ? [
          {
            quantity: {
              total: Number(contributor.rewardTotal || 0),
              redeemed: Number(contributor.rewardRedeemed || 0),
            },
          },
        ]
      : [];
  return {
    contributor: {
      sequential: Number(contributor.characterID || 0),
    },
    progress: Number(contributor.progress || 0),
    goal: buildGoalIdentifier(goalID),
    earnings,
  };
}

function buildPagedGoalIDResponse(items, nextPage, fieldName = "goal_ids") {
  const response = {
    [fieldName]: items.map((goal) => buildGoalIdentifier(goal.goalID || goal)),
  };
  if (nextPage) {
    response.next_page = nextPage;
  }
  return response;
}

function decodePayload(messageType, requestEnvelope) {
  return messageType.decode(
    Buffer.from(
      requestEnvelope &&
        requestEnvelope.payload &&
        requestEnvelope.payload.value
        ? requestEnvelope.payload.value
        : Buffer.alloc(0),
    ),
  );
}

function createCorpGoalsGatewayService() {
  const protoRoot = buildCorpGoalsProtoRoot();

  const types = {
    goalGetRequest: protoRoot.lookupType("eve_public.goal.api.GetRequest"),
    goalGetResponse: protoRoot.lookupType("eve_public.goal.api.GetResponse"),
    goalGetAllRequest: protoRoot.lookupType("eve_public.goal.api.GetAllRequest"),
    goalGetAllResponse: protoRoot.lookupType("eve_public.goal.api.GetAllResponse"),
    goalCreateRequest: protoRoot.lookupType("eve_public.goal.api.CreateRequest"),
    goalCreateResponse: protoRoot.lookupType("eve_public.goal.api.CreateResponse"),
    goalCloseRequest: protoRoot.lookupType("eve_public.goal.api.CloseRequest"),
    goalDeleteRequest: protoRoot.lookupType("eve_public.goal.api.DeleteRequest"),
    goalSetCurrentProgressRequest: protoRoot.lookupType(
      "eve_public.goal.api.SetCurrentProgressRequest",
    ),
    goalGetCapacityResponse: protoRoot.lookupType(
      "eve_public.goal.api.GetCapacityResponse",
    ),
    corpGoalGetAllResponse: protoRoot.lookupType(
      "eve_public.corporationgoal.api.GetAllResponse",
    ),
    corpGoalGetActiveRequest: protoRoot.lookupType(
      "eve_public.corporationgoal.api.GetActiveRequest",
    ),
    corpGoalGetActiveResponse: protoRoot.lookupType(
      "eve_public.corporationgoal.api.GetActiveResponse",
    ),
    corpGoalGetInactiveRequest: protoRoot.lookupType(
      "eve_public.corporationgoal.api.GetInactiveRequest",
    ),
    corpGoalGetInactiveResponse: protoRoot.lookupType(
      "eve_public.corporationgoal.api.GetInactiveResponse",
    ),
    corpGoalGetContributorSummariesForGoalRequest: protoRoot.lookupType(
      "eve_public.corporationgoal.api.GetContributorSummariesForGoalRequest",
    ),
    corpGoalGetContributorSummariesForGoalResponse: protoRoot.lookupType(
      "eve_public.corporationgoal.api.GetContributorSummariesForGoalResponse",
    ),
    corpGoalGetMyContributorSummaryForGoalRequest: protoRoot.lookupType(
      "eve_public.corporationgoal.api.GetMyContributorSummaryForGoalRequest",
    ),
    corpGoalGetMyContributorSummaryForGoalResponse: protoRoot.lookupType(
      "eve_public.corporationgoal.api.GetMyContributorSummaryForGoalResponse",
    ),
    corpGoalGetMyContributorSummariesRequest: protoRoot.lookupType(
      "eve_public.corporationgoal.api.GetMyContributorSummariesRequest",
    ),
    corpGoalGetMyContributorSummariesResponse: protoRoot.lookupType(
      "eve_public.corporationgoal.api.GetMyContributorSummariesResponse",
    ),
    corpGoalRedeemMyRewardsRequest: protoRoot.lookupType(
      "eve_public.corporationgoal.api.RedeemMyRewardsRequest",
    ),
    corpGoalGetMineWithRewardsRequest: protoRoot.lookupType(
      "eve_public.corporationgoal.api.GetMineWithRewardsRequest",
    ),
    corpGoalGetMineWithRewardsResponse: protoRoot.lookupType(
      "eve_public.corporationgoal.api.GetMineWithRewardsResponse",
    ),
  };

  return {
    name: "corporation-goals",
    handledRequestTypes: HANDLED_REQUEST_TYPES,
    getEmptySuccessResponseType(requestTypeName) {
      return HANDLED_REQUEST_TYPES.includes(requestTypeName)
        ? requestTypeName.replace(/Request$/, "Response")
        : null;
    },
    handleRequest(requestTypeName, requestEnvelope) {
      if (!HANDLED_REQUEST_TYPES.includes(requestTypeName)) {
        return null;
      }

      const activeCharacterID = getActiveCharacterID(requestEnvelope);
      const corporationID = getCharacterCorporationID(activeCharacterID);

      if (requestTypeName === "eve_public.goal.api.GetCapacityRequest") {
        const capacity = getCapacityInfo(corporationID);
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.goal.api.GetCapacityResponse",
          responsePayloadBuffer: encodePayload(types.goalGetCapacityResponse, {
            count: Number(capacity.count || 0),
            capacity: Number(capacity.capacity || ACTIVE_PROJECT_CAPACITY),
          }),
        };
      }

      if (requestTypeName === "eve_public.goal.api.CreateRequest") {
        const decoded = decodePayload(types.goalCreateRequest, requestEnvelope);
        const created = createGoal(activeCharacterID, decoded);
        if (!created.success) {
          return {
            statusCode: 403,
            statusMessage: created.errorMsg || "",
            responseTypeName: "eve_public.goal.api.CreateResponse",
            responsePayloadBuffer: Buffer.alloc(0),
          };
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.goal.api.CreateResponse",
          responsePayloadBuffer: encodePayload(types.goalCreateResponse, {
            goal: buildGoalIdentifier(created.data.goalID),
          }),
        };
      }

      if (requestTypeName === "eve_public.goal.api.GetRequest") {
        const decoded = decodePayload(types.goalGetRequest, requestEnvelope);
        const goal = getGoal(extractGoalID(decoded && decoded.goal));
        if (!goal) {
          return {
            statusCode: 404,
            statusMessage: "",
            responseTypeName: "eve_public.goal.api.GetResponse",
            responsePayloadBuffer: Buffer.alloc(0),
          };
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.goal.api.GetResponse",
          responsePayloadBuffer: encodePayload(types.goalGetResponse, {
            goal: goalToPayload(goal),
          }),
        };
      }

      if (requestTypeName === "eve_public.goal.api.GetAllRequest") {
        const decoded = decodePayload(types.goalGetAllRequest, requestEnvelope);
        const showOnlyState =
          decoded && decoded.show_only_state !== undefined
            ? Number(decoded.show_only_state || 0)
            : null;
        const goals = getGoalsForCorporation(corporationID).filter((goal) =>
          showOnlyState === null ? true : Number(goal.state || 0) === showOnlyState,
        );
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.goal.api.GetAllResponse",
          responsePayloadBuffer: encodePayload(types.goalGetAllResponse, {
            goals: goals.map((goal) => ({
              id: buildGoalIdentifier(goal.goalID),
              goal: goalToPayload(goal),
            })),
          }),
        };
      }

      if (requestTypeName === "eve_public.goal.api.CloseRequest") {
        const decoded = decodePayload(types.goalCloseRequest, requestEnvelope);
        const result = closeGoal(extractGoalID(decoded && decoded.goal), activeCharacterID);
        return {
          statusCode: result.success ? 200 : 403,
          statusMessage: result.success ? "" : result.errorMsg || "",
          responseTypeName: "eve_public.goal.api.CloseResponse",
          responsePayloadBuffer: Buffer.alloc(0),
        };
      }

      if (requestTypeName === "eve_public.goal.api.DeleteRequest") {
        const decoded = decodePayload(types.goalDeleteRequest, requestEnvelope);
        const result = deleteGoal(
          extractGoalID(decoded && decoded.goal),
          activeCharacterID,
        );
        return {
          statusCode: result.success ? 200 : 403,
          statusMessage: result.success ? "" : result.errorMsg || "",
          responseTypeName: "eve_public.goal.api.DeleteResponse",
          responsePayloadBuffer: Buffer.alloc(0),
        };
      }

      if (requestTypeName === "eve_public.goal.api.SetCurrentProgressRequest") {
        const decoded = decodePayload(
          types.goalSetCurrentProgressRequest,
          requestEnvelope,
        );
        const result = setGoalCurrentProgress(
          extractGoalID(decoded && decoded.goal),
          decoded && decoded.current_progress,
          decoded && decoded.new_progress,
          activeCharacterID,
        );
        return {
          statusCode: result.success ? 200 : 403,
          statusMessage: result.success ? "" : result.errorMsg || "",
          responseTypeName: "eve_public.goal.api.SetCurrentProgressResponse",
          responsePayloadBuffer: Buffer.alloc(0),
        };
      }

      if (requestTypeName === "eve_public.corporationgoal.api.GetAllRequest") {
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.corporationgoal.api.GetAllResponse",
          responsePayloadBuffer: encodePayload(types.corpGoalGetAllResponse, {
            goal_ids: listGoalIDsForCorporation(corporationID).map(buildGoalIdentifier),
          }),
        };
      }

      if (requestTypeName === "eve_public.corporationgoal.api.GetActiveRequest") {
        const decoded = decodePayload(types.corpGoalGetActiveRequest, requestEnvelope);
        const paged = listActiveGoalIDsForCorporation(corporationID, decoded && decoded.page);
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.corporationgoal.api.GetActiveResponse",
          responsePayloadBuffer: encodePayload(types.corpGoalGetActiveResponse, buildPagedGoalIDResponse(paged.items, paged.nextPage)),
        };
      }

      if (requestTypeName === "eve_public.corporationgoal.api.GetInactiveRequest") {
        const decoded = decodePayload(types.corpGoalGetInactiveRequest, requestEnvelope);
        const paged = listInactiveGoalIDsForCorporation(
          corporationID,
          decoded && decoded.ended_timespan,
          decoded && decoded.page,
        );
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.corporationgoal.api.GetInactiveResponse",
          responsePayloadBuffer: encodePayload(types.corpGoalGetInactiveResponse, buildPagedGoalIDResponse(paged.items, paged.nextPage)),
        };
      }

      if (requestTypeName === "eve_public.corporationgoal.api.GetContributorSummariesForGoalRequest") {
        const decoded = decodePayload(
          types.corpGoalGetContributorSummariesForGoalRequest,
          requestEnvelope,
        );
        const goalID = extractGoalID(decoded && decoded.goal);
        const paged = listContributorSummariesForGoal(goalID, decoded && decoded.page);
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.corporationgoal.api.GetContributorSummariesForGoalResponse",
          responsePayloadBuffer: encodePayload(
            types.corpGoalGetContributorSummariesForGoalResponse,
            {
              summaries: paged.items.map((summary) =>
                buildContributorSummaryPayload(goalID, summary),
              ),
              next_page: paged.nextPage || undefined,
            },
          ),
        };
      }

      if (requestTypeName === "eve_public.corporationgoal.api.GetMyContributorSummaryForGoalRequest") {
        const decoded = decodePayload(
          types.corpGoalGetMyContributorSummaryForGoalRequest,
          requestEnvelope,
        );
        const goalID = extractGoalID(decoded && decoded.goal);
        const summary = getContributorSummaryForGoal(goalID, activeCharacterID);
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.corporationgoal.api.GetMyContributorSummaryForGoalResponse",
          responsePayloadBuffer: encodePayload(
            types.corpGoalGetMyContributorSummaryForGoalResponse,
            summary
              ? {
                  summary: buildContributorSummaryPayload(goalID, summary),
                }
              : {},
          ),
        };
      }

      if (requestTypeName === "eve_public.corporationgoal.api.GetMyContributorSummariesRequest") {
        const decoded = decodePayload(
          types.corpGoalGetMyContributorSummariesRequest,
          requestEnvelope,
        );
        const paged = listContributorSummariesForCharacter(
          activeCharacterID,
          decoded && decoded.contributed_timespan,
          decoded && decoded.page,
        );
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.corporationgoal.api.GetMyContributorSummariesResponse",
          responsePayloadBuffer: encodePayload(
            types.corpGoalGetMyContributorSummariesResponse,
            {
              summaries: paged.items.map((summary) =>
                buildContributorSummaryPayload(
                  summary.goalID || "",
                  summary,
                ),
              ),
              next_page: paged.nextPage || undefined,
            },
          ),
        };
      }

      if (requestTypeName === "eve_public.corporationgoal.api.RedeemMyRewardsRequest") {
        const decoded = decodePayload(
          types.corpGoalRedeemMyRewardsRequest,
          requestEnvelope,
        );
        const result = redeemRewardsForGoal(
          extractGoalID(decoded && decoded.goal_id),
          activeCharacterID,
        );
        return {
          statusCode: result.success ? 200 : 404,
          statusMessage: result.success ? "" : result.errorMsg || "",
          responseTypeName: "eve_public.corporationgoal.api.RedeemMyRewardsResponse",
          responsePayloadBuffer: Buffer.alloc(0),
        };
      }

      if (requestTypeName === "eve_public.corporationgoal.api.RedeemAllMyRewardsRequest") {
        const paged = listRewardGoalIDsForCharacter(activeCharacterID, { size: 500, token: "" });
        for (const goal of paged.items) {
          redeemRewardsForGoal(goal.goalID, activeCharacterID);
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.corporationgoal.api.RedeemAllMyRewardsResponse",
          responsePayloadBuffer: Buffer.alloc(0),
        };
      }

      const decoded = decodePayload(
        types.corpGoalGetMineWithRewardsRequest,
        requestEnvelope,
      );
      const paged = listRewardGoalIDsForCharacter(activeCharacterID, decoded && decoded.page);
      return {
        statusCode: 200,
        statusMessage: "",
        responseTypeName: "eve_public.corporationgoal.api.GetMineWithRewardsResponse",
        responsePayloadBuffer: encodePayload(types.corpGoalGetMineWithRewardsResponse, {
          identifiers: paged.items.map((goal) => buildGoalIdentifier(goal.goalID)),
          next_page: paged.nextPage || undefined,
        }),
      };
    },
  };
}

module.exports = {
  ACTIVE_PROJECT_CAPACITY,
  createCorpGoalsGatewayService,
};
