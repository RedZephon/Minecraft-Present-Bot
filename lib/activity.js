"use strict";

// Player activity history: who was online when, and — just as important —
// when we were actually watching. An hour with no players only counts as
// "nobody on" if some session could see the server during it; otherwise the
// bot being offline would read as the server being empty.
//
// Used to answer "when will people be on?" for a player who joins an empty
// server.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RETAIN_MS = 60 * DAY;        // history kept on disk
const LOOKBACK_MS = 28 * DAY;      // window used for predictions
const MIN_COVERED_SAMPLES = 2;     // a weekly hour needs this many observed instances

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Hour-of-week (0–167, Sunday 00:00 = 0) and hour-of-day for an instant in
// the given IANA timezone.
function zonedHour(ms, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz || undefined, weekday: "short", hour: "numeric", hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const weekday = WEEKDAYS.indexOf(parts.find(p => p.type === "weekday").value);
  const hour = parseInt(parts.find(p => p.type === "hour").value, 10) % 24;
  return { week: weekday * 24 + hour, hour, weekday };
}

class ActivityTracker {
  constructor({ load, save, now = () => Date.now() } = {}) {
    this.now = now;
    this.saveFn = save || null;
    this.sessions = [];          // closed: { p, s, e }
    this.open = new Map();       // lowercase name -> { p, s }
    this.coverage = new Set();   // hour indices (floor(ms / HOUR)) we observed
    this.lastObservedAt = 0;
    this.dirty = false;

    const data = load ? load() : null;
    if (data && typeof data === "object") {
      if (Array.isArray(data.sessions)) {
        this.sessions = data.sessions.filter(x => x && typeof x.p === "string" && x.s > 0 && x.e >= x.s);
      }
      if (Array.isArray(data.coverage)) for (const h of data.coverage) if (Number.isInteger(h)) this.coverage.add(h);
      // Sessions that were open at shutdown end where observation stopped.
      if (Array.isArray(data.open) && data.lastObservedAt) {
        for (const o of data.open) {
          if (o && typeof o.p === "string" && o.s > 0 && data.lastObservedAt >= o.s) {
            this.sessions.push({ p: o.p, s: o.s, e: data.lastObservedAt });
          }
        }
      }
    }
    this.prune();
  }

  // Record the full set of players currently online. Call regularly while at
  // least one session can see the server.
  observe(names) {
    const now = this.now();
    this.coverage.add(Math.floor(now / HOUR));
    this.lastObservedAt = now;
    const current = new Map();
    for (const n of names) if (n) current.set(n.toLowerCase(), n);

    for (const [key, o] of this.open) {
      if (!current.has(key)) {
        this.sessions.push({ p: o.p, s: o.s, e: now });
        this.open.delete(key);
        this.dirty = true;
      }
    }
    for (const [key, name] of current) {
      if (!this.open.has(key)) {
        this.open.set(key, { p: name, s: now });
        this.dirty = true;
      }
    }
  }

  // Nobody can see the server any more: close open sessions at the last
  // moment we actually saw them, rather than letting them run on.
  unobserved() {
    if (!this.open.size) return;
    const end = this.lastObservedAt || this.now();
    for (const o of this.open.values()) this.sessions.push({ p: o.p, s: o.s, e: end });
    this.open.clear();
    this.dirty = true;
  }

  prune() {
    const cutoff = this.now() - RETAIN_MS;
    this.sessions = this.sessions.filter(x => x.e >= cutoff);
    const cutoffHour = Math.floor(cutoff / HOUR);
    for (const h of this.coverage) if (h < cutoffHour) this.coverage.delete(h);
  }

  toJSON() {
    return {
      sessions: this.sessions,
      open: [...this.open.values()],
      coverage: [...this.coverage],
      lastObservedAt: this.lastObservedAt,
    };
  }

  // Persist when something changed, plus once an hour so coverage advances.
  flush(force = false) {
    if (!this.saveFn || (!this.dirty && !force)) return;
    this.prune();
    this.saveFn(this.toJSON());
    this.dirty = false;
  }

  // Hour indices in the lookback window during which a non-excluded player
  // was online.
  occupiedHours(exclude, since, now) {
    const occupied = new Set();
    const consider = (p, s, e) => {
      if (exclude.has(p.toLowerCase()) || e < since) return;
      for (let h = Math.floor(Math.max(s, since) / HOUR); h <= Math.floor(e / HOUR); h++) occupied.add(h);
    };
    for (const x of this.sessions) consider(x.p, x.s, x.e);
    for (const o of this.open.values()) consider(o.p, o.s, now);
    return occupied;
  }

  // When are players (other than `exclude`) likely to be on next?
  // Returns null until there's enough observed history to say anything.
  predict({ tz, exclude = [] } = {}) {
    const now = this.now();
    const since = now - LOOKBACK_MS;
    const excl = new Set(exclude.map(n => String(n).toLowerCase()));
    const occupied = this.occupiedHours(excl, since, now);

    const covered = new Array(168).fill(0);
    const hits = new Array(168).fill(0);
    const dayCovered = new Array(24).fill(0);
    const dayHits = new Array(24).fill(0);
    let coveredHours = 0;
    for (const h of this.coverage) {
      if (h * HOUR < since || h >= Math.floor(now / HOUR)) continue;
      const { week, hour } = zonedHour(h * HOUR, tz);
      coveredHours++;
      covered[week]++;
      dayCovered[hour]++;
      if (occupied.has(h)) { hits[week]++; dayHits[hour]++; }
    }
    if (coveredHours < 24 * 3) return null; // under ~3 days watched: not enough to go on

    // First upcoming hour that has usually had someone on.
    const startHour = Math.floor(now / HOUR) + 1;
    let next = null;
    let fallback = null;
    for (let i = 0; i < 168; i++) {
      const at = (startHour + i) * HOUR;
      const { week } = zonedHour(at, tz);
      if (covered[week] < MIN_COVERED_SAMPLES) continue;
      const ratio = hits[week] / covered[week];
      if (ratio >= 0.5) { next = { at, ratio, samples: covered[week] }; break; }
      if (ratio >= 0.25 && !fallback) fallback = { at, ratio, samples: covered[week] };
    }

    // Typical busy stretch of the day, for a broader "usually evenings".
    const dayRatio = dayCovered.map((c, i) => (c ? dayHits[i] / c : 0));
    const peak = Math.max(...dayRatio);
    let busy = null;
    if (peak > 0.2) {
      const threshold = peak * 0.6;
      let best = null;
      for (let start = 0; start < 24; start++) {
        if (dayRatio[start] < threshold || dayRatio[(start + 23) % 24] >= threshold) continue;
        let len = 0;
        while (len < 24 && dayRatio[(start + len) % 24] >= threshold) len++;
        if (!best || len > best.len) best = { start, len };
      }
      if (best) busy = { startHour: best.start, endHour: (best.start + best.len) % 24 };
    }

    return {
      next: next || fallback,
      confident: !!next,
      busy,
      daysObserved: Math.round(coveredHours / 24),
    };
  }
}

function tzAbbrev(ms, tz) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, timeZoneName: "short" })
    .formatToParts(new Date(ms)).find(p => p.type === "timeZoneName");
  return part ? part.value : "";
}

// Human-readable facts for the model (and the no-API-key fallback text).
function describePrediction(prediction, { tz, now = Date.now() } = {}) {
  if (!prediction || !prediction.next) return null;
  const fmt = (ms, opts) => new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, ...opts }).format(new Date(ms));
  const at = prediction.next.at;
  const hoursAway = Math.max(1, Math.round((at - now) / HOUR));
  const sameDay = fmt(at, { year: "numeric", month: "numeric", day: "numeric" }) === fmt(now, { year: "numeric", month: "numeric", day: "numeric" });
  const tomorrow = fmt(at, { year: "numeric", month: "numeric", day: "numeric" }) === fmt(now + DAY, { year: "numeric", month: "numeric", day: "numeric" });
  const clock = fmt(at, { hour: "numeric", timeZoneName: "short" });
  const when = sameDay ? `today around ${clock}` : tomorrow ? `tomorrow around ${clock}` : `${fmt(at, { weekday: "long" })} around ${clock}`;
  const relative = hoursAway <= 1 ? "within the hour" : hoursAway < 24 ? `in about ${hoursAway} hours` : `in about ${Math.round(hoursAway / 24)} day(s)`;

  let busyText = null;
  if (prediction.busy) {
    const h = (n) => fmt(Date.UTC(2024, 0, 1, n), { hour: "numeric", timeZone: "UTC" });
    busyText = `${h(prediction.busy.startHour)}–${h(prediction.busy.endHour)}`;
  }
  return {
    when,
    relative,
    confident: prediction.confident,
    busyText,
    summary: `${prediction.confident ? "Players are usually" : "Players are sometimes"} on ${when} (${relative})` +
      (busyText ? `; the busiest stretch is typically ${busyText} ${tzAbbrev(now, tz)}` : "") +
      ` — based on ${prediction.daysObserved} days of observed activity.`,
  };
}

module.exports = { ActivityTracker, describePrediction, zonedHour, HOUR, DAY };
