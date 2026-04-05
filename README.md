# MC Presence Bot

A multi-account headless Minecraft presence bot with a real-time web dashboard and AI-powered chat. Keep accounts online on your server 24/7, greet players, and run an AI support bot — all from a single Docker container.

## Features

### Bot Management
- **Multiple accounts** — manage as many Minecraft bots as you need from one dashboard
- **Three connection modes** — Manual, Permanent (always online), or Scheduled (time windows)
- **Microsoft auth** ��� device-code login flow, tokens persist across restarts
- **Auto-reconnect** — exponential backoff with jitter, configurable max retries
- **Maintenance windows** — bots pause reconnecting during server restarts
- **Duplicate login detection** — bots yield when you log in with the same account, resume when you leave
- **Auto version detection** — pings the server to match protocol version

### AI Chat (Claude-powered)
Four AI modes per bot, powered by the Anthropic API:

| Mode | Behavior |
|------|----------|
| **Off** | No AI responses |
| **Admin AFK** | Responds when mentioned, says you're AFK, directs to support bot |
| **Support Bot** | Answers server questions via @mention, reads plugin configs, looks up players, searches the web |
| **Disguise** | Pretends to be a real player — casual typing, denies being a bot |

**Support bot features:**
- Strict @mention filter — only responds when directly addressed or whispered
- Tool use — reads server plugin configs, looks up player stats, web searches for Minecraft/plugin info
- Frustration detection — offers help to struggling players (rate-limited, non-intrusive)
- Admin commands — silence, resume, and status via in-game chat
- Message deduplication and rate limiting (max 3 msgs / 30s per bot)

**Greeting system:**
- Staggered "wb" from disguise bots with randomized delays
- First-time player welcome messages
- Organic "ty" responses when real players also say wb
- 5-minute rejoin cooldown, 30-second dedup — no spam

### CobbleBridge Integration (Optional)
Connect to the [CobbleBridge](https://github.com/RedZephon/CobbleBridge) Paper plugin to run a virtual support bot without a real Minecraft account:
- Send chat and whispers through the server
- Receive real-time events (joins, quits, chat, deaths, advancements)
- Read plugin configs for AI tool use
- Discord webhook forwarding

### Web Dashboard
- Real-time bot status, chat logs, and player lists via Socket.io
- Add, edit, remove, and configure bots
- Send chat messages and commands
- Settings panel for all configuration
- Mobile-friendly PWA — installable on iOS/Android

## Quick Start

### Docker Compose (recommended)

1. Clone the repo:
   ```bash
   git clone https://github.com/RedZephon/Minecraft-Present-Bot.git
   cd Minecraft-Present-Bot
   ```

2. Edit `docker-compose.yml` with your server details:
   ```yaml
   environment:
     MC_HOST: "your.server.com"
     MC_PORT: "25565"
     OWNER_USERNAME: "YourMCUsername"
   ```

3. Start the container:
   ```bash
   docker compose up -d
   ```

4. Open `http://localhost:3100` in your browser.

### Docker Run

```bash
docker build -t mc-presence-bot .
docker run -d \
  --name mc-presence-bot \
  --restart unless-stopped \
  -p 3100:3100 \
  -v mc-auth:/app/.minecraft \
  -v mc-data:/app/data \
  -e MC_HOST=your.server.com \
  -e MC_PORT=25565 \
  -e WEB_PORT=3100 \
  -e OWNER_USERNAME=YourMCUsername \
  mc-presence-bot
```

### Without Docker

Requires Node.js 20+.

```bash
npm install
MC_HOST=your.server.com MC_PORT=25565 node server.js
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MC_HOST` | `localhost` | Default Minecraft server address |
| `MC_PORT` | `25565` | Default Minecraft server port |
| `WEB_PORT` | `3100` | Web dashboard port |
| `OWNER_USERNAME` | *(empty)* | Your MC username — enables admin chat commands |
| `ANTHROPIC_API_KEY` | *(empty)* | Anthropic API key for AI chat (or set via dashboard) |
| `BRIDGE_URL` | `http://localhost:3101` | CobbleBridge plugin URL |
| `BRIDGE_SECRET` | `changeme` | Shared secret for bridge auth |
| `DISCORD_WEBHOOK` | *(empty)* | Discord webhook URL for chat forwarding |

All settings can also be configured through the web dashboard under Settings.

### Admin Chat Commands

When `OWNER_USERNAME` is set, you can control the support bot from in-game chat:

| Command | Effect |
|---------|--------|
| `@BotName shut up 10 min` | Silence for 10 minutes |
| `@BotName be quiet` | Silence for 5 minutes (default) |
| `@BotName resume` | Cancel silence early |
| `@BotName status` | Report active/silenced state and daily message count |

### AI Setup

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. Enter it in the dashboard under Settings > AI Chat, or set the `ANTHROPIC_API_KEY` environment variable
3. Set the AI mode on each bot (click the AI badge on the bot card to cycle modes)

The default model is `claude-haiku-4-5-20251001` — fast and cheap. You can change it in settings.

## Architecture

```
┌──────────────┐       ┌──────────────────┐       ┌──────���───────┐
│  Web Browser  │◄─────►│   MC Presence    │◄─────►│  MC Server   │
│  (Dashboard)  │ ws    │   (Node.js)      │ mc    │              │
└──────────────┘       │                  │       └──────────────┘
                       │  Express         │
                       │  Socket.io       │       ┌──────────────┐
                       │  Mineflayer      │◄─────►│ CobbleBridge │
                       │  Anthropic API   │ http  │ (Paper plugin)│
                       └────────────���─────┘       └──────────────┘
```

- **server.js** — Node.js backend handling all bot connections, AI, and real-time communication
- **public/index.html** — Single-file SPA dashboard
- **data/** — Persistent storage for bot configs, settings, and known player data (auto-created)
- **.minecraft/** — Microsoft auth token cache (auto-created)

## Data Persistence

Two Docker volumes keep your data across rebuilds:

| Volume | Path | Contents |
|--------|------|----------|
| `mc-auth` | `/app/.minecraft` | Microsoft auth tokens |
| `mc-data` | `/app/data` | Bot configs, settings, known players |

## Rebuilding

After code changes:

```bash
docker stop mc-presence-bot && docker rm mc-presence-bot
docker build -t mc-presence-bot .
docker run -d --name mc-presence-bot --restart unless-stopped \
  -p 3100:3100 \
  -v mc-auth:/app/.minecraft \
  -v mc-data:/app/data \
  -e MC_HOST=your.server.com \
  -e MC_PORT=25565 \
  -e WEB_PORT=3100 \
  -e OWNER_USERNAME=YourMCUsername \
  mc-presence-bot
```

Your bot configs and auth tokens are preserved in the volumes.

## Tech Stack

- [Mineflayer](https://github.com/PrismarineJS/mineflayer) — Minecraft bot framework
- [Express](https://expressjs.com/) + [Socket.io](https://socket.io/) — Web server and real-time communication
- [Anthropic Claude API](https://docs.anthropic.com/) — AI chat with tool use
- Docker — Containerized deployment

## License

MIT
