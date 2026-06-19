const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const {
  buildSpaceAttachHydrationPlan,
} = require(path.join(__dirname, "../src/space/modules/moduleLoadParity"));

function assertTqAttachPlan(plan, profileID) {
  assert.deepEqual(plan, { profileID });
}

test("space attach hydration profiles resolve to one authoritative profile", () => {
  assertTqAttachPlan(buildSpaceAttachHydrationPlan("login"), "login");
  assertTqAttachPlan(buildSpaceAttachHydrationPlan("stargate"), "stargate");
  assertTqAttachPlan(buildSpaceAttachHydrationPlan("solar"), "solar");
  assertTqAttachPlan(buildSpaceAttachHydrationPlan("transition"), "transition");
  assertTqAttachPlan(buildSpaceAttachHydrationPlan("undock"), "undock");
  assertTqAttachPlan(buildSpaceAttachHydrationPlan("capsule"), "capsule");
});
