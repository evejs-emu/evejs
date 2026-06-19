const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const InventoryAssetHoldingMgrService = require(path.join(
  repoRoot,
  "server/src/services/inventory/inventoryAssetHoldingMgrService",
));

function buildSession(characterID) {
  return {
    characterID,
    charid: characterID,
  };
}

test("inventoryAssetHoldingMgr compatibility stub returns client-safe defaults and keeps toggles session-local", () => {
  const service = new InventoryAssetHoldingMgrService();
  const sessionA = buildSession(140000001);
  const sessionB = buildSession(140000002);

  assert.equal(service.callMethod("is_item_failure_enabled", [], sessionA), false);
  assert.equal(service.callMethod("is_item_validation_enabled", [], sessionA), true);
  assert.equal(service.callMethod("is_item_failure_enabled", [], sessionB), false);
  assert.equal(service.callMethod("is_item_validation_enabled", [], sessionB), true);

  assert.equal(service.callMethod("set_item_failure_enabled", [true], sessionA), null);
  assert.equal(service.callMethod("set_item_validation_enabled", [false], sessionA), null);

  assert.equal(service.callMethod("is_item_failure_enabled", [], sessionA), true);
  assert.equal(service.callMethod("is_item_validation_enabled", [], sessionA), false);
  assert.equal(service.callMethod("is_item_failure_enabled", [], sessionB), false);
  assert.equal(service.callMethod("is_item_validation_enabled", [], sessionB), true);
});
