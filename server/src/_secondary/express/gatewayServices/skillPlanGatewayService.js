const path = require("path");

const {
  buildSkillPlanProtoRoot,
} = require("./skillPlanProto");
const {
  encodePayload,
  getActiveCharacterID,
  uuidStringToBuffer,
  uuidBufferToString,
} = require("./gatewayServiceHelpers");
const {
  createPersonalMilestone,
  createPersonalPlan,
  deletePersonalMilestone,
  deletePersonalPlan,
  findSharedPersonalPlan,
  getActivePlanID,
  getPersonalPlan,
  listPersonalMilestones,
  listPersonalPlanIDs,
  setActivePlanID,
  ZERO_UUID,
  updatePersonalMilestoneDescription,
  updatePersonalPlan,
} = require(path.join(
  __dirname,
  "../../../services/skills/plans/skillPlanState",
));

const HANDLED_REQUEST_TYPES = Object.freeze([
  "eve_public.character.skill.plan.GetAllRequest",
  "eve_public.character.skill.plan.GetRequest",
  "eve_public.character.skill.plan.GetSharedRequest",
  "eve_public.character.skill.plan.CreateRequest",
  "eve_public.character.skill.plan.DeleteRequest",
  "eve_public.character.skill.plan.SetNameRequest",
  "eve_public.character.skill.plan.SetDescriptionRequest",
  "eve_public.character.skill.plan.SetSkillRequirementsRequest",
  "eve_public.character.skill.plan.GetActiveRequest",
  "eve_public.character.skill.plan.SetActiveRequest",
  "eve_public.character.skill.plan.milestone.GetAllRequest",
  "eve_public.character.skill.plan.milestone.CreateRequest",
  "eve_public.character.skill.plan.milestone.DeleteRequest",
  "eve_public.character.skill.plan.milestone.SetDescriptionRequest",
]);

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

function buildPlanIdentifier(planID) {
  return {
    uuid: uuidStringToBuffer(planID),
  };
}

function extractPlanID(identifier) {
  return identifier && identifier.uuid ? uuidBufferToString(identifier.uuid) : null;
}

function buildRequirementPayload(requirement) {
  return {
    skill_type: {
      sequential: Number(requirement.typeID || 0),
    },
    level: Number(requirement.level || 0),
  };
}

function buildPlanAttributes(plan) {
  if (!plan) {
    return undefined;
  }
  return {
    name: String(plan.name || ""),
    description: String(plan.description || ""),
    skill_requirements: (plan.requirements || []).map(buildRequirementPayload),
  };
}

function buildMilestoneAttributes(milestone) {
  if (!milestone) {
    return undefined;
  }
  const payload = {
    skill_plan: buildPlanIdentifier(milestone.planID),
    description: String(milestone.description || ""),
  };
  if (Number(milestone.trainToTypeID || 0) > 0) {
    payload.train_to_type = {
      sequential: Number(milestone.trainToTypeID || 0),
    };
  } else if (Number(milestone.skillTypeID || 0) > 0) {
    payload.skill = {
      skill_type: {
        sequential: Number(milestone.skillTypeID || 0),
      },
      level: Number(milestone.level || 0),
    };
  }
  return payload;
}

function decodePlanRequirements(requirements = []) {
  return Array.isArray(requirements)
    ? requirements.map((requirement) => ({
        typeID: Number(
          requirement &&
            requirement.skill_type &&
            requirement.skill_type.sequential
            ? requirement.skill_type.sequential
            : 0,
        ),
        level: Number(requirement && requirement.level ? requirement.level : 0),
      }))
    : [];
}

function buildErrorResponse(responseTypeName, error) {
  if (error && error.code === "SKILL_PLAN_NOT_FOUND") {
    return {
      statusCode: 404,
      statusMessage: error.message || "",
      responseTypeName,
      responsePayloadBuffer: Buffer.alloc(0),
    };
  }

  return {
    statusCode: 400,
    statusMessage: error && error.message ? error.message : "",
    responseTypeName,
    responsePayloadBuffer: Buffer.alloc(0),
  };
}

function createSkillPlanGatewayService() {
  const protoRoot = buildSkillPlanProtoRoot();
  const types = {
    getAllRequest: protoRoot.lookupType("eve_public.character.skill.plan.GetAllRequest"),
    getAllResponse: protoRoot.lookupType("eve_public.character.skill.plan.GetAllResponse"),
    getRequest: protoRoot.lookupType("eve_public.character.skill.plan.GetRequest"),
    getResponse: protoRoot.lookupType("eve_public.character.skill.plan.GetResponse"),
    getSharedRequest: protoRoot.lookupType("eve_public.character.skill.plan.GetSharedRequest"),
    getSharedResponse: protoRoot.lookupType("eve_public.character.skill.plan.GetSharedResponse"),
    createRequest: protoRoot.lookupType("eve_public.character.skill.plan.CreateRequest"),
    createResponse: protoRoot.lookupType("eve_public.character.skill.plan.CreateResponse"),
    deleteRequest: protoRoot.lookupType("eve_public.character.skill.plan.DeleteRequest"),
    setNameRequest: protoRoot.lookupType("eve_public.character.skill.plan.SetNameRequest"),
    setDescriptionRequest: protoRoot.lookupType(
      "eve_public.character.skill.plan.SetDescriptionRequest",
    ),
    setRequirementsRequest: protoRoot.lookupType(
      "eve_public.character.skill.plan.SetSkillRequirementsRequest",
    ),
    getActiveResponse: protoRoot.lookupType(
      "eve_public.character.skill.plan.GetActiveResponse",
    ),
    setActiveRequest: protoRoot.lookupType(
      "eve_public.character.skill.plan.SetActiveRequest",
    ),
    milestoneGetAllRequest: protoRoot.lookupType(
      "eve_public.character.skill.plan.milestone.GetAllRequest",
    ),
    milestoneGetAllResponse: protoRoot.lookupType(
      "eve_public.character.skill.plan.milestone.GetAllResponse",
    ),
    milestoneCreateRequest: protoRoot.lookupType(
      "eve_public.character.skill.plan.milestone.CreateRequest",
    ),
    milestoneCreateResponse: protoRoot.lookupType(
      "eve_public.character.skill.plan.milestone.CreateResponse",
    ),
    milestoneDeleteRequest: protoRoot.lookupType(
      "eve_public.character.skill.plan.milestone.DeleteRequest",
    ),
    milestoneSetDescriptionRequest: protoRoot.lookupType(
      "eve_public.character.skill.plan.milestone.SetDescriptionRequest",
    ),
  };

  return {
    name: "skill-plans",
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

      try {
        if (requestTypeName === "eve_public.character.skill.plan.GetAllRequest") {
          return {
            statusCode: 200,
            statusMessage: "",
            responseTypeName: "eve_public.character.skill.plan.GetAllResponse",
            responsePayloadBuffer: encodePayload(types.getAllResponse, {
              skill_plans: listPersonalPlanIDs(activeCharacterID).map(buildPlanIdentifier),
            }),
          };
        }

        if (requestTypeName === "eve_public.character.skill.plan.GetRequest") {
          const decoded = decodePayload(types.getRequest, requestEnvelope);
          const plan = getPersonalPlan(activeCharacterID, extractPlanID(decoded.skill_plan));
          if (!plan) {
            return {
              statusCode: 404,
              statusMessage: "",
              responseTypeName: "eve_public.character.skill.plan.GetResponse",
              responsePayloadBuffer: Buffer.alloc(0),
            };
          }
          return {
            statusCode: 200,
            statusMessage: "",
            responseTypeName: "eve_public.character.skill.plan.GetResponse",
            responsePayloadBuffer: encodePayload(types.getResponse, {
              skill_plan: buildPlanAttributes(plan),
            }),
          };
        }

        if (requestTypeName === "eve_public.character.skill.plan.GetSharedRequest") {
          const decoded = decodePayload(types.getSharedRequest, requestEnvelope);
          const sharedPlan = findSharedPersonalPlan(extractPlanID(decoded.skill_plan));
          return {
            statusCode: 200,
            statusMessage: "",
            responseTypeName: "eve_public.character.skill.plan.GetSharedResponse",
            responsePayloadBuffer: encodePayload(types.getSharedResponse, sharedPlan
              ? {
                  skill_plan: buildPlanAttributes(sharedPlan.plan),
                }
              : {}),
          };
        }

        if (requestTypeName === "eve_public.character.skill.plan.CreateRequest") {
          const decoded = decodePayload(types.createRequest, requestEnvelope);
          const created = createPersonalPlan(activeCharacterID, {
            name: decoded && decoded.skill_plan ? decoded.skill_plan.name : "",
            description:
              decoded && decoded.skill_plan ? decoded.skill_plan.description : "",
            requirements: decodePlanRequirements(
              decoded && decoded.skill_plan ? decoded.skill_plan.skill_requirements : [],
            ),
          });
          return {
            statusCode: 200,
            statusMessage: "",
            responseTypeName: "eve_public.character.skill.plan.CreateResponse",
            responsePayloadBuffer: encodePayload(types.createResponse, {
              skill_plan: buildPlanIdentifier(created.planID),
            }),
          };
        }

        if (requestTypeName === "eve_public.character.skill.plan.DeleteRequest") {
          const decoded = decodePayload(types.deleteRequest, requestEnvelope);
          deletePersonalPlan(activeCharacterID, extractPlanID(decoded.skill_plan));
          return {
            statusCode: 200,
            statusMessage: "",
            responseTypeName: "eve_public.character.skill.plan.DeleteResponse",
            responsePayloadBuffer: Buffer.alloc(0),
          };
        }

        if (requestTypeName === "eve_public.character.skill.plan.SetNameRequest") {
          const decoded = decodePayload(types.setNameRequest, requestEnvelope);
          updatePersonalPlan(activeCharacterID, extractPlanID(decoded.skill_plan), {
            name: decoded.name,
          });
          return {
            statusCode: 200,
            statusMessage: "",
            responseTypeName: "eve_public.character.skill.plan.SetNameResponse",
            responsePayloadBuffer: Buffer.alloc(0),
          };
        }

        if (requestTypeName === "eve_public.character.skill.plan.SetDescriptionRequest") {
          const decoded = decodePayload(types.setDescriptionRequest, requestEnvelope);
          updatePersonalPlan(activeCharacterID, extractPlanID(decoded.skill_plan), {
            description: decoded.description,
          });
          return {
            statusCode: 200,
            statusMessage: "",
            responseTypeName: "eve_public.character.skill.plan.SetDescriptionResponse",
            responsePayloadBuffer: Buffer.alloc(0),
          };
        }

        if (requestTypeName === "eve_public.character.skill.plan.SetSkillRequirementsRequest") {
          const decoded = decodePayload(types.setRequirementsRequest, requestEnvelope);
          updatePersonalPlan(activeCharacterID, extractPlanID(decoded.skill_plan), {
            requirements: decodePlanRequirements(decoded.requirements),
          });
          return {
            statusCode: 200,
            statusMessage: "",
            responseTypeName: "eve_public.character.skill.plan.SetSkillRequirementsResponse",
            responsePayloadBuffer: Buffer.alloc(0),
          };
        }

        if (requestTypeName === "eve_public.character.skill.plan.GetActiveRequest") {
          const activePlanID = getActivePlanID(activeCharacterID);
          const plan = activePlanID
            ? getPersonalPlan(activeCharacterID, activePlanID)
            : null;
          return {
            statusCode: 200,
            statusMessage: "",
            responseTypeName: "eve_public.character.skill.plan.GetActiveResponse",
            responsePayloadBuffer: encodePayload(
              types.getActiveResponse,
              activePlanID
                ? {
                    skill_plan: buildPlanIdentifier(activePlanID),
                    ...(plan ? { skill_plan_info: buildPlanAttributes(plan) } : {}),
                  }
                : {
                    skill_plan: buildPlanIdentifier(ZERO_UUID),
                  },
            ),
          };
        }

        if (requestTypeName === "eve_public.character.skill.plan.SetActiveRequest") {
          const decoded = decodePayload(types.setActiveRequest, requestEnvelope);
          setActivePlanID(activeCharacterID, extractPlanID(decoded.skill_plan));
          return {
            statusCode: 200,
            statusMessage: "",
            responseTypeName: "eve_public.character.skill.plan.SetActiveResponse",
            responsePayloadBuffer: Buffer.alloc(0),
          };
        }

        if (requestTypeName === "eve_public.character.skill.plan.milestone.GetAllRequest") {
          const decoded = decodePayload(types.milestoneGetAllRequest, requestEnvelope);
          const milestones = listPersonalMilestones(
            activeCharacterID,
            extractPlanID(decoded.skill_plan),
          );
          return {
            statusCode: 200,
            statusMessage: "",
            responseTypeName: "eve_public.character.skill.plan.milestone.GetAllResponse",
            responsePayloadBuffer: encodePayload(types.milestoneGetAllResponse, {
              milestones: milestones.map((milestone) => ({
                identifier: {
                  uuid: uuidStringToBuffer(milestone.milestoneID),
                },
                data: buildMilestoneAttributes(milestone),
              })),
            }),
          };
        }

        if (requestTypeName === "eve_public.character.skill.plan.milestone.CreateRequest") {
          const decoded = decodePayload(types.milestoneCreateRequest, requestEnvelope);
          const milestoneData = decoded.milestone || {};
          const created = createPersonalMilestone(
            activeCharacterID,
            extractPlanID(milestoneData.skill_plan),
            {
              description: milestoneData.description,
              trainToTypeID:
                milestoneData.train_to_type &&
                milestoneData.train_to_type.sequential,
              skillTypeID:
                milestoneData.skill &&
                milestoneData.skill.skill_type &&
                milestoneData.skill.skill_type.sequential,
              level: milestoneData.skill && milestoneData.skill.level,
            },
          );
          return {
            statusCode: 200,
            statusMessage: "",
            responseTypeName: "eve_public.character.skill.plan.milestone.CreateResponse",
            responsePayloadBuffer: encodePayload(types.milestoneCreateResponse, {
              milestone: {
                uuid: uuidStringToBuffer(created.milestoneID),
              },
            }),
          };
        }

        if (requestTypeName === "eve_public.character.skill.plan.milestone.DeleteRequest") {
          const decoded = decodePayload(types.milestoneDeleteRequest, requestEnvelope);
          deletePersonalMilestone(
            activeCharacterID,
            decoded && decoded.milestone ? uuidBufferToString(decoded.milestone.uuid) : null,
          );
          return {
            statusCode: 200,
            statusMessage: "",
            responseTypeName: "eve_public.character.skill.plan.milestone.DeleteResponse",
            responsePayloadBuffer: Buffer.alloc(0),
          };
        }

        const decoded = decodePayload(types.milestoneSetDescriptionRequest, requestEnvelope);
        updatePersonalMilestoneDescription(
          activeCharacterID,
          decoded && decoded.identifier ? uuidBufferToString(decoded.identifier.uuid) : null,
          decoded.description,
        );
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.character.skill.plan.milestone.SetDescriptionResponse",
          responsePayloadBuffer: Buffer.alloc(0),
        };
      } catch (error) {
        return buildErrorResponse(
          requestTypeName.replace(/Request$/, "Response"),
          error,
        );
      }
    },
  };
}

module.exports = {
  createSkillPlanGatewayService,
};
