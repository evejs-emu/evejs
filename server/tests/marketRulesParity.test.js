const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  computeBrokerFeeInfo,
  computeSccSurchargeInfo,
} = require(path.join(repoRoot, "server/src/services/market/marketRules"));

test("broker fee info keeps CCP raw percentage units and minimum fee behavior", () => {
  const result = computeBrokerFeeInfo(
    {
      brokerCommissionRate: 0.03,
      modificationFeeDiscount: 0.68,
    },
    null,
    1000,
  );

  assert.equal(result.amount, 100);
  assert.equal(result.rawPercentage, 0.03);
  assert.equal(result.usingMinimumValue, true);
});

test("broker fee minimum still applies when standings drive the adjusted rate below zero", () => {
  const result = computeBrokerFeeInfo(
    {
      brokerCommissionRate: -0.02,
      modificationFeeDiscount: 0.68,
    },
    null,
    1000,
  );

  assert.equal(result.amount, 100);
  assert.equal(result.rawPercentage, -0.02);
  assert.equal(result.usingMinimumValue, true);
});

test("broker fee modification math matches the CCP formula before minimum handling", () => {
  const result = computeBrokerFeeInfo(
    {
      brokerCommissionRate: 0.03,
      modificationFeeDiscount: 0.68,
    },
    1000,
    20000,
  );

  assert.equal(result.amount, 762);
  assert.equal(result.rawPercentage, 0.03);
  assert.equal(result.usingMinimumValue, false);
});

test("SCC surcharge keeps CCP raw percentage units and minimum surcharge behavior", () => {
  const result = computeSccSurchargeInfo(
    {
      sccSurchargeRate: 0.005,
      modificationFeeDiscount: 0.68,
    },
    null,
    1000,
  );

  assert.equal(result.amount, 25);
  assert.equal(result.rawPercentage, 0.005);
  assert.equal(result.usingMinimumValue, true);
});
