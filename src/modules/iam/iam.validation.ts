import { z } from "zod";

export const inviteManagerSchema = {
    body: z.object({
        email: z.string().email().max(255)
    })
};

export const inviteTenantSchema = {
    body: z.object({
        email: z.string().email().max(255),
        propertyId: z.string().uuid().optional()
    })
};

export const acceptInviteSchema = {
    body: z.object({
        token: z.string().min(1).max(255),
        firstName: z.string().min(1).max(100),
        lastName: z.string().min(1).max(100),
        phone: z.string().min(5).max(30),
        password: z.string().min(8).max(72)
    })
};

export const createSuspensionRequestSchema = {
    body: z.object({
        targetUserId: z.string().uuid(),
        reason: z.string().min(3).max(5000)
    })
};

export const listInvitesSchema = {
    query: z.object({
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().optional()
    })
};
