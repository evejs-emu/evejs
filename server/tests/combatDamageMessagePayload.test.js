const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..");
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));

function marshalDictToObject(marshalDict) {
  assert.equal(marshalDict && marshalDict.type, "dict");
  return Object.fromEntries(
    Array.isArray(marshalDict.entries)
      ? marshalDict.entries.map(([key, value]) => [key, value])
      : [],
  );
}

test("combat damage payload includes client name-resolution fallbacks for incoming npc hits", () => {
  const payload = spaceRuntime._testing.buildLaserDamageMessagePayloadForTesting({
    attackType: "otherPlayerWeapons",
    attackerEntity: {
      itemID: 980000000136,
      typeID: 87612,
      ownerID: 98000001,
    },
    targetEntity: {
      itemID: 2990003488,
      characterID: 140000003,
      ownerID: 140000003,
    },
    moduleItem: {
      itemID: 990000000001,
      locationID: 980000000136,
      ownerID: 98000001,
      typeID: 0,
    },
    shotDamage: {
      thermal: 57.330363,
      explosive: 42.243425,
    },
    totalDamage: 66.986003,
    hitQuality: 4,
    includeAttackerID: true,
  });
  const payloadObject = marshalDictToObject(payload);

  assert.equal(payloadObject.source, 980000000136);
  assert.equal(payloadObject.target, 2990003488);
  assert.equal(payloadObject.weapon, 87612);
  assert.equal(payloadObject.sourceCharID, 98000001);
  assert.equal(payloadObject.targetOwnerID, 140000003);
  assert.equal(payloadObject.attackerID, 980000000136);
});

test("combat damage payload falls back to module identity when the attacker entity is unavailable", () => {
  const payload = spaceRuntime._testing.buildLaserDamageMessagePayloadForTesting({
    attackType: "otherPlayerWeapons",
    attackerEntity: null,
    targetEntity: {
      itemID: 2990003488,
      pilotCharacterID: 140000003,
      ownerID: 140000003,
    },
    moduleItem: {
      itemID: 990000000002,
      locationID: 980000000199,
      ownerID: 98000002,
      typeID: 87612,
    },
    shotDamage: {
      em: 588,
      kinetic: 588,
    },
    totalDamage: 940.8,
    hitQuality: 3,
    includeAttackerID: true,
  });
  const payloadObject = marshalDictToObject(payload);

  assert.equal(payloadObject.source, 980000000199);
  assert.equal(payloadObject.weapon, 87612);
  assert.equal(payloadObject.sourceCharID, 98000002);
  assert.equal(payloadObject.targetOwnerID, 140000003);
  assert.equal(payloadObject.attackerID, 980000000199);
});
