const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const clientRoot = process.env.EVEJS_CLIENT_PATH || path.join(repoRoot, "client", "EVE");
const resIndexPath = path.join(clientRoot, "resfileindex.txt");
const resFilesRoot = path.join(path.dirname(clientRoot), "ResFiles");
const outputRoot = path.join(__dirname, "assets", "eve-icons");
const outputIndexPath = path.join(__dirname, "assets", "eve-icon-index.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeId(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const text = String(value).trim();
  return text === "" ? null : text;
}

function buildTypeTargets() {
  const skillTypes = readJson(
    path.join(repoRoot, "server", "src", "newDatabase", "data", "skillTypes", "data.json"),
  ).skills || [];
  const shipTypes = readJson(
    path.join(repoRoot, "server", "src", "newDatabase", "data", "shipTypes", "data.json"),
  ).ships || [];
  const itemTypes = readJson(
    path.join(repoRoot, "server", "src", "newDatabase", "data", "itemTypes", "data.json"),
  ).types || [];
  const items = Object.values(
    readJson(path.join(repoRoot, "server", "src", "newDatabase", "data", "items", "data.json")),
  );

  const itemTypeById = new Map(itemTypes.map((entry) => [String(entry.typeID), entry]));
  const shipTypeById = new Map(shipTypes.map((entry) => [String(entry.typeID), entry]));
  const usedInventoryTypeIds = new Set(items.map((entry) => sanitizeId(entry?.typeID)).filter(Boolean));

  const targets = new Map();
  const pushTarget = (category, entry) => {
    const typeID = sanitizeId(entry?.typeID);
    if (!typeID) {
      return;
    }
    if (!targets.has(typeID)) {
      targets.set(typeID, {
        typeID,
        name: entry?.name || entry?.itemName || `${category} ${typeID}`,
        category,
        iconID: sanitizeId(entry?.iconID),
        graphicID: sanitizeId(entry?.graphicID),
      });
    }
  };

  for (const entry of skillTypes) {
    pushTarget("skill", entry);
  }

  for (const entry of shipTypes) {
    pushTarget("ship", entry);
  }

  for (const typeID of usedInventoryTypeIds) {
    pushTarget("item", itemTypeById.get(typeID) || shipTypeById.get(typeID) || { typeID });
  }

  return [...targets.values()];
}

function buildIconEntryLookup() {
  const lines = fs.readFileSync(resIndexPath, "utf8").split(/\r?\n/);
  const byNumericStem = new Map();

  for (const line of lines) {
    if (!line.includes("/icons/") || !line.endsWith(".png") && !line.includes(".png,")) {
      continue;
    }

    const [resourcePath, hashedPath] = line.split(",", 3);
    if (!resourcePath || !hashedPath) {
      continue;
    }

    const fileName = resourcePath.split("/").pop() || "";
    const stemMatch = fileName.match(/^(\d+)_/);
    if (!stemMatch) {
      continue;
    }

    const numericStem = stemMatch[1];
    const entry = {
      resourcePath,
      hashedPath,
      fileName,
    };

    if (!byNumericStem.has(numericStem)) {
      byNumericStem.set(numericStem, []);
    }
    byNumericStem.get(numericStem).push(entry);
  }

  return byNumericStem;
}

function scoreIconEntry(entry) {
  let score = 0;
  if (entry.resourcePath.startsWith("res:/ui/texture/icons/")) {
    score += 1000;
  }
  if (entry.fileName.includes("_64_") || entry.fileName.includes("_64.")) {
    score += 200;
  }
  if (entry.fileName.includes("_128_") || entry.fileName.includes("_128.")) {
    score += 140;
  }
  if (entry.fileName.includes("_32_") || entry.fileName.includes("_32.")) {
    score += 80;
  }
  if (entry.fileName.includes("_16_") || entry.fileName.includes("_16.")) {
    score += 40;
  }
  if (entry.fileName.includes("_d.") || entry.fileName.includes("_n.")) {
    score -= 500;
  }
  if (entry.fileName.includes("_1.")) {
    score += 10;
  }
  return score;
}

function findBestIconEntry(target, lookup) {
  const candidateIds = [target.typeID, target.iconID, target.graphicID].filter(Boolean);

  for (const candidateId of candidateIds) {
    const entries = lookup.get(String(candidateId)) || [];
    if (entries.length === 0) {
      continue;
    }

    const best = [...entries].sort((left, right) => scoreIconEntry(right) - scoreIconEntry(left))[0];
    if (best) {
      return {
        matchId: String(candidateId),
        ...best,
      };
    }
  }

  return null;
}

function main() {
  ensureDir(outputRoot);
  const targets = buildTypeTargets();
  const lookup = buildIconEntryLookup();

  const extracted = [];
  const missing = [];

  for (const target of targets) {
    const iconEntry = findBestIconEntry(target, lookup);
    if (!iconEntry) {
      missing.push(target);
      continue;
    }

    const sourcePath = path.join(resFilesRoot, iconEntry.hashedPath.replace(/\//g, path.sep));
    if (!fs.existsSync(sourcePath)) {
      missing.push({ ...target, reason: "missing source file", sourcePath });
      continue;
    }

    const destinationPath = path.join(outputRoot, `${target.typeID}.png`);
    fs.copyFileSync(sourcePath, destinationPath);
    extracted.push({
      typeID: target.typeID,
      name: target.name,
      category: target.category,
      sourcePath: iconEntry.resourcePath,
      matchedBy: iconEntry.matchId === target.typeID ? "typeID" : iconEntry.matchId === target.iconID ? "iconID" : "graphicID",
      file: path.relative(repoRoot, destinationPath).replace(/\\/g, "/"),
    });
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    extractedCount: extracted.length,
    missingCount: missing.length,
    extracted,
    missing,
  };

  fs.writeFileSync(outputIndexPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ extractedCount: extracted.length, missingCount: missing.length }, null, 2)}\n`);
}

main();
