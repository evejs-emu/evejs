const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const SearchService = require(path.join(
  repoRoot,
  "server/src/services/_other/searchService",
));

function dictEntriesToMap(payload) {
  assert.equal(payload && payload.type, "dict");
  return new Map(payload.entries);
}

function listPayloadToArray(payload) {
  return payload && payload.type === "list" && Array.isArray(payload.items)
    ? payload.items
    : [];
}

test("search QuickQuery resolves solar systems and stations for Jita", () => {
  SearchService._testing.clearSearchCaches();
  const service = new SearchService();

  const result = service.Handle_QuickQuery(
    ["Jita", [7, 11]],
    null,
    {
      hideNPC: 0,
      exact: 0,
      onlyAltName: 0,
      machoVersion: 1,
    },
  );
  const matches = listPayloadToArray(result);

  assert.equal(matches[0], 30000142, "expected exact solar-system hit to rank first");
  assert.ok(matches.includes(30000142), "expected Jita solar system in quick search results");
  assert.ok(
    matches.includes(60003760),
    "expected Jita trade hub station in quick search results",
  );
});

test("search Query resolves per-group solar system and station matches", () => {
  SearchService._testing.clearSearchCaches();
  const service = new SearchService();

  const result = service.Handle_Query(
    ["Jita", [7, 11]],
    null,
    {
      hideNPC: 0,
      exact: 0,
      onlyAltName: 0,
      machoVersion: 1,
    },
  );
  const groups = dictEntriesToMap(result);
  const solarSystems = listPayloadToArray(groups.get(7));
  const stations = listPayloadToArray(groups.get(11));

  assert.ok(
    solarSystems.includes(30000142),
    "expected Jita solar system in solar-system search group",
  );
  assert.ok(
    stations.includes(60003760),
    "expected Jita trade hub station in station search group",
  );
});
