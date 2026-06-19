const path = require("path");

const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const {
  getStationRecord,
} = require(path.join(__dirname, "../_shared/stationStaticData"));
const {
  NEW_CHARACTER_START_OVERRIDE,
} = require(path.join(__dirname, "../_shared/newCharacterStartOverride"));
const {
  TUTORIAL_ENTRY_MODE,
  normalizeTutorialEntryMode,
} = require(path.join(__dirname, "./tutorialRuntime"));

const CINEMATIC_SPAWN_STATION_ID = NEW_CHARACTER_START_OVERRIDE.stationID || 60003760;

function cloneVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  if (!vector || typeof vector !== "object") {
    return { ...fallback };
  }
  return {
    x: Number.isFinite(Number(vector.x)) ? Number(vector.x) : fallback.x,
    y: Number.isFinite(Number(vector.y)) ? Number(vector.y) : fallback.y,
    z: Number.isFinite(Number(vector.z)) ? Number(vector.z) : fallback.z,
  };
}

function isCinematicSpaceEntryMode(entryMode) {
  return normalizeTutorialEntryMode(entryMode) ===
    TUTORIAL_ENTRY_MODE.CINEMATIC_INTRO_OVERLAY;
}

function resolveCinematicSpawnStation() {
  return getStationRecord(null, CINEMATIC_SPAWN_STATION_ID);
}

function buildCinematicSpaceSpawnContext(options = {}) {
  // Legacy helper kept for spawn-position calculations. Character selection for
  // the intro movie path is docked/hangar-first; the client intro overlay owns
  // presentation while the game loads underneath.
  const station = resolveCinematicSpawnStation();
  if (!station || Number(station.stationID || 0) <= 0) {
    return {
      success: false,
      errorMsg: "CINEMATIC_SPAWN_STATION_NOT_FOUND",
    };
  }

  const undockState = spaceRuntime.getStationUndockSpawnState(station, {
    shipTypeID: Number(options.shipTypeID || 0) || undefined,
    selectionStrategy: "first",
    selectionKey:
      Number(options.selectionKey || options.characterID || 0) || undefined,
  });

  return {
    success: true,
    data: {
      stationID: Number(station.stationID) || CINEMATIC_SPAWN_STATION_ID,
      solarSystemID: Number(station.solarSystemID) || 30000142,
      constellationID: Number(station.constellationID) || 20000020,
      regionID: Number(station.regionID) || 10000002,
      position: cloneVector(undockState && undockState.position),
      direction: cloneVector(undockState && undockState.direction, {
        x: 1,
        y: 0,
        z: 0,
      }),
      velocity: { x: 0, y: 0, z: 0 },
      speedFraction: 0,
      mode: "STOP",
    },
  };
}

module.exports = {
  CINEMATIC_SPAWN_STATION_ID,
  buildCinematicSpaceSpawnContext,
  isCinematicSpaceEntryMode,
  resolveCinematicSpawnStation,
};
