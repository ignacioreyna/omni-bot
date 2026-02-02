const state = {
  sessions: [],
  currentSession: null,
  ws: null,
  isProcessing: false,
  user: null,
  wsToken: null,
  authMode: 'tailscale',
  browsePath: '', // Current path in directory browser
  mediaRecorder: null,
  audioChunks: [],
  isRecording: false,
  isTranscribing: false,
  pendingPermission: null, // Current permission request awaiting response
  pendingQuestion: null, // Current Claude question awaiting response
  questionAnswers: {}, // Accumulated answers for multi-question forms
  // Slash command state
  pendingModel: null, // Model for next message
  pendingPlanMode: false, // Plan mode for next message
  autocompleteIndex: -1, // Currently selected autocomplete item
  lastResultData: null, // Stores result data with usage info
};

// Slash commands definition
const SLASH_COMMANDS = [
  {
    name: '/resume',
    args: '<session-id>',
    description: 'Switch to another session',
    handler: handleResumeCommand,
  },
  {
    name: '/model',
    args: '<sonnet|opus|haiku>',
    description: 'Change model for next message',
    handler: handleModelCommand,
  },
  {
    name: '/plan',
    args: '',
    description: 'Enable plan mode for next message',
    handler: handlePlanCommand,
  },
];

const elements = {
  sessionSelect: document.getElementById('session-select'),
  newSessionBtn: document.getElementById('new-session-btn'),
  importSessionBtn: document.getElementById('import-session-btn'),
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
  voiceBtn: document.getElementById('voice-btn'),
  voiceIcon: document.getElementById('voice-icon'),
  newSessionModal: document.getElementById('new-session-modal'),
  newSessionForm: document.getElementById('new-session-form'),
  sessionNameInput: document.getElementById('session-name-input'),
  directorySelect: document.getElementById('directory-select'),
  directoryInput: document.getElementById('directory-input'),
  browseBtn: document.getElementById('browse-btn'),
  directoryBrowser: document.getElementById('directory-browser'),
  directoryList: document.getElementById('directory-list'),
  cancelModalBtn: document.getElementById('cancel-modal-btn'),
  // Import modal elements
  importSessionModal: document.getElementById('import-session-modal'),
  importLoading: document.getElementById('import-loading'),
  importSessionsList: document.getElementById('import-sessions-list'),
  importEmpty: document.getElementById('import-empty'),
  cancelImportBtn: document.getElementById('cancel-import-btn'),
  // Permission modal elements
  permissionModal: document.getElementById('permission-modal'),
  permissionTool: document.getElementById('permission-tool'),
  permissionInput: document.getElementById('permission-input'),
  permissionReason: document.getElementById('permission-reason'),
  permissionPattern: document.getElementById('permission-pattern'),
  permissionPatternValue: document.getElementById('permission-pattern-value'),
  permissionAllow: document.getElementById('permission-allow'),
  permissionAllowSimilar: document.getElementById('permission-allow-similar'),
  permissionDeny: document.getElementById('permission-deny'),
  // Question modal elements
  questionModal: document.getElementById('question-modal'),
  questionContainer: document.getElementById('question-container'),
  questionSubmit: document.getElementById('question-submit'),
  questionCancel: document.getElementById('question-cancel'),
  // Autocomplete elements
  autocompleteContainer: document.getElementById('autocomplete-container'),
  autocompleteList: document.getElementById('autocomplete-list'),
};

// Track tool usage during streaming
let streamingToolCount = 0;

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

  // Check URL for session ID
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get('session');
  if (sessionId && state.sessions.find(s => s.id === sessionId)) {
    elements.sessionSelect.value = sessionId;
    selectSession(sessionId);
  }
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

function getSessionDisplayName(session) {
  if (session.isDraft) {
    return '(New Session)';
  }
  return session.name || '(Untitled)';
}

function renderSessionSelect() {
  const options = ['<option value="">Select session...</option>'];
  for (const session of state.sessions) {
    const status = session.status === 'active' ? '🟢' : session.status === 'paused' ? '🟡' : '⚫';
    const displayName = getSessionDisplayName(session);
    options.push(`<option value="${session.id}">${status} ${displayName}</option>`);
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

  // Build message options from pending state
  const options = {};
  if (state.pendingModel) {
    options.model = state.pendingModel;
  }
  if (state.pendingPlanMode) {
    options.planMode = true;
  }

  const messagePayload = {
    type: 'message',
    sessionId: state.currentSession.id,
    content,
  };

  // Only include options if there are any
  if (Object.keys(options).length > 0) {
    messagePayload.options = options;
  }

  state.ws.send(JSON.stringify(messagePayload));

  // Show indicator for model/plan mode
  let displayContent = content;
  if (state.pendingModel || state.pendingPlanMode) {
    const indicators = [];
    if (state.pendingModel) indicators.push(`model: ${state.pendingModel}`);
    if (state.pendingPlanMode) indicators.push('plan mode');
    displayContent = `[${indicators.join(', ')}]\n${content}`;
  }

  appendMessage('user', displayContent);

  // Reset pending state
  state.pendingModel = null;
  state.pendingPlanMode = false;

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
    case 'user_message':
      // Message from another device - show it
      appendMessage('user', message.data);
      state.isProcessing = true;
      updateUIState();
      showStreamingMessage();
      break;
    case 'text':
      appendStreamingText(message.data);
      break;
    case 'tool':
      appendStreamingTool(message.data);
      break;
    case 'result':
      state.lastResultData = message.data;
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
    case 'permission_request':
      showPermissionDialog(message.data);
      break;
    case 'claude_question':
      showQuestionDialog(message.data);
      break;
    case 'session_updated':
      // Session was updated (e.g., draft became named session)
      handleSessionUpdated(message.data);
      break;
  }
}

function handleSessionUpdated(updatedSession) {
  // Update session in state
  const idx = state.sessions.findIndex(s => s.id === updatedSession.id);
  if (idx >= 0) {
    state.sessions[idx] = updatedSession;
  }

  // Update current session if it's the one that was updated
  if (state.currentSession && state.currentSession.id === updatedSession.id) {
    state.currentSession = updatedSession;
    elements.sessionName.textContent = getSessionDisplayName(updatedSession);
  }

  // Re-render session dropdown
  renderSessionSelect();
}

function appendMessage(role, content) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  const rendered = role === 'assistant' ? renderMarkdown(content) : escapeHtml(content);
  div.innerHTML = `<div class="message-content">${rendered}</div>`;
  elements.messages.appendChild(div);
  scrollToBottom();
}

function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    // Configure marked for safe rendering
    marked.setOptions({
      breaks: true,
      gfm: true,
    });
    return marked.parse(text);
  }
  // Fallback if marked isn't loaded
  return escapeHtml(text);
}

function showStreamingMessage() {
  elements.streamingText.textContent = '';
  streamingToolCount = 0;
  const toolsList = elements.streamingTools.querySelector('.tools-list');
  const toolsCount = elements.streamingTools.querySelector('.tools-count');
  if (toolsList) toolsList.innerHTML = '';
  if (toolsCount) toolsCount.textContent = '0 tools used';
  elements.streamingTools.classList.add('collapsed');
  elements.streamingTools.classList.add('hidden');
  elements.streamingMessage.classList.remove('hidden');
  scrollToBottom();
}

function hideStreamingMessage() {
  elements.streamingMessage.classList.add('hidden');
}

function appendStreamingText(text) {
  // Replace instead of append - cli-wrapper emits full accumulated text, not deltas
  elements.streamingText.textContent = text;
  scrollToBottom();
}

function appendStreamingTool(tool) {
  streamingToolCount++;

  const toolsList = elements.streamingTools.querySelector('.tools-list');
  const toolsCount = elements.streamingTools.querySelector('.tools-count');

  // Show tools container when first tool is used
  elements.streamingTools.classList.remove('hidden');

  // Add tool to the list
  const div = document.createElement('div');
  div.className = 'tool-indicator';
  div.textContent = tool.name;
  div.dataset.toolId = tool.id;
  if (toolsList) toolsList.appendChild(div);

  // Update count badge
  if (toolsCount) {
    toolsCount.textContent = `${streamingToolCount} tool${streamingToolCount !== 1 ? 's' : ''} used`;
  }

  scrollToBottom();
}

function formatUsageFooter(resultData) {
  if (!resultData || !resultData.usage) return '';

  const parts = [];

  // Extract model name from modelUsage keys or parse from full model ID
  let modelName = '';
  if (resultData.modelUsage) {
    const modelIds = Object.keys(resultData.modelUsage);
    if (modelIds.length > 0) {
      // Extract short name from model ID (e.g., "claude-sonnet-4-..." -> "sonnet")
      modelName = extractModelName(modelIds[0]);
    }
  }

  // Token counts with model name
  const inputTokens = resultData.usage.input_tokens || 0;
  const outputTokens = resultData.usage.output_tokens || 0;
  const tokenPart = `${formatNumber(inputTokens)} in / ${formatNumber(outputTokens)} out`;

  if (modelName) {
    parts.push(`${modelName} • ${tokenPart}`);
  } else {
    parts.push(tokenPart);
  }

  // Cost
  if (resultData.total_cost_usd !== undefined && resultData.total_cost_usd !== null) {
    parts.push(`$${resultData.total_cost_usd.toFixed(4)}`);
  }

  // Duration
  if (resultData.duration_ms) {
    const seconds = (resultData.duration_ms / 1000).toFixed(1);
    parts.push(`${seconds}s`);
  }

  return parts.join(' • ');
}

function extractModelName(modelId) {
  // Handle both short names and full model IDs
  // e.g., "sonnet" -> "sonnet", "claude-sonnet-4-20250514" -> "sonnet"
  if (!modelId) return '';

  const lower = modelId.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';

  // Fallback: return as-is if short, otherwise extract
  return modelId.length <= 10 ? modelId : '';
}

function formatNumber(num) {
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k';
  }
  return num.toString();
}

function finalizeStreamingMessage() {
  const content = elements.streamingText.textContent;
  const toolsList = elements.streamingTools.querySelector('.tools-list');
  const hasTools = streamingToolCount > 0;

  if (content || hasTools) {
    const div = document.createElement('div');
    div.className = 'message assistant';

    let toolsHtml = '';
    if (hasTools && toolsList) {
      const toolsListHtml = toolsList.innerHTML;
      toolsHtml = `
        <div class="tools-container collapsed">
          <div class="tools-toggle">
            <span class="tools-icon">⚡</span>
            <span class="tools-count">${streamingToolCount} tool${streamingToolCount !== 1 ? 's' : ''} used</span>
          </div>
          <div class="tools-list">${toolsListHtml}</div>
        </div>
      `;
    }

    // Build usage footer
    let usageHtml = '';
    const usageText = formatUsageFooter(state.lastResultData);
    if (usageText) {
      usageHtml = `<div class="message-usage">${usageText}</div>`;
    }

    div.innerHTML = `
      <div class="message-content">${renderMarkdown(content)}</div>
      ${toolsHtml}
      ${usageHtml}
    `;
    elements.messages.appendChild(div);

    // Add click handler for tools toggle
    const toolsToggle = div.querySelector('.tools-toggle');
    if (toolsToggle) {
      toolsToggle.addEventListener('click', () => {
        const container = toolsToggle.parentElement;
        container.classList.toggle('collapsed');
      });
    }
  }

  // Clear result data
  state.lastResultData = null;

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
    // Clear URL param
    const url = new URL(window.location);
    url.searchParams.delete('session');
    window.history.pushState({}, '', url);
    return;
  }

  const session = state.sessions.find(s => s.id === sessionId);
  if (!session) return;

  state.currentSession = session;
  elements.sessionName.textContent = getSessionDisplayName(session);
  elements.sessionDir.textContent = session.workingDirectory;
  elements.sessionInfo.classList.remove('hidden');
  updatePauseButton();

  subscribeToSession(sessionId);
  await loadMessages(sessionId);
  updateUIState();

  // Update URL with session ID
  const url = new URL(window.location);
  url.searchParams.set('session', sessionId);
  window.history.pushState({}, '', url);
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
  elements.voiceBtn.disabled = !canSend || state.isTranscribing;
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
    // Only include name if provided (non-empty)
    const body = { workingDirectory };
    if (name) {
      body.name = name;
    }

    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

// Import session functions
async function openImportModal() {
  elements.importSessionModal.classList.remove('hidden');
  elements.importLoading.classList.remove('hidden');
  elements.importSessionsList.classList.add('hidden');
  elements.importEmpty.classList.add('hidden');

  try {
    const response = await fetch('/api/local-sessions');
    const projects = await response.json();

    elements.importLoading.classList.add('hidden');

    if (!projects.length) {
      elements.importEmpty.classList.remove('hidden');
      return;
    }

    renderImportSessionsList(projects);
    elements.importSessionsList.classList.remove('hidden');
  } catch (err) {
    console.error('Failed to load local sessions:', err);
    elements.importLoading.textContent = 'Failed to load local sessions';
  }
}

function closeImportModal() {
  elements.importSessionModal.classList.add('hidden');
}

function renderImportSessionsList(projects) {
  const html = projects.map(project => {
    const sessionsHtml = project.sessions.slice(0, 5).map(session => {
      const preview = session.firstPrompt || 'No preview available';
      const modified = session.modified ? formatRelativeTime(session.modified) : '';
      const branch = session.gitBranch ? `<span class="import-branch">${session.gitBranch}</span>` : '';

      return `
        <div class="import-session-item"
             data-session-id="${session.sessionId}"
             data-project-path="${session.projectPath}"
             data-first-prompt="${escapeHtml(session.firstPrompt || '')}">
          <div class="import-session-header">
            <span class="import-session-messages">${session.messageCount} messages</span>
            ${branch}
            <span class="import-session-time">${modified}</span>
          </div>
          <div class="import-session-preview">${escapeHtml(preview)}</div>
        </div>
      `;
    }).join('');

    const moreCount = project.sessions.length - 5;
    const moreHtml = moreCount > 0 ? `<div class="import-more">+${moreCount} more sessions</div>` : '';

    return `
      <div class="import-project">
        <div class="import-project-header">
          <span class="import-project-name">${escapeHtml(project.projectName)}</span>
          <span class="import-project-path">${escapeHtml(project.projectPath)}</span>
        </div>
        <div class="import-project-sessions">
          ${sessionsHtml}
          ${moreHtml}
        </div>
      </div>
    `;
  }).join('');

  elements.importSessionsList.innerHTML = html;
}

function formatRelativeTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

async function forkSession(localSessionId, projectPath, firstPrompt) {
  // Generate a name from the first prompt or project
  const baseName = firstPrompt
    ? firstPrompt.slice(0, 30).replace(/[^a-zA-Z0-9\s-]/g, '').trim()
    : 'Imported session';
  const name = baseName || 'Imported session';

  try {
    const response = await fetch('/api/sessions/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        workingDirectory: projectPath,
        localSessionId,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      alert(error.error || 'Failed to fork session');
      return;
    }

    const session = await response.json();
    state.sessions.unshift(session);
    renderSessionSelect();
    selectSession(session.id);
    elements.sessionSelect.value = session.id;
    closeImportModal();
  } catch (err) {
    console.error('Failed to fork session:', err);
    alert('Failed to fork session');
  }
}

// Directory browser functions
async function browseDirectories(subpath = '') {
  const base = elements.directorySelect.value;
  if (!base) return;

  try {
    const params = new URLSearchParams({ base, path: subpath });
    const response = await fetch(`/api/sessions/browse?${params}`);
    if (!response.ok) {
      const error = await response.json();
      console.error('Browse error:', error);
      return;
    }

    const data = await response.json();
    state.browsePath = data.currentPath;
    renderDirectoryList(data.directories);
  } catch (err) {
    console.error('Failed to browse directories:', err);
  }
}

function renderDirectoryList(directories) {
  const items = [];

  // Add parent directory link if not at root
  if (state.browsePath) {
    items.push(`<div class="directory-item parent" data-path="..">.. (parent)</div>`);
  }

  if (directories.length === 0 && !state.browsePath) {
    items.push(`<div class="directory-empty">No subdirectories</div>`);
  } else {
    for (const dir of directories) {
      const fullPath = state.browsePath ? `${state.browsePath}/${dir}` : dir;
      const isSelected = elements.directoryInput.value === fullPath;
      items.push(`<div class="directory-item${isSelected ? ' selected' : ''}" data-path="${fullPath}">${dir}</div>`);
    }
  }

  elements.directoryList.innerHTML = items.join('');
}

function handleDirectoryClick(e) {
  const item = e.target.closest('.directory-item');
  if (!item) return;

  const itemPath = item.dataset.path;

  if (itemPath === '..') {
    // Go up one level
    const parts = state.browsePath.split('/');
    parts.pop();
    const parentPath = parts.join('/');
    browseDirectories(parentPath);
  } else {
    // Select this directory (single click fills input)
    elements.directoryInput.value = itemPath;
    renderDirectoryList(Array.from(elements.directoryList.querySelectorAll('.directory-item:not(.parent)')).map(el => {
      const path = el.dataset.path;
      return path.split('/').pop();
    }));
  }
}

function handleDirectoryDblClick(e) {
  const item = e.target.closest('.directory-item');
  if (!item || item.classList.contains('parent')) return;

  const itemPath = item.dataset.path;
  // Navigate into directory
  browseDirectories(itemPath);
}

function toggleDirectoryBrowser() {
  const isHidden = elements.directoryBrowser.classList.contains('hidden');
  if (isHidden) {
    elements.directoryBrowser.classList.remove('hidden');
    browseDirectories(elements.directoryInput.value || '');
  } else {
    elements.directoryBrowser.classList.add('hidden');
  }
}

// Voice recording functions
async function toggleRecording() {
  if (state.isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.mediaRecorder = new MediaRecorder(stream);
    state.audioChunks = [];

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        state.audioChunks.push(e.data);
      }
    };

    state.mediaRecorder.onstop = async () => {
      const blob = new Blob(state.audioChunks, { type: 'audio/webm' });
      stream.getTracks().forEach((t) => t.stop());
      await transcribeAndSend(blob);
    };

    state.mediaRecorder.start();
    state.isRecording = true;
    updateVoiceButtonState();
  } catch (err) {
    console.error('Failed to start recording:', err);
    alert('Could not access microphone. Please check permissions.');
  }
}

function stopRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
    state.mediaRecorder.stop();
  }
  state.isRecording = false;
  updateVoiceButtonState();
}

async function transcribeAndSend(audioBlob) {
  state.isTranscribing = true;
  updateVoiceButtonState();

  const formData = new FormData();
  formData.append('audio', audioBlob, 'voice.webm');

  try {
    const res = await fetch(`/api/sessions/${state.currentSession.id}/transcribe`, {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Transcription failed');
    }
    if (data.transcript && data.transcript.trim()) {
      sendMessage(data.transcript.trim());
    }
  } catch (err) {
    console.error('Transcription failed:', err);
    alert('Transcription failed: ' + err.message);
  }

  state.isTranscribing = false;
  updateVoiceButtonState();
}

function updateVoiceButtonState() {
  if (state.isRecording) {
    elements.voiceBtn.classList.add('recording');
    elements.voiceIcon.textContent = '⏹';
    elements.voiceBtn.title = 'Stop recording';
  } else if (state.isTranscribing) {
    elements.voiceBtn.classList.remove('recording');
    elements.voiceBtn.classList.add('transcribing');
    elements.voiceIcon.textContent = '...';
    elements.voiceBtn.title = 'Transcribing...';
    elements.voiceBtn.disabled = true;
  } else {
    elements.voiceBtn.classList.remove('recording', 'transcribing');
    elements.voiceIcon.textContent = '🎤';
    elements.voiceBtn.title = 'Record voice message';
    // Re-enable based on session state
    const hasSession = !!state.currentSession;
    const isActive = hasSession && state.currentSession.status === 'active';
    const canSend = isActive && !state.isProcessing;
    elements.voiceBtn.disabled = !canSend;
  }
}

// Permission dialog functions
function showPermissionDialog(request) {
  console.log('[Permission] Showing dialog for request:', request);
  state.pendingPermission = request;
  elements.permissionTool.textContent = request.toolName;
  elements.permissionInput.textContent = JSON.stringify(request.input, null, 2);
  if (request.reason) {
    elements.permissionReason.textContent = request.reason;
    elements.permissionReason.classList.remove('hidden');
  } else {
    elements.permissionReason.textContent = '';
    elements.permissionReason.classList.add('hidden');
  }
  // Show pattern for "Allow Similar" preview
  if (request.pattern) {
    elements.permissionPatternValue.textContent = request.pattern;
    elements.permissionPattern.classList.remove('hidden');
  } else {
    elements.permissionPattern.classList.add('hidden');
  }
  elements.permissionModal.classList.remove('hidden');
}

function hidePermissionDialog() {
  elements.permissionModal.classList.add('hidden');
  state.pendingPermission = null;
}

function respondToPermission(allowed, allowSimilar = false) {
  console.log('[Permission] Responding:', allowed, 'allowSimilar:', allowSimilar, 'for request:', state.pendingPermission);
  if (state.pendingPermission && state.ws && state.ws.readyState === WebSocket.OPEN) {
    const response = {
      type: 'permission_response',
      sessionId: state.currentSession?.id,
      data: {
        id: state.pendingPermission.id,
        allowed,
        allowSimilar: allowed ? allowSimilar : undefined,
        message: allowed ? undefined : 'User denied permission',
      },
    };
    console.log('[Permission] Sending response:', response);
    state.ws.send(JSON.stringify(response));
  } else {
    console.log('[Permission] Cannot send response - pendingPermission:', !!state.pendingPermission, 'ws:', !!state.ws, 'readyState:', state.ws?.readyState);
  }
  hidePermissionDialog();
}

// Question dialog functions (for Claude's AskUserQuestion tool)
function showQuestionDialog(questionData) {
  console.log('[Question] Showing dialog for question:', questionData);
  state.pendingQuestion = questionData;
  state.questionAnswers = {};

  // Build the question UI
  const container = elements.questionContainer;
  container.innerHTML = '';

  for (let i = 0; i < questionData.questions.length; i++) {
    const q = questionData.questions[i];
    const questionDiv = document.createElement('div');
    questionDiv.className = 'question-item';
    questionDiv.dataset.questionIndex = i;

    const questionText = document.createElement('div');
    questionText.className = 'question-text';
    questionText.textContent = q.question;
    questionDiv.appendChild(questionText);

    if (q.header) {
      const header = document.createElement('div');
      header.className = 'question-header';
      header.textContent = q.header;
      questionDiv.insertBefore(header, questionText);
    }

    const optionsDiv = document.createElement('div');
    optionsDiv.className = 'question-options';

    // Render predefined options as buttons
    for (const opt of q.options) {
      const optBtn = document.createElement('button');
      optBtn.type = 'button';
      optBtn.className = 'question-option-btn';
      optBtn.dataset.label = opt.label;
      optBtn.dataset.questionIndex = i;

      const labelSpan = document.createElement('span');
      labelSpan.className = 'option-label';
      labelSpan.textContent = opt.label;
      optBtn.appendChild(labelSpan);

      if (opt.description) {
        const descSpan = document.createElement('span');
        descSpan.className = 'option-description';
        descSpan.textContent = opt.description;
        optBtn.appendChild(descSpan);
      }

      optBtn.addEventListener('click', () => handleQuestionOptionClick(i, opt.label, q.multiSelect));
      optionsDiv.appendChild(optBtn);
    }

    questionDiv.appendChild(optionsDiv);

    // Add "Other" input field
    const otherDiv = document.createElement('div');
    otherDiv.className = 'question-other';
    const otherInput = document.createElement('input');
    otherInput.type = 'text';
    otherInput.className = 'question-other-input';
    otherInput.placeholder = 'Other (type custom answer)';
    otherInput.dataset.questionIndex = i;
    otherInput.addEventListener('input', (e) => handleQuestionOtherInput(i, e.target.value));
    otherDiv.appendChild(otherInput);
    questionDiv.appendChild(otherDiv);

    container.appendChild(questionDiv);
  }

  elements.questionModal.classList.remove('hidden');
}

function handleQuestionOptionClick(questionIndex, label, multiSelect) {
  const questionItem = elements.questionContainer.querySelector(`[data-question-index="${questionIndex}"]`);
  const buttons = questionItem.querySelectorAll('.question-option-btn');
  const otherInput = questionItem.querySelector('.question-other-input');

  if (multiSelect) {
    // Toggle selection for multi-select
    const btn = Array.from(buttons).find(b => b.dataset.label === label);
    if (btn) {
      btn.classList.toggle('selected');
    }
    // Build array of selected options
    const selected = Array.from(buttons)
      .filter(b => b.classList.contains('selected'))
      .map(b => b.dataset.label);
    state.questionAnswers[questionIndex] = selected.length > 0 ? selected.join(', ') : '';
  } else {
    // Single select - clear others
    buttons.forEach(b => b.classList.remove('selected'));
    const btn = Array.from(buttons).find(b => b.dataset.label === label);
    if (btn) {
      btn.classList.add('selected');
    }
    otherInput.value = '';
    state.questionAnswers[questionIndex] = label;
  }
}

function handleQuestionOtherInput(questionIndex, value) {
  const questionItem = elements.questionContainer.querySelector(`[data-question-index="${questionIndex}"]`);
  const buttons = questionItem.querySelectorAll('.question-option-btn');

  if (value.trim()) {
    // Clear button selections when typing in Other
    buttons.forEach(b => b.classList.remove('selected'));
    state.questionAnswers[questionIndex] = value.trim();
  } else {
    // If Other is cleared, remove the answer
    delete state.questionAnswers[questionIndex];
  }
}

function hideQuestionDialog() {
  elements.questionModal.classList.add('hidden');
  state.pendingQuestion = null;
  state.questionAnswers = {};
}

function submitQuestionResponse() {
  console.log('[Question] Submitting response:', state.questionAnswers);
  if (state.pendingQuestion && state.ws && state.ws.readyState === WebSocket.OPEN) {
    // Convert questionAnswers (indexed by position) to the format Claude expects
    const answers = {};
    for (const [index, answer] of Object.entries(state.questionAnswers)) {
      // Use question text as key or fall back to index
      const question = state.pendingQuestion.questions[parseInt(index)];
      const key = question?.question || `question_${index}`;
      answers[key] = answer;
    }

    const response = {
      type: 'question_response',
      sessionId: state.currentSession?.id,
      data: {
        id: state.pendingQuestion.id,
        answers,
      },
    };
    console.log('[Question] Sending response:', response);
    state.ws.send(JSON.stringify(response));
  }
  hideQuestionDialog();
}

function cancelQuestionResponse() {
  console.log('[Question] Cancelling question');
  if (state.pendingQuestion && state.ws && state.ws.readyState === WebSocket.OPEN) {
    const response = {
      type: 'question_response',
      sessionId: state.currentSession?.id,
      data: {
        id: state.pendingQuestion.id,
        cancelled: true,
      },
    };
    state.ws.send(JSON.stringify(response));
  }
  hideQuestionDialog();
}

// Slash command handlers
function handleResumeCommand(args) {
  const sessionId = args.trim();
  if (!sessionId) {
    showCommandFeedback('Usage: /resume <session-id>', 'error');
    return;
  }

  const session = state.sessions.find(s => s.id === sessionId || s.id.startsWith(sessionId));
  if (!session) {
    showCommandFeedback(`Session not found: ${sessionId}`, 'error');
    return;
  }

  selectSession(session.id);
  elements.sessionSelect.value = session.id;
  showCommandFeedback(`Switched to session: ${getSessionDisplayName(session)}`, 'success');
}

function handleModelCommand(args) {
  const model = args.trim().toLowerCase();
  const validModels = ['sonnet', 'opus', 'haiku'];

  if (!validModels.includes(model)) {
    showCommandFeedback(`Invalid model. Use: sonnet, opus, or haiku`, 'error');
    return;
  }

  state.pendingModel = model;
  showCommandFeedback(`Next message will use model: ${model}`, 'success');
}

function handlePlanCommand() {
  state.pendingPlanMode = true;
  showCommandFeedback('Plan mode enabled for next message', 'success');
}

function showCommandFeedback(message, type) {
  // Create a temporary feedback element
  const feedback = document.createElement('div');
  feedback.className = `command-feedback command-feedback-${type}`;
  feedback.textContent = message;

  elements.messages.appendChild(feedback);
  scrollToBottom();

  // Remove after a delay
  setTimeout(() => {
    feedback.remove();
  }, 3000);
}

// Autocomplete functions
function showAutocomplete(commands) {
  if (commands.length === 0) {
    hideAutocomplete();
    return;
  }

  elements.autocompleteList.innerHTML = commands.map((cmd, index) => `
    <div class="autocomplete-item${index === state.autocompleteIndex ? ' selected' : ''}" data-command="${cmd.name}">
      <span class="autocomplete-command">${cmd.name}</span>
      <span class="autocomplete-args">${cmd.args}</span>
      <span class="autocomplete-desc">${cmd.description}</span>
    </div>
  `).join('');

  elements.autocompleteContainer.classList.remove('hidden');
}

function hideAutocomplete() {
  elements.autocompleteContainer.classList.add('hidden');
  state.autocompleteIndex = -1;
}

function filterCommands(input) {
  if (!input.startsWith('/')) return [];

  const search = input.toLowerCase();
  return SLASH_COMMANDS.filter(cmd => cmd.name.toLowerCase().startsWith(search));
}

function selectAutocompleteItem(index) {
  const items = elements.autocompleteList.querySelectorAll('.autocomplete-item');
  items.forEach((item, i) => {
    item.classList.toggle('selected', i === index);
  });
  state.autocompleteIndex = index;
}

function completeCommand() {
  const items = elements.autocompleteList.querySelectorAll('.autocomplete-item');
  if (state.autocompleteIndex >= 0 && state.autocompleteIndex < items.length) {
    const command = items[state.autocompleteIndex].dataset.command;
    elements.messageInput.value = command + ' ';
    hideAutocomplete();
  }
}

function executeSlashCommand(input) {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return false;

  // Parse command and args
  const spaceIndex = trimmed.indexOf(' ');
  const commandName = spaceIndex > 0 ? trimmed.slice(0, spaceIndex) : trimmed;
  const args = spaceIndex > 0 ? trimmed.slice(spaceIndex + 1) : '';

  const command = SLASH_COMMANDS.find(cmd => cmd.name === commandName);
  if (!command) {
    showCommandFeedback(`Unknown command: ${commandName}`, 'error');
    return true;
  }

  command.handler(args);
  return true;
}

function handleAutocompleteInput() {
  const value = elements.messageInput.value;
  const cursorAtEnd = elements.messageInput.selectionStart === value.length;

  // Only show autocomplete if cursor is at end and input starts with /
  if (cursorAtEnd && value.startsWith('/') && !value.includes(' ')) {
    const matches = filterCommands(value);
    if (matches.length > 0) {
      state.autocompleteIndex = 0;
      showAutocomplete(matches);
      return;
    }
  }

  hideAutocomplete();
}

function handleAutocompleteKeydown(e) {
  if (elements.autocompleteContainer.classList.contains('hidden')) {
    return false;
  }

  const items = elements.autocompleteList.querySelectorAll('.autocomplete-item');
  const itemCount = items.length;

  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault();
      if (state.autocompleteIndex > 0) {
        selectAutocompleteItem(state.autocompleteIndex - 1);
      } else {
        selectAutocompleteItem(itemCount - 1);
      }
      return true;

    case 'ArrowDown':
      e.preventDefault();
      if (state.autocompleteIndex < itemCount - 1) {
        selectAutocompleteItem(state.autocompleteIndex + 1);
      } else {
        selectAutocompleteItem(0);
      }
      return true;

    case 'Tab':
      e.preventDefault();
      if (state.autocompleteIndex >= 0) {
        completeCommand();
      }
      return true;

    case 'Escape':
      e.preventDefault();
      hideAutocomplete();
      return true;

    case 'Enter':
      if (!e.shiftKey && state.autocompleteIndex >= 0) {
        e.preventDefault();
        completeCommand();
        return true;
      }
      break;
  }

  return false;
}

function setupEventListeners() {
  elements.sessionSelect.addEventListener('change', (e) => {
    selectSession(e.target.value);
  });

  elements.newSessionBtn.addEventListener('click', () => {
    elements.newSessionModal.classList.remove('hidden');
    elements.sessionNameInput.focus();
  });

  elements.importSessionBtn.addEventListener('click', () => {
    openImportModal();
  });

  elements.cancelImportBtn.addEventListener('click', () => {
    closeImportModal();
  });

  elements.importSessionModal.addEventListener('click', (e) => {
    if (e.target === elements.importSessionModal) {
      closeImportModal();
    }
  });

  elements.importSessionsList.addEventListener('click', (e) => {
    const sessionItem = e.target.closest('.import-session-item');
    if (sessionItem) {
      const sessionId = sessionItem.dataset.sessionId;
      const projectPath = sessionItem.dataset.projectPath;
      const firstPrompt = sessionItem.dataset.firstPrompt;
      forkSession(sessionId, projectPath, firstPrompt);
    }
  });

  elements.cancelModalBtn.addEventListener('click', () => {
    elements.newSessionModal.classList.add('hidden');
    elements.newSessionForm.reset();
    elements.directoryBrowser.classList.add('hidden');
    state.browsePath = '';
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
    elements.directoryBrowser.classList.add('hidden');
    state.browsePath = '';
  });

  elements.messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const content = elements.messageInput.value.trim();
    if (content) {
      hideAutocomplete();

      // Check if it's a slash command
      if (content.startsWith('/')) {
        executeSlashCommand(content);
        elements.messageInput.value = '';
        elements.messageInput.style.height = 'auto';
        return;
      }

      sendMessage(content);
      elements.messageInput.value = '';
      elements.messageInput.style.height = 'auto';
    }
  });

  elements.messageInput.addEventListener('keydown', (e) => {
    // Handle autocomplete navigation first
    if (handleAutocompleteKeydown(e)) {
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      elements.messageForm.dispatchEvent(new Event('submit'));
    }
  });

  elements.messageInput.addEventListener('input', () => {
    elements.messageInput.style.height = 'auto';
    elements.messageInput.style.height = elements.messageInput.scrollHeight + 'px';

    // Handle autocomplete
    handleAutocompleteInput();
  });

  elements.pauseBtn.addEventListener('click', togglePause);
  elements.abortBtn.addEventListener('click', abortMessage);
  elements.voiceBtn.addEventListener('click', toggleRecording);

  // Permission dialog event listeners
  elements.permissionAllow.addEventListener('click', () => respondToPermission(true, false));
  elements.permissionAllowSimilar.addEventListener('click', () => respondToPermission(true, true));
  elements.permissionDeny.addEventListener('click', () => respondToPermission(false));

  // Question dialog event listeners
  elements.questionSubmit.addEventListener('click', submitQuestionResponse);
  elements.questionCancel.addEventListener('click', cancelQuestionResponse);

  elements.newSessionModal.addEventListener('click', (e) => {
    if (e.target === elements.newSessionModal) {
      elements.newSessionModal.classList.add('hidden');
      elements.newSessionForm.reset();
      elements.directoryBrowser.classList.add('hidden');
      state.browsePath = '';
    }
  });

  // Click handler for streaming tools toggle
  const streamingToolsToggle = elements.streamingTools.querySelector('.tools-toggle');
  if (streamingToolsToggle) {
    streamingToolsToggle.addEventListener('click', () => {
      elements.streamingTools.classList.toggle('collapsed');
    });
  }

  // Autocomplete click handler
  elements.autocompleteList.addEventListener('click', (e) => {
    const item = e.target.closest('.autocomplete-item');
    if (item) {
      const command = item.dataset.command;
      elements.messageInput.value = command + ' ';
      elements.messageInput.focus();
      hideAutocomplete();
    }
  });

  // Hide autocomplete when clicking outside
  document.addEventListener('click', (e) => {
    if (!elements.autocompleteContainer.contains(e.target) &&
        e.target !== elements.messageInput) {
      hideAutocomplete();
    }
  });

  // Directory browser event listeners
  elements.browseBtn.addEventListener('click', toggleDirectoryBrowser);

  elements.directoryList.addEventListener('click', handleDirectoryClick);
  elements.directoryList.addEventListener('dblclick', handleDirectoryDblClick);

  // Refresh browser when base directory changes
  elements.directorySelect.addEventListener('change', () => {
    state.browsePath = '';
    elements.directoryInput.value = '';
    if (!elements.directoryBrowser.classList.contains('hidden')) {
      browseDirectories('');
    }
  });

  // Handle browser back/forward for sessions
  window.addEventListener('popstate', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session');
    if (sessionId !== state.currentSession?.id) {
      elements.sessionSelect.value = sessionId || '';
      // Avoid recursive URL updates by directly setting state
      if (!sessionId) {
        if (state.currentSession) {
          unsubscribeFromSession(state.currentSession.id);
        }
        state.currentSession = null;
        elements.sessionInfo.classList.add('hidden');
        elements.messages.innerHTML = '';
        updateUIState();
      } else {
        const session = state.sessions.find(s => s.id === sessionId);
        if (session) {
          if (state.currentSession) {
            unsubscribeFromSession(state.currentSession.id);
          }
          state.currentSession = session;
          elements.sessionName.textContent = getSessionDisplayName(session);
          elements.sessionDir.textContent = session.workingDirectory;
          elements.sessionInfo.classList.remove('hidden');
          updatePauseButton();
          subscribeToSession(sessionId);
          loadMessages(sessionId);
          updateUIState();
        }
      }
    }
  });
}

init();
