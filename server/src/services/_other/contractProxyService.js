const path = require("path"); // required for db implementation
const fs = require("fs"); // required for db implementation

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class contractProxyService extends BaseService {
  constructor() {
    super("contractProxy");
  }

  Handle_GetLoginInfo(args, session) {
    log.debug("[ContractProxy] GetLoginInfo called");

    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["assignedToMe", { type: "list", items: [] }],
          ["needsAttention", { type: "list", items: [] }],
          ["inProgress", { type: "list", items: [] }],
        ],
      },
    };
  }
}

module.exports = contractProxyService;
