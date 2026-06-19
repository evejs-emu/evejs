const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
  applyCharacterToSession,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const { restoreSpaceSession } = require(path.join(
  repoRoot,
  "server/src/space/transitions",
));
const {
  calculateShipDerivedAttributes,
  getFittedModuleItems,
  getLoadedChargeItems,
  isShipFittingFlag,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const { ITEM_FLAGS } = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));

function getInventoryEntries(value) {
  if (value && value.type === "list" && Array.isArray(value.items)) {
    return value.items
      .map((item) => (item && item.type === "packedrow" && item.fields ? item.fields : item))
      .filter(Boolean);
  }
  return [];
}

function hasTupleInventoryEntry(entries, shipID, flagID, typeID) {
  const tupleKey = [Number(shipID) || 0, Number(flagID) || 0, Number(typeID) || 0];
  return entries.some((entry) => {
    const itemID = entry && entry.itemID;
    return (
      Array.isArray(itemID) &&
      Number(itemID[0]) === tupleKey[0] &&
      Number(itemID[1]) === tupleKey[1] &&
      Number(itemID[2]) === tupleKey[2]
    );
  });
}

function hasRealInventoryEntry(entries, itemID) {
  const numericItemID = Number(itemID) || 0;
  return entries.some((entry) => Number(entry && entry.itemID) === numericItemID);
}

function extractDictEntries(value) {
  if (value && value.type === "dict" && Array.isArray(value.entries)) {
    return value.entries;
  }
  return [];
}

function extractKeyValEntries(value) {
  if (
    value &&
    value.type === "object" &&
    value.name === "util.KeyVal" &&
    value.args &&
    value.args.type === "dict" &&
    Array.isArray(value.args.entries)
  ) {
    return value.args.entries;
  }
  return [];
}

function getKeyValEntry(value, key) {
  return extractKeyValEntries(value).find((entry) => entry[0] === key)?.[1] ?? null;
}

function extractOnItemChangeItemIDs(notifications) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification.name === "OnItemChange")
    .map((notification) => {
      const payload = Array.isArray(notification.payload) ? notification.payload[0] : null;
      const itemRow =
        payload &&
        payload.type === "packedrow" &&
        payload.fields &&
        typeof payload.fields === "object"
          ? payload.fields
          : null;
      return Number(itemRow && itemRow.itemID) || 0;
    })
    .filter((itemID) => itemID > 0)
    .sort((left, right) => left - right);
}

function extractOnItemChangeRawItemIDs(notifications) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification.name === "OnItemChange")
    .map((notification) => {
      const payload = Array.isArray(notification.payload) ? notification.payload[0] : null;
      const itemRow =
        payload &&
        payload.type === "packedrow" &&
        payload.fields &&
        typeof payload.fields === "object"
          ? payload.fields
          : null;
      return itemRow ? itemRow.itemID : null;
    })
    .filter((itemID) => itemID !== null && itemID !== undefined);
}

function extractModuleAttributeChanges(notifications) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification.name === "OnModuleAttributeChanges")
    .flatMap((notification) => {
      const payload = Array.isArray(notification.payload)
        ? notification.payload[0]
        : null;
      return payload && payload.type === "list" && Array.isArray(payload.items)
        ? payload.items
        : [];
    });
}

function countRawOnItemChangesByItemID(notifications, expectedItemID) {
  const numericExpectedItemID = Number(expectedItemID) || 0;
  return extractOnItemChangeRawItemIDs(notifications).filter(
    (itemID) => Number(itemID) === numericExpectedItemID,
  ).length;
}

function countRawOnItemChangesByTupleKey(
  notifications,
  shipID,
  flagID,
  typeID,
) {
  const numericShipID = Number(shipID) || 0;
  const numericFlagID = Number(flagID) || 0;
  const numericTypeID = Number(typeID) || 0;
  return extractOnItemChangeRawItemIDs(notifications).filter(
    (itemID) =>
      Array.isArray(itemID) &&
      Number(itemID[0]) === numericShipID &&
      Number(itemID[1]) === numericFlagID &&
      Number(itemID[2]) === numericTypeID,
  ).length;
}

function countChargeQuantityChangesByTupleKey(
  notifications,
  shipID,
  flagID,
  typeID,
) {
  const numericShipID = Number(shipID) || 0;
  const numericFlagID = Number(flagID) || 0;
  const numericTypeID = Number(typeID) || 0;
  return extractModuleAttributeChanges(notifications).filter((change) => {
    const itemID = Array.isArray(change) ? change[2] : null;
    return (
      Array.isArray(itemID) &&
      Number(itemID[0]) === numericShipID &&
      Number(itemID[1]) === numericFlagID &&
      Number(itemID[2]) === numericTypeID &&
      Number(Array.isArray(change) ? change[3] : 0) === 805
    );
  }).length;
}

function getInSpaceCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters");

  const candidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const characterRecord = getCharacterRecord(characterID);
      const ship = getActiveShipRecord(characterID);
      if (!characterRecord || !ship || !ship.spaceState) {
        return null;
      }
      if (Number(characterRecord.stationID || characterRecord.stationid || 0) > 0) {
        return null;
      }

      const fittedModules = getFittedModuleItems(characterID, ship.itemID)
        .filter((item) => item && isShipFittingFlag(item.flagID));
      if (fittedModules.length === 0) {
        return null;
      }

      return {
        characterID,
        characterRecord,
        ship,
        fittedModules,
        loadedCharges: getLoadedChargeItems(characterID, ship.itemID),
      };
    })
    .filter(Boolean);

  assert.ok(candidates.length > 0, "Expected an in-space character with fitted modules");
  return (
    candidates.find((candidate) => Array.isArray(candidate.loadedCharges) && candidate.loadedCharges.length > 0) ||
    candidates[0]
  );
}

function buildSession(candidate) {
  return {
    clientID: candidate.characterID + 9900,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    userid: candidate.characterID,
    shipID: candidate.ship.itemID,
    shipid: candidate.ship.itemID,
    activeShipID: candidate.ship.itemID,
    stationid: null,
    stationID: null,
    locationid:
      Number(candidate.characterRecord.solarSystemID || candidate.characterRecord.solarsystemid || 0) ||
      Number(candidate.ship.locationID || 0) ||
      30000142,
    solarsystemid:
      Number(candidate.characterRecord.solarSystemID || candidate.characterRecord.solarsystemid || 0) ||
      30000142,
    solarsystemid2:
      Number(candidate.characterRecord.solarSystemID || candidate.characterRecord.solarsystemid || 0) ||
      30000142,
    socket: { destroyed: false },
    currentBoundObjectID: null,
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
  };
}

function bindShipInventory(service, session, shipID) {
  const bound = service.Handle_GetInventoryFromId([shipID], session);
  const boundID =
    bound &&
    bound.type === "substruct" &&
    bound.value &&
    bound.value.type === "substream" &&
    Array.isArray(bound.value.value)
      ? bound.value.value[0]
      : null;
  assert.ok(boundID, "Expected GetInventoryFromId to return a bound inventory substruct");
  session.currentBoundObjectID = boundID;
}

test("GetAvailableTurretSlots returns a numeric free-turret count for the active ship", () => {
  const candidate = getInSpaceCandidate();
  const service = new InvBrokerService();
  const session = buildSession(candidate);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const expectedTurretSlotsLeft = Number(
    calculateShipDerivedAttributes(candidate.characterID, candidate.ship)
      .resourceState
      .turretSlotsLeft,
  ) || 0;

  const freeTurretSlots = service.Handle_GetAvailableTurretSlots([], session);
  assert.equal(typeof freeTurretSlots, "number");
  assert.equal(freeTurretSlots, expectedTurretSlotsLeft);
});

async function waitFor(predicate, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("in-space ship inventory List() defaults to full contents just like explicit flag=None", () => {
  const candidate = getInSpaceCandidate();
  const service = new InvBrokerService();
  const session = buildSession(candidate);

  bindShipInventory(service, session, candidate.ship.itemID);

  const defaultList = service.Handle_List([], session, {});
  const explicitNullList = service.Handle_List([], session, {
    type: "dict",
    entries: [
      ["flag", null],
      ["machoVersion", 1],
    ],
  });

  const defaultItemIDs = new Set(
    getInventoryEntries(defaultList)
      .map((row) => Number(row.itemID) || 0)
      .filter((itemID) => itemID > 0),
  );
  const explicitNullItemIDs = new Set(
    getInventoryEntries(explicitNullList)
      .map((row) => Number(row.itemID) || 0)
      .filter((itemID) => itemID > 0),
  );

  for (const moduleItem of candidate.fittedModules) {
    assert.equal(
      defaultItemIDs.has(Number(moduleItem.itemID)),
      false,
      `Expected plain in-space List() to exclude fitted module ${moduleItem.itemID}`,
    );
    assert.equal(
      explicitNullItemIDs.has(Number(moduleItem.itemID)),
      true,
      `Expected explicit List(flag=None) to include fitted module ${moduleItem.itemID}`,
    );
  }
});

test("space login keeps explicit List(flag=None) on the stock ship inventory path", () => {
  const candidate = getInSpaceCandidate();
  const service = new InvBrokerService();
  const session = buildSession(candidate);
  session._loginInventoryBootstrapPending = true;

  bindShipInventory(service, session, candidate.ship.itemID);

  const firstNullList = service.Handle_List([], session, {
    type: "dict",
    entries: [
      ["flag", null],
      ["machoVersion", 1],
    ],
  });
  const secondNullList = service.Handle_List([], session, {
    type: "dict",
    entries: [
      ["flag", null],
      ["machoVersion", 1],
    ],
  });
  const firstNullItemIDs = new Set(
    getInventoryEntries(firstNullList)
      .map((row) => Number(row.itemID) || 0)
      .filter((itemID) => itemID > 0),
  );
  const secondNullItemIDs = new Set(
    getInventoryEntries(secondNullList)
      .map((row) => Number(row.itemID) || 0)
      .filter((itemID) => itemID > 0),
  );

  assert.equal(
    session._loginInventoryBootstrapPending,
    false,
    "Expected the initial login ship-inventory gate to clear after the first List()",
  );

  for (const moduleItem of candidate.fittedModules) {
    assert.equal(
      firstNullItemIDs.has(Number(moduleItem.itemID)),
      true,
      `Expected the first login-space List(flag=None) to preserve fitted module ${moduleItem.itemID} on the stock inventory path`,
    );
    assert.equal(
      secondNullItemIDs.has(Number(moduleItem.itemID)),
      true,
      `Expected later List(flag=None) calls to keep fitted module ${moduleItem.itemID} visible on the stock inventory path`,
    );
  }
});

test("space login GetAllInfo primes loaded charges as TQ tuple rows and leaves real charge rows out", () => {
  const candidate = getInSpaceCandidate();
  const session = buildSession(candidate);
  const dogma = new DogmaService();
  session._loginInventoryBootstrapPending = true;

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  assert.equal(restoreSpaceSession(session), true);
  assert.ok(session._space, "expected login restore to attach the space session");

  const allInfo = dogma.Handle_GetAllInfo([true, true, null], session);
  const shipInfo = getKeyValEntry(allInfo, "shipInfo");
  const shipState = getKeyValEntry(allInfo, "shipState");
  const shipInfoEntries = extractDictEntries(shipInfo);
  const shipInfoItemIDs = shipInfoEntries
    .map((entry) => Number(Array.isArray(entry) ? entry[0] : 0) || 0)
    .filter((itemID) => itemID > 0)
    .sort((left, right) => left - right);
  const shipStateChargeEntries = extractDictEntries(shipState && shipState[1]);
  const shipStateChargeFlags =
    shipStateChargeEntries.length > 0
      ? extractDictEntries(shipStateChargeEntries[0][1])
          .map((entry) => Number(entry[0]) || 0)
          .filter((flagID) => flagID > 0)
          .sort((left, right) => left - right)
      : [];
  const expectedChargeFlags = candidate.loadedCharges
    .map((item) => Number(item.flagID) || 0)
    .filter((flagID) => flagID > 0)
    .sort((left, right) => left - right);

  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      shipInfoEntries.some((entry) => (
        Array.isArray(entry) &&
        Array.isArray(entry[0]) &&
        Number(entry[0][0]) === Number(candidate.ship.itemID) &&
        Number(entry[0][1]) === Number(loadedCharge.flagID) &&
        Number(entry[0][2]) === Number(loadedCharge.typeID)
      )),
      true,
      `expected login GetAllInfo.shipInfo to include tuple charge for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      shipInfoItemIDs.includes(Number(loadedCharge.itemID) || 0),
      false,
      `expected login GetAllInfo.shipInfo to keep real loaded charge ${loadedCharge.itemID} off the in-space HUD bootstrap path`,
    );
  }
  assert.deepEqual(
    shipStateChargeFlags,
    expectedChargeFlags,
    "expected login GetAllInfo.shipState to keep charge sublocations on the stock shipState path",
  );
});

test("space login GetAllInfo marshals ship capacitor stats as reals for in-space fitting panels", () => {
  const candidate = getInSpaceCandidate();
  const session = buildSession(candidate);
  const dogma = new DogmaService();
  session._loginInventoryBootstrapPending = true;

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  assert.equal(restoreSpaceSession(session), true);
  assert.ok(session._space, "expected login restore to attach the space session");

  const allInfo = dogma.Handle_GetAllInfo([true, true, null], session);
  const shipInfo = getKeyValEntry(allInfo, "shipInfo");
  const shipInfoEntry = extractDictEntries(shipInfo).find(
    (entry) => Number(Array.isArray(entry) ? entry[0] : 0) === Number(candidate.ship.itemID),
  )?.[1];
  assert.ok(shipInfoEntry, "expected in-space GetAllInfo.shipInfo to include the active ship");

  const shipAttributes = getKeyValEntry(shipInfoEntry, "attributes");
  const shipAttributeEntries = new Map(extractDictEntries(shipAttributes));
  const rechargeRateValue = shipAttributeEntries.get(55);
  const capacitorCapacityValue = shipAttributeEntries.get(482);
  const derivedAttributes = calculateShipDerivedAttributes(
    candidate.characterID,
    candidate.ship,
  );

  assert.deepEqual(
    rechargeRateValue && rechargeRateValue.type,
    "real",
    "expected in-space ship recharge rate to stay marshaled as a real so fitting capacitor math avoids Python 2 integer division",
  );
  assert.equal(
    Number.isFinite(Number(rechargeRateValue && rechargeRateValue.value)),
    true,
    "expected in-space ship recharge rate marshal value to stay numeric",
  );
  assert.equal(
    Number(rechargeRateValue && rechargeRateValue.value) > 0,
    true,
    "expected in-space ship recharge rate marshal value to stay positive",
  );
  assert.deepEqual(
    capacitorCapacityValue && capacitorCapacityValue.type,
    "real",
    "expected in-space ship capacitor capacity to stay marshaled as a real for fitting capacitor parity",
  );
  assert.equal(
    Number(capacitorCapacityValue && capacitorCapacityValue.value),
    Number(derivedAttributes.resourceState.capacitorCapacity) || 0,
    "expected in-space ship capacitor capacity marshal value to stay aligned with the derived ship state",
  );
});

test("post-login ship inventory requests do not add synthetic notification churn while keeping loaded charges tuple-backed", async () => {
  const candidate = getInSpaceCandidate();
  const service = new InvBrokerService();
  const session = buildSession(candidate);
  session._loginInventoryBootstrapPending = true;

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  assert.equal(restoreSpaceSession(session), true);
  session._space.beyonceBound = true;
  session._space.initialStateSent = true;
  session.notifications.length = 0;

  bindShipInventory(service, session, candidate.ship.itemID);

  const shipList = service.Handle_List([], session, {
    type: "dict",
    entries: [
      ["flag", null],
      ["machoVersion", 1],
    ],
  });

  const postBootstrapList = service.Handle_List([ITEM_FLAGS.DRONE_BAY], session, {});

  assert.equal(
    session._space && session._space.loginShipInventoryPrimed,
    true,
    "expected login ship inventory access to stay on the stock attach path",
  );
  assert.equal(session._space.loginInventoryBootstrapPending, false);
  assert.equal(
    session.notifications.some((notification) => notification.name === "OnGodmaShipEffect"),
    false,
    "expected login ship inventory requests to avoid redundant online-effect notifications",
  );
  const syntheticItemChangeIDs = [...new Set(extractOnItemChangeItemIDs(session.notifications))].sort(
    (left, right) => left - right,
  );
  assert.deepEqual(
    syntheticItemChangeIDs,
    [],
    "expected login ship inventory requests to avoid notification churn before the later HUD bootstrap",
  );
  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      extractOnItemChangeRawItemIDs(session.notifications).some(
        (itemID) => Number(itemID) === Number(loadedCharge.itemID),
      ),
      false,
      `expected login ship inventory requests to avoid resending real loaded charge row ${loadedCharge.itemID}`,
    );
    assert.equal(
      countChargeQuantityChangesByTupleKey(
        session.notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected login ship inventory requests to keep tuple-backed charge repair deferred until the HUD bootstrap for slot ${loadedCharge.flagID}`,
    );
  }

  assert.ok(getInventoryEntries(shipList).length >= 0);
  assert.ok(getInventoryEntries(postBootstrapList).length >= 0);
});

test("post-login ship inventory ListByFlags does not add notification churn on the stock login path", async () => {
  const candidate = getInSpaceCandidate();
  const service = new InvBrokerService();
  const session = buildSession(candidate);
  session._loginInventoryBootstrapPending = true;

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  assert.equal(restoreSpaceSession(session), true);
  session._space.beyonceBound = true;
  session._space.initialStateSent = true;
  session.notifications.length = 0;

  bindShipInventory(service, session, candidate.ship.itemID);

  service.Handle_List([], session, {
    type: "dict",
    entries: [
      ["flag", null],
      ["machoVersion", 1],
    ],
  });
  const syntheticItemChangeIDsAfterPrime = [...new Set(extractOnItemChangeItemIDs(session.notifications))].sort(
    (left, right) => left - right,
  );
  assert.deepEqual(
    syntheticItemChangeIDsAfterPrime,
    [],
    "expected the first login ship inventory request to avoid synthetic fitted-module item changes before ListByFlags",
  );

  const fittingFlags = Array.from(
    new Set(
      candidate.fittedModules
        .map((item) => Number(item && item.flagID) || 0)
        .filter((flagID) => flagID > 0),
    ),
  );
  const requestedFlags = [ITEM_FLAGS.CARGO_HOLD, ...fittingFlags.slice(0, 2)];
  service.Handle_ListByFlags([requestedFlags], session, {});

  assert.equal(
    session._space && session._space.loginShipInventoryPrimed,
    true,
    "expected fitting ListByFlags requests to stay on the stock login attach path",
  );
  assert.equal(session._space.loginInventoryBootstrapPending, false);
  assert.deepEqual(
    [...new Set(extractOnItemChangeItemIDs(session.notifications))].sort(
      (left, right) => left - right,
    ),
    [],
    "expected fitting ListByFlags to avoid synthetic fitted-module item changes before the HUD bootstrap",
  );
  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      extractOnItemChangeRawItemIDs(session.notifications).some(
        (itemID) => Number(itemID) === Number(loadedCharge.itemID),
      ),
      false,
      `expected fitting ListByFlags to avoid resending real loaded charge row ${loadedCharge.itemID}`,
    );
    assert.equal(
      countChargeQuantityChangesByTupleKey(
        session.notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected fitting ListByFlags to avoid tuple-backed charge notification churn for slot ${loadedCharge.flagID} before the HUD bootstrap`,
    );
  }
});

test("settled in-space full ship lists return tuple charge rows without notification churn", () => {
  const candidate = getInSpaceCandidate();
  const service = new InvBrokerService();
  const session = buildSession(candidate);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  assert.equal(restoreSpaceSession(session), true);
  assert.ok(session._space, "expected space restore to attach a live _space state");
  session._space.beyonceBound = true;
  session._space.initialStateSent = true;
  session._space.loginShipInventoryPrimed = true;
  session._space.loginInventoryBootstrapPending = false;
  session.notifications.length = 0;

  bindShipInventory(service, session, candidate.ship.itemID);

  const firstShipList = service.Handle_List([], session, {
    type: "dict",
    entries: [
      ["flag", null],
      ["machoVersion", 1],
    ],
  });
  const firstShipListEntries = getInventoryEntries(firstShipList);

  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      hasTupleInventoryEntry(
        firstShipListEntries,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      true,
      `expected the first settled full ship list to expose tuple charge slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      hasRealInventoryEntry(firstShipListEntries, loadedCharge.itemID),
      false,
      `expected the first settled full ship list not to expose real loaded charge row ${loadedCharge.itemID}`,
    );
    assert.equal(
      extractOnItemChangeRawItemIDs(session.notifications).some(
        (itemID) => Number(itemID) === Number(loadedCharge.itemID),
      ),
      false,
      `expected the settled fitting list to avoid resending real loaded charge row ${loadedCharge.itemID}`,
    );
    assert.equal(
      countRawOnItemChangesByTupleKey(
        session.notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected the settled full ship list to avoid resending tuple charge slot ${loadedCharge.flagID}`,
    );
  }

  const secondShipList = service.Handle_List([], session, {
    type: "dict",
    entries: [
      ["flag", null],
      ["machoVersion", 1],
    ],
  });
  const secondShipListEntries = getInventoryEntries(secondShipList);

  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      hasTupleInventoryEntry(
        secondShipListEntries,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      true,
      `expected repeated settled full ship lists to keep exposing tuple charge slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      hasRealInventoryEntry(secondShipListEntries, loadedCharge.itemID),
      false,
      `expected repeated settled full ship lists not to expose real loaded charge row ${loadedCharge.itemID}`,
    );
    assert.equal(
      countRawOnItemChangesByTupleKey(
        session.notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected repeated settled full ship lists to avoid resending tuple charge slot ${loadedCharge.flagID}`,
    );
  }
});
