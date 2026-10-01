#!/usr/bin/env node
"use strict";

// CobbleBridge (virtual player) sessions end to end, against a fake
// CobbleBridge plugin (same HTTP API as the real one), a fake Discord webhook,
// and a fake Anthropic API. Checks plugin events in, chat out, and that the
// Discord webhook gets every bridge-bot message with the [Bot] name.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const { startFakeServer } = require("./fake-server");

const ROOT = path.join(__dirname, "..");
const SECRET = "bridge-test-secret";
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

// Tiny JSON HTTP server: handler(req, body) -> [status, json].
function jsonServer(port, handler) {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", d => { raw += d; });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      const [status, json] = handler(req, body);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(json ?? {}));
    });
  });
  server.listen(port, "127.0.0.1");
  return server;
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-presence-bridge-test-"));
  const [webPort, pluginPort, discordPort, apiPort, mcPort] = await Promise.all([freePort(), freePort(), freePort(), freePort(), freePort()]);
  // A real-account session watches the game, like the operator's own accounts.
  const fake = startFakeServer(mcPort);
  await new Promise(r => fake.once("listening", r));
  const base = `http://127.0.0.1:${webPort}`;

  // Fake CobbleBridge plugin.
  const plugin = { chats: [], whispers: [], players: [{ name: "Steve", uuid: "00000000-0000-0000-0000-000000000001" }], badSecret: 0 };
  const pluginServer = jsonServer(pluginPort, (req, body) => {
    if (req.headers["x-bridge-secret"] !== SECRET) { plugin.badSecret++; return [403, { error: "unauthorized" }]; }
    if (req.url === "/api/health") return [200, { status: "ok", players: plugin.players.length, tps: 20 }];
    if (req.url === "/api/players") return [200, plugin.players];
    if (req.url === "/api/plugins") return [200, ["Lands", "CMI"]];
    if (req.url.startsWith("/api/player/")) return [200, { name: decodeURIComponent(req.url.split("/").pop()) }];
    if (req.url === "/api/chat") { plugin.chats.push(body.message); return [200, { ok: true }]; }
    if (req.url === "/api/whisper") { plugin.whispers.push(body); return [200, { ok: true }]; }
    return [404, { error: "not found" }];
  });

  // Fake Discord webhook.
  const discord = { posts: [], failNext: false };
  const discordServer = jsonServer(discordPort, (req, body) => {
    if (discord.failNext) { discord.failNext = false; return [500, { message: "boom" }]; }
    discord.posts.push({ url: req.url, body });
    return [204, null];
  });

  // Fake Anthropic API.
  const api = { requests: [], respond: () => "[silent]", failNext: null };
  const apiServer = jsonServer(apiPort, (req, body) => {
    api.requests.push(body);
    if (api.failNext) { const f = api.failNext; api.failNext = null; return f; }
    return [200, { content: [{ type: "text", text: api.respond(body) }], stop_reason: "end_turn" }];
  });
  const userText = (r) => r.messages.map(m => (typeof m.content === "string" ? m.content : "")).join("\n");
  // Just the part describing why the model is being asked (after the transcript).
  const trigger = (r) => userText(r).split("\n\n").slice(1).join("\n\n");

  fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({
    ai: { responseDelayMs: 0, cooldownSeconds: 0 },
    maintenance: { enabled: false, start: "01:59", end: "02:05" },
  }));
  fs.writeFileSync(path.join(dataDir, "bots.json"), JSON.stringify([
    { id: "cobblebot", label: "CobbleBot", botType: "bridge", mode: "manual", aiMode: "support" },
    { id: "watcher", label: "Watcher", username: "Watcher", auth: "offline", mode: "manual", antiAfk: false },
    // Like the operator's own account: opted in to support-bot replies.
    { id: "owner", label: "Owner", username: "Owner", auth: "offline", mode: "manual", antiAfk: false, aiReplies: true },
  ]));

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
      BRIDGE_URL: `http://127.0.0.1:${pluginPort}`,
      BRIDGE_SECRET: SECRET,
      DISCORD_WEBHOOK: `http://127.0.0.1:${discordPort}/api/webhooks/123/abc`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  dash.stdout.on("data", d => { output += d; });
  dash.stderr.on("data", d => { output += d; });

  const event = (e, secret = SECRET) => fetch(`${base}/api/plugin-event`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bridge-Secret": secret },
    body: JSON.stringify(e),
  });
  const session = async () => (await (await fetch(`${base}/api/status`)).json()).bots[0];

  const results = [];
  const test = async (name, fn) => {
    try { await fn(); results.push(true); console.log(`  ok   ${name}`); }
    catch (err) { results.push(false); console.log(`  FAIL ${name}\n       ${err.message}`); }
  };

  try {
    console.log("CobbleBridge + Discord tests");
    await waitFor(() => output.includes("dashboard on"), { what: "dashboard" });

    await test("bridge session connects through the plugin's health check", async () => {
      await fetch(`${base}/api/connect/cobblebot`, { method: "POST" });
      await waitFor(async () => (await session()).state === "connected", { what: "connected" });
      assert.deepStrictEqual((await session()).players.map(p => p.username), ["Steve"]);
      assert.strictEqual(plugin.badSecret, 0);
    });

    await test("plugin events with the wrong secret are refused", async () => {
      const res = await event({ type: "player_chat", player: "Steve", message: "hi" }, "wrong");
      assert.strictEqual(res.status, 403);
    });

    await test("a player joining an empty server is welcomed in game and on Discord as [Bot] CobbleBot", async () => {
      api.respond = (r) => (userText(r).includes("just joined the server for the very first time") ? "Welcome Steve! It's quiet - small passion project." : "[silent]");
      await event({ type: "player_join", player: "Steve", firstTime: true });
      await waitFor(() => plugin.chats.includes("Welcome Steve! It's quiet - small passion project."), { what: "in-game welcome" });
      const post = await waitFor(() => discord.posts.find(p => p.body.content.startsWith("Welcome Steve!")), { what: "discord welcome" });
      assert.strictEqual(post.url, "/api/webhooks/123/abc");
      assert.strictEqual(post.body.username, "[Bot] CobbleBot");
      assert.match(post.body.avatar_url, /mc-heads\.net\/avatar\/CobbleBot\//);
      assert.deepStrictEqual(post.body.allowed_mentions, { parse: [] });
    });

    await test("a mention gets an AI reply in game and on Discord, and can't ping @everyone", async () => {
      api.respond = (r) => (trigger(r).includes("claim land") ? "@everyone use /lands create, Steve!" : "[silent]");
      const before = discord.posts.length;
      await event({ type: "player_chat", player: "Steve", message: "@CobbleBot how do I claim land?" });
      await waitFor(() => plugin.chats.includes("@everyone use /lands create, Steve!"), { what: "in-game reply" });
      const post = await waitFor(() => discord.posts.slice(before).find(p => p.body.content.includes("/lands create")), { what: "discord reply" });
      assert.strictEqual(post.body.username, "[Bot] CobbleBot");
      assert.deepStrictEqual(post.body.allowed_mentions, { parse: [] });
    });

    await test("players' own chat is not posted to Discord by the app", async () => {
      const before = discord.posts.length;
      await event({ type: "player_chat", player: "Steve", message: "just building a house" });
      await sleep(1500);
      assert.strictEqual(discord.posts.length, before);
    });

    await test("a Discord outage is logged and doesn't break in-game chat", async () => {
      discord.failNext = true;
      api.respond = (r) => (trigger(r).includes("still there") ? "Yep, still here!" : "[silent]");
      await event({ type: "player_chat", player: "Steve", message: "@CobbleBot you still there?" });
      await waitFor(() => plugin.chats.includes("Yep, still here!"), { what: "in-game reply" });
      await waitFor(() => output.includes("Discord webhook returned HTTP 500"), { what: "logged failure" });
    });

    await test("with CMI cancelling chat events, the bot still hears chat through account sessions — once", async () => {
      await fetch(`${base}/api/connect/watcher`, { method: "POST" });
      await waitFor(async () => (await (await fetch(`${base}/api/status`)).json()).bots.find(b => b.id === "watcher").state === "connected", { what: "watcher connected" });
      fake.addPlayer("Steve");
      await sleep(1500);
      api.respond = (r) => (trigger(r).includes("hello from the game") ? "Hey Steve, I hear you!" : "[silent]");
      // CMI-formatted line in game; CobbleBridge sends nothing for it.
      fake.system("[Member] Steve » @CobbleBot hello from the game");
      await waitFor(() => plugin.chats.includes("Hey Steve, I hear you!"), { what: "reply via account session" });
      // A late CobbleBridge event for the same line must not cause a second reply.
      const requests = api.requests.length;
      await event({ type: "player_chat", player: "Steve", message: "@CobbleBot hello from the game" });
      await sleep(1500);
      assert.strictEqual(api.requests.length, requests, "the same line was handled twice");
      assert.strictEqual(plugin.chats.filter(c => c === "Hey Steve, I hear you!").length, 1);
      // The bot's own broadcast, seen in game, isn't treated as someone talking.
      fake.system("CobbleBot » Hey Steve, I hear you!");
      await sleep(1000);
      assert.strictEqual(api.requests.length, requests);
    });

    await test("a message typed in the dashboard as an opted-in account gets a reply from the virtual bot", async () => {
      await fetch(`${base}/api/connect/owner`, { method: "POST" });
      await waitFor(async () => (await (await fetch(`${base}/api/status`)).json()).bots.find(b => b.id === "owner").state === "connected", { what: "owner connected" });
      const io = require("../node_modules/socket.io/client-dist/socket.io.js");
      const socket = io(base, { transports: ["websocket"] });
      await new Promise((resolve, reject) => { socket.once("init", resolve); socket.once("connect_error", reject); });
      api.respond = (r) => (trigger(r).includes("hey @cobblebot") ? "Hey Owner!" : "[silent]");
      socket.emit("send_chat", { botId: "owner", message: "hey @cobblebot" });
      try {
        await waitFor(() => plugin.chats.includes("Hey Owner!"), { what: "reply to dashboard message" });
      } finally {
        socket.close();
      }
    });

    await test("when the AI can't reply, the dashboard says why", async () => {
      api.failNext = [401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }];
      await event({ type: "player_chat", player: "Steve", message: "@CobbleBot are you broken?" });
      const log = await waitFor(async () => {
        const l = (await (await fetch(`${base}/api/sessions/cobblebot/log`)).json()).chatLog;
        return l.find(m => m.type === "error" && m.message.startsWith("Couldn't reply"));
      }, { what: "error line" });
      assert.strictEqual(log.message, "Couldn't reply: Anthropic API error 401: invalid x-api-key (the API key is invalid or revoked)");
    });

    await test("a mention it decides not to answer leaves a note", async () => {
      api.respond = () => "[silent]";
      await event({ type: "player_chat", player: "Steve", message: "@CobbleBot lol nvm" });
      await waitFor(async () => (await (await fetch(`${base}/api/sessions/cobblebot/log`)).json()).chatLog
        .some(m => m.message === "Chose not to reply to Steve."), { what: "silence note" });
    });

    await test("the bridge session reports when the plugin last reached the app", async () => {
      const s = (await (await fetch(`${base}/api/status`)).json()).bots.find(b => b.id === "cobblebot");
      assert.ok(s.bridgeLastEventAt > 0);
      await event({ type: "player_chat", player: "Steve", message: "x" }, "wrong");
      const s2 = (await (await fetch(`${base}/api/status`)).json()).bots.find(b => b.id === "cobblebot");
      assert.ok(s2.bridgeRejectedAt > 0);
      assert.match(output, /Rejected a CobbleBridge event: wrong or missing secret/);
    });

    await test("the dashboard log shows the bot as [Bot] CobbleBot", async () => {
      const log = (await (await fetch(`${base}/api/sessions/cobblebot/log`)).json()).chatLog;
      const line = log.find(m => m.message === "Yep, still here!");
      assert.deepStrictEqual([line.sender, line.realName, line.type], ["[Bot] CobbleBot", "CobbleBot", "auto"]);
    });
  } finally {
    try { dash.kill("SIGKILL"); } catch (_) {}
    pluginServer.close();
    fake.close();
    discordServer.close();
    apiServer.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) {
    console.log("\n--- dashboard output ---\n" + output.split("\n").slice(-40).join("\n"));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
