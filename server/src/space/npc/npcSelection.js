const path = require("path");

const {
  buildNpcDefinition,
  resolveNpcProfile,
  resolveNpcSpawnPool,
  getNpcSpawnPool,
  resolveNpcSpawnGroup,
  getNpcSpawnGroup,
} = require(path.join(__dirname, "./npcData"));
const {
  resolveWeaponFamily,
  isMissileWeaponFamily,
} = require(path.join(__dirname, "../combat/weaponDogma"));

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function dedupeSuggestions(values, limit = 8) {
  const results = [];
  const seen = new Set();
  for (const value of values || []) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
    if (results.length >= limit) {
      break;
    }
  }
  return results;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getCachedNpcDefinition(profileID, definitionCache) {
  const normalizedProfileID = String(profileID || "").trim();
  if (!normalizedProfileID) {
    return null;
  }

  if (definitionCache.has(normalizedProfileID)) {
    return definitionCache.get(normalizedProfileID);
  }

  const definition = buildNpcDefinition(normalizedProfileID);
  if (!definition) {
    return null;
  }

  definitionCache.set(normalizedProfileID, definition);
  return definition;
}

function isEntityTypeAllowed(value, expectedEntityType = "") {
  if (!expectedEntityType) {
    return true;
  }

  return String(value || "").trim().toLowerCase() ===
    String(expectedEntityType || "").trim().toLowerCase();
}

function chooseWeightedEntry(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }

  let totalWeight = 0;
  let fallbackEntry = null;
  for (const entry of entries) {
    if (String(entry && entry.profileID || "").trim().length === 0) {
      continue;
    }
    fallbackEntry = entry;
    totalWeight += Math.max(1, toPositiveInt(entry && entry.weight, 1));
  }
  if (!fallbackEntry || totalWeight <= 0) {
    return null;
  }

  let roll = Math.random() * totalWeight;
  for (const entry of entries) {
    if (String(entry && entry.profileID || "").trim().length === 0) {
      continue;
    }
    roll -= Math.max(1, toPositiveInt(entry && entry.weight, 1));
    if (roll < 0) {
      return entry;
    }
  }

  return fallbackEntry;
}

function definitionMatchesRequiredWeaponFamily(definition, requiredWeaponFamily = "") {
  const normalizedRequiredWeaponFamily = String(requiredWeaponFamily || "").trim();
  if (!normalizedRequiredWeaponFamily) {
    return true;
  }

  const loadout = definition && definition.loadout && typeof definition.loadout === "object"
    ? definition.loadout
    : null;
  if (!loadout) {
    return false;
  }

  const chargeEntries = Array.isArray(loadout.charges) ? loadout.charges : [];
  const firstChargeEntry = chargeEntries.find(
    (entry) => toPositiveInt(entry && entry.typeID, 0) > 0,
  ) || null;
  const chargeItem = firstChargeEntry
    ? {
      typeID: toPositiveInt(firstChargeEntry.typeID, 0),
    }
    : null;

  const moduleEntries = Array.isArray(loadout.modules) ? loadout.modules : [];
  return moduleEntries.some((moduleEntry) => {
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
    if (normalizedRequiredWeaponFamily === "missileLauncher") {
      return isMissileWeaponFamily(family);
    }
    return family === normalizedRequiredWeaponFamily;
  });
}

function resolveEntryCount(entry) {
  const exactCount = toPositiveInt(entry && entry.count, 0);
  if (exactCount > 0) {
    return exactCount;
  }

  const minCount = Math.max(0, toPositiveInt(entry && entry.minCount, 0));
  const maxCount = Math.max(minCount, toPositiveInt(entry && entry.maxCount, minCount));
  if (maxCount <= 0) {
    return 0;
  }

  if (minCount === maxCount) {
    return minCount;
  }

  return minCount + Math.floor(Math.random() * ((maxCount - minCount) + 1));
}

function buildDefinitionsForPool(
  pool,
  amount,
  expectedEntityType = "",
  definitionCache = new Map(),
  options = {},
) {
  const requestedAmount = Math.max(1, toPositiveInt(amount, 1));
  const requiredWeaponFamily = String(options.requiredWeaponFamily || "").trim();
  const definitions = [];
  const eligibleEntries = Array.isArray(pool && pool.entries)
    ? pool.entries.filter((entry) => {
      const definition = getCachedNpcDefinition(
        entry && entry.profileID,
        definitionCache,
      );
      if (!definition) {
        return false;
      }
      if (!isEntityTypeAllowed(definition.profile.entityType, expectedEntityType)) {
        return false;
      }
      return definitionMatchesRequiredWeaponFamily(definition, requiredWeaponFamily);
    })
    : [];

  for (let index = 0; index < requestedAmount; index += 1) {
    const chosenEntry = chooseWeightedEntry(eligibleEntries);
    if (!chosenEntry) {
      return {
        success: false,
        errorMsg: "POOL_EMPTY",
        suggestions: [],
      };
    }

    const definition = getCachedNpcDefinition(
      chosenEntry.profileID,
      definitionCache,
    );
    if (!definition) {
      return {
        success: false,
        errorMsg: "NPC_DEFINITION_INCOMPLETE",
        suggestions: [],
      };
    }
    if (!isEntityTypeAllowed(definition.profile.entityType, expectedEntityType)) {
      return {
        success: false,
        errorMsg: "PROFILE_NOT_FOUND",
        suggestions: [],
      };
    }
    if (!definitionMatchesRequiredWeaponFamily(definition, requiredWeaponFamily)) {
      return {
        success: false,
        errorMsg: "PROFILE_NOT_ELIGIBLE",
        suggestions: [],
      };
    }

    definitions.push(cloneValue(definition));
  }

  return {
    success: true,
    data: {
      selectionKind: "pool",
      selectionID: pool.spawnPoolID,
      selectionName: pool.name || pool.spawnPoolID,
      definitions,
      pool,
    },
    suggestions: [],
  };
}

function buildDefinitionsForProfile(
  profileResolution,
  amount,
  expectedEntityType = "",
  options = {},
) {
  const definition = getCachedNpcDefinition(
    profileResolution &&
      profileResolution.data &&
      profileResolution.data.profileID,
    new Map(),
  );
  if (!definition) {
    return {
      success: false,
      errorMsg: "NPC_DEFINITION_INCOMPLETE",
      suggestions: [],
    };
  }
  if (!isEntityTypeAllowed(definition.profile.entityType, expectedEntityType)) {
    return {
      success: false,
      errorMsg: "PROFILE_NOT_FOUND",
      suggestions: [],
    };
  }
  if (!definitionMatchesRequiredWeaponFamily(definition, options.requiredWeaponFamily)) {
    return {
      success: false,
      errorMsg: "PROFILE_NOT_ELIGIBLE",
      suggestions: [],
    };
  }

  return {
    success: true,
    data: {
      selectionKind: "profile",
      selectionID: definition.profile.profileID,
      selectionName: definition.profile.name || definition.profile.profileID,
      definitions: Array.from(
        { length: Math.max(1, toPositiveInt(amount, 1)) },
        () => cloneValue(definition),
      ),
      profile: cloneValue(definition.profile),
    },
    suggestions: [],
  };
}

function buildDefinitionsForSpawnGroup(group, options = {}) {
  const expectedEntityType = String(options.entityType || "").trim().toLowerCase();
  const requiredWeaponFamily = String(options.requiredWeaponFamily || "").trim();
  const definitionCache = new Map();
  const definitions = [];
  const composition = [];
  const entries = Array.isArray(group && group.entries) ? group.entries : [];

  for (const entry of entries) {
    const entryCount = resolveEntryCount(entry);
    if (entryCount <= 0) {
      continue;
    }

    if (String(entry && entry.profileID || "").trim()) {
      const definition = getCachedNpcDefinition(
        entry.profileID,
        definitionCache,
      );
      if (!definition) {
        return {
          success: false,
          errorMsg: "NPC_DEFINITION_INCOMPLETE",
          suggestions: [],
        };
      }
      if (!isEntityTypeAllowed(definition.profile.entityType, expectedEntityType)) {
        return {
          success: false,
          errorMsg: "PROFILE_NOT_FOUND",
          suggestions: [],
        };
      }
      if (!definitionMatchesRequiredWeaponFamily(definition, requiredWeaponFamily)) {
        return {
          success: false,
          errorMsg: "PROFILE_NOT_ELIGIBLE",
          suggestions: [],
        };
      }

      for (let index = 0; index < entryCount; index += 1) {
        definitions.push(cloneValue(definition));
      }
      composition.push({
        entryKind: "profile",
        selectionID: definition.profile.profileID,
        count: entryCount,
      });
      continue;
    }

    if (String(entry && entry.spawnPoolID || "").trim()) {
      const pool = getNpcSpawnPool(entry.spawnPoolID);
      if (!pool) {
        return {
          success: false,
          errorMsg: "PROFILE_NOT_FOUND",
          suggestions: [],
        };
      }
      const poolResult = buildDefinitionsForPool(
        pool,
        entryCount,
        expectedEntityType,
        definitionCache,
        {
          requiredWeaponFamily,
        },
      );
      if (!poolResult.success || !poolResult.data) {
        return poolResult;
      }

      definitions.push(...poolResult.data.definitions);
      composition.push({
        entryKind: "pool",
        selectionID: pool.spawnPoolID,
        count: poolResult.data.definitions.length,
      });
      continue;
    }

    return {
      success: false,
      errorMsg: "POOL_EMPTY",
      suggestions: [],
    };
  }

  if (definitions.length === 0) {
    return {
      success: false,
      errorMsg: "POOL_EMPTY",
      suggestions: [],
    };
  }

  return {
    success: true,
    data: {
      selectionKind: "group",
      selectionID: group.spawnGroupID,
      selectionName: group.name || group.spawnGroupID,
      definitions,
      composition,
      group,
    },
    suggestions: [],
  };
}

function resolveNpcSpawnGroupPlan(query, options = {}) {
  const trimmedQuery = String(query || "").trim();
  const expectedEntityType = String(options.entityType || "").trim().toLowerCase();
  const fallbackSpawnGroupID = String(options.fallbackSpawnGroupID || "").trim();
  const requiredWeaponFamily = String(options.requiredWeaponFamily || "").trim();

  if (!trimmedQuery && fallbackSpawnGroupID) {
    const fallbackGroup = getNpcSpawnGroup(fallbackSpawnGroupID);
    if (fallbackGroup) {
      return buildDefinitionsForSpawnGroup(fallbackGroup, {
        entityType: expectedEntityType,
        requiredWeaponFamily,
      });
    }
  }

  const groupResolution = resolveNpcSpawnGroup(trimmedQuery, "");
  if (!groupResolution.success || !groupResolution.data) {
    return groupResolution;
  }

  return buildDefinitionsForSpawnGroup(groupResolution.data, {
    entityType: expectedEntityType,
    requiredWeaponFamily,
  });
}

function resolveNpcSpawnPlan(query, options = {}) {
  const trimmedQuery = String(query || "").trim();
  const requestedAmount = Math.max(1, toPositiveInt(options.amount, 1));
  const expectedEntityType = String(options.entityType || "").trim().toLowerCase();
  const defaultPoolID = String(options.defaultPoolID || "").trim();
  const fallbackProfileID = String(options.fallbackProfileID || "").trim();
  const requiredWeaponFamily = String(options.requiredWeaponFamily || "").trim();

  if (!trimmedQuery) {
    if (defaultPoolID) {
      const defaultPool = getNpcSpawnPool(defaultPoolID);
      if (defaultPool) {
        return buildDefinitionsForPool(
          defaultPool,
          requestedAmount,
          expectedEntityType,
          new Map(),
          {
            requiredWeaponFamily,
          },
        );
      }
    }
    if (fallbackProfileID) {
      return buildDefinitionsForProfile(
        {
          success: true,
          data: {
            profileID: fallbackProfileID,
          },
        },
        requestedAmount,
        expectedEntityType,
        {
          requiredWeaponFamily,
        },
      );
    }
  }

  const profileResolution = resolveNpcProfile(trimmedQuery, "");
  const poolResolution = resolveNpcSpawnPool(trimmedQuery, "");
  const profileSuccess = profileResolution.success && profileResolution.data;
  const poolSuccess = poolResolution.success && poolResolution.data;

  if (profileSuccess && !poolSuccess) {
    return buildDefinitionsForProfile(
      profileResolution,
      requestedAmount,
      expectedEntityType,
      {
        requiredWeaponFamily,
      },
    );
  }
  if (poolSuccess && !profileSuccess) {
    return buildDefinitionsForPool(
      poolResolution.data,
      requestedAmount,
      expectedEntityType,
      new Map(),
      {
        requiredWeaponFamily,
      },
    );
  }
  if (profileSuccess && poolSuccess) {
    if (profileResolution.matchKind === "exact" && poolResolution.matchKind !== "exact") {
      return buildDefinitionsForProfile(
        profileResolution,
        requestedAmount,
        expectedEntityType,
        {
          requiredWeaponFamily,
        },
      );
    }
    if (poolResolution.matchKind === "exact" && profileResolution.matchKind !== "exact") {
      return buildDefinitionsForPool(
        poolResolution.data,
        requestedAmount,
        expectedEntityType,
        new Map(),
        {
          requiredWeaponFamily,
        },
      );
    }
    if (options.preferPools === true) {
      return buildDefinitionsForPool(
        poolResolution.data,
        requestedAmount,
        expectedEntityType,
        new Map(),
        {
          requiredWeaponFamily,
        },
      );
    }
    return buildDefinitionsForProfile(
      profileResolution,
      requestedAmount,
      expectedEntityType,
      {
        requiredWeaponFamily,
      },
    );
  }

  const profileSuggestions = profileResolution.suggestions || [];
  const poolSuggestions = poolResolution.suggestions || [];
  const errorMsg =
    profileResolution.errorMsg === "PROFILE_AMBIGUOUS" ||
    poolResolution.errorMsg === "PROFILE_AMBIGUOUS"
      ? "PROFILE_AMBIGUOUS"
      : "PROFILE_NOT_FOUND";
  return {
    success: false,
    errorMsg,
    suggestions: dedupeSuggestions([
      ...profileSuggestions,
      ...poolSuggestions,
    ]),
  };
}

module.exports = {
  resolveNpcSpawnPlan,
  buildDefinitionsForSpawnGroup,
  resolveNpcSpawnGroupPlan,
};
