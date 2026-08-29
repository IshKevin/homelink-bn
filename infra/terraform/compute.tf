data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

resource "aws_instance" "app" {
  ami                         = data.aws_ssm_parameter.al2023_arm64.value
  instance_type               = var.app_instance_type
  subnet_id                   = local.subnet_id
  vpc_security_group_ids      = [aws_security_group.app.id]
  iam_instance_profile        = aws_iam_instance_profile.app.name
  associate_public_ip_address = true
  key_name                    = var.ssh_key_name

  root_block_device {
    volume_type = "gp3"
    volume_size = var.app_root_volume_gb
    tags        = merge(local.common_tags, { Name = "${local.name_prefix}-app-root", Backup = "true" })
  }

  metadata_options {
    http_tokens = "required" # IMDSv2 only
  }

  user_data = templatefile("${path.module}/user-data/app.sh.tpl", {
    ssm_prefix = local.ssm_prefix
    aws_region = var.aws_region
  })

  tags = { Name = "${local.name_prefix}-app", Backup = "true" }
}

resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"
  tags     = { Name = "${local.name_prefix}-app" }
}

resource "aws_instance" "frontend" {
  ami                         = data.aws_ssm_parameter.al2023_arm64.value
  instance_type               = var.frontend_instance_type
  subnet_id                   = local.subnet_id
  vpc_security_group_ids      = [aws_security_group.frontend.id]
  iam_instance_profile        = aws_iam_instance_profile.frontend.name
  associate_public_ip_address = true
  key_name                    = var.ssh_key_name

  root_block_device {
    volume_type = "gp3"
    volume_size = var.frontend_root_volume_gb
    tags        = merge(local.common_tags, { Name = "${local.name_prefix}-frontend-root", Backup = "true" })
  }

  metadata_options {
    http_tokens = "required" # IMDSv2 only
  }

  user_data = templatefile("${path.module}/user-data/frontend.sh.tpl", {
    ssm_prefix = local.ssm_prefix
    aws_region = var.aws_region
  })

  tags = { Name = "${local.name_prefix}-frontend", Backup = "true" }
}

resource "aws_eip" "frontend" {
  instance = aws_instance.frontend.id
  domain   = "vpc"
  tags     = { Name = "${local.name_prefix}-frontend" }
}

# Allocated standalone (not tied to the instance's `instance` attribute)
# and associated separately below, so its public_ip is known independently
# of aws_instance.jenkins — that instance's own user_data needs this IP
# (to derive a nip.io hostname for a real cert) which would otherwise be a
# dependency cycle. Only allocated when direct HTTPS access is opted into
# (jenkins_admin_cidr_blocks non-empty) — by default Jenkins is reached via
# SSM port-forwarding, which addresses the box by instance ID, not IP, so a
# *stable* address buys nothing and the auto-assigned public IP (still
# needed for outbound internet with no NAT Gateway) is enough on its own.
resource "aws_eip" "jenkins" {
  count  = length(var.jenkins_admin_cidr_blocks) > 0 ? 1 : 0
  domain = "vpc"
  tags   = { Name = "${local.name_prefix}-jenkins" }
}

locals {
  # Real public hostname for Jenkins's own Caddy (see user-data/jenkins.sh.tpl)
  # to get a trusted Let's Encrypt cert instead of self-signed — only
  # computable (and only actually reachable for ACME's HTTP-01 challenge)
  # once jenkins_admin_cidr_blocks opens the box to the internet. Empty
  # string when not opted in; the template falls back to `tls internal`.
  jenkins_public_hostname = length(var.jenkins_admin_cidr_blocks) == 0 ? "" : (
    local.have_domain ? "${var.jenkins_subdomain}.${var.domain_name}" : "${replace(aws_eip.jenkins[0].public_ip, ".", "-")}.nip.io"
  )
}

resource "aws_instance" "jenkins" {
  ami                         = data.aws_ssm_parameter.al2023_arm64.value
  instance_type               = var.jenkins_instance_type
  subnet_id                   = local.subnet_id
  vpc_security_group_ids      = [aws_security_group.jenkins.id]
  iam_instance_profile        = aws_iam_instance_profile.jenkins.name
  associate_public_ip_address = true
  key_name                    = var.ssh_key_name

  root_block_device {
    volume_type = "gp3"
    volume_size = var.jenkins_root_volume_gb
    tags        = merge(local.common_tags, { Name = "${local.name_prefix}-jenkins-root", Backup = "true" })
  }

  metadata_options {
    http_tokens = "required" # IMDSv2 only
  }

  user_data = templatefile("${path.module}/user-data/jenkins.sh.tpl", {
    aws_region              = var.aws_region
    app_instance_id         = aws_instance.app.id
    frontend_instance_id    = aws_instance.frontend.id
    jenkins_public_hostname = local.jenkins_public_hostname

    # --- Monitoring (Prometheus + Grafana), see monitoring section below ---
    grafana_public_hostname = local.grafana_public_hostname
    grafana_admin_password  = random_password.grafana_admin_password.result
    app_private_ip          = aws_instance.app.private_ip
    frontend_private_ip     = aws_instance.frontend.private_ip
    app_public_hostname     = local.app_public_hostname
    frontend_public_hostname = local.frontend_public_hostname
    alert_email             = var.alert_email
    ses_smtp_username  = aws_iam_access_key.ses_smtp.id
    ses_smtp_password  = data.external.ses_smtp_password.result.password
    alert_from_address = local.have_domain ? "no-reply@${var.domain_name}" : coalesce(var.sender_email, "no-reply@example.com")
  })

  tags = { Name = "${local.name_prefix}-jenkins", Backup = "true" }
}

resource "aws_eip_association" "jenkins" {
  count         = length(var.jenkins_admin_cidr_blocks) > 0 ? 1 : 0
  instance_id   = aws_instance.jenkins.id
  allocation_id = aws_eip.jenkins[0].id
}

# Shared secret between GitHub's webhook and the Jenkins job's trigger
# config — since jenkins_admin_cidr_blocks opens the box to the internet
# for webhook delivery, this is what stops a stranger who finds the URL
# from triggering arbitrary builds. See outputs.tf's
# jenkins_github_webhook_payload_url/secret.
resource "random_password" "jenkins_github_webhook_secret" {
  length  = 40
  special = false
}

# Prometheus + Grafana run on the Jenkins box (see user-data/jenkins.sh.tpl)
# and scrape node_exporter/cAdvisor/postgres_exporter/redis_exporter on the
# app/frontend boxes over their private IPs — see network.tf's
# jenkins-security-group-sourced ingress rules on those boxes.
resource "random_password" "grafana_admin_password" {
  length  = 24
  special = false
}

# Converts aws_iam_access_key.ses_smtp's raw secret into an actual SMTP
# password (see infra/scripts/ses-smtp-password-external.sh) at `terraform
# apply` time, so the Jenkins box's user_data only ever needs the derived
# password — never the master IAM secret — for Alertmanager's SMTP alerts.
data "external" "ses_smtp_password" {
  program = ["bash", "${path.module}/../scripts/ses-smtp-password-external.sh"]
  query = {
    secret = aws_iam_access_key.ses_smtp.secret
    region = var.aws_region
  }
}

locals {
  # Same nip.io-or-real-domain pattern as app/frontend_public_hostname, but
  # as a subdomain of the Jenkins hostname itself — nip.io resolves any
  # subdomain of <ip-with-dashes>.nip.io to that same IP, so this needs no
  # separate EIP or DNS record.
  grafana_public_hostname = local.have_domain ? "grafana.${var.domain_name}" : "grafana.${local.jenkins_public_hostname}"

  jenkins_public_ip = length(var.jenkins_admin_cidr_blocks) > 0 ? aws_eip.jenkins[0].public_ip : aws_instance.jenkins.public_ip
}
