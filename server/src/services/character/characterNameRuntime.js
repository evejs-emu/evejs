const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));

const VALIDATION_CODE = Object.freeze({
  VALID: 1,
  TOO_SHORT: -1,
  TOO_LONG: -2,
  ILLEGAL_CHARACTER: -5,
  TOO_MANY_SPACES: -6,
  CONSECUTIVE_SPACES: -7,
  UNAVAILABLE: -101,
  RESERVED: -102,
});

const MAX_CHARACTER_NAME_LENGTH = 37;
const MIN_CHARACTER_NAME_LENGTH = 3;
const MAX_SPACE_COUNT = 2;
const VALID_NAME_CHAR_REGEX = /^[\p{L}\p{N}' -]+$/u;
const PROTECTED_NAME_PREFIXES = Object.freeze(["ccp ", "gm ", "isd "]);
const PROTECTED_NAME_KEYS = new Set([
  "elysian",
  "john elysian",
  "gm elysian",
]);

const RANDOM_NAME_POOLS = Object.freeze({
  1: {
    first: [
      "Aritsu",
      "Daemi",
      "Haato",
      "Ishiri",
      "Jorren",
      "Kaijun",
      "Katsen",
      "Kiyora",
      "Mikashi",
      "Noura",
      "Otsen",
      "Raika",
      "Sakiru",
      "Soryn",
      "Tavik",
      "Tovil",
      "Yashiro",
      "Yorun",
    ],
    last: [
      "Aikinen",
      "Arasai",
      "Endashi",
      "Isokawa",
      "Kaatanen",
      "Kashuro",
      "Oniseki",
      "Pashanen",
      "Sairento",
      "Tashimo",
      "Valkanen",
      "Yakeno",
    ],
  },
  2: {
    first: [
      "Aldik",
      "Brakka",
      "Eirik",
      "Hekar",
      "Jorvik",
      "Kaiva",
      "Maren",
      "Njal",
      "Rada",
      "Sava",
      "Tarkon",
      "Vekra",
      "Yrsa",
      "Zarik",
    ],
    last: [
      "Aldrik",
      "Dren",
      "Hjoren",
      "Krus",
      "Matar",
      "Ragor",
      "Skeld",
      "Tjalfi",
      "Vheran",
      "Yrjot",
    ],
  },
  4: {
    first: [
      "Ardish",
      "Aritan",
      "Jamyl",
      "Mikram",
      "Nabih",
      "Rahmiel",
      "Samira",
      "Tashar",
      "Uriel",
      "Zarim",
      "Yasmin",
      "Hezra",
      "Khemon",
      "Sani",
    ],
    last: [
      "Arzad",
      "Koraz",
      "Mikhal",
      "Nafr",
      "Oris",
      "Sarum",
      "Tebb",
      "Torsad",
      "Yashar",
      "Zerk",
    ],
  },
  8: {
    first: [
      "Aveline",
      "Bastien",
      "Celeste",
      "Corin",
      "Elara",
      "Gaston",
      "Jules",
      "Lucine",
      "Maelle",
      "Renard",
      "Sabrine",
      "Thiery",
      "Valere",
      "Yvonne",
    ],
    last: [
      "Aulmont",
      "Bardot",
      "Delacroix",
      "Duval",
      "Lafleur",
      "Marchet",
      "Moreau",
      "Roche",
      "Talon",
      "Vernier",
    ],
  },
  generic: {
    first: [
      "Ari",
      "Bren",
      "Cael",
      "Darian",
      "Elis",
      "Joren",
      "Kara",
      "Liora",
      "Maren",
      "Nerin",
      "Soren",
      "Talia",
      "Varen",
      "Yara",
    ],
    last: [
      "Arden",
      "Coren",
      "Dax",
      "Hale",
      "Kest",
      "Maren",
      "Rhett",
      "Vale",
      "Voss",
      "Wren",
    ],
  },
});

function normalizeNameString(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (value && typeof value === "object") {
    if (typeof value.value === "string") {
      return value.value.normalize("NFKC");
    }
    if (value.type === "token" && typeof value.value === "string") {
      return value.value.normalize("NFKC");
    }
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).normalize("NFKC");
}

function normalizeNameKey(name) {
  return normalizeNameString(name).trim().replace(/\s+/g, " ").toLowerCase();
}

function getCharacterRecords() {
  const result = database.read("characters", "/");
  return result.success && result.data && typeof result.data === "object"
    ? result.data
    : {};
}

function getExistingCharacterNameKeys() {
  const keys = new Set();
  for (const record of Object.values(getCharacterRecords())) {
    if (!record || typeof record !== "object") {
      continue;
    }
    const key = normalizeNameKey(record.characterName);
    if (key) {
      keys.add(key);
    }
  }
  return keys;
}

function isProtectedCharacterName(name) {
  const key = normalizeNameKey(name);
  if (!key) {
    return false;
  }
  if (PROTECTED_NAME_KEYS.has(key)) {
    return true;
  }
  return PROTECTED_NAME_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function validateCharacterName(name) {
  const rawName = normalizeNameString(name);
  const trimmedName = rawName.trim();
  if (trimmedName.length < MIN_CHARACTER_NAME_LENGTH) {
    return VALIDATION_CODE.TOO_SHORT;
  }
  if (trimmedName.length > MAX_CHARACTER_NAME_LENGTH) {
    return VALIDATION_CODE.TOO_LONG;
  }
  if (/\s{2,}/.test(trimmedName)) {
    return VALIDATION_CODE.CONSECUTIVE_SPACES;
  }
  const spaceCount = (trimmedName.match(/ /g) || []).length;
  if (spaceCount > MAX_SPACE_COUNT) {
    return VALIDATION_CODE.TOO_MANY_SPACES;
  }
  if (!VALID_NAME_CHAR_REGEX.test(trimmedName)) {
    return VALIDATION_CODE.ILLEGAL_CHARACTER;
  }
  if (isProtectedCharacterName(trimmedName)) {
    return VALIDATION_CODE.RESERVED;
  }
  if (getExistingCharacterNameKeys().has(normalizeNameKey(trimmedName))) {
    return VALIDATION_CODE.UNAVAILABLE;
  }
  return VALIDATION_CODE.VALID;
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function buildRandomNameCandidate(raceID, attempt = 0) {
  const pool = RANDOM_NAME_POOLS[raceID] || RANDOM_NAME_POOLS.generic;
  const baseName = `${pickRandom(pool.first)} ${pickRandom(pool.last)}`.trim();
  if (attempt <= 0) {
    return baseName;
  }
  const suffix = String(attempt + 1);
  const truncatedBase = baseName.slice(
    0,
    Math.max(0, MAX_CHARACTER_NAME_LENGTH - suffix.length - 1),
  ).trim();
  return `${truncatedBase} ${suffix}`.trim();
}

function getValidRandomName(raceID) {
  for (let attempt = 0; attempt < 512; attempt += 1) {
    const candidate = buildRandomNameCandidate(raceID, attempt);
    if (validateCharacterName(candidate) === VALIDATION_CODE.VALID) {
      return candidate;
    }
  }
  throw new Error(`Unable to generate a valid random character name for race ${raceID}`);
}

module.exports = {
  MAX_CHARACTER_NAME_LENGTH,
  MIN_CHARACTER_NAME_LENGTH,
  PROTECTED_NAME_KEYS,
  VALIDATION_CODE,
  getExistingCharacterNameKeys,
  getValidRandomName,
  isProtectedCharacterName,
  normalizeNameKey,
  normalizeNameString,
  validateCharacterName,
};
