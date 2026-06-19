"use strict";

/**
 * rotatingLog — hourly rotating file logger.
 *
 * All log paths share a single module-level stream map.  On each write, the
 * current UTC hour is compared against the hour the stream was opened.  When
 * they differ the live file is renamed to an archive copy that encodes the old
 * hour (e.g. server.2026-04-25_14.log) and a fresh stream is opened.
 *
 * Two entry points are exposed:
 *   append(filePath, line)     — async stream write, low overhead, safe for
 *                                high-frequency paths.
 *   appendSync(filePath, line) — synchronous write, safe to call during
 *                                process shutdown / crash handlers.
 */

const fs = require("fs");
const path = require("path");

// filePath -> { stream: WriteStream, hourKey: string }
const _streams = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentHourKey() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  return `${y}-${mo}-${d}_${h}`;
}

function hourKeyFromDate(date) {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  return `${y}-${mo}-${d}_${h}`;
}

/** Returns the archive path for a base log file and a given hour key.
 *  e.g. /logs/server.log + 2026-04-25_14  ->  /logs/server.2026-04-25_14.log
 */
function archivePath(filePath, hourKey) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  return path.join(dir, `${base}.${hourKey}${ext}`);
}

function ensureDir(filePath) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch (_) {}
}

function closeStreamEntry(filePath) {
  const entry = _streams.get(filePath);
  if (!entry) return;
  try {
    if (!entry.stream.destroyed) entry.stream.end();
  } catch (_) {}
  _streams.delete(filePath);
}

// ---------------------------------------------------------------------------
// Stream-based (async) append
// ---------------------------------------------------------------------------

/**
 * Returns the active write stream for filePath, rotating if the UTC hour has
 * changed since the stream was opened.
 */
function getStream(filePath) {
  const hourKey = currentHourKey();
  const entry = _streams.get(filePath);

  if (entry) {
    if (entry.hourKey === hourKey) return entry.stream;

    // Hour rolled over — archive the current file and open a fresh one.
    const oldHourKey = entry.hourKey;
    closeStreamEntry(filePath);
    try {
      if (fs.existsSync(filePath)) {
        fs.renameSync(filePath, archivePath(filePath, oldHourKey));
      }
    } catch (_) {}
  }

  ensureDir(filePath);
  const stream = fs.createWriteStream(filePath, { flags: "a", encoding: "utf8" });
  // Errors are swallowed here; individual callers handle them as needed.
  stream.on("error", () => {});
  _streams.set(filePath, { stream, hourKey });
  return stream;
}

/**
 * Appends `line` to the log at `filePath`, rotating the file at UTC hour
 * boundaries.  `line` must already include a trailing newline.
 *
 * Uses an async write stream — do NOT call from crash/shutdown handlers where
 * the event loop may not flush buffered writes.  Use appendSync() instead.
 */
function append(filePath, line) {
  try {
    getStream(filePath).write(line);
  } catch (_) {
    // Fallback: sync write if stream acquisition fails.
    try {
      ensureDir(filePath);
      fs.appendFileSync(filePath, line, "utf8");
    } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Synchronous append (safe during shutdown / crash handlers)
// ---------------------------------------------------------------------------

/**
 * Appends `line` to the log at `filePath` synchronously, rotating the file at
 * UTC hour boundaries.  `line` must already include a trailing newline.
 *
 * Safe to call from uncaughtException / signal handlers where the event loop
 * may no longer be pumping.
 */
function appendSync(filePath, line) {
  const hourKey = currentHourKey();
  ensureDir(filePath);

  try {
    // Determine the hour the current file belongs to, preferring the tracked
    // stream's hour key over a stat-based guess.
    const entry = _streams.get(filePath);
    const knownHourKey = entry ? entry.hourKey : null;

    // Always close any open stream before the synchronous rename/write so the
    // OS file handle is released.
    if (entry) closeStreamEntry(filePath);

    if (fs.existsSync(filePath)) {
      const fileHourKey = knownHourKey || (() => {
        try {
          return hourKeyFromDate(fs.statSync(filePath).mtime);
        } catch (_) {
          return hourKey; // Cannot determine — assume current hour, skip rename.
        }
      })();

      if (fileHourKey !== hourKey) {
        try {
          fs.renameSync(filePath, archivePath(filePath, fileHourKey));
        } catch (_) {}
      }
    }
  } catch (_) {}

  try {
    fs.appendFileSync(filePath, line, "utf8");
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function closeAll() {
  for (const filePath of Array.from(_streams.keys())) {
    closeStreamEntry(filePath);
  }
}

process.once("exit", closeAll);
process.once("beforeExit", closeAll);

module.exports = { append, appendSync, closeAll };
