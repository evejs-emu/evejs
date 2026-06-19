const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const config = require(path.join(repoRoot, "server/src/config"));
const EVEHandshake = require(path.join(
  repoRoot,
  "server/src/network/tcp/handshake",
));
const { marshalDecode } = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));

const accountsPath = path.join(
  repoRoot,
  "server/src/newDatabase/data/accounts/data.json",
);
const identityStatePath = path.join(
  repoRoot,
  "server/src/newDatabase/data/identityState/data.json",
);

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildLoginDict(username, passwordHashHex) {
  return {
    type: "dict",
    entries: [
      ["user_name", username],
      ["user_password_hash", passwordHashHex],
      ["user_languageid", "EN"],
    ],
  };
}

function buildHandshakeSocket() {
  return {
    remoteAddress: "127.0.0.1",
    writes: [],
    ended: false,
    write(buffer) {
      this.writes.push(buffer);
    },
    end() {
      this.ended = true;
    },
  };
}

function decodeHandshakeWrite(buffer) {
  return marshalDecode(buffer.slice(4));
}

function assertLoginAuthFailedClosePacket(closePacket) {
  assert.equal(closePacket.type, "cpicked");
  const expectedPickle = EVEHandshake._testing.buildGPSTransportClosedCPickle(
    "LoginAuthFailed",
    {},
    "LoginAuthFailed",
  );
  assert.ok(Buffer.isBuffer(closePacket.data));
  assert.deepEqual(closePacket.data, expectedPickle);
}

test("root table writes persist even when the caller mutated the cached table in place", (t) => {
  const originalAccounts = cloneValue(database.read("accounts", "/").data || {});
  const originalAccountsRaw = fs.readFileSync(accountsPath, "utf8");
  const tempUserName = "__root_write_persistence_test__";

  t.after(() => {
    database.write("accounts", "/", originalAccounts, { force: true });
    database.flushAllSync();
    fs.writeFileSync(accountsPath, originalAccountsRaw, "utf8");
  });

  const liveAccounts = database.read("accounts", "/").data;
  delete liveAccounts[tempUserName];
  liveAccounts[tempUserName] = {
    passwordhash: "deadbeef",
    id: 999991,
    role: "1",
    chatRole: "1",
    banned: false,
  };

  const writeResult = database.write("accounts", "/", liveAccounts);
  assert.equal(writeResult.success, true);

  database.flushAllSync();

  const persistedAccounts = JSON.parse(fs.readFileSync(accountsPath, "utf8"));
  assert.ok(
    persistedAccounts[tempUserName],
    "expected the in-place root mutation to flush to disk",
  );
  assert.equal(persistedAccounts[tempUserName].id, 999991);
});

test("auto-created accounts persist to disk during handshake login", (t) => {
  const originalAccounts = cloneValue(database.read("accounts", "/").data || {});
  const originalIdentityState = cloneValue(database.read("identityState", "/").data || {});
  const originalAccountsRaw = fs.readFileSync(accountsPath, "utf8");
  const originalIdentityStateRaw = fs.readFileSync(identityStatePath, "utf8");
  const originalAutoCreate = config.devAutoCreateAccounts;
  const originalSkipValidation = config.devSkipPasswordValidation;
  const userName = "__handshake_autocreate_persist__";
  const passwordHashHex = "0123456789abcdef0123456789abcdef01234567";

  t.after(() => {
    config.devAutoCreateAccounts = originalAutoCreate;
    config.devSkipPasswordValidation = originalSkipValidation;
    database.write("accounts", "/", originalAccounts, { force: true });
    database.write("identityState", "/", originalIdentityState, { force: true });
    database.flushAllSync();
    fs.writeFileSync(accountsPath, originalAccountsRaw, "utf8");
    fs.writeFileSync(identityStatePath, originalIdentityStateRaw, "utf8");
  });

  config.devAutoCreateAccounts = true;
  config.devSkipPasswordValidation = true;

  const seededAccounts = cloneValue(originalAccounts);
  delete seededAccounts[userName];
  database.write("accounts", "/", seededAccounts, { force: true });
  database.flushAllSync();

  const socket = buildHandshakeSocket();
  const handshake = new EVEHandshake(socket);
  const result = handshake._handleAuthentication([
    null,
    buildLoginDict(userName, passwordHashHex),
  ]);

  assert.deepEqual(result, { done: false });
  assert.equal(handshake.userName, userName);
  assert.equal(handshake.userId > 0, true);
  assert.equal(socket.ended, false);

  database.flushAllSync();

  const persistedAccounts = JSON.parse(fs.readFileSync(accountsPath, "utf8"));
  assert.ok(
    persistedAccounts[userName],
    "expected the auto-created account to persist to disk",
  );
  assert.equal(persistedAccounts[userName].id, handshake.userId);
  assert.equal(persistedAccounts[userName].passwordhash, passwordHashHex);
});

test("character selection payload stays a stock 4-tuple for accounts with zero characters", () => {
  const charService = new CharService();
  const payload = charService.Handle_GetCharacterSelectionData([], {
    userid: 99999991,
  });

  assert.equal(Array.isArray(payload), true);
  assert.equal(payload.length, 4);
  assert.equal(payload[0].type, "list");
  assert.deepEqual(payload[1], [null, null]);
  assert.equal(payload[2].type, "list");
  assert.deepEqual(payload[2].items, []);
  assert.equal(payload[3].type, "list");
  assert.deepEqual(payload[3].items, []);
});

test("handshake sends LoginAuthFailed close packets for unknown accounts", (t) => {
  const originalAccounts = cloneValue(database.read("accounts", "/").data || {});
  const originalAutoCreate = config.devAutoCreateAccounts;
  const originalSkipValidation = config.devSkipPasswordValidation;
  const userName = "__missing_login_auth_failed__";

  t.after(() => {
    config.devAutoCreateAccounts = originalAutoCreate;
    config.devSkipPasswordValidation = originalSkipValidation;
    database.write("accounts", "/", originalAccounts, { force: true });
    database.flushAllSync();
  });

  config.devAutoCreateAccounts = false;
  config.devSkipPasswordValidation = false;

  const seededAccounts = cloneValue(originalAccounts);
  delete seededAccounts[userName];
  database.write("accounts", "/", seededAccounts, { force: true });
  database.flushAllSync();

  const socket = buildHandshakeSocket();
  const handshake = new EVEHandshake(socket);
  const result = handshake._handleAuthentication([
    null,
    buildLoginDict(userName, "1111111111111111111111111111111111111111"),
  ]);

  assert.deepEqual(result, { done: false });
  assert.equal(socket.ended, true);
  assert.equal(socket.writes.length, 2);
  assert.equal(decodeHandshakeWrite(socket.writes[0]), 2);

  const closePacket = decodeHandshakeWrite(socket.writes[1]);
  assertLoginAuthFailedClosePacket(closePacket);
});

test("handshake sends LoginAuthFailed close packets for password mismatch", (t) => {
  const originalAccounts = cloneValue(database.read("accounts", "/").data || {});
  const originalAutoCreate = config.devAutoCreateAccounts;
  const originalSkipValidation = config.devSkipPasswordValidation;
  const userName = "__wrong_password_login_auth_failed__";
  const storedPasswordHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const wrongPasswordHash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  t.after(() => {
    config.devAutoCreateAccounts = originalAutoCreate;
    config.devSkipPasswordValidation = originalSkipValidation;
    database.write("accounts", "/", originalAccounts, { force: true });
    database.flushAllSync();
  });

  config.devAutoCreateAccounts = false;
  config.devSkipPasswordValidation = false;

  const seededAccounts = cloneValue(originalAccounts);
  seededAccounts[userName] = {
    passwordhash: storedPasswordHash,
    id: 991231,
    role: "1",
    chatRole: "1",
    banned: false,
  };
  database.write("accounts", "/", seededAccounts, { force: true });
  database.flushAllSync();

  const socket = buildHandshakeSocket();
  const handshake = new EVEHandshake(socket);
  const result = handshake._handleAuthentication([
    null,
    buildLoginDict(userName, wrongPasswordHash),
  ]);

  assert.deepEqual(result, { done: false });
  assert.equal(socket.ended, true);
  assert.equal(socket.writes.length, 2);
  assert.equal(decodeHandshakeWrite(socket.writes[0]), 2);

  const closePacket = decodeHandshakeWrite(socket.writes[1]);
  assertLoginAuthFailedClosePacket(closePacket);
});
