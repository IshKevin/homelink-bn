provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

# Only ever contacted when enable_cloudflare_dns = true and a DNS resource
# using it actually gets created — the provider still requires *some*
# non-empty token to initialize even then, so fall back to a placeholder
# when unset (harmless: with enable_cloudflare_dns = false there are zero
# cloudflare_record resources, so no API call is ever made with it).
provider "cloudflare" {
  api_token = coalesce(var.cloudflare_api_token, "unused-0000000000000000000000000000000000000")
}
