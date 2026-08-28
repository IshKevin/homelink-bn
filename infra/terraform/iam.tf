# ---------------------------------------------------------------------------
# App box role — SSM Session Manager (no SSH needed), read its own SSM
# parameters, read/write its own S3 bucket. Deploy images come from GHCR
# (github.com), not an AWS registry, so no ECR permissions are needed here —
# see ssm.tf's ghcr_username/ghcr_token for how the box authenticates to it.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "${local.name_prefix}-app"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "app_ssm" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "app" {
  statement {
    sid       = "ReadOwnParameters"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${var.aws_region}:*:parameter${local.ssm_prefix}/*"]
  }

  statement {
    sid       = "DecryptSecureStringParameters"
    actions   = ["kms:Decrypt"]
    resources = ["arn:aws:kms:${var.aws_region}:*:alias/aws/ssm"]
  }

  statement {
    sid       = "AppBucketObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.app.arn}/*"]
  }

  statement {
    sid       = "AppBucketList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.app.arn]
  }
}

resource "aws_iam_role_policy" "app" {
  name   = "${local.name_prefix}-app"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app.json
}

resource "aws_iam_instance_profile" "app" {
  name = "${local.name_prefix}-app"
  role = aws_iam_role.app.name
}

# ---------------------------------------------------------------------------
# Frontend box role — SSM Session Manager + read its own SSM parameters only.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "frontend" {
  name               = "${local.name_prefix}-frontend"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "frontend_ssm" {
  role       = aws_iam_role.frontend.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "frontend" {
  statement {
    sid       = "ReadOwnParameters"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${var.aws_region}:*:parameter${local.ssm_prefix}/*"]
  }

  statement {
    sid       = "DecryptSecureStringParameters"
    actions   = ["kms:Decrypt"]
    resources = ["arn:aws:kms:${var.aws_region}:*:alias/aws/ssm"]
  }
}

resource "aws_iam_role_policy" "frontend" {
  name   = "${local.name_prefix}-frontend"
  role   = aws_iam_role.frontend.id
  policy = data.aws_iam_policy_document.frontend.json
}

resource "aws_iam_instance_profile" "frontend" {
  name = "${local.name_prefix}-frontend"
  role = aws_iam_role.frontend.name
}

# ---------------------------------------------------------------------------
# Jenkins box role — SSM Session Manager for admin access, plus permission
# to trigger deploys on the app/frontend boxes via SSM Run Command. This is
# the box's OWN identity (via its instance profile), so no AWS access keys
# or OIDC federation are needed in Jenkins itself — only a GHCR PAT (see
# infra/README.md), since GHCR auth is GitHub-side, not AWS-side.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "jenkins" {
  name               = "${local.name_prefix}-jenkins"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "jenkins_ssm" {
  role       = aws_iam_role.jenkins.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "jenkins" {
  statement {
    sid       = "TriggerDeploy"
    actions   = ["ssm:SendCommand"]
    resources = [aws_instance.app.arn, aws_instance.frontend.arn]
  }

  statement {
    sid       = "TriggerDeployDocument"
    actions   = ["ssm:SendCommand"]
    resources = ["arn:aws:ssm:${var.aws_region}::document/AWS-RunShellScript"]
  }

  statement {
    sid       = "ReadDeployStatus"
    actions   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "jenkins" {
  name   = "${local.name_prefix}-jenkins"
  role   = aws_iam_role.jenkins.id
  policy = data.aws_iam_policy_document.jenkins.json
}

resource "aws_iam_instance_profile" "jenkins" {
  name = "${local.name_prefix}-jenkins"
  role = aws_iam_role.jenkins.name
}

# ---------------------------------------------------------------------------
# SES SMTP sending user — the app talks to SES over SMTP (SMTP_HOST/PORT/
# USER/PASS in src/config/env.ts), not the SES API, so it needs long-lived
# SMTP credentials rather than the instance role.
# ---------------------------------------------------------------------------

resource "aws_iam_user" "ses_smtp" {
  name = "${local.name_prefix}-ses-smtp"
}

data "aws_iam_policy_document" "ses_smtp" {
  statement {
    actions   = ["ses:SendRawEmail"]
    resources = ["*"]
  }
}

resource "aws_iam_user_policy" "ses_smtp" {
  name   = "${local.name_prefix}-ses-smtp"
  user   = aws_iam_user.ses_smtp.name
  policy = data.aws_iam_policy_document.ses_smtp.json
}

resource "aws_iam_access_key" "ses_smtp" {
  user = aws_iam_user.ses_smtp.name
}
