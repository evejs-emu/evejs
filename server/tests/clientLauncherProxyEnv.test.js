const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const launcher = require(path.join(
  __dirname,
  "..",
  "src",
  "_secondary",
  "launcher",
  "server",
));

test("client launcher only bypasses loopback hosts so blocked domains stay on proxy policy", () => {
  const noProxyValue = launcher.__testHooks.buildNoProxyValue();
  const entries = new Set(
    String(noProxyValue)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

  assert.ok(entries.has("127.0.0.1"));
  assert.ok(entries.has("localhost"));
  assert.ok(entries.has("::1"));
  assert.ok(!entries.has("api.ipify.org"));
  assert.ok(!entries.has("sentry.io"));
  assert.ok(!entries.has(".sentry.io"));
  assert.ok(!entries.has("launchdarkly.com"));
  assert.ok(!entries.has(".launchdarkly.com"));
});
