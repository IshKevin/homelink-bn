import { z } from "zod";

// Full historical set — kept for filtering/reading existing properties.
const propertyTypeValues = ["apartment", "house", "studio", "condo", "commercial", "other", "mixed_use"] as const;
// New/updated properties may only pick from this narrower, currently-offered set.
const creatablePropertyTypeValues = ["apartment", "commercial", "mixed_use"] as const;

// Unbounded z.string() lets any authenticated user submit a multi-hundred-MB
// payload on every request, bloating Postgres storage/WAL and anything that
// later embeds the field (emails, PDFs). These caps are generous for real
// usage but firmly rule that out.
const shortText = (max = 255) => z.string().min(1).max(max);
const longText = (max = 5000) => z.string().min(1).max(max);

export const createPropertySchema = {
    body: z.object({
        title: shortText(),
        type: z.enum(creatablePropertyTypeValues),
        location: shortText(500),
        numberOfFloors: z.number().int().min(1).max(200),
        numberOfBasementFloors: z.number().int().min(0).max(50).optional(),
        ownerId: z.string().uuid().optional()
    })
};

export const updatePropertySchema = {
    body: z
        .object({
            title: shortText().optional(),
            type: z.enum(creatablePropertyTypeValues).optional(),
            location: shortText(500).optional(),
            status: z.enum(["available", "occupied"]).optional()
        })
        .refine((data) => Object.keys(data).length > 0, { message: "At least one field must be provided" })
};

export const updateFloorSchema = {
    body: z
        .object({
            name: shortText(100).optional(),
            scale: z.number().positive().optional()
        })
        .refine((data) => Object.keys(data).length > 0, { message: "At least one field must be provided" })
};

// Excludes "occupied" everywhere a human picks a unit's status directly —
// that value is only ever set by createLease (tenant assignment) and
// cleared by lease termination, never a manual edit. See properties.service.ts's
// updateUnit / ManualUnitStatus.
const manualUnitStatusValues = ["available", "maintenance", "inactive"] as const;
const unitStatusValues = ["available", "occupied", "maintenance", "inactive"] as const;

export const createUnitSchema = {
    body: z.object({
        label: shortText(),
        unitType: shortText().optional(),
        description: longText().optional(),
        floorId: z.string().uuid(),
        bedrooms: z.number().int().nonnegative().optional(),
        bathrooms: z.number().int().nonnegative().optional(),
        // Omit to leave it at the column default (0) — meant for bulk
        // creation where the real rent gets set per unit afterward.
        rentAmount: z.number().positive().optional(),
        scale: z.number().positive().optional(),
        deposit: z.number().nonnegative().optional()
    })
};

export const updateUnitSchema = {
    body: z
        .object({
            label: shortText().optional(),
            unitType: shortText().optional(),
            description: longText().optional(),
            floorId: z.string().uuid().optional(),
            bedrooms: z.number().int().nonnegative().optional(),
            bathrooms: z.number().int().nonnegative().optional(),
            rentAmount: z.number().positive().optional(),
            scale: z.number().positive().optional(),
            deposit: z.number().nonnegative().optional(),
            status: z.enum(manualUnitStatusValues).optional()
        })
        .refine((data) => Object.keys(data).length > 0, { message: "At least one field must be provided" })
};

export const generateUnitsSchema = {
    body: z.object({
        floorId: z.string().uuid(),
        count: z.number().int().min(1).max(500),
        unitType: shortText().optional(),
        bedrooms: z.number().int().nonnegative().optional(),
        bathrooms: z.number().int().nonnegative().optional(),
        // Omit to leave every generated unit at the column default (0) —
        // the shared "default rent" bulk-generate used to require is gone;
        // real rent gets set per unit afterward.
        rentAmount: z.number().positive().optional(),
        scale: z.number().positive().optional(),
        deposit: z.number().nonnegative().optional(),
        // Omit to auto-continue from the floor's current unit count; pass 0
        // to force numbering from Unit 1 regardless.
        startAt: z.number().int().nonnegative().optional()
    })
};

export const listAvailableUnitsSchema = {
    query: z.object({
        search: shortText().optional(),
        status: z.enum(unitStatusValues).optional(),
        propertyId: z.string().uuid().optional()
    })
};

export const listPropertiesSchema = {
    query: z.object({
        status: z.enum(["available", "occupied"]).optional(),
        approvalStatus: z.enum(["pending", "approved", "rejected"]).optional(),
        type: z.enum(propertyTypeValues).optional(),
        // Replaces the old `city` filter now that address is a single free-text
        // `location` field — matches title or location.
        search: shortText().optional(),
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
