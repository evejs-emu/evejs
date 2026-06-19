const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const TaleMgrService = require(path.join(
  repoRoot,
  "server/src/services/tale/taleMgrService",
));

test("taleMgr returns an empty world-event list by default", () => {
  const service = new TaleMgrService();

  assert.deepEqual(service.callMethod("GetGlobalWorldEventTales", [], null), []);
  assert.deepEqual(service.GetGlobalWorldEventTales(), []);
});

test("taleMgr returns an empty active-tales list for template lookups", () => {
  const service = new TaleMgrService();

  assert.deepEqual(
    service.callMethod("get_active_tales_by_template", [12345], null),
    [],
  );
  assert.deepEqual(service.get_active_tales_by_template([12345]), []);
});
