# Getting Started

This guide walks you through your first MC Presence setup — from install to your first connected session.

## 1. Install

Choose your deployment method:

| Method | Best for |
|--------|----------|
| [Node.js](Self-Hosting-Node.js) | Local machines, development, simple setups |
| [Docker](Docker-Deployment) | Unraid, Synology, always-on servers |
| [VPS](VPS-Deployment) | Cloud hosting (DigitalOcean, Hetzner, AWS, etc.) |

## 2. Open the Dashboard

Once running, open your browser to:

```
http://localhost:3100
```

Replace `localhost` with your server's IP if running remotely.

## 3. Configure Settings

Click the **gear icon** in the top-right corner to open Settings.

### General Tab
- **Server Name** — a display name for your server (shown in the sidebar)
- **Host / Port** — your Minecraft server address and port
- **Maintenance Window** — time range when bots won't try to reconnect (useful for scheduled server restarts)
- **Reconnect** — base delay, max delay, and retry limit for auto-reconnect

### AI Chat Tab (optional)
- **Anthropic API Key** — required if you want AI chat features. Get one at [console.anthropic.com](https://console.anthropic.com/)
- **Model** — defaults to `claude-haiku-4-5-20251001` (fast and cheap)
- **Cooldown / Response Delay** — controls how frequently and quickly the AI responds

Click **Save** when done.

## 4. Add Your First Session

Click the **+** button next to "Your Sessions" in the sidebar.

### For a real Minecraft account:
1. Set **Bot Type** to "Minecraft Account (Mineflayer)"
2. Enter a **Label** (display name for the dashboard)
3. Enter your **Microsoft Email** (the email tied to your MC account)
4. The **Host** and **Port** auto-fill from your settings
5. Leave **Version** blank for auto-detection
6. Choose a **Mode**: Manual, Permanent, or Scheduled
7. Set an **AI Chat Mode** if desired (see [AI Chat Modes](AI-Chat-Modes))
8. Click **Save**

### For a virtual bot (CobbleBridge):
1. Set **Bot Type** to "Virtual Player (CobbleBridge)"
2. Enter a **Label** — this becomes the bot's display name in-game
3. Configure mode and AI as above
4. Click **Save**

## 5. Connect

Click the session in the sidebar, then click **Connect** in the chat header.

### Microsoft Authentication
On first connect, you'll see a Microsoft login prompt with a code and link:
1. Open the link in your browser
2. Enter the code
3. Sign in with your Microsoft account
4. MC Presence stores the token — you won't need to do this again unless the token expires

## 6. Start Chatting

Once connected, you can:
- **Type messages** in the chat input to send them in-game
- **Use slash commands** like `/list`, `/tps`, `/msg`
- **Watch the chat** in real-time — player messages, joins, leaves, and system events all appear
- **Toggle behaviors** in the right-side details panel — auto-reconnect, anti-AFK, AI mode

## Next Steps

- [Configuration](Configuration) — detailed reference for all settings
- [AI Chat Modes](AI-Chat-Modes) — learn how each AI mode works
- [CobbleBridge](CobbleBridge) — set up virtual bot support
