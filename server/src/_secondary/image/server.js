const http = require("http");
const fs = require("fs");
const config = require("../../config");
const log = require("../../utils/logger");
const { resolveImageRequest } = require("./imageRequestResolver");

function startImageServer() {
  const server = http.createServer((req, res) => {
    const url = String(req.url || "/");

    log.debug(`image request: ${url}`);

    const resolved = resolveImageRequest(url);
    const filePath = resolved.filePath;
    const contentType = resolved.contentType;

    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end();
      return;
    }

    const data = fs.readFileSync(filePath);

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,
      "Cache-Control": "public, max-age=300",
    });

    res.end(data);
  });

  const url = new URL(config.imageServerUrl);
  const port = Number.parseInt(url.port, 10);
  const host = String(
    config.imageServerBindHost ||
      (url.hostname === "localhost" ? "127.0.0.1" : url.hostname),
  ).trim();

  server.on("error", (err) => {
    log.err(`[ImageServer] listen error: ${err.message}`);
  });

  server.listen(port, host);
}

module.exports = {
  enabled: true,
  serviceName: "imageServer",
  exec() {
    startImageServer();
    log.debug(`http image server running on ${config.imageServerUrl}`);
  },
};
