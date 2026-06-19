"use strict";

function encodeAsciiString(value) {
  const text = String(value ?? "");
  const buffer = Buffer.from(text, "ascii");
  if (buffer.length <= 0xff) {
    return Buffer.concat([Buffer.from([0x55, buffer.length]), buffer]);
  }
  const header = Buffer.alloc(5);
  header[0] = 0x54;
  header.writeUInt32LE(buffer.length, 1);
  return Buffer.concat([header, buffer]);
}

function encodeInt(value) {
  const numericValue = Math.trunc(Number(value) || 0);
  if (numericValue >= 0 && numericValue <= 0xff) {
    return Buffer.from([0x4b, numericValue]);
  }
  if (numericValue >= 0 && numericValue <= 0xffff) {
    const buffer = Buffer.alloc(3);
    buffer[0] = 0x4d;
    buffer.writeUInt16LE(numericValue, 1);
    return buffer;
  }
  const buffer = Buffer.alloc(5);
  buffer[0] = 0x4a;
  buffer.writeInt32LE(numericValue, 1);
  return buffer;
}

function encodeList(values = []) {
  const parts = [Buffer.from([0x5d])];
  for (const value of values) {
    parts.push(encodeInt(value));
    parts.push(Buffer.from([0x61]));
  }
  return Buffer.concat(parts);
}

function encodeTuple(values = []) {
  if (!Array.isArray(values) || values.length === 0) {
    return Buffer.from([0x29]);
  }
  const parts = [Buffer.from([0x28])];
  for (const value of values) {
    parts.push(encodeInt(value));
  }
  parts.push(Buffer.from([0x74]));
  return Buffer.concat(parts);
}

function buildBrainEffectPickle(effect) {
  const {
    value,
    toItemID,
    modifierType = "M",
    toAttribID,
    operation,
    extras = [],
    skills = [],
  } = effect || {};

  const stateEntries = [
    ["fromAttrib", Buffer.from([0x4e])],
    ["value", encodeInt(value)],
    ["toItemID", encodeInt(toItemID)],
    ["modifierType", encodeAsciiString(modifierType)],
    ["toAttribID", encodeInt(toAttribID)],
    ["operation", encodeInt(operation)],
    ["extras", encodeTuple(extras)],
    ["skills", encodeList(skills)],
  ];

  const parts = [
    Buffer.from([0x80, 0x02, 0x63]),
    Buffer.from("eve.common.script.dogma.effect\nBrainEffect\n", "ascii"),
    Buffer.from([0x29, 0x81, 0x7d, 0x28]),
  ];

  for (const [key, encodedValue] of stateEntries) {
    parts.push(encodeAsciiString(key));
    parts.push(encodedValue);
  }

  parts.push(Buffer.from([0x75, 0x62, 0x2e]));
  return Buffer.concat(parts);
}

module.exports = {
  buildBrainEffectPickle,
};
