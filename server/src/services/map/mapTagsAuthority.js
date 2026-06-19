"use strict";

const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));

const MAP_TAGS_CDN_PATH = "/elysian-eve/map-tags/latest.maptags";
const MAP_TAGS_CDN_URL = `https://127.0.0.1${MAP_TAGS_CDN_PATH}`;

let cache = null;
let crcTable = null;

function logDataLoad(message) {
  const writer =
    (log && typeof log.dataLoad === "function" && log.dataLoad.bind(log)) ||
    (log && typeof log.info === "function" && log.info.bind(log)) ||
    null;
  if (writer) {
    writer(message);
  }
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSemver(value) {
  const source = normalizeObject(value);
  return {
    major: Math.max(0, Number(source.major) || 0),
    minor: Math.max(0, Number(source.minor) || 0),
    patch: Math.max(0, Number(source.patch) || 0),
    prerelease_tags: normalizeArray(source.prerelease_tags)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean),
    build_tags: normalizeArray(source.build_tags)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean),
  };
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(buffer) {
  if (!crcTable) {
    crcTable = buildCrcTable();
  }
  let crc = 0xffffffff;
  for (const byte of Buffer.from(buffer || [])) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

class MiniFlatBufferBuilder {
  constructor(initialSize = 1024) {
    this.bytes = Buffer.alloc(initialSize);
    this.space = initialSize;
    this.minalign = 1;
    this.vtable = null;
    this.objectStart = 0;
    this.vectorNumElems = 0;
  }

  offset() {
    return this.bytes.length - this.space;
  }

  grow() {
    const oldBuffer = this.bytes;
    const oldLength = oldBuffer.length;
    const nextBuffer = Buffer.alloc(oldLength * 2);
    oldBuffer.copy(nextBuffer, nextBuffer.length - oldLength);
    this.space += nextBuffer.length - oldLength;
    this.bytes = nextBuffer;
  }

  prep(size, additionalBytes) {
    if (size > this.minalign) {
      this.minalign = size;
    }
    const alignSize =
      (~(this.bytes.length - this.space + additionalBytes) + 1) & (size - 1);
    while (this.space < alignSize + size + additionalBytes) {
      this.grow();
    }
    this.pad(alignSize);
  }

  pad(byteCount) {
    for (let index = 0; index < byteCount; index += 1) {
      this.bytes[--this.space] = 0;
    }
  }

  putUint8(value) {
    this.bytes[--this.space] = Number(value || 0) & 0xff;
  }

  putUint16(value) {
    this.space -= 2;
    this.bytes.writeUInt16LE(Number(value || 0) & 0xffff, this.space);
  }

  putInt32(value) {
    this.space -= 4;
    this.bytes.writeInt32LE(Number(value || 0), this.space);
  }

  putUint32(value) {
    this.space -= 4;
    this.bytes.writeUInt32LE(Number(value || 0) >>> 0, this.space);
  }

  putUint64(value) {
    const numeric = BigInt(Math.max(0, Math.trunc(Number(value) || 0)));
    this.space -= 8;
    this.bytes.writeBigUInt64LE(numeric, this.space);
  }

  prependUint32(value) {
    this.prep(4, 0);
    this.putUint32(value);
  }

  prependInt32(value) {
    this.prep(4, 0);
    this.putInt32(value);
  }

  prependUint64(value) {
    this.prep(8, 0);
    this.putUint64(value);
  }

  prependUOffsetRelative(offset) {
    this.prep(4, 0);
    this.putUint32(this.offset() - Number(offset || 0) + 4);
  }

  startObject(fieldCount) {
    this.vtable = new Array(fieldCount).fill(0);
    this.objectStart = this.offset();
  }

  slot(fieldIndex) {
    this.vtable[fieldIndex] = this.offset();
  }

  prependUOffsetRelativeSlot(fieldIndex, offset, defaultValue = 0) {
    if (offset !== defaultValue) {
      this.prependUOffsetRelative(offset);
      this.slot(fieldIndex);
    }
  }

  prependUint64Slot(fieldIndex, value, defaultValue = 0) {
    if (Number(value || 0) !== defaultValue) {
      this.prependUint64(value);
      this.slot(fieldIndex);
    }
  }

  endObject() {
    this.prependInt32(0);
    const objectOffset = this.offset();
    for (let index = this.vtable.length - 1; index >= 0; index -= 1) {
      const fieldOffset = this.vtable[index];
      this.putUint16(fieldOffset ? objectOffset - fieldOffset : 0);
    }
    this.putUint16(objectOffset - this.objectStart);
    this.putUint16((this.vtable.length + 2) * 2);
    const vtableOffset = this.offset();
    this.bytes.writeInt32LE(vtableOffset - objectOffset, this.bytes.length - objectOffset);
    this.vtable = null;
    return objectOffset;
  }

  startVector(elemSize, numElems, alignment) {
    this.vectorNumElems = numElems;
    this.prep(4, elemSize * numElems);
    this.prep(alignment, elemSize * numElems);
  }

  endVector() {
    this.prependUint32(this.vectorNumElems);
    return this.offset();
  }

  createString(value) {
    const encoded = Buffer.from(String(value || ""), "utf8");
    this.prep(4, encoded.length + 1);
    this.prep(1, encoded.length + 1);
    this.putUint8(0);
    this.space -= encoded.length;
    encoded.copy(this.bytes, this.space);
    this.vectorNumElems = encoded.length;
    return this.endVector();
  }

  finish(rootTable) {
    this.prep(this.minalign, 4);
    this.prependUOffsetRelative(rootTable);
    this.bytes = this.bytes.subarray(this.space);
    this.space = 0;
  }

  output() {
    return Buffer.from(this.bytes);
  }
}

function normalizeTagRows(value) {
  const rows = normalizeArray(value);
  return rows
    .map((row) => ({
      containerID: Math.max(
        0,
        Math.trunc(Number(row && (row.containerID || row.containerId || row.id)) || 0),
      ),
      tags: normalizeArray(row && row.tags)
        .map((tag) => String(tag || "").trim())
        .filter(Boolean),
    }))
    .filter((row) => row.containerID > 0 && row.tags.length > 0)
    .sort((left, right) => left.containerID - right.containerID);
}

function createTagsVector(builder, tagOffsets) {
  builder.startVector(4, tagOffsets.length, 4);
  for (let index = tagOffsets.length - 1; index >= 0; index -= 1) {
    builder.prependUOffsetRelative(tagOffsets[index]);
  }
  return builder.endVector();
}

function createContainerTable(builder, row, tagStringOffsets) {
  const tagOffsets = row.tags.map((tag) => tagStringOffsets.get(tag)).filter(Boolean);
  const tagsVector = createTagsVector(builder, tagOffsets);
  builder.startObject(2);
  builder.prependUOffsetRelativeSlot(1, tagsVector, 0);
  builder.prependUint64Slot(0, row.containerID, 0);
  return builder.endObject();
}

function createContainerVector(builder, rows, tagStringOffsets) {
  const tables = rows.map((row) => createContainerTable(builder, row, tagStringOffsets));
  builder.startVector(4, tables.length, 4);
  for (let index = tables.length - 1; index >= 0; index -= 1) {
    builder.prependUOffsetRelative(tables[index]);
  }
  return builder.endVector();
}

function buildMapTagsFlatbuffer(payload) {
  const source = normalizeObject(payload);
  const systems = normalizeTagRows(source.systems);
  const constellations = normalizeTagRows(source.constellations);
  const regions = normalizeTagRows(source.regions);
  const tags = [...new Set(
    [...systems, ...constellations, ...regions].flatMap((row) => row.tags),
  )].sort((left, right) => left.localeCompare(right));

  const builder = new MiniFlatBufferBuilder();
  const tagStringOffsets = new Map();
  for (const tag of tags) {
    tagStringOffsets.set(tag, builder.createString(tag));
  }

  const systemsVector = createContainerVector(builder, systems, tagStringOffsets);
  const constellationsVector =
    createContainerVector(builder, constellations, tagStringOffsets);
  const regionsVector = createContainerVector(builder, regions, tagStringOffsets);

  builder.startObject(3);
  builder.prependUOffsetRelativeSlot(2, systemsVector, 0);
  builder.prependUOffsetRelativeSlot(1, constellationsVector, 0);
  builder.prependUOffsetRelativeSlot(0, regionsVector, 0);
  const universe = builder.endObject();
  builder.finish(universe);
  return {
    buffer: builder.output(),
    counts: {
      systems: systems.length,
      constellations: constellations.length,
      regions: regions.length,
      tags: tags.length,
    },
  };
}

function buildCache() {
  const payload = readStaticTable(TABLE.MAP_TAGS_AUTHORITY);
  const version = normalizeSemver(payload.version || { major: 1, minor: 0, patch: 0 });
  const built = buildMapTagsFlatbuffer(payload);
  const crc = crc32(built.buffer);
  return {
    payload,
    buffer: built.buffer,
    version,
    crc,
    counts: Object.freeze(built.counts),
  };
}

function ensureLoaded() {
  if (!cache) {
    cache = buildCache();
    logDataLoad(
      `[MapTagsAuthority] Loaded map tags systems=${cache.counts.systems} ` +
      `constellations=${cache.counts.constellations} regions=${cache.counts.regions} ` +
      `tags=${cache.counts.tags} bytes=${cache.buffer.length} crc=${cache.crc}.`,
    );
  }
  return cache;
}

function getMapTagsAsset() {
  return Buffer.from(ensureLoaded().buffer);
}

function getMapTagsCrc() {
  return ensureLoaded().crc;
}

function getMapTagsVersion() {
  return JSON.parse(JSON.stringify(ensureLoaded().version));
}

function getMapTagsSummary() {
  const loaded = ensureLoaded();
  return {
    version: getMapTagsVersion(),
    crc: loaded.crc,
    byteLength: loaded.buffer.length,
    counts: { ...loaded.counts },
  };
}

function clearCache() {
  cache = null;
}

module.exports = {
  MAP_TAGS_CDN_PATH,
  MAP_TAGS_CDN_URL,
  buildMapTagsFlatbuffer,
  clearCache,
  crc32,
  getMapTagsAsset,
  getMapTagsCrc,
  getMapTagsSummary,
  getMapTagsVersion,
};
