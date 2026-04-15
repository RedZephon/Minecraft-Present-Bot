# AI Chat Modes

MC Presence supports four AI chat modes per session, powered by the Anthropic Claude API. Each mode defines how the bot interacts with players in-game.

## Requirements

- An **Anthropic API key** set in Settings > AI Chat
- The session must be **connected** to the server
- An AI mode must be selected in the session's **Behavior** panel

## Modes

### Off
No AI responses. The bot is silent and only maintains presence on the server.

### AFK Responder
The bot acts as you — away from keyboard.

**Behavior:**
- Only responds when directly mentioned by name or whispered to
- Tells players you're AFK
- Directs server questions to the support bot (if one is running)
- Greets new players with a welcome message
- Says "wb" (welcome back) to returning players

**Best for:** Your main account when you want to maintain presence and be polite while away.

### Support Bot
A full AI assistant that answers server questions.

**Behavior:**
- Only responds to **@mentions** (e.g., `@BotName how do I claim land?`) or whispers
- Has access to tools:
  - **Read plugin configs** — looks up server plugin settings to answer config questions
  - **Player lookup** — checks playtime, first join date, stats
  - **Web search** — searches for vanilla Minecraft info and plugin documentation
- Offers help proactively when frustration is detected (rate-limited)
- Can be silenced by the server owner via in-game chat

**Admin commands** (owner only, must mention the bot):
- `@BotName shut up` / `be quiet` / `silence` — silences for 5 minutes (or specify: `shut up 10 min`)
- `@BotName resume` — cancels silence early
- `@BotName status` — shows active/silenced state and daily message count

**Assistant Name:** When this mode is active, you can set a custom name (e.g., "Helper", "Guide") that displays in the dashboard chat log and is used in the AI's self-references.

**Best for:** A dedicated bot account running as your server's help system.

### Player Disguise
The bot pretends to be a real player.

**Behavior:**
- Only responds when mentioned by name or whispered to
- Types in lowercase, uses shorthand (u, ur, ngl, lol, idk, etc.)
- Keeps responses very short (1-8 words)
- Denies being a bot if asked
- Greets new players with casual "welcome" messages
- Says "wb" to returning players
- Sometimes responds with "ty" when other players also say "wb"
- Has a 15% chance to ignore mentions (feels human)

**Best for:** Making your server feel more active. Multiple disguise bots with different accounts create a natural atmosphere.

## Greeting System

All AI modes (except Off) participate in the greeting system:

- **First-time joins** — detected via server broadcast messages. Bots send a welcome message appropriate to their mode.
- **Returning players** — disguise and AFK bots say "wb". Support bots stay silent for returning players.
- **Staggered delays** — when multiple disguise bots are running, greetings are staggered with random delays so they don't all fire at once.
- **Deduplication** — 30-second window per bot/player pair prevents double greetings. 5-minute cooldown per player prevents spam on quick reconnects.

## Rate Limiting

All AI modes are rate-limited:
- **Max 3 messages per 30 seconds** per bot
- **Message deduplication** — identical messages within 30 seconds are suppressed
- **Per-player cooldown** — configurable in Settings (default: 15 seconds)
- **Daily tracking** — message counts are tracked per bot per day

## Tips

- Run **one support bot** and **multiple disguise bots** for the best effect
- Set the support bot's **Assistant Name** to something players will remember
- Use the **Server Info** field in Settings to give the AI context about your server's features, plugins, and rules
- Customize prompts in Settings > Prompts if the defaults don't match your server's tone
- The **Owner Username** setting lets you use admin commands without the bot treating you as a regular player
