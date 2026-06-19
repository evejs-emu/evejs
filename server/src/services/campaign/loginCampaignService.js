/**
 * Login Campaign Services (loginCampaignManager, seasonalLoginCampaignManager)
 *
 * V23.02 client queries these during the character selection phase.
 * The seasonalLoginCampaignService.prime_campaign_data() iterates the result,
 * so we must return empty lists/dicts (not null).
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class LoginCampaignMgrService extends BaseService {
  constructor() {
    super("loginCampaignManager");
  }

  Handle_GetActiveCampaigns(args, session) {
    log.debug("[LoginCampaignMgr] GetActiveCampaigns");
    return { type: "list", items: [] };
  }

  Handle_GetCampaignData(args, session) {
    log.debug("[LoginCampaignMgr] GetCampaignData");
    return { type: "dict", entries: [] };
  }

  Handle_GetPlayerProgress(args, session) {
    log.debug("[LoginCampaignMgr] GetPlayerProgress");
    return { type: "dict", entries: [] };
  }

  Handle_get_client_campaign_state(args, session) {
    log.debug("[LoginCampaignMgr] get_client_campaign_state");
    // Client accesses result.item_progress — return None so can_claim_now checks None
    return null;
  }
}

class SeasonalLoginCampaignMgrService extends BaseService {
  constructor() {
    super("seasonalLoginCampaignManager");
  }

  Handle_GetActiveCampaigns(args, session) {
    log.debug("[SeasonalLoginCampaignMgr] GetActiveCampaigns");
    return { type: "list", items: [] };
  }

  Handle_GetCampaignData(args, session) {
    log.debug("[SeasonalLoginCampaignMgr] GetCampaignData");
    return { type: "list", items: [] };
  }

  Handle_GetPlayerProgress(args, session) {
    log.debug("[SeasonalLoginCampaignMgr] GetPlayerProgress");
    return { type: "dict", entries: [] };
  }

  Handle_get_active_campaign(args, session) {
    log.debug("[SeasonalLoginCampaignMgr] get_active_campaign");

    return [null, null, null, null];
  }
}

module.exports = { LoginCampaignMgrService, SeasonalLoginCampaignMgrService };
