const fs = require("fs");
const path = require("path");

const log = require("./logger");
const rotatingLog = require("./rotatingLog");

const INSTALL_MARK = Symbol.for("evejs.processLifecycle.installed");
const DEFAULT_PROCESS_LIFECYCLE_LOG_PATH = path.join(
  __dirname,
  "../../logs/process-lifecycle.log",
);
const DEFAULT_NODE_REPORT_DIR = path.join(__dirname, "../../logs/node-reports");

function appendLifecycleLog(
  level,
  message,
  logPath = DEFAULT_PROCESS_LIFECYCLE_LOG_PATH,
) {
  try {
    rotatingLog.appendSync(
      logPath,
      `[${new Date().toISOString()}] [${level}] ${message}\n`,
    );
  } catch (error) {
    try {
      console.error(
        `[ProcessLifecycle] failed to write ${logPath}: ${error.message}`,
      );
    } catch (_) {
      // Last-chance logging must never throw.
    }
  }
}

function formatValue(value) {
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function formatSnapshot(processRef) {
  let uptimeSeconds = null;
  let memoryUsage = null;
  let cwd = null;
  let argv = null;

  try {
    uptimeSeconds = typeof processRef.uptime === "function"
      ? Number(processRef.uptime()).toFixed(3)
      : null;
  } catch (_) {}

  try {
    const usage = typeof processRef.memoryUsage === "function"
      ? processRef.memoryUsage()
      : null;
    if (usage) {
      memoryUsage = {
        rssMB: Number((usage.rss / (1024 * 1024)).toFixed(1)),
        heapTotalMB: Number((usage.heapTotal / (1024 * 1024)).toFixed(1)),
        heapUsedMB: Number((usage.heapUsed / (1024 * 1024)).toFixed(1)),
        externalMB: Number((usage.external / (1024 * 1024)).toFixed(1)),
      };
    }
  } catch (_) {}

  try {
    cwd = typeof processRef.cwd === "function" ? processRef.cwd() : null;
  } catch (_) {}

  try {
    argv = Array.isArray(processRef.argv) ? processRef.argv : null;
  } catch (_) {}

  return JSON.stringify({
    pid: processRef.pid || null,
    ppid: processRef.ppid || null,
    platform: processRef.platform || null,
    version: processRef.version || null,
    uptimeSeconds,
    cwd,
    argv,
    memoryUsage,
  });
}

function writeDiagnosticReport(
  processRef,
  trigger,
  error,
  reportDir = DEFAULT_NODE_REPORT_DIR,
  logPath = DEFAULT_PROCESS_LIFECYCLE_LOG_PATH,
) {
  try {
    if (
      !processRef.report ||
      typeof processRef.report.writeReport !== "function"
    ) {
      return null;
    }
    fs.mkdirSync(reportDir, { recursive: true });
    const safeTrigger = String(trigger || "process")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-");
    const reportPath = path.join(
      reportDir,
      `${safeTrigger}-${Date.now()}-${processRef.pid || "pid"}.json`,
    );
    processRef.report.writeReport(reportPath, error);
    return reportPath;
  } catch (reportError) {
    appendLifecycleLog(
      "ERR",
      `[ProcessLifecycle] failed to write diagnostic report for ${trigger}: ${formatValue(reportError)}`,
      logPath,
    );
    if (typeof log.writeServerLog === "function") {
      log.writeServerLog(
        "ERR",
        `[ProcessLifecycle] failed to write diagnostic report for ${trigger}: ${formatValue(reportError)}`,
      );
    }
    return null;
  }
}

function emitLifecycleLog(
  logger,
  level,
  message,
  {
    consoleOutput = true,
    logPath = DEFAULT_PROCESS_LIFECYCLE_LOG_PATH,
  } = {},
) {
  appendLifecycleLog(level, message, logPath);

  if (!logger) {
    return;
  }

  if (!consoleOutput) {
    if (typeof logger.writeServerLog === "function") {
      logger.writeServerLog(level, message);
    }
    return;
  }

  if (level === "ERR" && typeof logger.err === "function") {
    logger.err(message);
    return;
  }
  if (level === "WRN" && typeof logger.warn === "function") {
    logger.warn(message);
    return;
  }
  if (typeof logger.info === "function") {
    logger.info(message);
    return;
  }
  if (typeof logger.writeServerLog === "function") {
    logger.writeServerLog(level, message);
  }
}

function installProcessLifecycleLogging(options = {}) {
  const processRef = options.processRef || process;
  const logger = options.logger || log;
  const appName = options.appName || "EveJS Elysian";
  const signals = Array.isArray(options.signals) && options.signals.length > 0
    ? options.signals
    : ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"];
  const lifecycleLogPath =
    options.lifecycleLogPath || DEFAULT_PROCESS_LIFECYCLE_LOG_PATH;
  const nodeReportDir = options.nodeReportDir || DEFAULT_NODE_REPORT_DIR;

  if (processRef[INSTALL_MARK]) {
    return processRef[INSTALL_MARK];
  }

  const handlers = {
    warning: (warning) => {
      emitLifecycleLog(
        logger,
        "WRN",
        `[ProcessLifecycle] warning app=${appName} detail=${formatValue(warning)} snapshot=${formatSnapshot(processRef)}`,
        { logPath: lifecycleLogPath },
      );
    },
    multipleResolves: (type, _promise, value) => {
      emitLifecycleLog(
        logger,
        "WRN",
        `[ProcessLifecycle] multipleResolves app=${appName} type=${type} detail=${formatValue(value)} snapshot=${formatSnapshot(processRef)}`,
        { logPath: lifecycleLogPath },
      );
    },
    unhandledRejection: (reason) => {
      const reportPath = writeDiagnosticReport(
        processRef,
        "unhandled-rejection",
        reason instanceof Error ? reason : undefined,
        nodeReportDir,
        lifecycleLogPath,
      );
      let message =
        `[ProcessLifecycle] unhandledRejection app=${appName} detail=${formatValue(reason)} snapshot=${formatSnapshot(processRef)}`;
      if (reportPath) {
        message += ` report=${reportPath}`;
      }
      emitLifecycleLog(logger, "ERR", message, {
        logPath: lifecycleLogPath,
      });
    },
    uncaughtExceptionMonitor: (error, origin) => {
      const reportPath = writeDiagnosticReport(
        processRef,
        "uncaught-exception",
        error,
        nodeReportDir,
        lifecycleLogPath,
      );
      let message =
        `[ProcessLifecycle] uncaughtException app=${appName} origin=${origin || "unknown"} detail=${formatValue(error)} snapshot=${formatSnapshot(processRef)}`;
      if (reportPath) {
        message += ` report=${reportPath}`;
      }
      emitLifecycleLog(logger, "ERR", message, {
        logPath: lifecycleLogPath,
      });
    },
    beforeExit: (code) => {
      emitLifecycleLog(
        logger,
        "LOG",
        `[ProcessLifecycle] beforeExit app=${appName} code=${code} snapshot=${formatSnapshot(processRef)}`,
        { logPath: lifecycleLogPath },
      );
    },
    exit: (code) => {
      emitLifecycleLog(
        logger,
        "LOG",
        `[ProcessLifecycle] exit app=${appName} code=${code} snapshot=${formatSnapshot(processRef)}`,
        { consoleOutput: false, logPath: lifecycleLogPath },
      );
    },
    signal(signal) {
      emitLifecycleLog(
        logger,
        "WRN",
        `[ProcessLifecycle] signal app=${appName} signal=${signal} snapshot=${formatSnapshot(processRef)}`,
        { logPath: lifecycleLogPath },
      );
    },
  };

  if (typeof processRef.on === "function") {
    processRef.on("warning", handlers.warning);
    processRef.on("multipleResolves", handlers.multipleResolves);
    processRef.on("unhandledRejection", handlers.unhandledRejection);
    processRef.on(
      "uncaughtExceptionMonitor",
      handlers.uncaughtExceptionMonitor,
    );
    processRef.on("beforeExit", handlers.beforeExit);
    processRef.on("exit", handlers.exit);

    for (const signal of signals) {
      try {
        processRef.on(signal, () => handlers.signal(signal));
      } catch (_) {
        // Not all signals are available on all platforms.
      }
    }
  }

  processRef[INSTALL_MARK] = { handlers };
  return processRef[INSTALL_MARK];
}

module.exports = {
  installProcessLifecycleLogging,
  _testing: {
    appendLifecycleLog,
    formatValue,
    formatSnapshot,
    writeDiagnosticReport,
  },
};
