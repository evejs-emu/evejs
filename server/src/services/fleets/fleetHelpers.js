const path = require("path");

const fleetRuntime = require(path.join(__dirname, "./fleetRuntime"));

function getSessionFleetState(session) {
  return fleetRuntime.getSessionFleetState(session);
}

function applyFleetStateToSession(session) {
  const nextState = getSessionFleetState(session);
  fleetRuntime.applySessionFleetState(session, nextState);
  return nextState;
}

function getFleetForCharacter(characterID) {
  return fleetRuntime.getFleetForCharacter(characterID);
}

function getFleetMemberRecord(characterID) {
  const fleet = fleetRuntime.getFleetForCharacter(characterID);
  return fleet ? fleetRuntime.getMemberRecord(fleet, characterID) : null;
}

function isInSameFleet(leftCharacterID, rightCharacterID) {
  const leftFleet = getFleetForCharacter(leftCharacterID);
  const rightFleet = getFleetForCharacter(rightCharacterID);
  return Boolean(
    leftFleet &&
    rightFleet &&
    leftFleet.fleetID === rightFleet.fleetID,
  );
}

function getFleetRespawnPoints(characterID) {
  const fleet = getFleetForCharacter(characterID);
  return fleet ? fleetRuntime.getRespawnPoints(fleet.fleetID) : [];
}

function getFleetTargetTag(characterID, itemID) {
  return fleetRuntime.getTargetTagForCharacter(characterID, itemID);
}

function hasActiveFleetBeacon(characterID) {
  return fleetRuntime.hasActiveBeaconForCharacter(characterID);
}

function getActiveFleetBeacon(characterID) {
  return fleetRuntime.getActiveBeaconForCharacter(characterID);
}

function getActiveFleetBeacons(characterID) {
  return fleetRuntime.getActiveBeaconsForCharacter(characterID);
}

function getActiveFleetBridge(characterID, shipID) {
  return fleetRuntime.getActiveBridgeForCharacter(characterID, shipID);
}

function getRuntimeStats() {
  return fleetRuntime.getFleetHelpersSnapshot();
}

module.exports = {
  getSessionFleetState,
  applyFleetStateToSession,
  getFleetForCharacter,
  getFleetMemberRecord,
  isInSameFleet,
  getFleetRespawnPoints,
  getFleetTargetTag,
  hasActiveFleetBeacon,
  getActiveFleetBeacon,
  getActiveFleetBeacons,
  getActiveFleetBridge,
  getRuntimeStats,
};
