#!/usr/bin/env node
"use strict";

// End-to-end checks against a real dashboard process and a fake Minecraft
// server (minecraft-protocol in offline mode), no network or accounts needed.
//
//   npm test
//
// Covers the connection state machine — spawn, tick_end, holds, yielding to
// a duplicate login, reconnect backoff, the spawn watchdog, cancelling a
// connect mid-flight, unreachable servers — plus dashboard auth and the
// cross-origin guard.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { startFakeServer, VERSION } = require("./fake-server");

const ROOT = path.join(__dirname, "..");
const PASSWORD = "integration-test-password";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitFor(fn, { timeout = 15000, interval = 100, what = "condition" } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

// ---------------------------------------------------------------------------
// Dashboard process
// ---------------------------------------------------------------------------
async function startDashboard({ webPort, mcPort, dataDir, env = {} }) {
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      AUTH_DIR: path.join(dataDir, "auth"),
      WEB_PORT: String(webPort),
      WEB_HOST: "127.0.0.1",
      MC_HOST: "127.0.0.1",
      MC_PORT: String(mcPort),
      DASHBOARD_PASSWORD: PASSWORD,
      MC_SPAWN_TIMEOUT_MS: "3000",
      ANTHROPIC_API_KEY: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.output = "";
  child.stdout.on("data", d => { child.output += d; });
  child.stderr.on("data", d => { child.output += d; });
  await waitFor(() => child.output.includes("dashboard on"), { what: "dashboard start" });
  return child;
}

function makeClient(base) {
  let cookie = "";
  return {
    async login(password = PASSWORD) {
      const res = await fetch(`${base}/login`, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base },
        body: `password=${encodeURIComponent(password)}`,
      });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      return res;
    },
    async get(p) {
      return fetch(base + p, { headers: { Cookie: cookie, Accept: "application/json" } });
    },
    async post(p, origin = base) {
      return fetch(base + p, { method: "POST", headers: { Cookie: cookie, Origin: origin } });
    },
    async status() {
      const res = await this.get("/api/status");
      assert.strictEqual(res.status, 200);
      return res.json();
    },
    async session(id) {
      return (await this.status()).bots.find(b => b.id === id);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-presence-test-"));
  const mcPort = await freePort();
  const webPort = await freePort();
  const deadPort = await freePort(); // nothing listens here
  const base = `http://127.0.0.1:${webPort}`;

  fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({
    reconnect: { baseDelay: 1, maxDelay: 2, maxRetries: 5 },
    maintenance: { enabled: false, start: "01:59", end: "02:05" },
    bridge: { secret: "changeme" },
  }));
  fs.writeFileSync(path.join(dataDir, "bots.json"), JSON.stringify([
    { id: "alpha", label: "Alpha", username: "AlphaBot", auth: "offline", mode: "manual", autoReconnect: true, antiAfk: false },
    { id: "perm", label: "Perm", username: "PermBot", auth: "offline", mode: "permanent", autoReconnect: true, antiAfk: false, paused: true },
  ]));

  const fake = startFakeServer(mcPort);
  await new Promise(r => fake.once("listening", r));
  let dash = await startDashboard({ webPort, mcPort, dataDir });
  const api = makeClient(base);
  const results = [];
  const test = async (name, fn) => {
    try {
      await fn();
      results.push([true, name]);
      console.log(`  ok   ${name}`);
    } catch (err) {
      results.push([false, name]);
      console.log(`  FAIL ${name}\n       ${err.message}`);
    }
  };

  try {
    console.log(`Integration tests (Minecraft ${VERSION})`);

    await test("dashboard refuses unauthenticated API calls", async () => {
      const res = await api.get("/api/status");
      assert.strictEqual(res.status, 401);
      const page = await fetch(base + "/", { redirect: "manual" });
      assert.strictEqual(page.status, 302);
      assert.strictEqual(page.headers.get("location"), "/login");
    });

    await test("wrong password is rejected, right one signs in", async () => {
      const bad = await api.login("nope");
      assert.match(bad.headers.get("location"), /e=1/);
      const good = await api.login();
      assert.strictEqual(good.headers.get("location"), "/");
      assert.strictEqual((await api.get("/api/status")).status, 200);
    });

    await test("secrets never reach the dashboard", async () => {
      const s = await api.status();
      assert.strictEqual(s.settings.ai.apiKey, "");
      assert.strictEqual(s.settings.bridge.secret, "");
      assert.strictEqual(s.settings.bridge.secretInsecure, true);
    });

    await test("cross-origin POST is refused", async () => {
      const res = await api.post("/api/connect/alpha", "https://evil.example");
      assert.strictEqual(res.status, 403);
      assert.strictEqual(fake.logins, 0);
    });

    await test("held (paused) permanent session stays offline at boot", async () => {
      await sleep(4500); // first schedule tick runs 3 s after boot
      const perm = await api.session("perm");
      assert.strictEqual(perm.state, "disconnected");
      assert.strictEqual(fake.logins, 0);
    });

    await test("connect → spawn → connected, version detected by ping", async () => {
      await api.post("/api/connect/alpha");
      const s = await waitFor(async () => {
        const b = await api.session("alpha");
        return b.state === "connected" && b;
      }, { what: "alpha connected" });
      assert.strictEqual(s.detectedVersion, VERSION);
      assert.strictEqual(s.connectedUsername, "AlphaBot");
      assert.ok(s.connectedAt > 0);
    });

    await test("client ends every tick with tick_end", async () => {
      const before = fake.tickEnds;
      await sleep(1000);
      assert.ok(fake.tickEnds - before >= 10, `only ${fake.tickEnds - before} tick_end packets in 1 s`);
    });

    await test("user disconnect of a manual session", async () => {
      await api.post("/api/disconnect/alpha");
      const b = await waitFor(async () => { const x = await api.session("alpha"); return x.state === "disconnected" && x; }, { what: "alpha disconnected" });
      assert.strictEqual(b.reconnectPending, false);
    });

    await test("connect clears the hold on a permanent session", async () => {
      await api.post("/api/connect/perm");
      await waitFor(async () => (await api.session("perm")).state === "connected", { what: "perm connected" });
      assert.strictEqual((await api.session("perm")).paused, false);
    });

    await test("user disconnect holds a permanent session offline", async () => {
      const logins = fake.logins;
      await api.post("/api/disconnect/perm");
      await sleep(4000);
      const perm = await api.session("perm");
      assert.strictEqual(perm.state, "disconnected");
      assert.strictEqual(perm.paused, true);
      assert.strictEqual(fake.logins, logins);
    });

    await test("generic kick on an always-on session reconnects with backoff", async () => {
      fake.behaviour = "kick-generic";
      await api.post("/api/connect/perm");
      await waitFor(async () => (await api.session("perm")).lastKickReason === "Server restarting", { what: "kick" });
      fake.behaviour = "normal";
      await waitFor(async () => (await api.session("perm")).state === "connected", { what: "reconnect", timeout: 20000 });
    });

    await test("duplicate-login kick yields instead of fighting the real client", async () => {
      fake.behaviour = "kick-duplicate";
      const loginsBefore = fake.logins;
      await api.post("/api/disconnect/perm");
      await api.post("/api/connect/perm");
      await waitFor(async () => (await api.session("perm")).yieldedDuplicate, { what: "yield" });
      fake.behaviour = "normal";
      await sleep(4000);
      const perm = await api.session("perm");
      assert.strictEqual(perm.state, "disconnected");
      assert.strictEqual(perm.reconnectPending, false);
      assert.strictEqual(fake.logins, loginsBefore + 1);
      await api.post("/api/disconnect/perm");
    });

    await test("spawn watchdog drops a login that never spawns", async () => {
      fake.behaviour = "no-health";
      await api.post("/api/connect/alpha");
      await waitFor(async () => (await api.session("alpha")).state === "connecting", { what: "connecting" });
      await waitFor(async () => (await api.session("alpha")).state === "disconnected", { what: "watchdog", timeout: 10000 });
      fake.behaviour = "normal";
    });

    await test("disconnect during the version ping cancels the attempt", async () => {
      const logins = fake.logins;
      await api.post("/api/connect/alpha");
      await api.post("/api/disconnect/alpha");
      await sleep(2500);
      assert.strictEqual((await api.session("alpha")).state, "disconnected");
      assert.strictEqual(fake.logins, logins, "a cancelled connect still logged in");
    });

    await test("server-side close is reported and doesn't wedge the session", async () => {
      await api.post("/api/connect/alpha");
      await waitFor(async () => (await api.session("alpha")).state === "connected", { what: "alpha connected" });
      for (const c of fake.clientsList) c.end("Server closed");
      await waitFor(async () => (await api.session("alpha")).state === "disconnected", { what: "closed" });
      await api.post("/api/connect/alpha");
      await waitFor(async () => (await api.session("alpha")).state === "connected", { what: "reconnect after close" });
      await api.post("/api/disconnect/alpha");
    });

    await test("unreachable server fails fast instead of hanging", async () => {
      dash.kill("SIGTERM");
      await new Promise(r => dash.once("exit", r));
      dash = await startDashboard({ webPort, mcPort: deadPort, dataDir });
      await api.login();
      await api.post("/api/connect/alpha");
      const b = await waitFor(async () => { const x = await api.session("alpha"); return x.state === "disconnected" && x.reconnectAttempts === 0 && x; }, { what: "fail fast", timeout: 12000 });
      assert.ok(b);
      assert.match(dash.output, /Server unreachable/);
    });

    await test("SIGTERM shuts down cleanly", async () => {
      dash.kill("SIGTERM");
      const code = await new Promise(r => dash.once("exit", r));
      assert.strictEqual(code, 0);
      assert.match(dash.output, /SIGTERM received/);
    });
  } finally {
    try { dash.kill("SIGKILL"); } catch (_) {}
    fake.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  const failed = results.filter(([ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) {
    console.log("\n--- dashboard output ---\n" + dash.output.split("\n").slice(-60).join("\n"));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
