const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const config = require(path.join(repoRoot, "server/src/config"));
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  currentFileTime,
} = require(path.join(repoRoot, "server/src/services/_shared/serviceHelpers"));
const {
  ITEM_FLAGS,
  findItemById,
  grantItemToCharacterLocation,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  createCustomCorporation,
} = require(path.join(repoRoot, "server/src/services/corporation/corporationState"));
const bookmarkStore = require(path.join(
  repoRoot,
  "server/src/services/bookmark/bookmarkRuntimeStore",
));
const probeRuntimeState = require(path.join(
  repoRoot,
  "server/src/services/exploration/probes/probeRuntimeState",
));
const {
  resetSavedFittingStoreForTests,
} = require(path.join(repoRoot, "server/src/_secondary/fitting/fittingStore"));
const {
  resetExpertSystemStateForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/skills/expertSystems/expertSystemState",
));
const {
  MachoWrappedException,
} = require(path.join(repoRoot, "server/src/common/machoErrors"));

const SNAPSHOT_TABLES = Object.freeze([
  "characters",
  "identityState",
  "items",
  "skills",
  "mail",
  "notifications",
  "characterNotes",
  "lpWallets",
  "skillQueues",
  "skillPlans",
  "skillTradingState",
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
  "corporations",
]);

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function restoreTable(tableName, snapshot) {
  database.write(tableName, "/", cloneValue(snapshot), { force: true });
}

function resetBookmarkRuntimeStore() {
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

function restoreDeletionTestState(t) {
  const snapshots = Object.fromEntries(
    SNAPSHOT_TABLES.map((tableName) => [
      tableName,
      cloneValue(database.read(tableName, "/").data || {}),
    ]),
  );
  const originalDeletionDelayMinutes = config.characterDeletionDelayMinutes;

  t.after(() => {
    config.characterDeletionDelayMinutes = originalDeletionDelayMinutes;
    for (const [tableName, snapshot] of Object.entries(snapshots)) {
      restoreTable(tableName, snapshot);
    }
    resetBookmarkRuntimeStore();
    resetSavedFittingStoreForTests();
    resetExpertSystemStateForTests();
    probeRuntimeState.clearRuntimeCache();
    database.flushAllSync();
  });
}

function buildAccountSession(userID) {
  return {
    userid: userID,
    charid: 0,
    characterID: 0,
    clientID: userID,
    socket: {
      destroyed: false,
    },
    sendNotification() {},
    sendSessionChange() {},
  };
}

function getKeyValEntry(keyVal, key) {
  if (!keyVal || typeof keyVal !== "object" || !keyVal.args || !Array.isArray(keyVal.args.entries)) {
    return undefined;
  }
  const entry = keyVal.args.entries.find(([entryKey]) => entryKey === key);
  return entry ? entry[1] : undefined;
}

function getSelectionCharacterRow(charService, session, characterID) {
  const tuple = charService.Handle_GetCharacterSelectionData([], session);
  const characterDetails = tuple && tuple[2] && tuple[2].type === "list"
    ? tuple[2].items
    : [];
  return characterDetails.find((row) => Number(getKeyValEntry(row, "characterID")) === characterID) || null;
}

function createDeletionCandidate(charService, accountSession, name) {
  return charService.Handle_CreateCharacterWithDoll(
    [
      name,
      1,
      1,
      1,
      1,
      { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [] } },
      { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [] } },
      11,
    ],
    accountSession,
  );
}

function getGrantedItemId(grantResult, predicate, label) {
  const items = grantResult && grantResult.data && Array.isArray(grantResult.data.items)
    ? grantResult.data.items
    : [];
  const matchedItem = items.find((item) => item && predicate(item)) || null;
  assert.ok(
    matchedItem,
    `expected granted ${label}; saw ${JSON.stringify(items.map((item) => ({
      itemID: item && item.itemID,
      typeID: item && item.typeID,
      locationID: item && item.locationID,
      flagID: item && item.flagID,
      ownerID: item && item.ownerID,
    })))}`
  );
  return Number(matchedItem.itemID);
}

function seedDeletionPrivateState(characterID) {
  const numericCharacterID = Number(characterID);
  const charactersTable = database.read("characters", "/").data || {};
  database.write(
    "characters",
    `/${numericCharacterID}/characterSettings/deleteParity`,
    "queued",
  );

  const notifications = cloneValue(database.read("notifications", "/").data || {
    _meta: { nextNotificationID: 1 },
    boxes: {},
  });
  notifications._meta = notifications._meta || { nextNotificationID: 1 };
  notifications.boxes = notifications.boxes || {};
  notifications.boxes[String(numericCharacterID)] = {
    byID: {
      1: {
        notificationID: 1,
        typeID: 1,
        senderID: 140000004,
        receiverID: numericCharacterID,
        processed: false,
        created: "134000000000000000",
        groupID: null,
        data: {},
      },
    },
    order: [1],
  };
  database.write("notifications", "/", notifications, { force: true });

  database.write("lpWallets", "/", {
    _meta: { generatedAt: null, lastUpdatedAt: null },
    characterWallets: {
      [numericCharacterID]: {
        1000002: 250,
      },
    },
    corporationWallets: {},
  }, { force: true });

  database.write("characterNotes", "/", {
    _meta: { version: 1, nextNoteID: 2 },
    characters: {
      [numericCharacterID]: {
        notes: {
          1: {
            noteID: 1,
            label: "Delete Parity",
            note: "Should be purged",
            created: "134000000000000000",
            updated: "134000000000000000",
          },
        },
        itemNotes: {},
      },
    },
  }, { force: true });

  database.write("skillQueues", "/", {
    [numericCharacterID]: {
      queue: [{ typeID: 3300, toLevel: 1 }],
      active: false,
      activeStartTime: null,
      updatedAt: "134000000000000000",
    },
  }, { force: true });
  database.write("skillPlans", "/", {
    [numericCharacterID]: {
      activePlanID: null,
      plans: {},
    },
  }, { force: true });
  database.write("skillTradingState", "/", {
    [numericCharacterID]: {
      nextAlphaInjectionAt: "0",
      nonDiminishingInjectionsRemaining: 1,
      updatedAt: "134000000000000000",
    },
  }, { force: true });
  database.write("characterExpertSystems", "/", {
    [numericCharacterID]: {
      999: {
        characterID: numericCharacterID,
        typeID: 999,
        installedAtMs: 1,
        expiresAtMs: 2,
        grantReason: "delete-parity",
        updatedAtMs: 1,
      },
    },
  }, { force: true });

  database.write("bookmarkRuntimeState", "/", {
    _meta: {
      version: 1,
      nextBookmarkID: 900000002,
      nextFolderID: 500002,
      nextSubfolderID: 700001,
      nextGroupID: 800002,
      migratedCharacterIDs: {},
    },
  }, { force: true });
  database.write("bookmarkFolders", "/", {
    records: {
      500001: {
        folderID: 500001,
        folderName: "Delete Parity Personal",
        description: "",
        creatorID: numericCharacterID,
        isPersonal: true,
        adminGroupID: 800001,
        manageGroupID: null,
        useGroupID: null,
        viewGroupID: null,
        created: "134000000000000000",
      },
    },
  }, { force: true });
  database.write("bookmarkSubfolders", "/", {
    records: {},
  }, { force: true });
  database.write("bookmarks", "/", {
    records: {
      900000001: {
        bookmarkID: 900000001,
        folderID: 500001,
        itemID: null,
        typeID: 5,
        memo: "Delete parity bookmark",
        note: "",
        created: "134000000000000000",
        expiry: null,
        x: 1,
        y: 2,
        z: 3,
        locationID: 30000142,
        subfolderID: null,
        creatorID: numericCharacterID,
        metadata: {},
      },
    },
  }, { force: true });
  database.write("bookmarkKnownFolders", "/", {
    recordsByCharacterID: {
      [numericCharacterID]: {
        500001: {
          folderID: 500001,
          isActive: true,
        },
      },
    },
  }, { force: true });
  database.write("bookmarkGroups", "/", {
    records: {
      800001: {
        groupID: 800001,
        creatorID: numericCharacterID,
        name: "Delete Parity Group",
        description: "",
        admins: [numericCharacterID],
        members: [numericCharacterID],
        membershipType: 2,
        created: "134000000000000000",
      },
    },
  }, { force: true });

  database.write("savedFittings", "/", {
    _meta: { version: 1, nextFittingID: 2 },
    owners: {
      [numericCharacterID]: {
        ownerID: numericCharacterID,
        scope: "character",
        fittings: {
          1: {
            fittingID: 1,
            ownerID: numericCharacterID,
            shipTypeID: 606,
            name: "Delete Parity Fit",
            description: "",
            fitData: [[34, 5, 1]],
            savedDate: "134000000000000000",
          },
        },
      },
    },
  }, { force: true });

  database.write("calendarEvents", "/", {
    version: 1,
    nextEventID: 2,
    events: {
      1: {
        eventID: 1,
        ownerID: numericCharacterID,
        creatorID: numericCharacterID,
        scope: "personal",
        source: "player",
        title: "Delete Parity Event",
        description: "",
        eventDateTime: "134000000000000000",
        eventDuration: null,
        importance: 0,
        autoEventType: null,
        isDeleted: false,
        deletedAt: null,
        createdAt: "134000000000000000",
        updatedAt: "134000000000000000",
        inviteeCharacterIDs: [numericCharacterID],
        seedKey: null,
        serverEditable: false,
        year: 2026,
        month: 4,
      },
    },
  }, { force: true });
  database.write("calendarResponses", "/", {
    version: 1,
    responses: {
      [`1:${numericCharacterID}`]: {
        key: `1:${numericCharacterID}`,
        eventID: 1,
        characterID: numericCharacterID,
        ownerID: numericCharacterID,
        status: 3,
        updatedAt: "134000000000000000",
      },
    },
  }, { force: true });

  database.write("missionRuntimeState", "/", {
    charactersByID: {
      [numericCharacterID]: {
        lastUpdatedAtMs: Date.now(),
      },
    },
  }, { force: true });
  database.write("probeRuntimeState", "/", {
    version: 2,
    nextProbeSequence: 2,
    charactersByID: {
      [numericCharacterID]: {
        lastUpdatedAtMs: Date.now(),
        probesByID: {
          990000000001: {
            probeID: 990000000001,
            characterID: numericCharacterID,
            systemID: 30000142,
          },
        },
      },
    },
  }, { force: true });

  database.write("characters", "/", charactersTable, { force: true });
}

test("PrepareCharacterForDelete sets the queue timestamp, surfaces it in selection data, blocks login, and CancelCharacterDeletePrepare clears it", (t) => {
  restoreDeletionTestState(t);
  config.characterDeletionDelayMinutes = 5;

  const charService = new CharService();
  const session = buildAccountSession(920001);
  const characterID = createDeletionCandidate(charService, session, "Delete Queue Parity");

  const prepareResult = charService.Handle_PrepareCharacterForDelete([characterID], session);
  assert.equal(prepareResult.type, "long");

  const storedRecord = getCharacterRecord(characterID);
  assert.equal(
    String(storedRecord.deletePrepareDateTime),
    String(prepareResult.value),
  );

  const nowFiletime = currentFileTime();
  const delta = BigInt(String(prepareResult.value)) - nowFiletime;
  assert.ok(
    delta >= 4n * 60n * 10000000n && delta <= 5n * 60n * 10000000n + 30n * 10000000n,
    `expected delete timer close to 5 minutes, got delta ${delta}`,
  );

  const selectionRow = getSelectionCharacterRow(charService, session, characterID);
  assert.ok(selectionRow, "expected queued character in selection data");
  const selectionDeletePrepareTime = getKeyValEntry(selectionRow, "deletePrepareDateTime");
  assert.equal(selectionDeletePrepareTime.type, "long");
  assert.equal(String(selectionDeletePrepareTime.value), String(prepareResult.value));

  assert.throws(
    () => charService.Handle_SelectCharacterID([characterID], buildAccountSession(920001)),
    (error) => error instanceof MachoWrappedException,
  );

  charService.Handle_CancelCharacterDeletePrepare([characterID], session);
  const cancelledRecord = getCharacterRecord(characterID);
  assert.equal(cancelledRecord.deletePrepareDateTime, null);

  const refreshedRow = getSelectionCharacterRow(charService, session, characterID);
  assert.equal(getKeyValEntry(refreshedRow, "deletePrepareDateTime"), null);
});

test("delete queue state persists across a fresh character-service instance and cancel persists too", (t) => {
  restoreDeletionTestState(t);
  config.characterDeletionDelayMinutes = 5;

  const firstService = new CharService();
  const session = buildAccountSession(920011);
  const characterID = createDeletionCandidate(firstService, session, "Delete Restart Parity");

  const prepareResult = firstService.Handle_PrepareCharacterForDelete([characterID], session);
  database.flushTablesSync(["characters"]);

  const secondService = new CharService();
  const queuedRow = getSelectionCharacterRow(secondService, session, characterID);
  const queuedDeletePrepareTime = getKeyValEntry(queuedRow, "deletePrepareDateTime");
  assert.equal(queuedDeletePrepareTime.type, "long");
  assert.equal(String(queuedDeletePrepareTime.value), String(prepareResult.value));

  secondService.Handle_CancelCharacterDeletePrepare([characterID], session);
  database.flushTablesSync(["characters"]);

  const thirdService = new CharService();
  const clearedRow = getSelectionCharacterRow(thirdService, session, characterID);
  assert.equal(getKeyValEntry(clearedRow, "deletePrepareDateTime"), null);
});

test("only the owning account can prepare, cancel, or finalize a character deletion queue", (t) => {
  restoreDeletionTestState(t);
  config.characterDeletionDelayMinutes = 5;

  const charService = new CharService();
  const ownerSession = buildAccountSession(920012);
  const foreignSession = buildAccountSession(920013);
  const characterID = createDeletionCandidate(charService, ownerSession, "Delete Ownership Parity");

  assert.throws(
    () => charService.Handle_PrepareCharacterForDelete([characterID], foreignSession),
    (error) => error instanceof MachoWrappedException,
  );

  charService.Handle_PrepareCharacterForDelete([characterID], ownerSession);

  assert.throws(
    () => charService.Handle_CancelCharacterDeletePrepare([characterID], foreignSession),
    (error) => error instanceof MachoWrappedException,
  );

  updateCharacterRecord(characterID, (record) => ({
    ...record,
    deletePrepareDateTime: (currentFileTime() - 1n).toString(),
  }));

  assert.throws(
    () => charService.Handle_DeleteCharacter([characterID], foreignSession),
    (error) => error instanceof MachoWrappedException,
  );

  const record = getCharacterRecord(characterID);
  assert.equal(Number(record.accountId), 920012);
  assert.equal(record.isDeleted, undefined);
});

test("DeleteCharacter refuses to finalize before the configured timer expires", (t) => {
  restoreDeletionTestState(t);
  config.characterDeletionDelayMinutes = 5;

  const charService = new CharService();
  const session = buildAccountSession(920002);
  const characterID = createDeletionCandidate(charService, session, "Delete Too Soon");

  charService.Handle_PrepareCharacterForDelete([characterID], session);

  assert.throws(
    () => charService.Handle_DeleteCharacter([characterID], session),
    (error) => error instanceof MachoWrappedException,
  );

  const record = getCharacterRecord(characterID);
  assert.equal(Number(record.accountId), 920002);
  assert.equal(record.isDeleted, undefined);
});

test("final NPC-corp biomass destroys assets, purges private state, and tombstones the character without leaving it on the account", (t) => {
  restoreDeletionTestState(t);
  config.characterDeletionDelayMinutes = 5;

  const charService = new CharService();
  const session = buildAccountSession(920003);
  const characterID = createDeletionCandidate(charService, session, "Delete NPC Corp");
  const initialRecord = getCharacterRecord(characterID);
  const stationID = Number(initialRecord.homeStationID || initialRecord.stationID || 60003760);
  const activeShipID = Number(initialRecord.shipID);

  const hangarGrant = grantItemToCharacterLocation(
    characterID,
    stationID,
    ITEM_FLAGS.HANGAR,
    34,
    250,
  );
  assert.equal(hangarGrant.success, true);
  const hangarItemID = getGrantedItemId(
    hangarGrant,
    (item) =>
      Number(item.typeID) === 34 &&
      Number(item.locationID) === stationID &&
      Number(item.flagID) === ITEM_FLAGS.HANGAR &&
      Number(item.ownerID) === Number(characterID),
    "NPC-corp hangar stack",
  );

  seedDeletionPrivateState(characterID);
  charService.Handle_PrepareCharacterForDelete([characterID], session);
  updateCharacterRecord(characterID, (record) => ({
    ...record,
    deletePrepareDateTime: (currentFileTime() - 1n).toString(),
  }));

  const numCharactersBefore = charService.Handle_GetNumCharacters([], session);
  assert.equal(numCharactersBefore >= 1, true);

  const result = charService.Handle_DeleteCharacter([characterID], session);
  assert.equal(result, null);

  const deletedRecord = getCharacterRecord(characterID);
  assert.equal(deletedRecord.accountId, null);
  assert.equal(deletedRecord.isDeleted, true);
  assert.equal(Number(deletedRecord.corporationID), 1000001);
  assert.equal(deletedRecord.deletePrepareDateTime, null);
  assert.ok(deletedRecord.deletedAt, "expected deletedAt tombstone");
  assert.equal(Number(deletedRecord.deletedByAccountId), 920003);

  assert.equal(findItemById(activeShipID), null, "expected rookie ship destroyed in NPC corp delete");
  assert.equal(findItemById(hangarItemID), null, "expected hangar stack destroyed in NPC corp delete");

  assert.equal(
    database.read("mail", `/mailboxes/${characterID}`).success,
    false,
    "expected mailbox removed",
  );
  assert.equal(
    database.read("notifications", `/boxes/${characterID}`).success,
    false,
    "expected notification box removed",
  );
  assert.equal(
    database.read("lpWallets", `/characterWallets/${characterID}`).success,
    false,
    "expected LP wallet removed",
  );
  assert.equal(
    database.read("characterNotes", `/characters/${characterID}`).success,
    false,
    "expected character notes removed",
  );
  assert.equal(
    database.read("skillQueues", `/${characterID}`).success,
    false,
    "expected skill queue removed",
  );
  assert.equal(
    database.read("skillPlans", `/${characterID}`).success,
    false,
    "expected skill plans removed",
  );
  assert.equal(
    database.read("skillTradingState", `/${characterID}`).success,
    false,
    "expected skill trading state removed",
  );
  assert.equal(
    database.read("characterExpertSystems", `/${characterID}`).success,
    false,
    "expected expert systems removed",
  );
  assert.equal(
    database.read("bookmarkKnownFolders", `/recordsByCharacterID/${characterID}`).success,
    false,
    "expected known bookmark folders removed",
  );
  assert.equal(
    database.read("savedFittings", `/owners/${characterID}`).success,
    false,
    "expected saved fittings removed",
  );
  assert.equal(
    database.read("calendarEvents", "/events/1").success,
    false,
    "expected personal calendar event removed",
  );
  assert.equal(
    database.read("calendarResponses", `/responses/1:${characterID}`).success,
    false,
    "expected personal calendar response removed",
  );

  const numCharactersAfter = charService.Handle_GetNumCharacters([], session);
  assert.equal(numCharactersAfter, numCharactersBefore - 1);
});

test("final player-corp biomass moves root assets to corporation deliveries and preserves nested cargo under the moved ship", (t) => {
  restoreDeletionTestState(t);
  config.characterDeletionDelayMinutes = 5;

  const charService = new CharService();
  const session = buildAccountSession(920004);
  const characterID = createDeletionCandidate(charService, session, "Delete Player Corp");
  const initialRecord = getCharacterRecord(characterID);
  const stationID = Number(initialRecord.homeStationID || initialRecord.stationID || 60003760);
  const shipID = Number(initialRecord.shipID);

  const createCorporationResult = createCustomCorporation(
    characterID,
    "Delete Parity Test Corp",
  );
  assert.equal(createCorporationResult.success, true);
  const playerCorporationID = Number(createCorporationResult.data.corporationID);
  assert.equal(Number(getCharacterRecord(characterID).corporationID), playerCorporationID);

  const hangarGrant = grantItemToCharacterLocation(
    characterID,
    stationID,
    ITEM_FLAGS.HANGAR,
    34,
    500,
  );
  assert.equal(hangarGrant.success, true);
  const hangarItemID = getGrantedItemId(
    hangarGrant,
    (item) =>
      Number(item.typeID) === 34 &&
      Number(item.locationID) === stationID &&
      Number(item.flagID) === ITEM_FLAGS.HANGAR &&
      Number(item.ownerID) === Number(characterID),
    "player-corp hangar stack",
  );

  const cargoGrant = grantItemToCharacterLocation(
    characterID,
    shipID,
    ITEM_FLAGS.CARGO_HOLD,
    35,
    75,
  );
  assert.equal(cargoGrant.success, true);
  const cargoItemID = getGrantedItemId(
    cargoGrant,
    (item) =>
      Number(item.typeID) === 35 &&
      Number(item.locationID) === shipID &&
      Number(item.flagID) === ITEM_FLAGS.CARGO_HOLD &&
      Number(item.ownerID) === Number(characterID),
    "player-corp cargo stack",
  );

  charService.Handle_PrepareCharacterForDelete([characterID], session);
  updateCharacterRecord(characterID, (record) => ({
    ...record,
    deletePrepareDateTime: (currentFileTime() - 1n).toString(),
  }));

  charService.Handle_DeleteCharacter([characterID], session);

  const deletedRecord = getCharacterRecord(characterID);
  assert.equal(deletedRecord.accountId, null);
  assert.equal(deletedRecord.isDeleted, true);
  assert.equal(Number(deletedRecord.corporationID), 1000001);

  const transferredShip = findItemById(shipID);
  assert.ok(transferredShip, "expected ship to survive and move to corp deliveries");
  assert.equal(Number(transferredShip.ownerID), playerCorporationID);
  assert.equal(Number(transferredShip.locationID), stationID);
  assert.equal(Number(transferredShip.flagID), 62);

  const transferredHangarItem = findItemById(hangarItemID);
  assert.ok(transferredHangarItem, "expected hangar stack to survive and move to corp deliveries");
  assert.equal(Number(transferredHangarItem.ownerID), playerCorporationID);
  assert.equal(Number(transferredHangarItem.locationID), stationID);
  assert.equal(Number(transferredHangarItem.flagID), 62);

  const transferredCargoItem = findItemById(cargoItemID);
  assert.ok(transferredCargoItem, "expected ship cargo to remain under the moved ship");
  assert.equal(Number(transferredCargoItem.ownerID), playerCorporationID);
  assert.equal(Number(transferredCargoItem.locationID), shipID);
  assert.equal(Number(transferredCargoItem.flagID), ITEM_FLAGS.CARGO_HOLD);
});
