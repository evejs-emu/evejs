const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const config = require(path.join(repoRoot, "server/src/config"));
const worldData = require(path.join(repoRoot, "server/src/space/worldData"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));

const originalNewEdenSystemLoading = config.NewEdenSystemLoading;

function getAllSystemIDs() {
  return worldData.getSolarSystems()
    .map((system) => Number(system && system.solarSystemID) || 0)
    .filter((systemID) => systemID > 0)
    .sort((left, right) => left - right);
}

function getDisplayedHighsecSystemIDs() {
  return worldData.getSolarSystems()
    .filter((system) => {
      const rawSecurity = Math.max(0, Math.min(1, Number(system && system.security) || 0));
      const displayedSecurity = Math.round(rawSecurity * 10) / 10;
      return displayedSecurity >= 0.5;
    })
    .map((system) => Number(system && system.solarSystemID) || 0)
    .filter((systemID) => systemID > 0)
    .sort((left, right) => left - right);
}

test.afterEach(() => {
  config.NewEdenSystemLoading = originalNewEdenSystemLoading;
  spaceRuntime._testing.clearScenes();
  spaceRuntime._testing.resetStargateActivationOverrides();
});

test("mode 1 preserves the default lazy startup preload list", () => {
  config.NewEdenSystemLoading = 1;

  const plan = spaceRuntime._testing.resolveStartupSolarSystemPreloadPlanForTesting();

  assert.equal(
    plan.mode,
    spaceRuntime._testing.NEW_EDEN_SYSTEM_LOADING.LAZY,
  );
  assert.deepEqual(
    plan.systemIDs,
    [...spaceRuntime._testing.STARTUP_PRELOADED_SYSTEM_IDS],
  );
});

test("mode 2 resolves startup preload systems dynamically from displayed 0.5+ security", () => {
  config.NewEdenSystemLoading = 2;

  const plan = spaceRuntime._testing.resolveStartupSolarSystemPreloadPlanForTesting();

  assert.equal(
    plan.mode,
    spaceRuntime._testing.NEW_EDEN_SYSTEM_LOADING.HIGHSEC,
  );
  assert.deepEqual(plan.systemIDs, getDisplayedHighsecSystemIDs());
});

test("mode 3 resolves startup preload systems to every solar system", () => {
  config.NewEdenSystemLoading = 3;

  const plan = spaceRuntime._testing.resolveStartupSolarSystemPreloadPlanForTesting();

  assert.equal(
    plan.mode,
    spaceRuntime._testing.NEW_EDEN_SYSTEM_LOADING.ALL,
  );
  assert.deepEqual(plan.systemIDs, getAllSystemIDs());
});

test("mode 4 preserves the default preload list while enabling on-demand gate access", () => {
  config.NewEdenSystemLoading = 4;

  const plan = spaceRuntime._testing.resolveStartupSolarSystemPreloadPlanForTesting();

  assert.equal(
    plan.mode,
    spaceRuntime._testing.NEW_EDEN_SYSTEM_LOADING.ONGOING_LAZY,
  );
  assert.deepEqual(
    plan.systemIDs,
    [...spaceRuntime._testing.STARTUP_PRELOADED_SYSTEM_IDS],
  );
});

test("invalid startup preload modes fall back to mode 1", () => {
  config.NewEdenSystemLoading = 99;

  const plan = spaceRuntime._testing.resolveStartupSolarSystemPreloadPlanForTesting();

  assert.equal(
    plan.mode,
    spaceRuntime._testing.NEW_EDEN_SYSTEM_LOADING.LAZY,
  );
  assert.deepEqual(
    plan.systemIDs,
    [...spaceRuntime._testing.STARTUP_PRELOADED_SYSTEM_IDS],
  );
});
