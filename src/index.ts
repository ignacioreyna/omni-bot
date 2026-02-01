import { createServer } from 'http';
import { createApp } from './server/app.js';
import { setupWebSocket } from './server/websocket.js';
import { startup } from './lifecycle/startup.js';
import { setupShutdownHandlers } from './lifecycle/shutdown.js';
import { appConfig } from './config.js';

setupShutdownHandlers();
startup();

const app = createApp();
const server = createServer(app);

setupWebSocket(server);

server.listen(appConfig.port, () => {
  console.log(`Omni-Bot server running on http://localhost:${appConfig.port}`);
  console.log(`Allowed directories: ${appConfig.allowedDirectories.join(', ')}`);
});
