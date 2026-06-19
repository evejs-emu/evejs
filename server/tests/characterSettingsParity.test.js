const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharMgrService = require(path.join(
  repoRoot,
  "server/src/services/character/charMgrService",
));
const {
  getCharacterSettings,
  setCharacterSetting,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterSettingsState",
));
const {
  marshalEncode,
} = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

test("charMgr GetCharacterSettings normalizes persisted buffer-backed mail settings into a marshal-safe string", (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data || {});

  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.flushAllSync();
  });

  const yamlString = "lists: {}\nsingleValues: {mail_blinkTab: true}\n";
  const updatedCharacters = cloneValue(originalCharacters);
  updatedCharacters["140000005"] = {
    ...updatedCharacters["140000005"],
    characterSettings: {
      ...(updatedCharacters["140000005"]?.characterSettings || {}),
      mailSettings: {
        type: "Buffer",
        data: [...Buffer.from(yamlString, "utf8")],
      },
    },
  };

  database.write("characters", "/", updatedCharacters);
  database.flushAllSync();

  const normalizedSettings = getCharacterSettings(140000005);
  assert.equal(typeof normalizedSettings.mailSettings, "string");
  assert.equal(normalizedSettings.mailSettings, yamlString);

  const persistedRead = database.read(
    "characters",
    "/140000005/characterSettings/mailSettings",
  );
  assert.equal(persistedRead.success, true);
  assert.equal(typeof persistedRead.data, "string");
  assert.equal(persistedRead.data, yamlString);

  const service = new CharMgrService();
  const payload = service.Handle_GetCharacterSettings([], {
    characterID: 140000005,
  });
  const mailSettingsEntry = payload.entries.find(([key]) => key === "mailSettings");

  assert.ok(mailSettingsEntry, "expected mailSettings entry in charMgr payload");
  assert.equal(typeof mailSettingsEntry[1], "string");
  assert.equal(mailSettingsEntry[1], yamlString);
  assert.doesNotThrow(() => marshalEncode(payload));
});

test("setCharacterSetting stores buffer-backed values as plain strings", (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data || {});

  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.flushAllSync();
  });

  const yamlString = "lists: {}\nsingleValues: {mail_showNotification: true}\n";
  const writeSucceeded = setCharacterSetting(
    140000005,
    "mailSettings",
    Buffer.from(yamlString, "utf8"),
  );

  assert.equal(writeSucceeded, true);

  const persistedRead = database.read(
    "characters",
    "/140000005/characterSettings/mailSettings",
  );
  assert.equal(persistedRead.success, true);
  assert.equal(typeof persistedRead.data, "string");
  assert.equal(persistedRead.data, yamlString);
});
