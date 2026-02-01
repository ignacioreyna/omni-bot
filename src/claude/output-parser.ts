import { EventEmitter } from 'events';

export interface AssistantMessage {
  type: 'assistant';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    content: ContentBlock[];
    model: string;
    stop_reason: string | null;
    stop_sequence: string | null;
  };
  session_id: string;
}

export interface ContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface ContentBlockStart {
  type: 'content_block_start';
  index: number;
  content_block: ContentBlock;
}

export interface ContentBlockDelta {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
  };
}

export interface ContentBlockStop {
  type: 'content_block_stop';
  index: number;
}

export interface ResultEvent {
  type: 'result';
  subtype: 'success' | 'error';
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  is_error?: boolean;
  num_turns?: number;
  result?: string;
  session_id?: string;
  total_cost_usd?: number;
}

export interface SystemEvent {
  type: 'system';
  subtype: string;
  message?: string;
  level?: string;
}

export type ClaudeEvent =
  | AssistantMessage
  | ContentBlockStart
  | ContentBlockDelta
  | ContentBlockStop
  | ResultEvent
  | SystemEvent
  | { type: string; [key: string]: unknown };

export interface OutputParserEvents {
  event: (event: ClaudeEvent) => void;
  text: (text: string) => void;
  toolUse: (tool: { id: string; name: string; input: Record<string, unknown> }) => void;
  result: (result: ResultEvent) => void;
  error: (error: Error) => void;
  sessionId: (id: string) => void;
}

export class OutputParser extends EventEmitter {
  private buffer = '';
  private sessionId: string | null = null;

  constructor() {
    super();
  }

  write(chunk: Buffer | string): void {
    this.buffer += chunk.toString();
    this.processBuffer();
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.trim()) {
        this.parseLine(line.trim());
      }
    }
  }

  private parseLine(line: string): void {
    try {
      const event = JSON.parse(line) as ClaudeEvent;
      console.log('[OutputParser] Event type:', event.type);
      this.emit('event', event);

      switch (event.type) {
        case 'assistant':
          this.handleAssistantMessage(event as AssistantMessage);
          break;
        case 'content_block_start':
          this.handleContentBlockStart(event as ContentBlockStart);
          break;
        case 'content_block_delta':
          this.handleContentBlockDelta(event as ContentBlockDelta);
          break;
        case 'result':
          console.log('[OutputParser] Emitting result');
          this.emit('result', event as ResultEvent);
          break;
        case 'system':
          if ((event as SystemEvent).subtype === 'init') {
            const initEvent = event as SystemEvent & { session_id?: string };
            if (initEvent.session_id && !this.sessionId) {
              this.sessionId = initEvent.session_id;
              console.log('[OutputParser] Session ID from init:', this.sessionId);
              this.emit('sessionId', initEvent.session_id);
            }
          }
          break;
      }
    } catch (err) {
      if (line.startsWith('{')) {
        this.emit('error', new Error(`Failed to parse JSON: ${line}`));
      }
    }
  }

  private handleAssistantMessage(msg: AssistantMessage): void {
    if (msg.session_id && !this.sessionId) {
      this.sessionId = msg.session_id;
      this.emit('sessionId', msg.session_id);
    }

    console.log('[OutputParser] Assistant message content blocks:', msg.message.content.length);
    for (const block of msg.message.content) {
      if (block.type === 'text' && block.text) {
        console.log('[OutputParser] Emitting text:', block.text.substring(0, 50));
        this.emit('text', block.text);
      } else if (block.type === 'tool_use' && block.id && block.name) {
        console.log('[OutputParser] Emitting toolUse:', block.name);
        this.emit('toolUse', {
          id: block.id,
          name: block.name,
          input: block.input ?? {},
        });
      }
    }
  }

  private handleContentBlockStart(event: ContentBlockStart): void {
    if (event.content_block.type === 'tool_use' && event.content_block.id && event.content_block.name) {
      this.emit('toolUse', {
        id: event.content_block.id,
        name: event.content_block.name,
        input: event.content_block.input ?? {},
      });
    }
  }

  private handleContentBlockDelta(event: ContentBlockDelta): void {
    if (event.delta.type === 'text_delta' && event.delta.text) {
      this.emit('text', event.delta.text);
    }
  }

  flush(): void {
    if (this.buffer.trim()) {
      this.parseLine(this.buffer.trim());
    }
    this.buffer = '';
  }

  getSessionId(): string | null {
    return this.sessionId;
  }
}
