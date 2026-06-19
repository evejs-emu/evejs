function normalizeUint(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }

  return Math.trunc(numeric);
}

function normalizeProtoNumber(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "object" && typeof value.toNumber === "function") {
    return value.toNumber();
  }

  return Number(value);
}

function buildFraction(numerator = 0, denominator = 1) {
  const normalizedDenominator = normalizeUint(denominator, 1);
  return {
    numerator: normalizeUint(numerator, 0),
    denominator: normalizedDenominator > 0 ? normalizedDenominator : 1,
  };
}

function buildSystemInfo(stage = 0) {
  return {
    total_progress: buildFraction(0, 1),
    stage: normalizeUint(stage, 0),
    eve_contribution: buildFraction(0, 1),
    vanguard_contribution: buildFraction(0, 1),
  };
}

function getPublicCorruptionSystemInfo(_systemID = 0) {
  return buildSystemInfo(0);
}

function getPublicSuppressionSystemInfo(_systemID = 0) {
  return buildSystemInfo(0);
}

function getPublicCorruptionStageThresholds() {
  return {
    thresholds: [],
  };
}

function getPublicSuppressionStageThresholds() {
  return {
    thresholds: [],
  };
}

function buildEncodedPayload(messageType, payload) {
  return Buffer.from(messageType.encode(messageType.create(payload)).finish());
}

function createInsurgencyGatewayService({ protoRoot }) {
  const publicCorruptionGetSystemInfoRequest = protoRoot.lookupType(
    "eve_public.pirate.corruption.api.GetSystemInfoRequest",
  );
  const publicCorruptionGetSystemInfoResponse = protoRoot.lookupType(
    "eve_public.pirate.corruption.api.GetSystemInfoResponse",
  );
  const publicCorruptionGetStageThresholdsResponse = protoRoot.lookupType(
    "eve_public.pirate.corruption.api.GetStageThresholdsResponse",
  );
  const publicSuppressionGetSystemInfoRequest = protoRoot.lookupType(
    "eve_public.pirate.suppression.api.GetSystemInfoRequest",
  );
  const publicSuppressionGetSystemInfoResponse = protoRoot.lookupType(
    "eve_public.pirate.suppression.api.GetSystemInfoResponse",
  );
  const publicSuppressionGetStageThresholdsResponse = protoRoot.lookupType(
    "eve_public.pirate.suppression.api.GetStageThresholdsResponse",
  );

  function getSystemID(requestType, requestEnvelope) {
    const request = requestType.decode(requestEnvelope.payload.value || Buffer.alloc(0));
    return normalizeProtoNumber(request?.system?.sequential);
  }

  return {
    name: "insurgency",
    handledRequestTypes: [
      "eve_public.pirate.corruption.api.GetSystemInfoRequest",
      "eve_public.pirate.corruption.api.GetStageThresholdsRequest",
      "eve_public.pirate.suppression.api.GetSystemInfoRequest",
      "eve_public.pirate.suppression.api.GetStageThresholdsRequest",
    ],
    handleRequest(requestTypeName, requestEnvelope) {
      if (requestTypeName === "eve_public.pirate.corruption.api.GetSystemInfoRequest") {
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.pirate.corruption.api.GetSystemInfoResponse",
          responsePayloadBuffer: buildEncodedPayload(
            publicCorruptionGetSystemInfoResponse,
            getPublicCorruptionSystemInfo(
              getSystemID(publicCorruptionGetSystemInfoRequest, requestEnvelope),
            ),
          ),
        };
      }

      if (requestTypeName === "eve_public.pirate.corruption.api.GetStageThresholdsRequest") {
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.pirate.corruption.api.GetStageThresholdsResponse",
          responsePayloadBuffer: buildEncodedPayload(
            publicCorruptionGetStageThresholdsResponse,
            getPublicCorruptionStageThresholds(),
          ),
        };
      }

      if (requestTypeName === "eve_public.pirate.suppression.api.GetSystemInfoRequest") {
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.pirate.suppression.api.GetSystemInfoResponse",
          responsePayloadBuffer: buildEncodedPayload(
            publicSuppressionGetSystemInfoResponse,
            getPublicSuppressionSystemInfo(
              getSystemID(publicSuppressionGetSystemInfoRequest, requestEnvelope),
            ),
          ),
        };
      }

      if (requestTypeName === "eve_public.pirate.suppression.api.GetStageThresholdsRequest") {
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.pirate.suppression.api.GetStageThresholdsResponse",
          responsePayloadBuffer: buildEncodedPayload(
            publicSuppressionGetStageThresholdsResponse,
            getPublicSuppressionStageThresholds(),
          ),
        };
      }

      return null;
    },
  };
}

module.exports = {
  createInsurgencyGatewayService,
};
module.exports._testing = {
  buildFraction,
};
