const path = require("path");

const {
  getNpcSpawnPool,
  buildNpcDefinition,
} = require(path.join(__dirname, "../src/space/npc/npcData"));
const {
  resolveNpcSpawnPlan,
} = require(path.join(__dirname, "../src/space/npc/npcSelection"));
const {
  resolveWeaponFamily,
  isMissileWeaponFamily,
} = require(path.join(__dirname, "../src/space/combat/weaponDogma"));

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function isMissileCapableDefinition(definition) {
  const loadout = definition && definition.loadout && typeof definition.loadout === "object"
    ? definition.loadout
    : null;
  if (!loadout) {
    return false;
  }

  const firstChargeEntry = (Array.isArray(loadout.charges) ? loadout.charges : []).find(
    (entry) => toPositiveInt(entry && entry.typeID, 0) > 0,
  ) || null;
  const chargeItem = firstChargeEntry
    ? {
      typeID: toPositiveInt(firstChargeEntry.typeID, 0),
    }
    : null;

  return (Array.isArray(loadout.modules) ? loadout.modules : []).some((moduleEntry) => {
    const moduleTypeID = toPositiveInt(moduleEntry && moduleEntry.typeID, 0);
    if (moduleTypeID <= 0) {
      return false;
    }
    const family = resolveWeaponFamily(
      {
        typeID: moduleTypeID,
        npcCapabilityTypeID: toPositiveInt(moduleEntry && moduleEntry.npcCapabilityTypeID, 0),
      },
      chargeItem,
    );
    return isMissileWeaponFamily(family);
  });
}

function summarizeDefinition(definition) {
  return {
    profileID: definition && definition.profile && definition.profile.profileID || null,
    name: definition && definition.profile && definition.profile.name || null,
    shipName: definition && definition.profile && definition.profile.shipNameTemplate || null,
    behaviorProfileID: definition && definition.profile && definition.profile.behaviorProfileID || null,
    loadoutID: definition && definition.profile && definition.profile.loadoutID || null,
  };
}

function main() {
  const pool = getNpcSpawnPool("npc_missile_hostiles");
  if (!pool) {
    throw new Error("npc_missile_hostiles pool not found");
  }

  const poolEntries = Array.isArray(pool.entries) ? pool.entries : [];
  const resolvedEntries = poolEntries.map((entry) => {
    const definition = buildNpcDefinition(entry && entry.profileID);
    return {
      weight: toPositiveInt(entry && entry.weight, 0),
      missileCapable: isMissileCapableDefinition(definition),
      ...summarizeDefinition(definition),
    };
  });

  const nonMissileEntries = resolvedEntries.filter((entry) => entry.missileCapable !== true);
  if (nonMissileEntries.length > 0) {
    throw new Error(`npc_missile_hostiles contains non-missile entries: ${JSON.stringify(nonMissileEntries)}`);
  }

  const rejectedRailProfile = resolveNpcSpawnPlan("dread pithior anarchist", {
    amount: 1,
    defaultPoolID: "npc_missile_hostiles",
    preferPools: true,
    entityType: "npc",
    requiredWeaponFamily: "missileLauncher",
  });
  if (rejectedRailProfile.success || rejectedRailProfile.errorMsg !== "PROFILE_NOT_ELIGIBLE") {
    throw new Error(`expected Dread Pithior Anarchist to be rejected, got ${JSON.stringify(rejectedRailProfile)}`);
  }

  const acceptedMissileProfile = resolveNpcSpawnPlan("estamel tharchon", {
    amount: 1,
    defaultPoolID: "npc_missile_hostiles",
    preferPools: true,
    entityType: "npc",
    requiredWeaponFamily: "missileLauncher",
  });
  if (!acceptedMissileProfile.success || !acceptedMissileProfile.data) {
    throw new Error(`expected Estamel Tharchon to resolve, got ${JSON.stringify(acceptedMissileProfile)}`);
  }

  console.log(JSON.stringify({
    poolID: pool.spawnPoolID,
    entryCount: resolvedEntries.length,
    missileCapableCount: resolvedEntries.length - nonMissileEntries.length,
    rejectedRailProfile: rejectedRailProfile.errorMsg,
    acceptedMissileProfile: acceptedMissileProfile.data.selectionID,
    entries: resolvedEntries,
  }, null, 2));
}

main();
