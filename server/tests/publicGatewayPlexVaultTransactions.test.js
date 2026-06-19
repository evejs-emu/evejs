const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const sourceDataDir = path.join(repoRoot, "server/src/newDatabase/data");
const originalNewDbDataDir = process.env.EVEJS_NEWDB_DATA_DIR;
const testDataDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "evejs-plex-gateway-db-"),
);
fs.cpSync(sourceDataDir, testDataDir, { recursive: true });
process.env.EVEJS_NEWDB_DATA_DIR = testDataDir;

const {
  PLEX_LOG_CATEGORY,
} = require(path.join(repoRoot, "server/src/services/account/plexVaultLogState"));
const {
  setCharacterPlexBalance,
} = require(path.join(repoRoot, "server/src/services/account/walletState"));
const {
  updateCharacterRecord,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const publicGatewayLocal = require(path.join(
  repoRoot,
  "server/src/_secondary/express/publicGatewayLocal",
));

test.after(() => {
  database.flushAllSync();
  if (originalNewDbDataDir === undefined) {
    delete process.env.EVEJS_NEWDB_DATA_DIR;
  } else {
    process.env.EVEJS_NEWDB_DATA_DIR = originalNewDbDataDir;
  }
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

function getFirstCharacterID() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true);
  return Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .find((characterID) => characterID > 0);
}

function buildGatewayEnvelope(typeName, payloadBuffer = Buffer.alloc(0), characterID = 0) {
  const envelope = publicGatewayLocal._testing.RequestEnvelope.create({
    authoritative_context: {
      active_character: {
        sequential: characterID,
      },
      identity: {
        character: {
          sequential: characterID,
        },
      },
    },
    payload: {
      type_url: `type.googleapis.com/${typeName}`,
      value: Buffer.from(payloadBuffer),
    },
  });
  return Buffer.from(
    publicGatewayLocal._testing.RequestEnvelope.encode(envelope).finish(),
  );
}

function decodeGatewayResponse(buffer) {
  return publicGatewayLocal._testing.ResponseEnvelope.decode(buffer);
}

test("public gateway serves cached PLEX vault transaction ids, details, and statistics", () => {
  const characterID = getFirstCharacterID();
  assert.ok(characterID > 0);

  updateCharacterRecord(characterID, (record) => {
    record.plexVaultTransactions = [];
    return record;
  });

  const seededBalance = setCharacterPlexBalance(characterID, 1000, {
    recordTransaction: false,
  });
  assert.equal(seededBalance.success, true);

  const purchaseResult = setCharacterPlexBalance(characterID, 950, {
    categoryMessageID: PLEX_LOG_CATEGORY.NES,
    reason: "Test NES purchase",
  });
  const rewardResult = setCharacterPlexBalance(characterID, 975, {
    categoryMessageID: PLEX_LOG_CATEGORY.REWARD,
    reason: "Test reward grant",
  });
  assert.equal(purchaseResult.success, true);
  assert.equal(rewardResult.success, true);

  const idsResponseBuffer = publicGatewayLocal.buildGatewayResponseForRequest(
    buildGatewayEnvelope(
      "eve_public.plex.vault.transaction.api.GetAllLoggedForUserRequest",
      Buffer.alloc(0),
      characterID,
    ),
  );
  const idsResponseEnvelope = decodeGatewayResponse(idsResponseBuffer);
  const idsResponseType = publicGatewayLocal._testing.PROTO_ROOT.lookupType(
    "eve_public.plex.vault.transaction.api.GetAllLoggedForUserResponse",
  );
  const idsPayload = idsResponseType.decode(idsResponseEnvelope.payload.value);

  assert.equal(idsResponseEnvelope.status_code, 200);
  assert.equal(idsPayload.transactions.length, 2);

  const latestTransactionID = Number(idsPayload.transactions[0].sequential);
  const getLogRequestType = publicGatewayLocal._testing.PROTO_ROOT.lookupType(
    "eve_public.plex.vault.transaction.api.GetLogRequest",
  );
  const logRequestPayload = Buffer.from(
    getLogRequestType.encode(
      getLogRequestType.create({
        identifier: {
          sequential: latestTransactionID,
        },
      }),
    ).finish(),
  );
  const logResponseBuffer = publicGatewayLocal.buildGatewayResponseForRequest(
    buildGatewayEnvelope(
      "eve_public.plex.vault.transaction.api.GetLogRequest",
      logRequestPayload,
      characterID,
    ),
  );
  const logResponseEnvelope = decodeGatewayResponse(logResponseBuffer);
  const logResponseType = publicGatewayLocal._testing.PROTO_ROOT.lookupType(
    "eve_public.plex.vault.transaction.api.GetLogResponse",
  );
  const logPayload = logResponseType.decode(logResponseEnvelope.payload.value);

  assert.equal(logResponseEnvelope.status_code, 200);
  assert.equal(logPayload.unavailable, false);
  assert.equal(
    Number(logPayload.invoice_entry.attributes.category.identifier.sequential),
    PLEX_LOG_CATEGORY.REWARD,
  );
  assert.equal(
    Number(logPayload.invoice_entry.attributes.summary_message.identifier.sequential),
    PLEX_LOG_CATEGORY.REWARD,
  );
  assert.equal(
    Number(logPayload.transaction.amount_transferred.total_in_cents),
    25 * 200,
  );
  assert.equal(
    Number(logPayload.transaction.resulting_balance.total_in_cents),
    975 * 200,
  );

  const statisticsResponseBuffer = publicGatewayLocal.buildGatewayResponseForRequest(
    buildGatewayEnvelope(
      "eve_public.plex.vault.transaction.api.GetStatisticsRequest",
      Buffer.alloc(0),
      characterID,
    ),
  );
  const statisticsEnvelope = decodeGatewayResponse(statisticsResponseBuffer);
  const statisticsType = publicGatewayLocal._testing.PROTO_ROOT.lookupType(
    "eve_public.plex.vault.transaction.api.GetStatisticsResponse",
  );
  const statisticsPayload = statisticsType.decode(
    statisticsEnvelope.payload.value,
  );

  assert.equal(statisticsEnvelope.status_code, 200);
  assert.equal(statisticsPayload.entries.length, 2);
  const categoryIDs = statisticsPayload.entries.map((entry) =>
    Number(entry.category.identifier.sequential),
  );
  assert.deepEqual(categoryIDs, [
    PLEX_LOG_CATEGORY.REWARD,
    PLEX_LOG_CATEGORY.NES,
  ]);
});

test("public gateway falls back legacy PLEX logs without summary ids to category messages", () => {
  const characterID = getFirstCharacterID();
  assert.ok(characterID > 0);

  updateCharacterRecord(characterID, (record) => {
    record.plexVaultTransactions = [
      {
        transactionID: 991234567,
        transactionDate: "134182557000000000",
        amount: 1000,
        balance: 3222,
        categoryMessageID: PLEX_LOG_CATEGORY.CCP,
        summaryMessageID: 0,
        summaryText: "Legacy test summary",
        reason: "Legacy test summary",
      },
    ];
    return record;
  });

  const getLogRequestType = publicGatewayLocal._testing.PROTO_ROOT.lookupType(
    "eve_public.plex.vault.transaction.api.GetLogRequest",
  );
  const logRequestPayload = Buffer.from(
    getLogRequestType.encode(
      getLogRequestType.create({
        identifier: {
          sequential: 991234567,
        },
      }),
    ).finish(),
  );
  const logResponseBuffer = publicGatewayLocal.buildGatewayResponseForRequest(
    buildGatewayEnvelope(
      "eve_public.plex.vault.transaction.api.GetLogRequest",
      logRequestPayload,
      characterID,
    ),
  );
  const logResponseEnvelope = decodeGatewayResponse(logResponseBuffer);
  const logResponseType = publicGatewayLocal._testing.PROTO_ROOT.lookupType(
    "eve_public.plex.vault.transaction.api.GetLogResponse",
  );
  const logPayload = logResponseType.decode(logResponseEnvelope.payload.value);

  assert.equal(logResponseEnvelope.status_code, 200);
  assert.equal(logPayload.unavailable, false);
  assert.equal(
    Number(logPayload.invoice_entry.attributes.category.identifier.sequential),
    PLEX_LOG_CATEGORY.CCP,
  );
  assert.equal(
    Number(logPayload.invoice_entry.attributes.summary_message.identifier.sequential),
    PLEX_LOG_CATEGORY.CCP,
  );
});
