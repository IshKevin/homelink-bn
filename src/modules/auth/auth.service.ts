import crypto from "node:crypto";
import { addDays, addHours, addMinutes } from "date-fns";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../../database";
import { loginChallenges, passwordResetTokens, refreshTokens, users } from "../../database/schema";
import { AppError } from "../../common/errors/AppError";
import { comparePassword, hashPassword } from "../../common/utils/password.util";
import {
    generateRawToken,
    hashToken,
    signAccessToken,
    signRefreshToken,
    verifyRefreshToken
} from "../../common/utils/jwt.util";
import { sendMail } from "../../services/email.service";
import { newDeviceLoginTemplate, passwordResetTemplate } from "../../services/email.templates";
import { recordAction } from "../../services/audit.service";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

export interface RegisterInput {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone: string;
    role: "tenant" | "owner" | "agent";
}

export interface RequestMeta {
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
}

function toPublicUser(user: typeof users.$inferSelect) {
    const { passwordHash: _passwordHash, ...publicUser } = user;
    return publicUser;
}

async function issueTokenPair(user: typeof users.$inferSelect, meta: RequestMeta = {}) {
    const accessToken = signAccessToken({ sub: user.id, role: user.role, email: user.email });
    const refreshToken = signRefreshToken({ sub: user.id });

    const now = new Date();
    await db.insert(refreshTokens).values({
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        lastUsedAt: now,
        expiresAt: addDays(now, 30)
    });

    return { accessToken, refreshToken };
}

async function isKnownDevice(userId: string, meta: RequestMeta): Promise<boolean> {
    if (!meta.ipAddress || !meta.userAgent) return true;

    const [anyDevice] = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId)).limit(1);
    if (!anyDevice) return true;

    const [seen] = await db
        .select()
        .from(refreshTokens)
        .where(
            and(
                eq(refreshTokens.userId, userId),
                eq(refreshTokens.ipAddress, meta.ipAddress),
                eq(refreshTokens.userAgent, meta.userAgent)
            )
        )
        .limit(1);

    return Boolean(seen);
}

function generateOtpCode(): string {
    return String(crypto.randomInt(100000, 1000000));
}

async function issueLoginChallenge(user: typeof users.$inferSelect, meta: RequestMeta) {
    const code = generateOtpCode();
    const [challenge] = await db
        .insert(loginChallenges)
        .values({
            userId: user.id,
            codeHash: hashToken(code),
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            expiresAt: addMinutes(new Date(), env.newDeviceOtpTtlMinutes)
        })
        .returning();

    if (!challenge) throw AppError.internal("Failed to start login verification");

    await sendMail({
        to: user.email,
        subject: "Confirm this sign-in",
        html: newDeviceLoginTemplate(user.firstName, code)
    });

    return { requiresVerification: true as const, challengeId: challenge.id };
}

export async function register(input: RegisterInput, meta: RequestMeta = {}) {
    const [existing] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (existing) {
        throw AppError.conflict("An account with this email already exists");
    }

    const passwordHash = await hashPassword(input.password);
    const [user] = await db
        .insert(users)
        .values({
            email: input.email,
            passwordHash,
            firstName: input.firstName,
            lastName: input.lastName,
            phone: input.phone,
            role: input.role,
            isApproved: input.role === "agent" ? false : true
        })
        .returning();

    if (!user) throw AppError.internal("Failed to create user");

    await recordAction({ userId: user.id, action: "user.register", entity: "user", entityId: user.id });

    const tokens = await issueTokenPair(user, meta);
    return { user: toPublicUser(user), ...tokens };
}

const DEMO_EMAIL_DOMAIN = "@homelink.dev";

export async function login(email: string, password: string, meta: RequestMeta = {}) {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !(await comparePassword(password, user.passwordHash))) {
        throw AppError.unauthorized("Invalid email or password");
    }
    if (!user.isActive) {
        throw AppError.forbidden("This account has been deactivated");
    }

    // Seeded demo accounts (src/scripts/seed-demo-users.ts) are shared by
    // many people testing from different devices/locations at once, so the
    // new-device OTP challenge would trigger constantly and add friction to
    // a flow meant to be frictionless. Real accounts always use this domain
    // never a real user's — always go through the challenge below.
    const isDemoAccount = user.email.endsWith(DEMO_EMAIL_DOMAIN);

    if (!isDemoAccount && !(await isKnownDevice(user.id, meta))) {
        return issueLoginChallenge(user, meta);
    }

    const tokens = await issueTokenPair(user, meta);
    return { user: toPublicUser(user), ...tokens };
}

export async function verifyLoginChallenge(challengeId: string, code: string, meta: RequestMeta = {}) {
    const [challenge] = await db.select().from(loginChallenges).where(eq(loginChallenges.id, challengeId)).limit(1);

    if (!challenge || challenge.verifiedAt || challenge.expiresAt < new Date() || challenge.codeHash !== hashToken(code)) {
        throw AppError.unauthorized("Invalid or expired code");
    }

    const [user] = await db.select().from(users).where(eq(users.id, challenge.userId)).limit(1);
    if (!user || !user.isActive) {
        throw AppError.unauthorized("Account no longer active");
    }

    await db.update(loginChallenges).set({ verifiedAt: new Date() }).where(eq(loginChallenges.id, challengeId));

    const tokens = await issueTokenPair(user, { ipAddress: challenge.ipAddress ?? meta.ipAddress, userAgent: challenge.userAgent ?? meta.userAgent });
    return { user: toPublicUser(user), ...tokens };
}

export async function refresh(rawRefreshToken: string, meta: RequestMeta = {}) {
    let payload: { sub: string };
    try {
        payload = verifyRefreshToken(rawRefreshToken);
    } catch {
        throw AppError.unauthorized("Invalid or expired refresh token");
    }

    const tokenHash = hashToken(rawRefreshToken);
    const [stored] = await db
        .select()
        .from(refreshTokens)
        .where(and(eq(refreshTokens.tokenHash, tokenHash), gt(refreshTokens.expiresAt, new Date())))
        .limit(1);

    if (!stored) {
        throw AppError.unauthorized("Refresh token has been revoked or expired");
    }

    if (stored.revokedAt) {
        // This exact token was already rotated away by an earlier refresh —
        // seeing it again means either a harmless race or a stolen copy being
        // replayed after the legitimate client moved on. Can't tell which, so
        // treat it as theft: kill every other active session for this user
        // rather than just rejecting this one request and letting a stolen
        // token's owner keep trying.
        await db
            .update(refreshTokens)
            .set({ revokedAt: new Date() })
            .where(and(eq(refreshTokens.userId, stored.userId), isNull(refreshTokens.revokedAt)));
        logger.warn(
            { userId: stored.userId, tokenId: stored.id },
            "Refresh token reuse detected — all active sessions revoked"
        );
        throw AppError.unauthorized("Refresh token has been revoked or expired");
    }

    const idleDeadline = addMinutes(stored.lastUsedAt, env.idleTimeoutMinutes);
    if (idleDeadline < new Date()) {
        await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, stored.id));
        throw AppError.unauthorized("Session expired due to inactivity, please log in again");
    }

    const [user] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
    if (!user || !user.isActive) {
        throw AppError.unauthorized("Account no longer active");
    }

    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, stored.id));

    const tokens = await issueTokenPair(user, meta);
    return { user: toPublicUser(user), ...tokens };
}

export async function logout(rawRefreshToken: string) {
    const tokenHash = hashToken(rawRefreshToken);
    await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)));
}

export async function forgotPassword(email: string) {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    // Do not reveal whether the email exists.
    if (!user) return;

    const rawToken = generateRawToken();
    await db.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: addHours(new Date(), 1)
    });

    const link = `${env.appUrl}/reset-password?token=${rawToken}`;
    await sendMail({
        to: user.email,
        subject: "Reset your HomeLink password",
        html: passwordResetTemplate(user.firstName, link)
    });
}

export async function resetPassword(rawToken: string, newPassword: string) {
    const tokenHash = hashToken(rawToken);
    const [stored] = await db
        .select()
        .from(passwordResetTokens)
        .where(
            and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date()))
        )
        .limit(1);

    if (!stored) {
        throw AppError.badRequest("Invalid or expired reset token");
    }

    const passwordHash = await hashPassword(newPassword);
    await db.update(users).set({ passwordHash, mustChangePassword: false }).where(eq(users.id, stored.userId));
    await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, stored.id));
    await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, stored.userId), isNull(refreshTokens.revokedAt)));
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !(await comparePassword(currentPassword, user.passwordHash))) {
        throw AppError.unauthorized("Current password is incorrect");
    }

    const passwordHash = await hashPassword(newPassword);
    await db.update(users).set({ passwordHash, mustChangePassword: false }).where(eq(users.id, userId));

    // Every other session gets logged out on a password change — this one's
    // access token stays valid until it naturally expires, matching
    // resetPassword's behavior.
    await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}
