const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const {
  TYPE_GAS_DECOMPRESSION_EFFICIENCY,
  buildReprocessingQuoteForItem,
  getGasDecompressionCharacterEfficiency,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningIndustry",
));
const {
  getTypeMaterials,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningStaticData",
));

test("reprocessing quote respects portion size, leftovers, and recoverables", () => {
  const context = {
    dockedKind: "station",
    stationRecord: {
      reprocessingEfficiency: 0.5,
      reprocessingStationsTake: 0.05,
    },
    skillMap: new Map(),
    implants: [],
  };
  const item = {
    itemID: 900001,
    typeID: 1230,
    singleton: 0,
    quantity: 205,
    stacksize: 205,
  };

  const quote = buildReprocessingQuoteForItem(item, context);
  assert.ok(quote, "expected a reprocessing quote");
  assert.equal(quote.quantityToProcess, 200);
  assert.equal(quote.leftOvers, 5);
  assert.equal(quote.portions, 2);
  assert.equal(quote.stationTax, 0.05);
  assert.equal(quote.stationEfficiency, 0.5);

  const materials = getTypeMaterials(item.typeID);
  assert.ok(materials.length > 0, "expected static materials for the ore type");
  for (const material of materials) {
    const recoverable = quote.recoverables.find((entry) => entry.typeID === material.materialTypeID);
    assert.ok(recoverable, `expected recoverable entry for ${material.materialTypeID}`);
    assert.equal(
      recoverable.client,
      Math.floor((material.quantity * quote.portions) * quote.efficiency),
    );
    assert.equal(
      recoverable.unrecoverable,
      (material.quantity * quote.portions) - recoverable.client,
    );
  }
});

test("gas decompression skill bonus is derived from the CCP dogma attribute", () => {
  const skillMap = new Map([
    [TYPE_GAS_DECOMPRESSION_EFFICIENCY, {
      typeID: TYPE_GAS_DECOMPRESSION_EFFICIENCY,
      skillLevel: 5,
      trainedSkillLevel: 5,
      effectiveSkillLevel: 5,
    }],
  ]);

  assert.equal(
    getGasDecompressionCharacterEfficiency(skillMap),
    0.05,
  );
});
