.PHONY: dev start stop restart kill logs tunnel clean help wake wake-start wake-kill wake-logs

# Default target
help:
	@echo "Omni-Bot Commands:"
	@echo ""
	@echo "  make dev         - Start dev server (with hot reload)"
	@echo "  make start       - Start production server"
	@echo "  make stop        - Stop the server gracefully"
	@echo "  make kill        - Force kill server on port 3000 and 3001"
	@echo "  make restart     - Kill and restart dev server"
	@echo "  make logs        - Tail the log file"
	@echo "  make tunnel      - Start cloudflared tunnel"
	@echo "  make clean       - Remove build artifacts and logs"
	@echo ""
	@echo "  make wake        - Start wake server (dev mode)"
	@echo "  make wake-start  - Start wake server (production)"
	@echo "  make wake-kill   - Force kill wake server and omni-bot"
	@echo "  make wake-logs   - Tail omni-bot logs from wake server"
	@echo ""

# Start dev server with hot reload
dev:
	npm run dev

# Start production server
start:
	npm start

# Stop server gracefully (if running in foreground, use Ctrl+C)
stop:
	@echo "Use Ctrl+C to stop foreground server, or 'make kill' for background"
# Force kill any process on port 3000 and 3001
kill:
	@lsof -ti:3000 | xargs kill -9 2>/dev/null && echo "Killed process on port 3000" || echo "No process on port 3000"
	@lsof -ti:3001 | xargs kill -9 2>/dev/null && echo "Killed process on port 3001" || echo "No process on port 3001"
  @pkill -9 -f "caffeinate -di" 2>/dev/null && echo "Killed caffeinate" || true

# Kill and restart
restart: kill
	@sleep 1
	npm run dev

# Tail log file
logs:
	@tail -f /tmp/omni-bot.log 2>/dev/null || echo "Log file not found. Start the server first."

# Start cloudflared tunnel (run in separate terminal)
tunnel:
	cloudflared tunnel run omni-bot

# Clean build artifacts
clean:
	rm -rf dist/
	rm -f /tmp/omni-bot.log

# Build TypeScript
build:
	npm run build

# Type check without emitting
typecheck:
	npx tsc --noEmit

# Wake server (dev mode with hot reload)
wake:
	npm run wake:dev

# Wake server (production)
wake-start:
	npm run wake:start

# Force kill wake server and omni-bot
wake-kill:
	@lsof -ti:3000 | xargs kill -9 2>/dev/null && echo "Killed process on port 3000" || echo "No process on port 3000"
	@lsof -ti:3001 | xargs kill -9 2>/dev/null && echo "Killed process on port 3001" || echo "No process on port 3001"

# Tail omni-bot logs (managed by wake server)
wake-logs:
	@tail -f /tmp/omni-bot.log 2>/dev/null || echo "Log file not found."
