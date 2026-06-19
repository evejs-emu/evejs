"use strict";

const path = require("path");

const config = require(path.join(__dirname, "../config"));

const TIDI_KINDS = Object.freeze({
  INIT: 0x001658a0,
  EVENT: 0x001658b7,
  DETACH: 0x009e3144,
});

function clampFactor(value, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(1, Math.max(0.1, numeric));
}

function normalizeBigInt(value, fallback = 0n) {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string" && value.trim() !== "") {
    try {
      return BigInt(value);
    } catch (error) {
      return fallback;
    }
  }
  return fallback;
}

function normalizeUInt32(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback >>> 0;
  }
  return (Math.trunc(numeric) >>> 0);
}

class BitWriter {
  constructor() {
    this.bytes = [];
    this.bitLength = 0;
  }

  writeBit(bit) {
    const bitValue = bit ? 1 : 0;
    const byteIndex = Math.floor(this.bitLength / 8);
    const bitIndex = this.bitLength % 8;
    if (byteIndex >= this.bytes.length) {
      this.bytes.push(0);
    }
    if (bitValue) {
      this.bytes[byteIndex] |= (1 << bitIndex);
    }
    this.bitLength += 1;
  }

  writeBitsFromBuffer(buffer, bitCount = buffer.length * 8) {
    for (let bitIndex = 0; bitIndex < bitCount; bitIndex += 1) {
      const sourceByteIndex = Math.floor(bitIndex / 8);
      const sourceBitIndex = bitIndex % 8;
      const bit =
        (buffer[sourceByteIndex] >> sourceBitIndex) & 0x1;
      this.writeBit(bit);
    }
  }

  writeLittleEndianNumber(value, bitCount) {
    const byteLength = Math.ceil(bitCount / 8);
    const buffer = Buffer.alloc(byteLength);
    let remaining = normalizeBigInt(value, 0n);
    for (let index = 0; index < byteLength; index += 1) {
      buffer[index] = Number(remaining & 0xffn);
      remaining >>= 8n;
    }
    this.writeBitsFromBuffer(buffer, bitCount);
  }

  alignToByte() {
    const remainder = this.bitLength % 8;
    if (remainder === 0) {
      return;
    }
    this.bitLength += (8 - remainder);
  }

  toBuffer() {
    const byteLength = Math.ceil(this.bitLength / 8);
    return Buffer.from(this.bytes.slice(0, byteLength));
  }
}

function writeUnsigned32Var4(writer, value) {
  const normalized = normalizeUInt32(value, 0);
  if (normalized === 0) {
    writer.writeLittleEndianNumber(0, 3);
    return;
  }

  let groupCount = 1;
  while (groupCount < 7 && normalized >= (1 << (groupCount * 4))) {
    groupCount += 1;
  }

  writer.writeLittleEndianNumber(groupCount >= 7 ? 7 : groupCount, 3);
  writer.writeLittleEndianNumber(
    normalized,
    groupCount >= 7 ? 32 : groupCount * 4,
  );
}

function writeUnsigned64Var5(writer, value) {
  const normalized = normalizeBigInt(value, 0n);
  if (normalized === 0n) {
    writer.writeLittleEndianNumber(0n, 3);
    return;
  }

  let groupCount = 1;
  while (
    groupCount < 7 &&
    normalized >= (1n << BigInt(groupCount * 5))
  ) {
    groupCount += 1;
  }

  writer.writeLittleEndianNumber(groupCount >= 7 ? 7n : BigInt(groupCount), 3);
  writer.writeLittleEndianNumber(
    normalized,
    groupCount >= 7 ? 64 : groupCount * 5,
  );
}

function writeSigned64Var5(writer, value) {
  const normalized = normalizeBigInt(value, 0n);
  if (normalized === 0n) {
    writer.writeBit(0);
    writer.writeLittleEndianNumber(0n, 3);
    return;
  }

  if (normalized > 0n) {
    writer.writeBit(0);
    writeUnsigned64Var5(writer, normalized);
    return;
  }

  writer.writeBit(1);
  writeUnsigned64Var5(writer, -normalized);
}

function writeSigned32Var4(writer, value) {
  const numeric = Number(value);
  const normalized = Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
  if (normalized === 0) {
    writer.writeBit(0);
    writer.writeLittleEndianNumber(0, 3);
    return;
  }

  const magnitude = Math.abs(normalized) >>> 0;
  writer.writeBit(normalized < 0 ? 1 : 0);
  writeUnsigned32Var4(writer, magnitude);
}

function writeRawDouble(writer, value) {
  const buffer = Buffer.allocUnsafe(8);
  buffer.writeDoubleLE(clampFactor(value), 0);
  writer.writeBitsFromBuffer(buffer, 64);
}

function encodeTimeDilationBody({ baseTime, factor, eventTime }) {
  const writer = new BitWriter();
  writeSigned64Var5(writer, baseTime);
  writeRawDouble(writer, factor);
  writeSigned64Var5(writer, eventTime);
  writer.alignToByte();
  return writer.toBuffer();
}

function encodeBlueNetSingleHeader({
  kind,
  targetClientID,
  masterID = BigInt(config.proxyNodeId || 0),
  transportID = 0,
  sourceStamp = 0n,
  sourceFlag = null,
}) {
  const writer = new BitWriter();
  writeSigned64Var5(writer, 0n);
  writeSigned64Var5(writer, masterID);
  writeSigned64Var5(writer, targetClientID);
  writeSigned32Var4(writer, kind);
  writeUnsigned32Var4(writer, 0);
  writeUnsigned32Var4(writer, 0);
  writeUnsigned32Var4(writer, transportID);
  const normalizedSourceStamp = normalizeBigInt(sourceStamp, 0n);
  const flag =
    sourceFlag === null
      ? normalizedSourceStamp !== 0n
      : Boolean(sourceFlag);
  writer.writeBit(flag ? 1 : 0);
  writeUnsigned64Var5(writer, normalizedSourceStamp);
  writer.alignToByte();
  return writer.toBuffer();
}

function buildBlueNetFrame(headerBuffer, bodyBuffer) {
  if (!Buffer.isBuffer(bodyBuffer)) {
    throw new TypeError("bodyBuffer must be a Buffer");
  }

  if (!Buffer.isBuffer(headerBuffer) || headerBuffer.length === 0) {
    const out = Buffer.allocUnsafe(4 + bodyBuffer.length);
    out.writeUInt32LE(bodyBuffer.length >>> 0, 0);
    bodyBuffer.copy(out, 4);
    return out;
  }

  const firstWord = (
    (headerBuffer.length + bodyBuffer.length + 4) |
    0x10000000
  ) >>> 0;
  const out = Buffer.allocUnsafe(8 + headerBuffer.length + bodyBuffer.length);
  out.writeUInt32LE(firstWord, 0);
  out.writeUInt32LE(headerBuffer.length >>> 0, 4);
  headerBuffer.copy(out, 8);
  bodyBuffer.copy(out, 8 + headerBuffer.length);
  return out;
}

function buildTimeDilationFrame(kind, options = {}) {
  const header = encodeBlueNetSingleHeader({
    kind,
    targetClientID: options.targetClientID,
    masterID: options.masterID,
    transportID: options.transportID,
    sourceStamp: options.sourceStamp,
    sourceFlag: options.sourceFlag,
  });
  const body =
    kind === TIDI_KINDS.DETACH
      ? Buffer.from([0])
      : encodeTimeDilationBody({
        baseTime: options.baseTime,
        factor: options.factor,
        eventTime: options.eventTime,
      });
  return buildBlueNetFrame(header, body);
}

//testing: NEW — builds the combined native header (routing + tidi body) that
//testing: goes into the BlueNet frame's HEADER section.  The native layer in
//testing: blue.dll parses routing fields, finds the kind, and calls the TiDi
//testing: handler with the remaining bytes (baseTime, factor, eventTime).
//testing: prev: routing header and tidi body were separate (header vs body sections)
//testing: after: concatenated into one header so the body section can carry a macho packet
function buildTimeDilationNativeHeader(kind, options = {}) {
  const routing = encodeBlueNetSingleHeader({
    kind,
    targetClientID: options.targetClientID,
    masterID: options.masterID,
    transportID: options.transportID,
    sourceStamp: options.sourceStamp,
    sourceFlag: options.sourceFlag,
  });

  if (kind === TIDI_KINDS.DETACH) {
    return Buffer.concat([routing, Buffer.from([0])]);
  }

  const body = encodeTimeDilationBody({
    baseTime: options.baseTime,
    factor: options.factor,
    eventTime: options.eventTime,
  });

  return Buffer.concat([routing, body]);
}

function buildTimeDilationInitFrame(options = {}) {
  return buildTimeDilationFrame(TIDI_KINDS.INIT, options);
}

function buildTimeDilationEventFrame(options = {}) {
  return buildTimeDilationFrame(TIDI_KINDS.EVENT, options);
}

function buildTimeDilationDetachFrame(options = {}) {
  return buildTimeDilationFrame(TIDI_KINDS.DETACH, options);
}

module.exports = {
  TIDI_KINDS,
  BitWriter,
  buildBlueNetFrame,
  buildTimeDilationDetachFrame,
  buildTimeDilationEventFrame,
  buildTimeDilationInitFrame,
  buildTimeDilationNativeHeader,
  encodeBlueNetSingleHeader,
  encodeTimeDilationBody,
};
