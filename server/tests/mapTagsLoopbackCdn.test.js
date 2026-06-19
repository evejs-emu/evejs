"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..");
const expressProxy = require(path.join(
  repoRoot,
  "server/src/_secondary/express/server",
));
const {
  LOCAL_TLS_DNS_ALT_NAMES,
  LOCAL_TLS_IP_ALT_NAMES,
  hasRequiredAltNames,
} = require(path.join(
  repoRoot,
  "server/src/_secondary/express/localTlsCertificate",
));
const {
  MAP_TAGS_CDN_PATH,
  MAP_TAGS_CDN_URL,
  getMapTagsCrc,
  getMapTagsVersion,
} = require(path.join(
  repoRoot,
  "server/src/services/map/mapTagsAuthority",
));
const {
  MAP_TAGS_GET_UPDATE_RESPONSE_TYPE,
  createMapTagsGatewayService,
  getMapTagsGatewayProtoRoot,
} = require(path.join(
  repoRoot,
  "server/src/_secondary/express/gatewayServices/mapTagsGatewayService",
));

function waitForListening(server) {
  if (server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function fetchLocalAsset(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      {
        hostname: "127.0.0.1",
        port,
        path: requestPath,
        rejectUnauthorized: false,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    request.on("error", reject);
  });
}

test("loopback HTTPS responder serves the announced map-tags asset and 404s unknown paths", async (t) => {
  assert.equal(
    MAP_TAGS_CDN_URL,
    `https://127.0.0.1${MAP_TAGS_CDN_PATH}`,
  );

  const expectedAsset =
    expressProxy.__testHooks.getGatewayBinaryAsset(MAP_TAGS_CDN_PATH);
  assert.ok(expectedAsset);
  assert.ok(expectedAsset.buffer.length > 0);

  const server =
    expressProxy.__testHooks.createLoopbackCdnResponder(26003, 0);
  assert.ok(server);
  t.after(() => closeServer(server));
  await waitForListening(server);

  const port = server.address().port;
  const response = await fetchLocalAsset(port, MAP_TAGS_CDN_PATH);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "application/octet-stream");
  assert.deepEqual(response.body, expectedAsset.buffer);

  const missingResponse = await fetchLocalAsset(port, "/not-a-public-asset");
  assert.equal(missingResponse.statusCode, 404);
});

test("map-tags gateway omits checkpoint when content is current", () => {
  const root = getMapTagsGatewayProtoRoot();
  const requestType = root.lookupType(
    "eve_public.space.api.cdn.GetUpdateRequest",
  );
  const responseType = root.lookupType(MAP_TAGS_GET_UPDATE_RESPONSE_TYPE);
  const service = createMapTagsGatewayService();
  const version = getMapTagsVersion();

  function assertVersion(actual) {
    assert.equal(actual.major, version.major);
    assert.equal(actual.minor, version.minor);
    assert.equal(actual.patch, version.patch);
    assert.deepEqual(actual.prerelease_tags, version.prerelease_tags);
    assert.deepEqual(actual.build_tags, version.build_tags);
  }

  function requestUpdate(payload) {
    const requestPayload = Buffer.from(
      requestType.encode(requestType.create(payload)).finish(),
    );
    const result = service.handleRequest(
      "eve_public.space.api.cdn.requests_pb2.GetUpdateRequest",
      {
        payload: {
          value: requestPayload,
        },
      },
    );
    assert.equal(result.statusCode, 200);
    return responseType.decode(result.responsePayloadBuffer);
  }

  const initialResponse = requestUpdate({
    no_local_version_available: true,
  });
  assert.equal(initialResponse.checkpoint.url, MAP_TAGS_CDN_URL);
  assertVersion(initialResponse.checkpoint.version);
  assert.equal(initialResponse.checkpoint.crc.crc, getMapTagsCrc());

  const currentResponse = requestUpdate({
    current_version: version,
  });
  assert.equal(currentResponse.checkpoint, null);
});

test("local TLS certificate is limited to Public gateway names", () => {
  assert.deepEqual([...LOCAL_TLS_DNS_ALT_NAMES], [
    "dev-public-gateway.evetech.net",
    "public-gateway.evetech.net",
    "localhost",
  ]);
  assert.deepEqual([...LOCAL_TLS_IP_ALT_NAMES], ["127.0.0.1"]);
  assert.equal(
    LOCAL_TLS_DNS_ALT_NAMES.some((name) =>
      String(name).toLowerCase().includes("launchdarkly"),
    ),
    false,
  );

  const certPath = path.join(
    repoRoot,
    "server/src/_secondary/express/certs/gateway-dev-cert.pem",
  );
  assert.equal(hasRequiredAltNames(fs.readFileSync(certPath, "utf8")), true);

  for (const relativePath of [
    "server/src/_secondary/express/launchDarklyLocalService.js",
    "server/src/newDatabase/data/launchDarklyFlags/data.json",
    "tools/ClientSETUP/scripts/EnsureLaunchDarklyHostRedirects.ps1",
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, relativePath)), false);
  }
});
