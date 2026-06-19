const path = require("path");

const sessionRegistry = require(path.join(
  __dirname,
  "../chat/sessionRegistry",
));

function normalizePositiveInt(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : fallback;
}

function getSessionStructureID(session) {
  return normalizePositiveInt(
    session && (session.structureID || session.structureid),
    0,
  );
}

function getSessionShipID(session) {
  return normalizePositiveInt(
    session && (session.shipID || session.shipid),
    0,
  );
}

function getSessionActiveShipID(session) {
  return normalizePositiveInt(session && session.activeShipID, 0);
}

function getSessionLocationID(session) {
  return normalizePositiveInt(
    session && (session.locationID || session.locationid),
    0,
  );
}

function getSessionSolarSystemID(session, options = {}) {
  return normalizePositiveInt(
    options.solarSystemID ||
      (session && (
        session.solarsystemid2 ||
        session.solarsystemid ||
        session.solarSystemID
      )),
    0,
  );
}

function isControllingStructureSession(session, structureID = null) {
  const dockedStructureID = getSessionStructureID(session);
  const targetStructureID = normalizePositiveInt(structureID, dockedStructureID);
  if (!targetStructureID || dockedStructureID !== targetStructureID) {
    return false;
  }
  return getSessionShipID(session) === targetStructureID;
}

function getStructurePilotSession(structureID, options = {}) {
  const targetStructureID = normalizePositiveInt(structureID, 0);
  if (!targetStructureID) {
    return null;
  }

  const excludedSession = options.excludeSession || null;
  return sessionRegistry
    .getSessions()
    .find((session) => (
      session !== excludedSession &&
      isControllingStructureSession(session, targetStructureID)
    )) || null;
}

function getStructurePilotCharacterID(structureID, options = {}) {
  const controllerSession = getStructurePilotSession(structureID, options);
  return normalizePositiveInt(
    controllerSession && (controllerSession.characterID || controllerSession.charid),
    0,
  ) || null;
}

function getRestorableShipID(session) {
  const storedShipID = normalizePositiveInt(
    session && session._structureControlPreviousShipID,
    0,
  );
  if (storedShipID) {
    return storedShipID;
  }

  const activeShipID = getSessionActiveShipID(session);
  if (activeShipID) {
    return activeShipID;
  }

  const shipID = getSessionShipID(session);
  const structureID = getSessionStructureID(session);
  if (shipID && shipID !== structureID) {
    return shipID;
  }

  return null;
}

function applySessionShipID(session, shipID) {
  const normalizedShipID = normalizePositiveInt(shipID, 0) || null;
  session.shipID = normalizedShipID;
  session.shipid = normalizedShipID;
}

function applySessionLocationID(session, locationID) {
  const normalizedLocationID = normalizePositiveInt(locationID, 0) || null;
  session.locationID = normalizedLocationID;
  session.locationid = normalizedLocationID;
}

function sendStructureControlSessionChange(session, changes) {
  if (
    !session ||
    typeof session.sendSessionChange !== "function" ||
    !changes ||
    Object.keys(changes).length === 0
  ) {
    return;
  }

  session.sendSessionChange(changes);
}

function relinquishStructureControl(session, options = {}) {
  const structureID = getSessionStructureID(session);
  if (!structureID || !isControllingStructureSession(session, structureID)) {
    return {
      success: true,
      data: {
        changed: false,
        structureID,
        restoredShipID: getSessionShipID(session) || null,
      },
    };
  }

  const oldLocationID = getSessionLocationID(session) || null;
  const restoredLocationID =
    normalizePositiveInt(session._structureControlPreviousLocationID, 0) ||
    structureID;
  const restoredShipID =
    normalizePositiveInt(options.restoreShipID, 0) ||
    getRestorableShipID(session) ||
    null;
  const oldShipID = structureID;

  applySessionShipID(session, restoredShipID);
  applySessionLocationID(session, restoredLocationID);
  delete session._structureControlPreviousShipID;
  delete session._structureControlPreviousLocationID;

  const changes = {};
  if (oldShipID !== restoredShipID) {
    changes.shipid = [oldShipID || null, restoredShipID || null];
  }
  if (oldLocationID !== restoredLocationID) {
    changes.locationid = [oldLocationID || null, restoredLocationID || null];
  }
  sendStructureControlSessionChange(session, changes);

  return {
    success: true,
    data: {
      changed: true,
      structureID,
      restoredShipID,
      restoredLocationID,
    },
  };
}

function assumeStructureControl(session, structureID, options = {}) {
  const targetStructureID = normalizePositiveInt(structureID, 0);
  if (!targetStructureID) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }

  if (getSessionStructureID(session) !== targetStructureID) {
    return {
      success: false,
      errorMsg: "NOT_DOCKED_IN_STRUCTURE",
    };
  }

  if (isControllingStructureSession(session, targetStructureID)) {
    return {
      success: true,
      data: {
        changed: false,
        structureID: targetStructureID,
        previousControllerCharacterID: getStructurePilotCharacterID(
          targetStructureID,
          { excludeSession: session },
        ),
      },
    };
  }

  const currentShipID = getSessionShipID(session);
  const previousShipID =
    currentShipID && currentShipID !== targetStructureID
      ? currentShipID
      : getRestorableShipID(session);

  if (previousShipID) {
    session._structureControlPreviousShipID = previousShipID;
  }
  const currentLocationID = getSessionLocationID(session);
  const controlLocationID =
    getSessionSolarSystemID(session, options) ||
    currentLocationID ||
    null;
  if (currentLocationID && currentLocationID !== controlLocationID) {
    session._structureControlPreviousLocationID = currentLocationID;
  }

  const previousController = getStructurePilotSession(targetStructureID, {
    excludeSession: session,
  });
  const previousControllerCharacterID = normalizePositiveInt(
    previousController && (
      previousController.characterID ||
      previousController.charid
    ),
    0,
  ) || null;

  if (previousController) {
    relinquishStructureControl(previousController, {
      reason: options.reason || "override",
    });
  }

  applySessionShipID(session, targetStructureID);
  // While controlling an Upwell, the client deliberately has
  // shipid == structureid.  Its dogma loader still needs locationid to remain
  // the solar system; if locationid is also the structure, LoadItem(structureID)
  // short-circuits and the next MakeShipActive crashes with KeyError.
  if (controlLocationID) {
    applySessionLocationID(session, controlLocationID);
  }

  const changes = {};
  if ((currentShipID || null) !== targetStructureID) {
    changes.shipid = [currentShipID || null, targetStructureID];
  }
  if ((currentLocationID || null) !== (controlLocationID || null)) {
    changes.locationid = [currentLocationID || null, controlLocationID || null];
  }
  sendStructureControlSessionChange(session, changes);

  return {
    success: true,
    data: {
      changed: true,
      structureID: targetStructureID,
      previousShipID: previousShipID || null,
      previousLocationID: currentLocationID || null,
      controlLocationID: controlLocationID || null,
      previousControllerCharacterID,
    },
  };
}

module.exports = {
  normalizePositiveInt,
  getSessionStructureID,
  getSessionShipID,
  getSessionActiveShipID,
  getSessionLocationID,
  getSessionSolarSystemID,
  isControllingStructureSession,
  getStructurePilotSession,
  getStructurePilotCharacterID,
  relinquishStructureControl,
  assumeStructureControl,
};
