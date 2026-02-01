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

// Known CLI tools for pattern extraction
const CLI_TOOLS = ['git', 'gh', 'npm', 'yarn', 'pnpm', 'docker', 'kubectl', 'aws', 'gcloud', 'terraform', 'make', 'cargo', 'go', 'python', 'pip'];

const PERMISSION_TIMEOUT_MS = 600000; // 600 seconds (10 minutes)

/**
 * Extract a pattern from tool input for "Allow Similar" matching.
 * Returns a pattern string that can be used to auto-approve similar requests.
 */
export function extractPattern(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash': {
      const command = input.command as string | undefined;
      if (!command) return `Bash:*`;

      // Extract command prefix (first 1-2 words depending on if it's a known CLI tool)
      const words = command.trim().split(/\s+/);
      const firstWord = words[0];

      if (CLI_TOOLS.includes(firstWord)) {
        // For known CLI tools, use first 2 words (e.g., "git commit", "npm install")
        const prefix = words.slice(0, 2).join(' ');
        return `Bash:${prefix}`;
      }

      // For unknown commands, use just the first word
      return `Bash:${firstWord}`;
    }

    case 'Read':
    case 'Write':
    case 'Edit': {
      const filePath = input.file_path as string | undefined;
      if (!filePath) return `${toolName}:*`;

      // Extract directory path (everything before the last /)
      const lastSlash = filePath.lastIndexOf('/');
      if (lastSlash > 0) {
        const dirPath = filePath.slice(0, lastSlash);
        return `${toolName}:${dirPath}/*`;
      }

      return `${toolName}:*`;
    }

    case 'Glob':
    case 'Grep': {
      // For Glob/Grep, use the search path
      const searchPath = input.path as string | undefined;
      if (!searchPath) return `${toolName}:cwd`;
      return `${toolName}:${searchPath}/*`;
    }

    default:
      // For other tools, just use the tool name
      return `${toolName}:*`;
  }
}

/**
 * Check if a tool call matches an allowed pattern.
 */
export function matchesPattern(toolName: string, input: Record<string, unknown>, pattern: string): boolean {
  const [patternTool, patternValue] = pattern.split(':', 2);

  // Tool must match
  if (patternTool !== toolName) return false;

  // Wildcard matches everything for this tool
  if (patternValue === '*') return true;

  switch (toolName) {
    case 'Bash': {
      const command = input.command as string | undefined;
      if (!command) return false;

      // Check if command starts with pattern prefix
      return command.trim().startsWith(patternValue);
    }

    case 'Read':
    case 'Write':
    case 'Edit': {
      const filePath = input.file_path as string | undefined;
      if (!filePath) return false;

      // Pattern ends with /* - check if file is in that directory
      if (patternValue.endsWith('/*')) {
        const dirPattern = patternValue.slice(0, -2);
        return filePath.startsWith(dirPattern + '/');
      }

      return filePath === patternValue;
    }

    case 'Glob':
    case 'Grep': {
      const searchPath = input.path as string | undefined;

      // Pattern for cwd means no path specified
      if (patternValue === 'cwd') {
        return !searchPath;
      }

      if (!searchPath) return false;

      // Pattern ends with /* - check if search path is in that directory
      if (patternValue.endsWith('/*')) {
        const dirPattern = patternValue.slice(0, -2);
        return searchPath.startsWith(dirPattern);
      }

      return searchPath === patternValue;
    }

    default:
      return true;
  }
}

export class PermissionManager extends EventEmitter {
  private pending: Map<string, PendingPermission> = new Map();
  // Per-session allowed patterns for "Allow Similar" feature
  private allowedPatterns: Map<string, Set<string>> = new Map();

  request(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
    options: { decisionReason?: string; toolUseID: string }
  ): Promise<PermissionResult> {
    // Check if this request matches any allowed patterns for this session
    const sessionPatterns = this.allowedPatterns.get(sessionId);
    if (sessionPatterns) {
      for (const pattern of sessionPatterns) {
        if (matchesPattern(toolName, input, pattern)) {
          console.log('[PermissionManager] Auto-approving via pattern:', pattern);
          // SDK requires updatedInput to be a record, use original input
          return Promise.resolve({ behavior: 'allow', updatedInput: input });
        }
      }
    }

    return new Promise((resolve) => {
      const id = randomUUID();
      console.log('[PermissionManager] Creating permission request with id:', id);

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
      console.log('[PermissionManager] Stored pending request, emitting event');

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
    console.log('[PermissionManager] allow called with id:', id);
    console.log('[PermissionManager] pending requests:', Array.from(this.pending.keys()));
    const pending = this.pending.get(id);
    if (!pending) {
      console.log('[PermissionManager] No pending request found for id:', id);
      return false;
    }

    console.log('[PermissionManager] Found pending request, resolving with allow');
    clearTimeout(pending.timeout);
    this.pending.delete(id);
    // SDK requires updatedInput to be a record (object), use original input if not provided
    pending.resolve({ behavior: 'allow', updatedInput: updatedInput ?? pending.input });
    return true;
  }

  /**
   * Allow a permission and also add a pattern to auto-approve similar future requests.
   * Returns the pattern that was added, or null if the permission wasn't found.
   */
  allowSimilar(id: string): { pattern: string } | null {
    console.log('[PermissionManager] allowSimilar called with id:', id);
    console.log('[PermissionManager] Current pending requests:', Array.from(this.pending.keys()));
    const pending = this.pending.get(id);
    if (!pending) {
      console.log('[PermissionManager] No pending request found for id:', id);
      return null;
    }

    console.log('[PermissionManager] Found pending request:', {
      toolName: pending.toolName,
      sessionId: pending.sessionId,
      input: pending.input,
    });

    // Extract pattern from this request
    const pattern = extractPattern(pending.toolName, pending.input);
    console.log('[PermissionManager] Extracted pattern:', pattern);

    // Add pattern to session's allowed list
    let sessionPatterns = this.allowedPatterns.get(pending.sessionId);
    if (!sessionPatterns) {
      sessionPatterns = new Set();
      this.allowedPatterns.set(pending.sessionId, sessionPatterns);
    }
    sessionPatterns.add(pattern);
    console.log('[PermissionManager] Added pattern to session, current patterns:', Array.from(sessionPatterns));

    // Now allow the original request
    clearTimeout(pending.timeout);
    this.pending.delete(id);
    console.log('[PermissionManager] Resolving pending promise with { behavior: "allow" }');
    // SDK requires updatedInput to be a record, use original input
    pending.resolve({ behavior: 'allow', updatedInput: pending.input });

    return { pattern };
  }

  /**
   * Get the allowed patterns for a session (for debugging/display).
   */
  getSessionPatterns(sessionId: string): string[] {
    const patterns = this.allowedPatterns.get(sessionId);
    return patterns ? Array.from(patterns) : [];
  }

  /**
   * Clear all allowed patterns for a session.
   */
  clearSessionPatterns(sessionId: string): void {
    this.allowedPatterns.delete(sessionId);
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
    // Clear allowed patterns when session is terminated
    this.allowedPatterns.delete(sessionId);
  }

  shutdown(): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.resolve({ behavior: 'deny', message: 'Server shutting down' });
      this.pending.delete(id);
    }
    // Clear all patterns on shutdown
    this.allowedPatterns.clear();
  }
}

export const permissionManager = new PermissionManager();
