const path = require("path");

const {
  canCharacterEditCorporationColorPalette,
  getCorporationColorPalette,
  getCorporationIDForCharacter,
  setCorporationColorPalette,
} = require(path.join(
  __dirname,
  "../../../services/corporation/corpColorsState",
));

const HANDLED_REQUEST_TYPES = Object.freeze([
  "eve_public.cosmetic.corporation.palette.api.GetRequest",
  "eve_public.cosmetic.corporation.palette.api.GetOwnRequest",
  "eve_public.cosmetic.corporation.palette.api.SetRequest",
  "eve_public.cosmetic.corporation.palette.api.CanEditRequest",
]);

function currentTimestamp() {
  const now = Date.now();
  return {
    seconds: Math.floor(now / 1000),
    nanos: (now % 1000) * 1000000,
  };
}

function filetimeToTimestamp(filetimeValue) {
  try {
    const filetime = BigInt(String(filetimeValue || "0"));
    if (filetime <= 116444736000000000n) {
      return currentTimestamp();
    }
    const unixTicks = filetime - 116444736000000000n;
    const seconds = unixTicks / 10000000n;
    const nanos = (unixTicks % 10000000n) * 100n;
    return {
      seconds: Number(seconds),
      nanos: Number(nanos),
    };
  } catch (error) {
    return currentTimestamp();
  }
}

function getActiveCharacterID(requestEnvelope) {
  const identityCharacter =
    requestEnvelope &&
    requestEnvelope.authoritative_context &&
    requestEnvelope.authoritative_context.identity &&
    requestEnvelope.authoritative_context.identity.character
      ? Number(requestEnvelope.authoritative_context.identity.character.sequential || 0)
      : 0;
  if (identityCharacter > 0) {
    return identityCharacter;
  }
  const activeCharacter =
    requestEnvelope &&
    requestEnvelope.authoritative_context &&
    requestEnvelope.authoritative_context.active_character
      ? Number(requestEnvelope.authoritative_context.active_character.sequential || 0)
      : 0;
  return activeCharacter > 0 ? activeCharacter : 0;
}

function buildPaletteAttributesPayload(palette) {
  const payload = {
    main_color: {
      red: Number(palette.mainColor.red || 0),
      green: Number(palette.mainColor.green || 0),
      blue: Number(palette.mainColor.blue || 0),
    },
  };
  if (palette.secondaryColor) {
    payload.secondary_color = {
      red: Number(palette.secondaryColor.red || 0),
      green: Number(palette.secondaryColor.green || 0),
      blue: Number(palette.secondaryColor.blue || 0),
    };
  } else {
    payload.no_secondary_color = true;
  }
  if (palette.tertiaryColor) {
    payload.tertiary_color = {
      red: Number(palette.tertiaryColor.red || 0),
      green: Number(palette.tertiaryColor.green || 0),
      blue: Number(palette.tertiaryColor.blue || 0),
    };
  } else {
    payload.no_tertiary_color = true;
  }
  return payload;
}

function encodePayload(messageType, payload) {
  return Buffer.from(messageType.encode(messageType.create(payload)).finish());
}

function createCorpColorsGatewayService({ protoRoot, emptyPayload }) {
  const GetRequest = protoRoot.lookupType(
    "eve_public.cosmetic.corporation.palette.api.GetRequest",
  );
  const GetResponse = protoRoot.lookupType(
    "eve_public.cosmetic.corporation.palette.api.GetResponse",
  );
  const GetOwnResponse = protoRoot.lookupType(
    "eve_public.cosmetic.corporation.palette.api.GetOwnResponse",
  );
  const SetRequest = protoRoot.lookupType(
    "eve_public.cosmetic.corporation.palette.api.SetRequest",
  );
  const SetResponseTypeName =
    "eve_public.cosmetic.corporation.palette.api.SetResponse";
  const CanEditResponse = protoRoot.lookupType(
    "eve_public.cosmetic.corporation.palette.api.CanEditResponse",
  );

  return {
    name: "corporation-colors",
    handledRequestTypes: HANDLED_REQUEST_TYPES,
    handleRequest(requestTypeName, requestEnvelope) {
      if (!HANDLED_REQUEST_TYPES.includes(requestTypeName)) {
        return null;
      }

      const activeCharacterID = getActiveCharacterID(requestEnvelope);

      if (requestTypeName === "eve_public.cosmetic.corporation.palette.api.GetRequest") {
        const decoded = GetRequest.decode(
          Buffer.from(requestEnvelope.payload && requestEnvelope.payload.value),
        );
        const corporationID = Number(
          decoded &&
            decoded.identifier &&
            decoded.identifier.corporation &&
            decoded.identifier.corporation.sequential,
        ) || 0;
        const palette = getCorporationColorPalette(corporationID);
        if (!palette) {
          return {
            statusCode: 404,
            statusMessage: "",
            responseTypeName: "eve_public.cosmetic.corporation.palette.api.GetResponse",
            responsePayloadBuffer: emptyPayload,
          };
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.cosmetic.corporation.palette.api.GetResponse",
          responsePayloadBuffer: encodePayload(GetResponse, {
            attributes: buildPaletteAttributesPayload(palette),
          }),
        };
      }

      if (requestTypeName === "eve_public.cosmetic.corporation.palette.api.GetOwnRequest") {
        const corporationID = getCorporationIDForCharacter(activeCharacterID);
        const palette = getCorporationColorPalette(corporationID);
        if (!palette) {
          return {
            statusCode: 404,
            statusMessage: "",
            responseTypeName: "eve_public.cosmetic.corporation.palette.api.GetOwnResponse",
            responsePayloadBuffer: emptyPayload,
          };
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.cosmetic.corporation.palette.api.GetOwnResponse",
          responsePayloadBuffer: encodePayload(GetOwnResponse, {
            attributes: buildPaletteAttributesPayload(palette),
            last_modifier: {
              sequential: Number(palette.lastModifierCharacterID || activeCharacterID || 0),
            },
            last_modified: filetimeToTimestamp(palette.lastModified),
          }),
        };
      }

      if (requestTypeName === "eve_public.cosmetic.corporation.palette.api.SetRequest") {
        const corporationID = getCorporationIDForCharacter(activeCharacterID);
        if (!canCharacterEditCorporationColorPalette(activeCharacterID, corporationID)) {
          return {
            statusCode: 403,
            statusMessage: "",
            responseTypeName: SetResponseTypeName,
            responsePayloadBuffer: emptyPayload,
          };
        }
        const decoded = SetRequest.decode(
          Buffer.from(requestEnvelope.payload && requestEnvelope.payload.value),
        );
        setCorporationColorPalette(corporationID, decoded && decoded.attributes, activeCharacterID);
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: SetResponseTypeName,
          responsePayloadBuffer: emptyPayload,
        };
      }

      return {
        statusCode: 200,
        statusMessage: "",
        responseTypeName: "eve_public.cosmetic.corporation.palette.api.CanEditResponse",
        responsePayloadBuffer: encodePayload(CanEditResponse, {
          can_edit: canCharacterEditCorporationColorPalette(activeCharacterID),
        }),
      };
    },
  };
}

module.exports = {
  createCorpColorsGatewayService,
};
