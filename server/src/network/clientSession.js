/**
 * Client Session
 *
 * Tracks per-client session attributes after the handshake completes.
 * Ported from EVEClientSession / ClientSession in the C++ server.
 *
 * Session attributes mirror what the C++ server tracks:
 *   userid, characterID, corporationID, stationID, solarsystemid, role, etc.
 */

const path = require("path");
const log = require(path.join(__dirname, "../utils/logger"));
const rotatingLog = require(path.join(__dirname, "../utils/rotatingLog"));
const syncLedger = require(path.join(__dirname, "./syncLedger"));
const { marshalEncode, marshalDecode, encodePacket } = require(
  path.join(__dirname, "./tcp/utils/marshal"),
);
const { MACHONETMSG_TYPE } = require(
  path.join(__dirname, "../common/packetTypes"),
);
const { encodeAddress } = require(
  path.join(__dirname, "../common/machoAddress"),
);
const config = require(path.join(__dirname, "../config"));
const {
  composeSessionRoleMask,
} = require(path.join(
  __dirname,
  "../services/account/accountRoleProfiles",
));
const sessionChangeDebugPath = path.join(
  __dirname,
  "../../logs/session-change-debug.log",
);
const SESSION_CHANGE_ALLOWED_KEYS = new Set([
  "role",
  "countryCode",
  "charid",
  "corpid",
  "corpAccountKey",
  "allianceid",
  "factionid",
  "warfactionid",
  "genderID",
  "bloodlineID",
  "raceID",
  "schoolID",
  "stationid",
  "stationid2",
  "structureid",
  "solarsystemid",
  "solarsystemid2",
  "locationid",
  "worldspaceid",
  "constellationid",
  "regionid",
  "shipid",
  "fleetid",
  "fleetrole",
  "wingid",
  "squadid",
  "corprole",
  "rolesAtAll",
  "rolesAtBase",
  "rolesAtHQ",
  "rolesAtOther",
]);

function recordSpaceBootstrapTrace(session, event, details = {}) {
  if (!session || !log.isVerboseDebugEnabled()) {
    return false;
  }
  try {
    const spaceRuntime = require(path.join(__dirname, "../space/runtime"));
    if (
      spaceRuntime &&
      typeof spaceRuntime.recordSessionJumpTimingTrace === "function"
    ) {
      return (
        spaceRuntime.recordSessionJumpTimingTrace(session, event, details) === true
      );
    }
  } catch (error) {
    log.debug(
      `[Session] Failed to record space bootstrap trace: ${error.message}`,
    );
  }
  return false;
}

function summarizeOutgoingPacket(value, explicitMeta = null) {
  if (explicitMeta && typeof explicitMeta === "object") {
    return explicitMeta;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const packetName = String(value.name || "");
  if (packetName.endsWith("SessionChangeNotification")) {
    return {
      kind: "session-change",
      packetName,
    };
  }

  if (!packetName.endsWith("CallRsp")) {
    return null;
  }

  const args = Array.isArray(value.args) ? value.args : [];
  const sourceAddress = args[1];
  const sourceArgs =
    sourceAddress && Array.isArray(sourceAddress.args) ? sourceAddress.args : [];
  return {
    kind: "call-response",
    packetName,
    service:
      typeof sourceArgs[2] === "string" && sourceArgs[2].trim().length > 0
        ? sourceArgs[2]
        : null,
    callID: Number(sourceArgs[3]) || 0,
  };
}

function appendSessionChangeDebug(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    rotatingLog.append(sessionChangeDebugPath, `[${new Date().toISOString()}] ${entry}\n`);
  } catch (error) {
    log.warn(
      `[Session] Failed to write session change debug log: ${error.message}`,
    );
  }
}

function summarizeAttributeChangeCounts(changes = []) {
  const counts = new Map();
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!Array.isArray(change) || change.length < 4) {
      continue;
    }

    const attributeID = Number(change[3]);
    if (!Number.isFinite(attributeID)) {
      continue;
    }

    counts.set(attributeID, (counts.get(attributeID) || 0) + 1);
  }

  const entries = [...counts.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([attributeID, count]) => `${attributeID}x${count}`);

  if (entries.length <= 6) {
    return entries.join(",");
  }

  return `${entries.slice(0, 6).join(",")},+${entries.length - 6} more`;
}

function buildNotificationLogMessage(notifyType, idType, payloadTuple = []) {
  const base = `idType=${idType}`;
  if (notifyType !== "OnModuleAttributeChanges") {
    return base;
  }

  const payload = Array.isArray(payloadTuple) ? payloadTuple[0] : null;
  const changes =
    payload &&
    typeof payload === "object" &&
    payload.type === "list" &&
    Array.isArray(payload.items)
      ? payload.items
      : [];
  if (changes.length === 0) {
    return `${base} changes=0`;
  }

  return `${base} changes=${changes.length} attrs=${summarizeAttributeChangeCounts(changes)}`;
}

function currentFileTime() {
  return BigInt(Date.now()) * 10000n + 116444736000000000n;
}

function resolveBoundObjectRegistrationRefID(session, objectID) {
  if (
    !session ||
    typeof objectID !== "string" ||
    objectID.trim() === "" ||
    !session._boundObjectState ||
    typeof session._boundObjectState !== "object"
  ) {
    return currentFileTime();
  }

  for (const state of Object.values(session._boundObjectState)) {
    if (
      state &&
      typeof state === "object" &&
      state.objectID === objectID &&
      state.boundAtFileTime !== undefined &&
      state.boundAtFileTime !== null
    ) {
      return state.boundAtFileTime;
    }
  }

  return currentFileTime();
}

class ClientSession {
  /**
   * @param {object} handshakeData - Data from the completed handshake
   * @param {net.Socket} socket - The TCP socket for this client
   * @param {object} options - Encryption state (key, iv, encrypt/decrypt funcs)
   */
  constructor(handshakeData, socket, options = {}) {
    // Core identity
    this.userid = handshakeData.userId || 0;
    this.userName = handshakeData.userName || "";
    this.clientID = handshakeData.clientId || 0;
    this.clientId = this.clientID; // alias for camelCase consistency
    this.accountRole = handshakeData.accountRole || handshakeData.role || 0;
    this.chatRole = handshakeData.chatRole || handshakeData.role || 0;
    this.role = composeSessionRoleMask(
      this.accountRole,
      this.chatRole,
    );
    this.languageID = handshakeData.languageId || "EN";
    this.countryCode = handshakeData.countryCode || null;
    this.sid =
      typeof handshakeData.sessionId === "bigint"
        ? handshakeData.sessionId
        : BigInt(handshakeData.sessionId || (Date.now() * 15));
    this.sessionID = this.sid;

    // Character data (set after character selection)
    this.characterID = 0;
    this.characterName = "";
    this.characterTypeID = 1373;
    this.genderID = 1;
    this.bloodlineID = 1;
    this.raceID = 1;
    this.empireID = null;
    this.factionID = null;
    this.factionid = null;
    this.schoolID = null;
    this.corporationID = 0;
    this.allianceID = 0;
    this.stationID = 0;
    this.structureID = 0;
    this.solarsystemid = 0;
    this.constellationID = 0;
    this.regionID = 0;
    this.shipID = 0;
    this.shipName = "";
    this.fleetid = null;
    this.fleetrole = null;
    this.wingid = null;
    this.squadid = null;
    this.cloneStationID = 0;
    this.hqID = 0;
    this.baseID = 0;
    this.warFactionID = 0;

    // Network
    this.socket = socket;
    this.address = socket ? socket.remoteAddress : "unknown";

    // Encryption state
    this.encrypted = options.encrypted || false;
    this.sessionKey = options.sessionKey || null;
    this.sessionIV = options.sessionIV || null;
    this._encryptFn = options.encryptFn || null;
    this._decryptFn = options.decryptFn || null;

    // Timestamps
    this.connectTime = Date.now();
    this.lastActivity = Date.now();
    syncLedger.trackSocketLifecycle(this);
  }

  /**
   * Send a marshaled packet to this client.
   * The value is encoded, optionally encrypted, and framed with a 4-byte length.
   */
  sendPacket(value) {
    const pendingPerfMeta = this._pendingBootstrapPacketPerf || null;
    this._pendingBootstrapPacketPerf = null;
    const packetPerfMeta = summarizeOutgoingPacket(value, pendingPerfMeta);

    if (!this.socket || this.socket.destroyed) {
      log.warn(`[Session] Cannot send to ${this.address}: socket closed`);
      syncLedger.recordSyncLedgerEvent(this, "packet.dropped", {
        ...(packetPerfMeta || {}),
        reason: "socket-closed",
      });
      return;
    }

    this.lastActivity = Date.now();
    const packetLedger = syncLedger.recordSyncLedgerEvent(
      this,
      "packet.begin",
      packetPerfMeta || {},
    );

    // Marshal the value
    const encodeStartedAtMs = Date.now();
    const marshaled = marshalEncode(value);
    const encodeElapsedMs = Date.now() - encodeStartedAtMs;

    if (log.isPacketPayloadDebugEnabled()) {
      log.debug(`[Session] Sending packet (${marshaled.length} bytes)`);
      log.debug(
        `[Session] Outgoing hex: ${marshaled.toString("hex").substring(0, 160)}...`,
      );
    }

    const writeStartedAtMs = Date.now();
    const writeResult = this._writePayload(marshaled);
    const writeElapsedMs = Date.now() - writeStartedAtMs;

    syncLedger.recordSyncLedgerEvent(this, "packet.sent", {
      ...(packetPerfMeta || {}),
      packetSeq: packetLedger.seq,
      bytes: marshaled.length,
      encodeMs: encodeElapsedMs,
      writeMs: writeElapsedMs,
      encrypted: this.encrypted === true,
      writeAccepted:
        writeResult && Object.prototype.hasOwnProperty.call(writeResult, "writeAccepted")
          ? writeResult.writeAccepted
          : null,
      framedBytes: writeResult ? writeResult.framedBytes : null,
      socketWritableLength: this.socket ? Number(this.socket.writableLength || 0) : null,
    });

    if (packetPerfMeta) {
      recordSpaceBootstrapTrace(this, "outgoing-packet", {
        ...packetPerfMeta,
        bytes: marshaled.length,
        encodeMs: encodeElapsedMs,
        writeMs: writeElapsedMs,
        encrypted: this.encrypted === true,
      });
      if (encodeElapsedMs >= 100 || writeElapsedMs >= 25) {
        log.info(
          `[SessionPerf] packet kind=${packetPerfMeta.kind || "unknown"} ` +
          `service=${packetPerfMeta.service || "?"} callID=${Number(packetPerfMeta.callID) || 0} ` +
          `bytes=${marshaled.length} encodeMs=${encodeElapsedMs} writeMs=${writeElapsedMs}`,
        );
      }
    }
  }

  /**
   * Send a raw post-handshake payload to this client.
   * This bypasses marshal encoding but still uses the normal length-prefix and
   * session encryption path, which is what native BlueNet TiDi frames need.
   */
  sendRawPayload(payload, options = {}) {
    if (!this.socket || this.socket.destroyed) {
      log.warn(`[Session] Cannot send raw payload to ${this.address}: socket closed`);
      syncLedger.recordSyncLedgerEvent(this, "packet.dropped", {
        kind: "raw",
        label: options && options.label ? String(options.label) : "raw",
        reason: "socket-closed",
      });
      return;
    }

    if (!Buffer.isBuffer(payload)) {
      throw new TypeError("sendRawPayload expects a Buffer payload");
    }

    this.lastActivity = Date.now();

    const label = options.label || "raw";
    if (log.isPacketPayloadDebugEnabled()) {
      log.debug(`[Session] Sending raw payload (${payload.length} bytes) [${label}]`);
      log.debug(
        `[Session] Outgoing raw hex: ${payload.toString("hex").substring(0, 160)}...`,
      );
    }

    const startedAtMs = Date.now();
    const ledger = syncLedger.recordSyncLedgerEvent(this, "packet.begin", {
      kind: "raw",
      label,
      bytes: payload.length,
      encrypted: this.encrypted === true,
    });
    const writeResult = this._writePayload(payload);
    syncLedger.recordSyncLedgerEvent(this, "packet.sent", {
      kind: "raw",
      label,
      packetSeq: ledger.seq,
      bytes: payload.length,
      writeMs: Date.now() - startedAtMs,
      encrypted: this.encrypted === true,
      writeAccepted:
        writeResult && Object.prototype.hasOwnProperty.call(writeResult, "writeAccepted")
          ? writeResult.writeAccepted
          : null,
      framedBytes: writeResult ? writeResult.framedBytes : null,
      socketWritableLength: this.socket ? Number(this.socket.writableLength || 0) : null,
    });
  }

  _writePayload(payload) {
    if (this.encrypted && this._encryptFn) {
      // Encrypt, then frame
      const encrypted = this._encryptFn(payload);
      const header = Buffer.alloc(4);
      header.writeUInt32LE(encrypted.length, 0);
      const framed = Buffer.concat([header, encrypted]);
      return {
        bodyBytes: encrypted.length,
        framedBytes: framed.length,
        writeAccepted: this.socket.write(framed) !== false,
      };
    } else {
      // Frame without encryption
      const header = Buffer.alloc(4);
      header.writeUInt32LE(payload.length, 0);
      const framed = Buffer.concat([header, payload]);
      return {
        bodyBytes: payload.length,
        framedBytes: framed.length,
        writeAccepted: this.socket.write(framed) !== false,
      };
    }
  }

  /**
   * Decrypt incoming raw packet data.
   * @param {Buffer} data - Raw payload (after removing 4-byte length header)
   * @returns {Buffer} Decrypted data
   */
  decryptPacket(data) {
    if (this.encrypted && this._decryptFn) {
      return this._decryptFn(data);
    }
    return data;
  }

  /**
   * Send a SessionChangeNotification (type 16) to the client.
   *
   * This is sent after character selection to inform the client of
   * all session attribute changes (characterID, stationID, etc.).
   *
   * The payload format is: [sessionID, sessionDict]
   *   sessionDict contains entries of [oldValue, newValue] pairs.
   *
   * From EVEmu C++ SessionChangeNotification::Encode():
   *   PyObject("macho.SessionChangeNotification", [type, src, dst, userID, payload, {}, null])
   */
  sendSessionChange(changes, options = {}) {
    if (!this.socket || this.socket.destroyed) {
      syncLedger.recordSyncLedgerEvent(this, "packet.dropped", {
        kind: "session-change",
        reason: "socket-closed",
      });
      return;
    }

    // Build the session change dict — each entry is [oldValue, newValue]
    const changeEntries = [];
    for (const [key, [oldVal, newVal]] of Object.entries(changes)) {
      if (!SESSION_CHANGE_ALLOWED_KEYS.has(key)) {
        appendSessionChangeDebug(
          `drop key=${key} old=${JSON.stringify(oldVal, (k, v) => (typeof v === "bigint" ? v.toString() : v))} new=${JSON.stringify(newVal, (k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
        );
        continue;
      }
      changeEntries.push([key, [oldVal, newVal]]);
    }
    const sessionID =
      options && Object.prototype.hasOwnProperty.call(options, "sessionId")
        ? typeof options.sessionId === "bigint"
          ? options.sessionId
          : BigInt(options.sessionId || 0)
        : this.sid;

    if (changeEntries.length === 0 && options.allowEmpty !== true) {
      appendSessionChangeDebug(
        `skip sid=${String(sessionID)} reason=empty payload=[]`,
      );
      return;
    }

    appendSessionChangeDebug(
      `send sid=${String(sessionID)} keys=${JSON.stringify(changeEntries.map(([key]) => key))} payload=${JSON.stringify(changeEntries, (k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
    );

    // SessionChangeNotification payload per General.xmlp:
    //   tuple(sessionID: long, tuple(clueless: int, changes: dict), nodesOfInterest: listInt)
    const payload = [
      { type: "long", value: sessionID }, // sessionID
      [0, { type: "dict", entries: changeEntries }], // [clueless=0, changes dict]
      { type: "list", items: [-1, config.proxyNodeId] }, // nodesOfInterest
    ];

    const responseTuple = [
      MACHONETMSG_TYPE.SESSIONCHANGENOTIFICATION, // type = 16
      encodeAddress({
        type: "node",
        nodeID: config.proxyNodeId,
        callID: 0,
        service: null,
      }),
      encodeAddress({
        type: "client",
        clientID: this.clientID,
        callID: 0,
        service: null,
      }),
      this.userid || null,
      payload, // payload tuple (NOT wrapped in extra array)
      { type: "dict", entries: [] }, // named payload
      null, // contextKey
      null, // traceID/bssid (8th element required)
      null, // spanID/bssctx (9th element required)
      null, // 10th
      null, // 11th
      null, // 12th
      null, // 13th
      null, // 14th
    ];

    const packet = {
      type: "object",
      name: "carbon.common.script.net.machoNetPacket.SessionChangeNotification",
      args: responseTuple,
    };

    log.pktOut(
      "SessionChange",
      `${changeEntries.length} changes → ${changeEntries.map(([k]) => k).join(", ")}`,
    );
    this._pendingBootstrapPacketPerf = {
      kind: "session-change",
      packetName: packet.name,
      changeKeys: changeEntries.map(([key]) => key),
      sessionID: String(sessionID),
    };
    this.sendPacket(packet);

    if (changeEntries.length > 0) {
      try {
        const {
          synchronizeSessionChatState,
        } = require(path.join(__dirname, "../services/chat/sessionChatSync"));
        if (typeof synchronizeSessionChatState === "function") {
          synchronizeSessionChatState(this, Object.fromEntries(changeEntries));
        }
      } catch (error) {
        log.debug(
          `[Session] Skipped chat sync after session change: ${error.message}`,
        );
      }
    }
  }

  /**
   * Send a MACHONETMSG_TYPE.NOTIFICATION to the client.
   * Mirrors EVEmu's `Client::SendNotification(notifyType, idType, payload)`
   */
  sendNotification(notifyType, idType, payloadTuple = []) {
    if (!this.socket || this.socket.destroyed) {
      syncLedger.recordSyncLedgerEvent(this, "packet.dropped", {
        kind: "notification",
        notifyType: notifyType || "Notification",
        idType: idType || "ownerid",
        reason: "socket-closed",
        ...syncLedger.summarizeNotificationPayload(
          notifyType || "Notification",
          payloadTuple,
        ),
      });
      return;
    }

    // Source address: Node
    // C++: packet->source.type = PyAddress::Node; packet->source.objectID = m_services.GetNodeID();
    const sourceAddr = encodeAddress({
      type: "node",
      nodeID: config.proxyNodeId,
    });

    // Dest address: Broadcast
    // C++: dest.type = PyAddress::Broadcast; dest.service = notifyType; dest.bcast_idtype = idType; dest.objectID = GetClientID();
    const destAddr = encodeAddress({
      type: "broadcast",
      idtype: idType || "ownerid",
      broadcastID: notifyType, // ServiceCallGPCS expects notifyType to be the broadcastID
    });

    // explicitly marshal [1, payloadTuple] so BroadcastStuffGPCS properly parses the args array
    // 1 = object/RPC call, 0 = simple byte transfer
    const unpickledPayload = [1, payloadTuple];
    const innerMarshalStartedAtMs = Date.now();
    const marshalledPayload = marshalEncode(unpickledPayload);
    const innerMarshalElapsedMs = Date.now() - innerMarshalStartedAtMs;

    const responseTuple = [
      MACHONETMSG_TYPE.NOTIFICATION,
      sourceAddr,
      destAddr,
      this.userid || null,
      [[0, marshalledPayload]], // payload argument: must double wrap because the Notification packet has 1 param 'payload'
      { type: "dict", entries: [] }, // named payload
      null, // contextKey
      null, // traceID/bssid (8th element required)
      null, // spanID/bssctx (9th element required)
      null, // 10th
      null, // 11th
      null, // 12th
      null, // 13th
      null, // 14th
    ];

    const packet = {
      type: "object",
      name: "carbon.common.script.net.machoNetPacket.Notification",
      args: responseTuple,
    };

    log.pktOut(
      notifyType || "Notification",
      buildNotificationLogMessage(notifyType, idType, payloadTuple),
    );
    this._pendingBootstrapPacketPerf = {
      kind: "notification",
      notifyType: notifyType || "Notification",
      idType: idType || "ownerid",
      innerBytes: marshalledPayload.length,
      innerMarshalMs: innerMarshalElapsedMs,
      ...syncLedger.summarizeNotificationPayload(
        notifyType || "Notification",
        payloadTuple,
      ),
    };
    this.sendPacket(packet);
  }

  /**
   * Send a MACHONETMSG_TYPE.NOTIFICATION to a specific client-side service.
   * This is required for notifications like `michelle.OnSlimItemChange`,
   * where the service must transform raw wire args before scattering them.
   */
  sendServiceNotification(serviceName, methodName, payloadTuple = [], kwargs = null) {
    if (!this.socket || this.socket.destroyed) {
      syncLedger.recordSyncLedgerEvent(this, "packet.dropped", {
        kind: "service-notification",
        service: serviceName || null,
        method: methodName,
        reason: "socket-closed",
        argCount: Array.isArray(payloadTuple) ? payloadTuple.length : 0,
      });
      return;
    }

    const sourceAddr = encodeAddress({
      type: "node",
      nodeID: config.proxyNodeId,
    });

    const destAddr = encodeAddress({
      // EVE's client-side service notifications target MachoAddress(service=...),
      // i.e. the wire form our local encoder aliases as type "service".
      type: "service",
      service: serviceName || null,
    });

    const unpickledPayload = kwargs
      ? [1, methodName, payloadTuple, kwargs]
      : [1, methodName, payloadTuple];
    const innerMarshalStartedAtMs = Date.now();
    const marshalledPayload = marshalEncode(unpickledPayload);
    const innerMarshalElapsedMs = Date.now() - innerMarshalStartedAtMs;

    const responseTuple = [
      MACHONETMSG_TYPE.NOTIFICATION,
      sourceAddr,
      destAddr,
      this.userid || null,
      [[0, marshalledPayload]],
      { type: "dict", entries: [] },
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ];

    const packet = {
      type: "object",
      name: "carbon.common.script.net.machoNetPacket.Notification",
      args: responseTuple,
    };

    log.pktOut(serviceName || "Notification", `${methodName}()`);
    this._pendingBootstrapPacketPerf = {
      kind: "service-notification",
      service: serviceName || null,
      method: methodName,
      innerBytes: marshalledPayload.length,
      innerMarshalMs: innerMarshalElapsedMs,
      argCount: Array.isArray(payloadTuple) ? payloadTuple.length : 0,
    };
    this.sendPacket(packet);
  }

  /**
   * Send a MACHONETMSG_TYPE.NOTIFICATION to a bound client-side object.
   * This uses the object-call notification lane rather than exported service
   * notifications, which is required for methods like `Michelle.OnDbuffUpdated`.
   */
  sendObjectNotification(objectID, methodName, payloadTuple = [], kwargs = null) {
    if (!this.socket || this.socket.destroyed) {
      syncLedger.recordSyncLedgerEvent(this, "packet.dropped", {
        kind: "object-notification",
        objectID,
        method: methodName,
        reason: "socket-closed",
        argCount: Array.isArray(payloadTuple) ? payloadTuple.length : 0,
      });
      return;
    }
    if (typeof objectID !== "string" || objectID.trim() === "") return;
    if (typeof methodName !== "string" || methodName.trim() === "") return;

    const sourceAddr = encodeAddress({
      type: "node",
      nodeID: config.proxyNodeId,
    });

    const destAddr = encodeAddress({
      // Bound-object notifications ride the object-call lane, not the
      // broadcast/service wrapper. Route them as node-bound notifications so
      // the client enters ObjectCallGPCS.NotifyUp and resolves the object ID
      // directly instead of falling through to BroadcastStuff.
      type: "node",
      nodeID: config.proxyNodeId,
      service: null,
    });

    const objectPayload = kwargs
      ? [objectID, methodName, payloadTuple, kwargs]
      : [objectID, methodName, payloadTuple];
    const marshalledObjectPayload = marshalEncode(objectPayload);
    const objectRegistrationRefID = resolveBoundObjectRegistrationRefID(
      this,
      objectID,
    );

    const responseTuple = [
      MACHONETMSG_TYPE.NOTIFICATION,
      sourceAddr,
      destAddr,
      this.userid || null,
      [[1, marshalledObjectPayload]],
      { type: "dict", entries: [] },
      {
        type: "dict",
        entries: [[
          "OID+",
          {
            type: "dict",
            entries: [[objectID, objectRegistrationRefID]],
          },
        ]],
      },
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ];

    const packet = {
      type: "object",
      name: "carbon.common.script.net.machoNetPacket.Notification",
      args: responseTuple,
    };

    log.pktOut(objectID, `${methodName}()`);
    this._pendingBootstrapPacketPerf = {
      kind: "object-notification",
      objectID,
      method: methodName,
      innerBytes: marshalledObjectPayload.length,
      argCount: Array.isArray(payloadTuple) ? payloadTuple.length : 0,
    };
    this.sendPacket(packet);
  }

  /**
   * Get a summary of this session for logging.
   */
  toString() {
    return `[Session ${this.address} user=${this.userName}(${this.userid}) char=${this.characterName}(${this.characterID})]`;
  }
}

module.exports = ClientSession;
