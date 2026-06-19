const destiny = require("../../destiny");

function tagUpdatesRequireExistingVisibility(updates) {
  return updates.map((update) => ({
    ...update,
    requireExistingVisibility: true,
  }));
}

function tagUpdatesFreshAcquireLifecycleGroup(updates) {
  return updates.map((update) => ({
    ...update,
    freshAcquireLifecycleGroup: true,
  }));
}

function tagUpdatesMissileLifecycleGroup(updates) {
  return updates.map((update) => ({
    ...update,
    missileLifecycleGroup: true,
  }));
}

function tagUpdatesOwnerMissileLifecycleGroup(updates) {
  return updates.map((update) => ({
    ...update,
    ownerMissileLifecycleGroup: true,
  }));
}

function buildDirectedMovementUpdates(
  entity,
  commandDirection,
  speedFractionChanged,
  movementStamp,
) {
  const updates = [
    {
      stamp: movementStamp,
      payload: destiny.buildGotoDirectionPayload(entity.itemID, commandDirection),
    },
  ];
  if (speedFractionChanged) {
    updates.push({
      stamp: updates[0].stamp,
      payload: destiny.buildSetSpeedFractionPayload(
        entity.itemID,
        entity.speedFraction,
      ),
    });
  }
  return updates;
}

function buildPointMovementUpdates(
  entity,
  point,
  speedFractionChanged,
  movementStamp,
) {
  const updates = [
    {
      stamp: movementStamp,
      payload: destiny.buildGotoPointPayload(entity.itemID, point),
    },
  ];
  if (speedFractionChanged) {
    updates.push({
      stamp: updates[0].stamp,
      payload: destiny.buildSetSpeedFractionPayload(
        entity.itemID,
        entity.speedFraction,
      ),
    });
  }
  return updates;
}

module.exports = {
  tagUpdatesRequireExistingVisibility,
  tagUpdatesFreshAcquireLifecycleGroup,
  tagUpdatesMissileLifecycleGroup,
  tagUpdatesOwnerMissileLifecycleGroup,
  buildDirectedMovementUpdates,
  buildPointMovementUpdates,
};
