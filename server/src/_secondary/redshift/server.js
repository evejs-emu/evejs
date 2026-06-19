"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const log = require(path.join(__dirname, "../../utils/logger"));
const tidiAutoscaler = require(path.join(
  __dirname,
  "../../utils/tidiAutoscaler",
));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const sessionRegistry = require(path.join(
  __dirname,
  "../../services/chat/sessionRegistry",
));
const {
  scheduleSynchronizedTimeDilationForSystems,
} = require(path.join(__dirname, "../../utils/synchronizedTimeDilation"));

const DEFAULT_PORT = 26400;
const DEFAULT_HOST = "127.0.0.1";

// ---------- Region / constellation name lookup ----------
// Loaded once on first use from the bundled EVE static data.

const STATIC_DATA_DIR = path.join(
  __dirname, "../../../../data/eve-online-static-data-3294658-jsonl",
);
let mapNamesCache = null;

function loadMapNames() {
  if (mapNamesCache) return mapNamesCache;
  const result = { constellations: new Map(), regions: new Map() };
  try {
    const parseJsonl = (file, bucket) => {
      const fullPath = path.join(STATIC_DATA_DIR, file);
      if (!fs.existsSync(fullPath)) return;
      const text = fs.readFileSync(fullPath, "utf8");
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        try {
          const row = JSON.parse(line);
          const id = Number(row._key);
          const name = row && row.name && row.name.en;
          if (id && typeof name === "string") bucket.set(id, name);
        } catch (_) { /* skip malformed */ }
      }
    };
    parseJsonl("mapConstellations.jsonl", result.constellations);
    parseJsonl("mapRegions.jsonl", result.regions);
  } catch (err) {
    log.warn(`[Redshift] map-names load failed: ${err.message}`);
  }
  mapNamesCache = result;
  return mapNamesCache;
}

function getConstellationName(id) {
  if (!id) return null;
  return loadMapNames().constellations.get(Number(id)) || null;
}

function getRegionName(id) {
  if (!id) return null;
  return loadMapNames().regions.get(Number(id)) || null;
}

function clampFactor(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(1.0, Math.max(0.1, n));
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

function sendJson(res, statusCode, body) {
  setCors(res);
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        req.destroy();
        reject(new Error("body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function getSessionCountByScene() {
  const counts = new Map();
  try {
    for (const session of sessionRegistry.getSessions()) {
      const systemID = Number(
        (session && session._space && session._space.systemID) ||
          (session && session.solarsystemid2) ||
          (session && session.solarsystemid) ||
          0,
      );
      if (systemID > 0) {
        counts.set(systemID, (counts.get(systemID) || 0) + 1);
      }
    }
  } catch (_err) { /* best-effort */ }
  return counts;
}

function resolveSystemInfo(systemID) {
  try {
    const row = worldData.getSolarSystemByID(systemID);
    if (!row) return null;
    return {
      name: row.solarSystemName ? String(row.solarSystemName) : null,
      security: Number.isFinite(Number(row.security)) ? Number(row.security) : null,
      securityClass: row.securityClass ? String(row.securityClass) : null,
      constellationID: Number(row.constellationID) || null,
      regionID: Number(row.regionID) || null,
      factionID: Number(row.factionID) || null,
      sunTypeID: Number(row.sunTypeID) || null,
    };
  } catch (_err) { /* worldData may fail to load in exotic envs */ }
  return null;
}

function collectSystemSnapshot() {
  const scenes = [];
  if (!spaceRuntime || !spaceRuntime.scenes) {
    return scenes;
  }
  const nowWall = Date.now();
  const sessionCounts = getSessionCountByScene();

  for (const [systemID, scene] of spaceRuntime.scenes.entries()) {
    if (!scene) continue;
    const factor = typeof scene.getTimeDilation === "function"
      ? scene.getTimeDilation()
      : Number(scene.timeDilation) || 1.0;
    const lastTickAt = Number(scene.lastWallclockTickAt) || 0;
    const msSinceLastTick = lastTickAt > 0 ? nowWall - lastTickAt : null;
    const override = tidiAutoscaler.getManualOverride
      ? tidiAutoscaler.getManualOverride(systemID)
      : null;
    const tickWorkHistory = Array.isArray(scene._recentTickWorkMs)
      ? scene._recentTickWorkMs.slice(-120)
      : [];
    const factorHistory = Array.isArray(scene._recentFactors)
      ? scene._recentFactors.slice(-120)
      : [];
    const info = resolveSystemInfo(systemID) || {};
    scenes.push({
      systemID: Number(systemID) || 0,
      systemName: info.name || null,
      security: info.security ?? null,
      securityClass: info.securityClass || null,
      constellationID: info.constellationID || null,
      constellationName: getConstellationName(info.constellationID),
      regionID: info.regionID || null,
      regionName: getRegionName(info.regionID),
      factionID: info.factionID || null,
      sunTypeID: info.sunTypeID || null,
      factor,
      lastWallclockTickAt: lastTickAt || null,
      msSinceLastTick,
      simTimeMs: Number(scene.simTimeMs) || null,
      sessionCount: sessionCounts.get(Number(systemID)) || 0,
      manualOverride: override ? { factor: override.factor } : null,
      lastTickWorkMs: Number(scene._lastTickWorkMs) || 0,
      tickWorkHistory,
      factorHistory,
    });
  }
  scenes.sort((a, b) => {
    const an = a.systemName || String(a.systemID);
    const bn = b.systemName || String(b.systemID);
    return an.localeCompare(bn);
  });
  return scenes;
}

function buildTickMetrics() {
  const summary = spaceRuntime && spaceRuntime._lastTickSummary
    ? spaceRuntime._lastTickSummary
    : null;
  const history = Array.isArray(spaceRuntime && spaceRuntime._recentTickSummaries)
    ? spaceRuntime._recentTickSummaries.slice(-120)
    : [];
  return {
    targetTickIntervalMs: summary ? summary.targetTickIntervalMs : 100,
    actualIntervalMs: summary ? summary.actualIntervalMs : null,
    tickDurationMs: summary ? summary.tickDurationMs : null,
    latenessMs: summary
      ? Math.max(0, (summary.actualIntervalMs || 0) - (summary.targetTickIntervalMs || 0))
      : null,
    sceneCount: summary ? summary.sceneCount : 0,
    tickedSceneCount: summary ? summary.tickedSceneCount : 0,
    history: history.map((h) => ({
      actualIntervalMs: h.actualIntervalMs,
      targetTickIntervalMs: h.targetTickIntervalMs,
      tickDurationMs: h.tickDurationMs,
      latenessMs: Math.max(0, (h.actualIntervalMs || 0) - (h.targetTickIntervalMs || 0)),
      tickedSceneCount: h.tickedSceneCount,
    })),
  };
}

function buildStatusPayload() {
  const enabledState = tidiAutoscaler.getEnabledState
    ? tidiAutoscaler.getEnabledState()
    : { configEnabled: true, runtimeOverride: null, effectivelyEnabled: true };
  const currentFactor = tidiAutoscaler.getCurrentFactor
    ? tidiAutoscaler.getCurrentFactor()
    : 1.0;
  const transition = tidiAutoscaler.getTransitionLockState
    ? tidiAutoscaler.getTransitionLockState()
    : null;
  const overrides = tidiAutoscaler.listManualOverrides
    ? tidiAutoscaler.listManualOverrides()
    : [];
  return {
    serverTime: Date.now(),
    autoscaler: {
      ...enabledState,
      currentFactor,
      transitionLock: transition,
      manualOverrides: overrides,
    },
    tick: buildTickMetrics(),
    systems: collectSystemSnapshot(),
  };
}

function resolveTargetSystemIDs(scope, systemID) {
  if (scope === "all") {
    if (!spaceRuntime || !spaceRuntime.scenes) return [];
    return [...spaceRuntime.scenes.keys()]
      .map((id) => Number(id) || 0)
      .filter((id) => id > 0);
  }
  const id = Number(systemID) || 0;
  return id > 0 ? [id] : [];
}

function applyOverride(scope, systemID, factor) {
  const targets = resolveTargetSystemIDs(scope, systemID);
  if (targets.length === 0) {
    return { ok: false, error: "no matching systems" };
  }

  const autoscalerOn = tidiAutoscaler.isEffectivelyEnabled
    ? tidiAutoscaler.isEffectivelyEnabled()
    : false;

  if (factor === null) {
    if (autoscalerOn && tidiAutoscaler.clearManualOverride) {
      for (const id of targets) {
        tidiAutoscaler.clearManualOverride(id);
      }
      return { ok: true, action: "cleared-override", targets };
    }
    scheduleSynchronizedTimeDilationForSystems(targets, 1.0);
    return { ok: true, action: "reset-to-1.0", targets };
  }

  const clamped = clampFactor(factor);
  if (clamped === null) {
    return { ok: false, error: "invalid factor" };
  }
  if (autoscalerOn && tidiAutoscaler.setManualOverride) {
    for (const id of targets) {
      tidiAutoscaler.setManualOverride(id, clamped);
    }
  }
  scheduleSynchronizedTimeDilationForSystems(targets, clamped);
  return { ok: true, action: "set-factor", factor: clamped, targets };
}

function handleRequest(req, res) {
  if (req.method === "OPTIONS") {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const url = String(req.url || "/");
  const route = url.split("?")[0];

  if (req.method === "GET" && (route === "/" || route === "/api/status")) {
    sendJson(res, 200, buildStatusPayload());
    return;
  }

  if (req.method === "POST" && route === "/api/autoscaler") {
    readJsonBody(req)
      .then((body) => {
        const raw = body && body.enabled;
        let next;
        if (raw === null || raw === undefined) {
          next = null;
        } else if (raw === true || raw === "true") {
          next = true;
        } else if (raw === false || raw === "false") {
          next = false;
        } else {
          sendJson(res, 400, { ok: false, error: "enabled must be true|false|null" });
          return;
        }
        const result = tidiAutoscaler.setRuntimeEnabled(next);
        sendJson(res, 200, { ok: true, autoscaler: result });
      })
      .catch((err) => sendJson(res, 400, { ok: false, error: err.message }));
    return;
  }

  if (req.method === "POST" && route === "/api/override") {
    readJsonBody(req)
      .then((body) => {
        const scope = body && body.scope === "all" ? "all" : "system";
        const systemID = body && body.systemID;
        const factor = body && (body.factor === null ? null : body.factor);
        if (factor !== null && (typeof factor !== "number" || !Number.isFinite(factor))) {
          sendJson(res, 400, { ok: false, error: "factor must be number or null" });
          return;
        }
        const result = applyOverride(scope, systemID, factor);
        sendJson(res, result.ok ? 200 : 400, result);
      })
      .catch((err) => sendJson(res, 400, { ok: false, error: err.message }));
    return;
  }

  setCors(res);
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not found" }));
}

function startRedshiftMonitor() {
  const port = Number(config.redshiftMonitorPort) || DEFAULT_PORT;
  const host = String(config.redshiftMonitorHost || DEFAULT_HOST);
  const server = http.createServer(handleRequest);
  server.on("error", (err) => {
    log.err(`[Redshift] monitor listen error: ${err.message}`);
  });
  server.listen(port, host, () => {
    log.debug(`Redshift monitor listening on http://${host}:${port}`);
  });
}

module.exports = {
  enabled: true,
  serviceName: "redshiftMonitor",
  exec() {
    startRedshiftMonitor();
  },
  __testing: {
    buildStatusPayload,
    applyOverride,
    collectSystemSnapshot,
  },
};
