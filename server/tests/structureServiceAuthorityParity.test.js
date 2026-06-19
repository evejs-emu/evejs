const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
} = require(path.join(repoRoot, "server/src/services/structure/structureConstants"));
const authority = require(path.join(
  repoRoot,
  "server/src/services/structure/structureServiceAuthority",
));
const {
  buildAccessibleStructureServices,
  characterHasStructureSetting,
} = require(path.join(repoRoot, "server/src/services/structure/structurePayloads"));
const {
  STATION_SERVICE_TO_STRUCTURE_SERVICE_ID,
  stationServiceIsEnabledForStationRecord,
} = require(path.join(repoRoot, "server/src/services/_shared/stationStaticData"));

test("structure service authority mirrors the shipped client access setting map", () => {
  assert.deepEqual(authority.STRUCTURE_SETTING_ID, {
    NONE: 0,
    REPROCESSING_TAX: 3,
    MARKET_TAX: 4,
    DEFENSE_CAN_CONTROL_STRUCTURE: 17,
    HOUSING_CAN_DOCK: 19,
    CORP_RENT_OFFICE: 20,
    CLONINGBAY_TAX: 23,
    INDUSTRY_TAX: 24,
    REACTION_BIOCHEMICAL_TAX: 26,
    REACTION_HYBRID_TAX: 27,
    REACTION_COMPOSITE_TAX: 28,
    MANUFACTURING_TAX: 29,
    MANUFACTURING_CAPITAL_TAX: 30,
    MANUFACTURING_SUPERCAPITAL_TAX: 31,
    RESEARCH_TAX: 32,
    INVENTION_TAX: 33,
    JUMP_BRIDGE_ACTIVATION: 34,
    CYNO_BEACON: 35,
    AUTOMOONMINING: 36,
  });

  const expected = {
    [STRUCTURE_SERVICE_ID.FITTING]: authority.STRUCTURE_SETTING_ID.HOUSING_CAN_DOCK,
    [STRUCTURE_SERVICE_ID.DOCKING]: authority.STRUCTURE_SETTING_ID.HOUSING_CAN_DOCK,
    [STRUCTURE_SERVICE_ID.OFFICES]: authority.STRUCTURE_SETTING_ID.CORP_RENT_OFFICE,
    [STRUCTURE_SERVICE_ID.REPROCESSING]: authority.STRUCTURE_SETTING_ID.REPROCESSING_TAX,
    [STRUCTURE_SERVICE_ID.MARKET]: authority.STRUCTURE_SETTING_ID.MARKET_TAX,
    [STRUCTURE_SERVICE_ID.MEDICAL]: authority.STRUCTURE_SETTING_ID.CLONINGBAY_TAX,
    [STRUCTURE_SERVICE_ID.INDUSTRY]: authority.STRUCTURE_SETTING_ID.NONE,
    [STRUCTURE_SERVICE_ID.INSURANCE]: authority.STRUCTURE_SETTING_ID.HOUSING_CAN_DOCK,
    [STRUCTURE_SERVICE_ID.REPAIR]: authority.STRUCTURE_SETTING_ID.HOUSING_CAN_DOCK,
    [STRUCTURE_SERVICE_ID.MOON_MINING]: authority.STRUCTURE_SETTING_ID.DEFENSE_CAN_CONTROL_STRUCTURE,
    [STRUCTURE_SERVICE_ID.JUMP_BRIDGE]: authority.STRUCTURE_SETTING_ID.JUMP_BRIDGE_ACTIVATION,
    [STRUCTURE_SERVICE_ID.CYNO_BEACON]: authority.STRUCTURE_SETTING_ID.CYNO_BEACON,
    [STRUCTURE_SERVICE_ID.MANUFACTURING]: authority.STRUCTURE_SETTING_ID.NONE,
    [STRUCTURE_SERVICE_ID.MANUFACTURING_BASIC]: authority.STRUCTURE_SETTING_ID.MANUFACTURING_TAX,
    [STRUCTURE_SERVICE_ID.MANUFACTURING_CAPITAL]: authority.STRUCTURE_SETTING_ID.MANUFACTURING_CAPITAL_TAX,
    [STRUCTURE_SERVICE_ID.MANUFACTURING_SUPERCAPITAL]: authority.STRUCTURE_SETTING_ID.MANUFACTURING_SUPERCAPITAL_TAX,
    [STRUCTURE_SERVICE_ID.LABORATORY]: authority.STRUCTURE_SETTING_ID.NONE,
    [STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_TIME]: authority.STRUCTURE_SETTING_ID.RESEARCH_TAX,
    [STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_MATERIAL]: authority.STRUCTURE_SETTING_ID.RESEARCH_TAX,
    [STRUCTURE_SERVICE_ID.LABORATORY_COPYING]: authority.STRUCTURE_SETTING_ID.RESEARCH_TAX,
    [STRUCTURE_SERVICE_ID.LABORATORY_INVENTION]: authority.STRUCTURE_SETTING_ID.INVENTION_TAX,
    [STRUCTURE_SERVICE_ID.REACTIONS]: authority.STRUCTURE_SETTING_ID.NONE,
    [STRUCTURE_SERVICE_ID.REACTIONS_COMPOSITE]: authority.STRUCTURE_SETTING_ID.REACTION_COMPOSITE_TAX,
    [STRUCTURE_SERVICE_ID.REACTIONS_BIOCHEMICAL]: authority.STRUCTURE_SETTING_ID.REACTION_BIOCHEMICAL_TAX,
    [STRUCTURE_SERVICE_ID.REACTIONS_HYBRID]: authority.STRUCTURE_SETTING_ID.REACTION_HYBRID_TAX,
    [STRUCTURE_SERVICE_ID.LOYALTY_STORE]: authority.STRUCTURE_SETTING_ID.HOUSING_CAN_DOCK,
    [STRUCTURE_SERVICE_ID.AUTOMOONMINING]: authority.STRUCTURE_SETTING_ID.AUTOMOONMINING,
  };
  assert.deepEqual(authority.SERVICE_ACCESS_SETTING_BY_ID, expected);
});

test("structure service authority mirrors client module-to-service wiring", () => {
  assert.deepEqual(authority.SERVICE_IDS_BY_MODULE_TYPE_ID, {
    35892: [STRUCTURE_SERVICE_ID.MARKET],
    35894: [STRUCTURE_SERVICE_ID.MEDICAL],
    35899: [STRUCTURE_SERVICE_ID.REPROCESSING],
    35891: [
      STRUCTURE_SERVICE_ID.LABORATORY_COPYING,
      STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_MATERIAL,
      STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_TIME,
    ],
    35886: [STRUCTURE_SERVICE_ID.LABORATORY_INVENTION],
    35878: [STRUCTURE_SERVICE_ID.MANUFACTURING_BASIC],
    35881: [STRUCTURE_SERVICE_ID.MANUFACTURING_CAPITAL],
    35877: [
      STRUCTURE_SERVICE_ID.MANUFACTURING_SUPERCAPITAL,
      STRUCTURE_SERVICE_ID.MANUFACTURING_CAPITAL,
    ],
    45550: [
      STRUCTURE_SERVICE_ID.LABORATORY_COPYING,
      STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_MATERIAL,
      STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_TIME,
    ],
    45538: [STRUCTURE_SERVICE_ID.REACTIONS_HYBRID],
    45537: [STRUCTURE_SERVICE_ID.REACTIONS_COMPOSITE],
    45539: [STRUCTURE_SERVICE_ID.REACTIONS_BIOCHEMICAL],
    45009: [STRUCTURE_SERVICE_ID.MOON_MINING],
    35913: [STRUCTURE_SERVICE_ID.JUMP_BRIDGE],
    35912: [STRUCTURE_SERVICE_ID.CYNO_BEACON],
    35914: [STRUCTURE_SERVICE_ID.CYNO_JAMMER],
    78330: [STRUCTURE_SERVICE_ID.LOYALTY_STORE],
    82941: [STRUCTURE_SERVICE_ID.AUTOMOONMINING],
  });

  assert.deepEqual(authority.getStructureServiceIDsForModuleType(35877), [
    STRUCTURE_SERVICE_ID.MANUFACTURING_SUPERCAPITAL,
    STRUCTURE_SERVICE_ID.MANUFACTURING_CAPITAL,
  ]);
  assert.equal(authority.isStructureServiceModuleType(35894), true);
  assert.equal(authority.isStructureServiceModuleType(34), false);
});

test("industry service resolution follows the client structures.services.GetServiceID rules", () => {
  const industryActivity = {
    MANUFACTURING: 1,
    RESEARCH_TIME: 3,
    RESEARCH_MATERIAL: 4,
    COPYING: 5,
    INVENTION: 8,
    REACTION: 9,
  };

  assert.equal(
    authority.getIndustryServiceID(industryActivity.MANUFACTURING, 659, industryActivity),
    STRUCTURE_SERVICE_ID.MANUFACTURING_SUPERCAPITAL,
  );
  assert.equal(
    authority.getIndustryServiceID(industryActivity.MANUFACTURING, 547, industryActivity),
    STRUCTURE_SERVICE_ID.MANUFACTURING_CAPITAL,
  );
  assert.equal(
    authority.getIndustryServiceID(industryActivity.MANUFACTURING, 25, industryActivity),
    STRUCTURE_SERVICE_ID.MANUFACTURING_BASIC,
  );
  assert.equal(
    authority.getIndustryServiceID(industryActivity.REACTION, 712, industryActivity),
    STRUCTURE_SERVICE_ID.REACTIONS_BIOCHEMICAL,
  );
  assert.equal(
    authority.getIndustryServiceID(industryActivity.REACTION, 974, industryActivity),
    STRUCTURE_SERVICE_ID.REACTIONS_HYBRID,
  );
  assert.equal(
    authority.getIndustryServiceID(industryActivity.REACTION, 428, industryActivity),
    STRUCTURE_SERVICE_ID.REACTIONS_COMPOSITE,
  );
  assert.equal(
    authority.getIndustryServiceID(industryActivity.RESEARCH_MATERIAL, 0, industryActivity),
    STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_MATERIAL,
  );
  assert.equal(
    authority.getIndustryServiceID(industryActivity.INVENTION, 0, industryActivity),
    STRUCTURE_SERVICE_ID.LABORATORY_INVENTION,
  );
  assert.deepEqual(
    authority.getIndustryActivityServiceIDs(industryActivity.REACTION, industryActivity),
    [
      STRUCTURE_SERVICE_ID.REACTIONS,
      STRUCTURE_SERVICE_ID.REACTIONS_COMPOSITE,
      STRUCTURE_SERVICE_ID.REACTIONS_BIOCHEMICAL,
      STRUCTURE_SERVICE_ID.REACTIONS_HYBRID,
    ],
  );
});

test("structure payloads expose online services using the central access settings", () => {
  const session = {
    characterID: 140000001,
    charid: 140000001,
    corporationID: 98000000,
    corpid: 98000000,
    allianceID: 0,
    allianceid: 0,
    shipTypeID: 606,
  };
  const structure = {
    structureID: 103990001001,
    typeID: 35834,
    ownerCorpID: 98000000,
    ownerID: 98000000,
    allianceID: 0,
    hasQuantumCore: true,
    dockable: true,
    state: 110,
    accessProfile: {
      docking: "public",
      tethering: "public",
    },
    serviceStates: {
      [STRUCTURE_SERVICE_ID.DOCKING]: STRUCTURE_SERVICE_STATE.ONLINE,
      [STRUCTURE_SERVICE_ID.FITTING]: STRUCTURE_SERVICE_STATE.ONLINE,
      [STRUCTURE_SERVICE_ID.OFFICES]: STRUCTURE_SERVICE_STATE.ONLINE,
      [STRUCTURE_SERVICE_ID.REPROCESSING]: STRUCTURE_SERVICE_STATE.ONLINE,
      [STRUCTURE_SERVICE_ID.MARKET]: STRUCTURE_SERVICE_STATE.ONLINE,
      [STRUCTURE_SERVICE_ID.MEDICAL]: STRUCTURE_SERVICE_STATE.ONLINE,
      [STRUCTURE_SERVICE_ID.MANUFACTURING_BASIC]: STRUCTURE_SERVICE_STATE.ONLINE,
      [STRUCTURE_SERVICE_ID.LABORATORY_COPYING]: STRUCTURE_SERVICE_STATE.ONLINE,
      [STRUCTURE_SERVICE_ID.REACTIONS_COMPOSITE]: STRUCTURE_SERVICE_STATE.ONLINE,
    },
  };

  assert.equal(
    characterHasStructureSetting(
      session,
      structure,
      authority.STRUCTURE_SETTING_ID.REPROCESSING_TAX,
    ),
    true,
  );
  assert.equal(
    characterHasStructureSetting(
      { ...session, corporationID: 111111, corpid: 111111 },
      structure,
      authority.STRUCTURE_SETTING_ID.DEFENSE_CAN_CONTROL_STRUCTURE,
    ),
    false,
  );

  const services = buildAccessibleStructureServices(structure, session);
  assert.deepEqual(
    Object.keys(services).map(Number).sort((left, right) => left - right),
    [
      STRUCTURE_SERVICE_ID.DOCKING,
      STRUCTURE_SERVICE_ID.FITTING,
      STRUCTURE_SERVICE_ID.OFFICES,
      STRUCTURE_SERVICE_ID.REPROCESSING,
      STRUCTURE_SERVICE_ID.MARKET,
      STRUCTURE_SERVICE_ID.MEDICAL,
      STRUCTURE_SERVICE_ID.MANUFACTURING_BASIC,
      STRUCTURE_SERVICE_ID.LABORATORY_COPYING,
      STRUCTURE_SERVICE_ID.REACTIONS_COMPOSITE,
    ],
  );
});

test("legacy station-service checks translate Upwell service IDs before building masks", () => {
  assert.deepEqual(STATION_SERVICE_TO_STRUCTURE_SERVICE_ID, {
    16: STRUCTURE_SERVICE_ID.OFFICES,
    512: STRUCTURE_SERVICE_ID.MEDICAL,
    4096: STRUCTURE_SERVICE_ID.REPAIR,
    8192: STRUCTURE_SERVICE_ID.REPROCESSING,
    16384: STRUCTURE_SERVICE_ID.MARKET,
    65536: STRUCTURE_SERVICE_ID.FITTING,
    1048576: STRUCTURE_SERVICE_ID.INSURANCE,
  });

  const stationRecord = {
    isStructure: true,
    serviceStates: {
      [STRUCTURE_SERVICE_ID.MARKET]: STRUCTURE_SERVICE_STATE.ONLINE,
      [STRUCTURE_SERVICE_ID.REPAIR]: STRUCTURE_SERVICE_STATE.OFFLINE,
    },
  };

  assert.equal(
    stationServiceIsEnabledForStationRecord(stationRecord, 16384),
    true,
    "Expected legacy stationServiceMarket to use structure SERVICE_MARKET",
  );
  assert.equal(
    stationServiceIsEnabledForStationRecord(stationRecord, 4096),
    false,
    "Expected legacy stationServiceRepairFacilities to use structure SERVICE_REPAIR",
  );
  assert.equal(
    stationServiceIsEnabledForStationRecord({ isStructure: false }, 4096),
    true,
    "Expected NPC stations to keep their existing operation/service behavior",
  );
});
