const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..", "..");
const serverSrcRoot = path.join(repoRoot, "server", "src");

const fighterAuthority = require("../src/newDatabase/data/fighterAbilities/authority.json");
const fighterData = require("../src/newDatabase/data/fighterAbilities/data.json");
const sovGatewayProtoBundle = require("../src/services/sovereignty/sovGatewayProto.bundle.json");
const {
  getSovereigntyProtoTypes,
} = require("../src/services/sovereignty/sovGatewayProto");

const LOCAL_PATH_PATTERN = /_local[\\/]/;

function walkTextFiles(rootPath) {
  const results = [];
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTextFiles(entryPath));
      continue;
    }
    if (!/\.(?:js|json)$/i.test(entry.name)) {
      continue;
    }
    results.push(entryPath);
  }
  return results;
}

test("fighter authority is vendored in server/src and matches generated fighter payload semantics", () => {
  assert.equal(
    fighterData.source.authorityFile,
    "server/src/newDatabase/data/fighterAbilities/authority.json",
  );
  assert.equal(
    fighterData.source.typeDogmaAuthorityFile,
    "server/src/newDatabase/data/typeDogma/data.json",
  );
  assert.equal(
    fighterAuthority.counts.abilityCount,
    Object.keys(fighterAuthority.abilitiesByID).length,
  );

  assert.equal(LOCAL_PATH_PATTERN.test(JSON.stringify(fighterAuthority)), false);
  assert.equal(LOCAL_PATH_PATTERN.test(JSON.stringify(fighterData.source)), false);

  for (const [abilityID, abilityPayload] of Object.entries(fighterData.abilitiesByID)) {
    const authorityPayload = fighterAuthority.abilitiesByID[abilityID];
    assert.ok(authorityPayload, `missing authority snapshot for ability ${abilityID}`);
    assert.equal(
      abilityPayload.effectFamily,
      authorityPayload.effectFamily,
      `fighter effectFamily mismatch for ability ${abilityID}`,
    );
  }
});

test("server/src stays free of _local references and sovereignty proto bundle resolves the expected surface", () => {
  const localHits = [];
  for (const filePath of walkTextFiles(serverSrcRoot)) {
    const contents = fs.readFileSync(filePath, "utf8");
    if (!LOCAL_PATH_PATTERN.test(contents)) {
      continue;
    }
    localHits.push(path.relative(repoRoot, filePath).split(path.sep).join("/"));
  }

  assert.deepEqual(localHits, []);
  assert.equal(LOCAL_PATH_PATTERN.test(JSON.stringify(sovGatewayProtoBundle)), false);
  assert.equal(sovGatewayProtoBundle.meta.entryFiles.length, 16);

  const protoTypes = getSovereigntyProtoTypes();
  assert.equal(Object.keys(protoTypes).length, 76);
  assert.ok(protoTypes.hubGetResourcesRequest);
  assert.ok(protoTypes.skyhookGetAllLocalResponse);
  assert.ok(protoTypes.mercenaryActivityStartRequest);
});
