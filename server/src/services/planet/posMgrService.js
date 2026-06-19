const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildBoundObjectResponse,
  normalizeNumber,
  resolveBoundNodeId,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  ITEM_FLAGS,
  buildRemovedItemNotificationState,
  listContainerItems,
  removeInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const planetOrbitalState = require("./planetOrbitalState");
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));

function extractItemID(args) {
  const unwrapped = unwrapMarshalValue(Array.isArray(args) ? args[0] : args);
  if (Array.isArray(unwrapped)) {
    return Math.trunc(normalizeNumber(unwrapped[0], 0));
  }
  return Math.trunc(normalizeNumber(unwrapped, 0));
}

function refreshOrbitalScene(record, session = null) {
  const systemID = Number(
    record && record.solarSystemID ||
      session && session._space && session._space.systemID ||
      session && (session.solarsystemid2 || session.solarsystemid) ||
      0,
  ) || 0;
  const itemID = Number(record && record.itemID) || 0;
  if (!systemID || !itemID) {
    return;
  }

  const spawnResult = spaceRuntime.spawnDynamicInventoryEntity(systemID, itemID);
  if (!spawnResult || !spawnResult.success) {
    log.warn(
      `[PosMgr] Failed to refresh orbital ${itemID} in system ${systemID}: ${spawnResult ? spawnResult.errorMsg : "UNKNOWN"}`,
    );
  }
}

function syncRemovedInventoryChanges(session, changes = []) {
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || change.removed !== true || !change.previousData) {
      continue;
    }
    const removedState = buildRemovedItemNotificationState(change.previousData);
    if (!removedState) {
      continue;
    }
    syncInventoryItemForSession(
      session,
      removedState,
      change.previousData,
      { emitCfgLocation: true },
    );
  }
}

function consumeOrbitalUpgradeHold(itemID, session = null) {
  const contents = listContainerItems(
    null,
    itemID,
    ITEM_FLAGS.SPECIALIZED_MATERIAL_BAY,
  );
  let consumed = 0;
  for (const item of contents) {
    const removeResult = removeInventoryItem(item.itemID, { removeContents: true });
    if (!removeResult.success) {
      log.warn(
        `[PosMgr] Failed to consume upgrade material itemID=${item.itemID}: ${removeResult.errorMsg || "UNKNOWN"}`,
      );
      continue;
    }
    consumed += 1;
    syncRemovedInventoryChanges(
      session,
      removeResult.data && removeResult.data.changes,
    );
  }
  return consumed;
}

class PosMgrService extends BaseService {
  constructor() {
    super("posMgr");
  }

  Handle_MachoResolveObject(args, session, kwargs) {
    void args;
    void session;
    void kwargs;
    log.debug("[PosMgr] MachoResolveObject");
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    log.debug("[PosMgr] MachoBindObject");
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_AnchorOrbital(args, session) {
    const itemID = extractItemID(args);
    log.info(`[PosMgr] AnchorOrbital itemID=${itemID || "unknown"}`);
    const result = planetOrbitalState.anchorOrbital(itemID, session);
    if (!result.success) {
      log.warn(
        `[PosMgr] AnchorOrbital failed itemID=${itemID}: ${result.errorMsg || "UNKNOWN_ERROR"}`,
      );
      return null;
    }
    refreshOrbitalScene(result.data, session);
    return null;
  }

  Handle_UnanchorOrbital(args, session) {
    const itemID = extractItemID(args);
    log.info(`[PosMgr] UnanchorOrbital itemID=${itemID || "unknown"}`);
    const result = planetOrbitalState.unanchorOrbital(itemID, session);
    if (!result.success) {
      log.warn(
        `[PosMgr] UnanchorOrbital failed itemID=${itemID}: ${result.errorMsg || "UNKNOWN_ERROR"}`,
      );
      return null;
    }
    refreshOrbitalScene(result.data, session);
    return null;
  }

  Handle_OnlineOrbital(args, session) {
    const itemID = extractItemID(args);
    log.info(`[PosMgr] OnlineOrbital itemID=${itemID || "unknown"}`);
    const result = planetOrbitalState.onlineOrbital(itemID, session);
    if (!result.success) {
      log.warn(
        `[PosMgr] OnlineOrbital failed itemID=${itemID}: ${result.errorMsg || "UNKNOWN_ERROR"}`,
      );
      return null;
    }
    const consumedCount = consumeOrbitalUpgradeHold(itemID, session);
    if (consumedCount > 0) {
      log.info(`[PosMgr] Consumed ${consumedCount} upgrade material stack(s) for orbital ${itemID}`);
    }
    refreshOrbitalScene(result.data, session);
    return null;
  }
}

PosMgrService._testing = {
  extractItemID,
  consumeOrbitalUpgradeHold,
};

module.exports = PosMgrService;
