const path = require("path");
const {
  spawnShipInHangarForSession,
  giveItemToHangarForSession,
  getActiveShipRecord,
  getCharacterRecord,
  applyCharacterToSession,
  activateShipForSession,
  syncInventoryItemForSession,
  syncShipFittingStateForSession,
} = require("../character/characterState");
const sessionRegistry = require("./sessionRegistry");
const { isLocalChatRoomName } = require("./channelRules");
const {
  getAllItems,
  getCharacterHangarShipItems,
  ITEM_FLAGS,
  CLIENT_INVENTORY_STACK_LIMIT,
  listContainerItems,
  listOwnedItems,
  createSpaceItemForCharacter,
  grantItemsToCharacterStationHangar,
  moveItemTypeFromCharacterLocation,
  normalizeShipConditionState,
  removeInventoryItem,
  updateInventoryItem,
  updateShipItem,
} = require("../inventory/itemStore");
const {
  resolveDebrisType,
  listAvailableDebrisTypes,
  spawnDebrisFieldForSession,
  clearNearbyDebrisForSession,
  clearSystemDebrisForSession,
  getSpaceDebrisLifetimeMs,
} = require("../inventory/spaceDebrisState");
const {
  getCharacterWallet,
  setCharacterBalance,
  adjustCharacterBalance,
  emitPlexBalanceChangeToSession,
  setCharacterPlexBalance,
  adjustCharacterPlexBalance,
} = require("../account/walletState");
const {
  EVERMARK_ISSUER_CORP_ID,
  adjustCharacterWalletLPBalance,
  adjustCorporationWalletLPBalance,
  getCharacterWalletLPBalance,
  getCorporationWalletLPBalance,
  setCharacterWalletLPBalance,
  setCorporationWalletLPBalance,
} = require("../corporation/lpWalletState");
const {
  COSMETIC_TYPE_ALLIANCE_LOGO,
  COSMETIC_TYPE_CORPORATION_LOGO,
  SHIP_LOGO_ENTITLEMENT_ALLIANCE,
  SHIP_LOGO_ENTITLEMENT_CORPORATION,
} = require("../evermarks/evermarksConstants");
const {
  getLicenseByShipAndCosmeticType,
} = require("../evermarks/evermarksCatalog");
const {
  grantShipLogoEntitlement,
} = require("../evermarks/evermarksEntitlements");
const {
  publishShipLogoGrantedNotice,
} = require("../evermarks/evermarksNotices");
const {
  PLEX_LOG_CATEGORY,
} = require("../account/plexVaultLogState");
const {
  getUnpublishedShipTypes,
  resolveShipByName,
  resolveShipByTypeID,
} = require("./shipTypeRegistry");
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require("../inventory/itemTypeRegistry");
const {
  resolveRuntimeWreckRadius,
} = require("../inventory/wreckRadius");
const { resolveSolarSystemByName } = require("./solarSystemRegistry");
const {
  buildShipResourceState,
  getTypeAttributeValue,
  isChargeCompatibleWithModule,
  isFittedModuleItem,
  listFittedItems,
  normalizeModuleState,
  selectAutoFitFlagForType,
  typeHasEffectName,
  validateFitForShip,
} = require("../fitting/liveFittingState");
const {
  clearCharacterSkills,
  ensureCharacterPublishedSkills,
  ensureCharacterUnpublishedSkills,
  grantCharacterSkillLevels,
  getCharacterSkillMap,
  getPublishedSkillTypes,
  getSkillTypes,
  getUnpublishedSkillTypes,
  removeCharacterSkillTypes,
} = require("../skills/skillState");
const {
  reconcileQueueForSkillMutation,
  resetCharacterSkillsToStarterProfile,
} = require("../skills/skillAdminRuntime");
const {
  emitSkillSessionState,
} = require("../skills/training/skillQueueNotifications");
const {
  getQueueSnapshot,
} = require("../skills/training/skillQueueRuntime");
const {
  getExpertSystemByTypeID,
  listExpertSystems,
  resolveExpertSystemQuery: resolveExpertSystemCatalogQuery,
} = require("../skills/expertSystems/expertSystemCatalog");
const {
  clearExpertSystemsForCharacter,
  consumeExpertSystemItem,
  getExpertSystemStatus,
  installExpertSystemForCharacter,
  removeExpertSystemFromCharacter,
} = require("../skills/expertSystems/expertSystemRuntime");
const {
  createCustomAllianceForCorporation,
  createCustomCorporation,
  findCorporationByName,
  getOwnerLookupRecord,
  joinCorporationToAllianceByName,
  getCorporationRecord,
} = require("../corporation/corporationState");
const {
  jumpSessionToSolarSystem,
  jumpSessionToStation,
} = require("../../space/transitions");
const {
  destroySessionShip,
  spawnShipDeathTestField,
} = require("../../space/shipDestruction");
const worldData = require("../../space/worldData");
const spaceRuntime = require("../../space/runtime");
const {
  TIDI_ADVANCE_NOTICE_MS,
  scheduleAdvanceNoticeTimeDilationForSystems,
} = require("../../utils/synchronizedTimeDilation");
const tidiAutoscaler = require("../../utils/tidiAutoscaler");
const database = require("../../newDatabase");
const {
  buildEffectListText,
  playPlayableEffect,
  stopAllPlayableEffects,
} = require("./specialFxRegistry");
const npcService = require("../../space/npc");
const {
  CAPITAL_NPC_CHAT_COMMANDS,
  CAPITAL_NPC_HELP_LINES,
  executeCapitalNpcCommand,
} = require("./capitalNpc");
const {
  WORMHOLE_CHAT_COMMANDS,
  WORMHOLE_HELP_LINES,
  executeWormholeCommand,
} = require("./wormhole");
const {
  TRIG_DRIFTER_CHAT_COMMANDS,
  TRIG_DRIFTER_HELP_LINES,
  executeTrigDrifterCommand,
} = require("./trigDrifter");
const {
  GATE_SKIN_CHAT_COMMANDS,
  GATE_SKIN_HELP_LINES,
  executeGateSkinCommand,
} = require("../../space/gateSkinCommand");
const {
  handleShipDirtCommand,
  handleShipKillmarksCommand,
} = require("../ship/shipAppearanceGmCommands");
const {
  NPCTEST_DEFAULT_AMOUNT,
  spawnNpcTestForSession,
} = require("../../space/npc/npcTestService");
const {
  ONE_AU_IN_METERS,
  findSafeWarpOriginAnchor,
} = require("../../space/npc/npcWarpOrigins");
const crimewatchState = require("../security/crimewatchState");
const {
  TABLE,
  readStaticRows,
} = require("../_shared/referenceData");
const {
  CHAT_ROLE_PROFILES,
  DEFAULT_CHAT_COLOR,
  DEFAULT_CHAT_ROLE,
  MAX_ACCOUNT_ROLE,
  buildPersistedAccountRoleRecord,
  composeSessionRoleMask,
  getChatRoleProfile,
  normalizeRoleValue,
  roleToString,
} = require("../account/accountRoleProfiles");
const {
  getDockedLocationID,
  getDockedLocationKind,
  isDockedSession,
} = require(path.join(__dirname, "../structure/structureLocation"));
const {
  executeUpwellCommand,
} = require(path.join(__dirname, "../structure/structureChatCommands"));
const {
  buildStructureDeathTestUsage,
  parseStructureDeathTestArgs,
  spawnStructureDeathTestField,
} = require(path.join(__dirname, "../structure/structureDeathTestRuntime"));
const {
  executeUpwellAutoCommand,
} = require(path.join(__dirname, "../structure/structureAutoCommands"));
const structureLog = require(path.join(__dirname, "../structure/structureLog"));
const {
  executeSovCommand,
} = require(path.join(__dirname, "../sovereignty/sovChatCommands"));
const {
  executeSovAutoCommand,
} = require(path.join(__dirname, "../sovereignty/sovAutoCommands"));
const sovLog = require(path.join(__dirname, "../sovereignty/sovLog"));
const {
  handleSuperTitanCommand: executeSuperTitanCommand,
  handleSuperTitanShowCommand: executeSuperTitanShowCommand,
} = require(path.join(__dirname, "../superweapons/superweaponCommands"));
const {
  handleMinerCommand: executeMinerCommand,
  handleMiningFleetCommand: executeMiningFleetCommand,
  handleMiningFleetAggroCommand: executeMiningFleetAggroCommand,
  handleMiningFleetClearCommand: executeMiningFleetClearCommand,
  handleMiningFleetStatusCommand: executeMiningFleetStatusCommand,
  handleMiningFleetRetreatCommand: executeMiningFleetRetreatCommand,
  handleMiningFleetResumeCommand: executeMiningFleetResumeCommand,
  handleMiningFleetHaulCommand: executeMiningFleetHaulCommand,
  handleMiningStateStatusCommand: executeMiningStateStatusCommand,
  handleMiningStateResetCommand: executeMiningStateResetCommand,
} = require(path.join(__dirname, "../mining/miningCommandService"));
const {
  handleOrcaCommand: executeOrcaCommand,
  handleProbeCommand: executeProbeCommand,
  handleProbe2Command: executeProbe2Command,
  handleCburstCommand: executeCburstCommand,
  handleGuardianCommand: executeGuardianCommand,
  handleBasiliskCommand: executeBasiliskCommand,
  handleEwarCommand: executeEwarCommand,
  handleTrigCommand: executeTrigCommand,
} = require(path.join(__dirname, "../ship/devCommandShipRuntime"));
const ScanMgrService = require(path.join(
  __dirname,
  "../exploration/scanMgrService",
));
const signatureRuntime = require(path.join(
  __dirname,
  "../exploration/signatures/signatureRuntime",
));
const {
  markMissionObjectiveComplete,
} = require(path.join(__dirname, "../agent/agentMissionRuntime"));
const {
  listAgents,
} = require(path.join(__dirname, "../agent/agentAuthority"));
const standingRuntime = require(path.join(
  __dirname,
  "../character/standingRuntime",
));
const {
  handleRemoteRepairFleetCommand: executeRemoteRepairFleetCommand,
} = require(path.join(__dirname, "../../RemoteRepShow/remoteRepairFleetCommands"));
const {
  executeBlueprintAutoCommand,
  executeBlueprintCommand,
} = require(path.join(__dirname, "../industry/industryChatCommands"));
const {
  executeBookmarkAutoCommand,
} = require(path.join(__dirname, "../bookmark/bookmarkChatCommands"));
const {
  executeCalendarAutoCommand,
} = require(path.join(__dirname, "../calendar/calendarChatCommands"));
const {
  executeReprocessingSmokeCommand,
} = require(path.join(__dirname, "../reprocessing/reprocessingChatCommands"));
const {
  resolveWelcomeSenderID,
  sendMail,
} = require(path.join(__dirname, "../mail/mailState"));

const DEFAULT_MOTD_MESSAGE = [
  "<b><color=0xfff4d35e>Welcome to EveJS Elysian.</color></b><br>",
  "A lot already works, but you <color=0xffff8080>will</color> still find bugs.<br><br>",
  "<b><color=0xff80d8ff>@Icey</color></b> founded this project. Without him, none of this exists.<br><br>",
  "<b><color=0xffffc266>@John Elysian</color></b> is the reason you can undock, warp, fire missiles, use the market, experience time dilation, and touch a long list of other core systems. A lot of this took weeks of 24/7 work to get running against the latest client, and some of it simply had not been done properly before.<br><br>",
  "Big respect as well to <b><color=0xffd7bde2>EvE-MU</color></b> for proving this path was possible long before AI tools existed.<br><br>",
  "<b><color=0xff9be564>@Deer_Hunter</color></b> helped keep development alive when the costs were make-or-break. Thank you.<br><br>",
  "<color=0xffff8080>If you hit a bug, please report it in the Discord linked on the EveJS Elysian GitHub and include exact steps to reproduce it.</color>",
].join(" ");
const DEER_HUNTER_MESSAGE =
  "Thank you, Deer_Hunter on Discord, for helping make EveJS Elysian possible with your contribution to rising AI development costs.";
const DEER_HUNTER_EFFECT_NAME = "microjump";
const AVAILABLE_SLASH_COMMANDS = [
  "addisk",
  "addevermarks",
  "addcorpevermarks",
  "announce",
  "addplex",
  "allskills",
  "corpcreate",
  "blue",
  "commandlist",
  "commands",
  "deer_hunter",
  "expertsystem",
  "expertsystems",
  "giveme",
  "giveskill",
  "grantshipemblem",
  "grantcorplogo",
  "grantalliancelogo",
  "hangar",
  "dmg",
  "heal",
  "help",
  "item",
  "iteminfo",
  "killmark",
  "killmarks",
  "keepstar",
  "upwell",
  "upwellauto",
  "bpauto",
  "bp",
  "bookmarkauto",
  "calauto",
  "reprocesssmoke",
  "laser",
  "lasers",
  "hybrids",
  "railgun",
  "projectiles",
  "removeskill",
  "autocannon",
  "rocket",
  "light",
  "heavy",
  "torp",
  "lesmis",
  "miner",
  "orca",
  "probe",
  "probe2",
  "trig",
  "setstanding",
  "maxagentstandings",
  "fullstandings",
  "sigs",
  "sigscan",
  "missioncomplete",
  "overlayrefresh",
  "cburst",
  "guardian",
  "basilisk",
  "ewar",
  "backintime",
  "dock",
  "dirt",
  "effect",
  "fire",
  "fire2",
  "rr",
  "supertitan",
  "supertitanshow",
  "titansupershow",
  "giveitem",
  "create",
  "createitem",
  "minerals",
  "gmweapons",
  "gmships",
  "gmskills",
  "container",
  "jetcan",
  "motd",
  "mailme",
  "npc",
  "mnpc",
  "npctest",
  "npctest2",
  "npcminer",
  "npcmineraggro",
  "npcminerpanic",
  "npcminerretreat",
  "npcminerresume",
  "npcminerhaul",
  "npcminerclear",
  "npcminerstatus",
  "miningreset",
  "miningstatus",
  "npcclear",
  "joinalliance",
  "loadallsys",
  "loadsys",
  "solar",
  "tele",
  "tr",
  "prop",
  "npcw",
  "wnpc",
  "spawncontainer",
  "spawnwreck",
  "session",
  "setalliance",
  "sov",
  "sovauto",
  "autosov",
  "setplex",
  "setevermarks",
  "setcorpevermarks",
  "setisk",
  "ship",
  "suicide",
  "sysjunkclear",
  "testclear",
  "teal",
  "tidi",
  "deathtest",
  "deathstructure",
  "deadwarp",
  "typeinfo",
  "wallet",
  "evermarks",
  "corpevermarks",
  "where",
  "who",
  ...CAPITAL_NPC_CHAT_COMMANDS,
  ...WORMHOLE_CHAT_COMMANDS,
  ...TRIG_DRIFTER_CHAT_COMMANDS,
  ...GATE_SKIN_CHAT_COMMANDS,
  "wreck",
  "concord",
  "cwatch",
  "naughty",
  "gateconcord",
  "gaterats",
  "invu",
  "secstatus",
  "yellow",
  "red",
];
const COMMANDS_HELP_TEXT = [
  "Commands:",
  "/help",
  "/motd",
  "/mailme",
  "/allskills",
  "/npc [amount] [faction|profile|pool]",
  "/mnpc [amount] [faction|profile|pool]",
  ...CAPITAL_NPC_HELP_LINES,
  ...WORMHOLE_HELP_LINES,
  ...TRIG_DRIFTER_HELP_LINES,
  ...GATE_SKIN_HELP_LINES,
  "/npcminer [amount] [profile|pool|group]",
  "/npcmineraggro [amount] [profile|pool|group]",
  "/npcminerpanic [amount] [profile|pool|group]",
  "/npcminerretreat",
  "/npcminerresume",
  "/npcminerhaul",
  "/npcminerclear",
  "/npcminerstatus",
  "/miningreset",
  "/miningstatus",
  "/npcw [amount] [profile|pool]",
  "/npcclear <system [npc|concord|all]|radius <meters> [npc|concord|all]>",
  "/dock",
  "/dirt <0.0-1.0> [shipID]",
  "/dmg [light|medium|heavy]",
  "/killmarks <count> [shipID]",
  "/heal",
  "/deer_hunter",
  "/effect <name>",
  "/keepstar",
  "/upwell <subcommand>",
  "/upwellauto <type|structureID>",
  "/upwellauto undock <structureID> [count] [all|unpublished|published]",
  "/bpauto <subcommand>",
  "/bp <subcommand>",
  "/bookmarkauto <subcommand>",
  "/calauto <subcommand>",
  "/reprocesssmoke <subcommand>",
  "/backintime [me|characterID|character name]",
  "/expertsystem <list|inspect|status|add|remove|clear|giveitem|consume>",
  "/sov <subcommand>",
  "/sovauto <subcommand>",
  "/fire [ship name|typeID]",
  "/fire2 [count]",
  "/supertitan",
  "/supertitanshow [count]",
  "/titansupershow [count]",
  "/giveitem <item name|typeID> [amount]",
  "/create <item name|typeID> [amount]",
  "/createitem <item name|typeID> [amount]",
  "/minerals",
  "/giveskill <target> <skill|all|super> [level]",
  "/removeskill <target> <skill|all>",
  "/laser",
  "/lasers",
  "/hybrids",
  "/railgun",
  "/projectiles",
  "/autocannon",
  "/rocket",
  "/light",
  "/heavy",
  "/torp",
  "/lesmis",
  "/miner",
  "/orca",
  "/probe",
  "/probe2",
  "/trig [hull|family]",
  "/setstanding <value> <owner name|id> [target]",
  "/maxagentstandings [target]",
  "/fullstandings [target]",
  "/sigs",
  "/sigscan",
  "/missioncomplete [agentID|all]",
  "/overlayrefresh",
  "/cburst",
  "/guardian",
  "/basilisk",
  "/ewar",
  "/gmweapons",
  "/container [container type] [count]",
  "/jetcan <item name|typeID> [amount]",
  "/gmships",
  "/gmskills",
  "/where",
  "/who",
  "/concord [amount] [profile|pool]",
  "/cwatch [status|clear|safety <full|partial|none>|weapon <off|seconds>|pvp <off|seconds>|npc <off|seconds>|criminal <off|seconds>|suspect <off|seconds>|disapproval <off|seconds>]",
  "/naughty",
  "/secstatus [status]",
  "/gateconcord [on|off]",
  "/gaterats [on|off]",
  "/invu [on|off]",
  "/wallet",
  "/evermarks",
  "/grantshipemblem <corp|alliance|both> [current|ship name|typeID]",
  "/grantcorplogo [current|ship name|typeID]",
  "/grantalliancelogo [current|ship name|typeID]",
  "/corpcreate <corporation name>",
  "/setalliance <alliance name>",
  "/joinalliance <alliance name>",
  "/loadallsys",
  "/loadsys",
  "/tidi [0.1-1.0]",
  "/prop",
  "/solar <system name>",
  "/tele <character name|characterID>",
  "/tr <me|characterID|entityID> <destination|pos=x,y,z|offset=x,y,z>",
  "/suicide",
  "/sysjunkclear",
  "/wreck [wreck type] [count]",
  "/deathtest [ship name|typeID] [count]",
  "/deathstructure <sovhub|skyhook|bloodraiderfob|guristasfob|angelfob|mercden|vigilance|dreamer|astrahus|typeID> [count] [delaySeconds]",
  "/deadwarp",
  "/testclear",
  "/addisk <amount>",
  "/addevermarks <amount>",
  "/addcorpevermarks <amount>",
  "/addplex <amount>",
  "/blue",
  "/setisk <amount>",
  "/setevermarks <amount>",
  "/setcorpevermarks <amount>",
  "/setplex <amount>",
  "/corpevermarks",
  "/red",
  "/ship <ship name|typeID>",
  "/giveme <ship name|typeID>",
  "/hangar",
  "/item <item name|typeID> [amount]",
  "/iteminfo <itemID>",
  "/typeinfo <ship name|typeID>",
  "/session",
  "/announce <message>",
  "/teal",
  "/yellow",
].join("\n");

const DAMAGE_TEST_PRESETS = Object.freeze({
  light: {
    label: "light",
    ship: {
      damage: 0.1,
      charge: 0.65,
      armorDamage: 0.18,
      shieldCharge: 0.7,
    },
    module: {
      damage: 0.08,
      charge: 0,
      armorDamage: 0.04,
      shieldCharge: 0.8,
      incapacitated: false,
    },
  },
  medium: {
    label: "medium",
    ship: {
      damage: 0.2,
      charge: 0.35,
      armorDamage: 0.35,
      shieldCharge: 0.45,
    },
    module: {
      damage: 0.18,
      charge: 0,
      armorDamage: 0.1,
      shieldCharge: 0.6,
      incapacitated: false,
    },
  },
  heavy: {
    label: "heavy",
    ship: {
      damage: 0.35,
      charge: 0.18,
      armorDamage: 0.6,
      shieldCharge: 0.22,
    },
    module: {
      damage: 0.3,
      charge: 0,
      armorDamage: 0.18,
      shieldCharge: 0.42,
      incapacitated: false,
    },
  },
});
const DEFAULT_SPACE_CONTAINER_NAME = "Cargo Container";
const DEFAULT_SPACE_WRECK_NAME = "Wreck";
const DEFAULT_FIRE_TARGET_NAME = "Drake";
const COMBAT_DUMMY_OWNER_ID = 1000006;
const COMBAT_DUMMY_CORPORATION_ID = 1000006;
const PALATINE_KEEPSTAR_TYPE_ID = 40340;
const KEEPSTAR_DEFAULT_SPAWN_DISTANCE_METERS = 400000;
const KEEPSTAR_DEFAULT_RADIUS_METERS = 150000;
const LASER_COMMAND_SHIP_NAME = "Apocalypse Navy Issue";
const LASER_COMMAND_TURRET_NAME = "Dual Heavy Beam Laser II";
const LASER_COMMAND_TURRET_COUNT = 8;
const LASER_COMMAND_MWD_NAME = "500MN Microwarpdrive II";
const LASER_COMMAND_MIN_CRYSTALS_PER_TYPE = 5;
const HYBRIDS_COMMAND_SHIP_NAME = "Rokh";
const HYBRIDS_COMMAND_TURRET_NAME = "425mm Railgun II";
const HYBRIDS_COMMAND_TURRET_COUNT = 8;
const HYBRIDS_COMMAND_CHARGES_PER_TYPE = 500;
const PROJECTILES_COMMAND_SHIP_NAME = "Maelstrom";
const PROJECTILES_COMMAND_TURRET_NAME = "1400mm Howitzer Artillery II";
const PROJECTILES_COMMAND_TURRET_COUNT = 6;
const PROJECTILES_COMMAND_CHARGES_PER_TYPE = 500;
const AUTOCANNON_COMMAND_SHIP_NAME = "Tempest Fleet Issue";
const AUTOCANNON_COMMAND_TURRET_NAME = "800mm Repeating Cannon II";
const AUTOCANNON_COMMAND_TURRET_COUNT = 6;
const AUTOCANNON_COMMAND_CHARGES_PER_TYPE = 500;
const ROCKET_COMMAND_SHIP_NAME = "Kestrel";
const ROCKET_COMMAND_LAUNCHER_NAME = "Rocket Launcher II";
const ROCKET_COMMAND_LAUNCHER_COUNT = 4;
const ROCKET_COMMAND_MWD_NAME = "5MN Microwarpdrive II";
const ROCKET_COMMAND_MISSILES_PER_TYPE = 1000;
const LIGHT_COMMAND_SHIP_NAME = "Corax";
const LIGHT_COMMAND_LAUNCHER_NAME = "Light Missile Launcher II";
const LIGHT_COMMAND_LAUNCHER_COUNT = 7;
const LIGHT_COMMAND_MWD_NAME = "5MN Microwarpdrive II";
const LIGHT_COMMAND_MISSILES_PER_TYPE = 900;
const HEAVY_COMMAND_SHIP_NAME = "Drake";
const HEAVY_COMMAND_LAUNCHER_NAME = "Heavy Missile Launcher II";
const HEAVY_COMMAND_LAUNCHER_COUNT = 6;
const HEAVY_COMMAND_MWD_NAME = "50MN Microwarpdrive II";
const HEAVY_COMMAND_MISSILES_PER_TYPE = 450;
const TORP_COMMAND_SHIP_NAME = "Raven Navy Issue";
const TORP_COMMAND_LAUNCHER_NAME = "Torpedo Launcher II";
const TORP_COMMAND_LAUNCHER_COUNT = 7;
const TORP_COMMAND_MWD_NAME = "500MN Microwarpdrive II";
const TORP_COMMAND_MISSILES_PER_TYPE = 650;
const LESMIS_COMMAND_SHIP_NAME = "Typhoon Fleet Issue";
const LESMIS_COMMAND_LAUNCHER_NAME = "Heavy Missile Launcher II";
const LESMIS_COMMAND_TURRET_NAME = "Mega Pulse Laser II";
const LESMIS_COMMAND_LAUNCHER_COUNT = 4;
const LESMIS_COMMAND_TURRET_COUNT = 4;
const LESMIS_COMMAND_MISSILES_PER_TYPE = 1000;
const DEFAULT_FIRE2_FLEET_SIZE = 10;
const MAX_NPC_COMMAND_SPAWN_COUNT = 50;
const MAX_NPC_WARP_COMMAND_SPAWN_COUNT = 25;
const MAX_CONCORD_COMMAND_SPAWN_COUNT = 25;
const DEFAULT_FIRE2_FLEET_SHIP_NAMES = Object.freeze([
  "Avatar",
  "Revelation",
  "Rorqual",
  "Orca",
  "Abaddon",
  "Harbinger",
  "Maller",
  "Coercer",
  "Punisher",
  "Executioner",
]);
const FIRE2_BASE_DISTANCE_METERS = 32_000;
const FIRE2_ROW_SPACING_METERS = 11_000;
const FIRE2_LATERAL_SPACING_METERS = 8_000;
const FIRE2_OVERLAP_PADDING_METERS = 1_500;
// Runtime-only visual entities use a synthetic high itemID range so they never
// collide with inventory-backed rows and naturally disappear on restart.
let nextTransientVisualEntityID = 4000000000000000;
let nextCombatDummyEntityID = 3900000000000000;
// CCP parity: Jettisoned cargo containers persist for exactly 2 hours from
// creation regardless of contents.  They do NOT despawn when emptied -- the
// timer is purely time-based.  (Source: EVE University wiki, community-
// verified against live Tranquility behaviour.)
const JETCAN_LIFETIME_MS = 2 * 60 * 60 * 1000; // 2 hours
const PROPULSION_MODULE_GROUP_ID = 46;
const PROPULSION_MODULE_CATEGORY_ID = 7;
const PROPULSION_FACTION_PREFIXES = Object.freeze([
  "Domination",
  "Federation Navy",
  "Republic Fleet",
  "Shadow Serpentis",
  "True Sansha",
  "Thukker Modified",
]);
const PROPULSION_OFFICER_PREFIXES = Object.freeze([
  "Asine's",
  "Brynn's",
  "Cormack's",
  "Gara's",
  "Gotan's",
  "Hakim's",
  "Mizuro's",
  "Nija's",
  "Ramaku's",
  "Setele's",
  "Sila's",
  "Tobias'",
  "Tuvan's",
  "Usaras'",
]);
const SINGLE_RACK_COMMAND_PRESETS = Object.freeze({
  laser: Object.freeze({
    shipName: LASER_COMMAND_SHIP_NAME,
    propulsionName: LASER_COMMAND_MWD_NAME,
    moduleName: LASER_COMMAND_TURRET_NAME,
    moduleCount: LASER_COMMAND_TURRET_COUNT,
    chargeQuantity: LASER_COMMAND_MIN_CRYSTALS_PER_TYPE,
    moduleFailureLabel: "turret",
    chargeKindLabel: "compatible L crystal",
    totalChargeLabel: "crystals",
  }),
  hybrids: Object.freeze({
    shipName: HYBRIDS_COMMAND_SHIP_NAME,
    propulsionName: LASER_COMMAND_MWD_NAME,
    moduleName: HYBRIDS_COMMAND_TURRET_NAME,
    moduleCount: HYBRIDS_COMMAND_TURRET_COUNT,
    chargeQuantity: HYBRIDS_COMMAND_CHARGES_PER_TYPE,
    moduleFailureLabel: "turret",
    chargeKindLabel: "compatible L hybrid charge",
    totalChargeLabel: "rounds",
  }),
  projectiles: Object.freeze({
    shipName: PROJECTILES_COMMAND_SHIP_NAME,
    propulsionName: LASER_COMMAND_MWD_NAME,
    moduleName: PROJECTILES_COMMAND_TURRET_NAME,
    moduleCount: PROJECTILES_COMMAND_TURRET_COUNT,
    chargeQuantity: PROJECTILES_COMMAND_CHARGES_PER_TYPE,
    moduleFailureLabel: "turret",
    chargeKindLabel: "compatible L projectile charge",
    totalChargeLabel: "rounds",
  }),
  autocannon: Object.freeze({
    shipName: AUTOCANNON_COMMAND_SHIP_NAME,
    propulsionName: LASER_COMMAND_MWD_NAME,
    moduleName: AUTOCANNON_COMMAND_TURRET_NAME,
    moduleCount: AUTOCANNON_COMMAND_TURRET_COUNT,
    chargeQuantity: AUTOCANNON_COMMAND_CHARGES_PER_TYPE,
    moduleFailureLabel: "turret",
    chargeKindLabel: "compatible L projectile charge",
    totalChargeLabel: "rounds",
  }),
  rocket: Object.freeze({
    shipName: ROCKET_COMMAND_SHIP_NAME,
    propulsionName: ROCKET_COMMAND_MWD_NAME,
    moduleName: ROCKET_COMMAND_LAUNCHER_NAME,
    moduleCount: ROCKET_COMMAND_LAUNCHER_COUNT,
    chargeQuantity: ROCKET_COMMAND_MISSILES_PER_TYPE,
    moduleFailureLabel: "launcher",
    chargeKindLabel: "compatible rocket",
    totalChargeLabel: "rockets",
  }),
  light: Object.freeze({
    shipName: LIGHT_COMMAND_SHIP_NAME,
    propulsionName: LIGHT_COMMAND_MWD_NAME,
    moduleName: LIGHT_COMMAND_LAUNCHER_NAME,
    moduleCount: LIGHT_COMMAND_LAUNCHER_COUNT,
    chargeQuantity: LIGHT_COMMAND_MISSILES_PER_TYPE,
    moduleFailureLabel: "launcher",
    chargeKindLabel: "compatible light missile",
    totalChargeLabel: "missiles",
  }),
  heavy: Object.freeze({
    shipName: HEAVY_COMMAND_SHIP_NAME,
    propulsionName: HEAVY_COMMAND_MWD_NAME,
    moduleName: HEAVY_COMMAND_LAUNCHER_NAME,
    moduleCount: HEAVY_COMMAND_LAUNCHER_COUNT,
    chargeQuantity: HEAVY_COMMAND_MISSILES_PER_TYPE,
    moduleFailureLabel: "launcher",
    chargeKindLabel: "compatible heavy missile",
    totalChargeLabel: "missiles",
  }),
  torp: Object.freeze({
    shipName: TORP_COMMAND_SHIP_NAME,
    propulsionName: TORP_COMMAND_MWD_NAME,
    moduleName: TORP_COMMAND_LAUNCHER_NAME,
    moduleCount: TORP_COMMAND_LAUNCHER_COUNT,
    chargeQuantity: TORP_COMMAND_MISSILES_PER_TYPE,
    moduleFailureLabel: "launcher",
    chargeKindLabel: "compatible torpedo",
    totalChargeLabel: "torpedoes",
  }),
});

let cachedPropulsionCommandTypes = null;
let cachedLesmisHeavyMissileTypes = null;
let cachedGmWeaponsSeedPlan = null;
let cachedMineralsSeedPlan = null;
const activeGmWeaponsJobs = new Map();

const GM_WEAPONS_BATCH_SIZE = 96;
const GM_WEAPONS_MODULE_QUANTITY = 100;
const GM_WEAPONS_AMMO_QUANTITY = 5000;
const MINERALS_SEED_QUANTITY = 5_000_000;

function normalizeCommandName(value) {
  return String(value || "").trim().toLowerCase();
}

function levenshteinDistance(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a) {
    return b.length;
  }
  if (!b) {
    return a.length;
  }

  const previous = new Array(b.length + 1);
  const current = new Array(b.length + 1);
  for (let index = 0; index <= b.length; index += 1) {
    previous[index] = index;
  }

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

function suggestCommands(query) {
  const normalizedQuery = normalizeCommandName(query);
  if (!normalizedQuery) {
    return [];
  }

  return [...AVAILABLE_SLASH_COMMANDS]
    .map((commandName) => {
      let score = levenshteinDistance(normalizedQuery, commandName);
      if (commandName.startsWith(normalizedQuery)) {
        score = Math.min(score, 0);
      } else if (commandName.includes(normalizedQuery)) {
        score = Math.min(score, 1);
      }
      return { commandName, score };
    })
    .filter((entry) => entry.score <= Math.max(2, Math.ceil(entry.commandName.length * 0.35)))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      return left.commandName.localeCompare(right.commandName);
    })
    .slice(0, 5)
    .map((entry) => `/${entry.commandName}`);
}

function formatDistanceMeters(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "0 m";
  }
  if (numeric >= 1000) {
    return `${(numeric / 1000).toLocaleString("en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })} km`;
  }
  return `${Math.round(numeric).toLocaleString("en-US")} m`;
}

function formatIsk(value) {
  return `${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ISK`;
}

function formatPlex(value) {
  return `${Math.max(0, Math.trunc(Number(value || 0))).toLocaleString("en-US")} PLEX`;
}

function formatEvermarks(value) {
  return `${Math.max(0, Math.trunc(Number(value || 0))).toLocaleString("en-US")} EverMarks`;
}

function formatSignedEvermarks(value) {
  const numeric = Math.trunc(Number(value || 0));
  const prefix = numeric > 0 ? "+" : "";
  return `${prefix}${numeric.toLocaleString("en-US")} EverMarks`;
}

function formatSignedPlex(value) {
  const numeric = Math.trunc(Number(value || 0));
  const prefix = numeric > 0 ? "+" : "";
  return `${prefix}${numeric.toLocaleString("en-US")} PLEX`;
}

function parseAmount(value) {
  const text = String(value || "")
    .trim()
    .replace(/,/g, "")
    .replace(/_/g, "");
  if (!text) {
    return null;
  }

  const match = /^(-?\d+(?:\.\d+)?)([kmbt])?$/i.exec(text);
  if (!match) {
    return null;
  }

  const baseValue = Number(match[1]);
  if (!Number.isFinite(baseValue)) {
    return null;
  }

  const multiplier = {
    k: 1_000,
    m: 1_000_000,
    b: 1_000_000_000,
    t: 1_000_000_000_000,
  };
  const suffix = String(match[2] || "").toLowerCase();
  return baseValue * (multiplier[suffix] || 1);
}

function formatSuggestions(suggestions) {
  if (!suggestions || suggestions.length === 0) {
    return "";
  }

  return ` Suggestions: ${suggestions.join(", ")}`;
}

function getFeedbackChannel(options) {
  if (!options || typeof options !== "object") {
    return null;
  }

  const candidate =
    options.feedbackChannel || options.channelID || options.channelName || null;
  if (typeof candidate !== "string") {
    return null;
  }

  const trimmed = candidate.trim();
  return trimmed || null;
}

function isLocalFeedbackChannel(channelName) {
  if (!channelName) {
    return false;
  }

  return isLocalChatRoomName(channelName);
}

function getPostLocalMoveFeedbackOptions(options) {
  const feedbackChannel = getFeedbackChannel(options);
  if (!isLocalFeedbackChannel(feedbackChannel)) {
    return options;
  }

  return {
    ...options,
    feedbackChannel: null,
  };
}

function emitChatFeedback(chatHub, session, options, message) {
  if (!message) {
    return;
  }

  if (
    chatHub &&
    session &&
    (!options || options.emitChatFeedback !== false)
  ) {
    chatHub.sendSystemMessage(session, message, getFeedbackChannel(options));
  }
}

function handledResult(chatHub, session, options, message) {
  emitChatFeedback(chatHub, session, options, message);
  return {
    handled: true,
    message,
  };
}

function handledResultWithExtras(chatHub, session, options, message, extras = {}) {
  const result = handledResult(chatHub, session, options, message);
  return {
    ...result,
    ...extras,
  };
}

function splitTrailingAmount(argumentText) {
  const trimmed = String(argumentText || "").trim();
  if (!trimmed) {
    return {
      lookupText: "",
      amount: null,
    };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return {
      lookupText: trimmed,
      amount: null,
    };
  }

  const trailingAmount = parseAmount(parts[parts.length - 1]);
  if (trailingAmount === null) {
    return {
      lookupText: trimmed,
      amount: null,
    };
  }

  return {
    lookupText: parts.slice(0, -1).join(" ").trim(),
    amount: trailingAmount,
  };
}

function tokenizeQuotedArguments(argumentText) {
  const tokens = [];
  const expression =
    /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  const text = String(argumentText || "");
  let match = expression.exec(text);
  while (match) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    tokens.push(
      String(value)
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/\\\\/g, "\\"),
    );
    match = expression.exec(text);
  }

  return tokens;
}

function parseStrictInteger(value) {
  const text = String(value ?? "").trim();
  if (!/^-?\d+$/.test(text)) {
    return null;
  }

  const numeric = Number(text);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.trunc(numeric);
}

function clampSkillGrantLevel(value, fallback = 5) {
  const parsed = parseStrictInteger(value);
  const normalized = parsed === null ? fallback : parsed;
  return Math.max(0, Math.min(5, normalized));
}

function formatSkillLevelLabel(level) {
  const normalizedLevel = Math.max(0, Math.min(5, Number(level) || 0));
  const labels = ["0", "I", "II", "III", "IV", "V"];
  return labels[normalizedLevel] || String(normalizedLevel);
}

function readCharacterTable() {
  const result = database.read("characters", "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  return result.data;
}

function resolveCharacterTargetDescriptor(requestSession, targetToken) {
  const normalizedToken = String(targetToken || "").trim();
  if (!normalizedToken) {
    return {
      success: false,
      errorMsg: "TARGET_REQUIRED",
    };
  }

  if (normalizeCommandName(normalizedToken) === "me") {
    const characterID = normalizePositiveInteger(
      requestSession && requestSession.characterID,
    );
    if (!characterID) {
      return {
        success: false,
        errorMsg: "CHARACTER_NOT_SELECTED",
      };
    }

    const record = getCharacterRecord(characterID);
    if (!record) {
      return {
        success: false,
        errorMsg: "TARGET_NOT_FOUND",
      };
    }

    return {
      success: true,
      data: {
        characterID,
        record,
        session:
          sessionRegistry.findSessionByCharacterID(characterID) || requestSession || null,
      },
    };
  }

  const numericTargetID = normalizePositiveInteger(normalizedToken);
  if (numericTargetID) {
    const record = getCharacterRecord(numericTargetID);
    if (!record) {
      return {
        success: false,
        errorMsg: "TARGET_NOT_FOUND",
      };
    }

    return {
      success: true,
      data: {
        characterID: numericTargetID,
        record,
        session: sessionRegistry.findSessionByCharacterID(numericTargetID),
      },
    };
  }

  const normalizedName = normalizeCommandName(normalizedToken);
  const characters = readCharacterTable();
  const matchEntry = Object.entries(characters).find(([, record]) => (
    normalizeCommandName(record && record.characterName) === normalizedName
  ));

  if (!matchEntry) {
    return {
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
    };
  }

  const characterID = normalizePositiveInteger(matchEntry[0]);
  const record = characterID ? getCharacterRecord(characterID) : null;
  if (!characterID || !record) {
    return {
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
    };
  }

  return {
    success: true,
    data: {
      characterID,
      record,
      session: sessionRegistry.findSessionByCharacterID(characterID),
    },
  };
}

function formatCharacterTargetLabel(targetDescriptor) {
  if (!targetDescriptor) {
    return "character";
  }

  const characterID = normalizePositiveInteger(targetDescriptor.characterID);
  const name =
    (targetDescriptor.record && targetDescriptor.record.characterName) ||
    (targetDescriptor.session && targetDescriptor.session.characterName) ||
    null;
  if (name && characterID) {
    return `${name}(${characterID})`;
  }
  if (name) {
    return name;
  }
  if (characterID) {
    return `character ${characterID}`;
  }
  return "character";
}

function resolveDefaultCharacterTargetDescriptor(requestSession) {
  return resolveCharacterTargetDescriptor(requestSession, "me");
}

function resolveTrailingCharacterTargetDescriptor(requestSession, tokens = [], ownerStartIndex = 0) {
  const tokenList = Array.isArray(tokens) ? tokens : [];
  const ownerTokens = tokenList.slice(ownerStartIndex);
  if (ownerTokens.length >= 2) {
    const trailingToken = ownerTokens[ownerTokens.length - 1];
    const targetResult = resolveCharacterTargetDescriptor(requestSession, trailingToken);
    if (targetResult.success) {
      return {
        success: true,
        data: {
          ownerToken: ownerTokens.slice(0, -1).join(" ").trim(),
          targetDescriptor: targetResult.data,
          explicitTarget: true,
        },
      };
    }
  }

  const fallbackTarget = resolveDefaultCharacterTargetDescriptor(requestSession);
  if (!fallbackTarget.success) {
    return fallbackTarget;
  }

  return {
    success: true,
    data: {
      ownerToken: ownerTokens.join(" ").trim(),
      targetDescriptor: fallbackTarget.data,
      explicitTarget: false,
    },
  };
}

function resolveStandingOwnerDescriptor(ownerToken) {
  const normalizedToken = String(ownerToken || "").trim();
  if (!normalizedToken) {
    return {
      success: false,
      errorMsg: "OWNER_REQUIRED",
    };
  }

  const numericOwnerID = normalizePositiveInteger(normalizedToken);
  if (numericOwnerID) {
    const ownerRecord = getOwnerLookupRecord(numericOwnerID);
    if (ownerRecord) {
      return {
        success: true,
        data: {
          ownerID: numericOwnerID,
          ownerRecord,
          ownerKind: "owner",
        },
      };
    }
  }

  const normalizedName = normalizeCommandName(normalizedToken);
  const corporationRecord = findCorporationByName(normalizedToken);
  if (corporationRecord) {
    return {
      success: true,
      data: {
        ownerID: normalizePositiveInteger(corporationRecord.corporationID),
        ownerRecord: getOwnerLookupRecord(corporationRecord.corporationID),
        ownerKind: "corporation",
      },
    };
  }

  const factionRecord = standingRuntime.getFactionRecordsByName().get(normalizedName);
  if (factionRecord) {
    return {
      success: true,
      data: {
        ownerID: normalizePositiveInteger(factionRecord.factionID),
        ownerRecord: getOwnerLookupRecord(factionRecord.factionID),
        ownerKind: "faction",
      },
    };
  }

  const agentRecord = listAgents().find(
    (entry) => normalizeCommandName(entry && entry.ownerName) === normalizedName,
  );
  if (agentRecord) {
    return {
      success: true,
      data: {
        ownerID: normalizePositiveInteger(agentRecord.agentID),
        ownerRecord: getOwnerLookupRecord(agentRecord.agentID),
        ownerKind: "agent",
      },
    };
  }

  return {
    success: false,
    errorMsg: "OWNER_NOT_FOUND",
  };
}

function formatStandingOwnerLabel(ownerDescriptor) {
  if (!ownerDescriptor) {
    return "owner";
  }

  const ownerID = normalizePositiveInteger(ownerDescriptor.ownerID);
  const ownerName =
    (ownerDescriptor.ownerRecord && ownerDescriptor.ownerRecord.ownerName) ||
    null;
  if (ownerName && ownerID) {
    return `${ownerName}(${ownerID})`;
  }
  if (ownerName) {
    return ownerName;
  }
  if (ownerID) {
    return `owner ${ownerID}`;
  }
  return "owner";
}

function suggestSkillNames(skillTypes, query) {
  const normalizedQuery = normalizeCommandName(query);
  if (!normalizedQuery) {
    return [];
  }

  return (Array.isArray(skillTypes) ? skillTypes : [])
    .map((skillType) => {
      const name = String(skillType && skillType.name || "");
      const normalizedName = normalizeCommandName(name);
      let score = levenshteinDistance(normalizedQuery, normalizedName);
      if (normalizedName.startsWith(normalizedQuery)) {
        score = Math.min(score, 0);
      } else if (normalizedName.includes(normalizedQuery)) {
        score = Math.min(score, 1);
      }
      return {
        skillType,
        score,
      };
    })
    .filter((entry) => entry.skillType && entry.score <= 6)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      return String(left.skillType.name || "").localeCompare(
        String(right.skillType.name || ""),
      );
    })
    .slice(0, 5)
    .map((entry) => `${entry.skillType.name}(${entry.skillType.typeID})`);
}

function resolveSkillGrantDescriptor(skillToken) {
  const normalizedToken = String(skillToken || "").trim();
  const normalizedQuery = normalizeCommandName(normalizedToken);
  if (!normalizedQuery) {
    return {
      success: false,
      errorMsg: "SKILL_REQUIRED",
    };
  }

  if (normalizedQuery === "all") {
    return {
      success: true,
      data: {
        selector: "all",
      },
    };
  }

  if (normalizedQuery === "super") {
    return {
      success: true,
      data: {
        selector: "super",
      },
    };
  }

  const skillTypes = getSkillTypes({ refresh: true });
  const numericTypeID = normalizePositiveInteger(normalizedToken);
  if (numericTypeID) {
    const match = skillTypes.find(
      (skillType) => Number(skillType && skillType.typeID) === numericTypeID,
    );
    if (!match) {
      return {
        success: false,
        errorMsg: "SKILL_NOT_FOUND",
        suggestions: [],
      };
    }

    return {
      success: true,
      data: {
        selector: "single",
        skillType: match,
      },
    };
  }

  const exactMatches = skillTypes.filter((skillType) => (
    normalizeCommandName(skillType && skillType.name) === normalizedQuery
  ));
  if (exactMatches.length === 1) {
    return {
      success: true,
      data: {
        selector: "single",
        skillType: exactMatches[0],
      },
    };
  }

  if (exactMatches.length > 1) {
    return {
      success: false,
      errorMsg: "SKILL_AMBIGUOUS",
      suggestions: exactMatches
        .slice(0, 5)
        .map((skillType) => `${skillType.name}(${skillType.typeID})`),
    };
  }

  return {
    success: false,
    errorMsg: "SKILL_NOT_FOUND",
    suggestions: suggestSkillNames(skillTypes, normalizedToken),
  };
}

function parseGiveSkillArguments(argumentText) {
  const tokens = tokenizeQuotedArguments(argumentText);
  if (tokens.length < 2) {
    return {
      success: false,
      errorMsg: "USAGE",
    };
  }

  let level = 5;
  let requestedLevel = null;
  let skillTokens = tokens.slice(1);
  if (tokens.length >= 3) {
    const trailingLevel = parseStrictInteger(tokens[tokens.length - 1]);
    if (trailingLevel !== null) {
      requestedLevel = trailingLevel;
      level = clampSkillGrantLevel(trailingLevel, 5);
      skillTokens = tokens.slice(1, -1);
    }
  }

  const skillToken = skillTokens.join(" ").trim();
  if (!skillToken) {
    return {
      success: false,
      errorMsg: "USAGE",
    };
  }

  return {
    success: true,
    data: {
      targetToken: tokens[0],
      skillToken,
      level,
      requestedLevel,
    },
  };
}

function resolveSkillRemovalDescriptor(skillToken) {
  const normalizedToken = String(skillToken || "").trim();
  const normalizedQuery = normalizeCommandName(normalizedToken);
  if (!normalizedQuery) {
    return {
      success: false,
      errorMsg: "SKILL_REQUIRED",
    };
  }

  if (normalizedQuery === "all") {
    return {
      success: true,
      data: {
        selector: "all",
      },
    };
  }

  const skillTypes = getSkillTypes({ refresh: true });
  const numericTypeID = normalizePositiveInteger(normalizedToken);
  if (numericTypeID) {
    const match = skillTypes.find(
      (skillType) => Number(skillType && skillType.typeID) === numericTypeID,
    );
    if (!match) {
      return {
        success: false,
        errorMsg: "SKILL_NOT_FOUND",
        suggestions: [],
      };
    }

    return {
      success: true,
      data: {
        selector: "single",
        skillType: match,
      },
    };
  }

  const exactMatches = skillTypes.filter((skillType) => (
    normalizeCommandName(skillType && skillType.name) === normalizedQuery
  ));
  if (exactMatches.length === 1) {
    return {
      success: true,
      data: {
        selector: "single",
        skillType: exactMatches[0],
      },
    };
  }

  if (exactMatches.length > 1) {
    return {
      success: false,
      errorMsg: "SKILL_AMBIGUOUS",
      suggestions: exactMatches
        .slice(0, 5)
        .map((skillType) => `${skillType.name}(${skillType.typeID})`),
    };
  }

  return {
    success: false,
    errorMsg: "SKILL_NOT_FOUND",
    suggestions: suggestSkillNames(skillTypes, normalizedToken),
  };
}

function parseRemoveSkillArguments(argumentText) {
  const tokens = tokenizeQuotedArguments(argumentText);
  if (tokens.length < 2) {
    return {
      success: false,
      errorMsg: "USAGE",
    };
  }

  const skillToken = tokens.slice(1).join(" ").trim();
  if (!skillToken) {
    return {
      success: false,
      errorMsg: "USAGE",
    };
  }

  return {
    success: true,
    data: {
      targetToken: tokens[0],
      skillToken,
    },
  };
}

function parseBackInTimeArguments(argumentText) {
  const tokens = tokenizeQuotedArguments(argumentText);
  if (tokens.length === 0) {
    return {
      success: true,
      data: {
        targetToken: "me",
      },
    };
  }

  return {
    success: true,
    data: {
      targetToken: tokens.join(" ").trim() || "me",
    },
  };
}

function dedupeSkillRecords(skillRecords = []) {
  const recordsByTypeID = new Map();
  for (const skillRecord of Array.isArray(skillRecords) ? skillRecords : []) {
    const typeID = normalizePositiveInteger(skillRecord && skillRecord.typeID);
    if (!typeID) {
      continue;
    }
    recordsByTypeID.set(typeID, skillRecord);
  }

  return Array.from(recordsByTypeID.values());
}

function filterChangedSkillRecords(skillRecords = [], previousSkillMap = null) {
  const dedupedSkillRecords = dedupeSkillRecords(skillRecords);
  if (!(previousSkillMap instanceof Map)) {
    return dedupedSkillRecords;
  }

  return dedupedSkillRecords.filter((skillRecord) => {
    const typeID = normalizePositiveInteger(skillRecord && skillRecord.typeID);
    if (!typeID) {
      return false;
    }

    const previousSkillRecord = previousSkillMap.get(typeID) || null;
    return JSON.stringify(previousSkillRecord) !== JSON.stringify(skillRecord);
  });
}

function skillMutationLowersExistingLevels(skillRecords = [], previousSkillMap = null) {
  if (!(previousSkillMap instanceof Map)) {
    return false;
  }

  return dedupeSkillRecords(skillRecords).some((skillRecord) => {
    const typeID = normalizePositiveInteger(skillRecord && skillRecord.typeID);
    if (!typeID) {
      return false;
    }

    const previousSkillRecord = previousSkillMap.get(typeID);
    if (!previousSkillRecord) {
      return false;
    }

    const previousPoints = Number(
      previousSkillRecord.trainedSkillPoints ?? previousSkillRecord.skillPoints ?? 0,
    ) || 0;
    const nextPoints = Number(
      skillRecord.trainedSkillPoints ?? skillRecord.skillPoints ?? 0,
    ) || 0;
    if (nextPoints < previousPoints) {
      return true;
    }

    const previousLevel = Number(
      previousSkillRecord.trainedSkillLevel ?? previousSkillRecord.skillLevel ?? 0,
    ) || 0;
    const nextLevel = Number(
      skillRecord.trainedSkillLevel ?? skillRecord.skillLevel ?? 0,
    ) || 0;
    return nextLevel < previousLevel;
  });
}

function queueSnapshotChanged(previousSnapshot = null, nextSnapshot = null) {
  const previousActive = Boolean(previousSnapshot && previousSnapshot.active);
  const nextActive = Boolean(nextSnapshot && nextSnapshot.active);
  if (previousActive !== nextActive) {
    return true;
  }

  const previousEntries =
    previousSnapshot && Array.isArray(previousSnapshot.queueEntries)
      ? previousSnapshot.queueEntries
      : [];
  const nextEntries =
    nextSnapshot && Array.isArray(nextSnapshot.queueEntries)
      ? nextSnapshot.queueEntries
      : [];
  if (previousEntries.length !== nextEntries.length) {
    return true;
  }

  for (let index = 0; index < previousEntries.length; index += 1) {
    const previousEntry = previousEntries[index];
    const nextEntry = nextEntries[index];
    if (
      normalizePositiveInteger(previousEntry && previousEntry.trainingTypeID) !==
        normalizePositiveInteger(nextEntry && nextEntry.trainingTypeID) ||
      normalizePositiveInteger(previousEntry && previousEntry.trainingToLevel) !==
        normalizePositiveInteger(nextEntry && nextEntry.trainingToLevel)
    ) {
      return true;
    }
  }

  return false;
}

function normalizeSkillInventoryItem(skillRecord) {
  if (!skillRecord || typeof skillRecord !== "object") {
    return null;
  }

  return {
    ...skillRecord,
    quantity: 1,
    singleton: 1,
    stacksize: 1,
    customInfo: skillRecord.customInfo || "",
  };
}

function buildRemovedSkillNotificationRecord(skillRecord) {
  if (!skillRecord || typeof skillRecord !== "object") {
    return null;
  }

  return {
    ...skillRecord,
    locationID: 0,
    flagID: 0,
    skillLevel: 0,
    trainedSkillLevel: 0,
    effectiveSkillLevel: 0,
    virtualSkillLevel: null,
    skillPoints: 0,
    trainedSkillPoints: 0,
    inTraining: false,
    trainingStartSP: 0,
    trainingDestinationSP: 0,
    trainingStartTime: null,
    trainingEndTime: null,
  };
}

function buildRemovedSkillInventoryItem(skillRecord) {
  const normalizedSkillItem = normalizeSkillInventoryItem(skillRecord);
  if (!normalizedSkillItem) {
    return null;
  }

  return {
    ...normalizedSkillItem,
    locationID: 0,
    flagID: 0,
    quantity: 0,
    singleton: 0,
    stacksize: 0,
  };
}

function buildSkillNotificationInfo(skillRecord) {
  return {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: [
        ["itemID", skillRecord.itemID],
        ["typeID", skillRecord.typeID],
        ["ownerID", skillRecord.ownerID],
        ["locationID", skillRecord.locationID],
        ["flagID", skillRecord.flagID],
        ["groupID", skillRecord.groupID],
        ["groupName", skillRecord.groupName || ""],
        ["skillLevel", skillRecord.skillLevel],
        ["trainedSkillLevel", skillRecord.trainedSkillLevel],
        ["effectiveSkillLevel", skillRecord.effectiveSkillLevel],
        ["virtualSkillLevel", skillRecord.virtualSkillLevel ?? null],
        ["skillRank", skillRecord.skillRank || 1],
        ["skillPoints", skillRecord.skillPoints],
        [
          "trainedSkillPoints",
          skillRecord.trainedSkillPoints ?? skillRecord.skillPoints,
        ],
        ["published", Boolean(skillRecord.published)],
        ["inTraining", Boolean(skillRecord.inTraining)],
      ],
    },
  };
}

function buildSkillNotificationDict(skillRecords = []) {
  return {
    type: "dict",
    entries: dedupeSkillRecords(skillRecords)
      .map((skillRecord) => {
        const typeID = normalizePositiveInteger(skillRecord && skillRecord.typeID);
        if (!typeID) {
          return null;
        }
        return [typeID, buildSkillNotificationInfo(skillRecord)];
      })
      .filter(Boolean),
  };
}

function refreshLiveCharacterSkillSession(
  targetSession,
  targetDescriptor,
  changedSkillRecords = [],
  previousSkillMap = null,
  options = {},
) {
  const characterID = normalizePositiveInteger(targetDescriptor.characterID);
  if (!characterID) {
    return;
  }

  const changedSkills = dedupeSkillRecords(changedSkillRecords);
  const removedSkills = dedupeSkillRecords(options && options.removedSkillRecords);
  const queueSnapshot =
    options && options.queueSnapshot && typeof options.queueSnapshot === "object"
      ? options.queueSnapshot
      : null;
  const hasQueueState =
    queueSnapshot &&
    Array.isArray(queueSnapshot.queueEntries);
  const hasFreeSkillPoints =
    options &&
    Object.prototype.hasOwnProperty.call(options, "freeSkillPoints");
  if (
    changedSkills.length === 0 &&
    removedSkills.length === 0 &&
    !hasQueueState &&
    !hasFreeSkillPoints
  ) {
    return;
  }

  emitSkillSessionState(targetSession, characterID, changedSkills, {
    removedSkillRecords: removedSkills,
    previousSkillMap,
    emitSkillLevelsTrained:
      options && Object.prototype.hasOwnProperty.call(options, "emitSkillLevelsTrained")
        ? Boolean(options.emitSkillLevelsTrained)
        : !(options && options.removed === true),
    queueEntries: hasQueueState ? queueSnapshot.queueEntries : undefined,
    emitQueuePaused: Boolean(
      hasQueueState &&
      (!queueSnapshot.active || queueSnapshot.queueEntries.length === 0),
    ),
    freeSkillPoints: hasFreeSkillPoints ? options.freeSkillPoints : undefined,
  });
}

function applySkillGrantToCharacter(
  targetDescriptor,
  skillDescriptor,
  skillLevel,
  previousSkillMap = null,
) {
  const characterID = normalizePositiveInteger(
    targetDescriptor && targetDescriptor.characterID,
  );
  if (!characterID) {
    return {
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
    };
  }

  const normalizedLevel = clampSkillGrantLevel(skillLevel, 5);
  if (skillDescriptor.selector === "all") {
    const publishedSkillTypes = getPublishedSkillTypes({ refresh: true });
    return {
      success: true,
      data: {
        changedSkills: filterChangedSkillRecords(
          grantCharacterSkillLevels(
            characterID,
            publishedSkillTypes.map((skillType) => ({
              typeID: skillType.typeID,
              level: normalizedLevel,
            })),
          ),
          previousSkillMap,
        ),
      },
    };
  }

  if (skillDescriptor.selector === "super") {
    const targetSkillLevels = [
      ...getPublishedSkillTypes({ refresh: true }),
      ...getUnpublishedSkillTypes({ refresh: true }),
    ].map((skillType) => ({
      typeID: skillType.typeID,
      level: normalizedLevel,
    }));
    return {
      success: true,
      data: {
        changedSkills: filterChangedSkillRecords(
          grantCharacterSkillLevels(characterID, targetSkillLevels),
          previousSkillMap,
        ),
      },
    };
  }

  if (skillDescriptor.selector === "single" && skillDescriptor.skillType) {
    return {
      success: true,
      data: {
        changedSkills: filterChangedSkillRecords(
          grantCharacterSkillLevels(characterID, [
            {
              typeID: skillDescriptor.skillType.typeID,
              level: normalizedLevel,
            },
          ]),
          previousSkillMap,
        ),
      },
    };
  }

  return {
    success: false,
    errorMsg: "SKILL_NOT_FOUND",
  };
}

function applySkillRemovalToCharacter(targetDescriptor, skillDescriptor) {
  const characterID = normalizePositiveInteger(
    targetDescriptor && targetDescriptor.characterID,
  );
  if (!characterID) {
    return {
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
    };
  }

  if (skillDescriptor.selector === "all") {
    return {
      success: true,
      data: {
        changedSkills: clearCharacterSkills(characterID),
      },
    };
  }

  if (skillDescriptor.selector === "single" && skillDescriptor.skillType) {
    return {
      success: true,
      data: {
        changedSkills: removeCharacterSkillTypes(characterID, [
          skillDescriptor.skillType.typeID,
        ]),
      },
    };
  }

  return {
    success: false,
    errorMsg: "SKILL_NOT_FOUND",
  };
}

function flushPendingLocalChannelSync(chatHub, session) {
  if (
    !chatHub ||
    !session ||
    typeof chatHub.moveLocalSession !== "function"
  ) {
    return;
  }

  const pending = session._pendingLocalChannelSync || null;
  if (!pending) {
    return;
  }

  session._pendingLocalChannelSync = null;
  chatHub.moveLocalSession(session, pending.previousChannelID);
}

function normalizePositiveInteger(value) {
  const numeric = Number(value || 0);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

const SHIP_LOGO_GRANT_MODE_MAP = Object.freeze({
  corp: [SHIP_LOGO_ENTITLEMENT_CORPORATION],
  corporation: [SHIP_LOGO_ENTITLEMENT_CORPORATION],
  corplogo: [SHIP_LOGO_ENTITLEMENT_CORPORATION],
  alliance: [SHIP_LOGO_ENTITLEMENT_ALLIANCE],
  alliancelogo: [SHIP_LOGO_ENTITLEMENT_ALLIANCE],
  both: [
    SHIP_LOGO_ENTITLEMENT_CORPORATION,
    SHIP_LOGO_ENTITLEMENT_ALLIANCE,
  ],
  all: [
    SHIP_LOGO_ENTITLEMENT_CORPORATION,
    SHIP_LOGO_ENTITLEMENT_ALLIANCE,
  ],
});

function getShipLogoGrantTypeLabel(entitlementType) {
  if (entitlementType === SHIP_LOGO_ENTITLEMENT_ALLIANCE) {
    return "alliance";
  }
  return "corporation";
}

function formatShipLogoGrantTypeList(entitlementTypes = []) {
  const labels = [...new Set(entitlementTypes.map(getShipLogoGrantTypeLabel))];
  if (labels.length === 0) {
    return "ship emblem";
  }
  if (labels.length === 1) {
    return labels[0];
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function resolveShipLogoGrantTypes(command, tokens) {
  const normalizedCommand = normalizeCommandName(command);
  if (normalizedCommand === "grantcorplogo") {
    return {
      success: true,
      entitlementTypes: [SHIP_LOGO_ENTITLEMENT_CORPORATION],
      remainingTokens: tokens,
    };
  }
  if (normalizedCommand === "grantalliancelogo") {
    return {
      success: true,
      entitlementTypes: [SHIP_LOGO_ENTITLEMENT_ALLIANCE],
      remainingTokens: tokens,
    };
  }

  const modeToken = normalizeCommandName(tokens[0]);
  const entitlementTypes = SHIP_LOGO_GRANT_MODE_MAP[modeToken];
  if (!entitlementTypes) {
    return {
      success: false,
      errorMsg: "MODE_REQUIRED",
    };
  }

  return {
    success: true,
    entitlementTypes,
    remainingTokens: tokens.slice(1),
  };
}

function resolveShipLogoGrantTarget(session, lookupText) {
  const normalizedLookup = String(lookupText || "").trim();
  if (!normalizedLookup || ["active", "current", "me"].includes(normalizeCommandName(normalizedLookup))) {
    if (!session || !session.characterID) {
      return {
        success: false,
        errorMsg: "CHARACTER_NOT_SELECTED",
      };
    }

    const activeShip = getActiveShipRecord(session.characterID);
    const shipTypeID = normalizePositiveInteger(activeShip && activeShip.typeID);
    if (!shipTypeID) {
      return {
        success: false,
        errorMsg: "ACTIVE_SHIP_REQUIRED",
      };
    }

    const shipType = resolveShipByTypeID(shipTypeID);
    return {
      success: true,
      data: {
        shipTypeID,
        shipLabel:
          (shipType && shipType.name) ||
          String(activeShip.itemName || `typeID ${shipTypeID}`),
      },
    };
  }

  const numericTypeID = normalizePositiveInteger(normalizedLookup);
  if (numericTypeID) {
    const shipType = resolveShipByTypeID(numericTypeID);
    return {
      success: true,
      data: {
        shipTypeID: numericTypeID,
        shipLabel: (shipType && shipType.name) || `typeID ${numericTypeID}`,
      },
    };
  }

  const shipLookup = resolveShipByName(normalizedLookup);
  if (!shipLookup.success || !shipLookup.match) {
    return {
      success: false,
      errorMsg: shipLookup.errorMsg || "SHIP_NOT_FOUND",
      lookupText: normalizedLookup,
      suggestions: shipLookup.suggestions || [],
    };
  }

  return {
    success: true,
    data: {
      shipTypeID: shipLookup.match.typeID,
      shipLabel: shipLookup.match.name,
    },
  };
}

function handleGrantShipLogoCommand(command, session, argumentText, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before granting ship emblem licenses.",
    );
  }

  const usage =
    command === "grantshipemblem"
      ? "Usage: /grantshipemblem <corp|alliance|both> [current|ship name|typeID]"
      : `Usage: /${command} [current|ship name|typeID]`;

  const tokens = tokenizeQuotedArguments(argumentText);
  const modeResult = resolveShipLogoGrantTypes(command, tokens);
  if (!modeResult.success) {
    return handledResult(chatHub, session, options, usage);
  }

  const targetResult = resolveShipLogoGrantTarget(
    session,
    modeResult.remainingTokens.join(" "),
  );
  if (!targetResult.success) {
    if (targetResult.errorMsg === "ACTIVE_SHIP_REQUIRED") {
      return handledResult(
        chatHub,
        session,
        options,
        "No active ship was found. Pass a ship name or typeID, or board a ship first.",
      );
    }
    if (targetResult.errorMsg === "SHIP_NOT_FOUND") {
      return handledResult(
        chatHub,
        session,
        options,
        `Ship type not found: ${targetResult.lookupText}.${formatSuggestions(targetResult.suggestions)}`.trim(),
      );
    }
    if (targetResult.errorMsg === "AMBIGUOUS_SHIP_NAME") {
      return handledResult(
        chatHub,
        session,
        options,
        `Ship type is ambiguous: ${targetResult.lookupText}.${formatSuggestions(targetResult.suggestions)}`.trim(),
      );
    }
    return handledResult(chatHub, session, options, "Ship emblem license grant failed.");
  }

  const shipTypeID = targetResult.data.shipTypeID;
  const shipLabel = targetResult.data.shipLabel;
  const requestedEntitlementTypes = modeResult.entitlementTypes;
  const licenseEntries = requestedEntitlementTypes.map((entitlementType) => ({
    entitlementType,
    license: getLicenseByShipAndCosmeticType(
      shipTypeID,
      entitlementType === SHIP_LOGO_ENTITLEMENT_ALLIANCE
        ? COSMETIC_TYPE_ALLIANCE_LOGO
        : COSMETIC_TYPE_CORPORATION_LOGO,
    ),
  }));

  const missingLicenseEntry = licenseEntries.find((entry) => !entry.license);
  if (missingLicenseEntry) {
    return handledResult(
      chatHub,
      session,
      options,
      `No cached ${getShipLogoGrantTypeLabel(missingLicenseEntry.entitlementType)} emblem license exists for ${shipLabel} (shipTypeID=${shipTypeID}).`,
    );
  }

  const grantedEntries = [];
  const alreadyOwnedEntries = [];
  for (const entry of licenseEntries) {
    const grantResult = grantShipLogoEntitlement(
      session.characterID,
      shipTypeID,
      entry.entitlementType,
      {
        source: "admin_grant",
      },
    );
    if (!grantResult.success) {
      return handledResult(
        chatHub,
        session,
        options,
        "Ship emblem license grant failed.",
      );
    }

    if (grantResult.alreadyOwned) {
      alreadyOwnedEntries.push(entry);
      continue;
    }

    publishShipLogoGrantedNotice(grantResult.data);
    grantedEntries.push(entry);
  }

  const renderLicenseIDList = (entries) =>
    entries.map((entry) => entry.license.fsdTypeID).join(", ");
  const requestedLabel = formatShipLogoGrantTypeList(requestedEntitlementTypes);
  if (grantedEntries.length === 0) {
    const requestedPlural = requestedEntitlementTypes.length === 1 ? "is" : "are";
    return handledResult(
      chatHub,
      session,
      options,
      `${requestedLabel.charAt(0).toUpperCase()}${requestedLabel.slice(1)} emblem license${requestedEntitlementTypes.length === 1 ? "" : "s"} for ${shipLabel} ${requestedPlural} already owned.`,
    );
  }

  let message = `Granted ${formatShipLogoGrantTypeList(grantedEntries.map((entry) => entry.entitlementType))} emblem license${grantedEntries.length === 1 ? "" : "s"} for ${shipLabel} (shipTypeID=${shipTypeID}; licenseTypeID${grantedEntries.length === 1 ? "" : "s"}=${renderLicenseIDList(grantedEntries)}).`;
  if (alreadyOwnedEntries.length > 0) {
    message += ` Already owned: ${formatShipLogoGrantTypeList(alreadyOwnedEntries.map((entry) => entry.entitlementType))}.`;
  }

  return handledResult(chatHub, session, options, message);
}

function parseNpcSpawnArguments(argumentText, options = {}) {
  const defaultAmount = Math.max(
    1,
    Number.parseInt(options.defaultAmount, 10) || 1,
  );
  const trimmed = String(argumentText || "").trim();
  if (!trimmed) {
    return {
      success: true,
      amount: defaultAmount,
      query: "",
    };
  }

  const parts = trimmed.split(/\s+/);
  let amount = defaultAmount;
  let amountIndex = -1;
  for (let index = 0; index < parts.length; index += 1) {
    const parsed = parseAmount(parts[index]);
    if (parsed === null) {
      continue;
    }
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return {
        success: false,
        errorMsg: "INVALID_AMOUNT",
      };
    }
    amount = parsed;
    amountIndex = index;
    break;
  }

  const query = amountIndex >= 0
    ? parts.filter((_, index) => index !== amountIndex).join(" ").trim()
    : trimmed;
  return {
    success: true,
    amount,
    query,
  };
}

function readAccountsTable() {
  const result = database.read("accounts", "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  return result.data;
}

function writeAccountsTable(accounts) {
  return database.write("accounts", "/", accounts);
}

function getAccountRecordForSession(session) {
  if (!session) {
    return null;
  }

  const accounts = readAccountsTable();
  const userName = String(session.userName || "").trim();
  if (userName && accounts[userName]) {
    return {
      accounts,
      username: userName,
      account: accounts[userName],
    };
  }

  const matchedEntry = Object.entries(accounts).find(
    ([, account]) => Number(account && account.id) === Number(session.userid || 0),
  );
  if (!matchedEntry) {
    return null;
  }

  return {
    accounts,
    username: matchedEntry[0],
    account: matchedEntry[1],
  };
}

function persistSessionChatRole(session, roleValue) {
  const accountEntry = getAccountRecordForSession(session);
  if (!accountEntry) {
    return {
      success: false,
      errorMsg: "ACCOUNT_NOT_FOUND",
    };
  }

  const nextAccounts = { ...accountEntry.accounts };
  const normalizedAccount = buildPersistedAccountRoleRecord({
    ...accountEntry.account,
    role: roleToString(MAX_ACCOUNT_ROLE),
    chatRole: roleToString(roleValue),
  });
  nextAccounts[accountEntry.username] = normalizedAccount;
  const writeResult = writeAccountsTable(nextAccounts);
  if (!writeResult.success) {
    return {
      success: false,
      errorMsg: writeResult.errorMsg || "ACCOUNT_WRITE_FAILED",
    };
  }
  if (typeof database.flushAllSync === "function") {
    database.flushAllSync();
  }

  return {
    success: true,
    data: normalizedAccount,
  };
}

function getChatColorLabel(roleValue) {
  const normalizedRole = normalizeRoleValue(roleValue, DEFAULT_CHAT_ROLE);
  const match = Object.entries(CHAT_ROLE_PROFILES).find(
    ([, profileRole]) => normalizeRoleValue(profileRole, 0n) === normalizedRole,
  );
  return match ? match[0] : DEFAULT_CHAT_COLOR;
}

function updateSessionRole(session, nextRole) {
  if (!session) {
    return false;
  }

  const normalizedNextRole = normalizeRoleValue(nextRole, DEFAULT_CHAT_ROLE);
  const previousRole = composeSessionRoleMask(
    session.accountRole ?? session.role,
    session.chatRole ?? session.role,
  );
  const nextSessionRole = composeSessionRoleMask(
    session.accountRole ?? session.role,
    normalizedNextRole,
  );
  if (previousRole === nextSessionRole) {
    return false;
  }

  session.chatRole = roleToString(normalizedNextRole);
  session.role = roleToString(nextSessionRole);

  if (typeof session.sendSessionChange === "function") {
    session.sendSessionChange({
      role: [previousRole, nextSessionRole],
    });
  }

  return true;
}

function handleChatColorCommand(session, colorName, chatHub, options) {
  const nextRole = getChatRoleProfile(colorName);
  if (!nextRole) {
    return handledResult(
      chatHub,
      session,
      options,
      `Unknown chat color: ${colorName}. Use /blue, /red, /teal, or /yellow.`,
    );
  }

  const persisted = persistSessionChatRole(session, nextRole);
  if (!persisted.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Chat color change failed: account record could not be updated.",
    );
  }

  updateSessionRole(session, nextRole);
  return handledResultWithExtras(
    chatHub,
    session,
    options,
    `Chat color set to ${getChatColorLabel(nextRole)}.`,
    {
      refreshChatRolePresence: true,
    },
  );
}

function handleDeerHunterCommand(session, chatHub, options) {
  const effectResult = playPlayableEffect(session, DEER_HUNTER_EFFECT_NAME);
  const message = effectResult.success
    ? `${DEER_HUNTER_MESSAGE} Your ship celebrates with a brief micro-jump flash.`
    : DEER_HUNTER_MESSAGE;
  return handledResult(chatHub, session, options, message);
}

function handleMailMeCommand(session, argumentText, chatHub, options) {
  const characterID = normalizePositiveInteger(
    session && (session.characterID || session.charID || session.charid),
    0,
  );
  if (!characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /mailme.",
    );
  }

  const extraNote = String(argumentText || "").trim();
  const senderID = resolveWelcomeSenderID();
  const subject = "EveJS Elysian live mail test";
  const bodyLines = [
    "This is a live Eve Mail generated by /mailme.",
    "",
    "If this popped up and landed in your mailbox, the live notify path and the stored mailbox path are both working.",
  ];
  if (extraNote) {
    bodyLines.push("");
    bodyLines.push(`Note: ${extraNote}`);
  }
  bodyLines.push("");
  bodyLines.push(`Generated at: ${new Date().toISOString()}`);

  const sendResult = sendMail({
    senderID,
    toCharacterIDs: [characterID],
    title: subject,
    body: bodyLines.join("<br>"),
    saveSenderCopy: false,
    excludeSession: null,
  });
  if (!sendResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Test mail failed: ${sendResult.errorMsg || "unknown error"}.`,
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Live Eve Mail sent to your mailbox: "${subject}".`,
  );
}

function syncInventoryChangesToSession(session, changes = []) {
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }
    syncInventoryItemForSession(
      session,
      change.item,
      change.previousData || change.previousState || {},
      {
        emitCfgLocation: true,
      },
    );
  }
}

function syncSpaceRootInventoryChangesToSession(session, changes = []) {
  const numericSystemID = normalizePositiveInteger(
    session &&
      session._space &&
      session._space.systemID,
  );
  if (!numericSystemID) {
    return;
  }

  const filteredChanges = (Array.isArray(changes) ? changes : []).filter((change) => {
    const item = change && change.item;
    const previousData = change && (change.previousData || change.previousState);
    const nextLocationID = normalizePositiveInteger(item && item.locationID);
    const previousLocationID = normalizePositiveInteger(previousData && previousData.locationID);
    return (
      (nextLocationID === numericSystemID && Number(item && item.flagID) === 0) ||
      (previousLocationID === numericSystemID && Number(previousData && previousData.flagID) === 0)
    );
  });

  syncInventoryChangesToSession(session, filteredChanges);
}

function isSpaceSessionReady(session) {
  return Boolean(
    session &&
    session.characterID &&
    session._space &&
    !isDockedSession(session),
  );
}

function resolveSessionSolarSystemID(session) {
  return normalizePositiveInteger(
    session &&
      (
        (session._space && session._space.systemID) ||
        session.solarsystemid2 ||
        session.solarsystemid
      ),
    0,
  );
}

function resolveSessionShipEntity(session) {
  if (!session || !session._space || !session._space.shipID) {
    return null;
  }

  return spaceRuntime.getEntity(session, session._space.shipID) || null;
}

function healDockedShipForSession(session) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip || !activeShip.itemID) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const updateResult = updateShipItem(activeShip.itemID, (currentShip) => ({
    ...currentShip,
    conditionState: normalizeShipConditionState({
      ...(currentShip.conditionState || {}),
      damage: 0,
      charge: 1,
      armorDamage: 0,
      shieldCharge: 1,
    }),
  }));
  if (!updateResult.success) {
    return updateResult;
  }

  syncInventoryItemForSession(
    session,
    updateResult.data,
    updateResult.previousData || {},
    { emitCfgLocation: true },
  );

  return updateResult;
}

function formatCountLabel(count, singular, plural) {
  const numericCount = Number(count) || 0;
  return `${numericCount} ${numericCount === 1 ? singular : plural}`;
}

function resolveDamageTestPreset(argumentText) {
  const normalized = String(argumentText || "").trim().toLowerCase();
  if (!normalized) {
    return {
      success: true,
      preset: DAMAGE_TEST_PRESETS.medium,
    };
  }

  const preset = DAMAGE_TEST_PRESETS[normalized];
  if (!preset) {
    return {
      success: false,
      errorMsg: "INVALID_DAMAGE_PRESET",
    };
  }

  return {
    success: true,
    preset,
  };
}

function damageDockedShipForSession(session, preset) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  if (!isDockedSession(session)) {
    return {
      success: false,
      errorMsg: "NOT_DOCKED",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip || !activeShip.itemID) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const updateResult = updateShipItem(activeShip.itemID, (currentShip) => ({
    ...currentShip,
    conditionState: normalizeShipConditionState({
      ...(currentShip.conditionState || {}),
      ...((preset && preset.ship) || {}),
    }),
  }));
  if (!updateResult.success) {
    return updateResult;
  }

  const changedModuleIDs = [];
  const fittedModules = listFittedItems(
    session.characterID,
    activeShip.itemID,
  ).filter((item) => isFittedModuleItem(item));

  for (const fittedModule of fittedModules) {
    const moduleUpdateResult = updateInventoryItem(
      fittedModule.itemID,
      (currentItem) => ({
        ...currentItem,
        moduleState: normalizeModuleState({
          ...(currentItem.moduleState || {}),
          ...((preset && preset.module) || {}),
        }),
      }),
    );
    if (!moduleUpdateResult.success) {
      return moduleUpdateResult;
    }
    changedModuleIDs.push(fittedModule.itemID);
  }

  syncInventoryItemForSession(
    session,
    updateResult.data,
    updateResult.previousData || {},
    { emitCfgLocation: true },
  );

  if (changedModuleIDs.length > 0) {
    syncShipFittingStateForSession(session, activeShip.itemID, {
      includeOfflineModules: true,
      includeCharges: false,
      restrictToItemIDs: changedModuleIDs,
    });
  }

  return {
    success: true,
    data: {
      shipID: activeShip.itemID,
      presetLabel: String((preset && preset.label) || "medium"),
      moduleCount: changedModuleIDs.length,
    },
  };
}

function parseToggleCommandArgument(argumentText) {
  const normalized = String(argumentText || "").trim().toLowerCase();
  if (!normalized) {
    return {
      success: true,
      mode: "status",
    };
  }

  if (["on", "enable", "enabled", "true", "1"].includes(normalized)) {
    return {
      success: true,
      mode: "on",
    };
  }
  if (["off", "disable", "disabled", "false", "0"].includes(normalized)) {
    return {
      success: true,
      mode: "off",
    };
  }
  if (["status", "state"].includes(normalized)) {
    return {
      success: true,
      mode: "status",
    };
  }

  return {
    success: false,
    errorMsg: "INVALID_TOGGLE",
  };
}

function getCrimewatchReferenceMsForSession(session) {
  if (
    session &&
    session._space &&
    Number.isFinite(Number(session._space.simTimeMs))
  ) {
    return Number(session._space.simTimeMs);
  }

  return spaceRuntime.getSimulationTimeMsForSession(session, Date.now());
}

function formatDurationBriefMs(durationMs) {
  const remainingMs = Math.max(0, Math.trunc(Number(durationMs) || 0));
  if (remainingMs <= 0) {
    return "0s";
  }

  const totalSeconds = Math.ceil(remainingMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const leftoverMinutes = minutes % 60;
  if (leftoverMinutes > 0) {
    return `${hours}h ${leftoverMinutes}m`;
  }
  return `${hours}h`;
}

function formatCrimewatchSafetyLabel(safetyLevel) {
  switch (Number(safetyLevel)) {
    case crimewatchState.SAFETY_LEVEL_NONE:
      return "NONE";
    case crimewatchState.SAFETY_LEVEL_PARTIAL:
      return "PARTIAL";
    case crimewatchState.SAFETY_LEVEL_FULL:
    default:
      return "FULL";
  }
}

function parseCrimewatchDurationArgument(argumentText, defaultMs) {
  const normalized = String(argumentText || "").trim().toLowerCase();
  if (!normalized) {
    return {
      success: false,
      errorMsg: "USAGE",
    };
  }

  if (["on", "enable", "enabled", "true"].includes(normalized)) {
    return {
      success: true,
      durationMs: Math.max(0, Math.trunc(Number(defaultMs) || 0)),
    };
  }

  if (["off", "disable", "disabled", "false", "clear", "0"].includes(normalized)) {
    return {
      success: true,
      durationMs: 0,
    };
  }

  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i.exec(normalized);
  if (!match) {
    return {
      success: false,
      errorMsg: "INVALID_DURATION",
    };
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) {
    return {
      success: false,
      errorMsg: "INVALID_DURATION",
    };
  }

  const unit = String(match[2] || "s").toLowerCase();
  const multiplier = unit === "ms"
    ? 1
    : unit === "m"
      ? 60_000
      : unit === "h"
        ? 3_600_000
        : 1_000;
  return {
    success: true,
    durationMs: Math.max(0, Math.trunc(amount * multiplier)),
  };
}

function parseCrimewatchSafetyArgument(argumentText) {
  const normalized = String(argumentText || "").trim().toLowerCase();
  if (!normalized) {
    return {
      success: false,
      errorMsg: "USAGE",
    };
  }

  if (["full", "green", "2"].includes(normalized)) {
    return {
      success: true,
      safetyLevel: crimewatchState.SAFETY_LEVEL_FULL,
    };
  }
  if (["partial", "yellow", "1"].includes(normalized)) {
    return {
      success: true,
      safetyLevel: crimewatchState.SAFETY_LEVEL_PARTIAL,
    };
  }
  if (["none", "red", "0"].includes(normalized)) {
    return {
      success: true,
      safetyLevel: crimewatchState.SAFETY_LEVEL_NONE,
    };
  }

  return {
    success: false,
    errorMsg: "INVALID_SAFETY_LEVEL",
  };
}

function normalizeNpcEntityTypeFilter(value, fallback = "all") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["all", "any", "*"].includes(normalized)) {
    return "all";
  }
  if (["npc", "npcs", "rat", "rats"].includes(normalized)) {
    return "npc";
  }
  if (normalized === "concord") {
    return "concord";
  }
  return null;
}

function parseNpcClearArguments(argumentText) {
  const trimmed = String(argumentText || "").trim();
  if (!trimmed) {
    return {
      success: false,
      errorMsg: "USAGE",
    };
  }

  const parts = trimmed.split(/\s+/);
  const scope = String(parts[0] || "").trim().toLowerCase();
  if (scope === "system") {
    return {
      success: true,
      scope: "system",
      radiusMeters: 0,
      entityType: normalizeNpcEntityTypeFilter(parts[1], "all"),
    };
  }

  if (scope === "radius") {
    const radiusMeters = parseAmount(parts[1]);
    if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
      return {
        success: false,
        errorMsg: "INVALID_RADIUS",
      };
    }

    return {
      success: true,
      scope: "radius",
      radiusMeters,
      entityType: normalizeNpcEntityTypeFilter(parts[2], "all"),
    };
  }

  return {
    success: false,
    errorMsg: "USAGE",
  };
}

function normalizeSpaceVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = {
    x: Number.isFinite(Number(vector && vector.x)) ? Number(vector.x) : fallback.x,
    y: Number.isFinite(Number(vector && vector.y)) ? Number(vector.y) : fallback.y,
    z: Number.isFinite(Number(vector && vector.z)) ? Number(vector.z) : fallback.z,
  };
  const length = Math.sqrt(
    (resolved.x ** 2) + (resolved.y ** 2) + (resolved.z ** 2),
  );
  if (!Number.isFinite(length) || length <= 0) {
    return { ...fallback };
  }
  return {
    x: resolved.x / length,
    y: resolved.y / length,
    z: resolved.z / length,
  };
}

function addVectors(left, right) {
  return {
    x: Number(left && left.x || 0) + Number(right && right.x || 0),
    y: Number(left && left.y || 0) + Number(right && right.y || 0),
    z: Number(left && left.z || 0) + Number(right && right.z || 0),
  };
}

function subtractVectors(left, right) {
  return {
    x: Number(left && left.x || 0) - Number(right && right.x || 0),
    y: Number(left && left.y || 0) - Number(right && right.y || 0),
    z: Number(left && left.z || 0) - Number(right && right.z || 0),
  };
}

function scaleVector(vector, scalar) {
  return {
    x: Number(vector && vector.x || 0) * scalar,
    y: Number(vector && vector.y || 0) * scalar,
    z: Number(vector && vector.z || 0) * scalar,
  };
}

function crossVectors(left, right) {
  return {
    x: (Number(left && left.y || 0) * Number(right && right.z || 0))
      - (Number(left && left.z || 0) * Number(right && right.y || 0)),
    y: (Number(left && left.z || 0) * Number(right && right.x || 0))
      - (Number(left && left.x || 0) * Number(right && right.z || 0)),
    z: (Number(left && left.x || 0) * Number(right && right.y || 0))
      - (Number(left && left.y || 0) * Number(right && right.x || 0)),
  };
}

function cloneSpaceVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: Number.isFinite(Number(vector && vector.x)) ? Number(vector.x) : fallback.x,
    y: Number.isFinite(Number(vector && vector.y)) ? Number(vector.y) : fallback.y,
    z: Number.isFinite(Number(vector && vector.z)) ? Number(vector.z) : fallback.z,
  };
}

function parseTransportVectorTag(token, prefix) {
  const trimmed = String(token || "").trim();
  if (!trimmed) {
    return null;
  }

  const normalizedPrefix = `${String(prefix || "").toLowerCase()}=`;
  if (!trimmed.toLowerCase().startsWith(normalizedPrefix)) {
    return null;
  }

  const parts = trimmed.slice(normalizedPrefix.length).split(",");
  if (parts.length !== 3) {
    return null;
  }

  const values = parts.map((value) => Number(String(value || "").trim()));
  if (values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return {
    x: values[0],
    y: values[1],
    z: values[2],
  };
}

function parseTransportCoordinateTriplet(tokens) {
  if (!Array.isArray(tokens) || tokens.length !== 3) {
    return null;
  }

  const values = tokens.map((value) => Number(String(value || "").trim()));
  if (values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return {
    x: values[0],
    y: values[1],
    z: values[2],
  };
}

function getSessionDockedStationID(session) {
  return normalizePositiveInteger(getDockedLocationID(session));
}

function getSessionCurrentSolarSystemID(session) {
  const dockedStationID = getSessionDockedStationID(session);
  if (dockedStationID) {
    const station =
      worldData.getStationByID(dockedStationID) ||
      worldData.getStructureByID(dockedStationID);
    return normalizePositiveInteger(station && station.solarSystemID);
  }

  return normalizePositiveInteger(
    session &&
      (
        session.solarsystemid2 ||
        session.solarsystemid ||
        (session._space && session._space.systemID) ||
        0
      ),
  );
}

function getSessionTransportEntity(session) {
  if (!session || !session._space) {
    return null;
  }

  return spaceRuntime.getEntity(
    session,
    session._space && session._space.shipID,
  );
}

function buildTransportPointAnchor(entity, fallbackSystemID = null) {
  if (!entity) {
    return null;
  }

  const systemID =
    normalizePositiveInteger(entity.systemID || entity.solarSystemID) ||
    normalizePositiveInteger(fallbackSystemID);
  if (!systemID) {
    return null;
  }

  return {
    kind: "point",
    systemID,
    point: cloneSpaceVector(entity.position),
    direction: cloneSpaceVector(entity.direction, { x: 1, y: 0, z: 0 }),
    label:
      entity.stationName ||
      entity.stargateName ||
      entity.celestialName ||
      entity.name ||
      `${entity.kind || "entity"} ${entity.itemID || ""}`.trim(),
  };
}

function getSessionTransportAnchor(session) {
  if (!session) {
    return null;
  }

  const dockedStationID = getSessionDockedStationID(session);
  if (dockedStationID) {
    const station = worldData.getStationByID(dockedStationID);
    return {
      kind: "station",
      stationID: dockedStationID,
      label:
        (station && station.stationName) ||
        `station ${dockedStationID}`,
    };
  }

  const shipEntity = getSessionTransportEntity(session);
  if (shipEntity) {
    const shipAnchor = buildTransportPointAnchor(
      shipEntity,
      getSessionCurrentSolarSystemID(session),
    );
    return shipAnchor
      ? {
          ...shipAnchor,
          label:
            session.characterName ||
            session.userName ||
            shipAnchor.label,
        }
      : null;
  }

  const solarSystemID = getSessionCurrentSolarSystemID(session);
  if (!solarSystemID) {
    return null;
  }

  const solarSystem = worldData.getSolarSystemByID(solarSystemID);
  return {
    kind: "solarSystem",
    solarSystemID,
    label:
      (solarSystem && solarSystem.solarSystemName) ||
      `solar system ${solarSystemID}`,
  };
}

function resolveTransportSceneEntity(scene, entityID) {
  if (!scene || !entityID) {
    return null;
  }

  return scene.getEntityByID(entityID) || null;
}

function findStaticTransportAnchorByID(entityID) {
  const numericEntityID = normalizePositiveInteger(entityID);
  if (!numericEntityID) {
    return null;
  }

  const stargate = worldData.getStargateByID(numericEntityID);
  if (stargate) {
    return buildTransportPointAnchor(stargate, stargate.solarSystemID);
  }

  for (const solarSystem of worldData.getSolarSystems()) {
    const match = worldData.getStaticSceneForSystem(solarSystem.solarSystemID).find(
      (candidate) => Number(candidate && candidate.itemID) === numericEntityID,
    );
    if (match) {
      if (match.stationID) {
        return {
          kind: "station",
          stationID: numericEntityID,
          label:
            match.stationName ||
            `station ${numericEntityID}`,
        };
      }
      return buildTransportPointAnchor(match, solarSystem.solarSystemID);
    }
  }

  return null;
}

function resolveTransportTargetDescriptor(requestSession, targetToken) {
  const normalizedToken = String(targetToken || "").trim().toLowerCase();
  if (!normalizedToken) {
    return {
      success: false,
      errorMsg: "USAGE",
    };
  }

  if (normalizedToken === "me") {
    if (!requestSession || !requestSession.characterID) {
      return {
        success: false,
        errorMsg: "CHARACTER_NOT_SELECTED",
      };
    }
    return {
      success: true,
      data: {
        kind: "session",
        session: requestSession,
        label: "me",
      },
    };
  }

  const numericTargetID = normalizePositiveInteger(targetToken);
  if (!numericTargetID) {
    return {
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
    };
  }

  const targetSession = sessionRegistry.findSessionByCharacterID(numericTargetID);
  if (targetSession) {
    return {
      success: true,
      data: {
        kind: "session",
        session: targetSession,
        label: `character ${numericTargetID}`,
      },
    };
  }

  const requestScene = requestSession
    ? spaceRuntime.getSceneForSession(requestSession)
    : null;
  const entity = resolveTransportSceneEntity(requestScene, numericTargetID);
  if (
    entity &&
    requestScene &&
    requestScene.dynamicEntities instanceof Map &&
    requestScene.dynamicEntities.has(numericTargetID)
  ) {
    return {
      success: true,
      data: {
        kind: "entity",
        entity,
        systemID: requestScene.systemID,
        label: `${entity.kind || "entity"} ${numericTargetID}`,
      },
    };
  }

  return {
    success: false,
    errorMsg: "TARGET_NOT_FOUND",
  };
}

function resolveTransportPointContext(session, targetDescriptor) {
  const sessionAnchor = getSessionTransportAnchor(session);
  if (sessionAnchor) {
    if (sessionAnchor.kind === "point") {
      return sessionAnchor;
    }
    if (sessionAnchor.kind === "solarSystem") {
      return {
        kind: "point",
        systemID: sessionAnchor.solarSystemID,
        point: null,
        direction: { x: 1, y: 0, z: 0 },
      };
    }
    if (sessionAnchor.kind === "station") {
      const station = worldData.getStationByID(sessionAnchor.stationID);
      if (station) {
        return {
          kind: "point",
          systemID: normalizePositiveInteger(station.solarSystemID),
          point: null,
          direction: { x: 1, y: 0, z: 0 },
        };
      }
    }
  }

  if (targetDescriptor && targetDescriptor.kind === "session") {
    const targetAnchor = getSessionTransportAnchor(targetDescriptor.session);
    if (targetAnchor) {
      if (targetAnchor.kind === "point") {
        return targetAnchor;
      }
      if (targetAnchor.kind === "solarSystem") {
        return {
          kind: "point",
          systemID: targetAnchor.solarSystemID,
          point: null,
          direction: { x: 1, y: 0, z: 0 },
        };
      }
      if (targetAnchor.kind === "station") {
        const station = worldData.getStationByID(targetAnchor.stationID);
        if (station) {
          return {
            kind: "point",
            systemID: normalizePositiveInteger(station.solarSystemID),
            point: null,
            direction: { x: 1, y: 0, z: 0 },
          };
        }
      }
    }
  }

  if (targetDescriptor && targetDescriptor.kind === "entity") {
    return buildTransportPointAnchor(
      targetDescriptor.entity,
      targetDescriptor.systemID,
    );
  }

  return null;
}

function resolveTransportLocationToken(session, targetDescriptor, token) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    return null;
  }

  if (normalizedToken.toLowerCase() === "me") {
    const anchor = getSessionTransportAnchor(session);
    return anchor
      ? {
          ...anchor,
          label: "me",
        }
      : null;
  }

  const numericID = normalizePositiveInteger(normalizedToken);
  if (!numericID) {
    return null;
  }

  const solarSystem = worldData.getSolarSystemByID(numericID);
  if (solarSystem) {
    return {
      kind: "solarSystem",
      solarSystemID: numericID,
      label:
        solarSystem.solarSystemName ||
        `solar system ${numericID}`,
    };
  }

  const station = worldData.getStationByID(numericID);
  if (station) {
    return {
      kind: "station",
      stationID: numericID,
      label:
        station.stationName ||
        `station ${numericID}`,
    };
  }

  const candidateScenes = [];
  const requestScene = session ? spaceRuntime.getSceneForSession(session) : null;
  if (requestScene) {
    candidateScenes.push(requestScene);
  }

  if (targetDescriptor && targetDescriptor.kind === "session") {
    const targetScene = spaceRuntime.getSceneForSession(targetDescriptor.session);
    if (targetScene && !candidateScenes.includes(targetScene)) {
      candidateScenes.push(targetScene);
    }
  }

  for (const scene of candidateScenes) {
    const entity = resolveTransportSceneEntity(scene, numericID);
    if (!entity) {
      continue;
    }
    if (entity.stationID) {
      return {
        kind: "station",
        stationID: numericID,
        label:
          entity.stationName ||
          `station ${numericID}`,
      };
    }
    return buildTransportPointAnchor(entity, scene.systemID);
  }

  return findStaticTransportAnchorByID(numericID);
}

function withTransportOffset(destination, offsetVector) {
  if (!destination || destination.kind !== "point" || !destination.point) {
    return null;
  }

  return {
    ...destination,
    point: addVectors(destination.point, offsetVector),
  };
}

function formatTransportTargetLabel(targetDescriptor) {
  if (!targetDescriptor) {
    return "target";
  }

  if (targetDescriptor.kind === "session") {
    const targetSession = targetDescriptor.session;
    if (targetDescriptor.label === "me") {
      return "me";
    }
    return (
      (targetSession && targetSession.characterName) ||
      targetDescriptor.label ||
      `character ${targetSession && targetSession.characterID || "?"}`
    );
  }

  return targetDescriptor.label || "entity";
}

function formatTransportDestinationLabel(destination) {
  if (!destination) {
    return "destination";
  }

  if (destination.kind === "point") {
    if (destination.label) {
      return destination.label;
    }
    const point = destination.point || { x: 0, y: 0, z: 0 };
    return `(${point.x}, ${point.y}, ${point.z})`;
  }

  return destination.label || destination.kind;
}

function formatTransportTransitionError(result, fallback) {
  const errorMsg = result && result.errorMsg;
  if (errorMsg === "SHIP_NOT_FOUND") {
    return "Active ship not found for this character.";
  }
  if (errorMsg === "CHARACTER_NOT_SELECTED") {
    return "Select a character before using /tr.";
  }
  if (errorMsg === "SOLAR_SYSTEM_NOT_FOUND") {
    return "Solar-system transport target was not found.";
  }
  if (errorMsg === "STATION_NOT_FOUND") {
    return "Station transport target was not found.";
  }
  if (errorMsg === "SOLAR_JUMP_IN_PROGRESS" || errorMsg === "STATION_JUMP_IN_PROGRESS") {
    return "A transport is already in progress for this character.";
  }
  return fallback;
}

function buildTransportDestinationFromSession(session) {
  if (!session || !session.characterID) {
    return null;
  }

  const anchor = getSessionTransportAnchor(session);
  if (anchor) {
    return anchor;
  }

  const solarSystemID = getSessionCurrentSolarSystemID(session);
  if (!solarSystemID) {
    return null;
  }

  const solarSystem = worldData.getSolarSystemByID(solarSystemID);
  return {
    kind: "solarSystem",
    solarSystemID,
    label:
      (solarSystem && solarSystem.solarSystemName) ||
      `solar system ${solarSystemID}`,
  };
}

function executeSessionTransportTarget(
  requestSession,
  targetDescriptor,
  destination,
  chatHub,
  options,
) {
  const targetLabel = formatTransportTargetLabel(targetDescriptor);
  const destinationLabel = formatTransportDestinationLabel(destination);
  const targetSession = targetDescriptor && targetDescriptor.session;
  if (!targetSession || !targetSession.characterID) {
    return handledResult(
      chatHub,
      requestSession,
      options,
      "Transport target session is not available.",
    );
  }

  let crossedLocationBoundary = false;

  if (destination.kind === "solarSystem") {
    const result = jumpSessionToSolarSystem(
      targetSession,
      destination.solarSystemID,
    );
    if (!result.success) {
      return handledResult(
        chatHub,
        requestSession,
        options,
        formatTransportTransitionError(
          result,
          `Failed to transport ${targetLabel} to ${destinationLabel}.`,
        ),
      );
    }
    crossedLocationBoundary = true;
  } else if (destination.kind === "station") {
    const result = jumpSessionToStation(
      targetSession,
      destination.stationID,
    );
    if (!result.success) {
      return handledResult(
        chatHub,
        requestSession,
        options,
        formatTransportTransitionError(
          result,
          `Failed to transport ${targetLabel} to ${destinationLabel}.`,
        ),
      );
    }
    crossedLocationBoundary = true;
  } else if (destination.kind === "point") {
    const destinationSystemID = normalizePositiveInteger(destination.systemID);
    if (!destinationSystemID || !destination.point) {
      return handledResult(
        chatHub,
        requestSession,
        options,
        "Point transport is missing a valid solar-system location.",
      );
    }

    const currentTargetSystemID = getSessionCurrentSolarSystemID(targetSession);
    const currentTargetStationID = getSessionDockedStationID(targetSession);
    if (
      currentTargetStationID ||
      !targetSession._space ||
      currentTargetSystemID !== destinationSystemID
    ) {
      const jumpResult = jumpSessionToSolarSystem(
        targetSession,
        destinationSystemID,
      );
      if (!jumpResult.success) {
        return handledResult(
          chatHub,
          requestSession,
          options,
          formatTransportTransitionError(
            jumpResult,
            `Failed to transport ${targetLabel} to ${destinationLabel}.`,
          ),
        );
      }
      crossedLocationBoundary = true;
    }

    const teleportResult = spaceRuntime.teleportSessionShipToPoint(
      targetSession,
      destination.point,
      {
        direction: destination.direction,
        refreshOwnerSession: true,
      },
    );
    if (!teleportResult.success) {
      return handledResult(
        chatHub,
        requestSession,
        options,
        teleportResult.errorMsg === "NOT_IN_SPACE"
          ? `Failed to transport ${targetLabel}: target is not in space.`
          : `Failed to teleport ${targetLabel} in space.`,
      );
    }
  } else {
    return handledResult(
      chatHub,
      requestSession,
      options,
      `Unsupported /tr destination: ${destination.kind}.`,
    );
  }

  if (targetSession === requestSession && crossedLocationBoundary) {
    if (destination.kind !== "station") {
      const destinationSystemID =
        destination.kind === "solarSystem"
          ? destination.solarSystemID
          : destination.kind === "point"
            ? destination.systemID
            : normalizePositiveInteger(
              (worldData.getStationByID(destination.stationID) || {}).solarSystemID,
            );
      const destinationSystem = worldData.getSolarSystemByID(destinationSystemID);
      reconcileSolarTargetSessionIdentity(requestSession, destinationSystem);
    }
    flushPendingLocalChannelSync(chatHub, requestSession);
    return handledResult(
      chatHub,
      requestSession,
      getPostLocalMoveFeedbackOptions(options),
      `Transported ${targetLabel} to ${destinationLabel}.`,
    );
  }

  return handledResult(
    chatHub,
    requestSession,
    options,
    `Transported ${targetLabel} to ${destinationLabel}.`,
  );
}

function buildNearbySpaceSpawnState(shipEntity, distanceMeters = 250) {
  const position = {
    x: Number(shipEntity && shipEntity.position && shipEntity.position.x || 0),
    y: Number(shipEntity && shipEntity.position && shipEntity.position.y || 0),
    z: Number(shipEntity && shipEntity.position && shipEntity.position.z || 0),
  };
  const direction = normalizeSpaceVector(
    shipEntity && shipEntity.direction,
    { x: 1, y: 0, z: 0 },
  );
  return {
    position: addVectors(position, scaleVector(direction, Math.max(50, Number(distanceMeters) || 250))),
    velocity: { x: 0, y: 0, z: 0 },
    direction,
    mode: "STOP",
    speedFraction: 0,
  };
}

function buildRandomUnitVector() {
  const theta = Math.random() * Math.PI * 2;
  const u = (Math.random() * 2) - 1;
  const planarScale = Math.sqrt(Math.max(0, 1 - (u * u)));
  return normalizeSpaceVector({
    x: Math.cos(theta) * planarScale,
    y: u,
    z: Math.sin(theta) * planarScale,
  }, { x: 1, y: 0, z: 0 });
}

function buildOffsetSpaceSpawnState(shipEntity, distanceMeters = 20_000) {
  const origin = {
    x: Number(shipEntity && shipEntity.position && shipEntity.position.x || 0),
    y: Number(shipEntity && shipEntity.position && shipEntity.position.y || 0),
    z: Number(shipEntity && shipEntity.position && shipEntity.position.z || 0),
  };
  const offsetDirection = buildRandomUnitVector();
  const position = addVectors(
    origin,
    scaleVector(offsetDirection, Math.max(1_000, Number(distanceMeters) || 20_000)),
  );
  return {
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction: normalizeSpaceVector(
      buildRandomUnitVector(),
      shipEntity && shipEntity.direction,
    ),
    targetPoint: position,
    mode: "STOP",
    speedFraction: 0,
  };
}

function allocateTransientVisualEntityID() {
  const allocated = nextTransientVisualEntityID;
  nextTransientVisualEntityID += 1;
  return allocated;
}

function allocateCombatDummyEntityID() {
  const allocated = nextCombatDummyEntityID;
  nextCombatDummyEntityID += 1;
  return allocated;
}

function buildPalatineKeepstarVisualEntity(session, anchorEntity) {
  const keepstarType = resolveItemByTypeID(PALATINE_KEEPSTAR_TYPE_ID);
  if (!keepstarType) {
    return null;
  }

  const spawnDistance = Math.max(
    KEEPSTAR_DEFAULT_SPAWN_DISTANCE_METERS,
    (Number(keepstarType.radius) || KEEPSTAR_DEFAULT_RADIUS_METERS) + 200000,
  );
  const spawnState = buildOffsetSpaceSpawnState(anchorEntity, spawnDistance);
  const corporationID = Number(session && session.corporationID || 0) || 0;
  const allianceID = Number(session && session.allianceID || 0) || 0;
  const warFactionID = Number(session && session.warFactionID || 0) || 0;
  const ownerID =
    corporationID ||
    Number(session && (session.characterID || session.charid) || 0) ||
    1;

  return {
    kind: "station",
    itemID: allocateTransientVisualEntityID(),
    typeID: keepstarType.typeID,
    groupID: keepstarType.groupID || 1657,
    categoryID: keepstarType.categoryID || 65,
    itemName: keepstarType.name || "Upwell Palatine Keepstar",
    ownerID,
    corporationID,
    allianceID,
    warFactionID,
    radius: Number(keepstarType.radius) || KEEPSTAR_DEFAULT_RADIUS_METERS,
    position: spawnState.position,
    velocity: { x: 0, y: 0, z: 0 },
    direction: spawnState.direction,
    targetPoint: spawnState.targetPoint,
    mode: "STOP",
    speedFraction: 0,
    dockPosition: null,
    dockOrientation: spawnState.direction,
    dunRotation: [0, 0, 0],
    activityLevel: null,
    skinMaterialSetID: null,
    celestialEffect: null,
  };
}

function getShipRadiusMeters(shipType) {
  const radius = Number(shipType && shipType.radius);
  if (Number.isFinite(radius) && radius > 0) {
    return radius;
  }
  return 50;
}

function sortShipsLargestToSmallest(left, right) {
  const massDelta = (Number(right && right.mass) || 0) - (Number(left && left.mass) || 0);
  if (massDelta !== 0) {
    return massDelta;
  }
  const radiusDelta = getShipRadiusMeters(right) - getShipRadiusMeters(left);
  if (radiusDelta !== 0) {
    return radiusDelta;
  }
  const volumeDelta = (Number(right && right.volume) || 0) - (Number(left && left.volume) || 0);
  if (volumeDelta !== 0) {
    return volumeDelta;
  }
  return String(left && left.name || "").localeCompare(String(right && right.name || ""));
}

function buildFormationBasis(direction) {
  const forward = normalizeSpaceVector(direction, { x: 1, y: 0, z: 0 });
  const upReference = Math.abs(Number(forward.y) || 0) >= 0.95
    ? { x: 1, y: 0, z: 0 }
    : { x: 0, y: 1, z: 0 };
  const right = normalizeSpaceVector(
    crossVectors(forward, upReference),
    { x: 0, y: 0, z: 1 },
  );
  const up = normalizeSpaceVector(
    crossVectors(right, forward),
    upReference,
  );
  return { forward, right, up };
}

function resolveFire2FleetShipTypes() {
  const seenTypeIDs = new Set();
  const resolved = [];
  for (const shipName of DEFAULT_FIRE2_FLEET_SHIP_NAMES) {
    const lookup = resolveShipByName(shipName);
    if (!lookup.success || !lookup.match) {
      continue;
    }
    const typeID = Number(lookup.match.typeID) || 0;
    if (typeID <= 0 || seenTypeIDs.has(typeID)) {
      continue;
    }
    seenTypeIDs.add(typeID);
    resolved.push(lookup.match);
  }

  const ships = resolved.sort(sortShipsLargestToSmallest);
  if (ships.length < 10) {
    return {
      success: false,
      errorMsg: "FIRE2_FLEET_TYPES_UNAVAILABLE",
      availableCount: ships.length,
    };
  }

  return {
    success: true,
    ships,
  };
}

function buildFire2FleetShipList(shipTypes, fleetSize) {
  const normalizedSize = Math.max(1, normalizePositiveInteger(fleetSize) || DEFAULT_FIRE2_FLEET_SIZE);
  const fleet = [];
  for (let index = 0; index < normalizedSize; index += 1) {
    const bucketIndex = Math.min(
      shipTypes.length - 1,
      Math.floor((index * shipTypes.length) / normalizedSize),
    );
    fleet.push(shipTypes[bucketIndex]);
  }
  return fleet;
}

function buildFire2FormationRowCounts(fleetSize) {
  const rowCounts = [];
  let remaining = Math.max(1, normalizePositiveInteger(fleetSize) || DEFAULT_FIRE2_FLEET_SIZE);
  let nextRowSize = 1;
  while (remaining > 0) {
    const rowSize = Math.min(nextRowSize, remaining);
    rowCounts.push(rowSize);
    remaining -= rowSize;
    nextRowSize += 1;
  }
  return rowCounts;
}

function buildFire2RowSlots(rowShipCount) {
  const slots = [];
  if (rowShipCount % 2 === 1) {
    slots.push({ lane: 0 });
  }

  let laneMagnitude = rowShipCount % 2 === 0 ? 0.5 : 1;
  while (slots.length < rowShipCount) {
    slots.push({ lane: -laneMagnitude });
    if (slots.length < rowShipCount) {
      slots.push({ lane: laneMagnitude });
    }
    laneMagnitude += 1;
  }

  return slots;
}

function buildFire2FleetFormation(anchorEntity, shipTypes, fleetSize) {
  const fleetShips = buildFire2FleetShipList(shipTypes, fleetSize);
  const rowCounts = buildFire2FormationRowCounts(fleetShips.length);
  const anchorPosition = {
    x: Number(anchorEntity && anchorEntity.position && anchorEntity.position.x || 0),
    y: Number(anchorEntity && anchorEntity.position && anchorEntity.position.y || 0),
    z: Number(anchorEntity && anchorEntity.position && anchorEntity.position.z || 0),
  };
  const basis = buildFormationBasis(anchorEntity && anchorEntity.direction);
  const formationOrigin = addVectors(
    anchorPosition,
    scaleVector(basis.forward, FIRE2_BASE_DISTANCE_METERS),
  );
  const facingDirection = normalizeSpaceVector(
    subtractVectors(anchorPosition, formationOrigin),
    scaleVector(basis.forward, -1),
  );

  const layout = [];
  let shipIndex = 0;
  let rowDistanceMeters = 0;
  let previousRowMaxRadius = 0;
  let formationRowIndex = 0;

  for (const rowCount of rowCounts) {
    const rowShips = fleetShips.slice(shipIndex, shipIndex + rowCount);
    if (rowShips.length === 0) {
      break;
    }

    const rowMaxRadius = rowShips.reduce(
      (largest, shipType) => Math.max(largest, getShipRadiusMeters(shipType)),
      0,
    );
    if (layout.length > 0) {
      rowDistanceMeters += Math.max(
        FIRE2_ROW_SPACING_METERS,
        previousRowMaxRadius + rowMaxRadius + FIRE2_OVERLAP_PADDING_METERS,
      );
    }

    const lateralSpacingMeters = Math.max(
      FIRE2_LATERAL_SPACING_METERS,
      (rowMaxRadius * 2) + FIRE2_OVERLAP_PADDING_METERS,
    );
    const verticalSpacingMeters = Math.max(
      2_500,
      rowMaxRadius + (FIRE2_OVERLAP_PADDING_METERS * 0.75),
    );
    const wingSweepBackMeters = Math.max(
      1_250,
      Math.min(
        3_500,
        (rowMaxRadius * 0.45) + (FIRE2_OVERLAP_PADDING_METERS * 0.25),
      ),
    );
    const rowSlots = buildFire2RowSlots(rowShips.length);

    for (let slotIndex = 0; slotIndex < rowShips.length; slotIndex += 1) {
      const rowSlot = rowSlots[slotIndex] || { lane: 0 };
      const lane = Number(rowSlot.lane) || 0;
      const laneDepth = Math.abs(lane);
      const lateralOffsetMeters = lane * lateralSpacingMeters;
      const wingPullbackMeters = laneDepth * wingSweepBackMeters;
      const centerAdvanceMeters = lane === 0
        ? Math.min(300, Math.max(150, rowMaxRadius * 0.04))
        : 0;
      const verticalDirection = lane === 0
        ? (formationRowIndex % 2 === 0 ? 1 : -1)
        : (lane < 0 ? 1 : -1) * (formationRowIndex % 2 === 0 ? 1 : -1);
      const verticalOffsetMeters = lane === 0
        ? verticalDirection * verticalSpacingMeters * 0.35
        : verticalDirection
          * Math.min(2.5, Math.max(1, laneDepth))
          * verticalSpacingMeters
          * 0.55;
      const position = addVectors(
        addVectors(
          formationOrigin,
          scaleVector(
            basis.forward,
            rowDistanceMeters - wingPullbackMeters + centerAdvanceMeters,
          ),
        ),
        addVectors(
          scaleVector(basis.right, lateralOffsetMeters),
          scaleVector(basis.up, verticalOffsetMeters),
        ),
      );
      layout.push({
        shipType: rowShips[slotIndex],
        spawnState: {
          position,
          velocity: { x: 0, y: 0, z: 0 },
          direction: facingDirection,
          targetPoint: position,
          mode: "STOP",
          speedFraction: 0,
        },
      });
    }

    previousRowMaxRadius = rowMaxRadius;
    shipIndex += rowShips.length;
    formationRowIndex += 1;
  }

  return layout;
}

function isContainerType(itemType) {
  const groupName = String(itemType && itemType.groupName || "").trim().toLowerCase();
  return groupName.includes("container") || groupName === "spawn container";
}

function isWreckType(itemType) {
  const groupName = String(itemType && itemType.groupName || "").trim().toLowerCase();
  return groupName === "wreck";
}

function resolveSpaceItemType(argumentText, defaultName, predicate, label) {
  const lookupText = String(argumentText || "").trim() || defaultName;
  const lookup = resolveItemByName(lookupText);
  if (!lookup.success) {
    return lookup;
  }
  if (!predicate(lookup.match)) {
    return {
      success: false,
      errorMsg: `${label}_TYPE_REQUIRED`,
      suggestions: [lookup.match.name],
    };
  }
  return lookup;
}

function parseOptionalTypeAndCount(argumentText) {
  const trimmed = String(argumentText || "").trim();
  if (!trimmed) {
    return {
      typeName: "",
      count: null,
    };
  }

  if (/^\d+$/.test(trimmed)) {
    return {
      typeName: "",
      count: normalizePositiveInteger(trimmed),
    };
  }

  const splitLookup = splitTrailingAmount(trimmed);
  if (splitLookup.lookupText && splitLookup.amount !== null) {
    return {
      typeName: splitLookup.lookupText,
      count: normalizePositiveInteger(Math.trunc(splitLookup.amount)),
    };
  }

  return {
    typeName: trimmed,
    count: null,
  };
}

function isTechTwoPropulsionName(name) {
  return /\b(?:Afterburner|Microwarpdrive) II$/i.test(String(name || "").trim());
}

function startsWithAnyPrefix(name, prefixes) {
  const text = String(name || "").trim();
  return prefixes.some((prefix) => text.startsWith(prefix));
}

function getNumericTypeAttributeValue(typeID, attributeName, fallback = 0) {
  const numeric = Number(getTypeAttributeValue(Number(typeID) || 0, attributeName));
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isNonTechOneVariant(row) {
  const typeID = Number(row && row.typeID) || 0;
  const techLevel = getNumericTypeAttributeValue(typeID, "techLevel", 0);
  const metaGroupID = getNumericTypeAttributeValue(
    typeID,
    "metaGroupID",
    Number(row && row.metaGroupID) || 0,
  );
  return (
    techLevel >= 2 ||
    metaGroupID > 1 ||
    /abyssal/i.test(String(row && row.name || ""))
  );
}

function isCombatWeaponType(row) {
  const typeID = Number(row && row.typeID) || 0;
  const groupName = String(row && row.groupName || "").trim().toLowerCase();
  if (!typeID || groupName.includes("mining") || groupName.includes("gas cloud")) {
    return false;
  }

  return (
    typeHasEffectName(typeID, "turretFitted") ||
    typeHasEffectName(typeID, "launcherFitted")
  );
}

function collectChargeGroupIDsForType(typeID) {
  const chargeGroupIDs = new Set();
  for (let index = 1; index <= 5; index += 1) {
    const groupID = getNumericTypeAttributeValue(typeID, `chargeGroup${index}`, 0);
    if (groupID > 0) {
      chargeGroupIDs.add(groupID);
    }
  }
  return chargeGroupIDs;
}

function dedupeItemTypes(itemTypes) {
  const deduped = [];
  const seen = new Set();
  for (const itemType of Array.isArray(itemTypes) ? itemTypes : []) {
    const typeID = Number(itemType && itemType.typeID) || 0;
    if (typeID <= 0 || seen.has(typeID)) {
      continue;
    }
    seen.add(typeID);
    deduped.push(itemType);
  }
  return deduped;
}

function sortItemTypesByName(left, right) {
  const leftName = String(left && left.name || "");
  const rightName = String(right && right.name || "");
  const nameCompare = leftName.localeCompare(rightName);
  if (nameCompare !== 0) {
    return nameCompare;
  }
  return (Number(left && left.typeID) || 0) - (Number(right && right.typeID) || 0);
}

function isPublishedMineralRow(row) {
  const typeID = Number(row && row.typeID) || 0;
  const groupID = Number(row && row.groupID) || 0;
  const name = String(row && row.name || "").trim();
  if (typeID <= 0 || groupID !== 18 || row.published === false) {
    return false;
  }

  return !/\bunused\b/i.test(name);
}

function isPublishedOreRow(row) {
  const typeID = Number(row && row.typeID) || 0;
  const categoryID = Number(row && row.categoryID) || 0;
  const groupName = String(row && row.groupName || "").trim().toLowerCase();
  const name = String(row && row.name || "").trim().toLowerCase();
  if (typeID <= 0 || categoryID !== 25 || row.published === false) {
    return false;
  }

  if (
    groupName.includes("ice") ||
    groupName.includes("decorative") ||
    groupName.includes("non-interactable") ||
    /\bunused\b/i.test(name)
  ) {
    return false;
  }

  return true;
}

function getMineralsSeedPlan() {
  if (cachedMineralsSeedPlan) {
    return cachedMineralsSeedPlan;
  }

  const rows = readStaticRows(TABLE.ITEM_TYPES) || [];
  const mineralTypes = dedupeItemTypes(
    rows
      .filter(isPublishedMineralRow)
      .map((row) => resolveItemByTypeID(row.typeID))
      .filter(Boolean),
  ).sort(sortItemTypesByName);
  const oreTypes = dedupeItemTypes(
    rows
      .filter(isPublishedOreRow)
      .map((row) => resolveItemByTypeID(row.typeID))
      .filter(Boolean),
  ).sort(sortItemTypesByName);

  cachedMineralsSeedPlan = {
    mineralTypes,
    oreTypes,
    allTypeIDs: new Set([
      ...mineralTypes.map((itemType) => Number(itemType.typeID) || 0),
      ...oreTypes.map((itemType) => Number(itemType.typeID) || 0),
    ]),
    entries: [
      ...mineralTypes.map((itemType) => ({
        itemType,
        quantity: MINERALS_SEED_QUANTITY,
      })),
      ...oreTypes.map((itemType) => ({
        itemType,
        quantity: MINERALS_SEED_QUANTITY,
      })),
    ],
  };
  return cachedMineralsSeedPlan;
}

function getGmWeaponsSeedPlan() {
  if (cachedGmWeaponsSeedPlan) {
    return cachedGmWeaponsSeedPlan;
  }

  const rows = readStaticRows(TABLE.ITEM_TYPES) || [];
  const weaponTypes = dedupeItemTypes(
    rows
      .filter((row) => Number(row.categoryID) === 7)
      .filter((row) => row.published !== false)
      .filter((row) => !/blueprint/i.test(String(row.name || "")))
      .filter((row) => isCombatWeaponType(row))
      .filter((row) => isNonTechOneVariant(row))
      .map((row) => resolveItemByTypeID(row.typeID))
      .filter(Boolean),
  ).sort(sortItemTypesByName);

  const chargeGroupIDs = new Set();
  for (const weaponType of weaponTypes) {
    for (const chargeGroupID of collectChargeGroupIDsForType(weaponType.typeID)) {
      chargeGroupIDs.add(chargeGroupID);
    }
  }

  const ammoTypes = dedupeItemTypes(
    rows
      .filter((row) => Number(row.categoryID) === 8)
      .filter((row) => row.published !== false)
      .filter((row) => !/blueprint/i.test(String(row.name || "")))
      .filter((row) => chargeGroupIDs.has(Number(row.groupID) || 0))
      .filter((row) => isNonTechOneVariant(row))
      .map((row) => resolveItemByTypeID(row.typeID))
      .filter(Boolean),
  ).sort(sortItemTypesByName);

  cachedGmWeaponsSeedPlan = {
    weaponTypes,
    ammoTypes,
    entries: [
      ...weaponTypes.map((itemType) => ({
        itemType,
        quantity: GM_WEAPONS_MODULE_QUANTITY,
        kind: "weapon",
      })),
      ...ammoTypes.map((itemType) => ({
        itemType,
        quantity: GM_WEAPONS_AMMO_QUANTITY,
        kind: "ammo",
      })),
    ],
  };
  return cachedGmWeaponsSeedPlan;
}

function syncStationHangarChangesToSession(session, stationID, changes = []) {
  const currentStationID = Number(getDockedLocationID(session) || 0) || 0;
  if (
    !session ||
    !session.characterID ||
    currentStationID <= 0 ||
    currentStationID !== Number(stationID)
  ) {
    return;
  }

  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }

    syncInventoryItemForSession(
      session,
      change.item,
      change.previousState || {
        locationID: 0,
        flagID: ITEM_FLAGS.HANGAR,
      },
      {
        emitCfgLocation: true,
      },
    );
  }
}

function grantStationHangarBatchAndSyncSession(session, stationID, entries = []) {
  const result = grantItemsToCharacterStationHangar(
    Number(session && session.characterID) || 0,
    stationID,
    entries,
  );
  if (result.success) {
    syncStationHangarChangesToSession(
      session,
      stationID,
      result.data && result.data.changes,
    );
  }
  return result;
}

function removeStationHangarBatchAndSyncSession(session, stationID, itemIDs = []) {
  const changes = [];
  for (const rawItemID of Array.isArray(itemIDs) ? itemIDs : []) {
    const itemID = Number(rawItemID) || 0;
    if (itemID <= 0) {
      continue;
    }
    const removeResult = removeInventoryItem(itemID, {
      removeContents: true,
    });
    if (!removeResult.success) {
      return removeResult;
    }
    changes.push(...((removeResult.data && removeResult.data.changes) || []));
  }

  if (changes.length > 0) {
    syncStationHangarChangesToSession(session, stationID, changes);
  }

  return {
    success: true,
    data: {
      changes,
    },
  };
}

function continueGmWeaponsSeedJob(job, chatHub) {
  if (!job) {
    return;
  }

  try {
    const nextEntries = job.entries.slice(
      job.nextIndex,
      job.nextIndex + GM_WEAPONS_BATCH_SIZE,
    );
    if (nextEntries.length === 0) {
      activeGmWeaponsJobs.delete(job.characterID);
      chatHub.sendSystemMessage(
        job.session,
        [
          `Completed /gmweapons for station ${job.stationID}.`,
          `Added ${job.weaponTypeCount} weapon stacks x${GM_WEAPONS_MODULE_QUANTITY} and ${job.ammoTypeCount} ammo stacks x${GM_WEAPONS_AMMO_QUANTITY}.`,
          job.sample ? `Sample: ${job.sample}.` : null,
        ].filter(Boolean).join(" "),
        job.feedbackChannel,
      );
      return;
    }

    const grantResult = grantStationHangarBatchAndSyncSession(
      job.session,
      job.stationID,
      nextEntries,
    );
    if (!grantResult.success) {
      throw new Error(grantResult.errorMsg || "WRITE_ERROR");
    }

    job.nextIndex += nextEntries.length;
    setImmediate(() => continueGmWeaponsSeedJob(job, chatHub));
  } catch (error) {
    activeGmWeaponsJobs.delete(job.characterID);
    chatHub.sendSystemMessage(
      job.session,
      ` /gmweapons failed after ${job.nextIndex}/${job.entries.length} grants: ${error.message}`.trim(),
      job.feedbackChannel,
    );
  }
}

function getPropulsionCommandItemTypes() {
  if (cachedPropulsionCommandTypes) {
    return cachedPropulsionCommandTypes;
  }

  const rows = readStaticRows(TABLE.ITEM_TYPES) || [];
  cachedPropulsionCommandTypes = rows
    .filter((row) => Number(row.groupID) === PROPULSION_MODULE_GROUP_ID)
    .filter((row) => Number(row.categoryID) === PROPULSION_MODULE_CATEGORY_ID)
    .filter((row) => row.published !== false)
    .filter((row) => /afterburner|microwarpdrive/i.test(String(row.name || "")))
    .filter((row) => !/blueprint|mutaplasmid/i.test(String(row.name || "")))
    .filter((row) => {
      const name = String(row.name || "").trim();
      return (
        isTechTwoPropulsionName(name) ||
        startsWithAnyPrefix(name, PROPULSION_FACTION_PREFIXES) ||
        startsWithAnyPrefix(name, PROPULSION_OFFICER_PREFIXES)
      );
    })
    .map((row) => resolveItemByName(String(row.name || "").trim()))
    .filter((lookup) => lookup && lookup.success && lookup.match)
    .map((lookup) => lookup.match)
    .filter((itemType, index, list) =>
      list.findIndex((candidate) => Number(candidate.typeID) === Number(itemType.typeID)) === index,
    )
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));

  return cachedPropulsionCommandTypes;
}

function buildPlannedFittedModuleItem(charID, shipItem, itemType, flagID, itemID) {
  return {
    itemID,
    typeID: Number(itemType && itemType.typeID) || 0,
    groupID: Number(itemType && itemType.groupID) || 0,
    categoryID: Number(itemType && itemType.categoryID) || 0,
    flagID: Number(flagID) || 0,
    locationID: Number(shipItem && shipItem.itemID) || 0,
    ownerID: Number(charID) || 0,
    singleton: 1,
    quantity: 1,
    stacksize: 1,
    itemName: String(itemType && itemType.name || ""),
    moduleState: {
      online: true,
    },
  };
}

function canPlannedModulesStayOnline(charID, shipItem, plannedModules) {
  const resourceState = buildShipResourceState(charID, shipItem, {
    fittedItems: plannedModules,
  });
  return {
    resourceState,
    success:
      resourceState.cpuLoad <= resourceState.cpuOutput + 1e-6 &&
      resourceState.powerLoad <= resourceState.powerOutput + 1e-6,
  };
}

function tryPlanNextModuleFit(charID, shipItem, itemType, fittedItems) {
  const nextFlagID = selectAutoFitFlagForType(
    shipItem,
    fittedItems,
    Number(itemType && itemType.typeID) || 0,
  );
  if (!nextFlagID) {
    return {
      success: false,
      errorMsg: "NO_SLOT_AVAILABLE",
    };
  }

  const probeItem = buildPlannedFittedModuleItem(
    charID,
    shipItem,
    itemType,
    nextFlagID,
    -1000 - fittedItems.length,
  );
  const validation = validateFitForShip(
    charID,
    shipItem,
    probeItem,
    nextFlagID,
    fittedItems,
  );
  if (!validation.success && validation.errorMsg !== "SKILL_REQUIRED") {
    return validation;
  }

  const plannedItems = [...fittedItems, probeItem];
  const resourceCheck = canPlannedModulesStayOnline(charID, shipItem, plannedItems);
  if (!resourceCheck.success) {
    return {
      success: false,
      errorMsg:
        resourceCheck.resourceState.cpuLoad > resourceCheck.resourceState.cpuOutput + 1e-6
          ? "NOT_ENOUGH_CPU"
          : "NOT_ENOUGH_POWER",
      data: {
        resourceState: resourceCheck.resourceState,
      },
    };
  }

  return {
    success: true,
    data: {
      flagID: nextFlagID,
      plannedItems,
      resourceState: resourceCheck.resourceState,
    },
  };
}

function getCompatibleModuleChargeTypes(moduleTypeID, filterFn = null) {
  const numericModuleTypeID = Number(moduleTypeID) || 0;
  if (numericModuleTypeID <= 0) {
    return [];
  }

  const rows = readStaticRows(TABLE.ITEM_TYPES) || [];
  return dedupeItemTypes(
    rows
      .filter((row) => Number(row && row.categoryID) === 8)
      .filter((row) => row.published !== false)
      .filter((row) => !/blueprint/i.test(String(row && row.name || "")))
      .map((row) => resolveItemByTypeID(row.typeID))
      .filter(Boolean)
      .filter((itemType) => isChargeCompatibleWithModule(numericModuleTypeID, itemType.typeID))
      .filter((itemType) => typeof filterFn !== "function" || filterFn(itemType)),
  ).sort(sortItemTypesByName);
}

function getCompatibleLaserCrystalTypes(moduleTypeID) {
  return getCompatibleModuleChargeTypes(moduleTypeID);
}

function getCompatibleLesmisHeavyMissileTypes(moduleTypeID) {
  if (cachedLesmisHeavyMissileTypes) {
    return cachedLesmisHeavyMissileTypes;
  }

  cachedLesmisHeavyMissileTypes = getCompatibleModuleChargeTypes(
    moduleTypeID,
    (itemType) =>
      /^(Inferno|Mjolnir|Nova|Scourge)(?: (Fury|Precision))? Heavy Missile$/i.test(
        String(itemType && itemType.name || "").trim(),
      ),
  );

  return cachedLesmisHeavyMissileTypes;
}

function resolveSingleRackCommandPreset(commandName) {
  const normalized = normalizeCommandName(commandName);
  if (normalized === "laser" || normalized === "lasers") {
    return SINGLE_RACK_COMMAND_PRESETS.laser;
  }

  if (
    normalized === "railgun" ||
    normalized === "hybrid" ||
    normalized === "hybrids" ||
    normalized === "hyrbids"
  ) {
    return SINGLE_RACK_COMMAND_PRESETS.hybrids;
  }

  if (
    normalized === "autocannon" ||
    normalized === "projectile" ||
    normalized === "projectiles" ||
    normalized === "projectule"
  ) {
    return normalized === "autocannon"
      ? SINGLE_RACK_COMMAND_PRESETS.autocannon
      : SINGLE_RACK_COMMAND_PRESETS.projectiles;
  }

  if (
    normalized === "rocket" ||
    normalized === "light" ||
    normalized === "heavy" ||
    normalized === "torp"
  ) {
    return SINGLE_RACK_COMMAND_PRESETS[normalized] || null;
  }

  return null;
}

function buildPresetSingleRackCommandPlan(charID, shipItem, preset) {
  const propulsionType = resolveItemByName(
    String(preset && preset.propulsionName || LASER_COMMAND_MWD_NAME),
  );
  if (!propulsionType || !propulsionType.success || !propulsionType.match) {
    return {
      success: false,
      errorMsg: "RACK_COMMAND_MWD_NOT_FOUND",
    };
  }

  const moduleType = resolveItemByName(String(preset && preset.moduleName || ""));
  if (!moduleType || !moduleType.success || !moduleType.match) {
    return {
      success: false,
      errorMsg: "RACK_COMMAND_MODULE_NOT_FOUND",
    };
  }

  const baseFit = tryPlanNextModuleFit(charID, shipItem, propulsionType.match, []);
  if (!baseFit.success) {
    return {
      success: false,
      errorMsg: baseFit.errorMsg || "RACK_COMMAND_MWD_FIT_FAILED",
    };
  }

  let plannedItems = baseFit.data.plannedItems.slice();
  let latestResourceState = baseFit.data.resourceState;
  const moduleCount = Number(preset && preset.moduleCount) || 0;
  for (let index = 0; index < moduleCount; index += 1) {
    const nextFit = tryPlanNextModuleFit(
      charID,
      shipItem,
      moduleType.match,
      plannedItems,
    );
    if (!nextFit.success) {
      return {
        success: false,
        errorMsg: nextFit.errorMsg || "RACK_COMMAND_MODULE_FIT_FAILED",
        data: {
          fittedModuleCount: index,
        },
      };
    }

    plannedItems = nextFit.data.plannedItems;
    latestResourceState = nextFit.data.resourceState;
  }

  const chargeTypes = getCompatibleModuleChargeTypes(moduleType.match.typeID);
  if (chargeTypes.length === 0) {
    return {
      success: false,
      errorMsg: "RACK_COMMAND_CHARGES_NOT_FOUND",
    };
  }

  const totalChargeVolume = chargeTypes.reduce(
    (sum, itemType) =>
      sum +
      ((Number(itemType && itemType.volume) || 0) * (Number(preset && preset.chargeQuantity) || 0)),
    0,
  );
  if (totalChargeVolume > latestResourceState.cargoCapacity + 1e-6) {
    return {
      success: false,
      errorMsg: "RACK_COMMAND_CARGO_TOO_SMALL",
      data: {
        requiredVolume: totalChargeVolume,
        cargoCapacity: latestResourceState.cargoCapacity,
      },
    };
  }

  return {
    success: true,
    data: {
      propulsionType: propulsionType.match,
      moduleType: moduleType.match,
      moduleCount,
      plannedItems,
      resourceState: latestResourceState,
      chargeTypes,
    },
  };
}

function buildLesmisCommandPlan(charID, shipItem) {
  const propulsionType = resolveItemByName(LASER_COMMAND_MWD_NAME);
  if (!propulsionType || !propulsionType.success || !propulsionType.match) {
    return {
      success: false,
      errorMsg: "LESMIS_COMMAND_MWD_NOT_FOUND",
    };
  }

  const launcherType = resolveItemByName(LESMIS_COMMAND_LAUNCHER_NAME);
  if (!launcherType || !launcherType.success || !launcherType.match) {
    return {
      success: false,
      errorMsg: "LESMIS_COMMAND_LAUNCHER_NOT_FOUND",
    };
  }

  const turretType = resolveItemByName(LESMIS_COMMAND_TURRET_NAME);
  if (!turretType || !turretType.success || !turretType.match) {
    return {
      success: false,
      errorMsg: "LESMIS_COMMAND_TURRET_NOT_FOUND",
    };
  }

  const baseFit = tryPlanNextModuleFit(charID, shipItem, propulsionType.match, []);
  if (!baseFit.success) {
    return {
      success: false,
      errorMsg: baseFit.errorMsg || "LESMIS_COMMAND_MWD_FIT_FAILED",
    };
  }

  let plannedItems = baseFit.data.plannedItems.slice();
  let latestResourceState = baseFit.data.resourceState;
  for (let index = 0; index < LESMIS_COMMAND_LAUNCHER_COUNT; index += 1) {
    const nextFit = tryPlanNextModuleFit(
      charID,
      shipItem,
      launcherType.match,
      plannedItems,
    );
    if (!nextFit.success) {
      return {
        success: false,
        errorMsg: nextFit.errorMsg || "LESMIS_COMMAND_LAUNCHER_FIT_FAILED",
        data: {
          fittedLauncherCount: index,
        },
      };
    }

    plannedItems = nextFit.data.plannedItems;
    latestResourceState = nextFit.data.resourceState;
  }

  for (let index = 0; index < LESMIS_COMMAND_TURRET_COUNT; index += 1) {
    const nextFit = tryPlanNextModuleFit(
      charID,
      shipItem,
      turretType.match,
      plannedItems,
    );
    if (!nextFit.success) {
      return {
        success: false,
        errorMsg: nextFit.errorMsg || "LESMIS_COMMAND_TURRET_FIT_FAILED",
        data: {
          fittedTurretCount: index,
        },
      };
    }

    plannedItems = nextFit.data.plannedItems;
    latestResourceState = nextFit.data.resourceState;
  }

  const crystalTypes = getCompatibleLaserCrystalTypes(turretType.match.typeID);
  const missileTypes = getCompatibleLesmisHeavyMissileTypes(launcherType.match.typeID);
  if (missileTypes.length === 0) {
    return {
      success: false,
      errorMsg: "LESMIS_COMMAND_MISSILES_NOT_FOUND",
    };
  }

  const crystalVolume = crystalTypes.reduce(
    (sum, itemType) =>
      sum +
      ((Number(itemType && itemType.volume) || 0) * LASER_COMMAND_MIN_CRYSTALS_PER_TYPE),
    0,
  );
  const missileVolume = missileTypes.reduce(
    (sum, itemType) =>
      sum +
      ((Number(itemType && itemType.volume) || 0) * LESMIS_COMMAND_MISSILES_PER_TYPE),
    0,
  );
  const totalCargoVolume = crystalVolume + missileVolume;
  if (totalCargoVolume > latestResourceState.cargoCapacity + 1e-6) {
    return {
      success: false,
      errorMsg: "LESMIS_COMMAND_CARGO_TOO_SMALL",
      data: {
        requiredVolume: totalCargoVolume,
        cargoCapacity: latestResourceState.cargoCapacity,
      },
    };
  }

  return {
    success: true,
    data: {
      propulsionType: propulsionType.match,
      launcherType: launcherType.match,
      turretType: turretType.match,
      launcherCount: LESMIS_COMMAND_LAUNCHER_COUNT,
      turretCount: LESMIS_COMMAND_TURRET_COUNT,
      plannedItems,
      resourceState: latestResourceState,
      crystalTypes,
      missileTypes,
    },
  };
}

function fitGrantedItemTypeToShip(
  session,
  stationID,
  shipItem,
  itemType,
  count,
  chatHub,
  options,
) {
  const numericCount = normalizePositiveInteger(count, 1);
  let fittedCount = 0;
  let latestResourceState = null;

  for (let index = 0; index < numericCount; index += 1) {
    const fittedItems = listFittedItems(session.characterID, shipItem.itemID);
    const nextFit = tryPlanNextModuleFit(
      session.characterID,
      shipItem,
      itemType,
      fittedItems,
    );
    if (!nextFit.success) {
      break;
    }

    const moveResult = moveItemTypeFromCharacterLocation(
      session.characterID,
      stationID,
      ITEM_FLAGS.HANGAR,
      shipItem.itemID,
      nextFit.data.flagID,
      itemType.typeID,
      1,
    );
    if (!moveResult.success) {
      return {
        success: false,
        errorMsg: moveResult.errorMsg || "LASER_COMMAND_MOVE_FAILED",
      };
    }

    syncInventoryChangesToSession(session, moveResult.data && moveResult.data.changes);
    fittedCount += 1;
    latestResourceState = nextFit.data.resourceState;
  }

  return {
    success: true,
    data: {
      fittedCount,
      resourceState: latestResourceState,
    },
  };
}

function moveGrantedItemTypeToShipCargo(session, stationID, shipItem, itemType, quantity) {
  const moveResult = moveItemTypeFromCharacterLocation(
    session.characterID,
    stationID,
    ITEM_FLAGS.HANGAR,
    shipItem.itemID,
    ITEM_FLAGS.CARGO_HOLD,
    itemType.typeID,
    quantity,
  );
  if (!moveResult.success) {
    return moveResult;
  }

  syncInventoryChangesToSession(session, moveResult.data && moveResult.data.changes);
  return moveResult;
}

function boardStoredShipLikeHangarBoard(session, stationID, shipItem, options = {}) {
  const serviceManager = options && options.serviceManager;
  const shipService =
    serviceManager && typeof serviceManager.lookup === "function"
      ? serviceManager.lookup("ship")
      : null;

  if (shipService && typeof shipService.callMethod === "function") {
    shipService.callMethod(
      "BoardStoredShip",
      [stationID, shipItem.itemID],
      session,
      null,
    );

    const activeShip = getActiveShipRecord(session.characterID);
    return {
      success: Boolean(activeShip && Number(activeShip.itemID) === Number(shipItem.itemID)),
      activeShip,
      errorMsg:
        activeShip && Number(activeShip.itemID) === Number(shipItem.itemID)
          ? null
          : "BOARD_STORED_SHIP_FAILED",
    };
  }

  const activationResult = activateShipForSession(session, shipItem.itemID, {
    emitNotifications: true,
    logSelection: false,
  });
  return {
    success: activationResult.success === true,
    activeShip: activationResult.activeShip || getActiveShipRecord(session.characterID),
    errorMsg: activationResult.errorMsg || null,
  };
}

function handlePresetSingleRackCommand(session, chatHub, options, preset, commandName) {
  const slashCommand = `/${String(commandName || "").trim()}`;
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      `Select a character before using ${slashCommand}.`,
    );
  }

  const stationID = Number(getDockedLocationID(session) || 0);
  if (stationID <= 0) {
    return handledResult(
      chatHub,
      session,
      options,
      `You must be docked before using ${slashCommand}.`,
    );
  }

  const shipType = resolveShipByName(String(preset && preset.shipName || ""));
  if (!shipType || !shipType.success || !shipType.match) {
    return handledResult(
      chatHub,
      session,
      options,
      `Ship type not found for ${slashCommand}: ${String(preset && preset.shipName || "")}.`,
    );
  }

  const spawnResult = spawnShipInHangarForSession(session, shipType.match);
  if (!spawnResult.success || !spawnResult.ship) {
    return handledResult(
      chatHub,
      session,
      options,
      `Failed to spawn the ${slashCommand} hull in your station hangar.`,
    );
  }

  const shipItem = spawnResult.ship;
  const planResult = buildPresetSingleRackCommandPlan(session.characterID, shipItem, preset);
  if (!planResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Unable to build the ${slashCommand} fit: ${planResult.errorMsg}.`,
    );
  }

  const fitPlan = planResult.data;
  const grantEntries = [
    {
      itemType: fitPlan.propulsionType,
      quantity: 1,
    },
    {
      itemType: fitPlan.moduleType,
      quantity: fitPlan.moduleCount,
    },
    ...fitPlan.chargeTypes.map((itemType) => ({
      itemType,
      quantity: Number(preset && preset.chargeQuantity) || 0,
    })),
];
  const grantResult = grantStationHangarBatchAndSyncSession(
    session,
    stationID,
    grantEntries,
  );
  if (!grantResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Unable to seed the ${slashCommand} modules and ammo: ${grantResult.errorMsg || "WRITE_ERROR"}.`,
    );
  }

  const propulsionFitResult = fitGrantedItemTypeToShip(
    session,
    stationID,
    shipItem,
    fitPlan.propulsionType,
    1,
    chatHub,
    options,
  );
  if (!propulsionFitResult.success || propulsionFitResult.data.fittedCount !== 1) {
    return handledResult(
      chatHub,
      session,
      options,
      `The ${slashCommand} hull spawned, but the MWD fit failed: ${propulsionFitResult.errorMsg || "FIT_FAILED"}.`,
    );
  }

  const moduleFitResult = fitGrantedItemTypeToShip(
    session,
    stationID,
    shipItem,
    fitPlan.moduleType,
    fitPlan.moduleCount,
    chatHub,
    options,
  );
  if (!moduleFitResult.success || moduleFitResult.data.fittedCount !== fitPlan.moduleCount) {
    return handledResult(
      chatHub,
      session,
      options,
      `The ${slashCommand} hull spawned, but the ${String(preset && preset.moduleFailureLabel || "module")} fit failed: ${moduleFitResult.errorMsg || "FIT_FAILED"}.`,
    );
  }

  for (const chargeType of fitPlan.chargeTypes) {
    const cargoMoveResult = moveGrantedItemTypeToShipCargo(
      session,
      stationID,
      shipItem,
      chargeType,
      Number(preset && preset.chargeQuantity) || 0,
    );
    if (!cargoMoveResult.success) {
      return handledResult(
        chatHub,
        session,
        options,
        `The ${slashCommand} hull spawned, but cargo seeding failed on ${chargeType.name}: ${cargoMoveResult.errorMsg || "MOVE_FAILED"}.`,
      );
    }
  }

  const finalResourceState = buildShipResourceState(
    session.characterID,
    shipItem,
  );
  return handledResult(
    chatHub,
    session,
    options,
    [
      `${shipType.match.name} was added to your ship hangar as ship ${shipItem.itemID}.`,
      `Fitted 1x ${fitPlan.propulsionType.name} and ${moduleFitResult.data.fittedCount}x ${fitPlan.moduleType.name}.`,
      `Loaded cargo with ${(Number(preset && preset.chargeQuantity) || 0).toLocaleString("en-US")} of each ${String(preset && preset.chargeKindLabel || "compatible charge")} (${fitPlan.chargeTypes.length} types, ${(fitPlan.chargeTypes.length * (Number(preset && preset.chargeQuantity) || 0)).toLocaleString("en-US")} total ${String(preset && preset.totalChargeLabel || "charges")}).`,
      `Remaining fitting: ${(finalResourceState.cpuOutput - finalResourceState.cpuLoad).toFixed(2)} CPU, ${(finalResourceState.powerOutput - finalResourceState.powerLoad).toFixed(2)} PG.`,
    ].join(" "),
  );
}

function handleLesmisCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /lesmis.",
    );
  }

  const stationID = Number(getDockedLocationID(session) || 0);
  if (stationID <= 0) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be docked before using /lesmis.",
    );
  }

  const shipType = resolveShipByName(LESMIS_COMMAND_SHIP_NAME);
  if (!shipType || !shipType.success || !shipType.match) {
    return handledResult(
      chatHub,
      session,
      options,
      `Ship type not found for /lesmis: ${LESMIS_COMMAND_SHIP_NAME}.`,
    );
  }

  const spawnResult = spawnShipInHangarForSession(session, shipType.match);
  if (!spawnResult.success || !spawnResult.ship) {
    return handledResult(
      chatHub,
      session,
      options,
      "Failed to spawn the /lesmis hull in your station hangar.",
    );
  }

  const shipItem = spawnResult.ship;
  const planResult = buildLesmisCommandPlan(session.characterID, shipItem);
  if (!planResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Unable to build the /lesmis fit: ${planResult.errorMsg}.`,
    );
  }

  const fitPlan = planResult.data;
  const grantEntries = [
    {
      itemType: fitPlan.propulsionType,
      quantity: 1,
    },
    {
      itemType: fitPlan.launcherType,
      quantity: fitPlan.launcherCount,
    },
    {
      itemType: fitPlan.turretType,
      quantity: fitPlan.turretCount,
    },
    ...fitPlan.crystalTypes.map((itemType) => ({
      itemType,
      quantity: LASER_COMMAND_MIN_CRYSTALS_PER_TYPE,
    })),
    ...fitPlan.missileTypes.map((itemType) => ({
      itemType,
      quantity: LESMIS_COMMAND_MISSILES_PER_TYPE,
    })),
  ];

  const grantResult = grantStationHangarBatchAndSyncSession(
    session,
    stationID,
    grantEntries,
  );
  if (!grantResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Unable to seed the /lesmis fit and ammo: ${grantResult.errorMsg || "WRITE_ERROR"}.`,
    );
  }

  const propulsionFitResult = fitGrantedItemTypeToShip(
    session,
    stationID,
    shipItem,
    fitPlan.propulsionType,
    1,
    chatHub,
    options,
  );
  if (!propulsionFitResult.success || propulsionFitResult.data.fittedCount !== 1) {
    return handledResult(
      chatHub,
      session,
      options,
      `The /lesmis hull spawned, but the MWD fit failed: ${propulsionFitResult.errorMsg || "FIT_FAILED"}.`,
    );
  }

  const launcherFitResult = fitGrantedItemTypeToShip(
    session,
    stationID,
    shipItem,
    fitPlan.launcherType,
    fitPlan.launcherCount,
    chatHub,
    options,
  );
  if (
    !launcherFitResult.success ||
    launcherFitResult.data.fittedCount !== fitPlan.launcherCount
  ) {
    return handledResult(
      chatHub,
      session,
      options,
      `The /lesmis hull spawned, but the launcher fit failed: ${launcherFitResult.errorMsg || "FIT_FAILED"}.`,
    );
  }

  const turretFitResult = fitGrantedItemTypeToShip(
    session,
    stationID,
    shipItem,
    fitPlan.turretType,
    fitPlan.turretCount,
    chatHub,
    options,
  );
  if (!turretFitResult.success || turretFitResult.data.fittedCount !== fitPlan.turretCount) {
    return handledResult(
      chatHub,
      session,
      options,
      `The /lesmis hull spawned, but the turret fit failed: ${turretFitResult.errorMsg || "FIT_FAILED"}.`,
    );
  }

  for (const crystalType of fitPlan.crystalTypes) {
    const cargoMoveResult = moveGrantedItemTypeToShipCargo(
      session,
      stationID,
      shipItem,
      crystalType,
      LASER_COMMAND_MIN_CRYSTALS_PER_TYPE,
    );
    if (!cargoMoveResult.success) {
      return handledResult(
        chatHub,
        session,
        options,
        `The /lesmis hull spawned, but laser crystal cargo seeding failed on ${crystalType.name}: ${cargoMoveResult.errorMsg || "MOVE_FAILED"}.`,
      );
    }
  }

  for (const missileType of fitPlan.missileTypes) {
    const cargoMoveResult = moveGrantedItemTypeToShipCargo(
      session,
      stationID,
      shipItem,
      missileType,
      LESMIS_COMMAND_MISSILES_PER_TYPE,
    );
    if (!cargoMoveResult.success) {
      return handledResult(
        chatHub,
        session,
        options,
        `The /lesmis hull spawned, but missile cargo seeding failed on ${missileType.name}: ${cargoMoveResult.errorMsg || "MOVE_FAILED"}.`,
      );
    }
  }

  const activationResult = boardStoredShipLikeHangarBoard(
    session,
    stationID,
    shipItem,
    options,
  );
  if (!activationResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `The /lesmis ship was spawned and fitted, but boarding it failed: ${activationResult.errorMsg || "BOARD_FAILED"}.`,
    );
  }

  const finalResourceState = buildShipResourceState(
    session.characterID,
    shipItem,
  );
  return handledResult(
    chatHub,
    session,
    options,
    [
      `${shipType.match.name} was added to your ship hangar as ship ${shipItem.itemID}.`,
      `Fitted 1x ${fitPlan.propulsionType.name}, ${launcherFitResult.data.fittedCount}x ${fitPlan.launcherType.name}, and ${turretFitResult.data.fittedCount}x ${fitPlan.turretType.name}.`,
      `Loaded cargo with ${LASER_COMMAND_MIN_CRYSTALS_PER_TYPE} of each compatible L crystal and ${LESMIS_COMMAND_MISSILES_PER_TYPE.toLocaleString("en-US")} of each compatible T1/T2 heavy missile type (${fitPlan.missileTypes.length} missile types).`,
      `Boarded your client into the new Typhoon in station.`,
      `Remaining fitting: ${(finalResourceState.cpuOutput - finalResourceState.cpuLoad).toFixed(2)} CPU, ${(finalResourceState.powerOutput - finalResourceState.powerLoad).toFixed(2)} PG.`,
    ].join(" "),
  );
}

function refreshAffiliationSessions(characterIDs) {
  const targetCharacterIDs = new Set(
    (Array.isArray(characterIDs) ? characterIDs : [])
      .map((characterID) => normalizePositiveInteger(characterID))
      .filter(Boolean),
  );

  if (targetCharacterIDs.size === 0) {
    return;
  }

  for (const targetSession of sessionRegistry.getSessions()) {
    const characterID = normalizePositiveInteger(
      targetSession && (targetSession.characterID || targetSession.charid),
    );
    if (!characterID || !targetCharacterIDs.has(characterID)) {
      continue;
    }

    applyCharacterToSession(targetSession, characterID, {
      selectionEvent: false,
      emitNotifications: true,
      logSelection: false,
    });
  }
}

function reconcileSolarTargetSessionIdentity(session, solarSystem) {
  if (
    !session ||
    !solarSystem ||
    typeof session.sendSessionChange !== "function"
  ) {
    return false;
  }

  const targetSolarSystemID =
    normalizePositiveInteger(solarSystem.solarSystemID) || null;
  const targetConstellationID =
    normalizePositiveInteger(solarSystem.constellationID) || null;
  const targetRegionID =
    normalizePositiveInteger(solarSystem.regionID) || null;

  if (!targetSolarSystemID) {
    return false;
  }

  const sessionChanges = {};
  const applyChange = (key, nextValue, aliases) => {
    const previousValue = normalizePositiveInteger(
      aliases.map((alias) => session[alias]).find((value) => value !== undefined),
    );
    const normalizedNextValue = normalizePositiveInteger(nextValue);
    if (previousValue === normalizedNextValue) {
      return;
    }

    for (const alias of aliases) {
      session[alias] = normalizedNextValue;
    }
    sessionChanges[key] = [previousValue, normalizedNextValue];
  };

  applyChange("solarsystemid2", targetSolarSystemID, ["solarsystemid2"]);
  applyChange("solarsystemid", targetSolarSystemID, ["solarsystemid"]);
  applyChange("locationid", targetSolarSystemID, ["locationid"]);

  if (targetConstellationID) {
    applyChange("constellationid", targetConstellationID, [
      "constellationid",
      "constellationID",
    ]);
  }

  if (targetRegionID) {
    applyChange("regionid", targetRegionID, [
      "regionid",
      "regionID",
    ]);
  }

  if (Object.keys(sessionChanges).length === 0) {
    return false;
  }

  session.sendSessionChange(sessionChanges);
  return true;
}

function getWalletSummary(session) {
  const wallet = session && session.characterID
    ? getCharacterWallet(session.characterID)
    : null;
  if (!wallet) {
    return null;
  }

  const deltaText =
    wallet.balanceChange === 0
      ? "0.00 ISK"
      : `${wallet.balanceChange > 0 ? "+" : ""}${formatIsk(wallet.balanceChange)}`;
  const evermarks = getCharacterWalletLPBalance(
    session.characterID,
    EVERMARK_ISSUER_CORP_ID,
  );

  return `Wallet balance: ${formatIsk(wallet.balance)}. PLEX: ${formatPlex(wallet.plexBalance)}. EverMarks: ${formatEvermarks(evermarks)}. Last ISK change: ${deltaText}.`;
}

function getLocationSummary(session) {
  if (!session || !session.characterID) {
    return "No character selected.";
  }

  const dockedLocationID = getDockedLocationID(session);
  if (dockedLocationID) {
    const kind = getDockedLocationKind(session);
    return `Docked in ${kind} ${dockedLocationID}, solar system ${session.solarsystemid2 || session.solarsystemid || "unknown"}.`;
  }

  if (session.solarsystemid2 || session.solarsystemid) {
    return `In space in solar system ${session.solarsystemid2 || session.solarsystemid}.`;
  }

  return "Current location is unknown.";
}

function getActiveSolarSystemID(session) {
  return normalizePositiveInteger(
    session &&
      (
        (session._space && session._space.systemID) ||
        session.solarsystemid2 ||
        session.solarsystemid
      ),
  );
}

function formatSolarSystemLabel(systemID) {
  const system = worldData.getSolarSystemByID(systemID);
  return system && system.solarSystemName
    ? `${system.solarSystemName}(${systemID})`
    : String(systemID || 0);
}

function formatSolarSystemList(systemIDs) {
  const uniqueIDs = [...new Set((Array.isArray(systemIDs) ? systemIDs : []).filter(Boolean))];
  return uniqueIDs.length > 0
    ? uniqueIDs.map((systemID) => formatSolarSystemLabel(systemID)).join(", ")
    : "none";
}

function formatTimeDilationFactor(value) {
  const factor = Number.isFinite(Number(value)) ? Number(value) : 1;
  return `${factor.toFixed(3)} (${Math.round(factor * 1000) / 10}%)`;
}

function formatConnectedCharacterLocation(session) {
  const currentSystemID = getSessionCurrentSolarSystemID(session);
  const currentSystem = worldData.getSolarSystemByID(currentSystemID);
  const systemLabel =
    (currentSystem && currentSystem.solarSystemName) ||
    (currentSystemID ? `system ${currentSystemID}` : "unknown system");

  const dockedLocationID = getSessionDockedStationID(session);
  if (!dockedLocationID) {
    return systemLabel;
  }

  const station = worldData.getStationByID(dockedLocationID);
  const structure = station ? null : worldData.getStructureByID(dockedLocationID);
  const dockedLocationLabel =
    (station && station.stationName) ||
    (structure && (structure.itemName || structure.name)) ||
    `${getDockedLocationKind(session)} ${dockedLocationID}`;

  return `${systemLabel} | Docked: ${dockedLocationLabel}`;
}

function getConnectedCharacterSummary() {
  const preferredSessionsByCharacterID = new Map();
  for (const session of sessionRegistry.getSessions()) {
    const characterID = Number(session && (session.characterID || session.charID || session.charid || 0));
    if (!Number.isInteger(characterID) || characterID <= 0) {
      continue;
    }

    const current = preferredSessionsByCharacterID.get(characterID) || null;
    if (sessionRegistry.isPreferredCharacterSession(session, current)) {
      preferredSessionsByCharacterID.set(characterID, session);
    }
  }

  const connected = Array.from(preferredSessionsByCharacterID.values())
    .sort((left, right) => {
      const leftName = String(left.characterName || left.userName || "Unknown").toLowerCase();
      const rightName = String(right.characterName || right.userName || "Unknown").toLowerCase();
      if (leftName !== rightName) {
        return leftName.localeCompare(rightName);
      }
      return Number(left.characterID || 0) - Number(right.characterID || 0);
    })
    .map((session) => {
      const characterName = session.characterName || session.userName || "Unknown";
      const characterID = Number(session.characterID || session.charID || session.charid || 0) || 0;
      return `${characterName}(${characterID}) - ${formatConnectedCharacterLocation(session)}`;
    });

  if (connected.length === 0) {
    return "No active characters are connected.";
  }

  return `Connected characters (${connected.length}):\n${connected.join("\n")}`;
}

function getSessionSummary(session) {
  if (!session || !session.characterID) {
    return "No active character session.";
  }

  return [
    `char=${session.characterName || "Unknown"}(${session.characterID})`,
    `ship=${session.shipName || "Ship"}(${session.shipID || session.shipid || 0})`,
    `corp=${session.corporationID || 0}`,
    `${getDockedLocationKind(session)}=${getDockedLocationID(session) || 0}`,
    `system=${session.solarsystemid2 || session.solarsystemid || 0}`,
    `wallet=${formatIsk(session.balance || 0)}`,
  ].join(" | ");
}

function getHangarSummary(session) {
  if (!session || !session.characterID) {
    return "No active character session.";
  }

  const stationId = getDockedLocationID(session);
  if (!stationId) {
    return "You must be docked to inspect the ship hangar.";
  }

  const activeShip = getActiveShipRecord(session.characterID);
  const hangarShips = getCharacterHangarShipItems(session.characterID, stationId);
  const shipSummary = hangarShips
    .map((ship) => `${ship.itemName}(${ship.itemID})`)
    .join(", ");

  return [
    `Active ship: ${activeShip ? `${activeShip.itemName}(${activeShip.itemID})` : "none"}.`,
    `Hangar ships (${hangarShips.length}): ${shipSummary || "none"}.`,
  ].join(" ");
}

function getItemSummary(argumentText) {
  const itemID = Number(argumentText);
  if (!Number.isInteger(itemID) || itemID <= 0) {
    return "Usage: /item <itemID>";
  }

  const item = getAllItems()[String(itemID)];
  if (!item) {
    return `Item not found: ${itemID}.`;
  }

  return [
    `Item ${item.itemID}: ${item.itemName || "Unknown"}`,
    `type=${item.typeID}`,
    `owner=${item.ownerID}`,
    `location=${item.locationID}`,
    `flag=${item.flagID}`,
    `singleton=${item.singleton}`,
    `quantity=${item.quantity}`,
  ].join(" | ");
}

function sendAnnouncement(chatHub, session, message) {
  if (!message) {
    return;
  }

  for (const targetSession of sessionRegistry.getSessions()) {
    if (chatHub) {
      chatHub.sendSystemMessage(targetSession, message);
    }
  }
}

function handleShipSpawn(commandLabel, session, argumentText, chatHub, options) {
  if (!argumentText) {
    return handledResult(
      chatHub,
      session,
      options,
      `Usage: /${commandLabel} <ship name|typeID>`,
    );
  }

  const shipLookup = resolveShipByName(argumentText);
  if (!shipLookup.success) {
    const message =
      shipLookup.errorMsg === "SHIP_NOT_FOUND"
        ? `Ship not found: ${argumentText}.${formatSuggestions(shipLookup.suggestions)}`
        : `Ship name is ambiguous: ${argumentText}.${formatSuggestions(shipLookup.suggestions)}`;
    return handledResult(chatHub, session, options, message.trim());
  }

  const spawnResult = spawnShipInHangarForSession(session, shipLookup.match);
  if (!spawnResult.success) {
    let message = "Ship spawn failed.";
    if (spawnResult.errorMsg === "DOCK_REQUIRED") {
      message = "You must be docked before spawning ships into your hangar.";
    } else if (spawnResult.errorMsg === "CHARACTER_NOT_SELECTED") {
      message = "Select a character before spawning ships.";
    }
    return handledResult(chatHub, session, options, message);
  }

  return handledResult(
    chatHub,
    session,
    options,
    `${shipLookup.match.name}${shipLookup.match.published === false ? " [unpublished]" : ""} was added to your ship hangar. /${commandLabel} only spawns the hull for now; board it manually from the hangar.`,
  );
}

function handleGiveItemCommand(session, argumentText, chatHub, options) {
  const trimmedArgument = String(argumentText || "").trim();
  if (!trimmedArgument) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /giveitem <item name|typeID> [amount]",
    );
  }

  let itemLookup = resolveItemByName(trimmedArgument);
  let normalizedAmount = 1;

  if (!itemLookup.success) {
    const splitLookup = splitTrailingAmount(trimmedArgument);
    if (splitLookup.lookupText && splitLookup.amount !== null) {
      const splitMatch = resolveItemByName(splitLookup.lookupText);
      if (splitMatch.success) {
        itemLookup = splitMatch;
        normalizedAmount = normalizePositiveInteger(Math.trunc(splitLookup.amount));
      }
    }
  }

  if (!normalizedAmount) {
    return handledResult(
      chatHub,
      session,
      options,
      "Item amount must be a positive whole number.",
    );
  }

  if (!Number.isSafeInteger(normalizedAmount)) {
    return handledResult(
      chatHub,
      session,
      options,
      "Item amount is too large. Use a positive whole number up to 9,007,199,254,740,991.",
    );
  }

  if (!itemLookup.success) {
    const message =
      itemLookup.errorMsg === "ITEM_NOT_FOUND"
        ? `Item not found: ${trimmedArgument}.${formatSuggestions(itemLookup.suggestions)}`
        : `Item name is ambiguous: ${trimmedArgument}.${formatSuggestions(itemLookup.suggestions)}`;
    return handledResult(chatHub, session, options, message.trim());
  }

  const giveResult = giveItemToHangarForSession(
    session,
    itemLookup.match,
    normalizedAmount,
  );
  if (!giveResult.success) {
    let message = "Item grant failed.";
    if (giveResult.errorMsg === "DOCK_REQUIRED") {
      message = "You must be docked before using /giveitem.";
    } else if (giveResult.errorMsg === "CHARACTER_NOT_SELECTED") {
      message = "Select a character before using /giveitem.";
    } else if (giveResult.errorMsg === "ITEM_TYPE_NOT_FOUND") {
      message = `Item type not found: ${trimmedArgument}.`;
    } else if (giveResult.errorMsg === "ITEM_QUANTITY_OUT_OF_RANGE") {
      message =
        "Item amount is too large for a safe inventory operation. Use a positive whole number up to 9,007,199,254,740,991.";
    }
    return handledResult(chatHub, session, options, message);
  }

  const changedItems = Array.isArray(giveResult.data.items) ? giveResult.data.items : [];
  const stackMode =
    changedItems.length === 1 && Number(changedItems[0].singleton || 0) === 0;
  const summary = stackMode
    ? `${normalizedAmount.toLocaleString("en-US")}x ${itemLookup.match.name}`
    : `${itemLookup.match.name} x${normalizedAmount.toLocaleString("en-US")}`;
  const splitNote =
    giveResult.data &&
    giveResult.data.stackSplitApplied === true &&
    changedItems.length > 1
      ? ` Split across ${changedItems.length.toLocaleString("en-US")} client-safe stacks to respect the inventory wire limit.`
      : "";

  return handledResult(
    chatHub,
    session,
    options,
    `${summary}${itemLookup.match.published === false ? " [unpublished]" : ""} was added to your station hangar.${splitNote}`,
  );
}

function handleCreateItemCommand(session, argumentText, chatHub, options, commandName = "createitem") {
  const slashCommand = `/${String(commandName || "createitem").trim() || "createitem"}`;
  const trimmedArgument = String(argumentText || "").trim();
  if (!trimmedArgument) {
    return handledResult(
      chatHub,
      session,
      options,
      `Usage: ${slashCommand} <item name|typeID> [amount]`,
    );
  }

  let itemLookup = resolveItemByName(trimmedArgument);
  let normalizedAmount = 1;

  if (!itemLookup.success) {
    const splitLookup = splitTrailingAmount(trimmedArgument);
    if (splitLookup.lookupText && splitLookup.amount !== null) {
      const splitMatch = resolveItemByName(splitLookup.lookupText);
      if (splitMatch.success) {
        itemLookup = splitMatch;
        normalizedAmount = normalizePositiveInteger(Math.trunc(splitLookup.amount));
      }
    }
  }

  if (!normalizedAmount) {
    return handledResult(
      chatHub,
      session,
      options,
      "Item amount must be a positive whole number.",
    );
  }

  if (!Number.isSafeInteger(normalizedAmount)) {
    return handledResult(
      chatHub,
      session,
      options,
      "Item amount is too large. Use a positive whole number up to 9,007,199,254,740,991.",
    );
  }

  if (!itemLookup.success) {
    const message =
      itemLookup.errorMsg === "ITEM_NOT_FOUND"
        ? `Item not found: ${trimmedArgument}.${formatSuggestions(itemLookup.suggestions)}`
        : `Item name is ambiguous: ${trimmedArgument}.${formatSuggestions(itemLookup.suggestions)}`;
    return handledResult(chatHub, session, options, message.trim());
  }

  const giveResult = giveItemToHangarForSession(
    session,
    itemLookup.match,
    normalizedAmount,
  );
  if (!giveResult.success) {
    let message = "Item creation failed.";
    if (giveResult.errorMsg === "DOCK_REQUIRED") {
      message = `You must be docked before using ${slashCommand}.`;
    } else if (giveResult.errorMsg === "CHARACTER_NOT_SELECTED") {
      message = `Select a character before using ${slashCommand}.`;
    } else if (giveResult.errorMsg === "ITEM_TYPE_NOT_FOUND") {
      message = `Item type not found: ${trimmedArgument}.`;
    } else if (giveResult.errorMsg === "ITEM_QUANTITY_OUT_OF_RANGE") {
      message =
        "Item amount is too large for a safe inventory operation. Use a positive whole number up to 9,007,199,254,740,991.";
    }
    return handledResult(chatHub, session, options, message);
  }

  const changedItems = Array.isArray(giveResult.data.items) ? giveResult.data.items : [];
  const firstItemID = Number(changedItems[0] && changedItems[0].itemID) || 0;
  if (!firstItemID) {
    return handledResult(chatHub, session, options, "Item creation failed.");
  }

  return {
    handled: true,
    message: firstItemID,
  };
}

function handleMineralsCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /minerals.",
    );
  }

  const stationID = Number(getDockedLocationID(session) || 0) || 0;
  if (stationID <= 0) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be docked before using /minerals.",
    );
  }

  const plan = getMineralsSeedPlan();
  if (!plan.entries.length) {
    return handledResult(
      chatHub,
      session,
      options,
      "No published mineral or ore types matched the /minerals filter in local reference data.",
    );
  }

  const existingItemIDs = listOwnedItems(Number(session.characterID) || 0, {
    locationID: stationID,
    flagID: ITEM_FLAGS.HANGAR,
  })
    .filter((item) => plan.allTypeIDs.has(Number(item && item.typeID) || 0))
    .map((item) => Number(item && item.itemID) || 0)
    .filter((itemID) => itemID > 0);

  const clearResult = removeStationHangarBatchAndSyncSession(
    session,
    stationID,
    existingItemIDs,
  );
  if (!clearResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Mineral and ore reset failed while clearing existing test stocks.",
    );
  }

  const grantResult = grantStationHangarBatchAndSyncSession(
    session,
    stationID,
    plan.entries,
  );
  if (!grantResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Mineral and ore grant failed.",
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    [
      `Re-seeded ${plan.mineralTypes.length.toLocaleString("en-US")} mineral stacks and ${plan.oreTypes.length.toLocaleString("en-US")} ore stacks in your station hangar.`,
      `Each stack now uses ${MINERALS_SEED_QUANTITY.toLocaleString("en-US")} units so the retail reprocessing UI stays stable.`,
      "Existing mineral/ore test stocks in the current station hangar were replaced. Includes published raw/compressed ore families and excludes ice plus decorative/non-interactable asteroid rows.",
    ].join(" "),
  );
}

function handleSpawnContainerCommand(session, argumentText, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /spawncontainer.",
    );
  }

  const containerLookup = resolveSpaceItemType(
    argumentText,
    DEFAULT_SPACE_CONTAINER_NAME,
    isContainerType,
    "CONTAINER",
  );
  if (!containerLookup.success) {
    const message =
      containerLookup.errorMsg === "ITEM_NOT_FOUND"
        ? `Container type not found: ${String(argumentText || "").trim() || DEFAULT_SPACE_CONTAINER_NAME}.${formatSuggestions(containerLookup.suggestions)}`
        : containerLookup.errorMsg === "ITEM_NAME_AMBIGUOUS"
          ? `Container type is ambiguous: ${argumentText}.${formatSuggestions(containerLookup.suggestions)}`
          : `Type must resolve to a container item.${formatSuggestions(containerLookup.suggestions)}`;
    return handledResult(chatHub, session, options, message.trim());
  }

  const shipEntity = spaceRuntime.getEntity(session, session._space.shipID);
  const createResult = createSpaceItemForCharacter(
    session.characterID,
    session._space.systemID,
    containerLookup.match,
    buildNearbySpaceSpawnState(shipEntity),
  );
  if (!createResult.success || !createResult.data) {
    return handledResult(chatHub, session, options, "Container spawn failed.");
  }

  syncInventoryChangesToSession(session, createResult.changes || []);
  const spawnResult = spaceRuntime.spawnDynamicInventoryEntity(
    session._space.systemID,
    createResult.data.itemID,
  );
  if (!spawnResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Container item was created, but the space ball failed to spawn.",
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Spawned ${containerLookup.match.name} (${createResult.data.itemID}) in space.`,
  );
}

function handleSpawnWreckCommand(session, argumentText, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /spawnwreck.",
    );
  }

  const wreckLookup = resolveSpaceItemType(
    argumentText,
    DEFAULT_SPACE_WRECK_NAME,
    isWreckType,
    "WRECK",
  );
  if (!wreckLookup.success) {
    const message =
      wreckLookup.errorMsg === "ITEM_NOT_FOUND"
        ? `Wreck type not found: ${String(argumentText || "").trim() || DEFAULT_SPACE_WRECK_NAME}.${formatSuggestions(wreckLookup.suggestions)}`
        : wreckLookup.errorMsg === "ITEM_NAME_AMBIGUOUS"
          ? `Wreck type is ambiguous: ${argumentText}.${formatSuggestions(wreckLookup.suggestions)}`
          : `Type must resolve to a wreck item.${formatSuggestions(wreckLookup.suggestions)}`;
    return handledResult(chatHub, session, options, message.trim());
  }

  const shipEntity = spaceRuntime.getEntity(session, session._space.shipID);
  const createResult = createSpaceItemForCharacter(
    session.characterID,
    session._space.systemID,
    wreckLookup.match,
    {
      ...buildNearbySpaceSpawnState(shipEntity, 300),
      spaceRadius: resolveRuntimeWreckRadius(wreckLookup.match),
    },
  );
  if (!createResult.success || !createResult.data) {
    return handledResult(chatHub, session, options, "Wreck spawn failed.");
  }

  syncInventoryChangesToSession(session, createResult.changes || []);
  const spawnResult = spaceRuntime.spawnDynamicInventoryEntity(
    session._space.systemID,
    createResult.data.itemID,
  );
  if (!spawnResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Wreck item was created, but the space ball failed to spawn.",
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Spawned ${wreckLookup.match.name} (${createResult.data.itemID}) in space.`,
  );
}

function handleJetcanCommand(session, argumentText, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /jetcan.",
    );
  }

  const trimmedArgument = String(argumentText || "").trim();
  if (!trimmedArgument) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /jetcan <item name|typeID> [amount]",
    );
  }

  let itemLookup = resolveItemByName(trimmedArgument);
  let normalizedAmount = 1;
  if (!itemLookup.success) {
    const splitLookup = splitTrailingAmount(trimmedArgument);
    if (splitLookup.lookupText && splitLookup.amount !== null) {
      const splitMatch = resolveItemByName(splitLookup.lookupText);
      if (splitMatch.success) {
        itemLookup = splitMatch;
        normalizedAmount = normalizePositiveInteger(Math.trunc(splitLookup.amount));
      }
    }
  }

  if (!normalizedAmount) {
    return handledResult(
      chatHub,
      session,
      options,
      "Jetcan amount must be a positive whole number.",
    );
  }

  if (!itemLookup.success) {
    const message =
      itemLookup.errorMsg === "ITEM_NOT_FOUND"
        ? `Item not found: ${trimmedArgument}.${formatSuggestions(itemLookup.suggestions)}`
        : `Item name is ambiguous: ${trimmedArgument}.${formatSuggestions(itemLookup.suggestions)}`;
    return handledResult(chatHub, session, options, message.trim());
  }

  const shipID = Number(session._space.shipID || 0) || 0;
  const cargoItems = listContainerItems(
    session.characterID,
    shipID,
    ITEM_FLAGS.CARGO_HOLD,
  ).filter((item) => Number(item.typeID) === Number(itemLookup.match.typeID));
  const availableQuantity = cargoItems.reduce((sum, item) => (
    sum + (Number(item.singleton) === 1 ? 1 : Math.max(0, Number(item.stacksize || item.quantity || 0)))
  ), 0);
  if (availableQuantity < normalizedAmount) {
    return handledResult(
      chatHub,
      session,
      options,
      `Not enough ${itemLookup.match.name} in cargo. Available: ${availableQuantity.toLocaleString("en-US")}.`,
    );
  }

  const containerLookup = resolveSpaceItemType(
    DEFAULT_SPACE_CONTAINER_NAME,
    DEFAULT_SPACE_CONTAINER_NAME,
    isContainerType,
    "CONTAINER",
  );
  if (!containerLookup.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Default jetcan container type could not be resolved.",
    );
  }

  const shipEntity = spaceRuntime.getEntity(session, shipID);
  // CCP parity: jetcans last exactly 2 hours from creation, regardless of
  // whether items are added or removed.  Empty cans persist until the timer
  // expires -- there is no early despawn on empty.
  const createResult = createSpaceItemForCharacter(
    session.characterID,
    session._space.systemID,
    containerLookup.match,
    {
      ...buildNearbySpaceSpawnState(shipEntity, 275),
      createdAtMs: spaceRuntime.getSimulationTimeMsForSession(session),
      expiresAtMs: spaceRuntime.getSimulationTimeMsForSession(session) + JETCAN_LIFETIME_MS,
    },
  );
  if (!createResult.success || !createResult.data) {
    return handledResult(chatHub, session, options, "Jetcan creation failed.");
  }

  const moveResult = moveItemTypeFromCharacterLocation(
    session.characterID,
    shipID,
    ITEM_FLAGS.CARGO_HOLD,
    createResult.data.itemID,
    ITEM_FLAGS.HANGAR,
    itemLookup.match.typeID,
    normalizedAmount,
  );
  if (!moveResult.success) {
    return handledResult(chatHub, session, options, "Jetcan item move failed.");
  }

  syncInventoryChangesToSession(session, createResult.changes || []);
  syncInventoryChangesToSession(session, (moveResult.data && moveResult.data.changes) || []);
  const spawnResult = spaceRuntime.spawnDynamicInventoryEntity(
    session._space.systemID,
    createResult.data.itemID,
  );
  if (!spawnResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Jetcan contents moved, but the space ball failed to spawn.",
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Jettisoned ${normalizedAmount.toLocaleString("en-US")}x ${itemLookup.match.name} into ${containerLookup.match.name} (${createResult.data.itemID}). Expires in 2 hours.`,
  );
}

function handleDebrisFieldCommand(session, argumentText, chatHub, options, kind) {
  // /wreck list  or  /container list  →  show all valid types with name + typeID
  if (String(argumentText || "").trim().toLowerCase() === "list") {
    const label = kind === "wreck" ? "Wreck" : "Container";
    const types = listAvailableDebrisTypes(kind);
    if (types.length === 0) {
      return handledResult(chatHub, session, options, `No ${label.toLowerCase()} types found.`);
    }
    const lines = types.map((t) => `  ${t.name}  (typeID ${t.typeID})`);
    return handledResult(
      chatHub,
      session,
      options,
      `Available ${label.toLowerCase()} types (${types.length}):\n${lines.join("\n")}\n\nUsage: /${kind} <name|typeID> [count]`,
    );
  }

  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      `You must be in space before using /${kind}.`,
    );
  }

  const parsed = parseOptionalTypeAndCount(argumentText);
  if (
    argumentText &&
    String(argumentText).trim() &&
    /\s+\d+\s*$/.test(String(argumentText)) &&
    !parsed.count
  ) {
    return handledResult(
      chatHub,
      session,
      options,
      "Count must be a positive whole number.",
    );
  }

  if (parsed.typeName) {
    const typeLookup = resolveDebrisType(kind, parsed.typeName);
    if (!typeLookup.success) {
      const label = kind === "wreck" ? "Wreck" : "Container";
      const message =
        typeLookup.errorMsg === "ITEM_NOT_FOUND"
          ? `${label} type not found: ${parsed.typeName}.${formatSuggestions(typeLookup.suggestions)}`
          : `${label} type is ambiguous: ${parsed.typeName}.${formatSuggestions(typeLookup.suggestions)}`;
      return handledResult(chatHub, session, options, message.trim());
    }
  }

  const spawnResult = spawnDebrisFieldForSession(session, kind, {
    typeName: parsed.typeName,
    count: parsed.count,
  });
  if (!spawnResult.success) {
    const message =
      spawnResult.errorMsg === "SPACE_REQUIRED"
        ? `You must be in space before using /${kind}.`
        : "Debris spawn failed.";
    return handledResult(chatHub, session, options, message);
  }

  syncSpaceRootInventoryChangesToSession(
    session,
    spawnResult.data && spawnResult.data.changes,
  );

  const requestedCount = Number(spawnResult.data && spawnResult.data.requestedCount) || 0;
  const actualCount = Number(spawnResult.data && spawnResult.data.actualCount) || 0;
  const lifetimeHours = Math.round((getSpaceDebrisLifetimeMs() / 3600000) * 10) / 10;
  const sample = ((spawnResult.data && spawnResult.data.created) || [])
    .slice(0, 3)
    .map((entry) => `${entry.typeName}(${entry.item.itemID})`)
    .join(", ");

  return handledResult(
    chatHub,
    session,
    options,
    [
      `Spawned ${actualCount}/${requestedCount} ${kind}${actualCount === 1 ? "" : "s"} within 20 km.`,
      sample ? `Sample: ${sample}.` : null,
      `Lifetime: ${lifetimeHours}h.`,
    ].filter(Boolean).join(" "),
  );
}

function handleTestClearCommand(session, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /testclear.",
    );
  }

  const clearResult = clearNearbyDebrisForSession(session);
  if (!clearResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Clearing nearby debris failed.",
    );
  }

  syncSpaceRootInventoryChangesToSession(
    session,
    clearResult.data && clearResult.data.changes,
  );

  return handledResult(
    chatHub,
    session,
    options,
    `Cleared ${Number((clearResult.data && clearResult.data.removed || []).length) || 0} wrecks/containers within 20 km.`,
  );
}

function handleSystemJunkClearCommand(session, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /sysjunkclear.",
    );
  }

  const clearResult = clearSystemDebrisForSession(session);
  if (!clearResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Clearing system debris failed.",
    );
  }

  syncSpaceRootInventoryChangesToSession(
    session,
    clearResult.data && clearResult.data.changes,
  );

  return handledResult(
    chatHub,
    session,
    options,
    `Cleared ${Number((clearResult.data && clearResult.data.removed || []).length) || 0} wrecks/containers across the current solar system.`,
  );
}

function handleSuicideCommand(session, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /suicide.",
    );
  }

  const destroyResult = destroySessionShip(session, {
    sessionChangeReason: "selfdestruct",
  });
  if (!destroyResult.success || !destroyResult.data) {
    return handledResult(
      chatHub,
      session,
      options,
      destroyResult.errorMsg === "ALREADY_IN_CAPSULE"
        ? "You are already in a capsule."
        : "Ship self-destruction failed.",
    );
  }

  syncInventoryChangesToSession(session, destroyResult.data.wreckChanges || []);
  syncInventoryChangesToSession(session, destroyResult.data.movedChanges || []);
  syncInventoryChangesToSession(session, destroyResult.data.destroyChanges || []);

  return handledResult(
    chatHub,
    session,
    options,
    [
      `Self-destructed ship ${destroyResult.data.destroyedShipID}.`,
      `Wreck: ${destroyResult.data.wreck.itemName} (${destroyResult.data.wreck.itemID}).`,
      `Capsule: ${destroyResult.data.capsule.itemName} (${destroyResult.data.capsule.itemID}).`,
    ].join(" "),
  );
}

function handleDeathTestCommand(session, argumentText, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /deathtest.",
    );
  }

  const parsed = parseOptionalTypeAndCount(argumentText);
  let shipType = null;
  if (parsed.typeName) {
    const lookup = resolveShipByName(parsed.typeName);
    if (!lookup.success || !lookup.match) {
      const message =
        lookup.errorMsg === "SHIP_NOT_FOUND"
          ? `Ship type not found: ${parsed.typeName}.${formatSuggestions(lookup.suggestions)}`
          : `Ship type is ambiguous: ${parsed.typeName}.${formatSuggestions(lookup.suggestions)}`;
      return handledResult(chatHub, session, options, message.trim());
    }
    shipType = lookup.match;
  } else {
    shipType = resolveShipByTypeID(session.shipTypeID || (session._space && session._space.shipTypeID));
    if (!shipType) {
      const activeShip = getActiveShipRecord(session.characterID);
      shipType = activeShip ? resolveShipByTypeID(activeShip.typeID) : null;
    }
  }

  const spawnResult = spawnShipDeathTestField(session, {
    shipType,
    count: parsed.count,
  });
  if (!spawnResult.success || !spawnResult.data) {
    return handledResult(
      chatHub,
      session,
      options,
      "Death-test hull spawning failed.",
    );
  }

  if (spawnResult.data.completionPromise && chatHub) {
    const feedbackChannel = getFeedbackChannel(options);
    spawnResult.data.completionPromise
      .then((result) => {
        if (!result || !session || !session.characterID) {
          return;
        }
        chatHub.sendSystemMessage(
          session,
          `Detonated ${result.destroyed.length}/${result.spawnedCount} ${result.shipType.name} hulls into wrecks.`,
          feedbackChannel,
        );
      })
      .catch((error) => {
        log.warn(`[ChatCommands] /deathtest completion failed: ${error.message}`);
      });
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Spawned ${spawnResult.data.spawned.length} ${spawnResult.data.shipType.name} hulls across 20 km. Detonation in ${(spawnResult.data.delayMs / 1000).toFixed(1)}s sim time.`,
  );
}

function formatStructureDeathTestError(errorMsg, parsed) {
  const token = String(parsed && parsed.typeToken || "").trim();
  if (errorMsg === "STRUCTURE_TYPE_REQUIRED") {
    return buildStructureDeathTestUsage();
  }
  if (errorMsg === "FOB_ALIAS_AMBIGUOUS") {
    return "FOB is ambiguous. Use /deathstructure bloodraiderfob, /deathstructure guristasfob, /deathstructure guristasinsurgencyfob, or /deathstructure angelfob.";
  }
  if (errorMsg === "STRUCTURE_SPAWN_FAILED") {
    return "Structure death-test spawning failed before any structures were created.";
  }
  if (errorMsg === "ANCHOR_ENTITY_NOT_FOUND") {
    return "Structure death-test needs your current ship ball as a spawn anchor.";
  }
  if (errorMsg === "STRUCTURE_TYPE_NOT_FOUND") {
    return `Structure type not found: ${token || "unknown"}.`;
  }
  if (errorMsg === "ITEM_NOT_FOUND") {
    return `Structure type not found: ${token}.${formatSuggestions(parsed && parsed.suggestions)}`;
  }
  if (errorMsg === "AMBIGUOUS_ITEM_NAME") {
    return `Structure type is ambiguous: ${token}.${formatSuggestions(parsed && parsed.suggestions)}`;
  }
  return `Structure death-test failed: ${errorMsg || "UNKNOWN_ERROR"}.`;
}

function handleStructureDeathTestCommand(session, argumentText, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /deathstructure.",
    );
  }

  const parsed = parseStructureDeathTestArgs(argumentText);
  if (!parsed.typeToken) {
    return handledResult(chatHub, session, options, buildStructureDeathTestUsage());
  }

  const spawnResult = spawnStructureDeathTestField(session, {
    typeToken: parsed.typeToken,
    count: parsed.count,
    delayMs:
      parsed.delaySeconds === null || parsed.delaySeconds === undefined
        ? undefined
        : parsed.delaySeconds * 1000,
  });
  if (!spawnResult.success || !spawnResult.data) {
    return handledResult(
      chatHub,
      session,
      options,
      formatStructureDeathTestError(spawnResult.errorMsg, {
        ...parsed,
        suggestions: spawnResult.suggestions || [],
      }),
    );
  }

  if (spawnResult.data.completionPromise && chatHub) {
    const feedbackChannel = getFeedbackChannel(options);
    spawnResult.data.completionPromise
      .then((result) => {
        if (!result || !session || !session.characterID) {
          return;
        }
        const wreckSummary = result.wreckType
          ? ` Wreck type: ${result.wreckType.name} (${result.wreckType.typeID}).`
          : "";
        chatHub.sendSystemMessage(
          session,
          `Detonated ${result.destroyed.length}/${result.spawnedCount} ${result.typeRecord.name} structure${result.spawnedCount === 1 ? "" : "s"}.${wreckSummary}`,
          feedbackChannel,
        );
      })
      .catch((error) => {
        log.warn(`[ChatCommands] /deathstructure completion failed: ${error.message}`);
      });
  }

  const wreckSummary = spawnResult.data.wreckType
    ? ` Expected wreck: ${spawnResult.data.wreckType.name} (${spawnResult.data.wreckType.typeID}).`
    : " No structure wreck type is mapped; destruction will use the normal fallback path.";
  return handledResult(
    chatHub,
    session,
    options,
    `Spawned ${spawnResult.data.spawned.length} ${spawnResult.data.typeRecord.name} structure${spawnResult.data.spawned.length === 1 ? "" : "s"} across ${(spawnResult.data.radiusMeters / 1000).toFixed(0)} km. Detonation in ${(spawnResult.data.delayMs / 1000).toFixed(1)}s sim time.${wreckSummary}`,
  );
}

function formatNpcSpawnSummary(result, commandLabel) {
  const data = result && result.data ? result.data : null;
  if (data && Array.isArray(data.spawned) && data.spawned.length > 0) {
    const spawnGroups = new Map();
    let totalLootEntries = 0;
    let totalModules = 0;

    for (const entry of data.spawned) {
      const profileName =
        entry &&
        entry.definition &&
        entry.definition.profile &&
        entry.definition.profile.name
          ? entry.definition.profile.name
          : "Unknown NPC";
      spawnGroups.set(profileName, (spawnGroups.get(profileName) || 0) + 1);
      totalLootEntries += Array.isArray(entry && entry.lootEntries)
        ? entry.lootEntries.length
        : 0;
      totalModules += Array.isArray(entry && entry.fittedModules)
        ? entry.fittedModules.length
        : 0;
    }

    const composition = [...spawnGroups.entries()]
      .map(([name, count]) => `${count}x ${name}`)
      .join(", ");
    const selectionText = data.selectionName
      ? ` from ${data.selectionName}`
      : "";
    const lootSummary = totalLootEntries > 0
      ? `Seeded ${totalLootEntries} random cargo loot entr${totalLootEntries === 1 ? "y" : "ies"}.`
      : "No extra cargo loot was seeded.";
    const partialSummary = data.partialFailure
      ? ` Spawn stopped at ${data.partialFailure.failedAt}/${data.requestedAmount}: ${data.partialFailure.errorMsg}.`
      : "";
    return [
      `Spawned ${data.spawned.length} hull${data.spawned.length === 1 ? "" : "s"}${selectionText}: ${composition}.`,
      `Prepared ${totalModules} fitted weapon module${totalModules === 1 ? "" : "s"} and set preferred target to your ship.`,
      "These command-spawned NPCs are transient and are not written to disk.",
      lootSummary,
      partialSummary.trim(),
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  if (!data || !data.definition || !data.entity) {
    return `${commandLabel} spawn completed.`;
  }

  const lootEntries = Array.isArray(data.lootEntries) ? data.lootEntries : [];
  const nativeNpc = Boolean(data.entity && data.entity.nativeNpc === true);
  const lootSummary = nativeNpc
    ? "Loot will be rolled into the wreck on destruction."
    : lootEntries.length > 0
      ? `Seeded ${lootEntries.length} random cargo loot entr${lootEntries.length === 1 ? "y" : "ies"}.`
      : "No extra cargo loot was seeded.";
  const moduleCount = Array.isArray(data.fittedModules) ? data.fittedModules.length : 0;
  return [
    `Spawned ${data.definition.profile.name} as entity ${data.entity.itemID}.`,
    `Hull: ${data.shipItem && data.shipItem.itemName ? data.shipItem.itemName : data.definition.profile.shipNameTemplate}.`,
    `Prepared ${moduleCount} fitted weapon module${moduleCount === 1 ? "" : "s"} and set preferred target to your ship.`,
    nativeNpc
      ? "This command-spawned NPC is native, transient, and is not written to disk."
      : "This command-spawned NPC is transient and is not written to disk.",
    lootSummary,
  ].join(" ");
}

function formatNpcWarpSpawnSummary(result, commandLabel) {
  const baseSummary = formatNpcSpawnSummary(result, commandLabel);
  const spawnedCount =
    result &&
    result.data &&
    Array.isArray(result.data.spawned)
      ? result.data.spawned.length
      : 0;
  if (spawnedCount <= 0) {
    return `${baseSummary} Warp-in could not be confirmed.`;
  }
  return [
    baseSummary,
    `Warping ${spawnedCount === 1 ? "it" : "them"} in from a safe off-grid origin and attacking your ship.`,
  ].join(" ");
}

function formatDistanceAu(distanceMeters) {
  return (Number(distanceMeters || 0) / ONE_AU_IN_METERS).toFixed(1);
}

function resolveWarpCommandSyntheticChaseTier(entity) {
  const mass = Number(entity && entity.mass || 0);
  const radius = Number(entity && entity.radius || 0);
  if (mass >= 80_000_000 || radius >= 250) {
    return "large";
  }
  if (mass >= 8_000_000 || radius >= 100) {
    return "medium";
  }
  return "small";
}

function applyWarpCommandChaseOverride(result) {
  const spawned = result &&
    result.data &&
    Array.isArray(result.data.spawned)
      ? result.data.spawned
      : [];
  let appliedCount = 0;
  let failedCount = 0;

  for (const entry of spawned) {
    const entityID = Number(entry && entry.entity && entry.entity.itemID || 0);
    if (!Number.isInteger(entityID) || entityID <= 0) {
      failedCount += 1;
      continue;
    }

    const controller = npcService.getControllerByEntityID(entityID);
    const existingOverrides =
      controller &&
      controller.behaviorOverrides &&
      typeof controller.behaviorOverrides === "object"
        ? controller.behaviorOverrides
        : {};
    const overrideResult = npcService.setBehaviorOverrides(entityID, {
      ...existingOverrides,
      useChasePropulsion: true,
      syntheticChasePropulsionTier: resolveWarpCommandSyntheticChaseTier(
        entry && entry.entity,
      ),
      chasePropulsionActivateDistanceMeters: 10_000,
      chasePropulsionDeactivateDistanceMeters: 10_000,
      returnToHomeWhenIdle: false,
      leashRangeMeters: 0,
    });
    if (overrideResult && overrideResult.success) {
      appliedCount += 1;
    } else {
      failedCount += 1;
    }
  }

  return {
    appliedCount,
    failedCount,
  };
}

function handleNpcCommand(session, argumentText, chatHub, options) {
  const parsedArguments = parseNpcSpawnArguments(argumentText, {
    defaultAmount: 5,
  });
  if (!parsedArguments.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /npc [amount] [faction|profile|pool]",
    );
  }
  if (parsedArguments.amount > MAX_NPC_COMMAND_SPAWN_COUNT) {
    return handledResult(
      chatHub,
      session,
      options,
      `NPC spawn count must be between 1 and ${MAX_NPC_COMMAND_SPAWN_COUNT}.`,
    );
  }

  const result = npcService.runtime.spawnBatchForSession(session, {
    profileQuery: parsedArguments.query,
    amount: parsedArguments.amount,
    transient: true,
    preferPools: true,
  });
  if (!result.success) {
    const suggestions = formatSuggestions(result.suggestions);
    let message = "NPC spawn failed.";
    if (result.errorMsg === "NOT_IN_SPACE") {
      message = "You must be in space before using /npc.";
    } else if (result.errorMsg === "SHIP_NOT_FOUND") {
      message = "Active ship was not found in space.";
    } else if (result.errorMsg === "PROFILE_NOT_FOUND") {
      message = `NPC profile or pool not found: ${parsedArguments.query || "default"}.${suggestions}`;
    } else if (result.errorMsg === "PROFILE_AMBIGUOUS") {
      message = `NPC profile or pool is ambiguous: ${parsedArguments.query}.${suggestions}`;
    } else if (result.errorMsg === "NPC_DEFINITION_INCOMPLETE") {
      message = "The selected NPC profile is missing authored loadout or behavior data.";
    } else if (result.errorMsg === "NPC_NATIVE_NO_FREE_SLOT") {
      message = "The selected NPC profile has an authored module loadout that does not fit the hull under the current slot resolver.";
    } else if (result.errorMsg === "NPC_NATIVE_MODULE_TYPE_NOT_FOUND") {
      message = "The selected NPC profile references a module type that is missing from local item data.";
    } else if (result.errorMsg === "NPC_NATIVE_CAPABILITY_TYPE_NOT_FOUND") {
      message = "The selected NPC profile references an NPC capability module type that is missing from local item data.";
    } else if (result.errorMsg === "POOL_EMPTY") {
      message = `The selected NPC pool has no spawnable authored entries.${suggestions}`.trim();
    } else {
      message = `NPC spawn failed: ${result.errorMsg || "UNKNOWN_ERROR"}.${suggestions}`.trim();
    }
    return handledResult(chatHub, session, options, message);
  }

  return handledResult(
    chatHub,
    session,
    options,
    formatNpcSpawnSummary(result, "/npc"),
  );
}

function handleMissileNpcCommand(session, argumentText, chatHub, options) {
  const parsedArguments = parseNpcSpawnArguments(argumentText, {
    defaultAmount: 5,
  });
  if (!parsedArguments.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /mnpc [amount] [faction|profile|pool]",
    );
  }
  if (parsedArguments.amount > MAX_NPC_COMMAND_SPAWN_COUNT) {
    return handledResult(
      chatHub,
      session,
      options,
      `NPC spawn count must be between 1 and ${MAX_NPC_COMMAND_SPAWN_COUNT}.`,
    );
  }

  const result = npcService.runtime.spawnBatchForSession(session, {
    profileQuery: parsedArguments.query,
    amount: parsedArguments.amount,
    transient: true,
    defaultPoolID: "npc_missile_hostiles",
    fallbackProfileID: "guristas_missile_battleship",
    preferPools: true,
    requiredWeaponFamily: "missileLauncher",
  });
  if (!result.success) {
    const suggestions = formatSuggestions(result.suggestions);
    let message = "Missile NPC spawn failed.";
    if (result.errorMsg === "NOT_IN_SPACE") {
      message = "You must be in space before using /mnpc.";
    } else if (result.errorMsg === "SHIP_NOT_FOUND") {
      message = "Active ship was not found in space.";
    } else if (result.errorMsg === "PROFILE_NOT_FOUND") {
      message = `Missile NPC profile or pool not found: ${parsedArguments.query || "default"}.${suggestions}`;
    } else if (result.errorMsg === "PROFILE_AMBIGUOUS") {
      message = `Missile NPC profile or pool is ambiguous: ${parsedArguments.query}.${suggestions}`;
    } else if (result.errorMsg === "PROFILE_NOT_ELIGIBLE") {
      message = "The selected /mnpc profile is not missile-capable.";
    } else if (result.errorMsg === "NPC_DEFINITION_INCOMPLETE") {
      message = "The selected missile NPC profile is missing authored loadout or behavior data.";
    } else if (result.errorMsg === "NPC_NATIVE_NO_FREE_SLOT") {
      message = "The selected missile NPC profile has an authored module loadout that does not fit the hull under the current slot resolver.";
    } else if (result.errorMsg === "NPC_NATIVE_MODULE_TYPE_NOT_FOUND") {
      message = "The selected missile NPC profile references a module type that is missing from local item data.";
    } else if (result.errorMsg === "NPC_NATIVE_CAPABILITY_TYPE_NOT_FOUND") {
      message = "The selected missile NPC profile references an NPC capability module type that is missing from local item data.";
    } else if (result.errorMsg === "POOL_EMPTY") {
      message = `The selected missile NPC pool has no spawnable authored entries.${suggestions}`.trim();
    } else {
      message = `Missile NPC spawn failed: ${result.errorMsg || "UNKNOWN_ERROR"}.${suggestions}`.trim();
    }
    return handledResult(chatHub, session, options, message);
  }

  return handledResult(
    chatHub,
    session,
    options,
    formatNpcSpawnSummary(result, "/mnpc"),
  );
}

function handleCapitalNpcCommand(session, argumentText, chatHub, options, commandName = "capnpc") {
  const result = executeCapitalNpcCommand(session, commandName, argumentText);
  return handledResult(
    chatHub,
    session,
    options,
    result && result.message ? result.message : `${commandName} completed.`,
  );
}

function handleNpcTestCommand(session, argumentText, chatHub, options, mode = "player") {
  const normalizedMode = String(mode || "player").trim().toLowerCase();
  const commandLabel = normalizedMode === "ffa" ? "/npctest2" : "/npctest";
  const parsedArguments = parseNpcSpawnArguments(argumentText, {
    defaultAmount: NPCTEST_DEFAULT_AMOUNT,
  });
  if (!parsedArguments.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Usage: ${commandLabel} [amount]`,
    );
  }
  if (parsedArguments.amount > MAX_NPC_COMMAND_SPAWN_COUNT) {
    return handledResult(
      chatHub,
      session,
      options,
      `${commandLabel} spawn count must be between 1 and ${MAX_NPC_COMMAND_SPAWN_COUNT}.`,
    );
  }
  if (normalizedMode === "ffa" && parsedArguments.amount < 2) {
    return handledResult(
      chatHub,
      session,
      options,
      "/npctest2 needs at least 2 NPCs.",
    );
  }

  const result = spawnNpcTestForSession(session, {
    amount: parsedArguments.amount,
    mode: normalizedMode,
  });
  if (!result.success || !result.data) {
    let message = `${commandLabel} failed.`;
    if (result.errorMsg === "NOT_IN_SPACE") {
      message = `You must be in space before using ${commandLabel}.`;
    } else if (result.errorMsg === "SHIP_NOT_FOUND") {
      message = "Active ship was not found in space.";
    } else if (result.errorMsg === "NPC_TEST_POOL_EMPTY") {
      message = "No authored combat NPC profiles with working weapons were found for npc test spawning.";
    } else {
      message = `${commandLabel} failed: ${result.errorMsg || "UNKNOWN_ERROR"}.`;
    }
    return handledResult(chatHub, session, options, message);
  }

  const clearedLabel = result.data.clearedCount > 0
    ? ` Cleared ${result.data.clearedCount} previous ${commandLabel} NPC${result.data.clearedCount === 1 ? "" : "s"}.`
    : "";
  if (normalizedMode === "ffa") {
    return handledResult(
      chatHub,
      session,
      options,
      [
        `Spawned ${result.data.spawnedAmount} stationary /npctest2 NPCs in a sphere centered about 20 km ahead of your ship.`,
        `Missile hulls: ${result.data.missileSpawnCount} from ${result.data.missileProfileCount} authored missile NPC profiles.`,
        "They will hold position, fire at other /npctest2 NPCs, and retarget until one champion remains or they mutually destroy each other.",
        clearedLabel.trim(),
      ].filter(Boolean).join(" "),
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    [
      `Spawned ${result.data.spawnedAmount} stationary /npctest NPCs in a sphere centered about 20 km ahead of your ship.`,
      `Missile hulls: ${result.data.missileSpawnCount} from ${result.data.missileProfileCount} authored missile NPC profiles.`,
      "Short-range hulls are range-clamped inward so they can still shoot while staying stationary.",
      clearedLabel.trim(),
    ].filter(Boolean).join(" "),
  );
}

function handleNpcWarpCommand(session, argumentText, chatHub, options, commandName = "npcw") {
  const normalizedCommandName = String(commandName || "npcw").trim().toLowerCase();
  const commandLabel = normalizedCommandName === "wnpc" ? "/wnpc" : "/npcw";
  const parsedArguments = parseNpcSpawnArguments(argumentText);
  if (!parsedArguments.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Usage: ${commandLabel} [amount] [profile|pool]`,
    );
  }
  if (parsedArguments.amount > MAX_NPC_COMMAND_SPAWN_COUNT) {
    return handledResult(
      chatHub,
      session,
      options,
      `NPC warp spawn count must be between 1 and ${MAX_NPC_WARP_COMMAND_SPAWN_COUNT}.`,
    );
  }

  const result = npcService.runtime.spawnWarpBatchForSession(session, {
    profileQuery: parsedArguments.query,
    amount: parsedArguments.amount,
    transient: true,
  });
  if (!result.success) {
    const suggestions = formatSuggestions(result.suggestions);
    let message = "NPC warp spawn failed.";
    if (result.errorMsg === "NOT_IN_SPACE") {
      message = `You must be in space before using ${commandLabel}.`;
    } else if (result.errorMsg === "SHIP_NOT_FOUND") {
      message = "Active ship was not found in space.";
    } else if (result.errorMsg === "PROFILE_NOT_FOUND") {
      message = `NPC profile or pool not found: ${parsedArguments.query || "default"}.${suggestions}`;
    } else if (result.errorMsg === "PROFILE_AMBIGUOUS") {
      message = `NPC profile or pool is ambiguous: ${parsedArguments.query}.${suggestions}`;
    } else if (result.errorMsg === "NPC_DEFINITION_INCOMPLETE") {
      message = "The selected NPC profile is missing authored loadout or behavior data.";
    } else if (result.errorMsg === "POOL_EMPTY") {
      message = `The selected NPC pool has no spawnable authored entries.${suggestions}`.trim();
    } else {
      message = `NPC warp spawn failed: ${result.errorMsg || "UNKNOWN_ERROR"}.${suggestions}`.trim();
    }
    return handledResult(chatHub, session, options, message);
  }

  const chaseOverrideResult =
    normalizedCommandName === "wnpc"
      ? applyWarpCommandChaseOverride(result)
      : null;
  let summary = formatNpcWarpSpawnSummary(result, commandLabel);
  if (chaseOverrideResult && chaseOverrideResult.appliedCount > 0) {
    summary = `${summary} Chase propulsion override enabled for ${chaseOverrideResult.appliedCount} warped NPC${chaseOverrideResult.appliedCount === 1 ? "" : "s"}.`;
  } else if (chaseOverrideResult && chaseOverrideResult.failedCount > 0) {
    summary = `${summary} Chase propulsion override could not be applied.`;
  }

  return handledResult(
    chatHub,
    session,
    options,
    summary,
  );
}

function handleDeadwarpCommand(session, argumentText, chatHub, options) {
  if (String(argumentText || "").trim()) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /deadwarp",
    );
  }
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /deadwarp.",
    );
  }

  const scene = spaceRuntime.getSceneForSession(session);
  const shipEntity = resolveSessionShipEntity(session);
  if (!scene || !shipEntity) {
    return handledResult(
      chatHub,
      session,
      options,
      "Active ship was not found in space.",
    );
  }

  const originAnchor = findSafeWarpOriginAnchor(scene, shipEntity, {
    clearanceMeters: ONE_AU_IN_METERS,
    minDistanceMeters: ONE_AU_IN_METERS * 2,
    maxDistanceMeters: ONE_AU_IN_METERS * 4,
    stepMeters: ONE_AU_IN_METERS / 2,
  });

  const warpRequestResult = scene.warpToPoint(session, originAnchor.position, {
    ignoreCrimewatchCheck: true,
  });
  if (!warpRequestResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Deadwarp failed: ${warpRequestResult.errorMsg || "WARP_REQUEST_FAILED"}.`,
    );
  }

  const activationResult = scene.forceStartPendingWarp(shipEntity, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  if (!activationResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Deadwarp failed: ${activationResult.errorMsg || "WARP_ACTIVATION_FAILED"}.`,
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Deadwarp started to a safe point ${formatDistanceAu(originAnchor.distanceMeters)} AU away.`,
  );
}

function handleConcordCommand(session, argumentText, chatHub, options) {
  const parsedArguments = parseNpcSpawnArguments(argumentText);
  if (!parsedArguments.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /concord [amount] [profile|pool]",
    );
  }
  if (parsedArguments.amount > MAX_CONCORD_COMMAND_SPAWN_COUNT) {
    return handledResult(
      chatHub,
      session,
      options,
      `CONCORD spawn count must be between 1 and ${MAX_CONCORD_COMMAND_SPAWN_COUNT}.`,
    );
  }

  const result = npcService.runtime.spawnConcordBatchForSession(session, {
    profileQuery: parsedArguments.query,
    amount: parsedArguments.amount,
    transient: true,
  });
  if (!result.success) {
    const suggestions = formatSuggestions(result.suggestions);
    let message = "CONCORD spawn failed.";
    if (result.errorMsg === "NOT_IN_SPACE") {
      message = "You must be in space before using /concord.";
    } else if (result.errorMsg === "SHIP_NOT_FOUND") {
      message = "Active ship was not found in space.";
    } else if (result.errorMsg === "PROFILE_NOT_FOUND") {
      message = `CONCORD profile or pool not found: ${parsedArguments.query || "concord"}.${suggestions}`;
    } else if (result.errorMsg === "PROFILE_AMBIGUOUS") {
      message = `CONCORD profile or pool is ambiguous: ${parsedArguments.query}.${suggestions}`;
    } else if (result.errorMsg === "POOL_EMPTY") {
      message = `The selected CONCORD pool has no spawnable authored entries.${suggestions}`.trim();
    } else {
      message = `CONCORD spawn failed: ${result.errorMsg || "UNKNOWN_ERROR"}.${suggestions}`.trim();
    }
    return handledResult(chatHub, session, options, message);
  }

  return handledResult(
    chatHub,
    session,
    options,
    formatNpcSpawnSummary(result, "/concord"),
  );
}

function handleNpcClearCommand(session, argumentText, chatHub, options) {
  const parsed = parseNpcClearArguments(argumentText);
  if (!parsed.success || !parsed.entityType) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /npcclear <system [npc|concord|all]|radius <meters> [npc|concord|all]>",
    );
  }

  const systemID = resolveSessionSolarSystemID(session);
  if (!systemID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Current solar system could not be resolved for /npcclear.",
    );
  }

  let result = null;
  if (parsed.scope === "radius") {
    if (!isSpaceSessionReady(session) || !resolveSessionShipEntity(session)) {
      return handledResult(
        chatHub,
        session,
        options,
        "You must be in space before using /npcclear radius.",
      );
    }

    result = npcService.clearNpcControllersForSessionRadius(session, {
      entityType: parsed.entityType,
      radiusMeters: parsed.radiusMeters,
      removeContents: true,
    });
  } else {
    result = npcService.clearNpcControllersInSystem(systemID, {
      entityType: parsed.entityType,
      removeContents: true,
    });
  }

  if (!result || !result.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `NPC clear failed: ${(result && result.errorMsg) || "UNKNOWN_ERROR"}.`,
    );
  }

  const scopeText = parsed.scope === "radius"
    ? `within ${formatDistanceMeters(parsed.radiusMeters)}`
    : `in system ${systemID}`;
  const entityLabel = parsed.entityType === "all"
    ? "NPC/CONCORD"
    : parsed.entityType === "concord"
      ? "CONCORD"
      : "NPC";
  return handledResult(
    chatHub,
    session,
    options,
    `Cleared ${result.data.destroyedCount} ${entityLabel} controller${result.data.destroyedCount === 1 ? "" : "s"} ${scopeText}.`,
  );
}

function formatGateOperatorStatus(label, state) {
  const sourceLabel = state && state.source === "generated"
    ? "generated default startup coverage"
    : state && state.source === "authored"
      ? "data-authored startup rules"
      : state && state.source === "startup"
        ? "startup rules"
        : "dynamic operator rule";
  const enabledText = state && state.enabled ? "ON" : "OFF";
  return `${label} is ${enabledText} in system ${state && state.systemID ? state.systemID : "unknown"} (${sourceLabel}, live respawn enabled while active).`;
}

function handleGateOperatorCommand(session, argumentText, chatHub, options, operatorKind) {
  const systemID = resolveSessionSolarSystemID(session);
  if (!systemID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Current solar system could not be resolved for gate operator controls.",
    );
  }

  const parsed = parseToggleCommandArgument(argumentText);
  if (!parsed.success) {
    const usageLabel = operatorKind === npcService.GATE_OPERATOR_KIND.CONCORD
      ? "/gateconcord [on|off]"
      : "/gaterats [on|off]";
    return handledResult(chatHub, session, options, `Usage: ${usageLabel}`);
  }

  const label = operatorKind === npcService.GATE_OPERATOR_KIND.CONCORD
    ? "Gate CONCORD"
    : "Gate rats";
  const result = parsed.mode === "status"
    ? npcService.getGateOperatorState(systemID, operatorKind)
    : npcService.setGateOperatorEnabled(systemID, operatorKind, parsed.mode === "on");
  if (!result || !result.success || !result.data) {
    return handledResult(
      chatHub,
      session,
      options,
      `${label} command failed: ${(result && result.errorMsg) || "UNKNOWN_ERROR"}.`,
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    formatGateOperatorStatus(label, result.data),
  );
}

function handleInvuCommand(session, argumentText, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /invu.",
    );
  }

  const trimmed = String(argumentText || "").trim();
  let result = null;
  if (!trimmed) {
    result = npcService.toggleCharacterNpcInvulnerability(session.characterID);
  } else {
    const parsed = parseToggleCommandArgument(trimmed);
    if (!parsed.success) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /invu [on|off]",
      );
    }

    if (parsed.mode === "status") {
      const enabled = npcService.isCharacterInvulnerable(session.characterID);
      return handledResult(
        chatHub,
        session,
        options,
        `Invulnerability is ${enabled ? "ON" : "OFF"}. Rats and CONCORD ${enabled ? "will" : "will not"} ignore you.`,
      );
    }

    result = npcService.setCharacterNpcInvulnerability(
      session.characterID,
      parsed.mode === "on",
    );
  }

  if (!result || !result.success || !result.data) {
    return handledResult(
      chatHub,
      session,
      options,
      `Invulnerability update failed: ${(result && result.errorMsg) || "UNKNOWN_ERROR"}.`,
    );
  }

  if (isSpaceSessionReady(session)) {
    const scene = spaceRuntime.ensureScene(session._space.systemID);
    if (scene) {
      npcService.tickScene(scene, scene.getCurrentSimTimeMs());
    }
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Invulnerability is now ${result.data.invulnerable ? "ON" : "OFF"}. Rats and CONCORD ${result.data.invulnerable ? "will" : "will not"} ignore you.`,
  );
}

function handleHealCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /heal.",
    );
  }

  if (isSpaceSessionReady(session)) {
    const result = spaceRuntime.healSessionShipResources(session, {
      // /heal is a live resource restore, not a real session move. Avoid the
      // owner SetState rebase path here because that packet can rebuild the
      // local ballpark without the follow-up module/charge hydration that
      // login, undock, jump, and other attach flows intentionally queue.
      refreshOwnerDamagePresentation: false,
    });
    if (!result || !result.success) {
      const message =
        result && result.errorMsg === "SCENE_NOT_FOUND"
          ? "Your ship is not loaded in space yet."
          : "Active ship not found in space.";
      return handledResult(chatHub, session, options, message);
    }

    return handledResult(
      chatHub,
      session,
      options,
      "Restored full shields, armor, hull, and capacitor on your active ship.",
    );
  }

  const updateResult = healDockedShipForSession(session);
  if (!updateResult || !updateResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Active ship not found.",
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    "Restored full shields, armor, hull, and capacitor on your active ship.",
  );
}

function handleDamageCommand(session, argumentText, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /dmg.",
    );
  }

  const presetResult = resolveDamageTestPreset(argumentText);
  if (!presetResult.success || !presetResult.preset) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /dmg [light|medium|heavy]",
    );
  }

  const damageResult = damageDockedShipForSession(session, presetResult.preset);
  if (!damageResult || !damageResult.success || !damageResult.data) {
    const message =
      damageResult && damageResult.errorMsg === "NOT_DOCKED"
        ? "Dock first before using /dmg so the repair flow stays easy to test."
        : "Active docked ship not found.";
    return handledResult(chatHub, session, options, message);
  }

  const moduleCount = Number(damageResult.data.moduleCount || 0);
  const presetLabel = damageResult.data.presetLabel || "medium";
  const moduleText =
    moduleCount > 0
      ? ` and ${formatCountLabel(moduleCount, "fitted module", "fitted modules")}`
      : "";

  return handledResult(
    chatHub,
    session,
    options,
    `Applied ${presetLabel} test damage to your active ship${moduleText}.`,
  );
}

function buildCrimewatchStatusMessage(session) {
  const characterID = session && session.characterID ? session.characterID : 0;
  const now = getCrimewatchReferenceMsForSession(session);
  const state = characterID
    ? crimewatchState.getCharacterCrimewatchState(characterID, now)
    : null;
  const effectiveState = state || {
    safetyLevel: crimewatchState.SAFETY_LEVEL_FULL,
    weaponTimerExpiresAtMs: 0,
    pvpTimerExpiresAtMs: 0,
    npcTimerExpiresAtMs: 0,
    criminalTimerExpiresAtMs: 0,
    disapprovalTimerExpiresAtMs: 0,
    criminal: false,
    suspect: false,
  };

  const remainingWeaponMs = Math.max(
    0,
    Number(effectiveState.weaponTimerExpiresAtMs || 0) - now,
  );
  const remainingPvpMs = Math.max(
    0,
    Number(effectiveState.pvpTimerExpiresAtMs || 0) - now,
  );
  const remainingNpcMs = Math.max(
    0,
    Number(effectiveState.npcTimerExpiresAtMs || 0) - now,
  );
  const remainingPenaltyMs = Math.max(
    0,
    Number(effectiveState.criminalTimerExpiresAtMs || 0) - now,
  );
  const remainingDisapprovalMs = Math.max(
    0,
    Number(effectiveState.disapprovalTimerExpiresAtMs || 0) - now,
  );
  const flagLabel = effectiveState.criminal && remainingPenaltyMs > 0
    ? `CRIMINAL (${formatDurationBriefMs(remainingPenaltyMs)})`
    : effectiveState.suspect && remainingPenaltyMs > 0
      ? `SUSPECT (${formatDurationBriefMs(remainingPenaltyMs)})`
      : "CLEAR";

  return [
    `Crimewatch: safety ${formatCrimewatchSafetyLabel(effectiveState.safetyLevel)}.`,
    `Weapon ${formatDurationBriefMs(remainingWeaponMs)}.`,
    `PvP ${formatDurationBriefMs(remainingPvpMs)}.`,
    `NPC ${formatDurationBriefMs(remainingNpcMs)}.`,
    `Flag ${flagLabel}.`,
    `Disapproval ${formatDurationBriefMs(remainingDisapprovalMs)}.`,
  ].join(" ");
}

function synchronizeCrimewatchSessionState(session, scene, now) {
  const activeScene = scene || (
    isSpaceSessionReady(session)
      ? spaceRuntime.ensureScene(session._space.systemID)
      : null
  );
  if (!activeScene) {
    return;
  }

  const referenceNow = Number.isFinite(Number(now))
    ? Number(now)
    : activeScene.getCurrentSimTimeMs();
  crimewatchState.tickScene(activeScene, referenceNow);
}

function handleCrimewatchCommand(session, argumentText, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /cwatch.",
    );
  }

  const usage =
    "Usage: /cwatch [status|clear|safety <full|partial|none>|weapon <off|seconds>|pvp <off|seconds>|npc <off|seconds>|criminal <off|seconds>|suspect <off|seconds>|disapproval <off|seconds>]";
  const trimmed = String(argumentText || "").trim();
  const scene = isSpaceSessionReady(session)
    ? spaceRuntime.ensureScene(session._space.systemID)
    : null;
  const now = scene ? scene.getCurrentSimTimeMs() : getCrimewatchReferenceMsForSession(session);
  const offenderEntity = scene ? resolveSessionShipEntity(session) : null;

  if (!trimmed || ["status", "state"].includes(trimmed.toLowerCase())) {
    return handledResult(
      chatHub,
      session,
      options,
      buildCrimewatchStatusMessage(session),
    );
  }

  if (["clear", "reset"].includes(trimmed.toLowerCase())) {
    const result = crimewatchState.setCharacterCrimewatchDebugState(
      session.characterID,
      { clearAll: true },
      {
        now,
        systemID: resolveSessionSolarSystemID(session),
        scene,
        offenderEntity,
      },
    );
    if (!result.success) {
      return handledResult(
        chatHub,
        session,
        options,
        `Crimewatch update failed: ${result.errorMsg || "UNKNOWN_ERROR"}.`,
      );
    }

    synchronizeCrimewatchSessionState(session, scene, now);
    return handledResult(
      chatHub,
      session,
      options,
      `Crimewatch timers cleared. ${buildCrimewatchStatusMessage(session)}`,
    );
  }

  const [subcommandRaw, ...rest] = trimmed.split(/\s+/);
  const subcommand = String(subcommandRaw || "").trim().toLowerCase();
  const valueText = rest.join(" ").trim();
  let updates = null;

  if (subcommand === "safety") {
    const parsed = parseCrimewatchSafetyArgument(valueText);
    if (!parsed.success) {
      return handledResult(chatHub, session, options, usage);
    }
    updates = {
      safetyLevel: parsed.safetyLevel,
    };
  } else if (
    subcommand === "weapon" ||
    subcommand === "pvp" ||
    subcommand === "npc" ||
    subcommand === "criminal" ||
    subcommand === "suspect" ||
    subcommand === "disapproval"
  ) {
    const defaultDurationMs =
      subcommand === "weapon"
        ? crimewatchState.WEAPON_TIMER_DURATION_MS
        : subcommand === "pvp"
          ? crimewatchState.PVP_TIMER_DURATION_MS
          : subcommand === "npc"
            ? crimewatchState.NPC_TIMER_DURATION_MS
            : subcommand === "disapproval"
              ? crimewatchState.DISAPPROVAL_TIMER_DURATION_MS
              : crimewatchState.CRIMINAL_TIMER_DURATION_MS;
    const parsed = parseCrimewatchDurationArgument(valueText, defaultDurationMs);
    if (!parsed.success) {
      return handledResult(chatHub, session, options, usage);
    }

    if (subcommand === "weapon") {
      updates = { weaponTimerMs: parsed.durationMs };
    } else if (subcommand === "pvp") {
      updates = { pvpTimerMs: parsed.durationMs };
    } else if (subcommand === "npc") {
      updates = { npcTimerMs: parsed.durationMs };
    } else if (subcommand === "disapproval") {
      updates = { disapprovalTimerMs: parsed.durationMs };
    } else if (subcommand === "criminal") {
      updates = parsed.durationMs > 0
        ? {
          criminal: true,
          suspect: false,
          criminalTimerMs: parsed.durationMs,
          refreshConcord: true,
        }
        : {
          criminal: false,
          suspect: false,
          criminalTimerMs: 0,
        };
    } else {
      updates = parsed.durationMs > 0
        ? {
          suspect: true,
          criminal: false,
          criminalTimerMs: parsed.durationMs,
        }
        : {
          suspect: false,
          criminal: false,
          criminalTimerMs: 0,
        };
    }
  } else {
    return handledResult(chatHub, session, options, usage);
  }

  const result = crimewatchState.setCharacterCrimewatchDebugState(
    session.characterID,
    updates,
    {
      now,
      systemID: resolveSessionSolarSystemID(session),
      scene,
      offenderEntity,
    },
  );
  if (!result.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Crimewatch update failed: ${result.errorMsg || "UNKNOWN_ERROR"}.`,
    );
  }

  synchronizeCrimewatchSessionState(session, scene, now);
  return handledResult(
    chatHub,
    session,
    options,
    `Crimewatch updated. ${buildCrimewatchStatusMessage(session)}`,
  );
}

function handleNaughtyCommand(session, argumentText, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /naughty.",
    );
  }

  if (String(argumentText || "").trim()) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /naughty",
    );
  }

  const scene = spaceRuntime.ensureScene(session._space.systemID);
  const offenderEntity = resolveSessionShipEntity(session);
  if (!scene || !offenderEntity) {
    return handledResult(
      chatHub,
      session,
      options,
      "Active ship not found in space.",
    );
  }

  const now = scene.getCurrentSimTimeMs();
  const result = crimewatchState.triggerHighSecCriminalOffense(
    scene,
    offenderEntity,
    {
      now,
      reason: "NAUGHTY_COMMAND",
    },
  );
  if (!result.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Crimewatch update failed: ${result.errorMsg || "UNKNOWN_ERROR"}.`,
    );
  }

  synchronizeCrimewatchSessionState(session, scene, now);
  if (!result.data || result.data.applied !== true) {
    const reason = String(result.data && result.data.reason || "").trim().toUpperCase();
    const message =
      reason === "NOT_HIGHSEC"
        ? "You are not in a high-security solar system, so /naughty only refreshed the local combat timers and did not schedule CONCORD."
        : "Crimewatch did not create a criminal response.";
    return handledResult(
      chatHub,
      session,
      options,
      `${message} ${buildCrimewatchStatusMessage(session)}`,
    );
  }

  const responseDueMs = Math.max(
    0,
    Number(result.data.concordResponseDueAtMs || 0) - now,
  );
  const securityPenalty = result.data.securityStatusPenalty || null;
  const securitySuffix =
    securityPenalty && securityPenalty.applied === true
      ? ` Security status is now ${Number(securityPenalty.nextSecurityStatus || 0).toFixed(2)}.`
      : "";
  return handledResult(
    chatHub,
    session,
    options,
    `Crimewatch offense simulated. CONCORD ${responseDueMs > 0 ? `will respond in about ${formatDurationBriefMs(responseDueMs)}` : "response is active now"}. ${buildCrimewatchStatusMessage(session)}${securitySuffix}`,
  );
}

function handleSecurityStatusCommand(session, argumentText, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /secstatus.",
    );
  }

  const trimmed = String(argumentText || "").trim();
  const currentSecurityStatus = crimewatchState.getCharacterSecurityStatus(
    session.characterID,
    0,
  );
  if (!trimmed) {
    return handledResult(
      chatHub,
      session,
      options,
      `Security status is ${currentSecurityStatus.toFixed(2)}. Use /secstatus <value> to set it (${crimewatchState.SECURITY_STATUS_MIN.toFixed(0)} to ${crimewatchState.SECURITY_STATUS_MAX.toFixed(0)}).`,
    );
  }

  const requestedSecurityStatus = Number(trimmed);
  if (!Number.isFinite(requestedSecurityStatus)) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /secstatus [status]",
    );
  }

  const scene = isSpaceSessionReady(session)
    ? spaceRuntime.ensureScene(session._space.systemID)
    : null;
  const entity = scene ? resolveSessionShipEntity(session) : null;
  const now = scene ? scene.getCurrentSimTimeMs() : Date.now();
  const result = crimewatchState.setCharacterSecurityStatus(
    session.characterID,
    requestedSecurityStatus,
    {
      now,
      scene,
      entity,
      session,
    },
  );
  if (!result.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Security status update failed: ${result.errorMsg || "UNKNOWN_ERROR"}.`,
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Security status set to ${result.data.securityStatus.toFixed(2)} (requested ${requestedSecurityStatus.toFixed(2)}; clamped to ${crimewatchState.SECURITY_STATUS_MIN.toFixed(0)} to ${crimewatchState.SECURITY_STATUS_MAX.toFixed(0)}).`,
  );
}

function handleFireCommand(session, argumentText, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /fire.",
    );
  }

  const lookupText = String(argumentText || "").trim() || DEFAULT_FIRE_TARGET_NAME;
  const shipLookup = /^\d+$/.test(lookupText)
    ? {
      success: Boolean(resolveShipByTypeID(Number(lookupText) || 0)),
      match: resolveShipByTypeID(Number(lookupText) || 0),
      suggestions: [],
      errorMsg: "SHIP_NOT_FOUND",
    }
    : resolveShipByName(lookupText);
  if (!shipLookup.success || !shipLookup.match) {
    const message =
      shipLookup.errorMsg === "SHIP_NOT_FOUND"
        ? `Ship type not found: ${lookupText}.${formatSuggestions(shipLookup.suggestions)}`
        : `Ship type is ambiguous: ${lookupText}.${formatSuggestions(shipLookup.suggestions)}`;
    return handledResult(chatHub, session, options, message.trim());
  }

  const anchorEntity = spaceRuntime.getEntity(session, session._space.shipID);
  if (!anchorEntity) {
    return handledResult(chatHub, session, options, "Active ship was not found in space.");
  }

  const spawnResult = spaceRuntime.spawnDynamicShip(
    session._space.systemID,
    {
      itemID: allocateCombatDummyEntityID(),
      typeID: shipLookup.match.typeID,
      groupID: shipLookup.match.groupID,
      categoryID: shipLookup.match.categoryID || 6,
      itemName: `${shipLookup.match.name} Dummy`,
      ownerID: COMBAT_DUMMY_OWNER_ID,
      characterID: 0,
      corporationID: COMBAT_DUMMY_CORPORATION_ID,
      allianceID: 0,
      warFactionID: 0,
      npcEntityType: "npc",
      ...buildOffsetSpaceSpawnState(anchorEntity, 20_000),
      conditionState: {
        damage: 0,
        charge: 1,
        armorDamage: 0,
        shieldCharge: 1,
        incapacitated: false,
      },
    },
  );
  if (!spawnResult.success || !spawnResult.data || !spawnResult.data.entity) {
    return handledResult(chatHub, session, options, "Combat dummy spawn failed.");
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Spawned ${shipLookup.match.name} dummy hull ${spawnResult.data.entity.itemID} roughly 20 km away.`,
  );
}

function handleKeepstarCommand(session, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /keepstar.",
    );
  }

  const anchorEntity = spaceRuntime.getEntity(session, session._space.shipID);
  if (!anchorEntity) {
    return handledResult(chatHub, session, options, "Active ship was not found in space.");
  }

  const keepstarEntity = buildPalatineKeepstarVisualEntity(session, anchorEntity);
  if (!keepstarEntity) {
    return handledResult(
      chatHub,
      session,
      options,
      "Palatine Keepstar type data was not found in the local item registry.",
    );
  }

  const scene = spaceRuntime.getSceneForSession(session);
  if (!scene) {
    return handledResult(chatHub, session, options, "Current system scene was not found.");
  }

  const spawnResult = scene.spawnDynamicEntity(keepstarEntity);
  if (!spawnResult.success || !spawnResult.data || !spawnResult.data.entity) {
    return handledResult(chatHub, session, options, "Keepstar visual spawn failed.");
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Spawned runtime-only Palatine Keepstar ${spawnResult.data.entity.itemID} roughly ${(KEEPSTAR_DEFAULT_SPAWN_DISTANCE_METERS / 1000).toFixed(0)} km away. It is visual-only and clears on restart.`,
  );
}

function handleFire2Command(session, argumentText, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /fire2.",
    );
  }

  const anchorEntity = spaceRuntime.getEntity(session, session._space.shipID);
  if (!anchorEntity) {
    return handledResult(chatHub, session, options, "Active ship was not found in space.");
  }

  const trimmedArgument = String(argumentText || "").trim();
  const requestedFleetSize = trimmedArgument
    ? normalizePositiveInteger(trimmedArgument)
    : DEFAULT_FIRE2_FLEET_SIZE;
  if (trimmedArgument && !requestedFleetSize) {
    return handledResult(chatHub, session, options, "Usage: /fire2 [count]");
  }

  const fleetLookup = resolveFire2FleetShipTypes();
  if (!fleetLookup.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `The default /fire2 fleet could not be assembled from local ship data (${fleetLookup.availableCount || 0}/10 available).`,
    );
  }

  const formation = buildFire2FleetFormation(
    anchorEntity,
    fleetLookup.ships,
    requestedFleetSize,
  );
  const spawned = [];
  for (const entry of formation) {
    const shipType = entry.shipType;
    const spawnResult = spaceRuntime.spawnDynamicShip(
      session._space.systemID,
      {
        itemID: allocateCombatDummyEntityID(),
        typeID: shipType.typeID,
        groupID: shipType.groupID,
        categoryID: shipType.categoryID || 6,
        itemName: `${shipType.name} Fleet Dummy`,
        ownerID: COMBAT_DUMMY_OWNER_ID,
        characterID: 0,
        corporationID: COMBAT_DUMMY_CORPORATION_ID,
        allianceID: 0,
        warFactionID: 0,
        npcEntityType: "npc",
        ...entry.spawnState,
        conditionState: {
          damage: 0,
          charge: 1,
          armorDamage: 0,
          shieldCharge: 1,
          incapacitated: false,
        },
      },
    );
    if (spawnResult.success && spawnResult.data && spawnResult.data.entity) {
      spawned.push({
        shipType,
        entity: spawnResult.data.entity,
      });
    }
  }

  if (spawned.length === 0) {
    return handledResult(chatHub, session, options, "Fleet dummy spawn failed.");
  }

  const leadShip = spawned[0] && spawned[0].shipType;
  const trailingShip = spawned[spawned.length - 1] && spawned[spawned.length - 1].shipType;
  return handledResult(
    chatHub,
    session,
    options,
    [
      `Spawned ${spawned.length}/${formation.length} fleet dummies in a staggered arrowhead roughly ${Math.round(FIRE2_BASE_DISTANCE_METERS / 1000)} km ahead.`,
      leadShip && trailingShip
        ? `Formation runs ${leadShip.name} -> ${trailingShip.name} from largest to smallest.`
        : null,
    ].filter(Boolean).join(" "),
  );
}

function handleGmSkillsCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /gmskills.",
    );
  }

  const unpublishedSkillTypes = getUnpublishedSkillTypes({ refresh: true });
  if (unpublishedSkillTypes.length === 0) {
    return handledResult(
      chatHub,
      session,
      options,
      "No unpublished skill types are available in local reference data.",
    );
  }

  const previousQueueSnapshot = getQueueSnapshot(session.characterID);
  const previousSkillMap = getCharacterSkillMap(session.characterID);
  const grantedSkills = ensureCharacterUnpublishedSkills(session.characterID);
  reconcileQueueForSkillMutation(
    session.characterID,
    "prune_satisfied",
  );
  const nextQueueSnapshot = getQueueSnapshot(session.characterID);
  const targetDescriptor = {
    characterID: session.characterID,
    record: getCharacterRecord(session.characterID),
    session: sessionRegistry.findSessionByCharacterID(session.characterID) || session,
  };
  refreshLiveCharacterSkillSession(
    targetDescriptor.session,
    targetDescriptor,
    grantedSkills,
    previousSkillMap,
    {
      queueSnapshot: queueSnapshotChanged(previousQueueSnapshot, nextQueueSnapshot)
        ? nextQueueSnapshot
        : undefined,
    },
  );
  const polarisSkill = unpublishedSkillTypes.find((skillType) => Number(skillType.typeID) === 9955);
  const sampleNames = grantedSkills
    .slice(0, 5)
    .map((skill) => `${skill.itemName}(${skill.typeID})`)
    .join(", ");

  return handledResult(
    chatHub,
    session,
    options,
    [
      grantedSkills.length > 0
        ? `Ensured ${grantedSkills.length} GM/unpublished skills are at level V. You now have ${unpublishedSkillTypes.length}/${unpublishedSkillTypes.length}.`
        : `No GM/unpublished skills needed changes. You already have ${unpublishedSkillTypes.length}/${unpublishedSkillTypes.length}.`,
      polarisSkill ? `Catalog includes ${polarisSkill.name}(${polarisSkill.typeID}).` : null,
      sampleNames ? `Added: ${sampleNames}.` : null,
    ].filter(Boolean).join(" "),
  );
}

function handleAllSkillsCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /allskills.",
    );
  }

  const publishedSkillTypes = getPublishedSkillTypes({ refresh: true });
  if (publishedSkillTypes.length === 0) {
    return handledResult(
      chatHub,
      session,
      options,
      "No published skill types are available in local reference data.",
    );
  }

  const previousQueueSnapshot = getQueueSnapshot(session.characterID);
  const previousSkillMap = getCharacterSkillMap(session.characterID);
  const grantedSkills = ensureCharacterPublishedSkills(session.characterID);
  reconcileQueueForSkillMutation(
    session.characterID,
    "prune_satisfied",
  );
  const nextQueueSnapshot = getQueueSnapshot(session.characterID);
  const targetDescriptor = {
    characterID: session.characterID,
    record: getCharacterRecord(session.characterID),
    session: sessionRegistry.findSessionByCharacterID(session.characterID) || session,
  };
  refreshLiveCharacterSkillSession(
    targetDescriptor.session,
    targetDescriptor,
    grantedSkills,
    previousSkillMap,
    {
      queueSnapshot: queueSnapshotChanged(previousQueueSnapshot, nextQueueSnapshot)
        ? nextQueueSnapshot
        : undefined,
    },
  );
  const sampleNames = grantedSkills
    .slice(0, 5)
    .map((skill) => `${skill.itemName}(${skill.typeID})`)
    .join(", ");

  return handledResult(
    chatHub,
    session,
    options,
    [
      grantedSkills.length > 0
        ? `Ensured ${grantedSkills.length} published skills are at level V. You now have ${publishedSkillTypes.length}/${publishedSkillTypes.length}.`
        : `No published skills needed changes. You already have ${publishedSkillTypes.length}/${publishedSkillTypes.length}.`,
      sampleNames ? `Updated: ${sampleNames}.` : null,
    ].filter(Boolean).join(" "),
  );
}

function handleBackInTimeCommand(session, argumentText, chatHub, options) {
  const parsed = parseBackInTimeArguments(argumentText);
  if (!parsed.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /backintime [me|characterID|character name]",
    );
  }

  const targetResult = resolveCharacterTargetDescriptor(
    session,
    parsed.data.targetToken,
  );
  if (!targetResult.success) {
    const message =
      targetResult.errorMsg === "CHARACTER_NOT_SELECTED"
        ? "Select a character before using /backintime me."
        : `Character not found: ${parsed.data.targetToken}. Use me, a character ID, or an exact character name.`;
    return handledResult(chatHub, session, options, message);
  }

  const targetDescriptor = targetResult.data;
  const resetResult = resetCharacterSkillsToStarterProfile(
    targetDescriptor.characterID,
  );
  if (!resetResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      resetResult.errorMsg === "STARTER_PROFILE_NOT_FOUND"
        ? "No starter skill profile exists for that character's bloodline/race."
        : "Failed to restore starter skills.",
    );
  }

  const starterReset = resetResult.data;
  refreshLiveCharacterSkillSession(
    targetDescriptor.session,
    targetDescriptor,
    starterReset.changedSkillRecords,
    starterReset.previousSkillMap,
    {
      removedSkillRecords: starterReset.removedSkillRecords,
      emitSkillLevelsTrained: false,
      queueSnapshot: starterReset.queueSnapshot,
      freeSkillPoints: starterReset.freeSkillPoints,
    },
  );

  const targetLabel = formatCharacterTargetLabel(targetDescriptor);
  const starterProfile = starterReset.starterProfile;
  const queueCleared =
    starterReset.queueSnapshot &&
    Array.isArray(starterReset.queueSnapshot.queueEntries) &&
    starterReset.queueSnapshot.queueEntries.length === 0;

  return handledResult(
    chatHub,
    session,
    options,
    [
      `Reset ${targetLabel} to the ${starterProfile.raceName} starter skill bundle for ${starterProfile.bloodlineName}.`,
      `Restored ${starterProfile.starterSkills.length} starter skill records.`,
      starterReset.removedSkillRecords.length > 0
        ? `Removed ${starterReset.removedSkillRecords.length} non-starter skill records.`
        : "No non-starter skill records needed removal.",
      `Total SP is now ${Number(starterReset.totalSkillPoints || 0).toLocaleString()} and free SP is ${Number(starterReset.freeSkillPoints || 0).toLocaleString()}.`,
      queueCleared ? "Training queue cleared." : null,
    ].filter(Boolean).join(" "),
  );
}

function resolveExpertSystemFromTokens(tokens, startIndex = 0) {
  const sourceTokens = Array.isArray(tokens) ? tokens : [];
  for (let endIndex = sourceTokens.length; endIndex > startIndex; endIndex -= 1) {
    const queryText = sourceTokens.slice(startIndex, endIndex).join(" ").trim();
    if (!queryText) {
      continue;
    }
    const resolveResult = resolveExpertSystemCatalogQuery(queryText, {
      includeHidden: true,
      includeRetired: true,
    });
    if (resolveResult.success) {
      return {
        success: true,
        data: {
          expertSystem: resolveResult.data,
          consumedTokens: endIndex - startIndex,
          tailTokens: sourceTokens.slice(endIndex),
        },
      };
    }
    if (endIndex === startIndex + 1) {
      return resolveResult;
    }
  }

  return {
    success: false,
    errorMsg: "EXPERT_SYSTEM_REQUIRED",
    suggestions: [],
  };
}

function parseExpertSystemTail(tailTokens = []) {
  const targetTokens = [];
  let durationDays = null;
  for (const token of Array.isArray(tailTokens) ? tailTokens : []) {
    const text = String(token || "").trim();
    if (!text) {
      continue;
    }
    const durationMatch = /^(?:days|duration)=(\d+(?:\.\d+)?)$/i.exec(text);
    if (durationMatch) {
      const parsedDays = Number(durationMatch[1]);
      if (Number.isFinite(parsedDays) && parsedDays > 0) {
        durationDays = parsedDays;
      }
      continue;
    }
    targetTokens.push(text);
  }

  return {
    targetToken: targetTokens.join(" ").trim() || "me",
    durationDays,
  };
}

function resolveExpertSystemCommandTarget(session, targetToken) {
  const targetResult = resolveCharacterTargetDescriptor(session, targetToken || "me");
  if (targetResult.success) {
    return targetResult;
  }

  const message =
    targetResult.errorMsg === "CHARACTER_NOT_SELECTED"
      ? "Select a character first, or pass an explicit character target."
      : `Character not found: ${targetToken || "me"}. Use me, a character ID, or an exact character name.`;
  return {
    ...targetResult,
    message,
  };
}

function formatExpertSystemSummary(expertSystem) {
  if (!expertSystem) {
    return "Expert System";
  }
  return `${expertSystem.name}(${expertSystem.typeID})`;
}

function formatExpertSystemStatusLine(entry) {
  const expertSystem = entry && entry.expertSystem
    ? entry.expertSystem
    : getExpertSystemByTypeID(entry && entry.typeID);
  const expiresAtMs = Number(entry && entry.expiresAtMs) || 0;
  const remainingMs = Math.max(0, expiresAtMs - Date.now());
  const remainingDays = remainingMs / (24 * 60 * 60 * 1000);
  return [
    formatExpertSystemSummary(expertSystem || { typeID: entry && entry.typeID }),
    expiresAtMs > 0 ? `expires ${new Date(expiresAtMs).toISOString()}` : null,
    expiresAtMs > 0 ? `${remainingDays.toFixed(1)} days left` : null,
  ].filter(Boolean).join(" - ");
}

function handleExpertSystemCommand(session, argumentText, chatHub, options) {
  const tokens = tokenizeQuotedArguments(argumentText);
  const subcommand = normalizeCommandName(tokens[0] || "status");

  if (subcommand === "help") {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /expertsystem list | inspect <type|name> | status [me|characterID|name] | add <type|name> [target] [days=N] | remove <type|name|all> [target] | clear [target] | giveitem <type|name> [qty] | consume <itemID>",
    );
  }

  if (subcommand === "list") {
    const expertSystems = listExpertSystems({
      includeHidden: true,
      includeRetired: true,
    });
    const visibleCount = expertSystems.filter((entry) => !entry.hidden && !entry.retired).length;
    const sample = expertSystems
      .slice(0, 16)
      .map(formatExpertSystemSummary)
      .join(", ");
    return handledResult(
      chatHub,
      session,
      options,
      `Expert Systems authority contains ${expertSystems.length} systems (${visibleCount} normally activatable). ${sample ? `First entries: ${sample}.` : ""}`,
    );
  }

  if (subcommand === "status") {
    const targetText = tokens.slice(1).join(" ").trim() || "me";
    const targetResult = resolveExpertSystemCommandTarget(session, targetText);
    if (!targetResult.success) {
      return handledResult(chatHub, session, options, targetResult.message);
    }
    const targetDescriptor = targetResult.data;
    const status = getExpertSystemStatus(targetDescriptor.characterID);
    const activeEntries = Array.isArray(status.activeEntries) ? status.activeEntries : [];
    const targetLabel = formatCharacterTargetLabel(targetDescriptor);
    if (activeEntries.length === 0) {
      return handledResult(
        chatHub,
        session,
        options,
        `${targetLabel} has no active Expert Systems. Catalog count: ${status.catalogCount}.`,
      );
    }
    return handledResult(
      chatHub,
      session,
      options,
      `${targetLabel} has ${activeEntries.length} active Expert Systems: ${activeEntries.map(formatExpertSystemStatusLine).join("; ")}.`,
    );
  }

  if (subcommand === "inspect" || subcommand === "info") {
    const expertResult = resolveExpertSystemFromTokens(tokens, 1);
    if (!expertResult.success) {
      return handledResult(
        chatHub,
        session,
        options,
        `Expert System not found.${formatSuggestions(expertResult.suggestions)}`,
      );
    }
    const expertSystem = expertResult.data.expertSystem;
    return handledResult(
      chatHub,
      session,
      options,
      [
        `${formatExpertSystemSummary(expertSystem)} lasts ${expertSystem.durationDays} days.`,
        `Skills granted: ${expertSystem.skillsGranted.length}.`,
        expertSystem.associatedTypeIDs.length > 0
          ? `Associated item types: ${expertSystem.associatedTypeIDs.slice(0, 12).join(", ")}${expertSystem.associatedTypeIDs.length > 12 ? ", ..." : ""}.`
          : null,
        expertSystem.hidden ? "Hidden." : null,
        expertSystem.retired ? "Retired." : null,
      ].filter(Boolean).join(" "),
    );
  }

  if (subcommand === "add" || subcommand === "install") {
    const expertResult = resolveExpertSystemFromTokens(tokens, 1);
    if (!expertResult.success) {
      return handledResult(
        chatHub,
        session,
        options,
        `Expert System not found.${formatSuggestions(expertResult.suggestions)}`,
      );
    }
    const tail = parseExpertSystemTail(expertResult.data.tailTokens);
    const targetResult = resolveExpertSystemCommandTarget(session, tail.targetToken);
    if (!targetResult.success) {
      return handledResult(chatHub, session, options, targetResult.message);
    }
    const expertSystem = expertResult.data.expertSystem;
    const targetDescriptor = targetResult.data;
    const installResult = installExpertSystemForCharacter(
      targetDescriptor.characterID,
      expertSystem.typeID,
      {
        session: targetDescriptor.session,
        force: true,
        grantReason: "gm",
        durationDays: tail.durationDays || undefined,
      },
    );
    if (!installResult.success) {
      return handledResult(chatHub, session, options, installResult.message || "Expert System install failed.");
    }
    return handledResult(
      chatHub,
      session,
      options,
      `Installed ${formatExpertSystemSummary(expertSystem)} for ${formatCharacterTargetLabel(targetDescriptor)}${installResult.data.isTopUp ? " as a top-up" : ""}.`,
    );
  }

  if (subcommand === "remove" || subcommand === "uninstall") {
    if (normalizeCommandName(tokens[1] || "") === "all") {
      const targetText = tokens.slice(2).join(" ").trim() || "me";
      const targetResult = resolveExpertSystemCommandTarget(session, targetText);
      if (!targetResult.success) {
        return handledResult(chatHub, session, options, targetResult.message);
      }
      const clearResult = clearExpertSystemsForCharacter(targetResult.data.characterID, {
        session: targetResult.data.session,
      });
      if (!clearResult.success) {
        return handledResult(chatHub, session, options, clearResult.message || "Expert System clear failed.");
      }
      return handledResult(
        chatHub,
        session,
        options,
        `Removed ${Array.isArray(clearResult.data) ? clearResult.data.length : 0} Expert Systems from ${formatCharacterTargetLabel(targetResult.data)}.`,
      );
    }

    const expertResult = resolveExpertSystemFromTokens(tokens, 1);
    if (!expertResult.success) {
      return handledResult(
        chatHub,
        session,
        options,
        `Expert System not found.${formatSuggestions(expertResult.suggestions)}`,
      );
    }
    const tail = parseExpertSystemTail(expertResult.data.tailTokens);
    const targetResult = resolveExpertSystemCommandTarget(session, tail.targetToken);
    if (!targetResult.success) {
      return handledResult(chatHub, session, options, targetResult.message);
    }
    const expertSystem = expertResult.data.expertSystem;
    const removeResult = removeExpertSystemFromCharacter(
      targetResult.data.characterID,
      expertSystem.typeID,
      { session: targetResult.data.session },
    );
    if (!removeResult.success) {
      return handledResult(chatHub, session, options, removeResult.message || "Expert System removal failed.");
    }
    return handledResult(
      chatHub,
      session,
      options,
      removeResult.removed
        ? `Removed ${formatExpertSystemSummary(expertSystem)} from ${formatCharacterTargetLabel(targetResult.data)}.`
        : `${formatCharacterTargetLabel(targetResult.data)} did not have ${formatExpertSystemSummary(expertSystem)} installed.`,
    );
  }

  if (subcommand === "clear") {
    const targetText = tokens.slice(1).join(" ").trim() || "me";
    const targetResult = resolveExpertSystemCommandTarget(session, targetText);
    if (!targetResult.success) {
      return handledResult(chatHub, session, options, targetResult.message);
    }
    const clearResult = clearExpertSystemsForCharacter(targetResult.data.characterID, {
      session: targetResult.data.session,
    });
    if (!clearResult.success) {
      return handledResult(chatHub, session, options, clearResult.message || "Expert System clear failed.");
    }
    return handledResult(
      chatHub,
      session,
      options,
      `Cleared ${Array.isArray(clearResult.data) ? clearResult.data.length : 0} Expert Systems from ${formatCharacterTargetLabel(targetResult.data)}.`,
    );
  }

  if (subcommand === "giveitem") {
    const expertResult = resolveExpertSystemFromTokens(tokens, 1);
    if (!expertResult.success) {
      return handledResult(
        chatHub,
        session,
        options,
        `Expert System not found.${formatSuggestions(expertResult.suggestions)}`,
      );
    }
    const quantityToken = expertResult.data.tailTokens.find((token) => parseStrictInteger(token) !== null);
    const quantity = Math.max(1, parseStrictInteger(quantityToken) || 1);
    const expertSystem = expertResult.data.expertSystem;
    const itemType = resolveItemByTypeID(expertSystem.typeID) || expertSystem;
    const giveResult = giveItemToHangarForSession(
      session,
      itemType,
      quantity,
    );
    if (!giveResult.success) {
      const message =
        giveResult.errorMsg === "DOCK_REQUIRED"
          ? "You must be docked before using /expertsystem giveitem."
          : giveResult.errorMsg === "CHARACTER_NOT_SELECTED"
            ? "Select a character before using /expertsystem giveitem."
            : "Expert System item grant failed.";
      return handledResult(chatHub, session, options, message);
    }
    return handledResult(
      chatHub,
      session,
      options,
      `Placed ${quantity}x ${formatExpertSystemSummary(expertSystem)} item in your hangar.`,
    );
  }

  if (subcommand === "consume") {
    const itemID = normalizePositiveInteger(tokens[1]);
    if (!itemID) {
      return handledResult(chatHub, session, options, "Usage: /expertsystem consume <itemID>");
    }
    const characterID = normalizePositiveInteger(session && session.characterID);
    if (!characterID) {
      return handledResult(chatHub, session, options, "Select a character before consuming an Expert System.");
    }
    const consumeResult = consumeExpertSystemItem(characterID, itemID, session, {
      throwOnError: false,
    });
    if (!consumeResult.success) {
      return handledResult(chatHub, session, options, consumeResult.message || "Expert System consume failed.");
    }
    return handledResult(
      chatHub,
      session,
      options,
      `Consumed ${formatExpertSystemSummary(consumeResult.data.expertSystem)} and installed it on your character.`,
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    "Usage: /expertsystem list | inspect <type|name> | status [target] | add <type|name> [target] [days=N] | remove <type|name|all> [target] | clear [target] | giveitem <type|name> [qty] | consume <itemID>",
  );
}

function handleGiveSkillCommand(session, argumentText, chatHub, options) {
  const parsed = parseGiveSkillArguments(argumentText);
  if (!parsed.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /giveskill <target> <skill name|typeID|all|super> [level]",
    );
  }

  const targetResult = resolveCharacterTargetDescriptor(
    session,
    parsed.data.targetToken,
  );
  if (!targetResult.success) {
    const message =
      targetResult.errorMsg === "CHARACTER_NOT_SELECTED"
        ? "Select a character before using /giveskill me."
        : `Character not found: ${parsed.data.targetToken}. Use me, a character ID, or an exact character name.`;
    return handledResult(chatHub, session, options, message);
  }

  const skillResult = resolveSkillGrantDescriptor(parsed.data.skillToken);
  if (!skillResult.success) {
    const suggestions = formatSuggestions(skillResult.suggestions);
    const label =
      skillResult.errorMsg === "SKILL_AMBIGUOUS"
        ? `Skill is ambiguous: ${parsed.data.skillToken}.${suggestions}`
        : `Skill not found: ${parsed.data.skillToken}.${suggestions}`;
    return handledResult(chatHub, session, options, label);
  }

  const targetDescriptor = targetResult.data;
  const skillDescriptor = skillResult.data;
  const previousQueueSnapshot = getQueueSnapshot(targetDescriptor.characterID);
  const previousSkillMap = getCharacterSkillMap(targetDescriptor.characterID);
  const grantResult = applySkillGrantToCharacter(
    targetDescriptor,
    skillDescriptor,
    parsed.data.level,
    previousSkillMap,
  );
  if (!grantResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Failed to update character skills.",
    );
  }

  const changedSkills = dedupeSkillRecords(grantResult.data.changedSkills);
  const clearQueueForMutation = skillMutationLowersExistingLevels(
    changedSkills,
    previousSkillMap,
  );
  const queueResult = reconcileQueueForSkillMutation(
    targetDescriptor.characterID,
    clearQueueForMutation ? "clear" : "prune_satisfied",
  );
  const nextQueueSnapshot = queueResult.snapshot || getQueueSnapshot(targetDescriptor.characterID);
  refreshLiveCharacterSkillSession(
    targetDescriptor.session,
    targetDescriptor,
    changedSkills,
    previousSkillMap,
    {
      emitSkillLevelsTrained: !clearQueueForMutation,
      queueSnapshot: queueSnapshotChanged(previousQueueSnapshot, nextQueueSnapshot)
        ? nextQueueSnapshot
        : undefined,
    },
  );

  const targetLabel = formatCharacterTargetLabel(targetDescriptor);
  const normalizedLevelLabel = formatSkillLevelLabel(parsed.data.level);
  const levelClampNotice =
    parsed.data.requestedLevel !== null && parsed.data.requestedLevel !== parsed.data.level
      ? ` Requested level ${parsed.data.requestedLevel} was clamped to ${parsed.data.level}.`
      : "";

  if (skillDescriptor.selector === "all") {
    return handledResult(
      chatHub,
      session,
      options,
      [
        `Set all published skills for ${targetLabel} to level ${normalizedLevelLabel}.`,
        changedSkills.length > 0
          ? `Updated ${changedSkills.length} skills.`
          : "All published skills already matched the requested level.",
        levelClampNotice.trim() || null,
      ].filter(Boolean).join(" "),
    );
  }

  if (skillDescriptor.selector === "super") {
    return handledResult(
      chatHub,
      session,
      options,
      [
        `Set all published and unpublished skills for ${targetLabel} to level ${normalizedLevelLabel}.`,
        changedSkills.length > 0
          ? `Updated ${changedSkills.length} skills.`
          : "All skills already matched the requested level.",
        levelClampNotice.trim() || null,
      ].filter(Boolean).join(" "),
    );
  }

  const skillType = skillDescriptor.skillType;
  return handledResult(
    chatHub,
    session,
    options,
    [
      changedSkills.length > 0
        ? `Set ${skillType.name}(${skillType.typeID}) for ${targetLabel} to level ${normalizedLevelLabel}.`
        : `${targetLabel} already has ${skillType.name}(${skillType.typeID}) at level ${normalizedLevelLabel}.`,
      levelClampNotice.trim() || null,
    ].filter(Boolean).join(" "),
  );
}

function handleRemoveSkillCommand(session, argumentText, chatHub, options) {
  const parsed = parseRemoveSkillArguments(argumentText);
  if (!parsed.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /removeskill <target> <skill name|typeID|all>",
    );
  }

  const targetResult = resolveCharacterTargetDescriptor(
    session,
    parsed.data.targetToken,
  );
  if (!targetResult.success) {
    const message =
      targetResult.errorMsg === "CHARACTER_NOT_SELECTED"
        ? "Select a character before using /removeskill me."
        : `Character not found: ${parsed.data.targetToken}. Use me, a character ID, or an exact character name.`;
    return handledResult(chatHub, session, options, message);
  }

  const skillResult = resolveSkillRemovalDescriptor(parsed.data.skillToken);
  if (!skillResult.success) {
    const suggestions = formatSuggestions(skillResult.suggestions);
    const label =
      skillResult.errorMsg === "SKILL_AMBIGUOUS"
        ? `Skill is ambiguous: ${parsed.data.skillToken}.${suggestions}`
        : `Skill not found: ${parsed.data.skillToken}.${suggestions}`;
    return handledResult(chatHub, session, options, label);
  }

  const targetDescriptor = targetResult.data;
  const skillDescriptor = skillResult.data;
  const previousQueueSnapshot = getQueueSnapshot(targetDescriptor.characterID);
  const previousSkillMap = getCharacterSkillMap(targetDescriptor.characterID);
  const removalResult = applySkillRemovalToCharacter(targetDescriptor, skillDescriptor);
  if (!removalResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Failed to update character skills.",
    );
  }

  const changedSkills = dedupeSkillRecords(removalResult.data.changedSkills);
  const queueResult = reconcileQueueForSkillMutation(
    targetDescriptor.characterID,
    "clear",
  );
  const nextQueueSnapshot = queueResult.snapshot || getQueueSnapshot(targetDescriptor.characterID);
  refreshLiveCharacterSkillSession(
    targetDescriptor.session,
    targetDescriptor,
    [],
    previousSkillMap,
    {
      removed: true,
      removedSkillRecords: changedSkills,
      queueSnapshot: queueSnapshotChanged(previousQueueSnapshot, nextQueueSnapshot)
        ? nextQueueSnapshot
        : undefined,
    },
  );

  const targetLabel = formatCharacterTargetLabel(targetDescriptor);
  if (skillDescriptor.selector === "all") {
    return handledResult(
      chatHub,
      session,
      options,
      changedSkills.length > 0
        ? `Removed all skills from ${targetLabel}. Deleted ${changedSkills.length} skill records.`
        : `${targetLabel} already has no skills.`,
    );
  }

  const skillType = skillDescriptor.skillType;
  return handledResult(
    chatHub,
    session,
    options,
    changedSkills.length > 0
      ? `Removed ${skillType.name}(${skillType.typeID}) from ${targetLabel}.`
      : `${targetLabel} does not have ${skillType.name}(${skillType.typeID}).`,
  );
}

function handleGmShipsCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /gmships.",
    );
  }

  if (!isDockedSession(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be docked before using /gmships.",
    );
  }

  const unpublishedShips = getUnpublishedShipTypes();
  if (unpublishedShips.length === 0) {
    return handledResult(
      chatHub,
      session,
      options,
      "No unpublished ship types are available in local reference data.",
    );
  }

  const createdShips = [];
  for (const shipType of unpublishedShips) {
    const spawnResult = spawnShipInHangarForSession(session, shipType);
    if (!spawnResult.success) {
      let message = "GM ship bulk spawn failed.";
      if (spawnResult.errorMsg === "DOCK_REQUIRED") {
        message = "You must be docked before using /gmships.";
      } else if (spawnResult.errorMsg === "CHARACTER_NOT_SELECTED") {
        message = "Select a character before using /gmships.";
      }
      return handledResult(chatHub, session, options, message);
    }
    createdShips.push(spawnResult.ship);
  }

  const sampleNames = unpublishedShips
    .slice(0, 5)
    .map((shipType) => `${shipType.name}(${shipType.typeID})`)
    .join(", ");

  return handledResult(
    chatHub,
    session,
    options,
    [
      `Added ${createdShips.length}/${unpublishedShips.length} unpublished ships to your hangar.`,
      sampleNames ? `Sample: ${sampleNames}.` : null,
    ].filter(Boolean).join(" "),
  );
}

function handlePropCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /prop.",
    );
  }

  if (!isDockedSession(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be docked before using /prop.",
    );
  }

  const propulsionTypes = getPropulsionCommandItemTypes();
  if (propulsionTypes.length === 0) {
    return handledResult(
      chatHub,
      session,
      options,
      "No propulsion module types matched the /prop filter in local reference data.",
    );
  }

  const createdItems = [];
  for (const itemType of propulsionTypes) {
    const giveResult = giveItemToHangarForSession(session, itemType, 1);
    if (!giveResult.success) {
      let message = "Propulsion module grant failed.";
      if (giveResult.errorMsg === "DOCK_REQUIRED") {
        message = "You must be docked before using /prop.";
      } else if (giveResult.errorMsg === "CHARACTER_NOT_SELECTED") {
        message = "Select a character before using /prop.";
      } else if (giveResult.errorMsg === "ITEM_TYPE_NOT_FOUND") {
        message = `A /prop item type could not be resolved: ${itemType.name}.`;
      }
      return handledResult(chatHub, session, options, message);
    }
    createdItems.push(...(Array.isArray(giveResult.data.items) ? giveResult.data.items : []));
  }

  const sampleNames = propulsionTypes
    .slice(0, 8)
    .map((itemType) => `${itemType.name}(${itemType.typeID})`)
    .join(", ");

  return handledResult(
    chatHub,
    session,
    options,
    [
      `Added ${createdItems.length}/${propulsionTypes.length} propulsion modules to your station hangar.`,
      "Included: T2, faction, and officer afterburners/microwarpdrives.",
      sampleNames ? `Sample: ${sampleNames}.` : null,
    ].filter(Boolean).join(" "),
  );
}

function handleGmWeaponsCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /gmweapons.",
    );
  }

  const stationID = Number(getDockedLocationID(session) || 0) || 0;
  if (stationID <= 0) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be docked before using /gmweapons.",
    );
  }

  if (activeGmWeaponsJobs.has(Number(session.characterID))) {
    const existingJob = activeGmWeaponsJobs.get(Number(session.characterID));
    return handledResult(
      chatHub,
      session,
      options,
      `A /gmweapons seed job is already running (${existingJob.nextIndex}/${existingJob.entries.length} grants queued).`,
    );
  }

  const plan = getGmWeaponsSeedPlan();
  if (!plan.entries.length) {
    return handledResult(
      chatHub,
      session,
      options,
      "No non-T1 weapon or ammo types matched the /gmweapons filter in local reference data.",
    );
  }

  const sample = plan.weaponTypes
    .slice(0, 6)
    .map((itemType) => `${itemType.name}(${itemType.typeID})`)
    .join(", ");

  const job = {
    session,
    characterID: Number(session.characterID) || 0,
    stationID,
    feedbackChannel: getFeedbackChannel(options),
    entries: plan.entries,
    nextIndex: 0,
    weaponTypeCount: plan.weaponTypes.length,
    ammoTypeCount: plan.ammoTypes.length,
    sample,
  };
  activeGmWeaponsJobs.set(job.characterID, job);
  setImmediate(() => continueGmWeaponsSeedJob(job, chatHub));

  return handledResult(
    chatHub,
    session,
    options,
    [
      `Started /gmweapons in the background for station ${stationID}.`,
      `Queue: ${plan.weaponTypes.length} weapon stacks x${GM_WEAPONS_MODULE_QUANTITY} and ${plan.ammoTypes.length} ammo stacks x${GM_WEAPONS_AMMO_QUANTITY}.`,
      sample ? `Sample: ${sample}.` : null,
    ].filter(Boolean).join(" "),
  );
}

function handleSolarTeleport(session, argumentText, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /solar.",
    );
  }

  if (!argumentText) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /solar <system name>",
    );
  }

  const lookup = resolveSolarSystemByName(argumentText);
  if (!lookup.success) {
    const message =
      lookup.errorMsg === "SOLAR_SYSTEM_NOT_FOUND"
        ? `Solar system not found: ${argumentText}.${formatSuggestions(lookup.suggestions)}`
        : `Solar system name is ambiguous: ${argumentText}.${formatSuggestions(lookup.suggestions)}`;
    return handledResult(chatHub, session, options, message.trim());
  }

  const result = jumpSessionToSolarSystem(session, lookup.match.solarSystemID);
  if (!result.success) {
    let message = "Solar-system jump failed.";
    if (result.errorMsg === "SHIP_NOT_FOUND") {
      message = "Active ship not found for this character.";
    } else if (result.errorMsg === "CHARACTER_NOT_SELECTED") {
      message = "Select a character before using /solar.";
    } else if (result.errorMsg === "SOLAR_SYSTEM_NOT_FOUND") {
      message = `Solar system not found: ${lookup.match.solarSystemName}.`;
    } else if (result.errorMsg === "SOLAR_JUMP_IN_PROGRESS") {
      message = "A solar-system jump is already in progress for this character.";
    }

    return handledResult(chatHub, session, options, message);
  }

  const spawnState = result.data && result.data.spawnState;
  const targetSolarSystem =
    (result.data && result.data.solarSystem) ||
    worldData.getSolarSystemByID(lookup.match.solarSystemID);
  const anchorText = spawnState
    ? ` near ${spawnState.anchorType} ${spawnState.anchorName}`
    : "";

  // The transition path should already send the correct full location identity.
  // Keep a command-side backstop here so /solar does not depend exclusively on
  // later session hydration if region/constellation drift again.
  reconcileSolarTargetSessionIdentity(session, targetSolarSystem);

  // Move Local before emitting feedback so slash responses do not land in the
  // new system while the client is still joined to the previous room.
  flushPendingLocalChannelSync(chatHub, session);

  return handledResult(
    chatHub,
    session,
    getPostLocalMoveFeedbackOptions(options),
    `Teleported to ${lookup.match.solarSystemName} (${lookup.match.solarSystemID})${anchorText}.`,
  );
}

function handleTransportCommand(session, argumentText, chatHub, options) {
  const usage = "Usage: /tr <me|characterID|entityID> <destination|pos=x,y,z|offset=x,y,z>";
  const tokens = String(argumentText || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length < 2) {
    return handledResult(chatHub, session, options, usage);
  }

  const targetResult = resolveTransportTargetDescriptor(session, tokens[0]);
  if (!targetResult.success) {
    const message =
      targetResult.errorMsg === "CHARACTER_NOT_SELECTED"
        ? "Select a character before using /tr."
        : targetResult.errorMsg === "TARGET_NOT_FOUND"
          ? `Transport target not found: ${tokens[0]}.`
          : usage;
    return handledResult(chatHub, session, options, message);
  }

  const targetDescriptor = targetResult.data;
  const destinationTokens = tokens
    .slice(1)
    .filter((token) => String(token || "").trim().toLowerCase() !== "noblock");
  if (destinationTokens.length === 0) {
    return handledResult(chatHub, session, options, usage);
  }

  let destination = null;
  const directPos = parseTransportVectorTag(destinationTokens[0], "pos");
  const directOffset = parseTransportVectorTag(destinationTokens[0], "offset");
  if (directPos) {
    if (destinationTokens.length !== 1) {
      return handledResult(chatHub, session, options, usage);
    }
    const pointContext = resolveTransportPointContext(session, targetDescriptor);
    if (!pointContext || !pointContext.systemID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Could not resolve a solar-system context for /tr pos=...",
      );
    }
    destination = {
      kind: "point",
      systemID: pointContext.systemID,
      point: directPos,
      direction: cloneSpaceVector(
        pointContext.direction,
        { x: 1, y: 0, z: 0 },
      ),
    };
  } else if (directOffset) {
    if (destinationTokens.length !== 1) {
      return handledResult(chatHub, session, options, usage);
    }
    const anchor =
      targetDescriptor.kind === "session"
        ? getSessionTransportAnchor(targetDescriptor.session)
        : buildTransportPointAnchor(
          targetDescriptor.entity,
          targetDescriptor.systemID,
        );
    destination = withTransportOffset(anchor, directOffset);
    if (!destination) {
      return handledResult(
        chatHub,
        session,
        options,
        "Could not apply /tr offset=... because the target has no in-space anchor.",
      );
    }
  } else {
    const coordinateTriplet = parseTransportCoordinateTriplet(destinationTokens);
    if (coordinateTriplet) {
      const pointContext = resolveTransportPointContext(session, targetDescriptor);
      if (!pointContext || !pointContext.systemID) {
        return handledResult(
          chatHub,
          session,
          options,
          "Could not resolve a solar-system context for raw /tr coordinates.",
        );
      }
      destination = {
        kind: "point",
        systemID: pointContext.systemID,
        point: coordinateTriplet,
        direction: cloneSpaceVector(
          pointContext.direction,
          { x: 1, y: 0, z: 0 },
        ),
      };
    } else {
      const offsetToken = parseTransportVectorTag(
        destinationTokens[destinationTokens.length - 1],
        "offset",
      );
      const baseTokens = offsetToken
        ? destinationTokens.slice(0, -1)
        : destinationTokens;
      if (baseTokens.length !== 1) {
        return handledResult(chatHub, session, options, usage);
      }

      const baseDestination = resolveTransportLocationToken(
        session,
        targetDescriptor,
        baseTokens[0],
      );
      if (!baseDestination) {
        return handledResult(
          chatHub,
          session,
          options,
          `Transport destination not found: ${baseTokens[0]}.`,
        );
      }

      if (offsetToken) {
        destination = withTransportOffset(baseDestination, offsetToken);
        if (!destination) {
          return handledResult(
            chatHub,
            session,
            options,
            "Could not apply /tr offset=... to that destination.",
          );
        }
      } else {
        destination = baseDestination;
      }
    }
  }

  const targetLabel = formatTransportTargetLabel(targetDescriptor);
  const destinationLabel = formatTransportDestinationLabel(destination);

  if (targetDescriptor.kind === "session") {
    return executeSessionTransportTarget(
      session,
      targetDescriptor,
      destination,
      chatHub,
      options,
    );
  }

  if (destination.kind !== "point" || !destination.point) {
    return handledResult(
      chatHub,
      session,
      options,
      "Runtime entity /tr currently supports only in-space point moves.",
    );
  }

  if (
    normalizePositiveInteger(destination.systemID) !==
    normalizePositiveInteger(targetDescriptor.systemID)
  ) {
    return handledResult(
      chatHub,
      session,
      options,
      "Runtime entities can only be moved within their current solar system.",
    );
  }

  const entityMoveResult = spaceRuntime.teleportDynamicEntityToPoint(
    targetDescriptor.systemID,
    targetDescriptor.entity.itemID,
    destination.point,
    {
      direction: destination.direction,
      refreshOwnerSession: false,
    },
  );
  if (!entityMoveResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Failed to transport ${targetLabel}.`,
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Transported ${targetLabel} to ${destinationLabel}.`,
  );
}

function handleTeleCommand(session, argumentText, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /tele.",
    );
  }

  const targetToken = String(argumentText || "").trim();
  if (!targetToken) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /tele <character name|characterID>",
    );
  }

  const targetResult = resolveCharacterTargetDescriptor(session, targetToken);
  if (!targetResult.success || !targetResult.data) {
    return handledResult(
      chatHub,
      session,
      options,
      targetResult.errorMsg === "CHARACTER_NOT_SELECTED"
        ? "Select a character before using /tele."
        : `Character not found: ${targetToken}.`,
    );
  }

  const targetDescriptor = targetResult.data;
  if (!targetDescriptor.session || !targetDescriptor.session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      `${formatCharacterTargetLabel(targetDescriptor)} is not currently connected.`,
    );
  }

  const destination = buildTransportDestinationFromSession(targetDescriptor.session);
  if (!destination) {
    return handledResult(
      chatHub,
      session,
      options,
      `Could not resolve a live location for ${formatCharacterTargetLabel(targetDescriptor)}.`,
    );
  }

  return executeSessionTransportTarget(
    session,
    {
      kind: "session",
      session,
      label: "me",
    },
    destination,
    chatHub,
    options,
  );
}

function handleSetStandingCommand(session, argumentText, chatHub, options) {
  const usage = "Usage: /setstanding <value> <owner name|id> [target]";
  const tokens = tokenizeQuotedArguments(argumentText);
  if (tokens.length < 2) {
    return handledResult(chatHub, session, options, usage);
  }

  const standingValue = Number(tokens[0]);
  if (!Number.isFinite(standingValue) || standingValue < -10 || standingValue > 10) {
    return handledResult(
      chatHub,
      session,
      options,
      "Standing value must be a number between -10.0 and 10.0.",
    );
  }

  const targetResolution = resolveTrailingCharacterTargetDescriptor(
    session,
    tokens,
    1,
  );
  if (!targetResolution.success) {
    return handledResult(
      chatHub,
      session,
      options,
      targetResolution.errorMsg === "CHARACTER_NOT_SELECTED"
        ? "Select a character before using /setstanding."
        : usage,
    );
  }

  const { ownerToken, targetDescriptor } = targetResolution.data;
  if (!ownerToken) {
    return handledResult(chatHub, session, options, usage);
  }

  const ownerResolution = resolveStandingOwnerDescriptor(ownerToken);
  if (!ownerResolution.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Could not resolve a standing owner from "${ownerToken}".`,
    );
  }

  const ownerDescriptor = ownerResolution.data;
  const writeResult = standingRuntime.setCharacterStanding(
    targetDescriptor.characterID,
    ownerDescriptor.ownerID,
    standingValue,
    {
      eventTypeID: standingRuntime.EVENT_STANDING_SLASH_SET,
      message: `GM /setstanding ${standingValue} ${ownerToken}`,
    },
  );
  if (!writeResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Could not update the requested standing.",
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Set standing with ${formatStandingOwnerLabel(ownerDescriptor)} to ${Number(standingValue).toFixed(2)} for ${formatCharacterTargetLabel(targetDescriptor)}.`,
  );
}

function handleMaxAgentStandingsCommand(session, argumentText, chatHub, options) {
  const targetToken = String(argumentText || "").trim() || "me";
  const targetResolution = resolveCharacterTargetDescriptor(session, targetToken);
  if (!targetResolution.success) {
    return handledResult(
      chatHub,
      session,
      options,
      targetResolution.errorMsg === "CHARACTER_NOT_SELECTED"
        ? "Select a character before using /maxagentstandings."
        : `Character not found: ${targetToken}.`,
    );
  }

  const targetDescriptor = targetResolution.data;
  const standingOwners = standingRuntime.getAllAgentStandingOwners();
  const corporationIDs = Array.isArray(standingOwners && standingOwners.corporationIDs)
    ? standingOwners.corporationIDs.filter((ownerID) => Number(ownerID) > 0)
    : [];
  const factionIDs = Array.isArray(standingOwners && standingOwners.factionIDs)
    ? standingOwners.factionIDs.filter((ownerID) => Number(ownerID) > 0)
    : [];
  const entries = [
    ...corporationIDs.map((ownerID) => ({ ownerID, standing: 10.0 })),
    ...factionIDs.map((ownerID) => ({ ownerID, standing: 10.0 })),
  ];
  if (entries.length <= 0) {
    return handledResult(
      chatHub,
      session,
      options,
      "No agent corporations or factions were available to update.",
    );
  }

  const writeResult = standingRuntime.setCharacterStandings(
    targetDescriptor.characterID,
    entries,
    {
      eventTypeID: standingRuntime.EVENT_STANDING_SLASH_SET,
      message: "GM /maxagentstandings",
    },
  );
  if (!writeResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Could not max the agent standings set.",
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Set ${corporationIDs.length} agent corporation standings and ${factionIDs.length} agent faction standings to 10.00 for ${formatCharacterTargetLabel(targetDescriptor)}.`,
  );
}

function handleSigscanCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /sigscan.",
    );
  }

  const scanMgr = new ScanMgrService();
  const result = scanMgr.resolveAllSystemSignaturesForSession(session, {
    durationMs: 1,
  });
  if (!result.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Could not resolve signatures for the current system.",
    );
  }

  const systemID = Number(result.data && result.data.systemID) || 0;
  const signatureCount = Number(result.data && result.data.signatureCount) || 0;
  const system = worldData.getSolarSystemByID(systemID);
  const systemLabel =
    (system && system.solarSystemName) ||
    (systemID > 0 ? `system ${systemID}` : "the current system");
  return handledResult(
    chatHub,
    session,
    options,
    signatureCount > 0
      ? `Resolved ${signatureCount} signature${signatureCount === 1 ? "" : "s"} to 100% in ${systemLabel}.`
      : `No scannable signatures are currently present in ${systemLabel}.`,
  );
}

function handleSigsCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /sigs.",
    );
  }

  const systemID = Number(
    (session._space && session._space.systemID) ||
    session.solarsystemid2 ||
    session.solarsystemid ||
    0
  ) || 0;
  if (systemID <= 0) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space to inspect live signatures.",
    );
  }

  const sites = signatureRuntime.buildSystemScannableViews(systemID);
  const system = worldData.getSolarSystemByID(systemID);
  const systemLabel =
    (system && system.solarSystemName) ||
    (systemID > 0 ? `system ${systemID}` : "the current system");
  if (sites.length <= 0) {
    return handledResult(
      chatHub,
      session,
      options,
      `No scannable sites are currently present in ${systemLabel}.`,
    );
  }

  const lines = sites.map((entry) => (
    `${entry.targetID} | ${entry.siteKind} | ${entry.family} | ${entry.label}` +
    `${entry.pairKind ? ` | ${entry.pairKind}` : ""} | site ${entry.siteID}`
  ));
  return handledResult(
    chatHub,
    session,
    options,
    [
      `Scannable sites in ${systemLabel} (${sites.length}):`,
      ...lines,
    ].join("\n"),
  );
}

function handleMissionCompleteCommand(session, argumentText, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /missioncomplete.",
    );
  }

  const targetToken = String(argumentText || "").trim();
  const agentTarget = targetToken.length > 0 ? targetToken : "all";
  const result = markMissionObjectiveComplete(session.characterID, {
    agentID: agentTarget,
  });
  if (!result.success) {
    return handledResult(
      chatHub,
      session,
      options,
      result.errorMsg === "MISSION_NOT_FOUND"
        ? "No accepted placeholder mission objectives were found to mark complete."
        : "Placeholder mission completion failed.",
    );
  }

  const markedAgentIDs = Array.isArray(result.data && result.data.markedAgentIDs)
    ? result.data.markedAgentIDs.filter((agentID) => Number(agentID) > 0)
    : [];
  const missionCount = markedAgentIDs.length;
  if (missionCount <= 0) {
    return handledResult(
      chatHub,
      session,
      options,
      "No accepted placeholder mission objectives were found to mark complete.",
    );
  }

  const suffix = missionCount === 1 ? "" : "s";
  const agentSuffix = missionCount === 1 ? "" : "s";
  const details =
    missionCount === 1
      ? ` Agent ${markedAgentIDs[0]} is now ready to hand in.`
      : ` Agents: ${markedAgentIDs.join(", ")}.`;
  return handledResult(
    chatHub,
    session,
    options,
    `Marked ${missionCount} placeholder mission objective${suffix} complete.${details} Talk to the agent${agentSuffix} and click Complete Mission.`,
  );
}

function handleOverlayRefreshCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /overlayrefresh.",
    );
  }

  const systemID = Number(
    (session._space && session._space.systemID) ||
    session.solarsystemid2 ||
    session.solarsystemid ||
    0
  ) || 0;
  if (systemID <= 0) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space to refresh the sensor overlay.",
    );
  }

  const scanMgr = new ScanMgrService();
  const refreshResult = scanMgr.refreshSignalTrackerForSession(session, {
    shouldRemoveOldSites: true,
  });
  if (!refreshResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Could not refresh the sensor overlay for the current system.",
    );
  }

  const system = worldData.getSolarSystemByID(systemID);
  const systemLabel =
    (system && system.solarSystemName) ||
    (systemID > 0 ? `system ${systemID}` : "the current system");
  return handledResult(
    chatHub,
    session,
    options,
    `Refreshed the sensor overlay for ${systemLabel}.`,
  );
}

function handleHomeDock(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /dock.",
    );
  }

  const homeStationID = Number(
    session.homeStationID ||
    session.homestationid ||
    session.cloneStationID ||
    session.clonestationid ||
    0,
  ) || 0;

  if (!homeStationID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Home station is not set for this character.",
    );
  }

  if (
    Number(session.stationid || session.stationID || 0) === homeStationID
  ) {
    return handledResult(
      chatHub,
      session,
      options,
      `Already docked at home station ${homeStationID}.`,
    );
  }

  const result = jumpSessionToStation(session, homeStationID);
  if (!result.success) {
    let message = "Dock command failed.";
    if (result.errorMsg === "SHIP_NOT_FOUND") {
      message = "Active ship not found for this character.";
    } else if (result.errorMsg === "CHARACTER_NOT_SELECTED") {
      message = "Select a character before using /dock.";
    } else if (result.errorMsg === "STATION_NOT_FOUND") {
      message = `Home station not found: ${homeStationID}.`;
    } else if (result.errorMsg === "STATION_JUMP_IN_PROGRESS") {
      message = "A dock transition is already in progress for this character.";
    }

    return handledResult(chatHub, session, options, message);
  }

  const station = result.data && result.data.station;
  flushPendingLocalChannelSync(chatHub, session);
  return handledResult(
    chatHub,
    session,
    getPostLocalMoveFeedbackOptions(options),
    `Docked at ${station ? station.stationName : `station ${homeStationID}`}.`,
  );
}

function handleEffectCommand(session, argumentText, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /effect.",
    );
  }

  if (!session._space || isDockedSession(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space to use /effect.",
    );
  }

  const trimmed = String(argumentText || "").trim();
  if (!trimmed || trimmed === "list" || trimmed === "help" || trimmed === "?") {
    return handledResult(chatHub, session, options, buildEffectListText());
  }

  const parts = trimmed.split(/\s+/);
  const verb = normalizeCommandName(parts[0]);
  const stop = verb === "stop" || verb === "off";
  const effectName = stop ? parts.slice(1).join(" ").trim() : trimmed;
  if (stop && !effectName) {
    const stopResult = stopAllPlayableEffects(session);
    if (!stopResult.success) {
      return handledResult(
        chatHub,
        session,
        options,
        "Effect stop failed.",
      );
    }
    return handledResult(
      chatHub,
      session,
      options,
      "Stopped all known self FX on your ship.",
    );
  }

  if (!effectName) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /effect <name>, /effect stop, or /effect stop <name>",
    );
  }

  const result = playPlayableEffect(session, effectName, { stop });
  if (!result.success) {
    if (result.errorMsg === "EFFECT_NOT_FOUND") {
      return handledResult(
        chatHub,
        session,
        options,
        `Unknown effect: ${effectName}. ${buildEffectListText()}`,
      );
    }
    if (result.errorMsg === "DESTINY_NOT_READY") {
      return handledResult(
        chatHub,
        session,
        options,
        "Space scene is not ready for FX yet. Try again in a moment.",
      );
    }
    if (result.errorMsg === "DEBUG_TEST_TARGET_NO_STATION") {
      return handledResult(
        chatHub,
        session,
        options,
        "That debug/test effect needs a nearby station target, but there is no station entity available in the current scene.",
      );
    }
    if (result.errorMsg === "DEBUG_TEST_TARGET_OUT_OF_RANGE") {
      const maxRangeText = formatDistanceMeters(
        result.data && result.data.maxRangeMeters,
      );
      const nearestDistanceText = formatDistanceMeters(
        result.data && result.data.nearestDistanceMeters,
      );
      const targetName =
        (result.data && result.data.targetName) || "the nearest station";
      return handledResult(
        chatHub,
        session,
        options,
        `That debug/test effect needs a nearby station target within ${maxRangeText}. The nearest station is ${targetName} at ${nearestDistanceText}.`,
      );
    }
    return handledResult(
      chatHub,
      session,
      options,
      "Effect playback failed.",
    );
  }

  const effect = result.data.effect;
  const autoTarget = result.data.autoTarget;
  if (effect.debugOnly && autoTarget) {
    return handledResult(
      chatHub,
      session,
      options,
      `${stop ? "Stopped" : "Played"} debug/test ${effect.key} (${effect.guid}) on your ship using nearby station ${autoTarget.targetName} (${autoTarget.targetID}) at ${formatDistanceMeters(autoTarget.distanceMeters)}.`,
    );
  }
  if (effect.debugOnly) {
    return handledResult(
      chatHub,
      session,
      options,
      `${stop ? "Stopped" : "Played"} debug/test ${effect.key} (${effect.guid}) on your ship.`,
    );
  }
  return handledResult(
    chatHub,
    session,
    options,
    `${stop ? "Stopped" : "Played"} ${effect.key} (${effect.guid}) on your ship.`,
  );
}

function handleLoadSystemCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before loading stargate destination systems.",
    );
  }

  const currentSystemID = getActiveSolarSystemID(session);
  if (!currentSystemID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Current solar system could not be resolved.",
    );
  }

  const stargates = worldData.getStargatesForSystem(currentSystemID);
  if (stargates.length === 0) {
    return handledResult(
      chatHub,
      session,
      options,
      `No stargates found in ${formatSolarSystemLabel(currentSystemID)}.`,
    );
  }

  const destinationSystemIDs = [...new Set(
    stargates
      .map((stargate) => normalizePositiveInteger(stargate.destinationSolarSystemID))
      .filter((systemID) => systemID && systemID !== currentSystemID),
  )];
  if (destinationSystemIDs.length === 0) {
    return handledResult(
      chatHub,
      session,
      options,
      `No valid stargate destination systems found in ${formatSolarSystemLabel(currentSystemID)}.`,
    );
  }

  const alreadyLoaded = destinationSystemIDs.filter((systemID) =>
    spaceRuntime.isSolarSystemSceneLoaded(systemID),
  );
  spaceRuntime.ensureScene(currentSystemID, {
    refreshStargates: false,
    broadcastStargateChanges: false,
  });
  const activationChanges = spaceRuntime.preloadSolarSystems(destinationSystemIDs, {
    broadcast: true,
  });
  const loadedNow = destinationSystemIDs.filter((systemID) =>
    spaceRuntime.isSolarSystemSceneLoaded(systemID),
  );
  const newlyLoaded = loadedNow.filter(
    (systemID) => !alreadyLoaded.includes(systemID),
  );
  const failed = destinationSystemIDs.filter(
    (systemID) => !loadedNow.includes(systemID),
  );

  return handledResult(
    chatHub,
    session,
    options,
    [
      `/loadsys ${formatSolarSystemLabel(currentSystemID)}:`,
      `loaded ${newlyLoaded.length}/${destinationSystemIDs.length} destination systems`,
      `(${formatSolarSystemList(newlyLoaded)})`,
      alreadyLoaded.length > 0
        ? `already loaded: ${formatSolarSystemList(alreadyLoaded)}`
        : null,
      failed.length > 0
        ? `failed: ${formatSolarSystemList(failed)}`
        : null,
      `gate updates emitted: ${activationChanges.length}.`,
    ].filter(Boolean).join(" "),
  );
}

function handleLoadAllSystemsCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before loading all solar systems.",
    );
  }

  const solarSystemIDs = worldData.getSolarSystems()
    .map((system) => normalizePositiveInteger(system && system.solarSystemID))
    .filter(Boolean);
  if (solarSystemIDs.length === 0) {
    return handledResult(
      chatHub,
      session,
      options,
      "No solar systems are available to preload.",
    );
  }

  const alreadyLoaded = solarSystemIDs.filter((systemID) =>
    spaceRuntime.isSolarSystemSceneLoaded(systemID),
  );
  const activationChanges = spaceRuntime.preloadSolarSystems(solarSystemIDs, {
    broadcast: true,
  });
  const loadedNow = solarSystemIDs.filter((systemID) =>
    spaceRuntime.isSolarSystemSceneLoaded(systemID),
  );
  const newlyLoaded = loadedNow.filter(
    (systemID) => !alreadyLoaded.includes(systemID),
  );
  const failed = solarSystemIDs.filter(
    (systemID) => !loadedNow.includes(systemID),
  );

  return handledResult(
    chatHub,
    session,
    options,
    [
      "/loadallsys:",
      `loaded ${loadedNow.length}/${solarSystemIDs.length} solar systems.`,
      `newly loaded: ${newlyLoaded.length}.`,
      `already loaded: ${alreadyLoaded.length}.`,
      failed.length > 0 ? `failed: ${failed.length}.` : null,
      `gate updates emitted: ${activationChanges.length}.`,
    ].filter(Boolean).join(" "),
  );
}

//testing: /tidi <factor> — sets server-side sim time dilation AND sends
//testing: OnSetTimeDilation notification to all clients in the solar system.
//testing: The client-side handler (installed during login via signedFunc in
//testing: handshake.js) sets blue.os.maxSimDilation, minSimDilation, and
//testing: dilationOverloadThreshold so blue.dll's tick loop natively adjusts
//testing: desiredSimDilation, which the stock TiDi HUD reads.
//testing: factor < 1.0 → lock dilation at that factor (threshold=0 forces overload)
//testing: factor = 1.0 → restore defaults (threshold=100000000, max=1.0, min=0.1)
function handleTimeDilationCommand(session, argumentText, chatHub, options) {
  const currentSystemID = getActiveSolarSystemID(session);
  if (!currentSystemID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Current solar system could not be resolved.",
    );
  }

  const systemLabel = formatSolarSystemLabel(currentSystemID);
  const trimmedArgument = String(argumentText || "").trim();

  // No argument = show current state
  if (!trimmedArgument) {
    const snapshot = spaceRuntime.getSceneTimeSnapshot(currentSystemID);
    if (!snapshot) {
      return handledResult(
        chatHub,
        session,
        options,
        `/tidi ${systemLabel}: scene not available.`,
      );
    }

    return handledResult(
      chatHub,
      session,
      options,
      [
        `/tidi ${systemLabel}:`,
        `factor=${formatTimeDilationFactor(snapshot.timeDilation)}`,
        `mode=${tidiAutoscaler.getManualOverride(currentSystemID) ? "manual-override" : "autoscale"}`,
        `simTimeMs=${Math.round(Number(snapshot.simTimeMs) || 0)}`,
        `stamp=${Number(snapshot.destinyStamp) || 0}.`,
      ].join(" "),
    );
  }

  if (
    trimmedArgument.toLowerCase() === "auto" ||
    trimmedArgument.toLowerCase() === "autoscale"
  ) {
    const cleared = tidiAutoscaler.clearManualOverride(currentSystemID);
    const resumeFactor = tidiAutoscaler.getCurrentFactor();
    scheduleAdvanceNoticeTimeDilationForSystems(
      [currentSystemID],
      resumeFactor,
      { delayMs: TIDI_ADVANCE_NOTICE_MS },
    );
    return handledResult(
      chatHub,
      session,
      options,
      [
        `/tidi ${systemLabel}:`,
        cleared
          ? "manual override cleared."
          : "no manual override was active.",
        `System will rejoin autoscaling in ${TIDI_ADVANCE_NOTICE_MS / 1000}s at ${formatTimeDilationFactor(resumeFactor)}.`,
      ].join(" "),
    );
  }

  const requestedFactor = Number(trimmedArgument);
  if (!Number.isFinite(requestedFactor)) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /tidi <0.1-1.0|auto>",
    );
  }

  const normalizedFactor = Math.min(1, Math.max(0.1, requestedFactor));
  tidiAutoscaler.setManualOverride(currentSystemID, normalizedFactor);

  //testing: Send the client advance notice immediately, then apply the
  //testing: authoritative server-side TiDi factor after the lead window so the
  //testing: DoSimClockRebase lands closer to blue.dll's native sync-base switch.
  scheduleAdvanceNoticeTimeDilationForSystems(
    [currentSystemID],
    normalizedFactor,
    { delayMs: TIDI_ADVANCE_NOTICE_MS },
  );

  const clampedMessage =
    normalizedFactor !== requestedFactor
      ? ` Requested ${requestedFactor} was clamped to ${formatTimeDilationFactor(normalizedFactor)}.`
      : "";
  const isDisabling = normalizedFactor >= 1.0;
  return handledResult(
    chatHub,
    session,
    options,
    [
      `/tidi ${systemLabel}:`,
      isDisabling ? "TiDi will set to full speed" : `TiDi will set to ${formatTimeDilationFactor(normalizedFactor)}`,
      "Manual override enabled for this solar system.",
      `in ${TIDI_ADVANCE_NOTICE_MS / 1000}s (synchronized).`,
      clampedMessage.trim() || null,
    ].filter(Boolean).join(" "),
  );

  if (false) {
  //testing: 2-second advance notice system (CCP dev blog parity).
  //testing: Both client notifications AND server factor change fire together after
  //testing: a 2-second delay. The 2s window lets the packet propagate to all clients
  //testing: so everyone (clients + server) transitions to the new TiDi factor at
  //testing: exactly the same moment.
  const TIDI_ADVANCE_NOTICE_MS = 2000;

  const capturedSystemID = currentSystemID;
  setTimeout(() => {
    // Step 1: Notify all clients in the system — blue.dll applies params immediately on receipt
    sendTimeDilationNotificationToSystem(capturedSystemID, normalizedFactor);
    // Step 2: Apply server-side factor at the same instant
    spaceRuntime.setSolarSystemTimeDilation(capturedSystemID, normalizedFactor, {
      syncSessions: true,
      emit: true,
      forceRebase: true,
    });
  }, TIDI_ADVANCE_NOTICE_MS);

  const clampedMessage =
    normalizedFactor !== requestedFactor
      ? ` Requested ${requestedFactor} was clamped to ${formatTimeDilationFactor(normalizedFactor)}.`
      : "";
  const isDisabling = normalizedFactor >= 1.0;
  return handledResult(
    chatHub,
    session,
    options,
    [
      `/tidi ${systemLabel}:`,
      isDisabling ? "TiDi will disable" : `TiDi will set to ${formatTimeDilationFactor(normalizedFactor)}`,
      `in ${TIDI_ADVANCE_NOTICE_MS / 1000}s (synchronized).`,
      clampedMessage.trim() || null,
    ].filter(Boolean).join(" "),
  );
  }
}

//testing: Helper — sends OnSetTimeDilation notification to all sessions in a solar system.
//testing: Used by /tidi command and also exported for runtime to call on system entry/leave.
function sendTimeDilationNotificationToSystem(systemID, factor) {
  const isDisabling = factor >= 1.0;
  const maxDil = isDisabling ? 1.0 : factor;
  const minDil = isDisabling ? 1.0 : factor;
  const threshold = isDisabling ? 100000000 : 0;

  let sentCount = 0;
  for (const targetSession of sessionRegistry.getSessions()) {
    const targetSystemID = getActiveSolarSystemID(targetSession);
    if (targetSystemID !== systemID) {
      continue;
    }
    if (
      !targetSession.socket ||
      targetSession.socket.destroyed ||
      typeof targetSession.sendNotification !== "function"
    ) {
      continue;
    }
    targetSession.sendNotification(
      "OnSetTimeDilation",
      "clientID",
      [maxDil, minDil, threshold],
    );
    sentCount += 1;
  }
  return sentCount;
}

//testing: Sends OnSetTimeDilation to a single session based on the given factor.
//testing: Used when a player enters a system that already has TiDi active,
//testing: or when leaving a TiDi system (factor=1.0 resets client to defaults).
function sendTimeDilationNotificationToSession(session, factor) {
  if (
    !session ||
    !session.socket ||
    session.socket.destroyed ||
    typeof session.sendNotification !== "function"
  ) {
    return false;
  }
  const isDisabling = factor >= 1.0;
  const maxDil = isDisabling ? 1.0 : factor;
  const minDil = isDisabling ? 1.0 : factor;
  const threshold = isDisabling ? 100000000 : 0;
  session.sendNotification(
    "OnSetTimeDilation",
    "clientID",
    [maxDil, minDil, threshold],
  );
  return true;
}

function executeChatCommand(session, rawMessage, chatHub, options = {}) {
  const trimmed = String(rawMessage || "").trim();
  if (!trimmed.startsWith("/") && !trimmed.startsWith(".")) {
    return { handled: false };
  }

  const commandLine = trimmed.slice(1).trim();
  if (!commandLine) {
    return handledResult(
      chatHub,
      session,
      options,
      "No command supplied. Use /help.",
    );
  }

  const [commandName, ...rest] = commandLine.split(/\s+/);
  const command = normalizeCommandName(commandName);
  const argumentText = rest.join(" ").trim();

  if (
    command === "help" ||
    command === "commands" ||
    command === "commandlist"
  ) {
    return handledResult(chatHub, session, options, COMMANDS_HELP_TEXT);
  }

  if (command === "motd") {
    return handledResult(chatHub, session, options, DEFAULT_MOTD_MESSAGE);
  }

  if (command === "mailme") {
    return handleMailMeCommand(session, argumentText, chatHub, options);
  }

  if (command === "deer_hunter") {
    return handleDeerHunterCommand(session, chatHub, options);
  }

  if (
    command === "blue" ||
    command === "red" ||
    command === "teal" ||
    command === "yellow"
  ) {
    return handleChatColorCommand(session, command, chatHub, options);
  }

  if (command === "where") {
    return handledResult(chatHub, session, options, getLocationSummary(session));
  }

  if (command === "dock") {
    return handleHomeDock(session, chatHub, options);
  }

  if (command === "dmg") {
    return handleDamageCommand(session, argumentText, chatHub, options);
  }

  if (command === "heal") {
    return handleHealCommand(session, chatHub, options);
  }

  if (command === "effect") {
    return handleEffectCommand(session, argumentText, chatHub, options);
  }

  if (command === "upwell") {
    const result = executeUpwellCommand(session, argumentText);
    structureLog.logCommand(session, `/upwell ${argumentText}`.trim(), result);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "upwellauto") {
    const result = executeUpwellAutoCommand(session, argumentText);
    structureLog.logCommand(session, `/upwellauto ${argumentText}`.trim(), result);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "bpauto") {
    const result = executeBlueprintAutoCommand(session, argumentText);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "bp") {
    const result = executeBlueprintCommand(session, argumentText);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "bookmarkauto") {
    const result = executeBookmarkAutoCommand(session, argumentText);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "calauto") {
    const result = executeCalendarAutoCommand(session, argumentText);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "reprocesssmoke") {
    const result = executeReprocessingSmokeCommand(session, argumentText);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "sov") {
    const result = executeSovCommand(session, argumentText);
    sovLog.logCommand(session, `/sov ${argumentText}`.trim(), result);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "sovauto" || command === "autosov") {
    const result = executeSovAutoCommand(session, argumentText, chatHub, options);
    sovLog.logCommand(session, `/${command} ${argumentText}`.trim(), result);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "jetcan") {
    return handleJetcanCommand(session, argumentText, chatHub, options);
  }

  if (command === "container") {
    return handleDebrisFieldCommand(session, argumentText, chatHub, options, "container");
  }

  if (command === "gmships") {
    return handleGmShipsCommand(session, chatHub, options);
  }

  if (command === "gmweapons") {
    return handleGmWeaponsCommand(session, chatHub, options);
  }

  if (command === "prop") {
    return handlePropCommand(session, chatHub, options);
  }

  if (command === "allskills") {
    return handleAllSkillsCommand(session, chatHub, options);
  }

  if (command === "backintime") {
    return handleBackInTimeCommand(session, argumentText, chatHub, options);
  }

  if (command === "expertsystem" || command === "expertsystems") {
    return handleExpertSystemCommand(session, argumentText, chatHub, options);
  }

  if (command === "gmskills") {
    return handleGmSkillsCommand(session, chatHub, options);
  }

  if (command === "giveskill" || command === "giveskills") {
    return handleGiveSkillCommand(session, argumentText, chatHub, options);
  }

  if (command === "removeskill" || command === "removeskills") {
    return handleRemoveSkillCommand(session, argumentText, chatHub, options);
  }

  if (command === "loadsys") {
    return handleLoadSystemCommand(session, chatHub, options);
  }

  if (command === "loadallsys") {
    return handleLoadAllSystemsCommand(session, chatHub, options);
  }

  if (command === "tidi") {
    return handleTimeDilationCommand(session, argumentText, chatHub, options);
  }


  if (command === "spawncontainer") {
    return handleDebrisFieldCommand(session, argumentText, chatHub, options, "container");
  }

  if (command === "spawnwreck") {
    return handleDebrisFieldCommand(session, argumentText, chatHub, options, "wreck");
  }

  if (command === "wreck") {
    return handleDebrisFieldCommand(session, argumentText, chatHub, options, "wreck");
  }

  if (command === "suicide") {
    return handleSuicideCommand(session, chatHub, options);
  }

  if (command === "deathtest") {
    return handleDeathTestCommand(session, argumentText, chatHub, options);
  }

  if (command === "deathstructure") {
    return handleStructureDeathTestCommand(session, argumentText, chatHub, options);
  }

  if (command === "deadwarp") {
    return handleDeadwarpCommand(session, argumentText, chatHub, options);
  }

  if (command === "npc") {
    return handleNpcCommand(session, argumentText, chatHub, options);
  }

  if (command === "mnpc") {
    return handleMissileNpcCommand(session, argumentText, chatHub, options);
  }

  if (CAPITAL_NPC_CHAT_COMMANDS.includes(command)) {
    return handleCapitalNpcCommand(session, argumentText, chatHub, options, command);
  }

  if (WORMHOLE_CHAT_COMMANDS.includes(command)) {
    const result = executeWormholeCommand(session, command, argumentText);
    return handledResult(chatHub, session, options, result.message);
  }

  if (TRIG_DRIFTER_CHAT_COMMANDS.includes(command)) {
    const result = executeTrigDrifterCommand(session, command, argumentText);
    return handledResult(chatHub, session, options, result.message);
  }

  if (GATE_SKIN_CHAT_COMMANDS.includes(command)) {
    const result = executeGateSkinCommand(session, argumentText, options);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "dirt") {
    const result = handleShipDirtCommand(session, argumentText);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "killmarks" || command === "killmark") {
    const result = handleShipKillmarksCommand(session, argumentText);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "npctest") {
    return handleNpcTestCommand(session, argumentText, chatHub, options, "player");
  }

  if (command === "npctest2") {
    return handleNpcTestCommand(session, argumentText, chatHub, options, "ffa");
  }

  if (command === "npcminer") {
    const result = executeMiningFleetCommand(session, argumentText);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "npcmineraggro") {
    const result = executeMiningFleetAggroCommand(session, argumentText);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "npcminerpanic") {
    const result = executeMiningFleetAggroCommand(session, argumentText);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "npcminerretreat") {
    const result = executeMiningFleetRetreatCommand(session);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "npcminerresume") {
    const result = executeMiningFleetResumeCommand(session);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "npcminerhaul") {
    const result = executeMiningFleetHaulCommand(session);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "npcminerclear") {
    const result = executeMiningFleetClearCommand(session);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "npcminerstatus") {
    const result = executeMiningFleetStatusCommand(session);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "miningreset") {
    const result = executeMiningStateResetCommand(session);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "miningstatus") {
    const result = executeMiningStateStatusCommand(session);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "npcw" || command === "wnpc") {
    return handleNpcWarpCommand(session, argumentText, chatHub, options, command);
  }

  if (command === "npcclear") {
    return handleNpcClearCommand(session, argumentText, chatHub, options);
  }

  if (command === "concord") {
    return handleConcordCommand(session, argumentText, chatHub, options);
  }

  if (command === "cwatch") {
    return handleCrimewatchCommand(session, argumentText, chatHub, options);
  }

  if (command === "naughty") {
    return handleNaughtyCommand(session, argumentText, chatHub, options);
  }

  if (command === "secstatus") {
    return handleSecurityStatusCommand(session, argumentText, chatHub, options);
  }

  if (command === "gateconcord") {
    return handleGateOperatorCommand(
      session,
      argumentText,
      chatHub,
      options,
      npcService.GATE_OPERATOR_KIND.CONCORD,
    );
  }

  if (command === "gaterats") {
    return handleGateOperatorCommand(
      session,
      argumentText,
      chatHub,
      options,
      npcService.GATE_OPERATOR_KIND.RATS,
    );
  }

  if (command === "invu") {
    return handleInvuCommand(session, argumentText, chatHub, options);
  }

  if (command === "keepstar") {
    return handleKeepstarCommand(session, chatHub, options);
  }

  if (command === "fire") {
    return handleFireCommand(session, argumentText, chatHub, options);
  }

  if (command === "fire2") {
    return handleFire2Command(session, argumentText, chatHub, options);
  }

  if (command === "supertitan") {
    const result = executeSuperTitanCommand(session, argumentText, options);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "supertitanshow" || command === "titansupershow") {
    const result = executeSuperTitanShowCommand(
      session,
      argumentText,
      options,
    );
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "rr") {
    const result = executeRemoteRepairFleetCommand(
      session,
      argumentText,
      options,
    );
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "testclear") {
    return handleTestClearCommand(session, chatHub, options);
  }

  if (command === "sysjunkclear") {
    return handleSystemJunkClearCommand(session, chatHub, options);
  }

  if (command === "who") {
    return handledResult(
      chatHub,
      session,
      options,
      getConnectedCharacterSummary(),
    );
  }

  if (command === "wallet" || command === "isk") {
    const summary = getWalletSummary(session);
    return handledResult(
      chatHub,
      session,
      options,
      summary || "Select a character before checking wallet balance.",
    );
  }

  if (command === "evermarks") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before checking EverMarks.",
      );
    }

    const evermarks = getCharacterWalletLPBalance(
      session.characterID,
      EVERMARK_ISSUER_CORP_ID,
    );
    return handledResult(
      chatHub,
      session,
      options,
      `EverMarks: ${formatEvermarks(evermarks)}.`,
    );
  }

  if (command === "corpevermarks") {
    if (!session || !(session.corporationID || session.corpid)) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character in a corporation before checking corporation EverMarks.",
      );
    }

    const corporationID = Number(session.corporationID || session.corpid) || 0;
    const evermarks = getCorporationWalletLPBalance(
      corporationID,
      EVERMARK_ISSUER_CORP_ID,
    );
    return handledResult(
      chatHub,
      session,
      options,
      `Corporation EverMarks: ${formatEvermarks(evermarks)}.`,
    );
  }

  if (
    command === "grantshipemblem" ||
    command === "grantcorplogo" ||
    command === "grantalliancelogo"
  ) {
    return handleGrantShipLogoCommand(
      command,
      session,
      argumentText,
      chatHub,
      options,
    );
  }

  if (command === "corpcreate") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before creating a corporation.",
      );
    }

    if (!argumentText) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /corpcreate <corporation name>",
      );
    }

    const result = createCustomCorporation(session.characterID, argumentText);
    if (!result.success) {
      const message =
        result.errorMsg === "CORPORATION_NAME_TAKEN"
          ? `Corporation already exists: ${argumentText}.`
          : "Corporation creation failed.";
      return handledResult(chatHub, session, options, message);
    }

    refreshAffiliationSessions(result.data.affectedCharacterIDs);
    return handledResult(
      chatHub,
      session,
      options,
      `Created corporation ${result.data.corporationRecord.corporationName} [${result.data.corporationRecord.tickerName}] and moved your character into it.`,
    );
  }

  if (command === "setalliance") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before creating an alliance.",
      );
    }

    if (!argumentText) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /setalliance <alliance name>",
      );
    }

    const corporationRecord = getCorporationRecord(session.corporationID);
    if (!corporationRecord) {
      return handledResult(
        chatHub,
        session,
        options,
        "Current corporation could not be resolved.",
      );
    }

    const result = createCustomAllianceForCorporation(
      session.characterID,
      corporationRecord.corporationID,
      argumentText,
    );
    if (!result.success) {
      let message = "Alliance creation failed.";
      if (result.errorMsg === "CUSTOM_CORPORATION_REQUIRED") {
        message = "You must be in a custom corporation before creating an alliance.";
      } else if (result.errorMsg === "ALLIANCE_NAME_TAKEN") {
        message = `Alliance already exists: ${argumentText}.`;
      }
      return handledResult(chatHub, session, options, message);
    }

    refreshAffiliationSessions(result.data.affectedCharacterIDs);
    return handledResult(
      chatHub,
      session,
      options,
      `Created alliance ${result.data.allianceRecord.allianceName} [${result.data.allianceRecord.shortName}] and set your corporation into it.`,
    );
  }

  if (command === "joinalliance") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before joining an alliance.",
      );
    }

    if (!argumentText) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /joinalliance <alliance name>",
      );
    }

    const corporationRecord = getCorporationRecord(session.corporationID);
    if (!corporationRecord) {
      return handledResult(
        chatHub,
        session,
        options,
        "Current corporation could not be resolved.",
      );
    }

    const result = joinCorporationToAllianceByName(
      corporationRecord.corporationID,
      argumentText,
    );
    if (!result.success) {
      let message = "Alliance join failed.";
      if (result.errorMsg === "CUSTOM_CORPORATION_REQUIRED") {
        message = "You must be in a custom corporation before joining a custom alliance.";
      } else if (result.errorMsg === "ALLIANCE_NOT_FOUND") {
        message = `Alliance not found: ${argumentText}.`;
      } else if (result.errorMsg === "ALREADY_IN_ALLIANCE") {
        message = `Your corporation is already in ${argumentText}.`;
      }
      return handledResult(chatHub, session, options, message);
    }

    refreshAffiliationSessions(result.data.affectedCharacterIDs);
    return handledResult(
      chatHub,
      session,
      options,
      `Joined alliance ${result.data.allianceRecord.allianceName} [${result.data.allianceRecord.shortName}].`,
    );
  }

  if (command === "solar") {
    return handleSolarTeleport(session, argumentText, chatHub, options);
  }

  if (command === "tele") {
    return handleTeleCommand(session, argumentText, chatHub, options);
  }

  if (command === "setstanding") {
    return handleSetStandingCommand(session, argumentText, chatHub, options);
  }

  if (command === "maxagentstandings" || command === "fullstandings") {
    return handleMaxAgentStandingsCommand(
      session,
      argumentText,
      chatHub,
      options,
    );
  }

  if (command === "sigscan") {
    return handleSigscanCommand(session, chatHub, options);
  }

  if (command === "sigs") {
    return handleSigsCommand(session, chatHub, options);
  }

  if (command === "missioncomplete") {
    return handleMissionCompleteCommand(
      session,
      argumentText,
      chatHub,
      options,
    );
  }

  if (command === "overlayrefresh") {
    return handleOverlayRefreshCommand(session, chatHub, options);
  }

  if (command === "tr") {
    return handleTransportCommand(session, argumentText, chatHub, options);
  }

  if (command === "addisk") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before changing wallet balance.",
      );
    }

    const amount = parseAmount(argumentText);
    if (amount === null) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /addisk <amount>",
      );
    }

    const result = adjustCharacterBalance(session.characterID, amount, {
      description: `Admin /addisk by ${session.characterName || session.userName || "unknown"}`,
      ownerID1: session.characterID,
      ownerID2: session.characterID,
      referenceID: session.characterID,
    });
    if (!result.success) {
      return handledResult(
        chatHub,
        session,
        options,
        result.errorMsg === "INSUFFICIENT_FUNDS"
          ? "Wallet change failed: insufficient funds."
          : "Wallet change failed.",
      );
    }

    return handledResult(
      chatHub,
      session,
      options,
      `Adjusted wallet by ${formatIsk(amount)}. New balance: ${formatIsk(result.data.balance)}.`,
    );
  }

  if (command === "addevermarks") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before changing EverMarks.",
      );
    }

    const amount = parseAmount(argumentText);
    if (amount === null) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /addevermarks <amount>",
      );
    }

    const result = adjustCharacterWalletLPBalance(
      session.characterID,
      EVERMARK_ISSUER_CORP_ID,
      amount,
      { changeType: "admin_adjust" },
    );
    if (!result.success) {
      return handledResult(
        chatHub,
        session,
        options,
        "EverMarks change failed.",
      );
    }

    return handledResult(
      chatHub,
      session,
      options,
      `Adjusted EverMarks by ${formatSignedEvermarks(amount)}. New balance: ${formatEvermarks(result.data.amount)}.`,
    );
  }

  if (command === "addcorpevermarks") {
    if (!session || !(session.corporationID || session.corpid)) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character in a corporation before changing corporation EverMarks.",
      );
    }

    const amount = parseAmount(argumentText);
    if (amount === null) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /addcorpevermarks <amount>",
      );
    }

    const corporationID = Number(session.corporationID || session.corpid) || 0;
    const result = adjustCorporationWalletLPBalance(
      corporationID,
      EVERMARK_ISSUER_CORP_ID,
      amount,
      { reason: "admin_adjust" },
    );
    if (!result.success) {
      return handledResult(
        chatHub,
        session,
        options,
        "Corporation EverMarks change failed.",
      );
    }

    return handledResult(
      chatHub,
      session,
      options,
      `Adjusted corporation EverMarks by ${formatSignedEvermarks(amount)}. New balance: ${formatEvermarks(result.data.amount)}.`,
    );
  }

  if (command === "addplex") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before changing PLEX balance.",
      );
    }

    const amount = parseAmount(argumentText);
    if (amount === null) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /addplex <amount>",
      );
    }

    const result = adjustCharacterPlexBalance(session.characterID, amount, {
      categoryMessageID: PLEX_LOG_CATEGORY.CCP,
      reason: `Admin /addplex by ${session.characterName || session.userName || "unknown"}`,
    });
    if (!result.success) {
      return handledResult(
        chatHub,
        session,
        options,
        "PLEX balance change failed.",
      );
    }

    emitPlexBalanceChangeToSession(session, result.data.plexBalance);

    return handledResult(
      chatHub,
      session,
      options,
      `Adjusted PLEX by ${formatSignedPlex(amount)}. New balance: ${formatPlex(result.data.plexBalance)}.`,
    );
  }

  if (command === "setisk") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before changing wallet balance.",
      );
    }

    const amount = parseAmount(argumentText);
    if (amount === null) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /setisk <amount>",
      );
    }

    const result = setCharacterBalance(session.characterID, amount, {
      description: `Admin /setisk by ${session.characterName || session.userName || "unknown"}`,
      ownerID1: session.characterID,
      ownerID2: session.characterID,
      referenceID: session.characterID,
    });
    if (!result.success) {
      return handledResult(
        chatHub,
        session,
        options,
        result.errorMsg === "INSUFFICIENT_FUNDS"
          ? "Wallet change failed: balance cannot be negative."
          : "Wallet change failed.",
      );
    }

    return handledResult(
      chatHub,
      session,
      options,
      `Wallet balance set to ${formatIsk(result.data.balance)}.`,
    );
  }

  if (command === "setevermarks") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before changing EverMarks.",
      );
    }

    const amount = parseAmount(argumentText);
    if (amount === null) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /setevermarks <amount>",
      );
    }

    const result = setCharacterWalletLPBalance(
      session.characterID,
      EVERMARK_ISSUER_CORP_ID,
      amount,
      { changeType: "admin_set" },
    );
    if (!result.success) {
      return handledResult(
        chatHub,
        session,
        options,
        "EverMarks change failed.",
      );
    }

    return handledResult(
      chatHub,
      session,
      options,
      `EverMarks set to ${formatEvermarks(result.data.amount)}.`,
    );
  }

  if (command === "setcorpevermarks") {
    if (!session || !(session.corporationID || session.corpid)) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character in a corporation before changing corporation EverMarks.",
      );
    }

    const amount = parseAmount(argumentText);
    if (amount === null) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /setcorpevermarks <amount>",
      );
    }

    const corporationID = Number(session.corporationID || session.corpid) || 0;
    const result = setCorporationWalletLPBalance(
      corporationID,
      EVERMARK_ISSUER_CORP_ID,
      amount,
      { reason: "admin_set" },
    );
    if (!result.success) {
      return handledResult(
        chatHub,
        session,
        options,
        "Corporation EverMarks change failed.",
      );
    }

    return handledResult(
      chatHub,
      session,
      options,
      `Corporation EverMarks set to ${formatEvermarks(result.data.amount)}.`,
    );
  }

  if (command === "setplex") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before changing PLEX balance.",
      );
    }

    const amount = parseAmount(argumentText);
    if (amount === null) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /setplex <amount>",
      );
    }

    const result = setCharacterPlexBalance(session.characterID, amount, {
      categoryMessageID: PLEX_LOG_CATEGORY.CCP,
      reason: `Admin /setplex by ${session.characterName || session.userName || "unknown"}`,
    });
    if (!result.success) {
      return handledResult(
        chatHub,
        session,
        options,
        "PLEX balance change failed.",
      );
    }

    emitPlexBalanceChangeToSession(session, result.data.plexBalance);

    return handledResult(
      chatHub,
      session,
      options,
      `PLEX balance set to ${formatPlex(result.data.plexBalance)}.`,
    );
  }

  if (command === "ship" || command === "giveme") {
    return handleShipSpawn(command, session, argumentText, chatHub, options);
  }

  const rackCommandPreset = resolveSingleRackCommandPreset(command);
  if (rackCommandPreset) {
    return handlePresetSingleRackCommand(
      session,
      chatHub,
      options,
      rackCommandPreset,
      command,
    );
  }

  if (command === "lesmis") {
    return handleLesmisCommand(session, chatHub, options);
  }

  if (command === "miner") {
    const result = executeMinerCommand(session);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "orca") {
    const result = executeOrcaCommand(session);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "probe") {
    const result = executeProbeCommand(session);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "probe2") {
    const result = executeProbe2Command(session);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "trig") {
    const result = executeTrigCommand(session, argumentText);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "cburst") {
    const result = executeCburstCommand(session);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "guardian") {
    const result = executeGuardianCommand(session);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "basilisk") {
    const result = executeBasiliskCommand(session);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "ewar") {
    const result = executeEwarCommand(session);
    return handledResult(chatHub, session, options, result.message);
  }

  if (command === "minerals") {
    return handleMineralsCommand(session, chatHub, options);
  }

  if (command === "create" || command === "createitem") {
    return handleCreateItemCommand(session, argumentText, chatHub, options, command);
  }

  if (command === "giveitem" || command === "item") {
    return handleGiveItemCommand(session, argumentText, chatHub, options);
  }

  if (command === "hangar") {
    return handledResult(chatHub, session, options, getHangarSummary(session));
  }

  if (command === "session") {
    return handledResult(chatHub, session, options, getSessionSummary(session));
  }

  if (command === "iteminfo") {
    return handledResult(chatHub, session, options, getItemSummary(argumentText));
  }

  if (command === "typeinfo") {
    if (!argumentText) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /typeinfo <ship name|typeID>",
      );
    }

    const lookup = resolveShipByName(argumentText);
    if (!lookup.success) {
      const message =
        lookup.errorMsg === "SHIP_NOT_FOUND"
          ? `Ship type not found: ${argumentText}.${formatSuggestions(lookup.suggestions)}`
          : `Ship type name is ambiguous: ${argumentText}.${formatSuggestions(lookup.suggestions)}`;
      return handledResult(chatHub, session, options, message.trim());
    }

    return handledResult(
      chatHub,
      session,
      options,
      `${lookup.match.name}: typeID=${lookup.match.typeID}, groupID=${lookup.match.groupID}, categoryID=${lookup.match.categoryID}, published=${lookup.match.published === false ? "false" : "true"}.`,
    );
  }

  if (command === "announce") {
    if (!argumentText) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /announce <message>",
      );
    }

    sendAnnouncement(chatHub, session, argumentText);
    return handledResult(
      chatHub,
      session,
      options,
      `Announcement sent: ${argumentText}`,
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Unknown command: /${command}. Use /help.${formatSuggestions(suggestCommands(command))}`.trim(),
  );
}

module.exports = {
  AVAILABLE_SLASH_COMMANDS,
  COMMANDS_HELP_TEXT,
  DEER_HUNTER_MESSAGE,
  DEFAULT_MOTD_MESSAGE,
  executeChatCommand,
  getGmWeaponsSeedPlan,
  getPropulsionCommandItemTypes,
  //testing: exported for runtime.js to send TiDi notifications on system entry/leave
  sendTimeDilationNotificationToSession,
  sendTimeDilationNotificationToSystem,
};
