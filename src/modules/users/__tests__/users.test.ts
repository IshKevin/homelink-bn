import { testRequest } from "../../../../tests/helpers/app";
import { createAuthedUser } from "../../../../tests/helpers/factories";
import * as storageService from "../../../services/storage.service";

jest.mock("../../../services/storage.service", () => ({
    buildObjectKey: jest.fn().mockReturnValue("identity/mock-key.png"),
    uploadBuffer: jest.fn().mockResolvedValue("identity/mock-key.png")
}));

describe("Users module", () => {
    describe("GET /api/v1/users/me", () => {
        it("returns the authenticated user's profile", async () => {
            const { accessToken, user } = await createAuthedUser({ email: "me@example.com" });

            const res = await testRequest().get("/api/v1/users/me").set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.id).toBe(user.id);
            expect(res.body.data.passwordHash).toBeUndefined();
        });

        it("rejects requests without a token", async () => {
            const res = await testRequest().get("/api/v1/users/me");
            expect(res.status).toBe(401);
        });
    });

    describe("PATCH /api/v1/users/me", () => {
        it("updates profile fields", async () => {
            const { accessToken } = await createAuthedUser({ email: "update@example.com" });

            const res = await testRequest()
                .patch("/api/v1/users/me")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ firstName: "Updated" });

            expect(res.status).toBe(200);
            expect(res.body.data.firstName).toBe("Updated");
        });

        it("rejects an empty update body", async () => {
            const { accessToken } = await createAuthedUser({ email: "update2@example.com" });

            const res = await testRequest()
                .patch("/api/v1/users/me")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe("POST /api/v1/users/me/verify-identity", () => {
        it("uploads a document and creates a pending verification", async () => {
            const { accessToken } = await createAuthedUser({ email: "verify@example.com" });

            const res = await testRequest()
                .post("/api/v1/users/me/verify-identity")
                .set("Authorization", `Bearer ${accessToken}`)
                .attach("document", Buffer.from("fake-image-bytes"), "id.png");

            expect(res.status).toBe(201);
            expect(res.body.data.status).toBe("pending");
            expect(storageService.uploadBuffer).toHaveBeenCalledTimes(1);
        });

        it("rejects submission without a file", async () => {
            const { accessToken } = await createAuthedUser({ email: "verify2@example.com" });

            const res = await testRequest()
                .post("/api/v1/users/me/verify-identity")
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(400);
        });

        it("lists my verification submissions", async () => {
            const { accessToken } = await createAuthedUser({ email: "verify3@example.com" });

            await testRequest()
                .post("/api/v1/users/me/verify-identity")
                .set("Authorization", `Bearer ${accessToken}`)
                .attach("document", Buffer.from("fake-image-bytes"), "id.png");

            const res = await testRequest()
                .get("/api/v1/users/me/verify-identity")
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
        });
    });
});
