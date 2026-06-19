const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildKeyVal,
  buildList,
  buildRowset,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

function buildLoginInfo() {
  return buildKeyVal([
    ["needsAttention", buildRowset(["contractID", "state"], [])],
    [
      "inProgress",
      buildRowset(["contractID", "startStationID", "endStationID", "expires"], []),
    ],
    ["assignedToMe", buildRowset(["contractID", "issuerID"], [])],
  ]);
}

class ContractMgrService extends BaseService {
  constructor() {
    super("contractMgr");
  }

  Handle_GetLoginInfo() {
    log.debug("[ContractMgr] GetLoginInfo");
    return buildLoginInfo();
  }

  Handle_SearchContracts() {
    log.debug("[ContractMgr] SearchContracts");
    return buildList([]);
  }

  Handle_NumOutstandingContracts() {
    log.debug("[ContractMgr] NumOutstandingContracts");
    return 0;
  }

  Handle_CollectMyPageInfo() {
    log.debug("[ContractMgr] CollectMyPageInfo");
    return buildLoginInfo();
  }

  Handle_GetItemsInStation() {
    log.debug("[ContractMgr] GetItemsInStation");
    return buildList([]);
  }

  Handle_GetContractListForOwner() {
    log.debug("[ContractMgr] GetContractListForOwner");
    return buildList([]);
  }

  Handle_GetMyExpiredContractList() {
    log.debug("[ContractMgr] GetMyExpiredContractList");
    return buildList([]);
  }

  Handle_GetContract(args) {
    const contractId = normalizeNumber(args && args[0], 0);
    log.debug(`[ContractMgr] GetContract(${contractId})`);
    return null;
  }

  Handle_CreateContract() {
    return null;
  }

  Handle_AcceptContract() {
    return null;
  }

  Handle_CompleteContract() {
    return null;
  }

  Handle_DeleteContract() {
    return null;
  }
}

module.exports = ContractMgrService;
