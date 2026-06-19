const path = require("path");

const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));

function describeSessionHydrationState(session, shipID = null) {
  if (!session || typeof session !== "object") {
    return "session=none";
  }

  const space = session._space || null;
  const resolvedShipID =
    Number(shipID) ||
    Number(
      space &&
        (space.shipID ||
          session.activeShipID ||
          session.shipID ||
          session.shipid ||
          0),
    ) ||
    0;
  return [
    `clientID=${Number(session.clientID) || 0}`,
    `charID=${Number(session.characterID || session.charid) || 0}`,
    `shipID=${resolvedShipID}`,
    `profile=${
      space && typeof space.loginChargeHydrationProfile === "string"
        ? space.loginChargeHydrationProfile
        : "unknown"
    }`,
    `beyonce=${Boolean(space && space.beyonceBound)}`,
    `initial=${Boolean(space && space.initialStateSent)}`,
    `invPrimed=${Boolean(space && space.loginShipInventoryPrimed)}`,
    `bound=${session.currentBoundObjectID || "none"}`,
  ].join(" ");
}

function flushPendingInitialBallpark(session, pending, attempt = 0) {
  if (!session || !pending || !session.socket || session.socket.destroyed) {
    return;
  }
  if (!session._space || session._space.initialStateSent) {
    return;
  }
  if (pending.awaitBeyonceBound === true && !session._space.beyonceBound) {
    if (attempt >= 480) {
      return;
    }
    setTimeout(() => {
      flushPendingInitialBallpark(session, pending, attempt + 1);
    }, 25);
    return;
  }

  spaceRuntime.ensureInitialBallpark(session, {
    allowDeferredJumpBootstrapVisuals: true,
    force: pending.force === true,
  });
}

function flushPendingCommandSessionEffects(session) {
  if (!session || typeof session !== "object") {
    return;
  }

  const pendingLocalChannelSync = session._pendingLocalChannelSync || null;
  const pendingInitialBallpark = session._pendingCommandInitialBallpark || null;
  session._pendingLocalChannelSync = null;
  session._pendingCommandInitialBallpark = null;

  if (pendingLocalChannelSync) {
    const chatHub = require(path.join(__dirname, "./chatHub"));
    if (typeof chatHub.moveLocalSession === "function") {
      chatHub.moveLocalSession(session, pendingLocalChannelSync.previousChannelID);
    }
  }

  if (pendingInitialBallpark) {
    setTimeout(() => {
      flushPendingInitialBallpark(session, pendingInitialBallpark);
    }, 0);
  }
}

module.exports = {
  describeSessionHydrationState,
  flushPendingCommandSessionEffects,
};
