#!/usr/bin/env node

const path = require("path");
const { execFileSync } = require("child_process");

process.env.EVEJS_LOG_LEVEL = process.env.EVEJS_LOG_LEVEL || "2";
process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = "1";

const ROOT = path.join(__dirname);

const VERIFY_SCRIPTS = [
  "verifyDestinyAuthorityCore.js",
  "verifyDestinyAuthorityDropAndFx.js",
  "verifyJolt858AuthorityParity.js",
  "verifyJolty324AuthorityParity.js",
  "verifyJolts22DirectCoalescing.js",
  "verifyMorejoltsTeardownCoalescing.js",
  "verifyHere22JoltParity.js",
  "verifyJolts2Parity.js",
  "verifyFulldessync11OwnerMissileAcquireParity.js",
  "verifyNpcjoltOwnerMissileParity.js",
  "verifyHereCombatParity.js",
  "verifyJolt00CombatParity.js",
  "verifyNpcCombatJoltMitigations.js",
  "verifyTargetKillModuleTeardown.js",
  "verifyNativeNpcWeaponReloadParity.js",
  "verifySuperTitanShowStaging.js",
];

function runScript(scriptName) {
  const scriptPath = path.join(ROOT, scriptName);
  execFileSync(process.execPath, [scriptPath], {
    cwd: path.join(__dirname, "..", ".."),
    stdio: "pipe",
    env: process.env,
  });
  return scriptName;
}

function main() {
  const passed = [];
  for (const scriptName of VERIFY_SCRIPTS) {
    passed.push(runScript(scriptName));
  }
  console.log(JSON.stringify({
    passedCount: passed.length,
    passed,
  }, null, 2));
}

main();
