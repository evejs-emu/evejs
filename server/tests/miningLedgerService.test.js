const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const config = require(path.join(repoRoot, "server/src/config"));
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const MachoNetService = require(path.join(
  repoRoot,
  "server/src/services/machoNet/machoNetService",
));
const CharacterMiningLedgerService = require(path.join(
  repoRoot,
  "server/src/services/mining/characterMiningLedgerService",
));
const CorpMiningLedgerService = require(path.join(
  repoRoot,
  "server/src/services/mining/corpMiningLedgerService",
));
const {
  MINING_LEDGER_TABLE,
  buildDefaultMiningLedgerTable,
  clearMiningLedgerCaches,
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

function getKeyValEntry(objectValue, key) {
  const entries =
    objectValue &&
    objectValue.args &&
    objectValue.args.type === "dict" &&
    Array.isArray(objectValue.args.entries)
      ? objectValue.args.entries
      : [];
  const match = entries.find(([entryKey]) => entryKey === key);
  return match ? match[1] : undefined;
}

test("mining ledger services return CCP-style util.KeyVal lists and machoNet exposes them", (t) => {
  const originalSnapshot = readLedgerSnapshot();
  const originalCharacterDelayMs = config.miningCharacterLedgerDelayMs;
  const originalObserverDelayMs = config.miningObserverLedgerDelayMs;
  t.after(() => {
    writeLedgerSnapshot(originalSnapshot);
    config.miningCharacterLedgerDelayMs = originalCharacterDelayMs;
    config.miningObserverLedgerDelayMs = originalObserverDelayMs;
    database.flushAllSync();
  });

  config.miningCharacterLedgerDelayMs = 0;
  config.miningObserverLedgerDelayMs = 0;
  writeLedgerSnapshot(buildDefaultMiningLedgerTable());
  recordMiningLedgerEvent({
    characterID: 99000011,
    corporationID: 98000011,
    solarSystemID: 30000142,
    typeID: 1230,
    quantity: 150,
    quantityWasted: 6,
    quantityCritical: 2,
    shipTypeID: 22544,
    moduleTypeID: 482,
    yieldKind: "ore",
    observerItemID: 1030000000011,
    observerItemName: "Ledger Test Refinery",
    eventDateMs: Date.now(),
  });

  const characterService = new CharacterMiningLedgerService();
  const corpService = new CorpMiningLedgerService();
  const machoNetService = new MachoNetService();

  const characterSession = {
    characterID: 99000011,
    corporationID: 98000011,
    corpid: 98000011,
  };
  const corpSession = {
    characterID: 99000011,
    corporationID: 98000011,
    corpid: 98000011,
    corprole: 256n,
  };

  const characterPayload = characterService.Handle_GetCharacterLogs([], characterSession);
  assert.equal(characterPayload.type, "list");
  assert.equal(characterPayload.items.length, 1);
  assert.equal(characterPayload.items[0].name, "util.KeyVal");
  assert.equal(getKeyValEntry(characterPayload.items[0], "typeID"), 1230);
  assert.equal(getKeyValEntry(characterPayload.items[0], "quantityWasted"), 6);
  assert.equal(getKeyValEntry(characterPayload.items[0], "yieldKind"), "ore");

  const observerHeadersPayload = corpService.Handle_GetObserversWithMiningEvents([], corpSession);
  assert.equal(observerHeadersPayload.type, "list");
  assert.equal(observerHeadersPayload.items.length, 1);
  assert.equal(
    getKeyValEntry(observerHeadersPayload.items[0], "itemName"),
    "Ledger Test Refinery",
  );

  const observerLedgerPayload = corpService.Handle_GetObserverLedger([1030000000011], corpSession);
  assert.equal(observerLedgerPayload.type, "list");
  assert.equal(observerLedgerPayload.items.length, 1);
  assert.equal(getKeyValEntry(observerLedgerPayload.items[0], "characterID"), 99000011);
  assert.equal(getKeyValEntry(observerLedgerPayload.items[0], "quantity"), 150);

  const serviceInfoEntries = machoNetService.getServiceInfoDict().entries.map(([name]) => name);
  assert.ok(serviceInfoEntries.includes("characterMiningLedger"));
  assert.ok(serviceInfoEntries.includes("corpMiningLedger"));
});
