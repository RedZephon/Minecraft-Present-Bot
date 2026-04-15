# Changelog

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
