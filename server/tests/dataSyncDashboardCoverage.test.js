const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const dataSyncRoot = path.join(repoRoot, "scripts", "DataSync");

const COVERAGE_ENTRYPOINTS = [
  path.join(dataSyncRoot, "sync-client-data.js"),
  path.join(dataSyncRoot, "sync-jsonl-local-static-data.js"),
];

const ALLOWED_HELPERS = new Set([
  "Export-ClientDungeonData.ps1",
  "decode-static-fsd.py",
  "RunClientDataSyncDashboard.bat",
  "RunReferenceDataSyncDashboard.bat",
  "SeedAgentPortraits.bat",
  "sync-client-data.js",
  "sync-jsonl-local-static-data.js",
  "typeDogmaSupplements.js",
]);

function listRootScripts() {
  return fs.readdirSync(dataSyncRoot)
    .filter((name) => {
      const fullPath = path.join(dataSyncRoot, name);
      return fs.statSync(fullPath).isFile() && /\.(js|ps1|py|bat)$/i.test(name);
    })
    .sort((left, right) => left.localeCompare(right));
}

test("DataSync root-level scripts are covered by the main client/SDE dashboards or explicitly marked as helpers", () => {
  const entrypointSources = COVERAGE_ENTRYPOINTS
    .map((filePath) => fs.readFileSync(filePath, "utf8"));

  const uncovered = listRootScripts().filter((scriptName) => {
    if (ALLOWED_HELPERS.has(scriptName)) {
      return false;
    }
    return !entrypointSources.some((source) => source.includes(scriptName));
  });

  assert.deepEqual(uncovered, []);
});
