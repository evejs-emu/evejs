const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const publicGatewayLocal = require(path.join(
  repoRoot,
  "server/src/_secondary/express/publicGatewayLocal",
));

function toNumber(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "object" && typeof value.toNumber === "function") {
    return value.toNumber();
  }

  return Number(value);
}

function buildGatewayRequest(typeName, payload) {
  const requestType = publicGatewayLocal._testing.PROTO_ROOT.lookupType(typeName);
  const encodedPayload = Buffer.from(
    requestType.encode(requestType.create(payload || {})).finish(),
  );
  const envelope = publicGatewayLocal._testing.RequestEnvelope.create({
    payload: {
      type_url: `type.googleapis.com/${typeName}`,
      value: encodedPayload,
    },
  });
  return Buffer.from(
    publicGatewayLocal._testing.RequestEnvelope.encode(envelope).finish(),
  );
}

function decodeGatewayResponse(buffer) {
  return publicGatewayLocal._testing.ResponseEnvelope.decode(buffer);
}

test("public gateway returns CCP-compatible suppression system info stub payloads", () => {
  const requestBuffer = buildGatewayRequest(
    "eve_public.pirate.suppression.api.GetSystemInfoRequest",
    {
      system: { sequential: 30000142 },
    },
  );
  const responseBuffer =
    publicGatewayLocal.buildGatewayResponseForRequest(requestBuffer);
  const responseEnvelope = decodeGatewayResponse(responseBuffer);
  const responseType = publicGatewayLocal._testing.PROTO_ROOT.lookupType(
    "eve_public.pirate.suppression.api.GetSystemInfoResponse",
  );
  const payload = responseType.decode(responseEnvelope.payload.value);

  assert.equal(responseEnvelope.status_code, 200);
  assert.equal(
    responseEnvelope.status_message,
    "",
  );
  assert.equal(
    responseEnvelope.payload.type_url,
    "type.googleapis.com/eve_public.pirate.suppression.api.GetSystemInfoResponse",
  );
  assert.equal(toNumber(payload.stage), 0);
  assert.equal(toNumber(payload.total_progress.numerator), 0);
  assert.equal(toNumber(payload.total_progress.denominator), 1);
  assert.equal(toNumber(payload.eve_contribution.denominator), 1);
  assert.equal(toNumber(payload.vanguard_contribution.denominator), 1);
});
