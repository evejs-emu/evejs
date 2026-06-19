const {
  executeCapitalNpcCommand,
} = require("./capitalNpcCommandHandlers");

const CAPITAL_NPC_CHAT_COMMANDS = Object.freeze([
  "capnpc",
  "capnpcinfo",
  "capnpcstatus",
  "capnpcclear",
  "capnpctarget",
  "capnpchome",
  "capnpcfighters",
  "capnpcsuper",
  "capnpcsignoff",
  "capnpcperf",
]);

const CAPITAL_NPC_HELP_LINES = Object.freeze([
  "/capnpc [amount] [capital faction|class|name]",
  "/capnpcinfo [capital faction|class|name]",
  "/capnpcstatus [capital faction|class|name]",
  "/capnpcclear [capital faction|class|name]",
  "/capnpctarget [capital faction|class|name] <me|entityID>",
  "/capnpchome [capital faction|class|name]",
  "/capnpcfighters [status|launch|reset] [capital faction|class|name]",
  "/capnpcsuper [status|fire] [capital faction|class|name] [me|entityID]",
  "/capnpcsignoff <capital hull name> [me|entityID]",
  "/capnpcperf",
]);

module.exports = {
  CAPITAL_NPC_CHAT_COMMANDS,
  CAPITAL_NPC_HELP_LINES,
  executeCapitalNpcCommand,
};
