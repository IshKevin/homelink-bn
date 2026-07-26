import { testRequest } from "../../../../tests/helpers/app";
import { createAuthedUser } from "../../../../tests/helpers/factories";
import * as emailService from "../../../services/email.service";

jest.mock("../../../services/email.service", () => ({
    sendMail: jest.fn().mockResolvedValue(undefined)
}));

describe("Leads module", () => {
    describe("POST /api/v1/leads/contact", () => {
        it("accepts a public contact submission without authentication", async () => {
            const res = await testRequest().post("/api/v1/leads/contact").send({
                fullName: "Jane Doe",
                email: "jane@example.com",
                subject: "Question about pricing",
                message: "How much does it cost to list a property?"
            });

            expect(res.status).toBe(201);
            expect(res.body.data.type).toBe("contact");
            expect(res.body.data.status).toBe("new");
        });

        it("rejects a submission missing required fields", async () => {
            const res = await testRequest().post("/api/v1/leads/contact").send({ fullName: "Jane Doe" });
            expect(res.status).toBe(400);
        });
    });

    describe("POST /api/v1/leads/get-started", () => {
        it("accepts a public get-started submission and maps 'agent' to house_manager", async () => {
            const res = await testRequest().post("/api/v1/leads/get-started").send({
                fullName: "Eric N.",
                email: "eric@example.com",
                phone: "0788111222",
                roleInterest: "agent",
                propertyCount: 4
            });

            expect(res.status).toBe(201);
            expect(res.body.data.type).toBe("get_started");
            expect(res.body.data.roleInterest).toBe("house_manager");
        });

        it("notifies the configured admin email when a lead is submitted", async () => {
            const res = await testRequest().post("/api/v1/leads/get-started").send({
                fullName: "Aline M.",
                email: "aline@example.com",
                phone: "0788333444",
                roleInterest: "owner"
            });

            expect(res.status).toBe(201);
            if (process.env["ADMIN_EMAIL"]) {
                expect(emailService.sendMail).toHaveBeenCalled();
            }
        });
    });

    describe("GET /api/v1/leads", () => {
        it("forbids a non-admin from listing leads", async () => {
            const { accessToken } = await createAuthedUser({ role: "owner" });
            const res = await testRequest().get("/api/v1/leads").set("Authorization", `Bearer ${accessToken}`);
            expect(res.status).toBe(403);
        });

        it("lets an admin list and filter submitted leads", async () => {
            await testRequest().post("/api/v1/leads/contact").send({
                fullName: "Jane Doe",
                email: "jane@example.com",
                subject: "Question",
                message: "Message body"
            });
            await testRequest().post("/api/v1/leads/get-started").send({
                fullName: "Eric N.",
                email: "eric@example.com",
                phone: "0788111222"
            });

            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });

            const res = await testRequest().get("/api/v1/leads").set("Authorization", `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            expect(res.body.data.length).toBe(2);

            const filtered = await testRequest()
                .get("/api/v1/leads?type=contact")
                .set("Authorization", `Bearer ${adminToken}`);
            expect(filtered.status).toBe(200);
            expect(filtered.body.data.length).toBe(1);
            expect(filtered.body.data[0].type).toBe("contact");
        });
    });

    describe("PATCH /api/v1/leads/:id/status", () => {
        it("lets an admin update a lead's status", async () => {
            const submitRes = await testRequest().post("/api/v1/leads/contact").send({
                fullName: "Jane Doe",
                email: "jane@example.com",
                subject: "Question",
                message: "Message body"
            });
            const leadId = submitRes.body.data.id;

            const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });

            const res = await testRequest()
                .patch(`/api/v1/leads/${leadId}/status`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ status: "contacted" });

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe("contacted");
        });

        it("forbids a non-admin from updating a lead's status", async () => {
            const submitRes = await testRequest().post("/api/v1/leads/contact").send({
                fullName: "Jane Doe",
                email: "jane@example.com",
                subject: "Question",
                message: "Message body"
            });
            const leadId = submitRes.body.data.id;

            const { accessToken } = await createAuthedUser({ role: "tenant" });

            const res = await testRequest()
                .patch(`/api/v1/leads/${leadId}/status`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ status: "contacted" });

            expect(res.status).toBe(403);
        });
    });
});
