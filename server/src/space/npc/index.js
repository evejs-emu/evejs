const npcService = require("./npcService");
const npcRuntime = require("./npcRuntime");

module.exports = {
  ...npcService,
  runtime: npcRuntime,
};
