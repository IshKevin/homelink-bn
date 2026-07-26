import { z } from "zod";

const propertyTypeValues = ["apartment", "house", "studio", "condo", "commercial", "other"] as const;
const propertyCategoryValues = ["residential", "commercial"] as const;

function checkCategoryTypeConsistency(
    data: {
        category?: string | undefined;
        type?: string | undefined;
        sizeSqm?: number | undefined;
        unitsCount?: number | undefined;
    },
    ctx: z.RefinementCtx,
    { requireFields }: { requireFields: boolean }
) {
    if (data.category === "commercial") {
        if (data.type !== undefined && data.type !== "commercial") {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Commercial properties must use type 'commercial'",
                path: ["type"]
            });
        }
        if (requireFields && data.sizeSqm === undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "sizeSqm is required for commercial properties",
                path: ["sizeSqm"]
            });
        }
    } else if (data.category === "residential") {
        if (data.type === "commercial") {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Residential properties cannot use type 'commercial'",
                path: ["type"]
            });
        }
        if (requireFields && data.type === "apartment" && data.unitsCount === undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "unitsCount (doors) is required for apartment properties",
                path: ["unitsCount"]
            });
        }
    }
}

const attributeSchema = z.object({
    label: z.string().min(1),
    value: z.string().min(1)
});

export const createPropertySchema = {
    body: z
        .object({
            title: z.string().min(1),
            description: z.string().min(1).optional(),
            type: z.enum(propertyTypeValues),
            category: z.enum(propertyCategoryValues),
            sizeSqm: z.number().positive().optional(),
            unitsCount: z.number().int().positive().optional(),
            upi: z.string().min(1).optional(),
            terms: z.array(z.string().min(1)).optional(),
            attributes: z.array(attributeSchema).optional(),
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
        .superRefine((data, ctx) => checkCategoryTypeConsistency(data, ctx, { requireFields: true }))
};

export const updatePropertySchema = {
    body: z
        .object({
            title: z.string().min(1).optional(),
            description: z.string().min(1).optional(),
            type: z.enum(propertyTypeValues).optional(),
            category: z.enum(propertyCategoryValues).optional(),
            sizeSqm: z.number().positive().optional(),
            unitsCount: z.number().int().positive().optional(),
            upi: z.string().min(1).optional(),
            terms: z.array(z.string().min(1)).optional(),
            attributes: z.array(attributeSchema).optional(),
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
        .superRefine((data, ctx) => checkCategoryTypeConsistency(data, ctx, { requireFields: false }))
};

export const createUnitSchema = {
    body: z.object({
        label: z.string().min(1),
        bedrooms: z.number().int().nonnegative().optional(),
        bathrooms: z.number().int().nonnegative().optional(),
        rentAmount: z.number().positive()
    })
};

export const updateUnitSchema = {
    body: z
        .object({
            label: z.string().min(1).optional(),
            bedrooms: z.number().int().nonnegative().optional(),
            bathrooms: z.number().int().nonnegative().optional(),
            rentAmount: z.number().positive().optional()
        })
        .refine((data) => Object.keys(data).length > 0, { message: "At least one field must be provided" })
};

export const listPropertiesSchema = {
    query: z.object({
        status: z.enum(["available", "occupied"]).optional(),
        type: z.enum(propertyTypeValues).optional(),
        category: z.enum(propertyCategoryValues).optional(),
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
