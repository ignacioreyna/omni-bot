# Development Guide

This guide covers contributing to Omni-Bot, setting up a development environment, and understanding the codebase.

## Getting Started

### Prerequisites

- Node.js >= 22.0.0
- Claude Code CLI installed and authenticated
- Git
- A code editor (VS Code recommended)

### Setup

1. **Fork and clone the repository:**

   ```bash
   git clone https://github.com/yourusername/omni-bot.git
   cd omni-bot
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Create development environment:**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` to configure for your local setup:
   ```env
   PORT=3000
   ALLOWED_DIRECTORIES=/tmp,/path/to/test/projects
   DATABASE_PATH=./data/omni-bot-dev.db
   AUTH_MODE=tailscale
   INTERACTIVE_PERMISSIONS=true
   ```

4. **Run in development mode:**

   ```bash
   npm run dev
   ```

   This starts the server with `tsx watch` for automatic reloading on file changes.

## Project Structure

```
omni-bot/
├── src/
│   ├── index.ts                  # Entry point
│   ├── config.ts                 # Configuration with Zod validation
│   │
│   ├── server/                   # HTTP and WebSocket server
│   │   ├── app.ts                # Express setup
│   │   ├── websocket.ts          # WebSocket handler
│   │   ├── middleware/           # Express middleware
│   │   │   └── cf-access.ts      # Cloudflare Access JWT validation
│   │   └── routes/               # REST API routes
│   │       ├── sessions.ts       # Session CRUD
│   │       ├── messages.ts       # Message history
│   │       ├── local-sessions.ts # Import local sessions
│   │       └── auth.ts           # Authentication endpoints
│   │
│   ├── coordinator/              # Session orchestration
│   │   └── coordinator.ts        # Main coordinator class
│   │
│   ├── claude/                   # Claude integration
│   │   ├── cli-wrapper.ts        # Claude Agent SDK wrapper
│   │   └── output-parser.ts      # Stream JSON parser
│   │
│   ├── permissions/              # Permission system
│   │   └── manager.ts            # Interactive permission handling
│   │
│   ├── models/                   # Model selection
│   │   └── model-router.ts       # Auto model selection logic
│   │
│   ├── persistence/              # Database layer
│   │   ├── database.ts           # SQLite setup
│   │   └── repositories/         # Data access layer
│   │       ├── sessions.ts       # Session repository
│   │       └── messages.ts       # Message repository
│   │
│   ├── lifecycle/                # Application lifecycle
│   │   ├── startup.ts            # Initialization
│   │   └── shutdown.ts           # Graceful shutdown
│   │
│   ├── local-sessions/           # Local session import
│   │   └── scanner.ts            # Scan ~/.claude/projects
│   │
│   ├── whisper/                  # Voice transcription
│   │   └── transcriber.ts        # Whisper integration
│   │
│   └── utils/                    # Utilities
│       ├── title-generator.ts    # Auto session title generation
│       └── caffeinate.ts         # Prevent system sleep (macOS)
│
├── public/                       # Static web UI files
├── docs/                         # Documentation
├── data/                         # SQLite database (dev)
├── dist/                         # Compiled TypeScript (build output)
└── tests/                        # Tests (future)
```

## Code Style

### TypeScript

- **Strict mode enabled**: All TypeScript strict checks are on
- **Explicit types**: Prefer explicit return types for public functions
- **No `any`**: Use `unknown` if type is truly unknown
- **Interfaces vs Types**: Use interfaces for object shapes, types for unions/intersections

### Formatting

We use Prettier with the following settings (`.prettierrc`):

```json
{
  "semi": true,
  "trailingComma": "all",
  "singleQuote": true,
  "printWidth": 120,
  "tabWidth": 2
}
```

**Format code:**

```bash
npm run format
```

### Linting

We use ESLint with TypeScript support:

```bash
npm run lint
npm run lint:fix
```

### Naming Conventions

- **Files**: `kebab-case.ts` (e.g., `cli-wrapper.ts`)
- **Classes**: `PascalCase` (e.g., `Coordinator`, `PermissionManager`)
- **Functions/Variables**: `camelCase` (e.g., `sendMessage`, `activeSession`)
- **Constants**: `SCREAMING_SNAKE_CASE` (e.g., `MAX_CONCURRENT_SESSIONS`)
- **Interfaces**: `PascalCase` with `I` prefix optional (e.g., `Session`, `IConfig`)

### Comments

- Use JSDoc for public APIs
- Keep comments concise and relevant
- Explain "why", not "what"
- Update comments when code changes

Example:

```typescript
/**
 * Generates a session title from the first user message using Claude Haiku.
 * Uses ephemeral query (not persisted) for speed and cost efficiency.
 */
export async function generateSessionTitle(message: string): Promise<string> {
  // Implementation...
}
```

## Development Workflow

### Branch Strategy

We use a simplified Git Flow:

- `main`: Production-ready code
- `develop`: Integration branch for features
- `feat/*`: Feature branches
- `fix/*`: Bug fix branches
- `docs/*`: Documentation updates

### Commit Convention

We follow Conventional Commits:

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, no logic change)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**

```bash
feat(coordinator): add draft session support

fix(websocket): handle disconnection gracefully

docs(api): add WebSocket API documentation

refactor(permissions): extract pattern matching to util
```

### Making Changes

1. **Create a feature branch:**

   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feat/your-feature-name
   ```

2. **Make your changes:**

   - Write code following style guidelines
   - Add tests if applicable
   - Update documentation

3. **Test your changes:**

   ```bash
   npm run lint
   npm run format
   npm run test  # When tests are available
   ```

4. **Commit your changes:**

   ```bash
   git add .
   git commit -m "feat(scope): your change description"
   ```

5. **Push and create a PR:**

   ```bash
   git push origin feat/your-feature-name
   ```

   Then create a PR on GitHub targeting `develop`.

## Testing

### Unit Tests

We use Vitest for unit testing:

```bash
npm run test        # Run once
npm run test:watch  # Watch mode
```

**Writing tests:**

```typescript
// src/utils/__tests__/title-generator.test.ts
import { describe, it, expect } from 'vitest';
import { generateSessionTitle } from '../title-generator';

describe('generateSessionTitle', () => {
  it('should generate a concise title from message', async () => {
    const message = 'Create a React component for user profile';
    const title = await generateSessionTitle(message);

    expect(title).toBeTruthy();
    expect(title.length).toBeLessThan(50);
  });
});
```

### Integration Tests

Future: Integration tests for API endpoints and WebSocket communication.

### E2E Tests

Future: End-to-end tests using Playwright or Cypress.

## Debugging

### Server Debugging

1. **Enable Node.js inspector:**

   ```bash
   node --inspect dist/index.js
   ```

2. **Attach VS Code debugger:**

   Create `.vscode/launch.json`:

   ```json
   {
     "version": "0.2.0",
     "configurations": [
       {
         "type": "node",
         "request": "launch",
         "name": "Debug Omni-Bot",
         "runtimeExecutable": "tsx",
         "runtimeArgs": ["watch", "src/index.ts"],
         "skipFiles": ["<node_internals>/**"]
       }
     ]
   }
   ```

3. **Set breakpoints** in your IDE and press F5.

### Database Debugging

Inspect the SQLite database:

```bash
sqlite3 ./data/omni-bot-dev.db

# List tables
.tables

# Show schema
.schema sessions

# Query data
SELECT * FROM sessions;
SELECT * FROM messages WHERE sessionId = 'your-session-id';

# Exit
.quit
```

### WebSocket Debugging

Use browser DevTools:

1. Open DevTools (F12)
2. Navigate to **Network** tab
3. Filter by **WS** (WebSocket)
4. Click on the WebSocket connection
5. View **Messages** to see all sent/received data

Or use a WebSocket client like [websocat](https://github.com/vi/websocat):

```bash
websocat ws://localhost:3000/ws
```

## Common Development Tasks

### Adding a New Route

1. **Create route file:**

   ```typescript
   // src/server/routes/example.ts
   import { Router } from 'express';

   export const exampleRouter = Router();

   exampleRouter.get('/example', (req, res) => {
     res.json({ message: 'Hello from example route' });
   });
   ```

2. **Register in app:**

   ```typescript
   // src/server/app.ts
   import { exampleRouter } from './routes/example.js';

   app.use('/api', exampleRouter);
   ```

### Adding a Database Table

1. **Update schema:**

   ```typescript
   // src/persistence/database.ts
   db.exec(`
     CREATE TABLE IF NOT EXISTS example (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       createdAt TEXT NOT NULL
     )
   `);
   ```

2. **Create repository:**

   ```typescript
   // src/persistence/repositories/example.ts
   import { db } from '../database.js';

   export interface Example {
     id: string;
     name: string;
     createdAt: string;
   }

   export function createExample(example: Omit<Example, 'id'>): Example {
     const id = randomUUID();
     const stmt = db.prepare('INSERT INTO example (id, name, createdAt) VALUES (?, ?, ?)');
     stmt.run(id, example.name, example.createdAt);
     return { id, ...example };
   }

   export function getExample(id: string): Example | null {
     const stmt = db.prepare('SELECT * FROM example WHERE id = ?');
     return stmt.get(id) as Example | null;
   }
   ```

### Adding a WebSocket Event

1. **Define event in coordinator:**

   ```typescript
   // src/coordinator/coordinator.ts
   export interface CoordinatorEvents {
     // ... existing events
     newEvent: (sessionId: string, data: any) => void;
   }
   ```

2. **Emit event:**

   ```typescript
   this.emit('newEvent', sessionId, { foo: 'bar' });
   ```

3. **Handle in WebSocket:**

   ```typescript
   // src/server/websocket.ts
   coordinator.on('newEvent', (sessionId, data) => {
     broadcastToSession(sessionId, {
       type: 'newEvent',
       sessionId,
       data,
     });
   });
   ```

### Adding a Permission Pattern

1. **Update pattern extraction:**

   ```typescript
   // src/permissions/manager.ts
   export function extractPattern(toolName: string, input: Record<string, unknown>): string {
     switch (toolName) {
       case 'NewTool':
         const param = input.param as string | undefined;
         if (!param) return `NewTool:*`;
         return `NewTool:${param}`;

       // ... existing cases
     }
   }
   ```

2. **Update pattern matching:**

   ```typescript
   export function matchesPattern(toolName: string, input: Record<string, unknown>, pattern: string): boolean {
     const [patternTool, patternValue] = pattern.split(':', 2);

     if (patternTool !== toolName) return false;

     if (toolName === 'NewTool') {
       const param = input.param as string | undefined;
       // Custom matching logic
     }

     // ... existing logic
   }
   ```

## Performance Considerations

### Database Optimization

- Use indexes for frequently queried columns
- Use transactions for bulk operations
- Enable WAL mode (already done in `database.ts`)

### Memory Management

- Each Claude process uses ~200-500MB of memory
- Limit concurrent sessions via `MAX_CONCURRENT_SESSIONS`
- Consider session cleanup for old/inactive sessions

### WebSocket Scaling

- Current implementation: single server, all sessions in memory
- Future: Consider Redis for session state in multi-server setup
- Use connection pooling for database in production

## Security Best Practices

### Input Validation

Always validate user input:

```typescript
import { z } from 'zod';

const createSessionSchema = z.object({
  name: z.string().max(100).optional(),
  workingDirectory: z.string().min(1),
  model: z.enum(['haiku', 'sonnet', 'opus']).optional(),
});

const body = createSessionSchema.parse(req.body);
```

### Path Validation

Prevent directory traversal:

```typescript
import path from 'path';

function validateDirectory(dir: string): boolean {
  const resolved = path.resolve(dir);
  return appConfig.allowedDirectories.some(allowed =>
    resolved.startsWith(path.resolve(allowed))
  );
}
```

### SQL Injection Prevention

Always use prepared statements:

```typescript
// Good
const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
const session = stmt.get(sessionId);

// Bad - DO NOT DO THIS
const session = db.prepare(`SELECT * FROM sessions WHERE id = '${sessionId}'`).get();
```

### JWT Validation

In Cloudflare mode, always validate JWT tokens:

```typescript
import jwt from 'jsonwebtoken';

const decoded = jwt.verify(token, publicKey, {
  audience: appConfig.cfAccessAud,
  issuer: `https://${appConfig.cfAccessTeamDomain}`,
});
```

## Troubleshooting Development Issues

### Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000

# Kill process
kill -9 <PID>
```

### TypeScript Compilation Errors

```bash
# Clean build
rm -rf dist/
npm run build
```

### Database Schema Mismatch

```bash
# Delete dev database and restart
rm ./data/omni-bot-dev.db
npm run dev
```

### Claude SDK Issues

Check Claude Code CLI is authenticated:

```bash
claude --version
claude auth status
```

## Contributing Guidelines

### Before Submitting a PR

- [ ] Code follows style guidelines
- [ ] Lint passes (`npm run lint`)
- [ ] Format applied (`npm run format`)
- [ ] Tests pass (when available)
- [ ] Documentation updated (if applicable)
- [ ] Commit messages follow convention
- [ ] PR targets `develop` branch
- [ ] PR description explains the change

### PR Review Process

1. Automated checks run (lint, format, tests)
2. Code review by maintainer
3. Address feedback
4. Approval and merge to `develop`
5. Periodic release to `main`

## Release Process

1. Update version in `package.json`
2. Update CHANGELOG.md
3. Create release branch: `release/v0.2.0`
4. Test thoroughly
5. Merge to `main` and tag: `git tag v0.2.0`
6. Push tags: `git push origin v0.2.0`
7. Create GitHub release with changelog
8. Merge back to `develop`

## Resources

- [Claude Agent SDK Documentation](https://github.com/anthropics/claude-agent-sdk)
- [Express Documentation](https://expressjs.com/)
- [better-sqlite3 Documentation](https://github.com/WiseLibs/better-sqlite3)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [Zod Documentation](https://zod.dev/)

## Getting Help

- Check existing issues on GitHub
- Ask questions in GitHub Discussions
- Review the [Architecture docs](ARCHITECTURE.md)
- Read the [API docs](API.md)

## License

By contributing to Omni-Bot, you agree that your contributions will be licensed under the project's license.
