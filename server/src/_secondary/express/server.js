const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const net = require("net");
const http2 = require("http2");
const crypto = require("crypto");

const config = require("../../config");
const log = require("../../utils/logger");
const {
  ensureLocalLeafCertificate,
} = require("./localTlsCertificate");

let gatewayStreamHandler = null;
let mapTagsCdnAssetResolver = null;

function getGatewayStreamHandler() {
  if (!gatewayStreamHandler) {
    ({ handleGatewayStream: gatewayStreamHandler } = require("./publicGatewayLocal"));
  }
  return gatewayStreamHandler;
}

function getMapTagsCdnAsset(routePath) {
  if (!mapTagsCdnAssetResolver) {
    ({ getMapTagsCdnAsset: mapTagsCdnAssetResolver } =
      require("./gatewayServices/mapTagsGatewayService"));
  }
  return mapTagsCdnAssetResolver(routePath);
}

function getGatewayBinaryAsset(routePath) {
  return getMapTagsCdnAsset(routePath) || null;
}

function shouldEnableLocalInterceptByDefault() {
  try {
    const redirectUrl = new URL(config.microservicesRedirectUrl);
    return isLoopbackHost(redirectUrl.hostname);
  } catch {
    return false;
  }
}

function parseBooleanEnv(value, fallback = false) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseOptionalUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  try {
    return new URL(normalized);
  } catch {
    return null;
  }
}

function parseNonNegativeIntegerEnv(value, fallback) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function parseHostPatternList(value) {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function hostMatchesPattern(hostname, pattern) {
  const normalizedHost = String(hostname || "").trim().toLowerCase();
  const normalizedPattern = String(pattern || "").trim().toLowerCase();

  if (!normalizedHost || !normalizedPattern) {
    return false;
  }

  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(1);
    return (
      normalizedHost === normalizedPattern.slice(2) ||
      normalizedHost.endsWith(suffix)
    );
  }

  if (normalizedPattern.startsWith(".")) {
    return (
      normalizedHost === normalizedPattern.slice(1) ||
      normalizedHost.endsWith(normalizedPattern)
    );
  }

  return normalizedHost === normalizedPattern;
}

function hostMatchesAnyPattern(hostname, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return false;
  }

  return patterns.some((pattern) => hostMatchesPattern(hostname, pattern));
}

function hostExistsInCollection(hostname, collection) {
  const normalizedHost = String(hostname || "").trim().toLowerCase();
  if (!normalizedHost) {
    return false;
  }

  if (collection instanceof Set) {
    return collection.has(normalizedHost);
  }

  if (Array.isArray(collection)) {
    return collection.some(
      (entry) => String(entry || "").trim().toLowerCase() === normalizedHost,
    );
  }

  return false;
}

function shouldInterceptHost(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return LOCAL_INTERCEPT_HOSTS.has(normalized);
}

function shouldBlockHost(hostname) {
  return BLOCKED_PROXY_HOSTS.some((pattern) =>
    hostMatchesPattern(hostname, pattern),
  );
}

function shouldAllowListedHost(hostname, allowedHosts) {
  return hostMatchesAnyPattern(hostname, allowedHosts);
}

function normalizeUnhandledProxyHostPolicy(policy) {
  return String(policy || "block").trim().toLowerCase() === "forward"
    ? "forward"
    : "block";
}

function shouldDenyUnhandledProxyHost(hostname, options = {}) {
  const normalizedHost = String(hostname || "").trim().toLowerCase();
  if (!normalizedHost) {
    return true;
  }

  const interceptHosts = options.interceptHosts || LOCAL_INTERCEPT_HOSTS;
  const allowedHosts = Array.isArray(options.allowedHosts)
    ? options.allowedHosts
    : ALLOWED_PROXY_HOSTS;
  const policy = normalizeUnhandledProxyHostPolicy(options.policy);

  if (hostExistsInCollection(normalizedHost, interceptHosts)) {
    return false;
  }

  if (shouldAllowListedHost(normalizedHost, allowedHosts)) {
    return false;
  }

  return policy !== "forward";
}

function makeResponsePayload(req) {
  return {
    status: "ok",
    message: "microservice placeholder response",
    method: req.method,
    path: req.originalUrl || req.url,
    host: req.headers.host || null,
    timestamp: new Date().toISOString(),
  };
}

function makeHttp2Payload(headers) {
  return {
    status: "ok",
    message: "microservice placeholder response",
    method: headers[":method"] || null,
    path: headers[":path"] || null,
    host: headers[":authority"] || headers.host || null,
    timestamp: new Date().toISOString(),
  };
}

function buildBinaryAssetHeaders(asset) {
  return {
    "content-type": asset.contentType || "application/octet-stream",
    "content-length": String(asset.buffer.length),
    "cache-control": "no-store",
  };
}

function parseConnectTarget(connectUrl) {
  const raw = String(connectUrl || "").trim();
  if (!raw) {
    return { host: null, port: null };
  }

  const idx = raw.lastIndexOf(":");
  if (idx === -1) {
    return { host: raw.toLowerCase(), port: 443 };
  }

  const host = raw.slice(0, idx).toLowerCase();
  const parsedPort = Number.parseInt(raw.slice(idx + 1), 10);
  return {
    host,
    port: Number.isFinite(parsedPort) ? parsedPort : 443,
  };
}

function parseHttpProxyTarget(req) {
  const rawUrl = String(req.url || "");
  if (/^https?:\/\//i.test(rawUrl)) {
    try {
      return new URL(rawUrl);
    } catch {
      return null;
    }
  }
  return null;
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function getUrlPort(targetUrl) {
  const parsedPort = Number.parseInt(targetUrl.port || "", 10);
  if (Number.isFinite(parsedPort) && parsedPort > 0) {
    return parsedPort;
  }
  return targetUrl.protocol === "https:" ? 443 : 80;
}

function pipeHttpRequest(req, res, targetUrl) {
  const requestImpl = targetUrl.protocol === "https:" ? https : http;
  const targetHost = targetUrl.hostname;
  const targetPort = getUrlPort(targetUrl);

  const headers = { ...req.headers };
  headers.host = targetUrl.host;
  delete headers["proxy-connection"];

  log.proxy(`${req.method} ${targetUrl.href} -> ${targetHost}:${targetPort}`);

  const upstreamReq = requestImpl.request(
    {
      host: targetHost,
      port: targetPort,
      method: req.method,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      headers,
    },
    (upstreamRes) => {
      res.statusCode = upstreamRes.statusCode || 502;
      for (const [k, v] of Object.entries(upstreamRes.headers)) {
        if (typeof v !== "undefined") {
          res.setHeader(k, v);
        }
      }
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on("error", (err) => {
    log.proxyErr(`forward failed ${targetUrl.href} ${err.message}`);
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader("content-type", "text/plain");
    }
    res.end("Bad Gateway");
  });

  req.pipe(upstreamReq);
}

function blockHttpProxyRequest(req, res, targetUrl) {
  log.proxy(`block ${req.method} ${targetUrl.href} -> local deny`);
  res.statusCode = 204;
  res.setHeader("x-evejs-proxy-blocked", "true");
  res.end();
}

function loadLocalTlsOptions() {
  const certDir = path.join(__dirname, "./certs");
  const certificateResult = ensureLocalLeafCertificate({ certDir });
  const gatewayLeafCertPath = path.join(certDir, "gateway-dev-cert.pem");
  const gatewayLeafKeyPath = path.join(certDir, "gateway-dev-key.pem");
  const pfxPath = path.join(certDir, "gateway-dev.pfx");
  const passphrasePath = path.join(certDir, "gateway-dev-passphrase.txt");
  const certPath = path.join(certDir, "gateway-dev-cert.pem");

  if (certificateResult.rebuilt) {
    log.debug("rebuilt local public-gateway TLS certificate");
  }

  if (fs.existsSync(gatewayLeafCertPath) && fs.existsSync(gatewayLeafKeyPath)) {
    return {
      tlsOptions: {
        key: fs.readFileSync(gatewayLeafKeyPath),
        cert: fs.readFileSync(gatewayLeafCertPath),
        allowHTTP1: true,
        ALPNProtocols: ["h2", "http/1.1"],
      },
      certPem: fs.readFileSync(gatewayLeafCertPath),
    };
  }

  if (fs.existsSync(pfxPath)) {
    return {
      tlsOptions: {
        pfx: fs.readFileSync(pfxPath),
        passphrase: fs.existsSync(passphrasePath)
          ? fs.readFileSync(passphrasePath, "utf8").trim()
          : "",
        allowHTTP1: true,
        ALPNProtocols: ["h2", "http/1.1"],
      },
      certPem: fs.existsSync(certPath) ? fs.readFileSync(certPath) : null,
    };
  }

  const legacyCertPath = path.join(certDir, "cert.pem");
  const legacyKeyPath = path.join(certDir, "key.pem");
  return {
    tlsOptions: {
      key: fs.readFileSync(legacyKeyPath),
      cert: fs.readFileSync(legacyCertPath),
      allowHTTP1: true,
      ALPNProtocols: ["h2", "http/1.1"],
    },
    certPem: fs.readFileSync(legacyCertPath),
  };
}

function createLoopbackCdnRequestHandler() {
  return (req, res) => {
    const routePath = String(req.url || "/");
    const binaryAsset =
      String(req.method || "").toUpperCase() === "GET"
        ? getGatewayBinaryAsset(routePath)
        : null;
    if (binaryAsset) {
      res.writeHead(200, buildBinaryAssetHeaders(binaryAsset));
      res.end(binaryAsset.buffer);
      return;
    }

    res.writeHead(404, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end("Not Found");
  };
}

function createLoopbackCdnResponder(activeHttpsPort, listenPort = 443) {
  if (activeHttpsPort === listenPort) {
    return null;
  }

  const { tlsOptions } = loadLocalTlsOptions();
  const server = https.createServer(
    tlsOptions,
    createLoopbackCdnRequestHandler(),
  );

  server.on("error", (err) => {
    log.http2Err(
      `loopback CDN responder failed on 127.0.0.1:${listenPort}: ${err.message}`,
    );
  });
  server.listen(listenPort, "127.0.0.1", () => {
    log.debug(
      `loopback CDN responder listening on 127.0.0.1:${listenPort}`,
    );
  });
  return server;
}

function createLocalSecureResponder(httpsPort, bindHost) {
  const { tlsOptions, certPem } = loadLocalTlsOptions();

  try {
    if (certPem) {
      const x509 = new crypto.X509Certificate(certPem);
      log.debug(
        `[local https cert] subject=${x509.subject} issuer=${x509.issuer} validTo=${x509.validTo}`,
      );
    }
  } catch (err) {
    log.http2Err(`cert parse error: ${err.message}`);
  }

  const secureServer = http2.createSecureServer(tlsOptions);

  secureServer.on("connection", (socket) => {
    log.http2Log(`tcp connect ${socket.remoteAddress}:${socket.remotePort}`);
  });

  secureServer.on("secureConnection", (tlsSocket) => {
    log.http2Log(
      `tls established ${tlsSocket.remoteAddress} ALPN=${tlsSocket.alpnProtocol || "none"}`,
    );
  });

  secureServer.on("stream", (stream, headers) => {
    const method = headers[":method"] || "";
    const routePath = headers[":path"] || "";
    const authority = headers[":authority"] || headers.host || "";
    const contentType = String(headers["content-type"] || "");

    log.http2Log(
      `${method} ${routePath} host=${authority} type=${contentType || "none"}`,
    );

    stream.on("error", (err) => {
      log.http2Err(`stream error: ${err.message}`);
    });

    const binaryAsset =
      method === "GET" ? getGatewayBinaryAsset(routePath) : null;
    if (binaryAsset) {
      stream.respond({
        ":status": 200,
        ...buildBinaryAssetHeaders(binaryAsset),
      });
      stream.end(binaryAsset.buffer);
      return;
    }

    if (
      contentType.includes("application/grpc") &&
      getGatewayStreamHandler()(stream, headers)
    ) {
      return;
    }

    let bodyLength = 0;
    stream.on("data", (chunk) => {
      bodyLength += chunk.length;
    });

    stream.on("end", () => {
      log.http2Log(`body ${bodyLength} bytes`);
    });

    if (contentType.includes("application/grpc")) {
      stream.respond(
        {
          ":status": 200,
          "content-type": "application/grpc+proto",
          "grpc-encoding": "identity",
          "grpc-accept-encoding": "identity",
        },
        { waitForTrailers: true },
      );
      stream.on("wantTrailers", () => {
        try {
          stream.sendTrailers({
            "grpc-status": "12",
            "grpc-message": encodeURIComponent(
              `EveJS Elysian local gateway has no handler for ${routePath}`,
            ),
          });
        } catch (err) {
          log.http2Err(`trailer error: ${err.message}`);
        }
      });
      stream.end();
      return;
    }

    stream.respond({
      ":status": 200,
      "content-type": "application/json",
    });
    stream.end(JSON.stringify(makeHttp2Payload(headers)));
  });

  secureServer.on("sessionError", (err) => {
    log.http2Err(`session error: ${err.message}`);
  });

  secureServer.on("tlsClientError", (err) => {
    log.http2Err(`tls client error: ${err.message} code=${err.code || "n/a"}`);
  });

  secureServer.on("error", (err) => {
    log.http2Err(`server error: ${err.message}`);
  });

  secureServer.listen(httpsPort, bindHost, () => {
    log.debug(`local https responder listening on ${bindHost}:${httpsPort}`);
  });
}

function wireTunnel(clientSocket, upstreamSocket, head, label, options = {}) {
  let upBytes = 0;
  let downBytes = 0;
  const idleTimeoutMs = Number.isFinite(options.idleTimeoutMs)
    ? options.idleTimeoutMs
    : DEFAULT_PROXY_TUNNEL_IDLE_TIMEOUT_MS;

  clientSocket.setNoDelay(true);
  clientSocket.setKeepAlive(true, SOCKET_KEEPALIVE_INITIAL_DELAY_MS);
  clientSocket.setTimeout(0);
  upstreamSocket.setNoDelay(true);
  upstreamSocket.setKeepAlive(true, SOCKET_KEEPALIVE_INITIAL_DELAY_MS);
  upstreamSocket.setTimeout(idleTimeoutMs > 0 ? idleTimeoutMs : 0);

  if (head && head.length > 0) {
    upstreamSocket.write(head);
    upBytes += head.length;
  }

  clientSocket.on("data", (chunk) => {
    upBytes += chunk.length;
  });

  upstreamSocket.on("data", (chunk) => {
    downBytes += chunk.length;
  });

  upstreamSocket.pipe(clientSocket);
  clientSocket.pipe(upstreamSocket);

  if (idleTimeoutMs > 0) {
    upstreamSocket.on("timeout", () => {
      log.proxyErr(`tunnel timeout ${label} ▲${upBytes}B ▼${downBytes}B`);
      upstreamSocket.destroy();
      clientSocket.destroy();
    });
  }

  upstreamSocket.on("close", () => {
    log.proxy(`tunnel closed ${label} ▲${upBytes}B ▼${downBytes}B`);
  });

  upstreamSocket.on("error", (err) => {
    log.proxyErr(`tunnel upstream error ${label} ${err.message}`);
    clientSocket.destroy();
  });

  clientSocket.on("error", (err) => {
    log.proxyErr(`tunnel client error ${label} ${err.message}`);
    upstreamSocket.destroy();
  });
}

function buildForwardTargetUrl(upstreamBaseUrl, requestPath) {
  return new URL(String(requestPath || "/"), upstreamBaseUrl);
}

function resolveListenUrl() {
  try {
    return new URL(config.microservicesPublicBaseUrl);
  } catch {
    return new URL("http://127.0.0.1:26002/");
  }
}

function resolveBindHost(listenUrl) {
  const configuredBindHost = String(config.microservicesBindHost || "").trim();
  if (configuredBindHost) {
    return configuredBindHost;
  }
  return isLoopbackHost(listenUrl.hostname) ? "127.0.0.1" : listenUrl.hostname;
}

const ENABLE_LOCAL_INTERCEPT = parseBooleanEnv(
  process.env.EVEJS_PROXY_LOCAL_INTERCEPT,
  shouldEnableLocalInterceptByDefault(),
);
const EXPRESS_PROXY_ENABLED = parseBooleanEnv(
  process.env.EVEJS_EXPRESS_PROXY_ENABLED,
  true,
);
const PROXY_FORWARD_UPSTREAM_URL = parseOptionalUrl(
  process.env.EVEJS_PROXY_UPSTREAM_BASE_URL,
);
const PROXY_GATEWAY_MODE = String(
  process.env.EVEJS_PROXY_GATEWAY_MODE ||
    (PROXY_FORWARD_UPSTREAM_URL ? "forward" : "local"),
)
  .trim()
  .toLowerCase();
const DEFAULT_PROXY_TUNNEL_IDLE_TIMEOUT_MS = parseNonNegativeIntegerEnv(
  process.env.EVEJS_PROXY_TUNNEL_IDLE_TIMEOUT_MS,
  30_000,
);
const INTERCEPT_PROXY_TUNNEL_IDLE_TIMEOUT_MS = parseNonNegativeIntegerEnv(
  process.env.EVEJS_PROXY_INTERCEPT_TUNNEL_IDLE_TIMEOUT_MS,
  0,
);
const SOCKET_KEEPALIVE_INITIAL_DELAY_MS = parseNonNegativeIntegerEnv(
  process.env.EVEJS_PROXY_SOCKET_KEEPALIVE_INITIAL_DELAY_MS,
  15_000,
);
const LOCAL_INTERCEPT_HOSTS = new Set([
  "dev-public-gateway.evetech.net",
  "public-gateway.evetech.net",
]);
const BLOCKED_PROXY_HOSTS = parseHostPatternList(config.proxyBlockedHosts);
const ALLOWED_PROXY_HOSTS = (() => {
  const configured = parseHostPatternList(config.proxyAllowedHosts);
  const derived = [];
  const imageUrl = parseOptionalUrl(config.imageServerUrl);
  if (imageUrl && imageUrl.hostname && !isLoopbackHost(imageUrl.hostname)) {
    derived.push(imageUrl.hostname);
  }
  return [...configured, ...derived];
})();
const PROXY_UNHANDLED_HOST_POLICY = normalizeUnhandledProxyHostPolicy(
  config.proxyUnhandledHostPolicy,
);

function shouldHandleInterceptLocally() {
  return ENABLE_LOCAL_INTERCEPT && PROXY_GATEWAY_MODE !== "forward";
}

function shouldForwardInterceptToUpstream() {
  return (
    ENABLE_LOCAL_INTERCEPT &&
    PROXY_GATEWAY_MODE === "forward" &&
    Boolean(PROXY_FORWARD_UPSTREAM_URL)
  );
}

function getGatewayUpstreamTarget(defaultPort) {
  if (!PROXY_FORWARD_UPSTREAM_URL) {
    return null;
  }

  const configuredHost = String(
    process.env.EVEJS_PROXY_GATEWAY_UPSTREAM_HOST || "",
  ).trim();
  const configuredPort = Number.parseInt(
    process.env.EVEJS_PROXY_GATEWAY_UPSTREAM_PORT || "",
    10,
  );

  return {
    host: configuredHost || PROXY_FORWARD_UPSTREAM_URL.hostname,
    port: Number.isFinite(configuredPort) && configuredPort > 0
      ? configuredPort
      : defaultPort,
  };
}

function startServer() {
  const express = require("express");
  const app = express();

  app.use((req, res, next) => {
    const targetUrl = parseHttpProxyTarget(req);
    const shouldForwardLoopbackImage =
      targetUrl &&
      isLoopbackHost(targetUrl.hostname) &&
      Number.parseInt(targetUrl.port || "80", 10) === 26001;

    if (shouldForwardLoopbackImage) {
      pipeHttpRequest(req, res, targetUrl);
      return;
    }

    if (targetUrl && shouldBlockHost(targetUrl.hostname)) {
      blockHttpProxyRequest(req, res, targetUrl);
      return;
    }

    if (targetUrl && ENABLE_LOCAL_INTERCEPT && shouldInterceptHost(targetUrl.hostname)) {
      if (shouldHandleInterceptLocally()) {
        log.proxy(`intercept ${req.method} ${targetUrl.href} -> local`);
        next();
        return;
      }

      if (shouldForwardInterceptToUpstream()) {
        const upstreamTargetUrl = buildForwardTargetUrl(
          PROXY_FORWARD_UPSTREAM_URL,
          `${targetUrl.pathname}${targetUrl.search}`,
        );
        log.proxy(`intercept ${req.method} ${targetUrl.href} -> upstream ${upstreamTargetUrl.href}`);
        pipeHttpRequest(req, res, upstreamTargetUrl);
        return;
      }
    }

    if (targetUrl) {
      if (shouldDenyUnhandledProxyHost(targetUrl.hostname, {
        interceptHosts: LOCAL_INTERCEPT_HOSTS,
        allowedHosts: ALLOWED_PROXY_HOSTS,
        policy: PROXY_UNHANDLED_HOST_POLICY,
      })) {
        blockHttpProxyRequest(req, res, targetUrl);
        return;
      }
      pipeHttpRequest(req, res, targetUrl);
      return;
    }

    log.proxy(`${req.method} ${req.url} host=${req.headers.host || "?"}`);
    next();
  });

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req, res) => {
    res.status(200).json({
      status: "ok",
      service: "express-secondary",
      gatewayMode: shouldForwardInterceptToUpstream()
        ? "forward"
        : shouldHandleInterceptLocally()
          ? "local"
          : "transparent",
      upstreamBaseUrl: PROXY_FORWARD_UPSTREAM_URL
        ? PROXY_FORWARD_UPSTREAM_URL.toString()
        : null,
    });
  });

  app.all(/.*/, (req, res) => {
    if (PROXY_FORWARD_UPSTREAM_URL) {
      const upstreamTargetUrl = buildForwardTargetUrl(
        PROXY_FORWARD_UPSTREAM_URL,
        req.url,
      );
      pipeHttpRequest(req, res, upstreamTargetUrl);
      return;
    }
    res.status(200).json(makeResponsePayload(req));
  });

  const listenUrl = resolveListenUrl();
  const httpPort = getUrlPort(listenUrl);
  const httpsPort = httpPort + 1;
  const bindHost = resolveBindHost(listenUrl);

  if (shouldHandleInterceptLocally()) {
    createLocalSecureResponder(httpsPort, bindHost);
    createLoopbackCdnResponder(httpsPort);
  }

  const proxyServer = http.createServer(app);

  proxyServer.on("connect", (req, clientSocket, head) => {
    const targetRaw = req.url || "";
    const { host, port } = parseConnectTarget(targetRaw);

    if (!host || !port) {
      clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      clientSocket.destroy();
      return;
    }

    if (shouldBlockHost(host)) {
      log.proxy(`CONNECT ${targetRaw} -> BLOCKED local policy`);
      clientSocket.write(
        "HTTP/1.1 403 Forbidden\r\n" +
        "Proxy-Agent: EveJS Elysian\r\n" +
        "X-EveJS-Proxy-Blocked: true\r\n" +
        "\r\n",
      );
      clientSocket.destroy();
      return;
    }

    const interceptTarget = ENABLE_LOCAL_INTERCEPT && shouldInterceptHost(host);
    if (!interceptTarget && shouldDenyUnhandledProxyHost(host, {
      interceptHosts: LOCAL_INTERCEPT_HOSTS,
      allowedHosts: ALLOWED_PROXY_HOSTS,
      policy: PROXY_UNHANDLED_HOST_POLICY,
    })) {
      log.proxy(`CONNECT ${targetRaw} -> BLOCKED unhandled host policy`);
      clientSocket.write(
        "HTTP/1.1 403 Forbidden\r\n" +
        "Proxy-Agent: EveJS Elysian\r\n" +
        "X-EveJS-Proxy-Blocked: true\r\n" +
        "\r\n",
      );
      clientSocket.destroy();
      return;
    }

    let connectHost = host;
    let connectPort = port;
    let modeLabel = "REMOTE";

    if (interceptTarget && shouldHandleInterceptLocally()) {
      connectHost = bindHost;
      connectPort = httpsPort;
      modeLabel = "LOCAL";
    } else if (interceptTarget && shouldForwardInterceptToUpstream()) {
      const upstreamTarget = getGatewayUpstreamTarget(httpsPort);
      if (upstreamTarget) {
        connectHost = upstreamTarget.host;
        connectPort = upstreamTarget.port;
        modeLabel = "UPSTREAM";
      }
    }

    log.proxy(`CONNECT ${targetRaw} -> ${modeLabel} ${connectHost}:${connectPort}`);

    const upstreamSocket = net.connect(connectPort, connectHost, () => {
      clientSocket.write(
        "HTTP/1.1 200 Connection Established\r\n" +
        "Proxy-Agent: EveJS Elysian\r\n" +
        "\r\n",
      );

      wireTunnel(
        clientSocket,
        upstreamSocket,
        head,
        `${targetRaw} via ${connectHost}:${connectPort}`,
        {
          idleTimeoutMs: interceptTarget
            ? INTERCEPT_PROXY_TUNNEL_IDLE_TIMEOUT_MS
            : DEFAULT_PROXY_TUNNEL_IDLE_TIMEOUT_MS,
        },
      );
    });

    upstreamSocket.on("error", (err) => {
      log.proxyErr(`connect failed ${connectHost}:${connectPort} ${err.message}`);
      if (!clientSocket.destroyed) {
        clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      }
      clientSocket.destroy();
    });
  });

  proxyServer.on("error", (err) => {
    log.proxyErr(`server error: ${err.message}`);
  });

  proxyServer.listen(httpPort, bindHost);

  log.debug(
    `express proxy mode: ${
      shouldForwardInterceptToUpstream()
        ? "forward intercept enabled"
        : shouldHandleInterceptLocally()
          ? "local intercept enabled"
          : "transparent forward"
    }`,
  );
}

module.exports = {
  enabled: EXPRESS_PROXY_ENABLED,
  serviceName: "expressServer",
  exec() {
    startServer();
    log.debug(`express server is running on ${config.microservicesPublicBaseUrl}`);
  },
};

module.exports.__testHooks = {
  hostMatchesPattern,
  hostMatchesAnyPattern,
  parseHostPatternList,
  shouldAllowListedHost,
  shouldBlockHost,
  shouldDenyUnhandledProxyHost,
  normalizeUnhandledProxyHostPolicy,
  createLoopbackCdnRequestHandler,
  createLoopbackCdnResponder,
  getGatewayBinaryAsset,
  loadLocalTlsOptions,
};
