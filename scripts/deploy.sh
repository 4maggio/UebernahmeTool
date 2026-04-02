#!/usr/bin/env bash
set -euo pipefail

VPS_PATH="${1:-/srv/uebernahme}"

echo "==> Fixing permissions for deployer-uebernahme user"
sudo chown -R deployer-uebernahme:deployer-uebernahme "$VPS_PATH"
sudo find "$VPS_PATH" -type f -exec chmod u+rw {} \;
sudo find "$VPS_PATH" -type d -exec chmod u+rwx {} \;

echo "==> Pulling latest code"
cd "$VPS_PATH"
git fetch origin main
git reset --hard origin/main

echo "==> Installing backend dependencies"
cd "$VPS_PATH/backend"
npm install --omit=dev

echo "==> Running database migrations"
node src/db/migrate.js

echo "==> Checking for Knowledge Base changes..."
if git diff HEAD~1 HEAD --name-only | grep -q '^backend/knowledge/'; then
  echo "==> Importing Knowledge Base YAML files (changes detected)"
  node src/db/seeds/importKnowledge.js
else
  echo "==> Skipping Knowledge Base import (no YAML changes)"
fi

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
