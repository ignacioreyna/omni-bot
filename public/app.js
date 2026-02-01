const state = {
  sessions: [],
  currentSession: null,
  ws: null,
  isProcessing: false,
  user: null,
  wsToken: null,
  authMode: 'tailscale',
};

const elements = {
  sessionSelect: document.getElementById('session-select'),
  newSessionBtn: document.getElementById('new-session-btn'),
  sessionInfo: document.getElementById('session-info'),
  sessionName: document.getElementById('session-name'),
  sessionDir: document.getElementById('session-dir'),
  pauseBtn: document.getElementById('pause-btn'),
  abortBtn: document.getElementById('abort-btn'),
  messages: document.getElementById('messages'),
  streamingMessage: document.getElementById('streaming-message'),
  streamingText: document.getElementById('streaming-text'),
  streamingTools: document.getElementById('streaming-tools'),
  messageForm: document.getElementById('message-form'),
  messageInput: document.getElementById('message-input'),
  sendBtn: document.getElementById('send-btn'),
  newSessionModal: document.getElementById('new-session-modal'),
  newSessionForm: document.getElementById('new-session-form'),
  sessionNameInput: document.getElementById('session-name-input'),
  directorySelect: document.getElementById('directory-select'),
  directoryInput: document.getElementById('directory-input'),
  cancelModalBtn: document.getElementById('cancel-modal-btn'),
};

async function init() {
  // Check auth mode and get user info
  await checkAuth();

  await loadSessions();
  await loadAllowedDirectories();

  // Get WS token if in cloudflare mode
  if (state.authMode === 'cloudflare') {
    await getWsToken();
  }

  connectWebSocket();
  setupEventListeners();
}

async function checkAuth() {
  try {
    // First check health to see auth mode
    const healthRes = await fetch('/api/health');
    const health = await healthRes.json();
    state.authMode = health.authMode || 'tailscale';

    // If in cloudflare mode, get user info
    if (state.authMode === 'cloudflare') {
      const authRes = await fetch('/api/auth/me');
      if (authRes.ok) {
        state.user = await authRes.json();
        showUserInfo();
      } else {
        // Not authenticated - CF Access should handle this
        console.log('Not authenticated');
      }
    }
  } catch (err) {
    console.error('Auth check failed:', err);
  }
}

async function getWsToken() {
  try {
    const response = await fetch('/api/auth/ws-token', { method: 'POST' });
    if (response.ok) {
      const data = await response.json();
      state.wsToken = data.token;

      // Refresh token before expiry
      const refreshIn = (data.expiresIn - 30) * 1000; // 30s before expiry
      setTimeout(refreshWsToken, refreshIn);
    }
  } catch (err) {
    console.error('Failed to get WS token:', err);
  }
}

async function refreshWsToken() {
  await getWsToken();
  // Reconnect WS with new token
  if (state.ws) {
    state.ws.close();
  }
}

function showUserInfo() {
  if (state.user) {
    // Add user email to header (create element if needed)
    let userEl = document.getElementById('user-email');
    if (!userEl) {
      userEl = document.createElement('span');
      userEl.id = 'user-email';
      userEl.className = 'user-email';
      document.querySelector('header').appendChild(userEl);
    }
    userEl.textContent = state.user.email;
  }
}

async function loadSessions() {
  try {
    const response = await fetch('/api/sessions');
    state.sessions = await response.json();
    renderSessionSelect();
  } catch (err) {
    console.error('Failed to load sessions:', err);
  }
}

async function loadAllowedDirectories() {
  try {
    const response = await fetch('/api/sessions/allowed-directories');
    const directories = await response.json();
    elements.directorySelect.innerHTML = directories
      .map(dir => `<option value="${dir}">${dir}</option>`)
      .join('');
  } catch (err) {
    console.error('Failed to load directories:', err);
  }
}

function renderSessionSelect() {
  const options = ['<option value="">Select session...</option>'];
  for (const session of state.sessions) {
    const status = session.status === 'active' ? '🟢' : session.status === 'paused' ? '🟡' : '⚫';
    options.push(`<option value="${session.id}">${status} ${session.name}</option>`);
  }
  elements.sessionSelect.innerHTML = options.join('');

  if (state.currentSession) {
    elements.sessionSelect.value = state.currentSession.id;
  }
}

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  let wsUrl = `${protocol}//${window.location.host}/ws`;

  // Add token for cloudflare mode
  if (state.authMode === 'cloudflare' && state.wsToken) {
    wsUrl += `?token=${encodeURIComponent(state.wsToken)}`;
  }

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    console.log('WebSocket connected');
    if (state.currentSession) {
      subscribeToSession(state.currentSession.id);
    }
  };

  state.ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleServerMessage(message);
  };

  state.ws.onclose = () => {
    console.log('WebSocket disconnected, reconnecting...');
    setTimeout(connectWebSocket, 2000);
  };

  state.ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };
}

function subscribeToSession(sessionId) {
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'subscribe', sessionId }));
  }
}

function unsubscribeFromSession(sessionId) {
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'unsubscribe', sessionId }));
  }
}

function sendMessage(content) {
  if (!state.currentSession || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  state.ws.send(JSON.stringify({
    type: 'message',
    sessionId: state.currentSession.id,
    content,
  }));

  appendMessage('user', content);
  state.isProcessing = true;
  updateUIState();
  showStreamingMessage();
}

function abortMessage() {
  if (!state.currentSession || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  state.ws.send(JSON.stringify({
    type: 'abort',
    sessionId: state.currentSession.id,
  }));
}

function handleServerMessage(message) {
  switch (message.type) {
    case 'text':
      appendStreamingText(message.data);
      break;
    case 'tool':
      appendStreamingTool(message.data);
      break;
    case 'result':
      finalizeStreamingMessage();
      state.isProcessing = false;
      updateUIState();
      break;
    case 'error':
      console.error('Server error:', message.data);
      appendMessage('assistant', `Error: ${message.data}`);
      hideStreamingMessage();
      state.isProcessing = false;
      updateUIState();
      break;
    case 'auth_error':
      console.error('Auth error:', message.data);
      // In cloudflare mode, this might mean token expired
      // Try to refresh token and reconnect
      if (state.authMode === 'cloudflare') {
        refreshWsToken();
      }
      break;
  }
}

function appendMessage(role, content) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.innerHTML = `<div class="message-content">${escapeHtml(content)}</div>`;
  elements.messages.appendChild(div);
  scrollToBottom();
}

function showStreamingMessage() {
  elements.streamingText.textContent = '';
  elements.streamingTools.innerHTML = '';
  elements.streamingMessage.classList.remove('hidden');
  scrollToBottom();
}

function hideStreamingMessage() {
  elements.streamingMessage.classList.add('hidden');
}

function appendStreamingText(text) {
  elements.streamingText.textContent += text;
  scrollToBottom();
}

function appendStreamingTool(tool) {
  const div = document.createElement('div');
  div.className = 'tool-indicator';
  div.textContent = tool.name;
  div.dataset.toolId = tool.id;
  elements.streamingTools.appendChild(div);
  scrollToBottom();
}

function finalizeStreamingMessage() {
  const content = elements.streamingText.textContent;
  const tools = elements.streamingTools.innerHTML;

  if (content || tools) {
    const div = document.createElement('div');
    div.className = 'message assistant';
    div.innerHTML = `
      <div class="message-content">${escapeHtml(content)}</div>
      ${tools}
    `;
    elements.messages.appendChild(div);
  }

  hideStreamingMessage();
  scrollToBottom();
}

function scrollToBottom() {
  elements.messages.parentElement.scrollTop = elements.messages.parentElement.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function selectSession(sessionId) {
  if (state.currentSession) {
    unsubscribeFromSession(state.currentSession.id);
  }

  if (!sessionId) {
    state.currentSession = null;
    elements.sessionInfo.classList.add('hidden');
    elements.messages.innerHTML = '';
    updateUIState();
    return;
  }

  const session = state.sessions.find(s => s.id === sessionId);
  if (!session) return;

  state.currentSession = session;
  elements.sessionName.textContent = session.name;
  elements.sessionDir.textContent = session.workingDirectory;
  elements.sessionInfo.classList.remove('hidden');
  updatePauseButton();

  subscribeToSession(sessionId);
  await loadMessages(sessionId);
  updateUIState();
}

async function loadMessages(sessionId) {
  try {
    const response = await fetch(`/api/messages/${sessionId}`);
    const messages = await response.json();
    elements.messages.innerHTML = '';
    for (const msg of messages) {
      appendMessage(msg.role, msg.content);
    }
  } catch (err) {
    console.error('Failed to load messages:', err);
  }
}

function updateUIState() {
  const hasSession = !!state.currentSession;
  const isActive = hasSession && state.currentSession.status === 'active';
  const canSend = isActive && !state.isProcessing;

  elements.messageInput.disabled = !canSend;
  elements.sendBtn.disabled = !canSend;
  elements.abortBtn.classList.toggle('hidden', !state.isProcessing);
}

function updatePauseButton() {
  if (!state.currentSession) return;

  const isPaused = state.currentSession.status === 'paused';
  elements.pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
}

async function togglePause() {
  if (!state.currentSession) return;

  const endpoint = state.currentSession.status === 'paused' ? 'resume' : 'pause';
  try {
    const response = await fetch(`/api/sessions/${state.currentSession.id}/${endpoint}`, {
      method: 'POST',
    });
    const session = await response.json();
    state.currentSession = session;

    const idx = state.sessions.findIndex(s => s.id === session.id);
    if (idx >= 0) state.sessions[idx] = session;

    renderSessionSelect();
    updatePauseButton();
    updateUIState();
  } catch (err) {
    console.error('Failed to toggle pause:', err);
  }
}

async function createSession(name, workingDirectory) {
  try {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, workingDirectory }),
    });

    if (!response.ok) {
      const error = await response.json();
      alert(error.error || 'Failed to create session');
      return;
    }

    const session = await response.json();
    state.sessions.unshift(session);
    renderSessionSelect();
    selectSession(session.id);
    elements.sessionSelect.value = session.id;
  } catch (err) {
    console.error('Failed to create session:', err);
    alert('Failed to create session');
  }
}

function setupEventListeners() {
  elements.sessionSelect.addEventListener('change', (e) => {
    selectSession(e.target.value);
  });

  elements.newSessionBtn.addEventListener('click', () => {
    elements.newSessionModal.classList.remove('hidden');
    elements.sessionNameInput.focus();
  });

  elements.cancelModalBtn.addEventListener('click', () => {
    elements.newSessionModal.classList.add('hidden');
    elements.newSessionForm.reset();
  });

  elements.newSessionForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = elements.sessionNameInput.value.trim();
    let directory = elements.directorySelect.value;
    const subdirectory = elements.directoryInput.value.trim();

    if (subdirectory) {
      directory = directory + '/' + subdirectory;
    }

    createSession(name, directory);
    elements.newSessionModal.classList.add('hidden');
    elements.newSessionForm.reset();
  });

  elements.messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const content = elements.messageInput.value.trim();
    if (content) {
      sendMessage(content);
      elements.messageInput.value = '';
      elements.messageInput.style.height = 'auto';
    }
  });

  elements.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      elements.messageForm.dispatchEvent(new Event('submit'));
    }
  });

  elements.messageInput.addEventListener('input', () => {
    elements.messageInput.style.height = 'auto';
    elements.messageInput.style.height = elements.messageInput.scrollHeight + 'px';
  });

  elements.pauseBtn.addEventListener('click', togglePause);
  elements.abortBtn.addEventListener('click', abortMessage);

  elements.newSessionModal.addEventListener('click', (e) => {
    if (e.target === elements.newSessionModal) {
      elements.newSessionModal.classList.add('hidden');
      elements.newSessionForm.reset();
    }
  });
}

init();
