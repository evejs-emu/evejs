const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const config = require(path.join(repoRoot, "server/src/config"));
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const EVEHandshake = require(path.join(
  repoRoot,
  "server/src/network/tcp/handshake",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

test("TiDi signedFunc snaps both into and out of TiDi", (t) => {
  const originalFlag = config.devHandshakeSeedSkillExtractorAccessToken;
  t.after(() => {
    config.devHandshakeSeedSkillExtractorAccessToken = originalFlag;
  });

  config.devHandshakeSeedSkillExtractorAccessToken = true;
  const source = EVEHandshake._testing.buildTidiSignedFuncSource();

  assert.match(source, /blue\.os\.dilationOverloadAdjustment = 0\.1/);
  assert.match(source, /blue\.os\.dilationUnderloadAdjustment = 1000(?:\.0)?/);
  assert.match(source, /blue\.os\.dilationOverloadAdjustment = 0\.8254/);
  assert.match(source, /blue\.os\.dilationUnderloadAdjustment = 1\.059254/);
  assert.match(source, /photoUploadSvc'\)\.Upload\(charID, photoData\)/);
  assert.match(
    source,
    /_evejs_photosvc\._evejs_original_add_portrait = _evejs_photosvc\.EvePhoto\.AddPortrait/,
  );
  assert.match(
    source,
    /def _evejs_add_portrait\(self, portraitPath, charID, _evejs_original_add_portrait=_evejs_photosvc\._evejs_original_add_portrait\):/,
  );
  assert.match(source, /PORTRAIT_UPLOAD_HANDLER:OK/);
  assert.match(source, /_evejs_connection = sm\.GetService\('connection'\)/);
  assert.match(source, /_evejs_connection\.accessToken = 'evejs-local-skill-extractor'/);
  assert.doesNotMatch(source, /_evejs_connection\.computerHash = 1/);
  assert.match(source, /SKILL_EXTRACTOR_ACCESS_TOKEN:OK/);
  assert.doesNotMatch(source, /INDUSTRY_CHARACTER_MODIFIER_FALLBACK:OK/);
  assert.doesNotMatch(
    source,
    /_evejs_clientdogma\.DogmaLocation\.GetIndustryCharacterModifiers = _evejs_get_industry_character_modifiers/,
  );
});

test("TiDi signedFunc omits the skill extractor token patch when disabled", (t) => {
  const originalFlag = config.devHandshakeSeedSkillExtractorAccessToken;
  t.after(() => {
    config.devHandshakeSeedSkillExtractorAccessToken = originalFlag;
  });

  config.devHandshakeSeedSkillExtractorAccessToken = false;
  const source = EVEHandshake._testing.buildTidiSignedFuncSource();

  assert.doesNotMatch(source, /SKILL_EXTRACTOR_ACCESS_TOKEN:OK/);
  assert.doesNotMatch(source, /_evejs_connection\.accessToken = 'evejs-local-skill-extractor'/);
  assert.doesNotMatch(source, /INDUSTRY_CHARACTER_MODIFIER_FALLBACK:OK/);
  assert.doesNotMatch(
    source,
    /_evejs_clientdogma\.DogmaLocation\.GetIndustryCharacterModifiers = _evejs_get_industry_character_modifiers/,
  );
});

test("auto-created accounts reserve the next free numeric account id above persisted references", (t) => {
  const originalAccounts = cloneValue(database.read("accounts", "/").data || {});
  const originalCharacters = cloneValue(database.read("characters", "/").data || {});
  const originalIdentityState = cloneValue(database.read("identityState", "/").data || {});

  t.after(() => {
    database.write("accounts", "/", originalAccounts, { force: true });
    database.write("characters", "/", originalCharacters, { force: true });
    database.write("identityState", "/", originalIdentityState, { force: true });
    database.flushAllSync();
  });

  database.write(
    "accounts",
    "/",
    {
      alpha: { id: 1 },
      gamma: { id: 3 },
    },
    { force: true },
  );
  database.write(
    "characters",
    "/",
    {
      140000099: {
        accountId: 9,
        characterName: "Stale Ownership",
      },
    },
    { force: true },
  );
  database.write(
    "identityState",
    "/",
    {
      version: 1,
      nextAccountID: 1,
      nextCharacterID: 140000001,
    },
    { force: true },
  );
  database.flushAllSync();

  assert.equal(EVEHandshake._testing.reserveAccountID(), 10);
});
