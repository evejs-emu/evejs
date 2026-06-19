const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  applyCharacterToSession,
  deriveFactionID,
  getCharacterRecord,
} = require("../src/services/character/characterState");
const {
  getFactionLogoFilePath,
  ensureDirectory,
} = require("../src/services/faction/factionImageStore");
const {
  getFactionIDForCorporation,
  getFactionRecord,
} = require("../src/services/faction/factionState");
const {
  resolveImageRequest,
} = require("../src/_secondary/image/imageRequestResolver");

const IMAGE_FIXTURE_PATH = path.join(
  __dirname,
  "../src/_secondary/image/images/hi.png",
);

test("NPC corporations resolve to their faction identities", () => {
  assert.equal(getFactionIDForCorporation(1000044), 500001);
  assert.equal(deriveFactionID({ corporationID: 1000044, factionID: null }), 500001);
  assert.equal(getFactionRecord(500001).name, "Caldari State");
});

test("character normalization and session bootstrap expose NPC faction affinity", () => {
  const record = getCharacterRecord(140000001);
  assert.equal(record.corporationID, 1000044);
  assert.equal(record.factionID, 500001);

  const session = {
    role: 0n,
    sendNotification() {},
    sendSessionChange() {},
  };
  const result = applyCharacterToSession(session, 140000001, {
    emitNotifications: false,
    selectionEvent: true,
  });

  assert.equal(session.factionID, 500001);
  assert.equal(session.factionid, 500001);
  assert.deepEqual(result.notificationPlan.sessionChanges.factionid, [null, 500001]);
});

test("image resolver serves faction logos for faction IDs and NPC corporation IDs", () => {
  const factionLogoPath = getFactionLogoFilePath(500001, 64);
  ensureDirectory(path.dirname(factionLogoPath));
  const backup = fs.existsSync(factionLogoPath)
    ? fs.readFileSync(factionLogoPath)
    : null;
  fs.copyFileSync(IMAGE_FIXTURE_PATH, factionLogoPath);

  try {
    const factionImage = resolveImageRequest("/Corporation/500001_64.png");
    assert.equal(factionImage.contentType, "image/png");
    assert.equal(path.normalize(factionImage.filePath), path.normalize(factionLogoPath));

    const corpImage = resolveImageRequest("/Corporation/1000044_64.png");
    assert.equal(corpImage.contentType, "image/png");
    assert.equal(path.normalize(corpImage.filePath), path.normalize(factionLogoPath));

    const restImage = resolveImageRequest("/corporations/1000044/logo?size=64");
    assert.equal(path.normalize(restImage.filePath), path.normalize(factionLogoPath));
  } finally {
    if (backup) {
      fs.writeFileSync(factionLogoPath, backup);
    } else if (fs.existsSync(factionLogoPath)) {
      fs.unlinkSync(factionLogoPath);
    }
  }
});
