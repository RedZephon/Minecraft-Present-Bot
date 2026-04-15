# Self-Hosting (Node.js)

Run MC Presence directly on your computer or server using Node.js. This is the simplest setup and works on Windows, macOS, and Linux.

## Prerequisites

- **Node.js 18 or newer** — [download here](https://nodejs.org/)
- **Git** — [download here](https://git-scm.com/)

Verify your install:
```bash
node --version   # should print v18.x or higher
npm --version
git --version
```

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/RedZephon/Minecraft-Present-Bot.git
cd Minecraft-Present-Bot
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create your environment file

```bash
cp .env.example .env
```

### 4. Edit `.env`

Open `.env` in a text editor and fill in your values:

```env
MC_HOST=play.yourserver.com
MC_PORT=25565
WEB_PORT=3100
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Only `MC_HOST` is required. Everything else has sensible defaults. See [Configuration](Configuration) for all options.

### 5. Start the app

```bash
npm start
```

You should see:
```
[MC-Presence] v2.0.0 — Web UI at http://0.0.0.0:3100
```

### 6. Open the dashboard

Navigate to **http://localhost:3100** in your browser.

## Running in the Background

### Linux / macOS (using screen)

```bash
screen -S mc-presence
npm start
# Press Ctrl+A then D to detach
# Reattach later with: screen -r mc-presence
```

### Linux (using systemd)

Create `/etc/systemd/system/mc-presence.service`:

```ini
[Unit]
Description=MC Presence Bot
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/Minecraft-Present-Bot
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Then enable and start:
```bash
sudo systemctl enable mc-presence
sudo systemctl start mc-presence
sudo systemctl status mc-presence
```

### Windows

Use [NSSM](https://nssm.cc/) to run as a Windows service, or simply keep a terminal window open.

### macOS (using launchd)

Create `~/Library/LaunchAgents/com.mcpresence.plist` for automatic startup on login.

## Updating

```bash
cd Minecraft-Present-Bot
git pull
npm install
# Restart the app
```

Your `data/bots.json` and `data/settings.json` are preserved across updates.

## Troubleshooting

### Port already in use
Change `WEB_PORT` in your `.env` file to a different port (e.g., `3101`).

### Microsoft auth fails
Delete the `.minecraft` folder and reconnect — you'll be prompted to sign in again.

### Can't connect to MC server
- Verify the server address and port are correct
- Make sure the server is online and allows the Minecraft version your account uses
- Check if the server has a whitelist — your account must be whitelisted
