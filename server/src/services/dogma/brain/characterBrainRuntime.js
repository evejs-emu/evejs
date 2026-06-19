const path = require("path");

const {
  buildKeyVal,
  buildObjectEx1,
  buildList,
} = require(path.join(__dirname, "../../_shared/serviceHelpers"));
const {
  marshalEncode,
} = require(path.join(__dirname, "../../../network/tcp/utils/marshal"));
const {
  FITTING_BRAIN_PROVIDER,
} = require(path.join(__dirname, "./providers/fittingBrainProvider"));
const {
  INDUSTRY_BRAIN_PROVIDER,
} = require(path.join(__dirname, "./providers/industryBrainProvider"));

const CHARACTER_BRAIN_VERSION_BY_CHARACTER_ID = new Map();
const CHARACTER_BRAIN_PROVIDERS = Object.freeze([
  FITTING_BRAIN_PROVIDER,
  INDUSTRY_BRAIN_PROVIDER,
]);

function getCharacterStateRuntime() {
  return require(path.join(__dirname, "../../character/characterState"));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getCharacterBrainProviders() {
  return CHARACTER_BRAIN_PROVIDERS;
}

function normalizeBrainEffectSkillIDs(effectDefinition) {
  const explicitSkills = Array.isArray(effectDefinition && effectDefinition.skills)
    ? effectDefinition.skills
    : [];
  const fallbackSkills = [toInt(effectDefinition && effectDefinition.skillTypeID, 0)];
  return [...new Set([...explicitSkills, ...fallbackSkills].map((value) => toInt(value, 0)).filter((value) => value > 0))];
}

function buildBrainEffectSourceAttribute(skillTypeID) {
  return buildKeyVal([
    ["invItem", buildKeyVal([
      ["typeID", toInt(skillTypeID, 0)],
    ])],
  ]);
}

function buildBrainEffectObject(targetItemID, effectDefinition) {
  const numericTargetItemID = toInt(targetItemID, 0);
  const skillIDs = normalizeBrainEffectSkillIDs(effectDefinition);
  const primarySkillTypeID = skillIDs[0] || 0;
  const modifierType = effectDefinition.modifierType || "M";
  const targetAttributeID = toInt(effectDefinition.targetAttributeID, 0);
  const operation = toInt(effectDefinition.operation, 0);
  const extras = Array.isArray(effectDefinition.extras) ? effectDefinition.extras : [];

  return buildObjectEx1(
    "eve.common.script.dogma.effect.BrainEffect",
    [
      buildBrainEffectSourceAttribute(primarySkillTypeID),
      numericTargetItemID,
      modifierType,
      targetAttributeID,
      operation,
      extras,
    ],
    [
      ["fromAttrib", null],
      ["value", effectDefinition.value],
      ["toItemID", numericTargetItemID],
      ["modifierType", modifierType],
      ["toAttribID", targetAttributeID],
      ["operation", operation],
      ["extras", extras],
      ["skills", buildList(skillIDs)],
    ],
  );
}

function buildCharacterBrainEffectDefinitions(characterID) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return [];
  }

  const definitions = [];
  for (const provider of CHARACTER_BRAIN_PROVIDERS) {
    if (!provider || typeof provider.buildCharacterEffects !== "function") {
      continue;
    }
    const providerDefinitions = provider.buildCharacterEffects(numericCharacterID);
    if (Array.isArray(providerDefinitions) && providerDefinitions.length > 0) {
      definitions.push(...providerDefinitions);
    }
  }
  return definitions;
}

function collectProviderDefinitions(characterID, builderName) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return [];
  }

  const definitions = [];
  for (const provider of CHARACTER_BRAIN_PROVIDERS) {
    if (!provider || typeof provider[builderName] !== "function") {
      continue;
    }
    const providerDefinitions = provider[builderName](numericCharacterID);
    if (Array.isArray(providerDefinitions) && providerDefinitions.length > 0) {
      definitions.push(...providerDefinitions);
    }
  }
  return definitions;
}

function buildCharacterBrainDefinitionSet(characterID) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return {
      characterEffects: [],
      shipEffects: [],
      structureEffects: [],
    };
  }

  return {
    characterEffects: collectProviderDefinitions(
      numericCharacterID,
      "buildCharacterEffects",
    ),
    shipEffects: collectProviderDefinitions(numericCharacterID, "buildShipEffects"),
    structureEffects: collectProviderDefinitions(
      numericCharacterID,
      "buildStructureEffects",
    ),
  };
}

function resolveCharacterBrainTargetIDs(characterID, options = {}) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return {
      characterID: 0,
      shipID: 0,
      structureID: 0,
    };
  }

  let shipID = toInt(options.shipID, 0);
  let structureID = toInt(options.structureID, 0);

  if (shipID <= 0 || structureID <= 0) {
    try {
      const { getActiveShipRecord, getCharacterRecord } = getCharacterStateRuntime();
      if (shipID <= 0) {
        const activeShip = getActiveShipRecord(numericCharacterID);
        shipID = toInt(activeShip && activeShip.itemID, 0);
      }
      if (structureID <= 0) {
        const characterRecord = getCharacterRecord(numericCharacterID) || {};
        structureID = toInt(
          characterRecord.structureID ??
            characterRecord.structureid ??
            characterRecord.structureId,
          0,
        );
      }
    } catch (error) {
      shipID = shipID > 0 ? shipID : 0;
      structureID = structureID > 0 ? structureID : 0;
    }
  }

  return {
    characterID: numericCharacterID,
    shipID: shipID > 0 ? shipID : numericCharacterID,
    structureID: structureID > 0 ? structureID : numericCharacterID,
  };
}

function buildBootstrapCharacterBrain(characterID, version = 0, options = {}) {
  const targets = resolveCharacterBrainTargetIDs(characterID, options);
  const definitions = buildCharacterBrainDefinitionSet(targets.characterID);
  return [
    toInt(version, 0),
    definitions.characterEffects.map((effectDefinition) =>
      buildBrainEffectObject(targets.characterID, effectDefinition),
    ),
    definitions.shipEffects.map((effectDefinition) =>
      buildBrainEffectObject(targets.shipID, effectDefinition),
    ),
    definitions.structureEffects.map((effectDefinition) =>
      buildBrainEffectObject(targets.structureID, effectDefinition),
    ),
  ];
}

function getNextCharacterBrainVersion(characterID) {
  const numericCharacterID = toInt(characterID, 0);
  const nextVersion =
    (CHARACTER_BRAIN_VERSION_BY_CHARACTER_ID.get(numericCharacterID) || 0) + 1;
  CHARACTER_BRAIN_VERSION_BY_CHARACTER_ID.set(numericCharacterID, nextVersion);
  return nextVersion;
}

function buildCharacterBrainGrayMatter(characterID, options = {}) {
  const targets = resolveCharacterBrainTargetIDs(characterID, options);
  const definitions = buildCharacterBrainDefinitionSet(targets.characterID);
  const charEffects = definitions.characterEffects.map((effectDefinition) =>
    buildBrainEffectObject(targets.characterID, effectDefinition),
  );
  const shipEffects = definitions.shipEffects.map((effectDefinition) =>
    buildBrainEffectObject(targets.shipID, effectDefinition),
  );
  const structureEffects = definitions.structureEffects.map((effectDefinition) =>
    buildBrainEffectObject(targets.structureID, effectDefinition),
  );

  return marshalEncode([
    { type: "list", items: charEffects },
    { type: "list", items: shipEffects },
    { type: "list", items: structureEffects },
  ]);
}

function buildCharacterBrainUpdatePayload(characterID, version = null, options = {}) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return null;
  }

  return [
    version ?? getNextCharacterBrainVersion(numericCharacterID),
    buildCharacterBrainGrayMatter(numericCharacterID, options),
  ];
}

function syncCharacterDogmaBrain(session, characterID = null) {
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }

  const numericCharacterID = toInt(
    characterID ?? session?.characterID ?? session?.charid,
    0,
  );
  if (numericCharacterID <= 0) {
    return false;
  }

  const payload = buildCharacterBrainUpdatePayload(numericCharacterID, null, {
    shipID:
      session.activeShipID ??
      session.shipID ??
      session.shipid,
    structureID:
      session.structureid ??
      session.structureID ??
      session.structureId,
  });
  if (!payload) {
    return false;
  }

  session.sendNotification("OnServerBrainUpdated", "clientID", [payload]);
  return true;
}

function syncCharacterDogmaState(session, characterID = null) {
  let syncedProviderState = false;

  for (const provider of CHARACTER_BRAIN_PROVIDERS) {
    if (!provider || typeof provider.syncCharacterAttributeState !== "function") {
      continue;
    }
    syncedProviderState =
      provider.syncCharacterAttributeState(session, characterID) || syncedProviderState;
  }

  const syncedBrain = syncCharacterDogmaBrain(session, characterID);
  return syncedProviderState || syncedBrain;
}

module.exports = {
  buildBootstrapCharacterBrain,
  buildCharacterBrainDefinitionSet,
  buildCharacterBrainEffectDefinitions,
  buildCharacterBrainGrayMatter,
  buildCharacterBrainUpdatePayload,
  getCharacterBrainProviders,
  syncCharacterDogmaBrain,
  syncCharacterDogmaState,
};
