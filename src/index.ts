import { createServer } from 'http';
import { createApp } from './server/app.js';
import { setupTerminalWebSocket } from './server/terminal-ws.js';
import { appConfig } from './config.js';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const server = createServer(createApp());
setupTerminalWebSocket(server);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`Received ${signal}, shutting down (tmux sessions keep running)`);
    server.close();
    process.exit(0);
  });
}

server.listen(appConfig.port, () => {
  console.log(`Omni-Bot running on http://localhost:${appConfig.port}`);
  console.log(`Allowed directories: ${appConfig.allowedDirectories.join(', ')}`);
});
