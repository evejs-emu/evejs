"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  validateShipTypeOrGroupRestriction,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));

function resolveExactType(name) {
  const result = resolveItemByName(name);
  assert.equal(result && result.success, true, `Expected type ${name}`);
  assert.equal(result.match && result.match.name, name);
  return result.match;
}

function resolveExactTypeID(typeID, name) {
  const result = resolveItemByTypeID(typeID);
  assert.ok(result, `Expected typeID ${typeID}`);
  assert.equal(result.name, name);
  return result;
}

test("Fighter Support Units accept allowed ship groups or explicit ship types", () => {
  const moduleType = resolveExactType("Fighter Support Unit I");

  const allowedShips = [
    resolveExactType("Chimera"),
    resolveExactType("Wyvern"),
    resolveExactTypeID(45647, "Caiman"),
    resolveExactTypeID(45649, "Komodo"),
  ];
  for (const shipType of allowedShips) {
    const result = validateShipTypeOrGroupRestriction(
      moduleType.typeID,
      shipType,
    );
    assert.equal(
      result.success,
      true,
      `Expected ${moduleType.name} to fit ${shipType.name}`,
    );
  }
});

test("Fighter Support Units still reject hulls outside all allowed groups and types", () => {
  const moduleType = resolveExactType("Fighter Support Unit I");
  const shipType = resolveExactType("Rokh");
  const result = validateShipTypeOrGroupRestriction(
    moduleType.typeID,
    shipType,
  );

  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "INVALID_SHIP_GROUP");
  assert.deepEqual(result.data.allowedShipGroups, [547, 659, 5120]);
  assert.deepEqual(result.data.allowedShipTypes, [45647, 45649]);
});
