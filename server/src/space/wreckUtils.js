const path = require("path");

const {
  resolveShipByTypeID,
} = require(path.join(__dirname, "../services/chat/shipTypeRegistry"));
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require(path.join(__dirname, "../services/inventory/itemTypeRegistry"));

const RACE_WRECK_PREFIX_BY_ID = Object.freeze({
  1: "Caldari",
  2: "Minmatar",
  4: "Amarr",
  8: "Gallente",
  32: "Jove",
  64: "CONCORD",
  128: "ORE",
  256: "Triglavian",
  512: "EDENCOM",
});
const SPECIAL_WRECK_CANDIDATE_PREFIX_BY_RACE_AND_HULL = Object.freeze({
  "135:Dreadnought": "Triglavian",
  "135:Battleship": "Triglavian",
  "135:Battlecruiser": "Triglavian",
  "135:Cruiser": "Triglavian",
  "135:Destroyer": "Triglavian",
  "135:Frigate": "Triglavian",
  "168:Battleship": "EDENCOM",
  "168:Cruiser": "EDENCOM",
  "168:Frigate": "EDENCOM",
  "168:Freighter": "Upwell",
  "168:Hauler": "Upwell",
});
const SPECIAL_WRECK_NAME_BY_SHIP_NAME = Object.freeze({
  Sarathiel: "Angel Dreadnought Wreck",
  Azariel: "Angel Titan Wreck",
  Molok: "Blood Titan Wreck",
  Chemosh: "Blood Dreadnought Wreck",
  Caiman: "Guristas Dreadnought Wreck",
  Vanquisher: "Serpentis Titan Wreck",
  Komodo: "Guristas Titan Wreck",
  Vehement: "Serpentis Dreadnought Wreck",
  Vendetta: "Serpentis Supercarrier Wreck",
});
const SPECIAL_WRECK_TYPE_ID_BY_SHIP_TYPE_ID = Object.freeze({
  34495: 34768, // Drifter Battleship -> Drifter Battleship Wreck
  47153: 47560, // Drifter Cruiser -> Drifter Cruiser Wreck
  47722: 47560, // Drifter Strike Cruiser -> Drifter Cruiser Wreck
  47724: 34768, // Drifter Strike Commander -> Drifter Battleship Wreck
  37473: 37531, // Drifter Response Battleship -> Drifter Response Battleship Wreck
  86498: 37531, // Drifter Recon Battleship -> Drifter Response Battleship Wreck
  47958: 47560, // Drifter Entanglement Cruiser -> Drifter Cruiser Wreck
  47959: 47560, // Drifter Nullwarp Cruiser -> Drifter Cruiser Wreck
  47960: 47560, // Drifter Nullcharge Cruiser -> Drifter Cruiser Wreck
  56217: 34768, // Drifter Polemarkos Battleship -> Drifter Battleship Wreck
  56219: 34768, // Drifter Raider Battleship -> Drifter Battleship Wreck
  56220: 47560, // Drifter Navarkos Cruiser -> Drifter Cruiser Wreck
  56221: 47560, // Drifter Assault Cruiser -> Drifter Cruiser Wreck
  56222: 47560, // Drifter Scout Cruiser -> Drifter Cruiser Wreck
  87612: 34768, // Ladon Tyrannos -> Drifter Battleship Wreck
  88153: 88275, // Drifter Hopilite -> Drifter Small Wreck
  88154: 88156, // Strategos Dreadnought -> Strategos Dreadnought Wreck
  88559: 34768, // Ladon Tyrannos variant -> Drifter Battleship Wreck
  88613: 88156, // Strategos Dreadnought variant -> Strategos Dreadnought Wreck
});
const SPECIAL_WRECK_TYPE_ID_BY_SHIP_NAME = Object.freeze({
  "drifter battleship": 34768,
  "drifter cruiser": 47560,
  "drifter strike cruiser": 47560,
  "drifter response battleship": 37531,
  "drifter recon battleship": 37531,
  "drifter entanglement cruiser": 47560,
  "drifter nullwarp cruiser": 47560,
  "drifter nullcharge cruiser": 47560,
  "drifter strike commander": 34768,
  "drifter polemarkos battleship": 34768,
  "drifter raider battleship": 34768,
  "drifter navarkos cruiser": 47560,
  "drifter assault cruiser": 47560,
  "drifter scout cruiser": 47560,
  "ladon tyrannos": 34768,
  "drifter hopilite": 88275,
  "strategos dreadnought": 88156,
});
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

function normalizeShipNameKey(value) {
  return String(value || "")
    .replace(/^[^A-Za-z0-9]+/, "")
    .trim();
}

function normalizeText(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function cloneVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(vector && vector.x, fallback.x),
    y: toFiniteNumber(vector && vector.y, fallback.y),
    z: toFiniteNumber(vector && vector.z, fallback.z),
  };
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = cloneVector(vector, fallback);
  const length = Math.sqrt(
    (resolved.x ** 2) + (resolved.y ** 2) + (resolved.z ** 2),
  );
  if (!Number.isFinite(length) || length <= 0) {
    return { ...fallback };
  }

  return {
    x: resolved.x / length,
    y: resolved.y / length,
    z: resolved.z / length,
  };
}

function buildDunRotationFromDirection(direction) {
  const forward = normalizeVector(direction, { x: 1, y: 0, z: 0 });
  const yawDegrees = Math.atan2(forward.x, forward.z) * (180 / Math.PI);
  const pitchDegrees = -Math.asin(Math.max(-1, Math.min(1, forward.y))) * (180 / Math.PI);
  return [yawDegrees, pitchDegrees, 0];
}

function resolveShipWreckRacePrefix(shipMeta = {}, itemMeta = {}) {
  const raceID = toPositiveInt(
    shipMeta.raceID !== undefined ? shipMeta.raceID : itemMeta.raceID,
    0,
  );
  return RACE_WRECK_PREFIX_BY_ID[raceID] || null;
}

function resolveShipHullClassName(shipMeta = {}, itemMeta = {}) {
  const groupName = String(
    shipMeta.groupName ||
    itemMeta.groupName ||
    "",
  ).trim().toLowerCase();
  if (!groupName) {
    return null;
  }
  if (groupName.includes("titan")) {
    return "Titan";
  }
  if (groupName.includes("supercarrier")) {
    return "Supercarrier";
  }
  if (groupName.includes("carrier")) {
    return "Carrier";
  }
  if (groupName.includes("dread")) {
    return "Dreadnought";
  }
  if (groupName.includes("jump freighter") || groupName.includes("freighter")) {
    return "Freighter";
  }
  if (groupName.includes("mining barge") || groupName.includes("barge") || groupName.includes("exhumer")) {
    return "Mining Barge";
  }
  if (groupName.includes("industrial") || groupName.includes("hauler") || groupName.includes("transport ship")) {
    return "Hauler";
  }
  if (groupName.includes("battleship") || groupName.includes("marauder") || groupName.includes("black ops")) {
    return "Battleship";
  }
  if (groupName.includes("battlecruiser") || groupName.includes("command ship")) {
    return "Battlecruiser";
  }
  if (groupName.includes("cruiser") || groupName.includes("heavy interdictor") || groupName.includes("strategic cruiser")) {
    return "Cruiser";
  }
  if (groupName.includes("destroyer") || groupName.includes("interdictor")) {
    return "Destroyer";
  }
  if (groupName.includes("shuttle")) {
    return "Shuttle";
  }
  if (groupName.includes("frigate") || groupName.includes("corvette")) {
    return "Frigate";
  }
  return null;
}

function resolveNpcHullWreckSize(hullClassName) {
  switch (String(hullClassName || "")) {
    case "Battleship":
      return "Large";
    case "Battlecruiser":
    case "Cruiser":
    case "Mining Barge":
    case "Hauler":
    case "Freighter":
      return "Medium";
    case "Destroyer":
    case "Frigate":
    case "Shuttle":
      return "Small";
    default:
      return null;
  }
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

function buildShipWreckCandidateNames(shipMeta = {}, itemMeta = {}) {
  const hullClassName = resolveShipHullClassName(shipMeta, itemMeta);
  const racePrefix = resolveShipWreckRacePrefix(shipMeta, itemMeta);
  const raceID = toPositiveInt(
    shipMeta.raceID !== undefined ? shipMeta.raceID : itemMeta.raceID,
    0,
  );
  const groupName = String(
    shipMeta.groupName ||
    itemMeta.groupName ||
    "",
  ).trim().toLowerCase();
  const candidates = [];
  const explicitWreckName = SPECIAL_WRECK_NAME_BY_SHIP_NAME[
    String(shipMeta.name || itemMeta.name || "").trim()
  ] || null;

  if (groupName.includes("capsule")) {
    candidates.push("Mysterious Capsule Wreck");
  }
  if (explicitWreckName) {
    candidates.push(explicitWreckName);
  }
  const specialPrefix = hullClassName
    ? SPECIAL_WRECK_CANDIDATE_PREFIX_BY_RACE_AND_HULL[`${raceID}:${hullClassName}`] || null
    : null;
  if (specialPrefix && hullClassName) {
    candidates.push(`${specialPrefix} ${hullClassName} Wreck`);
  }
  if (racePrefix && hullClassName) {
    candidates.push(`${racePrefix} ${hullClassName} Wreck`);
  }
  if (hullClassName) {
    candidates.push(`${hullClassName} Wreck`);
  }
  candidates.push("Wreck");
  return [...new Set(candidates)];
}

function resolveWreckLookupByCandidate(candidate) {
  const lookup = resolveItemByName(candidate);
  if (
    lookup &&
    lookup.success &&
    lookup.match &&
    String(lookup.match.groupName || "").trim().toLowerCase() === "wreck"
  ) {
    return lookup.match;
  }

  if (
    lookup &&
    lookup.errorMsg === "AMBIGUOUS_ITEM_NAME" &&
    Array.isArray(lookup.suggestions)
  ) {
    for (const suggestion of lookup.suggestions) {
      const typeIDMatch = /\((\d+)(?:,.*)?\)\s*$/.exec(String(suggestion || ""));
      const suggestedTypeID = typeIDMatch ? toPositiveInt(typeIDMatch[1], 0) : 0;
      if (!suggestedTypeID) {
        continue;
      }
      const suggested = resolveItemByTypeID(suggestedTypeID);
      if (
        suggested &&
        String(suggested.groupName || "").trim().toLowerCase() === "wreck" &&
        String(suggested.name || "").trim().toLowerCase() === String(candidate || "").trim().toLowerCase()
      ) {
        return suggested;
      }
    }
  }

  return null;
}

function resolveSpecialShipWreckType(shipMeta = {}, itemMeta = {}) {
  const explicitShipTypeID = toPositiveInt(
    shipMeta.typeID !== undefined ? shipMeta.typeID : itemMeta.typeID,
    0,
  );
  const directWreckTypeID = explicitShipTypeID
    ? toPositiveInt(SPECIAL_WRECK_TYPE_ID_BY_SHIP_TYPE_ID[explicitShipTypeID], 0)
    : 0;
  if (directWreckTypeID) {
    const directMatch = resolveItemByTypeID(directWreckTypeID);
    if (
      directMatch &&
      String(directMatch.groupName || "").trim().toLowerCase() === "wreck"
    ) {
      return directMatch;
    }
  }

  const normalizedNames = [
    shipMeta.name,
    itemMeta.name,
    shipMeta.typeName,
    itemMeta.typeName,
  ]
    .map((value) => normalizeShipNameKey(value))
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  for (const normalizedName of normalizedNames) {
    const directNamedWreckTypeID = toPositiveInt(
      SPECIAL_WRECK_TYPE_ID_BY_SHIP_NAME[normalizedName],
      0,
    );
    if (!directNamedWreckTypeID) {
      continue;
    }
    const directMatch = resolveItemByTypeID(directNamedWreckTypeID);
    if (
      directMatch &&
      String(directMatch.groupName || "").trim().toLowerCase() === "wreck"
    ) {
      return directMatch;
    }
  }

  const candidateNames = [
    shipMeta.name,
    itemMeta.name,
    shipMeta.typeName,
    itemMeta.typeName,
  ]
    .map((value) => normalizeShipNameKey(value))
    .filter(Boolean);

  for (const candidateName of candidateNames) {
    const wreckName = SPECIAL_WRECK_NAME_BY_SHIP_NAME[candidateName] || null;
    if (!wreckName) {
      continue;
    }
    const resolved = resolveWreckLookupByCandidate(wreckName);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function resolveExactNamedShipWreckType(shipMeta = {}, itemMeta = {}) {
  const candidateNames = [
    shipMeta.name,
    itemMeta.name,
    shipMeta.typeName,
    itemMeta.typeName,
  ]
    .map((value) => normalizeShipNameKey(value))
    .filter(Boolean);

  for (const candidateName of candidateNames) {
    const resolved = resolveWreckLookupByCandidate(`${candidateName} Wreck`);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function buildNpcFactionWreckCandidateNames(context = {}, shipMeta = {}, itemMeta = {}) {
  const hullClassName =
    resolveShipHullClassName(shipMeta, itemMeta) ||
    resolveShipHullClassName({ groupName: context.groupName }, {});
  const wreckSize = resolveNpcHullWreckSize(hullClassName);
  const labels = resolveFactionWreckLabels(
    context.factionName,
    context.groupName,
    context.itemName,
    context.profileID,
    shipMeta.name,
    itemMeta.name,
    shipMeta.groupName,
    itemMeta.groupName,
  );
  const candidates = [];

  for (const label of labels) {
    if (wreckSize) {
      candidates.push(`${label} ${wreckSize} Wreck`);
    }
    candidates.push(`${label} Ship Wreck`);
    candidates.push(`${label} Wreck`);
  }

  return [...new Set(candidates)];
}

function resolveNpcFactionWreckType(context = {}, shipMeta = {}, itemMeta = {}) {
  const candidates = buildNpcFactionWreckCandidateNames(context, shipMeta, itemMeta);
  for (const candidate of candidates) {
    const resolved = resolveWreckLookupByCandidate(candidate);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

function resolveShipWreckType(shipTypeID) {
  const shipMeta = resolveShipByTypeID(shipTypeID) || {};
  const itemMeta = resolveItemByTypeID(shipTypeID) || {};
  const explicitMatch = resolveSpecialShipWreckType(shipMeta, itemMeta);
  if (explicitMatch) {
    return explicitMatch;
  }
  const exactNamedMatch = resolveExactNamedShipWreckType(shipMeta, itemMeta);
  if (exactNamedMatch) {
    return exactNamedMatch;
  }
  const candidates = buildShipWreckCandidateNames(shipMeta, itemMeta);

  for (const candidate of candidates) {
    const resolved = resolveWreckLookupByCandidate(candidate);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function resolveEntityWreckType(input = {}) {
  const context = typeof input === "object" && input !== null
    ? input
    : { shipTypeID: input };
  const shipTypeID = toPositiveInt(context.shipTypeID, 0);
  const shipMeta = shipTypeID > 0 ? (resolveShipByTypeID(shipTypeID) || {}) : {};
  const itemMeta = shipTypeID > 0 ? (resolveItemByTypeID(shipTypeID) || {}) : {};
  const nativeNpcContext =
    context.nativeNpc === true ||
    String(context.npcEntityType || "").trim().length > 0 ||
    String(context.profileID || "").trim().length > 0;

  if (nativeNpcContext) {
    const {
      resolveCapitalNpcWreckType,
    } = require(path.join(__dirname, "./npc/capitals/capitalNpcWrecks"));
    const capitalMatch = resolveCapitalNpcWreckType({
      profileID: context.profileID,
      shipTypeID,
      itemName: context.itemName,
      groupName: context.groupName,
      classID: context.classID,
      factionName: context.factionName,
    });
    if (capitalMatch) {
      return capitalMatch;
    }

    const factionMatch = resolveNpcFactionWreckType(context, shipMeta, itemMeta);
    if (factionMatch) {
      return factionMatch;
    }
  }

  return resolveShipWreckType(shipTypeID);
}

module.exports = {
  buildDunRotationFromDirection,
  resolveEntityWreckType,
  resolveFactionWreckLabels,
  resolveNpcFactionWreckType,
  resolveShipWreckType,
};
