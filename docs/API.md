# API Reference

This document describes the REST and WebSocket APIs for Omni-Bot.

## Base URL

- Local: `http://localhost:3000`
- Tailscale: `http://<tailscale-ip>:3000`
- Cloudflare: `https://omni-bot.yourdomain.com`

## Authentication

### Tailscale Mode

No authentication required at the API level. Access is restricted by Tailscale network membership.

### Cloudflare Mode

All requests must include the Cloudflare Access JWT in the `Cf-Access-Jwt-Assertion` header:

```http
GET /api/sessions
Cf-Access-Jwt-Assertion: eyJhbGciOiJSUzI1NiIs...
```

The JWT is automatically added by the Cloudflare Access service when accessing through the configured domain.

## REST API

### Sessions

#### List Sessions

Returns all sessions for the authenticated user (in Cloudflare mode) or all sessions (in Tailscale mode).

```http
GET /api/sessions
```

**Response:** `200 OK`

```json
{
  "sessions": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Implement user authentication",
      "workingDirectory": "/Users/you/projects/myapp",
      "ownerEmail": "user@example.com",
      "status": "active",
      "model": "sonnet",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T11:45:00.000Z",
      "isDraft": false
    }
  ]
}
```

**Status Values:**
- `active`: Session is running and can accept messages
- `paused`: Session is suspended
- `completed`: Session finished successfully
- `errored`: Session encountered an error

**Draft Sessions:**
If `isDraft: true`, the session exists in memory but hasn't been persisted to the database yet.

---

#### Search Sessions

Search sessions by name or working directory.

```http
GET /api/sessions/search?q=authentication
```

**Query Parameters:**
- `q` (required): Search query string

**Response:** `200 OK`

```json
{
  "sessions": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Implement user authentication",
      "workingDirectory": "/Users/you/projects/myapp",
      "ownerEmail": "user@example.com",
      "status": "active",
      "model": "sonnet",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T11:45:00.000Z"
    }
  ]
}
```

---

#### Get Session

Retrieve a single session by ID.

```http
GET /api/sessions/:id
```

**Response:** `200 OK`

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Implement user authentication",
  "workingDirectory": "/Users/you/projects/myapp",
  "ownerEmail": "user@example.com",
  "status": "active",
  "model": "sonnet",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T11:45:00.000Z"
}
```

**Error Responses:**
- `404 Not Found`: Session doesn't exist
- `403 Forbidden`: Session belongs to another user (Cloudflare mode)

---

#### Create Session

Create a new session.

```http
POST /api/sessions
Content-Type: application/json

{
  "name": "Optional session name",
  "workingDirectory": "/Users/you/projects/myapp",
  "model": "sonnet"
}
```

**Request Body:**
- `name` (optional): Session name. If omitted, auto-generated from first message.
- `workingDirectory` (required): Must be in `ALLOWED_DIRECTORIES`
- `model` (optional): `haiku`, `sonnet`, or `opus`. Defaults to auto-select.

**Response:** `201 Created`

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Optional session name",
  "workingDirectory": "/Users/you/projects/myapp",
  "ownerEmail": "user@example.com",
  "status": "active",
  "model": "sonnet",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z",
  "isDraft": true
}
```

**Error Responses:**
- `400 Bad Request`: Invalid working directory or missing required fields
- `403 Forbidden`: Working directory not in `ALLOWED_DIRECTORIES`
- `503 Service Unavailable`: Max concurrent sessions reached

---

#### Update Session

Update session metadata (name, model).

```http
PATCH /api/sessions/:id
Content-Type: application/json

{
  "name": "New session name",
  "model": "opus"
}
```

**Request Body:**
- `name` (optional): New session name
- `model` (optional): Change model to `haiku`, `sonnet`, or `opus`

**Response:** `200 OK`

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "New session name",
  "workingDirectory": "/Users/you/projects/myapp",
  "ownerEmail": "user@example.com",
  "status": "active",
  "model": "opus",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T12:00:00.000Z"
}
```

---

#### Pause Session

Pause an active session.

```http
POST /api/sessions/:id/pause
```

**Response:** `200 OK`

```json
{
  "message": "Session paused"
}
```

---

#### Resume Session

Resume a paused session.

```http
POST /api/sessions/:id/resume
```

**Response:** `200 OK`

```json
{
  "message": "Session resumed"
}
```

---

#### Abort Session

Abort the current operation in a session.

```http
POST /api/sessions/:id/abort
```

**Response:** `200 OK`

```json
{
  "message": "Session aborted"
}
```

---

#### Delete Session

Delete a session and all its messages.

```http
DELETE /api/sessions/:id
```

**Response:** `204 No Content`

---

### Messages

#### Get Message History

Retrieve all messages for a session.

```http
GET /api/messages/:sessionId
```

**Query Parameters:**
- `limit` (optional): Maximum messages to return (default: 100)
- `offset` (optional): Skip N messages (for pagination)

**Response:** `200 OK`

```json
{
  "messages": [
    {
      "id": "msg-1",
      "sessionId": "550e8400-e29b-41d4-a716-446655440000",
      "role": "user",
      "content": "Create a new React component called UserProfile",
      "timestamp": "2024-01-15T10:30:00.000Z"
    },
    {
      "id": "msg-2",
      "sessionId": "550e8400-e29b-41d4-a716-446655440000",
      "role": "assistant",
      "content": "I'll create a UserProfile component for you...",
      "timestamp": "2024-01-15T10:30:15.000Z"
    }
  ]
}
```

**Message Roles:**
- `user`: Message from the user
- `assistant`: Response from Claude

---

### Local Sessions

#### List Local Sessions

Scan `~/.claude/projects/` for local Claude sessions.

```http
GET /api/local-sessions
```

**Response:** `200 OK`

```json
{
  "sessions": [
    {
      "id": "local-session-1",
      "name": "My Local Project",
      "workingDirectory": "/Users/you/projects/local-app",
      "createdAt": "2024-01-10T09:00:00.000Z"
    }
  ]
}
```

---

#### Import Local Session

Import a local Claude session into Omni-Bot.

```http
POST /api/local-sessions/import
Content-Type: application/json

{
  "localSessionId": "local-session-1"
}
```

**Response:** `201 Created`

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "My Local Project",
  "workingDirectory": "/Users/you/projects/local-app",
  "ownerEmail": "user@example.com",
  "status": "active",
  "createdAt": "2024-01-15T12:00:00.000Z",
  "updatedAt": "2024-01-15T12:00:00.000Z"
}
```

---

### Voice Transcription

#### Transcribe Audio

Transcribe an audio file to text using Whisper.

```http
POST /api/transcribe
Content-Type: multipart/form-data

audio: <audio-file>
```

**Request:**
- `audio` (file): Audio file (WAV, MP3, M4A, OGG, FLAC)
- Max size: 25MB

**Response:** `200 OK`

```json
{
  "text": "Create a new React component called UserProfile"
}
```

**Error Responses:**
- `400 Bad Request`: Missing audio file or invalid format
- `413 Payload Too Large`: File exceeds size limit

---

## WebSocket API

### Connection

Connect to the WebSocket server:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');
// or wss:// for Cloudflare

ws.onopen = () => {
  console.log('Connected to Omni-Bot');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('Disconnected from Omni-Bot');
};
```

### Client Messages

Messages sent from client to server.

#### Subscribe to Session

Subscribe to receive events for a specific session.

```json
{
  "type": "subscribe",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response:** No direct response, but you'll start receiving events for this session.

---

#### Unsubscribe from Session

Stop receiving events for a session.

```json
{
  "type": "unsubscribe",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### Send Message

Send a message to Claude in a session.

```json
{
  "type": "message",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "content": "Create a new React component called UserProfile",
  "options": {
    "model": "sonnet",
    "planMode": false
  }
}
```

**Fields:**
- `type`: Must be `"message"`
- `sessionId`: Target session ID
- `content`: User message text
- `options` (optional):
  - `model`: Override model selection (`haiku`, `sonnet`, `opus`)
  - `planMode`: Enable plan mode (default: false)

---

#### Abort Operation

Abort the current operation in a session.

```json
{
  "type": "abort",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### Respond to Permission Request

Approve or deny a permission request.

```json
{
  "type": "permissionResponse",
  "requestId": "perm-12345",
  "result": "allow-once",
  "pattern": "Bash:git commit"
}
```

**Fields:**
- `type`: Must be `"permissionResponse"`
- `requestId`: ID from the permission request event
- `result`: One of:
  - `"allow-once"`: Approve this request only
  - `"allow-similar"`: Approve this and similar requests (uses `pattern`)
  - `"deny-once"`: Deny this request only
  - `"deny-all"`: Deny this and abort the entire operation
- `pattern` (required for `allow-similar`): Pattern string from request

---

#### Respond to Claude Question

Answer a question from Claude (via AskUserQuestion tool).

```json
{
  "type": "claudeQuestionResponse",
  "questionId": "q-12345",
  "answers": {
    "question-0": "Option 1"
  }
}
```

**Fields:**
- `type`: Must be `"claudeQuestionResponse"`
- `questionId`: ID from the claude question event
- `answers`: Object mapping question IDs to selected option labels

---

### Server Messages

Messages sent from server to client.

#### Text Event

Streaming text from Claude's response.

```json
{
  "type": "text",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "data": "I'll create a UserProfile component..."
}
```

**Fields:**
- `type`: `"text"`
- `sessionId`: Session ID
- `data`: Text chunk (may be partial, accumulate on client)

---

#### Tool Use Event

Claude is using a tool.

```json
{
  "type": "tool",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "data": {
    "id": "tool-12345",
    "name": "Read",
    "input": {
      "file_path": "/Users/you/projects/myapp/src/App.tsx"
    }
  }
}
```

**Fields:**
- `type`: `"tool"`
- `sessionId`: Session ID
- `data.id`: Tool use ID
- `data.name`: Tool name (`Read`, `Write`, `Edit`, `Bash`, etc.)
- `data.input`: Tool-specific parameters

---

#### Result Event

Final result of a message exchange.

```json
{
  "type": "result",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "data": {
    "success": true,
    "stopReason": "end_turn"
  }
}
```

**Fields:**
- `type`: `"result"`
- `sessionId`: Session ID
- `data.success`: Whether the operation succeeded
- `data.stopReason`: Why Claude stopped (`end_turn`, `max_tokens`, `stop_sequence`)

---

#### Error Event

An error occurred in the session.

```json
{
  "type": "error",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "data": {
    "message": "Failed to read file: Permission denied",
    "code": "EACCES"
  }
}
```

**Fields:**
- `type`: `"error"`
- `sessionId`: Session ID
- `data.message`: Error message
- `data.code`: Error code (optional)

---

#### Session Updated Event

Session metadata was updated.

```json
{
  "type": "sessionUpdated",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Implement user authentication",
    "workingDirectory": "/Users/you/projects/myapp",
    "ownerEmail": "user@example.com",
    "status": "active",
    "model": "sonnet",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T11:45:00.000Z"
  }
}
```

Sent when session status, name, or other metadata changes.

---

#### Permission Request Event

Claude needs permission to perform an operation.

```json
{
  "type": "permissionRequest",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "data": {
    "id": "perm-12345",
    "toolName": "Write",
    "input": {
      "file_path": "/Users/you/projects/myapp/src/UserProfile.tsx",
      "content": "import React from 'react';\n\n..."
    },
    "reason": "Creating a new component as requested",
    "pattern": "Write:/Users/you/projects/myapp/src/*"
  }
}
```

**Fields:**
- `type`: `"permissionRequest"`
- `sessionId`: Session ID
- `data.id`: Request ID (use in response)
- `data.toolName`: Tool requiring permission
- `data.input`: Tool parameters
- `data.reason`: Why Claude needs this permission (optional)
- `data.pattern`: Pattern for "Allow Similar" matching

**Only sent when `INTERACTIVE_PERMISSIONS=true`.**

Client must respond with a `permissionResponse` message.

---

#### Claude Question Event

Claude is asking a question via the AskUserQuestion tool.

```json
{
  "type": "claudeQuestion",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "data": {
    "id": "q-12345",
    "questions": [
      {
        "question": "Which authentication method should we use?",
        "header": "Auth Method",
        "options": [
          {
            "label": "JWT",
            "description": "JSON Web Tokens for stateless authentication"
          },
          {
            "label": "Session Cookies",
            "description": "Traditional session-based authentication"
          }
        ],
        "multiSelect": false
      }
    ]
  }
}
```

**Fields:**
- `type`: `"claudeQuestion"`
- `sessionId`: Session ID
- `data.id`: Question ID (use in response)
- `data.questions`: Array of question objects

Client must respond with a `claudeQuestionResponse` message.

---

## Error Codes

| Code | Description |
|------|-------------|
| `400` | Bad Request - Invalid parameters |
| `401` | Unauthorized - Missing or invalid authentication |
| `403` | Forbidden - Access denied (wrong user or directory) |
| `404` | Not Found - Resource doesn't exist |
| `413` | Payload Too Large - File size exceeds limit |
| `429` | Too Many Requests - Rate limit exceeded |
| `500` | Internal Server Error - Server-side error |
| `503` | Service Unavailable - Max sessions reached or service overloaded |

## Rate Limiting

Currently, no rate limiting is enforced. Future versions may implement:
- Per-user message rate limits
- Concurrent session limits per user
- API request throttling

## Example Client Implementation

```javascript
class OmniBotClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.ws = null;
  }

  // Connect to WebSocket
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${this.baseUrl.replace('http', 'ws')}/ws`);

      this.ws.onopen = () => resolve();
      this.ws.onerror = (error) => reject(error);

      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      };
    });
  }

  // Subscribe to session
  subscribe(sessionId) {
    this.ws.send(JSON.stringify({
      type: 'subscribe',
      sessionId
    }));
  }

  // Send message
  sendMessage(sessionId, content, options = {}) {
    this.ws.send(JSON.stringify({
      type: 'message',
      sessionId,
      content,
      options
    }));
  }

  // Create session
  async createSession(workingDirectory, name, model) {
    const response = await fetch(`${this.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workingDirectory, name, model })
    });
    return response.json();
  }

  // Handle incoming messages
  handleMessage(message) {
    switch (message.type) {
      case 'text':
        console.log('Text:', message.data);
        break;
      case 'tool':
        console.log('Tool use:', message.data);
        break;
      case 'permissionRequest':
        this.handlePermissionRequest(message);
        break;
      // ... handle other message types
    }
  }

  // Respond to permission request
  respondToPermission(requestId, result, pattern) {
    this.ws.send(JSON.stringify({
      type: 'permissionResponse',
      requestId,
      result,
      pattern
    }));
  }
}

// Usage
const client = new OmniBotClient('http://localhost:3000');
await client.connect();

const session = await client.createSession('/path/to/project');
client.subscribe(session.id);
client.sendMessage(session.id, 'Create a React component');
```

## Webhooks (Future)

Future versions may support webhooks for:
- Session completion notifications
- Error alerts
- Permission request notifications

Stay tuned for updates.
