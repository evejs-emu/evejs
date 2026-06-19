/**
 * Inventory Asset Holding Manager Compatibility Stub
 *
 * This is a compatibility stub for the client QA / Insider asset-holding menu.
 * The 23.02 client expects inventoryAssetHoldingMgr to answer a small toggle
 * API with booleans. Without that service, the packet dispatcher returns None,
 * which causes the client QA menu to crash while rendering its toggle state.
 *
 * This stub only preserves the toggle values per connected session so the
 * compatibility menu works. It does not implement real asset-holding failure
 * simulation or validation bypass behavior on the server.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

function buildDefaultState() {
  return {
    itemFailureEnabled: false,
    itemValidationEnabled: true,
  };
}

function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  return Boolean(fallback);
}

function getSessionCharacterID(session) {
  return Number(session && (session.characterID || session.charid || session.charID)) || 0;
}

class InventoryAssetHoldingMgrService extends BaseService {
  constructor() {
    super("inventoryAssetHoldingMgr");
    this._sessionState = new WeakMap();
    this._anonymousState = buildDefaultState();
  }

  _getState(session) {
    if (!session || typeof session !== "object") {
      return this._anonymousState;
    }
    let state = this._sessionState.get(session);
    if (!state) {
      state = buildDefaultState();
      this._sessionState.set(session, state);
    }
    return state;
  }

  Handle_is_item_failure_enabled(args, session) {
    return this._getState(session).itemFailureEnabled;
  }

  Handle_set_item_failure_enabled(args, session) {
    const state = this._getState(session);
    state.itemFailureEnabled = normalizeBoolean(
      Array.isArray(args) ? args[0] : undefined,
      state.itemFailureEnabled,
    );
    log.debug(
      `[InventoryAssetHoldingMgr] Compatibility stub set item failure ` +
        `char=${getSessionCharacterID(session) || "?"} enabled=${state.itemFailureEnabled}`,
    );
    return null;
  }

  Handle_is_item_validation_enabled(args, session) {
    return this._getState(session).itemValidationEnabled;
  }

  Handle_set_item_validation_enabled(args, session) {
    const state = this._getState(session);
    state.itemValidationEnabled = normalizeBoolean(
      Array.isArray(args) ? args[0] : undefined,
      state.itemValidationEnabled,
    );
    log.debug(
      `[InventoryAssetHoldingMgr] Compatibility stub set item validation ` +
        `char=${getSessionCharacterID(session) || "?"} enabled=${state.itemValidationEnabled}`,
    );
    return null;
  }
}

module.exports = InventoryAssetHoldingMgrService;
