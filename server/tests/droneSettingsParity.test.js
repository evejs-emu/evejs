const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const {
  getAttributeIDByNames,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));

const ATTRIBUTE_DRONE_IS_AGGRESSIVE =
  getAttributeIDByNames("droneIsAggressive") || 1275;
const ATTRIBUTE_DRONE_FOCUS_FIRE =
  getAttributeIDByNames("droneFocusFire") || 1297;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getTestCharacterID() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters table");

  const characterID = Object.keys(charactersResult.data || {})
    .map((value) => Number(value) || 0)
    .find((value) => value > 0);
  assert.ok(characterID, "Expected at least one character record");
  return characterID;
}

function getDictEntries(value) {
  return value && value.type === "dict" && Array.isArray(value.entries)
    ? value.entries
    : [];
}

function toEntryMap(value) {
  return new Map(
    getDictEntries(value).map(([key, entryValue]) => [Number(key) || 0, entryValue]),
  );
}

test("ChangeDroneSettings persists the client-owned aggression and focus-fire attributes", () => {
  const characterID = getTestCharacterID();
  const originalRecordResult = database.read("characters", `/${characterID}`);
  assert.equal(originalRecordResult.success, true, "Failed to read original character record");
  const originalRecord = cloneValue(originalRecordResult.data);
  const service = new DogmaService();
  const session = {
    characterID,
    charid: characterID,
    userid: characterID,
  };

  try {
    const result = service.Handle_ChangeDroneSettings([
      {
        type: "dict",
        entries: [
          [ATTRIBUTE_DRONE_IS_AGGRESSIVE, true],
          [ATTRIBUTE_DRONE_FOCUS_FIRE, false],
          [999999, true],
        ],
      },
    ], session);

    const resultEntries = toEntryMap(result);
    assert.equal(resultEntries.get(ATTRIBUTE_DRONE_IS_AGGRESSIVE), true);
    assert.equal(resultEntries.get(ATTRIBUTE_DRONE_FOCUS_FIRE), false);
    assert.equal(resultEntries.has(999999), false);

    const updatedRecordResult = database.read("characters", `/${characterID}`);
    assert.equal(updatedRecordResult.success, true, "Failed to read updated character record");
    assert.equal(
      updatedRecordResult.data.droneSettings[ATTRIBUTE_DRONE_IS_AGGRESSIVE],
      true,
    );
    assert.equal(
      updatedRecordResult.data.droneSettings[ATTRIBUTE_DRONE_FOCUS_FIRE],
      false,
    );

    const persisted = service.Handle_GetDroneSettingAttributes([], session);
    const persistedEntries = toEntryMap(persisted);
    assert.equal(persistedEntries.get(ATTRIBUTE_DRONE_IS_AGGRESSIVE), true);
    assert.equal(persistedEntries.get(ATTRIBUTE_DRONE_FOCUS_FIRE), false);
  } finally {
    const restoreResult = database.write(
      "characters",
      `/${characterID}`,
      originalRecord,
      { silent: true },
    );
    assert.equal(restoreResult.success, true, "Failed to restore original character record");
  }
});
