const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const repoRoot = path.join(__dirname, "..", "..");

const {
  buildPortraitUrl,
  getPortraitFilePath,
  seedAgentPortraits,
} = require(path.join(
  repoRoot,
  "scripts",
  "DataSync",
  "lib",
  "agentPortraitSeeder",
));
const {
  resolveImageRequest,
} = require(path.join(
  repoRoot,
  "server",
  "src",
  "_secondary",
  "image",
  "imageRequestResolver",
));
const {
  clearCharacterPortraits,
  getCharacterPortraitFilePath,
} = require(path.join(
  repoRoot,
  "server",
  "src",
  "services",
  "character",
  "portraitImageStore",
));

test("agent portrait seeder stores requested portrait sizes locally and writes a manifest", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-agent-portraits-"));
  const outputRoot = path.join(tempRoot, "Character");
  const manifestPath = path.join(tempRoot, "agents", "manifest.json");
  const downloadedBytes = Buffer.from([
    0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9,
  ]);
  const requests = [];

  const summary = await seedAgentPortraits({
    agentIDs: [3008683],
    sizes: [64, 256],
    outputRoot,
    manifestPath,
    concurrency: 2,
    fetchImpl: async (url) => {
      requests.push(String(url));
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => Uint8Array.from(downloadedBytes).buffer,
      };
    },
  });

  assert.equal(summary.agentCount, 1);
  assert.equal(summary.totalVariants, 2);
  assert.equal(summary.downloadedVariants, 2);
  assert.equal(summary.failedVariants, 0);
  assert.deepEqual(requests, [
    buildPortraitUrl("https://images.evetech.net/", 3008683, 64),
    buildPortraitUrl("https://images.evetech.net/", 3008683, 256),
  ]);

  const portrait64 = getPortraitFilePath(outputRoot, 3008683, 64);
  const portrait256 = getPortraitFilePath(outputRoot, 3008683, 256);
  assert.equal(fs.existsSync(portrait64), true);
  assert.equal(fs.existsSync(portrait256), true);
  assert.deepEqual(fs.readFileSync(portrait64), downloadedBytes);
  assert.deepEqual(fs.readFileSync(portrait256), downloadedBytes);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.portraits["3008683:64"].status, "downloaded");
  assert.equal(manifest.portraits["3008683:256"].status, "downloaded");
});

test("agent portrait seeder falls back to all-agent scope when CLI passes an empty agent list", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-agent-portraits-all-"));
  const outputRoot = path.join(tempRoot, "Character");
  const manifestPath = path.join(tempRoot, "agents", "manifest.json");
  const requested = [];

  const summary = await seedAgentPortraits({
    agentIDs: [],
    allAgentIDs: [3008683, 3008684],
    sizes: [64],
    outputRoot,
    manifestPath,
    concurrency: 1,
    fetchImpl: async (url) => {
      requested.push(String(url));
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer,
      };
    },
  });

  assert.equal(summary.agentCount, 2);
  assert.equal(summary.totalVariants, 2);
  assert.equal(summary.downloadedVariants, 2);
  assert.deepEqual(requested, [
    buildPortraitUrl("https://images.evetech.net/", 3008683, 64),
    buildPortraitUrl("https://images.evetech.net/", 3008684, 64),
  ]);
});

test("agent portrait seeder repairs known placeholder portraits from local client conversation art", async () => {
  const agentID = 399999901;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-agent-portraits-fallback-"));
  const outputRoot = path.join(tempRoot, "Character");
  const manifestPath = path.join(tempRoot, "agents", "manifest.json");
  const conversationAgentsPath = path.join(tempRoot, "conversation-agents.json");
  const fallbackBytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
  const fallbackSourcePath = path.join(tempRoot, "fallback.png");
  fs.writeFileSync(fallbackSourcePath, fallbackBytes);
  fs.writeFileSync(
    conversationAgentsPath,
    JSON.stringify({
      agentsByID: {
        [String(agentID)]: {
          agentID,
          name: "Fallback Agent",
          imagePath: "res:/ui/texture/classes/conversationui/conversationagents/fallback.png",
          imageCachePath: fallbackSourcePath,
        },
      },
    }),
  );

  const placeholderBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const placeholderSignatures = {
    64: [crypto.createHash("sha1").update(placeholderBytes).digest("hex")],
  };

  const summary = await seedAgentPortraits({
    agentIDs: [agentID],
    sizes: [64],
    outputRoot,
    manifestPath,
    conversationAgentsPath,
    placeholderSignatures,
    convertToJpegImpl: (_sourcePath, targetPath) => {
      fs.writeFileSync(targetPath, Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]));
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => Uint8Array.from(placeholderBytes).buffer,
    }),
  });

  assert.equal(summary.downloadedVariants, 0);
  assert.equal(summary.repairedFromClientVariants, 1);
  assert.equal(summary.generatedJpegVariants, 1);

  const repairedPath = path.join(outputRoot, `${agentID}_64.png`);
  const repairedJpegPath = path.join(outputRoot, `${agentID}_64.jpg`);
  assert.equal(fs.existsSync(repairedPath), true);
  assert.equal(fs.existsSync(repairedJpegPath), true);
  assert.deepEqual(fs.readFileSync(repairedPath), fallbackBytes);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.portraits[`${agentID}:64`].status, "client-fallback");
  assert.equal(manifest.portraits[`${agentID}:64`].contentType, "image/jpeg");

  const repoPortraitPath = getCharacterPortraitFilePath(agentID, 64, "jpg");
  clearCharacterPortraits(agentID);
  fs.mkdirSync(path.dirname(repoPortraitPath), { recursive: true });
  fs.copyFileSync(repairedJpegPath, repoPortraitPath);
  try {
    const resolved = resolveImageRequest(`/Character/${agentID}_64.jpg`);
    assert.equal(resolved.contentType, "image/jpeg");
    assert.equal(path.normalize(resolved.filePath), path.normalize(repoPortraitPath));
  } finally {
    clearCharacterPortraits(agentID);
  }
});

test("agent portrait seeder purges stale local client placeholder cache files for repaired agents", async () => {
  const agentID = 399999902;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-agent-portraits-cache-"));
  const outputRoot = path.join(tempRoot, "Character");
  const manifestPath = path.join(tempRoot, "agents", "manifest.json");
  const cacheRoot = path.join(tempRoot, "client-cache");
  const chatCacheRoot = path.join(cacheRoot, "Chat", "89");
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.mkdirSync(chatCacheRoot, { recursive: true });

  const validPortraitBytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);
  fs.writeFileSync(getPortraitFilePath(outputRoot, agentID, 256, "png"), validPortraitBytes);
  fs.writeFileSync(getPortraitFilePath(outputRoot, agentID, 64, "png"), validPortraitBytes);

  const placeholderBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const placeholderHash = crypto.createHash("sha1").update(placeholderBytes).digest("hex");
  const placeholderPath = path.join(cacheRoot, `${agentID}_256.jpg`);
  fs.writeFileSync(placeholderPath, placeholderBytes);
  const invalidHeaderPath = path.join(chatCacheRoot, `${agentID}_64.jpg`);
  fs.writeFileSync(invalidHeaderPath, Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]));

  const summary = await seedAgentPortraits({
    agentIDs: [agentID],
    sizes: [64, 256],
    outputRoot,
    manifestPath,
    clientPortraitCacheRoots: [cacheRoot],
    placeholderSignatures: {
      256: [placeholderHash],
    },
    convertToJpegImpl: (_sourcePath, targetPath) => {
      fs.writeFileSync(targetPath, Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]));
    },
    fetchImpl: async () => {
      throw new Error("fetch should not run when an existing portrait is present");
    },
  });

  assert.equal(summary.skippedExistingVariants, 2);
  assert.equal(summary.purgedClientCacheVariants, 2);
  assert.equal(summary.generatedJpegVariants, 2);
  assert.equal(fs.existsSync(placeholderPath), false);
  assert.equal(fs.existsSync(invalidHeaderPath), false);
  assert.equal(fs.existsSync(path.join(outputRoot, `${agentID}_64.jpg`)), true);
  assert.equal(fs.existsSync(path.join(outputRoot, `${agentID}_256.jpg`)), true);
});
