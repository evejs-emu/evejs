const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const StructureAssetSafetyService = require(path.join(
  repoRoot,
  "server/src/services/structure/structureAssetSafetyService",
));

function extractListItems(value) {
  return value && value.type === "list" && Array.isArray(value.items)
    ? value.items
    : [];
}

function extractDictEntries(value) {
  return value &&
    value.type === "dict" &&
    Array.isArray(value.entries)
    ? value.entries
    : [];
}

test("structureAssetSafety empty-state methods return client-safe contracts", () => {
  const service = new StructureAssetSafetyService();

  assert.deepEqual(
    extractListItems(service.Handle_GetItemsInSafetyForCharacter([], null, null)),
    [],
    "Expected personal asset safety rows to default to an empty list",
  );
  assert.deepEqual(
    extractListItems(service.Handle_GetItemsInSafetyForCorp([], null, null)),
    [],
    "Expected corp asset safety rows to default to an empty list",
  );
  assert.deepEqual(
    extractDictEntries(service.Handle_GetWrapNames([[9001, 9002]], null, null)),
    [[9001, null], [9002, null]],
    "Expected wrap-name lookups to return a dict keyed by requested wrap ids",
  );

  const deliveryTargets = service.Handle_GetStructuresICanDeliverTo([30000142], null, null);
  assert.ok(Array.isArray(deliveryTargets), "Expected delivery-target lookup to return a two-value tuple");
  assert.equal(deliveryTargets.length, 2);
  assert.deepEqual(
    extractListItems(deliveryTargets[0]),
    [],
    "Expected same-system delivery targets to default to an empty list",
  );
  assert.equal(
    deliveryTargets[1],
    null,
    "Expected nearest NPC fallback to be null when there are no safety wraps",
  );
});
