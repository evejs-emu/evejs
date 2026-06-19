const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const tidiAutoscaler = require(path.join(
  repoRoot,
  "server/src/utils/tidiAutoscaler",
));

function buildOptions(calls) {
  return {
    getSceneCount: () => 1,
    getSystemIDs: () => [30000142],
    logChange: false,
    scheduleChange: (systemIDs, factor) => {
      calls.push({ systemIDs: [...systemIDs], factor });
      return null;
    },
  };
}

test.afterEach(() => {
  tidiAutoscaler._testing.resetState();
});

test("autoscaler tightens TiDi directly to the target factor", () => {
  const calls = [];
  const options = buildOptions(calls);

  const result = tidiAutoscaler._testing.evaluateMeasuredCpuPercent(100, options);
  assert.equal(result.changed, true);
  assert.equal(result.reason, "tighten");
  assert.equal(result.targetFactor, 0.1);
  assert.deepEqual(calls, [
    { systemIDs: [30000142], factor: 0.1 },
  ]);
  assert.equal(tidiAutoscaler._testing.getCurrentFactor(), 0.1);
});

test("autoscaler requires two low-load polls before relaxing TiDi to the target factor", () => {
  const calls = [];
  const options = buildOptions(calls);

  tidiAutoscaler._testing.evaluateMeasuredCpuPercent(100, options);
  assert.equal(tidiAutoscaler._testing.getCurrentFactor(), 0.1);

  const firstRelaxAttempt = tidiAutoscaler._testing.evaluateMeasuredCpuPercent(
    55,
    options,
  );
  assert.equal(firstRelaxAttempt.changed, false);
  assert.equal(firstRelaxAttempt.reason, "await-relax-confirmation");
  assert.equal(firstRelaxAttempt.targetFactor, 1.0);
  assert.equal(tidiAutoscaler._testing.getCurrentFactor(), 0.1);
  assert.equal(tidiAutoscaler._testing.getPendingRelaxFactor(), 1.0);
  assert.equal(tidiAutoscaler._testing.getPendingRelaxPolls(), 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls.at(-1), { systemIDs: [30000142], factor: 0.1 });

  const secondRelaxAttempt = tidiAutoscaler._testing.evaluateMeasuredCpuPercent(
    55,
    options,
  );
  assert.equal(secondRelaxAttempt.changed, true);
  assert.equal(secondRelaxAttempt.reason, "relax");
  assert.equal(secondRelaxAttempt.targetFactor, 1.0);
  assert.equal(tidiAutoscaler._testing.getCurrentFactor(), 1.0);
  assert.equal(tidiAutoscaler._testing.getPendingRelaxFactor(), null);
  assert.equal(tidiAutoscaler._testing.getPendingRelaxPolls(), 0);
  assert.deepEqual(calls.at(-1), { systemIDs: [30000142], factor: 1.0 });
});

test("autoscaler clears a pending relax if load rises back to the current factor", () => {
  const calls = [];
  const options = buildOptions(calls);

  tidiAutoscaler._testing.evaluateMeasuredCpuPercent(100, options);
  tidiAutoscaler._testing.evaluateMeasuredCpuPercent(55, options);

  const stableAtCurrentFactor = tidiAutoscaler._testing.evaluateMeasuredCpuPercent(
    100,
    options,
  );
  assert.equal(stableAtCurrentFactor.changed, false);
  assert.equal(stableAtCurrentFactor.reason, "stable");
  assert.equal(stableAtCurrentFactor.targetFactor, 0.1);
  assert.equal(tidiAutoscaler._testing.getPendingRelaxPolls(), 0);
  assert.equal(tidiAutoscaler._testing.getPendingRelaxFactor(), null);

  const nextRelaxAttempt = tidiAutoscaler._testing.evaluateMeasuredCpuPercent(
    55,
    options,
  );
  assert.equal(nextRelaxAttempt.changed, false);
  assert.equal(nextRelaxAttempt.reason, "await-relax-confirmation");
  assert.equal(nextRelaxAttempt.targetFactor, 1.0);
  assert.equal(tidiAutoscaler._testing.getPendingRelaxPolls(), 1);
  assert.equal(tidiAutoscaler._testing.getPendingRelaxFactor(), 1.0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls.at(-1), { systemIDs: [30000142], factor: 0.1 });
});
