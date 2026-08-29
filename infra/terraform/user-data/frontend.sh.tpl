#!/bin/bash
set -euo pipefail

# --- Docker + Compose plugin (arm64, Amazon Linux 2023) ---------------------
dnf update -y
dnf install -y docker git
systemctl enable --now docker
usermod -aG docker ec2-user

COMPOSE_VERSION="v2.29.7"
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/$${COMPOSE_VERSION}/docker-compose-linux-aarch64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# aws-cli v2 ships in AL2023's repos as "awscli-2" (and is preinstalled on
# current AL2023 AMIs already — this is a no-op there, a safety net if not).
dnf install -y awscli-2

mkdir -p /opt/homelink-frontend
chown ec2-user:ec2-user /opt/homelink-frontend

# --- .env renderer ------------------------------------------------------
# Pulls every SSM parameter under ${ssm_prefix}/frontend/ into
# /opt/homelink-frontend/.env. Run after `git clone` and before
# `docker compose up -d` for the frontend's own compose/Dockerfile.
cat > /usr/local/bin/render-env.sh <<'SCRIPT'
#!/bin/bash
set -euo pipefail

REGION="${aws_region}"
PREFIX="${ssm_prefix}/frontend"
OUT="/opt/homelink-frontend/.env"

aws ssm get-parameters-by-path \
  --region "$REGION" \
  --path "$PREFIX" \
  --with-decryption \
  --recursive \
  --query 'Parameters[].[Name,Value]' \
  --output text \
| while IFS=$'\t' read -r name value; do
    key=$(basename "$name" | tr '[:lower:]' '[:upper:]')
    printf '%s=%s\n' "$key" "$value"
  done > "$OUT"

chmod 600 "$OUT"
echo "Wrote $(wc -l < "$OUT") vars to $OUT"

# Log in to GHCR fresh on every render-env.sh run (called right before each
# deploy), in case the token was rotated. Skipped entirely if GHCR_TOKEN is
# empty — i.e. the packages are public and no auth is needed to pull.
GHCR_TOKEN=$(grep '^GHCR_TOKEN=' "$OUT" | cut -d= -f2-)
GHCR_USERNAME=$(grep '^GHCR_USERNAME=' "$OUT" | cut -d= -f2-)
if [ -n "$GHCR_TOKEN" ] && [ "$GHCR_TOKEN" != "unset" ]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
fi
SCRIPT
chmod +x /usr/local/bin/render-env.sh

# --- Monitoring agents (scraped by Prometheus on the Jenkins box) -------
# See app.sh.tpl's identical section for why this is a separate compose
# project and why host networking is used. No Postgres/Redis here, so no
# postgres_exporter/redis_exporter on this box.
mkdir -p /opt/monitoring-agents
cat > /opt/monitoring-agents/docker-compose.yml <<'EOF'
services:
  node-exporter:
    image: prom/node-exporter:latest
    container_name: node-exporter
    restart: unless-stopped
    network_mode: host
    pid: host
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.sysfs=/host/sys'
      - '--path.rootfs=/rootfs'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)'

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:latest
    container_name: cadvisor
    restart: unless-stopped
    network_mode: host
    privileged: true
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
      - /dev/disk/:/dev/disk:ro
EOF

docker compose -f /opt/monitoring-agents/docker-compose.yml up -d
