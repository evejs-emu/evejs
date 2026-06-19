const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const ConfigService = require(path.join(
  repoRoot,
  "server/src/services/config/configService",
));

function dictEntriesToMap(payload) {
  const entries = Array.isArray(payload && payload.entries) ? payload.entries : [];
  return new Map(entries.map((entry) => [Number(entry[0]) || 0, entry[1]]));
}

function getKeyValField(entry, fieldName) {
  const argsEntries = Array.isArray(
    entry &&
      entry.args &&
      entry.args.type === "dict" &&
      entry.args.entries,
  )
    ? entry.args.entries
    : [];
  const match = argsEntries.find((field) => field[0] === fieldName);
  return match ? match[1] : undefined;
}

test("GetAverageMarketPrices includes mineral and blueprint price rows needed for industry quote parity", () => {
  const service = new ConfigService();
  const payload = service.Handle_GetAverageMarketPrices([], null);
  const priceMap = dictEntriesToMap(payload);

  for (const typeID of [34, 35, 36, 37, 38, 39, 40, 805, 17479, 32877]) {
    assert.ok(priceMap.has(typeID), `expected average market price entry for ${typeID}`);
    const entry = priceMap.get(typeID);
    const averagePrice = getKeyValField(entry, "averagePrice");
    const adjustedPrice = getKeyValField(entry, "adjustedPrice");
    assert.equal(typeof averagePrice, "number");
    assert.equal(typeof adjustedPrice, "number");
    assert(averagePrice > 0, `expected positive average price for ${typeID}`);
    assert(adjustedPrice > 0, `expected positive adjusted price for ${typeID}`);
  }
});
