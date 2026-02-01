# Omni-Bot

Web-based Claude Code coordinator for remote access via Tailscale or Cloudflare Tunnel.

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
- `AUTH_MODE`: `tailscale` (default) or `cloudflare`
- `CF_ACCESS_TEAM_DOMAIN`: Cloudflare team domain (if AUTH_MODE=cloudflare)
- `CF_ACCESS_AUD`: Cloudflare Application Audience tag (if AUTH_MODE=cloudflare)

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

### SDK Streaming Behavior

The SDK emits multiple `assistant` messages during a single conversation turn:
- One before tool use ("I'll check the file...")
- One after tool use ("Now I'll proceed...")

When accumulating text for display, track **message boundaries**, not just text block boundaries. Each new `assistant` message represents a new turn and should be separated from previous text (e.g., with `\n\n`).

### Model Selection

The SDK's `query` function accepts a `model` option for specifying which Claude model to use:

```typescript
await query({
  prompt: 'Generate a title',
  options: {
    model: 'haiku', // Use Haiku for fast, cheap tasks
    maxTurns: 1,
    tools: [],
    persistSession: false, // Don't save ephemeral queries
  },
});
```

This is useful for auxiliary tasks like title generation where you need speed over capability.

### Draft Sessions

Sessions can be created without a name. These "draft sessions" are held in memory and only persisted to the database when the first message is sent. At that point, the title is auto-generated using Claude Haiku.

- Draft sessions have an `isDraft: true` flag in API responses
- If a draft session never receives a message, it's never persisted
- Useful for reducing database clutter from abandoned sessions

### Permission System

The `canUseTool` callback enables interactive permission handling:

- **Safe tools** (auto-approved): `Read`, `Glob`, `Grep`, `Task`, `LS`, `WebFetch`, `WebSearch` - read-only operations
- **Dangerous tools** (require approval): `Bash`, `Write`, `Edit` - can modify files or execute commands

The permission manager (`src/permissions/manager.ts`) holds pending requests and resolves them when the user responds via WebSocket. Set `INTERACTIVE_PERMISSIONS=true` to enable this flow.

## Security & Authentication

Two network access modes are supported:

### Option 1: Tailscale (Default)
Set `AUTH_MODE=tailscale` in `.env`.
- No authentication required at app level
- Tailscale mesh VPN restricts access to your devices only

### Option 2: Cloudflare Tunnel + Access
Set `AUTH_MODE=cloudflare` in `.env` with CF Access credentials.
- Public URL protected by Cloudflare Access (Zero Trust)
- JWT validation for all requests
- Supports Google, GitHub, email OTP login

**Cloudflare Setup:**
1. Install `cloudflared`: `brew install cloudflared`
2. Create tunnel: `cloudflared tunnel create omni-bot`
3. Configure `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: <tunnel-id>
   credentials-file: ~/.cloudflared/<tunnel-id>.json
   ingress:
     - hostname: omni-bot.yourdomain.com
       service: http://localhost:3000
     - service: http_status:404
   ```
4. Create DNS: `cloudflared tunnel route dns omni-bot omni-bot.yourdomain.com`
5. In Cloudflare Zero Trust dashboard:
   - Create Self-hosted Application for `omni-bot.yourdomain.com`
   - Add Access Policy (e.g., Google login)
   - Copy the Application Audience (AUD) tag
6. Set env vars:
   ```
   AUTH_MODE=cloudflare
   CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com
   CF_ACCESS_AUD=<aud-tag-from-dashboard>
   ```
7. Run tunnel: `cloudflared tunnel run omni-bot`

## Other Security Notes

- **Directory Guard**: Only whitelisted directories can be used
- **No API Key**: Uses existing Claude Code authentication
- **Session Ownership**: In cloudflare mode, sessions are scoped per user
