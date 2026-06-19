const {
  CAPITAL_NPC_AUTHORITY,
} = require("./capitalNpcAuthority");

const NPC_TABLE = Object.freeze({
  PROFILES: "npcProfiles",
  LOADOUTS: "npcLoadouts",
  BEHAVIOR_PROFILES: "npcBehaviorProfiles",
  LOOT_TABLES: "npcLootTables",
  SPAWN_POOLS: "npcSpawnPools",
});

function normalizeQuery(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

const datasetCache = {
  rowsByTableName: null,
  poolTokens: null,
  profileTokens: null,
  rowsByID: null,
};

function buildProfileRow(authorityEntry) {
  return {
    profileID: authorityEntry.profileID,
    name: authorityEntry.name,
    description: authorityEntry.description,
    aliases: authorityEntry.aliases,
    entityType: "npc",
    shipTypeID: authorityEntry.shipTypeID,
    presentationTypeID: authorityEntry.shipTypeID,
    corporationID: authorityEntry.faction.corporationID,
    allianceID: 0,
    factionID: authorityEntry.faction.factionID,
    behaviorProfileID: authorityEntry.behaviorProfile.behaviorProfileID,
    loadoutID: `${authorityEntry.profileID}_loadout`,
    lootTableID: `${authorityEntry.profileID}_loot`,
    shipNameTemplate: authorityEntry.name,
    securityStatus: -10,
    bounty: authorityEntry.bounty,
    spawnDistanceMeters: authorityEntry.spawnDistanceMeters,
    preferredTargetMode: "invoker",
    hardwareFamily: authorityEntry.faction.hardwareFamily,
    capitalClassID: authorityEntry.classID,
    capitalRarity: authorityEntry.rarity,
    capitalNpc: true,
    titanSuperweaponHullTypeID: authorityEntry.titanSuperweaponHullTypeID || null,
  };
}

function buildLoadoutRow(authorityEntry) {
  return {
    loadoutID: `${authorityEntry.profileID}_loadout`,
    name: authorityEntry.shortName,
    modules: authorityEntry.loadout.modules,
    charges: authorityEntry.loadout.charges,
    cargo: authorityEntry.loadout.cargo,
  };
}

function buildLootTableRow(authorityEntry) {
  return {
    lootTableID: `${authorityEntry.profileID}_loot`,
    ...authorityEntry.lootTable,
  };
}

function buildPoolRow(spawnPoolID, name, description, aliases, entries) {
  return {
    spawnPoolID,
    name,
    description,
    aliases,
    entityType: "npc",
    entries,
  };
}

function buildCommandTokenIndex(rows, idFieldName, extraAliasesByID = {}) {
  const exact = new Map();
  const ordered = [];
  for (const row of rows) {
    const id = String(row && row[idFieldName] || "").trim();
    if (!id) {
      continue;
    }
    const aliases = [
      id,
      row && row.name,
      ...(Array.isArray(row && row.aliases) ? row.aliases : []),
      ...(Array.isArray(extraAliasesByID[id]) ? extraAliasesByID[id] : []),
    ]
      .map((entry) => normalizeQuery(entry))
      .filter(Boolean);
    ordered.push({
      id,
      name: row && row.name,
      aliases,
    });
    for (const alias of aliases) {
      if (!exact.has(alias)) {
        exact.set(alias, { id, name: row && row.name });
      }
    }
  }
  return { exact, ordered };
}

function buildCapitalPools() {
  const allEntries = CAPITAL_NPC_AUTHORITY.map((entry) => ({
    profileID: entry.profileID,
    weight: entry.classID === "titan" ? 1 : entry.classID === "supercarrier" ? 2 : 3,
  }));
  const byFaction = new Map();
  const byClass = new Map();

  for (const authorityEntry of CAPITAL_NPC_AUTHORITY) {
    const factionID = authorityEntry.faction.id;
    const classID = authorityEntry.classID;
    if (!byFaction.has(factionID)) {
      byFaction.set(factionID, []);
    }
    if (!byClass.has(classID)) {
      byClass.set(classID, []);
    }
    const weightedEntry = {
      profileID: authorityEntry.profileID,
      weight: authorityEntry.classID === "titan" ? 1 : authorityEntry.classID === "supercarrier" ? 2 : 3,
    };
    byFaction.get(factionID).push(weightedEntry);
    byClass.get(classID).push(weightedEntry);
  }

  const rows = [
    buildPoolRow(
      "capital_npc_all",
      "Capital NPCs",
      "All authored pirate and rogue-drone capital NPCs.",
      ["capitals", "capital", "all capitals", "all cap npcs"],
      allEntries,
    ),
    buildPoolRow(
      "capital_npc_dreadnoughts",
      "Capital Dreadnoughts",
      "All authored pirate dreadnought NPCs.",
      ["dreads", "dreadnoughts", "capital dreads"],
      byClass.get("dreadnought") || [],
    ),
    buildPoolRow(
      "capital_npc_titans",
      "Capital Titans",
      "All authored pirate titan NPCs.",
      ["titans", "capital titans"],
      byClass.get("titan") || [],
    ),
    buildPoolRow(
      "capital_npc_supercarriers",
      "Capital Supercarriers",
      "All authored capital carrier and supercarrier NPCs.",
      ["supers", "supercarriers", "capital supers"],
      byClass.get("supercarrier") || [],
    ),
  ];

  const seenFaction = new Set();
  for (const authorityEntry of CAPITAL_NPC_AUTHORITY) {
    const factionID = authorityEntry.faction.id;
    if (seenFaction.has(factionID)) {
      continue;
    }
    seenFaction.add(factionID);
    rows.push(
      buildPoolRow(
        `capital_npc_${factionID}`,
        `${authorityEntry.faction.name} Capitals`,
        `${authorityEntry.faction.name} capital NPC pool.`,
        [
          `${authorityEntry.faction.name.toLowerCase()} capitals`,
          `${factionID} capitals`,
          `${factionID} capital`,
        ],
        byFaction.get(factionID) || [],
      ),
    );
  }
  return rows;
}

function getCapitalNpcDataset() {
  if (datasetCache.rowsByTableName) {
    return datasetCache;
  }

  const rowsByTableName = Object.freeze({
    [NPC_TABLE.PROFILES]: Object.freeze(CAPITAL_NPC_AUTHORITY.map(buildProfileRow)),
    [NPC_TABLE.LOADOUTS]: Object.freeze(CAPITAL_NPC_AUTHORITY.map(buildLoadoutRow)),
    [NPC_TABLE.BEHAVIOR_PROFILES]: Object.freeze(CAPITAL_NPC_AUTHORITY.map((entry) => entry.behaviorProfile)),
    [NPC_TABLE.LOOT_TABLES]: Object.freeze(CAPITAL_NPC_AUTHORITY.map(buildLootTableRow)),
    [NPC_TABLE.SPAWN_POOLS]: Object.freeze(buildCapitalPools()),
  });

  const extraPoolAliasesByID = {
    capital_npc_all: ["capnpc"],
    capital_npc_blood: ["blood", "blood raiders", "blood capital", "blood capitals"],
    capital_npc_serpentis: ["serpentis", "shadow serpentis", "serpentis capital"],
    capital_npc_guristas: ["guristas", "dread guristas", "guristas capital"],
    capital_npc_angels: ["angels", "angel cartel", "domination", "angel capital"],
    capital_npc_sanshas: ["sansha", "sanshas", "true sansha", "sansha capital"],
    capital_npc_rogueDrones: ["rogue", "rogue drones", "rogue drone", "rogue capital"],
  };
  const extraProfileAliasesByID = Object.fromEntries(
    CAPITAL_NPC_AUTHORITY.map((entry) => [
      entry.profileID,
      [entry.shortName, entry.name, `${entry.faction.id} ${entry.classID}`],
    ]),
  );

  datasetCache.rowsByTableName = rowsByTableName;
  datasetCache.poolTokens = buildCommandTokenIndex(
    rowsByTableName[NPC_TABLE.SPAWN_POOLS],
    "spawnPoolID",
    extraPoolAliasesByID,
  );
  datasetCache.profileTokens = buildCommandTokenIndex(
    rowsByTableName[NPC_TABLE.PROFILES],
    "profileID",
    extraProfileAliasesByID,
  );
  datasetCache.rowsByID = Object.freeze({
    profiles: new Map(
      rowsByTableName[NPC_TABLE.PROFILES].map((row) => [row.profileID, row]),
    ),
    spawnPools: new Map(
      rowsByTableName[NPC_TABLE.SPAWN_POOLS].map((row) => [row.spawnPoolID, row]),
    ),
    authority: new Map(
      CAPITAL_NPC_AUTHORITY.map((row) => [row.profileID, row]),
    ),
  });
  return datasetCache;
}

function getCapitalNpcGeneratedRows(tableName) {
  return getCapitalNpcDataset().rowsByTableName[tableName] || [];
}

function resolveCapitalNpcCommandQuery(query = "") {
  const dataset = getCapitalNpcDataset();
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return {
      success: true,
      data: { kind: "pool", id: "capital_npc_all" },
      suggestions: [],
    };
  }

  const exactPool = dataset.poolTokens.exact.get(normalizedQuery) || null;
  if (exactPool) {
    return {
      success: true,
      data: { kind: "pool", id: exactPool.id },
      suggestions: [],
    };
  }

  const exactProfile = dataset.profileTokens.exact.get(normalizedQuery) || null;
  if (exactProfile) {
    return {
      success: true,
      data: { kind: "profile", id: exactProfile.id },
      suggestions: [],
    };
  }

  const suggestions = [];
  for (const entry of [...dataset.poolTokens.ordered, ...dataset.profileTokens.ordered]) {
    if (!entry.aliases.some((alias) => alias.includes(normalizedQuery))) {
      continue;
    }
    suggestions.push(`${entry.name} (${entry.id})`);
    if (suggestions.length >= 8) {
      break;
    }
  }

  return {
    success: false,
    errorMsg: suggestions.length > 0 ? "PROFILE_AMBIGUOUS" : "PROFILE_NOT_FOUND",
    suggestions,
  };
}

function listCapitalNpcAuthority() {
  return CAPITAL_NPC_AUTHORITY.map((entry) => cloneValue(entry));
}

function getCapitalNpcProfileRow(profileID) {
  return getCapitalNpcDataset().rowsByID.profiles.get(String(profileID || "").trim()) || null;
}

function getCapitalNpcSpawnPoolRow(spawnPoolID) {
  return getCapitalNpcDataset().rowsByID.spawnPools.get(String(spawnPoolID || "").trim()) || null;
}

function getCapitalNpcAuthorityEntry(profileID) {
  return getCapitalNpcDataset().rowsByID.authority.get(String(profileID || "").trim()) || null;
}

module.exports = {
  NPC_TABLE,
  getCapitalNpcDataset,
  getCapitalNpcGeneratedRows,
  resolveCapitalNpcCommandQuery,
  listCapitalNpcAuthority,
  getCapitalNpcProfileRow,
  getCapitalNpcSpawnPoolRow,
  getCapitalNpcAuthorityEntry,
};
