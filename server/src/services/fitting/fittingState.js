const path = require("path");

const {
  OWNER_SCOPE,
  getOwnerFittings,
} = require(path.join(__dirname, "../../_secondary/fitting/fittingStore"));

function ensureCharacterFittings(charId) {
  return {
    success: true,
    data: getOwnerFittings(charId, {
      createIfMissing: true,
      ownerScope: OWNER_SCOPE.CHARACTER,
    }),
  };
}

function getCharacterFittings(charId) {
  return ensureCharacterFittings(charId).data || {};
}

module.exports = {
  getCharacterFittings,
  ensureCharacterFittings,
};
