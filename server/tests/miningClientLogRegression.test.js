const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const CorpFittingMgrService = require(path.join(
  repoRoot,
  "server/src/services/fitting/corpFittingMgrService",
));
const DungeonExplorationMgrService = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonExplorationMgrService",
));

test("corpFittingMgr community fittings returns an empty dict instead of null", () => {
  const service = new CorpFittingMgrService();
  const result = service.Handle_GetCommunityFittings([], null, null);
  assert.deepEqual(result, {
    type: "dict",
    entries: [],
  });
});

test("dungeonExplorationMgr escalating path details returns an empty list instead of null", () => {
  const service = new DungeonExplorationMgrService();
  const result = service.Handle_GetMyEscalatingPathDetails([], null, null);
  assert.deepEqual(result, {
    type: "list",
    items: [],
  });
});

test("dungeonExplorationMgr escalating path details stays non-null across direct and dispatched calls", () => {
  const service = new DungeonExplorationMgrService();
  assert.deepEqual(service.GetMyEscalatingPathDetails([], null, null), {
    type: "list",
    items: [],
  });
  assert.deepEqual(service.callMethod("GetMyEscalatingPathDetails", [], null, null), {
    type: "list",
    items: [],
  });
});
