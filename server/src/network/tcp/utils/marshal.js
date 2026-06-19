/**
 * EVE Online Marshal Protocol - Encoder & Decoder
 *
 * Based on EVEmu's EVEMarshalOpcodes.h, EVEMarshal.cpp, and EVEUnmarshal.cpp.
 * Implements the full marshal format for the Crucible protocol.
 *
 * Wire format:
 *   Packet = [4-byte LE payloadLen] [payload]
 *   Payload = [0x7E magic] [4-byte LE mapcount=0] [marshaled data]
 */

const path = require("path");
const { lookupIndex, lookupString, STRING_TABLE_ERROR } = require(
  path.join(__dirname, "../../../common/marshalStringTable"),
);

// ─── Opcodes ────────────────────────────────────────────────────────────────
const Op = {
  PyNone: 0x01,
  PyToken: 0x02,
  PyLongLong: 0x03, // int64
  PyLong: 0x04, // int32
  PySignedShort: 0x05, // int16
  PyByte: 0x06, // int8
  PyMinusOne: 0x07,
  PyZeroInteger: 0x08,
  PyOneInteger: 0x09,
  PyReal: 0x0a, // float64
  PyZeroReal: 0x0b,
  PyBuffer: 0x0d,
  PyEmptyString: 0x0e,
  PyCharString: 0x0f,
  PyShortString: 0x10,
  PyStringTableItem: 0x11,
  PyWStringUCS2: 0x12,
  PyLongString: 0x13,
  PyTuple: 0x14,
  PyList: 0x15,
  PyDict: 0x16,
  PyObject: 0x17,
  PySubStruct: 0x19,
  PySavedStreamElement: 0x1b,
  PyChecksumedStream: 0x1c,
  PyTrue: 0x1f,
  PyFalse: 0x20,
  cPicked: 0x21,
  PyObjectEx1: 0x22,
  PyObjectEx2: 0x23,
  PyEmptyTuple: 0x24,
  PyOneTuple: 0x25,
  PyEmptyList: 0x26,
  PyOneList: 0x27,
  PyEmptyWString: 0x28,
  PyWStringUCS2Char: 0x29,
  PyPackedRow: 0x2a,
  PySubStream: 0x2b,
  PyTwoTuple: 0x2c,
  PackedTerminator: 0x2d,
  PyWStringUTF8: 0x2e,
  PyVarInteger: 0x2f,
};

const MARSHAL_HEADER = 0x7e;
const SAVE_MASK = 0x40;
const OPCODE_MASK = 0x3f;
const UNKNOWN_MASK = 0x80;
const DBTYPE = {
  EMPTY: 0x00,
  I2: 0x02,
  I4: 0x03,
  R4: 0x04,
  R8: 0x05,
  CY: 0x06,
  ERROR: 0x0a,
  BOOL: 0x0b,
  I1: 0x10,
  UI1: 0x11,
  UI2: 0x12,
  UI4: 0x13,
  I8: 0x14,
  UI8: 0x15,
  FILETIME: 0x40,
  BYTES: 0x80,
  STR: 0x81,
  WSTR: 0x82,
};

// ═══════════════════════════════════════════════════════════════════════════
//  ENCODER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Encode a JS value into a marshaled byte stream (with 0x7E header).
 * Returns a Buffer containing just the marshaled data (no packet framing).
 *
 * Supported value types:
 *   null / undefined         → PyNone
 *   boolean                  → PyTrue / PyFalse
 *   number (integer)         → PyByte / PySignedShort / PyLong / PyLongLong
 *   number (float)           → PyReal
 *   string                   → PyStringTableItem / PyLongString (UTF-8)
 *   Buffer                   → PyBuffer
 *   { type: 'bytes', value: Buffer|Uint8Array } → PyString/PyLongString raw bytes
 *   { type: 'rawstr', value: '...' }            → PyString/PyLongString UTF-8, bypass string table
 *   Array                    → PyTuple
 *   { type: 'dict', entries: [[k,v], ...] }  → PyDict
 *   { type: 'wstring', value: '...' }        → PyWStringUTF8
 *   { type: 'long', value: BigInt|number }   → PyLongLong
 *   { type: 'real', value: number }          → PyReal
 *   { type: 'list', items: [...] }           → PyList
 *   { type: 'object', name: '...', args: {} }→ PyObject (token + dict)
 *   { type: 'substruct', value: ... }        → PySubStruct
 *   { type: 'substream', value: ... }        → PySubStream
 */
function marshalEncode(value) {
  const chunks = [];

  // Stream header
  chunks.push(Buffer.from([MARSHAL_HEADER]));
  // Mapcount = 0
  const mc = Buffer.alloc(4);
  mc.writeUInt32LE(0, 0);
  chunks.push(mc);

  // Encode the root value
  encodeValue(value, chunks);

  return Buffer.concat(chunks);
}

function putSizeEx(size, chunks) {
  if (size < 0xff) {
    chunks.push(Buffer.from([size & 0xff]));
  } else {
    const buf = Buffer.alloc(5);
    buf[0] = 0xff;
    buf.writeUInt32LE(size, 1);
    chunks.push(buf);
  }
}

function encodeValue(value, chunks) {
  // null / undefined → PyNone
  if (value === null || value === undefined) {
    chunks.push(Buffer.from([Op.PyNone]));
    return;
  }

  // Boolean → PyTrue / PyFalse
  if (typeof value === "boolean") {
    chunks.push(Buffer.from([value ? Op.PyTrue : Op.PyFalse]));
    return;
  }

  // Number
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      encodeInteger(value, chunks);
    } else {
      // Float
      if (value === 0.0) {
        chunks.push(Buffer.from([Op.PyZeroReal]));
      } else {
        const buf = Buffer.alloc(9);
        buf[0] = Op.PyReal;
        buf.writeDoubleLE(value, 1);
        chunks.push(buf);
      }
    }
    return;
  }

  // BigInt → int64
  if (typeof value === "bigint") {
    const buf = Buffer.alloc(9);
    buf[0] = Op.PyLongLong;
    buf.writeBigInt64LE(value, 1);
    chunks.push(buf);
    return;
  }

  // String → try string table first, then PyLongString
  if (typeof value === "string") {
    const strBuf = Buffer.from(value, "utf8");
    if (strBuf.length === 0) {
      chunks.push(Buffer.from([Op.PyEmptyString]));
    } else if (strBuf.length === 1) {
      chunks.push(Buffer.from([Op.PyCharString, strBuf[0]]));
    } else {
      // Check string table for efficient encoding
      const tableIdx = lookupIndex(value);
      if (tableIdx > STRING_TABLE_ERROR) {
        chunks.push(Buffer.from([Op.PyStringTableItem, tableIdx]));
      } else {
        chunks.push(Buffer.from([Op.PyLongString]));
        putSizeEx(strBuf.length, chunks);
        chunks.push(strBuf);
      }
    }
    return;
  }

  // Buffer → PyBuffer
  if (Buffer.isBuffer(value)) {
    chunks.push(Buffer.from([Op.PyBuffer]));
    putSizeEx(value.length, chunks);
    chunks.push(value);
    return;
  }

  // Array → PyTuple
  if (Array.isArray(value)) {
    encodeTuple(value, chunks);
    return;
  }

  // Object with type descriptor
  if (typeof value === "object" && value.type) {
    switch (value.type) {
      case "dict":
        encodeDict(value.entries, chunks);
        return;
      case "wstring":
        encodeWString(value.value, chunks);
        return;
      case "long":
        encodeLong(value.value, chunks);
        return;
      case "real": {
        const numeric = Number(value.value);
        if (!Number.isFinite(numeric) || numeric === 0.0) {
          chunks.push(Buffer.from([Op.PyZeroReal]));
        } else {
          const buf = Buffer.alloc(9);
          buf[0] = Op.PyReal;
          buf.writeDoubleLE(numeric, 1);
          chunks.push(buf);
        }
        return;
      }
      case "tuple":
        encodeTuple(Array.isArray(value.items) ? value.items : [], chunks);
        return;
      case "list":
        encodeList(value.items, chunks);
        return;
      case "bytes": {
        const rawBytes = Buffer.isBuffer(value.value)
          ? value.value
          : Buffer.from(value.value || []);
        if (rawBytes.length === 0) {
          chunks.push(Buffer.from([Op.PyEmptyString]));
        } else if (rawBytes.length === 1) {
          const buf = Buffer.alloc(2);
          buf[0] = Op.PyCharString;
          rawBytes.copy(buf, 1, 0, 1);
          chunks.push(buf);
        } else if (rawBytes.length < 0x100) {
          const header = Buffer.alloc(2);
          header[0] = Op.PyShortString;
          header[1] = rawBytes.length;
          chunks.push(header);
          chunks.push(rawBytes);
        } else {
          chunks.push(Buffer.from([Op.PyLongString]));
          putSizeEx(rawBytes.length, chunks);
          chunks.push(rawBytes);
        }
        return;
      }
      case "rawstr": {
        const rawStringBytes = Buffer.from(String(value.value ?? ""), "utf8");
        if (rawStringBytes.length === 0) {
          chunks.push(Buffer.from([Op.PyEmptyString]));
        } else if (rawStringBytes.length === 1) {
          const buf = Buffer.alloc(2);
          buf[0] = Op.PyCharString;
          rawStringBytes.copy(buf, 1, 0, 1);
          chunks.push(buf);
        } else if (rawStringBytes.length < 0x100) {
          const header = Buffer.alloc(2);
          header[0] = Op.PyShortString;
          header[1] = rawStringBytes.length;
          chunks.push(header);
          chunks.push(rawStringBytes);
        } else {
          chunks.push(Buffer.from([Op.PyLongString]));
          putSizeEx(rawStringBytes.length, chunks);
          chunks.push(rawStringBytes);
        }
        return;
      }
      case "object":
        encodeObject(value, chunks);
        return;
      case "packedrow":
        encodePackedRow(value, chunks);
        return;
      case "substruct":
        chunks.push(Buffer.from([Op.PySubStruct]));
        encodeValue(value.value, chunks);
        return;
      case "substream": {
        chunks.push(Buffer.from([Op.PySubStream]));
        // Marshal the inner value
        const innerChunks = [];
        innerChunks.push(Buffer.from([MARSHAL_HEADER]));
        const mc2 = Buffer.alloc(4);
        mc2.writeUInt32LE(0, 0);
        innerChunks.push(mc2);
        encodeValue(value.value, innerChunks);
        const innerBuf = Buffer.concat(innerChunks);
        putSizeEx(innerBuf.length, chunks);
        chunks.push(innerBuf);
        return;
      }
      case "token": {
        const tokenBuf = Buffer.from(value.value, "utf8");
        chunks.push(Buffer.from([Op.PyToken]));
        putSizeEx(tokenBuf.length, chunks);
        chunks.push(tokenBuf);
        return;
      }
      case "objectex1":
      case "objectex2": {
        chunks.push(
          Buffer.from([
            value.type === "objectex1" ? Op.PyObjectEx1 : Op.PyObjectEx2,
          ]),
        );
        encodeValue(value.header, chunks);
        // Encode list elements
        if (value.list) {
          for (const item of value.list) {
            encodeValue(item, chunks);
          }
        }
        chunks.push(Buffer.from([Op.PackedTerminator]));
        // Encode dict elements
        if (value.dict) {
          for (const [key, val] of value.dict) {
            encodeValue(key, chunks);
            encodeValue(val, chunks);
          }
        }
        chunks.push(Buffer.from([Op.PackedTerminator]));
        return;
      }
      case "cpicked": {
        // Embed raw Python pickle bytes in the marshal stream.
        // The client's unmarshal uses cPickle.loads() to decode this,
        // which bypasses the EVE marshal token whitelist.
        const pickleBuf = Buffer.isBuffer(value.data)
          ? value.data
          : Buffer.from(value.data);
        chunks.push(Buffer.from([Op.cPicked]));
        putSizeEx(pickleBuf.length, chunks);
        chunks.push(pickleBuf);
        return;
      }
      default:
        throw new Error(`Unknown marshal type: ${value.type}`);
    }
  }

  throw new Error(
    `Cannot marshal value: ${typeof value} ${JSON.stringify(value)}`,
  );
}

function encodeInteger(val, chunks) {
  if (val === -1) {
    chunks.push(Buffer.from([Op.PyMinusOne]));
  } else if (val === 0) {
    chunks.push(Buffer.from([Op.PyZeroInteger]));
  } else if (val === 1) {
    chunks.push(Buffer.from([Op.PyOneInteger]));
  } else if (val >= -128 && val <= 127) {
    const buf = Buffer.alloc(2);
    buf[0] = Op.PyByte;
    buf.writeInt8(val, 1);
    chunks.push(buf);
  } else if (val >= -32768 && val <= 32767) {
    const buf = Buffer.alloc(3);
    buf[0] = Op.PySignedShort;
    buf.writeInt16LE(val, 1);
    chunks.push(buf);
  } else if (val >= -2147483648 && val <= 2147483647) {
    const buf = Buffer.alloc(5);
    buf[0] = Op.PyLong;
    buf.writeInt32LE(val, 1);
    chunks.push(buf);
  } else {
    // Fall back to int64
    const buf = Buffer.alloc(9);
    buf[0] = Op.PyLongLong;
    buf.writeBigInt64LE(BigInt(val), 1);
    chunks.push(buf);
  }
}

function encodeLong(val, chunks) {
  const bigVal = typeof val === "bigint" ? val : BigInt(val);
  const buf = Buffer.alloc(9);
  buf[0] = Op.PyLongLong;
  buf.writeBigInt64LE(bigVal, 1);
  chunks.push(buf);
}

function encodeTuple(arr, chunks) {
  if (arr.length === 0) {
    chunks.push(Buffer.from([Op.PyEmptyTuple]));
  } else if (arr.length === 1) {
    chunks.push(Buffer.from([Op.PyOneTuple]));
  } else if (arr.length === 2) {
    chunks.push(Buffer.from([Op.PyTwoTuple]));
  } else {
    chunks.push(Buffer.from([Op.PyTuple]));
    putSizeEx(arr.length, chunks);
  }
  for (const item of arr) {
    encodeValue(item, chunks);
  }
}

function encodeList(arr, chunks) {
  if (!arr || arr.length === 0) {
    chunks.push(Buffer.from([Op.PyEmptyList]));
  } else if (arr.length === 1) {
    chunks.push(Buffer.from([Op.PyOneList]));
    encodeValue(arr[0], chunks);
  } else {
    chunks.push(Buffer.from([Op.PyList]));
    putSizeEx(arr.length, chunks);
    for (const item of arr) {
      encodeValue(item, chunks);
    }
  }
}

function encodeDict(entries, chunks) {
  chunks.push(Buffer.from([Op.PyDict]));
  putSizeEx(entries.length, chunks);
  // EVE marshal writes VALUE first, then KEY (reversed from what you'd expect)
  for (const [key, val] of entries) {
    encodeValue(val, chunks);
    encodeValue(key, chunks);
  }
}

function encodeWString(str, chunks) {
  if (!str || str.length === 0) {
    chunks.push(Buffer.from([Op.PyEmptyWString]));
    return;
  }
  const strBuf = Buffer.from(str, "utf8");
  chunks.push(Buffer.from([Op.PyWStringUTF8]));
  putSizeEx(strBuf.length, chunks);
  chunks.push(strBuf);
}

function encodeObject(obj, chunks) {
  // PyObject = Op_PyObject + type_name_as_string + args
  // In C++ EVEmu, the type name (PyToken) is encoded as a regular string
  // through the visitor pattern — NOT as Op.PyToken (0x02).
  chunks.push(Buffer.from([Op.PyObject]));
  // Encode type name as a regular string (will use string table if available)
  encodeValue(obj.name, chunks);
  // Args
  encodeValue(obj.args, chunks);
}

function getDbTypeSizeBits(type) {
  switch (type) {
    case DBTYPE.CY:
    case DBTYPE.I8:
    case DBTYPE.UI8:
    case DBTYPE.FILETIME:
      return 64;
    case DBTYPE.I4:
    case DBTYPE.UI4:
    case DBTYPE.R4:
      return 32;
    case DBTYPE.R8:
      return 64;
    case DBTYPE.I2:
    case DBTYPE.UI2:
      return 16;
    case DBTYPE.I1:
    case DBTYPE.UI1:
      return 8;
    case DBTYPE.BOOL:
      return 1;
    case DBTYPE.BYTES:
    case DBTYPE.STR:
    case DBTYPE.WSTR:
    case DBTYPE.EMPTY:
    case DBTYPE.ERROR:
    default:
      return 0;
  }
}

function normalizePackedRowColumns(packedRow) {
  if (Array.isArray(packedRow.columns)) {
    return packedRow.columns;
  }

  const header = packedRow.header;
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

  throw new Error("Packed row is missing DBRowDescriptor columns");
}

function normalizePackedRowVirtualColumns(rowHeader) {
  const virtualColumnPayload =
    rowHeader &&
    rowHeader.type &&
    (rowHeader.type === "objectex1" || rowHeader.type === "objectex2") &&
    Array.isArray(rowHeader.header) &&
    rowHeader.header.length >= 3
      ? rowHeader.header[2]
      : null;
  if (
    virtualColumnPayload &&
    virtualColumnPayload.type === "list" &&
    Array.isArray(virtualColumnPayload.items)
  ) {
    return virtualColumnPayload.items;
  }
  if (Array.isArray(virtualColumnPayload)) {
    return virtualColumnPayload;
  }
  return [];
}

function normalizePackedVirtualResolver(column) {
  if (!Array.isArray(column)) {
    return "";
  }
  const resolver = column[1];
  if (!resolver) {
    return "";
  }
  if (typeof resolver === "string") {
    return resolver;
  }
  if (Buffer.isBuffer(resolver)) {
    return resolver.toString("utf8");
  }
  if (typeof resolver.value === "string") {
    return resolver.value;
  }
  if (Buffer.isBuffer(resolver.value)) {
    return resolver.value.toString("utf8");
  }
  return "";
}

function derivePackedStackSize(fields) {
  const quantity = Number(fields && fields.quantity);
  if (!Number.isFinite(quantity)) {
    return 0;
  }
  return quantity < 0 ? 1 : quantity;
}

function derivePackedSingleton(fields) {
  const quantity = Number(fields && fields.quantity);
  if (Number.isFinite(quantity) && quantity < 0) {
    return -quantity;
  }
  const locationID = Number(fields && fields.locationID);
  return Number.isFinite(locationID) &&
    locationID >= 30000000 &&
    locationID < 40000000
    ? 1
    : 0;
}

function applyPackedRowVirtualFields(fields, rowHeader) {
  for (const column of normalizePackedRowVirtualColumns(rowHeader)) {
    if (!Array.isArray(column)) {
      continue;
    }
    const columnName = normalizePackedColumnName(column[0], "");
    if (!columnName) {
      continue;
    }
    const resolver = normalizePackedVirtualResolver(column);
    if (resolver === "eve.common.script.sys.eveCfg.StackSize") {
      fields[columnName] = derivePackedStackSize(fields);
    } else if (resolver === "eve.common.script.sys.eveCfg.Singleton") {
      fields[columnName] = derivePackedSingleton(fields);
    }
  }
}

function normalizePackedRowValueMap(packedRow, columns) {
  if (Array.isArray(packedRow.values)) {
    if (packedRow.values.length !== columns.length) {
      throw new Error(
        `Packed row values length ${packedRow.values.length} does not match column count ${columns.length}`,
      );
    }
    return packedRow.values;
  }

  if (packedRow.fields && typeof packedRow.fields === "object") {
    return columns.map(([name]) =>
      Object.prototype.hasOwnProperty.call(packedRow.fields, name)
        ? packedRow.fields[name]
        : null,
    );
  }

  throw new Error("Packed row is missing values or fields");
}

function unwrapPackedScalarValue(value) {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (
    value.type === "int" ||
    value.type === "long" ||
    value.type === "float" ||
    value.type === "double" ||
    value.type === "bool" ||
    value.type === "wstring" ||
    value.type === "token" ||
    value.type === "rawstr"
  ) {
    return unwrapPackedScalarValue(value.value);
  }

  return value;
}

function normalizePackedBigInt(value, fallback = 0n) {
  const normalized = unwrapPackedScalarValue(value);

  try {
    if (typeof normalized === "bigint") {
      return normalized;
    }

    if (normalized === null || normalized === undefined) {
      return fallback;
    }

    if (typeof normalized === "number") {
      return Number.isFinite(normalized) ? BigInt(Math.trunc(normalized)) : fallback;
    }

    if (typeof normalized === "boolean") {
      return normalized ? 1n : 0n;
    }

    if (Buffer.isBuffer(normalized)) {
      const text = normalized.toString("utf8").trim();
      return text ? BigInt(text) : fallback;
    }

    if (typeof normalized === "string") {
      const text = normalized.trim();
      return text ? BigInt(text) : fallback;
    }
  } catch (error) {
    return fallback;
  }

  return fallback;
}

function normalizePackedNumber(value, fallback = 0) {
  const normalized = unwrapPackedScalarValue(value);

  if (normalized === null || normalized === undefined) {
    return fallback;
  }

  if (typeof normalized === "number") {
    return Number.isFinite(normalized) ? normalized : fallback;
  }

  if (typeof normalized === "bigint") {
    const coerced = Number(normalized);
    return Number.isFinite(coerced) ? coerced : fallback;
  }

  if (typeof normalized === "boolean") {
    return normalized ? 1 : 0;
  }

  if (Buffer.isBuffer(normalized)) {
    return normalizePackedNumber(normalized.toString("utf8"), fallback);
  }

  if (typeof normalized === "string") {
    const numericValue = Number(normalized);
    return Number.isFinite(numericValue) ? numericValue : fallback;
  }

  return fallback;
}

function normalizePackedBoolean(value) {
  const normalized = unwrapPackedScalarValue(value);

  if (typeof normalized === "boolean") {
    return normalized;
  }

  if (normalized === null || normalized === undefined) {
    return false;
  }

  return Boolean(normalizePackedNumber(normalized, 0));
}

function encodePackedNumericValue(type, value) {
  switch (type) {
    case DBTYPE.CY:
    case DBTYPE.I8:
    case DBTYPE.UI8:
    case DBTYPE.FILETIME: {
      const buf = Buffer.alloc(8);
      const bigValue = normalizePackedBigInt(value, 0n);
      buf.writeBigInt64LE(bigValue, 0);
      return buf;
    }
    case DBTYPE.I4:
    case DBTYPE.UI4: {
      const buf = Buffer.alloc(4);
      const intValue = Math.trunc(normalizePackedNumber(value, 0));
      if (type === DBTYPE.UI4) {
        buf.writeUInt32LE(intValue >>> 0, 0);
      } else {
        buf.writeInt32LE(intValue, 0);
      }
      return buf;
    }
    case DBTYPE.R4: {
      const buf = Buffer.alloc(4);
      buf.writeFloatLE(normalizePackedNumber(value, 0.0), 0);
      return buf;
    }
    case DBTYPE.R8: {
      const buf = Buffer.alloc(8);
      buf.writeDoubleLE(normalizePackedNumber(value, 0.0), 0);
      return buf;
    }
    case DBTYPE.I2:
    case DBTYPE.UI2: {
      const buf = Buffer.alloc(2);
      const intValue = Math.trunc(normalizePackedNumber(value, 0));
      if (type === DBTYPE.UI2) {
        buf.writeUInt16LE(intValue & 0xffff, 0);
      } else {
        buf.writeInt16LE(intValue, 0);
      }
      return buf;
    }
    case DBTYPE.I1:
    case DBTYPE.UI1: {
      const buf = Buffer.alloc(1);
      const intValue = Math.trunc(normalizePackedNumber(value, 0));
      if (type === DBTYPE.UI1) {
        buf.writeUInt8(intValue & 0xff, 0);
      } else {
        buf.writeInt8(intValue, 0);
      }
      return buf;
    }
    default:
      return Buffer.alloc(0);
  }
}

function compressRle(buffer) {
  const out = Buffer.alloc(Math.max(buffer.length * 2, 2));
  let nibble = 0;
  let nibbleIndex = 0;
  let inputIndex = 0;
  let outputIndex = 0;
  let zeroChains = 0;

  while (inputIndex < buffer.length) {
    if (!nibble) {
      nibbleIndex = outputIndex++;
      out[nibbleIndex] = 0;
    }

    const start = inputIndex;
    let end = inputIndex + 8;
    if (end > buffer.length) {
      end = buffer.length;
    }

    let count;
    if (buffer[inputIndex] !== 0) {
      zeroChains = 0;
      do {
        out[outputIndex++] = buffer[inputIndex++];
      } while (inputIndex < end && buffer[inputIndex] !== 0);
      count = start - inputIndex + 8;
    } else {
      zeroChains += 1;
      while (inputIndex < end && buffer[inputIndex] === 0) {
        inputIndex += 1;
      }
      count = inputIndex - start + 7;
    }

    if (nibble) {
      out[nibbleIndex] |= count << 4;
    } else {
      out[nibbleIndex] = count;
    }
    nibble = nibble ? 0 : 1;
  }

  if (nibble && zeroChains) {
    zeroChains += 1;
  }

  while (zeroChains > 1) {
    zeroChains -= 2;
    outputIndex -= 1;
  }

  return out.subarray(0, outputIndex);
}

function decompressRle(buffer, expectedLength) {
  const targetLength = Math.max(0, Number(expectedLength) || 0);
  const out = Buffer.alloc(targetLength, 0);
  let inputIndex = 0;
  let outputIndex = 0;

  while (inputIndex < buffer.length && outputIndex < targetLength) {
    const control = buffer[inputIndex++];
    for (let nibbleIndex = 0; nibbleIndex < 2 && outputIndex < targetLength; nibbleIndex += 1) {
      const nibble =
        nibbleIndex === 0 ? control & 0x0f : (control >> 4) & 0x0f;

      if (nibble < 8) {
        const literalCount = 8 - nibble;
        const available = Math.min(
          literalCount,
          buffer.length - inputIndex,
          targetLength - outputIndex,
        );
        if (available > 0) {
          buffer.copy(out, outputIndex, inputIndex, inputIndex + available);
          inputIndex += available;
          outputIndex += available;
        }
      } else {
        outputIndex += Math.min(nibble - 7, targetLength - outputIndex);
      }

      if (inputIndex >= buffer.length && outputIndex >= targetLength) {
        break;
      }
    }
  }

  return out;
}

function normalizePackedColumnName(name, fallback = "") {
  if (typeof name === "string") {
    return name;
  }
  if (Buffer.isBuffer(name)) {
    return name.toString("utf8");
  }
  if (name && typeof name === "object") {
    if (typeof name.value === "string") {
      return name.value;
    }
    if (Buffer.isBuffer(name.value)) {
      return name.value.toString("utf8");
    }
  }
  return fallback;
}

function coerceDecodedPackedInteger(value) {
  if (typeof value !== "bigint") {
    return value;
  }
  const numericValue = Number(value);
  if (
    Number.isSafeInteger(numericValue) &&
    BigInt(numericValue) === value
  ) {
    return numericValue;
  }
  return value;
}

function decodePackedFixedValue(type, buffer, offset) {
  switch (type) {
    case DBTYPE.CY:
    case DBTYPE.I8:
    case DBTYPE.UI8:
    case DBTYPE.FILETIME:
      return coerceDecodedPackedInteger(buffer.readBigInt64LE(offset));
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

function decodePackedRowFields(rowHeader, rleData, state) {
  const columns = normalizePackedRowColumns({
    header: rowHeader,
  });
  const sizeMap = [];
  const booleanColumns = new Map();
  let byteDataBitLength = 0;
  let booleansBitLength = 0;
  let nullsBitLength = 0;

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
  const packedByteData = decompressRle(
    rleData,
    byteDataByteLength + bitDataByteLength,
  );
  const bitData = packedByteData.subarray(
    byteDataByteLength,
    byteDataByteLength + bitDataByteLength,
  );
  const values = new Array(columns.length).fill(null);
  let offset = 0;

  for (const entry of sizeMap) {
    if (entry.size <= 1) {
      continue;
    }

    const nullBit = entry.index + booleansBitLength;
    const nullByte = nullBit >> 3;
    const isNull =
      nullByte < bitData.length &&
      (bitData[nullByte] & (1 << (nullBit & 0x7))) !== 0;
    values[entry.index] = isNull
      ? null
      : decodePackedFixedValue(entry.type, packedByteData, offset);
    offset += entry.size >> 3;
  }

  for (const entry of sizeMap) {
    if (entry.size !== 1) {
      continue;
    }

    const nullBit = entry.index + booleansBitLength;
    const nullByte = nullBit >> 3;
    const isNull =
      nullByte < bitData.length &&
      (bitData[nullByte] & (1 << (nullBit & 0x7))) !== 0;
    if (isNull) {
      values[entry.index] = null;
      continue;
    }

    const boolBit = booleanColumns.get(entry.index);
    const boolByte = boolBit >> 3;
    values[entry.index] =
      boolByte < bitData.length &&
      (bitData[boolByte] & (1 << (boolBit & 0x7))) !== 0;
  }

  for (const entry of sizeMap) {
    if (entry.size !== 0) {
      continue;
    }
    values[entry.index] = decodeValue(state);
  }

  const fields = {};
  for (let index = 0; index < columns.length; index += 1) {
    const columnName = normalizePackedColumnName(columns[index][0], `col_${index}`);
    fields[columnName] = values[index];
  }
  applyPackedRowVirtualFields(fields, rowHeader);

  return {
    columns,
    values,
    fields,
  };
}

function encodePackedRow(packedRow, chunks) {
  const columns = normalizePackedRowColumns(packedRow);
  const values = normalizePackedRowValueMap(packedRow, columns);

  chunks.push(Buffer.from([Op.PyPackedRow]));
  encodeValue(packedRow.header, chunks);

  const sizeMap = [];
  const booleanColumns = new Map();
  let byteDataBitLength = 0;
  let booleansBitLength = 0;
  let nullsBitLength = 0;

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

  const bitData = Buffer.alloc(((booleansBitLength + nullsBitLength) >> 3) + 1, 0);
  const rowDataParts = [];

  for (const entry of sizeMap) {
    if (entry.size <= 1) {
      continue;
    }

    const value = values[entry.index];
    if (value === null || value === undefined) {
      const nullBit = entry.index + booleansBitLength;
      const nullByte = nullBit >> 3;
      bitData[nullByte] |= 1 << (nullBit & 0x7);
    }

    rowDataParts.push(encodePackedNumericValue(entry.type, value));
  }

  for (const entry of sizeMap) {
    if (entry.size !== 1) {
      continue;
    }

    if (normalizePackedBoolean(values[entry.index])) {
      const boolBit = booleanColumns.get(entry.index);
      const boolByte = boolBit >> 3;
      bitData[boolByte] |= 1 << (boolBit & 0x7);
    }
  }

  rowDataParts.push(bitData);
  const packedBuffer = Buffer.concat(rowDataParts);
  const rleBuffer = compressRle(packedBuffer);
  putSizeEx(rleBuffer.length, chunks);
  chunks.push(rleBuffer);

  for (const entry of sizeMap) {
    if (entry.size !== 0) {
      continue;
    }
    encodeValue(values[entry.index], chunks);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  DECODER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Decode a marshaled payload buffer into a JS value.
 * The input should be the raw payload AFTER stripping the 4-byte length header,
 * starting with the 0x7E magic byte.
 */
function marshalDecode(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    buffer = Buffer.from(buffer, "hex");
  }

  const state = {
    buf: buffer,
    pos: 0,
    storedObjects: [],
    saveIndicesPos: null,
    saveIndicesEnd: null,
  };

  // Read and verify header
  const header = readUInt8(state);
  if (header !== MARSHAL_HEADER) {
    throw new Error(
      `Invalid marshal header: 0x${header.toString(16)} (expected 0x7E)`,
    );
  }

  // Read save count
  const saveCount = readUInt32LE(state);

  // Initialize stored objects array
  if (saveCount > 0) {
    const saveIndicesBytes = saveCount * 4;
    if (buffer.length - state.pos < saveIndicesBytes) {
      throw new Error(
        `Invalid marshal save table: need ${saveIndicesBytes} bytes, have ${buffer.length - state.pos}`,
      );
    }
    state.storedObjects = new Array(saveCount).fill(null);
    state.saveIndicesPos = buffer.length - saveIndicesBytes;
    state.saveIndicesEnd = buffer.length;
  }

  return decodeValue(state);
}

function readUInt8(state) {
  if (state.pos >= state.buf.length)
    throw new Error("Unexpected end of marshal data");
  return state.buf[state.pos++];
}

function peekUInt8(state) {
  if (state.pos >= state.buf.length)
    throw new Error("Unexpected end of marshal data");
  return state.buf[state.pos];
}

function readInt8(state) {
  if (state.pos >= state.buf.length)
    throw new Error("Unexpected end of marshal data");
  const val = state.buf.readInt8(state.pos);
  state.pos++;
  return val;
}

function readUInt16LE(state) {
  const val = state.buf.readUInt16LE(state.pos);
  state.pos += 2;
  return val;
}

function readInt16LE(state) {
  const val = state.buf.readInt16LE(state.pos);
  state.pos += 2;
  return val;
}

function readUInt32LE(state) {
  const val = state.buf.readUInt32LE(state.pos);
  state.pos += 4;
  return val;
}

function readInt32LE(state) {
  const val = state.buf.readInt32LE(state.pos);
  state.pos += 4;
  return val;
}

function readInt64LE(state) {
  const val = state.buf.readBigInt64LE(state.pos);
  state.pos += 8;
  return val;
}

function readDoubleLE(state) {
  const val = state.buf.readDoubleLE(state.pos);
  state.pos += 8;
  return val;
}

function readBytes(state, len) {
  const slice = state.buf.slice(state.pos, state.pos + len);
  state.pos += len;
  return slice;
}

function readSaveIndex(state) {
  if (state.saveIndicesPos === null || state.saveIndicesEnd === null) {
    throw new Error("No marshal save index table available");
  }
  if (state.saveIndicesPos + 4 > state.saveIndicesEnd) {
    throw new Error("Marshal save index table exhausted");
  }

  const index = state.buf.readUInt32LE(state.saveIndicesPos);
  state.saveIndicesPos += 4;
  return index;
}

function cloneDecodedValue(value) {
  if (Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => cloneDecodedValue(entry));
  }

  if (value && typeof value === "object") {
    const cloned = {};
    for (const [key, entryValue] of Object.entries(value)) {
      cloned[key] = cloneDecodedValue(entryValue);
    }
    return cloned;
  }

  return value;
}

function readSizeEx(state) {
  const first = readUInt8(state);
  if (first === 0xff) {
    return readUInt32LE(state);
  }
  return first;
}

function decodeValue(state) {
  if (state.pos >= state.buf.length) {
    throw new Error("Unexpected end of marshal data during decodeValue");
  }

  const rawOp = readUInt8(state);
  const flagSave = (rawOp & SAVE_MASK) !== 0;
  const flagUnknown = (rawOp & UNKNOWN_MASK) !== 0;
  const op = rawOp & OPCODE_MASK;
  const storageIndex = flagSave ? readSaveIndex(state) : 0;

  let result;

  switch (op) {
    case Op.PyNone:
      result = null;
      break;

    case Op.PyTrue:
      result = true;
      break;

    case Op.PyFalse:
      result = false;
      break;

    case Op.PyZeroInteger:
      result = 0;
      break;

    case Op.PyOneInteger:
      result = 1;
      break;

    case Op.PyMinusOne:
      result = -1;
      break;

    case Op.PyByte:
      result = readInt8(state);
      break;

    case Op.PySignedShort:
      result = readInt16LE(state);
      break;

    case Op.PyLong:
      result = readInt32LE(state);
      break;

    case Op.PyLongLong:
      result = readInt64LE(state);
      break;

    case Op.PyVarInteger: {
      const size = readSizeEx(state);
      if (size === 0) {
        result = 0;
        break;
      }
      const bytes = readBytes(state, size);
      // Reconstruct as a number (up to 8 bytes)
      let val = BigInt(0);
      for (let i = 0; i < size; i++) {
        val |= BigInt(bytes[i]) << BigInt(i * 8);
      }
      // If it fits in a regular number, convert
      if (val <= BigInt(Number.MAX_SAFE_INTEGER)) {
        result = Number(val);
      } else {
        result = val;
      }
      break;
    }

    case Op.PyZeroReal:
      result = 0.0;
      break;

    case Op.PyReal:
      result = readDoubleLE(state);
      break;

    case Op.PyEmptyString:
      result = Buffer.alloc(0);
      break;

    case Op.PyCharString:
      result = Buffer.from([readUInt8(state)]);
      break;

    case Op.PyShortString: {
      const len = readUInt8(state);
      result = readBytes(state, len);
      break;
    }

    case Op.PyLongString: {
      const len = readSizeEx(state);
      result = readBytes(state, len);
      break;
    }

    case Op.PyStringTableItem: {
      const idx = readUInt8(state);
      const str = lookupString(idx);
      if (str !== null) {
        result = str;
      } else {
        result = `<stringtable:${idx}>`;
      }
      break;
    }

    case Op.PyEmptyWString:
      result = { type: "wstring", value: "" };
      break;

    case Op.PyWStringUCS2: {
      const byteLen = readSizeEx(state);
      const data = readBytes(state, byteLen * 2);
      result = { type: "wstring", value: data.toString("utf16le") };
      break;
    }

    case Op.PyWStringUCS2Char: {
      const data = readBytes(state, 2);
      result = { type: "wstring", value: data.toString("utf16le") };
      break;
    }

    case Op.PyWStringUTF8: {
      const len = readSizeEx(state);
      const data = readBytes(state, len);
      result = { type: "wstring", value: data.toString("utf8") };
      break;
    }

    case Op.PyToken: {
      const len = readSizeEx(state);
      result = {
        type: "token",
        value: readBytes(state, len).toString("utf8"),
      };
      break;
    }

    case Op.PyEmptyTuple:
      result = [];
      break;

    case Op.PyOneTuple:
      result = [decodeValue(state)];
      break;

    case Op.PyTwoTuple:
      result = [decodeValue(state), decodeValue(state)];
      break;

    case Op.PyTuple: {
      const count = readSizeEx(state);
      const arr = [];
      for (let i = 0; i < count; i++) {
        arr.push(decodeValue(state));
      }
      result = arr;
      break;
    }

    case Op.PyEmptyList:
      result = { type: "list", items: [] };
      break;

    case Op.PyOneList:
      result = { type: "list", items: [decodeValue(state)] };
      break;

    case Op.PyList: {
      const count = readSizeEx(state);
      const items = [];
      for (let i = 0; i < count; i++) {
        items.push(decodeValue(state));
      }
      result = { type: "list", items };
      break;
    }

    case Op.PyDict: {
      const count = readSizeEx(state);
      const entries = [];
      // Marshal writes value first, then key
      for (let i = 0; i < count; i++) {
        const val = decodeValue(state);
        const key = decodeValue(state);
        entries.push([key, val]);
      }
      result = { type: "dict", entries };
      break;
    }

    case Op.PyObject: {
      const name = decodeValue(state);
      const args = decodeValue(state);
      result = { type: "object", name, args };
      break;
    }

    case Op.PyObjectEx1:
    case Op.PyObjectEx2: {
      const header = decodeValue(state);
      const list = [];
      while (state.pos < state.buf.length) {
        const peek = state.buf[state.pos] & OPCODE_MASK;
        if (peek === Op.PackedTerminator) {
          state.pos++;
          break;
        }
        list.push(decodeValue(state));
      }
      const dict = [];
      while (state.pos < state.buf.length) {
        const peek = state.buf[state.pos] & OPCODE_MASK;
        if (peek === Op.PackedTerminator) {
          state.pos++;
          break;
        }
        const key = decodeValue(state);
        const val = decodeValue(state);
        dict.push([key, val]);
      }
      result = {
        type: op === Op.PyObjectEx1 ? "objectex1" : "objectex2",
        header,
        list,
        dict,
      };
      break;
    }

    case Op.PySubStruct:
      result = { type: "substruct", value: decodeValue(state) };
      break;

    case Op.PySubStream: {
      const len = readSizeEx(state);
      const data = readBytes(state, len);
      // Try to decode the substream
      try {
        result = { type: "substream", value: marshalDecode(data) };
      } catch (e) {
        result = { type: "substream", raw: data };
      }
      break;
    }

    case Op.PyChecksumedStream: {
      const checksum = readUInt32LE(state);
      const value = decodeValue(state);
      result = { type: "checksummed", checksum, value };
      break;
    }

    case Op.PyBuffer: {
      const len = readSizeEx(state);
      result = readBytes(state, len);
      break;
    }

    case Op.cPicked: {
      const len = readSizeEx(state);
      result = {
        type: "cpicked",
        data: readBytes(state, len),
      };
      break;
    }

    case Op.PySavedStreamElement: {
      const index = readSizeEx(state);
      if (
        state.storedObjects &&
        index > 0 &&
        index <= state.storedObjects.length
      ) {
        result = cloneDecodedValue(state.storedObjects[index - 1]);
      } else {
        result = null;
      }
      break;
    }

    case Op.PyPackedRow: {
      // Read the header (DBRowDescriptor)
      const rowHeader = decodeValue(state);
      // Read the RLE-compressed data
      const rleLen = readSizeEx(state);
      const rleData = readBytes(state, rleLen);
      const decodedRow = decodePackedRowFields(rowHeader, rleData, state);
      result = {
        type: "packedrow",
        header: rowHeader,
        columns: decodedRow.columns,
        values: decodedRow.values,
        fields: decodedRow.fields,
        rleData: rleData,
      };
      break;
    }

    default:
      throw new Error(
        `Unknown marshal opcode: 0x${rawOp.toString(16)} at position ${state.pos - 1}`,
      );
  }

  // Store object if flagSave is set
  if (flagSave && state.storedObjects) {
    if (storageIndex > 0 && storageIndex <= state.storedObjects.length) {
      state.storedObjects[storageIndex - 1] = result;
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
//  PACKET FRAMING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Wrap a marshaled buffer (from marshalEncode) in a packet frame:
 * [4-byte LE length] [marshaled data]
 */
function wrapPacket(marshaledData) {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(marshaledData.length, 0);
  return Buffer.concat([header, marshaledData]);
}

/**
 * Convenience: marshal a value and wrap it as a framed packet.
 */
function encodePacket(value) {
  return wrapPacket(marshalEncode(value));
}

// ═══════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Helper to look up a key in a decoded dict object.
 * Returns undefined if not found.
 */
function dictGet(dictObj, key) {
  if (!dictObj || dictObj.type !== "dict") return undefined;
  for (const [k, v] of dictObj.entries) {
    const kStr = strVal(k);
    if (kStr === key) return v;
  }
  return undefined;
}

/**
 * Helper to extract the string value from a Buffer, plain string, or wstring.
 */
function strVal(v) {
  if (typeof v === "string") return v;
  if (Buffer.isBuffer(v)) return v.toString("utf8");
  if (v && typeof v === "object" && v.type === "wstring") return v.value;
  if (v && typeof v === "object" && v.type === "token") return v.value;
  if (v && typeof v === "object" && v.type === "rawstr") return v.value;
  return String(v);
}

/**
 * Helper to get the raw Buffer from a decoded value (string or buffer).
 */
function bufVal(v) {
  if (Buffer.isBuffer(v)) return v;
  if (typeof v === "string") return Buffer.from(v, "utf8");
  return null;
}

module.exports = {
  marshalEncode,
  marshalDecode,
  wrapPacket,
  encodePacket,
  dictGet,
  strVal,
  bufVal,
  Op,
  MARSHAL_HEADER,
  SAVE_MASK,
  OPCODE_MASK,
};
