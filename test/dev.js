#!/usr/bin/env node
"use strict";

// Local UI sandbox: the real dashboard pointed at a fake Minecraft server and
// a throwaway data directory, so nothing touches your real sessions or
// Microsoft accounts.
//
//   npm run dev            → http://localhost:3111
//   DASHBOARD_PASSWORD=x npm run dev   (to try the login flow)

const fs = require("fs");
const os = require("os");
const path = require("path");
const { startFakeServer } = require("./fake-server");

const MC_PORT = 25599;
const dataDir = path.join(os.tmpdir(), "mc-presence-dev");
fs.mkdirSync(dataDir, { recursive: true });

const botsPath = path.join(dataDir, "bots.json");
if (!fs.existsSync(botsPath)) {
  fs.writeFileSync(botsPath, JSON.stringify([
    { id: "steve", label: "Steve", username: "Steve", auth: "offline", mode: "manual", antiAfk: true },
    { id: "alex", label: "Alex", username: "Alex", auth: "offline", mode: "permanent", aiMode: "support" },
    { id: "new-account", label: "New account", username: "", auth: "microsoft", mode: "manual" },
  ], null, 2));
}

Object.assign(process.env, {
  DATA_DIR: dataDir,
  AUTH_DIR: path.join(dataDir, "auth"),
  MC_HOST: "127.0.0.1",
  MC_PORT: String(MC_PORT),
  WEB_PORT: process.env.WEB_PORT || "3111",
  SERVER_NAME: "Fake Dev Server",
  ANTHROPIC_API_KEY: "",
});

const fake = startFakeServer(MC_PORT, { ambient: true });
fake.once("listening", () => {
  console.log(`[dev] fake Minecraft server on 127.0.0.1:${MC_PORT}, data in ${dataDir}`);
  require("../server.js");
});
