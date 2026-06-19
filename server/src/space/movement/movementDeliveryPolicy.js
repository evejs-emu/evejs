const {
  MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
  MICHELLE_HELD_FUTURE_DESTINY_LEAD,
  MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
} = require("./movementMichelleContract");

const DESTINY_STAMP_INTERVAL_MS = 1000;
const DESTINY_STAMP_MAX_LEAD = 1;

// This module owns the server-side delivery policy built on top of Michelle's
// smaller client timing contract. The Michelle primitives themselves live in
// `movementMichelleContract.js`; the constants below are derived send/restamp
// rules that attempt to land our packets inside that contract safely.

// Adjacent owner steering echoes are often the same intended heading with tiny
// float jitter from repeated client `CmdGotoDirection` input. Keeping this too
// close to `1.0` lets effectively identical steers through, which then shows up
// as current-1 rewinds just before stop / combat transitions.
const OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT = 0.9998;

// Warp prepare is different from Michelle's ordinary held-future window: we
// intentionally schedule an authoritative future activation tick so the pilot
// keeps aligning locally until warp actually starts. The `warp.pre_start.ego`
// traces show `prepareStamp` landing about 4 seconds after `requestedAtMs`,
// which makes this a staged activation contract, not an extra Michelle lane.
function toInt(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric);
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? Math.trunc(fallbackNumeric) : 0;
}

function toUInt32(value) {
  return toInt(value, 0) >>> 0;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? fallbackNumeric : 0;
}

function projectPreviouslySentDestinyLane(
  sentLaneStamp,
  sentRawDispatchStamp,
  currentRawDispatchStamp,
) {
  const normalizedSentLaneStamp = toUInt32(sentLaneStamp);
  const normalizedSentRawDispatchStamp = toUInt32(sentRawDispatchStamp);
  const normalizedCurrentRawDispatchStamp = toUInt32(currentRawDispatchStamp);
  if (
    normalizedSentLaneStamp <= 0 ||
    normalizedSentRawDispatchStamp <= 0 ||
    normalizedCurrentRawDispatchStamp <= normalizedSentRawDispatchStamp
  ) {
    return 0;
  }
  return (
    normalizedSentLaneStamp +
    (normalizedCurrentRawDispatchStamp - normalizedSentRawDispatchStamp)
  ) >>> 0;
}

function resolvePreviousLastSentDestinyWasOwnerCritical(options = {}) {
  const previousLastSentDestinyStamp = toUInt32(
    options.previousLastSentDestinyStamp,
  );
  if (previousLastSentDestinyStamp <= 0) {
    return false;
  }

  const inferredTrackedOwnerCriticalLane = (
    previousLastSentDestinyStamp === toUInt32(options.lastOwnerMissileFreshAcquireStamp) ||
    previousLastSentDestinyStamp === toUInt32(options.lastOwnerNonMissileCriticalStamp) ||
    previousLastSentDestinyStamp === toUInt32(options.lastOwnerPilotCommandMovementStamp)
  );
  const inferredOwnerDamageLifecycleLane =
    previousLastSentDestinyStamp === toUInt32(options.lastOwnerMissileLifecycleStamp) &&
    previousLastSentDestinyStamp !== toUInt32(options.lastOwnerMissileFreshAcquireStamp);

  if (options.explicitWasOwnerCritical === true) {
    return true;
  }
  if (options.explicitWasOwnerCritical === false) {
    return inferredTrackedOwnerCriticalLane;
  }

  return inferredTrackedOwnerCriticalLane || inferredOwnerDamageLifecycleLane;
}

function resolveProjectedRecentLastSentLane(options = {}) {
  const previousLastSentDestinyStamp = toUInt32(
    options.previousLastSentDestinyStamp,
  );
  const previousLastSentDestinyRawDispatchStamp = toUInt32(
    options.previousLastSentDestinyRawDispatchStamp,
  );
  const currentRawDispatchStamp = toUInt32(options.currentRawDispatchStamp);
  const maximumDispatchDelta = Math.max(
    0,
    toInt(options.maximumDispatchDelta, 2),
  );

  if (
    previousLastSentDestinyStamp <= 0 ||
    previousLastSentDestinyRawDispatchStamp <= 0 ||
    currentRawDispatchStamp <= previousLastSentDestinyRawDispatchStamp ||
    (
      currentRawDispatchStamp - previousLastSentDestinyRawDispatchStamp
    ) > maximumDispatchDelta
  ) {
    return 0;
  }

  return projectPreviouslySentDestinyLane(
    previousLastSentDestinyStamp,
    previousLastSentDestinyRawDispatchStamp,
    currentRawDispatchStamp,
  );
}

function getRecentTrustedLane(options = {}) {
  const laneStamp = toUInt32(options.laneStamp);
  const currentStamp = toUInt32(options.currentStamp);
  const maximumLead = Math.max(
    0,
    toInt(options.maximumLead, MICHELLE_HELD_FUTURE_DESTINY_LEAD),
  );
  if (
    laneStamp <= currentStamp ||
    laneStamp > ((currentStamp + maximumLead) >>> 0)
  ) {
    return 0;
  }

  const laneRawDispatchStamp = toUInt32(options.laneRawDispatchStamp);
  const currentRawDispatchStamp = toUInt32(options.currentRawDispatchStamp);
  const maximumRawDispatchDelta = Math.max(
    0,
    toInt(options.maximumRawDispatchDelta, 2),
  );
  if (laneRawDispatchStamp > 0) {
    if (currentRawDispatchStamp < laneRawDispatchStamp) {
      return 0;
    }
    if ((currentRawDispatchStamp - laneRawDispatchStamp) > maximumRawDispatchDelta) {
      return 0;
    }
  }

  return laneStamp >>> 0;
}

function getRecentProjectedLane(options = {}) {
  const laneStamp = toUInt32(options.laneStamp);
  const laneRawDispatchStamp = toUInt32(options.laneRawDispatchStamp);
  const currentRawDispatchStamp = toUInt32(options.currentRawDispatchStamp);
  if (
    laneStamp <= 0 ||
    laneRawDispatchStamp <= 0 ||
    currentRawDispatchStamp <= laneRawDispatchStamp
  ) {
    return 0;
  }

  return getRecentTrustedLane({
    laneStamp: projectPreviouslySentDestinyLane(
      laneStamp,
      laneRawDispatchStamp,
      currentRawDispatchStamp,
    ),
    currentStamp: options.currentStamp,
    currentRawDispatchStamp,
    maximumLead: options.maximumLead,
    maximumRawDispatchDelta: options.maximumRawDispatchDelta,
  });
}

function resolveRecentOwnerLaneState(options = {}) {
  const laneStamp = toUInt32(options.laneStamp);
  const laneAnchorStamp = toUInt32(options.laneAnchorStamp);
  const laneRawDispatchStamp = toUInt32(options.laneRawDispatchStamp);
  const currentSessionStamp = toUInt32(options.currentSessionStamp);
  const currentImmediateSessionStamp = toUInt32(
    options.currentImmediateSessionStamp,
  );
  const currentRawDispatchStamp = toUInt32(options.currentRawDispatchStamp);
  const maximumRawDispatchDelta = Math.max(
    0,
    toInt(options.maximumRawDispatchDelta, 2),
  );
  const maximumProjectedLead = Math.max(
    0,
    toInt(
      options.maximumProjectedLead,
      MICHELLE_HELD_FUTURE_DESTINY_LEAD +
        MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
    ),
  );
  const allowFarAheadReuseAfterRawAdvance =
    options.allowFarAheadReuseAfterRawAdvance !== false;
  if (laneStamp <= 0) {
    return {
      laneStamp: 0,
      recentLane: 0,
      projectedConsumedLane: 0,
      rawDispatchDelta: 0,
      anchorDelta: 0,
      progressDelta: 0,
    };
  }

  const rawDispatchDelta =
    laneRawDispatchStamp > 0 &&
    currentRawDispatchStamp >= laneRawDispatchStamp
      ? (
          currentRawDispatchStamp - laneRawDispatchStamp
        ) >>> 0
      : 0;
  const hasRecentRawWindow =
    laneRawDispatchStamp > 0 &&
    currentRawDispatchStamp >= laneRawDispatchStamp &&
    rawDispatchDelta <= maximumRawDispatchDelta;
  const anchorDelta =
    laneAnchorStamp > 0 &&
    currentSessionStamp >= laneAnchorStamp
      ? (
          currentSessionStamp - laneAnchorStamp
        ) >>> 0
      : 0;
  const progressDelta = Math.max(rawDispatchDelta, anchorDelta) >>> 0;
  const nearbyProjectedCeiling = (
    currentImmediateSessionStamp + maximumProjectedLead
  ) >>> 0;
  const allowRecentLaneReuse =
    laneStamp > currentImmediateSessionStamp &&
    (
      allowFarAheadReuseAfterRawAdvance === true ||
      rawDispatchDelta <= 0 ||
      laneStamp <= nearbyProjectedCeiling
    );
  const recentLane =
    allowRecentLaneReuse &&
    (
      hasRecentRawWindow ||
      (
        laneRawDispatchStamp <= 0 &&
        laneAnchorStamp > 0 &&
        currentSessionStamp >= laneAnchorStamp
      )
    )
      ? laneStamp
      : 0;
  const projectedLane =
    progressDelta > 0
      ? ((laneStamp + progressDelta) >>> 0)
      : 0;
  // Only raw-dispatch-recent lanes may keep projecting consumed history once a
  // concrete raw stamp exists. `npc4.txt` exposed the failure mode: an old
  // owner steer from raw 3812 was still being projected from its anchor stamp
  // at raw 3836, which let ancient movement masquerade as fresh owner-critical
  // history and shoved owner missile add/remove groups out to +4/+5.
  const canProjectConsumedLane =
    projectedLane > laneStamp &&
    (
      laneRawDispatchStamp <= 0 ||
      hasRecentRawWindow
    );
  const projectedConsumedLane =
    canProjectConsumedLane &&
    projectedLane <= nearbyProjectedCeiling
      ? projectedLane
      : 0;

  return {
    laneStamp,
    recentLane,
    projectedConsumedLane,
    rawDispatchDelta,
    anchorDelta,
    progressDelta,
  };
}

function buildDecisionCandidate(label, value, extra = {}) {
  return {
    label,
    value: toUInt32(value),
    ...extra,
  };
}

function summarizeDecisionCandidates(candidates = [], selectedValue = 0) {
  const normalizedSelectedValue = toUInt32(selectedValue);
  const normalizedCandidates = Array.isArray(candidates)
    ? candidates.map((candidate) => ({
        ...candidate,
        value: toUInt32(candidate && candidate.value),
      }))
    : [];
  return {
    all: normalizedCandidates,
    active: normalizedCandidates.filter((candidate) => candidate.value > 0),
    winners:
      normalizedSelectedValue > 0
        ? normalizedCandidates.filter(
            (candidate) => candidate.value === normalizedSelectedValue,
          )
        : [],
  };
}

function formatRecentOwnerLaneStateSummary(label, state) {
  const resolvedState =
    state && typeof state === "object"
      ? state
      : {};
  return `${label}: lane=${toUInt32(resolvedState.laneStamp)} recent=${toUInt32(
    resolvedState.recentLane,
  )} projected=${toUInt32(resolvedState.projectedConsumedLane)} rawDelta=${toUInt32(
    resolvedState.rawDispatchDelta,
  )} anchorDelta=${toUInt32(resolvedState.anchorDelta)} progress=${toUInt32(
    resolvedState.progressDelta,
  )}`;
}

function formatDecisionCandidateSummary(summary) {
  const active = summary && Array.isArray(summary.active) ? summary.active : [];
  const winners = summary && Array.isArray(summary.winners) ? summary.winners : [];
  const winnerLabels = new Set(winners.map((entry) => entry.label));
  return active.map((entry) =>
    `${winnerLabels.has(entry.label) ? "*" : ""}${entry.label}=${toUInt32(entry.value)}`);
}

function resolveOwnerMonotonicState(options = {}) {
  const hasOwnerShip = options.hasOwnerShip === true;
  const containsMovementContractPayload =
    options.containsMovementContractPayload === true;
  const isSetStateGroup = options.isSetStateGroup === true;
  const isOwnerPilotMovementGroup =
    options.isOwnerPilotMovementGroup === true;
  const isMissileLifecycleGroup =
    options.isMissileLifecycleGroup === true;
  const isOwnerMissileLifecycleGroup =
    options.isOwnerMissileLifecycleGroup === true;
  const isOwnerCriticalGroup = options.isOwnerCriticalGroup === true;
  const isFreshAcquireLifecycleGroup =
    options.isFreshAcquireLifecycleGroup === true;
  const isOwnerDamageStateGroup =
    options.isOwnerDamageStateGroup === true;
  const allowAdjacentRawFreshAcquireLaneReuse =
    options.allowAdjacentRawFreshAcquireLaneReuse === true;
  const currentSessionStamp = toUInt32(options.currentSessionStamp);
  const currentImmediateSessionStamp = toUInt32(
    options.currentImmediateSessionStamp,
  );
  const currentLocalStamp = toUInt32(options.currentLocalStamp);
  const currentPresentedOwnerCriticalStamp = toUInt32(
    options.currentPresentedOwnerCriticalStamp,
  );
  const currentRawDispatchStamp = toUInt32(options.currentRawDispatchStamp);
  const recentEmittedOwnerCriticalMaxLead = Math.max(
    0,
    toInt(options.recentEmittedOwnerCriticalMaxLead, 0),
  );
  const ownerCriticalCeilingLead = Math.max(
    0,
    toInt(
      options.ownerCriticalCeilingLead,
      MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    ),
  );
  const previousLastSentDestinyStamp = toUInt32(
    options.previousLastSentDestinyStamp,
  );
  const previousLastSentDestinyRawDispatchStamp = toUInt32(
    options.previousLastSentDestinyRawDispatchStamp,
  );
  const previousLastSentDestinyExplicitWasOwnerCritical =
    options.previousLastSentDestinyExplicitWasOwnerCritical === true;
  const previousLastSentDestinyWasOwnerCritical =
    options.previousLastSentDestinyWasOwnerCritical === true;
  const previousLastSentDestinyOnlyStaleProjectedOwnerMissileLane =
    options.previousLastSentDestinyOnlyStaleProjectedOwnerMissileLane === true;
  const lastOwnerPilotCommandMovementStamp = toUInt32(
    options.lastOwnerPilotCommandMovementStamp,
  );
  const lastOwnerPilotCommandMovementAnchorStamp = toUInt32(
    options.lastOwnerPilotCommandMovementAnchorStamp,
  );
  const lastOwnerPilotCommandMovementRawDispatchStamp = toUInt32(
    options.lastOwnerPilotCommandMovementRawDispatchStamp,
  );
  const lastOwnerNonMissileCriticalStamp = toUInt32(
    options.lastOwnerNonMissileCriticalStamp,
  );
  const lastOwnerMissileLifecycleStamp = toUInt32(
    options.lastOwnerMissileLifecycleStamp,
  );
  const lastOwnerMissileLifecycleAnchorStamp = toUInt32(
    options.lastOwnerMissileLifecycleAnchorStamp,
  );
  const lastOwnerMissileLifecycleRawDispatchStamp = toUInt32(
    options.lastOwnerMissileLifecycleRawDispatchStamp,
  );
  const lastOwnerMissileFreshAcquireStamp = toUInt32(
    options.lastOwnerMissileFreshAcquireStamp,
  );
  const lastOwnerMissileFreshAcquireAnchorStamp = toUInt32(
    options.lastOwnerMissileFreshAcquireAnchorStamp,
  );
  const lastOwnerMissileFreshAcquireRawDispatchStamp = toUInt32(
    options.lastOwnerMissileFreshAcquireRawDispatchStamp,
  );

  const maximumTrustedRecentEmittedOwnerCriticalStamp =
    hasOwnerShip
      ? (
        (
          currentSessionStamp +
          recentEmittedOwnerCriticalMaxLead
        ) >>> 0
      )
      : 0;
  const maximumProjectedOwnerCriticalLead = Math.max(
    MICHELLE_HELD_FUTURE_DESTINY_LEAD +
      MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
    recentEmittedOwnerCriticalMaxLead +
      MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
  );
  const projectedRecentLastSentLane = resolveProjectedRecentLastSentLane({
    previousLastSentDestinyStamp,
    previousLastSentDestinyRawDispatchStamp,
    currentRawDispatchStamp,
    maximumDispatchDelta: 2,
  });
  const previousLastSentDestinyAnchorStamp =
    previousLastSentDestinyStamp === lastOwnerPilotCommandMovementStamp
      ? lastOwnerPilotCommandMovementAnchorStamp
      : previousLastSentDestinyStamp === lastOwnerMissileLifecycleStamp
        ? lastOwnerMissileLifecycleAnchorStamp
        : previousLastSentDestinyStamp === lastOwnerMissileFreshAcquireStamp
          ? lastOwnerMissileFreshAcquireAnchorStamp
          : 0;
  const previousLastSentDestinyMatchesOwnerMissileLane =
    previousLastSentDestinyStamp === lastOwnerMissileLifecycleStamp ||
    previousLastSentDestinyStamp === lastOwnerMissileFreshAcquireStamp;
  const previousLastSentDestinyWasOwnerDamageLifecycleLane =
    previousLastSentDestinyExplicitWasOwnerCritical !== true &&
    previousLastSentDestinyWasOwnerCritical !== true &&
    previousLastSentDestinyStamp > 0 &&
    previousLastSentDestinyStamp === lastOwnerMissileLifecycleStamp &&
    previousLastSentDestinyStamp !== lastOwnerMissileFreshAcquireStamp;
  const recentOverallLastSentState = resolveRecentOwnerLaneState({
    laneStamp: previousLastSentDestinyStamp,
    laneAnchorStamp: previousLastSentDestinyAnchorStamp,
    laneRawDispatchStamp: previousLastSentDestinyRawDispatchStamp,
    currentSessionStamp,
    currentImmediateSessionStamp,
    currentRawDispatchStamp,
    maximumProjectedLead: maximumProjectedOwnerCriticalLead,
    allowFarAheadReuseAfterRawAdvance: !(
      previousLastSentDestinyOnlyStaleProjectedOwnerMissileLane === true &&
      previousLastSentDestinyMatchesOwnerMissileLane
    ),
  });
  const recentPresentedLastSentLane =
    hasOwnerShip &&
    previousLastSentDestinyStamp > 0 &&
    currentPresentedOwnerCriticalStamp > 0 &&
    previousLastSentDestinyStamp === currentPresentedOwnerCriticalStamp &&
    previousLastSentDestinyRawDispatchStamp > 0 &&
    currentRawDispatchStamp >= previousLastSentDestinyRawDispatchStamp &&
    (
      currentRawDispatchStamp - previousLastSentDestinyRawDispatchStamp
    ) <= 2 &&
    (
      previousLastSentDestinyStamp <=
        maximumTrustedRecentEmittedOwnerCriticalStamp ||
      previousLastSentDestinyRawDispatchStamp === currentRawDispatchStamp
    )
      ? previousLastSentDestinyStamp
      : 0;
  const recentNonCriticalLastSentLane =
    containsMovementContractPayload &&
    !isSetStateGroup &&
    previousLastSentDestinyWasOwnerCritical !== true
      ? getRecentTrustedLane({
          laneStamp: previousLastSentDestinyStamp,
          currentStamp: currentSessionStamp,
          currentRawDispatchStamp,
          laneRawDispatchStamp: previousLastSentDestinyRawDispatchStamp,
          maximumLead: recentEmittedOwnerCriticalMaxLead,
          maximumRawDispatchDelta: 2,
        })
      : 0;
  // Once Michelle is still legitimately presenting a previously sent future
  // lane, any newer group for the same session must stay on or above that lane
  // instead of rewinding under it. This applies even to non-movement groups
  // such as damage-state, add/remove, or slim/bootstrap bundles.
  //
  // CRITICAL: Cap the floor to currentSessionStamp + ownerCriticalCeilingLead.
  // Without this cap, isOwnerDamageStateGroup events (OnDamageStateChange)
  // compound +1 per event with no ceiling, advancing stamps far ahead of wall
  // clock (e.g., +9 ticks). The client processes entries 3+ ticks ahead
  // IMMEDIATELY, jumping _current_time forward and re-extrapolating all ball
  // positions — causing massive jolting. Subsequent near-current-time missile
  // updates then arrive BELOW the jumped _current_time, applying stale state.
  const presentedLastSentCeilingCap =
    hasOwnerShip
      // A lane the session is already presenting is safe to reuse as a hard
      // ceiling. Clamping below it creates owner-only backsteps.
      ? Math.max(
          ((currentSessionStamp + ownerCriticalCeilingLead) >>> 0),
          currentPresentedOwnerCriticalStamp,
        ) >>> 0
      : 0;
  const uncappedPresentedLastSentMonotonicFloor =
    recentPresentedLastSentLane > 0
      ? (
          (
            isOwnerCriticalGroup ||
            isOwnerDamageStateGroup
          ) &&
          previousLastSentDestinyMatchesOwnerMissileLane !== true
            ? ((recentPresentedLastSentLane + 1) >>> 0)
            : recentPresentedLastSentLane
        )
      : 0;
  const presentedLastSentMonotonicFloor =
    uncappedPresentedLastSentMonotonicFloor > 0 &&
    presentedLastSentCeilingCap > 0
      ? Math.min(
          uncappedPresentedLastSentMonotonicFloor,
          presentedLastSentCeilingCap,
        ) >>> 0
      : uncappedPresentedLastSentMonotonicFloor;
  const recentOwnerMovementState = resolveRecentOwnerLaneState({
    laneStamp: lastOwnerPilotCommandMovementStamp,
    laneAnchorStamp: lastOwnerPilotCommandMovementAnchorStamp,
    laneRawDispatchStamp: lastOwnerPilotCommandMovementRawDispatchStamp,
    currentSessionStamp,
    currentImmediateSessionStamp,
    currentRawDispatchStamp,
    maximumProjectedLead: maximumProjectedOwnerCriticalLead,
  });
  const recentOwnerMissileLifecycleState = resolveRecentOwnerLaneState({
    laneStamp: lastOwnerMissileLifecycleStamp,
    laneAnchorStamp: lastOwnerMissileLifecycleAnchorStamp,
    laneRawDispatchStamp: lastOwnerMissileLifecycleRawDispatchStamp,
    currentSessionStamp,
    currentImmediateSessionStamp,
    currentRawDispatchStamp,
    maximumProjectedLead: maximumProjectedOwnerCriticalLead,
    allowFarAheadReuseAfterRawAdvance: true,
  });
  const recentOwnerFreshAcquireState = resolveRecentOwnerLaneState({
    laneStamp: lastOwnerMissileFreshAcquireStamp,
    laneAnchorStamp: lastOwnerMissileFreshAcquireAnchorStamp,
    laneRawDispatchStamp: lastOwnerMissileFreshAcquireRawDispatchStamp,
    currentSessionStamp,
    currentImmediateSessionStamp,
    currentRawDispatchStamp,
    maximumProjectedLead: maximumProjectedOwnerCriticalLead,
    allowFarAheadReuseAfterRawAdvance: true,
  });
  const recentOverallOwnerCriticalState =
    previousLastSentDestinyWasOwnerCritical === true &&
    !(
      previousLastSentDestinyOnlyStaleProjectedOwnerMissileLane === true &&
      previousLastSentDestinyMatchesOwnerMissileLane
    )
      ? resolveRecentOwnerLaneState({
          laneStamp: previousLastSentDestinyStamp,
          laneAnchorStamp: previousLastSentDestinyAnchorStamp,
          laneRawDispatchStamp: previousLastSentDestinyRawDispatchStamp,
          currentSessionStamp,
          currentImmediateSessionStamp,
          currentRawDispatchStamp,
          maximumProjectedLead: maximumProjectedOwnerCriticalLead,
          allowFarAheadReuseAfterRawAdvance:
            !previousLastSentDestinyMatchesOwnerMissileLane,
        })
      : {
          recentLane: 0,
          projectedConsumedLane: 0,
          rawDispatchDelta: 0,
          anchorDelta: 0,
          progressDelta: 0,
        };
  const uncappedGenericMonotonicFloor =
    containsMovementContractPayload &&
    !isSetStateGroup &&
    !isOwnerMissileLifecycleGroup &&
    !isOwnerCriticalGroup &&
    recentNonCriticalLastSentLane > 0
      ? Math.max(
          recentNonCriticalLastSentLane,
          projectedRecentLastSentLane,
        ) >>> 0
      : 0;
  const genericMonotonicFloor =
    uncappedGenericMonotonicFloor > 0 &&
    presentedLastSentCeilingCap > 0
      ? Math.min(
          uncappedGenericMonotonicFloor,
          presentedLastSentCeilingCap,
        ) >>> 0
      : uncappedGenericMonotonicFloor;
  const recentOwnerCriticalLane =
    isOwnerCriticalGroup &&
    previousLastSentDestinyWasOwnerCritical === true
      ? (
          recentPresentedLastSentLane > 0
            ? recentPresentedLastSentLane
            : (
                (
                  maximumTrustedRecentEmittedOwnerCriticalStamp <= 0 ||
                  previousLastSentDestinyStamp <=
                    maximumTrustedRecentEmittedOwnerCriticalStamp
                )
                  ? getRecentTrustedLane({
                      laneStamp: previousLastSentDestinyStamp,
                      currentStamp: currentSessionStamp,
                      currentRawDispatchStamp,
                      laneRawDispatchStamp: previousLastSentDestinyRawDispatchStamp,
                      maximumLead:
                        recentEmittedOwnerCriticalMaxLead +
                        MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
                      maximumRawDispatchDelta: 2,
                    })
                  : 0
              )
        )
      : 0;
  const recentOwnerCriticalRawDispatchDelta =
    previousLastSentDestinyRawDispatchStamp > 0 &&
    currentRawDispatchStamp >= previousLastSentDestinyRawDispatchStamp
      ? (
          currentRawDispatchStamp - previousLastSentDestinyRawDispatchStamp
        ) >>> 0
      : 0;
  const isTrustedRecentOwnerCriticalLane = (
    lane,
    rawDispatchDelta = 0,
    allowBeyondBufferedCeiling = false,
  ) => (
    lane > 0 &&
    (
      rawDispatchDelta === 0 ||
      allowBeyondBufferedCeiling === true ||
      maximumTrustedRecentEmittedOwnerCriticalStamp <= 0 ||
      lane <= maximumTrustedRecentEmittedOwnerCriticalStamp
    )
  );
  const allowFarAheadRecentOwnerMissileLifecycleLane =
    recentOwnerMissileLifecycleState.rawDispatchDelta === 1 &&
    previousLastSentDestinyOnlyStaleProjectedOwnerMissileLane !== true &&
    lastOwnerMissileFreshAcquireStamp > 0 &&
    lastOwnerMissileLifecycleStamp ===
      ((lastOwnerMissileFreshAcquireStamp + 1) >>> 0) &&
    lastOwnerMissileFreshAcquireRawDispatchStamp > 0 &&
    lastOwnerMissileFreshAcquireRawDispatchStamp ===
      lastOwnerMissileLifecycleRawDispatchStamp;
  const allowFarAheadRecentOverallOwnerCriticalLane =
    recentOverallLastSentState.rawDispatchDelta === 1 ||
    recentOverallOwnerCriticalState.rawDispatchDelta === 1;
  const previousLastSentDestinyMatchesTrackedOwnerCriticalLane =
    previousLastSentDestinyStamp === lastOwnerPilotCommandMovementStamp ||
    previousLastSentDestinyStamp === lastOwnerNonMissileCriticalStamp ||
    previousLastSentDestinyStamp === lastOwnerMissileLifecycleStamp ||
    previousLastSentDestinyStamp === lastOwnerMissileFreshAcquireStamp;
  const allowUntrackedRecentOverallOwnerLaneTrust =
    recentOverallLastSentState.rawDispatchDelta > 0 &&
    // Observer missile lifecycle is already handled by its own lifecycle
    // floor/ceiling contract. Treating an untracked prior observer missile
    // lane like owner-critical history lets RemoveBalls project themselves
    // forward again, which is exactly the glitch.txt 4816 -> 4820 -> 4824
    // runaway we are trying to avoid.
    isMissileLifecycleGroup !== true;
  const recentOverallLastSentTrustedLane =
    (
      previousLastSentDestinyMatchesTrackedOwnerCriticalLane === true ||
      allowUntrackedRecentOverallOwnerLaneTrust === true
    ) &&
    isTrustedRecentOwnerCriticalLane(
      recentOverallLastSentState.recentLane,
      recentOverallLastSentState.rawDispatchDelta,
      allowFarAheadRecentOverallOwnerCriticalLane,
    )
      ? recentOverallLastSentState.recentLane
      : 0;
  const recentOwnerMovementTrustedLane =
    isTrustedRecentOwnerCriticalLane(
      recentOwnerMovementState.recentLane,
      recentOwnerMovementState.rawDispatchDelta,
    )
      ? recentOwnerMovementState.recentLane
      : 0;
  const recentOwnerMissileLifecycleTrustedLane =
    isTrustedRecentOwnerCriticalLane(
      recentOwnerMissileLifecycleState.recentLane,
      recentOwnerMissileLifecycleState.rawDispatchDelta,
      allowFarAheadRecentOwnerMissileLifecycleLane,
    )
      ? recentOwnerMissileLifecycleState.recentLane
      : 0;
  const recentOwnerFreshAcquireTrustedLane =
    isTrustedRecentOwnerCriticalLane(
      recentOwnerFreshAcquireState.recentLane,
      recentOwnerFreshAcquireState.rawDispatchDelta,
    )
      ? recentOwnerFreshAcquireState.recentLane
      : 0;
  const recentOverallOwnerCriticalTrustedLane =
    (
      previousLastSentDestinyMatchesTrackedOwnerCriticalLane === true ||
      allowUntrackedRecentOverallOwnerLaneTrust === true
    ) &&
    isTrustedRecentOwnerCriticalLane(
      recentOverallOwnerCriticalState.recentLane,
      recentOverallOwnerCriticalState.rawDispatchDelta,
    )
      ? recentOverallOwnerCriticalState.recentLane
      : 0;
  const projectedOwnerMissileLifecycleLane =
    recentOwnerMissileLifecycleState.projectedConsumedLane > 0 &&
    (
      recentOwnerMissileLifecycleState.rawDispatchDelta > 0 ||
      (
        recentOwnerMissileLifecycleState.anchorDelta > 0 &&
        currentLocalStamp > recentOwnerMissileLifecycleTrustedLane
      )
    ) &&
    recentOwnerMissileLifecycleState.laneStamp > 0 &&
    (
      maximumTrustedRecentEmittedOwnerCriticalStamp <= 0 ||
      recentOwnerMissileLifecycleState.laneStamp <=
        maximumTrustedRecentEmittedOwnerCriticalStamp ||
      allowFarAheadRecentOwnerMissileLifecycleLane
    ) &&
    !(
      (
        isFreshAcquireLifecycleGroup ||
        isOwnerMissileLifecycleGroup
      ) &&
      recentOwnerMissileLifecycleState.rawDispatchDelta > 2 &&
      recentOwnerMissileLifecycleState.laneStamp >
        maximumTrustedRecentEmittedOwnerCriticalStamp
    )
      ? recentOwnerMissileLifecycleState.projectedConsumedLane
      : 0;
  const projectedOwnerFreshAcquireLane =
    recentOwnerFreshAcquireState.projectedConsumedLane > 0 &&
    recentOwnerFreshAcquireState.rawDispatchDelta > 0 &&
    recentOwnerFreshAcquireState.laneStamp > 0 &&
    (
      maximumTrustedRecentEmittedOwnerCriticalStamp <= 0 ||
      recentOwnerFreshAcquireState.laneStamp <=
        maximumTrustedRecentEmittedOwnerCriticalStamp
    )
      ? recentOwnerFreshAcquireState.projectedConsumedLane
      : 0;
  const projectedRecentOverallOwnerCriticalLane =
    recentOverallLastSentTrustedLane > 0 &&
    projectedRecentLastSentLane > recentOverallLastSentTrustedLane &&
    !(
      isFreshAcquireLifecycleGroup &&
      previousLastSentDestinyMatchesOwnerMissileLane === true &&
      projectedRecentLastSentLane > (
        (
          maximumTrustedRecentEmittedOwnerCriticalStamp +
          MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD +
          1
        ) >>> 0
      )
    )
      ? projectedRecentLastSentLane
      : 0;
  const reusableRecentOwnerCriticalLane = Math.max(
    recentPresentedLastSentLane,
    recentOverallLastSentTrustedLane,
    recentOwnerMovementTrustedLane,
    recentOwnerMissileLifecycleTrustedLane,
    recentOwnerFreshAcquireTrustedLane,
    recentOverallOwnerCriticalTrustedLane,
  ) >>> 0;
  const projectedConsumedOwnerCriticalLane = Math.max(
    projectedRecentOverallOwnerCriticalLane,
    projectedOwnerMissileLifecycleLane,
    projectedOwnerFreshAcquireLane,
  ) >>> 0;
  // Non-owner missile *fresh-acquire* already has its own Michelle-safe
  // restamp contract in resolveDestinyLifecycleRestampState(). Running those
  // same observer AddBalls2 waves through the owner-critical monotonic floor
  // again is what produced fulldesync9's bad 2960 -> 2957 inversion and later
  // 2965 inflation.
  //
  // But ordinary non-owner missile lifecycle (especially RemoveBalls) still
  // needs the monotonic floor. `badjolt.txt` proved dropping it entirely lets
  // later non-owner missile teardown packets fall back under already-sent
  // session history. So the safe boundary is narrow:
  // - observer missile fresh-acquire: skip owner-critical monotonic floor
  // - other missile lifecycle: keep it
  const requiresOwnerCriticalMonotonicFloor =
    isOwnerCriticalGroup ||
    isOwnerDamageStateGroup ||
    isOwnerMissileLifecycleGroup ||
    (
      isMissileLifecycleGroup &&
      isFreshAcquireLifecycleGroup !== true
    );
  const sameRawReusableOwnerMissileLifecycleLane =
    recentOwnerMissileLifecycleTrustedLane > 0 &&
    recentOwnerMissileLifecycleState.rawDispatchDelta === 0
      ? recentOwnerMissileLifecycleTrustedLane
      : 0;
  const nearbyOwnerMovementClearFloor =
    isFreshAcquireLifecycleGroup &&
    previousLastSentDestinyStamp > 0 &&
    previousLastSentDestinyStamp === lastOwnerPilotCommandMovementStamp &&
    lastOwnerPilotCommandMovementStamp >= (
      currentSessionStamp > 0
        ? ((currentSessionStamp - 1) >>> 0)
        : currentSessionStamp
    ) &&
    lastOwnerPilotCommandMovementStamp <= (
      (currentSessionStamp + MICHELLE_HELD_FUTURE_DESTINY_LEAD) >>> 0
    ) &&
    (
      lastOwnerPilotCommandMovementRawDispatchStamp <= 0 ||
      (
        currentRawDispatchStamp >= lastOwnerPilotCommandMovementRawDispatchStamp &&
        (
          currentRawDispatchStamp - lastOwnerPilotCommandMovementRawDispatchStamp
        ) <= 2
      )
    )
      ? ((lastOwnerPilotCommandMovementStamp + 1) >>> 0)
      : 0;
  const nearbyOwnerNonMissileCriticalClearFloor =
    previousLastSentDestinyStamp > 0 &&
    previousLastSentDestinyStamp === lastOwnerNonMissileCriticalStamp &&
    previousLastSentDestinyMatchesOwnerMissileLane !== true &&
    lastOwnerNonMissileCriticalStamp >= (
      currentSessionStamp > 0
        ? ((currentSessionStamp - 1) >>> 0)
        : currentSessionStamp
    ) &&
    lastOwnerNonMissileCriticalStamp <= (
      (currentSessionStamp + MICHELLE_HELD_FUTURE_DESTINY_LEAD) >>> 0
    )
      ? ((lastOwnerNonMissileCriticalStamp + 1) >>> 0)
      : 0;
  const sameRawFreshAcquireReusableLane = Math.max(
    recentOwnerFreshAcquireTrustedLane > 0 &&
    recentOwnerFreshAcquireState.rawDispatchDelta === 0
      ? recentOwnerFreshAcquireTrustedLane
      : 0,
    recentOverallLastSentTrustedLane > 0 &&
    previousLastSentDestinyStamp === lastOwnerMissileFreshAcquireStamp &&
    recentOverallLastSentState.rawDispatchDelta === 0
      ? recentOverallLastSentTrustedLane
      : 0,
    recentOverallOwnerCriticalTrustedLane > 0 &&
    previousLastSentDestinyStamp === lastOwnerMissileFreshAcquireStamp &&
    recentOverallOwnerCriticalState.rawDispatchDelta === 0
      ? recentOverallOwnerCriticalTrustedLane
      : 0,
  ) >>> 0;
  const projectedFreshAcquireReusableLane =
    isFreshAcquireLifecycleGroup &&
    allowAdjacentRawFreshAcquireLaneReuse === true &&
    projectedOwnerFreshAcquireLane > 0
      ? projectedOwnerFreshAcquireLane
      : 0;
  const preserveOwnerDamageLifecycleFreshAcquireFloor =
    isFreshAcquireLifecycleGroup &&
    previousLastSentDestinyWasOwnerDamageLifecycleLane === true &&
    previousLastSentDestinyStamp > 0;
  const freshAcquireBufferedCeilingStamp =
    isFreshAcquireLifecycleGroup
      ? ((currentImmediateSessionStamp + MICHELLE_HELD_FUTURE_DESTINY_LEAD) >>> 0)
      : 0;
  const freshAcquireSameRawFarAheadTrustCeilingStamp =
    isFreshAcquireLifecycleGroup
      ? ((freshAcquireBufferedCeilingStamp + 1) >>> 0)
      : 0;
  const freshAcquireSameRawLifecycleClearCeilingStamp =
    isFreshAcquireLifecycleGroup
      ? ((freshAcquireSameRawFarAheadTrustCeilingStamp + 1) >>> 0)
      : 0;
  const filterFarAheadOwnerLaneForFreshAcquire = (
    lane,
    rawDispatchDelta = 0,
    reusableLane = 0,
    sourceMatchesMissileLane = true,
  ) => (
    isFreshAcquireLifecycleGroup &&
    sourceMatchesMissileLane === true &&
    lane > 0 &&
    lane > freshAcquireSameRawFarAheadTrustCeilingStamp &&
    !(
      reusableLane > 0 &&
      lane === reusableLane
    ) &&
    !(
      projectedFreshAcquireReusableLane > 0 &&
      lane === projectedFreshAcquireReusableLane
    )
      ? 0
      : lane
  );
  const recentOwnerFreshAcquireFreshAcquireLane =
    filterFarAheadOwnerLaneForFreshAcquire(
      recentOwnerFreshAcquireTrustedLane,
      recentOwnerFreshAcquireState.rawDispatchDelta,
      sameRawFreshAcquireReusableLane,
    );
  const recentOwnerCriticalFreshAcquireLane =
    filterFarAheadOwnerLaneForFreshAcquire(
      recentOwnerCriticalLane,
      recentOwnerCriticalRawDispatchDelta,
      sameRawFreshAcquireReusableLane,
      previousLastSentDestinyMatchesOwnerMissileLane,
    );
  const recentOwnerMissileLifecycleFreshAcquireLane =
    preserveOwnerDamageLifecycleFreshAcquireFloor &&
    previousLastSentDestinyStamp === lastOwnerMissileLifecycleStamp
      ? recentOwnerMissileLifecycleTrustedLane
      : filterFarAheadOwnerLaneForFreshAcquire(
          recentOwnerMissileLifecycleTrustedLane,
          recentOwnerMissileLifecycleState.rawDispatchDelta,
          sameRawFreshAcquireReusableLane,
        );
  const recentOverallLastSentFreshAcquireLane =
    filterFarAheadOwnerLaneForFreshAcquire(
      recentOverallLastSentTrustedLane,
      recentOverallLastSentState.rawDispatchDelta,
      sameRawFreshAcquireReusableLane,
      previousLastSentDestinyMatchesOwnerMissileLane &&
        previousLastSentDestinyWasOwnerDamageLifecycleLane !== true,
    );
  const recentOverallOwnerCriticalFreshAcquireLane =
    filterFarAheadOwnerLaneForFreshAcquire(
      recentOverallOwnerCriticalTrustedLane,
      recentOverallOwnerCriticalState.rawDispatchDelta,
      sameRawFreshAcquireReusableLane,
      previousLastSentDestinyMatchesOwnerMissileLane &&
        previousLastSentDestinyWasOwnerDamageLifecycleLane !== true,
    );
  const farAheadTrackedOwnerMissileLaneBlocksFreshAcquireClear =
    isFreshAcquireLifecycleGroup &&
    previousLastSentDestinyWasOwnerDamageLifecycleLane !== true &&
    previousLastSentDestinyMatchesOwnerMissileLane === true &&
    recentOverallLastSentTrustedLane > freshAcquireSameRawLifecycleClearCeilingStamp;
  const nearbyPresentedNonMissileOwnerCriticalLaneClearFloor =
    previousLastSentDestinyStamp > 0 &&
    previousLastSentDestinyWasOwnerCritical === true &&
    previousLastSentDestinyMatchesOwnerMissileLane !== true &&
    currentPresentedOwnerCriticalStamp > 0 &&
    previousLastSentDestinyStamp >= currentImmediateSessionStamp &&
    previousLastSentDestinyStamp <= currentPresentedOwnerCriticalStamp
      ? ((previousLastSentDestinyStamp + 1) >>> 0)
      : 0;
  const sameRawNearOwnerLaneClearFloor =
    recentOverallLastSentTrustedLane > 0 &&
    recentOverallLastSentState.rawDispatchDelta === 0 &&
    previousLastSentDestinyWasOwnerCritical === true &&
    isOwnerDamageStateGroup !== true &&
    !farAheadTrackedOwnerMissileLaneBlocksFreshAcquireClear &&
    (
      sameRawReusableOwnerMissileLifecycleLane <= 0 ||
      previousLastSentDestinyStamp === lastOwnerMissileFreshAcquireStamp ||
      (
        isFreshAcquireLifecycleGroup &&
        recentOverallLastSentTrustedLane <=
          freshAcquireSameRawLifecycleClearCeilingStamp
      )
    ) &&
    !(
      isFreshAcquireLifecycleGroup &&
      previousLastSentDestinyStamp === lastOwnerMissileFreshAcquireStamp
    )
      ? ((recentOverallLastSentTrustedLane + 1) >>> 0)
      : 0;
  const sameRawOwnerDamageLifecycleClearFloor =
    isFreshAcquireLifecycleGroup &&
    previousLastSentDestinyWasOwnerDamageLifecycleLane === true &&
    previousLastSentDestinyRawDispatchStamp === currentRawDispatchStamp
      ? ((previousLastSentDestinyStamp + 1) >>> 0)
      : 0;
  const ownerDamageStateRecentOwnerCriticalClearFloor =
    isOwnerDamageStateGroup === true &&
    reusableRecentOwnerCriticalLane > 0
      ? ((reusableRecentOwnerCriticalLane + 2) >>> 0)
      : 0;
  const canReuseProjectedFreshAcquireLane =
    projectedFreshAcquireReusableLane > 0 &&
    projectedFreshAcquireReusableLane > currentPresentedOwnerCriticalStamp &&
    currentLocalStamp < projectedFreshAcquireReusableLane;
  const recentOwnerCriticalContribution =
    recentOwnerCriticalLane > 0
      ? (
          isFreshAcquireLifecycleGroup
            ? sameRawFreshAcquireReusableLane > 0 &&
              recentOwnerCriticalFreshAcquireLane ===
                sameRawFreshAcquireReusableLane
              ? sameRawFreshAcquireReusableLane
              : recentOwnerCriticalFreshAcquireLane > 0
                ? ((recentOwnerCriticalFreshAcquireLane + 1) >>> 0)
                : 0
            : recentOwnerCriticalLane
        )
      : 0;
  const freshAcquireRecentOwnerMovementClearContribution =
    isFreshAcquireLifecycleGroup && recentOwnerMovementTrustedLane > 0
      ? ((recentOwnerMovementTrustedLane + 1) >>> 0)
      : 0;
  const freshAcquireRecentOwnerMissileLifecycleClearContribution =
    isFreshAcquireLifecycleGroup &&
    recentOwnerMissileLifecycleFreshAcquireLane > 0 &&
    !(
      sameRawFreshAcquireReusableLane > 0 &&
      recentOwnerMissileLifecycleState.rawDispatchDelta === 0 &&
      recentOwnerMissileLifecycleFreshAcquireLane ===
        sameRawFreshAcquireReusableLane
    )
      ? ((recentOwnerMissileLifecycleFreshAcquireLane + 1) >>> 0)
      : 0;
  const freshAcquireRecentOwnerFreshAcquireClearContribution =
    isFreshAcquireLifecycleGroup &&
    recentOwnerFreshAcquireFreshAcquireLane > 0 &&
    recentOwnerFreshAcquireState.rawDispatchDelta > 0
      ? ((recentOwnerFreshAcquireFreshAcquireLane + 1) >>> 0)
      : 0;
  const freshAcquireRecentOverallLastSentClearContribution =
    isFreshAcquireLifecycleGroup &&
    recentOverallLastSentFreshAcquireLane > 0 &&
    !(
      previousLastSentDestinyStamp === lastOwnerMissileFreshAcquireStamp &&
      recentOverallLastSentState.rawDispatchDelta === 0
    ) &&
    !(
      sameRawFreshAcquireReusableLane > 0 &&
      recentOverallLastSentState.rawDispatchDelta === 0 &&
      recentOverallLastSentFreshAcquireLane ===
        sameRawFreshAcquireReusableLane
    )
      ? ((recentOverallLastSentFreshAcquireLane + 1) >>> 0)
      : 0;
  const freshAcquireRecentOverallOwnerCriticalClearContribution =
    isFreshAcquireLifecycleGroup &&
    recentOverallOwnerCriticalFreshAcquireLane > 0 &&
    !(
      previousLastSentDestinyStamp === lastOwnerMissileFreshAcquireStamp &&
      recentOverallOwnerCriticalState.rawDispatchDelta === 0
    ) &&
    !(
      sameRawFreshAcquireReusableLane > 0 &&
      recentOverallOwnerCriticalState.rawDispatchDelta === 0 &&
      recentOverallOwnerCriticalFreshAcquireLane ===
        sameRawFreshAcquireReusableLane
    )
      ? ((recentOverallOwnerCriticalFreshAcquireLane + 1) >>> 0)
      : 0;
  const freshAcquireMaxClearContribution =
    isFreshAcquireLifecycleGroup
      ? Math.max(
          freshAcquireRecentOwnerMovementClearContribution,
          freshAcquireRecentOwnerMissileLifecycleClearContribution,
          freshAcquireRecentOwnerFreshAcquireClearContribution,
          freshAcquireRecentOverallLastSentClearContribution,
          freshAcquireRecentOverallOwnerCriticalClearContribution,
        ) >>> 0
      : reusableRecentOwnerCriticalLane;
  const projectedConsumedOwnerCriticalContribution =
    projectedConsumedOwnerCriticalLane > 0
      ? (
          isFreshAcquireLifecycleGroup &&
          projectedFreshAcquireReusableLane > 0 &&
          projectedConsumedOwnerCriticalLane ===
            projectedFreshAcquireReusableLane &&
          canReuseProjectedFreshAcquireLane
            ? projectedFreshAcquireReusableLane
            : (
              isMissileLifecycleGroup &&
              isOwnerMissileLifecycleGroup !== true &&
              isOwnerCriticalGroup !== true &&
              isOwnerDamageStateGroup !== true
            )
              // Observer missile lifecycle already has its own held-future
              // floor. Lifting it an extra +1 off projected owner-critical
              // history is what created the `npc4.txt` 3848 -> 3849 runaway
              // that then poisoned the next owner steer.
              ? projectedConsumedOwnerCriticalLane
            : ((projectedConsumedOwnerCriticalLane + 1) >>> 0)
        )
      : 0;
  const recentOwnerCriticalFloorCandidates = [
    buildDecisionCandidate(
      "ownerDamageStateRecentOwnerCriticalClearFloor",
      ownerDamageStateRecentOwnerCriticalClearFloor,
    ),
    buildDecisionCandidate(
      "sameRawOwnerDamageLifecycleClearFloor",
      sameRawOwnerDamageLifecycleClearFloor,
    ),
    buildDecisionCandidate(
      "sameRawFreshAcquireReusableLane",
      isFreshAcquireLifecycleGroup ? sameRawFreshAcquireReusableLane : 0,
    ),
    buildDecisionCandidate(
      "nearbyOwnerMovementClearFloor",
      nearbyOwnerMovementClearFloor,
    ),
    buildDecisionCandidate(
      "nearbyOwnerNonMissileCriticalClearFloor",
      nearbyOwnerNonMissileCriticalClearFloor,
    ),
    buildDecisionCandidate(
      "nearbyPresentedNonMissileOwnerCriticalLaneClearFloor",
      nearbyPresentedNonMissileOwnerCriticalLaneClearFloor,
    ),
    buildDecisionCandidate(
      "sameRawNearOwnerLaneClearFloor",
      sameRawNearOwnerLaneClearFloor,
    ),
    buildDecisionCandidate(
      "recentOwnerCriticalContribution",
      recentOwnerCriticalContribution,
    ),
    buildDecisionCandidate(
      "freshAcquireRecentOwnerMovementClearContribution",
      freshAcquireRecentOwnerMovementClearContribution,
    ),
    buildDecisionCandidate(
      "freshAcquireRecentOwnerMissileLifecycleClearContribution",
      freshAcquireRecentOwnerMissileLifecycleClearContribution,
    ),
    buildDecisionCandidate(
      "freshAcquireRecentOwnerFreshAcquireClearContribution",
      freshAcquireRecentOwnerFreshAcquireClearContribution,
    ),
    buildDecisionCandidate(
      "freshAcquireRecentOverallLastSentClearContribution",
      freshAcquireRecentOverallLastSentClearContribution,
    ),
    buildDecisionCandidate(
      "freshAcquireRecentOverallOwnerCriticalClearContribution",
      freshAcquireRecentOverallOwnerCriticalClearContribution,
    ),
    buildDecisionCandidate(
      isFreshAcquireLifecycleGroup
        ? "freshAcquireMaxClearContribution"
        : "reusableRecentOwnerCriticalLane",
      freshAcquireMaxClearContribution,
    ),
    buildDecisionCandidate(
      "projectedConsumedOwnerCriticalContribution",
      projectedConsumedOwnerCriticalContribution,
    ),
  ];
  const recentOwnerCriticalMonotonicFloor =
    requiresOwnerCriticalMonotonicFloor
      ? Math.max(
          ownerDamageStateRecentOwnerCriticalClearFloor,
          sameRawOwnerDamageLifecycleClearFloor,
          isFreshAcquireLifecycleGroup
            ? sameRawFreshAcquireReusableLane
            : 0,
          nearbyOwnerMovementClearFloor,
          nearbyOwnerNonMissileCriticalClearFloor,
          nearbyPresentedNonMissileOwnerCriticalLaneClearFloor,
          sameRawNearOwnerLaneClearFloor,
          recentOwnerCriticalContribution,
          freshAcquireMaxClearContribution,
          projectedConsumedOwnerCriticalContribution,
        ) >>> 0
      : 0;
  const ownerMissileLifecycleCeilingStamp =
    isOwnerMissileLifecycleGroup
      ? Math.max(
          presentedLastSentCeilingCap,
          (
            currentSessionStamp +
            MICHELLE_HELD_FUTURE_DESTINY_LEAD
          ) >>> 0,
        ) >>> 0
      : 0;
  const ownerCriticalBaseCeilingStamp =
    isOwnerDamageStateGroup
      ? presentedLastSentCeilingCap
      : isOwnerMissileLifecycleGroup
        ? ownerMissileLifecycleCeilingStamp
        : isOwnerCriticalGroup
          ? presentedLastSentCeilingCap
          : 0;
  // Hard-cap the ceiling at currentSession + lead. Previously this was
  // max(baseCeiling, recentOwnerCriticalMonotonicFloor) which let the
  // ceiling rise with compounded missile lifecycle stamps. With 6
  // launchers, stamps compound ~12 per tick, pushing the client's
  // _current_time far ahead of wall clock. The hard cap forces all
  // events in a tick to share the near-current ceiling stamp, matching
  // the CCP server's behavior where simultaneous events share stamps.
  const ownerCriticalCeilingStamp =
    (
      isOwnerCriticalGroup ||
      isOwnerDamageStateGroup
    )
      ? ownerCriticalBaseCeilingStamp
      : 0;
  const reusableRecentOwnerCriticalLaneCandidates = summarizeDecisionCandidates(
    [
      buildDecisionCandidate(
        "recentPresentedLastSentLane",
        recentPresentedLastSentLane,
      ),
      buildDecisionCandidate(
        "recentOverallLastSentTrustedLane",
        recentOverallLastSentTrustedLane,
      ),
      buildDecisionCandidate(
        "recentOwnerMovementTrustedLane",
        recentOwnerMovementTrustedLane,
      ),
      buildDecisionCandidate(
        "recentOwnerMissileLifecycleTrustedLane",
        recentOwnerMissileLifecycleTrustedLane,
      ),
      buildDecisionCandidate(
        "recentOwnerFreshAcquireTrustedLane",
        recentOwnerFreshAcquireTrustedLane,
      ),
      buildDecisionCandidate(
        "recentOverallOwnerCriticalTrustedLane",
        recentOverallOwnerCriticalTrustedLane,
      ),
    ],
    reusableRecentOwnerCriticalLane,
  );
  const projectedConsumedOwnerCriticalLaneCandidates =
    summarizeDecisionCandidates(
      [
        buildDecisionCandidate(
          "projectedRecentOverallOwnerCriticalLane",
          projectedRecentOverallOwnerCriticalLane,
        ),
        buildDecisionCandidate(
          "projectedOwnerMissileLifecycleLane",
          projectedOwnerMissileLifecycleLane,
        ),
        buildDecisionCandidate(
          "projectedOwnerFreshAcquireLane",
          projectedOwnerFreshAcquireLane,
        ),
      ],
      projectedConsumedOwnerCriticalLane,
    );
  const recentOwnerCriticalMonotonicFloorCandidatesSummary =
    summarizeDecisionCandidates(
      recentOwnerCriticalFloorCandidates,
      recentOwnerCriticalMonotonicFloor,
    );
  const ownerCriticalCeilingCandidates = summarizeDecisionCandidates(
    [
      buildDecisionCandidate(
        "ownerCriticalBaseCeilingStamp",
        ownerCriticalBaseCeilingStamp,
      ),
      buildDecisionCandidate(
        "recentOwnerCriticalMonotonicFloor",
        recentOwnerCriticalMonotonicFloor,
      ),
    ],
    ownerCriticalCeilingStamp,
  );
  const decisionTrace = {
    inputs: {
      hasOwnerShip,
      containsMovementContractPayload,
      isSetStateGroup,
      isOwnerPilotMovementGroup,
      isMissileLifecycleGroup,
      isOwnerMissileLifecycleGroup,
      isOwnerCriticalGroup,
      isFreshAcquireLifecycleGroup,
      isOwnerDamageStateGroup,
      allowAdjacentRawFreshAcquireLaneReuse,
      currentSessionStamp,
      currentImmediateSessionStamp,
      currentLocalStamp,
      currentPresentedOwnerCriticalStamp,
      currentRawDispatchStamp,
      recentEmittedOwnerCriticalMaxLead,
      ownerCriticalCeilingLead,
      previousLastSentDestinyStamp,
      previousLastSentDestinyRawDispatchStamp,
      previousLastSentDestinyExplicitWasOwnerCritical,
      previousLastSentDestinyWasOwnerCritical,
      previousLastSentDestinyOnlyStaleProjectedOwnerMissileLane,
      lastOwnerPilotCommandMovementStamp,
      lastOwnerPilotCommandMovementAnchorStamp,
      lastOwnerPilotCommandMovementRawDispatchStamp,
      lastOwnerNonMissileCriticalStamp,
      lastOwnerMissileLifecycleStamp,
      lastOwnerMissileLifecycleAnchorStamp,
      lastOwnerMissileLifecycleRawDispatchStamp,
      lastOwnerMissileFreshAcquireStamp,
      lastOwnerMissileFreshAcquireAnchorStamp,
      lastOwnerMissileFreshAcquireRawDispatchStamp,
    },
    recentStates: {
      recentOverallLastSentState,
      recentOwnerMovementState,
      recentOwnerMissileLifecycleState,
      recentOwnerFreshAcquireState,
      recentOverallOwnerCriticalState,
    },
    trustedLanes: {
      recentPresentedLastSentLane,
      recentNonCriticalLastSentLane,
      recentOwnerCriticalLane,
      recentOverallLastSentTrustedLane,
      recentOwnerMovementTrustedLane,
      recentOwnerMissileLifecycleTrustedLane,
      recentOwnerFreshAcquireTrustedLane,
      recentOverallOwnerCriticalTrustedLane,
      sameRawReusableOwnerMissileLifecycleLane,
      sameRawFreshAcquireReusableLane,
      projectedFreshAcquireReusableLane,
      canReuseProjectedFreshAcquireLane,
      recentOwnerFreshAcquireFreshAcquireLane,
      recentOwnerMissileLifecycleFreshAcquireLane,
      recentOverallLastSentFreshAcquireLane,
      recentOverallOwnerCriticalFreshAcquireLane,
      recentOwnerCriticalFreshAcquireLane,
      reusableRecentOwnerCriticalLane,
      projectedConsumedOwnerCriticalLane,
    },
    ceilings: {
      maximumTrustedRecentEmittedOwnerCriticalStamp,
      maximumProjectedOwnerCriticalLead,
      ownerCriticalBaseCeilingStamp,
      ownerCriticalCeilingStamp,
      freshAcquireBufferedCeilingStamp,
      freshAcquireSameRawFarAheadTrustCeilingStamp,
      freshAcquireSameRawLifecycleClearCeilingStamp,
    },
    filters: {
      allowFarAheadRecentOwnerMissileLifecycleLane,
      allowFarAheadRecentOverallOwnerCriticalLane,
      previousLastSentDestinyMatchesOwnerMissileLane,
      previousLastSentDestinyWasOwnerDamageLifecycleLane,
      previousLastSentDestinyMatchesTrackedOwnerCriticalLane,
      allowUntrackedRecentOverallOwnerLaneTrust,
      preserveOwnerDamageLifecycleFreshAcquireFloor,
      farAheadTrackedOwnerMissileLaneBlocksFreshAcquireClear,
    },
    candidateGroups: {
      reusableRecentOwnerCriticalLane: reusableRecentOwnerCriticalLaneCandidates,
      projectedConsumedOwnerCriticalLane:
        projectedConsumedOwnerCriticalLaneCandidates,
      recentOwnerCriticalMonotonicFloor:
        recentOwnerCriticalMonotonicFloorCandidatesSummary,
      ownerCriticalCeilingStamp: ownerCriticalCeilingCandidates,
    },
  };
  const decisionSummary = {
    inputs: {
      currentSessionStamp,
      currentImmediateSessionStamp,
      currentLocalStamp,
      currentPresentedOwnerCriticalStamp,
      currentRawDispatchStamp,
      previousLastSentDestinyStamp,
      previousLastSentDestinyRawDispatchStamp,
      lastOwnerMissileLifecycleStamp,
      lastOwnerMissileFreshAcquireStamp,
      allowAdjacentRawFreshAcquireLaneReuse,
      isFreshAcquireLifecycleGroup,
      isMissileLifecycleGroup,
      isOwnerCriticalGroup,
      isOwnerDamageStateGroup,
    },
    recentStates: [
      formatRecentOwnerLaneStateSummary(
        "recentOverallLastSentState",
        recentOverallLastSentState,
      ),
      formatRecentOwnerLaneStateSummary(
        "recentOwnerMovementState",
        recentOwnerMovementState,
      ),
      formatRecentOwnerLaneStateSummary(
        "recentOwnerMissileLifecycleState",
        recentOwnerMissileLifecycleState,
      ),
      formatRecentOwnerLaneStateSummary(
        "recentOwnerFreshAcquireState",
        recentOwnerFreshAcquireState,
      ),
      formatRecentOwnerLaneStateSummary(
        "recentOverallOwnerCriticalState",
        recentOverallOwnerCriticalState,
      ),
    ],
    resolvedLanes: {
      reusableRecentOwnerCriticalLane,
      projectedConsumedOwnerCriticalLane,
      sameRawFreshAcquireReusableLane,
      projectedFreshAcquireReusableLane,
      recentOwnerCriticalMonotonicFloor,
      ownerCriticalCeilingStamp,
    },
    candidateGroups: {
      reusableRecentOwnerCriticalLane: formatDecisionCandidateSummary(
        reusableRecentOwnerCriticalLaneCandidates,
      ),
      projectedConsumedOwnerCriticalLane: formatDecisionCandidateSummary(
        projectedConsumedOwnerCriticalLaneCandidates,
      ),
      recentOwnerCriticalMonotonicFloor: formatDecisionCandidateSummary(
        recentOwnerCriticalMonotonicFloorCandidatesSummary,
      ),
      ownerCriticalCeilingStamp: formatDecisionCandidateSummary(
        ownerCriticalCeilingCandidates,
      ),
    },
  };

  return {
    maximumTrustedRecentEmittedOwnerCriticalStamp,
    projectedRecentLastSentLane,
    presentedLastSentMonotonicFloor,
    genericMonotonicFloor,
    recentOwnerMovementState,
    recentOverallLastSentState,
    recentOwnerMissileLifecycleState,
    recentOwnerFreshAcquireState,
    recentOverallOwnerCriticalState,
    reusableRecentOwnerCriticalLane,
    projectedConsumedOwnerCriticalLane,
    sameRawFreshAcquireReusableLane,
    projectedFreshAcquireReusableLane,
    sameRawNearOwnerLaneClearFloor,
    recentOwnerCriticalMonotonicFloor,
    ownerCriticalCeilingStamp,
    decisionTrace,
    decisionSummary,
  };
}

function resolveGotoCommandSyncState(options = {}) {
  const speedFractionChanged = options.speedFractionChanged === true;
  const ownerLocallyPredictsHeading =
    options.ownerLocallyPredictsHeading === true;
  const pendingOwnerMovementStamp = toUInt32(options.pendingOwnerMovementStamp);
  const liveOwnerSessionStamp = toUInt32(options.liveOwnerSessionStamp);
  const pendingOwnerMovementRawDispatchStamp = toUInt32(
    options.pendingOwnerMovementRawDispatchStamp,
  );
  const currentRawDispatchStamp = toUInt32(options.currentRawDispatchStamp);
  const hasPendingFutureOwnerSteer =
    pendingOwnerMovementStamp > liveOwnerSessionStamp;
  const sameRawPendingFutureOwnerSteer =
    hasPendingFutureOwnerSteer &&
    pendingOwnerMovementRawDispatchStamp > 0 &&
    currentRawDispatchStamp === pendingOwnerMovementRawDispatchStamp;
  return {
    isCurrentGotoDuplicate:
      !speedFractionChanged && options.currentGotoDirectionMatches === true,
    isPendingGotoDuplicate:
      !speedFractionChanged && options.pendingOwnerCommandDirectionMatches === true,
    // Only the locally predicted steering path should suppress duplicate owner
    // echoes. Plain CmdGotoDirection callers like double-click-in-space do not
    // move the client ship ball locally before the server echo arrives.
    suppressOwnerGotoEchoRecentDuplicate:
      ownerLocallyPredictsHeading &&
      !speedFractionChanged &&
      options.pendingOwnerCommandDirectionMatches === true &&
      pendingOwnerMovementRawDispatchStamp > 0 &&
      currentRawDispatchStamp >= pendingOwnerMovementRawDispatchStamp &&
      (
        currentRawDispatchStamp -
          pendingOwnerMovementRawDispatchStamp
      ) <= 1,
    // The same distinction applies to same-raw owner steering. Only the
    // predicted-steer path should keep the first future echo and suppress the
    // newer same-raw owner echo.
    suppressOwnerGotoEchoSameRawPendingFutureSteer:
      ownerLocallyPredictsHeading &&
      !speedFractionChanged &&
      sameRawPendingFutureOwnerSteer,
  };
}

function resolveOwnerMovementRestampState(options = {}) {
  const ownerMovementUpdates = Array.isArray(options.ownerMovementUpdates)
    ? options.ownerMovementUpdates
    : [];
  const ownerHasSteeringCommand = options.ownerHasSteeringCommand === true;
  const currentRawDispatchStamp = toUInt32(options.currentRawDispatchStamp);
  const liveOwnerSessionStamp = toUInt32(options.liveOwnerSessionStamp);
  const currentVisibleOwnerStamp = toUInt32(options.currentVisibleOwnerStamp);
  const currentPresentedOwnerStamp = toUInt32(
    options.currentPresentedOwnerStamp,
  );
  const previousLastSentDestinyWasOwnerCritical =
    options.previousLastSentDestinyWasOwnerCritical === true;
  const quietWindowMinimumStamp = toUInt32(options.quietWindowMinimumStamp);
  const lastFreshAcquireLifecycleStamp = toUInt32(
    options.lastFreshAcquireLifecycleStamp,
  );
  const lastOwnerNonMissileCriticalStamp = toUInt32(
    options.lastOwnerNonMissileCriticalStamp,
  );
  const lastOwnerNonMissileCriticalRawDispatchStamp = toUInt32(
    options.lastOwnerNonMissileCriticalRawDispatchStamp,
  );
  const lastOwnerMissileLifecycleStamp = toUInt32(
    options.lastOwnerMissileLifecycleStamp,
  );
  const lastOwnerMissileLifecycleRawDispatchStamp = toUInt32(
    options.lastOwnerMissileLifecycleRawDispatchStamp,
  );
  const lastOwnerMissileFreshAcquireStamp = toUInt32(
    options.lastOwnerMissileFreshAcquireStamp,
  );
  const lastOwnerMissileFreshAcquireRawDispatchStamp = toUInt32(
    options.lastOwnerMissileFreshAcquireRawDispatchStamp,
  );
  const previousOwnerPilotCommandStamp = toUInt32(
    options.previousOwnerPilotCommandStamp,
  );
  const previousOwnerPilotCommandAnchorStamp = toUInt32(
    options.previousOwnerPilotCommandAnchorStamp,
  );
  const previousOwnerPilotCommandRawDispatchStamp = toUInt32(
    options.previousOwnerPilotCommandRawDispatchStamp,
  );
  const previousOwnerPilotCommandDirectionRaw =
    options.previousOwnerPilotCommandDirectionRaw;
  const normalizeVector =
    typeof options.normalizeVector === "function"
      ? options.normalizeVector
      : (vector, fallback) => {
        const base =
          vector && typeof vector === "object" ? vector : fallback || { x: 1, y: 0, z: 0 };
        const x = toFiniteNumber(base.x, 0);
        const y = toFiniteNumber(base.y, 0);
        const z = toFiniteNumber(base.z, 0);
        const magnitude = Math.sqrt((x * x) + (y * y) + (z * z));
        if (magnitude <= 0) {
          return {
            x: toFiniteNumber(fallback && fallback.x, 1),
            y: toFiniteNumber(fallback && fallback.y, 0),
            z: toFiniteNumber(fallback && fallback.z, 0),
          };
        }
        return {
          x: x / magnitude,
          y: y / magnitude,
          z: z / magnitude,
        };
      };
  const directionsNearlyMatch =
    typeof options.directionsNearlyMatch === "function"
      ? options.directionsNearlyMatch
      : (left, right, minimumDot = OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT) => {
        const normalizedLeft = normalizeVector(left, { x: 1, y: 0, z: 0 });
        const normalizedRight = normalizeVector(right, { x: 1, y: 0, z: 0 });
        const dot =
          (normalizedLeft.x * normalizedRight.x) +
          (normalizedLeft.y * normalizedRight.y) +
          (normalizedLeft.z * normalizedRight.z);
        return dot >= minimumDot;
      };
  const getPendingHistorySafeStamp =
    typeof options.getPendingHistorySafeStamp === "function"
      ? options.getPendingHistorySafeStamp
      : (authoredStamp) => toUInt32(authoredStamp);
  const defaultRight =
    options.defaultRight && typeof options.defaultRight === "object"
      ? options.defaultRight
      : { x: 1, y: 0, z: 0 };

  // Michelle's direct-critical held-future window is still the base owner echo
  // contract. Plain moving CmdGotoDirection is the one remaining exception:
  // that path is not locally predicted by the client ship ball, so a +1 echo
  // can still arrive as current-1 under combat churn. Let callers explicitly
  // lift that path to Michelle's held-future +2 lane without changing the
  // locally-predicted steering contract.
  const ownerDirectEchoLead = Math.max(
    0,
    toInt(
      options.ownerDirectEchoLeadOverride,
      MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
    ),
  );
  const ownerDirectEchoMinimumStamp =
    ownerMovementUpdates.length > 0
      ? ownerMovementUpdates.reduce((highestMinimumStamp, update) => {
          const authoredStamp = toUInt32(update && update.stamp);
          return Math.max(
            highestMinimumStamp,
            getPendingHistorySafeStamp(authoredStamp, ownerDirectEchoLead),
            (
              liveOwnerSessionStamp +
              ownerDirectEchoLead
            ) >>> 0,
          ) >>> 0;
        }, 0)
      : 0;
  const currentOwnerPilotCommandDirection = ownerMovementUpdates.reduce(
    (latestDirection, update) => {
      const payload =
        update && Array.isArray(update.payload) ? update.payload : null;
      if (!payload || payload[0] !== "GotoDirection") {
        return latestDirection;
      }
      const args = Array.isArray(payload[1]) ? payload[1] : null;
      if (!args || args.length < 4) {
        return latestDirection;
      }
      return normalizeVector(
        {
          x: toFiniteNumber(
            args[1] && typeof args[1] === "object" ? args[1].value : args[1],
            0,
          ),
          y: toFiniteNumber(
            args[2] && typeof args[2] === "object" ? args[2].value : args[2],
            0,
          ),
          z: toFiniteNumber(
            args[3] && typeof args[3] === "object" ? args[3].value : args[3],
            0,
          ),
        },
        latestDirection || defaultRight,
      );
    },
    null,
  );
  const previousOwnerPilotCommandDirection =
    ownerHasSteeringCommand &&
    previousOwnerPilotCommandStamp >= liveOwnerSessionStamp &&
    previousOwnerPilotCommandAnchorStamp > 0 &&
    previousOwnerPilotCommandDirectionRaw
      ? normalizeVector(
          previousOwnerPilotCommandDirectionRaw,
          currentOwnerPilotCommandDirection || defaultRight,
        )
      : null;
  const repeatedOwnerPilotCommandLane =
    ownerHasSteeringCommand &&
    previousOwnerPilotCommandStamp > liveOwnerSessionStamp &&
    previousOwnerPilotCommandAnchorStamp === liveOwnerSessionStamp &&
    previousOwnerPilotCommandDirection &&
    currentOwnerPilotCommandDirection &&
    directionsNearlyMatch(
      previousOwnerPilotCommandDirection,
      currentOwnerPilotCommandDirection,
      OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT,
    )
      ? (previousOwnerPilotCommandStamp >>> 0)
      : 0;
  // `client/jolty16.txt` showed one more owner-lane edge case: the last held
  // plain `CmdGotoDirection` could still be reused after some newer owner tick
  // had already been presented to Michelle. The visible clock can still sit on
  // the older session stamp while the presented lane has moved on, so guard
  // reuse/suppression against the newer presented owner tick as well.
  const ownerPilotCommandReuseFloor = Math.max(
    currentVisibleOwnerStamp,
    currentPresentedOwnerStamp,
  ) >>> 0;
  // Adjacent-raw plain CmdGotoDirection input can still safely reuse the
  // immediately pending held-future owner lane while that lane has not yet
  // been presented to Michelle, or when the new heading is effectively the
  // same steer. Once that same future lane is already on the presented
  // surface, reusing it for a genuinely distinct re-aim creates the
  // `jolty99` live shape where Michelle consumes the first future steer and
  // then rewinds when later raw ticks replay older copies of that same
  // visible lane.
  const reusableHeldOwnerPilotCommandLane =
    ownerHasSteeringCommand &&
    ownerDirectEchoLead > MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD &&
    previousOwnerPilotCommandStamp >= ownerPilotCommandReuseFloor &&
    previousOwnerPilotCommandRawDispatchStamp > 0 &&
    currentRawDispatchStamp > previousOwnerPilotCommandRawDispatchStamp &&
    (
      currentRawDispatchStamp - previousOwnerPilotCommandRawDispatchStamp
    ) <= 1 &&
    previousOwnerPilotCommandAnchorStamp > 0 &&
    (((previousOwnerPilotCommandAnchorStamp + 1) >>> 0) === liveOwnerSessionStamp) &&
    previousOwnerPilotCommandDirection &&
    currentOwnerPilotCommandDirection &&
    (
      currentPresentedOwnerStamp < previousOwnerPilotCommandStamp ||
      directionsNearlyMatch(
        previousOwnerPilotCommandDirection,
        currentOwnerPilotCommandDirection,
        OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT,
      )
    ) &&
    (
      previousOwnerPilotCommandStamp === liveOwnerSessionStamp ||
      (((previousOwnerPilotCommandStamp + 1) >>> 0) === ownerDirectEchoMinimumStamp)
    ) &&
    repeatedOwnerPilotCommandLane <= 0
      ? (previousOwnerPilotCommandStamp >>> 0)
      : 0;
  // Preserve owner steering order across raw dispatches. `client/jolt13.txt`
  // showed that once a distinct owner `GotoDirection` is already pending on a
  // future tick, reusing that same future tick for a later distinct heading
  // lets Michelle process one steer on time and then rewind when another
  // packet for that already-consumed tick arrives later. The parity-safe
  // contract is:
  // - same raw dispatch: keep the first owner echo and only update direction
  // - later raw dispatch, true duplicate / near-duplicate heading: reuse the
  //   pending future tick
  // - later raw dispatch, distinct heading: advance beyond the pending future
  //   owner steer
  const nextDistinctOwnerPilotCommandLane =
    ownerHasSteeringCommand &&
    previousOwnerPilotCommandStamp > liveOwnerSessionStamp &&
    previousOwnerPilotCommandRawDispatchStamp > 0 &&
    currentRawDispatchStamp > previousOwnerPilotCommandRawDispatchStamp &&
    (
      currentRawDispatchStamp - previousOwnerPilotCommandRawDispatchStamp
    ) <= 1 &&
    previousOwnerPilotCommandDirection &&
    currentOwnerPilotCommandDirection &&
    reusableHeldOwnerPilotCommandLane <= 0 &&
    repeatedOwnerPilotCommandLane <= 0
      ? ((previousOwnerPilotCommandStamp + 1) >>> 0)
      : 0;
  const suppressSameRawDistinctFutureOwnerEcho =
    ownerHasSteeringCommand &&
    previousOwnerPilotCommandStamp >= ownerPilotCommandReuseFloor &&
    previousOwnerPilotCommandRawDispatchStamp > 0 &&
    previousOwnerPilotCommandRawDispatchStamp === currentRawDispatchStamp &&
    previousOwnerPilotCommandDirection &&
    currentOwnerPilotCommandDirection &&
    repeatedOwnerPilotCommandLane <= 0;
  const earlierTickOwnerPilotCommandMatches =
    previousOwnerPilotCommandDirection &&
    currentOwnerPilotCommandDirection &&
    directionsNearlyMatch(
      previousOwnerPilotCommandDirection,
      currentOwnerPilotCommandDirection,
      OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT,
    );
  const ownerVisibleStamp = Math.max(
    currentVisibleOwnerStamp,
  ) >>> 0;
  // Fresh-acquire `AddBalls2` presentation already consumes Michelle's held
  // future tick. If owner steering reuses that same presented stamp, the pilot
  // can advance locally through the wreck-add tick and then rebase backward
  // when the older `GotoDirection` finally executes. Keep immediate
  // post-fresh-acquire steering on the first tick after the acquire lane.
  const recentPresentedFreshAcquireLane =
    ownerHasSteeringCommand &&
    lastFreshAcquireLifecycleStamp > currentVisibleOwnerStamp &&
    lastFreshAcquireLifecycleStamp <= (
      (
        currentVisibleOwnerStamp +
        MICHELLE_HELD_FUTURE_DESTINY_LEAD
      ) >>> 0
    )
      ? (lastFreshAcquireLifecycleStamp >>> 0)
      : 0;
  const postFreshAcquireOwnerSteeringFloor =
    recentPresentedFreshAcquireLane > 0
      ? Math.max(
          ownerDirectEchoMinimumStamp,
          ((recentPresentedFreshAcquireLane + 1) >>> 0),
        ) >>> 0
      : 0;
  const recentOwnerNonMissileCriticalLane = getRecentTrustedLane({
    laneStamp: lastOwnerNonMissileCriticalStamp,
    currentStamp: liveOwnerSessionStamp,
    currentRawDispatchStamp,
    laneRawDispatchStamp: lastOwnerNonMissileCriticalRawDispatchStamp,
    maximumLead: MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    maximumRawDispatchDelta: 2,
  });
  const recentOwnerMissileLifecycleLane = getRecentTrustedLane({
    laneStamp: lastOwnerMissileLifecycleStamp,
    currentStamp: liveOwnerSessionStamp,
    currentRawDispatchStamp,
    laneRawDispatchStamp: lastOwnerMissileLifecycleRawDispatchStamp,
    maximumLead: MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    maximumRawDispatchDelta: 2,
  });
  const recentOwnerFreshAcquireLane = getRecentTrustedLane({
    laneStamp: lastOwnerMissileFreshAcquireStamp,
    currentStamp: liveOwnerSessionStamp,
    currentRawDispatchStamp,
    laneRawDispatchStamp: lastOwnerMissileFreshAcquireRawDispatchStamp,
    maximumLead: MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    maximumRawDispatchDelta: 2,
  });
  // Owner steering must never backstep under an already-buffered owner-
  // critical tick that Michelle can still legally hold in the shared +1/+2
  // window. This keeps owner steering, owner missile lifecycle, and owner
  // fresh-acquire traffic on one monotonic client-visible timeline without
  // reintroducing custom far-ahead lanes.
  const recentBufferedOwnerCriticalFloor = Math.max(
    recentOwnerNonMissileCriticalLane,
    recentOwnerMissileLifecycleLane,
    recentOwnerFreshAcquireLane,
  ) >>> 0;
  // `client/awful.txt` and `client/jolty11.txt` exposed the remaining plain
  // CmdGotoDirection parity gap. The non-predicted owner steer still needs the
  // held-future +2 base lead, but once a same-session noncritical / owner-
  // critical lane has already advanced Michelle we only need to clear the next
  // owner-visible tick beyond the highest already-consumed owner lane. The
  // regression was re-adding the full lead on top of the presented lane, which
  // created stale 1888/5301 owner echoes and later recovery SetState windows.
  const presentedNonCriticalOwnerEchoFloor =
    ownerHasSteeringCommand &&
    ownerDirectEchoLead > MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD &&
    previousLastSentDestinyWasOwnerCritical !== true &&
    currentPresentedOwnerStamp > liveOwnerSessionStamp
      ? (
        (
          Math.max(
            ownerDirectEchoMinimumStamp,
            Math.min(
              currentPresentedOwnerStamp,
              (
                liveOwnerSessionStamp +
                ownerDirectEchoLead
              ) >>> 0,
            ) >>> 0,
            recentBufferedOwnerCriticalFloor,
          ) +
          1
        ) >>> 0
      )
      : 0;
  const ownerMinimumStamp = ownerMovementUpdates.reduce((highestMinimumStamp, update) => {
    const authoredStamp = toUInt32(update && update.stamp);
    if (quietWindowMinimumStamp > 0) {
      return Math.max(highestMinimumStamp, quietWindowMinimumStamp) >>> 0;
    }
    if (!ownerHasSteeringCommand) {
      return highestMinimumStamp >>> 0;
    }
    if (authoredStamp >= ownerVisibleStamp) {
      return highestMinimumStamp >>> 0;
    }
    return Math.max(
      highestMinimumStamp,
      ownerVisibleStamp,
      getPendingHistorySafeStamp(authoredStamp, 0),
    ) >>> 0;
  }, 0);
  // Owner-issued movement control packets are still Michelle-critical even
  // when they are not steering payloads. `client/jolt4.txt` showed Stop /
  // SetSpeedFraction / SetBallVelocity landing on the raw current tick while
  // Michelle had already advanced to the next presented tick, which forced a
  // rewind before the stop contract could apply. Keep those owner control
  // packets on the same direct-critical echo floor used by steering updates so
  // the stop/speed contract lands inside Michelle's held-future window instead
  // of behind it.
  const ownerStampFloor =
    reusableHeldOwnerPilotCommandLane > 0
      ? Math.max(
          ownerMinimumStamp,
          presentedNonCriticalOwnerEchoFloor,
          postFreshAcquireOwnerSteeringFloor,
          recentBufferedOwnerCriticalFloor,
          repeatedOwnerPilotCommandLane,
          reusableHeldOwnerPilotCommandLane,
        ) >>> 0
      : Math.max(
          ownerMinimumStamp,
          ownerDirectEchoMinimumStamp,
          presentedNonCriticalOwnerEchoFloor,
          postFreshAcquireOwnerSteeringFloor,
          recentBufferedOwnerCriticalFloor,
          repeatedOwnerPilotCommandLane,
          nextDistinctOwnerPilotCommandLane,
        ) >>> 0;
  const ownerUpdates = ownerMovementUpdates.map((update) => ({
    ...update,
    stamp: Math.max(
      toUInt32(update && update.stamp),
      ownerStampFloor,
    ) >>> 0,
  }));

  return {
    currentOwnerPilotCommandDirection,
    previousOwnerPilotCommandDirection,
    ownerDirectEchoMinimumStamp,
    repeatedOwnerPilotCommandLane,
    reusableHeldOwnerPilotCommandLane,
    nextDistinctOwnerPilotCommandLane,
    suppressSameRawDistinctFutureOwnerEcho,
    earlierTickOwnerPilotCommandMatches,
    recentPresentedFreshAcquireLane,
    recentOwnerNonMissileCriticalLane,
    recentOwnerMissileLifecycleLane,
    recentOwnerFreshAcquireLane,
    recentBufferedOwnerCriticalFloor,
    ownerVisibleStamp,
    ownerMinimumStamp,
    postFreshAcquireOwnerSteeringFloor,
    presentedNonCriticalOwnerEchoFloor,
    ownerStampFloor,
    ownerUpdates,
  };
}

function resolveDestinyLifecycleRestampState(options = {}) {
  const isFreshAcquireLifecycleGroup =
    options.isFreshAcquireLifecycleGroup === true;
  const isMissileLifecycleGroup =
    options.isMissileLifecycleGroup === true;
  const isOwnerMissileLifecycleGroup =
    options.isOwnerMissileLifecycleGroup === true;
  const minimumPostFreshAcquireStamp = toUInt32(
    options.minimumPostFreshAcquireStamp,
  );
  const currentSessionStamp = toUInt32(options.currentSessionStamp);
  const currentImmediateSessionStamp = toUInt32(
    options.currentImmediateSessionStamp,
  );
  const currentRawDispatchStamp = toUInt32(options.currentRawDispatchStamp);
  const lastFreshAcquireLifecycleStamp = toUInt32(
    options.lastFreshAcquireLifecycleStamp,
  );
  const lastMissileLifecycleStamp = toUInt32(
    options.lastMissileLifecycleStamp,
  );
  const lastOwnerMissileLifecycleStamp = toUInt32(
    options.lastOwnerMissileLifecycleStamp,
  );
  const lastOwnerMissileFreshAcquireStamp = toUInt32(
    options.lastOwnerMissileFreshAcquireStamp,
  );
  const lastOwnerMissileFreshAcquireRawDispatchStamp = toUInt32(
    options.lastOwnerMissileFreshAcquireRawDispatchStamp,
  );
  const lastOwnerMissileLifecycleRawDispatchStamp = toUInt32(
    options.lastOwnerMissileLifecycleRawDispatchStamp,
  );
  const previousLastSentDestinyStamp = toUInt32(
    options.previousLastSentDestinyStamp,
  );
  const previousLastSentDestinyRawDispatchStamp = toUInt32(
    options.previousLastSentDestinyRawDispatchStamp,
  );
  const previousLastSentDestinyWasOwnerCritical =
    options.previousLastSentDestinyWasOwnerCritical === true;
  const lastOwnerPilotCommandMovementStamp = toUInt32(
    options.lastOwnerPilotCommandMovementStamp,
  );
  const lastOwnerPilotCommandMovementRawDispatchStamp = toUInt32(
    options.lastOwnerPilotCommandMovementRawDispatchStamp,
  );

  let workingLocalStamp = toUInt32(options.localStamp);
  let freshAcquireFloor = null;
  let missileLifecycleFloor = null;
  let ownerMissileLifecycleFloor = null;

  const maximumTrustedOwnerMovementLane = (
    currentSessionStamp + MICHELLE_HELD_FUTURE_DESTINY_LEAD
  ) >>> 0;
  const minimumTrustedOwnerMovementLane =
    currentSessionStamp > 0
      ? ((currentSessionStamp - 1) >>> 0)
      : currentSessionStamp;
  const recentOwnerMovementLane =
    lastOwnerPilotCommandMovementStamp >= minimumTrustedOwnerMovementLane &&
    lastOwnerPilotCommandMovementStamp <= maximumTrustedOwnerMovementLane
    && (
      lastOwnerPilotCommandMovementRawDispatchStamp <= 0 ||
      (
        currentRawDispatchStamp >= lastOwnerPilotCommandMovementRawDispatchStamp &&
        (
          currentRawDispatchStamp - lastOwnerPilotCommandMovementRawDispatchStamp
        ) <= 2
      )
    )
      ? lastOwnerPilotCommandMovementStamp
      : 0;
  const recentOwnerMissileLifecycleLane = getRecentTrustedLane({
    laneStamp: lastOwnerMissileLifecycleStamp,
    currentStamp: currentImmediateSessionStamp,
    currentRawDispatchStamp,
    laneRawDispatchStamp: lastOwnerMissileLifecycleRawDispatchStamp,
    maximumLead: MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    maximumRawDispatchDelta: 2,
  });
  const recentOwnerFreshAcquireLane = getRecentTrustedLane({
    laneStamp: lastOwnerMissileFreshAcquireStamp,
    currentStamp: currentImmediateSessionStamp,
    currentRawDispatchStamp,
    laneRawDispatchStamp: lastOwnerMissileFreshAcquireRawDispatchStamp,
    maximumLead: MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    maximumRawDispatchDelta: 2,
  });
  const previousLastSentDestinyMatchesKnownOwnerCriticalLane =
    previousLastSentDestinyWasOwnerCritical === true ||
    previousLastSentDestinyStamp === lastOwnerPilotCommandMovementStamp ||
    previousLastSentDestinyStamp === lastOwnerMissileLifecycleStamp ||
    previousLastSentDestinyStamp === lastOwnerMissileFreshAcquireStamp;
  const recentOverallOwnerCriticalLane =
    previousLastSentDestinyMatchesKnownOwnerCriticalLane
      ? getRecentTrustedLane({
          laneStamp: previousLastSentDestinyStamp,
          currentStamp: currentImmediateSessionStamp,
          currentRawDispatchStamp,
          laneRawDispatchStamp: previousLastSentDestinyRawDispatchStamp,
          maximumLead: MICHELLE_HELD_FUTURE_DESTINY_LEAD,
          maximumRawDispatchDelta: 2,
        })
      : 0;
  const recentOwnerCriticalFloor = Math.max(
    recentOwnerMovementLane,
    recentOwnerMissileLifecycleLane,
    recentOwnerFreshAcquireLane,
    recentOverallOwnerCriticalLane,
  ) >>> 0;

  if (isFreshAcquireLifecycleGroup) {
    const reusableFreshAcquireLane =
      lastFreshAcquireLifecycleStamp > currentSessionStamp &&
      lastFreshAcquireLifecycleStamp <= (
        (
          currentSessionStamp +
          MICHELLE_HELD_FUTURE_DESTINY_LEAD
        ) >>> 0
      )
      ? lastFreshAcquireLifecycleStamp
      : 0;
    const ownerFreshAcquireHeldCeiling =
      isOwnerMissileLifecycleGroup
        ? (
          currentSessionStamp +
          MICHELLE_HELD_FUTURE_DESTINY_LEAD
        ) >>> 0
        : 0;
    // `jolt222.txt`: launcher-owner missile acquires can still arrive as
    // separate notifications inside the same raw dispatch. Reusing the exact
    // same held-future fresh-acquire lane after we've already emitted it once
    // in that raw tick leaves the later AddBalls2 vulnerable to arriving after
    // Michelle has already consumed and rebased that lane. Clear the shared
    // lane once, but clamp to the held-future ceiling so dense volleys do not
    // run off into +3/+4 lanes.
    const ownerSameRawFreshAcquireClearFloor =
      isOwnerMissileLifecycleGroup &&
      reusableFreshAcquireLane > 0 &&
      previousLastSentDestinyStamp === reusableFreshAcquireLane &&
      previousLastSentDestinyRawDispatchStamp === currentRawDispatchStamp
        ? Math.min(
            ((reusableFreshAcquireLane + 1) >>> 0),
            ownerFreshAcquireHeldCeiling,
          ) >>> 0
        : 0;
    const freshAcquireHistorySafeFloor = (
      isOwnerMissileLifecycleGroup
        ? (
          currentImmediateSessionStamp +
          MICHELLE_HELD_FUTURE_DESTINY_LEAD
        )
        : (
          currentSessionStamp +
          MICHELLE_HELD_FUTURE_DESTINY_LEAD
        )
    ) >>> 0;
    const resolvedFreshAcquireFloor =
      reusableFreshAcquireLane > 0 &&
      ownerSameRawFreshAcquireClearFloor <= 0
        ? reusableFreshAcquireLane
        : Math.max(
            workingLocalStamp,
            freshAcquireHistorySafeFloor,
            recentOwnerCriticalFloor > 0
              ? ((recentOwnerCriticalFloor + 1) >>> 0)
              : 0,
            ownerSameRawFreshAcquireClearFloor,
            minimumPostFreshAcquireStamp,
          ) >>> 0;
    freshAcquireFloor = {
      reusableFreshAcquireLane,
      ownerFreshAcquireHeldCeiling,
      ownerSameRawFreshAcquireClearFloor,
      freshAcquireHistorySafeFloor,
      recentOwnerCriticalFloor,
      freshAcquireFloor: resolvedFreshAcquireFloor,
    };
    workingLocalStamp = resolvedFreshAcquireFloor;
  }

  if (isMissileLifecycleGroup && !isOwnerMissileLifecycleGroup) {
    // Observer-visible missile lifecycle must stay inside Michelle's held
    // future window. Delta 3 is the visible jolt threshold, so both the
    // reuse window and the default floor must stay at session+2, not +3.
    const reusableMissileLifecycleLane =
      lastMissileLifecycleStamp > currentSessionStamp &&
      lastMissileLifecycleStamp <= (
        (
          currentSessionStamp +
          MICHELLE_HELD_FUTURE_DESTINY_LEAD
        ) >>> 0
      )
        ? lastMissileLifecycleStamp
        : 0;
    const resolvedMissileLifecycleFloor =
      reusableMissileLifecycleLane > 0
        ? reusableMissileLifecycleLane
        : Math.max(
            workingLocalStamp,
            (
              (
                currentSessionStamp +
                MICHELLE_HELD_FUTURE_DESTINY_LEAD
              ) >>> 0
            ),
            recentOwnerMovementLane > 0
              ? ((recentOwnerMovementLane + 1) >>> 0)
              : 0,
          ) >>> 0;
    missileLifecycleFloor = {
      reusableMissileLifecycleLane,
      recentOwnerMovementLane,
      missileLifecycleFloor: resolvedMissileLifecycleFloor,
    };
    workingLocalStamp = resolvedMissileLifecycleFloor;
  }

  if (isOwnerMissileLifecycleGroup) {
    const requiredOwnerFloor = Math.max(
      minimumPostFreshAcquireStamp,
      (
        (
          currentImmediateSessionStamp +
          MICHELLE_HELD_FUTURE_DESTINY_LEAD
        ) >>> 0
      ),
      recentOwnerCriticalFloor > 0
        ? recentOwnerCriticalFloor
        : 0,
    ) >>> 0;
    const resolvedOwnerMissileLifecycleFloor = requiredOwnerFloor;
    const normalizedOwnerMissileStamp =
      workingLocalStamp < resolvedOwnerMissileLifecycleFloor
        ? resolvedOwnerMissileLifecycleFloor
        : workingLocalStamp;
    ownerMissileLifecycleFloor = {
      currentSessionStamp,
      currentImmediateSessionStamp,
      recentOwnerMovementLane,
      recentOwnerMissileLifecycleLane,
      recentOwnerFreshAcquireLane,
      recentOverallOwnerCriticalLane,
      recentOwnerCriticalFloor,
      requiredOwnerFloor,
      ownerCombatFloor: resolvedOwnerMissileLifecycleFloor,
      normalizedOwnerMissileStamp,
    };
    workingLocalStamp = normalizedOwnerMissileStamp;
  }

  return {
    finalStamp: workingLocalStamp >>> 0,
    recentOwnerMovementLane,
    freshAcquireFloor,
    missileLifecycleFloor,
    ownerMissileLifecycleFloor,
  };
}

function resolveDamageStateDispatchStamp(options = {}) {
  const visibleStamp = toUInt32(options.visibleStamp);
  const currentPresentedStamp = toUInt32(options.currentPresentedStamp);
  const previousLastSentDestinyStamp = toUInt32(
    options.previousLastSentDestinyStamp,
  );
  const previousLastSentDestinyRawDispatchStamp = toUInt32(
    options.previousLastSentDestinyRawDispatchStamp,
  );
  const currentRawDispatchStamp = toUInt32(options.currentRawDispatchStamp);
  const directCriticalEchoStamp = (
    visibleStamp + MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD
  ) >>> 0;
  const maximumHeldFutureDamageStamp = (
    visibleStamp + MICHELLE_HELD_FUTURE_DESTINY_LEAD
  ) >>> 0;
  // Damage-state is a non-critical lane for both owners and observers.
  // `client/more.txt` showed the owner shape, and `client/here.txt` showed the
  // observer equivalent: once Michelle has already presented a later lane,
  // blindly reusing `visible + 1` lands `OnDamageStateChange` behind current
  // history. Keep damage inside Michelle's held-future window, but clear
  // already-presented / already-consumed same-raw lanes instead of blindly
  // reusing `visible + 1`.
  const presentedDamageClearFloor =
    currentPresentedStamp > directCriticalEchoStamp
      ? Math.min(
          currentPresentedStamp,
          maximumHeldFutureDamageStamp,
        ) >>> 0
      : 0;
  const sameRawPresentedDamageReuseClearFloor =
    previousLastSentDestinyStamp > 0 &&
    previousLastSentDestinyStamp === currentPresentedStamp &&
    previousLastSentDestinyRawDispatchStamp > 0 &&
    previousLastSentDestinyRawDispatchStamp === currentRawDispatchStamp
      ? Math.min(
          (currentPresentedStamp + 1) >>> 0,
          maximumHeldFutureDamageStamp,
        ) >>> 0
      : 0;
  // `client/funky.txt` still had owner damage-state arriving one lane behind a
  // freshly projected owner movement lane:
  //   damage 1775153614 - current 1775153615
  //   damage 1775153685 - current 1775153686
  // In both windows we had already emitted the previous presented lane on the
  // prior raw dispatch, so Michelle had effectively consumed `presented + 1`
  // before the next OnDamageStateChange arrived. Clear that exact projected
  // lane, but only for the adjacent-raw case; this keeps damage monotonic with
  // recent owner steering without reopening the older far-future drift.
  const projectedPresentedDamageClearFloor =
    previousLastSentDestinyStamp > 0 &&
    previousLastSentDestinyStamp === currentPresentedStamp &&
    previousLastSentDestinyRawDispatchStamp > 0 &&
    currentRawDispatchStamp > previousLastSentDestinyRawDispatchStamp &&
    (
      currentRawDispatchStamp - previousLastSentDestinyRawDispatchStamp
    ) <= 1
      ? projectPreviouslySentDestinyLane(
          previousLastSentDestinyStamp,
          previousLastSentDestinyRawDispatchStamp,
          currentRawDispatchStamp,
        )
      : 0;
  const finalStamp = Math.max(
    maximumHeldFutureDamageStamp,
    presentedDamageClearFloor,
    sameRawPresentedDamageReuseClearFloor,
    projectedPresentedDamageClearFloor,
  ) >>> 0;
  return {
    directCriticalEchoStamp,
    maximumHeldFutureDamageStamp,
    presentedDamageClearFloor,
    sameRawPresentedDamageReuseClearFloor,
    projectedPresentedDamageClearFloor,
    finalStamp,
  };
}

const MOVEMENT_DELIVERY_POLICY = Object.freeze({
  DESTINY_STAMP_INTERVAL_MS,
  DESTINY_STAMP_MAX_LEAD,
  OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT,
});

module.exports = {
  MOVEMENT_DELIVERY_POLICY,
  ...MOVEMENT_DELIVERY_POLICY,
  projectPreviouslySentDestinyLane,
  resolvePreviousLastSentDestinyWasOwnerCritical,
  resolveProjectedRecentLastSentLane,
  getRecentTrustedLane,
  getRecentProjectedLane,
  resolveRecentOwnerLaneState,
  resolveOwnerMonotonicState,
  resolveGotoCommandSyncState,
  resolveOwnerMovementRestampState,
  resolveDestinyLifecycleRestampState,
  resolveDamageStateDispatchStamp,
};
