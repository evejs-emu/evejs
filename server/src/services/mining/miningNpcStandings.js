const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const standingRuntime = require(path.join(
  __dirname,
  "../character/standingRuntime",
));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function dedupePositiveIntegers(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((value) => toInt(value, 0))
      .filter((value) => value > 0),
  )];
}

function resolveEntityCharacterID(entity) {
  return toInt(
    entity &&
      entity.session &&
      entity.session.characterID
      ? entity.session.characterID
      : entity && (
        entity.characterID ??
        entity.pilotCharacterID
      ),
    0,
  );
}

function resolveEntityOwnerIDs(entity) {
  return dedupePositiveIntegers([
    entity && entity.ownerID,
    entity && entity.corporationID,
    entity && entity.factionID,
    entity && entity.warFactionID,
    entity && entity.allianceID,
  ]);
}

function resolveStandingValue(characterID, targetOwnerIDs = []) {
  const normalizedCharacterID = toInt(characterID, 0);
  const normalizedTargetOwnerIDs = dedupePositiveIntegers(targetOwnerIDs);
  if (normalizedCharacterID <= 0 || normalizedTargetOwnerIDs.length <= 0) {
    return {
      characterID: normalizedCharacterID,
      standing: 0,
      matchedOwnerID: 0,
      matchedSourceID: 0,
      matchedEntry: null,
    };
  }

  const standingMatch = standingRuntime.resolveBestStandingValue(
    normalizedCharacterID,
    normalizedTargetOwnerIDs,
  );
  return {
    characterID: normalizedCharacterID,
    standing: toFiniteNumber(standingMatch && standingMatch.standing, 0),
    matchedOwnerID: toInt(standingMatch && standingMatch.matchedOwnerID, 0),
    matchedSourceID: toInt(standingMatch && standingMatch.matchedSourceID, 0),
    matchedEntry:
      standingMatch && standingMatch.matchedEntry
        ? {
            fromID: toInt(standingMatch.matchedEntry.fromID, 0),
            toID: toInt(standingMatch.matchedEntry.toID, 0),
            standing: toFiniteNumber(standingMatch.matchedEntry.standing, 0),
          }
        : null,
  };
}

function hasGenericNpcThresholds(hostileResponseThreshold, friendlyResponseThreshold) {
  return (
    hostileResponseThreshold === 11 &&
    friendlyResponseThreshold === 11
  );
}

function resolveStandingThresholdsForEntity(entity) {
  const hostileResponseThreshold = toFiniteNumber(
    entity && entity.hostileResponseThreshold,
    NaN,
  );
  const friendlyResponseThreshold = toFiniteNumber(
    entity && entity.friendlyResponseThreshold,
    NaN,
  );

  if (
    Number.isFinite(hostileResponseThreshold) &&
    Number.isFinite(friendlyResponseThreshold) &&
    !hasGenericNpcThresholds(hostileResponseThreshold, friendlyResponseThreshold)
  ) {
    return {
      hostileResponseThreshold,
      friendlyResponseThreshold,
      source: "entity",
    };
  }

  const configuredHostileThreshold = toFiniteNumber(
    config.miningNpcHostileStandingThreshold,
    -5,
  );
  const configuredFriendlyThreshold = Math.max(
    configuredHostileThreshold,
    toFiniteNumber(
      config.miningNpcFriendlyStandingThreshold,
      5,
    ),
  );
  return {
    hostileResponseThreshold: configuredHostileThreshold,
    friendlyResponseThreshold: configuredFriendlyThreshold,
    source: "config",
  };
}

function classifyStandingValue(standing, thresholds = {}) {
  const numericStanding = toFiniteNumber(standing, 0);
  if (numericStanding <= toFiniteNumber(thresholds.hostileResponseThreshold, -5)) {
    return "hostile";
  }
  if (numericStanding >= toFiniteNumber(thresholds.friendlyResponseThreshold, 5)) {
    return "friendly";
  }
  return "neutral";
}

function resolveAggressorStandingProfile(aggressorEntity, npcEntity) {
  const characterID = resolveEntityCharacterID(aggressorEntity);
  const ownerIDs = resolveEntityOwnerIDs(npcEntity);
  const thresholds = resolveStandingThresholdsForEntity(npcEntity);
  const standingResult = resolveStandingValue(characterID, ownerIDs);
  return {
    ...standingResult,
    ownerIDs,
    thresholds,
    standingClass: classifyStandingValue(standingResult.standing, thresholds),
  };
}

module.exports = {
  resolveEntityCharacterID,
  resolveEntityOwnerIDs,
  resolveStandingValue,
  resolveStandingThresholdsForEntity,
  classifyStandingValue,
  resolveAggressorStandingProfile,
};
