const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..");
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));

test("space runtime exports gotoPoint wrapper for Beyonce movement commands", () => {
  assert.equal(typeof spaceRuntime.gotoPoint, "function");
});
