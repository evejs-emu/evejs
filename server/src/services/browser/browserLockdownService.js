/**
 * browser stuff
 **/

const path = require("path"); // required for db implementation
const fs = require("fs"); // required for db implementation

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class browserLockdownSvcService extends BaseService {
  constructor() {
    super("browserLockdownSvc");
  }

  Handle_GetFlaggedSitesHash(args, session) {
    // return empty tuple
    return []; // ?? not sure if this will be excepted by client
    // might need to return `wstring` or `token`
  }

  Handle_GetFlaggedSitesList(args, session) {
    // return empty tuple
    return []; // ?? not sure if this will be excepted by client
  }
}

module.exports = browserLockdownSvcService;
