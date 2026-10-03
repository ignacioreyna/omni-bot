# Omni-Bot

Mobile web terminal for tmux sessions running Claude Code, exposed via Cloudflare Tunnel (or Tailscale). See `README.md` for setup.

## Architecture

```
Browser (xterm.js) ─WS /ws/terminal─▶ omni-bot ─node-pty─▶ `tmux attach -t =<session>`
                   ─REST /api/*────▶ omni-bot ─execFile─▶ tmux list/new/kill-session

Internet ─▶ CF Tunnel ─▶ wake server (:3000, launchd) ─proxy─▶ omni-bot (:3001)
```

- **tmux is the source of truth.** omni-bot is stateless: no DB, no session registry. Restarting it never kills sessions.
- **The real `claude` CLI runs inside tmux.** We deliberately dropped the Agent SDK, the permission relay and the message DB. The CLI's own TUI handles all of that.
- **Wake server** (`src/wake/`) is the always-on, minimal-dependency process that starts, stops and rebuilds omni-bot remotely. Keep its imports free of heavy/native deps (no node-pty).

## Project Structure

```
src/
├── index.ts                     # Entry: HTTP server + terminal WS
├── config.ts                    # Zod env config; allowed dirs are realpath'd
├── tmux/tmux.ts                 # All tmux CLI calls (list/create/kill/scroll)
├── claude-sessions/             # Local Claude sessions outside tmux (list, resume, take over)
├── server/
│   ├── app.ts                   # REST routes, static files, /vendor xterm assets
│   ├── terminal-ws.ts           # WS <-> node-pty bridge, heartbeat
│   ├── directories.ts           # Directory picker candidates
│   └── middleware/cf-access.ts  # authenticate(req) for HTTP + WS upgrade
├── shared/cf-jwt.ts             # CF Access JWT validation (shared with wake)
└── wake/                        # Wake server (proxy + process manager + status page)
public/                          # Vanilla JS frontend (no build step)
scripts/notify.sh                # Claude Code hook -> ntfy push
support/*.plist                  # launchd agents (wake, tunnel, caffeinate)
```

## API

- `GET /api/health`: no auth (used by the wake server's readiness check)
- `GET /api/config`
- `GET /api/sessions`, `POST /api/sessions {cwd, name?, command?}`, `DELETE /api/sessions/:name`
- `GET /api/directories`
- `GET /api/local-sessions` returns `{running, recent}`: Claude sessions started outside tmux
- `POST /api/local-sessions/:id/resume {mode?: 'fork'|'takeover'}` opens `claude --resume <id>` in a new tmux session. `mode` is required while the original is still running.
- `WS /ws/terminal?session=&cols=&rows=`. Client sends JSON `{t:'input',d}`, `{t:'resize',cols,rows}`, `{t:'scroll',dir}`, `{t:'scroll-exit'}`. Server sends raw terminal output.

## Gotchas

- **Always target sessions with `=name`** (`sessionTarget()`): a bare name lets tmux prefix-match a different session. Commands that take a *pane* target (`set-option`, `send-keys`, `copy-mode`) need `=name:`. `=name` alone fails with "no such session".
- **node-pty prebuilds ship `spawn-helper` without +x** → `posix_spawnp failed`. The `postinstall` script fixes it; re-run `npm install` if it shows up.
- **macOS `/tmp` is a symlink** to `/private/tmp`. Allowed dirs and requested cwds are both realpath'd before comparison.
- **Every tmux call runs with `tmuxEnv()`**. The process that starts the tmux server sets the global env for all future shells. Without the filter, `PORT=3001`, `.env` values and `CLAUDECODE`/`CLAUDE_CODE_*` (when omni-bot is launched from Claude Code) leak into every terminal.
- **launchd sets no locale.** Without UTF-8, tmux rewrites tabs in `-F` output to `_` and treats clients as non-UTF-8. `tmuxEnv()` defaults `LANG=en_US.UTF-8` and attach uses `tmux -u`. Tests run with the locale removed to catch regressions.
- **Unset `TMUX` before `tmux attach`** from node-pty, otherwise attach refuses to nest when omni-bot itself runs inside tmux.
- **Claude Code treats text+Enter arriving together as a paste.** The composer sends Enter ~80ms after the text. Multi-line text goes as a bracketed paste.
- **Cloudflare drops idle WebSockets (~100s)**. The server pings every 30s.
- **TLS-inspecting proxies (Netskope) break JWT validation** with `fetch failed` / `SELF_SIGNED_CERT_IN_CHAIN`: Node ignores the macOS keychain. The wake plist sets `NODE_USE_SYSTEM_CA=1` (Node >= 23.8), and omni-bot inherits it.
- **CF Access JWT on WS upgrades** comes in the `Cf-Access-Jwt-Assertion` header, with the `CF_Authorization` cookie as fallback. No separate WS token exchange.

## Local Claude sessions (`src/claude-sessions/`)

This module reads Claude Code internals that are not a public API and can change between versions:
- `~/.claude/sessions/<pid>.json`: registry of running sessions (`pid`, `sessionId`, `cwd`, `kind`). Entries can outlive their process, so check liveness and confirm the pid is still `claude` before sending a signal.
- `~/.claude/projects/<dir>/<id>.jsonl`: transcripts. Title comes from `custom-title` > `ai-title` > first prompt. `entrypoint: "sdk-cli"` marks headless runs (`claude -p`, hooks), which are filtered out.
- **File mtime is not activity.** Claude Code rewrites open transcripts while idle. Use the latest record `timestamp`.
- Transcripts reach tens of MB, so only the first and last 64 KB are read.
- A session gets a transcript only after its first message. Running sessions without one are hidden, because resume would fail after a take-over had already killed the original.
- "Outside tmux" means no tmux pane shell among the process's ancestors.
- Resume runs `command claude --resume <id>`. `command` skips the user's `claude` shell function (worktree wrapper), which would otherwise create a fresh worktree instead of resuming in place.

## Code Style

- TypeScript strict, explicit return types for exported functions, `unknown` over `any`
- Files `kebab-case.ts`; Conventional Commits
- `npm run lint && npm test` before committing. Tests live in `src/**/__tests__/`; tmux integration tests use a dedicated `-L` socket.
