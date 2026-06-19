const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const repoRoot = path.join(__dirname, "..", "..");
const patcherPath = path.join(repoRoot, "tools", "ClientSETUP", "blue_dll_patch.ps1");
const recipePath = path.join(repoRoot, "tools", "ClientSETUP", "blue_patch_recipe.json");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function writeUInt16LE(buffer, offset, value) {
  buffer.writeUInt16LE(value, offset);
}

function writeUInt32LE(buffer, offset, value) {
  buffer.writeUInt32LE(value >>> 0, offset);
}

function buildSyntheticPe({ patchOffset = 0x200, patchByte = 0x84 } = {}) {
  const securityOffset = 0x400;
  const securitySize = 0x40;
  const buffer = Buffer.alloc(securityOffset + securitySize, 0);
  buffer[0] = 0x4d;
  buffer[1] = 0x5a;
  writeUInt32LE(buffer, 0x3c, 0x80);
  buffer.write("PE\0\0", 0x80, "binary");
  const optionalHeaderOffset = 0x80 + 4 + 20;
  writeUInt16LE(buffer, optionalHeaderOffset, 0x20b);
  const dataDirectoryOffset = optionalHeaderOffset + 112;
  const securityDirectoryOffset = dataDirectoryOffset + (4 * 8);
  writeUInt32LE(buffer, securityDirectoryOffset, securityOffset);
  writeUInt32LE(buffer, securityDirectoryOffset + 4, securitySize);
  buffer[patchOffset] = patchByte;
  for (let index = securityOffset; index < buffer.length; index += 1) {
    buffer[index] = 0xaa;
  }
  return buffer;
}

function runPatcher(args) {
  return cp.spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", patcherPath, ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
}

test("blue patch recipe contains no binary payload fields", () => {
  const text = fs.readFileSync(recipePath, "utf8");
  const recipe = JSON.parse(text);
  assert.equal(text.includes("data" + "Base64"), false);
  assert.equal(recipe.target, undefined);
  assert.equal(recipe.source.size, 12078736);
  assert.equal(recipe.source.sha256, "24e8368262e565bbf98001488007a78202657031cd8515f89029a36c89052886");
  assert.equal(recipe.peRules.stripAuthenticodeSecurityDirectory, true);
});

test("blue patcher patches a synthetic PE without bundled binary bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-blue-fixture-"));
  const sourceBytes = buildSyntheticPe();
  const inputPath = path.join(root, "blue.dll");
  const outputPath = path.join(root, "blue.patched.dll");
  const localRecipePath = path.join(root, "recipe.json");
  fs.writeFileSync(inputPath, sourceBytes);
  fs.writeFileSync(localRecipePath, JSON.stringify({
    name: "blue.dll",
    description: "synthetic test recipe",
    supportedBuild: 3396210,
    source: {
      size: sourceBytes.length,
      sha256: sha256(sourceBytes),
    },
    patches: [
      {
        offset: 0x200,
        offsetHex: "0x00000200",
        description: "synthetic branch byte",
        beforeHex: "84",
        afterHex: "85",
      },
    ],
    peRules: {
      stripAuthenticodeSecurityDirectory: true,
      recalculateChecksum: true,
    },
    knownPatchedVariants: [],
  }), "utf8");

  const result = runPatcher(["--input", inputPath, "--output", outputPath, "--recipe", localRecipePath]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const patched = fs.readFileSync(outputPath);
  assert.equal(patched[0x200], 0x85);
  assert.equal(patched.length, 0x400);
  assert.equal(patched.readUInt32LE(0x128), 0);
  assert.equal(patched.readUInt32LE(0x12c), 0);

  const status = runPatcher(["--status", "--input", outputPath, "--recipe", localRecipePath]);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /state=already_patched/);
});

test("blue patcher refuses wrong hashes unless explicitly relaxed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-blue-wrong-"));
  const sourceBytes = buildSyntheticPe();
  const wrongBytes = Buffer.from(sourceBytes);
  wrongBytes[0x300] = 0x42;
  const inputPath = path.join(root, "blue.dll");
  const outputPath = path.join(root, "blue.patched.dll");
  const localRecipePath = path.join(root, "recipe.json");
  fs.writeFileSync(inputPath, wrongBytes);
  fs.writeFileSync(localRecipePath, JSON.stringify({
    name: "blue.dll",
    description: "synthetic test recipe",
    supportedBuild: 3396210,
    source: {
      size: sourceBytes.length,
      sha256: sha256(sourceBytes),
    },
    patches: [
      {
        offset: 0x200,
        offsetHex: "0x00000200",
        description: "synthetic branch byte",
        beforeHex: "84",
        afterHex: "85",
      },
    ],
    peRules: {
      stripAuthenticodeSecurityDirectory: true,
      recalculateChecksum: true,
    },
    knownPatchedVariants: [],
  }), "utf8");

  const result = runPatcher(["--input", inputPath, "--output", outputPath, "--recipe", localRecipePath]);
  assert.equal(result.status, 2);
  assert.equal(fs.existsSync(outputPath), false);
});
