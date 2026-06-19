const path = require("path");

const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getAllianceRecord,
  getCorporationRecord,
} = require(path.join(__dirname, "../corporation/corporationState"));
const {
  STRUCTURE_SERVICE_STATE,
  STRUCTURE_STATE_NAME_BY_ID,
} = require(path.join(__dirname, "../structure/structureConstants"));
const {
  FILETIME_EPOCH_OFFSET,
  FILETIME_TICKS_PER_MILLISECOND,
  TYPE_INFRASTRUCTURE_HUB,
  TYPE_TERRITORIAL_CLAIM_UNIT,
} = require(path.join(__dirname, "./sovConstants"));
const {
  buildAnchorLayout,
} = require(path.join(__dirname, "./sovAnchorLayout"));
const {
  cancelAllianceCapitalTransition,
  clearStructureCampaignState,
  clearStructureVulnerabilityState,
  getAllianceCapitalInfo,
  getAlliancePrimeInfo,
  getOperationalIndexLevel,
  getStrategicIndexLevel,
  getSystemState,
  listSovStructuresForSystem,
  setAllianceCapitalSystem,
  setAlliancePrimeHour,
  setStructureCampaignScores,
  setStructureCampaignState,
  setStructureVulnerabilityState,
  upsertAllianceState,
  upsertSystemState,
} = require(path.join(__dirname, "./sovState"));

const FILETIME_TICKS_PER_SECOND = 10_000_000n;
const SYNTHETIC_SOV_ITEM_ID_BASE = 1_140_000_000_000;
const DEFAULT_VULNERABILITY_DURATION_SECONDS = 900;
const DEFAULT_CAMPAIGN_EVENT_TYPE = 7;
const DEFAULT_CAMPAIGN_OFFSET_SECONDS = 300;

const STRUCTURE_KIND = Object.freeze({
  TCU: "tcu",
  IHUB: "ihub",
  BOTH: "both",
});

let syntheticItemSequence = 1;

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function normalizePositiveInteger(value, fallback = null) {
  const numeric = normalizeInteger(value, 0);
  return numeric > 0 ? numeric : fallback;
}

function normalizeNullablePositiveInteger(value, fallback = null) {
  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return fallback;
  }
  return normalizePositiveInteger(value, fallback);
}

function normalizeSpacePoint(value, fallback = null) {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return fallback;
  }
  return { x, y, z };
}

function cloneSpacePoint(value, fallback = null) {
  const point = normalizeSpacePoint(value, fallback);
  return point ? { ...point } : fallback;
}

function formatSpacePoint(value) {
  const point = normalizeSpacePoint(value, null);
  if (!point) {
    return null;
  }
  return `${Math.round(point.x)},${Math.round(point.y)},${Math.round(point.z)}`;
}

function resolveCurrentSolarSystemID(session) {
  return normalizePositiveInteger(
    session &&
      (
        (session._space && session._space.systemID) ||
        session.solarsystemid2 ||
        session.solarsystemid
      ),
    0,
  );
}

function resolveSolarSystemID(session, token, fallback = 0) {
  const trimmed = String(token || "").trim().toLowerCase();
  if (!trimmed || trimmed === "here" || trimmed === "current") {
    return resolveCurrentSolarSystemID(session) || fallback;
  }
  const numericSolarSystemID = normalizePositiveInteger(trimmed, 0);
  if (!numericSolarSystemID) {
    return fallback;
  }
  return worldData.getSolarSystemByID(numericSolarSystemID)
    ? numericSolarSystemID
    : fallback;
}

function resolveAllianceID(session, token, fallback = null) {
  if (token === undefined || token === null || token === "") {
    return normalizePositiveInteger(
      session && (session.allianceID || session.allianceid),
      fallback,
    );
  }
  return normalizePositiveInteger(token, fallback);
}

function resolveCorporationID(session, token, fallback = null) {
  if (token === undefined || token === null || token === "") {
    return normalizePositiveInteger(
      session && (session.corporationID || session.corpid),
      fallback,
    );
  }
  return normalizePositiveInteger(token, fallback);
}

function normalizeStructureKind(token) {
  const normalized = String(token || "").trim().toLowerCase();
  if (
    normalized === STRUCTURE_KIND.TCU ||
    normalized === "claim" ||
    normalized === "tcu"
  ) {
    return STRUCTURE_KIND.TCU;
  }
  if (
    normalized === STRUCTURE_KIND.IHUB ||
    normalized === "hub" ||
    normalized === "ihub" ||
    normalized === "infrastructurehub"
  ) {
    return STRUCTURE_KIND.IHUB;
  }
  if (
    !normalized ||
    normalized === STRUCTURE_KIND.BOTH ||
    normalized === "all"
  ) {
    return STRUCTURE_KIND.BOTH;
  }
  return null;
}

function structureMatchesKind(structure, kind) {
  if (!structure) {
    return false;
  }
  const typeID = normalizePositiveInteger(structure.typeID, 0);
  if (kind === STRUCTURE_KIND.TCU) {
    return typeID === TYPE_TERRITORIAL_CLAIM_UNIT;
  }
  if (kind === STRUCTURE_KIND.IHUB) {
    return typeID === TYPE_INFRASTRUCTURE_HUB;
  }
  return (
    typeID === TYPE_TERRITORIAL_CLAIM_UNIT ||
    typeID === TYPE_INFRASTRUCTURE_HUB
  );
}

function getStructureTypeIDForKind(kind) {
  if (kind === STRUCTURE_KIND.TCU) {
    return TYPE_TERRITORIAL_CLAIM_UNIT;
  }
  if (kind === STRUCTURE_KIND.IHUB) {
    return TYPE_INFRASTRUCTURE_HUB;
  }
  return 0;
}

function nextSyntheticSovItemID() {
  const offset = Number(currentFileTime() % 1_000_000_000n);
  const itemID =
    SYNTHETIC_SOV_ITEM_ID_BASE +
    (offset * 10) +
    syntheticItemSequence;
  syntheticItemSequence = syntheticItemSequence >= 9
    ? 1
    : syntheticItemSequence + 1;
  return itemID;
}

function ensureValidSolarSystem(solarSystemID) {
  const numericSolarSystemID = normalizePositiveInteger(solarSystemID, null);
  if (!numericSolarSystemID) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_REQUIRED",
    };
  }
  const solarSystem = worldData.getSolarSystemByID(numericSolarSystemID);
  if (!solarSystem) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }
  return {
    success: true,
    data: {
      solarSystemID: numericSolarSystemID,
      solarSystem,
    },
  };
}

function formatOwnerLabel(kind, ownerID) {
  const numericOwnerID = normalizePositiveInteger(ownerID, null);
  if (!numericOwnerID) {
    return `${kind}=none`;
  }
  const record = kind === "alliance"
    ? getAllianceRecord(numericOwnerID)
    : getCorporationRecord(numericOwnerID);
  const recordName = record
    ? (record.allianceName || record.shortName || record.corporationName || record.tickerName)
    : null;
  return recordName
    ? `${kind}=${recordName}(${numericOwnerID})`
    : `${kind}=${numericOwnerID}`;
}

function formatStructureKind(structure) {
  if (!structure) {
    return "unknown";
  }
  const typeID = normalizePositiveInteger(structure.typeID, 0);
  if (typeID === TYPE_TERRITORIAL_CLAIM_UNIT) {
    return "tcu";
  }
  if (typeID === TYPE_INFRASTRUCTURE_HUB) {
    return "ihub";
  }
  return `type=${typeID}`;
}

function filetimeToUnixMs(value) {
  try {
    const filetime = BigInt(String(value || "0"));
    if (filetime <= FILETIME_EPOCH_OFFSET) {
      return 0;
    }
    return Number((filetime - FILETIME_EPOCH_OFFSET) / FILETIME_TICKS_PER_MILLISECOND);
  } catch (error) {
    return 0;
  }
}

function unixMsToFiletimeString(unixMs) {
  const numericUnixMs = normalizeInteger(unixMs, 0);
  if (numericUnixMs <= 0) {
    return "0";
  }
  return (
    FILETIME_EPOCH_OFFSET +
    BigInt(numericUnixMs) * FILETIME_TICKS_PER_MILLISECOND
  ).toString();
}

function shiftFiletimeBackward(rawValue, seconds) {
  const numericSeconds = Math.max(0, normalizeInteger(seconds, 0));
  if (!rawValue || rawValue === "0" || numericSeconds <= 0) {
    return rawValue || "0";
  }
  try {
    const shiftedValue =
      BigInt(String(rawValue)) - (BigInt(numericSeconds) * FILETIME_TICKS_PER_SECOND);
    if (shiftedValue <= FILETIME_EPOCH_OFFSET) {
      return "0";
    }
    return shiftedValue.toString();
  } catch (error) {
    return rawValue || "0";
  }
}

function formatFiletime(rawValue) {
  const unixMs = filetimeToUnixMs(rawValue);
  return unixMs > 0 ? new Date(unixMs).toISOString() : "0";
}

function formatUnixMs(rawValue) {
  const unixMs = normalizeInteger(rawValue, 0);
  return unixMs > 0 ? new Date(unixMs).toISOString() : "0";
}

function getRawSystemState(solarSystemID) {
  return cloneValue(getSystemState(solarSystemID)) || null;
}

function getMatchingStructures(solarSystemID, kind) {
  const currentSystem = getRawSystemState(solarSystemID);
  const structures = Array.isArray(currentSystem && currentSystem.structures)
    ? currentSystem.structures
    : [];
  return structures.filter((structure) => structureMatchesKind(structure, kind));
}

function anchorSovereigntyStructures(
  solarSystemID,
  kind,
  allianceID,
  corporationID,
  options = {},
) {
  const currentSystem = getRawSystemState(solarSystemID) || {};
  const currentStructures = Array.isArray(currentSystem.structures)
    ? cloneValue(currentSystem.structures)
    : [];
  const anchoredItemIDs = [];
  const claimTime = currentFileTime().toString();
  const positionsByKind =
    options && typeof options === "object" && options.positionsByKind
      ? options.positionsByKind
      : buildAnchorLayout(solarSystemID).positionsByKind;
  const namesByKind =
    options && typeof options === "object" && options.namesByKind
      ? options.namesByKind
      : null;

  function getPositionForKind(targetKind) {
    return cloneSpacePoint(
      positionsByKind && positionsByKind[targetKind],
      null,
    );
  }

    function ensureStructure(targetKind) {
      const existing = currentStructures.find((structure) => structureMatchesKind(structure, targetKind));
      const nextPosition = getPositionForKind(targetKind);
      const nextName =
        namesByKind && Object.prototype.hasOwnProperty.call(namesByKind, targetKind)
          ? String(namesByKind[targetKind] || "").trim()
          : "";
      if (existing) {
        existing.ownerID = corporationID;
        existing.corporationID = corporationID;
        existing.allianceID = allianceID;
        if (nextPosition) {
          existing.position = nextPosition;
        }
        if (nextName) {
          existing.name = nextName;
        }
        anchoredItemIDs.push(existing.itemID);
        return existing.itemID;
      }
      const itemID = nextSyntheticSovItemID();
      const nextStructure = {
      itemID,
      typeID: getStructureTypeIDForKind(targetKind),
      ownerID: corporationID,
      corporationID,
      allianceID,
      solarSystemID,
      campaignEventType: 0,
      campaignStartTime: "0",
        campaignScoresByTeam: {},
        vulnerableStartTime: "0",
        vulnerableEndTime: "0",
      };
      if (nextName) {
        nextStructure.name = nextName;
      }
      if (nextPosition) {
        nextStructure.position = nextPosition;
      }
    currentStructures.push(nextStructure);
    anchoredItemIDs.push(itemID);
    return itemID;
  }

  const patch = {
    allianceID,
    corporationID,
    claimTime,
    structures: currentStructures,
  };

  if (kind === STRUCTURE_KIND.TCU || kind === STRUCTURE_KIND.BOTH) {
    patch.claimStructureID = ensureStructure(STRUCTURE_KIND.TCU);
  }
  if (kind === STRUCTURE_KIND.IHUB || kind === STRUCTURE_KIND.BOTH) {
    patch.infrastructureHubID = ensureStructure(STRUCTURE_KIND.IHUB);
  }

  const nextSystem = upsertSystemState(solarSystemID, patch);
  return {
    success: true,
    data: {
      solarSystemID,
      system: nextSystem,
      anchoredItemIDs,
    },
  };
}

function setVulnerabilityWindowForKind(solarSystemID, kind, durationSeconds) {
  const matchingStructures = getMatchingStructures(solarSystemID, kind);
  if (matchingStructures.length === 0) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }
  const duration = Math.max(
    1,
    normalizeInteger(durationSeconds, DEFAULT_VULNERABILITY_DURATION_SECONDS),
  );
  const startTime = currentFileTime().toString();
  const endTime = (
    currentFileTime() + (BigInt(duration) * FILETIME_TICKS_PER_SECOND)
  ).toString();
  for (const structure of matchingStructures) {
    setStructureVulnerabilityState(
      solarSystemID,
      structure.itemID,
      {
        vulnerableStartTime: startTime,
        vulnerableEndTime: endTime,
      },
    );
  }
  return {
    success: true,
    data: {
      solarSystemID,
      structureCount: matchingStructures.length,
      startTime,
      endTime,
    },
  };
}

function clearVulnerabilityWindowForKind(solarSystemID, kind) {
  const matchingStructures = getMatchingStructures(solarSystemID, kind);
  if (matchingStructures.length === 0) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }
  for (const structure of matchingStructures) {
    clearStructureVulnerabilityState(solarSystemID, structure.itemID);
  }
  return {
    success: true,
    data: {
      solarSystemID,
      structureCount: matchingStructures.length,
    },
  };
}

function startCampaignForKind(
  solarSystemID,
  kind,
  eventType = DEFAULT_CAMPAIGN_EVENT_TYPE,
  offsetSeconds = DEFAULT_CAMPAIGN_OFFSET_SECONDS,
) {
  const matchingStructures = getMatchingStructures(solarSystemID, kind);
  if (matchingStructures.length === 0) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }
  const campaignEventType = Math.max(1, normalizeInteger(eventType, DEFAULT_CAMPAIGN_EVENT_TYPE));
  const campaignStartTime = (
    currentFileTime() +
    (BigInt(Math.max(0, normalizeInteger(offsetSeconds, DEFAULT_CAMPAIGN_OFFSET_SECONDS))) *
      FILETIME_TICKS_PER_SECOND)
  ).toString();
  for (const structure of matchingStructures) {
    setStructureCampaignState(
      solarSystemID,
      structure.itemID,
      {
        campaignEventType,
        campaignStartTime,
        campaignScoresByTeam: {
          1: 0,
          2: 0,
        },
      },
    );
  }
  return {
    success: true,
    data: {
      solarSystemID,
      structureCount: matchingStructures.length,
      campaignEventType,
      campaignStartTime,
    },
  };
}

function clearCampaignForKind(solarSystemID, kind) {
  const matchingStructures = getMatchingStructures(solarSystemID, kind);
  if (matchingStructures.length === 0) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }
  for (const structure of matchingStructures) {
    clearStructureCampaignState(solarSystemID, structure.itemID);
  }
  return {
    success: true,
    data: {
      solarSystemID,
      structureCount: matchingStructures.length,
    },
  };
}

function setCampaignScoresForKind(solarSystemID, kind, scoresByTeam) {
  const matchingStructures = getMatchingStructures(solarSystemID, kind);
  if (matchingStructures.length === 0) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }
  const normalizedScoresByTeam = {};
  for (const [teamID, score] of Object.entries(scoresByTeam || {})) {
    const numericTeamID = normalizePositiveInteger(teamID, null);
    if (!numericTeamID) {
      continue;
    }
    normalizedScoresByTeam[String(numericTeamID)] = normalizeInteger(score, 0);
  }
  if (Object.keys(normalizedScoresByTeam).length === 0) {
    return {
      success: false,
      errorMsg: "SCORES_REQUIRED",
    };
  }
  for (const structure of matchingStructures) {
    setStructureCampaignScores(
      solarSystemID,
      structure.itemID,
      normalizedScoresByTeam,
    );
  }
  return {
    success: true,
    data: {
      solarSystemID,
      structureCount: matchingStructures.length,
      scoresByTeam: normalizedScoresByTeam,
    },
  };
}

function fastForwardSovereigntyTimers(solarSystemID, seconds) {
  const numericSeconds = Math.max(0, normalizeInteger(seconds, 0));
  if (numericSeconds <= 0) {
    return {
      success: false,
      errorMsg: "SECONDS_REQUIRED",
    };
  }

  const currentSystem = getRawSystemState(solarSystemID);
  if (!currentSystem) {
    return {
      success: false,
      errorMsg: "SYSTEM_NOT_FOUND",
    };
  }

  let shiftedStructureTimerCount = 0;
  const shiftedStructures = (Array.isArray(currentSystem.structures) ? currentSystem.structures : []).map(
    (structure) => {
      const nextStructure = {
        ...cloneValue(structure),
        campaignStartTime: shiftFiletimeBackward(structure.campaignStartTime, numericSeconds),
        vulnerableStartTime: shiftFiletimeBackward(structure.vulnerableStartTime, numericSeconds),
        vulnerableEndTime: shiftFiletimeBackward(structure.vulnerableEndTime, numericSeconds),
      };
      if (
        nextStructure.campaignStartTime !== structure.campaignStartTime ||
        nextStructure.vulnerableStartTime !== structure.vulnerableStartTime ||
        nextStructure.vulnerableEndTime !== structure.vulnerableEndTime
      ) {
        shiftedStructureTimerCount += 1;
      }
      return nextStructure;
    },
  );

  upsertSystemState(solarSystemID, {
    structures: shiftedStructures,
  });

  let shiftedAllianceTimerCount = 0;
  const allianceID = normalizePositiveInteger(currentSystem.allianceID, null);
  if (allianceID) {
    const primeInfo = getAlliancePrimeInfo(allianceID);
    const capitalInfo = getAllianceCapitalInfo(allianceID);
    const nextPrimeValidAfter = shiftFiletimeBackward(
      primeInfo && primeInfo.newPrimeHourValidAfter,
      numericSeconds,
    );
    const nextCapitalValidAfter = shiftFiletimeBackward(
      capitalInfo && capitalInfo.newCapitalSystemValidAfter,
      numericSeconds,
    );
    if (nextPrimeValidAfter !== String(primeInfo && primeInfo.newPrimeHourValidAfter || "0")) {
      shiftedAllianceTimerCount += 1;
    }
    if (
      nextCapitalValidAfter !==
      String(capitalInfo && capitalInfo.newCapitalSystemValidAfter || "0")
    ) {
      shiftedAllianceTimerCount += 1;
    }
    upsertAllianceState(allianceID, {
      primeInfo: {
        newPrimeHourValidAfter: nextPrimeValidAfter,
      },
      capitalInfo: {
        newCapitalSystemValidAfter: nextCapitalValidAfter,
      },
    });
  }

  return {
    success: true,
    data: {
      solarSystemID,
      seconds: numericSeconds,
      shiftedStructureTimerCount,
      shiftedAllianceTimerCount,
    },
  };
}

function captureSystemForOwner(solarSystemID, allianceID, corporationID) {
  const anchorResult = anchorSovereigntyStructures(
    solarSystemID,
    STRUCTURE_KIND.BOTH,
    allianceID,
    corporationID,
  );
  if (!anchorResult.success) {
    return anchorResult;
  }

  const currentSystem = getRawSystemState(solarSystemID) || {};
  const claimTime = currentFileTime().toString();
  const structures = (Array.isArray(currentSystem.structures) ? currentSystem.structures : []).map(
    (structure) => ({
      ...cloneValue(structure),
      ownerID: corporationID,
      corporationID,
      allianceID,
      campaignEventType: 0,
      campaignStartTime: "0",
      campaignScoresByTeam: {},
      vulnerableStartTime: "0",
      vulnerableEndTime: "0",
    }),
  );
  const tcu = structures.find((structure) => structureMatchesKind(structure, STRUCTURE_KIND.TCU));
  const ihub = structures.find((structure) => structureMatchesKind(structure, STRUCTURE_KIND.IHUB));

  const nextSystem = upsertSystemState(solarSystemID, {
    allianceID,
    corporationID,
    claimStructureID: tcu ? tcu.itemID : null,
    infrastructureHubID: ihub ? ihub.itemID : null,
    claimTime,
    structures,
    devIndices: {
      claimedForDays: 0,
    },
  });

  return {
    success: true,
    data: {
      solarSystemID,
      system: nextSystem,
    },
  };
}

function loseSystemSovereignty(solarSystemID, nextAllianceID = null, nextCorporationID = null) {
  const normalizedNextAllianceID = normalizePositiveInteger(nextAllianceID, null);
  const normalizedNextCorporationID = normalizePositiveInteger(nextCorporationID, null);
  if (normalizedNextAllianceID || normalizedNextCorporationID) {
    if (!normalizedNextAllianceID || !normalizedNextCorporationID) {
      return {
        success: false,
        errorMsg: "OWNER_PAIR_REQUIRED",
      };
    }
    return captureSystemForOwner(
      solarSystemID,
      normalizedNextAllianceID,
      normalizedNextCorporationID,
    );
  }

  const nextSystem = upsertSystemState(solarSystemID, {
    allianceID: null,
    corporationID: null,
    claimStructureID: null,
    infrastructureHubID: null,
    claimTime: "0",
    structures: [],
    devIndices: {
      claimedForDays: 0,
    },
  });

  return {
    success: true,
    data: {
      solarSystemID,
      system: nextSystem,
    },
  };
}

function clearSystemSovereignty(solarSystemID) {
  return loseSystemSovereignty(solarSystemID, null, null);
}

function setSystemDevelopmentIndexValue(
  solarSystemID,
  indexKind,
  value,
) {
  const normalizedSolarSystemID = normalizePositiveInteger(solarSystemID, null);
  if (!normalizedSolarSystemID) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_REQUIRED",
    };
  }

  const system = getSystemState(normalizedSolarSystemID);
  if (!system) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const normalizedIndexKind = String(indexKind || "").trim().toLowerCase();
  const numericValue = Math.max(0, normalizeInteger(value, 0));
  if (
    normalizedIndexKind !== "military" &&
    normalizedIndexKind !== "industrial" &&
    normalizedIndexKind !== "claimed" &&
    normalizedIndexKind !== "strategic"
  ) {
    return {
      success: false,
      errorMsg: "INVALID_INDEX_KIND",
    };
  }

  const devIndices = cloneValue(system.devIndices || {});
  if (normalizedIndexKind === "military") {
    devIndices.militaryPoints = numericValue;
  } else if (normalizedIndexKind === "industrial") {
    devIndices.industrialPoints = numericValue;
  } else if (normalizedIndexKind === "claimed") {
    devIndices.claimedForDays = numericValue;
  } else {
    const claimedDaysByStrategicLevel = [0, 7, 21, 35, 65, 100];
    const normalizedLevel = Math.max(0, Math.min(5, numericValue));
    devIndices.claimedForDays = claimedDaysByStrategicLevel[normalizedLevel];
  }

  upsertSystemState(normalizedSolarSystemID, {
    devIndices,
  });
  return {
    success: true,
    data: {
      solarSystemID: normalizedSolarSystemID,
      system: getSystemState(normalizedSolarSystemID),
    },
  };
}

function describeCampaign(structure) {
  const campaignEventType = normalizeInteger(structure && structure.campaignEventType, 0);
  if (!campaignEventType) {
    return "campaign=off";
  }
  const scoreEntries = Object.entries(structure && structure.campaignScoresByTeam || {})
    .map(([teamID, score]) => `${teamID}:${score}`)
    .join(",");
  return [
    `campaign=event:${campaignEventType}`,
    `start=${formatFiletime(structure.campaignStartTime)}`,
    `scores=${scoreEntries || "none"}`,
  ].join(" ");
}

function describeVulnerability(structure) {
  if (
    !structure ||
    !structure.vulnerableStartTime ||
    !structure.vulnerableEndTime ||
    structure.vulnerableStartTime === "0" ||
    structure.vulnerableEndTime === "0"
  ) {
    return "vulnerability=off";
  }
  return [
    `vulnerability=${formatFiletime(structure.vulnerableStartTime)}`,
    `->`,
    `${formatFiletime(structure.vulnerableEndTime)}`,
  ].join(" ");
}

function describeHubUpgradeSnapshot(hubUpgrades) {
  if (!hubUpgrades || !Array.isArray(hubUpgrades.upgrades) || hubUpgrades.upgrades.length === 0) {
    return "hubUpgrades=none";
  }
  const upgradeLabels = hubUpgrades.upgrades.map((upgrade) => {
    const definition = upgrade && upgrade.definition ? upgrade.definition : {};
    const typeName = String(definition.typeName || upgrade.typeID || "upgrade");
    const powerState = Number(upgrade && upgrade.powerState) || 0;
    const stateLabel =
      powerState === 2
        ? "online"
        : powerState === 3
          ? "low"
          : powerState === 4
            ? "pending"
            : "offline";
    return `${typeName}(${upgrade.typeID})=${stateLabel}`;
  });
  return `hubUpgrades=${upgradeLabels.join(", ")}`;
}

function describeHubFuelSnapshot(hubFuel) {
  if (!hubFuel || !Array.isArray(hubFuel.fuels) || hubFuel.fuels.length === 0) {
    return "hubFuel=empty";
  }
  const fuelLabels = hubFuel.fuels
    .filter((fuel) => Number(fuel && fuel.amount) > 0 || Number(fuel && fuel.burnedPerHour) > 0)
    .map((fuel) => {
      const amount = Math.max(0, Number(fuel && fuel.amount) || 0);
      const burnedPerHour = Math.max(0, Number(fuel && fuel.burnedPerHour) || 0);
      const hoursLeft =
        burnedPerHour > 0
          ? `${(amount / burnedPerHour).toFixed(1)}h`
          : "static";
      return `${fuel.fuelTypeID}:${amount}@${burnedPerHour}/h(${hoursLeft})`;
    });
  return fuelLabels.length > 0
    ? `hubFuel=${fuelLabels.join(", ")}`
    : "hubFuel=empty";
}

function describeSovereigntyFlexStructures(solarSystemID) {
  const {
    getSovereigntyFlexDefinitions,
    listSovereigntyFlexStructuresForSystem,
  } = require(path.join(__dirname, "./sovFlexStructures"));
  const flexDefinitionsByTypeID = new Map(
    getSovereigntyFlexDefinitions().map((definition) => [definition.typeID, definition]),
  );
  const flexStructures = listSovereigntyFlexStructuresForSystem(solarSystemID);
  if (flexStructures.length === 0) {
    return [];
  }
  return flexStructures
    .sort((left, right) => Number(left.structureID || 0) - Number(right.structureID || 0))
    .map((structure) => {
      const definition = flexDefinitionsByTypeID.get(
        normalizePositiveInteger(structure && structure.typeID, 0),
      ) || null;
      const serviceState =
        definition &&
        Number(
          structure &&
            structure.serviceStates &&
            structure.serviceStates[String(definition.serviceID)],
        ) === STRUCTURE_SERVICE_STATE.ONLINE
          ? "online"
          : "offline";
      return [
        `flex=${definition ? definition.kind : structure.typeID}`,
        `item=${structure.structureID}`,
        `state=${STRUCTURE_STATE_NAME_BY_ID[normalizeInteger(structure && structure.state, 0)] || "unknown"}`,
        `service=${serviceState}`,
        `liquidOzone=${normalizeInteger(structure && structure.liquidOzoneQty, 0)}`,
        `fuelExpires=${formatUnixMs(structure && structure.fuelExpiresAt)}`,
        cloneSpacePoint(structure && structure.position, null)
          ? `pos=${formatSpacePoint(structure.position)}`
          : null,
      ].filter(Boolean).join(" | ");
    });
}

function buildSovereigntyStatusReport(solarSystemID) {
  const solarSystem = worldData.getSolarSystemByID(solarSystemID);
  if (!solarSystem) {
    return "Solar system not found.";
  }

  const system = getRawSystemState(solarSystemID) || {};
  const structures = listSovStructuresForSystem(solarSystemID);
  const lines = [];
  lines.push(
    `${solarSystem.solarSystemName || solarSystem.itemName || `System ${solarSystemID}`}(${solarSystemID}) ${formatOwnerLabel("alliance", system.allianceID)} ${formatOwnerLabel("corporation", system.corporationID)} claim=${system.claimStructureID || "none"} ihub=${system.infrastructureHubID || "none"}`,
  );

  if (system.allianceID) {
    const primeInfo = getAlliancePrimeInfo(system.allianceID);
    const capitalInfo = getAllianceCapitalInfo(system.allianceID);
    lines.push(
      `prime current=${primeInfo.currentPrimeHour} pending=${primeInfo.newPrimeHour} validAfter=${formatFiletime(primeInfo.newPrimeHourValidAfter)}`,
    );
    lines.push(
      `capital current=${capitalInfo.currentCapitalSystem || "none"} pending=${capitalInfo.newCapitalSystem || "none"} validAfter=${formatFiletime(capitalInfo.newCapitalSystemValidAfter)}`,
    );
  }

  const devIndices = system.devIndices || {};
  const militaryPoints = normalizeInteger(devIndices.militaryPoints, 0);
  const industrialPoints = normalizeInteger(devIndices.industrialPoints, 0);
  const claimedForDays = normalizeInteger(devIndices.claimedForDays, 0);
  lines.push(
    `indices military=${militaryPoints}(L${getOperationalIndexLevel(militaryPoints)}) industrial=${industrialPoints}(L${getOperationalIndexLevel(industrialPoints)}) claimedForDays=${claimedForDays}(strategic=${getStrategicIndexLevel(claimedForDays)})`,
  );
  lines.push(`claimTime=${formatFiletime(system.claimTime)}`);
  if (system.infrastructureHubID) {
    const {
      getHubFuel,
      getHubUpgrades,
    } = require(path.join(__dirname, "./sovModernState"));
    lines.push(
      describeHubUpgradeSnapshot(
        getHubUpgrades(system.infrastructureHubID),
      ),
    );
    lines.push(
      describeHubFuelSnapshot(
        getHubFuel(system.infrastructureHubID),
      ),
    );
  }

  if (structures.length === 0) {
    lines.push("structures=none");
    lines.push(...describeSovereigntyFlexStructures(solarSystemID));
    return lines.join("\n");
  }

  for (const structure of structures) {
    lines.push(
      [
        `structure=${formatStructureKind(structure)}`,
        `item=${structure.itemID}`,
        formatOwnerLabel("alliance", structure.allianceID),
        formatOwnerLabel("corporation", structure.corporationID),
        `defense=${Number(structure.defenseMultiplier || 0).toFixed(2)}`,
        `capital=${structure.isCapital === true ? "yes" : "no"}`,
        formatSpacePoint(structure.position)
          ? `pos=${formatSpacePoint(structure.position)}`
          : null,
        describeVulnerability(structure),
        describeCampaign(structure),
      ].filter(Boolean).join(" | "),
    );
  }

  lines.push(...describeSovereigntyFlexStructures(solarSystemID));

  return lines.join("\n");
}

module.exports = {
  DEFAULT_CAMPAIGN_EVENT_TYPE,
  DEFAULT_CAMPAIGN_OFFSET_SECONDS,
  DEFAULT_VULNERABILITY_DURATION_SECONDS,
  STRUCTURE_KIND,
  anchorSovereigntyStructures,
  buildSovereigntyStatusReport,
  cancelAllianceCapitalTransition,
  captureSystemForOwner,
  clearSystemSovereignty,
  clearCampaignForKind,
  clearVulnerabilityWindowForKind,
  ensureValidSolarSystem,
  fastForwardSovereigntyTimers,
  loseSystemSovereignty,
  normalizeStructureKind,
  resolveAllianceID,
  resolveCorporationID,
  resolveCurrentSolarSystemID,
  resolveSolarSystemID,
  setAllianceCapitalSystem,
  setAlliancePrimeHour,
  setCampaignScoresForKind,
  setSystemDevelopmentIndexValue,
  setVulnerabilityWindowForKind,
  startCampaignForKind,
};
