# Omni-Bot

Mobile-friendly web terminal for the tmux sessions running Claude Code on your Mac, reachable through a Cloudflare Tunnel (or Tailscale).

Sessions are plain tmux sessions running the real `claude` CLI. Start one from the phone and `tmux attach` to it from the desktop (or the other way around). Omni-Bot keeps no state of its own and can restart without killing anything.

```
iPhone ─▶ CF Access ─▶ cloudflared ─▶ wake server :3000 ──proxy──▶ omni-bot :3001 ─▶ node-pty ─▶ tmux attach
                                     (always on, launchd)        (start/stop remotely)
```

## Features

- Session list showing cwd, running command, last activity and attached clients
- New session: pick a directory, start with `claude`, `claude --continue`, `claude --resume` or a plain shell
- xterm.js terminal with a key bar for keys the iOS keyboard lacks: Esc, sticky Ctrl, ^C, Tab, ⇧Tab, arrows, PgUp/PgDn (tmux scrollback), Live
- Resume Claude sessions started in local terminals: running ones by forking or taking over the original process, closed ones directly
- Composer box for dictation and multi-line messages (sent as a bracketed paste)
- Auto-reconnect when iOS suspends the tab
- Wake server: an always-on process (launchd) that starts, stops and rebuilds omni-bot remotely at `/wake`
- Push notifications through a Claude Code hook and ntfy (`scripts/notify.sh`)

## Requirements

- macOS, Node >= 22, `tmux` (`brew install tmux`), Claude Code CLI
- `cloudflared` tunnel + a Cloudflare Access application, or Tailscale

## Setup

```bash
npm install          # postinstall fixes node-pty's spawn-helper permissions
cp .env.example .env # set ALLOWED_DIRECTORIES, AUTH_MODE, CF_ACCESS_*
npm run build
make wake-start      # or install the launchd agents in support/
```

Open `/` for sessions, `/wake` for server controls. On iOS, add the page to the Home Screen so it opens full-screen.

### launchd agents (`support/`)

| Agent | Purpose |
|---|---|
| `com.omni-bot.wake` | Wake server. Always on, proxies to omni-bot and starts it on demand |
| `com.omni-bot.tunnel` | `cloudflared tunnel run omni-bot` |
| `com.omni-bot.caffeinate` | Keeps the Mac awake |

### Notifications

1. Install the ntfy app on the phone and subscribe to a hard-to-guess topic.
2. Add the hook to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Notification": [{ "hooks": [{ "type": "command", "command": "/path/to/omni-bot/scripts/notify.sh" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "/path/to/omni-bot/scripts/notify.sh" }] }]
  }
}
```

3. Export `NTFY_TOPIC` and `OMNI_BOT_URL` in the shell profile. Tapping the notification opens that session.

## Notes

- **Screen size with several clients:** tmux sizes the window to the most recently active client. Typing on the phone shrinks the desktop view until you type on the desktop again.
- **Security:** the terminal is a full shell. In `cloudflare` mode every HTTP request and WebSocket upgrade validates the CF Access JWT. Never expose omni-bot or the wake server without Access in front.

## Development

```bash
npm run dev       # omni-bot only, hot reload
make wake         # wake server, hot reload
npm test
npm run lint
```
