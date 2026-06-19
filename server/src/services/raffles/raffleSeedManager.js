const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const {
  normalizeInteger,
} = require(path.join(__dirname, "./raffleHelpers"));
const {
  RAFFLE_STATUS,
} = require(path.join(__dirname, "./raffleConstants"));
const {
  buildSeedRaffles,
} = require(path.join(__dirname, "./raffleSeed"));

function randomCount(minValue, maxValue) {
  const normalizedMin = Math.max(0, normalizeInteger(minValue, 0));
  const normalizedMax = Math.max(normalizedMin, normalizeInteger(maxValue, normalizedMin));
  if (normalizedMax <= normalizedMin) {
    return normalizedMin;
  }

  return normalizedMin + Math.floor(Math.random() * (normalizedMax - normalizedMin + 1));
}

class RaffleSeedManager {
  constructor(runtimeState) {
    this._state = runtimeState;
  }

  isEnabled() {
    return config.hyperNetSeedEnabled !== false;
  }

  reconcile() {
    if (!this.isEnabled()) {
      return [];
    }

    this._state.initialize();
    const activeSeedRaffles = this._state.getRaffles().filter((raffleState) => (
      raffleState &&
      raffleState.source === "seed" &&
      normalizeInteger(raffleState.raffleStatus, 0) === RAFFLE_STATUS.RUNNING
    ));
    const activeShipSeeds = activeSeedRaffles.filter((raffleState) => raffleState.seedKind === "ship");
    const activeItemSeeds = activeSeedRaffles.filter((raffleState) => raffleState.seedKind === "item");

    const shipTargetCount = randomCount(
      config.hyperNetSeedMinShips,
      config.hyperNetSeedMaxShips,
    );
    const itemTargetCount = randomCount(
      config.hyperNetSeedMinItems,
      config.hyperNetSeedMaxItems,
    );

    const shipShortage = Math.max(0, shipTargetCount - activeShipSeeds.length);
    const itemShortage = Math.max(0, itemTargetCount - activeItemSeeds.length);
    if (shipShortage <= 0 && itemShortage <= 0) {
      return [];
    }

    const createdSeedRaffles = buildSeedRaffles(this._state, {
      shipCount: shipShortage,
      itemCount: itemShortage,
    });
    for (const raffleState of createdSeedRaffles) {
      this._state.addRaffle(raffleState);
    }

    return createdSeedRaffles;
  }

  seedRequested(count) {
    if (!this.isEnabled()) {
      return [];
    }

    this._state.initialize();
    const normalizedCount = Math.max(0, normalizeInteger(count, 0));
    if (normalizedCount <= 0) {
      return [];
    }

    const shipCount = Math.ceil(normalizedCount / 2);
    const itemCount = Math.floor(normalizedCount / 2);
    const createdSeedRaffles = buildSeedRaffles(this._state, {
      shipCount,
      itemCount,
    });

    for (const raffleState of createdSeedRaffles) {
      this._state.addRaffle(raffleState);
    }

    return createdSeedRaffles;
  }
}

module.exports = RaffleSeedManager;
