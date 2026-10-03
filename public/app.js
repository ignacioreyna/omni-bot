/* global Terminal, FitAddon, WebLinksAddon */
'use strict';

const $ = (id) => document.getElementById(id);

const FONT_SIZE_KEY = 'omni.fontSize';
const COMPOSER_KEY = 'omni.composerHidden';
const SESSIONS_POLL_MS = 5000;
// Claude Code treats text+Enter arriving together as a paste; a short gap makes Enter submit
const SUBMIT_DELAY_MS = 80;

const state = {
  home: '',
  defaultCommand: 'claude',
  sessions: [],
  directories: [],
  selectedDir: null,
  pollTimer: null,
  term: null,
  fit: null,
  ws: null,
  session: null,
  ctrlArmed: false,
  reconnectTimer: null,
  reconnectAttempts: 0,
};

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 3500);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

function shortPath(p) {
  return state.home && p.startsWith(state.home) ? '~' + p.slice(state.home.length) : p;
}

function timeAgo(iso) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* ---------- Home ---------- */

function renderSessions() {
  const list = $('session-list');
  list.replaceChildren();
  $('empty').hidden = state.sessions.length > 0;

  for (const s of state.sessions) {
    const li = document.createElement('li');
    li.className = 'session-card';
    li.addEventListener('click', () => openSession(s.name));

    const main = document.createElement('div');
    main.className = 'session-main';

    const name = document.createElement('div');
    name.className = 'session-name';
    if (s.attachedClients > 0) {
      const dot = document.createElement('span');
      dot.className = 'attached-dot';
      dot.title = `${s.attachedClients} client(s) attached`;
      name.append(dot);
    }
    name.append(s.name);

    const cwd = document.createElement('div');
    cwd.className = 'session-cwd';
    cwd.textContent = shortPath(s.cwd);

    const meta = document.createElement('div');
    meta.className = 'session-meta';
    meta.textContent = `${s.command} · active ${timeAgo(s.lastActivity)}`;

    main.append(name, cwd, meta);

    const kill = document.createElement('button');
    kill.className = 'kill-btn';
    kill.textContent = '✕';
    kill.title = 'Kill session';
    kill.addEventListener('click', (e) => {
      e.stopPropagation();
      killSession(s.name);
    });

    li.append(main, kill);
    list.append(li);
  }
}

async function loadSessions() {
  try {
    state.sessions = await api('/api/sessions');
    renderSessions();
  } catch (err) {
    toast(err.message);
  }
}

async function killSession(name) {
  if (!confirm(`Kill session "${name}"? Anything running in it will stop.`)) return;
  try {
    await api(`/api/sessions/${encodeURIComponent(name)}`, { method: 'DELETE' });
    await loadSessions();
  } catch (err) {
    toast(err.message);
  }
}

function startPolling() {
  stopPolling();
  loadSessions();
  state.pollTimer = setInterval(loadSessions, SESSIONS_POLL_MS);
}

function stopPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = null;
}

/* ---------- New session ---------- */

function renderDirectories() {
  const filter = $('dir-filter').value.trim().toLowerCase();
  const list = $('dir-list');
  list.replaceChildren();

  const matches = state.directories.filter((d) => !filter || d.path.toLowerCase().includes(filter));
  for (const d of matches.slice(0, 100)) {
    const li = document.createElement('li');
    const display = shortPath(d.path);
    const cut = display.lastIndexOf('/');
    const base = document.createElement('span');
    base.className = 'dir-base';
    base.textContent = display.slice(cut + 1) || display;
    const parent = document.createElement('span');
    parent.className = 'dir-parent';
    parent.textContent = display.slice(0, cut + 1);
    li.append(base, parent);
    li.title = d.path;
    if (d.path === state.selectedDir) li.classList.add('selected');
    li.addEventListener('click', () => {
      state.selectedDir = d.path;
      renderDirectories();
    });
    list.append(li);
  }
}

function expandTyped(path) {
  return path.startsWith('~') ? state.home + path.slice(1) : path;
}

async function openNewDialog() {
  state.selectedDir = null;
  $('dir-filter').value = '';
  $('session-name').value = '';
  $('session-command').value = state.defaultCommand;
  $('new-dialog').showModal();
  try {
    state.directories = await api('/api/directories');
    renderDirectories();
  } catch (err) {
    toast(err.message);
  }
}

async function createSession(e) {
  e.preventDefault();
  const typed = $('dir-filter').value.trim();
  const cwd = state.selectedDir || (typed.startsWith('/') || typed.startsWith('~') ? expandTyped(typed) : null);
  if (!cwd) {
    toast('Pick a directory');
    return;
  }

  const button = $('create-session');
  button.disabled = true;
  try {
    const { name } = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        cwd,
        name: $('session-name').value.trim() || undefined,
        command: $('session-command').value || undefined,
      }),
    });
    $('new-dialog').close();
    openSession(name);
  } catch (err) {
    toast(err.message);
  } finally {
    button.disabled = false;
  }
}

/* ---------- Terminal ---------- */

const KEY_SEQUENCES = {
  esc: '\x1b',
  tab: '\t',
  'shift-tab': '\x1b[Z',
  'ctrl-c': '\x03',
  enter: '\r',
};

function arrowSequence(direction) {
  const code = { up: 'A', down: 'B', right: 'C', left: 'D' }[direction];
  const appMode = state.term?.modes?.applicationCursorKeysMode;
  return (appMode ? '\x1bO' : '\x1b[') + code;
}

function sendMessage(msg) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}

function sendInput(data) {
  sendMessage({ t: 'input', d: data });
}

function applyCtrl(data) {
  if (!state.ctrlArmed || data.length !== 1) return data;
  setCtrl(false);
  const code = data.toUpperCase().charCodeAt(0);
  return code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : data;
}

function setCtrl(armed) {
  state.ctrlArmed = armed;
  $('ctrl-key').classList.toggle('active', armed);
}

function ensureTerminal() {
  if (state.term) return;

  const fontSize = Number(storageGet(FONT_SIZE_KEY)) || 13;
  const term = new Terminal({
    fontSize,
    fontFamily: 'Menlo, ui-monospace, SFMono-Regular, monospace',
    cursorBlink: true,
    allowProposedApi: true,
    theme: { background: '#000000' },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon.WebLinksAddon());
  term.open($('terminal'));
  term.onData((data) => sendInput(applyCtrl(data)));
  term.onResize(({ cols, rows }) => sendMessage({ t: 'resize', cols, rows }));

  state.term = term;
  state.fit = fit;
}

function fitTerminal() {
  if (!state.fit || $('term-view').hidden) return;
  try { state.fit.fit(); } catch { /* container not laid out yet */ }
}

function connect() {
  clearTimeout(state.reconnectTimer);
  if (state.ws) {
    state.ws.onclose = null;
    state.ws.close();
  }

  fitTerminal();
  const { cols, rows } = state.term;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws/terminal?session=${encodeURIComponent(state.session)}&cols=${cols}&rows=${rows}`;
  const ws = new WebSocket(url);
  state.ws = ws;

  ws.onopen = () => {
    state.reconnectAttempts = 0;
    $('disconnected').hidden = true;
    state.term.reset();
    state.term.focus();
  };
  ws.onmessage = (e) => state.term.write(e.data);
  ws.onclose = () => {
    if (state.ws !== ws || !state.session) return;
    $('disconnected').hidden = false;
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (document.hidden || state.reconnectAttempts >= 5) return;
  const delay = Math.min(1000 * 2 ** state.reconnectAttempts, 10_000);
  state.reconnectAttempts++;
  state.reconnectTimer = setTimeout(connect, delay);
}

function disconnect() {
  clearTimeout(state.reconnectTimer);
  if (state.ws) {
    state.ws.onclose = null;
    state.ws.close();
    state.ws = null;
  }
}

function handleKey(key) {
  if (key === 'ctrl') return setCtrl(!state.ctrlArmed);
  if (key === 'toggle-composer') return toggleComposer();
  if (key === 'scroll-up') return sendMessage({ t: 'scroll', dir: 'up' });
  if (key === 'scroll-down') return sendMessage({ t: 'scroll', dir: 'down' });
  if (key === 'scroll-exit') return sendMessage({ t: 'scroll-exit' });
  if (['up', 'down', 'left', 'right'].includes(key)) return sendInput(arrowSequence(key));
  if (KEY_SEQUENCES[key]) sendInput(KEY_SEQUENCES[key]);
}

function toggleComposer(force) {
  const composer = $('composer');
  composer.hidden = force === undefined ? !composer.hidden : force;
  storageSet(COMPOSER_KEY, composer.hidden ? '1' : '0');
  requestAnimationFrame(fitTerminal);
}

function submitComposer(e) {
  e.preventDefault();
  const input = $('composer-input');
  const text = input.value;
  input.value = '';
  autoGrow();

  if (!text) {
    sendInput('\r');
    return;
  }
  // Bracketed paste keeps multi-line text from being submitted line by line
  sendInput(text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text);
  setTimeout(() => sendInput('\r'), SUBMIT_DELAY_MS);
}

function autoGrow() {
  const input = $('composer-input');
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight}px`;
  requestAnimationFrame(fitTerminal);
}

function changeFontSize(delta) {
  if (!state.term) return;
  const size = Math.min(24, Math.max(8, state.term.options.fontSize + delta));
  state.term.options.fontSize = size;
  storageSet(FONT_SIZE_KEY, String(size));
  fitTerminal();
}

/* ---------- Routing ---------- */

function openSession(name) {
  location.hash = `#/s/${encodeURIComponent(name)}`;
}

function route() {
  const match = location.hash.match(/^#\/s\/(.+)$/);
  if (match) {
    const name = decodeURIComponent(match[1]);
    stopPolling();
    $('home').hidden = true;
    $('term-view').hidden = false;
    $('term-title').textContent = name;
    ensureTerminal();
    if (state.session !== name || !state.ws) {
      state.session = name;
      state.reconnectAttempts = 0;
      requestAnimationFrame(connect);
    }
  } else {
    state.session = null;
    disconnect();
    $('term-view').hidden = true;
    $('home').hidden = false;
    startPolling();
  }
}

/* ---------- Viewport (iOS keyboard) ---------- */

function syncViewport() {
  const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${height}px`);
  window.scrollTo(0, 0);
  requestAnimationFrame(fitTerminal);
}

/* ---------- Init ---------- */

async function init() {
  try {
    const cfg = await api('/api/config');
    state.home = cfg.home;
    state.defaultCommand = cfg.defaultCommand;
  } catch (err) {
    toast(err.message);
  }

  $('refresh').addEventListener('click', loadSessions);
  $('new-session').addEventListener('click', openNewDialog);
  $('cancel-new').addEventListener('click', () => $('new-dialog').close());
  $('new-form').addEventListener('submit', createSession);
  $('dir-filter').addEventListener('input', () => {
    state.selectedDir = null;
    renderDirectories();
  });

  $('back').addEventListener('click', () => { location.hash = ''; });
  $('font-up').addEventListener('click', () => changeFontSize(1));
  $('font-down').addEventListener('click', () => changeFontSize(-1));
  $('disconnected').addEventListener('click', () => {
    state.reconnectAttempts = 0;
    connect();
  });

  // pointerdown + preventDefault keeps focus (and the iOS keyboard) where it was
  $('keybar').addEventListener('pointerdown', (e) => {
    const button = e.target.closest('button[data-key]');
    if (!button) return;
    e.preventDefault();
    handleKey(button.dataset.key);
  });

  $('composer').addEventListener('submit', submitComposer);
  $('composer-input').addEventListener('input', autoGrow);
  $('composer-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer: fine)').matches) {
      submitComposer(e);
    }
  });
  if (storageGet(COMPOSER_KEY) === '1') $('composer').hidden = true;

  window.addEventListener('hashchange', route);
  window.addEventListener('resize', syncViewport);
  window.visualViewport?.addEventListener('resize', syncViewport);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !state.session) return;
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      state.reconnectAttempts = 0;
      connect();
    }
  });

  syncViewport();
  route();
}

init();
