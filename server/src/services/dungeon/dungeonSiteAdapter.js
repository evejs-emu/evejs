const path = require("path");

const dungeonAuthority = require(path.join(__dirname, "./dungeonAuthority"));
const dungeonRuntime = require(path.join(__dirname, "./dungeonRuntime"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || fallback;
}

function uniqueSortedInts(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map((entry) => toInt(entry, 0))
    .filter((entry) => entry > 0))].sort((left, right) => left - right);
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildSiteKey(providerID, systemID, siteID) {
  const normalizedProviderID = normalizeText(providerID, "site").toLowerCase();
  return `${normalizedProviderID}:${toInt(systemID, 0)}:${toInt(siteID, 0)}`;
}

function gatherCandidateMap(explicitCandidates = []) {
  const candidatesByID = new Map();
  for (const candidate of Array.isArray(explicitCandidates) ? explicitCandidates : []) {
    if (candidate && candidate.templateID) {
      candidatesByID.set(String(candidate.templateID), candidate);
    }
  }
  return candidatesByID;
}

function appendCandidates(candidatesByID, templates) {
  for (const template of Array.isArray(templates) ? templates : []) {
    if (template && template.templateID) {
      candidatesByID.set(String(template.templateID), template);
    }
  }
}

function scoreTemplate(template, site, hints = {}) {
  let score = 0;
  const siteFamily = normalizeText(site && site.family, "unknown").toLowerCase();
  const siteKind = normalizeText(site && site.siteKind, "signature").toLowerCase();
  const normalizedSourceDungeonID = toInt(site && site.dungeonID, 0);
  const normalizedDungeonNameID = toInt(site && site.dungeonNameID, 0);
  const normalizedArchetypeID = toInt(site && site.archetypeID, 0);
  const normalizedFactionID = toInt(site && site.factionID, 0);

  if (template.templateID === normalizeText(hints.templateID, "")) {
    score += 10_000;
  }
  if (normalizedSourceDungeonID > 0 && toInt(template.sourceDungeonID, 0) === normalizedSourceDungeonID) {
    score += 5_000;
  }
  if (normalizedDungeonNameID > 0 && toInt(template.dungeonNameID, 0) === normalizedDungeonNameID) {
    score += 1_500;
  }
  if (normalizedArchetypeID > 0 && toInt(template.archetypeID, 0) === normalizedArchetypeID) {
    score += 1_000;
  }
  if (normalizedFactionID > 0 && toInt(template.factionID, 0) === normalizedFactionID) {
    score += 700;
  }
  if (normalizeText(template.siteFamily, "unknown").toLowerCase() === siteFamily) {
    score += 400;
  }
  if (normalizeText(template.siteKind, "signature").toLowerCase() === siteKind) {
    score += 250;
  }

  const resourceComposition =
    template &&
    template.resourceComposition &&
    typeof template.resourceComposition === "object"
      ? template.resourceComposition
      : {};
  const oreTypeIDs = uniqueSortedInts(resourceComposition.oreTypeIDs);
  const gasTypeIDs = uniqueSortedInts(resourceComposition.gasTypeIDs);
  const iceTypeIDs = uniqueSortedInts(resourceComposition.iceTypeIDs);
  const resourceMatches = [
    ...uniqueSortedInts(hints.oreTypeIDs).filter((entry) => oreTypeIDs.includes(entry)),
    ...uniqueSortedInts(hints.gasTypeIDs).filter((entry) => gasTypeIDs.includes(entry)),
    ...uniqueSortedInts(hints.iceTypeIDs).filter((entry) => iceTypeIDs.includes(entry)),
  ];
  score += resourceMatches.length * 150;

  const totalHintedResources =
    uniqueSortedInts(hints.oreTypeIDs).length +
    uniqueSortedInts(hints.gasTypeIDs).length +
    uniqueSortedInts(hints.iceTypeIDs).length;
  const totalTemplateResources = oreTypeIDs.length + gasTypeIDs.length + iceTypeIDs.length;
  if (totalHintedResources > 0 && totalTemplateResources > 0) {
    if (resourceMatches.length === totalHintedResources && totalTemplateResources === totalHintedResources) {
      score += 800;
    } else if (resourceMatches.length === totalHintedResources) {
      score += 400;
    }
  }

  return score;
}

function sortTemplateCandidates(left, right, site, hints) {
  const scoreDelta = scoreTemplate(right, site, hints) - scoreTemplate(left, site, hints);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  const leftSourceDungeonID = toInt(left && left.sourceDungeonID, Number.MAX_SAFE_INTEGER);
  const rightSourceDungeonID = toInt(right && right.sourceDungeonID, Number.MAX_SAFE_INTEGER);
  if (leftSourceDungeonID !== rightSourceDungeonID) {
    return leftSourceDungeonID - rightSourceDungeonID;
  }
  return String(left && left.templateID || "").localeCompare(String(right && right.templateID || ""));
}

function resolveTemplateForSite(site, hints = {}) {
  const candidatesByID = gatherCandidateMap(hints.candidates);
  const explicitTemplateID = normalizeText(hints.templateID, "");
  if (explicitTemplateID) {
    const template = dungeonAuthority.getTemplateByID(explicitTemplateID);
    if (template) {
      candidatesByID.set(template.templateID, template);
    }
  }

  const sourceDungeonID = toInt(site && site.dungeonID, 0);
  if (sourceDungeonID > 0) {
    const template = dungeonAuthority.getClientDungeonTemplate(sourceDungeonID);
    if (template) {
      candidatesByID.set(template.templateID, template);
    }
  }

  const dungeonNameID = toInt(site && site.dungeonNameID, 0);
  if (dungeonNameID > 0) {
    appendCandidates(candidatesByID, dungeonAuthority.listTemplatesByDungeonNameID(dungeonNameID));
  }

  const archetypeID = toInt(site && site.archetypeID, 0);
  if (archetypeID > 0) {
    appendCandidates(candidatesByID, dungeonAuthority.listTemplatesByArchetypeID(archetypeID));
  }

  for (const resourceTypeID of uniqueSortedInts([
    ...uniqueSortedInts(hints.oreTypeIDs),
    ...uniqueSortedInts(hints.gasTypeIDs),
    ...uniqueSortedInts(hints.iceTypeIDs),
  ])) {
    appendCandidates(candidatesByID, dungeonAuthority.listTemplatesByResourceTypeID(resourceTypeID));
  }

  const siteFamily = normalizeText(site && site.family, "").toLowerCase();
  if (siteFamily) {
    appendCandidates(candidatesByID, dungeonAuthority.listTemplatesByFamily(siteFamily));
  }

  const candidates = [...candidatesByID.values()].sort((left, right) => (
    sortTemplateCandidates(left, right, site, hints)
  ));
  return candidates[0] || null;
}

function enrichSiteWithDungeonRuntime(site, options = {}) {
  const providerID = normalizeText(options.providerID, "site").toLowerCase();
  const solarSystemID = toInt(site && site.solarSystemID, toInt(options.solarSystemID, 0));
  const siteID = toInt(site && site.siteID, 0);
  if (!providerID || solarSystemID <= 0 || siteID <= 0) {
    return cloneValue(site);
  }

  const siteKey = buildSiteKey(providerID, solarSystemID, siteID);
  let runtimeSummary = dungeonRuntime.findInstanceBySiteKey(siteKey, {
    activeOnly: true,
  });
  let template = null;
  if (runtimeSummary) {
    template = dungeonAuthority.getTemplateByID(runtimeSummary.templateID);
  }

  if (!runtimeSummary || !template) {
    template = resolveTemplateForSite(site, options);
    if (template) {
      const created = dungeonRuntime.createInstance({
        templateID: template.templateID,
        solarSystemID,
        siteKey,
        lifecycleState: "active",
        instanceScope: "shared",
        siteFamily: normalizeText(site && site.family, template.siteFamily || "unknown").toLowerCase(),
        siteKind: normalizeText(site && site.siteKind, template.siteKind || "signature").toLowerCase(),
        siteOrigin: normalizeText(site && site.siteOrigin, template.siteOrigin || providerID).toLowerCase(),
        position: Array.isArray(site && site.position)
          ? {
              x: Number(site.position[0]) || 0,
              y: Number(site.position[1]) || 0,
              z: Number(site.position[2]) || 0,
            }
          : (
            site && site.actualPosition && typeof site.actualPosition === "object"
              ? site.actualPosition
              : null
          ),
        metadata: {
          providerID,
          siteID,
          originalFamily: normalizeText(site && site.family, "unknown").toLowerCase(),
          originalSiteKind: normalizeText(site && site.siteKind, "signature").toLowerCase(),
          adapter: "dungeonSiteAdapter",
        },
        runtimeFlags: {
          shadowProviderSite: true,
        },
      });
      runtimeSummary = dungeonRuntime.getInstanceSummary(created.instanceID);
    }
  }

  const enriched = {
    ...cloneValue(site),
    siteKey,
    templateID: template ? template.templateID : (site && site.templateID) || null,
    instanceID: runtimeSummary ? runtimeSummary.instanceID : (site && site.instanceID) || null,
    dungeonID:
      template && template.sourceDungeonID != null
        ? template.sourceDungeonID
        : (site && site.dungeonID != null ? site.dungeonID : null),
    archetypeID:
      template && template.archetypeID != null
        ? template.archetypeID
        : (site && site.archetypeID != null ? site.archetypeID : null),
    dungeonNameID:
      template && template.dungeonNameID != null
        ? template.dungeonNameID
        : (site && site.dungeonNameID != null ? site.dungeonNameID : null),
    factionID:
      template && template.factionID != null
        ? template.factionID
        : (site && site.factionID != null ? site.factionID : null),
    entryObjectTypeID:
      template && template.entryObjectTypeID != null
        ? template.entryObjectTypeID
        : (site && site.entryObjectTypeID != null ? site.entryObjectTypeID : null),
  };

  if (template && normalizeText(site && site.family, "").trim().length <= 0) {
    enriched.family = template.siteFamily;
  }

  return enriched;
}

module.exports = {
  buildSiteKey,
  enrichSiteWithDungeonRuntime,
  resolveTemplateForSite,
};
