const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const log = require(path.join(__dirname, "../../utils/logger"));
const sessionRegistry = require(path.join(
  __dirname,
  "../chat/sessionRegistry",
));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  getActiveShipItem,
  moveShipToSpace,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  buildStructureEmergencySpaceState,
} = require(path.join(__dirname, "./structureSpaceInterop"));
const {
  queuePostSpaceAttachFittingHydration,
} = require(path.join(__dirname, "../../space/modules/spaceAttachHydration"));

const CHARACTERS_TABLE = "characters";

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function readCharacters() {
  const result = database.read(CHARACTERS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }
  return result.data;
}

function writeCharacterRecord(characterID, record) {
  return database.write(CHARACTERS_TABLE, `/${String(characterID)}`, record);
}

function listCharactersDockedInStructure(structureID) {
  const targetStructureID = toPositiveInt(structureID, 0);
  return Object.entries(readCharacters())
    .map(([characterID, record]) => ({
      characterID: toPositiveInt(characterID, 0),
      record,
    }))
    .filter((entry) => (
      entry.characterID > 0 &&
      entry.record &&
      toPositiveInt(entry.record.structureID, 0) === targetStructureID
    ))
    .sort((left, right) => left.characterID - right.characterID);
}

function evacuateDockedCharactersFromStructure(structure, options = {}) {
  const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
  const structureID = toPositiveInt(structure && structure.structureID, 0);
  const solarSystemID = toPositiveInt(structure && structure.solarSystemID, 0);
  if (!structureID || !solarSystemID) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }

  const system = worldData.getSolarSystemByID(solarSystemID) || {};
  const occupants = listCharactersDockedInStructure(structureID);
  const recovered = [];

  for (const [index, occupant] of occupants.entries()) {
    let activeShip = getActiveShipItem(occupant.characterID);
    const emergencySpaceState = buildStructureEmergencySpaceState(structure, index, {
      shipTypeID: activeShip && activeShip.typeID,
      shipID: activeShip && activeShip.itemID,
      characterID: occupant.characterID,
    });

    if (activeShip) {
      const moveShipResult = moveShipToSpace(
        activeShip.itemID,
        solarSystemID,
        emergencySpaceState,
      );
      if (!moveShipResult.success) {
        log.warn(
          `[StructureDockedRecovery] Failed to move docked ship ${activeShip.itemID} for character ${occupant.characterID} out of destroyed structure ${structureID}: ${moveShipResult.errorMsg}`,
        );
      } else {
        activeShip = getActiveShipItem(occupant.characterID);
      }
    }

    const nextRecord = {
      ...occupant.record,
      stationID: null,
      structureID: null,
      solarSystemID,
      constellationID:
        toPositiveInt(system.constellationID, toPositiveInt(occupant.record && occupant.record.constellationID, 0)) || null,
      regionID:
        toPositiveInt(system.regionID, toPositiveInt(occupant.record && occupant.record.regionID, 0)) || null,
    };
    const updateResult = writeCharacterRecord(occupant.characterID, nextRecord);
    if (!updateResult.success) {
      log.warn(
        `[StructureDockedRecovery] Failed to update character ${occupant.characterID} after structure ${structureID} destruction: ${updateResult.errorMsg}`,
      );
      continue;
    }

    const session = sessionRegistry.findSessionByCharacterID(occupant.characterID);
    let restoredLive = false;
    if (session) {
      try {
        session.sessionChangeReason = "structure_destroyed";
        session.stationID = null;
        session.stationid = null;
        session.structureID = null;
        session.structureid = null;
        session.locationid = solarSystemID;
        session.solarsystemid = solarSystemID;
        session.solarsystemid2 = solarSystemID;
        if (activeShip) {
          session.shipID = activeShip.itemID;
          session.shipid = activeShip.itemID;
          session.activeShipID = activeShip.itemID;
          session.activeShipId = activeShip.itemID;
          session.shipTypeID = activeShip.typeID;
        }
        if (session._space) {
          spaceRuntime.detachSession(session, {
            broadcast: false,
          });
        }
        restoredLive = Boolean(
          activeShip &&
          activeShip.spaceState &&
          spaceRuntime.attachSession(session, activeShip, {
            systemID: solarSystemID,
            pendingUndockMovement: false,
            broadcast: true,
          }) &&
          queuePostSpaceAttachFittingHydration(session, activeShip.itemID, {
            inventoryBootstrapPending: false,
            hydrationProfile: "transition",
          }),
        );
      } catch (error) {
        log.warn(
          `[StructureDockedRecovery] Live session rebuild failed for character ${occupant.characterID} after structure ${structureID} destruction: ${error.message}`,
        );
      }
    }

    recovered.push({
      characterID: occupant.characterID,
      activeShipID: toPositiveInt(activeShip && activeShip.itemID, 0) || null,
      restoredLive,
      spaceState: emergencySpaceState,
    });
  }

  return {
    success: true,
    data: {
      recovered,
    },
  };
}

module.exports = {
  listCharactersDockedInStructure,
  evacuateDockedCharactersFromStructure,
};
