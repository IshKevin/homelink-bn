# Free EC2 status-check alarms only — docs/INFRASTRUCTURE.md §6
# ("no custom dashboards, rely on free EC2 status-check alarms").

resource "aws_sns_topic" "alerts" {
  name = "${local.name_prefix}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "app_status_check" {
  alarm_name          = "${local.name_prefix}-app-status-check-failed"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "StatusCheckFailed"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "App box (API + worker + Postgres + Redis) failed an EC2 status check."
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    InstanceId = aws_instance.app.id
  }
}

resource "aws_cloudwatch_metric_alarm" "frontend_status_check" {
  alarm_name          = "${local.name_prefix}-frontend-status-check-failed"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "StatusCheckFailed"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "Frontend box (SSR) failed an EC2 status check."
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    InstanceId = aws_instance.frontend.id
  }
}

resource "aws_cloudwatch_metric_alarm" "jenkins_status_check" {
  alarm_name          = "${local.name_prefix}-jenkins-status-check-failed"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "StatusCheckFailed"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "Jenkins box failed an EC2 status check."
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    InstanceId = aws_instance.jenkins.id
  }
}

# A message here means a landlord disbursement failed 5 times (see
# payments.tf's redrive policy) and was never sent — without this, that
# failure is silent and the landlord just doesn't get paid until someone
# happens to look. See src/jobs/handlers/processPayoutEvents.job.ts.
resource "aws_cloudwatch_metric_alarm" "payout_events_dlq_not_empty" {
  alarm_name          = "${local.name_prefix}-payout-events-dlq-not-empty"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "A landlord payout event failed repeatedly and landed in the dead-letter queue — a real rent payment was not disbursed automatically."
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    QueueName = aws_sqs_queue.payout_events_dlq.name
  }
}
