#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function printUsageAndExit(exitCode = 1) {
  const usage = [
    "Usage: node server/scripts/verifyWarpDestinationHandoffLog.js --log <client-log> [options]",
    "",
    "Options:",
    "  --expect parity|stale|any     Default: parity",
    "  --max-lookback-lines <n>      StopWarp AddBalls search window. Default: 1400",
    "  --max-link-lines <n>          DoDestinyUpdate/AddBalls link window. Default: 500",
    "  --json                        Print JSON instead of text",
  ].join("\n");
  console.error(usage);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    log: "",
    expect: "parity",
    maxLookbackLines: 1400,
    maxLinkLines: 500,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--log") {
      args.log = String(argv[++index] || "");
    } else if (arg === "--expect") {
      args.expect = String(argv[++index] || "").trim().toLowerCase();
    } else if (arg === "--max-lookback-lines") {
      args.maxLookbackLines = Number(argv[++index]);
    } else if (arg === "--max-link-lines") {
      args.maxLinkLines = Number(argv[++index]);
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsageAndExit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printUsageAndExit(1);
    }
  }
  if (!args.log) {
    printUsageAndExit(1);
  }
  if (!["parity", "stale", "any"].includes(args.expect)) {
    throw new Error(`Invalid --expect value: ${args.expect}`);
  }
  if (!Number.isFinite(args.maxLookbackLines) || args.maxLookbackLines <= 0) {
    args.maxLookbackLines = 1400;
  }
  if (!Number.isFinite(args.maxLinkLines) || args.maxLinkLines <= 0) {
    args.maxLinkLines = 500;
  }
  return args;
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function parseLog(logPath, options) {
  const raw = fs.readFileSync(logPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const updates = [];
  const adds = [];
  const stops = [];
  let lastUpdate = null;

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];

    const updateMatch = line.match(
      /DoDestinyUpdate call for tick\s+(\d+)\s+containing\s+(\d+)\s+updates\.\s+waitForBubble=\s*(True|False)/i,
    );
    if (updateMatch) {
      lastUpdate = {
        line: lineNumber,
        tick: toInt(updateMatch[1]),
        updateCount: toInt(updateMatch[2]),
        waitForBubble: /^true$/i.test(updateMatch[3]),
        historyLine: 0,
        historyTick: null,
      };
      updates.push(lastUpdate);
      continue;
    }

    const historyMatch = line.match(/History Dump\s+(\d+)/i);
    if (
      historyMatch &&
      lastUpdate &&
      !lastUpdate.historyLine &&
      lineNumber - lastUpdate.line <= 12
    ) {
      lastUpdate.historyLine = lineNumber;
      lastUpdate.historyTick = toInt(historyMatch[1]);
      continue;
    }

    const addMatch = line.match(/Action:\s+AddBalls2\s+(\d+)\s+-\s+current:\s+(\d+)/i);
    if (addMatch) {
      const stamp = toInt(addMatch[1]);
      const current = toInt(addMatch[2]);
      const linkedUpdate = [...updates].reverse().find((update) => (
        update.tick === stamp &&
        update.line <= lineNumber &&
        lineNumber - update.line <= options.maxLinkLines
      )) || null;
      adds.push({
        line: lineNumber,
        stamp,
        current,
        actionDelta: stamp - current,
        staleAtAction: stamp < current,
        linkedUpdateLine: linkedUpdate ? linkedUpdate.line : 0,
        linkedHistoryLine: linkedUpdate ? linkedUpdate.historyLine : 0,
        linkedHistoryTick: linkedUpdate ? linkedUpdate.historyTick : null,
        updateHistoryDelta:
          linkedUpdate && Number.isFinite(linkedUpdate.historyTick)
            ? stamp - linkedUpdate.historyTick
            : null,
        staleAtHistory:
          linkedUpdate && Number.isFinite(linkedUpdate.historyTick)
            ? stamp <= linkedUpdate.historyTick
            : null,
        waitForBubble: linkedUpdate ? linkedUpdate.waitForBubble : null,
      });
      continue;
    }

    const stopMatch = line.match(/StopWarpIndication Destination:\s*([^<\r\n]+)/i);
    if (stopMatch) {
      stops.push({
        line: lineNumber,
        destination: String(stopMatch[1] || "").trim(),
      });
    }
  }

  const warpStops = stops.map((stop) => {
    const candidates = adds.filter((add) => (
      add.line < stop.line &&
      stop.line - add.line <= options.maxLookbackLines
    ));
    const destinationAdd = candidates.length > 0
      ? candidates[candidates.length - 1]
      : null;
    const problems = [];
    if (!destinationAdd) {
      problems.push("missing-destination-addballs-before-stopwarp");
    } else {
      if (destinationAdd.waitForBubble === true) {
        problems.push("destination-addballs-wait-for-bubble");
      }
      if (destinationAdd.staleAtAction) {
        problems.push("destination-addballs-stale-at-action");
      }
      if (destinationAdd.staleAtHistory === true) {
        problems.push("destination-addballs-stale-at-history");
      }
      if (
        destinationAdd.staleAtHistory === false &&
        destinationAdd.updateHistoryDelta !== null &&
        destinationAdd.updateHistoryDelta > 2
      ) {
        problems.push("destination-addballs-outside-smooth-history-lead");
      }
    }
    return {
      ...stop,
      destinationAdd,
      problems,
      parity: problems.length === 0,
      stale: Boolean(
        destinationAdd &&
        (
          destinationAdd.staleAtAction ||
          destinationAdd.staleAtHistory === true
        ),
      ),
    };
  });

  const staleStops = warpStops.filter((stop) => stop.stale);
  const failedStops = warpStops.filter((stop) => !stop.parity);
  return {
    log: path.normalize(logPath),
    totalLines: lines.length,
    updateCount: updates.length,
    addBallsActionCount: adds.length,
    stopWarpCount: stops.length,
    staleStopCount: staleStops.length,
    failedStopCount: failedStops.length,
    warpStops,
  };
}

function evaluate(result, expect) {
  if (result.stopWarpCount <= 0) {
    return {
      ok: false,
      reason: "no-stopwarp-events",
    };
  }
  if (expect === "any") {
    return {
      ok: true,
      reason: "inspection-only",
    };
  }
  if (expect === "stale") {
    return {
      ok: result.staleStopCount > 0,
      reason: result.staleStopCount > 0
        ? "stale-destination-addballs-detected"
        : "expected-stale-destination-addballs-not-found",
    };
  }
  return {
    ok: result.failedStopCount === 0,
    reason: result.failedStopCount === 0
      ? "all-stopwarps-have-nonstale-destination-addballs"
      : "destination-addballs-parity-failed",
  };
}

function printText(result, evaluation) {
  console.log(`Warp destination handoff log: ${result.log}`);
  console.log(
    `StopWarp=${result.stopWarpCount} AddBallsActions=${result.addBallsActionCount} ` +
      `staleStops=${result.staleStopCount} failedStops=${result.failedStopCount}`,
  );
  for (const stop of result.warpStops) {
    const add = stop.destinationAdd;
    const addSummary = add
      ? (
          `AddBalls line=${add.line} stamp=${add.stamp} current=${add.current} ` +
          `actionDelta=${add.actionDelta} historyDelta=${add.updateHistoryDelta} ` +
          `waitForBubble=${add.waitForBubble}`
        )
      : "AddBalls missing";
    const problemSummary = stop.problems.length > 0
      ? ` problems=${stop.problems.join(",")}`
      : "";
    console.log(
      `- StopWarp line=${stop.line} destination=${stop.destination} ${addSummary}${problemSummary}`,
    );
  }
  console.log(`${evaluation.ok ? "OK" : "FAIL"}: ${evaluation.reason}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const logPath = path.resolve(process.cwd(), args.log);
  const result = parseLog(logPath, args);
  const evaluation = evaluate(result, args.expect);
  if (args.json) {
    console.log(JSON.stringify({ ...result, evaluation }, null, 2));
  } else {
    printText(result, evaluation);
  }
  if (!evaluation.ok) {
    process.exitCode = 1;
  }
}

main();
