const path = require("path");

const {
  getCharacterWallet,
  adjustCharacterBalance,
} = require(path.join(__dirname, "../account/walletState"));
const {
  getCorporationOfficeByInventoryID,
} = require(path.join(__dirname, "../corporation/corporationRuntimeState"));
const {
  getAccessibleCorpHangarFlags,
  getSessionCharacterID,
  getSessionCorporationID,
} = require(path.join(__dirname, "../industry/industryAccess"));
const {
  ITEM_FLAGS,
  grantItemsToOwnerLocation,
  listOwnedItems,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveItemByName,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  getDockedLocationID,
  getDockedLocationKind,
  isDockedSession,
} = require(path.join(__dirname, "../structure/structureLocation"));
const {
  buildReprocessingQuoteForItem,
  getReprocessingFacilityRigTypeIDs,
  getReprocessingProfile,
  getReprocessingRigProfile,
  getStructureReprocessingProfile,
  listReprocessingRigProfilesBySize,
  reprocessItems,
  resolveReprocessingContext,
  setReprocessingFacilityRigTypeIDs,
} = require("./index");

const SAMPLE_REPROCESSING_ITEMS = Object.freeze([
  { name: "Veldspar", quantity: 100000 },
  { name: "Compressed Veldspar", quantity: 1000 },
  { name: "Clear Icicle", quantity: 1000 },
  { name: "Bitumens", quantity: 10000 },
  { name: "Prismaticite", quantity: 1000 },
  { name: "Metal Scraps", quantity: 10000 },
]);
const SMOKE_WALLET_FLOOR = 50_000_000;
const ITEM_FLAG_CORP_HANGAR_1 = 115;

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

function ensureDocked(session) {
  return Boolean(isDockedSession(session) && getDockedLocationID(session) > 0);
}

function resolvePresetRigTypeID(preset, rigSize) {
  const normalizedPreset = String(preset || "").trim().toLowerCase();
  const compatibleProfiles = listReprocessingRigProfilesBySize(rigSize);
  if (compatibleProfiles.length <= 0) {
    return 0;
  }
  const wantTier = normalizedPreset.endsWith("2") ? "ii" : "i";
  const wantCoverage =
    normalizedPreset.startsWith("ore") ? "ore"
      : normalizedPreset.startsWith("moon") ? "moon_ore"
        : normalizedPreset.startsWith("ice") ? "ice"
          : normalizedPreset.startsWith("monitor") ? "monitor"
            : "";

  const profile = compatibleProfiles.find((entry) => {
    const lowerName = String(entry.name || "").trim().toLowerCase();
    if (wantCoverage === "monitor") {
      return entry.isGeneralMonitor === true && lowerName.endsWith(` ${wantTier}`);
    }
    return Array.isArray(entry.yieldClasses) &&
      entry.yieldClasses.length === 1 &&
      entry.yieldClasses[0] === wantCoverage &&
      lowerName.endsWith(` ${wantTier}`);
  });
  return toInt(profile && profile.typeID, 0);
}

function buildHelpText() {
  return [
    "/reprocesssmoke help",
    "/reprocesssmoke seed",
    "/reprocesssmoke status",
    "/reprocesssmoke rig <none|ore1|ore2|moon1|moon2|ice1|ice2|monitor1|monitor2>",
    "/reprocesssmoke quote <item name>",
    "/reprocesssmoke run <item name> [corp]",
  ].join("\n");
}

function buildSeedPlan() {
  return SAMPLE_REPROCESSING_ITEMS
    .map((entry) => {
      const lookup = resolveItemByName(entry.name);
      return lookup && lookup.success && lookup.match
        ? {
          itemType: lookup.match.typeID,
          name: lookup.match.name,
          quantity: entry.quantity,
        }
        : null;
    })
    .filter(Boolean);
}

function topUpWallet(characterID) {
  const wallet = getCharacterWallet(characterID);
  const balance = Number(wallet && wallet.balance) || 0;
  if (balance >= SMOKE_WALLET_FLOOR) {
    return balance;
  }
  adjustCharacterBalance(characterID, SMOKE_WALLET_FLOOR - balance, {
    description: "Reprocessing smoke wallet top-up",
    ownerID1: characterID,
    ownerID2: characterID,
    referenceID: characterID,
  });
  return SMOKE_WALLET_FLOOR;
}

function findHangarItemByName(session, token) {
  const characterID = getSessionCharacterID(session);
  const locationID = getDockedLocationID(session);
  const lookup = resolveItemByName(token);
  if (!lookup || !lookup.success || !lookup.match) {
    return null;
  }
  return listOwnedItems(characterID, {
    locationID,
    flagID: ITEM_FLAGS.HANGAR,
  })
    .filter((item) => toInt(item && item.typeID, 0) === toInt(lookup.match.typeID, 0))
    .sort((left, right) => {
      const rightQty = Number(right && (right.stacksize ?? right.quantity)) || 0;
      const leftQty = Number(left && (left.stacksize ?? left.quantity)) || 0;
      // Prefer the smallest matching stack so the smoke harness picks the
      // deterministic seeded sample instead of an older oversized GM stack.
      if (leftQty !== rightQty) {
        return leftQty - rightQty;
      }
      return toInt(right && right.itemID, 0) - toInt(left && left.itemID, 0);
    })[0] || null;
}

function formatOutputSummary(outputByTypeID = {}) {
  const entries = Object.entries(outputByTypeID)
    .map(([typeID, quantity]) => ({
      typeID: toInt(typeID, 0),
      quantity: Math.max(0, toInt(quantity, 0)),
    }))
    .filter((entry) => entry.typeID > 0 && entry.quantity > 0)
    .sort((left, right) => right.quantity - left.quantity);
  if (entries.length <= 0) {
    return "no output";
  }
  return entries
    .slice(0, 6)
    .map((entry) => `${entry.typeID} x${entry.quantity.toLocaleString("en-US")}`)
    .join(", ");
}

function executeReprocessingSmokeCommand(session, argumentText = "") {
  if (!ensureDocked(session)) {
    return {
      ok: false,
      message: "You must be docked before using /reprocesssmoke.",
    };
  }

  const [rawSubcommand, ...rest] = String(argumentText || "").trim().split(/\s+/).filter(Boolean);
  const subcommand = String(rawSubcommand || "seed").trim().toLowerCase();
  const remainder = rest.join(" ").trim();
  const characterID = getSessionCharacterID(session);
  const locationID = getDockedLocationID(session);
  const contextResult = resolveReprocessingContext(session);
  if (!contextResult.success || !contextResult.data) {
    return {
      ok: false,
      message: "Reprocessing context is not available for this session.",
    };
  }

  if (subcommand === "help") {
    return {
      ok: true,
      message: buildHelpText(),
    };
  }

  if (subcommand === "seed") {
    const seedPlan = buildSeedPlan();
    if (seedPlan.length <= 0) {
      return {
        ok: false,
        message: "No smoke-test reprocessing items could be resolved from the type registry.",
      };
    }
    const grantResult = grantItemsToOwnerLocation(
      characterID,
      locationID,
      ITEM_FLAGS.HANGAR,
      seedPlan,
    );
    if (!grantResult.success) {
      return {
        ok: false,
        message: "Failed to seed the smoke-test reprocessing inputs.",
      };
    }
    const balance = topUpWallet(characterID);
    return {
      ok: true,
      message: `Seeded ${seedPlan.length} reprocessing sample stacks into your hangar and topped wallet to ${formatIsk(balance)}.`,
    };
  }

  if (subcommand === "status") {
    const structureProfile = getStructureReprocessingProfile(
      contextResult.data.structure && contextResult.data.structure.typeID,
    );
    const rigNames = getReprocessingFacilityRigTypeIDs(locationID)
      .map((typeID) => getReprocessingRigProfile(typeID))
      .filter(Boolean)
      .map((profile) => profile.name);
    return {
      ok: true,
      message: [
        `Facility ${locationID} (${getDockedLocationKind(session)})`,
        structureProfile
          ? `yield bonus ${Number(structureProfile.reprocessingYieldBonusPercent || 0).toFixed(2)}%, gas ${(Number(structureProfile.gasDecompressionEfficiencyBase || 0) + Number(structureProfile.gasDecompressionEfficiencyBonusAdd || 0)).toFixed(3)}`
          : "no structure reprocessing bonus profile",
        rigNames.length > 0 ? `rigs: ${rigNames.join(", ")}` : "rigs: none",
      ].join(" | "),
    };
  }

  if (subcommand === "rig") {
    if (getDockedLocationKind(session) !== "structure") {
      return {
        ok: false,
        message: "Rig presets only apply while docked in a structure with the reprocessing service.",
      };
    }
    const structureProfile = getStructureReprocessingProfile(
      contextResult.data.structure && contextResult.data.structure.typeID,
    );
    const rigSize = toInt(structureProfile && structureProfile.rigSize, 0);
    const preset = String(rest[0] || "").trim().toLowerCase();
    if (!preset) {
      return {
        ok: false,
        message: "Usage: /reprocesssmoke rig <none|ore1|ore2|moon1|moon2|ice1|ice2|monitor1|monitor2>",
      };
    }
    const rigTypeID = preset === "none" ? 0 : resolvePresetRigTypeID(preset, rigSize);
    if (preset !== "none" && rigTypeID <= 0) {
      return {
        ok: false,
        message: `No compatible ${preset} rig profile was found for structure rig size ${rigSize}.`,
      };
    }
    const saveResult = setReprocessingFacilityRigTypeIDs(
      locationID,
      rigTypeID > 0 ? [rigTypeID] : [],
    );
    if (!saveResult.success) {
      return {
        ok: false,
        message: "Failed to persist the reprocessing rig preset for this facility.",
      };
    }
    const rigProfile = rigTypeID > 0 ? getReprocessingRigProfile(rigTypeID) : null;
    return {
      ok: true,
      message: rigProfile
        ? `Reprocessing rig set to ${rigProfile.name} for facility ${locationID}.`
        : `Cleared all reprocessing rig overrides for facility ${locationID}.`,
    };
  }

  if (subcommand === "quote") {
    if (!remainder) {
      return {
        ok: false,
        message: "Usage: /reprocesssmoke quote <item name>",
      };
    }
    const item = findHangarItemByName(session, remainder);
    if (!item) {
      return {
        ok: false,
        message: `No hangar item matched "${remainder}".`,
      };
    }
    const quote = buildReprocessingQuoteForItem(item, contextResult.data, {
      includeRecoverablesFromRandomizedOutputs: false,
    });
    if (!quote) {
      return {
        ok: false,
        message: `No reprocessing quote is available for "${remainder}".`,
      };
    }
    if (quote.errorMsg) {
      return {
        ok: false,
        message:
          quote.errorMsg === "REPROCESSING_SPLIT_REQUIRED"
            ? `The selected ${remainder} stack is too large for a safe retail quote preview. Split it or use a smaller stack.`
            : `Failed to build a reprocessing quote for "${remainder}".`,
      };
    }
    return {
      ok: true,
      message: [
        `${remainder}:`,
        `${quote.quantityToProcess.toLocaleString("en-US")} processed, ${quote.leftOvers.toLocaleString("en-US")} left over`,
        `station ${Number(quote.stationEfficiency || 0).toFixed(4)}, combined ${Number(quote.efficiency || 0).toFixed(4)}`,
        `tax ${formatIsk(quote.totalISKCost)}`,
      ].join(" | "),
    };
  }

  if (subcommand === "run") {
    if (!remainder) {
      return {
        ok: false,
        message: "Usage: /reprocesssmoke run <item name> [corp]",
      };
    }
    const corpRoute = /\s+corp$/i.test(remainder);
    const lookupText = corpRoute ? remainder.replace(/\s+corp$/i, "").trim() : remainder;
    const item = findHangarItemByName(session, lookupText);
    if (!item) {
      return {
        ok: false,
        message: `No hangar item matched "${lookupText}".`,
      };
    }

    const runOptions = {
      itemIDs: [item.itemID],
      fromLocationID: locationID,
    };
    if (corpRoute) {
      const corporationID = getSessionCorporationID(session);
      const office = getCorporationOfficeByInventoryID(corporationID, locationID);
      const outputFlagID = getAccessibleCorpHangarFlags(session, locationID, {
        takeRequired: true,
      })[0] || ITEM_FLAG_CORP_HANGAR_1;
      if (!office || toInt(office.officeID, 0) <= 0) {
        return {
          ok: false,
          message: "No corporation office is available here for corp-routed reprocessing output.",
        };
      }
      runOptions.ownerID = corporationID;
      runOptions.outputLocationID = toInt(office.officeID, 0);
      runOptions.outputFlagID = outputFlagID;
    }

    const result = reprocessItems(session, runOptions);
    if (!result.success || !result.data) {
      return {
        ok: false,
        message: `Reprocessing run failed: ${result.errorMsg || "unknown error"}.`,
      };
    }
    return {
      ok: true,
      message: [
        `${lookupText}:`,
        `${result.data.processedItemIDs.length} input stack processed`,
        `output ${formatOutputSummary(result.data.outputByTypeID)}`,
        corpRoute ? "corp routed" : "personal routed",
      ].join(" | "),
    };
  }

  return {
    ok: false,
    message: `Unknown /reprocesssmoke subcommand "${subcommand}". Use /reprocesssmoke help.`,
  };
}

module.exports = {
  executeReprocessingSmokeCommand,
};
