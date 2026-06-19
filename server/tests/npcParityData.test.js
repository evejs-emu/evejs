const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const {
  getNpcLootTable,
  resolveNpcSpawnPool,
} = require(path.join(repoRoot, "server/src/space/npc/npcData"));
const {
  rollNpcLootEntries,
} = require(path.join(repoRoot, "server/src/space/npc/npcLoot"));

function withMockedRandom(sequence, fn) {
  const originalRandom = Math.random;
  let index = 0;
  Math.random = () => {
    const value = sequence[index];
    index += 1;
    return typeof value === "number" ? value : 0;
  };
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

test("officer loot tables use authored explicit entries instead of the generic random-any pool", () => {
  const lootTable = getNpcLootTable("parity_blood_raider_officer");
  assert.ok(lootTable, "expected Blood Raider officer loot table to exist");

  const entries = withMockedRandom([0, 0], () => rollNpcLootEntries(lootTable));
  const typeIDs = new Set(entries.map((entry) => Number(entry && entry.typeID || 0)));

  assert.equal(entries.length >= 4, true, "expected guaranteed officer ammo plus a rolled officer module");
  assert.equal(typeIDs.has(14443), true, "expected deterministic officer roll to include Ahremen's laser");
  assert.equal(typeIDs.has(21270), true, "expected officer loot to include small Dark Blood crystals");
  assert.equal(typeIDs.has(21286), true, "expected officer loot to include medium Dark Blood crystals");
  assert.equal(typeIDs.has(21302), true, "expected officer loot to include large Dark Blood crystals");
  assert.equal(
    entries.every((entry) => (
      [14443, 14439, 14453, 14441, 13811, 13809, 13801, 13799, 21270, 21286, 21302]
        .includes(Number(entry && entry.typeID || 0))
    )),
    true,
    "expected explicit officer loot entries to stay inside the authored Blood Raider officer table",
  );
});

test("expanded pirate parity pools resolve exact faction, doctrine, deadspace, and officer aliases", () => {
  const cases = [
    ["blood beam", "blood_beam"],
    ["sansha officer", "sanshas_officer"],
    ["shadow serpentis", "serpentis_deadspace"],
    ["guristas rail", "guristas_rail"],
    ["deadspace", "npc_deadspace_hostiles"],
    ["officers", "npc_officer_hostiles"],
  ];

  for (const [query, expectedPoolID] of cases) {
    const resolution = resolveNpcSpawnPool(query);
    assert.equal(resolution.success, true, `expected ${query} to resolve to a spawn pool`);
    assert.equal(
      resolution.data && resolution.data.spawnPoolID,
      expectedPoolID,
      `expected ${query} to resolve to ${expectedPoolID}`,
    );
  }
});
