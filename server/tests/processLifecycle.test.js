const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");

const repoRoot = path.join(__dirname, "..", "..");
const {
  installProcessLifecycleLogging,
} = require(path.join(repoRoot, "server/src/utils/processLifecycle"));

class FakeProcess extends EventEmitter {
  constructor() {
    super();
    this.pid = 4242;
    this.ppid = 1010;
    this.platform = "win32";
    this.version = "v22.0.0";
    this.argv = ["node", "server/index.js"];
    this._reports = [];
    this.report = {
      writeReport: (filePath, error) => {
        this._reports.push({ filePath, error });
        return filePath;
      },
    };
  }

  uptime() {
    return 12.345;
  }

  memoryUsage() {
    return {
      rss: 200 * 1024 * 1024,
      heapTotal: 120 * 1024 * 1024,
      heapUsed: 80 * 1024 * 1024,
      external: 10 * 1024 * 1024,
    };
  }

  cwd() {
    return repoRoot;
  }
}

function buildLogger() {
  const events = [];
  return {
    events,
    warn(message) {
      events.push({ level: "warn", message });
    },
    err(message) {
      events.push({ level: "err", message });
    },
    info(message) {
      events.push({ level: "info", message });
    },
    writeServerLog(level, message) {
      events.push({ level: `write:${level}`, message });
    },
  };
}

function makeTempLifecyclePaths() {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "evejs-process-lifecycle-"),
  );
  return {
    tempDir,
    lifecycleLogPath: path.join(tempDir, "process-lifecycle.log"),
    nodeReportDir: path.join(tempDir, "node-reports"),
  };
}

test("process lifecycle logging records warnings, fatal events, reports, and exit traces", () => {
  const processRef = new FakeProcess();
  const logger = buildLogger();
  const tempPaths = makeTempLifecyclePaths();

  installProcessLifecycleLogging({
    processRef,
    logger,
    appName: "test-app",
    signals: ["SIGTERM"],
    lifecycleLogPath: tempPaths.lifecycleLogPath,
    nodeReportDir: tempPaths.nodeReportDir,
  });

  processRef.emit("warning", new Error("warning-path"));
  processRef.emit("unhandledRejection", new Error("rejection-path"));
  processRef.emit(
    "uncaughtExceptionMonitor",
    new Error("crash-path"),
    "uncaughtException",
  );
  processRef.emit("SIGTERM");
  processRef.emit("exit", 1);

  assert.equal(processRef._reports.length, 2);
  assert.match(processRef._reports[0].filePath, /unhandled-rejection/i);
  assert.match(processRef._reports[1].filePath, /uncaught-exception/i);

  assert.ok(
    logger.events.some(
      (entry) =>
        entry.level === "warn" &&
        entry.message.includes("warning app=test-app") &&
        entry.message.includes("warning-path"),
    ),
  );
  assert.ok(
    logger.events.some(
      (entry) =>
        entry.level === "err" &&
        entry.message.includes("unhandledRejection app=test-app") &&
        entry.message.includes("rejection-path") &&
        entry.message.includes("report="),
    ),
  );
  assert.ok(
    logger.events.some(
      (entry) =>
        entry.level === "err" &&
        entry.message.includes("uncaughtException app=test-app") &&
        entry.message.includes("crash-path") &&
        entry.message.includes("report="),
    ),
  );
  assert.ok(
    logger.events.some(
      (entry) =>
        entry.level === "warn" &&
        entry.message.includes("signal app=test-app signal=SIGTERM"),
    ),
  );
  assert.ok(
    logger.events.some(
      (entry) =>
        entry.level === "write:LOG" &&
        entry.message.includes("exit app=test-app code=1"),
    ),
  );
});

test("process lifecycle logging only installs once per process object", () => {
  const processRef = new FakeProcess();
  const logger = buildLogger();
  const tempPaths = makeTempLifecyclePaths();

  const firstInstall = installProcessLifecycleLogging({
    processRef,
    logger,
    appName: "dedupe-app",
    lifecycleLogPath: tempPaths.lifecycleLogPath,
    nodeReportDir: tempPaths.nodeReportDir,
  });
  const secondInstall = installProcessLifecycleLogging({
    processRef,
    logger,
    appName: "dedupe-app",
    lifecycleLogPath: tempPaths.lifecycleLogPath,
    nodeReportDir: tempPaths.nodeReportDir,
  });

  assert.equal(firstInstall, secondInstall);

  processRef.emit("warning", new Error("single-fire"));

  assert.equal(
    logger.events.filter(
      (entry) =>
        entry.level === "warn" &&
        entry.message.includes("single-fire"),
    ).length,
    1,
  );
});
