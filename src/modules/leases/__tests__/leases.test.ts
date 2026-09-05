import { eq } from "drizzle-orm";
import { testRequest } from "../../../../tests/helpers/app";
import { createAuthedUser, createLease, createProperty } from "../../../../tests/helpers/factories";
import { db } from "../../../database";
import { properties, propertyUnits, users } from "../../../database/schema";
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
    const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.propertyId, property.id)).limit(1);
    if (!unit) throw new Error("Expected createProperty to auto-create a default unit");
    return { owner, ownerToken, tenant, tenantToken, property, unit };
}

describe("Leases module", () => {
    describe("POST /api/v1/leases", () => {
        it("allows an owner to create a lease for an available property", async () => {
            const { ownerToken, tenant, property, unit } = await setupOwnerTenantProperty();

            const res = await testRequest()
                .post("/api/v1/leases")
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({
                    propertyId: property.id,
                    unitId: unit.id,
                    tenantId: tenant.id,
                    startDate: "2026-01-01",
                    endDate: "2026-12-31",
                    rentAmount: 800
                });

            expect(res.status).toBe(201);
            expect(res.body.data.status).toBe("pending_signatures");
            expect(res.body.data.ownerId).toBe(property.ownerId);
        });

        it("rejects lease creation for a non-available unit", async () => {
            const { ownerToken, tenant, property, unit } = await setupOwnerTenantProperty({ propertyStatus: "occupied" });

            const res = await testRequest()
                .post("/api/v1/leases")
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({
                    propertyId: property.id,
                    unitId: unit.id,
                    tenantId: tenant.id,
                    startDate: "2026-01-01",
                    endDate: "2026-12-31",
                    rentAmount: 800
                });

            expect(res.status).toBe(409);
        });

        it("allows creating an open-ended lease with no endDate, and an optional paymentDate", async () => {
            const { ownerToken, tenant, property, unit } = await setupOwnerTenantProperty();

            const res = await testRequest()
                .post("/api/v1/leases")
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({
                    propertyId: property.id,
                    unitId: unit.id,
                    tenantId: tenant.id,
                    startDate: "2026-01-01",
                    paymentDate: "2026-01-05",
                    rentAmount: 800
                });

            expect(res.status).toBe(201);
            expect(res.body.data.endDate).toBeNull();
            expect(res.body.data.paymentDate).toBe("2026-01-05");
        });

        it("registers a brand-new tenant and assigns them the unit in one step", async () => {
            const { user: owner, accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id, approvalStatus: "approved" });
            const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.propertyId, property.id)).limit(1);

            const res = await testRequest()
                .post("/api/v1/leases")
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({
                    propertyId: property.id,
                    unitId: unit!.id,
                    newTenant: {
                        email: "new-tenant@example.com",
                        firstName: "New",
                        lastName: "Tenant",
                        phone: "0788000111"
                    },
                    startDate: "2026-01-01",
                    rentAmount: 800
                });

            expect(res.status).toBe(201);
            expect(res.body.data.status).toBe("pending_signatures");

            const [createdTenant] = await db.select().from(users).where(eq(users.email, "new-tenant@example.com")).limit(1);
            expect(createdTenant).toBeDefined();
            expect(createdTenant!.role).toBe("tenant");
            expect(res.body.data.tenantId).toBe(createdTenant!.id);

            const [updatedUnit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, unit!.id)).limit(1);
            expect(updatedUnit!.status).toBe("available"); // still available until signed, matching existing behavior
        });

        it("rejects newTenant with an email that already exists, and creates no lease", async () => {
            const { user: owner, accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            const { user: existingTenant } = await createAuthedUser({ role: "tenant" });
            const property = await createProperty({ ownerId: owner.id, approvalStatus: "approved" });
            const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.propertyId, property.id)).limit(1);

            const res = await testRequest()
                .post("/api/v1/leases")
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({
                    propertyId: property.id,
                    unitId: unit!.id,
                    newTenant: {
                        email: existingTenant.email,
                        firstName: "Dup",
                        lastName: "Licate",
                        phone: "0788000222"
                    },
                    startDate: "2026-01-01",
                    rentAmount: 800
                });

            expect(res.status).toBe(409);

            const [stillAvailable] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, unit!.id)).limit(1);
            expect(stillAvailable!.status).toBe("available");
        });

        it("rejects a request that provides both tenantId and newTenant, or neither", async () => {
            const { ownerToken, tenant, property, unit } = await setupOwnerTenantProperty();

            const bothRes = await testRequest()
                .post("/api/v1/leases")
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({
                    propertyId: property.id,
                    unitId: unit.id,
                    tenantId: tenant.id,
                    newTenant: { email: "x@example.com", firstName: "X", lastName: "Y", phone: "0788000333" },
                    startDate: "2026-01-01",
                    rentAmount: 800
                });
            expect(bothRes.status).toBe(400);

            const neitherRes = await testRequest()
                .post("/api/v1/leases")
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({ propertyId: property.id, unitId: unit.id, startDate: "2026-01-01", rentAmount: 800 });
            expect(neitherRes.status).toBe(400);
        });
    });

    describe("Lease documents", () => {
        it("allows an optional document upload and lets either party confirm it", async () => {
            const { ownerToken, tenantToken, tenant, property } = await setupOwnerTenantProperty();
            const lease = await createLease({ propertyId: property.id, tenantId: tenant.id, ownerId: property.ownerId });

            const uploadRes = await testRequest()
                .post(`/api/v1/leases/${lease.id}/documents`)
                .set("Authorization", `Bearer ${ownerToken}`)
                .attach("documents", Buffer.from("scan"), "signed-lease.pdf");
            expect(uploadRes.status).toBe(201);
            expect(uploadRes.body.data).toHaveLength(1);

            const listRes = await testRequest()
                .get(`/api/v1/leases/${lease.id}/documents`)
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(listRes.status).toBe(200);
            expect(listRes.body.data).toHaveLength(1);

            const confirmRes = await testRequest()
                .patch(`/api/v1/leases/${lease.id}/documents/confirm`)
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(confirmRes.status).toBe(200);
            expect(confirmRes.body.data.documentsConfirmed).toBe(true);

            const secondConfirmRes = await testRequest()
                .patch(`/api/v1/leases/${lease.id}/documents/confirm`)
                .set("Authorization", `Bearer ${ownerToken}`);
            expect(secondConfirmRes.status).toBe(409);
        });

        it("forbids an unrelated user from uploading lease documents", async () => {
            const { tenant, property } = await setupOwnerTenantProperty();
            const lease = await createLease({ propertyId: property.id, tenantId: tenant.id, ownerId: property.ownerId });
            const { accessToken: outsiderToken } = await createAuthedUser({ role: "tenant" });

            const res = await testRequest()
                .post(`/api/v1/leases/${lease.id}/documents`)
                .set("Authorization", `Bearer ${outsiderToken}`)
                .attach("documents", Buffer.from("scan"), "signed-lease.pdf");
            expect(res.status).toBe(403);
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

    describe("Multi-unit properties", () => {
        it("leases separate units independently and rolls up the property's status/occupiedUnits correctly", async () => {
            const { user: owner, accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id, status: "available", approvalStatus: "approved" });

            const [unit1] = await db.select().from(propertyUnits).where(eq(propertyUnits.propertyId, property.id)).limit(1);
            if (!unit1) throw new Error("Expected createProperty to auto-create a default unit");

            const addUnitRes = await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({ label: "Unit 2", rentAmount: 900 });
            expect(addUnitRes.status).toBe(201);
            const unit2Id = addUnitRes.body.data.id as string;

            const { user: tenantA, accessToken: tenantAToken } = await createAuthedUser({ role: "tenant" });
            const { user: tenantB, accessToken: tenantBToken } = await createAuthedUser({ role: "tenant" });

            async function createAndSignLease(unitId: string, tenantId: string, tenantToken: string) {
                const createRes = await testRequest()
                    .post("/api/v1/leases")
                    .set("Authorization", `Bearer ${ownerToken}`)
                    .send({
                        propertyId: property.id,
                        unitId,
                        tenantId,
                        startDate: "2026-01-01",
                        endDate: "2026-12-31",
                        rentAmount: 800
                    });
                expect(createRes.status).toBe(201);
                const leaseId = createRes.body.data.id as string;

                await testRequest().post(`/api/v1/leases/${leaseId}/sign`).set("Authorization", `Bearer ${tenantToken}`);
                const signRes = await testRequest()
                    .post(`/api/v1/leases/${leaseId}/sign`)
                    .set("Authorization", `Bearer ${ownerToken}`);
                expect(signRes.status).toBe(200);
                expect(signRes.body.data.status).toBe("active");

                return leaseId;
            }

            const leaseAId = await createAndSignLease(unit1.id, tenantA.id, tenantAToken);

            const propAfterFirst = await testRequest()
                .get(`/api/v1/properties/${property.id}`)
                .set("Authorization", `Bearer ${ownerToken}`);
            expect(propAfterFirst.body.data.status).toBe("available");
            expect(propAfterFirst.body.data.totalUnits).toBe(2);
            expect(propAfterFirst.body.data.occupiedUnits).toBe(1);

            await createAndSignLease(unit2Id, tenantB.id, tenantBToken);

            const propAfterBoth = await testRequest()
                .get(`/api/v1/properties/${property.id}`)
                .set("Authorization", `Bearer ${ownerToken}`);
            expect(propAfterBoth.body.data.status).toBe("occupied");
            expect(propAfterBoth.body.data.occupiedUnits).toBe(2);

            const conflictRes = await testRequest()
                .post("/api/v1/leases")
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({
                    propertyId: property.id,
                    unitId: unit2Id,
                    tenantId: tenantA.id,
                    startDate: "2026-01-01",
                    endDate: "2026-12-31",
                    rentAmount: 800
                });
            expect(conflictRes.status).toBe(409);

            const termRes = await testRequest()
                .post(`/api/v1/leases/${leaseAId}/termination-requests`)
                .set("Authorization", `Bearer ${tenantAToken}`)
                .send({});
            expect(termRes.status).toBe(201);

            const approveRes = await testRequest()
                .patch(`/api/v1/leases/change-requests/${termRes.body.data.id}/approve`)
                .set("Authorization", `Bearer ${ownerToken}`);
            expect(approveRes.status).toBe(200);

            const propAfterTermination = await testRequest()
                .get(`/api/v1/properties/${property.id}`)
                .set("Authorization", `Bearer ${ownerToken}`);
            expect(propAfterTermination.body.data.status).toBe("available");
            expect(propAfterTermination.body.data.occupiedUnits).toBe(1);
        });
    });

    describe("GET /api/v1/leases", () => {
        it("filters by propertyId", async () => {
            const { user: owner, accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            const { user: tenant } = await createAuthedUser({ role: "tenant" });
            const propertyA = await createProperty({ ownerId: owner.id, approvalStatus: "approved" });
            const propertyB = await createProperty({ ownerId: owner.id, approvalStatus: "approved" });
            const leaseA = await createLease({ propertyId: propertyA.id, ownerId: owner.id, tenantId: tenant.id });
            await createLease({ propertyId: propertyB.id, ownerId: owner.id, tenantId: tenant.id });

            const res = await testRequest()
                .get(`/api/v1/leases?propertyId=${propertyA.id}`)
                .set("Authorization", `Bearer ${ownerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].id).toBe(leaseA.id);
        });
    });
});
