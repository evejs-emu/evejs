const path = require("path");
const crypto = require("crypto");

const explorationAuthority = require(path.join(
  __dirname,
  "../../explorationAuthority",
));
const targetIdRuntime = require(path.join(
  __dirname,
  "../targetIdRuntime",
));
const {
  getStateSnapshot,
} = require("../../wormholes/wormholeRuntimeState");

const AU_METERS =
  Number(explorationAuthority.getScanContracts().auMeters) || 149_597_870_700;
const DEFAULT_SIGNATURE_DEVIATION_METERS = 4 * AU_METERS;
const ATTRIBUTE_SCAN_WORMHOLE_STRENGTH =
  explorationAuthority.getScanStrengthAttribute("wormhole") || 1908;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(vector = null) {
  return {
    x: toFiniteNumber(vector && vector.x, 0),
    y: toFiniteNumber(vector && vector.y, 0),
    z: toFiniteNumber(vector && vector.z, 0),
  };
}

function hashSeed(seed) {
  const digest = crypto.createHash("sha1").update(String(seed || "")).digest();
  return digest.readUInt32LE(0);
}

function normalizeVisibilityState(value, discovered = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "visible" ||
    normalized === "hidden" ||
    normalized === "invisible"
  ) {
    return normalized;
  }
  return discovered === true ? "visible" : "hidden";
}

function isEndpointSignatureVisible(endpoint = {}) {
  const visibilityState = normalizeVisibilityState(
    endpoint.visibilityState,
    endpoint.discovered === true,
  );
  return visibilityState === "visible";
}

function buildSignaturePosition(position, signatureCode) {
  const basePosition = cloneVector(position);
  const yawSeed = hashSeed(`${signatureCode}:yaw`);
  const pitchSeed = hashSeed(`${signatureCode}:pitch`);
  const magnitudeSeed = hashSeed(`${signatureCode}:magnitude`);
  const yaw = (yawSeed / 0xffffffff) * Math.PI * 2;
  const pitch = ((pitchSeed / 0xffffffff) - 0.5) * (Math.PI / 2);
  const distance =
    DEFAULT_SIGNATURE_DEVIATION_METERS *
    (0.35 + ((magnitudeSeed / 0xffffffff) * 0.65));

  const direction = {
    x: Math.cos(pitch) * Math.cos(yaw),
    y: Math.sin(pitch),
    z: Math.cos(pitch) * Math.sin(yaw),
  };

  return [
    basePosition.x + (direction.x * distance),
    basePosition.y + (direction.y * distance),
    basePosition.z + (direction.z * distance),
  ];
}

function listWormholeSignatureCandidates(systemID, options = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const numericSystemID = toInt(systemID, 0);
  if (numericSystemID <= 0) {
    return [];
  }

  const snapshot = getStateSnapshot();
  return Object.values(snapshot.pairsByID || {})
    .filter(
      (pair) =>
        String(pair && pair.state || "").trim().toLowerCase() === "active" &&
        Math.max(0, toInt(pair && pair.expiresAtMs, 0)) >= nowMs,
    )
    .flatMap((pair) => ([
      {
        pairID: toInt(pair && pair.pairID, 0),
        pairKind: String(pair && pair.kind || "").trim().toLowerCase() || "static",
        endpoint: pair && pair.source,
      },
      {
        pairID: toInt(pair && pair.pairID, 0),
        pairKind: String(pair && pair.kind || "").trim().toLowerCase() || "static",
        endpoint: pair && pair.destination,
      },
    ]))
    .filter(
      (entry) =>
        toInt(entry && entry.endpoint && entry.endpoint.systemID, 0) === numericSystemID &&
        isEndpointSignatureVisible(entry && entry.endpoint),
    )
    .map((entry) => ({
      pairID: entry.pairID,
      pairKind: entry.pairKind,
      siteID: toInt(entry && entry.endpoint && entry.endpoint.endpointID, 0),
      endpointID: toInt(entry && entry.endpoint && entry.endpoint.endpointID, 0),
      targetID:
        String(entry && entry.endpoint && entry.endpoint.targetID || "")
          .trim()
          .toUpperCase() || null,
      typeID: toInt(entry && entry.endpoint && entry.endpoint.typeID, 0),
      code: String(entry && entry.endpoint && entry.endpoint.code || "").trim().toUpperCase() || null,
      actualPosition: cloneVector(entry && entry.endpoint && entry.endpoint.position),
    }))
    .filter((entry) => entry.siteID > 0)
    .sort((left, right) => left.siteID - right.siteID);
}

function allocateStableSignatureCodes(systemID, candidates = []) {
  const codesBySiteID = new Map();

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const siteID = toInt(candidate && candidate.siteID, 0);
    if (siteID <= 0) {
      continue;
    }
    const targetID =
      String(candidate && candidate.targetID || "").trim().toUpperCase() ||
      targetIdRuntime.encodeTargetID("wormhole", systemID, siteID);
    codesBySiteID.set(siteID, targetID);
  }

  return codesBySiteID;
}

function listSignatureSites(systemID, options = {}) {
  const candidates = listWormholeSignatureCandidates(systemID, options);
  const codesBySiteID = allocateStableSignatureCodes(systemID, candidates);
  return candidates.map((candidate) => {
    const targetID =
      codesBySiteID.get(candidate.siteID) ||
      targetIdRuntime.encodeTargetID("wormhole", systemID, candidate.siteID);
    const wormholeCode =
      String(candidate && candidate.code || "").trim().toUpperCase() || "K162";
    return {
      ...candidate,
      siteKind: "signature",
      family: "wormhole",
      strengthAttributeID: ATTRIBUTE_SCAN_WORMHOLE_STRENGTH,
      targetID,
      deviation: DEFAULT_SIGNATURE_DEVIATION_METERS,
      position: buildSignaturePosition(candidate.actualPosition, targetID),
      difficulty: 1,
      dungeonID: null,
      archetypeID: null,
      label: `Wormhole ${wormholeCode}`,
      wormholeCode,
      pairKind: String(candidate && candidate.pairKind || "static").trim().toLowerCase() || "static",
    };
  });
}

module.exports = {
  providerID: "wormhole",
  siteKind: "signature",
  AU_METERS,
  DEFAULT_SIGNATURE_DEVIATION_METERS,
  ATTRIBUTE_SCAN_WORMHOLE_STRENGTH,
  allocateStableSignatureCodes,
  buildSignaturePosition,
  encodeSignatureCodeFromNumber: targetIdRuntime.encodeSignatureCodeFromNumber,
  listSignatureSites,
  listWormholeSignatureCandidates,
};
