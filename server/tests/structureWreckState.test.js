const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const structureWreckState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureWreckState",
));

test("structure wreck lookup resolves the correct CCP wreck type for core Upwell hulls", () => {
  const keepstarWreck = structureWreckState.resolveStructureWreckType(35834);
  assert.ok(keepstarWreck, "Expected Keepstar wreck type to resolve");
  assert.equal(keepstarWreck.typeID, 40646);
  assert.equal(keepstarWreck.name, "Keepstar Wreck");

  const fortizarWreck = structureWreckState.resolveStructureWreckType(35833);
  assert.ok(fortizarWreck, "Expected Fortizar wreck type to resolve");
  assert.equal(fortizarWreck.typeID, 40645);

  const moreauWreck = structureWreckState.resolveStructureWreckType(47512);
  assert.ok(moreauWreck, "Expected faction Fortizar wreck type to resolve");
  assert.equal(moreauWreck.typeID, 47517);
  assert.equal(moreauWreck.name, "'Moreau' Fortizar Wreck");
});

test("structure wreck lookup resolves non-Upwell and non-category structure wrecks from client data", () => {
  const expectedMappings = new Map([
    [46363, [46605, "Guristas Forward Operating Base Wreck"]],
    [46364, [46606, "Blood Raiders Forward Operating Base Wreck"]],
    [78260, [79385, "Angel FOB Wreck"]],
    [79172, [79386, "Guristas FOB Wreck"]],
    [32458, [83843, "Sovereignty Hub Wreck"]],
    [81080, [83844, "Orbital Skyhook Wreck"]],
    [85230, [86175, "Mercenary Den Wreck"]],
    [84294, [85057, "Vigilance Spire Wreck"]],
    [87227, [87312, "Vigilant Dreamer Wreck"]],
  ]);

  for (const [structureTypeID, [wreckTypeID, wreckName]] of expectedMappings) {
    const wreckType = structureWreckState.resolveStructureWreckType(structureTypeID);
    assert.ok(wreckType, `Expected wreck type to resolve for structure ${structureTypeID}`);
    assert.equal(wreckType.typeID, wreckTypeID);
    assert.equal(wreckType.name, wreckName);
  }
});
