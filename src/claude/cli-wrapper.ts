import { EventEmitter } from 'events';
import {
  query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKSystemMessage,
  type PermissionMode,
} from '@anthropic-ai/claude-agent-sdk';
import { appConfig } from '../config.js';
import path from 'path';

export interface ClaudeProcessEvents {
  event: (event: SDKMessage) => void;
  text: (text: string) => void;
  toolUse: (tool: { id: string; name: string; input: Record<string, unknown> }) => void;
  result: (result: { text: string; sessionId?: string }) => void;
  error: (error: Error) => void;
  sessionId: (id: string) => void;
  exit: (code: number | null) => void;
}

export interface ClaudeProcessOptions {
  workingDirectory: string;
  resumeSessionId?: string;
}

export class ClaudeProcess extends EventEmitter {
  private workingDirectory: string;
  private claudeSessionId: string | null = null;
  private isRunning = false;
  private abortController: AbortController | null = null;

  constructor(options: ClaudeProcessOptions) {
    super();
    this.workingDirectory = options.workingDirectory;
    this.claudeSessionId = options.resumeSessionId ?? null;
  }

  private validateDirectory(): void {
    const resolved = path.resolve(this.workingDirectory);
    const allowed = appConfig.allowedDirectories.some((dir) => resolved.startsWith(dir));
    if (!allowed) {
      throw new Error(
        `Directory not allowed: ${resolved}. Allowed: ${appConfig.allowedDirectories.join(', ')}`
      );
    }
  }

  async sendMessage(message: string): Promise<void> {
    this.validateDirectory();

    if (this.isRunning) {
      throw new Error('Claude process is already running');
    }

    console.log('[ClaudeProcess] Sending message via SDK');
    console.log('[ClaudeProcess] Working directory:', this.workingDirectory);
    console.log('[ClaudeProcess] Resume session:', this.claudeSessionId);

    this.isRunning = true;
    this.abortController = new AbortController();

    try {
      const queryOptions: Parameters<typeof query>[0]['options'] = {
        cwd: this.workingDirectory,
        tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Task'],
        permissionMode: 'acceptEdits' as PermissionMode,
        abortController: this.abortController,
        systemPrompt: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
        },
        ...(this.claudeSessionId ? { resume: this.claudeSessionId } : {}),
        stderr: (data: string) => {
          if (!data.includes('[DEBUG]') && !data.includes('Refreshing')) {
            console.error('[Claude stderr]:', data);
          }
        },
      };

      console.log('[ClaudeProcess] Calling query()...');

      const response = await query({
        prompt: message,
        options: queryOptions,
      });

      let fullText = '';

      console.log('[ClaudeProcess] Processing response stream...');

      for await (const responseMessage of response) {
        if (this.abortController.signal.aborted) {
          console.log('[ClaudeProcess] Aborted');
          break;
        }

        this.emit('event', responseMessage);

        if (responseMessage.type === 'assistant') {
          for (const block of responseMessage.message.content) {
            if (block.type === 'text') {
              fullText += block.text;
              this.emit('text', fullText);
            } else if (block.type === 'tool_use') {
              const toolInput = 'input' in block ? (block.input as Record<string, unknown>) : {};
              this.emit('toolUse', {
                id: block.id,
                name: block.name,
                input: toolInput,
              });
            }
          }
        } else if (responseMessage.type === 'system') {
          const sysMsg = responseMessage as SDKSystemMessage;
          if (sysMsg.subtype === 'init' && sysMsg.session_id) {
            this.claudeSessionId = sysMsg.session_id;
            this.emit('sessionId', sysMsg.session_id);
            console.log('[ClaudeProcess] Session initialized:', sysMsg.session_id);
          }
        } else if (responseMessage.type === 'result') {
          const resultMsg = responseMessage as SDKResultMessage;

          // Capture session_id from result
          if ('session_id' in resultMsg && resultMsg.session_id) {
            this.claudeSessionId = resultMsg.session_id;
            this.emit('sessionId', resultMsg.session_id);
          }

          // Append final result text if available
          if (resultMsg.subtype === 'success' && resultMsg.result) {
            if (!fullText.includes(resultMsg.result)) {
              if (fullText.length > 0) {
                fullText += '\n\n';
              }
              fullText += resultMsg.result;
            }
          }

          this.emit('result', {
            text: fullText,
            sessionId: this.claudeSessionId ?? undefined,
          });

          console.log('[ClaudeProcess] Result received, session:', this.claudeSessionId);
        }
      }

      this.isRunning = false;
      this.emit('exit', 0);
    } catch (error) {
      console.error('[ClaudeProcess] Error:', error);
      this.isRunning = false;
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      this.emit('exit', 1);
    }
  }

  abort(): void {
    if (this.abortController && this.isRunning) {
      this.abortController.abort();
      this.isRunning = false;
    }
  }

  getClaudeSessionId(): string | null {
    return this.claudeSessionId;
  }

  getIsRunning(): boolean {
    return this.isRunning;
  }

  getWorkingDirectory(): string {
    return this.workingDirectory;
  }
}
