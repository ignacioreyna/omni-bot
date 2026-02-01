import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';

export interface PermissionRequest {
  toolName: string;
  input: Record<string, unknown>;
  decisionReason?: string;
  toolUseID: string;
}

export type { PermissionResult };

interface PendingPermission {
  id: string;
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
  decisionReason?: string;
  toolUseID: string;
  resolve: (result: PermissionResult) => void;
  timeout: NodeJS.Timeout;
}

export interface PermissionManagerEvents {
  request: (data: {
    id: string;
    sessionId: string;
    toolName: string;
    input: Record<string, unknown>;
    reason?: string;
  }) => void;
}

const PERMISSION_TIMEOUT_MS = 600000; // 600 seconds (10 minutes)

export class PermissionManager extends EventEmitter {
  private pending: Map<string, PendingPermission> = new Map();

  request(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
    options: { decisionReason?: string; toolUseID: string }
  ): Promise<PermissionResult> {
    return new Promise((resolve) => {
      const id = randomUUID();

      const timeout = setTimeout(() => {
        this.deny(id, 'Permission request timed out');
      }, PERMISSION_TIMEOUT_MS);

      const pending: PendingPermission = {
        id,
        sessionId,
        toolName,
        input,
        decisionReason: options.decisionReason,
        toolUseID: options.toolUseID,
        resolve,
        timeout,
      };

      this.pending.set(id, pending);

      this.emit('request', {
        id,
        sessionId,
        toolName,
        input,
        reason: options.decisionReason,
      });
    });
  }

  allow(id: string, updatedInput?: Record<string, unknown>): boolean {
    const pending = this.pending.get(id);
    if (!pending) {
      return false;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(id);
    pending.resolve({ behavior: 'allow', updatedInput });
    return true;
  }

  deny(id: string, message: string): boolean {
    const pending = this.pending.get(id);
    if (!pending) {
      return false;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(id);
    pending.resolve({ behavior: 'deny', message });
    return true;
  }

  getPending(id: string): PendingPermission | undefined {
    return this.pending.get(id);
  }

  hasPending(sessionId: string): boolean {
    for (const pending of this.pending.values()) {
      if (pending.sessionId === sessionId) {
        return true;
      }
    }
    return false;
  }

  cancelAllForSession(sessionId: string): void {
    for (const [id, pending] of this.pending.entries()) {
      if (pending.sessionId === sessionId) {
        clearTimeout(pending.timeout);
        pending.resolve({ behavior: 'deny', message: 'Session terminated' });
        this.pending.delete(id);
      }
    }
  }

  shutdown(): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.resolve({ behavior: 'deny', message: 'Server shutting down' });
      this.pending.delete(id);
    }
  }
}

export const permissionManager = new PermissionManager();
