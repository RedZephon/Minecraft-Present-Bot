"use strict";

// Working out who said what from server chat.
//
// Mineflayer's own `chat`/`whisper` events (1.19+) only fire when the
// *rendered* line matches vanilla-shaped regexes, and they report whatever
// word sat before the separator. With CMI/Essentials nicknames, rank prefixes
// or custom formats that's the nickname — or nothing at all — so nicknamed
// players' chat showed up as "Server" lines and plugin /msg formats were lost.
//
// Signed player chat is handled from the packet (sender UUID, chat type).
// System-message chat (plugins that reformat chat, plugin /msg) is matched
// here against the tab list, by real name or display name.

// Strip § formatting codes and surrounding decoration from a name-ish token.
function cleanName(s) {
  return String(s || "")
    .replace(/§[0-9a-fk-orx]/gi, "")
    .replace(/^[\s[\](){}<>~*+!@#.:|-]+|[\s[\](){}<>~*+!@#.:|-]+$/g, "")
    .trim();
}

// The name players actually see: the display name without rank brackets
// ("[Mod] Jebby" → "Jebby", "~Nicky" → "Nicky"), else the username.
function shownName(player) {
  const core = cleanName(String(player.display || "").replace(/§[0-9a-fk-orx]/gi, "").replace(/^(\s*[[(][^\])]*[\])]\s*)+/, ""));
  return core || player.username;
}

// players: [{ username, display }] — display is the tab-list display name
// (nickname, possibly with a rank prefix), plain text.
// Returns the matching player for a chunk of text that should end with a
// name, e.g. "[Member] ~Nicky" or "<Steve" or "Steve".
function matchPlayer(head, players) {
  const raw = String(head || "").replace(/§[0-9a-fk-orx]/gi, "").trim();
  if (!raw) return null;
  const lowerRaw = raw.toLowerCase();
  const last = cleanName(raw.split(/\s+/).pop()).toLowerCase();
  let best = null;
  for (const p of players) {
    if (!p || !p.username) continue;
    const user = p.username.toLowerCase();
    const display = cleanName(p.display).toLowerCase();
    const displayLast = cleanName(String(p.display || "").split(/\s+/).pop()).toLowerCase();
    let score = 0;
    if (last && last === user) score = 3;
    else if (display && (cleanName(raw).toLowerCase() === display || lowerRaw.endsWith(display))) score = 2 + display.length / 100;
    else if (last && displayLast && last === displayLast) score = 2;
    if (score && (!best || score > best.score)) best = { player: p, score };
  }
  return best ? best.player : null;
}

const INCOMING_WHISPER = [
  /^(.{1,48}?) whispers(?: to you)?:? (.+)$/i,                                   // vanilla
  /^\[(.{1,48}?)\s*(?:->|→|➜|➡|»|>)\s*(?:me|you)\]\s*:?\s*(.+)$/i,             // Essentials, CMI, CobbleBridge
  /^(.{1,48}?)\s*(?:->|→|➜|➡)\s*(?:me|you)\s*[:»>|]?\s+(.+)$/i,
  /^\[?(?:from|msg from|pm from|message from|whisper from)\]?\s*(.{1,48}?)\]?\s*[:»>]\s+(.+)$/i,
];
const OUTGOING_WHISPER = [
  /^you whisper to /i,
  /^\[(?:me|you)\s*(?:->|→|➜|➡)/i,
  /^(?:me|you)\s*(?:->|→|➜|➡)/i,
  /^\[?(?:to|msg to|pm to)\]?\s/i,
];
// "<Name> text", then "<head><separator> text" with common separators.
const ANGLE_CHAT = /^<(.{1,48}?)>\s(.+)$/;
const SEPARATED_CHAT = /^(.{1,64}?)\s*(?::|»|›|>|➤|▶|➜|\|)\s+(.+)$/;

// Classify one rendered system-chat line.
// Returns null, or one of:
//   { kind: "outgoing" }                                  our own /msg echoed
//   { kind: "chat" | "whisper", player, shown, message }  speaker identified
//   { kind: "chat" | "whisper", unresolved: true, name, nickMarked, message }
//      shaped like chat, but the speaker isn't in the tab list under that
//      name (e.g. a CMI nickname the tab list doesn't show). The caller can
//      try other evidence before deciding it's a plugin broadcast.
function parseChatLine(text, players) {
  const line = String(text || "").replace(/§[0-9a-fk-orx]/gi, "").trim();
  if (!line) return null;

  for (const re of OUTGOING_WHISPER) if (re.test(line)) return { kind: "outgoing" };

  let unresolved = null;
  const consider = (kind, head, message) => {
    const player = matchPlayer(head, players);
    if (player) return { kind, player, shown: shownName(player), message: message.trim() };
    if (!unresolved) {
      const lastToken = String(head).trim().split(/\s+/).pop() || "";
      const name = cleanName(lastToken);
      // Plausible player name: 3–16 word characters once decoration is gone.
      if (/^\w{3,16}$/.test(name)) {
        // CMI/Essentials mark nicknames with a leading "~" (or "*").
        unresolved = { kind, unresolved: true, name, nickMarked: /^[[(<]*[~*]/.test(lastToken), message: message.trim() };
      }
    }
    return null;
  };

  for (const re of INCOMING_WHISPER) {
    const m = line.match(re);
    const r = m && consider("whisper", m[1], m[2]);
    if (r) return r;
  }
  for (const re of [ANGLE_CHAT, SEPARATED_CHAT]) {
    const m = line.match(re);
    const r = m && consider("chat", m[1], m[2]);
    if (r) return r;
  }
  return unresolved;
}

// Nickname → real name, learned from evidence (CobbleBridge reports the real
// name with every chat message) and persisted, so CMI-style nicknames
// resolve even when the tab list shows real names.
class AliasBook {
  constructor({ load, save } = {}) {
    this.saveFn = save || null;
    const data = load ? load() : null;
    this.map = new Map(); // lowercase alias -> { alias, real }
    const stored = data && typeof data.aliases === "object" ? data.aliases : {};
    for (const [key, v] of Object.entries(stored)) {
      if (v && typeof v === "object" && v.real) this.map.set(key, { alias: v.alias || key, real: v.real });
      else if (typeof v === "string") this.map.set(key, { alias: key, real: v });
    }
  }
  learn(alias, realName) {
    const clean = cleanName(alias);
    const key = clean.toLowerCase();
    if (!key || !realName || key === realName.toLowerCase()) return false;
    const prev = this.map.get(key);
    if (prev && prev.real === realName && prev.alias === clean) return false;
    this.map.set(key, { alias: clean, real: realName });
    if (this.saveFn) this.saveFn({ aliases: Object.fromEntries(this.map) });
    return true;
  }
  // Extra { username, display } entries for players currently online.
  entriesFor(onlineNames) {
    const online = new Map(onlineNames.map(n => [n.toLowerCase(), n]));
    const out = [];
    for (const { alias, real } of this.map.values()) {
      const name = online.get(real.toLowerCase());
      if (name) out.push({ username: name, display: alias });
    }
    return out;
  }
}

// Same message from the same moment? Used to pair an in-game line with the
// CobbleBridge event for it.
function sameMessage(a, b) {
  const norm = (s) => String(s || "").replace(/§[0-9a-fk-orx]/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
  return norm(a) === norm(b);
}

// The name at the front of a line, before a chat separator — used to spot
// our own bridge bot's broadcasts ("CobbleBot » hi").
function leadingSpeaker(text) {
  const line = String(text || "").replace(/§[0-9a-fk-orx]/gi, "").trim();
  const m = line.match(ANGLE_CHAT) || line.match(SEPARATED_CHAT);
  return m ? cleanName(m[1].split(/\s+/).pop()) : null;
}

module.exports = { parseChatLine, matchPlayer, cleanName, shownName, leadingSpeaker, AliasBook, sameMessage };
