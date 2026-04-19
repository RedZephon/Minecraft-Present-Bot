# Changelog

## v2.0.2

Behavior audit fixes + codebase health pass.

### Code health
- **Removed dead code** — `aiAssistant` field (serialized, never read) and `isBotWithAI` helper (defined, never called).
- **Unified greeting logic** — extracted `buildGreetingMessage()` + `afterGreetingSent()`; mineflayer and bridge paths no longer duplicate the welcome/wb template tree (~60 lines removed).
- **serializeBot chatLog trim** — `botUpdated` emits no longer include the full 300-message log. The log is only sent on initial fetch (`/api/status`, socket connect, `botAdded`). The frontend already tracks individual chat events via the `chat` socket event. This prevents ~60KB/emit × clients fanout on every state change.
- **Bounded memory** — hourly sweep evicts stale entries from `aiCooldowns`, `recentGreetings`, `greetingCooldowns`, `frustrationOffers`, `recentOwnerChat`, `botSilenceUntil`, `lastAfkIssuedAt`, and collapses `botDailyStats` to today's keys only.
- **`botMcUsernames` leak fixed** — entries are now cleared when a bot disconnects, preventing stale name→id mappings.
- **Missing `await`** — `bridgeSendChat` now awaits `callBridgeAPI` and logs bridge errors instead of dropping them.
- **Silent catches logged** — `refreshBridgePlayers` now surfaces errors.
- **Per-bot timer tracking** — `registerBotTimeout()` stores timer handles on the entry; `disconnectBot`, `disconnectBridgeBot`, and `removeBot` now cancel all pending timers so torn-down bots can't fire delayed callbacks (greeting delays, post-reply re-`/afk`, frustration offers, spawn-time `/afk`).

### Reliability
- **Auto Reconnect toggle now works** — the toggle was previously saved but never checked; reconnection was driven entirely by `mode`. Both `scheduleReconnect()` and the schedule ticker now honor `autoReconnect`.
- **Removed dead `autoConnect` legacy fallback** in `registerBot`.

### AI
- **Support bot silence command hardened** — required multi-word phrases (`"shut up"`, `"stop talking"`, etc.). A bare "stop" no longer silences the bot. Resume/unmute only fires when the bot is actually silenced.
- **AFK Responder `/afk` automation** — the bot now issues `/afk` on spawn (when admin-afk is configured), on mode activation, and re-issues it after public-chat replies (rate-limited to once per 60s). Toggling off admin-afk sends a second `/afk` to un-AFK.
- **Anti-AFK upgraded** — the 45s loop now does look rotation + arm swing + a brief sneak pulse so it actually defeats CMI AFK detection. Skipped when the bot is in admin-afk mode.
- **Known players are now shared globally** — welcome vs "wb" is consistent across all bots. Previously each bot tracked its own known-players set, so a fresh bot would welcome long-time players.
- **Unified first-time detection** — `resolveFirstTime()` checks confirmed bridge flag, bridge-reported player file creation time (< 60s = new), then falls back to the global known-players set.

### CobbleBridge
- **Bridge is now the source of truth when active** — join/leave/death events from the plugin are routed to all session logs with consistent formatting (`<player> logged in`). Mineflayer bots suppress duplicate server-broadcast parses while the bridge is active (5-minute TTL after last event).

### Discord
- **Webhook identity fixed** — messages now always use the bot's MC username (or session label) as the Discord display name. Previously AI-mode messages showed as "Assistant" and manual bridge sends defaulted to "MC Presence", making it impossible to tell which session sent a message.

## v2.0.1

Fixes and improvements since the v2.0.0 launch.

### Mobile
- Slide-in sidebar drawer (hamburger menu) and details panel for mobile viewports
- Combined actions dropdown replaces separate Switch/Disconnect buttons on small screens
- Responsive settings page with horizontal tab bar instead of sidebar
- Compact spacing for chat, messages, and input area
- Hidden theme toggle and version badge on mobile (theme available via command palette)
- Avatar flex-shrink fix to prevent distortion on narrow screens

### Networking
- **SRV record resolution** — hostnames like `mc.example.com` are now resolved via `_minecraft._tcp` SRV DNS records automatically. No need to enter the port separately if the domain has an SRV record.
- **Dynamic server address** — changing the host in Settings now applies at connect time for all sessions. No need to edit each session individually.

### Chat & Players
- **Plugin message filtering** — messages from non-player senders (Lands, Skills, etc.) are now detected via the tab list and rendered as system messages instead of player chat
- **Duplicate join messages fixed** — removed generic "joined" messages from the playerJoined handler; only the server's formatted broadcast is shown
- **First-time join detection** — updated regex to handle `[+]` prefixed messages from servers
- **Player list refresh** — 30-second polling loop keeps the sidebar player list current; fixes stale counts that could persist 10+ minutes
- **Join/leave icons** — `[+]` messages render with green arrow, `[-]` with red arrow

### AI
- **Global AI toggle** — master switch in Settings > General to enable/disable all AI features. When off, hides AI mode selector in session details and AI Chat/Prompts tabs in Settings.
- **AI mode selector** — replaced single toggle with full radio selector (Off, AFK Responder, Support Bot, Player Disguise) in the session details panel
- **Assistant name** — only shown when Support Bot mode is selected
- **Default prompts seeded** — prompt textareas in Settings now pre-fill with the built-in defaults so they're easy to review and customize

### Settings
- **Full-page settings** — replaced modal with full-screen tabbed layout (General, AI Chat, Prompts, Bridge)
- **Server name** — new field to set a display name shown in the sidebar server card
- **Server favicon** — Minecraft server icon from the protocol ping is displayed in the sidebar

### CobbleBridge
- **Events route to all bots** — CobbleBridge plugin events now benefit all connected sessions, not just bridge-type bots. Mineflayer bots get reliable first-time join detection and player list refresh from bridge events.

### Other
- Edit Session button added to the details panel Manage section
- Sidebar panel toggle button uses a proper icon (table-columns)
- Removed hardcoded "Red"/"Zeph" references from AI mention handler

## v2.0.0

Major UI rewrite and feature expansion for public open-source release.

### UI Redesign
- Complete frontend rewrite: split single-file SPA into `index.html`, `app.css`, and `app.js`
- New three-panel layout: session sidebar, chat center, session details right panel
- Design system with Figtree + JetBrains Mono fonts, teal accent color
- Light/dark theme toggle with `localStorage` persistence and no flash of wrong theme
- Chat messages now render with avatars, day dividers, and message grouping
- System events (join/leave) display as compact single-line entries with icons
- AI assistant messages show a distinct teal avatar with sparkles icon
- Session details panel with Account, Connection, Behavior, and Danger Zone sections
- Empty state for new installations with onboarding CTA
- Command palette (Cmd/Ctrl+K) for quick actions: switch sessions, toggle theme, disconnect all
- Slash command popup when typing `/` in chat input
- Input hints below the chat field

### New Features
- **Active Session ("Speaking As")**: Explicit active session state — chat sends route through the selected session. Switch via sidebar click or Switch button dropdown.
- **Behavior Toggles**: Per-session Auto-reconnect, Anti-AFK, and AI Assistant toggles in the details panel. Changes persist immediately to `bots.json`.
- **Anti-AFK**: Connected bots with Anti-AFK enabled perform a small look movement every 45 seconds to prevent idle kicks.
- **Latency Tracking**: Server polls connected bots for ping every 5 seconds and broadcasts `session:metrics` events. Displayed in the details panel and server card.
- **Configurable AI Assistant Name**: Each session has an `assistantName` field (default "Assistant") displayed in chat and used in AI prompts.
- **Session Restart**: One-click restart (disconnect + reconnect) from the details panel.

### Backend Changes
- New Socket.io events: `active-session:set`, `active-session:changed`, `session:behavior:update`, `session:restart`, `session:remove`, `session:metrics`
- Active session auto-fallback: when the active bot disconnects, the next connected bot is selected
- Chat send now uses the active session ID by default
- Per-session fields added: `autoReconnect`, `antiAfk`, `aiAssistant`, `assistantName`
- Migration: existing `autoConnect` configs are mapped to `autoReconnect`
- AI system prompts now support `{assistantName}` placeholder

### Branding Cleanup
- Removed all personal references (specific server IPs, emails, usernames) from defaults and docs
- Discord webhook username changed from hardcoded name to "MC Presence"
- AI admin-afk handler no longer hardcodes specific player name mentions
- Generic placeholders in `.env.example` and session modal defaults
- README rewritten for public audience

## v1.5.0

- Greeting overhaul with staggered delays and organic "wb"/"ty" responses
- Strict @mention filter for support bot
- Frustration detection for proactive help offers
- Message deduplication and rate limiting (max 3 msgs / 30s per bot)
- Welcome-back watcher system for disguise bots
