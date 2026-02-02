# Usage Guide

This guide covers how to use Omni-Bot for day-to-day coding tasks with Claude.

## Getting Started

### Accessing Omni-Bot

- **Tailscale**: Navigate to `http://<tailscale-ip>:3000`
- **Cloudflare**: Navigate to your configured domain (e.g., `https://omni-bot.yourdomain.com`)

You should see the Omni-Bot web interface with a list of sessions (if any exist) and a "New Session" button.

## Creating a Session

1. Click the **"New Session"** button in the top right
2. A modal will appear with:
   - **Working Directory**: Select from allowed directories
   - **Optional Session Name**: Leave blank for auto-generated title
3. Click **"Create Session"**

The session will be created as a "draft" (not yet saved to database). When you send the first message, a title will be auto-generated using Claude.

### Working Directory

The working directory is where Claude will operate. It can:
- Read and write files in this directory
- Execute shell commands with this as the current directory
- Use relative paths from this location

Only directories listed in `ALLOWED_DIRECTORIES` (from `.env`) can be selected.

## Sending Messages

### Text Input

1. Type your message in the input box at the bottom
2. Press **Enter** or click the **Send** button
3. Claude will respond in real-time

**Tips:**
- Use natural language to describe what you want
- Be specific about file paths and requirements
- Ask follow-up questions to refine the response

### Voice Input

1. Click the **microphone icon** next to the input box
2. Record your message
3. Upload the audio file
4. Audio will be transcribed using Whisper
5. Transcribed text appears in the input box
6. Review and click Send

### Example Messages

```
Can you help me debug this error in server.ts?
```

```
Create a new React component called UserProfile that displays name and email
```

```
Refactor the database.ts file to use async/await instead of callbacks
```

```
Write tests for the authentication middleware
```

## Model Selection

Omni-Bot automatically selects the best Claude model based on your task:

- **Haiku**: Fast, for simple tasks (explanations, quick edits)
- **Sonnet**: Balanced, for most coding tasks (default)
- **Opus**: Powerful, for complex tasks (architecture, refactoring)

### Manual Model Selection

You can override the automatic selection:

1. Click the **model selector** dropdown (top of chat)
2. Choose: Haiku, Sonnet, or Opus
3. Selection applies to next message only

**When to use each:**
- **Haiku**: "Explain this function", "Fix this typo", "Generate a simple test"
- **Sonnet**: Most general coding tasks, debugging, feature implementation
- **Opus**: Large refactoring, architectural decisions, complex algorithms

## Understanding Claude's Responses

### Streaming Text

Claude's responses appear in real-time as they're generated. You'll see:
- Text explanations of what Claude is doing
- Code snippets with syntax highlighting
- File paths with references like `file.ts:42`

### Tool Use

When Claude needs to perform actions, you'll see tool use indicators:

- **📖 Read**: Reading a file
- **✏️ Edit**: Modifying a file
- **📝 Write**: Creating a new file
- **🔍 Grep/Glob**: Searching for files or content
- **⚡ Bash**: Executing a shell command
- **🤔 Task**: Spawning a specialized agent

Tool use appears in the message stream with details about what's being done.

## Interactive Permissions

If `INTERACTIVE_PERMISSIONS=true` is set, dangerous operations require approval.

### Permission Request Flow

1. Claude wants to perform a dangerous operation (e.g., write a file)
2. A permission modal appears with:
   - **Tool name**: What Claude wants to do
   - **Input details**: Specific parameters (file path, command, etc.)
   - **Reason**: Why Claude needs this permission

3. You have four options:
   - **Allow Once**: Approve this specific request
   - **Allow Similar**: Approve this and similar requests (e.g., all files in same directory)
   - **Deny Once**: Reject this specific request
   - **Deny All**: Stop the entire operation

### Safe vs Dangerous Tools

**Automatically approved** (read-only):
- `Read`: Reading files
- `Glob`: Finding files by pattern
- `Grep`: Searching file contents
- `Task`: Spawning sub-agents
- `WebFetch`: Fetching URLs
- `WebSearch`: Web searches

**Require approval** (write operations):
- `Bash`: Executing shell commands
- `Write`: Creating new files
- `Edit`: Modifying existing files

### Allow Similar Patterns

When you click "Allow Similar", future requests matching a pattern are auto-approved:

**Bash commands:**
- `git commit` → Allows all `git commit` commands
- `npm install` → Allows all `npm install` commands

**File operations:**
- `/path/to/src/file.ts` → Allows all operations in `/path/to/src/`

**Use with caution**: This grants broad permissions. Review what you're approving.

## Session Management

### Viewing Sessions

The sidebar (left panel) shows all your sessions:
- **Active**: Currently in progress
- **Paused**: Suspended sessions
- **Completed**: Finished sessions
- **Errored**: Sessions that encountered errors

Click any session to view its history and continue the conversation.

### Session Actions

Each session has actions (accessible via menu or buttons):

- **Pause**: Suspend the session (keeps it in memory but prevents new messages)
- **Resume**: Reactivate a paused session
- **Abort**: Stop the current operation (useful if Claude is stuck)
- **Delete**: Remove the session permanently

### Session Status

Sessions have different states:

| Status | Description |
|--------|-------------|
| **Active** | Currently processing messages |
| **Paused** | Suspended, can be resumed |
| **Completed** | Finished, no longer active |
| **Errored** | Encountered an error, check logs |

### Searching Sessions

Use the search box in the sidebar to filter sessions by name or working directory.

## Plan Mode

Plan mode allows Claude to explore your codebase and create an implementation plan before writing code.

### Enabling Plan Mode

1. Click the **"Plan Mode"** toggle (near model selector)
2. Send your request
3. Claude will:
   - Explore relevant files
   - Understand the architecture
   - Create a detailed plan
   - Ask for your approval before implementing

### When to Use Plan Mode

Use plan mode for:
- Large refactoring across multiple files
- New feature implementation
- Architectural changes
- Complex bug fixes

Don't use plan mode for:
- Simple edits or fixes
- Single-file changes
- Quick questions or explanations

## Message History

All messages are persisted to the database. You can:
- Scroll up to view previous messages
- Click a session to see its full history
- Search messages (future feature)

Message history includes:
- User messages
- Claude responses (text only, tools collapsed)
- Timestamps

## Tips and Best Practices

### Writing Effective Prompts

**Be specific:**
```
❌ "Fix the bug"
✅ "Fix the null pointer exception in getUserData() at line 42 of api.ts"
```

**Provide context:**
```
❌ "Add a button"
✅ "Add a submit button to the login form in LoginPage.tsx that calls handleLogin on click"
```

**Break down complex tasks:**
```
❌ "Build a complete authentication system"
✅ First: "Create a login endpoint that validates email/password"
   Then: "Add JWT token generation to the login endpoint"
   Then: "Create middleware to verify JWT tokens"
```

### Working with Files

**Claude can:**
- Read files in the working directory and `READABLE_DIRECTORIES`
- Create/modify files in the working directory only
- Execute commands with the working directory as CWD

**Claude cannot:**
- Access files outside allowed directories
- Modify files in `READABLE_DIRECTORIES`
- Execute privileged commands (unless you approve)

### Managing Long Conversations

Claude has a large context window (1M tokens), but for very long sessions:
- Consider creating a new session for major topic changes
- Use plan mode to organize large tasks
- Ask Claude to summarize before moving to a new topic

### Handling Errors

If Claude encounters an error:
1. Check the error message in the UI
2. Review any file paths or commands that failed
3. Verify permissions (if interactive mode is on)
4. Try asking Claude to retry with more context

If Claude gets stuck:
- Use the **Abort** button to stop the current operation
- Try rephrasing your request
- Check that required files/directories exist

## Keyboard Shortcuts

- **Enter**: Send message (Shift+Enter for new line)
- **Escape**: Close modals
- **Ctrl/Cmd + K**: Focus on input box
- **Ctrl/Cmd + N**: New session (future)

## Advanced Features

### Forking Sessions

You can resume from an existing session's history:
1. Create a new session
2. Select "Fork from existing" (future feature)
3. Choose the session to fork from
4. New session starts with the full context of the original

### Local Session Import

Import existing Claude Code sessions from your local machine:
1. Navigate to **Settings** > **Import Local Sessions**
2. Omni-Bot scans `~/.claude/projects/` for session data
3. Select sessions to import
4. Imported sessions appear in your session list with full history

### Voice Input Formats

Supported audio formats:
- WAV
- MP3
- M4A
- OGG
- FLAC

Max file size: 25MB (configurable)

## Troubleshooting

### Claude Not Responding

- Check session status (may be paused or errored)
- Try aborting and resending the message
- Check browser console for errors
- Verify WebSocket connection (DevTools > Network > WS)

### Permission Request Timeout

If you don't respond to a permission request within 10 minutes:
- Request is automatically denied
- Claude will inform you of the denial
- You can retry by resending the message

### File Not Found Errors

- Verify the file path is correct relative to working directory
- Check that the file exists: `ls -la <path>`
- Ensure the file is in an allowed directory

### WebSocket Disconnected

If the WebSocket connection drops:
- The UI will show a "Disconnected" indicator
- Refresh the page to reconnect
- Session state is preserved in the database

## Getting Help

- Check the [Architecture docs](ARCHITECTURE.md) to understand how things work
- Review the [API docs](API.md) for programmatic access
- File issues on GitHub for bugs or feature requests
- Check server logs for detailed error information

## Best Practices Summary

1. ✅ Use specific, detailed prompts
2. ✅ Select appropriate working directories
3. ✅ Review permission requests carefully
4. ✅ Use plan mode for complex tasks
5. ✅ Create separate sessions for different projects
6. ✅ Keep conversations focused on one topic
7. ❌ Don't approve "Allow Similar" without understanding the scope
8. ❌ Don't include sensitive data in messages (it's logged)
9. ❌ Don't leave interactive permission requests pending indefinitely
