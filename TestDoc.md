# HomeLink Backend Testing Guide

## Application URLs

| Service | URL | Description |
|----------|-----|-------------|
| API Base URL | http://localhost:3000/api/v1 | Main REST API |
| API Documentation | http://localhost:3000/api-docs | Interactive Swagger documentation |
| Mailpit | http://localhost:8025 | Inbox for all outgoing emails |
| MinIO Console | http://localhost:9001 | File storage console (Login: **minio** / **minio123**) |
| Production API | https://homelink-bn.onrender.com/api/v1 | Deployed REST API |
| Production Documentation | https://homelink-bn.onrender.com/api-docs | Deployed Swagger documentation |

---

# Test Accounts

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| **Admin** | admin@homelink.test | `AdminPass123!` | Full platform access |
| **Owner** | owner1@test.com | `OwnerPass123!` | Owns **Test Flat** |
| **Tenant** | tenant1@test.com | `NewTenantPass456!` | Active lease on Test Flat |
| **Tenant** | tenant2@test.com | `Tenant2Pass!` | No leases (good for testing forbidden cases) |
| **Agent** | agent1@test.com | `AgentPass123!` | Approved agent managing Test Flat |
| **Agent** | agent2@test.com | `AgentPass123!` | Unapproved agent (good for approval testing) |

---

# Authentication

Login using:

```http
POST /auth/login
```

Request body:

```json
{
  "email": "user@example.com",
  "password": "your-password"
}
```

The response returns a JWT access token.

Include the token in every authenticated request:

```http
Authorization: Bearer <your-access-token>
```

---

# Existing Test Data

## Property

| Name | Status | Property ID |
|------|--------|-------------|
| Test Flat | Occupied, Approved | `9b3c4152-1d65-4944-8ec2-8258da1a1851` |

---

## Leases

| Lease ID | Status | Monthly Rent |
|----------|--------|-------------:|
| `9093312e-5b49-4b96-85ae-30ea75d5824b` | Terminated | 500 |
| `a24c242a-ec63-46f6-b123-42dfe46e402c` | Active | 550 |

---

## Invoices

| Invoice ID | Period | Amount | Status |
|------------|--------|-------:|--------|
| `9e020a6b-3ab2-4e25-9e15-9c50203eeed3` | 2026-07 | 500 | Paid |
| `12e371b2-20af-4fa2-aba9-0d193208cc0c` | 2026-07 | 550 | Unpaid *(Use this one for successful payment testing.)* |
| `89e0da4f-6697-4c86-9a10-8a6b83d2249c` | 2026-05 | 550 | Overdue |
| `be7389a0-73d7-4eb3-9513-46a5e3b77d21` | 2026-04 | 1.00 | Unpaid *(Always fails with simulated payment decline.)* |

---

## Maintenance Request

| Title | Request ID | Status |
|-------|------------|--------|
| Leaking faucet | `f0239f26-3e30-4401-b4b8-e26c9579a04d` | Completed (feedback already submitted by tenant1) |

---

# Manual Testing Scenarios

## ✅ Successful Invoice Payment

Login as **tenant1** and pay the unpaid invoice:

```http
POST /invoices/{id}/pay
```

Request body:

```json
{
  "method": "mobile_money"
}
```

Use invoice:

```
12e371b2-20af-4fa2-aba9-0d193208cc0c
```

**Expected Result**

- Payment succeeds
- Receipt is generated
- Email sent to tenant and owner
- Verify emails in Mailpit

---

## ❌ Simulated Payment Failure

Attempt to pay:

```
be7389a0-73d7-4eb3-9513-46a5e3b77d21
```

**Expected Result**

```
Simulated insufficient funds
```

---

## Agent Approval Flow

### Step 1

Login as **agent2** (unapproved).

Attempt:

```http
POST /properties
```

**Expected Result**

```
403 Forbidden
```

---

### Step 2

Login as **Admin**.

Approve the agent:

```http
PATCH /admin/users/{agent2-id}/approve-agent
```

Retry:

```http
POST /properties
```

**Expected Result**

Property creation succeeds.

---

## End-to-End Tenant Flow

1. Register a new tenant.
2. Login as **owner1**.
3. Create a new property.
4. Create a lease for the new tenant.
5. Sign the lease from both owner and tenant.
6. Complete the move-in checklist.

**Expected Result**

The complete onboarding workflow finishes successfully.

---

# Helpful Services

- **Swagger UI:** http://localhost:3000/api-docs
- **API Base:** http://localhost:3000/api/v1
- **Mailpit:** http://localhost:8025
- **MinIO Console:** http://localhost:9001
  - Username: `minio`
  - Password: `minio123`
- **Production Swagger UI:** https://homelink-bn.onrender.com/api-docs
- **Production API Base:** https://homelink-bn.onrender.com/api/v1