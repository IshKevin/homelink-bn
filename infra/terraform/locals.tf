locals {
  name_prefix = "${var.project}-${var.environment}"

  common_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  # SSM Parameter Store namespace — mirrors docs/INFRASTRUCTURE.md §4
  # ("Secrets via SSM Parameter Store, not Secrets Manager").
  ssm_prefix = "/${var.project}/${var.environment}"

  # Gates SES + all Cloudflare DNS records — see domain_name's description.
  have_domain = var.domain_name != null
}
