# Skipped entirely while domain_name is unset — SES needs a real domain to
# verify. Set domain_name and re-apply once you have one.
resource "aws_ses_domain_identity" "app" {
  count  = local.have_domain ? 1 : 0
  domain = var.domain_name
}

resource "aws_ses_domain_dkim" "app" {
  count  = local.have_domain ? 1 : 0
  domain = aws_ses_domain_identity.app[0].domain
}

# Note: a brand new AWS account's SES is in the sandbox (send only to
# verified addresses). Request production access via the AWS Support
# console once — Terraform/the SES API can't do this step.
