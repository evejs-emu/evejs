const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const dungeonAuthority = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonAuthority",
));

function getTemplate(sourceDungeonID) {
  const template = dungeonAuthority.getClientDungeonTemplate(sourceDungeonID);
  assert(template, `expected client dungeon template ${sourceDungeonID} to exist`);
  return template;
}

test("Drifter crisis combat sites resolve through Drifter pools instead of pirate deadspace fallbacks", () => {
  for (const sourceDungeonID of [12000, 12812, 12813, 12961, 13008]) {
    const template = getTemplate(sourceDungeonID);
    const encounters = Array.isArray(template.populationHints && template.populationHints.encounters)
      ? template.populationHints.encounters
      : [];
    assert.equal(encounters.length > 0, true, `expected dungeon ${sourceDungeonID} to expose encounter hints`);
    for (const encounter of encounters) {
      assert.equal(
        String(encounter && encounter.spawnQuery || "").trim(),
        "parity_drifter_dungeon_family",
        `expected dungeon ${sourceDungeonID} encounter hints to use the repo-owned Drifter dungeon pool`,
      );
    }
  }
});

test("Deepflow Rift no longer derives generic always-on deadspace hostiles", () => {
  const template = getTemplate(10607);
  const populationHints = template.populationHints || {};
  const encounters = Array.isArray(populationHints.encounters)
    ? populationHints.encounters
    : [];

  assert.equal(
    String(populationHints.source || "").trim(),
    "site_specific_deepflow_rift",
    "expected Deepflow Rift to use the explicit objective-driven parity override",
  );
  assert.equal(
    encounters.length,
    0,
    "expected Deepflow Rift to suppress generic always-on combat waves until exact surge materialization is authored",
  );
  assert.equal(
    Array.isArray(populationHints.hazards) && populationHints.hazards.includes("deepflow_rift_rogue_drone_surges"),
    true,
    "expected Deepflow Rift to retain explicit surge parity metadata",
  );
});

test("persistent Drifter crisis sites expose exact objective and structure hints from client authority", () => {
  const vigilance = getTemplate(12000).populationHints || {};
  assert.equal(String(vigilance.source || "").trim(), "site_specific_vigilance_point");
  assert.equal(
    Array.isArray(vigilance.environmentProps) &&
      vigilance.environmentProps.some((entry) => Number(entry && entry.typeID) === 84294),
    true,
    "expected Vigilance Point to expose the exact Vigilance Spire structure",
  );
  assert.equal(
    Array.isArray(vigilance.objectiveMarkers) &&
      vigilance.objectiveMarkers.some((entry) => String(entry && entry.key || "").trim() === "destroy_vigilance_spire"),
    true,
    "expected Vigilance Point to expose the destroy-vigilance-spire objective",
  );

  const fieldRescue = getTemplate(12812).populationHints || {};
  assert.equal(String(fieldRescue.source || "").trim(), "site_specific_field_rescue");
  assert.equal(
    Array.isArray(fieldRescue.environmentProps) &&
      fieldRescue.environmentProps.some((entry) => Number(entry && entry.typeID) === 87218),
    true,
    "expected Field Rescue to expose Battle Wreckage as the exact salvage target",
  );
  assert.equal(
    Array.isArray(fieldRescue.objectiveMarkers) &&
      fieldRescue.objectiveMarkers.some((entry) => String(entry && entry.key || "").trim() === "salvage_battle_wreckage"),
    true,
    "expected Field Rescue to expose the salvage-battle-wreckage objective",
  );

  const outpost = getTemplate(12813).populationHints || {};
  assert.equal(String(outpost.source || "").trim(), "site_specific_deathless_research_outpost");
  assert.equal(
    Array.isArray(outpost.environmentProps) &&
      outpost.environmentProps.some((entry) => Number(entry && entry.typeID) === 87222) &&
      outpost.environmentProps.some((entry) => Number(entry && entry.typeID) === 87258),
    true,
    "expected Deathless Research Outpost to expose both telemetry item variants",
  );
  assert.equal(
    Array.isArray(outpost.objectiveMarkers) &&
      outpost.objectiveMarkers.some((entry) => String(entry && entry.key || "").trim() === "accrue_hyperspace_telemetry"),
    true,
    "expected Deathless Research Outpost to expose the telemetry objective",
  );

  const labyrinth = getTemplate(12961).populationHints || {};
  assert.equal(String(labyrinth.source || "").trim(), "site_specific_reckoning_labyrinth");
  assert.equal(
    Array.isArray(labyrinth.environmentProps) &&
      labyrinth.environmentProps.some((entry) => Number(entry && entry.typeID) === 87531) &&
      labyrinth.environmentProps.some((entry) => Number(entry && entry.typeID) === 87683) &&
      labyrinth.environmentProps.some((entry) => Number(entry && entry.typeID) === 87612),
    true,
    "expected Reckoning: Labyrinth Complex to expose obstruction nodes, the hoard, and Ladon Tyrannos",
  );
  assert.equal(
    Array.isArray(labyrinth.objectiveMarkers) &&
      labyrinth.objectiveMarkers.some((entry) => String(entry && entry.key || "").trim() === "destroy_ladon_tyrannos"),
    true,
    "expected Reckoning: Labyrinth Complex to expose the Ladon objective",
  );

  const nexus = getTemplate(13008).populationHints || {};
  assert.equal(String(nexus.source || "").trim(), "site_specific_nexus_point");
  assert.equal(
    Array.isArray(nexus.environmentProps) &&
      nexus.environmentProps.some((entry) => Number(entry && entry.typeID) === 88154),
    true,
    "expected Reckoning: Nexus Point to expose the Strategos Dreadnought objective hull",
  );
  assert.equal(
    Array.isArray(nexus.objectiveMarkers) &&
      nexus.objectiveMarkers.some((entry) => String(entry && entry.key || "").trim() === "destroy_strategos_dreadnought"),
    true,
    "expected Reckoning: Nexus Point to expose the destroy-Strategos objective",
  );
});
