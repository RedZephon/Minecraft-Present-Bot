# Configuration

MC Presence is configured through environment variables (`.env` file or Docker env) and the in-app Settings page.

## Environment Variables

Set these in your `.env` file or as Docker environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `MC_HOST` | `localhost` | Default Minecraft server address |
| `MC_PORT` | `25565` | Default Minecraft server port |
| `WEB_PORT` | `3100` | Port for the web dashboard |
| `ANTHROPIC_API_KEY` | — | API key for AI chat features ([get one here](https://console.anthropic.com/)) |
| `BRIDGE_URL` | `http://localhost:3101` | CobbleBridge plugin HTTP endpoint |
| `BRIDGE_SECRET` | `changeme` | Shared secret for bridge authentication |
| `DISCORD_WEBHOOK` | — | Discord webhook URL for forwarding bot messages |
| `OWNER_USERNAME` | — | Your Minecraft username (enables admin commands in AI chat) |
| `SERVER_NAME` | — | Display name for the server in the sidebar |

## In-App Settings

Access via the gear icon in the top-right corner. Settings are saved to `data/settings.json`.

### General

**Server Name** — Display name shown in the sidebar server card. If blank, shows "Server".

**Default Host / Port** — The Minecraft server address used as the default when adding new sessions. Also displayed in the sidebar.

**Maintenance Window** — A time range (e.g., 01:59–02:05) during which disconnected bots will wait instead of reconnecting. Useful for scheduled server restarts.

**Reconnect** — Controls auto-reconnect behavior:
- **Base Delay** — Initial wait time in seconds before reconnecting (default: 10)
- **Max Delay** — Maximum wait time after exponential backoff (default: 120)
- **Max Retries** — How many reconnect attempts before giving up (default: 20)

**Owner Username** — Your Minecraft in-game name. Used for admin commands when AI modes are active (e.g., silencing the support bot).

### AI Chat

**Anthropic API Key** — Your API key. Required for any AI chat mode to work.

**Model** — The Claude model to use. Default is `claude-haiku-4-5-20251001` which is fast and inexpensive. You can use any Anthropic model ID.

**Cooldown** — Seconds between AI responses to the same player (default: 15). Prevents spam.

**Response Delay** — Base delay in milliseconds before the AI sends its response (default: 2000). Randomized up to 50% extra to feel natural.

**Server Info** — Free-text description of your server. This is included in the AI's system prompt so it can answer server-specific questions accurately.

### Prompts

Custom system prompts for each AI mode. Use `{botName}` as a placeholder for the bot's Minecraft username. Leave blank to use the built-in defaults (which are shown as placeholder text).

### Bridge

**Plugin URL** — HTTP endpoint of your CobbleBridge Paper plugin.

**Shared Secret** — Must match the secret configured in the CobbleBridge plugin.

**Discord Webhook** — If set, bot chat messages are forwarded to this Discord webhook.

## Per-Session Settings

Each session has its own settings accessible in the **Session Details** panel (right side):

### Behavior Toggles
- **Auto-reconnect** — Automatically reconnect if the session drops (default: on)
- **Anti-AFK** — Perform small movements every 45 seconds to prevent idle kicks (default: on)

### AI Mode
- **Off** — No AI responses
- **AFK Responder** — Responds when mentioned, tells players you're away
- **Support Bot** — Answers server questions via @mention. Has access to tools (config reading, player lookup, web search)
- **Player Disguise** — Acts like a casual player. Lowercase typing, greetings, denies being a bot

### Assistant Name
Only shown when AI mode is "Support Bot". Sets the display name for AI messages in the chat log (default: "Assistant").

## Data Files

All persistent data lives in the `data/` directory:

| File | Purpose |
|------|---------|
| `bots.json` | Session configurations (accounts, modes, behavior settings) |
| `settings.json` | Global settings (server, AI, bridge config) |
| `known-players.json` | Player tracking for first-time join detection |

Microsoft auth tokens are stored in `.minecraft/` at the project root.
