const path = require("path");

const {
  buildDict,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getCharacterWeaponBanks,
  getShipWeaponBanks,
} = require(path.join(__dirname, "./moduleGroupingState"));

function buildWeaponBankStateDict(shipID, options = {}) {
  const banks =
    options.banks && typeof options.banks === "object"
      ? options.banks
      : Number(options.characterID) > 0
        ? getCharacterWeaponBanks(options.characterID, shipID)
        : getShipWeaponBanks(shipID);
  const entries = Object.entries(banks || {})
    .map(([masterID, slaveIDs]) => [
      Number(masterID) || 0,
      buildList(
        (Array.isArray(slaveIDs) ? slaveIDs : [])
          .map((slaveID) => Number(slaveID) || 0)
          .filter((slaveID) => slaveID > 0),
      ),
    ])
    .filter((entry) => entry[0] > 0);
  return buildDict(entries);
}

module.exports = {
  buildWeaponBankStateDict,
};
