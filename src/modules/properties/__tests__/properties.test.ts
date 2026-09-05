import { eq } from "drizzle-orm";
import { testRequest } from "../../../../tests/helpers/app";
import { createAuthedUser, createProperty, createUser } from "../../../../tests/helpers/factories";
import { db } from "../../../database";
import { properties, propertyUnits } from "../../../database/schema";
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
    category: "residential",
    unitsCount: 4,
    upi: "1/01/03/02/1156",
    terms: ["12-month lease", "1 month deposit"],
    attributes: [{ label: "Floor", value: "3rd Floor" }],
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
            expect(res.body.data.upi).toBe(validPropertyPayload.upi);
            expect(res.body.data.terms).toEqual(validPropertyPayload.terms);
            expect(res.body.data.attributes).toEqual(validPropertyPayload.attributes);

            const detailRes = await testRequest()
                .get(`/api/v1/properties/${res.body.data.id}`)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(detailRes.status).toBe(200);
            expect(detailRes.body.data.totalUnits).toBe(1);
            expect(detailRes.body.data.occupiedUnits).toBe(0);
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
        it("adds a unit and updates it", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });

            const createRes = await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "Unit 2B", rentAmount: 750 });
            expect(createRes.status).toBe(201);
            expect(createRes.body.data.label).toBe("Unit 2B");

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

        it("does not let a tenant list units of a property that isn't approved and active", async () => {
            const { user: owner } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id, approvalStatus: "pending" });

            const { accessToken: tenantToken } = await createAuthedUser({ role: "tenant" });
            const res = await testRequest()
                .get(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(res.status).toBe(404);
        });
    });

    describe("POST /api/v1/properties/:id/units/generate", () => {
        it("distributes units evenly across floors with a shared default price", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });

            const res = await testRequest()
                .post(`/api/v1/properties/${property.id}/units/generate`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ count: 5, floors: 2, rentAmount: 500 });

            expect(res.status).toBe(201);
            expect(res.body.data).toHaveLength(5);
            expect(res.body.data.every((u: { rentAmount: string }) => u.rentAmount === "500.00")).toBe(true);
            expect(res.body.data.filter((u: { floor: number }) => u.floor === 1)).toHaveLength(3);
            expect(res.body.data.filter((u: { floor: number }) => u.floor === 2)).toHaveLength(2);
            expect(res.body.data.every((u: { status: string }) => u.status === "available")).toBe(true);
        });

        it("generates simple sequential labels when no floors are given", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });

            const res = await testRequest()
                .post(`/api/v1/properties/${property.id}/units/generate`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ count: 3, rentAmount: 500 });

            expect(res.status).toBe(201);
            expect(res.body.data.map((u: { label: string }) => u.label).sort()).toEqual(["Unit 1", "Unit 2", "Unit 3"]);
        });

        it("forbids a tenant from generating units", async () => {
            const { user: owner } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const { accessToken: tenantToken } = await createAuthedUser({ role: "tenant" });

            const res = await testRequest()
                .post(`/api/v1/properties/${property.id}/units/generate`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ count: 3, rentAmount: 500 });
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

        it("imports one unit per row with per-row pricing", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const file = await buildUnitsWorkbook([
                ["Floor 1 - Unit A", 1, 2, 1, 450],
                ["Floor 1 - Unit B", 1, 1, 1, 380]
            ]);

            const res = await testRequest()
                .post(`/api/v1/properties/${property.id}/units/import`)
                .set("Authorization", `Bearer ${accessToken}`)
                .attach("file", file, "units.xlsx");

            expect(res.status).toBe(201);
            expect(res.body.data).toHaveLength(2);
            const a = res.body.data.find((u: { label: string }) => u.label === "Floor 1 - Unit A");
            expect(a.rentAmount).toBe("450.00");
            expect(a.floor).toBe(1);
        });

        it("imports nothing and reports row errors when any row is invalid", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const file = await buildUnitsWorkbook([
                ["Valid Unit", 1, 2, 1, 450],
                ["Bad Unit", 1, 2, 1, -50] // negative rent
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
            const file = await buildUnitsWorkbook([["Unit A", 1, 2, 1, 450]]);

            const res = await testRequest()
                .post(`/api/v1/properties/${property.id}/units/import`)
                .set("Authorization", `Bearer ${agentToken}`)
                .attach("file", file, "units.xlsx");
            expect(res.status).toBe(403);
        });
    });

    describe("GET /api/v1/properties/units", () => {
        it("searches available units scoped to the requester's own properties", async () => {
            const { user: owner, accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            await testRequest()
                .post(`/api/v1/properties/${property.id}/units/generate`)
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({ count: 2, rentAmount: 500 });

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
            await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "A001", rentAmount: 500 });

            const res = await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "A001", rentAmount: 600 });
            expect(res.status).toBe(409);
        });

        it("rejects generating units that would collide with an existing label", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "Unit 1", rentAmount: 500 });

            const res = await testRequest()
                .post(`/api/v1/properties/${property.id}/units/generate`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ count: 2, rentAmount: 500 }); // generates "Unit 1", "Unit 2" — collides
            expect(res.status).toBe(409);

            const listRes = await testRequest()
                .get(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(listRes.body.data).toHaveLength(2); // default unit + the one manually created — nothing from the failed generate
        });

        it("allows renaming a unit to a label that isn't used elsewhere in the property, but not to one that is", async () => {
            const { user: owner, accessToken } = await createAuthedUser({ role: "owner" });
            const property = await createProperty({ ownerId: owner.id });
            const createA = await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "A001", rentAmount: 500 });
            const createB = await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "B001", rentAmount: 500 });

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
                ["A001", 1, 2, 1, 450],
                ["A002", 1, 1, 1, -50] // invalid
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
            await testRequest()
                .post(`/api/v1/properties/${property.id}/units`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ label: "A001", rentAmount: 500 });

            const file = await buildUnitsWorkbook([["A001", 1, 2, 1, 450]]);
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
