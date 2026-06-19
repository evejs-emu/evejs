/**
 * Online Status Service (onlineStatus)
 *
 * Handles online status queries from the client.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class OnlineStatusService extends BaseService {
  constructor() {
    super("onlineStatus");
  }

  Handle_GetOnlineStatus(args, session) {
    log.debug("[OnlineStatus] GetOnlineStatus");
    return true;
  }

  Handle_GetInitialState(args, session) {
    log.debug("[OnlineStatus] GetInitialState");

    const rowDescriptor = {
      type: "list",
      items: ["charID", "online"],
    };

    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          // Provide Index token so client can call .Index('charID') without crashing
          ["Index", { type: "token", value: "util.Row" }],

          // Provide rows for online characters
          [
            "rows",
            {
              type: "list",
              items: [
                {
                  type: "object",
                  name: "util.Row",
                  args: {
                    type: "dict",
                    entries: [
                      ["charID", session.characterID],
                      ["online", true],
                    ],
                  },
                },
              ],
            },
          ],
        ],
      },
    };
  }
}

module.exports = OnlineStatusService;
