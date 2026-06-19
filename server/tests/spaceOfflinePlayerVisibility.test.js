const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const { restoreSpaceSession } = require(path.join(
  repoRoot,
  "server/src/space/transitions",
));
const {
  applyCharacterToSession,
  getCharacterRecord,
  getActiveShipRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));

function buildLoginStyleSession(characterID) {
  const notifications = [];
  const sessionChanges = [];
  return {
    clientID: characterID + 9200,
    userid: characterID,
    characterID: null,
    charid: null,
    corporationID: 0,
    allianceID: null,
    warFactionID: null,
    stationid: null,
    stationID: null,
    stationid2: null,
    locationid: null,
    solarsystemid: null,
    solarsystemid2: null,
    shipID: null,
    shipid: null,
    activeShipID: null,
    socket: { destroyed: false },
    notifications,
    sessionChanges,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange(change) {
      sessionChanges.push(change);
    },
  };
}

function findOfflinePlayerSpaceCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    if (!characterRecord) {
      continue;
    }
    const accountID = Number(characterRecord.accountId ?? characterRecord.accountID) || 0;
    if (accountID <= 0) {
      continue;
    }
    if (Number(characterRecord.stationID || characterRecord.stationid || 0) > 0) {
      continue;
    }

    const ship = getActiveShipRecord(characterID);
    const systemID =
      Number(ship && ship.spaceState && ship.spaceState.systemID) ||
      Number(ship && ship.locationID) ||
      Number(characterRecord.solarSystemID || characterRecord.solarsystemID) ||
      0;
    if (!ship || !ship.spaceState || Number(ship.categoryID) !== 6 || systemID <= 0) {
      continue;
    }

    return {
      characterID,
      characterRecord,
      ship,
      systemID,
    };
  }

  assert.fail("Expected a player character with an active ship persisted in space");
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("runtime scene bootstrap suppresses offline player-owned persisted ships", () => {
  const candidate = findOfflinePlayerSpaceCandidate();
  const shipItem = {
    ...candidate.ship,
    spaceState: candidate.ship.spaceState || {},
  };

  const hiddenPlayerEntity = spaceRuntime._testing.buildRuntimeSpaceEntityFromItemForTesting(
    shipItem,
    candidate.systemID,
    Date.now(),
    {
      includeOfflinePlayerShips: false,
      resolveCharacterRecord() {
        return {
          accountId: 77,
          shipID: shipItem.itemID,
        };
      },
    },
  );
  assert.equal(
    hiddenPlayerEntity,
    null,
    "expected fresh scene bootstrap to skip an offline player's active ship",
  );

  const npcEntity = spaceRuntime._testing.buildRuntimeSpaceEntityFromItemForTesting(
    shipItem,
    candidate.systemID,
    Date.now(),
    {
      includeOfflinePlayerShips: false,
      resolveCharacterRecord() {
        return {
          accountId: 0,
          shipID: shipItem.itemID,
        };
      },
    },
  );
  assert.ok(npcEntity, "expected synthetic NPC persisted ships to remain loadable");
  assert.equal(npcEntity.kind, "ship");

  const abandonedHullEntity =
    spaceRuntime._testing.buildRuntimeSpaceEntityFromItemForTesting(
      shipItem,
      candidate.systemID,
      Date.now(),
      {
        includeOfflinePlayerShips: false,
        resolveCharacterRecord() {
          return {
            accountId: 77,
            shipID: Number(shipItem.itemID) + 1,
          };
        },
      },
    );
  assert.equal(
    abandonedHullEntity,
    null,
    "expected fresh scene bootstrap to skip non-active offline player-owned hulls too",
  );

  const optedInPlayerEntity =
    spaceRuntime._testing.buildRuntimeSpaceEntityFromItemForTesting(
      shipItem,
      candidate.systemID,
      Date.now(),
      {
        includeOfflinePlayerShips: true,
        resolveCharacterRecord() {
          return {
            accountId: 77,
            shipID: shipItem.itemID,
          };
        },
      },
    );
  assert.ok(
    optedInPlayerEntity,
    "expected explicit callers to still be able to materialize the active ship",
  );
});

test("fresh scene bootstrap hides offline player ships until login restore reattaches them", () => {
  const candidate = findOfflinePlayerSpaceCandidate();
  const session = buildLoginStyleSession(candidate.characterID);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const activeShip = getActiveShipRecord(session.characterID);
  assert.ok(activeShip, "expected the player to have an active ship");
  const systemID =
    Number(activeShip.spaceState && activeShip.spaceState.systemID) ||
    candidate.systemID;
  const scene = spaceRuntime.ensureScene(systemID);

  assert.equal(
    scene.dynamicEntities.has(activeShip.itemID),
    false,
    "expected a fresh scene not to preload offline player ships",
  );

  const restored = restoreSpaceSession(session);
  assert.equal(restored, true, "expected login restore to reattach the active ship");
  assert.equal(
    scene.dynamicEntities.has(activeShip.itemID),
    true,
    "expected login restore to place the player's ship back into the scene",
  );
  assert.equal(
    session._space && session._space.shipID,
    activeShip.itemID,
    "expected the restored session to own the active ship entity",
  );
});
