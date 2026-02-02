# Omni-Bot

Web-based Claude Code coordinator for remote access via Tailscale or Cloudflare Tunnel.

## What is Omni-Bot?

Omni-Bot is a self-hosted web application that provides remote access to Claude Code from any device. It spawns Claude sessions as child processes using the Claude Agent SDK, allowing you to interact with Claude through a web interface while maintaining all the power of Claude Code.

**Key Features:**

- 🌐 **Remote Access**: Access Claude Code from any device on your network
- 🔒 **Secure**: Authentication via Tailscale VPN or Cloudflare Access
- 💬 **Real-time Streaming**: WebSocket-based streaming of Claude responses
- 📁 **Session Management**: Persistent sessions with message history
- 🎙️ **Voice Input**: Whisper-based audio transcription
- 🛡️ **Interactive Permissions**: Review and approve file operations and shell commands
- 🤖 **Smart Model Selection**: Automatic model selection based on task complexity

## Quick Start

```bash
# Clone the repository
git clone <repository-url>
cd omni-bot

# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env to configure ALLOWED_DIRECTORIES and other settings

# Run in development mode
npm run dev
```

Visit `http://localhost:3000` in your browser.

## Documentation

- [Installation Guide](docs/INSTALLATION.md) - Detailed setup instructions
- [Usage Guide](docs/USAGE.md) - How to use Omni-Bot
- [Architecture Overview](docs/ARCHITECTURE.md) - System design and components
- [API Reference](docs/API.md) - REST and WebSocket API documentation
- [Development Guide](docs/DEVELOPMENT.md) - Contributing and development workflow

## Requirements

- **Node.js**: >= 22.0.0
- **Claude Code**: Must have Claude Code CLI installed and authenticated
- **SQLite**: Built-in via better-sqlite3
- **Network Access**: Either Tailscale mesh VPN or Cloudflare Tunnel

## Configuration

Key environment variables (see `.env.example` for full list):

```env
PORT=3000
ALLOWED_DIRECTORIES=/path/to/projects,/another/path
DATABASE_PATH=./data/omni-bot.db
AUTH_MODE=tailscale  # or cloudflare
INTERACTIVE_PERMISSIONS=true  # Require user approval for dangerous operations
```

## Security Modes

### Tailscale (Default)
No authentication at app level. Access restricted to devices on your Tailscale network.

```env
AUTH_MODE=tailscale
```

### Cloudflare Access
Public URL protected by Cloudflare Zero Trust with JWT validation.

```env
AUTH_MODE=cloudflare
CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com
CF_ACCESS_AUD=<application-audience-tag>
```

See [Installation Guide](docs/INSTALLATION.md) for detailed setup.

## Architecture

```
Browser → Express + WebSocket → Coordinator → Claude Agent SDK
                                    ↓
                                 SQLite
```

- **Express**: REST API and static file serving
- **WebSocket**: Real-time bidirectional communication
- **Coordinator**: Session lifecycle management
- **Claude Agent SDK**: Direct integration with Claude
- **SQLite**: Session and message persistence

See [Architecture Overview](docs/ARCHITECTURE.md) for details.

## Project Status

Omni-Bot is in active development. Current version: **0.1.0**

## License

See [LICENSE](LICENSE) file for details.

## Support

For issues, questions, or contributions, please use the GitHub issue tracker.
