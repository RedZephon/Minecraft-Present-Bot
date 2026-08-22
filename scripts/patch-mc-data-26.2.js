#!/usr/bin/env node
"use strict";

// Inject Minecraft 26.2 (protocol 776) data into the installed minecraft-data.
//
// minecraft-data ships 26.2's *metadata* (it's already in protocolVersions.json)
// but not the protocol schema, so `require('minecraft-data')('26.2')` returns
// null and minecraft-protocol refuses to build a client. The data exists
// upstream on the `pc_26_2` branch (PR #1219) but hasn't been released; the two
// JSON files it adds are vendored under vendor/minecraft-data-26.2/.
//
// minecraft-data resolves versions through a generated `data.js` built from
// `dataPaths.json`, so dropping the files in isn't enough — the generator has to
// re-run afterwards. That's what this does, on postinstall.
//
// This no-ops the moment minecraft-data ships real 26.2 support, so the whole
// vendor/ + scripts/ + postinstall arrangement can simply be deleted then.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const TARGET_VERSION = "26.2";
const VENDOR = path.join(__dirname, "..", "vendor", "minecraft-data-26.2");

function log(msg) {
  console.log(`[patch-mc-data] ${msg}`);
}

let mcDataRoot;
try {
  mcDataRoot = path.dirname(require.resolve("minecraft-data/package.json"));
} catch (_) {
  log("minecraft-data is not installed yet — nothing to patch.");
  process.exit(0);
}

// Already supported upstream? Then this whole shim is dead weight.
try {
  if (require("minecraft-data")(TARGET_VERSION)) {
    log(`minecraft-data already resolves ${TARGET_VERSION} — no patch needed.`);
    process.exit(0);
  }
} catch (_) {
  // Fall through and patch.
}

const dataDir = path.join(mcDataRoot, "minecraft-data", "data");
const versionDir = path.join(dataDir, "pc", TARGET_VERSION);
const dataPathsFile = path.join(dataDir, "dataPaths.json");
const versionsFile = path.join(dataDir, "pc", "common", "versions.json");
const generator = path.join(mcDataRoot, "bin", "generate_data.js");

for (const p of [dataDir, dataPathsFile, versionsFile, generator]) {
  if (!fs.existsSync(p)) {
    log(`expected path missing, skipping patch: ${p}`);
    process.exit(0);
  }
}

fs.mkdirSync(versionDir, { recursive: true });
for (const file of ["protocol.json", "version.json"]) {
  fs.copyFileSync(path.join(VENDOR, file), path.join(versionDir, file));
}

const dataPaths = JSON.parse(fs.readFileSync(dataPathsFile, "utf8"));
dataPaths.pc[TARGET_VERSION] = JSON.parse(
  fs.readFileSync(path.join(VENDOR, "dataPaths.pc.26.2.json"), "utf8")
);
fs.writeFileSync(dataPathsFile, JSON.stringify(dataPaths, null, 2));

const versions = JSON.parse(fs.readFileSync(versionsFile, "utf8"));
if (!versions.includes(TARGET_VERSION)) {
  versions.push(TARGET_VERSION);
  fs.writeFileSync(versionsFile, JSON.stringify(versions, null, 2));
}

// Regenerate data.js so the new dataPaths entry is actually reachable.
execFileSync(process.execPath, [generator], { cwd: mcDataRoot, stdio: "inherit" });

// Verify in a clean process — this one has the pre-patch data.js cached.
const check = execFileSync(
  process.execPath,
  ["-e", `const d=require('minecraft-data')('${TARGET_VERSION}');process.stdout.write(d?String(d.version.version):'null')`],
  { cwd: path.join(__dirname, ".."), encoding: "utf8" }
);

if (check === "null") {
  console.error(`[patch-mc-data] FAILED: minecraft-data still can't resolve ${TARGET_VERSION}`);
  process.exit(1);
}

log(`${TARGET_VERSION} injected — protocol ${check}.`);
