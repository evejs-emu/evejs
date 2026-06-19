const path = require("path");

const {
  buildJobSummary,
  listActiveJobs,
  resetAutomationAndState,
  startClaim,
  startLoss,
  startTakeover,
  stopAutomation,
} = require(path.join(__dirname, "./sovAutoState"));
const {
  resolveAllianceID,
  resolveCorporationID,
  resolveSolarSystemID,
} = require(path.join(__dirname, "./sovGmState"));
const {
  findUnclaimedSolarSystem,
} = require(path.join(__dirname, "./sovAutoNavigation"));
const {
  isSovereigntyClaimableSolarSystem,
} = require(path.join(__dirname, "./sovSystemRules"));
const {
  SHOWCASE_SOV_FLEX_REQUIRED_UPGRADE_TYPE_IDS,
  canSolarSystemSupportSovFlexShowcase,
} = require(path.join(__dirname, "./sovUpgradeSupport"));
const sovLog = require(path.join(__dirname, "./sovLog"));

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
    "/sovauto help",
    "/sovauto status",
    "/sovauto stop <jobID|systemID|all>",
    "/sovauto reset",
    "/sovauto claim [here|systemID|unclaimed] [allianceID] [corporationID]",
    "/sovauto takeover [here|systemID] <allianceID> <corporationID>",
    "/sovauto gain [here|systemID] <allianceID> <corporationID>",
    "/sovauto loss [here|systemID] [allianceID|0] [corporationID|0]",
  ].join("\n");
}

function resolveClaimTarget(session, token) {
  const normalized = String(token || "here").trim().toLowerCase();
  if (normalized === "unclaimed" || normalized === "random" || normalized === "next") {
    return findUnclaimedSolarSystem(session, {
      requiredUpgradeTypeIDs: SHOWCASE_SOV_FLEX_REQUIRED_UPGRADE_TYPE_IDS,
    });
  }
  const solarSystemID = resolveSolarSystemID(session, token || "here", 0);
  if (!solarSystemID) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }
  if (!isSovereigntyClaimableSolarSystem(solarSystemID)) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_CONQUERABLE",
    };
  }
  if (!canSolarSystemSupportSovFlexShowcase(solarSystemID)) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_CANNOT_SUPPORT_SOV_SHOWCASE",
    };
  }
  return {
    success: true,
    data: {
      solarSystemID,
      solarSystem: null,
    },
  };
}

function executeSovAutoCommand(session, argumentText, chatHub = null) {
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
    const jobs = listActiveJobs();
    return {
      success: true,
      message: jobs.length > 0
        ? jobs.map((job) => buildJobSummary(job)).join("\n")
        : "No active sovereignty automation jobs.",
    };
  }

  if (subcommand === "reset" || subcommand === "wipe") {
    const result = resetAutomationAndState();
    if (!result.success) {
      return {
        success: false,
        message: "Failed to reset sovereignty automation state.",
      };
    }
    return {
      success: true,
      message: [
        "Cleared all dynamic sovereignty runtime state and stopped every active /sovauto job.",
        "This removed system claims, hubs, skyhooks, and sovereignty-related automation structures.",
        "Static sovereignty resource definitions were preserved.",
      ].join("\n"),
    };
  }

  if (subcommand === "stop") {
    const stopTarget = String(rest.join(" ").trim() || "");
    if (!stopTarget) {
      return {
        success: false,
        message: "Usage: /sovauto stop <jobID|systemID|all>",
      };
    }
    const stopResult = stopAutomation(stopTarget);
    if (!stopResult.success) {
      return {
        success: false,
        message: `Failed to stop sovereignty automation: ${stopResult.errorMsg}.`,
      };
    }
    return {
      success: true,
      message: stopTarget.toLowerCase() === "all"
        ? `Stopped ${stopResult.data.stoppedCount} sovereignty automation job${stopResult.data.stoppedCount === 1 ? "" : "s"}.`
        : `Stopped sovereignty automation for ${stopTarget}.`,
    };
  }

  if (subcommand === "claim") {
    let targetToken = "here";
    let ownerIndex = 0;
    if (rest.length >= 1) {
      const normalizedFirstToken = String(rest[0] || "").trim().toLowerCase();
      const candidateSystemID = resolveSolarSystemID(session, rest[0], 0);
      if (
        normalizedFirstToken === "here" ||
        normalizedFirstToken === "current" ||
        normalizedFirstToken === "unclaimed" ||
        normalizedFirstToken === "random" ||
        normalizedFirstToken === "next" ||
        candidateSystemID > 0
      ) {
        targetToken = rest[0];
        ownerIndex = 1;
      }
    }

    const targetResult = resolveClaimTarget(session, targetToken);
    const allianceID = resolveAllianceID(session, rest[ownerIndex], null);
    const corporationID = resolveCorporationID(session, rest[ownerIndex + 1], null);
    if (!targetResult.success || !allianceID || !corporationID) {
      return {
        success: false,
        message:
          targetResult && targetResult.errorMsg === "SOLAR_SYSTEM_NOT_CONQUERABLE"
            ? "Sovereignty claim automation only supports conquerable nullsec systems with no faction owner."
            : targetResult && targetResult.errorMsg === "SOLAR_SYSTEM_CANNOT_SUPPORT_SOV_SHOWCASE"
              ? "That solar system cannot support the full Sov Hub showcase set. Use /sovauto claim unclaimed for an auto-selected nullsec target that supports Pharolux, Ansiblex, and Tenebrex."
              : "Usage: /sovauto claim [here|systemID|unclaimed] [allianceID] [corporationID]",
      };
    }

    const startResult = startClaim(
      session,
      targetResult.data.solarSystemID,
      allianceID,
      corporationID,
      { chatHub },
    );
    if (!startResult.success) {
      return {
        success: false,
        message: `Failed to start sovereignty claim automation: ${startResult.errorMsg}.`,
      };
    }
    return {
      success: true,
      message: [
        `Started sovereignty claim automation: ${buildJobSummary(startResult.data.job)}.`,
        targetToken.toLowerCase() === "unclaimed" ||
        targetToken.toLowerCase() === "random" ||
        targetToken.toLowerCase() === "next"
          ? `Selected unclaimed system ${targetResult.data.solarSystemID} automatically.`
          : `Target system: ${targetResult.data.solarSystemID}.`,
        `It runs the next lifecycle step immediately, then every 10 seconds in local chat: jump, TCU deploy, Sov Hub deploy, max indices, Sov flex showcase deployment, and Tenebrex jammer online.`,
        `Step-by-step output is written to ${sovLog.SOV_LOG_PATH}.`,
      ].join("\n"),
    };
  }

  if (subcommand === "takeover" || subcommand === "gain") {
    if (rest.length < 2) {
      return {
        success: false,
        message: `Usage: /sovauto ${subcommand} [here|systemID] <allianceID> <corporationID>`,
      };
    }
    const hasExplicitSystem = rest.length >= 3;
    const solarSystemID = resolveSolarSystemID(
      session,
      hasExplicitSystem ? rest[0] : "here",
      0,
    );
    const allianceID = normalizePositiveInteger(
      hasExplicitSystem ? rest[1] : rest[0],
      null,
    );
    const corporationID = normalizePositiveInteger(
      hasExplicitSystem ? rest[2] : rest[1],
      null,
    );
    if (!solarSystemID || !allianceID || !corporationID) {
      return {
        success: false,
        message: `Usage: /sovauto ${subcommand} [here|systemID] <allianceID> <corporationID>`,
      };
    }
    const startResult = startTakeover(
      session,
      solarSystemID,
      allianceID,
      corporationID,
      { chatHub },
    );
    if (!startResult.success) {
      return {
        success: false,
        message: `Failed to start sovereignty takeover automation: ${startResult.errorMsg}.`,
      };
    }
    return {
      success: true,
      message: [
        `Started sovereignty takeover automation: ${buildJobSummary(startResult.data.job)}.`,
        `It runs immediately, then every 10 seconds: travel, vulnerability, campaign, capture, max indices, Sov flex showcase deployment, and Tenebrex jammer online when the system supports it.`,
        `Step-by-step output is written to ${sovLog.SOV_LOG_PATH}.`,
      ].join("\n"),
    };
  }

  if (subcommand === "loss") {
    let solarSystemID = resolveSolarSystemID(session, "here", 0);
    let nextAllianceID = null;
    let nextCorporationID = null;

    if (rest.length >= 1) {
      const candidateSystemID = resolveSolarSystemID(session, rest[0], 0);
      if (candidateSystemID > 0 && String(rest[0]).trim().toLowerCase() !== "0") {
        solarSystemID = candidateSystemID;
        nextAllianceID = normalizePositiveInteger(rest[1], null);
        nextCorporationID = normalizePositiveInteger(rest[2], null);
      } else {
        nextAllianceID = normalizePositiveInteger(rest[0], null);
        nextCorporationID = normalizePositiveInteger(rest[1], null);
      }
    }

    if (!solarSystemID) {
      return {
        success: false,
        message: "Usage: /sovauto loss [here|systemID] [allianceID|0] [corporationID|0]",
      };
    }

    const startResult = startLoss(
      session,
      solarSystemID,
      nextAllianceID,
      nextCorporationID,
      { chatHub },
    );
    if (!startResult.success) {
      return {
        success: false,
        message: `Failed to start sovereignty loss automation: ${startResult.errorMsg}.`,
      };
    }
    return {
      success: true,
      message: [
        `Started sovereignty loss automation: ${buildJobSummary(startResult.data.job)}.`,
        nextAllianceID && nextCorporationID
          ? `It runs immediately, then every 10 seconds: travel, vulnerability, loss campaign, remove auxiliary sovereignty automation structures, and transfer the system automatically.`
          : `It runs immediately, then every 10 seconds: travel, vulnerability, loss campaign, remove auxiliary sovereignty automation structures, and clear sovereignty ownership automatically.`,
        `Step-by-step output is written to ${sovLog.SOV_LOG_PATH}.`,
      ].join("\n"),
    };
  }

  return {
    success: false,
    message: buildHelpText(),
  };
}

module.exports = {
  executeSovAutoCommand,
};
