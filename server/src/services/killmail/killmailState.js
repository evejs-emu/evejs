const crypto = require("crypto");
const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getWarRecord,
  listAllWarsDescending,
} = require(path.join(__dirname, "../corporation/warRuntimeState"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));

const KILLMAIL_TABLE = "killmails";
const KILLMAIL_VERSION = 1;
const GROUP_CAPSULES = 0;
const GROUP_FRIGATES = 1;
const GROUP_DESTROYERS = 2;
const GROUP_CRUISERS = 3;
const GROUP_BATTLESHIPS = 4;
const GROUP_BATTLECRUISERS = 5;
const GROUP_CAPITALSHIPS = 6;
const GROUP_INDUSTRIALS = 7;
const GROUP_POS = 8;
const GROUP_STRUCTURES = 9;
let killmailTableCache = null;
let killmailBootstrapComplete = false;
let killmailIndexesDirty = true;
let killmailIndexes = null;

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function normalizePositiveInteger(value, fallback = null) {
  const numericValue = normalizeInteger(value, 0);
  return numericValue > 0 ? numericValue : fallback;
}

function normalizeNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeNullableNumber(value, fallback = null) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeText(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }
  return typeof value === "string" ? value : String(value);
}

function normalizeFiletimeString(value, fallback = null) {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return fallback || currentFileTime().toString();
}

function buildDefaultTable() {
  return {
    _meta: {
      version: KILLMAIL_VERSION,
      nextKillID: 1,
    },
    records: {},
  };
}

function markKillmailIndexesDirty() {
  killmailIndexesDirty = true;
  killmailIndexes = null;
}

function readKillmailTable() {
  const result = database.read(KILLMAIL_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return buildDefaultTable();
  }

  const table = cloneValue(result.data);
  if (!table._meta || typeof table._meta !== "object") {
    table._meta = {};
  }
  if (!table.records || typeof table.records !== "object") {
    table.records = {};
  }
  if (!Number.isFinite(Number(table._meta.version))) {
    table._meta.version = KILLMAIL_VERSION;
  }
  if (!Number.isFinite(Number(table._meta.nextKillID)) || Number(table._meta.nextKillID) <= 0) {
    table._meta.nextKillID = 1;
  }
  return table;
}

function readKillmailTableView() {
  const result = database.read(KILLMAIL_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return null;
  }
  return result.data;
}

function writeKillmailTable(table) {
  const writeResult = database.write(KILLMAIL_TABLE, "/", table);
  if (writeResult && writeResult.success) {
    killmailTableCache = table;
    markKillmailIndexesDirty();
  }
  return writeResult;
}

function ensureKillmailTableInitialized() {
  if (killmailBootstrapComplete && killmailTableCache) {
    return killmailTableCache;
  }

  const table = readKillmailTable();
  const writeResult = writeKillmailTable(table);
  if (!writeResult.success) {
    return buildDefaultTable();
  }
  killmailTableCache = table;
  killmailBootstrapComplete = true;
  return table;
}

function sortKillmailsDescending(records = []) {
  return records
    .slice()
    .sort(
      (left, right) =>
        normalizeInteger(right && right.killID, 0) -
          normalizeInteger(left && left.killID, 0) ||
        String(right && right.killTime ? right.killTime : "").localeCompare(
          String(left && left.killTime ? left.killTime : ""),
        ),
    );
}

function filterByStartKillID(records = [], startKillID = null) {
  const numericStartKillID = normalizePositiveInteger(startKillID, null);
  if (!numericStartKillID) {
    return records.slice();
  }
  return records.filter(
    (record) => normalizePositiveInteger(record && record.killID, 0) < numericStartKillID,
  );
}

function limitRecords(records = [], limit = null) {
  const numericLimit = normalizeInteger(limit, 0);
  if (numericLimit <= 0) {
    return records.slice();
  }
  return records.slice(0, numericLimit);
}

function buildEmptyKillmailIndexes() {
  return {
    recordsDesc: [],
    recordsByCharacter: new Map(),
    recordsByCorporationKills: new Map(),
    recordsByCorporationLosses: new Map(),
    recordsByAllianceKills: new Map(),
    recordsByAllianceLosses: new Map(),
    recordsByWar: new Map(),
  };
}

function appendRecordToIndex(indexMap, key, record) {
  if (!key) {
    return;
  }
  if (!indexMap.has(key)) {
    indexMap.set(key, []);
  }
  indexMap.get(key).push(record);
}

function collectAttackerOwnerIDs(record = {}, fieldName) {
  const ownerIDs = new Set();
  const finalOwnerID = normalizePositiveInteger(record && record[`final${fieldName}`], null);
  const attackerFieldName =
    fieldName.length > 0
      ? `${fieldName.charAt(0).toLowerCase()}${fieldName.slice(1)}`
      : fieldName;
  if (finalOwnerID) {
    ownerIDs.add(finalOwnerID);
  }
  for (const attacker of Array.isArray(record && record.attackers) ? record.attackers : []) {
    const ownerID = normalizePositiveInteger(
      attacker && attacker[attackerFieldName],
      null,
    );
    if (ownerID) {
      ownerIDs.add(ownerID);
    }
  }
  return [...ownerIDs];
}

function ensureKillmailIndexes() {
  if (!killmailIndexesDirty && killmailIndexes) {
    return killmailIndexes;
  }

  const table = ensureKillmailTableInitialized();
  const indexes = buildEmptyKillmailIndexes();
  const records = Object.values((table && table.records) || {});
  indexes.recordsDesc = sortKillmailsDescending(records);

  for (const record of indexes.recordsDesc) {
    const finalCharacterID = normalizePositiveInteger(record && record.finalCharacterID, null);
    const victimCharacterID = normalizePositiveInteger(record && record.victimCharacterID, null);
    const victimCorporationID = normalizePositiveInteger(record && record.victimCorporationID, null);
    const victimAllianceID = normalizePositiveInteger(record && record.victimAllianceID, null);
    const warID = normalizePositiveInteger(record && record.warID, null);
    const attackerCorporationIDs = collectAttackerOwnerIDs(record, "CorporationID");
    const attackerAllianceIDs = collectAttackerOwnerIDs(record, "AllianceID");

    appendRecordToIndex(indexes.recordsByCharacter, finalCharacterID, record);
    if (victimCharacterID && victimCharacterID !== finalCharacterID) {
      appendRecordToIndex(indexes.recordsByCharacter, victimCharacterID, record);
    }

    for (const corporationID of attackerCorporationIDs) {
      appendRecordToIndex(indexes.recordsByCorporationKills, corporationID, record);
    }
    appendRecordToIndex(indexes.recordsByCorporationLosses, victimCorporationID, record);
    for (const allianceID of attackerAllianceIDs) {
      appendRecordToIndex(indexes.recordsByAllianceKills, allianceID, record);
    }
    appendRecordToIndex(indexes.recordsByAllianceLosses, victimAllianceID, record);
    appendRecordToIndex(indexes.recordsByWar, warID, record);
  }

  killmailIndexes = indexes;
  killmailIndexesDirty = false;
  return killmailIndexes;
}

function getAllKillmailRecords() {
  return cloneValue(ensureKillmailIndexes().recordsDesc);
}

function getKillmailRecord(killID) {
  const numericKillID = normalizePositiveInteger(killID, null);
  if (!numericKillID) {
    return null;
  }
  const table = killmailTableCache || readKillmailTableView() || ensureKillmailTableInitialized();
  const record = table.records && table.records[String(numericKillID)];
  return record ? cloneValue(record) : null;
}

function pythonStringify(value) {
  if (value === undefined || value === null) {
    return "None";
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return String(value);
}

function getKillmailHashValue(killmail) {
  if (!killmail) {
    return "";
  }
  const hashInput = [
    pythonStringify(killmail.victimCharacterID),
    pythonStringify(killmail.finalCharacterID),
    pythonStringify(killmail.victimShipTypeID),
    pythonStringify(killmail.killTime),
  ].join("");
  return crypto.createHash("sha1").update(hashInput, "utf8").digest("hex");
}

function escapeXmlAttribute(value) {
  return normalizeText(value, "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatSecurityStatusText(value) {
  const numericValue = normalizeNullableNumber(value, null);
  if (numericValue === null) {
    return "0.0";
  }
  return (Math.round(numericValue * 10) / 10).toFixed(1);
}

function buildBlobAttackerEntry(attacker = {}) {
  const attributes = [
    ["c", normalizePositiveInteger(attacker.characterID, null)],
    ["r", normalizePositiveInteger(attacker.corporationID, null)],
    ["a", normalizePositiveInteger(attacker.allianceID, null)],
    ["f", normalizePositiveInteger(attacker.factionID, null)],
    ["s", normalizePositiveInteger(attacker.shipTypeID, null)],
    ["w", normalizePositiveInteger(attacker.weaponTypeID, null)],
    ["d", Math.max(0, normalizeInteger(attacker.damageDone, 0))],
    ["t", formatSecurityStatusText(attacker.securityStatus)],
  ]
    .filter(([, attributeValue]) => attributeValue !== null && attributeValue !== undefined)
    .map(([name, attributeValue]) => ` ${name}="${escapeXmlAttribute(attributeValue)}"`)
    .join("");
  return `<a${attributes} />`;
}

function buildBlobItemEntry(item = {}, depth = 0) {
  const attributes = [
    ["t", normalizePositiveInteger(item.typeID, null)],
    ["f", normalizeInteger(item.flag, 0)],
    ["s", normalizeInteger(item.singleton, 0)],
    ["d", Math.max(0, normalizeInteger(item.qtyDropped, 0))],
    ["x", Math.max(0, normalizeInteger(item.qtyDestroyed, 0))],
  ]
    .filter(([, attributeValue]) => attributeValue !== null && attributeValue !== undefined)
    .map(([name, attributeValue]) => ` ${name}="${escapeXmlAttribute(attributeValue)}"`)
    .join("");
  const contents =
    depth === 0 && Array.isArray(item.contents)
      ? item.contents.map((contentItem) => buildBlobItemEntry(contentItem, depth + 1)).join("")
      : "";
  return `<i${attributes}>${contents}</i>`;
}

function buildKillBlob({ attackers = [], items = [] } = {}) {
  const attackerSection = `<attackers>${attackers
    .map((attacker) => buildBlobAttackerEntry(attacker))
    .join("")}</attackers>`;
  const itemSection = `<items>${items.map((item) => buildBlobItemEntry(item)).join("")}</items>`;
  return `${attackerSection}${itemSection}`;
}

function getTypeBasePrice(typeID) {
  const typeRecord = resolveItemByTypeID(typeID) || null;
  if (!typeRecord) {
    return 0;
  }
  return Math.max(0, normalizeNumber(typeRecord.basePrice, 0));
}

function sumKillmailItemValue(items = [], valueSelector = "all") {
  return items.reduce((sum, item) => {
    const qtyDropped = Math.max(0, normalizeInteger(item && item.qtyDropped, 0));
    const qtyDestroyed = Math.max(0, normalizeInteger(item && item.qtyDestroyed, 0));
    const basePrice = getTypeBasePrice(item && item.typeID);
    const quantity =
      valueSelector === "destroyed"
        ? qtyDestroyed
        : valueSelector === "dropped"
          ? qtyDropped
          : qtyDropped + qtyDestroyed;
    return (
      sum +
      basePrice * quantity +
      sumKillmailItemValue(
        Array.isArray(item && item.contents) ? item.contents : [],
        valueSelector,
      )
    );
  }, 0);
}

function normalizeAttackerEntry(entry = {}) {
  return {
    characterID: normalizePositiveInteger(entry.characterID, null),
    corporationID: normalizePositiveInteger(entry.corporationID, null),
    allianceID: normalizePositiveInteger(entry.allianceID, null),
    factionID: normalizePositiveInteger(entry.factionID, null),
    shipTypeID: normalizePositiveInteger(entry.shipTypeID, null),
    weaponTypeID: normalizePositiveInteger(entry.weaponTypeID, null),
    damageDone: Math.max(0, normalizeNumber(entry.damageDone, 0)),
    securityStatus: normalizeNullableNumber(entry.securityStatus, null),
  };
}

function normalizeItemEntry(entry = {}, depth = 0) {
  return {
    typeID: normalizePositiveInteger(entry.typeID, null),
    flag: normalizeInteger(entry.flag, 0),
    singleton: normalizeInteger(entry.singleton, 0),
    qtyDropped: Math.max(0, normalizeInteger(entry.qtyDropped, 0)),
    qtyDestroyed: Math.max(0, normalizeInteger(entry.qtyDestroyed, 0)),
    contents:
      depth < 1 && Array.isArray(entry.contents)
        ? entry.contents.map((contentEntry) => normalizeItemEntry(contentEntry, depth + 1))
        : [],
  };
}

function createKillmailRecord(record = {}) {
  const table = ensureKillmailTableInitialized();
  const killID = normalizePositiveInteger(table._meta.nextKillID, 1) || 1;
  table._meta.nextKillID = killID + 1;

  const normalizedAttackers = Array.isArray(record.attackers)
    ? record.attackers.map((entry) => normalizeAttackerEntry(entry))
    : [];
  const normalizedItems = Array.isArray(record.items)
    ? record.items.map((entry) => normalizeItemEntry(entry))
    : [];
  const normalizedRecord = {
    killID,
    killTime: normalizeFiletimeString(record.killTime),
    solarSystemID: normalizePositiveInteger(record.solarSystemID, null),
    moonID: normalizePositiveInteger(record.moonID, null),
    victimCharacterID: normalizePositiveInteger(record.victimCharacterID, null),
    victimCorporationID: normalizePositiveInteger(record.victimCorporationID, null),
    victimAllianceID: normalizePositiveInteger(record.victimAllianceID, null),
    victimFactionID: normalizePositiveInteger(record.victimFactionID, null),
    victimShipTypeID: normalizePositiveInteger(record.victimShipTypeID, null),
    victimDamageTaken: Math.max(0, normalizeNumber(record.victimDamageTaken, 0)),
    finalCharacterID: normalizePositiveInteger(record.finalCharacterID, null),
    finalCorporationID: normalizePositiveInteger(record.finalCorporationID, null),
    finalAllianceID: normalizePositiveInteger(record.finalAllianceID, null),
    finalFactionID: normalizePositiveInteger(record.finalFactionID, null),
    finalShipTypeID: normalizePositiveInteger(record.finalShipTypeID, null),
    finalWeaponTypeID: normalizePositiveInteger(record.finalWeaponTypeID, null),
    finalSecurityStatus: normalizeNullableNumber(record.finalSecurityStatus, null),
    finalDamageDone: Math.max(0, normalizeNumber(record.finalDamageDone, 0)),
    warID: normalizePositiveInteger(record.warID, null),
    iskLost: normalizeNumber(
      record.iskLost,
      getTypeBasePrice(record.victimShipTypeID) + sumKillmailItemValue(normalizedItems, "all"),
    ),
    iskDestroyed: normalizeNumber(
      record.iskDestroyed,
      getTypeBasePrice(record.victimShipTypeID) + sumKillmailItemValue(normalizedItems, "destroyed"),
    ),
    bountyClaimed: normalizeNullableNumber(record.bountyClaimed, null),
    loyaltyPoints: normalizeNullableNumber(record.loyaltyPoints, null),
    killRightSupplied: normalizePositiveInteger(record.killRightSupplied, null),
    attackers: normalizedAttackers,
    items: normalizedItems,
  };
  normalizedRecord.killBlob = normalizeText(
    record.killBlob,
    buildKillBlob({
      attackers: normalizedAttackers,
      items: normalizedItems,
    }),
  );

  table.records[String(killID)] = normalizedRecord;
  const writeResult = writeKillmailTable(table);
  if (!writeResult.success) {
    return null;
  }
  return getKillmailRecord(killID);
}

function buildKillmailPayload(record) {
  if (!record) {
    return null;
  }

  return buildKeyVal([
    ["killID", normalizePositiveInteger(record.killID, 0) || 0],
    ["killTime", buildFiletimeLong(record.killTime || currentFileTime())],
    ["solarSystemID", normalizePositiveInteger(record.solarSystemID, null)],
    ["moonID", normalizePositiveInteger(record.moonID, null)],
    ["victimCharacterID", normalizePositiveInteger(record.victimCharacterID, null)],
    ["victimCorporationID", normalizePositiveInteger(record.victimCorporationID, null)],
    ["victimAllianceID", normalizePositiveInteger(record.victimAllianceID, null)],
    ["victimFactionID", normalizePositiveInteger(record.victimFactionID, null)],
    ["victimShipTypeID", normalizePositiveInteger(record.victimShipTypeID, null)],
    ["victimDamageTaken", Math.max(0, normalizeNumber(record.victimDamageTaken, 0))],
    ["finalCharacterID", normalizePositiveInteger(record.finalCharacterID, null)],
    ["finalCorporationID", normalizePositiveInteger(record.finalCorporationID, null)],
    ["finalAllianceID", normalizePositiveInteger(record.finalAllianceID, null)],
    ["finalFactionID", normalizePositiveInteger(record.finalFactionID, null)],
    ["finalShipTypeID", normalizePositiveInteger(record.finalShipTypeID, null)],
    ["finalWeaponTypeID", normalizePositiveInteger(record.finalWeaponTypeID, null)],
    ["finalSecurityStatus", normalizeNullableNumber(record.finalSecurityStatus, null)],
    ["finalDamageDone", Math.max(0, normalizeNumber(record.finalDamageDone, 0))],
    ["warID", normalizePositiveInteger(record.warID, null)],
    ["iskLost", normalizeNullableNumber(record.iskLost, null)],
    ["iskDestroyed", normalizeNullableNumber(record.iskDestroyed, null)],
    ["bountyClaimed", normalizeNullableNumber(record.bountyClaimed, null)],
    ["loyaltyPoints", normalizeNullableNumber(record.loyaltyPoints, null)],
    ["killRightSupplied", normalizePositiveInteger(record.killRightSupplied, null)],
    ["killBlob", normalizeText(record.killBlob, "")],
  ]);
}

function listKillmailsForCharacter(characterID, options = {}) {
  const numericCharacterID = normalizePositiveInteger(characterID, null);
  if (!numericCharacterID) {
    return [];
  }
  return limitRecords(
    filterByStartKillID(
      ensureKillmailIndexes().recordsByCharacter.get(numericCharacterID) || [],
      options.startKillID,
    ),
    options.limit,
  );
}

function listKillmailsForCorporation(corporationID, relation = "all", options = {}) {
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  if (!numericCorporationID) {
    return [];
  }

  const indexes = ensureKillmailIndexes();
  const kills = indexes.recordsByCorporationKills.get(numericCorporationID) || [];
  const losses = indexes.recordsByCorporationLosses.get(numericCorporationID) || [];
  let filtered = [];
  if (relation === "kills") {
    filtered = kills;
  } else if (relation === "losses") {
    filtered = losses;
  } else {
    const recordsByKillID = new Map();
    for (const record of [...kills, ...losses]) {
      recordsByKillID.set(normalizePositiveInteger(record && record.killID, 0) || 0, record);
    }
    filtered = sortKillmailsDescending([...recordsByKillID.values()]);
  }

  return limitRecords(
    filterByStartKillID(filtered, options.startKillID),
    options.limit,
  );
}

function isWarActiveAtKillTime(war, killTime) {
  if (!war) {
    return false;
  }
  const killTimeValue = BigInt(normalizeFiletimeString(killTime, currentFileTime().toString()));
  const startedAt = BigInt(normalizeFiletimeString(war.timeStarted, "0"));
  const finishedAt =
    war.timeFinished !== undefined && war.timeFinished !== null
      ? BigInt(normalizeFiletimeString(war.timeFinished, "0"))
      : null;
  if (killTimeValue < startedAt) {
    return false;
  }
  if (finishedAt !== null && finishedAt > 0n && killTimeValue >= finishedAt) {
    return false;
  }
  return true;
}

function isAllyActiveAtKillTime(ally = {}, killTime) {
  const killTimeValue = BigInt(normalizeFiletimeString(killTime, currentFileTime().toString()));
  const startedAt = BigInt(normalizeFiletimeString(ally.timeStarted, "0"));
  const finishedAt =
    ally.timeFinished !== undefined && ally.timeFinished !== null
      ? BigInt(normalizeFiletimeString(ally.timeFinished, "0"))
      : null;
  if (killTimeValue < startedAt) {
    return false;
  }
  if (finishedAt !== null && finishedAt > 0n && killTimeValue >= finishedAt) {
    return false;
  }
  return true;
}

function buildWarOwnerSets(war, killTime) {
  const attackerOwners = new Set();
  const defenderOwners = new Set();
  const attackerID = normalizePositiveInteger(war && war.declaredByID, null);
  const defenderID = normalizePositiveInteger(war && war.againstID, null);

  if (attackerID) {
    attackerOwners.add(attackerID);
  }
  if (defenderID) {
    defenderOwners.add(defenderID);
  }

  for (const [allyID, ally] of Object.entries((war && war.allies) || {})) {
    const numericAllyID = normalizePositiveInteger(allyID, null);
    if (!numericAllyID || !isAllyActiveAtKillTime(ally, killTime)) {
      continue;
    }
    defenderOwners.add(numericAllyID);
  }

  return {
    attackerOwners,
    defenderOwners,
  };
}

function resolveKillmailWarSide(record, war, actor = "victim") {
  if (!record || !war) {
    return null;
  }
  const ownerSets = buildWarOwnerSets(war, record.killTime);
  const corporationID = normalizePositiveInteger(record[`${actor}CorporationID`], null);
  const allianceID = normalizePositiveInteger(record[`${actor}AllianceID`], null);
  if (allianceID && ownerSets.attackerOwners.has(allianceID)) {
    return "attacker";
  }
  if (corporationID && ownerSets.attackerOwners.has(corporationID)) {
    return "attacker";
  }
  if (allianceID && ownerSets.defenderOwners.has(allianceID)) {
    return "defender";
  }
  if (corporationID && ownerSets.defenderOwners.has(corporationID)) {
    return "defender";
  }
  return null;
}

function resolveWarOwnerSide(war, ownerID) {
  const numericOwnerID = normalizePositiveInteger(ownerID, null);
  if (!numericOwnerID || !war) {
    return null;
  }
  const ownerSets = buildWarOwnerSets(war, currentFileTime().toString());
  if (ownerSets.attackerOwners.has(numericOwnerID)) {
    return "attacker";
  }
  if (ownerSets.defenderOwners.has(numericOwnerID)) {
    return "defender";
  }
  return null;
}

function resolveKillmailWarID(record = {}) {
  for (const warEntry of listAllWarsDescending()) {
    if (!isWarActiveAtKillTime(warEntry, record.killTime)) {
      continue;
    }
    const war = getWarRecord(warEntry.warID) || warEntry;
    const victimSide = resolveKillmailWarSide(record, war, "victim");
    if (!victimSide) {
      continue;
    }
    const attackerSides = new Set();
    const finalSide = resolveKillmailWarSide(record, war, "final");
    if (finalSide) {
      attackerSides.add(finalSide);
    }
    for (const attacker of Array.isArray(record.attackers) ? record.attackers : []) {
      const attackerRecord = {
        ...record,
        finalCorporationID: attacker.corporationID,
        finalAllianceID: attacker.allianceID,
      };
      const attackerSide = resolveKillmailWarSide(attackerRecord, war, "final");
      if (attackerSide) {
        attackerSides.add(attackerSide);
      }
    }
    if (
      (victimSide === "attacker" && attackerSides.has("defender")) ||
      (victimSide === "defender" && attackerSides.has("attacker"))
    ) {
      return normalizePositiveInteger(war.warID, null);
    }
  }
  return null;
}

function classifyWarShipGroup(typeID) {
  const typeRecord = resolveItemByTypeID(typeID) || {};
  const categoryID = normalizeInteger(typeRecord.categoryID, 0);
  const groupName = normalizeText(typeRecord.groupName, "").toLowerCase();

  if (categoryID === 65 || groupName.includes("structure")) {
    return GROUP_STRUCTURES;
  }
  if (
    groupName.includes("control tower") ||
    groupName.includes("starbase") ||
    groupName.includes("sentry battery") ||
    groupName.includes("electronic warfare battery")
  ) {
    return GROUP_POS;
  }
  if (groupName.includes("capsule")) {
    return GROUP_CAPSULES;
  }
  if (
    groupName.includes("carrier") ||
    groupName.includes("dreadnought") ||
    groupName.includes("titan") ||
    groupName.includes("supercarrier") ||
    groupName.includes("force auxiliary") ||
    groupName.includes("capital industrial") ||
    groupName.includes("lancer dreadnought")
  ) {
    return GROUP_CAPITALSHIPS;
  }
  if (
    groupName.includes("freighter") ||
    groupName.includes("industrial") ||
    groupName.includes("transport ship") ||
    groupName.includes("mining barge") ||
    groupName.includes("exhumer") ||
    groupName.includes("blockade runner") ||
    groupName.includes("industrial command")
  ) {
    return GROUP_INDUSTRIALS;
  }
  if (
    groupName.includes("battleship") ||
    groupName.includes("black ops") ||
    groupName.includes("marauder")
  ) {
    return GROUP_BATTLESHIPS;
  }
  if (
    groupName.includes("battlecruiser") ||
    groupName.includes("command ship") ||
    groupName.includes("attack battlecruiser")
  ) {
    return GROUP_BATTLECRUISERS;
  }
  if (
    groupName.includes("cruiser") ||
    groupName.includes("recon ship") ||
    groupName.includes("heavy assault") ||
    groupName.includes("heavy interdictor") ||
    groupName.includes("logistics") ||
    groupName.includes("flag cruiser")
  ) {
    return GROUP_CRUISERS;
  }
  if (
    groupName.includes("destroyer") ||
    groupName.includes("interdictor") ||
    groupName.includes("command destroyer") ||
    groupName.includes("tactical destroyer")
  ) {
    return GROUP_DESTROYERS;
  }
  return GROUP_FRIGATES;
}

function listKillmailsForWar(warID, options = {}) {
  const numericWarID = normalizePositiveInteger(warID, null);
  if (!numericWarID) {
    return [];
  }

  const war = getWarRecord(numericWarID);
  if (!war) {
    return [];
  }

  const groupFilter =
    options.groupID === null || options.groupID === undefined
      ? null
      : normalizeInteger(options.groupID, -1);
  const sideFilter = resolveWarOwnerSide(war, options.entityID);

  return (ensureKillmailIndexes().recordsByWar.get(numericWarID) || []).filter((record) => {
      if (normalizePositiveInteger(record && record.warID, null) !== numericWarID) {
        return false;
      }
      if (groupFilter !== null && groupFilter >= 0 && classifyWarShipGroup(record && record.victimShipTypeID) !== groupFilter) {
        return false;
      }
      if (!sideFilter) {
        return true;
      }
      const victimSide = resolveKillmailWarSide(record, war, "victim");
      if (sideFilter === "attacker") {
        return victimSide === "defender";
      }
      if (sideFilter === "defender") {
        return victimSide === "attacker";
      }
      return true;
    });
}

function buildWarDestructionStatistics(warID) {
  const war = getWarRecord(warID);
  if (!war) {
    return {
      shipsKilled: {},
      iskKilled: {},
      killsByGroup: {},
    };
  }

  const shipsKilled = {};
  const iskKilled = {};
  const killsByGroup = {};
  for (const bucket of [
    GROUP_CAPSULES,
    GROUP_FRIGATES,
    GROUP_DESTROYERS,
    GROUP_CRUISERS,
    GROUP_BATTLESHIPS,
    GROUP_BATTLECRUISERS,
    GROUP_CAPITALSHIPS,
    GROUP_INDUSTRIALS,
    GROUP_POS,
    GROUP_STRUCTURES,
  ]) {
    killsByGroup[bucket] = {
      attackerShipLoss: 0,
      attackerIskLoss: 0,
      defenderShipLoss: 0,
      defenderIskLoss: 0,
    };
  }

  for (const record of listKillmailsForWar(warID)) {
    const victimSide = resolveKillmailWarSide(record, war, "victim");
    const groupID = classifyWarShipGroup(record && record.victimShipTypeID);
    const iskLost = Math.max(0, normalizeNumber(record && record.iskLost, 0));
    if (victimSide === "defender") {
      const attackerID = normalizePositiveInteger(war.declaredByID, null);
      if (attackerID) {
        shipsKilled[String(attackerID)] = normalizeInteger(shipsKilled[String(attackerID)], 0) + 1;
        iskKilled[String(attackerID)] = normalizeNumber(iskKilled[String(attackerID)], 0) + iskLost;
      }
      killsByGroup[groupID].defenderShipLoss += 1;
      killsByGroup[groupID].defenderIskLoss += iskLost;
    } else if (victimSide === "attacker") {
      const defenderID = normalizePositiveInteger(war.againstID, null);
      if (defenderID) {
        shipsKilled[String(defenderID)] = normalizeInteger(shipsKilled[String(defenderID)], 0) + 1;
        iskKilled[String(defenderID)] = normalizeNumber(iskKilled[String(defenderID)], 0) + iskLost;
      }
      killsByGroup[groupID].attackerShipLoss += 1;
      killsByGroup[groupID].attackerIskLoss += iskLost;
    }
  }

  return {
    shipsKilled,
    iskKilled,
    killsByGroup,
  };
}

module.exports = {
  GROUP_BATTLECRUISERS,
  GROUP_BATTLESHIPS,
  GROUP_CAPITALSHIPS,
  GROUP_CAPSULES,
  GROUP_CRUISERS,
  GROUP_DESTROYERS,
  GROUP_FRIGATES,
  GROUP_INDUSTRIALS,
  GROUP_POS,
  GROUP_STRUCTURES,
  KILLMAIL_TABLE,
  buildKillmailPayload,
  buildWarDestructionStatistics,
  classifyWarShipGroup,
  createKillmailRecord,
  ensureKillmailTableInitialized,
  getAllKillmailRecords,
  getKillmailHashValue,
  getKillmailRecord,
  listKillmailsForCharacter,
  listKillmailsForCorporation,
  listKillmailsForWar,
  resolveKillmailWarID,
};
