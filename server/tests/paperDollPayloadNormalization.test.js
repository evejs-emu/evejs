const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  clonePaperDollPayload,
  getStoredAppearanceInfo,
} = require(path.join(
  repoRoot,
  "server/src/services/character/paperDollPayloads",
));

test("clonePaperDollPayload normalizes sculpting rows with null weights", () => {
  const payload = {
    type: "object",
    name: "utillib.KeyVal",
    args: {
      type: "dict",
      entries: [
        [
          "sculpts",
          {
            type: "list",
            items: [
              {
                type: "objectex2",
                header: [
                  [
                    {
                      type: "token",
                      value: "eve.common.script.paperDoll.paperDollDefinitions.SculptingRow",
                    },
                    8,
                    null,
                    -0.3169,
                    null,
                  ],
                ],
                list: [],
                dict: [],
              },
            ],
          },
        ],
      ],
    },
  };

  const normalized = clonePaperDollPayload(payload);
  const sculptHeader = normalized.args.entries[0][1].items[0].header[0];

  assert.equal(sculptHeader[2], 0);
  assert.equal(sculptHeader[3], -0.3169);
  assert.equal(sculptHeader[4], 0);
});

test("getStoredAppearanceInfo returns normalized sculpt weights for stored records", () => {
  const appearanceInfo = {
    type: "object",
    name: "utillib.KeyVal",
    args: {
      type: "dict",
      entries: [
        [
          "sculpts",
          {
            type: "list",
            items: [
              {
                sculptLocationID: 29,
                weightUpDown: null,
                weightLeftRight: null,
                weightForwardBack: 0.2252,
              },
            ],
          },
        ],
      ],
    },
  };

  const normalized = getStoredAppearanceInfo({ appearanceInfo });
  const sculptRow = normalized.args.entries[0][1].items[0];

  assert.equal(sculptRow.weightUpDown, 0);
  assert.equal(sculptRow.weightLeftRight, 0);
  assert.equal(sculptRow.weightForwardBack, 0.2252);
});
