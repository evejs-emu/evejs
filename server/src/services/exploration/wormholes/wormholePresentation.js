function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveInfoWindowClassLabel(classID) {
  const numericClassID = toInt(classID, 0);
  const labels = {
    0: "Unknown Space",
    1: "Unknown Space",
    2: "Unknown Space",
    3: "Unknown Space",
    4: "Dangerous Unknown Space",
    5: "Dangerous Unknown Space",
    6: "Deadly Unknown Space",
    7: "High Security Space",
    8: "Low Security Space",
    9: "Null Security Space",
    12: "Thera",
    13: "Shattered Space",
    14: "Drifter Space",
    15: "Drifter Space",
    16: "Drifter Space",
    17: "Drifter Space",
    18: "Drifter Space",
    25: "Triglavian Space",
  };
  return labels[numericClassID] || `Class ${numericClassID || 0}`;
}

function resolveJumpClassLabel(classID) {
  const numericClassID = toInt(classID, 0);
  const labels = {
    0: "Space",
    1: "Unknown Space",
    2: "Unknown Space",
    3: "Unknown Space",
    4: "Unknown Space",
    5: "Deep Unknown Space",
    6: "Deep Unknown Space",
    7: "High Security Space",
    8: "Low Security Space",
    9: "Null Security Space",
    12: "Deep Unknown Space",
    13: "Unknown Space",
    25: "Triglavian Space",
  };
  return labels[numericClassID] || resolveInfoWindowClassLabel(numericClassID);
}

function resolveAgeLabel(ageState) {
  const numericAgeState = toInt(ageState, 0);
  if (numericAgeState >= 4) {
    return "Lingering";
  }
  if (numericAgeState >= 3) {
    return "Less Than 1 Hour Remaining";
  }
  if (numericAgeState >= 2) {
    return "Less Than 4 Hours Remaining";
  }
  if (numericAgeState >= 1) {
    return "Less Than 1 Day Remaining";
  }
  return "More Than 1 Day Remaining";
}

function resolveStabilityLabel(sizeRatio) {
  const numericSizeRatio = toFiniteNumber(sizeRatio, 1);
  if (numericSizeRatio < 0.5) {
    return "Stability Critically Disrupted";
  }
  if (numericSizeRatio < 1) {
    return "Stability Reduced";
  }
  return "Stability Not Disrupted";
}

function resolveShipMassLabel(maxShipJumpMass) {
  switch (toInt(maxShipJumpMass, 0)) {
    case 1:
      return "Only The Smallest Ships Can Enter";
    case 2:
      return "Up To Medium Ships Can Enter";
    case 3:
      return "Larger Ships Can Enter";
    case 4:
      return "Very Large Ships Can Enter";
    default:
      return "Unknown Ship Restriction";
  }
}

function buildWormholePresentationSnapshot({
  otherSolarSystemClass = 0,
  wormholeAge = 0,
  wormholeSize = 1,
  maxShipJumpMass = 0,
} = {}) {
  const numericClassID = toInt(otherSolarSystemClass, 0);
  const numericAgeState = toInt(wormholeAge, 0);
  const numericSizeRatio = toFiniteNumber(wormholeSize, 1);
  const numericShipMass = toInt(maxShipJumpMass, 0);
  return {
    classID: numericClassID,
    classLabel: resolveInfoWindowClassLabel(numericClassID),
    jumpClassLabel: resolveJumpClassLabel(numericClassID),
    ageState: numericAgeState,
    ageLabel: resolveAgeLabel(numericAgeState),
    sizeRatio: numericSizeRatio,
    stabilityLabel: resolveStabilityLabel(numericSizeRatio),
    maxShipJumpMass: numericShipMass,
    shipMassLabel: resolveShipMassLabel(numericShipMass),
  };
}

module.exports = {
  buildWormholePresentationSnapshot,
  resolveAgeLabel,
  resolveInfoWindowClassLabel,
  resolveJumpClassLabel,
  resolveShipMassLabel,
  resolveStabilityLabel,
};
