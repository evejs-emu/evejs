const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  buildItemChangePayload,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  marshalEncode,
} = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));

function extractChangeKeys(payload) {
  const changeDict = Array.isArray(payload) ? payload[1] : null;
  if (!changeDict || changeDict.type !== "dict" || !Array.isArray(changeDict.entries)) {
    return [];
  }
  return changeDict.entries
    .map((entry) => Number(Array.isArray(entry) ? entry[0] : 0) || 0)
    .filter((key) => key > 0)
    .sort((left, right) => left - right);
}

function extractRowDescriptorColumns(payload) {
  const row = Array.isArray(payload) ? payload[0] : null;
  return row &&
    row.header &&
    Array.isArray(row.header.header) &&
    Array.isArray(row.header.header[1]) &&
    Array.isArray(row.header.header[1][0])
    ? row.header.header[1][0].map((column) =>
      Array.isArray(column) ? String(column[0]) : String(column),
    )
      : [];
}

function extractRowDescriptorColumnPairs(payload) {
  const row = Array.isArray(payload) ? payload[0] : null;
  return row &&
    row.header &&
    Array.isArray(row.header.header) &&
    Array.isArray(row.header.header[1]) &&
    Array.isArray(row.header.header[1][0])
    ? row.header.header[1][0].map((column) => [
      Array.isArray(column) ? String(column[0]) : String(column),
      Array.isArray(column) ? Number(column[1]) : NaN,
    ])
    : [];
}

function extractRowDescriptorVirtualColumns(payload) {
  const row = Array.isArray(payload) ? payload[0] : null;
  return row &&
    row.header &&
    Array.isArray(row.header.header) &&
    row.header.header[2] &&
    row.header.header[2].type === "list" &&
    Array.isArray(row.header.header[2].items)
    ? row.header.header[2].items.map((column) =>
      Array.isArray(column) ? String(column[0]) : String(column),
    )
    : [];
}

function extractRowFields(payload) {
  const row = Array.isArray(payload) ? payload[0] : null;
  return row && row.fields && typeof row.fields === "object" ? row.fields : {};
}

test("stackable inventory item changes prefer ixStackSize over ixQuantity", () => {
  const payload = buildItemChangePayload(
    {
      itemID: 990001,
      typeID: 34,
      ownerID: 140000004,
      locationID: 990101212,
      flagID: 5,
      quantity: 4,
      stacksize: 4,
      singleton: 0,
      groupID: 18,
      categoryID: 8,
      customInfo: "",
    },
    {
      locationID: 990101212,
      flagID: 5,
      quantity: 5,
      stacksize: 5,
      singleton: 0,
    },
  );

  assert.deepEqual(
    extractChangeKeys(payload),
    [10],
    "Expected stackable cargo updates to advertise ixStackSize only",
  );
});

test("singleton inventory item changes still keep their non-quantity deltas", () => {
  const payload = buildItemChangePayload(
    {
      itemID: 990002,
      typeID: 594,
      ownerID: 140000004,
      locationID: 990101212,
      flagID: 27,
      quantity: -1,
      stacksize: 1,
      singleton: 1,
      groupID: 53,
      categoryID: 7,
      customInfo: "",
    },
    {
      locationID: 60003760,
      flagID: 27,
      quantity: -1,
      stacksize: 1,
      singleton: 1,
    },
  );

  assert.deepEqual(
    extractChangeKeys(payload),
    [3],
    "Expected singleton item moves to keep their location delta intact",
  );
});

test("inventory item changes marshal when locationID exceeds int32", () => {
  const payload = buildItemChangePayload(
    {
      itemID: 980400000000,
      typeID: 34,
      ownerID: 1000134,
      locationID: 980300000000,
      flagID: 4,
      quantity: 10,
      stacksize: 10,
      singleton: 0,
      groupID: 18,
      categoryID: 4,
      customInfo: "",
    },
    {
      locationID: 980300000000,
      flagID: 4,
      quantity: 12,
      stacksize: 12,
      singleton: 0,
    },
  );

  assert.doesNotThrow(
    () => marshalEncode(payload),
    "Expected large wreck-backed location IDs to marshal in item change payloads",
  );
});

test("inventory item change rows keep CCP customInfo-stacksize-singleton order and normalize singleton drone fields", () => {
  const payload = buildItemChangePayload(
    {
      itemID: 991003770,
      typeID: 2203,
      ownerID: 140000013,
      locationID: 991003768,
      flagID: 87,
      quantity: null,
      stacksize: null,
      singleton: 1,
      groupID: 100,
      categoryID: 18,
      customInfo: null,
    },
    {},
  );

  assert.deepEqual(
    extractRowDescriptorColumns(payload),
    [
      "itemID",
      "typeID",
      "ownerID",
      "locationID",
      "flagID",
      "quantity",
      "groupID",
      "categoryID",
      "customInfo",
    ],
    "Expected OnItemChange inventory rows to keep physical inventory columns DBRow-compatible",
  );
  assert.deepEqual(
    extractRowDescriptorVirtualColumns(payload),
    [
      "stacksize",
      "singleton",
    ],
    "Expected OnItemChange inventory rows to expose stacksize/singleton as CCP virtual descriptor columns",
  );
  assert.deepEqual(
    extractRowDescriptorColumnPairs(payload),
    [
      ["itemID", 20],
      ["typeID", 3],
      ["ownerID", 3],
      ["locationID", 20],
      ["flagID", 2],
      ["quantity", 3],
      ["groupID", 3],
      ["categoryID", 3],
      ["customInfo", 129],
    ],
    "Expected normal OnItemChange inventory rows to keep concrete physical DB types",
  );

  const fields = extractRowFields(payload);
  assert.equal(fields.customInfo, "");
  assert.equal(fields.quantity, -1);
  assert.equal(fields.stacksize, 1);
  assert.equal(fields.singleton, 1);
});
