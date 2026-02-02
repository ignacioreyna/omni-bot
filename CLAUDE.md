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

## Code Style & Conventions

### TypeScript
- Strict mode enabled - all checks on
- Explicit return types for public functions
- Use `unknown` instead of `any`
- Interfaces for objects, types for unions

### Naming
- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Functions/Variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`

### Commits
Follow Conventional Commits:
- `feat(scope): add new feature`
- `fix(scope): fix bug`
- `docs(scope): update docs`
- `refactor(scope): refactor code`
- `chore(scope): maintenance task`

### Formatting
Run before committing:
```bash
npm run lint:fix
npm run format
```

## Database Schema

### sessions
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workingDirectory TEXT NOT NULL,
  ownerEmail TEXT NOT NULL,
  status TEXT NOT NULL,  -- active, paused, completed, errored
  model TEXT,            -- haiku, sonnet, opus (can be NULL)
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
)
```

### messages
```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  role TEXT NOT NULL,        -- user, assistant
  content TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
)
```

## Key Components Reference

### Coordinator (`src/coordinator/coordinator.ts`)
Central orchestrator managing:
- Active Claude processes (Map<sessionId, ClaudeProcess>)
- Draft sessions (in-memory before first message)
- Event emission to WebSocket clients
- Permission request coordination
- AskUserQuestion handling

**Key methods:**
- `createSession(workingDir, ownerEmail, name?, model?)`: Create new session
- `sendMessage(sessionId, content, options?)`: Send message to Claude
- `pauseSession(sessionId)`: Suspend session
- `resumeSession(sessionId)`: Reactivate session
- `abortSession(sessionId)`: Stop current operation

### Permission Manager (`src/permissions/manager.ts`)
Handles interactive approval for dangerous operations.

**Pattern extraction:**
- Bash: Extracts command prefix (e.g., "git commit")
- File ops: Extracts directory path (e.g., "Write:/path/to/dir/*")
- Used for "Allow Similar" feature

**Timeout:** 10 minutes per request, auto-denies if no response

### Model Router (`src/models/model-router.ts`)
Auto-selects model based on:
- Keywords in message (explain→Haiku, refactor→Opus)
- Code length (< 50 lines→Haiku, > 200 lines→Opus)
- Default: Sonnet

### Title Generator (`src/utils/title-generator.ts`)
Generates session titles using Claude Haiku:
- Ephemeral query (not persisted)
- Fast and cost-efficient
- Triggered on first message to draft session

## WebSocket Events Reference

### Client → Server
- `subscribe`: Subscribe to session events
- `unsubscribe`: Unsubscribe from session
- `message`: Send message to Claude
- `abort`: Abort current operation
- `permissionResponse`: Respond to permission request
- `claudeQuestionResponse`: Answer Claude question

### Server → Client
- `text`: Streaming text from Claude
- `tool`: Tool use notification
- `result`: Final result of message exchange
- `error`: Error occurred
- `sessionUpdated`: Session metadata changed
- `permissionRequest`: Permission needed (if INTERACTIVE_PERMISSIONS=true)
- `claudeQuestion`: Claude asking a question (AskUserQuestion tool)

## Configuration Reference

### Required
- `ALLOWED_DIRECTORIES`: Comma-separated paths where sessions can be created

### Optional
- `PORT`: Server port (default: 3000)
- `DATABASE_PATH`: SQLite DB path (default: ./data/omni-bot.db)
- `MAX_CONCURRENT_SESSIONS`: Concurrent session limit (default: 5)
- `SESSION_SECRET`: Token signing secret (auto-generated if not set)
- `READABLE_DIRECTORIES`: Read-only directory access (comma-separated)
- `INTERACTIVE_PERMISSIONS`: Enable permission UI (default: false)

### Auth Mode: Tailscale (default)
- `AUTH_MODE=tailscale`
- No additional config needed

### Auth Mode: Cloudflare
- `AUTH_MODE=cloudflare`
- `CF_ACCESS_TEAM_DOMAIN`: Your team domain
- `CF_ACCESS_AUD`: Application Audience tag

## Common Patterns

### Creating a New Route
1. Create file in `src/server/routes/`
2. Export Express Router
3. Register in `src/server/app.ts`

### Adding Database Table
1. Update schema in `src/persistence/database.ts`
2. Create repository in `src/persistence/repositories/`
3. Use prepared statements (SQL injection prevention)

### Adding WebSocket Event
1. Define in `CoordinatorEvents` interface
2. Emit from coordinator: `this.emit('eventName', ...)`
3. Handle in `src/server/websocket.ts`

### Adding Permission Pattern
Update `extractPattern()` and `matchesPattern()` in `src/permissions/manager.ts`

## Common Issues & Solutions

### Issue: Claude CLI Not Found
**Solution:** Ensure Claude Code CLI is installed and in PATH

### Issue: Directory Not Allowed
**Solution:** Add to `ALLOWED_DIRECTORIES` in `.env` and restart server

### Issue: Database Locked
**Solution:** Ensure single server instance; WAL mode is enabled by default

### Issue: WebSocket Disconnects
**Solution:** Check firewall, ensure WebSocket upgrade headers pass through proxy

### Issue: Permission Request Timeout
**Solution:** 10-minute limit; user must respond or request auto-denies

## Dependencies Overview

### Core
- `express`: Web server
- `ws`: WebSocket server
- `better-sqlite3`: SQLite database
- `@anthropic-ai/claude-agent-sdk`: Claude integration
- `zod`: Configuration validation

### Utilities
- `uuid`: ID generation
- `jsonwebtoken`: JWT validation (Cloudflare mode)
- `multer`: File uploads (voice transcription)
- `nodejs-whisper`: Audio transcription
- `dotenv`: Environment variables

### Development
- `typescript`: TypeScript compiler
- `tsx`: TypeScript execution with watch
- `eslint`: Linting
- `prettier`: Code formatting
- `vitest`: Testing framework

## Documentation

Comprehensive docs in `docs/`:
- `ARCHITECTURE.md`: System design and component overview
- `INSTALLATION.md`: Setup and deployment guide
- `USAGE.md`: User guide for web interface
- `API.md`: REST and WebSocket API reference
- `DEVELOPMENT.md`: Contributing guide and development workflow

## Testing

Run tests:
```bash
npm run test        # Run once
npm run test:watch  # Watch mode
```

Write tests in `src/**/__tests__/` using Vitest.

## Deployment

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

### Process Manager (PM2)
```bash
pm2 start dist/index.js --name omni-bot
pm2 save
pm2 startup
```

### Docker (Optional)
See `docs/INSTALLATION.md` for Dockerfile example.

## Monitoring

Check logs for:
- Session creation/deletion
- Permission requests (if interactive mode on)
- Error messages
- WebSocket connections

Future: Add structured logging, metrics, tracing.
