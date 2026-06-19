// main func
module.exports = function decode(buffer) {
  let packets = [];
  let offset = 0;

  while (true) {
    // need at least length field
    if (offset + 4 > buffer.length) break;

    const payloadLength = buffer.readUInt32LE(offset);
    const totalLength = payloadLength + 4;

    // sanity checks
    if (payloadLength <= 0 || payloadLength > 10_000_000) break;
    if (offset + totalLength > buffer.length) break;

    packets.push(buffer.slice(offset, offset + totalLength));
    offset += totalLength;
  }

  return {
    packets,
    remaining: buffer.slice(offset)
  };
};

