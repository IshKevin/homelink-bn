import { testRequest } from "../../../../tests/helpers/app";
import {
    createAuthedUser,
    createInvoice,
    createLease,
    createMaintenanceRequest,
    createProperty
} from "../../../../tests/helpers/factories";
import { db } from "../../../database";
import { payments, platformSettings } from "../../../database/schema";

jest.mock("../../../services/email.service", () => ({
    sendMail: jest.fn().mockResolvedValue(undefined)
}));

jest.mock("../../../services/pdf.service", () => ({
    renderHtmlToPdf: jest.fn().mockResolvedValue(Buffer.from("pdf"))
}));

async function insertPayment(overrides: {
    invoiceId: string;
    tenantId: string;
    amount: string;
    status?: "pending" | "success" | "failed";
    paidAt?: Date | null;
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
            paidAt: overrides.status === "failed" ? null : (overrides.paidAt ?? new Date())
        })
        .returning();

    if (!payment) throw new Error("Failed to insert test payment");
    return payment;
}

async function setupOwnerWithLease() {
    const { user: owner, accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
    const property = await createProperty({ ownerId: owner.id, status: "occupied" });
    const { user: tenant } = await createAuthedUser({ role: "tenant" });
    const lease = await createLease({ propertyId: property.id, tenantId: tenant.id, ownerId: owner.id, status: "active" });
    return { owner, ownerToken, property, tenant, lease };
}

describe("Dashboard module", () => {
    describe("GET /api/v1/dashboard/owner", () => {
        it("computes revenue, outstanding rent, occupancy, maintenance expenses and net profit scoped to the owner", async () => {
            const { ownerToken, property, tenant, lease } = await setupOwnerWithLease();

            const paidInvoice = await createInvoice({ leaseId: lease.id, amountDue: "1000.00", status: "paid" });
            await insertPayment({
                invoiceId: paidInvoice.id,
                tenantId: tenant.id,
                amount: "1000.00",
                status: "success",
                paidAt: new Date()
            });

            const lastYearInvoice = await createInvoice({ leaseId: lease.id, amountDue: "800.00", status: "paid" });
            await insertPayment({
                invoiceId: lastYearInvoice.id,
                tenantId: tenant.id,
                amount: "800.00",
                status: "success",
                paidAt: new Date(new Date().getFullYear() - 1, 5, 15)
            });

            await createInvoice({ leaseId: lease.id, amountDue: "500.00", status: "unpaid" });
            await createInvoice({ leaseId: lease.id, amountDue: "300.00", status: "overdue" });

            await createProperty({ ownerId: (await createAuthedUser({ role: "owner" })).user.id, status: "available" });
            await createProperty({ ownerId: (await createAuthedUser({ role: "owner" })).user.id, status: "occupied" });

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
                status: "completed",
                itemsCost: 40,
                laborCost: 10,
                completedAt: new Date(new Date().getFullYear() - 1, 3, 1)
            });

            // second owner to confirm isolation
            const otherOwnerSetup = await setupOwnerWithLease();
            const otherInvoice = await createInvoice({
                leaseId: otherOwnerSetup.lease.id,
                amountDue: "2000.00",
                status: "paid"
            });
            await insertPayment({
                invoiceId: otherInvoice.id,
                tenantId: otherOwnerSetup.tenant.id,
                amount: "2000.00",
                status: "success",
                paidAt: new Date()
            });

            const res = await testRequest().get("/api/v1/dashboard/owner").set("Authorization", `Bearer ${ownerToken}`);
            expect(res.status).toBe(200);

            const data = res.body.data;
            expect(data.revenue.thisMonth).toBe(1000);
            expect(data.revenue.thisYear).toBe(1000);
            expect(data.outstandingRent).toBe(800);
            expect(data.occupancy.totalProperties).toBe(1);
            expect(data.occupancy.occupiedProperties).toBe(1);
            expect(data.occupancy.vacantUnits).toBe(0);
            expect(data.occupancy.occupancyRatePercent).toBe(100);
            expect(data.maintenanceExpenses.thisMonth).toBe(150);
            expect(data.maintenanceExpenses.thisYear).toBe(150);
            expect(data.netProfit.thisMonth).toBe(1000 - 150);
            expect(data.netProfit.thisYear).toBe(1000 - 150);
        });

        it("forbids a tenant from accessing the owner dashboard", async () => {
            const { accessToken: tenantToken } = await createAuthedUser({ role: "tenant" });
            const res = await testRequest().get("/api/v1/dashboard/owner").set("Authorization", `Bearer ${tenantToken}`);
            expect(res.status).toBe(403);
        });
    });

    describe("GET /api/v1/dashboard/tenant", () => {
        it("computes the active lease, outstanding balance, next due invoice and maintenance counts scoped to the tenant", async () => {
            const { property, tenant, lease } = await setupOwnerWithLease();

            await createInvoice({ leaseId: lease.id, amountDue: "500.00", status: "unpaid", dueDate: "2026-03-01" });
            await createInvoice({ leaseId: lease.id, amountDue: "300.00", status: "overdue", dueDate: "2026-02-01" });
            await createInvoice({ leaseId: lease.id, amountDue: "1000.00", status: "paid" });

            await createMaintenanceRequest({ propertyId: property.id, tenantId: tenant.id, status: "submitted" });
            await createMaintenanceRequest({ propertyId: property.id, tenantId: tenant.id, status: "in_progress" });
            await createMaintenanceRequest({ propertyId: property.id, tenantId: tenant.id, status: "completed" });

            const tenantLoginRes = await testRequest().post("/api/v1/auth/login").send({ email: tenant.email, password: "Password123!" });
            const tenantToken = tenantLoginRes.body.data.accessToken;

            const res = await testRequest().get("/api/v1/dashboard/tenant").set("Authorization", `Bearer ${tenantToken}`);
            expect(res.status).toBe(200);

            const data = res.body.data;
            expect(data.activeLease.id).toBe(lease.id);
            expect(data.outstandingBalance).toBe(800);
            expect(data.nextDueInvoice.dueDate).toBe("2026-02-01");
            expect(data.maintenanceRequests).toEqual({ open: 1, inProgress: 1, completed: 1 });
        });

        it("forbids an owner from accessing the tenant dashboard", async () => {
            const { accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            const res = await testRequest().get("/api/v1/dashboard/tenant").set("Authorization", `Bearer ${ownerToken}`);
            expect(res.status).toBe(403);
        });
    });

    describe("GET /api/v1/dashboard/agent", () => {
        it("computes managed-property and maintenance stats scoped to the agent", async () => {
            const { user: agent, accessToken: agentToken } = await createAuthedUser({ role: "agent", isApproved: true });
            const { user: owner } = await createAuthedUser({ role: "owner" });

            const availableProperty = await createProperty({ ownerId: owner.id, agentId: agent.id, status: "available" });
            const occupiedProperty = await createProperty({ ownerId: owner.id, agentId: agent.id, status: "occupied" });
            const { user: tenant } = await createAuthedUser({ role: "tenant" });
            const lease = await createLease({
                propertyId: occupiedProperty.id,
                tenantId: tenant.id,
                ownerId: owner.id,
                status: "active"
            });

            await createMaintenanceRequest({
                propertyId: availableProperty.id,
                tenantId: tenant.id,
                status: "assigned",
                assignedTo: agent.id
            });

            const res = await testRequest().get("/api/v1/dashboard/agent").set("Authorization", `Bearer ${agentToken}`);
            expect(res.status).toBe(200);

            const data = res.body.data;
            expect(data.properties.total).toBe(2);
            expect(data.properties.available).toBe(1);
            expect(data.properties.occupied).toBe(1);
            expect(data.activeLeases).toBe(1);
            expect(data.maintenanceRequests.assignedToMe).toBe(1);
            expect(data.maintenanceRequests.openAcrossManagedProperties).toBe(1);
            expect(lease.status).toBe("active");
        });

        it("forbids a tenant from accessing the agent dashboard", async () => {
            const { accessToken: tenantToken } = await createAuthedUser({ role: "tenant" });
            const res = await testRequest().get("/api/v1/dashboard/agent").set("Authorization", `Bearer ${tenantToken}`);
            expect(res.status).toBe(403);
        });
    });

    describe("GET /api/v1/dashboard/me", () => {
        it("routes to the right dashboard shape based on the caller's role", async () => {
            const { accessToken: tenantToken } = await createAuthedUser({ role: "tenant" });
            const tenantRes = await testRequest().get("/api/v1/dashboard/me").set("Authorization", `Bearer ${tenantToken}`);
            expect(tenantRes.status).toBe(200);
            expect(tenantRes.body.data).toHaveProperty("outstandingBalance");

            const { accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            const ownerRes = await testRequest().get("/api/v1/dashboard/me").set("Authorization", `Bearer ${ownerToken}`);
            expect(ownerRes.status).toBe(200);
            expect(ownerRes.body.data).toHaveProperty("occupancy");

            const { accessToken: agentToken } = await createAuthedUser({ role: "agent" });
            const agentRes = await testRequest().get("/api/v1/dashboard/me").set("Authorization", `Bearer ${agentToken}`);
            expect(agentRes.status).toBe(200);
            expect(agentRes.body.data).toHaveProperty("activeLeases");

            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });
            const adminRes = await testRequest().get("/api/v1/dashboard/me").set("Authorization", `Bearer ${adminToken}`);
            expect(adminRes.status).toBe(200);
            expect(adminRes.body.data).toHaveProperty("usersByRole");
        });
    });

    describe("GET /api/v1/dashboard/admin", () => {
        it("reflects seeded platform-wide stats", async () => {
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });

            const { owner, ownerToken: _ownerToken } = await setupOwnerWithLease().then((s) => ({ owner: s.owner, ownerToken: s.ownerToken }));
            await createAuthedUser({ role: "tenant" });
            await createAuthedUser({ role: "agent" });

            const { property, tenant, lease } = await setupOwnerWithLease();
            const invoice = await createInvoice({ leaseId: lease.id, amountDue: "500.00", status: "paid" });
            await insertPayment({ invoiceId: invoice.id, tenantId: tenant.id, amount: "500.00", status: "success" });

            const failedInvoice = await createInvoice({ leaseId: lease.id, amountDue: "100.00", status: "unpaid" });
            await insertPayment({ invoiceId: failedInvoice.id, tenantId: tenant.id, amount: "100.00", status: "failed" });

            const res = await testRequest().get("/api/v1/dashboard/admin").set("Authorization", `Bearer ${adminToken}`);
            expect(res.status).toBe(200);

            const data = res.body.data;
            expect(data.activeUsers).toBeGreaterThan(0);
            expect(data.usersByRole.tenant).toBeGreaterThanOrEqual(1);
            expect(data.usersByRole.owner).toBeGreaterThanOrEqual(1);
            expect(data.usersByRole.agent).toBeGreaterThanOrEqual(1);
            expect(data.usersByRole.admin).toBeGreaterThanOrEqual(1);
            expect(data.properties.total).toBeGreaterThanOrEqual(1);
            expect(data.payments.total).toBeGreaterThanOrEqual(2);
            expect(data.payments.successCount).toBeGreaterThanOrEqual(1);
            expect(data.payments.failedCount).toBeGreaterThanOrEqual(1);
            expect(data.payments.successRatePercent).toBeGreaterThanOrEqual(0);

            // sanity references to keep unused var lint happy
            expect(owner).toBeTruthy();
            expect(property).toBeTruthy();
        });

        it("forbids an owner from accessing the admin dashboard", async () => {
            const { accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            const res = await testRequest().get("/api/v1/dashboard/admin").set("Authorization", `Bearer ${ownerToken}`);
            expect(res.status).toBe(403);
        });
    });

    describe("GET /api/v1/dashboard/admin/statement", () => {
        it("computes a numerically consistent statement for the current year by default", async () => {
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });
            const { tenant, lease } = await setupOwnerWithLease();

            const invoice = await createInvoice({ leaseId: lease.id, amountDue: "1200.00", status: "paid" });
            await insertPayment({ invoiceId: invoice.id, tenantId: tenant.id, amount: "1200.00", status: "success" });

            const res = await testRequest()
                .get("/api/v1/dashboard/admin/statement")
                .set("Authorization", `Bearer ${adminToken}`);
            expect(res.status).toBe(200);

            const statement = res.body.data;
            expect(statement.periodFrom).toMatch(/^\d{4}-01-01$/);
            expect(statement.periodTo).toMatch(/^\d{4}-12-31$/);
            expect(statement.grossProfit).toBeCloseTo(statement.revenue - statement.expenses, 2);
            expect(statement.netProfit).toBeCloseTo(statement.grossProfit - statement.taxAmount, 2);
            if (statement.grossProfit > 0) {
                expect(statement.taxAmount).toBeCloseTo(statement.grossProfit * statement.taxRate, 2);
            }
        });

        it("uses a configured platformSettings taxRate when present", async () => {
            await db
                .insert(platformSettings)
                .values({ key: "taxRate", value: 0.2 })
                .onConflictDoUpdate({ target: platformSettings.key, set: { value: 0.2 } });

            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });

            const res = await testRequest()
                .get("/api/v1/dashboard/admin/statement")
                .set("Authorization", `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            expect(res.body.data.taxRate).toBe(0.2);
        });

        it("exports the statement as an xlsx workbook", async () => {
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });

            const res = await testRequest()
                .get("/api/v1/dashboard/admin/statement?format=excel")
                .set("Authorization", `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toBe(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );
            expect(res.headers["content-disposition"]).toContain("statement.xlsx");
            expect(Number(res.headers["content-length"])).toBeGreaterThan(0);
        });

        it("exports the statement as a pdf using the mocked pdf service", async () => {
            const { renderHtmlToPdf } = jest.requireMock("../../../services/pdf.service") as {
                renderHtmlToPdf: jest.Mock;
            };
            renderHtmlToPdf.mockClear();

            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });

            const res = await testRequest()
                .get("/api/v1/dashboard/admin/statement?format=pdf")
                .set("Authorization", `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toBe("application/pdf");
            expect(res.headers["content-disposition"]).toContain("statement.pdf");
            expect(Number(res.headers["content-length"])).toBeGreaterThan(0);
            expect(renderHtmlToPdf).toHaveBeenCalledTimes(1);
        });
    });
});
