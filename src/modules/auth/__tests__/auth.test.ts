import { eq } from "drizzle-orm";
import { testRequest } from "../../../../tests/helpers/app";
import { createUser } from "../../../../tests/helpers/factories";
import { db } from "../../../database";
import { refreshTokens } from "../../../database/schema";
import * as emailService from "../../../services/email.service";

jest.mock("../../../services/email.service", () => ({
    sendMail: jest.fn().mockResolvedValue(undefined)
}));

function extractToken(html: string): string {
    const match = html.match(/token=([a-f0-9]+)/);
    if (!match || !match[1]) throw new Error("Token not found in email html");
    return match[1];
}

describe("Auth module", () => {
    describe("POST /api/v1/auth/register", () => {
        it("registers a tenant and returns tokens", async () => {
            const res = await testRequest().post("/api/v1/auth/register").send({
                email: "tenant@example.com",
                password: "Password123!",
                firstName: "Jane",
                lastName: "Doe",
                phone: "0788123456",
                role: "tenant"
            });

            expect(res.status).toBe(201);
            expect(res.body.data.accessToken).toBeDefined();
            expect(res.body.data.refreshToken).toBeDefined();
            expect(res.body.data.user.email).toBe("tenant@example.com");
            expect(res.body.data.user.passwordHash).toBeUndefined();
            expect(res.body.data.user.isApproved).toBe(true);
        });

        it("marks new agents as not-yet-approved", async () => {
            const res = await testRequest().post("/api/v1/auth/register").send({
                email: "agent@example.com",
                password: "Password123!",
                firstName: "Alex",
                lastName: "Agent",
                phone: "0788123457",
                role: "agent"
            });

            expect(res.status).toBe(201);
            expect(res.body.data.user.isApproved).toBe(false);
        });

        it("rejects invalid input", async () => {
            const res = await testRequest().post("/api/v1/auth/register").send({
                email: "not-an-email",
                password: "short",
                firstName: "",
                lastName: "Doe",
                role: "tenant"
            });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it("rejects duplicate emails", async () => {
            await createUser({ email: "dupe@example.com" });

            const res = await testRequest().post("/api/v1/auth/register").send({
                email: "dupe@example.com",
                password: "Password123!",
                firstName: "Jane",
                lastName: "Doe",
                phone: "0788123458",
                role: "tenant"
            });

            expect(res.status).toBe(409);
        });
    });

    describe("POST /api/v1/auth/login", () => {
        it("logs in with correct credentials", async () => {
            await createUser({ email: "login@example.com", password: "Password123!" });

            const res = await testRequest().post("/api/v1/auth/login").send({
                email: "login@example.com",
                password: "Password123!"
            });

            expect(res.status).toBe(200);
            expect(res.body.data.accessToken).toBeDefined();
        });

        it("rejects wrong password", async () => {
            await createUser({ email: "login2@example.com", password: "Password123!" });

            const res = await testRequest().post("/api/v1/auth/login").send({
                email: "login2@example.com",
                password: "WrongPassword1!"
            });

            expect(res.status).toBe(401);
        });

        it("rejects unknown email", async () => {
            const res = await testRequest().post("/api/v1/auth/login").send({
                email: "nobody@example.com",
                password: "Password123!"
            });

            expect(res.status).toBe(401);
        });
    });

    describe("POST /api/v1/auth/refresh and /logout", () => {
        it("rotates the refresh token and revokes the old one", async () => {
            await createUser({ email: "refresh@example.com", password: "Password123!" });
            const loginRes = await testRequest().post("/api/v1/auth/login").send({
                email: "refresh@example.com",
                password: "Password123!"
            });
            const { refreshToken } = loginRes.body.data;

            const refreshRes = await testRequest().post("/api/v1/auth/refresh").send({ refreshToken });
            expect(refreshRes.status).toBe(200);
            expect(refreshRes.body.data.refreshToken).not.toBe(refreshToken);

            const reuseRes = await testRequest().post("/api/v1/auth/refresh").send({ refreshToken });
            expect(reuseRes.status).toBe(401);
        });

        it("treats replay of an already-rotated token as theft and revokes the session it rotated into", async () => {
            await createUser({ email: "reuse@example.com", password: "Password123!" });
            const loginRes = await testRequest().post("/api/v1/auth/login").send({
                email: "reuse@example.com",
                password: "Password123!"
            });
            const originalToken = loginRes.body.data.refreshToken;

            // Legitimate client rotates once, getting a new token.
            const firstRefreshRes = await testRequest().post("/api/v1/auth/refresh").send({ refreshToken: originalToken });
            const rotatedToken = firstRefreshRes.body.data.refreshToken;

            // An attacker who captured the original token before rotation replays it.
            const replayRes = await testRequest().post("/api/v1/auth/refresh").send({ refreshToken: originalToken });
            expect(replayRes.status).toBe(401);

            // The legitimate client's own rotated token must now be dead too —
            // otherwise reuse detection only punishes the attacker's dead end,
            // not the compromised lineage.
            const legitimateRetryRes = await testRequest().post("/api/v1/auth/refresh").send({ refreshToken: rotatedToken });
            expect(legitimateRetryRes.status).toBe(401);
        });

        it("logout revokes the refresh token", async () => {
            await createUser({ email: "logout@example.com", password: "Password123!" });
            const loginRes = await testRequest().post("/api/v1/auth/login").send({
                email: "logout@example.com",
                password: "Password123!"
            });
            const { refreshToken } = loginRes.body.data;

            const logoutRes = await testRequest().post("/api/v1/auth/logout").send({ refreshToken });
            expect(logoutRes.status).toBe(200);

            const stored = await db.query.refreshTokens.findFirst({ where: eq(refreshTokens.userId, loginRes.body.data.user.id) });
            expect(stored?.revokedAt).not.toBeNull();
        });
    });

    describe("Password reset flow", () => {
        it("allows resetting the password with a valid token", async () => {
            const mockedSendMail = emailService.sendMail as jest.Mock;
            const { user } = await createUser({ email: "reset@example.com", password: "OldPassword1!" });

            const forgotRes = await testRequest().post("/api/v1/auth/forgot-password").send({ email: user.email });
            expect(forgotRes.status).toBe(200);
            expect(mockedSendMail).toHaveBeenCalledTimes(1);

            const html = mockedSendMail.mock.calls[0][0].html as string;
            const token = extractToken(html);

            const resetRes = await testRequest()
                .post("/api/v1/auth/reset-password")
                .send({ token, newPassword: "NewPassword1!" });
            expect(resetRes.status).toBe(200);

            const loginRes = await testRequest().post("/api/v1/auth/login").send({
                email: user.email,
                password: "NewPassword1!"
            });
            expect(loginRes.status).toBe(200);
        });

        it("rejects an invalid reset token", async () => {
            const res = await testRequest()
                .post("/api/v1/auth/reset-password")
                .send({ token: "not-a-real-token", newPassword: "NewPassword1!" });
            expect(res.status).toBe(400);
        });
    });
});
