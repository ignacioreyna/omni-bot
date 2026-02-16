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
  // Pending session - not yet created on server
  pendingSession: null, // { workingDirectory: string }
  // Activity tracking
  lastActivityTime: null, // Timestamp of last SDK event
  currentToolName: null, // Currently executing tool
  // Sidebar state
  sidebarCollapsed: false,
  sidebarOpen: false, // For mobile
  // Import modal state
  importMode: 'recent',
  importBrowsePath: '',
  allowedDirectories: [],
  // Confirm dialog callback
  confirmCallback: null,
  // Conductor workspace state
  conductorAvailable: false,
  conductorWorkspaces: [],
  conductorLoaded: false,
};

// Slash commands definition
const SLASH_COMMANDS = [
  {
    name: '/new',
    args: '',
    description: 'Open new session modal',
    handler: handleNewCommand,
  },
  {
    name: '/switch',
    args: '<name>',
    description: 'Fuzzy switch to session',
    handler: handleSwitchCommand,
  },
  {
    name: '/import',
    args: '',
    description: 'Import local Claude session',
    handler: handleImportCommand,
  },
  {
    name: '/rename',
    args: '<name>',
    description: 'Rename current session',
    handler: handleRenameCommand,
  },
  {
    name: '/delete',
    args: '',
    description: 'Delete current session',
    handler: handleDeleteCommand,
  },
  {
    name: '/export',
    args: '[json|md]',
    description: 'Export current session',
    handler: handleExportCommand,
  },
  {
    name: '/search',
    args: '<query>',
    description: 'Search sessions and messages',
    handler: handleSearchCommand,
  },
  {
    name: '/abort',
    args: '',
    description: 'Abort current processing',
    handler: handleAbortCommand,
  },
  {
    name: '/resume',
    args: '[session-id]',
    description: 'Switch to session (or search)',
    handler: handleResumeCommand,
  },
  {
    name: '/model',
    args: '[haiku|sonnet|opus]',
    description: 'Change model for session',
    handler: handleModelCommand,
  },
  {
    name: '/plan',
    args: '',
    description: 'Enable plan mode for next message',
    handler: handlePlanCommand,
  },
  {
    name: '/teleport',
    args: '',
    description: 'Get command to continue in terminal',
    handler: handleTeleportCommand,
  },
];

const elements = {
  // Sidebar elements
  sidebar: document.getElementById('sidebar'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  sidebarOverlay: document.getElementById('sidebar-overlay'),
  sidebarSearchBtn: document.getElementById('sidebar-search-btn'),
  sidebarSearchContainer: document.getElementById('sidebar-search-container'),
  sessionSearch: document.getElementById('session-search'),
  sessionsList: document.getElementById('sessions-list'),
  sidebarUser: document.getElementById('sidebar-user'),
  hamburgerBtn: document.getElementById('hamburger-btn'),
  // Header elements
  sessionName: document.getElementById('session-name'),
  sessionNameInputInline: document.getElementById('session-name-input-inline'),
  // Main content
  mainContent: document.getElementById('main-content'),
  newSessionBtn: document.getElementById('new-session-btn'),
  importSessionBtn: document.getElementById('import-session-btn'),
  sidebarImportBtn: document.getElementById('sidebar-import-btn'),
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
  voiceCancelBtn: document.getElementById('voice-cancel-btn'),
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
  importModeRecent: document.getElementById('import-mode-recent'),
  importModeBrowse: document.getElementById('import-mode-browse'),
  importRecentPanel: document.getElementById('import-recent-panel'),
  importBrowsePanel: document.getElementById('import-browse-panel'),
  importLoading: document.getElementById('import-loading'),
  importSessionsList: document.getElementById('import-sessions-list'),
  importEmpty: document.getElementById('import-empty'),
  importDirectorySelect: document.getElementById('import-directory-select'),
  importDirectoryInput: document.getElementById('import-directory-input'),
  importBrowseBtn: document.getElementById('import-browse-btn'),
  importDirectoryBrowser: document.getElementById('import-directory-browser'),
  importDirectoryList: document.getElementById('import-directory-list'),
  importLoadSessionsBtn: document.getElementById('import-load-sessions-btn'),
  importBrowseLoading: document.getElementById('import-browse-loading'),
  importBrowseSessionsList: document.getElementById('import-browse-sessions-list'),
  importBrowseEmpty: document.getElementById('import-browse-empty'),
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
  // Confirm modal elements
  confirmModal: document.getElementById('confirm-modal'),
  confirmTitle: document.getElementById('confirm-title'),
  confirmMessage: document.getElementById('confirm-message'),
  confirmOk: document.getElementById('confirm-ok'),
  confirmCancel: document.getElementById('confirm-cancel'),
  // Autocomplete elements
  autocompleteContainer: document.getElementById('autocomplete-container'),
  autocompleteList: document.getElementById('autocomplete-list'),
};

// Track tool usage during streaming
let streamingToolCount = 0;

async function init() {
  // Load sidebar state from localStorage
  loadSidebarState();

  // Check auth mode and get user info
  await checkAuth();

  await loadSessions();
  await loadAllowedDirectories();
  await checkConductorAvailable();

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
    selectSession(sessionId);
  }
}

function loadSidebarState() {
  const collapsed = localStorage.getItem('sidebarCollapsed');
  state.sidebarCollapsed = collapsed === 'true';
  if (state.sidebarCollapsed) {
    elements.sidebar.classList.add('collapsed');
    elements.mainContent.classList.add('sidebar-collapsed');
  }
}

function saveSidebarState() {
  localStorage.setItem('sidebarCollapsed', state.sidebarCollapsed);
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  elements.sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
  elements.mainContent.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  saveSidebarState();
}

function openMobileSidebar() {
  state.sidebarOpen = true;
  elements.sidebar.classList.add('open');
  elements.sidebarOverlay.classList.add('visible');
  elements.sidebarOverlay.classList.remove('hidden');
}

function closeMobileSidebar() {
  state.sidebarOpen = false;
  elements.sidebar.classList.remove('open');
  elements.sidebarOverlay.classList.remove('visible');
  elements.sidebarOverlay.classList.add('hidden');
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
    const userAvatar = elements.sidebarUser.querySelector('.user-avatar');
    const userEmailText = elements.sidebarUser.querySelector('.user-email-text');

    if (userAvatar && state.user.email) {
      userAvatar.textContent = state.user.email.charAt(0).toUpperCase();
    }
    if (userEmailText) {
      userEmailText.textContent = state.user.email;
    }
  }
}

async function loadSessions() {
  try {
    const response = await fetch('/api/sessions');
    state.sessions = await response.json();
    renderSessionsList();
  } catch (err) {
    console.error('Failed to load sessions:', err);
  }
}

async function loadAllowedDirectories() {
  try {
    const response = await fetch('/api/sessions/allowed-directories');
    const directories = await response.json();
    state.allowedDirectories = directories;
    elements.directorySelect.innerHTML = directories
      .map(dir => `<option value="${dir}">${dir}</option>`)
      .join('');
  } catch (err) {
    console.error('Failed to load directories:', err);
  }
}

async function checkConductorAvailable() {
  try {
    const res = await fetch('/api/conductor/available');
    const data = await res.json();
    state.conductorAvailable = data.available;
    if (state.conductorAvailable) {
      document.getElementById('workspace-picker-tabs').classList.remove('hidden');
    }
  } catch {
    state.conductorAvailable = false;
  }
}

async function loadConductorWorkspaces() {
  if (!state.conductorAvailable || state.conductorLoaded) return;

  const loading = document.getElementById('conductor-loading');
  const empty = document.getElementById('conductor-empty');
  const list = document.getElementById('conductor-workspaces-list');

  loading.classList.remove('hidden');
  empty.classList.add('hidden');
  list.innerHTML = '';

  try {
    const res = await fetch('/api/conductor/workspaces');
    state.conductorWorkspaces = await res.json();
    state.conductorLoaded = true;
    renderConductorWorkspaces();
  } catch (err) {
    console.error('Failed to load Conductor workspaces:', err);
    empty.textContent = 'Failed to load workspaces.';
    empty.classList.remove('hidden');
  } finally {
    loading.classList.add('hidden');
  }
}

function formatRelativeTime(dateStr) {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function renderConductorWorkspaces() {
  const list = document.getElementById('conductor-workspaces-list');
  const empty = document.getElementById('conductor-empty');

  if (state.conductorWorkspaces.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  list.innerHTML = state.conductorWorkspaces.map(repo => {
    const worktreesHtml = repo.worktrees.map(wt => {
      const statusIcon = wt.status === 'clean' ? '\u2713' : '\u2731';
      const statusClass = wt.status === 'clean' ? 'conductor-status-clean' : 'conductor-status-dirty';
      const commitInfo = wt.lastCommit
        ? `${wt.lastCommit.hash} \u00b7 ${formatRelativeTime(wt.lastCommit.date)}`
        : 'no commits';

      return `
        <div class="conductor-worktree" data-workspace-path="${escapeHtml(wt.path)}">
          <div class="conductor-worktree-name">${escapeHtml(wt.worktreeName)}</div>
          <div class="conductor-worktree-branch">${escapeHtml(wt.branch)}</div>
          <div class="conductor-worktree-meta">
            <span class="${statusClass}">${statusIcon} ${wt.status}</span>
            <span>${commitInfo}</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="conductor-repo">
        <div class="conductor-repo-header">
          <span class="collapse-icon">\u25BC</span>
          ${escapeHtml(repo.repoName)}
          <span class="repo-count">(${repo.worktrees.length})</span>
        </div>
        <div class="conductor-worktree-list">
          ${worktreesHtml}
        </div>
      </div>
    `;
  }).join('');
}

function switchWorkspacePickerMode(mode) {
  document.querySelectorAll('.workspace-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  const browseContent = document.getElementById('browse-mode-content');
  const conductorContent = document.getElementById('conductor-mode-content');
  const browseActions = document.getElementById('browse-modal-actions');
  const conductorActions = document.getElementById('conductor-modal-actions');

  browseContent.classList.toggle('hidden', mode !== 'browse');
  conductorContent.classList.toggle('hidden', mode !== 'conductor');
  browseActions.classList.toggle('hidden', mode !== 'browse');
  conductorActions.classList.toggle('hidden', mode !== 'conductor');

  // Disable directory-select required when in conductor mode
  elements.directorySelect.required = mode === 'browse';

  if (mode === 'conductor' && !state.conductorLoaded) {
    loadConductorWorkspaces();
  }
}

function getSessionDisplayName(session) {
  if (session.isDraft) {
    return '(New Session)';
  }
  return session.name || '(Untitled)';
}

function renderSessionsList() {
  const html = state.sessions.map(session => {
    const isActive = state.currentSession?.id === session.id;
    const statusClass = session.status === 'active' ? 'active' :
                       session.status === 'paused' ? 'paused' : 'terminated';
    const displayName = getSessionDisplayName(session);

    return `
      <div class="session-item${isActive ? ' active' : ''}" data-session-id="${session.id}">
        <span class="session-status ${statusClass}"></span>
        <span class="session-title" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
      </div>
    `;
  }).join('');

  elements.sessionsList.innerHTML = html;
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
  // If pending session, create it first
  if (state.pendingSession) {
    createAndSendFirstMessage(content);
    return;
  }

  if (!state.currentSession || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  sendMessageToSession(content);
}

function sendMessageToSession(content) {
  // Build message options from pending state
  // Use pendingModel if set, otherwise fall back to session's persisted model
  const options = {};
  const modelToUse = state.pendingModel || state.currentSession?.model;
  if (modelToUse) {
    options.model = modelToUse;
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

async function createAndSendFirstMessage(content) {
  const { workingDirectory } = state.pendingSession;
  state.pendingSession = null;

  try {
    // Create session via API (no name - will be draft, title generated on server)
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workingDirectory }),
    });

    if (!response.ok) {
      const error = await response.json();
      alert(error.error || 'Failed to create session');
      // Restore pending session state so user can try again
      state.pendingSession = { workingDirectory };
      return;
    }

    const session = await response.json();
    state.sessions.unshift(session);
    state.currentSession = session;
    renderSessionsList();

    // Update URL with new session ID
    const url = new URL(window.location);
    url.searchParams.set('session', session.id);
    window.history.pushState({}, '', url);

    // Subscribe to the new session
    subscribeToSession(session.id);

    // Now send the message
    sendMessageToSession(content);
  } catch (err) {
    console.error('Failed to create session:', err);
    alert('Failed to create session');
    // Restore pending session state so user can try again
    state.pendingSession = { workingDirectory };
  }
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
    case 'subscribed':
      // Handle catch-up data when subscribing to an active session
      if (message.isProcessing) {
        state.isProcessing = true;
        showStreamingMessage();
        updateUIState();
      }
      if (message.streamingText) {
        appendStreamingText(message.streamingText);
      }
      break;
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
    case 'event':
      handleActivityEvent(message.data);
      break;
    case 'result':
      state.lastResultData = message.data;
      finalizeStreamingMessage();
      state.isProcessing = false;
      state.currentToolName = null;
      updateUIState();
      break;
    case 'error':
      console.error('Server error:', message.data);
      appendMessage('assistant', `Error: ${message.data}`);
      hideStreamingMessage();
      state.isProcessing = false;
      state.currentToolName = null;
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

function handleActivityEvent(event) {
  state.lastActivityTime = Date.now();

  if (event.type === 'tool_progress') {
    state.currentToolName = event.tool_name;
    const elapsed = Math.round(event.elapsed_time_seconds || 0);
    updateThinkingIndicator(`Running: ${event.tool_name} (${elapsed}s)`);
  }
}

function updateThinkingIndicator(text) {
  const indicator = elements.streamingText.querySelector('.thinking-indicator');
  if (indicator) {
    const textEl = indicator.querySelector('.thinking-text');
    if (textEl) {
      textEl.textContent = text;
    }
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

  // Re-render sessions list
  renderSessionsList();
}

function appendMessage(role, content, metadata = null) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  const rendered = role === 'assistant' ? renderMarkdown(content) : escapeHtml(content);

  // Build usage footer if metadata present
  let usageHtml = '';
  if (role === 'assistant' && metadata) {
    const usageText = formatUsageFooter(metadata);
    if (usageText) {
      usageHtml = `<div class="message-usage">${usageText}</div>`;
    }
  }

  div.innerHTML = `<div class="message-content">${rendered}</div>${usageHtml}`;
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
  // Show thinking indicator initially
  elements.streamingText.innerHTML = '<span class="thinking-indicator"><span class="thinking-text">Thinking</span><span class="thinking-dots"></span></span>';
  state.lastActivityTime = Date.now();
  state.currentToolName = null;
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
  // Clear thinking indicator if present (on first real text)
  const thinkingIndicator = elements.streamingText.querySelector('.thinking-indicator');
  if (thinkingIndicator) {
    elements.streamingText.innerHTML = '';
  }
  state.lastActivityTime = Date.now();
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
    parts.push(`${modelName} \u2022 ${tokenPart}`);
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

  return parts.join(' \u2022 ');
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
            <span class="tools-icon">&#9889;</span>
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
    elements.sessionName.textContent = '';
    elements.messages.innerHTML = '';
    updateUIState();
    renderSessionsList();
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

  subscribeToSession(sessionId);
  await loadMessages(sessionId);
  updateUIState();
  renderSessionsList();

  // Update URL with session ID
  const url = new URL(window.location);
  url.searchParams.set('session', sessionId);
  window.history.pushState({}, '', url);

  // Close mobile sidebar after selection
  if (state.sidebarOpen) {
    closeMobileSidebar();
  }
}

async function loadMessages(sessionId) {
  try {
    const response = await fetch(`/api/messages/${sessionId}`);
    const messages = await response.json();
    elements.messages.innerHTML = '';
    for (const msg of messages) {
      appendMessage(msg.role, msg.content, msg.metadata);
    }
  } catch (err) {
    console.error('Failed to load messages:', err);
  }
}

function updateUIState() {
  const hasSession = !!state.currentSession || !!state.pendingSession;
  const isActive = (state.currentSession?.status === 'active') || !!state.pendingSession;
  const canSend = isActive && !state.isProcessing;

  elements.messageInput.disabled = !canSend;
  elements.sendBtn.disabled = !canSend;
  elements.voiceBtn.disabled = !canSend || state.isTranscribing;
  elements.abortBtn.classList.toggle('hidden', !state.isProcessing);
}

// Rename session functions
function startEditingSessionName() {
  if (!state.currentSession || state.currentSession.isDraft) return;

  elements.sessionName.classList.add('hidden');
  elements.sessionNameInputInline.classList.remove('hidden');
  elements.sessionNameInputInline.value = state.currentSession.name || '';
  elements.sessionNameInputInline.focus();
  elements.sessionNameInputInline.select();
}

function cancelEditingSessionName() {
  elements.sessionName.classList.remove('hidden');
  elements.sessionNameInputInline.classList.add('hidden');
}

async function saveSessionName() {
  const newName = elements.sessionNameInputInline.value.trim();
  if (!newName || !state.currentSession) {
    cancelEditingSessionName();
    return;
  }

  try {
    const response = await fetch(`/api/sessions/${state.currentSession.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });

    if (response.ok) {
      const updatedSession = await response.json();
      state.currentSession = updatedSession;
      const idx = state.sessions.findIndex(s => s.id === updatedSession.id);
      if (idx >= 0) {
        state.sessions[idx] = updatedSession;
      }
      elements.sessionName.textContent = getSessionDisplayName(updatedSession);
      renderSessionsList();
    }
  } catch (err) {
    console.error('Failed to rename session:', err);
  }

  cancelEditingSessionName();
}

// Delete session functions
async function deleteSession() {
  if (!state.currentSession || state.currentSession.isDraft) return;

  const sessionName = getSessionDisplayName(state.currentSession);

  showConfirmDialog(
    'Delete Session',
    `Delete session "${sessionName}"? This cannot be undone.`,
    async () => {
      try {
        const response = await fetch(`/api/sessions/${state.currentSession.id}`, {
          method: 'DELETE',
        });

        if (response.ok) {
          // Remove from sessions list
          state.sessions = state.sessions.filter(s => s.id !== state.currentSession.id);

          // Unsubscribe and clear current session
          unsubscribeFromSession(state.currentSession.id);
          state.currentSession = null;

          // Update UI
          elements.sessionName.textContent = '';
          elements.messages.innerHTML = '';
          renderSessionsList();
          updateUIState();

          // Clear URL param
          const url = new URL(window.location);
          url.searchParams.delete('session');
          window.history.pushState({}, '', url);

          showCommandFeedback(`Session "${sessionName}" deleted`, 'success');
        } else {
          const error = await response.json();
          showCommandFeedback(error.error || 'Failed to delete session', 'error');
        }
      } catch (err) {
        console.error('Failed to delete session:', err);
        showCommandFeedback('Failed to delete session', 'error');
      }
    }
  );
}

// Confirm dialog functions
function showConfirmDialog(title, message, callback) {
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  state.confirmCallback = callback;
  elements.confirmModal.classList.remove('hidden');
}

function hideConfirmDialog() {
  elements.confirmModal.classList.add('hidden');
  state.confirmCallback = null;
}

// Search sessions functions
let searchDebounceTimer = null;
let isSearching = false;

async function searchSessions(query) {
  if (!query || query.trim().length === 0) {
    clearSearch();
    return;
  }

  isSearching = true;

  try {
    const response = await fetch(`/api/sessions/search?q=${encodeURIComponent(query)}`);
    if (response.ok) {
      const results = await response.json();
      renderSearchResults(results);
    }
  } catch (err) {
    console.error('Search failed:', err);
  }
}

function renderSearchResults(sessions) {
  const html = sessions.map(session => {
    const isActive = state.currentSession?.id === session.id;
    const statusClass = session.status === 'active' ? 'active' :
                       session.status === 'paused' ? 'paused' : 'terminated';
    const displayName = getSessionDisplayName(session);

    return `
      <div class="session-item${isActive ? ' active' : ''}" data-session-id="${session.id}">
        <span class="session-status ${statusClass}"></span>
        <span class="session-title" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
      </div>
    `;
  }).join('');

  elements.sessionsList.innerHTML = html;
}

function clearSearch() {
  isSearching = false;
  elements.sessionSearch.value = '';
  renderSessionsList();
}

function handleSearchInput(e) {
  const query = e.target.value;

  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }

  if (!query || query.trim().length === 0) {
    clearSearch();
    return;
  }

  searchDebounceTimer = setTimeout(() => {
    searchSessions(query);
  }, 300);
}

function focusSidebarSearch(query = '') {
  // Expand sidebar if collapsed (on desktop)
  if (state.sidebarCollapsed && window.innerWidth > 768) {
    toggleSidebar();
  }
  // Open sidebar on mobile
  if (window.innerWidth <= 768 && !state.sidebarOpen) {
    openMobileSidebar();
  }
  // Small delay to allow sidebar animation to complete
  setTimeout(() => {
    elements.sessionSearch.value = query;
    elements.sessionSearch.focus();
    if (query) {
      searchSessions(query);
    }
  }, state.sidebarCollapsed ? 0 : 50);
}

// Export session functions
async function exportSession(format = 'json') {
  if (!state.currentSession || state.currentSession.isDraft) {
    showCommandFeedback('No session to export', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/sessions/${state.currentSession.id}/export?format=${format}`);
    if (!response.ok) {
      const error = await response.json();
      showCommandFeedback(error.error || 'Export failed', 'error');
      return;
    }

    // Get filename from Content-Disposition header
    const disposition = response.headers.get('Content-Disposition');
    let filename = `session.${format === 'markdown' ? 'md' : 'json'}`;
    if (disposition) {
      const match = disposition.match(/filename="(.+)"/);
      if (match) {
        filename = match[1];
      }
    }

    // Download the file
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showCommandFeedback(`Exported as ${format.toUpperCase()}`, 'success');
  } catch (err) {
    console.error('Export failed:', err);
    showCommandFeedback('Export failed', 'error');
  }
}

async function createSession(name, workingDirectory) {
  // If name is provided, create immediately (legacy behavior for named sessions)
  if (name) {
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
      renderSessionsList();
      selectSession(session.id);
    } catch (err) {
      console.error('Failed to create session:', err);
      alert('Failed to create session');
    }
    return;
  }

  // No name provided - create a pending session (defer API call until first message)
  state.pendingSession = { workingDirectory };

  // Clear current session state
  if (state.currentSession) {
    unsubscribeFromSession(state.currentSession.id);
  }
  state.currentSession = null;

  // Show pending session UI
  elements.sessionName.textContent = '(New Session)';
  elements.messages.innerHTML = '';
  renderSessionsList();

  // Clear URL param
  const url = new URL(window.location);
  url.searchParams.delete('session');
  window.history.pushState({}, '', url);

  updateUIState();
  elements.messageInput.focus();

  // Close mobile sidebar
  if (state.sidebarOpen) {
    closeMobileSidebar();
  }
}

// Import session functions
async function openImportModal() {
  elements.importSessionModal.classList.remove('hidden');
  setImportMode('recent');
  loadImportRecentSessions();
  loadImportAllowedDirectories();
}

function closeImportModal() {
  elements.importSessionModal.classList.add('hidden');
  // Reset browse state
  state.importBrowsePath = '';
  elements.importDirectoryInput.value = '';
  elements.importDirectoryBrowser.classList.add('hidden');
  elements.importBrowseSessionsList.classList.add('hidden');
  elements.importBrowseEmpty.classList.add('hidden');
  elements.importBrowseLoading.classList.add('hidden');
}

function setImportMode(mode) {
  state.importMode = mode;
  elements.importModeRecent.classList.toggle('active', mode === 'recent');
  elements.importModeBrowse.classList.toggle('active', mode === 'browse');
  elements.importRecentPanel.classList.toggle('hidden', mode !== 'recent');
  elements.importBrowsePanel.classList.toggle('hidden', mode !== 'browse');
}

async function loadImportRecentSessions() {
  elements.importLoading.classList.remove('hidden');
  elements.importSessionsList.classList.add('hidden');
  elements.importEmpty.classList.add('hidden');

  try {
    const response = await fetch('/api/local-sessions/recent?limit=5');
    const sessions = await response.json();

    elements.importLoading.classList.add('hidden');

    if (!sessions.length) {
      elements.importEmpty.classList.remove('hidden');
      return;
    }

    renderImportSessionsFlat(sessions, elements.importSessionsList, true);
    elements.importSessionsList.classList.remove('hidden');
  } catch (err) {
    console.error('Failed to load recent sessions:', err);
    elements.importLoading.textContent = 'Failed to load recent sessions';
  }
}

async function loadImportAllowedDirectories() {
  try {
    const response = await fetch('/api/sessions/allowed-directories');
    const directories = await response.json();
    state.allowedDirectories = directories;
    elements.importDirectorySelect.innerHTML = directories
      .map(dir => `<option value="${dir}">${dir}</option>`)
      .join('');
  } catch (err) {
    console.error('Failed to load directories:', err);
  }
}

async function loadImportBrowseSessions() {
  const base = elements.importDirectorySelect.value;
  if (!base) return;

  const sub = elements.importDirectoryInput.value.trim();
  const fullPath = sub ? base + '/' + sub : base;

  elements.importBrowseLoading.classList.remove('hidden');
  elements.importBrowseSessionsList.classList.add('hidden');
  elements.importBrowseEmpty.classList.add('hidden');

  try {
    const response = await fetch(`/api/local-sessions/by-directory?path=${encodeURIComponent(fullPath)}`);
    const sessions = await response.json();

    elements.importBrowseLoading.classList.add('hidden');

    if (!response.ok) {
      elements.importBrowseEmpty.textContent = sessions.error || 'Failed to load sessions';
      elements.importBrowseEmpty.classList.remove('hidden');
      return;
    }

    if (!sessions.length) {
      elements.importBrowseEmpty.textContent = 'No sessions found for this directory.';
      elements.importBrowseEmpty.classList.remove('hidden');
      return;
    }

    renderImportSessionsFlat(sessions, elements.importBrowseSessionsList, true);
    elements.importBrowseSessionsList.classList.remove('hidden');
  } catch (err) {
    console.error('Failed to load browse sessions:', err);
    elements.importBrowseLoading.classList.add('hidden');
    elements.importBrowseEmpty.textContent = 'Failed to load sessions';
    elements.importBrowseEmpty.classList.remove('hidden');
  }
}

function shortenPath(fullPath) {
  for (const dir of state.allowedDirectories) {
    if (fullPath.startsWith(dir + '/')) return fullPath.slice(dir.length + 1);
    if (fullPath === dir) return fullPath.split('/').pop() || fullPath;
  }
  return fullPath;
}

function renderImportSessionsFlat(sessions, container, showProject = false) {
  const html = sessions.map(session => {
    const preview = session.firstPrompt || 'No preview available';
    const modified = session.modified ? formatRelativeTime(session.modified) : '';
    const branch = session.gitBranch ? `<span class="import-branch">${session.gitBranch}</span>` : '';
    const projectLabel = showProject && session.projectPath
      ? `<div class="import-session-project">${escapeHtml(shortenPath(session.projectPath))}</div>`
      : '';

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
        ${projectLabel}
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

// Import modal directory browser functions
async function importBrowseDirectories(subpath = '') {
  const base = elements.importDirectorySelect.value;
  if (!base) return;

  try {
    const params = new URLSearchParams({ base, path: subpath });
    const response = await fetch(`/api/sessions/browse?${params}`);
    if (!response.ok) return;

    const data = await response.json();
    state.importBrowsePath = data.currentPath;
    renderImportDirectoryList(data.directories);
  } catch (err) {
    console.error('Failed to browse import directories:', err);
  }
}

function renderImportDirectoryList(directories) {
  const items = [];

  if (state.importBrowsePath) {
    items.push(`<div class="directory-item parent" data-path="..">.. (parent)</div>`);
  }

  if (directories.length === 0 && !state.importBrowsePath) {
    items.push(`<div class="directory-empty">No subdirectories</div>`);
  } else {
    for (const dir of directories) {
      const fullPath = state.importBrowsePath ? `${state.importBrowsePath}/${dir}` : dir;
      const isSelected = elements.importDirectoryInput.value === fullPath;
      items.push(`<div class="directory-item${isSelected ? ' selected' : ''}" data-path="${fullPath}">${dir}</div>`);
    }
  }

  elements.importDirectoryList.innerHTML = items.join('');
}

function handleImportDirectoryClick(e) {
  const item = e.target.closest('.directory-item');
  if (!item) return;

  const itemPath = item.dataset.path;

  if (itemPath === '..') {
    const parts = state.importBrowsePath.split('/');
    parts.pop();
    importBrowseDirectories(parts.join('/'));
  } else {
    elements.importDirectoryInput.value = itemPath;
    renderImportDirectoryList(
      Array.from(elements.importDirectoryList.querySelectorAll('.directory-item:not(.parent)')).map(el => {
        return el.dataset.path.split('/').pop();
      })
    );
  }
}

function handleImportDirectoryDblClick(e) {
  const item = e.target.closest('.directory-item');
  if (!item || item.classList.contains('parent')) return;
  importBrowseDirectories(item.dataset.path);
}

function toggleImportDirectoryBrowser() {
  const isHidden = elements.importDirectoryBrowser.classList.contains('hidden');
  if (isHidden) {
    elements.importDirectoryBrowser.classList.remove('hidden');
    importBrowseDirectories(elements.importDirectoryInput.value || '');
  } else {
    elements.importDirectoryBrowser.classList.add('hidden');
  }
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

  // Show loading feedback on modal content
  const modalContent = document.querySelector('#import-session-modal .modal-content');
  if (modalContent) {
    modalContent.style.opacity = '0.5';
    modalContent.style.pointerEvents = 'none';
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch('/api/sessions/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        workingDirectory: projectPath,
        localSessionId,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const error = await response.json();
      alert(error.error || 'Failed to import session');
      return;
    }

    const session = await response.json();
    state.sessions.unshift(session);
    renderSessionsList();
    selectSession(session.id);
    closeImportModal();
  } catch (err) {
    console.error('Failed to fork session:', err);
    const msg = err.name === 'AbortError'
      ? 'Import timed out. The server may be busy.'
      : 'Failed to import session';
    alert(msg);
  } finally {
    if (modalContent) {
      modalContent.style.opacity = '';
      modalContent.style.pointerEvents = '';
    }
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

// Filter directory list based on search term
function filterDirectoryList(searchTerm) {
  const items = elements.directoryList.querySelectorAll('.directory-item:not(.parent)');
  const term = searchTerm.toLowerCase();
  items.forEach(item => {
    const name = item.textContent.toLowerCase();
    item.classList.toggle('hidden', term && !name.includes(term));
  });
}

// Handle subdirectory input changes for filtering
function handleDirectoryInputChange(value) {
  // Auto-open browser if not open
  if (elements.directoryBrowser.classList.contains('hidden')) {
    elements.directoryBrowser.classList.remove('hidden');
    browseDirectories('');
  }
  // Filter after a small delay to allow DOM update
  setTimeout(() => filterDirectoryList(value), 50);
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
    state.mediaRecorder.stream = stream; // Store reference for cancelRecording
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

function cancelRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
    // Remove the onstop handler to prevent transcription
    state.mediaRecorder.onstop = () => {
      // Just stop the tracks, don't transcribe
      if (state.mediaRecorder?.stream) {
        state.mediaRecorder.stream.getTracks().forEach((t) => t.stop());
      }
    };
    state.mediaRecorder.stop();
  }
  state.audioChunks = [];
  state.isRecording = false;
  updateVoiceButtonState();
}

function showTranscribingIndicator() {
  const div = document.createElement('div');
  div.className = 'message user transcribing-indicator';
  div.id = 'transcribing-indicator';
  div.innerHTML = '<div class="message-content">Transcribing<span class="transcribing-dots"></span></div>';
  elements.messages.appendChild(div);
  scrollToBottom();
}

function hideTranscribingIndicator() {
  const indicator = document.getElementById('transcribing-indicator');
  if (indicator) {
    indicator.remove();
  }
}

async function transcribeAndSend(audioBlob) {
  state.isTranscribing = true;
  updateVoiceButtonState();
  showTranscribingIndicator();

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
    hideTranscribingIndicator();
    if (data.transcript && data.transcript.trim()) {
      sendMessage(data.transcript.trim());
    }
  } catch (err) {
    console.error('Transcription failed:', err);
    hideTranscribingIndicator();
    alert('Transcription failed: ' + err.message);
  }

  state.isTranscribing = false;
  updateVoiceButtonState();
}

function updateVoiceButtonState() {
  if (state.isRecording) {
    elements.voiceBtn.classList.add('recording');
    elements.voiceIcon.textContent = '\u23F9';
    elements.voiceBtn.title = 'Stop recording';
    elements.voiceCancelBtn.classList.remove('hidden');
  } else if (state.isTranscribing) {
    elements.voiceBtn.classList.remove('recording');
    elements.voiceBtn.classList.add('transcribing');
    elements.voiceIcon.textContent = '...';
    elements.voiceBtn.title = 'Transcribing...';
    elements.voiceBtn.disabled = true;
    elements.voiceCancelBtn.classList.add('hidden');
  } else {
    elements.voiceBtn.classList.remove('recording', 'transcribing');
    elements.voiceIcon.textContent = '\uD83C\uDF99';
    elements.voiceBtn.title = 'Record voice message';
    elements.voiceCancelBtn.classList.add('hidden');
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
function handleNewCommand() {
  elements.newSessionModal.classList.remove('hidden');
  elements.sessionNameInput.focus();
}

function handleSwitchCommand(args) {
  const query = args.trim().toLowerCase();
  if (!query) {
    showCommandFeedback('Usage: /switch <name>', 'error');
    return;
  }

  // Fuzzy match by name
  const session = state.sessions.find(s => {
    const name = getSessionDisplayName(s).toLowerCase();
    return name.includes(query);
  });

  if (!session) {
    showCommandFeedback(`No session matching: ${query}`, 'error');
    return;
  }

  selectSession(session.id);
  showCommandFeedback(`Switched to: ${getSessionDisplayName(session)}`, 'success');
}

function handleImportCommand() {
  openImportModal();
}

async function handleRenameCommand(args) {
  const newName = args.trim();
  if (!newName) {
    showCommandFeedback('Usage: /rename <name>', 'error');
    return;
  }

  if (!state.currentSession || state.currentSession.isDraft) {
    showCommandFeedback('No session to rename', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/sessions/${state.currentSession.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });

    if (response.ok) {
      const updatedSession = await response.json();
      state.currentSession = updatedSession;
      const idx = state.sessions.findIndex(s => s.id === updatedSession.id);
      if (idx >= 0) {
        state.sessions[idx] = updatedSession;
      }
      elements.sessionName.textContent = getSessionDisplayName(updatedSession);
      renderSessionsList();
      showCommandFeedback(`Renamed to: ${newName}`, 'success');
    } else {
      const error = await response.json();
      showCommandFeedback(error.error || 'Rename failed', 'error');
    }
  } catch (err) {
    console.error('Rename failed:', err);
    showCommandFeedback('Rename failed', 'error');
  }
}

function handleDeleteCommand() {
  deleteSession();
}

function handleExportCommand(args) {
  const format = args.trim().toLowerCase();
  if (format === 'md' || format === 'markdown') {
    exportSession('markdown');
  } else {
    exportSession('json');
  }
}

function handleSearchCommand(args) {
  const query = args.trim();
  if (!query) {
    // If no query, just focus the search bar
    focusSidebarSearch();
    return;
  }
  focusSidebarSearch(query);
}

function handleAbortCommand() {
  if (state.isProcessing) {
    abortMessage();
    showCommandFeedback('Abort requested', 'success');
  } else {
    showCommandFeedback('Nothing to abort', 'error');
  }
}

function handleResumeCommand(args) {
  const sessionId = args.trim();
  if (!sessionId) {
    // No ID provided - focus search bar for filtering
    focusSidebarSearch();
    showCommandFeedback('Use search to find and select a session', 'success');
    return;
  }

  const session = state.sessions.find(s => s.id === sessionId || s.id.startsWith(sessionId));
  if (!session) {
    showCommandFeedback(`Session not found: ${sessionId}`, 'error');
    return;
  }

  selectSession(session.id);
  showCommandFeedback(`Switched to session: ${getSessionDisplayName(session)}`, 'success');
}

async function handleModelCommand(args) {
  const model = args.trim().toLowerCase();
  const validModels = ['sonnet', 'opus', 'haiku'];

  if (!validModels.includes(model)) {
    showCommandFeedback(`Invalid model. Use: sonnet, opus, or haiku`, 'error');
    return;
  }

  // Persist model to session if we have one
  if (state.currentSession) {
    try {
      const response = await fetch(`/api/sessions/${state.currentSession.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      if (response.ok) {
        const updatedSession = await response.json();
        state.currentSession = updatedSession;
        // Update in sessions list too
        const idx = state.sessions.findIndex(s => s.id === updatedSession.id);
        if (idx >= 0) {
          state.sessions[idx] = updatedSession;
        }
        showCommandFeedback(`Model set to: ${model} (persisted for this session)`, 'success');
        return;
      }
    } catch (err) {
      console.error('Failed to persist model:', err);
    }
  }

  // Fallback to pending model for next message only
  state.pendingModel = model;
  showCommandFeedback(`Next message will use model: ${model}`, 'success');
}

function handlePlanCommand() {
  state.pendingPlanMode = true;
  showCommandFeedback('Plan mode enabled for next message', 'success');
}

async function handleTeleportCommand() {
  if (!state.currentSession) {
    showCommandFeedback('No session selected', 'error');
    return;
  }

  if (state.currentSession.isDraft) {
    showCommandFeedback('Send a message first to create the session', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/sessions/${state.currentSession.id}/teleport`);
    const data = await response.json();

    if (!response.ok) {
      showCommandFeedback(data.error || 'Failed to get teleport command', 'error');
      return;
    }

    // Try to copy to clipboard
    try {
      await navigator.clipboard.writeText(data.command);
      showCommandFeedback('Command copied to clipboard!', 'success');
    } catch (clipErr) {
      // Clipboard failed, still show the command
      console.warn('Clipboard access denied:', clipErr);
    }

    // Show the command in chat for visibility
    const message = `**Teleport to terminal:**

\`\`\`bash
${data.command}
\`\`\`

_Paste this command in your terminal on the server to continue this session._`;

    appendMessage('assistant', message);
  } catch (err) {
    console.error('Teleport failed:', err);
    showCommandFeedback('Failed to generate teleport command', 'error');
  }
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

// Keyboard shortcuts
function handleKeyboardShortcuts(e) {
  // Cmd+K / Ctrl+K - focus input with /
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    elements.messageInput.focus();
    elements.messageInput.value = '/';
    handleAutocompleteInput();
  }
}

// Touch gesture handling for mobile sidebar
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;

function handleTouchStart(e) {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  touchStartTime = Date.now();
}

function handleTouchEnd(e) {
  const touchEndX = e.changedTouches[0].clientX;
  const touchEndY = e.changedTouches[0].clientY;
  const touchEndTime = Date.now();

  const deltaX = touchEndX - touchStartX;
  const deltaY = touchEndY - touchStartY;
  const deltaTime = touchEndTime - touchStartTime;

  // Only handle horizontal swipes that are fast enough and primarily horizontal
  if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 2 && deltaTime < 300) {
    if (deltaX > 0 && touchStartX < 30 && !state.sidebarOpen) {
      // Swipe right from left edge - open sidebar
      openMobileSidebar();
    } else if (deltaX < 0 && state.sidebarOpen) {
      // Swipe left - close sidebar
      closeMobileSidebar();
    }
  }
}

function setupEventListeners() {
  // Sidebar toggle
  elements.sidebarToggle.addEventListener('click', toggleSidebar);

  // Mobile hamburger
  elements.hamburgerBtn.addEventListener('click', openMobileSidebar);
  elements.sidebarOverlay.addEventListener('click', closeMobileSidebar);

  // Sidebar search button (collapsed state) - expands and focuses search
  elements.sidebarSearchBtn.addEventListener('click', () => {
    focusSidebarSearch();
  });

  // Sidebar search input
  elements.sessionSearch.addEventListener('input', handleSearchInput);

  // Sessions list click
  elements.sessionsList.addEventListener('click', (e) => {
    const sessionItem = e.target.closest('.session-item');
    if (sessionItem) {
      const sessionId = sessionItem.dataset.sessionId;
      selectSession(sessionId);
    }
  });

  // Session name click to edit
  elements.sessionName.addEventListener('click', startEditingSessionName);
  elements.sessionNameInputInline.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveSessionName();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditingSessionName();
    }
  });
  elements.sessionNameInputInline.addEventListener('blur', saveSessionName);

  // New session button
  elements.newSessionBtn.addEventListener('click', () => {
    elements.newSessionModal.classList.remove('hidden');
    elements.sessionNameInput.focus();
  });

  elements.importSessionBtn.addEventListener('click', () => {
    openImportModal();
  });

  elements.sidebarImportBtn.addEventListener('click', () => {
    if (state.sidebarOpen) {
      closeMobileSidebar();
    }
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

  // Import mode toggle
  elements.importModeRecent.addEventListener('click', () => {
    setImportMode('recent');
    loadImportRecentSessions();
  });
  elements.importModeBrowse.addEventListener('click', () => {
    setImportMode('browse');
  });

  // Import recent sessions list click
  elements.importSessionsList.addEventListener('click', (e) => {
    const sessionItem = e.target.closest('.import-session-item');
    if (sessionItem) {
      const sessionId = sessionItem.dataset.sessionId;
      const projectPath = sessionItem.dataset.projectPath;
      const firstPrompt = sessionItem.dataset.firstPrompt;
      forkSession(sessionId, projectPath, firstPrompt);
    }
  });

  // Import browse sessions list click
  elements.importBrowseSessionsList.addEventListener('click', (e) => {
    const sessionItem = e.target.closest('.import-session-item');
    if (sessionItem) {
      const sessionId = sessionItem.dataset.sessionId;
      const projectPath = sessionItem.dataset.projectPath;
      const firstPrompt = sessionItem.dataset.firstPrompt;
      forkSession(sessionId, projectPath, firstPrompt);
    }
  });

  // Import browse directory browser
  elements.importBrowseBtn.addEventListener('click', toggleImportDirectoryBrowser);
  elements.importDirectoryList.addEventListener('click', handleImportDirectoryClick);
  elements.importDirectoryList.addEventListener('dblclick', handleImportDirectoryDblClick);
  elements.importLoadSessionsBtn.addEventListener('click', loadImportBrowseSessions);

  // Reset browse state when base directory changes
  elements.importDirectorySelect.addEventListener('change', () => {
    state.importBrowsePath = '';
    elements.importDirectoryInput.value = '';
    if (!elements.importDirectoryBrowser.classList.contains('hidden')) {
      importBrowseDirectories('');
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

  // Workspace picker tabs
  document.querySelectorAll('.workspace-tab').forEach(btn => {
    btn.addEventListener('click', () => switchWorkspacePickerMode(btn.dataset.mode));
  });

  // Conductor workspace selection
  document.getElementById('conductor-workspaces-list').addEventListener('click', (e) => {
    const worktree = e.target.closest('.conductor-worktree');
    if (worktree) {
      const workspacePath = worktree.dataset.workspacePath;
      const name = elements.sessionNameInput.value.trim();
      createSession(name, workspacePath);
      elements.newSessionModal.classList.add('hidden');
      elements.newSessionForm.reset();
      switchWorkspacePickerMode('browse');
      return;
    }

    const repoHeader = e.target.closest('.conductor-repo-header');
    if (repoHeader) {
      repoHeader.classList.toggle('collapsed');
      const list = repoHeader.nextElementSibling;
      list.classList.toggle('hidden');
    }
  });

  // Conductor cancel button
  document.getElementById('cancel-conductor-btn').addEventListener('click', () => {
    elements.newSessionModal.classList.add('hidden');
    elements.newSessionForm.reset();
    switchWorkspacePickerMode('browse');
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

  elements.abortBtn.addEventListener('click', abortMessage);
  elements.voiceBtn.addEventListener('click', toggleRecording);
  elements.voiceCancelBtn.addEventListener('click', cancelRecording);

  // Permission dialog event listeners
  elements.permissionAllow.addEventListener('click', () => respondToPermission(true, false));
  elements.permissionAllowSimilar.addEventListener('click', () => respondToPermission(true, true));
  elements.permissionDeny.addEventListener('click', () => respondToPermission(false));

  // Question dialog event listeners
  elements.questionSubmit.addEventListener('click', submitQuestionResponse);
  elements.questionCancel.addEventListener('click', cancelQuestionResponse);

  // Confirm dialog event listeners
  elements.confirmOk.addEventListener('click', () => {
    if (state.confirmCallback) {
      state.confirmCallback();
    }
    hideConfirmDialog();
  });
  elements.confirmCancel.addEventListener('click', hideConfirmDialog);
  elements.confirmModal.addEventListener('click', (e) => {
    if (e.target === elements.confirmModal) {
      hideConfirmDialog();
    }
  });

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

  // Directory input acts as search/filter bar
  elements.directoryInput.addEventListener('input', (e) => {
    handleDirectoryInputChange(e.target.value);
  });

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

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyboardShortcuts);

  // Touch gestures for mobile
  document.addEventListener('touchstart', handleTouchStart, { passive: true });
  document.addEventListener('touchend', handleTouchEnd, { passive: true });

  // Handle browser back/forward for sessions
  window.addEventListener('popstate', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session');
    if (sessionId !== state.currentSession?.id) {
      // Avoid recursive URL updates by directly setting state
      if (!sessionId) {
        if (state.currentSession) {
          unsubscribeFromSession(state.currentSession.id);
        }
        state.currentSession = null;
        elements.sessionName.textContent = '';
        elements.messages.innerHTML = '';
        updateUIState();
        renderSessionsList();
      } else {
        const session = state.sessions.find(s => s.id === sessionId);
        if (session) {
          if (state.currentSession) {
            unsubscribeFromSession(state.currentSession.id);
          }
          state.currentSession = session;
          elements.sessionName.textContent = getSessionDisplayName(session);
          subscribeToSession(sessionId);
          loadMessages(sessionId);
          updateUIState();
          renderSessionsList();
        }
      }
    }
  });
}

init();
