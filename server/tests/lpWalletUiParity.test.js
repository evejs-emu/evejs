const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const { StationSvcAlias } = require(path.join(
  repoRoot,
  "server/src/services/station/stationService",
));
const AccountService = require(path.join(
  repoRoot,
  "server/src/services/account/accountService",
));

function keyValToMap(value) {
  assert.equal(value && value.type, "object");
  assert.equal(value && value.name, "util.KeyVal");
  const entries =
    value && value.args && value.args.type === "dict" && Array.isArray(value.args.entries)
      ? value.args.entries
      : [];
  return new Map(entries);
}

test("stationSvc GetStationsForOwner returns iterable LP dockable rows for NPC corps", () => {
  const stationSvc = new StationSvcAlias();

  const result = stationSvc.Handle_GetStationsForOwner([1000004], null);
  assert.equal(result && result.type, "list");
  assert.ok(Array.isArray(result.items));
  assert.ok(result.items.length > 0);

  const firstRow = keyValToMap(result.items[0]);
  assert.ok(Number(firstRow.get("stationID")) > 0);
  assert.ok(Number(firstRow.get("solarSystemID")) > 0);
  assert.equal(Number(firstRow.get("ownerID")), 1000004);
});

test("stationSvc GetStationsForOwner returns an empty iterable instead of None for unknown owners", () => {
  const stationSvc = new StationSvcAlias();

  const result = stationSvc.Handle_GetStationsForOwner([0], null);
  assert.equal(result && result.type, "list");
  assert.deepEqual(result.items, []);
});

test("account GetEntryTypes exposes skill purchase metadata for journal entry type 141", () => {
  const accountService = new AccountService();

  const result = accountService.Handle_GetEntryTypes([], null);
  assert.equal(result && result.type, "list");

  const skillPurchaseEntry = result.items
    .map((entry) => keyValToMap(entry))
    .find((entry) => Number(entry.get("entryTypeID")) === 141);

  assert.ok(skillPurchaseEntry);
  assert.equal(skillPurchaseEntry.get("entryTypeName"), "SkillPurchase");
});
