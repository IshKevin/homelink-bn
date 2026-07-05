import { eq } from "drizzle-orm";
import { testRequest } from "../../../../tests/helpers/app";
import { createAuthedUser, createLease, createProperty } from "../../../../tests/helpers/factories";
import { db } from "../../../database";
import { properties } from "../../../database/schema";
import * as storageService from "../../../services/storage.service";

jest.mock("../../../services/storage.service", () => ({
    buildObjectKey: jest.fn().mockReturnValue("leases/mock-key.pdf"),
    uploadBuffer: jest.fn().mockResolvedValue("leases/mock-key.pdf"),
    getPresignedDownloadUrl: jest.fn().mockResolvedValue("https://example.com/signed"),
    deleteObject: jest.fn().mockResolvedValue(undefined)
}));

jest.mock("../../../services/pdf.service", () => ({
    renderHtmlToPdf: jest.fn().mockResolvedValue(Buffer.from("pdf"))
}));

jest.mock("../../../services/email.service", () => ({
    sendMail: jest.fn().mockResolvedValue(undefined)
}));

async function setupOwnerTenantProperty(overrides: { propertyStatus?: "available" | "occupied" } = {}) {
    const { user: owner, accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
    const { user: tenant, accessToken: tenantToken } = await createAuthedUser({ role: "tenant" });
    const property = await createProperty({
        ownerId: owner.id,
        status: overrides.propertyStatus ?? "available",
        approvalStatus: "approved"
    });
    return { owner, ownerToken, tenant, tenantToken, property };
}

describe("Leases module", () => {
    describe("POST /api/v1/leases", () => {
        it("allows an owner to create a lease for an available property", async () => {
            const { ownerToken, tenant, property } = await setupOwnerTenantProperty();

            const res = await testRequest()
                .post("/api/v1/leases")
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({
                    propertyId: property.id,
                    tenantId: tenant.id,
                    startDate: "2026-01-01",
                    endDate: "2026-12-31",
                    rentAmount: 800
                });

            expect(res.status).toBe(201);
            expect(res.body.data.status).toBe("pending_signatures");
            expect(res.body.data.ownerId).toBe(property.ownerId);
        });

        it("rejects lease creation for a non-available property", async () => {
            const { ownerToken, tenant, property } = await setupOwnerTenantProperty({ propertyStatus: "occupied" });

            const res = await testRequest()
                .post("/api/v1/leases")
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({
                    propertyId: property.id,
                    tenantId: tenant.id,
                    startDate: "2026-01-01",
                    endDate: "2026-12-31",
                    rentAmount: 800
                });

            expect(res.status).toBe(409);
        });
    });

    describe("Signing a lease", () => {
        it("activates the lease and creates a move-in request once both parties sign", async () => {
            const { owner, ownerToken, tenant, tenantToken, property } = await setupOwnerTenantProperty();
            const lease = await createLease({
                propertyId: property.id,
                tenantId: tenant.id,
                ownerId: owner.id,
                status: "pending_signatures"
            });

            const firstSign = await testRequest()
                .post(`/api/v1/leases/${lease.id}/sign`)
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(firstSign.status).toBe(200);
            expect(firstSign.body.data.status).toBe("pending_signatures");

            const secondSign = await testRequest()
                .post(`/api/v1/leases/${lease.id}/sign`)
                .set("Authorization", `Bearer ${ownerToken}`);
            expect(secondSign.status).toBe(200);
            expect(secondSign.body.data.status).toBe("active");
            expect(secondSign.body.data.documentUrl).toBeTruthy();

            const [updatedProperty] = await db.select().from(properties).where(eq(properties.id, property.id)).limit(1);
            expect(updatedProperty?.status).toBe("occupied");

            const moveRequestsRes = await testRequest()
                .get(`/api/v1/leases/${lease.id}/move-requests`)
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(moveRequestsRes.status).toBe(200);
            expect(moveRequestsRes.body.data.some((m: { type: string }) => m.type === "move_in")).toBe(true);
        });
    });

    describe("Move-in requests", () => {
        it("marks the auto-created move-in request completed once every checklist item is done", async () => {
            const { owner, ownerToken, tenant, tenantToken, property } = await setupOwnerTenantProperty();
            const lease = await createLease({
                propertyId: property.id,
                tenantId: tenant.id,
                ownerId: owner.id,
                status: "pending_signatures"
            });

            await testRequest().post(`/api/v1/leases/${lease.id}/sign`).set("Authorization", `Bearer ${tenantToken}`);
            await testRequest().post(`/api/v1/leases/${lease.id}/sign`).set("Authorization", `Bearer ${ownerToken}`);

            const moveRequestsRes = await testRequest()
                .get(`/api/v1/leases/${lease.id}/move-requests`)
                .set("Authorization", `Bearer ${tenantToken}`);
            const moveIn = moveRequestsRes.body.data.find((m: { type: string }) => m.type === "move_in");
            const checklist = moveIn.checklist.map((item: { label: string }) => ({ label: item.label, done: true }));

            const partialRes = await testRequest()
                .patch(`/api/v1/leases/move-requests/${moveIn.id}/checklist`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ checklist: [{ ...checklist[0], done: true }, ...checklist.slice(1).map((c: object) => ({ ...c, done: false }))] });
            expect(partialRes.status).toBe(200);
            expect(partialRes.body.data.status).toBe("in_progress");

            const completeRes = await testRequest()
                .patch(`/api/v1/leases/move-requests/${moveIn.id}/checklist`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ checklist });
            expect(completeRes.status).toBe(200);
            expect(completeRes.body.data.status).toBe("completed");
            expect(completeRes.body.data.completedAt).toBeTruthy();

            const reopenRes = await testRequest()
                .patch(`/api/v1/leases/move-requests/${moveIn.id}/checklist`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ checklist });
            expect(reopenRes.status).toBe(409);
        });
    });

    describe("GET /api/v1/leases/:id", () => {
        it("allows the tenant to view their lease but forbids an unrelated tenant", async () => {
            const { owner, tenant, tenantToken, property } = await setupOwnerTenantProperty();
            const lease = await createLease({ propertyId: property.id, tenantId: tenant.id, ownerId: owner.id });

            const res = await testRequest().get(`/api/v1/leases/${lease.id}`).set("Authorization", `Bearer ${tenantToken}`);
            expect(res.status).toBe(200);
            expect(res.body.data.id).toBe(lease.id);

            const { accessToken: otherTenantToken } = await createAuthedUser({ role: "tenant" });
            const forbiddenRes = await testRequest()
                .get(`/api/v1/leases/${lease.id}`)
                .set("Authorization", `Bearer ${otherTenantToken}`);
            expect(forbiddenRes.status).toBe(403);
        });
    });

    describe("GET /api/v1/leases/:id/document", () => {
        it("returns a presigned URL when the lease document has been generated", async () => {
            const { owner, tenant, tenantToken, property } = await setupOwnerTenantProperty();
            const lease = await createLease({
                propertyId: property.id,
                tenantId: tenant.id,
                ownerId: owner.id,
                documentUrl: "leases/existing.pdf"
            });

            const res = await testRequest()
                .get(`/api/v1/leases/${lease.id}/document`)
                .set("Authorization", `Bearer ${tenantToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.url).toBe("https://example.com/signed");
            expect(storageService.getPresignedDownloadUrl).toHaveBeenCalledWith("leases/existing.pdf");
        });
    });

    describe("Renewal requests", () => {
        it("allows a tenant to request renewal and the owner to approve it", async () => {
            const { owner, ownerToken, tenant, tenantToken, property } = await setupOwnerTenantProperty();
            const lease = await createLease({ propertyId: property.id, tenantId: tenant.id, ownerId: owner.id, rentAmount: 800 });

            const requestRes = await testRequest()
                .post(`/api/v1/leases/${lease.id}/renewal-requests`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ proposedRent: 900 });
            expect(requestRes.status).toBe(201);

            const leaseAfterRequest = await testRequest()
                .get(`/api/v1/leases/${lease.id}`)
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(leaseAfterRequest.body.data.status).toBe("pending_renewal");

            const changeRequestId = requestRes.body.data.id;
            const approveRes = await testRequest()
                .patch(`/api/v1/leases/change-requests/${changeRequestId}/approve`)
                .set("Authorization", `Bearer ${ownerToken}`);
            expect(approveRes.status).toBe(200);
            expect(approveRes.body.data.status).toBe("approved");

            const leaseAfterApproval = await testRequest()
                .get(`/api/v1/leases/${lease.id}`)
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(leaseAfterApproval.body.data.status).toBe("active");
            expect(leaseAfterApproval.body.data.rentAmount).toBe("900.00");
        });

        it("requires decisionNotes to reject a change request and reverts the lease to active", async () => {
            const { owner, ownerToken, tenant, tenantToken, property } = await setupOwnerTenantProperty();
            const lease = await createLease({ propertyId: property.id, tenantId: tenant.id, ownerId: owner.id });

            const requestRes = await testRequest()
                .post(`/api/v1/leases/${lease.id}/renewal-requests`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ proposedRent: 950 });
            const changeRequestId = requestRes.body.data.id;

            const rejectNoNotes = await testRequest()
                .patch(`/api/v1/leases/change-requests/${changeRequestId}/reject`)
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({});
            expect(rejectNoNotes.status).toBe(400);

            const rejectRes = await testRequest()
                .patch(`/api/v1/leases/change-requests/${changeRequestId}/reject`)
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({ decisionNotes: "Not a good time for a rent increase" });
            expect(rejectRes.status).toBe(200);
            expect(rejectRes.body.data.status).toBe("rejected");

            const leaseAfterReject = await testRequest()
                .get(`/api/v1/leases/${lease.id}`)
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(leaseAfterReject.body.data.status).toBe("active");
        });
    });

    describe("Termination requests", () => {
        it("allows a tenant to request termination and the owner to approve it, freeing the property", async () => {
            const { owner, ownerToken, tenant, tenantToken, property } = await setupOwnerTenantProperty({
                propertyStatus: "occupied"
            });
            const lease = await createLease({ propertyId: property.id, tenantId: tenant.id, ownerId: owner.id });

            const requestRes = await testRequest()
                .post(`/api/v1/leases/${lease.id}/termination-requests`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ reason: "Relocating" });
            expect(requestRes.status).toBe(201);

            const approveRes = await testRequest()
                .patch(`/api/v1/leases/change-requests/${requestRes.body.data.id}/approve`)
                .set("Authorization", `Bearer ${ownerToken}`);
            expect(approveRes.status).toBe(200);

            const leaseAfter = await testRequest()
                .get(`/api/v1/leases/${lease.id}`)
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(leaseAfter.body.data.status).toBe("terminated");

            const [updatedProperty] = await db.select().from(properties).where(eq(properties.id, property.id)).limit(1);
            expect(updatedProperty?.status).toBe("available");
        });
    });

    describe("Move-out requests", () => {
        it("allows a tenant to request move-out and the owner to inspect and complete it", async () => {
            const { owner, ownerToken, tenant, tenantToken, property } = await setupOwnerTenantProperty({
                propertyStatus: "occupied"
            });
            const lease = await createLease({ propertyId: property.id, tenantId: tenant.id, ownerId: owner.id });

            const createRes = await testRequest()
                .post(`/api/v1/leases/${lease.id}/move-requests`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ type: "move_out" });
            expect(createRes.status).toBe(201);
            const moveRequestId = createRes.body.data.id;

            const inspectRes = await testRequest()
                .patch(`/api/v1/leases/move-requests/${moveRequestId}/inspect`)
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({ inspectionNotes: "Unit is in good condition" });
            expect(inspectRes.status).toBe(200);
            expect(inspectRes.body.data.status).toBe("completed");

            const leaseAfter = await testRequest()
                .get(`/api/v1/leases/${lease.id}`)
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(leaseAfter.body.data.status).toBe("terminated");

            const [updatedProperty] = await db.select().from(properties).where(eq(properties.id, property.id)).limit(1);
            expect(updatedProperty?.status).toBe("available");
        });

        it("moves the checklist status to in_progress once at least one item is marked done", async () => {
            const { owner, tenant, tenantToken, property } = await setupOwnerTenantProperty({
                propertyStatus: "occupied"
            });
            const lease = await createLease({ propertyId: property.id, tenantId: tenant.id, ownerId: owner.id });

            const createRes = await testRequest()
                .post(`/api/v1/leases/${lease.id}/move-requests`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ type: "move_out" });
            const moveRequestId = createRes.body.data.id;

            const checklistRes = await testRequest()
                .patch(`/api/v1/leases/move-requests/${moveRequestId}/checklist`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ checklist: [{ label: "Return keys", done: true }] });

            expect(checklistRes.status).toBe(200);
            expect(checklistRes.body.data.status).toBe("in_progress");
        });
    });
});
