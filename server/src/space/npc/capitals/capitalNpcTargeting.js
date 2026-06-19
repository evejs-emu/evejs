const {
  getCapitalRuntimeConfig,
} = require("./capitalNpcRuntimeConfig");
const {
  resolveCapitalDoctrine,
} = require("./capitalNpcDoctrine");
const {
  getCapitalControllerState,
} = require("./capitalNpcState");

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function buildPreferredRangeDistanceScore(distanceMeters, doctrine) {
  if (!doctrine) {
    return 0;
  }
  const preferredRangeMeters = Math.max(
    0,
    toFiniteNumber(doctrine.preferredCombatRangeMeters, 0),
  );
  const settleToleranceMeters = Math.max(
    1,
    toFiniteNumber(doctrine.settleToleranceMeters, 1),
  );
  if (preferredRangeMeters <= 0) {
    return 0;
  }
  const deltaMeters = Math.abs(distanceMeters - preferredRangeMeters);
  if (deltaMeters <= settleToleranceMeters) {
    return 240;
  }
  return Math.max(0, 180 - Math.round(deltaMeters / 1000));
}

function scoreCapitalTarget(entity, controller, candidate, options = {}) {
  const currentTargetID = toPositiveInt(controller && controller.currentTargetID, 0);
  const preferredTargetID = toPositiveInt(controller && controller.preferredTargetID, 0);
  const lastAggressorID = toPositiveInt(controller && controller.lastAggressorID, 0);
  const candidateDistanceMeters = Math.max(
    0,
    toFiniteNumber(
      options.getSurfaceDistance
        ? options.getSurfaceDistance(entity, candidate)
        : 0,
      0,
    ),
  );
  const candidateClass = String(
    options.resolveCombatActorClass
      ? options.resolveCombatActorClass(candidate)
      : "",
  ).trim().toLowerCase();
  let score = 0;

  if (toPositiveInt(candidate && candidate.itemID, 0) === currentTargetID) {
    score += 3_000;
  }
  if (toPositiveInt(candidate && candidate.itemID, 0) === preferredTargetID) {
    score += 2_400;
  }
  if (toPositiveInt(candidate && candidate.itemID, 0) === lastAggressorID) {
    score += 2_000;
  }
  if (candidateClass === "player") {
    score += 600;
  }

  score += buildPreferredRangeDistanceScore(candidateDistanceMeters, options.doctrine);
  score += Math.max(0, 400 - Math.round(candidateDistanceMeters / 1000));

  return {
    candidate,
    score,
    distanceMeters: candidateDistanceMeters,
  };
}

function selectBestScoredTarget(scoredCandidates = []) {
  return [...scoredCandidates]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.distanceMeters !== right.distanceMeters) {
        return left.distanceMeters - right.distanceMeters;
      }
      return (
        toPositiveInt(left && left.candidate && left.candidate.itemID, 0) -
        toPositiveInt(right && right.candidate && right.candidate.itemID, 0)
      );
    })[0] || null;
}

function resolveCapitalBehaviorTarget(scene, entity, controller, behaviorProfile, options = {}) {
  if (!scene || !entity || entity.capitalNpc !== true) {
    return null;
  }

  const capitalState = getCapitalControllerState(controller);
  const nowMs = toFiniteNumber(options.nowMs, Date.now());
  const doctrine = options.doctrine || resolveCapitalDoctrine(entity, behaviorProfile);
  const classID = String(
    doctrine && doctrine.classID ||
    entity && entity.capitalClassID ||
    "",
  ).trim().toLowerCase();
  const runtimeConfig = getCapitalRuntimeConfig(classID);
  const currentTargetID = toPositiveInt(controller && controller.currentTargetID, 0);
  const currentTarget = currentTargetID > 0
    ? scene.getEntityByID(currentTargetID)
    : null;
  const aggressionRangeMeters = Math.max(
    0,
    toFiniteNumber(
      options.aggressionRangeMeters,
      behaviorProfile && behaviorProfile.aggressionRangeMeters,
    ),
  );
  const isEligibleTarget = (candidate) => {
    if (!candidate) {
      return false;
    }
    if (
      options.isValidCombatTarget &&
      options.isValidCombatTarget(entity, candidate, {
        allowPodKill: options.allowPodKill === true,
      }) !== true
    ) {
      return false;
    }
    if (entity.bubbleID && candidate.bubbleID && entity.bubbleID !== candidate.bubbleID) {
      return false;
    }
    const candidateClass = String(
      options.resolveCombatActorClass
        ? options.resolveCombatActorClass(candidate)
        : "",
    ).trim().toLowerCase();
    if (
      Array.isArray(options.allowedTargetClasses) &&
      options.allowedTargetClasses.length > 0 &&
      !options.allowedTargetClasses.includes(candidateClass)
    ) {
      return false;
    }
    if (
      aggressionRangeMeters > 0 &&
      options.getSurfaceDistance &&
      toFiniteNumber(options.getSurfaceDistance(entity, candidate), 0) > aggressionRangeMeters
    ) {
      return false;
    }
    return true;
  };

  if (
    currentTarget &&
    isEligibleTarget(currentTarget) &&
    nowMs < toFiniteNumber(capitalState.lastTargetSwapAtMs, 0) + runtimeConfig.retargetStickMs
  ) {
    return currentTarget;
  }

  const scoredCandidates = [];
  for (const candidate of scene.dynamicEntities.values()) {
    if (!isEligibleTarget(candidate)) {
      continue;
    }
    scoredCandidates.push(
      scoreCapitalTarget(entity, controller, candidate, {
        getSurfaceDistance: options.getSurfaceDistance,
        resolveCombatActorClass: options.resolveCombatActorClass,
        doctrine,
      }),
    );
  }
  const bestCandidate = selectBestScoredTarget(scoredCandidates);
  if (!bestCandidate) {
    return null;
  }

  if (currentTarget && isEligibleTarget(currentTarget)) {
    const currentScore = scoreCapitalTarget(entity, controller, currentTarget, {
      getSurfaceDistance: options.getSurfaceDistance,
      resolveCombatActorClass: options.resolveCombatActorClass,
      doctrine,
    });
    if (
      bestCandidate.candidate.itemID !== currentTarget.itemID &&
      bestCandidate.score <= currentScore.score + runtimeConfig.retargetScoreMargin
    ) {
      return currentTarget;
    }
  }

  if (
    capitalState &&
    toPositiveInt(capitalState.lastTargetID, 0) !== toPositiveInt(bestCandidate.candidate.itemID, 0)
  ) {
    capitalState.lastTargetID = toPositiveInt(bestCandidate.candidate.itemID, 0);
    capitalState.lastTargetSwapAtMs = nowMs;
  }
  return bestCandidate.candidate;
}

module.exports = {
  resolveCapitalBehaviorTarget,
  __testing: {
    scoreCapitalTarget,
    selectBestScoredTarget,
    buildPreferredRangeDistanceScore,
  },
};
