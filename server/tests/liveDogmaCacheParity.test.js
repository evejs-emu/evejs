const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const itemStore = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const { getCharacterSkillMap } = require(path.join(
  repoRoot,
  "server/src/services/skills/skillState",
));
const liveFittingState = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const weaponDogma = require(path.join(
  repoRoot,
  "server/src/space/combat/weaponDogma",
));
const { buildLiveModuleAttributeMap } = require(path.join(
  repoRoot,
  "server/src/space/modules/liveModuleAttributes",
));

const BENCHMARK_CHARACTER_ID = 140000004;
const BENCHMARK_SHIP_ID = 2990000830;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildCombatScenario() {
  const shipItem = itemStore.findItemById(BENCHMARK_SHIP_ID);
  assert(shipItem, "expected benchmark ship item");

  const skillMap = getCharacterSkillMap(BENCHMARK_CHARACTER_ID);
  assert(skillMap instanceof Map, "expected benchmark skill map");
  assert(skillMap.size > 0, "expected benchmark character skills");

  const containerItems = itemStore.listContainerItems(
    BENCHMARK_CHARACTER_ID,
    BENCHMARK_SHIP_ID,
    null,
  );
  const fittedItems = containerItems.filter(
    (item) =>
      Number(item && item.categoryID) === 7 &&
      Number(item && item.flagID) >= 11 &&
      Number(item && item.flagID) <= 34,
  );
  const moduleItem = fittedItems.find((candidate) =>
    containerItems.some(
      (item) =>
        Number(item && item.categoryID) === 8 &&
        Number(item && item.flagID) === Number(candidate && candidate.flagID),
    ),
  );
  assert(moduleItem, "expected a fitted combat module with a matching loaded charge");

  const chargeItem =
    containerItems.find(
      (item) =>
        Number(item && item.categoryID) === 8 &&
        Number(item && item.flagID) === Number(moduleItem.flagID),
    ) || null;
  assert(chargeItem, "expected a loaded charge item for the benchmark module");

  return {
    shipItem,
    skillMap,
    fittedItems,
    moduleItem,
    chargeItem,
  };
}

test("cached live fitting type maps stay mutation-safe and output-stable", () => {
  const { skillMap } = buildCombatScenario();
  const skillRecord = [...skillMap.values()][0];
  assert(skillRecord, "expected at least one skill record");

  const baselineLiveFitting = liveFittingState.getTypeAttributeMap(skillRecord.typeID);
  const liveFittingSnapshot = cloneValue(baselineLiveFitting);

  baselineLiveFitting[280] = 999999;

  assert.deepEqual(
    liveFittingState.getTypeAttributeMap(skillRecord.typeID),
    liveFittingSnapshot,
  );
});

test("cached weapon dogma skill effective attributes stay mutation-safe and output-stable", () => {
  const { skillMap } = buildCombatScenario();
  const skillRecord = [...skillMap.values()][0];
  assert(skillRecord, "expected at least one skill record");

  const baselineWeaponDogma = weaponDogma.buildSkillEffectiveAttributes(skillRecord);
  const weaponDogmaSnapshot = cloneValue(baselineWeaponDogma);
  baselineWeaponDogma[280] = 999999;

  assert.deepEqual(
    weaponDogma.buildSkillEffectiveAttributes(skillRecord),
    weaponDogmaSnapshot,
  );
});

test("collectShipModifierAttributes stays mutation-safe across repeated calls", () => {
  const { shipItem, skillMap } = buildCombatScenario();

  const baseline = weaponDogma.collectShipModifierAttributes(shipItem, skillMap);
  const snapshot = cloneValue(baseline);

  baseline[37] = 123456;

  assert.deepEqual(
    weaponDogma.collectShipModifierAttributes(shipItem, skillMap),
    snapshot,
  );
});

test("live module and weapon snapshot builders keep stable parity across repeated calls", () => {
  const { shipItem, skillMap, fittedItems, moduleItem, chargeItem } = buildCombatScenario();

  const liveModuleFirst = buildLiveModuleAttributeMap(
    shipItem,
    moduleItem,
    chargeItem,
    skillMap,
    fittedItems,
    [],
  );
  const liveModuleSnapshot = cloneValue(liveModuleFirst);
  liveModuleFirst[51] = 654321;

  const liveModuleSecond = buildLiveModuleAttributeMap(
    shipItem,
    moduleItem,
    chargeItem,
    skillMap,
    fittedItems,
    [],
  );
  assert.deepEqual(liveModuleSecond, liveModuleSnapshot);

  const weaponSnapshotFirst = weaponDogma.buildWeaponModuleSnapshot({
    characterID: BENCHMARK_CHARACTER_ID,
    shipItem,
    moduleItem,
    chargeItem,
    fittedItems,
    skillMap,
    activeModuleContexts: [],
  });
  const weaponSnapshotClone = cloneValue(weaponSnapshotFirst);
  weaponSnapshotFirst.moduleAttributes[54] = 111111;

  const weaponSnapshotSecond = weaponDogma.buildWeaponModuleSnapshot({
    characterID: BENCHMARK_CHARACTER_ID,
    shipItem,
    moduleItem,
    chargeItem,
    fittedItems,
    skillMap,
    activeModuleContexts: [],
  });
  assert.deepEqual(weaponSnapshotSecond, weaponSnapshotClone);
});
