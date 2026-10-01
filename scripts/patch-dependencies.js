#!/usr/bin/env node
"use strict";

// Teach the installed dependency tree Minecraft versions it doesn't ship yet,
// and backport protocol fixes that are still sitting in upstream PRs.
//
// Runs on `postinstall`. Every patch is independent, idempotent, and becomes a
// no-op once its package ships the real thing, logging "already" — when every
// line says that, delete vendor/, this script and the postinstall hook.
//
//   1. minecraft-data      — vendored data sets for versions npm doesn't have
//   2. prismarine-chunk    — hardcoded chunk-implementation map
//   3. prismarine-physics  — hardcoded feature version lists
//   4. mineflayer          — send tick_end at the end of every client tick
//
// 2 and 3 are the dangerous pair. They throw during mineflayer's *plugin
// injection*, which runs on a deferred tick inside an event handler, so the
// connection itself survives: the bot logs in and sits in the world looking
// healthy while half of mineflayer never attached — the visible symptom is a
// session stuck on "connecting" that is, in fact, connected.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const VENDOR_DIR = path.join(ROOT, "vendor");
const MARKER = ".mc-presence-vendored";

// The newest version each prismarine-* table already knows; new versions
// reuse its entry (the chunk format and physics constants are unchanged).
const BASE_VERSION = "26.1";

function log(msg) {
  console.log(`[patch-deps] ${msg}`);
}

function pkgDir(name) {
  try {
    return path.dirname(require.resolve(`${name}/package.json`, { paths: [ROOT] }));
  } catch (_) {
    return null;
  }
}

// vendor/minecraft-data-<version>/ → ["26.2", ...]
function vendoredVersions() {
  if (!fs.existsSync(VENDOR_DIR)) return [];
  return fs.readdirSync(VENDOR_DIR)
    .map(d => (d.match(/^minecraft-data-(.+)$/) || [])[1])
    .filter(Boolean);
}

// --- 1. minecraft-data ------------------------------------------------------
// Version lookups go through a *generated* data.js built from dataPaths.json,
// so copying JSON in isn't enough — the generator has to re-run afterwards.
// A marker holding the vendored files' hash lets a corrected data set replace
// a stale one on the next install (a plain "does it resolve?" check can't).
function patchMinecraftData(version) {
  const root = pkgDir("minecraft-data");
  if (!root) return log("minecraft-data not installed — skipping.");

  const vendor = path.join(VENDOR_DIR, `minecraft-data-${version}`);
  const dataDir = path.join(root, "minecraft-data", "data");
  const versionDir = path.join(dataDir, "pc", version);
  const markerPath = path.join(versionDir, MARKER);
  const dataPathsFile = path.join(dataDir, "dataPaths.json");
  const versionsFile = path.join(dataDir, "pc", "common", "versions.json");
  const generator = path.join(root, "bin", "generate_data.js");

  for (const p of [dataDir, dataPathsFile, versionsFile, generator]) {
    if (!fs.existsSync(p)) return log(`minecraft-data layout changed (${p} missing) — skipping ${version}.`);
  }

  const files = fs.readdirSync(vendor).filter(f => f.endsWith(".json") && !f.startsWith("dataPaths."));
  const hash = crypto.createHash("sha256");
  for (const f of files.sort()) hash.update(f).update(fs.readFileSync(path.join(vendor, f)));
  hash.update(fs.readFileSync(path.join(vendor, `dataPaths.pc.${version}.json`)));
  const digest = hash.digest("hex");

  const dataPaths = JSON.parse(fs.readFileSync(dataPathsFile, "utf8"));
  // Native support means upstream shipped a full data set for the version.
  // The pre-marker version of this script injected only protocol.json and
  // pointed blocks at an older release, so that shape gets re-patched.
  const existingRow = dataPaths.pc[version];
  const hasMarker = fs.existsSync(markerPath);
  const isNative = !hasMarker && existingRow && existingRow.blocks === `pc/${version}` &&
    fs.existsSync(path.join(versionDir, "protocol.json")) && fs.existsSync(path.join(versionDir, "blocks.json"));
  if (isNative) return log(`minecraft-data ${version}: already ships natively.`);
  if (fs.existsSync(markerPath) && fs.readFileSync(markerPath, "utf8").trim() === digest) {
    return log(`minecraft-data ${version}: already patched.`);
  }

  fs.mkdirSync(versionDir, { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(vendor, f), path.join(versionDir, f));

  // Point each data key at the vendored copy, or wherever upstream said. If
  // upstream references a directory this minecraft-data release doesn't have
  // (its master moves faster than npm), borrow BASE_VERSION's entry instead.
  const row = JSON.parse(fs.readFileSync(path.join(vendor, `dataPaths.pc.${version}.json`), "utf8"));
  const base = dataPaths.pc[BASE_VERSION] || {};
  for (const [key, target] of Object.entries(row)) {
    const ext = key === "proto" ? "yml" : "json";
    if (!fs.existsSync(path.join(dataDir, target, `${key}.${ext}`)) && base[key]) {
      log(`minecraft-data ${version}: ${key} -> ${target} not present in this release, using ${base[key]}.`);
      row[key] = base[key];
    }
  }
  dataPaths.pc[version] = row;
  fs.writeFileSync(dataPathsFile, JSON.stringify(dataPaths, null, 2));

  const versions = JSON.parse(fs.readFileSync(versionsFile, "utf8"));
  if (!versions.includes(version)) {
    versions.push(version);
    fs.writeFileSync(versionsFile, JSON.stringify(versions, null, 2));
  }

  execFileSync(process.execPath, [generator], { cwd: root, stdio: "inherit" });

  // Verify in a clean process — this one has the pre-patch data.js cached.
  const check = execFileSync(
    process.execPath,
    ["-e", `const d=require('minecraft-data')(${JSON.stringify(version)});process.stdout.write(d&&d.blocksArray.length?String(d.version.version):'null')`],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (check === "null") throw new Error(`minecraft-data still can't resolve ${version}`);

  fs.writeFileSync(markerPath, digest + "\n");
  log(`minecraft-data ${version}: injected ${files.length} data files, protocol ${check}.`);
}

// --- 2. prismarine-chunk ----------------------------------------------------
// 1.19 through 26.1 all point at the same ./pc/1.18/chunk implementation and
// the new versions keep that format.
function patchPrismarineChunk(version) {
  const root = pkgDir("prismarine-chunk");
  if (!root) return log("prismarine-chunk not installed — skipping.");

  const file = path.join(root, "src", "index.js");
  if (!fs.existsSync(file)) return log("prismarine-chunk src/index.js not found — skipping.");

  let src = fs.readFileSync(file, "utf8");
  if (src.includes(`'${version}':`) || src.includes(`"${version}":`)) return log(`prismarine-chunk ${version}: already mapped.`);

  const ref = new RegExp(`\\n(\\s*)['"]?${BASE_VERSION.replace(".", "\\.")}['"]?: (require\\('[^']+'\\))`);
  const m = src.match(ref);
  if (!m) return log(`prismarine-chunk: ${BASE_VERSION} entry not found, layout changed — skipping.`);

  src = src.replace(ref, `\n${m[1]}'${version}': ${m[2]},${m[0]}`);
  fs.writeFileSync(file, src);
  log(`prismarine-chunk ${version}: mapped to the ${BASE_VERSION} chunk implementation.`);
}

// --- 3. prismarine-physics --------------------------------------------------
// Every feature list naming BASE_VERSION applies unchanged. Without them the
// Physics constructor throws "No liquid gravity settings".
function patchPrismarinePhysics(version) {
  const root = pkgDir("prismarine-physics");
  if (!root) return log("prismarine-physics not installed — skipping.");

  const file = path.join(root, "lib", "features.json");
  if (!fs.existsSync(file)) return log("prismarine-physics lib/features.json not found — skipping.");

  const features = JSON.parse(fs.readFileSync(file, "utf8"));
  let changed = 0;
  for (const feature of features) {
    if (!Array.isArray(feature.versions)) continue;
    if (feature.versions.includes(BASE_VERSION) && !feature.versions.includes(version)) {
      feature.versions.push(version);
      changed++;
    }
  }
  if (!changed) return log(`prismarine-physics ${version}: already covered.`);
  fs.writeFileSync(file, JSON.stringify(features, null, 2));
  log(`prismarine-physics ${version}: added to ${changed} feature list(s).`);
}

// --- 4. mineflayer: tick_end ------------------------------------------------
// Since 1.21.2 the vanilla client ends every tick with a tick_end packet, sent
// after that tick's movement packet. Mineflayer never sends it, and 26.3
// servers enforce it — a client that doesn't is kicked for
// invalid_player_movement shortly after spawning (also when a 26.2 client is
// translated by ViaBackwards, which passes our packets through as-is).
// Backport of upstream mineflayer PR #4137. Gated on the protocol actually
// defining the packet, so older versions are untouched.
function patchMineflayerTickEnd() {
  const root = pkgDir("mineflayer");
  if (!root) return log("mineflayer not installed — skipping.");

  const file = path.join(root, "lib", "plugins", "physics.js");
  if (!fs.existsSync(file)) return log("mineflayer physics.js not found — skipping.");
  let src = fs.readFileSync(file, "utf8");
  if (src.includes("tick_end")) return log("mineflayer tick_end: already sends it.");

  const before = `  function tickPhysics (now) {
    if (!bot.entity?.position || !Number.isFinite(bot.entity.position.x)) return // entity not ready
    if (bot.blockAt(bot.entity.position) == null) return // check if chunk is unloaded
    if (bot.physicsEnabled && shouldUsePhysics) {
      physics.simulatePlayer(new PlayerState(bot, controlState), world).apply(bot)
      bot.emit('physicsTick')
      bot.emit('physicTick') // Deprecated, only exists to support old plugins. May be removed in the future
    }
    if (shouldUsePhysics) {
      updatePosition(now)
    }
  }`;
  const after = `  // 1.21.2+ clients end every tick with tick_end, sent after that tick's movement packet
  // (backported from mineflayer PR #4137 by mc-presence's postinstall script)
  const sendsTickEnd = !!bot.registry.protocol?.play?.toServer?.types?.packet_tick_end

  function tickPhysics (now) {
    if (bot._client.state !== 'play') return // do nothing outside of the play state (e.g. configuration phase)
    if (!bot.entity?.position || !Number.isFinite(bot.entity.position.x)) return // entity not ready
    if (bot.blockAt(bot.entity.position) != null) { // otherwise the chunk is unloaded: no simulation
      if (bot.physicsEnabled && shouldUsePhysics) {
        physics.simulatePlayer(new PlayerState(bot, controlState), world).apply(bot)
        bot.emit('physicsTick')
        bot.emit('physicTick') // Deprecated, only exists to support old plugins. May be removed in the future
      }
      if (shouldUsePhysics) {
        updatePosition(now)
      }
    }
    if (sendsTickEnd) bot._client.write('tick_end', {})
  }`;
  if (!src.includes(before)) return log("mineflayer tick_end: tickPhysics changed shape upstream — skipping (check whether it sends tick_end now).");
  fs.writeFileSync(file, src.replace(before, after));
  log("mineflayer tick_end: patched physics to end every tick with tick_end.");
}

try {
  for (const version of vendoredVersions()) {
    patchMinecraftData(version);
    patchPrismarineChunk(version);
    patchPrismarinePhysics(version);
  }
  patchMineflayerTickEnd();
} catch (err) {
  console.error(`[patch-deps] FAILED: ${err.message}`);
  process.exit(1);
}
