import { z } from "zod";

export const createPropertySchema = {
    body: z.object({
        title: z.string().min(1),
        description: z.string().min(1).optional(),
        type: z.enum(["apartment", "house", "studio", "condo", "commercial", "other"]),
        addressLine: z.string().min(1),
        city: z.string().min(1),
        state: z.string().min(1).optional(),
        country: z.string().min(1),
        postalCode: z.string().min(1).optional(),
        bedrooms: z.number().int().nonnegative().optional(),
        bathrooms: z.number().int().nonnegative().optional(),
        rentAmount: z.number().positive(),
        rentConditions: z.string().min(1).optional(),
        ownerId: z.string().uuid().optional()
    })
};

export const updatePropertySchema = {
    body: z
        .object({
            title: z.string().min(1).optional(),
            description: z.string().min(1).optional(),
            type: z.enum(["apartment", "house", "studio", "condo", "commercial", "other"]).optional(),
            addressLine: z.string().min(1).optional(),
            city: z.string().min(1).optional(),
            state: z.string().min(1).optional(),
            country: z.string().min(1).optional(),
            postalCode: z.string().min(1).optional(),
            bedrooms: z.number().int().nonnegative().optional(),
            bathrooms: z.number().int().nonnegative().optional(),
            rentAmount: z.number().positive().optional(),
            rentConditions: z.string().min(1).optional(),
            status: z.enum(["available", "occupied"]).optional()
        })
        .refine((data) => Object.keys(data).length > 0, { message: "At least one field must be provided" })
};

export const listPropertiesSchema = {
    query: z.object({
        status: z.enum(["available", "occupied"]).optional(),
        type: z.enum(["apartment", "house", "studio", "condo", "commercial", "other"]).optional(),
        city: z.string().min(1).optional(),
        minRent: z.coerce.number().nonnegative().optional(),
        maxRent: z.coerce.number().nonnegative().optional(),
        ownerId: z.string().uuid().optional(),
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().optional()
    })
};

export const rejectPropertySchema = {
    body: z.object({
        rejectionReason: z.string().min(3)
    })
};
