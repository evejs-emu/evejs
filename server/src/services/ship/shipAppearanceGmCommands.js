const path = require("path");

const {
  getActiveShipRecord,
} = require(path.join(__dirname, "../character/characterState"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  findShipItemById,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  clearShipDirtTimestamp,
  getShipDirtRecord,
  normalizeFiletime,
  resetShipDirtTimestamp,
} = require(path.join(__dirname, "./shipDirtState"));
const {
  MAX_DISPLAYED_KILLMARKS,
  clearShipKillCounter,
  getItemKillCountPlayer,
  readShipCounterRecord,
  setShipKillCounter,
} = require(path.join(__dirname, "./shipKillCounterState"));

const FILETIME_TICKS_PER_MS = 10000n;
const MS_IN_WEEK = 604800000;
const DIRT_CURVE_BASE = 1 / 2.7;
const DIRT_CURVE_POWER = 0.65;
const DIRT_LEVEL_MIN = -2.0;
const DIRT_LEVEL_SPLIT = 0.0;
const DIRT_LEVEL_MAX = 0.7;
const MAX_DIRT_AGE_WEEKS = 5200;

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function clampNumber(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function lerp(minimum, maximum, factor) {
  return (maximum - minimum) * factor + minimum;
}

function calculateDirtLevelFromWeeks(weeks) {
  const dirtTimeDiffInWeeks = Math.max(Number(weeks) || 0, 0);
  return DIRT_LEVEL_MAX - 1.0 / (
    Math.pow(dirtTimeDiffInWeeks, DIRT_CURVE_POWER) + DIRT_CURVE_BASE
  );
}

const MAX_RUNTIME_DIRT_LEVEL = calculateDirtLevelFromWeeks(MAX_DIRT_AGE_WEEKS);

function remapDirtRatioToLevel(rawRatio) {
  const ratio = clampNumber(Number(rawRatio) || 0, 0, 1);
  const dirtLevel0To100 = ratio * 100;
  if (dirtLevel0To100 < 50) {
    return lerp(DIRT_LEVEL_MIN, DIRT_LEVEL_SPLIT, dirtLevel0To100 / 50.0);
  }
  return lerp(DIRT_LEVEL_SPLIT, DIRT_LEVEL_MAX, (dirtLevel0To100 - 50) / 50.0);
}

function convertDirtLevelToRatio(rawLevel) {
  const dirtLevel = clampNumber(
    Number(rawLevel) || 0,
    DIRT_LEVEL_MIN,
    MAX_RUNTIME_DIRT_LEVEL,
  );
  if (dirtLevel < DIRT_LEVEL_SPLIT) {
    return clampNumber(((dirtLevel - DIRT_LEVEL_MIN) / 2.0) * 0.5, 0, 1);
  }
  return clampNumber(0.5 + (dirtLevel / DIRT_LEVEL_MAX) * 0.5, 0, 1);
}

function calculateAgeWeeksForTargetDirtLevel(rawLevel) {
  const dirtLevel = clampNumber(
    Number(rawLevel) || 0,
    DIRT_LEVEL_MIN,
    MAX_RUNTIME_DIRT_LEVEL,
  );
  const inverseBase = 1.0 / (DIRT_LEVEL_MAX - dirtLevel) - DIRT_CURVE_BASE;
  if (inverseBase <= 0) {
    return 0;
  }
  return Math.pow(inverseBase, 1.0 / DIRT_CURVE_POWER);
}

function buildFiletimeForDirtRatio(rawRatio) {
  const targetLevel = Math.min(
    remapDirtRatioToLevel(rawRatio),
    MAX_RUNTIME_DIRT_LEVEL,
  );
  const ageWeeks = Math.min(
    calculateAgeWeeksForTargetDirtLevel(targetLevel),
    MAX_DIRT_AGE_WEEKS,
  );
  const ageMs = Math.max(0, Math.round(ageWeeks * MS_IN_WEEK));
  return {
    ratio: clampNumber(Number(rawRatio) || 0, 0, 1),
    dirtLevel: targetLevel,
    dirtTime: currentFileTime() - BigInt(ageMs) * FILETIME_TICKS_PER_MS,
  };
}

function calculateDirtStatus(rawFiletime) {
  const dirtTime = normalizeFiletime(rawFiletime, null);
  if (dirtTime === null) {
    return null;
  }

  const diffTicks = currentFileTime() - dirtTime;
  const diffMs = Number((diffTicks > 0n ? diffTicks : 0n) / FILETIME_TICKS_PER_MS);
  const dirtLevel = calculateDirtLevelFromWeeks(diffMs / MS_IN_WEEK);
  return {
    dirtTime,
    dirtLevel,
    ratio: convertDirtLevelToRatio(dirtLevel),
  };
}

function formatRatio(value) {
  return clampNumber(Number(value) || 0, 0, 1).toFixed(2);
}

function formatLevel(value) {
  return Number(value || 0).toFixed(4);
}

function parseDirtRatio(rawValue) {
  const text = String(rawValue || "").trim();
  if (!text) {
    return null;
  }
  const numericValue = Number(text);
  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 1) {
    return null;
  }
  return numericValue;
}

function parseKillmarkCount(rawValue) {
  const text = String(rawValue || "").trim();
  if (!text) {
    return null;
  }
  const numericValue = Number(text);
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return Math.max(0, Math.min(MAX_DISPLAYED_KILLMARKS, Math.trunc(numericValue)));
}

function tokenize(argumentText = "") {
  return String(argumentText || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function resolveSessionShipID(session) {
  const candidates = [
    session && session._space && session._space.shipID,
    session && session.shipID,
    session && session.shipid,
    session && session.activeShipID,
  ];
  for (const candidate of candidates) {
    const shipID = toPositiveInt(candidate, 0);
    if (shipID > 0) {
      return shipID;
    }
  }
  return 0;
}

function extractExplicitShipID(tokens = []) {
  const normalizedTokens = Array.isArray(tokens) ? [...tokens] : [];
  if (normalizedTokens.length === 0) {
    return {
      success: true,
      shipID: 0,
      remainingTokens: normalizedTokens,
    };
  }

  const tail = String(normalizedTokens[normalizedTokens.length - 1] || "").trim();
  const prefixedMatch = /^ship(?:id)?=(\d+)$/i.exec(tail);
  if (prefixedMatch) {
    normalizedTokens.pop();
    return {
      success: true,
      shipID: toPositiveInt(prefixedMatch[1], 0),
      remainingTokens: normalizedTokens,
    };
  }

  const plainShipID = toPositiveInt(tail, 0);
  if (plainShipID > 0) {
    normalizedTokens.pop();
    return {
      success: true,
      shipID: plainShipID,
      remainingTokens: normalizedTokens,
    };
  }

  return {
    success: true,
    shipID: 0,
    remainingTokens: normalizedTokens,
  };
}

function describeShip(shipID, options = {}) {
  const item = findShipItemById(shipID) || null;
  const session = options.session || null;
  const activeShip = options.activeShip || null;
  const sessionShipName =
    resolveSessionShipID(session) === Number(shipID)
      ? String(session && session.shipName || "").trim()
      : "";
  const itemName = String(item && item.itemName || "").trim();
  const activeShipName =
    Number(activeShip && activeShip.itemID) === Number(shipID)
      ? String(activeShip && activeShip.itemName || "").trim()
      : "";
  const name = sessionShipName || itemName || activeShipName;
  return name ? `${name} (${shipID})` : `ship ${shipID}`;
}

function resolveTargetShip(session, tokens = []) {
  const explicitTarget = extractExplicitShipID(tokens);
  if (!explicitTarget.success) {
    return explicitTarget;
  }

  const activeShip = getActiveShipRecord(session && session.characterID) || null;
  const shipID =
    explicitTarget.shipID ||
    resolveSessionShipID(session) ||
    toPositiveInt(activeShip && activeShip.itemID, 0);
  if (!shipID) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  return {
    success: true,
    shipID,
    shipLabel: describeShip(shipID, { session, activeShip }),
    remainingTokens: explicitTarget.remainingTokens,
  };
}

function broadcastShipSlimChange(session, shipID, options = {}) {
  if (!session || !session._space) {
    return false;
  }

  try {
    const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
    const scene =
      typeof spaceRuntime.getSceneForSession === "function"
        ? spaceRuntime.getSceneForSession(session)
        : null;
    const entity =
      scene && typeof scene.getEntityByID === "function"
        ? scene.getEntityByID(shipID)
        : null;
    if (
      !scene ||
      !entity ||
      entity.kind !== "ship" ||
      typeof scene.broadcastSlimItemChanges !== "function"
    ) {
      return false;
    }

    if (options.refreshKills === true) {
      entity.kills = getItemKillCountPlayer(shipID);
    }
    if (options.refreshDirt === true) {
      const dirtRecord = getShipDirtRecord(shipID, { createIfMissing: false });
      entity.dirtTime = dirtRecord
        ? normalizeFiletime(dirtRecord.dirtTime, 0n) || 0n
        : 0n;
    }
    scene.broadcastSlimItemChanges([entity]);
    return true;
  } catch (error) {
    return false;
  }
}

function slimSuffix(broadcasted) {
  return broadcasted ? " Slim refresh broadcast." : "";
}

function handleShipDirtCommand(session, argumentText = "") {
  const tokens = tokenize(argumentText);
  const action = String(tokens[0] || "status").trim().toLowerCase();

  if (action === "help") {
    return {
      success: true,
      message: "Usage: /dirt <0.0-1.0> [shipID], /dirt status [shipID], or /dirt clear [shipID]",
    };
  }

  const directRatio = parseDirtRatio(tokens[0]);
  if (directRatio !== null) {
    const target = resolveTargetShip(session, tokens.slice(1));
    if (!target.success) {
      return {
        success: false,
        message: "No target ship found for /dirt.",
      };
    }

    if (directRatio <= 0) {
      const clearResult = clearShipDirtTimestamp(target.shipID, "gm_dirt_clear");
      if (!clearResult.success) {
        return {
          success: false,
          message: `Failed to clear dirt for ${target.shipLabel}.`,
        };
      }
      const broadcasted = broadcastShipSlimChange(session, target.shipID, {
        refreshDirt: true,
      });
      return {
        success: true,
        message: `Set dirt for ${target.shipLabel} to 0.00 (clean).${slimSuffix(broadcasted)}`,
      };
    }

    const dirtSetting = buildFiletimeForDirtRatio(directRatio);
    const result = resetShipDirtTimestamp(target.shipID, dirtSetting.dirtTime, {
      reason: "gm_dirt_set",
    });
    if (!result.success) {
      return {
        success: false,
        message: `Failed to set dirt for ${target.shipLabel}.`,
      };
    }

    const broadcasted = broadcastShipSlimChange(session, target.shipID, {
      refreshDirt: true,
    });
    return {
      success: true,
      message: `Set dirt for ${target.shipLabel} to ${formatRatio(dirtSetting.ratio)} (level ${formatLevel(dirtSetting.dirtLevel)}).${slimSuffix(broadcasted)}`,
    };
  }

  const target = resolveTargetShip(session, tokens.slice(1));
  if (!target.success) {
    return {
      success: false,
      message: "No target ship found for /dirt.",
    };
  }

  if (action === "status" || action === "show" || action === "") {
    const record = getShipDirtRecord(target.shipID, { createIfMissing: false });
    if (!record || !record.dirtTime) {
      return {
        success: true,
        message: `Dirt for ${target.shipLabel}: 0.00 clean.`,
      };
    }

    const status = calculateDirtStatus(record.dirtTime);
    return {
      success: true,
      message: status
        ? `Dirt for ${target.shipLabel}: ${formatRatio(status.ratio)} (level ${formatLevel(status.dirtLevel)}).`
        : `Dirt for ${target.shipLabel}: stored timestamp ${record.dirtTime}.`,
    };
  }

  if (action === "clear" || action === "clean") {
    const result = clearShipDirtTimestamp(target.shipID, "gm_dirt_clear");
    if (!result.success) {
      return {
        success: false,
        message: `Failed to clear dirt for ${target.shipLabel}.`,
      };
    }
    const broadcasted = broadcastShipSlimChange(session, target.shipID, {
      refreshDirt: true,
    });
    return {
      success: true,
      message: `Cleared dirt for ${target.shipLabel}.${slimSuffix(broadcasted)}`,
    };
  }

  return {
    success: false,
    message: "Usage: /dirt <0.0-1.0> [shipID], /dirt status [shipID], or /dirt clear [shipID]",
  };
}

function handleShipKillmarksCommand(session, argumentText = "") {
  const tokens = tokenize(argumentText);
  const action = String(tokens[0] || "status").trim().toLowerCase();

  if (action === "help") {
    return {
      success: true,
      message: `Usage: /killmarks <count 0-${MAX_DISPLAYED_KILLMARKS}> [shipID], /killmarks status [shipID], or /killmarks clear [shipID]`,
    };
  }

  const directCount = parseKillmarkCount(tokens[0]);
  if (directCount !== null) {
    const target = resolveTargetShip(session, tokens.slice(1));
    if (!target.success) {
      return {
        success: false,
        message: "No target ship found for /killmarks.",
      };
    }

    const currentRecord = readShipCounterRecord(target.shipID);
    const record =
      directCount === 0
        ? null
        : setShipKillCounter(target.shipID, {
            playerKills: directCount,
            npcKills: currentRecord.npcKills,
            lastAward: currentRecord.lastAward || null,
          });
    if (directCount === 0) {
      const clearResult = clearShipKillCounter(target.shipID, "gm_killmarks_zero");
      if (!clearResult.success) {
        return {
          success: false,
          message: `Failed to clear killmarks for ${target.shipLabel}.`,
        };
      }
    } else if (!record) {
      return {
        success: false,
        message: `Failed to set killmarks for ${target.shipLabel}.`,
      };
    }

    const broadcasted = broadcastShipSlimChange(session, target.shipID, {
      refreshKills: true,
    });
    return {
      success: true,
      message: `Set killmarks for ${target.shipLabel} to ${directCount}.${slimSuffix(broadcasted)}`,
    };
  }

  const target = resolveTargetShip(session, tokens.slice(1));
  if (!target.success) {
    return {
      success: false,
      message: "No target ship found for /killmarks.",
    };
  }

  if (action === "status" || action === "show" || action === "") {
    const record = readShipCounterRecord(target.shipID);
    return {
      success: true,
      message: `Killmarks for ${target.shipLabel}: ${record.playerKills}.`,
    };
  }

  if (action === "clear" || action === "reset") {
    const result = clearShipKillCounter(target.shipID, "gm_killmarks_clear");
    if (!result.success) {
      return {
        success: false,
        message: `Failed to clear killmarks for ${target.shipLabel}.`,
      };
    }
    const broadcasted = broadcastShipSlimChange(session, target.shipID, {
      refreshKills: true,
    });
    return {
      success: true,
      message: `Cleared killmarks for ${target.shipLabel}.${slimSuffix(broadcasted)}`,
    };
  }

  return {
    success: false,
    message: `Usage: /killmarks <count 0-${MAX_DISPLAYED_KILLMARKS}> [shipID], /killmarks status [shipID], or /killmarks clear [shipID]`,
  };
}

module.exports = {
  _testing: {
    buildFiletimeForDirtRatio,
    calculateDirtStatus,
    parseDirtRatio,
    parseKillmarkCount,
  },
  handleShipDirtCommand,
  handleShipKillmarksCommand,
};
