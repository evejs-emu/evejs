const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const WormholeMgrService = require(path.join(
  repoRoot,
  "server/src/services/exploration/wormholes/wormholeMgrService",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
  applyCharacterToSession,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  listSystems,
} = require(path.join(
  repoRoot,
  "server/src/services/exploration/wormholes/wormholeAuthority",
));

const CATACLYSMIC_SYSTEM_ID = (
  listSystems().find((system) => Number(system.environmentEffectTypeID) === 30883) || {}
).solarSystemID || 31002263;

function findSpaceCandidate() {
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
    if (!characterRecord || !activeShip || stationID > 0) {
      continue;
    }
    return {
      characterID,
      shipID: Number(activeShip.itemID) || 0,
    };
  }

  assert.fail("Expected at least one in-space character with an active ship");
}

function buildSession(clientID) {
  return {
    clientID,
    characterID: 0,
    _notifications: [],
    socket: {
      destroyed: false,
    },
    sendNotification(name, idType, payload) {
      this._notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function extractKeyValEntries(value) {
  if (
    value &&
    typeof value === "object" &&
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

test("space GetAllInfo primes wormhole systemWideEffectsOnShip for the HUD effect strip", () => {
  const candidate = findSpaceCandidate();
  const session = buildSession(candidate.characterID + 93000);
  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  assert.equal(Number(session.shipID || session.shipid || 0), candidate.shipID);

  session.solarsystemid = CATACLYSMIC_SYSTEM_ID;
  session.solarsystemid2 = CATACLYSMIC_SYSTEM_ID;
  session.locationid = CATACLYSMIC_SYSTEM_ID;

  const dogma = new DogmaService();
  const allInfo = dogma.Handle_GetAllInfo([true, true, null], session);
  const systemWideEffectsOnShip = getKeyValEntry(allInfo, "systemWideEffectsOnShip");

  assert.ok(
    systemWideEffectsOnShip && systemWideEffectsOnShip.type === "dict",
    "Expected in-space GetAllInfo to prime systemWideEffectsOnShip in wormhole environment systems",
  );
  assert.equal(systemWideEffectsOnShip.entries.length, 1);
  const entry = systemWideEffectsOnShip.entries[0];
  assert.equal(entry[0] && entry[0].type, "tuple");
  assert.equal(entry[1] && entry[1].type, "objectex1");
});

test("wormhole jumps clear the HUD system-wide effect strip when the destination has no environment effect", () => {
  const session = buildSession(990001);

  WormholeMgrService._testing.syncSessionSystemWideEffectsForSystem(
    session,
    CATACLYSMIC_SYSTEM_ID,
  );
  WormholeMgrService._testing.syncSessionSystemWideEffectsForSystem(
    session,
    30000142,
  );

  const effectUpdates = session._notifications.filter(
    (entry) => entry && entry.name === "OnUpdateSystemWideEffectsInfo",
  );
  assert.equal(effectUpdates.length, 2);

  const firstPayload = Array.isArray(effectUpdates[0].payload)
    ? effectUpdates[0].payload[0]
    : null;
  const secondPayload = Array.isArray(effectUpdates[1].payload)
    ? effectUpdates[1].payload[0]
    : null;
  assert.equal(firstPayload && firstPayload.type, "dict");
  assert.equal(secondPayload && secondPayload.type, "dict");
  assert.equal(
    Array.isArray(firstPayload && firstPayload.entries) && firstPayload.entries.length > 0,
    true,
    "Expected wormhole environment systems to advertise a non-empty HUD payload",
  );
  assert.equal(
    Array.isArray(secondPayload && secondPayload.entries)
      ? secondPayload.entries.length
      : -1,
    0,
    "Expected non-environment systems to clear the HUD payload back to an empty dict",
  );
});
