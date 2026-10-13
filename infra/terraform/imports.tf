# One-time adoption of the already-running production resources into the
# new S3-backed state (the original local state file was lost). Safe to
# delete after the first successful apply — import blocks are no-ops once
# a resource is in state.

import {
  to = aws_instance.app
  id = "i-0463f44157003853a"
}

import {
  to = aws_instance.frontend
  id = "i-07f8ba8957785eec8"
}

import {
  to = aws_instance.jenkins
  id = "i-0af697da62a0297cc"
}

import {
  to = aws_eip.app
  id = "eipalloc-058b2b756e0baec46"
}

import {
  to = aws_eip.frontend
  id = "eipalloc-0568064f101bf04ee"
}

import {
  to = aws_eip.jenkins[0]
  id = "eipalloc-05d075608c0f1dc52"
}

import {
  to = aws_eip_association.jenkins[0]
  id = "eipassoc-00c7f87914f5963fb"
}

import {
  to = aws_security_group.app
  id = "sg-0be6d00997cbc71fc"
}

import {
  to = aws_security_group.frontend
  id = "sg-0892d684b8a896954"
}

import {
  to = aws_security_group.jenkins
  id = "sg-0d07918097ae9448b"
}

import {
  to = aws_iam_role.app
  id = "homelink-production-app"
}

import {
  to = aws_iam_role_policy_attachment.app_ssm
  id = "homelink-production-app/arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

import {
  to = aws_iam_role_policy.app
  id = "homelink-production-app:homelink-production-app"
}

import {
  to = aws_iam_instance_profile.app
  id = "homelink-production-app"
}

import {
  to = aws_iam_role.frontend
  id = "homelink-production-frontend"
}

import {
  to = aws_iam_role_policy_attachment.frontend_ssm
  id = "homelink-production-frontend/arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

import {
  to = aws_iam_role_policy.frontend
  id = "homelink-production-frontend:homelink-production-frontend"
}

import {
  to = aws_iam_instance_profile.frontend
  id = "homelink-production-frontend"
}

import {
  to = aws_iam_role.jenkins
  id = "homelink-production-jenkins"
}

import {
  to = aws_iam_role_policy_attachment.jenkins_ssm
  id = "homelink-production-jenkins/arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

import {
  to = aws_iam_role_policy.jenkins
  id = "homelink-production-jenkins:homelink-production-jenkins"
}

import {
  to = aws_iam_instance_profile.jenkins
  id = "homelink-production-jenkins"
}

import {
  to = aws_iam_role.dlm
  id = "homelink-production-dlm"
}

import {
  to = aws_iam_role_policy_attachment.dlm
  id = "homelink-production-dlm/arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

import {
  to = aws_dlm_lifecycle_policy.nightly_snapshots
  id = "policy-056599ca8468d3453"
}

import {
  to = aws_iam_user.s3_app
  id = "homelink-production-s3-app"
}

import {
  to = aws_iam_user_policy.s3_app
  id = "homelink-production-s3-app:homelink-production-s3-app"
}

import {
  to = aws_iam_access_key.s3_app
  id = "AKIA2ZHH7PN2JHFL7YBG"
}

import {
  to = aws_sns_topic.alerts
  id = "arn:aws:sns:eu-west-1:741368363892:homelink-production-alerts"
}

import {
  to = aws_cloudwatch_metric_alarm.app_status_check
  id = "homelink-production-app-status-check-failed"
}

import {
  to = aws_cloudwatch_metric_alarm.frontend_status_check
  id = "homelink-production-frontend-status-check-failed"
}

import {
  to = aws_cloudwatch_metric_alarm.jenkins_status_check
  id = "homelink-production-jenkins-status-check-failed"
}

import {
  to = aws_cloudwatch_metric_alarm.payout_events_dlq_not_empty
  id = "homelink-production-payout-events-dlq-not-empty"
}

import {
  to = aws_sqs_queue.payout_events
  id = "https://sqs.eu-west-1.amazonaws.com/741368363892/homelink-production-payout-events"
}

import {
  to = aws_sqs_queue.payout_events_dlq
  id = "https://sqs.eu-west-1.amazonaws.com/741368363892/homelink-production-payout-events-dlq"
}

import {
  to = aws_sqs_queue_policy.payout_events
  id = "https://sqs.eu-west-1.amazonaws.com/741368363892/homelink-production-payout-events"
}

import {
  to = aws_cloudwatch_event_bus.homelink
  id = "homelink-production-payments"
}

import {
  to = aws_cloudwatch_event_rule.payment_succeeded
  id = "homelink-production-payments/homelink-production-payment-succeeded"
}

import {
  to = aws_cloudwatch_event_target.payout_events_sqs
  id = "homelink-production-payments/homelink-production-payment-succeeded/terraform-20260903175132633700000001"
}

import {
  to = aws_s3_bucket.app
  id = "homelink-production-storage-1dc9bda3"
}

import {
  to = aws_s3_bucket_public_access_block.app
  id = "homelink-production-storage-1dc9bda3"
}

import {
  to = aws_s3_bucket_server_side_encryption_configuration.app
  id = "homelink-production-storage-1dc9bda3"
}

import {
  to = aws_s3_bucket_versioning.app
  id = "homelink-production-storage-1dc9bda3"
}

import {
  to = aws_ssm_parameter.jwt_secret
  id = "/homelink/production/app/jwt_secret"
}

import {
  to = aws_ssm_parameter.jwt_refresh_secret
  id = "/homelink/production/app/jwt_refresh_secret"
}

import {
  to = aws_ssm_parameter.db_password
  id = "/homelink/production/app/postgres_password"
}

import {
  to = aws_ssm_parameter.database_url
  id = "/homelink/production/app/database_url"
}

import {
  to = aws_ssm_parameter.node_env
  id = "/homelink/production/app/node_env"
}

import {
  to = aws_ssm_parameter.app_url
  id = "/homelink/production/app/app_url"
}

import {
  to = aws_ssm_parameter.frontend_url
  id = "/homelink/production/app/frontend_url"
}

import {
  to = aws_ssm_parameter.public_hostname
  id = "/homelink/production/app/public_hostname"
}

import {
  to = aws_ssm_parameter.app_name
  id = "/homelink/production/app/app_name"
}

import {
  to = aws_ssm_parameter.cors_allowed_origins
  id = "/homelink/production/app/cors_allowed_origins"
}

import {
  to = aws_ssm_parameter.admin_email[0]
  id = "/homelink/production/app/admin_email"
}

import {
  to = aws_ssm_parameter.admin_password[0]
  id = "/homelink/production/app/admin_password"
}

import {
  to = aws_ssm_parameter.redis_url
  id = "/homelink/production/app/redis_url"
}

import {
  to = aws_ssm_parameter.s3_endpoint
  id = "/homelink/production/app/s3_endpoint"
}

import {
  to = aws_ssm_parameter.s3_bucket
  id = "/homelink/production/app/s3_bucket"
}

import {
  to = aws_ssm_parameter.s3_region
  id = "/homelink/production/app/s3_region"
}

import {
  to = aws_ssm_parameter.s3_access_key
  id = "/homelink/production/app/s3_access_key"
}

import {
  to = aws_ssm_parameter.s3_secret_key
  id = "/homelink/production/app/s3_secret_key"
}

import {
  to = aws_ssm_parameter.smtp_host
  id = "/homelink/production/app/smtp_host"
}

import {
  to = aws_ssm_parameter.smtp_port
  id = "/homelink/production/app/smtp_port"
}

import {
  to = aws_ssm_parameter.smtp_user
  id = "/homelink/production/app/smtp_user"
}

import {
  to = aws_ssm_parameter.smtp_pass
  id = "/homelink/production/app/smtp_pass"
}

import {
  to = aws_ssm_parameter.smtp_from
  id = "/homelink/production/app/smtp_from"
}

import {
  to = aws_ssm_parameter.frontend_node_env
  id = "/homelink/production/frontend/node_env"
}

import {
  to = aws_ssm_parameter.frontend_api_url
  id = "/homelink/production/frontend/api_url"
}

import {
  to = aws_ssm_parameter.frontend_app_url
  id = "/homelink/production/frontend/app_url"
}

import {
  to = aws_ssm_parameter.frontend_public_hostname
  id = "/homelink/production/frontend/public_hostname"
}

import {
  to = aws_ssm_parameter.app_ghcr_repository
  id = "/homelink/production/app/ghcr_repository"
}

import {
  to = aws_ssm_parameter.app_ghcr_username
  id = "/homelink/production/app/ghcr_username"
}

import {
  to = aws_ssm_parameter.app_ghcr_token
  id = "/homelink/production/app/ghcr_token"
}

import {
  to = aws_ssm_parameter.frontend_ghcr_repository[0]
  id = "/homelink/production/frontend/ghcr_repository"
}

import {
  to = aws_ssm_parameter.frontend_ghcr_username[0]
  id = "/homelink/production/frontend/ghcr_username"
}

import {
  to = aws_ssm_parameter.frontend_ghcr_token[0]
  id = "/homelink/production/frontend/ghcr_token"
}

import {
  to = aws_ssm_parameter.mtn_momo_base_url
  id = "/homelink/production/app/mtn_momo_base_url"
}

import {
  to = aws_ssm_parameter.mtn_momo_target_environment
  id = "/homelink/production/app/mtn_momo_target_environment"
}

import {
  to = aws_ssm_parameter.mtn_momo_currency
  id = "/homelink/production/app/mtn_momo_currency"
}

import {
  to = aws_ssm_parameter.mtn_momo_callback_base_url
  id = "/homelink/production/app/mtn_momo_callback_base_url"
}

import {
  to = aws_ssm_parameter.mtn_momo_collection_subscription_key
  id = "/homelink/production/app/mtn_momo_collection_subscription_key"
}

import {
  to = aws_ssm_parameter.mtn_momo_collection_api_user
  id = "/homelink/production/app/mtn_momo_collection_api_user"
}

import {
  to = aws_ssm_parameter.mtn_momo_collection_api_key
  id = "/homelink/production/app/mtn_momo_collection_api_key"
}

import {
  to = aws_ssm_parameter.mtn_momo_disbursement_subscription_key
  id = "/homelink/production/app/mtn_momo_disbursement_subscription_key"
}

import {
  to = aws_ssm_parameter.mtn_momo_disbursement_api_user
  id = "/homelink/production/app/mtn_momo_disbursement_api_user"
}

import {
  to = aws_ssm_parameter.mtn_momo_disbursement_api_key
  id = "/homelink/production/app/mtn_momo_disbursement_api_key"
}

import {
  to = aws_ssm_parameter.eventbridge_bus_name
  id = "/homelink/production/app/eventbridge_bus_name"
}

import {
  to = aws_ssm_parameter.payout_events_queue_url
  id = "/homelink/production/app/payout_events_queue_url"
}
