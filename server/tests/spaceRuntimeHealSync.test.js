const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));

const DEFAULT_PASSIVE_STATE = Object.freeze({
  mass: 1_000_000,
  agility: 0.5,
  maxVelocity: 300,
  maxTargetRange: 250_000,
  maxLockedTargets: 7,
  signatureRadius: 50,
  scanResolution: 500,
  cloakingTargetingDelay: 0,
  capacitorCapacity: 1000,
  capacitorRechargeRate: 1000,
  shieldCapacity: 1000,
  shieldRechargeRate: 1000,
  armorHP: 1000,
  structureHP: 1000,
});

function buildShipEntity(scene, itemID, x, options = {}) {
  const conditionState = options.conditionState || {};
  return spaceRuntime._testing.buildRuntimeShipEntityForTesting({
    itemID,
    typeID: options.typeID ?? 606,
    characterID: options.characterID ?? 0,
    position: options.position ?? { x, y: 0, z: 0 },
    capacitorChargeRatio:
      options.capacitorChargeRatio ??
      conditionState.charge ??
      1,
    conditionState,
    passiveResourceState: {
      ...DEFAULT_PASSIVE_STATE,
      ...(options.passiveResourceState || {}),
    },
  }, scene.systemID);
}

function attachSession(scene, entity, clientID, characterID = 0) {
  const notifications = [];
  const session = {
    clientID,
    characterID,
    _space: {
      systemID: scene.systemID,
      shipID: entity.itemID,
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set(),
      timeDilation: scene.getTimeDilation(),
      simTimeMs: scene.getCurrentSimTimeMs(),
      simFileTime: scene.getCurrentFileTime(),
    },
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendServiceNotification() {},
  };

  entity.session = session;
  scene.spawnDynamicEntity(entity, { broadcast: false });
  scene.sessions.set(clientID, session);
  return { session, notifications };
}

function flattenAttributeChanges(notifications = []) {
  const changes = [];
  for (const notification of notifications) {
    if (
      !notification ||
      notification.name !== "OnModuleAttributeChanges" ||
      !Array.isArray(notification.payload)
    ) {
      continue;
    }

    const payloadList = notification.payload[0];
    const items = Array.isArray(payloadList && payloadList.items)
      ? payloadList.items
      : [];
    changes.push(...items);
  }
  return changes;
}

function flattenDestinyUpdates(notifications = []) {
  const updates = [];
  for (const notification of notifications) {
    if (
      !notification ||
      notification.name !== "DoDestinyUpdate" ||
      !Array.isArray(notification.payload)
    ) {
      continue;
    }

    const payloadList = notification.payload[0];
    const entries = Array.isArray(payloadList && payloadList.items)
      ? payloadList.items
      : [];
    for (const entry of entries) {
      const payload = Array.isArray(entry) ? entry[1] : null;
      if (!Array.isArray(payload) || typeof payload[0] !== "string") {
        continue;
      }
      updates.push({
        name: payload[0],
        args: Array.isArray(payload[1]) ? payload[1] : [],
      });
    }
  }
  return updates;
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("healSessionShipResources refreshes the owner HUD and observer damage state", () => {
  const previousNpcStartup = process.env.EVEJS_SKIP_NPC_STARTUP;
  process.env.EVEJS_SKIP_NPC_STARTUP = "1";

  try {
    const scene = spaceRuntime.ensureScene(30000142);
    const healedEntity = buildShipEntity(scene, 970001, 0, {
      characterID: 140000001,
      conditionState: {
        damage: 0.2,
        charge: 0.35,
        armorDamage: 0.4,
        shieldCharge: 0.25,
        incapacitated: false,
      },
    });
    const observerEntity = buildShipEntity(scene, 970002, 500, {
      characterID: 140000002,
    });

    const ownerSession = attachSession(scene, healedEntity, 1, 140000001);
    const observerSession = attachSession(scene, observerEntity, 2, 140000002);

    const result = spaceRuntime.healSessionShipResources(ownerSession.session);

    assert.equal(result.success, true);
    assert.equal(healedEntity.conditionState.shieldCharge, 1);
    assert.equal(healedEntity.conditionState.armorDamage, 0);
    assert.equal(healedEntity.conditionState.damage, 0);
    assert.equal(healedEntity.conditionState.charge, 1);
    assert.equal(healedEntity.capacitorChargeRatio, 1);

    const attributeChanges = flattenAttributeChanges(ownerSession.notifications);
    const changeByAttribute = new Map(
      attributeChanges.map((entry) => [Number(entry[3]), entry]),
    );

    assert.ok(changeByAttribute.has(18), "Expected a capacitor HUD refresh");
    assert.ok(changeByAttribute.has(264), "Expected a shield HUD refresh");
    assert.ok(changeByAttribute.has(266), "Expected an armor HUD refresh");
    assert.ok(changeByAttribute.has(3), "Expected a hull HUD refresh");
    assert.equal(changeByAttribute.get(18)[5], 1000);
    assert.equal(changeByAttribute.get(18)[6], 350);
    assert.equal(changeByAttribute.get(264)[5], 1000);
    assert.equal(changeByAttribute.get(264)[6], 250);
    assert.equal(changeByAttribute.get(266)[5], 0);
    assert.equal(changeByAttribute.get(266)[6], 400);
    assert.equal(changeByAttribute.get(3)[5], 0);
    assert.equal(changeByAttribute.get(3)[6], 200);

    assert.equal(
      ownerSession.notifications.some((entry) => entry.name === "OnDamageStateChange"),
      false,
      "Expected live damage state updates to stay on the destiny path",
    );

    const ownerDestinyUpdates = flattenDestinyUpdates(ownerSession.notifications);
    const observerDestinyUpdates = flattenDestinyUpdates(observerSession.notifications);
    assert.equal(
      ownerDestinyUpdates.some(
        (entry) =>
          entry.name === "OnDamageStateChange" &&
          Number(entry.args[0]) === healedEntity.itemID,
      ),
      true,
    );
    assert.equal(
      observerDestinyUpdates.some(
        (entry) =>
          entry.name === "OnDamageStateChange" &&
          Number(entry.args[0]) === healedEntity.itemID,
      ),
      true,
    );
    assert.equal(
      ownerDestinyUpdates.some((entry) => entry.name === "SetState"),
      true,
      "Expected /heal to force an owner SetState refresh for ego damage visuals",
    );
    assert.equal(
      observerDestinyUpdates.some((entry) => entry.name === "SetState"),
      false,
      "Expected observer damage visuals to stay on the normal live damage-state path",
    );

    const ownerDamageState = ownerDestinyUpdates.find(
      (entry) =>
        entry.name === "OnDamageStateChange" &&
        Number(entry.args[0]) === healedEntity.itemID,
    );
    const observerDamageState = observerDestinyUpdates.find(
      (entry) =>
        entry.name === "OnDamageStateChange" &&
        Number(entry.args[0]) === healedEntity.itemID,
    );
    assert.equal(Number(ownerDamageState.args[1][0][0].value), 1);
    assert.equal(Number(ownerDamageState.args[1][1].value), 1);
    assert.equal(Number(ownerDamageState.args[1][2].value), 1);
    assert.equal(Number(observerDamageState.args[1][0][0].value), 1);
    assert.equal(Number(observerDamageState.args[1][1].value), 1);
    assert.equal(Number(observerDamageState.args[1][2].value), 1);
  } finally {
    if (previousNpcStartup === undefined) {
      delete process.env.EVEJS_SKIP_NPC_STARTUP;
    } else {
      process.env.EVEJS_SKIP_NPC_STARTUP = previousNpcStartup;
    }
  }
});

test("healSessionShipResources can skip the owner SetState rebase for live operator heals", () => {
  const previousNpcStartup = process.env.EVEJS_SKIP_NPC_STARTUP;
  process.env.EVEJS_SKIP_NPC_STARTUP = "1";

  try {
    const scene = spaceRuntime.ensureScene(30000142);
    const healedEntity = buildShipEntity(scene, 970011, 0, {
      characterID: 140000011,
      conditionState: {
        damage: 0.2,
        charge: 0.35,
        armorDamage: 0.4,
        shieldCharge: 0.25,
        incapacitated: false,
      },
    });
    const observerEntity = buildShipEntity(scene, 970012, 500, {
      characterID: 140000012,
    });

    const ownerSession = attachSession(scene, healedEntity, 11, 140000011);
    const observerSession = attachSession(scene, observerEntity, 12, 140000012);

    const result = spaceRuntime.healSessionShipResources(ownerSession.session, {
      refreshOwnerDamagePresentation: false,
    });

    assert.equal(result.success, true);
    const ownerDestinyUpdates = flattenDestinyUpdates(ownerSession.notifications);
    const observerDestinyUpdates = flattenDestinyUpdates(observerSession.notifications);
    assert.equal(
      ownerDestinyUpdates.some(
        (entry) =>
          entry.name === "OnDamageStateChange" &&
          Number(entry.args[0]) === healedEntity.itemID,
      ),
      true,
    );
    assert.equal(
      observerDestinyUpdates.some(
        (entry) =>
          entry.name === "OnDamageStateChange" &&
          Number(entry.args[0]) === healedEntity.itemID,
      ),
      true,
    );
    assert.equal(
      ownerDestinyUpdates.some((entry) => entry.name === "SetState"),
      false,
      "Expected live operator heals to avoid the owner SetState rebase",
    );
    assert.equal(
      ownerDestinyUpdates.some((entry) => entry.name === "AddBalls2"),
      false,
      "Expected live operator heals not to rebuild the pilot ego ball with AddBalls2",
    );
    assert.equal(
      observerDestinyUpdates.some((entry) => entry.name === "AddBalls2"),
      false,
      "Expected the owner-only ego refresh to stay off observer sessions",
    );
  } finally {
    if (previousNpcStartup === undefined) {
      delete process.env.EVEJS_SKIP_NPC_STARTUP;
    } else {
      process.env.EVEJS_SKIP_NPC_STARTUP = previousNpcStartup;
    }
  }
});
