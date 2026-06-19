const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const clientRoot = process.env.EVEJS_CLIENT_PATH || path.join(repoRoot, "client", "EVE");
const resIndexPath = path.join(clientRoot, "resfileindex.txt");
const resFilesRoot = path.join(path.dirname(clientRoot), "ResFiles");
const outputRoot = path.join(__dirname, "assets", "ui-icons");
const outputIndexPath = path.join(__dirname, "assets", "ui-icon-index.json");

const RESOURCE_MAP = {
  wallet: "res:/ui/texture/windowicons/wallet.png",
  isk: "res:/ui/texture/eveicon/category_icons/isk_32px.png",
  plex: "res:/ui/texture/eveicon/category_icons/plex_32px.png",
  aur: "res:/ui/texture/icons/aurcoin.png",
  skillbook: "res:/ui/texture/classes/skills/skillbooknotinjected.png",
  open_window: "res:/ui/texture/eveicon/system_icons/open_window_16px.png",
  randomize: "res:/ui/texture/eveicon/category_icons/randomize_16px.png",
  refresh: "res:/ui/texture/eveicon/system_icons/refresh_16px.png",
  save: "res:/ui/texture/eveicon/system_icons/save_location_16px.png",
  folder: "res:/ui/texture/windowicons/folder.png",
  edit: "res:/ui/texture/eveicon/system_icons/edit_16px.png",
  delete: "res:/ui/texture/classes/skillplan/buttonicons/delete.png",
  add: "res:/ui/texture/classes/skillplan/buttonicons/buttoniconplus.png",
  close: "res:/ui/texture/eveicon/system_icons/close_16px.png",
  checkmark: "res:/ui/texture/eveicon/system_icons/checkmark_16px.png",
  details: "res:/ui/texture/eveicon/system_icons/details_view_16px.png",
  time: "res:/ui/texture/classes/expertsystems/time.png",
  security: "res:/ui/texture/classes/agency/icons/contenttypes/securityagent.png",
  cargo: "res:/ui/texture/eveicon/control_icons/cargo_inventory_32px.png",
  warning: "res:/ui/texture/classes/warning/warningiconsmall.png",
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function main() {
  ensureDir(outputRoot);
  const indexLines = fs.readFileSync(resIndexPath, "utf8").split(/\r?\n/);
  const lineByResourcePath = new Map();

  for (const line of indexLines) {
    const [resourcePath] = line.split(",", 2);
    if (resourcePath) {
      lineByResourcePath.set(resourcePath, line);
    }
  }

  const copied = [];
  const missing = [];

  for (const [key, resourcePath] of Object.entries(RESOURCE_MAP)) {
    const line = lineByResourcePath.get(resourcePath);
    if (!line) {
      missing.push({ key, resourcePath, reason: "missing from resfileindex" });
      continue;
    }

    const [, hashedPath] = line.split(",", 3);
    const sourcePath = path.join(resFilesRoot, hashedPath.replace(/\//g, path.sep));
    if (!fs.existsSync(sourcePath)) {
      missing.push({ key, resourcePath, reason: "missing in ResFiles", sourcePath });
      continue;
    }

    const destinationPath = path.join(outputRoot, `${key}.png`);
    fs.copyFileSync(sourcePath, destinationPath);
    copied.push({
      key,
      resourcePath,
      file: path.relative(repoRoot, destinationPath).replace(/\\/g, "/"),
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    copiedCount: copied.length,
    missingCount: missing.length,
    copied,
    missing,
  };

  fs.writeFileSync(outputIndexPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ copiedCount: copied.length, missingCount: missing.length }, null, 2)}\n`);
}

main();
