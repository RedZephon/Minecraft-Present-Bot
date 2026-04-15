# Docker Deployment

Run MC Presence in a Docker container. This is the recommended method for always-on setups like Unraid, Synology, or any Docker host.

## Quick Start

```bash
docker run -d \
  --name mc-presence \
  --restart unless-stopped \
  -p 3100:3100 \
  -v mc-presence-data:/app/data \
  -v mc-presence-auth:/app/.minecraft \
  -e MC_HOST=play.yourserver.com \
  -e MC_PORT=25565 \
  ghcr.io/redzephon/minecraft-present-bot:latest
```

Open **http://your-docker-host:3100** in your browser.

## Docker Compose

Create a `docker-compose.yml`:

```yaml
services:
  mc-presence:
    image: ghcr.io/redzephon/minecraft-present-bot:latest
    container_name: mc-presence
    restart: unless-stopped
    ports:
      - "3100:3100"
    volumes:
      - ./data:/app/data
      - ./mc-auth:/app/.minecraft
    environment:
      - MC_HOST=play.yourserver.com
      - MC_PORT=25565
      - WEB_PORT=3100
      - ANTHROPIC_API_KEY=sk-ant-your-key-here
      # Optional:
      # - BRIDGE_URL=http://your-mc-server:3101
      # - BRIDGE_SECRET=changeme
      # - DISCORD_WEBHOOK=https://discord.com/api/webhooks/...
      # - OWNER_USERNAME=YourMCName
```

Then run:
```bash
docker compose up -d
```

## Building from Source

If you prefer to build the image yourself:

```bash
git clone https://github.com/RedZephon/Minecraft-Present-Bot.git
cd Minecraft-Present-Bot
docker build -t mc-presence .
docker run -d --name mc-presence \
  --restart unless-stopped \
  -p 3100:3100 \
  -v ./data:/app/data \
  -v ./mc-auth:/app/.minecraft \
  -e MC_HOST=play.yourserver.com \
  mc-presence
```

## Volumes

| Volume | Purpose |
|--------|---------|
| `/app/data` | Bot configs (`bots.json`) and settings (`settings.json`). **Mount this to persist across container restarts.** |
| `/app/.minecraft` | Microsoft auth tokens. Mount this so you don't have to re-authenticate every time the container restarts. |

## Environment Variables

All configuration is done via environment variables. See [Configuration](Configuration) for the full list.

The most important ones:

| Variable | Required | Description |
|----------|----------|-------------|
| `MC_HOST` | Yes | Your Minecraft server address |
| `MC_PORT` | No | Server port (default: `25565`) |
| `WEB_PORT` | No | Dashboard port (default: `3100`) |
| `ANTHROPIC_API_KEY` | For AI | Anthropic API key for AI chat modes |

## Unraid

1. Go to **Docker > Add Container**
2. Set the **Repository** to the image URL
3. Add port mapping: Container `3100` → Host `3100`
4. Add path mappings:
   - `/app/data` → `/mnt/user/appdata/mc-presence/data`
   - `/app/.minecraft` → `/mnt/user/appdata/mc-presence/mc-auth`
5. Add environment variables for `MC_HOST` and any others you need
6. Click **Apply**

## Synology (Container Manager)

1. Download the image from the registry
2. Create a container with:
   - Port: local `3100` → container `3100`
   - Volumes: map a local folder to `/app/data` and `/app/.minecraft`
   - Environment: set `MC_HOST`, `MC_PORT`, etc.
3. Start the container

## Updating

```bash
# Docker run
docker pull ghcr.io/redzephon/minecraft-present-bot:latest
docker stop mc-presence && docker rm mc-presence
# Re-run your docker run command

# Docker Compose
docker compose pull
docker compose up -d
```

Your data and auth tokens persist in the mounted volumes.

## Logs

```bash
docker logs mc-presence
docker logs -f mc-presence  # follow live
```

## Troubleshooting

### Container exits immediately
Check logs with `docker logs mc-presence`. Common causes:
- Missing required environment variables
- Port conflict (change `WEB_PORT`)

### Can't reach the dashboard
- Verify the port mapping: `docker port mc-presence`
- Check your firewall allows traffic on port 3100

### Auth tokens lost on restart
Make sure you're mounting `/app/.minecraft` as a volume. Without this, tokens are lost when the container restarts.
