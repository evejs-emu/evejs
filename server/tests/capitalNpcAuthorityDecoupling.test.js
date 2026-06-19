const assert = require("node:assert/strict");
const test = require("node:test");

const capitalAuthorityData = require("../src/newDatabase/data/capitalNpcAuthority/data.json");
const {
  listCapitalNpcAuthority,
} = require("../src/space/npc/capitals/capitalNpcCatalog");

const LOCAL_PATH_PATTERN = /_local[\\/]/;

test("capital NPC authority is vendored in server/src and stays aligned with the runtime catalog", () => {
  assert.equal(
    capitalAuthorityData.source.authorityFile,
    "scripts/npcCapitals/spec/capitalNpcAuthority.json",
  );
  assert.equal(
    capitalAuthorityData.source.itemTypesFile,
    "server/src/newDatabase/data/itemTypes/data.json",
  );
  assert.equal(
    capitalAuthorityData.source.typeDogmaAuthorityFile,
    "server/src/newDatabase/data/typeDogma/data.json",
  );
  assert.equal(
    capitalAuthorityData.counts.entryCount,
    capitalAuthorityData.entries.length,
  );
  assert.equal(
    Object.keys(capitalAuthorityData.manifestsByProfileID || {}).length,
    capitalAuthorityData.entries.length,
  );
  assert.equal(LOCAL_PATH_PATTERN.test(JSON.stringify(capitalAuthorityData)), false);

  const runtimeAuthority = listCapitalNpcAuthority();
  assert.equal(runtimeAuthority.length, capitalAuthorityData.entries.length);

  const runtimeProfileIDs = runtimeAuthority
    .map((entry) => String(entry && entry.profileID || ""))
    .sort();
  const vendoredProfileIDs = capitalAuthorityData.entries
    .map((entry) => String(entry && entry.profileID || ""))
    .sort();
  assert.deepEqual(runtimeProfileIDs, vendoredProfileIDs);

  for (const authorityEntry of capitalAuthorityData.entries) {
    const manifest = capitalAuthorityData.manifestsByProfileID[authorityEntry.profileID];
    assert.ok(manifest, `missing vendored manifest for ${authorityEntry.profileID}`);
    assert.equal(manifest.profileID, authorityEntry.profileID);
    assert.equal(Number(manifest.hull && manifest.hull.typeID), Number(authorityEntry.shipTypeID));
    assert.equal(Number(manifest.bounty), Number(authorityEntry.bounty));
  }
});
