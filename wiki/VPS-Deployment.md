# VPS Deployment

Deploy MC Presence to a cloud VPS running Ubuntu or Debian. This works with any provider: DigitalOcean, Hetzner, Linode, AWS EC2, Vultr, etc.

## Requirements

- A VPS with at least **512 MB RAM** and **1 CPU**
- **Ubuntu 22.04+** or **Debian 12+** (other Linux distros work too — adapt package commands)
- SSH access
- A domain name (optional, for HTTPS)

## Option A: Docker on VPS (Recommended)

The simplest approach — install Docker and follow the [Docker Deployment](Docker-Deployment) guide.

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in, then follow the Docker guide
```

## Option B: Node.js on VPS

### 1. Install Node.js

```bash
# Using NodeSource (recommended)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version
npm --version
```

### 2. Create a user (optional but recommended)

```bash
sudo useradd -m -s /bin/bash mcpresence
sudo su - mcpresence
```

### 3. Clone and install

```bash
git clone https://github.com/RedZephon/Minecraft-Present-Bot.git
cd Minecraft-Present-Bot
npm install
cp .env.example .env
```

### 4. Configure

Edit `.env` with your settings:
```bash
nano .env
```

Set at minimum:
```env
MC_HOST=play.yourserver.com
MC_PORT=25565
WEB_PORT=3100
```

### 5. Set up as a systemd service

Create the service file:
```bash
sudo nano /etc/systemd/system/mc-presence.service
```

Paste:
```ini
[Unit]
Description=MC Presence Bot
After=network.target

[Service]
Type=simple
User=mcpresence
WorkingDirectory=/home/mcpresence/Minecraft-Present-Bot
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable mc-presence
sudo systemctl start mc-presence
```

Check status:
```bash
sudo systemctl status mc-presence
sudo journalctl -u mc-presence -f  # live logs
```

### 6. Open firewall

```bash
sudo ufw allow 3100/tcp
```

Access the dashboard at `http://your-vps-ip:3100`.

## Setting Up HTTPS with Nginx (Optional)

If you want to access the dashboard over HTTPS with a domain name:

### 1. Install Nginx and Certbot

```bash
sudo apt install nginx certbot python3-certbot-nginx
```

### 2. Create Nginx config

```bash
sudo nano /etc/nginx/sites-available/mc-presence
```

Paste:
```nginx
server {
    server_name mc.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

The `Upgrade` and `Connection` headers are important — they enable WebSocket connections for Socket.io.

### 3. Enable and get SSL

```bash
sudo ln -s /etc/nginx/sites-available/mc-presence /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d mc.yourdomain.com
```

Your dashboard is now at `https://mc.yourdomain.com`.

## Updating on VPS

```bash
cd Minecraft-Present-Bot
git pull
npm install
sudo systemctl restart mc-presence
```

## Security Notes

- The dashboard has **no built-in authentication**. If your VPS is public, use Nginx with basic auth or a VPN to restrict access.
- Never expose port 3100 directly on a public VPS without some form of access control.
- Your Anthropic API key and Microsoft tokens are stored on the server — treat the VPS as a sensitive system.

### Adding basic auth with Nginx

```bash
sudo apt install apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd yourusername
```

Add to your Nginx config inside the `location` block:
```nginx
auth_basic "MC Presence";
auth_basic_user_file /etc/nginx/.htpasswd;
```

Then `sudo systemctl reload nginx`.
