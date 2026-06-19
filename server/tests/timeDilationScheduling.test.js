const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  buildTimeDilationNotificationArgs,
  scheduleAdvanceNoticeTimeDilationForSystems,
  scheduleSynchronizedTimeDilationForSystems,
} = require(path.join(
  repoRoot,
  "server/src/utils/synchronizedTimeDilation",
));

function buildSchedulerHarness() {
  const events = [];
  const timers = [];
  return {
    events,
    timers,
    options: {
      delayMs: 2000,
      notifySystemFn: (systemID, factor) => {
        events.push(`notify:${systemID}:${factor.toFixed(3)}`);
      },
      applySystemFactorFn: (systemID, factor) => {
        events.push(`apply:${systemID}:${factor.toFixed(3)}`);
      },
      getCurrentSystemFactorFn: () => 1.0,
      setTimeoutFn: (callback, delayMs) => {
        timers.push({ callback, delayMs });
        return { callback, delayMs };
      },
    },
  };
}

test("advance notice TiDi scheduling notifies first and applies after the delay", () => {
  const harness = buildSchedulerHarness();

  scheduleAdvanceNoticeTimeDilationForSystems(
    [30000142],
    0.5,
    harness.options,
  );

  assert.deepEqual(harness.events, [
    "notify:30000142:0.500",
  ]);
  assert.equal(harness.timers.length, 1);
  assert.equal(harness.timers[0].delayMs, 2000);

  harness.timers[0].callback();

  assert.deepEqual(harness.events, [
    "notify:30000142:0.500",
    "apply:30000142:0.500",
  ]);
});

test("TiDi clear notifications force clients back to 1.0 deterministically", () => {
  assert.deepEqual(
    buildTimeDilationNotificationArgs(1.0),
    [1.0, 1.0, 100000000],
  );
});

test("synchronized TiDi scheduling still applies notify and factor in the same delayed tick", () => {
  const harness = buildSchedulerHarness();

  scheduleSynchronizedTimeDilationForSystems(
    [30000142],
    0.5,
    harness.options,
  );

  assert.deepEqual(harness.events, []);
  assert.equal(harness.timers.length, 1);
  assert.equal(harness.timers[0].delayMs, 2000);

  harness.timers[0].callback();

  assert.deepEqual(harness.events, [
    "notify:30000142:0.500",
    "apply:30000142:0.500",
  ]);
});

test("advance notice TiDi scheduling skips no-op factor reapply on systems already at the target factor", () => {
  const harness = buildSchedulerHarness();
  harness.options.getCurrentSystemFactorFn = () => 1.0;

  const handle = scheduleAdvanceNoticeTimeDilationForSystems(
    [30000142],
    1.0,
    harness.options,
  );

  assert.equal(handle, null);
  assert.deepEqual(harness.events, []);
  assert.equal(harness.timers.length, 0);
});
