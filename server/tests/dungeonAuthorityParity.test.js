const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const dungeonAuthority = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonAuthority",
));
const npcData = require(path.join(
  repoRoot,
  "server/src/space/npc/npcData",
));

test("generated dungeon authority exposes extracted client dungeon templates from one bundle", () => {
  const payload = dungeonAuthority.getPayload();

  assert.equal(Number(payload.version) >= 1, true);
  assert.equal(Number(payload.counts.archetypeCount) >= 70, true);
  assert.equal(Number(payload.counts.clientDungeonCount) >= 5000, true);
  assert.equal(Number(payload.counts.environmentTemplateCount) >= 70, true);
  assert.equal(Number(payload.counts.environmentTemplateDefinitionCount) >= 100, true);
  assert.equal(Number(payload.counts.environmentTemplateAnchorTypeCount) >= 200, true);
  assert.equal(Number(payload.counts.objectiveTypeCount) >= 10, true);
  assert.equal(Number(payload.counts.objectiveTaskTypeCount) >= 10, true);
  assert.equal(Number(payload.counts.nodeGraphCount) >= 500, true);
  assert.equal(Number(payload.counts.oreResourceDungeonCount) >= 1000, true);
  assert.equal(Number(payload.counts.gasResourceDungeonCount) >= 80, true);
  assert.equal(Number(payload.counts.iceResourceDungeonCount) >= 20, true);
  assert.equal(Number(payload.counts.templateCount) >= Number(payload.counts.clientDungeonCount), true);

  const ghostTemplates = dungeonAuthority.listTemplatesByFamily("ghost");
  const relicTemplates = dungeonAuthority.listTemplatesByFamily("relic");
  const dataTemplates = dungeonAuthority.listTemplatesByFamily("data");
  const oreTemplates = dungeonAuthority.listTemplatesByFamily("ore");
  const gasTemplates = dungeonAuthority.listTemplatesByFamily("gas");
  const combatTemplates = dungeonAuthority.listTemplatesByFamily("combat");

  assert.equal(ghostTemplates.length > 0, true);
  assert.equal(relicTemplates.length > 0, true);
  assert.equal(dataTemplates.length > 0, true);
  assert.equal(oreTemplates.length > 0, true);
  assert.equal(gasTemplates.length > 0, true);
  assert.equal(combatTemplates.length > 0, true);

  assert.equal(
    oreTemplates.some((template) => template.resourceComposition && template.resourceComposition.hasAnyResources),
    true,
  );
  assert.equal(
    gasTemplates.some((template) => template.resourceComposition && template.resourceComposition.hasAnyResources),
    true,
  );
  assert.equal(
    combatTemplates.some((template) => String(template && template.siteKind || "").trim().toLowerCase() === "anomaly"),
    true,
  );
  assert.equal(
    combatTemplates.some((template) => String(template && template.siteKind || "").trim().toLowerCase() === "signature"),
    true,
  );
  assert.equal(
    combatTemplates.some((template) => (
      template &&
      template.populationHints &&
      template.populationHints.encounter &&
      template.populationHints.encounter.supported === true
    )),
    true,
  );
  assert.equal(
    dataTemplates.some((template) => (
      template &&
      template.populationHints &&
      Array.isArray(template.populationHints.containers) &&
      template.populationHints.containers.some((container) => container && container.analyzer === "data")
    )),
    true,
  );
  assert.equal(
    relicTemplates.some((template) => (
      template &&
      template.populationHints &&
      Array.isArray(template.populationHints.containers) &&
      template.populationHints.containers.some((container) => container && container.analyzer === "relic")
    )),
    true,
  );
  assert.equal(
    ghostTemplates.some((template) => (
      template &&
      template.populationHints &&
      Array.isArray(template.populationHints.hazards) &&
      template.populationHints.hazards.some((hazard) => (
        (typeof hazard === "string" && hazard === "ghost_site_timer") ||
        (hazard && typeof hazard === "object" && String(hazard.kind || "").trim().toLowerCase() === "ghost_site_timer")
      ))
    )),
    true,
  );
  assert.equal(
    dataTemplates.every((template) => (
      template &&
      (
        (template.populationHints &&
          Array.isArray(template.populationHints.environmentProps) &&
          template.populationHints.environmentProps.length > 0) ||
        (template.environmentTemplates &&
          template.environmentTemplates.resolvedTemplateCatalog &&
          Object.keys(template.environmentTemplates.resolvedTemplateCatalog).length > 0)
      )
    )),
    true,
  );
  assert.equal(
    relicTemplates.every((template) => (
      template &&
      (
        (template.populationHints &&
          Array.isArray(template.populationHints.environmentProps) &&
          template.populationHints.environmentProps.length > 0) ||
        (template.environmentTemplates &&
          template.environmentTemplates.resolvedTemplateCatalog &&
          Object.keys(template.environmentTemplates.resolvedTemplateCatalog).length > 0)
      )
    )),
    true,
  );
  assert.equal(
    ghostTemplates.every((template) => (
      template &&
      (
        (template.populationHints &&
          Array.isArray(template.populationHints.environmentProps) &&
          template.populationHints.environmentProps.length > 0) ||
        (template.environmentTemplates &&
          template.environmentTemplates.resolvedTemplateCatalog &&
          Object.keys(template.environmentTemplates.resolvedTemplateCatalog).length > 0)
      )
    )),
    true,
  );
  assert.equal(
    combatTemplates.every((template) => (
      template &&
      (
        (template.populationHints &&
          Array.isArray(template.populationHints.environmentProps) &&
          template.populationHints.environmentProps.length > 0) ||
        (template.environmentTemplates &&
          template.environmentTemplates.resolvedTemplateCatalog &&
          Object.keys(template.environmentTemplates.resolvedTemplateCatalog).length > 0)
      )
    )),
    true,
  );
  assert.equal(
    dataTemplates.every((template) => (
      template &&
      template.siteSceneProfile &&
      Array.isArray(template.siteSceneProfile.structureProfiles) &&
      template.siteSceneProfile.structureProfiles.length > 0 &&
      Array.isArray(template.siteSceneProfile.objectiveVisualProfiles) &&
      template.siteSceneProfile.objectiveVisualProfiles.length > 0
    )),
    true,
  );
  assert.equal(
    relicTemplates.every((template) => (
      template &&
      template.siteSceneProfile &&
      Array.isArray(template.siteSceneProfile.structureProfiles) &&
      template.siteSceneProfile.structureProfiles.length > 0 &&
      Array.isArray(template.siteSceneProfile.objectiveVisualProfiles) &&
      template.siteSceneProfile.objectiveVisualProfiles.length > 0
    )),
    true,
  );
  assert.equal(
    ghostTemplates.every((template) => (
      template &&
      template.siteSceneProfile &&
      Array.isArray(template.siteSceneProfile.structureProfiles) &&
      template.siteSceneProfile.structureProfiles.length > 0 &&
      Array.isArray(template.siteSceneProfile.objectiveVisualProfiles) &&
      template.siteSceneProfile.objectiveVisualProfiles.length > 0
    )),
    true,
  );
  assert.equal(
    combatTemplates.every((template) => (
      template &&
      template.siteSceneProfile &&
      Array.isArray(template.siteSceneProfile.structureProfiles) &&
      template.siteSceneProfile.structureProfiles.length > 0 &&
      Array.isArray(template.siteSceneProfile.objectiveVisualProfiles) &&
      template.siteSceneProfile.objectiveVisualProfiles.length > 0
    )),
    true,
  );
  assert.equal(
    combatTemplates.some((template) => (
      template &&
      Array.isArray(template.connections) &&
      template.connections.length > 0 &&
      template.siteSceneProfile &&
      Array.isArray(template.siteSceneProfile.gateProfiles) &&
      template.siteSceneProfile.gateProfiles.length > 0
    )),
    true,
  );
  assert.equal(
    dataTemplates.every((template) => (
      template &&
      (
        (template.populationHints &&
          Array.isArray(template.populationHints.objectiveMarkers) &&
          template.populationHints.objectiveMarkers.length > 0) ||
        (template.objectiveMetadata &&
          template.objectiveMetadata.objectiveChain)
      )
    )),
    true,
  );
  assert.equal(
    relicTemplates.every((template) => (
      template &&
      (
        (template.populationHints &&
          Array.isArray(template.populationHints.objectiveMarkers) &&
          template.populationHints.objectiveMarkers.length > 0) ||
        (template.objectiveMetadata &&
          template.objectiveMetadata.objectiveChain)
      )
    )),
    true,
  );
  assert.equal(
    ghostTemplates.every((template) => (
      template &&
      (
        (template.populationHints &&
          Array.isArray(template.populationHints.objectiveMarkers) &&
          template.populationHints.objectiveMarkers.length > 0) ||
        (template.objectiveMetadata &&
          template.objectiveMetadata.objectiveChain)
      )
    )),
    true,
  );
  assert.equal(
    combatTemplates.every((template) => (
      template &&
      (
        (template.populationHints &&
          Array.isArray(template.populationHints.objectiveMarkers) &&
          template.populationHints.objectiveMarkers.length > 0) ||
        (template.objectiveMetadata &&
          template.objectiveMetadata.objectiveChain)
      )
    )),
    true,
  );
  assert.equal(
    dataTemplates.some((template) => String(template && template.populationHints && template.populationHints.source || "").trim() === "site_specific_drone_data"),
    true,
  );
  assert.equal(
    dataTemplates.some((template) => String(template && template.populationHints && template.populationHints.source || "").trim() === "site_specific_sleeper_data"),
    true,
  );
  assert.equal(
    relicTemplates.some((template) => String(template && template.populationHints && template.populationHints.source || "").trim() === "site_specific_sleeper_relic"),
    true,
  );
  assert.equal(
    gasTemplates.some((template) => String(template && template.populationHints && template.populationHints.source || "").trim() === "site_specific_gas"),
    true,
  );
  assert.equal(
    oreTemplates.some((template) => String(template && template.populationHints && template.populationHints.source || "").trim() === "site_specific_ore"),
    true,
  );
  assert.equal(
    Object.values(payload.templatesByID || {}).some((template) => (
      template &&
      template.siteFamily === "combat_hacking" &&
      String(template && template.populationHints && template.populationHints.source || "").trim() === "site_specific_combat_hacking"
    )),
    true,
  );
  assert.equal(
    Object.values(payload.templatesByID || {}).some((template) => (
      template &&
      template.populationHints &&
      Array.isArray(template.populationHints.encounters) &&
      template.populationHints.encounters.length > 1
    )),
    true,
  );
  assert.equal(
    combatTemplates.some((template) => (
      template &&
      String(template && template.populationHints && template.populationHints.source || "").trim() === "combat_wave_derived" &&
      Array.isArray(template.populationHints && template.populationHints.encounters) &&
      template.populationHints.encounters.length > 1
    )),
    true,
  );
  assert.equal(
    dataTemplates.some((template) => (
      template &&
      String(template && template.populationHints && template.populationHints.source || "").trim() === "family_derived" &&
      Array.isArray(template.populationHints && template.populationHints.containers) &&
      template.populationHints.containers.some((container) => String(container && container.lootProfile || "") === "generic_data_loot")
    )),
    true,
  );
  assert.equal(
    relicTemplates.some((template) => (
      template &&
      String(template && template.populationHints && template.populationHints.source || "").trim() === "family_derived" &&
      Array.isArray(template.populationHints && template.populationHints.containers) &&
      template.populationHints.containers.some((container) => String(container && container.lootProfile || "") === "generic_relic_loot")
    )),
    true,
  );
  assert.equal(
    dataTemplates.some((template) => (
      template &&
      Array.isArray(template.populationHints && template.populationHints.lootProfiles) &&
      template.populationHints.lootProfiles.some((profile) => (
        String(profile && profile.key || "") === "pirate_data_loot" ||
        String(profile && profile.key || "") === "generic_data_loot"
      ))
    )),
    true,
  );
  assert.equal(
    relicTemplates.some((template) => (
      template &&
      Array.isArray(template.populationHints && template.populationHints.lootProfiles) &&
      template.populationHints.lootProfiles.some((profile) => (
        String(profile && profile.key || "") === "pirate_relic_loot" ||
        String(profile && profile.key || "") === "generic_relic_loot"
      ))
    )),
    true,
  );
  assert.equal(
    ghostTemplates.some((template) => (
      template &&
      Array.isArray(template.populationHints && template.populationHints.lootProfiles) &&
      template.populationHints.lootProfiles.some((profile) => String(profile && profile.key || "") === "ghost_research_loot")
    )),
    true,
  );
  assert.equal(
    combatTemplates.some((template) => (
      template &&
      String(template && template.populationHints && template.populationHints.source || "").trim() === "combat_wave_derived" &&
      Array.isArray(template.populationHints && template.populationHints.lootProfiles) &&
      template.populationHints.lootProfiles.some((profile) => (
        String(profile && profile.key || "") === "pirate_combat_loot" ||
        String(profile && profile.key || "") === "combat_overseer_loot"
      ))
    )),
    true,
  );
  assert.equal(
    Object.values(payload.templatesByID || {}).some((template) => (
      template &&
      template.siteFamily === "combat_hacking" &&
      String(template.resolvedName || "") === "Core Runner Drop Distribution" &&
      String(template && template.populationHints && template.populationHints.source || "").trim() === "site_specific_combat_hacking"
    )),
    true,
  );

  const sample = dungeonAuthority.getClientDungeonTemplate(43);
  assert.equal(Boolean(sample), true);
  assert.equal(sample.source, "client");
  assert.equal(sample.sourceDungeonID, 43);
  assert.equal(sample.templateID, "client-dungeon:43");

  const environmentTemplate = Object.values(payload.templatesByID || {}).find((template) => (
    template &&
    template.source === "client" &&
    template.environmentTemplates &&
    template.environmentTemplates.resolvedTemplateCatalog &&
    Object.keys(template.environmentTemplates.resolvedTemplateCatalog).length > 0
  ));
  assert.equal(Boolean(environmentTemplate), true);
  assert.equal(
    Object.keys(environmentTemplate.environmentTemplates.roomTemplates || {}).length > 0,
    true,
  );
  assert.equal(
    Object.keys(environmentTemplate.environmentTemplates.resolvedTemplateCatalog || {}).length > 0,
    true,
  );

  const objectiveTemplate = Object.values(payload.templatesByID || {}).find((template) => (
    template &&
    template.source === "client" &&
    template.objectiveMetadata &&
    template.objectiveMetadata.objectiveChain &&
    template.objectiveMetadata.nodeGraph &&
    Array.isArray(template.objectiveMetadata.objectiveTypeIDs) &&
    template.objectiveMetadata.objectiveTypeIDs.length > 0
  ));
  assert.equal(Boolean(objectiveTemplate), true);
  assert.equal(
    Number(objectiveTemplate.objectiveMetadata.objectiveChainID) > 0,
    true,
  );
  assert.equal(
    Number(objectiveTemplate.objectiveMetadata.nodeGraphID) > 0,
    true,
  );
  assert.equal(
    Object.keys(objectiveTemplate.objectiveMetadata.objectiveTypesByID || {}).length > 0,
    true,
  );
  assert.equal(
    Object.keys(objectiveTemplate.objectiveMetadata.nodeTypesByID || {}).length > 0,
    true,
  );

  const archetype = dungeonAuthority.getArchetypeByID(sample.archetypeID);
  assert.equal(archetype == null, false);

  const resourceSample = dungeonAuthority.getClientDungeonTemplate(47);
  assert.deepEqual(resourceSample.resourceComposition.oreTypeIDs, [1230]);
});

test("combat anomaly and combat signature site kinds follow named retail taxonomy instead of the old coarse combat tag", () => {
  const angelMilitaryComplex = dungeonAuthority.getTemplateByID("client-dungeon:1637");
  const angelMilitaryOperationsComplex = dungeonAuthority.getTemplateByID("client-dungeon:59");
  const angelHaven = dungeonAuthority.getTemplateByID("client-dungeon:2115");
  const angelForsakenSanctum = dungeonAuthority.getTemplateByID("client-dungeon:10760");

  assert.ok(angelMilitaryComplex);
  assert.ok(angelMilitaryOperationsComplex);
  assert.ok(angelHaven);
  assert.ok(angelForsakenSanctum);

  assert.equal(angelMilitaryComplex.resolvedName, "Angel Military Complex");
  assert.equal(angelMilitaryComplex.siteKind, "signature");
  assert.equal(
    angelMilitaryComplex.populationHints &&
      angelMilitaryComplex.populationHints.encounter &&
      angelMilitaryComplex.populationHints.encounter.spawnQuery,
    "angels_deadspace",
  );

  assert.equal(angelMilitaryOperationsComplex.resolvedName, "Angel Military Operations Complex");
  assert.equal(angelMilitaryOperationsComplex.siteKind, "signature");

  assert.equal(angelHaven.resolvedName, "Angel Haven");
  assert.equal(angelHaven.siteKind, "anomaly");
  assert.equal(
    angelHaven.populationHints &&
      angelHaven.populationHints.encounter &&
      angelHaven.populationHints.encounter.spawnQuery,
    "angels_standard",
  );

  assert.equal(angelForsakenSanctum.resolvedName, "Angel Forsaken Sanctum");
  assert.equal(angelForsakenSanctum.siteKind, "anomaly");
});

test("standard anomaly NPC spawn pools exclude domination and officer inserts", () => {
  const angelsStandard = npcData.getNpcSpawnPool("angels_standard");
  assert.ok(angelsStandard);
  assert.equal(
    Array.isArray(angelsStandard.entries) && angelsStandard.entries.length > 0,
    true,
  );
  assert.equal(
    angelsStandard.entries.some((entry) => /domination|officer/i.test(String(entry && entry.profileID || ""))),
    false,
  );
});
