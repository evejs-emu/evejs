const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const ServiceManager = require(path.join(
  repoRoot,
  "server/src/services/serviceManager",
));
const TradeMgrService = require(path.join(
  repoRoot,
  "server/src/services/trade/tradeMgrService",
));
const {
  abortTradesForSession,
} = require(path.join(
  repoRoot,
  "server/src/services/trade/tradeMgrService",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const {
  marshalEncode,
  marshalDecode,
} = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));
const {
  buildKeyVal,
  buildList,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/serviceHelpers",
));
const {
  applyCharacterToSession,
  getActiveShipRecord,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  ITEM_FLAGS,
  findItemById,
  grantItemToCharacterLocation,
  grantItemToCharacterStationHangar,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));
const {
  getCharacterWallet,
  getCharacterWalletJournal,
  JOURNAL_ENTRY_TYPE,
} = require(path.join(
  repoRoot,
  "server/src/services/account/walletState",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getUserErrorMessage(error) {
  return (
    error &&
    error.machoErrorResponse &&
    error.machoErrorResponse.payload &&
    Array.isArray(error.machoErrorResponse.payload.header) &&
    Array.isArray(error.machoErrorResponse.payload.header[1]) &&
    error.machoErrorResponse.payload.header[1][0]
  ) || null;
}

function getUserErrorDictionary(error) {
  const dictPayload = error &&
    error.machoErrorResponse &&
    error.machoErrorResponse.payload &&
    Array.isArray(error.machoErrorResponse.payload.header) &&
    Array.isArray(error.machoErrorResponse.payload.header[1]) &&
    error.machoErrorResponse.payload.header[1][1];
  const entries =
    dictPayload &&
    dictPayload.type === "dict" &&
    Array.isArray(dictPayload.entries)
      ? dictPayload.entries
      : [];
  return Object.fromEntries(entries);
}

function captureThrownError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("Expected function to throw");
}

function extractBoundID(value) {
  return value &&
    value.type === "substruct" &&
    value.value &&
    value.value.type === "substream" &&
    Array.isArray(value.value.value)
    ? value.value.value[0]
    : null;
}

function keyValToObject(payload) {
  assert.equal(payload && payload.name, "util.KeyVal");
  const entries =
    payload &&
    payload.args &&
    payload.args.type === "dict" &&
    Array.isArray(payload.args.entries)
      ? payload.args.entries
      : [];
  return Object.fromEntries(entries.map(([key, value]) => [key, value]));
}

function listPayloadToArray(payload) {
  return payload && payload.type === "list" && Array.isArray(payload.items)
    ? payload.items
    : [];
}

function packedRowsToFields(payload) {
  return listPayloadToArray(payload)
    .map((entry) => (entry && entry.type === "packedrow" ? entry.fields : entry))
    .filter(Boolean);
}

function getDockedTradePair() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters");

  const dockedCandidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const characterRecord = getCharacterRecord(characterID);
      const activeShip = getActiveShipRecord(characterID);
      const stationID = Number(
        characterRecord && (characterRecord.stationID || characterRecord.stationid || 0),
      ) || 0;
      if (!characterRecord || !activeShip || stationID <= 0) {
        return null;
      }
      return {
        characterID,
        stationID,
      };
    })
    .filter(Boolean);

  assert.ok(dockedCandidates.length >= 2, "Expected at least two docked characters for trade tests");

  for (const left of dockedCandidates) {
    const right = dockedCandidates.find((candidate) => (
      candidate.characterID !== left.characterID &&
      candidate.stationID === left.stationID
    ));
    if (right) {
      return {
        left,
        right,
      };
    }
  }

  return {
    left: dockedCandidates[0],
    right: dockedCandidates[1],
  };
}

function buildSession(characterID) {
  return {
    clientID: characterID + 99000,
    userid: characterID,
    characterID,
    socket: { destroyed: false },
    notifications: [],
    currentBoundObjectID: null,
    _boundObjectIDs: {},
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function bootstrapTradeHarness() {
  const pair = getDockedTradePair();
  const leftSession = buildSession(pair.left.characterID);
  const rightSession = buildSession(pair.right.characterID);

  const leftApply = applyCharacterToSession(leftSession, pair.left.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  const rightApply = applyCharacterToSession(rightSession, pair.right.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(leftApply.success, true);
  assert.equal(rightApply.success, true);

  const sharedStationID = Number(pair.left.stationID || 0);
  leftSession.stationid = sharedStationID;
  leftSession.stationID = sharedStationID;
  leftSession.structureid = null;
  leftSession.structureID = null;
  rightSession.stationid = sharedStationID;
  rightSession.stationID = sharedStationID;
  rightSession.structureid = null;
  rightSession.structureID = null;

  sessionRegistry.register(leftSession);
  sessionRegistry.register(rightSession);

  const serviceManager = new ServiceManager();
  const service = new TradeMgrService();
  serviceManager.register(service);

  return {
    sharedStationID,
    leftSession,
    rightSession,
    service,
    cleanup() {
      sessionRegistry.unregister(leftSession);
      sessionRegistry.unregister(rightSession);
    },
  };
}

function startTrade(harness) {
  const bound = harness.service.Handle_InitiateTrade(
    [harness.rightSession.characterID],
    harness.leftSession,
  );
  const leftBoundID = extractBoundID(bound);
  assert.ok(leftBoundID, "Expected InitiateTrade to return a bound trade session");
  harness.leftSession.currentBoundObjectID = leftBoundID;

  const notify = harness.rightSession.notifications.find(
    (entry) => entry.name === "OnTradeInitiate",
  );
  assert.ok(notify, "Expected the target session to receive OnTradeInitiate");
  const rightBoundID = extractBoundID(notify.payload[1]);
  assert.equal(rightBoundID, leftBoundID, "Expected both pilots to share the same bound trade session");
  harness.rightSession.currentBoundObjectID = rightBoundID;

  const listResponse = harness.service.Handle_List([], harness.leftSession);
  const listData = keyValToObject(listResponse);
  return {
    boundID: leftBoundID,
    tradeContainerID: Number(listData.tradeContainerID || 0) || 0,
  };
}

function buildManifest(tradeContainerID, money, items) {
  return {
    tradeContainerID,
    money,
    tradeItems: items,
  };
}

function buildClientStyleManifest(tradeContainerID, money, items) {
  return marshalDecode(marshalEncode(buildKeyVal([
    ["tradeContainerID", tradeContainerID],
    ["money", buildList(Array.isArray(money) ? money : [])],
    [
      "tradeItems",
      {
        type: "objectex1",
        header: [
          { type: "token", value: "__builtin__.set" },
          [buildList(Array.isArray(items) ? items : [])],
        ],
        list: [],
        dict: [],
      },
    ],
  ])));
}

test("trademgr initiates a docked trade and exposes a bound List() session to both pilots", { concurrency: false }, () => {
  const charactersSnapshot = cloneValue(database.read("characters", "/").data);
  const itemsSnapshot = cloneValue(database.read("items", "/").data);
  const harness = bootstrapTradeHarness();

  try {
    const trade = startTrade(harness);
    assert.ok(trade.tradeContainerID > 0, "Expected a synthetic trade container ID");

    const leftList = keyValToObject(
      harness.service.Handle_List([], harness.leftSession),
    );
    const rightList = keyValToObject(
      harness.service.Handle_List([], harness.rightSession),
    );

    assert.deepEqual(
      listPayloadToArray(leftList.traders),
      [harness.leftSession.characterID, harness.rightSession.characterID],
      "Expected List() traders to match both participants",
    );
    assert.equal(
      Number(rightList.tradeContainerID || 0),
      trade.tradeContainerID,
      "Expected both sides to resolve the same trade container",
    );
    assert.deepEqual(
      packedRowsToFields(leftList.items),
      [],
      "Expected a fresh trade session to start empty",
    );
  } finally {
    harness.cleanup();
    database.write("characters", "/", charactersSnapshot);
    database.write("items", "/", itemsSnapshot);
  }
});

test("trademgr stages items in the synthetic trade container and abort returns them to origin", { concurrency: false }, () => {
  const charactersSnapshot = cloneValue(database.read("characters", "/").data);
  const itemsSnapshot = cloneValue(database.read("items", "/").data);
  const harness = bootstrapTradeHarness();
  const tritanium = resolveItemByName("Tritanium");
  assert.equal(tritanium && tritanium.success, true, "Expected Tritanium metadata");

  try {
    const grantResult = grantItemToCharacterStationHangar(
      harness.leftSession.characterID,
      harness.sharedStationID,
      tritanium.match,
      250,
    );
    assert.equal(grantResult.success, true, "Expected test item grant to succeed");
    const itemID = Number(
      grantResult.data &&
      grantResult.data.items &&
      grantResult.data.items[0] &&
      grantResult.data.items[0].itemID || 0,
    ) || 0;
    assert.ok(itemID > 0, "Expected a granted Tritanium stack for direct trade");

    const trade = startTrade(harness);
    harness.service.Handle_Add(
      [itemID, harness.sharedStationID],
      harness.leftSession,
      null,
    );

    const stagedItem = findItemById(itemID);
    assert.ok(stagedItem, "Expected whole-stack offer to preserve the original row");
    assert.equal(
      Number(stagedItem.locationID || 0),
      trade.tradeContainerID,
      "Expected the offered item to move into the synthetic trade container",
    );

    const offerReset = harness.rightSession.notifications.find(
      (entry) => entry.name === "OnTradeOffer",
    );
    assert.ok(offerReset, "Expected item staging to reset the offer state");

    harness.service.Handle_Abort([], harness.rightSession);

    const restoredItem = findItemById(itemID);
    assert.ok(restoredItem, "Expected abort to restore the staged item");
    assert.equal(
      Number(restoredItem.locationID || 0),
      harness.sharedStationID,
      "Expected abort to return the item to the station hangar",
    );
    assert.equal(
      Number(restoredItem.flagID || 0),
      ITEM_FLAGS.HANGAR,
      "Expected abort to restore the item flag",
    );
  } finally {
    harness.cleanup();
    database.write("characters", "/", charactersSnapshot);
    database.write("items", "/", itemsSnapshot);
  }
});

test("trademgr auto-aborts an active trade when a participant disconnects", { concurrency: false }, () => {
  const charactersSnapshot = cloneValue(database.read("characters", "/").data);
  const itemsSnapshot = cloneValue(database.read("items", "/").data);
  const harness = bootstrapTradeHarness();
  const tritanium = resolveItemByName("Tritanium");
  assert.equal(tritanium && tritanium.success, true, "Expected Tritanium metadata");

  try {
    const grantResult = grantItemToCharacterStationHangar(
      harness.leftSession.characterID,
      harness.sharedStationID,
      tritanium.match,
      10,
    );
    assert.equal(grantResult.success, true, "Expected test item grant to succeed");
    const itemID = Number(
      grantResult.data &&
      grantResult.data.items &&
      grantResult.data.items[0] &&
      grantResult.data.items[0].itemID || 0,
    ) || 0;
    assert.ok(itemID > 0, "Expected a granted Tritanium stack for disconnect-abort");

    const trade = startTrade(harness);
    harness.service.Handle_Add(
      [itemID, harness.sharedStationID],
      harness.leftSession,
      null,
    );

    const stagedItem = findItemById(itemID);
    assert.ok(stagedItem, "Expected the trade item to stage before disconnect-abort");
    assert.equal(Number(stagedItem.locationID || 0), trade.tradeContainerID);

    const abortResult = abortTradesForSession(harness.leftSession);
    assert.equal(abortResult.success, true);
    assert.equal(abortResult.count, 1);

    const restoredItem = findItemById(itemID);
    assert.ok(restoredItem, "Expected disconnect-abort to restore the staged item");
    assert.equal(Number(restoredItem.locationID || 0), harness.sharedStationID);
    assert.equal(Number(restoredItem.flagID || 0), ITEM_FLAGS.HANGAR);
  } finally {
    harness.cleanup();
    database.write("characters", "/", charactersSnapshot);
    database.write("items", "/", itemsSnapshot);
  }
});

test("service manager can resolve both trademgr and tradeMgr to the same trade service", () => {
  const serviceManager = new ServiceManager();
  const service = new TradeMgrService();
  serviceManager.register(service);
  serviceManager.registerAlias("tradeMgr", "trademgr");

  assert.equal(serviceManager.lookup("trademgr"), service);
  assert.equal(serviceManager.lookup("tradeMgr"), service);
});

test("trademgr rejects manifest mismatches with OnTradeOfferReset(..., True)", { concurrency: false }, () => {
  const charactersSnapshot = cloneValue(database.read("characters", "/").data);
  const itemsSnapshot = cloneValue(database.read("items", "/").data);
  const harness = bootstrapTradeHarness();
  const tritanium = resolveItemByName("Tritanium");
  assert.equal(tritanium && tritanium.success, true, "Expected Tritanium metadata");

  try {
    const grantResult = grantItemToCharacterStationHangar(
      harness.leftSession.characterID,
      harness.sharedStationID,
      tritanium.match,
      25,
    );
    assert.equal(grantResult.success, true, "Expected test item grant to succeed");
    const itemID = Number(
      grantResult.data &&
      grantResult.data.items &&
      grantResult.data.items[0] &&
      grantResult.data.items[0].itemID || 0,
    ) || 0;
    assert.ok(itemID > 0, "Expected a granted Tritanium stack for manifest mismatch");

    const trade = startTrade(harness);
    harness.service.Handle_Add(
      [itemID, harness.sharedStationID],
      harness.leftSession,
      null,
    );

    harness.service.Handle_MakeOffer(
      [buildManifest(trade.tradeContainerID, [0, 999], [])],
      harness.leftSession,
    );

    const resetNotify = harness.leftSession.notifications.find(
      (entry) => entry.name === "OnTradeOfferReset",
    );
    assert.ok(resetNotify, "Expected manifest mismatch to trigger OnTradeOfferReset");
    assert.equal(
      Boolean(resetNotify.payload[1]),
      true,
      "Expected the manifest mismatch flag to be true",
    );
  } finally {
    harness.cleanup();
    database.write("characters", "/", charactersSnapshot);
    database.write("items", "/", itemsSnapshot);
  }
});

test("trademgr completes item and ISK transfer with PlayerTrading journal semantics", { concurrency: false }, () => {
  const charactersSnapshot = cloneValue(database.read("characters", "/").data);
  const itemsSnapshot = cloneValue(database.read("items", "/").data);
  const harness = bootstrapTradeHarness();
  const tritanium = resolveItemByName("Tritanium");
  assert.equal(tritanium && tritanium.success, true, "Expected Tritanium metadata");

  try {
    const grantResult = grantItemToCharacterStationHangar(
      harness.leftSession.characterID,
      harness.sharedStationID,
      tritanium.match,
      75,
    );
    assert.equal(grantResult.success, true, "Expected test item grant to succeed");
    const itemID = Number(
      grantResult.data &&
      grantResult.data.items &&
      grantResult.data.items[0] &&
      grantResult.data.items[0].itemID || 0,
    ) || 0;
    assert.ok(itemID > 0, "Expected a granted Tritanium stack for completion");

    const trade = startTrade(harness);
    const leftWalletBefore = getCharacterWallet(harness.leftSession.characterID);
    const rightWalletBefore = getCharacterWallet(harness.rightSession.characterID);

    harness.service.Handle_Add(
      [itemID, harness.sharedStationID],
      harness.leftSession,
      null,
    );
    harness.service.Handle_OfferMoney([123.45], harness.rightSession);

    const listResponse = keyValToObject(
      harness.service.Handle_List([], harness.leftSession),
    );
    const items = packedRowsToFields(listResponse.items);
    harness.service.Handle_MakeOffer(
      [buildManifest(trade.tradeContainerID, [0, 123.45], items)],
      harness.leftSession,
    );
    harness.service.Handle_MakeOffer(
      [buildManifest(trade.tradeContainerID, [0, 123.45], items)],
      harness.rightSession,
    );

    const transferredItem = findItemById(itemID);
    assert.ok(transferredItem, "Expected the traded item to still exist after completion");
    assert.equal(
      Number(transferredItem.ownerID || 0),
      harness.rightSession.characterID,
      "Expected the recipient to own the transferred item",
    );
    assert.equal(
      Number(transferredItem.locationID || 0),
      harness.sharedStationID,
      "Expected the transferred item to land in the recipient hangar location",
    );

    const leftWalletAfter = getCharacterWallet(harness.leftSession.characterID);
    const rightWalletAfter = getCharacterWallet(harness.rightSession.characterID);
    assert.equal(
      Math.round((leftWalletAfter.balance - leftWalletBefore.balance) * 100) / 100,
      123.45,
      "Expected the seller wallet to increase by the offered ISK",
    );
    assert.equal(
      Math.round((rightWalletAfter.balance - rightWalletBefore.balance) * 100) / 100,
      -123.45,
      "Expected the buyer wallet to decrease by the offered ISK",
    );

    const leftJournal = getCharacterWalletJournal(harness.leftSession.characterID);
    const rightJournal = getCharacterWalletJournal(harness.rightSession.characterID);
    assert.equal(
      Number(leftJournal[0] && leftJournal[0].entryTypeID || 0),
      JOURNAL_ENTRY_TYPE.PLAYER_TRADING,
      "Expected the seller journal to record PlayerTrading",
    );
    assert.equal(
      Number(rightJournal[0] && rightJournal[0].entryTypeID || 0),
      JOURNAL_ENTRY_TYPE.PLAYER_TRADING,
      "Expected the buyer journal to record PlayerTrading",
    );
  } finally {
    harness.cleanup();
    database.write("characters", "/", charactersSnapshot);
    database.write("items", "/", itemsSnapshot);
  }
});

test("trademgr accepts a client-style MakeOffer manifest with packedrow tradeItems", { concurrency: false }, () => {
  const charactersSnapshot = cloneValue(database.read("characters", "/").data);
  const itemsSnapshot = cloneValue(database.read("items", "/").data);
  const harness = bootstrapTradeHarness();
  const tritanium = resolveItemByName("Tritanium");
  assert.equal(tritanium && tritanium.success, true, "Expected Tritanium metadata");

  try {
    const grantResult = grantItemToCharacterStationHangar(
      harness.leftSession.characterID,
      harness.sharedStationID,
      tritanium.match,
      40,
    );
    assert.equal(grantResult.success, true, "Expected test item grant to succeed");
    const itemID = Number(
      grantResult.data &&
      grantResult.data.items &&
      grantResult.data.items[0] &&
      grantResult.data.items[0].itemID || 0,
    ) || 0;
    assert.ok(itemID > 0, "Expected a granted Tritanium stack for client-style manifest");

    const trade = startTrade(harness);
    harness.service.Handle_Add(
      [itemID, harness.sharedStationID],
      harness.leftSession,
      null,
    );

    const listResponse = keyValToObject(
      harness.service.Handle_List([], harness.leftSession),
    );
    const rawItems = listPayloadToArray(listResponse.items);
    const clientManifest = buildClientStyleManifest(
      trade.tradeContainerID,
      [0, 0],
      rawItems,
    );

    harness.service.Handle_MakeOffer(
      [clientManifest],
      harness.leftSession,
    );

    const resetNotify = harness.leftSession.notifications.find(
      (entry) => entry.name === "OnTradeOfferReset",
    );
    assert.equal(
      Boolean(resetNotify),
      false,
      "Expected the live client packedrow manifest to be accepted without reset",
    );

    const offerNotifies = harness.leftSession.notifications.filter(
      (entry) => entry.name === "OnTradeOffer",
    );
    const stateNotify = offerNotifies[offerNotifies.length - 1] || null;
    assert.ok(stateNotify, "Expected client-style manifest to advance offer state");
    assert.deepEqual(
      stateNotify.payload[1],
      [1, 0],
      "Expected the first participant to move into accepted state",
    );
  } finally {
    harness.cleanup();
    database.write("characters", "/", charactersSnapshot);
    database.write("items", "/", itemsSnapshot);
  }
});

test("trademgr accepts a client-style MakeOffer manifest with multiple packedrow tradeItems", { concurrency: false }, () => {
  const charactersSnapshot = cloneValue(database.read("characters", "/").data);
  const itemsSnapshot = cloneValue(database.read("items", "/").data);
  const harness = bootstrapTradeHarness();
  const plagioclase = resolveItemByName("Plagioclase");
  const tritanium = resolveItemByName("Tritanium");
  assert.equal(plagioclase && plagioclase.success, true, "Expected Plagioclase metadata");
  assert.equal(tritanium && tritanium.success, true, "Expected Tritanium metadata");

  try {
    const firstGrant = grantItemToCharacterStationHangar(
      harness.leftSession.characterID,
      harness.sharedStationID,
      plagioclase.match,
      20,
    );
    const secondGrant = grantItemToCharacterStationHangar(
      harness.leftSession.characterID,
      harness.sharedStationID,
      tritanium.match,
      12,
    );
    assert.equal(firstGrant.success, true, "Expected first test item grant to succeed");
    assert.equal(secondGrant.success, true, "Expected second test item grant to succeed");

    const firstItemID = Number(
      firstGrant.data &&
      firstGrant.data.items &&
      firstGrant.data.items[0] &&
      firstGrant.data.items[0].itemID || 0,
    ) || 0;
    const secondItemID = Number(
      secondGrant.data &&
      secondGrant.data.items &&
      secondGrant.data.items[0] &&
      secondGrant.data.items[0].itemID || 0,
    ) || 0;
    assert.ok(firstItemID > 0, "Expected a first granted item for multi-item manifest");
    assert.ok(secondItemID > 0, "Expected a second granted item for multi-item manifest");

    const trade = startTrade(harness);
    harness.service.Handle_Add(
      [firstItemID, harness.sharedStationID],
      harness.leftSession,
      null,
    );
    harness.service.Handle_Add(
      [secondItemID, harness.sharedStationID],
      harness.leftSession,
      null,
    );

    const listResponse = keyValToObject(
      harness.service.Handle_List([], harness.leftSession),
    );
    const rawItems = listPayloadToArray(listResponse.items);
    assert.ok(
      rawItems.length >= 2,
      "Expected a multi-item staged manifest in the client-style manifest test",
    );

    const clientManifest = buildClientStyleManifest(
      trade.tradeContainerID,
      [0, 0],
      rawItems,
    );

    harness.service.Handle_MakeOffer(
      [clientManifest],
      harness.leftSession,
    );

    const resetNotify = harness.leftSession.notifications.find(
      (entry) => entry.name === "OnTradeOfferReset",
    );
    assert.equal(
      Boolean(resetNotify),
      false,
      "Expected multi-item packedrow manifest to be accepted without reset",
    );

    const offerNotifies = harness.leftSession.notifications.filter(
      (entry) => entry.name === "OnTradeOffer",
    );
    const stateNotify = offerNotifies[offerNotifies.length - 1] || null;
    assert.ok(stateNotify, "Expected multi-item client-style manifest to advance offer state");
    assert.deepEqual(
      stateNotify.payload[1],
      [1, 0],
      "Expected the first participant to move into accepted state for a multi-item manifest",
    );
  } finally {
    harness.cleanup();
    database.write("characters", "/", charactersSnapshot);
    database.write("items", "/", itemsSnapshot);
  }
});

test("trademgr transfers ship contents to the recipient together with the traded hull", { concurrency: false }, () => {
  const charactersSnapshot = cloneValue(database.read("characters", "/").data);
  const itemsSnapshot = cloneValue(database.read("items", "/").data);
  const harness = bootstrapTradeHarness();
  const tritanium = resolveItemByName("Tritanium");
  assert.equal(tritanium && tritanium.success, true, "Expected Tritanium metadata");
  const storedShipSeed = getActiveShipRecord(harness.leftSession.characterID);
  assert.ok(storedShipSeed, "Expected an active ship seed to clone for ship trade");

  try {
    const shipType = resolveItemByTypeID(storedShipSeed.typeID);
    assert.ok(shipType, "Expected ship metadata for trade test");
    const shipGrant = grantItemToCharacterLocation(
      harness.leftSession.characterID,
      harness.sharedStationID,
      ITEM_FLAGS.HANGAR,
      shipType,
      1,
    );
    assert.equal(shipGrant.success, true, "Expected a ship grant to succeed");
    const shipItemID = Number(
      shipGrant.data &&
      shipGrant.data.items &&
      shipGrant.data.items[0] &&
      shipGrant.data.items[0].itemID || 0,
    ) || 0;
    assert.ok(shipItemID > 0, "Expected a granted ship item for trade");

    const cargoGrant = grantItemToCharacterLocation(
      harness.leftSession.characterID,
      shipItemID,
      ITEM_FLAGS.CARGO_HOLD,
      tritanium.match,
      10,
    );
    assert.equal(cargoGrant.success, true, "Expected cargo grant to succeed");
    const cargoItemID = Number(
      cargoGrant.data &&
      cargoGrant.data.items &&
      cargoGrant.data.items[0] &&
      cargoGrant.data.items[0].itemID || 0,
    ) || 0;
    assert.ok(cargoItemID > 0, "Expected cargo inside the traded ship");

    const trade = startTrade(harness);
    harness.service.Handle_Add(
      [shipItemID, harness.sharedStationID],
      harness.leftSession,
      null,
    );

    const leftPrimeNotify = harness.leftSession.notifications
      .filter((entry) => entry.name === "OnPrimingNeededForTradeItems")
      .at(-1);
    const rightPrimeNotify = harness.rightSession.notifications
      .filter((entry) => entry.name === "OnPrimingNeededForTradeItems")
      .at(-1);
    assert.ok(leftPrimeNotify, "Expected trade staging to request evelocations priming for the initiator");
    assert.ok(rightPrimeNotify, "Expected trade staging to request evelocations priming for the target");
    assert.ok(
      Array.isArray(leftPrimeNotify.payload[0]) &&
      leftPrimeNotify.payload[0].includes(shipItemID) &&
      leftPrimeNotify.payload[0].includes(cargoItemID),
      "Expected priming to include the staged ship and its contained cargo",
    );
    assert.deepEqual(
      rightPrimeNotify.payload[0],
      leftPrimeNotify.payload[0],
      "Expected both trade participants to receive the same priming payload",
    );

    const listResponse = keyValToObject(
      harness.service.Handle_List([], harness.leftSession),
    );
    const items = packedRowsToFields(listResponse.items);
    harness.service.Handle_MakeOffer(
      [buildManifest(trade.tradeContainerID, [0, 0], items)],
      harness.leftSession,
    );
    harness.service.Handle_MakeOffer(
      [buildManifest(trade.tradeContainerID, [0, 0], items)],
      harness.rightSession,
    );

    const tradedShip = findItemById(shipItemID);
    const tradedCargo = findItemById(cargoItemID);
    assert.equal(
      Number(tradedShip && tradedShip.ownerID || 0),
      harness.rightSession.characterID,
      "Expected the traded ship to move to the recipient",
    );
    assert.equal(
      Number(tradedCargo && tradedCargo.ownerID || 0),
      harness.rightSession.characterID,
      "Expected ship contents to follow the traded hull owner change",
    );
    assert.equal(
      Number(tradedCargo && tradedCargo.locationID || 0),
      shipItemID,
      "Expected contained items to stay inside the transferred ship",
    );
  } finally {
    harness.cleanup();
    database.write("characters", "/", charactersSnapshot);
    database.write("items", "/", itemsSnapshot);
  }
});

test("trademgr enforces CCP typelist-backed ItemCannotBeTraded rules", { concurrency: false }, () => {
  const charactersSnapshot = cloneValue(database.read("characters", "/").data);
  const itemsSnapshot = cloneValue(database.read("items", "/").data);
  const harness = bootstrapTradeHarness();
  const blockedType = resolveItemByTypeID(60033);
  assert.ok(blockedType, "Expected AIR Skill Injector metadata");

  try {
    const grantResult = grantItemToCharacterStationHangar(
      harness.leftSession.characterID,
      harness.sharedStationID,
      blockedType,
      1,
    );
    assert.equal(grantResult.success, true, "Expected blocked test item grant to succeed");
    const itemID = Number(
      grantResult.data &&
      grantResult.data.items &&
      grantResult.data.items[0] &&
      grantResult.data.items[0].itemID || 0,
    ) || 0;
    assert.ok(itemID > 0, "Expected a granted blocked item");

    startTrade(harness);
    const thrown = captureThrownError(() => {
      harness.service.Handle_Add(
        [itemID, harness.sharedStationID],
        harness.leftSession,
        null,
      );
    });
    assert.equal(getUserErrorMessage(thrown), "ItemCannotBeTraded");
    assert.deepEqual(getUserErrorDictionary(thrown).type_ids, [blockedType.typeID]);

    const preservedItem = findItemById(itemID);
    assert.equal(
      Number(preservedItem && preservedItem.locationID || 0),
      harness.sharedStationID,
      "Expected blocked items to remain in the source hangar",
    );
  } finally {
    harness.cleanup();
    database.write("characters", "/", charactersSnapshot);
    database.write("items", "/", itemsSnapshot);
  }
});

test("trademgr honors typelist exclusions so excluded category matches remain tradable", { concurrency: false }, () => {
  const charactersSnapshot = cloneValue(database.read("characters", "/").data);
  const itemsSnapshot = cloneValue(database.read("items", "/").data);
  const harness = bootstrapTradeHarness();
  const excludedType = resolveItemByTypeID(81348);
  assert.ok(excludedType, "Expected Alignment Sequencer metadata");

  try {
    const grantResult = grantItemToCharacterStationHangar(
      harness.leftSession.characterID,
      harness.sharedStationID,
      excludedType,
      1,
    );
    assert.equal(grantResult.success, true, "Expected excluded test item grant to succeed");
    const itemID = Number(
      grantResult.data &&
      grantResult.data.items &&
      grantResult.data.items[0] &&
      grantResult.data.items[0].itemID || 0,
    ) || 0;
    assert.ok(itemID > 0, "Expected a granted excluded item");

    const trade = startTrade(harness);
    harness.service.Handle_Add(
      [itemID, harness.sharedStationID],
      harness.leftSession,
      null,
    );

    const stagedItem = findItemById(itemID);
    assert.equal(
      Number(stagedItem && stagedItem.locationID || 0),
      trade.tradeContainerID,
      "Expected excluded typelist matches to remain tradable",
    );
  } finally {
    harness.cleanup();
    database.write("characters", "/", charactersSnapshot);
    database.write("items", "/", itemsSnapshot);
  }
});
