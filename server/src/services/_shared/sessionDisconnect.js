const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const chatHub = require(path.join(__dirname, "../chat/chatHub"));
const structureState = require(path.join(
  __dirname,
  "../structure/structureState",
));
const {
  unregisterCharacterSession,
} = require(path.join(__dirname, "../chat/xmppStubServer"));
const {
  abortTradesForSession,
} = require(path.join(__dirname, "../trade/tradeMgrService"));
const {
  currentFileTime,
} = require(path.join(__dirname, "./serviceHelpers"));
const {
  broadcastStationGuestLeft,
  broadcastStructureGuestLeft,
} = require(path.join(__dirname, "./guestLists"));
const {
  updateCharacterRecord,
  clearCharacterFromSession,
  getActiveShipRecord,
} = require(path.join(__dirname, "../character/characterState"));
const {
  moveShipToSpace,
  ITEM_FLAGS,
} = require(path.join(__dirname, "../inventory/itemStore"));

function hasLocationID(value) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0;
}

function resolveSystemIdentity(solarSystemID, fallback = {}) {
  const system = worldData.getSolarSystemByID(Number(solarSystemID) || 0);
  return {
    constellationID:
      Number((system && system.constellationID) || fallback.constellationID || 0) ||
      20000020,
    regionID:
      Number((system && system.regionID) || fallback.regionID || 0) ||
      10000002,
  };
}

function resolveDockedStateFromShip(activeShip, fallbackSystemID = null) {
  if (!activeShip || Number(activeShip.flagID || 0) !== ITEM_FLAGS.HANGAR) {
    return null;
  }

  const locationID = hasLocationID(activeShip.locationID)
    ? Number(activeShip.locationID)
    : null;
  if (!locationID) {
    return null;
  }

  const station = worldData.getStationByID(locationID);
  if (station) {
    const solarSystemID =
      Number((station && station.solarSystemID) || fallbackSystemID || 0) || null;
    if (!solarSystemID) {
      return null;
    }

    return {
      stationID: locationID,
      structureID: null,
      solarSystemID,
    };
  }

  const structure = structureState.getStructureByID(locationID, {
    refresh: false,
  });
  if (structure) {
    const solarSystemID =
      Number((structure && structure.solarSystemID) || fallbackSystemID || 0) ||
      null;
    if (!solarSystemID) {
      return null;
    }

    return {
      stationID: null,
      structureID: locationID,
      solarSystemID,
    };
  }

  return null;
}

function resolveLiveShipSpaceState(session, activeShip, fallbackSystemID) {
  const shipID =
    Number(
      (session && session._space && session._space.shipID) ||
      (activeShip && activeShip.itemID) ||
      0,
    ) || 0;
  const liveSpaceState = shipID
    ? spaceRuntime.getEntitySpaceStateSnapshot(session, shipID)
    : null;
  if (liveSpaceState && hasLocationID(liveSpaceState.systemID || fallbackSystemID)) {
    return {
      ...liveSpaceState,
      systemID: Number(liveSpaceState.systemID || fallbackSystemID),
    };
  }

  if (
    activeShip &&
    Number(activeShip.flagID || 0) === 0 &&
    hasLocationID(activeShip.locationID) &&
    hasLocationID(activeShip.spaceState && activeShip.spaceState.systemID)
  ) {
    return {
      ...activeShip.spaceState,
      systemID: Number(activeShip.spaceState.systemID || fallbackSystemID),
    };
  }

  return null;
}

function persistCharacterLogoffState(session) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "SESSION_REQUIRED",
    };
  }

  const characterID = Number(session.characterID || 0);
  const sessionStationID = hasLocationID(session.stationID || session.stationid)
    ? Number(session.stationID || session.stationid)
    : null;
  const sessionStructureID = hasLocationID(session.structureID || session.structureid)
    ? Number(session.structureID || session.structureid)
    : null;
  const sessionSpaceSystemID = hasLocationID(
    session._space && session._space.systemID,
  )
    ? Number(session._space.systemID)
    : null;
  const sessionSolarSystemID = hasLocationID(session.solarsystemid)
    ? Number(session.solarsystemid)
    : hasLocationID(session.solarsystemid2)
      ? Number(session.solarsystemid2)
      : null;
  const dockedSolarSystemID = sessionStationID
    ? Number(
      (
        worldData.getStationByID(sessionStationID) || {}
      ).solarSystemID || sessionSolarSystemID || 0,
    ) || null
    : sessionStructureID
      ? Number(
        (
          structureState.getStructureByID(sessionStructureID, { refresh: false }) || {}
        ).solarSystemID || sessionSolarSystemID || 0,
      ) || null
      : null;
  const nextSolarSystemID =
    (sessionStationID || sessionStructureID)
      ? dockedSolarSystemID
      : sessionSpaceSystemID || sessionSolarSystemID || 30000142;
  const logoffDate = currentFileTime().toString();
  let persistedStationID = sessionStationID;
  let persistedStructureID = sessionStructureID;
  let persistedSolarSystemID = nextSolarSystemID;
  const activeShip = getActiveShipRecord(characterID);

  if (!persistedStationID && !persistedStructureID && activeShip) {
    const liveSpaceState = resolveLiveShipSpaceState(
      session,
      activeShip,
      persistedSolarSystemID,
    );
    if (liveSpaceState) {
      const moveResult = moveShipToSpace(
        activeShip.itemID,
        Number(liveSpaceState.systemID || persistedSolarSystemID),
        liveSpaceState,
      );
      if (!moveResult.success) {
        log.warn(
          `[SessionDisconnect] Failed to persist active ship ${activeShip.itemID} into space for char=${characterID}: ${moveResult.errorMsg}`,
        );
      } else {
        persistedStationID = null;
        persistedStructureID = null;
        persistedSolarSystemID = Number(liveSpaceState.systemID || persistedSolarSystemID);
      }
    } else {
      const dockedFallback = resolveDockedStateFromShip(
        activeShip,
        persistedSolarSystemID,
      );
      if (dockedFallback) {
        persistedStationID = dockedFallback.stationID;
        persistedStructureID = dockedFallback.structureID;
        persistedSolarSystemID = dockedFallback.solarSystemID;
        log.warn(
          persistedStructureID
            ? `[SessionDisconnect] Missing live space state for char=${characterID} ship=${activeShip.itemID}; preserving docked ship state at structure=${persistedStructureID} instead of synthesizing a space position.`
            : `[SessionDisconnect] Missing live space state for char=${characterID} ship=${activeShip.itemID}; preserving docked ship state at station=${persistedStationID} instead of synthesizing a space position.`,
        );
      } else {
        log.warn(
          `[SessionDisconnect] Missing live space state for char=${characterID} ship=${activeShip.itemID}; leaving persisted ship state unchanged to avoid inventing coordinates.`,
        );
      }
    }
  }

  const updateResult = updateCharacterRecord(characterID, (record) => {
    const systemIdentity = resolveSystemIdentity(persistedSolarSystemID, record);
    return {
      ...record,
      stationID: persistedStationID,
      structureID: persistedStructureID,
      solarSystemID: persistedSolarSystemID,
      constellationID: systemIdentity.constellationID,
      regionID: systemIdentity.regionID,
      logoffDate,
    };
  });

  if (!updateResult.success) {
    log.warn(
      `[SessionDisconnect] Failed to persist logoff state for char=${characterID}: ${updateResult.errorMsg}`,
    );
    return updateResult;
  }

  return updateResult;
}

function disconnectCharacterSession(session, options = {}) {
  if (!session) {
    return {
      success: false,
      errorMsg: "SESSION_REQUIRED",
    };
  }

  const stationID = Number(session.stationid || session.stationID || 0);
  const structureID = Number(session.structureid || session.structureID || 0);

  persistCharacterLogoffState(session);
  if (stationID) {
    broadcastStationGuestLeft(session, stationID);
  } else if (structureID) {
    broadcastStructureGuestLeft(session, structureID);
  }
  spaceRuntime.detachSession(session, {
    broadcast: options.broadcast !== false,
    lifecycleReason: String(options.lifecycleReason || "disconnect"),
    attemptDroneBayRecovery: true,
    attemptFighterTubeRecovery: true,
  });
  abortTradesForSession(session);
  chatHub.unregisterSession(session);
  unregisterCharacterSession(session);

  if (options.clearSession !== false) {
    clearCharacterFromSession(session, {
      emitNotifications: false,
    });
  }

  return {
    success: true,
  };
}

module.exports = {
  persistCharacterLogoffState,
  disconnectCharacterSession,
};
