const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const sessionRegistry = require(path.join(repoRoot, "server/src/services/chat/sessionRegistry"));
const bountyRuntime = require(path.join(repoRoot, "server/src/services/bounty/bountyRuntime"));
const {
  JOURNAL_ENTRY_TYPE,
  getCharacterWallet,
  getCharacterWalletJournal,
} = require(path.join(repoRoot, "server/src/services/account/walletState"));

const TEST_CHARACTER_ID = 990870001;
const TEST_SYSTEM_ID = 30000142;

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function seedState(balance = 100000) {
  const originalState = {
    characters: cloneValue(database.read("characters", "/").data || {}),
    items: cloneValue(database.read("items", "/").data || {}),
    skills: cloneValue(database.read("skills", "/").data || {}),
  };
  const nextCharacters = cloneValue(originalState.characters || {});
  nextCharacters[String(TEST_CHARACTER_ID)] = {
    ...(nextCharacters[String(TEST_CHARACTER_ID)] || {}),
    characterID: TEST_CHARACTER_ID,
    characterName: "Bounty Runtime Tester",
    corporationID: 1000045,
    raceID: 1,
    bloodlineID: 1,
    schoolID: 31,
    stationID: 60003760,
    solarSystemID: TEST_SYSTEM_ID,
    balance,
    balanceChange: 0,
    walletJournal: [],
  };
  const writeResult = database.write("characters", "/", nextCharacters, { force: true });
  assert.equal(writeResult.success, true);
  return originalState;
}

function restoreState(originalState) {
  database.write("characters", "/", originalState?.characters || {}, { force: true });
  database.write("items", "/", originalState?.items || {}, { force: true });
  database.write("skills", "/", originalState?.skills || {}, { force: true });
}

function buildSession() {
  const notifications = [];
  const session = {
    characterID: TEST_CHARACTER_ID,
    clientID: 12345,
    lastActivity: Date.now(),
    connectTime: Date.now(),
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
  sessionRegistry.register(session);
  return { session, notifications };
}

test("NPC bounty kill notifies immediately and pays wallet only when the payout bucket is due", (t) => {
  const originalState = seedState(100000);
  const { session, notifications } = buildSession();
  t.after(() => {
    sessionRegistry.unregister(session);
    bountyRuntime._testing.resetForTests();
    restoreState(originalState);
  });

  bountyRuntime._testing.resetForTests();
  bountyRuntime._testing.configureForTests({
    timerEnabled: false,
    payoutIntervalMs: 1000,
    nowProvider: () => 100,
  });

  const result = bountyRuntime.recordNpcBountyKill(
    {
      itemID: 880001,
      typeID: 16994,
      bounty: 3750,
      systemID: TEST_SYSTEM_ID,
    },
    { characterID: TEST_CHARACTER_ID },
    { nowMs: 100 },
  );

  assert.equal(result.amount, 3750);
  assert.equal(notifications.length, 1);
  assert.deepEqual(notifications[0], {
    name: "OnBountyAddedToPayout",
    idType: "charid",
    payload: [{
      enemyTypeID: 16994,
      amount: 3750,
      payoutTime: bountyRuntime.formatFiletime(1000),
      isModified: false,
    }],
  });
  assert.equal(getCharacterWallet(TEST_CHARACTER_ID).balance, 100000);

  const earlyFlush = bountyRuntime.flushDuePayouts(999);
  assert.equal(earlyFlush.flushed, 0);
  assert.equal(getCharacterWallet(TEST_CHARACTER_ID).balance, 100000);

  const flush = bountyRuntime.flushDuePayouts(1000);
  assert.equal(flush.flushed, 1);
  assert.equal(flush.amount, 3750);
  assert.equal(getCharacterWallet(TEST_CHARACTER_ID).balance, 103750);
  const journal = getCharacterWalletJournal(TEST_CHARACTER_ID);
  assert.equal(journal[0].entryTypeID, JOURNAL_ENTRY_TYPE.NPC_BOUNTY_PRIZE);
  assert.equal(journal[0].amount, 3750);
  assert.match(journal[0].description, /"16994":1/);
});

test("multiple NPC kills in one bucket pay as one grouped bounty prize", (t) => {
  const originalState = seedState(200000);
  const { session } = buildSession();
  t.after(() => {
    sessionRegistry.unregister(session);
    bountyRuntime._testing.resetForTests();
    restoreState(originalState);
  });

  bountyRuntime._testing.resetForTests();
  bountyRuntime._testing.configureForTests({
    timerEnabled: false,
    payoutIntervalMs: 1000,
    nowProvider: () => 250,
  });

  bountyRuntime.recordNpcBountyKill({ itemID: 1, typeID: 16994, bounty: 3000, systemID: TEST_SYSTEM_ID }, { characterID: TEST_CHARACTER_ID }, { nowMs: 250 });
  bountyRuntime.recordNpcBountyKill({ itemID: 2, typeID: 16981, bounty: 4500, systemID: TEST_SYSTEM_ID }, { characterID: TEST_CHARACTER_ID }, { nowMs: 260 });

  assert.equal(bountyRuntime.listPendingBuckets().length, 1);
  const flush = bountyRuntime.flushDuePayouts(1000);
  assert.equal(flush.flushed, 1);
  assert.equal(flush.amount, 7500);
  assert.equal(getCharacterWallet(TEST_CHARACTER_ID).balance, 207500);
  const journal = getCharacterWalletJournal(TEST_CHARACTER_ID);
  assert.equal(journal[0].entryTypeID, JOURNAL_ENTRY_TYPE.NPC_BOUNTY_PRIZES);
  assert.match(journal[0].description, /"16994":1/);
  assert.match(journal[0].description, /"16981":1/);
});

test("player victims never create NPC bounty payouts", (t) => {
  const originalState = seedState(300000);
  const { session, notifications } = buildSession();
  t.after(() => {
    sessionRegistry.unregister(session);
    bountyRuntime._testing.resetForTests();
    restoreState(originalState);
  });

  bountyRuntime._testing.resetForTests();
  bountyRuntime._testing.configureForTests({ timerEnabled: false });

  const result = bountyRuntime.recordNpcBountyKill(
    {
      itemID: 33,
      typeID: 603,
      bounty: 999999,
      characterID: 123456789,
      systemID: TEST_SYSTEM_ID,
    },
    { characterID: TEST_CHARACTER_ID },
  );

  assert.equal(result, null);
  assert.equal(notifications.length, 0);
  assert.equal(bountyRuntime.listPendingBuckets().length, 0);
  assert.equal(getCharacterWallet(TEST_CHARACTER_ID).balance, 300000);
});

test("bounty aggregation hot path handles one thousand bucket updates in sub-ms territory", () => {
  const result = bountyRuntime.benchmarkBucketAggregation(1000);
  assert.equal(result.pendingBuckets, 1);
  assert.equal(result.amount, 1000000);
  assert.ok(result.elapsedMs < 1.5, `expected 1000 bucket updates under 1.5ms, got ${result.elapsedMs}ms`);
});

test("bounty accrual gameplay path handles one thousand kills in one bucket without per-kill wallet writes", () => {
  const result = bountyRuntime.benchmarkAccrual(1000);
  assert.equal(result.pendingBuckets, 1);
  assert.ok(result.elapsedMs < 25, `expected 1000 accruals under 25ms on local test runtime, got ${result.elapsedMs}ms`);
});
