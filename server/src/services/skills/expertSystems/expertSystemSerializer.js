const path = require("path");

const {
  buildDict,
  buildFiletimeLong,
} = require(path.join(__dirname, "../../_shared/serviceHelpers"));
const {
  getCharacterExpertSystemEntries,
} = require("./expertSystemState");

const FILETIME_EPOCH_OFFSET = 116444736000000000n;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function msToFiletime(ms) {
  const normalizedMs = Math.max(0, toInt(ms, Date.now()));
  return BigInt(normalizedMs) * 10000n + FILETIME_EPOCH_OFFSET;
}

function buildExpertSystemsPayload(characterID, options = {}) {
  const entries = getCharacterExpertSystemEntries(characterID, options)
    .sort((left, right) => left.typeID - right.typeID)
    .map((entry) => [
      entry.typeID,
      {
        type: "list",
        items: [
          buildFiletimeLong(msToFiletime(entry.installedAtMs)),
          buildFiletimeLong(msToFiletime(entry.expiresAtMs)),
        ],
      },
    ]);
  return buildDict(entries);
}

module.exports = {
  buildExpertSystemsPayload,
  msToFiletime,
};
