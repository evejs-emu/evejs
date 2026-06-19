const DESTINY_CONTRACTS = Object.freeze({
  STATE_RESET: "state_reset",
  BOOTSTRAP_ACQUIRE: "bootstrap_acquire",
  OWNER_PILOT_COMMAND: "owner_pilot_command",
  OWNER_MISSILE_LIFECYCLE: "owner_missile_lifecycle",
  OBSERVER_MISSILE_LIFECYCLE: "observer_missile_lifecycle",
  CRITICAL_MOVEMENT_OR_SHIPPRIME: "critical_movement_or_shipprime",
  COMBAT_NONCRITICAL: "combat_noncritical",
  DESTRUCTION_TEARDOWN: "destruction_teardown",
});

const VALID_DESTINY_CONTRACTS = new Set(Object.values(DESTINY_CONTRACTS));

const CRITICAL_DESTINY_CONTRACTS = new Set([
  DESTINY_CONTRACTS.STATE_RESET,
  DESTINY_CONTRACTS.BOOTSTRAP_ACQUIRE,
  DESTINY_CONTRACTS.OWNER_PILOT_COMMAND,
  DESTINY_CONTRACTS.OWNER_MISSILE_LIFECYCLE,
  DESTINY_CONTRACTS.OBSERVER_MISSILE_LIFECYCLE,
  DESTINY_CONTRACTS.CRITICAL_MOVEMENT_OR_SHIPPRIME,
  DESTINY_CONTRACTS.DESTRUCTION_TEARDOWN,
]);

function getUpdatePayloadName(update) {
  const payload =
    update && Array.isArray(update.payload)
      ? update.payload
      : null;
  return payload && typeof payload[0] === "string"
    ? payload[0]
    : "";
}

function normalizeDestinyContract(contract, fallback = "") {
  const normalized = typeof contract === "string"
    ? contract.trim().toLowerCase()
    : "";
  if (VALID_DESTINY_CONTRACTS.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function isCriticalDestinyContract(contract) {
  return CRITICAL_DESTINY_CONTRACTS.has(
    normalizeDestinyContract(contract, ""),
  );
}

function inferDestinyContract(updates = [], options = {}) {
  const explicitContract = normalizeDestinyContract(
    options && options.destinyAuthorityContract,
    "",
  );
  if (explicitContract) {
    return explicitContract;
  }

  const payloadNames = Array.isArray(updates)
    ? updates.map(getUpdatePayloadName).filter(Boolean)
    : [];

  const hasSetState = payloadNames.includes("SetState");
  if (hasSetState) {
    return DESTINY_CONTRACTS.STATE_RESET;
  }

  const hasAddBalls2 = payloadNames.includes("AddBalls2");
  const hasRemoveBalls = payloadNames.includes("RemoveBalls");
  const hasDamageState = payloadNames.includes("OnDamageStateChange");
  const hasSpecialFx = payloadNames.includes("OnSpecialFX");
  const hasProjectileFired = payloadNames.includes("ProjectileFired");
  const hasMovementContract = payloadNames.some((name) => (
    name === "GotoDirection" ||
    name === "GotoPoint" ||
    name === "Orbit" ||
    name === "FollowBall" ||
    name === "Stop" ||
    name === "WarpTo"
  ));
  const hasShipPrimeSetter = payloadNames.some((name) => (
    name === "SetBallAgility" ||
    name === "SetBallMass" ||
    name === "SetMaxSpeed" ||
    name === "SetBallMassive" ||
    name === "SetSpeedFraction" ||
    name === "SetBallVelocity" ||
    name === "SetBallPosition"
  ));
  const hasFreshAcquireLifecycle = Array.isArray(updates) && updates.some(
    (update) => update && update.freshAcquireLifecycleGroup === true,
  );
  const hasMissileLifecycle = Array.isArray(updates) && updates.some(
    (update) => (
      update &&
      (
        update.missileLifecycleGroup === true ||
        update.ownerMissileLifecycleGroup === true
      )
    ),
  );
  const hasOwnerMissileLifecycle = Array.isArray(updates) && updates.some(
    (update) => update && update.ownerMissileLifecycleGroup === true,
  );

  if (
    options &&
    (
      options.explodingRemovalGroup === true ||
      options.destinyAuthorityDestructionTeardown === true
    )
  ) {
    return DESTINY_CONTRACTS.DESTRUCTION_TEARDOWN;
  }

  if (hasOwnerMissileLifecycle) {
    return DESTINY_CONTRACTS.OWNER_MISSILE_LIFECYCLE;
  }

  if (hasMissileLifecycle) {
    return DESTINY_CONTRACTS.OBSERVER_MISSILE_LIFECYCLE;
  }

  if (
    options &&
    (
      options.destinyAuthorityOwnerPilotCommand === true ||
      options.commandSource === "CmdGotoDirection" ||
      options.commandSource === "CmdSteerDirection"
    )
  ) {
    return DESTINY_CONTRACTS.OWNER_PILOT_COMMAND;
  }

  if (hasMovementContract || hasShipPrimeSetter) {
    return DESTINY_CONTRACTS.CRITICAL_MOVEMENT_OR_SHIPPRIME;
  }

  if (hasAddBalls2 || hasFreshAcquireLifecycle) {
    return DESTINY_CONTRACTS.BOOTSTRAP_ACQUIRE;
  }

  if (hasRemoveBalls) {
    return DESTINY_CONTRACTS.DESTRUCTION_TEARDOWN;
  }

  if (hasDamageState || hasSpecialFx || hasProjectileFired) {
    return DESTINY_CONTRACTS.COMBAT_NONCRITICAL;
  }

  return DESTINY_CONTRACTS.COMBAT_NONCRITICAL;
}

module.exports = {
  DESTINY_CONTRACTS,
  VALID_DESTINY_CONTRACTS,
  normalizeDestinyContract,
  inferDestinyContract,
  isCriticalDestinyContract,
};
