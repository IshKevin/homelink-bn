import { eq } from "drizzle-orm";
import { testRequest } from "../../../../tests/helpers/app";
import { createAuthedUser, createUser } from "../../../../tests/helpers/factories";
import { db } from "../../../database";
import { refreshTokens, users } from "../../../database/schema";
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
        it("creates a pending owner request with no tokens and no usable password", async () => {
            const res = await testRequest().post("/api/v1/auth/register").send({
                email: "owner@example.com",
                firstName: "Jane",
                lastName: "Doe",
                phone: "0788123456",
                role: "owner"
            });

            expect(res.status).toBe(201);
            expect(res.body.data.accessToken).toBeUndefined();
            expect(res.body.data.refreshToken).toBeUndefined();
            expect(res.body.data.user.email).toBe("owner@example.com");
            expect(res.body.data.user.passwordHash).toBeUndefined();
            expect(res.body.data.user.isApproved).toBe(false);

            const loginRes = await testRequest()
                .post("/api/v1/auth/login")
                .send({ identifier: "owner@example.com", password: "anything" });
            expect(loginRes.status).toBe(401);
        });

        it("rejects self-registration as a tenant — tenant accounts are only created via the add-tenant flow", async () => {
            const res = await testRequest().post("/api/v1/auth/register").send({
                email: "wannabe-tenant@example.com",
                firstName: "Jane",
                lastName: "Doe",
                phone: "0788123456",
                role: "tenant"
            });

            expect(res.status).toBe(400);
        });

        it("marks new agents as not-yet-approved", async () => {
            const res = await testRequest().post("/api/v1/auth/register").send({
                email: "agent@example.com",
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
                firstName: "",
                lastName: "Doe",
                role: "tenant"
            });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it("rejects duplicate emails", async () => {
            await createUser({ email: "dupe@example.com", role: "owner" });

            const res = await testRequest().post("/api/v1/auth/register").send({
                email: "dupe@example.com",
                firstName: "Jane",
                lastName: "Doe",
                phone: "0788123458",
                role: "owner"
            });

            expect(res.status).toBe(409);
        });
    });

    describe("Login blocks a pending (not-yet-approved) account", () => {
        it("rejects login for an unapproved owner even with the right password", async () => {
            const { user: owner } = await createUser({
                email: "pending-owner@example.com",
                password: "Password123!",
                role: "owner",
                isApproved: false
            });

            const res = await testRequest().post("/api/v1/auth/login").send({
                identifier: owner.email,
                password: "Password123!"
            });

            expect(res.status).toBe(403);
        });
    });

    describe("POST /api/v1/auth/login", () => {
        it("logs in an owner with email + password", async () => {
            await createUser({ email: "login@example.com", password: "Password123!", role: "owner" });

            const res = await testRequest().post("/api/v1/auth/login").send({
                identifier: "login@example.com",
                password: "Password123!"
            });

            expect(res.status).toBe(200);
            expect(res.body.data.accessToken).toBeDefined();
        });

        it("rejects wrong password for an owner", async () => {
            await createUser({ email: "login2@example.com", password: "Password123!", role: "owner" });

            const res = await testRequest().post("/api/v1/auth/login").send({
                identifier: "login2@example.com",
                password: "WrongPassword1!"
            });

            expect(res.status).toBe(401);
        });

        it("rejects unknown email", async () => {
            const res = await testRequest().post("/api/v1/auth/login").send({
                identifier: "nobody@example.com",
                password: "Password123!"
            });

            expect(res.status).toBe(401);
        });

        it("logs in a tenant with their login code + password, not email", async () => {
            const { user: tenant } = await createUser({ password: "Password123!", role: "tenant" });
            expect(tenant.loginCode).toBeTruthy();

            const codeRes = await testRequest().post("/api/v1/auth/login").send({
                identifier: tenant.loginCode,
                password: "Password123!"
            });
            expect(codeRes.status).toBe(200);
            expect(codeRes.body.data.user.id).toBe(tenant.id);

            const emailRes = await testRequest().post("/api/v1/auth/login").send({
                identifier: tenant.email,
                password: "Password123!"
            });
            expect(emailRes.status).toBe(401);
        });

        it("rejects wrong password for a tenant login code", async () => {
            const { user: tenant } = await createUser({ password: "Password123!", role: "tenant" });

            const res = await testRequest().post("/api/v1/auth/login").send({
                identifier: tenant.loginCode,
                password: "WrongPassword1!"
            });

            expect(res.status).toBe(401);
        });

        it("allows two tenant accounts sharing the same email to log in independently via their own codes", async () => {
            const sharedEmail = "shared-tenant@example.com";
            const { user: tenantA } = await createUser({ email: sharedEmail, password: "PasswordA1!", role: "tenant" });
            const { user: tenantB } = await createUser({ email: sharedEmail, password: "PasswordB1!", role: "tenant" });

            const resA = await testRequest().post("/api/v1/auth/login").send({ identifier: tenantA.loginCode, password: "PasswordA1!" });
            expect(resA.status).toBe(200);
            expect(resA.body.data.user.id).toBe(tenantA.id);

            const resB = await testRequest().post("/api/v1/auth/login").send({ identifier: tenantB.loginCode, password: "PasswordB1!" });
            expect(resB.status).toBe(200);
            expect(resB.body.data.user.id).toBe(tenantB.id);
        });
    });

    describe("POST /api/v1/auth/refresh and /logout", () => {
        it("rotates the refresh token and revokes the old one", async () => {
            await createUser({ email: "refresh@example.com", password: "Password123!", role: "owner" });
            const loginRes = await testRequest().post("/api/v1/auth/login").send({
                identifier: "refresh@example.com",
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
            await createUser({ email: "reuse@example.com", password: "Password123!", role: "owner" });
            const loginRes = await testRequest().post("/api/v1/auth/login").send({
                identifier: "reuse@example.com",
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
            await createUser({ email: "logout@example.com", password: "Password123!", role: "owner" });
            const loginRes = await testRequest().post("/api/v1/auth/login").send({
                identifier: "logout@example.com",
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
        it("allows an owner to reset their password via email", async () => {
            const mockedSendMail = emailService.sendMail as jest.Mock;
            const { user } = await createUser({ email: "reset@example.com", password: "OldPassword1!", role: "owner" });

            const forgotRes = await testRequest().post("/api/v1/auth/forgot-password").send({ identifier: user.email });
            expect(forgotRes.status).toBe(200);
            expect(mockedSendMail).toHaveBeenCalledTimes(1);

            const html = mockedSendMail.mock.calls[0][0].html as string;
            const token = extractToken(html);

            const resetRes = await testRequest()
                .post("/api/v1/auth/reset-password")
                .send({ token, newPassword: "NewPassword1!" });
            expect(resetRes.status).toBe(200);

            const loginRes = await testRequest().post("/api/v1/auth/login").send({
                identifier: user.email,
                password: "NewPassword1!"
            });
            expect(loginRes.status).toBe(200);
        });

        it("allows a tenant to reset their password via login code, sending the link to their email", async () => {
            const mockedSendMail = emailService.sendMail as jest.Mock;
            const { user: tenant } = await createUser({ email: "tenant-reset@example.com", password: "OldPassword1!", role: "tenant" });

            const forgotRes = await testRequest().post("/api/v1/auth/forgot-password").send({ identifier: tenant.loginCode });
            expect(forgotRes.status).toBe(200);
            expect(mockedSendMail).toHaveBeenCalledTimes(1);
            expect(mockedSendMail.mock.calls[0][0].to).toBe(tenant.email);

            const html = mockedSendMail.mock.calls[0][0].html as string;
            const token = extractToken(html);

            const resetRes = await testRequest()
                .post("/api/v1/auth/reset-password")
                .send({ token, newPassword: "NewPassword1!" });
            expect(resetRes.status).toBe(200);

            const loginRes = await testRequest().post("/api/v1/auth/login").send({
                identifier: tenant.loginCode,
                password: "NewPassword1!"
            });
            expect(loginRes.status).toBe(200);
        });

        it("does not let a tenant reset their password via email", async () => {
            const mockedSendMail = emailService.sendMail as jest.Mock;
            const { user: tenant } = await createUser({ email: "tenant-noreset@example.com", password: "OldPassword1!", role: "tenant" });

            const forgotRes = await testRequest().post("/api/v1/auth/forgot-password").send({ identifier: tenant.email });
            // Deliberately indistinguishable from "no such account" — 200,
            // no email sent.
            expect(forgotRes.status).toBe(200);
            expect(mockedSendMail).not.toHaveBeenCalled();
        });

        it("rejects an invalid reset token", async () => {
            const res = await testRequest()
                .post("/api/v1/auth/reset-password")
                .send({ token: "not-a-real-token", newPassword: "NewPassword1!" });
            expect(res.status).toBe(400);
        });
    });

    describe("POST /api/v1/auth/change-password", () => {
        it("changes the password when currentPassword is correct, and clears mustChangePassword", async () => {
            const { user, password, accessToken } = await createAuthedUser({});
            await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, user.id));

            const res = await testRequest()
                .post("/api/v1/auth/change-password")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ currentPassword: password, newPassword: "BrandNewPassword1!" });
            expect(res.status).toBe(200);

            const [updated] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
            expect(updated!.mustChangePassword).toBe(false);

            const loginRes = await testRequest()
                .post("/api/v1/auth/login")
                .send({ identifier: user.loginCode, password: "BrandNewPassword1!" });
            expect(loginRes.status).toBe(200);
        });

        it("rejects an incorrect current password", async () => {
            const { accessToken } = await createAuthedUser({});

            const res = await testRequest()
                .post("/api/v1/auth/change-password")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ currentPassword: "WrongPassword1!", newPassword: "BrandNewPassword1!" });
            expect(res.status).toBe(401);
        });

        it("requires authentication", async () => {
            const res = await testRequest()
                .post("/api/v1/auth/change-password")
                .send({ currentPassword: "x", newPassword: "BrandNewPassword1!" });
            expect(res.status).toBe(401);
        });
    });
});
