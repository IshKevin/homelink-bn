variable "project" {
  description = "Short project name used as a resource-naming prefix."
  type        = string
  default     = "homelink"
}

variable "environment" {
  description = "Deployment environment name (used in tags, SSM paths, resource names)."
  type        = string
  default     = "production"
}

variable "aws_region" {
  description = "AWS region to deploy into. Tier A pricing in docs/INFRASTRUCTURE.md is for eu-west-1."
  type        = string
  default     = "eu-west-1"
}

variable "domain_name" {
  description = "Registered domain (e.g. \"homelink.com\") used for SES sending identity and, when enable_cloudflare_dns is true, DNS records — see docs/INFRASTRUCTURE.md §5/§8. Optional: leave unset (null) to provision everything domain-independent (all three boxes, S3, GHCR wiring, Jenkins) now and add SES + DNS later — set it and re-run `terraform apply` once you've registered a domain, nothing else needs to change. While unset, SES and all Cloudflare DNS records are skipped, and app/frontend URLs fall back to the boxes' Elastic IPs."
  type        = string
  default     = null
}

# ---------------------------------------------------------------------------
# Compute
# ---------------------------------------------------------------------------

variable "app_instance_type" {
  description = "Instance type for the app box (API + worker + Postgres + Redis via docker compose)."
  type        = string
  default     = "t4g.medium"
}

variable "frontend_instance_type" {
  description = "Instance type for the frontend (SSR) box."
  type        = string
  default     = "t4g.small"
}

variable "app_root_volume_gb" {
  description = "Root EBS (gp3) volume size for the app box."
  type        = number
  default     = 30
}

variable "frontend_root_volume_gb" {
  description = "Root EBS (gp3) volume size for the frontend box."
  type        = number
  default     = 10
}

variable "vpc_id" {
  description = "VPC to deploy into. Leave null to use the account's default VPC (matches docs/INFRASTRUCTURE.md §4 — public IPs, no NAT Gateway)."
  type        = string
  default     = null
}

variable "subnet_id" {
  description = "Public subnet to launch both boxes into. Leave null to pick the default VPC's first default subnet."
  type        = string
  default     = null
}

variable "ssh_cidr_blocks" {
  description = "CIDR blocks allowed to reach port 22. Leave empty (default) to disable SSH entirely and rely on SSM Session Manager, per docs/INFRASTRUCTURE.md §4 (only 443/80 open to the internet)."
  type        = list(string)
  default     = []
}

variable "ssh_key_name" {
  description = "Existing EC2 key pair name for SSH access. Only used if ssh_cidr_blocks is non-empty. Leave null to launch without a key pair (Session Manager only)."
  type        = string
  default     = null
}

# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

variable "s3_bucket_name" {
  description = "Name for the application S3 bucket (property photos, generated PDFs, identity documents). Leave null to auto-generate a globally-unique name."
  type        = string
  default     = null
}

variable "backup_retention_count" {
  description = "Number of nightly EBS snapshots to retain per volume (DLM lifecycle policy)."
  type        = number
  default     = 7
}

# ---------------------------------------------------------------------------
# DNS / SES (Cloudflare, per docs/INFRASTRUCTURE.md §5)
# ---------------------------------------------------------------------------

variable "enable_cloudflare_dns" {
  description = "Whether to manage DNS records (apex/api/www + SES verification) in Cloudflare. Requires cloudflare_api_token and cloudflare_zone_id. Set false to manage DNS manually and just consume the *_public_ip outputs."
  type        = bool
  default     = true
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token with DNS edit permission on the zone. Required when enable_cloudflare_dns is true. Prefer exporting as TF_VAR_cloudflare_api_token rather than committing it."
  type        = string
  default     = null
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for domain_name. Required when enable_cloudflare_dns is true."
  type        = string
  default     = null
}

variable "cloudflare_proxied" {
  description = "Whether app/frontend DNS records are proxied through Cloudflare's edge (orange-cloud: free TLS + caching). SES verification records are never proxied regardless of this setting."
  type        = bool
  default     = true
}

variable "api_subdomain" {
  description = "Subdomain the API is served from (e.g. \"api\" -> api.<domain_name>)."
  type        = string
  default     = "api"
}

# ---------------------------------------------------------------------------
# Observability
# ---------------------------------------------------------------------------

variable "alert_email" {
  description = "Email address subscribed to CloudWatch alarm notifications (EC2 status-check failures). Leave empty to skip creating a subscription."
  type        = string
  default     = ""
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention, matching docs/INFRASTRUCTURE.md §6 (7-day retention)."
  type        = number
  default     = 7
}

# ---------------------------------------------------------------------------
# CI/CD (Jenkins -> GHCR -> SSM deploy)
# ---------------------------------------------------------------------------

variable "github_backend_repo" {
  description = "\"owner/repo\" for this backend repo — used only to compute the GHCR image path (ghcr.io/<this>). No longer used for any OIDC trust scoping now that CI is Jenkins, not GitHub Actions."
  type        = string
  default     = "IshKevin/homelink-bn"
}

variable "github_frontend_repo" {
  description = "\"owner/repo\" for the separate frontend repo, if any — used only to compute its GHCR image path. Leave null to skip the frontend GHCR parameters (the frontend box can still be deployed to manually)."
  type        = string
  default     = null
}

variable "jenkins_instance_type" {
  description = "Instance type for the Jenkins box (runs the Jenkins controller + builds Docker images directly on the host, no DinD)."
  type        = string
  default     = "t4g.medium"
}

variable "jenkins_root_volume_gb" {
  description = "Root EBS (gp3) volume size for the Jenkins box — holds JENKINS_HOME (job history, plugins) and the local Docker image cache."
  type        = number
  default     = 30
}

variable "jenkins_admin_cidr_blocks" {
  description = "CIDR blocks allowed to reach the Jenkins UI on 443. Leave empty (default) to keep it closed to the internet entirely — access it via `aws ssm start-session ... --document-name AWS-StartPortForwardingSession` instead."
  type        = list(string)
  default     = []
}

variable "jenkins_subdomain" {
  description = "Subdomain Jenkins is served from when jenkins_admin_cidr_blocks is non-empty and enable_cloudflare_dns is true (e.g. \"jenkins\" -> jenkins.<domain_name>)."
  type        = string
  default     = "jenkins"
}

variable "ghcr_username" {
  description = "GitHub user/org whose GHCR packages the boxes pull from. Leave null to default to the owner segment of github_backend_repo."
  type        = string
  default     = null
}

variable "ghcr_token" {
  description = "GitHub PAT (classic: read:packages scope; fine-grained: Packages: read) the boxes use to `docker login ghcr.io` and pull images. Leave null if the GHCR packages are public — the boxes then pull without authenticating at all."
  type        = string
  default     = null
  sensitive   = true
}
