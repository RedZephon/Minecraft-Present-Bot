/* ═══════════════════════════════════════════════════════════════
   MC Presence — Client Application
   ═══════════════════════════════════════════════════════════════
   No inline event handlers: every interactive element carries a
   data-action attribute and is dispatched from one delegated listener,
   which lets the page run under a strict Content-Security-Policy. */

'use strict';

const socket = io();

// ─────────── State ───────────
const state = {
  bots: {},
  activeSessionId: null,     // per-browser selection, remembered locally
  settings: {},
  metrics: {},               // { botId: { latency } }
  defaultPrompts: {},
  supportedVersions: [],
  authEnabled: false,
  notes: [],
  detailsOpen: true,
  detailsTab: 'controls',    // 'controls' | 'setup'
  theme: document.documentElement.getAttribute('data-theme') || 'dark',
  serverFavicon: null,
};

let confirmCallback = null;
let pendingNewSession = false;
let cmdSelectedIdx = 0;

const AI_MODES = [
  { value: 'off', title: 'Off', desc: 'Just stays online.' },
  { value: 'afk', title: 'AFK', desc: 'Turns /afk on while connected. No replies.' },
  { value: 'admin-afk', title: 'AFK Responder', desc: "/afk, plus tells people you're away when they talk to you. Your account only.", ai: true, ownerOnly: true },
  { value: 'support', title: 'Support Bot', desc: 'Helps players: answers questions, welcomes newcomers, learns from chat.', ai: true },
  { value: 'disguise', title: 'Player Disguise', desc: 'Acts like a real player. Casual chat, greetings.', ai: true },
];
const isAfkMode = (m) => m === 'afk' || m === 'admin-afk';

const SUGGESTED_MODELS = ['claude-haiku-4-5-20251001', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'];

// ─────────── Helpers ───────────
const $ = (id) => document.getElementById(id);

// Escapes for both element content and quoted attribute values.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const store = {
  get(key) { try { return localStorage.getItem(key); } catch (_) { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch (_) {} },
};

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatUptime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

function formatUptimeFull(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
}

function formatRelativeAgo(ts) {
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return 'just now';
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m ago` : `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function uptimeOf(bot) {
  return bot && bot.state === 'connected' && bot.connectedAt ? Date.now() - bot.connectedAt : 0;
}

// IANA timezone helpers — used by the schedule and maintenance fields.
function getBrowserTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch (_) { return 'UTC'; }
}

function getTimezoneList() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') return Intl.supportedValuesOf('timeZone');
  } catch (_) {}
  return [
    'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Edmonton',
    'America/Los_Angeles', 'America/Vancouver', 'America/Toronto',
    'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Madrid',
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Kolkata',
    'Australia/Sydney', 'Pacific/Auckland',
  ];
}

// Built once and shared by every timezone / model input.
(function buildDatalists() {
  const tz = document.createElement('datalist');
  tz.id = 'tzList';
  for (const zone of getTimezoneList()) tz.appendChild(new Option(zone, zone));
  document.body.appendChild(tz);

  const models = document.createElement('datalist');
  models.id = 'modelList';
  for (const m of SUGGESTED_MODELS) models.appendChild(new Option(m, m));
  document.body.appendChild(models);
})();

function showToast(msg, level) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast visible ' + (level || '');
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, 3500);
}

function avatarUrl(name, size) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(name || 'Steve')}/${size}`;
}

function getDayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function getActiveBot() {
  return state.activeSessionId ? state.bots[state.activeSessionId] || null : null;
}

function getConnectedBots() {
  return Object.values(state.bots).filter(b => b.state === 'connected');
}

function displayName(bot) {
  return bot.connectedUsername || bot.label;
}

function setActiveSession(id) {
  state.activeSessionId = id;
  if (id) store.set('mcpresence:session', id);
}

function serverAddress() {
  const host = state.settings.defaultHost || '--';
  const port = state.settings.defaultPort;
  return port && port !== 25565 ? `${host}:${port}` : host;
}

// ─────────── Theme ───────────
function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  store.set('mcpresence:theme', theme);
  document.querySelectorAll('[data-theme-btn]').forEach(btn => {
    const active = btn.dataset.themeBtn === theme;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}
setTheme(state.theme);

// ─────────── Socket.io events ───────────
socket.on('connect_error', (err) => {
  // The server refuses the handshake when the login cookie is missing or
  // expired — send the user back to the sign-in page instead of spinning.
  if (/authentication required/i.test(err.message)) window.location.href = '/login';
});

socket.on('disconnect', () => document.body.classList.add('offline'));
socket.on('connect', () => document.body.classList.remove('offline'));

socket.on('init', (data) => {
  state.settings = data.settings || {};
  state.defaultPrompts = data.defaultPrompts || {};
  state.supportedVersions = data.supportedVersions || [];
  state.authEnabled = !!data.authEnabled;
  state.notes = data.notes || [];
  state.serverFavicon = data.serverFavicon || null;
  $('appVersion').textContent = data.version ? 'v' + data.version : '';
  $('logoutForm').hidden = !state.authEnabled;

  state.bots = {};
  for (const bot of data.bots) state.bots[bot.id] = bot;

  // One-time migration: a schedule without a timezone is evaluated on the
  // server's clock (often UTC in a container). Stamp the browser's zone so
  // the window fires at the wall-clock time the user meant.
  const browserTz = getBrowserTimezone();
  for (const bot of Object.values(state.bots)) {
    if (bot.schedule && !bot.schedule.tz) {
      bot.schedule = { ...bot.schedule, tz: browserTz };
      socket.emit('update_bot', { id: bot.id, schedule: bot.schedule });
    }
  }

  // Keep the current selection across reconnects; otherwise restore this
  // browser's last one, else the first connected session.
  if (!state.activeSessionId || !state.bots[state.activeSessionId]) {
    const remembered = store.get('mcpresence:session');
    const first = getConnectedBots()[0] || Object.values(state.bots)[0];
    state.activeSessionId = remembered && state.bots[remembered] ? remembered : first ? first.id : null;
  }

  renderAll();
});

socket.on('botAdded', (bot) => {
  state.bots[bot.id] = bot;
  renderSidebar();
  updateServerCard();
});

// Sent only to the browser that pressed "+": select the new session and
// open its Setup tab so it can be filled in.
socket.on('botCreated', ({ botId }) => {
  if (!pendingNewSession || !state.bots[botId]) return;
  pendingNewSession = false;
  setActiveSession(botId);
  state.detailsTab = 'setup';
  toggleDetails(true);
  renderAll();
  closeMobileSidebar();
  if (isDrawerLayout()) openMobileDetails();
});

socket.on('botUpdated', (bot) => {
  const prev = state.bots[bot.id];
  state.bots[bot.id] = { ...prev, ...bot };
  renderSidebar();
  updateServerCard();
  if (bot.id === state.activeSessionId) {
    renderChatHeader();
    renderDetails();
    updateChatInputState();
  }
  if (prev && prev.state !== bot.state) renderPlayerList();
});

socket.on('botRemoved', ({ botId }) => {
  delete state.bots[botId];
  delete state.metrics[botId];
  if (state.activeSessionId === botId) {
    const next = getConnectedBots()[0] || Object.values(state.bots)[0];
    setActiveSession(next ? next.id : null);
  }
  renderAll();
});

socket.on('chat', (msg) => {
  const bot = state.bots[msg.botId];
  if (bot) {
    if (!bot.chatLog) bot.chatLog = [];
    bot.chatLog.push(msg);
    if (bot.chatLog.length > 300) bot.chatLog.shift();
  }
  if (msg.botId === state.activeSessionId) appendChatMessage(msg);
});

socket.on('stats', () => updateServerCard());

socket.on('players', ({ botId, players }) => {
  if (state.bots[botId]) state.bots[botId].players = players;
  updateServerCard();
  renderPlayerList();
});

socket.on('session:metrics', ({ id, latency }) => {
  state.metrics[id] = { latency };
  if (id === state.activeSessionId) {
    const latEl = $('detailLatency');
    if (latEl) latEl.textContent = latency ? latency + 'ms' : '--';
    $('serverPing').textContent = latency ? latency + 'ms' : '--';
  }
});

socket.on('serverFavicon', (favicon) => {
  state.serverFavicon = favicon;
  updateServerCard();
});

socket.on('settingsUpdated', (s) => {
  state.settings = s;
  renderAll();
});

socket.on('toast', ({ message, level }) => showToast(message, level || 'warn'));

socket.on('notesUpdated', (list) => {
  state.notes = list || [];
  if (!$('settingsPage').hidden) renderNotes();
});

// ─────────── Render all ───────────
function renderAll() {
  renderSidebar();
  renderChatHeader();
  renderChatLog();
  renderDetails();
  updateServerCard();
  renderPlayerList();
  updateChatInputState();
}

// ─────────── Status ───────────
// One place that decides how a session's state reads in the UI.
function sessionStatus(bot) {
  if (bot.state === 'connected') return { dot: '', label: 'Connected', tone: 'success' };
  if (bot.state === 'connecting') {
    return bot.msaCode
      ? { dot: 'idle', label: 'Waiting for Microsoft sign-in', tone: 'warning' }
      : { dot: 'idle', label: 'Connecting…', tone: 'warning' };
  }
  if (bot.onBreak) return { dot: 'offline', label: 'On break', tone: '' };
  if (bot.yieldedDuplicate) return { dot: 'offline', label: 'Yielded to your game client', tone: 'warning' };
  if (bot.reconnectPending) return { dot: 'idle', label: `Reconnecting (attempt ${bot.reconnectAttempts + 1})`, tone: 'warning' };
  if (bot.paused && bot.mode !== 'manual') return { dot: 'offline', label: 'Held offline', tone: '' };
  return { dot: 'offline', label: 'Offline', tone: '' };
}

// ─────────── Sidebar ───────────
function renderSidebar() {
  const list = $('sessionList');
  const botEntries = Object.values(state.bots);

  if (botEntries.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="padding:30px 10px;">
        <div class="empty-icon"><i class="fa-solid fa-cube"></i></div>
        <h3>No sessions yet</h3>
        <p>Add your first Minecraft session to get started.</p>
        <button class="btn primary" data-action="add-session"><i class="fa-solid fa-plus"></i> Add Session</button>
      </div>
    `;
    return;
  }

  let html = '';
  for (const bot of botEntries) {
    const isActive = bot.id === state.activeSessionId;
    const status = sessionStatus(bot);
    let meta = bot.state === 'connected' ? `${formatUptime(uptimeOf(bot))} uptime` : status.label;
    if (isActive && bot.state === 'connected') meta += ' · selected';
    const eff = bot.effectiveMode || bot.aiMode;
    const badge = eff === 'support' || eff === 'disguise' || eff === 'admin-afk'
      ? '<span class="badge ai">AI</span>'
      : eff === 'afk' ? '<span class="badge">AFK</span>' : '';

    html += `
      <div class="session ${isActive ? 'active' : ''}" role="button" tabindex="0" aria-current="${isActive}"
           data-action="select-session" data-id="${esc(bot.id)}">
        <div class="session-avatar-wrap">
          <img class="session-avatar-img" src="${esc(avatarUrl(displayName(bot), 28))}" alt="" />
          <span class="dot ${status.dot}"></span>
        </div>
        <div class="session-info">
          <div class="session-name">${esc(bot.label)}</div>
          <div class="session-meta" data-meta-for="${esc(bot.id)}">${esc(meta)}</div>
        </div>
        ${badge}
      </div>
    `;
  }
  list.innerHTML = html;
}

function selectSession(id) {
  if (!state.bots[id]) return;
  setActiveSession(id);
  renderAll();
  closeMobileSidebar();
}

// ─────────── Chat header ───────────
function renderChatHeader() {
  const bot = getActiveBot();
  if (!bot) {
    $('speakingAs').innerHTML = '<div class="header-empty">No session selected</div>';
    $('chatActions').innerHTML = '';
    return;
  }

  const mcName = displayName(bot);
  const isConnected = bot.state === 'connected';
  const status = sessionStatus(bot);

  $('speakingAs').innerHTML = `
    <div class="avatar-lg">
      <img src="${esc(avatarUrl(mcName, 40))}" alt="" />
      ${isConnected ? '<span class="dot"></span>' : ''}
    </div>
    <div>
      <div class="speaking-label">${isConnected ? 'Speaking as' : esc(bot.label)}</div>
      <div class="speaking-name">
        ${esc(mcName)}
        <span class="sub" id="headerSub">· ${isConnected ? esc(formatUptime(uptimeOf(bot)) + ' uptime') : esc(status.label.toLowerCase())}</span>
      </div>
    </div>
  `;

  const others = getConnectedBots().filter(b => b.id !== bot.id);
  let actions = '';
  if (others.length) {
    actions += `<div class="desktop-only switch-wrap">
      <button class="btn" data-action="toggle-switch" aria-haspopup="true"><i class="fa-solid fa-arrow-right-arrow-left"></i> Switch</button>
      <div class="switch-dropdown" id="switchDropdown"></div>
    </div>`;
  }
  actions += connectionButton(bot, 'desktop-only');
  if (!state.detailsOpen) {
    actions += '<button class="btn desktop-only" data-action="toggle-details" title="Show details" aria-label="Show details"><i class="fa-solid fa-table-columns"></i></button>';
  }

  // Mobile: one overflow menu.
  let mobileItems = '';
  for (const b of others) {
    mobileItems += `<button class="btn" data-action="select-session" data-id="${esc(b.id)}"><i class="fa-solid fa-arrow-right-arrow-left"></i> ${esc(displayName(b))}</button>`;
  }
  mobileItems += connectionButton(bot, '');
  mobileItems += '<button class="btn" data-action="open-mobile-details"><i class="fa-solid fa-circle-info"></i> Session Details</button>';
  actions += `
    <div class="mobile-actions-wrap">
      <button class="btn" data-action="toggle-mobile-actions" aria-label="Session actions" aria-haspopup="true"><i class="fa-solid fa-ellipsis-vertical"></i></button>
      <div class="mobile-actions-dropdown">${mobileItems}</div>
    </div>
  `;

  $('chatActions').innerHTML = actions;
}

// Connect / Cancel / Disconnect for the session's current state. A stuck
// connect used to have no way out short of restarting or deleting it.
function connectionButton(bot, extraClass) {
  const id = esc(bot.id);
  if (bot.state === 'connected') {
    return `<button class="btn danger ${extraClass}" data-action="disconnect" data-id="${id}"><i class="fa-solid fa-power-off"></i> Disconnect</button>`;
  }
  if (bot.state === 'connecting' || bot.reconnectPending || bot.onBreak) {
    return `<button class="btn ${extraClass}" data-action="disconnect" data-id="${id}"><i class="fa-solid fa-xmark"></i> Cancel</button>`;
  }
  const needsAccount = (bot.botType || 'mineflayer') === 'mineflayer' && !bot.username;
  return `<button class="btn primary ${extraClass}" data-action="connect" data-id="${id}" ${needsAccount ? 'disabled title="Add the account in Setup first"' : ''}><i class="fa-solid fa-plug"></i> Connect</button>`;
}

function toggleSwitchDropdown() {
  const dd = $('switchDropdown');
  if (!dd) return;
  const opening = !dd.classList.contains('visible');
  dd.classList.toggle('visible', opening);
  if (!opening) return;
  dd.innerHTML = getConnectedBots().map(bot => {
    const name = displayName(bot);
    const isCurrent = bot.id === state.activeSessionId;
    return `
      <button class="switch-item ${isCurrent ? 'current' : ''}" data-action="select-session" data-id="${esc(bot.id)}">
        <img src="${esc(avatarUrl(name, 24))}" alt="" />
        <span>${esc(name)}</span>
      </button>`;
  }).join('');
}

function closeDropdowns(except) {
  const dd = $('switchDropdown');
  if (dd && !(except && except.closest('.switch-wrap'))) dd.classList.remove('visible');
  if (!(except && except.closest('.mobile-actions-wrap'))) {
    document.querySelectorAll('.mobile-actions-dropdown.visible').forEach(el => el.classList.remove('visible'));
  }
}

// ─────────── Chat log ───────────
const SYSTEM_TYPES = ['join', 'leave', 'system', 'error', 'server'];

function renderChatLog() {
  const bot = getActiveBot();
  const log = $('chatLog');

  if (!bot) {
    log.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><i class="fa-solid fa-comments"></i></div>
        <h3>Welcome to MC Presence</h3>
        <p>Keep your Minecraft accounts connected while you're away. Add a session to get started.</p>
      </div>
    `;
    return;
  }

  const entries = bot.chatLog || [];
  if (entries.length === 0) {
    log.innerHTML = '<div class="empty-state"><p>No messages yet. Chat will appear here once connected.</p></div>';
    return;
  }

  let html = '';
  let lastDay = '';
  let prev = null;
  for (const msg of entries) {
    const day = getDayLabel(msg.ts || Date.now());
    if (day !== lastDay) {
      html += `<div class="day-divider">${esc(day)}</div>`;
      lastDay = day;
      prev = null;
    }
    html += renderEntry(msg, bot, prev);
    prev = msg;
  }

  log.innerHTML = html;
  log.scrollTop = log.scrollHeight;
}

function renderEntry(msg, bot, prev) {
  const type = msg.type || 'chat';
  if (SYSTEM_TYPES.includes(type)) return renderSystemLine(msg, type);
  // Whispers never group with public chat, so the "whisper" label stays visible.
  const grouped = prev && !SYSTEM_TYPES.includes(prev.type || 'chat') &&
    prev.sender === msg.sender && (prev.type === 'whisper') === (msg.type === 'whisper') &&
    (msg.ts - (prev.ts || 0)) < 300000;
  return renderChatMessage(msg, bot, grouped);
}

function renderSystemLine(msg, type) {
  const icons = {
    join: ['fa-arrow-right-to-bracket', 'join'],
    leave: ['fa-arrow-right-from-bracket', 'leave'],
    error: ['fa-circle-exclamation', 'error'],
  };
  const [icon, lineClass] = icons[type] || ['fa-circle-info', ''];
  return `
    <div class="system-line ${lineClass}">
      <span class="time">${esc(formatTime(msg.ts || Date.now()))}</span>
      <span class="sys-icon"><i class="fa-solid ${icon}"></i></span>
      <span>${esc(msg.message)}</span>
    </div>
  `;
}

function renderChatMessage(msg, bot, grouped) {
  const sender = msg.sender || 'Unknown';
  const mcName = displayName(bot);
  const isAi = msg.type === 'auto';
  const isSelf = msg.type === 'self' || msg.type === 'command' || sender === mcName;

  let msgClass = 'player';
  // Nicknames have no skin of their own; use the real account's.
  let avatarHtml = `<img class="message-avatar" src="${esc(avatarUrl(msg.realName || sender, 36))}" alt="" />`;
  let authorExtra = msg.realName ? `<span class="real-name" title="Minecraft username">${esc(msg.realName)}</span>` : '';

  if (isAi) {
    msgClass = 'ai';
    avatarHtml = '<div class="message-avatar"><i class="fa-solid fa-wand-magic-sparkles"></i></div>';
    avatarHtml = msg.realName ? `<img class="message-avatar" src="${esc(avatarUrl(msg.realName, 36))}" alt="" />` : avatarHtml;
    authorExtra = `<span class="ai-pill">${esc(bot.aiMode === 'support' ? (bot.assistantName || 'Assistant') : 'Auto')}</span>`;
  } else if (isSelf) {
    msgClass = 'me';
    avatarHtml = `<img class="message-avatar" src="${esc(avatarUrl(mcName, 36))}" alt="" />`;
  }
  if (msg.type === 'whisper') authorExtra += '<span class="whisper-pill">whisper</span>';

  // Highlight mentions and the command name. Runs on escaped text, and the
  // patterns can't match inside an entity.
  let text = esc(msg.message);
  text = text.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
  if (msg.type === 'command') text = text.replace(/^(\/[\w:-]+)/, '<span class="code-inline">$1</span>');

  return `
    <div class="message ${msgClass} ${grouped ? 'grouped' : ''}">
      ${avatarHtml}
      <div class="message-body">
        <div class="message-head">
          <span class="message-author">${esc(sender)}</span>
          ${authorExtra}
          <span class="message-time">${esc(formatTime(msg.ts || Date.now()))}</span>
        </div>
        <div class="message-text">${text}</div>
      </div>
    </div>
  `;
}

function appendChatMessage(msg) {
  const log = $('chatLog');
  const bot = getActiveBot();
  if (!log || !bot) return;

  // First message replaces the empty state.
  if (log.querySelector('.empty-state')) { renderChatLog(); return; }

  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 100;
  const entries = bot.chatLog || [];
  let prev = entries.length > 1 ? entries[entries.length - 2] : null;

  const day = getDayLabel(msg.ts || Date.now());
  const dividers = log.querySelectorAll('.day-divider');
  const lastDivider = dividers[dividers.length - 1];
  if (!lastDivider || lastDivider.textContent !== day) {
    const div = document.createElement('div');
    div.className = 'day-divider';
    div.textContent = day;
    log.appendChild(div);
    prev = null;
  }

  const tmp = document.createElement('div');
  tmp.innerHTML = renderEntry(msg, bot, prev);
  while (tmp.firstChild) log.appendChild(tmp.firstChild);

  // Keep the DOM in step with the 300-entry log.
  const items = log.querySelectorAll('.message, .system-line');
  for (let i = 0; i < items.length - 300; i++) items[i].remove();

  if (nearBottom) log.scrollTop = log.scrollHeight;
}

// ─────────── Details panel ───────────
function renderDetails() {
  const bot = getActiveBot();
  const content = $('detailsContent');
  if (!content) return;

  if (!bot) {
    content.innerHTML = '<div class="empty-state" style="padding:40px 20px;"><p>Select a session to view details.</p></div>';
    return;
  }

  // Preserve focus, caret and any half-typed value across the re-render that
  // every server update triggers.
  const focused = document.activeElement;
  let focusKey = null, selStart = null, selEnd = null, focusValue = null;
  if (focused && content.contains(focused) && focused.dataset && focused.dataset.field) {
    focusKey = focused.dataset.field;
    if (typeof focused.selectionStart === 'number') {
      selStart = focused.selectionStart;
      selEnd = focused.selectionEnd;
    }
    if ('value' in focused && focused.tagName !== 'SELECT') focusValue = focused.value;
  }

  const tab = state.detailsTab === 'setup' ? 'setup' : 'controls';
  content.innerHTML = `
    <div class="details-tabs" role="tablist">
      <button class="details-tab ${tab === 'controls' ? 'active' : ''}" role="tab" aria-selected="${tab === 'controls'}" data-action="details-tab" data-tab="controls">Controls</button>
      <button class="details-tab ${tab === 'setup' ? 'active' : ''}" role="tab" aria-selected="${tab === 'setup'}" data-action="details-tab" data-tab="setup">Setup</button>
    </div>
    ${tab === 'controls' ? renderControlsTab(bot) : renderSetupTab(bot)}
  `;

  if (focusKey) {
    const el = content.querySelector(`[data-field="${CSS.escape(focusKey)}"]`);
    if (el) {
      if (focusValue !== null && 'value' in el && el.tagName !== 'SELECT') el.value = focusValue;
      el.focus();
      if (selStart !== null && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(selStart, selEnd); } catch (_) {}
      }
    }
  }
}

function toggleHtml(field, on, label) {
  return `<button class="toggle ${on ? 'on' : ''}" role="switch" aria-checked="${!!on}" aria-label="${esc(label)}" data-action="toggle" data-field="${esc(field)}"></button>`;
}

function renderBanners(bot) {
  const id = esc(bot.id);
  const banners = [];

  if (bot.state === 'connecting' && bot.msaCode && bot.msaCode.code) {
    const uri = /^https:\/\//.test(bot.msaCode.uri || '') ? bot.msaCode.uri : 'https://www.microsoft.com/link';
    banners.push(`
      <div class="banner accent">
        <div class="banner-title"><i class="fa-brands fa-microsoft"></i> Microsoft sign-in required</div>
        <div>Open <a href="${esc(uri)}" target="_blank" rel="noopener noreferrer">${esc(uri.replace(/^https:\/\//, ''))}</a> and enter:</div>
        <div class="msa-code">
          <code>${esc(bot.msaCode.code)}</code>
          <button class="btn" data-action="copy" data-copy="${esc(bot.msaCode.code)}"><i class="fa-regular fa-copy"></i> Copy</button>
        </div>
        <div class="banner-note">Sign in with the account for <strong>${esc(bot.username || bot.label)}</strong>. Only needed once.</div>
      </div>`);
  }
  if (bot.onBreak && bot.breakUntil) {
    banners.push(`<div class="banner"><i class="fa-solid fa-mug-hot"></i> On a break — back around ${esc(formatTime(bot.breakUntil))}</div>`);
  }
  if (bot.yieldedDuplicate) {
    banners.push(`
      <div class="banner warning">
        <div><i class="fa-solid fa-user-clock"></i> This account logged in from your game client, so the bot stepped aside. It resumes after you leave the server.</div>
        <button class="btn" data-action="clear-yield" data-id="${id}"><i class="fa-solid fa-play"></i> Resume now</button>
      </div>`);
  }
  if (bot.paused && bot.mode !== 'manual' && bot.state === 'disconnected' && !bot.onBreak) {
    const until = bot.mode === 'scheduled' ? 'until this schedule window ends' : 'until you click Connect';
    banners.push(`<div class="banner"><i class="fa-solid fa-hand"></i> Held offline ${until}.</div>`);
  }
  if (bot.state === 'disconnected' && bot.lastKickReason && !bot.yieldedDuplicate) {
    banners.push(`<div class="banner danger"><i class="fa-solid fa-circle-exclamation"></i> Last kick: ${esc(bot.lastKickReason)}</div>`);
  }
  if (bot.state === 'disconnected' && (bot.botType || 'mineflayer') === 'mineflayer' && !bot.username) {
    banners.push(`<div class="banner warning"><i class="fa-solid fa-triangle-exclamation"></i> Add the account in <button class="link-btn" data-action="details-tab" data-tab="setup">Setup</button> before connecting.</div>`);
  }
  return banners.join('');
}

function renderControlsTab(bot) {
  const id = esc(bot.id);
  const isConnected = bot.state === 'connected';
  const isMineflayer = (bot.botType || 'mineflayer') === 'mineflayer';
  const metrics = state.metrics[bot.id] || {};
  const status = sessionStatus(bot);
  const aiEnabled = state.settings.aiEnabled !== false;
  const breaksOn = bot.breaks && bot.breaks.enabled;

  // AI modes disappear when AI features are off (unless currently selected,
  // so the selection never silently vanishes). The AFK Responder is greyed
  // out on accounts that aren't the owner's.
  const aiOptions = AI_MODES.filter(m => !m.ai || aiEnabled || bot.aiMode === m.value).map(m => {
    const locked = m.ownerOnly && bot.afkResponderAllowed === false && bot.aiMode !== m.value;
    const hint = m.ownerOnly && state.settings.ownerUsername ? ` (${state.settings.ownerUsername})` : '';
    return `
    <label class="ai-mode-option ${bot.aiMode === m.value ? 'selected' : ''} ${locked ? 'locked' : ''}">
      <input type="radio" name="aiMode_${id}" value="${m.value}" ${bot.aiMode === m.value ? 'checked' : ''} ${locked ? 'disabled' : ''} data-action="ai-mode" />
      <div>
        <div class="ai-mode-title">${esc(m.title)}</div>
        <div class="ai-mode-desc">${esc(m.desc)}${m.ownerOnly ? esc(hint) : ''}</div>
      </div>
    </label>`;
  }).join('');

  const modeDef = AI_MODES.find(m => m.value === bot.aiMode) || AI_MODES[0];
  const eff = bot.effectiveMode || bot.aiMode;
  const aiNoKey = modeDef.ai && aiEnabled && !state.settings.ai?.hasApiKey;
  let modeNote = '';
  if (bot.aiMode === 'admin-afk' && eff === 'afk' && bot.afkResponderAllowed === false) {
    modeNote = `Running as plain AFK: the AFK Responder only works on ${esc(state.settings.ownerUsername)}'s account.`;
  } else if (modeDef.ai && !aiEnabled) {
    modeNote = eff === 'afk' ? 'AI features are off in Settings, so this runs as plain AFK.' : 'AI features are off in Settings, so this mode is inactive.';
  } else if (bot.aiMode === 'admin-afk' && !state.settings.ownerUsername) {
    modeNote = 'Set your Minecraft username in Settings → General to lock this mode to your account.';
  }

  return `
    <div class="details-section">
      <h4>Connection</h4>
      ${renderBanners(bot)}
      <div class="info-grid">
        <div class="info-row"><span class="label">Status</span><span class="value ${status.tone}">${esc(status.label)}</span></div>
        <div class="info-row"><span class="label">Uptime</span><span class="value" id="detailUptime">${isConnected ? esc(formatUptimeFull(uptimeOf(bot))) : '--'}</span></div>
        <div class="info-row"><span class="label">Latency</span><span class="value" id="detailLatency">${isConnected && metrics.latency ? metrics.latency + 'ms' : '--'}</span></div>
        ${isMineflayer && bot.connectedUsername ? `<div class="info-row"><span class="label">MC Username</span><span class="value">${esc(bot.connectedUsername)}</span></div>` : ''}
        ${bot.detectedVersion ? `<div class="info-row"><span class="label">Joined as</span><span class="value">${esc(bot.detectedVersion)}</span></div>` : ''}
        ${breaksOn || bot.lastBreakAt ? `<div class="info-row"><span class="label">Last Break</span><span class="value">${esc(bot.lastBreakAt ? formatRelativeAgo(bot.lastBreakAt) : 'Never')}</span></div>` : ''}
      </div>
      <div class="connection-actions">${connectionButton(bot, '')}</div>
    </div>

    <div class="details-section">
      <h4>Behavior</h4>
      <div class="toggle-row">
        <div class="toggle-info">
          <div class="toggle-title">Auto-reconnect</div>
          <div class="toggle-desc">Re-join automatically if the session drops${bot.mode === 'manual' ? ' (Always online and Scheduled modes only)' : ''}.</div>
        </div>
        ${toggleHtml('autoReconnect', bot.autoReconnect, 'Auto-reconnect')}
      </div>
      ${isMineflayer ? `
      <div class="toggle-row">
        <div class="toggle-info">
          <div class="toggle-title">Anti-AFK</div>
          <div class="toggle-desc">Small random movements to prevent idle kicks.${isAfkMode(eff) ? ' Paused while an AFK mode is on.' : ''}</div>
        </div>
        ${toggleHtml('antiAfk', bot.antiAfk, 'Anti-AFK')}
      </div>
      <div class="toggle-row">
        <div class="toggle-info">
          <div class="toggle-title">Support bot replies to this account</div>
          <div class="toggle-desc">AI bots normally ignore accounts this app is playing, so bots never talk to each other. Turn on to test the support bot by chatting as this account from here. Its automatic messages are still ignored.</div>
        </div>
        ${toggleHtml('aiReplies', bot.aiReplies, 'Support bot replies to this account')}
      </div>` : ''}
      ${isMineflayer || aiEnabled ? `
      <div class="ai-mode-block">
        <div class="mini-label">Mode</div>
        <div class="ai-mode-selector">${aiOptions}</div>
        ${modeNote ? `<div class="field-note warn-text">${modeNote}</div>` : ''}
        ${aiNoKey ? '<div class="field-note warn-text">No Anthropic API key is set — AI replies are off until you add one in Settings → AI Chat.</div>' : ''}
        ${bot.aiMode === 'support' ? `
        <label class="mini-label" for="assistantName">Assistant Name</label>
        <input id="assistantName" class="assistant-name-input" type="text" maxlength="32" data-field="assistantName"
          value="${esc(bot.assistantName || 'Assistant')}" placeholder="Assistant" />` : ''}
      </div>` : ''}
    </div>

    <div class="details-section">
      <h4>Manage</h4>
      <div class="danger-zone">
        <button class="btn" data-action="restart" data-id="${id}"><i class="fa-solid fa-rotate-right"></i> Restart Session</button>
        <button class="btn danger" data-action="remove" data-id="${id}"><i class="fa-solid fa-trash"></i> Remove Session</button>
      </div>
    </div>
  `;
}

function renderSetupTab(bot) {
  const isMineflayer = (bot.botType || 'mineflayer') === 'mineflayer';
  const locked = bot.state !== 'disconnected';
  const lockedAttr = locked ? 'disabled' : '';
  const lockedNote = locked ? '<div class="field-note">Disconnect the session to edit connection settings.</div>' : '';
  const breaks = bot.breaks || {};
  const isOffline = bot.auth === 'offline';

  const versionOptions = ['<option value="">Auto-detect (recommended)</option>']
    .concat(state.supportedVersions.map(v => `<option value="${esc(v)}" ${bot.version === v ? 'selected' : ''}>${esc(v)}</option>`))
    .join('');

  const num = (field, key, min, max, fallback, label) => `
    <div class="field">
      <label for="${field}">${label}</label>
      <input id="${field}" type="number" min="${min}" max="${max}" data-field="${field}" data-break="${key}"
        value="${esc(String(breaks[key] ?? fallback))}" />
    </div>`;

  return `
    <div class="details-section">
      <h4>Identity</h4>
      <div class="field">
        <label for="fLabel">Label</label>
        <input id="fLabel" type="text" maxlength="40" data-field="label" value="${esc(bot.label || '')}" placeholder="Display name" />
      </div>
      <div class="field">
        <label for="fBotType">Session type</label>
        <select id="fBotType" data-field="botType" ${lockedAttr}>
          <option value="mineflayer" ${isMineflayer ? 'selected' : ''}>Minecraft account</option>
          <option value="bridge" ${!isMineflayer ? 'selected' : ''}>Virtual player (CobbleBridge)</option>
        </select>
        <div class="field-note">${isMineflayer ? 'Joins the server as a real Minecraft account.' : 'A virtual player via the CobbleBridge plugin. No Minecraft account needed.'}</div>
      </div>
    </div>

    ${isMineflayer ? `
    <div class="details-section">
      <h4>Account</h4>
      <div class="field">
        <label for="fAuth">Sign-in</label>
        <select id="fAuth" data-field="auth" ${lockedAttr}>
          <option value="microsoft" ${!isOffline ? 'selected' : ''}>Microsoft account</option>
          <option value="offline" ${isOffline ? 'selected' : ''}>Offline (offline-mode servers only)</option>
        </select>
      </div>
      <div class="field">
        <label for="fUsername">${isOffline ? 'Username' : 'Microsoft email'}</label>
        <input id="fUsername" type="${isOffline ? 'text' : 'email'}" autocomplete="off" spellcheck="false" data-field="username" value="${esc(bot.username || '')}" ${lockedAttr}
          placeholder="${isOffline ? 'Steve' : 'you@outlook.com'}" />
        ${isOffline ? '' : '<div class="field-note">The first connect shows a Microsoft sign-in code in Controls.</div>'}
      </div>
      <div class="field">
        <label for="fVersion">Version</label>
        <select id="fVersion" data-field="version" ${lockedAttr}>${versionOptions}</select>
        <div class="field-note">Auto-detect also handles servers newer than ${esc(state.supportedVersions[0] || 'the newest listed version')} when they run ViaVersion + ViaBackwards.</div>
      </div>
      <div class="field">
        <label>Server</label>
        <div class="readonly-value">${esc(serverAddress())} <button class="link-btn" data-action="open-settings">Change</button></div>
      </div>
      ${lockedNote}
    </div>` : ''}

    <div class="details-section">
      <h4>Schedule</h4>
      <div class="field">
        <label for="fMode">Mode</label>
        <select id="fMode" data-field="mode">
          <option value="manual" ${bot.mode === 'manual' ? 'selected' : ''}>Manual</option>
          <option value="permanent" ${bot.mode === 'permanent' ? 'selected' : ''}>Always online</option>
          <option value="scheduled" ${bot.mode === 'scheduled' ? 'selected' : ''}>Scheduled</option>
        </select>
        <div class="field-note">${bot.mode === 'manual'
          ? 'You connect and disconnect it yourself.'
          : bot.mode === 'permanent'
            ? 'Connects on its own and stays online. Disconnecting holds it offline until you click Connect.'
            : 'Connects when the window opens and disconnects when it closes.'}</div>
      </div>
      ${bot.mode === 'scheduled' ? `
      <div class="field-row">
        <div class="field">
          <label for="fStart">Connect at</label>
          <input id="fStart" type="time" data-field="scheduleStart" data-schedule="start" value="${esc(bot.schedule?.start || '00:00')}" />
        </div>
        <div class="field">
          <label for="fEnd">Disconnect at</label>
          <input id="fEnd" type="time" data-field="scheduleEnd" data-schedule="end" value="${esc(bot.schedule?.end || '08:00')}" />
        </div>
      </div>
      <div class="field">
        <label for="fTz">Timezone</label>
        <input id="fTz" type="text" list="tzList" spellcheck="false" data-field="scheduleTz" data-schedule="tz"
          value="${esc(bot.schedule?.tz || '')}" placeholder="${esc(getBrowserTimezone())}" />
        <div class="field-note">The window can wrap past midnight (e.g. 22:00 → 06:00).</div>
      </div>` : ''}
    </div>

    ${isMineflayer ? `
    <div class="details-section">
      <h4>Breaks</h4>
      <div class="toggle-row">
        <div class="toggle-info">
          <div class="toggle-title">Take random breaks</div>
          <div class="toggle-desc">Now and then, disconnect for a while and come back — like stepping away from the keyboard.</div>
        </div>
        ${toggleHtml('breaksEnabled', breaks.enabled, 'Take random breaks')}
      </div>
      ${breaks.enabled ? `
      <div class="field-row" style="margin-top:12px;">
        ${num('breaksCheckInterval', 'checkIntervalMinutes', 1, 1440, 30, 'Check every (min)')}
        ${num('breaksChance', 'chancePercent', 0, 100, 10, 'Chance (%)')}
      </div>
      <div class="field-row">
        ${num('breaksMin', 'minMinutes', 1, 1440, 5, 'Min length (min)')}
        ${num('breaksMax', 'maxMinutes', 1, 1440, 20, 'Max length (min)')}
      </div>
      <div class="field-row">
        ${num('breaksMinInterval', 'minIntervalHours', 0, 168, 3, 'Force after (hr)')}
        ${num('breaksForcedDuration', 'forcedDurationMinutes', 1, 1440, 10, 'Forced length (min)')}
      </div>
      <div class="field-note">Every ${esc(breaks.checkIntervalMinutes ?? 30)} min online there's a ${esc(breaks.chancePercent ?? 10)}% chance of a ${esc(breaks.minMinutes ?? 5)}–${esc(breaks.maxMinutes ?? 20)} min break. ${Number(breaks.minIntervalHours ?? 3) > 0 ? `After ${esc(breaks.minIntervalHours ?? 3)}h online without one, a ${esc(breaks.forcedDurationMinutes ?? 10)} min break is forced.` : 'No forced breaks ("Force after" is 0).'}</div>
      ` : ''}
    </div>` : ''}
  `;
}

// ─────────── Session field updates ───────────
function emitUpdate(id, patch) {
  socket.emit('update_bot', { id, ...patch });
}

function onDetailsChange(el) {
  const bot = getActiveBot();
  if (!bot) return;
  const field = el.dataset.field;

  if (el.dataset.schedule) {
    const key = el.dataset.schedule;
    let value = el.value.trim();
    if (key === 'tz' && !value) value = getBrowserTimezone();
    if (!value) return; // a cleared time input means "unchanged"
    const schedule = { ...(bot.schedule || { start: '00:00', end: '08:00' }), [key]: value };
    bot.schedule = schedule;
    emitUpdate(bot.id, { schedule });
    return;
  }

  if (el.dataset.break) {
    const n = parseInt(el.value, 10);
    if (!Number.isFinite(n) || n < 0) { showToast('Enter a whole number.', 'warn'); renderDetails(); return; }
    const breaks = { ...(bot.breaks || {}), [el.dataset.break]: n };
    if (el.dataset.break === 'minMinutes' && n > (breaks.maxMinutes ?? n)) breaks.maxMinutes = n;
    if (el.dataset.break === 'maxMinutes' && n < (breaks.minMinutes ?? n)) breaks.minMinutes = n;
    bot.breaks = breaks;
    emitUpdate(bot.id, { breaks });
    renderDetails();
    return;
  }

  if (field === 'assistantName') {
    socket.emit('session:behavior:update', { id: bot.id, field, value: el.value.trim() || 'Assistant' });
    return;
  }

  if (['label', 'username', 'botType', 'auth', 'version', 'mode'].includes(field)) {
    const value = el.tagName === 'SELECT' ? el.value : el.value.trim();
    if (field === 'label' && !value) { showToast("Label can't be empty.", 'warn'); renderDetails(); return; }
    // Optimistic update so dependent UI (field labels, mode notes) reflows
    // immediately; the server's botUpdated is authoritative.
    bot[field] = value;
    emitUpdate(bot.id, { [field]: value });
    renderDetails();
    renderSidebar();
  }
}

function onToggle(el) {
  const bot = getActiveBot();
  if (!bot) return;
  const field = el.dataset.field;
  const next = !el.classList.contains('on');
  el.classList.toggle('on', next);
  el.setAttribute('aria-checked', String(next));
  if (field === 'breaksEnabled') {
    const breaks = { ...(bot.breaks || {}), enabled: next };
    bot.breaks = breaks;
    emitUpdate(bot.id, { breaks });
    renderDetails();
  } else if (field === 'autoReconnect' || field === 'antiAfk' || field === 'aiReplies') {
    bot[field] = next;
    socket.emit('session:behavior:update', { id: bot.id, field, value: next });
  }
}

function setAiMode(mode) {
  const bot = getActiveBot();
  if (!bot || bot.aiMode === mode) return;
  bot.aiMode = mode;
  socket.emit('session:behavior:update', { id: bot.id, field: 'aiMode', value: mode });
  renderDetails();
  renderSidebar();
}

function createNewSession() {
  pendingNewSession = true;
  socket.emit('add_bot', {
    label: 'New Session',
    botType: 'mineflayer',
    username: '',
    auth: 'microsoft',
    version: '',
    mode: 'manual',
    aiMode: 'off',
    schedule: { start: '00:00', end: '08:00', tz: getBrowserTimezone() },
  });
}

function toggleDetails(open) {
  state.detailsOpen = open ?? !state.detailsOpen;
  $('workspace').classList.toggle('details-hidden', !state.detailsOpen);
  renderChatHeader();
}

// ─────────── Server card ───────────
function updateServerCard() {
  const bots = Object.values(state.bots);
  const connected = bots.filter(b => b.state === 'connected');
  const active = getActiveBot();

  const iconEl = $('serverIcon');
  if (state.serverFavicon && /^data:image\/png;base64,/.test(state.serverFavicon)) {
    let img = iconEl.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      img.alt = '';
      img.className = 'server-favicon';
      iconEl.replaceChildren(img);
    }
    if (img.src !== state.serverFavicon) img.src = state.serverFavicon;
  }
  $('serverName').textContent = state.settings.serverName || 'Server';
  $('serverAddr').textContent = serverAddress();
  $('serverStatus').innerHTML = connected.length > 0 ? '<span class="live"></span>Online' : 'Offline';

  const playerSet = new Set();
  for (const bot of connected) for (const p of (bot.players || [])) playerSet.add(p.username);
  $('serverPlayers').textContent = playerSet.size;
  $('serverSessions').textContent = `${connected.length} / ${bots.length}`;

  const m = active && active.state === 'connected' ? state.metrics[active.id] : null;
  $('serverPing').textContent = m && m.latency ? m.latency + 'ms' : '--';
}

// ─────────── Player list ───────────
function renderPlayerList() {
  const section = $('playerListSection');
  const list = $('playerList');
  const playerMap = new Map();
  for (const bot of getConnectedBots()) {
    for (const p of (bot.players || [])) if (!playerMap.has(p.username)) playerMap.set(p.username, p);
  }
  const players = Array.from(playerMap.values()).sort((a, b) => a.username.localeCompare(b.username));

  section.hidden = players.length === 0;
  if (!players.length) return;
  $('playerListCount').textContent = players.length;
  list.innerHTML = players.map(p => `
    <div class="player-item">
      <img src="${esc(avatarUrl(p.username, 20))}" alt="" />
      <span>${esc(p.username)}</span>
      ${p.ping ? `<span class="player-ping">${esc(p.ping)}ms</span>` : ''}
    </div>
  `).join('');
}

// ─────────── Chat input ───────────
function updateChatInputState() {
  const bot = getActiveBot();
  const input = $('chatInput');
  const ready = !!bot && bot.state === 'connected';
  input.disabled = !ready;
  $('btnSend').disabled = !ready;
  $('btnSlash').disabled = !ready;
  $('btnMention').disabled = !ready;
  input.placeholder = ready
    ? `Message as ${displayName(bot)}…`
    : bot ? 'Session is not connected' : 'Select a session to chat...';
}

function sendChat() {
  const input = $('chatInput');
  const msg = input.value.trim();
  const bot = getActiveBot();
  if (!msg || !bot) return;
  socket.emit('send_chat', { botId: bot.id, message: msg });
  input.value = '';
  hideSlashPopup();
}

$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) { sendChat(); e.preventDefault(); }
  if (e.key === 'Escape') hideSlashPopup();
});

// ─────────── Slash command popup ───────────
const SLASH_COMMANDS = [
  { cmd: '/list', desc: 'List online players' },
  { cmd: '/help', desc: 'Show available commands' },
  { cmd: '/tps', desc: 'Check server TPS' },
  { cmd: '/ping', desc: 'Check your latency' },
  { cmd: '/msg', desc: 'Send a private message' },
  { cmd: '/me', desc: 'Action message' },
];

$('chatInput').addEventListener('input', (e) => {
  const val = e.target.value;
  if (val.startsWith('/') && !val.includes(' ')) showSlashPopup(val.slice(1));
  else hideSlashPopup();
});

function showSlashPopup(filter) {
  const popup = $('slashPopup');
  const f = filter.toLowerCase();
  const filtered = SLASH_COMMANDS.filter(c => c.cmd.toLowerCase().includes(f) || c.desc.toLowerCase().includes(f));
  if (filtered.length === 0) { hideSlashPopup(); return; }
  popup.innerHTML = filtered.map(c => `
    <button class="slash-item" data-action="insert-slash" data-cmd="${esc(c.cmd)}">
      <span class="slash-cmd">${esc(c.cmd)}</span>
      <span class="slash-desc">${esc(c.desc)}</span>
    </button>
  `).join('');
  popup.classList.add('visible');
}

function hideSlashPopup() {
  $('slashPopup').classList.remove('visible');
}

function insertIntoChat(text) {
  const input = $('chatInput');
  if (input.disabled) return;
  input.value = text;
  input.focus();
  input.setSelectionRange(text.length, text.length);
}

// ─────────── Confirm modal ───────────
function confirmRemove(id) {
  const bot = state.bots[id];
  showConfirm('Remove Session', `Remove "${bot?.label || id}"? Its settings and chat history will be deleted.`, () => {
    socket.emit('session:remove', id);
    showToast('Session removed');
  });
}

function showConfirm(title, message, callback) {
  $('confirmTitle').textContent = title;
  $('confirmMessage').textContent = message;
  confirmCallback = callback;
  $('confirmModalOverlay').classList.add('visible');
  $('btnConfirmCancel').focus();
}

function closeConfirm() {
  $('confirmModalOverlay').classList.remove('visible');
  confirmCallback = null;
}

$('btnConfirmOk').addEventListener('click', () => {
  const cb = confirmCallback;
  closeConfirm();
  if (cb) cb();
});
$('btnConfirmCancel').addEventListener('click', closeConfirm);
$('confirmModalOverlay').addEventListener('click', (e) => {
  if (e.target === $('confirmModalOverlay')) closeConfirm();
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied');
  } catch (_) {
    showToast('Copy failed — select the code and copy it manually.', 'warn');
  }
}

// ─────────── Settings page ───────────
// Secrets are write-only: the server never sends them back, only whether one
// is set. A blank secret field means "keep the saved value".
const secretFields = {
  sAiApiKey: { path: ['ai', 'apiKey'], has: () => state.settings.ai?.hasApiKey, hint: () => state.settings.ai?.apiKeyHint },
  sBridgeSecret: { path: ['bridge', 'secret'], has: () => state.settings.bridge?.hasSecret },
  sBridgeDiscord: { path: ['bridge', 'discordWebhook'], has: () => state.settings.bridge?.hasDiscordWebhook },
};
const secretsToClear = new Set();

function updateAiSettingsVisibility() {
  const enabled = $('sAiEnabledToggle').classList.contains('on');
  document.querySelectorAll('.settings-tab[data-tab="ai"], .settings-tab[data-tab="prompts"]').forEach(el => {
    el.hidden = !enabled;
  });
  const active = document.querySelector('.settings-tab.active');
  if (!enabled && active && (active.dataset.tab === 'ai' || active.dataset.tab === 'prompts')) selectSettingsTab('general');
}

function selectSettingsTab(name) {
  document.querySelectorAll('.settings-tab').forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('.settings-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === name));
}

function renderSecretField(id) {
  const def = secretFields[id];
  const input = $(id);
  const has = def.has() && !secretsToClear.has(id);
  input.value = '';
  input.type = 'password';
  input.placeholder = has
    ? `Saved${def.hint && def.hint() ? ` (${def.hint()})` : ''} — type to replace`
    : (input.dataset.emptyPlaceholder || (secretsToClear.has(id) ? 'Will be removed on save' : ''));
  const clearBtn = document.querySelector(`[data-action="clear-secret"][data-target="${id}"]`);
  if (clearBtn) clearBtn.hidden = !has;
}

function openSettings() {
  const s = state.settings;
  secretsToClear.clear();

  const aiToggle = $('sAiEnabledToggle');
  aiToggle.classList.toggle('on', s.aiEnabled !== false);
  aiToggle.setAttribute('aria-checked', String(s.aiEnabled !== false));
  updateAiSettingsVisibility();

  $('sMaintenanceEnabled').checked = s.maintenance?.enabled ?? true;
  $('sMaintenanceStart').value = s.maintenance?.start || '01:59';
  $('sMaintenanceEnd').value = s.maintenance?.end || '02:05';
  $('sTimezone').value = s.timezone || '';
  $('sTimezone').placeholder = getBrowserTimezone();
  $('sStaff').value = (s.staffUsernames || []).join(', ');
  setToggle($('sAiJoinConversations'), s.ai?.joinConversations !== false);
  setToggle($('sAiLearnFromChat'), s.ai?.learnFromChat !== false);
  $('sAiQuietMessage').value = s.ai?.quietServerMessage || '';
  renderNotes();
  loadActivity();
  $('sReconnectBase').value = s.reconnect?.baseDelay ?? 10;
  $('sReconnectMax').value = s.reconnect?.maxDelay ?? 120;
  $('sReconnectRetries').value = s.reconnect?.maxRetries ?? 20;
  $('sServerName').value = s.serverName || '';
  $('sDefaultHost').value = s.defaultHost || '';
  $('sDefaultPort').value = s.defaultPort || 25565;
  $('sAiModel').value = s.ai?.model || SUGGESTED_MODELS[0];
  $('sAiCooldown').value = s.ai?.cooldownSeconds ?? 15;
  $('sAiResponseDelay').value = s.ai?.responseDelayMs ?? 2000;
  $('sAiServerInfo').value = s.ai?.serverInfo || '';
  // An empty custom prompt means "use the built-in default" — show the
  // default so it can be edited, and save it back as empty if unchanged.
  $('sAiAdminPrompt').value = s.ai?.adminAfkPrompt || state.defaultPrompts.adminAfk || '';
  $('sAiSupportPrompt').value = s.ai?.supportPrompt || state.defaultPrompts.support || '';
  $('sAiDisguisePrompt').value = s.ai?.disguisePrompt || state.defaultPrompts.disguise || '';
  $('sBridgeUrl').value = s.bridge?.pluginUrl || '';
  $('sOwnerUsername').value = s.ownerUsername || '';
  for (const id of Object.keys(secretFields)) renderSecretField(id);
  $('bridgeSecretWarning').hidden = !s.bridge?.secretInsecure;
  $('authWarning').hidden = state.authEnabled;

  $('settingsPage').hidden = false;
  $('btnSettingsBack').focus();
}

function closeSettings() {
  $('settingsPage').hidden = true;
}

function promptValue(id, defaultText) {
  const v = $(id).value;
  return v.trim() === (defaultText || '').trim() ? '' : v;
}

function intOr(id, fallback) {
  const n = parseInt($(id).value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function saveSettings() {
  const port = parseInt($('sDefaultPort').value, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) { showToast('Port must be between 1 and 65535.', 'warn'); return; }
  const host = $('sDefaultHost').value.trim();
  if (!host) { showToast('Enter the server host.', 'warn'); return; }

  const payload = {
    maintenance: {
      enabled: $('sMaintenanceEnabled').checked,
      start: $('sMaintenanceStart').value,
      end: $('sMaintenanceEnd').value,
    },
    timezone: $('sTimezone').value.trim() || getBrowserTimezone(),
    staffUsernames: $('sStaff').value,
    reconnect: {
      baseDelay: intOr('sReconnectBase', 10),
      maxDelay: intOr('sReconnectMax', 120),
      maxRetries: intOr('sReconnectRetries', 20),
    },
    aiEnabled: $('sAiEnabledToggle').classList.contains('on'),
    serverName: $('sServerName').value.trim(),
    defaultHost: host,
    defaultPort: port,
    ai: {
      model: $('sAiModel').value.trim(),
      cooldownSeconds: intOr('sAiCooldown', 15),
      responseDelayMs: intOr('sAiResponseDelay', 2000),
      serverInfo: $('sAiServerInfo').value,
      adminAfkPrompt: promptValue('sAiAdminPrompt', state.defaultPrompts.adminAfk),
      supportPrompt: promptValue('sAiSupportPrompt', state.defaultPrompts.support),
      disguisePrompt: promptValue('sAiDisguisePrompt', state.defaultPrompts.disguise),
      joinConversations: $('sAiJoinConversations').classList.contains('on'),
      learnFromChat: $('sAiLearnFromChat').classList.contains('on'),
      quietServerMessage: $('sAiQuietMessage').value.trim(),
    },
    bridge: { pluginUrl: $('sBridgeUrl').value.trim() },
    ownerUsername: $('sOwnerUsername').value.trim(),
  };

  for (const [id, def] of Object.entries(secretFields)) {
    const typed = $(id).value.trim();
    const [section, key] = def.path;
    if (typed) payload[section][key] = typed;
    else if (secretsToClear.has(id)) payload[section][key] = '';
  }

  const btn = $('btnSettingsSave');
  btn.disabled = true;
  socket.timeout(5000).emit('update_settings', payload, (err) => {
    btn.disabled = false;
    if (err) { showToast("Couldn't save — is the server reachable?", 'warn'); return; }
    showToast('Settings saved');
    closeSettings();
  });
}

function setToggle(el, on) {
  el.classList.toggle('on', on);
  el.setAttribute('aria-checked', String(on));
}

function renderNotes() {
  const list = $('notesList');
  if (!state.notes.length) {
    list.innerHTML = '<div class="notes-empty">Nothing yet. Notes appear here as the support bot picks things up from chat.</div>';
    return;
  }
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  list.innerHTML = state.notes.slice().reverse().map(n => `
    <div class="note-item">
      <div class="note-text">${esc(n.text)}</div>
      <div class="note-meta">${esc(fmt.format(new Date(n.at)))} · ${esc(n.source)}</div>
      <button class="icon-btn" data-action="remove-note" data-id="${esc(n.id)}" title="Delete note" aria-label="Delete note"><i class="fa-solid fa-trash"></i></button>
    </div>`).join('');
}

function addNote() {
  const input = $('noteInput');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('notes:add', { text });
  input.value = '';
}

function loadActivity() {
  const panel = $('activityPanel');
  panel.textContent = 'Loading…';
  socket.timeout(5000).emit('activity:get', (err, data) => {
    if (err || !data) { panel.textContent = "Couldn't load activity."; return; }
    const online = data.online === null ? 'No session is connected, so nobody is being observed right now.'
      : data.online.length ? `Online now: ${data.online.join(', ')}.` : 'Nobody (other than your bots) is online right now.';
    const p = data.prediction;
    const forecast = p
      ? `${p.summary}`
      : 'Not enough history yet. Predictions start after about 3 days of a session being connected.';
    const excluded = data.excluded.length ? ` Staff left out of predictions: ${data.excluded.join(', ')}.` : '';
    panel.innerHTML = `<p>${esc(forecast)}</p><p class="field-note">${esc(online)}${esc(excluded)}</p>`;
  });
}

function resetPrompt(id) {
  const map = { sAiAdminPrompt: 'adminAfk', sAiSupportPrompt: 'support', sAiDisguisePrompt: 'disguise' };
  $(id).value = state.defaultPrompts[map[id]] || '';
}

function generateSecret() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const secret = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  const input = $('sBridgeSecret');
  input.type = 'text';
  input.value = secret;
  input.select();
  showToast('Secret generated — put the same value in the CobbleBridge plugin config, then Save.');
}

$('noteInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addNote(); }
});

document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => selectSettingsTab(tab.dataset.tab));
});

// ─────────── Command palette (Cmd/Ctrl+K) ───────────
function restartSession(id) {
  socket.emit('session:restart', id);
  showToast('Restarting session...');
}

function getCommandList() {
  const commands = [];
  for (const bot of Object.values(state.bots)) {
    commands.push({
      label: `Go to ${bot.label}`,
      icon: 'fa-solid fa-arrow-right-arrow-left',
      hint: bot.id === state.activeSessionId ? 'current' : sessionStatus(bot).label.toLowerCase(),
      action: () => selectSession(bot.id),
    });
  }
  const active = getActiveBot();
  if (active) {
    commands.push(active.state === 'disconnected'
      ? { label: `Connect ${active.label}`, icon: 'fa-solid fa-plug', action: () => socket.emit('connect_bot', active.id) }
      : { label: `Disconnect ${active.label}`, icon: 'fa-solid fa-power-off', action: () => socket.emit('disconnect_bot', active.id) });
    commands.push({ label: `Restart ${active.label}`, icon: 'fa-solid fa-rotate-right', action: () => restartSession(active.id) });
  }
  commands.push(
    { label: 'Connect all', icon: 'fa-solid fa-plug-circle-bolt', action: () => { socket.emit('connect_all'); showToast('Connecting all sessions...'); } },
    { label: 'Disconnect all', icon: 'fa-solid fa-power-off', action: () => { socket.emit('disconnect_all'); showToast('Disconnecting all sessions...'); } },
    { label: 'Add session', icon: 'fa-solid fa-plus', action: createNewSession },
    { label: 'Settings', icon: 'fa-solid fa-gear', action: openSettings },
    { label: 'Toggle theme', icon: 'fa-solid fa-circle-half-stroke', action: () => setTheme(state.theme === 'dark' ? 'light' : 'dark') },
  );
  return commands;
}

function filteredCommands() {
  const f = $('cmdPaletteInput').value.trim().toLowerCase();
  const all = getCommandList();
  return f ? all.filter(c => c.label.toLowerCase().includes(f)) : all;
}

function openCommandPalette() {
  $('cmdPaletteInput').value = '';
  cmdSelectedIdx = 0;
  renderCommandList();
  $('cmdPaletteOverlay').classList.add('visible');
  setTimeout(() => $('cmdPaletteInput').focus(), 30);
}

function closeCommandPalette() {
  $('cmdPaletteOverlay').classList.remove('visible');
}

function renderCommandList() {
  const list = filteredCommands();
  cmdSelectedIdx = Math.min(cmdSelectedIdx, Math.max(0, list.length - 1));
  $('cmdPaletteList').innerHTML = list.length ? list.map((c, i) => `
    <div class="command-item ${i === cmdSelectedIdx ? 'selected' : ''}" role="option" aria-selected="${i === cmdSelectedIdx}" data-action="run-command" data-idx="${i}">
      <div class="cmd-icon"><i class="${esc(c.icon)}"></i></div>
      <span class="cmd-label">${esc(c.label)}</span>
      ${c.hint ? `<span class="cmd-hint">${esc(c.hint)}</span>` : ''}
    </div>
  `).join('') : '<div class="command-empty">No matching commands</div>';
}

function highlightCommand(idx) {
  cmdSelectedIdx = idx;
  $('cmdPaletteList').querySelectorAll('.command-item').forEach((el, i) => {
    el.classList.toggle('selected', i === idx);
    el.setAttribute('aria-selected', String(i === idx));
    if (i === idx) el.scrollIntoView({ block: 'nearest' });
  });
}

function executeCommand(idx) {
  const cmd = filteredCommands()[idx];
  if (!cmd) return;
  closeCommandPalette();
  cmd.action();
}

$('cmdPaletteInput').addEventListener('input', () => { cmdSelectedIdx = 0; renderCommandList(); });
$('cmdPaletteInput').addEventListener('keydown', (e) => {
  const count = filteredCommands().length;
  if (e.key === 'ArrowDown') { e.preventDefault(); highlightCommand(Math.min(cmdSelectedIdx + 1, count - 1)); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); highlightCommand(Math.max(cmdSelectedIdx - 1, 0)); }
  else if (e.key === 'Enter') { e.preventDefault(); executeCommand(cmdSelectedIdx); }
});
$('cmdPaletteList').addEventListener('mousemove', (e) => {
  const item = e.target.closest('.command-item');
  if (item && Number(item.dataset.idx) !== cmdSelectedIdx) highlightCommand(Number(item.dataset.idx));
});
$('cmdPaletteOverlay').addEventListener('click', (e) => {
  if (e.target === $('cmdPaletteOverlay')) closeCommandPalette();
});

// ─────────── Mobile drawers ───────────
// Below 1200px the details panel is a drawer rather than a column.
const isDrawerLayout = () => window.matchMedia('(max-width: 1200px)').matches;

function openMobileSidebar() {
  document.querySelector('.sidebar').classList.add('mobile-open');
  $('sidebarOverlay').classList.add('visible');
}
function closeMobileSidebar() {
  document.querySelector('.sidebar').classList.remove('mobile-open');
  $('sidebarOverlay').classList.remove('visible');
}
function openMobileDetails() {
  document.querySelector('.details').classList.add('mobile-open');
  $('detailsOverlay').classList.add('visible');
}
function closeMobileDetails() {
  document.querySelector('.details').classList.remove('mobile-open');
  $('detailsOverlay').classList.remove('visible');
}

// ─────────── Delegated event handling ───────────
const actions = {
  'add-session': () => createNewSession(),
  'select-session': (el) => selectSession(el.dataset.id),
  'connect': (el) => socket.emit('connect_bot', el.dataset.id),
  'disconnect': (el) => socket.emit('disconnect_bot', el.dataset.id),
  'restart': (el) => restartSession(el.dataset.id),
  'remove': (el) => confirmRemove(el.dataset.id),
  'clear-yield': (el) => socket.emit('clear_yield', el.dataset.id),
  'toggle-switch': () => toggleSwitchDropdown(),
  'toggle-details': () => (isDrawerLayout() ? openMobileDetails() : toggleDetails(true)),
  'close-details': () => (isDrawerLayout() ? closeMobileDetails() : toggleDetails(false)),
  'details-tab': (el) => { state.detailsTab = el.dataset.tab; renderDetails(); },
  'toggle': (el) => onToggle(el),
  'toggle-mobile-actions': (el) => el.closest('.mobile-actions-wrap').querySelector('.mobile-actions-dropdown').classList.toggle('visible'),
  'open-mobile-details': () => openMobileDetails(),
  'open-mobile-sidebar': () => openMobileSidebar(),
  'close-mobile-sidebar': () => closeMobileSidebar(),
  'close-mobile-details': () => closeMobileDetails(),
  'insert-slash': (el) => { insertIntoChat(el.dataset.cmd + ' '); hideSlashPopup(); },
  'slash': () => { insertIntoChat('/'); showSlashPopup(''); },
  'mention': () => insertIntoChat($('chatInput').value + '@'),
  'send': () => sendChat(),
  'copy': (el) => copyText(el.dataset.copy),
  'open-settings': () => { closeMobileDetails(); openSettings(); },
  'close-settings': () => closeSettings(),
  'save-settings': () => saveSettings(),
  'settings-ai-toggle': (el) => {
    const on = !el.classList.contains('on');
    el.classList.toggle('on', on);
    el.setAttribute('aria-checked', String(on));
    updateAiSettingsVisibility();
  },
  'clear-secret': (el) => { secretsToClear.add(el.dataset.target); renderSecretField(el.dataset.target); },
  'reveal-secret': (el) => {
    const input = $(el.dataset.target);
    input.type = input.type === 'password' ? 'text' : 'password';
  },
  'generate-secret': () => generateSecret(),
  'reset-prompt': (el) => resetPrompt(el.dataset.target),
  'settings-toggle': (el) => setToggle(el, !el.classList.contains('on')),
  'add-note': () => addNote(),
  'remove-note': (el) => socket.emit('notes:remove', el.dataset.id),
  'command-palette': () => openCommandPalette(),
  'run-command': (el) => executeCommand(Number(el.dataset.idx)),
  'theme': (el) => setTheme(el.dataset.themeBtn),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  closeDropdowns(el);
  if (!el || el.disabled) return;
  const handler = actions[el.dataset.action];
  if (handler) handler(el, e);
});

// Inputs in the details panel save on change (blur/enter), not per keystroke.
$('detailsContent').addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.action === 'ai-mode') { setAiMode(el.value); return; }
  if (el.dataset.field) onDetailsChange(el);
});

document.addEventListener('keydown', (e) => {
  // Keyboard activation for role="button" elements that aren't <button>s.
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role="button"][data-action]')) {
    e.preventDefault();
    e.target.click();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if ($('cmdPaletteOverlay').classList.contains('visible')) closeCommandPalette();
    else openCommandPalette();
    return;
  }
  if (e.key === 'Escape') {
    if ($('cmdPaletteOverlay').classList.contains('visible')) closeCommandPalette();
    else if ($('confirmModalOverlay').classList.contains('visible')) closeConfirm();
    else if (!$('settingsPage').hidden) closeSettings();
    else { closeDropdowns(); closeMobileSidebar(); closeMobileDetails(); }
  }
});

// ─────────── Live clocks ───────────
// Uptime counts from the server's connectedAt, so it ticks smoothly instead
// of jumping every metrics interval.
setInterval(() => {
  const bot = getActiveBot();
  if (bot && bot.state === 'connected') {
    const sub = $('headerSub');
    if (sub) sub.textContent = '· ' + formatUptime(uptimeOf(bot)) + ' uptime';
    const up = $('detailUptime');
    if (up) up.textContent = formatUptimeFull(uptimeOf(bot));
  }
  for (const b of getConnectedBots()) {
    const meta = document.querySelector(`[data-meta-for="${CSS.escape(b.id)}"]`);
    if (meta) meta.textContent = formatUptime(uptimeOf(b)) + ' uptime' + (b.id === state.activeSessionId ? ' · selected' : '');
  }
}, 1000);
