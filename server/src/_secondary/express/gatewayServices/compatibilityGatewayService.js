const EMPTY_SUCCESS_RESPONSE_TYPES = new Map([
  [
    "eve_public.cosmetic.ship.skin.thirdparty.license.api.GetOwnedRequest",
    "eve_public.cosmetic.ship.skin.thirdparty.license.api.GetOwnedResponse",
  ],
  [
    "eve_public.cosmetic.ship.skin.thirdparty.license.api.ActivateRequest",
    "eve_public.cosmetic.ship.skin.thirdparty.license.api.ActivateResponse",
  ],
  [
    "eve_public.cosmetic.ship.skin.thirdparty.license.api.ApplyRequest",
    "eve_public.cosmetic.ship.skin.thirdparty.license.api.ApplyResponse",
  ],
  [
    "eve_public.cosmetic.ship.skin.thirdparty.license.api.UnapplyRequest",
    "eve_public.cosmetic.ship.skin.thirdparty.license.api.UnapplyResponse",
  ],
  [
    "eve_public.cosmetic.ship.skin.thirdparty.component.license.api.GetOwnedRequest",
    "eve_public.cosmetic.ship.skin.thirdparty.component.license.api.GetOwnedResponse",
  ],
  [
    "eve_public.cosmetic.market.skin.listing.api.GetAllOwnedRequest",
    "eve_public.cosmetic.market.skin.listing.api.GetAllOwnedResponse",
  ],
  [
    "eve_public.cosmetic.market.skin.listing.api.GetAllRequest",
    "eve_public.cosmetic.market.skin.listing.api.GetAllResponse",
  ],
  [
    "eve_public.cosmetic.ship.skin.thirdparty.sequencing.job.api.GetAllActiveRequest",
    "eve_public.cosmetic.ship.skin.thirdparty.sequencing.job.api.GetAllActiveResponse",
  ],
  [
    "eve_public.cosmetic.ship.skin.thirdparty.draft.api.GetAllSavedRequest",
    "eve_public.cosmetic.ship.skin.thirdparty.draft.api.GetAllSavedResponse",
  ],
  [
    "eve_public.cosmetic.ship.skin.thirdparty.draft.api.GetSaveCapacityRequest",
    "eve_public.cosmetic.ship.skin.thirdparty.draft.api.GetSaveCapacityResponse",
  ],
  [
    "eve_public.plex.vault.api.BalanceRequest",
    "eve_public.plex.vault.api.BalanceResponse",
  ],
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

const CAREER_GOAL_DEFINITION_STUBS = Object.freeze([
  {
    uuid: "00000000-0000-0000-0000-000000000401",
    career: 1,
    target: 1,
    threat: 0,
    careerPoints: 0,
  },
  {
    uuid: "00000000-0000-0000-0000-000000000501",
    career: 2,
    target: 1,
    threat: 0,
    careerPoints: 0,
  },
  {
    uuid: "00000000-0000-0000-0000-000000000601",
    career: 3,
    target: 1,
    threat: 0,
    careerPoints: 0,
  },
  {
    uuid: "00000000-0000-0000-0000-000000000701",
    career: 4,
    target: 1,
    threat: 0,
    careerPoints: 0,
  },
]);

const ZERO_UUID_BYTES = Buffer.alloc(16);

function uuidStringToBytes(value) {
  return Buffer.from(String(value).replace(/-/g, ""), "hex");
}

function buildEncodedPayload(messageType, payload) {
  return Buffer.from(messageType.encode(messageType.create(payload)).finish());
}

function createCompatibilityGatewayService({ protoRoot, emptyPayload }) {
  const careerGoalGetDefinitionsResponse = protoRoot.lookupType(
    "eve_public.career.goal.api.GetDefinitionsResponse",
  );
  const skillPlanGetActiveResponse = protoRoot.lookupType(
    "eve_public.character.skill.plan.GetActiveResponse",
  );

  return {
    name: "compatibility",
    handledRequestTypes: [
      "eve_public.career.goal.api.GetDefinitionsRequest",
      "eve_public.character.skill.plan.GetActiveRequest",
      ...EMPTY_SUCCESS_RESPONSE_TYPES.keys(),
    ],
    getEmptySuccessResponseType(requestTypeName) {
      return EMPTY_SUCCESS_RESPONSE_TYPES.get(requestTypeName) || null;
    },
    handleRequest(requestTypeName) {
      if (requestTypeName === "eve_public.career.goal.api.GetDefinitionsRequest") {
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.career.goal.api.GetDefinitionsResponse",
          responsePayloadBuffer: buildEncodedPayload(
            careerGoalGetDefinitionsResponse,
            {
              goals: CAREER_GOAL_DEFINITION_STUBS.map((definition) => ({
                goal: {
                  uuid: uuidStringToBytes(definition.uuid),
                },
                attributes: {
                  target: definition.target,
                  threat: definition.threat,
                  career: definition.career,
                  career_points: definition.careerPoints,
                },
              })),
            },
          ),
        };
      }

      if (requestTypeName === "eve_public.character.skill.plan.GetActiveRequest") {
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.character.skill.plan.GetActiveResponse",
          responsePayloadBuffer: buildEncodedPayload(skillPlanGetActiveResponse, {
            skill_plan: {
              uuid: ZERO_UUID_BYTES,
            },
          }),
        };
      }

      const emptySuccessResponseType =
        EMPTY_SUCCESS_RESPONSE_TYPES.get(requestTypeName);
      if (!emptySuccessResponseType) {
        return null;
      }

      return {
        statusCode: 200,
        statusMessage: "",
        responseTypeName: emptySuccessResponseType,
        responsePayloadBuffer: emptyPayload,
      };
    },
  };
}

module.exports = {
  createCompatibilityGatewayService,
};
module.exports._testing = {
  CAREER_GOAL_DEFINITION_STUBS,
  EMPTY_SUCCESS_RESPONSE_TYPES,
};
