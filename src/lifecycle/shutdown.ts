import { closeDatabase } from '../persistence/database.js';
import { coordinator } from '../coordinator/coordinator.js';

export function shutdown(): void {
  console.log('Shutting down...');

  console.log('Stopping active sessions...');
  coordinator.shutdown();

  console.log('Closing database...');
  closeDatabase();

  console.log('Shutdown complete.');
}

export function setupShutdownHandlers(): void {
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

  for (const signal of signals) {
    process.on(signal, () => {
      console.log(`Received ${signal}, initiating graceful shutdown...`);
      shutdown();
      process.exit(0);
    });
  }

  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    shutdown();
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    shutdown();
    process.exit(1);
  });
}
