# MC Presence

A self-hosted Minecraft presence bot that keeps your accounts connected to a server while you're away. Manage multiple sessions, greet players automatically, and run an AI-powered support bot — all from a clean web dashboard.

## Highlights

- **Multi-session** — connect as many Minecraft accounts as you need from one dashboard
- **Always-on modes** — manual, permanent, or scheduled connection windows
- **AI chat** — four modes powered by Claude: AFK responder, support bot, player disguise, or off
- **Real-time dashboard** — live chat, player list, latency tracking, dark/light theme
- **Anti-AFK** — automatic movement to prevent idle kicks
- **Smart reconnect** — exponential backoff, maintenance windows, duplicate login detection
- **CobbleBridge** — optional Paper plugin integration for virtual bots without a real MC account

## Quick Start

```bash
# Docker
docker run -d --name mc-presence -p 3100:3100 \
  -v ./data:/app/data -v ./mc-auth:/app/.minecraft \
  -e MC_HOST=play.example.net mc-presence

# Node.js
git clone https://github.com/RedZephon/Minecraft-Present-Bot.git
cd Minecraft-Present-Bot && npm install && cp .env.example .env
npm start
```

Open **http://localhost:3100** to access the dashboard.

## Documentation

Full setup guides, configuration reference, and deployment instructions are available on the **[Wiki](https://github.com/RedZephon/Minecraft-Present-Bot/wiki)**.

- [Getting Started](https://github.com/RedZephon/Minecraft-Present-Bot/wiki/Getting-Started)
- [Self-Hosting (Node.js)](https://github.com/RedZephon/Minecraft-Present-Bot/wiki/Self-Hosting-Node.js)
- [Docker Deployment](https://github.com/RedZephon/Minecraft-Present-Bot/wiki/Docker-Deployment)
- [Web Host / VPS Deployment](https://github.com/RedZephon/Minecraft-Present-Bot/wiki/VPS-Deployment)
- [Configuration Reference](https://github.com/RedZephon/Minecraft-Present-Bot/wiki/Configuration)
- [AI Chat Modes](https://github.com/RedZephon/Minecraft-Present-Bot/wiki/AI-Chat-Modes)
- [CobbleBridge Plugin](https://github.com/RedZephon/Minecraft-Present-Bot/wiki/CobbleBridge)

## License

MIT
