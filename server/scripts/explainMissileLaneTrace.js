#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const DEFAULT_LOG_PATH = path.join(
  process.cwd(),
  "server",
  "logs",
  "space-missile-debug.log",
);

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric);
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? Math.trunc(fallbackNumeric) : 0;
}

function parseArgs(argv) {
  const options = {
    log: DEFAULT_LOG_PATH,
    client: 0,
    ship: 0,
    from: 0,
    to: 0,
    limit: 80,
    events: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    if (token === "--log") {
      options.log = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--client") {
      options.client = toInt(argv[index + 1], 0);
      index += 1;
      continue;
    }
    if (token === "--ship") {
      options.ship = toInt(argv[index + 1], 0);
      index += 1;
      continue;
    }
    if (token === "--from") {
      options.from = toInt(argv[index + 1], 0);
      index += 1;
      continue;
    }
    if (token === "--to") {
      options.to = toInt(argv[index + 1], 0);
      index += 1;
      continue;
    }
    if (token === "--limit") {
      options.limit = Math.max(1, toInt(argv[index + 1], 80));
      index += 1;
      continue;
    }
    if (token === "--event" || token === "--events") {
      options.events = String(argv[index + 1] || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      index += 1;
    }
  }

  return options;
}

function printHelp() {
  console.log(
    [
      "Usage: node server/scripts/explainMissileLaneTrace.js [options]",
      "",
      "Options:",
      "  --log <path>        Path to space-missile-debug.log",
      "  --client <id>       Filter by session clientID",
      "  --ship <id>         Filter by shipID/sourceShipID",
      "  --from <stamp>      Minimum raw/final/original stamp",
      "  --to <stamp>        Maximum raw/final/original stamp",
      "  --limit <n>         Maximum records to print",
      "  --event <a,b,c>     Comma-separated event names",
      "  --help              Show this message",
      "",
      "Example:",
      "  node server/scripts/explainMissileLaneTrace.js --client 1065450 --ship 991002503 --from 1774959830 --to 1774959852",
    ].join("\n"),
  );
}

function parseLogLine(line) {
  const jsonStart = line.indexOf("{");
  if (jsonStart < 0) {
    return null;
  }
  try {
    return JSON.parse(line.slice(jsonStart));
  } catch (error) {
    return null;
  }
}

function getClientID(record) {
  return toInt(
    record &&
      (
        record.clientID ||
        (record.sessionBefore && record.sessionBefore.clientID) ||
        (record.sessionAfter && record.sessionAfter.clientID) ||
        (record.session && record.session.clientID)
      ),
    0,
  );
}

function getShipID(record) {
  return toInt(
    record &&
      (
        record.shipID ||
        (record.sessionBefore && record.sessionBefore.shipID) ||
        (record.sessionAfter && record.sessionAfter.shipID) ||
        (record.missile && record.missile.sourceShipID) ||
        (record.entity && record.entity.itemID)
      ),
    0,
  );
}

function getRelevantStamps(record) {
  const stamps = [
    toInt(record && record.rawDispatchStamp, 0),
    toInt(record && record.originalStamp, 0),
    toInt(record && record.finalStamp, 0),
    toInt(record && record.stamp, 0),
    toInt(record && record.currentSessionStamp, 0),
    toInt(record && record.currentVisibleStamp, 0),
    toInt(record && record.currentPresentedStamp, 0),
    toInt(record && record.currentImmediateStamp, 0),
    toInt(record && record.sessionBefore && record.sessionBefore.rawDispatchStamp, 0),
    toInt(record && record.sessionAfter && record.sessionAfter.rawDispatchStamp, 0),
  ].filter((value) => value > 0);
  return stamps;
}

function matchesFilters(record, options) {
  if (!record || typeof record !== "object") {
    return false;
  }
  if (Array.isArray(options.events) && options.events.length > 0) {
    if (!options.events.includes(String(record.event || ""))) {
      return false;
    }
  }
  if (options.client > 0 && getClientID(record) !== options.client) {
    return false;
  }
  if (options.ship > 0 && getShipID(record) !== options.ship) {
    return false;
  }
  const stamps = getRelevantStamps(record);
  if (options.from > 0 && stamps.length > 0 && Math.max(...stamps) < options.from) {
    return false;
  }
  if (options.to > 0 && stamps.length > 0 && Math.min(...stamps) > options.to) {
    return false;
  }
  return true;
}

function formatUpdateList(updates) {
  if (!Array.isArray(updates) || updates.length === 0) {
    return "none";
  }
  return updates
    .map((update) => `${update.name || "unknown"}@${toInt(update.stamp, 0)}`)
    .join(", ");
}

function formatStampSummary(session) {
  if (!session || typeof session !== "object") {
    return "none";
  }
  return [
    `session=${toInt(session.currentSessionStamp, 0)}`,
    `visible=${toInt(session.currentVisibleStamp, 0)}`,
    `presented=${toInt(session.currentPresentedStamp, 0)}`,
    `immediate=${toInt(session.currentImmediateStamp, 0)}`,
    `lastSent=${toInt(session.lastSentDestinyStamp, 0)}`,
    `ownerFresh=${toInt(session.lastOwnerMissileFreshAcquireStamp, 0)}`,
    `ownerLife=${toInt(session.lastOwnerMissileLifecycleStamp, 0)}`,
  ].join(" ");
}

function formatCandidateList(summary) {
  if (Array.isArray(summary)) {
    return summary.length > 0 ? summary.join(", ") : "none";
  }
  const active = summary && Array.isArray(summary.active) ? summary.active : [];
  if (active.length === 0) {
    return "none";
  }
  return active
    .map((entry) => {
      const winner =
        summary &&
        Array.isArray(summary.winners) &&
        summary.winners.some((winnerEntry) => winnerEntry.label === entry.label);
      return `${winner ? "*" : ""}${entry.label}=${toInt(entry.value, 0)}`;
    })
    .join(", ");
}

function printEmitGroup(record) {
  const sessionBefore = record.sessionBefore || null;
  const sessionAfter = record.sessionAfter || null;
  console.log(
    [
      `${record.event} raw=${toInt(record.rawDispatchStamp, 0)} original=${toInt(record.originalStamp, 0)} final=${toInt(record.finalStamp, 0)} delta=${toInt(record.finalStamp, 0) - toInt(record.originalStamp, 0)}`,
      `client=${getClientID(record)} ship=${getShipID(record)} trace=${toInt(record.destinyCallTraceID, 0)} reason=${record.groupReason || record.sendReason || "n/a"}`,
      `flags fresh=${record.groupFlags && record.groupFlags.freshAcquireLifecycle === true ? 1 : 0} missile=${record.groupFlags && record.groupFlags.missileLifecycle === true ? 1 : 0} ownerMissile=${record.groupFlags && record.groupFlags.ownerMissileLifecycle === true ? 1 : 0} setState=${record.groupFlags && record.groupFlags.setState === true ? 1 : 0}`,
      `updates original=[${formatUpdateList(record.originalUpdates)}] emitted=[${formatUpdateList(record.emittedUpdates)}]`,
      `session before { ${formatStampSummary(sessionBefore)} }`,
      `session after  { ${formatStampSummary(sessionAfter)} }`,
    ].join("\n"),
  );

  if (Array.isArray(record.restampSteps) && record.restampSteps.length > 0) {
    console.log("restamp steps:");
    for (const step of record.restampSteps) {
      console.log(
        `  - ${step.reason}: before=${toInt(step.beforeStamp, 0)} candidate=${toInt(step.candidateStamp, 0)} after=${toInt(step.afterStamp, 0)} applied=${step.applied === true ? 1 : 0}`,
      );
    }
  }

  const ownerTrace = record.ownerMonotonicDecisionTrace || null;
  if (ownerTrace) {
    if (Array.isArray(ownerTrace.recentStates) && ownerTrace.recentStates.length > 0) {
      for (const stateSummary of ownerTrace.recentStates) {
        console.log(`owner state: ${stateSummary}`);
      }
    }
    console.log(
      `owner trace: reusable=[${formatCandidateList(ownerTrace.candidateGroups && ownerTrace.candidateGroups.reusableRecentOwnerCriticalLane)}]`,
    );
    console.log(
      `owner trace: projected=[${formatCandidateList(ownerTrace.candidateGroups && ownerTrace.candidateGroups.projectedConsumedOwnerCriticalLane)}]`,
    );
    console.log(
      `owner trace: floor=[${formatCandidateList(ownerTrace.candidateGroups && ownerTrace.candidateGroups.recentOwnerCriticalMonotonicFloor)}]`,
    );
    console.log(
      `owner trace: ceiling=[${formatCandidateList(ownerTrace.candidateGroups && ownerTrace.candidateGroups.ownerCriticalCeilingStamp)}]`,
    );
  } else if (record.genericMonotonicFloor) {
    const generic = record.genericMonotonicFloor;
    console.log(
      `owner summary: presentedFloor=${toInt(generic.presentedLastSentMonotonicFloor, 0)} genericFloor=${toInt(generic.genericMonotonicFloor, 0)} ownerFloor=${toInt(generic.recentOwnerCriticalMonotonicFloor, 0)} ceiling=${toInt(generic.ownerCriticalCeilingStamp, 0)}`,
    );
  }

  if (record.sessionMutation && typeof record.sessionMutation === "object") {
    const mutations = Object.entries(record.sessionMutation)
      .map(([key, value]) => {
        if (!value || typeof value !== "object") {
          return null;
        }
        if (Object.prototype.hasOwnProperty.call(value, "delta")) {
          return `${key}:${toInt(value.before, 0)}->${toInt(value.after, 0)}`;
        }
        return `${key}:${JSON.stringify(value.before)}->${JSON.stringify(value.after)}`;
      })
      .filter(Boolean);
    if (mutations.length > 0) {
      console.log(`session mutation: ${mutations.join(", ")}`);
    }
  }

  console.log("");
}

function printGenericRecord(record) {
  const parts = [
    `${record.event || "unknown"}`,
    `raw=${toInt(record.rawDispatchStamp, 0)}`,
    `client=${getClientID(record)}`,
    `ship=${getShipID(record)}`,
  ];
  if (record.missile && record.missile.itemID) {
    parts.push(`missile=${toInt(record.missile.itemID, 0)}`);
  }
  if (record.moduleID) {
    parts.push(`module=${toInt(record.moduleID, 0)}`);
  }
  console.log(parts.join(" "));
  if (record.sendOptions) {
    console.log(`  sendOptions=${JSON.stringify(record.sendOptions)}`);
  }
  if (record.options) {
    console.log(`  options=${JSON.stringify(record.options)}`);
  }
  if (record.weaponSnapshot && record.weaponSnapshot.chargeTypeID) {
    console.log(
      `  chargeTypeID=${toInt(record.weaponSnapshot.chargeTypeID, 0)} durationMs=${toInt(record.weaponSnapshot.durationMs, 0)}`,
    );
  }
  console.log("");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!fs.existsSync(options.log)) {
    throw new Error(`Log file not found: ${options.log}`);
  }

  const input = fs.createReadStream(options.log, { encoding: "utf8" });
  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });
  let printed = 0;
  for await (const line of rl) {
    if (!line || line.indexOf("{") < 0) {
      continue;
    }
    const record = parseLogLine(line);
    if (!matchesFilters(record, options)) {
      continue;
    }
    if (record.event === "destiny.emit-group") {
      printEmitGroup(record);
    } else {
      printGenericRecord(record);
    }
    printed += 1;
    if (printed >= options.limit) {
      break;
    }
  }
  rl.close();
  input.close();

  if (printed <= 0) {
    console.log("No matching records.");
  }
}

main();
