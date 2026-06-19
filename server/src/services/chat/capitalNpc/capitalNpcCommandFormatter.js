function formatCount(value) {
  return new Intl.NumberFormat("en-GB").format(Number(value) || 0);
}

function formatIsk(value) {
  return `${formatCount(value)} ISK`;
}

function formatDurationMs(value) {
  const totalSeconds = Math.max(0, Math.round((Number(value) || 0) / 1000));
  return `${totalSeconds}s`;
}

function formatSpawnSummary(result) {
  const data = result && result.data ? result.data : null;
  const spawned = data && Array.isArray(data.spawned) ? data.spawned : [];
  if (spawned.length <= 0) {
    return "/capnpc spawn completed.";
  }

  const composition = new Map();
  for (const entry of spawned) {
    const profileName =
      entry &&
      entry.definition &&
      entry.definition.profile &&
      entry.definition.profile.name
        ? entry.definition.profile.name
        : "Unknown Capital NPC";
    composition.set(profileName, (composition.get(profileName) || 0) + 1);
  }
  const compositionText = [...composition.entries()]
    .map(([name, count]) => `${count}x ${name}`)
    .join(", ");
  const selectionText = data.selectionName ? ` from ${data.selectionName}` : "";
  return `Spawned ${spawned.length} hull${spawned.length === 1 ? "" : "s"}${selectionText}: ${compositionText}.`;
}

function formatSelectionInfo(selection) {
  if (!selection) {
    return "Capital NPC selection could not be resolved.";
  }
  if (selection.kind === "pool") {
    const entries = Array.isArray(selection.row && selection.row.entries)
      ? selection.row.entries
      : [];
    const preview = entries
      .slice(0, 6)
      .map((entry) => String(entry && entry.profileID || "").trim())
      .filter(Boolean)
      .join(", ");
    return [
      `${selection.row && selection.row.name ? selection.row.name : selection.id} (${selection.id}).`,
      `${entries.length} authored capital profile${entries.length === 1 ? "" : "s"} in this pool.`,
      preview ? `Profiles: ${preview}.` : "",
    ].filter(Boolean).join(" ");
  }

  const authority = selection.authorityEntry;
  const modules = Array.isArray(authority && authority.loadout && authority.loadout.modules)
    ? authority.loadout.modules
    : [];
  const cargo = Array.isArray(authority && authority.loadout && authority.loadout.cargo)
    ? authority.loadout.cargo
    : [];
  const aliases = Array.isArray(authority && authority.aliases) ? authority.aliases.join(", ") : "";
  return [
    `${authority && authority.name ? authority.name : selection.id} (${selection.id}).`,
    `${authority && authority.faction && authority.faction.name ? authority.faction.name : "Unknown Faction"} ${authority && authority.classID ? authority.classID : "capital"}.`,
    `Bounty ${formatIsk(authority && authority.bounty)}.`,
    `Hull ${formatCount(authority && authority.shipTypeID)}.`,
    `Modules ${modules.length}, cargo entries ${cargo.length}.`,
    aliases ? `Aliases: ${aliases}.` : "",
  ].filter(Boolean).join(" ");
}

function formatLiveStatus(selectionLabel, summaries, scene) {
  if (!Array.isArray(summaries) || summaries.length <= 0) {
    return `No live ${selectionLabel} are in the current system.`;
  }

  const byClass = new Map();
  for (const summary of summaries) {
    byClass.set(summary.capitalClassID, (byClass.get(summary.capitalClassID) || 0) + 1);
  }
  const detail = summaries.slice(0, 5).map((summary) => {
    const entity = scene && scene.getEntityByID(Number(summary.entityID) || 0);
    const targetID = Number(summary.currentTargetID) || Number(summary.preferredTargetID) || 0;
    const positionText = entity && entity.position
      ? `${formatCount(Math.round(entity.position.x))}/${formatCount(Math.round(entity.position.y))}/${formatCount(Math.round(entity.position.z))}`
      : "off-grid";
    return `${summary.profileID}#${summary.entityID} ${summary.capitalClassID || "capital"} order=${summary.manualOrderType || "auto"} target=${targetID || "none"} pos=${positionText}`;
  });
  const classText = [...byClass.entries()]
    .map(([classID, count]) => `${count} ${classID}`)
    .join(", ");
  return [
    `Live ${selectionLabel}: ${summaries.length} hull${summaries.length === 1 ? "" : "s"}.`,
    classText ? `Classes: ${classText}.` : "",
    detail.length > 0 ? `Sample: ${detail.join(" | ")}.` : "",
  ].filter(Boolean).join(" ");
}

function formatManualOrderResult(verb, selectionLabel, count, targetName = "") {
  if (count <= 0) {
    return `No live ${selectionLabel} matched.`;
  }
  return [
    `${verb} ${count} ${selectionLabel} hull${count === 1 ? "" : "s"}.`,
    targetName ? `Target ${targetName}.` : "",
  ].filter(Boolean).join(" ");
}

function formatClearResult(selectionLabel, count) {
  if (count <= 0) {
    return `No live ${selectionLabel} matched for cleanup.`;
  }
  return `Cleared ${count} ${selectionLabel} hull${count === 1 ? "" : "s"} from the current system.`;
}

function formatFighterStatus(selectionLabel, entries) {
  if (!Array.isArray(entries) || entries.length <= 0) {
    return `No live fighter-capable ${selectionLabel} matched.`;
  }
  const parts = entries.slice(0, 5).map((entry) => (
    `${entry.profileID}#${entry.entityID} fighters=${entry.fighterCount} tracked=${entry.trackedTubeCount} nextLaunch=${formatDurationMs(entry.nextLaunchMs)}`
  ));
  return `Fighter status for ${selectionLabel}: ${parts.join(" | ")}.`;
}

function formatFighterReset(selectionLabel, controllerCount, fighterCount, verb = "Queued fighter relaunch for") {
  if (controllerCount <= 0) {
    return `No live fighter-capable ${selectionLabel} matched.`;
  }
  return `${verb} ${controllerCount} ${selectionLabel} hull${controllerCount === 1 ? "" : "s"} (${fighterCount} fighter${fighterCount === 1 ? "" : "s"} affected).`;
}

function formatSuperStatus(selectionLabel, entries) {
  if (!Array.isArray(entries) || entries.length <= 0) {
    return `No live titan-class ${selectionLabel} matched.`;
  }
  const parts = entries.slice(0, 5).map((entry) => (
    `${entry.profileID}#${entry.entityID} module=${entry.moduleTypeID || "none"} fuel=${entry.fuelQuantity} active=${entry.active ? "yes" : "no"} nextAttempt=${formatDurationMs(entry.nextAttemptMs)}`
  ));
  return `Superweapon status for ${selectionLabel}: ${parts.join(" | ")}.`;
}

function formatPerfSummary(systemID, capitalCount, fighterCount, byClass) {
  const classText = [...byClass.entries()]
    .map(([classID, count]) => `${count} ${classID}`)
    .join(", ");
  return [
    `Capital NPC perf snapshot for system ${systemID}.`,
    `Capitals ${capitalCount}, fighters ${fighterCount}.`,
    classText ? `Classes: ${classText}.` : "",
  ].filter(Boolean).join(" ");
}

function formatSignoffSummary(summary = {}) {
  if (!summary || !summary.profileName) {
    return "Capital signoff preparation failed.";
  }

  const prefix = [
    `Prepared ${summary.profileName}#${summary.entityID || "?"} for live-client signoff.`,
    summary.spawnedFresh === true ? "Spawned fresh hull." : "Reused live hull.",
    summary.targetName ? `Target ${summary.targetName}.` : "",
  ].filter(Boolean).join(" ");

  if (summary.signoffKind === "titan") {
    return [
      prefix,
      `Expect ${summary.family || "superweapon"} module=${summary.moduleTypeID || "none"} fx=${summary.fxGuid || "none"}.`,
      `Warning ${formatDurationMs(summary.warningDurationMs)}, delay ${formatDurationMs(summary.damageDelayMs)}, cycle ${formatDurationMs(summary.damageCycleTimeMs)}.`,
      `Fuel ${summary.fuelQuantity || 0}/${summary.fuelPerActivation || 0}${summary.fuelName ? ` ${summary.fuelName}` : ""}.`,
    ].filter(Boolean).join(" ");
  }

  if (summary.signoffKind === "fighter") {
    return [
      prefix,
      summary.wingText ? `Wing ${summary.wingText}.` : "",
      `Launch quota ${summary.launchQuota || 0} every ${formatDurationMs(summary.launchIntervalMs)}.`,
      `Ability sync ${formatDurationMs(summary.abilitySyncIntervalMs)}, full wing about ${formatDurationMs(summary.fullWingMs)}.`,
      "Use /capnpcfighters status to watch launch state and /capnpcfighters reset to replay cleanup.",
    ].filter(Boolean).join(" ");
  }

  return [
    prefix,
    `Preferred range ${formatCount(summary.preferredRangeMeters || 0)}m with settle tolerance ${formatCount(summary.settleToleranceMeters || 0)}m.`,
    "Attack order queued for movement and weapons validation.",
  ].filter(Boolean).join(" ");
}

module.exports = {
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
};
