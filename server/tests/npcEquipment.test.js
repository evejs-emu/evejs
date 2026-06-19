const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const {
  getNpcLoadedChargeForModule,
  getNpcPropulsionModules,
  resolveNpcPropulsionEffectName,
  getNpcWeaponModules,
} = require(path.join(repoRoot, "server/src/space/npc/npcEquipment"));
const {
  NPC_ENABLE_FITTED_PROPULSION_MODULES,
} = require(path.join(repoRoot, "server/src/space/npc/npcCapabilityResolver"));
const {
  resolveItemByTypeID,
} = require(path.join(repoRoot, "server/src/services/inventory/itemTypeRegistry"));
const {
  typeHasEffectName,
} = require(path.join(repoRoot, "server/src/services/fitting/liveFittingState"));
const {
  resolveWeaponFamily,
} = require(path.join(repoRoot, "server/src/space/combat/weaponDogma"));
const {
  listNpcProfiles,
  buildNpcDefinition,
} = require(path.join(repoRoot, "server/src/space/npc/npcData"));
const {
  validateNpcHardwareDefinition,
} = require(path.join(repoRoot, "server/src/space/npc/npcHardwareCatalog"));
const npcLoadouts = require(path.join(repoRoot, "server/src/newDatabase/data/npcLoadouts/data.json"));

function getLoadoutRows() {
  return Array.isArray(npcLoadouts && npcLoadouts.rows)
    ? npcLoadouts.rows
    : Array.isArray(npcLoadouts && npcLoadouts.loadouts)
      ? npcLoadouts.loadouts
      : Array.isArray(npcLoadouts)
        ? npcLoadouts
        : [];
}

function buildModuleItem(typeID, itemID, flagID) {
  const type = resolveItemByTypeID(typeID);
  assert.ok(type, `Expected module type ${typeID} to exist`);
  return {
    itemID,
    ownerID: 1000125,
    locationID: 980000000001,
    flagID,
    typeID: type.typeID,
    groupID: Number(type.groupID || 0),
    categoryID: Number(type.categoryID || 0),
    itemName: type.name,
    singleton: true,
    moduleState: {
      online: true,
      damage: 0,
      charge: 0,
      armorDamage: 0,
      shieldCharge: 0,
      incapacitated: false,
    },
  };
}

function buildChargeItem(typeID, itemID, moduleID) {
  const type = resolveItemByTypeID(typeID);
  assert.ok(type, `Expected charge type ${typeID} to exist`);
  return {
    itemID,
    ownerID: 1000125,
    locationID: 980000000001,
    moduleID,
    typeID: type.typeID,
    groupID: Number(type.groupID || 0),
    categoryID: Number(type.categoryID || 0),
    itemName: type.name,
    quantity: 1,
    singleton: true,
  };
}

test("native npc equipment resolver reads native module and cargo state", () => {
  const beamModule = buildModuleItem(3561, 980100000001, 27);
  const propulsionModule = buildModuleItem(35661, 980100000002, 19);
  const beamCharge = buildChargeItem(262, 980200000001, beamModule.itemID);
  const entity = {
    kind: "ship",
    itemID: 980000000001,
    nativeNpc: true,
    fittedItems: [beamModule, propulsionModule],
    nativeCargoItems: [beamCharge],
  };

  const weaponModules = getNpcWeaponModules(entity);
  assert.equal(weaponModules.length, 1);
  assert.equal(weaponModules[0].typeID, 3561);

  const loadedCharge = getNpcLoadedChargeForModule(entity, weaponModules[0]);
  assert.ok(loadedCharge);
  assert.equal(loadedCharge.typeID, 262);
  assert.equal(loadedCharge.moduleID, beamModule.itemID);

  const propulsionModules = getNpcPropulsionModules(entity);
  assert.equal(resolveNpcPropulsionEffectName(propulsionModule), "moduleBonusMicrowarpdrive");
  assert.equal(
    propulsionModules.length,
    NPC_ENABLE_FITTED_PROPULSION_MODULES === true ? 1 : 0,
  );
  if (NPC_ENABLE_FITTED_PROPULSION_MODULES === true) {
    assert.equal(propulsionModules[0].moduleItem.typeID, 35661);
    assert.equal(propulsionModules[0].effectName, "moduleBonusMicrowarpdrive");
  }
});

test("weapon family resolver classifies the main turret families and long-range subtypes from live charge metadata", () => {
  assert.equal(
    resolveWeaponFamily(
      buildModuleItem(2985, 980100000011, 27),
      buildChargeItem(262, 980200000011, 980100000011),
    ),
    "laserTurret",
  );
  assert.equal(
    resolveWeaponFamily(
      buildModuleItem(3186, 980100000012, 28),
      buildChargeItem(238, 980200000012, 980100000012),
    ),
    "hybridTurret",
  );
  assert.equal(
    resolveWeaponFamily(
      buildModuleItem(3082, 980100000013, 29),
      buildChargeItem(230, 980200000013, 980100000013),
    ),
    "hybridTurret",
  );
  assert.equal(
    resolveWeaponFamily(
      buildModuleItem(2913, 980100000014, 30),
      buildChargeItem(193, 980200000014, 980100000014),
    ),
    "projectileTurret",
  );
  assert.equal(
    resolveWeaponFamily(
      buildModuleItem(2961, 980100000015, 31),
      buildChargeItem(201, 980200000015, 980100000015),
    ),
    "projectileTurret",
  );
  assert.equal(
    resolveWeaponFamily(
      buildModuleItem(47914, 980100000016, 32),
      buildChargeItem(47924, 980200000016, 980100000016),
    ),
    "precursorTurret",
  );
});

test("native npc weapon resolver includes hybrid and projectile turrets on the shared turret path", () => {
  const beamModule = buildModuleItem(2985, 980100000021, 27);
  const blasterModule = buildModuleItem(3186, 980100000022, 28);
  const autocannonModule = buildModuleItem(2913, 980100000023, 29);
  const entity = {
    kind: "ship",
    itemID: 980000000021,
    nativeNpc: true,
    fittedItems: [beamModule, blasterModule, autocannonModule],
    nativeCargoItems: [
      buildChargeItem(262, 980200000021, beamModule.itemID),
      buildChargeItem(238, 980200000022, blasterModule.itemID),
      buildChargeItem(193, 980200000023, autocannonModule.itemID),
    ],
  };

  const weaponModules = getNpcWeaponModules(entity);
  assert.deepEqual(
    weaponModules.map((moduleItem) => moduleItem.typeID),
    [2985, 3186, 2913],
  );
});

test("native npc weapon resolver includes missile launchers on the shared snapshot path", () => {
  const lightLauncher = buildModuleItem(13926, 980100000031, 27);
  const heavyLauncher = buildModuleItem(13922, 980100000032, 28);
  const cruiseLauncher = buildModuleItem(13929, 980100000033, 29);
  const entity = {
    kind: "ship",
    itemID: 980000000031,
    nativeNpc: true,
    fittedItems: [lightLauncher, heavyLauncher, cruiseLauncher],
    nativeCargoItems: [
      buildChargeItem(27365, 980200000031, lightLauncher.itemID),
      buildChargeItem(27443, 980200000032, heavyLauncher.itemID),
      buildChargeItem(27399, 980200000033, cruiseLauncher.itemID),
    ],
  };

  const weaponModules = getNpcWeaponModules(entity);
  assert.deepEqual(
    weaponModules.map((moduleItem) => moduleItem.typeID),
    [13926, 13922, 13929],
  );
  assert.equal(
    resolveWeaponFamily(
      heavyLauncher,
      buildChargeItem(27443, 980200000034, heavyLauncher.itemID),
    ),
    "missileLauncher",
  );
});

test("local static data includes dedicated concord weapon module types", () => {
  const beam = resolveItemByTypeID(3561);
  const pulse = resolveItemByTypeID(3559);

  assert.ok(beam);
  assert.ok(pulse);
  assert.equal(beam.name, "CONCORD Dual Giga Beam Laser");
  assert.equal(pulse.name, "CONCORD Dual Giga Pulse Laser");
  assert.equal(Number(beam.categoryID || 0), 7);
  assert.equal(Number(pulse.categoryID || 0), 7);
});

test("authored heavy concord combat loadouts use dedicated concord laser modules", () => {
  const loadoutIDs = new Set([
    "concord_large_beam_laser_battleship",
    "concord_large_pulse_laser_battleship",
    "concord_large_beam_laser_battleship_mwd",
    "concord_large_pulse_laser_battleship_mwd",
  ]);
  const concordWeaponTypeIDs = new Set([3559, 3561]);

  const loadoutRows = getLoadoutRows();
  const matchingLoadouts = loadoutRows.filter((row) => loadoutIDs.has(row.loadoutID));
  assert.equal(matchingLoadouts.length, loadoutIDs.size);
  for (const loadout of matchingLoadouts) {
    const weaponTypeIDs = (Array.isArray(loadout.modules) ? loadout.modules : [])
      .map((entry) => Number(entry && entry.typeID || 0))
      .filter((typeID) => concordWeaponTypeIDs.has(typeID));
    assert.ok(
      weaponTypeIDs.length > 0,
      `Expected ${loadout.loadoutID} to include at least one weapon module`,
    );
    assert.ok(
      weaponTypeIDs.every((typeID) => concordWeaponTypeIDs.has(typeID)),
      `Expected ${loadout.loadoutID} to use dedicated CONCORD weapon modules`,
    );
  }
});

test("authored smaller concord combat loadouts use dedicated concord weapon shells", () => {
  const loadoutIDs = new Set([
    "concord_small_beam_laser_frigate",
    "concord_small_pulse_laser_frigate",
    "concord_medium_beam_laser_cruiser",
    "concord_small_beam_laser_frigate_mwd",
    "concord_small_pulse_laser_frigate_mwd",
    "concord_medium_beam_laser_cruiser_mwd",
  ]);
  const concordWeaponTypeIDs = new Set([16128, 16129, 16131]);

  const loadoutRows = getLoadoutRows();
  const matchingLoadouts = loadoutRows.filter((row) => loadoutIDs.has(row.loadoutID));
  assert.equal(matchingLoadouts.length, loadoutIDs.size);
  for (const loadout of matchingLoadouts) {
    const weaponEntries = (Array.isArray(loadout.modules) ? loadout.modules : [])
      .filter((entry) => concordWeaponTypeIDs.has(Number(entry && entry.typeID || 0)));
    assert.ok(
      weaponEntries.length > 0,
      `Expected ${loadout.loadoutID} to include at least one weapon module`,
    );
    assert.ok(
      weaponEntries.every((entry) => concordWeaponTypeIDs.has(Number(entry && entry.typeID || 0))),
      `Expected ${loadout.loadoutID} to use dedicated smaller CONCORD weapon shells`,
    );
    assert.ok(
      weaponEntries.every((entry) => Number(entry && entry.npcCapabilityTypeID || 0) > 0),
      `Expected ${loadout.loadoutID} weapon shells to carry NPC capability templates`,
    );
  }
});

test("authored blood raider combat loadouts use dedicated Dark Blood laser hardware", () => {
  const loadoutIDs = new Set([
    "small_pulse_laser_frigate",
    "blood_raider_small_pulse_destroyer",
    "blood_raider_medium_pulse_battlecruiser",
    "blood_raider_large_pulse_battleship",
    "blood_raider_large_pulse_marauder",
  ]);
  const expectedWeaponTypeIDs = new Set([13811, 13801, 13815]);
  const expectedChargeTypeIDs = new Set([21270, 21286, 21302]);
  const loadoutRows = getLoadoutRows();
  const matchingLoadouts = loadoutRows.filter((row) => loadoutIDs.has(row.loadoutID));

  assert.equal(matchingLoadouts.length, loadoutIDs.size);
  for (const loadout of matchingLoadouts) {
    const moduleTypeIDs = (Array.isArray(loadout.modules) ? loadout.modules : [])
      .map((entry) => Number(entry && entry.typeID || 0));
    const chargeTypeIDs = (Array.isArray(loadout.charges) ? loadout.charges : [])
      .map((entry) => Number(entry && entry.typeID || 0));

    assert.ok(
      moduleTypeIDs.every((typeID) => expectedWeaponTypeIDs.has(typeID)),
      `Expected ${loadout.loadoutID} to use dedicated Dark Blood laser modules`,
    );
    assert.ok(
      chargeTypeIDs.every((typeID) => expectedChargeTypeIDs.has(typeID)),
      `Expected ${loadout.loadoutID} to use dedicated Dark Blood crystals`,
    );
  }
});

test("authored multi-faction pirate loadouts use doctrine-matched faction hardware", () => {
  const expectations = [
    {
      loadoutIDs: [
        "sansha_small_pulse_frigate",
        "sansha_medium_pulse_cruiser",
        "sansha_medium_pulse_battlecruiser",
        "sansha_large_pulse_battleship",
      ],
      weaponTypeIDs: new Set([13830, 13825, 13828, 13832]),
      chargeTypeIDs: new Set([20863, 20879, 20895]),
      label: "Sansha",
    },
    {
      loadoutIDs: [
        "serpentis_small_blaster_frigate",
        "serpentis_medium_blaster_cruiser",
        "serpentis_medium_blaster_battlecruiser",
        "serpentis_large_blaster_battleship",
      ],
      weaponTypeIDs: new Set([13888, 13884, 13891]),
      chargeTypeIDs: new Set([20040, 20057, 20927]),
      label: "Serpentis",
    },
    {
      loadoutIDs: [
        "angel_small_autocannon_frigate",
        "angel_medium_autocannon_cruiser",
        "angel_medium_autocannon_battlecruiser",
        "angel_large_autocannon_battleship",
      ],
      weaponTypeIDs: new Set([13777, 13782, 13785]),
      chargeTypeIDs: new Set([20767, 20783, 20799]),
      label: "Angel",
    },
    {
      loadoutIDs: [
        "guristas_light_missile_frigate",
        "guristas_heavy_missile_cruiser",
        "guristas_heavy_missile_battlecruiser",
        "guristas_cruise_missile_battleship",
      ],
      weaponTypeIDs: new Set([13926, 13922, 13929]),
      chargeTypeIDs: new Set([27365, 27443, 27399]),
      label: "Guristas",
    },
  ];

  const loadoutRows = getLoadoutRows();
  for (const expectation of expectations) {
    const matchingLoadouts = loadoutRows.filter((row) => (
      expectation.loadoutIDs.includes(row.loadoutID)
    ));
    assert.equal(
      matchingLoadouts.length,
      expectation.loadoutIDs.length,
      `Expected ${expectation.label} authored loadouts to exist`,
    );

    for (const loadout of matchingLoadouts) {
      const moduleTypeIDs = (Array.isArray(loadout.modules) ? loadout.modules : [])
        .map((entry) => Number(entry && entry.typeID || 0));
      const chargeTypeIDs = (Array.isArray(loadout.charges) ? loadout.charges : [])
        .map((entry) => Number(entry && entry.typeID || 0));

      assert.ok(
        moduleTypeIDs.length > 0,
        `Expected ${loadout.loadoutID} to include at least one weapon module`,
      );
      assert.ok(
        moduleTypeIDs.every((typeID) => expectation.weaponTypeIDs.has(typeID)),
        `Expected ${loadout.loadoutID} to stay inside the ${expectation.label} weapon doctrine`,
      );
      assert.ok(
        chargeTypeIDs.every((typeID) => expectation.chargeTypeIDs.has(typeID)),
        `Expected ${loadout.loadoutID} to stay inside the ${expectation.label} charge doctrine`,
      );
    }
  }
});

test("expanded pirate parity profiles validate across long-range doctrines and officer hardware", () => {
  const profileIDs = [
    "parity_blood_raider_beam_battleship",
    "parity_sansha_beam_destroyer",
    "parity_serpentis_rail_battlecruiser",
    "parity_angel_artillery_battleship",
    "parity_guristas_rail_battleship",
    "parity_blood_raider_officer_ahremen_arkah",
    "parity_sansha_officer_chelm_soran",
    "parity_serpentis_officer_setele_schellan",
    "parity_angel_officer_tobias_kruzhor",
    "parity_guristas_officer_estamel_tharchon",
  ];

  for (const profileID of profileIDs) {
    const definition = buildNpcDefinition(profileID);
    assert.ok(definition, `Expected ${profileID} to build into an NPC definition`);
    const validation = validateNpcHardwareDefinition(definition);
    assert.equal(
      validation && validation.success,
      true,
      `Expected ${profileID} to satisfy native faction hardware policy`,
    );
  }
});

test("smaller concord weapon and tackle types exist in static data", () => {
  const mediumPulse = resolveItemByTypeID(16128);
  const dualHeavyPulse = resolveItemByTypeID(16129);
  const heavyPulse = resolveItemByTypeID(16131);
  const warpScrambler = resolveItemByTypeID(16140);

  assert.ok(mediumPulse);
  assert.ok(dualHeavyPulse);
  assert.ok(heavyPulse);
  assert.ok(warpScrambler);

  assert.equal(mediumPulse.name, "CONCORD Medium Pulse Laser");
  assert.equal(dualHeavyPulse.name, "CONCORD Dual Heavy Pulse Laser");
  assert.equal(heavyPulse.name, "CONCORD Heavy Pulse Laser");
  assert.equal(warpScrambler.name, "CONCORD Modified Warp Scrambler");

  assert.equal(Boolean(mediumPulse.published), false);
  assert.equal(Boolean(dualHeavyPulse.published), false);
  assert.equal(Boolean(heavyPulse.published), false);
  assert.equal(Boolean(warpScrambler.published), false);
});

test("authored concord combat loadouts use dedicated tackle and no shared compact MWDs", () => {
  const loadoutIDs = new Set([
    "concord_small_beam_laser_frigate",
    "concord_small_pulse_laser_frigate",
    "concord_medium_beam_laser_cruiser",
    "concord_large_beam_laser_battleship",
    "concord_large_pulse_laser_battleship",
    "concord_small_beam_laser_frigate_mwd",
    "concord_small_pulse_laser_frigate_mwd",
    "concord_medium_beam_laser_cruiser_mwd",
    "concord_large_beam_laser_battleship_mwd",
    "concord_large_pulse_laser_battleship_mwd",
  ]);
  const forbiddenSharedPropulsionTypeIDs = new Set([5973, 35659, 35661]);
  const loadoutRows = getLoadoutRows();
  const matchingLoadouts = loadoutRows.filter((row) => loadoutIDs.has(row.loadoutID));

  assert.equal(matchingLoadouts.length, loadoutIDs.size);
  for (const loadout of matchingLoadouts) {
    const moduleTypeIDs = (Array.isArray(loadout.modules) ? loadout.modules : [])
      .map((entry) => Number(entry && entry.typeID || 0));
    assert.equal(
      moduleTypeIDs.includes(16140),
      true,
      `Expected ${loadout.loadoutID} to include CONCORD tackle hardware`,
    );
    assert.equal(
      moduleTypeIDs.some((typeID) => forbiddenSharedPropulsionTypeIDs.has(typeID)),
      false,
      `Expected ${loadout.loadoutID} to stop using shared compact MWD modules`,
    );
  }
});

test("smaller concord weapon shells stay unusable without npc capability metadata", () => {
  const unresolvedConcordModuleItems = [
    buildModuleItem(16128, 980100000101, 27),
    buildModuleItem(16129, 980100000102, 28),
    buildModuleItem(16131, 980100000103, 29),
  ];
  for (const moduleItem of unresolvedConcordModuleItems) {
    assert.equal(
      typeHasEffectName(moduleItem.typeID, "turretFitted"),
      false,
      `Expected ${moduleItem.itemName} to be missing turret dogma in the raw static data`,
    );
    assert.equal(
      resolveWeaponFamily(moduleItem, buildChargeItem(246, 980200000101, moduleItem.itemID)),
      null,
      `Expected ${moduleItem.itemName} to remain unusable without NPC capability metadata`,
    );
  }
});

test("npc equipment resolver can use smaller concord weapon shells via npc capability templates", () => {
  const smallBeamModule = {
    ...buildModuleItem(16128, 980100000201, 27),
    npcCapabilityTypeID: 454,
  };
  const smallPulseModule = {
    ...buildModuleItem(16131, 980100000202, 28),
    npcCapabilityTypeID: 453,
  };
  const mediumBeamModule = {
    ...buildModuleItem(16129, 980100000203, 29),
    npcCapabilityTypeID: 457,
  };
  const entity = {
    kind: "ship",
    itemID: 980000000101,
    nativeNpc: true,
    fittedItems: [smallBeamModule, smallPulseModule, mediumBeamModule],
    nativeCargoItems: [
      buildChargeItem(246, 980200000201, smallBeamModule.itemID),
      buildChargeItem(246, 980200000202, smallPulseModule.itemID),
      buildChargeItem(254, 980200000203, mediumBeamModule.itemID),
    ],
  };

  const weaponModules = getNpcWeaponModules(entity);
  assert.equal(weaponModules.length, 3);
  assert.deepEqual(
    weaponModules.map((moduleItem) => moduleItem.typeID),
    [16128, 16131, 16129],
  );
  assert.equal(
    resolveWeaponFamily(
      smallBeamModule,
      buildChargeItem(246, 980200000211, smallBeamModule.itemID),
    ),
    "laserTurret",
  );
});

test("all current authored npc and concord profiles satisfy the native hardware policy", () => {
  const profiles = listNpcProfiles();
  assert.ok(profiles.length > 0, "Expected authored NPC profiles to exist");

  for (const profile of profiles) {
    const definition = buildNpcDefinition(profile.profileID);
    assert.ok(definition, `Expected ${profile.profileID} to resolve to a definition`);
    const validation = validateNpcHardwareDefinition(definition);
    assert.equal(
      validation.success,
      true,
      `${profile.profileID} failed native hardware validation: ${validation.errorMsg || "unknown"}`,
    );
  }
});

test("manual concord profiles now use chase-enabled response behaviors", () => {
  const expectedBehaviorProfiles = new Set([
    "concord_fast_response_beam_mwd",
    "concord_fast_response_pulse_mwd",
    "concord_police_cruiser_beam_mwd",
    "concord_police_battleship_beam_mwd",
    "concord_special_ops_battleship_beam_mwd",
    "concord_swat_battleship_pulse_mwd",
    "concord_army_battleship_pulse_mwd",
  ]);
  const manualConcordProfileIDs = new Set([
    "concord_response",
    "concord_police_cruiser",
    "concord_police_battleship",
    "concord_special_ops_frigate",
    "concord_special_ops_battleship",
    "concord_swat_frigate",
    "concord_swat_battleship",
    "concord_army_frigate",
    "concord_army_battleship",
  ]);

  const profiles = listNpcProfiles().filter((profile) => (
    manualConcordProfileIDs.has(profile.profileID)
  ));
  assert.equal(profiles.length, manualConcordProfileIDs.size);
  for (const profile of profiles) {
    assert.equal(
      expectedBehaviorProfiles.has(profile.behaviorProfileID),
      true,
      `Expected ${profile.profileID} to use a chase-enabled CONCORD behavior profile`,
    );
  }
});
