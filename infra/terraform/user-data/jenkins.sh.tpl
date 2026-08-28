#!/bin/bash
set -euo pipefail

# --- Docker (arm64, Amazon Linux 2023) --------------------------------
dnf update -y
dnf install -y docker git
systemctl enable --now docker

# --- Jenkins (official yum repo, per jenkins.io's RedHat/Amazon Linux install docs) ---
curl -fsSL https://pkg.jenkins.io/redhat-stable/jenkins.repo -o /etc/yum.repos.d/jenkins.repo
rpm --import https://pkg.jenkins.io/redhat-stable/jenkins.io-2023.key
dnf install -y fontconfig java-21-amazon-corretto-headless jenkins

# Jenkins builds images directly on the host (no Docker-in-Docker) — the
# jenkins user just needs docker group membership.
usermod -aG docker jenkins
systemctl enable --now jenkins

# aws-cli v2 — the Jenkins pipeline calls `aws ssm send-command` using this
# box's own instance role, no stored AWS credentials needed. Ships in
# AL2023's repos as "awscli-2" (and is preinstalled on current AL2023 AMIs
# already — this is a no-op there, a safety net if not).
dnf install -y awscli-2

# --- Caddy (reverse proxy, TLS termination) -----------------------------
# AL2023 has no Caddy package; grab the static arm64 binary.
CADDY_VERSION="v2.8.4"
curl -fsSL "https://github.com/caddyserver/caddy/releases/download/$${CADDY_VERSION}/caddy_$${CADDY_VERSION#v}_linux_arm64.tar.gz" \
  -o /tmp/caddy.tar.gz
tar -xzf /tmp/caddy.tar.gz -C /usr/local/bin caddy
rm -f /tmp/caddy.tar.gz

cat > /etc/caddy-jenkins.Caddyfile <<'CADDYFILE'
:80 {
	redir https://{host}{uri} permanent
}

:443 {
	tls internal
	reverse_proxy localhost:8080
}
CADDYFILE

cat > /etc/systemd/system/caddy-jenkins.service <<'UNIT'
[Unit]
Description=Caddy reverse proxy for Jenkins
After=network.target

[Service]
ExecStart=/usr/local/bin/caddy run --config /etc/caddy-jenkins.Caddyfile
Restart=on-failure
User=root

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now caddy-jenkins

# --- Deploy target reference for the Jenkinsfile ------------------------
# Known at `terraform apply` time, so bake it in here instead of asking
# whoever configures the Jenkins job to look up instance IDs by hand.
mkdir -p /etc/homelink
cat > /etc/homelink/deploy.env <<ENV
AWS_REGION=${aws_region}
APP_INSTANCE_ID=${app_instance_id}
FRONTEND_INSTANCE_ID=${frontend_instance_id}
ENV
chmod 644 /etc/homelink/deploy.env

echo "Jenkins initial admin password: /var/lib/jenkins/secrets/initialAdminPassword (via SSM Session Manager)"
