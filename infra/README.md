# Infra

Terraform for [docs/INFRASTRUCTURE.md](../docs/INFRASTRUCTURE.md)'s **Tier A** ("two-box bootstrap") architecture, plus a third box for CI/CD: one Graviton EC2 box running this repo's `docker-compose.yml` (Postgres, Redis, API, worker) plus a self-signed-TLS Caddy proxy, a separate box for the frontend, a Jenkins box, an S3 bucket, SES sending identity, Cloudflare DNS, nightly EBS snapshots, and free-tier CloudWatch status-check alarms. No NAT Gateway, no managed DB/Redis — see the doc for why and for the trigger conditions to move to Tier B.

This repo (`homelink-bn`) is the **backend only**. The frontend box is provisioned, but its compose file/Caddyfile under [frontend/](./frontend/) are `.example` templates — there's no frontend Dockerfile in this repo to reference directly.

## Layout

```
infra/
  terraform/                     # all AWS + Cloudflare resources (app, frontend, and jenkins boxes)
  docker-compose.prod.yml        # app-box overlay: parameterizes POSTGRES_PASSWORD, adds Caddy
  Caddyfile                      # app-box reverse proxy (TLS termination -> api:3000)
  frontend/*.example             # starting point for the frontend box/repo once it exists
  scripts/ses-smtp-password.sh   # converts the SES IAM secret into an SMTP password
Jenkinsfile                      # backend build+deploy pipeline (repo root, so Jenkins finds it automatically)
```

## Provisioning

```bash
cd infra/terraform
terraform init
cp terraform.tfvars.example terraform.tfvars   # fill in domain_name, cloudflare_zone_id, alert_email
export TF_VAR_cloudflare_api_token="..."       # keep out of tfvars/git
terraform apply
```

### After `apply`

1. **SES SMTP password** — Terraform creates the SES SMTP IAM user and an `smtp_pass` SSM placeholder, but an IAM secret access key is not itself a valid SMTP password; convert it once:
   ```bash
   terraform output -raw ses_smtp_secret_access_key \
     | ../scripts/ses-smtp-password.sh eu-west-1 \
     | xargs -I{} aws ssm put-parameter --region eu-west-1 \
         --name "$(terraform output -raw ssm_parameter_prefix)/app/smtp_pass" \
         --type SecureString --overwrite --value {}
   ```
2. **SES production access** — new AWS accounts start in the SES sandbox (mail only to verified addresses). Request production access via AWS Support; Terraform/the SES API can't do this step.
3. **NCSA Data Controller registration** — required before handling real tenant data (docs/INFRASTRUCTURE.md §8). Not an infra step, but don't skip it.

### Deploying the app box

Boxes have no SSH port open by default — connect via SSM Session Manager:
```bash
aws ssm start-session --target "$(terraform output -raw app_instance_id)"
```
Then, on the box:
```bash
sudo su - ec2-user
git clone <this-repo-url> /opt/homelink && cd /opt/homelink
render-env.sh                                   # writes .env from SSM (installed by user-data)
export IMAGE_TAG=<git-sha-or-tag>                # whatever CI pushed to GHCR — see CI/CD below
docker compose -f docker-compose.yml -f infra/docker-compose.prod.yml --env-file .env pull migrate seed-admin seed-demo api worker
docker compose -f docker-compose.yml -f infra/docker-compose.prod.yml --env-file .env up -d
```
`render-env.sh` pulls every parameter under `/homelink/<environment>/app/` (including `POSTGRES_PASSWORD`, which `infra/docker-compose.prod.yml` needs — the base `docker-compose.yml` hardcodes it for local dev only — and `GHCR_REPOSITORY`/`GHCR_USERNAME`/`GHCR_TOKEN`) into `.env`, owned by `ec2-user` — no root needed anywhere in this flow (the instance role's credentials are available to any user via IMDS). It also runs `docker login ghcr.io` at the end using those GHCR_* values (skipped if `GHCR_TOKEN` is empty, i.e. the packages are public).

**Private repo:** `git pull` on the box needs read access. Add a deploy key (or a PAT-embedded remote URL) to `/opt/homelink/.git/config` once, manually — Terraform doesn't provision git credentials.

## CI/CD (Jenkins -> GHCR -> SSM deploy)

A third box runs Jenkins natively (not containerized — `docker build` runs directly against the host Docker daemon, no Docker-in-Docker). It has **no AWS access keys**: its own instance role is what lets it call `aws ssm send-command` to trigger a deploy, the same permission the GitHub-Actions version of this used to get via OIDC. The only credential Jenkins itself needs is a GitHub PAT, because GHCR auth is GitHub-side and has nothing to do with AWS identity.

**One-time Jenkins setup** (after `terraform apply`):
1. `aws ssm start-session --target "$(terraform output -raw jenkins_instance_id)"`, then `sudo cat /var/lib/jenkins/secrets/initialAdminPassword` and open the Jenkins UI (see "Reaching the Jenkins UI" below) to finish setup + install the suggested plugins.
2. **Manage Jenkins -> Credentials** -> add a "Username with password" credential, ID **`ghcr-token`**: username = your GitHub username, password = a GitHub PAT with `write:packages` (classic) or fine-grained `Packages: write`. This is what both Jenkinsfiles push with.
3. Create a **Pipeline** job pointed at this repo (branch source pointing at `Jenkinsfile` in the root) — it'll build, push to `ghcr.io/<owner>/<repo>`, and redeploy the app box on every run.
4. `/etc/homelink/deploy.env` (written by `user-data/jenkins.sh.tpl`) already has `AWS_REGION`/`APP_INSTANCE_ID`/`FRONTEND_INSTANCE_ID` baked in from the Terraform apply that created these boxes — the Jenkinsfiles source it directly, nothing to configure in Jenkins for that part.

**Reaching the Jenkins UI** — closed to the internet by default:
```bash
aws ssm start-session --target "$(terraform output -raw jenkins_instance_id)" \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["443"],"localPortNumber":["8443"]}'
# then open https://localhost:8443 (self-signed cert warning is expected)
```
Or set `jenkins_admin_cidr_blocks` to reach it directly over HTTPS at `jenkins_url` instead.

**GHCR package visibility** — GitHub Packages default to **private** once Jenkins pushes with a PAT. Either:
- Set `ghcr_token` (a GitHub PAT with `read:packages`, or fine-grained `Packages: read`) when running `terraform apply` — it's stored in SSM and each app/frontend box's `render-env.sh` uses it to `docker login` before pulling, or
- Make the package public in its GitHub settings (Package settings -> Change visibility) — then leave `ghcr_token` unset and the boxes pull with no auth at all.

The frontend repo (separate from this one) follows the same pattern once `github_frontend_repo` is set: copy [frontend/Jenkinsfile.example](./frontend/Jenkinsfile.example) into that repo as `Jenkinsfile`, and create a second pipeline job on the same Jenkins box pointed at it.

Every deploy runs a unique tag (the git SHA) — a bad deploy rolls back by re-running the pipeline against an older commit, or by manually `export IMAGE_TAG=<older-sha>` and re-running the `docker compose pull && up -d` sequence on the box.

### Deploying the frontend box

Same SSM Session Manager pattern (`frontend_instance_id`), `render-env.sh` writes `/opt/homelink-frontend/.env` from `/homelink/<environment>/frontend/*`. Bring your own frontend image/compose file, using [frontend/docker-compose.prod.yml.example](./frontend/docker-compose.prod.yml.example) as a starting point.

## Notes / deliberate omissions

- **No automatic `git clone`/`docker compose up` in user-data.** Terraform provisions infrastructure; deploying app code is a separate (CD) concern, matching docs/INFRASTRUCTURE.md §10's checklist where "launch the box" and "clone + compose up" are distinct steps.
- **TLS is self-signed at the origin**, terminated properly at Cloudflare's edge. Set Cloudflare's SSL/TLS mode to **Full** (not "Full (strict)", which requires a CA-signed origin cert) — see docs/INFRASTRUCTURE.md §4.
- **`minio`/`mailpit` are left running** on the app box even though production points `S3_ENDPOINT`/`SMTP_HOST` at real S3/SES instead — removing them cleanly via a compose overlay is fragile (Compose's profile+`depends_on` interaction) for a few tens of MB of idle RAM. Not worth the complexity at this scale.
- **`.rw` domain / AOS Kigali fallback** (docs/INFRASTRUCTURE.md §8) isn't provisioned here — reach for it only if one of the three documented triggers actually materializes.
