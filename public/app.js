/* ═══════════════════════════════════════════════════════════════
   MC Presence v2.0.0 — Client Application
   ═══════════════════════════════════════════════════════════════ */

const socket = io();

// ─────────── State ───────────
const state = {
  bots: {},
  activeSessionId: null,
  settings: {},
  metrics: {},       // { botId: { latency, uptime } }
  defaultPrompts: {},
  detailsOpen: true,
  detailsTab: 'controls',  // 'controls' | 'setup'
  theme: document.documentElement.getAttribute('data-theme') || 'dark',
};

let confirmCallback = null;
let uptimeInterval = null;
let pendingNewSessionSelect = false;

// ─────────── Helpers ───────────
const $ = (id) => document.getElementById(id);
function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

function formatUptimeFull(ms) {
  const s = Math.floor(ms / 1000);
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
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// IANA timezone helpers — used by the schedule field. `supportedValuesOf` is
// the comprehensive list (~430 entries, Node/Chrome/Firefox/Safari ≥ 2022);
// the fallback list covers the common ones for older runtimes.
function getBrowserTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch (_) { return 'UTC'; }
}

function getTimezoneList() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone');
    }
  } catch (_) {}
  return [
    'UTC', 'America/New_York', 'America/Chicago', 'America/Denver',
    'America/Los_Angeles', 'America/Vancouver', 'America/Toronto',
    'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Madrid',
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Kolkata',
    'Australia/Sydney', 'Pacific/Auckland',
  ];
}

// Build the IANA timezone <datalist> once on app load so all per-session
// schedule inputs can share it (avoids regenerating ~430 <option> elements
// inside renderDetails on every re-render).
(function buildTimezoneDatalist() {
  if (document.getElementById('tzList')) return;
  const dl = document.createElement('datalist');
  dl.id = 'tzList';
  for (const tz of getTimezoneList()) {
    const opt = document.createElement('option');
    opt.value = tz;
    dl.appendChild(opt);
  }
  document.body.appendChild(dl);
})();

function showToast(msg, level) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast visible ' + (level || '');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.className = 'toast', 3000);
}

function hashUsername(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash) + name.charCodeAt(i);
  return Math.abs(hash) % 4;
}

function avatarClass(idx) { return 'a' + ((idx % 4) + 1); }

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
  return state.activeSessionId ? state.bots[state.activeSessionId] : null;
}

function getConnectedBots() {
  return Object.values(state.bots).filter(b => b.state === 'connected');
}

// ─────────── Theme ───────────
function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('mcpresence:theme', theme);
  document.querySelectorAll('[data-theme-btn]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeBtn === theme);
  });
}

document.querySelectorAll('[data-theme-btn]').forEach(btn => {
  btn.addEventListener('click', () => setTheme(btn.dataset.themeBtn));
  btn.classList.toggle('active', btn.dataset.themeBtn === state.theme);
});

// ─────────── Socket.io Events ───────────
socket.on('init', (data) => {
  state.settings = data.settings || {};
  state.activeSessionId = data.activeSessionId || null;
  state.defaultPrompts = data.defaultPrompts || {};
  if (data.serverFavicon) state.serverFavicon = data.serverFavicon;
  $('appVersion').textContent = 'v' + (data.version || '2.0.0');

  state.bots = {};
  for (const bot of data.bots) state.bots[bot.id] = bot;

  // Auto-select first connected if no active
  if (!state.activeSessionId) {
    const connected = getConnectedBots();
    if (connected.length > 0) state.activeSessionId = connected[0].id;
  }

  renderAll();
});

socket.on('botAdded', (bot) => {
  state.bots[bot.id] = bot;
  if (pendingNewSessionSelect) {
    pendingNewSessionSelect = false;
    state.activeSessionId = bot.id;
    state.detailsOpen = true;
    $('workspace').classList.remove('details-hidden');
  }
  renderSidebar();
  renderChatHeader();
  renderDetails();
  updateServerCard();
});

socket.on('botUpdated', (bot) => {
  state.bots[bot.id] = { ...state.bots[bot.id], ...bot };
  renderSidebar();
  renderChatHeader();
  renderDetails();
  updateServerCard();
});

socket.on('botRemoved', ({ botId }) => {
  delete state.bots[botId];
  if (state.activeSessionId === botId) {
    state.activeSessionId = null;
    const connected = getConnectedBots();
    if (connected.length > 0) state.activeSessionId = connected[0].id;
  }
  renderAll();
});

socket.on('botState', ({ botId, state: newState }) => {
  if (state.bots[botId]) {
    state.bots[botId].state = newState;
    if (newState === 'connected' && !state.bots[botId].connectedAt) {
      state.bots[botId].connectedAt = Date.now();
    }
    if (newState === 'disconnected') {
      state.bots[botId].connectedAt = null;
    }
  }
  renderSidebar();
  renderChatHeader();
  renderDetails();
  updateServerCard();
  updateChatInputState();
});

socket.on('chat', (msg) => {
  const bot = state.bots[msg.botId];
  if (bot) {
    if (!bot.chatLog) bot.chatLog = [];
    bot.chatLog.push(msg);
    if (bot.chatLog.length > 300) bot.chatLog.shift();
  }
  if (msg.botId === state.activeSessionId) {
    appendChatMessage(msg);
  }
});

socket.on('stats', (stats) => {
  updateServerCard();
});

socket.on('players', ({ botId, players }) => {
  if (state.bots[botId]) state.bots[botId].players = players;
  updateServerCard();
  renderPlayerList();
});

socket.on('active-session:changed', ({ id }) => {
  state.activeSessionId = id;
  renderAll();
});

socket.on('session:metrics', ({ id, latency, uptime }) => {
  state.metrics[id] = { latency, uptime };
  // Update details panel live
  if (id === state.activeSessionId) {
    const latEl = $('detailLatency');
    const upEl = $('detailUptime');
    if (latEl) latEl.textContent = latency + 'ms';
    if (upEl) upEl.textContent = formatUptimeFull(uptime);
    // Update server card ping
    $('serverPing').textContent = latency + 'ms';
  }
  // Update sidebar session meta
  const metaEl = document.querySelector(`.session[data-id="${id}"] .session-meta`);
  if (metaEl) {
    const bot = state.bots[id];
    if (bot && bot.state === 'connected') {
      metaEl.textContent = formatUptime(uptime) + ' uptime';
    }
  }
});

socket.on('msaCode', ({ botId, code, uri }) => {
  if (state.bots[botId]) {
    state.bots[botId].msaCode = { code, uri };
  }
  if (botId === state.activeSessionId) renderDetails();
});

socket.on('serverFavicon', (favicon) => {
  state.serverFavicon = favicon;
  updateServerCard();
});

socket.on('settingsUpdated', (s) => {
  state.settings = s;
  showToast('Settings saved');
});

// ─────────── Render All ───────────
function renderAll() {
  renderSidebar();
  renderChatHeader();
  renderChatLog();
  renderDetails();
  updateServerCard();
  renderPlayerList();
  updateChatInputState();
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
        <button class="btn primary" onclick="createNewSession()">
          <i class="fa-solid fa-plus"></i> Add Session
        </button>
      </div>
    `;
    return;
  }

  let html = '';
  for (const bot of botEntries) {
    const isActive = bot.id === state.activeSessionId;
    const mcName = bot.connectedUsername || bot.label;
    const initial = (mcName[0] || '?').toUpperCase();
    const colorIdx = hashUsername(mcName);

    let dotClass = 'offline';
    if (bot.state === 'connected') dotClass = '';
    else if (bot.state === 'connecting') dotClass = 'idle';

    let meta = '';
    if (bot.state === 'connected' && bot.connectedAt) {
      const up = state.metrics[bot.id]?.uptime || (Date.now() - bot.connectedAt);
      meta = formatUptime(up) + ' uptime';
    } else if (bot.state === 'connecting') {
      meta = 'connecting...';
    } else {
      meta = 'offline';
    }
    if (isActive && bot.state === 'connected') meta += ' \u00B7 speaking';

    let badge = '';
    if (state.settings.aiEnabled !== false && bot.aiMode && bot.aiMode !== 'off') {
      badge = '<span class="badge ai">AI</span>';
    }

    const avatarUrl = `https://mc-heads.net/avatar/${encodeURIComponent(mcName)}/28`;
    html += `
      <div class="session ${isActive ? 'active' : ''}" data-id="${bot.id}" onclick="selectSession('${bot.id}')">
        <div class="session-avatar-wrap">
          <img class="session-avatar-img" src="${avatarUrl}" alt="" />
          <span class="dot ${dotClass}"></span>
        </div>
        <div class="session-info">
          <div class="session-name">${esc(bot.label)}</div>
          <div class="session-meta">${esc(meta)}</div>
        </div>
        ${badge}
      </div>
    `;
  }
  list.innerHTML = html;
}

function selectSession(id) {
  const bot = state.bots[id];
  if (!bot) return;
  if (bot.state === 'connected') {
    socket.emit('active-session:set', { id });
  }
  state.activeSessionId = id;
  renderAll();
}

// ─────────── Chat Header ───────────
function renderChatHeader() {
  const bot = getActiveBot() || (state.activeSessionId ? state.bots[state.activeSessionId] : null);
  const header = $('chatHeader');

  if (!bot) {
    $('speakingAs').innerHTML = '<div style="padding:8px;color:var(--text-tertiary);font-size:13px;">No active session</div>';
    $('chatActions').innerHTML = '';
    return;
  }

  const mcName = bot.connectedUsername || bot.label;
  const initial = (mcName[0] || '?').toUpperCase();
  const colorIdx = hashUsername(mcName);
  const uptime = state.metrics[bot.id]?.uptime || (bot.connectedAt ? Date.now() - bot.connectedAt : 0);
  const isConnected = bot.state === 'connected';

  const speakingHeadUrl = `https://mc-heads.net/avatar/${encodeURIComponent(mcName)}/40`;
  $('speakingAs').innerHTML = `
    <div class="avatar-lg" style="padding:0;overflow:hidden;">
      <img src="${speakingHeadUrl}" alt="" style="width:40px;height:40px;image-rendering:pixelated;display:block;" />
      ${isConnected ? '<span class="dot"></span>' : ''}
    </div>
    <div>
      <div class="speaking-label">Speaking as</div>
      <div class="speaking-name">
        ${esc(mcName)}
        ${isConnected ? `<span class="sub">\u00B7 ${formatUptime(uptime)} uptime</span>` : '<span class="sub">\u00B7 offline</span>'}
      </div>
    </div>
  `;

  // Desktop buttons
  let actions = '';
  if (getConnectedBots().length > 1) {
    actions += '<div style="position:relative;" class="desktop-only"><button class="btn" id="btnSwitch" onclick="toggleSwitchDropdown()"><i class="fa-solid fa-arrow-right-arrow-left"></i> Switch</button><div class="switch-dropdown" id="switchDropdown"></div></div>';
  }
  if (isConnected) {
    actions += `<button class="btn danger desktop-only" onclick="doDisconnect('${bot.id}')"><i class="fa-solid fa-power-off"></i> Disconnect</button>`;
  } else if (bot.state === 'disconnected') {
    actions += `<button class="btn primary" onclick="doConnect('${bot.id}')"><i class="fa-solid fa-plug"></i> Connect</button>`;
  }
  if (!state.detailsOpen) {
    actions += '<button class="btn desktop-only" onclick="toggleDetails()" title="Show details"><i class="fa-solid fa-table-columns"></i></button>';
  }

  // Mobile combined actions button
  let mobileDropdownItems = '';
  if (getConnectedBots().length > 1) {
    for (const b of getConnectedBots()) {
      const n = b.connectedUsername || b.label;
      const cur = b.id === state.activeSessionId ? ' (current)' : '';
      mobileDropdownItems += `<button class="btn" onclick="switchToSession('${b.id}');closeMobileActions();"><i class="fa-solid fa-arrow-right-arrow-left"></i> ${esc(n)}${cur}</button>`;
    }
  }
  if (isConnected) {
    mobileDropdownItems += `<button class="btn danger" onclick="doDisconnect('${bot.id}');closeMobileActions();"><i class="fa-solid fa-power-off"></i> Disconnect</button>`;
  }
  mobileDropdownItems += `<button class="btn" onclick="openMobileDetails();closeMobileActions();"><i class="fa-solid fa-circle-info"></i> Session Details</button>`;

  actions += `
    <div class="mobile-actions-wrap" style="position:relative;">
      <button class="btn" onclick="toggleMobileActions()"><i class="fa-solid fa-ellipsis-vertical"></i></button>
      <div class="mobile-actions-dropdown">${mobileDropdownItems}</div>
    </div>
  `;

  $('chatActions').innerHTML = actions;
}

function avatarGradient(idx) {
  const gradients = [
    '#64748b, #475569',
    '#0891b2, #0e7490',
    '#a855f7, #7e22ce',
    '#f59e0b, #d97706',
  ];
  return gradients[idx % 4];
}

function toggleSwitchDropdown() {
  const dd = $('switchDropdown');
  if (!dd) return;
  dd.classList.toggle('visible');
  if (dd.classList.contains('visible')) {
    let html = '';
    for (const bot of getConnectedBots()) {
      const mcName = bot.connectedUsername || bot.label;
      const initial = (mcName[0] || '?').toUpperCase();
      const isCurrent = bot.id === state.activeSessionId;
      html += `
        <div class="switch-item ${isCurrent ? 'current' : ''}" onclick="switchToSession('${bot.id}')">
          <div class="session-avatar ${avatarClass(hashUsername(mcName))}" style="width:24px;height:24px;font-size:10px;">${initial}</div>
          <span>${esc(mcName)}</span>
        </div>
      `;
    }
    dd.innerHTML = html;
    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', closeSwitchDropdown, { once: true });
    }, 0);
  }
}

function closeSwitchDropdown(e) {
  const dd = $('switchDropdown');
  if (dd) dd.classList.remove('visible');
}

function switchToSession(id) {
  socket.emit('active-session:set', { id });
  state.activeSessionId = id;
  renderAll();
}

// ─────────── Chat Log ───────────
function renderChatLog() {
  const bot = state.activeSessionId ? state.bots[state.activeSessionId] : null;
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
  let lastSender = '';
  let lastTs = 0;

  for (const msg of entries) {
    const ts = msg.ts || Date.now();
    const day = getDayLabel(ts);

    if (day !== lastDay) {
      html += `<div class="day-divider">${esc(day)}</div>`;
      lastDay = day;
      lastSender = '';
    }

    const type = msg.type || 'chat';
    if (type === 'join' || type === 'leave') {
      html += renderSystemLine(msg, type);
      lastSender = '';
    } else if (type === 'system' || type === 'error' || type === 'server') {
      html += renderSystemLine(msg, type);
      lastSender = '';
    } else {
      const grouped = msg.sender === lastSender && (ts - lastTs) < 300000;
      html += renderChatMessage(msg, bot, grouped);
      lastSender = msg.sender;
    }
    lastTs = ts;
  }

  log.innerHTML = html;
  log.scrollTop = log.scrollHeight;
}

function renderSystemLine(msg, type) {
  const time = formatTime(msg.ts || Date.now());
  let iconHtml = '';
  let lineClass = '';

  if (type === 'join') {
    iconHtml = '<i class="fa-solid fa-arrow-right-to-bracket"></i>';
    lineClass = 'join';
  } else if (type === 'leave') {
    iconHtml = '<i class="fa-solid fa-arrow-right-from-bracket"></i>';
    lineClass = 'leave';
  } else if (type === 'error') {
    iconHtml = '<i class="fa-solid fa-circle-exclamation"></i>';
    lineClass = 'leave';
  } else {
    iconHtml = '<i class="fa-solid fa-circle-info"></i>';
  }

  return `
    <div class="system-line ${lineClass}">
      <span class="time">${time}</span>
      <span class="sys-icon">${iconHtml}</span>
      <span>${esc(msg.message)}</span>
    </div>
  `;
}

function renderChatMessage(msg, bot, grouped) {
  const time = formatTime(msg.ts || Date.now());
  const sender = msg.sender || 'Unknown';
  const mcName = bot.connectedUsername || bot.label;
  const isSelf = msg.type === 'self' || msg.type === 'command' || sender === mcName;
  const isAi = msg.type === 'self' && bot.aiMode && bot.aiMode !== 'off' && sender === mcName;

  let msgClass = 'player';
  const headUrl = `https://mc-heads.net/avatar/${encodeURIComponent(sender)}/36`;
  let avatarHtml = `<img class="message-avatar" src="${headUrl}" alt="" />`;
  let authorExtra = '';

  if (isSelf && !isAi) {
    msgClass = 'me';
    avatarHtml = `<img class="message-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(mcName)}/36" alt="" />`;
  } else if (isAi) {
    msgClass = 'ai';
    const assistantName = bot.assistantName || 'Assistant';
    avatarHtml = '<div class="message-avatar"><i class="fa-solid fa-sparkles" style="font-size:12px;"></i></div>';
    authorExtra = `<span class="ai-pill">${esc(assistantName)}</span>`;
  }

  // Process message text for mentions and commands
  let text = esc(msg.message);
  text = text.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
  if (msg.type === 'command') {
    text = text.replace(/^(\/\w+)/, '<span class="code-inline">$1</span>');
  }

  return `
    <div class="message ${msgClass} ${grouped ? 'grouped' : ''}">
      ${avatarHtml}
      <div class="message-body">
        <div class="message-head">
          <span class="message-author">${esc(sender)}</span>
          ${authorExtra}
          <span class="message-time">${time}</span>
        </div>
        <div class="message-text">${text}</div>
      </div>
    </div>
  `;
}

function appendChatMessage(msg) {
  const log = $('chatLog');
  if (!log) return;
  const bot = state.bots[state.activeSessionId];
  if (!bot) return;

  const entries = bot.chatLog || [];
  const prevMsg = entries.length > 1 ? entries[entries.length - 2] : null;

  // Check if we need a day divider
  const ts = msg.ts || Date.now();
  const day = getDayLabel(ts);
  const lastChild = log.lastElementChild;
  const lastDay = lastChild?.classList.contains('day-divider') ? lastChild.textContent : null;

  if (!lastDay || (lastDay && lastDay !== day)) {
    // Check if last element was not already this day
    const existingDividers = log.querySelectorAll('.day-divider');
    const lastDivider = existingDividers[existingDividers.length - 1];
    if (!lastDivider || lastDivider.textContent !== day) {
      const div = document.createElement('div');
      div.className = 'day-divider';
      div.textContent = day;
      log.appendChild(div);
    }
  }

  const type = msg.type || 'chat';
  const tmp = document.createElement('div');

  if (['join', 'leave', 'system', 'error', 'server'].includes(type)) {
    tmp.innerHTML = renderSystemLine(msg, type);
  } else {
    const grouped = prevMsg && prevMsg.sender === msg.sender && (ts - (prevMsg.ts || 0)) < 300000;
    tmp.innerHTML = renderChatMessage(msg, bot, grouped);
  }

  while (tmp.firstChild) log.appendChild(tmp.firstChild);

  // Auto-scroll if near bottom
  const isNearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 100;
  if (isNearBottom) log.scrollTop = log.scrollHeight;
}

// ─────────── Details Panel ───────────
function renderDetails() {
  const bot = state.activeSessionId ? state.bots[state.activeSessionId] : null;
  const content = $('detailsContent');
  if (!content) return;

  if (!bot) {
    content.innerHTML = '<div class="empty-state" style="padding:40px 20px;"><p>Select a session to view details.</p></div>';
    return;
  }

  // Capture focus + selection + in-progress value of any input in the panel
  // so a re-render (triggered by botUpdated/botState) doesn't wipe what the
  // user is currently editing.
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

  const mcName = bot.connectedUsername || bot.label;
  const isConnected = bot.state === 'connected';
  const isConnecting = bot.state === 'connecting';
  const isDisconnected = bot.state === 'disconnected';
  const isMineflayer = (bot.botType || 'mineflayer') === 'mineflayer';
  const metrics = state.metrics[bot.id] || {};
  const uptime = metrics.uptime || (bot.connectedAt ? Date.now() - bot.connectedAt : 0);
  const aiEnabled = state.settings.aiEnabled !== false;
  // Connection params are locked while connected/connecting — server-side
  // update_bot only applies them when state === "disconnected".
  const lockedAttr = isDisconnected ? '' : 'disabled';
  const lockedNote = isDisconnected ? '' : '<div class="field-note">Disconnect the session to edit connection settings.</div>';
  const breaks = bot.breaks || { enabled: false, checkIntervalMinutes: 30, chancePercent: 10, minMinutes: 5, maxMinutes: 20, minIntervalHours: 3, forcedDurationMinutes: 10 };
  const breakReturnAt = bot.onBreak && bot.breakUntil
    ? new Date(bot.breakUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  const lastBreakLabel = bot.lastBreakAt
    ? formatRelativeAgo(bot.lastBreakAt)
    : 'Never';

  // Tab system: "Controls" surfaces the things you actually touch day-to-day
  // (status, toggles, AI mode, restart/remove). "Setup" hides the one-time
  // config (identity, server credentials, schedule) so it doesn't clutter
  // the panel after initial setup.
  const tab = state.detailsTab === 'setup' ? 'setup' : 'controls';

  const controlsTab = `
    <div class="details-section">
      <h4>Connection</h4>
      ${breakReturnAt ? `<div class="break-banner"><i class="fa-solid fa-mug-hot"></i> On a break \u2014 returning around ${breakReturnAt}</div>` : ''}
      <div class="info-grid">
        <div class="info-row">
          <span class="label">Status</span>
          <span class="value ${isConnected ? 'success' : ''}">${isConnected ? '\u25CF Connected' : isConnecting ? '\u25CF Connecting' : breakReturnAt ? '\u25CB On break' : '\u25CB Disconnected'}</span>
        </div>
        <div class="info-row"><span class="label">Uptime</span><span class="value" id="detailUptime">${isConnected ? formatUptimeFull(uptime) : '--'}</span></div>
        <div class="info-row"><span class="label">Latency</span><span class="value" id="detailLatency">${metrics.latency ? metrics.latency + 'ms' : '--'}</span></div>
        ${isMineflayer ? `<div class="info-row"><span class="label">MC Username</span><span class="value">${esc(mcName)}</span></div>` : ''}
        ${bot.detectedVersion ? `<div class="info-row"><span class="label">Detected</span><span class="value">${esc(bot.detectedVersion)}</span></div>` : ''}
        ${breaks.enabled || bot.lastBreakAt ? `<div class="info-row"><span class="label">Last Break</span><span class="value">${esc(lastBreakLabel)}</span></div>` : ''}
      </div>
    </div>

    <div class="details-section">
      <h4>Behavior</h4>
      <div class="toggle-row">
        <div class="toggle-info">
          <div class="toggle-title">Auto-reconnect</div>
          <div class="toggle-desc">Re-join automatically if the session drops.</div>
        </div>
        <div class="toggle ${bot.autoReconnect ? 'on' : ''}" data-field="autoReconnect" onclick="toggleBehavior('${bot.id}', 'autoReconnect', this)"></div>
      </div>
      <div class="toggle-row">
        <div class="toggle-info">
          <div class="toggle-title">Anti-AFK</div>
          <div class="toggle-desc">Move periodically to prevent idle kicks.</div>
        </div>
        <div class="toggle ${bot.antiAfk ? 'on' : ''}" data-field="antiAfk" onclick="toggleBehavior('${bot.id}', 'antiAfk', this)"></div>
      </div>
      ${aiEnabled ? `<div style="padding-top:12px;border-top:1px solid var(--border);">
        <label style="font-size:10px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;display:block;">AI Mode</label>
        <div class="ai-mode-selector" style="display:flex;flex-direction:column;gap:4px;">
          <label class="ai-mode-option" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:var(--radius-sm);cursor:pointer;transition:background 0.15s;${bot.aiMode === 'off' ? 'background:var(--bg-elev-2);' : ''}" onclick="setAiMode('${bot.id}', 'off')">
            <input type="radio" name="aiMode_${bot.id}" value="off" ${bot.aiMode === 'off' ? 'checked' : ''} style="accent-color:var(--accent);margin:0;" />
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:600;color:var(--text);">Off</div>
              <div style="font-size:11px;color:var(--text-tertiary);">No AI responses.</div>
            </div>
          </label>
          <label class="ai-mode-option" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:var(--radius-sm);cursor:pointer;transition:background 0.15s;${bot.aiMode === 'admin-afk' ? 'background:var(--bg-elev-2);' : ''}" onclick="setAiMode('${bot.id}', 'admin-afk')">
            <input type="radio" name="aiMode_${bot.id}" value="admin-afk" ${bot.aiMode === 'admin-afk' ? 'checked' : ''} style="accent-color:var(--accent);margin:0;" />
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:600;color:var(--text);">AFK Responder</div>
              <div style="font-size:11px;color:var(--text-tertiary);">Tells players you're AFK when mentioned.</div>
            </div>
          </label>
          <label class="ai-mode-option" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:var(--radius-sm);cursor:pointer;transition:background 0.15s;${bot.aiMode === 'support' ? 'background:var(--bg-elev-2);' : ''}" onclick="setAiMode('${bot.id}', 'support')">
            <input type="radio" name="aiMode_${bot.id}" value="support" ${bot.aiMode === 'support' ? 'checked' : ''} style="accent-color:var(--accent);margin:0;" />
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:600;color:var(--text);">Support Bot</div>
              <div style="font-size:11px;color:var(--text-tertiary);">Answers server questions via @mention.</div>
            </div>
          </label>
          <label class="ai-mode-option" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:var(--radius-sm);cursor:pointer;transition:background 0.15s;${bot.aiMode === 'disguise' ? 'background:var(--bg-elev-2);' : ''}" onclick="setAiMode('${bot.id}', 'disguise')">
            <input type="radio" name="aiMode_${bot.id}" value="disguise" ${bot.aiMode === 'disguise' ? 'checked' : ''} style="accent-color:var(--accent);margin:0;" />
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:600;color:var(--text);">Player Disguise</div>
              <div style="font-size:11px;color:var(--text-tertiary);">Acts like a real player. Casual chat, greetings.</div>
            </div>
          </label>
        </div>
      </div>
      ${bot.aiMode === 'support' ? `
      <div style="padding-top:10px;">
        <label style="font-size:10px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.08em;">Assistant Name</label>
        <input class="assistant-name-input" type="text" data-field="assistantName" value="${esc(bot.assistantName || 'Assistant')}"
          onchange="updateAssistantName('${bot.id}', this.value)" placeholder="Assistant" />
      </div>
      ` : ''}` : ''}
    </div>

    <div class="details-section">
      <h4>Manage</h4>
      <div class="danger-zone">
        <button class="btn" onclick="doRestart('${bot.id}')"><i class="fa-solid fa-rotate-right"></i> Restart Session</button>
        <button class="btn danger" onclick="confirmRemove('${bot.id}')"><i class="fa-solid fa-trash"></i> Remove Session</button>
      </div>
    </div>
  `;

  const setupTab = `
    <div class="details-section">
      <h4>Identity</h4>
      <div class="field">
        <label>Label</label>
        <input type="text" data-field="label" value="${esc(bot.label || '')}"
          onchange="updateSessionField('${bot.id}', 'label', this.value.trim())"
          placeholder="Display name" />
      </div>
      <div class="field">
        <label>Bot Type</label>
        <select data-field="botType" ${lockedAttr}
          onchange="updateSessionField('${bot.id}', 'botType', this.value)">
          <option value="mineflayer" ${isMineflayer ? 'selected' : ''}>Minecraft Account (Mineflayer)</option>
          <option value="bridge" ${!isMineflayer ? 'selected' : ''}>Virtual Player (CobbleBridge)</option>
        </select>
        <div class="field-note">${isMineflayer ? 'Connects using a real Minecraft account.' : 'Virtual player via CobbleBridge plugin. No MC account needed.'}</div>
      </div>
    </div>

    ${isMineflayer ? `
    <div class="details-section">
      <h4>Server</h4>
      <div class="field">
        <label>Microsoft Email</label>
        <input type="text" data-field="username" value="${esc(bot.username || '')}" ${lockedAttr}
          onchange="updateSessionField('${bot.id}', 'username', this.value.trim())"
          placeholder="email@outlook.com" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>Host</label>
          <input type="text" data-field="host" value="${esc(bot.host || '')}" ${lockedAttr}
            onchange="updateSessionField('${bot.id}', 'host', this.value.trim())"
            placeholder="play.example.net" />
        </div>
        <div class="field">
          <label>Port</label>
          <input type="text" data-field="port" value="${esc(String(bot.port || 25565))}" ${lockedAttr}
            onchange="updateSessionField('${bot.id}', 'port', this.value.trim() || '25565')" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Auth Type</label>
          <input type="text" data-field="auth" value="${esc(bot.auth || 'microsoft')}" ${lockedAttr}
            onchange="updateSessionField('${bot.id}', 'auth', this.value.trim() || 'microsoft')" />
        </div>
        <div class="field">
          <label>Version</label>
          <input type="text" data-field="version" value="${esc(bot.version || '')}" ${lockedAttr}
            onchange="updateSessionField('${bot.id}', 'version', this.value.trim())"
            placeholder="${esc(bot.detectedVersion || 'auto-detect')}" />
        </div>
      </div>
      ${lockedNote}
    </div>
    ` : ''}

    <div class="details-section">
      <h4>Schedule</h4>
      <div class="field">
        <label>Mode</label>
        <select data-field="mode" onchange="updateSessionField('${bot.id}', 'mode', this.value)">
          <option value="manual" ${bot.mode === 'manual' ? 'selected' : ''}>Manual</option>
          <option value="permanent" ${bot.mode === 'permanent' ? 'selected' : ''}>Permanent (always online)</option>
          <option value="scheduled" ${bot.mode === 'scheduled' ? 'selected' : ''}>Scheduled</option>
        </select>
        <div class="field-note">${bot.mode === 'manual' ? 'You control connect/disconnect manually.' : bot.mode === 'permanent' ? 'Auto-connects and reconnects on disconnect.' : 'Connects and disconnects at the times below.'}</div>
      </div>
      ${bot.mode === 'scheduled' ? `
      <div class="field-row">
        <div class="field">
          <label>Connect At</label>
          <input type="time" data-field="scheduleStart" value="${esc(bot.schedule?.start || '00:00')}"
            onchange="updateScheduleField('${bot.id}', 'start', this.value)" />
        </div>
        <div class="field">
          <label>Disconnect At</label>
          <input type="time" data-field="scheduleEnd" value="${esc(bot.schedule?.end || '08:00')}"
            onchange="updateScheduleField('${bot.id}', 'end', this.value)" />
        </div>
      </div>
      <div class="field">
        <label>Timezone</label>
        <input type="text" list="tzList" data-field="scheduleTz"
          value="${esc(bot.schedule?.tz || getBrowserTimezone())}"
          placeholder="${esc(getBrowserTimezone())}"
          onchange="updateScheduleField('${bot.id}', 'tz', this.value.trim() || getBrowserTimezone())" />
      </div>
      <div class="field-note">Times in your local 12-hour format. Schedule wraps midnight.</div>
      ` : ''}
    </div>

    <div class="details-section">
      <h4>Breaks</h4>
      <div class="toggle-row">
        <div class="toggle-info">
          <div class="toggle-title">Take random breaks</div>
          <div class="toggle-desc">Periodically rolls a chance to disconnect for a random duration — simulates stepping away.</div>
        </div>
        <div class="toggle ${breaks.enabled ? 'on' : ''}" data-field="breaksEnabled" onclick="toggleBreaks('${bot.id}', this)"></div>
      </div>
      ${breaks.enabled ? `
      <div class="field-row" style="margin-top:12px;">
        <div class="field">
          <label>Check Every (min)</label>
          <input type="number" min="1" max="240" data-field="breaksCheckInterval"
            value="${esc(String(breaks.checkIntervalMinutes ?? 30))}"
            onchange="updateBreakField('${bot.id}', 'checkIntervalMinutes', this.value)" />
        </div>
        <div class="field">
          <label>Chance (%)</label>
          <input type="number" min="0" max="100" data-field="breaksChance"
            value="${esc(String(breaks.chancePercent ?? 10))}"
            onchange="updateBreakField('${bot.id}', 'chancePercent', this.value)" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Min Length (min)</label>
          <input type="number" min="1" max="1440" data-field="breaksMin"
            value="${esc(String(breaks.minMinutes ?? 5))}"
            onchange="updateBreakField('${bot.id}', 'minMinutes', this.value)" />
        </div>
        <div class="field">
          <label>Max Length (min)</label>
          <input type="number" min="1" max="1440" data-field="breaksMax"
            value="${esc(String(breaks.maxMinutes ?? 20))}"
            onchange="updateBreakField('${bot.id}', 'maxMinutes', this.value)" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Force After (hr)</label>
          <input type="number" min="0" max="48" data-field="breaksMinInterval"
            value="${esc(String(breaks.minIntervalHours ?? 3))}"
            onchange="updateBreakField('${bot.id}', 'minIntervalHours', this.value)" />
        </div>
        <div class="field">
          <label>Forced Length (min)</label>
          <input type="number" min="1" max="240" data-field="breaksForcedDuration"
            value="${esc(String(breaks.forcedDurationMinutes ?? 10))}"
            onchange="updateBreakField('${bot.id}', 'forcedDurationMinutes', this.value)" />
        </div>
      </div>
      <div class="field-note">Every ${breaks.checkIntervalMinutes ?? 30} min while connected, ${breaks.chancePercent ?? 10}% chance to take a ${breaks.minMinutes ?? 5}–${breaks.maxMinutes ?? 20} min break. If no break happens within ${breaks.minIntervalHours ?? 3}h, the next check forces a ${breaks.forcedDurationMinutes ?? 10} min break. Set "Force After" to 0 to disable the floor. Auto-reconnect is paused during breaks. In scheduled mode, breaks that end outside the window stay disconnected until the window reopens.</div>
      ` : ''}
    </div>
  `;

  content.innerHTML = `
    <div class="details-tabs" role="tablist">
      <button class="details-tab ${tab === 'controls' ? 'active' : ''}" role="tab"
        onclick="setDetailsTab('controls')">Controls</button>
      <button class="details-tab ${tab === 'setup' ? 'active' : ''}" role="tab"
        onclick="setDetailsTab('setup')">Setup</button>
    </div>
    ${tab === 'controls' ? controlsTab : setupTab}
  `;

  // Restore focus + cursor + in-progress value if the user was mid-edit.
  if (focusKey) {
    const el = content.querySelector(`[data-field="${focusKey}"]`);
    if (el) {
      if (focusValue !== null && 'value' in el && el.tagName !== 'SELECT') {
        el.value = focusValue;
      }
      el.focus();
      if (selStart !== null && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(selStart, selEnd); } catch (_) {}
      }
    }
  }
}

function setDetailsTab(tab) {
  if (tab !== 'controls' && tab !== 'setup') return;
  if (state.detailsTab === tab) return;
  state.detailsTab = tab;
  renderDetails();
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 Session field updates (inline in details panel) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function updateSessionField(id, field, value) {
  const bot = state.bots[id];
  if (!bot) return;
  if (field === 'port') {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) { showToast('Invalid port', 'warn'); return; }
    value = n;
  }
  // Optimistic local update so dependent UI (bot-type fields, mode hint,
  // scheduled time inputs) renders immediately without waiting for the
  // server round-trip. The canonical server value arrives via botUpdated.
  bot[field] = value;
  socket.emit('update_bot', { id, [field]: value });
  renderDetails();
  renderSidebar();
}

function updateScheduleField(id, key, value) {
  const bot = state.bots[id];
  if (!bot) return;
  const schedule = { ...(bot.schedule || { start: '00:00', end: '08:00' }) };
  schedule[key] = value;
  bot.schedule = schedule;
  socket.emit('update_bot', { id, schedule });
}

function defaultBreaks() {
  return { enabled: false, checkIntervalMinutes: 30, chancePercent: 10, minMinutes: 5, maxMinutes: 20, minIntervalHours: 3, forcedDurationMinutes: 10 };
}

function toggleBreaks(id, el) {
  const bot = state.bots[id];
  if (!bot) return;
  const breaks = { ...(bot.breaks || defaultBreaks()) };
  breaks.enabled = !breaks.enabled;
  bot.breaks = breaks;
  el.classList.toggle('on', breaks.enabled);
  socket.emit('update_bot', { id, breaks });
  renderDetails();
}

function updateBreakField(id, key, value) {
  const bot = state.bots[id];
  if (!bot) return;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) { showToast('Invalid number', 'warn'); return; }
  const breaks = { ...(bot.breaks || defaultBreaks()) };
  breaks[key] = n;
  // Keep min <= max coherent so we never roll a negative range server-side.
  if (key === 'minMinutes' && breaks.maxMinutes != null && n > breaks.maxMinutes) breaks.maxMinutes = n;
  if (key === 'maxMinutes' && breaks.minMinutes != null && n < breaks.minMinutes) breaks.minMinutes = n;
  bot.breaks = breaks;
  socket.emit('update_bot', { id, breaks });
  renderDetails();
}

function createNewSession() {
  const defaults = {
    label: 'New Session',
    botType: 'mineflayer',
    username: '',
    host: state.settings.defaultHost || 'play.example.net',
    port: state.settings.defaultPort || '25565',
    auth: 'microsoft',
    version: '',
    mode: 'manual',
    aiMode: 'off',
    schedule: { start: '00:00', end: '08:00' },
  };
  pendingNewSessionSelect = true;
  socket.emit('add_bot', defaults);
}

function toggleBehavior(id, field, el) {
  const isOn = el.classList.contains('on');
  el.classList.toggle('on');
  socket.emit('session:behavior:update', { id, field, value: !isOn });
}

function setAiMode(id, mode) {
  socket.emit('session:behavior:update', { id, field: 'aiMode', value: mode });
  // Update local state immediately so re-render shows assistant name field
  if (state.bots[id]) state.bots[id].aiMode = mode;
  renderDetails();
  renderSidebar();
}

function updateAssistantName(id, value) {
  socket.emit('session:behavior:update', { id, field: 'assistantName', value: value.trim() || 'Assistant' });
}

function toggleDetails() {
  state.detailsOpen = !state.detailsOpen;
  $('workspace').classList.toggle('details-hidden', !state.detailsOpen);
  renderChatHeader();
}

$('btnCloseDetails').addEventListener('click', () => {
  state.detailsOpen = false;
  $('workspace').classList.add('details-hidden');
  renderChatHeader();
});

// ─────────── Server Card ───────────
function updateServerCard() {
  const bots = Object.values(state.bots);
  const connected = bots.filter(b => b.state === 'connected');
  const active = getActiveBot();

  const sName = state.settings.serverName || 'Server';
  const iconEl = $('serverIcon');
  if (state.serverFavicon) {
    iconEl.innerHTML = `<img src="${state.serverFavicon}" alt="" style="width:28px;height:28px;border-radius:6px;image-rendering:pixelated;display:block;" />`;
  }
  const sHost = state.settings.defaultHost || (active ? active.host : bots.length > 0 ? bots[0].host : '--');
  $('serverName').textContent = sName;
  $('serverAddr').textContent = sHost;

  if (connected.length > 0) {
    $('serverStatus').innerHTML = '<span class="live"></span>Online';
  } else {
    $('serverStatus').textContent = 'Offline';
  }

  // Total players across all connected bots (deduplicated)
  const playerSet = new Set();
  for (const bot of connected) {
    for (const p of (bot.players || [])) playerSet.add(p.username);
  }
  $('serverPlayers').textContent = playerSet.size;
  $('serverSessions').textContent = connected.length + ' / ' + bots.length;

  const m = active ? state.metrics[active.id] : null;
  $('serverPing').textContent = m ? m.latency + 'ms' : '--';
}

// ─────────── Player List ───────────
function renderPlayerList() {
  const section = $('playerListSection');
  const list = $('playerList');
  const countEl = $('playerListCount');

  // Gather unique players across all connected bots
  const playerMap = new Map();
  for (const bot of Object.values(state.bots)) {
    if (bot.state !== 'connected') continue;
    for (const p of (bot.players || [])) {
      if (!playerMap.has(p.username)) playerMap.set(p.username, p);
    }
  }

  const players = Array.from(playerMap.values()).sort((a, b) => a.username.localeCompare(b.username));

  if (players.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  countEl.textContent = players.length;

  list.innerHTML = players.map(p => `
    <div class="player-item">
      <img src="https://mc-heads.net/avatar/${encodeURIComponent(p.username)}/20" alt="" />
      <span>${esc(p.username)}</span>
      ${p.ping ? `<span class="player-ping">${p.ping}ms</span>` : ''}
    </div>
  `).join('');
}

// ─────────── Chat Input ───────────
function updateChatInputState() {
  const bot = getActiveBot();
  const input = $('chatInput');
  const send = $('btnSend');
  if (bot && bot.state === 'connected') {
    const mcName = bot.connectedUsername || bot.label;
    input.disabled = false;
    input.placeholder = `Message as ${mcName}\u2026`;
    send.disabled = false;
  } else {
    input.disabled = true;
    input.placeholder = state.activeSessionId ? 'Session is not connected' : 'Select a session to chat...';
    send.disabled = true;
  }
}

function sendChat() {
  const input = $('chatInput');
  const msg = input.value.trim();
  if (!msg || !state.activeSessionId) return;
  socket.emit('send_chat', { botId: state.activeSessionId, message: msg });
  input.value = '';
  hideSlashPopup();
}

$('btnSend').addEventListener('click', sendChat);
$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { sendChat(); e.preventDefault(); }
  if (e.key === 'Escape') hideSlashPopup();
});

// ─────────── Slash Command Popup ───────────
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
  if (val === '/') {
    showSlashPopup('');
  } else if (val.startsWith('/')) {
    showSlashPopup(val.slice(1));
  } else {
    hideSlashPopup();
  }
});

function showSlashPopup(filter) {
  const popup = $('slashPopup');
  const filtered = SLASH_COMMANDS.filter(c =>
    c.cmd.toLowerCase().includes(filter.toLowerCase()) || c.desc.toLowerCase().includes(filter.toLowerCase())
  );
  if (filtered.length === 0) { hideSlashPopup(); return; }

  popup.innerHTML = filtered.map(c => `
    <div class="slash-item" onclick="insertSlashCommand('${c.cmd}')">
      <span class="slash-cmd">${esc(c.cmd)}</span>
      <span class="slash-desc">${esc(c.desc)}</span>
    </div>
  `).join('');
  popup.classList.add('visible');
}

function hideSlashPopup() {
  $('slashPopup').classList.remove('visible');
}

function insertSlashCommand(cmd) {
  $('chatInput').value = cmd + ' ';
  $('chatInput').focus();
  hideSlashPopup();
}

// ─────────── Actions ───────────
function doConnect(id) {
  socket.emit('connect_bot', id);
}
function doDisconnect(id) {
  socket.emit('disconnect_bot', id);
}
function doRestart(id) {
  socket.emit('session:restart', id);
  showToast('Restarting session...');
}
function confirmRemove(id) {
  const bot = state.bots[id];
  showConfirm('Remove Session', `Are you sure you want to remove "${bot?.label || id}"? This cannot be undone.`, () => {
    socket.emit('session:remove', id);
    showToast('Session removed');
  });
}

// ─────────── Confirm Modal ───────────
function showConfirm(title, message, callback) {
  $('confirmTitle').textContent = title;
  $('confirmMessage').textContent = message;
  confirmCallback = callback;
  $('confirmModalOverlay').classList.add('visible');
}

$('btnConfirmOk').addEventListener('click', () => {
  $('confirmModalOverlay').classList.remove('visible');
  if (confirmCallback) confirmCallback();
  confirmCallback = null;
});
$('btnConfirmCancel').addEventListener('click', () => {
  $('confirmModalOverlay').classList.remove('visible');
  confirmCallback = null;
});
$('confirmModalOverlay').addEventListener('click', (e) => {
  if (e.target === $('confirmModalOverlay')) {
    $('confirmModalOverlay').classList.remove('visible');
    confirmCallback = null;
  }
});

$('btnAddSession').addEventListener('click', createNewSession);

// ─────────── Settings Modal ───────────
function updateAiSettingsVisibility() {
  const enabled = state.settings.aiEnabled !== false;
  // Settings tabs
  document.querySelectorAll('.settings-tab[data-tab="ai"], .settings-tab[data-tab="prompts"]').forEach(el => {
    el.style.display = enabled ? '' : 'none';
  });
  // If currently on a hidden tab, switch to general
  if (!enabled) {
    const activeTab = document.querySelector('.settings-tab.active');
    if (activeTab && (activeTab.dataset.tab === 'ai' || activeTab.dataset.tab === 'prompts')) {
      activeTab.classList.remove('active');
      document.querySelector('.settings-tab[data-tab="general"]').classList.add('active');
      document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
      document.querySelector('.settings-pane[data-pane="general"]').classList.add('active');
    }
  }
}

function openSettingsModal() {
  const s = state.settings;
  // AI toggle
  const aiToggle = $('sAiEnabledToggle');
  aiToggle.classList.toggle('on', s.aiEnabled !== false);
  aiToggle.onclick = () => {
    aiToggle.classList.toggle('on');
    state.settings.aiEnabled = aiToggle.classList.contains('on');
    updateAiSettingsVisibility();
  };
  updateAiSettingsVisibility();
  $('sMaintenanceEnabled').checked = s.maintenance?.enabled ?? true;
  $('sMaintenanceStart').value = s.maintenance?.start || '01:59';
  $('sMaintenanceEnd').value = s.maintenance?.end || '02:05';
  $('sReconnectBase').value = s.reconnect?.baseDelay ?? 10;
  $('sReconnectMax').value = s.reconnect?.maxDelay ?? 120;
  $('sReconnectRetries').value = s.reconnect?.maxRetries ?? 20;
  $('sServerName').value = s.serverName || '';
  $('sDefaultHost').value = s.defaultHost || '';
  $('sDefaultPort').value = s.defaultPort || '25565';
  $('sAiApiKey').value = s.ai?.apiKey || '';
  $('sAiModel').value = s.ai?.model || 'claude-haiku-4-5-20251001';
  $('sAiCooldown').value = s.ai?.cooldownSeconds ?? 15;
  $('sAiResponseDelay').value = s.ai?.responseDelayMs ?? 2000;
  $('sAiServerInfo').value = s.ai?.serverInfo || '';
  $('sAiAdminPrompt').value = s.ai?.adminAfkPrompt || state.defaultPrompts.adminAfk || '';
  $('sAiSupportPrompt').value = s.ai?.supportPrompt || state.defaultPrompts.support || '';
  $('sAiDisguisePrompt').value = s.ai?.disguisePrompt || state.defaultPrompts.disguise || '';
  $('sBridgeUrl').value = s.bridge?.pluginUrl || 'http://localhost:3101';
  $('sBridgeSecret').value = s.bridge?.secret || 'changeme';
  $('sBridgeDiscord').value = s.bridge?.discordWebhook || '';
  $('sOwnerUsername').value = s.ownerUsername || '';
  $('settingsPage').style.display = 'grid';
}

function closeSettingsModal() {
  $('settingsPage').style.display = 'none';
}

function saveSettingsModal() {
  socket.emit('update_settings', {
    maintenance: {
      enabled: $('sMaintenanceEnabled').checked,
      start: $('sMaintenanceStart').value,
      end: $('sMaintenanceEnd').value,
    },
    reconnect: {
      baseDelay: parseInt($('sReconnectBase').value, 10) || 10,
      maxDelay: parseInt($('sReconnectMax').value, 10) || 120,
      maxRetries: parseInt($('sReconnectRetries').value, 10) || 20,
    },
    aiEnabled: $('sAiEnabledToggle').classList.contains('on'),
    serverName: $('sServerName').value.trim(),
    defaultHost: $('sDefaultHost').value.trim(),
    defaultPort: $('sDefaultPort').value.trim(),
    ai: {
      apiKey: $('sAiApiKey').value.trim(),
      model: $('sAiModel').value.trim(),
      cooldownSeconds: parseInt($('sAiCooldown').value, 10) || 15,
      responseDelayMs: parseInt($('sAiResponseDelay').value, 10) || 2000,
      serverInfo: $('sAiServerInfo').value,
      adminAfkPrompt: $('sAiAdminPrompt').value,
      supportPrompt: $('sAiSupportPrompt').value,
      disguisePrompt: $('sAiDisguisePrompt').value,
    },
    bridge: {
      pluginUrl: $('sBridgeUrl').value.trim(),
      secret: $('sBridgeSecret').value.trim(),
      discordWebhook: $('sBridgeDiscord').value.trim(),
    },
    ownerUsername: $('sOwnerUsername').value.trim(),
  });
  closeSettingsModal();
}

$('btnSettings').addEventListener('click', openSettingsModal);
$('btnSettingsBack').addEventListener('click', closeSettingsModal);
$('btnSettingsCancel').addEventListener('click', closeSettingsModal);
$('btnSettingsSave').addEventListener('click', saveSettingsModal);

// Settings tabs
document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const pane = document.querySelector(`.settings-pane[data-pane="${tab.dataset.tab}"]`);
    if (pane) pane.classList.add('active');
  });
});

// ─────────── Command Palette (Cmd+K) ───────────
const COMMANDS = [
  { label: 'Toggle theme', icon: 'fa-solid fa-circle-half-stroke', hint: '', action: () => setTheme(state.theme === 'dark' ? 'light' : 'dark') },
  { label: 'Disconnect all', icon: 'fa-solid fa-power-off', hint: '', action: () => { socket.emit('disconnect_all'); showToast('Disconnecting all...'); } },
  { label: 'Restart active session', icon: 'fa-solid fa-rotate-right', hint: '', action: () => { if (state.activeSessionId) doRestart(state.activeSessionId); } },
  { label: 'Settings', icon: 'fa-solid fa-gear', hint: '', action: openSettingsModal },
  { label: 'Add session', icon: 'fa-solid fa-plus', hint: '', action: createNewSession },
];

function getCommandList() {
  const commands = [];
  // Session switching
  for (const bot of getConnectedBots()) {
    const name = bot.connectedUsername || bot.label;
    commands.push({
      label: `Switch to ${name}`,
      icon: 'fa-solid fa-arrow-right-arrow-left',
      hint: bot.id === state.activeSessionId ? 'current' : '',
      action: () => switchToSession(bot.id),
    });
  }
  commands.push(...COMMANDS);
  return commands;
}

let cmdSelectedIdx = 0;

function openCommandPalette() {
  $('cmdPaletteInput').value = '';
  cmdSelectedIdx = 0;
  renderCommandList('');
  $('cmdPaletteOverlay').classList.add('visible');
  setTimeout(() => $('cmdPaletteInput').focus(), 50);
}

function closeCommandPalette() {
  $('cmdPaletteOverlay').classList.remove('visible');
}

function renderCommandList(filter) {
  const commands = getCommandList();
  const filtered = filter
    ? commands.filter(c => c.label.toLowerCase().includes(filter.toLowerCase()))
    : commands;

  cmdSelectedIdx = Math.min(cmdSelectedIdx, Math.max(0, filtered.length - 1));

  $('cmdPaletteList').innerHTML = filtered.map((c, i) => `
    <div class="command-item ${i === cmdSelectedIdx ? 'selected' : ''}" data-idx="${i}" onmouseenter="cmdSelectedIdx=${i};renderCommandList('${esc(filter)}')" onclick="executeCommand(${i}, '${esc(filter)}')">
      <div class="cmd-icon"><i class="${c.icon}"></i></div>
      <span class="cmd-label">${esc(c.label)}</span>
      ${c.hint ? `<span class="cmd-hint">${esc(c.hint)}</span>` : ''}
    </div>
  `).join('');
}

function executeCommand(idx, filter) {
  const commands = getCommandList();
  const filtered = filter
    ? commands.filter(c => c.label.toLowerCase().includes(filter.toLowerCase()))
    : commands;
  if (filtered[idx]) {
    closeCommandPalette();
    filtered[idx].action();
  }
}

$('cmdPaletteBtn').addEventListener('click', openCommandPalette);
$('cmdPaletteOverlay').addEventListener('click', (e) => {
  if (e.target === $('cmdPaletteOverlay')) closeCommandPalette();
});

$('cmdPaletteInput').addEventListener('input', (e) => {
  cmdSelectedIdx = 0;
  renderCommandList(e.target.value);
});

$('cmdPaletteInput').addEventListener('keydown', (e) => {
  const filter = $('cmdPaletteInput').value;
  const commands = getCommandList();
  const filtered = filter
    ? commands.filter(c => c.label.toLowerCase().includes(filter.toLowerCase()))
    : commands;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    cmdSelectedIdx = Math.min(cmdSelectedIdx + 1, filtered.length - 1);
    renderCommandList(filter);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    cmdSelectedIdx = Math.max(cmdSelectedIdx - 1, 0);
    renderCommandList(filter);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    executeCommand(cmdSelectedIdx, filter);
  } else if (e.key === 'Escape') {
    closeCommandPalette();
  }
});

// Global keyboard shortcut
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    if ($('cmdPaletteOverlay').classList.contains('visible')) {
      closeCommandPalette();
    } else {
      openCommandPalette();
    }
  }
  if (e.key === 'Escape') {
    if ($('cmdPaletteOverlay').classList.contains('visible')) closeCommandPalette();
  }
});

// ─────────── Mobile sidebar / details drawers ───────────
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

$('btnMobileSidebar').addEventListener('click', openMobileSidebar);
$('sidebarOverlay').addEventListener('click', closeMobileSidebar);
$('btnMobileDetails').addEventListener('click', openMobileDetails);
$('detailsOverlay').addEventListener('click', closeMobileDetails);

// Close mobile sidebar when selecting a session
const origSelectSession = selectSession;
selectSession = function(id) {
  origSelectSession(id);
  closeMobileSidebar();
};

// ─────────── Mobile actions dropdown ───────────
function toggleMobileActions() {
  const dd = document.querySelector('.mobile-actions-dropdown');
  if (dd) dd.classList.toggle('visible');
}

function closeMobileActions() {
  const dd = document.querySelector('.mobile-actions-dropdown');
  if (dd) dd.classList.remove('visible');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.mobile-actions-wrap')) closeMobileActions();
});

// ─────────── Uptime ticker ───────────
setInterval(() => {
  // Update speaking-as uptime in header
  const bot = getActiveBot();
  if (bot && bot.connectedAt) {
    const uptime = state.metrics[bot.id]?.uptime || (Date.now() - bot.connectedAt);
    const sub = document.querySelector('.speaking-name .sub');
    if (sub) sub.textContent = '\u00B7 ' + formatUptime(uptime) + ' uptime';
  }
}, 1000);
