import { ChildProcess, spawn } from 'child_process';
import { createWriteStream, WriteStream } from 'fs';
import { wakeConfig } from './wake-config.js';

export interface OmniBotStatus {
  running: boolean;
  pid: number | null;
  uptime: number | null;
  startedAt: string | null;
  restarts: number;
  lastError: string | null;
}

export class ProcessManager {
  private process: ChildProcess | null = null;
  private startedAt: Date | null = null;
  private restarts = 0;
  private lastError: string | null = null;
  private logStream: WriteStream | null = null;
  private stopping = false;
  private transitioning = false;

  getStatus(): OmniBotStatus {
    return {
      running: this.process !== null && !this.stopping,
      pid: this.process?.pid ?? null,
      uptime: this.startedAt ? Date.now() - this.startedAt.getTime() : null,
      startedAt: this.startedAt?.toISOString() ?? null,
      restarts: this.restarts,
      lastError: this.lastError,
    };
  }

  async start(): Promise<void> {
    if (this.transitioning) throw new Error('Operation in progress');
    if (this.process) throw new Error('Omni-Bot is already running');

    this.transitioning = true;
    try {
      this.stopping = false;
      this.lastError = null;

      this.logStream = createWriteStream(wakeConfig.omniBotLogPath, { flags: 'a' });

      const env = {
        ...process.env,
        PORT: String(wakeConfig.omniBotPort),
      };

      this.process = spawn('node', ['dist/index.js'], {
        cwd: wakeConfig.projectRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.process.stdout?.pipe(this.logStream);
      this.process.stderr?.pipe(this.logStream);

      this.startedAt = new Date();

      this.process.on('error', (err) => {
        this.lastError = err.message;
        console.error('[Wake] Omni-Bot process error:', err.message);
        this.cleanup();
      });

      this.process.on('exit', (code, signal) => {
        console.log(`[Wake] Omni-Bot exited: code=${code}, signal=${signal}`);
        if (!this.stopping && code !== 0) {
          this.lastError = `Exited with code ${code}`;
          this.restarts++;
        }
        this.cleanup();
      });

      await this.waitForReady();
    } finally {
      this.transitioning = false;
    }
  }

  async stop(): Promise<void> {
    if (this.transitioning) throw new Error('Operation in progress');
    if (!this.process) throw new Error('Omni-Bot is not running');

    this.transitioning = true;
    try {
      this.stopping = true;
      this.process.kill('SIGTERM');

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.process) {
            console.warn('[Wake] Omni-Bot did not exit gracefully, sending SIGKILL');
            this.process.kill('SIGKILL');
          }
          resolve();
        }, 10_000);

        if (this.process) {
          this.process.once('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        } else {
          clearTimeout(timeout);
          resolve();
        }
      });

      this.cleanup();
    } finally {
      this.transitioning = false;
    }
  }

  async restart(): Promise<void> {
    if (this.process) {
      await this.stop();
    }
    await this.start();
  }

  shutdown(): void {
    if (this.process) {
      this.stopping = true;
      this.process.kill('SIGTERM');
      this.cleanup();
    }
  }

  private cleanup(): void {
    this.process = null;
    this.startedAt = null;
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }

  private async waitForReady(timeoutMs = 15_000): Promise<void> {
    const start = Date.now();
    const url = `http://localhost:${wakeConfig.omniBotPort}/api/health`;

    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          console.log('[Wake] Omni-Bot is ready');
          return;
        }
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    throw new Error('Omni-Bot failed to start within timeout');
  }
}
