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
  theme: document.documentElement.getAttribute('data-theme') || 'dark',
};

let editingBotId = null;
let confirmCallback = null;
let uptimeInterval = null;

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
  renderSidebar();
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
        <button class="btn primary" onclick="openAddModal()">
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

  const mcName = bot.connectedUsername || bot.label;
  const isConnected = bot.state === 'connected';
  const metrics = state.metrics[bot.id] || {};
  const uptime = metrics.uptime || (bot.connectedAt ? Date.now() - bot.connectedAt : 0);

  content.innerHTML = `
    <div class="details-section">
      <h4>Account</h4>
      <div class="info-grid">
        <div class="info-row"><span class="label">Username</span><span class="value">${esc(mcName)}</span></div>
        <div class="info-row"><span class="label">Email</span><span class="value">${esc(bot.username || '--')}</span></div>
        <div class="info-row"><span class="label">Auth</span><span class="value">${esc(bot.auth || 'microsoft')}</span></div>
        <div class="info-row"><span class="label">Version</span><span class="value">${esc(bot.version || bot.detectedVersion || 'auto')}</span></div>
      </div>
    </div>

    <div class="details-section">
      <h4>Connection</h4>
      <div class="info-grid">
        <div class="info-row">
          <span class="label">Status</span>
          <span class="value ${isConnected ? 'success' : ''}">${isConnected ? '\u25CF Connected' : bot.state === 'connecting' ? '\u25CF Connecting' : '\u25CB Disconnected'}</span>
        </div>
        <div class="info-row"><span class="label">Uptime</span><span class="value" id="detailUptime">${isConnected ? formatUptimeFull(uptime) : '--'}</span></div>
        <div class="info-row"><span class="label">Latency</span><span class="value" id="detailLatency">${metrics.latency ? metrics.latency + 'ms' : '--'}</span></div>
        <div class="info-row"><span class="label">Server</span><span class="value">${esc(bot.host + ':' + bot.port)}</span></div>
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
      ${state.settings.aiEnabled !== false ? `<div style="padding-top:12px;border-top:1px solid var(--border);">
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
        <input class="assistant-name-input" type="text" value="${esc(bot.assistantName || 'Assistant')}"
          onchange="updateAssistantName('${bot.id}', this.value)" placeholder="Assistant" />
      </div>
      ` : ''}` : ''}
    </div>

    <div class="details-section">
      <h4>Manage</h4>
      <div class="danger-zone">
        <button class="btn" onclick="openEditModal('${bot.id}')"><i class="fa-solid fa-pen-to-square"></i> Edit Session</button>
        <button class="btn danger" onclick="doRestart('${bot.id}')"><i class="fa-solid fa-rotate-right"></i> Restart Session</button>
        <button class="btn danger" onclick="confirmRemove('${bot.id}')"><i class="fa-solid fa-trash"></i> Remove Session</button>
      </div>
    </div>
  `;
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

// ─────────── Session Modal ───────────
function openAddModal() {
  editingBotId = null;
  $('sessionModalTitle').textContent = 'Add Session';
  $('fBotType').value = 'mineflayer';
  $('fLabel').value = '';
  $('fUsername').value = '';
  $('fHost').value = state.settings.defaultHost || 'play.example.net';
  $('fPort').value = state.settings.defaultPort || '25565';
  $('fAuth').value = 'microsoft';
  $('fVersion').value = '';
  $('fMode').value = 'manual';
  $('fAiMode').value = 'off';
  $('fSchedStart').value = '00:00';
  $('fSchedEnd').value = '08:00';
  updateBotTypeUI();
  updateModeUI();
  updateAiModeUI();
  $('sessionModalOverlay').classList.add('visible');
}

function openEditModal(id) {
  const bot = state.bots[id];
  if (!bot) return;
  editingBotId = id;
  $('sessionModalTitle').textContent = 'Edit Session';
  $('fBotType').value = bot.botType || 'mineflayer';
  $('fLabel').value = bot.label;
  $('fUsername').value = bot.username || '';
  $('fHost').value = bot.host;
  $('fPort').value = bot.port;
  $('fAuth').value = bot.auth;
  $('fVersion').value = bot.version || '';
  $('fMode').value = bot.mode;
  $('fAiMode').value = bot.aiMode || 'off';
  $('fSchedStart').value = bot.schedule?.start || '00:00';
  $('fSchedEnd').value = bot.schedule?.end || '08:00';
  updateBotTypeUI();
  updateModeUI();
  updateAiModeUI();
  $('sessionModalOverlay').classList.add('visible');
}

function closeSessionModal() {
  $('sessionModalOverlay').classList.remove('visible');
  editingBotId = null;
}

function saveSessionModal() {
  const botType = $('fBotType').value;
  const cfg = {
    label: $('fLabel').value.trim(),
    botType,
    mode: $('fMode').value,
    aiMode: $('fAiMode').value,
    schedule: { start: $('fSchedStart').value, end: $('fSchedEnd').value },
  };

  if (botType === 'mineflayer') {
    cfg.username = $('fUsername').value.trim();
    cfg.host = $('fHost').value.trim() || 'play.example.net';
    cfg.port = $('fPort').value.trim() || '25565';
    cfg.auth = $('fAuth').value.trim() || 'microsoft';
    cfg.version = $('fVersion').value.trim();
    if (!cfg.username) { showToast('Email is required', 'warn'); return; }
    if (!cfg.label) cfg.label = cfg.username;
  } else {
    if (!cfg.label) { showToast('Label is required', 'warn'); return; }
    cfg.username = '';
    cfg.host = state.settings.defaultHost || '';
    cfg.port = state.settings.defaultPort || 25565;
    cfg.auth = '';
    cfg.version = '';
  }

  if (editingBotId) {
    socket.emit('update_bot', { id: editingBotId, ...cfg });
  } else {
    socket.emit('add_bot', cfg);
  }
  closeSessionModal();
}

function updateBotTypeUI() {
  const type = $('fBotType').value;
  $('mineflayerFields').style.display = type === 'mineflayer' ? 'block' : 'none';
  $('fBotTypeNote').textContent = type === 'mineflayer'
    ? 'Connects using a real Minecraft account.'
    : 'Virtual player via CobbleBridge plugin. No MC account needed.';
}

function updateModeUI() {
  const mode = $('fMode').value;
  $('scheduleFields').style.display = mode === 'scheduled' ? 'block' : 'none';
  const notes = { manual: 'You control connect/disconnect manually.', permanent: 'Auto-connects and reconnects on disconnect.', scheduled: 'Connects and disconnects at the times below.' };
  $('fModeNote').textContent = notes[mode] || '';
}

function updateAiModeUI() {
  const mode = $('fAiMode').value;
  const notes = { off: 'No AI responses.', 'admin-afk': 'Tells players you\'re AFK.', support: 'Answers server questions via @mention.', disguise: 'Acts as a casual player.' };
  $('fAiModeNote').textContent = notes[mode] || '';
}

$('fBotType').addEventListener('change', updateBotTypeUI);
$('fMode').addEventListener('change', updateModeUI);
$('fAiMode').addEventListener('change', updateAiModeUI);
$('btnAddSession').addEventListener('click', openAddModal);
$('btnSessionCancel').addEventListener('click', closeSessionModal);
$('btnSessionSave').addEventListener('click', saveSessionModal);
$('sessionModalOverlay').addEventListener('click', (e) => {
  if (e.target === $('sessionModalOverlay')) closeSessionModal();
});

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
  { label: 'Add session', icon: 'fa-solid fa-plus', hint: '', action: openAddModal },
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
