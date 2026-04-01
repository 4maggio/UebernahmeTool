#!/usr/bin/env bash
set -euo pipefail

VPS_PATH="${1:-/srv/uebernahme}"

echo "==> Pulling latest code"
cd "$VPS_PATH"
git fetch origin main
git reset --hard origin/main

echo "==> Installing backend dependencies"
cd "$VPS_PATH/backend"
npm install --omit=dev

echo "==> Running database migrations"
node src/db/migrate.js

echo "==> Importing Knowledge Base YAML files"
node src/db/seeds/importKnowledge.js

echo "==> Reloading nginx config (zero-downtime)"
sudo docker exec traefik-uebernahme-1 nginx -s reload

echo "==> Restarting application with PM2"
cd "$VPS_PATH"
if pm2 describe uebernahme-api > /dev/null 2>&1; then
  pm2 reload ecosystem.config.js --update-env
else
  pm2 start ecosystem.config.js --env production
fi

echo "==> Saving PM2 process list"
pm2 save

echo "==> Deploy complete!"
