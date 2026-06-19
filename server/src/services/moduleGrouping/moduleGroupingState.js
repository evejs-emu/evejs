const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  getItemMutationVersion,
  listContainerItems,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  isShipFittingFlag,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  compareModuleSortOrder,
  isGroupableModuleItem,
  canModulesGroupTogether,
} = require(path.join(__dirname, "./moduleGroupingRules"));

const TABLE_NAME = "moduleGroupingState";
const ROOT_VERSION = 1;
const DEFAULT_ROOT = Object.freeze({
  meta: {
    version: ROOT_VERSION,
    description:
      "DB-backed authoritative weapon-bank state keyed by ship itemID.",
    updatedAt: null,
  },
  ships: {},
});

let cachedRoot = null;
let stateMutationVersion = 1;
const sanitizedShipCache = new Map();
const characterViewCache = new Map();

function getCharacterStateService() {
  return require(path.join(__dirname, "../character/characterState"));
}

function resolveActiveShipRecord(characterID) {
  const characterState = getCharacterStateService();
  return characterState &&
    typeof characterState.getActiveShipRecord === "function"
    ? characterState.getActiveShipRecord(characterID)
    : null;
}

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeShipKey(shipID) {
  const numericShipID = toNumber(shipID, 0);
  return numericShipID > 0 ? String(numericShipID) : "";
}

function normalizeSlaveIDList(rawValue) {
  const rawIDs = Array.isArray(rawValue)
    ? rawValue
    : rawValue && typeof rawValue === "object"
      ? Object.values(rawValue)
      : [];
  return [...new Set(
    rawIDs
      .map((entry) => toNumber(entry, 0))
      .filter((entry) => entry > 0),
  )];
}

function normalizeBankMap(rawValue) {
  if (!rawValue || typeof rawValue !== "object") {
    return {};
  }

  const normalized = {};
  for (const [masterID, rawSlaveIDs] of Object.entries(rawValue)) {
    const numericMasterID = toNumber(masterID, 0);
    if (numericMasterID <= 0) {
      continue;
    }
    normalized[String(numericMasterID)] = normalizeSlaveIDList(rawSlaveIDs);
  }
  return normalized;
}

function normalizeRoot(rawValue) {
  return {
    meta: {
      ...cloneValue(DEFAULT_ROOT.meta),
      ...(rawValue && rawValue.meta && typeof rawValue.meta === "object"
        ? cloneValue(rawValue.meta)
        : {}),
      version: ROOT_VERSION,
    },
    ships:
      rawValue && rawValue.ships && typeof rawValue.ships === "object"
        ? cloneValue(rawValue.ships)
        : {},
  };
}

function readRoot() {
  const result = database.read(TABLE_NAME, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return cloneValue(DEFAULT_ROOT);
  }
  return normalizeRoot(result.data);
}

function clearViewCaches() {
  sanitizedShipCache.clear();
  characterViewCache.clear();
}

function writeRoot(root) {
  const nextRoot = normalizeRoot(root);
  nextRoot.meta.updatedAt = new Date().toISOString();
  const result = database.write(TABLE_NAME, "/", nextRoot);
  if (!result.success) {
    return false;
  }
  cachedRoot = nextRoot;
  stateMutationVersion += 1;
  clearViewCaches();
  return true;
}

function ensureRoot() {
  if (!cachedRoot) {
    cachedRoot = readRoot();
  }
  return cachedRoot;
}

function ensureShipEntry(root, shipID) {
  const shipKey = normalizeShipKey(shipID);
  if (!shipKey) {
    return null;
  }

  if (!root.ships[shipKey] || typeof root.ships[shipKey] !== "object") {
    root.ships[shipKey] = {
      banksByMasterID: {},
      changedByCharacterID: null,
      updatedAtMs: Date.now(),
    };
  }

  if (
    !root.ships[shipKey].banksByMasterID ||
    typeof root.ships[shipKey].banksByMasterID !== "object"
  ) {
    root.ships[shipKey].banksByMasterID = {};
  }

  return root.ships[shipKey];
}

function buildShipModuleIndex(shipID) {
  const modules = listContainerItems(null, toNumber(shipID, 0), null)
    .filter((item) => toNumber(item && item.categoryID, 0) === 7)
    .filter((item) => isShipFittingFlag(item && item.flagID))
    .sort((left, right) => compareModuleSortOrder(left, right));
  const byItemID = new Map();
  for (const moduleItem of modules) {
    byItemID.set(toNumber(moduleItem && moduleItem.itemID, 0), moduleItem);
  }
  return {
    modules,
    byItemID,
  };
}

function sortModuleIDsByShip(moduleIndex, moduleIDs = []) {
  return [...new Set(
    (Array.isArray(moduleIDs) ? moduleIDs : [])
      .map((moduleID) => toNumber(moduleID, 0))
      .filter((moduleID) => moduleID > 0),
  )].sort((leftID, rightID) => compareModuleSortOrder(
    moduleIndex.get(leftID),
    moduleIndex.get(rightID),
    leftID,
    rightID,
  ));
}

function areBanksEqual(leftBanks = {}, rightBanks = {}) {
  return JSON.stringify(leftBanks) === JSON.stringify(rightBanks);
}

function sanitizeShipWeaponBanks(shipID, rawBanks = {}) {
  const numericShipID = toNumber(shipID, 0);
  if (numericShipID <= 0) {
    return {};
  }

  const normalizedBanks = normalizeBankMap(rawBanks);
  const { byItemID } = buildShipModuleIndex(numericShipID);
  const sanitized = {};
  const consumedModuleIDs = new Set();

  const sortedMasterIDs = sortModuleIDsByShip(
    byItemID,
    Object.keys(normalizedBanks).map((masterID) => toNumber(masterID, 0)),
  );

  for (const masterID of sortedMasterIDs) {
    if (consumedModuleIDs.has(masterID)) {
      continue;
    }

    const masterItem = byItemID.get(masterID);
    if (!isGroupableModuleItem(masterItem)) {
      continue;
    }

    const nextSlaveIDs = [];
    const candidateSlaveIDs = sortModuleIDsByShip(
      byItemID,
      normalizedBanks[String(masterID)],
    );
    for (const slaveID of candidateSlaveIDs) {
      if (slaveID === masterID || consumedModuleIDs.has(slaveID)) {
        continue;
      }

      const slaveItem = byItemID.get(slaveID);
      const validation = canModulesGroupTogether(
        numericShipID,
        masterItem,
        slaveItem,
        {},
      );
      if (!validation.success) {
        continue;
      }

      consumedModuleIDs.add(slaveID);
      nextSlaveIDs.push(slaveID);
    }

    if (nextSlaveIDs.length <= 0) {
      continue;
    }

    consumedModuleIDs.add(masterID);
    sanitized[String(masterID)] = nextSlaveIDs;
  }

  return sanitized;
}

function setCharacterViewCache(characterID, shipID, banks) {
  const numericCharacterID = toNumber(characterID, 0);
  const numericShipID = toNumber(shipID, 0);
  if (numericCharacterID <= 0 || numericShipID <= 0) {
    return;
  }

  characterViewCache.set(numericCharacterID, {
    shipID: numericShipID,
    itemMutationVersion: getItemMutationVersion(),
    stateMutationVersion,
    banks: cloneValue(banks),
  });
}

function getShipWeaponBanks(shipID, options = {}) {
  const numericShipID = toNumber(shipID, 0);
  if (numericShipID <= 0) {
    return {};
  }

  const currentItemMutationVersion = getItemMutationVersion();
  const cached = sanitizedShipCache.get(numericShipID);
  if (
    cached &&
    cached.itemMutationVersion === currentItemMutationVersion &&
    cached.stateMutationVersion === stateMutationVersion
  ) {
    if (toNumber(options.characterID, 0) > 0) {
      setCharacterViewCache(options.characterID, numericShipID, cached.banks);
    }
    return cloneValue(cached.banks);
  }

  const root = ensureRoot();
  const shipEntry = ensureShipEntry(root, numericShipID);
  const storedBanks = normalizeBankMap(shipEntry && shipEntry.banksByMasterID);
  const sanitizedBanks = sanitizeShipWeaponBanks(numericShipID, storedBanks);

  if (!areBanksEqual(storedBanks, sanitizedBanks)) {
    if (Object.keys(sanitizedBanks).length > 0) {
      shipEntry.banksByMasterID = sanitizedBanks;
      shipEntry.updatedAtMs = Date.now();
      if (toNumber(options.characterID, 0) > 0) {
        shipEntry.changedByCharacterID = toNumber(options.characterID, 0);
      }
    } else {
      delete root.ships[normalizeShipKey(numericShipID)];
    }
    writeRoot(root);
  }

  sanitizedShipCache.set(numericShipID, {
    itemMutationVersion: getItemMutationVersion(),
    stateMutationVersion,
    banks: cloneValue(sanitizedBanks),
  });
  if (toNumber(options.characterID, 0) > 0) {
    setCharacterViewCache(options.characterID, numericShipID, sanitizedBanks);
  }
  return cloneValue(sanitizedBanks);
}

function getCharacterWeaponBanks(characterID, shipID = null) {
  const numericCharacterID = toNumber(characterID, 0);
  if (numericCharacterID <= 0) {
    return {};
  }

  const activeShip = resolveActiveShipRecord(numericCharacterID) || null;
  const resolvedShipID =
    toNumber(shipID, 0) ||
    toNumber(activeShip && activeShip.itemID, 0);
  if (resolvedShipID <= 0) {
    return {};
  }

  const cached = characterViewCache.get(numericCharacterID);
  if (
    cached &&
    cached.shipID === resolvedShipID &&
    cached.itemMutationVersion === getItemMutationVersion() &&
    cached.stateMutationVersion === stateMutationVersion
  ) {
    return cloneValue(cached.banks);
  }

  return getShipWeaponBanks(resolvedShipID, {
    characterID: numericCharacterID,
  });
}

function setShipWeaponBanks(shipID, nextBanks, options = {}) {
  const numericShipID = toNumber(shipID, 0);
  if (numericShipID <= 0) {
    return {
      success: false,
      errorMsg: "INVALID_SHIP",
    };
  }

  const currentBanks = getShipWeaponBanks(numericShipID, options);
  const sanitizedBanks = sanitizeShipWeaponBanks(numericShipID, nextBanks);
  if (areBanksEqual(currentBanks, sanitizedBanks)) {
    return {
      success: true,
      data: {
        shipID: numericShipID,
        banks: currentBanks,
        changed: false,
      },
    };
  }

  const root = ensureRoot();
  if (Object.keys(sanitizedBanks).length > 0) {
    const shipEntry = ensureShipEntry(root, numericShipID);
    shipEntry.banksByMasterID = sanitizedBanks;
    shipEntry.updatedAtMs = Date.now();
    shipEntry.changedByCharacterID =
      toNumber(options.characterID, 0) > 0
        ? toNumber(options.characterID, 0)
        : shipEntry.changedByCharacterID || null;
  } else {
    delete root.ships[normalizeShipKey(numericShipID)];
  }

  if (!writeRoot(root)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  if (toNumber(options.characterID, 0) > 0) {
    setCharacterViewCache(options.characterID, numericShipID, sanitizedBanks);
  }

  return {
    success: true,
    data: {
      shipID: numericShipID,
      banks: cloneValue(sanitizedBanks),
      changed: true,
    },
  };
}

function mutateShipWeaponBanks(shipID, mutator, options = {}) {
  const currentBanks = getShipWeaponBanks(shipID, options);
  const nextBanks = normalizeBankMap(
    typeof mutator === "function" ? mutator(cloneValue(currentBanks)) : mutator,
  );
  return setShipWeaponBanks(shipID, nextBanks, options);
}

function clearModuleFromBanks(shipID, moduleIDs, options = {}) {
  const targets = new Set(
    (Array.isArray(moduleIDs) ? moduleIDs : [moduleIDs])
      .map((moduleID) => toNumber(moduleID, 0))
      .filter((moduleID) => moduleID > 0),
  );

  return mutateShipWeaponBanks(
    shipID,
    (currentBanks) => {
      const nextBanks = {};
      for (const [masterID, slaveIDs] of Object.entries(currentBanks || {})) {
        const numericMasterID = toNumber(masterID, 0);
        if (targets.has(numericMasterID)) {
          continue;
        }
        const nextSlaveIDs = (Array.isArray(slaveIDs) ? slaveIDs : [])
          .map((slaveID) => toNumber(slaveID, 0))
          .filter((slaveID) => slaveID > 0 && !targets.has(slaveID));
        if (nextSlaveIDs.length > 0) {
          nextBanks[String(numericMasterID)] = nextSlaveIDs;
        }
      }
      return nextBanks;
    },
    options,
  );
}

function resetModuleGroupingStateForTests() {
  cachedRoot = null;
  clearViewCaches();
}

module.exports = {
  getShipWeaponBanks,
  getCharacterWeaponBanks,
  setShipWeaponBanks,
  mutateShipWeaponBanks,
  clearModuleFromBanks,
  sanitizeShipWeaponBanks,
  resetModuleGroupingStateForTests,
};
