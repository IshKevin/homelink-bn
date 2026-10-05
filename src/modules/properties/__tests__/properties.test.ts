import { eq } from "drizzle-orm";
import { testRequest } from "../../../../tests/helpers/app";
import { createAuthedUser, createLease, createProperty, createUser } from "../../../../tests/helpers/factories";
import { db } from "../../../database";
import { floors, leases, properties, propertyUnits } from "../../../database/schema";
import * as storageService from "../../../services/storage.service";

jest.mock("../../../services/storage.service", () => ({
    buildObjectKey: jest.fn().mockReturnValue("properties/mock-key.png"),
    uploadBuffer: jest.fn().mockResolvedValue("properties/mock-key.png"),
    getPresignedDownloadUrl: jest.fn().mockResolvedValue("https://example.com/signed"),
    deleteObject: jest.fn().mockResolvedValue(undefined)
}));

jest.mock("../../../services/email.service", () => ({
    sendMail: jest.fn().mockResolvedValue(undefined)
}));

const validPropertyPayload = {
    title: "Cozy Apartment",
    type: "apartment",
    location: "123 Main St, Kigali",
    numberOfFloors: 1
};

async function getGroundFloor(propertyId: string) {
    const [floor] = await db.select().from(floors).where(eq(floors.propertyId, propertyId));
    return floor!;
}

describe("Properties module", () => {
    describe("POST /api/v1/properties", () => {
        it("allows an owner to register a property, auto-creating its floors", async () => {
            const { accessToken } = await createAuthedUser({ role: "owner" });

            const res = await testRequest()
                .post("/api/v1/properties")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ ...validPropertyPayload, numberOfFloors: 3 });

            expect(res.status).toBe(201);
            expect(res.body.data.approvalStatus).toBe("pending");
            expect(res.body.data.status).toBe("available");
            expect(res.body.data.location).toBe(validPropertyPayload.location);
            expect(res.body.data.numberOfFloors).toBe(3);

            const floorsRes = await testRequest()
                .get(`/api/v1/properties/${res.body.data.id}/floors`)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(floorsRes.status).toBe(200);
            expect(floorsRes.body.data.map((f: { name: string }) => f.name)).toEqual(["Ground", "Floor 1", "Floor 2"]);
            expect(floorsRes.body.data.every((f: { unitsCount: number }) => f.unitsCount === 0)).toBe(true);

            const detailRes = await testRequest()
                .get(`/api/v1/properties/${res.body.data.id}`)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(detailRes.status).toBe(200);
            expect(detailRes.body.data.totalUnits).toBe(0);
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

        it("rejects a near-duplicate submission (same owner/title/location) within a few seconds", async () => {
            const { accessToken } = await createAuthedUser({ role: "owner" });

            const firstRes = await testRequest()
                .post("/api/v1/properties")
                .set("Authorization", `Bearer ${accessToken}`)
                .send(validPropertyPayload);
            expect(firstRes.status).toBe(201);

            const secondRes = await testRequest()
                .post("/api/v1/properties")
                .set("Authorization", `Bearer ${accessToken}`)
                .send(validPropertyPayload);
            expect(secondRes.status).toBe(409);
        });

        it("allows the same owner to create a different property right after, even with an overlapping title", async () => {
            const { accessToken } = await createAuthedUser({ role: "owner" });

            const firstRes = await testRequest()
                .post("/api/v1/properties")
                .set("Authorization", `Bearer ${accessToken}`)
                .send(validPropertyPayload);
            expect(firstRes.status).toBe(201);

            const secondRes = await testRequest()
                .post("/api/v1/properties")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ ...validPropertyPayload, location: "456 Other St, Kigali" });
            expect(secondRes.status).toBe(201);
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

        it("rejects a numberOfFloors of zero", async () => {
            const { accessToken } = await createAuthedUser({ role: "owner" });

            const res = await testRequest()
                .post("/api/v1/properties")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ ...validPropertyPayload, numberOfFloors: 0 });

            expect(res.status).toBe(400);
        });
    });

    describe("Property floors", () => {
        it("lets the owner edit a floor's name and scale", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const floor = await getGroundFloor(property.id);

            const res = await testRequest()
                .patch(`/api/v1/properties/${property.id}/floors/${floor.id}`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ name: "Basement", scale: 120.5 });

            expect(res.status).toBe(200);
            expect(res.body.data.name).toBe("Basement");
            expect(res.body.data.scale).toBe("120.50");
        });

        it("rejects a different owner from editing a floor", async () => {
            const { user: owner } = await createUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const floor = await getGroundFloor(property.id);
            const { accessToken: otherOwnerToken } = await createAuthedUser({ role: "owner" });

            const res = await testRequest()
                .patch(`/api/v1/properties/${property.id}/floors/${floor.id}`)
                .set("Authorization", `Bearer ${otherOwnerToken}`)
                .send({ name: "Hacked" });

            expect(res.status).toBe(403);
        });

        it("lists a floor's units separately from other floors", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id, numberOfFloors: 2, withDefaultUnit: false });
            const groundFloor = await getGroundFloor(property.id);
            const [floor1] = await db.select().from(floors).where(eq(floors.propertyId, property.id)).orderBy(floors.index).limit(2).offset(1);

            await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "G-1", floorId: groundFloor.id, rentAmount: 500 });
            await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "F1-1", floorId: floor1!.id, rentAmount: 500 });

            const groundUnitsRes = await testRequest()
                .get(`/api/v1/properties/${property.id}/floors/${groundFloor.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(groundUnitsRes.body.data.map((u: { label: string }) => u.label)).toEqual(["G-1"]);

            const floor1UnitsRes = await testRequest()
                .get(`/api/v1/properties/${property.id}/floors/${floor1!.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(floor1UnitsRes.body.data.map((u: { label: string }) => u.label)).toEqual(["F1-1"]);
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

    describe("DELETE /api/v1/properties/:id", () => {
        it("lets the owner delete their own property when it has no lease history", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });

            const res = await testRequest()
                .delete(`/api/v1/properties/${property.id}`)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(200);

            const getRes = await testRequest()
                .get(`/api/v1/properties/${property.id}`)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(getRes.status).toBe(404);

            const remainingUnits = await db.select().from(propertyUnits).where(eq(propertyUnits.propertyId, property.id));
            expect(remainingUnits).toHaveLength(0);
        });

        it("rejects a different owner from deleting the property", async () => {
            const { user: owner } = await createUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const { accessToken: otherOwnerToken } = await createAuthedUser({ role: "owner" });

            const res = await testRequest()
                .delete(`/api/v1/properties/${property.id}`)
                .set("Authorization", `Bearer ${otherOwnerToken}`);

            expect(res.status).toBe(403);
        });

        it("blocks deletion once the property has lease history, even a terminated lease", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const { user: tenant } = await createUser({ role: "tenant" });
            await createLease({ propertyId: property.id, tenantId: tenant.id, ownerId: owner.id, status: "terminated" });

            const res = await testRequest()
                .delete(`/api/v1/properties/${property.id}`)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(409);

            const stillThere = await db.select().from(properties).where(eq(properties.id, property.id));
            expect(stillThere).toHaveLength(1);
        });

        it("returns 404 for a property that doesn't exist", async () => {
            const { accessToken } = await createAuthedUser({ role: "owner" });

            const res = await testRequest()
                .delete("/api/v1/properties/00000000-0000-0000-0000-000000000000")
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(404);
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

        it("searches by title or location", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            await createProperty({ ownerId: owner.id, title: "Findable Lodge" });
            await createProperty({ ownerId: owner.id, title: "Other Place" });

            const res = await testRequest()
                .get("/api/v1/properties?search=Findable")
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].title).toBe("Findable Lodge");
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

    describe("Property document", () => {
        it("uploads a document, fetches its presigned URL, then deletes it", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });

            const uploadRes = await testRequest()
                .put(`/api/v1/properties/${property.id}/document`)
                .set("Authorization", `Bearer ${accessToken}`)
                .attach("document", Buffer.from("fake-pdf-bytes"), "deed.pdf");

            expect(uploadRes.status).toBe(200);
            expect(storageService.uploadBuffer).toHaveBeenCalled();

            const getRes = await testRequest()
                .get(`/api/v1/properties/${property.id}/document`)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(getRes.status).toBe(200);
            expect(getRes.body.data.url).toBe("https://example.com/signed");

            const deleteRes = await testRequest()
                .delete(`/api/v1/properties/${property.id}/document`)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(deleteRes.status).toBe(200);

            const afterDeleteRes = await testRequest()
                .get(`/api/v1/properties/${property.id}/document`)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(afterDeleteRes.status).toBe(404);
        });

        it("does not let an unrelated owner or a tenant fetch another owner's document", async () => {
            const { user: owner, accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            await testRequest()
                .put(`/api/v1/properties/${property.id}/document`)
                .set("Authorization", `Bearer ${ownerToken}`)
                .attach("document", Buffer.from("fake-pdf-bytes"), "deed.pdf");

            const { accessToken: otherOwnerToken } = await createAuthedUser({ role: "owner" });
            const otherOwnerRes = await testRequest()
                .get(`/api/v1/properties/${property.id}/document`)
                .set("Authorization", `Bearer ${otherOwnerToken}`);
            expect(otherOwnerRes.status).toBe(403);

            const { accessToken: tenantToken } = await createAuthedUser({ role: "tenant" });
            const tenantRes = await testRequest()
                .get(`/api/v1/properties/${property.id}/document`)
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(tenantRes.status).toBe(403);
        });
    });

    describe("Property units", () => {
        it("adds a unit to a floor and updates it", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const floor = await getGroundFloor(property.id);

            const createRes = await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "Unit 2B", floorId: floor.id, rentAmount: 750 });
            expect(createRes.status).toBe(201);
            expect(createRes.body.data.label).toBe("Unit 2B");
            expect(createRes.body.data.floorId).toBe(floor.id);

            const listRes = await testRequest()
                .get(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(listRes.status).toBe(200);
            expect(listRes.body.data).toHaveLength(2);

            const updateRes = await testRequest()
                .patch(`/api/v1/properties/${property.id}/units/${createRes.body.data.id}`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ rentAmount: 800 });
            expect(updateRes.status).toBe(200);
            expect(updateRes.body.data.rentAmount).toBe("800.00");
        });

        it("rejects creating a unit on a floor that doesn't belong to this property", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const otherProperty = await createProperty({ ownerId: owner.id });
            const otherFloor = await getGroundFloor(otherProperty.id);

            const res = await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "Unit X", floorId: otherFloor.id, rentAmount: 500 });
            expect(res.status).toBe(404);
        });

        it("does not let a tenant list units of a property that isn't approved and active", async () => {
            const { user: owner } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id, approvalStatus: "pending" });

            const { accessToken: tenantToken } = await createAuthedUser({ role: "tenant" });
            const res = await testRequest()
                .get(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(res.status).toBe(404);
        });

        it("deletes a unit that was never leased", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const floor = await getGroundFloor(property.id);

            const createRes = await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "Unit 2B", floorId: floor.id, rentAmount: 750 });

            const deleteRes = await testRequest()
                .delete(`/api/v1/properties/${property.id}/units/${createRes.body.data.id}`)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(deleteRes.status).toBe(200);

            const listRes = await testRequest()
                .get(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(listRes.body.data).toHaveLength(1);
        });

        it("forbids deleting an occupied unit", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.propertyId, property.id));
            await db.update(propertyUnits).set({ status: "occupied" }).where(eq(propertyUnits.id, unit!.id));

            const res = await testRequest()
                .delete(`/api/v1/properties/${property.id}/units/${unit!.id}`)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(res.status).toBe(409);
        });

        it("archives a unit with lease history instead of deleting it, keeping the lease record intact", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const { user: tenant } = await createAuthedUser({ role: "tenant" });
            const property = await createProperty({ ownerId: owner.id });
            const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.propertyId, property.id));

            const [lease] = await db
                .insert(leases)
                .values({
                    propertyId: property.id,
                    unitId: unit!.id,
                    tenantId: tenant.id,
                    ownerId: owner.id,
                    startDate: "2026-01-01",
                    endDate: "2026-06-01",
                    rentAmount: "1000",
                    status: "terminated",
                    terminatedAt: new Date()
                })
                .returning();

            const res = await testRequest()
                .delete(`/api/v1/properties/${property.id}/units/${unit!.id}`)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(res.status).toBe(200);

            const [archivedUnit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, unit!.id));
            expect(archivedUnit?.deletedAt).not.toBeNull();

            const [survivingLease] = await db.select().from(leases).where(eq(leases.id, lease!.id));
            expect(survivingLease).toBeDefined();

            const listRes = await testRequest()
                .get(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(listRes.body.data).toHaveLength(0);
        });

        it("lets a landlord reuse a unit label after archiving the original unit", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.propertyId, property.id));

            await testRequest()
                .delete(`/api/v1/properties/${property.id}/units/${unit!.id}`)
                .set("Authorization", `Bearer ${accessToken}`);

            const res = await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: unit!.label, floorId: unit!.floorId, rentAmount: 900 });
            expect(res.status).toBe(201);
        });
    });

    describe("GET /api/v1/properties/:id/units/:unitId", () => {
        it("returns the unit with its floor and no current lease when available", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.propertyId, property.id));

            const res = await testRequest()
                .get(`/api/v1/properties/${property.id}/units/${unit!.id}`)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.id).toBe(unit!.id);
            expect(res.body.data.floor.name).toBe("Ground");
            expect(res.body.data.currentLease).toBeUndefined();
        });

        it("includes the current lease when the unit is occupied", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const { user: tenant } = await createAuthedUser({ role: "tenant" });
            const property = await createProperty({ ownerId: owner.id });
            const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.propertyId, property.id));
            await db.update(propertyUnits).set({ status: "occupied" }).where(eq(propertyUnits.id, unit!.id));
            const lease = await createLease({ propertyId: property.id, unitId: unit!.id, tenantId: tenant.id, ownerId: owner.id });

            const res = await testRequest()
                .get(`/api/v1/properties/${property.id}/units/${unit!.id}`)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.currentLease.id).toBe(lease.id);
            expect(res.body.data.currentLease.tenantId).toBe(tenant.id);
        });

        it("returns 404 for a unit that doesn't exist", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });

            const res = await testRequest()
                .get(`/api/v1/properties/${property.id}/units/00000000-0000-0000-0000-000000000000`)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(res.status).toBe(404);
        });
    });

    describe("POST /api/v1/properties/:id/units/generate", () => {
        it("bulk-creates units on one floor, labeled with the floor's name", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const floor = await getGroundFloor(property.id);

            const res = await testRequest()
                .post(`/api/v1/properties/${property.id}/units/generate`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ floorId: floor.id, count: 5, rentAmount: 500 });

            expect(res.status).toBe(201);
            expect(res.body.data).toHaveLength(5);
            expect(res.body.data.every((u: { rentAmount: string }) => u.rentAmount === "500.00")).toBe(true);
            expect(res.body.data.every((u: { floorId: string }) => u.floorId === floor.id)).toBe(true);
            expect(res.body.data.map((u: { label: string }) => u.label).sort()).toEqual([
                "Ground - Unit 1",
                "Ground - Unit 2",
                "Ground - Unit 3",
                "Ground - Unit 4",
                "Ground - Unit 5"
            ]);
        });

        it("called once per floor produces independently-labeled units matching each floor's count", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id, numberOfFloors: 2 });
            const [ground, floor1] = await db.select().from(floors).where(eq(floors.propertyId, property.id)).orderBy(floors.index);

            const groundRes = await testRequest()
                .post(`/api/v1/properties/${property.id}/units/generate`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ floorId: ground!.id, count: 2, rentAmount: 500 });
            expect(groundRes.status).toBe(201);
            expect(groundRes.body.data).toHaveLength(2);

            const floor1Res = await testRequest()
                .post(`/api/v1/properties/${property.id}/units/generate`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ floorId: floor1!.id, count: 3, rentAmount: 500 });
            expect(floor1Res.status).toBe(201);
            expect(floor1Res.body.data).toHaveLength(3);
            expect(floor1Res.body.data.map((u: { label: string }) => u.label).sort()).toEqual([
                "Floor 1 - Unit 1",
                "Floor 1 - Unit 2",
                "Floor 1 - Unit 3"
            ]);
        });

        it("forbids a tenant from generating units", async () => {
            const { user: owner } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const floor = await getGroundFloor(property.id);
            const { accessToken: tenantToken } = await createAuthedUser({ role: "tenant" });

            const res = await testRequest()
                .post(`/api/v1/properties/${property.id}/units/generate`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ floorId: floor.id, count: 3, rentAmount: 500 });
            expect(res.status).toBe(403);
        });
    });

    describe("POST /api/v1/properties/:id/units/import", () => {
        async function buildUnitsWorkbook(rows: (string | number)[][]): Promise<Buffer> {
            const ExcelJS = (await import("exceljs")).default;
            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet("Units");
            sheet.addRow(["label", "floor", "bedrooms", "bathrooms", "rentAmount"]);
            rows.forEach((row) => sheet.addRow(row));
            const buffer = await workbook.xlsx.writeBuffer();
            return Buffer.from(buffer);
        }

        it("imports one unit per row with per-row pricing, resolving floor by name", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const floor = await getGroundFloor(property.id);
            const file = await buildUnitsWorkbook([
                ["Floor A - Unit A", "Ground", 2, 1, 450],
                ["Floor A - Unit B", "ground", 1, 1, 380] // case-insensitive match
            ]);

            const res = await testRequest()
                .post(`/api/v1/properties/${property.id}/units/import`)
                .set("Authorization", `Bearer ${accessToken}`)
                .attach("file", file, "units.xlsx");

            expect(res.status).toBe(201);
            expect(res.body.data).toHaveLength(2);
            const a = res.body.data.find((u: { label: string }) => u.label === "Floor A - Unit A");
            expect(a.rentAmount).toBe("450.00");
            expect(a.floorId).toBe(floor.id);
        });

        it("reports a row error when the floor name doesn't match any existing floor", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const file = await buildUnitsWorkbook([["Unit A", "Penthouse", 2, 1, 450]]);

            const res = await testRequest()
                .post(`/api/v1/properties/${property.id}/units/import`)
                .set("Authorization", `Bearer ${accessToken}`)
                .attach("file", file, "units.xlsx");

            expect(res.status).toBe(400);
            expect(res.body.errors).toEqual([expect.objectContaining({ message: expect.stringContaining("does not exist") })]);
        });

        it("imports nothing and reports row errors when any row is invalid", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const file = await buildUnitsWorkbook([
                ["Valid Unit", "Ground", 2, 1, 450],
                ["Bad Unit", "Ground", 2, 1, -50] // negative rent
            ]);

            const res = await testRequest()
                .post(`/api/v1/properties/${property.id}/units/import`)
                .set("Authorization", `Bearer ${accessToken}`)
                .attach("file", file, "units.xlsx");

            expect(res.status).toBe(400);
            expect(res.body.errors).toEqual([expect.objectContaining({ row: 3 })]);

            const listRes = await testRequest()
                .get(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`);
            // Only the default unit from property creation — nothing imported.
            expect(listRes.body.data).toHaveLength(1);
        });

        it("forbids an agent not assigned to the property from importing units", async () => {
            const { user: owner } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const { accessToken: agentToken } = await createAuthedUser({ role: "agent" });
            const file = await buildUnitsWorkbook([["Unit A", "Ground", 2, 1, 450]]);

            const res = await testRequest()
                .post(`/api/v1/properties/${property.id}/units/import`)
                .set("Authorization", `Bearer ${agentToken}`)
                .attach("file", file, "units.xlsx");
            expect(res.status).toBe(403);
        });
    });

    describe("GET /api/v1/properties/units", () => {
        it("includes unitType, description, and deposit in the response", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const floor = await getGroundFloor(property.id);
            await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "A001", floorId: floor.id, unitType: "2 Bedroom", description: "Corner unit", rentAmount: 500, deposit: 1000 });

            const res = await testRequest()
                .get(`/api/v1/properties/units?propertyId=${property.id}`)
                .set("Authorization", `Bearer ${accessToken}`);
            const a001 = res.body.data.find((u: { label: string }) => u.label === "A001");
            expect(a001.unitType).toBe("2 Bedroom");
            expect(a001.description).toBe("Corner unit");
            expect(a001.deposit).toBe("1000.00");
        });

        it("searches available units scoped to the requester's own properties", async () => {
            const { user: owner, accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const floor = await getGroundFloor(property.id);
            await testRequest()
                .post(`/api/v1/properties/${property.id}/units/generate`)
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({ floorId: floor.id, count: 2, rentAmount: 500 });

            const { accessToken: otherOwnerToken } = await createAuthedUser({ role: "owner" });

            const res = await testRequest()
                .get(`/api/v1/properties/units?search=${encodeURIComponent(property.title)}`)
                .set("Authorization", `Bearer ${ownerToken}`);
            expect(res.status).toBe(200);
            expect(res.body.data.length).toBeGreaterThanOrEqual(2);
            expect(res.body.data.every((u: { propertyId: string }) => u.propertyId === property.id)).toBe(true);

            const otherRes = await testRequest()
                .get(`/api/v1/properties/units?search=${encodeURIComponent(property.title)}`)
                .set("Authorization", `Bearer ${otherOwnerToken}`);
            expect(otherRes.body.data).toHaveLength(0);
        });

        it("excludes occupied units by default", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const [defaultUnit] = await db.select().from(propertyUnits).where(eq(propertyUnits.propertyId, property.id));
            await db.update(propertyUnits).set({ status: "occupied" }).where(eq(propertyUnits.id, defaultUnit!.id));

            const res = await testRequest()
                .get(`/api/v1/properties/units?propertyId=${property.id}`)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(res.body.data).toHaveLength(0);
        });

        it("forbids a tenant from searching units", async () => {
            const { accessToken: tenantToken } = await createAuthedUser({ role: "tenant" });
            const res = await testRequest().get("/api/v1/properties/units").set("Authorization", `Bearer ${tenantToken}`);
            expect(res.status).toBe(403);
        });
    });

    describe("Unit numbers must be unique within a property", () => {
        it("rejects creating a unit whose label already exists in the property", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const floor = await getGroundFloor(property.id);
            await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "A001", floorId: floor.id, rentAmount: 500 });

            const res = await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "A001", floorId: floor.id, rentAmount: 600 });
            expect(res.status).toBe(409);
        });

        it("rejects generating units that would collide with an existing label", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const floor = await getGroundFloor(property.id);
            await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "Ground - Unit 1", floorId: floor.id, rentAmount: 500 });

            const res = await testRequest()
                .post(`/api/v1/properties/${property.id}/units/generate`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ floorId: floor.id, count: 2, rentAmount: 500 }); // generates "Ground - Unit 1", "Ground - Unit 2" — collides
            expect(res.status).toBe(409);

            const listRes = await testRequest()
                .get(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(listRes.body.data).toHaveLength(2); // default unit + the one manually created — nothing from the failed generate
        });

        it("allows renaming a unit to a label that isn't used elsewhere in the property, but not to one that is", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const floor = await getGroundFloor(property.id);
            const createA = await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "A001", floorId: floor.id, rentAmount: 500 });
            const createB = await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "B001", floorId: floor.id, rentAmount: 500 });

            const collideRes = await testRequest()
                .patch(`/api/v1/properties/${property.id}/units/${createB.body.data.id}`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "A001" });
            expect(collideRes.status).toBe(409);

            const renameRes = await testRequest()
                .patch(`/api/v1/properties/${property.id}/units/${createA.body.data.id}`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "A001-Renamed" });
            expect(renameRes.status).toBe(200);
        });
    });

    describe("Manual unit status changes", () => {
        it("rejects setting status to 'occupied' directly (only a lease assignment can do that)", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.propertyId, property.id));

            const res = await testRequest()
                .patch(`/api/v1/properties/${property.id}/units/${unit!.id}`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ status: "occupied" });
            expect(res.status).toBe(400);
        });

        it("allows marking an available unit under maintenance or inactive", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.propertyId, property.id));

            const maintenanceRes = await testRequest()
                .patch(`/api/v1/properties/${property.id}/units/${unit!.id}`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ status: "maintenance" });
            expect(maintenanceRes.status).toBe(200);
            expect(maintenanceRes.body.data.status).toBe("maintenance");

            const inactiveRes = await testRequest()
                .patch(`/api/v1/properties/${property.id}/units/${unit!.id}`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ status: "inactive" });
            expect(inactiveRes.status).toBe(200);
            expect(inactiveRes.body.data.status).toBe("inactive");
        });

        it("rejects any manual status change on a unit that already has an active tenant", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.propertyId, property.id));
            await db.update(propertyUnits).set({ status: "occupied" }).where(eq(propertyUnits.id, unit!.id));

            const res = await testRequest()
                .patch(`/api/v1/properties/${property.id}/units/${unit!.id}`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ status: "maintenance" });
            expect(res.status).toBe(409);
        });
    });

    describe("POST /api/v1/properties/:id/units/import/preview", () => {
        async function buildUnitsWorkbook(rows: (string | number)[][]): Promise<Buffer> {
            const ExcelJS = (await import("exceljs")).default;
            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet("Units");
            sheet.addRow(["label", "floor", "bedrooms", "bathrooms", "rentAmount"]);
            rows.forEach((row) => sheet.addRow(row));
            const buffer = await workbook.xlsx.writeBuffer();
            return Buffer.from(buffer);
        }

        it("returns valid rows and row errors without creating anything", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const file = await buildUnitsWorkbook([
                ["A001", "Ground", 2, 1, 450],
                ["A002", "Ground", 1, 1, -50] // invalid
            ]);

            const res = await testRequest()
                .post(`/api/v1/properties/${property.id}/units/import/preview`)
                .set("Authorization", `Bearer ${accessToken}`)
                .attach("file", file, "units.xlsx");

            expect(res.status).toBe(200);
            expect(res.body.data.values).toHaveLength(1);
            expect(res.body.data.errors).toHaveLength(1);

            const listRes = await testRequest()
                .get(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(listRes.body.data).toHaveLength(1); // only the default unit — preview created nothing
        });

        it("flags a duplicate label against an existing unit in the preview", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const floor = await getGroundFloor(property.id);
            await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "A001", floorId: floor.id, rentAmount: 500 });

            const file = await buildUnitsWorkbook([["A001", "Ground", 2, 1, 450]]);
            const res = await testRequest()
                .post(`/api/v1/properties/${property.id}/units/import/preview`)
                .set("Authorization", `Bearer ${accessToken}`)
                .attach("file", file, "units.xlsx");

            expect(res.status).toBe(200);
            expect(res.body.data.errors).toEqual([expect.objectContaining({ message: expect.stringContaining("already exists") })]);
        });
    });

    describe("GET /api/v1/properties/units/import-template", () => {
        it("returns a downloadable xlsx template", async () => {
            const { accessToken } = await createAuthedUser({ role: "owner" });
            const res = await testRequest()
                .get("/api/v1/properties/units/import-template")
                .set("Authorization", `Bearer ${accessToken}`);
            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toContain("spreadsheetml");
        });
    });
});
