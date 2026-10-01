"use strict";

// Conversation awareness for the AI sessions:
//   - Transcript: one shared, de-duplicated log of public chat. Every
//     connected session sees the same chat line, so without de-duplication
//     the model would read each message several times.
//   - NotesStore: durable facts the bot has picked up from chat ("RedZephon
//     said the 1.5 update is coming soon"), persisted and editable.
//   - replyCandidate(): the cheap gate deciding whether a message is worth
//     asking the model about at all. The model makes the final call.

const crypto = require("crypto");

const TRANSCRIPT_MAX_LINES = 80;
const TRANSCRIPT_MAX_AGE_MS = 60 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 4000;

class Transcript {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.lines = []; // { seq, ts, sender, text, bot }
    this.seq = 0;
  }

  // Returns the stored line, or null when it's a duplicate of one just seen
  // (the same chat observed by another session).
  add(sender, text, { bot = false } = {}) {
    const ts = this.now();
    const body = String(text || "").trim();
    if (!sender || !body) return null;
    for (let i = this.lines.length - 1; i >= 0 && ts - this.lines[i].ts <= DUPLICATE_WINDOW_MS; i--) {
      const l = this.lines[i];
      if (l.sender.toLowerCase() === sender.toLowerCase() && l.text === body) return null;
    }
    const line = { seq: ++this.seq, ts, sender, text: body.slice(0, 300), bot };
    this.lines.push(line);
    while (this.lines.length > TRANSCRIPT_MAX_LINES) this.lines.shift();
    while (this.lines.length && ts - this.lines[0].ts > TRANSCRIPT_MAX_AGE_MS) this.lines.shift();
    return line;
  }

  recent(maxAgeMs = 15 * 60 * 1000, maxLines = 40) {
    const cutoff = this.now() - maxAgeMs;
    return this.lines.filter(l => l.ts >= cutoff).slice(-maxLines);
  }

  since(seq) {
    return this.lines.filter(l => l.seq > seq);
  }

  // "[7:42 PM] Name: text" lines, with the bot's own lines marked.
  format(lines, { tz, selfName } = {}) {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, hour: "numeric", minute: "2-digit" });
    return lines.map(l => {
      const who = selfName && l.sender.toLowerCase() === selfName.toLowerCase() ? `${l.sender} (you)` : l.sender;
      return `[${fmt.format(new Date(l.ts))}] ${who}: ${l.text}`;
    }).join("\n");
  }
}

// ---------------------------------------------------------------------------
// Learned notes
// ---------------------------------------------------------------------------
const MAX_NOTES = 40;

class NotesStore {
  constructor({ load, save, now = () => Date.now() } = {}) {
    this.now = now;
    this.saveFn = save || null;
    const data = load ? load() : null;
    this.notes = Array.isArray(data?.notes)
      ? data.notes.filter(n => n && typeof n.text === "string" && n.id).slice(-MAX_NOTES)
      : [];
    this.lastSeq = 0; // transcript position already processed (in-memory only)
  }

  list() { return this.notes.slice(); }

  save() { if (this.saveFn) this.saveFn({ notes: this.notes }); }

  add(text, source = "dashboard") {
    const clean = String(text || "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!clean) return null;
    const note = { id: crypto.randomBytes(4).toString("hex"), text: clean, source: String(source).slice(0, 40), at: this.now() };
    this.notes.push(note);
    while (this.notes.length > MAX_NOTES) this.notes.shift();
    this.save();
    return note;
  }

  remove(id) {
    const before = this.notes.length;
    this.notes = this.notes.filter(n => n.id !== id);
    if (this.notes.length !== before) { this.save(); return true; }
    return false;
  }

  // Apply the model's { add: [...], remove: [...] } edit. Unknown ids are
  // ignored, so a confused model can't do worse than a no-op.
  applyEdit(edit) {
    if (!edit || typeof edit !== "object") return { added: 0, removed: 0 };
    let removed = 0;
    if (Array.isArray(edit.remove)) {
      const ids = new Set(edit.remove.map(String));
      const before = this.notes.length;
      this.notes = this.notes.filter(n => !ids.has(n.id));
      removed = before - this.notes.length;
    }
    let added = 0;
    if (Array.isArray(edit.add)) {
      for (const item of edit.add.slice(0, 8)) {
        const text = typeof item === "string" ? item : item && item.text;
        const source = (item && item.source) || "chat";
        const clean = String(text || "").replace(/\s+/g, " ").trim().slice(0, 300);
        if (!clean || this.notes.some(n => n.text.toLowerCase() === clean.toLowerCase())) continue;
        this.notes.push({ id: crypto.randomBytes(4).toString("hex"), text: clean, source: String(source).slice(0, 40), at: this.now() });
        added++;
      }
    }
    while (this.notes.length > MAX_NOTES) this.notes.shift();
    if (added || removed) this.save();
    return { added, removed };
  }

  format({ tz } = {}) {
    if (!this.notes.length) return "";
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, month: "short", day: "numeric" });
    return this.notes.map(n => `- (${fmt.format(new Date(n.at))}, from ${n.source}) ${n.text}`).join("\n");
  }
}

// Pull the first JSON object out of a model reply (tolerates code fences or
// a stray sentence around it).
function parseJsonObject(text) {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch (_) { return null; }
}

// ---------------------------------------------------------------------------
// Reply gating
// ---------------------------------------------------------------------------
const QUESTION_RE = /\?\s*$|^(how|what|where|when|why|who|which|is|are|does|do|did|can|could|should|will|would|anyone|any1|anybody|someone|somebody)\b/i;
const HELP_RE = /\b(help|stuck|confused|lost|broken|bugged|doesn'?t work|not working|won'?t work|how do i|how do you|how to|where (do|can|is)|can'?t (figure|find|get|make))\b/i;
const OPEN_CALL_RE = /\b(any ?one|any1|any ?body|some ?one|some ?body|anybody|does anyone|can someone|help)\b/i;
const FOLLOW_UP_WINDOW_MS = 2 * 60 * 1000;

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function mentions(text, name) {
  if (!name) return false;
  return new RegExp(`(^|[^A-Za-z0-9_])@?${escapeRe(name)}([^A-Za-z0-9_]|$)`, "i").test(text);
}

// Decide whether a chat message should go to the model, and why.
// Returns null (ignore) or { reason, direct } where reason is one of:
//   "whisper" | "mention" | "follow-up" | "open-question"
//
// The model still gets the final say (it can answer "[silent]"); this gate
// exists so ordinary banter between players never costs an API call.
function replyCandidate({ sender, text, isWhisper, botName, otherNames = [], lines = [], allowAmbient = true, now = Date.now() }) {
  if (isWhisper) return { reason: "whisper", direct: true };
  if (mentions(text, botName)) return { reason: "mention", direct: true };

  // Talking to someone else by name: leave it alone.
  if (otherNames.some(n => n && n.toLowerCase() !== sender.toLowerCase() && mentions(text, n))) return null;

  const recent = lines.filter(l => now - l.ts <= FOLLOW_UP_WINDOW_MS);
  const lastBotLine = [...recent].reverse().find(l => l.sender.toLowerCase() === botName.toLowerCase());

  // Continuing a conversation with us: we answered this player recently and
  // nobody else has spoken to them since.
  if (lastBotLine) {
    const afterBot = recent.filter(l => l.seq > lastBotLine.seq && l.sender.toLowerCase() !== sender.toLowerCase());
    const botSpokeToThem = recent.some(l => l.seq < lastBotLine.seq && l.sender.toLowerCase() === sender.toLowerCase()) ||
      mentions(lastBotLine.text, sender);
    if (botSpokeToThem && afterBot.length === 0) return { reason: "follow-up", direct: false };
  }

  if (!allowAmbient) return null;

  // An open question or call for help. If it comes straight after another
  // player's line, it's most likely a reply to them — unless it's explicitly
  // thrown open ("does anyone know…").
  if (!(QUESTION_RE.test(text.trim()) || HELP_RE.test(text))) return null;
  const before = precedingLine(lines, sender, text);
  const replyingToSomeone = before && !before.bot &&
    before.sender.toLowerCase() !== sender.toLowerCase() && now - before.ts <= 45_000;
  if (replyingToSomeone && !OPEN_CALL_RE.test(text)) return null;
  return { reason: "open-question", direct: false };
}

// The line just before this message (the transcript usually already
// contains the message itself as its last line).
function precedingLine(lines, sender, text) {
  let i = lines.length - 1;
  if (i >= 0 && lines[i].sender.toLowerCase() === sender.toLowerCase() && lines[i].text === text.trim()) i--;
  return i >= 0 ? lines[i] : null;
}

// The model's way of choosing silence. Anything that *talks about* staying
// quiet is treated the same — it must never reach chat.
const SILENT_TOKEN = "[silent]";
const NARRATION_RE = /stays? quiet|staying quiet|stay (out of|silent)|not my (problem|conversation|place|business|call)|i('ll| will) (stay|be|keep) (quiet|silent|out)|not directed at me|not (talking|speaking) to me|not for me|this isn'?t for me|i('ll| will) let (them|you)|not involved|don'?t mind me|(players?|they)('re| are) (just )?(talking|chatting) (to|with) (each other|one another)|keeping it chill|i should (not |n'?t )?(jump in|respond|reply)|no (action|response|reply) needed|nothing to add|i('ll| will) (pass|skip|ignore)|doesn'?t (need|require) (a |my )?(response|reply)|that'?s between them/i;

function isSilentReply(text) {
  if (!text) return true;
  const t = text.trim();
  if (!t) return true;
  if (t.toLowerCase().includes(SILENT_TOKEN)) return true;
  if (/^\(.*\)$/s.test(t) || /^\*.*\*$/s.test(t)) return true; // stage directions
  return NARRATION_RE.test(t);
}

module.exports = {
  Transcript,
  NotesStore,
  parseJsonObject,
  replyCandidate,
  mentions,
  isSilentReply,
  SILENT_TOKEN,
};
