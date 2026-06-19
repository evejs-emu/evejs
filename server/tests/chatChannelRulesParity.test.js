const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const channelRules = require(path.join(
  repoRoot,
  "server/src/services/chat/channelRules",
));

test("k-space local channels keep the standard local_ prefix", () => {
  assert.equal(
    channelRules.getLocalChatRoomNameForSolarSystemID(30000142),
    "local_30000142",
  );
  assert.equal(
    channelRules.isDelayedLocalSolarSystemID(30000142),
    false,
  );
});

test("wormhole and Zarzakh systems use delayed local room names", () => {
  assert.equal(
    channelRules.getLocalChatRoomNameForSolarSystemID(31000005),
    "wormhole_31000005",
  );
  assert.equal(
    channelRules.getLocalChatRoomNameForSolarSystemID(30100000),
    "wormhole_30100000",
  );
  assert.equal(channelRules.isDelayedLocalSolarSystemID(31000005), true);
  assert.equal(channelRules.isDelayedLocalSolarSystemID(30100000), true);
});

test("docked sessions resolve local chat by solar system rather than station id", () => {
  assert.equal(
    channelRules.getLocalChatRoomNameForSession({ stationid: 60003760 }),
    "local_30000142",
  );
});
