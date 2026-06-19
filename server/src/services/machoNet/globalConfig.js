const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const {
  buildClientGlobalConfigEntries,
} = require(path.join(__dirname, "../newEdenStore/storeState"));

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const SAFE_DEFAULT_COUNTRY_CODE = "GB";
const SERVER_STATUS_LABELS = new Set([
  "/Carbon/MachoNet/ServerStatus/OK",
  "/Carbon/MachoNet/ServerStatus/BadAddress",
  "/Carbon/MachoNet/ServerStatus/IncompatibleRelease",
  "/Carbon/MachoNet/ServerStatus/IncompatibleVersion",
  "/Carbon/MachoNet/ServerStatus/IncompatibleProtocol",
  "/Carbon/MachoNet/ServerStatus/IncompatibleBuild",
  "/Carbon/MachoNet/ServerStatus/IncompatibleRegion",
  "/Carbon/MachoNet/ServerStatus/ShuttingDown",
  "/Carbon/MachoNet/ServerStatus/NotAcceptingConnections",
  "/Carbon/MachoNet/ServerStatus/StartingUp",
  "/Carbon/MachoNet/ServerStatus/ProxyFull",
  "/Carbon/MachoNet/ServerStatus/ProxyFullWithLimit",
  "/Carbon/MachoNet/ServerStatus/ProxyNotConnected",
  "/Carbon/MachoNet/ServerStatus/IPBanned",
  "/Carbon/MachoNet/ServerStatus/Unknown",
]);
const DEFAULT_SERVER_STATUS_LABEL = "/Carbon/MachoNet/ServerStatus/OK";

function getRuntimeConfig() {
  if (typeof config.getConfigStateSnapshot === "function") {
    try {
      return config.getConfigStateSnapshot().resolvedConfig || config;
    } catch {}
  }
  return config;
}

function coerceNonNegativeInteger(value, fallback = 0) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return Math.max(0, Math.floor(Number(fallback) || 0));
  }
  return Math.max(0, Math.floor(normalized));
}

function coerceServerStatusLabel(value) {
  const normalized = String(value || "").trim();
  return SERVER_STATUS_LABELS.has(normalized)
    ? normalized
    : DEFAULT_SERVER_STATUS_LABEL;
}

function buildServerStatusCode(statusLabel) {
  const parts = String(statusLabel || DEFAULT_SERVER_STATUS_LABEL).split("/");
  return parts[parts.length - 1] || "OK";
}

function coerceCountryCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return COUNTRY_CODE_PATTERN.test(normalized) ? normalized : null;
}

function normalizeCountryCode(
  value,
  fallback = getRuntimeConfig().defaultCountryCode,
) {
  const fallbackCountryCode =
    coerceCountryCode(fallback) || SAFE_DEFAULT_COUNTRY_CODE;
  const normalizedCountryCode = coerceCountryCode(value);

  if (!normalizedCountryCode || normalizedCountryCode === "KR") {
    return fallbackCountryCode === "KR"
      ? SAFE_DEFAULT_COUNTRY_CODE
      : fallbackCountryCode;
  }

  return normalizedCountryCode;
}

function buildGlobalConfigEntries(runtimeConfig = getRuntimeConfig()) {
  return [
    ["imageserverurl", runtimeConfig.imageServerUrl],
    ["defaultPortraitSaveSize", 1024],
    [
      "air_npe_enabled",
      runtimeConfig.newCharacterTutorialEnabled ||
      runtimeConfig.newCharacterIntroCinematicEnabled
        ? 1
        : 0,
    ],
    ["HyperNetKillSwitch", runtimeConfig.hyperNetKillSwitch ? 1 : 0],
    [
      "HyperNetPlexPriceOverride",
      Number(runtimeConfig.hyperNetPlexPriceOverride || 0) || 0,
    ],
    ["SkillPurchaseEnabled", runtimeConfig.skillPurchaseEnabled ? 1 : 0],
    [
      "expert_system_feature_enabled",
      runtimeConfig.expertSystemsEnabled ? 1 : 0,
    ],
    ...buildClientGlobalConfigEntries(),
  ];
}

function buildClientBootMetadataEntries(runtimeConfig = getRuntimeConfig()) {
  return [
    ["boot_version", runtimeConfig.clientVersion],
    ["boot_build", runtimeConfig.clientBuild],
    ["boot_codename", runtimeConfig.projectCodename],
    ["boot_region", runtimeConfig.projectRegion],
  ];
}

function buildGlobalConfigDict(runtimeConfig = getRuntimeConfig()) {
  return {
    type: "dict",
    entries: buildGlobalConfigEntries(runtimeConfig),
  };
}

function buildServerStatusMessage(runtimeConfig = getRuntimeConfig()) {
  const statusLabel = coerceServerStatusLabel(runtimeConfig.serverStatusLabel);

  if (statusLabel === "/Carbon/MachoNet/ServerStatus/StartingUp") {
    return [
      statusLabel,
      {
        progress: coerceNonNegativeInteger(
          runtimeConfig.serverStatusProgressSeconds,
          0,
        ),
      },
    ];
  }

  if (statusLabel === "/Carbon/MachoNet/ServerStatus/ProxyFullWithLimit") {
    return [
      statusLabel,
      {
        limit: Math.max(
          1,
          coerceNonNegativeInteger(runtimeConfig.serverStatusProxyLimit, 1),
        ),
      },
    ];
  }

  return [statusLabel, {}];
}

function buildServerStatusDict(runtimeConfig = getRuntimeConfig()) {
  const statusLabel = coerceServerStatusLabel(runtimeConfig.serverStatusLabel);
  return {
    type: "dict",
    entries: [
      ...buildClientBootMetadataEntries(runtimeConfig),
      ["update_info", runtimeConfig.projectVersion],
      [
        "cluster_usercount",
        coerceNonNegativeInteger(runtimeConfig.serverStatusClusterUserCount, 1),
      ],
      [
        "user_logonqueueposition",
        coerceNonNegativeInteger(runtimeConfig.serverStatusQueuePosition, 1),
      ],
      ["macho_version", runtimeConfig.machoVersion],
      ["status", buildServerStatusCode(statusLabel)],
    ],
  };
}

function buildServerStatusResponse(runtimeConfig = getRuntimeConfig()) {
  return [
    buildServerStatusMessage(runtimeConfig),
    buildServerStatusDict(runtimeConfig),
  ];
}

module.exports = {
  buildClientBootMetadataEntries,
  buildGlobalConfigDict,
  buildGlobalConfigEntries,
  buildServerStatusDict,
  buildServerStatusMessage,
  buildServerStatusResponse,
  getRuntimeConfig,
  normalizeCountryCode,
};
