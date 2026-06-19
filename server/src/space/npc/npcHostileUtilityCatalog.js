const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const hostileUtilityResult = database.read("npcHostileUtilities", "/");
const hostileUtilityData = hostileUtilityResult.success ? hostileUtilityResult.data : {};
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../services/inventory/itemTypeRegistry"));
const {
  selectAutoFitFlagForNpcModuleType,
} = require(path.join(__dirname, "./npcCapabilityResolver"));

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function normalizeString(value) {
  return String(value || "").trim();
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

function canFitAuthoredModulesOnHull(definition, modules = []) {
  const shipTypeID = toPositiveInt(
    definition && definition.profile && definition.profile.shipTypeID,
    0,
  );
  if (shipTypeID <= 0) {
    return false;
  }

  const shipLike = {
    typeID: shipTypeID,
  };
  const fittedModules = [];

  for (const moduleEntry of Array.isArray(modules) ? modules : []) {
    const quantity = resolveAuthoredModuleQuantity(moduleEntry);
    const moduleTypeID = toPositiveInt(moduleEntry && moduleEntry.typeID, 0);
    const npcCapabilityTypeID = toPositiveInt(
      moduleEntry && moduleEntry.npcCapabilityTypeID,
      0,
    );
    const moduleType = resolveItemByTypeID(moduleTypeID);
    if (!moduleType) {
      return false;
    }

    const explicitFlags = normalizeExplicitFlagList(moduleEntry, quantity);
    for (let index = 0; index < quantity; index += 1) {
      const flagID = explicitFlags[index] || selectAutoFitFlagForNpcModuleType(
        shipLike,
        fittedModules.map((fittedModule) => ({
          itemID: fittedModule.moduleID,
          flagID: fittedModule.flagID,
          typeID: fittedModule.typeID,
          npcCapabilityTypeID: fittedModule.npcCapabilityTypeID,
          groupID: fittedModule.groupID,
          categoryID: fittedModule.categoryID,
        })),
        {
          typeID: moduleTypeID,
          npcCapabilityTypeID,
        },
      );
      if (!flagID) {
        return false;
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

  return true;
}

function getTemplateRows() {
  if (Array.isArray(hostileUtilityData && hostileUtilityData.templates)) {
    return hostileUtilityData.templates;
  }
  if (Array.isArray(hostileUtilityData && hostileUtilityData.rows)) {
    return hostileUtilityData.rows;
  }
  return [];
}

const COMPILED_TEMPLATES = Object.freeze(
  getTemplateRows()
    .map((template) => ({
      templateID: normalizeString(template && template.templateID),
      name: normalizeString(template && template.name),
      factionIDs: new Set(
        (Array.isArray(template && template.factionIDs) ? template.factionIDs : [])
          .map((value) => toPositiveInt(value, 0))
          .filter((value) => value > 0),
      ),
      behaviorProfileIDs: new Set(
        (Array.isArray(template && template.behaviorProfileIDs)
          ? template.behaviorProfileIDs
          : [])
          .map((value) => normalizeString(value))
          .filter(Boolean),
      ),
      profileIDs: new Set(
        (Array.isArray(template && template.profileIDs) ? template.profileIDs : [])
          .map((value) => normalizeString(value))
          .filter(Boolean),
      ),
      modules: Object.freeze(
        (Array.isArray(template && template.modules) ? template.modules : [])
          .map((moduleEntry) => ({
            typeID: toPositiveInt(moduleEntry && moduleEntry.typeID, 0),
            quantity: Math.max(1, toPositiveInt(moduleEntry && moduleEntry.quantity, 1)),
            moduleRole: normalizeString(moduleEntry && moduleEntry.moduleRole) || "hostileUtility",
          }))
          .filter((moduleEntry) => moduleEntry.typeID > 0),
      ),
    }))
    .filter((template) => (
      template.templateID &&
      template.modules.length > 0 &&
      (
        template.behaviorProfileIDs.size > 0 ||
        template.profileIDs.size > 0
      )
    )),
);

function resolveMatchingTemplates(definition) {
  const profile = definition && definition.profile && typeof definition.profile === "object"
    ? definition.profile
    : {};
  const behaviorProfile = definition &&
    definition.behaviorProfile &&
    typeof definition.behaviorProfile === "object"
      ? definition.behaviorProfile
      : {};
  const factionID = toPositiveInt(profile.factionID, 0);
  const profileID = normalizeString(profile.profileID);
  const behaviorProfileID = normalizeString(behaviorProfile.behaviorProfileID);
  if (factionID <= 0 || (!behaviorProfileID && !profileID)) {
    return [];
  }

  return COMPILED_TEMPLATES.filter((template) => (
    template.factionIDs.has(factionID) &&
    (
      (behaviorProfileID && template.behaviorProfileIDs.has(behaviorProfileID)) ||
      (profileID && template.profileIDs.has(profileID))
    )
  ));
}

function augmentNpcLoadoutWithHostileUtilities(definition, loadout) {
  const baseLoadout =
    loadout && typeof loadout === "object"
      ? loadout
      : {};
  const existingModules = Array.isArray(baseLoadout.modules)
    ? baseLoadout.modules.map((entry) => ({ ...entry }))
    : [];
  const matchingTemplates = resolveMatchingTemplates(definition);
  if (matchingTemplates.length <= 0) {
    return {
      loadout: {
        ...baseLoadout,
        modules: existingModules,
      },
      appliedTemplateIDs: [],
    };
  }

  const existingTypeIDs = new Set(
    existingModules
      .map((entry) => toPositiveInt(entry && entry.typeID, 0))
      .filter((typeID) => typeID > 0),
  );
  const nextModules = [...existingModules];
  const appliedTemplateIDs = [];

  for (const template of matchingTemplates) {
    let appliedAny = false;
    for (const moduleEntry of template.modules) {
      if (existingTypeIDs.has(moduleEntry.typeID)) {
        continue;
      }
      const candidateEntry = {
        typeID: moduleEntry.typeID,
        quantity: moduleEntry.quantity,
        moduleRole: moduleEntry.moduleRole,
      };
      if (!canFitAuthoredModulesOnHull(definition, [...nextModules, candidateEntry])) {
        continue;
      }
      existingTypeIDs.add(moduleEntry.typeID);
      nextModules.push(candidateEntry);
      appliedAny = true;
    }
    if (appliedAny) {
      appliedTemplateIDs.push(template.templateID);
    }
  }

  return {
    loadout: {
      ...baseLoadout,
      modules: nextModules,
    },
    appliedTemplateIDs,
  };
}

module.exports = {
  resolveMatchingTemplates,
  augmentNpcLoadoutWithHostileUtilities,
};
