import { eq } from "drizzle-orm";
import { testRequest } from "../../../../tests/helpers/app";
import { createAuthedUser, createLease, createProperty, createUser } from "../../../../tests/helpers/factories";
import { db } from "../../../database";
import { identityVerifications, users } from "../../../database/schema";
import * as emailService from "../../../services/email.service";

jest.mock("../../../services/email.service", () => ({
    sendMail: jest.fn().mockResolvedValue(undefined)
}));

function extractToken(html: string): string {
    const match = html.match(/token=([a-f0-9]+)/);
    if (!match || !match[1]) throw new Error("Token not found in email html");
    return match[1];
}

describe("Admin module", () => {
    describe("Access control", () => {
        it("forbids non-admin users from accessing admin routes", async () => {
            const { accessToken } = await createAuthedUser({ role: "tenant" });

            const res = await testRequest().get("/api/v1/admin/users").set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(403);
        });
    });

    describe("GET /api/v1/admin/users", () => {
        it("lists users, filters by role/isApproved/isActive, and supports search", async () => {
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });
            const { user: agent } = await createUser({ role: "agent", isApproved: false, email: "findme-agent@example.com" });
            await createUser({ role: "tenant", isActive: true });

            const roleRes = await testRequest()
                .get("/api/v1/admin/users?role=agent")
                .set("Authorization", `Bearer ${adminToken}`);
            expect(roleRes.status).toBe(200);
            expect(roleRes.body.data.every((u: { role: string }) => u.role === "agent")).toBe(true);
            expect(roleRes.body.data.some((u: { id: string }) => u.id === agent.id)).toBe(true);
            expect(roleRes.body.data.every((u: { passwordHash?: string }) => u.passwordHash === undefined)).toBe(true);

            const approvedRes = await testRequest()
                .get("/api/v1/admin/users?isApproved=false")
                .set("Authorization", `Bearer ${adminToken}`);
            expect(approvedRes.status).toBe(200);
            expect(approvedRes.body.data.some((u: { id: string }) => u.id === agent.id)).toBe(true);

            const searchRes = await testRequest()
                .get("/api/v1/admin/users?search=findme-agent")
                .set("Authorization", `Bearer ${adminToken}`);
            expect(searchRes.status).toBe(200);
            expect(searchRes.body.data.some((u: { id: string }) => u.id === agent.id)).toBe(true);
        });
    });

    describe("PATCH /api/v1/admin/users/:id/status", () => {
        it("deactivates then reactivates a user's account", async () => {
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });
            const { user: tenant } = await createUser({ role: "tenant" });

            const deactivateRes = await testRequest()
                .patch(`/api/v1/admin/users/${tenant.id}/status`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ isActive: false });
            expect(deactivateRes.status).toBe(200);
            expect(deactivateRes.body.data.isActive).toBe(false);

            const reactivateRes = await testRequest()
                .patch(`/api/v1/admin/users/${tenant.id}/status`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ isActive: true });
            expect(reactivateRes.status).toBe(200);
            expect(reactivateRes.body.data.isActive).toBe(true);
        });
    });

    describe("PATCH /api/v1/admin/users/:id/approve-agent", () => {
        it("approves a pending agent; rejects already-approved and non-agent users", async () => {
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });
            const { user: agent } = await createUser({ role: "agent", isApproved: false });
            const { user: tenant } = await createUser({ role: "tenant" });

            const res = await testRequest()
                .patch(`/api/v1/admin/users/${agent.id}/approve-agent`)
                .set("Authorization", `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            expect(res.body.data.isApproved).toBe(true);

            const conflictRes = await testRequest()
                .patch(`/api/v1/admin/users/${agent.id}/approve-agent`)
                .set("Authorization", `Bearer ${adminToken}`);
            expect(conflictRes.status).toBe(409);

            const badRes = await testRequest()
                .patch(`/api/v1/admin/users/${tenant.id}/approve-agent`)
                .set("Authorization", `Bearer ${adminToken}`);
            expect(badRes.status).toBe(400);
        });
    });

    describe("Identity verifications", () => {
        it("approves a pending verification and flips the user's isVerified flag", async () => {
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });
            const { user: tenant } = await createUser({ role: "tenant", isVerified: false });

            const [verification] = await db
                .insert(identityVerifications)
                .values({ userId: tenant.id, documentUrl: "docs/id.png" })
                .returning();
            expect(verification).toBeDefined();

            const res = await testRequest()
                .patch(`/api/v1/admin/identity-verifications/${verification!.id}/approve`)
                .set("Authorization", `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe("approved");

            const [updatedUser] = await db.select().from(users).where(eq(users.id, tenant.id)).limit(1);
            expect(updatedUser?.isVerified).toBe(true);
        });

        it("rejects a verification, requiring reviewNotes", async () => {
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });
            const { user: tenant } = await createUser({ role: "tenant", isVerified: false });

            const [verification] = await db
                .insert(identityVerifications)
                .values({ userId: tenant.id, documentUrl: "docs/id2.png" })
                .returning();
            expect(verification).toBeDefined();

            const missingNotesRes = await testRequest()
                .patch(`/api/v1/admin/identity-verifications/${verification!.id}/reject`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({});
            expect(missingNotesRes.status).toBe(400);

            const res = await testRequest()
                .patch(`/api/v1/admin/identity-verifications/${verification!.id}/reject`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ reviewNotes: "Document is blurry, please resubmit." });
            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe("rejected");

            const [updatedUser] = await db.select().from(users).where(eq(users.id, tenant.id)).limit(1);
            expect(updatedUser?.isVerified).toBe(false);
        });
    });

    describe("Property moderation", () => {
        it("deactivates a property, rejects double-deactivation, then reactivates", async () => {
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });
            const { user: owner } = await createUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });

            const deactivateRes = await testRequest()
                .patch(`/api/v1/admin/properties/${property.id}/deactivate`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ reason: "Listing violates platform policy." });
            expect(deactivateRes.status).toBe(200);
            expect(deactivateRes.body.data.isActive).toBe(false);

            const conflictRes = await testRequest()
                .patch(`/api/v1/admin/properties/${property.id}/deactivate`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ reason: "Listing violates platform policy." });
            expect(conflictRes.status).toBe(409);

            const reactivateRes = await testRequest()
                .patch(`/api/v1/admin/properties/${property.id}/reactivate`)
                .set("Authorization", `Bearer ${adminToken}`);
            expect(reactivateRes.status).toBe(200);
            expect(reactivateRes.body.data.isActive).toBe(true);
        });
    });

    describe("Platform settings", () => {
        it("upserts a setting and reflects the latest value on subsequent upserts", async () => {
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });

            const createRes = await testRequest()
                .put("/api/v1/admin/settings/maintenance_mode")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ value: { enabled: false } });
            expect(createRes.status).toBe(200);

            const listRes = await testRequest()
                .get("/api/v1/admin/settings")
                .set("Authorization", `Bearer ${adminToken}`);
            expect(listRes.status).toBe(200);
            const setting = listRes.body.data.find((s: { key: string }) => s.key === "maintenance_mode");
            expect(setting?.value).toEqual({ enabled: false });

            const updateRes = await testRequest()
                .put("/api/v1/admin/settings/maintenance_mode")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ value: { enabled: true } });
            expect(updateRes.status).toBe(200);
            expect(updateRes.body.data.value).toEqual({ enabled: true });

            const secondListRes = await testRequest()
                .get("/api/v1/admin/settings")
                .set("Authorization", `Bearer ${adminToken}`);
            const updatedSetting = secondListRes.body.data.find((s: { key: string }) => s.key === "maintenance_mode");
            expect(updatedSetting?.value).toEqual({ enabled: true });
        });
    });

    describe("GET /api/v1/admin/audit-logs", () => {
        it("lists audit log entries produced by admin actions", async () => {
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });
            const { user: tenant } = await createUser({ role: "tenant" });

            await testRequest()
                .patch(`/api/v1/admin/users/${tenant.id}/status`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ isActive: false });

            const res = await testRequest()
                .get("/api/v1/admin/audit-logs?entity=user&action=admin.user.status_update")
                .set("Authorization", `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(
                res.body.data.some(
                    (log: { action: string; entity: string; entityId: string }) =>
                        log.action === "admin.user.status_update" && log.entity === "user" && log.entityId === tenant.id
                )
            ).toBe(true);
        });
    });

    describe("POST /api/v1/admin/house-owners", () => {
        it("creates an owner account with a 201 and emails a working set-password link", async () => {
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });
            const mockedSendMail = emailService.sendMail as jest.Mock;
            mockedSendMail.mockClear();

            const res = await testRequest()
                .post("/api/v1/admin/house-owners")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ email: "newowner@example.com", firstName: "New", lastName: "Owner", phone: "0788000123" });

            expect(res.status).toBe(201);
            expect(res.body.data.role).toBe("owner");
            expect(res.body.data.passwordHash).toBeUndefined();
            expect(mockedSendMail).toHaveBeenCalledTimes(1);

            const html = mockedSendMail.mock.calls[0][0].html as string;
            const token = extractToken(html);

            const setPasswordRes = await testRequest()
                .post("/api/v1/auth/reset-password")
                .send({ token, newPassword: "NewOwnerPass1!" });
            expect(setPasswordRes.status).toBe(200);

            const loginRes = await testRequest()
                .post("/api/v1/auth/login")
                .send({ email: "newowner@example.com", password: "NewOwnerPass1!" });
            expect(loginRes.status).toBe(200);
        });

        it("rejects a duplicate email with 409", async () => {
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });
            await createUser({ email: "dupe-owner@example.com" });

            const res = await testRequest()
                .post("/api/v1/admin/house-owners")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ email: "dupe-owner@example.com", firstName: "New", lastName: "Owner", phone: "0788000124" });

            expect(res.status).toBe(409);
        });
    });

    describe("Suspension requests", () => {
        it("lets an admin approve a suspension request, deactivating the target user", async () => {
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });
            const { user: owner, accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            const { user: target } = await createUser({ role: "tenant" });
            const property = await createProperty({ ownerId: owner.id });
            await createLease({ propertyId: property.id, ownerId: owner.id, tenantId: target.id });

            const createRes = await testRequest()
                .post("/api/v1/iam/suspension-requests")
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({ targetUserId: target.id, reason: "Repeated policy violations" });
            expect(createRes.status).toBe(201);

            const listRes = await testRequest()
                .get("/api/v1/admin/suspension-requests?status=pending")
                .set("Authorization", `Bearer ${adminToken}`);
            expect(listRes.status).toBe(200);
            expect(listRes.body.data.some((r: { id: string }) => r.id === createRes.body.data.id)).toBe(true);

            const approveRes = await testRequest()
                .patch(`/api/v1/admin/suspension-requests/${createRes.body.data.id}/approve`)
                .set("Authorization", `Bearer ${adminToken}`);
            expect(approveRes.status).toBe(200);
            expect(approveRes.body.data.status).toBe("approved");

            const [updatedUser] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
            expect(updatedUser?.isActive).toBe(false);
        });

        it("lets an admin reject a suspension request, leaving the target user active", async () => {
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });
            const { user: owner, accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            const { user: target } = await createUser({ role: "tenant" });
            const property = await createProperty({ ownerId: owner.id });
            await createLease({ propertyId: property.id, ownerId: owner.id, tenantId: target.id });

            const createRes = await testRequest()
                .post("/api/v1/iam/suspension-requests")
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({ targetUserId: target.id, reason: "Minor complaint" });

            const rejectRes = await testRequest()
                .patch(`/api/v1/admin/suspension-requests/${createRes.body.data.id}/reject`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ decisionNotes: "Not severe enough" });
            expect(rejectRes.status).toBe(200);
            expect(rejectRes.body.data.status).toBe("rejected");

            const [updatedUser] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
            expect(updatedUser?.isActive).toBe(true);
        });
    });
});
