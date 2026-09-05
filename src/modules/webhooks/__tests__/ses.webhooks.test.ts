import https from "node:https";
import { EventEmitter } from "node:events";
import { eq } from "drizzle-orm";
import { testRequest } from "../../../../tests/helpers/app";
import { db } from "../../../database";
import { suppressedEmails } from "../../../database/schema";

jest.mock("sns-validator", () => {
    const mockValidate = jest.fn((body: unknown, cb: (err: Error | null, message?: unknown) => void) => cb(null, body));
    const Ctor = jest.fn().mockImplementation(() => ({ validate: mockValidate }));
    return Object.assign(Ctor, { mockValidate });
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockValidate = (require("sns-validator") as { mockValidate: jest.Mock }).mockValidate;

// spyOn (not jest.mock) so the rest of the real `https` module — which the
// AWS SDK's own HTTP handler also depends on — stays intact for everything
// else in this test file's module graph.
const mockHttpsGet = jest.spyOn(https, "get").mockImplementation(((_url: unknown, cb: (res: EventEmitter) => void) => {
    const res = new EventEmitter() as EventEmitter & { resume: () => void };
    res.resume = () => undefined;
    cb(res);
    res.emit("end");
    return new EventEmitter();
}) as unknown as typeof https.get);

describe("POST /api/v1/webhooks/ses/notifications", () => {
    afterEach(() => jest.clearAllMocks());

    it("rejects a message that fails SNS signature validation", async () => {
        mockValidate.mockImplementationOnce((_body, cb) => cb(new Error("bad signature")));

        const res = await testRequest().post("/api/v1/webhooks/ses/notifications").send({ Type: "Notification" });
        expect(res.status).toBe(400);
    });

    it("confirms an SNS subscription by visiting SubscribeURL", async () => {
        const res = await testRequest()
            .post("/api/v1/webhooks/ses/notifications")
            .send({ Type: "SubscriptionConfirmation", SubscribeURL: "https://sns.eu-west-1.amazonaws.com/confirm?token=abc" });

        expect(res.status).toBe(200);
        expect(mockHttpsGet).toHaveBeenCalledWith("https://sns.eu-west-1.amazonaws.com/confirm?token=abc", expect.any(Function));
    });

    it("suppresses an address on a permanent bounce", async () => {
        const message = JSON.stringify({
            notificationType: "Bounce",
            bounce: {
                bounceType: "Permanent",
                bounceSubType: "General",
                bouncedRecipients: [{ emailAddress: "hard-bounce@example.com" }]
            }
        });

        const res = await testRequest()
            .post("/api/v1/webhooks/ses/notifications")
            .send({ Type: "Notification", Message: message });

        expect(res.status).toBe(200);
        const [row] = await db
            .select()
            .from(suppressedEmails)
            .where(eq(suppressedEmails.email, "hard-bounce@example.com"))
            .limit(1);
        expect(row).toBeDefined();
        expect(row!.reason).toBe("bounce");
    });

    it("does not suppress on a transient bounce", async () => {
        const message = JSON.stringify({
            notificationType: "Bounce",
            bounce: {
                bounceType: "Transient",
                bounceSubType: "MailboxFull",
                bouncedRecipients: [{ emailAddress: "temporarily-full@example.com" }]
            }
        });

        await testRequest().post("/api/v1/webhooks/ses/notifications").send({ Type: "Notification", Message: message });

        const [row] = await db
            .select()
            .from(suppressedEmails)
            .where(eq(suppressedEmails.email, "temporarily-full@example.com"))
            .limit(1);
        expect(row).toBeUndefined();
    });

    it("suppresses an address on a complaint", async () => {
        const message = JSON.stringify({
            notificationType: "Complaint",
            complaint: {
                complaintFeedbackType: "abuse",
                complainedRecipients: [{ emailAddress: "complained@example.com" }]
            }
        });

        await testRequest().post("/api/v1/webhooks/ses/notifications").send({ Type: "Notification", Message: message });

        const [row] = await db.select().from(suppressedEmails).where(eq(suppressedEmails.email, "complained@example.com")).limit(1);
        expect(row).toBeDefined();
        expect(row!.reason).toBe("complaint");
    });
});
