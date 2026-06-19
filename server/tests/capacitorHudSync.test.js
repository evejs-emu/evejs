const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));

function buildSession() {
  const notifications = [];
  return {
    characterID: 140000004,
    _space: {
      simFileTime: 134182590016290000n,
    },
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
}

function extractFirstAttributeChange(session) {
  assert.equal(session.notifications.length, 1);
  const notification = session.notifications[0];
  assert.equal(notification.name, "OnModuleAttributeChanges");
  const payload = Array.isArray(notification.payload)
    ? notification.payload[0]
    : null;
  assert.ok(payload && payload.type === "list" && Array.isArray(payload.items));
  assert.equal(payload.items.length, 1);
  return payload.items[0];
}

test("capacitor HUD updates include the previous charge amount", () => {
  const session = buildSession();
  const entity = {
    itemID: 140000333,
    capacitorCapacity: 6750,
    capacitorChargeRatio: 6742.275453 / 6750,
  };

  spaceRuntime._testing.notifyCapacitorChangeToSessionForTesting(
    session,
    entity,
    1742250000000,
    6742.2919864,
  );

  const change = extractFirstAttributeChange(session);
  assert.equal(change[2], 140000333);
  assert.equal(change[3], 18);
  assert.equal(change[5], 6742.275453);
  assert.equal(change[6], 6742.291986);
});

test("capacitor HUD updates fall back to the last sent amount when no explicit old value is provided", () => {
  const session = buildSession();
  const entity = {
    itemID: 140000333,
    capacitorCapacity: 6750,
    capacitorChargeRatio: 6742.305543 / 6750,
    _lastCapNotifiedAmount: 6742.275453,
  };

  spaceRuntime._testing.notifyCapacitorChangeToSessionForTesting(
    session,
    entity,
    1742250000500,
  );

  const change = extractFirstAttributeChange(session);
  assert.equal(change[5], 6742.305543);
  assert.equal(change[6], 6742.275453);
  assert.equal(entity._lastCapNotifiedAmount, 6742.305543);
});
