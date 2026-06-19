const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  TIDI_KINDS,
  buildTimeDilationDetachFrame,
  buildTimeDilationEventFrame,
  buildTimeDilationInitFrame,
} = require(path.join(
  repoRoot,
  "server/src/network/nativeTimeDilation",
));

class BitReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.position = 0;
  }

  readBit() {
    const byteIndex = Math.floor(this.position / 8);
    const bitIndex = this.position % 8;
    const value = (this.buffer[byteIndex] >> bitIndex) & 0x1;
    this.position += 1;
    return value;
  }

  readBitsAsBigInt(bitCount) {
    let value = 0n;
    for (let bitIndex = 0; bitIndex < bitCount; bitIndex += 1) {
      const bit = this.readBit();
      value |= BigInt(bit) << BigInt(bitIndex);
    }
    return value;
  }

  readUnsigned32Var4() {
    const prefix = Number(this.readBitsAsBigInt(3));
    if (prefix === 0) {
      return 0;
    }
    if (prefix === 7) {
      return Number(this.readBitsAsBigInt(32));
    }
    return Number(this.readBitsAsBigInt(prefix * 4));
  }

  readUnsigned64Var5() {
    const prefix = Number(this.readBitsAsBigInt(3));
    if (prefix === 0) {
      return 0n;
    }
    if (prefix === 7) {
      return this.readBitsAsBigInt(64);
    }
    return this.readBitsAsBigInt(prefix * 5);
  }

  readSigned64Var5() {
    const sign = this.readBit();
    const magnitude = this.readUnsigned64Var5();
    return sign ? -magnitude : magnitude;
  }

  readSigned32Var4() {
    const sign = this.readBit();
    const magnitude = this.readUnsigned32Var4();
    return sign ? -magnitude : magnitude;
  }

  readRawDouble() {
    const buffer = Buffer.alloc(8);
    for (let bitIndex = 0; bitIndex < 64; bitIndex += 1) {
      const bit = this.readBit();
      if (bit) {
        buffer[Math.floor(bitIndex / 8)] |= 1 << (bitIndex % 8);
      }
    }
    return buffer.readDoubleLE(0);
  }

  alignToByte() {
    const remainder = this.position % 8;
    if (remainder !== 0) {
      this.position += 8 - remainder;
    }
  }
}

function splitBlueNetFrame(frame) {
  const firstWord = frame.readUInt32LE(0);
  const headerLen = frame.readUInt32LE(4);
  return {
    firstWord,
    headerLen,
    header: frame.subarray(8, 8 + headerLen),
    body: frame.subarray(8 + headerLen),
  };
}

function decodeSingleHeader(header) {
  const reader = new BitReader(header);
  const decoded = {
    routeID: reader.readSigned64Var5(),
    masterID: reader.readSigned64Var5(),
    targetClientID: reader.readSigned64Var5(),
    kind: reader.readSigned32Var4(),
    fieldA: reader.readUnsigned32Var4(),
    fieldB: reader.readUnsigned32Var4(),
    transportID: reader.readUnsigned32Var4(),
    sourceFlag: Boolean(reader.readBit()),
    sourceStamp: reader.readUnsigned64Var5(),
  };
  reader.alignToByte();
  decoded.bitsConsumed = reader.position;
  return decoded;
}

function decodeTimeDilationBody(body) {
  const reader = new BitReader(body);
  const decoded = {
    baseTime: reader.readSigned64Var5(),
    factor: reader.readRawDouble(),
    eventTime: reader.readSigned64Var5(),
  };
  reader.alignToByte();
  decoded.bitsConsumed = reader.position;
  return decoded;
}

test("native TiDi init frame encodes the expected BlueNet header/body layout", () => {
  const frame = buildTimeDilationInitFrame({
    targetClientID: 65450n,
    masterID: 0xffaan,
    transportID: 0,
    baseTime: 132537600000000000n,
    factor: 0.5,
    eventTime: 132537600050000000n,
  });
  const { firstWord, headerLen, header, body } = splitBlueNetFrame(frame);
  const decodedHeader = decodeSingleHeader(header);
  const decodedBody = decodeTimeDilationBody(body);

  assert.equal(
    firstWord,
    ((headerLen + body.length + 4) | 0x10000000) >>> 0,
  );
  assert.equal(decodedHeader.routeID, 0n);
  assert.equal(decodedHeader.masterID, 0xffaan);
  assert.equal(decodedHeader.targetClientID, 65450n);
  assert.equal(decodedHeader.kind, TIDI_KINDS.INIT);
  assert.equal(decodedHeader.fieldA, 0);
  assert.equal(decodedHeader.fieldB, 0);
  assert.equal(decodedHeader.transportID, 0);
  assert.equal(decodedHeader.sourceFlag, false);
  assert.equal(decodedHeader.sourceStamp, 0n);
  assert.equal(decodedBody.baseTime, 132537600000000000n);
  assert.equal(decodedBody.factor, 0.5);
  assert.equal(decodedBody.eventTime, 132537600050000000n);
});

test("native TiDi event frame reuses the same body encoding with the event kind", () => {
  const frame = buildTimeDilationEventFrame({
    targetClientID: 65450n,
    masterID: 0xffaan,
    transportID: 0,
    baseTime: 132537600000000000n,
    factor: 0.1,
    eventTime: 132537600100000000n,
  });
  const { header, body } = splitBlueNetFrame(frame);
  const decodedHeader = decodeSingleHeader(header);
  const decodedBody = decodeTimeDilationBody(body);

  assert.equal(decodedHeader.kind, TIDI_KINDS.EVENT);
  assert.equal(decodedBody.baseTime, 132537600000000000n);
  assert.equal(decodedBody.factor, 0.1);
  assert.equal(decodedBody.eventTime, 132537600100000000n);
});

test("native TiDi detach frame uses the detach kind and 1-byte zero body", () => {
  const frame = buildTimeDilationDetachFrame({
    targetClientID: 65450n,
    masterID: 0xffaan,
  });
  const { header, body } = splitBlueNetFrame(frame);
  const decodedHeader = decodeSingleHeader(header);

  assert.equal(decodedHeader.kind, TIDI_KINDS.DETACH);
  assert.deepEqual(body, Buffer.from([0]));
});
