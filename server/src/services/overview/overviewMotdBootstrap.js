const fs = require("fs");
const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const chatRuntime = require(path.join(__dirname, "../../_secondary/chat/chatRuntime"));

const REPO_DEFAULT_OVERVIEW_PROFILE_PATH = path.join(
  __dirname,
  "../../../assets/overview/iridium_overview_20260410-v381_carbon.yaml",
);
const DEFAULT_OVERVIEW_PROFILE_PATH = REPO_DEFAULT_OVERVIEW_PROFILE_PATH;
const DEFAULT_OVERVIEW_CHANNEL =
  process.env.EVEJS_SHARED_OVERVIEW_CHANNEL ||
  "player_900001";
const DEFAULT_OVERVIEW_LINK_LABEL =
  process.env.EVEJS_SHARED_OVERVIEW_LABEL ||
  "Install Iridium Overview v381 Carbon";
const DEFAULT_OVERVIEW_SECTION_LABEL =
  process.env.EVEJS_SHARED_OVERVIEW_SECTION_LABEL ||
  "Shared Overview";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stripManagedOverviewSection(motd) {
  return String(motd || "")
    .replace(
      /(?:<br>\s*){0,2}<b>[^<]*:?<\/b>\s*<a href="overviewPreset:[^"]+">[^<]*<\/a>/gi,
      "",
    )
    .trim();
}

function buildOverviewMotd(existingMotd, linkUrl, linkLabel, sectionLabel) {
  const preservedMotd = stripManagedOverviewSection(existingMotd);
  const overviewLine = `<b>${escapeHtml(sectionLabel)}:</b> <a href="${linkUrl}">${escapeHtml(linkLabel)}</a>`;
  return preservedMotd ? `${preservedMotd}<br><br>${overviewLine}` : overviewLine;
}

function installSharedOverviewMotd(serviceManager, options = {}) {
  const overviewService =
    serviceManager && typeof serviceManager.lookup === "function"
      ? serviceManager.lookup("overviewPresetMgr")
      : null;
  if (
    !overviewService ||
    typeof overviewService.storeRawPresetString !== "function"
  ) {
    log.debug("[OverviewPresetMgr] Shared overview MOTD bootstrap skipped; service unavailable");
    return null;
  }

  const profilePath = String(
    options.profilePath || DEFAULT_OVERVIEW_PROFILE_PATH,
  ).trim();
  if (!profilePath || !fs.existsSync(profilePath)) {
    log.debug(
      `[OverviewPresetMgr] Shared overview MOTD bootstrap skipped; file not found at ${profilePath || "<empty>"}`,
    );
    return null;
  }

  const channelRoomName = String(
    options.channelRoomName || DEFAULT_OVERVIEW_CHANNEL,
  ).trim();
  if (!channelRoomName) {
    log.debug("[OverviewPresetMgr] Shared overview MOTD bootstrap skipped; no channel configured");
    return null;
  }

  const rawYaml = fs.readFileSync(profilePath, "utf8");
  if (!rawYaml.trim()) {
    log.warn(
      `[OverviewPresetMgr] Shared overview MOTD bootstrap skipped; file is empty at ${profilePath}`,
    );
    return null;
  }

  const linkLabel = String(
    options.linkLabel || DEFAULT_OVERVIEW_LINK_LABEL,
  ).trim() || DEFAULT_OVERVIEW_LINK_LABEL;
  const sectionLabel = String(
    options.sectionLabel || DEFAULT_OVERVIEW_SECTION_LABEL,
  ).trim() || DEFAULT_OVERVIEW_SECTION_LABEL;

  const channelRecord = chatRuntime.ensureChannel(channelRoomName);
  if (!channelRecord) {
    log.warn(
      `[OverviewPresetMgr] Shared overview MOTD bootstrap skipped; channel ${channelRoomName} could not be ensured`,
    );
    return null;
  }

  const storedEntry = overviewService.storeRawPresetString(rawYaml, {
    ownerID: 0,
    source: "server_motd_bootstrap",
    label: linkLabel,
    sourcePath: profilePath,
  });
  if (!storedEntry) {
    log.warn("[OverviewPresetMgr] Shared overview MOTD bootstrap skipped; overview storage failed");
    return null;
  }

  const linkUrl = `overviewPreset:${storedEntry.hashvalue}//${storedEntry.sqID}`;
  const motd = buildOverviewMotd(
    channelRecord.motd,
    linkUrl,
    linkLabel,
    sectionLabel,
  );

  chatRuntime.setChannelMotd(channelRoomName, motd, {
    metadata: {
      sharedOverviewPresetHashvalue: storedEntry.hashvalue,
      sharedOverviewPresetSqID: storedEntry.sqID,
      sharedOverviewProfilePath: profilePath,
      sharedOverviewLinkLabel: linkLabel,
    },
  });

  log.info(
    `[OverviewPresetMgr] Shared overview MOTD ready for ${channelRoomName} using ${profilePath}`,
  );

  return {
    channelRoomName,
    channelDisplayName: channelRecord.displayName,
    hashvalue: storedEntry.hashvalue,
    sqID: storedEntry.sqID,
    linkUrl,
    linkLabel,
    profilePath,
  };
}

module.exports = {
  installSharedOverviewMotd,
};
