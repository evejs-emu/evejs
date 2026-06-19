const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const explorationAuthority = require(path.join(
  repoRoot,
  "server/src/services/exploration/explorationAuthority",
));
const wormholeAuthority = require(path.join(
  repoRoot,
  "server/src/services/exploration/wormholes/wormholeAuthority",
));

test("generated exploration authority exposes the live wormhole and probe contracts from one bundle", () => {
  const payload = explorationAuthority.getPayload();

  assert.equal(Number(payload.version) >= 1, true);
  assert.equal(Number(payload.counts.wormholeSystemCount) > 8000, true);
  assert.equal(Number(payload.counts.probeTypeCount) >= 2, true);
  assert.equal(Number(payload.counts.probeLauncherTypeCount) >= 2, true);
  assert.equal(Number(payload.scanContracts.maxProbes), 8);
  assert.equal(Number(payload.scanStrengthAttributes.gas), 209);
  assert.equal(Number(payload.scanStrengthAttributes.ore), 211);
  assert.equal(Number(payload.scanStrengthAttributes.data), 208);
  assert.equal(Number(payload.scanStrengthAttributes.relic), 210);
  assert.equal(Number(payload.scanStrengthAttributes.combat), 1136);
  assert.equal(Number(payload.scanStrengthAttributes.wormhole), 1908);

  const coreProbe = explorationAuthority.getProbeDefinition(30013);
  assert.equal(coreProbe && coreProbe.typeName, "Core Scanner Probe I");
  assert.equal(Array.isArray(coreProbe && coreProbe.rangeSteps), true);
  assert.equal(coreProbe.rangeSteps.length, 8);

  const coreLauncher = explorationAuthority.getProbeLauncherDefinition(17938);
  assert.equal(coreLauncher && coreLauncher.typeName, "Core Probe Launcher I");
  assert.equal(Number(coreLauncher.speedMs) > 0, true);
  assert.equal(Number(coreLauncher.durationMs) > 0, true);

  const compatibleCharges = explorationAuthority.getCompatibleProbeChargeTypeIDs(17938);
  assert.equal(compatibleCharges.includes(30013), true);

  const wormholePayload = explorationAuthority.getWormholeAuthorityPayload();
  assert.equal(Array.isArray(wormholePayload.systems), true);
  assert.equal(Array.isArray(wormholePayload.codeTypes), true);

  const systemAuthority = wormholeAuthority.getSystemAuthority(31000007);
  assert.equal(Number(systemAuthority && systemAuthority.wormholeClassID) > 0, true);
});
