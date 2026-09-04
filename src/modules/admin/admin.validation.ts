import { z } from "zod";

export const listUsersSchema = {
    query: z.object({
        role: z.enum(["tenant", "owner", "agent", "admin", "superadmin", "house_manager"]).optional(),
        isApproved: z.enum(["true", "false"]).optional(),
        isActive: z.enum(["true", "false"]).optional(),
        search: z.string().max(255).optional(),
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
        reviewNotes: z.string().min(3).max(5000)
    })
};

export const deactivatePropertySchema = {
    body: z.object({
        reason: z.string().min(3).max(5000)
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
        entity: z.string().max(255).optional(),
        action: z.string().max(255).optional(),
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().optional()
    })
};

export const createHouseOwnerSchema = {
    body: z.object({
        email: z.string().email().max(255),
        firstName: z.string().min(1).max(100),
        lastName: z.string().min(1).max(100),
        phone: z.string().min(5).max(30)
    })
};

export const listSuspensionRequestsSchema = {
    query: z.object({
        status: z.enum(["pending", "approved", "rejected"]).optional(),
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().optional()
    })
};

export const rejectSuspensionRequestSchema = {
    body: z.object({
        decisionNotes: z.string().min(3).max(5000)
    })
};
