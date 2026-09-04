# Infrastructure

This document is the reference a DevOps engineer needs to stand up and operate HomeLink's production environment on AWS. It describes the real shape of the workload (from this repo's `docker-compose.yml` and `Dockerfile`, not a generic stack guess), two deployment architectures at different growth stages, the specific AWS resources each one needs, and the operational decisions already baked into those choices.

It is a companion to the main [README](../README.md) (application/dev setup) and [docs/DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) (data model) — this file is infra only.

> Costs below are estimates for `eu-west-1` (Ireland), priced August 2026, in USD. Verify current pricing at [calculator.aws](https://calculator.aws) before committing budget.

## 1. What's actually being hosted

| Component | Nature | Notes |
|---|---|---|
| Frontend | Server-rendered (Next.js-style) | Needs its own always-on Node process — not a static bucket |
| API | Node/Express (`Dockerfile`, `npm start`) | Runs headless Chromium (Puppeteer) for invoice/lease PDFs directly on the request path (`pdf.service.ts` is called from payment and lease controllers) — sized for Chromium, not a bare Node process |
| Worker | BullMQ job runner (`npm run start:worker`) | Invoice generation, late-payment flagging, rent reminders — off the request path |
| Database | PostgreSQL 16 via Drizzle ORM | See `docker-compose.yml` service `postgres` |
| Queue / cache | Redis 7 (ioredis + BullMQ) | See `docker-compose.yml` service `redis` |
| File storage | S3-compatible object storage | Property photos, generated invoice/lease PDFs, identity documents. `minio` locally, real S3 in production |
| Email | SMTP | `mailpit` locally, swaps to Amazon SES in production |
| Payments | External mobile money APIs (MTN/Airtel MoMo) | No AWS spend of their own; HomeLink calls out, it isn't a licensed PSP itself |
| Domain | Not yet registered | Priced in §6 |

All three application images (`node:22-alpine` per the `Dockerfile`) plus `postgres:16` and `redis:7` ship native **arm64** builds — this is what makes Graviton viable with zero compatibility cost (see §7).

## 2. Two deployment tiers

Same workload, two architectures. Start on the left; move right once real tenants depend on uptime.

### Tier A — Two-box bootstrap, Graviton (start here)

One `t4g.medium` box running this repo's `docker-compose.yml` (Postgres, Redis, API, worker) via `docker compose up -d`, plus a separate `t4g.small` box for the SSR frontend so it can restart/scale independently of the database box.

| Resource | Spec | Est. $/mo |
|---|---|---|
| EC2 — app box | t4g.medium, 2 vCPU / 4 GB, arm64 — API + worker + Postgres + Redis (4 GB gives Chromium room alongside the DB) | $24.31 |
| EC2 — frontend box | t4g.small, 2 vCPU / 2 GB, arm64 — Next.js SSR | $12.12 |
| EBS gp3 | 30 GB (app/DB) + 10 GB (frontend) | $3.71 |
| S3 | ~20 GB storage + requests | $1.50 |
| Data transfer out | ~15 GB/mo (reduced by Cloudflare caching) | $1.10 |
| Amazon SES | Transactional email, low volume | $0.50 |
| CloudWatch | 7-day log retention, free status-check alarms only | $1.00 |
| Snapshots | Nightly EBS snapshot, both boxes | $1.20 |
| DNS | Cloudflare free plan | $0.00 |
| Domain | .com, amortized ($13/yr) | $1.10 |
| **Total** | | **~$47/mo** |

### Tier B — Managed & split out (grow into this)

Frontend, API, and worker as separate ECS Fargate services; database and Redis on managed AWS services; ALB in front. No single box to lose sleep over.

| Resource | Spec | Est. $/mo |
|---|---|---|
| Fargate — frontend | 0.5 vCPU / 1 GB — SSR rendering | $20.66 |
| Fargate — API | 1 vCPU / 2 GB — sized for Puppeteer PDF rendering on the request path | $41.32 |
| Fargate — worker | 0.5 vCPU / 1 GB | $20.66 |
| RDS PostgreSQL | db.t4g.micro, Single-AZ + 20 GB gp3 | $16.17 |
| ElastiCache Redis | cache.t4g.micro, single node, no replica | $13.14 |
| Application Load Balancer | Base + LCU, routes both frontend and API | $29.00 |
| S3 | ~20 GB + requests | $1.50 |
| Data transfer out | | $1.50 |
| Amazon SES | | $0.50 |
| CloudWatch + ECR | | $3.50 |
| DNS | Cloudflare free plan | $0.00 |
| Domain | amortized | $1.10 |
| **Total** | | **~$149/mo** |

Moving from A to B is roughly a **3.2×** cost step, mainly the ALB and the loss of bin-packing everything onto one box. Don't move early — see §7 for the actual trigger conditions.

## 3. Full monthly line-item comparison

| Service | Bootstrap | Managed | Rate basis |
|---|---:|---:|---|
| Compute — backend | $24.31 | $61.98 | t4g.medium / Fargate API+worker |
| Compute — frontend | $12.12 | $20.66 | t4g.small / Fargate SSR task |
| Database | included | $16.17 | db.t4g.micro + 20 GB |
| Redis / queue | included | $13.14 | cache.t4g.micro |
| Load balancer | — | $29.00 | Bootstrap uses public IPs instead |
| Block storage | $3.71 | included above | gp3, 30+10 GB / 20 GB |
| Object storage (S3) | $1.50 | $1.50 | ~20 GB + requests |
| Data transfer out | $1.10 | $1.50 | ~15 GB/mo, cached at Cloudflare |
| Email (SES) | $0.50 | $0.50 | low volume |
| Logs / registry | $1.00 | $3.50 | CloudWatch 7-day retention (+ECR) |
| Backups | $1.20 | included | EBS snapshots / RDS auto backup |
| DNS | $0.00 | $0.00 | Cloudflare free plan |
| Domain (amortized) | $1.10 | $1.10 | $13/yr ÷ 12 |
| **Total** | **~$46.54** | **~$149.05** | |

## 4. Networking & security

- **No NAT Gateway in either tier.** Every EC2/Fargate task sits on a public IP behind security groups instead of a private subnet + NAT Gateway. That one call avoids ~$35–45/mo that's easy to add by accident — revisit only if compliance later requires it.
- Security groups: only 443 (and 80→443 redirect) open to the internet; DB/Redis ports bound to the app box's own security group (mirrors `docker-compose.yml`'s `127.0.0.1:*` port bindings locally).
- TLS is free either way — AWS Certificate Manager (Tier B, terminated at the ALB) or Cloudflare edge certificates (Tier A, terminated at Cloudflare, origin can stay HTTP or self-signed behind Cloudflare's Full-strict mode).
- Secrets via **SSM Parameter Store**, not Secrets Manager — standard parameters are free, Secrets Manager charges $0.40/secret/month, which adds up across `JWT_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL`, and S3/SMTP credentials for no benefit at this scale. Inject as environment variables at container start, same shape as this repo's `env_file: .env`.
- **CORS is locked to the actual frontend origin**, not wildcard-open. `CORS_ALLOWED_ORIGINS` (SSM `<prefix>/app/cors_allowed_origins`) is set by Terraform to `https://${local.frontend_public_hostname}` — if it's ever empty in production, `app.ts` fails closed (no origins allowed) rather than falling back to allowing any site's JS to call the API.

## 5. DNS & CDN

Register the domain wherever's cheapest (check Cloudflare's own registrar, close to wholesale), then point nameservers at **Cloudflare (free plan)** instead of a Route 53 hosted zone:

- Free DNS, replacing Route 53's $0.50/mo hosted zone.
- Free edge caching for the frontend's static assets, taking load off the origin box.
- Free SSL at the edge.

| Item | Cost |
|---|---|
| `.com` registration | $13/yr (~$1.10/mo amortized) |
| DNS hosting (Cloudflare) | $0/mo |
| `.rw` (if needed for the Rwandan market) | Not sold by Route 53 or Cloudflare — register via a local registrar (e.g. RICTA), ~$20–35/yr, then point nameservers at Cloudflare or Route 53 |

## 6. Observability & backups

- **CloudWatch**: 7-day log retention, free EC2 status-check alarms for "is the box alive" on all three boxes (Tier A) or standard ECS/ALB metrics (Tier B), plus an alarm on the payout dead-letter queue (`infra/terraform/monitoring.tf`'s `payout_events_dlq_not_empty`) — a landlord disbursement that failed 5 times (see §9's redrive policy) is a materially different, higher-priority signal than "is the box alive," since it means a real rent payment silently never reached the landlord. All alarms notify the same SNS topic/email (`var.alert_email`); an unconfirmed SNS email subscription delivers nothing silently, so confirm it after every fresh `terraform apply` that sets one.
- **Backups**: nightly EBS snapshot of both boxes (Tier A) or RDS automated backups (Tier B, included in the RDS cost above).
- **ECR**: container registry for the Docker images built from this repo's `Dockerfile` (Tier B only — Tier A pulls/builds directly on the box via `docker compose`).
- **A fuller Prometheus/Grafana/Alertmanager stack also runs on the Jenkins box**, scraping all three boxes and self-monitoring Jenkins — this section doesn't yet describe it in detail (dashboards, scrape targets, alert rules). See `infra/terraform/user-data/jenkins.sh.tpl` directly until this gets written up properly; tracked in [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## 7. Decisions baked into these numbers

- **Graviton (arm64) everywhere it's an option.** t4g over t3 on EC2, t4g.micro for RDS/ElastiCache. Every base image this repo uses (`postgres:16`, `redis:7`, `node:22-alpine`) ships an arm64 build, so this is a ~20% discount with no compatibility trade-off.
- **Frontend on its own box/task, not folded into the app server.** Keeps Postgres/Redis/Chromium memory pressure off the SSR process and vice versa, and lets you redeploy or resize the frontend independently of the database.
- **API sized for Chromium, not a bare Node process.** PDF generation is called directly from payment and lease controllers, not just the worker — so the API container needs headroom for headless Chrome, same as the worker.
- **Single-AZ, no read replica, no auto-scaling.** Correct for MVP traffic. The moment you need Multi-AZ RDS, 2+ API tasks, or a CDN in front of S3, budget roughly **1.8–2.5×** the Tier B number.
- **AWS Free Tier isn't counted.** A new account gets 12 months of RDS/EC2 micro-instance hours, but the bootstrap boxes need more than micro-size RAM for Postgres + Redis + Chromium (and separately, SSR) together, so it wouldn't meaningfully change this budget.
- **1-yr Compute Savings Plan is a later lever, not a day-one one.** ~25–30% off compute once you're confident you'll run this for a year — it's a commitment, skip it while still validating.

### Trigger conditions for moving Tier A → Tier B

Move when any of these are true, not on a fixed timeline:

- A single box restart/crash becomes an unacceptable outage (real tenants depending on uptime).
- API or worker CPU/memory is consistently saturated under real traffic.
- You need to deploy the API and frontend independently, multiple times a day, without a shared-box restart risk.

## 8. Data residency & compliance — Rwanda's Law No. 058/2021

> Not legal advice. Penalties run up to RWF 5,000,000 or 1% of global turnover — get a Rwanda-licensed data protection lawyer or the DPO to sign off before committing to an architecture.

The law applies to HomeLink regardless of where servers sit — it covers processing personal data of people located in Rwanda, so hosting in Ireland doesn't opt out of it, it changes which obligation is being satisfied.

**Applies regardless of hosting:**
- Register as a Data Controller with NCSA's Data Protection & Privacy Office (free, ~30 working days).
- Appoint a local representative if HomeLink's operating entity has no Rwanda presence.
- Designate a DPO (a role, not necessarily a hire at this size).
- Keep processing records, valid consent, and a breach-notification process.

**Specific to hosting on AWS:**
- The law defaults to storing personal data in Rwanda but permits cross-border transfer if the destination offers adequate protection *and* the transfer is disclosed on the NCSA registration.
- `eu-west-1` sits inside the EU under GDPR — a strong case for "adequate protection." Disclose Ireland as the processing location and keep AWS's GDPR-aligned Data Processing Addendum on file as the safeguard document.

**In-country fallback — AOS Ltd (Rwanda's National Data Center, Kigali):** a Korea Telecom-affiliated IaaS/colocation/DR provider already positioning itself as compliant with this law. Reach for it, don't default to it — three triggers actually justify it:

1. NCSA declines or hesitates on the cross-border disclosure for a specific data category.
2. A future National Bank of Rwanda rule requires transaction records tied to Rwandan mobile-money rails to be processed in-country. **This is more of a live risk than it used to be** — see §9's flag on automated disbursement, which now briefly routes tenant rent through HomeLink's own MTN merchant account before forwarding it to the landlord, rather than HomeLink only ever calling the MoMo API on someone else's behalf.
3. As a low-cost hedge: a nightly encrypted export of Rwanda-resident personal data mirrored to AOS's Kigali facility — a documented in-country copy without moving production off AWS.

AOS pricing is quote-based (enterprise/B2B), not self-serve — budget for it only once a trigger materializes. Absent a trigger, the AWS `eu-west-1` architecture above, registered and disclosed properly, is the default.

## 9. Payments: MTN MoMo collection + automated landlord disbursement

> **Compliance flag, not legal advice — get this in front of legal/NCSA before real money flows through it.** See below.

**Architecture**: a tenant pays rent via MTN MoMo Collections ("Request to Pay" — `src/services/payments/mtnMomoProvider.ts`). MTN's callback (`POST /webhooks/mtn/collection/:referenceId`) marks the payment successful, which publishes a `payment.succeeded` event to a custom **EventBridge** bus (`infra/terraform/payments.tf`). An EventBridge rule forwards it to an **SQS** queue; the app's existing BullMQ worker polls that queue every minute (`src/jobs/handlers/processPayoutEvents.job.ts`) and disburses the rent to the landlord's own MTN MoMo number via the Disbursements API (`src/modules/payments/payouts.service.ts`) — no admin approval step, no manual payout run.

EventBridge → SQS rather than → Lambda is deliberate: the app already runs a worker process for scheduled jobs, so polling SQS from it reuses that model instead of adding a separate Lambda deployment for one consumer.

**Webhooks aren't trusted directly.** MTN's callback payload isn't signed, and the reference ID isn't a secret (the paying tenant sees their own `providerReference` in the `pay` response) — so `mtnCollectionCallbackHandler`/`mtnDisbursementCallbackHandler` only use the callback as a trigger to call MTN's own status endpoint (`getRequestToPayStatus`/`getTransferStatus`) with this app's own credentials, and that response — not the incoming body — decides the outcome. Without this, anyone could POST a fake `"SUCCESSFUL"` to their own callback URL and get a free payment plus an automatic real payout, before ever actually paying.

**A payout can be `held`, not just `pending`/`success`/`failed`.** If the landlord's account is deactivated (an admin locked it — see §10's provisioning checklist and the Admin API's `PATCH /admin/users/:id/status`) at the moment their tenant's payment succeeds, `initiateDisbursement` deliberately withholds the payout instead of sending it, and notifies every admin. The point is that an admin lock should have teeth over money movement, not just app access — a deactivated landlord shouldn't keep automatically receiving rent. The held payout auto-releases (via `releaseHeldPayouts`) the instant the account is reactivated, with no separate manual "release funds" step.

**The compliance flag**: MTN has no tenant-to-landlord routing — money cannot move directly between their MoMo accounts. It **must** land in HomeLink's own MTN merchant account first, then get forwarded out. That's true even though the forwarding is instant and fully automated with no human touching it. Rwanda's regulatory treatment of a platform that (even momentarily, even automatically) holds client funds before forwarding them commonly triggers payment-service-provider (PSP) licensing requirements with the National Bank of Rwanda — a different regime than the NCSA data-protection registration in §8. Before this handles real tenant money:

1. Confirm with a Rwanda-licensed fintech/payments lawyer whether this flow requires PSP licensing, an exemption, or a specific corporate structure (e.g. acting as a disclosed agent/facilitator rather than a principal).
2. If licensing is required, budget the timeline for it — this is not a fast process, and running the automated pipeline against real money before resolving it is a real regulatory exposure, not just a hypothetical one.
3. In the meantime, this can run safely in MTN's **sandbox** environment (the default — see `MTN_MOMO_TARGET_ENVIRONMENT`) with no real money involved, for development/demo purposes.

**Configuration** — all via SSM (`infra/terraform/ssm.tf`), consistent with this doc's existing "secrets via SSM, not Secrets Manager" decision (§4):
- `mtn_momo_collection_*` / `mtn_momo_disbursement_*` — separate MTN MoMo product subscriptions/credentials (Collections charges tenants, Disbursements pays landlords). Both default to an "unset" sentinel; the app falls back to mock providers for either one independently until real credentials are supplied (`terraform.tfvars`, or `aws ssm put-parameter --overwrite` directly, same as `ghcr_token`/`smtp_pass`).
- `eventbridge_bus_name` / `payout_events_queue_url` — always set by Terraform; no manual step needed for the event pipeline itself, only for the MTN credentials.
- A landlord sets their own payout number via `PATCH /users/me` (`payoutMomoNumber`) — separate from `leases.momoNumber`, which is the tenant's number used to *collect* rent.

## 10. Provisioning checklist (Tier A)

1. Register domain; point nameservers at Cloudflare; add DNS records once the app box has a static IP (Elastic IP).
2. Launch `t4g.medium` (app) and `t4g.small` (frontend) EC2 instances, Amazon Linux or Ubuntu ARM AMI, Docker + Docker Compose installed.
3. Attach security groups: app box exposes 443 only (Chromium/API/worker behind it); frontend box exposes 443 only; DB/Redis stay bound to localhost per `docker-compose.yml`.
4. Store `JWT_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL`, S3 and SMTP credentials in SSM Parameter Store; populate `.env` on the box at deploy time (mirrors `.env.example` in repo root).
5. `git clone` + `docker compose up -d` on the app box (runs `migrate` → `seed-admin`/`seed-demo` → `api`/`worker` per the compose file's `depends_on` chain); deploy the frontend build to its own box separately.
6. Point `S3_ENDPOINT`/`S3_BUCKET` at a real S3 bucket (replacing local `minio`), `SMTP_*` at Amazon SES (replacing local `mailpit`).
7. Set up nightly EBS snapshots and CloudWatch status-check alarms.
8. Complete the NCSA Data Controller registration (§8) before handling real tenant data.
