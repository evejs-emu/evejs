const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..");
const npcService = require(path.join(
  repoRoot,
  "server/src/space/npc",
));
const npcData = require(path.join(
  repoRoot,
  "server/src/space/npc/npcData",
));
const wormholeAuthority = require(path.join(
  repoRoot,
  "server/src/services/exploration/wormholes/wormholeAuthority",
));

test("startup-rule matching now supports region, constellation, and wormhole-class selectors", () => {
  const matches = npcService._testing && npcService._testing.ruleAppliesToSystem;
  assert.equal(typeof matches, "function", "expected testing hook for startup-rule matching");

  assert.equal(
    matches({
      startupRuleID: "test_region",
      regionIDs: [10000002],
    }, 30000142),
    true,
    "expected region-scoped rules to match Jita",
  );

  assert.equal(
    matches({
      startupRuleID: "test_constellation",
      constellationIDs: [20000020],
    }, 30000142),
    true,
    "expected constellation-scoped rules to match Jita",
  );

  const pochvenSystem = wormholeAuthority
    .listSystems()
    .find((system) => Number(system && system.wormholeClassID) === 25);
  assert.ok(pochvenSystem, "expected repo authority to expose at least one Pochven system");

  assert.equal(
    matches({
      startupRuleID: "test_pochven_family",
      wormholeClassIDs: [25],
    }, Number(pochvenSystem.solarSystemID)),
    true,
    "expected wormhole-class startup rules to match whole Pochven-family systems",
  );

  assert.equal(
    matches({
      startupRuleID: "test_nonmatch",
      wormholeClassIDs: [14],
    }, 30000142),
    false,
    "expected a mismatched wormhole class selector to stay false in known-space Jita",
  );
});

test("generated Pochven Trig startup rule matches Pochven and stays out of known-space", () => {
  const matches = npcService._testing && npcService._testing.ruleAppliesToSystem;
  assert.equal(typeof matches, "function", "expected testing hook for startup-rule matching");

  const pochvenSystem = wormholeAuthority
    .listSystems()
    .find((system) => Number(system && system.wormholeClassID) === 25);
  assert.ok(pochvenSystem, "expected repo authority to expose at least one Pochven system");

  const startupRule = npcData
    .listNpcStartupRules()
    .find((rule) => (
      /^parity_trig_pochven_(border|internal|home)_gate_patrol_startup$/.test(
        String(rule && rule.startupRuleID || ""),
      ) &&
      Array.isArray(rule && rule.systemIDs) &&
      rule.systemIDs.includes(Number(pochvenSystem.solarSystemID))
    )) || null;
  assert.ok(startupRule, "expected generated family-scoped Trig startup rule");

  assert.equal(
    matches(startupRule, Number(pochvenSystem.solarSystemID)),
    true,
    "expected generated Trig startup rule to match Pochven systems",
  );

  assert.equal(
    matches(startupRule, 30000142),
    false,
    "expected generated Trig startup rule to stay out of Jita",
  );
});
