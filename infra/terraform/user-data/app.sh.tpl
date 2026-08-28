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

mkdir -p /opt/homelink
chown ec2-user:ec2-user /opt/homelink

# --- .env renderer ------------------------------------------------------
# Pulls every SSM parameter under ${ssm_prefix}/app/ into /opt/homelink/.env,
# matching this repo's env_file: .env convention in docker-compose.yml.
# Run this after `git clone` and before `docker compose up -d` (see
# docs/INFRASTRUCTURE.md §9, step 5), and again whenever a secret rotates.
cat > /usr/local/bin/render-env.sh <<'SCRIPT'
#!/bin/bash
set -euo pipefail

REGION="${aws_region}"
PREFIX="${ssm_prefix}/app"
OUT="/opt/homelink/.env"

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
