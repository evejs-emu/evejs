const path = require("path");

const database = require(path.join(__dirname, "../../../newDatabase"));

const authorityResult = database.read("trigDrifterSpawnAuthority", "/");
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

const SYSTEM_LISTS = deepFreeze(
  authorityRoot &&
    authorityRoot.systemLists &&
    typeof authorityRoot.systemLists === "object"
      ? authorityRoot.systemLists
      : {},
);

function getSystemList(key) {
  const normalizedKey = String(key || "").trim();
  const list = SYSTEM_LISTS[normalizedKey];
  return Array.isArray(list) ? [...list] : [];
}

module.exports = {
  SYSTEM_LISTS,
  getSystemList,
};
