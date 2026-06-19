function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

const HUD_ICON_KIND_ASSISTANCE = "assistance";
const HUD_ICON_KIND_COMMAND_BURST = "commandBurst";
const HUD_ICON_KIND_HOSTILE = "hostile";
const HUD_ICON_KIND_GENERIC_FX = "genericFx";

const DELIVERY_PROFILE_BY_KIND = Object.freeze({
  [HUD_ICON_KIND_ASSISTANCE]: Object.freeze({
    usesJamTimer: true,
    usesTacticalEwar: true,
    usesDbuffRefresh: false,
  }),
  [HUD_ICON_KIND_COMMAND_BURST]: Object.freeze({
    usesJamTimer: false,
    usesTacticalEwar: false,
    usesDbuffRefresh: true,
  }),
  [HUD_ICON_KIND_HOSTILE]: Object.freeze({
    usesJamTimer: true,
    usesTacticalEwar: true,
    usesDbuffRefresh: false,
  }),
  [HUD_ICON_KIND_GENERIC_FX]: Object.freeze({
    usesJamTimer: false,
    usesTacticalEwar: false,
    usesDbuffRefresh: false,
  }),
});

const COMMAND_BURST_SLOT_BY_FAMILY = Object.freeze({
  armor: "armorBurst",
  information: "informationBurst",
  mining: "miningBurst",
  shield: "shieldBurst",
  skirmish: "skirmishBurst",
});

function getHudIconStateMap(entity, create = false) {
  if (!entity || typeof entity !== "object") {
    return null;
  }
  if (!(entity.hudIconStates instanceof Map) && create) {
    entity.hudIconStates = new Map();
  }
  return entity.hudIconStates instanceof Map
    ? entity.hudIconStates
    : null;
}

function buildHudIconStateKey(sourceBallID, moduleID, jammingType, targetBallID) {
  return [
    toInt(sourceBallID, 0),
    toInt(moduleID, 0),
    String(jammingType || ""),
    toInt(targetBallID, 0),
  ].join(":");
}

function buildHudIconState(input = {}) {
  const kind = String(input.kind || "").trim();
  const jammingType = String(input.jammingType || "").trim();
  const sourceBallID = toInt(input.sourceBallID, 0);
  const moduleID = toInt(input.moduleID, 0);
  const targetBallID = toInt(input.targetBallID, 0);
  const startedAtMs = Math.max(0, toFiniteNumber(input.startedAtMs, Date.now()));
  const expiresAtMs =
    input.expiresAtMs === null || input.expiresAtMs === undefined
      ? null
      : Math.max(0, toFiniteNumber(input.expiresAtMs, startedAtMs));
  const deliveryProfile = DELIVERY_PROFILE_BY_KIND[kind] || DELIVERY_PROFILE_BY_KIND[HUD_ICON_KIND_GENERIC_FX];
  if (kind === "" || sourceBallID <= 0 || moduleID <= 0 || targetBallID <= 0) {
    return null;
  }
  if ((deliveryProfile.usesJamTimer || deliveryProfile.usesTacticalEwar) && jammingType === "") {
    return null;
  }

  return Object.freeze({
    key: String(input.key || buildHudIconStateKey(sourceBallID, moduleID, jammingType, targetBallID)),
    kind,
    sourceBallID,
    moduleID,
    targetBallID,
    jammingType,
    startedAtMs,
    expiresAtMs,
    deliveryProfile,
    metadata:
      input.metadata && typeof input.metadata === "object"
        ? Object.freeze({ ...input.metadata })
        : Object.freeze({}),
  });
}

function buildAssistanceHudIconState(targetEntity, sourceEntity, effectState, nowMs) {
  const startedAtMs = Math.max(0, toFiniteNumber(nowMs, Date.now()));
  const durationMs = Math.max(1, toInt(effectState && effectState.durationMs, 0));
  return buildHudIconState({
    kind: HUD_ICON_KIND_ASSISTANCE,
    sourceBallID: sourceEntity && sourceEntity.itemID,
    moduleID: effectState && effectState.moduleID,
    targetBallID: targetEntity && targetEntity.itemID,
    jammingType: effectState && effectState.assistanceJammingType,
    startedAtMs,
    expiresAtMs: startedAtMs + durationMs,
  });
}

function buildCommandBurstHudIconState(targetEntity, sourceEntity, effectState, nowMs) {
  const startedAtMs = Math.max(0, toFiniteNumber(nowMs, Date.now()));
  const durationMs = Math.max(1, toInt(effectState && effectState.commandBurstBuffDurationMs, 0));
  return buildHudIconState({
    kind: HUD_ICON_KIND_COMMAND_BURST,
    sourceBallID: sourceEntity && sourceEntity.itemID,
    moduleID: effectState && effectState.moduleID,
    targetBallID: targetEntity && targetEntity.itemID,
    jammingType: COMMAND_BURST_SLOT_BY_FAMILY[String(effectState && effectState.commandBurstFamily || "")],
    startedAtMs,
    expiresAtMs: startedAtMs + durationMs,
  });
}

function buildHostileHudIconState(targetEntity, sourceEntity, effectState, nowMs) {
  const startedAtMs = Math.max(0, toFiniteNumber(nowMs, Date.now()));
  const durationMs = Math.max(1, toInt(effectState && effectState.durationMs, 0));
  return buildHudIconState({
    kind: HUD_ICON_KIND_HOSTILE,
    sourceBallID: sourceEntity && sourceEntity.itemID,
    moduleID: effectState && effectState.moduleID,
    targetBallID: targetEntity && targetEntity.itemID,
    jammingType: effectState && effectState.hostileJammingType,
    startedAtMs,
    expiresAtMs: startedAtMs + durationMs,
  });
}

function buildJammerHudIconState(targetEntity, sourceEntity, effectState, nowMs) {
  const startedAtMs = Math.max(0, toFiniteNumber(nowMs, Date.now()));
  const durationMs = Math.max(
    1,
    toInt(
      effectState && effectState.jamDurationMs,
      toInt(effectState && effectState.durationMs, 0),
    ),
  );
  return buildHudIconState({
    kind: HUD_ICON_KIND_HOSTILE,
    sourceBallID: sourceEntity && sourceEntity.itemID,
    moduleID: effectState && effectState.moduleID,
    targetBallID: targetEntity && targetEntity.itemID,
    jammingType: effectState && effectState.hostileJammingType,
    startedAtMs,
    expiresAtMs: startedAtMs + durationMs,
  });
}

function upsertHudIconState(entity, hudState) {
  if (!hudState) {
    return {
      changed: false,
      state: null,
    };
  }
  const stateMap = getHudIconStateMap(entity, true);
  const previousState = stateMap.get(hudState.key) || null;
  stateMap.set(hudState.key, hudState);
  return {
    changed:
      !previousState ||
      previousState.startedAtMs !== hudState.startedAtMs ||
      previousState.expiresAtMs !== hudState.expiresAtMs,
    state: hudState,
  };
}

function removeHudIconState(entity, keyOrState) {
  const stateMap = getHudIconStateMap(entity, false);
  if (!(stateMap instanceof Map) || stateMap.size <= 0) {
    return null;
  }
  const key =
    keyOrState && typeof keyOrState === "object"
      ? String(keyOrState.key || "")
      : String(keyOrState || "");
  if (key === "") {
    return null;
  }
  const existingState = stateMap.get(key) || null;
  if (!existingState) {
    return null;
  }
  stateMap.delete(key);
  return existingState;
}

function pruneExpiredHudIconStates(entity, nowMs, options = {}) {
  const stateMap = getHudIconStateMap(entity, false);
  if (!(stateMap instanceof Map) || stateMap.size <= 0) {
    return {
      removed: [],
      active: [],
    };
  }

  const resolvedNowMs = Math.max(0, toFiniteNumber(nowMs, Date.now()));
  const filterKind = options.kind ? String(options.kind) : null;
  const removed = [];
  for (const [key, hudState] of [...stateMap.entries()]) {
    if (filterKind && hudState.kind !== filterKind) {
      continue;
    }
    if (
      hudState.expiresAtMs === null ||
      hudState.expiresAtMs === undefined ||
      toFiniteNumber(hudState.expiresAtMs, 0) > resolvedNowMs
    ) {
      continue;
    }
    removed.push(hudState);
    stateMap.delete(key);
  }

  return {
    removed,
    active: [...stateMap.values()].filter((hudState) => (
      (!filterKind || hudState.kind === filterKind) &&
      (
        hudState.expiresAtMs === null ||
        hudState.expiresAtMs === undefined ||
        toFiniteNumber(hudState.expiresAtMs, 0) > resolvedNowMs
      )
    )),
  };
}

function listActiveHudIconStates(entity, nowMs, options = {}) {
  return pruneExpiredHudIconStates(entity, nowMs, options).active;
}

module.exports = {
  HUD_ICON_KIND_ASSISTANCE,
  HUD_ICON_KIND_COMMAND_BURST,
  HUD_ICON_KIND_HOSTILE,
  DELIVERY_PROFILE_BY_KIND,
  buildHudIconState,
  buildAssistanceHudIconState,
  buildCommandBurstHudIconState,
  buildHostileHudIconState,
  buildJammerHudIconState,
  upsertHudIconState,
  removeHudIconState,
  pruneExpiredHudIconStates,
  listActiveHudIconStates,
};
