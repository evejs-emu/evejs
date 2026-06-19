const path = require("path");

const {
  buildFittingBrainEffectDefinitions,
} = require(path.join(__dirname, "../../../../_secondary/fitting/fittingBrainBuilder"));

function buildFittingBrainDefinitions(characterID) {
  return buildFittingBrainEffectDefinitions(characterID);
}

function buildCharacterEffects(characterID) {
  return buildFittingBrainDefinitions(characterID).characterEffects;
}

function buildShipEffects(characterID) {
  return buildFittingBrainDefinitions(characterID).shipEffects;
}

function buildStructureEffects(characterID) {
  return buildFittingBrainDefinitions(characterID).structureEffects;
}

const FITTING_BRAIN_PROVIDER = Object.freeze({
  key: "fitting",
  buildCharacterEffects,
  buildShipEffects,
  buildStructureEffects,
});

module.exports = {
  FITTING_BRAIN_PROVIDER,
  buildCharacterEffects,
  buildShipEffects,
  buildStructureEffects,
};
