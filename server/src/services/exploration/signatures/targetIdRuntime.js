function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

const SIGNATURE_CODE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function hashTargetSeed(seed) {
  let state = 0;
  const normalizedSeed = String(seed || "");
  for (let index = 0; index < normalizedSeed.length; index += 1) {
    state = ((state * 31) + normalizedSeed.charCodeAt(index)) >>> 0;
  }
  return state >>> 0;
}

function encodeSignatureCodeFromNumber(rawValue) {
  const normalizedValue = Math.max(0, toInt(rawValue, 0));
  const letterSpan = SIGNATURE_CODE_LETTERS.length ** 3;
  const numericValue = normalizedValue % (letterSpan * 1000);
  const letterValue = Math.floor(numericValue / 1000) % letterSpan;
  const numberValue = numericValue % 1000;

  let remainingLetterValue = letterValue;
  const letters = [];
  for (let index = 0; index < 3; index += 1) {
    letters.unshift(
      SIGNATURE_CODE_LETTERS[
        remainingLetterValue % SIGNATURE_CODE_LETTERS.length
      ],
    );
    remainingLetterValue = Math.floor(
      remainingLetterValue / SIGNATURE_CODE_LETTERS.length,
    );
  }

  return `${letters.join("")}-${String(numberValue).padStart(3, "0")}`;
}

function encodeTargetIDFromSeed(seed) {
  return encodeSignatureCodeFromNumber(hashTargetSeed(seed));
}

function buildTargetSeed(family, systemID, seedID) {
  const normalizedFamily = String(family || "site").trim().toLowerCase() || "site";
  return `${normalizedFamily}:${toInt(systemID, 0)}:${toInt(seedID, 0)}`;
}

function encodeTargetID(family, systemID, seedID) {
  return encodeTargetIDFromSeed(buildTargetSeed(family, systemID, seedID));
}

module.exports = {
  buildTargetSeed,
  encodeSignatureCodeFromNumber,
  encodeTargetID,
  encodeTargetIDFromSeed,
  hashTargetSeed,
};
