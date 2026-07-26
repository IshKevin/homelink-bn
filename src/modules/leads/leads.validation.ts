import { z } from "zod";

export const submitContactSchema = {
    body: z.object({
        fullName: z.string().min(1),
        email: z.string().email(),
        subject: z.string().min(1),
        message: z.string().min(1)
    })
};

export const submitGetStartedSchema = {
    body: z.object({
        fullName: z.string().min(1),
        email: z.string().email(),
        phone: z.string().min(5),
        roleInterest: z
            .enum(["owner", "house_manager", "tenant", "agent"])
            .transform((value) => (value === "agent" ? "house_manager" : value))
            .optional(),
        propertyCount: z.coerce.number().int().positive().optional(),
        message: z.string().optional()
    })
};

export const listLeadsSchema = {
    query: z.object({
        type: z.enum(["contact", "get_started"]).optional(),
        status: z.enum(["new", "contacted", "converted", "dismissed"]).optional(),
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().optional()
    })
};

export const updateLeadStatusSchema = {
    body: z.object({
        status: z.enum(["new", "contacted", "converted", "dismissed"])
    })
};
