const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  verify,
  pathViolations,
} = require(path.join(
  __dirname,
  "..",
  "..",
  "tools",
  "ReleaseGuard",
  "verify-public-release.js",
));

const forbiddenLocalPath = ["C:", "Users", "John", "Documents", "Testing"].join("\\");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evejs-release-guard-"));
}

test("release guard accepts a clean source-only tree", () => {
  const root = makeTempDir();
  fs.mkdirSync(path.join(root, "tools", "ClientSETUP"), { recursive: true });
  fs.writeFileSync(path.join(root, "README.md"), "# EvEJS\n", "utf8");
  fs.writeFileSync(
    path.join(root, "tools", "ClientSETUP", "blue_patch_recipe.json"),
    JSON.stringify({ source: { sha256: "abc" }, patches: [] }),
    "utf8",
  );

  const result = verify(["--scan-dir", root]);
  assert.equal(result.ok, true, result.violations.join("\n"));
});

test("release guard rejects client/data/binary/key/runtime artifacts", () => {
  const files = [
    "client/EVE/tq/bin64/blue.dll",
    "_backup/pre/SHA256.csv",
    "_local/newDatabase/manifest.json",
    "server/src/newDatabase/data/itemTypes/data.json",
    "server/certs/xmpp-ca-key.pem",
    "tools/ClientSETUP/scripts/EvEJSConfig.bat",
    "market.sqlite",
    "release.zip",
  ];
  const violations = pathViolations(files);
  for (const file of files) {
    assert.ok(
      violations.some((violation) => violation.startsWith(file.replace(/\\/g, "/"))),
      file,
    );
  }
});

test("release guard rejects legacy binary patch payload fields and local paths", () => {
  const root = makeTempDir();
  const filePath = path.join(root, "tools", "ClientSETUP", "bad_recipe.json");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      overlay: {
        ["data" + "Base64"]: "AAAA",
      },
      localPath: forbiddenLocalPath,
    }),
    "utf8",
  );

  const result = verify(["--scan-dir", root]);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((violation) => violation.includes("base64 patch-blob") || violation.includes("binary patch payload")));
  assert.ok(result.violations.some((violation) => violation.includes("Windows user path")));
});
