import { z } from "zod";

export const inviteManagerSchema = {
    body: z.object({
        email: z.string().email()
    })
};

export const inviteTenantSchema = {
    body: z.object({
        email: z.string().email(),
        propertyId: z.string().uuid().optional()
    })
};

export const acceptInviteSchema = {
    body: z.object({
        token: z.string().min(1),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        phone: z.string().min(5),
        password: z.string().min(8)
    })
};

export const createSuspensionRequestSchema = {
    body: z.object({
        targetUserId: z.string().uuid(),
        reason: z.string().min(3)
    })
};

export const listInvitesSchema = {
    query: z.object({
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().optional()
    })
};
