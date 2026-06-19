const ROLE_GMS = 274877906944n;
const ROLE_SECURITY = 1125899906842624n;
const ROLE_PROGRAMMER = 2251799813685248n;
const ROLE_QA = 4503599627370496n;
const ROLE_GMH = 9007199254740992n;
const ROLE_GML = 18014398509481984n;
const ROLE_CONTENT = 36028797018963968n;
const ROLE_ADMIN = 72057594037927936n;
const ROLE_ROLEADMIN = 288230376151711744n;
const ROLE_BSDADMIN = 35184372088832n;
const ROLE_CHTADMINISTRATOR = 2097152n;
const ROLE_ACCOUNTMANAGEMENT = 536870912n;
const ROLE_PINKCHAT = 64n;
const ROLE_CENTURION = 2048n;
const ROLE_LEGIONEER = 262144n;
const ROLE_HEALSELF = 4194304n;
const ROLE_HEALOTHERS = 8388608n;
const ROLE_SPAWN = 8589934592n;
const ROLE_TRANSFER = 137438953472n;
const ROLE_WORLDMOD = 4096n;

const CHAT_CLASSIFICATION_BITS = Object.freeze([
  ROLE_PINKCHAT,
  ROLE_QA,
  ROLE_GML,
  ROLE_GMH,
  ROLE_GMS,
  ROLE_ADMIN,
  ROLE_CENTURION,
  ROLE_LEGIONEER,
]);

function combineRoles(...roles) {
  return roles.reduce(
    (mask, value) => mask | normalizeRoleValue(value, 0n),
    0n,
  );
}

const MAX_ACCOUNT_ROLE = combineRoles(
  ROLE_ADMIN,
  ROLE_CONTENT,
  ROLE_GML,
  ROLE_GMH,
  ROLE_GMS,
  ROLE_QA,
  ROLE_PROGRAMMER,
  ROLE_SECURITY,
  ROLE_ROLEADMIN,
  ROLE_BSDADMIN,
  ROLE_ACCOUNTMANAGEMENT,
  ROLE_CHTADMINISTRATOR,
  ROLE_CENTURION,
  ROLE_LEGIONEER,
  ROLE_HEALSELF,
  ROLE_HEALOTHERS,
  ROLE_SPAWN,
  ROLE_TRANSFER,
  ROLE_WORLDMOD,
);

const CHAT_ROLE_PROFILES = Object.freeze({
  red: combineRoles(
    ROLE_ADMIN,
    ROLE_GML,
    ROLE_CHTADMINISTRATOR,
    ROLE_ACCOUNTMANAGEMENT,
    ROLE_LEGIONEER,
  ),
  blue: combineRoles(
    ROLE_QA,
    ROLE_ADMIN,
    ROLE_GML,
    ROLE_CHTADMINISTRATOR,
    ROLE_ACCOUNTMANAGEMENT,
    ROLE_LEGIONEER,
  ),
  yellow: combineRoles(
    ROLE_PINKCHAT,
    ROLE_ADMIN,
    ROLE_GML,
    ROLE_CHTADMINISTRATOR,
    ROLE_ACCOUNTMANAGEMENT,
    ROLE_LEGIONEER,
  ),
  teal: combineRoles(
    ROLE_LEGIONEER,
    ROLE_CENTURION,
    ROLE_CHTADMINISTRATOR,
    ROLE_ACCOUNTMANAGEMENT,
    ROLE_PROGRAMMER,
    ROLE_SECURITY,
    ROLE_CONTENT,
    ROLE_HEALSELF,
    ROLE_HEALOTHERS,
    ROLE_SPAWN,
    ROLE_TRANSFER,
    ROLE_WORLDMOD,
  ),
});

const DEFAULT_CHAT_COLOR = "red";
const DEFAULT_CHAT_ROLE = CHAT_ROLE_PROFILES[DEFAULT_CHAT_COLOR];
const SESSION_BASE_ROLE_MASK = 0x6000000080000000n;

function normalizeRoleValue(value, fallback = DEFAULT_CHAT_ROLE) {
  try {
    if (typeof value === "bigint") {
      return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }

    if (typeof value === "string" && value.trim() !== "") {
      return BigInt(value.trim());
    }

    if (value && typeof value === "object") {
      if (value.type === "long" || value.type === "int") {
        return normalizeRoleValue(value.value, fallback);
      }
    }
  } catch (error) {
    return fallback;
  }

  return fallback;
}

function roleToString(value) {
  return normalizeRoleValue(value, 0n).toString();
}

function composeSessionRoleMask(accountRole, chatRole = 0n) {
  return (
    normalizeRoleValue(accountRole, 0n) |
    normalizeRoleValue(chatRole, 0n) |
    SESSION_BASE_ROLE_MASK
  );
}

function stripChatClassificationBits(roleValue) {
  let normalized = normalizeRoleValue(roleValue, 0n);
  for (const bit of CHAT_CLASSIFICATION_BITS) {
    normalized &= ~bit;
  }
  return normalized;
}

function getChatRoleProfile(colorName) {
  const normalizedColor = String(colorName || "").trim().toLowerCase();
  return CHAT_ROLE_PROFILES[normalizedColor] || null;
}

function buildPersistedAccountRoleRecord(account = {}) {
  const normalizedChatRole = normalizeRoleValue(
    account.chatRole,
    DEFAULT_CHAT_ROLE,
  );

  const nextAccount = {
    ...account,
    role: roleToString(MAX_ACCOUNT_ROLE),
    chatRole: roleToString(normalizedChatRole || DEFAULT_CHAT_ROLE),
  };

  if (typeof nextAccount.banned !== "boolean") {
    nextAccount.banned = Boolean(nextAccount.banned);
  }

  return nextAccount;
}

function withChatColor(colorName) {
  const profile = getChatRoleProfile(colorName);
  if (!profile) {
    return null;
  }

  return profile;
}

module.exports = {
  CHAT_ROLE_PROFILES,
  DEFAULT_CHAT_COLOR,
  DEFAULT_CHAT_ROLE,
  MAX_ACCOUNT_ROLE,
  SESSION_BASE_ROLE_MASK,
  buildPersistedAccountRoleRecord,
  composeSessionRoleMask,
  getChatRoleProfile,
  normalizeRoleValue,
  roleToString,
  stripChatClassificationBits,
  withChatColor,
};
