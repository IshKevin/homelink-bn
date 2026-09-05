import { z } from "zod";

export const registerSchema = {
    body: z.object({
        email: z.string().email().max(255),
        // Capped so an absurdly long password isn't hashed by bcrypt on every
        // request; bcrypt also silently ignores anything past 72 bytes anyway.
        password: z.string().min(8, "Password must be at least 8 characters").max(72),
        firstName: z.string().min(1).max(100),
        lastName: z.string().min(1).max(100),
        phone: z.string().min(5).max(30),
        role: z.enum(["tenant", "owner", "agent"])
    })
};

export const loginSchema = {
    body: z.object({
        email: z.string().email().max(255),
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
        email: z.string().email().max(255)
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
