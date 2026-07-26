import { z } from "zod";

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const createLeaseSchema = {
    body: z.object({
        propertyId: z.string().uuid(),
        unitId: z.string().uuid(),
        tenantId: z.string().uuid(),
        startDate: dateStringSchema,
        endDate: dateStringSchema.optional(),
        paymentDate: dateStringSchema.optional(),
        rentAmount: z.number().positive(),
        deposit: z.number().nonnegative().optional(),
        momoNumber: z.string().optional(),
        leasePeriodNote: z.string().optional()
    })
};

export const renewalRequestSchema = {
    body: z
        .object({
            proposedRent: z.number().positive().optional(),
            proposedEndDate: dateStringSchema.optional(),
            reason: z.string().min(1).optional()
        })
        .refine((data) => data.proposedRent !== undefined || data.proposedEndDate !== undefined, {
            message: "At least one of proposedRent or proposedEndDate must be provided"
        })
};

export const terminationRequestSchema = {
    body: z.object({
        reason: z.string().min(1).optional()
    })
};

export const decideChangeRequestRejectSchema = {
    body: z.object({
        decisionNotes: z.string().min(3)
    })
};

export const createMoveRequestSchema = {
    body: z.object({
        type: z.literal("move_out")
    })
};

export const updateChecklistSchema = {
    body: z.object({
        checklist: z
            .array(
                z.object({
                    label: z.string().min(1),
                    done: z.boolean()
                })
            )
            .min(1)
    })
};

export const inspectMoveRequestSchema = {
    body: z.object({
        inspectionNotes: z.string().min(3)
    })
};

export const listLeasesSchema = {
    query: z.object({
        status: z.enum([
            "draft",
            "pending_signatures",
            "active",
            "pending_renewal",
            "pending_termination",
            "terminated",
            "expired"
        ]).optional(),
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().optional()
    })
};
