const path = require("path");

const {
  encodePayload,
  getActiveCharacterID,
} = require("./gatewayServiceHelpers");
const {
  SHIP_LOGO_ENTITLEMENT_ALLIANCE,
  SHIP_LOGO_ENTITLEMENT_CORPORATION,
} = require(path.join(
  __dirname,
  "../../../services/evermarks/evermarksConstants",
));
const {
  listOwnedShipLogoEntitlements,
  grantShipLogoEntitlement,
  revokeShipLogoEntitlement,
} = require(path.join(
  __dirname,
  "../../../services/evermarks/evermarksEntitlements",
));
const {
  buildEvermarksGatewayProtoRoot,
} = require(path.join(
  __dirname,
  "../../../services/evermarks/evermarksGatewayProto",
));
const {
  publishShipLogoGrantedNotice,
  publishShipLogoRevokedNotice,
} = require(path.join(
  __dirname,
  "../../../services/evermarks/evermarksNotices",
));

const HANDLED_REQUEST_TYPES = Object.freeze([
  "eve_public.entitlement.character.GetAllRequest",
  "eve_public.entitlement.character.ship.admin.corplogo.GrantRequest",
  "eve_public.entitlement.character.ship.admin.corplogo.RevokeRequest",
  "eve_public.entitlement.character.ship.admin.alliancelogo.GrantRequest",
  "eve_public.entitlement.character.ship.admin.alliancelogo.RevokeRequest",
]);

const ERROR_STATUS_BY_CODE = Object.freeze({
  INVALID_CHARACTER: 400,
  INVALID_DATA: 400,
  LICENSE_NOT_FOUND: 404,
  NOT_FOUND: 404,
  WRITE_ERROR: 500,
});

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
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

function buildCharacterIdentifier(characterID) {
  return {
    sequential: normalizePositiveInteger(characterID, 0),
  };
}

function buildShipTypeIdentifier(shipTypeID) {
  return {
    sequential: normalizePositiveInteger(shipTypeID, 0),
  };
}

function buildEntitlementPayload(entry) {
  const entitlement = {
    character: buildCharacterIdentifier(entry && entry.characterID),
    ship_type: buildShipTypeIdentifier(entry && entry.shipTypeID),
  };
  if (
    normalizePositiveInteger(entry && entry.entitlementType, 0) ===
    SHIP_LOGO_ENTITLEMENT_ALLIANCE
  ) {
    return {
      alliance_logo: entitlement,
    };
  }
  return {
    corporation_logo: entitlement,
  };
}

function extractIdentifierData(identifier) {
  return {
    characterID: normalizePositiveInteger(
      identifier &&
        identifier.character &&
        identifier.character.sequential,
      0,
    ),
    shipTypeID: normalizePositiveInteger(
      identifier &&
        identifier.ship_type &&
        identifier.ship_type.sequential,
      0,
    ),
  };
}

function buildErrorResult(errorCode, responseTypeName) {
  return {
    statusCode: ERROR_STATUS_BY_CODE[errorCode] || 400,
    statusMessage: "",
    responseTypeName,
    responsePayloadBuffer: Buffer.alloc(0),
  };
}

function createEvermarksGatewayService(context = {}) {
  const protoRoot = buildEvermarksGatewayProtoRoot();
  const types = {
    getAllResponse: protoRoot.lookupType(
      "eve_public.entitlement.character.GetAllResponse",
    ),
    corpGrantRequest: protoRoot.lookupType(
      "eve_public.entitlement.character.ship.admin.corplogo.GrantRequest",
    ),
    corpGrantResponse: protoRoot.lookupType(
      "eve_public.entitlement.character.ship.admin.corplogo.GrantResponse",
    ),
    corpRevokeRequest: protoRoot.lookupType(
      "eve_public.entitlement.character.ship.admin.corplogo.RevokeRequest",
    ),
    corpRevokeResponse: protoRoot.lookupType(
      "eve_public.entitlement.character.ship.admin.corplogo.RevokeResponse",
    ),
    allianceGrantRequest: protoRoot.lookupType(
      "eve_public.entitlement.character.ship.admin.alliancelogo.GrantRequest",
    ),
    allianceGrantResponse: protoRoot.lookupType(
      "eve_public.entitlement.character.ship.admin.alliancelogo.GrantResponse",
    ),
    allianceRevokeRequest: protoRoot.lookupType(
      "eve_public.entitlement.character.ship.admin.alliancelogo.RevokeRequest",
    ),
    allianceRevokeResponse: protoRoot.lookupType(
      "eve_public.entitlement.character.ship.admin.alliancelogo.RevokeResponse",
    ),
  };

  function grantOrRevoke(
    requestTypeName,
    requestEnvelope,
    requestType,
    responseType,
    entitlementType,
    mode,
  ) {
    const decoded = decodePayload(requestType, requestEnvelope);
    const data = extractIdentifierData(decoded && decoded.entitlement);
    const activeCharacterID = getActiveCharacterID(requestEnvelope);
    const result =
      mode === "grant"
        ? grantShipLogoEntitlement(
            data.characterID,
            data.shipTypeID,
            entitlementType,
            {
              source: "public_gateway_admin_grant",
            },
          )
        : revokeShipLogoEntitlement(
            data.characterID,
            data.shipTypeID,
            entitlementType,
          );

    if (!result.success) {
      return buildErrorResult(
        result.errorMsg,
        requestTypeName.replace(/Request$/, "Response"),
      );
    }

    if (mode === "grant") {
      publishShipLogoGrantedNotice(result.data, {
        publishGatewayNotice: context.publishGatewayNotice,
      });
    } else {
      publishShipLogoRevokedNotice(
        result.data,
        activeCharacterID,
        {
          publishGatewayNotice: context.publishGatewayNotice,
        },
      );
    }

    return {
      statusCode: 200,
      statusMessage: "",
      responseTypeName: requestTypeName.replace(/Request$/, "Response"),
      responsePayloadBuffer: encodePayload(responseType, {}),
    };
  }

  return {
    name: "evermarks",
    handledRequestTypes: HANDLED_REQUEST_TYPES,
    getEmptySuccessResponseType() {
      return null;
    },
    handleRequest(requestTypeName, requestEnvelope) {
      if (!HANDLED_REQUEST_TYPES.includes(requestTypeName)) {
        return null;
      }

      const activeCharacterID = getActiveCharacterID(requestEnvelope);
      if (
        requestTypeName === "eve_public.entitlement.character.GetAllRequest"
      ) {
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.entitlement.character.GetAllResponse",
          responsePayloadBuffer: encodePayload(types.getAllResponse, {
            entitlements: listOwnedShipLogoEntitlements(activeCharacterID).map(
              buildEntitlementPayload,
            ),
          }),
        };
      }

      if (
        requestTypeName ===
        "eve_public.entitlement.character.ship.admin.corplogo.GrantRequest"
      ) {
        return grantOrRevoke(
          requestTypeName,
          requestEnvelope,
          types.corpGrantRequest,
          types.corpGrantResponse,
          SHIP_LOGO_ENTITLEMENT_CORPORATION,
          "grant",
        );
      }

      if (
        requestTypeName ===
        "eve_public.entitlement.character.ship.admin.corplogo.RevokeRequest"
      ) {
        return grantOrRevoke(
          requestTypeName,
          requestEnvelope,
          types.corpRevokeRequest,
          types.corpRevokeResponse,
          SHIP_LOGO_ENTITLEMENT_CORPORATION,
          "revoke",
        );
      }

      if (
        requestTypeName ===
        "eve_public.entitlement.character.ship.admin.alliancelogo.GrantRequest"
      ) {
        return grantOrRevoke(
          requestTypeName,
          requestEnvelope,
          types.allianceGrantRequest,
          types.allianceGrantResponse,
          SHIP_LOGO_ENTITLEMENT_ALLIANCE,
          "grant",
        );
      }

      if (
        requestTypeName ===
        "eve_public.entitlement.character.ship.admin.alliancelogo.RevokeRequest"
      ) {
        return grantOrRevoke(
          requestTypeName,
          requestEnvelope,
          types.allianceRevokeRequest,
          types.allianceRevokeResponse,
          SHIP_LOGO_ENTITLEMENT_ALLIANCE,
          "revoke",
        );
      }

      return null;
    },
  };
}

module.exports = {
  createEvermarksGatewayService,
};
