/**
 * DATABASE CONTROLLER:
 * In-memory cached database layer.
 *
 * All tables are loaded into memory at startup. Reads are served
 * instantly from the cache. Writes update the cache immediately and
 * schedule a debounced flush to disk so hot write paths stay cheap while the
 * on-disk JSON files are still written through a safer recovery-friendly path.
 *
 * The public API (read / write / remove) is unchanged — every
 * consumer in the codebase works without modification.
 */

const path = require("path");
const fs = require("fs");
const { isDeepStrictEqual } = require("util");
const pc = require("picocolors");

const log = require("../utils/logger");

// ── Config ──────────────────────────────────────────────────────────
const SOURCE_DATA_DIR = path.join(__dirname, "data");
const LOCAL_DATA_DIR = path.resolve(__dirname, "../../../_local/newDatabase/data");

function resolveDataDir() {
  if (process.env.EVEJS_NEWDB_DATA_DIR) {
    return path.resolve(process.env.EVEJS_NEWDB_DATA_DIR);
  }
  if (fs.existsSync(LOCAL_DATA_DIR)) {
    return LOCAL_DATA_DIR;
  }
  return SOURCE_DATA_DIR;
}

const DATA_DIR = resolveDataDir();
const FLUSH_DELAY_MS = 2000; // debounce: flush 2s after last write
const RECOVERABLE_EMPTY_TABLES = new Set([
  "npcRuntimeState",
  "npcControlState",
  "npcEntities",
  "npcModules",
  "npcCargo",
  "npcRuntimeControllers",
  "npcWrecks",
  "npcWreckItems",
  "wormholeRuntimeState",
  "probeRuntimeState",
  "dungeonRuntimeState",
  "missionRuntimeState",
  "planetRuntimeState",
  "planetOrbitalState",
]);
// ────────────────────────────────────────────────────────────────────

// ── Cache state ─────────────────────────────────────────────────────
const cache = {};          // table name → parsed JS object
const dirty = new Set();   // tables that need flushing
const flushTimers = {};    // table name → pending setTimeout id
const transientPaths = {}; // table name → Set of cache paths excluded from disk flush
let preloaded = false;
// ────────────────────────────────────────────────────────────────────

// ── Helpers ─────────────────────────────────────────────────────────

function dbTag() {
  return pc.bgGreen(pc.black(" DB  "));
}

function timestamp() {
  return pc.dim(new Date().toISOString().slice(11, 19));
}

function dbLog(message) {
  console.log(`${timestamp()} ${dbTag()} ${message}`);
}

function dbWarn(message) {
  console.log(`${timestamp()} ${dbTag()} ${pc.yellow(message)}`);
}

function dbErr(message) {
  console.error(`${timestamp()} ${dbTag()} ${pc.red(message)}`);
}

function dataFilePath(table) {
  return path.join(DATA_DIR, table, "data.json");
}

function getDataDir(...segments) {
  return path.join(DATA_DIR, ...segments);
}

function backupFilePath(table) {
  return `${dataFilePath(table)}.bak`;
}

function tempFilePath(filePath) {
  return `${filePath}.tmp-${process.pid}`;
}

function isSameValue(left, right) {
  if (left === right) {
    return true;
  }
  return isDeepStrictEqual(left, right);
}

function getSegments(pathKey) {
  return String(pathKey || "/").split("/").filter(Boolean);
}

function normalizeTransientPath(pathKey) {
  const segments = getSegments(pathKey);
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function getTransientPathSet(table) {
  if (!transientPaths[table]) {
    transientPaths[table] = new Set();
  }
  return transientPaths[table];
}

function clearTransientPathsForPrefix(table, pathKey) {
  const normalizedPath = normalizeTransientPath(pathKey);
  const pathSet = transientPaths[table];
  if (!pathSet || pathSet.size === 0) {
    return;
  }

  for (const candidatePath of [...pathSet]) {
    if (
      candidatePath === normalizedPath ||
      candidatePath.startsWith(`${normalizedPath}/`)
    ) {
      pathSet.delete(candidatePath);
    }
  }
}

function setTransientPath(table, pathKey, enabled = true) {
  const normalizedPath = normalizeTransientPath(pathKey);
  const pathSet = getTransientPathSet(table);
  if (enabled) {
    pathSet.add(normalizedPath);
  } else {
    clearTransientPathsForPrefix(table, normalizedPath);
  }
}

function cloneForFlush(value) {
  return JSON.parse(JSON.stringify(value));
}

function deletePath(target, pathKey) {
  const segments = getSegments(pathKey);
  if (segments.length === 0) {
    return {};
  }

  let current = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (
      current === null ||
      typeof current !== "object" ||
      !(segment in current)
    ) {
      return target;
    }
    current = current[segment];
  }

  const finalKey = segments[segments.length - 1];
  if (current && typeof current === "object" && finalKey in current) {
    delete current[finalKey];
  }
  return target;
}

function buildFlushSnapshot(table) {
  const source = cache[table];
  const pathSet = transientPaths[table];
  if (!pathSet || pathSet.size === 0) {
    return source;
  }

  const snapshot = cloneForFlush(source);
  for (const transientPath of pathSet) {
    deletePath(snapshot, transientPath);
  }
  return snapshot;
}

function ensureDataFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({}, null, 2));
  }
}

function safeWriteFileSync(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = tempFilePath(filePath);
  fs.writeFileSync(temporaryPath, contents, "utf8");
  if (fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, `${filePath}.bak`);
    } catch (error) {
      dbWarn(`backup copy failed for ${path.basename(filePath)}: ${error.message}`);
    }
  }
  fs.copyFileSync(temporaryPath, filePath);
  fs.unlinkSync(temporaryPath);
}

function readParsedJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (String(raw || "").trim().length === 0) {
      return {
        success: false,
        raw,
        error: new SyntaxError("Unexpected end of JSON input"),
      };
    }
    return {
      success: true,
      raw,
      data: JSON.parse(raw),
    };
  } catch (error) {
    return {
      success: false,
      raw: null,
      error,
    };
  }
}

function getRecoveryCandidates(table) {
  const filePath = dataFilePath(table);
  const directory = path.dirname(filePath);
  const baseName = path.basename(filePath);
  const candidates = [];
  const backupPath = backupFilePath(table);
  if (fs.existsSync(backupPath)) {
    candidates.push(backupPath);
  }
  if (fs.existsSync(directory)) {
    const tempCandidates = fs.readdirSync(directory)
      .filter((name) => name.startsWith(`${baseName}.tmp-`))
      .map((name) => path.join(directory, name))
      .sort((left, right) => {
        try {
          return fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs;
        } catch (error) {
          return 0;
        }
      });
    candidates.push(...tempCandidates);
  }
  return candidates;
}

function tryRecoverTableFile(table) {
  const filePath = dataFilePath(table);
  for (const candidatePath of getRecoveryCandidates(table)) {
    const parsedCandidate = readParsedJsonFile(candidatePath);
    if (!parsedCandidate.success) {
      continue;
    }
    cache[table] = parsedCandidate.data;
    safeWriteFileSync(filePath, parsedCandidate.raw);
    dbWarn(`recovered ${table} from ${path.basename(candidatePath)}`);
    return Buffer.byteLength(parsedCandidate.raw, "utf8");
  }
  return null;
}

// ── Cache loading ───────────────────────────────────────────────────

function loadTable(table) {
  const filePath = dataFilePath(table);
  ensureDataFile(filePath);
  const parsedMain = readParsedJsonFile(filePath);
  if (parsedMain.success) {
    cache[table] = parsedMain.data;
    return Buffer.byteLength(parsedMain.raw, "utf8");
  }

  if (
    RECOVERABLE_EMPTY_TABLES.has(table) &&
    String(parsedMain.raw || "").trim().length === 0
  ) {
    cache[table] = {};
    safeWriteFileSync(filePath, JSON.stringify({}, null, 2));
    dbWarn(`recovered empty ${table} table with default {}`);
    return 2;
  }

  const recoveredBytes = tryRecoverTableFile(table);
  if (recoveredBytes !== null) {
    return recoveredBytes;
  }

  throw parsedMain.error;
}

/**
 * Preload every table directory under data/ into memory.
 * Called once at startup before the TCP server accepts connections.
 */
function preloadAll() {
  if (preloaded) return;
  preloaded = true;

  if (!fs.existsSync(DATA_DIR)) {
    throw new Error(
      `EvEJS generated database is missing. Run SetupEveJS.bat first. Expected data root: ${DATA_DIR}`,
    );
  }

  const totalStart = Date.now();
  const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
  const tables = entries
    .filter((e) => e.isDirectory() && fs.existsSync(dataFilePath(e.name)))
    .map((e) => e.name);

  dbLog(`preloading ${tables.length} tables into memory...`);

  let totalBytes = 0;
  const timings = [];

  for (const table of tables) {
    const t0 = Date.now();
    const bytes = loadTable(table);
    const elapsed = Date.now() - t0;
    totalBytes += bytes;
    timings.push({ table, bytes, elapsed });
  }

  const totalElapsed = Date.now() - totalStart;

  // Log per-table, sorted slowest first
  timings.sort((a, b) => b.elapsed - a.elapsed);
  for (const { table, bytes, elapsed } of timings) {
    const sizeMB = (bytes / 1024 / 1024).toFixed(1);
    const name = table.padEnd(25);
    const time = String(elapsed).padStart(5) + "ms";
    const size = `(${sizeMB} MB)`.padStart(11);
    dbLog(`  ${pc.cyan(name)} ${pc.white(time)}  ${pc.dim(size)}`);
  }

  const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
  dbLog(
    `${pc.green("cache ready")} — ${tables.length} tables, ` +
    `${totalMB} MB loaded in ${pc.bold(totalElapsed + "ms")}`,
  );
}

// ── Debounced async flush ───────────────────────────────────────────

function scheduleFlush(table) {
  dirty.add(table);

  if (flushTimers[table]) {
    clearTimeout(flushTimers[table]);
  }

  flushTimers[table] = setTimeout(() => {
    flushTable(table);
  }, FLUSH_DELAY_MS);
}

function flushTable(table) {
  if (!dirty.has(table)) return;
  dirty.delete(table);
  delete flushTimers[table];

  const data = buildFlushSnapshot(table);

  try {
    const json = JSON.stringify(data, null, 2);
    safeWriteFileSync(dataFilePath(table), json);
  } catch (err) {
    dbErr(`flush FAILED for ${table}: ${err.message}`);
    dirty.add(table);
  }
}

function flushTableSync(table, options = {}) {
  if (!ensureCached(table)) {
    log.warn(`[DATABASE] database table: '${table}' not found!`);
    return { success: false, errorMsg: "TABLE_NOT_FOUND" };
  }

  if (flushTimers[table]) {
    clearTimeout(flushTimers[table]);
    delete flushTimers[table];
  }

  if (!dirty.has(table)) {
    return { success: true, errorMsg: null, flushed: false };
  }

  try {
    safeWriteFileSync(
      dataFilePath(table),
      JSON.stringify(buildFlushSnapshot(table), null, 2),
    );
    dirty.delete(table);
    if (options.log === true) {
      dbLog(`  ${pc.cyan(table)} ${pc.green("flushed")}`);
    }
    return { success: true, errorMsg: null, flushed: true };
  } catch (err) {
    dbErr(`sync flush FAILED for ${table}: ${err.message}`);
    dirty.add(table);
    return { success: false, errorMsg: "FLUSH_ERROR", flushed: false };
  }
}

function flushTablesSync(tables = []) {
  const uniqueTables = [...new Set(
    (Array.isArray(tables) ? tables : [tables]).filter((table) => Boolean(table)),
  )];
  const results = [];
  let success = true;

  for (const table of uniqueTables) {
    const result = flushTableSync(table);
    results.push({ table, ...result });
    if (!result.success) {
      success = false;
    }
  }

  return {
    success,
    results,
  };
}

/**
 * Synchronously flush ALL dirty tables.  Called on shutdown so
 * nothing is lost when the process exits.
 */
function flushAllSync() {
  const dirtyTables = [...dirty];
  if (dirtyTables.length === 0) return;

  dbLog(`shutdown flush — writing ${dirtyTables.length} dirty table(s)...`);

  for (const table of dirtyTables) {
    const result = flushTableSync(table, { log: true });
    if (!result.success) {
      dbErr(`shutdown flush FAILED for ${table}: ${result.errorMsg || "FLUSH_ERROR"}`);
    }
  }

  dbLog(pc.green("shutdown flush complete"));
}

// ── Graceful shutdown ───────────────────────────────────────────────

let shutdownInProgress = false;

function flushDirtyTablesForShutdown(reason) {
  if (shutdownInProgress) {
    return false;
  }
  shutdownInProgress = true;
  dbLog(`received ${reason}, flushing cache to disk...`);
  flushAllSync();
  return true;
}

function onShutdownSignal(signal, exitCode = 0) {
  flushDirtyTablesForShutdown(signal);
  process.exit(exitCode);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) {
  try {
    process.on(signal, () => onShutdownSignal(signal));
  } catch (error) {
    dbWarn(`failed to register ${signal} shutdown handler: ${error.message}`);
  }
}

process.on("beforeExit", () => {
  if (dirty.size > 0) {
    flushDirtyTablesForShutdown("beforeExit");
  }
});

process.on("exit", () => {
  // Last-chance sync flush for any remaining dirty tables
  if (dirty.size > 0) {
    flushDirtyTablesForShutdown("exit");
  }
});

// ── Public API (unchanged signature) ────────────────────────────────

function ensureCached(table) {
  if (!(table in cache)) {
    const tableDir = path.join(DATA_DIR, table);
    if (!fs.existsSync(tableDir)) {
      return false;
    }
    loadTable(table);
  }
  return true;
}

function read(table, pth) {
  if (!ensureCached(table)) {
    log.warn(`[DATABASE] database table: '${table}' not found!`);
    return { success: false, errorMsg: "TABLE_NOT_FOUND", data: null };
  }

  try {
    const segments = getSegments(pth);
    const db = cache[table];

    if (segments.length === 0) {
      return { success: true, errorMsg: null, data: db };
    }

    let current = db;
    for (const segment of segments) {
      if (
        current === null ||
        typeof current !== "object" ||
        !(segment in current)
      ) {
        return { success: false, errorMsg: "ENTRY_NOT_FOUND", data: null };
      }
      current = current[segment];
    }

    return { success: true, errorMsg: null, data: current };
  } catch (error) {
    log.error(`[DATABASE READ ERROR] ${error.message}`);
    return { success: false, errorMsg: "READ_ERROR", data: null };
  }
}

function write(table, pth, data, options = {}) {
  if (!ensureCached(table)) {
    log.warn(`[DATABASE] database table: '${table}' not found!`);
    return { success: false, errorMsg: "TABLE_NOT_FOUND" };
  }

  try {
    const segments = getSegments(pth);

    if (segments.length === 0) {
      // Full table overwrite
      const sameReference = cache[table] === data;
      const unchanged = sameReference ? false : isSameValue(cache[table], data);
      if (options.transient === true) {
        setTransientPath(table, "/", true);
      }
      if (unchanged && options.force !== true) {
        return { success: true, errorMsg: null };
      }
      if (!sameReference) {
        cache[table] = data;
      }
      if (!(options.transient === true && options.force !== true)) {
        scheduleFlush(table);
      }
      return { success: true, errorMsg: null };
    }

    let current = cache[table];
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i];
      if (
        !(segment in current) ||
        current[segment] === null ||
        typeof current[segment] !== "object"
      ) {
        current[segment] = {};
      }
      current = current[segment];
    }

    if (options.transient === true) {
      setTransientPath(table, pth, true);
    }
    const finalKey = segments[segments.length - 1];
    if (Object.prototype.hasOwnProperty.call(current, finalKey) && isSameValue(current[finalKey], data)) {
      return { success: true, errorMsg: null };
    }
    current[finalKey] = data;
    scheduleFlush(table);

    return { success: true, errorMsg: null };
  } catch (error) {
    log.error(`[DATABASE WRITE ERROR] ${error.message}`);
    return { success: false, errorMsg: "WRITE_ERROR" };
  }
}

function remove(table, pth) {
  if (!ensureCached(table)) {
    log.warn(`[DATABASE] database table: '${table}' not found!`);
    return { success: false, errorMsg: "TABLE_NOT_FOUND" };
  }

  try {
    const segments = getSegments(pth);

    if (segments.length === 0) {
      return { success: false, errorMsg: "INVALID_PATH" };
    }

    let current = cache[table];
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i];
      if (
        current === null ||
        typeof current !== "object" ||
        !(segment in current)
      ) {
        return { success: false, errorMsg: "ENTRY_NOT_FOUND" };
      }
      current = current[segment];
    }

    const finalKey = segments[segments.length - 1];
    if (
      current === null ||
      typeof current !== "object" ||
      !(finalKey in current)
    ) {
      return { success: false, errorMsg: "ENTRY_NOT_FOUND" };
    }

    delete current[finalKey];
    clearTransientPathsForPrefix(table, pth);
    scheduleFlush(table);

    return { success: true, errorMsg: null };
  } catch (error) {
    log.error(`[DATABASE DELETE ERROR] ${error.message}`);
    return { success: false, errorMsg: "DELETE_ERROR" };
  }
}

module.exports = {
  read,
  write,
  remove,
  setTransientPath,
  getDataDir,
  preloadAll,
  flushTableSync,
  flushTablesSync,
  flushAllSync,
};
