import { z } from "zod";

export const registerSchema = {
    body: z.object({
        email: z.string().email().max(255),
        firstName: z.string().min(1).max(100),
        lastName: z.string().min(1).max(100),
        phone: z.string().min(5).max(30),
        // Tenant self-registration is retired — tenant accounts are only
        // ever created by a landlord/agent (POST /leases newTenant), which
        // hands them a permanent login code instead of an email identity.
        // No password here either — every self-registration is a pending
        // request; the password is set later via the link emailed once an
        // admin approves it (see auth.service.ts's register()).
        role: z.enum(["owner", "agent"])
    })
};

export const loginSchema = {
    body: z.object({
        // An email (owner/agent/admin) or a tenant's login code — the
        // service tells them apart by whether it contains "@".
        identifier: z.string().min(1).max(255),
        password: z.string().min(1).max(72)
    })
};

export const verifyLoginChallengeSchema = {
    body: z.object({
        challengeId: z.string().uuid(),
        code: z.string().length(6)
    })
};

export const refreshSchema = {
    body: z.object({
        refreshToken: z.string().min(1).max(2048)
    })
};

export const forgotPasswordSchema = {
    body: z.object({
        // An email (owner/agent/admin) or a tenant's login code.
        identifier: z.string().min(1).max(255)
    })
};

export const resetPasswordSchema = {
    body: z.object({
        token: z.string().min(1).max(255),
        newPassword: z.string().min(8).max(72)
    })
};

export const changePasswordSchema = {
    body: z.object({
        currentPassword: z.string().min(1).max(72),
        newPassword: z.string().min(8).max(72)
    })
};
