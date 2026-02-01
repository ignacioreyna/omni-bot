import { ClaudeProcess, PermissionRequest, PermissionResult, ResultData } from '../claude/cli-wrapper.js';
import { ClaudeEvent } from '../claude/output-parser.js';
import * as sessionsRepo from '../persistence/repositories/sessions.js';
import * as messagesRepo from '../persistence/repositories/messages.js';
import { appConfig } from '../config.js';
import { permissionManager } from '../permissions/manager.js';
import { generateSessionTitle } from '../utils/title-generator.js';
import { v4 as uuidv4 } from 'uuid';

export interface PermissionRequestData {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  reason?: string;
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

export class Coordinator {
  private activeSessions: Map<string, ClaudeProcess> = new Map();
  private eventListeners: Map<keyof CoordinatorEvents, Set<EventCallback<keyof CoordinatorEvents>>> = new Map();
  private currentStreamingText: Map<string, string> = new Map();
  // Track sessions that need forkSession=true on first ClaudeProcess creation
  private forkedSessions: Set<string> = new Set();
  // Track draft sessions (not yet persisted, waiting for first message)
  private draftSessions: Map<string, DraftSession> = new Map();

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
      // Generate title and persist the session
      console.log('[Coordinator] Persisting draft session with first message');

      const title = await generateSessionTitle(message);
      console.log('[Coordinator] Generated title:', title);

      // Persist the session with generated title
      session = sessionsRepo.createSessionWithId(
        draft.id,
        title,
        draft.workingDirectory,
        draft.ownerEmail
      );

      // Remove from drafts
      this.draftSessions.delete(sessionId);

      // Emit session updated event
      this.emit('sessionUpdated', session);
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
        messagesRepo.createMessage(sessionId, 'assistant', textBuffer);
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
    sessionsRepo.updateSession(sessionId, { status: 'terminated' });
    return true;
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

  denyPermission(id: string, message: string): boolean {
    return permissionManager.deny(id, message);
  }

  isSessionBusy(sessionId: string): boolean {
    const process = this.activeSessions.get(sessionId);
    return process?.getIsRunning() ?? false;
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
