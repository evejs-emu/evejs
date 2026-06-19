const path = require("path");

const {
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildMarshalRealVectorList,
  buildMarshalReal,
  currentFileTime,
  normalizeBigInt,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../../_shared/serviceHelpers"));
const explorationAuthority = require(path.join(
  __dirname,
  "../explorationAuthority",
));
const signatureRuntime = require(path.join(
  __dirname,
  "../signatures/signatureRuntime",
));
const probeRuntimeState = require(path.join(__dirname, "./probeRuntimeState"));

const PROBE_SCAN_GROUP_SIGNATURES =
  Number(
    explorationAuthority.getScanContracts().probeScanGroups &&
    explorationAuthority.getScanContracts().probeScanGroups.signatures,
  ) || 3;
const GROUP_COSMIC_SIGNATURE =
  Number(
    explorationAuthority.getSignatureTypeDefinition("wormhole") &&
    explorationAuthority.getSignatureTypeDefinition("wormhole").inventoryGroupID,
  ) || 502;
const ATTRIBUTE_SCAN_WORMHOLE_STRENGTH =
  explorationAuthority.getScanStrengthAttribute("wormhole") || 1908;
const DEFAULT_PROBE_SCAN_DURATION_MS = 8_000;
const DEFAULT_PROBE_EXPIRY_SECONDS = 60 * 60;
const PROBE_RESULT_PERFECT = 1;
const PROBE_RESULT_UNUSABLE = 0.001;
const PROBE_SCAN_BONUS_ORIGINS = Object.freeze([
  "modules",
  "ship",
  "skills",
  "implants",
  "boosters",
]);
const PROBE_SCAN_BONUS_IDS = Object.freeze([
  "strength",
  "deviation",
  "duration",
]);

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function clonePosition(value, fallback = [0, 0, 0]) {
  const unwrappedValue =
    value &&
    typeof value === "object" &&
    (value.type || value.name || value.header)
      ? unwrapMarshalValue(value)
      : value;

  if (Array.isArray(unwrappedValue)) {
    return probeRuntimeState.clampVectorToProbeBounds([
      toFiniteNumber(unwrappedValue[0], fallback[0]),
      toFiniteNumber(unwrappedValue[1], fallback[1]),
      toFiniteNumber(unwrappedValue[2], fallback[2]),
    ]);
  }

  if (unwrappedValue && typeof unwrappedValue === "object") {
    return probeRuntimeState.clampVectorToProbeBounds([
      toFiniteNumber(unwrappedValue.x, fallback[0]),
      toFiniteNumber(unwrappedValue.y, fallback[1]),
      toFiniteNumber(unwrappedValue.z, fallback[2]),
    ]);
  }

  if (Array.isArray(value)) {
    return probeRuntimeState.clampVectorToProbeBounds([
      toFiniteNumber(value[0], fallback[0]),
      toFiniteNumber(value[1], fallback[1]),
      toFiniteNumber(value[2], fallback[2]),
    ]);
  }

  if (value && typeof value === "object") {
    return probeRuntimeState.clampVectorToProbeBounds([
      toFiniteNumber(value.x, fallback[0]),
      toFiniteNumber(value.y, fallback[1]),
      toFiniteNumber(value.z, fallback[2]),
    ]);
  }

  return [...fallback];
}

function normalizeScanBonuses(value) {
  const rawBonuses =
    value && typeof value === "object" && (value.type || value.name || value.header)
      ? unwrapMarshalValue(value)
      : value;
  const scanBonuses = {};

  for (const bonusID of PROBE_SCAN_BONUS_IDS) {
    const rawOrigins =
      rawBonuses &&
      typeof rawBonuses === "object" &&
      rawBonuses[bonusID] &&
      typeof rawBonuses[bonusID] === "object"
        ? rawBonuses[bonusID]
        : {};
    scanBonuses[bonusID] = Object.fromEntries(
      PROBE_SCAN_BONUS_ORIGINS.map((originID) => [
        originID,
        toFiniteNumber(rawOrigins[originID], 0),
      ]),
    );
  }

  return scanBonuses;
}

function buildScanBonusesDict(scanBonuses = {}) {
  return buildDict(
    PROBE_SCAN_BONUS_IDS.map((bonusID) => [
      bonusID,
      buildDict(
        PROBE_SCAN_BONUS_ORIGINS.map((originID) => [
          originID,
          buildMarshalReal(
            toFiniteNumber(
              scanBonuses &&
                scanBonuses[bonusID] &&
                scanBonuses[bonusID][originID],
              0,
            ),
            0,
          ),
        ]),
      ),
    ]),
  );
}

function extractProbeEntries(rawProbes) {
  if (!rawProbes) {
    return [];
  }

  if (
    rawProbes &&
    typeof rawProbes === "object" &&
    rawProbes.type === "dict" &&
    Array.isArray(rawProbes.entries)
  ) {
    return rawProbes.entries;
  }

  if (rawProbes instanceof Map) {
    return [...rawProbes.entries()];
  }

  if (typeof rawProbes === "object") {
    return Object.entries(rawProbes);
  }

  return [];
}

function normalizeProbeRecord(rawProbeID, rawProbe = {}) {
  const normalizedProbe =
    rawProbe && typeof rawProbe === "object" && (rawProbe.type || rawProbe.name || rawProbe.header)
      ? unwrapMarshalValue(rawProbe)
      : rawProbe;
  const probeID = toInt(
    rawProbeID,
    toInt(normalizedProbe && normalizedProbe.probeID, 0),
  );
  if (probeID <= 0) {
    return null;
  }

  const initialPosition = clonePosition(
    normalizedProbe && (normalizedProbe.pos || normalizedProbe.position),
  );
  const destination = clonePosition(
    normalizedProbe && normalizedProbe.destination,
    initialPosition,
  );
  // CCP's probe scan start payload reflects the probe positions that are about
  // to be used for the scan, not the stale pre-drag launch coordinates. When
  // we echo the stale launch coordinates back here, the client snaps the probe
  // formation back toward the origin and computes coverage from the wrong
  // place. Use the effective destination as the scan-time position.
  const pos = clonePosition(destination, initialPosition);
  const typeID = toInt(normalizedProbe && normalizedProbe.typeID, 0);
  const resolvedRange = probeRuntimeState.resolveProbeRangeContract(
    typeID,
    normalizedProbe && normalizedProbe.rangeStep,
    normalizedProbe && normalizedProbe.scanRange,
  );
  const state = toInt(normalizedProbe && normalizedProbe.state, 1);
  const expiry =
    normalizedProbe && Object.prototype.hasOwnProperty.call(normalizedProbe, "expiry")
      ? normalizeBigInt(normalizedProbe.expiry, 0n).toString()
      : (
        currentFileTime() +
        (BigInt(DEFAULT_PROBE_EXPIRY_SECONDS) * 10_000_000n)
      ).toString();
  const scanBonuses = normalizeScanBonuses(
    normalizedProbe && normalizedProbe.scanBonuses,
  );

  return {
    probeID,
    typeID,
    pos,
    destination,
    scanRange: resolvedRange.scanRange,
    rangeStep: resolvedRange.rangeStep,
    state,
    expiry,
    scanBonuses,
  };
}

function normalizeProbeMap(rawProbes) {
  return new Map(
    extractProbeEntries(rawProbes)
      .map(([probeID, probe]) => normalizeProbeRecord(probeID, probe))
      .filter(Boolean)
      .filter((probe) => probe.state > 0)
      .sort((left, right) => left.probeID - right.probeID)
      .slice(0, 8)
      .map((probe) => [probe.probeID, probe]),
  );
}

function normalizeProbePatchMap(rawProbes) {
  return new Map(
    extractProbeEntries(rawProbes)
      .map(([rawProbeID, rawProbe]) => {
        const normalizedProbe =
          rawProbe &&
          typeof rawProbe === "object" &&
          (rawProbe.type || rawProbe.name || rawProbe.header)
            ? unwrapMarshalValue(rawProbe)
            : rawProbe;
        const probeID = toInt(
          rawProbeID,
          toInt(normalizedProbe && normalizedProbe.probeID, 0),
        );
        if (probeID <= 0) {
          return null;
        }
        return [
          probeID,
          {
            typeID: toInt(normalizedProbe && normalizedProbe.typeID, 0),
            ...(() => {
              const resolvedRange = probeRuntimeState.resolveProbeRangeContract(
                toInt(normalizedProbe && normalizedProbe.typeID, 0),
                normalizedProbe && normalizedProbe.rangeStep,
                normalizedProbe && normalizedProbe.scanRange,
              );
              return {
                destination: clonePosition(
                  normalizedProbe && normalizedProbe.destination,
                  clonePosition(normalizedProbe && (normalizedProbe.pos || normalizedProbe.position)),
                ),
                scanRange: resolvedRange.scanRange,
                rangeStep: resolvedRange.rangeStep,
                state: toInt(normalizedProbe && normalizedProbe.state, 1),
              };
            })(),
          },
        ];
      })
      .filter(Boolean),
  );
}

function buildProbeDict(probeMap) {
  return buildDict(
    [...probeMap.values()].map((probe) => [
      probe.probeID,
      buildProbeKeyVal(probe),
    ]),
  );
}

function buildProbeKeyVal(probe = {}) {
  return buildKeyVal([
    ["probeID", toInt(probe.probeID, 0)],
    ["typeID", toInt(probe.typeID, 0) > 0 ? toInt(probe.typeID, 0) : null],
    ["pos", buildMarshalRealVectorList(clonePosition(probe.pos))],
    ["destination", buildMarshalRealVectorList(clonePosition(probe.destination, probe.pos))],
    ["scanRange", Math.max(0, toFiniteNumber(probe.scanRange, 0))],
    ["rangeStep", Math.max(1, toInt(probe.rangeStep, 1))],
    ["state", toInt(probe.state, 1)],
    ["scanBonuses", buildScanBonusesDict(normalizeScanBonuses(probe.scanBonuses))],
    ["expiry", buildFiletimeLong(probe.expiry)],
  ]);
}

function distanceBetween(left, right) {
  const dx = toFiniteNumber(left && left[0], 0) - toFiniteNumber(right && right[0], 0);
  const dy = toFiniteNumber(left && left[1], 0) - toFiniteNumber(right && right[1], 0);
  const dz = toFiniteNumber(left && left[2], 0) - toFiniteNumber(right && right[2], 0);
  return Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
}

function lerpPosition(fromPosition, toPosition, ratio) {
  const clampedRatio = Math.max(0, Math.min(1, toFiniteNumber(ratio, 0)));
  const fromVector = clonePosition(fromPosition);
  const toVector = clonePosition(toPosition, fromVector);
  return [
    fromVector[0] + ((toVector[0] - fromVector[0]) * clampedRatio),
    fromVector[1] + ((toVector[1] - fromVector[1]) * clampedRatio),
    fromVector[2] + ((toVector[2] - fromVector[2]) * clampedRatio),
  ];
}

function scoreProbeCoverage(site, probe) {
  const actualPosition = [
    toFiniteNumber(site && site.actualPosition && site.actualPosition.x, 0),
    toFiniteNumber(site && site.actualPosition && site.actualPosition.y, 0),
    toFiniteNumber(site && site.actualPosition && site.actualPosition.z, 0),
  ];
  const probeRange = Math.max(0, toFiniteNumber(probe && probe.scanRange, 0));
  if (probeRange <= 0) {
    return 0;
  }
  const effectiveProbePosition = clonePosition(
    probe && (probe.destination || probe.pos),
    clonePosition(probe && probe.pos),
  );
  const distance = distanceBetween(actualPosition, effectiveProbePosition);
  if (distance > probeRange) {
    return 0;
  }
  return Math.max(0, 1 - (distance / probeRange));
}

function resolveCertainty(coverageScores = []) {
  const scores = [...coverageScores]
    .filter((score) => Number.isFinite(score) && score > 0)
    .sort((left, right) => right - left);
  if (scores.length <= 0) {
    return 0;
  }
  if (scores.length === 1) {
    return Math.min(0.24, 0.08 + (scores[0] * 0.16));
  }
  if (scores.length === 2) {
    return Math.min(0.49, 0.22 + (scores[0] * 0.18) + (scores[1] * 0.09));
  }
  if (scores.length === 3) {
    return Math.min(0.99, 0.52 + (scores[0] * 0.22) + (scores[1] * 0.12) + (scores[2] * 0.08));
  }
  return 1;
}

function buildResultPosition(site, certainty) {
  const actualPosition = [
    toFiniteNumber(site && site.actualPosition && site.actualPosition.x, 0),
    toFiniteNumber(site && site.actualPosition && site.actualPosition.y, 0),
    toFiniteNumber(site && site.actualPosition && site.actualPosition.z, 0),
  ];
  if (toFiniteNumber(certainty, 0) >= PROBE_RESULT_PERFECT) {
    return actualPosition;
  }

  const hintedPosition = clonePosition(site && site.position, actualPosition);
  const blendRatio = Math.max(
    0,
    Math.min(1, (toFiniteNumber(certainty, 0) - PROBE_RESULT_UNUSABLE) / (PROBE_RESULT_PERFECT - PROBE_RESULT_UNUSABLE)),
  );
  return lerpPosition(hintedPosition, actualPosition, blendRatio);
}

function buildResultDeviation(site, certainty, resolvedPosition) {
  const actualPosition = [
    toFiniteNumber(site && site.actualPosition && site.actualPosition.x, 0),
    toFiniteNumber(site && site.actualPosition && site.actualPosition.y, 0),
    toFiniteNumber(site && site.actualPosition && site.actualPosition.z, 0),
  ];
  if (toFiniteNumber(certainty, 0) >= PROBE_RESULT_PERFECT) {
    return 0;
  }

  const siteDeviation = Math.max(
    1,
    toFiniteNumber(site && site.deviation, 1),
  );
  return Math.max(
    1,
    Math.min(
      siteDeviation,
      distanceBetween(actualPosition, resolvedPosition),
    ),
  );
}

function resolveResultID(site) {
  const targetID = String(site && site.targetID || "").trim().toUpperCase();
  if (targetID) {
    return targetID;
  }
  return toInt(site && site.siteID, 0);
}

function buildScanResultEntry(site, certainty) {
  const actualPosition = [
    toFiniteNumber(site && site.actualPosition && site.actualPosition.x, 0),
    toFiniteNumber(site && site.actualPosition && site.actualPosition.y, 0),
    toFiniteNumber(site && site.actualPosition && site.actualPosition.z, 0),
  ];
  const resolvedPosition = buildResultPosition(site, certainty);
  const deviationMeters = buildResultDeviation(site, certainty, resolvedPosition);
  const isPerfect = toFiniteNumber(certainty, 0) >= PROBE_RESULT_PERFECT;
  return buildKeyVal([
    ["id", resolveResultID(site)],
    ["scanGroupID", toInt(site && site.scanGroupID, PROBE_SCAN_GROUP_SIGNATURES)],
    ["groupID", toInt(site && site.groupID, GROUP_COSMIC_SIGNATURE)],
    ["typeID", site && site.typeID == null ? null : toInt(site && site.typeID, 0)],
    ["strengthAttributeID", toInt(site && site.strengthAttributeID, ATTRIBUTE_SCAN_WORMHOLE_STRENGTH)],
    ["dungeonID", site && site.dungeonID == null ? null : site.dungeonID],
    ["dungeonNameID", site && site.dungeonNameID == null ? null : site.dungeonNameID],
    ["archetypeID", site && site.archetypeID == null ? null : site.archetypeID],
    ["factionID", site && site.factionID == null ? null : site.factionID],
    ["itemID", site && site.itemID == null ? null : site.itemID],
    ["difficulty", Math.max(1, toInt(site && site.difficulty, 1))],
    ["certainty", Math.max(0, Math.min(1, toFiniteNumber(certainty, 0)))],
    [
      "data",
      isPerfect
        ? buildMarshalRealVectorList(actualPosition)
        : buildMarshalReal(deviationMeters, deviationMeters),
    ],
    [
      "pos",
      buildMarshalRealVectorList(isPerfect ? actualPosition : resolvedPosition),
    ],
  ]);
}

function buildResolvedSignatureScanResults(systemID, options = {}) {
  const sites = signatureRuntime.listSystemSignatureSites(systemID, options);
  return {
    durationMs: Math.max(
      1,
      toInt(options.durationMs, DEFAULT_PROBE_SCAN_DURATION_MS),
    ),
    probes: new Map(),
    probeIDs: [],
    results: sites.map((site) => buildScanResultEntry(site, 1)),
    absentTargets: [],
  };
}

function buildSignatureScanResults(systemID, rawProbes, options = {}) {
  const probeMap = normalizeProbeMap(rawProbes);
  const sites = signatureRuntime.listSystemSignatureSites(systemID, options);
  const results = [];
  const absentTargets = [];

  for (const site of sites) {
    const coverageScores = [...probeMap.values()]
      .map((probe) => scoreProbeCoverage(site, probe))
      .filter((score) => score > 0);
    const certainty = resolveCertainty(coverageScores);
    if (certainty <= 0) {
      absentTargets.push(resolveResultID(site));
      continue;
    }
    results.push(buildScanResultEntry(site, certainty));
  }

  return {
    durationMs: Math.max(
      1,
      toInt(options.durationMs, DEFAULT_PROBE_SCAN_DURATION_MS),
    ),
    probes: probeMap,
    probeIDs: [...probeMap.keys()],
    results,
    absentTargets,
  };
}

module.exports = {
  ATTRIBUTE_SCAN_WORMHOLE_STRENGTH,
  DEFAULT_PROBE_SCAN_DURATION_MS,
  DEFAULT_PROBE_EXPIRY_SECONDS,
  GROUP_COSMIC_SIGNATURE,
  PROBE_SCAN_GROUP_SIGNATURES,
  buildProbeDict,
  buildProbeKeyVal,
  buildResolvedSignatureScanResults,
  buildScanResultEntry,
  buildSignatureScanResults,
  normalizeProbeMap,
  normalizeProbePatchMap,
  resolveResultID,
};
