const path = require("path");

const database = require(path.join(__dirname, "../../../newDatabase"));

const authorityResult = database.read("capitalNpcAuthority", "/");
const authorityRoot = authorityResult.success ? authorityResult.data : {};

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }
  return Object.freeze(value);
}

const CAPITAL_NPC_AUTHORITY = deepFreeze(
  Array.isArray(authorityRoot && authorityRoot.entries)
    ? authorityRoot.entries
    : [],
);

const FACTION_META = deepFreeze(
  Object.fromEntries(
    CAPITAL_NPC_AUTHORITY
      .map((entry) => entry && entry.faction)
      .filter((entry) => entry && String(entry.id || "").trim().length > 0)
      .map((entry) => [entry.id, entry]),
  ),
);

const CAPITAL_NPC_AUTHORITY_SOURCE = deepFreeze(
  authorityRoot && authorityRoot.source && typeof authorityRoot.source === "object"
    ? authorityRoot.source
    : {},
);

const CAPITAL_NPC_MANIFESTS_BY_PROFILE_ID = deepFreeze(
  authorityRoot &&
    authorityRoot.manifestsByProfileID &&
    typeof authorityRoot.manifestsByProfileID === "object"
    ? authorityRoot.manifestsByProfileID
    : {},
);

module.exports = {
  FACTION_META,
  CAPITAL_NPC_AUTHORITY,
  CAPITAL_NPC_AUTHORITY_SOURCE,
  CAPITAL_NPC_MANIFESTS_BY_PROFILE_ID,
};
