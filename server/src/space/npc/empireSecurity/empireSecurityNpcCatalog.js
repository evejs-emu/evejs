const {
  EVERMORE_CUSTOMS_CORPORATION_ID,
  EVERMORE_CUSTOMS_LOADOUT_ID,
  EVERMORE_CUSTOMS_MAJOR_PROFILE_ID,
  EVERMORE_CUSTOMS_MAJOR_TYPE_ID,
  EVERMORE_CUSTOMS_OFFICIAL_PROFILE_ID,
  EVERMORE_CUSTOMS_OFFICIAL_TYPE_ID,
  EVERMORE_CUSTOMS_SPAWN_GROUP_ID,
  EVERMORE_FACTION_ID,
} = require("../../empireGatePresence/everMoreGatePresence");

const NPC_TABLE = Object.freeze({
  PROFILES: "npcProfiles",
  LOADOUTS: "npcLoadouts",
  SPAWN_GROUPS: "npcSpawnGroups",
});

const PASSIVE_SECURITY_BEHAVIOR_ID = "npc_passive_idle";
const GENERIC_LOOT_TABLE_ID = "generic_random_any";

function buildSpawnGroup(spawnGroupID, name, description, entityType, entries, aliases = []) {
  return {
    spawnGroupID,
    name,
    description,
    aliases,
    entityType,
    entries,
  };
}

function buildEverMoreGatePresenceRows() {
  const profileBase = {
    description:
      "TQ-observed EverMore/Villore Sec Ops gate-presence profile for Jita-style stargate security.",
    aliases: [],
    entityType: "concord",
    corporationID: EVERMORE_CUSTOMS_CORPORATION_ID,
    allianceID: 0,
    factionID: EVERMORE_FACTION_ID,
    behaviorProfileID: PASSIVE_SECURITY_BEHAVIOR_ID,
    loadoutID: EVERMORE_CUSTOMS_LOADOUT_ID,
    lootTableID: GENERIC_LOOT_TABLE_ID,
    securityStatus: 5,
    bounty: 0,
    spawnDistanceMeters: 16_000,
    preferredTargetMode: "none",
    hardwareFamily: "concord",
    hostileResponseThreshold: -11,
    friendlyResponseThreshold: -11,
  };

  return {
    profiles: [
      {
        ...profileBase,
        profileID: EVERMORE_CUSTOMS_MAJOR_PROFILE_ID,
        name: "EverMore Customs Major",
        presentationTypeID: EVERMORE_CUSTOMS_MAJOR_TYPE_ID,
        shipTypeID: EVERMORE_CUSTOMS_MAJOR_TYPE_ID,
        shipNameTemplate: "EverMore Customs Major",
        aliases: ["evermore customs major", "villore sec ops customs major"],
      },
      {
        ...profileBase,
        profileID: EVERMORE_CUSTOMS_OFFICIAL_PROFILE_ID,
        name: "EverMore Customs Official",
        presentationTypeID: EVERMORE_CUSTOMS_OFFICIAL_TYPE_ID,
        shipTypeID: EVERMORE_CUSTOMS_OFFICIAL_TYPE_ID,
        shipNameTemplate: "EverMore Customs Official",
        aliases: ["evermore customs official", "villore sec ops customs official"],
      },
    ],
    loadouts: [
      {
        loadoutID: EVERMORE_CUSTOMS_LOADOUT_ID,
        name: "EverMore Gate Customs Observed Empty Loadout",
        modules: [],
        charges: [],
      },
    ],
    spawnGroups: [
      buildSpawnGroup(
        EVERMORE_CUSTOMS_SPAWN_GROUP_ID,
        "EverMore Gate Customs",
        "TQ-observed EverMore/Villore Sec Ops Jita-style customs chain for configured high-security stargates.",
        "concord",
        [
          {
            profileID: EVERMORE_CUSTOMS_MAJOR_PROFILE_ID,
            count: 2,
          },
          {
            profileID: EVERMORE_CUSTOMS_OFFICIAL_PROFILE_ID,
            count: 2,
          },
        ],
        ["evermore customs", "villore sec ops customs", "jita gate customs"],
      ),
    ],
  };
}

function buildGeneratedRows() {
  const everMoreRows = buildEverMoreGatePresenceRows();
  return Object.freeze({
    [NPC_TABLE.PROFILES]: Object.freeze(everMoreRows.profiles),
    [NPC_TABLE.LOADOUTS]: Object.freeze(everMoreRows.loadouts),
    [NPC_TABLE.SPAWN_GROUPS]: Object.freeze(everMoreRows.spawnGroups),
  });
}

let cachedRowsByTableName = null;

function getEmpireSecurityGeneratedRows(tableName) {
  if (!cachedRowsByTableName) {
    cachedRowsByTableName = buildGeneratedRows();
  }
  return cachedRowsByTableName[tableName] || [];
}

module.exports = {
  getEmpireSecurityGeneratedRows,
};
