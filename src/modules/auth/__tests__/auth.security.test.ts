import { eq } from "drizzle-orm";
import { testRequest } from "../../../../tests/helpers/app";
import { createUser } from "../../../../tests/helpers/factories";
import { db } from "../../../database";
import { refreshTokens } from "../../../database/schema";
import * as emailService from "../../../services/email.service";

jest.mock("../../../services/email.service", () => ({
    sendMail: jest.fn().mockResolvedValue(undefined)
}));

describe("Auth security", () => {
    describe("Idle session timeout", () => {
        it("rejects a refresh once the token has been idle past the timeout", async () => {
            await createUser({ email: "idle@example.com", password: "Password123!" });
            const loginRes = await testRequest().post("/api/v1/auth/login").send({
                email: "idle@example.com",
                password: "Password123!"
            });
            const { refreshToken } = loginRes.body.data;

            await db
                .update(refreshTokens)
                .set({ lastUsedAt: new Date(Date.now() - 61 * 60 * 1000) })
                .where(eq(refreshTokens.userId, loginRes.body.data.user.id));

            const refreshRes = await testRequest().post("/api/v1/auth/refresh").send({ refreshToken });
            expect(refreshRes.status).toBe(401);
        });
    });

    describe("New-device sign-in verification", () => {
        it("requires an emailed OTP code when logging in from an unrecognized device, then completes login", async () => {
            const { user } = await createUser({ email: "newdevice@example.com", password: "Password123!" });

            await testRequest()
                .post("/api/v1/auth/login")
                .set("User-Agent", "device-a")
                .send({ email: user.email, password: "Password123!" });

            const mockedSendMail = emailService.sendMail as jest.Mock;
            const challengeRes = await testRequest()
                .post("/api/v1/auth/login")
                .set("User-Agent", "device-b")
                .send({ email: user.email, password: "Password123!" });

            expect(challengeRes.status).toBe(200);
            expect(challengeRes.body.data.requiresVerification).toBe(true);
            expect(challengeRes.body.data.accessToken).toBeUndefined();

            const otpCall = mockedSendMail.mock.calls.find((c) => c[0].to === user.email && /\d{6}/.test(c[0].html));
            if (!otpCall) throw new Error("OTP email not sent");
            const code = (otpCall[0].html as string).match(/(\d{6})/)?.[1];

            const verifyRes = await testRequest()
                .post("/api/v1/auth/login/verify")
                .set("User-Agent", "device-b")
                .send({ challengeId: challengeRes.body.data.challengeId, code });

            expect(verifyRes.status).toBe(200);
            expect(verifyRes.body.data.accessToken).toBeDefined();
        });
    });
});
