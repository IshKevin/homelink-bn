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

# --- Bounce/complaint handling ----------------------------------------------
# Without this, a dropped/undeliverable-address bounce or a spam complaint
# is invisible to the app — we'd just keep re-mailing an address that either
# doesn't exist or doesn't want our mail, hurting SES sender reputation.
# SES publishes here; the app's own SNS HTTPS subscription (below) verifies
# each message's signature before trusting it (see
# src/modules/webhooks/ses.webhooks.controller.ts) and adds the address to
# suppressed_emails, which sendMail checks before every send.

data "aws_caller_identity" "current" {}

resource "aws_sns_topic" "ses_notifications" {
  count = local.have_domain ? 1 : 0
  name  = "${local.name_prefix}-ses-notifications"
}

resource "aws_sns_topic_policy" "ses_notifications" {
  count = local.have_domain ? 1 : 0
  arn   = aws_sns_topic.ses_notifications[0].arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowSESPublish"
        Effect    = "Allow"
        Principal = { Service = "ses.amazonaws.com" }
        Action    = "SNS:Publish"
        Resource  = aws_sns_topic.ses_notifications[0].arn
        Condition = {
          StringEquals = { "AWS:SourceAccount" = data.aws_caller_identity.current.account_id }
          StringLike   = { "AWS:SourceArn" = aws_ses_domain_identity.app[0].arn }
        }
      }
    ]
  })
}

resource "aws_ses_identity_notification_topic" "bounce" {
  count                    = local.have_domain ? 1 : 0
  topic_arn                = aws_sns_topic.ses_notifications[0].arn
  notification_type        = "Bounce"
  identity                 = aws_ses_domain_identity.app[0].domain
  include_original_headers = false
}

resource "aws_ses_identity_notification_topic" "complaint" {
  count                    = local.have_domain ? 1 : 0
  topic_arn                = aws_sns_topic.ses_notifications[0].arn
  notification_type        = "Complaint"
  identity                 = aws_ses_domain_identity.app[0].domain
  include_original_headers = false
}

# HTTPS delivery requires a one-time handshake: SNS POSTs a
# SubscriptionConfirmation with a SubscribeURL, and the endpoint must GET it
# to activate — the webhook handler does this automatically on first
# delivery, no manual step needed.
resource "aws_sns_topic_subscription" "ses_notifications_webhook" {
  count     = local.have_domain ? 1 : 0
  topic_arn = aws_sns_topic.ses_notifications[0].arn
  protocol  = "https"
  endpoint  = "https://${local.app_public_hostname}/api/v1/webhooks/ses/notifications"
}
