const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../../services/_shared/referenceData"));

let cache = null;

function buildCache() {
  const belts = readStaticRows(TABLE.ASTEROID_BELTS);
  const fieldStyles = readStaticRows(TABLE.ASTEROID_FIELD_STYLES);

  const beltsByID = new Map();
  const beltsBySystem = new Map();
  const fieldStylesByID = new Map();

  for (const belt of belts) {
    beltsByID.set(Number(belt.itemID), belt);
    if (!beltsBySystem.has(Number(belt.solarSystemID))) {
      beltsBySystem.set(Number(belt.solarSystemID), []);
    }
    beltsBySystem.get(Number(belt.solarSystemID)).push(belt);
  }

  for (const style of fieldStyles) {
    const styleID = String(style && style.fieldStyleID || "").trim();
    if (!styleID) {
      continue;
    }
    fieldStylesByID.set(styleID, style);
  }

  for (const beltsForSystem of beltsBySystem.values()) {
    beltsForSystem.sort((left, right) => Number(left.itemID) - Number(right.itemID));
  }

  return {
    belts,
    fieldStyles,
    beltsByID,
    beltsBySystem,
    fieldStylesByID,
  };
}

function ensureLoaded() {
  if (!cache) {
    cache = buildCache();
    log.info(
      `[Asteroids] Loaded ${cache.belts.length} asteroid belts and ${cache.fieldStyles.length} field styles`,
    );
  }
  return cache;
}

function getBeltsForSystem(systemID) {
  return [
    ...(ensureLoaded().beltsBySystem.get(Number(systemID)) || []),
  ];
}

function getBeltByID(itemID) {
  return ensureLoaded().beltsByID.get(Number(itemID)) || null;
}

function getFieldStyleByID(fieldStyleID) {
  return ensureLoaded().fieldStylesByID.get(String(fieldStyleID || "").trim()) || null;
}

module.exports = {
  ensureLoaded,
  getBeltsForSystem,
  getBeltByID,
  getFieldStyleByID,
};
