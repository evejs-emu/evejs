const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const ShipService = require(path.join(
  repoRoot,
  "server/src/services/ship/shipService",
));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  ITEM_FLAGS,
  grantItemToCharacterLocation,
  moveItemToLocation,
  removeInventoryItem,
  findItemById,
  resetInventoryStoreForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  listFittedItems,
  getLoadedChargeItems,
  getLoadedChargeByFlag,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  resolveItemByName,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));
const {
  getCharacterWeaponBanks,
  getShipWeaponBanks,
  resetModuleGroupingStateForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/moduleGrouping/moduleGroupingState",
));

const HIGH_SLOT_FLAGS = [27, 28, 29, 30, 31, 32, 33, 34];
const MODULE_GROUPING_DEFAULT_ROOT = Object.freeze({
  meta: {
    version: 1,
    description: "DB-backed authoritative weapon-bank state keyed by ship itemID.",
    updatedAt: null,
  },
  ships: {},
});

let groupingRootBackup = null;
const transientItemIDs = new Set();

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getBoundID(value) {
  return (
    value &&
    value.type === "substruct" &&
    value.value &&
    value.value.type === "substream" &&
    Array.isArray(value.value.value)
      ? value.value.value[0]
      : null
  );
}

function listValueToArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && value.type === "list" && Array.isArray(value.items)) {
    return value.items;
  }
  return [];
}

function dictValueToObject(value) {
  const result = {};
  if (!value || value.type !== "dict" || !Array.isArray(value.entries)) {
    return result;
  }
  for (const [key, entryValue] of value.entries) {
    result[String(Number(key) || key)] = listValueToArray(entryValue).map(
      (item) => Number(item) || 0,
    );
  }
  return result;
}

function getKeyValEntry(value, key) {
  if (
    !value ||
    value.type !== "object" ||
    value.name !== "util.KeyVal" ||
    !value.args ||
    value.args.type !== "dict" ||
    !Array.isArray(value.args.entries)
  ) {
    return null;
  }
  return value.args.entries.find((entry) => entry[0] === key)?.[1] ?? null;
}

function buildDockedSession(candidate) {
  return {
    clientID: candidate.characterID + 97000,
    userid: candidate.characterID,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    stationid: candidate.stationID,
    stationID: candidate.stationID,
    locationid: candidate.stationID,
    shipID: candidate.shipID,
    shipid: candidate.shipID,
    activeShipID: candidate.shipID,
    currentBoundObjectID: null,
    socket: { destroyed: false },
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function getWrappedUserErrorMessage(error) {
  return error &&
    error.machoErrorResponse &&
    error.machoErrorResponse.payload &&
    Array.isArray(error.machoErrorResponse.payload.header) &&
    Array.isArray(error.machoErrorResponse.payload.header[1])
      ? error.machoErrorResponse.payload.header[1][0]
      : null;
}

function getWrappedUserErrorDict(error) {
  const dictHeader = error &&
    error.machoErrorResponse &&
    error.machoErrorResponse.payload &&
    Array.isArray(error.machoErrorResponse.payload.header) &&
    Array.isArray(error.machoErrorResponse.payload.header[1])
      ? error.machoErrorResponse.payload.header[1][1]
      : null;
  return dictHeader && Array.isArray(dictHeader.entries)
    ? Object.fromEntries(dictHeader.entries)
    : {};
}

function readOnItemChangeItemID(notification) {
  const payload = notification && Array.isArray(notification.payload)
    ? notification.payload
    : null;
  const row = Array.isArray(payload) ? payload[0] : null;
  return row &&
    row.fields &&
    row.fields.itemID !== undefined
      ? row.fields.itemID
      : null;
}

function getDockedCandidate(minFreeHighSlots = 4) {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    const activeShip = getActiveShipRecord(characterID);
    const stationID = Number(
      characterRecord && (characterRecord.stationID || characterRecord.stationid || 0),
    ) || 0;
    if (!characterRecord || !activeShip || stationID <= 0) {
      continue;
    }

    const usedHighFlags = new Set(
      listFittedItems(characterID, activeShip.itemID)
        .map((item) => Number(item && item.flagID) || 0)
        .filter((flagID) => HIGH_SLOT_FLAGS.includes(flagID)),
    );
    const freeHighFlags = HIGH_SLOT_FLAGS.filter((flagID) => !usedHighFlags.has(flagID));
    if (freeHighFlags.length < minFreeHighSlots) {
      continue;
    }

    return {
      characterID,
      stationID,
      shipID: Number(activeShip.itemID) || 0,
      freeHighFlags,
    };
  }

  assert.fail(
    `Expected a docked character with at least ${minFreeHighSlots} free high-slot flags`,
  );
}

function trackTransientItemID(itemID) {
  const numericItemID = Number(itemID) || 0;
  if (numericItemID > 0) {
    transientItemIDs.add(numericItemID);
  }
}

function fitTransientModules(candidate, moduleName, count) {
  const moduleType = resolveItemByName(moduleName);
  assert.equal(moduleType && moduleType.success, true, `Expected item metadata for ${moduleName}`);

  const fittedItems = [];
  for (let index = 0; index < count; index += 1) {
    const flagID = candidate.freeHighFlags[index];
    assert.ok(Number(flagID) > 0, "Expected a free high-slot flag");
    const grantResult = grantItemToCharacterLocation(
      candidate.characterID,
      candidate.stationID,
      ITEM_FLAGS.HANGAR,
      moduleType.match,
      1,
      { transient: true },
    );
    assert.equal(grantResult.success, true, `Expected transient grant for ${moduleName}`);
    const grantedItem = grantResult.data.items[0];
    trackTransientItemID(grantedItem.itemID);

    const moveResult = moveItemToLocation(
      grantedItem.itemID,
      candidate.shipID,
      flagID,
    );
    assert.equal(moveResult.success, true, `Expected to fit ${moduleName} into flag ${flagID}`);
    fittedItems.push(findItemById(grantedItem.itemID));
  }

  return fittedItems;
}

function grantTransientChargesToCargo(candidate, chargeName, count) {
  const chargeType = resolveItemByName(chargeName);
  assert.equal(chargeType && chargeType.success, true, `Expected item metadata for ${chargeName}`);

  const charges = [];
  for (let index = 0; index < count; index += 1) {
    const grantResult = grantItemToCharacterLocation(
      candidate.characterID,
      candidate.shipID,
      ITEM_FLAGS.CARGO_HOLD,
      chargeType.match,
      1,
      { transient: true },
    );
    assert.equal(grantResult.success, true, `Expected transient grant for ${chargeName}`);
    const grantedCharge = grantResult.data.items[0];
    trackTransientItemID(grantedCharge.itemID);
    charges.push(grantedCharge);
  }
  return charges;
}

function resetGroupingTable(root = MODULE_GROUPING_DEFAULT_ROOT) {
  const writeResult = database.write("moduleGroupingState", "/", cloneValue(root));
  assert.equal(writeResult.success, true, "Expected moduleGroupingState table write to succeed");
  resetModuleGroupingStateForTests();
}

test.beforeEach(() => {
  const result = database.read("moduleGroupingState", "/");
  groupingRootBackup =
    result.success && result.data
      ? cloneValue(result.data)
      : cloneValue(MODULE_GROUPING_DEFAULT_ROOT);
  resetGroupingTable();
  resetInventoryStoreForTests();
});

test.afterEach(() => {
  for (const itemID of transientItemIDs) {
    removeInventoryItem(itemID, { removeContents: true });
  }
  transientItemIDs.clear();
  resetInventoryStoreForTests();
  resetGroupingTable(groupingRootBackup || MODULE_GROUPING_DEFAULT_ROOT);
});

test("ship bootstrap keeps persisted weapon-bank wbData in dogma and ship activation tuples", () => {
  const candidate = getDockedCandidate(2);
  const session = buildDockedSession(candidate);
  const dogma = new DogmaService();
  const shipService = new ShipService();
  const modules = fitTransientModules(candidate, "Small Focused Beam Laser I", 2);

  dogma.Handle_LinkWeapons([candidate.shipID, modules[0].itemID, modules[1].itemID], session);
  resetModuleGroupingStateForTests();

  const allInfo = new DogmaService().Handle_GetAllInfo([false, true, null], session);
  const shipState = getKeyValEntry(allInfo, "shipState");
  assert.ok(Array.isArray(shipState), "Expected shipState to remain a four-slot tuple");
  assert.deepEqual(
    dictValueToObject(shipState[2]),
    {
      [String(modules[0].itemID)]: [modules[1].itemID],
    },
    "Expected dogma GetAllInfo.shipState[2] to carry persisted wbData",
  );

  const activationResponse = shipService._buildActivationResponse(
    getActiveShipRecord(candidate.characterID),
    session,
  );
  assert.deepEqual(
    dictValueToObject(activationResponse[2]),
    {
      [String(modules[0].itemID)]: [modules[1].itemID],
    },
    "Expected ship activation tuple slot 3 to carry persisted wbData",
  );
});

test("per-character active-ship grouping view is cache-backed and reloads from persisted ship state", () => {
  const candidate = getDockedCandidate(2);
  const session = buildDockedSession(candidate);
  const dogma = new DogmaService();
  const modules = fitTransientModules(candidate, "Small Focused Beam Laser I", 2);

  dogma.Handle_LinkWeapons([candidate.shipID, modules[0].itemID, modules[1].itemID], session);

  assert.deepEqual(
    getCharacterWeaponBanks(candidate.characterID),
    {
      [String(modules[0].itemID)]: [modules[1].itemID],
    },
    "Expected the character-scoped view to resolve through the active ship",
  );
  assert.deepEqual(
    getCharacterWeaponBanks(candidate.characterID),
    {
      [String(modules[0].itemID)]: [modules[1].itemID],
    },
    "Expected repeated character-scoped reads to stay stable through the cache layer",
  );

  const persistedRoot = database.read("moduleGroupingState", "/");
  assert.equal(persistedRoot.success, true, "Expected moduleGroupingState persistence to succeed");
  assert.deepEqual(
    persistedRoot.data.ships[String(candidate.shipID)].banksByMasterID,
    {
      [String(modules[0].itemID)]: [modules[1].itemID],
    },
    "Expected the authoritative ship grouping state to persist into the DB table",
  );
  assert.equal(
    Number(persistedRoot.data.ships[String(candidate.shipID)].changedByCharacterID),
    candidate.characterID,
    "Expected the persisted ship grouping state to record the last character mutator",
  );

  resetModuleGroupingStateForTests();
  assert.deepEqual(
    getCharacterWeaponBanks(candidate.characterID),
    {
      [String(modules[0].itemID)]: [modules[1].itemID],
    },
    "Expected the character-scoped view to reload from persisted ship state after cache reset",
  );
});

test("grouping RPC surface supports link, peel, merge, unlink-all, and destroy flows", () => {
  const candidate = getDockedCandidate(4);
  const session = buildDockedSession(candidate);
  const dogma = new DogmaService();
  const modules = fitTransientModules(candidate, "Small Focused Beam Laser I", 4);

  dogma.Handle_LinkWeapons([candidate.shipID, modules[0].itemID, modules[1].itemID], session);
  assert.deepEqual(
    getShipWeaponBanks(candidate.shipID),
    {
      [String(modules[0].itemID)]: [modules[1].itemID],
    },
  );

  dogma.Handle_LinkWeapons([candidate.shipID, modules[2].itemID, modules[3].itemID], session);
  assert.deepEqual(
    getShipWeaponBanks(candidate.shipID),
    {
      [String(modules[0].itemID)]: [modules[1].itemID],
      [String(modules[2].itemID)]: [modules[3].itemID],
    },
  );

  dogma.Handle_PeelAndLink([candidate.shipID, modules[0].itemID, modules[2].itemID], session);
  assert.deepEqual(
    getShipWeaponBanks(candidate.shipID),
    {
      [String(modules[0].itemID)]: [modules[1].itemID, modules[3].itemID],
    },
    "Expected PeelAndLink to peel one module from the source bank into the target bank",
  );

  dogma.Handle_LinkWeapons([candidate.shipID, modules[2].itemID, modules[3].itemID], session);
  dogma.Handle_MergeModuleGroups([candidate.shipID, modules[0].itemID, modules[2].itemID], session);
  assert.deepEqual(
    getShipWeaponBanks(candidate.shipID),
    {
      [String(modules[0].itemID)]: [
        modules[1].itemID,
        modules[2].itemID,
        modules[3].itemID,
      ],
    },
    "Expected MergeModuleGroups to absorb the source master and its slaves",
  );

  const peeledModuleID = dogma.Handle_UnlinkModule([candidate.shipID, modules[0].itemID], session);
  assert.equal(
    Number(peeledModuleID),
    modules[1].itemID,
    "Expected UnlinkModule to peel the first sorted slave from the bank",
  );
  assert.deepEqual(
    getShipWeaponBanks(candidate.shipID),
    {
      [String(modules[0].itemID)]: [modules[2].itemID, modules[3].itemID],
    },
  );

  dogma.Handle_DestroyWeaponBank([candidate.shipID, modules[0].itemID], session);
  assert.deepEqual(
    getShipWeaponBanks(candidate.shipID),
    {},
    "Expected DestroyWeaponBank to clear the explicit bank",
  );

  dogma.Handle_LinkAllWeapons([candidate.shipID], session);
  assert.deepEqual(
    getShipWeaponBanks(candidate.shipID),
    {
      [String(modules[0].itemID)]: [
        modules[1].itemID,
        modules[2].itemID,
        modules[3].itemID,
      ],
    },
    "Expected LinkAllWeapons to unify all same-type online weapons under one master",
  );

  dogma.Handle_UnlinkAllModules([candidate.shipID], session);
  assert.deepEqual(
    getShipWeaponBanks(candidate.shipID),
    {},
    "Expected UnlinkAllModules to clear all banks for the ship",
  );
});

test("offlining a grouped module destroys the bank and notifies the client with fresh bank state", () => {
  const candidate = getDockedCandidate(2);
  const session = buildDockedSession(candidate);
  const dogma = new DogmaService();
  const modules = fitTransientModules(candidate, "Small Focused Beam Laser I", 2);

  dogma.Handle_LinkWeapons([candidate.shipID, modules[0].itemID, modules[1].itemID], session);
  session.notifications.length = 0;

  dogma.Handle_TakeModuleOffline([candidate.shipID, modules[0].itemID], session);

  assert.deepEqual(
    getShipWeaponBanks(candidate.shipID),
    {},
    "Expected grouped offlining to destroy the bank on the server",
  );
  const bankNotification = session.notifications.find(
    (entry) => entry.name === "OnWeaponBanksChanged",
  );
  assert.ok(bankNotification, "Expected grouped offlining to notify the client");
  assert.equal(Number(bankNotification.payload[0]), candidate.shipID);
  assert.deepEqual(
    dictValueToObject(bankNotification.payload[1]),
    {},
    "Expected grouped offlining notification to carry the fresh empty bank state",
  );
});

test("inventory unfit through invbroker clears affected banks and emits a bank refresh notification", () => {
  const candidate = getDockedCandidate(2);
  const session = buildDockedSession(candidate);
  const dogma = new DogmaService();
  const invBroker = new InvBrokerService();
  const modules = fitTransientModules(candidate, "Small Focused Beam Laser I", 2);

  dogma.Handle_LinkWeapons([candidate.shipID, modules[0].itemID, modules[1].itemID], session);
  session.notifications.length = 0;

  const hangarBound = invBroker.Handle_GetInventory([candidate.stationID], session);
  session.currentBoundObjectID = getBoundID(hangarBound);
  assert.ok(session.currentBoundObjectID, "Expected station hangar bind to succeed");

  const movedItemID = invBroker.Handle_Add(
    [modules[1].itemID, candidate.shipID],
    session,
    { flag: ITEM_FLAGS.HANGAR },
  );
  void movedItemID;

  const movedItem = findItemById(modules[1].itemID);
  assert.equal(Number(movedItem.locationID), candidate.stationID);
  assert.equal(Number(movedItem.flagID), ITEM_FLAGS.HANGAR);
  assert.deepEqual(
    getShipWeaponBanks(candidate.shipID),
    {},
    "Expected moving a grouped module out of fitting to clear the remaining bank",
  );
  const bankNotification = session.notifications.find(
    (entry) => entry.name === "OnWeaponBanksChanged",
  );
  assert.ok(bankNotification, "Expected invbroker unfit to notify the client about bank changes");
});

test("loading and unloading ammo through a grouped master applies to the whole bank", () => {
  const candidate = getDockedCandidate(2);
  const session = buildDockedSession(candidate);
  const dogma = new DogmaService();
  const modules = fitTransientModules(candidate, "Small Focused Beam Laser I", 2);
  const charges = grantTransientChargesToCargo(candidate, "Radio S", 2);

  dogma.Handle_LinkWeapons([candidate.shipID, modules[0].itemID, modules[1].itemID], session);

  dogma.Handle_LoadAmmo(
    [
      candidate.shipID,
      modules[0].itemID,
      charges.map((charge) => charge.itemID),
      candidate.shipID,
    ],
    session,
  );

  const loadedCharges = getLoadedChargeItems(candidate.characterID, candidate.shipID)
    .filter((item) => (
      Number(item.typeID) === resolveItemByName("Radio S").match.typeID &&
      [modules[0].flagID, modules[1].flagID].includes(Number(item.flagID) || 0)
    ));
  assert.equal(
    loadedCharges.length,
    2,
    "Expected grouped LoadAmmo to populate every module in the bank",
  );

  dogma.Handle_UnloadAmmo(
    [candidate.shipID, modules[0].itemID, candidate.shipID, null],
    session,
  );
  assert.equal(
    getLoadedChargeItems(candidate.characterID, candidate.shipID).filter((item) => (
      [modules[0].flagID, modules[1].flagID].includes(Number(item.flagID) || 0)
    )).length,
    0,
    "Expected grouped UnloadAmmo through the master module to empty the full bank",
  );
});

test("sanitization removes stale ghost banks when a grouped module disappears without an explicit grouping RPC", () => {
  const candidate = getDockedCandidate(2);
  const session = buildDockedSession(candidate);
  const dogma = new DogmaService();
  const modules = fitTransientModules(candidate, "Small Focused Beam Laser I", 2);

  dogma.Handle_LinkWeapons([candidate.shipID, modules[0].itemID, modules[1].itemID], session);
  moveItemToLocation(modules[1].itemID, candidate.stationID, ITEM_FLAGS.HANGAR);

  resetModuleGroupingStateForTests();
  assert.deepEqual(
    getShipWeaponBanks(candidate.shipID),
    {},
    "Expected stale bank state to be pruned on the next authoritative read",
  );
});

test("weapon-bank mutations require the affected weapons to be online", () => {
  const candidate = getDockedCandidate(2);
  const session = buildDockedSession(candidate);
  const dogma = new DogmaService();
  const modules = fitTransientModules(candidate, "Small Focused Beam Laser I", 2);
  dogma.Handle_TakeModuleOffline([candidate.shipID, modules[0].itemID], session);
  dogma.Handle_TakeModuleOffline([candidate.shipID, modules[1].itemID], session);

  let thrown = null;
  try {
    dogma.Handle_LinkWeapons([candidate.shipID, modules[0].itemID, modules[1].itemID], session);
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, "Expected grouping online weapons to throw a wrapped UserError");
  assert.equal(getWrappedUserErrorMessage(thrown), "CustomNotify");
  assert.equal(
    getWrappedUserErrorDict(thrown).notify,
    "All weapons in the bank must be online before grouping them.",
  );
  assert.deepEqual(
    getShipWeaponBanks(candidate.shipID),
    {},
    "Expected offline weapons to stay ungrouped",
  );
});

test("weapon-bank mutations reject mixed loaded ammo states", () => {
  const candidate = getDockedCandidate(2);
  const session = buildDockedSession(candidate);
  const dogma = new DogmaService();
  const modules = fitTransientModules(candidate, "Small Focused Beam Laser I", 2);
  const radioCharges = grantTransientChargesToCargo(candidate, "Radio S", 1);
  const multifrequencyCharges = grantTransientChargesToCargo(candidate, "Multifrequency S", 1);

  dogma.Handle_LoadAmmo(
    [
      candidate.shipID,
      [modules[0].itemID],
      radioCharges.map((charge) => charge.itemID),
      candidate.shipID,
    ],
    session,
  );
  dogma.Handle_LoadAmmo(
    [
      candidate.shipID,
      [modules[1].itemID],
      multifrequencyCharges.map((charge) => charge.itemID),
      candidate.shipID,
    ],
    session,
  );

  let thrown = null;
  try {
    dogma.Handle_LinkWeapons([candidate.shipID, modules[0].itemID, modules[1].itemID], session);
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, "Expected grouping mixed-ammo weapons to throw a wrapped UserError");
  assert.equal(getWrappedUserErrorMessage(thrown), "CustomNotify");
  assert.equal(
    getWrappedUserErrorDict(thrown).notify,
    "All weapons in the bank must have the same loaded charge, or all be empty.",
  );
  assert.deepEqual(
    getShipWeaponBanks(candidate.shipID),
    {},
    "Expected mixed-ammo weapons to stay ungrouped",
  );
});

test("group all partitions same-type weapons by loaded ammo state", () => {
  const candidate = getDockedCandidate(4);
  const session = buildDockedSession(candidate);
  const dogma = new DogmaService();
  const modules = fitTransientModules(candidate, "Small Focused Beam Laser I", 4);
  const radioCharges = grantTransientChargesToCargo(candidate, "Radio S", 2);
  const multifrequencyCharges = grantTransientChargesToCargo(candidate, "Multifrequency S", 2);

  dogma.Handle_LoadAmmo(
    [
      candidate.shipID,
      [modules[0].itemID, modules[1].itemID],
      radioCharges.map((charge) => charge.itemID),
      candidate.shipID,
    ],
    session,
  );
  dogma.Handle_LoadAmmo(
    [
      candidate.shipID,
      [modules[2].itemID, modules[3].itemID],
      multifrequencyCharges.map((charge) => charge.itemID),
      candidate.shipID,
    ],
    session,
  );

  dogma.Handle_LinkAllWeapons([candidate.shipID], session);

  assert.deepEqual(
    getShipWeaponBanks(candidate.shipID),
    {
      [String(modules[0].itemID)]: [modules[1].itemID],
      [String(modules[2].itemID)]: [modules[3].itemID],
    },
    "Expected group all to create separate banks for each loaded-ammo state",
  );
});

test("ungrouping repairs docked charge rows so split weapons immediately show the current ammo", () => {
  const candidate = getDockedCandidate(2);
  const session = buildDockedSession(candidate);
  const dogma = new DogmaService();
  const modules = fitTransientModules(candidate, "Small Focused Beam Laser I", 2);
  const multifrequencyCharges = grantTransientChargesToCargo(candidate, "Multifrequency S", 2);
  const radioCharges = grantTransientChargesToCargo(candidate, "Radio S", 2);

  dogma.Handle_LoadAmmo(
    [
      candidate.shipID,
      modules.map((moduleItem) => moduleItem.itemID),
      multifrequencyCharges.map((charge) => charge.itemID),
      candidate.shipID,
    ],
    session,
  );
  dogma.Handle_LinkWeapons([candidate.shipID, modules[0].itemID, modules[1].itemID], session);
  session.notifications.length = 0;

  dogma.Handle_LoadAmmo(
    [
      candidate.shipID,
      modules[0].itemID,
      radioCharges.map((charge) => charge.itemID),
      candidate.shipID,
    ],
    session,
  );
  session.notifications.length = 0;

  const peeledModuleID = dogma.Handle_UnlinkModule([candidate.shipID, modules[0].itemID], session);
  assert.equal(Number(peeledModuleID), modules[1].itemID);

  const currentCharge = getLoadedChargeByFlag(
    candidate.characterID,
    candidate.shipID,
    modules[1].flagID,
  );
  assert.ok(currentCharge, "Expected the peeled module to keep its loaded charge");
  assert.equal(
    Number(currentCharge.typeID),
    resolveItemByName("Radio S").match.typeID,
    "Expected the peeled module to really hold the new charge type on the server",
  );

  const repairedChargeNotifications = session.notifications.filter(
    (entry) =>
      entry.name === "OnItemChange" &&
      JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(currentCharge.itemID),
  );
  assert.ok(
    repairedChargeNotifications.length > 0,
    "Expected ungrouping to immediately resend the peeled module's charge row",
  );
});
