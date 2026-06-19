// TQ-observed Jita gate presence from client/officialgates2.txt.
// CCP lore moved Jita administration under CONCORD with EverMore/Villore Sec Ops
// handling day-to-day security/customs; keep this as repo-owned authority rather
// than scattering one-off JSON patches through startup rules.
const JITA_SOLAR_SYSTEM_ID = 30000142;

const EVERMORE_FACTION_ID = 500013;
const EVERMORE_CUSTOMS_CORPORATION_ID = 1000217;
const CONCORD_FACTION_ID = 500006;
const CONCORD_BILLBOARD_CORPORATION_ID = 1000125;

const EVERMORE_CUSTOMS_MAJOR_TYPE_ID = 94176;
const EVERMORE_CUSTOMS_OFFICIAL_TYPE_ID = 94177;
const EVERMORE_CUSTOMS_MAJOR_PROFILE_ID = "evermore_gate_customs_major";
const EVERMORE_CUSTOMS_OFFICIAL_PROFILE_ID = "evermore_gate_customs_official";
const EVERMORE_CUSTOMS_LOADOUT_ID = "evermore_gate_customs_unarmed";
const EVERMORE_CUSTOMS_SPAWN_GROUP_ID = "evermore_gate_customs";
const EVERMORE_GATE_STARTUP_RULE_PREFIX = "default_evermore_gate_presence_";

const BILLBOARD_TYPE_ID = 11136;
const BILLBOARD_OFFSET = Object.freeze({ x: -18_000, y: 10_000, z: -28_000 });

const SENTRY_OWNER_ID = CONCORD_FACTION_ID;
const SENTRY_CORPORATION_ID = CONCORD_FACTION_ID;
const SENTRY_RADIUS_METERS = 45;
const SENTRY_DIAGONAL_METERS = 50_000 / Math.sqrt(2);

const SENTRY_OFFSET = Object.freeze({
  xNegYPos: Object.freeze({ x: -SENTRY_DIAGONAL_METERS, y: SENTRY_DIAGONAL_METERS, z: 0 }),
  xPosYNeg: Object.freeze({ x: SENTRY_DIAGONAL_METERS, y: -SENTRY_DIAGONAL_METERS, z: 0 }),
  xNegYNeg: Object.freeze({ x: -SENTRY_DIAGONAL_METERS, y: -SENTRY_DIAGONAL_METERS, z: 0 }),
  xPosYPos: Object.freeze({ x: SENTRY_DIAGONAL_METERS, y: SENTRY_DIAGONAL_METERS, z: 0 }),
  yPosZNeg: Object.freeze({ x: 0, y: SENTRY_DIAGONAL_METERS, z: -SENTRY_DIAGONAL_METERS }),
  yNegZPos: Object.freeze({ x: 0, y: -SENTRY_DIAGONAL_METERS, z: SENTRY_DIAGONAL_METERS }),
  yNegZNeg: Object.freeze({ x: 0, y: -SENTRY_DIAGONAL_METERS, z: -SENTRY_DIAGONAL_METERS }),
  yPosZPos: Object.freeze({ x: 0, y: SENTRY_DIAGONAL_METERS, z: SENTRY_DIAGONAL_METERS }),
});

function sentry(typeID, offsetKey) {
  return Object.freeze({
    typeID,
    offset: SENTRY_OFFSET[offsetKey],
  });
}

const JITA_GATE_SENTRY_LAYOUTS = Object.freeze({
  50001248: Object.freeze([
    sentry(3740, "xNegYPos"),
    sentry(3741, "xPosYNeg"),
    sentry(3740, "xNegYNeg"),
    sentry(3740, "xPosYPos"),
    sentry(3740, "yPosZNeg"),
    sentry(3741, "yNegZPos"),
    sentry(3741, "yNegZNeg"),
    sentry(3739, "yPosZPos"),
  ]),
  50001249: Object.freeze([
    sentry(3739, "xNegYPos"),
    sentry(3740, "xPosYNeg"),
    sentry(3741, "xNegYNeg"),
    sentry(3739, "xPosYPos"),
    sentry(3739, "yPosZNeg"),
    sentry(3741, "yNegZPos"),
    sentry(3739, "yNegZNeg"),
    sentry(3741, "yPosZPos"),
  ]),
  50001250: Object.freeze([
    sentry(3739, "xNegYPos"),
    sentry(3739, "xPosYNeg"),
    sentry(3741, "xNegYNeg"),
    sentry(3739, "xPosYPos"),
    sentry(3739, "yPosZNeg"),
    sentry(3739, "yNegZPos"),
    sentry(3739, "yNegZNeg"),
    sentry(3740, "yPosZPos"),
  ]),
  50013876: Object.freeze([
    sentry(3741, "xNegYPos"),
    sentry(3739, "xPosYNeg"),
    sentry(3740, "xNegYNeg"),
    sentry(3739, "xPosYPos"),
    sentry(3740, "yPosZNeg"),
    sentry(3740, "yNegZPos"),
    sentry(3741, "yNegZNeg"),
    sentry(3739, "yPosZPos"),
  ]),
  50013913: Object.freeze([
    sentry(3740, "xNegYPos"),
    sentry(3740, "xPosYNeg"),
    sentry(3739, "xNegYNeg"),
    sentry(3739, "xPosYPos"),
    sentry(3740, "yPosZNeg"),
    sentry(3739, "yNegZPos"),
    sentry(3740, "yNegZNeg"),
    sentry(3740, "yPosZPos"),
  ]),
  50013921: Object.freeze([
    sentry(3741, "xNegYPos"),
    sentry(3739, "xPosYNeg"),
    sentry(3739, "xNegYNeg"),
    sentry(3739, "xPosYPos"),
    sentry(3740, "yPosZNeg"),
    sentry(3740, "yNegZPos"),
    sentry(3741, "yNegZNeg"),
    sentry(3740, "yPosZPos"),
  ]),
  50013928: Object.freeze([
    sentry(3740, "xNegYPos"),
    sentry(3740, "xPosYNeg"),
    sentry(3739, "xNegYNeg"),
    sentry(3741, "xPosYPos"),
    sentry(3739, "yPosZNeg"),
    sentry(3739, "yNegZPos"),
    sentry(3740, "yNegZNeg"),
    sentry(3739, "yPosZPos"),
  ]),
});

const MAJOR_SPEED_FRACTION = 0.13333334028720856;
const OFFICIAL_SPEED_FRACTION = 0.10000000149011612;

function customsSlot(typeID, offset, target, maxVelocity, speedFraction) {
  return Object.freeze({
    profileID: typeID === EVERMORE_CUSTOMS_MAJOR_TYPE_ID
      ? EVERMORE_CUSTOMS_MAJOR_PROFILE_ID
      : EVERMORE_CUSTOMS_OFFICIAL_PROFILE_ID,
    typeID,
    offset: Object.freeze(offset),
    orbitTarget: target,
    orbitDistanceMeters: 6_000,
    maxVelocity,
    speedFraction,
  });
}

function major(offset, target) {
  return customsSlot(
    EVERMORE_CUSTOMS_MAJOR_TYPE_ID,
    offset,
    target,
    1_500,
    MAJOR_SPEED_FRACTION,
  );
}

function official(offset, target) {
  return customsSlot(
    EVERMORE_CUSTOMS_OFFICIAL_TYPE_ID,
    offset,
    target,
    5_000,
    OFFICIAL_SPEED_FRACTION,
  );
}

const JITA_GATE_CUSTOMS_LAYOUTS = Object.freeze({
  50001248: Object.freeze([
    major({ x: 2_175.0, y: -346.6, z: 10_293.3 }, "anchor"),
    official({ x: -282.7, y: 2_940.9, z: 4_979.8 }, 0),
    official({ x: -5_626.8, y: 6_989.2, z: 11_329.9 }, 1),
    major({ x: -3_565.6, y: -2_734.5, z: 9_827.5 }, 2),
  ]),
  50001249: Object.freeze([
    major({ x: -256.7, y: -7_262.4, z: 7_616.8 }, "anchor"),
    major({ x: -5_917.7, y: 5_513.4, z: 7_050.0 }, 0),
    official({ x: -12_061.9, y: 3_387.8, z: 7_432.8 }, 1),
    official({ x: -6_494.6, y: 1_977.6, z: -1_527.1 }, 2),
  ]),
  50001250: Object.freeze([
    major({ x: 8_375.2, y: -4_893.2, z: -4_093.7 }, "anchor"),
    major({ x: -3_321.7, y: -138.8, z: -10_074.8 }, 0),
    official({ x: -5_196.4, y: 1_979.2, z: -3_556.3 }, 1),
    official({ x: -3_833.3, y: 4_510.7, z: -10_432.3 }, 2),
  ]),
  50013876: Object.freeze([
    major({ x: -1_266.3, y: 6_187.7, z: 13_445.7 }, "anchor"),
    official({ x: 5_488.9, y: 5_986.2, z: 12_178.9 }, 0),
    major({ x: -4_375.4, y: 11_574.0, z: 4_020.4 }, 1),
    official({ x: -2_760.2, y: 13_425.8, z: 9_871.6 }, 2),
  ]),
  50013921: Object.freeze([
    official({ x: 1_158.4, y: -7_028.5, z: 6_704.6 }, "anchor"),
    major({ x: -1_064.2, y: 299.9, z: -2_606.9 }, 0),
    major({ x: 5_010.8, y: 2_877.1, z: -5_297.3 }, 1),
    official({ x: -1_357.1, y: 4_799.0, z: -3_541.7 }, 2),
  ]),
  50013928: Object.freeze([
    official({ x: -8_649.6, y: -2_125.5, z: 6_197.2 }, "anchor"),
    official({ x: -6_145.6, y: -6_695.1, z: -4_395.7 }, 0),
    major({ x: 1_334.6, y: 3_290.9, z: 613.4 }, 1),
    major({ x: -4_073.2, y: -431.4, z: 2_278.3 }, 2),
  ]),
});

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function cloneVector(vector = {}) {
  return {
    x: Number(vector.x) || 0,
    y: Number(vector.y) || 0,
    z: Number(vector.z) || 0,
  };
}

function cloneSlot(slot) {
  return {
    ...slot,
    offset: cloneVector(slot.offset),
  };
}

function getConfiguredEverMoreGatePresenceSystemIDs(config = {}) {
  if (config.npcDefaultEverMoreGatePresenceEnabled === false) {
    return [];
  }
  return [JITA_SOLAR_SYSTEM_ID];
}

function isEverMoreGatePresenceSystem(systemID, config = {}) {
  const numericSystemID = toPositiveInt(systemID, 0);
  return config.npcDefaultEverMoreGatePresenceEnabled !== false &&
    numericSystemID === JITA_SOLAR_SYSTEM_ID;
}

function getEverMoreGateSentryLayout(systemID, gateID) {
  if (toPositiveInt(systemID, 0) === JITA_SOLAR_SYSTEM_ID) {
    const layout = JITA_GATE_SENTRY_LAYOUTS[toPositiveInt(gateID, 0)];
    if (layout) {
      return layout.map(cloneSlot);
    }
  }
  return [];
}

function getEverMoreGateBillboardLayout() {
  return {
    typeID: BILLBOARD_TYPE_ID,
    ownerID: CONCORD_BILLBOARD_CORPORATION_ID,
    corporationID: CONCORD_BILLBOARD_CORPORATION_ID,
    factionID: CONCORD_FACTION_ID,
    offset: cloneVector(BILLBOARD_OFFSET),
  };
}

function getEverMoreGateCustomsLayout(systemID, gateID) {
  if (toPositiveInt(systemID, 0) === JITA_SOLAR_SYSTEM_ID) {
    const layout = JITA_GATE_CUSTOMS_LAYOUTS[toPositiveInt(gateID, 0)];
    return layout ? layout.map(cloneSlot) : [];
  }
  return [];
}

function getEverMoreGateCustomsExpectedCount(systemID, gateID) {
  return getEverMoreGateCustomsLayout(systemID, gateID).length;
}

module.exports = {
  BILLBOARD_TYPE_ID,
  CONCORD_BILLBOARD_CORPORATION_ID,
  CONCORD_FACTION_ID,
  EVERMORE_CUSTOMS_CORPORATION_ID,
  EVERMORE_CUSTOMS_LOADOUT_ID,
  EVERMORE_CUSTOMS_MAJOR_PROFILE_ID,
  EVERMORE_CUSTOMS_MAJOR_TYPE_ID,
  EVERMORE_CUSTOMS_OFFICIAL_PROFILE_ID,
  EVERMORE_CUSTOMS_OFFICIAL_TYPE_ID,
  EVERMORE_CUSTOMS_SPAWN_GROUP_ID,
  EVERMORE_FACTION_ID,
  EVERMORE_GATE_STARTUP_RULE_PREFIX,
  JITA_SOLAR_SYSTEM_ID,
  SENTRY_CORPORATION_ID,
  SENTRY_OWNER_ID,
  SENTRY_RADIUS_METERS,
  getConfiguredEverMoreGatePresenceSystemIDs,
  getEverMoreGateBillboardLayout,
  getEverMoreGateCustomsExpectedCount,
  getEverMoreGateCustomsLayout,
  getEverMoreGateSentryLayout,
  isEverMoreGatePresenceSystem,
};
