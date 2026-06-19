const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  getActiveShipRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  dockShipToLocation,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));

test("dockShipToLocation refuses non-dockable solar system IDs", () => {
  const activeShip = getActiveShipRecord(140000008);
  assert.ok(activeShip && activeShip.itemID, "Expected Dolltest to have an active ship");

  const result = dockShipToLocation(activeShip.itemID, 30000142);
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "DOCK_LOCATION_NOT_FOUND");
});
