/**
 * EVE.js — Main Entry Point
 *
 * Initializes the service manager, registers core game services,
 * and starts the TCP server.
 */

const fs = require("fs");
const path = require("path");
const log = require(path.join(__dirname, "./src/utils/logger"));
const {
  installProcessLifecycleLogging,
} = require(path.join(__dirname, "./src/utils/processLifecycle"));
const config = require(path.join(__dirname, "./src/config"));
const {
  installSharedOverviewMotd,
} = require(path.join(__dirname, "./src/services/overview/overviewMotdBootstrap"));

// Service framework
const ServiceManager = require(
  path.join(__dirname, "./src/services/serviceManager"),
);

// network
const startTCPServer = require(path.join(__dirname, "./src/network/tcp"));

// database
const database = require(path.join(__dirname, "./src/newDatabase"));

// main startup

installProcessLifecycleLogging({ appName: "eve.js server" });

log.logAsciiLogo();
log.spacer();
log.info("starting eve.js...");
log.spacer();

// Display version info
log.debug(`Project: ${config.projectVersion}`);
log.debug(`Client Version: ${config.clientVersion}`);
log.debug(`Client Build: ${config.clientBuild}`);
log.debug(`MachoNet Version: ${config.machoVersion}`);
log.line();

// Preload database into memory before services initialize
database.preloadAll();
log.line();

// create and populate service manager
const serviceManager = new ServiceManager();

// register services
const servicesDir = path.join(__dirname, "./src/services");

function loadServices(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      loadServices(fullPath);
    } else if (
      file.isFile() &&
      file.name.endsWith("Service.js") &&
      file.name !== "baseService.js" &&
      file.name !== "serviceManager.js"
    ) {
      try {
        const exported = require(fullPath);
        if (typeof exported === "function") {
          serviceManager.register(new exported());
        } else if (typeof exported === "object" && exported !== null) {
          for (const key in exported) {
            if (typeof exported[key] === "function") {
              serviceManager.register(new exported[key]());
            }
          }
        }
      } catch (err) {
        log.err(`failed to load service from ${fullPath}: ${err.message}`);
      }
    }
  }
}

loadServices(servicesDir);

if (serviceManager.lookup("trademgr") && !serviceManager.lookup("tradeMgr")) {
  serviceManager.registerAlias("tradeMgr", "trademgr");
}

log.success(`registered ${serviceManager.count} services`);
log.line();

// register secondary services
const secondaryServicesDir = path.join(__dirname, "./src/_secondary");

function loadSecondaryServices(dir) {
  if (!fs.existsSync(dir)) {
    log.debug(`secondary services directory not found: ${dir}`);
    return;
  }

  const files = fs.readdirSync(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = path.join(dir, file.name);

    if (file.isDirectory()) {
      loadSecondaryServices(fullPath);
      continue;
    }

    if (file.isFile() && file.name.endsWith(".js")) {
      try {
        const service = require(fullPath);
        if (service.enabled === true) {
          log.debug(`starting secondary service: ${service.serviceName}`);
          service.exec();
        } else {
          log.debug(
            `skipping service: ${service.serviceName} as it is not enabled`,
          );
        }
        log.spacer();
      } catch (err) {
        log.err(
          `failed to start secondary service ${fullPath}: ${err.message}`,
        );
        log.spacer();
      }
    }
  }
}

loadSecondaryServices(secondaryServicesDir);

if (config.wormholesEnabled === true) {
  try {
    const seedStart = process.hrtime.bigint();
    const wormholeRuntime = require(path.join(
      __dirname,
      "./src/services/exploration/wormholes/wormholeRuntime",
    ));
    const seedResult = wormholeRuntime.ensureUniverseStatics(Date.now());
    const seedDurationMs = Number(process.hrtime.bigint() - seedStart) / 1e6;
    if (seedResult && seedResult.success === true) {
      const summary = wormholeRuntime.buildUniverseSummary({
        includeCollapsed: false,
        includeUndiscovered: true,
      });
      log.info(
        `[Wormholes] Startup ready: ${summary.activePairCount} pair(s) | static ${summary.staticPairCount} | random ${summary.randomPairCount} | systems ${summary.systemCount} | env ${summary.environmentSystemCount} | revealed ${summary.revealedExitCount} | hidden ${summary.hiddenExitCount} | ${seedDurationMs.toFixed(1)} ms`,
      );
    } else {
      log.warn(
        `[Wormholes] Universe static seeding reported failure after ${seedDurationMs.toFixed(1)} ms`,
      );
    }
    log.spacer();
  } catch (err) {
    log.err(`[Wormholes] Failed startup seeding: ${err.message}`);
    log.spacer();
  }
}

try {
  installSharedOverviewMotd(serviceManager);
  log.spacer();
} catch (err) {
  log.err(`[OverviewPresetMgr] Failed startup MOTD bootstrap: ${err.message}`);
  log.spacer();
}

// Start the TCP server with the service manager
startTCPServer(serviceManager);
