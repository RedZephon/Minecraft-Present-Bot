#!/usr/bin/env node
"use strict";

// End-to-end checks for the AI behaviour, against a fake Minecraft server and
// a fake Anthropic API that records every request and returns scripted replies.
// Verifies what the bot *asks* the model (context, triggers) and what it
// *does* with the answer (sends, stays silent) — no real model involved.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const { startFakeServer } = require("./fake-server");

const ROOT = path.join(__dirname, "..");
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function waitFor(fn, { timeout = 15000, interval = 100, what = "condition" } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

// Fake Anthropic Messages API.
function startFakeAnthropic(port) {
  const api = { requests: [], respond: () => "[silent]" };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", d => { body += d; });
    req.on("end", () => {
      const parsed = JSON.parse(body);
      api.requests.push(parsed);
      const text = api.respond(parsed);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ content: [{ type: "text", text }], stop_reason: "end_turn" }));
    });
  });
  server.listen(port, "127.0.0.1");
  api.close = () => server.close();
  return api;
}

const userText = (r) => r.messages.map(m => (typeof m.content === "string" ? m.content : "")).join("\n");
const isNotes = (r) => r.system.startsWith("You maintain a short notebook");

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-presence-ai-test-"));
  const [mcPort, webPort, apiPort] = await Promise.all([freePort(), freePort(), freePort()]);
  const base = `http://127.0.0.1:${webPort}`;

  fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({
    ownerUsername: "RedZephon",
    staffUsernames: ["LadyZephon", "SmoothObsidian"],
    timezone: "America/Edmonton",
    ai: { responseDelayMs: 0, cooldownSeconds: 0 },
    maintenance: { enabled: false, start: "01:59", end: "02:05" },
  }));
  fs.writeFileSync(path.join(dataDir, "bots.json"), JSON.stringify([
    { id: "helper", label: "Helper", username: "Helper", auth: "offline", mode: "manual", aiMode: "support", antiAfk: false },
    { id: "afker", label: "Afker", username: "Afker", auth: "offline", mode: "manual", aiMode: "afk", antiAfk: true },
    { id: "notowner", label: "NotOwner", username: "NotOwner", auth: "offline", mode: "manual", aiMode: "admin-afk", antiAfk: false },
  ]));

  const fake = startFakeServer(mcPort);
  await new Promise(r => fake.once("listening", r));
  const api = startFakeAnthropic(apiPort);

  const dash = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      AUTH_DIR: path.join(dataDir, "auth"),
      WEB_PORT: String(webPort),
      WEB_HOST: "127.0.0.1",
      MC_HOST: "127.0.0.1",
      MC_PORT: String(mcPort),
      DASHBOARD_PASSWORD: "",
      ANTHROPIC_API_KEY: "test-key",
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${apiPort}`,
      BRIDGE_URL: "http://127.0.0.1:1", // nothing there; fails fast
      LEARN_TICK_MS: "1500",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  dash.stdout.on("data", d => { output += d; });
  dash.stderr.on("data", d => { output += d; });

  const status = async () => (await fetch(`${base}/api/status`)).json();
  const session = async (id) => (await status()).bots.find(b => b.id === id);
  const results = [];
  const test = async (name, fn) => {
    try { await fn(); results.push(true); console.log(`  ok   ${name}`); }
    catch (err) { results.push(false); console.log(`  FAIL ${name}\n       ${err.message}`); }
  };
  const chatsFrom = (n) => fake.chats.slice(n);
  const replyRequests = () => api.requests.filter(r => !isNotes(r));

  try {
    console.log("AI behaviour tests");
    await waitFor(() => output.includes("dashboard on"), { what: "dashboard" });
    for (const id of ["helper", "afker", "notowner"]) await fetch(`${base}/api/connect/${id}`, { method: "POST" });
    await waitFor(async () => (await status()).bots.every(b => b.state === "connected"), { what: "all connected" });

    await test("AFK mode sets /afk on spawn", async () => {
      await waitFor(() => fake.chats.filter(c => c === "/afk").length >= 2, { what: "/afk", timeout: 8000 });
    });

    await test("the AFK Responder falls back to plain AFK on someone else's account", async () => {
      const b = await session("notowner");
      assert.strictEqual(b.effectiveMode, "afk");
      assert.strictEqual(b.afkResponderAllowed, false);
      const log = (await (await fetch(`${base}/api/status`)).json()).bots.find(x => x.id === "notowner");
      assert.ok(log, "session present");
    });

    await test("a player joining an empty server gets a welcome that explains the quiet", async () => {
      api.respond = (r) => (userText(r).includes("just joined the server for the very first time")
        ? "Welcome Newbie! It's quiet right now - this is a small self-hosted passion project.\nType @Helper anytime!"
        : "[silent]");
      const before = fake.chats.length;
      fake.addPlayer("Newbie");
      const req = await waitFor(() => replyRequests().find(r => userText(r).includes("Newbie just joined")), { what: "join request" });
      assert.match(userText(req), /nobody else is online/);
      assert.match(userText(req), /self-hosted passion project/);
      assert.match(req.system, /PLAYER ACTIVITY/);
      await waitFor(() => chatsFrom(before).some(c => c.startsWith("Welcome Newbie!")), { what: "welcome sent" });
      await waitFor(() => chatsFrom(before).includes("Type @Helper anytime!"), { what: "second line sent" });
    });

    await test("players chatting with each other don't trigger the bot", async () => {
      fake.addPlayer("Alex");
      await sleep(4000); // Alex's own greeting (not empty → template, no model call)
      const before = replyRequests().length;
      fake.say("Alex", "hey Newbie wanna go explore?");
      await sleep(300);
      fake.say("Newbie", "sure where?");
      await sleep(300);
      fake.say("Alex", "the big mountain lol");
      await sleep(2000);
      assert.strictEqual(replyRequests().length, before, "the model was asked about player banter");
    });

    await test("an open question goes to the model, which may choose silence", async () => {
      api.respond = () => "Players are just talking to each other, I'll stay out of it.";
      const before = fake.chats.length;
      const reqsBefore = replyRequests().length;
      await sleep(1000);
      fake.say("Newbie", "does anyone know how to claim land?");
      const req = await waitFor(() => replyRequests().slice(reqsBefore).find(r => userText(r).includes("claim land")), { what: "open-question request" });
      assert.match(userText(req), /nobody has answered yet/);
      // The transcript shows the conversation so far.
      assert.match(userText(req), /Alex: hey Newbie wanna go explore\?/);
      await sleep(1500);
      assert.strictEqual(chatsFrom(before).length, 0, "narration about staying quiet reached chat");
    });

    await test("staff announcements are learned and used later", async () => {
      fake.addPlayer("RedZephon");
      await sleep(3000);
      api.respond = (r) => (isNotes(r)
        ? JSON.stringify({ add: [{ text: "On Sep 30, RedZephon said the 1.5 update with new biomes is coming next week.", source: "RedZephon" }], remove: [] })
        : "[silent]");
      fake.say("RedZephon", "heads up everyone, the 1.5 update with new biomes is coming next week");
      const notesReq = await waitFor(() => api.requests.find(r => isNotes(r) && userText(r).includes("heads up")), { what: "notes extraction", timeout: 10000 });
      assert.match(userText(notesReq), /RedZephon: heads up everyone/);
      assert.ok(!fake.chats.some(c => c.includes("Welcome to the server, RedZephon")), "staff were welcomed as a new player");
      assert.match(userText(notesReq), /Staff: .*redzephon/i);

      api.respond = (r) => (userText(r).includes("any updates coming") ? "RedZephon mentioned the 1.5 update with new biomes is coming next week!" : "[silent]");
      const before = fake.chats.length;
      await sleep(500);
      fake.say("Newbie", "@Helper any updates coming?");
      const req = await waitFor(() => replyRequests().find(r => userText(r).includes("any updates coming")), { what: "mention request" });
      assert.match(req.system, /WHAT YOU'VE PICKED UP FROM CHAT[\s\S]*1\.5 update/);
      assert.match(req.system, /Staff: RedZephon \(owner\), LadyZephon, SmoothObsidian/);
      await waitFor(() => chatsFrom(before).some(c => c.startsWith("RedZephon mentioned the 1.5 update")), { what: "reply sent" });
      assert.ok(fs.existsSync(path.join(dataDir, "notes.json")), "notes persisted");
    });

    await test("a follow-up to the bot is answered without a mention", async () => {
      api.respond = (r) => (userText(r).includes("right after you talked with them") ? "Next week, keep an eye on chat!" : "[silent]");
      const before = fake.chats.length;
      fake.say("Newbie", "oh nice, when exactly?");
      await waitFor(() => chatsFrom(before).includes("Next week, keep an eye on chat!"), { what: "follow-up reply" });
    });

    await test("someone else stepping in ends the follow-up", async () => {
      const reqsBefore = replyRequests().length;
      fake.say("Alex", "Newbie it'll be friday probably");
      await sleep(300);
      fake.say("Newbie", "ok cool thanks");
      await sleep(2000);
      assert.strictEqual(replyRequests().length, reqsBefore);
    });

    await test("SIGTERM still shuts down cleanly and saves activity", async () => {
      dash.kill("SIGTERM");
      const code = await new Promise(r => dash.once("exit", r));
      assert.strictEqual(code, 0);
      const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "activity.json"), "utf8"));
      assert.ok(saved.sessions.some(s => s.p === "Newbie"), "Newbie's session recorded");
      assert.ok(!saved.sessions.some(s => /helper|afker|notowner/i.test(s.p)), "bots excluded from activity");
    });
  } finally {
    try { dash.kill("SIGKILL"); } catch (_) {}
    fake.close();
    api.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) {
    console.log("\n--- dashboard output ---\n" + output.split("\n").slice(-60).join("\n"));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
