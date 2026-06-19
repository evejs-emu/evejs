const path = require("path");

const {
  buildKillmailItemTreeForLocation,
} = require(path.join(__dirname, "../../services/killmail/killmailItemPayload"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../services/inventory/itemTypeRegistry"));
const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const FILETIME_TICKS_PER_MS = 10000n;
const LEDGER_TTL_MS = 30 * 60 * 1000;

const ledgersByVictim = new Map();

function getCharacterStateService() {
  return require(path.join(__dirname, "../../services/character/characterState"));
}

function getKillmailStateService() {
  return require(path.join(__dirname, "../../services/killmail/killmailState"));
}

function createKillmailRecord(recordInput) {
  const killmailState = getKillmailStateService();
  return killmailState && typeof killmailState.createKillmailRecord === "function"
    ? killmailState.createKillmailRecord(recordInput)
    : { success: false, errorMsg: "KILLMAIL_STATE_UNAVAILABLE" };
}

function resolveKillmailWarID(recordInput) {
  const killmailState = getKillmailStateService();
  return killmailState && typeof killmailState.resolveKillmailWarID === "function"
    ? killmailState.resolveKillmailWarID(recordInput)
    : null;
}

function resolveCharacterRecord(characterID) {
  const characterState = getCharacterStateService();
  return characterState && typeof characterState.getCharacterRecord === "function"
    ? characterState.getCharacterRecord(characterID)
    : null;
}

function toFiniteNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function toInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function toPositiveInt(value, fallback = null) {
  const numericValue = toInteger(value, 0);
  return numericValue > 0 ? numericValue : fallback;
}

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function formatKillmailFiletime(whenMs = Date.now()) {
  const numericWhenMs = Number.isFinite(Number(whenMs)) ? Math.trunc(Number(whenMs)) : Date.now();
  return (BigInt(numericWhenMs) * FILETIME_TICKS_PER_MS + FILETIME_EPOCH_OFFSET).toString();
}

function cleanupExpiredLedgers(nowMs = Date.now()) {
  for (const [ledgerKey, ledger] of [...ledgersByVictim.entries()]) {
    if (!ledger || nowMs - toFiniteNumber(ledger.lastUpdatedAtMs, 0) > LEDGER_TTL_MS) {
      ledgersByVictim.delete(ledgerKey);
    }
  }
}

function getVictimLedgerKey(entity) {
  const itemID = toPositiveInt(entity && entity.itemID, 0) || 0;
  return `${String(entity && entity.kind || "entity")}:${itemID}`;
}

function resolveWeaponTypeID(options = {}) {
  const weaponSnapshot = options.weaponSnapshot || null;
  const moduleItem = options.moduleItem || null;
  const chargeItem = options.chargeItem || null;
  return (
    toPositiveInt(
      options.weaponTypeID,
      toPositiveInt(
        weaponSnapshot && weaponSnapshot.chargeTypeID,
        toPositiveInt(
          weaponSnapshot && weaponSnapshot.moduleTypeID,
          toPositiveInt(
            chargeItem && chargeItem.typeID,
            toPositiveInt(moduleItem && moduleItem.typeID, null),
          ),
        ),
      ),
    ) || null
  );
}

function resolveAttackerIdentity(attackerEntity, options = {}) {
  if (!attackerEntity) {
    return {
      characterID: null,
      corporationID: null,
      allianceID: null,
      factionID: null,
      shipTypeID: null,
      weaponTypeID: resolveWeaponTypeID(options),
      securityStatus: null,
    };
  }

  const characterID = toPositiveInt(
    attackerEntity.pilotCharacterID ?? attackerEntity.characterID,
    null,
  );
  const characterRecord = characterID ? resolveCharacterRecord(characterID) || {} : {};
  return {
    characterID,
    corporationID: toPositiveInt(
      characterRecord.corporationID,
      toPositiveInt(attackerEntity.corporationID, toPositiveInt(attackerEntity.ownerID, null)),
    ),
    allianceID: toPositiveInt(characterRecord.allianceID, toPositiveInt(attackerEntity.allianceID, null)),
    factionID: toPositiveInt(
      characterRecord.factionID,
      toPositiveInt(attackerEntity.warFactionID, null),
    ),
    shipTypeID: toPositiveInt(attackerEntity.typeID, null),
    weaponTypeID: resolveWeaponTypeID(options),
    securityStatus:
      characterID && characterRecord
        ? toFiniteNumber(
            characterRecord.securityStatus ?? characterRecord.securityRating,
            0,
          )
        : null,
  };
}

function resolveVictimIdentity(targetEntity) {
  if (!targetEntity) {
    return {
      victimCharacterID: null,
      victimCorporationID: null,
      victimAllianceID: null,
      victimFactionID: null,
      victimShipTypeID: null,
    };
  }

  if (String(targetEntity.kind || "").toLowerCase() === "structure") {
    return {
      victimCharacterID: null,
      victimCorporationID: toPositiveInt(
        targetEntity.corporationID,
        toPositiveInt(targetEntity.ownerID, null),
      ),
      victimAllianceID: toPositiveInt(targetEntity.allianceID, null),
      victimFactionID: null,
      victimShipTypeID: toPositiveInt(targetEntity.typeID, null),
    };
  }

  const characterID = toPositiveInt(
    targetEntity.pilotCharacterID ?? targetEntity.characterID,
    null,
  );
  const characterRecord = characterID ? resolveCharacterRecord(characterID) || {} : {};
  return {
    victimCharacterID: characterID,
    victimCorporationID: toPositiveInt(
      characterRecord.corporationID,
      toPositiveInt(targetEntity.corporationID, toPositiveInt(targetEntity.ownerID, null)),
    ),
    victimAllianceID: toPositiveInt(
      characterRecord.allianceID,
      toPositiveInt(targetEntity.allianceID, null),
    ),
    victimFactionID: toPositiveInt(
      characterRecord.factionID,
      toPositiveInt(targetEntity.warFactionID, null),
    ),
    victimShipTypeID: toPositiveInt(targetEntity.typeID, null),
  };
}

function getOrCreateLedger(targetEntity, whenMs = Date.now()) {
  cleanupExpiredLedgers(whenMs);
  const ledgerKey = getVictimLedgerKey(targetEntity);
  if (!ledgersByVictim.has(ledgerKey)) {
    ledgersByVictim.set(ledgerKey, {
      victimKey: ledgerKey,
      victimItemID: toPositiveInt(targetEntity && targetEntity.itemID, null),
      victimKind: String(targetEntity && targetEntity.kind || "entity"),
      solarSystemID: toPositiveInt(targetEntity && targetEntity.systemID, null),
      damageTaken: 0,
      attackers: {},
      lastUpdatedAtMs: whenMs,
    });
  }
  return ledgersByVictim.get(ledgerKey);
}

function buildAttackerLedgerKey(identity = {}) {
  return [
    toPositiveInt(identity.characterID, 0) || 0,
    toPositiveInt(identity.corporationID, 0) || 0,
    toPositiveInt(identity.allianceID, 0) || 0,
    toPositiveInt(identity.factionID, 0) || 0,
    toPositiveInt(identity.shipTypeID, 0) || 0,
    toPositiveInt(identity.weaponTypeID, 0) || 0,
  ].join(":");
}

function noteDamage(attackerEntity, targetEntity, appliedDamage, options = {}) {
  const damageAmount = Math.max(0, toFiniteNumber(appliedDamage, 0));
  if (!targetEntity || damageAmount <= 0) {
    return null;
  }

  const whenMs = Number.isFinite(Number(options.whenMs)) ? Number(options.whenMs) : Date.now();
  const ledger = getOrCreateLedger(targetEntity, whenMs);
  const identity = resolveAttackerIdentity(attackerEntity, options);
  const attackerKey = buildAttackerLedgerKey(identity);
  const currentEntry = ledger.attackers[attackerKey] || {
    ...identity,
    damageDone: 0,
  };
  currentEntry.damageDone = toFiniteNumber(currentEntry.damageDone, 0) + damageAmount;
  ledger.attackers[attackerKey] = currentEntry;
  ledger.damageTaken = toFiniteNumber(ledger.damageTaken, 0) + damageAmount;
  ledger.lastUpdatedAtMs = whenMs;
  ledger.solarSystemID = toPositiveInt(
    targetEntity.systemID,
    toPositiveInt(ledger.solarSystemID, null),
  );
  return cloneValue(currentEntry);
}

function resolveKillmailItems(destroyResult = {}, lootLocationIDs = []) {
  const lootOutcomeItems =
    destroyResult &&
    destroyResult.data &&
    destroyResult.data.lootOutcome &&
    Array.isArray(destroyResult.data.lootOutcome.items)
      ? cloneValue(destroyResult.data.lootOutcome.items)
      : null;
  if (lootOutcomeItems) {
    return lootOutcomeItems;
  }
  return lootLocationIDs.flatMap((locationID) => buildKillmailItemTreeForLocation(locationID));
}

function sumItemLossValue(items = []) {
  return items.reduce((sum, item) => {
    const basePrice = Math.max(
      0,
      toFiniteNumber((resolveItemByTypeID(item && item.typeID) || {}).basePrice, 0),
    );
    const quantity =
      Math.max(0, toInteger(item && item.qtyDropped, 0)) +
      Math.max(0, toInteger(item && item.qtyDestroyed, 0));
    return sum + basePrice * quantity + sumItemLossValue(item && item.contents ? item.contents : []);
  }, 0);
}

function resolveLootLocationIDs(targetEntity, destroyResult = {}) {
  if (
    String(targetEntity && targetEntity.kind || "").toLowerCase() === "ship" &&
    destroyResult &&
    destroyResult.data &&
    destroyResult.data.wreck
  ) {
    return [toPositiveInt(destroyResult.data.wreck.itemID, null)].filter(Boolean);
  }

  if (
    String(targetEntity && targetEntity.kind || "").toLowerCase() === "structure" &&
    destroyResult &&
    destroyResult.data
  ) {
    const loot = destroyResult.data.loot || null;
    if (loot) {
      const ids = [];
      if (loot.wreck && loot.wreck.itemID) {
        ids.push(toPositiveInt(loot.wreck.itemID, null));
      }
      for (const container of Array.isArray(loot.containers) ? loot.containers : []) {
        ids.push(toPositiveInt(container && container.containerID, null));
      }
      return ids.filter(Boolean);
    }
    if (Array.isArray(destroyResult.data.lootItemIDs)) {
      return destroyResult.data.lootItemIDs.map((value) => toPositiveInt(value, null)).filter(Boolean);
    }
  }

  return [];
}

function resolveBountyPayout(targetEntity, finalAttacker = {}, options = {}) {
  const bountyRuntime = require(path.join(__dirname, "../../services/bounty/bountyRuntime"));
  const result = bountyRuntime.recordNpcBountyKill(targetEntity, finalAttacker, {
    nowMs: options.whenMs,
    solarSystemID: toPositiveInt(targetEntity && targetEntity.systemID, null),
  });
  return result && result.eligible === true ? result.amount : null;
}

function recordKillmailFromDestruction(targetEntity, destroyResult, options = {}) {
  if (!targetEntity || !destroyResult || destroyResult.success !== true) {
    return null;
  }

  const whenMs = Number.isFinite(Number(options.whenMs)) ? Number(options.whenMs) : Date.now();
  const ledgerKey = getVictimLedgerKey(targetEntity);
  const ledger = ledgersByVictim.get(ledgerKey) || getOrCreateLedger(targetEntity, whenMs);
  const finalIdentity = resolveAttackerIdentity(options.attackerEntity || null, options);
  const finalAttackerKey = buildAttackerLedgerKey(finalIdentity);
  const finalAttacker = ledger.attackers[finalAttackerKey] || {
    ...finalIdentity,
    damageDone: 0,
  };
  ledger.attackers[finalAttackerKey] = finalAttacker;
  ledger.lastUpdatedAtMs = whenMs;

  const victimIdentity = resolveVictimIdentity(targetEntity);
  const lootLocationIDs = resolveLootLocationIDs(targetEntity, destroyResult);
  const items = resolveKillmailItems(destroyResult, lootLocationIDs);
  const bountyClaimed = resolveBountyPayout(targetEntity, finalAttacker, {
    whenMs,
  });
  const killRecordInput = {
    killTime: formatKillmailFiletime(whenMs),
    solarSystemID: toPositiveInt(targetEntity.systemID, toPositiveInt(ledger.solarSystemID, null)),
    moonID: null,
    ...victimIdentity,
    victimDamageTaken: Math.max(0, toFiniteNumber(ledger.damageTaken, 0)),
    finalCharacterID: finalAttacker.characterID,
    finalCorporationID: finalAttacker.corporationID,
    finalAllianceID: finalAttacker.allianceID,
    finalFactionID: finalAttacker.factionID,
    finalShipTypeID: finalAttacker.shipTypeID,
    finalWeaponTypeID: finalAttacker.weaponTypeID,
    finalSecurityStatus: finalAttacker.securityStatus,
    finalDamageDone: Math.max(0, toFiniteNumber(finalAttacker.damageDone, 0)),
    iskLost:
      Math.max(
        0,
        toFiniteNumber((resolveItemByTypeID(victimIdentity.victimShipTypeID) || {}).basePrice, 0),
      ) + sumItemLossValue(items),
    bountyClaimed,
    loyaltyPoints: null,
    killRightSupplied: null,
    attackers: Object.entries(ledger.attackers)
      .filter(([attackerKey]) => attackerKey !== finalAttackerKey)
      .map(([, attacker]) => attacker)
      .sort((left, right) => toFiniteNumber(right && right.damageDone, 0) - toFiniteNumber(left && left.damageDone, 0)),
    items,
  };
  killRecordInput.warID = resolveKillmailWarID(killRecordInput);
  const record = createKillmailRecord(killRecordInput);
  ledgersByVictim.delete(ledgerKey);
  return record;
}

module.exports = {
  noteDamage,
  recordKillmailFromDestruction,
};
