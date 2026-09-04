import { z } from "zod";

const propertyTypeValues = ["apartment", "house", "studio", "condo", "commercial", "other"] as const;
const propertyCategoryValues = ["residential", "commercial"] as const;

// Unbounded z.string() lets any authenticated user submit a multi-hundred-MB
// payload on every request, bloating Postgres storage/WAL and anything that
// later embeds the field (emails, PDFs). These caps are generous for real
// usage but firmly rule that out.
const shortText = (max = 255) => z.string().min(1).max(max);
const longText = (max = 5000) => z.string().min(1).max(max);

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
    label: shortText(),
    value: shortText()
});

export const createPropertySchema = {
    body: z
        .object({
            title: shortText(),
            description: longText().optional(),
            type: z.enum(propertyTypeValues),
            category: z.enum(propertyCategoryValues),
            sizeSqm: z.number().positive().optional(),
            unitsCount: z.number().int().positive().optional(),
            upi: shortText().optional(),
            terms: z.array(shortText(500)).max(50).optional(),
            attributes: z.array(attributeSchema).max(50).optional(),
            addressLine: shortText(),
            city: shortText(),
            state: shortText().optional(),
            country: shortText(),
            postalCode: shortText().optional(),
            bedrooms: z.number().int().nonnegative().optional(),
            bathrooms: z.number().int().nonnegative().optional(),
            rentAmount: z.number().positive(),
            rentConditions: longText().optional(),
            ownerId: z.string().uuid().optional()
        })
        .superRefine((data, ctx) => checkCategoryTypeConsistency(data, ctx, { requireFields: true }))
};

export const updatePropertySchema = {
    body: z
        .object({
            title: shortText().optional(),
            description: longText().optional(),
            type: z.enum(propertyTypeValues).optional(),
            category: z.enum(propertyCategoryValues).optional(),
            sizeSqm: z.number().positive().optional(),
            unitsCount: z.number().int().positive().optional(),
            upi: shortText().optional(),
            terms: z.array(shortText(500)).max(50).optional(),
            attributes: z.array(attributeSchema).max(50).optional(),
            addressLine: shortText().optional(),
            city: shortText().optional(),
            state: shortText().optional(),
            country: shortText().optional(),
            postalCode: shortText().optional(),
            bedrooms: z.number().int().nonnegative().optional(),
            bathrooms: z.number().int().nonnegative().optional(),
            rentAmount: z.number().positive().optional(),
            rentConditions: longText().optional(),
            status: z.enum(["available", "occupied"]).optional()
        })
        .refine((data) => Object.keys(data).length > 0, { message: "At least one field must be provided" })
        .superRefine((data, ctx) => checkCategoryTypeConsistency(data, ctx, { requireFields: false }))
};

export const createUnitSchema = {
    body: z.object({
        label: shortText(),
        bedrooms: z.number().int().nonnegative().optional(),
        bathrooms: z.number().int().nonnegative().optional(),
        rentAmount: z.number().positive()
    })
};

export const updateUnitSchema = {
    body: z
        .object({
            label: shortText().optional(),
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
        city: shortText().optional(),
        minRent: z.coerce.number().nonnegative().optional(),
        maxRent: z.coerce.number().nonnegative().optional(),
        ownerId: z.string().uuid().optional(),
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().optional()
    })
};

export const rejectPropertySchema = {
    body: z.object({
        rejectionReason: longText().min(3)
    })
};
