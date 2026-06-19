const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const sourceDataDir = path.join(
  repoRoot,
  "server/src/newDatabase/data",
);
const testDataDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "evejs-hypernet-db-"),
);
fs.cpSync(sourceDataDir, testDataDir, { recursive: true });
process.env.EVEJS_NEWDB_DATA_DIR = testDataDir;

const database = require(path.join(
  repoRoot,
  "server/src/newDatabase",
));
const {
  buildGlobalConfigDict,
  normalizeCountryCode,
} = require(path.join(
  repoRoot,
  "server/src/services/machoNet/globalConfig",
));
const {
  isMachoWrappedException,
} = require(path.join(
  repoRoot,
  "server/src/common/machoErrors",
));
const MachoNetService = require(path.join(
  repoRoot,
  "server/src/services/machoNet/machoNetService",
));
const RaffleProxyService = require(path.join(
  repoRoot,
  "server/src/services/raffles/raffleProxyService",
));
const RaffleMgrService = require(path.join(
  repoRoot,
  "server/src/services/raffles/raffleMgrService",
));
const {
  getRaffleRuntime,
  resetRaffleRuntime,
} = require(path.join(
  repoRoot,
  "server/src/services/raffles/raffleRuntimeSingleton",
));
const {
  TOKEN_TYPE_ID,
  RAFFLE_ESCROW_FLAG,
  RAFFLE_STATUS,
} = require(path.join(
  repoRoot,
  "server/src/services/raffles/raffleConstants",
));
const {
  ITEM_FLAGS,
  resolveStationSolarSystemId,
} = require(path.join(
  repoRoot,
  "server/src/services/raffles/raffleInventory",
));
const {
  findItemById,
  listCharacterItems,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  getCharacterWallet,
  setCharacterBalance,
} = require(path.join(
  repoRoot,
  "server/src/services/account/walletState",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));

const TEST_STATION_ID = 60003760;
const GM_ELYSIAN_ID = 140000004;
const BUYER_ID = 140000001;
const WATCHER_ID = 140000002;

function snapshotTable(tableName) {
  const result = database.read(tableName, "/");
  if (!result.success) {
    return {};
  }
  return JSON.parse(JSON.stringify(result.data || {}));
}

const originalTableSnapshots = {
  characters: snapshotTable("characters"),
  items: snapshotTable("items"),
  raffles: snapshotTable("raffles"),
  rafflesRuntime: snapshotTable("rafflesRuntime"),
};

test.after(() => {
  for (const [tableName, snapshot] of Object.entries(originalTableSnapshots)) {
    database.write(tableName, "/", JSON.parse(JSON.stringify(snapshot)));
  }
  database.flushAllSync();
  resetRaffleRuntime();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

function readKeyValEntries(value) {
  if (value && value.type === "dict" && Array.isArray(value.entries)) {
    return new Map(value.entries);
  }

  return new Map(
    value && value.args && Array.isArray(value.args.entries)
      ? value.args.entries
      : [],
  );
}

function raffleIdList(listValue) {
  return (listValue && Array.isArray(listValue.items) ? listValue.items : []).map(
    (item) => readKeyValEntries(item).get("raffle_id"),
  );
}

function createSession(characterID, clientID, stationID = TEST_STATION_ID) {
  const notifications = [];
  return {
    characterID,
    clientID,
    stationID,
    stationid: stationID,
    socket: { destroyed: false },
    notifications,
    sendNotification(notifyType, idType, payloadTuple) {
      notifications.push({ notifyType, idType, payloadTuple });
    },
  };
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildCreationPayload({
  ownerId,
  locationId,
  solarSystemId,
  tokenId,
  tokenLocationId,
  itemId,
  typeId,
  ticketCount = 8,
  ticketPrice = 1000,
  restrictionId = null,
}) {
  return {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: [
        ["owner_id", ownerId],
        ["location_id", locationId],
        ["solar_system_id", solarSystemId],
        ["token_id", tokenId],
        ["token_location_id", tokenLocationId],
        ["item_id", itemId],
        ["type_id", typeId],
        ["ticket_count", ticketCount],
        ["ticket_price", ticketPrice],
        ["restriction_id", restrictionId],
      ],
    },
  };
}

function buildTokenizedCreationPayload({
  ownerId,
  locationId,
  solarSystemId,
  tokenId,
  tokenLocationId,
  itemId,
  typeId,
  ticketCount = 8,
  ticketPrice = 1000,
  restrictionId = null,
}, options = {}) {
  const entries = [
    [{ type: "token", value: "owner_id" }, { type: "long", value: String(ownerId) }],
    [{ type: "token", value: "location_id" }, locationId],
    [{ type: "token", value: "solar_system_id" }, solarSystemId],
    [{ type: "token", value: "token_id" }, { type: "long", value: String(tokenId) }],
    [{ type: "token", value: "token_location_id" }, tokenLocationId],
    [{ type: "token", value: "item_id" }, { type: "long", value: String(itemId) }],
    [{ type: "token", value: "type_id" }, typeId],
    [{ type: "token", value: "ticket_count" }, ticketCount],
    [{ type: "token", value: "ticket_price" }, ticketPrice],
    [{ type: "token", value: "restriction_id" }, restrictionId],
  ];

  if (options.objectEx) {
    return {
      type: "objectex1",
      header: [
        { type: "token", value: "util.KeyVal" },
        [],
        { type: "dict", entries },
      ],
      list: [],
      dict: [],
    };
  }

  return {
    type: "object",
    name: { type: "token", value: "util.KeyVal" },
    args: {
      type: "dict",
      entries,
    },
  };
}

function buildLiveObjectExCreationPayload({
  ownerId,
  locationId,
  solarSystemId,
  tokenId,
  tokenLocationId,
  itemId,
  typeId,
  ticketCount = 8,
  ticketPrice = 1000,
  restrictionId = null,
  includeTokenId = true,
}) {
  const payload = {
    solar_system_id: solarSystemId,
    type_id: typeId,
    restriction_id: restrictionId,
    owner_location_id: null,
    token_location_id: tokenLocationId,
    ticket_count: ticketCount,
    item_id: itemId,
    location_id: locationId,
    ticket_price: ticketPrice,
    owner_id: ownerId,
  };

  if (includeTokenId) {
    payload.token_id = tokenId;
  }

  return {
    type: "objectex2",
    header: [
      [{ type: "token", value: "raffles.common.raffle_data.RaffleCreationData" }],
      payload,
    ],
    list: [],
    dict: [],
  };
}

function getHangarShips(characterID, stationID = TEST_STATION_ID) {
  return listCharacterItems(characterID, {
    locationID: stationID,
    flagID: ITEM_FLAGS.HANGAR,
    categoryID: 6,
  });
}

function getLargestTokenStack(characterID, stationID = TEST_STATION_ID) {
  return listCharacterItems(characterID, {
    locationID: stationID,
    flagID: ITEM_FLAGS.HANGAR,
    typeID: TOKEN_TYPE_ID,
  }).sort((left, right) => right.stacksize - left.stacksize)[0] || null;
}

function hasNotification(session, notifyType) {
  return session.notifications.some(
    (notification) => notification.notifyType === notifyType,
  );
}

function getNotification(session, notifyType) {
  return session.notifications.find(
    (notification) => notification.notifyType === notifyType,
  );
}

function restartPersistentRaffleRuntime() {
  const runtime = getRaffleRuntime();
  runtime.reset({ clearPersistence: false });
  return new RaffleProxyService();
}

function calculateExpectedSellerPayout(totalPrice) {
  return totalPrice - (totalPrice * 0.05);
}

function nextAsyncTurn() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function createRaffleForCharacter(service, session, options = {}) {
  service.Handle_SubscribeToTickets([], session);

  const stationID = Number(session.stationID || session.stationid || TEST_STATION_ID);
  const hangarItems = listCharacterItems(session.characterID, {
    locationID: stationID,
    flagID: ITEM_FLAGS.HANGAR,
  });
  const item = options.itemId
    ? hangarItems.find((candidate) => candidate.itemID === options.itemId) ||
      findItemById(options.itemId)
    : getHangarShips(session.characterID, stationID)[0];
  const token = getLargestTokenStack(session.characterID, stationID);

  assert.ok(item, "expected a HyperNet item in the creator hangar");
  assert.ok(token, "expected a HyperNet token stack in the creator hangar");

  const creationData = buildCreationPayload({
    ownerId: session.characterID,
    locationId: item.locationID,
    solarSystemId: resolveStationSolarSystemId(item.locationID, 0),
    tokenId: token.itemID,
    tokenLocationId: token.locationID,
    itemId: item.itemID,
    typeId: item.typeID,
    ticketCount: options.ticketCount || 8,
    ticketPrice: options.ticketPrice || 1000,
    restrictionId: options.isPrivate ? 1 : null,
  });

  const raffleId = service.Handle_CreateRaffle([creationData], session);
  await nextAsyncTurn();

  return {
    raffleId,
    item,
    tokenBefore: token,
  };
}

test(
  "normalizeCountryCode prefers valid ISO codes and falls back to GB",
  { concurrency: false },
  () => {
    assert.equal(normalizeCountryCode("de"), "DE");
    assert.equal(normalizeCountryCode(""), "GB");
    assert.equal(normalizeCountryCode("KR"), "GB");
    assert.equal(normalizeCountryCode("EU"), "EU");
  },
);

test(
  "machoNet init values include HyperNet services and global config",
  { concurrency: false },
  () => {
    const service = new MachoNetService();
    const [serviceInfo, globalConfig] = service.Handle_GetInitVals([], null);

    assert.equal(
      serviceInfo.entries.some(([serviceName]) => serviceName === "raffleProxy"),
      true,
    );
    assert.equal(
      serviceInfo.entries.some(([serviceName]) => serviceName === "raffleMgr"),
      true,
    );
    assert.equal(
      globalConfig.entries.some(
        ([key, value]) => key === "HyperNetKillSwitch" && value === 0,
      ),
      true,
    );
    assert.equal(
      globalConfig.entries.some(
        ([key, value]) => key === "HyperNetPlexPriceOverride" && value === 3500000,
      ),
      true,
    );
  },
);

test(
  "raffleProxy seeds a random GM ELYSIAN startup mix and honors browse filters",
  { concurrency: false },
  () => {
    resetRaffleRuntime();
    const service = new RaffleProxyService();
    const session = createSession(BUYER_ID, 9001);

    const browse = service.Handle_Grab([], session);
    const tokenStack = getLargestTokenStack(BUYER_ID, TEST_STATION_ID);

    assert.equal(service.Handle_AmIBanned(), false);
    assert.equal(browse.type, "list");
    assert.equal(browse.items.length >= 4 && browse.items.length <= 10, true);
    assert.ok(tokenStack);
    assert.equal(hasNotification(session, "OnItemChange"), true);

    const raffles = browse.items.map(readKeyValEntries);
    assert.equal(
      raffles.every((raffle) => raffle.get("owner_id") === GM_ELYSIAN_ID),
      true,
    );
    assert.equal(
      raffles.every((raffle) => raffle.get("raffle_status") === RAFFLE_STATUS.RUNNING),
      true,
    );
    assert.equal(
      raffles.every((raffle) => [8, 16].includes(raffle.get("ticket_count"))),
      true,
    );
    assert.equal(
      raffles.every((raffle) => raffle.get("sold_ticket_count") === 0),
      true,
    );

    const firstTypeId = raffles[0].get("type_id");
    const filtered = service.Handle_FilteredGrab([], session, {
      type: "dict",
      entries: [
        ["filters", { type: "dict", entries: [["type_id", firstTypeId]] }],
        ["constraints", { type: "dict", entries: [] }],
        ["size", 10],
      ],
    });
    assert.ok(filtered.items.length >= 1);
    assert.equal(
      filtered.items.every(
        (item) => readKeyValEntries(item).get("type_id") === firstTypeId,
      ),
      true,
    );

    const filteredOut = service.Handle_FilteredGrab([], session, {
      type: "dict",
      entries: [
        ["filters", { type: "dict", entries: [["type_id", -1]] }],
        ["constraints", { type: "dict", entries: [] }],
      ],
    });
    assert.deepEqual(filteredOut, { type: "list", items: [] });
  },
);

test(
  "creating a raffle escrows the item, consumes a token, and emits OnRaffleCreatedServer",
  { concurrency: false },
  async () => {
    const runtime = resetRaffleRuntime();
    const service = new RaffleProxyService();
    const creatorSession = createSession(BUYER_ID, 9002);
    let createdRaffleId = null;

    sessionRegistry.register(creatorSession);

    try {
      const { raffleId, item, tokenBefore } = await createRaffleForCharacter(
        service,
        creatorSession,
      );
      createdRaffleId = raffleId;

      const creationNotification = getNotification(
        creatorSession,
        "OnRaffleCreatedServer",
      );
      assert.ok(creationNotification);
      assert.equal(creationNotification.payloadTuple[0], raffleId);

      const itemAfter = findItemById(item.itemID);
      const tokenAfter = findItemById(tokenBefore.itemID);
      const createdRaffle = readKeyValEntries(
        service.Handle_GetRaffle([raffleId], creatorSession),
      );
      const typeStats = readKeyValEntries(
        service.Handle_GetActiveHistoricPrices([item.typeID]),
      );

      assert.equal(itemAfter.flagID, RAFFLE_ESCROW_FLAG);
      assert.equal(tokenAfter.stacksize, tokenBefore.stacksize - 1);
      assert.equal(createdRaffle.get("owner_id"), BUYER_ID);
      assert.equal(createdRaffle.get("raffle_status"), RAFFLE_STATUS.RUNNING);
      assert.equal(typeStats.get("active_count") >= 1, true);
    } finally {
      if (createdRaffleId) {
        runtime._expireRaffle(createdRaffleId);
      }
      sessionRegistry.unregister(creatorSession);
    }
  },
);

test(
  "client-style non-ship listings can be created in memory",
  { concurrency: false },
  async () => {
    const runtime = resetRaffleRuntime();
    const service = new RaffleProxyService();
    const creatorSession = createSession(140000003, 9010);
    let createdRaffleId = null;
    const nonShipItem = listCharacterItems(140000003, {
      locationID: TEST_STATION_ID,
      flagID: ITEM_FLAGS.HANGAR,
    }).find((candidate) => candidate.categoryID !== 6 && candidate.typeID !== TOKEN_TYPE_ID);

    sessionRegistry.register(creatorSession);

    try {
      assert.ok(nonShipItem, "expected a non-ship item in the creator hangar");
      const { raffleId, item } = await createRaffleForCharacter(
        service,
        creatorSession,
        { itemId: nonShipItem.itemID },
      );
      createdRaffleId = raffleId;

      const createdRaffle = readKeyValEntries(
        service.Handle_GetRaffle([raffleId], creatorSession),
      );

      assert.equal(createdRaffle.get("owner_id"), 140000003);
      assert.equal(createdRaffle.get("type_id"), item.typeID);
      assert.equal(createdRaffle.get("raffle_status"), RAFFLE_STATUS.RUNNING);
    } finally {
      if (createdRaffleId) {
        runtime._expireRaffle(createdRaffleId);
      }
      sessionRegistry.unregister(creatorSession);
    }
  },
);

test(
  "live marshal-shaped HyperNet create payloads succeed",
  { concurrency: false },
  async () => {
    const runtime = resetRaffleRuntime();
    const service = new RaffleProxyService();
    const creatorSession = createSession(140000003, 9011);
    let createdRaffleId = null;

    sessionRegistry.register(creatorSession);

    try {
      service.Handle_SubscribeToTickets([], creatorSession);

      const stationID = Number(
        creatorSession.stationID || creatorSession.stationid || TEST_STATION_ID,
      );
      const hangarItems = listCharacterItems(140000003, {
        locationID: stationID,
        flagID: ITEM_FLAGS.HANGAR,
      });
      const nonTokenItems = hangarItems.filter(
        (candidate) => candidate.typeID !== TOKEN_TYPE_ID,
      );
      const primaryItem = nonTokenItems[0];
      const secondaryItem = nonTokenItems.find(
        (candidate) => candidate.itemID !== (primaryItem && primaryItem.itemID),
      );
      const token = getLargestTokenStack(140000003, stationID);

      assert.ok(primaryItem, "expected a non-token listing item in the creator hangar");
      assert.ok(secondaryItem, "expected a second non-token hangar item for objectex coverage");
      assert.ok(token, "expected a HyperNet token stack in the creator hangar");

      for (const payload of [
        buildTokenizedCreationPayload({
          ownerId: creatorSession.characterID,
          locationId: primaryItem.locationID,
          solarSystemId: resolveStationSolarSystemId(primaryItem.locationID, 0),
          tokenId: token.itemID,
          tokenLocationId: token.locationID,
          itemId: primaryItem.itemID,
          typeId: primaryItem.typeID,
          ticketCount: 8,
          ticketPrice: 125,
        }),
        buildLiveObjectExCreationPayload({
          ownerId: creatorSession.characterID,
          locationId: secondaryItem.locationID,
          solarSystemId: resolveStationSolarSystemId(secondaryItem.locationID, 0),
          tokenId: getLargestTokenStack(140000003, stationID).itemID,
          tokenLocationId: secondaryItem.locationID,
          itemId: secondaryItem.itemID,
          typeId: secondaryItem.typeID,
          ticketCount: 8,
          ticketPrice: 125,
        }),
      ]) {
        const raffleId = service.Handle_CreateRaffle([payload], creatorSession);
        createdRaffleId = raffleId;
        const createdRaffle = readKeyValEntries(
          service.Handle_GetRaffle([raffleId], creatorSession),
        );

        assert.equal(createdRaffle.get("owner_id"), 140000003);
        assert.equal(createdRaffle.get("raffle_status"), RAFFLE_STATUS.RUNNING);

        runtime._expireRaffle(raffleId);
        createdRaffleId = null;
      }
    } finally {
      if (createdRaffleId) {
        runtime._expireRaffle(createdRaffleId);
      }
      sessionRegistry.unregister(creatorSession);
    }
  },
);

test(
  "create falls back when a live payload item_id points at HyperCores and token_id is omitted",
  { concurrency: false },
  async () => {
    const runtime = resetRaffleRuntime();
    const service = new RaffleProxyService();
    const creatorSession = createSession(140000003, 9016);
    let createdRaffleId = null;

    sessionRegistry.register(creatorSession);

    try {
      service.Handle_SubscribeToTickets([], creatorSession);

      const stationID = Number(
        creatorSession.stationID || creatorSession.stationid || TEST_STATION_ID,
      );
      const shipItem = listCharacterItems(140000003, {
        locationID: stationID,
        flagID: ITEM_FLAGS.HANGAR,
        categoryID: 6,
      }).find((candidate) => candidate.typeID !== TOKEN_TYPE_ID);
      const token = getLargestTokenStack(140000003, stationID);

      assert.ok(shipItem, "expected a ship item in the creator hangar");
      assert.ok(token, "expected a HyperNet token stack in the creator hangar");

      createdRaffleId = service.Handle_CreateRaffle([
        buildLiveObjectExCreationPayload({
          ownerId: creatorSession.characterID,
          locationId: shipItem.locationID,
          solarSystemId: null,
          tokenId: 0,
          tokenLocationId: shipItem.locationID,
          itemId: token.itemID,
          typeId: shipItem.typeID,
          ticketCount: 8,
          ticketPrice: 125,
          includeTokenId: false,
        }),
      ], creatorSession);

      const createdRaffle = readKeyValEntries(
        service.Handle_GetRaffle([createdRaffleId], creatorSession),
      );

      assert.equal(createdRaffle.get("owner_id"), 140000003);
      assert.equal(createdRaffle.get("type_id"), shipItem.typeID);
      assert.equal(createdRaffle.get("raffle_status"), RAFFLE_STATUS.RUNNING);
    } finally {
      if (createdRaffleId) {
        runtime._expireRaffle(createdRaffleId);
      }
      sessionRegistry.unregister(creatorSession);
    }
  },
);

test(
  "create token shortage marshals as raffles.CreateError(TokenAmountError)",
  { concurrency: false },
  () => {
    resetRaffleRuntime();
    const service = new RaffleProxyService();
    const creatorSession = createSession(140000003, 9017);

    service.Handle_SubscribeToTickets([], creatorSession);

    const stationID = Number(
      creatorSession.stationID || creatorSession.stationid || TEST_STATION_ID,
    );
    const item = listCharacterItems(140000003, {
      locationID: stationID,
      flagID: ITEM_FLAGS.HANGAR,
      categoryID: 6,
    })[0];
    const token = getLargestTokenStack(140000003, stationID);

    assert.ok(item, "expected a ship item in the creator hangar");
    assert.ok(token, "expected a HyperNet token stack in the creator hangar");

    assert.throws(
      () => service.Handle_CreateRaffle([
        buildCreationPayload({
          ownerId: creatorSession.characterID,
          locationId: item.locationID,
          solarSystemId: resolveStationSolarSystemId(item.locationID, 0),
          tokenId: token.itemID,
          tokenLocationId: token.locationID,
          itemId: item.itemID,
          typeId: item.typeID,
          ticketCount: 8,
          ticketPrice: 758345000,
        }),
      ], creatorSession),
      (error) => {
        assert.ok(isMachoWrappedException(error));
        assert.equal(
          error.machoErrorResponse.payload.header[0].value,
          "raffles.CreateError",
        );
        assert.equal(
          error.machoErrorResponse.payload.header[1][0],
          "TokenAmountError",
        );
        return true;
      },
    );
  },
);

test(
  "create validation trusts session and item ownership over client owner_id",
  { concurrency: false },
  async () => {
    const runtime = resetRaffleRuntime();
    const service = new RaffleProxyService();
    const creatorSession = createSession(140000003, 9012);
    let createdRaffleId = null;

    sessionRegistry.register(creatorSession);

    try {
      service.Handle_SubscribeToTickets([], creatorSession);

      const stationID = Number(
        creatorSession.stationID || creatorSession.stationid || TEST_STATION_ID,
      );
      const item = listCharacterItems(140000003, {
        locationID: stationID,
        flagID: ITEM_FLAGS.HANGAR,
      }).find((candidate) => candidate.categoryID === 6);
      const token = getLargestTokenStack(140000003, stationID);

      assert.ok(item, "expected a ship item in the creator hangar");
      assert.ok(token, "expected a HyperNet token stack in the creator hangar");

      createdRaffleId = service.Handle_CreateRaffle([
        buildTokenizedCreationPayload({
          ownerId: 0,
          locationId: item.locationID,
          solarSystemId: resolveStationSolarSystemId(item.locationID, 0),
          tokenId: token.itemID,
          tokenLocationId: token.locationID,
          itemId: item.itemID,
          typeId: item.typeID,
          ticketCount: 8,
          ticketPrice: 125,
        }),
      ], creatorSession);

      const createdRaffle = readKeyValEntries(
        service.Handle_GetRaffle([createdRaffleId], creatorSession),
      );

      assert.equal(createdRaffle.get("owner_id"), 140000003);
      assert.equal(createdRaffle.get("raffle_status"), RAFFLE_STATUS.RUNNING);
    } finally {
      if (createdRaffleId) {
        runtime._expireRaffle(createdRaffleId);
      }
      sessionRegistry.unregister(creatorSession);
    }
  },
);

test(
  "buying without enough isk marshals as raffles.NotEnoughISKError",
  { concurrency: false },
  async () => {
    const runtime = resetRaffleRuntime();
    const service = new RaffleProxyService();
    const sellerSession = createSession(BUYER_ID, 9018);
    const buyerSession = createSession(WATCHER_ID, 9019);
    const previousWallet = getCharacterWallet(WATCHER_ID);
    let createdRaffleId = null;

    try {
      const { raffleId } = await createRaffleForCharacter(service, sellerSession, {
        ticketPrice: 500000,
      });
      createdRaffleId = raffleId;
      setCharacterBalance(WATCHER_ID, 0);

      assert.throws(
        () => service.Handle_BuyRandomTickets([raffleId, 1], buyerSession),
        (error) => {
          assert.ok(isMachoWrappedException(error));
          assert.equal(
            error.machoErrorResponse.payload.header[0].value,
            "raffles.NotEnoughISKError",
          );
          return true;
        },
      );
    } finally {
      if (previousWallet) {
        setCharacterBalance(WATCHER_ID, previousWallet.balance);
      }
      if (createdRaffleId) {
        runtime._expireRaffle(createdRaffleId);
      }
    }
  },
);

test(
  "create falls back to a unique hangar item and token stack when client ids are stale",
  { concurrency: false },
  async () => {
    const runtime = resetRaffleRuntime();
    const service = new RaffleProxyService();
    const creatorSession = createSession(140000003, 9013);
    let createdRaffleId = null;

    sessionRegistry.register(creatorSession);

    try {
      service.Handle_SubscribeToTickets([], creatorSession);

      const stationID = Number(
        creatorSession.stationID || creatorSession.stationid || TEST_STATION_ID,
      );
      const hangarItems = listCharacterItems(140000003, {
        locationID: stationID,
        flagID: ITEM_FLAGS.HANGAR,
      });
      const uniqueItem = hangarItems.find((candidate) => (
        candidate.typeID !== TOKEN_TYPE_ID &&
        hangarItems.filter((entry) => entry.typeID === candidate.typeID).length === 1
      ));

      assert.ok(uniqueItem, "expected a unique non-token hangar item");

      createdRaffleId = service.Handle_CreateRaffle([
        buildTokenizedCreationPayload({
          ownerId: creatorSession.characterID,
          locationId: uniqueItem.locationID,
          solarSystemId: resolveStationSolarSystemId(uniqueItem.locationID, 0),
          tokenId: 999999991,
          tokenLocationId: uniqueItem.locationID,
          itemId: 999999990,
          typeId: uniqueItem.typeID,
          ticketCount: 8,
          ticketPrice: 125,
        }),
      ], creatorSession);

      const createdRaffle = readKeyValEntries(
        service.Handle_GetRaffle([createdRaffleId], creatorSession),
      );

      assert.equal(createdRaffle.get("owner_id"), 140000003);
      assert.equal(createdRaffle.get("type_id"), uniqueItem.typeID);
      assert.equal(createdRaffle.get("raffle_status"), RAFFLE_STATUS.RUNNING);
    } finally {
      if (createdRaffleId) {
        runtime._expireRaffle(createdRaffleId);
      }
      sessionRegistry.unregister(creatorSession);
    }
  },
);

test(
  "private raffles are visible to the owner but hidden from uninvolved browse results",
  { concurrency: false },
  async () => {
    const runtime = resetRaffleRuntime();
    const service = new RaffleProxyService();
    const ownerSession = createSession(BUYER_ID, 9003);
    const strangerSession = createSession(WATCHER_ID, 9004);
    let createdRaffleId = null;

    try {
      const { raffleId } = await createRaffleForCharacter(service, ownerSession, {
        isPrivate: true,
      });
      createdRaffleId = raffleId;

      const ownerBrowseIds = raffleIdList(service.Handle_Grab([], ownerSession));
      const strangerBrowseIds = raffleIdList(
        service.Handle_Grab([], strangerSession),
      );

      assert.equal(ownerBrowseIds.includes(raffleId), true);
      assert.equal(strangerBrowseIds.includes(raffleId), false);
    } finally {
      if (createdRaffleId) {
        runtime._expireRaffle(createdRaffleId);
      }
    }
  },
);

test(
  "selling out a raffle chooses a winner, updates wallets, and claim marks it delivered",
  { concurrency: false },
  () => {
    resetRaffleRuntime();
    const service = new RaffleProxyService();
    const buyerSession = createSession(BUYER_ID, 9005);
    const watcherSession = createSession(WATCHER_ID, 9006);
    let buyerWalletBefore = null;
    let sellerWalletBefore = null;
    let sellerId = null;

    sessionRegistry.register(buyerSession);
    sessionRegistry.register(watcherSession);

    try {
      service.Handle_SubscribeToTickets([], buyerSession);
      service.Handle_SubscribeToTickets([], watcherSession);

      const browse = service.Handle_Grab([], buyerSession);
      const seededRaffle = readKeyValEntries(browse.items[0]);
      const raffleId = seededRaffle.get("raffle_id");
      const itemId = seededRaffle.get("item_id");
      const offerStationId = seededRaffle.get("location_id");
      sellerId = seededRaffle.get("owner_id");
      const ticketCount = seededRaffle.get("ticket_count");
      const ticketPrice = seededRaffle.get("ticket_price");
      const totalPrice = ticketCount * ticketPrice;
      buyerWalletBefore = getCharacterWallet(BUYER_ID).balance;
      sellerWalletBefore = getCharacterWallet(sellerId).balance;
      const fundedBuyerBalance = Math.max(
        buyerWalletBefore,
        totalPrice + 1_000_000_000,
      );
      setCharacterBalance(BUYER_ID, fundedBuyerBalance);

      service.Handle_SubscribeToRaffle([raffleId], buyerSession);
      service.Handle_SubscribeToRaffle([raffleId], watcherSession);

      const soldOutRaffle = service.Handle_BuyRandomTickets(
        [raffleId, ticketCount],
        buyerSession,
      );
      const soldOutEntries = readKeyValEntries(soldOutRaffle);
      const winningTicket = readKeyValEntries(soldOutEntries.get("winning_ticket"));

      assert.equal(soldOutEntries.get("sold_ticket_count"), ticketCount);
      assert.equal(
        soldOutEntries.get("raffle_status"),
        RAFFLE_STATUS.FINISHED_UNDELIVERED,
      );
      assert.equal(winningTicket.get("owner_id"), BUYER_ID);
      assert.equal(
        getCharacterWallet(BUYER_ID).balance,
        fundedBuyerBalance - totalPrice,
      );
      assert.equal(
        getCharacterWallet(sellerId).balance,
        sellerWalletBefore + calculateExpectedSellerPayout(totalPrice),
      );

      const activeTickets = service.Handle_GetMyActiveTickets([], buyerSession);
      const history = service.Handle_GetMyRaffleHistory([], buyerSession);
      const stats = readKeyValEntries(
        service.Handle_GetCreatedParticipated([], buyerSession),
      );

      assert.equal(activeTickets.type, "list");
      assert.equal(activeTickets.items.length, 0);
      assert.equal(
        history[0].items.some(
          (item) => readKeyValEntries(item).get("raffle_id") === raffleId,
        ),
        true,
      );
      assert.equal(stats.get("raffles_participated"), 1);
      assert.equal(stats.get("raffles_won"), 1);

      assert.equal(hasNotification(buyerSession, "OnTicketsUpdatedServer"), true);
      assert.equal(hasNotification(buyerSession, "OnRaffleUpdatedServer"), true);
      assert.equal(hasNotification(buyerSession, "OnRaffleFinishedServer"), true);
      assert.equal(hasNotification(watcherSession, "OnRaffleFinishedServer"), true);

      service.Handle_AwardItem([raffleId], buyerSession);
      const deliveredRaffle = readKeyValEntries(
        service.Handle_GetRaffle([raffleId], buyerSession),
      );
      const deliveredItem = findItemById(itemId);
      assert.equal(
        deliveredRaffle.get("raffle_status"),
        RAFFLE_STATUS.FINISHED_DELIVERED,
      );
      assert.ok(deliveredItem);
      assert.equal(deliveredItem.ownerID, BUYER_ID);
      assert.equal(deliveredItem.locationID, offerStationId);
      assert.equal(deliveredItem.flagID, ITEM_FLAGS.HANGAR);
    } finally {
      if (buyerWalletBefore !== null) {
        setCharacterBalance(BUYER_ID, buyerWalletBefore);
      }
      if (sellerId !== null && sellerWalletBefore !== null) {
        setCharacterBalance(sellerId, sellerWalletBefore);
      }
      sessionRegistry.unregister(buyerSession);
      sessionRegistry.unregister(watcherSession);
    }
  },
);

test(
  "expired raffles refund buyers, restore the listed item, and announce a null winner",
  { concurrency: false },
  async () => {
    const runtime = resetRaffleRuntime();
    const service = new RaffleProxyService();
    const creatorSession = createSession(BUYER_ID, 9008);
    const buyerSession = createSession(WATCHER_ID, 9009);
    let listedShipId = null;

    sessionRegistry.register(creatorSession);
    sessionRegistry.register(buyerSession);

    try {
      const buyerWalletBefore = getCharacterWallet(WATCHER_ID).balance;
      const { raffleId, item } = await createRaffleForCharacter(
        service,
        creatorSession,
      );
      listedShipId = item.itemID;

      service.Handle_SubscribeToTickets([], buyerSession);
      service.Handle_SubscribeToRaffle([raffleId], creatorSession);
      service.Handle_SubscribeToRaffle([raffleId], buyerSession);

      const beforeExpire = readKeyValEntries(
        service.Handle_BuyRandomTickets([raffleId, 1], buyerSession),
      );
      const ticketPrice = beforeExpire.get("ticket_price");

      assert.equal(
        getCharacterWallet(WATCHER_ID).balance,
        buyerWalletBefore - ticketPrice,
      );

      runtime._expireRaffle(raffleId);

      const expiredRaffle = readKeyValEntries(
        service.Handle_GetRaffle([raffleId], creatorSession),
      );
      const restoredShip = findItemById(listedShipId);
      const finishedNotification = getNotification(
        buyerSession,
        "OnRaffleFinishedServer",
      );

      assert.equal(
        expiredRaffle.get("raffle_status"),
        RAFFLE_STATUS.FINISHED_EXPIRED,
      );
      assert.equal(expiredRaffle.get("winning_ticket"), null);
      assert.equal(getCharacterWallet(WATCHER_ID).balance, buyerWalletBefore);
      assert.equal(restoredShip.flagID, ITEM_FLAGS.HANGAR);
      assert.ok(finishedNotification);
      assert.equal(finishedNotification.payloadTuple[0], raffleId);
      assert.equal(finishedNotification.payloadTuple[1], null);
    } finally {
      sessionRegistry.unregister(creatorSession);
      sessionRegistry.unregister(buyerSession);
    }
  },
);

test(
  "active player-created raffles survive a runtime restart",
  { concurrency: false },
  async () => {
    resetRaffleRuntime();
    const service = new RaffleProxyService();
    const creatorSession = createSession(140000003, 9010);

    const { raffleId, item } = await createRaffleForCharacter(service, creatorSession, {
      ticketPrice: 1000,
    });

    const restartedService = restartPersistentRaffleRuntime();
    const persistedRaffle = readKeyValEntries(
      restartedService.Handle_GetRaffle([raffleId], creatorSession),
    );
    const escrowedItem = findItemById(item.itemID);

    assert.equal(persistedRaffle.get("raffle_id"), raffleId);
    assert.equal(persistedRaffle.get("raffle_status"), RAFFLE_STATUS.RUNNING);
    assert.equal(persistedRaffle.get("item_id"), item.itemID);
    assert.equal(escrowedItem.flagID, RAFFLE_ESCROW_FLAG);
  },
);

test(
  "raffle cache flushes active ticket state to disk after the normal debounce",
  { concurrency: false },
  async () => {
    resetRaffleRuntime();
    const service = new RaffleProxyService();
    const creatorSession = createSession(140000003, 9016);
    const buyerSession = createSession(BUYER_ID, 9017);
    const buyerWalletBefore = getCharacterWallet(BUYER_ID).balance;

    try {
      const { raffleId } = await createRaffleForCharacter(service, creatorSession, {
        ticketCount: 8,
        ticketPrice: 1000,
      });

      setCharacterBalance(BUYER_ID, Math.max(buyerWalletBefore, 1_000_000_000));
      service.Handle_BuyRandomTickets([raffleId, 2], buyerSession);

      await wait(2500);

      const persistedRaffles = JSON.parse(
        fs.readFileSync(
          path.join(testDataDir, "raffles", "data.json"),
          "utf8",
        ),
      );
      const persistedRaffle = persistedRaffles[String(raffleId)];

      assert.ok(persistedRaffle);
      assert.equal(Array.isArray(persistedRaffle.soldTickets), true);
      assert.equal(persistedRaffle.soldTickets.length, 2);
      assert.equal(persistedRaffle.raffleStatus, RAFFLE_STATUS.RUNNING);
    } finally {
      setCharacterBalance(BUYER_ID, buyerWalletBefore);
    }
  },
);

test(
  "finished raffles survive restart without double-paying the seller",
  { concurrency: false },
  async () => {
    resetRaffleRuntime();
    const service = new RaffleProxyService();
    const creatorSession = createSession(140000003, 9011);
    const buyerSession = createSession(BUYER_ID, 9012);
    let buyerWalletBefore = null;
    let sellerWalletBefore = null;

    try {
      const { raffleId } = await createRaffleForCharacter(service, creatorSession, {
        ticketCount: 8,
        ticketPrice: 1000,
      });
      buyerWalletBefore = getCharacterWallet(BUYER_ID).balance;
      sellerWalletBefore = getCharacterWallet(creatorSession.characterID).balance;

      setCharacterBalance(BUYER_ID, 1_000_000_000);
      service.Handle_BuyRandomTickets([raffleId, 8], buyerSession);

      const sellerWalletAfterFinish = getCharacterWallet(
        creatorSession.characterID,
      ).balance;

      const restartedService = restartPersistentRaffleRuntime();
      const restartedRaffle = readKeyValEntries(
        restartedService.Handle_GetRaffle([raffleId], buyerSession),
      );

      assert.equal(
        restartedRaffle.get("raffle_status"),
        RAFFLE_STATUS.FINISHED_UNDELIVERED,
      );
      assert.equal(
        getCharacterWallet(creatorSession.characterID).balance,
        sellerWalletAfterFinish,
      );

      restartPersistentRaffleRuntime();
      assert.equal(
        getCharacterWallet(creatorSession.characterID).balance,
        sellerWalletAfterFinish,
      );
    } finally {
      if (buyerWalletBefore !== null) {
        setCharacterBalance(BUYER_ID, buyerWalletBefore);
      }
      if (sellerWalletBefore !== null) {
        setCharacterBalance(creatorSession.characterID, sellerWalletBefore);
      }
    }
  },
);

test(
  "expired raffles survive restart without double-refunding the buyer",
  { concurrency: false },
  async () => {
    const runtime = resetRaffleRuntime();
    const service = new RaffleProxyService();
    const creatorSession = createSession(BUYER_ID, 9013);
    const buyerSession = createSession(WATCHER_ID, 9014);
    let buyerWalletBefore = null;

    try {
      const { raffleId } = await createRaffleForCharacter(service, creatorSession);
      buyerWalletBefore = getCharacterWallet(WATCHER_ID).balance;

      const beforeExpire = readKeyValEntries(
        service.Handle_BuyRandomTickets([raffleId, 1], buyerSession),
      );
      const ticketPrice = beforeExpire.get("ticket_price");

      runtime._expireRaffle(raffleId);
      const buyerWalletAfterExpire = getCharacterWallet(WATCHER_ID).balance;
      assert.equal(buyerWalletAfterExpire, buyerWalletBefore);

      const restartedService = restartPersistentRaffleRuntime();
      const restartedRaffle = readKeyValEntries(
        restartedService.Handle_GetRaffle([raffleId], creatorSession),
      );

      assert.equal(
        restartedRaffle.get("raffle_status"),
        RAFFLE_STATUS.FINISHED_EXPIRED,
      );
      assert.equal(getCharacterWallet(WATCHER_ID).balance, buyerWalletAfterExpire);

      restartPersistentRaffleRuntime();
      assert.equal(getCharacterWallet(WATCHER_ID).balance, buyerWalletAfterExpire);
      assert.equal(ticketPrice > 0, true);
    } finally {
      if (buyerWalletBefore !== null) {
        setCharacterBalance(WATCHER_ID, buyerWalletBefore);
      }
    }
  },
);

test(
  "startup seed listings survive restart and are not replaced",
  { concurrency: false },
  () => {
    resetRaffleRuntime();
    const initialService = new RaffleProxyService();
    const session = createSession(BUYER_ID, 9015);
    const initialBrowse = initialService.Handle_Grab([], session);
    const initialIds = raffleIdList(initialBrowse).sort((left, right) => left - right);

    const restartedService = restartPersistentRaffleRuntime();
    const restartedBrowse = restartedService.Handle_Grab([], session);
    const restartedIds = raffleIdList(restartedBrowse).sort((left, right) => left - right);

    assert.equal(
      initialIds.every((raffleId) => restartedIds.includes(raffleId)),
      true,
    );
    assert.equal(
      restartedBrowse.items.every(
        (item) => readKeyValEntries(item).get("owner_id") === GM_ELYSIAN_ID,
      ),
      true,
    );
  },
);

test(
  "QA_SeedRaffles seeds the requested count and history paginates in 50-offer pages",
  { concurrency: false },
  () => {
    resetRaffleRuntime();
    const proxy = new RaffleProxyService();
    const manager = new RaffleMgrService();
    const gmSession = createSession(GM_ELYSIAN_ID, 9007);
    const startupBrowse = proxy.Handle_Grab([], gmSession);
    const startupSeedCount = startupBrowse.items.length;

    assert.equal(manager.Handle_QA_SeedRaffles([60]), 60);

    const [pageOne, pageSize] = proxy.Handle_GetMyRaffleHistory([], gmSession);
    const pageOneEntries = pageOne.items.map(readKeyValEntries);
    const lowestRunningId = Math.min(
      ...pageOneEntries.map((raffle) => raffle.get("running_id")),
    );
    const [pageTwo] = proxy.Handle_GetMyRaffleHistory([], gmSession, {
      type: "dict",
      entries: [["running_id", lowestRunningId]],
    });

    assert.equal(pageSize, 50);
    assert.equal(pageOne.items.length, 50);
    assert.equal(pageTwo.items.length, startupSeedCount + 10);
  },
);

test(
  "shared global config builder exposes HyperNet config as integers",
  { concurrency: false },
  () => {
    const globalConfig = buildGlobalConfigDict();

    assert.equal(
      globalConfig.entries.some(
        ([key, value]) => key === "HyperNetKillSwitch" && typeof value === "number",
      ),
      true,
    );
    assert.equal(
      globalConfig.entries.some(
        ([key, value]) =>
          key === "HyperNetPlexPriceOverride" && typeof value === "number",
      ),
      true,
    );
  },
);
