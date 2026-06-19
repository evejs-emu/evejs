const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const log = require(path.join(repoRoot, "server/src/utils/logger"));
const { StationSvcAlias } = require(path.join(
  repoRoot,
  "server/src/services/station/stationService",
));

function keyValToMap(value) {
  assert.equal(value && value.type, "object");
  assert.equal(value && value.name, "util.KeyVal");
  assert.equal(value.args && value.args.type, "dict");
  assert.ok(Array.isArray(value.args.entries));
  return new Map(value.args.entries);
}

test("stationSvc GetStation returns station info-window data instead of None", () => {
  const stationSvc = new StationSvcAlias();
  const session = {
    userid: 1,
    charid: 140000002,
    characterID: 140000002,
    role: 0x65fc2062a0e41800n,
    corprole: 0n,
    solarsystemid: 30000144,
    solarsystemid2: 30000144,
    locationid: 30000144,
    shipid: 990112757,
    corpid: 98000000,
    allianceid: 99000000,
  };

  for (const stationID of [60000685, 60002956]) {
    const result = stationSvc.Handle_GetStation([stationID], session);
    const stationInfo = keyValToMap(result);

    assert.equal(Number(stationInfo.get("stationID")), stationID);
    assert.ok(Number(stationInfo.get("operationID")) > 0);
    assert.ok(Number(stationInfo.get("stationTypeID")) > 0);
    assert.ok(Number(stationInfo.get("solarSystemID")) > 0);
    assert.ok(Number(stationInfo.get("serviceMask")) > 0);
  }
});

test("stationSvc GetStation verbose debug logging is BigInt-safe", () => {
  const stationSvc = new StationSvcAlias();
  const role = 0x65fc2062a0e41800n;
  const originalVerbose = log.isVerboseDebugEnabled;
  const originalDebug = log.debug;
  const debugLines = [];

  log.isVerboseDebugEnabled = () => true;
  log.debug = (message) => {
    debugLines.push(String(message));
  };

  try {
    const result = stationSvc.Handle_GetStation([60000685], {
      userid: 1,
      charid: 140000002,
      role,
      corprole: 0n,
      solarsystemid: 30000144,
      solarsystemid2: 30000144,
    });
    assert.equal(keyValToMap(result).get("stationID"), 60000685);
  } finally {
    log.isVerboseDebugEnabled = originalVerbose;
    log.debug = originalDebug;
  }

  assert.ok(debugLines.some((line) => line.includes(`"role":"${String(role)}"`)));
  assert.ok(debugLines.some((line) => line.includes('"corprole":"0"')));
});
