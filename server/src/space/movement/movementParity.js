const MOVEMENT_CONTRACT_PAYLOAD_NAMES = new Set([
  "GotoDirection",
  "GotoPoint",
  "FollowBall",
  "Orbit",
  "Stop",
  "SetSpeedFraction",
  "SetBallVelocity",
]);

const STEERING_PAYLOAD_NAMES = new Set([
  "GotoDirection",
  "GotoPoint",
  "FollowBall",
  "Orbit",
]);

function getPayloadName(payload) {
  return Array.isArray(payload) && typeof payload[0] === "string"
    ? payload[0]
    : null;
}

function isMovementContractPayloadName(name) {
  return typeof name === "string" && MOVEMENT_CONTRACT_PAYLOAD_NAMES.has(name);
}

function isSteeringPayloadName(name) {
  return typeof name === "string" && STEERING_PAYLOAD_NAMES.has(name);
}

function isMovementContractPayload(payload) {
  return isMovementContractPayloadName(getPayloadName(payload));
}

function updatesContainMovementContractPayload(updates) {
  return Array.isArray(updates) && updates.some((update) => (
    isMovementContractPayload(update && update.payload)
  ));
}

module.exports = {
  isMovementContractPayload,
  isMovementContractPayloadName,
  isSteeringPayloadName,
  updatesContainMovementContractPayload,
};
