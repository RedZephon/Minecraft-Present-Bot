# MC Presence

A self-hosted Minecraft presence bot that keeps your accounts connected to a server while you're away. Manage multiple sessions, greet players automatically, and run an AI-powered support bot — all from a clean web dashboard.

## Highlights

- **Multi-session** — connect as many Minecraft accounts as you need from one dashboard
- **Always-on modes** — manual, always online, or scheduled connection windows (timezone-aware)
- **Chat modes** — plain AFK, an AFK responder (owner's account only), a support bot, or a player disguise; the AI modes are powered by Claude
- **A support bot that reads the room** — answers when spoken to or when an open question goes unanswered, stays out of players' own conversations, learns announcements from chat, and welcomes players who join an empty server with when people are usually on
- **Real-time dashboard** — live chat, player list, latency, dark/light theme, mobile-friendly
- **Anti-AFK and breaks** — randomised movement, plus optional "step away" breaks
- **Smart reconnect** — exponential backoff, maintenance windows, and it steps aside when you log in yourself
- **CobbleBridge** — optional Paper plugin integration for virtual bots without a real MC account

## Minecraft versions

Speaks up to **26.2** (protocol 776) natively. Newer servers work when they run
**ViaVersion + ViaBackwards** (5.12+ for 26.3): the bot detects this
automatically and joins as 26.2. Without Via, a newer server refuses the
connection and the dashboard says so.

## Quick start

```bash
# Docker
docker run -d --name mc-presence -p 3100:3100 \
  -v ./data:/app/data -v ./mc-auth:/app/.minecraft \
  -e MC_HOST=play.example.net -e DASHBOARD_PASSWORD=change-this \
  mc-presence

# Node.js 22+
git clone https://github.com/RedZephon/Minecraft-Present-Bot.git
cd Minecraft-Present-Bot && npm install && cp .env.example .env
npm start
```

Open **http://localhost:3100** to access the dashboard.

## Security

The dashboard can chat and run commands as your Minecraft accounts.

- **Set `DASHBOARD_PASSWORD`.** Without it, anyone who can reach the port has full control. Or bind it locally with `WEB_HOST=127.0.0.1`.
- **Behind a reverse proxy,** set `TRUST_PROXY=1`. If the proxy rewrites the `Host` header, also set `ALLOWED_ORIGINS=https://your.domain`.
- **Using CobbleBridge?** Give it a long random shared secret. Settings → Bridge can generate one.
- **Secrets stay on the server.** The Anthropic key, bridge secret and Discord webhook are never sent to the browser.

## Development

```bash
npm test      # end-to-end tests against a fake local Minecraft server
npm run dev   # dashboard on :3111 with a fake server and throwaway data
```

## Documentation

Full setup guides and configuration reference are on the **[Wiki](https://github.com/RedZephon/Minecraft-Present-Bot/wiki)**.

- [Getting Started](https://github.com/RedZephon/Minecraft-Present-Bot/wiki/Getting-Started)
- [Self-Hosting (Node.js)](https://github.com/RedZephon/Minecraft-Present-Bot/wiki/Self-Hosting-Node.js)
- [Docker Deployment](https://github.com/RedZephon/Minecraft-Present-Bot/wiki/Docker-Deployment)
- [Web Host / VPS Deployment](https://github.com/RedZephon/Minecraft-Present-Bot/wiki/VPS-Deployment)
- [Configuration Reference](https://github.com/RedZephon/Minecraft-Present-Bot/wiki/Configuration)
- [AI Chat Modes](https://github.com/RedZephon/Minecraft-Present-Bot/wiki/AI-Chat-Modes)
- [CobbleBridge Plugin](https://github.com/RedZephon/Minecraft-Present-Bot/wiki/CobbleBridge)

## License

MIT
