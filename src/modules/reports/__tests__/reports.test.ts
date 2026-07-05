import { testRequest } from "../../../../tests/helpers/app";
import {
    createAuthedUser,
    createInvoice,
    createLease,
    createMaintenanceRequest,
    createProperty
} from "../../../../tests/helpers/factories";
import { eq } from "drizzle-orm";
import { db } from "../../../database";
import { payments, properties } from "../../../database/schema";

jest.mock("../../../services/email.service", () => ({
    sendMail: jest.fn().mockResolvedValue(undefined)
}));

async function insertPayment(overrides: {
    invoiceId: string;
    tenantId: string;
    amount: string;
    status?: "pending" | "success" | "failed";
    paidAt?: Date | null;
    createdAt?: Date;
}) {
    const [payment] = await db
        .insert(payments)
        .values({
            invoiceId: overrides.invoiceId,
            tenantId: overrides.tenantId,
            amount: overrides.amount,
            method: "mobile_money",
            provider: "mock",
            providerReference: `REF-${Math.random().toString(36).slice(2)}`,
            status: overrides.status ?? "success",
            paidAt: overrides.status === "failed" ? null : (overrides.paidAt ?? new Date()),
            createdAt: overrides.createdAt ?? new Date()
        })
        .returning();

    if (!payment) throw new Error("Failed to insert test payment");
    return payment;
}

describe("Reports module", () => {
    describe("GET /api/v1/reports/rental-history", () => {
        it("scopes leases to the tenant, owner and excludes unrelated users", async () => {
            const { user: owner, accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            const { user: tenant, accessToken: tenantToken } = await createAuthedUser({ role: "tenant" });
            const { accessToken: otherTenantToken } = await createAuthedUser({ role: "tenant" });

            const property = await createProperty({ ownerId: owner.id, status: "occupied" });
            await createLease({
                propertyId: property.id,
                tenantId: tenant.id,
                ownerId: owner.id,
                startDate: "2026-01-01",
                endDate: "2026-12-31",
                status: "active"
            });

            const tenantRes = await testRequest()
                .get("/api/v1/reports/rental-history")
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(tenantRes.status).toBe(200);
            expect(tenantRes.body.data.rows.length).toBe(1);
            expect(tenantRes.body.data.summary.totalLeases).toBe(1);

            const ownerRes = await testRequest()
                .get("/api/v1/reports/rental-history")
                .set("Authorization", `Bearer ${ownerToken}`);
            expect(ownerRes.status).toBe(200);
            expect(ownerRes.body.data.rows.length).toBe(1);

            const otherRes = await testRequest()
                .get("/api/v1/reports/rental-history")
                .set("Authorization", `Bearer ${otherTenantToken}`);
            expect(otherRes.status).toBe(200);
            expect(otherRes.body.data.rows.length).toBe(0);
        });
    });

    describe("GET /api/v1/reports/payment-history", () => {
        it("scopes payments to the tenant and computes totalAmount from successful payments only", async () => {
            const { user: owner } = await createAuthedUser({ role: "owner" });
            const { user: tenant, accessToken: tenantToken } = await createAuthedUser({ role: "tenant" });
            const { accessToken: otherTenantToken } = await createAuthedUser({ role: "tenant" });

            const property = await createProperty({ ownerId: owner.id, status: "occupied" });
            const lease = await createLease({ propertyId: property.id, tenantId: tenant.id, ownerId: owner.id });

            const invoice1 = await createInvoice({ leaseId: lease.id, amountDue: "500.00" });
            await insertPayment({ invoiceId: invoice1.id, tenantId: tenant.id, amount: "500.00", status: "success" });

            const invoice2 = await createInvoice({ leaseId: lease.id, amountDue: "300.00" });
            await insertPayment({ invoiceId: invoice2.id, tenantId: tenant.id, amount: "300.00", status: "failed" });

            const res = await testRequest()
                .get("/api/v1/reports/payment-history")
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(res.status).toBe(200);
            expect(res.body.data.rows.length).toBe(2);
            expect(res.body.data.summary.totalPayments).toBe(2);
            expect(res.body.data.summary.totalAmount).toBe(500);

            const otherRes = await testRequest()
                .get("/api/v1/reports/payment-history")
                .set("Authorization", `Bearer ${otherTenantToken}`);
            expect(otherRes.status).toBe(200);
            expect(otherRes.body.data.rows.length).toBe(0);
        });

        it("exports the payment history report as an xlsx workbook", async () => {
            const { accessToken: tenantToken } = await createAuthedUser({ role: "tenant" });

            const res = await testRequest()
                .get("/api/v1/reports/payment-history?format=excel")
                .set("Authorization", `Bearer ${tenantToken}`);

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toBe(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );
            expect(res.headers["content-disposition"]).toContain("payment-history.xlsx");
            expect(Number(res.headers["content-length"])).toBeGreaterThan(0);
        });
    });

    describe("GET /api/v1/reports/occupancy", () => {
        it("computes near-100% occupancy for a fully-leased property and 0% for a vacant one", async () => {
            const now = new Date();
            const { user: owner, accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            const { user: tenant } = await createAuthedUser({ role: "tenant" });

            const leasedProperty = await createProperty({ ownerId: owner.id, status: "occupied" });
            await createLease({
                propertyId: leasedProperty.id,
                tenantId: tenant.id,
                ownerId: owner.id,
                startDate: `${now.getFullYear()}-01-01`,
                endDate: `${now.getFullYear()}-12-31`,
                status: "active"
            });

            await createProperty({ ownerId: owner.id, status: "available" });

            const res = await testRequest().get("/api/v1/reports/occupancy").set("Authorization", `Bearer ${ownerToken}`);
            expect(res.status).toBe(200);
            expect(res.body.data.rows.length).toBe(2);

            const leasedRow = res.body.data.rows.find((r: { Property: string }) => r.Property === leasedProperty.title);
            const vacantRow = res.body.data.rows.find((r: { OccupancyRatePercent: number }) => r.OccupancyRatePercent === 0);

            expect(leasedRow.OccupancyRatePercent).toBeGreaterThanOrEqual(99);
            expect(vacantRow).toBeTruthy();
            expect(vacantRow.OccupancyRatePercent).toBe(0);
        });
    });

    describe("GET /api/v1/reports/maintenance-activity", () => {
        it("computes byStatus counts and totalCost matching seeded requests", async () => {
            const { user: owner, accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            const { user: tenant } = await createAuthedUser({ role: "tenant" });
            const property = await createProperty({ ownerId: owner.id, status: "occupied" });

            await createMaintenanceRequest({
                propertyId: property.id,
                tenantId: tenant.id,
                status: "completed",
                itemsCost: 100,
                laborCost: 50,
                completedAt: new Date()
            });
            await createMaintenanceRequest({
                propertyId: property.id,
                tenantId: tenant.id,
                status: "submitted",
                itemsCost: 20,
                laborCost: 0
            });
            await createMaintenanceRequest({
                propertyId: property.id,
                tenantId: tenant.id,
                status: "in_progress",
                itemsCost: 10,
                laborCost: 5
            });

            const res = await testRequest()
                .get("/api/v1/reports/maintenance-activity")
                .set("Authorization", `Bearer ${ownerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.rows.length).toBe(3);
            expect(res.body.data.summary.byStatus).toEqual({
                submitted: 1,
                assigned: 0,
                in_progress: 1,
                completed: 1
            });
            expect(res.body.data.summary.totalCost).toBe(185);
            expect(res.body.data.summary.totalRequests).toBe(3);
        });
    });

    describe("GET /api/v1/reports/revenue-performance", () => {
        it("aggregates two same-month payments into a single row with the summed amount", async () => {
            const { user: owner, accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            const { user: tenant } = await createAuthedUser({ role: "tenant" });
            const property = await createProperty({ ownerId: owner.id, status: "occupied" });
            const lease = await createLease({ propertyId: property.id, tenantId: tenant.id, ownerId: owner.id });

            const now = new Date();

            const invoice1 = await createInvoice({ leaseId: lease.id, amountDue: "500.00" });
            await insertPayment({
                invoiceId: invoice1.id,
                tenantId: tenant.id,
                amount: "500.00",
                status: "success",
                paidAt: now
            });

            const invoice2 = await createInvoice({ leaseId: lease.id, amountDue: "300.00" });
            await insertPayment({
                invoiceId: invoice2.id,
                tenantId: tenant.id,
                amount: "300.00",
                status: "success",
                paidAt: now
            });

            const res = await testRequest()
                .get("/api/v1/reports/revenue-performance")
                .set("Authorization", `Bearer ${ownerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.rows.length).toBe(1);
            expect(res.body.data.rows[0].Revenue).toBe(800);
            expect(res.body.data.summary.totalRevenue).toBe(800);
        });
    });

    describe("GET /api/v1/reports/agent-performance", () => {
        it("computes managed listing breakdowns per agent and forbids non-admin access", async () => {
            const { user: agent, accessToken: agentToken } = await createAuthedUser({ role: "agent" });
            const { user: owner, accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });

            await createProperty({ ownerId: owner.id, agentId: agent.id, approvalStatus: "approved" });
            await createProperty({ ownerId: owner.id, agentId: agent.id, approvalStatus: "pending" });

            const adminRes = await testRequest()
                .get("/api/v1/reports/agent-performance")
                .set("Authorization", `Bearer ${adminToken}`);
            expect(adminRes.status).toBe(200);

            const agentRow = adminRes.body.data.rows.find(
                (r: { Agent: string }) => r.Agent === `${agent.firstName} ${agent.lastName}`
            );
            expect(agentRow.PropertiesManaged).toBe(2);
            expect(agentRow.ApprovedListings).toBe(1);
            expect(agentRow.PendingListings).toBe(1);
            expect(agentRow.RejectedListings).toBe(0);

            const ownerRes = await testRequest()
                .get("/api/v1/reports/agent-performance")
                .set("Authorization", `Bearer ${ownerToken}`);
            expect(ownerRes.status).toBe(403);

            const agentSelfRes = await testRequest()
                .get("/api/v1/reports/agent-performance")
                .set("Authorization", `Bearer ${agentToken}`);
            expect(agentSelfRes.status).toBe(403);
        });

        it("only counts listings created inside the requested date range", async () => {
            const { user: agent } = await createAuthedUser({ role: "agent" });
            const { user: owner } = await createAuthedUser({ role: "owner" });
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });

            const inRange = await createProperty({ ownerId: owner.id, agentId: agent.id, approvalStatus: "approved" });
            const outOfRange = await createProperty({ ownerId: owner.id, agentId: agent.id, approvalStatus: "approved" });
            await db.update(properties).set({ createdAt: new Date("2020-01-15") }).where(eq(properties.id, outOfRange.id));

            const res = await testRequest()
                .get("/api/v1/reports/agent-performance?from=2026-01-01&to=2026-12-31")
                .set("Authorization", `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            const agentRow = res.body.data.rows.find((r: { Agent: string }) => r.Agent === `${agent.firstName} ${agent.lastName}`);
            expect(agentRow.PropertiesManaged).toBe(1);
            expect(inRange.id).not.toBe(outOfRange.id);
        });
    });
});
