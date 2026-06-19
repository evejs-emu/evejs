const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const worldData = require(path.join(repoRoot, "server/src/space/worldData"));
const {
  executeChatCommand,
} = require(path.join(
  repoRoot,
  "server/src/services/chat/chatCommands",
));
const {
  getActiveShipRecord,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  updateShipItem,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDockedCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters table");

  for (const characterID of Object.keys(charactersResult.data || {})) {
    const numericCharacterID = Number(characterID) || 0;
    const record = charactersResult.data[characterID] || {};
    const authoritativeRecord = getCharacterRecord(numericCharacterID) || record;
    const shipItem = getActiveShipRecord(numericCharacterID);
    const stationID = Number(record.stationID || record.stationid || 0) || 0;
    const resolvedStationID =
      stationID ||
      Number(authoritativeRecord.stationID || authoritativeRecord.stationid || 0) ||
      0;
    const shipLocationStationID =
      shipItem && worldData.getStationByID(shipItem.locationID)
        ? Number(shipItem.locationID) || 0
        : 0;
    const dockedStationID = resolvedStationID || shipLocationStationID;
    if (numericCharacterID > 0 && dockedStationID > 0 && shipItem && shipItem.itemID) {
      return {
        characterID: numericCharacterID,
        stationID: dockedStationID,
        shipItem,
      };
    }
  }

  assert.fail("Expected at least one docked character with an active ship");
}

test("help command lists /heal", () => {
  const result = executeChatCommand(null, "/help", null, {
    emitChatFeedback: false,
  });

  assert.equal(result.handled, true);
  assert.match(result.message, /\/heal/);
});

test("/heal delegates to the live space runtime for in-space sessions", () => {
  const originalHeal = spaceRuntime.healSessionShipResources;
  const session = {
    characterID: 140000001,
    _space: {
      systemID: 30000142,
      shipID: 900001,
    },
  };
  let called = false;

  spaceRuntime.healSessionShipResources = (targetSession, options = {}) => {
    called = true;
    assert.equal(targetSession, session);
    assert.equal(
      options.refreshOwnerDamagePresentation,
      false,
      "Expected /heal to suppress the owner SetState rebase path",
    );
    return {
      success: true,
      data: {},
    };
  };

  try {
    const result = executeChatCommand(session, "/heal", null, {
      emitChatFeedback: false,
    });

    assert.equal(result.handled, true);
    assert.equal(called, true);
    assert.equal(
      result.message,
      "Restored full shields, armor, hull, and capacitor on your active ship.",
    );
  } finally {
    spaceRuntime.healSessionShipResources = originalHeal;
  }
});

test("/heal refreshes the active docked ship through inventory sync", () => {
  const candidate = getDockedCandidate();
  const originalShip = cloneValue(candidate.shipItem);
  const session = {
    characterID: candidate.characterID,
    charid: candidate.characterID,
    stationid: candidate.stationID,
    stationID: candidate.stationID,
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
  };

  try {
    const damageResult = updateShipItem(candidate.shipItem.itemID, (currentShip) => ({
      ...currentShip,
      conditionState: {
        ...(currentShip.conditionState || {}),
        damage: 0.15,
        charge: 0.2,
        armorDamage: 0.45,
        shieldCharge: 0.3,
      },
    }));
    assert.equal(damageResult.success, true, "Failed to seed docked ship damage");

    const result = executeChatCommand(session, "/heal", null, {
      emitChatFeedback: false,
    });

    assert.equal(result.handled, true);
    assert.equal(
      result.message,
      "Restored full shields, armor, hull, and capacitor on your active ship.",
    );

    const healedShip = getActiveShipRecord(candidate.characterID);
    assert.ok(healedShip, "Expected the docked active ship to remain available");
    assert.equal(healedShip.conditionState.damage, 0);
    assert.equal(healedShip.conditionState.charge, 1);
    assert.equal(healedShip.conditionState.armorDamage, 0);
    assert.equal(healedShip.conditionState.shieldCharge, 1);
    assert.equal(
      session.notifications.some((entry) => entry.name === "OnItemChange"),
      true,
      "Expected /heal to sync the updated ship item back to the client",
    );
  } finally {
    const restoreResult = updateShipItem(
      candidate.shipItem.itemID,
      () => cloneValue(originalShip),
    );
    assert.equal(restoreResult.success, true, "Failed to restore docked ship test data");
  }
});
