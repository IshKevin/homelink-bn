data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

resource "aws_instance" "app" {
  ami                         = data.aws_ssm_parameter.al2023_arm64.value
  instance_type               = var.app_instance_type
  subnet_id                   = local.subnet_id
  vpc_security_group_ids      = [aws_security_group.app.id]
  iam_instance_profile        = aws_iam_instance_profile.app.name
  associate_public_ip_address = true
  key_name                    = var.ssh_key_name

  root_block_device {
    volume_type = "gp3"
    volume_size = var.app_root_volume_gb
    tags        = merge(local.common_tags, { Name = "${local.name_prefix}-app-root", Backup = "true" })
  }

  metadata_options {
    http_tokens = "required" # IMDSv2 only
  }

  user_data = templatefile("${path.module}/user-data/app.sh.tpl", {
    ssm_prefix = local.ssm_prefix
    aws_region = var.aws_region
  })

  tags = { Name = "${local.name_prefix}-app", Backup = "true" }
}

resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"
  tags     = { Name = "${local.name_prefix}-app" }
}

resource "aws_instance" "frontend" {
  ami                         = data.aws_ssm_parameter.al2023_arm64.value
  instance_type               = var.frontend_instance_type
  subnet_id                   = local.subnet_id
  vpc_security_group_ids      = [aws_security_group.frontend.id]
  iam_instance_profile        = aws_iam_instance_profile.frontend.name
  associate_public_ip_address = true
  key_name                    = var.ssh_key_name

  root_block_device {
    volume_type = "gp3"
    volume_size = var.frontend_root_volume_gb
    tags        = merge(local.common_tags, { Name = "${local.name_prefix}-frontend-root", Backup = "true" })
  }

  metadata_options {
    http_tokens = "required" # IMDSv2 only
  }

  user_data = templatefile("${path.module}/user-data/frontend.sh.tpl", {
    ssm_prefix = local.ssm_prefix
    aws_region = var.aws_region
  })

  tags = { Name = "${local.name_prefix}-frontend", Backup = "true" }
}

resource "aws_eip" "frontend" {
  instance = aws_instance.frontend.id
  domain   = "vpc"
  tags     = { Name = "${local.name_prefix}-frontend" }
}

resource "aws_instance" "jenkins" {
  ami                         = data.aws_ssm_parameter.al2023_arm64.value
  instance_type               = var.jenkins_instance_type
  subnet_id                   = local.subnet_id
  vpc_security_group_ids      = [aws_security_group.jenkins.id]
  iam_instance_profile        = aws_iam_instance_profile.jenkins.name
  associate_public_ip_address = true
  key_name                    = var.ssh_key_name

  root_block_device {
    volume_type = "gp3"
    volume_size = var.jenkins_root_volume_gb
    tags        = merge(local.common_tags, { Name = "${local.name_prefix}-jenkins-root", Backup = "true" })
  }

  metadata_options {
    http_tokens = "required" # IMDSv2 only
  }

  user_data = templatefile("${path.module}/user-data/jenkins.sh.tpl", {
    aws_region           = var.aws_region
    app_instance_id      = aws_instance.app.id
    frontend_instance_id = aws_instance.frontend.id
  })

  tags = { Name = "${local.name_prefix}-jenkins", Backup = "true" }
}

# Only allocated when direct HTTPS access is opted into (jenkins_admin_cidr_blocks
# non-empty) — by default Jenkins is reached via SSM port-forwarding, which
# addresses the box by instance ID, not IP, so a *stable* address buys
# nothing and the auto-assigned public IP (still needed for outbound
# internet with no NAT Gateway) is enough on its own.
resource "aws_eip" "jenkins" {
  count    = length(var.jenkins_admin_cidr_blocks) > 0 ? 1 : 0
  instance = aws_instance.jenkins.id
  domain   = "vpc"
  tags     = { Name = "${local.name_prefix}-jenkins" }
}

locals {
  jenkins_public_ip = length(var.jenkins_admin_cidr_blocks) > 0 ? aws_eip.jenkins[0].public_ip : aws_instance.jenkins.public_ip
}
