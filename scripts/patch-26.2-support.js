#!/usr/bin/env node
"use strict";

// Make the installed dependency tree understand Minecraft 26.2 (protocol 776).
//
// Three packages need help, all of them gating on the version string:
//   1. minecraft-data      — ships 26.2's metadata but no protocol schema
//   2. prismarine-chunk    — hardcoded chunk-implementation map, no 26.2 key
//   3. prismarine-physics  — hardcoded feature version lists, no 26.2 entry
//
// 2 and 3 are the dangerous pair. They throw during mineflayer's *plugin
// injection*, which runs on a deferred tick inside an event handler, so the
// connection itself survives: the bot logs in and sits in the world looking
// perfectly healthy while half of mineflayer never attached — including the
// health plugin that emits `spawn` and the game plugin that emits `login`.
// The visible symptom is a session stuck on "connecting" that is, in fact,
// connected and playing.
//
// Each patch is independent and idempotent, and each no-ops once its package
// ships real 26.2 support. When all three report "already", delete vendor/,
// this script, and the postinstall hook.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const TARGET_VERSION = "26.2";
const VENDOR = path.join(__dirname, "..", "vendor", "minecraft-data-26.2");

function log(msg) {
  console.log(`[patch-26.2] ${msg}`);
}

function pkgDir(name) {
  try {
    return path.dirname(require.resolve(`${name}/package.json`));
  } catch (_) {
    return null;
  }
}

// --- 1. minecraft-data ------------------------------------------------------
// Version lookups go through a *generated* data.js built from dataPaths.json,
// so copying the JSON in isn't enough — the generator has to re-run afterwards.
function patchMinecraftData() {
  const root = pkgDir("minecraft-data");
  if (!root) return log("minecraft-data not installed — skipping.");

  try {
    if (require("minecraft-data")(TARGET_VERSION)) {
      return log(`minecraft-data already resolves ${TARGET_VERSION}.`);
    }
  } catch (_) { /* fall through and patch */ }

  const dataDir = path.join(root, "minecraft-data", "data");
  const versionDir = path.join(dataDir, "pc", TARGET_VERSION);
  const dataPathsFile = path.join(dataDir, "dataPaths.json");
  const versionsFile = path.join(dataDir, "pc", "common", "versions.json");
  const generator = path.join(root, "bin", "generate_data.js");

  for (const p of [dataDir, dataPathsFile, versionsFile, generator]) {
    if (!fs.existsSync(p)) return log(`minecraft-data layout changed (${p} missing) — skipping.`);
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

  execFileSync(process.execPath, [generator], { cwd: root, stdio: "inherit" });

  // Verify in a clean process — this one has the pre-patch data.js cached.
  const check = execFileSync(
    process.execPath,
    ["-e", `const d=require('minecraft-data')('${TARGET_VERSION}');process.stdout.write(d?String(d.version.version):'null')`],
    { cwd: path.join(__dirname, ".."), encoding: "utf8" }
  );
  if (check === "null") throw new Error(`minecraft-data still can't resolve ${TARGET_VERSION}`);

  log(`minecraft-data: ${TARGET_VERSION} injected, protocol ${check}.`);
}

// --- 2. prismarine-chunk ----------------------------------------------------
// 1.19 through 26.1 all point at the same ./pc/1.18/chunk implementation and
// 26.2 keeps that format, so it gets the entry upstream will eventually add.
function patchPrismarineChunk() {
  const root = pkgDir("prismarine-chunk");
  if (!root) return log("prismarine-chunk not installed — skipping.");

  const file = path.join(root, "src", "index.js");
  if (!fs.existsSync(file)) return log("prismarine-chunk src/index.js not found — skipping.");

  let src = fs.readFileSync(file, "utf8");
  if (src.includes(`'${TARGET_VERSION}':`)) return log(`prismarine-chunk already knows ${TARGET_VERSION}.`);

  const ref = /\n(\s*)26\.1: (require\('[^']+'\))/;
  const m = src.match(ref);
  if (!m) return log("prismarine-chunk: 26.1 entry not found, layout changed — skipping.");

  src = src.replace(ref, `\n${m[1]}'${TARGET_VERSION}': ${m[2]},\n${m[1]}26.1: ${m[2]}`);
  fs.writeFileSync(file, src);
  log(`prismarine-chunk: mapped ${TARGET_VERSION} to the 26.1 chunk implementation.`);
}

// --- 3. prismarine-physics --------------------------------------------------
// Every feature list naming 26.1 applies unchanged to 26.2. Without them the
// Physics constructor throws "No liquid gravity settings".
function patchPrismarinePhysics() {
  const root = pkgDir("prismarine-physics");
  if (!root) return log("prismarine-physics not installed — skipping.");

  const file = path.join(root, "lib", "features.json");
  if (!fs.existsSync(file)) return log("prismarine-physics lib/features.json not found — skipping.");

  const features = JSON.parse(fs.readFileSync(file, "utf8"));
  let changed = 0;
  for (const feature of features) {
    if (!Array.isArray(feature.versions)) continue;
    if (feature.versions.includes("26.1") && !feature.versions.includes(TARGET_VERSION)) {
      feature.versions.push(TARGET_VERSION);
      changed++;
    }
  }
  if (!changed) return log(`prismarine-physics already covers ${TARGET_VERSION}.`);
  fs.writeFileSync(file, JSON.stringify(features, null, 2));
  log(`prismarine-physics: added ${TARGET_VERSION} to ${changed} feature list(s).`);
}

try {
  patchMinecraftData();
  patchPrismarineChunk();
  patchPrismarinePhysics();
} catch (err) {
  console.error(`[patch-26.2] FAILED: ${err.message}`);
  process.exit(1);
}
