import { z } from "zod";

export const listUsersSchema = {
    query: z.object({
        role: z.enum(["tenant", "owner", "agent", "admin"]).optional(),
        isApproved: z.enum(["true", "false"]).optional(),
        isActive: z.enum(["true", "false"]).optional(),
        search: z.string().optional(),
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().optional()
    })
};

export const updateUserStatusSchema = {
    body: z.object({
        isActive: z.boolean()
    })
};

export const listIdentityVerificationsSchema = {
    query: z.object({
        status: z.enum(["pending", "approved", "rejected"]).optional(),
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().optional()
    })
};

export const rejectIdentityVerificationSchema = {
    body: z.object({
        reviewNotes: z.string().min(3)
    })
};

export const deactivatePropertySchema = {
    body: z.object({
        reason: z.string().min(3)
    })
};

export const upsertSettingSchema = {
    body: z.object({
        value: z.unknown()
    })
};

export const listAuditLogsSchema = {
    query: z.object({
        userId: z.string().uuid().optional(),
        entity: z.string().optional(),
        action: z.string().optional(),
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().optional()
    })
};
