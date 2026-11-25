#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 22.04/24.04 VM (e.g. Oracle Cloud Always Free Ampere A1).
# Run as a sudo-capable user after copying the project to /opt/dealdesk. Opens NO inbound ports:
# traffic arrives only through the outbound Cloudflare Tunnel.
set -euo pipefail
sudo apt-get update && sudo apt-get install -y ca-certificates curl gnupg build-essential python3 age
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
sudo useradd --system --home /opt/dealdesk --shell /usr/sbin/nologin dealdesk 2>/dev/null || true
sudo mkdir -p /opt/dealdesk/{data,logs,backups} && sudo chown -R dealdesk:dealdesk /opt/dealdesk && sudo chmod 700 /opt/dealdesk/data /opt/dealdesk/backups
cd /opt/dealdesk && sudo -u dealdesk npm ci --omit=dev && sudo -u dealdesk node scripts/setup.js "${ADMIN_EMAIL:-admin@dealdesk.local}"
sudo sed -i 's/^COOKIE_SECURE=0/COOKIE_SECURE=1/; s/^TRUST_PROXY=0/TRUST_PROXY=1/; s/^SEED_DEMO=1/SEED_DEMO=0/' /opt/dealdesk/.env
sudo cp deploy/systemd/dealdesk*.service deploy/systemd/dealdesk-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now dealdesk dealdesk-backup.timer
# Cloudflare Tunnel (needs Cory's Cloudflare login in a browser): see deploy/cloudflare-tunnel/
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
echo "Done. Admin login is in /opt/dealdesk/secrets/admin-login.txt. Next: cloudflared tunnel login (see deploy/cloudflare-tunnel/)."
