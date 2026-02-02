# Changelog

All notable changes to Omni-Bot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Comprehensive documentation suite (Architecture, Installation, Usage, API, Development)
- Updated CLAUDE.md with detailed reference information
- CHANGELOG.md for tracking project changes
- CONTRIBUTING.md for contributor guidelines

## [0.1.0] - 2024-01-31

### Added
- Initial release of Omni-Bot
- Web-based interface for Claude Code access
- Session management with SQLite persistence
- Real-time WebSocket communication
- Interactive permission system for dangerous operations
- Model selection (Haiku, Sonnet, Opus) with auto-routing
- Draft sessions with auto-generated titles
- Voice input via Whisper transcription
- Local session import from `~/.claude/projects/`
- Cloudflare Access authentication support
- Tailscale VPN support (default mode)
- Pattern-based permission approval ("Allow Similar" feature)
- Session search functionality
- Pause/resume/abort session controls
- Message history persistence
- Plan mode support
- Directory access controls (ALLOWED_DIRECTORIES, READABLE_DIRECTORIES)
- Graceful shutdown handlers
- System sleep prevention during active sessions (macOS)

### Security
- JWT validation for Cloudflare Access mode
- Directory whitelist enforcement
- SQL injection prevention via prepared statements
- Session ownership per user in Cloudflare mode
- Interactive approval for write operations (Bash, Write, Edit)

### Developer Experience
- TypeScript with strict mode
- ESLint and Prettier configuration
- Hot reload in development mode
- Zod-based configuration validation
- Modular architecture with clear separation of concerns

## [0.0.1] - 2024-01-15

### Added
- Initial project structure
- Basic Express server
- SQLite database setup
- Coordinator pattern implementation
- Claude Agent SDK integration

---

## Version History

- **0.1.0**: First production-ready release with full feature set
- **0.0.1**: Initial development version

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute to this changelog.

## Release Process

1. Update version in `package.json`
2. Update this CHANGELOG with new version section
3. Create release branch
4. Test thoroughly
5. Merge to main and tag release
6. Deploy to production

---

[Unreleased]: https://github.com/yourusername/omni-bot/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yourusername/omni-bot/releases/tag/v0.1.0
[0.0.1]: https://github.com/yourusername/omni-bot/releases/tag/v0.0.1
