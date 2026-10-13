#!/bin/bash
# Adds a 2 GB swap file so a memory spike (a Chromium PDF render on the app
# box, a Docker build on the Jenkins box) slows the box down instead of
# OOM-killing Postgres/Jenkins on the small instance types this stack runs on.
#
# Idempotent. Inlined into every box's user-data (see compute.tf) for new
# instances; user-data only runs on first boot, so run this once by hand on
# boxes that already exist:
#
#   aws ssm send-command --instance-ids <id> --document-name AWS-RunShellScript \
#     --parameters commands="$(jq -Rs '[.]' infra/scripts/add-swap.sh)"
set -euo pipefail

if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap defaults 0 0' >> /etc/fstab
fi

# Only swap under real memory pressure, not to make room for page cache.
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
sysctl -w vm.swappiness=10
