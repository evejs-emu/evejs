const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getRaffleRuntime,
} = require(path.join(__dirname, "./raffleRuntimeSingleton"));

class RaffleMgrService extends BaseService {
  constructor() {
    super("raffleMgr");
    this._runtime = getRaffleRuntime();
    this._runtime.initialize();
  }

  Handle_QA_SeedRaffles(args) {
    const quantity = args && args[0];
    log.debug(`[RaffleMgr] QA_SeedRaffles(${quantity})`);
    return this._runtime.qaSeedRaffles(quantity);
  }
}

module.exports = RaffleMgrService;
