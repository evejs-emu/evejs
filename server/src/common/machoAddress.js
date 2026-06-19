/**
 * Macho Address Types
 *
 * Handles encoding/decoding of EVE macho network addresses.
 *
 * Address types use the same numeric IDs as the retail client:
 *   1 = Node
 *   2 = Client
 *   4 = Broadcast
 *   8 = Any (service/unbound)
 *
 * Field order matches machoNetAddress.__getstate__ in the client:
 *   ANY:       [type, service, callID]
 *   NODE:      [type, nodeID, service, callID]
 *   CLIENT:    [type, clientID, callID, service]
 *   BROADCAST: [type, broadcastID, narrowcast, idtype]
 *
 * Both encoding and decoding use PyObject("macho.MachoAddress", tuple).
 */

const path = require("path");
const log = require(path.join(__dirname, "../utils/logger"));

function strVal(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (Buffer.isBuffer(v)) return v.toString("utf8");
  if (v && typeof v === "object" && v.type === "wstring") return v.value;
  if (v && typeof v === "object" && v.type === "token") return v.value;
  return null;
}

const ADDR_TYPE_NODE = 1;
const ADDR_TYPE_CLIENT = 2;
const ADDR_TYPE_BROADCAST = 4;
const ADDR_TYPE_ANY = 8;

function decodeAddress(tup) {
  if (tup && typeof tup === "object" && tup.type === "object" && tup.args) {
    tup = tup.args;
  }
  if (!Array.isArray(tup) || tup.length < 1) {
    return { type: "unknown", raw: tup };
  }

  const addrType = typeof tup[0] === "number" ? tup[0] : 0;

  switch (addrType) {
    case ADDR_TYPE_NODE:
      return {
        type: "node",
        nodeID: tup.length > 1 ? tup[1] : 0,
        service: tup.length > 2 ? strVal(tup[2]) : null,
        callID: tup.length > 3 ? tup[3] : 0,
      };

    case ADDR_TYPE_CLIENT:
      return {
        type: "client",
        clientID: tup.length > 1 ? tup[1] : 0,
        callID: tup.length > 2 ? tup[2] : 0,
        service: tup.length > 3 ? strVal(tup[3]) : null,
      };

    case ADDR_TYPE_BROADCAST:
      return {
        type: "broadcast",
        broadcastID: tup.length > 1 ? strVal(tup[1]) : null,
        narrowTo: tup.length > 2 ? tup[2] : null,
        idtype: tup.length > 3 ? strVal(tup[3]) : null,
      };

    case ADDR_TYPE_ANY:
      return {
        type: "any",
        service: tup.length > 1 ? strVal(tup[1]) : null,
        callID: tup.length > 2 ? tup[2] : 0,
      };

    default:
      log.warn(`[MachoAddr] Unknown address type: ${addrType}`);
      return { type: "unknown", raw: tup };
  }
}

function encodeAddress(addr) {
  let tuple;

  switch (addr.type) {
    case "any":
      tuple = [ADDR_TYPE_ANY, addr.service || null, addr.callID || null];
      break;

    case "node":
      tuple = [
        ADDR_TYPE_NODE,
        addr.nodeID != null ? addr.nodeID : 1,
        addr.service || null,
        addr.callID || null,
      ];
      break;

    case "client":
      tuple = [
        ADDR_TYPE_CLIENT,
        typeof addr.clientID === "bigint"
          ? { type: "long", value: addr.clientID }
          : addr.clientID != null
            ? addr.clientID
            : 0,
        addr.callID || null,
        addr.service || null,
      ];
      break;

    case "broadcast":
      tuple = [
        ADDR_TYPE_BROADCAST,
        addr.broadcastID || null,
        addr.narrowTo || { type: "list", items: [] },
        addr.idtype || null,
      ];
      break;

    case "service":
      tuple = [ADDR_TYPE_ANY, addr.service || null, null];
      break;

    default:
      tuple = [ADDR_TYPE_ANY, null, null];
      break;
  }

  return {
    type: "object",
    name: "carbon.common.script.net.machoNetPacket.MachoAddress",
    args: tuple,
  };
}

module.exports = {
  ADDR_TYPE_ANY,
  ADDR_TYPE_NODE,
  ADDR_TYPE_CLIENT,
  ADDR_TYPE_BROADCAST,
  decodeAddress,
  encodeAddress,
  strVal,
};
