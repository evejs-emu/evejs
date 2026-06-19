const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const PhotoUploadService = require(path.join(
  repoRoot,
  "server/src/services/character/photoUploadService",
));
const {
  CHARACTER_PORTRAIT_SIZES,
  clearCharacterPortraits,
  getCharacterPortraitFilePath,
} = require(path.join(
  repoRoot,
  "server/src/services/character/portraitImageStore",
));
const {
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

test("photoUploadSvc stores uploaded character portraits across served sizes", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalIdentityState = cloneValue(database.read("identityState", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);

  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("identityState", "/", originalIdentityState);
    database.write("items", "/", originalItems);
    database.write("skills", "/", originalSkills);
    database.flushAllSync();
  });

  const charService = new CharService();
  const photoUploadService = new PhotoUploadService();
  const session = {
    userid: 910100,
    charid: null,
    characterID: null,
  };

  const charId = charService.Handle_CreateCharacterWithDoll(
    ["Portrait Upload Parity", 4, 5, 0, 3, null, null, 11],
    session,
  );

  t.after(() => {
    clearCharacterPortraits(charId);
  });

  const photoBytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);
  const uploadResult = photoUploadService.Handle_Upload(
    [charId, photoBytes],
    session,
  );
  assert.equal(uploadResult, true);

  for (const size of CHARACTER_PORTRAIT_SIZES) {
    const portraitPath = getCharacterPortraitFilePath(charId, size);
    assert.equal(fs.existsSync(portraitPath), true, `expected size ${size}`);
    assert.deepEqual(fs.readFileSync(portraitPath), photoBytes);
  }

  const record = getCharacterRecord(charId);
  assert.equal(record.portraitByteLength, photoBytes.length);
  assert.deepEqual(record.portraitSizes, [...CHARACTER_PORTRAIT_SIZES]);
  assert.equal(typeof record.portraitUploadedAt, "string");
});
