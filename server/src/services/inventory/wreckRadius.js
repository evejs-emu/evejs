const fs = require("fs");
const path = require("path");

const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  resolveItemByName,
} = require(path.join(__dirname, "./itemTypeRegistry"));

const DEFAULT_RUNTIME_WRECK_RADIUS_METERS = 40;
const WRECK_PLACEHOLDER_RADIUS_METERS = 14;
const DATA_DIRECTORY_PATH = path.join(__dirname, "../../../../data");
const CLIENT_GENERIC_WRECK_PROFILE_RADII_METERS = Object.freeze({
  // Extracted from the client SOF hull resources'
  // `boundingSphere` values for `wreck_s/m/l`, rather than the placeholder
  // inventory type radii that many generic wreck rows still carry.
  wreck_s: 70.238525390625,
  wreck_m: 228.2926025390625,
  wreck_l: 282.34197998046875,
});
const WRECK_RACE_PREFIXES = Object.freeze([
  ["Caldari", 1],
  ["Minmatar", 2],
  ["Amarr", 4],
  ["Gallente", 8],
  ["Jove", 32],
  ["CONCORD", 64],
  ["ORE", 128],
  ["Triglavian", 256],
  ["EDENCOM", 512],
]);

let cachedShipRadiusIndex = null;
let cachedWreckGraphicProfileIndex = null;
let cachedGraphicsJsonlPath = null;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function resolveGraphicsJsonlPath() {
  if (cachedGraphicsJsonlPath !== null) {
    return cachedGraphicsJsonlPath;
  }

  try {
    const directoryEntries = fs.readdirSync(DATA_DIRECTORY_PATH, {
      withFileTypes: true,
    });
    const candidateDirectory = directoryEntries
      .filter((entry) =>
        entry &&
        entry.isDirectory() &&
        /^eve-online-static-data-\d+-jsonl$/i.test(entry.name),
      )
      .map((entry) => ({
        name: entry.name,
        fullPath: path.join(DATA_DIRECTORY_PATH, entry.name, "graphics.jsonl"),
      }))
      .filter((entry) => fs.existsSync(entry.fullPath))
      .sort((left, right) => right.name.localeCompare(left.name))[0];

    cachedGraphicsJsonlPath = candidateDirectory
      ? candidateDirectory.fullPath
      : "";
  } catch (error) {
    cachedGraphicsJsonlPath = "";
  }

  return cachedGraphicsJsonlPath;
}

function classifyShipHullClass(groupName, name = "") {
  const normalizedGroup = normalizeText(groupName);
  const normalizedName = normalizeText(name);
  const combinedText = `${normalizedGroup} ${normalizedName}`.trim();

  if (normalizedGroup.includes("titan")) {
    return "Titan";
  }
  if (normalizedGroup.includes("supercarrier")) {
    return "Supercarrier";
  }
  if (normalizedGroup.includes("force auxiliary")) {
    return "Force Auxiliary";
  }
  if (normalizedGroup.includes("carrier")) {
    return "Carrier";
  }
  if (normalizedGroup.includes("dread")) {
    return "Dreadnought";
  }
  if (
    normalizedGroup.includes("jump freighter") ||
    normalizedGroup.includes("freighter")
  ) {
    return "Freighter";
  }
  if (
    normalizedGroup.includes("mining barge") ||
    normalizedGroup.includes("barge") ||
    normalizedGroup.includes("exhumer")
  ) {
    return "Mining Barge";
  }
  if (
    normalizedGroup.includes("industrial") ||
    normalizedGroup.includes("hauler") ||
    normalizedGroup.includes("transport ship")
  ) {
    return "Hauler";
  }
  if (
    normalizedGroup.includes("battleship") ||
    normalizedGroup.includes("marauder") ||
    normalizedGroup.includes("black ops")
  ) {
    return "Battleship";
  }
  if (
    normalizedGroup.includes("battlecruiser") ||
    normalizedGroup.includes("command ship")
  ) {
    return "Battlecruiser";
  }
  if (
    normalizedGroup.includes("cruiser") ||
    normalizedGroup.includes("heavy interdictor") ||
    normalizedGroup.includes("strategic cruiser")
  ) {
    return "Cruiser";
  }
  if (
    normalizedGroup.includes("destroyer") ||
    normalizedGroup.includes("interdictor")
  ) {
    return "Destroyer";
  }
  if (normalizedGroup.includes("shuttle")) {
    return "Shuttle";
  }
  if (
    normalizedGroup.includes("frigate") ||
    normalizedGroup.includes("corvette") ||
    combinedText.includes("rookie ship")
  ) {
    return "Frigate";
  }
  return null;
}

function classifyWreckHullClass(name) {
  const normalizedName = normalizeText(name);
  if (!normalizedName) {
    return null;
  }

  if (normalizedName.includes("titan")) {
    return "Titan";
  }
  if (normalizedName.includes("supercarrier")) {
    return "Supercarrier";
  }
  if (normalizedName.includes("force auxiliary")) {
    return "Force Auxiliary";
  }
  if (normalizedName.includes("carrier")) {
    return "Carrier";
  }
  if (normalizedName.includes("dreadnought")) {
    return "Dreadnought";
  }
  if (
    normalizedName.includes("jump freighter") ||
    normalizedName.includes("freighter")
  ) {
    return "Freighter";
  }
  if (
    normalizedName.includes("mining barge") ||
    normalizedName.includes("barge") ||
    normalizedName.includes("exhumer")
  ) {
    return "Mining Barge";
  }
  if (
    normalizedName.includes("industrial") ||
    normalizedName.includes("hauler") ||
    normalizedName.includes("transport ship")
  ) {
    return "Hauler";
  }
  if (normalizedName.includes("battleship")) {
    return "Battleship";
  }
  if (normalizedName.includes("battlecruiser")) {
    return "Battlecruiser";
  }
  if (normalizedName.includes("cruiser")) {
    return "Cruiser";
  }
  if (normalizedName.includes("destroyer")) {
    return "Destroyer";
  }
  if (normalizedName.includes("shuttle")) {
    return "Shuttle";
  }
  if (
    normalizedName.includes("frigate") ||
    normalizedName.includes("corvette") ||
    normalizedName.includes("rookie ship")
  ) {
    return "Frigate";
  }
  if (normalizedName.includes("large wreck")) {
    return "Battleship";
  }
  if (normalizedName.includes("medium wreck")) {
    return "Cruiser";
  }
  if (normalizedName.includes("small wreck")) {
    return "Frigate";
  }
  return null;
}

function pushIndexedRadius(indexMap, key, radius) {
  if (!indexMap.has(key)) {
    indexMap.set(key, []);
  }
  indexMap.get(key).push(radius);
}

function dedupeAndSortRadii(indexMap) {
  for (const [key, radii] of indexMap.entries()) {
    indexMap.set(
      key,
      [...new Set(radii)]
        .filter((value) => value > 0)
        .sort((left, right) => left - right),
    );
  }
}

function loadShipRadiusIndex() {
  if (cachedShipRadiusIndex) {
    return cachedShipRadiusIndex;
  }

  const byHullClass = new Map();
  const byRaceAndHullClass = new Map();
  const shipRows = readStaticRows(TABLE.SHIP_TYPES);
  for (const shipRow of shipRows) {
    const radius = toFiniteNumber(shipRow && shipRow.radius, 0);
    const hullClass = classifyShipHullClass(
      shipRow && shipRow.groupName,
      shipRow && shipRow.name,
    );
    if (!hullClass || radius <= 0) {
      continue;
    }

    pushIndexedRadius(byHullClass, hullClass, radius);

    const raceID = Math.trunc(toFiniteNumber(shipRow && shipRow.raceID, 0));
    if (raceID > 0) {
      pushIndexedRadius(byRaceAndHullClass, `${raceID}:${hullClass}`, radius);
    }
  }

  dedupeAndSortRadii(byHullClass);
  dedupeAndSortRadii(byRaceAndHullClass);
  cachedShipRadiusIndex = {
    byHullClass,
    byRaceAndHullClass,
  };
  return cachedShipRadiusIndex;
}

function loadWreckGraphicProfileIndex() {
  if (cachedWreckGraphicProfileIndex) {
    return cachedWreckGraphicProfileIndex;
  }

  const index = new Map();
  try {
    const graphicsJsonlPath = resolveGraphicsJsonlPath();
    if (!graphicsJsonlPath) {
      cachedWreckGraphicProfileIndex = new Map();
      return cachedWreckGraphicProfileIndex;
    }
    const fileContent = fs.readFileSync(graphicsJsonlPath, "utf8");
    const lines = fileContent.split(/\r?\n/);
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        continue;
      }

      const graphicRow = JSON.parse(trimmedLine);
      const graphicID = Math.trunc(toFiniteNumber(graphicRow && graphicRow._key, 0));
      const sofHullName = normalizeText(graphicRow && graphicRow.sofHullName);
      if (graphicID > 0 && sofHullName.startsWith("wreck_")) {
        index.set(graphicID, sofHullName);
      }
    }
  } catch (error) {
    cachedWreckGraphicProfileIndex = new Map();
    return cachedWreckGraphicProfileIndex;
  }

  cachedWreckGraphicProfileIndex = index;
  return cachedWreckGraphicProfileIndex;
}

function selectMedianRadius(radii) {
  if (!Array.isArray(radii) || radii.length === 0) {
    return 0;
  }

  const middleIndex = Math.floor((radii.length - 1) / 2);
  return radii[middleIndex];
}

function resolveWreckRaceID(name) {
  const trimmedName = String(name || "").trim();
  for (const [prefix, raceID] of WRECK_RACE_PREFIXES) {
    if (trimmedName.toLowerCase().startsWith(`${prefix.toLowerCase()} `)) {
      return raceID;
    }
  }
  return 0;
}

function resolveMatchingWreckageRadius(name) {
  const trimmedName = String(name || "").trim();
  if (!/ wreck$/i.test(trimmedName)) {
    return 0;
  }

  const wreckageName = trimmedName.replace(/ wreck$/i, " Wreckage");
  const lookup = resolveItemByName(wreckageName);
  const radius = toFiniteNumber(
    lookup && lookup.success && lookup.match && lookup.match.radius,
    0,
  );
  return radius > 0 ? radius : 0;
}

function resolveRepresentativeShipRadius(name) {
  const hullClass = classifyWreckHullClass(name);
  if (!hullClass) {
    return 0;
  }

  const index = loadShipRadiusIndex();
  const raceID = resolveWreckRaceID(name);
  if (raceID > 0) {
    const raceSpecificRadius = selectMedianRadius(
      index.byRaceAndHullClass.get(`${raceID}:${hullClass}`),
    );
    if (raceSpecificRadius > 0) {
      return raceSpecificRadius;
    }
  }

  return selectMedianRadius(index.byHullClass.get(hullClass));
}

function resolveWreckGraphicProfile(itemType) {
  const graphicID = Math.trunc(toFiniteNumber(itemType && itemType.graphicID, 0));
  if (graphicID <= 0) {
    return "";
  }

  const graphicProfileIndex = loadWreckGraphicProfileIndex();
  return graphicProfileIndex.get(graphicID) || "";
}

function resolveGenericWreckProfileRadius(itemType) {
  const wreckGraphicProfile = resolveWreckGraphicProfile(itemType);
  return toFiniteNumber(
    CLIENT_GENERIC_WRECK_PROFILE_RADII_METERS[wreckGraphicProfile],
    0,
  );
}

function resolveRuntimeWreckRadius(itemType, fallback = 0) {
  const itemName = String(
    itemType && (itemType.itemName || itemType.name) || "",
  ).trim();
  const fallbackRadius = toFiniteNumber(fallback, 0);
  const staticRadius = toFiniteNumber(itemType && itemType.radius, 0);
  const genericWreckProfileRadius = resolveGenericWreckProfileRadius(itemType);
  if (genericWreckProfileRadius > 0) {
    return genericWreckProfileRadius;
  }
  const wreckageRadius = resolveMatchingWreckageRadius(itemName);
  const representativeShipRadius = resolveRepresentativeShipRadius(itemName);

  const candidateRadii = [
    staticRadius,
    wreckageRadius,
    representativeShipRadius,
    fallbackRadius,
  ].filter((value) => value > WRECK_PLACEHOLDER_RADIUS_METERS);

  if (candidateRadii.length > 0) {
    return Math.max(...candidateRadii);
  }

  return DEFAULT_RUNTIME_WRECK_RADIUS_METERS;
}

function resolveRuntimeWreckStructureFallbackHP(itemType, fallback = 0) {
  return Math.max(
    DEFAULT_RUNTIME_WRECK_RADIUS_METERS,
    toFiniteNumber(resolveRuntimeWreckRadius(itemType, fallback), 0),
  );
}

module.exports = {
  CLIENT_GENERIC_WRECK_PROFILE_RADII_METERS,
  DEFAULT_RUNTIME_WRECK_RADIUS_METERS,
  WRECK_PLACEHOLDER_RADIUS_METERS,
  resolveRuntimeWreckRadius,
  resolveRuntimeWreckStructureFallbackHP,
};
