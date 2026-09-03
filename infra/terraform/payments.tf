# Automated landlord disbursement pipeline: a tenant payment succeeding
# (src/modules/payments/payments.service.ts's markPaymentSuccess) publishes
# a payment.succeeded event to this custom EventBridge bus. A rule forwards
# matching events to an SQS queue; the app's worker polls that queue every
# minute (src/jobs/handlers/processPayoutEvents.job.ts) and disburses rent
# to the landlord's own MTN MoMo number — no manual approval step.
#
# EventBridge -> SQS (not -> Lambda) deliberately: this app already runs a
# BullMQ worker process on the app box, so polling SQS from a scheduled job
# there reuses that existing async-processing model instead of adding a
# separate Lambda deployment/IAM surface for a single consumer.
#
# See docs/INFRASTRUCTURE.md for the regulatory flag on money passing
# through HomeLink's own MTN merchant account, even briefly and fully
# automated, before reaching the landlord.

resource "aws_cloudwatch_event_bus" "homelink" {
  name = "${local.name_prefix}-payments"
}

resource "aws_sqs_queue" "payout_events_dlq" {
  name                      = "${local.name_prefix}-payout-events-dlq"
  message_retention_seconds = 1209600 # 14 days — time to notice and replay a stuck payout
}

resource "aws_sqs_queue" "payout_events" {
  name                       = "${local.name_prefix}-payout-events"
  visibility_timeout_seconds = 60     # comfortably longer than one MTN Disbursement API call
  message_retention_seconds  = 345600 # 4 days

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.payout_events_dlq.arn
    maxReceiveCount     = 5
  })
}

data "aws_iam_policy_document" "payout_events_queue" {
  statement {
    sid       = "AllowEventBridgePublish"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.payout_events.arn]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.payment_succeeded.arn]
    }
  }
}

resource "aws_sqs_queue_policy" "payout_events" {
  queue_url = aws_sqs_queue.payout_events.url
  policy    = data.aws_iam_policy_document.payout_events_queue.json
}

resource "aws_cloudwatch_event_rule" "payment_succeeded" {
  name           = "${local.name_prefix}-payment-succeeded"
  event_bus_name = aws_cloudwatch_event_bus.homelink.name

  event_pattern = jsonencode({
    source      = ["homelink.payments"]
    detail-type = ["payment.succeeded"]
  })
}

resource "aws_cloudwatch_event_target" "payout_events_sqs" {
  rule           = aws_cloudwatch_event_rule.payment_succeeded.name
  event_bus_name = aws_cloudwatch_event_bus.homelink.name
  arn            = aws_sqs_queue.payout_events.arn
}
