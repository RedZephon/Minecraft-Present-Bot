"use strict";

// Dashboard hardening: optional password login, same-origin enforcement for
// anything that changes state, and baseline security headers.
//
// The dashboard can send chat and commands as a real Minecraft account and
// holds the Anthropic key, so it must never be reachable by a random page the
// operator happens to have open. Two independent layers:
//
//   1. Origin checks (always on). Browsers attach an Origin header to every
//      WebSocket handshake and cross-site POST; rejecting foreign origins stops
//      a malicious website from driving the bots through the operator's
//      browser (cross-site WebSocket hijacking / CSRF). Non-browser clients
//      send no Origin and are unaffected.
//   2. Password login (on when DASHBOARD_PASSWORD is set). Signed, HttpOnly,
//      SameSite=Strict cookie; required for the page, the REST API and the
//      socket.io handshake.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const COOKIE_NAME = "mcp_auth";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

// Reachable without a session: the login flow, the container healthcheck,
// PWA metadata (browsers fetch manifests without cookies), and the plugin
// webhook, which authenticates with its own shared secret.
const PUBLIC_PATHS = new Set([
  "/login", "/logout", "/healthz", "/api/plugin-event",
  "/manifest.json", "/icon-180.png", "/icon-192.png", "/icon-512.png",
]);

function createWebSecurity({ dataDir, password, allowedOrigins }) {
  const authEnabled = typeof password === "string" && password.length > 0;
  const extraOrigins = new Set(
    String(allowedOrigins || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
  );

  // Persisted so sessions survive restarts. Mixing in a hash of the password
  // means changing DASHBOARD_PASSWORD logs every existing session out.
  let signingKey = null;
  if (authEnabled) {
    const secretPath = path.join(dataDir, ".session-secret");
    let secret;
    try {
      secret = fs.readFileSync(secretPath);
      if (secret.length < 32) throw new Error("short");
    } catch (_) {
      secret = crypto.randomBytes(32);
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(secretPath, secret, { mode: 0o600 });
    }
    signingKey = crypto.createHmac("sha256", secret).update(password).digest();
  }

  const sign = (value) => crypto.createHmac("sha256", signingKey).update(value).digest("base64url");

  function issueToken() {
    const expires = String(Date.now() + SESSION_TTL_MS);
    return `${expires}.${sign(expires)}`;
  }

  function verifyToken(token) {
    if (!token || typeof token !== "string") return false;
    const dot = token.indexOf(".");
    if (dot <= 0) return false;
    const expires = token.slice(0, dot);
    const given = Buffer.from(token.slice(dot + 1));
    const expected = Buffer.from(sign(expires));
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
    return Number(expires) > Date.now();
  }

  function parseCookies(header) {
    const out = {};
    for (const part of String(header || "").split(";")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      const k = part.slice(0, eq).trim();
      if (!k) continue;
      try { out[k] = decodeURIComponent(part.slice(eq + 1).trim()); } catch (_) {}
    }
    return out;
  }

  function isAuthenticated(req) {
    if (!authEnabled) return true;
    return verifyToken(parseCookies(req.headers.cookie)[COOKIE_NAME]);
  }

  function passwordMatches(candidate) {
    // Compare fixed-length digests so neither length nor content leaks timing.
    const a = crypto.createHash("sha256").update(String(candidate || "")).digest();
    const b = crypto.createHash("sha256").update(password).digest();
    return crypto.timingSafeEqual(a, b);
  }

  // A request is same-origin when its Origin matches the host it was sent to.
  // X-Forwarded-Host covers reverse proxies that rewrite Host; ALLOWED_ORIGINS
  // covers anything more exotic.
  function isOriginAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    let originHost;
    try { originHost = new URL(origin).host.toLowerCase(); } catch (_) { return false; }
    if (extraOrigins.has(origin.toLowerCase())) return true;
    const hosts = [req.headers.host, req.headers["x-forwarded-host"]]
      .filter(Boolean)
      .flatMap(h => String(h).split(","))
      .map(h => h.trim().toLowerCase());
    return hosts.includes(originHost);
  }

  const failures = new Map(); // ip -> { count, resetAt }
  function loginBlocked(ip) {
    const f = failures.get(ip);
    if (!f) return false;
    if (Date.now() > f.resetAt) { failures.delete(ip); return false; }
    return f.count >= LOGIN_MAX_FAILURES;
  }
  function recordFailure(ip) {
    const f = failures.get(ip);
    if (!f || Date.now() > f.resetAt) failures.set(ip, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
    else f.count++;
  }

  function cookieHeader(value, maxAgeMs, req) {
    const secure = req.secure || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
    return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`;
  }

  function securityHeaders(_req, res, next) {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
        "img-src 'self' data: https://mc-heads.net",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "object-src 'none'",
      ].join("; "),
    });
    next();
  }

  // Rejects cross-origin state changes. GET/HEAD are left alone; they must not
  // mutate anything (and nothing here does).
  function originGuard(req, res, next) {
    if (req.method === "GET" || req.method === "HEAD" || req.path === "/api/plugin-event") return next();
    if (!isOriginAllowed(req)) return res.status(403).json({ error: "cross-origin request refused" });
    next();
  }

  function authGuard(req, res, next) {
    if (!authEnabled || PUBLIC_PATHS.has(req.path) || isAuthenticated(req)) return next();
    if (req.method === "GET" && req.accepts(["html", "json"]) === "html") return res.redirect(302, "/login");
    res.status(401).json({ error: "authentication required" });
  }

  function mountLoginRoutes(app, loginPagePath) {
    const loginTemplate = fs.readFileSync(loginPagePath, "utf-8");

    app.get("/login", (req, res) => {
      if (!authEnabled || isAuthenticated(req)) return res.redirect(302, "/");
      const error = req.query.e === "1" ? "Incorrect password."
        : req.query.e === "2" ? "Too many attempts. Try again in a few minutes."
        : "";
      res.set("Cache-Control", "no-store");
      res.type("html").send(loginTemplate.replace("__LOGIN_ERROR__", error));
    });

    app.post("/login", require("express").urlencoded({ extended: false, limit: "4kb" }), (req, res) => {
      if (!authEnabled) return res.redirect(303, "/");
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (loginBlocked(ip)) return res.redirect(303, "/login?e=2");
      if (!passwordMatches(req.body && req.body.password)) {
        recordFailure(ip);
        console.warn(`[MC-Presence] Failed dashboard login from ${ip}`);
        return res.redirect(303, "/login?e=1");
      }
      failures.delete(ip);
      res.set("Set-Cookie", cookieHeader(issueToken(), SESSION_TTL_MS, req));
      res.redirect(303, "/");
    });

    app.post("/logout", (req, res) => {
      res.set("Set-Cookie", cookieHeader("", 0, req));
      res.redirect(303, authEnabled ? "/login" : "/");
    });
  }

  // socket.io: `allowRequest` runs on the raw handshake, before any events.
  function allowSocketRequest(req, callback) {
    if (!isOriginAllowed(req)) return callback("cross-origin socket refused", false);
    if (!isAuthenticated(req)) return callback("authentication required", false);
    callback(null, true);
  }

  return {
    authEnabled,
    securityHeaders,
    originGuard,
    authGuard,
    mountLoginRoutes,
    allowSocketRequest,
  };
}

module.exports = { createWebSecurity };
