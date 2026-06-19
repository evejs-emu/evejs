const path = require("path");

const {
  encodePayload,
} = require(path.join(
  __dirname,
  "../../_secondary/express/gatewayServices/gatewayServiceHelpers",
));
const {
  buildEvermarksGatewayProtoRoot,
} = require("./evermarksGatewayProto");
const {
  SHIP_LOGO_ENTITLEMENT_ALLIANCE,
  SHIP_LOGO_ENTITLEMENT_CORPORATION,
} = require("./evermarksConstants");

const PROTO_ROOT = buildEvermarksGatewayProtoRoot();
const CorpGrantedNotice = PROTO_ROOT.lookupType(
  "eve_public.entitlement.character.ship.corplogo.GrantedNotice",
);
const CorpRevokedNotice = PROTO_ROOT.lookupType(
  "eve_public.entitlement.character.ship.corplogo.RevokedNotice",
);
const AllianceGrantedNotice = PROTO_ROOT.lookupType(
  "eve_public.entitlement.character.ship.alliancelogo.GrantedNotice",
);
const AllianceRevokedNotice = PROTO_ROOT.lookupType(
  "eve_public.entitlement.character.ship.alliancelogo.RevokedNotice",
);

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
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

function buildEntitlementIdentifier(entitlement = {}) {
  return {
    character: buildCharacterIdentifier(entitlement.characterID),
    ship_type: buildShipTypeIdentifier(entitlement.shipTypeID),
  };
}

function resolvePublisher(publishGatewayNotice) {
  if (typeof publishGatewayNotice === "function") {
    return publishGatewayNotice;
  }

  try {
    const publicGatewayLocal = require(path.join(
      __dirname,
      "../../_secondary/express/publicGatewayLocal",
    ));
    return typeof publicGatewayLocal.publishGatewayNotice === "function"
      ? publicGatewayLocal.publishGatewayNotice
      : null;
  } catch (_error) {
    return null;
  }
}

function publishNotice(noticeTypeName, messageType, payload, targetCharacterID, options = {}) {
  const publisher = resolvePublisher(options.publishGatewayNotice);
  const numericTargetCharacterID = normalizePositiveInteger(targetCharacterID, 0);
  if (!publisher || !numericTargetCharacterID) {
    return false;
  }

  publisher(
    noticeTypeName,
    encodePayload(messageType, payload),
    {
      character: numericTargetCharacterID,
    },
  );
  return true;
}

function publishShipLogoGrantedNotice(entitlement, options = {}) {
  const identifier = buildEntitlementIdentifier(entitlement);
  const entitlementType = normalizePositiveInteger(
    entitlement && entitlement.entitlementType,
    0,
  );

  if (entitlementType === SHIP_LOGO_ENTITLEMENT_CORPORATION) {
    return publishNotice(
      "eve_public.entitlement.character.ship.corplogo.GrantedNotice",
      CorpGrantedNotice,
      {
        entitlement: identifier,
      },
      entitlement && entitlement.characterID,
      options,
    );
  }

  if (entitlementType === SHIP_LOGO_ENTITLEMENT_ALLIANCE) {
    return publishNotice(
      "eve_public.entitlement.character.ship.alliancelogo.GrantedNotice",
      AllianceGrantedNotice,
      {
        entitlement: identifier,
      },
      entitlement && entitlement.characterID,
      options,
    );
  }

  return false;
}

function publishShipLogoRevokedNotice(entitlement, revokerCharacterID, options = {}) {
  const identifier = buildEntitlementIdentifier(entitlement);
  const entitlementType = normalizePositiveInteger(
    entitlement && entitlement.entitlementType,
    0,
  );
  const numericRevokerCharacterID = normalizePositiveInteger(
    revokerCharacterID,
    normalizePositiveInteger(entitlement && entitlement.characterID, 0),
  );

  if (entitlementType === SHIP_LOGO_ENTITLEMENT_CORPORATION) {
    return publishNotice(
      "eve_public.entitlement.character.ship.corplogo.RevokedNotice",
      CorpRevokedNotice,
      {
        revoker: buildCharacterIdentifier(numericRevokerCharacterID),
        entitlement: identifier,
      },
      entitlement && entitlement.characterID,
      options,
    );
  }

  if (entitlementType === SHIP_LOGO_ENTITLEMENT_ALLIANCE) {
    return publishNotice(
      "eve_public.entitlement.character.ship.alliancelogo.RevokedNotice",
      AllianceRevokedNotice,
      {
        revoker: buildCharacterIdentifier(numericRevokerCharacterID),
        entitlement: identifier,
      },
      entitlement && entitlement.characterID,
      options,
    );
  }

  return false;
}

module.exports = {
  buildEntitlementIdentifier,
  buildShipTypeIdentifier,
  publishShipLogoGrantedNotice,
  publishShipLogoRevokedNotice,
};
