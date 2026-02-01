# Omni-Bot

Web-based Claude Code coordinator for remote access via Tailscale.

## Overview

Omni-Bot is a self-hosted web application that provides remote access to Claude Code from any device on your Tailscale network. It spawns the `claude` CLI as child processes, using your existing Max Plan authentication.

## Architecture

```
Browser → Express + WebSocket → Coordinator → claude CLI (child process)
                                    ↓
                                 SQLite
```

- **Express**: HTTP server with REST API and static file serving
- **WebSocket**: Real-time streaming of Claude responses
- **Coordinator**: Manages session lifecycle and routes messages
- **Claude Agent SDK**: Uses `@anthropic-ai/claude-agent-sdk` for Claude integration
- **SQLite**: Persists sessions and message history

## Development

```bash
# Install dependencies
npm install

# Create .env from example
cp .env.example .env
# Edit .env to set ALLOWED_DIRECTORIES

# Run in development mode
npm run dev
```

## Configuration

Environment variables (see `.env.example`):

- `PORT`: Server port (default: 3000)
- `SESSION_SECRET`: Secret for session tokens
- `ALLOWED_DIRECTORIES`: Comma-separated list of allowed working directories
- `DATABASE_PATH`: Path to SQLite database
- `MAX_CONCURRENT_SESSIONS`: Maximum concurrent sessions (default: 5)

## Project Structure

```
src/
├── index.ts                 # Entry point
├── config.ts                # Env config with Zod
├── server/
│   ├── app.ts               # Express setup
│   ├── websocket.ts         # WebSocket handler
│   └── routes/              # REST API
├── coordinator/
│   └── coordinator.ts       # Session orchestration
├── claude/
│   ├── cli-wrapper.ts       # Claude CLI spawning
│   └── output-parser.ts     # Streaming JSON parser
├── persistence/
│   ├── database.ts          # SQLite setup
│   └── repositories/        # Data access
└── lifecycle/
    ├── startup.ts           # Initialization
    └── shutdown.ts          # Graceful shutdown
```

## API

### REST Endpoints

- `GET /api/sessions` - List all sessions
- `POST /api/sessions` - Create session
- `GET /api/sessions/:id` - Get session
- `POST /api/sessions/:id/pause` - Pause session
- `POST /api/sessions/:id/resume` - Resume session
- `POST /api/sessions/:id/abort` - Abort current operation
- `GET /api/messages/:sessionId` - Get message history

### WebSocket

Connect to `/ws` and send JSON messages:

```json
{ "type": "subscribe", "sessionId": "..." }
{ "type": "message", "sessionId": "...", "content": "..." }
{ "type": "abort", "sessionId": "..." }
```

Server sends:

```json
{ "type": "text", "sessionId": "...", "data": "..." }
{ "type": "tool", "sessionId": "...", "data": { "id": "...", "name": "..." } }
{ "type": "result", "sessionId": "...", "data": { ... } }
```

## Important: Claude Integration

We use the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) instead of spawning the `claude` CLI directly. This is critical because:

- The Claude CLI checks `isatty()` and refuses to output stream-json to non-TTY stdout
- Spawning from Node.js provides pipes, not a TTY
- Attempts to fake TTY (node-pty, script command, unbuffer) all fail for various reasons
- The SDK handles all TTY complexity internally and provides a clean async generator API

Key reference: See `claudegram` project for SDK usage patterns.

## Security

- **Network**: Use Tailscale to restrict access to your devices only
- **Directory Guard**: Only whitelisted directories can be used
- **No API Key**: Uses existing Claude Code authentication
