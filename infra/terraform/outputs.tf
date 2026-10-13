output "app_public_ip" {
  description = "Elastic IP of the app box (API + worker + Postgres + Redis)."
  value       = aws_eip.app.public_ip
}

output "frontend_public_ip" {
  description = "Elastic IP of the frontend (SSR) box."
  value       = aws_eip.frontend.public_ip
}

output "app_instance_id" {
  description = "Connect via SSM Session Manager: aws ssm start-session --target <this>"
  value       = aws_instance.app.id
}

output "frontend_instance_id" {
  description = "Connect via SSM Session Manager: aws ssm start-session --target <this>"
  value       = aws_instance.frontend.id
}

output "s3_bucket_name" {
  value = aws_s3_bucket.app.bucket
}

output "ssm_parameter_prefix" {
  description = "Base path render-env.sh reads from (append /app or /frontend)."
  value       = local.ssm_prefix
}

output "ghcr_backend_repository" {
  description = "Where CI pushes the backend image: ghcr.io/<ghcr_username>/<repo>."
  # Recomputed rather than read from aws_ssm_parameter.app_ghcr_repository.value —
  # the AWS provider marks that attribute sensitive unconditionally regardless
  # of parameter type, which would force this whole output sensitive too.
  value = "ghcr.io/${local.ghcr_username}/${lower(split("/", var.github_backend_repo)[1])}"
}

output "ghcr_frontend_repository" {
  description = "Where CI pushes the frontend image, if github_frontend_repo is set."
  value       = var.github_frontend_repo != null ? "ghcr.io/${local.ghcr_username}/${lower(split("/", var.github_frontend_repo)[1])}" : null
}

output "jenkins_public_ip" {
  description = "Elastic (if jenkins_admin_cidr_blocks is set) or auto-assigned (otherwise) public IP of the Jenkins box. UI is closed to the internet either way unless jenkins_admin_cidr_blocks is set — see jenkins_url."
  value       = local.jenkins_public_ip
}

output "jenkins_instance_id" {
  description = "Connect via SSM Session Manager: aws ssm start-session --target <this>"
  value       = aws_instance.jenkins.id
}

output "jenkins_url" {
  description = "Only reachable if jenkins_admin_cidr_blocks is non-empty. Otherwise use SSM port-forwarding (see infra/README.md)."
  value = (
    length(var.jenkins_admin_cidr_blocks) == 0
    ? "https://${local.jenkins_public_ip} (self-signed cert; only reachable via SSM port-forwarding — see infra/README.md)"
    : "https://${local.jenkins_public_hostname} (real Let's Encrypt cert)"
  )
}

output "jenkins_github_webhook_payload_url" {
  description = "Only meaningful if jenkins_admin_cidr_blocks is non-empty. Add as a GitHub repo webhook (Settings -> Webhooks -> Add webhook): Payload URL = this, Content type = application/json, Secret = jenkins_github_webhook_secret, event = 'Just the push event'."
  value       = length(var.jenkins_admin_cidr_blocks) == 0 ? null : "https://${local.jenkins_public_hostname}/github-webhook/"
}

output "jenkins_github_webhook_secret" {
  description = "Shared secret for the GitHub webhook above — also configured into the Jenkins job so it validates incoming pushes."
  value       = random_password.jenkins_github_webhook_secret.result
  sensitive   = true
}

output "grafana_url" {
  description = "Only reachable if jenkins_admin_cidr_blocks is non-empty (Grafana shares the Jenkins box's public exposure). Real Let's Encrypt cert."
  value       = length(var.jenkins_admin_cidr_blocks) == 0 ? null : "https://${local.grafana_public_hostname}"
}

output "grafana_admin_password" {
  description = "Grafana admin login — username is 'admin'."
  value       = random_password.grafana_admin_password.result
  sensitive   = true
}

output "next_steps" {
  value = <<-EOT
    ${local.have_domain ? "" : "0. domain_name is unset — all Cloudflare DNS records were skipped; set domain_name and re-`apply` once you've registered one.\n    "}1. Verify the sending domain in the Resend account whose API key is smtp_password (Resend dashboard → Domains).
    2. Email is sent via ${var.smtp_host}:${var.smtp_port} — rotate the key by changing smtp_password and re-applying.
    3. If the GHCR packages are private, set ghcr_token (a GitHub PAT with read:packages) before/after
       apply so the app/frontend boxes can pull; leave it unset only if the packages are public.
    4. SSH-free box access: aws ssm start-session --target <app_instance_id | frontend_instance_id | jenkins_instance_id>
    5. On the app box: git clone this repo into /opt/homelink, run render-env.sh, export IMAGE_TAG, then
       docker compose -f docker-compose.yml -f infra/docker-compose.prod.yml --env-file .env up -d
    6. On the frontend box: deploy the frontend repo using infra/frontend/docker-compose.prod.yml.example
       as a starting point, after running render-env.sh there too.
    7. Set up Jenkins: get the initial admin password via SSM Session Manager
       (sudo cat /var/lib/jenkins/secrets/initialAdminPassword), install suggested plugins,
       add a GHCR PAT as credential ID "ghcr-token" (username+password), then create a
       pipeline job from this repo's Jenkinsfile — see infra/README.md's CI/CD section.
    8. Complete the NCSA Data Controller registration before handling real tenant data (docs/INFRASTRUCTURE.md §8).
  EOT
}
