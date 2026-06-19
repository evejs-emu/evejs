const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  buildWormholePresentationSnapshot,
  resolveInfoWindowClassLabel,
  resolveJumpClassLabel,
} = require(path.join(
  repoRoot,
  "server/src/services/exploration/wormholes/wormholePresentation",
));

test("wormhole presentation helper matches expected class labels for packaged-client-facing classes", () => {
  assert.equal(resolveInfoWindowClassLabel(7), "High Security Space");
  assert.equal(resolveInfoWindowClassLabel(12), "Thera");
  assert.equal(resolveInfoWindowClassLabel(13), "Shattered Space");
  assert.equal(resolveInfoWindowClassLabel(14), "Drifter Space");
  assert.equal(resolveInfoWindowClassLabel(25), "Triglavian Space");

  assert.equal(resolveJumpClassLabel(7), "High Security Space");
  assert.equal(resolveJumpClassLabel(12), "Deep Unknown Space");
  assert.equal(resolveJumpClassLabel(13), "Unknown Space");
  assert.equal(resolveJumpClassLabel(25), "Triglavian Space");
});

test("wormhole presentation helper exposes age, stability, and ship-mass copy", () => {
  const presentation = buildWormholePresentationSnapshot({
    otherSolarSystemClass: 6,
    wormholeAge: 3,
    wormholeSize: 0.4,
    maxShipJumpMass: 2,
  });

  assert.equal(presentation.classLabel, "Deadly Unknown Space");
  assert.equal(presentation.jumpClassLabel, "Deep Unknown Space");
  assert.equal(presentation.ageLabel, "Less Than 1 Hour Remaining");
  assert.equal(presentation.stabilityLabel, "Stability Critically Disrupted");
  assert.equal(presentation.shipMassLabel, "Up To Medium Ships Can Enter");
});

test("wormhole presentation helper exposes the lingering age state used by client show-info copy", () => {
  const presentation = buildWormholePresentationSnapshot({
    otherSolarSystemClass: 14,
    wormholeAge: 4,
    wormholeSize: 1,
    maxShipJumpMass: 4,
  });

  assert.equal(presentation.classLabel, "Drifter Space");
  assert.equal(presentation.jumpClassLabel, "Drifter Space");
  assert.equal(presentation.ageLabel, "Lingering");
  assert.equal(presentation.shipMassLabel, "Very Large Ships Can Enter");
});
