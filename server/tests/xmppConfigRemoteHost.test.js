const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const config = require(path.join(__dirname, "../src/config"));
const {
  buildXmppConferenceJid,
  buildXmppUserJid,
  getXmppConferenceDomain,
  getXmppConferenceDomainPattern,
  getXmppConnectHost,
  getXmppDomain,
} = require(path.join(__dirname, "../src/services/chat/xmppConfig"));

test("xmpp helpers respect configurable connect host and domains", () => {
  const previousValues = {
    xmppConnectHost: config.xmppConnectHost,
    xmppDomain: config.xmppDomain,
    xmppConferenceDomain: config.xmppConferenceDomain,
  };

  try {
    config.xmppConnectHost = "chat.play.example.test";
    config.xmppDomain = "chat.play.example.test";
    config.xmppConferenceDomain = "conference.chat.play.example.test";

    assert.equal(getXmppConnectHost(), "chat.play.example.test");
    assert.equal(getXmppDomain(), "chat.play.example.test");
    assert.equal(
      getXmppConferenceDomain(),
      "conference.chat.play.example.test",
    );
    assert.equal(
      buildXmppUserJid(140000001, "evejs"),
      "140000001@chat.play.example.test/evejs",
    );
    assert.equal(
      buildXmppConferenceJid("local_30000142"),
      "local_30000142@conference.chat.play.example.test",
    );

    const pattern = getXmppConferenceDomainPattern();
    assert.equal(
      pattern.test("room@conference.chat.play.example.test"),
      true,
    );
    assert.equal(pattern.test("room@conference.localhost"), false);
  } finally {
    config.xmppConnectHost = previousValues.xmppConnectHost;
    config.xmppDomain = previousValues.xmppDomain;
    config.xmppConferenceDomain = previousValues.xmppConferenceDomain;
  }
});
