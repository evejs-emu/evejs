const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  calculateShipDerivedAttributes,
  getAttributeIDByNames,
} = require(path.join(repoRoot, "server/src/services/fitting/liveFittingState"));
const {
  buildLiveModuleAttributeMap,
} = require(path.join(repoRoot, "server/src/space/modules/liveModuleAttributes"));

const ATTRIBUTE_SHIELD_CAPACITY = 263;
const ATTRIBUTE_EM_DAMAGE = 114;
const ATTRIBUTE_DAMAGE_DELAY_DURATION =
  getAttributeIDByNames("damageDelayDuration") || 561;
const ATTRIBUTE_DOOMSDAY_DAMAGE_DURATION =
  getAttributeIDByNames("doomsdayDamageDuration") || 2144;
const ATTRIBUTE_DOOMSDAY_DAMAGE_CYCLE_TIME =
  getAttributeIDByNames("doomsdayDamageCycleTime") || 2145;

const TYPE_LEVIATHAN = 3764;
const TYPE_CAPITAL_SHIELD_EXTENDER_II = 40357;
const TYPE_JUDGMENT = 24550;
const TYPE_HOLY_DESTINY = 40631;
const TYPE_DOOMSDAY_OPERATION = 24563;
const TYPE_ADVANCED_DOOMSDAY_OPERATION = 88377;

function buildShipItem(typeID, fittedItems = []) {
  return {
    itemID: 910000001,
    typeID,
    groupID: 30,
    categoryID: 6,
    ownerID: 0,
    fittedItems,
    conditionState: {
      damage: 0,
      charge: 1,
      armorDamage: 0,
      shieldCharge: 1,
      incapacitated: false,
    },
  };
}

function buildModuleItem(itemID, typeID, flagID = 27) {
  return {
    itemID,
    typeID,
    flagID,
    locationID: 910000001,
    ownerID: 0,
    quantity: 1,
    stacksize: 1,
    singleton: 1,
    moduleState: {
      online: true,
      damage: 0,
      charge: 0,
      armorDamage: 0,
      shieldCharge: 0,
      incapacitated: false,
    },
  };
}

function buildSkillRecord(typeID, level = 5) {
  return {
    typeID,
    skillLevel: level,
    trainedSkillLevel: level,
    effectiveSkillLevel: level,
  };
}

test("titans apply the 500% plate/extender role bonus to fitted capital shield extenders", () => {
  const fittedExtender = buildModuleItem(910000101, TYPE_CAPITAL_SHIELD_EXTENDER_II, 19);
  const baseShip = buildShipItem(TYPE_LEVIATHAN, []);
  const fittedShip = buildShipItem(TYPE_LEVIATHAN, [fittedExtender]);

  const baseAttributes = calculateShipDerivedAttributes(0, baseShip, {
    fittedItems: [],
    skillMap: new Map(),
  }).attributes;
  const fittedAttributes = calculateShipDerivedAttributes(0, fittedShip, {
    fittedItems: [fittedExtender],
    skillMap: new Map(),
  }).attributes;

  assert.equal(
    Number(fittedAttributes[ATTRIBUTE_SHIELD_CAPACITY]) - Number(baseAttributes[ATTRIBUTE_SHIELD_CAPACITY]),
    432000,
    "expected titan role bonus to multiply Capital Shield Extender II from 72k to 432k",
  );
});

test("directed doomsdays keep current dogma damage parity at max skills", () => {
  const moduleItem = buildModuleItem(910000201, TYPE_JUDGMENT, 27);
  const shipItem = buildShipItem(11567, [moduleItem]);
  const skillMap = new Map([
    [TYPE_DOOMSDAY_OPERATION, buildSkillRecord(TYPE_DOOMSDAY_OPERATION, 5)],
    [TYPE_ADVANCED_DOOMSDAY_OPERATION, buildSkillRecord(TYPE_ADVANCED_DOOMSDAY_OPERATION, 5)],
  ]);

  const attributes = buildLiveModuleAttributeMap(
    shipItem,
    moduleItem,
    null,
    skillMap,
    [moduleItem],
    [],
  );

  assert.equal(Number(attributes[ATTRIBUTE_EM_DAMAGE]) || 0, 4950000);
  assert.ok(
    (Number(attributes[ATTRIBUTE_DAMAGE_DELAY_DURATION]) || 0) > 0,
    "expected directed doomsdays to retain their non-zero delay window",
  );
});

test("lances preserve pulse-window dogma for damage-over-time application", () => {
  const moduleItem = buildModuleItem(910000301, TYPE_HOLY_DESTINY, 27);
  const shipItem = buildShipItem(11567, [moduleItem]);
  const skillMap = new Map([
    [TYPE_DOOMSDAY_OPERATION, buildSkillRecord(TYPE_DOOMSDAY_OPERATION, 5)],
    [TYPE_ADVANCED_DOOMSDAY_OPERATION, buildSkillRecord(TYPE_ADVANCED_DOOMSDAY_OPERATION, 5)],
  ]);

  const attributes = buildLiveModuleAttributeMap(
    shipItem,
    moduleItem,
    null,
    skillMap,
    [moduleItem],
    [],
  );

  assert.equal(Number(attributes[ATTRIBUTE_EM_DAMAGE]) || 0, 103125);
  assert.ok(
    (Number(attributes[ATTRIBUTE_DOOMSDAY_DAMAGE_DURATION]) || 0) > 0,
    "expected lances to expose a non-zero damage window",
  );
  assert.ok(
    (Number(attributes[ATTRIBUTE_DOOMSDAY_DAMAGE_CYCLE_TIME]) || 0) > 0,
    "expected lances to expose a non-zero damage pulse interval",
  );
});
