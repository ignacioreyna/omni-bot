import { ClaudeProcess } from '../claude/cli-wrapper.js';
import { ClaudeEvent, ResultEvent } from '../claude/output-parser.js';
import * as sessionsRepo from '../persistence/repositories/sessions.js';
import * as messagesRepo from '../persistence/repositories/messages.js';
import { appConfig } from '../config.js';

export interface CoordinatorEvents {
  event: (sessionId: string, event: ClaudeEvent) => void;
  text: (sessionId: string, text: string) => void;
  toolUse: (sessionId: string, tool: { id: string; name: string; input: Record<string, unknown> }) => void;
  result: (sessionId: string, result: ResultEvent) => void;
  error: (sessionId: string, error: Error) => void;
  sessionUpdated: (session: sessionsRepo.Session) => void;
}

type EventCallback<K extends keyof CoordinatorEvents> = CoordinatorEvents[K];

export class Coordinator {
  private activeSessions: Map<string, ClaudeProcess> = new Map();
  private eventListeners: Map<keyof CoordinatorEvents, Set<EventCallback<keyof CoordinatorEvents>>> = new Map();

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

  createSession(name: string, workingDirectory: string): sessionsRepo.Session {
    if (this.activeSessions.size >= appConfig.maxConcurrentSessions) {
      throw new Error(`Maximum concurrent sessions (${appConfig.maxConcurrentSessions}) reached`);
    }

    const session = sessionsRepo.createSession(name, workingDirectory);
    return session;
  }

  getSession(id: string): sessionsRepo.Session | null {
    return sessionsRepo.getSession(id);
  }

  getAllSessions(): sessionsRepo.Session[] {
    return sessionsRepo.getAllSessions();
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    console.log('[Coordinator] sendMessage called:', { sessionId, message });
    const session = sessionsRepo.getSession(sessionId);
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
      console.log('[Coordinator] Creating new ClaudeProcess for:', session.workingDirectory);
      claudeProcess = new ClaudeProcess({
        workingDirectory: session.workingDirectory,
        resumeSessionId: session.claudeSessionId ?? undefined,
      });
      this.activeSessions.set(sessionId, claudeProcess);
      this.setupProcessListeners(sessionId, claudeProcess);
    }

    console.log('[Coordinator] Calling claudeProcess.sendMessage');
    await claudeProcess.sendMessage(message);
    console.log('[Coordinator] sendMessage completed');
  }

  private setupProcessListeners(sessionId: string, process: ClaudeProcess): void {
    let textBuffer = '';

    process.on('event', (event) => {
      this.emit('event', sessionId, event);
    });

    process.on('text', (text) => {
      textBuffer += text;
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

      const claudeSessionId = process.getClaudeSessionId();
      if (claudeSessionId) {
        sessionsRepo.updateSession(sessionId, { claudeSessionId });
      }

      this.emit('result', sessionId, result);
    });

    process.on('error', (error) => {
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
    sessionsRepo.updateSession(sessionId, { status: 'terminated' });
    return true;
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
  }
}

export const coordinator = new Coordinator();
