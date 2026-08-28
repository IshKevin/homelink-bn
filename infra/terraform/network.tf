# No NAT Gateway, no private subnets — both boxes sit on public IPs behind
# security groups, per docs/INFRASTRUCTURE.md §4 ("that one call avoids
# ~$35-45/mo that's easy to add by accident").

data "aws_vpc" "selected" {
  id      = var.vpc_id
  default = var.vpc_id == null ? true : null
}

data "aws_subnets" "public" {
  count = var.subnet_id == null ? 1 : 0

  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.selected.id]
  }

  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

locals {
  subnet_id = var.subnet_id != null ? var.subnet_id : data.aws_subnets.public[0].ids[0]
}

resource "aws_security_group" "app" {
  name        = "${local.name_prefix}-app"
  description = "App box: API + worker + Postgres + Redis (DB/cache stay container-local, not host-exposed)"
  vpc_id      = data.aws_vpc.selected.id

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP (redirected to HTTPS by the app/proxy)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  dynamic "ingress" {
    for_each = length(var.ssh_cidr_blocks) > 0 ? [1] : []
    content {
      description = "SSH (explicitly opted into via ssh_cidr_blocks)"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = var.ssh_cidr_blocks
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-app" }
}

resource "aws_security_group" "frontend" {
  name        = "${local.name_prefix}-frontend"
  description = "Frontend box: Next.js SSR"
  vpc_id      = data.aws_vpc.selected.id

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP (redirected to HTTPS by the app/proxy)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  dynamic "ingress" {
    for_each = length(var.ssh_cidr_blocks) > 0 ? [1] : []
    content {
      description = "SSH (explicitly opted into via ssh_cidr_blocks)"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = var.ssh_cidr_blocks
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-frontend" }
}

resource "aws_security_group" "jenkins" {
  name        = "${local.name_prefix}-jenkins"
  description = "Jenkins box: closed to the internet by default - reach it via SSM port-forwarding, or opt into direct HTTPS with jenkins_admin_cidr_blocks"
  vpc_id      = data.aws_vpc.selected.id

  dynamic "ingress" {
    for_each = length(var.jenkins_admin_cidr_blocks) > 0 ? [1] : []
    content {
      description = "Jenkins UI (explicitly opted into via jenkins_admin_cidr_blocks)"
      from_port   = 443
      to_port     = 443
      protocol    = "tcp"
      cidr_blocks = var.jenkins_admin_cidr_blocks
    }
  }

  dynamic "ingress" {
    for_each = length(var.jenkins_admin_cidr_blocks) > 0 ? [1] : []
    content {
      description = "HTTP (redirected to HTTPS)"
      from_port   = 80
      to_port     = 80
      protocol    = "tcp"
      cidr_blocks = var.jenkins_admin_cidr_blocks
    }
  }

  dynamic "ingress" {
    for_each = length(var.ssh_cidr_blocks) > 0 ? [1] : []
    content {
      description = "SSH (explicitly opted into via ssh_cidr_blocks)"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = var.ssh_cidr_blocks
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-jenkins" }
}
