// Credits to Deer_Hunter for notepad! Woohoo!

const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const { currentFileTime } = require(path.join(__dirname, "../_shared/serviceHelpers"));

const TABLE_NAME = "characterNotes";
const TABLE_VERSION = 1;
const DEFAULT_FOLDERS_LABEL = "S:Folders";
const DEFAULT_FOLDERS_NOTE = "1::F::0::Main|";

function toInt(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numericValue = toInt(value, 0);
  return numericValue > 0 ? numericValue : fallback;
}

function toText(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (typeof value === "object") {
    if (
      value.type === "wstring" ||
      value.type === "token" ||
      value.type === "int" ||
      value.type === "long" ||
      value.type === "float" ||
      value.type === "double" ||
      value.type === "bool"
    ) {
      return toText(value.value, fallback);
    }

    if ("value" in value) {
      return toText(value.value, fallback);
    }

    if ("str" in value) {
      return toText(value.str, fallback);
    }
  }

  return fallback;
}

function nowFileTimeString() {
  return currentFileTime().toString();
}

function buildDefaultTable() {
  return {
    _meta: {
      version: TABLE_VERSION,
      nextNoteID: 1,
    },
    characters: {},
  };
}

function buildDefaultBucket() {
  return {
    notes: {},
    itemNotes: {},
  };
}

function rootPath() {
  return "/";
}

function characterPath(characterID) {
  return `/characters/${String(characterID)}`;
}

function notesPath(characterID) {
  return `${characterPath(characterID)}/notes`;
}

function ownerNotePath(characterID, noteID) {
  return `${notesPath(characterID)}/${String(noteID)}`;
}

function itemNotesPath(characterID) {
  return `${characterPath(characterID)}/itemNotes`;
}

function itemNotePath(characterID, itemID) {
  return `${itemNotesPath(characterID)}/${String(itemID)}`;
}

function noteSummary(entry) {
  return {
    noteID: toPositiveInt(entry && entry.noteID, 0),
    label: toText(entry && entry.label, ""),
    note: toText(entry && entry.note, ""),
    created: toText(entry && entry.created, nowFileTimeString()),
    updated: toText(entry && entry.updated, nowFileTimeString()),
  };
}

function readRootTable() {
  const readResult = database.read(TABLE_NAME, rootPath());
  if (!readResult.success || !readResult.data || typeof readResult.data !== "object") {
    const defaultTable = buildDefaultTable();
    const writeResult = database.write(TABLE_NAME, rootPath(), defaultTable);
    return writeResult && writeResult.success ? defaultTable : null;
  }

  const table = readResult.data;
  let changed = false;

  if (!table._meta || typeof table._meta !== "object") {
    table._meta = {};
    changed = true;
  }

  if (!Number.isFinite(Number(table._meta.version))) {
    table._meta.version = TABLE_VERSION;
    changed = true;
  }

  if (!Number.isFinite(Number(table._meta.nextNoteID)) || Number(table._meta.nextNoteID) <= 0) {
    table._meta.nextNoteID = 1;
    changed = true;
  }

  if (!table.characters || typeof table.characters !== "object") {
    table.characters = {};
    changed = true;
  }

  if (changed) {
    const writeResult = database.write(TABLE_NAME, rootPath(), table);
    if (!writeResult || !writeResult.success) {
      return null;
    }
  }

  return table;
}

function ensureCharacterBucket(characterID) {
  const numericCharacterID = toPositiveInt(characterID, 0);
  if (!numericCharacterID) {
    return null;
  }

  const table = readRootTable();
  if (!table) {
    return null;
  }

  const characterKey = String(numericCharacterID);
  let bucket = table.characters[characterKey];
  let changed = false;

  if (!bucket || typeof bucket !== "object") {
    bucket = buildDefaultBucket();
    table.characters[characterKey] = bucket;
    changed = true;
  }

  if (!bucket.notes || typeof bucket.notes !== "object") {
    bucket.notes = {};
    changed = true;
  }

  if (!bucket.itemNotes || typeof bucket.itemNotes !== "object") {
    bucket.itemNotes = {};
    changed = true;
  }

  if (changed) {
    const writeResult = database.write(TABLE_NAME, characterPath(characterKey), bucket);
    if (!writeResult || !writeResult.success) {
      return null;
    }
  }

  return {
    table,
    bucket,
    characterID: numericCharacterID,
    characterKey,
  };
}

function listNoteIDsByLabel(notes, label) {
  return Object.values(notes || {})
    .map((entry) => noteSummary(entry))
    .filter((entry) => entry.noteID > 0 && entry.label === label)
    .map((entry) => entry.noteID)
    .sort((left, right) => left - right);
}

function foldersNoteIDs(notes) {
  return listNoteIDsByLabel(notes, DEFAULT_FOLDERS_LABEL);
}

function reserveNextNoteID(table) {
  const nextNoteID = toPositiveInt(table && table._meta && table._meta.nextNoteID, 1);
  if (!table || !table._meta) {
    return 0;
  }

  table._meta.nextNoteID = nextNoteID + 1;
  const writeResult = database.write(TABLE_NAME, "/_meta/nextNoteID", table._meta.nextNoteID);
  return writeResult && writeResult.success ? nextNoteID : 0;
}

function writeOwnerNote(characterKey, entry) {
  return database.write(
    TABLE_NAME,
    ownerNotePath(characterKey, entry.noteID),
    entry,
  );
}

function ensureDefaultFoldersNote(characterID) {
  const context = ensureCharacterBucket(characterID);
  if (!context) {
    return false;
  }

  const { table, bucket, characterKey } = context;
  if (foldersNoteIDs(bucket.notes).length > 0) {
    return true;
  }

  const noteID = reserveNextNoteID(table);
  if (!noteID) {
    return false;
  }

  const timestamp = nowFileTimeString();
  const entry = {
    noteID,
    label: DEFAULT_FOLDERS_LABEL,
    note: DEFAULT_FOLDERS_NOTE,
    created: timestamp,
    updated: timestamp,
  };
  bucket.notes[String(noteID)] = entry;

  const writeResult = writeOwnerNote(characterKey, entry);
  return Boolean(writeResult && writeResult.success);
}

function listOwnerNotes(characterID) {
  if (!ensureDefaultFoldersNote(characterID)) {
    return [];
  }

  const context = ensureCharacterBucket(characterID);
  if (!context) {
    return [];
  }

  return Object.values(context.bucket.notes)
    .map((entry) => noteSummary(entry))
    .filter((entry) => entry.noteID > 0)
    .sort((left, right) => left.noteID - right.noteID);
}

function getOwnerNote(characterID, noteID) {
  const numericCharacterID = toPositiveInt(characterID, 0);
  const numericNoteID = toPositiveInt(noteID, 0);
  if (!numericCharacterID || !numericNoteID) {
    return null;
  }

  const context = ensureCharacterBucket(numericCharacterID);
  if (!context) {
    return null;
  }

  const entry = context.bucket.notes[String(numericNoteID)];
  return entry && typeof entry === "object" ? noteSummary(entry) : null;
}

function addOwnerNote(characterID, label, noteText) {
  const context = ensureCharacterBucket(characterID);
  if (!context) {
    return 0;
  }

  const { table, bucket, characterKey } = context;
  const noteID = reserveNextNoteID(table);
  if (!noteID) {
    return 0;
  }

  const timestamp = nowFileTimeString();
  const entry = {
    noteID,
    label: toText(label, ""),
    note: toText(noteText, ""),
    created: timestamp,
    updated: timestamp,
  };
  bucket.notes[String(noteID)] = entry;

  const writeResult = writeOwnerNote(characterKey, entry);
  return writeResult && writeResult.success ? noteID : 0;
}

function editOwnerNote(characterID, noteID, label, noteText) {
  const numericNoteID = toPositiveInt(noteID, 0);
  if (!numericNoteID) {
    return false;
  }

  const context = ensureCharacterBucket(characterID);
  if (!context) {
    return false;
  }

  const { bucket, characterKey, characterID: numericCharacterID } = context;
  const existing = bucket.notes[String(numericNoteID)];
  if (!existing || typeof existing !== "object") {
    return false;
  }

  const previousLabel = toText(existing.label, "");
  const updatedEntry = {
    ...existing,
    noteID: numericNoteID,
    label: label !== undefined ? toText(label, previousLabel) : previousLabel,
    note: noteText !== undefined ? toText(noteText, toText(existing.note, "")) : toText(existing.note, ""),
    created: toText(existing.created, nowFileTimeString()),
    updated: nowFileTimeString(),
  };

  bucket.notes[String(numericNoteID)] = updatedEntry;
  const writeResult = writeOwnerNote(characterKey, updatedEntry);
  if (!writeResult || !writeResult.success) {
    return false;
  }

  if (
    previousLabel === DEFAULT_FOLDERS_LABEL &&
    updatedEntry.label !== DEFAULT_FOLDERS_LABEL &&
    foldersNoteIDs(bucket.notes).length === 0
  ) {
    ensureDefaultFoldersNote(numericCharacterID);
  }

  return true;
}

function removeOwnerNote(characterID, noteID) {
  const numericNoteID = toPositiveInt(noteID, 0);
  if (!numericNoteID) {
    return false;
  }

  const context = ensureCharacterBucket(characterID);
  if (!context) {
    return false;
  }

  const { bucket, characterKey, characterID: numericCharacterID } = context;
  const existing = bucket.notes[String(numericNoteID)];
  if (!existing || typeof existing !== "object") {
    return true;
  }

  const existingLabel = toText(existing.label, "");
  if (existingLabel === DEFAULT_FOLDERS_LABEL && foldersNoteIDs(bucket.notes).length <= 1) {
    const updatedEntry = {
      ...existing,
      noteID: numericNoteID,
      label: DEFAULT_FOLDERS_LABEL,
      note: DEFAULT_FOLDERS_NOTE,
      created: toText(existing.created, nowFileTimeString()),
      updated: nowFileTimeString(),
    };
    bucket.notes[String(numericNoteID)] = updatedEntry;
    const writeResult = writeOwnerNote(characterKey, updatedEntry);
    return Boolean(writeResult && writeResult.success);
  }

  const removeResult = database.remove(
    TABLE_NAME,
    ownerNotePath(characterKey, numericNoteID),
  );
  if (
    !removeResult ||
    (!removeResult.success && removeResult.errorMsg !== "ENTRY_NOT_FOUND")
  ) {
    return false;
  }

  if (
    existingLabel === DEFAULT_FOLDERS_LABEL &&
    foldersNoteIDs(bucket.notes).length === 0
  ) {
    return ensureDefaultFoldersNote(numericCharacterID);
  }

  return true;
}

function getEntityNote(characterID, itemID) {
  const numericItemID = toPositiveInt(itemID, 0);
  if (!toPositiveInt(characterID, 0) || !numericItemID) {
    return "";
  }

  const context = ensureCharacterBucket(characterID);
  if (!context) {
    return "";
  }

  const entry = context.bucket.itemNotes[String(numericItemID)];
  if (entry && typeof entry === "object") {
    return toText(entry.note, "");
  }

  return toText(entry, "");
}

function setEntityNote(characterID, itemID, noteText) {
  const numericItemID = toPositiveInt(itemID, 0);
  if (!toPositiveInt(characterID, 0) || !numericItemID) {
    return false;
  }

  const context = ensureCharacterBucket(characterID);
  if (!context) {
    return false;
  }

  const { bucket, characterKey } = context;
  const normalizedText = toText(noteText, "");

  if (normalizedText === "") {
    delete bucket.itemNotes[String(numericItemID)];
    const removeResult = database.remove(
      TABLE_NAME,
      itemNotePath(characterKey, numericItemID),
    );
    return Boolean(
      removeResult &&
      (removeResult.success || removeResult.errorMsg === "ENTRY_NOT_FOUND")
    );
  }

  const entry = {
    itemID: numericItemID,
    note: normalizedText,
    updated: nowFileTimeString(),
  };
  bucket.itemNotes[String(numericItemID)] = entry;

  const writeResult = database.write(
    TABLE_NAME,
    itemNotePath(characterKey, numericItemID),
    entry,
  );
  return Boolean(writeResult && writeResult.success);
}

module.exports = {
  listOwnerNotes,
  getOwnerNote,
  addOwnerNote,
  editOwnerNote,
  removeOwnerNote,
  getEntityNote,
  setEntityNote,
};
