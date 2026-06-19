/**
 * PyPacket — Macho Network Packet Structure
 *
 * Ported from PyPacket.h/cpp in eve-common. The "PyPacket" is the higher-level
 * structure that wraps a marshaled tuple when it arrives from the client after
 * the handshake. It carries type info, addressing, and payload.
 *
 * Raw decoded form from marshal may be:
 *   - A tuple of 6-7 elements: [type, source, dest, userID, payload, namedPayload, ?oob]
 *   - A PyObject: { type: "object", name: "macho.CallReq", args: [...] }
 */

const path = require("path");
const { getTypeName, MACHONETMSG_TYPE } = require(
  path.join(__dirname, "./packetTypes"),
);
const { decodeAddress, encodeAddress, strVal } = require(
  path.join(__dirname, "./machoAddress"),
);
const log = require(path.join(__dirname, "../utils/logger"));

/**
 * Decode a raw marshaled tuple into a structured PyPacket object.
 */
function decodePacket(decoded) {
  // Unwrap PyObject wrapper
  let tup = decoded;
  if (tup && typeof tup === "object" && tup.type === "object" && tup.args) {
    tup = tup.args;
  }

  if (!Array.isArray(tup) || tup.length < 6) {
    log.warn(
      `[PyPacket] Cannot decode: expected array of 6+, got ${Array.isArray(tup) ? `array(${tup.length})` : typeof tup}`,
    );
    return null;
  }

  const type = typeof tup[0] === "number" ? tup[0] : 0;
  const source = decodeAddress(tup[1]);
  const dest = decodeAddress(tup[2]);
  const userID = tup[3];
  const payload = tup[4];
  const namedPayload = tup[5] || null;
  const oob = tup.length > 6 ? tup[6] : null;
  const bssid = tup.length > 7 ? tup[7] : null;
  const spanid = tup.length > 8 ? tup[8] : null;

  // EVE 23.02 MachoNetMsg 14-element tuple extra fields
  const extra9 = tup.length > 9 ? tup[9] : null;
  const extra10 = tup.length > 10 ? tup[10] : null;
  const extra11 = tup.length > 11 ? tup[11] : null;
  const extra12 = tup.length > 12 ? tup[12] : null;
  const extra13 = tup.length > 13 ? tup[13] : null;

  const typeName = getTypeName(type);
  const service = dest.service || null;

  return {
    type,
    typeName,
    source,
    dest,
    userID,
    payload,
    namedPayload,
    oob,
    bssid,
    spanid,
    extra9,
    extra10,
    extra11,
    extra12,
    extra13,
    service,
  };
}

function encodePacketTuple(pkt) {
  const tup = [
    pkt.type,
    encodeAddress(pkt.source),
    encodeAddress(pkt.dest),
    pkt.userID || null,
    pkt.payload || [],
    pkt.namedPayload || null,
    pkt.oob || null, // 7th element (contextKey / oob)
    pkt.bssid || null, // 8th element (traceID / bssid)
    pkt.spanid || null, // 9th element (spanID / bssctx)
    pkt.extra9 || null, // 10th
    pkt.extra10 || null, // 11th
    pkt.extra11 || null, // 12th
    pkt.extra12 || null, // 13th
    pkt.extra13 || null, // 14th
  ];
  return tup;
}

/**
 * Extract the call info from a CALL_REQ packet's payload.
 *
 * The payload for a CALL_REQ is a nested structure:
 *   payload = [ [isbound, substream([remoteObj, method, argsTuple, argsDict])] ]
 *
 * Where:
 *   - isbound: 0 for unbound service calls
 *   - substream wraps the actual call body tuple
 *   - remoteObj: typically 1 for unbound, or a bound object reference
 *   - method: string method name (may be Buffer)
 *   - argsTuple: tuple of positional args
 *   - argsDict: dict of keyword args (may be None)
 */
function decodeCallRequest(payload) {
  if (!payload) return null;

  try {
    // Step 1: payload = [ inner ]
    if (!Array.isArray(payload) || payload.length === 0) return null;
    let wrapper = payload[0];

    // Unwrap PyObject
    if (
      wrapper &&
      typeof wrapper === "object" &&
      wrapper.type === "object" &&
      wrapper.args
    ) {
      wrapper = wrapper.args;
    }

    let callBody = null;

    if (Array.isArray(wrapper)) {
      // wrapper = [isbound, substream_or_data, ...]
      // Look for a substream in the elements
      for (let i = 0; i < wrapper.length; i++) {
        const elem = wrapper[i];
        if (elem && typeof elem === "object" && elem.type === "substream") {
          callBody = elem.value;
          break;
        }
      }
      // If no substream found, the wrapper itself might be the call body
      if (!callBody) {
        callBody = wrapper;
      }
    } else if (
      wrapper &&
      typeof wrapper === "object" &&
      wrapper.type === "substream"
    ) {
      callBody = wrapper.value;
    }

    // Unwrap PyObject if callBody is one
    if (
      callBody &&
      typeof callBody === "object" &&
      !Array.isArray(callBody) &&
      callBody.type === "object" &&
      callBody.args
    ) {
      callBody = callBody.args;
    }

    if (!Array.isArray(callBody) || callBody.length < 2) {
      log.warn(`[PyPacket] Could not extract call body from payload`);
      return {
        method: "unknown",
        args: [],
        kwargs: null,
        remoteObject: null,
        raw: payload,
      };
    }

    // Step 3: callBody = [remoteObj, method, argsTuple, argsDict]
    const remoteObject = callBody[0];
    const rawMethod = callBody.length > 1 ? callBody[1] : "unknown";

    // Extract method name — could be string, Buffer, or other
    let method = "unknown";
    if (typeof rawMethod === "string") {
      method = rawMethod;
    } else if (Buffer.isBuffer(rawMethod)) {
      method = rawMethod.toString("utf8");
    } else if (
      rawMethod &&
      typeof rawMethod === "object" &&
      rawMethod.type === "wstring"
    ) {
      method = rawMethod.value;
    } else if (
      rawMethod &&
      typeof rawMethod === "object" &&
      rawMethod.type === "token"
    ) {
      method = rawMethod.value;
    } else if (rawMethod != null) {
      method = String(rawMethod);
    }

    const argsTuple = callBody.length > 2 ? callBody[2] : [];
    const argsDict = callBody.length > 3 ? callBody[3] : null;

    // argsTuple might be a substream or array
    let args = argsTuple;
    if (args && typeof args === "object" && args.type === "substream") {
      args = args.value;
    }
    if (!Array.isArray(args)) {
      args = args != null ? [args] : [];
    }

    log.debug(
      `[PyPacket] Call: method="${method}" args=${args.length} remoteObj=${remoteObject}`,
    );

    return {
      method,
      args,
      kwargs: argsDict,
      remoteObject,
      raw: callBody,
    };
  } catch (err) {
    log.err(`[PyPacket] Error decoding call request: ${err.message}`);
  }

  return {
    method: "unknown",
    args: [],
    kwargs: null,
    remoteObject: null,
    raw: payload,
  };
}

module.exports = {
  decodePacket,
  encodePacketTuple,
  decodeCallRequest,
};
