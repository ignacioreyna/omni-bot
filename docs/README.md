# Omni-Bot Documentation

Welcome to the Omni-Bot documentation! This directory contains comprehensive guides for users, developers, and operators.

## Documentation Structure

### 📚 For Users

**[Usage Guide](USAGE.md)**
- Getting started with the web interface
- Creating and managing sessions
- Sending messages and using voice input
- Understanding Claude's responses
- Interactive permission system
- Tips and best practices

### 🛠️ For Operators

**[Installation Guide](INSTALLATION.md)**
- System requirements
- Installation steps
- Configuration options
- Setting up authentication (Tailscale or Cloudflare)
- Deployment strategies
- Troubleshooting common issues
- Security recommendations

### 🏗️ For Architects

**[Architecture Overview](ARCHITECTURE.md)**
- System design and high-level architecture
- Core components and their responsibilities
- Data flow diagrams
- Security model
- Performance considerations
- Future enhancements

### 💻 For Developers

**[Development Guide](DEVELOPMENT.md)**
- Setting up a development environment
- Project structure walkthrough
- Code style and conventions
- Testing guidelines
- Contributing workflow
- Common development tasks
- Debugging techniques

### 🔌 For Integrators

**[API Reference](API.md)**
- REST API endpoints
- WebSocket API events
- Authentication
- Request/response formats
- Error codes
- Example client implementation

## Quick Links

### Getting Started
1. [Install Omni-Bot](INSTALLATION.md#installation-steps)
2. [Configure environment](INSTALLATION.md#configure-environment)
3. [Start using the interface](USAGE.md#getting-started)

### Common Tasks
- [Create a session](USAGE.md#creating-a-session)
- [Send a message](USAGE.md#sending-messages)
- [Approve permissions](USAGE.md#interactive-permissions)
- [Import local sessions](USAGE.md#local-session-import)

### Development
- [Project structure](DEVELOPMENT.md#project-structure)
- [Making changes](DEVELOPMENT.md#making-changes)
- [Running tests](DEVELOPMENT.md#testing)
- [Submitting PRs](../CONTRIBUTING.md#pull-request-process)

### API Examples
- [Create session](API.md#create-session)
- [Send message via WebSocket](API.md#send-message)
- [Handle permission requests](API.md#respond-to-permission-request)

## Key Concepts

### Sessions
A session represents a conversation with Claude in a specific working directory. Sessions persist across browser refreshes and can be paused, resumed, or forked.

### Working Directory
The file system location where Claude operates. Must be in `ALLOWED_DIRECTORIES`. Claude can read/write files here and execute commands with this as the current directory.

### Models
Choose between three Claude models:
- **Haiku**: Fast, for simple tasks
- **Sonnet**: Balanced, for most tasks (default)
- **Opus**: Powerful, for complex tasks

### Permissions
Interactive approval system for dangerous operations:
- **Safe tools** (auto-approved): Read, Glob, Grep, Task, WebFetch, WebSearch
- **Dangerous tools** (require approval): Bash, Write, Edit

### Draft Sessions
Sessions created without a name are held in memory until the first message is sent, at which point a title is auto-generated using Claude Haiku.

## Architecture at a Glance

```
┌─────────────┐
│   Browser   │
│   (Web UI)  │
└──────┬──────┘
       │ HTTP/WebSocket
       ▼
┌─────────────────────────────┐
│     Omni-Bot Server         │
│  ┌────────────────────────┐ │
│  │     Coordinator        │ │
│  │  (Session Manager)     │ │
│  └───────┬────────────────┘ │
│          │                   │
│    ┌─────┴──────┐           │
│    │   Claude   │           │
│    │ Agent SDK  │           │
│    └─────┬──────┘           │
│          │                   │
│    ┌─────┴──────┐           │
│    │  SQLite    │           │
│    │  Database  │           │
│    └────────────┘           │
└─────────────────────────────┘
       │
       ▼
┌─────────────┐
│ Claude API  │
│ (Anthropic) │
└─────────────┘
```

## Configuration Quick Reference

```env
# Basic
PORT=3000
ALLOWED_DIRECTORIES=/path/to/projects
DATABASE_PATH=./data/omni-bot.db

# Features
INTERACTIVE_PERMISSIONS=true
MAX_CONCURRENT_SESSIONS=5

# Auth (choose one)
AUTH_MODE=tailscale
# or
AUTH_MODE=cloudflare
CF_ACCESS_TEAM_DOMAIN=team.cloudflareaccess.com
CF_ACCESS_AUD=<aud-tag>
```

## Technology Stack

- **Backend**: Node.js 22+, TypeScript, Express
- **Real-time**: WebSockets (ws library)
- **Database**: SQLite (better-sqlite3)
- **Claude Integration**: @anthropic-ai/claude-agent-sdk
- **Validation**: Zod
- **Auth**: JWT (jsonwebtoken), Cloudflare Access
- **Voice**: Whisper (nodejs-whisper)

## Support & Community

- **Issues**: Report bugs or request features on [GitHub Issues](https://github.com/yourusername/omni-bot/issues)
- **Discussions**: Ask questions in [GitHub Discussions](https://github.com/yourusername/omni-bot/discussions)
- **Contributing**: See [CONTRIBUTING.md](../CONTRIBUTING.md)
- **Changelog**: See [CHANGELOG.md](../CHANGELOG.md)

## Additional Resources

### Project Files
- [README.md](../README.md) - Project overview
- [CLAUDE.md](../CLAUDE.md) - Claude Code project context
- [LICENSE](../LICENSE) - License information
- [package.json](../package.json) - Dependencies and scripts

### External Documentation
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) - SDK documentation
- [Express.js](https://expressjs.com/) - Web framework
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) - WebSocket reference
- [SQLite](https://www.sqlite.org/docs.html) - Database documentation

## Documentation Conventions

Throughout this documentation:

- `code blocks` represent code or commands
- **Bold text** highlights important concepts
- *Italic text* emphasizes terms
- > Blockquotes indicate important notes or warnings
- 💡 Lightbulb indicates tips
- ⚠️ Warning triangle indicates cautions
- 🔒 Lock indicates security notes

## Version Information

This documentation is for:
- **Omni-Bot Version**: 0.1.0
- **Last Updated**: 2024-02-02
- **Maintained By**: Omni-Bot contributors

## Feedback

Found an issue with the documentation? Please:
1. Check if it's already reported in [GitHub Issues](https://github.com/yourusername/omni-bot/issues)
2. If not, create a new issue with the `documentation` label
3. Or submit a PR with your improvements!

---

**Happy coding with Omni-Bot! 🤖**
