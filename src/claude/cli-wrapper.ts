import { EventEmitter } from 'events';
import {
  query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKSystemMessage,
  type PermissionMode,
  type PermissionResult,
} from '@anthropic-ai/claude-agent-sdk';
import { appConfig } from '../config.js';
import path from 'path';

export interface PermissionRequest {
  toolName: string;
  input: Record<string, unknown>;
  decisionReason?: string;
  toolUseID: string;
}

// Re-export SDK's PermissionResult for use in other modules
export type { PermissionResult };

// Safe tools that don't need user approval (read-only operations)
const SAFE_TOOLS = ['Read', 'Glob', 'Grep', 'Task', 'LS', 'WebFetch', 'WebSearch'];

export interface ResultData {
  text: string;
  sessionId?: string;
  subtype?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<string, {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  }>;
}

export interface ClaudeProcessEvents {
  event: (event: SDKMessage) => void;
  text: (text: string) => void;
  toolUse: (tool: { id: string; name: string; input: Record<string, unknown> }) => void;
  result: (result: ResultData) => void;
  error: (error: Error) => void;
  sessionId: (id: string) => void;
  exit: (code: number | null) => void;
}

export interface MessageOptions {
  model?: 'sonnet' | 'opus' | 'haiku';
  planMode?: boolean;
}

export interface ClaudeProcessOptions {
  workingDirectory: string;
  resumeSessionId?: string;
  forkSession?: boolean;
  onPermissionRequest?: (request: PermissionRequest) => Promise<PermissionResult>;
}

export class ClaudeProcess extends EventEmitter {
  private workingDirectory: string;
  private claudeSessionId: string | null = null;
  private forkSession: boolean;
  private isRunning = false;
  private abortController: AbortController | null = null;
  private onPermissionRequest?: (request: PermissionRequest) => Promise<PermissionResult>;

  constructor(options: ClaudeProcessOptions) {
    super();
    this.workingDirectory = options.workingDirectory;
    this.claudeSessionId = options.resumeSessionId ?? null;
    this.forkSession = options.forkSession ?? false;
    this.onPermissionRequest = options.onPermissionRequest;
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

  async sendMessage(message: string, options?: MessageOptions): Promise<void> {
    this.validateDirectory();

    if (this.isRunning) {
      throw new Error('Claude process is already running');
    }

    console.log('[ClaudeProcess] Sending message via SDK');
    console.log('[ClaudeProcess] Working directory:', this.workingDirectory);
    console.log('[ClaudeProcess] Resume session:', this.claudeSessionId);
    if (options) {
      console.log('[ClaudeProcess] Message options:', options);
    }

    this.isRunning = true;
    this.abortController = new AbortController();

    try {
      // Determine permission mode based on config
      const useInteractivePermissions = appConfig.interactivePermissions && this.onPermissionRequest;
      const permissionMode: PermissionMode = useInteractivePermissions ? 'default' : 'acceptEdits';

      const queryOptions: Parameters<typeof query>[0]['options'] = {
        cwd: this.workingDirectory,
        tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Task'],
        allowedTools: ['Bash(git:*)'],
        permissionMode,
        abortController: this.abortController,
        systemPrompt: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
        },
        ...(options?.model ? { model: options.model } : {}),
        ...(this.claudeSessionId ? {
          resume: this.claudeSessionId,
          ...(this.forkSession ? { forkSession: true } : {}),
        } : {}),
        stderr: (data: string) => {
          if (!data.includes('[DEBUG]') && !data.includes('Refreshing')) {
            console.error('[Claude stderr]:', data);
          }
        },
        // Only add canUseTool callback when interactive permissions are enabled
        ...(useInteractivePermissions ? {
          canUseTool: async (
            toolName: string,
            input: Record<string, unknown>,
            options: {
              signal: AbortSignal;
              suggestions?: unknown[];
              blockedPath?: string;
              decisionReason?: string;
              toolUseID: string;
            }
          ) => {
            // Auto-approve safe read-only tools
            if (SAFE_TOOLS.includes(toolName)) {
              return { behavior: 'allow' as const };
            }

            // Relay dangerous tools (Bash, Write, Edit, etc.) to user
            if (this.onPermissionRequest) {
              const result = await this.onPermissionRequest({
                toolName,
                input,
                decisionReason: options.decisionReason,
                toolUseID: options.toolUseID,
              });
              return result;
            }

            // Fallback: deny if no handler
            return { behavior: 'deny' as const, message: 'No permission handler configured' };
          },
        } : {}),
      };

      console.log('[ClaudeProcess] Calling query()...');

      // If plan mode is enabled, prepend instructions to the message
      let effectivePrompt = message;
      if (options?.planMode) {
        effectivePrompt = `[PLAN MODE] Please think through this request carefully and create a detailed plan before implementing. Explain your approach step by step.\n\n${message}`;
      }

      const response = await query({
        prompt: effectivePrompt,
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
          let hasTextInThisMessage = false;
          for (const block of responseMessage.message.content) {
            if (block.type === 'text') {
              // Add separator before first text block of a new assistant turn
              if (!hasTextInThisMessage && fullText.length > 0 && block.text.length > 0) {
                fullText += '\n\n';
              }
              hasTextInThisMessage = true;
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
            subtype: resultMsg.subtype,
            total_cost_usd: resultMsg.total_cost_usd,
            duration_ms: resultMsg.duration_ms,
            num_turns: resultMsg.num_turns,
            usage: resultMsg.usage,
            modelUsage: resultMsg.modelUsage,
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
