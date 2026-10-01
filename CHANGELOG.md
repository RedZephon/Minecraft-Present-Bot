# Changelog

## v2.5.1

### Fixes
- **Virtual (CobbleBridge) support bots didn't hear chat on servers running CMI or similar chat plugins.**
  - A virtual bot has no game client; it heard chat only through CobbleBridge's chat events.
  - CobbleBridge skips cancelled chat events, and CMI cancels Paper's chat event to broadcast its own format. So no chat ever reached the bot, and @mentions went unanswered.
  - Chat seen by any connected real-account session is now handed to virtual AI bots too, and appears in their dashboard log.
  - Each line is handled exactly once, even when CobbleBridge also reports it, possibly under the real name while in-game shows a nickname.
- **Dashboard-typed messages on an account with "Support bot replies to this account" now reach virtual bots** even when no other session is online to see them.

### Diagnostics
- **Virtual sessions show "Plugin events: Xm ago / none yet" in Controls.** They also show a warning when CobbleBridge has never reached the app (check the plugin's `bot-app-url`), or when it's being refused for a wrong secret.
- **Rejected plugin events are logged** (at most once a minute) with the fix.

## v2.5.0

### Fixes
- **The support bot ignored the owner.**
  - Any player whose name matched a dashboard session counted as a bot, even when that session was offline. So the operator's own account was never answered, even while they played on it themselves.
  - Accounts now only count as bots while a session is actually playing on them.
- **Nicknamed players' chat showed as "Server" lines, and plugin private messages were lost.**
  - Mineflayer's chat and whisper events guess the speaker from the rendered text. CMI's `~Nick` came through as `Nick`, failed the lookup, and was shown as a server line with no AI handling.
  - Any chat or `/msg` format that didn't look vanilla was dropped entirely.
- **Typing on iPhone zoomed the page.** iOS zooms into any focused field with text under 16px, and every dashboard field was 12–14px. Touch devices now get 16px fields. Pinch-zoom still works, and double-tap zoom on buttons is off.

### Chat attribution (CMI and other chat plugins)
- **Signed player chat is read from the packet.** The sender's UUID gives the real account whatever nickname or prefix is shown, and the chat type says whether it's a whisper.
- **Plugin-formatted chat and `/msg` are parsed against the tab list,** by real name or display name. It handles:
  - rank prefixes like `[Member]`;
  - CMI's `~` nickname marker;
  - separators `»`, `:`, `>`, `▶`;
  - private-message formats `[Name -> me]`, `Name -> You:`, `From Name:` and `Name whispers to you:`.
- **Nicknames are learned from CobbleBridge.**
  - CobbleBridge reports the real sender of every chat message. When an in-game line from an unknown name matches one, the nickname is remembered in `data/aliases.json`.
  - From then on it resolves even when the tab list shows real names.
  - Without that evidence, `~Nick` lines and whispers are still treated as player chat.
- **Nothing is silently dropped.** Unrecognised server lines (plugin broadcasts, tips) now show as server messages.
- **The dashboard shows nicknames with the real username beside them,** and uses the real account's skin.
- **Whispers never group under public messages,** so the "whisper" label stays visible.

### Support bot
- **"Support bot replies to this account" (per session).**
  - Lets you test the support bot by chatting as one of the app's own accounts from the dashboard.
  - That session's automatic messages (greetings, AFK replies) are still ignored, so bots can't loop.
- **Virtual (CobbleBridge) bots show as `[Bot] Name`** in the Discord webhook and the dashboard. Mentions still use the plain name, and the webhook avatar uses the real name's skin.
  - In-game the name comes from CobbleBridge's own `virtual-player.chat-format`. Add `[Bot]` there, e.g. `"&7[Bot] &d{name} &8» &7{message}"`.

### Other
- `GET /api/sessions/:id/log` returns a session's chat log.
- `npm test` adds parser tests and a CobbleBridge + Discord suite. That suite runs against a fake plugin and a fake webhook, and checks that every bridge-bot message reaches Discord as `[Bot] Name`, with mentions disabled, and that a Discord outage doesn't break in-game chat.

## v2.4.0

### Support bot
- **Reads the room.**
  - It now sees the recent public chat (one shared, de-duplicated transcript), who's online, and why it's being asked, and decides whether to reply.
  - It replies when spoken to, when it's whispered, when someone follows up on something it said, or when an open question goes unanswered ("does anyone know how to…").
  - It stays out of conversations between players: a message that names another player, or follows straight on from another player's line, is left alone.
  - Ordinary banter never reaches the model, so it costs nothing.
  - Toggle: Settings → AI Chat → "Join in when it can help". With it off, the bot only answers @mentions and whispers.
- **Choosing silence is silent.**
  - The model answers `[silent]` when it shouldn't speak.
  - Anything that narrates staying quiet ("players are talking to each other, I'll stay out of it") or reads like a stage direction is also caught and never sent.
- **Learns from chat.**
  - Every few minutes, durable facts are pulled from chat into a notebook: announcements, upcoming updates, rule changes, where things are.
  - Staff statements are treated as reliable; player claims are attributed.
  - Jokes, personal info, base locations and anything telling the bot what to do are ignored.
  - The bot uses the notes like a staff member would ("RedZephon mentioned the other day it's coming soon").
  - Review, delete or add notes in Settings → AI Chat → Learned from chat.
- **Welcomes players to an empty server.**
  - When someone joins and nobody else is on, the bot explains why it's quiet (editable; defaults to "a small, self-hosted passion project") and says when people are usually on.
  - New players get a full welcome; returning players get a one-line heads-up at most every 12 hours.
  - Staff aren't welcomed to their own server, and with several support sessions only one greets.
- **Knows when players are usually on.**
  - Player sessions are tracked over time in `data/activity.json`, along with when a bot was actually watching, so the bot being offline never reads as the server being empty.
  - From the last four weeks it predicts the next likely time someone's on, leaving out the owner and staff.
  - See it in Settings → AI Chat → Player activity.
- **Better informed.**
  - Each reply includes the server info, the installed plugins (from CobbleBridge, refreshed hourly), the learned notes, the staff list, the online list and the current time in the server's timezone.
  - The default prompts are rewritten around all this. Saved prompts that were verbatim copies of the previous defaults are migrated, so they pick up the new behaviour.
- **The canned "need help? type @bot" offers are gone.** The bot just helps when it can.

### Modes
- **New "AFK" mode for any account.** It turns `/afk` on while connected, turns it off when you switch away, sends no replies, and pauses anti-AFK. It works with AI features switched off.
- **The AFK Responder is reserved for the owner's account.**
  - Other accounts can't select it.
  - A session already set to it on another account runs as plain AFK and says so.
  - Set your username in Settings → General.

### Settings
- **Owner & staff:** a new staff list alongside the owner.
- **One server timezone** for the maintenance window, activity predictions and times the AI quotes. It replaces the maintenance window's own timezone field.
- **AI Chat:** toggles for joining in and learning, the quiet-server message, the notes manager and the activity panel.

### Fixes
- **A welcomed player can ask a question straight away.** Greetings used to put them on the AI cooldown, so "type @Helper anytime" was followed by 15 seconds of silence.
- **`cooldownSeconds: 0` now means no cooldown** (it silently became 15).
- **Real answers are no longer dropped after a busy moment.** The send rate limit is now 5 per 30 seconds; at 3, a two-line welcome plus one greeting used it up.
- **The "wb → ty" watcher runs once per message** for bridge chat, not once per connected session.

### Development
- `npm test` now runs unit tests (activity prediction, reply gating, notes) and AI behaviour tests. The behaviour tests run against a fake Anthropic API and a scripted fake server, covering empty-server welcomes, banter, open questions, silence, learning, follow-ups and AFK modes.
- `ANTHROPIC_BASE_URL` lets the app talk to an API gateway, and the tests to their fake API.

## v2.3.0

Full code, security and UX audit, plus Minecraft 26.3.

### Compatibility
- **Minecraft 26.3 (protocol 777) via ViaBackwards.**
  - No PrismarineJS package supports 26.3 yet; only unmerged community forks do, and their packet data disagrees with the protocol spec in places.
  - Servers running ViaVersion + ViaBackwards 5.12+ accept the bot as a 26.2 client. Version detection already handles this, and now labels it correctly even when the server's version is newer than anything minecraft-data knows.
- **`tick_end` is sent at the end of every client tick.**
  - Vanilla clients have done this since 1.21.2, and 26.3 servers kick clients that don't (`invalid_player_movement`), including 26.2 clients passing through ViaBackwards.
  - Backported from mineflayer PR #4137 by the postinstall script.
- **The vendored 26.2 data was an outdated draft; it's replaced with the data PrismarineJS actually merged (`68ea7b5`).**
  - The old copy reused 26.1's block, item and entity registries. 26.2 added 28 blocks, so every block state from calcite upward (deepslate, tuff, copper…) decoded as the wrong block, and physics misread the ground.
  - Its `teams` packet layout was also wrong, so scoreboard, nametag and TAB-plugin team updates turned into protocol errors.
- **The postinstall patcher (`scripts/patch-dependencies.js`, formerly `patch-26.2-support.js`) is content-hashed.**
  - A corrected data set now replaces a stale one on the next install; previously the patcher stopped as soon as 26.2 resolved at all.
  - It works for any vendored version and was verified against a pristine `npm ci`.
- **Resource packs are accepted in play state too.** Before, only packs pushed during configuration were accepted, so servers that require a pack later kicked the bot.

### Security
- **Optional dashboard password (`DASHBOARD_PASSWORD`).**
  - Signed HttpOnly SameSite=Strict cookie.
  - Login attempts are rate-limited.
  - Required for the page, the REST API and the socket.io handshake.
- **Cross-site requests can no longer drive the bots.**
  - socket.io accepted WebSocket connections from any origin, so any website open in the operator's browser could chat and run commands as their accounts.
  - The handshake and every state-changing request are now origin-checked; `ALLOWED_ORIGINS` covers reverse proxies.
- **Secrets never leave the server.**
  - The Anthropic key, bridge secret and Discord webhook were sent to every browser that opened the dashboard, and returned by `/api/status`.
  - The UI now shows "saved (…abcd)" and treats secrets as write-only.
- **The support bot can't leak plugin secrets.**
  - Any player could ask it to read a plugin config containing a database password or a Discord bot token.
  - Tool results are now scrubbed of secret-shaped keys and values.
  - `config_path` is encoded per segment with `..` refused, so prompt injection can't walk out of the plugin's config endpoint.
- **`lookup_player` no longer returns other players' coordinates** or IP addresses.
- **CobbleBridge events require a real secret.**
  - The secret is compared in constant time.
  - An empty secret refuses events.
  - The default `changeme` triggers warnings in the log and in Settings, with a one-click generator.
- **Hardening:**
  - Strict Content-Security-Policy, which meant removing every inline event handler from the dashboard.
  - `X-Frame-Options`, `nosniff`, `no-referrer`.
  - JSON body and socket.io payload limits.
  - The server favicon is validated before it's rendered.
  - Session IDs are always generated server-side.
  - Every socket event's input is validated and clamped.
- **Dependency advisories fixed:** `ws`, `engine.io`, `socket.io-parser`, `body-parser` and `qs` (Express 4.22.3). `package-lock.json` is now committed so builds are reproducible.
- **Discord webhook posts can't ping `@everyone` or roles.**
- **`.env` is git-ignored**, and `.dockerignore` keeps `data/` and auth tokens out of the build context.

### Fixes
- **Disconnecting during the version check no longer leaves a stray bot logged in.** The connect continued after its awaits regardless; attempts are now cancellable. Removing a session mid-connect is covered too.
- **A stale connection's `end` event no longer nulls out the new connection** and wedges the session.
- **Scheduled sessions now connect when their window opens even if auto-reconnect is off.** Before, they never connected or disconnected at all. Auto-reconnect now only governs recovery from drops.
- **"Yield to my real client" works.** The scheduler cleared the yield within 30 seconds and the bot kicked you off. It now waits until another session sees you leave, or 15 minutes.
- **"Invalid session" (an expired Microsoft token) is no longer mistaken for a duplicate login**, which parked the session forever.
- **Disconnect actually holds Always-online sessions offline** until you click Connect. For scheduled sessions it holds until the window closes.
- **Running out of fast retries no longer strands always-on sessions.** They keep retrying every 10 minutes.
- **Bridge sessions:**
  - Scheduled and permanent bridge sessions no longer try to log in through mineflayer.
  - A bridge session now notices when the plugin goes away.
- **Connect watchdog.** Failures that emit nothing — a hung TCP connect, or an unsupported version thrown inside mineflayer — used to hang on "connecting…" forever. Microsoft device-code sign-in gets the code's full 15 minutes.
- **An unreachable server fails fast** and backs off, instead of handing mineflayer a connect that can't succeed.
- **Kick reasons are readable text** instead of raw JSON/NBT.
- **Protocol errors are no longer shown twice** in the log.
- **"New Session" twice now creates two sessions.** The second used to silently select the first.
- **Breaks:**
  - The forced-break timer measures time since this connection instead of since a break that could be days old.
  - A break now returns in manual mode too.
  - Break times in chat no longer show in the server's timezone.
- **The maintenance window has a timezone.** It was evaluated on the server clock, usually UTC in Docker.
- **Settings:**
  - Settings merge per section, so new defaults aren't lost.
  - `bots.json` and `settings.json` are written atomically; a crash mid-write used to wipe every session.
  - A corrupt file is backed up instead of overwritten.
- **Prompts:**
  - Prompts identical to the built-in defaults are migrated back to "use default". The old editor saved frozen copies of the defaults, so they never picked up improvements.
  - Unchanged prompts now save as default.
- **AI:**
  - Parallel tool calls are answered, instead of failing the request with a 400.
  - Tools stay declared on the final round, which the API requires.
  - Multi-block web-search answers are no longer truncated to the first citation.
  - A paused server-tool turn is resumed.
  - Requests time out after 30 s.
  - Each message is sent to the model once, not twice.
- **Greetings:** with several sessions, a first-time player got "welcome" from one bot and "wb" from the next.
- **Graceful shutdown on SIGTERM.** `docker stop` used to wait 10 s and then kill the process mid-session.
- **Anti-AFK nudges run on a randomised per-session cadence** instead of every bot on the same 45 s beat.

### UI
- **Microsoft sign-in code in Controls**, with a link and a Copy button. Before, it only appeared in the chat log.
- **Status banners** for held offline, yielded to your game client (with Resume now), on break, last kick reason, and a missing account.
- **Every state has a connection button:** Connect, Cancel while connecting or retrying, Disconnect. A stuck connect used to have no way out.
- **Session details work on tablets and small laptops.** Between 861 and 1200 px the panel was hidden and its button did nothing.
- **Setup changes:**
  - Sign-in is a Microsoft/Offline picker, and the username field adapts to it.
  - Version is a picker of supported versions.
  - The dead per-session Host/Port fields are gone; every session uses the server address in Settings.
- **Typed messages are no longer labelled "Assistant"** in AI-mode sessions; only automated messages are.
- **Settings:**
  - Password inputs for secrets, with show and remove buttons.
  - Reset to default for each prompt.
  - Model suggestions.
  - Warnings for no dashboard password and the default bridge secret.
  - "Settings saved" only appears in the tab that saved.
- **The selected session is per browser.** Clicking a session used to switch every other open dashboard too.
- **Uptime ticks smoothly**, measured from the server's connect time.
- **Accessibility:**
  - Keyboard-operable toggles (`role="switch"`) and session list.
  - Visible focus rings.
  - Labelled icon buttons.
  - Escape closes dialogs.
  - Reduced-motion support.
  - Tertiary text contrast raised to WCAG AA.
- **An offline banner appears** when the dashboard loses its connection to the server. An expired login redirects to sign-in.

### Development
- `npm test` runs 17 end-to-end checks against a real dashboard process and a fake local Minecraft server, with no accounts or network needed.
- `npm run dev` starts a UI sandbox with a fake server and throwaway data.

## v2.2.1

### Fixes
- **Sessions showed "connecting…" while actually connected and playing — mineflayer's plugins were never attached.** `prismarine-chunk` keys its chunk implementations off the major version and has no `26.2` entry (1.19 through 26.1 all point at the same `pc/1.18/chunk`), and `prismarine-physics` gates its feature table the same way, so its `Physics` constructor threw `No liquid gravity settings`. Both throw inside mineflayer's *plugin injection*, which runs on a deferred tick from an event handler — so the exception never touched the connection. The bot logged in, held its slot, and played, while roughly every plugin after `blocks` in the load order failed to inject: no `health` plugin meant `update_health` had no listener and `spawn` could never fire, and no `game` plugin meant `bot.emit('login')` never fired either. `scripts/patch-26.2-support.js` now adds the missing `26.2` entries to both packages alongside the existing minecraft-data work. Neither package has a 26.2 branch upstream, so there was nothing to pin to.
- **The spawn watchdog couldn't fire in exactly the case it was built for.** It armed on mineflayer's `login` event, which the `game` plugin re-emits — so when plugin injection died, the event never came and the watchdog never armed, leaving the session hanging silently forever. It now arms on the raw play-state `login` packet from minecraft-protocol, which is independent of mineflayer's plugin state. Its report also checks whether anything is actually listening on `update_health` and, when nothing is, names failed plugin injection and an unsupported `prismarine-*` version as the cause instead of blaming the packet stream.
- **The `update_time` fix from v2.2.0 was a no-op.** It ran synchronously after `createBot()` to swap out mineflayer's listener, but mineflayer defers plugin injection to a later tick, so there was no listener to replace yet — it found an empty list and returned. It now runs on `inject_allowed`, after the plugins are in place. Verified against mineflayer's real plugin: the 26.x `clockUpdates` packet parses, the legacy shape is untouched, and `update_health` reaches `spawn`.

### Notes
- `scripts/patch-mc-data-26.2.js` is renamed to `scripts/patch-26.2-support.js` now that it covers three packages. Each patch is independent and idempotent and reports "already" once its package ships real 26.2 support — when all three say that, `vendor/`, the script, and the postinstall hook can be deleted together.

## v2.2.0

### Compatibility
- **Minecraft 26.2 (protocol 776).** The server updated to Paper 26.2 and every session broke: 26.2 refuses handshakes claiming protocol 773–775 outright (verified with a raw status ping — 776 answers, 775/774/773 get the socket closed with no response), so the 26.1 client this app shipped in v2.1.0 could not get in at all. 26.2 isn't released in any PrismarineJS package yet — it exists only on three unmerged branches — so the stack is now pinned to them: `mineflayer` at `pc26_2` (PR #3926, commit `c77e6d5`), `minecraft-protocol` at `pc26_2` (PR #1496, commit `0dfb576`), and the 26.2 game data vendored from `minecraft-data`'s `pc_26_2` branch (PR #1219, commit `4dd8762`) under `vendor/minecraft-data-26.2/`. Note `mineflayer#pc26_2` trails master by six commits, but five are docs/CI and the sixth is the 26.1 data bump — nothing functional is lost.
- **26.2 data is injected on `postinstall`.** `minecraft-data` already registers 26.2's metadata but ships no protocol schema, so `minecraft-data('26.2')` returns null and `minecraft-protocol` refuses to build a client. Version resolution runs through a *generated* `data.js`, so dropping the JSON in isn't enough — the generator has to re-run. `scripts/patch-mc-data-26.2.js` copies the two vendored files in, merges the `dataPaths` entry, regenerates `data.js`, and verifies the result in a clean process. It is idempotent and no-ops the moment `minecraft-data` ships real 26.2 support, so `vendor/`, `scripts/`, and the postinstall hook can simply be deleted at that point.

### Fixes
- **`update_time` no longer throws on every tick.** 26.1 reshaped the packet from `{ age, time, tickDayTime? }` to `{ age, clockUpdates: [{ id, totalTicks, partialTick, rate }] }`. Mineflayer's time plugin still reads `packet.time` and indexes into it, so on a 26.x server every `update_time` raised `TypeError: Cannot read properties of undefined (reading '0')` out of the packet handler — and servers send that packet on a timer, so it fired continuously. Upstream PR #3958 fixes it but is unmerged and lives in a third-party fork, so the logic is ported into `applyModernTimePacketFix()` instead of taking a dependency on someone else's branch. It replaces mineflayer's listener at connect time and handles both packet shapes; the legacy branch reproduces mineflayer's arithmetic exactly, so pre-26 servers behave identically.
- **Docker build copies `vendor/` and `scripts/` before `npm install`.** The postinstall hook runs during install, so with the old copy order (source after dependencies) the build would have failed on a missing patch script.

## v2.1.0

### Compatibility
- **Native Minecraft 26.1 (protocol 775) — the ViaVersion fallback is gone.** PrismarineJS shipped real 26.1 support while this project was pinned to the last npm release: `minecraft-data` 3.113.2 carries the full `pc/26.1` data set, `minecraft-protocol` 1.67.0 lists `26.1` in `supportedVersions`, and mineflayer's master branch added `'26.1'` to `testedVersions` (upstream commit "🎈 26.1", 2026-08-17; release PR #3968 still open, which is why npm still serves 4.37.1). Dependencies now point at `minecraft-data ^3.113.2`, `minecraft-protocol ^1.67.0`, and mineflayer pinned to commit `aa8fdfa`. The `26.x -> 1.21.11` wire-version fallback and the `minecraft-data` alias shim at the top of `server.js` are both deleted — the bot speaks 775 directly and no longer needs ViaVersion on the server.

### Fixes
- **Sessions no longer hang on "connecting…" forever.** Mineflayer emits `spawn` only after an `update_health` packet with health > 0 (`lib/plugins/health.js`). Everything before that — handshake, login, the server broadcasting the join to other players — can succeed while that packet never arrives, so the bot was visibly in-game while the dashboard sat at "connecting" until minecraft-protocol's 60s read timeout dropped the socket. There was no timeout anywhere between `createBot()` and `spawn`. A spawn watchdog (`MC_SPAWN_TIMEOUT_MS`, default 45s) now arms on the `login` event — not on connect, so MSA device-code auth still gets unlimited time — and on expiry reports whether `update_health` ever arrived, dumps the play-state packet histogram to the console, and drops the connection so normal reconnect/backoff takes over.
- **Protocol errors are visible in the dashboard.** `bot._client.on("error")` only wrote to the server console, so packet-deserialization failures — the usual reason a session never finishes connecting — were invisible to anyone watching the UI. The first three per connection now push to the session chat log as `Protocol error: …`.
- **Version detection uses the ping's protocol number instead of regexing the version name.** The old code parsed `"Paper 26.1.2"` out of the free-text MOTD version string, which is just whatever the server owner typed. It now pings as the newest version mineflayer supports and reads the protocol number back: ViaVersion echoes the client's protocol when it can serve that version and returns the server's own when it can't, so one ping identifies both a native match and a translated one. Unknown/newer protocols probe up to four older versions before giving up. When nothing works the session fails immediately with the actual protocol number and what to do about it, instead of connecting anyway and stalling.
- **`player_loaded` is sent on spawn for 1.21.4+/26.x.** Vanilla defers block and item interactions until the client reports it finished loading; mineflayer doesn't send the packet yet (upstream PR #3960 is open), so anti-AFK arm swings and `/afk` interactions could be silently dropped. Gated on the `sendsPlayerLoadedPacket` feature flag, so it's a no-op on older servers.
- **A manual Connect during a break no longer wedges the session.** `startBreakCheck` runs on spawn and called `clearBreakTimers`, which killed the pending break-end timer while leaving `entry.onBreak` at `true`. Auto-reconnect and every future break roll both bail out on `onBreak`, so the session was stuck until a restart. `startBreakCheck` now clears only the roll interval, and an explicit connect cancels an in-progress break outright.
- **A silenced support bot can be un-silenced from chat again.** The `resume`/`unmute` handler sat behind an early `if (isBotSilenced(...)) return;`, so it was unreachable — once silenced, the only way back was a server restart. The owner's resume command is now checked before that return.
- **`send_chat` no longer throws on a torn-down session.** The mineflayer branch called `entry.bot.chat()` with no null guard; a socket that closed before the state flipped to `disconnected` produced an uncaught `TypeError`.
- **Docker image gained `git` and moved to Node 22.** The mineflayer dependency is a pinned git commit until 4.38.0 ships, and `node:20-alpine` has no git, so the build would have failed at `npm install`. Node 22 also matches what mineflayer master asks for.

## v2.0.9

### Fixes
- **Schedules without a `tz` field now auto-migrate to the browser's timezone** — v2.0.8 added the timezone-aware scheduler but the Setup tab was rendering the browser's tz as a *display fallback* when the saved `schedule.tz` was empty. That made the field look configured (e.g. "America/Edmonton") while the server was silently still evaluating the window against its own system clock (UTC in a typical Unraid container) — disconnecting bots hours before the user expected. Symptom: schedule "09:00–22:00 America/Edmonton" disconnecting at 5:05 PM local because 5:05 PM Edmonton = 11:05 PM UTC > 22:00. On socket init, any bot whose `schedule.tz` is empty now gets stamped with the browser-resolved tz and persisted. New sessions created via `createNewSession` also include the browser tz from the start. The Timezone input now shows the actual saved value (with a clear "Empty — schedule will use the server's system clock until set." note if it really is empty).

## v2.0.8

### Features
- **Timezone-aware scheduler** — per-session IANA timezone field under **Setup > Schedule**. The connect/disconnect window is now evaluated against the chosen timezone instead of the server's local clock, so a bot running in a UTC container can still hold to a `09:00–17:00 America/Vancouver` schedule. Field is a searchable input backed by the full `Intl.supportedValuesOf('timeZone')` list (~430 zones), defaulting to the browser's detected timezone. Existing schedules without a `tz` field continue to use the server's system TZ.

### UI
- **Fixed misleading "24-hour time" note** — the `<input type="time">` renders in 12-hour with AM/PM on locales like en-US, so the helper text was contradicting itself. Note now reads "Times in your local 12-hour format. Schedule wraps midnight." The underlying value is still `HH:MM` (per the HTML spec) — no migration needed.

## v2.0.7

### Features
- **Breaks system** — per-session random "step away from the keyboard" simulation. Configure a check interval, hit chance, and min/max duration. While connected, the bot rolls the chance every N minutes; on a hit it disconnects for a random duration in `[min, max]` and reconnects automatically when the break ends. Auto-reconnect is suppressed during breaks (so the schedule/auto-reconnect loops don't fight the break timer). In scheduled mode, a break that ends outside the active window stays disconnected; the schedule ticker reconnects when the window reopens. A pill in **Controls > Connection** shows "On break — returning around HH:MM" while active. Config lives under **Setup > Breaks**.
- **Min-required break floor** — extra fields under **Setup > Breaks**: "Force After (hr)" and "Forced Length (min)". If no break has happened within the floor window, the next check forces a fixed-duration break regardless of the random roll. Defaults: 3h floor / 10min forced. Set "Force After" to 0 to disable. Baseline for "no break yet" is the bot's `connectedAt` on first connection (so a freshly-connected bot isn't immediately overdue). `lastBreakAt` persists across server restarts.
- **Last Break readout** — a "Last Break" row in **Controls > Connection** shows when the bot last took a break (e.g., "47m ago", "2h 15m ago", "Never"). Visible whenever breaks are enabled or a break has ever happened.

### Fixes
- **CMI-nicknamed players' chat now classifies as real chat** — the chat handler resolved senders by direct lookup in `bot.players`, which is keyed by real MC username. CMI (and Essentials, and any plugin that rewrites chat formats to show a nickname) sends the chat event with the visible nickname as the sender, so the lookup missed and the message fell through to the "Server" / plugin-broadcast branch — appearing in the UI as a non-chat system message and never reaching the AI handler. Added `resolveChatSender()` which falls back to matching against each player's `displayName` (with §-color codes stripped) when the direct lookup fails. UI now shows the nickname as the sender (matching what the player sees in-game) while AI/cooldowns/bot-account checks use the resolved real MC username. Whisper handler updated to the same resolver for consistency.
- **Asset cache-busting** — `index.html` is now rendered at request time with the running `APP_VERSION` substituted into the asset URLs (`/app.js?v=2.0.7`, `/app.css?v=2.0.7`). Previously browsers could keep serving cached `app.js` after a container update, so users would see the new server version badge while still running the old UI (e.g., the v2.0.6 sidebar refactor not appearing until a manual hard-refresh). Bumping the version automatically invalidates the cached URLs on every release.
- **26.1.x connect failure handled gracefully** — the v2.0.6 dependency bump registered the protocol metadata for 26.1.2 but PrismarineJS hasn't shipped the per-version game-data directory yet, so `minecraft-data('26.1.2')` returned null and minecraft-protocol threw before login. A first attempt to override the wire protocol so the handshake would still claim 26.1.2 succeeded at login but immediately crashed post-login because too many packets changed shape between 1.21.11 and 26.1.2 — the bot would briefly appear in-game and then vanish (`PartialReadError` / `Cannot read properties of undefined` in `inventory.js`). Now: when a 26.X.Y server is detected via ping, the bot auto-falls-back to negotiating as 1.21.11. Connects cleanly if the server has ViaVersion (or another protocol-translation plugin) installed; if not, the server rejects with a clear "outdated client" message instead of crashing mid-stream. Manual override via the Version field in Setup still works. The fallback becomes a no-op automatically once PrismarineJS ships proper 26.x data.

## v2.0.6

### Fixes
- **No more double Discord posts for real-account bots** — `sendBotMessage` used to push to the Discord webhook for every send, including from authenticated mineflayer sessions. Those sessions already produce real in-game chat that the server-side Discord<->MC bridge mirrors, so every message landed in Discord twice. The webhook call is now bridge-only (CobbleBot AI and other virtual bots whose chat doesn't reliably round-trip through the MC bridge).

### UI
- **Right sidebar tabs** — split into **Controls** (frequent: status, toggles, AI mode, restart/remove) and **Setup** (one-time: identity, server creds, schedule, breaks). Reduces visual noise on the things you touch daily.
- **Stray mobile CSS leaking onto desktop** — a missing `@media` wrapper around the settings-page mobile rules was forcing `.field-row` into a single column at every viewport width. Wrapped them correctly so two-column form rows in the sidebar actually render as two columns.
- **Session settings folded into the right sidebar** — the Add/Edit Session modal is gone. Every per-session field (label, bot type, email, host/port, auth, version, mode, schedule, AI mode, assistant name, toggles) now lives in the details panel and auto-saves on change. New sessions are created with sensible defaults via "+" and customized inline. Connection fields disable while connected/connecting (server already enforced this; the UI now reflects it). Removes the duplicate AI-mode picker (modal + sidebar) that could overwrite each other when both were active.
- **Focus-preserving re-render** — typing into a sidebar input no longer gets wiped if a server-side `botUpdated`/`botState` event arrives mid-edit. Focus, cursor position, selection, and any unsaved value are restored on re-render.

### Compatibility
- **Minecraft Java Edition 26.1.2 (protocol 775) supported** — bumped `mineflayer` to `^4.37.1` (was `^4.35.0`). Pulls in the matching `minecraft-data` / `minecraft-protocol` updates that recognize the new Mojang versioning scheme. The auto-detect regex in `connectMineflayer` already extracts `26.1.2`-style names from server pings.

## v2.0.5

### Fixes
- **Self-greeting bug** — the self-check in the AI greeting path used strict `===` comparison which is case-sensitive. Minecraft usernames can arrive with different casing depending on the event source (tab list vs server broadcast), so a bot could end up saying "wb" to itself on join. Added `isThisBot(entry, name)` helper with case-insensitive comparison across MC username, label, and connectedUsername. Used in `handlePlayerJoinAI`, `handleBridgePlayerJoin`, and the mineflayer `playerJoined` handler. Self-skip is now logged so it's easy to verify.

## v2.0.4

### Fixes
- **Avatars now use the correct MC username** — `connectedUsername` was set server-side but never included in `serializeBot`, so the frontend always fell back to `bot.label` when rendering avatars via mc-heads.net. If a bot's label differed from its MC username, the default Steve skin was shown. The field is now exported.
- **Bridge-bot chat mirrors to all session logs** — CobbleBot and other CobbleBridge-type bots broadcast via the plugin, but mineflayer sessions either don't receive those events or filter them as system messages (since the virtual player isn't in the tab list). Bridge-bot public messages are now mirrored directly into every other connected session's chat log as regular chat lines. Includes manual sends via the Chat input and AI-generated responses. Whispers are not mirrored. A de-dup guard in mineflayer's `bot.on("chat")` skips any line whose sender matches a known bridge-bot label.

## v2.0.3

### Fixes
- **Missing sign-in messages** — the v2.0.2 CobbleBridge suppression was global (any bridge event muted mineflayer's join/leave broadcast parse). If the plugin emitted quits but not joins, join messages vanished entirely. Suppression is now tracked per event type: joins are only suppressed while the bridge is actively emitting joins, quits only while it's actively emitting quits. If the plugin only emits one type, the other still flows through mineflayer's server broadcast.

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
