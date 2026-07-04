import { z } from "zod";

export const registerSchema = {
    body: z.object({
        email: z.string().email(),
        password: z.string().min(8, "Password must be at least 8 characters"),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        phone: z.string().min(5).optional(),
        role: z.enum(["tenant", "owner", "agent"])
    })
};

export const loginSchema = {
    body: z.object({
        email: z.string().email(),
        password: z.string().min(1)
    })
};

export const refreshSchema = {
    body: z.object({
        refreshToken: z.string().min(1)
    })
};

export const forgotPasswordSchema = {
    body: z.object({
        email: z.string().email()
    })
};

export const resetPasswordSchema = {
    body: z.object({
        token: z.string().min(1),
        newPassword: z.string().min(8)
    })
};
