const {
  CAPITAL_NPC_AUTHORITY,
  CAPITAL_NPC_MANIFESTS_BY_PROFILE_ID,
} = require("./capitalNpcAuthority");
const path = require("path");

const {
  resolveItemByTypeID,
  resolveItemByName,
} = require(path.join(__dirname, "../../../services/inventory/itemTypeRegistry"));

const FACTION_WRECK_NAME_ALIASES = Object.freeze([
  {
    matchers: ["blood raider", "dark blood", "blood"],
    labels: ["Blood", "Blood Raider"],
  },
  {
    matchers: ["shadow serpentis", "serpentis"],
    labels: ["Serpentis"],
  },
  {
    matchers: ["dread guristas", "guristas"],
    labels: ["Guristas"],
  },
  {
    matchers: ["angel cartel", "domination", "angel"],
    labels: ["Angel"],
  },
  {
    matchers: ["true sansha", "sansha's nation", "sansha", "sanshas"],
    labels: ["Sansha", "Sanshas"],
  },
  {
    matchers: ["rogue drone", "rogue", "infested", "sentient infested"],
    labels: ["Rogue"],
  },
]);

let cachedCapitalNpcWreckIndex = null;

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function resolveWreckFromManifest(manifest) {
  const wreck = manifest && manifest.wreck && typeof manifest.wreck === "object"
    ? manifest.wreck
    : null;
  return wreck && toPositiveInt(wreck.typeID, 0) > 0
    ? wreck
    : null;
}

function resolveCapitalHullClass(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  if (normalized.includes("dread")) {
    return "Dreadnought";
  }
  if (normalized.includes("supercarrier")) {
    return "Supercarrier";
  }
  if (normalized.includes("carrier")) {
    return "Carrier";
  }
  if (normalized.includes("titan")) {
    return "Titan";
  }
  return null;
}

function resolveFactionWreckLabels(...values) {
  const haystack = values
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(" ");
  if (!haystack) {
    return [];
  }

  for (const entry of FACTION_WRECK_NAME_ALIASES) {
    if (entry.matchers.some((matcher) => haystack.includes(normalizeText(matcher)))) {
      return entry.labels;
    }
  }
  return [];
}

function buildCapitalNpcWreckIndex() {
  if (cachedCapitalNpcWreckIndex) {
    return cachedCapitalNpcWreckIndex;
  }

  const byProfileID = new Map();
  const byShipTypeID = new Map();

  for (const authorityEntry of CAPITAL_NPC_AUTHORITY) {
    const profileID = String(authorityEntry && authorityEntry.profileID || "").trim();
    const shipTypeID = toPositiveInt(authorityEntry && authorityEntry.shipTypeID, 0);
    const manifest = CAPITAL_NPC_MANIFESTS_BY_PROFILE_ID[profileID] || authorityEntry || null;
    const wreck = resolveWreckFromManifest(manifest);
    if (!wreck) {
      continue;
    }
    if (profileID) {
      byProfileID.set(profileID, wreck);
    }
    if (shipTypeID > 0 && !byShipTypeID.has(shipTypeID)) {
      byShipTypeID.set(shipTypeID, wreck);
    }
  }

  cachedCapitalNpcWreckIndex = {
    byProfileID,
    byShipTypeID,
  };
  return cachedCapitalNpcWreckIndex;
}

function resolveCapitalNpcWreckType(input, shipTypeID = null) {
  const lookup = typeof input === "object" && input !== null
    ? input
    : {
      profileID: input,
      shipTypeID,
    };
  const normalizedProfileID = String(lookup && lookup.profileID || "").trim();
  const normalizedShipTypeID = toPositiveInt(
    lookup && lookup.shipTypeID,
    toPositiveInt(shipTypeID, 0),
  );
  const index = buildCapitalNpcWreckIndex();
  const itemMeta = normalizedShipTypeID > 0
    ? resolveItemByTypeID(normalizedShipTypeID) || null
    : null;

  if (normalizedProfileID && index.byProfileID.has(normalizedProfileID)) {
    return index.byProfileID.get(normalizedProfileID) || null;
  }

  if (normalizedShipTypeID > 0 && index.byShipTypeID.has(normalizedShipTypeID)) {
    return index.byShipTypeID.get(normalizedShipTypeID) || null;
  }

  const hullClass = (
    resolveCapitalHullClass(lookup && lookup.classID) ||
    resolveCapitalHullClass(lookup && lookup.groupName) ||
    resolveCapitalHullClass(lookup && lookup.itemName) ||
    resolveCapitalHullClass(itemMeta && itemMeta.groupName) ||
    resolveCapitalHullClass(itemMeta && itemMeta.name)
  );
  const factionLabels = resolveFactionWreckLabels(
    lookup && lookup.factionName,
    lookup && lookup.groupName,
    lookup && lookup.itemName,
    itemMeta && itemMeta.groupName,
    itemMeta && itemMeta.name,
    normalizedProfileID,
  );

  if (!hullClass || factionLabels.length <= 0) {
    return null;
  }

  for (const label of factionLabels) {
    const candidate = `${label} ${hullClass} Wreck`;
    const lookupResult = resolveItemByName(candidate);
    if (
      lookupResult &&
      lookupResult.success &&
      lookupResult.match &&
      String(lookupResult.match.groupName || "").trim().toLowerCase() === "wreck"
    ) {
      return lookupResult.match;
    }
  }

  return null;
}

module.exports = {
  resolveCapitalNpcWreckType,
};
