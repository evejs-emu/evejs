const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharMgrService = require(path.join(
  repoRoot,
  "server/src/services/character/charMgrService",
));
const {
  createCustomCorporation,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/corporationState",
));
const {
  getCorporationMember,
  _testing: corporationRuntimeTesting,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/corporationRuntimeState",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getKeyValField(payload, fieldName) {
  const entries =
    payload &&
    payload.args &&
    Array.isArray(payload.args.entries)
      ? payload.args.entries
      : [];
  return entries.find(([key]) => key === fieldName)?.[1];
}

test("charMgr GetPrivateInfoOnCorpChange returns the corp membership timestamp the wallet donation panel expects", (t) => {
  const charactersBackup = cloneValue(database.read("characters", "/").data || {});
  const corporationsBackup = cloneValue(database.read("corporations", "/").data || {});
  const corporationRuntimeBackup = cloneValue(database.read("corporationRuntime", "/").data || {});
  t.after(() => {
    database.write("characters", "/", charactersBackup);
    database.write("corporations", "/", corporationsBackup);
    database.write("corporationRuntime", "/", corporationRuntimeBackup);
    database.flushAllSync();
    corporationRuntimeTesting.resetRuntimeCaches();
  });

  const createResult = createCustomCorporation(140000001, "CharMgr Corp Change");
  assert.equal(createResult.success, true);
  const corporationID = createResult.data.corporationRecord.corporationID;
  const corporationMember = getCorporationMember(corporationID, 140000001);
  assert.ok(corporationMember);

  const service = new CharMgrService();
  const payload = service.Handle_GetPrivateInfoOnCorpChange(
    [140000001],
    {
      characterID: 140000001,
      corporationID,
      corpid: corporationID,
    },
  );

  assert.equal(payload && payload.type, "object");
  assert.equal(payload && payload.name, "util.KeyVal");
  assert.equal(getKeyValField(payload, "corporationID"), corporationID);

  const corporationDateTime = getKeyValField(payload, "corporationDateTime");
  assert.ok(corporationDateTime);
  assert.equal(corporationDateTime.type, "long");
  assert.equal(
    String(corporationDateTime.value),
    String(corporationMember.startDate),
  );
});
