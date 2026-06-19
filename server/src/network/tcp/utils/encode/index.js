// imports
let path = require("path");
let fs = require("fs");

let log = require(path.join(__dirname, "../../../../utils/logger"));
/*
^^
info(), debug(), warn(), err(), success()
*/

let config = require(path.join(__dirname, "../../../../config"));

// main func
module.exports = function (...items) {
  function logDebug(t) {
    if (config.logLevel > 1)
      // level 2: debug
      log.debug(`${t}`);
  }

  // function to convert parameter to hex based on its type
  function encode(i) {
    if (i === null) return Buffer.from([0x01]); // 0x01 is null
    if (typeof i === "number") {
      if (i == 1) return Buffer.from([0x09]); // 0x09 is 1
      if (i == 0) return Buffer.from([0x08]); // 0x08 is 0
      if (Number.isInteger(i)) {
        // number does not include decimal
        if (i >= -32768 && i <= 32767) {
          let buf = Buffer.alloc(3);
          buf[0] = 0x05;
          buf.writeInt16LE(i, 1);
          return buf;
        } else {
          let buf = Buffer.alloc(5);
          buf[0] = 0x04;
          buf.writeInt32LE(i, 1);
          return buf;
        }
      } else {
        // number includes a decimal
        let buf = Buffer.alloc(9);
        buf[0] = 0x0a;
        buf.writeDoubleLE(i, 1);
        return buf;
      }
    }
    if (typeof i === "string") {
      let strBuf = Buffer.from(i, "utf8");
      let len = strBuf.length;
      let buf = Buffer.alloc(2 + len);
      buf[0] = 0x13;
      buf[1] = len;
      strBuf.copy(buf, 2);
      return buf;
    }
  }

  // create variable for items encoded as hex
  let payload;

  // if there is only 1 item AND its an [array]: its a tuple
  if (items.length == 1 && Array.isArray(items[0])) {
    let tuple = items[0]; // assign the array to a variable named "tuple"
    let tupleItems = tuple.map(encode); // for each item in the tuple, encode it as hex
    payload = Buffer.concat([Buffer.from([0x14, tuple.length]), ...tupleItems]);
  } else {
    let encodedItems = items.map(encode);
    payload = Buffer.concat(encodedItems);
  }

  // build header
  let header = Buffer.alloc(9);
  let totalPacketLength = header.length + payload.length;
  let payloadLength = totalPacketLength - 4;
  header.writeUInt32LE(payloadLength, 0);
  header.writeUInt32LE(0x7e, 4);
  header[8] = 0x00;

  // return assembled assemble payload
  return Buffer.concat([header, payload]);
};
