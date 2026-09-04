import { z } from "zod";

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

// Bounded so a request can't fill Postgres storage/WAL with a giant string,
// and momoNumber matches the DB column's varchar(30) so an over-limit value
// fails validation cleanly instead of erroring at the DB layer.
const shortText = (max = 255) => z.string().min(1).max(max);
const longText = (max = 5000) => z.string().min(1).max(max);

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
        momoNumber: z.string().max(30).optional(),
        leasePeriodNote: longText().optional()
    })
};

export const renewalRequestSchema = {
    body: z
        .object({
            proposedRent: z.number().positive().optional(),
            proposedEndDate: dateStringSchema.optional(),
            reason: longText().optional()
        })
        .refine((data) => data.proposedRent !== undefined || data.proposedEndDate !== undefined, {
            message: "At least one of proposedRent or proposedEndDate must be provided"
        })
};

export const terminationRequestSchema = {
    body: z.object({
        reason: longText().optional()
    })
};

export const decideChangeRequestRejectSchema = {
    body: z.object({
        decisionNotes: longText().min(3)
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
                    label: shortText(),
                    done: z.boolean()
                })
            )
            .min(1)
            .max(200)
    })
};

export const inspectMoveRequestSchema = {
    body: z.object({
        inspectionNotes: longText().min(3)
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
        propertyId: z.string().uuid().optional(),
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().optional()
    })
};
