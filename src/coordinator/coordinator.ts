import { ClaudeProcess, PermissionRequest, PermissionResult, ResultData, AskUserQuestionInput, AskUserQuestionResponse } from '../claude/cli-wrapper.js';
import { ClaudeEvent } from '../claude/output-parser.js';
import * as sessionsRepo from '../persistence/repositories/sessions.js';
import * as messagesRepo from '../persistence/repositories/messages.js';
import { appConfig } from '../config.js';
import { permissionManager, extractPattern } from '../permissions/manager.js';
import { generateSessionTitle } from '../utils/title-generator.js';
import { analyzeAndSelectModel } from '../models/model-router.js';
import { readLocalSessionMessages } from '../local-sessions/scanner.js';
import { v4 as uuidv4 } from 'uuid';

export interface PermissionRequestData {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  reason?: string;
}

export interface ClaudeQuestionData {
  id: string;
  questions: AskUserQuestionInput['questions'];
}

export interface MessageOptions {
  model?: 'sonnet' | 'opus' | 'haiku';
  planMode?: boolean;
}

export interface CoordinatorEvents {
  event: (sessionId: string, event: ClaudeEvent) => void;
  text: (sessionId: string, text: string) => void;
  toolUse: (sessionId: string, tool: { id: string; name: string; input: Record<string, unknown> }) => void;
  result: (sessionId: string, result: ResultData) => void;
  error: (sessionId: string, error: Error) => void;
  sessionUpdated: (session: sessionsRepo.Session) => void;
  permissionRequest: (sessionId: string, request: PermissionRequestData) => void;
  claudeQuestion: (sessionId: string, question: ClaudeQuestionData) => void;
}

type EventCallback<K extends keyof CoordinatorEvents> = CoordinatorEvents[K];

/**
 * Draft session - not yet persisted to database.
 * Will be persisted on first message with auto-generated title.
 */
export interface DraftSession {
  id: string;
  workingDirectory: string;
  ownerEmail: string;
  status: 'active';
  createdAt: string;
}

interface PendingQuestion {
  id: string;
  sessionId: string;
  resolve: (response: AskUserQuestionResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

const QUESTION_TIMEOUT_MS = 600000; // 10 minutes

export class Coordinator {
  private activeSessions: Map<string, ClaudeProcess> = new Map();
  private eventListeners: Map<keyof CoordinatorEvents, Set<EventCallback<keyof CoordinatorEvents>>> = new Map();
  private currentStreamingText: Map<string, string> = new Map();
  // Track sessions that need forkSession=true on first ClaudeProcess creation
  private forkedSessions: Set<string> = new Set();
  // Track draft sessions (not yet persisted, waiting for first message)
  private draftSessions: Map<string, DraftSession> = new Map();
  // Track pending AskUserQuestion requests
  private pendingQuestions: Map<string, PendingQuestion> = new Map();

  constructor() {
    // Listen to permission manager events and relay them
    permissionManager.on('request', (data) => {
      this.emit('permissionRequest', data.sessionId, {
        id: data.id,
        toolName: data.toolName,
        input: data.input,
        reason: data.reason,
      });
    });
  }

  on<K extends keyof CoordinatorEvents>(event: K, callback: CoordinatorEvents[K]): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback as EventCallback<keyof CoordinatorEvents>);
  }

  off<K extends keyof CoordinatorEvents>(event: K, callback: CoordinatorEvents[K]): void {
    this.eventListeners.get(event)?.delete(callback as EventCallback<keyof CoordinatorEvents>);
  }

  private emit<K extends keyof CoordinatorEvents>(event: K, ...args: Parameters<CoordinatorEvents[K]>): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        (listener as (...args: Parameters<CoordinatorEvents[K]>) => void)(...args);
      }
    }
  }

  /**
   * Create a session. If name is provided, persists immediately.
   * If name is omitted, creates a draft session that will be persisted
   * on first message with an auto-generated title.
   */
  createSession(
    name: string | undefined,
    workingDirectory: string,
    ownerEmail: string
  ): sessionsRepo.Session | DraftSession {
    if (this.activeSessions.size >= appConfig.maxConcurrentSessions) {
      throw new Error(`Maximum concurrent sessions (${appConfig.maxConcurrentSessions}) reached`);
    }

    // If name provided, persist immediately
    if (name) {
      const session = sessionsRepo.createSession(name, workingDirectory, ownerEmail);
      return session;
    }

    // No name - create draft session (not persisted yet)
    const draft: DraftSession = {
      id: uuidv4(),
      workingDirectory,
      ownerEmail,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    this.draftSessions.set(draft.id, draft);
    console.log('[Coordinator] Created draft session:', draft.id);
    return draft;
  }

  /**
   * Check if a session is a draft (not yet persisted).
   */
  isDraftSession(id: string): boolean {
    return this.draftSessions.has(id);
  }

  /**
   * Get a draft session by ID.
   */
  getDraftSession(id: string): DraftSession | undefined {
    return this.draftSessions.get(id);
  }

  /**
   * Fork a local Claude Code session into an omni-bot session.
   * The new session will resume from the local session's conversation history.
   */
  forkSession(
    name: string,
    workingDirectory: string,
    ownerEmail: string,
    localSessionId: string
  ): sessionsRepo.Session {
    if (this.activeSessions.size >= appConfig.maxConcurrentSessions) {
      throw new Error(`Maximum concurrent sessions (${appConfig.maxConcurrentSessions}) reached`);
    }

    // Create the session with the local session ID stored
    const session = sessionsRepo.createSession(name, workingDirectory, ownerEmail, localSessionId);

    // Import messages from the local session's .jsonl transcript
    const localMessages = readLocalSessionMessages(localSessionId);
    if (localMessages.length > 0) {
      messagesRepo.bulkCreateMessages(session.id, localMessages);
    }

    // Mark this session to use forkSession=true on first ClaudeProcess creation
    this.forkedSessions.add(session.id);

    return session;
  }

  getSession(id: string): sessionsRepo.Session | DraftSession | null {
    // Check drafts first
    const draft = this.draftSessions.get(id);
    if (draft) {
      return draft;
    }
    return sessionsRepo.getSession(id);
  }

  getAllSessions(ownerEmail?: string): (sessionsRepo.Session | DraftSession)[] {
    const persisted = sessionsRepo.getAllSessions(ownerEmail);

    // Include draft sessions belonging to this owner
    const drafts: DraftSession[] = [];
    for (const draft of this.draftSessions.values()) {
      if (!ownerEmail || draft.ownerEmail === ownerEmail) {
        drafts.push(draft);
      }
    }

    // Return drafts first (most recently created), then persisted sessions
    return [...drafts, ...persisted];
  }

  async sendMessage(sessionId: string, message: string, options?: MessageOptions): Promise<void> {
    console.log('[Coordinator] sendMessage called:', { sessionId, message, options });

    // Check if this is a draft session
    const draft = this.draftSessions.get(sessionId);
    let session: sessionsRepo.Session | null = null;

    if (draft) {
      // This is the first message for a draft session
      // Run title generation and model selection in parallel
      console.log('[Coordinator] Persisting draft session with first message (parallel Haiku calls)');

      const [title, selectedModel] = await Promise.all([
        generateSessionTitle(message),
        analyzeAndSelectModel(message),
      ]);

      console.log('[Coordinator] Generated title:', title, 'Model:', selectedModel);

      // Persist the session with generated title
      session = sessionsRepo.createSessionWithId(
        draft.id,
        title,
        draft.workingDirectory,
        draft.ownerEmail
      );

      // Set model on the newly created session
      sessionsRepo.updateSession(sessionId, { model: selectedModel });
      session = sessionsRepo.getSession(sessionId)!;

      // Remove from drafts
      this.draftSessions.delete(sessionId);

      // Emit session updated event (includes title and model)
      this.emit('sessionUpdated', session);

      // Use selected model for this message
      options = { ...options, model: selectedModel };
    } else {
      session = sessionsRepo.getSession(sessionId);
    }

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.status !== 'active') {
      throw new Error(`Session is ${session.status}, cannot send message`);
    }

    let claudeProcess = this.activeSessions.get(sessionId);

    if (claudeProcess?.getIsRunning()) {
      throw new Error('Session is busy processing a message');
    }

    // Auto-select model if no explicit model in options and session has no persisted model
    // (only for non-draft sessions - drafts already handled above)
    if (!options?.model && !session.model) {
      console.log('[Coordinator] First message, no model set - analyzing with Haiku...');
      const selectedModel = await analyzeAndSelectModel(message);
      console.log('[Coordinator] Model router selected:', selectedModel);

      // Persist to session (as if user chose it)
      sessionsRepo.updateSession(sessionId, { model: selectedModel });
      session = sessionsRepo.getSession(sessionId)!;

      // Emit session updated event so frontend knows about the model
      this.emit('sessionUpdated', session);

      // Use for this message
      options = { ...options, model: selectedModel };
    }

    messagesRepo.createMessage(sessionId, 'user', message);
    sessionsRepo.touchSession(sessionId);

    if (!claudeProcess) {
      // Check if this is a forked session (first use after fork)
      const isFork = this.forkedSessions.has(sessionId);
      if (isFork) {
        this.forkedSessions.delete(sessionId);
      }

      console.log('[Coordinator] Creating new ClaudeProcess for:', session.workingDirectory);
      console.log('[Coordinator] Fork mode:', isFork, 'Resume session:', session.claudeSessionId);
      console.log('[Coordinator] Interactive permissions:', appConfig.interactivePermissions);

      claudeProcess = new ClaudeProcess({
        workingDirectory: session.workingDirectory,
        resumeSessionId: session.claudeSessionId ?? undefined,
        forkSession: isFork,
        onPermissionRequest: appConfig.interactivePermissions
          ? (request: PermissionRequest) => this.handlePermissionRequest(sessionId, request)
          : undefined,
        onAskUserQuestion: appConfig.interactivePermissions
          ? (input: AskUserQuestionInput, toolUseID: string) => this.handleAskUserQuestion(sessionId, input, toolUseID)
          : undefined,
      });
      this.activeSessions.set(sessionId, claudeProcess);
      this.setupProcessListeners(sessionId, claudeProcess);
    }

    console.log('[Coordinator] Calling claudeProcess.sendMessage');
    await claudeProcess.sendMessage(message, options);
    console.log('[Coordinator] sendMessage completed');
  }

  private setupProcessListeners(sessionId: string, process: ClaudeProcess): void {
    let textBuffer = '';

    process.on('event', (event) => {
      this.emit('event', sessionId, event);
    });

    process.on('text', (text) => {
      // text is the full accumulated text from cli-wrapper
      textBuffer = text;
      this.currentStreamingText.set(sessionId, text);
      this.emit('text', sessionId, text);
    });

    process.on('toolUse', (tool) => {
      this.emit('toolUse', sessionId, tool);
    });

    process.on('result', (result) => {
      if (textBuffer) {
        // Save message with usage metadata for persistence
        const metadata: Record<string, unknown> = {};
        if (result.usage) {
          metadata.usage = result.usage;
        }
        if (result.modelUsage) {
          const modelIds = Object.keys(result.modelUsage);
          if (modelIds.length > 0) {
            metadata.model = modelIds[0];
          }
        }
        if (result.total_cost_usd !== undefined) {
          metadata.total_cost_usd = result.total_cost_usd;
        }
        if (result.duration_ms !== undefined) {
          metadata.duration_ms = result.duration_ms;
        }

        messagesRepo.createMessage(
          sessionId,
          'assistant',
          textBuffer,
          Object.keys(metadata).length > 0 ? metadata : undefined
        );
        textBuffer = '';
      }

      // Clear streaming text on completion
      this.currentStreamingText.delete(sessionId);

      const claudeSessionId = process.getClaudeSessionId();
      if (claudeSessionId) {
        sessionsRepo.updateSession(sessionId, { claudeSessionId });
      }

      this.emit('result', sessionId, result);
    });

    process.on('error', (error) => {
      // Clear streaming text on error
      this.currentStreamingText.delete(sessionId);
      this.emit('error', sessionId, error);
    });

    process.on('sessionId', (claudeSessionId) => {
      sessionsRepo.updateSession(sessionId, { claudeSessionId });
    });
  }

  pauseSession(sessionId: string): sessionsRepo.Session | null {
    const process = this.activeSessions.get(sessionId);
    if (process) {
      process.abort();
      this.activeSessions.delete(sessionId);
    }
    return sessionsRepo.updateSession(sessionId, { status: 'paused' });
  }

  resumeSession(sessionId: string): sessionsRepo.Session | null {
    const session = sessionsRepo.getSession(sessionId);
    if (!session) {
      return null;
    }

    if (session.status === 'terminated') {
      throw new Error('Cannot resume terminated session');
    }

    return sessionsRepo.updateSession(sessionId, { status: 'active' });
  }

  terminateSession(sessionId: string): boolean {
    const process = this.activeSessions.get(sessionId);
    if (process) {
      process.abort();
      this.activeSessions.delete(sessionId);
    }
    // Cancel any pending permission requests for this session
    permissionManager.cancelAllForSession(sessionId);
    // Cancel any pending questions for this session
    for (const [id, pending] of this.pendingQuestions.entries()) {
      if (pending.sessionId === sessionId) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Session terminated'));
        this.pendingQuestions.delete(id);
      }
    }
    sessionsRepo.updateSession(sessionId, { status: 'terminated' });
    return true;
  }

  /**
   * Delete a session and all its messages permanently.
   */
  deleteSession(sessionId: string): boolean {
    // Terminate any active process first
    const process = this.activeSessions.get(sessionId);
    if (process) {
      process.abort();
      this.activeSessions.delete(sessionId);
    }

    // Cancel any pending permission requests for this session
    permissionManager.cancelAllForSession(sessionId);

    // Cancel any pending questions for this session
    for (const [id, pending] of this.pendingQuestions.entries()) {
      if (pending.sessionId === sessionId) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Session deleted'));
        this.pendingQuestions.delete(id);
      }
    }

    // Delete messages first (foreign key constraint)
    messagesRepo.deleteMessagesForSession(sessionId);

    // Delete the session
    return sessionsRepo.deleteSession(sessionId);
  }

  private handlePermissionRequest(
    sessionId: string,
    request: PermissionRequest
  ): Promise<PermissionResult> {
    return permissionManager.request(sessionId, request.toolName, request.input, {
      decisionReason: request.decisionReason,
      toolUseID: request.toolUseID,
    });
  }

  allowPermission(id: string): boolean {
    return permissionManager.allow(id);
  }

  /**
   * Allow a permission and also approve similar future requests.
   * Returns the pattern that was added, or null if permission wasn't found.
   */
  allowSimilarPermission(id: string): { pattern: string } | null {
    return permissionManager.allowSimilar(id);
  }

  /**
   * Get the pattern that would be extracted for a permission request.
   * Used by frontend to show what "Allow Similar" would match.
   */
  getPermissionPattern(id: string): string | null {
    const pending = permissionManager.getPending(id);
    if (!pending) return null;
    return extractPattern(pending.toolName, pending.input);
  }

  denyPermission(id: string, message: string): boolean {
    return permissionManager.deny(id, message);
  }

  /**
   * Handle AskUserQuestion tool calls - relay to user and wait for response.
   */
  private handleAskUserQuestion(
    sessionId: string,
    input: AskUserQuestionInput,
    toolUseID: string
  ): Promise<AskUserQuestionResponse> {
    return new Promise((resolve, reject) => {
      const id = uuidv4();
      console.log('[Coordinator] Creating question request with id:', id);

      const timeout = setTimeout(() => {
        this.pendingQuestions.delete(id);
        reject(new Error('Question request timed out'));
      }, QUESTION_TIMEOUT_MS);

      const pending: PendingQuestion = {
        id,
        sessionId,
        resolve,
        reject,
        timeout,
      };

      this.pendingQuestions.set(id, pending);

      // Emit the question event for WebSocket to relay
      this.emit('claudeQuestion', sessionId, {
        id,
        questions: input.questions,
      });
    });
  }

  /**
   * Answer a pending question from Claude.
   */
  answerQuestion(id: string, answers: Record<string, string>): boolean {
    console.log('[Coordinator] answerQuestion called with id:', id);
    const pending = this.pendingQuestions.get(id);
    if (!pending) {
      console.log('[Coordinator] No pending question found for id:', id);
      return false;
    }

    console.log('[Coordinator] Found pending question, resolving with answers');
    clearTimeout(pending.timeout);
    this.pendingQuestions.delete(id);
    pending.resolve({ answers });
    return true;
  }

  /**
   * Cancel a pending question (e.g., user clicked Cancel).
   */
  cancelQuestion(id: string): boolean {
    const pending = this.pendingQuestions.get(id);
    if (!pending) {
      return false;
    }

    clearTimeout(pending.timeout);
    this.pendingQuestions.delete(id);
    pending.reject(new Error('User cancelled question'));
    return true;
  }

  isSessionBusy(sessionId: string): boolean {
    const process = this.activeSessions.get(sessionId);
    return process?.getIsRunning() ?? false;
  }

  /**
   * Update session properties (model, name, etc).
   */
  updateSession(
    sessionId: string,
    updates: { model?: 'sonnet' | 'opus' | 'haiku'; name?: string }
  ): sessionsRepo.Session | null {
    // Don't allow updating draft sessions
    if (this.draftSessions.has(sessionId)) {
      return null;
    }
    return sessionsRepo.updateSession(sessionId, updates);
  }

  /**
   * Update session model preference.
   * @deprecated Use updateSession instead
   */
  updateSessionModel(
    sessionId: string,
    updates: { model?: 'sonnet' | 'opus' | 'haiku' }
  ): sessionsRepo.Session | null {
    return this.updateSession(sessionId, updates);
  }

  abortSession(sessionId: string): void {
    const process = this.activeSessions.get(sessionId);
    if (process) {
      process.abort();
    }
  }

  getCurrentStreamingText(sessionId: string): string | null {
    return this.currentStreamingText.get(sessionId) ?? null;
  }

  getMessages(sessionId: string, limit?: number, offset?: number): messagesRepo.Message[] {
    return messagesRepo.getMessages(sessionId, limit, offset);
  }

  searchMessages(query: string, sessionId?: string): messagesRepo.Message[] {
    return messagesRepo.searchMessages(query, sessionId);
  }

  shutdown(): void {
    for (const [sessionId, process] of this.activeSessions) {
      console.log(`Shutting down session ${sessionId}...`);
      process.abort();
    }
    this.activeSessions.clear();
    permissionManager.shutdown();
  }
}

export const coordinator = new Coordinator();
