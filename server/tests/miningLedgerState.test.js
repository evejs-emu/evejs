const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const config = require(path.join(repoRoot, "server/src/config"));
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const {
  LEDGER_RETENTION_DAYS,
  MINING_LEDGER_TABLE,
  buildVisibleAfterFiletime,
  buildDefaultMiningLedgerTable,
  clearMiningLedgerCaches,
  filetimeFromUnixMs,
  getCharacterMiningLogs,
  getObserverMiningLedger,
  listObserverHeadersForCorporation,
  maybePruneExpiredEntries,
  recordMiningLedgerEvent,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningLedgerState",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readLedgerSnapshot() {
  const result = database.read(MINING_LEDGER_TABLE, "/");
  return result && result.success && result.data
    ? cloneValue(result.data)
    : buildDefaultMiningLedgerTable();
}

function writeLedgerSnapshot(snapshot) {
  database.write(MINING_LEDGER_TABLE, "/", cloneValue(snapshot));
  clearMiningLedgerCaches();
}

test("recordMiningLedgerEvent stores personal mining history newest-first", (t) => {
  const originalSnapshot = readLedgerSnapshot();
  const originalCharacterDelayMs = config.miningCharacterLedgerDelayMs;
  const originalObserverDelayMs = config.miningObserverLedgerDelayMs;
  t.after(() => {
    config.miningCharacterLedgerDelayMs = originalCharacterDelayMs;
    config.miningObserverLedgerDelayMs = originalObserverDelayMs;
    writeLedgerSnapshot(originalSnapshot);
    database.flushAllSync();
  });

  config.miningCharacterLedgerDelayMs = 0;
  config.miningObserverLedgerDelayMs = 0;
  writeLedgerSnapshot(buildDefaultMiningLedgerTable());

  const firstResult = recordMiningLedgerEvent({
    characterID: 99000001,
    corporationID: 98000001,
    solarSystemID: 30000142,
    typeID: 1230,
    quantity: 120,
    quantityWasted: 4,
    quantityCritical: 8,
    shipTypeID: 22544,
    moduleTypeID: 482,
    yieldKind: "ore",
    eventDateMs: Date.now() - 2_000,
  });
  const secondResult = recordMiningLedgerEvent({
    characterID: 99000001,
    corporationID: 98000001,
    solarSystemID: 30000142,
    typeID: 18,
    quantity: 80,
    quantityWasted: 0,
    quantityCritical: 0,
    shipTypeID: 22544,
    moduleTypeID: 482,
    yieldKind: "ore",
    eventDateMs: Date.now() - 1_000,
  });

  assert.equal(firstResult.success, true);
  assert.equal(secondResult.success, true);

  const logs = getCharacterMiningLogs(99000001);
  assert.equal(logs.length, 2);
  assert.equal(logs[0].typeID, 18);
  assert.equal(logs[0].quantity, 80);
  assert.equal(logs[1].typeID, 1230);
  assert.equal(logs[1].quantityWasted, 4);
});

test("ledger pruning drops entries older than the 90 day CCP window", (t) => {
  const originalSnapshot = readLedgerSnapshot();
  const originalCharacterDelayMs = config.miningCharacterLedgerDelayMs;
  const originalObserverDelayMs = config.miningObserverLedgerDelayMs;
  t.after(() => {
    config.miningCharacterLedgerDelayMs = originalCharacterDelayMs;
    config.miningObserverLedgerDelayMs = originalObserverDelayMs;
    writeLedgerSnapshot(originalSnapshot);
    database.flushAllSync();
  });

  config.miningCharacterLedgerDelayMs = 0;
  config.miningObserverLedgerDelayMs = 0;
  const staleTimestampMs =
    Date.now() - ((LEDGER_RETENTION_DAYS + 2) * 24 * 60 * 60 * 1000);
  const snapshot = buildDefaultMiningLedgerTable();
  snapshot.characters["99000002"] = {
    characterID: 99000002,
    corporationID: 98000002,
    entries: [{
      entryID: 1,
      eventDate: filetimeFromUnixMs(staleTimestampMs).toString(),
      characterID: 99000002,
      corporationID: 98000002,
      solarSystemID: 30000142,
      typeID: 1230,
      quantity: 50,
      quantityWasted: 0,
      quantityCritical: 0,
      shipTypeID: 22544,
      moduleTypeID: 482,
      yieldKind: "ore",
      observerItemID: 0,
    }],
  };

  writeLedgerSnapshot(snapshot);
  maybePruneExpiredEntries(filetimeFromUnixMs(Date.now()), { force: true });

  assert.deepEqual(getCharacterMiningLogs(99000002), []);
});

test("observer-backed ledger data stays isolated and future-proof for moon observers", (t) => {
  const originalSnapshot = readLedgerSnapshot();
  const originalCharacterDelayMs = config.miningCharacterLedgerDelayMs;
  const originalObserverDelayMs = config.miningObserverLedgerDelayMs;
  t.after(() => {
    config.miningCharacterLedgerDelayMs = originalCharacterDelayMs;
    config.miningObserverLedgerDelayMs = originalObserverDelayMs;
    writeLedgerSnapshot(originalSnapshot);
    database.flushAllSync();
  });

  config.miningCharacterLedgerDelayMs = 0;
  config.miningObserverLedgerDelayMs = 0;
  writeLedgerSnapshot(buildDefaultMiningLedgerTable());

  const recordResult = recordMiningLedgerEvent({
    characterID: 99000003,
    corporationID: 98000003,
    solarSystemID: 30002510,
    typeID: 20,
    quantity: 300,
    quantityWasted: 12,
    quantityCritical: 0,
    shipTypeID: 22544,
    moduleTypeID: 482,
    yieldKind: "ore",
    observerItemID: 1030000000001,
    observerItemName: "Test Athanor",
    eventDateMs: Date.now(),
  });

  assert.equal(recordResult.success, true);

  const observers = listObserverHeadersForCorporation(98000003);
  assert.equal(observers.length, 1);
  assert.equal(observers[0].itemID, 1030000000001);
  assert.equal(observers[0].itemName, "Test Athanor");

  const observerLogs = getObserverMiningLedger(1030000000001, 98000003);
  assert.equal(observerLogs.length, 1);
  assert.equal(observerLogs[0].characterID, 99000003);
  assert.equal(observerLogs[0].quantityWasted, 12);
});

test("ledger visibility delays hide fresh entries until their visibility window opens", (t) => {
  const originalSnapshot = readLedgerSnapshot();
  const originalCharacterDelayMs = config.miningCharacterLedgerDelayMs;
  const originalObserverDelayMs = config.miningObserverLedgerDelayMs;
  t.after(() => {
    config.miningCharacterLedgerDelayMs = originalCharacterDelayMs;
    config.miningObserverLedgerDelayMs = originalObserverDelayMs;
    writeLedgerSnapshot(originalSnapshot);
    database.flushAllSync();
  });

  config.miningCharacterLedgerDelayMs = 10 * 60 * 1000;
  config.miningObserverLedgerDelayMs = 60 * 60 * 1000;
  writeLedgerSnapshot(buildDefaultMiningLedgerTable());

  const eventDateMs = Date.now();
  const eventFiletime = filetimeFromUnixMs(eventDateMs);
  const recordResult = recordMiningLedgerEvent({
    characterID: 99000004,
    corporationID: 98000004,
    solarSystemID: 30000142,
    typeID: 1230,
    quantity: 125,
    quantityWasted: 5,
    shipTypeID: 22544,
    moduleTypeID: 482,
    yieldKind: "ore",
    observerItemID: 1030000000002,
    observerItemName: "Delayed Observer",
    eventDateMs,
  });
  assert.equal(recordResult.success, true);

  assert.deepEqual(
    getCharacterMiningLogs(99000004, {
      nowFiletime: eventFiletime,
    }),
    [],
  );
  assert.deepEqual(
    getObserverMiningLedger(1030000000002, 98000004, {
      nowFiletime: eventFiletime,
    }),
    [],
  );
  assert.deepEqual(
    listObserverHeadersForCorporation(98000004, {
      nowFiletime: eventFiletime,
    }),
    [],
  );

  const characterVisibleAt = buildVisibleAfterFiletime(
    eventFiletime,
    config.miningCharacterLedgerDelayMs,
  );
  const observerVisibleAt = buildVisibleAfterFiletime(
    eventFiletime,
    config.miningObserverLedgerDelayMs,
  );

  const personalLogs = getCharacterMiningLogs(99000004, {
    nowFiletime: characterVisibleAt,
  });
  assert.equal(personalLogs.length, 1);
  assert.equal(personalLogs[0].quantity, 125);

  assert.equal(
    getObserverMiningLedger(1030000000002, 98000004, {
      nowFiletime: characterVisibleAt,
    }).length,
    0,
  );

  const observerLogs = getObserverMiningLedger(1030000000002, 98000004, {
    nowFiletime: observerVisibleAt,
  });
  assert.equal(observerLogs.length, 1);
  assert.equal(observerLogs[0].quantityWasted, 5);
  assert.equal(
    listObserverHeadersForCorporation(98000004, {
      nowFiletime: observerVisibleAt,
    }).length,
    1,
  );
});
