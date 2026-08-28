# Populates the SSM parameters render-env.sh (see user-data/*.sh.tpl) reads
# at deploy time. Values generated here (JWT secrets, DB password) are
# created once and left stable across applies via lifecycle.ignore_changes,
# so rotating one means editing it in the console/CLI, not `terraform apply`.

resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "random_password" "jwt_refresh_secret" {
  length  = 64
  special = false
}

resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "aws_ssm_parameter" "jwt_secret" {
  name  = "${local.ssm_prefix}/app/jwt_secret"
  type  = "SecureString"
  value = random_password.jwt_secret.result

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "jwt_refresh_secret" {
  name  = "${local.ssm_prefix}/app/jwt_refresh_secret"
  type  = "SecureString"
  value = random_password.jwt_refresh_secret.result

  lifecycle {
    ignore_changes = [value]
  }
}

# Postgres runs as a container on the app box itself (docker-compose.yml's
# `postgres` service, POSTGRES_USER=postgres/POSTGRES_DB=homelink), not a
# managed DB. The base compose file hardcodes POSTGRES_PASSWORD=postgres —
# infra/docker-compose.prod.yml overrides it to read POSTGRES_PASSWORD from
# the shell env instead, which render-env.sh's output must also export (see
# infra/README.md) so this generated password actually takes effect.
resource "aws_ssm_parameter" "db_password" {
  # Basename must be POSTGRES_PASSWORD once render-env.sh upper-cases it —
  # docker-compose reads that exact var name both for `env_file: .env` and
  # for `${POSTGRES_PASSWORD}` substitution in infra/docker-compose.prod.yml.
  name  = "${local.ssm_prefix}/app/postgres_password"
  type  = "SecureString"
  value = random_password.db_password.result

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "database_url" {
  name  = "${local.ssm_prefix}/app/database_url"
  type  = "SecureString"
  value = "postgresql://postgres:${random_password.db_password.result}@postgres:5432/homelink"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "node_env" {
  name  = "${local.ssm_prefix}/app/node_env"
  type  = "String"
  value = "production"
}

resource "aws_ssm_parameter" "app_url" {
  name = "${local.ssm_prefix}/app/app_url"
  type = "String"
  # Falls back to the Elastic IP while domain_name is unset — update by
  # setting domain_name and re-applying, then re-running render-env.sh on
  # the box.
  value = local.have_domain ? "https://${var.api_subdomain}.${var.domain_name}" : "https://${aws_eip.app.public_ip}"
}

resource "aws_ssm_parameter" "app_name" {
  name  = "${local.ssm_prefix}/app/app_name"
  type  = "String"
  value = "HomeLink"
}

resource "aws_ssm_parameter" "redis_url" {
  name  = "${local.ssm_prefix}/app/redis_url"
  type  = "String"
  value = "redis://redis:6379"
}

resource "aws_ssm_parameter" "s3_endpoint" {
  name  = "${local.ssm_prefix}/app/s3_endpoint"
  type  = "String"
  value = "https://s3.${var.aws_region}.amazonaws.com"
}

resource "aws_ssm_parameter" "s3_bucket" {
  name  = "${local.ssm_prefix}/app/s3_bucket"
  type  = "String"
  value = aws_s3_bucket.app.bucket
}

resource "aws_ssm_parameter" "s3_region" {
  name  = "${local.ssm_prefix}/app/s3_region"
  type  = "String"
  value = var.aws_region
}

# S3 access is via the IAM user below, not the app box's instance role,
# because src/services/storage.service.ts always passes explicit
# accessKeyId/secretAccessKey (it's written for an S3-compatible endpoint,
# not AWS-SDK's automatic instance-credential chain).
resource "aws_iam_user" "s3_app" {
  name = "${local.name_prefix}-s3-app"
}

data "aws_iam_policy_document" "s3_app" {
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.app.arn}/*"]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.app.arn]
  }
}

resource "aws_iam_user_policy" "s3_app" {
  name   = "${local.name_prefix}-s3-app"
  user   = aws_iam_user.s3_app.name
  policy = data.aws_iam_policy_document.s3_app.json
}

resource "aws_iam_access_key" "s3_app" {
  user = aws_iam_user.s3_app.name
}

resource "aws_ssm_parameter" "s3_access_key" {
  name  = "${local.ssm_prefix}/app/s3_access_key"
  type  = "SecureString"
  value = aws_iam_access_key.s3_app.id
}

resource "aws_ssm_parameter" "s3_secret_key" {
  name  = "${local.ssm_prefix}/app/s3_secret_key"
  type  = "SecureString"
  value = aws_iam_access_key.s3_app.secret
}

resource "aws_ssm_parameter" "smtp_host" {
  name  = "${local.ssm_prefix}/app/smtp_host"
  type  = "String"
  value = "email-smtp.${var.aws_region}.amazonaws.com"
}

resource "aws_ssm_parameter" "smtp_port" {
  name  = "${local.ssm_prefix}/app/smtp_port"
  type  = "String"
  value = "587"
}

resource "aws_ssm_parameter" "smtp_user" {
  name  = "${local.ssm_prefix}/app/smtp_user"
  type  = "SecureString"
  value = aws_iam_access_key.ses_smtp.id
}

# Placeholder — an IAM access key ID/secret is NOT a valid SMTP password.
# Convert aws_iam_access_key.ses_smtp.secret into an SMTP password using
# AWS's documented algorithm (see infra/scripts/ses-smtp-password.sh) and
# overwrite this parameter once, out of band:
#   aws ssm put-parameter --name "<name>" --type SecureString --overwrite --value "<converted>"
resource "aws_ssm_parameter" "smtp_pass" {
  name  = "${local.ssm_prefix}/app/smtp_pass"
  type  = "SecureString"
  value = "REPLACE_ME_SEE_infra/scripts/ses-smtp-password.sh"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "smtp_from" {
  name = "${local.ssm_prefix}/app/smtp_from"
  type = "String"
  # Placeholder while domain_name is unset — SES itself is skipped too (see
  # ses.tf), so email sending doesn't actually work until both are set.
  value = local.have_domain ? "HomeLink <no-reply@${var.domain_name}>" : "HomeLink <no-reply@example.com>"
}

# ---------------------------------------------------------------------------
# Frontend parameters — minimal; the frontend's own env schema isn't defined
# in this (backend) repo, so only the values this infra can know are set.
# ---------------------------------------------------------------------------

resource "aws_ssm_parameter" "frontend_node_env" {
  name  = "${local.ssm_prefix}/frontend/node_env"
  type  = "String"
  value = "production"
}

resource "aws_ssm_parameter" "frontend_api_url" {
  name  = "${local.ssm_prefix}/frontend/api_url"
  type  = "String"
  value = local.have_domain ? "https://${var.api_subdomain}.${var.domain_name}" : "https://${aws_eip.app.public_ip}"
}

resource "aws_ssm_parameter" "frontend_app_url" {
  name  = "${local.ssm_prefix}/frontend/app_url"
  type  = "String"
  value = local.have_domain ? "https://${var.domain_name}" : "https://${aws_eip.frontend.public_ip}"
}

# ---------------------------------------------------------------------------
# GHCR (ghcr.io) — render-env.sh writes these as GHCR_REPOSITORY/USERNAME/
# TOKEN in each box's .env. infra/docker-compose.prod.yml and
# infra/frontend/docker-compose.prod.yml.example read GHCR_REPOSITORY via
# ${GHCR_REPOSITORY}:${IMAGE_TAG} substitution; render-env.sh itself uses
# USERNAME/TOKEN to `docker login ghcr.io` (skipped if TOKEN is empty —
# i.e. public packages).
# ---------------------------------------------------------------------------

locals {
  ghcr_username = coalesce(var.ghcr_username, split("/", var.github_backend_repo)[0])
}

resource "aws_ssm_parameter" "app_ghcr_repository" {
  name  = "${local.ssm_prefix}/app/ghcr_repository"
  type  = "String"
  value = "ghcr.io/${lower(var.github_backend_repo)}"
}

resource "aws_ssm_parameter" "app_ghcr_username" {
  name  = "${local.ssm_prefix}/app/ghcr_username"
  type  = "String"
  value = local.ghcr_username
}

resource "aws_ssm_parameter" "app_ghcr_token" {
  name  = "${local.ssm_prefix}/app/ghcr_token"
  type  = "SecureString"
  value = var.ghcr_token != null ? var.ghcr_token : "unset" # SSM rejects empty-string values; render-env.sh treats this sentinel as "no token"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "frontend_ghcr_repository" {
  count = var.github_frontend_repo != null ? 1 : 0
  name  = "${local.ssm_prefix}/frontend/ghcr_repository"
  type  = "String"
  value = "ghcr.io/${lower(var.github_frontend_repo)}"
}

resource "aws_ssm_parameter" "frontend_ghcr_username" {
  count = var.github_frontend_repo != null ? 1 : 0
  name  = "${local.ssm_prefix}/frontend/ghcr_username"
  type  = "String"
  value = coalesce(var.ghcr_username, split("/", var.github_frontend_repo)[0])
}

resource "aws_ssm_parameter" "frontend_ghcr_token" {
  count = var.github_frontend_repo != null ? 1 : 0
  name  = "${local.ssm_prefix}/frontend/ghcr_token"
  type  = "SecureString"
  value = var.ghcr_token != null ? var.ghcr_token : "unset" # SSM rejects empty-string values; render-env.sh treats this sentinel as "no token"

  lifecycle {
    ignore_changes = [value]
  }
}
