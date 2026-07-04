import { z } from "zod";

export const createMaintenanceRequestSchema = {
    body: z.object({
        propertyId: z.string().uuid(),
        title: z.string().min(3),
        description: z.string().min(3)
    })
};

export const assignMaintenanceRequestSchema = {
    body: z.object({
        assignedTo: z.string().uuid()
    })
};

export const updateStatusSchema = {
    body: z.object({
        status: z.literal("in_progress")
    })
};

export const completeMaintenanceRequestSchema = {
    body: z.object({
        itemsCost: z.number().nonnegative().optional(),
        laborCost: z.number().nonnegative().optional(),
        completionNotes: z.string().optional()
    })
};

export const submitFeedbackSchema = {
    body: z.object({
        rating: z.number().int().min(1).max(5),
        comment: z.string().optional()
    })
};

export const listMaintenanceRequestsSchema = {
    query: z.object({
        status: z.enum(["submitted", "assigned", "in_progress", "completed"]).optional(),
        propertyId: z.string().uuid().optional(),
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().optional()
    })
};
