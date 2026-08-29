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

# --- Docker Compose plugin (for the monitoring stack below) -------------
COMPOSE_VERSION="v2.29.7"
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/$${COMPOSE_VERSION}/docker-compose-linux-aarch64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

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

%{ if jenkins_public_hostname != "" }
# jenkins_admin_cidr_blocks is set, so this box is reachable from the
# internet (needed for a GitHub webhook, or direct UI access) — get a real
# Let's Encrypt cert for it instead of a self-signed one.
${jenkins_public_hostname} {
	reverse_proxy localhost:8080
}

${grafana_public_hostname} {
	reverse_proxy localhost:3000
}
%{ else }
:443 {
	tls internal
	reverse_proxy localhost:8080
}
%{ endif }
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

# =========================================================================
# Monitoring: Prometheus + Grafana + Alertmanager, all on this box.
# Scrapes node_exporter/cAdvisor/postgres_exporter/redis_exporter on the
# app/frontend boxes over their PRIVATE IPs (never the public internet —
# see network.tf's jenkins-security-group-sourced ingress rules there),
# plus this box's own node_exporter/cAdvisor, plus blackbox_exporter
# probing all three services' public HTTPS endpoints.
# =========================================================================
mkdir -p /opt/monitoring/prometheus /opt/monitoring/alertmanager /opt/monitoring/blackbox \
  /opt/monitoring/grafana-provisioning/datasources /opt/monitoring/grafana-provisioning/dashboards/json

# --- Prometheus: scrape targets + alerting rules ------------------------
cat > /opt/monitoring/prometheus/prometheus.yml <<'EOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']

rule_files:
  - /etc/prometheus/rules.yml

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ['localhost:9090']

  - job_name: jenkins-node
    static_configs:
      - targets: ['host.docker.internal:9100']
        labels: { node: 'jenkins' }

  - job_name: jenkins-cadvisor
    static_configs:
      - targets: ['host.docker.internal:8081']
        labels: { node: 'jenkins' }

  - job_name: app-node
    static_configs:
      - targets: ['${app_private_ip}:9100']
        labels: { node: 'app' }

  - job_name: app-cadvisor
    static_configs:
      - targets: ['${app_private_ip}:8080']
        labels: { node: 'app' }

  - job_name: app-postgres
    static_configs:
      - targets: ['${app_private_ip}:9187']
        labels: { node: 'app' }

  - job_name: app-redis
    static_configs:
      - targets: ['${app_private_ip}:9121']
        labels: { node: 'app' }

  - job_name: frontend-node
    static_configs:
      - targets: ['${frontend_private_ip}:9100']
        labels: { node: 'frontend' }

  - job_name: frontend-cadvisor
    static_configs:
      - targets: ['${frontend_private_ip}:8080']
        labels: { node: 'frontend' }

  - job_name: blackbox-http
    metrics_path: /probe
    params:
      module: [http_2xx]
    static_configs:
      - targets:
          - https://${app_public_hostname}/api/v1/health
          - https://${frontend_public_hostname}/
          - http://host.docker.internal:8080/login
        labels: { node: 'external' }
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox-exporter:9115
EOF

# Classic Prometheus alerting rules (evaluated by Prometheus itself, fired
# to Alertmanager above — not Grafana's newer built-in alerting, which has
# a much more involved provisioning schema for no real benefit here).
cat > /opt/monitoring/prometheus/rules.yml <<'EOF'
groups:
  - name: homelink
    rules:
      - alert: InstanceDown
        expr: up == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "{{ $labels.job }} on {{ $labels.node }} is down"
          description: "Prometheus has failed to scrape {{ $labels.job }} for 2+ minutes."

      - alert: HighCPUUsage
        expr: 100 - (avg by (node) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High CPU usage on {{ $labels.node }}"
          description: "CPU usage has been above 85% for 5+ minutes on {{ $labels.node }}."

      - alert: HighMemoryUsage
        expr: (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100 > 90
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage on {{ $labels.node }}"
          description: "Memory usage has been above 90% for 5+ minutes on {{ $labels.node }}."

      - alert: LowDiskSpace
        expr: (1 - (node_filesystem_avail_bytes{mountpoint="/",fstype!="tmpfs"} / node_filesystem_size_bytes{mountpoint="/",fstype!="tmpfs"})) * 100 > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Low disk space on {{ $labels.node }}"
          description: "Root filesystem is more than 85% full on {{ $labels.node }}."

      - alert: EndpointDown
        expr: probe_success == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Public endpoint {{ $labels.instance }} is failing its health probe"
          description: "blackbox_exporter has been unable to reach {{ $labels.instance }} for 2+ minutes."

      - alert: PostgresDown
        expr: pg_up == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Postgres is unreachable on {{ $labels.node }}"

      - alert: RedisDown
        expr: redis_up == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Redis is unreachable on {{ $labels.node }}"

      - alert: ContainerRestartingRepeatedly
        expr: increase(container_start_time_seconds[15m]) > 2
        for: 0m
        labels:
          severity: warning
        annotations:
          summary: "Container {{ $labels.name }} on {{ $labels.node }} has restarted more than twice in 15m"
EOF

# --- Alertmanager: routes firing alerts to email via SES SMTP -----------
cat > /opt/monitoring/alertmanager/alertmanager.yml <<'EOF'
global:
  smtp_smarthost: 'email-smtp.${aws_region}.amazonaws.com:587'
  smtp_from: '${alert_from_address}'
  smtp_auth_username: '${ses_smtp_username}'
  smtp_auth_password: '${ses_smtp_password}'
  smtp_require_tls: true

route:
  receiver: email-alerts
  group_by: ['alertname', 'node']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h

receivers:
  - name: email-alerts
    email_configs:
      - to: '${alert_email}'
        send_resolved: true
EOF

# --- blackbox_exporter: HTTP health-check probing -----------------------
cat > /opt/monitoring/blackbox/blackbox.yml <<'EOF'
modules:
  http_2xx:
    prober: http
    timeout: 5s
    http:
      valid_status_codes: [200]
      method: GET
EOF

# --- Grafana: Prometheus datasource + auto-fetched community dashboards ---
cat > /opt/monitoring/grafana-provisioning/datasources/prometheus.yml <<'EOF'
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    uid: prometheus
    isDefault: true
EOF

cat > /opt/monitoring/grafana-provisioning/dashboards/dashboards.yml <<'EOF'
apiVersion: 1
providers:
  - name: HomeLink
    folder: HomeLink
    type: file
    updateIntervalSeconds: 30
    options:
      path: /etc/grafana/provisioning/dashboards/json
EOF

dnf install -y jq

fetch_dashboard() {
  local id="$1" name="$2"
  local rev
  rev=$(curl -fsSL "https://grafana.com/api/dashboards/$id" | jq -r '.revision' 2>/dev/null) || rev=""
  if [ -n "$rev" ] && [ "$rev" != "null" ]; then
    if curl -fsSL "https://grafana.com/api/dashboards/$id/revisions/$rev/download" \
         -o "/opt/monitoring/grafana-provisioning/dashboards/json/$name.json"; then
      # Community dashboards reference their datasource via an input
      # placeholder meant to be resolved on UI import; file-provisioned
      # dashboards skip that prompt, so point the common placeholder
      # spellings directly at the datasource uid set above.
      sed -i \
        -e 's/$${DS_PROMETHEUS}/prometheus/g' \
        -e 's/$${ds_prometheus}/prometheus/g' \
        -e 's/$${datasource}/prometheus/g' \
        "/opt/monitoring/grafana-provisioning/dashboards/json/$name.json" || true
    else
      echo "WARNING: failed to download dashboard $id ($name) — continuing without it"
    fi
  else
    echo "WARNING: could not resolve latest revision for dashboard $id ($name) — continuing without it"
  fi
}

fetch_dashboard 1860 node-exporter-full
fetch_dashboard 14282 cadvisor
fetch_dashboard 9628 postgresql
fetch_dashboard 11835 redis
fetch_dashboard 7587 blackbox-exporter

# --- The stack itself -----------------------------------------------------
cat > /opt/monitoring/docker-compose.yml <<'EOF'
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
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($|/)'

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:latest
    container_name: cadvisor
    restart: unless-stopped
    network_mode: host
    privileged: true
    # Jenkins itself listens on :8080 (cAdvisor's default) on this box —
    # unlike the app/frontend boxes, which don't run Jenkins.
    command:
      - '--port=8081'
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
      - /dev/disk/:/dev/disk:ro

  blackbox-exporter:
    image: prom/blackbox-exporter:latest
    container_name: blackbox-exporter
    restart: unless-stopped
    ports:
      - "127.0.0.1:9115:9115"
    # See prometheus's identical extra_hosts entry — needed to probe
    # Jenkins's own :8080 on this same box.
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - /opt/monitoring/blackbox/blackbox.yml:/etc/blackbox_exporter/config.yml:ro

  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    restart: unless-stopped
    ports:
      - "127.0.0.1:9090:9090"
    # Lets this bridge-networked container reach node-exporter/cadvisor on
    # THIS box, which use network_mode: host and so aren't reachable via
    # "localhost" (that's prometheus's own loopback) or by service name.
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - /opt/monitoring/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - /opt/monitoring/prometheus/rules.yml:/etc/prometheus/rules.yml:ro
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=15d'
    depends_on:
      - blackbox-exporter
      - alertmanager

  alertmanager:
    image: prom/alertmanager:latest
    container_name: alertmanager
    restart: unless-stopped
    ports:
      - "127.0.0.1:9093:9093"
    volumes:
      - /opt/monitoring/alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro

  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      GF_SECURITY_ADMIN_USER: admin
      GF_SECURITY_ADMIN_PASSWORD: "${grafana_admin_password}"
      GF_SERVER_ROOT_URL: "https://${grafana_public_hostname}"
      GF_SMTP_ENABLED: "true"
      GF_SMTP_HOST: "email-smtp.${aws_region}.amazonaws.com:587"
      GF_SMTP_USER: "${ses_smtp_username}"
      GF_SMTP_PASSWORD: "${ses_smtp_password}"
      GF_SMTP_FROM_ADDRESS: "${alert_from_address}"
    volumes:
      - /opt/monitoring/grafana-provisioning:/etc/grafana/provisioning
      - grafana_data:/var/lib/grafana
    depends_on:
      - prometheus

volumes:
  prometheus_data:
  grafana_data:
EOF

docker compose -f /opt/monitoring/docker-compose.yml up -d

echo "Grafana: https://${grafana_public_hostname} (user: admin, password: see terraform output grafana_admin_password)"

echo "Jenkins initial admin password: /var/lib/jenkins/secrets/initialAdminPassword (via SSM Session Manager)"
