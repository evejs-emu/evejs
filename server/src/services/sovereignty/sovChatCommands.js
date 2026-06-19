const path = require("path");

const {
  DEFAULT_CAMPAIGN_EVENT_TYPE,
  DEFAULT_CAMPAIGN_OFFSET_SECONDS,
  DEFAULT_VULNERABILITY_DURATION_SECONDS,
  STRUCTURE_KIND,
  anchorSovereigntyStructures,
  buildSovereigntyStatusReport,
  cancelAllianceCapitalTransition,
  captureSystemForOwner,
  clearCampaignForKind,
  clearSystemSovereignty,
  clearVulnerabilityWindowForKind,
  ensureValidSolarSystem,
  fastForwardSovereigntyTimers,
  loseSystemSovereignty,
  normalizeStructureKind,
  resolveAllianceID,
  resolveCorporationID,
  resolveSolarSystemID,
  setAllianceCapitalSystem,
  setAlliancePrimeHour,
  setCampaignScoresForKind,
  setSystemDevelopmentIndexValue,
  setVulnerabilityWindowForKind,
  startCampaignForKind,
} = require(path.join(__dirname, "./sovGmState"));
const {
  DEFAULT_SOV_FLEX_FUEL_HOURS,
  deploySovereigntyFlexStructure,
  getSovereigntyFlexDefinitions,
  normalizeSovereigntyFlexKind,
} = require(path.join(__dirname, "./sovFlexStructures"));
const {
  getSystemState,
} = require(path.join(__dirname, "./sovState"));
const {
  getUpgradeDefinition,
} = require(path.join(__dirname, "./sovUpgradeSupport"));
const {
  buildSessionAnchorLayout,
} = require(path.join(__dirname, "./sovAutoNavigation"));

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

function buildHelpText() {
  return [
    "/sov help",
    "/sov status [here|systemID]",
    "/sov anchor <tcu|ihub|both> [here|systemID] [allianceID] [corporationID]",
    "/sov deploy <tenebrex|pharolux|ansiblex|all> [here|systemID] [allianceID] [corporationID]",
    "/sov prime <hour> [allianceID]",
    "/sov capital <here|systemID|clear> [allianceID]",
    "/sov index <strategic|claimed|military|industrial> <value> [here|systemID]",
    `/sov vuln <tcu|ihub|both> <seconds|clear> [here|systemID]`,
    `/sov campaign <tcu|ihub|both> <eventType|clear> [offsetSeconds] [here|systemID]`,
    "/sov score <tcu|ihub|both> <teamID=score> [teamID=score] ...",
    "/sov ff <seconds> [here|systemID]",
    "/sov capture <allianceID> <corporationID> [here|systemID]",
    "/sov lose [allianceID|0] [corporationID|0] [here|systemID]",
    "/sov clear [here|systemID]",
  ].join("\n");
}

function appendStatus(message, solarSystemID) {
  return [
    String(message || "").trim(),
    buildSovereigntyStatusReport(solarSystemID),
  ].join("\n");
}

function parseSystemToken(session, token) {
  const solarSystemID = resolveSolarSystemID(session, token, 0);
  const validation = ensureValidSolarSystem(solarSystemID);
  if (!validation.success) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }
  return {
    success: true,
    data: validation.data.solarSystemID,
  };
}

function parseScoreTokens(tokens = []) {
  const scoresByTeam = {};
  for (const token of tokens) {
    const [teamIDRaw, scoreRaw] = String(token || "").split("=");
    const teamID = normalizePositiveInteger(teamIDRaw, null);
    const score = normalizeInteger(scoreRaw, NaN);
    if (!teamID || !Number.isFinite(score)) {
      return null;
    }
    scoresByTeam[String(teamID)] = score;
  }
  return Object.keys(scoresByTeam).length > 0 ? scoresByTeam : null;
}

function buildDeployErrorMessage(errorMsg) {
  if (errorMsg === "FORBIDDEN_REQUEST") {
    return "The requested alliance or corporation does not own that Sov Hub.";
  }
  if (errorMsg === "SOV_HUB_REQUIRED") {
    return "Deploying sovereignty flex structures requires an already-claimed system with a Sov Hub.";
  }
  if (errorMsg === "INSUFFICIENT_LOCAL_CAPACITY") {
    return "That solar system cannot support the required Sov Hub upgrade for this flex structure.";
  }
  if (errorMsg === "REQUIRED_HUB_UPGRADE_NOT_ONLINE") {
    return "The required Sov Hub upgrade could not be brought online for this flex structure.";
  }
  if (errorMsg === "HUB_NOT_FOUND") {
    return "No Sov Hub was found for that system.";
  }
  return `Failed to deploy sovereignty flex structure: ${errorMsg}.`;
}

function executeSovCommand(session, argumentText) {
  const trimmed = String(argumentText || "").trim();
  const [subcommandRaw, ...rest] = trimmed.split(/\s+/).filter(Boolean);
  const subcommand = String(subcommandRaw || "help").trim().toLowerCase();

  if (subcommand === "help" || subcommand === "?" || subcommand === "commands") {
    return {
      success: true,
      message: buildHelpText(),
    };
  }

  if (subcommand === "status") {
    const systemResult = parseSystemToken(session, rest[0] || "here");
    if (!systemResult.success) {
      return {
        success: false,
        message: "Usage: /sov status [here|systemID]",
      };
    }
    return {
      success: true,
      message: buildSovereigntyStatusReport(systemResult.data),
    };
  }

  if (subcommand === "anchor") {
    const kind = normalizeStructureKind(rest[0]);
    if (!kind) {
      return {
        success: false,
        message: "Usage: /sov anchor <tcu|ihub|both> [here|systemID] [allianceID] [corporationID]",
      };
    }
    const systemResult = parseSystemToken(session, rest[1] || "here");
    if (!systemResult.success) {
      return {
        success: false,
        message: "Solar system not found for /sov anchor.",
      };
    }
    const allianceID = resolveAllianceID(session, rest[2], null);
    const corporationID = resolveCorporationID(session, rest[3], null);
    if (!allianceID || !corporationID) {
      return {
        success: false,
        message: "Anchoring sovereignty requires an alliance and corporation. Join an alliance first or pass explicit IDs.",
      };
    }
    const result = anchorSovereigntyStructures(
      systemResult.data,
      kind,
      allianceID,
      corporationID,
      {
        positionsByKind: buildSessionAnchorLayout(
          session,
          systemResult.data,
        ).positionsByKind,
      },
    );
    if (!result.success) {
      return {
        success: false,
        message: `Failed to anchor sovereignty structures: ${result.errorMsg}.`,
      };
    }
    return {
      success: true,
      message: appendStatus(
        `Anchored ${kind} sovereignty structure${kind === STRUCTURE_KIND.BOTH ? "s" : ""} in ${systemResult.data}.`,
        systemResult.data,
      ),
    };
  }

  if (subcommand === "deploy") {
    const deployKind = normalizeSovereigntyFlexKind(rest[0]);
    if (!deployKind) {
      return {
        success: false,
        message: "Usage: /sov deploy <tenebrex|pharolux|ansiblex|all> [here|systemID] [allianceID] [corporationID]",
      };
    }
    const systemResult = parseSystemToken(session, rest[1] || "here");
    if (!systemResult.success) {
      return {
        success: false,
        message: "Solar system not found for /sov deploy.",
      };
    }
    const systemState = getSystemState(systemResult.data) || {};
    const allianceID = resolveAllianceID(
      session,
      rest[2],
      normalizePositiveInteger(systemState.allianceID, null),
    );
    const corporationID = resolveCorporationID(
      session,
      rest[3],
      normalizePositiveInteger(systemState.corporationID, null),
    );
    const definitions = getSovereigntyFlexDefinitions(deployKind);
    if (definitions.length === 0) {
      return {
        success: false,
        message: "Usage: /sov deploy <tenebrex|pharolux|ansiblex|all> [here|systemID] [allianceID] [corporationID]",
      };
    }

    let strategicFloor = 0;
    for (const definition of definitions) {
      const upgradeDefinition = getUpgradeDefinition(definition.requiredUpgradeTypeID);
      strategicFloor = Math.max(
        strategicFloor,
        Math.max(0, normalizeInteger(upgradeDefinition && upgradeDefinition.requiredStrategicIndex, 0)),
      );
    }
    if (strategicFloor > 0) {
      setSystemDevelopmentIndexValue(
        systemResult.data,
        "strategic",
        strategicFloor,
      );
    }

    const deployedLabels = [];
    for (const definition of definitions) {
      const deployResult = deploySovereigntyFlexStructure(
        session,
        definition.kind,
        {
          solarSystemID: systemResult.data,
          allianceID,
          corporationID,
          fuelHours: DEFAULT_SOV_FLEX_FUEL_HOURS,
          reuseExisting: true,
        },
      );
      if (!deployResult.success) {
        return {
          success: false,
          message: buildDeployErrorMessage(deployResult.errorMsg),
        };
      }
      deployedLabels.push(
        deployResult.data.created === false
          ? `${definition.label} refreshed`
          : `${definition.label} deployed`,
      );
    }

    return {
      success: true,
      message: appendStatus(
        `${deployedLabels.join(", ")} in ${systemResult.data}. Required Sov Hub upgrades were brought online and fueled automatically.`,
        systemResult.data,
      ),
    };
  }

  if (subcommand === "prime") {
    const hour = normalizeInteger(rest[0], NaN);
    if (!Number.isFinite(hour)) {
      return {
        success: false,
        message: "Usage: /sov prime <hour> [allianceID]",
      };
    }
    const allianceID = resolveAllianceID(session, rest[1], null);
    if (!allianceID) {
      return {
        success: false,
        message: "Prime-time updates require an alliance. Join an alliance first or pass an allianceID.",
      };
    }
    setAlliancePrimeHour(allianceID, hour);
    return {
      success: true,
      message: `Queued alliance ${allianceID} prime hour -> ${hour}. Use /sov ff to bring the pending timer due.`,
    };
  }

  if (subcommand === "capital") {
    const firstToken = String(rest[0] || "here").trim().toLowerCase();
    const allianceID = resolveAllianceID(
      session,
      firstToken === "clear" || firstToken === "cancel" || firstToken === "off"
        ? rest[1]
        : rest[1],
      null,
    );
    if (!allianceID) {
      return {
        success: false,
        message: "Capital-system updates require an alliance. Join an alliance first or pass an allianceID.",
      };
    }
    if (firstToken === "clear" || firstToken === "cancel" || firstToken === "off") {
      cancelAllianceCapitalTransition(allianceID);
      return {
        success: true,
        message: `Cleared the pending capital transition for alliance ${allianceID}.`,
      };
    }
    const systemResult = parseSystemToken(session, rest[0] || "here");
    if (!systemResult.success) {
      return {
        success: false,
        message: "Usage: /sov capital <here|systemID|clear> [allianceID]",
      };
    }
    setAllianceCapitalSystem(allianceID, systemResult.data);
    return {
      success: true,
      message: `Queued alliance ${allianceID} capital system -> ${systemResult.data}. Use /sov ff to bring the pending timer due.`,
    };
  }

  if (subcommand === "index") {
    const indexKind = String(rest[0] || "").trim().toLowerCase();
    const value = normalizeInteger(rest[1], NaN);
    if (!indexKind || !Number.isFinite(value)) {
      return {
        success: false,
        message: "Usage: /sov index <strategic|claimed|military|industrial> <value> [here|systemID]",
      };
    }
    const systemResult = parseSystemToken(session, rest[2] || "here");
    if (!systemResult.success) {
      return {
        success: false,
        message: "Solar system not found for /sov index.",
      };
    }
    const result = setSystemDevelopmentIndexValue(
      systemResult.data,
      indexKind,
      value,
    );
    if (!result.success) {
      return {
        success: false,
        message: `Failed to update sovereignty indices: ${result.errorMsg}.`,
      };
    }
    return {
      success: true,
      message: appendStatus(
        `Updated ${indexKind} index in ${systemResult.data}.`,
        systemResult.data,
      ),
    };
  }

  if (subcommand === "vuln") {
    const kind = normalizeStructureKind(rest[0]);
    if (!kind) {
      return {
        success: false,
        message: "Usage: /sov vuln <tcu|ihub|both> <seconds|clear> [here|systemID]",
      };
    }
    const modeToken = String(rest[1] || "").trim().toLowerCase();
    if (!modeToken) {
      return {
        success: false,
        message: "Usage: /sov vuln <tcu|ihub|both> <seconds|clear> [here|systemID]",
      };
    }
    const systemResult = parseSystemToken(session, rest[2] || "here");
    if (!systemResult.success) {
      return {
        success: false,
        message: "Solar system not found for /sov vuln.",
      };
    }
    const result =
      modeToken === "clear"
        ? clearVulnerabilityWindowForKind(systemResult.data, kind)
        : setVulnerabilityWindowForKind(
          systemResult.data,
          kind,
          Math.max(1, normalizeInteger(modeToken, DEFAULT_VULNERABILITY_DURATION_SECONDS)),
        );
    if (!result.success) {
      return {
        success: false,
        message: `Failed to update vulnerability window: ${result.errorMsg}.`,
      };
    }
    return {
      success: true,
      message: appendStatus(
        modeToken === "clear"
          ? `Cleared ${kind} vulnerability windows in ${systemResult.data}.`
          : `Opened ${kind} vulnerability windows for ${Math.max(1, normalizeInteger(modeToken, DEFAULT_VULNERABILITY_DURATION_SECONDS))} seconds in ${systemResult.data}.`,
        systemResult.data,
      ),
    };
  }

  if (subcommand === "campaign") {
    const kind = normalizeStructureKind(rest[0]);
    if (!kind) {
      return {
        success: false,
        message: "Usage: /sov campaign <tcu|ihub|both> <eventType|clear> [offsetSeconds] [here|systemID]",
      };
    }
    const modeToken = String(rest[1] || "").trim().toLowerCase();
    if (!modeToken) {
      return {
        success: false,
        message: "Usage: /sov campaign <tcu|ihub|both> <eventType|clear> [offsetSeconds] [here|systemID]",
      };
    }
    const systemResult = parseSystemToken(session, rest[3] || "here");
    if (!systemResult.success) {
      return {
        success: false,
        message: "Solar system not found for /sov campaign.",
      };
    }
    const result =
      modeToken === "clear"
        ? clearCampaignForKind(systemResult.data, kind)
        : startCampaignForKind(
          systemResult.data,
          kind,
          Math.max(1, normalizeInteger(modeToken, DEFAULT_CAMPAIGN_EVENT_TYPE)),
          Math.max(0, normalizeInteger(rest[2], DEFAULT_CAMPAIGN_OFFSET_SECONDS)),
        );
    if (!result.success) {
      return {
        success: false,
        message: `Failed to update campaign state: ${result.errorMsg}.`,
      };
    }
    return {
      success: true,
      message: appendStatus(
        modeToken === "clear"
          ? `Cleared ${kind} campaign state in ${systemResult.data}.`
          : `Started ${kind} campaign event ${Math.max(1, normalizeInteger(modeToken, DEFAULT_CAMPAIGN_EVENT_TYPE))} in ${systemResult.data}.`,
        systemResult.data,
      ),
    };
  }

  if (subcommand === "score") {
    const kind = normalizeStructureKind(rest[0]);
    const scoresByTeam = parseScoreTokens(rest.slice(1));
    if (!kind || !scoresByTeam) {
      return {
        success: false,
        message: "Usage: /sov score <tcu|ihub|both> <teamID=score> [teamID=score] ...",
      };
    }
    const systemResult = parseSystemToken(session, "here");
    if (!systemResult.success) {
      return {
        success: false,
        message: "Current solar system could not be resolved for /sov score.",
      };
    }
    const result = setCampaignScoresForKind(
      systemResult.data,
      kind,
      scoresByTeam,
    );
    if (!result.success) {
      return {
        success: false,
        message: `Failed to update campaign scores: ${result.errorMsg}.`,
      };
    }
    return {
      success: true,
      message: appendStatus(
        `Updated ${kind} campaign scores in ${systemResult.data}.`,
        systemResult.data,
      ),
    };
  }

  if (subcommand === "ff") {
    const seconds = normalizeInteger(rest[0], NaN);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return {
        success: false,
        message: "Usage: /sov ff <seconds> [here|systemID]",
      };
    }
    const systemResult = parseSystemToken(session, rest[1] || "here");
    if (!systemResult.success) {
      return {
        success: false,
        message: "Solar system not found for /sov ff.",
      };
    }
    const result = fastForwardSovereigntyTimers(systemResult.data, seconds);
    if (!result.success) {
      return {
        success: false,
        message: `Failed to fast-forward sovereignty timers: ${result.errorMsg}.`,
      };
    }
    return {
      success: true,
      message: appendStatus(
        `Fast-forwarded sovereignty timers by ${seconds} seconds in ${systemResult.data}.`,
        systemResult.data,
      ),
    };
  }

  if (subcommand === "capture") {
    const allianceID = resolveAllianceID(session, rest[0], null);
    const corporationID = resolveCorporationID(session, rest[1], null);
    if (!allianceID || !corporationID) {
      return {
        success: false,
        message: "Usage: /sov capture <allianceID> <corporationID> [here|systemID]",
      };
    }
    const systemResult = parseSystemToken(session, rest[2] || "here");
    if (!systemResult.success) {
      return {
        success: false,
        message: "Solar system not found for /sov capture.",
      };
    }
    const result = captureSystemForOwner(
      systemResult.data,
      allianceID,
      corporationID,
    );
    if (!result.success) {
      return {
        success: false,
        message: `Failed to capture sovereignty: ${result.errorMsg}.`,
      };
    }
    return {
      success: true,
      message: appendStatus(
        `Captured solar system ${systemResult.data} for alliance ${allianceID} corporation ${corporationID}.`,
        systemResult.data,
      ),
    };
  }

  if (subcommand === "lose") {
    let systemToken = "here";
    let nextAllianceToken = rest[0];
    let nextCorporationToken = rest[1];
    if (rest.length >= 1) {
      const candidateSystemResult = parseSystemToken(session, rest[0]);
      if (candidateSystemResult.success) {
        systemToken = rest[0];
        nextAllianceToken = rest[1];
        nextCorporationToken = rest[2];
      }
    }
    const systemResult = parseSystemToken(session, systemToken);
    if (!systemResult.success) {
      return {
        success: false,
        message: "Usage: /sov lose [allianceID|0] [corporationID|0] [here|systemID]",
      };
    }
    const nextAllianceID = normalizePositiveInteger(nextAllianceToken, null);
    const nextCorporationID = normalizePositiveInteger(nextCorporationToken, null);
    const result = loseSystemSovereignty(
      systemResult.data,
      nextAllianceID,
      nextCorporationID,
    );
    if (!result.success) {
      return {
        success: false,
        message: `Failed to drop sovereignty: ${result.errorMsg}.`,
      };
    }
    return {
      success: true,
      message: appendStatus(
        nextAllianceID && nextCorporationID
          ? `Transferred solar system ${systemResult.data} to alliance ${nextAllianceID} corporation ${nextCorporationID}.`
          : `Cleared sovereignty ownership in solar system ${systemResult.data}.`,
        systemResult.data,
      ),
    };
  }

  if (subcommand === "clear") {
    const systemResult = parseSystemToken(session, rest[0] || "here");
    if (!systemResult.success) {
      return {
        success: false,
        message: "Usage: /sov clear [here|systemID]",
      };
    }
    const result = clearSystemSovereignty(systemResult.data);
    if (!result.success) {
      return {
        success: false,
        message: `Failed to clear sovereignty state: ${result.errorMsg}.`,
      };
    }
    return {
      success: true,
      message: appendStatus(
        `Cleared sovereignty state in solar system ${systemResult.data}.`,
        systemResult.data,
      ),
    };
  }

  return {
    success: false,
    message: buildHelpText(),
  };
}

module.exports = {
  executeSovCommand,
};
