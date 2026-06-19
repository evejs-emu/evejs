const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildNpcEntityIdentity,
} = require("../src/space/npc/npcPresentation");

test("unpublished Blood Raiders edition NPC hulls inherit a real collision radius from their base hull", () => {
  const prophecyIdentity = buildNpcEntityIdentity({
    profile: {
      shipTypeID: 33875,
      name: "Prophecy Blood Raiders Edition",
    },
  });
  const coercerIdentity = buildNpcEntityIdentity({
    profile: {
      shipTypeID: 33879,
      name: "Coercer Blood Raiders Edition",
    },
  });

  assert.equal(
    prophecyIdentity.radius,
    173,
    "expected unpublished Prophecy Blood Raiders Edition NPCs to inherit Prophecy's real collision radius instead of falling back to 1",
  );
  assert.equal(
    coercerIdentity.radius,
    144,
    "expected unpublished Coercer Blood Raiders Edition NPCs to inherit Coercer's real collision radius instead of falling back to 1",
  );
});
