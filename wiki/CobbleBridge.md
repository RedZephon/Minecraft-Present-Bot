# CobbleBridge Integration

CobbleBridge is an optional Paper/Spigot plugin that lets MC Presence run a virtual bot on your server without using a real Minecraft account. The bot can chat, receive events, and read plugin configs — all through an HTTP API.

## When to Use CobbleBridge

Use CobbleBridge when:
- You don't have a spare Minecraft account for the bot
- You want the bot to read server plugin configs for AI tool use
- You want real-time server events (joins, quits, deaths, advancements) forwarded to MC Presence
- You want the bot to chat as a virtual player

You can run CobbleBridge bots alongside regular Mineflayer bots — they're not mutually exclusive.

## Setup

### 1. Install the Plugin

Download the CobbleBridge plugin JAR and place it in your server's `plugins/` folder. Restart the server.

### 2. Configure the Plugin

Edit `plugins/CobbleBridge/config.yml`:

```yaml
port: 3101
secret: "your-shared-secret-here"
```

The **port** is the HTTP port CobbleBridge listens on. The **secret** must match what you configure in MC Presence.

### 3. Configure MC Presence

In Settings > Bridge:
- **Plugin URL** — `http://your-mc-server-ip:3101` (or `http://localhost:3101` if running on the same machine)
- **Shared Secret** — must match the `secret` in the plugin config

### 4. Add a Bridge Session

1. Click **+** to add a new session
2. Set **Bot Type** to "Virtual Player (CobbleBridge)"
3. Enter a **Label** — this is the name the bot uses in-game chat
4. Configure mode and AI as desired
5. Click **Save**, then **Connect**

## Features

### Chat
The virtual bot can send messages to the server chat. Messages appear in-game as if from a player (the label you set).

### Events
CobbleBridge forwards these events to MC Presence in real-time:
- Player joins and quits (including first-time detection)
- Player chat messages
- Player deaths
- Advancements

### Plugin Config Reading (AI Tool)
When the support bot AI mode is active, it can read plugin configuration files through CobbleBridge. This lets it answer questions like "How much does a diamond cost in the shop?" by reading the actual plugin config.

### Player Lookup (AI Tool)
The AI can look up player stats, playtime, first join date, and more through CobbleBridge.

### Discord Webhook
If configured, bot messages are also forwarded to a Discord webhook. Set the webhook URL in Settings > Bridge.

## Network Requirements

MC Presence must be able to reach the CobbleBridge plugin's HTTP port:
- If running on the **same machine**: use `http://localhost:3101`
- If running on **different machines**: use the MC server's IP and ensure port 3101 is accessible
- If using **Docker**: use the host's IP or Docker network address, not `localhost`

## Troubleshooting

### "Bridge connection failed"
- Verify the plugin is loaded: check `plugins/CobbleBridge/` exists on the server
- Check the plugin URL and port are correct
- Ensure the shared secret matches exactly
- Test connectivity: `curl http://your-server:3101/api/health`

### Bot not receiving events
- Make sure the bridge session is **connected** (green status)
- Check the MC server console for CobbleBridge errors
- Verify the plugin URL is reachable from where MC Presence is running

### Chat not sending
- Bridge bots cannot send slash commands — only regular chat
- Check that the shared secret matches
