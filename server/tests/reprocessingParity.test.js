const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const ReprocessingService = require(path.join(
  repoRoot,
  "server/src/services/station/reprocessingService",
));
const chatCommands = require(path.join(
  repoRoot,
  "server/src/services/chat/chatCommands",
));
const OfficeManagerService = require(path.join(
  repoRoot,
  "server/src/services/corporation/officeManagerService",
));
const {
  applyCharacterToSession,
  buildInventoryItemRow,
  getActiveShipRecord,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  ITEM_FLAGS,
  buildInventoryItem,
  findItemById,
  getItemMutationVersion,
  listOwnedItems,
  resetInventoryStoreForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  buildReprocessingQuoteForItem,
  refreshReprocessingStaticData,
  resolveReprocessingContext,
  getStationEfficiencyForTypeID,
  getStructureGasDecompressionEfficiency,
  resetReprocessingFacilityStateCacheForTests,
  setReprocessingFacilityRigTypeIDs,
  REPROCESSING_FACILITY_STATE_TABLE,
} = require(path.join(
  repoRoot,
  "server/src/services/reprocessing",
));
const {
  clearStandingRuntimeCaches,
} = require(path.join(
  repoRoot,
  "server/src/services/character/standingRuntime",
));
const {
  getCharacterWallet,
  setCharacterBalance,
} = require(path.join(
  repoRoot,
  "server/src/services/account/walletState",
));
const {
  buildReprocessingGatewayProtoRoot,
} = require(path.join(
  repoRoot,
  "server/src/services/reprocessing/reprocessingGatewayProto",
));
const {
  unwrapMarshalValue,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/serviceHelpers",
));
const {
  marshalEncode,
  marshalDecode,
} = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));
const {
  TABLE,
  readStaticRows,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/referenceData",
));

const CORP_HANGAR_1 = 115;
const ROLE_FACTORY_MANAGER = 1024n;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `Failed to read ${tableName}`);
  return result.data || {};
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

function nextSyntheticItemID(items) {
  let maxItemID = 1_990_000_000;
  for (const rawItem of Object.values(items || {})) {
    const itemID = Number(rawItem && rawItem.itemID) || 0;
    if (itemID > maxItemID) {
      maxItemID = itemID;
    }
  }
  return maxItemID + 1;
}

function getDockedCandidate() {
  const characters = readTable("characters");
  const candidates = Object.keys(characters)
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const characterRecord = getCharacterRecord(characterID);
      const ship = getActiveShipRecord(characterID);
      const stationID = Number(characterRecord && characterRecord.stationID) || 0;
      if (!characterRecord || !ship || stationID <= 0) {
        return null;
      }
      return {
        characterID,
        stationID,
        shipID: Number(ship.itemID || ship.shipID) || 0,
        corporationID: Number(characterRecord.corporationID || 0) || 0,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.characterID - right.characterID);

  assert.ok(candidates.length > 0, "Expected a docked character");
  return candidates[0];
}

function getSolarSystemIDForSecurityBand(band) {
  const systems = readStaticRows(TABLE.SOLAR_SYSTEMS) || [];
  const normalizedBand = String(band || "").trim().toLowerCase();
  const match = systems.find((system) => {
    const security = Number(system && system.security) || 0;
    if (normalizedBand === "high") {
      return security >= 0.45;
    }
    if (normalizedBand === "low") {
      return security > 0 && security < 0.45;
    }
    return security <= 0;
  });
  assert.ok(match, `Expected a solar system in the ${normalizedBand} security band`);
  return Number(match.solarSystemID) || 0;
}

function buildSession(characterID) {
  return {
    clientID: characterID + 900_000,
    userid: characterID,
    currentBoundObjectID: null,
    notifications: [],
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function captureThrownError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("Expected function to throw");
}

function getWrappedUserErrorMessage(error) {
  const payload = error && error.machoErrorResponse && error.machoErrorResponse.payload;
  return payload &&
    Array.isArray(payload.header) &&
    Array.isArray(payload.header[1])
      ? payload.header[1][0]
      : null;
}

function getWrappedUserErrorDict(error) {
  const payload = error && error.machoErrorResponse && error.machoErrorResponse.payload;
  const dictHeader =
    payload &&
    Array.isArray(payload.header) &&
    Array.isArray(payload.header[1])
      ? payload.header[1][1]
      : null;
  return dictHeader && Array.isArray(dictHeader.entries)
    ? Object.fromEntries(dictHeader.entries)
    : {};
}

function createInventoryItem(items, itemID, ownerID, locationID, flagID, typeID, quantity) {
  items[String(itemID)] = buildInventoryItem({
    itemID,
    typeID,
    ownerID,
    locationID,
    flagID,
    itemName: `Test ${typeID}`,
    quantity,
    stacksize: quantity,
    singleton: 0,
  });
  return items[String(itemID)];
}

function seedSyntheticHangarItems(t, candidate, typeIDs = [], quantity = 100) {
  const originalItems = cloneValue(readTable("items"));
  t.after(() => {
    writeTable("items", originalItems);
    resetInventoryStoreForTests();
  });

  const items = cloneValue(originalItems);
  let nextItemID = nextSyntheticItemID(items);
  const seededItems = [];
  for (const typeID of Array.isArray(typeIDs) ? typeIDs : []) {
    const item = buildInventoryItem({
      itemID: nextItemID,
      typeID,
      ownerID: candidate.characterID,
      locationID: candidate.stationID,
      flagID: ITEM_FLAGS.HANGAR,
      itemName: `Test ${typeID}`,
      quantity,
      stacksize: quantity,
      singleton: 0,
    });
    items[String(nextItemID)] = item;
    seededItems.push(item);
    nextItemID += 1;
  }

  writeTable("items", items);
  resetInventoryStoreForTests();
  return seededItems;
}

function buildRecoverableTotalsByType(quote) {
  const totals = new Map();
  for (const recoverable of Array.isArray(quote && quote.recoverables)
    ? quote.recoverables
    : []) {
    const typeID = Number(recoverable && recoverable.typeID) || 0;
    const quantity = Number(recoverable && recoverable.client) || 0;
    if (typeID <= 0 || quantity <= 0) {
      continue;
    }
    totals.set(typeID, (totals.get(typeID) || 0) + quantity);
  }
  return totals;
}

function findReprocessableChargeTypeIDs(context, desiredCount = 1) {
  const items = readTable("items");
  const discoveredTypeIDs = [];
  const seenTypeIDs = new Set();

  for (const rawItem of Object.values(items || {})) {
    const item = rawItem || {};
    const categoryID = Number(item.categoryID) || 0;
    const typeID = Number(item.typeID) || 0;
    if (categoryID !== 8 || typeID <= 0 || seenTypeIDs.has(typeID)) {
      continue;
    }
    seenTypeIDs.add(typeID);

    const quote = buildReprocessingQuoteForItem(
      buildInventoryItem({
        itemID: 9_900_000_000 + typeID,
        typeID,
        ownerID: Number(context && context.characterID) || 0,
        locationID: Number(context && context.dockedLocationID) || 0,
        flagID: ITEM_FLAGS.HANGAR,
        itemName: `Synthetic charge ${typeID}`,
        quantity: 100,
        stacksize: 100,
        singleton: 0,
      }),
      context,
      { includeRecoverablesFromRandomizedOutputs: false },
    );

    if (
      quote &&
      !quote.errorMsg &&
      Array.isArray(quote.recoverables) &&
      quote.recoverables.length > 0
    ) {
      discoveredTypeIDs.push(typeID);
      if (discoveredTypeIDs.length >= desiredCount) {
        return discoveredTypeIDs;
      }
    }
  }

  return discoveredTypeIDs;
}

function findSafeCombinedOverflowSeed(context, typeID) {
  let quantity = 400_000_000;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const quote = buildReprocessingQuoteForItem(
      buildInventoryItem({
        itemID: 8_800_000_000 + attempt,
        typeID,
        ownerID: Number(context && context.characterID) || 0,
        locationID: Number(context && context.dockedLocationID) || 0,
        flagID: ITEM_FLAGS.HANGAR,
        itemName: `Overflow seed ${typeID}`,
        quantity,
        stacksize: quantity,
        singleton: 0,
      }),
      context,
      { includeRecoverablesFromRandomizedOutputs: false },
    );

    if (quote && !quote.errorMsg) {
      for (const [recoverableTypeID, totalQuantity] of buildRecoverableTotalsByType(quote)) {
        if (totalQuantity * 2 > 2_147_483_647) {
          return {
            quantity,
            overflowTypeID: recoverableTypeID,
          };
        }
      }
    }

    quantity *= 2;
  }

  return null;
}

function getQuoteDictEntries(response) {
  return response && Array.isArray(response) && response[2] && response[2].type === "dict"
    ? response[2].entries
    : [];
}

function getQuoteEntryValue(response, itemID) {
  const entry = getQuoteDictEntries(response).find(
    ([entryItemID]) => Number(entryItemID) === Number(itemID),
  );
  return entry ? unwrapMarshalValue(entry[1]) : null;
}

function sumOutputByTypeID(outputPayload = {}) {
  return Object.values(outputPayload).reduce((sum, quantity) => sum + (Number(quantity) || 0), 0);
}

function measureAverageMs(fn, iterations = 2000, warmup = 200) {
  for (let index = 0; index < warmup; index += 1) {
    fn();
  }
  const start = process.hrtime.bigint();
  for (let index = 0; index < iterations; index += 1) {
    fn();
  }
  const elapsedNs = process.hrtime.bigint() - start;
  return Number(elapsedNs) / 1e6 / iterations;
}

function assertApproxEqual(actual, expected, epsilon = 1e-9, message = null) {
  assert.ok(
    Math.abs(Number(actual) - Number(expected)) <= epsilon,
    message || `Expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test("reprocessingSvc GetQuotes accepts the client item-dict payload shape and returns keyed quotes", async (t) => {
  refreshReprocessingStaticData();
  const originalItems = cloneValue(readTable("items"));
  t.after(() => {
    writeTable("items", originalItems);
    resetInventoryStoreForTests();
  });

  const candidate = getDockedCandidate();
  const session = buildSession(candidate.characterID);
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const characters = cloneValue(readTable("characters"));
  characters[String(candidate.characterID)] = {
    ...characters[String(candidate.characterID)],
    balance: 10_000_000_000,
  };
  writeTable("characters", characters);

  const items = cloneValue(readTable("items"));
  const itemID = nextSyntheticItemID(items);
  const createdItem = createInventoryItem(
    items,
    itemID,
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    1230,
    200,
  );
  writeTable("items", items);
  resetInventoryStoreForTests();

  const service = new ReprocessingService();
  const response = service.Handle_GetQuotes([
    {
      type: "dict",
      entries: [[itemID, buildInventoryItemRow(createdItem)]],
    },
    candidate.shipID,
  ], session);

  const quote = getQuoteEntryValue(response, itemID);
  assert.ok(quote, "Expected quote data for the dragged item");
  assert.equal(Number(quote.itemID) || 0, itemID);
  assert.equal(Number(quote.numPortions) || 0, 2);
  assert.equal(Number(quote.quantityToProcess) || 0, 200);
  assert.equal(Array.isArray(quote.recoverables), true);
});

test("reprocessingSvc GetQuotes accepts the retail packed-row dict shape with an empty-string key", async (t) => {
  refreshReprocessingStaticData();
  const candidate = getDockedCandidate();
  const [item] = seedSyntheticHangarItems(t, candidate, [1230], 200);
  assert.ok(item, "Expected the packed-row test item to be seeded");

  const service = new ReprocessingService();
  const session = buildSession(Number(item.ownerID) || 0);
  const applyResult = applyCharacterToSession(session, Number(item.ownerID) || 0, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const response = service.Handle_GetQuotes([
    {
      type: "dict",
      entries: [["", buildInventoryItemRow(item)]],
    },
    session.shipid || session.shipID,
  ], session);

  const quote = getQuoteEntryValue(response, item.itemID);
  assert.ok(quote, "Expected a quote entry for the packed-row item");
  assert.equal(Number(quote.itemID) || 0, Number(item.itemID) || 0);
  assert.equal(Number(quote.typeID) || 0, Number(item.typeID) || 0);
  assert.ok(
    Array.isArray(quote.recoverables) && quote.recoverables.length > 0,
    "Expected recoverables for the packed-row selection item",
  );
});

test("marshal packed-row round trips preserve inventory row fields for reprocessing selections", async (t) => {
  const candidate = getDockedCandidate();
  const [syntheticItem] = seedSyntheticHangarItems(t, candidate, [10631], 100);
  assert.ok(syntheticItem, "Expected the synthetic launcher item to be created");

  const decodedRow = marshalDecode(marshalEncode(buildInventoryItemRow(syntheticItem)));
  assert.equal(decodedRow && decodedRow.type, "packedrow");
  assert.equal(Number(decodedRow.fields && decodedRow.fields.itemID) || 0, Number(syntheticItem.itemID) || 0);
  assert.equal(Number(decodedRow.fields && decodedRow.fields.typeID) || 0, Number(syntheticItem.typeID) || 0);
  assert.equal(Number(decodedRow.fields && decodedRow.fields.locationID) || 0, Number(syntheticItem.locationID) || 0);
  assert.equal(Number(decodedRow.fields && decodedRow.fields.stacksize) || 0, Number(syntheticItem.stacksize) || 0);
});

test("reprocessingSvc GetQuotes preserves every selected module when the CCP packed-row payload is marshaled on the wire", async (t) => {
  refreshReprocessingStaticData();
  const candidate = getDockedCandidate();
  const ship = getActiveShipRecord(candidate.characterID);
  assert.ok(ship, "Expected the docked test character to have an active ship");

  const session = buildSession(candidate.characterID);
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const selectedTypeIDs = [
    10631,
    22564,
    13923,
    16067,
    14683,
    20603,
    34290,
    17488,
    13924,
  ];
  const selectedItems = seedSyntheticHangarItems(t, candidate, selectedTypeIDs, 100);
  const selectedItemIDs = selectedItems.map((item) => Number(item.itemID) || 0);
  assert.equal(selectedItems.length, selectedTypeIDs.length);

  const wirePayload = marshalDecode(marshalEncode({
    type: "dict",
    // This matches the retail `reproc9` shape: itemID keys paired with packed rows.
    entries: selectedItems.map((item) => [Number(item.itemID) || 0, buildInventoryItemRow(item)]),
  }));

  const service = new ReprocessingService();
  const response = service.Handle_GetQuotes([
    wirePayload,
    Number(ship.itemID || ship.shipID) || 0,
  ], session);

  const quoteEntries = new Map(
    getQuoteDictEntries(response).map(([itemID, quote]) => [
      Number(itemID) || 0,
      unwrapMarshalValue(quote),
    ]),
  );

  assert.equal(
    quoteEntries.size,
    selectedItemIDs.length,
    "Expected a quote row for every marshaled packed-row selection item",
  );

  for (const item of selectedItems) {
    const quote = quoteEntries.get(Number(item.itemID) || 0);
    assert.ok(quote, `Expected quote data for item ${item.itemID}`);
    assert.ok(
      Array.isArray(quote.recoverables) && quote.recoverables.length > 0,
      `Expected recoverables for item ${item.itemID}`,
    );
  }
});

test("reprocessingSvc GetQuotes returns quote rows for every selected charge item in the live hangar selection", async (t) => {
  refreshReprocessingStaticData();
  const candidate = getDockedCandidate();
  const session = buildSession(candidate.characterID);
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const contextResult = resolveReprocessingContext(session);
  assert.equal(contextResult.success, true);
  const chargeTypeIDs = findReprocessableChargeTypeIDs(contextResult.data, 3);
  assert.ok(
    chargeTypeIDs.length > 0,
    "Expected at least one reprocessable charge type to exist in the current data set",
  );
  const chargeItems = seedSyntheticHangarItems(t, candidate, chargeTypeIDs, 100);

  const service = new ReprocessingService();
  const response = service.Handle_GetQuotes([
    {
      type: "dict",
      entries: chargeItems.map((item) => [item.itemID, buildInventoryItemRow(item)]),
    },
    candidate.shipID,
  ], session);

  const quoteEntries = new Map(
    getQuoteDictEntries(response).map(([itemID, quote]) => [
      Number(itemID) || 0,
      unwrapMarshalValue(quote),
    ]),
  );
  assert.equal(
    quoteEntries.size,
    chargeItems.length,
    "Expected a quote row for every selected charge item",
  );

  let restrictedCount = 0;
  for (const item of chargeItems) {
    const quote = quoteEntries.get(Number(item.itemID) || 0);
    const recoverables = Array.isArray(quote && quote.recoverables)
      ? quote.recoverables
      : [];
    if (recoverables.length <= 0) {
      restrictedCount += 1;
    }
  }

  assert.equal(
    restrictedCount,
    0,
    "Expected the selected charge-item quotes to be processable under the client restricted-item rule",
  );
});

test("buildReprocessingQuoteForItem flags a single oversized quote that would overflow client recoverable quantities", async (t) => {
  refreshReprocessingStaticData();
  const originalItems = cloneValue(readTable("items"));
  t.after(() => {
    writeTable("items", originalItems);
    resetInventoryStoreForTests();
  });

  const candidate = getDockedCandidate();
  const session = buildSession(candidate.characterID);
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const items = cloneValue(readTable("items"));
  const firstItemID = nextSyntheticItemID(items);
  createInventoryItem(
    items,
    firstItemID,
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    1230,
    2_147_483_647,
  );
  writeTable("items", items);
  resetInventoryStoreForTests();

  const contextResult = resolveReprocessingContext(session);
  assert.equal(contextResult.success, true);

  const quote = buildReprocessingQuoteForItem(
    findItemById(firstItemID),
    contextResult.data,
    { includeRecoverablesFromRandomizedOutputs: false },
  );
  assert.equal(quote && quote.errorMsg, "REPROCESSING_SPLIT_REQUIRED");
});

test("reprocessingSvc GetQuotes allows combined output totals above the per-quote int limit when each quote is individually client-safe", async (t) => {
  refreshReprocessingStaticData();
  const originalItems = cloneValue(readTable("items"));
  t.after(() => {
    writeTable("items", originalItems);
    resetInventoryStoreForTests();
  });

  const candidate = getDockedCandidate();
  const session = buildSession(candidate.characterID);
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const contextResult = resolveReprocessingContext(session);
  assert.equal(contextResult.success, true);
  const overflowSeed = findSafeCombinedOverflowSeed(contextResult.data, 1230);
  assert.ok(
    overflowSeed,
    "Expected to find a client-safe seeded quantity whose combined outputs overflow the per-quote int limit",
  );

  const items = cloneValue(readTable("items"));
  const firstItemID = nextSyntheticItemID(items);
  const secondItemID = firstItemID + 1;
  createInventoryItem(
    items,
    firstItemID,
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    1230,
    overflowSeed.quantity,
  );
  createInventoryItem(
    items,
    secondItemID,
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    1230,
    overflowSeed.quantity,
  );
  writeTable("items", items);
  resetInventoryStoreForTests();

  const service = new ReprocessingService();
  const response = service.Handle_GetQuotes([
    {
      type: "dict",
      entries: [
        ["", buildInventoryItemRow(findItemById(firstItemID))],
        ["", buildInventoryItemRow(findItemById(secondItemID))],
      ],
    },
    candidate.shipID,
  ], session);

  const firstQuote = getQuoteEntryValue(response, firstItemID);
  const secondQuote = getQuoteEntryValue(response, secondItemID);
  assert.ok(firstQuote, "Expected a quote for the first safe item");
  assert.ok(secondQuote, "Expected a quote for the second safe item");

  const combinedOverflowQuantity = [
    ...(Array.isArray(firstQuote.recoverables) ? firstQuote.recoverables : []),
    ...(Array.isArray(secondQuote.recoverables) ? secondQuote.recoverables : []),
  ]
    .filter(
      (recoverable) =>
        Number(recoverable && recoverable.typeID) === overflowSeed.overflowTypeID,
    )
    .reduce((sum, recoverable) => sum + (Number(recoverable && recoverable.client) || 0), 0);
  assert.ok(
    combinedOverflowQuantity > 2_147_483_647,
    "Expected combined output to exceed the per-quote int limit without forcing a split error",
  );
});

test("reprocessingSvc guards quote sets whose combined output quantity would overflow the retail output badge formatter", () => {
  const tooLarge = new Map([
    [1, { recoverables: [{ typeID: 34, client: 99_999_999_999_999 }] }],
    [2, { recoverables: [{ typeID: 34, client: 2 }] }],
  ]);
  const safe = new Map([
    [1, { recoverables: [{ typeID: 34, client: 99_999_999_999_999 }] }],
    [2, { recoverables: [{ typeID: 35, client: 2 }] }],
  ]);

  assert.equal(
    ReprocessingService._quoteSetExceedsClientOutputDisplayLimit(tooLarge),
    true,
    "Expected a combined same-type output total above the client FmtAmt short limit to be rejected",
  );
  assert.equal(
    ReprocessingService._quoteSetExceedsClientOutputDisplayLimit(safe),
    false,
    "Expected independent material totals below the client FmtAmt short limit to remain allowed",
  );
});

test("reprocessingSvc GetQuotes keeps oversized selections virtual and returns a split-safe quote without mutating inventory", async (t) => {
  refreshReprocessingStaticData();
  const originalItems = cloneValue(readTable("items"));
  t.after(() => {
    writeTable("items", originalItems);
    resetInventoryStoreForTests();
  });

  const candidate = getDockedCandidate();
  const session = buildSession(candidate.characterID);
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const items = cloneValue(readTable("items"));
  const itemID = nextSyntheticItemID(items);
  createInventoryItem(
    items,
    itemID,
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    1230,
    2_147_483_647,
  );
  writeTable("items", items);
  resetInventoryStoreForTests();
  const beforeMutationVersion = getItemMutationVersion();

  const service = new ReprocessingService();
  const response = service.Handle_GetQuotes([
    {
      type: "dict",
      entries: [["", buildInventoryItemRow(findItemById(itemID))]],
    },
    candidate.shipID,
  ], session);
  const afterMutationVersion = getItemMutationVersion();

  const quoteEntries = getQuoteDictEntries(response);
  assert.equal(quoteEntries.length, 1, "Expected one aggregated quote row for the selected oversized item");
  const rootQuote = getQuoteEntryValue(response, itemID);
  assert.ok(rootQuote, "Expected the original selected item to keep a quote row");
  assert.ok(
    Array.isArray(rootQuote.recoverables) && rootQuote.recoverables.length > 0,
    "Expected the original selected item to become reprocessable through the virtual split preview",
  );
  assert.ok(
    Number(rootQuote.quantityToProcess) > 0,
    "Expected the aggregated oversized quote to expose processable quantity",
  );
  assert.equal(
    afterMutationVersion,
    beforeMutationVersion,
    "Expected quote preview to avoid mutating inventory state",
  );

  const splitStacks = listOwnedItems(candidate.characterID, {
    locationID: candidate.stationID,
    flagID: ITEM_FLAGS.HANGAR,
    typeID: 1230,
  }).filter((entry) => {
    const originID = Number(entry && entry.stackOriginID) || 0;
    return Number(entry && entry.itemID) === itemID || originID === itemID;
  });
  assert.equal(splitStacks.length, 1, "Expected oversized preview to avoid physically splitting inventory");
  const totalQuantity = splitStacks.reduce(
    (sum, entry) => sum + (Number(entry && (entry.stacksize ?? entry.quantity)) || 0),
    0,
  );
  assert.equal(totalQuantity, 2_147_483_647);
});

test("reprocessingSvc Reprocess materializes oversized selections only at execution time and processes every generated sibling stack", async (t) => {
  refreshReprocessingStaticData();
  const originalItems = cloneValue(readTable("items"));
  const originalCharacters = cloneValue(readTable("characters"));
  t.after(() => {
    writeTable("items", originalItems);
    writeTable("characters", originalCharacters);
    resetInventoryStoreForTests();
  });

  const candidate = getDockedCandidate();
  const session = buildSession(candidate.characterID);
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const items = cloneValue(readTable("items"));
  const itemID = nextSyntheticItemID(items);
  createInventoryItem(
    items,
    itemID,
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    1230,
    2_147_483_647,
  );
  writeTable("items", items);
  resetInventoryStoreForTests();

  const service = new ReprocessingService();
  service.Handle_GetQuotes([
    {
      type: "dict",
      entries: [["", buildInventoryItemRow(findItemById(itemID))]],
    },
    candidate.shipID,
  ], session);

  const splitStacksBefore = listOwnedItems(candidate.characterID, {
    locationID: candidate.stationID,
    flagID: ITEM_FLAGS.HANGAR,
    typeID: 1230,
  }).filter((entry) => {
    const originID = Number(entry && entry.stackOriginID) || 0;
    return Number(entry && entry.itemID) === itemID || originID === itemID;
  });
  assert.equal(splitStacksBefore.length, 1, "Expected quote preview to leave the oversized stack unsplit before execution");

  const response = service.Handle_Reprocess([
    { type: "list", items: [itemID] },
    candidate.stationID,
    candidate.characterID,
    null,
    null,
  ], session);

  const processedItemIDs = unwrapMarshalValue(response[0]);
  const outputByTypeID = unwrapMarshalValue(response[1]);
  assert.ok(
    Array.isArray(processedItemIDs) && processedItemIDs.length > 1,
    "Expected the original selected item to expand into all auto-split sibling stacks during reprocessing",
  );
  assert.ok(sumOutputByTypeID(outputByTypeID) > 0, "Expected mineral outputs from the expanded reprocess call");

  const splitStacksAfter = listOwnedItems(candidate.characterID, {
    locationID: candidate.stationID,
    flagID: ITEM_FLAGS.HANGAR,
    typeID: 1230,
  }).filter((entry) => {
    const originID = Number(entry && entry.stackOriginID) || 0;
    return Number(entry && entry.itemID) === itemID || originID === itemID;
  });
  assert.equal(splitStacksAfter.length, 1, "Expected only the original leftover stack to remain after reprocessing");
  assert.equal(
    Number(splitStacksAfter[0] && (splitStacksAfter[0].stacksize ?? splitStacksAfter[0].quantity)) || 0,
    47,
    "Expected the remaining stack to preserve only the original unreprocessable leftovers",
  );
});

test("reprocessing execution removes input, grants outputs, and debits the wallet by the quoted tax", async (t) => {
  refreshReprocessingStaticData();
  const originalItems = cloneValue(readTable("items"));
  const originalCharacters = cloneValue(readTable("characters"));
  t.after(() => {
    writeTable("items", originalItems);
    writeTable("characters", originalCharacters);
    resetInventoryStoreForTests();
  });

  const candidate = getDockedCandidate();
  const session = buildSession(candidate.characterID);
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const items = cloneValue(readTable("items"));
  const itemID = nextSyntheticItemID(items);
  createInventoryItem(
    items,
    itemID,
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    1230,
    200,
  );
  writeTable("items", items);
  resetInventoryStoreForTests();

  const contextResult = resolveReprocessingContext(session);
  assert.equal(contextResult.success, true);
  const quote = buildReprocessingQuoteForItem(findItemById(itemID), contextResult.data);
  assert.ok(quote && quote.totalISKCost >= 0, "Expected a valid quote before execution");

  const beforeCharacter = getCharacterRecord(candidate.characterID);
  const service = new ReprocessingService();
  const response = service.Handle_Reprocess([
    { type: "list", items: [itemID] },
    candidate.stationID,
    candidate.characterID,
    null,
    null,
  ], session);

  const processedItemIDs = unwrapMarshalValue(response[0]);
  const outputByTypeID = unwrapMarshalValue(response[1]);
  assert.deepEqual(processedItemIDs, [itemID]);
  assert.ok(sumOutputByTypeID(outputByTypeID) > 0, "Expected reprocessing outputs to be returned");
  assert.equal(findItemById(itemID), null, "Expected the input ore stack to be consumed");

  const afterCharacter = getCharacterRecord(candidate.characterID);
  const expectedBalance = Number(beforeCharacter.balance || 0) - Number(quote.totalISKCost || 0);
  assert.equal(
    Number(afterCharacter.balance || 0),
    Number(expectedBalance.toFixed(2)),
    "Expected the character wallet to be debited by the quoted tax amount",
  );

  const hangarOutputs = listOwnedItems(candidate.characterID, {
    locationID: candidate.stationID,
    flagID: ITEM_FLAGS.HANGAR,
  }).filter((item) => Object.prototype.hasOwnProperty.call(outputByTypeID, String(item.typeID)));
  assert.ok(hangarOutputs.length > 0, "Expected mineral outputs to be granted into the station hangar");
});

test("reprocessing execution surfaces retail NotEnoughMoney arguments when tax cannot be paid", async (t) => {
  refreshReprocessingStaticData();
  const originalItems = cloneValue(readTable("items"));
  const originalCharacters = cloneValue(readTable("characters"));
  t.after(() => {
    writeTable("items", originalItems);
    writeTable("characters", originalCharacters);
    resetInventoryStoreForTests();
  });

  const candidate = getDockedCandidate();
  const session = buildSession(candidate.characterID);
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const items = cloneValue(readTable("items"));
  const itemID = nextSyntheticItemID(items);
  createInventoryItem(
    items,
    itemID,
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    1230,
    200,
  );
  writeTable("items", items);
  resetInventoryStoreForTests();

  const contextResult = resolveReprocessingContext(session);
  assert.equal(contextResult.success, true);
  const quote = buildReprocessingQuoteForItem(findItemById(itemID), contextResult.data);
  assert.ok(
    quote && quote.totalISKCost > 0,
    "Expected a taxed quote before the insufficient funds check",
  );

  setCharacterBalance(candidate.characterID, 0, {
    description: "Reprocessing insufficient funds parity setup",
  });

  const service = new ReprocessingService();
  const error = captureThrownError(() =>
    service.Handle_Reprocess([
      { type: "list", items: [itemID] },
      candidate.stationID,
      candidate.characterID,
      null,
      null,
    ], session),
  );

  assert.equal(getWrappedUserErrorMessage(error), "NotEnoughMoney");
  assert.equal(
    Number(getWrappedUserErrorDict(error).balance || 0),
    0,
    "Expected the current wallet balance to be present in the retail error payload",
  );
  assert.ok(
    Number(getWrappedUserErrorDict(error).amount || 0) > 0,
    "Expected the required reprocessing tax to be present in the retail error payload",
  );
  assert.equal(
    Number(getCharacterWallet(candidate.characterID).balance || 0),
    0,
    "Expected failed reprocessing to leave the wallet unchanged",
  );
});

test("reprocessing execution rejects the active ship with the retail user error", async () => {
  const candidate = getDockedCandidate();
  const session = buildSession(candidate.characterID);
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const service = new ReprocessingService();
  assert.throws(
    () => service.Handle_Reprocess([
      { type: "list", items: [candidate.shipID] },
      candidate.stationID,
      candidate.characterID,
      null,
      null,
    ], session),
    (error) => {
      const payload = error && error.machoErrorResponse && error.machoErrorResponse.payload;
      const message =
        payload &&
        Array.isArray(payload.header) &&
        Array.isArray(payload.header[1]) &&
        payload.header[1][0];
      return message === "CannotReprocessActive";
    },
  );
});

test("reprocessing execution can route output into a corporation office division", async (t) => {
  refreshReprocessingStaticData();
  const originalItems = cloneValue(readTable("items"));
  const originalCharacters = cloneValue(readTable("characters"));
  const originalCorporationRuntime = cloneValue(readTable("corporationRuntime"));
  t.after(() => {
    writeTable("items", originalItems);
    writeTable("characters", originalCharacters);
    writeTable("corporationRuntime", originalCorporationRuntime);
    resetInventoryStoreForTests();
  });

  const candidate = getDockedCandidate();
  const session = buildSession(candidate.characterID);
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  session.corprole = ROLE_FACTORY_MANAGER;
  session.rolesAtAll = ROLE_FACTORY_MANAGER;
  session.rolesAtOther = ROLE_FACTORY_MANAGER;
  session.rolesAtBase = ROLE_FACTORY_MANAGER;
  session.rolesAtHQ = ROLE_FACTORY_MANAGER;

  const officeService = new OfficeManagerService();
  officeService.Handle_RentOffice([candidate.stationID], session);
  const corporationRuntime = readTable("corporationRuntime");
  const offices = Object.values(
    (corporationRuntime.corporations &&
      corporationRuntime.corporations[String(candidate.corporationID)] &&
      corporationRuntime.corporations[String(candidate.corporationID)].offices) ||
      {},
  );
  assert.ok(offices.length > 0, "Expected a corporation office to exist after rental");
  const office = offices.find((entry) => Number(entry.stationID) === candidate.stationID) || offices[0];

  const items = cloneValue(readTable("items"));
  const itemID = nextSyntheticItemID(items);
  createInventoryItem(
    items,
    itemID,
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    1230,
    200,
  );
  writeTable("items", items);
  resetInventoryStoreForTests();

  const beforeCorpDivision = listOwnedItems(candidate.corporationID, {
    locationID: Number(office.officeID) || 0,
    flagID: CORP_HANGAR_1,
  }).reduce((sum, item) => sum + (Number(item.stacksize || item.quantity) || 0), 0);

  const service = new ReprocessingService();
  const response = service.Handle_Reprocess([
    { type: "list", items: [itemID] },
    candidate.stationID,
    candidate.corporationID,
    Number(office.officeID) || 0,
    CORP_HANGAR_1,
  ], session);

  const outputByTypeID = unwrapMarshalValue(response[1]);
  assert.ok(sumOutputByTypeID(outputByTypeID) > 0, "Expected corp-routed output to be produced");

  const afterCorpDivision = listOwnedItems(candidate.corporationID, {
    locationID: Number(office.officeID) || 0,
    flagID: CORP_HANGAR_1,
  }).reduce((sum, item) => sum + (Number(item.stacksize || item.quantity) || 0), 0);
  assert.ok(afterCorpDivision > beforeCorpDivision, "Expected corp-owned output stacks in the selected office division");
});

test("reprocessing execution batches mixed source locations so personal and corp defaults stay on their own output targets", async (t) => {
  refreshReprocessingStaticData();
  const originalItems = cloneValue(readTable("items"));
  const originalCharacters = cloneValue(readTable("characters"));
  const originalCorporationRuntime = cloneValue(readTable("corporationRuntime"));
  t.after(() => {
    writeTable("items", originalItems);
    writeTable("characters", originalCharacters);
    writeTable("corporationRuntime", originalCorporationRuntime);
    resetInventoryStoreForTests();
  });

  const candidate = getDockedCandidate();
  const session = buildSession(candidate.characterID);
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  session.corprole = ROLE_FACTORY_MANAGER;
  session.rolesAtAll = ROLE_FACTORY_MANAGER;
  session.rolesAtOther = ROLE_FACTORY_MANAGER;
  session.rolesAtBase = ROLE_FACTORY_MANAGER;
  session.rolesAtHQ = ROLE_FACTORY_MANAGER;

  const officeService = new OfficeManagerService();
  officeService.Handle_RentOffice([candidate.stationID], session);
  const corporationRuntime = readTable("corporationRuntime");
  const offices = Object.values(
    (corporationRuntime.corporations &&
      corporationRuntime.corporations[String(candidate.corporationID)] &&
      corporationRuntime.corporations[String(candidate.corporationID)].offices) ||
      {},
  );
  assert.ok(offices.length > 0, "Expected a corporation office to exist after rental");
  const office = offices.find((entry) => Number(entry.stationID) === candidate.stationID) || offices[0];
  const officeID = Number(office.officeID) || 0;
  assert.ok(officeID > 0, "Expected a valid office inventory ID");

  const items = cloneValue(readTable("items"));
  const personalItemID = nextSyntheticItemID(items);
  const corpItemID = personalItemID + 1;
  createInventoryItem(
    items,
    personalItemID,
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    1230,
    200,
  );
  createInventoryItem(
    items,
    corpItemID,
    candidate.corporationID,
    officeID,
    CORP_HANGAR_1,
    1230,
    200,
  );
  writeTable("items", items);
  resetInventoryStoreForTests();

  const beforePersonal = listOwnedItems(candidate.characterID, {
    locationID: candidate.stationID,
    flagID: ITEM_FLAGS.HANGAR,
  }).reduce((sum, item) => sum + (Number(item.stacksize || item.quantity) || 0), 0);
  const beforeCorp = listOwnedItems(candidate.corporationID, {
    locationID: officeID,
    flagID: CORP_HANGAR_1,
  }).reduce((sum, item) => sum + (Number(item.stacksize || item.quantity) || 0), 0);

  const service = new ReprocessingService();
  const response = service.Handle_Reprocess([
    { type: "list", items: [corpItemID, personalItemID] },
    0,
    0,
    null,
    null,
  ], session);

  const processedItemIDs = unwrapMarshalValue(response[0]);
  const outputByTypeID = unwrapMarshalValue(response[1]);
  assert.deepEqual(processedItemIDs, [corpItemID, personalItemID]);
  assert.ok(sumOutputByTypeID(outputByTypeID) > 0, "Expected aggregated output across both source batches");
  const personalRecordAfter = findItemById(personalItemID);
  const corpRecordAfter = findItemById(corpItemID);
  assert.ok(
    !personalRecordAfter || Number(personalRecordAfter.typeID) !== 1230,
    "Expected the personal ore input stack to be consumed",
  );
  assert.ok(
    !corpRecordAfter || Number(corpRecordAfter.typeID) !== 1230,
    "Expected the corp ore input stack to be consumed",
  );

  const afterPersonal = listOwnedItems(candidate.characterID, {
    locationID: candidate.stationID,
    flagID: ITEM_FLAGS.HANGAR,
  }).reduce((sum, item) => sum + (Number(item.stacksize || item.quantity) || 0), 0);
  const afterCorp = listOwnedItems(candidate.corporationID, {
    locationID: officeID,
    flagID: CORP_HANGAR_1,
  }).reduce((sum, item) => sum + (Number(item.stacksize || item.quantity) || 0), 0);
  assert.ok(afterPersonal > beforePersonal, "Expected personal output to stay in the personal hangar");
  assert.ok(afterCorp > beforeCorp, "Expected corp output to stay in the corp division");
});

test("randomized-output quotes expose empty normal recoverables but still carry batch counts and ISK cost", async (t) => {
  refreshReprocessingStaticData();
  const originalItems = cloneValue(readTable("items"));
  t.after(() => {
    writeTable("items", originalItems);
    resetInventoryStoreForTests();
  });

  const candidate = getDockedCandidate();
  const session = buildSession(candidate.characterID);
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const items = cloneValue(readTable("items"));
  const itemID = nextSyntheticItemID(items);
  const randomizedTypeID = 90041; // Prismaticite
  const randomizedTypeRecord = findItemById(itemID) || null;
  const portionSize = 1_000;
  createInventoryItem(
    items,
    itemID,
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    randomizedTypeID,
    portionSize,
  );
  writeTable("items", items);
  resetInventoryStoreForTests();

  const service = new ReprocessingService();
  const response = service.Handle_GetQuotes([
    {
      type: "dict",
      entries: [[itemID, buildInventoryItemRow(findItemById(itemID))]],
    },
    candidate.shipID,
  ], session);

  const quote = getQuoteEntryValue(response, itemID);
  assert.ok(quote, "Expected a randomized-output quote");
  assert.equal(Array.isArray(quote.recoverables), true);
  assert.equal(quote.recoverables.length, 0, "Expected retail-style empty normal recoverables for randomized preview");
  assert.ok(Number(quote.numPortions) > 0, "Expected batch count for randomized preview");
  assert.ok(Number(quote.totalISKCost) >= 0, "Expected preview ISK cost for randomized output");
});

test("structure quotes use the cached refinery rig and security-band modifiers with exact gas bonus parity", async (t) => {
  refreshReprocessingStaticData();
  const originalFacilityState = cloneValue(readTable(REPROCESSING_FACILITY_STATE_TABLE));
  t.after(() => {
    writeTable(REPROCESSING_FACILITY_STATE_TABLE, originalFacilityState);
    resetReprocessingFacilityStateCacheForTests();
  });

  const lowsecSystemID = getSolarSystemIDForSecurityBand("low");
  const highsecSystemID = getSolarSystemIDForSecurityBand("high");
  const tataraContext = {
    dockedKind: "structure",
    dockedLocationID: 990000101,
    stationRecord: {
      stationTypeID: 35836,
      solarSystemID: lowsecSystemID,
      security: 0.2,
    },
    structure: {
      typeID: 35836,
      solarSystemID: lowsecSystemID,
    },
    skillMap: new Map(),
    implants: [],
    standing: 0,
  };

  assertApproxEqual(
    getStationEfficiencyForTypeID(tataraContext, 1230),
    0.5 * 1.055,
    1e-9,
    "Expected Tatara ore baseline to use the 5.5% refinery bonus over the 50% base",
  );

  const rigSaveResult = setReprocessingFacilityRigTypeIDs(990000101, [46640]);
  assert.equal(rigSaveResult.success, true);
  resetReprocessingFacilityStateCacheForTests();
  assertApproxEqual(
    getStationEfficiencyForTypeID(tataraContext, 1230),
    0.53 * 1.06 * 1.055,
    1e-9,
    "Expected Tatara lowsec ore yield to use the authored L-Set monitor II lowsec modifier then the refinery bonus",
  );
  assertApproxEqual(
    getStructureGasDecompressionEfficiency(tataraContext),
    0.9,
    1e-9,
    "Expected Tatara gas decompression to use the authored 0.8 base + 0.10 refinery bonus",
  );

  const athanorContext = {
    dockedKind: "structure",
    dockedLocationID: 990000102,
    stationRecord: {
      stationTypeID: 35835,
      solarSystemID: highsecSystemID,
      security: 0.9,
    },
    structure: {
      typeID: 35835,
      solarSystemID: highsecSystemID,
    },
    skillMap: new Map(),
    implants: [],
    standing: 0,
  };
  assertApproxEqual(
    getStructureGasDecompressionEfficiency(athanorContext),
    0.84,
    1e-9,
    "Expected Athanor gas decompression to use the authored 0.8 base + 0.04 refinery bonus",
  );
});

test("GetReprocessingInfo returns the live standing value instead of a placeholder zero", async (t) => {
  refreshReprocessingStaticData();
  const originalCharacters = cloneValue(readTable("characters"));
  t.after(() => {
    writeTable("characters", originalCharacters);
    clearStandingRuntimeCaches();
  });

  const candidate = getDockedCandidate();
  const session = buildSession(candidate.characterID);
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const contextResult = resolveReprocessingContext(session);
  assert.equal(contextResult.success, true);
  const ownerID = Number(contextResult.data.stationRecord && contextResult.data.stationRecord.ownerID) || 0;
  assert.ok(ownerID > 0, "Expected a valid reprocessing owner for the docked location");

  const characters = cloneValue(readTable("characters"));
  characters[String(candidate.characterID)].standingData = {
    char: [
      {
        fromID: candidate.characterID,
        toID: ownerID,
        standing: 5.5,
      },
    ],
    corp: [],
    npc: [],
  };
  writeTable("characters", characters);
  clearStandingRuntimeCaches();

  const service = new ReprocessingService();
  const response = unwrapMarshalValue(service.Handle_GetReprocessingInfo([], session));
  assertApproxEqual(Number(response.standing) || 0, 5.5, 1e-9);
});

test("reprocessing execution emits the proto-shaped Reprocessed notice payload", async (t) => {
  refreshReprocessingStaticData();
  const originalItems = cloneValue(readTable("items"));
  t.after(() => {
    writeTable("items", originalItems);
    resetInventoryStoreForTests();
  });

  const candidate = getDockedCandidate();
  const session = buildSession(candidate.characterID);
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const items = cloneValue(readTable("items"));
  const itemID = nextSyntheticItemID(items);
  createInventoryItem(
    items,
    itemID,
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    1230,
    200,
  );
  writeTable("items", items);
  resetInventoryStoreForTests();

  const publishedNotices = [];
  const { reprocessItems } = require(path.join(
    repoRoot,
    "server/src/services/reprocessing",
  ));
  const result = reprocessItems(session, {
    itemIDs: [itemID],
    fromLocationID: candidate.stationID,
    publishGatewayNotice(noticeTypeName, payload, targetGroup) {
      publishedNotices.push({ noticeTypeName, payload, targetGroup });
    },
  });

  assert.equal(result.success, true);
  assert.equal(publishedNotices.length, 1, "Expected one Reprocessed notice");
  assert.equal(publishedNotices[0].noticeTypeName, "eve.industry.reprocess.api.Reprocessed");
  assert.deepEqual(publishedNotices[0].targetGroup, {
    character: candidate.characterID,
  });

  const protoRoot = buildReprocessingGatewayProtoRoot();
  const noticeType = protoRoot.lookupType("eve.industry.reprocess.api.Reprocessed");
  const decoded = noticeType.toObject(noticeType.decode(publishedNotices[0].payload), {
    longs: Number,
  });
  assert.equal(Number(decoded.character && decoded.character.sequential) || 0, candidate.characterID);
  assert.equal(Number(decoded.station && decoded.station.sequential) || 0, candidate.stationID);
  assert.equal(Number(decoded.input_type && decoded.input_type.sequential) || 0, 1230);
  assert.equal(Number(decoded.quantity) || 0, 200);
  assert.ok(Array.isArray(decoded.outputs) && decoded.outputs.length > 0, "Expected mineral outputs in the notice payload");
});

test("reprocessing client randomized authority is present and records current probability availability honestly", async () => {
  const clientRandomizedPayload = readTable("reprocessingClientRandomizedMaterials");
  const staticPayload = readTable("reprocessingStatic");

  assert.ok(clientRandomizedPayload, "Expected client randomized materials authority payload");
  assert.ok(
    Array.isArray(clientRandomizedPayload.types) &&
      clientRandomizedPayload.types.length > 0,
    "Expected randomized material rows exported from the packaged client",
  );
  const prismaticite = clientRandomizedPayload.types.find(
    (row) => Number(row && row.typeID) === 90041,
  );
  assert.ok(prismaticite, "Expected Prismaticite randomized rows in client authority");
  assert.ok(
    Array.isArray(prismaticite.randomizedMaterials) &&
      prismaticite.randomizedMaterials.length > 1,
    "Expected multi-output randomized materials for Prismaticite",
  );
  assert.equal(
    prismaticite.randomizedMaterials.every(
      (entry) => entry.relativeProbability === null,
    ),
    true,
    "Expected the packaged client build to omit explicit relativeProbability on Prismaticite rows",
  );

  assert.ok(
    staticPayload &&
      staticPayload.source &&
      staticPayload.source.clientRandomizedMaterials,
    "Expected reprocessing static cache metadata to record client randomized authority",
  );
  assert.equal(
    Number(staticPayload.source.clientRandomizedMaterials.randomizedTypeCount) > 0,
    true,
  );
  assert.equal(
    Number(staticPayload.source.clientRandomizedMaterials.relativeProbabilityEntryCount),
    0,
    "Expected the current packaged client build to expose no explicit randomized probabilities",
  );
  assert.match(
    String(staticPayload.source.randomizedChoiceMode || ""),
    /do not expose relativeProbability/i,
  );
});

test("/reprocesssmoke seeds, quotes, and runs against the real reprocessing path", async (t) => {
  refreshReprocessingStaticData();
  const originalItems = cloneValue(readTable("items"));
  const originalCharacters = cloneValue(readTable("characters"));
  t.after(() => {
    writeTable("items", originalItems);
    writeTable("characters", originalCharacters);
    resetInventoryStoreForTests();
  });

  const candidate = getDockedCandidate();
  const session = buildSession(candidate.characterID);
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const seedResult = chatCommands.executeChatCommand(
    session,
    "/reprocesssmoke seed",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(seedResult.handled, true);
  assert.match(seedResult.message, /Seeded \d+ reprocessing sample stacks/i);

  const quoteResult = chatCommands.executeChatCommand(
    session,
    "/reprocesssmoke quote veldspar",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(quoteResult.handled, true);
  assert.match(quoteResult.message, /station/i);
  assert.match(quoteResult.message, /tax/i);

  const runResult = chatCommands.executeChatCommand(
    session,
    "/reprocesssmoke run veldspar",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(runResult.handled, true);
  assert.match(runResult.message, /input stack processed/i);
  assert.match(runResult.message, /output/i);
});

test("hot reprocessing quote lookups stay comfortably sub-millisecond on the cache-backed runtime", () => {
  refreshReprocessingStaticData();
  const context = {
    dockedKind: "station",
    stationRecord: {
      reprocessingEfficiency: 0.5,
      reprocessingStationsTake: 0.05,
    },
    skillMap: new Map(),
    implants: [],
    standing: 0,
  };
  const item = {
    itemID: 910001,
    typeID: 1230,
    singleton: 0,
    quantity: 500,
    stacksize: 500,
  };

  const avgMs = measureAverageMs(() => buildReprocessingQuoteForItem(item, context));
  assert.ok(avgMs < 1, `Expected cache-backed reprocessing quotes to stay below 1ms average, got ${avgMs.toFixed(4)}ms`);
});
