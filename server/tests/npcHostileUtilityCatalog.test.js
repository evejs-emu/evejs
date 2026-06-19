const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const {
  getNpcSpawnPool,
  buildNpcDefinition,
} = require(path.join(repoRoot, "server/src/space/npc/npcData"));
const {
  selectAutoFitFlagForNpcModuleType,
} = require(path.join(repoRoot, "server/src/space/npc/npcCapabilityResolver"));
const {
  resolveItemByTypeID,
} = require(path.join(repoRoot, "server/src/services/inventory/itemTypeRegistry"));

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function resolveAuthoredModuleQuantity(moduleEntry) {
  const explicitQuantity = toPositiveInt(moduleEntry && moduleEntry.quantity, 0);
  if (explicitQuantity > 0) {
    return explicitQuantity;
  }
  const explicitFlags = Array.isArray(moduleEntry && moduleEntry.flagIDs)
    ? moduleEntry.flagIDs.filter(Boolean)
    : [];
  return explicitFlags.length > 0 ? explicitFlags.length : 1;
}

function normalizeExplicitFlagList(moduleEntry, quantity) {
  const explicitFlags = Array.isArray(moduleEntry && moduleEntry.flagIDs)
    ? moduleEntry.flagIDs
      .map((value) => toPositiveInt(value, 0))
      .filter((value) => value > 0)
    : [];
  if (explicitFlags.length >= quantity) {
    return explicitFlags.slice(0, quantity);
  }
  return explicitFlags;
}

function validateDefinitionFitsSlots(definition) {
  const shipTypeID = toPositiveInt(
    definition && definition.profile && definition.profile.shipTypeID,
    0,
  );
  const shipType = resolveItemByTypeID(shipTypeID);
  const fittedModules = [];
  const authoredModules = Array.isArray(
    definition && definition.loadout && definition.loadout.modules,
  )
    ? definition.loadout.modules
    : [];

  for (const moduleEntry of authoredModules) {
    const moduleTypeID = toPositiveInt(moduleEntry && moduleEntry.typeID, 0);
    const moduleType = resolveItemByTypeID(moduleTypeID);
    const npcCapabilityTypeID = toPositiveInt(
      moduleEntry && moduleEntry.npcCapabilityTypeID,
      0,
    );
    if (!moduleType) {
      return {
        success: false,
        errorMsg: "NPC_NATIVE_MODULE_TYPE_NOT_FOUND",
        moduleTypeID,
      };
    }

    const quantity = resolveAuthoredModuleQuantity(moduleEntry);
    const explicitFlags = normalizeExplicitFlagList(moduleEntry, quantity);
    for (let index = 0; index < quantity; index += 1) {
      const flagID = explicitFlags[index] || selectAutoFitFlagForNpcModuleType(
        { typeID: shipTypeID },
        fittedModules,
        {
          typeID: moduleTypeID,
          npcCapabilityTypeID,
        },
      );
      if (!flagID) {
        return {
          success: false,
          errorMsg: "NPC_NATIVE_NO_FREE_SLOT",
          shipTypeID,
          shipTypeName: shipType && shipType.name,
          moduleTypeID,
          moduleTypeName: moduleType.name,
          profileID: definition && definition.profile && definition.profile.profileID,
        };
      }
      fittedModules.push({
        moduleID: fittedModules.length + 1,
        flagID,
        typeID: moduleTypeID,
        npcCapabilityTypeID,
        groupID: toPositiveInt(moduleType && moduleType.groupID, 0),
        categoryID: toPositiveInt(moduleType && moduleType.categoryID, 0),
      });
    }
  }

  return { success: true };
}

test("hostile utility augmentation does not overfill authored hostile NPC hull slots", () => {
  const pool = getNpcSpawnPool("npc_hostiles");
  assert.ok(pool, "expected npc_hostiles pool to exist");

  const failures = [];
  for (const entry of Array.isArray(pool.entries) ? pool.entries : []) {
    const profileID = String(entry && entry.profileID || "").trim();
    const definition = buildNpcDefinition(profileID);
    assert.ok(definition, `expected npc definition for ${profileID}`);
    const fitResult = validateDefinitionFitsSlots(definition);
    if (!fitResult.success) {
      failures.push(fitResult);
    }
  }

  assert.deepEqual(failures, []);
});
