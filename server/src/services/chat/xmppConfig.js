const path = require("path");

const config = require(path.join(__dirname, "../../config"));

function normalizeValue(value, fallback) {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getXmppConnectHost() {
  return normalizeValue(config.xmppConnectHost, "localhost");
}

function getXmppDomain() {
  return normalizeValue(config.xmppDomain, "localhost");
}

function getXmppConferenceDomain() {
  return normalizeValue(
    config.xmppConferenceDomain,
    `conference.${getXmppDomain()}`,
  );
}

function getXmppConferenceDomainPattern() {
  return new RegExp(`@${escapeRegExp(getXmppConferenceDomain())}$`, "i");
}

function buildXmppUserJid(userName, resource = "") {
  const bareJid = `${String(userName || "").trim()}@${getXmppDomain()}`;
  if (!resource) {
    return bareJid;
  }
  return `${bareJid}/${String(resource || "").trim()}`;
}

function buildXmppConferenceJid(roomName) {
  return `${String(roomName || "").trim()}@${getXmppConferenceDomain()}`;
}

function stripConferenceDomain(roomJid) {
  return String(roomJid || "").replace(getXmppConferenceDomainPattern(), "");
}

module.exports = {
  buildXmppConferenceJid,
  buildXmppUserJid,
  escapeRegExp,
  getXmppConferenceDomain,
  getXmppConferenceDomainPattern,
  getXmppConnectHost,
  getXmppDomain,
  stripConferenceDomain,
};
