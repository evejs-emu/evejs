const crypto = require("crypto");
const path = require("path");

const {
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const planetStaticData = require("./planetStaticData");

const DEFAULT_TAX_RATE = 0.05;

const PI_JOURNAL_ENTRY_TYPE = Object.freeze({
  PLANETARY_IMPORT_TAX: 96,
  PLANETARY_EXPORT_TAX: 97,
  PLANETARY_CONSTRUCTION: 98,
});

const COMMAND = Object.freeze({
  CREATEPIN: 1,
  REMOVEPIN: 2,
  CREATELINK: 3,
  REMOVELINK: 4,
  SETLINKLEVEL: 5,
  CREATEROUTE: 6,
  REMOVEROUTE: 7,
  SETSCHEMATIC: 8,
  UPGRADECOMMANDCENTER: 9,
  ADDEXTRACTORHEAD: 10,
  KILLEXTRACTORHEAD: 11,
  MOVEEXTRACTORHEAD: 12,
  INSTALLPROGRAM: 13,
});

function toInt(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeMoney(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.round(numericValue * 100) / 100;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeContents(contents) {
  const unwrapped = unwrapMarshalValue(contents);
  if (!isPlainObject(unwrapped)) {
    return {};
  }

  const normalizedContents = {};
  for (const [typeID, quantity] of Object.entries(unwrapped)) {
    const normalizedTypeID = toInt(typeID, 0);
    const normalizedQuantity = toInt(quantity, 0);
    if (normalizedTypeID > 0 && normalizedQuantity > 0) {
      normalizedContents[String(normalizedTypeID)] = normalizedQuantity;
    }
  }
  return normalizedContents;
}

function normalizeCommandStream(serializedChanges = []) {
  const stream = unwrapMarshalValue(serializedChanges);
  if (!Array.isArray(stream)) {
    return [];
  }

  return stream
    .map((entry) => {
      const unwrappedEntry = unwrapMarshalValue(entry);
      if (Array.isArray(unwrappedEntry)) {
        const args = Array.isArray(unwrappedEntry[1])
          ? unwrappedEntry[1]
          : [unwrappedEntry[1]].filter((value) => value !== undefined);
        return {
          id: toInt(unwrappedEntry[0], 0),
          args,
        };
      }

      if (isPlainObject(unwrappedEntry)) {
        const args = Array.isArray(unwrappedEntry.args)
          ? unwrappedEntry.args
          : Array.isArray(unwrappedEntry.argTuple)
            ? unwrappedEntry.argTuple
            : [];
        return {
          id: toInt(unwrappedEntry.id ?? unwrappedEntry.commandID, 0),
          args,
        };
      }

      return null;
    })
    .filter((entry) => entry && entry.id > 0);
}

function stableValue(value) {
  const unwrapped = unwrapMarshalValue(value);
  if (typeof unwrapped === "bigint") {
    return unwrapped.toString();
  }
  if (Array.isArray(unwrapped)) {
    return unwrapped.map(stableValue);
  }
  if (isPlainObject(unwrapped)) {
    return Object.keys(unwrapped)
      .sort()
      .reduce((result, key) => {
        result[key] = stableValue(unwrapped[key]);
        return result;
      }, {});
  }
  return unwrapped;
}

function buildNetworkEditHash({
  planetID,
  ownerID,
  serializedChanges = [],
} = {}) {
  const payload = {
    planetID: toInt(planetID, 0),
    ownerID: toInt(ownerID, 0),
    commands: stableValue(normalizeCommandStream(serializedChanges)),
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function isTemporaryID(value, kind) {
  const unwrapped = unwrapMarshalValue(value);
  return (
    Array.isArray(unwrapped) &&
    unwrapped.length >= 2 &&
    toInt(unwrapped[0], 0) === kind
  );
}

function submittedIDKey(value) {
  const unwrapped = unwrapMarshalValue(value);
  if (Array.isArray(unwrapped)) {
    return JSON.stringify(stableValue(unwrapped));
  }
  const id = toInt(unwrapped, 0);
  return id > 0 ? String(id) : "";
}

function getTypeBasePrice(typeID) {
  const type = planetStaticData.getType(typeID);
  const basePrice = Number(type && type.basePrice);
  return Number.isFinite(basePrice) && basePrice > 0 ? normalizeMoney(basePrice) : 0;
}

function buildPinTypeMap(colony = {}) {
  const pinTypesBySubmittedKey = new Map();
  for (const pin of Array.isArray(colony.pins) ? colony.pins : []) {
    const pinID = toInt(pin && (pin.pinID ?? pin.id), 0);
    const typeID = toInt(pin && pin.typeID, 0);
    if (pinID > 0 && typeID > 0) {
      pinTypesBySubmittedKey.set(String(pinID), typeID);
    }
  }
  return pinTypesBySubmittedKey;
}

function quoteNetworkConstructionCost(existingColony = null, serializedChanges = []) {
  const colony = isPlainObject(existingColony) ? existingColony : {};
  const commandStream = normalizeCommandStream(serializedChanges);
  const pinTypesBySubmittedKey = buildPinTypeMap(colony);
  let workingCommandCenterLevel = clamp(
    toInt(colony.level ?? colony.commandCenterLevel, 0),
    0,
    5,
  );
  let total = 0;
  const pinCosts = [];
  const upgradeCosts = [];

  for (const command of commandStream) {
    const args = Array.isArray(command.args) ? command.args : [];

    if (command.id === COMMAND.CREATEPIN) {
      const submittedPinID = args[0];
      const submittedKey = submittedIDKey(submittedPinID);
      const typeID = toInt(args[1], 0);
      const entityType = planetStaticData.getPinEntityType(typeID);
      const isNewPin = isTemporaryID(submittedPinID, 1) ||
        (submittedKey !== "" && !pinTypesBySubmittedKey.has(submittedKey));
      if (submittedKey !== "" && typeID > 0) {
        pinTypesBySubmittedKey.set(submittedKey, typeID);
      }

      if (isNewPin && entityType && entityType !== "command") {
        const amount = getTypeBasePrice(typeID);
        if (amount > 0) {
          total += amount;
          pinCosts.push({
            typeID,
            amount,
            submittedPinID: stableValue(submittedPinID),
          });
        }
      }
      continue;
    }

    if (command.id === COMMAND.REMOVEPIN) {
      const submittedKey = submittedIDKey(args[0]);
      if (submittedKey !== "") {
        pinTypesBySubmittedKey.delete(submittedKey);
      }
      continue;
    }

    if (command.id === COMMAND.UPGRADECOMMANDCENTER) {
      const desiredLevel = clamp(toInt(args[1], 0), 0, 5);
      const amount = Math.max(
        0,
        planetStaticData.getCommandCenterUpgradeCost(
          workingCommandCenterLevel,
          desiredLevel,
        ),
      );
      if (amount > 0) {
        total += amount;
        upgradeCosts.push({
          fromLevel: workingCommandCenterLevel,
          toLevel: desiredLevel,
          amount,
        });
      }
      workingCommandCenterLevel = desiredLevel;
    }
  }

  return {
    amount: normalizeMoney(total),
    pinCosts,
    upgradeCosts,
    commandCount: commandStream.length,
  };
}

function getCommodityTaxMultiplier(typeID, options = {}) {
  const multiplierAttribute = options.useExportMultiplier === true
    ? planetStaticData.ATTRIBUTE.EXPORT_TAX_MULTIPLIER
    : planetStaticData.ATTRIBUTE.IMPORT_TAX_MULTIPLIER;
  return planetStaticData.getTypeAttribute(typeID, multiplierAttribute, 0);
}

function calculateImportTax(pinTypeID, commodities, taxRate = DEFAULT_TAX_RATE) {
  const contents = normalizeContents(commodities);
  const importTaxRate = planetStaticData.getTypeAttribute(
    pinTypeID,
    planetStaticData.ATTRIBUTE.IMPORT_TAX,
    0,
  );
  const rate = Math.max(0, toNumber(taxRate, DEFAULT_TAX_RATE));
  let total = 0;

  for (const [typeID, quantity] of Object.entries(contents)) {
    total += quantity * importTaxRate * getCommodityTaxMultiplier(typeID);
  }

  return normalizeMoney(total * rate);
}

function calculateExportTax(pinTypeID, commodities, taxRate = DEFAULT_TAX_RATE, options = {}) {
  const contents = normalizeContents(commodities);
  const exportTaxRate = planetStaticData.getTypeAttribute(
    pinTypeID,
    planetStaticData.ATTRIBUTE.EXPORT_TAX,
    0,
  );
  const rate = Math.max(0, toNumber(taxRate, DEFAULT_TAX_RATE));
  let total = 0;

  for (const [typeID, quantity] of Object.entries(contents)) {
    total += quantity * exportTaxRate * getCommodityTaxMultiplier(typeID, options);
  }

  return normalizeMoney(total * rate);
}

module.exports = {
  DEFAULT_TAX_RATE,
  PI_JOURNAL_ENTRY_TYPE,
  calculateExportTax,
  calculateImportTax,
  buildNetworkEditHash,
  getTypeBasePrice,
  normalizeCommandStream,
  normalizeContents,
  quoteNetworkConstructionCost,
};
