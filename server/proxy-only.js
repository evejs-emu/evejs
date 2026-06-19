const path = require("path");

const log = require(path.join(__dirname, "./src/utils/logger"));
const {
  installProcessLifecycleLogging,
} = require(path.join(__dirname, "./src/utils/processLifecycle"));
const config = require(path.join(__dirname, "./src/config"));
const expressProxyService = require(path.join(
  __dirname,
  "./src/_secondary/express/server",
));

installProcessLifecycleLogging({ appName: "eve.js proxy-only" });
log.logAsciiLogo();
log.spacer();
log.info("starting eve.js proxy only...");
log.spacer();
log.debug(`microservices redirect: ${config.microservicesRedirectUrl}`);
log.line();

if (expressProxyService.enabled !== true) {
  log.err(
    "proxy-only startup aborted because EVEJS_EXPRESS_PROXY_ENABLED is disabled.",
  );
  process.exit(1);
}

expressProxyService.exec();
