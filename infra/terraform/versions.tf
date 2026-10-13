terraform {
  # 1.10+ for the S3 backend's native lockfile (no DynamoDB table needed).
  required_version = ">= 1.10.0"

  # Remote state, shared by everyone who runs terraform. The bucket is created
  # by hand, outside this config (versioned, encrypted, public access blocked)
  # — see infra/README.md. Every apply leaves a recoverable previous version.
  backend "s3" {
    bucket       = "homelink-production-tfstate-741368363892"
    key          = "homelink/production/terraform.tfstate"
    region       = "eu-west-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
