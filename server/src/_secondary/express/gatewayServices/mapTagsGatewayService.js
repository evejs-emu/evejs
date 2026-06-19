"use strict";

const path = require("path");
const protobuf = require("protobufjs");

const {
  MAP_TAGS_CDN_PATH,
  MAP_TAGS_CDN_URL,
  getMapTagsAsset,
  getMapTagsCrc,
  getMapTagsSummary,
  getMapTagsVersion,
} = require(path.join(__dirname, "../../../services/map/mapTagsAuthority"));
const {
  bufferFromBytes,
  compareSemver,
  encodePayload,
} = require("./gatewayServiceHelpers");

const MAP_TAGS_GET_UPDATE_REQUEST_TYPES = new Set([
  "eve_public.space.api.cdn.GetUpdateRequest",
  "eve_public.space.api.cdn.requests_pb2.GetUpdateRequest",
]);
const MAP_TAGS_GET_UPDATE_RESPONSE_TYPE =
  "eve_public.space.api.cdn.GetUpdateResponse";

const HANDLED_REQUEST_TYPES = Object.freeze([
  ...MAP_TAGS_GET_UPDATE_REQUEST_TYPES,
]);

let protoRootCache = null;

function buildMapTagsGatewayProtoRoot() {
  return protobuf.Root.fromJSON({
    nested: {
      eve_public: {
        nested: {
          semanticversion: {
            nested: {
              Specification: {
                fields: {
                  major: { type: "uint32", id: 1 },
                  minor: { type: "uint32", id: 2 },
                  patch: { type: "uint32", id: 3 },
                  prerelease_tags: {
                    type: "string",
                    id: 4,
                    rule: "repeated",
                  },
                  build_tags: {
                    type: "string",
                    id: 5,
                    rule: "repeated",
                  },
                },
              },
            },
          },
          cdn: {
            nested: {
              Checksum: {
                fields: {
                  crc: { type: "uint32", id: 1 },
                },
              },
              Checkpoint: {
                fields: {
                  url: { type: "string", id: 1 },
                  version: {
                    type: "eve_public.semanticversion.Specification",
                    id: 2,
                  },
                  crc: {
                    type: "eve_public.cdn.Checksum",
                    id: 3,
                  },
                },
              },
            },
          },
          space: {
            nested: {
              api: {
                nested: {
                  cdn: {
                    nested: {
                      GetUpdateRequest: {
                        fields: {
                          current_version: {
                            type: "eve_public.semanticversion.Specification",
                            id: 1,
                          },
                          no_local_version_available: {
                            type: "bool",
                            id: 2,
                          },
                        },
                      },
                      GetUpdateResponse: {
                        fields: {
                          checkpoint: {
                            type: "eve_public.cdn.Checkpoint",
                            id: 1,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

function getMapTagsGatewayProtoRoot() {
  if (!protoRootCache) {
    protoRootCache = buildMapTagsGatewayProtoRoot();
  }
  return protoRootCache;
}

function getTypes() {
  const root = getMapTagsGatewayProtoRoot();
  return {
    root,
    getUpdateRequest: root.lookupType("eve_public.space.api.cdn.GetUpdateRequest"),
    getUpdateResponse: root.lookupType(MAP_TAGS_GET_UPDATE_RESPONSE_TYPE),
  };
}

function decodeRequestPayload(requestEnvelope) {
  const payloadBuffer = bufferFromBytes(
    requestEnvelope && requestEnvelope.payload && requestEnvelope.payload.value,
  );
  if (payloadBuffer.length <= 0) {
    return {};
  }
  return getTypes().getUpdateRequest.decode(payloadBuffer);
}

function buildSuccessResult(messageType, payload = {}) {
  return {
    statusCode: 200,
    statusMessage: "",
    responseTypeName: MAP_TAGS_GET_UPDATE_RESPONSE_TYPE,
    responsePayloadBuffer: encodePayload(messageType, payload),
  };
}

function shouldReturnCheckpoint(decodedRequest) {
  if (!decodedRequest || decodedRequest.no_local_version_available) {
    return true;
  }
  if (!decodedRequest.current_version) {
    return true;
  }
  return compareSemver(decodedRequest.current_version, getMapTagsVersion()) < 0;
}

function buildCheckpoint() {
  return {
    url: MAP_TAGS_CDN_URL,
    version: getMapTagsVersion(),
    crc: {
      crc: getMapTagsCrc(),
    },
  };
}

function getMapTagsCdnAsset(routePath) {
  if (routePath !== MAP_TAGS_CDN_PATH) {
    return null;
  }
  const buffer = getMapTagsAsset();
  if (!Buffer.isBuffer(buffer) || buffer.length <= 0) {
    return null;
  }
  return {
    buffer,
    contentType: "application/octet-stream",
  };
}

function createMapTagsGatewayService() {
  getMapTagsSummary();
  return {
    name: "map-tags",
    handledRequestTypes: HANDLED_REQUEST_TYPES,
    getEmptySuccessResponseType() {
      return null;
    },
    handleRequest(requestTypeName, requestEnvelope) {
      if (!HANDLED_REQUEST_TYPES.includes(requestTypeName)) {
        return null;
      }
      const types = getTypes();
      const decoded = decodeRequestPayload(requestEnvelope);
      const payload = shouldReturnCheckpoint(decoded)
        ? { checkpoint: buildCheckpoint() }
        : {};
      return buildSuccessResult(types.getUpdateResponse, payload);
    },
  };
}

module.exports = {
  MAP_TAGS_GET_UPDATE_RESPONSE_TYPE,
  createMapTagsGatewayService,
  getMapTagsCdnAsset,
  getMapTagsGatewayProtoRoot,
};
