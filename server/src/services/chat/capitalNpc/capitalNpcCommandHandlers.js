const path = require("path");

const npcService = require(path.join(__dirname, "../../../space/npc"));
const spaceRuntime = require(path.join(__dirname, "../../../space/runtime"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../inventory/itemTypeRegistry"));
const {
  resolveFuelTypeID,
  resolveTitanSuperweaponProfileByModuleTypeID,
} = require(path.join(__dirname, "../../superweapons/superweaponCatalog"));
const {
  inspectSuperweaponActivationContract,
} = require(path.join(__dirname, "../../../space/modules/superweapons/superweaponRuntime"));
const {
  getCapitalControllerState,
  listControlledNpcFighters,
  toFiniteNumber,
  toPositiveInt,
} = require(path.join(__dirname, "../../../space/npc/capitals/capitalNpcState"));
const {
  resolveCapitalDoctrine,
} = require(path.join(__dirname, "../../../space/npc/capitals/capitalNpcDoctrine"));
const {
  getCapitalRuntimeConfig,
} = require(path.join(__dirname, "../../../space/npc/capitals/capitalNpcRuntimeConfig"));
const {
  resetNpcSupercarrierWing,
} = require(path.join(__dirname, "../../fighter/npc/npcSupercarrierDirector"));
const {
  buildTrackedTubeFlagSet,
  resetNpcSupercarrierTubeState,
} = require(path.join(__dirname, "../../fighter/npc/npcSupercarrierTubeState"));
const {
  parseAmountAndQuery,
  parseActionAndQuery,
  parseQueryAndTarget,
  parseActionQueryAndTarget,
  parseQueryAndOptionalTarget,
} = require("./capitalNpcCommandParser");
const {
  resolveCapitalSelection,
  getSystemCapitalSummaries,
  resolveTargetEntity,
  resolveSessionSystemID,
} = require("./capitalNpcCommandResolver");
const {
  formatSpawnSummary,
  formatSelectionInfo,
  formatLiveStatus,
  formatManualOrderResult,
  formatClearResult,
  formatFighterStatus,
  formatFighterReset,
  formatSuperStatus,
  formatPerfSummary,
  formatSignoffSummary,
} = require("./capitalNpcCommandFormatter");

const MAX_CAPITAL_NPC_COMMAND_SPAWN_COUNT = 50;

function issueCapitalAttackOrder(entityID, targetID, options = {}) {
  const orderResult = npcService.issueManualOrder(entityID, {
    type: "attack",
    targetID: toPositiveInt(targetID, 0),
    allowWeapons: true,
    keepLock: true,
  });
  if (
    orderResult &&
    orderResult.success &&
    options.wakeController !== false
  ) {
    npcService.wakeNpcController(entityID, 0);
  }
  return orderResult;
}

function getEntityCargoQuantityByType(entity, typeID) {
  const normalizedTypeID = toPositiveInt(typeID, 0);
  if (!entity || normalizedTypeID <= 0) {
    return 0;
  }
  return (Array.isArray(entity.nativeCargoItems) ? entity.nativeCargoItems : [])
    .filter((item) => toPositiveInt(item && item.typeID, 0) === normalizedTypeID)
    .reduce((sum, item) => sum + (
      Number(item && item.quantity) ||
      Number(item && item.stacksize) ||
      0
    ), 0);
}

function selectEarliestSummary(summaries = []) {
  return [...summaries]
    .sort((left, right) => (Number(left && left.entityID) || 0) - (Number(right && right.entityID) || 0))[0] || null;
}

function spawnCapitalProfileForSignoff(session, profileID) {
  return npcService.runtime.spawnBatchForSession(session, {
    profileQuery: profileID,
    amount: 1,
    transient: true,
    preferPools: false,
    defaultPoolID: "capital_npc_all",
  });
}

function loadLiveCapitalForProfile(session, profileID) {
  const liveResult = getSystemCapitalSummaries(npcService, session, profileID);
  if (!liveResult.success) {
    return liveResult;
  }
  const summary = selectEarliestSummary(liveResult.data.summaries);
  return {
    success: Boolean(summary),
    errorMsg: summary ? null : "NPC_NOT_FOUND",
    data: {
      ...liveResult.data,
      summary,
    },
  };
}

function summarizeWingTypes(wingEntries = []) {
  const composition = new Map();
  for (const wingEntry of wingEntries) {
    const fighterTypeID = toPositiveInt(wingEntry && wingEntry.typeID, 0);
    const fighterType = resolveItemByTypeID(fighterTypeID);
    const fighterName = String(
      (fighterType && (fighterType.typeName || fighterType.name)) ||
      `type ${fighterTypeID}`,
    ).trim();
    composition.set(fighterName, (composition.get(fighterName) || 0) + 1);
  }
  return [...composition.entries()]
    .map(([name, count]) => `${count}x ${name}`)
    .join(", ");
}

function resolveTitanReadiness(scene, entity, behaviorProfile, targetEntity) {
  const moduleTypeID = toPositiveInt(
    behaviorProfile && behaviorProfile.capitalSuperweaponModuleTypeID,
    0,
  );
  const moduleItem = (Array.isArray(entity && entity.fittedItems) ? entity.fittedItems : []).find((item) => (
    toPositiveInt(item && item.typeID, 0) === moduleTypeID
  )) || null;
  if (!moduleItem) {
    return {
      ready: false,
      moduleTypeID,
      moduleItem: null,
      contract: null,
      fuelQuantity: 0,
      active: false,
    };
  }

  const contractResult = inspectSuperweaponActivationContract({
    scene,
    entity,
    moduleItem,
    targetID: toPositiveInt(targetEntity && targetEntity.itemID, 0),
  });
  const contract = contractResult && contractResult.success ? contractResult.data : null;
  const active = Boolean(
    entity &&
    entity.activeModuleEffects instanceof Map &&
    entity.activeModuleEffects.has(toPositiveInt(moduleItem.itemID, 0))
  );
  const fuelQuantity = contract
    ? getEntityCargoQuantityByType(entity, contract.fuelTypeID)
    : 0;

  return {
    ready: Boolean(
      contract &&
      active !== true &&
      fuelQuantity >= Math.max(1, toPositiveInt(contract.fuelPerActivation, 0))
    ),
    moduleTypeID,
    moduleItem,
    contract,
    fuelQuantity,
    active,
  };
}

function acquireCapitalForSignoff(session, selectionData, targetEntity) {
  let loadResult = loadLiveCapitalForProfile(session, selectionData.id);
  if (!loadResult.success) {
    const spawnResult = spawnCapitalProfileForSignoff(session, selectionData.id);
    if (!spawnResult.success) {
      return {
        success: false,
        errorMsg: spawnResult.errorMsg || loadResult.errorMsg || "SPAWN_FAILED",
      };
    }
    loadResult = loadLiveCapitalForProfile(session, selectionData.id);
    if (!loadResult.success) {
      return loadResult;
    }
    return {
      success: true,
      data: {
        ...loadResult.data,
        spawnedFresh: true,
      },
    };
  }

  const scene = loadResult.data.scene;
  const summary = loadResult.data.summary;
  const controller = npcService.getControllerByEntityID(summary.entityID);
  const entity = scene.getEntityByID(Number(summary.entityID) || 0);
  const behaviorProfile = controller && controller.behaviorProfile;
  if (
    entity &&
    behaviorProfile &&
    (
      Array.isArray(behaviorProfile.capitalFighterWingTypeIDs) ||
      toPositiveInt(behaviorProfile.capitalSuperweaponModuleTypeID, 0) > 0
    )
  ) {
    const spawnResult = spawnCapitalProfileForSignoff(session, selectionData.id);
    if (spawnResult.success) {
      const refreshed = loadLiveCapitalForProfile(session, selectionData.id);
      if (refreshed.success) {
        const latestSummary = [...refreshed.data.summaries]
          .sort((left, right) => (Number(right && right.entityID) || 0) - (Number(left && left.entityID) || 0))[0] || null;
        if (latestSummary) {
          return {
            success: true,
            data: {
              ...refreshed.data,
              summary: latestSummary,
              spawnedFresh: true,
            },
          };
        }
      }
    }
  }

  return {
    success: true,
    data: {
      ...loadResult.data,
      spawnedFresh: false,
    },
  };
}

function formatSuggestions(suggestions = []) {
  return suggestions.length > 0
    ? ` Suggestions: ${suggestions.join(", ")}.`
    : "";
}

function buildSelectionErrorMessage(query, errorMsg, suggestions = []) {
  const suffix = formatSuggestions(suggestions);
  if (errorMsg === "PROFILE_AMBIGUOUS") {
    return `Capital NPC selection is ambiguous: ${query}.${suffix}`.trim();
  }
  return `Capital NPC selection not found: ${query || "default"}.${suffix}`.trim();
}

function handleCapnpc(session, argumentText) {
  const parsedArguments = parseAmountAndQuery(argumentText, {
    defaultAmount: 1,
  });
  if (!parsedArguments.success) {
    return {
      handled: true,
      message: "Usage: /capnpc [amount] [capital faction|class|name]",
    };
  }
  if (parsedArguments.amount > MAX_CAPITAL_NPC_COMMAND_SPAWN_COUNT) {
    return {
      handled: true,
      message: `Capital NPC spawn count must be between 1 and ${MAX_CAPITAL_NPC_COMMAND_SPAWN_COUNT}.`,
    };
  }

  const capitalResolution = resolveCapitalSelection(parsedArguments.query);
  if (!capitalResolution.success) {
    return {
      handled: true,
      message: buildSelectionErrorMessage(
        parsedArguments.query,
        capitalResolution.errorMsg,
        capitalResolution.suggestions,
      ),
    };
  }

  const resolvedSelection = capitalResolution.data;
  const result = npcService.runtime.spawnBatchForSession(session, {
    profileQuery: resolvedSelection.id,
    amount: parsedArguments.amount,
    transient: true,
    preferPools: resolvedSelection.kind === "pool",
    defaultPoolID: "capital_npc_all",
  });
  if (!result.success) {
    const suggestions = formatSuggestions(result.suggestions);
    let message = "Capital NPC spawn failed.";
    if (result.errorMsg === "NOT_IN_SPACE") {
      message = "You must be in space before using /capnpc.";
    } else if (result.errorMsg === "SHIP_NOT_FOUND") {
      message = "Active ship was not found in space.";
    } else if (result.errorMsg === "PROFILE_NOT_FOUND") {
      message = `Capital NPC profile or pool not found: ${parsedArguments.query || "default"}.${suggestions}`;
    } else if (result.errorMsg === "PROFILE_AMBIGUOUS") {
      message = `Capital NPC profile or pool is ambiguous: ${parsedArguments.query}.${suggestions}`;
    } else if (result.errorMsg === "NPC_DEFINITION_INCOMPLETE") {
      message = "The selected capital NPC is missing authored loadout or behavior data.";
    } else if (result.errorMsg === "POOL_EMPTY") {
      message = `The selected capital NPC pool has no spawnable authored entries.${suggestions}`.trim();
    } else {
      message = `Capital NPC spawn failed: ${result.errorMsg || "UNKNOWN_ERROR"}.${suggestions}`.trim();
    }
    return {
      handled: true,
      message,
    };
  }

  return {
    handled: true,
    message: formatSpawnSummary(result),
  };
}

function handleCapnpcinfo(session, argumentText) {
  void session;
  const selection = resolveCapitalSelection(argumentText);
  if (!selection.success) {
    return {
      handled: true,
      message: buildSelectionErrorMessage(argumentText, selection.errorMsg, selection.suggestions),
    };
  }
  return {
    handled: true,
    message: formatSelectionInfo(selection.data),
  };
}

function handleCapnpcstatus(session, argumentText) {
  const liveResult = getSystemCapitalSummaries(npcService, session, argumentText);
  if (!liveResult.success) {
    return {
      handled: true,
      message: buildSelectionErrorMessage(argumentText, liveResult.errorMsg, liveResult.suggestions),
    };
  }
  return {
    handled: true,
    message: formatLiveStatus(
      liveResult.data.selection.label,
      liveResult.data.summaries,
      liveResult.data.scene,
    ),
  };
}

function handleCapnpcclear(session, argumentText) {
  const liveResult = getSystemCapitalSummaries(npcService, session, argumentText || "all");
  if (!liveResult.success) {
    return {
      handled: true,
      message: buildSelectionErrorMessage(argumentText, liveResult.errorMsg, liveResult.suggestions),
    };
  }

  let destroyedCount = 0;
  for (const summary of liveResult.data.summaries) {
    const destroyResult = npcService.destroyNpcControllerByEntityID(summary.entityID, {
      removeContents: true,
    });
    if (destroyResult && destroyResult.success) {
      destroyedCount += 1;
    }
  }

  return {
    handled: true,
    message: formatClearResult(liveResult.data.selection.label, destroyedCount),
  };
}

function handleCapnpctarget(session, argumentText) {
  const parsed = parseQueryAndTarget(argumentText, {
    defaultQuery: "all",
  });
  if (!parsed.success) {
    return {
      handled: true,
      message: "Usage: /capnpctarget [query] <me|entityID>",
    };
  }
  const targetResult = resolveTargetEntity(session, parsed.targetToken);
  if (!targetResult.success) {
    return {
      handled: true,
      message:
        targetResult.errorMsg === "SHIP_NOT_FOUND"
          ? "Active ship was not found in space."
          : targetResult.errorMsg === "NOT_IN_SPACE"
            ? "You must be in space before using /capnpctarget."
            : `Target not found: ${parsed.targetToken}.`,
    };
  }

  const liveResult = getSystemCapitalSummaries(npcService, session, parsed.query);
  if (!liveResult.success) {
    return {
      handled: true,
      message: buildSelectionErrorMessage(parsed.query, liveResult.errorMsg, liveResult.suggestions),
    };
  }

  let updatedCount = 0;
  for (const summary of liveResult.data.summaries) {
    const orderResult = issueCapitalAttackOrder(
      summary.entityID,
      targetResult.data.itemID,
      { wakeController: false },
    );
    if (orderResult && orderResult.success) {
      updatedCount += 1;
    }
  }

  return {
    handled: true,
    message: formatManualOrderResult(
      "Set attack order for",
      liveResult.data.selection.label,
      updatedCount,
      `${targetResult.data.itemName || targetResult.data.itemID}`,
    ),
  };
}

function handleCapnpchome(session, argumentText) {
  const liveResult = getSystemCapitalSummaries(npcService, session, argumentText || "all");
  if (!liveResult.success) {
    return {
      handled: true,
      message: buildSelectionErrorMessage(argumentText, liveResult.errorMsg, liveResult.suggestions),
    };
  }

  let updatedCount = 0;
  for (const summary of liveResult.data.summaries) {
    const orderResult = npcService.issueManualOrder(summary.entityID, {
      type: "returnHome",
    });
    if (orderResult && orderResult.success) {
      updatedCount += 1;
    }
  }

  return {
    handled: true,
    message: formatManualOrderResult(
      "Queued return-home for",
      liveResult.data.selection.label,
      updatedCount,
    ),
  };
}

function handleCapnpcfighters(session, argumentText) {
  const parsed = parseActionAndQuery(argumentText, {
    allowedActions: ["status", "launch", "reset"],
    defaultAction: "status",
    defaultQuery: "all",
  });
  const liveResult = getSystemCapitalSummaries(npcService, session, parsed.query);
  if (!liveResult.success) {
    return {
      handled: true,
      message: buildSelectionErrorMessage(parsed.query, liveResult.errorMsg, liveResult.suggestions),
    };
  }

  const fighterControllers = liveResult.data.summaries.filter((summary) => {
    const controller = npcService.getControllerByEntityID(summary.entityID);
    const behaviorProfile = controller && controller.behaviorProfile;
    return Array.isArray(behaviorProfile && behaviorProfile.capitalFighterWingTypeIDs);
  });

  if (parsed.action === "status") {
    const entries = fighterControllers.map((summary) => {
      const controller = npcService.getControllerByEntityID(summary.entityID);
      const entity = liveResult.data.scene.getEntityByID(Number(summary.entityID) || 0);
      const capitalState = getCapitalControllerState(controller);
      return {
        entityID: summary.entityID,
        profileID: summary.profileID,
        fighterCount: listControlledNpcFighters(liveResult.data.scene, summary.entityID).length,
        trackedTubeCount: buildTrackedTubeFlagSet(liveResult.data.scene, entity, controller).size,
        nextLaunchMs: Math.max(
          0,
          toFiniteNumber(capitalState && capitalState.nextFighterLaunchAtMs, 0) -
            liveResult.data.scene.getCurrentSimTimeMs(),
        ),
      };
    });
    return {
      handled: true,
      message: formatFighterStatus(liveResult.data.selection.label, entries),
    };
  }

  let controllerCount = 0;
  let fighterCount = 0;
  for (const summary of fighterControllers) {
    const controller = npcService.getControllerByEntityID(summary.entityID);
    const entity = liveResult.data.scene.getEntityByID(Number(summary.entityID) || 0);
    if (!controller || !entity) {
      continue;
    }
    if (parsed.action === "reset") {
      const resetResult = resetNpcSupercarrierWing(liveResult.data.scene, entity, controller, {
        removeContents: true,
      });
      if (resetResult && resetResult.success) {
        fighterCount += Number(resetResult.data && resetResult.data.destroyedCount) || 0;
      }
    } else {
      const capitalState = getCapitalControllerState(controller);
      resetNpcSupercarrierTubeState(controller);
      if (capitalState) {
        capitalState.nextFighterLaunchAtMs = 0;
      }
    }
    npcService.wakeNpcController(summary.entityID, 0);
    controllerCount += 1;
  }

  return {
    handled: true,
    message:
      parsed.action === "reset"
        ? formatFighterReset(liveResult.data.selection.label, controllerCount, fighterCount, "Reset fighter wings for")
        : formatFighterReset(liveResult.data.selection.label, controllerCount, fighterCount, "Queued fighter relaunch for"),
  };
}

function handleCapnpcsuper(session, argumentText) {
  const parsed = parseActionQueryAndTarget(argumentText, {
    allowedActions: ["status", "fire"],
    defaultAction: "status",
    defaultQuery: "all",
  });
  const liveResult = getSystemCapitalSummaries(npcService, session, parsed.query);
  if (!liveResult.success) {
    return {
      handled: true,
      message: buildSelectionErrorMessage(parsed.query, liveResult.errorMsg, liveResult.suggestions),
    };
  }

  const titanSummaries = liveResult.data.summaries.filter((summary) => {
    const controller = npcService.getControllerByEntityID(summary.entityID);
    const behaviorProfile = controller && controller.behaviorProfile;
    return toPositiveInt(behaviorProfile && behaviorProfile.capitalSuperweaponModuleTypeID, 0) > 0;
  });

  if (parsed.action === "status") {
    const entries = titanSummaries.map((summary) => {
      const controller = npcService.getControllerByEntityID(summary.entityID);
      const entity = liveResult.data.scene.getEntityByID(Number(summary.entityID) || 0);
      const behaviorProfile = controller && controller.behaviorProfile;
      const moduleTypeID = toPositiveInt(behaviorProfile && behaviorProfile.capitalSuperweaponModuleTypeID, 0);
      const moduleItem = (Array.isArray(entity && entity.fittedItems) ? entity.fittedItems : []).find((item) => (
        toPositiveInt(item && item.typeID, 0) === moduleTypeID
      ));
      const fuelTypeID = toPositiveInt(resolveFuelTypeID(moduleTypeID), 0);
      const fuelQuantity = (Array.isArray(entity && entity.nativeCargoItems) ? entity.nativeCargoItems : [])
        .filter((item) => toPositiveInt(item && item.typeID, 0) === fuelTypeID)
        .reduce((sum, item) => sum + (Number(item && item.quantity) || Number(item && item.stacksize) || 0), 0);
      const capitalState = getCapitalControllerState(controller);
      return {
        entityID: summary.entityID,
        profileID: summary.profileID,
        moduleTypeID,
        fuelQuantity,
        active: Boolean(
          entity &&
          entity.activeModuleEffects instanceof Map &&
          moduleItem &&
          entity.activeModuleEffects.has(Number(moduleItem.itemID) || 0)
        ),
        nextAttemptMs: Math.max(
          0,
          toFiniteNumber(capitalState && capitalState.nextSuperweaponAttemptAtMs, 0) -
            liveResult.data.scene.getCurrentSimTimeMs(),
        ),
      };
    });
    return {
      handled: true,
      message: formatSuperStatus(liveResult.data.selection.label, entries),
    };
  }

  const targetResult = resolveTargetEntity(session, parsed.targetToken || "me");
  if (!targetResult.success) {
    return {
      handled: true,
      message:
        targetResult.errorMsg === "SHIP_NOT_FOUND"
          ? "Active ship was not found in space."
          : targetResult.errorMsg === "NOT_IN_SPACE"
            ? "You must be in space before using /capnpcsuper."
            : `Target not found: ${parsed.targetToken || "me"}.`,
    };
  }

  let armedCount = 0;
  for (const summary of titanSummaries) {
    const controller = npcService.getControllerByEntityID(summary.entityID);
    const capitalState = getCapitalControllerState(controller);
    if (capitalState) {
      capitalState.nextSuperweaponAttemptAtMs = 0;
    }
    issueCapitalAttackOrder(summary.entityID, targetResult.data.itemID);
    armedCount += 1;
  }

  return {
    handled: true,
    message: formatManualOrderResult(
      "Armed superweapons for",
      liveResult.data.selection.label,
      armedCount,
      `${targetResult.data.itemName || targetResult.data.itemID}`,
    ),
  };
}

function handleCapnpcsignoff(session, argumentText) {
  const parsed = parseQueryAndOptionalTarget(argumentText, {
    defaultQuery: "",
  });
  if (!parsed.success || !parsed.query) {
    return {
      handled: true,
      message: "Usage: /capnpcsignoff <capital hull name> [me|entityID]",
    };
  }

  const selection = resolveCapitalSelection(parsed.query);
  if (!selection.success) {
    return {
      handled: true,
      message: buildSelectionErrorMessage(parsed.query, selection.errorMsg, selection.suggestions),
    };
  }
  if (!selection.data || selection.data.kind !== "profile") {
    return {
      handled: true,
      message: "Capital signoff requires a single authored hull profile, not a pool.",
    };
  }

  const targetResult = resolveTargetEntity(session, parsed.targetToken || "me");
  if (!targetResult.success) {
    return {
      handled: true,
      message:
        targetResult.errorMsg === "SHIP_NOT_FOUND"
          ? "Active ship was not found in space."
          : targetResult.errorMsg === "NOT_IN_SPACE"
            ? "You must be in space before using /capnpcsignoff."
            : `Target not found: ${parsed.targetToken || "me"}.`,
    };
  }

  const liveCapitalResult = acquireCapitalForSignoff(session, selection.data, targetResult.data);
  if (!liveCapitalResult.success) {
    return {
      handled: true,
      message: `Capital signoff prep failed: ${liveCapitalResult.errorMsg || "UNKNOWN_ERROR"}.`,
    };
  }

  const scene = liveCapitalResult.data.scene;
  const summary = liveCapitalResult.data.summary;
  const entity = scene.getEntityByID(Number(summary && summary.entityID) || 0);
  const controller = entity ? npcService.getControllerByEntityID(summary.entityID) : null;
  const behaviorProfile = controller && controller.behaviorProfile;
  if (!entity || !controller || !behaviorProfile) {
    return {
      handled: true,
      message: "Capital signoff prep failed: live capital controller was not found.",
    };
  }

  const capitalState = getCapitalControllerState(controller);
  if (capitalState) {
    capitalState.lastTargetID = 0;
    capitalState.lastTargetSwapAtMs = 0;
    capitalState.lastWeaponTargetID = 0;
    capitalState.lastWeaponAuthorizeAtMs = 0;
    capitalState.settledAtMs = 0;
    capitalState.lastMovementCommandAtMs = 0;
  }

  let message = "";
  if (Array.isArray(behaviorProfile.capitalFighterWingTypeIDs)) {
    const resetResult = resetNpcSupercarrierWing(scene, entity, controller, {
      removeContents: true,
    });
    if (!(resetResult && resetResult.success)) {
      return {
        handled: true,
        message: `Capital signoff prep failed: ${resetResult && resetResult.errorMsg ? resetResult.errorMsg : "FIGHTER_RESET_FAILED"}.`,
      };
    }
    if (capitalState) {
      capitalState.nextFighterLaunchAtMs = 0;
      capitalState.nextFighterAbilitySyncAtMs = 0;
    }
    controller.currentTargetID = 0;
    issueCapitalAttackOrder(summary.entityID, targetResult.data.itemID);

    const runtimeConfig = getCapitalRuntimeConfig(entity && entity.capitalClassID);
    const wingEntries = behaviorProfile.capitalFighterWingTypeIDs;
    const launchQuota = Math.max(
      1,
      toPositiveInt(
        behaviorProfile.capitalFighterLaunchPerThink,
        runtimeConfig.fighterLaunchPerThink,
      ),
    );
    const launchIntervalMs = Math.max(
      250,
      toPositiveInt(
        behaviorProfile.capitalFighterLaunchIntervalMs,
        runtimeConfig.fighterLaunchIntervalMs,
      ),
    );
    const abilitySyncIntervalMs = Math.max(
      250,
      toPositiveInt(
        behaviorProfile.capitalFighterAbilitySyncIntervalMs,
        runtimeConfig.fighterAbilitySyncIntervalMs,
      ),
    );
    const fullWingMs = Math.max(
      0,
      (Math.max(0, Math.ceil(wingEntries.length / launchQuota) - 1) * launchIntervalMs),
    );
    message = formatSignoffSummary({
      signoffKind: "fighter",
      profileName: selection.data.authorityEntry && selection.data.authorityEntry.name,
      entityID: summary.entityID,
      spawnedFresh: liveCapitalResult.data.spawnedFresh === true,
      targetName: targetResult.data.itemName || targetResult.data.itemID,
      wingText: summarizeWingTypes(wingEntries),
      launchQuota,
      launchIntervalMs,
      abilitySyncIntervalMs,
      fullWingMs,
    });
  } else if (toPositiveInt(behaviorProfile.capitalSuperweaponModuleTypeID, 0) > 0) {
    if (capitalState) {
      capitalState.nextSuperweaponAttemptAtMs = 0;
    }
    issueCapitalAttackOrder(summary.entityID, targetResult.data.itemID);

    const readiness = resolveTitanReadiness(scene, entity, behaviorProfile, targetResult.data);
    if (!readiness.contract) {
      return {
        handled: true,
        message: `Capital signoff prep failed: ${readiness.active ? "superweapon already active" : "superweapon contract unavailable"}.`,
      };
    }
    const titanProfile = resolveTitanSuperweaponProfileByModuleTypeID(readiness.moduleTypeID);
    message = formatSignoffSummary({
      signoffKind: "titan",
      profileName: selection.data.authorityEntry && selection.data.authorityEntry.name,
      entityID: summary.entityID,
      spawnedFresh: liveCapitalResult.data.spawnedFresh === true,
      targetName: targetResult.data.itemName || targetResult.data.itemID,
      family: readiness.contract.family,
      moduleTypeID: readiness.moduleTypeID,
      fxGuid: readiness.contract.fxGuid,
      warningDurationMs: readiness.contract.warningDurationMs,
      damageDelayMs: readiness.contract.damageDelayMs,
      damageCycleTimeMs: readiness.contract.damageCycleTimeMs,
      fuelQuantity: readiness.fuelQuantity,
      fuelPerActivation: readiness.contract.fuelPerActivation,
      fuelName: titanProfile && titanProfile.fuelName,
    });
  } else {
    issueCapitalAttackOrder(summary.entityID, targetResult.data.itemID);
    const doctrine = resolveCapitalDoctrine(entity, behaviorProfile);
    message = formatSignoffSummary({
      signoffKind: "capital",
      profileName: selection.data.authorityEntry && selection.data.authorityEntry.name,
      entityID: summary.entityID,
      spawnedFresh: liveCapitalResult.data.spawnedFresh === true,
      targetName: targetResult.data.itemName || targetResult.data.itemID,
      preferredRangeMeters: doctrine && doctrine.preferredCombatRangeMeters,
      settleToleranceMeters: doctrine && doctrine.settleToleranceMeters,
    });
  }

  return {
    handled: true,
    message,
  };
}

function handleCapnpcperf(session, argumentText) {
  void argumentText;
  const systemID = resolveSessionSystemID(session);
  const scene = spaceRuntime.ensureScene(systemID);
  const capitalSummaries = npcService.getNpcOperatorSummary().filter((summary) => (
    summary &&
    summary.capitalNpc === true &&
    Number(summary.systemID) === systemID
  ));
  const byClass = new Map();
  for (const summary of capitalSummaries) {
    byClass.set(summary.capitalClassID || "capital", (byClass.get(summary.capitalClassID || "capital") || 0) + 1);
  }
  const fighterCount = capitalSummaries.reduce(
    (sum, summary) => sum + listControlledNpcFighters(scene, summary.entityID).length,
    0,
  );
  return {
    handled: true,
    message: formatPerfSummary(systemID, capitalSummaries.length, fighterCount, byClass),
  };
}

const HANDLERS = Object.freeze({
  capnpc: handleCapnpc,
  capnpcinfo: handleCapnpcinfo,
  capnpcstatus: handleCapnpcstatus,
  capnpcclear: handleCapnpcclear,
  capnpctarget: handleCapnpctarget,
  capnpchome: handleCapnpchome,
  capnpcfighters: handleCapnpcfighters,
  capnpcsuper: handleCapnpcsuper,
  capnpcsignoff: handleCapnpcsignoff,
  capnpcperf: handleCapnpcperf,
});

function executeCapitalNpcCommand(session, command, argumentText) {
  const handler = HANDLERS[String(command || "").trim().toLowerCase()];
  if (typeof handler !== "function") {
    return {
      handled: false,
      message: "",
    };
  }
  return handler(session, argumentText);
}

module.exports = {
  executeCapitalNpcCommand,
};
