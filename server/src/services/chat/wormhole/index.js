const {
  executeWormholeCommand,
} = require("./wormholeCommandHandlers");

const WORMHOLE_CHAT_COMMANDS = Object.freeze([
  "wormhole",
  "wormholes",
]);

const WORMHOLE_HELP_LINES = Object.freeze([
  "/wormholes [here|all|system]",
  "/wormholes systems [all|here|system]",
  "/wormhole status [here|all|system]",
  "/wormhole ensure [here|system|all]",
  "/wormhole random [count] [here|system]",
  "/wormhole clear [here|all|system]",
]);

module.exports = {
  WORMHOLE_CHAT_COMMANDS,
  WORMHOLE_HELP_LINES,
  executeWormholeCommand,
};
