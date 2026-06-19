const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const sessionRegistry = require(path.join(repoRoot, "server/src/services/chat/sessionRegistry"));
const chatCommands = require(path.join(repoRoot, "server/src/services/chat/chatCommands"));
const LPService = require(path.join(repoRoot, "server/src/services/corporation/lpService"));
const {
  currentFileTime,
} = require(path.join(repoRoot, "server/src/services/_shared/serviceHelpers"));
const {
  updateCharacterRecord,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));
const {
  createCustomAllianceForCorporation,
  createCustomCorporation,
  joinCorporationToAllianceByName,
} = require(path.join(repoRoot, "server/src/services/corporation/corporationState"));
const {
  recordAllianceMemberJoin,
} = require(path.join(repoRoot, "server/src/services/corporation/allianceViewState"));
const {
  EVERMARK_ISSUER_CORP_ID,
  adjustCharacterWalletLPBalance,
  getCharacterWalletLPBalance,
  getCorporationWalletLPBalance,
  setCorporationWalletLPBalance,
} = require(path.join(repoRoot, "server/src/services/corporation/lpWalletState"));
const {
  _testing: corporationRuntimeTesting,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/corporationRuntimeState",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function filetimeDaysAgo(days) {
  return (currentFileTime() - BigInt(days) * 864000000000n).toString();
}

function buildLiveSession(overrides = {}) {
  const notifications = [];
  return {
    clientID: 440011,
    characterID: 140000001,
    corporationID: 980090001,
    corpid: 980090001,
    allianceID: null,
    allianceid: null,
    corprole: 0n,
    socket: {
      destroyed: false,
    },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    _notifications: notifications,
    ...overrides,
  };
}

test("EverMarks grants round-trip through LPSvc wallet readers and live LP notifications", (t) => {
  const lpWalletsBackup = cloneValue(database.read("lpWallets", "/").data || {});
  t.after(() => {
    database.write("lpWallets", "/", lpWalletsBackup);
    database.flushAllSync();
    corporationRuntimeTesting.resetRuntimeCaches();
  });

  database.write("lpWallets", "/", {
    _meta: {
      generatedAt: null,
      lastUpdatedAt: null,
    },
    characterWallets: {},
    corporationWallets: {},
  });

  const session = buildLiveSession();
  sessionRegistry.register(session);
  t.after(() => {
    sessionRegistry.unregister(session);
  });

  const grantResult = adjustCharacterWalletLPBalance(
    session.characterID,
    EVERMARK_ISSUER_CORP_ID,
    750,
    { changeType: "admin_adjust" },
  );
  assert.equal(grantResult.success, true);
  assert.equal(grantResult.data.amount, 750);
  assert.equal(
    session._notifications.some((entry) => entry.name === "OnLPChange"),
    true,
    "Expected a live LP wallet notification for EverMarks",
  );

  const lpService = new LPService();
  const characterBalances = lpService.Handle_GetAllMyCharacterWalletLPBalances([], session);
  assert.equal(characterBalances && characterBalances.type, "list");
  assert.equal(characterBalances.items.length, 1);
  assert.deepEqual(characterBalances.items[0].items, [EVERMARK_ISSUER_CORP_ID, 750]);
  assert.equal(
    lpService.Handle_GetLPForCharacterCorp([EVERMARK_ISSUER_CORP_ID], session),
    750,
  );
});

test("/addevermarks updates wallet summary and corp LP rows stay available for the UI", (t) => {
  const lpWalletsBackup = cloneValue(database.read("lpWallets", "/").data || {});
  t.after(() => {
    database.write("lpWallets", "/", lpWalletsBackup);
    database.flushAllSync();
    corporationRuntimeTesting.resetRuntimeCaches();
  });

  database.write("lpWallets", "/", {
    _meta: {
      generatedAt: null,
      lastUpdatedAt: null,
    },
    characterWallets: {},
    corporationWallets: {},
  });

  const session = buildLiveSession();
  sessionRegistry.register(session);
  t.after(() => {
    sessionRegistry.unregister(session);
  });

  const result = chatCommands.executeChatCommand(
    session,
    "/addevermarks 1500",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(result.handled, true);
  assert.match(result.message, /Adjusted EverMarks/i);

  const walletSummary = chatCommands.executeChatCommand(
    session,
    "/wallet",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(walletSummary.handled, true);
  assert.match(walletSummary.message, /EverMarks: 1,500 EverMarks/i);

  const corpSetResult = chatCommands.executeChatCommand(
    session,
    "/setcorpevermarks 4500",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(corpSetResult.handled, true);
  assert.match(corpSetResult.message, /Corporation EverMarks set to 4,500 EverMarks/i);

  const corpSummary = chatCommands.executeChatCommand(
    session,
    "/corpevermarks",
    null,
    { emitChatFeedback: false },
  );
  assert.equal(corpSummary.handled, true);
  assert.match(corpSummary.message, /Corporation EverMarks: 4,500 EverMarks/i);

  const lpService = new LPService();
  const corporationBalances = lpService.Handle_GetAllMyCorporationWalletLPBalances([], session);
  assert.equal(corporationBalances && corporationBalances.type, "list");
  assert.equal(corporationBalances.items.length, 1);
  assert.deepEqual(corporationBalances.items[0].items, [EVERMARK_ISSUER_CORP_ID, 4500]);
  assert.equal(
    session._notifications.some((entry) => entry.name === "OnCorpLPChange"),
    true,
    "Expected corp LP refresh notifications for corporation EverMarks rows",
  );
});

test("personal EverMarks donation to your own corporation works immediately for fresh custom corps", (t) => {
  const lpWalletsBackup = cloneValue(database.read("lpWallets", "/").data || {});
  const charactersBackup = cloneValue(database.read("characters", "/").data || {});
  const corporationsBackup = cloneValue(database.read("corporations", "/").data || {});
  const corporationRuntimeBackup = cloneValue(database.read("corporationRuntime", "/").data || {});
  t.after(() => {
    database.write("lpWallets", "/", lpWalletsBackup);
    database.write("characters", "/", charactersBackup);
    database.write("corporations", "/", corporationsBackup);
    database.write("corporationRuntime", "/", corporationRuntimeBackup);
    database.flushAllSync();
    corporationRuntimeTesting.resetRuntimeCaches();
  });

  database.write("lpWallets", "/", {
    _meta: {
      generatedAt: null,
      lastUpdatedAt: null,
    },
    characterWallets: {},
    corporationWallets: {},
  });

  const sourceCorpResult = createCustomCorporation(140000001, "Immediate Evermark Corp");
  assert.equal(sourceCorpResult.success, true);
  const sourceCorporationID = sourceCorpResult.data.corporationRecord.corporationID;

  const session = buildLiveSession({
    characterID: 140000001,
    corporationID: sourceCorporationID,
    corpid: sourceCorporationID,
    allianceID: null,
    allianceid: null,
    corprole: 34359738368n,
  });
  sessionRegistry.register(session);
  t.after(() => {
    sessionRegistry.unregister(session);
  });

  const lpService = new LPService();
  const characterGrantResult = adjustCharacterWalletLPBalance(
    session.characterID,
    EVERMARK_ISSUER_CORP_ID,
    2500,
    { changeType: "admin_adjust" },
  );
  assert.equal(characterGrantResult.success, true);

  lpService.Handle_TransferLPFromMyWalletToOtherCorp(
    [sourceCorporationID, EVERMARK_ISSUER_CORP_ID, 1000],
    session,
  );
  assert.equal(
    getCharacterWalletLPBalance(session.characterID, EVERMARK_ISSUER_CORP_ID),
    1500,
  );
  assert.equal(
    getCorporationWalletLPBalance(sourceCorporationID, EVERMARK_ISSUER_CORP_ID),
    1000,
  );
});

test("LPSvc EverMarks transfer routes follow the client wallet donation flows", (t) => {
  const lpWalletsBackup = cloneValue(database.read("lpWallets", "/").data || {});
  const charactersBackup = cloneValue(database.read("characters", "/").data || {});
  const corporationsBackup = cloneValue(database.read("corporations", "/").data || {});
  const alliancesBackup = cloneValue(database.read("alliances", "/").data || {});
  const corporationRuntimeBackup = cloneValue(database.read("corporationRuntime", "/").data || {});
  t.after(() => {
    database.write("lpWallets", "/", lpWalletsBackup);
    database.write("characters", "/", charactersBackup);
    database.write("corporations", "/", corporationsBackup);
    database.write("alliances", "/", alliancesBackup);
    database.write("corporationRuntime", "/", corporationRuntimeBackup);
    database.flushAllSync();
    corporationRuntimeTesting.resetRuntimeCaches();
  });

  database.write("lpWallets", "/", {
    _meta: {
      generatedAt: null,
      lastUpdatedAt: null,
    },
    characterWallets: {},
    corporationWallets: {},
  });

  const sourceCorpResult = createCustomCorporation(140000001, "Evermark Source Corp");
  assert.equal(sourceCorpResult.success, true);
  const destinationCorpResult = createCustomCorporation(140000002, "Evermark Destination Corp");
  assert.equal(destinationCorpResult.success, true);

  const sourceCorporationID = sourceCorpResult.data.corporationRecord.corporationID;
  const destinationCorporationID = destinationCorpResult.data.corporationRecord.corporationID;
  const allianceResult = createCustomAllianceForCorporation(
    140000001,
    sourceCorporationID,
    "Evermark Parity Alliance",
  );
  assert.equal(allianceResult.success, true);
  const allianceID = allianceResult.data.allianceRecord.allianceID;

  const joinResult = joinCorporationToAllianceByName(
    destinationCorporationID,
    allianceResult.data.allianceRecord.allianceName,
  );
  assert.equal(joinResult.success, true);

  const joinedAgo = filetimeDaysAgo(45);
  recordAllianceMemberJoin(allianceID, sourceCorporationID, joinedAgo);
  recordAllianceMemberJoin(allianceID, destinationCorporationID, joinedAgo);
  updateCharacterRecord(140000001, (record) => ({
    ...record,
    corporationID: sourceCorporationID,
    allianceID,
    startDateTime: joinedAgo,
    employmentHistory: [
      {
        corporationID: sourceCorporationID,
        startDate: joinedAgo,
        deleted: 0,
      },
    ],
  }));
  updateCharacterRecord(140000002, (record) => ({
    ...record,
    corporationID: destinationCorporationID,
    allianceID,
    startDateTime: joinedAgo,
    employmentHistory: [
      {
        corporationID: destinationCorporationID,
        startDate: joinedAgo,
        deleted: 0,
      },
    ],
  }));

  const session = buildLiveSession({
    characterID: 140000001,
    corporationID: sourceCorporationID,
    corpid: sourceCorporationID,
    allianceID,
    allianceid: allianceID,
    corprole: 34359738368n,
  });
  sessionRegistry.register(session);
  t.after(() => {
    sessionRegistry.unregister(session);
  });

  const lpService = new LPService();
  const characterGrantResult = adjustCharacterWalletLPBalance(
    session.characterID,
    EVERMARK_ISSUER_CORP_ID,
    2500,
    { changeType: "admin_adjust" },
  );
  assert.equal(characterGrantResult.success, true);

  lpService.Handle_TransferLPFromMyWalletToOtherCorp(
    [sourceCorporationID, EVERMARK_ISSUER_CORP_ID, 1000],
    session,
  );
  assert.equal(
    getCharacterWalletLPBalance(session.characterID, EVERMARK_ISSUER_CORP_ID),
    1500,
  );
  assert.equal(
    getCorporationWalletLPBalance(sourceCorporationID, EVERMARK_ISSUER_CORP_ID),
    1000,
  );

  const corpGrantResult = setCorporationWalletLPBalance(
    sourceCorporationID,
    EVERMARK_ISSUER_CORP_ID,
    3200,
    { reason: "admin_set" },
  );
  assert.equal(corpGrantResult.success, true);

  lpService.Handle_TransferLPFromMyCorpWalletToOtherCorp(
    [destinationCorporationID, EVERMARK_ISSUER_CORP_ID, 1200],
    session,
  );
  assert.equal(
    getCorporationWalletLPBalance(sourceCorporationID, EVERMARK_ISSUER_CORP_ID),
    2000,
  );
  assert.equal(
    getCorporationWalletLPBalance(destinationCorporationID, EVERMARK_ISSUER_CORP_ID),
    1200,
  );
  assert.equal(
    session._notifications.filter((entry) => entry.name === "OnLPChange").length > 0,
    true,
  );
  assert.equal(
    session._notifications.filter((entry) => entry.name === "OnCorpLPChange").length >= 2,
    true,
    "Expected corporation wallet transfers to emit live corp LP refresh notifications",
  );
});
