const path = require("path");

const {
  resolveItemByName,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  getDockedLocationID,
  isDockedSession,
} = require(path.join(__dirname, "../structure/structureLocation"));
const {
  getCharacterWallet,
  adjustCharacterBalance,
} = require(path.join(__dirname, "../account/walletState"));
const {
  adjustCorporationWalletDivisionBalance,
  getCorporationWalletBalance,
  normalizeCorporationWalletKey,
} = require(path.join(__dirname, "../corporation/corpWalletState"));
const {
  grantItemsToCharacterLocation,
  grantItemsToOwnerLocation,
  ITEM_FLAGS,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  canSeeCorporationBlueprints,
  getAccessibleCorpHangarFlags,
  getSessionCharacterID,
  getSessionCorporationID,
  hasCorporationIndustryJobAccess,
} = require(path.join(__dirname, "./industryAccess"));
const {
  buildManufacturingMaterials,
  cancelIndustryJob,
  deliverManufacturingJob,
  installManufacturingJob,
  listBlueprintInstancesByOwner,
  listJobsByOwner,
  markIndustryJobReady,
  quoteManufacturingJob,
  seedBlueprintForOwner,
} = require(path.join(__dirname, "./industryRuntimeState"));
const {
  getBlueprintDefinitionByProductTypeID,
  getBlueprintDefinitionByTypeID,
  searchBlueprintDefinitions,
} = require(path.join(__dirname, "./industryStaticData"));
const {
  DEMO_RUN_COUNT,
  GM_BP_PRESETS,
  ITEM_FLAG_CORP_DELIVERIES,
  ITEM_FLAG_CORP_HANGAR_1,
} = require(path.join(__dirname, "./industryConstants"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function formatIsk(value) {
  return `${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ISK`;
}

function buildHelpText() {
  return [
    "/bpauto help",
    "/bpauto status",
    "/bpauto reset",
    "/bpauto owner <me|corp>",
    "/bpauto facility <here|best|npc|structure>",
    "/bpauto list [me|corp]",
    "/bpauto seed <preset|product|blueprint> [runs] [copy|original]",
    "/bpauto quote <preset|product|blueprint> [runs]",
    "/bpauto build <preset|product|blueprint> [runs] [ready]",
    "/bpauto deliver <last|ready|all|jobID>",
    "/bpauto cancel <last|ready|all|jobID>",
    "/bpauto demo <frigate|ammo|module|ship|components>",
    "/bpauto smoke <basic|corp|facility|delivery>",
    "/bp help",
    "/bp list",
    "/bp jobs",
    "/bp lookup <preset|product|blueprint>",
  ].join("\n");
}

function ensureDocked(session) {
  return isDockedSession(session) && getDockedLocationID(session) > 0;
}

function resolveBlueprintDefinition(token) {
  const normalized = String(token || "").trim();
  if (!normalized) {
    return null;
  }
  const preset = GM_BP_PRESETS[String(normalized).trim().toLowerCase()];
  const searchTerm = preset || normalized;
  const directItem = resolveItemByName(searchTerm);
  if (directItem && directItem.success && directItem.match) {
    const byBlueprintType = getBlueprintDefinitionByTypeID(directItem.match.typeID);
    if (byBlueprintType) {
      return byBlueprintType;
    }
    const byProductType = getBlueprintDefinitionByProductTypeID(directItem.match.typeID);
    if (byProductType) {
      return byProductType;
    }
  }
  return searchBlueprintDefinitions(searchTerm, 1)[0] || null;
}

function getAutoContext(session) {
  if (!session || typeof session !== "object") {
    return {
      ownerMode: "me",
      facilityMode: "here",
    };
  }
  session._industryAutoContext =
    session._industryAutoContext && typeof session._industryAutoContext === "object"
      ? session._industryAutoContext
      : {
          ownerMode: "me",
          facilityMode: "here",
        };
  if (!session._industryAutoContext.ownerMode) {
    session._industryAutoContext.ownerMode = "me";
  }
  if (!session._industryAutoContext.facilityMode) {
    session._industryAutoContext.facilityMode = "here";
  }
  return session._industryAutoContext;
}

function resetAutoContext(session) {
  if (session && typeof session === "object") {
    session._industryAutoContext = {
      ownerMode: "me",
      facilityMode: "here",
    };
  }
  return getAutoContext(session);
}

function resolveOwnerID(session, ownerMode = "me") {
  return ownerMode === "corp"
    ? getSessionCorporationID(session)
    : getSessionCharacterID(session);
}

function getCurrentFacilityID(session) {
  return getDockedLocationID(session);
}

function resolveInputFlag(session, ownerID, locationID) {
  if (ownerID === getSessionCharacterID(session)) {
    return ITEM_FLAGS.HANGAR;
  }
  return getAccessibleCorpHangarFlags(session, locationID, { takeRequired: true })[0]
    || ITEM_FLAG_CORP_HANGAR_1;
}

function resolveOutputFlag(session, ownerID) {
  return ownerID === getSessionCharacterID(session)
    ? ITEM_FLAGS.HANGAR
    : ITEM_FLAG_CORP_DELIVERIES;
}

function buildBaseJobRequest(session, definition, blueprint, runs, ownerID) {
  const locationID = getCurrentFacilityID(session);
  const account = ownerID === getSessionCharacterID(session)
    ? [ownerID, 1000]
    : [ownerID, normalizeCorporationWalletKey(session.corpAccountKey || 1000)];
  const inputFlagID = resolveInputFlag(session, ownerID, locationID);
  const outputFlagID = resolveOutputFlag(session, ownerID);
  return {
    blueprintID: blueprint.itemID,
    blueprintTypeID: blueprint.typeID,
    activityID: 1,
    facilityID: locationID,
    solarSystemID: session.solarsystemid2 || session.solarsystemid || 0,
    characterID: getSessionCharacterID(session),
    corporationID: getSessionCorporationID(session),
    account,
    runs,
    cost: 0,
    tax: 0,
    time: 0,
    materials: {},
    inputLocation: {
      itemID: locationID,
      typeID: 0,
      ownerID,
      flagID: inputFlagID,
    },
    outputLocation: {
      itemID: locationID,
      typeID: 0,
      ownerID,
      flagID: outputFlagID,
    },
    licensedRuns: 1,
    productTypeID: definition.productTypeID,
  };
}

function seedMaterialsForBlueprint(session, definition, runs, ownerID) {
  const locationID = getCurrentFacilityID(session);
  const materials = buildManufacturingMaterials(definition, runs, 0);
  const entries = materials.map((material) => ({
    itemType: material.typeID,
    quantity: material.quantity,
  }));
  if (ownerID === getSessionCharacterID(session)) {
    return grantItemsToCharacterLocation(
      ownerID,
      locationID,
      ITEM_FLAGS.HANGAR,
      entries,
    );
  }
  return grantItemsToOwnerLocation(
    ownerID,
    locationID,
    resolveInputFlag(session, ownerID, locationID),
    entries,
  );
}

function topUpWalletForBuild(session, ownerID, totalCost) {
  if (ownerID === getSessionCharacterID(session)) {
    const wallet = getCharacterWallet(ownerID);
    const balance = Number(wallet && wallet.balance) || 0;
    if (balance >= totalCost) {
      return;
    }
    adjustCharacterBalance(ownerID, totalCost - balance + 100000, {
      description: "Blueprint auto-build wallet top-up",
      ownerID1: ownerID,
      ownerID2: ownerID,
      referenceID: ownerID,
    });
    return;
  }
  const accountKey = normalizeCorporationWalletKey(session.corpAccountKey || 1000);
  const balance = getCorporationWalletBalance(ownerID, accountKey);
  if (balance >= totalCost) {
    return;
  }
  adjustCorporationWalletDivisionBalance(ownerID, accountKey, totalCost - balance + 100000, {
    description: "Blueprint auto-build wallet top-up",
    ownerID1: ownerID,
    ownerID2: getSessionCharacterID(session),
    referenceID: getSessionCharacterID(session),
  });
}

function resolveContextOwner(session, requestedOwnerMode = null) {
  const context = getAutoContext(session);
  const ownerMode = requestedOwnerMode || context.ownerMode || "me";
  const ownerID = resolveOwnerID(session, ownerMode);
  return {
    ownerMode,
    ownerID,
  };
}

function validateOwnerMode(session, ownerMode) {
  if (ownerMode !== "corp") {
    return null;
  }
  const corporationID = getSessionCorporationID(session);
  if (corporationID <= 0) {
    return "You are not in a player corporation.";
  }
  if (!canSeeCorporationBlueprints(session, corporationID) || !hasCorporationIndustryJobAccess(session, corporationID)) {
    return "You do not have corporation industry access for /bpauto owner corp.";
  }
  return null;
}

function formatBlueprintRows(blueprints = []) {
  return blueprints.slice(0, 20).map((blueprint) => (
    `itemID=${blueprint.itemID} typeID=${blueprint.typeID} runs=${blueprint.runs} owner=${blueprint.ownerID} flag=${blueprint.flagID} facility=${blueprint.facilityID || 0}`
  ));
}

function formatJobRows(jobs = []) {
  return jobs.slice(0, 20).map((job) => (
    `job=${job.jobID} status=${job.status} blueprint=${job.blueprintTypeID} product=${job.productTypeID} runs=${job.runs} owner=${job.ownerID}`
  ));
}

function findBlueprintForDefinition(session, ownerID, definition) {
  return listBlueprintInstancesByOwner(ownerID, null, session).blueprints
    .filter((entry) => entry.typeID === definition.blueprintTypeID)
    .sort((left, right) => {
      const leftBusy = left.jobID ? 1 : 0;
      const rightBusy = right.jobID ? 1 : 0;
      if (leftBusy !== rightBusy) {
        return leftBusy - rightBusy;
      }
      if ((right.runs || 0) !== (left.runs || 0)) {
        return (right.runs || 0) - (left.runs || 0);
      }
      return right.itemID - left.itemID;
    })[0] || null;
}

function findDeliverTargets(jobs, target) {
  const normalizedTarget = String(target || "ready").trim().toLowerCase();
  if (normalizedTarget === "all") {
    return jobs.filter((job) => job.status === 3);
  }
  if (normalizedTarget === "ready") {
    return jobs.filter((job) => job.status === 3).slice(0, 1);
  }
  if (normalizedTarget === "last") {
    return jobs
      .filter((job) => job.status === 3)
      .sort((left, right) => right.jobID - left.jobID)
      .slice(0, 1);
  }
  return jobs.filter((job) => job.jobID === toInt(normalizedTarget, 0));
}

function findCancelTargets(jobs, target) {
  const normalizedTarget = String(target || "last").trim().toLowerCase();
  if (normalizedTarget === "all") {
    return jobs.filter((job) => job.status < 100);
  }
  if (normalizedTarget === "ready") {
    return jobs.filter((job) => job.status === 3);
  }
  if (normalizedTarget === "last") {
    return jobs
      .filter((job) => job.status < 100)
      .sort((left, right) => right.jobID - left.jobID)
      .slice(0, 1);
  }
  return jobs.filter((job) => job.jobID === toInt(normalizedTarget, 0));
}

function shouldForceReadyBuild(subcommand, rest = []) {
  if (subcommand !== "build") {
    return false;
  }
  return rest.slice(1).some((token) => {
    const normalized = String(token || "").trim().toLowerCase();
    return normalized === "ready" || normalized === "instant";
  });
}

function executeBlueprintAutoCommand(session, argumentText) {
  const trimmed = String(argumentText || "").trim();
  const [subcommandRaw, ...rest] = trimmed.split(/\s+/).filter(Boolean);
  const subcommand = String(subcommandRaw || "help").trim().toLowerCase();
  const context = getAutoContext(session);

  if (!ensureDocked(session)) {
    return {
      success: false,
      message: "Dock at a station or structure before using blueprint automation commands.",
    };
  }

  if (subcommand === "help" || subcommand === "?" || subcommand === "commands") {
    return {
      success: true,
      message: buildHelpText(),
    };
  }

  if (subcommand === "reset") {
    resetAutoContext(session);
    return {
      success: true,
      message: "Blueprint automation context reset to owner=me facility=here.",
    };
  }

  if (subcommand === "owner") {
    const ownerMode = String(rest[0] || "me").trim().toLowerCase();
    if (ownerMode !== "me" && ownerMode !== "corp") {
      return {
        success: false,
        message: "Usage: /bpauto owner <me|corp>",
      };
    }
    const validationError = validateOwnerMode(session, ownerMode);
    if (validationError) {
      return {
        success: false,
        message: validationError,
      };
    }
    context.ownerMode = ownerMode;
    return {
      success: true,
      message: `Blueprint automation owner set to ${ownerMode}.`,
    };
  }

  if (subcommand === "facility") {
    const facilityMode = String(rest[0] || "here").trim().toLowerCase();
    if (!["here", "best", "npc", "structure"].includes(facilityMode)) {
      return {
        success: false,
        message: "Usage: /bpauto facility <here|best|npc|structure>",
      };
    }
    context.facilityMode = facilityMode;
    return {
      success: true,
      message: `Blueprint automation facility set to ${facilityMode}. Current facility=${getCurrentFacilityID(session)}.`,
    };
  }

  if (subcommand === "status") {
    const ownerState = resolveContextOwner(session);
    const jobs = listJobsByOwner(ownerState.ownerID, true);
    const blueprints = listBlueprintInstancesByOwner(ownerState.ownerID, null, session).blueprints;
    return {
      success: true,
      message: [
        `Owner: ${ownerState.ownerMode} (${ownerState.ownerID})`,
        `Facility mode: ${context.facilityMode} (${getCurrentFacilityID(session)})`,
        `Blueprints: ${blueprints.length}`,
        `Jobs: ${jobs.length}`,
        ...formatJobRows(jobs),
      ].join("\n"),
    };
  }

  if (subcommand === "list") {
    const ownerMode = rest[0] === "corp" ? "corp" : rest[0] === "me" ? "me" : context.ownerMode;
    const validationError = validateOwnerMode(session, ownerMode);
    if (validationError) {
      return {
        success: false,
        message: validationError,
      };
    }
    const ownerID = resolveOwnerID(session, ownerMode);
    const blueprints = listBlueprintInstancesByOwner(ownerID, null, session).blueprints;
    return {
      success: true,
      message: blueprints.length > 0
        ? [
            `Owner: ${ownerMode} (${ownerID})`,
            ...formatBlueprintRows(blueprints),
          ].join("\n")
        : `No blueprint items were found for ${ownerMode}.`,
    };
  }

  if (subcommand === "seed") {
    const definition = resolveBlueprintDefinition(rest[0]);
    if (!definition) {
      return {
        success: false,
        message: "Usage: /bpauto seed <preset|product|blueprint> [runs] [copy|original]",
      };
    }
    const ownerState = resolveContextOwner(session);
    const validationError = validateOwnerMode(session, ownerState.ownerMode);
    if (validationError) {
      return {
        success: false,
        message: validationError,
      };
    }
    const runs = Math.max(
      1,
      toInt(rest[1], DEMO_RUN_COUNT[String(rest[0] || "").toLowerCase()] || 1),
    );
    const copyMode = String(rest[2] || "copy").trim().toLowerCase() !== "original";
    const locationID = getCurrentFacilityID(session);
    const blueprintFlagID = ownerState.ownerID === getSessionCharacterID(session)
      ? ITEM_FLAGS.HANGAR
      : resolveInputFlag(session, ownerState.ownerID, locationID);
    const seedResult = seedBlueprintForOwner(ownerState.ownerID, locationID, {
      blueprintTypeID: definition.blueprintTypeID,
      itemName: definition.blueprintName,
      original: !copyMode,
      runsRemaining: runs,
      materialEfficiency: 0,
      timeEfficiency: 0,
      flagID: blueprintFlagID,
      ownerMode: ownerState.ownerMode,
      isCorporation: ownerState.ownerMode === "corp",
    });
    if (!seedResult.success) {
      return {
        success: false,
        message: `Failed to seed blueprint: ${seedResult.errorMsg || "unknown error"}.`,
      };
    }
    const materialsResult = seedMaterialsForBlueprint(session, definition, runs, ownerState.ownerID);
    return {
      success: true,
      message: [
        `Owner: ${ownerState.ownerMode} (${ownerState.ownerID})`,
        `Seeded ${copyMode ? "BPC" : "BPO"} ${definition.blueprintName}.`,
        `Blueprint itemID=${seedResult.data.item.itemID}.`,
        `Materials seeded: ${materialsResult.success ? "yes" : "failed"}.`,
      ].join("\n"),
    };
  }

  if (subcommand === "quote" || subcommand === "build") {
    const definition = resolveBlueprintDefinition(rest[0]);
    if (!definition) {
      return {
        success: false,
        message: `Usage: /bpauto ${subcommand} <preset|product|blueprint> [runs]`,
      };
    }
    const ownerState = resolveContextOwner(session);
    const validationError = validateOwnerMode(session, ownerState.ownerMode);
    if (validationError) {
      return {
        success: false,
        message: validationError,
      };
    }
    const runs = Math.max(
      1,
      toInt(rest[1], DEMO_RUN_COUNT[String(rest[0] || "").toLowerCase()] || 1),
    );
    const blueprint = findBlueprintForDefinition(session, ownerState.ownerID, definition);
    if (!blueprint) {
      return {
        success: false,
        message: `No ${definition.blueprintName} was found for ${ownerState.ownerMode}. Use /bpauto seed first.`,
      };
    }

    const request = buildBaseJobRequest(session, definition, blueprint, runs, ownerState.ownerID);
    let quoteResult = quoteManufacturingJob(session, request);
    if (!quoteResult.success && subcommand === "build") {
      const accountFundsOnly =
        Array.isArray(quoteResult.errors) &&
        quoteResult.errors.length > 0 &&
        quoteResult.errors.every((error) => Number(error && error.code) === 19);
      if (accountFundsOnly && quoteResult.quote && Number(quoteResult.quote.totalCost) > 0) {
        topUpWalletForBuild(session, ownerState.ownerID, quoteResult.quote.totalCost);
        quoteResult = quoteManufacturingJob(session, request);
      }
    }
    if (!quoteResult.success) {
      return {
        success: false,
        message: `Industry quote failed with ${quoteResult.errors.length} validation error(s).`,
      };
    }

    if (subcommand === "quote") {
      return {
        success: true,
        message: [
          `Owner: ${ownerState.ownerMode} (${ownerState.ownerID})`,
          `${definition.blueprintName} -> ${definition.productName}`,
          `Runs: ${runs}`,
          `Total cost: ${formatIsk(quoteResult.quote.totalCost)}`,
          `Build time: ${quoteResult.quote.timeInSeconds}s`,
          `Materials: ${quoteResult.quote.materials.map((material) => `${material.typeID}x${material.quantity}`).join(", ")}`,
        ].join("\n"),
      };
    }

    topUpWalletForBuild(session, ownerState.ownerID, quoteResult.quote.totalCost);
    const result = installManufacturingJob(session, request);
    const forceReady = shouldForceReadyBuild(subcommand, rest);
    let readyResult = null;
    if (forceReady) {
      readyResult = markIndustryJobReady(result.data.jobID);
    }
    return {
      success: true,
      jobID: result.data.jobID,
      message: [
        `Owner: ${ownerState.ownerMode} (${ownerState.ownerID})`,
        `Installed manufacturing job ${result.data.jobID}.`,
        `${definition.productName} x${runs}.`,
        `Total cost: ${formatIsk(result.data.quote.totalCost)}.`,
        forceReady && readyResult && readyResult.success
          ? `Job ${result.data.jobID} is ready to deliver.`
          : null,
      ].filter(Boolean).join("\n"),
    };
  }

  if (subcommand === "deliver") {
    const ownerState = resolveContextOwner(session);
    const jobs = listJobsByOwner(ownerState.ownerID, true);
    const deliverTargets = findDeliverTargets(jobs, rest[0] || "ready");
    if (deliverTargets.length === 0) {
      return {
        success: false,
        message: "No matching ready industry jobs were found.",
      };
    }
    const delivered = [];
    for (const job of deliverTargets) {
      const result = deliverManufacturingJob(session, job.jobID);
      delivered.push(result.data.jobID);
    }
    return {
      success: true,
      message: `Delivered job${delivered.length === 1 ? "" : "s"}: ${delivered.join(", ")}.`,
    };
  }

  if (subcommand === "cancel") {
    const ownerState = resolveContextOwner(session);
    const jobs = listJobsByOwner(ownerState.ownerID, true);
    const cancelTargets = findCancelTargets(jobs, rest[0] || "last");
    if (cancelTargets.length === 0) {
      return {
        success: false,
        message: "No matching industry jobs were found to cancel.",
      };
    }
    const cancelled = [];
    for (const job of cancelTargets) {
      const result = cancelIndustryJob(session, job.jobID);
      cancelled.push(result.data.jobID);
    }
    return {
      success: true,
      message: `Cancelled job${cancelled.length === 1 ? "" : "s"}: ${cancelled.join(", ")}.`,
    };
  }

  if (subcommand === "demo") {
    const token = rest[0] || "frigate";
    const seedResult = executeBlueprintAutoCommand(session, `seed ${token}`);
    if (!seedResult.success) {
      return seedResult;
    }
    const buildResult = executeBlueprintAutoCommand(session, `build ${token} ready`);
    return buildResult.success
      ? {
          success: true,
          jobID: buildResult.jobID,
          message: [
            seedResult.message,
            buildResult.message,
            "Open Industry or run /bpauto deliver ready to finish it.",
          ].join("\n"),
        }
      : buildResult;
  }

  if (subcommand === "smoke") {
    const mode = String(rest[0] || "basic").trim().toLowerCase();
    if (mode === "corp") {
      const ownerResult = executeBlueprintAutoCommand(session, "owner corp");
      if (!ownerResult.success) {
        return ownerResult;
      }
      return executeBlueprintAutoCommand(session, "demo module");
    }
    if (mode === "facility") {
      return executeBlueprintAutoCommand(session, "status");
    }
    if (mode === "delivery") {
      return executeBlueprintAutoCommand(session, "demo module");
    }
    return executeBlueprintAutoCommand(session, "demo module");
  }

  return {
    success: false,
    message: buildHelpText(),
  };
}

function executeBlueprintCommand(session, argumentText) {
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
    const blueprints = listBlueprintInstancesByOwner(getSessionCharacterID(session), null, session).blueprints;
    return {
      success: true,
      message: blueprints.length > 0
        ? formatBlueprintRows(blueprints).join("\n")
        : "No blueprint items were found for your character.",
    };
  }

  if (subcommand === "jobs") {
    const jobs = listJobsByOwner(getSessionCharacterID(session), true);
    return {
      success: true,
      message: jobs.length > 0
        ? formatJobRows(jobs).join("\n")
        : "No industry jobs were found for your character.",
    };
  }

  if (subcommand === "lookup") {
    const definition = resolveBlueprintDefinition(rest.join(" "));
    if (!definition) {
      return {
        success: false,
        message: "Usage: /bp lookup <preset|product|blueprint>",
      };
    }
    return {
      success: true,
      message: [
        `Blueprint: ${definition.blueprintName} (${definition.blueprintTypeID})`,
        `Product: ${definition.productName} (${definition.productTypeID})`,
        `Max production limit: ${definition.maxProductionLimit}`,
      ].join("\n"),
    };
  }

  return {
    success: false,
    message: buildHelpText(),
  };
}

module.exports = {
  executeBlueprintAutoCommand,
  executeBlueprintCommand,
};
