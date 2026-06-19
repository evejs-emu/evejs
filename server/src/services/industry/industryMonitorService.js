const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildAvailableMaterialsPayload,
  parseIndustryRequest,
} = require(path.join(__dirname, "./industryPayloads"));
const {
  connectMonitor,
  disconnectMonitor,
} = require(path.join(__dirname, "./industryRuntimeState"));

class IndustryMonitorService extends BaseService {
  constructor() {
    super("industryMonitor");
  }

  Handle_ConnectJob(args, session) {
    const request = parseIndustryRequest(args && args.length > 0 ? args[0] : null);
    const result = connectMonitor(session, request);
    return [
      result.data.monitorID,
      buildAvailableMaterialsPayload(result.data.availableMaterials),
    ];
  }

  Handle_DisconnectJob(args) {
    const monitorID = args && args.length > 0 ? args[0] : null;
    disconnectMonitor(monitorID);
    return null;
  }
}

module.exports = IndustryMonitorService;
