const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const transitions = require(path.join(repoRoot, "server/src/space/transitions"));
const RepairService = require(path.join(
  repoRoot,
  "server/src/services/station/repairService",
));
const {
  applyCharacterToSession,
  getActiveShipRecord,
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  getCharacterWallet,
  setCharacterBalance,
} = require(path.join(repoRoot, "server/src/services/account/walletState"));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const {
  getFittedModuleItems,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  ITEM_FLAGS,
  updateInventoryItem,
  updateShipItem,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  unwrapMarshalValue,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/serviceHelpers",
));
const {
  listStructures,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureConstants",
));
const {
  getStationRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/stationStaticData",
));

const AIR_TRADE_HUB_TYPE_ID = 92885;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
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

function captureThrownError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("Expected function to throw");
}

function buildSession() {
  const notifications = [];
  const sessionChanges = [];
  return {
    clientID: 9500001,
    userid: 9500001,
    characterID: 0,
    charid: 0,
    corporationID: 0,
    allianceID: null,
    warFactionID: null,
    stationid: null,
    stationID: null,
    stationid2: null,
    structureid: null,
    structureID: null,
    locationid: null,
    solarsystemid: null,
    solarsystemid2: null,
    shipID: null,
    shipid: null,
    activeShipID: null,
    socket: { destroyed: false },
    _notifications: notifications,
    _sessionChanges: sessionChanges,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange(change) {
      sessionChanges.push(change);
    },
  };
}

function hydrateDockedStationSession(characterID) {
  const session = buildSession();
  const applyResult = applyCharacterToSession(session, characterID, {
    emitNotifications: false,
    logSelection: false,
    selectionEvent: false,
    deferDockedShipSessionChange: false,
  });
  assert.equal(applyResult.success, true, "Expected station session to hydrate");
  sessionRegistry.register(session);
  return session;
}

function buildStructureDockedSession(candidate, structure) {
  const character = getCharacterRecord(candidate.characterID);
  const session = buildSession();
  session.characterID = candidate.characterID;
  session.charid = candidate.characterID;
  session.corporationID = Number(character && character.corporationID) || 0;
  session.allianceID = Number(character && character.allianceID) || null;
  session.warFactionID = Number(character && character.warFactionID) || null;
  session.stationid = null;
  session.stationID = null;
  session.stationid2 = null;
  session.structureid = structure.structureID;
  session.structureID = structure.structureID;
  session.locationid = structure.structureID;
  session.solarsystemid = structure.solarSystemID;
  session.solarsystemid2 = structure.solarSystemID;
  session.shipID = candidate.shipID;
  session.shipid = candidate.shipID;
  session.activeShipID = candidate.shipID;
  sessionRegistry.register(session);
  return session;
}

function readItemRecord(itemID) {
  const result = database.read("items", `/${Number(itemID) || 0}`);
  assert.equal(result.success, true, `Failed to read item ${itemID}`);
  return result.data;
}

function findDockedCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  let fallback = null;
  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    const ship = getActiveShipRecord(characterID);
    if (!characterRecord || !ship || !ship.itemID) {
      continue;
    }
    const stationID = Number(characterRecord.stationID || characterRecord.stationid || 0);
    if (!(stationID > 0)) {
      continue;
    }

    const fittedModules = getFittedModuleItems(characterID, ship.itemID);
    const candidate = {
      characterID,
      stationID,
      shipID: ship.itemID,
      fittedModuleID: fittedModules.length > 0 ? fittedModules[0].itemID : null,
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

function findDockedCandidateForStationType(stationTypeID) {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    const ship = getActiveShipRecord(characterID);
    if (!characterRecord || !ship || !ship.itemID) {
      continue;
    }

    const stationID = Number(characterRecord.stationID || characterRecord.stationid || 0);
    if (!(stationID > 0)) {
      continue;
    }

    const station = getStationRecord(null, stationID);
    if (Number(station && station.stationTypeID) !== Number(stationTypeID)) {
      continue;
    }

    return {
      characterID,
      stationID,
      shipID: ship.itemID,
      fittedModuleID: getFittedModuleItems(characterID, ship.itemID)[0]?.itemID || null,
    };
  }

  assert.fail(`Expected at least one docked character in station type ${stationTypeID}`);
}

function findRepairStructureCandidate() {
  const structure = listStructures({ refresh: false }).find((entry) => {
    const repairState = Number(
      entry &&
        entry.serviceStates &&
        entry.serviceStates[String(STRUCTURE_SERVICE_ID.REPAIR)],
    );
    return repairState === STRUCTURE_SERVICE_STATE.ONLINE;
  });
  assert.ok(structure, "Expected a structure with online repair service");
  return structure;
}

function writeCharacterRecord(characterID, record) {
  const result = updateCharacterRecord(characterID, () => cloneValue(record));
  assert.equal(result.success, true, `Failed to restore character ${characterID}`);
}

function writeItemRecord(itemID, record) {
  const result =
    Number(record && record.categoryID) === 6
      ? updateShipItem(itemID, () => cloneValue(record))
      : updateInventoryItem(itemID, () => cloneValue(record));
  assert.equal(result.success, true, `Failed to restore item ${itemID}`);
}

function setShipDamage(shipID, nextConditionState) {
  const updateResult = updateShipItem(shipID, (currentShip) => ({
    ...currentShip,
    conditionState: {
      ...(currentShip.conditionState || {}),
      ...nextConditionState,
    },
  }));
  assert.equal(updateResult.success, true, `Expected ship ${shipID} damage seed to succeed`);
}

function setModuleDamage(moduleID, nextModuleState) {
  const updateResult = updateInventoryItem(moduleID, (currentItem) => ({
    ...currentItem,
    moduleState: {
      ...(currentItem.moduleState || {}),
      ...nextModuleState,
    },
  }));
  assert.equal(updateResult.success, true, `Expected module ${moduleID} damage seed to succeed`);
}

function setLiveShipConditionState(session, shipID, nextConditionState) {
  const scene = spaceRuntime.getSceneForSession(session);
  assert.ok(scene, "Expected an active space scene for the session");

  const entity = scene.getEntityByID(shipID);
  assert.ok(entity, "Expected an active space ship entity");

  entity.conditionState = {
    ...(entity.conditionState || {}),
    ...nextConditionState,
  };
  entity.capacitorChargeRatio = Number(nextConditionState.charge || 0);
}

function getEntryByItemID(container, itemID) {
  if (!container || typeof container !== "object") {
    return null;
  }
  return container[itemID] || container[String(itemID)] || null;
}

function readRepairQuoteRows(service, session, itemIDs) {
  const quotes = unwrapMarshalValue(service.Handle_GetRepairQuotes([itemIDs], session));
  return itemIDs.reduce((accumulator, itemID) => {
    accumulator[itemID] = getEntryByItemID(quotes, itemID) || [];
    return accumulator;
  }, {});
}

function hasNotification(session, name) {
  return Array.isArray(session && session._notifications)
    ? session._notifications.some((entry) => entry.name === name)
    : false;
}

function sortNumeric(values = []) {
  return [...values].sort((left, right) => left - right);
}

test("repairSvc quotes group ship and fitted module rows and legacy reports mirror them", { concurrency: false }, () => {
  const candidate = findDockedCandidate();
  assert.ok(candidate.fittedModuleID, "Expected a fitted module for repair quote coverage");

  const originalShip = cloneValue(readItemRecord(candidate.shipID));
  const originalModule = cloneValue(readItemRecord(candidate.fittedModuleID));
  const session = hydrateDockedStationSession(candidate.characterID);
  const service = new RepairService();

  try {
    setShipDamage(candidate.shipID, {
      damage: 0.24,
      charge: 1,
      armorDamage: 0.19,
      shieldCharge: 0.73,
    });
    setModuleDamage(candidate.fittedModuleID, {
      damage: 0.11,
      charge: 0,
      armorDamage: 0.04,
      shieldCharge: 0.85,
    });

    const quoteRowsByRequest = readRepairQuoteRows(service, session, [
      candidate.shipID,
      candidate.fittedModuleID,
    ]);
    const shipRows = quoteRowsByRequest[candidate.shipID];
    const nestedDuplicateRows = quoteRowsByRequest[candidate.fittedModuleID];
    const shipQuote = shipRows.find(
      (row) => Number(row.categoryID) === 6,
    );
    const moduleQuote = shipRows.find(
      (row) => Number(row.itemID) === candidate.fittedModuleID,
    );

    assert.ok(shipQuote, "Expected a ship quote row for the requested active ship");
    assert.ok(Number(shipQuote.itemID || 0) > 0);
    assert.equal(Number(moduleQuote && moduleQuote.itemID) || 0, candidate.fittedModuleID);
    assert.equal(nestedDuplicateRows.length, 0, "Expected nested module request to be suppressed");
    assert.ok(
      Number(
        shipQuote.costToRepairOneUnitOfDamage || 0,
      ) > 0,
      "Expected ship quote to carry a repair unit cost",
    );

    const reports = unwrapMarshalValue(
      service.Handle_GetDamageReports([[candidate.shipID]], session),
    );
    const report = getEntryByItemID(reports, candidate.shipID);
    assert.ok(report, "Expected a legacy damage report for the selected ship");
    assert.deepEqual(
      sortNumeric((report.lines || []).map((row) => Number(row.itemID) || 0)),
      sortNumeric(shipRows.map((row) => Number(row.itemID) || 0)),
    );
  } finally {
    sessionRegistry.unregister(session);
    writeItemRecord(candidate.shipID, originalShip);
    writeItemRecord(candidate.fittedModuleID, originalModule);
  }
});

test("repairSvc legacy RepairItems routes station repairs, charges wallet, and partially repairs ships", { concurrency: false }, () => {
  const candidate = findDockedCandidate();
  const originalShip = cloneValue(readItemRecord(candidate.shipID));
  const originalModule = candidate.fittedModuleID
    ? cloneValue(readItemRecord(candidate.fittedModuleID))
    : null;
  const originalWalletBalance = Number(getCharacterWallet(candidate.characterID).balance || 0);
  const fundedBalance = 50_000_000;
  setCharacterBalance(candidate.characterID, fundedBalance, {
    description: "Repair parity station partial repair setup",
  });

  const session = hydrateDockedStationSession(candidate.characterID);
  const service = new RepairService();

  try {
    setShipDamage(candidate.shipID, {
      damage: 0.5,
      charge: 1,
      armorDamage: 0,
      shieldCharge: 1,
    });
    if (candidate.fittedModuleID) {
      setModuleDamage(candidate.fittedModuleID, {
        damage: 0,
        charge: 0,
        armorDamage: 0,
        shieldCharge: 1,
      });
    }

    const shipRows = readRepairQuoteRows(service, session, [candidate.shipID])[candidate.shipID];
    const shipQuote = shipRows.find((row) => Number(row.categoryID) === 6);
    const quotedShipRepairItemID = Number((shipQuote || {}).itemID || 0);
    assert.ok(
      quotedShipRepairItemID > 0,
      "Expected the client-facing repair quote to return a usable ship repair row ID",
    );
    assert.ok(shipQuote, "Expected a ship quote before partial repair");
    assert.equal(
      shipRows.some((row) => Number(row.itemID) === candidate.fittedModuleID),
      false,
      "Expected pristine modules to stay out of the ship quote set",
    );

    const fullCost =
      Math.ceil(Number(shipQuote.damage) || 0) *
      Number(shipQuote.costToRepairOneUnitOfDamage || 0);
    assert.ok(fullCost > 0, "Expected a non-zero full repair cost for the ship");
    const payment = Number((fullCost / 2).toFixed(2));
    assert.ok(payment > 0 && payment < fullCost, "Expected a true partial payment amount");

    service.Handle_RepairItems([[quotedShipRepairItemID], payment], session);

    const repairedShip = readItemRecord(candidate.shipID);
    assert.ok(
      repairedShip.conditionState.damage < 0.5 &&
        repairedShip.conditionState.damage > 0,
      "Expected hull damage to be reduced but not fully cleared",
    );
    assert.equal(repairedShip.conditionState.armorDamage, 0);
    assert.equal(repairedShip.conditionState.shieldCharge, 1);
    assert.equal(
      Number(getCharacterWallet(candidate.characterID).balance || 0),
      Number((fundedBalance - payment).toFixed(2)),
    );
    assert.equal(hasNotification(session, "OnModuleAttributeChanges"), true);
    assert.equal(hasNotification(session, "OnItemChange"), false);
    assert.equal(hasNotification(session, "OnAccountChange"), true);
  } finally {
    sessionRegistry.unregister(session);
    writeItemRecord(candidate.shipID, originalShip);
    if (candidate.fittedModuleID && originalModule) {
      writeItemRecord(candidate.fittedModuleID, originalModule);
    }
    setCharacterBalance(candidate.characterID, originalWalletBalance, {
      description: "Repair parity station partial repair restore",
    });
  }
});

test("repairSvc rejects partial module repair in stations", { concurrency: false }, () => {
  const candidate = findDockedCandidate();
  assert.ok(candidate.fittedModuleID, "Expected a fitted module for module repair coverage");

  const originalModule = cloneValue(readItemRecord(candidate.fittedModuleID));
  const originalShip = cloneValue(readItemRecord(candidate.shipID));
  const originalWalletBalance = Number(getCharacterWallet(candidate.characterID).balance || 0);
  setCharacterBalance(candidate.characterID, 1_000_000, {
    description: "Repair parity module partial rejection setup",
  });

  const session = hydrateDockedStationSession(candidate.characterID);
  const service = new RepairService();

  try {
    setShipDamage(candidate.shipID, {
      damage: 0,
      charge: 1,
      armorDamage: 0,
      shieldCharge: 1,
    });
    setModuleDamage(candidate.fittedModuleID, {
      damage: 0.45,
      charge: 0,
      armorDamage: 0.2,
      shieldCharge: 0.6,
    });

    const moduleRows = readRepairQuoteRows(service, session, [
      candidate.fittedModuleID,
    ])[candidate.fittedModuleID];
    const moduleQuote = moduleRows.find(
      (row) => Number(row.itemID) === candidate.fittedModuleID,
    );
    assert.ok(moduleQuote, "Expected a module quote before repair");

    const fullCost =
      Math.ceil(Number(moduleQuote.damage) || 0) *
      Number(moduleQuote.costToRepairOneUnitOfDamage || 0);
    const partialPayment = Number((fullCost / 2).toFixed(2));
    assert.ok(partialPayment > 0 && partialPayment < fullCost);

    const error = captureThrownError(() =>
      service.Handle_RepairItemsInStation([[candidate.fittedModuleID], partialPayment], session),
    );
    assert.equal(getWrappedUserErrorMessage(error), "CustomNotify");
    assert.equal(
      getWrappedUserErrorDict(error).notify,
      "Modules must be repaired in full.",
    );

    const moduleAfterReject = readItemRecord(candidate.fittedModuleID);
    assert.equal(moduleAfterReject.moduleState.damage, 0.45);
    assert.equal(moduleAfterReject.moduleState.armorDamage, 0.2);
    assert.equal(Number(getCharacterWallet(candidate.characterID).balance || 0), 1_000_000);
    assert.equal(hasNotification(session, "OnItemChange"), false);
  } finally {
    sessionRegistry.unregister(session);
    writeItemRecord(candidate.shipID, originalShip);
    writeItemRecord(candidate.fittedModuleID, originalModule);
    setCharacterBalance(candidate.characterID, originalWalletBalance, {
      description: "Repair parity module partial rejection restore",
    });
  }
});

test("repairSvc surfaces NotEnoughMoney and leaves damage untouched when full repair is unaffordable", { concurrency: false }, () => {
  const candidate = findDockedCandidate();
  const originalShip = cloneValue(readItemRecord(candidate.shipID));
  const originalWalletBalance = Number(getCharacterWallet(candidate.characterID).balance || 0);
  setCharacterBalance(candidate.characterID, 0, {
    description: "Repair parity insufficient funds setup",
  });

  const session = hydrateDockedStationSession(candidate.characterID);
  const service = new RepairService();

  try {
    setShipDamage(candidate.shipID, {
      damage: 0.25,
      charge: 1,
      armorDamage: 0.12,
      shieldCharge: 0.4,
    });
    const shipRows = readRepairQuoteRows(service, session, [candidate.shipID])[candidate.shipID];
    const quotedShipRepairItemID = Number(
      (shipRows.find((row) => Number(row.categoryID) === 6) || {}).itemID || 0,
    );
    assert.ok(
      quotedShipRepairItemID > 0,
      "Expected a client-facing ship repair row before the insufficient funds check",
    );

    const error = captureThrownError(() =>
      service.Handle_RepairItemsInStation([[quotedShipRepairItemID]], session),
    );
    assert.equal(getWrappedUserErrorMessage(error), "NotEnoughMoney");
    assert.equal(
      Number(getWrappedUserErrorDict(error).balance || 0),
      0,
      "Expected the retail NotEnoughMoney payload to include the current wallet balance",
    );
    assert.ok(
      Number(getWrappedUserErrorDict(error).amount || 0) > 0,
      "Expected the retail NotEnoughMoney payload to include the required amount",
    );

    const shipAfterReject = readItemRecord(candidate.shipID);
    assert.equal(shipAfterReject.conditionState.damage, 0.25);
    assert.equal(shipAfterReject.conditionState.armorDamage, 0.12);
    assert.equal(shipAfterReject.conditionState.shieldCharge, 0.4);
    assert.equal(Number(getCharacterWallet(candidate.characterID).balance || 0), 0);
    assert.equal(hasNotification(session, "OnItemChange"), false);
  } finally {
    sessionRegistry.unregister(session);
    writeItemRecord(candidate.shipID, originalShip);
    setCharacterBalance(candidate.characterID, originalWalletBalance, {
      description: "Repair parity insufficient funds restore",
    });
  }
});

test("repairSvc uses a synthetic active-ship quote row in AIR Trade Hub stations and decodes it on repair", { concurrency: false }, () => {
  const candidate = findDockedCandidateForStationType(AIR_TRADE_HUB_TYPE_ID);
  const originalShip = cloneValue(readItemRecord(candidate.shipID));
  const originalWalletBalance = Number(getCharacterWallet(candidate.characterID).balance || 0);
  const fundedBalance = 10_000_000;
  setCharacterBalance(candidate.characterID, fundedBalance, {
    description: "Repair parity AIR synthetic quote setup",
  });

  const session = hydrateDockedStationSession(candidate.characterID);
  const service = new RepairService();

  try {
    setShipDamage(candidate.shipID, {
      damage: 0.21,
      charge: 1,
      armorDamage: 0.08,
      shieldCharge: 0.62,
    });

    const shipRows = readRepairQuoteRows(service, session, [candidate.shipID])[candidate.shipID];
    const shipQuote = shipRows.find((row) => Number(row.categoryID) === 6);
    assert.ok(shipQuote, "Expected an AIR active-ship repair quote row");
    assert.ok(
      Number(shipQuote.itemID || 0) > 0 &&
        Number(shipQuote.itemID || 0) !== candidate.shipID,
      "Expected AIR Trade Hub ship repair to use the synthetic client-safe row ID",
    );

    const payment = Number(
      (
        Math.ceil(Number(shipQuote.damage) || 0) *
        Number(shipQuote.costToRepairOneUnitOfDamage || 0)
      ).toFixed(2),
    );
    assert.ok(payment > 0, "Expected the AIR quote row to carry a repair cost");

    service.Handle_RepairItemsInStation([[shipQuote.itemID], payment], session);

    const repairedShip = readItemRecord(candidate.shipID);
    assert.equal(repairedShip.conditionState.damage, 0);
    assert.equal(repairedShip.conditionState.armorDamage, 0);
    assert.ok(repairedShip.conditionState.shieldCharge > 0.9999);
  } finally {
    sessionRegistry.unregister(session);
    writeItemRecord(candidate.shipID, originalShip);
    setCharacterBalance(candidate.characterID, originalWalletBalance, {
      description: "Repair parity AIR synthetic quote restore",
    });
  }
});

test("repairSvc repairs structure-docked ships and fitted modules in full", { concurrency: false }, () => {
  const candidate = findDockedCandidate();
  assert.ok(candidate.fittedModuleID, "Expected a fitted module for structure repair coverage");

  const structure = findRepairStructureCandidate();
  const originalCharacter = cloneValue(getCharacterRecord(candidate.characterID));
  const originalShip = cloneValue(readItemRecord(candidate.shipID));
  const originalModule = cloneValue(readItemRecord(candidate.fittedModuleID));
  const originalWalletBalance = Number(getCharacterWallet(candidate.characterID).balance || 0);
  const fundedBalance = 50_000_000;
  setCharacterBalance(candidate.characterID, fundedBalance, {
    description: "Repair parity structure repair setup",
  });

  const session = buildStructureDockedSession(candidate, structure);
  const service = new RepairService();

  try {
    const moveShipResult = updateShipItem(candidate.shipID, (currentShip) => ({
      ...currentShip,
      locationID: structure.structureID,
      flagID: ITEM_FLAGS.HANGAR,
      conditionState: {
        ...(currentShip.conditionState || {}),
        damage: 0.33,
        charge: 1,
        armorDamage: 0.14,
        shieldCharge: 0.48,
      },
    }));
    assert.equal(moveShipResult.success, true, "Expected ship move into structure hangar");
    setModuleDamage(candidate.fittedModuleID, {
      damage: 0.29,
      charge: 0,
      armorDamage: 0.18,
      shieldCharge: 0.72,
    });

    service.Handle_RepairItemsInStructure(
      [[candidate.shipID, candidate.fittedModuleID]],
      session,
    );

    const repairedShip = readItemRecord(candidate.shipID);
    const repairedModule = readItemRecord(candidate.fittedModuleID);
    assert.equal(repairedShip.locationID, structure.structureID);
    assert.equal(repairedShip.conditionState.damage, 0);
    assert.equal(repairedShip.conditionState.armorDamage, 0);
    assert.ok(repairedShip.conditionState.shieldCharge > 0.9999);
    assert.equal(repairedModule.moduleState.damage, 0);
    assert.equal(repairedModule.moduleState.armorDamage, 0);
    assert.ok(repairedModule.moduleState.shieldCharge > 0.9999);
    assert.ok(
      Number(getCharacterWallet(candidate.characterID).balance || 0) < fundedBalance,
      "Expected structure repair to charge the character wallet",
    );
    assert.ok(
      session._notifications.some(
        (entry) => entry.name === "OnModuleAttributeChanges",
      ),
      "Expected structure repair to push damage-state dogma updates to the client",
    );
    assert.equal(
      session._notifications.some((entry) => entry.name === "OnItemChange"),
      false,
      "Repair should not emit inventory location updates for pure condition-state changes",
    );
  } finally {
    sessionRegistry.unregister(session);
    writeCharacterRecord(candidate.characterID, originalCharacter);
    writeItemRecord(candidate.shipID, originalShip);
    writeItemRecord(candidate.fittedModuleID, originalModule);
    setCharacterBalance(candidate.characterID, originalWalletBalance, {
      description: "Repair parity structure repair restore",
    });
  }
});

test("dock and undock only restore shield and capacitor for free", { concurrency: false }, () => {
  const candidate = findDockedCandidate();
  const originalCharacter = cloneValue(getCharacterRecord(candidate.characterID));
  const originalShip = cloneValue(readItemRecord(candidate.shipID));
  const originalModule = candidate.fittedModuleID
    ? cloneValue(readItemRecord(candidate.fittedModuleID))
    : null;
  const session = buildSession();

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
    selectionEvent: false,
    deferDockedShipSessionChange: false,
  });
  assert.equal(applyResult.success, true, "Expected docked candidate session to hydrate");

  try {
    setShipDamage(candidate.shipID, {
      damage: 0.31,
      charge: 0.22,
      armorDamage: 0.47,
      shieldCharge: 0.18,
    });
    if (candidate.fittedModuleID) {
      setModuleDamage(candidate.fittedModuleID, {
        damage: 0.36,
        armorDamage: 0.14,
      });
    }

    const undockResult = transitions.undockSession(session);
    assert.equal(undockResult.success, true, "Expected undock transition to succeed");

    const shipAfterUndock = getActiveShipRecord(candidate.characterID);
    assert.ok(shipAfterUndock, "Expected active ship after undock");
    assert.equal(shipAfterUndock.conditionState.damage, 0.31);
    assert.equal(shipAfterUndock.conditionState.armorDamage, 0.47);
    assert.equal(shipAfterUndock.conditionState.shieldCharge, 1);
    assert.equal(shipAfterUndock.conditionState.charge, 1);
    if (candidate.fittedModuleID) {
      const moduleAfterUndock = readItemRecord(candidate.fittedModuleID);
      assert.equal(moduleAfterUndock.moduleState.damage, 0.36);
      assert.equal(moduleAfterUndock.moduleState.armorDamage, 0.14);
    }

    setLiveShipConditionState(session, candidate.shipID, {
      damage: 0.29,
      charge: 0.19,
      armorDamage: 0.53,
      shieldCharge: 0.11,
    });
    if (candidate.fittedModuleID) {
      setModuleDamage(candidate.fittedModuleID, {
        damage: 0.42,
        armorDamage: 0.23,
      });
    }

    const dockResult = transitions.dockSession(session, candidate.stationID);
    assert.equal(dockResult.success, true, "Expected dock transition to succeed");

    const shipAfterDock = getActiveShipRecord(candidate.characterID);
    assert.ok(shipAfterDock, "Expected active ship after dock");
    assert.equal(shipAfterDock.conditionState.damage, 0.29);
    assert.equal(shipAfterDock.conditionState.armorDamage, 0.53);
    assert.equal(shipAfterDock.conditionState.shieldCharge, 1);
    assert.equal(shipAfterDock.conditionState.charge, 1);
    if (candidate.fittedModuleID) {
      const moduleAfterDock = readItemRecord(candidate.fittedModuleID);
      assert.equal(moduleAfterDock.moduleState.damage, 0.42);
      assert.equal(moduleAfterDock.moduleState.armorDamage, 0.23);
    }
  } finally {
    if (!(session.stationid || session.stationID)) {
      transitions.dockSession(session, candidate.stationID);
    }
    writeCharacterRecord(candidate.characterID, originalCharacter);
    writeItemRecord(candidate.shipID, originalShip);
    if (candidate.fittedModuleID && originalModule) {
      writeItemRecord(candidate.fittedModuleID, originalModule);
    }
  }
});
