const path = require("path");

const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));

const DEBUG_TEST_AUTO_TARGET_RANGE_METERS = 250_000;

const SELF_PLAYABLE_EFFECTS = Object.freeze([
  {
    key: "cloak",
    guid: "effects.Cloak",
    aliases: ["cloakfx", "cloak_effect", "effects.cloak"],
    start: { duration: 60000 },
    stop: { start: false, active: false },
  },
  {
    key: "cloak_no_anim",
    guid: "effects.CloakNoAmim",
    aliases: [
      "cloaknoanim",
      "cloak_noamim",
      "cloaknoamim",
      "effects.cloaknoamim",
    ],
    start: { duration: 60000, active: false },
    stop: { start: false, active: false },
  },
  {
    key: "cloak_regardless",
    guid: "effects.CloakRegardless",
    aliases: [
      "cloakregardless",
      "force_cloak",
      "effects.cloakregardless",
    ],
    start: { duration: 60000 },
    stop: { start: false, active: false },
  },
  {
    key: "uncloak",
    guid: "effects.Uncloak",
    aliases: ["decloak", "effects.uncloak"],
    start: { duration: 6000, active: false },
    stop: { start: false, active: false },
  },
  {
    key: "triage",
    guid: "effects.TriageMode",
    aliases: ["triagemode", "effects.triagemode"],
    start: { duration: 60000 },
    stop: { start: false, active: false },
  },
  {
    key: "microjump",
    guid: "effects.MicroJumpDriveEngage",
    aliases: [
      "mjd",
      "micro_jump",
      "microjumpdriveengage",
      "effects.microjumpdriveengage",
    ],
    start: { duration: 4500, active: false },
    stop: { start: false, active: false },
  },
  {
    key: "jump_in",
    guid: "effects.JumpIn",
    aliases: ["jumpin", "effects.jumpin"],
    start: { duration: 5000, active: false },
    stop: { start: false, active: false },
  },
  {
    key: "jump_drive_in",
    guid: "effects.JumpDriveIn",
    aliases: ["jumpdrivein", "effects.jumpdrivein"],
    start: { duration: 5000, active: false },
    stop: { start: false, active: false },
  },
  {
    key: "jump_drive_in_bo",
    guid: "effects.JumpDriveInBO",
    aliases: ["jumpdriveinbo", "black_ops_jump_in", "effects.jumpdriveinbo"],
    start: { duration: 5000, active: false },
    stop: { start: false, active: false },
  },
  {
    key: "jump_portal",
    guid: "effects.JumpPortal",
    aliases: ["jumpportal", "effects.jumpportal"],
    start: { duration: 8000, active: false },
    stop: { start: false, active: false },
  },
  {
    key: "jump_portal_bo",
    guid: "effects.JumpPortalBO",
    aliases: ["jumpportalbo", "black_ops_portal", "effects.jumpportalbo"],
    start: { duration: 8000, active: false },
    stop: { start: false, active: false },
  },
  {
    key: "capsule_flare",
    guid: "effects.CapsuleFlare",
    aliases: ["capsuleflare", "effects.capsuleflare"],
    start: { duration: 4000, active: false },
    stop: { start: false, active: false },
  },
  {
    key: "whiteout",
    guid: "effects.WhiteOut",
    aliases: ["white_out", "effects.whiteout"],
    start: { duration: 60000, active: false },
    stop: { start: false, active: false },
  },
]);

// Debug/test-only targeted FX. These intentionally fake a nearby station target
// so GMs can preview visuals; they are not real gameplay effect plumbing.
const DEBUG_TEST_TARGETED_EFFECTS = Object.freeze([
  {
    key: "celestial_beam",
    guid: "effects.CelestialBeam",
    aliases: ["beam", "celestialbeam", "effects.celestialbeam"],
    start: { duration: 60000, active: true, graphicInfo: { isFiring: 1.0 } },
    stop: { start: false, active: false, graphicInfo: { isFiring: 0.0 } },
    debugAutoTarget: "nearest_station",
    debugAutoTargetRangeMeters: DEBUG_TEST_AUTO_TARGET_RANGE_METERS,
    debugOnly: true,
  },
  {
    key: "remote_armour_repair",
    guid: "effects.RemoteArmourRepair",
    aliases: [
      "remote_armor_repair",
      "remotearmourrepair",
      "remotearmorrepair",
      "effects.remotearmourrepair",
    ],
    start: { duration: 60000 },
    stop: { start: false, active: false },
    debugAutoTarget: "nearest_station",
    debugAutoTargetRangeMeters: DEBUG_TEST_AUTO_TARGET_RANGE_METERS,
    debugOnly: true,
  },
  {
    key: "shield_transfer",
    guid: "effects.ShieldTransfer",
    aliases: ["shieldtransfer", "effects.shieldtransfer"],
    start: { duration: 60000 },
    stop: { start: false, active: false },
    debugAutoTarget: "nearest_station",
    debugAutoTargetRangeMeters: DEBUG_TEST_AUTO_TARGET_RANGE_METERS,
    debugOnly: true,
  },
  {
    key: "data_link",
    guid: "effects.DataLink",
    aliases: ["datalink", "effects.datalink"],
    start: { duration: 60000 },
    stop: { start: false, active: false },
    debugAutoTarget: "nearest_station",
    debugAutoTargetRangeMeters: DEBUG_TEST_AUTO_TARGET_RANGE_METERS,
    debugOnly: true,
  },
  {
    key: "linked_to_trace_gate",
    guid: "effects.LinkedToTraceGate",
    aliases: ["linkedtotracegate", "trace_gate_link", "effects.linkedtotracegate"],
    start: { duration: 60000 },
    stop: { start: false, active: false },
    debugAutoTarget: "nearest_station",
    debugAutoTargetRangeMeters: DEBUG_TEST_AUTO_TARGET_RANGE_METERS,
    debugOnly: true,
  },
  {
    key: "main_bank_hacking_beam",
    guid: "effects.MainBankHackingBeam",
    aliases: ["mainbankhackingbeam", "main_bank_beam", "effects.mainbankhackingbeam"],
    start: { duration: 60000 },
    stop: { start: false, active: false },
    debugAutoTarget: "nearest_station",
    debugAutoTargetRangeMeters: DEBUG_TEST_AUTO_TARGET_RANGE_METERS,
    debugOnly: true,
  },
  {
    key: "reserve_bank_hacking_beam",
    guid: "effects.ReserveBankHackingBeam",
    aliases: [
      "reservebankhackingbeam",
      "reserve_bank_beam",
      "effects.reservebankhackingbeam",
    ],
    start: { duration: 60000 },
    stop: { start: false, active: false },
    debugAutoTarget: "nearest_station",
    debugAutoTargetRangeMeters: DEBUG_TEST_AUTO_TARGET_RANGE_METERS,
    debugOnly: true,
  },
  {
    key: "turbolaser",
    guid: "effects.TurboLaser",
    aliases: ["turbo_laser", "effects.turbolaser"],
    start: {
      duration: 12000,
      moduleTypeID: 24550,
      isOffensive: true,
    },
    stop: {
      start: false,
      active: false,
      moduleTypeID: 24550,
      isOffensive: true,
    },
    debugAutoTarget: "nearest_station",
    debugAutoTargetRangeMeters: DEBUG_TEST_AUTO_TARGET_RANGE_METERS,
    debugOnly: true,
  },
  {
    key: "lance_amarr",
    guid: "effects.SuperWeaponLanceAmarr",
    aliases: [
      "superweaponlanceamarr",
      "amarr_lance",
      "azmaru",
      "effects.superweaponlanceamarr",
    ],
    start: {
      duration: 12000,
      moduleTypeID: 77399,
      isOffensive: true,
    },
    stop: {
      start: false,
      active: false,
      moduleTypeID: 77399,
      isOffensive: true,
    },
    debugAutoTarget: "nearest_station",
    debugAutoTargetRangeMeters: DEBUG_TEST_AUTO_TARGET_RANGE_METERS,
    debugOnly: true,
  },
  {
    key: "lance_caldari",
    guid: "effects.SuperWeaponLanceCaldari",
    aliases: [
      "superweaponlancecaldari",
      "caldari_lance",
      "steel_yari",
      "effects.superweaponlancecaldari",
    ],
    start: {
      duration: 12000,
      moduleTypeID: 77400,
      isOffensive: true,
    },
    stop: {
      start: false,
      active: false,
      moduleTypeID: 77400,
      isOffensive: true,
    },
    debugAutoTarget: "nearest_station",
    debugAutoTargetRangeMeters: DEBUG_TEST_AUTO_TARGET_RANGE_METERS,
    debugOnly: true,
  },
  {
    key: "lance_gallente",
    guid: "effects.SuperWeaponLanceGallente",
    aliases: [
      "superweaponlancegallente",
      "gallente_lance",
      "sarissa",
      "effects.superweaponlancegallente",
    ],
    start: {
      duration: 12000,
      moduleTypeID: 77401,
      isOffensive: true,
    },
    stop: {
      start: false,
      active: false,
      moduleTypeID: 77401,
      isOffensive: true,
    },
    debugAutoTarget: "nearest_station",
    debugAutoTargetRangeMeters: DEBUG_TEST_AUTO_TARGET_RANGE_METERS,
    debugOnly: true,
  },
  {
    key: "lance_minmatar",
    guid: "effects.SuperWeaponLanceMinmatar",
    aliases: [
      "superweaponlanceminmatar",
      "minmatar_lance",
      "atgeir",
      "effects.superweaponlanceminmatar",
    ],
    start: {
      duration: 12000,
      moduleTypeID: 77398,
      isOffensive: true,
    },
    stop: {
      start: false,
      active: false,
      moduleTypeID: 77398,
      isOffensive: true,
    },
    debugAutoTarget: "nearest_station",
    debugAutoTargetRangeMeters: DEBUG_TEST_AUTO_TARGET_RANGE_METERS,
    debugOnly: true,
  },
  {
    key: "superweapon_amarr",
    guid: "effects.SuperWeaponAmarr",
    aliases: [
      "super_weapon_amarr",
      "amarr_doomsday",
      "judgment",
      "effects.superweaponamarr",
    ],
    start: {
      duration: 12000,
      moduleTypeID: 24550,
      isOffensive: true,
    },
    stop: {
      start: false,
      active: false,
      moduleTypeID: 24550,
      isOffensive: true,
    },
    debugAutoTarget: "nearest_station",
    debugAutoTargetRangeMeters: DEBUG_TEST_AUTO_TARGET_RANGE_METERS,
    debugOnly: true,
  },
  {
    key: "superweapon_caldari",
    guid: "effects.SuperWeaponCaldari",
    aliases: [
      "super_weapon_caldari",
      "caldari_doomsday",
      "oblivion",
      "effects.superweaponcaldari",
    ],
    start: {
      duration: 12000,
      moduleTypeID: 24552,
      isOffensive: true,
    },
    stop: {
      start: false,
      active: false,
      moduleTypeID: 24552,
      isOffensive: true,
    },
    debugAutoTarget: "nearest_station",
    debugAutoTargetRangeMeters: DEBUG_TEST_AUTO_TARGET_RANGE_METERS,
    debugOnly: true,
  },
  {
    key: "superweapon_gallente",
    guid: "effects.SuperWeaponGallente",
    aliases: [
      "super_weapon_gallente",
      "gallente_doomsday",
      "aurora_ominae",
      "effects.superweapongallente",
    ],
    start: {
      duration: 12000,
      moduleTypeID: 24554,
      isOffensive: true,
    },
    stop: {
      start: false,
      active: false,
      moduleTypeID: 24554,
      isOffensive: true,
    },
    debugAutoTarget: "nearest_station",
    debugAutoTargetRangeMeters: DEBUG_TEST_AUTO_TARGET_RANGE_METERS,
    debugOnly: true,
  },
  {
    key: "superweapon_minmatar",
    guid: "effects.SuperWeaponMinmatar",
    aliases: [
      "super_weapon_minmatar",
      "minmatar_doomsday",
      "gjallarhorn",
      "effects.superweaponminmatar",
    ],
    start: {
      duration: 12000,
      moduleTypeID: 23674,
      isOffensive: true,
    },
    stop: {
      start: false,
      active: false,
      moduleTypeID: 23674,
      isOffensive: true,
    },
    debugAutoTarget: "nearest_station",
    debugAutoTargetRangeMeters: DEBUG_TEST_AUTO_TARGET_RANGE_METERS,
    debugOnly: true,
  },
]);

const PLAYABLE_EFFECTS = Object.freeze([
  ...SELF_PLAYABLE_EFFECTS,
  ...DEBUG_TEST_TARGETED_EFFECTS,
]);

function normalizeEffectToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^effects\./, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const EFFECT_LOOKUP = new Map();
for (const effect of PLAYABLE_EFFECTS) {
  const candidates = new Set([
    effect.key,
    effect.guid,
    ...(Array.isArray(effect.aliases) ? effect.aliases : []),
  ]);
  for (const candidate of candidates) {
    const normalized = normalizeEffectToken(candidate);
    if (normalized) {
      EFFECT_LOOKUP.set(normalized, effect);
    }
  }
}

function resolvePlayableEffect(name) {
  const normalized = normalizeEffectToken(name);
  if (!normalized) {
    return null;
  }
  return EFFECT_LOOKUP.get(normalized) || null;
}

function listPlayableEffects() {
  return PLAYABLE_EFFECTS.map((effect) => effect.key);
}

function buildEffectListText() {
  const selfEffectKeys = SELF_PLAYABLE_EFFECTS.map((effect) => effect.key).join(", ");
  const debugTargetEffectKeys = DEBUG_TEST_TARGETED_EFFECTS.map((effect) => effect.key).join(", ");
  const debugTargetRangeKm = Math.round(DEBUG_TEST_AUTO_TARGET_RANGE_METERS / 1000);
  return [
    `Playable self FX: ${selfEffectKeys}.`,
    `Debug/test targeted FX: ${debugTargetEffectKeys}. These auto-use the nearest station within ${debugTargetRangeKm} km when you play them.`,
    "Use /effect <name> to play one, /effect stop <name> to stop one, /effect stop to stop all known self FX, or /effect list to see this again.",
    "The targeted entries are intentionally fake preview helpers only. They are not real gameplay implementations for weapons, remote modules, or target handling.",
  ].join(" ");
}

function playPlayableEffect(session, effectName, { stop = false } = {}) {
  const descriptor = resolvePlayableEffect(effectName);
  if (!descriptor) {
    return {
      success: false,
      errorMsg: "EFFECT_NOT_FOUND",
    };
  }

  const options = stop ? { ...descriptor.stop } : { ...descriptor.start };
  if (descriptor.debugAutoTarget) {
    options.debugAutoTarget = descriptor.debugAutoTarget;
    options.debugAutoTargetRangeMeters = descriptor.debugAutoTargetRangeMeters;
    options.debugOnly = descriptor.debugOnly === true;
  }
  const runtimeResult = spaceRuntime.playSpecialFx(session, descriptor.guid, options);
  if (!runtimeResult.success) {
    return runtimeResult;
  }

  return {
    success: true,
    data: {
      ...runtimeResult.data,
      effect: descriptor,
      stop,
    },
  };
}

function stopAllPlayableEffects(session) {
  let stopped = 0;
  let firstError = null;
  for (const effect of SELF_PLAYABLE_EFFECTS) {
    const runtimeResult = spaceRuntime.playSpecialFx(session, effect.guid, {
      ...effect.stop,
    });
    if (runtimeResult.success) {
      stopped += 1;
    } else if (!firstError) {
      firstError = runtimeResult.errorMsg;
    }
  }

  if (stopped === 0) {
    return {
      success: false,
      errorMsg: firstError || "EFFECT_STOP_FAILED",
    };
  }

  return {
    success: true,
    data: {
      stopped,
    },
  };
}

module.exports = {
  buildEffectListText,
  DEBUG_TEST_AUTO_TARGET_RANGE_METERS,
  listPlayableEffects,
  playPlayableEffect,
  resolvePlayableEffect,
  stopAllPlayableEffects,
};
