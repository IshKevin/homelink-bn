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

  # Public hostname each box's Caddy gets a real Let's Encrypt cert for.
  # Without a domain_name, nip.io (a public wildcard-DNS service that just
  # encodes the IP in the hostname, no registration needed) still lets Caddy
  # obtain a trusted cert instead of falling back to a self-signed one —
  # see infra/Caddyfile's `{$PUBLIC_HOSTNAME}` and PUBLIC_HOSTNAME/
  # FRONTEND_PUBLIC_HOSTNAME below. Once domain_name is set, this switches
  # to the real subdomain automatically.
  app_public_hostname      = local.have_domain ? "${var.api_subdomain}.${var.domain_name}" : "${replace(aws_eip.app.public_ip, ".", "-")}.nip.io"
  frontend_public_hostname = local.have_domain ? var.domain_name : "${replace(aws_eip.frontend.public_ip, ".", "-")}.nip.io"
}
