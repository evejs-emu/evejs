const path = require("path");

const repoRoot = path.join(__dirname, "..", "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const itemStore = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  buildSkillRecord,
  getSkillTypeByID,
  replaceCharacterSkillRecords,
} = require(path.join(repoRoot, "server/src/services/skills/skillState"));

const DEFAULT_STATION_ID = 60003760;
const DEFAULT_SYSTEM_ID = 30000142;
const DEFAULT_SHIP_TYPE_ID = 597; // Punisher
const DEFAULT_LASER_TYPE_ID = 453; // Small Focused Pulse Laser I
const DEFAULT_CRYSTAL_TYPE_ID = 246; // Multifrequency S
const DEFAULT_MWD_TYPE_ID = 434; // 5MN Microwarpdrive I
const DEFAULT_SKILL_TYPE_IDS = Object.freeze([
  3300, // Gunnery
  3303, // Small Energy Turret
  3307, // Large Hybrid Turret
  3308, // Large Projectile Turret
  3312, // Motion Prediction
  3316, // Controlled Bursts
  3318, // Weapon Upgrades
  11207, // Advanced Weapon Upgrades
  3327, // Spaceship Command
  3338, // Caldari Battleship
  3337, // Minmatar Battleship
  3449, // Navigation
  3402, // Science
  3418, // Capacitor Systems Operation
  3426, // CPU Management
  3413, // Power Grid Management
]);

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readTable(table) {
  const result = database.read(table, "/");
  return cloneValue((result && result.data) || {});
}

function buildFixtureCharacterRecord(characterID, options = {}) {
  const stationID =
    options.stationID === null ? null : Number(options.stationID || DEFAULT_STATION_ID);
  const solarSystemID = Number(options.solarSystemID || DEFAULT_SYSTEM_ID);
  const shipID = Number(options.shipID || (characterID * 10000 + 1));
  const shipTypeID = Number(options.shipTypeID || DEFAULT_SHIP_TYPE_ID);
  return {
    accountId: Number(options.accountID || characterID + 1000),
    characterID,
    charID: characterID,
    characterName: options.characterName || `Test Fixture ${characterID}`,
    gender: 1,
    bloodlineID: 1,
    ancestryID: 1,
    raceID: 1,
    typeID: 1373,
    corporationID: Number(options.corporationID || 1000006),
    schoolID: 11,
    allianceID: 0,
    factionID: 500001,
    stationID,
    homeStationID: Number(options.homeStationID || DEFAULT_STATION_ID),
    cloneStationID: Number(options.cloneStationID || DEFAULT_STATION_ID),
    solarSystemID,
    constellationID: Number(options.constellationID || 20000020),
    regionID: Number(options.regionID || 10000002),
    createDateTime: "134247000000000000",
    startDateTime: "134247000000000000",
    logoffDate: "134247000000000000",
    deletePrepareDateTime: null,
    lockTypeID: null,
    securityRating: 0,
    title: "",
    description: "Seeded by test fixture",
    balance: Number(options.balance || 1_000_000_000),
    aurBalance: 0,
    plexBalance: Number(options.plexBalance || 0),
    balanceChange: 0,
    walletJournal: [],
    plexVaultTransactions: [],
    skillPoints: 0,
    shipTypeID,
    shipName: options.shipName || "Fixture Ship",
    bounty: 0,
    skillQueueEndTime: 0,
    daysLeft: 365,
    userType: 30,
    petitionMessage: "",
    worldSpaceID: 0,
    unreadMailCount: 0,
    upcomingEventCount: 0,
    unprocessedNotifications: 0,
    shipID,
    shortName: "none",
    employmentHistory: [
      {
        corporationID: Number(options.corporationID || 1000006),
        startDate: "134247000000000000",
        deleted: 0,
      },
    ],
    standingData: { char: [], corp: [], npc: [] },
    characterAttributes: {
      charisma: 20,
      intelligence: 20,
      memory: 20,
      perception: 20,
      willpower: 20,
    },
    respecInfo: {
      freeRespecs: 3,
      lastRespecDate: null,
      nextTimedRespec: null,
    },
    freeSkillPoints: Number(options.freeSkillPoints || 0),
    skillHistory: [],
    boosters: [],
    implants: [],
    jumpClones: [],
    timeLastCloneJump: "0",
    allianceMemberStartDate: 0,
    skillTypeID: null,
    toLevel: null,
    trainingStartTime: null,
    trainingEndTime: null,
    queueEndTime: null,
    finishSP: null,
    trainedSP: null,
    finishedSkills: [],
    appearanceInfo: null,
    portraitInfo: null,
    paperDollState: 2,
    tutorialEntryMode: "none",
    tutorialFirstLoginHandoff: "none",
    airNpeState: 0,
    airNpeRevealOnFirstLogin: false,
    nesIntroState: 0,
    tutorialProgress: { version: 1, categories: {}, missionAvoidanceSystems: [] },
    structureID: null,
    empireID: null,
    securityStatus: 0,
    marketTransactions: [],
  };
}

function seedCharacterRecord(characterID, options = {}) {
  const characters = readTable("characters");
  characters[String(characterID)] = {
    ...(characters[String(characterID)] || {}),
    ...buildFixtureCharacterRecord(characterID, options),
  };
  database.write("characters", "/", characters);
  return characters[String(characterID)];
}

function seedSkillRecords(characterID, skillTypeIDs = DEFAULT_SKILL_TYPE_IDS, level = 5) {
  const records = skillTypeIDs
    .map((typeID) => getSkillTypeByID(typeID))
    .filter(Boolean)
    .map((skillType) => buildSkillRecord(characterID, skillType, level));
  replaceCharacterSkillRecords(characterID, records);
  return records;
}

function putItem(items, item) {
  items[String(item.itemID)] = item;
  return item;
}

function seedCombatShipFixture(options = {}) {
  const characterID = Number(options.characterID);
  if (!characterID) {
    throw new Error("seedCombatShipFixture requires characterID");
  }

  const solarSystemID = Number(options.solarSystemID || DEFAULT_SYSTEM_ID);
  const stationID =
    options.inSpace === false ? Number(options.stationID || DEFAULT_STATION_ID) : null;
  const shipID = Number(options.shipID || (characterID * 10000 + 1));
  const shipTypeID = Number(options.shipTypeID || DEFAULT_SHIP_TYPE_ID);
  seedCharacterRecord(characterID, {
    ...options,
    stationID,
    solarSystemID,
    shipID,
    shipTypeID,
  });
  seedSkillRecords(characterID, options.skillTypeIDs || DEFAULT_SKILL_TYPE_IDS, 5);

  const items = readTable("items");
  const shipLocationID = stationID || solarSystemID;
  const ship = putItem(items, itemStore.buildShipItem({
    itemID: shipID,
    typeID: shipTypeID,
    ownerID: characterID,
    locationID: shipLocationID,
    flagID: stationID ? itemStore.ITEM_FLAGS.HANGAR : 0,
    itemName: options.shipName || "Fixture Ship",
    spaceState: stationID
      ? null
      : {
        systemID: solarSystemID,
        position: options.position || { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        rotation: { yaw: 0, pitch: 0, roll: 0 },
      },
  }));

  const moduleSpecs = options.modules || [
    { itemID: shipID + 1, typeID: DEFAULT_LASER_TYPE_ID, flagID: 11, online: true },
    { itemID: shipID + 2, typeID: DEFAULT_MWD_TYPE_ID, flagID: 12, online: true },
  ];
  const chargeSpecs = options.charges || [
    { itemID: shipID + 101, typeID: DEFAULT_CRYSTAL_TYPE_ID, flagID: 11, quantity: 1 },
  ];

  const modules = moduleSpecs.map((spec) => putItem(items, itemStore.buildInventoryItem({
    itemID: Number(spec.itemID),
    typeID: Number(spec.typeID),
    ownerID: characterID,
    locationID: shipID,
    flagID: Number(spec.flagID),
    singleton: 1,
    moduleState: {
      online: spec.online !== false,
      damage: 0,
      charge: 1,
      skillPoints: 0,
      armorDamage: 0,
      shieldCharge: 0,
      incapacitated: false,
    },
  })));
  const charges = chargeSpecs.map((spec) => putItem(items, itemStore.buildInventoryItem({
    itemID: Number(spec.itemID),
    typeID: Number(spec.typeID),
    ownerID: characterID,
    locationID: shipID,
    flagID: Number(spec.flagID),
    quantity: Number(spec.quantity || 1),
    singleton: 0,
  })));

  database.write("items", "/", items);
  itemStore.resetInventoryStoreForTests();

  return {
    characterID,
    ship,
    modules,
    charges,
  };
}

module.exports = {
  DEFAULT_CRYSTAL_TYPE_ID,
  DEFAULT_LASER_TYPE_ID,
  DEFAULT_MWD_TYPE_ID,
  DEFAULT_SHIP_TYPE_ID,
  DEFAULT_STATION_ID,
  DEFAULT_SYSTEM_ID,
  seedCharacterRecord,
  seedCombatShipFixture,
  seedSkillRecords,
};
