const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const crimewatchState = require(path.join(
  repoRoot,
  "server/src/services/security/crimewatchState",
));

const ATTACKER_CHARACTER_ID = 140000004;
const TARGET_CHARACTER_ID = 140000005;
const OBSERVER_CHARACTER_ID = 140000001;
const TEST_NOW = 1_800_000_000_000;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildSession(characterID) {
  const notifications = [];
  return {
    characterID,
    _notifications: notifications,
    _slimChanges: [],
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
}

test("high-sec aggression pushes the offender's updated security status back to their own client", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);

  t.after(() => {
    database.write("items", "/", originalItems);
    database.write("characters", "/", originalCharacters);
    database.flushAllSync();
    crimewatchState.clearAllCrimewatchState();
  });

  const attackerRecord = originalCharacters[String(ATTACKER_CHARACTER_ID)];
  const targetRecord = originalCharacters[String(TARGET_CHARACTER_ID)];
  assert.ok(attackerRecord, "expected attacker fixture character");
  assert.ok(targetRecord, "expected target fixture character");

  const nextCharacters = cloneValue(originalCharacters);
  nextCharacters[String(ATTACKER_CHARACTER_ID)] = {
    ...attackerRecord,
    securityStatus: 0,
    securityRating: 0,
  };
  nextCharacters[String(TARGET_CHARACTER_ID)] = {
    ...targetRecord,
    securityStatus: 0,
    securityRating: 0,
  };
  database.write("characters", "/", nextCharacters);
  database.flushAllSync();
  crimewatchState.clearAllCrimewatchState();

  const attackerSession = buildSession(ATTACKER_CHARACTER_ID);
  const observerSession = buildSession(OBSERVER_CHARACTER_ID);
  const scene = {
    systemID: 30000142,
    system: { security: 1.0 },
    sessions: new Map([
      [String(attackerSession.characterID), attackerSession],
      [String(observerSession.characterID), observerSession],
    ]),
    canSessionSeeDynamicEntity() {
      return true;
    },
    sendSlimItemChangesToSession(session, entities) {
      session._slimChanges.push(entities.map((entity) => entity.itemID));
    },
  };

  const attackerEntity = {
    itemID: Number(attackerRecord.shipID) || 910000001,
    groupID: 25,
    characterID: ATTACKER_CHARACTER_ID,
    session: attackerSession,
    securityStatus: 0,
  };
  const targetEntity = {
    itemID: Number(targetRecord.shipID) || 910000002,
    groupID: 25,
    characterID: TARGET_CHARACTER_ID,
    securityStatus: 0,
  };

  const result = crimewatchState.recordHighSecCriminalAggression(
    scene,
    attackerEntity,
    targetEntity,
    TEST_NOW,
  );

  assert.equal(result.success, true);
  assert.equal(result.data.applied, true);
  assert.equal(result.data.securityStatusPenalty.applied, true);
  assert.equal(result.data.securityStatusPenalty.nextSecurityStatus, -0.25);
  assert.equal(result.data.securityStatusPenalty.deltaSecurityStatus, -0.25);
  assert.equal(result.data.securityStatusPenalty.selfStatusNotified, true);

  const updatedAttackerRecord = database.read("characters", `/${ATTACKER_CHARACTER_ID}`).data;
  assert.equal(updatedAttackerRecord.securityStatus, -0.25);
  assert.equal(updatedAttackerRecord.securityRating, -0.25);
  assert.equal(attackerEntity.securityStatus, -0.25);

  const selfStatusNotification = attackerSession._notifications.find(
    (entry) => entry.name === "OnSecurityStatusUpdate",
  );
  assert.deepEqual(selfStatusNotification, {
    name: "OnSecurityStatusUpdate",
    idType: "clientID",
    payload: [-0.25],
  });

  const attributeNotification = attackerSession._notifications.find(
    (entry) => entry.name === "OnModuleAttributeChanges",
  );
  assert.ok(attributeNotification, "expected dogma security-status attribute update");
  assert.equal(attackerSession._slimChanges.length, 1);
  assert.equal(observerSession._slimChanges.length, 1);
  assert.deepEqual(observerSession._slimChanges[0], [attackerEntity.itemID]);
});
