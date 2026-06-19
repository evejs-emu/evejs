const path = require("path");

const {
  buildDict,
} = require(path.join(__dirname, "../../../services/_shared/serviceHelpers"));
const {
  encodePayload,
  getActiveCharacterID,
} = require("./gatewayServiceHelpers");
const sessionRegistry = require(path.join(
  __dirname,
  "../../../services/chat/sessionRegistry",
));
const {
  COSMETIC_TYPE_ALLIANCE_LOGO,
  COSMETIC_TYPE_CORPORATION_LOGO,
} = require(path.join(
  __dirname,
  "../../../services/evermarks/evermarksConstants",
));
const {
  clearDisplayedLogo,
  getEnabledCosmeticsEntries,
  setDisplayedLogo,
} = require(path.join(
  __dirname,
  "../../../services/ship/shipLogoFittingState",
));
const {
  buildShipLogoGatewayProtoRoot,
} = require(path.join(
  __dirname,
  "../../../services/ship/shipLogoGatewayProto",
));

const HANDLED_REQUEST_TYPES = Object.freeze([
  "eve_public.cosmetic.ship.logo.DisplayRequest",
  "eve_public.cosmetic.ship.logo.ClearRequest",
]);

const ERROR_STATUS_BY_CODE = Object.freeze({
  ENTITLEMENT_NOT_OWNED: 403,
  INVALID_CHARACTER: 400,
  INVALID_DATA: 400,
  SHIP_NOT_FOUND: 404,
  WRITE_ERROR: 500,
});

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    return fallback;
  }
  return numeric;
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

function buildEnabledCosmeticsDict(shipID) {
  return buildDict(
    getEnabledCosmeticsEntries(shipID).map((entry) => [
      entry.backendSlot,
      entry.cosmeticType,
    ]),
  );
}

function notifyLiveCharacterSessions(characterID, shipID, backendSlot, cosmeticType) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  if (!normalizedCharacterID) {
    return;
  }

  for (const session of sessionRegistry.getSessions()) {
    if (normalizePositiveInteger(session && session.characterID, 0) !== normalizedCharacterID) {
      continue;
    }

    session.sendNotification("OnShipCosmeticChanged", "clientID", [
      shipID,
      backendSlot,
      cosmeticType,
    ]);
    session.sendNotification("OnShipCosmeticsChanged", "clientID", [
      shipID,
      buildEnabledCosmeticsDict(shipID),
    ]);
  }
}

function broadcastLiveShipSlimRefresh(characterID, shipID) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  const normalizedShipID = normalizePositiveInteger(shipID, 0);
  if (!normalizedCharacterID || !normalizedShipID) {
    return;
  }

  const seenSystems = new Set();
  for (const session of sessionRegistry.getSessions()) {
    if (normalizePositiveInteger(session && session.characterID, 0) !== normalizedCharacterID) {
      continue;
    }

    try {
      const spaceRuntime = require(path.join(__dirname, "../../../space/runtime"));
      const scene =
        spaceRuntime && typeof spaceRuntime.getSceneForSession === "function"
          ? spaceRuntime.getSceneForSession(session)
          : null;
      if (!scene || seenSystems.has(Number(scene.systemID) || 0)) {
        continue;
      }

      const entity =
        scene.dynamicEntities instanceof Map
          ? scene.dynamicEntities.get(normalizedShipID) || null
          : null;
      if (!entity || entity.kind !== "ship") {
        continue;
      }

      seenSystems.add(Number(scene.systemID) || 0);
      if (typeof scene.broadcastSlimItemChanges === "function") {
        scene.broadcastSlimItemChanges([entity]);
      }
    } catch (error) {
      continue;
    }
  }
}

function resolveDisplayCosmeticType(decodedRequest) {
  if (
    decodedRequest &&
    decodedRequest.attr &&
    decodedRequest.attr.alliance !== undefined &&
    decodedRequest.attr.alliance !== null
  ) {
    return COSMETIC_TYPE_ALLIANCE_LOGO;
  }
  if (
    decodedRequest &&
    decodedRequest.attr &&
    decodedRequest.attr.corporation !== undefined &&
    decodedRequest.attr.corporation !== null
  ) {
    return COSMETIC_TYPE_CORPORATION_LOGO;
  }
  return 0;
}

function buildErrorResult(errorCode, responseTypeName) {
  return {
    statusCode: ERROR_STATUS_BY_CODE[errorCode] || 400,
    statusMessage: "",
    responseTypeName,
    responsePayloadBuffer: Buffer.alloc(0),
  };
}

function createShipLogoGatewayService() {
  const protoRoot = buildShipLogoGatewayProtoRoot();
  const types = {
    displayRequest: protoRoot.lookupType(
      "eve_public.cosmetic.ship.logo.DisplayRequest",
    ),
    displayResponse: protoRoot.lookupType(
      "eve_public.cosmetic.ship.logo.DisplayResponse",
    ),
    clearRequest: protoRoot.lookupType(
      "eve_public.cosmetic.ship.logo.ClearRequest",
    ),
    clearResponse: protoRoot.lookupType(
      "eve_public.cosmetic.ship.logo.ClearResponse",
    ),
  };

  return {
    name: "ship-logo",
    handledRequestTypes: HANDLED_REQUEST_TYPES,
    getEmptySuccessResponseType() {
      return null;
    },
    handleRequest(requestTypeName, requestEnvelope) {
      if (!HANDLED_REQUEST_TYPES.includes(requestTypeName)) {
        return null;
      }

      const activeCharacterID = getActiveCharacterID(requestEnvelope);
      if (requestTypeName === "eve_public.cosmetic.ship.logo.DisplayRequest") {
        const decoded = decodePayload(types.displayRequest, requestEnvelope);
        const shipID = normalizePositiveInteger(
          decoded && decoded.id && decoded.id.ship && decoded.id.ship.sequential,
          0,
        );
        const backendSlot = normalizeNonNegativeInteger(
          decoded && decoded.id && decoded.id.index,
          -1,
        );
        const cosmeticType = resolveDisplayCosmeticType(decoded);
        const result = setDisplayedLogo(shipID, backendSlot, cosmeticType, {
          characterID: activeCharacterID,
        });
        if (!result.success) {
          return buildErrorResult(
            result.errorMsg,
            "eve_public.cosmetic.ship.logo.DisplayResponse",
          );
        }

        notifyLiveCharacterSessions(
          activeCharacterID,
          shipID,
          backendSlot,
          cosmeticType,
        );
        broadcastLiveShipSlimRefresh(activeCharacterID, shipID);

        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.cosmetic.ship.logo.DisplayResponse",
          responsePayloadBuffer: encodePayload(types.displayResponse, {}),
        };
      }

      const decoded = decodePayload(types.clearRequest, requestEnvelope);
      const shipID = normalizePositiveInteger(
        decoded && decoded.logo && decoded.logo.ship && decoded.logo.ship.sequential,
        0,
      );
      const backendSlot = normalizeNonNegativeInteger(
        decoded && decoded.logo && decoded.logo.index,
        -1,
      );
      const result = clearDisplayedLogo(shipID, backendSlot);
      if (!result.success) {
        return buildErrorResult(
          result.errorMsg,
          "eve_public.cosmetic.ship.logo.ClearResponse",
        );
      }

      notifyLiveCharacterSessions(activeCharacterID, shipID, backendSlot, null);
      broadcastLiveShipSlimRefresh(activeCharacterID, shipID);

      return {
        statusCode: 200,
        statusMessage: "",
        responseTypeName: "eve_public.cosmetic.ship.logo.ClearResponse",
        responsePayloadBuffer: encodePayload(types.clearResponse, {}),
      };
    },
  };
}

module.exports = {
  buildEnabledCosmeticsDict,
  createShipLogoGatewayService,
};
