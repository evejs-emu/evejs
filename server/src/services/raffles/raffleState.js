const path = require("path");

const RaffleSubscriptions = require(path.join(
  __dirname,
  "./raffleSubscriptions",
));
const {
  normalizeInteger,
} = require(path.join(__dirname, "./raffleHelpers"));
const {
  loadRafflesMap,
  writeRaffle,
  clearAllRaffles,
} = require(path.join(__dirname, "./raffleRepository"));
const {
  getRaffleRuntimeState,
  updateRaffleRuntimeState,
  resetRaffleRuntimeState,
} = require(path.join(__dirname, "./raffleRuntimeState"));
const {
  RAFFLE_STATUS,
} = require(path.join(__dirname, "./raffleConstants"));

function shouldReserveItem(raffleState) {
  if (!raffleState) {
    return false;
  }

  const raffleStatus = normalizeInteger(raffleState.raffleStatus, 0);
  return (
    normalizeInteger(raffleState.itemId, 0) > 0 &&
    (
      raffleStatus === RAFFLE_STATUS.RUNNING ||
      raffleStatus === RAFFLE_STATUS.FINISHED_UNDELIVERED
    )
  );
}

class RaffleState {
  constructor() {
    this._initialized = false;
    this._rafflesById = new Map();
    this._reservedItemIds = new Set();
    this.subscriptions = new RaffleSubscriptions();
  }

  initialize() {
    if (this._initialized) {
      return;
    }

    this._rafflesById = loadRafflesMap();
    this._rebuildReservedItemIndex();
    getRaffleRuntimeState();
    this._initialized = true;
  }

  reset(options = {}) {
    const clearPersistence = options.clearPersistence !== false;
    this._initialized = false;
    this._rafflesById = new Map();
    this._reservedItemIds = new Set();
    this.subscriptions = new RaffleSubscriptions();

    if (clearPersistence) {
      clearAllRaffles();
      resetRaffleRuntimeState();
    }
  }

  allocateIds() {
    this.initialize();
    const currentState = getRaffleRuntimeState();
    const nextIds = {
      raffleId: normalizeInteger(currentState.nextRaffleId, 0),
      runningId: normalizeInteger(currentState.nextRunningId, 0),
    };
    updateRaffleRuntimeState((state) => ({
      ...state,
      nextRaffleId: nextIds.raffleId + 1,
      nextRunningId: nextIds.runningId + 1,
    }));
    return nextIds;
  }

  addRaffle(raffleState) {
    this.initialize();
    const raffleId = normalizeInteger(raffleState && raffleState.raffleId, 0);
    if (raffleId <= 0) {
      return null;
    }

    this._rafflesById.set(raffleId, raffleState);
    this._syncReservedItem(raffleState);
    writeRaffle(raffleState);
    return raffleState;
  }

  saveRaffle(raffleState) {
    this.initialize();
    const raffleId = normalizeInteger(raffleState && raffleState.raffleId, 0);
    if (raffleId <= 0) {
      return null;
    }

    this._rafflesById.set(raffleId, raffleState);
    this._syncReservedItem(raffleState);
    writeRaffle(raffleState);
    return raffleState;
  }

  getRaffle(raffleId) {
    this.initialize();
    return this._rafflesById.get(normalizeInteger(raffleId, 0)) || null;
  }

  getRaffles() {
    this.initialize();
    return [...this._rafflesById.values()]
      .slice()
      .sort((left, right) => right.runningId - left.runningId);
  }

  isItemReserved(itemId) {
    this.initialize();
    return this._reservedItemIds.has(normalizeInteger(itemId, 0));
  }

  releaseReservedItem(itemId) {
    this.initialize();
    this._reservedItemIds.delete(normalizeInteger(itemId, 0));
  }

  _rebuildReservedItemIndex() {
    this._reservedItemIds.clear();
    for (const raffleState of this._rafflesById.values()) {
      this._syncReservedItem(raffleState);
    }
  }

  _syncReservedItem(raffleState) {
    const itemId = normalizeInteger(raffleState && raffleState.itemId, 0);
    if (itemId <= 0) {
      return;
    }

    if (shouldReserveItem(raffleState)) {
      this._reservedItemIds.add(itemId);
      return;
    }

    this._reservedItemIds.delete(itemId);
  }
}

module.exports = RaffleState;
