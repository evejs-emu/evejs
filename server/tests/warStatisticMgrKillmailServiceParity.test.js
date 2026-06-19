const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const WarStatisticMgrService = require(path.join(
  repoRoot,
  "server/src/services/corporation/warStatisticMgrService",
));
const {
  getKillmailHashValue,
  getKillmailRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/killmail/killmailState",
));

function readKeyValField(payload, fieldName, fallback = undefined) {
  if (
    !payload ||
    payload.type !== "object" ||
    payload.name !== "util.KeyVal" ||
    !payload.args ||
    payload.args.type !== "dict" ||
    !Array.isArray(payload.args.entries)
  ) {
    return fallback;
  }
  const entry = payload.args.entries.find(([key]) => key === fieldName);
  return entry ? entry[1] : fallback;
}

test("warStatisticMgr GetKillMail accepts marshal-wrapped scalar args from live chat links", () => {
  const service = new WarStatisticMgrService();
  const record = getKillmailRecord(889);

  assert.ok(record, "expected seeded killmail 889 to exist");

  const payload = service.Handle_GetKillMail([
    { type: "long", value: BigInt(record.killID) },
    { type: "token", value: getKillmailHashValue(record) },
  ]);

  assert.ok(payload, "expected a killmail payload instead of None");
  assert.equal(readKeyValField(payload, "killID"), Number(record.killID));
  assert.equal(readKeyValField(payload, "victimShipTypeID"), Number(record.victimShipTypeID));
});
