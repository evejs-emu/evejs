const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const {
  _testing,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));

const {
  buildCharacterSessionNotificationPlan,
} = _testing;

function buildBaseSession(overrides = {}) {
  return {
    characterID: 140000008,
    corporationID: 9800000,
    corpid: 9800000,
    allianceID: 99000001,
    allianceid: 99000001,
    genderID: 1,
    bloodlineID: 1,
    raceID: 1,
    schoolID: 1000044,
    factionID: null,
    factionid: null,
    stationid: null,
    stationid2: null,
    structureid: 1030000000006,
    structureID: 1030000000006,
    solarsystemid: 30000142,
    solarsystemid2: 30000142,
    constellationID: 20000020,
    regionID: 10000002,
    locationid: 1030000000006,
    worldspaceid: null,
    shipID: 991000295,
    shipid: 991000295,
    role: 0n,
    corprole: 0n,
    rolesAtAll: 0n,
    rolesAtBase: 0n,
    rolesAtHQ: 0n,
    rolesAtOther: 0n,
    ...overrides,
  };
}

test("structure-docked ship boarding does not defer shipid when already docked in the same structure", () => {
  const session = buildBaseSession({
    shipID: 991000295,
    shipid: 991000295,
  });

  const plan = buildCharacterSessionNotificationPlan(session, {
    charID: 140000008,
    shipID: 991000295,
    isDocked: true,
    isCharacterSelection: false,
    isInitialCharacterSelection: false,
    oldCharID: 140000008,
    oldCorpID: 9800000,
    oldAllianceID: 99000001,
    oldStationID: null,
    oldStationID2: null,
    oldStructureID: 1030000000006,
    oldSolarSystemID: 30000142,
    oldSolarSystemID2: 30000142,
    oldConstellationID: 20000020,
    oldRegionID: 10000002,
    oldGenderID: 1,
    oldBloodlineID: 1,
    oldRaceID: 1,
    oldSchoolID: 1000044,
    oldFactionID: null,
    oldShipID: 991000222,
    oldLocationID: 1030000000006,
    oldWorldspaceID: null,
    oldHqID: null,
    oldBaseID: null,
    oldWarFactionID: null,
    oldCorpAccountKey: null,
    oldRole: 0n,
    oldCorpRole: 0n,
    oldRolesAtAll: 0n,
    oldRolesAtBase: 0n,
    oldRolesAtHQ: 0n,
    oldRolesAtOther: 0n,
    selectionEvent: false,
  });

  assert.equal(
    plan.deferDockedShipSessionChange,
    false,
    "expected structure-docked boarding to publish the new shipid immediately",
  );
  assert.deepEqual(plan.sessionChanges.shipid, [991000222, 991000295]);
});

test("fresh dock into a structure still defers shipid until the docked bootstrap is ready", () => {
  const session = buildBaseSession({
    shipID: 991000295,
    shipid: 991000295,
  });

  const plan = buildCharacterSessionNotificationPlan(session, {
    charID: 140000008,
    shipID: 991000295,
    isDocked: true,
    isCharacterSelection: false,
    isInitialCharacterSelection: false,
    oldCharID: 140000008,
    oldCorpID: 9800000,
    oldAllianceID: 99000001,
    oldStationID: null,
    oldStationID2: null,
    oldStructureID: null,
    oldSolarSystemID: 30000142,
    oldSolarSystemID2: 30000142,
    oldConstellationID: 20000020,
    oldRegionID: 10000002,
    oldGenderID: 1,
    oldBloodlineID: 1,
    oldRaceID: 1,
    oldSchoolID: 1000044,
    oldFactionID: null,
    oldShipID: 991000222,
    oldLocationID: 30000142,
    oldWorldspaceID: null,
    oldHqID: null,
    oldBaseID: null,
    oldWarFactionID: null,
    oldCorpAccountKey: null,
    oldRole: 0n,
    oldCorpRole: 0n,
    oldRolesAtAll: 0n,
    oldRolesAtBase: 0n,
    oldRolesAtHQ: 0n,
    oldRolesAtOther: 0n,
    selectionEvent: false,
  });

  assert.equal(plan.deferDockedShipSessionChange, true);
  assert.deepEqual(plan.sessionChanges.shipid, [991000222, null]);
});
