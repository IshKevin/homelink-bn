import { z } from "zod";

// These two endpoints are public/unauthenticated (contact + get-started
// forms) — the most exposed in the app to an anonymous abuser, so bounding
// every field matters more here than anywhere behind auth.
export const submitContactSchema = {
    body: z.object({
        fullName: z.string().min(1).max(150),
        email: z.string().email().max(255),
        subject: z.string().min(1).max(255),
        message: z.string().min(1).max(5000)
    })
};

export const submitGetStartedSchema = {
    body: z.object({
        fullName: z.string().min(1).max(150),
        email: z.string().email().max(255),
        phone: z.string().min(5).max(30),
        roleInterest: z
            .enum(["owner", "house_manager", "tenant", "agent"])
            .transform((value) => (value === "agent" ? "house_manager" : value))
            .optional(),
        propertyCount: z.coerce.number().int().positive().optional(),
        message: z.string().max(5000).optional()
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
