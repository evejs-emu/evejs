const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const OverviewPresetMgrService = require(path.join(
  repoRoot,
  "server/src/services/overview/overviewPresetMgrService",
));

const tablePath = path.join(
  repoRoot,
  "server/src/newDatabase/data/overviewSharedPresets/data.json",
);

function restoreOriginalTable(originalRaw, originalData) {
  database.write("overviewSharedPresets", "/", originalData, { force: true });
  database.flushAllSync();
  fs.writeFileSync(tablePath, originalRaw, "utf8");
}

test("overviewPresetMgr stores shared presets and returns them by preset key", (t) => {
  const originalRaw = fs.readFileSync(tablePath, "utf8");
  const originalData = JSON.parse(originalRaw);

  t.after(() => {
    restoreOriginalTable(originalRaw, originalData);
  });

  database.write(
    "overviewSharedPresets",
    "/",
    {
      nextSqID: 1,
      entries: {},
      hashIndex: {},
    },
    { force: true },
  );

  const service = new OverviewPresetMgrService();
  const payload = {
    tabSetup: [
      [0, [["name", "General"], ["overview", "DefaultPreset_1"]]],
    ],
    presets: [],
    flagStates: [9, 10, 11],
  };

  const presetKeyVal = service.Handle_StoreLinkAndGetID([payload], {
    characterID: 140000001,
  });

  assert.equal(presetKeyVal.type, "object");
  assert.equal(presetKeyVal.name, "util.KeyVal");
  const keyEntries = Object.fromEntries(presetKeyVal.args.entries);
  assert.match(keyEntries.hashvalue, /^[0-9a-f]{40}$/);
  assert.equal(keyEntries.sqID, 1);

  const stored = service.Handle_GetStoredPreset([
    [keyEntries.hashvalue, keyEntries.sqID],
  ]);
  assert.equal(typeof stored, "string");

  const decoded = JSON.parse(stored);
  assert.deepEqual(decoded, [
    ["flagStates", [9, 10, 11]],
    ["presets", []],
    ["tabSetup", [[0, [["name", "General"], ["overview", "DefaultPreset_1"]]]]],
  ]);
});

test("overviewPresetMgr unwraps marshal-shaped overview payloads into client-loadable shared data", (t) => {
  const originalRaw = fs.readFileSync(tablePath, "utf8");
  const originalData = JSON.parse(originalRaw);

  t.after(() => {
    restoreOriginalTable(originalRaw, originalData);
  });

  database.write(
    "overviewSharedPresets",
    "/",
    {
      nextSqID: 1,
      entries: {},
      hashIndex: {},
    },
    { force: true },
  );

  const service = new OverviewPresetMgrService();
  const payload = {
    type: "dict",
    entries: [
      [
        "tabSetup",
        {
          type: "list",
          items: [
            {
              type: "tuple",
              items: [
                0,
                {
                  type: "list",
                  items: [
                    {
                      type: "tuple",
                      items: ["name", "General"],
                    },
                    {
                      type: "tuple",
                      items: ["overview", "DefaultPreset_1"],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      ["presets", { type: "list", items: [] }],
      ["flagStates", { type: "list", items: [9, 10, 11] }],
    ],
  };

  const presetKeyVal = service.Handle_StoreLinkAndGetID([payload], {
    characterID: 140000001,
  });
  const keyEntries = Object.fromEntries(presetKeyVal.args.entries);

  const stored = service.Handle_GetStoredPreset([
    [keyEntries.hashvalue, keyEntries.sqID],
  ]);
  const decoded = JSON.parse(stored);

  assert.deepEqual(decoded, [
    ["flagStates", [9, 10, 11]],
    ["presets", []],
    ["tabSetup", [[0, [["name", "General"], ["overview", "DefaultPreset_1"]]]]],
  ]);
});

test("overviewPresetMgr reuses the same preset key for identical payloads", (t) => {
  const originalRaw = fs.readFileSync(tablePath, "utf8");
  const originalData = JSON.parse(originalRaw);

  t.after(() => {
    restoreOriginalTable(originalRaw, originalData);
  });

  database.write(
    "overviewSharedPresets",
    "/",
    {
      nextSqID: 1,
      entries: {},
      hashIndex: {},
    },
    { force: true },
  );

  const service = new OverviewPresetMgrService();
  const payload = {
    overviewColumns: ["ICON", "DISTANCE"],
  };

  const first = service.Handle_StoreLinkAndGetID([payload], {
    characterID: 140000001,
  });
  const second = service.Handle_StoreLinkAndGetID([payload], {
    characterID: 140000002,
  });

  assert.deepEqual(first.args.entries, second.args.entries);
});

test("overviewPresetMgr converts exported overview yaml into client-loadable shared data for server-owned MOTD links", (t) => {
  const originalRaw = fs.readFileSync(tablePath, "utf8");
  const originalData = JSON.parse(originalRaw);

  t.after(() => {
    restoreOriginalTable(originalRaw, originalData);
  });

  database.write(
    "overviewSharedPresets",
    "/",
    {
      nextSqID: 1,
      entries: {},
      hashIndex: {},
    },
    { force: true },
  );

  const service = new OverviewPresetMgrService();
  const rawYaml = [
    "backgroundOrder:",
    "- 11",
    "presets:",
    "- - GeneralPreset",
    "  - - - groups",
    "      - - 6",
    "tabSetup:",
    "- - 0",
    "  - - - name",
    "      - General",
    "",
  ].join("\n");

  const storedEntry = service.storeRawPresetString(rawYaml, {
    source: "server_motd_bootstrap",
    sourcePath: "C:\\Users\\Player\\Documents\\EVE\\Overview\\example.yaml",
  });

  assert.equal(storedEntry.hashvalue.length, 40);
  assert.equal(storedEntry.sqID, 1);

  const stored = service.Handle_GetStoredPreset([
    [storedEntry.hashvalue, storedEntry.sqID],
  ]);
  const decoded = JSON.parse(stored);

  assert.deepEqual(decoded, [
    ["backgroundOrder", [11]],
    ["presets", [["GeneralPreset", [["groups", [6]]]]]],
    ["tabSetup", [[0, [["name", "General"]]]]],
  ]);
});

test("overviewPresetMgr repairs legacy shared overview payloads saved in marshal-wrapper form", (t) => {
  const originalRaw = fs.readFileSync(tablePath, "utf8");
  const originalData = JSON.parse(originalRaw);

  t.after(() => {
    restoreOriginalTable(originalRaw, originalData);
  });

  const legacyPayloadString = JSON.stringify([
    [
      "entries",
      [
        ["tabSetup", [[0, [["name", "General"], ["overview", "DefaultPreset_1"]]]]],
        ["presets", []],
        ["flagStates", [9, 10, 11]],
      ],
    ],
    ["type", "dict"],
  ]);

  database.write(
    "overviewSharedPresets",
    "/",
    {
      nextSqID: 2,
      entries: {
        "legacyhash::1": {
          hashvalue: "legacyhash",
          sqID: 1,
          payload: legacyPayloadString,
          ownerID: 140000001,
          createdAt: 1,
        },
      },
      hashIndex: {
        legacyhash: [1],
      },
    },
    { force: true },
  );

  const service = new OverviewPresetMgrService();
  const state = service._getState();
  const repairedEntry = Object.values(state.entries)[0];

  assert.equal(repairedEntry.sqID, 1);
  assert.equal(repairedEntry.hashvalue, "legacyhash");

  const stored = service.Handle_GetStoredPreset([
    ["legacyhash", repairedEntry.sqID],
  ]);
  const decoded = JSON.parse(stored);

  assert.deepEqual(decoded, [
    ["flagStates", [9, 10, 11]],
    ["presets", []],
    ["tabSetup", [[0, [["name", "General"], ["overview", "DefaultPreset_1"]]]]],
  ]);
});

test("overviewPresetMgr repairs exported overview yaml already persisted in mapping form and reuses the same preset key", (t) => {
  const originalRaw = fs.readFileSync(tablePath, "utf8");
  const originalData = JSON.parse(originalRaw);

  t.after(() => {
    restoreOriginalTable(originalRaw, originalData);
  });

  const rawYaml = [
    "backgroundOrder:",
    "- 11",
    "presets:",
    "- - GeneralPreset",
    "  - - - groups",
    "      - - 6",
    "tabSetup:",
    "- - 0",
    "  - - - name",
    "      - General",
    "",
  ].join("\n");

  database.write(
    "overviewSharedPresets",
    "/",
    {
      nextSqID: 2,
      entries: {
        "legacyyaml::1": {
          hashvalue: "legacyyaml",
          sqID: 1,
          payload: rawYaml,
          ownerID: 0,
          createdAt: 1,
          source: "server_motd_bootstrap",
        },
      },
      hashIndex: {
        legacyyaml: [1],
      },
    },
    { force: true },
  );

  const service = new OverviewPresetMgrService();
  const storedEntry = service.storeRawPresetString(rawYaml, {
    source: "server_motd_bootstrap",
    sourcePath: "C:\\Users\\Player\\Documents\\EVE\\Overview\\example.yaml",
  });

  assert.equal(storedEntry.hashvalue, "legacyyaml");
  assert.equal(storedEntry.sqID, 1);

  const stored = service.Handle_GetStoredPreset([["legacyyaml", 1]]);
  const decoded = JSON.parse(stored);
  assert.deepEqual(decoded, [
    ["backgroundOrder", [11]],
    ["presets", [["GeneralPreset", [["groups", [6]]]]]],
    ["tabSetup", [[0, [["name", "General"]]]]],
  ]);

  const persisted = database.read("overviewSharedPresets", "/");
  assert.equal(persisted.success, true);
  assert.equal(
    persisted.data.entries["legacyyaml::1"].payload,
    JSON.stringify([
      ["backgroundOrder", [11]],
      ["presets", [["GeneralPreset", [["groups", [6]]]]]],
      ["tabSetup", [[0, [["name", "General"]]]]],
    ]),
  );
  assert.equal(
    persisted.data.entries["legacyyaml::1"].sourcePath,
    "C:\\Users\\Player\\Documents\\EVE\\Overview\\example.yaml",
  );
});
