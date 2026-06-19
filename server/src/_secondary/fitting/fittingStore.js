const path = require("path");

const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const database = require(path.join(__dirname, "../../newDatabase"));
const {
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  unwrapMarshalValue,
  currentFileTime,
} = require(path.join(__dirname, "../../services/_shared/serviceHelpers"));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../../services/character/characterState"));
const {
  getCorporationRecord,
  getAllianceRecord,
} = require(path.join(__dirname, "../../services/corporation/corporationState"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../services/inventory/itemTypeRegistry"));
const {
  isShipFittingFlag,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  ITEM_FLAGS,
} = require(path.join(__dirname, "../../services/inventory/itemStore"));

const SAVED_FITTINGS_TABLE = "savedFittings";
const CATEGORY_SHIP = 6;
const CATEGORY_STRUCTURE = 65;
const COMMUNITY_FITTING_CORP = 1000282;
const MAX_CHAR_FITTINGS = 500;
const MAX_CORP_FITTINGS = 600;
const MAX_ALLIANCE_FITTINGS = 600;
const MAX_FITTING_NAME_LENGTH = 50;
const MAX_FITTING_DESCRIPTION_LENGTH = 500;
const ALLOWED_NON_SLOT_FIT_FLAGS = new Set([
  ITEM_FLAGS.CARGO_HOLD,
  ITEM_FLAGS.DRONE_BAY,
  ITEM_FLAGS.FIGHTER_BAY,
]);
const OWNER_SCOPE = Object.freeze({
  CHARACTER: "character",
  CORPORATION: "corporation",
  ALLIANCE: "alliance",
  COMMUNITY: "community",
});

let storeInitialized = false;
let storeRoot = null;
let ownerRevisionByID = new Map();
let ownerPayloadCache = new Map();

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value, fallback = "") {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value);
}

function normalizeStoredFitData(value) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((entry) => {
      const tuple = Array.isArray(entry) ? entry : [];
      const typeID = toInt(tuple[0], 0);
      const flagID = toInt(tuple[1], 0);
      const quantity = toInt(tuple[2], 0);
      if (typeID <= 0 || flagID <= 0 || quantity === 0) {
        return null;
      }
      return [typeID, flagID, quantity];
    })
    .filter(Boolean);
}

function normalizeIncomingFitData(value) {
  const items = Array.isArray(unwrapMarshalValue(value))
    ? unwrapMarshalValue(value)
    : [];
  return items.map((entry) => {
    const tuple = Array.isArray(entry) ? entry : unwrapMarshalValue(entry);
    const values = Array.isArray(tuple) ? tuple : [];
    return [
      toInt(values[0], 0),
      toInt(values[1], 0),
      toInt(values[2], 0),
    ];
  });
}

function buildFitDataPayload(fitData = []) {
  return buildList(
    (Array.isArray(fitData) ? fitData : []).map(([typeID, flagID, quantity]) => ({
      type: "tuple",
      items: [toInt(typeID, 0), toInt(flagID, 0), toInt(quantity, 0)],
    })),
  );
}

function buildFittingPayload(record) {
  return buildKeyVal([
    ["description", normalizeText(record && record.description, "")],
    ["fitData", buildFitDataPayload(record && record.fitData)],
    ["fittingID", toInt(record && record.fittingID, 0)],
    ["name", normalizeText(record && record.name, "")],
    ["ownerID", toInt(record && record.ownerID, 0)],
    ["savedDate", buildFiletimeLong(record && record.savedDate)],
    ["shipTypeID", toInt(record && record.shipTypeID, 0)],
  ]);
}

function defaultStoreRoot() {
  return {
    _meta: {
      version: 1,
      nextFittingID: 1,
    },
    owners: {},
  };
}

function readStoreRoot() {
  const result = database.read(SAVED_FITTINGS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return defaultStoreRoot();
  }
  return result.data;
}

function writeStoreRoot(root) {
  storeRoot = root;
  database.write(SAVED_FITTINGS_TABLE, "/", root, { force: true });
}

function normalizeOwnerScope(value, fallback = OWNER_SCOPE.CHARACTER) {
  switch (String(value || "").trim().toLowerCase()) {
    case OWNER_SCOPE.CORPORATION:
      return OWNER_SCOPE.CORPORATION;
    case OWNER_SCOPE.ALLIANCE:
      return OWNER_SCOPE.ALLIANCE;
    case OWNER_SCOPE.COMMUNITY:
      return OWNER_SCOPE.COMMUNITY;
    case OWNER_SCOPE.CHARACTER:
    default:
      return fallback;
  }
}

function inferOwnerScope(ownerID) {
  const numericOwnerID = toInt(ownerID, 0);
  if (numericOwnerID === COMMUNITY_FITTING_CORP) {
    return OWNER_SCOPE.COMMUNITY;
  }
  if (getCharacterRecord(numericOwnerID)) {
    return OWNER_SCOPE.CHARACTER;
  }
  if (getCorporationRecord(numericOwnerID)) {
    return OWNER_SCOPE.CORPORATION;
  }
  if (getAllianceRecord(numericOwnerID)) {
    return OWNER_SCOPE.ALLIANCE;
  }
  return OWNER_SCOPE.CHARACTER;
}

function getFittingLimitForOwnerScope(ownerScope) {
  switch (normalizeOwnerScope(ownerScope)) {
    case OWNER_SCOPE.CORPORATION:
    case OWNER_SCOPE.COMMUNITY:
      return MAX_CORP_FITTINGS;
    case OWNER_SCOPE.ALLIANCE:
      return MAX_ALLIANCE_FITTINGS;
    case OWNER_SCOPE.CHARACTER:
    default:
      return MAX_CHAR_FITTINGS;
  }
}

function getSessionOwnerID(session, ownerScope) {
  switch (normalizeOwnerScope(ownerScope)) {
    case OWNER_SCOPE.CORPORATION:
      return toInt(session && (session.corpid || session.corporationID), 0);
    case OWNER_SCOPE.ALLIANCE:
      return toInt(session && (session.allianceid || session.allianceID), 0);
    case OWNER_SCOPE.CHARACTER:
    default:
      return toInt(session && (session.characterID || session.charid), 0);
  }
}

function assertSessionCanAccessOwner(session, ownerID, ownerScope) {
  const normalizedScope = normalizeOwnerScope(ownerScope);
  const numericOwnerID = toInt(ownerID, 0);
  if (normalizedScope === OWNER_SCOPE.COMMUNITY) {
    return true;
  }

  const sessionOwnerID = getSessionOwnerID(session, normalizedScope);
  if (numericOwnerID > 0 && sessionOwnerID > 0 && numericOwnerID === sessionOwnerID) {
    return true;
  }

  throwFittingError("OWNER_SCOPE_DENIED");
}

function bumpOwnerRevision(ownerID) {
  const numericOwnerID = toInt(ownerID, 0);
  const nextRevision = (ownerRevisionByID.get(numericOwnerID) || 0) + 1;
  ownerRevisionByID.set(numericOwnerID, nextRevision);
  ownerPayloadCache.delete(numericOwnerID);
  return nextRevision;
}

function isCommunityOwnerScope(ownerScope, ownerID) {
  return (
    normalizeOwnerScope(ownerScope) === OWNER_SCOPE.COMMUNITY ||
    toInt(ownerID, 0) === COMMUNITY_FITTING_CORP
  );
}

function ensureOwnerRecord(ownerID, ownerScope = null) {
  ensureStoreInitialized();
  const numericOwnerID = toInt(ownerID, 0);
  if (numericOwnerID <= 0) {
    return null;
  }

  const owners =
    storeRoot && storeRoot.owners && typeof storeRoot.owners === "object"
      ? storeRoot.owners
      : {};
  const ownerKey = String(numericOwnerID);
  let ownerRecord =
    owners[ownerKey] && typeof owners[ownerKey] === "object"
      ? owners[ownerKey]
      : null;

  if (!ownerRecord) {
    ownerRecord = {
      ownerID: numericOwnerID,
      scope: normalizeOwnerScope(ownerScope || inferOwnerScope(numericOwnerID)),
      fittings: {},
    };
    owners[ownerKey] = ownerRecord;
    storeRoot.owners = owners;
    database.write(SAVED_FITTINGS_TABLE, `/owners/${ownerKey}`, ownerRecord);
    bumpOwnerRevision(numericOwnerID);
  } else {
    if (!ownerRecord.fittings || typeof ownerRecord.fittings !== "object") {
      ownerRecord.fittings = {};
      database.write(
        SAVED_FITTINGS_TABLE,
        `/owners/${ownerKey}/fittings`,
        ownerRecord.fittings,
      );
      bumpOwnerRevision(numericOwnerID);
    }
    const normalizedScope = normalizeOwnerScope(
      ownerRecord.scope,
      ownerScope || inferOwnerScope(numericOwnerID),
    );
    if (ownerRecord.scope !== normalizedScope) {
      ownerRecord.scope = normalizedScope;
      database.write(
        SAVED_FITTINGS_TABLE,
        `/owners/${ownerKey}/scope`,
        ownerRecord.scope,
      );
      bumpOwnerRevision(numericOwnerID);
    }
  }

  return ownerRecord;
}

function normalizeStoredFittingRecord(rawRecord, options = {}) {
  const source =
    rawRecord && typeof rawRecord === "object" ? rawRecord : {};
  const fittingID = toInt(options.fittingID ?? source.fittingID, 0);
  const ownerID = toInt(options.ownerID ?? source.ownerID, 0);
  const shipTypeID = toInt(source.shipTypeID, 0);
  const name = normalizeText(source.name, "").trim().slice(0, MAX_FITTING_NAME_LENGTH);
  const description = normalizeText(source.description, "")
    .slice(0, MAX_FITTING_DESCRIPTION_LENGTH);
  const fitData = normalizeStoredFitData(source.fitData);
  if (fittingID <= 0 || ownerID <= 0 || shipTypeID <= 0 || !name || fitData.length <= 0) {
    return null;
  }

  return {
    fittingID,
    ownerID,
    shipTypeID,
    name,
    description,
    fitData,
    savedDate: normalizeText(source.savedDate, currentFileTime().toString()),
  };
}

function collectUsedFittingIDs() {
  ensureStoreInitialized();
  const usedIDs = new Set();
  const owners =
    storeRoot && storeRoot.owners && typeof storeRoot.owners === "object"
      ? storeRoot.owners
      : {};
  for (const ownerRecord of Object.values(owners)) {
    const fittings =
      ownerRecord && ownerRecord.fittings && typeof ownerRecord.fittings === "object"
        ? ownerRecord.fittings
        : {};
    for (const fittingID of Object.keys(fittings)) {
      const numericFittingID = toInt(fittingID, 0);
      if (numericFittingID > 0) {
        usedIDs.add(numericFittingID);
      }
    }
  }
  return usedIDs;
}

function allocateNextFittingID() {
  ensureStoreInitialized();
  const nextFittingID = Math.max(
    1,
    toInt(storeRoot && storeRoot._meta && storeRoot._meta.nextFittingID, 1),
  );
  storeRoot._meta.nextFittingID = nextFittingID + 1;
  database.write(
    SAVED_FITTINGS_TABLE,
    "/_meta/nextFittingID",
    storeRoot._meta.nextFittingID,
  );
  return nextFittingID;
}

function allocateNextFittingIDs(count = 1) {
  const amount = Math.max(0, toInt(count, 0));
  if (amount <= 0) {
    return [];
  }

  ensureStoreInitialized();
  const firstFittingID = Math.max(
    1,
    toInt(storeRoot && storeRoot._meta && storeRoot._meta.nextFittingID, 1),
  );
  const allocated = Array.from({ length: amount }, (_, index) => firstFittingID + index);
  storeRoot._meta.nextFittingID = firstFittingID + amount;
  database.write(
    SAVED_FITTINGS_TABLE,
    "/_meta/nextFittingID",
    storeRoot._meta.nextFittingID,
  );
  return allocated;
}

function migrateLegacyCharacterFittings() {
  const charactersResult = database.read("characters", "/");
  const characters =
    charactersResult.success && charactersResult.data && typeof charactersResult.data === "object"
      ? charactersResult.data
      : {};
  const usedIDs = collectUsedFittingIDs();
  let mutated = false;
  let highestFittingID = toInt(
    storeRoot && storeRoot._meta && storeRoot._meta.nextFittingID,
    1,
  ) - 1;

  for (const [characterID, record] of Object.entries(characters)) {
    const numericCharacterID = toInt(characterID, 0);
    if (numericCharacterID <= 0) {
      continue;
    }

    const legacyFittings =
      record && record.savedFittings && typeof record.savedFittings === "object"
        ? record.savedFittings
        : {};
    const legacyEntries = Object.entries(legacyFittings);
    if (legacyEntries.length <= 0) {
      continue;
    }

    const ownerRecord = ensureOwnerRecord(numericCharacterID, OWNER_SCOPE.CHARACTER);
    for (const [legacyFittingID, legacyRecord] of legacyEntries) {
      let fittingID = toInt(legacyFittingID, 0);
      if (fittingID <= 0 || usedIDs.has(fittingID)) {
        fittingID = Math.max(highestFittingID + 1, 1);
      }

      const normalizedRecord = normalizeStoredFittingRecord(legacyRecord, {
        fittingID,
        ownerID: numericCharacterID,
      });
      if (!normalizedRecord) {
        continue;
      }

      if (
        ownerRecord.fittings[String(normalizedRecord.fittingID)] &&
        normalizeStoredFittingRecord(
          ownerRecord.fittings[String(normalizedRecord.fittingID)],
          {
            fittingID: normalizedRecord.fittingID,
            ownerID: numericCharacterID,
          },
        )
      ) {
        continue;
      }

      ownerRecord.fittings[String(normalizedRecord.fittingID)] = normalizedRecord;
      usedIDs.add(normalizedRecord.fittingID);
      highestFittingID = Math.max(highestFittingID, normalizedRecord.fittingID);
      mutated = true;
    }
  }

  if (!mutated) {
    return false;
  }

  storeRoot._meta.nextFittingID = Math.max(
    toInt(storeRoot._meta.nextFittingID, 1),
    highestFittingID + 1,
  );
  database.write(SAVED_FITTINGS_TABLE, "/", storeRoot, { force: true });
  for (const ownerID of Object.keys(storeRoot.owners || {})) {
    bumpOwnerRevision(ownerID);
  }
  return true;
}

function ensureStoreInitialized() {
  if (storeInitialized) {
    return storeRoot;
  }

  storeRoot = readStoreRoot();
  if (!storeRoot || typeof storeRoot !== "object") {
    storeRoot = defaultStoreRoot();
  }
  if (!storeRoot._meta || typeof storeRoot._meta !== "object") {
    storeRoot._meta = defaultStoreRoot()._meta;
  }
  if (!storeRoot.owners || typeof storeRoot.owners !== "object") {
    storeRoot.owners = {};
  }
  if (toInt(storeRoot._meta.version, 0) <= 0) {
    storeRoot._meta.version = 1;
  }
  if (toInt(storeRoot._meta.nextFittingID, 0) <= 0) {
    storeRoot._meta.nextFittingID = 1;
  }

  storeInitialized = true;
  database.write(SAVED_FITTINGS_TABLE, "/", storeRoot, { force: true });
  migrateLegacyCharacterFittings();
  return storeRoot;
}

function getOwnerFittings(ownerID, options = {}) {
  const ownerRecord = options.createIfMissing
    ? ensureOwnerRecord(ownerID, options.ownerScope)
    : ensureStoreInitialized() &&
      storeRoot &&
      storeRoot.owners &&
      storeRoot.owners[String(toInt(ownerID, 0))];
  const fittings =
    ownerRecord && ownerRecord.fittings && typeof ownerRecord.fittings === "object"
      ? ownerRecord.fittings
      : {};
  return Object.fromEntries(
    Object.entries(fittings)
      .map(([fittingID, fitting]) => {
        const normalizedRecord = normalizeStoredFittingRecord(fitting, {
          fittingID,
          ownerID,
        });
        return normalizedRecord
          ? [normalizedRecord.fittingID, cloneValue(normalizedRecord)]
          : null;
      })
      .filter(Boolean),
  );
}

function getOwnerFittingsResponse(ownerID, ownerScope = null) {
  const numericOwnerID = toInt(ownerID, 0);
  const ownerRecord = ensureOwnerRecord(numericOwnerID, ownerScope);
  const revision = ownerRevisionByID.get(numericOwnerID) || 0;
  const cachedPayload = ownerPayloadCache.get(numericOwnerID);
  if (cachedPayload && cachedPayload.revision === revision) {
    return cachedPayload.payload;
  }

  const fittings =
    ownerRecord && ownerRecord.fittings && typeof ownerRecord.fittings === "object"
      ? ownerRecord.fittings
      : {};
  const payload = buildDict(
    Object.values(fittings)
      .map((record) =>
        normalizeStoredFittingRecord(record, {
          fittingID: record && record.fittingID,
          ownerID: numericOwnerID,
        }),
      )
      .filter(Boolean)
      .sort((left, right) => left.fittingID - right.fittingID)
      .map((record) => [record.fittingID, buildFittingPayload(record)]),
  );
  ownerPayloadCache.set(numericOwnerID, {
    revision,
    payload,
  });
  return payload;
}

function getCommunityFittingsResponse() {
  return getOwnerFittingsResponse(COMMUNITY_FITTING_CORP, OWNER_SCOPE.COMMUNITY);
}

function validateFittingRecord(record) {
  const fitting = record && typeof record === "object" ? record : null;
  if (!fitting) {
    return { success: false, errorMsg: "FITTING_MISSING" };
  }
  if (!fitting.name || typeof fitting.name !== "string" || fitting.name.trim() === "") {
    return { success: false, errorMsg: "FITTING_NAME_REQUIRED" };
  }
  if (fitting.name.includes("@@") || String(fitting.description || "").includes("@@")) {
    return { success: false, errorMsg: "FITTING_INVALID_TEXT" };
  }
  if (toInt(fitting.shipTypeID, 0) <= 0) {
    return { success: false, errorMsg: "FITTING_INVALID_TYPE_ID", values: {
      typeName: fitting && fitting.shipTypeID,
    } };
  }

  const shipType = resolveItemByTypeID(fitting.shipTypeID) || {};
  if (toInt(shipType.typeID, 0) <= 0) {
    return { success: false, errorMsg: "FITTING_INVALID_TYPE_ID", values: {
      typeName: fitting.shipTypeID,
    } };
  }
  if (![CATEGORY_SHIP, CATEGORY_STRUCTURE].includes(toInt(shipType.categoryID, 0))) {
    return {
      success: false,
      errorMsg: "FITTING_INVALID_SHIP_TYPE",
      values: {
        typeName: shipType.name || fitting.shipTypeID,
      },
    };
  }

  if (!Array.isArray(fitting.fitData) || fitting.fitData.length <= 0) {
    return { success: false, errorMsg: "FITTING_DATA_EMPTY" };
  }

  for (const [typeID, flagID, quantity] of fitting.fitData) {
    const numericTypeID = toInt(typeID, 0);
    if (!resolveItemByTypeID(numericTypeID)) {
      return {
        success: false,
        errorMsg: "FITTING_INVALID_TYPE_ID",
        values: {
          typeID: numericTypeID,
        },
      };
    }
    if (toInt(flagID, 0) <= 0) {
      return {
        success: false,
        errorMsg: "FITTING_INVALID_FLAG",
        values: {
          type: numericTypeID,
        },
      };
    }
    if (toInt(quantity, 0) === 0) {
      return {
        success: false,
        errorMsg: "FITTING_INVALID_QUANTITY",
        values: {
          type: numericTypeID,
        },
      };
    }
    if (!isShipFittingFlag(flagID) && !ALLOWED_NON_SLOT_FIT_FLAGS.has(toInt(flagID, 0))) {
      return {
        success: false,
        errorMsg: "FITTING_INVALID_FLAG",
        values: {
          type: numericTypeID,
        },
      };
    }
  }

  return { success: true };
}

function normalizeIncomingFitting(rawFitting, ownerID) {
  const source = unwrapMarshalValue(rawFitting) || {};
  const normalized = {
    ownerID: toInt(ownerID, 0),
    shipTypeID: toInt(source.shipTypeID, 0),
    name: normalizeText(source.name, "").trim().slice(0, MAX_FITTING_NAME_LENGTH),
    description: normalizeText(source.description, "")
      .slice(0, MAX_FITTING_DESCRIPTION_LENGTH),
    fitData: normalizeIncomingFitData(source.fitData),
  };
  return normalized;
}

function saveFitting(ownerID, rawFitting, ownerScope = null) {
  const numericOwnerID = toInt(ownerID, 0);
  if (numericOwnerID <= 0) {
    return { success: false, errorMsg: "OWNER_NOT_FOUND" };
  }
  if (isCommunityOwnerScope(ownerScope, numericOwnerID)) {
    return { success: false, errorMsg: "COMMUNITY_FITTINGS_READ_ONLY" };
  }

  const normalizedFitting = normalizeIncomingFitting(rawFitting, numericOwnerID);
  const validation = validateFittingRecord(normalizedFitting);
  if (!validation.success) {
    return validation;
  }

  const ownerRecord = ensureOwnerRecord(numericOwnerID, ownerScope);
  const existingFittingCount = Object.keys(ownerRecord.fittings || {}).length;
  if (existingFittingCount >= getFittingLimitForOwnerScope(ownerRecord.scope)) {
    return { success: false, errorMsg: "OWNER_MAX_FITTINGS" };
  }

  const fittingID = allocateNextFittingID();
  const storedRecord = {
    ...normalizedFitting,
    fittingID,
    ownerID: numericOwnerID,
    savedDate: currentFileTime().toString(),
  };
  ownerRecord.fittings[String(fittingID)] = storedRecord;
  database.write(
    SAVED_FITTINGS_TABLE,
    `/owners/${numericOwnerID}/fittings/${fittingID}`,
    storedRecord,
  );
  bumpOwnerRevision(numericOwnerID);
  return {
    success: true,
    data: {
      fittingID,
      fitting: cloneValue(storedRecord),
    },
  };
}

function updateFitting(ownerID, fittingID, rawFitting, ownerScope = null) {
  const numericOwnerID = toInt(ownerID, 0);
  const numericFittingID = toInt(fittingID, 0);
  if (numericOwnerID <= 0 || numericFittingID <= 0) {
    return { success: false, errorMsg: "FITTING_NOT_FOUND" };
  }
  if (isCommunityOwnerScope(ownerScope, numericOwnerID)) {
    return { success: false, errorMsg: "COMMUNITY_FITTINGS_READ_ONLY" };
  }

  const ownerRecord = ensureOwnerRecord(numericOwnerID, ownerScope);
  const existingRecord =
    ownerRecord && ownerRecord.fittings
      ? ownerRecord.fittings[String(numericFittingID)]
      : null;
  if (!existingRecord) {
    return { success: false, errorMsg: "FITTING_NOT_FOUND" };
  }

  const normalizedFitting = normalizeIncomingFitting(rawFitting, numericOwnerID);
  const validation = validateFittingRecord(normalizedFitting);
  if (!validation.success) {
    return validation;
  }

  const storedRecord = {
    ...existingRecord,
    ...normalizedFitting,
    fittingID: numericFittingID,
    ownerID: numericOwnerID,
    savedDate: currentFileTime().toString(),
  };
  ownerRecord.fittings[String(numericFittingID)] = storedRecord;
  database.write(
    SAVED_FITTINGS_TABLE,
    `/owners/${numericOwnerID}/fittings/${numericFittingID}`,
    storedRecord,
  );
  bumpOwnerRevision(numericOwnerID);
  return {
    success: true,
    data: {
      fittingID: numericFittingID,
      fitting: cloneValue(storedRecord),
    },
  };
}

function saveManyFittings(ownerID, rawFittings, ownerScope = null) {
  const numericOwnerID = toInt(ownerID, 0);
  if (numericOwnerID <= 0) {
    return { success: false, errorMsg: "OWNER_NOT_FOUND" };
  }
  if (isCommunityOwnerScope(ownerScope, numericOwnerID)) {
    return { success: false, errorMsg: "COMMUNITY_FITTINGS_READ_ONLY" };
  }

  const normalizedPayload = unwrapMarshalValue(rawFittings) || {};
  const ownerRecord = ensureOwnerRecord(numericOwnerID, ownerScope);
  const fittingEntries = Object.entries(
    normalizedPayload && typeof normalizedPayload === "object" ? normalizedPayload : {},
  );
  const limit = getFittingLimitForOwnerScope(ownerRecord.scope);
  if (Object.keys(ownerRecord.fittings).length + fittingEntries.length > limit) {
    return {
      success: false,
      errorMsg: "OWNER_MAX_FITTINGS",
      values: {
        maxFittings: limit,
      },
    };
  }

  const stagedRecords = [];
  for (const [tempFittingID, rawFitting] of fittingEntries) {
    const normalizedFitting = normalizeIncomingFitting(rawFitting, numericOwnerID);
    const validation = validateFittingRecord(normalizedFitting);
    if (!validation.success) {
      return validation;
    }
    stagedRecords.push({
      tempFittingID: toInt(tempFittingID, 0),
      fitting: normalizedFitting,
    });
  }

  const allocatedIDs = allocateNextFittingIDs(stagedRecords.length);
  const mappings = stagedRecords.map((entry, index) => {
    const fittingID = allocatedIDs[index];
    const storedRecord = {
      ...entry.fitting,
      fittingID,
      ownerID: numericOwnerID,
      savedDate: currentFileTime().toString(),
    };
    ownerRecord.fittings[String(fittingID)] = storedRecord;
    return {
      tempFittingID: entry.tempFittingID,
      realFittingID: fittingID,
    };
  });
  database.write(
    SAVED_FITTINGS_TABLE,
    `/owners/${numericOwnerID}/fittings`,
    ownerRecord.fittings,
    { force: true },
  );
  bumpOwnerRevision(numericOwnerID);

  return {
    success: true,
    data: mappings,
  };
}

function updateFittingNameAndDescription(fittingID, ownerID, name, description, ownerScope = null) {
  const numericOwnerID = toInt(ownerID, 0);
  const numericFittingID = toInt(fittingID, 0);
  if (isCommunityOwnerScope(ownerScope, numericOwnerID)) {
    return { success: false, errorMsg: "COMMUNITY_FITTINGS_READ_ONLY" };
  }
  const ownerRecord = ensureOwnerRecord(numericOwnerID, ownerScope);
  const existingRecord =
    ownerRecord && ownerRecord.fittings
      ? ownerRecord.fittings[String(numericFittingID)]
      : null;
  if (!existingRecord) {
    return { success: false, errorMsg: "FITTING_NOT_FOUND" };
  }

  const normalizedName = normalizeText(name, "").trim().slice(0, MAX_FITTING_NAME_LENGTH);
  const normalizedDescription = normalizeText(description, "")
    .slice(0, MAX_FITTING_DESCRIPTION_LENGTH);
  if (!normalizedName) {
    return { success: false, errorMsg: "FITTING_NAME_REQUIRED" };
  }
  if (normalizedName.includes("@@") || normalizedDescription.includes("@@")) {
    return { success: false, errorMsg: "FITTING_INVALID_TEXT" };
  }

  existingRecord.name = normalizedName;
  existingRecord.description = normalizedDescription;
  existingRecord.savedDate = currentFileTime().toString();
  database.write(
    SAVED_FITTINGS_TABLE,
    `/owners/${numericOwnerID}/fittings/${numericFittingID}`,
    existingRecord,
  );
  bumpOwnerRevision(numericOwnerID);
  return {
    success: true,
    data: cloneValue(existingRecord),
  };
}

function deleteFitting(ownerID, fittingID, ownerScope = null) {
  const numericOwnerID = toInt(ownerID, 0);
  const numericFittingID = toInt(fittingID, 0);
  if (isCommunityOwnerScope(ownerScope, numericOwnerID)) {
    return { success: false, errorMsg: "COMMUNITY_FITTINGS_READ_ONLY" };
  }
  const ownerRecord = ensureOwnerRecord(numericOwnerID, ownerScope);
  if (
    !ownerRecord ||
    !ownerRecord.fittings ||
    !ownerRecord.fittings[String(numericFittingID)]
  ) {
    return {
      success: true,
      data: [],
    };
  }

  delete ownerRecord.fittings[String(numericFittingID)];
  database.remove(
    SAVED_FITTINGS_TABLE,
    `/owners/${numericOwnerID}/fittings/${numericFittingID}`,
  );
  bumpOwnerRevision(numericOwnerID);
  return {
    success: true,
    data: [numericFittingID],
  };
}

function deleteManyFittings(ownerID, fittingIDs, ownerScope = null) {
  const numericOwnerID = toInt(ownerID, 0);
  if (isCommunityOwnerScope(ownerScope, numericOwnerID)) {
    return { success: false, errorMsg: "COMMUNITY_FITTINGS_READ_ONLY" };
  }
  const ids = Array.isArray(unwrapMarshalValue(fittingIDs))
    ? unwrapMarshalValue(fittingIDs)
    : [];
  const ownerRecord = ensureOwnerRecord(numericOwnerID, ownerScope);
  const deletedFittingIDs = [];
  const uniqueIDs = [...new Set(ids.map((value) => toInt(value, 0)).filter((value) => value > 0))];
  for (const fittingID of uniqueIDs) {
    if (ownerRecord && ownerRecord.fittings && ownerRecord.fittings[String(fittingID)]) {
      delete ownerRecord.fittings[String(fittingID)];
      deletedFittingIDs.push(fittingID);
    }
  }
  if (deletedFittingIDs.length > 0) {
    database.write(
      SAVED_FITTINGS_TABLE,
      `/owners/${numericOwnerID}/fittings`,
      ownerRecord.fittings,
      { force: true },
    );
    bumpOwnerRevision(numericOwnerID);
  }
  return {
    success: true,
    data: deletedFittingIDs,
  };
}

function throwFittingError(errorMsg = "", values = {}) {
  switch (String(errorMsg || "")) {
    case "FITTING_NAME_REQUIRED":
      throwWrappedUserError("FittingNeedsToHaveAName");
      break;
    case "OWNER_MAX_FITTINGS":
      throwWrappedUserError("CustomNotify", {
        notify: `That fitting collection is full (${toInt(values.maxFittings, 0)} max).`,
      });
      break;
    case "FITTING_INVALID_TEXT":
      throwWrappedUserError("InvalidFittingInvalidCharacter");
      break;
    case "FITTING_INVALID_TYPE_ID":
      throwWrappedUserError("InvalidFittingDataTypeID", {
        typeID: toInt(values.typeID, 0),
        typeName: values.typeName ?? values.typeID ?? null,
      });
      break;
    case "FITTING_INVALID_SHIP_TYPE":
      throwWrappedUserError("InvalidFittingDataShipNotShip", {
        typeName: values.typeName ?? null,
      });
      break;
    case "FITTING_DATA_EMPTY":
      throwWrappedUserError("ParseFittingFittingDataEmpty");
      break;
    case "FITTING_INVALID_FLAG":
      throwWrappedUserError("InvalidFittingDataInvalidFlag", {
        type: toInt(values.type, 0),
      });
      break;
    case "FITTING_INVALID_QUANTITY":
      throwWrappedUserError("InvalidFittingDataInvalidQuantity", {
        type: toInt(values.type, 0),
      });
      break;
    case "COMMUNITY_FITTINGS_READ_ONLY":
      throwWrappedUserError("CustomNotify", {
        notify: "Community fittings are read-only.",
      });
      break;
    case "OWNER_SCOPE_DENIED":
      throwWrappedUserError("CustomNotify", {
        notify: "You do not have access to that fitting collection.",
      });
      break;
    case "FITTING_NOT_FOUND":
      throwWrappedUserError("CustomNotify", {
        notify: "That fitting no longer exists.",
      });
      break;
    default:
      throwWrappedUserError("CustomNotify", {
        notify: typeof values.notify === "string" && values.notify.trim()
          ? values.notify
          : "Fitting operation failed.",
      });
      break;
  }
}

function resetSavedFittingStoreForTests() {
  storeInitialized = false;
  storeRoot = null;
  ownerRevisionByID = new Map();
  ownerPayloadCache = new Map();
}

module.exports = {
  COMMUNITY_FITTING_CORP,
  OWNER_SCOPE,
  assertSessionCanAccessOwner,
  buildFitDataPayload,
  throwFittingError,
  getOwnerFittings,
  getOwnerFittingsResponse,
  getCommunityFittingsResponse,
  saveFitting,
  saveManyFittings,
  updateFitting,
  updateFittingNameAndDescription,
  deleteFitting,
  deleteManyFittings,
  resetSavedFittingStoreForTests,
};
