const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));

const TABLE = "marketRuntime";
const DEFAULT_STATE = Object.freeze({
  lastProcessedExpiryEventId: "0",
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

function getMarketRuntimeState() {
  return ensureState();
}

function updateMarketRuntimeState(updater) {
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

module.exports = {
  TABLE,
  getMarketRuntimeState,
  updateMarketRuntimeState,
};
