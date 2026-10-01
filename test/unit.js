#!/usr/bin/env node
"use strict";

// Fast, dependency-free checks for the pure logic behind the AI features.

const assert = require("assert");
const { ActivityTracker, describePrediction, HOUR, DAY } = require("../lib/activity");
const { Transcript, NotesStore, replyCandidate, isSilentReply, parseJsonObject } = require("../lib/chat-context");

const results = [];
function test(name, fn) {
  try { fn(); results.push(true); console.log(`  ok   ${name}`); }
  catch (err) { results.push(false); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const TZ = "America/Edmonton";

// Simulate `days` of observation where `player` is online every evening
// 19:00–22:00 local time and a staff member is online every morning.
function simulateHistory({ days, players = { Steve: [19, 22] }, start }) {
  let clock = start;
  const tracker = new ActivityTracker({ now: () => clock });
  for (let t = start; t < start + days * DAY; t += 15 * 60 * 1000) {
    clock = t;
    const hour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date(t)), 10) % 24;
    const online = Object.entries(players).filter(([, [a, b]]) => hour >= a && hour < b).map(([p]) => p);
    tracker.observe(online);
  }
  return { tracker, setNow: (t) => { clock = t; } };
}

console.log("Unit tests");

// 2026-09-01 06:00 UTC = 00:00 Edmonton (MDT, UTC-6)
const START = Date.UTC(2026, 8, 1, 6, 0, 0);

test("predicts the usual evening session", () => {
  const { tracker, setNow } = simulateHistory({ days: 14, start: START });
  const noon = START + 14 * DAY + 12 * HOUR; // 12:00 local on day 15
  setNow(noon);
  const p = tracker.predict({ tz: TZ });
  assert.ok(p && p.next, "expected a prediction");
  assert.strictEqual(p.confident, true);
  const localHour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date(p.next.at)), 10);
  assert.strictEqual(localHour, 19);
  const d = describePrediction(p, { tz: TZ, now: noon });
  assert.match(d.when, /today around 7 PM/);
  assert.match(d.relative, /about 7 hours/);
});

test("staff are excluded from the prediction", () => {
  const { tracker, setNow } = simulateHistory({ days: 14, start: START, players: { RedZephon: [8, 12], Steve: [19, 22] } });
  setNow(START + 14 * DAY + 6 * HOUR); // 06:00 local
  const withStaff = tracker.predict({ tz: TZ });
  const withoutStaff = tracker.predict({ tz: TZ, exclude: ["redzephon"] });
  const hourOf = (p) => parseInt(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date(p.next.at)), 10);
  assert.strictEqual(hourOf(withStaff), 8);
  assert.strictEqual(hourOf(withoutStaff), 19);
});

test("no prediction without enough observed history", () => {
  const { tracker } = simulateHistory({ days: 2, start: START });
  assert.strictEqual(tracker.predict({ tz: TZ }), null);
});

test("hours the bot wasn't watching don't count as empty", () => {
  // Observed only 19:00–22:00 each day, and someone was always on then.
  let clock = START;
  const tracker = new ActivityTracker({ now: () => clock });
  for (let d = 0; d < 27; d++) { // 27 × 3 h ≥ the 72 observed hours required
    for (let m = 0; m < 180; m += 15) {
      clock = START + d * DAY + 19 * HOUR + m * 60_000;
      tracker.observe(["Steve"]);
    }
    tracker.unobserved();
  }
  clock = START + 27 * DAY + 12 * HOUR;
  const p = tracker.predict({ tz: TZ });
  assert.ok(p && p.confident, "evening should be 100% from observed samples");
});

test("activity survives a save/load round trip", () => {
  const { tracker } = simulateHistory({ days: 5, start: START });
  let saved;
  tracker.saveFn = (d) => { saved = JSON.parse(JSON.stringify(d)); };
  tracker.flush(true);
  const copy = new ActivityTracker({ load: () => saved, now: () => START + 5 * DAY });
  assert.ok(copy.sessions.length >= 4);
  assert.ok(copy.coverage.size >= 100);
});

test("transcript drops the same line seen by several sessions", () => {
  let t = 1000;
  const tr = new Transcript({ now: () => t });
  assert.ok(tr.add("Steve", "hello"));
  t += 500;
  assert.strictEqual(tr.add("steve", "hello"), null);
  t += 10_000;
  assert.ok(tr.add("Steve", "hello"), "a genuine repeat later is kept");
});

const lines = (arr, base = 100_000) => arr.map(([sender, text, dt, bot], i) => ({ seq: i + 1, ts: base + dt, sender, text, bot: !!bot }));

test("mention and whisper are direct", () => {
  assert.strictEqual(replyCandidate({ sender: "Steve", text: "@Helper how do I claim land", botName: "Helper" }).reason, "mention");
  assert.strictEqual(replyCandidate({ sender: "Steve", text: "hey helper", botName: "Helper" }).reason, "mention");
  assert.strictEqual(replyCandidate({ sender: "Steve", text: "hi", isWhisper: true, botName: "Helper" }).reason, "whisper");
  assert.strictEqual(replyCandidate({ sender: "Steve", text: "helperbot is cool", botName: "Helper" }), null);
});

test("players talking to each other are left alone", () => {
  const l = lines([["Alex", "wanna go mining?", 0], ["Steve", "sure where?", 5000]]);
  assert.strictEqual(replyCandidate({ sender: "Alex", text: "where do you want to go?", botName: "Helper", otherNames: ["Steve"], lines: l, now: 100_000 + 8000 }), null);
  assert.strictEqual(replyCandidate({ sender: "Alex", text: "Steve how do I get there?", botName: "Helper", otherNames: ["Steve"], lines: [], now: 0 }), null);
});

test("a question right after another player's line is a reply to them — unless thrown open", () => {
  const l = lines([["Alex", "i just found a village", 0], ["Steve", "how far is it?", 4000]]);
  assert.strictEqual(replyCandidate({ sender: "Steve", text: "how far is it?", botName: "Helper", lines: l, now: 100_000 + 5000 }), null);
  const l2 = lines([["Alex", "i just found a village", 0], ["Steve", "does anyone know how to claim land?", 4000]]);
  assert.strictEqual(replyCandidate({ sender: "Steve", text: "does anyone know how to claim land?", botName: "Helper", lines: l2, now: 100_000 + 5000 }).reason, "open-question");
});

test("an unanswered open question is a candidate", () => {
  const c = replyCandidate({ sender: "Alex", text: "how do I claim land?", botName: "Helper", otherNames: ["Steve"], lines: [], now: 0 });
  assert.strictEqual(c.reason, "open-question");
  assert.strictEqual(replyCandidate({ sender: "Alex", text: "lol nice", botName: "Helper", lines: [], now: 0 }), null);
  assert.strictEqual(replyCandidate({ sender: "Alex", text: "how do I claim land?", botName: "Helper", lines: [], now: 0, allowAmbient: false }), null);
});

test("follow-ups to the bot are candidates; someone else stepping in ends it", () => {
  const l = lines([["Alex", "@Helper how do I claim land?", 0], ["Helper", "Use /lands create, Alex", 3000, true]]);
  assert.strictEqual(replyCandidate({ sender: "Alex", text: "ok and then?", botName: "Helper", lines: l, now: 100_000 + 10_000 }).reason, "follow-up");
  const l2 = lines([["Alex", "@Helper how do I claim land?", 0], ["Helper", "Use /lands create, Alex", 3000, true], ["Steve", "Alex i can show you", 6000]]);
  assert.strictEqual(replyCandidate({ sender: "Alex", text: "ok thanks", botName: "Helper", lines: l2, now: 100_000 + 10_000 }), null);
});

test("narration about staying quiet never reaches chat", () => {
  for (const t of ["[silent]", "", "(staying quiet)", "*stays quiet*", "Players are just talking to each other, I'll stay out of it.", "No response needed."]) {
    assert.strictEqual(isSilentReply(t), true, t);
  }
  assert.strictEqual(isSilentReply("Use /lands create to claim your first chunk!"), false);
});

test("notes: model edits are applied safely", () => {
  let saved = null;
  const store = new NotesStore({ save: (d) => { saved = d; } });
  const a = store.add("Server restarts at 2am MT", "RedZephon");
  const r = store.applyEdit({ add: [{ text: "RedZephon said the 1.5 update is coming soon", source: "RedZephon" }, "Server restarts at 2am MT"], remove: [a.id, "nope"] });
  assert.deepStrictEqual(r, { added: 2, removed: 1 });
  assert.strictEqual(store.list().length, 2);
  assert.ok(saved.notes.length === 2);
  assert.deepStrictEqual(parseJsonObject('sure:\n```json\n{"add":[],"remove":[]}\n```'), { add: [], remove: [] });
  assert.strictEqual(parseJsonObject("nothing here"), null);
});

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
