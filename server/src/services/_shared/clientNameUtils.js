function collapseWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isClientSafeAscii(value) {
  return /^[\x20-\x7E]+$/.test(String(value || ""));
}

function toClientSafeDisplayName(value, fallback = "Item") {
  const rawName = collapseWhitespace(value);
  if (rawName && isClientSafeAscii(rawName)) {
    return rawName;
  }

  let asciiFragment = rawName;
  if (asciiFragment && typeof asciiFragment.normalize === "function") {
    asciiFragment = asciiFragment.normalize("NFKD");
  }
  asciiFragment = collapseWhitespace(asciiFragment.replace(/[^\x20-\x7E]+/g, " "));

  const safeFallback = collapseWhitespace(fallback) || "Item";
  if (asciiFragment) {
    if (!safeFallback) {
      return asciiFragment;
    }
    if (safeFallback.includes(asciiFragment)) {
      return safeFallback;
    }
    return `${safeFallback} ${asciiFragment}`.trim();
  }

  return safeFallback;
}

module.exports = {
  collapseWhitespace,
  isClientSafeAscii,
  toClientSafeDisplayName,
};
