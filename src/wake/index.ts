import { createWakeServer } from './wake-server.js';
import { ProcessManager } from './process-manager.js';
import { wakeConfig } from './wake-config.js';

const processManager = new ProcessManager();

const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
for (const signal of signals) {
  process.on(signal, () => {
    console.log(`[Wake] Received ${signal}, shutting down...`);
    processManager.shutdown();
    process.exit(0);
  });
}

process.on('uncaughtException', (err) => {
  console.error('[Wake] Uncaught exception:', err);
  processManager.shutdown();
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Wake] Unhandled rejection:', reason);
  processManager.shutdown();
  process.exit(1);
});

const server = createWakeServer(processManager);

server.listen(wakeConfig.port, () => {
  console.log(`[Wake] Wake server running on http://localhost:${wakeConfig.port}`);
  console.log(`[Wake] Proxying to Omni-Bot on port ${wakeConfig.omniBotPort}`);
});
