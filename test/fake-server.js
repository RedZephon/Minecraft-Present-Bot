"use strict";

// A minimal offline-mode Minecraft server for tests and local UI work.
// Speaks the newest version mineflayer supports, logs players in, spawns them,
// and can be told to misbehave (never spawn, kick, etc.).

const mc = require("minecraft-protocol");
const nbt = require("prismarine-nbt");
const crypto = require("crypto");

const VERSION = require("mineflayer").testedVersions.slice(-1)[0];
const registry = require("prismarine-registry")(VERSION);

function startFakeServer(port, { host = "127.0.0.1", ambient = false } = {}) {
  const server = mc.createServer({ "online-mode": false, version: VERSION, port, host, motd: "Fake test server" });
  server.behaviour = "normal"; // normal | no-health | kick-duplicate | kick-generic
  server.logins = 0;
  server.tickEnds = 0;
  server.chats = [];
  server.clientsList = [];

  // minecraft-protocol's *server* side predates 26.2's login-success
  // sessionId field; fill it in so the fake server can log anyone in.
  server.on("connection", (client) => {
    const write = client.write.bind(client);
    client.write = (name, params) => write(name, name === "success" && params && !params.sessionId
      ? { ...params, sessionId: params.uuid }
      : params);
  });

  const systemChat = (client, text) => client.write("system_chat", {
    content: nbt.comp({ text: nbt.string(text) }),
    isActionBar: false,
  });
  const playing = () => server.clientsList.filter(c => c.state === "play");

  // Scripted players: tab-list entries plus vanilla-style "<name> text" chat.
  server.fakePlayers = new Map(); // name -> uuid
  const addPacket = (entries) => ({
    action: { add_player: true, update_listed: true, update_latency: true },
    data: entries.map(([name, uuid]) => ({ uuid, player: { name, properties: [] }, listed: 1, latency: 30 })),
  });
  server.addPlayer = (name) => {
    const uuid = crypto.randomUUID();
    server.fakePlayers.set(name, uuid);
    for (const c of playing()) c.write("player_info", addPacket([[name, uuid]]));
  };
  server.removePlayer = (name) => {
    const uuid = server.fakePlayers.get(name);
    if (!uuid) return;
    server.fakePlayers.delete(name);
    for (const c of playing()) c.write("player_remove", { players: [uuid] });
  };
  server.say = (name, text) => {
    for (const c of playing()) systemChat(c, `<${name}> ${text}`);
  };

  server.on("playerJoin", (client) => {
    server.logins++;
    server.clientsList.push(client);
    client.on("tick_end", () => server.tickEnds++);
    client.on("chat_message", (p) => {
      server.chats.push(p.message);
      // Echo chat back like a real server so the dashboard shows it.
      for (const c of server.clientsList) if (c.state === "play") systemChat(c, `<${client.username}> ${p.message}`);
    });
    client.on("chat_command", (p) => server.chats.push("/" + p.command));
    client.on("chat_command_signed", (p) => server.chats.push("/" + p.command));
    client.on("end", () => {
      server.clientsList = server.clientsList.filter(c => c !== client);
    });

    client.write("login", { ...registry.loginPacket, entityId: 1 });
    client.write("position", {
      x: 0.5, y: 64, z: 0.5, dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0,
      teleportId: 1, flags: {},
    });
    if (server.behaviour === "no-health") return;
    client.write("update_health", { health: 20, food: 20, foodSaturation: 5 });
    if (server.fakePlayers.size) setTimeout(() => client.write("player_info", addPacket([...server.fakePlayers])), 100);

    if (server.behaviour === "kick-duplicate" || server.behaviour === "kick-generic") {
      const reason = server.behaviour === "kick-duplicate" ? "You logged in from another location" : "Server restarting";
      setTimeout(() => client.end(reason), 600);
      return;
    }

    if (ambient) startAmbient(client, systemChat);
  });
  return server;
}

// Some tab-list players and chatter, for eyeballing the dashboard.
function startAmbient(client, systemChat) {
  const players = ["Notch", "jeb_", "Dinnerbone", "Grumm"].map(name => ({
    uuid: crypto.randomUUID(),
    player: { name, properties: [] },
    listed: 1,
    latency: 20 + Math.floor(Math.random() * 80),
  }));
  try {
    client.write("player_info", {
      action: { add_player: true, update_listed: true, update_latency: true },
      data: players,
    });
  } catch (err) {
    console.error("[fake-server] player_info failed:", err.message);
  }
  const lines = [
    "<Notch> anyone know where the nether portal is?",
    "Dinnerbone joined the game",
    "<jeb_> @Grumm check spawn",
    "Grumm was slain by Zombie",
  ];
  let i = 0;
  const timer = setInterval(() => {
    if (client.state !== "play") return clearInterval(timer);
    systemChat(client, lines[i++ % lines.length]);
  }, 8000);
  client.on("end", () => clearInterval(timer));
}

module.exports = { startFakeServer, VERSION, registry };
