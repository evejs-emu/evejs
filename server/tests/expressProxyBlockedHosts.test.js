const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const expressProxy = require(path.join(
  __dirname,
  "..",
  "src",
  "_secondary",
  "express",
  "server",
));

test("express proxy blocked-host matcher honors exact and suffix patterns", () => {
  const hooks = expressProxy.__testHooks;
  const patterns = hooks.parseHostPatternList(
    "api.ipify.org,sentry.io,.sentry.io,google-analytics.com,.google-analytics.com,launchdarkly.com,.launchdarkly.com",
  );

  assert.equal(hooks.hostMatchesPattern("api.ipify.org", "api.ipify.org"), true);
  assert.equal(hooks.hostMatchesPattern("sentry.io", "sentry.io"), true);
  assert.equal(hooks.hostMatchesPattern("sentry.io", ".sentry.io"), true);
  assert.equal(hooks.hostMatchesPattern("o123.ingest.sentry.io", ".sentry.io"), true);
  assert.equal(hooks.hostMatchesPattern("google-analytics.com", ".google-analytics.com"), true);
  assert.equal(hooks.hostMatchesPattern("www.google-analytics.com", ".google-analytics.com"), true);
  assert.equal(hooks.hostMatchesPattern("launchdarkly.com", ".launchdarkly.com"), true);
  assert.equal(hooks.hostMatchesPattern("mobile.launchdarkly.com", ".launchdarkly.com"), true);
  assert.equal(hooks.hostMatchesPattern("example.com", ".sentry.io"), false);
  assert.equal(hooks.hostMatchesPattern("api.ipify.org", ".sentry.io"), false);

  assert.equal(
    patterns.some((pattern) => hooks.hostMatchesPattern("api.ipify.org", pattern)),
    true,
  );
  assert.equal(
    patterns.some((pattern) => hooks.hostMatchesPattern("o123.ingest.sentry.io", pattern)),
    true,
  );
  assert.equal(
    patterns.some((pattern) => hooks.hostMatchesPattern("www.google-analytics.com", pattern)),
    true,
  );
  assert.equal(
    patterns.some((pattern) => hooks.hostMatchesPattern("mobile.launchdarkly.com", pattern)),
    true,
  );
  assert.equal(
    patterns.some((pattern) => hooks.hostMatchesPattern("public-gateway.evetech.net", pattern)),
    false,
  );
});

test("express proxy denies unhandled hosts by policy while preserving explicit intercept and allow-list hosts", () => {
  const hooks = expressProxy.__testHooks;

  assert.equal(
    hooks.shouldDenyUnhandledProxyHost("www.google-analytics.com", {
      interceptHosts: ["public-gateway.evetech.net"],
      allowedHosts: [],
      policy: "block",
    }),
    true,
  );
  assert.equal(
    hooks.shouldDenyUnhandledProxyHost("public-gateway.evetech.net", {
      interceptHosts: ["public-gateway.evetech.net"],
      allowedHosts: [],
      policy: "block",
    }),
    false,
  );
  assert.equal(
    hooks.shouldDenyUnhandledProxyHost("images.examplecdn.net", {
      interceptHosts: [],
      allowedHosts: hooks.parseHostPatternList(".examplecdn.net"),
      policy: "block",
    }),
    false,
  );
  assert.equal(
    hooks.shouldDenyUnhandledProxyHost("www.google-analytics.com", {
      interceptHosts: [],
      allowedHosts: [],
      policy: "forward",
    }),
    false,
  );
});
