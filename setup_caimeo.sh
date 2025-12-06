#!/usr/bin/env bash
# Place this file at /boot/setup_caimeo.sh on the Pi, make it executable (chmod +x),
# and it will configure the Caimeo stack on first boot when called by a one-shot service.

set -euo pipefail

echo "==== Caimeo Setup Started ===="

# --- EDIT THESE IF NEEDED ---
REPO_URL="https://github.com/caspercaimeo-alt/CaimeoV1.git"
APP_DIR="/home/pi/ALPACAAPI"
PY_VENV="$APP_DIR/.venv"
DOMAIN_MAIN="CasperCaimeo.com"
# ----------------------------

# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies (Python backend + React build + reverse proxy + firewall)
sudo apt install -y python3-venv python3-pip git caddy nodejs npm ufw

# Clone or update repo
if [ ! -d "$APP_DIR" ]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  (cd "$APP_DIR" && git pull --rebase)
fi

# Backend venv + deps
cd "$APP_DIR"
python3 -m venv "$PY_VENV"
source "$PY_VENV/bin/activate"
pip install --upgrade pip
pip install -r requirements.txt

# Frontend build
cd "$APP_DIR/alpaca-ui"
npm install
npm run build

# Systemd service for backend (gunicorn)
sudo tee /etc/systemd/system/alpaca-api.service >/dev/null <<'EOF'
[Unit]
Description=Alpaca API backend
After=network.target

[Service]
WorkingDirectory=/home/pi/ALPACAAPI
EnvironmentFile=/home/pi/ALPACAAPI/.env
ExecStart=/home/pi/ALPACAAPI/.venv/bin/gunicorn -w 2 -b 127.0.0.1:5000 server:app
Restart=always
User=pi
Group=pi

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now alpaca-api

# Caddy config for domain + static frontend + API proxy
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
${DOMAIN_MAIN} {
  root * ${APP_DIR}/alpaca-ui/build
  file_server
  @api path /api/* /account* /positions* /orders* /history*
  reverse_proxy @api 127.0.0.1:5000
  encode zstd gzip
}
EOF

sudo systemctl reload caddy

# Firewall (optional but recommended)
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw --force enable

echo "==== Caimeo Setup Complete ===="
echo "Create /home/pi/ALPACAAPI/.env with your Alpaca keys, then run:"
echo "  sudo systemctl restart alpaca-api && sudo systemctl reload caddy"
