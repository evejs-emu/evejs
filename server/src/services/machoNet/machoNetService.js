/**
 * MachoNet Service
 *
 * Handles initial server info queries from the client.
 * This is one of the first services called after handshake.
 * The client calls machoNet.GetInitVals() to get server configuration.
 *
 * Based on NetService.cpp in EVEmu.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { buildGlobalConfigDict, buildServerStatusResponse } = require(path.join(
  __dirname,
  "./globalConfig",
));

class MachoNetService extends BaseService {
  constructor() {
    super("machoNet");
  }

  /**
   * GetInitVals — returns initial server values
   *
   * From NetService.cpp: Returns [serviceInfo, emptyDict]
   * serviceInfo is a dict mapping service names to their access level.
   * The client uses this at ServiceCallGPCS.py:197 to know where
   * to route service calls:
   *   where = self.machoNet.serviceInfo[service]
   *
   * Access levels from C++:
   *   None   = direct call (unbound services)
   *   "location" / "locationPreferred" / "solarsystem" / "solarsystem2"
   *   "station" / "character" / "corporation" / "bulk"
   */
  getServiceInfoDict() {
    return {
      type: "dict",
      entries: [
        ["machoNet", null],
        ["config", null],
        ["objectCaching", null],
        ["alert", null],
        ["authentication", null],
        ["account", null],
        ["storeManager", null],
        ["vaultManager", null],
        ["FastCheckoutService", null],
        ["kiringMgr", null],
        ["charUnboundMgr", null],
        ["charMgr", null],
        ["home_station", null],
        ["homestation", null],
        ["homeStation", null],
        ["corpRegistry", null],
        ["allianceRegistry", null],
        ["corpmgr", null],
        ["corpRecProxy", null],
        ["fwCharacterEnlistmentMgr", null],
        ["corpStationMgr", null],
        ["officeManager", null],
        ["itemLocking", null],
        ["stationSvc", null],
        ["station", "station"],
        ["ship", "station"],
        ["map", null],
        ["marketProxy", null],
        ["structureDirectory", null],
        ["structureDeployment", null],
        ["structureProfiles", null],
        ["structureControl", null],
        ["structureDocking", null],
        ["structureHangarViewMgr", null],
        ["fwWarzoneSolarsystem", null],
        ["beyonce", "solarsystem2"],
        ["planetMgr", "solarsystem2"],
        ["planetOrbitalRegistryBroker", "solarsystem2"],
        ["posMgr", "solarsystem2"],
        ["scanMgr", null],
        ["miningScanMgr", null],
        ["characterMiningLedger", null],
        ["corpMiningLedger", null],
        ["inSpaceCompressionMgr", null],
        ["structureCompressionMgr", null],
        ["dogmaIM", "character"],
        ["invbroker", "station"],
        ["trademgr", "station"],
        ["tradeMgr", "station"],
        ["charFittingMgr", null],
        ["corpFittingMgr", null],
        ["allianceFittingMgr", null],
        ["LSC", null],
        ["onlineStatus", null],
        ["billMgr", null],
        ["corporationSvc", null],
        ["voteManager", null],
        ["warRegistry", null],
        ["warStatisticMgr", null],
        ["warsInfoMgr", null],
        ["mutualWarInviteMgr", null],
        ["peaceTreatyMgr", null],
        ["lookupSvc", null],
        ["certificateMgr", null],
        ["tutorialSvc", null],
        ["operationsManager", null],
        ["air_npe", null],
        ["nes_intro", null],
        ["agentMgr", null],
        ["bookmarkMgr", null],
        ["accessGroupBookmarkMgr", null],
        ["ownerGroupManager", null],
        ["calendarMgr", null],
        ["calendarProxy", null],
        ["standing2", null],
        ["missionTrackerMgr", null],
        ["dungeonExplorationMgr", null],
        ["dungeonInstanceCacheMgr", null],
        ["userSvc", null],
        ["structureGuests", null],
        ["skillMgr", null],
        ["skillMgr2", null],
        ["skillHandler", null],
        ["wormholeMgr", null],
        ["alphaInjectorMgr", null],
        ["nonDiminishingInjectionMgr", null],
        ["contractMgr", null],
        ["blueprintManager", null],
        ["facilityManager", null],
        ["industryManager", null],
        ["industryMonitor", null],
        ["repairSvc", "station"],
        ["repackagingSvc", null],
        ["reprocessingSvc", "station"],
        ["insuranceSvc", "station"],
        ["jumpCloneSvc", null],
        ["LPSvc", "station"],
        ["LPStoreMgr", "station"],
        ["publicGatewaySvc", null],
        ["slash", null],
        ["subscriptionMgr", null],
        ["raffleProxy", null],
        ["raffleMgr", null],
        ["loginCampaignManager", null],
        ["seasonalLoginCampaignManager", null],
      ],
    };
  }

  Handle_GetInitVals(args, session) {
    log.info("[MachoNet] GetInitVals");
    // Return [serviceInfo, globalConfig]
    // globalConfig is used by client for things like:
    //   machoNet.GetGlobalConfig().get('imageserverurl') - portrait/logo image server
    //   machoNet.GetGlobalConfig().get('defaultPortraitSaveSize') - portrait save size
    return [this.getServiceInfoDict(), buildGlobalConfigDict()];
  }

  Handle_GetServiceInfo(args, session) {
    log.debug("[MachoNet] GetServiceInfo");
    return this.getServiceInfoDict();
  }

  Handle_GetServerStatus(args, session) {
    log.debug("[MachoNet] GetServerStatus");
    return buildServerStatusResponse();
  }

  /**
   * GetTime — returns the current server time as a Win32 FILETIME
   */
  Handle_GetTime(args, session) {
    log.debug("[MachoNet] GetTime");
    // Convert to Win32 FILETIME (100-nanosecond intervals since 1601-01-01)
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
    return { type: "long", value: now };
  }

  Handle_GetClusterGameStatisticsForClient(args, session) {
    log.debug("[MachoNet] GetClusterGameStatisticsForClient");
    // V23.02 mapSvc unpacks:
    //   sol, sta, statDivisor =
    //     sm.ProxySvc('machoNet').GetClusterGameStatisticsForClient('EVE', ({}, {}, 0))
    // and then iterates sol/sta as dict-like objects while dividing by
    // statDivisor. The safe empty-state contract is therefore:
    //   ({}, {}, 1)
    return [{}, {}, 1];
  }
}

module.exports = MachoNetService;
