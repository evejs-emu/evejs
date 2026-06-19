const path = require("path");

const worldData = require(path.join(__dirname, "../../space/worldData"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const structureState = require(path.join(__dirname, "./structureState"));
const structureAssetSafetyState = require(path.join(__dirname, "./structureAssetSafetyState"));
const structureTetherRestrictionState = require(path.join(
  __dirname,
  "./structureTetherRestrictionState",
));
const {
  STRUCTURE_SERVICE_NAME_BY_ID,
  STRUCTURE_SERVICE_STATE,
  STRUCTURE_STATE_NAME_BY_ID,
  STRUCTURE_UPKEEP_NAME_BY_ID,
} = require(path.join(__dirname, "./structureConstants"));
const {
  getSessionStructureID,
} = require(path.join(__dirname, "./structureLocation"));

function normalizeInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizePositiveInt(value, fallback = 0) {
  const numeric = normalizeInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function getCurrentSolarSystemID(session) {
  return normalizePositiveInt(
    session &&
      (
        (session._space && session._space.systemID) ||
        session.solarsystemid2 ||
        session.solarsystemid
      ),
    0,
  );
}

function getSeedPosition(session) {
  const entity = spaceRuntime.getEntity(
    session,
    session && session._space ? session._space.shipID : null,
  );
  const solarSystemID = getCurrentSolarSystemID(session);
  const seededStructureCount = solarSystemID > 0
    ? structureState.listStructuresForSystem(solarSystemID, {
      includeDestroyed: true,
      refresh: false,
    }).filter((structure) => !structure.destroyedAt).length
    : 0;
  const spokeCount = 6;
  const ringIndex = Math.floor(seededStructureCount / spokeCount);
  const spokeIndex = seededStructureCount % spokeCount;
  const ringDistance = 120000 + (ringIndex * 60000);
  const angleRadians = ((Math.PI * 2) / spokeCount) * spokeIndex;
  const offsetX = Math.cos(angleRadians) * ringDistance;
  const offsetZ = Math.sin(angleRadians) * ringDistance;

  if (entity && entity.position) {
    return {
      x: Number(entity.position.x || 0) + offsetX,
      y: Number(entity.position.y || 0),
      z: Number(entity.position.z || 0) + offsetZ,
    };
  }

  return {
    x: 100000 + offsetX,
    y: 0,
    z: 100000 + offsetZ,
  };
}

function formatStructureSummary(structure) {
  const stateName = STRUCTURE_STATE_NAME_BY_ID[normalizeInt(structure && structure.state, 0)] || "unknown";
  const upkeepName = STRUCTURE_UPKEEP_NAME_BY_ID[normalizeInt(structure && structure.upkeepState, 0)] || "unknown";
  return [
    `${structure.itemName || structure.name || `Structure ${structure.structureID}`}(${structure.structureID})`,
    `type=${structure.typeID}`,
    `state=${stateName}`,
    `upkeep=${upkeepName}`,
    `core=${structure.hasQuantumCore === true ? "installed" : "missing"}`,
    `system=${structure.solarSystemID}`,
  ].join(" | ");
}

function syncStructureRuntime(structureOrSystemID) {
  const systemID =
    typeof structureOrSystemID === "object" && structureOrSystemID !== null
      ? normalizePositiveInt(structureOrSystemID.solarSystemID, 0)
      : normalizePositiveInt(structureOrSystemID, 0);
  if (!systemID) {
    return;
  }
  if (typeof spaceRuntime.syncStructureSceneState === "function") {
    spaceRuntime.syncStructureSceneState(systemID);
  }
}

function syncStructureRuntimeSystems(systemIDs) {
  const uniqueSystemIDs = [...new Set(
    []
      .concat(Array.isArray(systemIDs) ? systemIDs : [systemIDs])
      .map((systemID) => normalizePositiveInt(systemID, 0))
      .filter((systemID) => systemID > 0),
  )];
  for (const systemID of uniqueSystemIDs) {
    syncStructureRuntime(systemID);
  }
}

function resolveStructureToken(session, token) {
  const trimmed = String(token || "").trim();
  if (!trimmed || trimmed.toLowerCase() === "here" || trimmed.toLowerCase() === "current") {
    const sessionStructureID = getSessionStructureID(session);
    if (sessionStructureID > 0) {
      return structureState.getStructureByID(sessionStructureID);
    }
    return null;
  }

  const numericID = normalizePositiveInt(trimmed, 0);
  if (numericID > 0) {
    return structureState.getStructureByID(numericID);
  }

  return structureState.getStructureByName(trimmed);
}

function resolveServiceID(token) {
  const numericID = normalizePositiveInt(token, 0);
  if (numericID > 0) {
    return numericID;
  }

  const normalized = String(token || "").trim().toLowerCase();
  if (!normalized) {
    return 0;
  }

  const match = Object.entries(STRUCTURE_SERVICE_NAME_BY_ID).find(([, name]) => (
    normalized === name || normalized === String(name).replace(/^service_/, "")
  ));
  return match ? Number(match[0]) || 0 : 0;
}

function listStructuresMessage(session, includeAll = false) {
  const solarSystemID = getCurrentSolarSystemID(session);
  const structures = includeAll
    ? structureState.listStructures({
        includeDestroyed: true,
      })
    : structureState.listStructuresForSystem(solarSystemID, {
        includeDestroyed: true,
      });

  if (structures.length === 0) {
    return includeAll
      ? "No structures are currently persisted."
      : `No structures are currently persisted in solar system ${solarSystemID || "unknown"}.`;
  }

  return structures.map((structure) => formatStructureSummary(structure)).join("\n");
}

function buildHelpText() {
  return [
    "/upwell help",
    "/upwell list [all]",
    "/upwell info <structureID|name|here>",
    "/upwell seed <astrahus|fortizar|keepstar|...> [name]",
    "/upwell anchor <structureID|name|here>",
    "/upwell core <structureID|name|here> <on|off>",
    "/upwell ff <structureID|name|here> <seconds>",
    "/upwell repair <structureID|name|here>",
    "/upwell state <structureID|name|here> <state>",
    "/upwell upkeep <structureID|name|here> <full_power|low_power|abandoned>",
    "/upwell service <structureID|name|here> <serviceID|serviceName> <online|offline>",
    "/upwell damage <structureID|name|here> <shield|armor|hull|kill> [amount]",
    "/upwell kill <structureID|name|here>",
    "/upwell timer <structureID|name|here> <scale>",
    "/upwell tether <status|clear|scram|cyno|fighters|fw|delay> [value]",
    "/upwell remove <structureID|name|here>",
    "/upwell purge [all]",
    "/upwell safety <structureID|name|here> [char|corp]",
    "/upwell wraps [char|corp]",
    "/upwell deliver <wrapID> [destinationID]",
  ].join("\n");
}

function buildStructureGmHelpText() {
  return [
    "/structure state <structureID> <stateID|stateName>",
    "/structure timer <structureID> <seconds>",
    "/structure deploytimer <structureID> <seconds>",
    "/structure unanchor <structureID> [cancel|seconds]",
    "/structure abandontimer <structureID> <seconds>",
  ].join("\n");
}

function parseNonNegativeSeconds(token) {
  const seconds = Number(token);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function executeStructureGmCommand(session, argumentText) {
  const trimmed = String(argumentText || "").trim();
  const [subcommandRaw, structureToken, valueToken] = trimmed.split(/\s+/).filter(Boolean);
  const subcommand = String(subcommandRaw || "help").trim().toLowerCase();

  if (subcommand === "help" || subcommand === "?" || subcommand === "commands") {
    return {
      success: true,
      message: buildStructureGmHelpText(),
    };
  }

  const structure = resolveStructureToken(session, structureToken);
  if (!structure) {
    return {
      success: false,
      message: "Structure not found. Usage:\n" + buildStructureGmHelpText(),
    };
  }

  if (subcommand === "state") {
    if (!valueToken) {
      return {
        success: false,
        message: "Usage: /structure state <structureID> <stateID|stateName>",
      };
    }
    const result = structureState.setStructureState(structure.structureID, valueToken, {
      clearTimer: true,
    });
    if (!result.success) {
      return {
        success: false,
        message: `Failed to set structure state: ${result.errorMsg}.`,
      };
    }
    syncStructureRuntime(result.data);
    return {
      success: true,
      message: `GM set structure state=${STRUCTURE_STATE_NAME_BY_ID[result.data.state] || result.data.state} for ${formatStructureSummary(result.data)}.`,
    };
  }

  if (subcommand === "timer") {
    const seconds = parseNonNegativeSeconds(valueToken);
    if (seconds === null) {
      return {
        success: false,
        message: "Usage: /structure timer <structureID> <seconds>",
      };
    }
    const result = structureState.setStructureStateTimerRemaining(
      structure.structureID,
      seconds,
    );
    if (!result.success) {
      return {
        success: false,
        message: `Failed to set structure timer: ${result.errorMsg}.`,
      };
    }
    structureState.tickStructures(Date.now());
    syncStructureRuntime(result.data);
    return {
      success: true,
      message: `GM set structure state timer to ${seconds}s for ${formatStructureSummary(structureState.getStructureByID(structure.structureID, { refresh: false }) || result.data)}.`,
    };
  }

  if (subcommand === "deploytimer") {
    const seconds = parseNonNegativeSeconds(valueToken);
    if (seconds === null) {
      return {
        success: false,
        message: "Usage: /structure deploytimer <structureID> <seconds>",
      };
    }
    const result = structureState.setStructureDeployTimerRemaining(
      structure.structureID,
      seconds,
    );
    if (!result.success) {
      return {
        success: false,
        message: `Failed to set deploy timer: ${result.errorMsg}.`,
      };
    }
    structureState.tickStructures(Date.now());
    syncStructureRuntime(result.data);
    return {
      success: true,
      message: `GM set deploy timer to ${seconds}s for ${formatStructureSummary(structureState.getStructureByID(structure.structureID, { refresh: false }) || result.data)}.`,
    };
  }

  if (subcommand === "unanchor") {
    const action = String(valueToken || "").trim().toLowerCase();
    if (action === "cancel") {
      const result = structureState.cancelStructureUnanchoring(structure.structureID);
      if (!result.success) {
        return {
          success: false,
          message: `Failed to cancel structure unanchoring: ${result.errorMsg}.`,
        };
      }
      syncStructureRuntime(result.data);
      return {
        success: true,
        message: `GM cancelled unanchoring for ${formatStructureSummary(result.data)}.`,
      };
    }

    const seconds = action ? parseNonNegativeSeconds(action) : null;
    if (action && seconds === null) {
      return {
        success: false,
        message: "Usage: /structure unanchor <structureID> [cancel|seconds]",
      };
    }
    const result = seconds === null
      ? structureState.startStructureUnanchoring(structure.structureID)
      : structureState.setStructureUnanchoringRemaining(structure.structureID, seconds);
    if (!result.success) {
      return {
        success: false,
        message: `Failed to set structure unanchoring: ${result.errorMsg}.`,
      };
    }
    structureState.tickStructures(Date.now());
    syncStructureRuntime(result.data);
    return {
      success: true,
      message: seconds === null
        ? `GM started unanchoring for ${formatStructureSummary(result.data)}.`
        : `GM set unanchoring timer to ${seconds}s for ${formatStructureSummary(structureState.getStructureByID(structure.structureID, { refresh: false }) || result.data)}.`,
    };
  }

  if (subcommand === "abandontimer") {
    const seconds = parseNonNegativeSeconds(valueToken);
    if (seconds === null) {
      return {
        success: false,
        message: "Usage: /structure abandontimer <structureID> <seconds>",
      };
    }
    const result = structureState.setStructureAbandonTimerRemaining(
      structure.structureID,
      seconds,
    );
    if (!result.success) {
      return {
        success: false,
        message: `Failed to set abandon timer: ${result.errorMsg}.`,
      };
    }
    structureState.tickStructures(Date.now());
    syncStructureRuntime(result.data);
    return {
      success: true,
      message: `GM set abandon timer to ${seconds}s for ${formatStructureSummary(structureState.getStructureByID(structure.structureID, { refresh: false }) || result.data)}.`,
    };
  }

  return {
    success: false,
    message: `Unknown /structure subcommand '${subcommand}'. Usage:\n${buildStructureGmHelpText()}`,
  };
}

function formatTetherRestrictionState(characterID, nowMs = Date.now()) {
  const state = structureTetherRestrictionState.describeCharacterTetherRestrictions(
    characterID,
    nowMs,
  );
  return [
    `character=${characterID}`,
    `scram=${state.warpScrambled ? "on" : "off"}`,
    `cyno=${state.cynoActive ? "on" : "off"}`,
    `fighters=${state.fightersLaunched ? "on" : "off"}`,
    `fw=${state.factionalWarfareBlocked ? "on" : "off"}`,
    `delayMs=${state.tetherDelayRemainingMs || 0}`,
  ].join(" | ");
}

function executeUpwellCommand(session, argumentText) {
  const trimmed = String(argumentText || "").trim();
  const [subcommandRaw, ...rest] = trimmed.split(/\s+/).filter(Boolean);
  const subcommand = String(subcommandRaw || "help").trim().toLowerCase();

  if (subcommand === "help" || subcommand === "?" || subcommand === "commands") {
    return {
      success: true,
      message: buildHelpText(),
    };
  }

  if (subcommand === "list") {
    return {
      success: true,
      message: listStructuresMessage(session, String(rest[0] || "").trim().toLowerCase() === "all"),
    };
  }

  if (subcommand === "purge") {
    const scopeToken = String(rest[0] || "").trim().toLowerCase();
    const solarSystemID = getCurrentSolarSystemID(session);
    const structures = scopeToken === "all"
      ? structureState.listStructures({
          includeDestroyed: true,
        })
      : structureState.listStructuresForSystem(solarSystemID, {
          includeDestroyed: true,
        });
    if (structures.length === 0) {
      return {
        success: true,
        message: scopeToken === "all"
          ? "No persisted structures were found to purge."
          : `No persisted structures were found in solar system ${solarSystemID || "unknown"}.`,
      };
    }

    const affectedSystemIDs = new Set();
    let removedCount = 0;
    for (const structure of structures) {
      const removeResult = structureState.removeStructure(structure.structureID);
      if (!removeResult.success) {
        return {
          success: false,
          message: `Failed to purge ${structure.itemName || structure.name || structure.structureID}: ${removeResult.errorMsg}.`,
        };
      }
      affectedSystemIDs.add(normalizePositiveInt(structure.solarSystemID, 0));
      removedCount += 1;
    }

    syncStructureRuntimeSystems([...affectedSystemIDs]);
    return {
      success: true,
      message: scopeToken === "all"
        ? `Purged ${removedCount} persisted structure${removedCount === 1 ? "" : "s"} across ${affectedSystemIDs.size} solar system${affectedSystemIDs.size === 1 ? "" : "s"}.`
        : `Purged ${removedCount} persisted structure${removedCount === 1 ? "" : "s"} from solar system ${solarSystemID || "unknown"}.`,
    };
  }

  if (subcommand === "seed") {
    const typeToken = rest[0];
    if (!typeToken) {
      return {
        success: false,
        message: "Usage: /upwell seed <astrahus|fortizar|keepstar|...> [name]",
      };
    }

    const result = structureState.seedStructureForSession(session, typeToken, {
      solarSystemID: getCurrentSolarSystemID(session) || 30000142,
      position: getSeedPosition(session),
      name: rest.slice(1).join(" ").trim() || undefined,
    });
    if (!result.success) {
      return {
        success: false,
        message: `Failed to seed structure: ${result.errorMsg}.`,
      };
    }

    syncStructureRuntime(result.data);
    return {
      success: true,
      message: `Seeded ${formatStructureSummary(result.data)}.`,
    };
  }

  if (subcommand === "wraps") {
    const ownerKind = String(rest[0] || "char").trim().toLowerCase() === "corp" ? "corp" : "char";
    const ownerID = ownerKind === "corp"
      ? normalizePositiveInt(session && (session.corporationID || session.corpid), 0)
      : normalizePositiveInt(session && (session.characterID || session.charid || session.userid), 0);
    const wraps = structureAssetSafetyState.listWrapsForOwner(ownerKind, ownerID);
    if (wraps.length === 0) {
      return {
        success: true,
        message: ownerKind === "corp" ? "No corporation asset safety wraps found." : "No personal asset safety wraps found.",
      };
    }
    return {
      success: true,
      message: wraps.map((wrap) => (
        `${wrap.wrapName}(${wrap.assetWrapID}) | owner=${wrap.ownerKind}:${wrap.ownerID} | source=${wrap.sourceStructureID} | delivered=${wrap.deliveredAt ? "yes" : "no"}`
      )).join("\n"),
    };
  }

  if (subcommand === "deliver") {
    const wrapID = normalizePositiveInt(rest[0], 0);
    if (!wrapID) {
      return {
        success: false,
        message: "Usage: /upwell deliver <wrapID> [destinationID]",
      };
    }
    const destinationID = normalizePositiveInt(rest[1], 0);
    const deliverResult = structureAssetSafetyState.deliverWrapToDestination(
      wrapID,
      destinationID,
      {
        session,
      },
    );
    if (!deliverResult.success) {
      return {
        success: false,
        message: `Asset safety delivery failed: ${deliverResult.errorMsg}.`,
      };
    }
    return {
      success: true,
      message: `Delivered wrap ${wrapID} to ${deliverResult.data.destinationKind || "destination"} ${deliverResult.data.destinationID}.`,
    };
  }

  if (subcommand === "tether") {
    const characterID = normalizePositiveInt(
      session && (session.characterID || session.charid || session.userid),
      0,
    );
    const tetherAction = String(rest[0] || "status").trim().toLowerCase();
    const booleanToken = String(rest[1] || "").trim().toLowerCase();
    const nowMs =
      session &&
      session._space &&
      Number.isFinite(Number(session._space.simTimeMs))
        ? Number(session._space.simTimeMs)
        : Date.now();
    const parseToggle = () => {
      if (["on", "true", "1", "yes"].includes(booleanToken)) {
        return true;
      }
      if (["off", "false", "0", "no"].includes(booleanToken)) {
        return false;
      }
      return null;
    };

    if (!characterID) {
      return {
        success: false,
        message: "No active character is available for /upwell tether commands.",
      };
    }

    if (tetherAction === "status" || tetherAction === "info") {
      return {
        success: true,
        message: formatTetherRestrictionState(characterID, nowMs),
      };
    }

    if (tetherAction === "clear" || tetherAction === "reset") {
      const clearResult = structureTetherRestrictionState.clearCharacterTetherRestrictions(
        characterID,
        {
          nowMs,
        },
      );
      return {
        success: clearResult.success,
        message: clearResult.success
          ? `Cleared tether restrictions for ${formatTetherRestrictionState(characterID, nowMs)}.`
          : `Failed to clear tether restrictions: ${clearResult.errorMsg}.`,
      };
    }

    if (["scram", "cyno", "fighters", "fw"].includes(tetherAction)) {
      const nextValue = parseToggle();
      if (nextValue === null) {
        return {
          success: false,
          message: "Usage: /upwell tether <scram|cyno|fighters|fw> <on|off>",
        };
      }
      const flagMap = {
        scram: { warpScrambled: nextValue },
        cyno: { cynoActive: nextValue },
        fighters: { fightersLaunched: nextValue },
        fw: { factionalWarfareBlocked: nextValue },
      };
      const result = structureTetherRestrictionState.setCharacterTetherRestrictionFlags(
        characterID,
        flagMap[tetherAction],
        {
          nowMs,
        },
      );
      return {
        success: result.success,
        message: result.success
          ? `Updated tether restrictions: ${formatTetherRestrictionState(characterID, nowMs)}.`
          : `Failed to update tether restrictions: ${result.errorMsg}.`,
      };
    }

    if (tetherAction === "delay") {
      const seconds = Number(rest[1]);
      if (!Number.isFinite(seconds) || seconds < 0) {
        return {
          success: false,
          message: "Usage: /upwell tether delay <seconds>",
        };
      }
      const result = structureTetherRestrictionState.setCharacterTetherDelay(
        characterID,
        Math.round(seconds * 1000),
        {
          nowMs,
        },
      );
      return {
        success: result.success,
        message: result.success
          ? `Updated tether restrictions: ${formatTetherRestrictionState(characterID, nowMs)}.`
          : `Failed to update tether delay: ${result.errorMsg}.`,
      };
    }

    return {
      success: false,
      message: "Usage: /upwell tether <status|clear|scram|cyno|fighters|fw|delay> [value]",
    };
  }

  const structure = resolveStructureToken(session, rest[0]);
  if (!structure) {
    return {
      success: false,
      message: "Structure not found. Use /upwell list or provide a valid structure ID, name, or 'here'.",
    };
  }

  if (subcommand === "info") {
    const services = Object.entries(structure.serviceStates || {})
      .map(([serviceID, stateID]) => `${STRUCTURE_SERVICE_NAME_BY_ID[Number(serviceID) || 0] || serviceID}=${stateID}`)
      .join(", ");
    return {
      success: true,
      message: [
        formatStructureSummary(structure),
        `timers: started=${structure.stateStartedAt || "none"} ends=${structure.stateEndsAt || "none"}`,
        `services: ${services || "none"}`,
      ].join("\n"),
    };
  }

  if (subcommand === "anchor") {
    const result = structureState.startAnchoring(structure.structureID);
    if (!result.success) {
      return {
        success: false,
        message: `Failed to start anchoring: ${result.errorMsg}.`,
      };
    }
    syncStructureRuntime(result.data);
    return {
      success: true,
      message: `Anchoring started for ${formatStructureSummary(result.data)}.`,
    };
  }

  if (subcommand === "core") {
    const installed = String(rest[1] || "").trim().toLowerCase();
    if (!["on", "off", "true", "false", "1", "0"].includes(installed)) {
      return {
        success: false,
        message: "Usage: /upwell core <structureID|name|here> <on|off>",
      };
    }
    const result = structureState.setStructureQuantumCoreInstalled(
      structure.structureID,
      ["on", "true", "1"].includes(installed),
    );
    if (!result.success) {
      return {
        success: false,
        message: `Failed to set quantum core state: ${result.errorMsg}.`,
      };
    }
    syncStructureRuntime(result.data);
    return {
      success: true,
      message: `Quantum core ${result.data.hasQuantumCore ? "installed" : "removed"} for ${formatStructureSummary(result.data)}.`,
    };
  }

  if (subcommand === "ff") {
    const seconds = Number(rest[1]);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return {
        success: false,
        message: "Usage: /upwell ff <structureID|name|here> <seconds>",
      };
    }
    const result = structureState.fastForwardStructure(structure.structureID, seconds);
    if (!result.success) {
      return {
        success: false,
        message: `Failed to fast-forward structure timers: ${result.errorMsg}.`,
      };
    }
    structureState.tickStructures(Date.now());
    syncStructureRuntime(result.data);
    return {
      success: true,
      message: `Fast-forwarded ${seconds}s for ${formatStructureSummary(structureState.getStructureByID(structure.structureID))}.`,
    };
  }

  if (subcommand === "repair") {
    const result = structureState.repairStructure(structure.structureID);
    if (!result.success) {
      return {
        success: false,
        message: `Failed to repair structure: ${result.errorMsg}.`,
      };
    }
    syncStructureRuntime(result.data);
    return {
      success: true,
      message: `Repaired ${formatStructureSummary(result.data)}.`,
    };
  }

  if (subcommand === "state") {
    const stateToken = rest[1];
    if (!stateToken) {
      return {
        success: false,
        message: "Usage: /upwell state <structureID|name|here> <state>",
      };
    }
    const result = structureState.setStructureState(structure.structureID, stateToken, {
      clearTimer: String(rest[2] || "").trim().toLowerCase() === "clear",
    });
    if (!result.success) {
      return {
        success: false,
        message: `Failed to set structure state: ${result.errorMsg}.`,
      };
    }
    syncStructureRuntime(result.data);
    return {
      success: true,
      message: `Set state to ${(STRUCTURE_STATE_NAME_BY_ID[result.data.state] || result.data.state)} for ${formatStructureSummary(result.data)}.`,
    };
  }

  if (subcommand === "upkeep") {
    const upkeepToken = rest[1];
    if (!upkeepToken) {
      return {
        success: false,
        message: "Usage: /upwell upkeep <structureID|name|here> <full_power|low_power|abandoned>",
      };
    }
    const result = structureState.setStructureUpkeepState(structure.structureID, upkeepToken);
    if (!result.success) {
      return {
        success: false,
        message: `Failed to set upkeep state: ${result.errorMsg}.`,
      };
    }
    syncStructureRuntime(result.data);
    return {
      success: true,
      message: `Set upkeep to ${(STRUCTURE_UPKEEP_NAME_BY_ID[result.data.upkeepState] || result.data.upkeepState)} for ${formatStructureSummary(result.data)}.`,
    };
  }

  if (subcommand === "service") {
    const serviceID = resolveServiceID(rest[1]);
    const stateToken = String(rest[2] || "").trim().toLowerCase();
    if (!serviceID || !["online", "offline"].includes(stateToken)) {
      return {
        success: false,
        message: "Usage: /upwell service <structureID|name|here> <serviceID|serviceName> <online|offline>",
      };
    }
    const result = structureState.setStructureServiceState(
      structure.structureID,
      serviceID,
      stateToken === "online" ? STRUCTURE_SERVICE_STATE.ONLINE : STRUCTURE_SERVICE_STATE.OFFLINE,
    );
    if (!result.success) {
      return {
        success: false,
        message: `Failed to set service state: ${result.errorMsg}.`,
      };
    }
    syncStructureRuntime(result.data);
    return {
      success: true,
      message: `Set service ${STRUCTURE_SERVICE_NAME_BY_ID[serviceID] || serviceID} ${stateToken} for ${formatStructureSummary(result.data)}.`,
    };
  }

  if (subcommand === "damage") {
    const layerToken = String(rest[1] || "").trim().toLowerCase();
    const amount = rest[2] === undefined ? null : Number(rest[2]);
    if (!layerToken || (rest[2] !== undefined && !Number.isFinite(amount))) {
      return {
        success: false,
        message: "Usage: /upwell damage <structureID|name|here> <shield|armor|hull|kill> [amount]",
      };
    }
    const result = structureState.applyAdminStructureDamage(
      structure.structureID,
      layerToken,
      amount,
      {
        session,
      },
    );
    if (!result.success) {
      return {
        success: false,
        message: `Failed to apply GM structure damage: ${result.errorMsg}.`,
      };
    }
    syncStructureRuntime(structure);
    return {
      success: true,
      message: `Applied GM damage to ${formatStructureSummary(result.data.structure || structureState.getStructureByID(structure.structureID))}.`,
    };
  }

  if (subcommand === "kill") {
    const result = structureState.destroyStructure(structure.structureID, {
      session,
    });
    if (!result.success) {
      return {
        success: false,
        message: `Failed to destroy structure: ${result.errorMsg}.`,
      };
    }
    syncStructureRuntime(structure);
    return {
      success: true,
      message: `Destroyed ${structure.itemName || structure.name || structure.structureID}.`,
    };
  }

  if (subcommand === "timer") {
    const scale = Number(rest[1]);
    if (!Number.isFinite(scale) || scale <= 0) {
      return {
        success: false,
        message: "Usage: /upwell timer <structureID|name|here> <scale>",
      };
    }
    const result = structureState.setStructureTimerScale(structure.structureID, scale);
    if (!result.success) {
      return {
        success: false,
        message: `Failed to set timer scale: ${result.errorMsg}.`,
      };
    }
    return {
      success: true,
      message: `Set timer scale=${scale} for ${formatStructureSummary(result.data)}.`,
    };
  }

  if (subcommand === "remove") {
    const result = structureState.removeStructure(structure.structureID);
    if (!result.success) {
      return {
        success: false,
        message: `Failed to remove structure: ${result.errorMsg}.`,
      };
    }
    syncStructureRuntime(structure);
    return {
      success: true,
      message: `Removed structure ${structure.structureID}.`,
    };
  }

  if (subcommand === "safety") {
    const ownerKind = String(rest[1] || "char").trim().toLowerCase() === "corp" ? "corp" : "char";
    const result = ownerKind === "corp"
      ? structureAssetSafetyState.moveCorporationAssetsToSafety(
        session,
        structure.solarSystemID,
        structure.structureID,
        {},
      )
      : structureAssetSafetyState.movePersonalAssetsToSafety(
        session,
        structure.solarSystemID,
        structure.structureID,
        {},
      );
    if (!result.success) {
      return {
        success: false,
        message: `Asset safety move failed: ${result.errorMsg}.`,
      };
    }
    const createdWrap = result.data && result.data.createdWrap;
    return {
      success: true,
      message: createdWrap
        ? `Moved ${ownerKind === "corp" ? "corporation" : "personal"} assets into wrap ${createdWrap.wrapName}(${createdWrap.assetWrapID}).`
        : `No ${ownerKind === "corp" ? "corporation" : "personal"} assets were present in ${structure.itemName || structure.name || structure.structureID}.`,
    };
  }

  return {
    success: false,
    message: `Unknown /upwell subcommand '${subcommand}'. Use /upwell help.`,
  };
}

module.exports = {
  executeStructureGmCommand,
  executeUpwellCommand,
};
