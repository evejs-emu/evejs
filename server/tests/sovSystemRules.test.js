const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const worldData = require(path.join(repoRoot, "server/src/space/worldData"));
const {
  buildSovereigntyStaticSnapshot,
} = require(path.join(repoRoot, "server/src/services/sovereignty/sovStaticData"));
const {
  isSovereigntyClaimableSolarSystem,
} = require(path.join(repoRoot, "server/src/services/sovereignty/sovSystemRules"));

test("sovereignty claim rules only allow conquerable nullsec systems", () => {
  assert.equal(
    isSovereigntyClaimableSolarSystem(worldData.getSolarSystemByID(30000208)),
    true,
    "Expected LZ-6SU to be accepted as conquerable nullsec",
  );
  assert.equal(
    isSovereigntyClaimableSolarSystem(worldData.getSolarSystemByID(30000142)),
    false,
    "Expected Jita to be rejected because it is highsec",
  );
  assert.equal(
    isSovereigntyClaimableSolarSystem(worldData.getSolarSystemByID(30000021)),
    false,
    "Expected Kuharah to be rejected because it is in Pochven",
  );
  assert.equal(
    isSovereigntyClaimableSolarSystem(worldData.getSolarSystemByID(30000326)),
    false,
    "Expected WF-1LM to be rejected because it is in Jove space",
  );
  assert.equal(
    isSovereigntyClaimableSolarSystem(worldData.getSolarSystemByID(30100000)),
    false,
    "Expected Zarzakh to be rejected because it is hazard space",
  );
});

test("sovereignty static resources exclude non-claimable special-space systems", () => {
  const snapshot = buildSovereigntyStaticSnapshot();
  const systemIDs = new Set(
    (snapshot.starConfigurations || []).map(
      (configuration) => Number(configuration && configuration.solarSystemID) || 0,
    ),
  );

  assert.equal(
    systemIDs.has(30000208),
    true,
    "Expected static sovereignty resources to include conquerable nullsec systems",
  );
  assert.equal(
    systemIDs.has(30000021),
    false,
    "Expected static sovereignty resources to exclude Pochven systems",
  );
  assert.equal(
    systemIDs.has(30000326),
    false,
    "Expected static sovereignty resources to exclude Jove systems",
  );
  assert.equal(
    systemIDs.has(30100000),
    false,
    "Expected static sovereignty resources to exclude Zarzakh",
  );
});
