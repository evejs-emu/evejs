const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const ClientSession = require(path.join(
  repoRoot,
  "server/src/network/clientSession",
));
const PacketDispatcher = require(path.join(
  repoRoot,
  "server/src/network/packetDispatcher",
));
const config = require(path.join(
  repoRoot,
  "server/src/config",
));
const {
  buildBoundObjectResponse,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/serviceHelpers",
));

function buildSocket() {
  const writes = [];
  return {
    socket: {
      destroyed: false,
      remoteAddress: "127.0.0.1",
      write(buffer) {
        writes.push(Buffer.from(buffer));
      },
    },
    writes,
  };
}

test("sendRawPayload writes a normal framed payload when unencrypted", () => {
  const { socket, writes } = buildSocket();
  const session = new ClientSession({}, socket);
  const payload = Buffer.from([0xaa, 0xbb, 0xcc]);

  session.sendRawPayload(payload, { label: "tidi-test" });

  assert.equal(writes.length, 1);
  assert.deepEqual(
    writes[0],
    Buffer.from([0x03, 0x00, 0x00, 0x00, 0xaa, 0xbb, 0xcc]),
  );
});

test("sendRawPayload reuses the encrypted framing path", () => {
  const { socket, writes } = buildSocket();
  const session = new ClientSession({}, socket, {
    encrypted: true,
    encryptFn(payload) {
      return Buffer.concat([Buffer.from([0xfe]), payload]);
    },
  });
  const payload = Buffer.from([0x10, 0x20]);

  session.sendRawPayload(payload, { label: "tidi-test" });

  assert.equal(writes.length, 1);
  assert.deepEqual(
    writes[0],
    Buffer.from([0x03, 0x00, 0x00, 0x00, 0xfe, 0x10, 0x20]),
  );
});

test("sendRawPayload rejects non-buffer payloads", () => {
  const { socket } = buildSocket();
  const session = new ClientSession({}, socket);

  assert.throws(
    () => session.sendRawPayload("not-a-buffer"),
    /Buffer payload/,
  );
});

test("sendSessionChange skips empty payloads unless explicitly allowed", () => {
  const { socket } = buildSocket();
  const session = new ClientSession({ clientId: 65450, userId: 7 }, socket);
  let packetCount = 0;
  session.sendPacket = () => {
    packetCount += 1;
  };

  session.sendSessionChange({});
  assert.equal(packetCount, 0);

  session.sendSessionChange({}, { allowEmpty: true });
  assert.equal(packetCount, 1);
});

test("sendObjectNotification uses the object-call wrapper and client-parity node addressing", () => {
  const { socket } = buildSocket();
  const session = new ClientSession({ clientId: 65450, userId: 7 }, socket);
  session._boundObjectState = {
    beyonce: {
      objectID: "N=65450:12",
      boundAtFileTime: 123456789n,
    },
  };
  let packet = null;
  session.sendPacket = (value) => {
    packet = value;
  };

  session.sendObjectNotification(
    "N=65450:12",
    "OnDbuffUpdated",
    [991006224, { type: "list", items: [] }],
  );

  assert.ok(packet);
  assert.equal(
    packet.name,
    "carbon.common.script.net.machoNetPacket.Notification",
  );
  assert.equal(packet.args[2].name, "carbon.common.script.net.machoNetPacket.MachoAddress");
  assert.deepEqual(
    packet.args[2].args,
    [1, config.proxyNodeId, null, null],
  );
  assert.ok(Array.isArray(packet.args[4]));
  assert.equal(packet.args[4].length, 1);
  assert.equal(packet.args[4][0][0], 1);
  assert.ok(Buffer.isBuffer(packet.args[4][0][1]));
  assert.ok(packet.args[6]);
  assert.equal(packet.args[6].type, "dict");
  const oidEntry = packet.args[6].entries.find(([entryKey]) => entryKey === "OID+");
  assert.ok(oidEntry);
  assert.equal(oidEntry[1].type, "dict");
  assert.deepEqual(oidEntry[1].entries, [["N=65450:12", 123456789n]]);
});

test("buildBoundObjectResponse reuses the same bound object ID for Beyonce within one session", () => {
  const session = {
    clientID: 65450,
    _boundObjectIDs: {},
  };
  let nestedCallCount = 0;
  const service = {
    name: "beyonce",
    reuseBoundObjectForSession: true,
    callMethod() {
      nestedCallCount += 1;
      return null;
    },
  };
  const args = [null, ["CmdGotoDirection", []]];

  const firstResponse = buildBoundObjectResponse(service, args, session, null);
  const secondResponse = buildBoundObjectResponse(service, args, session, null);

  assert.equal(nestedCallCount, 2);
  assert.ok(Array.isArray(firstResponse));
  assert.ok(Array.isArray(secondResponse));
  assert.equal(
    firstResponse[0].value.value[0],
    secondResponse[0].value.value[0],
    "expected Beyonce bound object ID to stay stable within a session",
  );
  assert.equal(
    firstResponse[0].value.value[1],
    secondResponse[0].value.value[1],
    "expected Beyonce bind filetime to stay stable within a session",
  );
  assert.equal(session._boundObjectIDs.beyonce, firstResponse[0].value.value[0]);
});

test("bind call responses include OID+ registration metadata for bound objects", () => {
  const { socket } = buildSocket();
  const session = new ClientSession({ clientId: 65450, userId: 7 }, socket);
  let packet = null;
  session.sendPacket = (value) => {
    packet = value;
  };

  const dispatcher = new PacketDispatcher({
    lookup() {
      return null;
    },
    registerBoundObject() {},
  });
  const service = {
    name: "beyonce",
    reuseBoundObjectForSession: true,
    callMethod() {
      return null;
    },
  };
  const bindResult = buildBoundObjectResponse(
    service,
    [null, ["CmdGotoDirection", []]],
    session,
    null,
  );
  const boundObjectID = bindResult[0].value.value[0];
  const boundRefID = bindResult[0].value.value[1];

  dispatcher._sendCallResponse({
    source: {
      type: "client",
      clientID: 65450,
      callID: 91,
      service: null,
    },
    dest: {
      type: "node",
      nodeID: config.proxyNodeId,
      service: "beyonce",
      callID: null,
    },
    oob: null,
    bssid: null,
    spanid: null,
    extra9: null,
    extra10: null,
    extra11: null,
    extra12: null,
    extra13: null,
  }, bindResult, session, "beyonce");

  assert.ok(packet);
  assert.equal(packet.name, "carbon.common.script.net.machoNetPacket.CallRsp");
  assert.ok(packet.args[6], "Expected CallRsp to carry object-registration oob");
  assert.equal(packet.args[6].type, "dict");

  const oidEntry = packet.args[6].entries.find(([entryKey]) => entryKey === "OID+");
  assert.ok(oidEntry, "Expected CallRsp oob to contain OID+ registration metadata");
  assert.equal(oidEntry[1].type, "dict");

  const objectEntry = oidEntry[1].entries.find(([entryKey]) => entryKey === boundObjectID);
  assert.ok(objectEntry, "Expected OID+ metadata to register the Beyonce bound object");
  assert.equal(objectEntry[1], boundRefID);
});
