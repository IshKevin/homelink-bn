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

# --- DMARC ------------------------------------------------------------------
# p=none: monitor-only. We don't have an inbox to receive aggregate reports
# at yet, so no rua= — the record's presence (and the now-aligned SPF above)
# is what matters for deliverability/reputation signals. Tighten to
# quarantine/reject once sending volume and history justify it.
resource "cloudflare_record" "dmarc" {
  count   = local.manage_dns ? 1 : 0
  zone_id = var.cloudflare_zone_id
  name    = "_dmarc.${var.domain_name}"
  type    = "TXT"
  content = "v=DMARC1; p=none;"
  proxied = false
  ttl     = 300
}
