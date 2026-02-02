# Architecture Overview

## System Design

Omni-Bot is a TypeScript-based web server that provides remote access to Claude Code through a modern web interface. The architecture is designed for reliability, real-time communication, and secure multi-user access.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                          Browser                             │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │  Web UI      │  │  WebSocket   │  │  REST API       │  │
│  │  (Static)    │  │  Client      │  │  Client         │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬────────┘  │
└─────────┼──────────────────┼───────────────────┼───────────┘
          │                  │                   │
          │                  │                   │
┌─────────┼──────────────────┼───────────────────┼───────────┐
│         │  Omni-Bot Server │                   │           │
│         │                  │                   │           │
│  ┌──────▼───────┐  ┌───────▼────────┐  ┌──────▼────────┐ │
│  │  Static      │  │  WebSocket     │  │  REST API     │ │
│  │  Files       │  │  Handler       │  │  Routes       │ │
│  └──────────────┘  └───────┬────────┘  └──────┬────────┘ │
│                            │                   │           │
│                    ┌───────▼───────────────────▼─────┐    │
│                    │       Coordinator               │    │
│                    │  (Session Management)           │    │
│                    └───────┬─────────────────────────┘    │
│                            │                               │
│         ┌──────────────────┼──────────────────┐           │
│         │                  │                  │           │
│  ┌──────▼─────────┐ ┌─────▼─────────┐ ┌──────▼────────┐ │
│  │  Permission    │ │  Model        │ │  Claude Agent │ │
│  │  Manager       │ │  Router       │ │  SDK          │ │
│  └────────────────┘ └───────────────┘ └──────┬────────┘ │
│                                               │           │
│  ┌────────────────────────────────────────────┼─────────┐│
│  │           Persistence Layer                │         ││
│  │  ┌──────────────┐  ┌──────────────────┐   │         ││
│  │  │  Sessions    │  │  Messages        │   │         ││
│  │  │  Repository  │  │  Repository      │   │         ││
│  │  └──────┬───────┘  └────────┬─────────┘   │         ││
│  │         │                   │              │         ││
│  │         └───────┬───────────┘              │         ││
│  │                 │                          │         ││
│  │          ┌──────▼───────┐                  │         ││
│  │          │  SQLite DB   │                  │         ││
│  │          └──────────────┘                  │         ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                  Claude API (Anthropic)
```

## Core Components

### 1. Server Layer (`src/server/`)

**Express Application** (`app.ts`)
- HTTP server setup
- Static file serving for web UI
- Middleware configuration (CORS, JSON parsing, auth)
- Route registration

**WebSocket Handler** (`websocket.ts`)
- Bidirectional real-time communication
- Message streaming from Claude
- Tool use notifications
- Permission request handling
- Session subscription management

**Routes** (`routes/`)
- `sessions.ts`: CRUD operations for sessions
- `messages.ts`: Message history retrieval
- `local-sessions.ts`: Import local Claude sessions
- `auth.ts`: Authentication endpoints

**Middleware** (`middleware/`)
- `cf-access.ts`: Cloudflare Access JWT validation

### 2. Coordinator (`src/coordinator/`)

The **Coordinator** is the central orchestrator of the application. It manages:

**Session Lifecycle:**
- Creates and manages Claude process instances
- Handles session pause/resume/abort
- Tracks active sessions and resource limits
- Manages draft sessions (unpersisted until first message)

**Message Routing:**
- Routes user messages to appropriate Claude instances
- Streams responses back to WebSocket clients
- Handles multi-turn conversations
- Accumulates streaming text across message boundaries

**Event Management:**
- Emits events for text, tool use, results, errors
- Coordinates between permission manager and WebSocket
- Handles AskUserQuestion requests from Claude

**Key Features:**
- Draft sessions: Sessions created without names are held in memory until first message
- Fork sessions: Resume from existing session history
- Model selection: Auto-selects or accepts explicit model choice
- Plan mode: Special mode for planning tasks

### 3. Claude Integration (`src/claude/`)

**CLI Wrapper** (`cli-wrapper.ts`)
- Uses `@anthropic-ai/claude-agent-sdk` instead of spawning CLI directly
- Provides async generator API for streaming responses
- Handles tool permissions via `canUseTool` callback
- Manages session state and working directory

**Output Parser** (`output-parser.ts`)
- Parses streaming JSON events from Claude
- Handles partial JSON chunks
- Emits structured events for different Claude outputs

**Why SDK vs CLI?**
The Claude CLI checks `isatty()` and refuses to output `stream-json` to non-TTY stdout. When spawned from Node.js, we get pipes (not TTY), so the CLI fails. The SDK handles this internally and provides a clean async API.

### 4. Permission System (`src/permissions/`)

**Permission Manager** (`manager.ts`)
- Interactive approval system for dangerous operations
- Auto-approves safe tools: `Read`, `Glob`, `Grep`, `Task`, `WebFetch`, `WebSearch`
- Requires approval for: `Bash`, `Write`, `Edit`
- Pattern extraction for "Allow Similar" feature
- Timeout handling (10-minute timeout per request)

**Pattern Matching:**
- Bash: Extracts command prefix (e.g., "git commit", "npm install")
- File operations: Extracts directory path
- Allows users to approve entire categories of operations

### 5. Model Router (`src/models/`)

**Model Router** (`model-router.ts`)
- Analyzes incoming messages to determine task complexity
- Auto-selects between Haiku, Sonnet, and Opus
- Used for title generation (always uses Haiku)
- Can be overridden by explicit model selection

**Selection Criteria:**
- Keywords: "explain", "simple", "quick" → Haiku
- Keywords: "refactor", "optimize", "architecture" → Opus
- Code length: < 50 lines → Haiku, > 200 lines → Opus
- Default: Sonnet

### 6. Persistence Layer (`src/persistence/`)

**Database** (`database.ts`)
- SQLite setup using better-sqlite3
- Schema migrations
- Connection management

**Repositories** (`repositories/`)
- `sessions.ts`: Session CRUD operations
  - Tracks: id, name, workingDirectory, ownerEmail, status, model
  - Status: active, paused, completed, errored
- `messages.ts`: Message history
  - Tracks: id, sessionId, role, content, timestamp

**Tables:**
```sql
sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workingDirectory TEXT NOT NULL,
  ownerEmail TEXT NOT NULL,
  status TEXT NOT NULL,
  model TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
)

messages (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (sessionId) REFERENCES sessions(id)
)
```

### 7. Utilities (`src/utils/`)

**Title Generator** (`title-generator.ts`)
- Auto-generates session titles from first user message
- Uses Claude Haiku for speed and cost-efficiency
- Runs as ephemeral query (not persisted)

**Caffeinate** (`caffeinate.ts`)
- Prevents system sleep during active sessions
- macOS-specific utility

### 8. Lifecycle Management (`src/lifecycle/`)

**Startup** (`startup.ts`)
- Database initialization
- Schema migrations
- Health checks
- Environment validation

**Shutdown** (`shutdown.ts`)
- Graceful shutdown handlers
- Cleans up active Claude processes
- Closes database connections
- Handles SIGINT, SIGTERM signals

### 9. Local Sessions (`src/local-sessions/`)

**Scanner** (`scanner.ts`)
- Scans `~/.claude/projects/` for existing Claude sessions
- Imports local sessions into Omni-Bot
- Preserves session history and context

### 10. Voice Input (`src/whisper/`)

**Transcriber** (`transcriber.ts`)
- Audio transcription using Whisper
- Converts voice messages to text
- Supports file upload via multer

## Data Flow

### Creating a Session

1. User sends POST to `/api/sessions`
2. Server validates working directory against `ALLOWED_DIRECTORIES`
3. Coordinator creates draft session (in-memory only)
4. Session ID returned to client
5. On first message, title is auto-generated and session persisted

### Sending a Message

1. Client sends message via WebSocket: `{ type: "message", sessionId, content }`
2. WebSocket handler calls `coordinator.sendMessage()`
3. Coordinator checks for existing Claude process or creates new one
4. Message sent to Claude Agent SDK
5. SDK streams back responses as async generator
6. Coordinator accumulates text and emits events
7. Events sent to WebSocket clients
8. Messages saved to database

### Tool Permission Flow

1. Claude wants to use a tool (e.g., `Write`)
2. SDK calls `canUseTool` callback
3. Permission manager checks if tool is safe
4. If dangerous and `INTERACTIVE_PERMISSIONS=true`:
   - Request held in pending queue
   - `permissionRequest` event emitted to WebSocket
   - User approves/denies via WebSocket
   - Promise resolved with result
5. Result returned to Claude SDK

### Streaming Text Accumulation

Claude SDK emits multiple `assistant` messages during a turn:
- Before tool use: "I'll check the file..."
- After tool use: "Now I'll proceed..."

Coordinator tracks message boundaries and separates text with `\n\n`.

## Security Model

### Directory Access Control

**Allowed Directories:**
- Sessions can only be created in directories listed in `ALLOWED_DIRECTORIES`
- Paths are validated and resolved to absolute paths
- Prevents directory traversal attacks

**Readable Directories:**
- Additional directories that can be read but not used as working directories
- Useful for shared resources, configuration files, etc.

### Authentication Modes

**Tailscale Mode** (default):
- No authentication at application level
- Security handled by Tailscale mesh VPN
- Only devices on your Tailscale network can access

**Cloudflare Mode:**
- JWT validation via Cloudflare Access
- User identity extracted from JWT claims
- Sessions scoped per user email
- Supports multiple auth providers (Google, GitHub, email OTP)

### Session Ownership

In Cloudflare mode:
- Sessions are tied to user email from JWT
- Users can only see/modify their own sessions
- Admin users can see all sessions (future feature)

## Configuration

See `src/config.ts` for full configuration schema validated with Zod:

**Core Settings:**
- `PORT`: Server port
- `ALLOWED_DIRECTORIES`: Comma-separated list of allowed working directories
- `READABLE_DIRECTORIES`: Additional read-only directories
- `DATABASE_PATH`: SQLite database file location
- `MAX_CONCURRENT_SESSIONS`: Limit concurrent Claude processes

**Auth Settings:**
- `AUTH_MODE`: `tailscale` or `cloudflare`
- `CF_ACCESS_TEAM_DOMAIN`: Cloudflare team domain
- `CF_ACCESS_AUD`: Application Audience tag

**Feature Flags:**
- `INTERACTIVE_PERMISSIONS`: Enable interactive permission approval UI
- `SESSION_SECRET`: Secret for session token signing

## Error Handling

**Application Level:**
- Process-level error handlers for unhandled rejections
- Graceful shutdown on SIGINT/SIGTERM
- Database transaction rollback on errors

**Session Level:**
- Sessions marked as `errored` on Claude process failure
- Error events emitted to WebSocket clients
- Automatic cleanup of failed processes

**Permission Timeouts:**
- 10-minute timeout for permission requests
- Automatic denial if user doesn't respond
- Cleanup of expired requests

## Performance Considerations

**Concurrent Sessions:**
- Limit controlled by `MAX_CONCURRENT_SESSIONS`
- Each session spawns a separate Claude process
- Memory usage scales with active sessions

**Database:**
- SQLite in WAL mode for better concurrency
- Indexes on sessionId for fast message retrieval
- Message history can grow large (consider pruning strategy)

**Streaming:**
- WebSocket for low-latency real-time updates
- Chunked responses for large outputs
- Buffering to handle network backpressure

## Future Enhancements

- **Multi-user collaboration**: Multiple users in same session
- **Session sharing**: Read-only session links
- **Advanced permissions**: Fine-grained file/directory rules
- **Session templates**: Pre-configured working environments
- **Observability**: Metrics, tracing, structured logging
- **Rate limiting**: Per-user request limits
- **Audit logging**: Track all operations for compliance
