const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatInteger(value) {
  return Math.max(0, toInt(value, 0)).toLocaleString("en-GB");
}

function formatSecurityStatus(value) {
  const numeric = toFiniteNumber(value, null);
  if (numeric === null) {
    return null;
  }
  return numeric.toFixed(3);
}

function formatMiningStartupMessage(systemID, payload) {
  const locationParts = [`system=${toInt(systemID, 0)}`];
  if (payload.securityBand) {
    locationParts.push(payload.securityBand);
  }
  if (payload.securityClass) {
    locationParts.push(`class ${payload.securityClass}`);
  }
  if (payload.securityStatus !== null) {
    locationParts.push(`sec ${formatSecurityStatus(payload.securityStatus)}`);
  }

  const siteParts = [];
  if (payload.beltCount > 0 || payload.asteroidCount > 0) {
    siteParts.push(
      `belts ${formatInteger(payload.beltCount)}`,
      `asteroids ${formatInteger(payload.asteroidCount)}`,
      `ore types ${formatInteger(payload.orePoolTypeCount)}/${formatInteger(payload.beltSubsetTypeCount)}`,
    );
  }
  if (payload.iceSiteCount > 0 || payload.iceChunkCount > 0) {
    siteParts.push(
      `ice sites ${formatInteger(payload.iceSiteCount)} (${formatInteger(payload.iceChunkCount)} chunks)`,
    );
  }
  if (payload.gasSiteCount > 0 || payload.gasCloudCount > 0) {
    siteParts.push(
      `gas sites ${formatInteger(payload.gasSiteCount)} (${formatInteger(payload.gasCloudCount)} clouds)`,
    );
  }

  const presentationParts = [];
  if (payload.updatedCount > 0) {
    presentationParts.push(`updated ${formatInteger(payload.updatedCount)}`);
  }
  if (payload.oreCount > 0 || payload.oreRemainingQuantity > 0) {
    presentationParts.push(
      `ore ${formatInteger(payload.oreCount)} (${formatInteger(payload.oreRemainingQuantity)})`,
    );
  }
  if (payload.iceCount > 0 || payload.iceRemainingQuantity > 0) {
    presentationParts.push(
      `ice ${formatInteger(payload.iceCount)} (${formatInteger(payload.iceRemainingQuantity)})`,
    );
  }
  if (payload.gasCount > 0 || payload.gasRemainingQuantity > 0) {
    presentationParts.push(
      `gas ${formatInteger(payload.gasCount)} (${formatInteger(payload.gasRemainingQuantity)})`,
    );
  }
  if (payload.otherCount > 0 || payload.otherRemainingQuantity > 0) {
    presentationParts.push(
      `other ${formatInteger(payload.otherCount)} (${formatInteger(payload.otherRemainingQuantity)})`,
    );
  }
  presentationParts.push(`graphics ${formatInteger(payload.withGraphicCount)}`);

  return [
    `[MiningInit] ${locationParts.join(" ")}`,
    siteParts.join(", "),
    presentationParts.join(", "),
  ]
    .filter(Boolean)
    .join(" | ");
}

function ensureMiningStartupSummary(scene) {
  if (!scene || typeof scene !== "object") {
    return null;
  }

  if (scene._miningStartupSummary && typeof scene._miningStartupSummary === "object") {
    return scene._miningStartupSummary;
  }

  scene._miningStartupSummary = {
    systemID: toInt(scene.systemID, 0),
    securityBand: null,
    securityClass: null,
    securityStatus: null,
    beltIDs: new Set(),
    asteroidCount: 0,
    orePoolTypeIDs: new Set(),
    beltSubsetTypeIDs: new Set(),
    iceSiteKeys: new Set(),
    gasSiteKeys: new Set(),
    iceChunkCount: 0,
    gasCloudCount: 0,
    presentation: {
      updatedCount: 0,
      oreCount: 0,
      iceCount: 0,
      gasCount: 0,
      otherCount: 0,
      oreRemainingQuantity: 0,
      iceRemainingQuantity: 0,
      gasRemainingQuantity: 0,
      otherRemainingQuantity: 0,
      withGraphicCount: 0,
    },
  };
  return scene._miningStartupSummary;
}

function addTypeIDs(targetSet, entries) {
  if (!(targetSet instanceof Set) || !Array.isArray(entries)) {
    return;
  }

  for (const entry of entries) {
    const typeID = toInt(entry && entry.typeID, 0);
    if (typeID > 0) {
      targetSet.add(typeID);
    }
  }
}

function recordAsteroidBootstrap(scene, payload = {}) {
  const summary = ensureMiningStartupSummary(scene);
  if (!summary) {
    return;
  }

  const beltID = toInt(payload.beltID, 0);
  if (beltID > 0) {
    summary.beltIDs.add(beltID);
  }

  summary.asteroidCount += Math.max(0, toInt(payload.spawnedCount, 0));
  addTypeIDs(summary.orePoolTypeIDs, payload.orePool);
  addTypeIDs(summary.beltSubsetTypeIDs, payload.beltSubset);

  const securityClass = String(payload.securityClass || "").trim().toUpperCase();
  if (securityClass) {
    summary.securityClass = securityClass;
  }

  const securityStatus = toFiniteNumber(payload.securityStatus, null);
  if (securityStatus !== null) {
    summary.securityStatus = securityStatus;
  }
}

function recordGeneratedSiteBootstrap(scene, payload = {}) {
  const summary = ensureMiningStartupSummary(scene);
  if (!summary) {
    return;
  }

  const kind = String(payload.kind || "").trim().toLowerCase();
  const siteIndex = toInt(payload.siteIndex, -1);
  const siteKey = `${kind}:${siteIndex}`;
  const securityBand = String(payload.securityBand || "").trim().toLowerCase();
  if (securityBand) {
    summary.securityBand = securityBand;
  }

  if (kind === "gas") {
    if (!summary.gasSiteKeys.has(siteKey)) {
      summary.gasSiteKeys.add(siteKey);
      summary.gasCloudCount += Math.max(0, toInt(payload.mineableCount, 0));
    }
    return;
  }

  if (!summary.iceSiteKeys.has(siteKey)) {
    summary.iceSiteKeys.add(siteKey);
    summary.iceChunkCount += Math.max(0, toInt(payload.mineableCount, 0));
  }
}

function mergeMiningPresentationSummary(scene, presentation = {}) {
  const summary = ensureMiningStartupSummary(scene);
  if (!summary) {
    return;
  }

  summary.presentation = {
    updatedCount: Math.max(0, toInt(presentation.updatedCount, 0)),
    oreCount: Math.max(0, toInt(presentation.oreCount, 0)),
    iceCount: Math.max(0, toInt(presentation.iceCount, 0)),
    gasCount: Math.max(0, toInt(presentation.gasCount, 0)),
    otherCount: Math.max(0, toInt(presentation.otherCount, 0)),
    oreRemainingQuantity: Math.max(0, toInt(presentation.oreRemainingQuantity, 0)),
    iceRemainingQuantity: Math.max(0, toInt(presentation.iceRemainingQuantity, 0)),
    gasRemainingQuantity: Math.max(0, toInt(presentation.gasRemainingQuantity, 0)),
    otherRemainingQuantity: Math.max(0, toInt(presentation.otherRemainingQuantity, 0)),
    withGraphicCount: Math.max(0, toInt(presentation.withGraphicCount, 0)),
  };
}

function flushMiningStartupSummary(scene) {
  const summary = ensureMiningStartupSummary(scene);
  if (!summary || scene._miningStartupSummaryFlushed === true) {
    return null;
  }

  const payload = {
    securityBand: summary.securityBand || null,
    securityClass: summary.securityClass || null,
    securityStatus: summary.securityStatus,
    beltCount: summary.beltIDs.size,
    asteroidCount: summary.asteroidCount,
    orePoolTypeCount: summary.orePoolTypeIDs.size,
    beltSubsetTypeCount: summary.beltSubsetTypeIDs.size,
    iceSiteCount: summary.iceSiteKeys.size,
    gasSiteCount: summary.gasSiteKeys.size,
    iceChunkCount: summary.iceChunkCount,
    gasCloudCount: summary.gasCloudCount,
    updatedCount: summary.presentation.updatedCount,
    oreCount: summary.presentation.oreCount,
    iceCount: summary.presentation.iceCount,
    gasCount: summary.presentation.gasCount,
    otherCount: summary.presentation.otherCount,
    oreRemainingQuantity: summary.presentation.oreRemainingQuantity,
    iceRemainingQuantity: summary.presentation.iceRemainingQuantity,
    gasRemainingQuantity: summary.presentation.gasRemainingQuantity,
    otherRemainingQuantity: summary.presentation.otherRemainingQuantity,
    withGraphicCount: summary.presentation.withGraphicCount,
  };

  const hasData =
    payload.beltCount > 0 ||
    payload.iceSiteCount > 0 ||
    payload.gasSiteCount > 0 ||
    payload.updatedCount > 0;
  if (!hasData) {
    return null;
  }

  log.info(formatMiningStartupMessage(summary.systemID, payload));
  scene._miningStartupSummaryFlushed = true;
  return payload;
}

function resetMiningStartupSummary(scene) {
  if (!scene || typeof scene !== "object") {
    return;
  }

  delete scene._miningStartupSummary;
  delete scene._miningStartupSummaryFlushed;
}

module.exports = {
  ensureMiningStartupSummary,
  flushMiningStartupSummary,
  mergeMiningPresentationSummary,
  recordAsteroidBootstrap,
  recordGeneratedSiteBootstrap,
  resetMiningStartupSummary,
};
