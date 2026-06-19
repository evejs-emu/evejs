function toNonNegativeBigInt(value, fallback = 0n) {
  try {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }
    const normalized = BigInt(String(value));
    return normalized >= 0n ? normalized : fallback;
  } catch (error) {
    return fallback;
  }
}

function nextPowerOfTwo(value) {
  let candidate = 1n;
  const minimum = toNonNegativeBigInt(value, 1n);
  while (candidate < minimum) {
    candidate <<= 1n;
  }
  return candidate;
}

function toStoredMaskValue(value) {
  return Number(toNonNegativeBigInt(value, 0n));
}

function allocateNextLabelID(labels = {}, nextLabelIDHint = 1) {
  const usedIDs = new Set(
    Object.keys(labels || {}).map((labelID) => toNonNegativeBigInt(labelID, 0n).toString()),
  );
  let labelID = nextPowerOfTwo(nextLabelIDHint);
  while (usedIDs.has(labelID.toString())) {
    labelID <<= 1n;
  }
  return {
    labelID: toStoredMaskValue(labelID),
    nextLabelID: toStoredMaskValue(labelID << 1n),
  };
}

function addLabelMask(currentMask, labelMask) {
  return toStoredMaskValue(
    toNonNegativeBigInt(currentMask, 0n) | toNonNegativeBigInt(labelMask, 0n),
  );
}

function removeLabelMask(currentMask, labelMask) {
  return toStoredMaskValue(
    toNonNegativeBigInt(currentMask, 0n) & ~toNonNegativeBigInt(labelMask, 0n),
  );
}

module.exports = {
  addLabelMask,
  allocateNextLabelID,
  removeLabelMask,
};
