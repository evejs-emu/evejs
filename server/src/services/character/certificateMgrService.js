const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildAllShipCertificateRecommendationsPayload,
  buildCertificateCategoriesPayload,
  buildCertificateClassesPayload,
  buildCharacterCertificatesRowsetForCharacter,
  buildMyCertificatesRowsetForCharacter,
  getCertificateDefinition,
  grantCertificates,
  updateCertificateVisibilityFlags,
} = require(path.join(__dirname, "../skills/certificates/certificateRuntime"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getCharacterIDFromSession(session) {
  return toInt(session && (session.characterID || session.charid), 0);
}

function normalizeCertificateIDList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => toInt(entry, 0))
    .filter((certificateID) => certificateID > 0 && getCertificateDefinition(certificateID));
}

class CertificateMgrService extends BaseService {
  constructor() {
    super("certificateMgr");
  }

  Handle_GetMyCertificates(args, session) {
    const characterID = getCharacterIDFromSession(session);
    log.debug(`[CertificateMgr] GetMyCertificates(${characterID})`);
    return buildMyCertificatesRowsetForCharacter(characterID);
  }

  Handle_GetCertificateCategories() {
    log.debug("[CertificateMgr] GetCertificateCategories");
    return buildCertificateCategoriesPayload();
  }

  Handle_GetAllShipCertificateRecommendations() {
    log.debug("[CertificateMgr] GetAllShipCertificateRecommendations");
    return buildAllShipCertificateRecommendationsPayload();
  }

  Handle_GetCertificateClasses() {
    log.debug("[CertificateMgr] GetCertificateClasses");
    return buildCertificateClassesPayload();
  }

  Handle_GrantCertificate(args, session) {
    const characterID = getCharacterIDFromSession(session);
    const certificateID = toInt(args && args[0], 0);
    log.debug(`[CertificateMgr] GrantCertificate(${characterID}, ${certificateID})`);
    grantCertificates(characterID, certificateID);
    return null;
  }

  Handle_UpdateCertificateFlags(args, session) {
    const characterID = getCharacterIDFromSession(session);
    const certificateID = toInt(args && args[0], 0);
    const visibilityFlags = toInt(args && args[1], 0);
    log.debug(
      `[CertificateMgr] UpdateCertificateFlags(${characterID}, ${certificateID}, ${visibilityFlags})`,
    );
    updateCertificateVisibilityFlags(characterID, certificateID, visibilityFlags);
    return null;
  }

  Handle_BatchCertificateGrant(args, session) {
    const characterID = getCharacterIDFromSession(session);
    const certificateIDs = normalizeCertificateIDList(args && args[0]);
    log.debug(
      `[CertificateMgr] BatchCertificateGrant(${characterID}, ${certificateIDs.length})`,
    );
    return certificateIDs.length > 0 ? grantCertificates(characterID, certificateIDs) : [];
  }

  Handle_BatchCertificateUpdate(args, session) {
    const characterID = getCharacterIDFromSession(session);
    const updates = Array.isArray(args && args[0]) ? args[0] : [];
    log.debug(`[CertificateMgr] BatchCertificateUpdate(${characterID}, ${updates.length})`);
    for (const update of updates) {
      if (!Array.isArray(update) || update.length < 2) {
        continue;
      }
      updateCertificateVisibilityFlags(characterID, update[0], update[1]);
    }
    return null;
  }

  Handle_GetCertificatesByCharacter(args) {
    const characterID = toInt(args && args[0], 0);
    log.debug(`[CertificateMgr] GetCertificatesByCharacter(${characterID})`);
    return buildCharacterCertificatesRowsetForCharacter(characterID);
  }
}

module.exports = CertificateMgrService;
