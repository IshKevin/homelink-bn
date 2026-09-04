# HomeLink Backend

HomeLink is a property rental management platform connecting **tenants**, **property owners**, **agents**, and **administrators**. This repository is the REST API and background-job worker that power it: accounts, property listings, leases, rent payments, maintenance, notifications, financial dashboards, reports, and platform administration.

## Tech stack

| Concern | Choice |
|---|---|
| Runtime / language | Node.js, TypeScript |
| HTTP framework | Express 5 |
| Database | PostgreSQL via Drizzle ORM |
| Background jobs | BullMQ + Redis |
| Auth | JWT (access + rotating refresh tokens), bcrypt password hashing |
| Validation | Zod |
| File storage | S3-compatible object storage (MinIO locally) |
| Email | Nodemailer (Mailpit locally) |
| PDF / Excel generation | Puppeteer / ExcelJS |
| API docs | OpenAPI via `swagger-jsdoc` + Swagger UI |
| Testing | Jest + Supertest, real Postgres per test run |

## Project structure

```
src/
  app.ts                  Express app: middleware, routes, error handling
  server.ts                HTTP server entrypoint (npm run dev / start)
  worker.ts                Background job worker entrypoint (npm run worker)
  common/
    errors/AppError.ts      Typed application error + HTTP status mapping
    middlewares/            authenticate, authorize (RBAC), validate (zod), rateLimiter, error handler
    utils/                  jwt, password hashing, pagination, response envelope
  config/                  env, logger (pino), swagger spec
  database/
    index.ts                Drizzle client
    schema/                  one file per domain (users, properties, leases, payments, maintenance, notifications, audit, settings)
  modules/                 one folder per feature, each with:
    <name>.routes.ts          Express router + OpenAPI JSDoc
    <name>.controller.ts      thin HTTP handlers
    <name>.service.ts         business logic + DB queries
    <name>.validation.ts      Zod request schemas
    __tests__/<name>.test.ts  Supertest integration tests
  services/                cross-cutting services: email, notifications, audit log, storage (S3), PDF, Excel, mock payment providers
  jobs/                    BullMQ queue, scheduler, and handlers (invoice generation, late-payment flagging, rent reminders)
routes/
  index.ts                 mounts every module's router under /api/v1
```

Every module follows the same shape, so once you've read one (`src/modules/properties` is a good example) the rest read the same way.

## Getting started

### Prerequisites

- Node.js 20+
- Docker (for Postgres, Redis, MinIO, Mailpit) — or point the env vars at your own instances

### 1. Start infrastructure

```bash
docker compose -f docker/docker-compose.yml up -d postgres redis minio mailpit
```

This starts Postgres (`5432`), Redis (`6379`), MinIO (`9000` API / `9001` console), and Mailpit (`8025` UI / `1025` SMTP).

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `JWT_SECRET`, `JWT_REFRESH_SECRET`, and your S3 credentials (MinIO defaults are `minio` / `minio123` if you're using the bundled compose service).

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Signing secrets for access/refresh tokens |
| `JWT_ACCESS_EXPIRY`, `JWT_REFRESH_EXPIRY` | Token lifetimes (e.g. `15m`, `30d`) |
| `BCRYPT_SALT_ROUNDS` | Password hashing cost |
| `REDIS_URL` | BullMQ connection |
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION` | Object storage for property images, lease PDFs, identity documents, receipts |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Outbound transactional email |
| `CORS_ALLOWED_ORIGINS` | Comma-separated frontend origin(s) allowed to call the API cross-origin. Empty in production fails closed (no origins allowed), not open — see `src/app.ts` |
| `MTN_MOMO_BASE_URL`, `MTN_MOMO_TARGET_ENVIRONMENT`, `MTN_MOMO_CALLBACK_BASE_URL`, `MTN_MOMO_CURRENCY` | Shared MTN MoMo Open API config (sandbox by default) |
| `MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY`/`_API_USER`/`_API_KEY` | Collections product credentials (charges tenants) — falls back to a mock provider if any are unset |
| `MTN_MOMO_DISBURSEMENT_SUBSCRIPTION_KEY`/`_API_USER`/`_API_KEY` | Disbursements product credentials (pays landlords) — same mock fallback |
| `EVENTBRIDGE_BUS_NAME`, `PAYOUT_EVENTS_QUEUE_URL` | AWS EventBridge/SQS wiring for the automated payment→disbursement pipeline — no-ops (logs a warning) if unset, so this is optional for local dev |

### 3. Install dependencies and set up the database

```bash
npm install
npm run db:generate   # generate SQL migrations from src/database/schema
npm run db:migrate     # apply them
```

### 4. Run it

```bash
npm run dev        # API server with hot reload, http://localhost:3000
npm run worker      # background job worker (invoices, late-payment flags, rent reminders)
```

API docs (Swagger UI): **http://localhost:3000/api-docs**
Raw OpenAPI spec: **http://localhost:3000/api-docs.json**
Health check: **http://localhost:3000/api/v1/health**

### Production

Deployed on AWS (see [infra/README.md](infra/README.md) and [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md)), not a static host — the actual hostname depends on the current Elastic IP (or a real domain, once one's registered) and can change on infra changes, so there's no fixed URL to hardcode here. Get the current one from SSM (the same value Caddy uses to request its TLS cert):
```bash
cd infra/terraform
aws ssm get-parameter --name "$(terraform output -raw ssm_parameter_prefix)/app/app_url" --query Parameter.Value --output text
```
Swagger UI and the health check are then at `<that URL>/api-docs` and `<that URL>/health` respectively.

## Available scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the API with hot reload |
| `npm run worker` | Start the background job worker with hot reload |
| `npm run build` | Type-check and compile to `dist/` |
| `npm start` / `npm run start:worker` | Run the compiled server/worker (`dist/`) |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle Kit migration workflow |
| `npm test` / `npm run test:watch` | Run the Jest integration suite against a real Postgres database |
| `npm run lint` | ESLint (`eslint.config.js`) |

## Testing

Tests are full integration tests: each spins up requests through the real Express app (`supertest`) against a real Postgres database, truncated between tests.

```bash
npm test
```

Configuration for the test run comes from `.env.test` (already present in this repo, pointing at a disposable `homelink_test` database — adjust `DATABASE_URL` there if your local Postgres uses different credentials or a different host/port).

`jest globalSetup` runs `drizzle-kit push --force` against `DATABASE_URL` from `.env.test` before the suite starts, so the schema is always current — no manual migration step needed for tests. External services (email, S3, PDF rendering) are mocked per test file with `jest.mock(...)`; the mocked payment providers (`src/services/payments/mockProviders.ts`) run for real since they're already deterministic and side-effect-free.

## API reference

Full request/response schemas are in Swagger UI (`/api-docs`) — generated from JSDoc comments on every route. The table below is a map of what exists, organized by module, with the roles allowed to call each endpoint (`tenant`, `owner`, `agent`, `admin`; unmarked = any authenticated user, scoped to their own data).

### Auth — `/api/v1/auth` (public)
`POST /register` · `POST /login` · `POST /refresh` · `POST /logout` · `POST /forgot-password` · `POST /reset-password`

### Users — `/api/v1/users`
`GET /me` · `PATCH /me` · `POST /me/verify-identity` (upload document) · `GET /me/verify-identity`

### Properties — `/api/v1/properties`
| Endpoint | Roles |
|---|---|
| `POST /` | owner, agent, admin |
| `GET /`, `GET /:id` | any (tenants only see approved & active listings) |
| `PATCH /:id` | owner (own), agent (assigned), admin |
| `POST /:id/images`, `DELETE /:id/images/:imageId` | owner, agent, admin |
| `PUT /:id/document`, `GET /:id/document`, `DELETE /:id/document` | owner (own), agent (assigned), house_manager (managed owner), admin — this is a legal ownership document (e.g. title deed), not marketplace data, so it's scoped the same for reads and writes |
| `POST /:id/units`, `PATCH /:id/units/:unitId` | owner, agent, house_manager, admin |
| `GET /:id/units` | any (same visibility rule as `GET /:id` — tenants only see approved & active listings) |
| `PATCH /:id/approve`, `PATCH /:id/reject` | admin |

`GET /` accepts an `approvalStatus` filter (`pending`/`approved`/`rejected`) alongside `status`/`type`/`category`/`city`/`minRent`/`maxRent`/`ownerId` — mainly useful for admins finding listings awaiting review, since other roles are already scoped to their own/approved properties regardless.

Every property gets one default unit automatically on creation (`title`/`bedrooms`/`bathrooms`/`rentAmount` copied over) — additional units can be added for multi-unit buildings. `GET /:id` includes computed `totalUnits`/`occupiedUnits`. `properties.status` is a roll-up: `available` while at least one unit is free, `occupied` once every unit is leased.

### Leases — `/api/v1/leases`
| Endpoint | Roles |
|---|---|
| `POST /` | owner, admin |
| `GET /`, `GET /:id`, `GET /:id/document` | any (scoped to the lease's parties) |
| `POST /:id/sign` | tenant, owner |
| `POST /:id/renewal-requests`, `POST /:id/termination-requests` | tenant, owner |
| `GET /:id/change-requests` | any (scoped) |
| `PATCH /change-requests/:id/approve`, `PATCH /change-requests/:id/reject` | owner, admin |
| `POST /:id/move-requests`, `GET /:id/move-requests` | tenant (create) / any (list) |
| `PATCH /move-requests/:id/checklist` | tenant, owner |
| `PATCH /move-requests/:id/inspect` | owner, admin |

`POST /` requires a `unitId` for a specific unit on the property (409 if that unit isn't available — a property can have several concurrent leases, one per unit). Signing a lease with both parties activates it, flips that unit to `occupied` (rolling the property's status up accordingly), generates and stores a lease PDF, and seeds a move-in checklist automatically. Leases also carry `deposit`, `momoNumber`, and `leasePeriodNote`; invoice due dates follow the lease's `paymentDate` (day-of-month) when set.

### Payments — `/api/v1/invoices`, `/api/v1/payments`, `/api/v1/webhooks`
| Endpoint | Roles |
|---|---|
| `GET /invoices`, `GET /invoices/:id` | tenant, owner, admin (scoped) |
| `POST /invoices/:id/pay` | tenant |
| `GET /payments` | tenant, owner, admin (scoped) |
| `GET /payments/export` | owner, admin |
| `GET /payments/:id/receipt` | tenant, owner, admin (scoped) |
| `PATCH /payments/:id/approve`, `PATCH /payments/:id/reject` | owner, house_manager, admin — cash/bank-transfer payments only; mobile money resolves automatically |
| `POST /webhooks/mtn/collection/:referenceId`, `POST /webhooks/mtn/disbursement/:referenceId` | public/unauthenticated (called by MTN, not clients — see below) |

> **`POST /invoices/:id/pay` uses a real MTN MoMo integration when credentials are configured, mocks otherwise.** `getPaymentProvider()` (`src/services/payments/payment.service.ts`) picks `MtnMomoCollectionProvider` (`src/services/payments/mtnMomoProvider.ts`) whenever `MTN_MOMO_COLLECTION_*` env vars are all set; if any are missing it falls back to the deterministic `MockMobileMoneyProvider`/`MockAirtelMoneyProvider`/`MockBankTransferProvider` (`src/services/payments/mockProviders.ts`) instead — same interface either way, so nothing else needs to change once real credentials exist. Airtel and bank transfer are always mocked; there's no real Airtel/bank integration yet. For `method: "mobile_money"`, an optional `carrier: "mtn" | "airtel"` (default `mtn`) picks the provider, recorded as `payments.provider`. The mock deterministically fails when `amount === 1`, useful for exercising the failure path in tests.
>
> A successful payment automatically triggers landlord disbursement — no admin approval step. See [docs/INFRASTRUCTURE.md §9](docs/INFRASTRUCTURE.md) for the full EventBridge → SQS → worker → MTN Disbursements flow, including the `held` payout status (used when the landlord's account is deactivated) and the important compliance flag on money passing through this app's own MTN merchant account.
>
> MTN's webhook callbacks aren't signed, so they're never trusted directly — each one only triggers a server-side call to MTN's own status endpoint (`getRequestToPayStatus`/`getTransferStatus`), and that response decides the outcome. This closes an otherwise-real fraud path: since a payment's `providerReference` is returned to the paying tenant in the `pay` response, a forged callback claiming success would otherwise let anyone fake their own payment.

> Every invoice/payment carries a human-readable `invoiceNumber`/`paymentNumber` (e.g. `ACC-INV-2026-00001`, `ACC-PAY-2026-00001`), allocated atomically from `document_sequences` (`src/common/utils/sequence.util.ts`) and reset each calendar year. They appear on the PDF receipt and in the payments Excel export alongside the UUID primary key.

### Maintenance — `/api/v1/maintenance-requests`
| Endpoint | Roles |
|---|---|
| `POST /` | tenant (must have an active lease on the property) |
| `GET /`, `GET /:id`, `GET /:id/feedback` | tenant, owner, agent, admin (scoped) |
| `PATCH /:id/assign`, `PATCH /:id/complete` | owner, agent, admin |
| `PATCH /:id/status` | owner, agent, admin, or the assignee |
| `POST /:id/feedback` | tenant (own request, after completion) |

`POST /` accepts an optional `priority: "low" | "medium" | "high"` (defaults to `medium`).

### Notifications — `/api/v1/notifications`
`GET /` · `GET /unread-count` · `PATCH /:id/read` · `PATCH /read-all` — always scoped to the caller.

### Dashboard — `/api/v1/dashboard`
| Endpoint | Roles |
|---|---|
| `GET /owner` | owner — revenue, outstanding rent, occupancy, maintenance expenses, net profit |
| `GET /admin` | admin — platform revenue, active users, user/property growth, payment stats |
| `GET /admin/statement?from&to&format=json\|excel\|pdf` | admin — profit/loss statement with a configurable tax rate (`platformSettings.taxRate`, defaults to 18%) |

### Reports — `/api/v1/reports`
All accept `?from&to&format=json|excel`.

| Endpoint | Roles |
|---|---|
| `GET /rental-history`, `GET /payment-history` | tenant, owner, admin (scoped) |
| `GET /occupancy`, `GET /maintenance-activity`, `GET /revenue-performance` | owner, admin (scoped) |
| `GET /agent-performance` | admin |

### Leads — `/api/v1/leads`
| Endpoint | Roles |
|---|---|
| `POST /contact`, `POST /get-started` | public (unauthenticated, rate-limited) |
| `GET /`, `PATCH /:id/status` | admin |

Public lead-capture for the marketing site's Contact and Get Started forms. Submissions are stored for admin review and never auto-create an account — `get-started`'s "Agent"/"Property Manager" option is stored as `roleInterest: "house_manager"`, matching the platform's existing house-manager role; actual onboarding still goes through `/api/v1/iam` invites or admin action.

### Admin — `/api/v1/admin` (admin only)
| Endpoint | Purpose |
|---|---|
| `GET /users`, `GET /users/:id`, `PATCH /users/:id/status` | manage/deactivate any user. Deactivating a landlord also holds their pending rent payouts (see Payments above); reactivating auto-releases them |
| `PATCH /users/:id/role` | change a user's role among `tenant`/`owner`/`agent`/`admin` — `superadmin` and `house_manager` aren't settable here (`house_manager` goes through the IAM invite flow instead) |
| `PATCH /users/:id/approve-agent` | approve a pending agent (agents register with `isApproved:false`) |
| `GET /identity-verifications`, `PATCH /identity-verifications/:id/approve\|reject` | review submitted ID documents; approval also sets `users.isVerified` |
| `PATCH /properties/:id/deactivate\|reactivate` | content moderation for listings |
| `POST /house-owners` | admin-created owner account (e.g. onboarding a landlord directly rather than via self-registration) |
| `GET /suspension-requests`, `PATCH /suspension-requests/:id/approve\|reject` | review suspension requests filed by owners/house_managers against their own tenants/managed users (`POST /api/v1/iam/suspension-requests`) |
| `GET /settings`, `PUT /settings/:key` | platform key/value settings store |
| `GET /audit-logs` | every mutating action in the system is recorded via `recordAction()` and viewable here |

## Background jobs (`npm run worker`)

Scheduled via BullMQ (`src/jobs/scheduler.ts`):

| Job | Schedule | What it does |
|---|---|---|
| `generate-invoices` | daily 00:05 | creates the current month's invoice for every active lease |
| `flag-late-payments` | daily 00:10 | marks unpaid invoices past their due date as `overdue`, notifies the owner |
| `send-rent-reminders` | daily 08:00 | notifies tenants of invoices due within 3 days |
| `process-payout-events` | every minute | polls the payout-events SQS queue (`src/jobs/handlers/processPayoutEvents.job.ts`) and disburses rent to landlords automatically — see Payments above. No-ops if `PAYOUT_EVENTS_QUEUE_URL` is unset |

## Architecture conventions

If you're adding a new module, copy the shape of an existing one (`properties` or `leases` are good templates):

- **Controllers** are thin `async (req, res)` functions with no `try/catch` — Express 5 forwards rejected promises to the error middleware automatically. They call one service function and respond via `sendSuccess()`.
- **Services** talk to Drizzle directly and throw `AppError.badRequest/unauthorized/forbidden/notFound/conflict/internal(...)` for business errors.
- **Validation** schemas are `{ body?, params?, query? }` Zod shapes consumed by the `validate()` middleware.
- **Routes** wire `authenticate` → `authorize(...roles)` → `validate(schema)` → handler, with `@openapi` JSDoc above each route for Swagger.
- Every mutation calls `recordAction()` (audit log) and, where another user should be told, `notify()` (in-app notification + optional email).
- Numeric Postgres columns (`numeric` type) round-trip as strings through Drizzle; dates (`date` type) round-trip as `"yyyy-MM-dd"` strings.

## Known gaps

- **Airtel Money and bank transfer are always mocked** — only MTN MoMo Collections/Disbursements have a real integration path (credential-gated, see Payments above).
- **No platform commission on rent payments** — the full tenant payment amount is disbursed to the landlord; HomeLink currently earns nothing per-transaction. Add fee logic in `payouts.service.ts` if the business model calls for one.
- Anything needing a business/legal decision or third-party account access (SES production access, MTN production credentials, PSP licensing, NCSA data-protection registration) is tracked in [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) instead of here, along with a few smaller things a QA pass surfaced but couldn't resolve unilaterally.
