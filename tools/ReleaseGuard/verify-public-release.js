#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const repoRoot = path.resolve(__dirname, "../..");

const FORBIDDEN_PATH_PATTERNS = [
  /^client(?:\/|$)/i,
  /^_backup(?:\/|$)/i,
  /^_local(?:\/|$)/i,
  /^server\/src\/newDatabase\/data(?:\/|$)/i,
  /^server\/src\/_secondary\/image\/generated(?:\/|$)/i,
  /(?:^|\/)node_modules(?:\/|$)/i,
  /(?:^|\/)target(?:\/|$)/i,
  /(?:^|\/)\.cache(?:\/|$)/i,
  /(?:^|\/)\.pytest_cache(?:\/|$)/i,
  /(?:^|\/)_backup(?:\/|$)/i,
  /^server\/src\/_secondary\/data\/chat(?:\/|$)/i,
  /^externalservices\/market-server\/data\/cache(?:\/|$)/i,
  /^tools\/market-seed\/cache(?:\/|$)/i,
  /^tools\/market-seederv2\/cache(?:\/|$)/i,
  /^server\/certs\/.*\.pem$/i,
  /^server\/src\/_secondary\/express\/certs\/.*\.pem$/i,
  /^tools\/ClientSETUP\/scripts\/EvEJSConfig\.bat$/i,
  /^evejs\.config\.local\.json$/i,
  /^tools\/ClientCodeGrabber\/Latest(?:\/|$)/i,
  /^tools\/ClientSDE\/exports(?:\/|$)/i,
  /^tools\/DataSync\/source_json(?:\/|$)/i,
  /\.(zip|7z|rar|tar|gz|bz2|zst)$/i,
  /\.(sqlite|db|mdb|ldb|wal|shm)$/i,
  /\.(dll|exe|pyd|stuff|ccp)$/i,
  /\.(original|orig|bak|old|tmp|log|dmp|pid)$/i,
  /(?:^|\/)manifest\.dat$/i,
  /(?:^|\/)resfile/i,
  /\.(key|pfx|p12)$/i,
];

const TEXT_CONTENT_PATTERNS = [
  {
    pattern: new RegExp("data" + "Base64", "i"),
    message: "binary patch payload field data" + "Base64",
  },
  {
    pattern: new RegExp(["C:", "\\\\+", "Users", "\\\\+", "John"].join(""), "i"),
    message: "absolute local Windows user path",
  },
  {
    pattern: /BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY/i,
    message: "private key material",
  },
  {
    pattern: /blue-dll\.patch\.json/i,
    message: "legacy blue.dll patch manifest reference",
  },
];

const SKIP_SCAN_DIRS = new Set([
  ".git",
  "client",
  "_backup",
  "_local",
  "node_modules",
  "target",
  ".cache",
  ".pytest_cache",
]);

const SKIP_SCAN_PATH_PATTERNS = [
  /^server\/src\/newDatabase\/data(?:\/|$)/i,
  /^server\/src\/_secondary\/image\/generated(?:\/|$)/i,
  /^tools\/market-seederv2\/target(?:\/|$)/i,
  /^externalservices\/market-server\/target(?:\/|$)/i,
];

const TEXT_EXTENSIONS = new Set([
  ".bat",
  ".cmd",
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".lock",
  ".md",
  ".mjs",
  ".ps1",
  ".py",
  ".rs",
  ".sh",
  ".toml",
  ".txt",
  ".yaml",
  ".yml",
]);

function toRepoPath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isForbiddenPath(repoPath) {
  const normalized = toRepoPath(repoPath);
  return FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isGitRepo() {
  try {
    cp.execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function gitFiles(mode) {
  const args = mode === "staged"
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]
    : ["ls-files"];
  const output = cp.execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(toRepoPath);
}

function scanDirectoryFiles(rootDir, currentDir = rootDir, output = []) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);
    const repoPath = toRepoPath(path.relative(rootDir, fullPath));
    if (entry.isDirectory()) {
      const markerPath = `${repoPath}/`;
      if (isForbiddenPath(markerPath)) {
        output.push(markerPath);
        continue;
      }
      if (SKIP_SCAN_DIRS.has(entry.name)) {
        continue;
      }
      if (SKIP_SCAN_PATH_PATTERNS.some((pattern) => pattern.test(repoPath))) {
        continue;
      }
      scanDirectoryFiles(rootDir, fullPath, output);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    output.push(repoPath);
  }
  return output;
}

function collectFiles(argv) {
  const scanDirIndex = argv.indexOf("--scan-dir");
  if (scanDirIndex >= 0) {
    const scanDir = path.resolve(repoRoot, argv[scanDirIndex + 1] || ".");
    return scanDirectoryFiles(scanDir).map(toRepoPath);
  }

  if (argv.includes("--working-tree")) {
    return scanDirectoryFiles(repoRoot).map(toRepoPath);
  }

  if (isGitRepo()) {
    return gitFiles(argv.includes("--staged") ? "staged" : "tracked");
  }

  return scanDirectoryFiles(repoRoot).map(toRepoPath);
}

function shouldContentScan(repoPath) {
  const extension = path.extname(repoPath).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) || path.basename(repoPath).toLowerCase() === "license";
}

function contentViolations(files, rootForFiles) {
  const violations = [];
  for (const repoPath of files) {
    if (!shouldContentScan(repoPath)) {
      continue;
    }
    const fullPath = path.join(rootForFiles, repoPath);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) {
      continue;
    }
    const text = fs.readFileSync(fullPath, "utf8");
    for (const rule of TEXT_CONTENT_PATTERNS) {
      if (rule.pattern.test(text)) {
        violations.push(`${repoPath}: ${rule.message}`);
      }
    }
  }
  return violations;
}

function pathViolations(files) {
  const violations = [];
  for (const repoPath of files) {
    const normalized = toRepoPath(repoPath);
    if (isForbiddenPath(normalized)) {
      violations.push(`${repoPath}: forbidden release path`);
    }
  }
  return violations;
}

function verify(argv = process.argv.slice(2)) {
  const scanDirIndex = argv.indexOf("--scan-dir");
  const rootForFiles = scanDirIndex >= 0
    ? path.resolve(repoRoot, argv[scanDirIndex + 1] || ".")
    : repoRoot;
  const files = collectFiles(argv);
  const violations = [
    ...pathViolations(files),
    ...contentViolations(files, rootForFiles),
  ];

  return {
    ok: violations.length === 0,
    files,
    violations,
  };
}

if (require.main === module) {
  const result = verify();
  if (!result.ok) {
    console.error("Public release guard failed:");
    for (const violation of result.violations) {
      console.error(` - ${violation}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`Public release guard passed (${result.files.length} file(s) checked).`);
  }
}

module.exports = {
  verify,
  pathViolations,
  contentViolations,
  FORBIDDEN_PATH_PATTERNS,
  TEXT_CONTENT_PATTERNS,
};
