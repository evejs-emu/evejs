const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const database = require(path.join(repoRoot, "server/src/newDatabase"));
const {
  currentFileTime,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/serviceHelpers",
));
const {
  ITEM_FLAGS,
  buildInventoryItem,
  grantItemToCharacterLocation,
  grantItemToCharacterStationHangar,
  listContainerItems,
  removeInventoryItem,
  updateInventoryItem,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  createKillmailRecord,
  listKillmailsForCorporation,
  resolveKillmailWarID,
  buildWarDestructionStatistics,
  KILLMAIL_TABLE,
} = require(path.join(
  repoRoot,
  "server/src/services/killmail/killmailState",
));
const {
  resolveLocationDeathOutcome,
} = require(path.join(
  repoRoot,
  "server/src/services/killmail/deathOutcomeResolver",
));
const {
  handleStructureDestroyedLoot,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureDestructionLootState",
));
const {
  createWarRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/warRuntimeState",
));
const {
  ensureRuntimeInitialized,
  cloneValue,
  updateRuntimeState,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/corporationRuntimeState",
));

const CORPORATION_ID = 98000000;
const ALLIANCE_ID = 99000000;
const CEO_CHARACTER_ID = 140000003;
const NPC_CORPORATION_ID = 1000044;
const STATION_ID = 60003760;

test(
  "killmail parity tracks assisting corporations, war attribution, and authoritative dropped-vs-destroyed ship outcomes",
  { concurrency: false },
  (t) => {
    const killmailSnapshot = cloneValue(database.read(KILLMAIL_TABLE, "/").data || {});
    const itemsSnapshot = cloneValue(database.read("items", "/").data || {});
    const runtimeSnapshot = cloneValue(ensureRuntimeInitialized());
    const createdItemIDs = [];

    t.after(() => {
      for (const itemID of createdItemIDs) {
        removeInventoryItem(itemID);
      }
      database.write(KILLMAIL_TABLE, "/", cloneValue(killmailSnapshot));
      database.write("items", "/", cloneValue(itemsSnapshot));
      updateRuntimeState(() => cloneValue(runtimeSnapshot));
    });

    const shipResult = grantItemToCharacterStationHangar(
      CEO_CHARACTER_ID,
      STATION_ID,
      606,
      1,
    );
    const lootLocationResult = grantItemToCharacterStationHangar(
      CEO_CHARACTER_ID,
      STATION_ID,
      606,
      1,
    );
    const shipItemID = shipResult.data.items[0].itemID;
    const lootLocationID = lootLocationResult.data.items[0].itemID;
    createdItemIDs.push(shipItemID, lootLocationID);

    const cargoStackResult = grantItemToCharacterLocation(
      CEO_CHARACTER_ID,
      shipItemID,
      ITEM_FLAGS.CARGO_HOLD,
      34,
      4,
    );
    const rigResult = grantItemToCharacterLocation(
      CEO_CHARACTER_ID,
      shipItemID,
      92,
      34,
      1,
    );
    const nestedContainerResult = grantItemToCharacterLocation(
      CEO_CHARACTER_ID,
      shipItemID,
      ITEM_FLAGS.HANGAR,
      606,
      1,
    );
    const nestedAmmoResult = grantItemToCharacterLocation(
      CEO_CHARACTER_ID,
      nestedContainerResult.data.items[0].itemID,
      ITEM_FLAGS.CARGO_HOLD,
      34,
      2,
    );
    createdItemIDs.push(
      cargoStackResult.data.items[0].itemID,
      rigResult.data.items[0].itemID,
      nestedContainerResult.data.items[0].itemID,
      nestedAmmoResult.data.items[0].itemID,
    );

    const deathOutcomeResult = resolveLocationDeathOutcome(shipItemID, {
      rootLootLocationID: lootLocationID,
      seed: "killmail-parity-seed",
    });
    assert.equal(deathOutcomeResult.success, true);
    assert.equal(
      listContainerItems(null, shipItemID, null).length,
      0,
    );
    assert.equal(
      listContainerItems(null, lootLocationID, null).length > 0,
      true,
    );

    const topLevelItems = deathOutcomeResult.data.items;
    const rigPayload = topLevelItems.find((item) => Number(item.flag) === 92);
    assert.ok(rigPayload);
    assert.equal(Number(rigPayload.qtyDropped), 0);
    assert.equal(Number(rigPayload.qtyDestroyed), 1);

    const stackPayload = topLevelItems.find(
      (item) =>
        Number(item.flag) === ITEM_FLAGS.CARGO_HOLD &&
        Array.isArray(item.contents) &&
        item.contents.length === 0 &&
        Number(item.singleton) === 0,
    );
    assert.ok(stackPayload);
    assert.equal(
      Number(stackPayload.qtyDropped) + Number(stackPayload.qtyDestroyed),
      4,
    );

    const nestedContainerPayload = topLevelItems.find(
      (item) => Array.isArray(item.contents) && item.contents.length === 1,
    );
    assert.ok(nestedContainerPayload);
    assert.equal(
      Number(nestedContainerPayload.contents[0].qtyDropped) +
        Number(nestedContainerPayload.contents[0].qtyDestroyed),
      2,
    );

    const nowFiletime = currentFileTime().toString();
    const war = createWarRecord({
      declaredByID: CORPORATION_ID,
      againstID: NPC_CORPORATION_ID,
      timeDeclared: nowFiletime,
      timeStarted: nowFiletime,
    });
    assert.ok(war);

    const resolvedWarID = resolveKillmailWarID({
      killTime: nowFiletime,
      victimCorporationID: NPC_CORPORATION_ID,
      victimAllianceID: null,
      finalCorporationID: 1000125,
      finalAllianceID: null,
      attackers: [
        {
          corporationID: CORPORATION_ID,
          allianceID: ALLIANCE_ID,
          damageDone: 250,
        },
      ],
    });
    assert.equal(Number(resolvedWarID), Number(war.warID));

    const killmail = createKillmailRecord({
      killTime: nowFiletime,
      solarSystemID: 30000142,
      victimCharacterID: null,
      victimCorporationID: NPC_CORPORATION_ID,
      victimAllianceID: null,
      victimFactionID: null,
      victimShipTypeID: 606,
      victimDamageTaken: 500,
      finalCharacterID: null,
      finalCorporationID: 1000125,
      finalAllianceID: null,
      finalFactionID: null,
      finalShipTypeID: 606,
      finalWeaponTypeID: 34,
      finalSecurityStatus: null,
      finalDamageDone: 250,
      warID: resolvedWarID,
      attackers: [
        {
          corporationID: CORPORATION_ID,
          allianceID: ALLIANCE_ID,
          shipTypeID: 606,
          weaponTypeID: 34,
          damageDone: 250,
        },
      ],
      items: deathOutcomeResult.data.items,
    });
    assert.ok(killmail);
    assert.equal(Number(killmail.warID), Number(war.warID));
    assert.equal(Number(killmail.iskDestroyed) > 0, true);

    const corporationKills = listKillmailsForCorporation(CORPORATION_ID, "kills");
    assert.equal(
      corporationKills.some((record) => Number(record.killID) === Number(killmail.killID)),
      true,
    );

    const warStats = buildWarDestructionStatistics(war.warID);
    assert.equal(Number(warStats.shipsKilled[String(CORPORATION_ID)] || 0), 1);
  },
);

test(
  "structure loot resolution uses authoritative dropped-vs-destroyed outcomes for killmail items",
  { concurrency: false },
  (t) => {
    const itemsSnapshot = cloneValue(database.read("items", "/").data || {});
    const fakeStructureID = 1999999999001;
    const fakeStructure = {
      structureID: fakeStructureID,
      typeID: 35832,
      ownerCorpID: CORPORATION_ID,
      solarSystemID: 30000142,
      itemName: "Killmail Test Astrahus",
      position: { x: 0, y: 0, z: 0 },
      rotation: [0, 0, 0],
      hasQuantumCore: false,
    };

    t.after(() => {
      database.write("items", "/", cloneValue(itemsSnapshot));
    });

    const cargoStackResult = grantItemToCharacterLocation(
      CEO_CHARACTER_ID,
      fakeStructureID,
      ITEM_FLAGS.HANGAR,
      34,
      4,
    );
    const rigLikeResult = grantItemToCharacterLocation(
      CEO_CHARACTER_ID,
      fakeStructureID,
      92,
      34,
      1,
    );
    const nestedContainerResult = grantItemToCharacterLocation(
      CEO_CHARACTER_ID,
      fakeStructureID,
      ITEM_FLAGS.HANGAR,
      606,
      1,
    );
    grantItemToCharacterLocation(
      CEO_CHARACTER_ID,
      nestedContainerResult.data.items[0].itemID,
      ITEM_FLAGS.CARGO_HOLD,
      34,
      2,
    );

    const lootResult = handleStructureDestroyedLoot(fakeStructure, {
      includeStructureContents: true,
      includeQuantumCore: false,
      nowMs: 123456789,
    });
    assert.equal(lootResult.success, true);
    assert.equal(listContainerItems(null, fakeStructureID, null).length, 0);

    const lootData = lootResult.data;
    const lootLocationID =
      lootData.wreck && lootData.wreck.itemID
        ? lootData.wreck.itemID
        : lootData.containers[0].containerID;
    assert.equal(Number(lootLocationID) > 0, true);
    assert.equal(listContainerItems(null, lootLocationID, null).length > 0, true);

    const killmailItems = lootData.lootOutcome.items;
    const rigPayload = killmailItems.find((item) => Number(item.flag) === 92);
    assert.ok(rigPayload);
    assert.equal(Number(rigPayload.qtyDropped), 0);
    assert.equal(Number(rigPayload.qtyDestroyed), 1);

    const stackPayload = killmailItems.find(
      (item) =>
        Number(item.flag) === ITEM_FLAGS.HANGAR &&
        Array.isArray(item.contents) &&
        item.contents.length === 0 &&
        Number(item.singleton) === 0,
    );
    assert.ok(stackPayload);
    assert.equal(
      Number(stackPayload.qtyDropped) + Number(stackPayload.qtyDestroyed),
      4,
    );

    const nestedContainerPayload = killmailItems.find(
      (item) => Array.isArray(item.contents) && item.contents.length === 1,
    );
    assert.ok(nestedContainerPayload);
    assert.equal(
      Number(nestedContainerPayload.contents[0].qtyDropped) +
        Number(nestedContainerPayload.contents[0].qtyDestroyed),
      2,
    );
  },
);
