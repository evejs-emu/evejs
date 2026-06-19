const path = require("path");

const {
  encodePayload,
  getActiveCharacterID,
  timestampFromMs,
  uuidBufferToString,
  uuidStringToBuffer,
} = require("./gatewayServiceHelpers");
const {
  getSovereigntyProtoTypes,
} = require(path.join(
  __dirname,
  "../../../services/sovereignty/sovGatewayProto",
));
const {
  getMercenaryActivityCapacity,
  getMercenaryDenActivities,
  getMercenaryDenAsOwner,
  getMercenaryDenMaximumForCharacter,
  listMercenaryDenActivitiesForCharacter,
  listOwnedMercenaryDenIDs,
  startMercenaryDenActivity,
} = require(path.join(
  __dirname,
  "../../../services/sovereignty/mercenaryDenState",
));

const HANDLED_REQUEST_TYPES = Object.freeze([
  "eve_public.sovereignty.mercenaryden.api.GetAsOwnerRequest",
  "eve_public.sovereignty.mercenaryden.api.GetAllOwnedRequest",
  "eve_public.sovereignty.mercenaryden.api.GetMaximumForCharacterRequest",
  "eve_public.sovereignty.mercenaryden.activity.api.GetForMercenaryDenRequest",
  "eve_public.sovereignty.mercenaryden.activity.api.GetAllRequest",
  "eve_public.sovereignty.mercenaryden.activity.api.StartRequest",
  "eve_public.sovereignty.mercenaryden.activity.api.GetCapacityRequest",
]);

function buildErrorResult(requestTypeName, statusCode, errorCode = "") {
  return {
    statusCode,
    statusMessage: String(errorCode || ""),
    responseTypeName: requestTypeName.replace(/Request$/, "Response"),
    responsePayloadBuffer: Buffer.alloc(0),
  };
}

function decodePayload(messageType, requestEnvelope) {
  return messageType.decode(
    requestEnvelope && requestEnvelope.payload && requestEnvelope.payload.value
      ? Buffer.from(requestEnvelope.payload.value)
      : Buffer.alloc(0),
  );
}

function buildSequentialIdentifier(id) {
  return {
    sequential: Number(id || 0),
  };
}

function buildMercenaryActivityTemplatePayload(template = {}) {
  return {
    name: buildSequentialIdentifier(template.nameMessageID),
    description: buildSequentialIdentifier(template.descriptionMessageID),
    dungeon: buildSequentialIdentifier(template.dungeonID),
    development_impact: Number(template.developmentImpact || 0),
    anarchy_impact: Number(template.anarchyImpact || 0),
    infomorph_bonus: Number(template.infomorphBonus || 0),
  };
}

function buildEvolutionPayload(evolution = {}) {
  const definition = evolution.definition || {};
  const simulation = evolution.simulation || {};
  const developmentDefinition = definition.development || {};
  const anarchyDefinition = definition.anarchy || {};
  const developmentSimulation = simulation.development || {};
  const anarchySimulation = simulation.anarchy || {};

  return {
    definition: {
      development: {
        unit_increase_time_seconds: Number(
          developmentDefinition.unitIncreaseTimeSeconds || 0,
        ),
        stages: (developmentDefinition.stages || []).map((stage) => ({
          stage: Number(stage.stage || 0),
          level_lower_bound: Number(stage.levelLowerBound || 0),
          level_upper_bound: Number(stage.levelUpperBound || 0),
        })),
      },
      anarchy: {
        unit_increase_time_seconds: Number(
          anarchyDefinition.unitIncreaseTimeSeconds || 0,
        ),
        stages: (anarchyDefinition.stages || []).map((stage) => ({
          stage: Number(stage.stage || 0),
          level_lower_bound: Number(stage.levelLowerBound || 0),
          level_upper_bound: Number(stage.levelUpperBound || 0),
          workforce_consumption: Number(stage.workforceConsumption || 0),
        })),
      },
    },
    simulation: {
      paused: Boolean(simulation.paused),
      started: Boolean(simulation.started),
      development: {
        level: Number(developmentSimulation.level || 0),
        stage: Number(developmentSimulation.stage || 0),
        ...(Number(developmentSimulation.pausedAtMs || 0) > 0
          ? { paused_at: timestampFromMs(developmentSimulation.pausedAtMs) }
          : { simulated_at: timestampFromMs(developmentSimulation.simulatedAtMs) }),
      },
      anarchy: {
        level: Number(anarchySimulation.level || 0),
        stage: Number(anarchySimulation.stage || 0),
        ...(Number(anarchySimulation.pausedAtMs || 0) > 0
          ? { paused_at: timestampFromMs(anarchySimulation.pausedAtMs) }
          : { simulated_at: timestampFromMs(anarchySimulation.simulatedAtMs) }),
      },
    },
  };
}

function buildInfomorphsPayload(infomorphs = {}) {
  const definition = infomorphs.definition || {};
  const contents = infomorphs.contents || {};
  return {
    definition: {
      infomorph_type: buildSequentialIdentifier(definition.infomorphTypeID),
      generation_tick_seconds: Number(definition.generationTickSeconds || 0),
      generation_bands: (definition.generationBands || []).map((band) => ({
        stage: Number(band.stage || 0),
        lower_band: Number(band.lowerBand || 0),
        upper_band: Number(band.upperBand || 0),
      })),
      cargo_capacity: Number(definition.cargoCapacity || 0),
    },
    contents: {
      infomorphs_count: Number(contents.count || 0),
      last_generation_tick: timestampFromMs(contents.lastGenerationTickMs),
    },
  };
}

function buildMercenaryDenAttributesPayload(den = {}) {
  return {
    owner: buildSequentialIdentifier(den.ownerCharacterID),
    skyhook: buildSequentialIdentifier(den.skyhookID),
    solar_system: buildSequentialIdentifier(den.solarSystemID),
    planet: buildSequentialIdentifier(den.planetID),
    type: buildSequentialIdentifier(den.typeID),
  };
}

function buildMercenaryActivityAttributesPayload(activity = {}) {
  return {
    activitytemplate: buildMercenaryActivityTemplatePayload(activity.template),
    mercenary_den: buildSequentialIdentifier(activity.mercenaryDenID),
    started: Boolean(activity.started),
    expiry: timestampFromMs(activity.expiryMs),
    solar_system: buildSequentialIdentifier(activity.solarSystemID),
  };
}

function buildMercenaryActivityEntryPayload(activity = {}) {
  return {
    id: {
      uuid: uuidStringToBuffer(activity.activityID),
    },
    attributes: buildMercenaryActivityAttributesPayload(activity),
  };
}

function createMercenaryDenGatewayService({ publishGatewayNotice }) {
  const types = getSovereigntyProtoTypes();

  function publishNotice(typeName, messageType, payload, targetGroup) {
    if (typeof publishGatewayNotice !== "function") {
      return;
    }
    publishGatewayNotice(typeName, encodePayload(messageType, payload), targetGroup);
  }

  return {
    name: "mercenary-den",
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
      if (activeCharacterID <= 0) {
        return buildErrorResult(requestTypeName, 403, "ACCESS_DENIED");
      }

      if (requestTypeName === "eve_public.sovereignty.mercenaryden.api.GetAllOwnedRequest") {
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.sovereignty.mercenaryden.api.GetAllOwnedResponse",
          responsePayloadBuffer: encodePayload(
            types.mercenaryDenGetAllOwnedResponse,
            {
              id: listOwnedMercenaryDenIDs(activeCharacterID).map(
                buildSequentialIdentifier,
              ),
            },
          ),
        };
      }

      if (
        requestTypeName ===
        "eve_public.sovereignty.mercenaryden.api.GetMaximumForCharacterRequest"
      ) {
        const maximum = getMercenaryDenMaximumForCharacter(activeCharacterID);
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.sovereignty.mercenaryden.api.GetMaximumForCharacterResponse",
          responsePayloadBuffer: encodePayload(
            types.mercenaryDenGetMaximumForCharacterResponse,
            {
              current_maximum: Number(maximum.currentMaximum || 0),
              absolute_maximum: Number(maximum.absoluteMaximum || 0),
            },
          ),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.mercenaryden.api.GetAsOwnerRequest") {
        const decoded = decodePayload(types.mercenaryDenGetAsOwnerRequest, requestEnvelope);
        const mercenaryDenID = Number(decoded && decoded.id && decoded.id.sequential) || 0;
        const result = getMercenaryDenAsOwner(activeCharacterID, mercenaryDenID);
        if (!result.ok) {
          return buildErrorResult(requestTypeName, result.statusCode, result.errorCode);
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.sovereignty.mercenaryden.api.GetAsOwnerResponse",
          responsePayloadBuffer: encodePayload(
            types.mercenaryDenGetAsOwnerResponse,
            {
              attributes: buildMercenaryDenAttributesPayload(result.den),
              enabled: Boolean(result.den.enabled),
              evolution: buildEvolutionPayload(result.den.evolution),
              infomorphs: buildInfomorphsPayload(result.den.infomorphs),
              cargo_extraction_enabled: Boolean(result.den.cargoExtractionEnabled),
              skyhook_owner: buildSequentialIdentifier(
                result.den.skyhookOwnerCorporationID,
              ),
            },
          ),
        };
      }

      if (
        requestTypeName ===
        "eve_public.sovereignty.mercenaryden.activity.api.GetAllRequest"
      ) {
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.sovereignty.mercenaryden.activity.api.GetAllResponse",
          responsePayloadBuffer: encodePayload(
            types.mercenaryActivityGetAllResponse,
            {
              activities: listMercenaryDenActivitiesForCharacter(
                activeCharacterID,
              ).map(buildMercenaryActivityEntryPayload),
            },
          ),
        };
      }

      if (
        requestTypeName ===
        "eve_public.sovereignty.mercenaryden.activity.api.GetForMercenaryDenRequest"
      ) {
        const decoded = decodePayload(
          types.mercenaryActivityGetForDenRequest,
          requestEnvelope,
        );
        const mercenaryDenID = Number(
          decoded && decoded.mercenary_den && decoded.mercenary_den.sequential,
        ) || 0;
        const result = getMercenaryDenActivities(activeCharacterID, mercenaryDenID);
        if (!result.ok) {
          return buildErrorResult(requestTypeName, result.statusCode, result.errorCode);
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.sovereignty.mercenaryden.activity.api.GetForMercenaryDenResponse",
          responsePayloadBuffer: encodePayload(
            types.mercenaryActivityGetForDenResponse,
            {
              activities: (result.activities || []).map(
                buildMercenaryActivityEntryPayload,
              ),
              next_generation_at: timestampFromMs(result.nextGenerationAtMs),
            },
          ),
        };
      }

      if (
        requestTypeName ===
        "eve_public.sovereignty.mercenaryden.activity.api.GetCapacityRequest"
      ) {
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.sovereignty.mercenaryden.activity.api.GetCapacityResponse",
          responsePayloadBuffer: encodePayload(
            types.mercenaryActivityGetCapacityResponse,
            {
              capacity: Number(getMercenaryActivityCapacity() || 0),
            },
          ),
        };
      }

      if (
        requestTypeName ===
        "eve_public.sovereignty.mercenaryden.activity.api.StartRequest"
      ) {
        const decoded = decodePayload(types.mercenaryActivityStartRequest, requestEnvelope);
        const activityID = uuidBufferToString(
          decoded && decoded.id && decoded.id.uuid ? decoded.id.uuid : Buffer.alloc(0),
        );
        const result = startMercenaryDenActivity(activeCharacterID, activityID);
        if (!result.ok) {
          return buildErrorResult(requestTypeName, result.statusCode, result.errorCode);
        }

        publishNotice(
          "eve_public.sovereignty.mercenaryden.activity.api.StartedNotice",
          types.mercenaryActivityStartedNotice,
          {
            id: {
              uuid: uuidStringToBuffer(result.activity.activityID),
            },
            activity: buildMercenaryActivityAttributesPayload(result.activity),
          },
          { character: result.ownerCharacterID },
        );

        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.sovereignty.mercenaryden.activity.api.StartResponse",
          responsePayloadBuffer: encodePayload(
            types.mercenaryActivityStartResponse,
            {
              attributes: buildMercenaryActivityAttributesPayload(result.activity),
            },
          ),
        };
      }

      return null;
    },
  };
}

module.exports = {
  createMercenaryDenGatewayService,
};
