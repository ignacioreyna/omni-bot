import { spawn, ChildProcess } from 'child_process';

let caffeinateProcess: ChildProcess | null = null;

/**
 * Start caffeinate to prevent macOS from sleeping.
 * The process is attached (not detached), so it will automatically
 * be killed by the OS when the parent Node process exits.
 */
export function preventSleep(): void {
  if (process.platform !== 'darwin') return;
  if (caffeinateProcess) return;

  try {
    // -d: prevent display sleep
    // -i: prevent system idle sleep
    // No `detached: true` and no `unref()` - child dies with parent
    caffeinateProcess = spawn('caffeinate', ['-di'], {
      stdio: 'ignore',
    });

    caffeinateProcess.on('error', (err) => {
      console.error('[Caffeinate] Error:', err.message);
      caffeinateProcess = null;
    });

    caffeinateProcess.on('exit', (code) => {
      if (code !== null && code !== 0) {
        console.log('[Caffeinate] Exited with code:', code);
      }
      caffeinateProcess = null;
    });

    console.log('[Caffeinate] Preventing system sleep (attached to server)');
  } catch (error) {
    console.error('[Caffeinate] Failed to start:', error);
  }
}

/**
 * Stop caffeinate and allow system to sleep again.
 * Called during graceful shutdown.
 */
export function allowSleep(): void {
  if (caffeinateProcess) {
    try {
      caffeinateProcess.kill();
    } catch {
      // Ignore kill errors
    }
    caffeinateProcess = null;
    console.log('[Caffeinate] Sleep prevention disabled');
  }
}
