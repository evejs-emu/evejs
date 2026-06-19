const MINING_HOLD_FLAGS = Object.freeze({
  GENERAL_MINING_HOLD: 134,
  SPECIALIZED_GAS_HOLD: 135,
  SPECIALIZED_ICE_HOLD: 181,
  SPECIALIZED_ASTEROID_HOLD: 182,
});

const MINING_HOLD_DEFINITIONS = Object.freeze([
  Object.freeze({
    flagID: MINING_HOLD_FLAGS.GENERAL_MINING_HOLD,
    resourceKey: "generalMiningHoldCapacity",
    attributeNames: Object.freeze(["generalMiningHoldCapacity"]),
    label: "Mining Hold",
  }),
  Object.freeze({
    flagID: MINING_HOLD_FLAGS.SPECIALIZED_GAS_HOLD,
    resourceKey: "gasHoldCapacity",
    attributeNames: Object.freeze(["specialGasHoldCapacity"]),
    label: "Gas Hold",
  }),
  Object.freeze({
    flagID: MINING_HOLD_FLAGS.SPECIALIZED_ICE_HOLD,
    resourceKey: "iceHoldCapacity",
    attributeNames: Object.freeze(["specialIceHoldCapacity"]),
    label: "Ice Hold",
  }),
  Object.freeze({
    flagID: MINING_HOLD_FLAGS.SPECIALIZED_ASTEROID_HOLD,
    resourceKey: "asteroidHoldCapacity",
    attributeNames: Object.freeze(["specialAsteroidHoldCapacity"]),
    label: "Asteroid Hold",
  }),
]);

const MINING_HOLD_DEFINITIONS_BY_FLAG = new Map(
  MINING_HOLD_DEFINITIONS.map((definition) => [definition.flagID, definition]),
);

function getMiningHoldDefinitionByFlag(flagID) {
  return MINING_HOLD_DEFINITIONS_BY_FLAG.get(Number(flagID) || 0) || null;
}

function getMiningHoldResourceKeyByFlag(flagID) {
  const definition = getMiningHoldDefinitionByFlag(flagID);
  return definition ? definition.resourceKey : null;
}

module.exports = {
  MINING_HOLD_FLAGS,
  MINING_HOLD_DEFINITIONS,
  getMiningHoldDefinitionByFlag,
  getMiningHoldResourceKeyByFlag,
};
