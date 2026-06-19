const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const config = require(path.join(__dirname, "../../config"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const {
  buildKeyVal,
  buildList,
  currentFileTime,
  isMarshalKeyValName,
  normalizeNumber,
  normalizeText,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  buildInventoryItemRow,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  DEFAULT_STATION,
} = require(path.join(__dirname, "../_shared/stationStaticData"));
const {
  ITEM_FLAGS,
  findItemById,
  listContainerItems,
  moveItemToLocation,
  transferItemToOwnerLocation,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  isTradableInventoryItem,
} = require(path.join(__dirname, "../inventory/typeListAuthority"));
const {
  adjustCharacterBalance,
  getCharacterWallet,
  JOURNAL_ENTRY_TYPE,
} = require(path.join(__dirname, "../account/walletState"));
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  getDockedLocationID,
  getDockedLocationKind,
  isDockedSession,
} = require(path.join(__dirname, "../structure/structureLocation"));

const TRADE_CONTAINER_ID_BASE = 910000000000;
const TRADE_COMPLETED_TTL_MS = 2 * 60 * 1000;
const ASSET_SAFETY_WRAP_TYPE_ID = 60;
let activeTradeMgrService = null;
const DBTYPE = {
  BOOL: 0x0b,
  I1: 0x10,
  UI1: 0x11,
  I2: 0x02,
  UI2: 0x12,
  I4: 0x03,
  UI4: 0x13,
  I8: 0x14,
  UI8: 0x15,
  CY: 0x06,
  FILETIME: 0x40,
  R4: 0x04,
  R8: 0x05,
};

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
}

function buildBoundSubstruct(boundObjectID) {
  return {
    type: "substruct",
    value: {
      type: "substream",
      value: [boundObjectID, currentFileTime()],
    },
  };
}

function setsEqual(left, right) {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function getDbTypeSizeBits(type) {
  switch (type) {
    case DBTYPE.CY:
    case DBTYPE.I8:
    case DBTYPE.UI8:
    case DBTYPE.FILETIME:
    case DBTYPE.R8:
      return 64;
    case DBTYPE.I4:
    case DBTYPE.UI4:
    case DBTYPE.R4:
      return 32;
    case DBTYPE.I2:
    case DBTYPE.UI2:
      return 16;
    case DBTYPE.I1:
    case DBTYPE.UI1:
      return 8;
    case DBTYPE.BOOL:
      return 1;
    default:
      return 0;
  }
}

function decompressRle(buffer, expectedLength) {
  const output = Buffer.alloc(Math.max(0, expectedLength), 0);
  let inputIndex = 0;
  let outputIndex = 0;

  while (inputIndex < buffer.length && outputIndex < output.length) {
    const control = buffer[inputIndex++];
    const lowNibble = control & 0x0f;
    const highNibble = (control >> 4) & 0x0f;

    for (const nibble of [lowNibble, highNibble]) {
      if (outputIndex >= output.length) {
        break;
      }
      if (nibble < 8) {
        const count = Math.min(8 - nibble, output.length - outputIndex);
        if (count > 0) {
          buffer.copy(output, outputIndex, inputIndex, inputIndex + count);
          inputIndex += count;
          outputIndex += count;
        }
      } else {
        const count = Math.min(nibble - 7, output.length - outputIndex);
        output.fill(0, outputIndex, outputIndex + count);
        outputIndex += count;
      }
    }
  }

  return output;
}

function decodePackedNumericValue(type, buffer, offset) {
  switch (type) {
    case DBTYPE.CY:
    case DBTYPE.I8:
    case DBTYPE.FILETIME:
      return buffer.readBigInt64LE(offset);
    case DBTYPE.UI8:
      return buffer.readBigUInt64LE(offset);
    case DBTYPE.I4:
      return buffer.readInt32LE(offset);
    case DBTYPE.UI4:
      return buffer.readUInt32LE(offset);
    case DBTYPE.R4:
      return buffer.readFloatLE(offset);
    case DBTYPE.R8:
      return buffer.readDoubleLE(offset);
    case DBTYPE.I2:
      return buffer.readInt16LE(offset);
    case DBTYPE.UI2:
      return buffer.readUInt16LE(offset);
    case DBTYPE.I1:
      return buffer.readInt8(offset);
    case DBTYPE.UI1:
      return buffer.readUInt8(offset);
    default:
      return null;
  }
}

function normalizePackedRowColumns(packedRow) {
  if (Array.isArray(packedRow && packedRow.columns)) {
    return packedRow.columns;
  }

  const header = packedRow && packedRow.header;
  if (
    header &&
    header.type &&
    (header.type === "objectex1" || header.type === "objectex2") &&
    Array.isArray(header.header) &&
    header.header.length >= 2 &&
    Array.isArray(header.header[1]) &&
    header.header[1].length >= 1 &&
    Array.isArray(header.header[1][0])
  ) {
    return header.header[1][0];
  }

  return [];
}

function decodePackedRowNumericFields(packedRow) {
  if (!packedRow || typeof packedRow !== "object") {
    return {};
  }

  const columns = normalizePackedRowColumns(packedRow);
  const rleData = Buffer.isBuffer(packedRow.rleData)
    ? packedRow.rleData
    : null;
  if (!columns.length || !rleData) {
    return {};
  }

  const sizeMap = [];
  const booleanColumns = new Map();
  let booleansBitLength = 0;
  let nullsBitLength = 0;
  let byteDataBitLength = 0;

  for (let index = 0; index < columns.length; index += 1) {
    const [, type] = columns[index];
    const size = getDbTypeSizeBits(type);
    if (type === DBTYPE.BOOL) {
      booleanColumns.set(index, booleansBitLength);
      booleansBitLength += 1;
    }
    nullsBitLength += 1;
    if (size >= 8) {
      byteDataBitLength += size;
    }
    sizeMap.push({ size, index, type });
  }

  sizeMap.sort((left, right) => {
    if (right.size !== left.size) {
      return right.size - left.size;
    }
    return left.index - right.index;
  });

  const bitDataByteLength = ((booleansBitLength + nullsBitLength) >> 3) + 1;
  const byteDataByteLength = byteDataBitLength >> 3;
  const packedBuffer = decompressRle(rleData, byteDataByteLength + bitDataByteLength);
  const rowData = packedBuffer.subarray(0, byteDataByteLength);
  const bitData = packedBuffer.subarray(byteDataByteLength);
  const fields = {};
  let rowOffset = 0;

  for (const entry of sizeMap) {
    const [name] = columns[entry.index] || [];
    const normalizedName = normalizeText(name, "");
    if (!normalizedName) {
      continue;
    }

    const nullBit = entry.index + booleansBitLength;
    const nullByte = nullBit >> 3;
    const nullMask = 1 << (nullBit & 0x7);
    const isNull = Boolean(bitData[nullByte] & nullMask);

    if (entry.size > 1) {
      if (isNull) {
        fields[normalizedName] = null;
        continue;
      }
      const byteLength = entry.size >> 3;
      fields[normalizedName] = decodePackedNumericValue(entry.type, rowData, rowOffset);
      rowOffset += byteLength;
      continue;
    }

    if (entry.type !== DBTYPE.BOOL) {
      continue;
    }

    if (isNull) {
      fields[normalizedName] = null;
      continue;
    }

    const boolBit = booleanColumns.get(entry.index);
    const boolByte = boolBit >> 3;
    const boolMask = 1 << (boolBit & 0x7);
    fields[normalizedName] = Boolean(bitData[boolByte] & boolMask);
  }

  return fields;
}

function extractManifestFieldRaw(manifestValue, fieldName) {
  if (!manifestValue || typeof manifestValue !== "object") {
    return null;
  }

  if (
    manifestValue.type === "object" &&
    isMarshalKeyValName(manifestValue.name) &&
    manifestValue.args &&
    manifestValue.args.type === "dict"
  ) {
    return extractManifestFieldRaw(manifestValue.args, fieldName);
  }

  if (manifestValue.type === "dict" && Array.isArray(manifestValue.entries)) {
    for (const [entryKey, entryValue] of manifestValue.entries) {
      if (normalizeText(entryKey, "") === fieldName) {
        return entryValue;
      }
    }
    return null;
  }

  const unwrapped = unwrapMarshalValue(manifestValue);
  return unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)
    ? unwrapped[fieldName]
    : null;
}

function extractManifestTradeItemEntries(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => !Buffer.isBuffer(entry) || entry.length > 0);
  }

  if (value instanceof Set) {
    return [...value].filter((entry) => !Buffer.isBuffer(entry) || entry.length > 0);
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  if (
    (value.type === "list" || value.type === "tuple" || value.type === "set") &&
    Array.isArray(value.items)
  ) {
    return value.items.filter((entry) => !Buffer.isBuffer(entry) || entry.length > 0);
  }

  if (
    (value.type === "objectex1" || value.type === "objectex2") &&
    Array.isArray(value.header) &&
    value.header.length >= 2 &&
    normalizeText(value.header[0], "") === "__builtin__.set"
  ) {
    const headerArgs = Array.isArray(value.header[1]) ? value.header[1] : [];
    const headerItems = extractManifestTradeItemEntries(headerArgs[0]);
    const tailItems = Array.isArray(value.list)
      ? value.list.filter((entry) => !Buffer.isBuffer(entry) || entry.length > 0)
      : [];
    return [...headerItems, ...tailItems];
  }

  const unwrapped = unwrapMarshalValue(value);
  return Array.isArray(unwrapped) ? unwrapped : [];
}

function getItemIDFromManifestEntry(entry) {
  if (entry === null || entry === undefined) {
    return 0;
  }

  if (typeof entry === "number" || typeof entry === "bigint") {
    return Number(entry) || 0;
  }

  if (typeof entry === "object") {
    if (Number(entry.itemID) > 0) {
      return Number(entry.itemID);
    }
    if (entry.type === "packedrow") {
      const decodedFields = decodePackedRowNumericFields(entry);
      if (Number(decodedFields.itemID) > 0) {
        return Number(decodedFields.itemID);
      }
    }
    if (entry.fields && Number(entry.fields.itemID) > 0) {
      return Number(entry.fields.itemID);
    }
    if (entry.line && Array.isArray(entry.line.items) && Number(entry.line.items[0]) > 0) {
      return Number(entry.line.items[0]);
    }
  }

  return 0;
}

class TradeMgrService extends BaseService {
  constructor() {
    super("trademgr");
    this._trades = new Map();
    this._boundContexts = new Map();
    this._tradeByParticipant = new Map();
    this._tradeOrdinal = 1;
    activeTradeMgrService = this;
  }

  _buildNotify(message) {
    return {
      notify: normalizeText(message, "Trade failed."),
    };
  }

  _throwTradeError(message) {
    throwWrappedUserError("CustomNotify", this._buildNotify(message));
  }

  _nextTradeContainerID() {
    const tradeOrdinal = this._tradeOrdinal++;
    return TRADE_CONTAINER_ID_BASE + tradeOrdinal;
  }

  _createBoundObjectID() {
    const boundId = config.getNextBoundId();
    return `N=${config.proxyNodeId}:${boundId}`;
  }

  _ensureTradeBoundObject(trade) {
    if (!trade.boundObjectID) {
      trade.boundObjectID = this._createBoundObjectID();
      this._boundContexts.set(trade.boundObjectID, trade.tradeID);
      if (this.serviceManager) {
        this.serviceManager.registerBoundObject(trade.boundObjectID, this);
      }
    }

    return trade.boundObjectID;
  }

  _bindTradeForSession(trade, session) {
    const boundObjectID = this._ensureTradeBoundObject(trade);
    if (session) {
      if (!session._boundObjectIDs || typeof session._boundObjectIDs !== "object") {
        session._boundObjectIDs = {};
      }
      session._boundObjectIDs[this.name] = boundObjectID;
      session.lastBoundObjectID = boundObjectID;
    }
    return buildBoundSubstruct(boundObjectID);
  }

  _getTradeByBoundObjectID(boundObjectID) {
    if (!boundObjectID) {
      return null;
    }
    const tradeID = this._boundContexts.get(String(boundObjectID)) || null;
    if (!tradeID) {
      return null;
    }
    return this._trades.get(tradeID) || null;
  }

  _getTradeFromSession(session) {
    return this._getTradeByBoundObjectID(
      session && session.currentBoundObjectID ? session.currentBoundObjectID : null,
    );
  }

  _getParticipantIndex(trade, characterID) {
    const numericCharacterID = Number(characterID) || 0;
    if (!trade || !Array.isArray(trade.traders)) {
      return -1;
    }
    return trade.traders.findIndex((candidate) => Number(candidate) === numericCharacterID);
  }

  _getParticipantSession(characterID, excludeSession = null) {
    return sessionRegistry.findSessionByCharacterID(characterID, {
      excludeSession,
    });
  }

  _isTradeParticipantDockedInTrade(trade, session) {
    if (!trade || !session || !isDockedSession(session)) {
      return false;
    }

    return Number(getDockedLocationID(session) || 0) === Number(trade.dockedLocationID || 0);
  }

  _resolveTradeContext(session, { requireOpen = false } = {}) {
    const trade = this._getTradeFromSession(session);
    if (!trade) {
      this._throwTradeError("Trade session is no longer available.");
    }

    const characterID = Number(session && session.characterID || 0);
    const participantIndex = this._getParticipantIndex(trade, characterID);
    if (participantIndex < 0) {
      this._throwTradeError("You are not a participant in this trade.");
    }

    if (trade.status === "open" && !this._isTradeParticipantDockedInTrade(trade, session)) {
      this._abortTrade(trade, { notifyParticipants: true });
    }

    if (requireOpen && trade.status !== "open") {
      this._throwTradeError("Trade session is no longer available.");
    }

    return {
      trade,
      participantIndex,
      characterID,
    };
  }

  _buildListResponse(trade) {
    const items = this._listTradeItems(trade)
      .map((item) => buildInventoryItemRow(item));
    return buildKeyVal([
      ["traders", buildList(trade.traders.slice())],
      ["tradeContainerID", Number(trade.tradeContainerID) || 0],
      ["items", buildList(items)],
      ["money", buildList(trade.moneyOffers.slice())],
      ["state", buildList(trade.offerStates.slice())],
    ]);
  }

  _buildSelfInvItem(trade, session) {
    return buildKeyVal([
      ["itemID", Number(trade.tradeContainerID) || 0],
      ["typeID", DEFAULT_STATION.stationTypeID],
      ["ownerID", Number(session && session.characterID || 0) || 0],
      ["locationID", Number(trade.dockedLocationID || 0) || 0],
      ["flagID", ITEM_FLAGS.HANGAR],
      ["stacksize", 1],
      ["quantity", -1],
      ["singleton", 1],
    ]);
  }

  _listTradeItems(trade) {
    return listContainerItems(null, trade.tradeContainerID, null)
      .sort((left, right) => Number(left.itemID || 0) - Number(right.itemID || 0));
  }

  _cleanupTradeIndex(trade) {
    if (!trade || !Array.isArray(trade.traders)) {
      return;
    }
    for (const characterID of trade.traders) {
      const numericCharacterID = Number(characterID) || 0;
      if (numericCharacterID > 0 && this._tradeByParticipant.get(numericCharacterID) === trade.tradeID) {
        this._tradeByParticipant.delete(numericCharacterID);
      }
    }
  }

  _scheduleTradeCleanup(trade, ttlMs = TRADE_COMPLETED_TTL_MS) {
    if (!trade) {
      return;
    }

    if (trade.cleanupTimer) {
      clearTimeout(trade.cleanupTimer);
      trade.cleanupTimer = null;
    }

    const timer = setTimeout(() => {
      this._cleanupTradeIndex(trade);
      if (trade.boundObjectID) {
        this._boundContexts.delete(trade.boundObjectID);
      }
      this._trades.delete(trade.tradeID);
    }, Math.max(1000, Number(ttlMs) || TRADE_COMPLETED_TTL_MS));
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    trade.cleanupTimer = timer;
  }

  _notifyParticipants(trade, name, payload) {
    for (const characterID of trade.traders) {
      const session = this._getParticipantSession(characterID, null);
      if (!session || typeof session.sendNotification !== "function") {
        continue;
      }
      session.sendNotification(name, "clientID", payload);
    }
  }

  _resetOfferState(trade, options = {}) {
    trade.offerStates = [0, 0];
    if (options.notify !== false) {
      this._notifyParticipants(trade, "OnTradeOffer", [
        trade.tradeContainerID,
        trade.offerStates.slice(),
      ]);
    }
  }

  _notifyItemChangeToTradeParticipants(trade, changedItem, previousState = {}) {
    for (const characterID of trade.traders) {
      const session = this._getParticipantSession(characterID, null);
      if (!session) {
        continue;
      }

      const numericCharacterID = Number(characterID) || 0;
      const nextOwnerID = Number(changedItem && changedItem.ownerID || 0) || 0;
      const previousOwnerID = Number(previousState && previousState.ownerID || 0) || 0;
      const nextLocationID = Number(changedItem && changedItem.locationID || 0) || 0;
      const previousLocationID = Number(previousState && previousState.locationID || 0) || 0;
      const touchesTradeContainer =
        nextLocationID === trade.tradeContainerID ||
        previousLocationID === trade.tradeContainerID;
      const touchesSessionOwner =
        nextOwnerID === numericCharacterID ||
        previousOwnerID === numericCharacterID;

      if (!touchesTradeContainer && !touchesSessionOwner) {
        continue;
      }

      syncInventoryItemForSession(session, changedItem, previousState, {
        emitCfgLocation: false,
      });
    }
  }

  _notifyChangeList(trade, changes = []) {
    for (const change of Array.isArray(changes) ? changes : []) {
      if (!change || !change.item) {
        continue;
      }
      this._notifyItemChangeToTradeParticipants(
        trade,
        change.item,
        change.previousData || {},
      );
    }
  }

  _notifyTradeItemPriming(trade, rootItemIDs = []) {
    const normalizedRootIDs = [...new Set(
      (Array.isArray(rootItemIDs) ? rootItemIDs : [rootItemIDs])
        .map((value) => Number(value) || 0)
        .filter((value) => value > 0),
    )];
    if (normalizedRootIDs.length <= 0) {
      return;
    }

    const primeItemIDs = [];
    const seen = new Set();
    for (const rootItemID of normalizedRootIDs) {
      if (!seen.has(rootItemID)) {
        seen.add(rootItemID);
        primeItemIDs.push(rootItemID);
      }
      for (const child of this._collectContainedItems(rootItemID)) {
        const childItemID = Number(child && child.itemID || 0);
        if (childItemID <= 0 || seen.has(childItemID)) {
          continue;
        }
        seen.add(childItemID);
        primeItemIDs.push(childItemID);
      }
    }

    if (primeItemIDs.length <= 0) {
      return;
    }

    this._notifyParticipants(trade, "OnPrimingNeededForTradeItems", [
      primeItemIDs,
    ]);
  }

  _getTradeParticipantSessions(trade) {
    return trade.traders
      .map((characterID) => this._getParticipantSession(characterID, null))
      .filter(Boolean);
  }

  _ensureAllParticipantsStillValid(trade) {
    if (!trade || trade.status !== "open") {
      return false;
    }

    const participantSessions = this._getTradeParticipantSessions(trade);
    if (participantSessions.length !== 2) {
      this._abortTrade(trade, { notifyParticipants: true });
      return false;
    }

    if (!participantSessions.every((session) => this._isTradeParticipantDockedInTrade(trade, session))) {
      this._abortTrade(trade, { notifyParticipants: true });
      return false;
    }

    return true;
  }

  _collectContainedItems(rootItemID) {
    const numericRootItemID = Number(rootItemID) || 0;
    if (numericRootItemID <= 0) {
      return [];
    }

    const collected = [];
    const queue = [numericRootItemID];
    const seen = new Set([numericRootItemID]);

    while (queue.length > 0) {
      const currentLocationID = queue.shift();
      const children = listContainerItems(null, currentLocationID, null)
        .sort((left, right) => Number(left.itemID || 0) - Number(right.itemID || 0));
      for (const child of children) {
        const childItemID = Number(child && child.itemID || 0);
        if (childItemID <= 0 || seen.has(childItemID)) {
          continue;
        }
        seen.add(childItemID);
        collected.push(child);
        queue.push(childItemID);
      }
    }

    return collected;
  }

  _transferContainedItemsToOwner(trade, rootItemID, destinationOwnerID) {
    const changes = [];
    const descendants = this._collectContainedItems(rootItemID);
    for (const child of descendants) {
      const transferResult = transferItemToOwnerLocation(
        child.itemID,
        destinationOwnerID,
        child.locationID,
        child.flagID,
        null,
      );
      if (!transferResult.success) {
        return transferResult;
      }
      changes.push(...(((transferResult.data && transferResult.data.changes) || [])));
    }

    return {
      success: true,
      data: {
        changes,
      },
    };
  }

  _abortTrade(trade, options = {}) {
    if (!trade || trade.status !== "open") {
      return {
        success: true,
        alreadyClosed: true,
      };
    }

    const stagedItems = this._listTradeItems(trade);
    for (const stagedItem of stagedItems) {
      const returnContext = trade.stagedItemOrigins.get(Number(stagedItem.itemID) || 0) || null;
      if (!returnContext) {
        continue;
      }
      const moveResult = moveItemToLocation(
        stagedItem.itemID,
        returnContext.locationID,
        returnContext.flagID,
        null,
      );
      if (!moveResult.success) {
        return moveResult;
      }
      this._notifyChangeList(trade, moveResult.data && moveResult.data.changes);
    }

    trade.status = "aborted";
    this._cleanupTradeIndex(trade);
    trade.offerStates = [0, 0];
    trade.moneyOffers = [0, 0];
    trade.stagedItemOrigins.clear();

    if (options.notifyParticipants !== false) {
      this._notifyParticipants(trade, "OnTradeCancel", [
        trade.tradeContainerID,
      ]);
    }

    this._scheduleTradeCleanup(trade);
    return { success: true };
  }

  _parseManifest(args) {
    const rawManifest = Array.isArray(args) ? args[0] : null;
    const manifest = unwrapMarshalValue(rawManifest);
    const money = Array.isArray(manifest && manifest.money)
      ? manifest.money.map((value) => Math.round((Number(value) || 0) * 100) / 100)
      : [];
    const rawTradeItems = extractManifestFieldRaw(rawManifest, "tradeItems");
    const tradeItems = new Set(
      extractManifestTradeItemEntries(rawTradeItems)
        .map((entry) => getItemIDFromManifestEntry(entry))
        .filter((itemID) => Number.isInteger(itemID) && itemID > 0),
    );

    return {
      tradeContainerID: Number(manifest && manifest.tradeContainerID || 0) || 0,
      money,
      tradeItems,
    };
  }

  _resolveMoveQuantity(kwargs) {
    const normalizedKwargs = unwrapMarshalValue(kwargs);
    const quantity = normalizedKwargs && Object.prototype.hasOwnProperty.call(normalizedKwargs, "qty")
      ? normalizedKwargs.qty
      : null;
    return quantity === null || quantity === undefined
      ? null
      : normalizePositiveInteger(quantity, 1);
  }

  _resolveSourceAccessibility(item, session) {
    if (!item || !session) {
      return null;
    }

    const dockedLocationID = Number(getDockedLocationID(session) || 0) || 0;
    if (dockedLocationID <= 0) {
      return null;
    }

    const visited = new Set();
    let current = item;
    while (current) {
      const currentItemID = Number(current.itemID || 0) || 0;
      const currentLocationID = Number(current.locationID || 0) || 0;

      if (currentLocationID === dockedLocationID) {
        return {
          rootLocationID: dockedLocationID,
        };
      }

      if (currentLocationID <= 0 || visited.has(currentLocationID) || currentItemID === currentLocationID) {
        return null;
      }

      visited.add(currentLocationID);
      current = findItemById(currentLocationID);
    }

    return null;
  }

  _validateOfferedItem(item, session, sourceLocationID) {
    const numericCharacterID = Number(session && session.characterID || 0) || 0;
    const numericSourceLocationID = Number(sourceLocationID) || 0;
    if (!item || Number(item.ownerID || 0) !== numericCharacterID) {
      this._throwTradeError("That item is not available to trade.");
    }

    if (Number(item.itemID || 0) === Number(session && session.activeShipID || 0)) {
      throwWrappedUserError("PeopleAboardShip", {});
    }

    if (Number(item.typeID || 0) === ASSET_SAFETY_WRAP_TYPE_ID) {
      throwWrappedUserError("CannotTradeAssetSafety", {});
    }

    if (!isTradableInventoryItem(item)) {
      throwWrappedUserError("ItemCannotBeTraded", {
        type_ids: [Number(item.typeID || 0) || 0],
      });
    }

    const accessibility = this._resolveSourceAccessibility(item, session);
    if (!accessibility) {
      this._throwTradeError("That item is not available to trade from your current docked inventory.");
    }

    if (numericSourceLocationID > 0 && Number(item.locationID || 0) !== numericSourceLocationID) {
      this._throwTradeError("That item is no longer in the source inventory.");
    }
  }

  _completeMoneyTransfer(trade) {
    const [leftAmount, rightAmount] = trade.moneyOffers;
    const [leftCharacterID, rightCharacterID] = trade.traders;

    const leftWallet = getCharacterWallet(leftCharacterID);
    const rightWallet = getCharacterWallet(rightCharacterID);
    if (!leftWallet || !rightWallet) {
      return {
        success: false,
        errorMsg: "CHARACTER_NOT_FOUND",
      };
    }

    if (leftWallet.balance < leftAmount || rightWallet.balance < rightAmount) {
      return {
        success: false,
        errorMsg: "INSUFFICIENT_FUNDS",
      };
    }

    const transfers = [
      [leftCharacterID, rightCharacterID, leftAmount],
      [rightCharacterID, leftCharacterID, rightAmount],
    ];

    for (const [fromCharacterID, toCharacterID, amount] of transfers) {
      const normalizedAmount = Math.round((Number(amount) || 0) * 100) / 100;
      if (!(normalizedAmount > 0)) {
        continue;
      }

      const debitResult = adjustCharacterBalance(fromCharacterID, -normalizedAmount, {
        ownerID1: fromCharacterID,
        ownerID2: toCharacterID,
        referenceID: toCharacterID,
        entryTypeID: JOURNAL_ENTRY_TYPE.PLAYER_TRADING,
        description: `Trade with ${toCharacterID}`,
      });
      if (!debitResult.success) {
        return debitResult;
      }

      const creditResult = adjustCharacterBalance(toCharacterID, normalizedAmount, {
        ownerID1: fromCharacterID,
        ownerID2: toCharacterID,
        referenceID: fromCharacterID,
        entryTypeID: JOURNAL_ENTRY_TYPE.PLAYER_TRADING,
        description: `Trade with ${fromCharacterID}`,
      });
      if (!creditResult.success) {
        adjustCharacterBalance(fromCharacterID, normalizedAmount, {
          ownerID1: toCharacterID,
          ownerID2: fromCharacterID,
          referenceID: fromCharacterID,
          entryTypeID: JOURNAL_ENTRY_TYPE.PLAYER_TRADING,
          description: `Trade rollback with ${toCharacterID}`,
        });
        return creditResult;
      }
    }

    return { success: true };
  }

  _completeItemTransfers(trade) {
    const stagedItems = this._listTradeItems(trade);
    for (const stagedItem of stagedItems) {
      const senderIndex = this._getParticipantIndex(trade, stagedItem.ownerID);
      if (senderIndex < 0) {
        return {
          success: false,
          errorMsg: "TRADE_ITEM_OWNER_INVALID",
        };
      }

      const recipientCharacterID = trade.traders[senderIndex === 0 ? 1 : 0];
      const topLevelTransfer = transferItemToOwnerLocation(
        stagedItem.itemID,
        recipientCharacterID,
        trade.dockedLocationID,
        ITEM_FLAGS.HANGAR,
        null,
      );
      if (!topLevelTransfer.success) {
        return topLevelTransfer;
      }
      this._notifyChangeList(trade, topLevelTransfer.data && topLevelTransfer.data.changes);

      const containedTransfer = this._transferContainedItemsToOwner(
        trade,
        stagedItem.itemID,
        recipientCharacterID,
      );
      if (!containedTransfer.success) {
        return containedTransfer;
      }
      this._notifyChangeList(trade, containedTransfer.data && containedTransfer.data.changes);
    }

    return { success: true };
  }

  Handle_InitiateTrade(args, session) {
    const targetCharacterID = normalizePositiveInteger(
      Array.isArray(args) ? args[0] : 0,
      0,
    );
    const initiatorCharacterID = Number(session && session.characterID || 0) || 0;
    if (initiatorCharacterID <= 0 || targetCharacterID <= 0) {
      this._throwTradeError("Trade target could not be resolved.");
    }
    if (initiatorCharacterID === targetCharacterID) {
      this._throwTradeError("You cannot trade with yourself.");
    }

    if (!isDockedSession(session)) {
      this._throwTradeError("Both pilots must be docked in the same station or structure to trade.");
    }

    const targetSession = this._getParticipantSession(targetCharacterID, session);
    if (!targetSession || !isDockedSession(targetSession)) {
      this._throwTradeError("The selected pilot must be docked and online to trade.");
    }

    const initiatorDockedLocationID = Number(getDockedLocationID(session) || 0) || 0;
    const targetDockedLocationID = Number(getDockedLocationID(targetSession) || 0) || 0;
    if (initiatorDockedLocationID <= 0 || initiatorDockedLocationID !== targetDockedLocationID) {
      this._throwTradeError("Both pilots must be docked in the same station or structure to trade.");
    }

    const existingInitiatorTradeID = this._tradeByParticipant.get(initiatorCharacterID) || null;
    const existingTargetTradeID = this._tradeByParticipant.get(targetCharacterID) || null;
    if (
      existingInitiatorTradeID &&
      existingTargetTradeID &&
      existingInitiatorTradeID === existingTargetTradeID
    ) {
      const existingTrade = this._trades.get(existingInitiatorTradeID) || null;
      if (existingTrade) {
        return this._bindTradeForSession(existingTrade, session);
      }
    }

    if (existingInitiatorTradeID || existingTargetTradeID) {
      this._throwTradeError("One of those pilots is already in another direct trade.");
    }

    const tradeID = `trade:${this._nextTradeContainerID()}`;
    const trade = {
      tradeID,
      tradeContainerID: Number(tradeID.split(":")[1]) || this._nextTradeContainerID(),
      dockedLocationID: initiatorDockedLocationID,
      dockedLocationKind: getDockedLocationKind(session),
      traders: [initiatorCharacterID, targetCharacterID],
      moneyOffers: [0, 0],
      offerStates: [0, 0],
      status: "open",
      stagedItemOrigins: new Map(),
      boundObjectID: null,
      cleanupTimer: null,
    };

    this._trades.set(trade.tradeID, trade);
    this._tradeByParticipant.set(initiatorCharacterID, trade.tradeID);
    this._tradeByParticipant.set(targetCharacterID, trade.tradeID);

    const initiatorBound = this._bindTradeForSession(trade, session);
    const targetBound = this._bindTradeForSession(trade, targetSession);

    targetSession.sendNotification("OnTradeInitiate", "clientID", [
      initiatorCharacterID,
      targetBound,
      null,
    ]);

    log.info(
      `[TradeMgr] Initiated trade ${trade.tradeID} between ${initiatorCharacterID} and ${targetCharacterID} at ${trade.dockedLocationID}`,
    );

    return initiatorBound;
  }

  Handle_List(args, session) {
    const { trade } = this._resolveTradeContext(session, { requireOpen: false });
    return this._buildListResponse(trade);
  }

  Handle_GetSelfInvItem(args, session) {
    const { trade } = this._resolveTradeContext(session, { requireOpen: false });
    return this._buildSelfInvItem(trade, session);
  }

  Handle_Add(args, session, kwargs) {
    const { trade } = this._resolveTradeContext(session, { requireOpen: true });
    if (!this._ensureAllParticipantsStillValid(trade)) {
      this._throwTradeError("Trade session is no longer available.");
    }

    const itemID = normalizePositiveInteger(Array.isArray(args) ? args[0] : 0, 0);
    const sourceLocationID = normalizePositiveInteger(Array.isArray(args) ? args[1] : 0, 0);
    const quantity = this._resolveMoveQuantity(kwargs);

    const item = findItemById(itemID);
    this._validateOfferedItem(item, session, sourceLocationID);

    const originContext = {
      ownerID: Number(item.ownerID || 0) || 0,
      locationID: Number(item.locationID || 0) || 0,
      flagID: Number(item.flagID || 0) || 0,
    };
    const moveResult = moveItemToLocation(
      itemID,
      trade.tradeContainerID,
      ITEM_FLAGS.HANGAR,
      quantity,
    );
    if (!moveResult.success) {
      this._throwTradeError("The item could not be moved into the trade window.");
    }

    const changes = (moveResult.data && moveResult.data.changes) || [];
    const stagedRootItemIDs = [];
    for (const change of changes) {
      const changedItem = change && change.item ? change.item : null;
      if (!changedItem) {
        continue;
      }
      if (Number(changedItem.locationID || 0) === trade.tradeContainerID) {
        trade.stagedItemOrigins.set(Number(changedItem.itemID) || 0, cloneValue(originContext));
        stagedRootItemIDs.push(Number(changedItem.itemID) || 0);
      }
    }

    this._notifyChangeList(trade, changes);
    this._notifyTradeItemPriming(trade, stagedRootItemIDs);
    this._resetOfferState(trade);
    return null;
  }

  Handle_OfferMoney(args, session) {
    const { trade, participantIndex, characterID } = this._resolveTradeContext(
      session,
      { requireOpen: true },
    );
    if (!this._ensureAllParticipantsStillValid(trade)) {
      this._throwTradeError("Trade session is no longer available.");
    }

    const amount = Math.round((normalizeNumber(Array.isArray(args) ? args[0] : 0, 0) || 0) * 100) / 100;
    if (amount < 0) {
      this._throwTradeError("ISK offer must be zero or greater.");
    }

    const wallet = getCharacterWallet(characterID);
    if (!wallet || wallet.balance < amount) {
      this._throwTradeError("You do not have enough ISK to offer that amount.");
    }

    trade.moneyOffers[participantIndex] = amount;
    this._notifyParticipants(trade, "OnTradeMoneyOffer", [
      trade.tradeContainerID,
      trade.moneyOffers.slice(),
    ]);
    this._resetOfferState(trade);
    return null;
  }

  Handle_MakeOffer(args, session) {
    const { trade, participantIndex } = this._resolveTradeContext(session, { requireOpen: true });
    if (!this._ensureAllParticipantsStillValid(trade)) {
      this._throwTradeError("Trade session is no longer available.");
    }

    const manifest = this._parseManifest(args);
    const stagedItemIDs = new Set(
      this._listTradeItems(trade)
        .map((item) => Number(item.itemID) || 0)
        .filter((itemID) => itemID > 0),
    );
    const normalizedMoney = trade.moneyOffers.map((value) => Math.round((Number(value) || 0) * 100) / 100);
    const manifestMoney = trade.moneyOffers.map((_, index) =>
      Math.round((Number(manifest.money[index]) || 0) * 100) / 100,
    );
    const manifestMatches =
      manifest.tradeContainerID === trade.tradeContainerID &&
      manifest.money.length === trade.moneyOffers.length &&
      normalizedMoney.every((value, index) => value === manifestMoney[index]) &&
      setsEqual(stagedItemIDs, manifest.tradeItems);

    if (!manifestMatches) {
      trade.offerStates = [0, 0];
      session.sendNotification("OnTradeOfferReset", "clientID", [
        trade.tradeContainerID,
        true,
      ]);
      this._notifyParticipants(trade, "OnTradeOffer", [
        trade.tradeContainerID,
        [0, 0],
      ]);
      return null;
    }

    trade.offerStates[participantIndex] = 1;
    if (!(trade.offerStates[0] && trade.offerStates[1])) {
      this._notifyParticipants(trade, "OnTradeOffer", [
        trade.tradeContainerID,
        trade.offerStates.slice(),
      ]);
      return null;
    }

    const moneyTransferResult = this._completeMoneyTransfer(trade);
    if (!moneyTransferResult.success) {
      this._resetOfferState(trade);
      this._throwTradeError("One pilot no longer has enough ISK to complete the trade.");
    }

    const itemTransferResult = this._completeItemTransfers(trade);
    if (!itemTransferResult.success) {
      this._throwTradeError("Trade completion failed while moving staged items.");
    }

    trade.status = "completed";
    this._cleanupTradeIndex(trade);
    trade.stagedItemOrigins.clear();
    this._notifyParticipants(trade, "OnTradeComplete", [
      trade.tradeContainerID,
      null,
    ]);
    this._scheduleTradeCleanup(trade);
    return null;
  }

  Handle_Abort(args, session) {
    const trade = this._getTradeFromSession(session);
    if (!trade || trade.status !== "open") {
      return null;
    }

    const participantIndex = this._getParticipantIndex(
      trade,
      Number(session && session.characterID || 0),
    );
    if (participantIndex < 0) {
      return null;
    }

    this._abortTrade(trade, { notifyParticipants: true });
    return null;
  }

  abortTradesForSession(session) {
    const characterID = Number(session && session.characterID || session && session.charid || 0) || 0;
    if (characterID <= 0) {
      return {
        success: false,
        errorMsg: "CHARACTER_REQUIRED",
      };
    }
    const tradeID = this._tradeByParticipant.get(characterID) || null;
    if (!tradeID) {
      return {
        success: true,
        count: 0,
      };
    }
    const trade = this._trades.get(tradeID) || null;
    if (!trade || trade.status !== "open") {
      return {
        success: true,
        count: 0,
      };
    }
    this._abortTrade(trade, { notifyParticipants: true });
    return {
      success: true,
      count: 1,
    };
  }
}

function abortTradesForSession(session) {
  if (!activeTradeMgrService) {
    return {
      success: true,
      count: 0,
    };
  }
  return activeTradeMgrService.abortTradesForSession(session);
}

module.exports = TradeMgrService;
module.exports.abortTradesForSession = abortTradesForSession;
