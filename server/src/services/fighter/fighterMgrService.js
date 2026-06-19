const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getActiveShipRecord,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  getDockedLocationID,
} = require(path.join(__dirname, "../structure/structureLocation"));
const {
  ITEM_FLAGS,
  FIGHTER_TUBE_FLAGS,
  findItemById,
  listContainerItems,
  moveItemToLocation,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  buildList,
  buildDict,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  isFighterItemRecord,
  isFighterTubeFlag,
  buildInventorySquadronSize,
} = require(path.join(__dirname, "./fighterInventory"));
const {
  activateAbilitySlots,
  buildAbilityStateEntriesForShip,
  buildFightersInSpaceRowsForShip,
  commandAbandonFighter,
  deactivateAbilitySlots,
  executeMovementCommandOnFighters,
  launchFightersFromTubes,
  recallFightersToTubes,
  scoopAbandonedFighterFromSpace,
} = require(path.join(__dirname, "./fighterRuntime"));

const TUBE_STATE_EMPTY = "EMPTY";
const TUBE_STATE_READY = "READY";

function buildTupleList(rows = []) {
  return buildList(rows.map((row) => buildList(row)));
}

class FighterMgrService extends BaseService {
  constructor() {
    super("fighterMgr");
  }

  _getCharacterId(session) {
    return Number(
      (session && (session.characterID || session.charid || session.userid)) || 0,
    );
  }

  _getActiveShip(session) {
    const characterID = this._getCharacterId(session);
    if (characterID <= 0) {
      return null;
    }

    return getActiveShipRecord(characterID) || null;
  }

  _getShipTubeItem(session, tubeFlagID) {
    const shipRecord = this._getActiveShip(session);
    if (!shipRecord || !isFighterTubeFlag(tubeFlagID)) {
      return null;
    }

    const tubeContents = listContainerItems(
      this._getCharacterId(session),
      shipRecord.itemID,
      Number(tubeFlagID) || 0,
    )
      .filter(Boolean)
      .sort((left, right) => Number(left.itemID || 0) - Number(right.itemID || 0));

    return tubeContents[0] || null;
  }

  _resolveLoadableFighterItem(session, shipRecord, fighterID) {
    const numericFighterID = Number(fighterID) || 0;
    if (!shipRecord || numericFighterID <= 0) {
      return null;
    }

    const fighterItem = findItemById(numericFighterID);
    if (!fighterItem || !isFighterItemRecord(fighterItem)) {
      return null;
    }

    if (
      Number(fighterItem.locationID) === Number(shipRecord.itemID) &&
      Number(fighterItem.flagID) === ITEM_FLAGS.FIGHTER_BAY
    ) {
      return fighterItem;
    }

    const dockedLocationID = Number(getDockedLocationID(session) || 0);
    const characterID = this._getCharacterId(session);
    if (
      dockedLocationID > 0 &&
      characterID > 0 &&
      Number(fighterItem.ownerID) === characterID &&
      Number(fighterItem.locationID) === dockedLocationID &&
      Number(fighterItem.flagID) === ITEM_FLAGS.HANGAR
    ) {
      return fighterItem;
    }

    return null;
  }

  _emitInventoryChanges(session, changes = []) {
    for (const change of Array.isArray(changes) ? changes : []) {
      if (!change || !change.item) {
        continue;
      }

      syncInventoryItemForSession(
        session,
        change.item,
        change.previousData || {},
        {
          emitCfgLocation: true,
        },
      );
    }
  }

  _notifyTubeContent(session, tubeFlagID, fighterItem) {
    if (
      !session ||
      typeof session.sendNotification !== "function" ||
      !fighterItem
    ) {
      return;
    }

    session.sendNotification("OnFighterTubeContentUpdate", "clientID", [
      Number(tubeFlagID) || 0,
      Number(fighterItem.itemID) || 0,
      Number(fighterItem.typeID) || 0,
      buildInventorySquadronSize(fighterItem),
    ]);
  }

  _notifyTubeEmpty(session, tubeFlagID) {
    if (!session || typeof session.sendNotification !== "function") {
      return;
    }

    session.sendNotification("OnFighterTubeContentEmpty", "clientID", [
      Number(tubeFlagID) || 0,
    ]);
  }

  _notifyTubeState(session, tubeFlagID, stateID) {
    if (!session || typeof session.sendNotification !== "function") {
      return;
    }

    session.sendNotification("OnFighterTubeTaskStatus", "clientID", [
      Number(tubeFlagID) || 0,
      String(stateID || ""),
      null,
      null,
    ]);
  }

  Handle_GetFightersForShip(args, session, kwargs) {
    void args;
    void kwargs;

    const shipRecord = this._getActiveShip(session);
    if (!shipRecord) {
      return [buildTupleList([]), buildTupleList([]), buildDict([])];
    }

    const fightersInTubes = [];
    for (const tubeFlagID of FIGHTER_TUBE_FLAGS) {
      const fighterItem = this._getShipTubeItem(session, tubeFlagID);
      if (!fighterItem) {
        continue;
      }

      fightersInTubes.push([
        tubeFlagID,
        Number(fighterItem.itemID) || 0,
        Number(fighterItem.typeID) || 0,
        buildInventorySquadronSize(fighterItem),
      ]);
    }
    const runtime = require(path.join(__dirname, "../../space/runtime"));
    const scene = runtime.getSceneForSession(session);
    const fightersInSpace = scene
      ? buildFightersInSpaceRowsForShip(scene, shipRecord.itemID)
      : [];
    const abilityStateEntries = scene
      ? buildAbilityStateEntriesForShip(scene, shipRecord.itemID, session)
      : [];

    log.debug(
      `[FighterMgrService] GetFightersForShip ship=${shipRecord.itemID} tubes=${fightersInTubes.length} inSpace=${fightersInSpace.length}`,
    );
    return [
      buildTupleList(fightersInTubes),
      buildTupleList(fightersInSpace),
      buildDict(abilityStateEntries),
    ];
  }

  Handle_LoadFightersToTube(args, session, kwargs) {
    void kwargs;

    const fighterID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    const tubeFlagID = Number(args && args.length > 1 ? args[1] : 0) || 0;
    const shipRecord = this._getActiveShip(session);
    const fighterItem = this._resolveLoadableFighterItem(
      session,
      shipRecord,
      fighterID,
    );
    if (!shipRecord || fighterID <= 0 || !isFighterTubeFlag(tubeFlagID)) {
      return false;
    }
    if (
      !fighterItem ||
      this._getShipTubeItem(session, tubeFlagID)
    ) {
      return false;
    }

    const moveResult = moveItemToLocation(
      fighterID,
      shipRecord.itemID,
      tubeFlagID,
    );
    if (!moveResult.success) {
      return false;
    }

    this._emitInventoryChanges(session, moveResult.data && moveResult.data.changes);
    const movedItem = this._getShipTubeItem(session, tubeFlagID);
    if (movedItem) {
      this._notifyTubeContent(session, tubeFlagID, movedItem);
      this._notifyTubeState(session, tubeFlagID, TUBE_STATE_READY);
    }

    return true;
  }

  Handle_UnloadTubeToFighterBay(args, session, kwargs) {
    void kwargs;

    const tubeFlagID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    const shipRecord = this._getActiveShip(session);
    const fighterItem = this._getShipTubeItem(session, tubeFlagID);
    if (!shipRecord || !fighterItem || !isFighterTubeFlag(tubeFlagID)) {
      return false;
    }

    const moveResult = moveItemToLocation(
      fighterItem.itemID,
      shipRecord.itemID,
      ITEM_FLAGS.FIGHTER_BAY,
    );
    if (!moveResult.success) {
      return false;
    }

    this._emitInventoryChanges(session, moveResult.data && moveResult.data.changes);
    this._notifyTubeEmpty(session, tubeFlagID);
    this._notifyTubeState(session, tubeFlagID, TUBE_STATE_EMPTY);
    return true;
  }

  Handle_LaunchFightersFromTubes(args, session, kwargs) {
    void kwargs;
    const requestedTubeFlagIDs =
      Array.isArray(args) && args.length > 0 ? args[0] || [] : [];
    const result = launchFightersFromTubes(session, requestedTubeFlagIDs);
    return buildDict(result && Array.isArray(result.errors) ? result.errors : []);
  }

  Handle_RecallFightersToTubes(args, session, kwargs) {
    void kwargs;
    const requestedFighterIDs =
      Array.isArray(args) && args.length > 0 ? args[0] || [] : [];
    const result = recallFightersToTubes(session, requestedFighterIDs);
    return buildDict(
      result && Array.isArray(result.entries)
        ? result.entries
        : result && Array.isArray(result.errors)
          ? result.errors
          : [],
    );
  }

  Handle_ExecuteMovementCommandOnFighters(args, session, kwargs) {
    void kwargs;
    executeMovementCommandOnFighters(
      session,
      Array.isArray(args) && args.length > 0 ? args[0] || [] : [],
      Array.isArray(args) && args.length > 1 ? args[1] : null,
      ...(Array.isArray(args) ? args.slice(2) : []),
    );
    return null;
  }

  Handle_CmdActivateAbilitySlots(args, session, kwargs) {
    void kwargs;
    const result = activateAbilitySlots(
      session,
      Array.isArray(args) && args.length > 0 ? args[0] || [] : [],
      Array.isArray(args) && args.length > 1 ? args[1] : null,
      Array.isArray(args) && args.length > 2 ? args[2] : null,
    );
    return buildDict(
      result && Array.isArray(result.entries)
        ? result.entries
        : result && Array.isArray(result.errors)
          ? result.errors
          : [],
    );
  }

  Handle_CmdDeactivateAbilitySlots(args, session, kwargs) {
    void kwargs;
    const result = deactivateAbilitySlots(
      session,
      Array.isArray(args) && args.length > 0 ? args[0] || [] : [],
      Array.isArray(args) && args.length > 1 ? args[1] : null,
    );
    return buildDict(
      result && Array.isArray(result.entries)
        ? result.entries
        : result && Array.isArray(result.errors)
          ? result.errors
          : [],
    );
  }

  Handle_CmdAbandonFighter(args, session, kwargs) {
    void kwargs;
    return commandAbandonFighter(
      session,
      Array.isArray(args) && args.length > 0 ? args[0] : null,
    );
  }

  Handle_CmdScoopAbandonedFighterFromSpace(args, session, kwargs) {
    void kwargs;
    return scoopAbandonedFighterFromSpace(
      session,
      Array.isArray(args) && args.length > 0 ? args[0] : null,
      Array.isArray(args) && args.length > 1 ? args[1] : ITEM_FLAGS.FIGHTER_BAY,
    );
  }
}

module.exports = FighterMgrService;
