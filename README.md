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

## Available scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the API with hot reload |
| `npm run worker` | Start the background job worker with hot reload |
| `npm run build` | Type-check and compile to `dist/` |
| `npm start` / `npm run start:worker` | Run the compiled server/worker (`dist/`) |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle Kit migration workflow |
| `npm test` / `npm run test:watch` | Run the Jest integration suite against a real Postgres database |
| `npm run lint` | ESLint (not yet configured — see Known gaps below) |

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
| `PATCH /:id/approve`, `PATCH /:id/reject` | admin |

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

Signing a lease with both parties activates it, flips the property to `occupied`, generates and stores a lease PDF, and seeds a move-in checklist automatically.

### Payments — `/api/v1/invoices`, `/api/v1/payments`
| Endpoint | Roles |
|---|---|
| `GET /invoices`, `GET /invoices/:id` | tenant, owner, admin (scoped) |
| `POST /invoices/:id/pay` | tenant |
| `GET /payments` | tenant, owner, admin (scoped) |
| `GET /payments/export` | owner, admin |
| `GET /payments/:id/receipt` | tenant, owner, admin (scoped) |

> **`POST /invoices/:id/pay` is intentionally a placeholder gateway.** It is fully wired end-to-end (creates a payment record, flips the invoice to paid, generates a receipt, sends notifications) against `MockMobileMoneyProvider`/`MockBankTransferProvider` (`src/services/payments/mockProviders.ts`), not a real MTN/Airtel/bank integration. Swap `getPaymentProvider()` (`src/services/payments/payment.service.ts`) for real provider SDKs when ready — no other code needs to change. The mock deterministically fails when `amount === 1`, which is useful for exercising the failure path in tests.

### Maintenance — `/api/v1/maintenance-requests`
| Endpoint | Roles |
|---|---|
| `POST /` | tenant (must have an active lease on the property) |
| `GET /`, `GET /:id`, `GET /:id/feedback` | tenant, owner, agent, admin (scoped) |
| `PATCH /:id/assign`, `PATCH /:id/complete` | owner, agent, admin |
| `PATCH /:id/status` | owner, agent, admin, or the assignee |
| `POST /:id/feedback` | tenant (own request, after completion) |

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

### Admin — `/api/v1/admin` (admin only)
| Endpoint | Purpose |
|---|---|
| `GET /users`, `GET /users/:id`, `PATCH /users/:id/status` | manage/deactivate any user |
| `PATCH /users/:id/approve-agent` | approve a pending agent (agents register with `isApproved:false`) |
| `GET /identity-verifications`, `PATCH /identity-verifications/:id/approve\|reject` | review submitted ID documents; approval also sets `users.isVerified` |
| `PATCH /properties/:id/deactivate\|reactivate` | content moderation for listings |
| `GET /settings`, `PUT /settings/:key` | platform key/value settings store |
| `GET /audit-logs` | every mutating action in the system is recorded via `recordAction()` and viewable here |

## Background jobs (`npm run worker`)

Scheduled via BullMQ (`src/jobs/scheduler.ts`):

| Job | Schedule | What it does |
|---|---|---|
| `generate-invoices` | daily 00:05 | creates the current month's invoice for every active lease |
| `flag-late-payments` | daily 00:10 | marks unpaid invoices past their due date as `overdue`, notifies the owner |
| `send-rent-reminders` | daily 08:00 | notifies tenants of invoices due within 3 days |

## Architecture conventions

If you're adding a new module, copy the shape of an existing one (`properties` or `leases` are good templates):

- **Controllers** are thin `async (req, res)` functions with no `try/catch` — Express 5 forwards rejected promises to the error middleware automatically. They call one service function and respond via `sendSuccess()`.
- **Services** talk to Drizzle directly and throw `AppError.badRequest/unauthorized/forbidden/notFound/conflict/internal(...)` for business errors.
- **Validation** schemas are `{ body?, params?, query? }` Zod shapes consumed by the `validate()` middleware.
- **Routes** wire `authenticate` → `authorize(...roles)` → `validate(schema)` → handler, with `@openapi` JSDoc above each route for Swagger.
- Every mutation calls `recordAction()` (audit log) and, where another user should be told, `notify()` (in-app notification + optional email).
- Numeric Postgres columns (`numeric` type) round-trip as strings through Drizzle; dates (`date` type) round-trip as `"yyyy-MM-dd"` strings.

## Known gaps

- **Linting is unconfigured.** `eslint` is installed but there's no `eslint.config.js` and no `@typescript-eslint` packages — `npm run lint` currently fails outright. This predates the feature modules above and needs a deliberate rule-set decision before wiring in.
- **Payment gateway is mocked**, as described above — swap in a real provider before accepting real transactions.
