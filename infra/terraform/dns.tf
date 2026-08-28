# Cloudflare (free plan) instead of a Route 53 hosted zone — free DNS, free
# edge caching/SSL — docs/INFRASTRUCTURE.md §5. Set enable_cloudflare_dns =
# false to manage these records elsewhere; the *_public_ip outputs still
# give you what to point at. All records are also skipped while domain_name
# is unset (no domain -> no Cloudflare zone to manage records in yet).

locals {
  manage_dns = var.enable_cloudflare_dns && local.have_domain
}

resource "cloudflare_record" "frontend_apex" {
  count   = local.manage_dns ? 1 : 0
  zone_id = var.cloudflare_zone_id
  name    = "@"
  type    = "A"
  content = aws_eip.frontend.public_ip
  proxied = var.cloudflare_proxied
  ttl     = 1
}

resource "cloudflare_record" "frontend_www" {
  count   = local.manage_dns ? 1 : 0
  zone_id = var.cloudflare_zone_id
  name    = "www"
  type    = "A"
  content = aws_eip.frontend.public_ip
  proxied = var.cloudflare_proxied
  ttl     = 1
}

resource "cloudflare_record" "api" {
  count   = local.manage_dns ? 1 : 0
  zone_id = var.cloudflare_zone_id
  name    = var.api_subdomain
  type    = "A"
  content = aws_eip.app.public_ip
  proxied = var.cloudflare_proxied
  ttl     = 1
}

# Only created if the Jenkins UI is opted into direct HTTPS access at all
# (jenkins_admin_cidr_blocks non-empty) — otherwise there's no listener on
# 443 to point it at; use SSM port-forwarding instead.
resource "cloudflare_record" "jenkins" {
  count   = local.manage_dns && length(var.jenkins_admin_cidr_blocks) > 0 ? 1 : 0
  zone_id = var.cloudflare_zone_id
  name    = var.jenkins_subdomain
  type    = "A"
  content = local.jenkins_public_ip
  proxied = false # Cloudflare-proxying Jenkins UI websocket/agent traffic isn't worth the edge-cache footgun for an admin-only tool
  ttl     = 1
}

# --- SES domain verification (must be DNS-only, never proxied) -------------

resource "cloudflare_record" "ses_verification" {
  count   = local.manage_dns ? 1 : 0
  zone_id = var.cloudflare_zone_id
  name    = "_amazonses.${var.domain_name}"
  type    = "TXT"
  content = aws_ses_domain_identity.app[0].verification_token
  proxied = false
  ttl     = 300
}

resource "cloudflare_record" "ses_dkim" {
  count   = local.manage_dns ? 3 : 0
  zone_id = var.cloudflare_zone_id
  name    = "${aws_ses_domain_dkim.app[0].dkim_tokens[count.index]}._domainkey"
  type    = "CNAME"
  content = "${aws_ses_domain_dkim.app[0].dkim_tokens[count.index]}.dkim.amazonses.com"
  proxied = false
  ttl     = 300
}
