const path = require("path");

const spaceRuntime = require(path.join(__dirname, "../../../space/runtime"));
const npcService = require(path.join(__dirname, "../../../space/npc"));
const nativeNpcService = require(path.join(
  __dirname,
  "../../../space/npc/nativeNpcService",
));
const {
  DRIFTER_VARIANTS: AUTHORITY_DRIFTER_VARIANTS,
  DRIFTER_BEHAVIOR_FAMILY,
  buildDrifterBehaviorProfile,
} = require(path.join(
  __dirname,
  "../../../space/npc/trigDrifter/trigDrifterNpcCatalog",
));
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../inventory/itemTypeRegistry"));
const {
  resolveTrigCommandPresetKey,
} = require(path.join(__dirname, "../../ship/devCommandShipRuntime"));

const TRIG_DRIFTER_CHAT_COMMANDS = Object.freeze([
  "trigspawn",
  "drifter",
]);

const TRIG_DRIFTER_HELP_LINES = Object.freeze([
  "/trigspawn [count] [status|clear|hull|role hull]",
  "/drifter [count] [status|clear|variant|random|family random]",
]);

const DEFAULT_TEST_PACK_AMOUNT = 3;
const MAX_TEST_PACK_AMOUNT = 50;
const TRIG_OPERATOR_KIND = "trigspawn";
const DRIFTER_OPERATOR_KIND = "drifterspawn";
const TRIG_CORPORATION_ID = 1000298;
const TRIG_FACTION_ID = 500026;
const DRIFTER_CORPORATION_ID = 1000274;
const DRIFTER_FACTION_ID = 500024;
const DRIFTER_BEHAVIOR_FAMILY_ALIAS_MAP = Object.freeze({
  default: DRIFTER_BEHAVIOR_FAMILY.DEFAULT,
  hunter: DRIFTER_BEHAVIOR_FAMILY.DEFAULT,
  commander: DRIFTER_BEHAVIOR_FAMILY.COMMANDER,
  roaming: DRIFTER_BEHAVIOR_FAMILY.ROAMING,
  roamer: DRIFTER_BEHAVIOR_FAMILY.ROAMING,
  dungeon: DRIFTER_BEHAVIOR_FAMILY.DUNGEON,
  site: DRIFTER_BEHAVIOR_FAMILY.DUNGEON,
  hive: DRIFTER_BEHAVIOR_FAMILY.HIVE,
});
const DRIFTER_RANDOM_PACK_ALIASES = Object.freeze(new Set([
  "random",
  "mixed",
  "mix",
  "pack",
  "randompack",
  "mixedpack",
  "array",
]));

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

function buildTrigVariant(options) {
  return Object.freeze({
    key: String(options.key || "").trim(),
    label: String(options.label || "").trim(),
    roleLabel: String(options.roleLabel || "").trim() || "Liminal",
    hullLabel: String(options.hullLabel || "").trim(),
    npcShipTypeID: toInt(options.npcShipTypeID, 0),
    weaponTypeID: toInt(options.weaponTypeID, 0),
    chargeTypeID: toInt(options.chargeTypeID, 0),
    spawnDistanceMeters: Math.max(1_000, toInt(options.spawnDistanceMeters, 9_000)),
    formationSpacingMeters: Math.max(60, toInt(options.formationSpacingMeters, 180)),
    extraModuleTypeIDs: Object.freeze(
      (Array.isArray(options.extraModuleTypeIDs) ? options.extraModuleTypeIDs : [])
        .map((typeID) => toInt(typeID, 0))
        .filter((typeID) => typeID > 0),
    ),
    parityNote: String(options.parityNote || "").trim() || null,
    aliases: Object.freeze(
      (Array.isArray(options.aliases) ? options.aliases : [])
        .map((alias) => String(alias || "").trim())
        .filter(Boolean),
    ),
  });
}

const TRIG_VARIANTS = Object.freeze([
  buildTrigVariant({
    key: "liminal_damavik",
    label: "Liminal Damavik",
    roleLabel: "Liminal",
    hullLabel: "Damavik",
    npcShipTypeID: 52182,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 6_500,
    formationSpacingMeters: 120,
    aliases: ["damavik", "light", "nergal", "liminal", "liminal damavik"],
  }),
  buildTrigVariant({
    key: "liminal_kikimora",
    label: "Liminal Kikimora",
    roleLabel: "Liminal",
    hullLabel: "Kikimora",
    npcShipTypeID: 52185,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 6_500,
    formationSpacingMeters: 120,
    aliases: ["kikimora", "draugur", "liminal kikimora"],
  }),
  buildTrigVariant({
    key: "liminal_vedmak",
    label: "Liminal Vedmak",
    roleLabel: "Liminal",
    hullLabel: "Vedmak",
    npcShipTypeID: 52183,
    weaponTypeID: TRIG_TYPE_IDS.heavyEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaM,
    spawnDistanceMeters: 9_000,
    formationSpacingMeters: 180,
    aliases: ["vedmak", "ikitursa", "liminal vedmak"],
  }),
  buildTrigVariant({
    key: "liminal_rodiva",
    label: "Liminal Rodiva",
    roleLabel: "Liminal",
    hullLabel: "Rodiva",
    npcShipTypeID: 52186,
    weaponTypeID: TRIG_TYPE_IDS.heavyEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaM,
    spawnDistanceMeters: 9_000,
    formationSpacingMeters: 180,
    aliases: ["rodiva", "zarmazd", "liminal rodiva"],
  }),
  buildTrigVariant({
    key: "liminal_drekavac",
    label: "Liminal Drekavac",
    roleLabel: "Liminal",
    hullLabel: "Drekavac",
    npcShipTypeID: 52187,
    weaponTypeID: TRIG_TYPE_IDS.heavyEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaM,
    spawnDistanceMeters: 9_000,
    formationSpacingMeters: 180,
    aliases: ["drekavac", "liminal drekavac"],
  }),
  buildTrigVariant({
    key: "liminal_leshak",
    label: "Liminal Leshak",
    roleLabel: "Liminal",
    hullLabel: "Leshak",
    npcShipTypeID: 52184,
    weaponTypeID: TRIG_TYPE_IDS.supratidalEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaL,
    spawnDistanceMeters: 12_000,
    formationSpacingMeters: 220,
    aliases: ["leshak", "trig", "liminal leshak"],
  }),
  buildTrigVariant({
    key: "liminal_zirnitra",
    label: "Liminal Zirnitra",
    roleLabel: "Liminal",
    hullLabel: "Zirnitra",
    npcShipTypeID: 52701,
    weaponTypeID: TRIG_TYPE_IDS.ultratidalEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaXL,
    spawnDistanceMeters: 16_000,
    formationSpacingMeters: 260,
    aliases: ["zirnitra", "ultratidal", "liminal zirnitra"],
  }),
  buildTrigVariant({
    key: "anchoring_damavik",
    label: "Anchoring Damavik",
    roleLabel: "Anchoring",
    hullLabel: "Damavik",
    npcShipTypeID: 52207,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 5_500,
    formationSpacingMeters: 120,
    extraModuleTypeIDs: [TRIG_TYPE_IDS.warpScramblerII],
    aliases: ["anchoring damavik"],
  }),
  buildTrigVariant({
    key: "anchoring_kikimora",
    label: "Anchoring Kikimora",
    roleLabel: "Anchoring",
    hullLabel: "Kikimora",
    npcShipTypeID: 52213,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 5_500,
    formationSpacingMeters: 120,
    extraModuleTypeIDs: [TRIG_TYPE_IDS.warpScramblerII],
    aliases: ["anchoring kikimora"],
  }),
  buildTrigVariant({
    key: "starving_damavik",
    label: "Starving Damavik",
    roleLabel: "Starving",
    hullLabel: "Damavik",
    npcShipTypeID: 52205,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 5_500,
    formationSpacingMeters: 120,
    extraModuleTypeIDs: [
      TRIG_TYPE_IDS.smallEnergyNeutralizerII,
      TRIG_TYPE_IDS.smallEnergyNosferatuII,
    ],
    aliases: ["starving damavik"],
  }),
  buildTrigVariant({
    key: "starving_vedmak",
    label: "Starving Vedmak",
    roleLabel: "Starving",
    hullLabel: "Vedmak",
    npcShipTypeID: 48087,
    weaponTypeID: TRIG_TYPE_IDS.heavyEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaM,
    spawnDistanceMeters: 8_500,
    formationSpacingMeters: 180,
    extraModuleTypeIDs: [
      TRIG_TYPE_IDS.mediumEnergyNeutralizerII,
      TRIG_TYPE_IDS.mediumEnergyNosferatuII,
    ],
    aliases: ["starving vedmak"],
  }),
  buildTrigVariant({
    key: "starving_drekavac",
    label: "Starving Drekavac",
    roleLabel: "Starving",
    hullLabel: "Drekavac",
    npcShipTypeID: 52234,
    weaponTypeID: TRIG_TYPE_IDS.heavyEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaM,
    spawnDistanceMeters: 8_500,
    formationSpacingMeters: 180,
    extraModuleTypeIDs: [
      TRIG_TYPE_IDS.mediumEnergyNeutralizerII,
      TRIG_TYPE_IDS.mediumEnergyNosferatuII,
    ],
    aliases: ["starving drekavac"],
  }),
  buildTrigVariant({
    key: "starving_leshak",
    label: "Starving Leshak",
    roleLabel: "Starving",
    hullLabel: "Leshak",
    npcShipTypeID: 48125,
    weaponTypeID: TRIG_TYPE_IDS.supratidalEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaL,
    spawnDistanceMeters: 11_000,
    formationSpacingMeters: 220,
    extraModuleTypeIDs: [
      TRIG_TYPE_IDS.heavyEnergyNeutralizerII,
      TRIG_TYPE_IDS.heavyEnergyNosferatuII,
    ],
    aliases: ["starving leshak"],
  }),
  buildTrigVariant({
    key: "tangling_damavik",
    label: "Tangling Damavik",
    roleLabel: "Tangling",
    hullLabel: "Damavik",
    npcShipTypeID: 52232,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 5_500,
    formationSpacingMeters: 120,
    extraModuleTypeIDs: [TRIG_TYPE_IDS.stasisWebifierII],
    aliases: ["tangling damavik"],
  }),
  buildTrigVariant({
    key: "tangling_kikimora",
    label: "Tangling Kikimora",
    roleLabel: "Tangling",
    hullLabel: "Kikimora",
    npcShipTypeID: 52233,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 5_500,
    formationSpacingMeters: 120,
    extraModuleTypeIDs: [TRIG_TYPE_IDS.stasisWebifierII],
    aliases: ["tangling kikimora"],
  }),
  buildTrigVariant({
    key: "tangling_leshak",
    label: "Tangling Leshak",
    roleLabel: "Tangling",
    hullLabel: "Leshak",
    npcShipTypeID: 48124,
    weaponTypeID: TRIG_TYPE_IDS.supratidalEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaL,
    spawnDistanceMeters: 11_000,
    formationSpacingMeters: 220,
    extraModuleTypeIDs: [TRIG_TYPE_IDS.stasisWebifierII],
    aliases: ["tangling leshak"],
  }),
  buildTrigVariant({
    key: "blinding_damavik",
    label: "Blinding Damavik",
    roleLabel: "Blinding",
    hullLabel: "Damavik",
    npcShipTypeID: 52209,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 6_500,
    formationSpacingMeters: 120,
    parityNote: "Blinding hull presentation and baseline NPC sensor-dampening behavior are live here; broader authored mixed-composition signoff still remains a parity TODO.",
    aliases: ["blinding damavik"],
  }),
  buildTrigVariant({
    key: "blinding_kikimora",
    label: "Blinding Kikimora",
    roleLabel: "Blinding",
    hullLabel: "Kikimora",
    npcShipTypeID: 52217,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 6_500,
    formationSpacingMeters: 120,
    parityNote: "Blinding hull presentation and baseline NPC sensor-dampening behavior are live here; broader authored mixed-composition signoff still remains a parity TODO.",
    aliases: ["blinding kikimora"],
  }),
  buildTrigVariant({
    key: "blinding_leshak",
    label: "Blinding Leshak",
    roleLabel: "Blinding",
    hullLabel: "Leshak",
    npcShipTypeID: 52216,
    weaponTypeID: TRIG_TYPE_IDS.supratidalEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaL,
    spawnDistanceMeters: 12_000,
    formationSpacingMeters: 220,
    parityNote: "Blinding hull presentation and baseline NPC sensor-dampening behavior are live here; broader authored mixed-composition signoff still remains a parity TODO.",
    aliases: ["blinding leshak"],
  }),
  buildTrigVariant({
    key: "harrowing_damavik",
    label: "Harrowing Damavik",
    roleLabel: "Harrowing",
    hullLabel: "Damavik",
    npcShipTypeID: 52206,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 6_500,
    formationSpacingMeters: 120,
    parityNote: "Harrowing hull presentation and baseline NPC target-painter behavior are live here; broader authored mixed-composition signoff still remains a parity TODO.",
    aliases: ["harrowing damavik"],
  }),
  buildTrigVariant({
    key: "harrowing_kikimora",
    label: "Harrowing Kikimora",
    roleLabel: "Harrowing",
    hullLabel: "Kikimora",
    npcShipTypeID: 52212,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 6_500,
    formationSpacingMeters: 120,
    parityNote: "Harrowing hull presentation and baseline NPC target-painter behavior are live here; broader authored mixed-composition signoff still remains a parity TODO.",
    aliases: ["harrowing kikimora"],
  }),
  buildTrigVariant({
    key: "harrowing_vedmak",
    label: "Harrowing Vedmak",
    roleLabel: "Harrowing",
    hullLabel: "Vedmak",
    npcShipTypeID: 52211,
    weaponTypeID: TRIG_TYPE_IDS.heavyEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaM,
    spawnDistanceMeters: 9_000,
    formationSpacingMeters: 180,
    parityNote: "Harrowing hull presentation and baseline NPC target-painter behavior are live here; broader authored mixed-composition signoff still remains a parity TODO.",
    aliases: ["harrowing vedmak"],
  }),
  buildTrigVariant({
    key: "ghosting_damavik",
    label: "Ghosting Damavik",
    roleLabel: "Ghosting",
    hullLabel: "Damavik",
    npcShipTypeID: 52210,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 6_500,
    formationSpacingMeters: 120,
    parityNote: "Ghosting hull presentation and baseline NPC disruption behavior are live here; broader authored mixed-composition signoff still remains a parity TODO.",
    aliases: ["ghosting damavik"],
  }),
  buildTrigVariant({
    key: "ghosting_kikimora",
    label: "Ghosting Kikimora",
    roleLabel: "Ghosting",
    hullLabel: "Kikimora",
    npcShipTypeID: 56151,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 6_500,
    formationSpacingMeters: 120,
    parityNote: "Ghosting hull presentation and baseline NPC disruption behavior are live here; broader authored mixed-composition signoff still remains a parity TODO.",
    aliases: ["ghosting kikimora"],
  }),
  buildTrigVariant({
    key: "ghosting_drekavac",
    label: "Ghosting Drekavac",
    roleLabel: "Ghosting",
    hullLabel: "Drekavac",
    npcShipTypeID: 52218,
    weaponTypeID: TRIG_TYPE_IDS.heavyEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaM,
    spawnDistanceMeters: 9_000,
    formationSpacingMeters: 180,
    parityNote: "Ghosting hull presentation and baseline NPC disruption behavior are live here; broader authored mixed-composition signoff still remains a parity TODO.",
    aliases: ["ghosting drekavac"],
  }),
  buildTrigVariant({
    key: "renewing_damavik",
    label: "Renewing Damavik",
    roleLabel: "Renewing",
    hullLabel: "Damavik",
    npcShipTypeID: 52208,
    weaponTypeID: TRIG_TYPE_IDS.lightEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaS,
    spawnDistanceMeters: 6_500,
    formationSpacingMeters: 120,
    parityNote: "Renewing hull presentation and baseline NPC remote-repair behavior are live here; broader authored mixed-composition signoff still remains a parity TODO.",
    aliases: ["renewing damavik"],
  }),
  buildTrigVariant({
    key: "renewing_rodiva",
    label: "Renewing Rodiva",
    roleLabel: "Renewing",
    hullLabel: "Rodiva",
    npcShipTypeID: 52214,
    weaponTypeID: TRIG_TYPE_IDS.heavyEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaM,
    spawnDistanceMeters: 9_000,
    formationSpacingMeters: 180,
    parityNote: "Renewing hull presentation and baseline NPC remote-repair behavior are live here; broader authored mixed-composition signoff still remains a parity TODO.",
    aliases: ["renewing rodiva"],
  }),
  buildTrigVariant({
    key: "renewing_leshak",
    label: "Renewing Leshak",
    roleLabel: "Renewing",
    hullLabel: "Leshak",
    npcShipTypeID: 52215,
    weaponTypeID: TRIG_TYPE_IDS.supratidalEntropicDisintegratorII,
    chargeTypeID: TRIG_TYPE_IDS.baryonExoticPlasmaL,
    spawnDistanceMeters: 12_000,
    formationSpacingMeters: 220,
    parityNote: "Renewing hull presentation and baseline NPC remote-repair behavior are live here; broader authored mixed-composition signoff still remains a parity TODO.",
    aliases: ["renewing leshak"],
  }),
]);

const TRIG_VARIANTS_BY_ALIAS = Object.freeze(
  Object.fromEntries(
    TRIG_VARIANTS.flatMap((variant) => (
      variant.aliases.map((alias) => [
        String(alias).trim().toLowerCase().replace(/[^a-z0-9]+/g, ""),
        variant,
      ])
    )),
  ),
);

const TRIG_VARIANT_KEY_BY_PRESET = Object.freeze({
  trigdamavik: "liminal_damavik",
  trignergal: "liminal_damavik",
  trigkikimora: "liminal_kikimora",
  trigdraugur: "liminal_kikimora",
  trigvedmak: "liminal_vedmak",
  trigrodiva: "liminal_rodiva",
  trigikitursa: "liminal_vedmak",
  trigzarmazd: "liminal_rodiva",
  trigdrekavac: "liminal_drekavac",
  trigleshak: "liminal_leshak",
  trigzirnitra: "liminal_zirnitra",
});

const DRIFTER_VARIANTS = Object.freeze(
  Object.fromEntries(
    AUTHORITY_DRIFTER_VARIANTS.map((variant) => [variant.key, Object.freeze({ ...variant })]),
  ),
);
const DRIFTER_VARIANTS_BY_ALIAS = Object.freeze(
  Object.fromEntries(
    AUTHORITY_DRIFTER_VARIANTS.flatMap((variant) => (
      (Array.isArray(variant.aliases) ? variant.aliases : [])
        .map((alias) => String(alias || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, ""))
        .filter(Boolean)
        .map((alias) => [alias, DRIFTER_VARIANTS[variant.key]])
    )),
  ),
);

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeCommandToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parseSpawnArguments(argumentText, defaultAmount = DEFAULT_TEST_PACK_AMOUNT) {
  const trimmed = String(argumentText || "").trim();
  if (!trimmed) {
    return {
      success: true,
      amount: defaultAmount,
      query: "",
    };
  }

  const parts = trimmed.split(/\s+/);
  let amount = defaultAmount;
  let amountIndex = -1;
  for (let index = 0; index < parts.length; index += 1) {
    if (!/^\d+$/.test(parts[index])) {
      continue;
    }
    amount = toInt(parts[index], 0);
    amountIndex = index;
    break;
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    return {
      success: false,
      errorMsg: "INVALID_AMOUNT",
    };
  }

  return {
    success: true,
    amount,
    query: amountIndex >= 0
      ? parts.filter((_, index) => index !== amountIndex).join(" ").trim()
      : trimmed,
  };
}

function resolveRequiredType(name) {
  const resolution = resolveItemByName(name);
  if (!resolution || resolution.success !== true || !resolution.match) {
    throw new Error(`ITEM_RESOLVE_FAILED:${name}`);
  }
  return resolution.match;
}

function resolveRequiredTypeByTypeID(typeID) {
  const match = resolveItemByTypeID(toInt(typeID, 0));
  if (!match || !match.typeID) {
    throw new Error(`ITEM_RESOLVE_FAILED:${typeID}`);
  }
  return match;
}

function resolveTrigVariant(query) {
  const normalized = normalizeCommandToken(query);
  if (normalized && TRIG_VARIANTS_BY_ALIAS[normalized]) {
    return TRIG_VARIANTS_BY_ALIAS[normalized];
  }
  const presetKey = resolveTrigCommandPresetKey(query || "");
  const variantKey = TRIG_VARIANT_KEY_BY_PRESET[presetKey];
  if (variantKey) {
    return TRIG_VARIANTS.find((variant) => variant.key === variantKey) || null;
  }
  return TRIG_VARIANTS.find((variant) => variant.key === "liminal_leshak") || null;
}

function resolveDrifterVariant(query) {
  const normalized = normalizeCommandToken(query);
  if (!normalized) {
    return DRIFTER_VARIANTS.battleship;
  }
  return (
    DRIFTER_VARIANTS[normalized] ||
    DRIFTER_VARIANTS_BY_ALIAS[normalized] ||
    null
  );
}

function resolveDrifterRandomSelection(query) {
  const trimmedQuery = String(query || "").trim();
  if (!trimmedQuery) {
    return null;
  }

  const normalizedQuery = normalizeCommandToken(trimmedQuery);
  if (DRIFTER_RANDOM_PACK_ALIASES.has(normalizedQuery)) {
    return {
      random: true,
      behaviorFamily: null,
    };
  }

  const tokens = trimmedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const familyToken = normalizeCommandToken(tokens[0]);
    const behaviorFamily = DRIFTER_BEHAVIOR_FAMILY_ALIAS_MAP[familyToken] || null;
    const randomToken = normalizeCommandToken(tokens.slice(1).join(" "));
    if (behaviorFamily && DRIFTER_RANDOM_PACK_ALIASES.has(randomToken)) {
      return {
        random: true,
        behaviorFamily,
      };
    }
  }

  return null;
}

function resolveDrifterSpawnSelection(query) {
  const trimmedQuery = String(query || "").trim();
  if (!trimmedQuery) {
    return {
      variant: DRIFTER_VARIANTS.battleship,
      behaviorFamily: null,
    };
  }

  const directVariant = resolveDrifterVariant(trimmedQuery);
  if (directVariant) {
    return {
      variant: directVariant,
      behaviorFamily: null,
    };
  }

  const tokens = trimmedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const familyToken = normalizeCommandToken(tokens[0]);
    const behaviorFamily = DRIFTER_BEHAVIOR_FAMILY_ALIAS_MAP[familyToken] || null;
    if (behaviorFamily) {
      const variantQuery = tokens.slice(1).join(" ");
      const variant = resolveDrifterVariant(variantQuery);
      if (variant) {
        return {
          variant,
          behaviorFamily,
        };
      }
    }
  }

  return {
    variant: null,
    behaviorFamily: null,
  };
}

function shuffleArray(values) {
  const result = Array.isArray(values) ? values.slice() : [];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = result[index];
    result[index] = result[swapIndex];
    result[swapIndex] = current;
  }
  return result;
}

function selectRandomDrifterVariants(amount) {
  const resolvedAmount = Math.max(1, toInt(amount, 1));
  const variants = Object.values(DRIFTER_VARIANTS)
    .filter((variant) => variant && toInt(variant.shipTypeID, 0) > 0);
  if (variants.length <= 1) {
    return Array.from({ length: resolvedAmount }, () => variants[0] || DRIFTER_VARIANTS.battleship);
  }

  const selected = [];
  while (selected.length < resolvedAmount) {
    selected.push(...shuffleArray(variants));
  }
  return selected.slice(0, resolvedAmount);
}

function summarizeDrifterComposition(variants) {
  const counts = new Map();
  for (const variant of Array.isArray(variants) ? variants : []) {
    const label = String(variant && variant.label || "Unknown Drifter").trim();
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([label, count]) => `${count}x ${label}`)
    .join(", ");
}

function buildSpawnContextForSession(session) {
  if (!session || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const systemID = toInt(session._space.systemID, 0);
  const shipID = toInt(session._space.shipID, 0);
  if (!systemID || !shipID) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const scene = spaceRuntime.ensureScene(systemID);
  const anchorEntity = spaceRuntime.getEntity(session, shipID);
  if (!scene || !anchorEntity) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  return {
    success: true,
    data: {
      systemID,
      scene,
      anchorEntity,
      preferredTargetID: shipID,
      anchorKind: String(anchorEntity.kind || "ship"),
      anchorLabel: String(anchorEntity.itemName || anchorEntity.slimName || "Ship"),
    },
  };
}

function clearOperatorKindInSystem(systemID, operatorKind) {
  const targetSystemID = toInt(systemID, 0);
  const targetOperatorKind = String(operatorKind || "").trim();
  if (!targetSystemID || !targetOperatorKind) {
    return 0;
  }

  let clearedCount = 0;
  for (const summary of npcService.getNpcOperatorSummary()) {
    if (
      toInt(summary && summary.systemID, 0) !== targetSystemID ||
      String(summary && summary.operatorKind || "").trim() !== targetOperatorKind
    ) {
      continue;
    }
    const destroyResult = npcService.destroyNpcControllerByEntityID(
      toInt(summary && summary.entityID, 0),
      { removeContents: true },
    );
    if (destroyResult && destroyResult.success) {
      clearedCount += 1;
    }
  }
  return clearedCount;
}

function getOperatorSummariesInSystem(systemID, operatorKind) {
  const targetSystemID = toInt(systemID, 0);
  const targetOperatorKind = String(operatorKind || "").trim();
  if (!targetSystemID || !targetOperatorKind) {
    return [];
  }
  return npcService.getNpcOperatorSummary()
    .filter((summary) => (
      toInt(summary && summary.systemID, 0) === targetSystemID &&
      String(summary && summary.operatorKind || "").trim() === targetOperatorKind
    ));
}

function buildOperatorStatusMessage(context, operatorKind, label) {
  const summaries = getOperatorSummariesInSystem(
    context && context.systemID,
    operatorKind,
  );
  if (summaries.length <= 0) {
    return `No active ${label} pack is currently spawned in this system.`;
  }

  const countsByName = new Map();
  for (const summary of summaries) {
    const entity = context && context.scene
      ? context.scene.getEntityByID(toInt(summary && summary.entityID, 0))
      : null;
    const name = String(
      entity && (
        entity.itemName ||
        entity.slimName
      ) ||
      summary && summary.operatorKind ||
      label,
    ).trim() || label;
    countsByName.set(name, (countsByName.get(name) || 0) + 1);
  }

  const detailText = [...countsByName.entries()]
    .map(([name, count]) => `${count}x ${name}`)
    .join(", ");
  return `Active ${label} pack in this system: ${summaries.length} hull${summaries.length === 1 ? "" : "s"}${detailText ? ` | ${detailText}` : ""}.`;
}

function buildTrigDefinition(variant, index) {
  const shipType = resolveRequiredTypeByTypeID(variant.npcShipTypeID);
  const weaponType = resolveRequiredTypeByTypeID(variant.weaponTypeID);
  const chargeType = resolveRequiredTypeByTypeID(variant.chargeTypeID);
  const suffix = index + 1;
  const combatOrbitDistanceMeters = Math.max(
    1_000,
    toInt(variant && variant.spawnDistanceMeters, 12_000),
  );
  return {
    profile: {
      profileID: `gm_trigspawn_${String(variant.label).toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${suffix}`,
      name: `${variant.label} Trig Test Hull`,
      shipNameTemplate: `${variant.label} Trig Test`,
      entityType: "npc",
      hardwareFamily: "triglavian",
      shipTypeID: shipType.typeID,
      presentationTypeID: shipType.typeID,
      corporationID: TRIG_CORPORATION_ID,
      factionID: TRIG_FACTION_ID,
      securityStatus: -10,
      bounty: 0,
      spawnDistanceMeters: variant.spawnDistanceMeters,
    },
    loadout: {
      loadoutID: `gm_trigspawn_${String(variant.label).toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${suffix}`,
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
      behaviorProfileID: `gm_trigspawn_${String(variant.label).toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${suffix}`,
      movementMode: "orbit",
      orbitDistanceMeters: combatOrbitDistanceMeters,
      followRangeMeters: combatOrbitDistanceMeters,
      autoAggro: true,
      targetPreference: "preferredTargetThenNearestPlayer",
      aggressionRangeMeters: 200_000,
      autoActivateWeapons: true,
      returnToHomeWhenIdle: false,
      useChasePropulsion: false,
      allowFriendlyNpcTargets: false,
    },
    lootTable: null,
  };
}

function buildDrifterDefinition(variant, index, options = {}) {
  const suffix = index + 1;
  const behaviorFamily = String(options.behaviorFamily || "").trim().toLowerCase();
  const familySuffix = behaviorFamily && behaviorFamily !== DRIFTER_BEHAVIOR_FAMILY.DEFAULT
    ? `_${behaviorFamily}`
    : "";
  const slug = String(variant.label).toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const reinforcementVariantQuery = String(
    variant && (
      variant.reinforcementVariantKey ||
      variant.reinforcementVariantQuery
    ) || "",
  ).trim();
  const reinforcementVariant = reinforcementVariantQuery
    ? resolveDrifterVariant(reinforcementVariantQuery)
    : null;
  const reinforcementAmount = Math.max(
    0,
    toInt(variant && variant.reinforcementAmount, 0),
  );
  const reinforcementDefinitions =
    reinforcementVariant && reinforcementAmount > 0
      ? Array.from({ length: reinforcementAmount }, (_, reinforcementIndex) => (
        buildDrifterDefinition(
          reinforcementVariant,
          reinforcementIndex,
          {
            behaviorFamily,
          },
        )
      )).map((definition) => ({
        ...definition,
        behaviorProfile: {
          ...(definition && definition.behaviorProfile || {}),
          reinforcementDefinitions: [],
          maxReinforcementCalls: 0,
        },
      }))
      : [];
  return {
    profile: {
      profileID: `gm_drifter_${slug}${familySuffix}_${suffix}`,
      name: `${variant.label} Test Hull`,
      shipNameTemplate: `${variant.label} Test`,
      entityType: "npc",
      hardwareFamily: "drifterHarness",
      shipTypeID: variant.shipTypeID,
      presentationTypeID: variant.shipTypeID,
      corporationID: DRIFTER_CORPORATION_ID,
      factionID: DRIFTER_FACTION_ID,
      securityStatus: -10,
      bounty: 0,
      spawnDistanceMeters: Math.max(1_000, toInt(variant && variant.spawnDistanceMeters, 20_000)),
    },
    loadout: {
      loadoutID: `gm_drifter_${slug}${familySuffix}_${suffix}`,
      modules: [],
      charges: [],
      cargo: [],
    },
    behaviorProfile: {
      ...buildDrifterBehaviorProfile(
        variant,
        `gm_drifter_${slug}${familySuffix}_${suffix}`,
        reinforcementDefinitions,
        {
          behaviorFamily,
        },
      ),
    },
    lootTable: null,
  };
}

function spawnDefinitionPackForSession(session, definitions, options = {}) {
  const contextResult = buildSpawnContextForSession(session);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const context = contextResult.data;
  const clearedCount = clearOperatorKindInSystem(context.systemID, options.operatorKind);
  const selectionResult = {
    data: {
      selectionKind: "gmTestPack",
      selectionID: String(options.selectionID || options.operatorKind || "gmTestPack"),
      selectionName: String(options.selectionName || options.operatorKind || "GM Test Pack"),
      definitions,
    },
    suggestions: [],
  };
  const spawnResult = nativeNpcService.spawnNativeDefinitionsInContext(
    context,
    selectionResult,
    {
      transient: true,
      operatorKind: String(options.operatorKind || "").trim() || null,
      preferredTargetID: options.preferredTargetID === undefined
        ? context.preferredTargetID
        : toInt(options.preferredTargetID, 0),
      runtimeKind: String(options.runtimeKind || "").trim() || null,
      behaviorOverrides: options.behaviorOverrides || null,
      spawnDistanceMeters: Number(options.spawnDistanceMeters) || undefined,
      formationSpacingMeters: Number(options.formationSpacingMeters) || undefined,
      spreadMeters: Number(options.spreadMeters) || 0,
      skipInitialBehaviorTick: options.skipInitialBehaviorTick === true,
      selectionKind: "gmTestPack",
      selectionID: String(options.selectionID || options.operatorKind || "gmTestPack"),
      selectionName: String(options.selectionName || options.operatorKind || "GM Test Pack"),
      anchorKind: context.anchorKind,
      anchorName: context.anchorLabel,
      anchorID: toInt(context.anchorEntity && context.anchorEntity.itemID, 0),
    },
  );
  if (!spawnResult.success || !spawnResult.data) {
    return {
      success: false,
      errorMsg: spawnResult.errorMsg || "NPC_NATIVE_SPAWN_FAILED",
      clearedCount,
    };
  }

  return {
    success: true,
    data: {
      ...spawnResult.data,
      clearedCount,
      systemID: context.systemID,
    },
  };
}

function executeTrigSpawnCommand(session, argumentText = "") {
  const parsed = parseSpawnArguments(argumentText, DEFAULT_TEST_PACK_AMOUNT);
  if (!parsed.success) {
    return {
      success: false,
      message: "Usage: /trigspawn [count] [status|clear|hull|role hull]",
    };
  }
  if (parsed.amount > MAX_TEST_PACK_AMOUNT) {
    return {
      success: false,
      message: `/trigspawn spawn count must be between 1 and ${MAX_TEST_PACK_AMOUNT}.`,
    };
  }

  const normalizedQuery = String(parsed.query || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (normalizedQuery === "status" || normalizedQuery === "state") {
    const contextResult = buildSpawnContextForSession(session);
    if (!contextResult.success || !contextResult.data) {
      return {
        success: false,
        message: "You must be in space before using /trigspawn status.",
      };
    }
    return {
      success: true,
      message: buildOperatorStatusMessage(
        contextResult.data,
        TRIG_OPERATOR_KIND,
        "/trigspawn",
      ),
    };
  }
  if (normalizedQuery === "clear" || normalizedQuery === "cleanup" || normalizedQuery === "reset") {
    const contextResult = buildSpawnContextForSession(session);
    if (!contextResult.success || !contextResult.data) {
      return {
        success: false,
        message: "You must be in space before using /trigspawn clear.",
      };
    }
    const clearedCount = clearOperatorKindInSystem(
      contextResult.data.systemID,
      TRIG_OPERATOR_KIND,
    );
    return {
      success: true,
      message:
        clearedCount > 0
          ? `Cleared ${clearedCount} active /trigspawn hull${clearedCount === 1 ? "" : "s"} in this system.`
          : "No active /trigspawn hulls were present in this system.",
    };
  }

  const variant = resolveTrigVariant(parsed.query);
  if (!variant) {
    return {
      success: false,
      message: "Unknown /trigspawn variant. Use a hull alias like leshak or a role+hull like starving leshak.",
    };
  }
  const definitions = Array.from({ length: parsed.amount }, (_, index) => buildTrigDefinition(variant, index));
  const result = spawnDefinitionPackForSession(session, definitions, {
    operatorKind: TRIG_OPERATOR_KIND,
    selectionID: `trig:${String(variant.label).toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    selectionName: `${variant.label} Trig Test Pack`,
    preferredTargetID: session && session._space ? session._space.shipID : 0,
    runtimeKind: "nativeCombat",
    spawnDistanceMeters: variant.spawnDistanceMeters,
    formationSpacingMeters: variant.formationSpacingMeters,
    spreadMeters: 0,
  });
  if (!result.success || !result.data) {
    if (result.errorMsg === "NOT_IN_SPACE") {
      return {
        success: false,
        message: "You must be in space before using /trigspawn.",
      };
    }
    if (result.errorMsg === "SHIP_NOT_FOUND") {
      return {
        success: false,
        message: "Active ship was not found in space.",
      };
    }
    return {
      success: false,
      message: `/trigspawn failed: ${result.errorMsg || "UNKNOWN_ERROR"}.`,
    };
  }

  const clearedText = result.data.clearedCount > 0
    ? ` Cleared ${result.data.clearedCount} previous /trigspawn hull${result.data.clearedCount === 1 ? "" : "s"}.`
    : "";
  return {
    success: true,
    message: [
      `Spawned ${result.data.spawned.length} transient ${variant.label} /trigspawn hull${result.data.spawned.length === 1 ? "" : "s"} on the native NPC path.`,
      `They spawn range-clamped for live precursor firing instead of a fake stationary FX dummy.`,
      variant.extraModuleTypeIDs.length > 0
        ? `${variant.roleLabel} hostile utility fit live: ${variant.extraModuleTypeIDs.length} extra role module${variant.extraModuleTypeIDs.length === 1 ? "" : "s"}.`
        : null,
      variant.parityNote,
      clearedText.trim(),
    ].filter(Boolean).join(" "),
  };
}

function executeDrifterCommand(session, argumentText = "") {
  const parsed = parseSpawnArguments(argumentText, DEFAULT_TEST_PACK_AMOUNT);
  if (!parsed.success) {
    return {
      success: false,
      message: "Usage: /drifter [count] [status|clear|variant|random|family random]",
    };
  }
  if (parsed.amount > MAX_TEST_PACK_AMOUNT) {
    return {
      success: false,
      message: `/drifter spawn count must be between 1 and ${MAX_TEST_PACK_AMOUNT}.`,
    };
  }

  const normalizedQuery = normalizeCommandToken(parsed.query);
  if (normalizedQuery === "status" || normalizedQuery === "state") {
    const contextResult = buildSpawnContextForSession(session);
    if (!contextResult.success || !contextResult.data) {
      return {
        success: false,
        message: "You must be in space before using /drifter status.",
      };
    }
    return {
      success: true,
      message: buildOperatorStatusMessage(
        contextResult.data,
        DRIFTER_OPERATOR_KIND,
        "/drifter",
      ),
    };
  }
  if (normalizedQuery === "clear" || normalizedQuery === "cleanup" || normalizedQuery === "reset") {
    const contextResult = buildSpawnContextForSession(session);
    if (!contextResult.success || !contextResult.data) {
      return {
        success: false,
        message: "You must be in space before using /drifter clear.",
      };
    }
    const clearedCount = clearOperatorKindInSystem(
      contextResult.data.systemID,
      DRIFTER_OPERATOR_KIND,
    );
    return {
      success: true,
      message:
        clearedCount > 0
          ? `Cleared ${clearedCount} active /drifter hull${clearedCount === 1 ? "" : "s"} in this system.`
          : "No active /drifter hulls were present in this system.",
    };
  }

  const randomSelection = resolveDrifterRandomSelection(parsed.query);
  if (randomSelection && randomSelection.random === true) {
    const variants = selectRandomDrifterVariants(parsed.amount);
    const definitions = variants.map((variant, index) => buildDrifterDefinition(variant, index, {
      behaviorFamily: randomSelection.behaviorFamily,
    }));
    const familyLabel =
      randomSelection.behaviorFamily &&
      randomSelection.behaviorFamily !== DRIFTER_BEHAVIOR_FAMILY.DEFAULT
        ? randomSelection.behaviorFamily
        : null;
    const result = spawnDefinitionPackForSession(session, definitions, {
      operatorKind: DRIFTER_OPERATOR_KIND,
      selectionID: `drifter:${familyLabel ? `${familyLabel}_` : ""}random_mixed`,
      selectionName: `${familyLabel ? `${familyLabel} ` : ""}Random Mixed Drifter Test Pack`,
      preferredTargetID: session && session._space ? session._space.shipID : 0,
      runtimeKind: "nativeCombat",
      behaviorOverrides: {
        allowPodKill: true,
      },
      spawnDistanceMeters: Math.max(
        1_000,
        ...variants.map((variant) => toInt(variant && variant.spawnDistanceMeters, 20_000)),
      ),
      formationSpacingMeters: 1_500,
      spreadMeters: 0,
    });
    if (!result.success || !result.data) {
      if (result.errorMsg === "NOT_IN_SPACE") {
        return {
          success: false,
          message: "You must be in space before using /drifter.",
        };
      }
      if (result.errorMsg === "SHIP_NOT_FOUND") {
        return {
          success: false,
          message: "Active ship was not found in space.",
        };
      }
      return {
        success: false,
        message: `/drifter failed: ${result.errorMsg || "UNKNOWN_ERROR"}.`,
      };
    }

    const clearedText = result.data.clearedCount > 0
      ? ` Cleared ${result.data.clearedCount} previous /drifter hull${result.data.clearedCount === 1 ? "" : "s"}.`
      : "";
    const compositionText = summarizeDrifterComposition(variants);
    return {
      success: true,
      message: [
        `Spawned ${result.data.spawned.length} transient random mixed /drifter hull${result.data.spawned.length === 1 ? "" : "s"} on the native NPC path${familyLabel ? ` using the ${familyLabel} behavior family` : ""}.`,
        compositionText ? `Composition: ${compositionText}.` : null,
        "Drifter hull effects, turbo-shield presentation, and superweapon sequencing now ride the native combat path instead of a fake fitted-module harness.",
        clearedText.trim(),
      ].filter(Boolean).join(" "),
    };
  }

  const spawnSelection = resolveDrifterSpawnSelection(parsed.query);
  const variant = spawnSelection.variant;
  if (!variant) {
    return {
      success: false,
      message: "Unknown /drifter variant. Use a known Drifter hull alias such as battleship, response, lancer, polemarkos, navarkos, strategos, random, or prefix one with a behavior family like roaming battleship or dungeon random.",
    };
  }

  const definitions = Array.from(
    { length: parsed.amount },
    (_, index) => buildDrifterDefinition(variant, index, {
      behaviorFamily: spawnSelection.behaviorFamily,
    }),
  );
  const familyLabel = spawnSelection.behaviorFamily && spawnSelection.behaviorFamily !== DRIFTER_BEHAVIOR_FAMILY.DEFAULT
    ? spawnSelection.behaviorFamily
    : null;
  const selectionLabelPrefix = familyLabel
    ? `${familyLabel} ${variant.label}`
    : variant.label;
  const result = spawnDefinitionPackForSession(session, definitions, {
    operatorKind: DRIFTER_OPERATOR_KIND,
    selectionID: `drifter:${String(selectionLabelPrefix).toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    selectionName: `${selectionLabelPrefix} Drifter Test Pack`,
    preferredTargetID: session && session._space ? session._space.shipID : 0,
    runtimeKind: "nativeCombat",
    behaviorOverrides: {
      allowPodKill: true,
    },
    spawnDistanceMeters: Math.max(1_000, toInt(variant && variant.spawnDistanceMeters, 20_000)),
    formationSpacingMeters: 1_500,
    spreadMeters: 0,
  });
  if (!result.success || !result.data) {
    if (result.errorMsg === "NOT_IN_SPACE") {
      return {
        success: false,
        message: "You must be in space before using /drifter.",
      };
    }
    if (result.errorMsg === "SHIP_NOT_FOUND") {
      return {
        success: false,
        message: "Active ship was not found in space.",
      };
    }
    return {
      success: false,
      message: `/drifter failed: ${result.errorMsg || "UNKNOWN_ERROR"}.`,
    };
  }

  const clearedText = result.data.clearedCount > 0
    ? ` Cleared ${result.data.clearedCount} previous /drifter hull${result.data.clearedCount === 1 ? "" : "s"}.`
    : "";
  return {
    success: true,
    message: [
      `Spawned ${result.data.spawned.length} transient ${variant.label} /drifter hull${result.data.spawned.length === 1 ? "" : "s"} on the native NPC path${familyLabel ? ` using the ${familyLabel} behavior family` : ""}.`,
      "Drifter hull effects, turbo-shield presentation, and superweapon sequencing now ride the native combat path instead of a fake fitted-module harness.",
      clearedText.trim(),
    ].filter(Boolean).join(" "),
  };
}

function executeTrigDrifterCommand(session, command, argumentText = "") {
  const normalizedCommand = String(command || "").trim().toLowerCase();
  if (normalizedCommand === "trigspawn") {
    return executeTrigSpawnCommand(session, argumentText);
  }
  if (normalizedCommand === "drifter") {
    return executeDrifterCommand(session, argumentText);
  }
  return {
    success: false,
    message: `Unknown command: /${normalizedCommand}.`,
  };
}

module.exports = {
  TRIG_DRIFTER_CHAT_COMMANDS,
  TRIG_DRIFTER_HELP_LINES,
  executeTrigDrifterCommand,
  __testing: {
    resolveTrigVariant,
    resolveDrifterVariant,
    resolveDrifterSpawnSelection,
    resolveDrifterRandomSelection,
    selectRandomDrifterVariants,
    buildTrigDefinition,
    buildDrifterDefinition,
    clearOperatorKindInSystem,
  },
};
