import { eq } from "drizzle-orm";
import { testRequest } from "../../../../tests/helpers/app";
import { createAuthedUser, createProperty, createUser } from "../../../../tests/helpers/factories";
import { db } from "../../../database";
import { properties } from "../../../database/schema";
import * as storageService from "../../../services/storage.service";

jest.mock("../../../services/storage.service", () => ({
    buildObjectKey: jest.fn().mockReturnValue("properties/mock-key.png"),
    uploadBuffer: jest.fn().mockResolvedValue("properties/mock-key.png"),
    deleteObject: jest.fn().mockResolvedValue(undefined)
}));

jest.mock("../../../services/email.service", () => ({
    sendMail: jest.fn().mockResolvedValue(undefined)
}));

const validPropertyPayload = {
    title: "Cozy Apartment",
    type: "apartment",
    category: "residential",
    unitsCount: 4,
    addressLine: "123 Main St",
    city: "Kigali",
    country: "Rwanda",
    rentAmount: 500
};

describe("Properties module", () => {
    describe("POST /api/v1/properties", () => {
        it("allows an owner to create a property", async () => {
            const { accessToken } = await createAuthedUser({ role: "owner" });

            const res = await testRequest()
                .post("/api/v1/properties")
                .set("Authorization", `Bearer ${accessToken}`)
                .send(validPropertyPayload);

            expect(res.status).toBe(201);
            expect(res.body.data.approvalStatus).toBe("pending");
            expect(res.body.data.status).toBe("available");
        });

        it("requires an ownerId when an agent creates on behalf of an owner", async () => {
            const { accessToken } = await createAuthedUser({ role: "agent" });

            const res = await testRequest()
                .post("/api/v1/properties")
                .set("Authorization", `Bearer ${accessToken}`)
                .send(validPropertyPayload);

            expect(res.status).toBe(400);
        });

        it("allows an agent to create a property on behalf of an owner", async () => {
            const { accessToken } = await createAuthedUser({ role: "agent" });
            const { user: owner } = await createUser({ role: "owner" });

            const res = await testRequest()
                .post("/api/v1/properties")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ ...validPropertyPayload, ownerId: owner.id });

            expect(res.status).toBe(201);
            expect(res.body.data.ownerId).toBe(owner.id);
        });

        it("rejects a tenant from creating a property", async () => {
            const { accessToken } = await createAuthedUser({ role: "tenant" });

            const res = await testRequest()
                .post("/api/v1/properties")
                .set("Authorization", `Bearer ${accessToken}`)
                .send(validPropertyPayload);

            expect(res.status).toBe(403);
        });

        it("rejects an unapproved agent from creating a property", async () => {
            const { accessToken } = await createAuthedUser({ role: "agent", isApproved: false });
            const { user: owner } = await createUser({ role: "owner" });

            const res = await testRequest()
                .post("/api/v1/properties")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ ...validPropertyPayload, ownerId: owner.id });

            expect(res.status).toBe(403);
        });

        it("requires sizeSqm and type 'commercial' for a commercial-category property", async () => {
            const { accessToken } = await createAuthedUser({ role: "owner" });

            const missingSize = await testRequest()
                .post("/api/v1/properties")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ ...validPropertyPayload, category: "commercial", type: "commercial", unitsCount: undefined });
            expect(missingSize.status).toBe(400);

            const wrongType = await testRequest()
                .post("/api/v1/properties")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ ...validPropertyPayload, category: "commercial", type: "apartment", sizeSqm: 250 });
            expect(wrongType.status).toBe(400);

            const valid = await testRequest()
                .post("/api/v1/properties")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ ...validPropertyPayload, category: "commercial", type: "commercial", sizeSqm: 250, unitsCount: undefined });
            expect(valid.status).toBe(201);
            expect(valid.body.data.category).toBe("commercial");
            expect(valid.body.data.sizeSqm).toBe("250.00");
        });

        it("requires unitsCount (doors) for a residential apartment", async () => {
            const { accessToken } = await createAuthedUser({ role: "owner" });

            const missingUnits = await testRequest()
                .post("/api/v1/properties")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ ...validPropertyPayload, category: "residential", type: "apartment", unitsCount: undefined });
            expect(missingUnits.status).toBe(400);

            const valid = await testRequest()
                .post("/api/v1/properties")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ ...validPropertyPayload, category: "residential", type: "apartment", unitsCount: 6 });
            expect(valid.status).toBe(201);
            expect(valid.body.data.unitsCount).toBe(6);
        });
    });

    describe("PATCH /api/v1/properties/:id", () => {
        it("allows the owner to update their own property", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });

            const res = await testRequest()
                .patch(`/api/v1/properties/${property.id}`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ title: "Updated Title" });

            expect(res.status).toBe(200);
            expect(res.body.data.title).toBe("Updated Title");
        });

        it("rejects a different owner from updating the property", async () => {
            const { user: owner } = await createUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const { accessToken: otherOwnerToken } = await createAuthedUser({ role: "owner" });

            const res = await testRequest()
                .patch(`/api/v1/properties/${property.id}`)
                .set("Authorization", `Bearer ${otherOwnerToken}`)
                .send({ title: "Hacked Title" });

            expect(res.status).toBe(403);
        });
    });

    describe("GET /api/v1/properties", () => {
        it("only returns approved and active properties to a tenant", async () => {
            const { user: owner } = await createUser({ role: "owner" });
            const approved = await createProperty({ ownerId: owner.id, approvalStatus: "approved" });
            await createProperty({ ownerId: owner.id, approvalStatus: "pending" });

            const { accessToken: tenantToken } = await createAuthedUser({ role: "tenant" });

            const res = await testRequest().get("/api/v1/properties").set("Authorization", `Bearer ${tenantToken}`);

            expect(res.status).toBe(200);
            const ids = res.body.data.map((p: { id: string }) => p.id);
            expect(ids).toContain(approved.id);
            expect(ids).toHaveLength(1);
        });
    });

    describe("GET /api/v1/properties/:id", () => {
        it("returns 404 for a tenant viewing a pending property", async () => {
            const { user: owner } = await createUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id, approvalStatus: "pending" });

            const { accessToken: tenantToken } = await createAuthedUser({ role: "tenant" });

            const res = await testRequest()
                .get(`/api/v1/properties/${property.id}`)
                .set("Authorization", `Bearer ${tenantToken}`);

            expect(res.status).toBe(404);
        });

        it("returns the property with images for the owner", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });

            const res = await testRequest()
                .get(`/api/v1/properties/${property.id}`)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.id).toBe(property.id);
            expect(res.body.data.images).toEqual([]);
        });
    });

    describe("PATCH /api/v1/properties/:id/approve and /reject", () => {
        it("allows an admin to approve a property", async () => {
            const { user: owner } = await createUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });

            const res = await testRequest()
                .patch(`/api/v1/properties/${property.id}/approve`)
                .set("Authorization", `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.approvalStatus).toBe("approved");

            const [updated] = await db.select().from(properties).where(eq(properties.id, property.id)).limit(1);
            expect(updated?.approvalStatus).toBe("approved");
        });

        it("requires a rejectionReason to reject a property", async () => {
            const { user: owner } = await createUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });

            const res = await testRequest()
                .patch(`/api/v1/properties/${property.id}/reject`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({});

            expect(res.status).toBe(400);
        });

        it("allows an admin to reject a property with a reason", async () => {
            const { user: owner } = await createUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });

            const res = await testRequest()
                .patch(`/api/v1/properties/${property.id}/reject`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ rejectionReason: "Incomplete listing details" });

            expect(res.status).toBe(200);
            expect(res.body.data.approvalStatus).toBe("rejected");
            expect(res.body.data.rejectionReason).toBe("Incomplete listing details");
        });
    });

    describe("Property images", () => {
        it("uploads an image and then deletes it", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });

            const uploadRes = await testRequest()
                .post(`/api/v1/properties/${property.id}/images`)
                .set("Authorization", `Bearer ${accessToken}`)
                .attach("images", Buffer.from("fake-image-bytes"), "photo.png");

            expect(uploadRes.status).toBe(201);
            expect(uploadRes.body.data).toHaveLength(1);
            expect(storageService.uploadBuffer).toHaveBeenCalledTimes(1);

            const imageId = uploadRes.body.data[0].id;

            const deleteRes = await testRequest()
                .delete(`/api/v1/properties/${property.id}/images/${imageId}`)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(deleteRes.status).toBe(200);
            expect(storageService.deleteObject).toHaveBeenCalledTimes(1);
        });

        it("rejects an image upload with no files", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });

            const res = await testRequest()
                .post(`/api/v1/properties/${property.id}/images`)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(400);
        });
    });
});
