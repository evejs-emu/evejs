const BaseService = require("../baseService");
const log = require("../../utils/logger");

class InsurgencySolarsystemService extends BaseService {
  constructor() {
    super("insurgencySolarsystem");
  }

  Handle_GetAllVisibleCampaigns(args, session) {
    log.debug("[InsurgencySolarsystem] GetAllVisibleCampaigns called");
    return { type: "list", items: [] };
  }

  Handle_GetLocalCampaignClientSnapshot(args, session) {
    log.debug("[InsurgencySolarsystem] GetLocalCampaignClientSnapshot called");
    const solarSystemID =
      Number(
        session && (session.solarsystemid2 || session.solarsystemid),
      ) || 0;

    // Decompiled V23.02 insurgencyCampaignSvc.py does:
    //   solarsystemID, campaignSnapshot =
    //       sm.RemoteSvc('insurgencySolarsystem').GetLocalCampaignClientSnapshot()
    //
    // For the no-active-campaign case, the safe contract is therefore:
    //   (currentSolarSystemID, None)
    //
    // Returning [] crashes with:
    //   ValueError: need more than 0 values to unpack
    return [solarSystemID, null];
  }
}

module.exports = InsurgencySolarsystemService;
