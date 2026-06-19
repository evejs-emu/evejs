const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
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
  getFittedModuleItems,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  updateInventoryItem,
  updateShipItem,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readItemRecord(itemID) {
  const result = database.read("items", `/${Number(itemID) || 0}`);
  assert.equal(result.success, true, `Failed to read item ${itemID}`);
  return result.data;
}

function getDockedCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters table");

  let fallback = null;
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
    if (!(numericCharacterID > 0) || !(dockedStationID > 0) || !shipItem || !shipItem.itemID) {
      continue;
    }

    const fittedModules = getFittedModuleItems(numericCharacterID, shipItem.itemID);
    const candidate = {
      characterID: numericCharacterID,
      stationID: dockedStationID,
      shipItem,
      fittedModuleID: fittedModules.length > 0 ? fittedModules[0].itemID : null,
      fittedModuleCount: fittedModules.length,
    };
    if (candidate.fittedModuleID) {
      return candidate;
    }
    if (!fallback) {
      fallback = candidate;
    }
  }

  if (fallback) {
    return fallback;
  }

  assert.fail("Expected at least one docked character with an active ship");
}

test("help command lists /dmg", () => {
  const result = executeChatCommand(null, "/help", null, {
    emitChatFeedback: false,
  });

  assert.equal(result.handled, true);
  assert.match(result.message, /\/dmg/);
});

test("/dmg damages the active docked ship and fitted modules for repair testing", () => {
  const candidate = getDockedCandidate();
  const originalShip = cloneValue(candidate.shipItem);
  const originalModule = candidate.fittedModuleID
    ? cloneValue(readItemRecord(candidate.fittedModuleID))
    : null;
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
    const pristineShipResult = updateShipItem(candidate.shipItem.itemID, (currentShip) => ({
      ...currentShip,
      conditionState: {
        ...(currentShip.conditionState || {}),
        damage: 0,
        charge: 1,
        armorDamage: 0,
        shieldCharge: 1,
      },
    }));
    assert.equal(pristineShipResult.success, true, "Failed to reset ship before /dmg");

    if (candidate.fittedModuleID) {
      const pristineModuleResult = updateInventoryItem(
        candidate.fittedModuleID,
        (currentItem) => ({
          ...currentItem,
          moduleState: {
            ...(currentItem.moduleState || {}),
            damage: 0,
            charge: 0,
            armorDamage: 0,
            shieldCharge: 1,
            incapacitated: false,
          },
        }),
      );
      assert.equal(pristineModuleResult.success, true, "Failed to reset module before /dmg");
    }

    const result = executeChatCommand(session, "/dmg", null, {
      emitChatFeedback: false,
    });

    assert.equal(result.handled, true);
    assert.equal(
      result.message,
      candidate.fittedModuleCount > 0
        ? `Applied medium test damage to your active ship and ${candidate.fittedModuleCount} fitted ${candidate.fittedModuleCount === 1 ? "module" : "modules"}.`
        : "Applied medium test damage to your active ship.",
    );

    const damagedShip = getActiveShipRecord(candidate.characterID);
    assert.ok(damagedShip, "Expected the active ship to remain available after /dmg");
    assert.equal(damagedShip.conditionState.damage, 0.2);
    assert.equal(damagedShip.conditionState.charge, 0.35);
    assert.equal(damagedShip.conditionState.armorDamage, 0.35);
    assert.equal(damagedShip.conditionState.shieldCharge, 0.45);

    if (candidate.fittedModuleID) {
      const damagedModule = readItemRecord(candidate.fittedModuleID);
      assert.equal(damagedModule.moduleState.damage, 0.18);
      assert.equal(damagedModule.moduleState.armorDamage, 0.1);
      assert.equal(damagedModule.moduleState.shieldCharge, 0.6);
      assert.equal(damagedModule.moduleState.incapacitated, false);
    }

    assert.equal(
      session.notifications.some((entry) => entry.name === "OnItemChange"),
      true,
      "Expected /dmg to sync updated damage state back to the client",
    );
  } finally {
    const restoreShipResult = updateShipItem(
      candidate.shipItem.itemID,
      () => cloneValue(originalShip),
    );
    assert.equal(restoreShipResult.success, true, "Failed to restore ship after /dmg test");
    if (candidate.fittedModuleID && originalModule) {
      const restoreModuleResult = updateInventoryItem(
        candidate.fittedModuleID,
        () => cloneValue(originalModule),
      );
      assert.equal(
        restoreModuleResult.success,
        true,
        "Failed to restore module after /dmg test",
      );
    }
  }
});

test("/dmg asks you to dock first when used in space", () => {
  const session = {
    characterID: 140000001,
    charid: 140000001,
  };

  const result = executeChatCommand(session, "/dmg", null, {
    emitChatFeedback: false,
  });

  assert.equal(result.handled, true);
  assert.equal(
    result.message,
    "Dock first before using /dmg so the repair flow stays easy to test.",
  );
});
