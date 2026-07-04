import { testRequest } from "../../../../tests/helpers/app";
import {
    createAuthedUser,
    createLease,
    createMaintenanceRequest,
    createProperty,
    createUser
} from "../../../../tests/helpers/factories";

jest.mock("../../../services/email.service", () => ({
    sendMail: jest.fn().mockResolvedValue(undefined)
}));

async function setupTenantWithActiveLease() {
    const { user: owner, accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
    const property = await createProperty({ ownerId: owner.id, status: "occupied", approvalStatus: "approved" });
    const { user: tenant, accessToken: tenantToken } = await createAuthedUser({ role: "tenant" });
    const lease = await createLease({ propertyId: property.id, tenantId: tenant.id, ownerId: owner.id, status: "active" });
    return { owner, ownerToken, property, tenant, tenantToken, lease };
}

describe("Maintenance module", () => {
    describe("POST /api/v1/maintenance-requests", () => {
        it("allows a tenant with an active lease to submit a maintenance request", async () => {
            const { tenantToken, property } = await setupTenantWithActiveLease();

            const res = await testRequest()
                .post("/api/v1/maintenance-requests")
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({
                    propertyId: property.id,
                    title: "Leaking faucet",
                    description: "The kitchen faucet has been leaking for two days."
                });

            expect(res.status).toBe(201);
            expect(res.body.data.status).toBe("submitted");
            expect(res.body.data.propertyId).toBe(property.id);
        });

        it("forbids a tenant without an active lease on the property", async () => {
            const { user: owner } = await createUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id, approvalStatus: "approved" });
            const { accessToken: tenantToken } = await createAuthedUser({ role: "tenant" });

            const res = await testRequest()
                .post("/api/v1/maintenance-requests")
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({
                    propertyId: property.id,
                    title: "Broken window",
                    description: "The living room window will not close."
                });

            expect(res.status).toBe(403);
        });
    });

    describe("GET /api/v1/maintenance-requests and /:id", () => {
        it("allows the owner to list/get requests for their properties; an unrelated owner cannot", async () => {
            const { ownerToken, property, tenant } = await setupTenantWithActiveLease();
            const request = await createMaintenanceRequest({ propertyId: property.id, tenantId: tenant.id });

            const listRes = await testRequest()
                .get("/api/v1/maintenance-requests")
                .set("Authorization", `Bearer ${ownerToken}`);
            expect(listRes.status).toBe(200);
            expect(listRes.body.data.some((r: { id: string }) => r.id === request.id)).toBe(true);

            const getRes = await testRequest()
                .get(`/api/v1/maintenance-requests/${request.id}`)
                .set("Authorization", `Bearer ${ownerToken}`);
            expect(getRes.status).toBe(200);
            expect(getRes.body.data.id).toBe(request.id);

            const { accessToken: otherOwnerToken } = await createAuthedUser({ role: "owner" });
            const otherListRes = await testRequest()
                .get("/api/v1/maintenance-requests")
                .set("Authorization", `Bearer ${otherOwnerToken}`);
            expect(otherListRes.status).toBe(200);
            expect(otherListRes.body.data.some((r: { id: string }) => r.id === request.id)).toBe(false);

            const otherGetRes = await testRequest()
                .get(`/api/v1/maintenance-requests/${request.id}`)
                .set("Authorization", `Bearer ${otherOwnerToken}`);
            expect(otherGetRes.status).toBe(403);
        });
    });

    describe("PATCH /api/v1/maintenance-requests/:id/assign", () => {
        it("assigns to an agent user and moves status to assigned; rejects assigning to a tenant", async () => {
            const { ownerToken, property, tenant } = await setupTenantWithActiveLease();
            const request = await createMaintenanceRequest({ propertyId: property.id, tenantId: tenant.id });
            const { user: agent } = await createAuthedUser({ role: "agent" });

            const res = await testRequest()
                .patch(`/api/v1/maintenance-requests/${request.id}/assign`)
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({ assignedTo: agent.id });

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe("assigned");
            expect(res.body.data.assignedTo).toBe(agent.id);

            const otherRequest = await createMaintenanceRequest({ propertyId: property.id, tenantId: tenant.id });
            const badRes = await testRequest()
                .patch(`/api/v1/maintenance-requests/${otherRequest.id}/assign`)
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({ assignedTo: tenant.id });

            expect(badRes.status).toBe(400);
        });
    });

    describe("PATCH /api/v1/maintenance-requests/:id/status", () => {
        it("allows the assignee or owner to move to in_progress; rejects if not yet assigned", async () => {
            const { ownerToken, property, tenant } = await setupTenantWithActiveLease();
            const { user: agent, accessToken: agentToken } = await createAuthedUser({ role: "agent" });
            const request = await createMaintenanceRequest({
                propertyId: property.id,
                tenantId: tenant.id,
                status: "assigned",
                assignedTo: agent.id
            });

            const res = await testRequest()
                .patch(`/api/v1/maintenance-requests/${request.id}/status`)
                .set("Authorization", `Bearer ${agentToken}`)
                .send({ status: "in_progress" });

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe("in_progress");

            const freshRequest = await createMaintenanceRequest({ propertyId: property.id, tenantId: tenant.id });
            const conflictRes = await testRequest()
                .patch(`/api/v1/maintenance-requests/${freshRequest.id}/status`)
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({ status: "in_progress" });

            expect(conflictRes.status).toBe(409);
        });
    });

    describe("PATCH /api/v1/maintenance-requests/:id/complete", () => {
        it("completes the request with costs and notes", async () => {
            const { ownerToken, property, tenant } = await setupTenantWithActiveLease();
            const request = await createMaintenanceRequest({
                propertyId: property.id,
                tenantId: tenant.id,
                status: "in_progress"
            });

            const res = await testRequest()
                .patch(`/api/v1/maintenance-requests/${request.id}/complete`)
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({ itemsCost: 50, laborCost: 30, completionNotes: "Replaced the washer" });

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe("completed");
            expect(res.body.data.completedAt).toBeTruthy();
            expect(res.body.data.itemsCost).toBe("50.00");
            expect(res.body.data.laborCost).toBe("30.00");
        });
    });

    describe("Maintenance feedback", () => {
        it("allows the tenant to submit feedback once, validates rating, and restricts other tenants", async () => {
            const { tenantToken, property, tenant } = await setupTenantWithActiveLease();
            const request = await createMaintenanceRequest({
                propertyId: property.id,
                tenantId: tenant.id,
                status: "completed",
                completedAt: new Date()
            });

            const invalidRes = await testRequest()
                .post(`/api/v1/maintenance-requests/${request.id}/feedback`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ rating: 6 });
            expect(invalidRes.status).toBe(400);

            const res = await testRequest()
                .post(`/api/v1/maintenance-requests/${request.id}/feedback`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ rating: 5, comment: "Great job" });
            expect(res.status).toBe(201);
            expect(res.body.data.rating).toBe(5);

            const duplicateRes = await testRequest()
                .post(`/api/v1/maintenance-requests/${request.id}/feedback`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ rating: 4 });
            expect(duplicateRes.status).toBe(409);

            const { accessToken: otherTenantToken } = await createAuthedUser({ role: "tenant" });
            const forbiddenRes = await testRequest()
                .post(`/api/v1/maintenance-requests/${request.id}/feedback`)
                .set("Authorization", `Bearer ${otherTenantToken}`)
                .send({ rating: 3 });
            expect(forbiddenRes.status).toBe(403);

            const getRes = await testRequest()
                .get(`/api/v1/maintenance-requests/${request.id}/feedback`)
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(getRes.status).toBe(200);
            expect(getRes.body.data.rating).toBe(5);
        });
    });
});
