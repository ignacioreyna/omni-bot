# Installation Guide

This guide walks through installing and configuring Omni-Bot for production use.

## Prerequisites

### Required Software

1. **Node.js >= 22.0.0**
   ```bash
   node --version  # Should be 22.0.0 or higher
   ```
   Install from [nodejs.org](https://nodejs.org/) or use a version manager like `nvm`.

2. **Claude Code CLI**

   Omni-Bot requires the Claude Code CLI to be installed and authenticated on the host machine.

   ```bash
   # Check if claude is installed
   claude --version

   # If not installed, follow instructions at:
   # https://claude.ai/downloads
   ```

   **Important**: You must have a Claude Max Plan and authenticate the CLI before running Omni-Bot.

3. **Git** (for cloning the repository)
   ```bash
   git --version
   ```

### Network Access

Choose one of the following:

- **Option A: Tailscale** (Recommended for personal use)
  - Install Tailscale: https://tailscale.com/download
  - Join your Tailnet

- **Option B: Cloudflare Tunnel** (For team/public access)
  - Install cloudflared: `brew install cloudflared` (macOS) or https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
  - Cloudflare account with Zero Trust enabled

## Installation Steps

### 1. Clone the Repository

```bash
git clone <repository-url>
cd omni-bot
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required dependencies including:
- Express (web server)
- better-sqlite3 (database)
- @anthropic-ai/claude-agent-sdk (Claude integration)
- ws (WebSocket)
- And more...

### 3. Configure Environment

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

#### Basic Configuration

```env
# Server port
PORT=3000

# Comma-separated list of directories where Claude can create sessions
ALLOWED_DIRECTORIES=/path/to/projects,/Users/you/code

# Optional: Additional directories that can be read (but not used as working dirs)
READABLE_DIRECTORIES=/etc,/usr/local

# Database location
DATABASE_PATH=./data/omni-bot.db

# Maximum concurrent Claude sessions
MAX_CONCURRENT_SESSIONS=5

# Session secret for token signing (auto-generated if not set)
SESSION_SECRET=your-random-secret-here
```

**Important**:
- `ALLOWED_DIRECTORIES` must include all paths where you want to create Claude sessions
- Paths can use `~` for home directory or environment variables like `$HOME`
- Use absolute paths for clarity

#### Permission Settings

```env
# Enable interactive permission approval UI
INTERACTIVE_PERMISSIONS=true
```

When `true`, dangerous operations (Bash, Write, Edit) require user approval via the web UI. When `false`, operations are auto-approved (less secure but more convenient).

### 4. Choose Authentication Mode

#### Option A: Tailscale Mode (Default)

No additional configuration needed. Set:

```env
AUTH_MODE=tailscale
```

This mode assumes you're accessing Omni-Bot through Tailscale VPN and doesn't require authentication at the app level.

**Setup Tailscale:**
1. Install Tailscale on your server and client devices
2. Connect both to the same Tailnet
3. Access Omni-Bot via Tailscale IP: `http://100.x.x.x:3000`

#### Option B: Cloudflare Access Mode

For public access with authentication:

```env
AUTH_MODE=cloudflare
CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com
CF_ACCESS_AUD=your-application-audience-tag
```

**Setup Cloudflare Tunnel:**

1. **Install cloudflared:**
   ```bash
   # macOS
   brew install cloudflared

   # Linux
   wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
   sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared
   sudo chmod +x /usr/local/bin/cloudflared
   ```

2. **Authenticate cloudflared:**
   ```bash
   cloudflared tunnel login
   ```
   This opens a browser to authorize cloudflared with your Cloudflare account.

3. **Create a tunnel:**
   ```bash
   cloudflared tunnel create omni-bot
   ```
   This creates a tunnel and saves credentials to `~/.cloudflared/`.

4. **Configure the tunnel:**
   Create `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: <tunnel-id-from-previous-step>
   credentials-file: /Users/you/.cloudflared/<tunnel-id>.json

   ingress:
     - hostname: omni-bot.yourdomain.com
       service: http://localhost:3000
     - service: http_status:404
   ```

5. **Create DNS record:**
   ```bash
   cloudflared tunnel route dns omni-bot omni-bot.yourdomain.com
   ```

6. **Configure Cloudflare Access:**

   Go to Cloudflare Zero Trust dashboard:
   - Navigate to Access > Applications
   - Click "Add an Application" > "Self-hosted"
   - Set Application domain: `omni-bot.yourdomain.com`
   - Configure authentication (Google, GitHub, email OTP, etc.)
   - Create an Access Policy (e.g., allow specific emails)
   - Copy the **Application Audience (AUD)** tag from the application settings

7. **Update .env:**
   ```env
   AUTH_MODE=cloudflare
   CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com
   CF_ACCESS_AUD=<aud-tag-from-step-6>
   ```

8. **Start the tunnel:**
   ```bash
   cloudflared tunnel run omni-bot
   ```

   Or install as a service:
   ```bash
   sudo cloudflared service install
   ```

### 5. Initialize Database

The database will be automatically created on first run, but you can verify:

```bash
npm run build
node dist/index.js
```

Check that `./data/omni-bot.db` is created (or the path specified in `DATABASE_PATH`).

Press Ctrl+C to stop.

## Running Omni-Bot

### Development Mode

For development with auto-reload:

```bash
npm run dev
```

This uses `tsx watch` to automatically restart on code changes.

### Production Mode

Build and run:

```bash
npm run build
npm start
```

Or use a process manager like PM2:

```bash
npm install -g pm2
pm2 start dist/index.js --name omni-bot
pm2 save
pm2 startup  # Follow instructions to enable auto-start on boot
```

### Using Docker (Optional)

Create a `Dockerfile`:

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

Build and run:

```bash
docker build -t omni-bot .
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v ~/.claude:/root/.claude \
  --env-file .env \
  --name omni-bot \
  omni-bot
```

**Important**: Mount `~/.claude` to provide access to Claude Code authentication.

## Verification

### 1. Check Server Status

Access the web UI:
- Tailscale: `http://<tailscale-ip>:3000`
- Cloudflare: `https://omni-bot.yourdomain.com`

You should see the Omni-Bot interface.

### 2. Test Session Creation

1. Click "New Session"
2. Select a working directory (must be in `ALLOWED_DIRECTORIES`)
3. Send a test message: "Hello, Claude!"
4. Verify you get a response

### 3. Test Permissions (if enabled)

With `INTERACTIVE_PERMISSIONS=true`:

1. Send a message that requires file access: "Create a file called test.txt with 'hello world'"
2. Verify you receive a permission prompt
3. Approve or deny the request

### 4. Check Database

```bash
sqlite3 ./data/omni-bot.db "SELECT * FROM sessions;"
```

You should see your test session.

## Troubleshooting

### Claude CLI Not Found

**Error:** `claude: command not found`

**Solution:**
- Ensure Claude Code CLI is installed
- Check PATH includes Claude binary location
- If using Docker, make sure Claude is installed in the container

### Permission Denied on Directory

**Error:** `Directory not in ALLOWED_DIRECTORIES`

**Solution:**
- Add the directory to `ALLOWED_DIRECTORIES` in `.env`
- Ensure paths are absolute and properly expanded
- Restart the server after changing `.env`

### Database Locked

**Error:** `SQLITE_BUSY: database is locked`

**Solution:**
- Ensure only one Omni-Bot instance is running
- Check for zombie processes: `ps aux | grep node`
- Enable WAL mode (done automatically on startup)

### Cloudflare Authentication Fails

**Error:** `Invalid JWT token`

**Solution:**
- Verify `CF_ACCESS_TEAM_DOMAIN` matches your team domain exactly
- Verify `CF_ACCESS_AUD` matches the Application Audience tag
- Ensure Cloudflare Access is properly configured
- Check the JWT token in browser DevTools > Network > Headers

### WebSocket Connection Failed

**Error:** WebSocket connection errors in browser console

**Solution:**
- Check firewall allows port 3000 (or your configured PORT)
- If behind a reverse proxy, ensure WebSocket upgrade headers are passed
- For Cloudflare Tunnel, ensure `cloudflared` is running

### Out of Memory

**Error:** Process crashes or becomes unresponsive

**Solution:**
- Reduce `MAX_CONCURRENT_SESSIONS`
- Increase Node.js memory limit: `NODE_OPTIONS="--max-old-space-size=4096" npm start`
- Monitor with: `pm2 monit`

## Security Recommendations

1. **Use HTTPS**: Always use Cloudflare Tunnel or reverse proxy with SSL
2. **Restrict Directories**: Only include necessary directories in `ALLOWED_DIRECTORIES`
3. **Enable Permissions**: Set `INTERACTIVE_PERMISSIONS=true` for review
4. **Rotate Secrets**: Change `SESSION_SECRET` periodically
5. **Limit Sessions**: Set reasonable `MAX_CONCURRENT_SESSIONS` to prevent resource exhaustion
6. **Monitor Logs**: Check logs regularly for suspicious activity
7. **Update Dependencies**: Run `npm audit` and update packages regularly

## Updating

To update Omni-Bot:

```bash
git pull origin main
npm install
npm run build
pm2 restart omni-bot  # or however you're running it
```

Always review the changelog for breaking changes before updating.

## Backup

Backup your database regularly:

```bash
# Simple backup
cp ./data/omni-bot.db ./data/omni-bot.db.backup

# Scheduled backup (cron)
0 2 * * * cp /path/to/omni-bot/data/omni-bot.db /path/to/backups/omni-bot-$(date +\%Y\%m\%d).db
```

## Next Steps

- Read the [Usage Guide](USAGE.md) to learn how to use Omni-Bot
- Review the [API Reference](API.md) for programmatic access
- Check out [Development Guide](DEVELOPMENT.md) if you want to contribute
