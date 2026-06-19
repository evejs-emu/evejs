const path = require("path");

const {
  resolveItemByTypeID,
  resolveItemByName,
} = require(path.join(__dirname, "../../services/inventory/itemTypeRegistry"));

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function inferNpcEntityType(profile) {
  return String(profile && profile.entityType || "").trim().toLowerCase() === "concord"
    ? "concord"
    : "npc";
}

function resolveNpcStandingThresholds(profile = {}) {
  const explicitHostileThreshold = Number(
    profile.hostileResponseThreshold ?? profile.hostile_response_threshold,
  );
  const explicitFriendlyThreshold = Number(
    profile.friendlyResponseThreshold ?? profile.friendly_response_threshold,
  );

  if (
    Number.isFinite(explicitHostileThreshold) &&
    Number.isFinite(explicitFriendlyThreshold)
  ) {
    return {
      hostileResponseThreshold: explicitHostileThreshold,
      friendlyResponseThreshold: explicitFriendlyThreshold,
    };
  }

  const entityType = inferNpcEntityType(profile);
  if (entityType === "concord") {
    return {
      hostileResponseThreshold: -11,
      friendlyResponseThreshold: 11,
    };
  }

  return {
    hostileResponseThreshold: 11,
    friendlyResponseThreshold: 11,
  };
}

function buildNpcSlimPresentation(definition, shipLike = {}) {
  const profile = definition && definition.profile
    ? definition.profile
    : {};
  const fallbackTypeID = toPositiveInt(shipLike && shipLike.typeID, 0);
  const fallbackGroupID = toPositiveInt(shipLike && shipLike.groupID, 0);
  const fallbackCategoryID = toPositiveInt(shipLike && shipLike.categoryID, 0);
  const fallbackName = String(
    profile.presentationName ||
      profile.name ||
      (shipLike && shipLike.itemName) ||
      "NPC",
  );
  const presentationTypeID = toPositiveInt(profile.presentationTypeID, 0);
  const presentationType = presentationTypeID > 0
    ? resolveItemByTypeID(presentationTypeID)
    : null;

  return {
    slimTypeID: presentationType
      ? toPositiveInt(presentationType.typeID, fallbackTypeID)
      : fallbackTypeID,
    slimGroupID: presentationType
      ? toPositiveInt(presentationType.groupID, fallbackGroupID)
      : fallbackGroupID,
    slimCategoryID: presentationType
      ? toPositiveInt(presentationType.categoryID, fallbackCategoryID)
      : fallbackCategoryID,
    slimName: String(
      profile.presentationName ||
        (presentationType && presentationType.name) ||
        fallbackName,
    ),
  };
}

function resolveShipPresentationRadius(entry, fallback = 0) {
  return Math.max(
    0,
    toFiniteNumber(
      entry && entry.radius,
      fallback,
    ),
  );
}

function normalizeNpcHullRadiusFallbackName(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  return trimmed
    .replace(/\s+blueprint$/i, "")
    .replace(/\s+blood raiders edition$/i, "")
    .replace(/\s+guristas edition$/i, "")
    .replace(/\s+angel cartel edition$/i, "")
    .replace(/\s+serpentis edition$/i, "")
    .replace(/\s+sansha(?:'s nation)? edition$/i, "")
    .replace(/\s+mordu'?s legion(?: command)? edition$/i, "")
    .replace(/\s+edition$/i, "")
    .trim();
}

function resolveNpcEntityRadius(shipType, presentationType, slimPresentation, profile = {}, shipLike = {}) {
  const directRadius = resolveShipPresentationRadius(
    shipType,
    resolveShipPresentationRadius(
      presentationType,
      toFiniteNumber(shipLike && shipLike.radius, 0),
    ),
  );
  if (directRadius > 0) {
    return directRadius;
  }

  const fallbackNames = [
    shipType && shipType.name,
    presentationType && presentationType.name,
    slimPresentation && slimPresentation.slimName,
    profile.presentationName,
    profile.name,
    shipLike && shipLike.itemName,
  ]
    .map((entry) => normalizeNpcHullRadiusFallbackName(entry))
    .filter(Boolean);

  for (const candidate of fallbackNames) {
    const lookup = resolveItemByName(candidate);
    if (!lookup || lookup.success !== true || !lookup.match) {
      continue;
    }

    const candidateRadius = resolveShipPresentationRadius(lookup.match, 0);
    if (candidateRadius > 0) {
      return candidateRadius;
    }
  }

  return Math.max(1, toFiniteNumber(shipLike && shipLike.radius, 1));
}

function buildNpcEntityIdentity(definition, shipLike = {}) {
  const profile = definition && definition.profile
    ? definition.profile
    : {};
  const shipType = resolveItemByTypeID(
    toPositiveInt(profile.shipTypeID, toPositiveInt(shipLike && shipLike.typeID, 0)),
  );
  const slimPresentation = buildNpcSlimPresentation(definition, shipLike);
  const standingThresholds = resolveNpcStandingThresholds(profile);

  return {
    typeID: toPositiveInt(
      profile.shipTypeID,
      toPositiveInt(shipType && shipType.typeID, toPositiveInt(shipLike && shipLike.typeID, 0)),
    ),
    groupID: toPositiveInt(
      shipType && shipType.groupID,
      toPositiveInt(shipLike && shipLike.groupID, 0),
    ),
    categoryID: toPositiveInt(
      shipType && shipType.categoryID,
      toPositiveInt(shipLike && shipLike.categoryID, 0),
    ),
    radius: resolveNpcEntityRadius(
      shipType,
      toPositiveInt(profile.presentationTypeID, 0) > 0
        ? resolveItemByTypeID(toPositiveInt(profile.presentationTypeID, 0))
        : null,
      slimPresentation,
      profile,
      shipLike,
    ),
    slimTypeID: slimPresentation.slimTypeID,
    slimGroupID: slimPresentation.slimGroupID,
    slimCategoryID: slimPresentation.slimCategoryID,
    slimName: slimPresentation.slimName,
    ownerID: toPositiveInt(profile.corporationID, 0),
    corporationID: toPositiveInt(profile.corporationID, 0),
    allianceID: toPositiveInt(profile.allianceID, 0),
    warFactionID: toPositiveInt(profile.factionID, 0),
    securityStatus: toFiniteNumber(profile.securityStatus, 0),
    bounty: toFiniteNumber(profile.bounty, 0),
    npcEntityType: inferNpcEntityType(profile),
    hostileResponseThreshold: toFiniteNumber(
      standingThresholds.hostileResponseThreshold,
      -11,
    ),
    friendlyResponseThreshold: toFiniteNumber(
      standingThresholds.friendlyResponseThreshold,
      -11,
    ),
  };
}

module.exports = {
  inferNpcEntityType,
  resolveNpcStandingThresholds,
  buildNpcSlimPresentation,
  buildNpcEntityIdentity,
};
