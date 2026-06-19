const path = require("path");

const worldData = require(path.join(__dirname, "../../../space/worldData"));
const spaceRuntime = require(path.join(__dirname, "../../../space/runtime"));
const {
  resolveSolarSystemByName,
} = require(path.join(__dirname, "../solarSystemRegistry"));
const wormholeRuntime = require(path.join(
  __dirname,
  "../../exploration/wormholes/wormholeRuntime",
));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getCurrentSystemID(session) {
  return Number(
    session &&
    (
      session.solarsystemid2 ||
      session.solarsystemid ||
      (session._space && session._space.systemID) ||
      0
    ),
  ) || 0;
}

function formatSystemName(systemID) {
  const system = worldData.getSolarSystemByID(systemID);
  return system && system.solarSystemName
    ? system.solarSystemName
    : `System ${systemID}`;
}

function formatMass(value) {
  const numeric = Math.max(0, Number(value) || 0);
  if (numeric >= 1_000_000_000) {
    return `${(numeric / 1_000_000_000).toFixed(2)}B`;
  }
  if (numeric >= 1_000_000) {
    return `${(numeric / 1_000_000).toFixed(2)}M`;
  }
  return `${numeric}`;
}

function formatLifetimeRemaining(expiresAtMs) {
  const remainingMs = Math.max(0, toInt(expiresAtMs, 0) - Date.now());
  const totalMinutes = Math.round(remainingMs / 60000);
  if (totalMinutes >= 120) {
    return `${Math.round(totalMinutes / 60)}h`;
  }
  return `${totalMinutes}m`;
}

function resolveSystemID(session, token, allowAll = false) {
  const trimmed = String(token || "").trim();
  if (!trimmed || trimmed.toLowerCase() === "here" || trimmed.toLowerCase() === "current") {
    const currentSystemID = getCurrentSystemID(session);
    return currentSystemID > 0
      ? { success: true, systemID: currentSystemID }
      : { success: false, errorMsg: "SYSTEM_NOT_SELECTED" };
  }
  if (allowAll && trimmed.toLowerCase() === "all") {
    return { success: true, systemID: 0, all: true };
  }
  const resolved = resolveSolarSystemByName(trimmed);
  if (!resolved.success || !resolved.match) {
    return {
      success: false,
      errorMsg: resolved.errorMsg || "SOLAR_SYSTEM_NOT_FOUND",
      suggestions: resolved.suggestions || [],
    };
  }
  return {
    success: true,
    systemID: Number(resolved.match.solarSystemID) || 0,
  };
}

function renderPairLine(entry) {
  return [
    `${entry.sourceSystemName} [${entry.sourceEndpointID}] ${entry.sourceCode}`,
    `-> ${entry.destinationSystemName} [${entry.destinationEndpointID}] ${entry.destinationCode}`,
    `class ${entry.destinationClassLabel || entry.destinationClassID}`,
    `env ${entry.destinationEnvironmentFamily || "-"}`,
    `life ${formatLifetimeRemaining(entry.expiresAtMs)} (${entry.ageLabel || "New"})`,
    `mass ${formatMass(entry.remainingMass)}/${formatMass(entry.totalMass)}`,
    `stability ${entry.stabilityLabel || "-"}`,
    `jump ${entry.maxShipJumpMassLabel || "-"}`,
    `regen ${formatMass(entry.massRegeneration)}/day`,
    `dest ${entry.destinationVisibilityState || (entry.destinationDiscovered ? "revealed" : "hidden")}`,
    `${entry.kind}/${entry.state}`,
  ].join(" | ");
}

function buildSystemSummaryEntries(entries) {
  const summariesBySystemID = new Map();
  for (const entry of entries) {
    const touchpoints = [
      {
        systemID: entry.sourceSystemID,
        systemName: entry.sourceSystemName,
        code: entry.sourceCode,
        discovered: entry.sourceDiscovered === true,
      },
      {
        systemID: entry.destinationSystemID,
        systemName: entry.destinationSystemName,
        code: entry.destinationCode,
        discovered: entry.destinationDiscovered === true,
      },
    ];
    for (const touchpoint of touchpoints) {
      const systemID = toInt(touchpoint.systemID, 0);
      if (systemID <= 0) {
        continue;
      }
      const existing = summariesBySystemID.get(systemID) || {
        systemID,
        systemName: touchpoint.systemName || formatSystemName(systemID),
        activePairCount: 0,
        staticPairCount: 0,
        randomPairCount: 0,
        discoveredEndpointCount: 0,
        hiddenEndpointCount: 0,
        environmentFamily:
          (wormholeRuntime.buildSystemSummaryViews({
            systemID,
            includeCollapsed: false,
            includeUndiscovered: true,
          })[0] || {}).environmentFamily || null,
        environmentEffectTypeName:
          (wormholeRuntime.buildSystemSummaryViews({
            systemID,
            includeCollapsed: false,
            includeUndiscovered: true,
          })[0] || {}).environmentEffectTypeName || null,
        codes: new Set(),
        pairIDs: new Set(),
      };
      if (!existing.pairIDs.has(entry.pairID)) {
        existing.pairIDs.add(entry.pairID);
        existing.activePairCount += 1;
        if (entry.kind === "static") {
          existing.staticPairCount += 1;
        } else if (entry.kind === "random") {
          existing.randomPairCount += 1;
        }
      }
      if (touchpoint.code) {
        existing.codes.add(String(touchpoint.code).trim().toUpperCase());
      }
      if (touchpoint.discovered === true) {
        existing.discoveredEndpointCount += 1;
      } else {
        existing.hiddenEndpointCount += 1;
      }
      summariesBySystemID.set(systemID, existing);
    }
  }

  return [...summariesBySystemID.values()]
    .map((entry) => ({
      ...entry,
      codes: [...entry.codes].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.systemName.localeCompare(right.systemName));
}

function renderSystemSummaryLine(entry) {
  return [
    `${entry.systemName} (${entry.systemID})`,
    `${entry.activePairCount} pair${entry.activePairCount === 1 ? "" : "s"}`,
    `static ${entry.staticPairCount}`,
    `random ${entry.randomPairCount}`,
    `discovered ${entry.discoveredEndpointCount}`,
    `hidden ${entry.hiddenEndpointCount}`,
    `env ${entry.environmentFamily || "-"}`,
    `codes ${entry.codes.join(",") || "-"}`,
  ].join(" | ");
}

function buildStatusMessage(session, token) {
  const target = resolveSystemID(session, token, true);
  if (!target.success) {
    return {
      success: false,
      message: "Solar system not found.",
    };
  }
  if (target.all) {
    wormholeRuntime.ensureUniverseStatics(Date.now());
  } else if (target.systemID > 0) {
    wormholeRuntime.ensureSystemStatics(target.systemID, Date.now());
  }
  const entries = wormholeRuntime.listPairViews({
    systemID: target.systemID,
    includeCollapsed: false,
    includeUndiscovered: true,
  });
  if (entries.length <= 0) {
    return {
      success: true,
      message: target.all
        ? "No active wormholes are currently tracked."
        : `No active wormholes are currently tracked for ${formatSystemName(target.systemID)}.`,
    };
  }
  const header = target.all
    ? `Tracked wormholes (${entries.length}):`
    : `Tracked wormholes for ${formatSystemName(target.systemID)} (${entries.length}):`;
  return {
    success: true,
    message: [header, ...entries.map(renderPairLine)].join("\n"),
  };
}

function buildSystemsMessage(session, token) {
  const target = resolveSystemID(session, token, true);
  if (!target.success) {
    return {
      success: false,
      message: "Solar system not found.",
    };
  }
  if (target.all) {
    wormholeRuntime.ensureUniverseStatics(Date.now());
  } else if (target.systemID > 0) {
    wormholeRuntime.ensureSystemStatics(target.systemID, Date.now());
  }
  const entries = wormholeRuntime.listPairViews({
    systemID: target.systemID,
    includeCollapsed: false,
    includeUndiscovered: true,
  });
  const summaries = wormholeRuntime.buildSystemSummaryViews({
    systemID: target.systemID,
    includeCollapsed: false,
    includeUndiscovered: true,
  });
  if (summaries.length <= 0) {
    return {
      success: true,
      message: target.all
        ? "No systems currently have tracked wormholes."
        : `No tracked wormholes are currently present for ${formatSystemName(target.systemID)}.`,
    };
  }
  const header = target.all
    ? `Systems with tracked wormholes (${summaries.length}):`
    : `Tracked wormhole system summary for ${formatSystemName(target.systemID)}:`;
  return {
    success: true,
    message: [header, ...summaries.map(renderSystemSummaryLine)].join("\n"),
  };
}

function executeWormholeCommand(session, commandName, argumentText = "") {
  const command = String(commandName || "").trim().toLowerCase();
  const trimmed = String(argumentText || "").trim();
  const parts = trimmed ? trimmed.split(/\s+/) : [];

  if (parts[0] === "systems" || parts[0] === "summary") {
    return buildSystemsMessage(session, parts.slice(1).join(" "));
  }

  if (command === "wormholes" || (!parts[0] || parts[0] === "status" || parts[0] === "list")) {
    return buildStatusMessage(session, parts.slice(command === "wormholes" ? 0 : 1).join(" "));
  }

  const verb = String(parts[0] || "").trim().toLowerCase();
  if (verb === "ensure") {
    const resolved = resolveSystemID(session, parts.slice(1).join(" "), true);
    if (!resolved.success || (!resolved.all && resolved.systemID <= 0)) {
      return {
        success: false,
        message: "Usage: /wormhole ensure [system|here|all]",
      };
    }
    if (resolved.all) {
      const ensureAllResult = wormholeRuntime.ensureUniverseStatics(Date.now());
      if (!ensureAllResult.success) {
        return {
          success: false,
          message: "Failed to ensure tracked wormholes for the universe.",
        };
      }
      if (spaceRuntime && spaceRuntime.scenes instanceof Map) {
        for (const scene of spaceRuntime.scenes.values()) {
          wormholeRuntime.syncSceneEntities(scene, Date.now());
        }
      }
      return {
        success: true,
        message: `Ensured wormhole statics across ${wormholeRuntime.listPairViews({
          includeCollapsed: false,
          includeUndiscovered: true,
        }).length} tracked connection(s).`,
      };
    }
    const ensureResult = wormholeRuntime.ensureSystemStatics(resolved.systemID, Date.now());
    if (!ensureResult.success) {
      return {
        success: false,
        message: `Failed to ensure wormholes for ${formatSystemName(resolved.systemID)}.`,
      };
    }
    const scene = spaceRuntime.ensureScene(resolved.systemID);
    if (scene) {
      wormholeRuntime.syncSceneEntities(scene, Date.now());
    }
    return {
      success: true,
      message: `Ensured wormhole statics for ${formatSystemName(resolved.systemID)}.`,
    };
  }

  if (verb === "random") {
    const count = Math.max(1, toInt(parts[1], 1));
    const resolved = resolveSystemID(session, parts.slice(2).join(" "));
    if (!resolved.success || resolved.systemID <= 0) {
      return {
        success: false,
        message: "Usage: /wormhole random [count] [system|here]",
      };
    }
    const created = wormholeRuntime.spawnRandomPairs(resolved.systemID, count, Date.now());
    const scene = spaceRuntime.ensureScene(resolved.systemID);
    if (scene) {
      wormholeRuntime.syncSceneEntities(scene, Date.now());
    }
    return {
      success: true,
      message: created.length > 0
        ? [
            `Spawned ${created.length} random wormhole connection(s) in ${formatSystemName(resolved.systemID)}:`,
            ...created.map((pair) => renderPairLine({
              pairID: pair.pairID,
              sourceSystemName: formatSystemName(pair.source.systemID),
              sourceEndpointID: pair.source.endpointID,
              sourceCode: pair.source.code,
              destinationSystemName: formatSystemName(pair.destination.systemID),
              destinationEndpointID: pair.destination.endpointID,
              destinationCode: pair.destination.code,
              destinationClassID: pair.destination.wormholeClassID,
              expiresAtMs: pair.expiresAtMs,
              remainingMass: pair.remainingMass,
              totalMass: pair.totalMass,
              destinationDiscovered: pair.destination.discovered === true,
              kind: pair.kind,
              state: pair.state,
            })),
          ].join("\n")
        : `No wormholes could be spawned in ${formatSystemName(resolved.systemID)}.`,
    };
  }

  if (verb === "clear") {
    const resolved = resolveSystemID(session, parts.slice(1).join(" "), true);
    if (!resolved.success) {
      return {
        success: false,
        message: "Usage: /wormhole clear [system|here|all]",
      };
    }
    wormholeRuntime.clearPairs(resolved.systemID, Date.now());
    if (resolved.all) {
      if (spaceRuntime && spaceRuntime.scenes instanceof Map) {
        for (const scene of spaceRuntime.scenes.values()) {
          wormholeRuntime.syncSceneEntities(scene, Date.now());
        }
      }
      return {
        success: true,
        message: "Cleared all tracked wormhole connections.",
      };
    }
    const scene = spaceRuntime.ensureScene(resolved.systemID);
    if (scene) {
      wormholeRuntime.syncSceneEntities(scene, Date.now());
    }
    return {
      success: true,
      message: `Cleared tracked wormholes for ${formatSystemName(resolved.systemID)}.`,
    };
  }

  return {
    success: true,
    message: [
      "/wormholes [here|all|system]",
      "/wormholes systems [all|here|system]",
      "/wormhole status [here|all|system]",
      "/wormhole ensure [here|system|all]",
      "/wormhole random [count] [here|system]",
      "/wormhole clear [here|all|system]",
    ].join("\n"),
  };
}

module.exports = {
  executeWormholeCommand,
};
