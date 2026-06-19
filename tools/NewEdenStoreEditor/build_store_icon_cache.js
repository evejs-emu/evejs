const fs = require("fs");
const path = require("path");
const readline = require("readline");

const repoRoot = path.resolve(__dirname, "..", "..");
const outputPath = path.join(
  repoRoot,
  "server/src/newDatabase/data/itemIcons/data.json",
);

function extractSnapshotBuild(name) {
  const match = /^eve-online-static-data-(\d+)-jsonl$/.exec(name);
  return match ? Number(match[1]) : null;
}

function findLatestJsonlSnapshotDir() {
  const dataRoot = path.join(repoRoot, "data");
  if (!fs.existsSync(dataRoot)) {
    throw new Error(`Data directory not found: ${dataRoot}`);
  }

  const candidates = fs
    .readdirSync(dataRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => extractSnapshotBuild(name) !== null)
    .sort(
      (left, right) => extractSnapshotBuild(left) - extractSnapshotBuild(right),
    );

  if (candidates.length === 0) {
    throw new Error(`No JSONL snapshot directories found under: ${dataRoot}`);
  }

  return path.join(dataRoot, candidates[candidates.length - 1]);
}

function resolveSnapshotDir(explicitArg = process.argv[2]) {
  const explicit = explicitArg;
  if (!explicit) {
    return findLatestJsonlSnapshotDir();
  }

  const candidate = path.resolve(repoRoot, explicit);
  if (!fs.existsSync(candidate)) {
    throw new Error(`Snapshot directory not found: ${candidate}`);
  }
  return candidate;
}

function toPositiveInteger(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    return null;
  }
  return numeric;
}

async function loadIconsByID(filePath) {
  const iconsByID = {};
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    const row = JSON.parse(line);
    const iconID = toPositiveInteger(row && row._key);
    const iconFile =
      row && typeof row.iconFile === "string" ? row.iconFile.trim() : "";
    if (iconID === null || iconFile === "") {
      continue;
    }

    iconsByID[String(iconID)] = iconFile;
  }

  return iconsByID;
}

async function main(explicitSnapshotDir = process.argv[2]) {
  const snapshotDir = resolveSnapshotDir(explicitSnapshotDir);
  const iconsPath = path.join(snapshotDir, "icons.jsonl");
  if (!fs.existsSync(iconsPath)) {
    throw new Error(`icons.jsonl not found: ${iconsPath}`);
  }

  const iconsByID = await loadIconsByID(iconsPath);
  const payload = {
    meta: {
      version: 1,
      description:
        "Cached iconID to res path authority for local store/catalog image seeding.",
      updatedAt: new Date().toISOString(),
      sourceSnapshot: path.basename(snapshotDir),
    },
    iconsByID,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const summary = {
    iconCount: Object.keys(iconsByID).length,
    outputPath,
    sourceSnapshot: path.basename(snapshotDir),
  };
  process.stdout.write(
    `Seeded item icon cache with ${summary.iconCount} icon paths from ${summary.sourceSnapshot}.\n`,
  );
  process.stdout.write(`SUMMARY ${JSON.stringify(summary)}\n`);
  return summary;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  findLatestJsonlSnapshotDir,
  main,
  resolveSnapshotDir,
};
