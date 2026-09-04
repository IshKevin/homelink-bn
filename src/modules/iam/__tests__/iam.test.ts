import { testRequest } from "../../../../tests/helpers/app";
import { createAuthedUser, createLease, createProperty } from "../../../../tests/helpers/factories";
import * as emailService from "../../../services/email.service";

jest.mock("../../../services/email.service", () => ({
    sendMail: jest.fn().mockResolvedValue(undefined)
}));

function extractToken(html: string): string {
    const match = html.match(/token=([a-f0-9]+)/);
    if (!match || !match[1]) throw new Error("Token not found in email html");
    return match[1];
}

async function inviteAndAccept(
    ownerToken: string,
    endpoint: "managers" | "tenants",
    email: string,
    extra: Record<string, unknown> = {}
) {
    const inviteRes = await testRequest()
        .post(`/api/v1/iam/${endpoint}/invite`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email, ...extra });
    expect(inviteRes.status).toBe(201);

    const sendMailMock = emailService.sendMail as jest.Mock;
    const call = sendMailMock.mock.calls.find((c) => c[0].to === email);
    if (!call) throw new Error("Invite email not sent");
    const token = extractToken(call[0].html);

    const acceptRes = await testRequest().post("/api/v1/iam/invites/accept").send({
        token,
        firstName: "New",
        lastName: "User",
        phone: "0788999999",
        password: "Password123!"
    });
    expect(acceptRes.status).toBe(201);

    return acceptRes.body.data;
}

describe("IAM module", () => {
    describe("Manager invite → accept → scoped access → revoke", () => {
        it("lets a house owner invite a manager, the manager acts on the owner's properties, then loses access on revoke", async () => {
            const { user: owner, accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            await createProperty({ ownerId: owner.id, status: "occupied" });

            const manager = await inviteAndAccept(ownerToken, "managers", "manager@example.com");
            expect(manager.role).toBe("house_manager");

            const loginRes = await testRequest()
                .post("/api/v1/auth/login")
                .send({ email: "manager@example.com", password: "Password123!" });
            expect(loginRes.status).toBe(200);
            const managerToken = loginRes.body.data.accessToken;

            const dashboardRes = await testRequest()
                .get("/api/v1/dashboard/owner")
                .set("Authorization", `Bearer ${managerToken}`);
            expect(dashboardRes.status).toBe(200);
            expect(dashboardRes.body.data.occupancy.totalProperties).toBe(1);

            const listRes = await testRequest()
                .get("/api/v1/iam/managers")
                .set("Authorization", `Bearer ${ownerToken}`);
            expect(listRes.status).toBe(200);
            expect(listRes.body.data).toHaveLength(1);
            const assignmentId = listRes.body.data[0].id;

            const revokeRes = await testRequest()
                .patch(`/api/v1/iam/managers/${assignmentId}/revoke`)
                .set("Authorization", `Bearer ${ownerToken}`);
            expect(revokeRes.status).toBe(200);
            expect(revokeRes.body.data.status).toBe("revoked");

            const dashboardAfterRevoke = await testRequest()
                .get("/api/v1/dashboard/owner")
                .set("Authorization", `Bearer ${managerToken}`);
            expect(dashboardAfterRevoke.status).toBe(403);
        });

        it("forbids a house manager (not an owner) from inviting another manager", async () => {
            const { accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            const manager = await inviteAndAccept(ownerToken, "managers", "manager2@example.com");

            const loginRes = await testRequest()
                .post("/api/v1/auth/login")
                .send({ email: "manager2@example.com", password: "Password123!" });
            const managerToken = loginRes.body.data.accessToken;

            const res = await testRequest()
                .post("/api/v1/iam/managers/invite")
                .set("Authorization", `Bearer ${managerToken}`)
                .send({ email: "another@example.com" });
            expect(res.status).toBe(403);
            expect(manager.id).toBeDefined();
        });
    });

    describe("Tenant invite", () => {
        it("lets an owner invite a tenant via link", async () => {
            const { accessToken: ownerToken } = await createAuthedUser({ role: "owner" });

            const tenant = await inviteAndAccept(ownerToken, "tenants", "tenant-invite@example.com");
            expect(tenant.role).toBe("tenant");
        });
    });

    describe("Suspension requests", () => {
        it("lets an owner request suspension of their own tenant and an admin approve it, deactivating the account", async () => {
            const { user: owner, accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });
            const { user: targetTenant } = await createAuthedUser({ role: "tenant" });
            const property = await createProperty({ ownerId: owner.id });
            await createLease({ propertyId: property.id, ownerId: owner.id, tenantId: targetTenant.id });

            const requestRes = await testRequest()
                .post("/api/v1/iam/suspension-requests")
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({ targetUserId: targetTenant.id, reason: "Repeated late payments and abusive messages" });
            expect(requestRes.status).toBe(201);

            const listRes = await testRequest()
                .get("/api/v1/admin/suspension-requests")
                .set("Authorization", `Bearer ${adminToken}`);
            expect(listRes.status).toBe(200);
            expect(listRes.body.data.some((r: { id: string }) => r.id === requestRes.body.data.id)).toBe(true);

            const approveRes = await testRequest()
                .patch(`/api/v1/admin/suspension-requests/${requestRes.body.data.id}/approve`)
                .set("Authorization", `Bearer ${adminToken}`);
            expect(approveRes.status).toBe(200);
            expect(approveRes.body.data.status).toBe("approved");

            const loginRes = await testRequest()
                .post("/api/v1/auth/login")
                .send({ email: targetTenant.email, password: "Password123!" });
            expect(loginRes.status).toBe(403);
        });

        it("does not let an owner request suspension of a user who isn't their tenant or manager", async () => {
            const { accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            const { user: unrelatedTenant } = await createAuthedUser({ role: "tenant" });

            const requestRes = await testRequest()
                .post("/api/v1/iam/suspension-requests")
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({ targetUserId: unrelatedTenant.id, reason: "Trying to suspend someone else's tenant" });
            expect(requestRes.status).toBe(403);
        });
    });
});
