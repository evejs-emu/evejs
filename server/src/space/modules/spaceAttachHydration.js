const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildSpaceAttachHydrationPlan,
} = require(path.join(__dirname, "./moduleLoadParity"));
const {
  buildShipModuleParityManifest,
} = require(path.join(__dirname, "./moduleClientParityAuthority"));

function queuePostSpaceAttachFittingHydration(
  session,
  shipID,
  options = {},
) {
  const {
    describeSessionHydrationState,
  } = require(path.join(__dirname, "../../services/chat/commandSessionEffects"));
  const {
    clearDeferredDockedShipSessionChange,
    clearDockedFittingBootstrap,
  } = require(path.join(__dirname, "../../services/character/characterState"));

  if (!session || !session._space) {
    return false;
  }

  // A live-space attach invalidates station-only bootstrap state. The fresh
  // dogma prime owns the rack; no later inventory or HUD callback repairs it.
  clearDeferredDockedShipSessionChange(session);
  clearDockedFittingBootstrap(session);

  const resolvedShipID =
    Number(shipID) ||
    Number(
      session._space.shipID ||
      session.activeShipID ||
      session.shipID ||
      session.shipid ||
      0,
    ) ||
    0;
  if (resolvedShipID <= 0) {
    return false;
  }

  const resolvedCharacterID =
    Number(session.characterID || session.charid || session.userid || 0) || 0;
  const moduleParityManifest = buildShipModuleParityManifest(
    resolvedCharacterID,
    resolvedShipID,
    {
      attachProfileID: options.hydrationProfile,
    },
  );
  const hydrationPlan = buildSpaceAttachHydrationPlan(
    options.hydrationProfile || "transition",
  );

  session._space.loginInventoryBootstrapPending = false;
  session._space.loginShipInventoryPrimed = true;
  session._space.loginShipInventoryListed = true;
  session._space.loginChargeHydrationProfile = hydrationPlan.profileID;
  session._space.loginModuleParityManifest = moduleParityManifest;

  log.debug(
    `[space-hydration] attached shipID=${resolvedShipID} ` +
    `profile=${hydrationPlan.profileID} ` +
    `moduleParityFamilies=${JSON.stringify(moduleParityManifest.familyCounts)} ` +
    `${describeSessionHydrationState(session, resolvedShipID)}`,
  );
  return true;
}

module.exports = {
  queuePostSpaceAttachFittingHydration,
};
