const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const database = require(path.join(__dirname, "../../newDatabase"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const { getStructureByID } = require(path.join(
  __dirname,
  "../structure/structureState",
));
const characterState = require(path.join(__dirname, "./characterState"));
const {
  currentFileTime,
  normalizeBigInt,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  clearCharacterPortraits,
} = require(path.join(__dirname, "./portraitImageStore"));
const {
  getCorporationRecord,
  setCharacterAffiliation,
} = require(path.join(__dirname, "../corporation/corporationState"));
const {
  findItemById,
  listOwnedItems,
  removeInventoryItem,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  clearCharacterSkills,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  clearCharacterExpertSystems,
} = require(path.join(__dirname, "../skills/expertSystems/expertSystemState"));
const {
  clearCharacterQueueState,
} = require(path.join(__dirname, "../skills/training/skillQueueState"));
const {
  clearCharacterPlanState,
} = require(path.join(__dirname, "../skills/plans/skillPlanState"));
const {
  clearCharacterSkillTradingState,
} = require(path.join(__dirname, "../skills/trading/skillTradingState"));
const missionRuntimeState = require(path.join(
  __dirname,
  "../agent/missionRuntimeState",
));
const probeRuntimeState = require(path.join(
  __dirname,
  "../exploration/probes/probeRuntimeState",
));
const bookmarkStore = require(path.join(
  __dirname,
  "../bookmark/bookmarkRuntimeStore",
));
const {
  deleteManyFittings,
  getOwnerFittings,
} = require(path.join(__dirname, "../../_secondary/fitting/fittingStore"));

const DOOMHEIM_CORPORATION_ID = 1000001;
const CORPORATION_DELIVERIES_FLAG_ID = 62;
const DEFAULT_HOME_STATION_ID = 60003760;
const FILETIME_MINUTE = 60n * 10000000n;
const FLUSH_TABLES = Object.freeze([
  "characters",
  "items",
  "mail",
  "notifications",
  "characterNotes",
  "lpWallets",
  "skillQueues",
  "skillPlans",
  "skillTradingState",
  "skills",
  "characterExpertSystems",
  "bookmarkRuntimeState",
  "bookmarks",
  "bookmarkFolders",
  "bookmarkSubfolders",
  "bookmarkKnownFolders",
  "bookmarkGroups",
  "savedFittings",
  "calendarEvents",
  "calendarResponses",
  "missionRuntimeState",
  "probeRuntimeState",
]);

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function toFiletimeString(value, fallback = "0") {
  const normalized = normalizeBigInt(value, 0n);
  return normalized > 0n ? normalized.toString() : String(fallback || "0");
}

function throwDeletionUserError(info) {
  throwWrappedUserError("CustomInfo", {
    info: String(info || "Character deletion failed."),
  });
}

function getCharacterDeletePrepareDateTime(record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const normalized = normalizeBigInt(record.deletePrepareDateTime, 0n);
  return normalized > 0n ? normalized.toString() : null;
}

function isCharacterQueuedForDeletion(record) {
  return Boolean(getCharacterDeletePrepareDateTime(record));
}

function getDeletionDelayMinutes() {
  return Math.max(1, toInt(config.characterDeletionDelayMinutes, 600));
}

function calculateDeleteReadyAtFiletime(nowFiletime = currentFileTime()) {
  return nowFiletime + (BigInt(getDeletionDelayMinutes()) * FILETIME_MINUTE);
}

function readTableRoot(tableName, fallbackValue) {
  const result = database.read(tableName, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return cloneValue(fallbackValue);
  }
  return result.data;
}

function writeTableRoot(tableName, root) {
  return database.write(tableName, "/", root, { force: true });
}

function removeTablePathIfPresent(tableName, pathName) {
  const result = database.remove(tableName, pathName);
  return Boolean(
    result &&
    (result.success || result.errorMsg === "ENTRY_NOT_FOUND" || result.errorMsg === "TABLE_NOT_FOUND")
  );
}

function assertCharacterOwnedByAccount(characterID, accountID) {
  const characterRecord = characterState.getCharacterRecord(characterID);
  if (!characterRecord) {
    throwDeletionUserError("That character no longer exists.");
  }

  const numericAccountID = toPositiveInt(accountID, 0);
  if (numericAccountID <= 0) {
    throwDeletionUserError("Character deletion requires a valid authenticated account.");
  }

  if (toPositiveInt(characterRecord.accountId, 0) !== numericAccountID) {
    throwDeletionUserError("That character is not available on this account.");
  }

  return characterRecord;
}

function assertCharacterOffline(characterID) {
  const activeSession = sessionRegistry.findSessionByCharacterID(characterID);
  if (activeSession) {
    throwDeletionUserError("That character is currently online and cannot be deleted.");
  }
}

function resolveDeliveryFallbackLocation(characterRecord) {
  const candidateIDs = [
    characterRecord && characterRecord.homeStationID,
    characterRecord && characterRecord.cloneStationID,
    characterRecord && characterRecord.stationID,
    DEFAULT_HOME_STATION_ID,
  ];
  for (const candidateID of candidateIDs) {
    const numericCandidateID = toPositiveInt(candidateID, 0);
    if (!numericCandidateID) {
      continue;
    }
    if (worldData.getStationByID(numericCandidateID) || getStructureByID(numericCandidateID)) {
      return numericCandidateID;
    }
  }
  return DEFAULT_HOME_STATION_ID;
}

function resolveDeliveryLocationForRootItem(characterRecord, item) {
  const locationID = toPositiveInt(item && item.locationID, 0);
  if (locationID > 0 && (worldData.getStationByID(locationID) || getStructureByID(locationID))) {
    return locationID;
  }
  return resolveDeliveryFallbackLocation(characterRecord);
}

function listCharacterOwnedRootItems(characterID) {
  const ownedItems = listOwnedItems(characterID).sort((left, right) => (
    toPositiveInt(left && left.itemID, 0) - toPositiveInt(right && right.itemID, 0)
  ));
  const ownedItemIDs = new Set(ownedItems.map((item) => toPositiveInt(item && item.itemID, 0)));
  return ownedItems.filter((item) => !ownedItemIDs.has(toPositiveInt(item && item.locationID, 0)));
}

function collectOwnedItemTree(ownerID, rootItemID) {
  const numericOwnerID = toPositiveInt(ownerID, 0);
  const numericRootItemID = toPositiveInt(rootItemID, 0);
  if (numericOwnerID <= 0 || numericRootItemID <= 0) {
    return [];
  }

  const ownedItems = listOwnedItems(numericOwnerID);
  const childIDsByLocationID = new Map();
  for (const item of ownedItems) {
    const locationID = toPositiveInt(item && item.locationID, 0);
    if (!childIDsByLocationID.has(locationID)) {
      childIDsByLocationID.set(locationID, []);
    }
    childIDsByLocationID.get(locationID).push(toPositiveInt(item && item.itemID, 0));
  }

  const visited = new Set();
  const orderedItemIDs = [];
  const pending = [numericRootItemID];
  while (pending.length > 0) {
    const currentItemID = pending.shift();
    if (currentItemID <= 0 || visited.has(currentItemID)) {
      continue;
    }
    visited.add(currentItemID);
    orderedItemIDs.push(currentItemID);
    const childIDs = childIDsByLocationID.get(currentItemID) || [];
    for (const childItemID of childIDs) {
      if (!visited.has(childItemID)) {
        pending.push(childItemID);
      }
    }
  }

  return orderedItemIDs;
}

function transferOwnedItemTree(
  rootItemID,
  destinationOwnerID,
  destinationLocationID,
  destinationFlagID,
) {
  const rootItem = findItemById(rootItemID);
  if (!rootItem) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const sourceOwnerID = toPositiveInt(rootItem.ownerID, 0);
  const treeItemIDs = collectOwnedItemTree(sourceOwnerID, rootItemID);
  if (treeItemIDs.length === 0) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const rootUpdateResult = updateInventoryItem(rootItemID, (item) => ({
    ...item,
    ownerID: destinationOwnerID,
    locationID: destinationLocationID,
    flagID: destinationFlagID,
  }));
  if (!rootUpdateResult.success) {
    return rootUpdateResult;
  }

  for (const itemID of treeItemIDs.slice(1)) {
    const updateResult = updateInventoryItem(itemID, (item) => ({
      ...item,
      ownerID: destinationOwnerID,
    }));
    if (!updateResult.success) {
      return updateResult;
    }
  }

  return {
    success: true,
    data: {
      movedItemIDs: treeItemIDs,
    },
  };
}

function transferCharacterAssetsToCorporation(characterID, characterRecord, corporationID) {
  const roots = listCharacterOwnedRootItems(characterID);
  const transferredRootItemIDs = [];

  for (const rootItem of roots) {
    const transferResult = transferOwnedItemTree(
      rootItem.itemID,
      corporationID,
      resolveDeliveryLocationForRootItem(characterRecord, rootItem),
      CORPORATION_DELIVERIES_FLAG_ID,
    );
    if (!transferResult.success) {
      throwDeletionUserError(
        `Failed to move assets into corporation deliveries for ${characterRecord.characterName || characterRecord.characterID}.`,
      );
    }
    transferredRootItemIDs.push(rootItem.itemID);
  }

  return {
    transferredRootItemIDs,
    rootCount: transferredRootItemIDs.length,
  };
}

function destroyCharacterAssets(characterID) {
  const destroyedRootItemIDs = [];
  const removedRootIDs = new Set();

  while (true) {
    const roots = listCharacterOwnedRootItems(characterID);
    if (roots.length === 0) {
      break;
    }

    for (const rootItem of roots) {
      const rootItemID = toPositiveInt(rootItem && rootItem.itemID, 0);
      if (rootItemID <= 0 || removedRootIDs.has(rootItemID)) {
        continue;
      }

      const removeResult = removeInventoryItem(rootItemID, {
        removeContents: true,
      });
      if (!removeResult.success) {
        throwDeletionUserError(
          `Failed to destroy assets for character ${characterID}.`,
        );
      }
      removedRootIDs.add(rootItemID);
      destroyedRootItemIDs.push(rootItemID);
    }
  }

  return {
    destroyedRootItemIDs,
    rootCount: destroyedRootItemIDs.length,
  };
}

function purgeBookmarkRuntimeCaches() {
  bookmarkStore.state.loaded = false;
  bookmarkStore.state.runtimeRoot = null;
  bookmarkStore.state.bookmarkRoot = null;
  bookmarkStore.state.folderRoot = null;
  bookmarkStore.state.subfolderRoot = null;
  bookmarkStore.state.knownRoot = null;
  bookmarkStore.state.groupRoot = null;
  bookmarkStore.state.bookmarksByID = new Map();
  bookmarkStore.state.foldersByID = new Map();
  bookmarkStore.state.subfoldersByID = new Map();
  bookmarkStore.state.groupsByID = new Map();
  bookmarkStore.state.knownFoldersByCharacterID = new Map();
  bookmarkStore.state.bookmarkIDsByFolderID = new Map();
  bookmarkStore.state.bookmarkIDsBySubfolderID = new Map();
  bookmarkStore.state.subfolderIDsByFolderID = new Map();
  bookmarkStore.state.bookmarkIDsByLocationID = new Map();
  bookmarkStore.state.folderIDsByCreatorCharacterID = new Map();
  bookmarkStore.state.defaultGroupIDByCorporationID = new Map();
}

function purgeBookmarkData(characterID) {
  const numericCharacterID = toPositiveInt(characterID, 0);
  const foldersRoot = readTableRoot("bookmarkFolders", { records: {} });
  const subfoldersRoot = readTableRoot("bookmarkSubfolders", { records: {} });
  const bookmarksRoot = readTableRoot("bookmarks", { records: {} });
  const knownRoot = readTableRoot("bookmarkKnownFolders", { recordsByCharacterID: {} });
  const groupsRoot = readTableRoot("bookmarkGroups", { records: {} });

  const deletedFolderIDs = new Set();
  const deletedSubfolderIDs = new Set();
  const deletedBookmarkIDs = new Set();
  let foldersChanged = false;
  let subfoldersChanged = false;
  let bookmarksChanged = false;
  let knownChanged = false;
  let groupsChanged = false;

  for (const [folderID, folder] of Object.entries(foldersRoot.records || {})) {
    if (
      folder &&
      folder.isPersonal !== false &&
      toPositiveInt(folder.creatorID, 0) === numericCharacterID
    ) {
      deletedFolderIDs.add(toPositiveInt(folderID, 0));
      delete foldersRoot.records[folderID];
      foldersChanged = true;
    }
  }

  for (const [subfolderID, subfolder] of Object.entries(subfoldersRoot.records || {})) {
    if (deletedFolderIDs.has(toPositiveInt(subfolder && subfolder.folderID, 0))) {
      deletedSubfolderIDs.add(toPositiveInt(subfolderID, 0));
      delete subfoldersRoot.records[subfolderID];
      subfoldersChanged = true;
    }
  }

  for (const [bookmarkID, bookmark] of Object.entries(bookmarksRoot.records || {})) {
    if (
      deletedFolderIDs.has(toPositiveInt(bookmark && bookmark.folderID, 0)) ||
      deletedSubfolderIDs.has(toPositiveInt(bookmark && bookmark.subfolderID, 0))
    ) {
      deletedBookmarkIDs.add(toPositiveInt(bookmarkID, 0));
      delete bookmarksRoot.records[bookmarkID];
      bookmarksChanged = true;
    }
  }

  for (const [ownerCharacterID, knownEntries] of Object.entries(
    knownRoot.recordsByCharacterID || {},
  )) {
    if (toPositiveInt(ownerCharacterID, 0) === numericCharacterID) {
      delete knownRoot.recordsByCharacterID[ownerCharacterID];
      knownChanged = true;
      continue;
    }

    if (!knownEntries || typeof knownEntries !== "object") {
      continue;
    }

    for (const folderID of Object.keys(knownEntries)) {
      if (deletedFolderIDs.has(toPositiveInt(folderID, 0))) {
        delete knownEntries[folderID];
        knownChanged = true;
      }
    }
  }

  const referencedGroupIDs = new Set();
  for (const folder of Object.values(foldersRoot.records || {})) {
    for (const groupID of [
      folder && folder.adminGroupID,
      folder && folder.manageGroupID,
      folder && folder.useGroupID,
      folder && folder.viewGroupID,
    ]) {
      const numericGroupID = toPositiveInt(groupID, 0);
      if (numericGroupID > 0) {
        referencedGroupIDs.add(numericGroupID);
      }
    }
  }

  for (const [groupID, group] of Object.entries(groupsRoot.records || {})) {
    const numericGroupID = toPositiveInt(groupID, 0);
    if (!group || typeof group !== "object" || numericGroupID <= 0) {
      continue;
    }

    if (
      toPositiveInt(group.creatorID, 0) === numericCharacterID &&
      !referencedGroupIDs.has(numericGroupID)
    ) {
      delete groupsRoot.records[groupID];
      groupsChanged = true;
      continue;
    }

    const filteredAdmins = Array.isArray(group.admins)
      ? group.admins.filter((entry) => toPositiveInt(entry, 0) !== numericCharacterID)
      : [];
    const filteredMembers = Array.isArray(group.members)
      ? group.members.filter((entry) => toPositiveInt(entry, 0) !== numericCharacterID)
      : [];
    if (
      filteredAdmins.length !== (Array.isArray(group.admins) ? group.admins.length : 0) ||
      filteredMembers.length !== (Array.isArray(group.members) ? group.members.length : 0)
    ) {
      group.admins = filteredAdmins;
      group.members = filteredMembers;
      groupsChanged = true;
    }
  }

  if (foldersChanged) {
    writeTableRoot("bookmarkFolders", foldersRoot);
  }
  if (subfoldersChanged) {
    writeTableRoot("bookmarkSubfolders", subfoldersRoot);
  }
  if (bookmarksChanged) {
    writeTableRoot("bookmarks", bookmarksRoot);
  }
  if (knownChanged) {
    writeTableRoot("bookmarkKnownFolders", knownRoot);
  }
  if (groupsChanged) {
    writeTableRoot("bookmarkGroups", groupsRoot);
  }
  if (foldersChanged || subfoldersChanged || bookmarksChanged || knownChanged || groupsChanged) {
    purgeBookmarkRuntimeCaches();
  }

  return {
    deletedFolderCount: deletedFolderIDs.size,
    deletedSubfolderCount: deletedSubfolderIDs.size,
    deletedBookmarkCount: deletedBookmarkIDs.size,
  };
}

function purgeCalendarData(characterID) {
  const numericCharacterID = toPositiveInt(characterID, 0);
  const eventsRoot = readTableRoot("calendarEvents", { events: {} });
  const responsesRoot = readTableRoot("calendarResponses", { responses: {} });
  const deletedEventIDs = new Set();
  let eventsChanged = false;
  let responsesChanged = false;

  for (const [eventID, event] of Object.entries(eventsRoot.events || {})) {
    if (!event || typeof event !== "object") {
      continue;
    }

    if (
      toPositiveInt(event.ownerID, 0) === numericCharacterID &&
      String(event.scope || "personal") === "personal"
    ) {
      deletedEventIDs.add(toPositiveInt(eventID, 0));
      delete eventsRoot.events[eventID];
      eventsChanged = true;
      continue;
    }

    if (Array.isArray(event.inviteeCharacterIDs)) {
      const filteredInvitees = event.inviteeCharacterIDs.filter(
        (entry) => toPositiveInt(entry, 0) !== numericCharacterID,
      );
      if (filteredInvitees.length !== event.inviteeCharacterIDs.length) {
        event.inviteeCharacterIDs = filteredInvitees;
        eventsChanged = true;
      }
    }
  }

  for (const [responseKey, response] of Object.entries(responsesRoot.responses || {})) {
    if (!response || typeof response !== "object") {
      continue;
    }
    if (
      toPositiveInt(response.characterID, 0) === numericCharacterID ||
      deletedEventIDs.has(toPositiveInt(response.eventID, 0))
    ) {
      delete responsesRoot.responses[responseKey];
      responsesChanged = true;
    }
  }

  if (eventsChanged) {
    writeTableRoot("calendarEvents", eventsRoot);
  }
  if (responsesChanged) {
    writeTableRoot("calendarResponses", responsesRoot);
  }

  return {
    deletedEventCount: deletedEventIDs.size,
  };
}

function purgePrivateCharacterState(characterID) {
  const numericCharacterID = toPositiveInt(characterID, 0);

  removeTablePathIfPresent("mail", `/mailboxes/${numericCharacterID}`);
  removeTablePathIfPresent("notifications", `/boxes/${numericCharacterID}`);
  removeTablePathIfPresent("lpWallets", `/characterWallets/${numericCharacterID}`);
  removeTablePathIfPresent("characterNotes", `/characters/${numericCharacterID}`);
  removeTablePathIfPresent("characters", `/${numericCharacterID}/characterSettings`);

  clearCharacterQueueState(numericCharacterID);
  clearCharacterPlanState(numericCharacterID);
  clearCharacterSkillTradingState(numericCharacterID);
  clearCharacterSkills(numericCharacterID);
  clearCharacterExpertSystems(numericCharacterID);
  removeTablePathIfPresent("characterExpertSystems", `/${numericCharacterID}`);

  missionRuntimeState.resetCharacterState(numericCharacterID);
  const probeSnapshot = probeRuntimeState.getCharacterStateSnapshot(numericCharacterID);
  const probeIDs = Object.keys((probeSnapshot && probeSnapshot.probesByID) || {})
    .map((value) => toPositiveInt(value, 0))
    .filter((value) => value > 0);
  if (probeIDs.length > 0) {
    probeRuntimeState.removeCharacterProbes(numericCharacterID, probeIDs);
  }
  removeTablePathIfPresent("probeRuntimeState", `/charactersByID/${numericCharacterID}`);

  const ownerFittings = getOwnerFittings(numericCharacterID, {
    ownerScope: "character",
  });
  const fittingIDs = Array.isArray(ownerFittings && ownerFittings.fittings)
    ? ownerFittings.fittings.map((record) => toPositiveInt(record && record.fittingID, 0))
    : [];
  if (fittingIDs.length > 0) {
    deleteManyFittings(numericCharacterID, fittingIDs, "character");
  }
  removeTablePathIfPresent("savedFittings", `/owners/${numericCharacterID}`);
  clearCharacterPortraits(numericCharacterID);

  const bookmarkSummary = purgeBookmarkData(numericCharacterID);
  const calendarSummary = purgeCalendarData(numericCharacterID);

  return {
    bookmarkSummary,
    calendarSummary,
  };
}

function prepareCharacterForDelete(characterID, accountID) {
  const numericCharacterID = toPositiveInt(characterID, 0);
  const characterRecord = assertCharacterOwnedByAccount(numericCharacterID, accountID);
  assertCharacterOffline(numericCharacterID);

  const existingDeletePrepareDateTime = getCharacterDeletePrepareDateTime(characterRecord);
  if (existingDeletePrepareDateTime) {
    return existingDeletePrepareDateTime;
  }

  const deletePrepareDateTime = calculateDeleteReadyAtFiletime();
  const updateResult = characterState.updateCharacterRecord(numericCharacterID, (record) => ({
    ...record,
    deletePrepareDateTime: deletePrepareDateTime.toString(),
  }));
  if (!updateResult.success) {
    throwDeletionUserError("Failed to queue that character for deletion.");
  }

  database.flushTablesSync(["characters"]);
  return deletePrepareDateTime.toString();
}

function cancelCharacterDeletePrepare(characterID, accountID) {
  const numericCharacterID = toPositiveInt(characterID, 0);
  const characterRecord = assertCharacterOwnedByAccount(numericCharacterID, accountID);
  assertCharacterOffline(numericCharacterID);

  if (!isCharacterQueuedForDeletion(characterRecord)) {
    return null;
  }

  const updateResult = characterState.updateCharacterRecord(numericCharacterID, (record) => ({
    ...record,
    deletePrepareDateTime: null,
  }));
  if (!updateResult.success) {
    throwDeletionUserError("Failed to cancel the deletion queue for that character.");
  }

  database.flushTablesSync(["characters"]);
  return null;
}

function deleteCharacter(characterID, accountID) {
  const numericCharacterID = toPositiveInt(characterID, 0);
  const characterRecord = assertCharacterOwnedByAccount(numericCharacterID, accountID);
  assertCharacterOffline(numericCharacterID);

  const deletePrepareDateTime = normalizeBigInt(
    getCharacterDeletePrepareDateTime(characterRecord),
    0n,
  );
  if (deletePrepareDateTime <= 0n) {
    throwDeletionUserError("That character is not in the biomass queue.");
  }

  const nowFiletime = currentFileTime();
  if (deletePrepareDateTime > nowFiletime) {
    throwDeletionUserError("That character is still waiting for the biomass timer to expire.");
  }

  const originalCorporationID = toPositiveInt(characterRecord.corporationID, 0);
  const originalCorporation = getCorporationRecord(originalCorporationID);
  const assetSummary =
    originalCorporation && originalCorporation.isNPC !== true
      ? transferCharacterAssetsToCorporation(
          numericCharacterID,
          characterRecord,
          originalCorporationID,
        )
      : destroyCharacterAssets(numericCharacterID);

  const deletedAt = nowFiletime.toString();
  const updateResult = characterState.writeCharacterRecord(numericCharacterID, {
    ...characterRecord,
    accountId: null,
    deletePrepareDateTime: null,
    deletedAt,
    deletedByAccountId: toPositiveInt(accountID, 0),
    isDeleted: true,
    shipID: null,
    shipTypeID: characterRecord.shipTypeID || 670,
    shipName: characterRecord.shipName || "Capsule",
    structureID: null,
    worldSpaceID: 0,
    tutorialFirstLoginHandoff: "none",
    tutorialEntryMode:
      characterRecord.tutorialEntryMode || "disabled",
    nesIntroState: 0,
    airNpeRevealOnFirstLogin: false,
  });
  if (!updateResult.success) {
    throwDeletionUserError("Failed to finalize that character deletion.");
  }

  const affiliationResult = setCharacterAffiliation(
    numericCharacterID,
    DOOMHEIM_CORPORATION_ID,
    null,
  );
  if (!affiliationResult || !affiliationResult.success) {
    throwDeletionUserError("Failed to move that deleted character into the graveyard corporation.");
  }

  const privateStateSummary = purgePrivateCharacterState(numericCharacterID);
  if (originalCorporation && originalCorporation.isNPC === true) {
    destroyCharacterAssets(numericCharacterID);
  }

  const flushResult = database.flushTablesSync(FLUSH_TABLES);
  if (!flushResult.success) {
    throwDeletionUserError("Character deletion completed in memory but failed to flush cleanly to disk.");
  }

  log.info(
    `[CharacterDeletion] Deleted char=${numericCharacterID} corp=${originalCorporationID || 0} ` +
    `npcCorp=${originalCorporation && originalCorporation.isNPC === true} assets=${assetSummary.rootCount || 0} ` +
    `deletedAt=${deletedAt}`,
  );

  return {
    success: true,
    deletedAt,
    assetSummary,
    privateStateSummary,
  };
}

module.exports = {
  DOOMHEIM_CORPORATION_ID,
  calculateDeleteReadyAtFiletime,
  cancelCharacterDeletePrepare,
  deleteCharacter,
  getCharacterDeletePrepareDateTime,
  getDeletionDelayMinutes,
  isCharacterQueuedForDeletion,
  prepareCharacterForDelete,
};
