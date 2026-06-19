const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const repoRoot = path.join(__dirname, "..", "..");
const { marshalDecode, strVal } = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));
const daemonModule = require(path.join(
  repoRoot,
  "server/src/services/market/marketDaemonClient",
));
const objectCacheRuntime = require(path.join(
  repoRoot,
  "server/src/services/cache/objectCacheRuntime",
));
const itemStore = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const MarketProxyService = require(path.join(
  repoRoot,
  "server/src/services/market/marketProxyService",
));
const { __testHooks } = MarketProxyService;

function findEntry(entries, key) {
  return entries.find(([entryKey]) => strVal(entryKey) === key);
}

function findColumn(columns, key) {
  return columns.find(([columnKey]) => strVal(columnKey) === key);
}

function normalizeColumn(column) {
  return [strVal(column[0]), column[1]];
}

test("GetOrders returns blue.DBRow-backed rowsets for sell-window bid matching", async () => {
  const originalStartBackgroundConnect = daemonModule.marketDaemonClient.startBackgroundConnect;
  const originalCall = daemonModule.marketDaemonClient.call;

  daemonModule.marketDaemonClient.startBackgroundConnect = () => {};
  daemonModule.marketDaemonClient.call = async (method) => {
    assert.equal(method, "GetOrders");
    return {
      sells: [],
      buys: [
        {
          order_id: "123",
          price: 35843.31,
          vol_remaining: 5000,
          type_id: 15112,
          range_value: 32767,
          vol_entered: 5000,
          min_volume: 1,
          bid: true,
          issued_at: "2026-03-23T16:08:26.000Z",
          duration_days: 3650,
          station_id: 60003460,
          region_id: 10000002,
          solar_system_id: 30000142,
          constellation_id: 20000020,
        },
      ],
    };
  };

  try {
    const service = new MarketProxyService();
    const wrapped = await service.Handle_GetOrders(
      [15112],
      {
        regionid: 10000002,
        stationid: 60004423,
        solarsystemid2: 30000142,
      },
    );
    const cacheDetails = wrapped.args[0];
    const cachedPayload = wrapped.args[1].value;
    const version = wrapped.args[2];
    const [asks, bids] = marshalDecode(cachedPayload);

    const askEntries = asks.args.entries;
    const bidEntries = bids.args.entries;

    const askRowClass = findEntry(askEntries, "RowClass")[1].value;
    const bidRowClass = findEntry(bidEntries, "RowClass")[1].value;
    const bidHeader = findEntry(bidEntries, "header")[1];
    const bidColumns = findEntry(bidEntries, "columns")[1].items;
    const bidLines = findEntry(bidEntries, "lines")[1].items;
    const bidDescriptorColumns = bidHeader.header[1][0];

    assert.equal(askRowClass, "blue.DBRow");
    assert.equal(bidRowClass, "blue.DBRow");
    assert.equal(wrapped.type, "object");
    assert.equal(
      strVal(wrapped.name),
      "carbon.common.script.net.objectCaching.CachedMethodCallResult",
    );
    assert.equal(wrapped.args[1].type, "bytes");
    assert.equal(Buffer.isBuffer(wrapped.args[1].value), true);
    assert.equal(cacheDetails.type, "dict");
    assert.equal(cacheDetails.entries.length, 1);
    assert.equal(strVal(cacheDetails.entries[0][0]), "versionCheck");
    assert.equal(strVal(cacheDetails.entries[0][1]), "run");
    assert.equal(Array.isArray(version), true);
    assert.equal(version.length, 2);
    assert.equal(typeof BigInt(version[0].value), "bigint");
    assert.equal(
      version[1],
      objectCacheRuntime.__testHooks.computeSignedAdler32(cachedPayload),
    );
    assert.equal(bidHeader.type, "objectex1");
    assert.equal(bidHeader.header[0].value, "blue.DBRowDescriptor");
    assert.deepEqual(
      normalizeColumn(findColumn(bidDescriptorColumns, "orderID")),
      ["orderID", 20],
    );
    assert.deepEqual(
      normalizeColumn(findColumn(bidDescriptorColumns, "volRemaining")),
      ["volRemaining", 3],
    );
    assert.deepEqual(
      normalizeColumn(findColumn(bidDescriptorColumns, "volEntered")),
      ["volEntered", 3],
    );
    assert.deepEqual(
      normalizeColumn(findColumn(bidDescriptorColumns, "issueDate")),
      ["issueDate", 64],
    );
    assert.equal(bidColumns.length, 15);
    assert.equal(bidLines.length, 1);
    assert.equal(Array.isArray(bidLines[0]), true);
    assert.equal(bidLines[0].length, 15);
    assert.equal(bidLines[0][14], 0);
  } finally {
    daemonModule.marketDaemonClient.startBackgroundConnect = originalStartBackgroundConnect;
    daemonModule.marketDaemonClient.call = originalCall;
  }
});

test("GetRegionBest returns direct BestByOrder summary rows rather than a cached wrapper", async () => {
  const originalStartBackgroundConnect = daemonModule.marketDaemonClient.startBackgroundConnect;
  const originalCall = daemonModule.marketDaemonClient.call;

  daemonModule.marketDaemonClient.startBackgroundConnect = () => {};
  daemonModule.marketDaemonClient.call = async (method) => {
    assert.equal(method, "GetRegionBest");
    return [
      {
        type_id: 34,
        best_ask_price: 5.25,
        total_ask_quantity: 5000,
        best_ask_station_id: 60003760,
      },
    ];
  };

  try {
    const service = new MarketProxyService();
    const result = await service.Handle_GetRegionBest(
      [],
      {
        regionid: 10000002,
      },
    );

    assert.equal(result.type, "dict");
    assert.equal(Array.isArray(result.entries), true);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0][0], 34);
    assert.equal(result.entries[0][1].type, "object");
    assert.equal(result.entries[0][1].name, "util.KeyVal");
  } finally {
    daemonModule.marketDaemonClient.startBackgroundConnect = originalStartBackgroundConnect;
    daemonModule.marketDaemonClient.call = originalCall;
  }
});

test("market marshal helpers accept CCP python-long strings in sell payloads", () => {
  const keyValEntry = {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: [
        [{ type: "token", value: "itemID" }, { type: "long", value: "990114114" }],
        [{ type: "token", value: "typeID" }, { type: "int", value: 2420 }],
        [{ type: "token", value: "stationID" }, { type: "int", value: 60003760 }],
        [{ type: "token", value: "quantity" }, { type: "int", value: 5 }],
      ],
    },
  };

  const normalizedEntry = __testHooks.marshalObjectToPlainObject(keyValEntry);

  assert.deepEqual(normalizedEntry, {
    itemID: "990114114",
    typeID: 2420,
    stationID: 60003760,
    quantity: 5,
  });
  assert.equal(__testHooks.normalizePositiveInteger("990114114L", 0), 990114114);
  assert.equal(__testHooks.normalizePositiveInteger(normalizedEntry.itemID, 0), 990114114);
});

test("market marshal helpers accept tokenized util.KeyVal sell payloads", () => {
  const keyValEntry = {
    type: "object",
    name: { type: "token", value: "util.KeyVal" },
    args: {
      type: "dict",
      entries: [
        [{ type: "token", value: "itemID" }, { type: "long", value: "990114124" }],
        [{ type: "token", value: "typeID" }, { type: "int", value: 40340 }],
        [{ type: "token", value: "stationID" }, { type: "int", value: 60003760 }],
        [{ type: "token", value: "quantity" }, { type: "int", value: 5 }],
        [{ type: "token", value: "price" }, { type: "real", value: 30554.71 }],
        [{ type: "token", value: "delta" }, { type: "real", value: -0.061243569895234974 }],
        [{ type: "token", value: "rawBrokerFeePercentage" }, { type: "real", value: 0.015 }],
      ],
    },
  };

  const normalizedEntry = __testHooks.marshalObjectToPlainObject(keyValEntry);

  assert.deepEqual(normalizedEntry, {
    itemID: "990114124",
    typeID: 40340,
    stationID: 60003760,
    quantity: 5,
    price: 30554.71,
    delta: -0.061243569895234974,
    rawBrokerFeePercentage: 0.015,
  });
});

test("market marshal helpers accept tokenized utillib.KeyVal sell payloads", () => {
  const keyValEntry = {
    type: "object",
    name: { type: "token", value: "utillib.KeyVal" },
    args: {
      type: "dict",
      entries: [
        [{ type: "token", value: "itemID" }, { type: "long", value: "990114124" }],
        [{ type: "token", value: "typeID" }, { type: "int", value: 40340 }],
        [{ type: "token", value: "stationID" }, { type: "int", value: 60003760 }],
        [{ type: "token", value: "quantity" }, { type: "int", value: 5 }],
        [{ type: "token", value: "price" }, { type: "real", value: 30554.71 }],
        [{ type: "token", value: "delta" }, { type: "real", value: -0.061243569895234974 }],
        [{ type: "token", value: "rawBrokerFeePercentage" }, { type: "real", value: 0.015 }],
        [{ type: "token", value: "officeID" }, null],
      ],
    },
  };

  const normalizedEntry = __testHooks.marshalObjectToPlainObject(keyValEntry);

  assert.deepEqual(normalizedEntry, {
    itemID: "990114124",
    typeID: 40340,
    stationID: 60003760,
    quantity: 5,
    price: 30554.71,
    delta: -0.061243569895234974,
    rawBrokerFeePercentage: 0.015,
    officeID: null,
  });
});

test("market marshal helpers accept raw-string util.KeyVal sell payloads", () => {
  const keyValEntry = {
    type: "object",
    name: Buffer.from("util.KeyVal", "utf8"),
    args: {
      type: "dict",
      entries: [
        [{ type: "token", value: "itemID" }, { type: "long", value: "990114126" }],
        [{ type: "token", value: "typeID" }, { type: "int", value: 40519 }],
        [{ type: "token", value: "stationID" }, { type: "int", value: 60003760 }],
        [{ type: "token", value: "quantity" }, { type: "int", value: 500 }],
        [{ type: "token", value: "price" }, { type: "real", value: 13616.83 }],
        [{ type: "token", value: "delta" }, { type: "real", value: -0.0779203278546432 }],
        [{ type: "token", value: "rawBrokerFeePercentage" }, { type: "real", value: 0.015 }],
        [{ type: "token", value: "officeID" }, null],
      ],
    },
  };

  const normalizedEntry = __testHooks.marshalObjectToPlainObject(keyValEntry);

  assert.deepEqual(normalizedEntry, {
    itemID: "990114126",
    typeID: 40519,
    stationID: 60003760,
    quantity: 500,
    price: 13616.83,
    delta: -0.0779203278546432,
    rawBrokerFeePercentage: 0.015,
    officeID: null,
  });
});

test("market marshal helpers accept objectex1 util.KeyVal sell payloads", () => {
  const keyValEntry = {
    type: "objectex1",
    header: [
      { type: "token", value: "util.KeyVal" },
      { type: "tuple", items: [] },
      {
        type: "dict",
        entries: [
          [{ type: "token", value: "itemID" }, { type: "long", value: "990114114" }],
          [{ type: "token", value: "typeID" }, { type: "int", value: 2420 }],
          [{ type: "token", value: "stationID" }, { type: "int", value: 60003760 }],
          [{ type: "token", value: "quantity" }, { type: "int", value: 5 }],
        ],
      },
    ],
    list: [],
    dict: [],
  };

  const normalizedEntry = __testHooks.marshalObjectToPlainObject(keyValEntry);

  assert.deepEqual(normalizedEntry, {
    itemID: "990114114",
    typeID: 2420,
    stationID: 60003760,
    quantity: 5,
  });
  assert.equal(__testHooks.normalizePositiveInteger(normalizedEntry.itemID, 0), 990114114);
});

test("market sell helpers can consume a seeded-buy fill from inventory", () => {
  const ownerID = 140000003;
  const locationID = 990001002;
  const grantResult = itemStore.grantItemToCharacterLocation(
    ownerID,
    locationID,
    itemStore.ITEM_FLAGS.HANGAR,
    { typeID: 34 },
    7,
    { singleton: 0 },
  );

  assert.equal(grantResult.success, true);
  const grantedItem = grantResult.data.items[0];
  const itemID = grantedItem.itemID;

  try {
    const consumeResult = __testHooks.consumeInventoryItemQuantity(itemID, 7);
    assert.equal(consumeResult.success, true);
    assert.equal(Array.isArray(consumeResult.data.changes), true);
    assert.equal(consumeResult.data.changes[0].removed, true);
    assert.equal(itemStore.findItemById(itemID), null);
  } finally {
    if (itemStore.findItemById(itemID)) {
      itemStore.removeInventoryItem(itemID, { removeContents: true });
    }
  }
});
