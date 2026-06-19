const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  SEED_ID_BASE,
} = require(path.join(__dirname, "./raffleConstants"));

const TABLE = "rafflesRuntime";
const DEFAULT_STATE = Object.freeze({
  schemaVersion: 1,
  nextRaffleId: SEED_ID_BASE + 1,
  nextRunningId: SEED_ID_BASE + 1,
});

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureState() {
  const result = database.read(TABLE, "/");
  if (result.success && result.data && typeof result.data === "object") {
    return {
      ...cloneValue(DEFAULT_STATE),
      ...cloneValue(result.data),
    };
  }

  database.write(TABLE, "/", cloneValue(DEFAULT_STATE));
  return cloneValue(DEFAULT_STATE);
}

function getRaffleRuntimeState() {
  return ensureState();
}

function updateRaffleRuntimeState(updater) {
  const currentState = ensureState();
  const nextState =
    typeof updater === "function"
      ? updater(cloneValue(currentState))
      : {
          ...currentState,
          ...(updater && typeof updater === "object" ? updater : {}),
        };

  return database.write(TABLE, "/", {
    ...cloneValue(DEFAULT_STATE),
    ...cloneValue(nextState || currentState),
  });
}

function resetRaffleRuntimeState() {
  return database.write(TABLE, "/", cloneValue(DEFAULT_STATE));
}

module.exports = {
  TABLE,
  DEFAULT_STATE,
  getRaffleRuntimeState,
  updateRaffleRuntimeState,
  resetRaffleRuntimeState,
};
