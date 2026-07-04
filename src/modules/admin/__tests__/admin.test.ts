import { eq } from "drizzle-orm";
import { testRequest } from "../../../../tests/helpers/app";
import { createAuthedUser, createProperty, createUser } from "../../../../tests/helpers/factories";
import { db } from "../../../database";
import { identityVerifications, users } from "../../../database/schema";

jest.mock("../../../services/email.service", () => ({
    sendMail: jest.fn().mockResolvedValue(undefined)
}));

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
});
