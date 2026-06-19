const path = require("path");

const {
  resolveItemByTypeID,
} = require(path.join(
  __dirname,
  "../../../services/inventory/itemTypeRegistry",
));
const {
  TABLE: REFERENCE_TABLE,
  readStaticRows,
} = require(path.join(
  __dirname,
  "../../../services/_shared/referenceData",
));
const trigDrifterSpawnAuthority = require(path.join(
  __dirname,
  "./trigDrifterSpawnAuthority",
));

const NPC_TABLE = Object.freeze({
  PROFILES: "npcProfiles",
  LOADOUTS: "npcLoadouts",
  BEHAVIOR_PROFILES: "npcBehaviorProfiles",
  LOOT_TABLES: "npcLootTables",
  SPAWN_POOLS: "npcSpawnPools",
  SPAWN_GROUPS: "npcSpawnGroups",
  SPAWN_SITES: "npcSpawnSites",
  STARTUP_RULES: "npcStartupRules",
});

const TRIG_CORPORATION_ID = 1000298;
const TRIG_FACTION_ID = 500026;
const DRIFTER_CORPORATION_ID = 1000274;
const DRIFTER_FACTION_ID = 500024;
const POCHVEN_REGION_ID = 10000070;
const POCHVEN_SYSTEM_FAMILY = Object.freeze({
  BORDER: "border",
  INTERNAL: "internal",
  HOME: "home",
});
const POCHVEN_HOME_SYSTEM_NAMES = Object.freeze([
  "Archee",
  "Kino",
  "Niarja",
]);
const POCHVEN_BORDER_SYSTEM_NAMES = Object.freeze([
  "Ahtila",
  "Arvasaras",
  "Otanuomi",
  "Sakenta",
  "Senda",
  "Urhinichi",
]);
const POCHVEN_HOME_NAME_SET = new Set(
  POCHVEN_HOME_SYSTEM_NAMES.map((name) => String(name).trim().toLowerCase()),
);
const POCHVEN_BORDER_NAME_SET = new Set(
  POCHVEN_BORDER_SYSTEM_NAMES.map((name) => String(name).trim().toLowerCase()),
);
const GATE_PATROL_ANCHOR = Object.freeze({
  kind: "stargate",
  distanceFromSurfaceMeters: 22_000,
  spreadMeters: 7_000,
  formationSpacingMeters: 2_000,
});
const STATION_PRESENCE_ANCHOR = Object.freeze({
  kind: "station",
  distanceFromSurfaceMeters: 18_000,
  spreadMeters: 4_000,
  formationSpacingMeters: 1_800,
});
const DRIFTER_SIGNATURE_ANCHOR = Object.freeze({
  kind: "signatureSite",
  siteKind: "signature",
  distanceFromSurfaceMeters: 18_000,
  spreadMeters: 6_000,
  formationSpacingMeters: 1_600,
});
const DRIFTER_SPACE_HIVE_LABELS = Object.freeze([
  "Sentinel Hive",
  "Barbican Hive",
  "Vidette Hive",
  "Conflux Hive",
  "Redoubt Hive",
]);

const TRIG_TYPE_IDS = Object.freeze({
  lightEntropicDisintegratorII: 47914,
  heavyEntropicDisintegratorII: 47918,
  supratidalEntropicDisintegratorII: 47922,
  ultratidalEntropicDisintegratorII: 92514,
  baryonExoticPlasmaS: 47924,
  baryonExoticPlasmaM: 47928,
  baryonExoticPlasmaL: 47932,
  baryonExoticPlasmaXL: 52916,
  warpScramblerII: 448,
  stasisWebifierII: 527,
  smallEnergyNeutralizerII: 13003,
  mediumEnergyNeutralizerII: 12267,
  heavyEnergyNeutralizerII: 12271,
  smallEnergyNosferatuII: 13001,
  mediumEnergyNosferatuII: 12259,
  heavyEnergyNosferatuII: 12263,
});

const TRIG_LOOT_TYPE_IDS = Object.freeze({
  surveyDatabase: 48121,
  decayedEntropicRadiationSinkMutaplasmid: 49735,
  gravidEntropicRadiationSinkMutaplasmid: 49736,
  unstableEntropicRadiationSinkMutaplasmid: 49737,
  calmElectricalFilament: 47765,
  calmExoticFilament: 47761,
  agitatedElectricalFilament: 47904,
  agitatedExoticFilament: 47888,
});

const DRIFTER_LOOT_TYPE_IDS = Object.freeze({
  sleeperDataLibrary: 30745,
  neuralNetworkAnalyzer: 30744,
  ancientCoordinatesDatabase: 30746,
  antikytheraElement: 34575,
});

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function capitalizeToken(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  return `${normalized[0].toUpperCase()}${normalized.slice(1)}`;
}

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function resolveRequiredTypeByTypeID(typeID) {
  const match = resolveItemByTypeID(toInt(typeID, 0));
  if (!match || !match.typeID) {
    throw new Error(`ITEM_RESOLVE_FAILED:${typeID}`);
  }
  return match;
}

function buildAliasSet(...values) {
  return [
    ...new Set(
      values
        .flatMap((value) => (
          Array.isArray(value)
            ? value
            : [value]
        ))
        .map((value) => normalizeToken(value))
        .filter(Boolean),
    ),
  ];
}

const TRIG_VARIANT_SPECS = Object.freeze([
  {
    key: "liminal_damavik",
    label: "Liminal Damavik",
    roleLabel: "Liminal",
    hullLabel: "Damavik",
    npcShipTypeID: 52182,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 6500,
    formationSpacingMeters: 120,
  },
  {
    key: "liminal_kikimora",
    label: "Liminal Kikimora",
    roleLabel: "Liminal",
    hullLabel: "Kikimora",
    npcShipTypeID: 52185,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 6500,
    formationSpacingMeters: 120,
  },
  {
    key: "liminal_vedmak",
    label: "Liminal Vedmak",
    roleLabel: "Liminal",
    hullLabel: "Vedmak",
    npcShipTypeID: 52183,
    weaponTypeID: TRIG_TYPE_IDS.heavyEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaM,
    spawnDistanceMeters: 9000,
    formationSpacingMeters: 180,
  },
  {
    key: "liminal_rodiva",
    label: "Liminal Rodiva",
    roleLabel: "Liminal",
    hullLabel: "Rodiva",
    npcShipTypeID: 52186,
    weaponTypeID: TRIG_TYPE_IDS.heavyEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaM,
    spawnDistanceMeters: 9000,
    formationSpacingMeters: 180,
  },
  {
    key: "liminal_drekavac",
    label: "Liminal Drekavac",
    roleLabel: "Liminal",
    hullLabel: "Drekavac",
    npcShipTypeID: 52187,
    weaponTypeID: TRIG_TYPE_IDS.heavyEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaM,
    spawnDistanceMeters: 9000,
    formationSpacingMeters: 180,
  },
  {
    key: "liminal_leshak",
    label: "Liminal Leshak",
    roleLabel: "Liminal",
    hullLabel: "Leshak",
    npcShipTypeID: 52184,
    weaponTypeID: TRIG_TYPE_IDS.supratidalEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaL,
    spawnDistanceMeters: 12000,
    formationSpacingMeters: 220,
  },
  {
    key: "liminal_zirnitra",
    label: "Liminal Zirnitra",
    roleLabel: "Liminal",
    hullLabel: "Zirnitra",
    npcShipTypeID: 52701,
    weaponTypeID: TRIG_TYPE_IDS.ultratidalEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaXL,
    spawnDistanceMeters: 16000,
    formationSpacingMeters: 260,
  },
  {
    key: "anchoring_damavik",
    label: "Anchoring Damavik",
    roleLabel: "Anchoring",
    hullLabel: "Damavik",
    npcShipTypeID: 52207,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 5500,
    formationSpacingMeters: 120,
    extraModuleTypeIDs: [TRIG_TYPE_IDS.warpScramblerII],
  },
  {
    key: "anchoring_kikimora",
    label: "Anchoring Kikimora",
    roleLabel: "Anchoring",
    hullLabel: "Kikimora",
    npcShipTypeID: 52213,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 5500,
    formationSpacingMeters: 120,
    extraModuleTypeIDs: [TRIG_TYPE_IDS.warpScramblerII],
  },
  {
    key: "starving_damavik",
    label: "Starving Damavik",
    roleLabel: "Starving",
    hullLabel: "Damavik",
    npcShipTypeID: 52205,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 5500,
    formationSpacingMeters: 120,
    extraModuleTypeIDs: [
      TRIG_TYPE_IDS.smallEnergyNeutralizerII,
      TRIG_TYPE_IDS.smallEnergyNosferatuII,
    ],
  },
  {
    key: "starving_vedmak",
    label: "Starving Vedmak",
    roleLabel: "Starving",
    hullLabel: "Vedmak",
    npcShipTypeID: 48087,
    weaponTypeID: TRIG_TYPE_IDS.heavyEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaM,
    spawnDistanceMeters: 8500,
    formationSpacingMeters: 180,
    extraModuleTypeIDs: [
      TRIG_TYPE_IDS.mediumEnergyNeutralizerII,
      TRIG_TYPE_IDS.mediumEnergyNosferatuII,
    ],
  },
  {
    key: "starving_drekavac",
    label: "Starving Drekavac",
    roleLabel: "Starving",
    hullLabel: "Drekavac",
    npcShipTypeID: 52234,
    weaponTypeID: TRIG_TYPE_IDS.heavyEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaM,
    spawnDistanceMeters: 8500,
    formationSpacingMeters: 180,
    extraModuleTypeIDs: [
      TRIG_TYPE_IDS.mediumEnergyNeutralizerII,
      TRIG_TYPE_IDS.mediumEnergyNosferatuII,
    ],
  },
  {
    key: "starving_leshak",
    label: "Starving Leshak",
    roleLabel: "Starving",
    hullLabel: "Leshak",
    npcShipTypeID: 48125,
    weaponTypeID: TRIG_TYPE_IDS.supratidalEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaL,
    spawnDistanceMeters: 11000,
    formationSpacingMeters: 220,
    extraModuleTypeIDs: [
      TRIG_TYPE_IDS.heavyEnergyNeutralizerII,
      TRIG_TYPE_IDS.heavyEnergyNosferatuII,
    ],
  },
  {
    key: "tangling_damavik",
    label: "Tangling Damavik",
    roleLabel: "Tangling",
    hullLabel: "Damavik",
    npcShipTypeID: 52232,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 5500,
    formationSpacingMeters: 120,
    extraModuleTypeIDs: [TRIG_TYPE_IDS.stasisWebifierII],
  },
  {
    key: "tangling_kikimora",
    label: "Tangling Kikimora",
    roleLabel: "Tangling",
    hullLabel: "Kikimora",
    npcShipTypeID: 52233,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 5500,
    formationSpacingMeters: 120,
    extraModuleTypeIDs: [TRIG_TYPE_IDS.stasisWebifierII],
  },
  {
    key: "tangling_leshak",
    label: "Tangling Leshak",
    roleLabel: "Tangling",
    hullLabel: "Leshak",
    npcShipTypeID: 48124,
    weaponTypeID: TRIG_TYPE_IDS.supratidalEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaL,
    spawnDistanceMeters: 11000,
    formationSpacingMeters: 220,
    extraModuleTypeIDs: [TRIG_TYPE_IDS.stasisWebifierII],
  },
  {
    key: "blinding_damavik",
    label: "Blinding Damavik",
    roleLabel: "Blinding",
    hullLabel: "Damavik",
    npcShipTypeID: 52209,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 6500,
    formationSpacingMeters: 120,
  },
  {
    key: "blinding_kikimora",
    label: "Blinding Kikimora",
    roleLabel: "Blinding",
    hullLabel: "Kikimora",
    npcShipTypeID: 52217,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 6500,
    formationSpacingMeters: 120,
  },
  {
    key: "blinding_leshak",
    label: "Blinding Leshak",
    roleLabel: "Blinding",
    hullLabel: "Leshak",
    npcShipTypeID: 52216,
    weaponTypeID: TRIG_TYPE_IDS.supratidalEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaL,
    spawnDistanceMeters: 12000,
    formationSpacingMeters: 220,
  },
  {
    key: "harrowing_damavik",
    label: "Harrowing Damavik",
    roleLabel: "Harrowing",
    hullLabel: "Damavik",
    npcShipTypeID: 52206,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 6500,
    formationSpacingMeters: 120,
  },
  {
    key: "harrowing_kikimora",
    label: "Harrowing Kikimora",
    roleLabel: "Harrowing",
    hullLabel: "Kikimora",
    npcShipTypeID: 52212,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 6500,
    formationSpacingMeters: 120,
  },
  {
    key: "harrowing_vedmak",
    label: "Harrowing Vedmak",
    roleLabel: "Harrowing",
    hullLabel: "Vedmak",
    npcShipTypeID: 52211,
    weaponTypeID: TRIG_TYPE_IDS.heavyEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaM,
    spawnDistanceMeters: 9000,
    formationSpacingMeters: 180,
  },
  {
    key: "ghosting_damavik",
    label: "Ghosting Damavik",
    roleLabel: "Ghosting",
    hullLabel: "Damavik",
    npcShipTypeID: 52210,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 6500,
    formationSpacingMeters: 120,
  },
  {
    key: "ghosting_kikimora",
    label: "Ghosting Kikimora",
    roleLabel: "Ghosting",
    hullLabel: "Kikimora",
    npcShipTypeID: 56151,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 6500,
    formationSpacingMeters: 120,
  },
  {
    key: "ghosting_drekavac",
    label: "Ghosting Drekavac",
    roleLabel: "Ghosting",
    hullLabel: "Drekavac",
    npcShipTypeID: 52218,
    weaponTypeID: TRIG_TYPE_IDS.heavyEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaM,
    spawnDistanceMeters: 9000,
    formationSpacingMeters: 180,
  },
  {
    key: "renewing_damavik",
    label: "Renewing Damavik",
    roleLabel: "Renewing",
    hullLabel: "Damavik",
    npcShipTypeID: 52208,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 6500,
    formationSpacingMeters: 120,
  },
  {
    key: "renewing_rodiva",
    label: "Renewing Rodiva",
    roleLabel: "Renewing",
    hullLabel: "Rodiva",
    npcShipTypeID: 52214,
    weaponTypeID: TRIG_TYPE_IDS.heavyEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaM,
    spawnDistanceMeters: 9000,
    formationSpacingMeters: 180,
  },
  {
    key: "renewing_leshak",
    label: "Renewing Leshak",
    roleLabel: "Renewing",
    hullLabel: "Leshak",
    npcShipTypeID: 52215,
    weaponTypeID: TRIG_TYPE_IDS.supratidalEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaL,
    spawnDistanceMeters: 12000,
    formationSpacingMeters: 220,
  },
]);

const DRIFTER_VARIANT_SPECS = Object.freeze([
  {
    key: "hopilite",
    label: "Drifter Hopilite",
    shipTypeID: 88153,
    spawnDistanceMeters: 12_000,
    aliases: ["hoplite", "hopilite", "frigate"],
  },
  {
    key: "cruiser",
    label: "Drifter Cruiser",
    shipTypeID: 47153,
    spawnDistanceMeters: 18_000,
    aliases: ["cruiser"],
  },
  {
    key: "strike_cruiser",
    label: "Drifter Strike Cruiser",
    shipTypeID: 47722,
    spawnDistanceMeters: 18_000,
    aliases: ["strike cruiser", "strikecruiser"],
  },
  {
    key: "entanglement",
    label: "Drifter Entanglement Cruiser",
    shipTypeID: 47958,
    spawnDistanceMeters: 18_000,
    aliases: ["entanglement cruiser", "entanglement"],
  },
  {
    key: "nullwarp",
    label: "Drifter Nullwarp Cruiser",
    shipTypeID: 47959,
    spawnDistanceMeters: 18_000,
    aliases: ["nullwarp cruiser", "nullwarp"],
  },
  {
    key: "nullcharge",
    label: "Drifter Nullcharge Cruiser",
    shipTypeID: 47960,
    spawnDistanceMeters: 18_000,
    aliases: ["nullcharge cruiser", "nullcharge"],
  },
  {
    key: "navarkos",
    label: "Drifter Navarkos Cruiser",
    shipTypeID: 56220,
    spawnDistanceMeters: 18_000,
    aliases: ["navarkos cruiser", "navarkos"],
  },
  {
    key: "assault",
    label: "Drifter Assault Cruiser",
    shipTypeID: 56221,
    spawnDistanceMeters: 18_000,
    aliases: ["assault cruiser", "assault"],
  },
  {
    key: "scout",
    label: "Drifter Scout Cruiser",
    shipTypeID: 56222,
    spawnDistanceMeters: 18_000,
    aliases: ["scout cruiser", "scout"],
  },
  {
    key: "battleship",
    label: "Drifter Battleship",
    shipTypeID: 34495,
    spawnDistanceMeters: 22_000,
    aliases: ["battleship"],
  },
  {
    key: "response",
    label: "Drifter Response Battleship",
    shipTypeID: 37473,
    spawnDistanceMeters: 22_000,
    aliases: ["response battleship", "response"],
  },
  {
    key: "recon",
    label: "Drifter Recon Battleship",
    shipTypeID: 86498,
    spawnDistanceMeters: 22_000,
    aliases: ["recon battleship", "recon"],
  },
  {
    key: "commander",
    label: "Drifter Strike Commander",
    shipTypeID: 47724,
    spawnDistanceMeters: 22_000,
    behaviorFamily: "commander",
    aliases: ["command", "commander", "strike commander"],
  },
  {
    key: "polemarkos",
    label: "Drifter Polemarkos Battleship",
    shipTypeID: 56217,
    spawnDistanceMeters: 22_000,
    aliases: ["polemarkos battleship", "polemarkos"],
  },
  {
    key: "raider",
    label: "Drifter Raider Battleship",
    shipTypeID: 56219,
    spawnDistanceMeters: 22_000,
    aliases: ["raider battleship", "raider"],
  },
  {
    key: "tyrannos",
    label: "Ladon Tyrannos",
    shipTypeID: 87612,
    spawnDistanceMeters: 22_000,
    aliases: ["tyrannos", "ladon", "ladon tyrannos"],
  },
  {
    key: "strategos",
    label: "Strategos Dreadnought",
    shipTypeID: 88154,
    spawnDistanceMeters: 28_000,
    aliases: ["strategos", "dread", "dreadnought", "strategos dreadnought"],
  },
  {
    key: "lancer",
    label: "Autothysian Lancer",
    shipTypeID: 34337,
    spawnDistanceMeters: 18_000,
    aliases: ["lancer", "autothysian lancer"],
    reinforcementVariantKey: "battleship",
    reinforcementAmount: 1,
  },
]);

const datasetCache = {
  rowsByTableName: null,
};

const DRIFTER_BEHAVIOR_FAMILY = Object.freeze({
  DEFAULT: "default",
  COMMANDER: "commander",
  HIVE: "hive",
  ROAMING: "roaming",
  DUNGEON: "dungeon",
});

function buildTrigAuthorityVariant(spec) {
  return {
    ...spec,
    extraModuleTypeIDs: Array.isArray(spec.extraModuleTypeIDs)
      ? [...spec.extraModuleTypeIDs]
      : [],
    aliases: buildAliasSet(
      spec.label,
      spec.key,
      spec.roleLabel,
      spec.hullLabel,
      `${spec.roleLabel} ${spec.hullLabel}`,
      `Triglavian ${spec.hullLabel}`,
    ),
  };
}

function buildDrifterAuthorityVariant(spec) {
  return {
    ...spec,
    spawnDistanceMeters: Math.max(1_000, toInt(spec.spawnDistanceMeters, 20_000)),
    behaviorFamily: String(spec.behaviorFamily || DRIFTER_BEHAVIOR_FAMILY.DEFAULT)
      .trim()
      .toLowerCase() || DRIFTER_BEHAVIOR_FAMILY.DEFAULT,
    aliases: buildAliasSet(
      spec.label,
      spec.key,
      `Drifter ${spec.key}`,
      spec.aliases,
    ),
  };
}

const TRIG_VARIANTS = Object.freeze(TRIG_VARIANT_SPECS.map(buildTrigAuthorityVariant));
const DRIFTER_VARIANTS = Object.freeze(DRIFTER_VARIANT_SPECS.map(buildDrifterAuthorityVariant));

function normalizeDrifterBehaviorFamily(value) {
  const normalizedValue = String(value || "")
    .trim()
    .toLowerCase();
  if (Object.values(DRIFTER_BEHAVIOR_FAMILY).includes(normalizedValue)) {
    return normalizedValue;
  }
  return DRIFTER_BEHAVIOR_FAMILY.DEFAULT;
}

function buildDrifterBehaviorProfile(variant, behaviorProfileID, reinforcementDefinitions = [], options = {}) {
  const family = normalizeDrifterBehaviorFamily(
    options.behaviorFamily || variant && variant.behaviorFamily,
  );
  const combatOrbitDistanceMeters = Math.max(
    1_000,
    toInt(
      options.orbitDistanceMeters,
      toInt(variant && variant.spawnDistanceMeters, 20_000),
    ),
  );
  const reinforcementEnabled =
    family === DRIFTER_BEHAVIOR_FAMILY.DEFAULT ||
    family === DRIFTER_BEHAVIOR_FAMILY.HIVE;
  const entosisPriorityEnabled = family === DRIFTER_BEHAVIOR_FAMILY.DEFAULT;
  const regroupEnabled =
    family === DRIFTER_BEHAVIOR_FAMILY.DEFAULT ||
    family === DRIFTER_BEHAVIOR_FAMILY.HIVE ||
    family === DRIFTER_BEHAVIOR_FAMILY.ROAMING;
  const pursuitEnabled = family === DRIFTER_BEHAVIOR_FAMILY.DEFAULT;
  const idleAnchorOrbit =
    family === DRIFTER_BEHAVIOR_FAMILY.COMMANDER ||
    family === DRIFTER_BEHAVIOR_FAMILY.DUNGEON;
  const effectiveReinforcementDefinitions = reinforcementEnabled
    ? reinforcementDefinitions
    : [];

  return {
    behaviorProfileID,
    movementMode: "orbit",
    orbitDistanceMeters: combatOrbitDistanceMeters,
    followRangeMeters: combatOrbitDistanceMeters,
    autoAggro: true,
    targetPreference: "preferredTargetThenNearestPlayer",
    aggressionRangeMeters: 250_000,
    autoActivateWeapons: true,
    returnToHomeWhenIdle: false,
    useChasePropulsion: false,
    idleAnchorOrbit,
    idleAnchorOrbitDistanceMeters: idleAnchorOrbit ? 10_000 : 0,
    drifterBehavior: true,
    drifterBehaviorFamily: family,
    drifterEnableReinforcements: reinforcementEnabled,
    drifterEnableEntosisPriority: entosisPriorityEnabled,
    drifterEnablePackRegroup: regroupEnabled,
    drifterEnablePursuitWarp: pursuitEnabled,
    reinforcementDefinitions: effectiveReinforcementDefinitions,
    reinforcementAggressionWindowMs: effectiveReinforcementDefinitions.length > 0 ? 15_000 : 0,
    reinforcementCooldownMs: effectiveReinforcementDefinitions.length > 0 ? 60_000 : 0,
    maxReinforcementCalls: effectiveReinforcementDefinitions.length > 0 ? 1 : 0,
    reinforcementSpawnDistanceMeters: effectiveReinforcementDefinitions.length > 0 ? 45_000 : 0,
    reinforcementFormationSpacingMeters: effectiveReinforcementDefinitions.length > 0 ? 2_000 : 0,
  };
}

function getTrigProfileID(variant) {
  return `parity_trig_${variant.key}`;
}

function getDrifterProfileID(variant) {
  return `parity_drifter_${variant.key}`;
}

function buildStackedLootEntry(typeID, quantity) {
  return {
    typeID: toInt(typeID, 0),
    minQuantity: Math.max(1, toInt(quantity, 1)),
    maxQuantity: Math.max(1, toInt(quantity, 1)),
    singleton: false,
  };
}

function buildWeightedLootEntry(typeID, weight, options = {}) {
  return {
    typeID: toInt(typeID, 0),
    weight: Math.max(1, toInt(weight, 1)),
    minQuantity: Math.max(1, toInt(options.minQuantity, 1)),
    maxQuantity: Math.max(
      Math.max(1, toInt(options.minQuantity, 1)),
      toInt(options.maxQuantity, Math.max(1, toInt(options.minQuantity, 1))),
    ),
    singleton: options.singleton === true ? true : false,
  };
}

function buildTrigLootTable(variant, lootTableID) {
  const hullLabel = normalizeToken(variant && variant.hullLabel);
  let guaranteedSurveyDatabases = 2;
  let weightedEntries = [
    buildWeightedLootEntry(TRIG_LOOT_TYPE_IDS.decayedEntropicRadiationSinkMutaplasmid, 3),
    buildWeightedLootEntry(TRIG_LOOT_TYPE_IDS.calmElectricalFilament, 2),
    buildWeightedLootEntry(TRIG_LOOT_TYPE_IDS.calmExoticFilament, 2),
  ];

  if (hullLabel === "damavik" || hullLabel === "kikimora") {
    guaranteedSurveyDatabases = 1;
  } else if (hullLabel === "vedmak" || hullLabel === "rodiva") {
    guaranteedSurveyDatabases = 2;
  } else if (hullLabel === "drekavac") {
    guaranteedSurveyDatabases = 3;
    weightedEntries = [
      buildWeightedLootEntry(TRIG_LOOT_TYPE_IDS.gravidEntropicRadiationSinkMutaplasmid, 3),
      buildWeightedLootEntry(TRIG_LOOT_TYPE_IDS.agitatedElectricalFilament, 2),
      buildWeightedLootEntry(TRIG_LOOT_TYPE_IDS.agitatedExoticFilament, 2),
    ];
  } else if (hullLabel === "leshak") {
    guaranteedSurveyDatabases = 4;
    weightedEntries = [
      buildWeightedLootEntry(TRIG_LOOT_TYPE_IDS.gravidEntropicRadiationSinkMutaplasmid, 3),
      buildWeightedLootEntry(TRIG_LOOT_TYPE_IDS.agitatedElectricalFilament, 2),
      buildWeightedLootEntry(TRIG_LOOT_TYPE_IDS.agitatedExoticFilament, 2),
    ];
  } else if (hullLabel === "zirnitra") {
    guaranteedSurveyDatabases = 6;
    weightedEntries = [
      buildWeightedLootEntry(TRIG_LOOT_TYPE_IDS.unstableEntropicRadiationSinkMutaplasmid, 3),
      buildWeightedLootEntry(TRIG_LOOT_TYPE_IDS.agitatedElectricalFilament, 2),
      buildWeightedLootEntry(TRIG_LOOT_TYPE_IDS.agitatedExoticFilament, 2),
    ];
  }

  return {
    lootTableID,
    name: `${variant.label} Loot`,
    description: `Generated conservative ${variant.label} wreck loot table backed by repo-owned Triglavian data-item, filament, and mutaplasmid rows.`,
    guaranteedEntries: [
      buildStackedLootEntry(
        TRIG_LOOT_TYPE_IDS.surveyDatabase,
        guaranteedSurveyDatabases,
      ),
    ],
    entries: weightedEntries,
    minEntries: 0,
    maxEntries: 1,
    allowDuplicates: false,
  };
}

function buildDrifterLootTable(variant, lootTableID) {
  const variantKey = String(variant && variant.key || "").trim().toLowerCase();
  let guaranteedSleeperLibraries = 2;
  let weightedEntries = [
    buildWeightedLootEntry(DRIFTER_LOOT_TYPE_IDS.neuralNetworkAnalyzer, 2),
    buildWeightedLootEntry(DRIFTER_LOOT_TYPE_IDS.antikytheraElement, 1),
  ];

  if (variantKey === "hopilite") {
    guaranteedSleeperLibraries = 1;
  } else if ([
    "cruiser",
    "strike_cruiser",
    "entanglement",
    "nullwarp",
    "nullcharge",
    "navarkos",
    "assault",
    "scout",
  ].includes(variantKey)) {
    guaranteedSleeperLibraries = 2;
    weightedEntries = [
      buildWeightedLootEntry(DRIFTER_LOOT_TYPE_IDS.neuralNetworkAnalyzer, 2),
      buildWeightedLootEntry(DRIFTER_LOOT_TYPE_IDS.ancientCoordinatesDatabase, 1),
      buildWeightedLootEntry(DRIFTER_LOOT_TYPE_IDS.antikytheraElement, 1),
    ];
  } else if (variantKey === "lancer") {
    guaranteedSleeperLibraries = 4;
    weightedEntries = [
      buildWeightedLootEntry(DRIFTER_LOOT_TYPE_IDS.antikytheraElement, 4),
      buildWeightedLootEntry(DRIFTER_LOOT_TYPE_IDS.ancientCoordinatesDatabase, 1),
    ];
  } else if ([
    "battleship",
    "response",
    "recon",
    "commander",
    "polemarkos",
    "raider",
    "tyrannos",
  ].includes(variantKey)) {
    guaranteedSleeperLibraries = 4;
    weightedEntries = [
      buildWeightedLootEntry(DRIFTER_LOOT_TYPE_IDS.ancientCoordinatesDatabase, 3),
      buildWeightedLootEntry(DRIFTER_LOOT_TYPE_IDS.antikytheraElement, 2),
      buildWeightedLootEntry(DRIFTER_LOOT_TYPE_IDS.neuralNetworkAnalyzer, 1),
    ];
  } else if (variantKey === "strategos") {
    guaranteedSleeperLibraries = 6;
    weightedEntries = [
      buildWeightedLootEntry(DRIFTER_LOOT_TYPE_IDS.ancientCoordinatesDatabase, 3),
      buildWeightedLootEntry(DRIFTER_LOOT_TYPE_IDS.antikytheraElement, 3),
    ];
  }

  return {
    lootTableID,
    name: `${variant.label} Loot`,
    description: `Generated conservative ${variant.label} wreck loot table backed by repo-owned Drifter blue-loot and Antikythera rows.`,
    guaranteedEntries: [
      buildStackedLootEntry(
        DRIFTER_LOOT_TYPE_IDS.sleeperDataLibrary,
        guaranteedSleeperLibraries,
      ),
    ],
    entries: weightedEntries,
    minEntries: 0,
    maxEntries: 1,
    allowDuplicates: false,
  };
}

function buildTrigDefinition(variant, options = {}) {
  const shipType = resolveRequiredTypeByTypeID(variant.npcShipTypeID);
  const weaponType = resolveRequiredTypeByTypeID(variant.weaponTypeID);
  const chargeType = resolveRequiredTypeByTypeID(variant.chargeTypeID);
  const profileID = String(options.profileID || getTrigProfileID(variant));
  const loadoutID = String(options.loadoutID || `${profileID}_loadout`);
  const behaviorProfileID = String(options.behaviorProfileID || `${profileID}_behavior`);
  const lootTableID = String(options.lootTableID || `${profileID}_loot`);
  return {
    profile: {
      profileID,
      name: variant.label,
      description: `${variant.label} generated parity profile for the native NPC authority path.`,
      aliases: variant.aliases,
      entityType: "npc",
      hardwareFamily: "triglavian",
      shipTypeID: shipType.typeID,
      presentationTypeID: shipType.typeID,
      corporationID: TRIG_CORPORATION_ID,
      allianceID: 0,
      factionID: TRIG_FACTION_ID,
      behaviorProfileID,
      loadoutID,
      lootTableID,
      shipNameTemplate: variant.label,
      securityStatus: -10,
      bounty: 0,
      spawnDistanceMeters: variant.spawnDistanceMeters,
      preferredTargetMode: "invoker",
    },
    loadout: {
      loadoutID,
      name: `${variant.label} Loadout`,
      modules: [
        {
          typeID: weaponType.typeID,
          quantity: 1,
          moduleRole: "weapon",
        },
        ...variant.extraModuleTypeIDs.map((moduleTypeID) => ({
          typeID: moduleTypeID,
          quantity: 1,
          moduleRole:
            moduleTypeID === TRIG_TYPE_IDS.warpScramblerII
              ? "tackle"
              : "hostileUtility",
        })),
      ],
      charges: [
        {
          typeID: chargeType.typeID,
          quantityPerModule: 100,
        },
      ],
      cargo: [],
    },
    behaviorProfile: {
      behaviorProfileID,
      movementMode: "orbit",
      orbitDistanceMeters: Math.max(1_000, toInt(variant.spawnDistanceMeters, 12_000)),
      followRangeMeters: Math.max(1_000, toInt(variant.spawnDistanceMeters, 12_000)),
      autoAggro: true,
      targetPreference: "preferredTargetThenNearestPlayer",
      aggressionRangeMeters: 200000,
      autoActivateWeapons: true,
      returnToHomeWhenIdle: false,
      useChasePropulsion: false,
      allowFriendlyNpcTargets: false,
    },
    lootTable: buildTrigLootTable(variant, lootTableID),
  };
}

function buildDrifterDefinition(variant, options = {}) {
  const profileID = String(options.profileID || getDrifterProfileID(variant));
  const loadoutID = String(options.loadoutID || `${profileID}_loadout`);
  const behaviorProfileID = String(options.behaviorProfileID || `${profileID}_behavior`);
  const lootTableID = String(options.lootTableID || `${profileID}_loot`);
  const reinforcementVariant = variant.reinforcementVariantKey
    ? DRIFTER_VARIANTS.find((candidate) => candidate.key === variant.reinforcementVariantKey) || null
    : null;
  const reinforcementDefinitions =
    reinforcementVariant && toInt(variant.reinforcementAmount, 0) > 0
      ? Array.from({ length: toInt(variant.reinforcementAmount, 0) }, (_, index) => {
        const nestedProfileID = `${profileID}_reinforcement_${index + 1}`;
        const nestedOptions = {
          profileID: nestedProfileID,
          loadoutID: `${nestedProfileID}_loadout`,
          behaviorProfileID: `${nestedProfileID}_behavior`,
        };
        if (Object.prototype.hasOwnProperty.call(options, "behaviorFamily")) {
          nestedOptions.behaviorFamily = options.behaviorFamily;
        }
        const definition = buildDrifterDefinition(reinforcementVariant, nestedOptions);
        return {
          ...definition,
          behaviorProfile: {
            ...(definition.behaviorProfile || {}),
            reinforcementDefinitions: [],
            maxReinforcementCalls: 0,
          },
        };
      })
      : [];
  return {
    profile: {
      profileID,
      name: variant.label,
      description: `${variant.label} generated parity profile for the native NPC authority path.`,
      aliases: variant.aliases,
      entityType: "npc",
      hardwareFamily: "drifterHarness",
      shipTypeID: variant.shipTypeID,
      presentationTypeID: variant.shipTypeID,
      corporationID: DRIFTER_CORPORATION_ID,
      allianceID: 0,
      factionID: DRIFTER_FACTION_ID,
      behaviorProfileID,
      loadoutID,
      lootTableID,
      shipNameTemplate: variant.label,
      securityStatus: -10,
      bounty: 0,
      spawnDistanceMeters: Math.max(1_000, toInt(variant.spawnDistanceMeters, 20_000)),
      preferredTargetMode: "invoker",
    },
    loadout: {
      loadoutID,
      name: `${variant.label} Loadout`,
      modules: [],
      charges: [],
      cargo: [],
    },
    behaviorProfile: {
      ...buildDrifterBehaviorProfile(
        variant,
        behaviorProfileID,
        reinforcementDefinitions,
        options,
      ),
    },
    lootTable: buildDrifterLootTable(variant, lootTableID),
  };
}

function getDrifterVariantByKey(variantKey) {
  const normalizedKey = String(variantKey || "").trim();
  return DRIFTER_VARIANTS.find((variant) => variant.key === normalizedKey) || null;
}

function buildDrifterFamilyProfileDefinition(variantKey, family) {
  const variant = getDrifterVariantByKey(variantKey);
  if (!variant) {
    throw new Error(`DRIFTER_VARIANT_NOT_FOUND:${variantKey}`);
  }
  const normalizedFamily = normalizeDrifterBehaviorFamily(family);
  const familyLabel = capitalizeToken(normalizedFamily);
  const baseProfileID = getDrifterProfileID(variant);
  const profileID = `parity_drifter_${normalizedFamily}_${variant.key}`;
  const behaviorProfileID = `${profileID}_behavior`;
  const definition = buildDrifterDefinition(variant, {
    profileID,
    loadoutID: `${baseProfileID}_loadout`,
    lootTableID: `${baseProfileID}_loot`,
    behaviorProfileID,
    behaviorFamily: normalizedFamily,
  });
  return {
    profile: {
      ...(definition.profile || {}),
      profileID,
      name: `${familyLabel} ${variant.label}`,
      description: `Generated ${normalizedFamily} ${variant.label} parity profile for explicit authored Drifter family authority on the shared native NPC path.`,
      aliases: buildAliasSet(
        `${familyLabel} ${variant.label}`,
        `${normalizedFamily} ${variant.label}`,
        `${normalizedFamily} ${variant.key}`,
        `${normalizedFamily} drifter ${variant.key}`,
      ),
    },
    behaviorProfile: {
      ...(definition.behaviorProfile || {}),
      behaviorProfileID,
    },
  };
}

function buildSpawnPoolRow(spawnPoolID, name, description, aliases, entries) {
  return {
    spawnPoolID,
    name,
    description,
    aliases,
    entityType: "npc",
    entries,
  };
}

function buildSpawnGroupRow(spawnGroupID, name, description, aliases, entries) {
  return {
    spawnGroupID,
    name,
    description,
    aliases,
    entityType: "npc",
    entries,
  };
}

function buildSpawnSiteRow(
  spawnSiteID,
  name,
  description,
  aliases,
  systemID,
  anchor,
  spawnGroupID,
  entityType = "npc",
) {
  return {
    spawnSiteID,
    name,
    description,
    aliases,
    entityType,
    systemID: toInt(systemID, 0),
    anchor: cloneValue(anchor),
    spawnGroupID: String(spawnGroupID || "").trim(),
  };
}

function buildStartupRuleRow(
  startupRuleID,
  name,
  description,
  aliases,
  scope,
  spawnGroupID,
  anchorSelector,
  options = {},
) {
  return {
    startupRuleID,
    name,
    description,
    aliases,
    generatedByAuthority: true,
    enabled: options.enabled !== false,
    entityType: String(options.entityType || "npc"),
    operatorKind: String(options.operatorKind || "").trim() || null,
    spawnGroupID: String(spawnGroupID || "").trim(),
    respawnEnabled: options.respawnEnabled !== false,
    respawnDelayMs: Math.max(1_000, toInt(options.respawnDelayMs, 30_000)),
    behaviorOverrides: cloneValue(options.behaviorOverrides || {}),
    anchorSelector: cloneValue(anchorSelector),
    groupsPerAnchor: Math.max(1, toInt(options.groupsPerAnchor, 1)),
    ...cloneValue(scope),
  };
}

function getTrigVariantByKey(variantKey) {
  const normalizedKey = String(variantKey || "").trim();
  return TRIG_VARIANTS.find((variant) => variant.key === normalizedKey) || null;
}

function buildNamedTrigPool(spawnPoolID, name, description, aliases, variantKeys) {
  const entries = variantKeys
    .map((variantKey) => getTrigVariantByKey(variantKey))
    .filter(Boolean)
    .map((variant) => ({
      profileID: getTrigProfileID(variant),
      weight: 1,
    }));
  if (entries.length <= 0) {
    return null;
  }
  return buildSpawnPoolRow(
    spawnPoolID,
    name,
    description,
    aliases,
    entries,
  );
}

function buildNamedDrifterPool(spawnPoolID, name, description, aliases, variantKeys) {
  const entries = variantKeys
    .map((variantKey) => getDrifterVariantByKey(variantKey))
    .filter(Boolean)
    .map((variant) => ({
      profileID: getDrifterProfileID(variant),
      weight: 1,
    }));
  if (entries.length <= 0) {
    return null;
  }
  return buildSpawnPoolRow(
    spawnPoolID,
    name,
    description,
    aliases,
    entries,
  );
}

function listPochvenSystems() {
  return readStaticRows(REFERENCE_TABLE.SOLAR_SYSTEMS)
    .filter((row) => toInt(row && row.regionID, 0) === POCHVEN_REGION_ID)
    .sort((left, right) => (
      toInt(left && left.solarSystemID, 0) - toInt(right && right.solarSystemID, 0)
    ));
}

function listPochvenStargates() {
  const pochvenSystemIDs = new Set(
    listPochvenSystems()
      .map((row) => toInt(row && row.solarSystemID, 0))
      .filter((systemID) => systemID > 0),
  );
  return readStaticRows(REFERENCE_TABLE.STARGATES)
    .filter((row) => pochvenSystemIDs.has(toInt(row && row.solarSystemID, 0)))
    .sort((left, right) => (
      toInt(left && left.solarSystemID, 0) - toInt(right && right.solarSystemID, 0) ||
      toInt(left && left.itemID, 0) - toInt(right && right.itemID, 0)
    ));
}

function listPochvenStations() {
  const pochvenSystemIDs = new Set(
    listPochvenSystems()
      .map((row) => toInt(row && row.solarSystemID, 0))
      .filter((systemID) => systemID > 0),
  );
  return readStaticRows(REFERENCE_TABLE.STATIONS)
    .filter((row) => pochvenSystemIDs.has(toInt(row && row.solarSystemID, 0)))
    .sort((left, right) => (
      toInt(left && left.solarSystemID, 0) - toInt(right && right.solarSystemID, 0) ||
      toInt(left && left.stationID, 0) - toInt(right && right.stationID, 0)
    ));
}

function getPochvenSystemFamily(systemName) {
  const normalizedSystemName = String(systemName || "").trim().toLowerCase();
  if (POCHVEN_HOME_NAME_SET.has(normalizedSystemName)) {
    return POCHVEN_SYSTEM_FAMILY.HOME;
  }
  if (POCHVEN_BORDER_NAME_SET.has(normalizedSystemName)) {
    return POCHVEN_SYSTEM_FAMILY.BORDER;
  }
  return POCHVEN_SYSTEM_FAMILY.INTERNAL;
}

function getPochvenPatrolGroupID(family) {
  switch (String(family || "").trim().toLowerCase()) {
    case POCHVEN_SYSTEM_FAMILY.HOME:
      return "parity_trig_pochven_home_gate_patrol";
    case POCHVEN_SYSTEM_FAMILY.BORDER:
      return "parity_trig_pochven_border_gate_patrol";
    default:
      return "parity_trig_pochven_internal_gate_patrol";
  }
}

function getPochvenStationGroupID(family) {
  switch (String(family || "").trim().toLowerCase()) {
    case POCHVEN_SYSTEM_FAMILY.HOME:
      return "parity_trig_pochven_home_station_presence";
    case POCHVEN_SYSTEM_FAMILY.BORDER:
      return "parity_trig_pochven_border_station_presence";
    default:
      return "parity_trig_pochven_internal_station_presence";
  }
}

function buildPochvenSystemRowsByFamily() {
  const rowsByFamily = {
    [POCHVEN_SYSTEM_FAMILY.BORDER]: [],
    [POCHVEN_SYSTEM_FAMILY.INTERNAL]: [],
    [POCHVEN_SYSTEM_FAMILY.HOME]: [],
  };
  for (const systemRow of listPochvenSystems()) {
    const family = getPochvenSystemFamily(systemRow && systemRow.solarSystemName);
    rowsByFamily[family].push(systemRow);
  }
  return rowsByFamily;
}

function buildPochvenGateSpawnSites() {
  const systemNameByID = new Map(
    listPochvenSystems().map((row) => [
      toInt(row && row.solarSystemID, 0),
      String(row && row.solarSystemName || "").trim() || `System ${row && row.solarSystemID}`,
    ]),
  );
  return listPochvenStargates().map((stargate) => {
    const systemID = toInt(stargate && stargate.solarSystemID, 0);
    const gateItemID = toInt(stargate && stargate.itemID, 0);
    const systemName = systemNameByID.get(systemID) || `System ${systemID}`;
    const family = getPochvenSystemFamily(systemName);
    const spawnGroupID = getPochvenPatrolGroupID(family);
    const gateName = String(stargate && stargate.itemName || "").trim() || `Gate ${gateItemID}`;
    return buildSpawnSiteRow(
      `parity_trig_pochven_gate_site_${gateItemID}`,
      `${systemName} ${gateName} Triglavian ${family[0].toUpperCase()}${family.slice(1)} Gate Patrol`,
      `Generated ${family} Pochven gate-side Triglavian patrol site for ${gateName} in ${systemName}.`,
      [
        systemName,
        gateName,
        `${family} pochven trig`,
        `${systemName} trig gate`,
        `${gateName} trig`,
        "pochven gate trig",
      ],
      systemID,
      {
        ...GATE_PATROL_ANCHOR,
        itemID: gateItemID,
        name: gateName,
      },
      spawnGroupID,
    );
  });
}

function buildPochvenStationSpawnSites() {
  const systemNameByID = new Map(
    listPochvenSystems().map((row) => [
      toInt(row && row.solarSystemID, 0),
      String(row && row.solarSystemName || "").trim() || `System ${row && row.solarSystemID}`,
    ]),
  );
  return listPochvenStations().map((station) => {
    const systemID = toInt(station && station.solarSystemID, 0);
    const stationID = toInt(station && station.stationID, 0);
    const systemName = systemNameByID.get(systemID) || `System ${systemID}`;
    const family = getPochvenSystemFamily(systemName);
    const spawnGroupID = getPochvenStationGroupID(family);
    const stationName = String(station && station.stationName || "").trim() || `Station ${stationID}`;
    return buildSpawnSiteRow(
      `parity_trig_pochven_station_site_${stationID}`,
      `${systemName} ${stationName} Triglavian ${family[0].toUpperCase()}${family.slice(1)} Station Presence`,
      `Generated ${family} Pochven station-side Triglavian presence site for ${stationName} in ${systemName} using repo-owned station anchors and the shared native NPC startup path.`,
      [
        systemName,
        stationName,
        `${family} pochven trig station`,
        `${systemName} trig station`,
        `${stationName} trig`,
        "pochven station trig",
      ],
      systemID,
      {
        ...STATION_PRESENCE_ANCHOR,
        itemID: stationID,
        name: stationName,
      },
      spawnGroupID,
    );
  });
}

function buildPochvenGateStartupRules() {
  const systemsByFamily = buildPochvenSystemRowsByFamily();
  return [
    {
      family: POCHVEN_SYSTEM_FAMILY.BORDER,
      startupRuleID: "parity_trig_pochven_border_gate_patrol_startup",
      name: "Triglavian Pochven Border Gate Patrol Startup",
      description: "Generated baseline natural Triglavian gate-side patrol startup for Pochven border systems using explicit stargate anchors and the shared native NPC startup path.",
      aliases: [
        "pochven border trig startup",
        "border gate trig startup",
      ],
      systemRows: systemsByFamily[POCHVEN_SYSTEM_FAMILY.BORDER],
      spawnGroupID: getPochvenPatrolGroupID(POCHVEN_SYSTEM_FAMILY.BORDER),
    },
    {
      family: POCHVEN_SYSTEM_FAMILY.INTERNAL,
      startupRuleID: "parity_trig_pochven_internal_gate_patrol_startup",
      name: "Triglavian Pochven Internal Gate Patrol Startup",
      description: "Generated baseline natural Triglavian gate-side patrol startup for Pochven internal systems using explicit stargate anchors and the shared native NPC startup path.",
      aliases: [
        "pochven internal trig startup",
        "internal gate trig startup",
      ],
      systemRows: systemsByFamily[POCHVEN_SYSTEM_FAMILY.INTERNAL],
      spawnGroupID: getPochvenPatrolGroupID(POCHVEN_SYSTEM_FAMILY.INTERNAL),
    },
    {
      family: POCHVEN_SYSTEM_FAMILY.HOME,
      startupRuleID: "parity_trig_pochven_home_gate_patrol_startup",
      name: "Triglavian Pochven Home Gate Patrol Startup",
      description: "Generated baseline natural Triglavian gate-side patrol startup for Pochven home systems using explicit stargate anchors and the shared native NPC startup path.",
      aliases: [
        "pochven home trig startup",
        "home gate trig startup",
      ],
      systemRows: systemsByFamily[POCHVEN_SYSTEM_FAMILY.HOME],
      spawnGroupID: getPochvenPatrolGroupID(POCHVEN_SYSTEM_FAMILY.HOME),
    },
  ].map((entry) => buildStartupRuleRow(
    entry.startupRuleID,
    entry.name,
    entry.description,
    [
      ...entry.aliases,
      `${entry.family} pochven trig patrol`,
    ],
    {
      systemIDs: entry.systemRows
        .map((row) => toInt(row && row.solarSystemID, 0))
        .filter((systemID) => systemID > 0),
    },
    entry.spawnGroupID,
    {
      ...GATE_PATROL_ANCHOR,
      kind: "stargate",
      mode: "each",
    },
    {
      enabled: true,
      entityType: "npc",
      operatorKind: "trigPochvenGatePatrol",
      respawnEnabled: true,
      respawnDelayMs:
        entry.family === POCHVEN_SYSTEM_FAMILY.HOME
          ? 20_000
          : entry.family === POCHVEN_SYSTEM_FAMILY.INTERNAL
            ? 25_000
            : 30_000,
      groupsPerAnchor: 1,
      behaviorOverrides: {
        autoAggro: true,
        autoAggroTargetClasses: ["player"],
        allowPodKill: false,
        returnToHomeWhenIdle: true,
        idleAnchorOrbit: true,
      },
    },
  ));
}

function buildPochvenStationStartupRules() {
  const systemsByFamily = buildPochvenSystemRowsByFamily();
  return [
    {
      family: POCHVEN_SYSTEM_FAMILY.BORDER,
      startupRuleID: "parity_trig_pochven_border_station_presence_startup",
      name: "Triglavian Pochven Border Station Presence Startup",
      description: "Generated baseline natural Triglavian station-side presence startup for Pochven border systems using explicit station anchors and the shared native NPC startup path.",
      aliases: [
        "pochven border trig station startup",
        "border station trig startup",
      ],
      systemRows: systemsByFamily[POCHVEN_SYSTEM_FAMILY.BORDER],
      spawnGroupID: getPochvenStationGroupID(POCHVEN_SYSTEM_FAMILY.BORDER),
    },
    {
      family: POCHVEN_SYSTEM_FAMILY.INTERNAL,
      startupRuleID: "parity_trig_pochven_internal_station_presence_startup",
      name: "Triglavian Pochven Internal Station Presence Startup",
      description: "Generated baseline natural Triglavian station-side presence startup for Pochven internal systems using explicit station anchors and the shared native NPC startup path.",
      aliases: [
        "pochven internal trig station startup",
        "internal station trig startup",
      ],
      systemRows: systemsByFamily[POCHVEN_SYSTEM_FAMILY.INTERNAL],
      spawnGroupID: getPochvenStationGroupID(POCHVEN_SYSTEM_FAMILY.INTERNAL),
    },
    {
      family: POCHVEN_SYSTEM_FAMILY.HOME,
      startupRuleID: "parity_trig_pochven_home_station_presence_startup",
      name: "Triglavian Pochven Home Station Presence Startup",
      description: "Generated baseline natural Triglavian station-side presence startup for Pochven home systems using explicit station anchors and the shared native NPC startup path.",
      aliases: [
        "pochven home trig station startup",
        "home station trig startup",
      ],
      systemRows: systemsByFamily[POCHVEN_SYSTEM_FAMILY.HOME],
      spawnGroupID: getPochvenStationGroupID(POCHVEN_SYSTEM_FAMILY.HOME),
    },
  ].map((entry) => buildStartupRuleRow(
    entry.startupRuleID,
    entry.name,
    entry.description,
    [
      ...entry.aliases,
      `${entry.family} pochven trig station`,
    ],
    {
      systemIDs: entry.systemRows
        .map((row) => toInt(row && row.solarSystemID, 0))
        .filter((systemID) => systemID > 0),
    },
    entry.spawnGroupID,
    {
      ...STATION_PRESENCE_ANCHOR,
      kind: "station",
      mode: "each",
    },
    {
      enabled: true,
      entityType: "npc",
      operatorKind: "trigPochvenStationPresence",
      respawnEnabled: true,
      respawnDelayMs:
        entry.family === POCHVEN_SYSTEM_FAMILY.HOME
          ? 20_000
          : entry.family === POCHVEN_SYSTEM_FAMILY.INTERNAL
            ? 25_000
            : 30_000,
      groupsPerAnchor: 1,
      behaviorOverrides: {
        autoAggro: false,
        targetPreference: "none",
        autoActivateWeapons: false,
        allowPodKill: false,
        returnToHomeWhenIdle: true,
        idleAnchorOrbit: true,
      },
    },
  ));
}

function getAuthoritySystemIDs(key) {
  return trigDrifterSpawnAuthority.getSystemList(key)
    .map((value) => toInt(value, 0))
    .filter((value) => value > 0);
}

function buildDefensiveDrifterSiteBehaviorOverrides(proximityRangeMeters) {
  const normalizedRange = Math.max(0, toInt(proximityRangeMeters, 0));
  return {
    autoAggro: false,
    targetPreference: "none",
    autoActivateWeapons: true,
    aggressionRangeMeters: normalizedRange,
    proximityAggroRangeMeters: normalizedRange,
    proximityAggroTargetClasses: ["player"],
    allowPodKill: true,
    returnToHomeWhenIdle: true,
    idleAnchorOrbit: true,
  };
}

function buildAggressiveDrifterSiteBehaviorOverrides(aggressionRangeMeters) {
  const normalizedRange = Math.max(0, toInt(aggressionRangeMeters, 0));
  return {
    autoAggro: true,
    autoAggroTargetClasses: ["player"],
    aggressionRangeMeters: normalizedRange,
    allowPodKill: true,
    returnToHomeWhenIdle: true,
    idleAnchorOrbit: true,
  };
}

function buildKnownSpaceDrifterStartupRules() {
  const observatorySystemIDs = getAuthoritySystemIDs("knownSpaceJoveObservatorySystemIDs");
  const wormholeSystemIDs = getAuthoritySystemIDs("knownSpaceUnidentifiedWormholeSystemIDs");
  const rules = [];

  if (observatorySystemIDs.length > 0) {
    rules.push(buildStartupRuleRow(
      "parity_drifter_known_space_observatory_presence_startup",
      "Drifter Known-Space Observatory Presence Startup",
      "Generated baseline Drifter observatory-side presence for known-space Jove Observatory systems using repo-owned observatory system authority and shared signature-site anchors.",
      [
        "drifter observatory startup",
        "known space drifter observatory startup",
        "jove observatory drifter startup",
      ],
      {
        systemIDs: observatorySystemIDs,
      },
      "parity_drifter_lancer_solo",
      {
        ...DRIFTER_SIGNATURE_ANCHOR,
        mode: "each",
        labelIncludesAny: ["jove observatory"],
      },
      {
        enabled: true,
        entityType: "npc",
        operatorKind: "drifterObservatoryPresence",
        respawnEnabled: true,
        respawnDelayMs: 45_000,
        groupsPerAnchor: 1,
        behaviorOverrides: buildDefensiveDrifterSiteBehaviorOverrides(60_000),
      },
    ));
  }

  if (wormholeSystemIDs.length > 0) {
    rules.push(buildStartupRuleRow(
      "parity_drifter_known_space_wormhole_presence_startup",
      "Drifter Known-Space Wormhole Presence Startup",
      "Generated baseline Drifter wormhole-side presence for known-space unidentified-wormhole systems using repo-owned observatory-derived system authority and shared signature-site anchors.",
      [
        "drifter wormhole startup",
        "known space drifter wormhole startup",
        "unidentified wormhole drifter startup",
      ],
      {
        systemIDs: wormholeSystemIDs,
      },
      "parity_drifter_lancer_response_screen",
      {
        ...DRIFTER_SIGNATURE_ANCHOR,
        mode: "each",
        labelIncludesAny: ["unidentified wormhole"],
      },
      {
        enabled: true,
        entityType: "npc",
        operatorKind: "drifterWormholePresence",
        respawnEnabled: true,
        respawnDelayMs: 30_000,
        groupsPerAnchor: 1,
        behaviorOverrides: buildDefensiveDrifterSiteBehaviorOverrides(80_000),
      },
    ));
  }

  return rules;
}

function buildDrifterSpaceHiveStartupRules() {
  const systemIDs = getAuthoritySystemIDs("drifterSpaceSystemIDs");
  if (systemIDs.length <= 0) {
    return [];
  }

  return [
    buildStartupRuleRow(
      "parity_drifter_space_hive_guard_startup",
      "Drifter-Space Hive Guard Startup",
      "Generated baseline Drifter-space hive-side guard presence for the five repo-owned Drifter systems using exact generated hive signature anchors and the shared native NPC startup path.",
      [
        "drifter hive startup",
        "drifter space hive startup",
        "sentinel hive drifter startup",
        "barbican hive drifter startup",
        "vidette hive drifter startup",
        "conflux hive drifter startup",
        "redoubt hive drifter startup",
      ],
      {
        systemIDs,
      },
      "parity_drifter_hive_guard_screen",
      {
        ...DRIFTER_SIGNATURE_ANCHOR,
        mode: "each",
        labelIncludesAny: DRIFTER_SPACE_HIVE_LABELS,
      },
      {
        enabled: true,
        entityType: "npc",
        operatorKind: "drifterHiveGuard",
        respawnEnabled: true,
        respawnDelayMs: 35_000,
        groupsPerAnchor: 1,
        behaviorOverrides: buildAggressiveDrifterSiteBehaviorOverrides(180_000),
      },
    ),
  ];
}

function buildRolePools(variants, familyPrefix) {
  const pools = [];
  const byRole = new Map();
  for (const variant of variants) {
    const roleKey = String(variant.roleLabel || "").trim().toLowerCase();
    if (!roleKey) {
      continue;
    }
    if (!byRole.has(roleKey)) {
      byRole.set(roleKey, []);
    }
    byRole.get(roleKey).push({
      profileID: getTrigProfileID(variant),
      weight: 1,
    });
  }
  for (const [roleKey, entries] of byRole.entries()) {
    pools.push(
      buildSpawnPoolRow(
        `${familyPrefix}_${roleKey}`,
        `Triglavian ${roleKey[0].toUpperCase()}${roleKey.slice(1)} Pool`,
        `Generated Triglavian ${roleKey} parity pool backed by verified native-path hull definitions.`,
        [`trig ${roleKey}`, roleKey, `${roleKey} triglavian`],
        entries,
      ),
    );
  }
  return pools;
}

function buildTrigDrifterDataset() {
  if (datasetCache.rowsByTableName) {
    return datasetCache.rowsByTableName;
  }

  const trigDefinitions = TRIG_VARIANTS.map((variant) => buildTrigDefinition(variant));
  const drifterDefinitions = DRIFTER_VARIANTS.map((variant) => buildDrifterDefinition(variant));
  const drifterFamilyDefinitions = [
    buildDrifterFamilyProfileDefinition("battleship", DRIFTER_BEHAVIOR_FAMILY.ROAMING),
    buildDrifterFamilyProfileDefinition("battleship", DRIFTER_BEHAVIOR_FAMILY.DUNGEON),
    buildDrifterFamilyProfileDefinition("battleship", DRIFTER_BEHAVIOR_FAMILY.HIVE),
    buildDrifterFamilyProfileDefinition("lancer", DRIFTER_BEHAVIOR_FAMILY.HIVE),
  ];

  const profiles = [
    ...trigDefinitions.map((definition) => definition.profile),
    ...drifterDefinitions.map((definition) => definition.profile),
    ...drifterFamilyDefinitions.map((definition) => definition.profile),
  ];
  const loadouts = [
    ...trigDefinitions.map((definition) => definition.loadout),
    ...drifterDefinitions.map((definition) => definition.loadout),
  ];
  const behaviorProfiles = [
    ...trigDefinitions.map((definition) => definition.behaviorProfile),
    ...drifterDefinitions.map((definition) => definition.behaviorProfile),
    ...drifterFamilyDefinitions.map((definition) => definition.behaviorProfile),
  ];
  const lootTables = [
    ...trigDefinitions.map((definition) => definition.lootTable),
    ...drifterDefinitions.map((definition) => definition.lootTable),
  ];

  const trigPools = [
    buildSpawnPoolRow(
      "parity_trig_all",
      "Triglavian Native Parity Pool",
      "All generated Triglavian hull variants currently proven on the native NPC path.",
      ["trig", "triglavians", "triglavian", "trig all"],
      TRIG_VARIANTS.map((variant) => ({
        profileID: getTrigProfileID(variant),
        weight: 1,
      })),
    ),
    ...buildRolePools(TRIG_VARIANTS, "parity_trig_role"),
    buildNamedTrigPool(
      "parity_trig_pochven_gate_tackle",
      "Pochven Gate Tackle Pool",
      "Generated baseline tackle pool for natural Pochven gate-side Trig patrols.",
      ["pochven tackle", "trig gate tackle"],
      [
        "anchoring_damavik",
        "anchoring_kikimora",
        "tangling_damavik",
        "tangling_kikimora",
      ],
    ),
    buildNamedTrigPool(
      "parity_trig_pochven_gate_pressure",
      "Pochven Gate Pressure Pool",
      "Generated baseline pressure and disruption pool for natural Pochven gate-side Trig patrols.",
      ["pochven pressure", "trig gate pressure"],
      [
        "starving_damavik",
        "starving_vedmak",
        "starving_drekavac",
        "blinding_damavik",
        "blinding_kikimora",
        "harrowing_damavik",
        "harrowing_kikimora",
        "harrowing_vedmak",
        "ghosting_damavik",
        "ghosting_kikimora",
        "ghosting_drekavac",
      ],
    ),
    buildNamedTrigPool(
      "parity_trig_pochven_gate_support",
      "Pochven Gate Support Pool",
      "Generated baseline support pool for natural Pochven gate-side Trig patrols.",
      ["pochven support", "trig gate support"],
      [
        "renewing_damavik",
        "renewing_rodiva",
        "renewing_leshak",
      ],
    ),
    buildNamedTrigPool(
      "parity_trig_pochven_gate_line",
      "Pochven Gate Line Pool",
      "Generated baseline line-combat pool for natural Pochven gate-side Trig patrols.",
      ["pochven line", "trig gate line"],
      [
        "liminal_damavik",
        "liminal_kikimora",
        "liminal_vedmak",
        "liminal_rodiva",
        "liminal_drekavac",
        "liminal_leshak",
      ],
    ),
  ];
  const drifterPools = [
    buildSpawnPoolRow(
      "parity_drifter_all",
      "Drifter Native Parity Pool",
      "All generated Drifter hull variants currently proven on the native NPC path.",
      ["drifter", "drifters", "drifter all"],
      DRIFTER_VARIANTS.map((variant) => ({
        profileID: getDrifterProfileID(variant),
        weight: variant.key === "strategos" ? 1 : 2,
      })),
    ),
    buildSpawnPoolRow(
      "parity_drifter_response_callers",
      "Drifter Response Callers",
      "Generated Drifter hulls that can initiate reinforcement behavior on the native path.",
      ["drifter lancer", "lancer", "reinforcement drifter"],
      DRIFTER_VARIANTS
        .filter((variant) => Array.isArray(buildDrifterDefinition(variant).behaviorProfile.reinforcementDefinitions) &&
          buildDrifterDefinition(variant).behaviorProfile.reinforcementDefinitions.length > 0)
        .map((variant) => ({
          profileID: getDrifterProfileID(variant),
          weight: 1,
        })),
    ),
    buildNamedDrifterPool(
      "parity_drifter_superweapon_line",
      "Drifter Superweapon Line",
      "Generated Drifter hulls that expose the live native-path superweapon lane.",
      ["drifter superweapon", "drifter line", "superweapon drifter"],
      [
        "cruiser",
        "battleship",
        "commander",
        "polemarkos",
        "navarkos",
        "assault",
        "tyrannos",
        "strategos",
      ],
    ),
    buildNamedDrifterPool(
      "parity_drifter_response_battleships",
      "Drifter Response Battleships",
      "Generated Drifter response-side battleship hulls backed by repo-owned native-path authority.",
      ["drifter response", "response drifter", "response battleship"],
      [
        "response",
        "recon",
      ],
    ),
    buildNamedDrifterPool(
      "parity_drifter_disruption_cruisers",
      "Drifter Disruption Cruisers",
      "Generated Drifter cruiser hulls with live native-path tackle, web, neut, or strike pressure lanes.",
      ["drifter disruption cruiser", "drifter cruiser screen", "drifter cruiser pressure"],
      [
        "strike_cruiser",
        "entanglement",
        "nullwarp",
        "nullcharge",
        "scout",
      ],
    ),
    buildNamedDrifterPool(
      "parity_drifter_advanced_strike",
      "Drifter Advanced Strike Line",
      "Generated advanced Drifter line hulls backed by repo-owned native-path authority.",
      ["drifter advanced strike", "advanced drifter", "polemarkos raider"],
      [
        "polemarkos",
        "raider",
        "navarkos",
        "assault",
      ],
    ),
    buildSpawnPoolRow(
      "parity_drifter_roaming_family",
      "Drifter Roaming Family",
      "Generated explicit roaming-family Drifter authority for the shared native NPC path.",
      ["drifter roaming family", "roaming drifter family", "roaming drifter"],
      [{
        profileID: "parity_drifter_roaming_battleship",
        weight: 1,
      }],
    ),
    buildSpawnPoolRow(
      "parity_drifter_dungeon_family",
      "Drifter Dungeon Family",
      "Generated explicit dungeon/site-family Drifter authority for the shared native NPC path.",
      ["drifter dungeon family", "dungeon drifter family", "dungeon drifter"],
      [{
        profileID: "parity_drifter_dungeon_battleship",
        weight: 1,
      }],
    ),
    buildSpawnPoolRow(
      "parity_drifter_hive_family",
      "Drifter Hive Family",
      "Generated explicit hive-family Drifter authority for the shared native NPC path.",
      ["drifter hive family", "hive drifter family", "hive drifter"],
      [
        {
          profileID: "parity_drifter_hive_lancer",
          weight: 1,
        },
        {
          profileID: "parity_drifter_hive_battleship",
          weight: 1,
        },
      ],
    ),
  ];

  const spawnGroups = [
    buildSpawnGroupRow(
      "parity_drifter_lancer_response_screen",
      "Drifter Lancer Response Screen",
      "Generated grouped Drifter response authority for native-path reinforcement and future authored placement work.",
      [
        "drifter lancer response",
        "lancer response screen",
      ],
      [
        {
          profileID: getDrifterProfileID(getDrifterVariantByKey("lancer")),
          count: 1,
        },
        {
          spawnPoolID: "parity_drifter_response_battleships",
          count: 1,
        },
        {
          spawnPoolID: "parity_drifter_disruption_cruisers",
          minCount: 0,
          maxCount: 1,
        },
      ],
    ),
    buildSpawnGroupRow(
      "parity_drifter_superweapon_screen",
      "Drifter Superweapon Screen",
      "Generated grouped Drifter superweapon authority for native-path validation and future authored placement work.",
      [
        "drifter superweapon screen",
        "drifter strike screen",
      ],
      [
        {
          spawnPoolID: "parity_drifter_superweapon_line",
          count: 1,
        },
        {
          spawnPoolID: "parity_drifter_disruption_cruisers",
          count: 1,
        },
      ],
    ),
    buildSpawnGroupRow(
      "parity_drifter_advanced_strike_pair",
      "Drifter Advanced Strike Pair",
      "Generated grouped advanced Drifter strike authority backed by repo-owned native-path hull families.",
      [
        "drifter advanced strike pair",
        "advanced drifter pair",
      ],
      [
        {
          spawnPoolID: "parity_drifter_advanced_strike",
          count: 1,
        },
        {
          spawnPoolID: "parity_drifter_disruption_cruisers",
          minCount: 0,
          maxCount: 1,
        },
      ],
    ),
    buildSpawnGroupRow(
      "parity_drifter_hive_guard_screen",
      "Drifter Hive Guard Screen",
      "Generated grouped hive-family Drifter authority for natural Drifter-space hive entrance placement on exact generated signature anchors.",
      [
        "drifter hive guard",
        "drifter hive screen",
      ],
      [
        {
          spawnPoolID: "parity_drifter_hive_family",
          count: 1,
        },
        {
          spawnPoolID: "parity_drifter_disruption_cruisers",
          minCount: 0,
          maxCount: 1,
        },
      ],
    ),
    buildSpawnGroupRow(
      "parity_trig_pochven_border_gate_patrol",
      "Triglavian Pochven Border Gate Patrol",
      "Generated lighter mixed-role Triglavian patrol for natural Pochven border-system gate materialization on explicit stargate anchors.",
      [
        "pochven border gate trig",
        "border trig gate patrol",
      ],
      [
        {
          spawnPoolID: "parity_trig_pochven_gate_tackle",
          count: 1,
        },
        {
          spawnPoolID: "parity_trig_pochven_gate_line",
          count: 1,
        },
        {
          spawnPoolID: "parity_trig_pochven_gate_pressure",
          minCount: 0,
          maxCount: 1,
        },
      ],
    ),
    buildSpawnGroupRow(
      "parity_trig_pochven_internal_gate_patrol",
      "Triglavian Pochven Internal Gate Patrol",
      "Generated mid-weight mixed-role Triglavian patrol for natural Pochven internal-system gate materialization on explicit stargate anchors.",
      [
        "pochven internal gate trig",
        "internal trig gate patrol",
      ],
      [
        {
          spawnPoolID: "parity_trig_pochven_gate_tackle",
          count: 1,
        },
        {
          spawnPoolID: "parity_trig_pochven_gate_line",
          count: 1,
        },
        {
          spawnPoolID: "parity_trig_pochven_gate_pressure",
          count: 1,
        },
        {
          spawnPoolID: "parity_trig_pochven_gate_support",
          minCount: 0,
          maxCount: 1,
        },
      ],
    ),
    buildSpawnGroupRow(
      "parity_trig_pochven_home_gate_patrol",
      "Triglavian Pochven Home Gate Patrol",
      "Generated heavier mixed-role Triglavian patrol for natural Pochven home-system gate materialization on explicit stargate anchors.",
      [
        "pochven home gate trig",
        "home trig gate patrol",
      ],
      [
        {
          spawnPoolID: "parity_trig_pochven_gate_tackle",
          count: 1,
        },
        {
          spawnPoolID: "parity_trig_pochven_gate_line",
          count: 2,
        },
        {
          spawnPoolID: "parity_trig_pochven_gate_pressure",
          count: 1,
        },
        {
          spawnPoolID: "parity_trig_pochven_gate_support",
          count: 1,
        },
      ],
    ),
    buildSpawnGroupRow(
      "parity_trig_pochven_border_station_presence",
      "Triglavian Pochven Border Station Presence",
      "Generated conservative station-side Triglavian presence for natural Pochven border-system station materialization on explicit station anchors.",
      [
        "pochven border station trig",
        "border trig station presence",
      ],
      [
        {
          spawnPoolID: "parity_trig_pochven_gate_line",
          count: 1,
        },
      ],
    ),
    buildSpawnGroupRow(
      "parity_trig_pochven_internal_station_presence",
      "Triglavian Pochven Internal Station Presence",
      "Generated conservative station-side Triglavian presence for natural Pochven internal-system station materialization on explicit station anchors.",
      [
        "pochven internal station trig",
        "internal trig station presence",
      ],
      [
        {
          spawnPoolID: "parity_trig_pochven_gate_line",
          count: 1,
        },
        {
          spawnPoolID: "parity_trig_pochven_gate_support",
          count: 1,
        },
      ],
    ),
    buildSpawnGroupRow(
      "parity_trig_pochven_home_station_presence",
      "Triglavian Pochven Home Station Presence",
      "Generated heavier station-side Triglavian presence for natural Pochven home-system station materialization on explicit station anchors.",
      [
        "pochven home station trig",
        "home trig station presence",
      ],
      [
        {
          spawnPoolID: "parity_trig_pochven_gate_line",
          count: 1,
        },
        {
          spawnPoolID: "parity_trig_pochven_gate_support",
          count: 1,
        },
        {
          spawnPoolID: "parity_trig_pochven_gate_pressure",
          count: 1,
        },
      ],
    ),
    ...TRIG_VARIANTS.map((variant) => buildSpawnGroupRow(
      `parity_trig_${variant.key}_solo`,
      `${variant.label} Singleton`,
      `Generated singleton group for ${variant.label}.`,
      [variant.label, variant.key, `${variant.hullLabel} trig`],
      [{ profileID: getTrigProfileID(variant), count: 1 }],
    )),
    ...DRIFTER_VARIANTS.map((variant) => buildSpawnGroupRow(
      `parity_drifter_${variant.key}_solo`,
      `${variant.label} Singleton`,
      `Generated singleton group for ${variant.label}.`,
      [variant.label, variant.key, "drifter"],
      [{ profileID: getDrifterProfileID(variant), count: 1 }],
    )),
    ...drifterFamilyDefinitions.map((definition) => buildSpawnGroupRow(
      `${definition.profile.profileID}_solo`,
      `${definition.profile.name} Singleton`,
      `Generated explicit singleton group for ${definition.profile.name}.`,
      [definition.profile.name, ...(Array.isArray(definition.profile.aliases) ? definition.profile.aliases : [])],
      [{ profileID: definition.profile.profileID, count: 1 }],
    )),
  ];
  const spawnSites = [
    ...buildPochvenGateSpawnSites(),
    ...buildPochvenStationSpawnSites(),
  ];
  const startupRules = [
    ...buildPochvenGateStartupRules(),
    ...buildPochvenStationStartupRules(),
    ...buildKnownSpaceDrifterStartupRules(),
    ...buildDrifterSpaceHiveStartupRules(),
  ];

  datasetCache.rowsByTableName = Object.freeze({
    [NPC_TABLE.PROFILES]: Object.freeze(profiles.map((row) => cloneValue(row))),
    [NPC_TABLE.LOADOUTS]: Object.freeze(loadouts.map((row) => cloneValue(row))),
    [NPC_TABLE.BEHAVIOR_PROFILES]: Object.freeze(behaviorProfiles.map((row) => cloneValue(row))),
    [NPC_TABLE.LOOT_TABLES]: Object.freeze(lootTables.map((row) => cloneValue(row))),
    [NPC_TABLE.SPAWN_POOLS]: Object.freeze([
      ...trigPools.filter(Boolean).map((row) => cloneValue(row)),
      ...drifterPools.map((row) => cloneValue(row)),
    ]),
    [NPC_TABLE.SPAWN_GROUPS]: Object.freeze(spawnGroups.map((row) => cloneValue(row))),
    [NPC_TABLE.SPAWN_SITES]: Object.freeze(spawnSites.map((row) => cloneValue(row))),
    [NPC_TABLE.STARTUP_RULES]: Object.freeze(startupRules.map((row) => cloneValue(row))),
  });
  return datasetCache.rowsByTableName;
}

function getTrigDrifterGeneratedRows(tableName) {
  return buildTrigDrifterDataset()[tableName] || [];
}

module.exports = {
  NPC_TABLE,
  TRIG_VARIANTS,
  DRIFTER_VARIANTS,
  DRIFTER_BEHAVIOR_FAMILY,
  buildDrifterBehaviorProfile,
  getTrigDrifterGeneratedRows,
};
