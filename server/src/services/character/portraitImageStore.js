const fs = require("fs");
const path = require("path");

const CHARACTER_PORTRAIT_SIZES = Object.freeze([32, 64, 128, 256, 512, 1024]);
const CHARACTER_PORTRAIT_EXTENSIONS = Object.freeze(["jpg", "png"]);
const IMAGE_ROOT = path.join(__dirname, "../../_secondary/image");
const GENERATED_ROOT = path.join(IMAGE_ROOT, "generated");
const CHARACTER_ROOT = path.join(GENERATED_ROOT, "Character");
const DEFAULT_CHARACTER_PORTRAIT_PATH = path.join(IMAGE_ROOT, "images", "hi.jpg");

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizePortraitExtension(extension = "jpg") {
  const normalized = String(extension || "").trim().toLowerCase();
  return CHARACTER_PORTRAIT_EXTENSIONS.includes(normalized) ? normalized : "jpg";
}

function getCharacterPortraitFilePath(charId, size, extension = "jpg") {
  const numericCharId = toNumber(charId, 0);
  const numericSize = toNumber(size, 0);
  return path.join(
    CHARACTER_ROOT,
    `${numericCharId}_${numericSize}.${normalizePortraitExtension(extension)}`,
  );
}

function listCharacterPortraitPaths(charId) {
  const numericCharId = toNumber(charId, 0);
  return CHARACTER_PORTRAIT_SIZES.flatMap((size) => (
    CHARACTER_PORTRAIT_EXTENSIONS.map((extension) => ({
      size,
      extension,
      filePath: getCharacterPortraitFilePath(numericCharId, size, extension),
    }))
  ));
}

function normalizePortraitBytes(value) {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (typeof value === "string") {
    return Buffer.from(value, "binary");
  }

  return Buffer.alloc(0);
}

function storeCharacterPortrait(charId, bytes, options = {}) {
  const numericCharId = toNumber(charId, 0);
  const portraitBytes = normalizePortraitBytes(bytes);
  const extension = normalizePortraitExtension(options.extension);
  const sizes = Array.isArray(options.sizes) && options.sizes.length > 0
    ? options.sizes.map((size) => toNumber(size, 0)).filter((size) => size > 0)
    : CHARACTER_PORTRAIT_SIZES;

  if (numericCharId <= 0 || portraitBytes.length === 0) {
    return {
      success: false,
      errorMsg: "INVALID_PORTRAIT_PAYLOAD",
    };
  }

  ensureDirectory(CHARACTER_ROOT);
  for (const size of sizes) {
    fs.writeFileSync(
      getCharacterPortraitFilePath(numericCharId, size, extension),
      portraitBytes,
    );
  }

  return {
    success: true,
    data: {
      charId: numericCharId,
      sizes: [...sizes],
      byteLength: portraitBytes.length,
    },
  };
}

function findCharacterPortraitPath(charId, size = null) {
  const numericCharId = toNumber(charId, 0);
  if (numericCharId <= 0) {
    return null;
  }

  if (size !== null && size !== undefined) {
    for (const extension of CHARACTER_PORTRAIT_EXTENSIONS) {
      const exactPath = getCharacterPortraitFilePath(numericCharId, size, extension);
      if (fs.existsSync(exactPath)) {
        return exactPath;
      }
    }
  }

  for (const { filePath } of listCharacterPortraitPaths(numericCharId)) {
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}

function clearCharacterPortraits(charId) {
  const numericCharId = toNumber(charId, 0);
  if (numericCharId <= 0) {
    return;
  }

  for (const { filePath } of listCharacterPortraitPaths(numericCharId)) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

module.exports = {
  CHARACTER_PORTRAIT_EXTENSIONS,
  CHARACTER_PORTRAIT_SIZES,
  DEFAULT_CHARACTER_PORTRAIT_PATH,
  findCharacterPortraitPath,
  getCharacterPortraitFilePath,
  storeCharacterPortrait,
  clearCharacterPortraits,
};
